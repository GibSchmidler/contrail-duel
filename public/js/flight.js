// Semi-realistic fly-by-wire jet flight model.
// Body axes: forward = -Z, up = +Y, right = +X (same as a Three.js camera).
// The FBW pitch channel is a G-command law with an AoA limiter, roll is a rate
// command about the velocity vector, and the rudder commands sideslip. Lift,
// induced drag, wave drag, thrust lapse with altitude and gravity are physical,
// so energy management (speed <-> altitude <-> turn rate) matters.
import * as THREE from 'three';

export const GRAV = 9.81;
export const SOUND_SPEED = 340;

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

export function liftCoef(a) {
  const x = Math.abs(a);
  if (x <= JET.aStall) return JET.clA * a;
  const peak = JET.clA * JET.aStall;
  return Math.sign(a) * Math.max(0.5, peak - (x - JET.aStall) * 2.5);
}

const _vh = new THREE.Vector3(), _ld = new THREE.Vector3(), _sd = new THREE.Vector3();
const _a = new THREE.Vector3(), _ap = new THREE.Vector3(), _w = new THREE.Vector3();
const _t = new THREE.Vector3(), _dq = new THREE.Quaternion();

export class Aircraft {
  constructor(name = 'Pilot') {
    this.name = name;
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

  reset(pos, quat, speed) {
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
    this.gunAmmo = 510; this.missiles = 4; this.flares = 30;
    this.gunHeat = 0; this.gunAcc = 0; this.firing = false;
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
    const qS = qbar * JET.S;
    const m = JET.mass;

    const vF = this.vel.dot(F), vU = this.vel.dot(U), vR = this.vel.dot(R);
    this.alpha = Math.atan2(-vU, vF);
    this.beta = Math.atan2(vR, Math.hypot(vF, vU));
    this.speed = V;
    this.mach = V / SOUND_SPEED;

    // ---- FBW pitch: G command (neutral stick holds the flight path) ----
    let pitchIn = inp.pitch;
    if (this.blackedOut) pitchIn = Math.min(pitchIn, 0.1);
    const n0 = Math.max(0, U.y);
    const nCmd = pitchIn >= 0 ? n0 + pitchIn * (JET.gMax - n0) : n0 + pitchIn * (n0 - JET.gMin);
    const clCmd = (nCmd * m * GRAV) / Math.max(qS, 1);
    const alphaT = clamp(clCmd / JET.clA, -JET.aFbw * 0.6, JET.aFbw);

    // ---- Forces ----
    const cl = liftCoef(this.alpha);
    const lift = qS * cl;
    const liftDir = _ld.crossVectors(R, vhat).normalize();
    const sideDir = _sd.crossVectors(vhat, U).normalize();
    const side = -qS * JET.cyb * this.beta;
    this.airbrake = !!inp.airbrake;
    const cd = JET.cd0 + JET.wave * smooth(0.85, 1.05, this.mach) + JET.k * cl * cl +
      (this.airbrake ? JET.brakeCd : 0) + 0.6 * this.beta * this.beta;
    const drag = qS * cd;

    this.throttle = clamp(inp.throttle, 0, JET.maxThrottle);
    this.eng += (this.throttle - this.eng) * Math.min(1, dt * 1.6); // spool lag
    let thrust = this.eng <= 1 ? JET.thrMil * this.eng
      : JET.thrMil + (JET.thrAB - JET.thrMil) * ((this.eng - 1) / (JET.maxThrottle - 1));
    thrust *= Math.pow(rho / 1.225, 0.7) * (1 + 0.15 * this.mach);
    if (this.hp < 40) thrust *= 0.85;

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
    const auth = clamp(qbar / 6000, 0.08, 1);
    w.addScaledVector(R, 7 * auth * (alphaT - this.alpha));
    const betaT = -inp.yaw * JET.betaMax;
    w.addScaledVector(U, 5 * auth * (betaT - this.beta));
    const rollAuth = clamp(qbar / 14000, 0.12, 1) * (1 - 0.45 * clamp(this.alpha / JET.aFbw, 0, 1));
    const pT = inp.roll * JET.rollMax * rollAuth;
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

    // ---- Ground ----
    if (groundFn && this.pos.y < groundFn(this.pos.x, this.pos.z) + 1.5) return 'crash';
    return null;
  }
}

// Gun ballistics shared by the gunsight, AI and bullets.
export const MUZZLE_VEL = 1050;
const _D = new THREE.Vector3(), _rv = new THREE.Vector3();
// Returns the unit aim direction needed to hit a target (no drag, gravity only).
export function computeLeadDir(shooterPos, shooterVel, tPos, tVel, out) {
  const rel = out.copy(tPos).sub(shooterPos);
  _rv.copy(tVel).sub(shooterVel);
  let t = rel.length() / MUZZLE_VEL;
  for (let i = 0; i < 4; i++) {
    _D.copy(rel).addScaledVector(_rv, t);
    _D.y += 0.5 * GRAV * t * t;
    t = _D.length() / MUZZLE_VEL;
  }
  return out.copy(_D).normalize();
}
