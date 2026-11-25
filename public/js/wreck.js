// Aircraft deaths: break-up, burning wreckage, impacts and pilot ejection.
//
// A missile's warhead shreds the airframe: wings, tails and the nose section tear off and tumble
// away on their own ballistics while the fuel-fed fireball rolls on along the flight path.
// Cannon damage usually leaves the jet in one piece but burning and out of control; it may
// still blow apart before it hits the ground. Everything that reaches the ground explodes,
// burns and leaves a smoke column (or a splash at sea). If the cockpit survives, the pilot
// ejects: canopy off, seat rocket, seat separation, parachute.
//
// All random choices come from a seed, so both players in an online match see the same break-up.
import * as THREE from 'three';
import { buildJet, buildPilot, FRAGMENT_GEOS } from './models.js';
import { groundHeight, terrainHeight } from './world.js';
import { airDensity, GRAV } from './flight.js';

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// drag constant per piece (a = kd * rho/1.225 * v^2): heavy fuselage carries on, wings flutter down
const KD = { whole: 0.00035, core: 0.0008, nose: 0.0013, wingR: 0.0045, wingL: 0.0045, stabR: 0.007, stabL: 0.007, finR: 0.006, finL: 0.006, fin: 0.006, canopy: 0.01 };
const BIG = new Set(['whole', 'core']);
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _up = new THREE.Vector3(), _f = new THREE.Vector3();
const fragMat = new THREE.MeshStandardMaterial({ color: 0x2b2a28, roughness: 0.8, metalness: 0.5, flatShading: true, side: THREE.DoubleSide });
const WIND = new THREE.Vector3(3, 0, 1.5);

export class Wrecks {
  constructor(scene, effects, audio, hooks = {}) {
    this.scene = scene; this.fx = effects; this.audio = audio; this.hooks = hooks;
    this.pieces = []; this.pilots = []; this.columns = []; this.events = []; this.builds = []; this.geos = [];
    // one shared light for explosion flashes (always in the scene so shaders never recompile)
    this.light = new THREE.PointLight(0xffb070, 0, 2500, 1.6);
    scene.add(this.light);
    this.lightI = 0;
  }

  clear() {
    for (const p of this.pieces) this.scene.remove(p.group);
    for (const p of this.pilots) { this.scene.remove(p.mesh.group); p.mesh.group.traverse((o) => o.geometry && o.geometry.dispose()); }
    for (const b of this.builds) b.dispose();
    for (const g of this.geos) g.dispose();
    this.pieces.length = 0; this.pilots.length = 0; this.columns.length = 0; this.events.length = 0; this.builds.length = 0; this.geos.length = 0;
    this.lightI = 0; this.light.intensity = 0;
  }

  flash(pos, power = 1) {
    this.light.position.copy(pos);
    this.lightI = Math.max(this.lightI * 0.5, 2.6e5 * power);
    this.light.intensity = this.lightI;
    this.hooks.shake?.(pos, power);
  }

  // Make a wreck piece from some of the jet's meshes. `bodyPos/bodyQuat` is where the whole
  // airframe is; the piece rotates about the centre of its own meshes.
  makePiece(meshes, name, bodyPos, bodyQuat, vel, omega) {
    const box = new THREE.Box3();
    for (const m of meshes) { m.geometry.computeBoundingBox(); box.union(m.geometry.boundingBox); }
    const pivot = box.getCenter(new THREE.Vector3());
    const radius = Math.max(0.6, box.getSize(_v).length() * 0.3);
    const group = new THREE.Group();
    for (const m of meshes) { m.position.set(-pivot.x, -pivot.y, -pivot.z); m.quaternion.identity(); group.add(m); }
    group.quaternion.copy(bodyQuat);
    group.position.copy(pivot).applyQuaternion(bodyQuat).add(bodyPos);
    this.scene.add(group);
    const p = {
      group, name, pivot, radius, meshes, pos: group.position, quat: group.quaternion,
      vel: vel.clone(), omega: omega.clone(), kd: KD[name] ?? 0.012, big: BIG.has(name),
      fire: 0, smoke: 0, fireAcc: 0, smokeAcc: 0, landed: false, t: 0, sinking: false,
      parts: new Set(meshes.map((m) => m.userData.part)),
    };
    this.pieces.push(p);
    return p;
  }
  // body frame (where the airframe origin would be) of a piece
  bodyOf(p, outPos) { return outPos.copy(p.pivot).applyQuaternion(p.quat).negate().add(p.pos); }

