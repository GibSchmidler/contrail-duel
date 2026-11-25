// Semi-realistic fly-by-wire jet flight model.
// Body axes: forward = -Z, up = +Y, right = +X (same as a Three.js camera).
// The FBW pitch channel is a G-command law with an AoA limiter, roll is a rate
// command about the velocity vector, and the rudder commands sideslip. Lift,
// induced drag, wave drag, thrust lapse with altitude and gravity are physical,
// so energy management (speed <-> altitude <-> turn rate) matters.
import * as THREE from 'three';
import { GUNS, WEAPONS, RADARS, countOf } from './arsenal.js';
import { JETS, jetOf, DEFAULT_JET } from './aircraft.js';
import { newRadar } from './sensors.js';

export const GRAV = 9.81;
export const SOUND_SPEED = 340;

// Defaults (F-16C). Each jet type overrides these with its own `flight` block.
export const JET = {
  mass: 10500,        // kg
  S: 42,              // effective lifting area m^2 (wings + body lift)
  thrMil: 76000,      // N, military power
  thrAB: 125000,      // N, full afterburner
  cd0: 0.015,
  wave: 0.022,        // transonic wave drag rise
  k: 0.13,            // induced drag factor
  clA: 5.0,           // lift slope per rad
  aStall: 0.42,       // rad (~24 deg) CL peak
  aFbw: 0.43,         // FBW AoA limit
  gMax: 10,
  gMin: -3,
  rollMax: 4.0,       // rad/s (~230 deg/s)
  betaMax: 0.1,       // rad sideslip from full rudder
  cyb: 0.9,
  brakeCd: 0.04,
  maxThrottle: 1.2,   // >1 = afterburner
};

export function airDensity(h) { return 1.225 * Math.exp(-Math.max(0, h) / 8500); }
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
function smooth(a, b, x) { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }

export function liftCoef(a, F = JET) {
  const x = Math.abs(a);
  if (x <= F.aStall) return F.clA * a;
  const peak = F.clA * F.aStall;
  return Math.sign(a) * Math.max(0.5, peak - (x - F.aStall) * 2.5);
}

const _vh = new THREE.Vector3(), _ld = new THREE.Vector3(), _sd = new THREE.Vector3();
const _a = new THREE.Vector3(), _ap = new THREE.Vector3(), _w = new THREE.Vector3();
const _t = new THREE.Vector3(), _dq = new THREE.Quaternion();

export class Aircraft {
  constructor(name = 'Pilot', type = DEFAULT_JET) {
    this.name = name;
    this.setType(type);
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.acc = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.omega = new THREE.Vector3();
    this.prevPos = new THREE.Vector3();
    this.fwd = new THREE.Vector3(0, 0, -1);
    this.up = new THREE.Vector3(0, 1, 0);
    this.right = new THREE.Vector3(1, 0, 0);
    this.isRemote = false;
    this.reset(new THREE.Vector3(0, 3000, 0), new THREE.Quaternion(), 240);
  }

  get ab() { return this.throttle > 1.001; }
  get radarMode() { return this.alive && !this.radarSilent && !(this.dmg && this.dmg.radar >= 1) ? (this.radar.stt ? 2 : 1) : 0; }
  get missiles() { let n = 0; for (const s of this.stores) if (s) n++; return n; }

  // Jet type: flight model, sensors, gun and stations all come from aircraft.js.
  setType(key) {
    this.type = JETS[key] ? key : DEFAULT_JET;
    this.T = jetOf(this.type);
    this.F = this.T.flight;
    this.gunT = GUNS[this.T.gun];
    this.radarT = RADARS[this.T.radar];
  }
  setLoadout(key) {
    const L = this.T.loadouts;
    this.loadout = L[key] ? key : this.T.loadoutKeys[0];
    this.stores = L[this.loadout].st.slice();
    this.updateStores();
    this.weapon = countOf(this.stores, 'mrm') > 0 ? 'mrm' : 'srm';
  }
  // Stores add mass; external ones add drag (internal bays add none).
  updateStores() {
    let m = 0, d = 0;
    this.stores.forEach((s, i) => {
      if (!s) return;
      const bay = this.T.stations[i][3] === 'bay';
      m += WEAPONS[s].mass + (bay ? 0 : 25);
      if (!bay) d += WEAPONS[s].drag;
    });
    this.mass = this.F.mass + m;
    this.storeCd = d;
  }

