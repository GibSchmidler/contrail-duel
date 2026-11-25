// Weapon, sensor and loadout data. Numbers are scaled from public figures so the
// relationships hold (AMRAAM outranges Sidewinder, 9X out-turns and out-sees the 9M,
// head-on shots reach further than tail chases) while fitting a 60 km arena.

export const RADAR = {
  range: 42000,        // m, detection range vs a fighter
  gimbal: 1.05,        // rad (~60 deg) scan/track limit off the nose
  sttTime: 1.0,        // s to go from search contact to single-target track
  notchVr: 28,         // m/s: target's velocity along the line of sight below this hides it in ground clutter
  lookDownFactor: 0.75,
  memory: 3.0,         // s a lost track is coasted on the scope
};
export const VISUAL_RANGE = 8000;   // m: eyeball / padlock / helmet range
export const MAWS = { range: 5500 };  // UV missile approach warning: sees burning motors only
export const RWR = { range: 50000 };

// Air-to-air missiles.
//  stages: [thrust accel m/s^2, seconds] (boost then sustain; Meteor's long second stage is its ramjet)
//  cdA: drag accel = cdA * rho * v^2;  maxG at full dynamic pressure;  tv: thrust vectoring
//  lockCone: seeker field of regard for lock (rad), hobs: helmet-cued cone
//  gimbal: max seeker look angle in flight; seeker: max track range vs a 3 m^2 target
//  ccm: flare/chaff rejection 0..1;  armT: fuze arming time;  fuze: proximity radius
//  guidance: 'ir' | 'radar' (active, with datalink) | 'sarh' (semi-active: the launching jet
//            must keep its radar locked on the target until impact)
//  smoke: how visible the motor plume is (0..1)
const IR = (o) => ({ cls: 'srm', guidance: 'ir', lockCone: 0.21, lockMul: 1.0, armT: 0.35, fuze: 9, dmg: 100, vMin: 220, tMax: 24, rMin: 300, smoke: 0.5, ...o });
const ARH = (o) => ({ cls: 'mrm', guidance: 'radar', tv: false, maxG: 40, gimbal: 0.8, armT: 1.2, fuze: 14, dmg: 100, vMin: 260, rMin: 1500, smoke: 0.5, ...o });
export const WEAPONS = {
  // --- United States ---
  aim9m:  IR({ code: 1, name: 'AIM-9M', short: '9M', mass: 86, drag: 0.0007, stages: [[215, 2.6]], cdA: 1.55e-4, maxG: 30, tv: false, hobs: 0.21, gimbal: 0.7, seeker: 7000, ccm: 0.25, armT: 0.45, vMin: 230, tMax: 22, rMin: 450, smoke: 0.6 }),
  aim9x:  IR({ code: 2, name: 'AIM-9X', short: '9X', mass: 85, drag: 0.0006, stages: [[235, 3.0]], cdA: 1.35e-4, maxG: 50, tv: true, hobs: 1.4, gimbal: 1.55, seeker: 9000, lockMul: 1.35, ccm: 0.7 }),
  aim120: ARH({ code: 3, name: 'AIM-120C', short: '120C', mass: 157, drag: 0.0011, stages: [[290, 1.8], [62, 6.2]], cdA: 7.0e-5, seeker: 11000, pitbull: 9500, ccm: 0.55, tMax: 75 }),
  aim120d: ARH({ code: 4, name: 'AIM-120D', short: '120D', mass: 161, drag: 0.0011, stages: [[300, 1.9], [64, 8.6]], cdA: 6.6e-5, gimbal: 0.85, seeker: 12000, pitbull: 10000, ccm: 0.65, tMax: 95 }),
  // --- Russia ---
  r73:    IR({ code: 5, name: 'R-73M', short: '73', mass: 105, drag: 0.0009, stages: [[220, 2.6]], cdA: 1.7e-4, maxG: 40, tv: true, hobs: 0.78, gimbal: 1.05, seeker: 7500, lockMul: 1.1, ccm: 0.45, armT: 0.4, fuze: 8, tMax: 22, smoke: 0.75 }),
  r74m:   IR({ code: 6, name: 'R-74M', short: '74M', mass: 110, drag: 0.0009, stages: [[230, 2.9]], cdA: 1.55e-4, maxG: 45, tv: true, hobs: 1.05, gimbal: 1.3, seeker: 8500, lockMul: 1.25, ccm: 0.6, smoke: 0.65 }),
  r77:    ARH({ code: 7, name: 'R-77', short: '77', mass: 175, drag: 0.0014, stages: [[270, 1.7], [55, 5.0]], cdA: 9.0e-5, seeker: 9000, pitbull: 8500, ccm: 0.4, fuze: 13, tMax: 65, smoke: 0.65 }),
  r771:   ARH({ code: 8, name: 'R-77-1', short: '77-1', mass: 190, drag: 0.0013, stages: [[290, 1.8], [60, 6.4]], cdA: 7.8e-5, seeker: 10000, pitbull: 9000, ccm: 0.5, tMax: 75, smoke: 0.6 }),
  r77m:   ARH({ code: 9, name: 'R-77M', short: '77M', mass: 200, drag: 0.0012, stages: [[300, 2.0], [70, 9.0]], cdA: 7.0e-5, gimbal: 0.9, seeker: 12500, pitbull: 10500, ccm: 0.65, tMax: 100, rMin: 1600 }),
  r27er:  ARH({ code: 10, name: 'R-27ER', short: '27ER', guidance: 'sarh', mass: 350, drag: 0.0022, stages: [[330, 4.0]], cdA: 7.2e-5, maxG: 32, gimbal: 0.9, seeker: 0, pitbull: 0, ccm: 0.25, armT: 1.0, fuze: 15, vMin: 250, tMax: 60, rMin: 1200, smoke: 0.9 }),
  // --- China ---
  pl10:   IR({ code: 11, name: 'PL-10', short: '10', mass: 89, drag: 0.0006, stages: [[235, 3.0]], cdA: 1.4e-4, maxG: 50, tv: true, hobs: 1.57, gimbal: 1.57, seeker: 9000, lockMul: 1.3, ccm: 0.7 }),
  pl12:   ARH({ code: 12, name: 'PL-12', short: '12', mass: 199, drag: 0.0012, stages: [[280, 1.8], [55, 5.6]], cdA: 7.6e-5, maxG: 38, seeker: 9500, pitbull: 9000, ccm: 0.45, tMax: 70 }),
  pl15:   ARH({ code: 13, name: 'PL-15', short: '15', mass: 210, drag: 0.0012, stages: [[300, 2.2], [72, 9.0]], cdA: 6.3e-5, gimbal: 0.9, seeker: 13000, pitbull: 11000, ccm: 0.65, armT: 1.3, tMax: 100, rMin: 1600 }),
  // --- Europe ---
  irist:  IR({ code: 14, name: 'IRIS-T', short: 'IRT', mass: 87, drag: 0.0006, stages: [[240, 3.0]], cdA: 1.35e-4, maxG: 60, tv: true, hobs: 1.57, gimbal: 1.57, seeker: 9500, lockMul: 1.35, ccm: 0.75, armT: 0.3 }),
  micair: IR({ code: 15, name: 'MICA IR', short: 'MICA', mass: 112, drag: 0.0009, stages: [[245, 3.6]], cdA: 1.2e-4, maxG: 50, tv: true, hobs: 1.05, gimbal: 1.2, seeker: 10000, lockMul: 1.45, ccm: 0.7, armT: 0.4, fuze: 10, vMin: 230, tMax: 40, rMin: 400 }),
  micaem: ARH({ code: 16, name: 'MICA EM', short: 'MICA', mass: 112, drag: 0.0009, stages: [[250, 2.4], [45, 4.0]], cdA: 1.0e-4, maxG: 50, tv: true, gimbal: 0.9, seeker: 9000, pitbull: 8000, ccm: 0.55, armT: 1.0, fuze: 12, vMin: 250, tMax: 55, rMin: 1000 }),
  meteor: ARH({ code: 17, name: 'Meteor', short: 'MTR', ramjet: true, mass: 190, drag: 0.0012, stages: [[230, 2.6], [40, 48]], cdA: 6.0e-5, gimbal: 0.9, seeker: 12500, pitbull: 10500, ccm: 0.7, armT: 1.3, tMax: 100, rMin: 1600, smoke: 0.12 }),
};
// Ramjet thrust follows the air it swallows: weaker high up and when slow.
export function ramjetFactor(rho, v) { return Math.max(0.35, Math.min(1.3, Math.sqrt(rho / 0.6) * (v / 900))); }

