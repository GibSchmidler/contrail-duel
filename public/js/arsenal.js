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
//  stages: [thrust accel m/s^2, seconds] (boost then sustain)
//  cdA: drag accel = cdA * rho * v^2;  maxG at full dynamic pressure
//  lockCone: seeker field of regard for lock (rad), hobs: helmet-cued cone
//  gimbal: max seeker look angle in flight; seeker: max track range
//  ccm: flare/chaff rejection 0..1;  armT: fuze arming time;  fuze: proximity radius
export const WEAPONS = {
  aim9m: {
    code: 1, name: 'AIM-9M', short: '9M', cls: 'srm', guidance: 'ir', mass: 86, drag: 0.0007,
    stages: [[215, 2.6]], cdA: 1.55e-4, maxG: 30, tv: false,
    lockCone: 0.21, hobs: 0.21, gimbal: 0.7, seeker: 7000, lockMul: 1.0, ccm: 0.25,
    armT: 0.45, fuze: 9, dmg: 100, vMin: 230, tMax: 22, rMin: 450,
  },
  aim9x: {
    code: 2, name: 'AIM-9X', short: '9X', cls: 'srm', guidance: 'ir', mass: 85, drag: 0.0006,
    stages: [[235, 3.0]], cdA: 1.35e-4, maxG: 50, tv: true,
    lockCone: 0.21, hobs: 1.4, gimbal: 1.55, seeker: 9000, lockMul: 1.35, ccm: 0.7,
    armT: 0.35, fuze: 9, dmg: 100, vMin: 220, tMax: 24, rMin: 300,
  },
  aim120: {
    code: 3, name: 'AIM-120C', short: '120', cls: 'mrm', guidance: 'radar', mass: 157, drag: 0.0011,
    stages: [[290, 1.8], [62, 6.2]], cdA: 7.0e-5, maxG: 40, tv: false,
    gimbal: 0.8, seeker: 11000, pitbull: 9500, ccm: 0.55,
    armT: 1.2, fuze: 14, dmg: 100, vMin: 260, tMax: 75, rMin: 1500,
  },
};
export const WEAPON_BY_CODE = Object.fromEntries(Object.entries(WEAPONS).map(([k, w]) => [w.code, k]));

// Stations: 0/1 wingtips, 2/3 outer pylons, 4/5 inner pylons (left/right pairs).
export const STATIONS = [[5.35, 0.0, 2.6], [-5.35, 0.0, 2.6], [3.4, -0.55, 1.7], [-3.4, -0.55, 1.7], [2.2, -0.75, 0.6], [-2.2, -0.75, 0.6]];

export const LOADOUTS = {
  knife:    { name: 'Knife fight', desc: '4× AIM-9X — light and agile, all short range', st: ['aim9x', 'aim9x', 'aim9x', 'aim9x', null, null] },
  balanced: { name: 'Balanced', desc: '2× AIM-120C + 2× AIM-9X', st: ['aim9x', 'aim9x', 'aim120', 'aim120', null, null] },
  bvr:      { name: 'Long range', desc: '4× AIM-120C + 2× AIM-9X — heavy, draggy', st: ['aim9x', 'aim9x', 'aim120', 'aim120', 'aim120', 'aim120'] },
  classic:  { name: 'Old school', desc: '6× AIM-9M — more shots, weaker seekers', st: ['aim9m', 'aim9m', 'aim9m', 'aim9m', 'aim9m', 'aim9m'] },
};

export const GUN = {
  rate: 100,           // rounds/s (M61A1, 6,000 rpm)
  spinUp: 0.35,        // s to reach full rate
  ammo: 511,           // F-16 load
  muzzle: 1050,        // m/s (PGU-28/B)
  sigma: 0.0018,       // rad, ~8 mil dispersion circle
  dragK: 2.9e-4,       // per metre at sea level: ~25% velocity lost over 1 km
  damage: 5,
};

export function storeMass(stores) { let m = 0; for (const s of stores) if (s) m += WEAPONS[s].mass + 25; return m; }
export function storeDrag(stores) { let d = 0; for (const s of stores) if (s) d += WEAPONS[s].drag; return d; }
export function countOf(stores, cls) { let n = 0; for (const s of stores) if (s && WEAPONS[s].cls === cls) n++; return n; }
export function firstOf(stores, cls) { for (const s of stores) if (s && WEAPONS[s].cls === cls) return s; return null; }
// Station to fire next for a class: inner/outer before wingtips, alternating sides.
const FIRE_ORDER = [4, 5, 2, 3, 0, 1];
export function nextStation(stores, cls, lastSide) {
  let pick = -1;
  for (const i of FIRE_ORDER) {
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
    let a = 0, tt = t;
    for (const [acc, d] of w.stages) { if (tt < d) { a = acc; break; } tt -= d; }
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
