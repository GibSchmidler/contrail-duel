// Gun, missiles (IR and active radar), flares, chaff and hit detection.
import * as THREE from 'three';
import { GRAV, airDensity, bulletDragK } from './flight.js';
import { buildMissileMesh } from './models.js';
import { groundHeight, lineOfSight } from './world.js';
import { WEAPONS, WEAPON_BY_CODE, GUNS, ramjetFactor } from './arsenal.js';
import { inNotch, notchFactor, detectRange } from './sensors.js';

const MAX_BULLETS = 1400;

// Hitbox capsules in body coordinates (forward = -Z)
const HITBOX = [
  { a: new THREE.Vector3(0, 0, -8.4), b: new THREE.Vector3(0, 0, 7.6), r: 1.35 },
  { a: new THREE.Vector3(-5.3, 0, 3.0), b: new THREE.Vector3(5.3, 0, 3.0), r: 0.9 },
  { a: new THREE.Vector3(-2.5, 0, 0.4), b: new THREE.Vector3(2.5, 0, 0.4), r: 1.3 },
  { a: new THREE.Vector3(0, 0.8, 6.0), b: new THREE.Vector3(0, 4.3, 7.4), r: 0.75 },
  { a: new THREE.Vector3(-3, 0, 7.2), b: new THREE.Vector3(3, 0, 7.2), r: 0.6 },
];

// squared distance between segments p1q1 and p2q2
const _d1 = new THREE.Vector3(), _d2 = new THREE.Vector3(), _r = new THREE.Vector3(), _c1 = new THREE.Vector3(), _c2 = new THREE.Vector3();
function segSegDist2(p1, q1, p2, q2) {
  _d1.subVectors(q1, p1); _d2.subVectors(q2, p2); _r.subVectors(p1, p2);
  const a = _d1.dot(_d1), e = _d2.dot(_d2), f = _d2.dot(_r);
  let s, t;
  if (a <= 1e-9 && e <= 1e-9) return _r.lengthSq();
  if (a <= 1e-9) { s = 0; t = Math.min(1, Math.max(0, f / e)); }
  else {
    const c = _d1.dot(_r);
    if (e <= 1e-9) { t = 0; s = Math.min(1, Math.max(0, -c / a)); }
    else {
      const b = _d1.dot(_d2), den = a * e - b * b;
      s = den !== 0 ? Math.min(1, Math.max(0, (b * f - c * e) / den)) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = Math.min(1, Math.max(0, -c / a)); }
      else if (t > 1) { t = 1; s = Math.min(1, Math.max(0, (b - c) / a)); }
    }
  }
  _c1.copy(p1).addScaledVector(_d1, s); _c2.copy(p2).addScaledVector(_d2, t);
  return _c1.distanceToSquared(_c2);
}

// distance from origin to segment ab, plus parameter
function pointSegDist(a, b, out) {
  _d1.subVectors(b, a);
  const l2 = _d1.lengthSq();
  let t = l2 > 0 ? -a.dot(_d1) / l2 : 0;
  t = Math.min(1, Math.max(0, t));
  out.t = t;
  return _c1.copy(a).addScaledVector(_d1, t).length();
}

// Ground units are upright cylinders (radius r, height h) standing at u.pos.
const _ua = new THREE.Vector3(), _ub = new THREE.Vector3();
function hitsUnit(p0, p1, u, extra = 0) {
  const base = u.base != null ? u.base : u.pos.y;
  // sample the segment: units are big and bullets short, so a few points are plenty
  for (let i = 0; i <= 3; i++) {
    const t = i / 3;
    const x = p0.x + (p1.x - p0.x) * t, y = p0.y + (p1.y - p0.y) * t, z = p0.z + (p1.z - p0.z) * t;
    if (y < base - 1 || y > base + u.h + extra) continue;
    if (u.box) {
      // ships: an oriented box (length along the heading)
      const dx = x - u.pos.x, dz = z - u.pos.z, c = Math.cos(u.hdgR), s = Math.sin(u.hdgR);
      const along = dx * s - dz * c, across = dx * c + dz * s;
      if (Math.abs(along) < u.box[0] / 2 + extra && Math.abs(across) < u.box[1] / 2 + extra) return true;
    } else if ((x - u.pos.x) ** 2 + (z - u.pos.z) ** 2 < (u.r + extra) ** 2) return true;
  }
  return false;
}
export { hitsUnit };