  reset(pos, quat, speed, loadout = this.loadout) {
    this.pos.copy(pos); this.prevPos.copy(pos);
    this.quat.copy(quat);
    this.updateAxes();
    this.vel.copy(this.fwd).multiplyScalar(speed);
    this.acc.set(0, 0, 0); this.omega.set(0, 0, 0);
    this.throttle = 1.0; this.eng = 1.0;
    this.p = 0;
    this.alpha = 0; this.beta = 0; this.g = 1; this.maxG = 1;
    this.mach = speed / SOUND_SPEED; this.speed = speed;
    this.hp = 100; this.alive = true;
    this.gloc = 0; this.blackedOut = false;
    this.airbrake = false;
    this.flaps = 0; this.gear = false; this.trim = 0;
    this.dmg = { eng: 0, wingL: 0, wingR: 0, tail: 0, radar: 0, fuel: 0 };
    this.fireT = 0; this.landed = null;
    this.setLoadout(loadout);
    this.gunAmmo = this.T.ammo; this.flares = this.T.flares; this.chaff = this.T.chaff;
    this.irst = { contact: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), mem: 0 };
    this.gunSpin = 0; this.gunAcc = 0; this.firing = false;
    this.radar = newRadar(); this.lastSide = 1; this.offBore = 99;
    this.lockProgress = 0; this.locked = false; this.inCone = false;
    this.missileCd = 0; this.flareCd = 0;
    this.outOfBounds = 0;
  }

  updateAxes() {
    this.fwd.set(0, 0, -1).applyQuaternion(this.quat);
    this.up.set(0, 1, 0).applyQuaternion(this.quat);
    this.right.set(1, 0, 0).applyQuaternion(this.quat);
  }

  // inp: { pitch, roll, yaw in [-1,1], throttle in [0,1.2], airbrake bool }
  step(dt, inp, groundFn) {
    if (!this.alive) return null;
    this.updateAxes();
    const F = this.fwd, U = this.up, R = this.right;
    const V = Math.max(this.vel.length(), 1);
    const vhat = _vh.copy(this.vel).divideScalar(V);
    const rho = airDensity(this.pos.y);
    const qbar = 0.5 * rho * V * V;
    const JF = this.F;
    const qS = qbar * JF.S;
    const m = this.mass;

    const vF = this.vel.dot(F), vU = this.vel.dot(U), vR = this.vel.dot(R);
    this.alpha = Math.atan2(-vU, vF);
    this.beta = Math.atan2(vR, Math.hypot(vF, vU));
    this.speed = V;
    this.mach = V / SOUND_SPEED;

    // ---- FBW pitch: G command (neutral stick holds the flight path) ----
    const D = this.dmg;
    let pitchIn = clamp(inp.pitch + (inp.trim || 0), -1, 1);
    if (this.blackedOut) pitchIn = Math.min(pitchIn, 0.1);
    // flaps and gear: commanded by the pilot, but flaps blow back up when the jet is too fast for them
    if (inp.flaps != null) this.flaps = inp.flaps;
    if (inp.gear != null) this.gear = inp.gear;
    if (this.flaps > 0 && V > FLAP_VMAX) this.flaps = 0;
    const flap = this.flaps;
    const gMaxD = JF.gMax * (1 - 0.35 * Math.max(D.wingL, D.wingR) - 0.2 * D.tail) * (flap > 0 ? 0.75 : 1);
    const n0 = Math.max(0, U.y);
    const nCmd = pitchIn >= 0 ? n0 + pitchIn * (gMaxD - n0) : n0 + pitchIn * (n0 - JF.gMin);
    const clA = JF.clA * (1 + 0.12 * flap), cl0 = 0.35 * flap;
    const clCmd = (nCmd * m * GRAV) / Math.max(qS, 1);
    const alphaT = clamp((clCmd - cl0) / clA, -JF.aFbw * 0.6, JF.aFbw);

    // ---- Forces ----
    const cl = liftCoef(this.alpha, JF) * (1 + 0.12 * flap) + cl0 * clamp(1 - Math.abs(this.alpha) / (JF.aStall + 0.1), 0, 1);
    const wingLoss = 1 - 0.3 * (D.wingL + D.wingR) / 2;
    const lift = qS * cl * wingLoss;
    const liftDir = _ld.crossVectors(R, vhat).normalize();
    const sideDir = _sd.crossVectors(vhat, U).normalize();
    const side = -qS * JF.cyb * this.beta;
    this.airbrake = !!inp.airbrake;
    const cd = JF.cd0 + JF.wave * smooth(0.85, 1.05, this.mach) + JF.k * cl * cl +
      (this.airbrake ? JF.brakeCd : 0) + 0.6 * this.beta * this.beta + this.storeCd +
      0.03 * flap + (this.gear ? 0.022 : 0) + 0.01 * (D.wingL + D.wingR + D.tail) +
      2.0 * Math.max(0, Math.abs(this.alpha) - 0.4) ** 2; // post-stall: the wing becomes an airbrake
    const drag = qS * cd;

    this.throttle = clamp(inp.throttle, 0, JF.maxThrottle);
    this.eng += (this.throttle - this.eng) * Math.min(1, dt * 1.6); // spool lag
    let thrust = this.eng <= 1 ? JF.thrMil * this.eng
      : JF.thrMil + (JF.thrAB - JF.thrMil) * ((this.eng - 1) / (JF.maxThrottle - 1));
    thrust *= Math.pow(rho / 1.225, 0.7) * (1 + 0.15 * this.mach);
    if (this.hp < 40) thrust *= 0.85;
    thrust *= 1 - 0.85 * D.eng;   // a damaged engine loses power; a destroyed one barely runs

    const a = _a.set(0, -GRAV, 0)
      .addScaledVector(liftDir, lift / m)
      .addScaledVector(sideDir, side / m)
      .addScaledVector(vhat, -drag / m)
      .addScaledVector(F, thrust / m);
    this.acc.copy(a);

    // accelerometer load factor along body up
    this.g = (a.x * U.x + (a.y + GRAV) * U.y + a.z * U.z) / GRAV;
    if (this.g > this.maxG) this.maxG = this.g;

    // ---- Rotation: follow flight path + track AoA/sideslip targets + roll ----
    const ap = _ap.copy(a).addScaledVector(vhat, -a.dot(vhat));
    const w = _w.crossVectors(vhat, ap).divideScalar(V);
    // thrust vectoring keeps pitch authority when there's too little airflow for the tail
    const auth = Math.max(clamp(qbar / 6000, 0.08, 1), JF.tvc * 0.6 * clamp(this.eng, 0, 1));
    w.addScaledVector(R, 7 * auth * (1 - 0.6 * D.tail) * (alphaT - this.alpha));
    const betaT = -inp.yaw * JF.betaMax;
    w.addScaledVector(U, 5 * auth * (betaT - this.beta));
    const rollAuth = Math.max(clamp(qbar / 14000, 0.12, 1), JF.tvc * 0.35) * (1 - 0.45 * (1 - JF.tvc * 0.5) * clamp(this.alpha / JF.aFbw, 0, 1));
    // a shot-up wing loses lift on one side: the jet rolls toward it unless the pilot holds it
    const pT = inp.roll * JF.rollMax * rollAuth * (1 - 0.45 * Math.max(D.wingL, D.wingR)) + (D.wingL - D.wingR) * 0.9 * clamp(qbar / 20000, 0, 1);
    this.p += (pT - this.p) * Math.min(1, dt * 10);
    w.addScaledVector(V > 30 ? vhat : F, this.p);
    this.omega.copy(w);

    // ---- Integrate ----
    this.vel.addScaledVector(a, dt);
    this.pos.addScaledVector(this.vel, dt);
    const ang = w.length() * dt;
    if (ang > 1e-9) {
      _dq.setFromAxisAngle(_t.copy(w).normalize(), ang);
      this.quat.premultiply(_dq).normalize();
    }

    // ---- Pilot G tolerance ----
    // ~13 s at 9 G or ~8 s at 10 G before blackout; 7.5 G and below is sustainable
    if (this.g > 7.5) this.gloc += ((this.g - 7.5) / 2.5) * 0.125 * dt;
    else if (this.g < -2) this.gloc += (-this.g - 2) * 0.3 * dt;
    else this.gloc -= 0.22 * dt;
    this.gloc = clamp(this.gloc, 0, 1.1);
    if (this.gloc >= 1) this.blackedOut = true;
    if (this.blackedOut && this.gloc < 0.45) this.blackedOut = false;

    // ---- Fire from a hit fuel tank ----
    if (this.fireT > 0) { this.fireT -= dt; this.hp -= 2.2 * dt; }

    // ---- Ground ----
    if (groundFn && this.pos.y < groundFn(this.pos.x, this.pos.z) + 1.5) return 'crash';
    return null;
  }
}

