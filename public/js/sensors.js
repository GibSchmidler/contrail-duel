// Sensors: fire-control radar, IR seeker lock, radar warning receiver (RWR) and
// missile approach warning (MAWS).
import * as THREE from 'three';
import { RADAR, RWR, MAWS, WEAPONS } from './arsenal.js';

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const _rel = new THREE.Vector3(), _u = new THREE.Vector3();

export function newRadar() {
  return { contact: false, stt: false, acq: 0, mem: 0, pos: new THREE.Vector3(), vel: new THREE.Vector3(), notched: false, seenChaff: new Set(), lostMsg: 0 };
}

// Pulse-Doppler clutter notch: a target below the sensor (ground behind it) whose
// velocity along the line of sight is near zero sits in the clutter filter and vanishes.
export function radialSpeed(sensorPos, target) {
  _rel.copy(target.pos).sub(sensorPos).normalize();
  return target.vel.dot(_rel);
}
export function inNotch(sensorPos, target) {
  const lookDown = target.pos.y < sensorPos.y - 60;
  return lookDown && Math.abs(radialSpeed(sensorPos, target)) < RADAR.notchVr;
}
// 1 when beaming (zero radial speed), 0 when flying straight at/away from the sensor.
export function notchFactor(sensorPos, target) {
  return 1 - clamp(Math.abs(radialSpeed(sensorPos, target)) / 160, 0, 1);
}

// Can this radar see the target right now?
export function radarSees(plane, target) {
  if (!target || !target.alive || !plane.alive) return false;
  _rel.copy(target.pos).sub(plane.pos);
  const dist = _rel.length();
  const lookDown = target.pos.y < plane.pos.y - 60;
  if (dist > RADAR.range * (lookDown ? RADAR.lookDownFactor : 1)) return false;
  if (_rel.divideScalar(dist).dot(plane.fwd) < Math.cos(RADAR.gimbal)) return false;
  return !inNotch(plane.pos, target);
}

// Search + single-target track. wantStt is true when an AIM-120 is selected.
export function updateRadar(plane, target, dt, wantStt, chaffList) {
  const R = plane.radar;
  if (!plane.alive) { R.contact = false; R.stt = false; R.acq = 0; return; }
  const sees = radarSees(plane, target);
  R.notched = !!(target && target.alive && !sees && inNotch(plane.pos, target));
  if (sees) {
    R.contact = true; R.mem = RADAR.memory;
    R.pos.copy(target.pos); R.vel.copy(target.vel);
  } else {
    R.mem -= dt;
    R.pos.addScaledVector(R.vel, dt);
    if (R.mem <= 0) R.contact = false;
  }
  if (!wantStt || !target || !target.alive) { R.stt = false; R.acq = Math.min(R.acq, 0); R.acq = Math.min(0, R.acq + dt); return; }
  if (!sees) {
    if (R.stt) R.lostMsg = 1.5;
    R.stt = false; R.acq = Math.min(R.acq, 0);
  } else if (!R.stt) {
    R.acq += dt;
    if (R.acq >= RADAR.sttTime) R.stt = true;
  }
  // chaff: each fresh bundle from the target can break the track, mostly when it is beaming
  if (R.stt && chaffList) {
    for (const c of chaffList) {
      if (c.owner !== target || R.seenChaff.has(c.popId) || c.t > 0.8) continue;
      R.seenChaff.add(c.popId);
      const nf = notchFactor(plane.pos, target);
      if (Math.random() < 0.05 + 0.5 * nf * nf) {
        R.stt = false; R.acq = -0.8; R.lostMsg = 1.5;
        break;
      }
    }
  }
}

// IR lock range: tail aspect and afterburner make the target brighter.
export function irLockRange(shooterPos, target, key) {
  _u.copy(shooterPos).sub(target.pos).normalize();
  const aspect = -target.fwd.dot(_u); // 1 = looking up the tailpipe
  let range = 2300 + (aspect + 1) * 0.5 * 2500;
  if (target.ab) range *= 1.3;
  else if ((target.throttle ?? 1) < 0.5) range *= 0.8;
  return range * WEAPONS[key].lockMul;
}

// IR seeker: cued = helmet cueing (padlock view on the target) widens the cone for the 9X.
export function updateIrLock(plane, target, dt, key, cued) {
  if (!key || !target || !target.alive || !plane.alive) {
    plane.lockProgress = 0; plane.locked = false; plane.inCone = false; plane.offBore = 99; return;
  }
  const w = WEAPONS[key];
  _rel.copy(target.pos).sub(plane.pos);
  const dist = _rel.length();
  const ang = Math.acos(clamp(_rel.divideScalar(dist || 1).dot(plane.fwd), -1, 1));
  const cone = cued ? w.hobs : w.lockCone;
  plane.offBore = ang;
  plane.inCone = ang < cone && dist < irLockRange(plane.pos, target, key) && dist > 150;
  if (plane.inCone) plane.lockProgress = Math.min(1, plane.lockProgress + dt / (ang > w.lockCone ? 1.3 : 0.9));
  else plane.lockProgress = Math.max(0, plane.lockProgress - dt * 2.5);
  plane.locked = plane.lockProgress >= 1;
}

// What the target's RWR and MAWS can tell it. `missiles` is a list of
// { pos, vel, guidance, burning, phase } from the shooter (phase: 'dl' | 'active' | other).
export function assessThreats(me, opp, missiles) {
  const out = { search: false, lock: false, launch: false, active: false, maws: false, list: [], nearest: 1e9, emitter: null };
  if (!me.alive) return out;
  if (opp && opp.alive && opp.radarMode !== 0) {
    _rel.copy(me.pos).sub(opp.pos);
    const d = _rel.length();
    if (d < RWR.range && _rel.divideScalar(d).dot(opp.fwd) > Math.cos(RADAR.gimbal)) {
      out.search = true;
      out.emitter = opp.pos;
      if (opp.radarMode === 2) out.lock = true;
    }
  }
  for (const m of missiles) {
    const d = m.pos.distanceTo(me.pos);
    _rel.copy(me.pos).sub(m.pos);
    const closing = m.vel.dot(_rel) > 0;
    let kind = null;
    if (m.guidance === 'radar' && m.phase === 'active' && d < 14000) { out.active = true; kind = 'active'; }
    else if (m.guidance === 'radar' && m.phase === 'dl' && out.lock) { out.launch = true; }
    if (m.burning && closing && d < MAWS.range) { out.maws = true; kind = kind || 'maws'; }
    if (kind) { out.list.push({ pos: m.pos, kind, dist: d }); out.nearest = Math.min(out.nearest, d); }
  }
  return out;
}
