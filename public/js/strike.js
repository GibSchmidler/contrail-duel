// Air-to-ground fire control: bomb and rocket impact prediction (CCIP), target designation,
// seeker lock for guided missiles and the station each store is released from.
import * as THREE from 'three';
import { WEAPONS, agKinds, countKey } from './arsenal.js';
import { GRAV, airDensity } from './flight.js';
import { groundHeight, lineOfSight, visRange } from './world.js';

const _p = new THREE.Vector3(), _v = new THREE.Vector3(), _r = new THREE.Vector3();

// Where a bomb (or rocket) released now would hit the ground, simulated with the same drag
// model the weapon code uses. Returns { pos, t } or null if it would fly out of the arena first.
export function impactPoint(plane, key, out = new THREE.Vector3()) {
  const w = WEAPONS[key];
  if (!w) return null;
  _p.copy(plane.pos);
  // same release kinematics as Combat.launchMissile: rockets leave at +40 m/s along the
  // boresight; bombs are pushed clear by the rack (or the bay ejector)
  if (w.cls === 'rkt') _v.copy(plane.vel).addScaledVector(plane.fwd, 40);
  else {
    const st = plane.stores ? plane.stores.indexOf(key) : -1;
    const bay = st >= 0 && plane.T && plane.T.stations[st] && plane.T.stations[st][3] === 'bay';
    _v.copy(plane.vel).addScaledVector(plane.fwd, bay ? 4 : 12).addScaledVector(plane.up, bay ? -8 : -1.5);
  }
  let t = 0, burn = w.stages.length ? w.stages[0][1] : 0;
  const acc = w.stages.length ? w.stages[0][0] : 0;
  const dt = w.cls === 'rkt' ? 0.04 : 0.05;
  while (t < 70) {
    const sp = Math.max(_v.length(), 1);
    const rho = airDensity(_p.y);
    const a = (t < burn ? acc : 0) - w.cdA * rho * sp * sp;
    _v.addScaledVector(_r.copy(_v).divideScalar(sp), a * dt);
    _v.y -= GRAV * dt;
    const prevY = _p.y;
    _p.addScaledVector(_v, dt);
    t += dt;
    const g = groundHeight(_p.x, _p.z);
    if (_p.y <= g) {
      const k = (prevY - g) / Math.max(prevY - _p.y, 1e-3);
      out.copy(_p).addScaledVector(_v, -dt * (1 - Math.min(1, Math.max(0, k))));
      out.y = groundHeight(out.x, out.z);
      return { pos: out, t };
    }
  }
  return null;
}

// Next station holding this exact store, alternating sides like the missile code.
export function stationOf(stores, key, lastSide, order) {
  let pick = -1;
  for (const i of order || stores.map((_, k) => k)) {
    if (stores[i] !== key) continue;
    if (pick < 0) pick = i;
    if (i % 2 !== lastSide) return i;
  }
  return pick;
}

// Which enemy ground units this jet knows about: seen by eye, painted by its radar's
// ground-mapping mode, heard on the RWR (emitting radars), or marked in the mission briefing.
export function scanGround(plane, units, marked) {
  const out = new Map();
  if (!plane || !plane.alive) return out;
  const vis = visRange() * 1.25;
  const rng = plane.radarT ? plane.radarT.range * 0.6 : 20000;
  const radarOk = plane.radarMode > 0;
  for (const u of units) {
    if (!u.alive || u.side === plane.side) continue;
    const d = u.pos.distanceTo(plane.pos);
    const top = _p.copy(u.pos).setY(u.base + u.h * 0.7 + 2);
    let how = null;
    if (d < vis && lineOfSight(plane.pos, top, -2)) how = 'eyes';
    else if (radarOk && d < rng * (u.D.ship ? 1.8 : u.D.hard || u.r > 20 ? 1 : 0.55)) {
      _r.copy(u.pos).sub(plane.pos).divideScalar(d);
      if (_r.dot(plane.fwd) > Math.cos(1.0) && lineOfSight(plane.pos, top, -2)) how = 'radar';
    }
    if (!how && u.radarMode > 0 && d < 50000 * (u.radarT ? u.radarT.lpi : 1) && lineOfSight(u.sensorPos(_p), plane.pos)) how = 'rwr';
    if (!how && marked && marked.has(u.id)) how = 'intel';
    if (how) out.set(u, { how, dist: d });
  }
  return out;
}

