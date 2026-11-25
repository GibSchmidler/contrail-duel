// Sensors: fire-control radar, infrared search and track (IRST), IR seeker lock,
// radar warning receiver (RWR) and missile approach warning (MAWS).
// Every jet has its own radar; targets differ in radar cross-section, IR signature and jamming.
import * as THREE from 'three';
import { RADAR, RADARS, RWR, MAWS, WEAPONS, rcsFactor } from './arsenal.js';
import { lineOfSight } from './world.js';

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const _rel = new THREE.Vector3(), _u = new THREE.Vector3();

export function newRadar() {
  return { contact: false, stt: false, acq: 0, mem: 0, pos: new THREE.Vector3(), vel: new THREE.Vector3(), notched: false, masked: false, seenChaff: new Set(), lostMsg: 0 };
}

// Pulse-Doppler clutter notch: a target below the sensor (ground behind it) whose
// velocity along the line of sight is near zero sits in the clutter filter and vanishes.
export function radialSpeed(sensorPos, target) {
  _rel.copy(target.pos).sub(sensorPos).normalize();
  return target.vel.dot(_rel);
}
export function inNotch(sensorPos, target, notchVr = RADAR.notchVr) {
  const lookDown = target.pos.y < sensorPos.y - 60;
  return lookDown && Math.abs(radialSpeed(sensorPos, target)) < notchVr;
}
// How far a radar (or radar seeker) of nominal range `range` sees this target:
// stealth shrinks it with the fourth root of RCS, jamming takes a further bite.
export function detectRange(range, target, ccm = 0) {
  const T = target.T;
  if (!T) return range;
  const jam = 1 - 0.35 * T.ecm * (1 - Math.max(0, ccm));
  return range * rcsFactor(T.rcs) * jam;
}
// 1 when beaming (zero radial speed), 0 when flying straight at/away from the sensor.
export function notchFactor(sensorPos, target) {
  return 1 - clamp(Math.abs(radialSpeed(sensorPos, target)) / 160, 0, 1);
}

// Can this radar see the target right now?
export function radarSees(plane, target) {
  if (!target || !target.alive || !plane.alive) return false;
  const RT = plane.radarT || RADARS.apg68;
  _rel.copy(target.pos).sub(plane.pos);
  const dist = _rel.length();
  const lookDown = target.pos.y < plane.pos.y - 60;
  if (dist > detectRange(RT.range, target, RT.ccm) * (lookDown ? RT.lookDown : 1)) return false;
  if (_rel.divideScalar(dist).dot(plane.fwd) < Math.cos(RT.gimbal)) return false;
  if (inNotch(plane.pos, target, RT.notchVr)) return false;
  return lineOfSight(plane.pos, target.pos); // radar can't see through a mountain
}
// Is the target hidden behind terrain from this sensor position?
export function masked(from, target) { return !!target && !lineOfSight(from, target.pos); }

