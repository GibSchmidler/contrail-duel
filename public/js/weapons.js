// Guns, IR missiles, flares, seeker lock and hit detection.
import * as THREE from 'three';
import { MUZZLE_VEL, GRAV, airDensity } from './flight.js';
import { buildMissileMesh } from './models.js';
import { groundHeight } from './world.js';

export const GUN_RATE = 100;        // rounds/s
export const GUN_DAMAGE = 5;
export const SEEKER_CONE = 0.21;    // rad (~12 deg) launch seeker field of view
export const LOCK_TIME = 1.0;       // s
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

const _iq = new THREE.Quaternion(), _l0 = new THREE.Vector3(), _l1 = new THREE.Vector3();
// Segment from (bullet0 - target0) to (bullet1 - target1), tested in target body frame.
function hitsAircraft(rel0, rel1, quat) {
  _iq.copy(quat).invert();
  _l0.copy(rel0).applyQuaternion(_iq);
  _l1.copy(rel1).applyQuaternion(_iq);
  // coarse reject
  if (Math.min(_l0.lengthSq(), _l1.lengthSq()) > 400 && segSegDist2(_l0, _l1, HITBOX[0].a, HITBOX[0].b) > 64) return false;
  for (const h of HITBOX) {
    const rr = h.r + 0.25;
    if (segSegDist2(_l0, _l1, h.a, h.b) < rr * rr) return true;
  }
  return false;
}

// Infrared signature-based lock range: tail aspect + afterburner = longer range.
export function lockRange(shooterPos, target) {
  const toShooter = _r.copy(shooterPos).sub(target.pos).normalize();
  const aspect = -target.fwd.dot(toShooter); // 1 = looking at target's tailpipe
  let range = 2300 + (aspect + 1) * 0.5 * 2500;
  if (target.ab) range *= 1.25;
  return range;
}

const _to = new THREE.Vector3();
// Updates plane.lockProgress / plane.locked for a given target. Returns angle off boresight.
export function updateLock(plane, target, dt) {
  if (!target || !target.alive || !plane.alive || plane.missiles <= 0) {
    plane.lockProgress = 0; plane.locked = false; plane.inCone = false; return 99;
  }
  _to.copy(target.pos).sub(plane.pos);
  const dist = _to.length();
  _to.divideScalar(dist || 1);
  const ang = Math.acos(Math.min(1, Math.max(-1, _to.dot(plane.fwd))));
  plane.inCone = ang < SEEKER_CONE && dist < lockRange(plane.pos, target) && dist > 150;
  if (plane.inCone) plane.lockProgress = Math.min(1, plane.lockProgress + dt / LOCK_TIME);
  else plane.lockProgress = Math.max(0, plane.lockProgress - dt * 2.5);
  plane.locked = plane.lockProgress >= 1;
  return ang;
}

// ------------------------------------------------------------------
const _tmp = new THREE.Vector3(), _tmp2 = new THREE.Vector3(), _los = new THREE.Vector3(), _vr = new THREE.Vector3(), _om = new THREE.Vector3();
const _acmd = new THREE.Vector3(), _mq = new THREE.Quaternion(), _fz = new THREE.Vector3(0, 0, -1);

export class Combat {
  // hooks: onDamage(target, dmg, kind, shooter, pos), onMissileGone(missile, exploded, pos)
  constructor(scene, effects, audio, hooks) {
    this.scene = scene; this.effects = effects; this.audio = audio; this.hooks = hooks;
    this.bullets = [];
    this.missiles = [];         // locally simulated
    this.remoteMissiles = new Map();
    this.flares = [];
    this.popId = 1;
    this.missileSeq = 1;
    this.meshPool = [];

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
    this.missiles.length = 0; this.remoteMissiles.clear(); this.flares.length = 0;
  }

  getMesh() {
    const m = this.meshPool.pop() || buildMissileMesh();
    m.visible = true; this.scene.add(m);
    return m;
  }
  releaseMesh(m) { if (!m) return; this.scene.remove(m); this.meshPool.push(m); }

  // live = this client performs hit detection for this bullet
  fireBullet(plane, live, frac = 0) {
    if (this.bullets.length >= MAX_BULLETS) this.bullets.shift();
    const spread = 0.0028;
    const dir = _tmp.copy(plane.fwd)
      .addScaledVector(plane.right, (Math.random() - 0.5) * spread)
      .addScaledVector(plane.up, (Math.random() - 0.5) * spread).normalize();
    const p = plane.pos.clone().addScaledVector(plane.fwd, 7).addScaledVector(plane.right, -0.7).addScaledVector(plane.up, 0.35);
    const v = plane.vel.clone().addScaledVector(dir, MUZZLE_VEL);
    p.addScaledVector(v, frac);
    this.bullets.push({ p, v, prev: p.clone(), t: 0, owner: plane, live, tracer: Math.random() < 0.5 });
  }