  // Tear a piece into several. `groups` is a list of [name, [part names]].
  split(p, groups, rand, impulse = 25, spin = 4) {
    const bodyPos = this.bodyOf(p, new THREE.Vector3());
    const bodyQuat = p.quat.clone();
    this.scene.remove(p.group);
    this.pieces.splice(this.pieces.indexOf(p), 1);
    const out = [];
    const taken = new Set();
    for (const [name, parts] of groups) {
      const ms = p.meshes.filter((m) => parts.includes(m.userData.part) && !taken.has(m));
      if (!ms.length) continue;
      for (const m of ms) taken.add(m);
      const v = p.vel.clone().add(_v.set(rand() - 0.5, rand() - 0.3, rand() - 0.5).normalize().multiplyScalar(impulse * (0.4 + rand())));
      const w = p.omega.clone().add(_w.set(rand() - 0.5, rand() - 0.5, rand() - 0.5).multiplyScalar(spin * 2));
      const np = this.makePiece(ms, name, bodyPos, bodyQuat, v, w);
      np.fire = p.fire * (BIG.has(name) ? 1 : 0.4); np.smoke = p.smoke;
      out.push(np);
    }
    // anything not claimed stays with the first group
    const rest = p.meshes.filter((m) => !taken.has(m));
    if (rest.length && out.length) {
      const host = out[0];
      for (const m of rest) { m.position.set(-host.pivot.x, -host.pivot.y, -host.pivot.z); host.group.add(m); host.meshes.push(m); }
    }
    return out;
  }