const _iq = new THREE.Quaternion(), _l0 = new THREE.Vector3(), _l1 = new THREE.Vector3();
// Segment from (bullet0 - target0) to (bullet1 - target1), tested in target body frame.
// `size` scales the capsules: a Flanker is a much bigger target than a Gripen.
function hitsAircraft(rel0, rel1, quat, size = 1) {
  _iq.copy(quat).invert();
  _l0.copy(rel0).applyQuaternion(_iq).divideScalar(size);
  _l1.copy(rel1).applyQuaternion(_iq).divideScalar(size);
  // coarse reject
  if (Math.min(_l0.lengthSq(), _l1.lengthSq()) > 400 && segSegDist2(_l0, _l1, HITBOX[0].a, HITBOX[0].b) > 64) return false;
  for (let i = 0; i < HITBOX.length; i++) {
    const h = HITBOX[i], rr = h.r + 0.25;
    if (segSegDist2(_l0, _l1, h.a, h.b) < rr * rr) return zoneAt(i, _c2);
  }
  return null;
}
// Which system a hit at body point p (on capsule i) damages.
function zoneAt(i, p) {
  if (i === 0) return p.z < -4.5 ? 'radar' : p.z > 3.2 ? 'eng' : 'fuel';
  if (i === 1 || i === 2) return Math.abs(p.x) < 1.3 ? 'fuel' : p.x > 0 ? 'wingR' : 'wingL';
  return 'tail';
}
// A blast near the jet: the zone facing the explosion takes the brunt.
const _bz = new THREE.Vector3();
export function blastZone(target, pos) {
  _bz.copy(pos).sub(target.pos).applyQuaternion(_iq.copy(target.quat).invert());
  if (Math.abs(_bz.x) > Math.abs(_bz.z) * 0.8) return _bz.x > 0 ? 'wingR' : 'wingL';
  if (_bz.z > 2) return Math.abs(_bz.y) > 2 ? 'tail' : 'eng';
  if (_bz.z < -4) return 'radar';
  return 'fuel';
}

// ------------------------------------------------------------------
const _tmp = new THREE.Vector3(), _tmp2 = new THREE.Vector3(), _los = new THREE.Vector3(), _vr = new THREE.Vector3(), _om = new THREE.Vector3();
const _acmd = new THREE.Vector3(), _mq = new THREE.Quaternion(), _fz = new THREE.Vector3(0, 0, -1), _aim = new THREE.Vector3(), _mp = new THREE.Vector3();
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) * 2; // ~N(0,1)

export class Combat {
  // hooks: onDamage(target, dmg, kind, shooter, pos), onMissileGone(missile, exploded, pos)
  constructor(scene, effects, audio, hooks) {
    this.scene = scene; this.effects = effects; this.audio = audio; this.hooks = hooks;
    this.bullets = [];
    this.missiles = [];         // locally simulated
    this.remoteMissiles = new Map();
    this.flares = [];
    this.chaff = [];
    this.popId = 1;
    this.missileSeq = 1;
    this.meshPool = {};
    this.units = [];            // ground units and ships that bullets, bombs and missiles can hit

    // tracer rendering
    this.tracerPos = new Float32Array(MAX_BULLETS * 6);
    this.tracerCol = new Float32Array(MAX_BULLETS * 6);
    const geo = new THREE.BufferGeometry();
    this.tracerAttr = new THREE.BufferAttribute(this.tracerPos, 3).setUsage(THREE.DynamicDrawUsage);
    this.tracerColAttr = new THREE.BufferAttribute(this.tracerCol, 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.tracerAttr);
    geo.setAttribute('color', this.tracerColAttr);
    this.tracerGeo = geo;
    const mat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
    this.tracers = new THREE.LineSegments(geo, mat);
    this.tracers.frustumCulled = false;
    scene.add(this.tracers);
  }

  clear() {
    this.bullets.length = 0;
    for (const m of this.missiles) this.releaseMesh(m.mesh);
    for (const m of this.remoteMissiles.values()) this.releaseMesh(m.mesh);
    this.missiles.length = 0; this.remoteMissiles.clear(); this.flares.length = 0; this.chaff.length = 0;
  }

  getMesh(key) {
    if (WEAPONS[key] && WEAPONS[key].cls === 'rkt') key = 'rocket';   // the pod stays on the jet; a rocket flies
    const pool = this.meshPool[key] || (this.meshPool[key] = []);
    const m = pool.pop() || buildMissileMesh(key);
    m.userData.key = key;
    m.visible = true; this.scene.add(m);
    return m;
  }
  releaseMesh(m) { if (!m) return; this.scene.remove(m); (this.meshPool[m.userData.key] || (this.meshPool[m.userData.key] = [])).push(m); }

  // live = this client performs hit detection for this bullet
  fireBullet(plane, live, frac = 0) {
    if (this.bullets.length >= MAX_BULLETS) this.bullets.shift();
    const gun = plane.gunT || GUNS.m61;
    const dir = _tmp.copy(plane.fwd)
      .addScaledVector(plane.right, gauss() * gun.sigma)
      .addScaledVector(plane.up, gauss() * gun.sigma).normalize();
    const gp = this.gunMuzzle(plane);
    const p = gp.clone();
    const v = plane.vel.clone().addScaledVector(dir, gun.muzzle);
    p.addScaledVector(v, frac);
    // heavier 30 mm rounds get a tracer every round or two; the M61 every other round
    this.bullets.push({ p, v, prev: p.clone(), t: 0, owner: plane, live, gun, tracer: Math.random() < (gun.rate > 60 ? 0.5 : 0.8), big: gun.damage > 10 });
  }
  gunMuzzle(plane, out = new THREE.Vector3()) {
    const g = (plane.T && plane.T.gunPos) || [-0.7, 0.35, -7];
    return out.copy(plane.pos).addScaledVector(plane.right, g[0]).addScaledVector(plane.up, g[1]).addScaledVector(plane.fwd, -g[2] + 0.5);
  }