  launchMissile(plane, target) {
    const m = {
      id: (plane.netId || 'L') + '-' + this.missileSeq++,
      owner: plane, target, flareTarget: null, seen: new Set(),
      pos: plane.pos.clone().addScaledVector(plane.up, -1.2),
      vel: plane.vel.clone().addScaledVector(plane.fwd, 15).addScaledVector(plane.up, -8),
      prev: new THREE.Vector3(), t: 0, lost: false, lostT: 0, mesh: this.getMesh(),
    };
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

  addFlare(p, v, popId, owner) {
    this.flares.push({ pos: p, vel: v, t: 0, popId, owner });
  }

  // Remote missile puppets (data from network)
  syncRemoteMissiles(list, now) {
    const seen = new Set();
    for (const [id, x, y, z, vx, vy, vz] of list) {
      seen.add(id);
      let m = this.remoteMissiles.get(id);
      if (!m) {
        m = { id, pos: new THREE.Vector3(x, y, z), vel: new THREE.Vector3(), mesh: this.getMesh(), t: 0, remote: true, snapPos: new THREE.Vector3(), snapT: now };
        this.remoteMissiles.set(id, m);
      }
      m.snapPos.set(x, y, z); m.vel.set(vx, vy, vz); m.snapT = now;
    }
    for (const [id, m] of this.remoteMissiles) {
      if (!seen.has(id)) { this.releaseMesh(m.mesh); this.remoteMissiles.delete(id); }
    }
  }

  removeRemoteMissile(id, pos) {
    const m = this.remoteMissiles.get(id);
    if (m) { this.releaseMesh(m.mesh); this.remoteMissiles.delete(id); }
    if (pos) { this.effects.explosion(pos, _tmp.set(0, 0, 0), false); this.audio?.explosion(pos, false); }
  }

  update(dt, planes, now, oneWayMs = 0) {
    const fx = this.effects;
    // ---- bullets ----
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.prev.copy(b.p);
      b.v.y -= GRAV * dt;
      b.p.addScaledVector(b.v, dt);
      b.t += dt;
      let dead = b.t > 2.6;
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
          if (hitsAircraft(r0, r1, pl.quat)) {
            dead = true;
            fx.spark(b.p, pl.vel);
            this.hooks.onDamage(pl, GUN_DAMAGE, 'gun', b.owner, b.p);
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
      // trail interpolated between frames
      const steps = 3;
      for (let s = 1; s <= steps; s++) fx.missileTrail(_tmp.copy(prev).lerp(m.pos, s / steps), m.vel, m.vel.lengthSq() > 250000);
    }

    this.updateTracers();
  }

  placeMissileMesh(m) {
    m.mesh.position.copy(m.pos);
    const sp = m.vel.length();
    if (sp > 1) { _mq.setFromUnitVectors(_fz, _tmp.copy(m.vel).divideScalar(sp)); m.mesh.quaternion.copy(_mq); }
  }

  // returns null while flying, or {exploded, pos}
  stepMissile(m, dt) {
    m.t += dt;
    m.prev.copy(m.pos);
    const sp = Math.max(m.vel.length(), 1);
    const vhat = _tmp.copy(m.vel).divideScalar(sp);
    const burning = m.t < 3.0;
    const rho = airDensity(m.pos.y);

    // ---- seeker / target selection ----
    let tgtPos = null, tgtVel = null;
    const tgt = m.target;
    if (!m.lost) {
      if (m.flareTarget) {
        if (m.flareTarget.t > 3.4) { m.lost = true; }
        else { tgtPos = m.flareTarget.pos; tgtVel = m.flareTarget.vel; }
      } else if (tgt && tgt.alive) {
        tgtPos = tgt.pos; tgtVel = tgt.vel;
        // flare seduction: each new pop near the target gets one roll
        for (const f of this.flares) {
          if (f.owner !== tgt || m.seen.has(f.popId) || f.t > 0.6) continue;
          m.seen.add(f.popId);
          let chance = 0.45;
          if (tgt.ab) chance *= 0.55;
          if ((tgt.throttle ?? 1) < 0.6) chance *= 1.5;
          // a missile looking at the target's hot tailpipe from behind is harder to fool
          const aspect = -tgt.fwd.dot(_los.copy(m.pos).sub(tgt.pos).normalize());
          chance *= 1 - aspect * 0.25;
          if (Math.random() < Math.min(0.85, chance)) { m.flareTarget = f; tgtPos = f.pos; tgtVel = f.vel; break; }
        }
      } else m.lost = true;
    }

    if (tgtPos) {
      _los.copy(tgtPos).sub(m.pos);
      const dist = _los.length();
      const losHat = _tmp2.copy(_los).divideScalar(dist);
      // gimbal limit / seeker range
      if (losHat.dot(vhat) < Math.cos(0.95) || dist > 7000) { m.lost = true; tgtPos = null; }
      else {
        _vr.copy(tgtVel).sub(m.vel);
        _om.crossVectors(_los, _vr).divideScalar(dist * dist);           // LOS rate vector
        const vc = Math.max(-_vr.dot(losHat), 150);
        _acmd.crossVectors(_om, losHat).multiplyScalar(4 * vc);            // PN, N=4
        _acmd.y += GRAV;                                                   // gravity bias
        _acmd.addScaledVector(vhat, -_acmd.dot(vhat));
        const maxA = 32 * GRAV * Math.min(1, rho / 0.6);
        const aLen = _acmd.length();
        if (aLen > maxA) _acmd.multiplyScalar(maxA / aLen);
      }
    }
    if (!tgtPos) _acmd.set(0, 0, 0);

    // ---- dynamics ----
    const thrust = burning ? 260 : 0;
    const dragA = 6.5e-5 * rho * sp * sp + _acmd.length() * 0.07;
    m.vel.addScaledVector(_acmd, dt)
      .addScaledVector(vhat, (thrust - dragA) * dt);
    m.vel.y -= GRAV * dt;
    m.pos.addScaledVector(m.vel, dt);

    this.placeMissileMesh(m);
    const steps = 3;
    for (let s = 1; s <= steps; s++) this.effects.missileTrail(_tmp2.copy(m.prev).lerp(m.pos, s / steps), m.vel, burning);

    // ---- fuze ----
    if (tgt && tgt.alive && m.t > 0.4) {
      const r0 = _tmp.copy(m.prev).sub(tgt.prevPos);
      const r1 = _tmp2.copy(m.pos).sub(tgt.pos);
      const info = {};
      const d = pointSegDist(r0, r1, info);
      if (d < 14) {
        const pos = m.prev.clone().lerp(m.pos, info.t);
        const dmg = d < 5 ? 100 : Math.max(25, 100 - (d - 5) * 8);
        this.effects.explosion(pos, tgt.vel, false);
        this.audio?.explosion(pos, false);
        this.hooks.onDamage(tgt, dmg, 'msl', m.owner, pos);
        return { exploded: true, pos };
      }
    }
    if (m.flareTarget && m.pos.distanceTo(m.flareTarget.pos) < 10) m.lost = true;
    if (m.pos.y < groundHeight(m.pos.x, m.pos.z)) {
      this.effects.explosion(m.pos, _tmp.set(0, 0, 0), false);
      return { exploded: true, pos: m.pos.clone() };
    }
    if (m.lost) m.lostT += dt;
    if (m.t > 16 || m.lostT > 2.5 || (!burning && sp < 260)) {
      this.effects.explosion(m.pos, m.vel, false);
      this.audio?.explosion(m.pos, false);
      return { exploded: true, pos: m.pos.clone() };
    }
    return null;
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
      const fade = Math.max(0, 1 - b.t / 2.6);
      this.tracerCol[o] = 1.0 * fade; this.tracerCol[o + 1] = 0.85 * fade; this.tracerCol[o + 2] = 0.45 * fade;
      this.tracerCol[o + 3] = 0.6 * fade; this.tracerCol[o + 4] = 0.25 * fade; this.tracerCol[o + 5] = 0.05 * fade;
      n++;
    }
    this.tracerGeo.setDrawRange(0, n * 2);
    this.tracerAttr.needsUpdate = true; this.tracerColAttr.needsUpdate = true;
  }

  // Missiles (local or remote) heading for `plane`, for warnings.
  threatsTo(plane) {
    const out = [];
    for (const m of this.missiles) if (m.target === plane && !m.lost && !m.flareTarget) out.push(m);
    if (plane && !plane.isRemote) for (const m of this.remoteMissiles.values()) out.push(m);
    return out;
  }
}
