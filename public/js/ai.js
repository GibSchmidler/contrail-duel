// Practice AI. It flies the same flight model with the same weapons through the
// same control inputs a human uses, with skill-dependent reaction time, aim and G use.
import * as THREE from 'three';
import { computeLeadDir } from './flight.js';
import { groundHeight, ARENA_RADIUS } from './world.js';

export const SKILLS = {
  drone:  { label: 'Target drone', react: 0.5, maxPull: 0.55, aimTol: 0, gunRange: 0, missiles: false, mslCd: 99, flareP: 0, defend: false },
  rookie: { label: 'Rookie', react: 0.45, maxPull: 0.7, aimTol: 0.035, aimNoise: 0.025, gunRange: 900, missiles: true, mslCd: 16, flareP: 0.35, defend: true },
  pilot:  { label: 'Veteran', react: 0.25, maxPull: 0.88, aimTol: 0.022, aimNoise: 0.012, gunRange: 1100, missiles: true, mslCd: 9, flareP: 0.75, defend: true },
  ace:    { label: 'Ace', react: 0.12, maxPull: 1.0, aimTol: 0.016, aimNoise: 0.004, gunRange: 1300, missiles: true, mslCd: 6, flareP: 0.95, defend: true },
};

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const _d = new THREE.Vector3(), _aim = new THREE.Vector3(), _tp = new THREE.Vector3(), _tv = new THREE.Vector3(), _t = new THREE.Vector3(), _lead = new THREE.Vector3();

// Fly the nose toward a world direction using bank-and-pull, like a pilot.
export function steer(plane, dir, maxPull, out) {
  const x = dir.dot(plane.right), y = dir.dot(plane.up), z = dir.dot(plane.fwd);
  const ang = Math.acos(clamp(z, -1, 1));
  if (ang < 0.1 && z > 0) {
    out.pitch = clamp(y * 16 + 0.0, -1, 1);
    out.yaw = clamp(x * 14, -1, 1);
    out.roll = clamp(x * 6 - plane.p * 0.15, -1, 1) * 0.6;
  } else {
    const rollErr = Math.atan2(x, y);
    out.roll = clamp(rollErr * 2.4 - plane.p * 0.28, -1, 1);
    const align = Math.cos(rollErr);
    out.pitch = align > 0.25 ? clamp(ang * 2.6, 0, 1) * align : (ang > 1.4 ? 0.2 : 0);
    out.yaw = 0;
  }
  out.pitch = Math.min(out.pitch, maxPull);
  return out;
}

export class AIPilot {
  constructor(plane, skillKey) {
    this.plane = plane;
    this.skill = SKILLS[skillKey] || SKILLS.pilot;
    this.hist = [];
    this.time = 0;
    this.burstT = 0;
    this.missileCd = 6;
    this.flareCd = 0;
    this.wobble = new THREE.Vector3();
    this.wobbleT = 0;
    this.defendingId = null;
    this.willFlare = false;
    this.out = { pitch: 0, roll: 0, yaw: 0, throttle: 1, airbrake: false, gun: false, missile: false, flare: false };
  }

  reset() { this.hist.length = 0; this.missileCd = 4 + Math.random() * 4; this.burstT = 0; this.defendingId = null; }

  // Target state the AI "perceives": delayed by reaction time, then extrapolated.
  perceive(target) {
    this.hist.push({ t: this.time, p: target.pos.clone(), v: target.vel.clone() });
    while (this.hist.length > 2 && this.hist[1].t < this.time - this.skill.react) this.hist.shift();
    const h = this.hist[0];
    const lag = this.time - h.t;
    _tp.copy(h.p).addScaledVector(h.v, lag);
    _tv.copy(h.v);
  }