// Aircraft guns.
export const GUNS = {
  m61:    { name: 'M61A1 20 mm', rate: 100, spinUp: 0.35, muzzle: 1050, sigma: 0.0018, dragK: 2.9e-4, damage: 5 },
  gsh301: { name: 'GSh-30-1 30 mm', rate: 25, spinUp: 0, muzzle: 860, sigma: 0.0022, dragK: 2.0e-4, damage: 18 },
  gsh23:  { name: 'GSh-23 23 mm', rate: 55, spinUp: 0.05, muzzle: 715, sigma: 0.0022, dragK: 3.0e-4, damage: 7 },
  bk27:   { name: 'BK-27 27 mm', rate: 28, spinUp: 0.05, muzzle: 1025, sigma: 0.0015, dragK: 2.0e-4, damage: 13 },
  m791:   { name: '30M791 30 mm', rate: 42, spinUp: 0.05, muzzle: 1025, sigma: 0.0016, dragK: 2.1e-4, damage: 13 },
  none:   { name: 'No gun', rate: 0, spinUp: 1, muzzle: 1000, sigma: 0.002, dragK: 2.5e-4, damage: 0 },
};

// Fire-control radars. range: detection of a 3 m^2 target; scales with RCS^(1/4).
//  stt: seconds to lock;  ccm: resistance to chaff and jamming;  lpi: how loud the radar
//  looks to the enemy's RWR (low-probability-of-intercept AESAs are hard to detect).
export const RADARS = {
  apg68:  { name: 'AN/APG-68(V)9', range: 40000, gimbal: 1.05, stt: 1.0, ccm: 0.0, lpi: 1.0, notchVr: 28, lookDown: 0.75 },
  apg63:  { name: 'AN/APG-63(V)3 AESA', range: 55000, gimbal: 1.05, stt: 0.5, ccm: 0.3, lpi: 0.8, notchVr: 24, lookDown: 0.8 },
  apg79:  { name: 'AN/APG-79 AESA', range: 50000, gimbal: 1.05, stt: 0.5, ccm: 0.3, lpi: 0.8, notchVr: 24, lookDown: 0.8 },
  apg77:  { name: 'AN/APG-77 AESA', range: 58000, gimbal: 1.05, stt: 0.4, ccm: 0.35, lpi: 0.3, notchVr: 22, lookDown: 0.85 },
  n019:   { name: 'N019M Topaz', range: 30000, gimbal: 1.15, stt: 1.3, ccm: -0.15, lpi: 1.0, notchVr: 40, lookDown: 0.6 },
  irbis:  { name: 'N035 Irbis-E PESA', range: 62000, gimbal: 1.4, stt: 0.8, ccm: 0.15, lpi: 1.0, notchVr: 30, lookDown: 0.75 },
  n036:   { name: 'N036 Byelka AESA', range: 58000, gimbal: 1.4, stt: 0.5, ccm: 0.3, lpi: 0.6, notchVr: 24, lookDown: 0.8 },
  klj7a:  { name: 'KLJ-7A AESA', range: 46000, gimbal: 1.05, stt: 0.5, ccm: 0.25, lpi: 0.8, notchVr: 25, lookDown: 0.8 },
  j16r:   { name: 'J-16 AESA', range: 55000, gimbal: 1.05, stt: 0.5, ccm: 0.3, lpi: 0.8, notchVr: 25, lookDown: 0.8 },
  t1475:  { name: 'Type 1475 AESA', range: 55000, gimbal: 1.05, stt: 0.45, ccm: 0.3, lpi: 0.5, notchVr: 24, lookDown: 0.8 },
  captor: { name: 'Captor-E AESA', range: 52000, gimbal: 1.75, stt: 0.5, ccm: 0.3, lpi: 0.8, notchVr: 24, lookDown: 0.8 },
  rbe2:   { name: 'RBE2-AA AESA', range: 46000, gimbal: 1.05, stt: 0.5, ccm: 0.3, lpi: 0.75, notchVr: 24, lookDown: 0.8 },
  raven:  { name: 'ES-05 Raven AESA', range: 45000, gimbal: 1.75, stt: 0.5, ccm: 0.3, lpi: 0.8, notchVr: 24, lookDown: 0.8 },
};
export const REF_RCS = 3;   // m^2: the target the radar ranges are quoted against
// Detection range scales with the fourth root of radar cross-section (the radar equation).
export const rcsFactor = (rcs) => Math.pow(Math.max(rcs, 1e-5) / REF_RCS, 0.25);