// Pick the A/G target nearest the nose (or cycle with N). `ok(u)` filters what the selected
// weapon can attack (ships only for anti-ship missiles, emitters for ARMs).
const offBore = (plane, u) => Math.acos(Math.max(-1, Math.min(1, _r.copy(u.pos).sub(plane.pos).normalize().dot(plane.fwd))));
export function pickGround(plane, known, current, cycle, ok) {
  const list = [...known.keys()].filter((u) => u.alive && (!ok || ok(u)));
  if (!list.length) return null;
  list.sort((a, b) => offBore(plane, a) - offBore(plane, b));
  if (cycle) { const i = list.indexOf(current); return list[(i + 1) % list.length]; }
  if (current && current.alive && list.includes(current)) return current;
  return offBore(plane, list[0]) < 0.6 ? list[0] : null;
}

// What the selected store needs before it can be released, and whether it's satisfied.
// Returns { ok, why, target }.
export function releaseCheck(plane, key, tgt, known) {
  const w = WEAPONS[key];
  if (!w) return { ok: false, why: 'NO A/G STORES' };
  const d = tgt ? tgt.pos.distanceTo(plane.pos) : 1e9;
  const seen = tgt && known.get(tgt);
  switch (w.cls) {
    case 'bomb': case 'rkt': return { ok: true, target: tgt && d < 20000 ? tgt : null };
    case 'gbomb': {
      const lased = tgt && seen && d < w.seeker && lineOfSight(plane.pos, _p.copy(tgt.pos).setY(tgt.base + tgt.h), -2);
      return { ok: true, target: lased ? tgt : null, why: lased ? null : 'NO DESIGNATION — bomb falls ballistic' };
    }
    case 'agm':
      if (!tgt) return { ok: false, why: 'NO GROUND TARGET — press N' };
      if (!plane.agLocked) return { ok: false, why: 'SEEKER NOT LOCKED — point the nose at the target' };
      return { ok: true, target: tgt };
    case 'arm':
      if (!tgt || tgt.radarMode <= 0) return { ok: false, why: 'NO EMITTER — ARMs need a radar that is transmitting' };
      if (d > w.seeker) return { ok: false, why: 'EMITTER OUT OF RANGE' };
      if (offBore(plane, tgt) > w.lockCone) return { ok: false, why: 'EMITTER OUTSIDE THE SEEKER — turn toward it' };
      return { ok: true, target: tgt };
    case 'ashm':
      if (!tgt || !tgt.D.ship) return { ok: false, why: 'NO SHIP TARGETED' };
      if (d > 45000) return { ok: false, why: 'SHIP OUT OF RANGE (45 km)' };
      return { ok: true, target: tgt };
  }
  return { ok: false, why: '?' };
}

// Seeker lock for TV/IR/radar guided A/G missiles: hold the target in the seeker's view.
export function updateAgLock(plane, key, tgt, dt) {
  const w = key && WEAPONS[key];
  if (!w || (w.cls !== 'agm' && w.cls !== 'ashm') || !tgt || !tgt.alive) { plane.agLock = 0; plane.agLocked = false; return; }
  const d = tgt.pos.distanceTo(plane.pos);
  const inView = w.cls === 'ashm' || (offBore(plane, tgt) < w.lockCone && d < w.seeker && lineOfSight(plane.pos, _p.copy(tgt.pos).setY(tgt.base + tgt.h), -2));
  plane.agLock = inView ? Math.min(1, (plane.agLock || 0) + dt / 1.2) : Math.max(0, (plane.agLock || 0) - dt * 2);
  plane.agLocked = plane.agLock >= 1;
}

export { agKinds, countKey };