// Search + single-target track. wantStt is true when an AIM-120 is selected.
export function updateRadar(plane, target, dt, wantStt, chaffList) {
  const R = plane.radar, RT = plane.radarT || RADARS.apg68;
  if (!plane.alive) { R.contact = false; R.stt = false; R.acq = 0; return; }
  const sees = radarSees(plane, target);
  R.notched = !!(target && target.alive && !sees && inNotch(plane.pos, target, RT.notchVr));
  R.masked = !!(target && target.alive && !sees && !R.notched && masked(plane.pos, target));
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
    if (R.acq >= RT.stt * (1 + (target.T ? target.T.ecm : 0) * 0.6)) R.stt = true; // jamming slows the lock
  }
  // chaff: each fresh bundle from the target can break the track, mostly when it is beaming
  if (R.stt && chaffList) {
    for (const c of chaffList) {
      if (c.owner !== target || R.seenChaff.has(c.popId) || c.t > 0.8) continue;
      R.seenChaff.add(c.popId);
      const nf = notchFactor(plane.pos, target);
      const ecm = target.T ? target.T.ecm : 0;
      if (Math.random() < (0.05 + 0.5 * nf * nf) * Math.max(0.3, 1 + ecm - RT.ccm)) {
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
  return range * WEAPONS[key].lockMul * (target.T ? target.T.irSig : 1);
}

// Passive IRST: sees engine heat and skin friction, cannot be detected or warned of, and doesn't
// care about radar stealth. Best from behind, against afterburner and fast (hot-skinned) targets.
export function irstRange(sensor, target) {
  const base = sensor.T ? sensor.T.irst : 0;
  if (!base) return 0;
  _u.copy(sensor.pos).sub(target.pos).normalize();
  const aspect = (-target.fwd.dot(_u) + 1) * 0.5;      // 1 = tail-on
  let r = base * (0.45 + 0.55 * aspect);
  if (target.ab) r *= 1.5;
  r *= 1 + 0.4 * clamp(((target.speed || 0) / 340) - 1, 0, 1);
  return r * (target.T ? target.T.irSig : 1);
}
export function updateIrst(plane, target, dt) {
  const I = plane.irst;
  if (!I) return;
  let sees = false;
  if (plane.alive && target && target.alive && plane.T && plane.T.irst) {
    _rel.copy(target.pos).sub(plane.pos);
    const d = _rel.length();
    sees = d < irstRange(plane, target) && _rel.divideScalar(d).dot(plane.fwd) > Math.cos(1.05) && lineOfSight(plane.pos, target.pos);
  }
  if (sees) { I.contact = true; I.mem = 2; I.pos.copy(target.pos); I.vel.copy(target.vel); }
  else { I.mem -= dt; I.pos.addScaledVector(I.vel, dt); if (I.mem <= 0) I.contact = false; }
  I.fresh = sees;
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
  const cone = cued ? w.hobs : w.lockCone; // cued: helmet sight, or seeker slaved to the radar / IRST
  plane.offBore = ang;
  plane.inCone = ang < cone && dist < irLockRange(plane.pos, target, key) && dist > 150 && lineOfSight(plane.pos, target.pos);
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
    const RT = opp.radarT || RADARS.apg68;
    _rel.copy(me.pos).sub(opp.pos);
    const d = _rel.length();
    // the emitter has to be in view: a ridge between us blocks its radar and our receiver alike.
    // Low-probability-of-intercept radars spread their energy and are picked up much closer.
    const range = RWR.range * RT.lpi * (opp.radarMode === 2 ? 1.25 : 1);
    if (d < range && _rel.divideScalar(d).dot(opp.fwd) > Math.cos(RT.gimbal) && lineOfSight(opp.pos, me.pos)) {
      out.search = true;
      out.emitter = opp.pos;
      out.code = opp.T ? opp.T.rwr : 'F';
      if (opp.radarMode === 2) out.lock = true;
    }
  }
  const maws = !me.T || me.T.maws;
  for (const m of missiles) {
    const d = m.pos.distanceTo(me.pos);
    _rel.copy(me.pos).sub(m.pos);
    const closing = m.vel.dot(_rel) > 0;
    let kind = null;
    if (m.guidance === 'radar' && m.phase === 'active' && d < 14000 && lineOfSight(m.pos, me.pos)) { out.active = true; kind = 'active'; }
    else if ((m.guidance === 'radar' || m.guidance === 'sarh') && (m.phase === 'dl' || m.phase === 'sarh') && out.lock) { out.launch = true; }
    // only jets with a missile approach warner see an incoming burning motor
    if (maws && m.burning && closing && d < MAWS.range && lineOfSight(m.pos, me.pos)) { out.maws = true; kind = kind || 'maws'; }
    if (kind) { out.list.push({ pos: m.pos, kind, dist: d }); out.nearest = Math.min(out.nearest, d); }
  }
  return out;
}