export const WEAPON_BY_CODE = Object.fromEntries(Object.entries(WEAPONS).map(([k, w]) => [w.code, k]));

// Default gun (kept for tools and tests).
export const GUN = { ...GUNS.m61, ammo: 511 };

export function storeMass(stores) { let m = 0; for (const s of stores) if (s) m += WEAPONS[s].mass + 25; return m; }
export function storeDrag(stores) { let d = 0; for (const s of stores) if (s) d += WEAPONS[s].drag; return d; }
export function countOf(stores, cls) { let n = 0; for (const s of stores) if (s && WEAPONS[s].cls === cls) n++; return n; }
export function firstOf(stores, cls) { for (const s of stores) if (s && WEAPONS[s].cls === cls) return s; return null; }
// Station to fire next for a class, following the jet's firing order and alternating sides.
// Stations come in right/left pairs, so i % 2 is the side.
export function nextStation(stores, cls, lastSide, order) {
  let pick = -1;
  for (const i of order || stores.map((_, k) => k)) {
    const s = stores[i];
    if (!s || WEAPONS[s].cls !== cls) continue;
    if (pick < 0) pick = i;
    if ((i % 2) !== lastSide) return i;
  }
  return pick;
}
export const packStores = (stores) => stores.map((s) => (s ? WEAPONS[s].code : 0));
export const unpackStores = (codes) => (codes || []).map((c) => WEAPON_BY_CODE[c] || null);