  launchMissile(plane, target, key, station = 0) {
    const w = WEAPONS[key];
    const mount = (plane.T && plane.T.stations[station]) || [0, -1.2, 0, 'body'];
    const drop = w.ag ? (mount[3] === 'bay' ? -8 : -1.5) : mount[3] === 'bay' ? -14 : w.cls === 'mrm' ? -9 : -3;   // bay launchers kick the missile clear first
    const m = {
      id: (plane.netId || 'L') + '-' + this.missileSeq++, key, w,
      owner: plane, target, decoy: null, seen: new Set(),
      pos: plane.pos.clone().addScaledVector(plane.right, mount[0]).addScaledVector(plane.up, mount[1] - 0.4).addScaledVector(plane.fwd, -mount[2]),
      vel: plane.vel.clone().addScaledVector(plane.fwd, mount[3] === 'bay' ? 4 : 12).addScaledVector(plane.up, drop),
      prev: new THREE.Vector3(), t: 0, lost: false, lostT: 0, mesh: this.getMesh(key), burning: true,
      phase: 'ir', est: new THREE.Vector3(), estVel: new THREE.Vector3(), mem: 0, minDist: 1e9,
    };
    if (w.cls === 'rkt') {
      // rockets leave the pod along the boresight with a little dispersion
      const sp = w.spread || 0.004;
      m.vel.copy(plane.vel).addScaledVector(_tmp.copy(plane.fwd).addScaledVector(plane.right, gauss() * sp).addScaledVector(plane.up, gauss() * sp).normalize(), 40);
      m.pos.copy(plane.pos).addScaledVector(plane.right, mount[0]).addScaledVector(plane.up, mount[1] - 0.3).addScaledVector(plane.fwd, 2);
    }
    if (w.ag) {
      // the aim point: the designated target, or (bombs without one) wherever they fall
      if (target) { m.est.copy(target.pos); m.estVel.copy(target.vel || _tmp.set(0, 0, 0)); }
      else if (m.aimPoint) m.est.copy(m.aimPoint);
      m.phase = 'none';
    }
    if (w.guidance === 'radar' || w.guidance === 'sarh') {
      const R = plane.radar;
      m.phase = w.guidance === 'sarh' ? 'sarh' : R && R.stt ? 'dl' : 'inertial';
      if (R && R.contact) { m.est.copy(R.pos); m.estVel.copy(R.vel); }
      else { m.est.copy(plane.pos).addScaledVector(plane.fwd, 15000); m.estVel.set(0, 0, 0); } // "maddog": seeker searches straight ahead
    }
    if (mount[3] === 'bay') plane.bayUntil = performance.now() + 1600;   // bay doors open: the RCS spikes briefly
    m.prev.copy(m.pos);
    this.missiles.push(m);
    return m;
  }