  update(dt, target, combat) {
    const P = this.plane, S = this.skill, o = this.out;
    this.time += dt;
    this.missileCd -= dt; this.flareCd -= dt; this.burstT -= dt;
    o.gun = false; o.missile = false; o.flare = false; o.airbrake = false;
    if (!P.alive) return o;
    if (!target || !target.alive) { // victory lap
      _d.copy(P.fwd); _d.y = 0.05; _d.normalize();
      steer(P, _d, 0.4, o); o.throttle = 0.8; return o;
    }
    this.perceive(target);

    const speed = P.speed;
    const rel = _t.copy(_tp).sub(P.pos);
    const dist = rel.length();
    let maxPull = S.maxPull;
    o.throttle = 1.0;

    // ---------- priority 1: terrain ----------
    const look = Math.max(3, Math.min(8, speed / 60));
    const gAhead = Math.max(groundHeight(P.pos.x, P.pos.z), groundHeight(P.pos.x + P.vel.x * look, P.pos.z + P.vel.z * look));
    const agl = P.pos.y - gAhead;
    const futureAlt = P.pos.y + P.vel.y * look;
    if (agl < 650 || futureAlt < gAhead + 350) {
      _d.copy(P.vel); _d.y = 0; _d.normalize(); _d.y = 1.6; _d.normalize();
      steer(P, _d, 1.0, o); o.throttle = 1.2;
      return o;
    }
    // ---------- priority 2: arena boundary ----------
    if (Math.hypot(P.pos.x, P.pos.z) > ARENA_RADIUS - 1500) {
      _d.set(-P.pos.x, 0, -P.pos.z).normalize(); _d.y = (3000 - P.pos.y) / 4000; _d.normalize();
      steer(P, _d, 0.8, o); o.throttle = 1.1; return o;
    }

    // ---------- target drone: lazy circuit ----------
    if (S.label === 'Target drone') {
      const a = this.time * 0.08;
      _d.set(Math.cos(a), (3200 - P.pos.y) / 3000, Math.sin(a)).normalize();
      steer(P, _d, S.maxPull, o); o.throttle = 0.75; return o;
    }

    // ---------- priority 3: missile defense ----------
    const threats = combat.threatsTo(P);
    let threat = null, tDist = 1e9;
    for (const m of threats) { const d = m.pos.distanceTo(P.pos); if (d < tDist) { tDist = d; threat = m; } }
    if (S.defend && threat && tDist < 4500) {
      if (this.defendingId !== threat.id) { this.defendingId = threat.id; this.willFlare = Math.random() < S.flareP; }
      // beam the missile: fly perpendicular to its line of sight, slightly nose low
      const los = _aim.copy(P.pos).sub(threat.pos).normalize();
      _d.crossVectors(los, _t.set(0, 1, 0)).normalize();
      if (_d.dot(P.fwd) < 0) _d.negate();
      _d.y = P.pos.y > 2200 ? -0.25 : 0.1; _d.normalize();
      steer(P, _d, tDist < 1500 ? 1.0 : maxPull, o);
      o.throttle = tDist < 1800 && S.flareP > 0.7 ? 0.4 : 1.15;
      if (this.willFlare && tDist < 2000 && this.flareCd <= 0) { o.flare = true; this.flareCd = 0.45; }
      return o;
    }

    // ---------- offense ----------
    computeLeadDir(P.pos, P.vel, _tp, _tv, _lead);
    const losDir = _d.copy(rel).divideScalar(dist);
    const closing = -rel.dot(_aim.copy(_tv).sub(P.vel)) / dist;
    const offBore = Math.acos(clamp(losDir.dot(P.fwd), -1, 1));

    if (dist < 1700) {
      _aim.copy(_lead);
      // imperfect aim wobble for lower skill
      this.wobbleT -= dt;
      if (this.wobbleT <= 0) { this.wobbleT = 0.6; this.wobble.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(S.aimNoise * 2); }
      _aim.add(this.wobble).normalize();
    } else {
      _aim.copy(_tp).addScaledVector(_tv, Math.min(dist / 700, 3)).sub(P.pos).normalize();
    }
    // overshoot control: about to fly past a turning target -> lag pursuit + throttle back
    if (dist < 700 && closing > 110 && offBore > 0.35) {
      _aim.copy(_tp).addScaledVector(_tv, -0.8).sub(P.pos).normalize();
      o.throttle = 0.3; o.airbrake = closing > 160;
    } else if (speed < 140) {
      _aim.y -= 0.35; _aim.normalize(); o.throttle = 1.2; maxPull = Math.min(maxPull, 0.6);
    } else if (dist > 3000 || speed < 200) {
      o.throttle = 1.2;
    } else if (dist < 1200 && closing > 60) {
      o.throttle = 0.7;
    }

    steer(P, _aim, maxPull, o);

    // ---------- weapons ----------
    const aimErr = Math.acos(clamp(_lead.dot(P.fwd), -1, 1));
    // only aces take high-closure head-on snapshots
    const headOn = closing > 350 && -target.fwd.dot(losDir) > 0.8;
    const shotOk = !headOn || S.label === 'Ace';
    if (shotOk && dist < S.gunRange && aimErr < S.aimTol + 2.2 / Math.max(dist, 50) && P.gunAmmo > 0) this.burstT = 0.25 + Math.random() * 0.35;
    if (this.burstT > 0 && dist < S.gunRange * 1.15) o.gun = true;
    if (S.missiles && P.locked && P.missiles > 0 && this.missileCd <= 0 && dist > 700 && dist < 3800) {
      o.missile = true; this.missileCd = S.mslCd * (0.7 + Math.random() * 0.6);
    }
    return o;
  }
}