export const FLAP_VMAX = 135;   // m/s (~260 kt): faster than this the flaps retract on their own
export const GEAR_VMAX = 150;   // m/s (~290 kt): the gear can't be lowered faster than this
// Damage zones. `zone` comes from where the round or blast hit; `dmg` is in hit points.
const ZONE_HP = { eng: 45, wingL: 55, wingR: 55, tail: 45, radar: 30, fuel: 60 };
export const ZONE_NAMES = { eng: 'ENGINE', wingL: 'L WING', wingR: 'R WING', tail: 'TAIL', radar: 'RADAR', fuel: 'FUEL' };
export function damageZone(plane, zone, dmg) {
  const D = plane.dmg;
  if (!D || !(zone in D)) return;
  D[zone] = Math.min(1, D[zone] + dmg / ZONE_HP[zone]);
  if (zone === 'fuel' && Math.random() < dmg / 40) plane.fireT = Math.max(plane.fireT || 0, 6 + Math.random() * 8);
}
export function repair(plane) {
  plane.hp = 100; plane.fireT = 0;
  for (const k in plane.dmg) plane.dmg[k] = 0;
}

// Gun ballistics shared by the gunsight, AI and bullets. Bullets keep their launch
// direction and slow down with drag: |v| decays as v0 / (1 + k v0 t), so distance
// along the path is v0 * g(t) with g(t) = ln(1 + k v0 t) / (k v0).
export const MUZZLE_VEL = GUNS.m61.muzzle;
export function bulletDragK(alt, gun = GUNS.m61) { return gun.dragK * airDensity(alt) / 1.225; }
const _D = new THREE.Vector3(), _vb = new THREE.Vector3();
// Returns the unit aim direction needed to hit a target with drag and gravity.
export function computeLeadDir(shooterPos, shooterVel, tPos, tVel, out, gun = GUNS.m61) {
  const k = bulletDragK(shooterPos.y, gun), MV = gun.muzzle;
  let t = tPos.distanceTo(shooterPos) / (MV + shooterVel.length());
  out.copy(tPos).sub(shooterPos).normalize();
  for (let i = 0; i < 6; i++) {
    const v0 = _vb.copy(shooterVel).addScaledVector(out, MV).length();
    const g = Math.log(1 + k * v0 * t) / (k * v0);
    // muzzle * D * g = rel + tVel * t - shooterVel * g + 0.5 * G * t^2 (up)
    _D.copy(tPos).sub(shooterPos).addScaledVector(tVel, t).addScaledVector(shooterVel, -g);
    _D.y += 0.5 * GRAV * t * t;
    const gNeed = _D.length() / MV;
    out.copy(_D).normalize();
    const kv = k * v0 * gNeed;
    t = kv < 0.95 ? (Math.exp(k * v0 * gNeed) - 1) / (k * v0) : 6; // beyond ~5 s the round is spent
  }
  return out;
}