  popFlares(plane, popId = this.popId++) {
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      const v = plane.vel.clone().multiplyScalar(0.75)
        .addScaledVector(plane.up, -18 - Math.random() * 6)
        .addScaledVector(plane.right, side * (10 + Math.random() * 6));
      this.addFlare(plane.pos.clone().addScaledVector(plane.fwd, 4), v, popId, plane);
    }
    return popId;
  }
  addFlare(p, v, popId, owner) { this.flares.push({ pos: p, vel: v, t: 0, popId, owner }); }

  // Chaff: a bloom of foil that stops dead in the air (so it has ~zero Doppler).
  popChaff(plane, popId = this.popId++) {
    const v = plane.vel.clone().multiplyScalar(0.35).addScaledVector(plane.up, -6 + Math.random() * 3).addScaledVector(plane.right, (Math.random() - 0.5) * 12);
    this.addChaff(plane.pos.clone().addScaledVector(plane.fwd, 3), v, popId, plane);
    return popId;
  }
  addChaff(p, v, popId, owner) { this.chaff.push({ pos: p, vel: v, t: 0, popId, owner }); }

  // Remote missile puppets (data from network): [id, x, y, z, vx, vy, vz, code, flags, targetSlot].
  // `src` is the aircraft slot that fired them; `resolve(slot)` maps a slot to its aircraft.
  syncRemoteMissiles(list, now, src, resolve) {
    const seen = new Set();
    for (const [id, x, y, z, vx, vy, vz, code, flags = 1, tsl = -1] of list) {
      seen.add(id);
      let m = this.remoteMissiles.get(id);
      if (!m) {
        const key = WEAPON_BY_CODE[code] || 'aim9x';
        m = { id, key, src, guidance: WEAPONS[key].guidance, pos: new THREE.Vector3(x, y, z), vel: new THREE.Vector3(), mesh: this.getMesh(key), t: 0, remote: true, snapPos: new THREE.Vector3(), snapT: now };
        this.remoteMissiles.set(id, m);
        const o = resolve ? resolve(src) : null;
        if (o && o.T && o.T.stealth) o.bayUntil = performance.now() + 1600;
      }
      m.snapPos.set(x, y, z); m.vel.set(vx, vy, vz); m.snapT = now;
      m.burning = !!(flags & 1);
      m.phase = flags & 2 ? 'active' : flags & 4 ? 'dl' : 'none';
      m.owner = resolve ? resolve(src) : null;
      m.target = resolve && tsl >= 0 ? resolve(tsl) : null;
    }
    for (const [id, m] of this.remoteMissiles) {
      if (m.src === src && !seen.has(id)) { this.releaseMesh(m.mesh); this.remoteMissiles.delete(id); }
    }
  }

  removeRemoteMissile(id, pos) {
    const m = this.remoteMissiles.get(id);
    if (m) { this.releaseMesh(m.mesh); this.remoteMissiles.delete(id); }
    if (pos) { this.effects.explosion(pos, _tmp.set(0, 0, 0), false); this.audio?.explosion(pos, false); }
  }

  static flags(m) {
    return (m.burning ? 1 : 0) | (m.phase === 'active' && !m.decoy && !m.lost ? 2 : 0) | (m.phase === 'dl' || m.phase === 'sarh' ? 4 : 0);
  }

  update(dt, planes, now, oneWayMs = 0) {
    const fx = this.effects;
    // ---- bullets: drag + gravity ----
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.prev.copy(b.p);
      const sp = b.v.length();
      b.v.multiplyScalar(1 / (1 + bulletDragK(b.p.y, b.gun) * sp * dt));
      b.v.y -= GRAV * dt;
      b.p.addScaledVector(b.v, dt);
      b.t += dt;
      let dead = b.t > 3.5;
      if (!dead && b.p.y < 2500 && b.p.y < groundHeight(b.p.x, b.p.z)) {
        dead = true;
        if (b.live || Math.random() < 0.3) fx.smoke.emit(b.p.x, groundHeight(b.p.x, b.p.z) + 1, b.p.z, 0, 4, 0, 1.2, 2, 6, [0.6, 0.55, 0.5], [0.6, 0.55, 0.5], 0.5, 1, 0);
      }
      if (!dead && b.live) {
        for (const pl of planes) {
          if (pl === b.owner || !pl.alive) continue;
          const r0 = _tmp.copy(b.prev).sub(pl.prevPos);
          if (r0.lengthSq() > 250000) continue; // > 500 m away
          const r1 = _tmp2.copy(b.p).sub(pl.pos);
          const zone = hitsAircraft(r0, r1, pl.quat, pl.T ? pl.T.size : 1);
          if (zone) {
            dead = true;
            fx.spark(b.p, pl.vel);
            if (b.big) fx.spark(b.p, pl.vel);
            this.hooks.onDamage(pl, b.gun.damage, 'gun', b.owner, b.p, zone);
            break;
          }
        }
      }
      if (!dead && b.live && this.units.length) {
        for (const u of this.units) {
          if (!u.alive || u === b.owner || u.side === (b.owner && b.owner.side)) continue;
          if (Math.abs(b.p.x - u.pos.x) > u.r + 40 || Math.abs(b.p.z - u.pos.z) > u.r + 40) continue;
          if (hitsUnit(b.prev, b.p, u)) {
            dead = true;
            fx.spark(b.p, _tmp.set(0, 0, 0));
            this.hooks.onDamage(u, b.gun.damage * (u.armor != null ? 1 - u.armor : 1), 'gun', b.owner, b.p);
            break;
          }
        }
      }
      if (dead) this.bullets.splice(i, 1);
    }

    // ---- flares ----
    for (let i = this.flares.length - 1; i >= 0; i--) {
      const f = this.flares[i];
      f.t += dt;
      f.vel.multiplyScalar(Math.exp(-1.2 * dt));
      f.vel.y -= GRAV * 0.6 * dt;
      f.pos.addScaledVector(f.vel, dt);
      fx.flare(f.pos);
      if (f.t > 3.5 || f.pos.y < groundHeight(f.pos.x, f.pos.z)) this.flares.splice(i, 1);
    }
    // ---- chaff ----
    for (let i = this.chaff.length - 1; i >= 0; i--) {
      const c = this.chaff[i];
      c.t += dt;
      c.vel.multiplyScalar(Math.exp(-4 * dt));
      c.vel.y = Math.max(c.vel.y - 3 * dt, -2.5);
      c.pos.addScaledVector(c.vel, dt);
      if (c.t < 1.2) fx.chaff(c.pos, c.t);
      if (c.t > 6) this.chaff.splice(i, 1);
    }

    // ---- local missiles ----
    for (let i = this.missiles.length - 1; i >= 0; i--) {
      const m = this.missiles[i];
      const res = this.stepMissile(m, dt);
      if (res) {
        this.missiles.splice(i, 1);
        this.releaseMesh(m.mesh);
        this.hooks.onMissileGone(m, res.exploded, res.pos);
      }
    }

    // ---- remote missile puppets ----
    for (const m of this.remoteMissiles.values()) {
      const age = Math.min(0.5, (now - m.snapT + oneWayMs) / 1000);
      const prev = _tmp2.copy(m.pos);
      m.pos.copy(m.snapPos).addScaledVector(m.vel, age);
      m.t += dt;
      this.placeMissileMesh(m);
      const w = WEAPONS[m.key];
      if (m.burning) for (let s = 1; s <= 3; s++) fx.missileTrail(_tmp.copy(prev).lerp(m.pos, s / 3), m.vel, true, m.key, w.ramjet && m.t > w.stages[0][1] ? 0.08 : w.smoke);
    }

    this.updateTracers();
  }

  placeMissileMesh(m) {
    m.mesh.position.copy(m.pos);
    const sp = m.vel.length();
    if (sp > 1) { _mq.setFromUnitVectors(_fz, _tmp.copy(m.vel).divideScalar(sp)); m.mesh.quaternion.copy(_mq); }
  }

  // Active radar seeker: gimbal, range and the Doppler clutter notch.
  seekerSees(m, tgt, w) {
    _tmp2.copy(tgt.pos).sub(m.pos);
    const d = _tmp2.length();
    if (d > detectRange(w.seeker, tgt, w.ccm, m.pos)) return false;   // a stealthy target shrinks the seeker's reach
    const sp = Math.max(m.vel.length(), 1);
    if (_tmp2.dot(m.vel) / (d * sp) < Math.cos(w.gimbal)) return false;
    if (inNotch(m.pos, tgt)) return false;
    return lineOfSight(m.pos, tgt.pos);
  }

  // returns null while flying, or {exploded, pos}
  stepMissile(m, dt) {
    const w = m.w;
    m.t += dt;
    m.prev.copy(m.pos);
    const sp = Math.max(m.vel.length(), 1);
    const vhat = _tmp.copy(m.vel).divideScalar(sp);
    const rho = airDensity(m.pos.y);
    let thrust = 0, tt = m.t, stage = 0;
    for (const [acc, d] of w.stages) { if (tt < d) { thrust = acc; break; } tt -= d; stage++; }
    m.burning = thrust > 0;
    m.stage = stage;
    if (w.ramjet && stage > 0 && thrust > 0) thrust *= ramjetFactor(rho, sp);
    const tgt = m.target;
    let aimPos = null, aimVel = null, loft = 0;

    if (w.guidance === 'ballistic') {
      // ---- iron bombs and rockets: nothing steers them ----
    } else if (w.guidance === 'gbomb') {
      // ---- guided bomb: a laser bomb follows the spot while the shooter can see the target;
      // a GPS bomb goes to the coordinates it was given at release ----
      const o = m.owner;
      if (w.laser && tgt && tgt.alive && o && o.alive && o.pos.distanceTo(tgt.pos) < w.seeker && lineOfSight(o.pos, tgt.pos, -3)) m.est.copy(tgt.pos);
      aimPos = m.est; aimVel = _vr.set(0, 0, 0);
    } else if (w.guidance === 'gnd') {
      // ---- TV / IR / radar guided air-to-ground and anti-ship missiles ----
      if (tgt && tgt.alive && !m.lost) {
        if (lineOfSight(m.pos, tgt.pos, -4)) { m.maskT = 0; m.est.copy(tgt.pos); m.estVel.copy(tgt.vel || _vr.set(0, 0, 0)); }
        else if ((m.maskT = (m.maskT || 0) + dt) > 1.5) m.lost = true;
      } else m.est.addScaledVector(m.estVel, dt);
      aimPos = m.est; aimVel = m.estVel;
      if (w.cls === 'ashm') {
        const hd = Math.hypot(m.est.x - m.pos.x, m.est.z - m.pos.z);
        if (hd > 3500) { aimPos = _aim.set(m.est.x, Math.max(16, groundHeight(m.pos.x, m.pos.z) + 16), m.est.z); }   // sea-skim, pop up at the end
      }
    } else if (w.guidance === 'arm') {
      // ---- anti-radiation: homes on the radar's emissions. If the radar goes quiet it flies to
      // where the emitter last was, with some error (shutting down is the classic defence) ----
      if (tgt && tgt.alive && tgt.radarMode > 0) { m.est.copy(tgt.pos); m.armErr = null; }
      else if (!m.armErr) {
        const far = m.pos.distanceTo(m.est) > 3000;
        m.armErr = new THREE.Vector3((Math.random() - 0.5) * (far ? 70 : 16), 0, (Math.random() - 0.5) * (far ? 70 : 16));
        m.est.add(m.armErr);
      }
      aimPos = m.est; aimVel = _vr.set(0, 0, 0);
      const dEst = m.pos.distanceTo(m.est);
      if (dEst > 12000 && m.t > 1.5) loft = clamp((dEst - 12000) / 18000, 0, 1) * 0.8;
    } else if (w.guidance === 'ir') {
      // ---- infrared: tracks the hottest thing in view; flares can steal it ----
      if (!m.lost) {
        if (m.decoy) {
          if (m.decoy.t > 3.4) m.lost = true;
          else { aimPos = m.decoy.pos; aimVel = m.decoy.vel; }
        } else if (tgt && tgt.alive) {
          aimPos = tgt.pos; aimVel = tgt.vel;
          for (const f of this.flares) {
            if (f.owner !== tgt || m.seen.has(f.popId) || f.t > 0.6) continue;
            m.seen.add(f.popId);
            let chance = 0.5;
            if (tgt.ab) chance *= 0.55;                       // afterburner plume outshines the flare
            if ((tgt.throttle ?? 1) < 0.6) chance *= 1.5;    // engine at idle: the flare is the brightest thing
            const aspect = -tgt.fwd.dot(_los.copy(m.pos).sub(tgt.pos).normalize());
            chance *= 1 - aspect * 0.25;                       // looking up the tailpipe is harder to fool
            chance *= 1 - w.ccm;                               // counter-countermeasures (imaging seeker on the 9X)
            if (Math.random() < Math.min(0.85, chance)) { m.decoy = f; aimPos = f.pos; aimVel = f.vel; break; }
          }
        } else m.lost = true;
      }
      if (aimPos) {
        _los.copy(aimPos).sub(m.pos);
        const d = _los.length();
        if (_los.dot(vhat) / d < Math.cos(w.gimbal) || d > w.seeker * (tgt && tgt.T && !m.decoy ? tgt.T.irSig : 1)) { m.lost = true; aimPos = null; }
        else if (!m.decoy && !lineOfSight(m.pos, aimPos)) {
          // target ducked behind terrain: the seeker coasts briefly, then gives up
          m.maskT = (m.maskT || 0) + dt;
          if (m.maskT > 0.5) { m.lost = true; aimPos = null; }
        } else m.maskT = 0;
      }
    } else if (w.guidance === 'sarh') {
      // ---- semi-active radar (R-27ER): homes on the launching jet's radar energy reflected off
      // the target, so the shooter has to keep its lock (and keep pointing at the target) to impact ----
      const o = m.owner;
      const lit = o && o.alive && o.radar && o.radar.stt && tgt && tgt.alive && lineOfSight(m.pos, tgt.pos);
      if (lit) {
        m.phase = 'sarh'; m.mem = 1.0;
        m.est.copy(tgt.pos); m.estVel.copy(tgt.vel);
        aimPos = tgt.pos; aimVel = tgt.vel;
      } else {
        m.phase = 'none';
        m.mem -= dt; m.est.addScaledVector(m.estVel, dt);
        aimPos = m.est; aimVel = m.estVel;
        if (m.mem < 0) m.lost = true;
      }
      const dEst = m.pos.distanceTo(m.est);
      if (dEst > 12000 && m.t > 1.5) loft = clamp((dEst - 12000) / 14000, 0, 1) * 0.7;
      if (m.lost) aimPos = null;
    } else {
      // ---- active radar (AIM-120 and similar): datalink/inertial midcourse, then its own seeker ----
      if (m.phase === 'active') {
        if (m.decoy) {
          if (m.decoy.t > 4) m.lost = true;
          else { aimPos = m.decoy.pos; aimVel = m.decoy.vel; }
        } else if (tgt && tgt.alive && this.seekerSees(m, tgt, w)) {
          m.est.copy(tgt.pos); m.estVel.copy(tgt.vel); m.mem = 1.5;
          aimPos = tgt.pos; aimVel = tgt.vel;
          for (const c of this.chaff) {
            if (c.owner !== tgt || m.seen.has(c.popId) || c.t > 1.0) continue;
            m.seen.add(c.popId);
            const nf = notchFactor(m.pos, tgt);
            const chance = (1 - w.ccm) * 0.7 * nf * nf * nf; // Doppler gate rejects chaff unless the target is beaming
            if (Math.random() < chance) { m.decoy = c; aimPos = c.pos; aimVel = c.vel; break; }
          }
        } else {
          // track lost (notch, gimbal): coast on memory and keep searching; re-acquire when it reappears
          m.mem -= dt; m.est.addScaledVector(m.estVel, dt);
          aimPos = m.est; aimVel = m.estVel;
          if (m.mem < -2.5) m.lost = true;
        }
      } else {
        // datalink: updates flow whenever the launching jet holds a radar lock (and resume if it re-locks)
        const o = m.owner;
        if (o && o.alive && o.radar && o.radar.stt && tgt && tgt.alive) { m.phase = 'dl'; m.est.copy(tgt.pos); m.estVel.copy(tgt.vel); }
        else m.phase = 'inertial';
        if (m.phase !== 'dl') m.est.addScaledVector(m.estVel, dt);
        const dEst = m.pos.distanceTo(m.est);
        if (dEst < w.pitbull && tgt && tgt.alive && tgt.pos.distanceTo(m.est) < 4000 && this.seekerSees(m, tgt, w)) {
          m.phase = 'active'; m.mem = 1.5;   // "pitbull": autonomous from here
        }
        m.minDist = Math.min(m.minDist, dEst);
        if (m.phase !== 'active' && dEst > m.minDist + 1500 && m.minDist < w.pitbull) m.lost = true; // flew through an empty basket
        aimPos = m.est; aimVel = m.estVel;
        if (dEst > 12000 && m.t > 1.5) loft = clamp((dEst - 12000) / 14000, 0, 1);
      }
      if (m.lost) aimPos = null;
    }

    // Multipath: against a very low target the radar energy also bounces off the surface, making a
    // mirror image below the ground. A radar seeker coming in at a shallow angle wanders between the
    // two in elevation and can be pulled into the ground. Strongest over smooth water; a missile
    // diving steeply from above sees past it.
    if (aimPos && tgt && tgt.alive && aimPos === tgt.pos && (w.guidance === 'sarh' || w.guidance === 'radar')) {
      const gh = groundHeight(tgt.pos.x, tgt.pos.z), agl = tgt.pos.y - gh, sea = gh <= 0.5;
      const lim = sea ? 120 : 70;
      if (agl < lim && agl > 0) {
        const dH = Math.max(1, Math.hypot(tgt.pos.x - m.pos.x, tgt.pos.z - m.pos.z));
        const graze = (m.pos.y - tgt.pos.y) / dH;
        if (graze < 0.25) {
          const k = (1 - agl / lim) * (1 - clamp(graze, 0, 0.25) / 0.25) * (sea ? 1 : 0.7);
          if (m.mpPh == null) m.mpPh = Math.random() * 6.28;
          const wob = Math.sin(m.t * 2.3 + m.mpPh) * 0.5 + Math.sin(m.t * 5.1 + m.mpPh * 1.7) * 0.3 + 0.35;
          aimPos = _mp.copy(tgt.pos); aimPos.y -= 2 * agl * k * wob;     // 2 × agl = the mirror image
          m.multipath = k;
        }
      }
    }
    if (aimPos) {
      _los.copy(aimPos).sub(m.pos);
      const dist = Math.max(_los.length(), 1);
      const losHat = _tmp2.copy(_los).divideScalar(dist);
      _vr.copy(aimVel).sub(m.vel);
      _om.crossVectors(_los, _vr).divideScalar(dist * dist);           // LOS rate vector
      const vc = Math.max(-_vr.dot(losHat), 150);
      _acmd.crossVectors(_om, losHat).multiplyScalar(4 * vc);            // proportional navigation, N = 4
      const off = Math.acos(clamp(losHat.dot(vhat), -1, 1));
      if (off > 0.25) _acmd.addScaledVector(_aim.copy(losHat).addScaledVector(vhat, -losHat.dot(vhat)).normalize(), off * 120); // turn toward an off-boresight target
      _acmd.y += GRAV;                                                   // gravity bias
      if (loft > 0 && vhat.y < 0.45) _acmd.y += loft * 45;               // loft into thin air on long shots
      _acmd.addScaledVector(vhat, -_acmd.dot(vhat));
      const q = 0.5 * rho * sp * sp;
      let maxA = w.maxG * GRAV * Math.min(1, q / (w.cls === 'gbomb' ? 30000 : 160000));   // fin authority scales with dynamic pressure
      if (w.glide && w.cls === 'gbomb') maxA *= w.glide;
      if (w.tv && m.burning) maxA = Math.max(maxA, w.maxG * GRAV * 0.7); // thrust vectoring works at any speed while burning
      if (m.t < 0.25) maxA *= 0.3;                                       // clear the aircraft first
      const aLen = _acmd.length();
      if (aLen > maxA) _acmd.multiplyScalar(maxA / aLen);
    } else _acmd.set(0, 0, 0);

    // ---- dynamics: thrust, drag (incl. induced drag from manoeuvring), gravity ----
    const dragA = w.cdA * rho * sp * sp + _acmd.length() * 0.06;
    m.vel.addScaledVector(_acmd, dt).addScaledVector(vhat, (thrust - dragA) * dt);
    m.vel.y -= GRAV * dt;
    m.pos.addScaledVector(m.vel, dt);

    this.placeMissileMesh(m);
    if (m.burning) for (let s = 1; s <= 3; s++) this.effects.missileTrail(_tmp2.copy(m.prev).lerp(m.pos, s / 3), m.vel, true, m.key, w.ramjet && m.stage > 0 ? 0.08 : w.smoke);

    // ---- air-to-ground: hitting a vehicle, a building or a ship's hull ----
    if (w.ag && m.t > 0.2) {
      for (const u of this.units) {
        if (!u.alive || u.side === (m.owner && m.owner.side)) continue;
        if (Math.abs(m.pos.x - u.pos.x) > u.r + 60 || Math.abs(m.pos.z - u.pos.z) > u.r + 60) continue;
        if (hitsUnit(m.prev, m.pos, u, w.fuze * 0.5)) return this.agImpact(m, m.pos.clone(), u);
      }
    }

    // ---- proximity fuze ----
    if (tgt && tgt.alive && m.t > w.armT) {
      const r0 = _tmp.copy(m.prev).sub(tgt.prevPos);
      const r1 = _tmp2.copy(m.pos).sub(tgt.pos);
      const info = {};
      const d = pointSegDist(r0, r1, info);
      if (d < w.fuze) {
        const pos = m.prev.clone().lerp(m.pos, info.t);
        if (w.ag) return this.agImpact(m, pos, tgt.unit ? tgt : null);
        // Inside the warhead's lethal radius the fragment cloud destroys a fighter outright. Toward
        // the edge of the fuze range fewer fragments hit, so a near miss can leave it badly damaged
        // (a wing, engine or fuel tank gone, often a fire) but still flying, for a while at least.
        const core = w.fuze * 0.7;
        const dmg = d < core ? w.dmg * 1.2 : w.dmg * (1 - 0.55 * (d - core) / (w.fuze - core)) * (0.85 + 0.3 * Math.random());
        this.effects.explosion(pos, tgt.vel, false);
        this.audio?.explosion(pos, false);
        this.hooks.onDamage(tgt, dmg, 'msl', m.owner, pos, tgt.quat ? blastZone(tgt, pos) : null);
        return { exploded: true, pos };
      }
    }
    if (m.decoy && m.pos.distanceTo(m.decoy.pos) < 12) m.lost = true;
    if (m.pos.y < groundHeight(m.pos.x, m.pos.z)) {
      if (w.ag) { const p = m.pos.clone(); p.y = groundHeight(p.x, p.z); return this.agImpact(m, p, null); }
      this.effects.explosion(m.pos, _tmp.set(0, 0, 0), false);
      return { exploded: true, pos: m.pos.clone() };
    }
    if (m.lost) m.lostT += dt;
    if (m.t > w.tMax || m.lostT > 3 || (!m.burning && sp < w.vMin)) {
      this.effects.explosion(m.pos, m.vel, false);   // self-destruct
      this.audio?.explosion(m.pos, false);
      return { exploded: true, pos: m.pos.clone() };
    }
    return null;
  }

  // A bomb, rocket or missile goes off on the ground or against a target: blast damage around it.
  agImpact(m, pos, direct) {
    const w = m.w, big = w.dmg >= 200;
    this.effects.explosion(pos, _tmp.set(0, 0, 0), big);
    if (pos.y < 1.5 && groundHeight(pos.x, pos.z) <= 0.5) this.effects.splash(pos, big ? 2.5 : 1.2); else this.effects.dust(pos, big ? 2.5 : 1);
    this.audio?.explosion(pos, big);
    if (this.hooks.onBlast) this.hooks.onBlast(pos, w, m.owner, direct);
    return { exploded: true, pos };
  }

  updateTracers() {
    let n = 0;
    for (const b of this.bullets) {
      if (!b.tracer) continue;
      const o = n * 6;
      const p = b.p;
      const k = 0.022;
      this.tracerPos[o] = p.x; this.tracerPos[o + 1] = p.y; this.tracerPos[o + 2] = p.z;
      this.tracerPos[o + 3] = p.x - b.v.x * k; this.tracerPos[o + 4] = p.y - b.v.y * k; this.tracerPos[o + 5] = p.z - b.v.z * k;
      const fade = Math.max(0, 1 - b.t / 3.5);
      this.tracerCol[o] = 1.0 * fade; this.tracerCol[o + 1] = 0.85 * fade; this.tracerCol[o + 2] = 0.45 * fade;
      this.tracerCol[o + 3] = 0.6 * fade; this.tracerCol[o + 4] = 0.25 * fade; this.tracerCol[o + 5] = 0.05 * fade;
      n++;
    }
    this.tracerGeo.setDrawRange(0, n * 2);
    this.tracerAttr.needsUpdate = true; this.tracerColAttr.needsUpdate = true;
  }

  // Every missile fired by the other side (local sim or network puppets), for the RWR/MAWS.
  enemyMissiles(side) {
    const out = [];
    for (const m of this.missiles) {
      if (!m.owner || m.owner.side === side) continue;
      out.push({ pos: m.pos, vel: m.vel, guidance: m.w.guidance, burning: m.burning, phase: m.decoy || m.lost ? 'none' : m.phase, target: m.target, owner: m.owner, src: m });
    }
    for (const m of this.remoteMissiles.values()) if (!m.owner || m.owner.side !== side) out.push(m);
    return out;
  }

  // Missiles fired by `owner` (local sim or network puppets), in the form sensors.assessThreats wants.
  missilesFrom(owner) {
    const out = [];
    if (!owner) return out;
    if (owner.isRemote) {
      for (const m of this.remoteMissiles.values()) out.push(m);
    } else {
      for (const m of this.missiles) {
        if (m.owner !== owner) continue;
        out.push({ pos: m.pos, vel: m.vel, guidance: m.w.guidance, burning: m.burning, phase: m.decoy || m.lost ? 'none' : m.phase, src: m });
      }
    }
    return out;
  }
}