  fragments(pos, vel, n, rand, speed = 60, burnFrac = 0.35) {
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(FRAGMENT_GEOS[i % FRAGMENT_GEOS.length], fragMat);
      m.scale.setScalar(0.5 + rand() * 0.9);
      m.userData.part = 'frag';
      const v = vel.clone().add(_v.set(rand() - 0.5, rand() - 0.35, rand() - 0.5).normalize().multiplyScalar(speed * (0.3 + rand())));
      const w = _w.set(rand() - 0.5, rand() - 0.5, rand() - 0.5).multiplyScalar(18);
      const p = this.makePiece([m], 'frag', pos, _q.identity(), v, w);
      p.kd = 0.012 + rand() * 0.01; p.radius = 0.4;
      if (rand() < burnFrac) p.fire = 0.8 + rand() * 1.8;
      p.smoke = p.fire + 1;
    }
  }

  // ------------------------------------------------------------------
  // cause: 'msl' | 'gun' | 'bounds' | 'crash'.  Returns a handle the death camera can follow.
  spawn({ type, pos, vel, quat, cause, seed, scheme }) {
    const rand = mulberry32(seed >>> 0);
    const build = buildJet(type, { scorch: cause === 'gun' || cause === 'bounds' ? 0.25 : 0.6 });
    this.builds.push(build);
    const meshes = [];
    build.group.traverse((o) => { if (o.isMesh) meshes.push(o); });
    for (const m of meshes) this.geos.push(m.geometry);
    build.group.updateMatrixWorld(true);
    const ground = groundHeight(pos.x, pos.z);
    const handle = { main: null, pilot: null, t: 0, cause, ejectAt: -1, ejected: false, build, cockpit: build.cockpit, pos: pos.clone(), lastFocus: pos.clone() };

    const whole = this.makePiece(meshes, 'whole', pos, quat, vel, _w.set(0, 0, 0));
    handle.main = whole;

    if (cause === 'crash' || pos.y - ground < 25) {
      // flew into the ground: the airframe disintegrates on impact
      this.groundImpact(whole, rand, true);
      handle.main = this.pieces.find((p) => p.name === 'core') || this.pieces[this.pieces.length - 1];
      return this.track(handle);
    }

    if (cause === 'msl') {
      this.fx.fireball(pos, vel, 1.15);
      this.flash(pos, 1.3);
      const parts = this.breakupGroups(rand, true);
      const pieces = this.split(whole, parts, rand, 30, 5);
      for (const p of pieces) {
        p.fire = BIG.has(p.name) ? 9 + rand() * 8 : p.name.startsWith('wing') ? 2 + rand() * 4 : rand() < 0.5 ? 1 + rand() * 2 : 0;
        p.smoke = p.fire + (BIG.has(p.name) ? 6 : 2);
      }
      this.fragments(pos, vel, 14 + Math.floor(rand() * 8), rand, 70);
      handle.main = pieces.find((p) => p.name === 'core') || pieces[0];
      // the cockpit section survives about two times in three; the pilot gets out
      const cockpitPiece = pieces.find((p) => p.parts.has('canopy'));
      if (cockpitPiece && rand() < 0.68) { handle.ejectAt = 0.35 + rand() * 0.5; handle.ejectFrom = cockpitPiece; }
    } else {
      // cannon kill: on fire and out of control, but still in one piece
      this.fx.explosion(pos, vel, false);
      this.flash(pos, 0.5);
      whole.fire = 30; whole.smoke = 40;
      whole.kd = KD.whole;
      whole.spin = (rand() < 0.5 ? -1 : 1) * (0.6 + rand() * 1.4);   // roll rate it settles into
      whole.dive = 0.15 + rand() * 0.3;
      whole.spiral = true;
      if (rand() < 0.45) handle.blowAt = 2.2 + rand() * 3.5;        // fuel tank lets go in the air
      if (rand() < 0.93) { handle.ejectAt = 0.8 + rand() * 1.0; handle.ejectFrom = whole; }
      this.fragments(pos, vel, 5, rand, 30, 0.2);
    }
    handle.rand = rand;
    return this.track(handle);
  }
  track(h) { this.events.push(h); return h; }

  // Which sections come off in a break-up (seeded).
  breakupGroups(rand) {
    const core = ['core', 'flame', 'store'];
    const groups = [];
    const keepNose = rand() < 0.3, wingStays = rand() < 0.4 ? (rand() < 0.5 ? 'wingR' : 'wingL') : null;
    const finStays = rand() < 0.4, stabStays = rand() < 0.45;
    if (keepNose) core.push('nose', 'canopy');
    if (wingStays) core.push(wingStays);
    if (finStays) core.push('fin', 'finR');
    if (stabStays) core.push('stabR', 'stabL');
    groups.push(['core', core]);
    if (!keepNose) groups.push(['nose', ['nose', 'canopy']]);
    for (const w of ['wingR', 'wingL']) if (w !== wingStays) groups.push([w, [w]]);
    if (!finStays) { groups.push(['fin', ['fin']]); groups.push(['finR', ['finR']]); }
    groups.push(['finL', ['finL']]);
    if (!stabStays) { groups.push(['stabR', ['stabR']]); groups.push(['stabL', ['stabL']]); }
    return groups;
  }

  // Wreckage meets the ground (or the sea).
  groundImpact(p, rand, disintegrate = false) {
    const gh = groundHeight(p.pos.x, p.pos.z);
    const sea = terrainHeight(p.pos.x, p.pos.z) <= 0.5;
    const site = _p.set(p.pos.x, gh, p.pos.z);
    const speed = p.vel.length();
    const big = p.big || p.name === 'nose';
    if (sea) {
      this.fx.splash(site, big ? 1.6 : p.name === 'frag' ? 0.25 : 0.7);
      this.hooks.splash?.(site, big);
      if (big) this.fx.explosion(site, _v.set(0, 0, 0), false);
    } else if (big) {
      this.fx.fireball(site, _v.copy(p.vel).multiplyScalar(0.25).setY(Math.abs(p.vel.y) * 0.1 + 20), p.name === 'whole' ? 1.3 : 0.9);
      this.fx.dust(site, 2.2);
      this.flash(site, p.name === 'whole' ? 1.4 : 0.9);
      this.hooks.boom?.(site, true);
      this.columns.push({ pos: site.clone(), t: 0, life: 30 + rand() * 12 });
    } else if (p.name !== 'frag') {
      this.fx.dust(site, 0.8);
      if (p.fire > 0) this.fx.explosion(site, _v.set(0, 5, 0), false);
      if (speed > 40) this.hooks.boom?.(site, false);
    } else if (rand() < 0.4) this.fx.dust(site, 0.25);

    if (disintegrate && p.name === 'whole' && !sea) {
      // break into sections thrown along the ground track
      const fwd = _f.copy(p.vel).setY(0);
      const hs = fwd.length(); fwd.normalize();
      p.vel.set(fwd.x * hs * 0.35, 18 + rand() * 20, fwd.z * hs * 0.35);
      p.pos.y = gh + 2;
      const pieces = this.split(p, this.breakupGroups(rand), rand, 28, 6);
      for (const q of pieces) { q.fire = BIG.has(q.name) ? 25 : 4 + rand() * 6; q.smoke = q.fire + 10; q.bounced = true; }
      this.fragments(site.clone().setY(gh + 2), p.vel, 16, rand, 45, 0.5);
      return;
    }
    if (sea) { p.sinking = true; p.landed = true; p.vel.set(0, -1.5, 0); p.omega.multiplyScalar(0.1); p.fire = 0; p.smoke = Math.min(p.smoke, 2); return; }
    // come to rest (burning)
    p.landed = true;
    p.pos.y = gh + p.radius * 0.35;
    p.vel.set(0, 0, 0); p.omega.set(0, 0, 0);
    if (p.fire > 0) { p.fire = Math.max(p.fire, big ? 25 : 6); p.smoke = p.fire + 8; }
  }

  // ------------------------------------------------------------------
  eject(h) {
    const host = h.ejectFrom;
    if (!host || !this.pieces.includes(host)) return;
    const rand = h.rand;
    const bodyPos = this.bodyOf(host, new THREE.Vector3());
    const up = _up.set(0, 1, 0).applyQuaternion(host.quat);
    // canopy jettison: it separates from whatever piece the cockpit is in
    const canopyMeshes = host.meshes.filter((m) => m.userData.part === 'canopy');
    if (canopyMeshes.length) {
      host.meshes = host.meshes.filter((m) => m.userData.part !== 'canopy');
      for (const m of canopyMeshes) host.group.remove(m);
      const c = this.makePiece(canopyMeshes, 'canopy', bodyPos, host.quat, host.vel.clone().addScaledVector(up, 14), _w.set(rand() * 4 - 2, 0, rand() * 6 - 3));
      c.smoke = 0;
      host.parts.delete('canopy');
    }
    this.hooks.eject?.(bodyPos);
    // seat leaves 0.2 s later
    const seatPos = new THREE.Vector3(...h.cockpit).applyQuaternion(host.quat).add(bodyPos);
    const mesh = buildPilot();
    mesh.group.position.copy(seatPos); mesh.group.quaternion.copy(host.quat);
    this.scene.add(mesh.group);
    const pilot = {
      mesh, pos: mesh.group.position, quat: mesh.group.quaternion,
      vel: host.vel.clone().addScaledVector(up, 6), up: up.clone(), t: -0.2, state: 'wait', chuteK: 0, sway: rand() * 6, landed: false,
    };
    mesh.group.visible = false;
    this.pilots.push(pilot);
    h.pilot = pilot;
  }

  // ------------------------------------------------------------------
  update(dt) {
    const fx = this.fx;
    if (this.lightI > 1) { this.lightI *= Math.exp(-dt * 5.5); this.light.intensity = this.lightI; } else this.light.intensity = 0;

    // scheduled events per wreck
    for (const h of this.events) {
      h.t += dt;
      if (h.ejectAt >= 0 && !h.ejected && h.t >= h.ejectAt) { h.ejected = true; this.eject(h); }
      if (h.blowAt && h.t >= h.blowAt && this.pieces.includes(h.main) && !h.main.landed) {
        const p = h.main;
        h.blowAt = 0;
        this.fx.fireball(p.pos, p.vel, 0.9);
        this.flash(p.pos, 1.0);
        this.hooks.boom?.(p.pos, true);
        const pieces = this.split(p, this.breakupGroups(h.rand), h.rand, 26, 5);
        for (const q of pieces) { q.fire = BIG.has(q.name) ? 12 : 2 + h.rand() * 3; q.smoke = q.fire + 5; }
        this.fragments(p.pos, p.vel, 10, h.rand, 55);
        h.main = pieces.find((q) => q.name === 'core') || pieces[0];
      }
      if (h.main && h.main.landed && !h.mainLandedT) h.mainLandedT = h.t;
    }

    // wreckage
    for (let i = this.pieces.length - 1; i >= 0; i--) {
      const p = this.pieces[i];
      p.t += dt;
      if (!p.landed) {
        const sp = p.vel.length();
        const rho = airDensity(p.pos.y) / 1.225;
        // drag toward the wind, gravity
        _v.copy(p.vel).sub(WIND);
        const dv = _v.length();
        p.vel.addScaledVector(_v, -p.kd * rho * dv * dt);
        p.vel.y -= GRAV * dt;
        if (p.spiral) {
          // burning, uncontrolled jet: the nose follows the airflow while it rolls and drops
          const vh = _f.copy(p.vel).normalize();
          const fwd = _v.set(0, 0, -1).applyQuaternion(p.quat);
          _q.setFromUnitVectors(fwd, vh);
          p.quat.premultiply(_q.slerp(new THREE.Quaternion(), 1 - Math.min(1, dt * 2.5))).normalize();
          const rollRate = p.spin * Math.min(1, p.t / 1.5);
          _q.setFromAxisAngle(vh, rollRate * dt); p.quat.premultiply(_q);
          // lift is gone: the path curves down faster than a clean ballistic arc
          p.vel.y -= p.dive * GRAV * dt;
        } else {
          const w = p.omega.length();
          if (w > 1e-4) { _q.setFromAxisAngle(_w.copy(p.omega).divideScalar(w), w * dt); p.quat.premultiply(_q).normalize(); }
          p.omega.multiplyScalar(Math.exp(-dt * 0.15));
        }
        p.pos.addScaledVector(p.vel, dt);
        if (p.pos.y - p.radius * 0.3 < groundHeight(p.pos.x, p.pos.z)) {
          const rand = Math.random;
          this.groundImpact(p, rand, p.name === 'whole');
          if (!this.pieces.includes(p)) continue;
        }
        void sp;
      } else if (p.sinking) {
        p.pos.y -= 1.2 * dt;
        if (p.pos.y < groundHeight(p.pos.x, p.pos.z) - 12) { this.scene.remove(p.group); this.pieces.splice(i, 1); continue; }
      }
      // fire and smoke trails
      if (p.fire > 0) {
        p.fire -= dt;
        p.fireAcc += dt * (p.big ? 55 : p.name === 'frag' ? 18 : 28);
        while (p.fireAcc >= 1) { p.fireAcc -= 1; fx.wreckFire(p.pos, p.vel, p.big || p.name === 'nose', p.landed ? 0.7 : 1); }
      }
      if (p.smoke > 0) {
        p.smoke -= dt;
        p.smokeAcc += dt * (p.big ? 26 : p.name === 'frag' ? 8 : 14) * (p.landed ? 0.5 : 1);
        while (p.smokeAcc >= 1) { p.smokeAcc -= 1; fx.wreckSmoke(p.pos, p.vel, p.big || p.name === 'nose', p.fire > 0 ? 1 : 0.4); }
      }
      // small debris disappears after a while
      if (p.name === 'frag' && p.landed && p.t > 20) { this.scene.remove(p.group); this.pieces.splice(i, 1); }
    }

    // smoke columns at crash sites
    for (let i = this.columns.length - 1; i >= 0; i--) {
      const c = this.columns[i];
      c.t += dt; c.acc = (c.acc || 0) + dt * 10;
      while (c.acc >= 1) { c.acc -= 1; fx.smokeColumn(c.pos, c.t, c.life); }
      if (c.t > c.life) this.columns.splice(i, 1);
    }

    // pilots
    for (const pl of this.pilots) this.updatePilot(pl, dt);
  }

  updatePilot(pl, dt) {
    const fx = this.fx, g = pl.mesh.group;
    pl.t += dt;
    if (pl.state === 'wait') {
      if (pl.t < 0) return;
      // seat rocket fires: ~15 G up the rails, then the rocket burns for a moment
      pl.state = 'seat'; g.visible = true;
      pl.vel.addScaledVector(pl.up, 48);
      this.hooks.seat?.(pl.pos);
    }
    const ground = groundHeight(pl.pos.x, pl.pos.z);
    if (pl.state === 'seat') {
      if (pl.t < 0.4) { _v.copy(pl.up).negate(); for (let i = 0; i < 3; i++) fx.seatRocket(pl.pos, pl.vel, _v); }
      const rho = airDensity(pl.pos.y) / 1.225;
      _v.copy(pl.vel).sub(WIND); const dv = _v.length();
      pl.vel.addScaledVector(_v, -0.0035 * rho * dv * dt);
      pl.vel.y -= GRAV * dt;
      // the drogue stabilises the seat, so it tumbles only a little
      _q.setFromAxisAngle(_w.set(1, 0, 0), Math.sin(pl.t * 5 + pl.sway) * dt * 1.2); pl.quat.multiply(_q);
      if (pl.t > 1.7 || (pl.pos.y - ground < 250 && pl.t > 0.6)) {
        // seat separation and main chute
        pl.state = 'chute';
        pl.mesh.seat.visible = false;
        const seatMesh = new THREE.Mesh(FRAGMENT_GEOS[3], fragMat); seatMesh.userData.part = 'frag';
        const s = this.makePiece([seatMesh], 'frag', pl.pos, pl.quat, pl.vel.clone().add(_v.set(0, -3, 0)), _w.set(2, 1, 3));
        s.kd = 0.003;
        pl.mesh.chute.visible = true; pl.mesh.chute.scale.setScalar(0.05);
        this.hooks.chute?.(pl.pos);
      }
    } else if (pl.state === 'chute') {
      pl.chuteK = Math.min(1, pl.chuteK + dt / 0.9);
      const k = pl.chuteK;
      pl.mesh.chute.scale.set(0.15 + 0.85 * k, 0.3 + 0.7 * k * k, 0.15 + 0.85 * k);
      // canopy drag: settle to ~6 m/s down, drifting with the wind
      const target = _v.copy(WIND).setY(-6);
      pl.vel.lerp(target, 1 - Math.exp(-dt * (0.6 + 2.2 * k)));
      // hang under the canopy, swinging gently
      const yaw = Math.atan2(-pl.vel.x, -pl.vel.z);
      _q.setFromEuler(new THREE.Euler(Math.sin(pl.t * 1.3 + pl.sway) * 0.12 * k, yaw, Math.sin(pl.t * 0.9) * 0.1 * k, 'YXZ'));
      pl.quat.slerp(_q, 1 - Math.exp(-dt * 3));
      if (pl.pos.y - ground < 0.9) {
        pl.state = 'landed'; pl.landT = pl.t;
        pl.sea = terrainHeight(pl.pos.x, pl.pos.z) <= 0.5;
        if (pl.sea) fx.splash(pl.pos, 0.15); else fx.dust(pl.pos, 0.2);
      }
    } else if (pl.state === 'landed') {
      pl.vel.set(0, 0, 0);
      pl.pos.y = ground + (pl.sea ? 0.2 : 0.75);
      const k = Math.min(1, (pl.t - pl.landT) / 2.5);
      pl.mesh.chute.rotation.z = k * 1.35; pl.mesh.chute.position.set(k * 3.5, -k * 2.0, 0);
      pl.mesh.chute.scale.y = Math.max(0.12, 1 - k * 0.85);
      return;
    }
    pl.pos.addScaledVector(pl.vel, dt);
  }
}