// 1-D fly-out of a missile at a given air density: returns arrays of distance and speed vs time.
// Used for the launch zone (DLZ) display and by the AI's shot logic.
export function flyout(key, v0, rho, dt = 0.2) {
  const w = WEAPONS[key];
  const s = [0], v = [v0];
  let dist = 0, sp = v0, t = 0;
  while (t < w.tMax) {
    let a = 0, tt = t, si = 0;
    for (const [acc, d] of w.stages) { if (tt < d) { a = acc; break; } tt -= d; si++; }
    if (w.ramjet && si > 0 && a > 0) a *= ramjetFactor(rho, sp);
    sp += (a - w.cdA * rho * sp * sp) * dt; dist += sp * dt; t += dt;
    s.push(dist); v.push(sp);
    if (a === 0 && sp < w.vMin) break;
  }
  return { s, v, dt, key };
}
// Ranges from a fly-out: rMax vs a target holding its closing speed, rNe vs a target turning to run.
export function launchZone(fo, closing, tgtSpeed) {
  const w = WEAPONS[fo.key];
  let rMax = 0, rNe = 0;
  for (let i = 1; i < fo.s.length; i++) {
    const t = i * fo.dt;
    rMax = Math.max(rMax, fo.s[i] + closing * t);
    if (fo.v[i] > tgtSpeed + 120) rNe = Math.max(rNe, fo.s[i] - tgtSpeed * t);
  }
  return { rMax: rMax * 0.85, rNe: rNe * 0.85, rMin: w.rMin };
}
