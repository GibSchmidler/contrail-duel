// AI pilots. They fly the same flight model with the same weapons and sensors through the same
// control inputs a human uses. What they do is shaped by a profile: abilities (reflexes,
// awareness, gunnery, flying, tactics) and temperament (aggression, courage, teamwork, preferred
// range), plus orders from the scenario (hunt, patrol, escort, ambush, target drone).
import * as THREE from 'three';
import { computeLeadDir, airDensity } from './flight.js';
import { WEAPONS, firstOf, countOf, flyout, launchZone, agKinds } from './arsenal.js';
import { impactPoint } from './strike.js';
import { groundHeight, lineOfSight, ARENA_RADIUS, visRange } from './world.js';
import { aiDefault } from './scenario.js';

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const L = (a, b, t) => a + (b - a) * clamp(t, 0, 1);
const _d = new THREE.Vector3(), _aim = new THREE.Vector3(), _tp = new THREE.Vector3(), _tv = new THREE.Vector3(), _t = new THREE.Vector3(), _lead = new THREE.Vector3(), _u = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

// Turn 0-100 stats into the numbers the pilot logic uses.
export function profile(cfg) {
  const s = {};
  for (const k in cfg.st) s[k] = cfg.st[k] / 100;
  const style = cfg.style || 'mixed';
  return {
    cfg, s, style,
    drone: cfg.ord === 'drone',
    react: L(0.6, 0.07, s.reflex),                       // perception delay (s)
    notice: L(1.5, 0.1, s.aware),                        // delay before reacting to a new warning (s)
    rearSpot: L(0.3, 1.0, s.aware),                      // fraction of visual range it spots jets behind it
    aimTol: L(0.045, 0.012, s.gun), aimNoise: L(0.045, 0.003, s.gun),
    gunRange: L(650, 1300, s.gun) + s.agg * 250,
    burst: L(1.1, 0.3, s.gun),                           // poor gunners hold the trigger down
    maxPull: L(0.6, 1.0, s.fly),
    minAgl: L(900, 260, s.fly * (0.5 + 0.5 * s.agg)),    // how low it dares to fly
    speedFloor: L(115, 175, s.tac * 0.6 + s.fly * 0.4),  // energy management
    flareP: L(0.25, 0.97, s.tac), notch: L(0.08, 0.95, s.tac),
    crank: s.tac > 0.45, drag: s.tac > 0.55 && s.agg < 0.65, terrain: s.tac > 0.6,
    mrmFrac: style === 'bvr' ? L(0.6, 0.85, s.agg) : style === 'wvr' ? L(0.35, 0.55, s.agg) : L(0.5, 0.85, s.agg),
    coldShot: s.tac < 0.5,                               // wastes long shots on targets running away
    salvo: s.agg > 0.8,
    mslCd: L(15, 4, (s.tac + s.agg) / 2),
    defendRadar: L(22000, 7000, s.agg * 0.7 + s.nerve * 0.3),
    defendIr: L(5500, 2600, s.agg),
    headOnGun: s.agg > 0.72,
    fearK: L(1.8, 0.25, s.nerve), fearless: s.nerve >= 0.95,
    team: s.team,
    keepRange: style === 'bvr' ? L(7000, 4000, s.agg) : 0,
    closeIn: style === 'wvr',
  };
}

// Fly the nose toward a world direction using bank-and-pull, like a pilot.
export function steer(plane, dir, maxPull, out) {
  const x = dir.dot(plane.right), y = dir.dot(plane.up), z = dir.dot(plane.fwd);
  const ang = Math.acos(clamp(z, -1, 1));
  if (ang < 0.1 && z > 0) {
    out.pitch = clamp(y * 16, -1, 1);
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
  // a degenerate direction must never freeze the controls
  if (!(Number.isFinite(out.pitch) && Number.isFinite(out.roll) && Number.isFinite(out.yaw))) { out.pitch = 0.3; out.roll = 0; out.yaw = 0; }
  return out;
}

export class AIPilot {
  // cfg: an AI config from scenario.aiConfig(), or an experience key ('rookie', 'pilot', 'ace', 'drone')
  constructor(plane, cfg) {
    this.plane = plane;
    this.setConfig(typeof cfg === 'string' || !cfg ? aiDefault(cfg || 'pilot') : cfg);
    this.hist = [];
    this.time = 0;
    this.wobble = new THREE.Vector3();
    this.out = { pitch: 0, roll: 0, yaw: 0, throttle: 1, airbrake: false, gun: false, missile: false, flare: false, chaff: false, weapon: 'srm', wantStt: false };
    this.reset();
  }
  setConfig(cfg) { this.A = profile(cfg); }

  reset() {
    this.target = null; this.hist.length = 0; this.lastKnown = null; this.zone = null; this.zoneT = 0;
    this.missileCd = 4 + Math.random() * 4; this.burstT = 0; this.flareCd = 0; this.supportT = 0; this.wobbleT = 0;
    this.defendingId = null; this.threatOn = false; this.noticeT = 0;
    this.fear = 0; this.broken = false; this.rtb = false; this.lastHp = 100; this.friendsAlive = null; this.enemiesAlive = null;
    this.committed = false; this.lostT = 0; this.extendT = 0; this.salvoLeft = 0; this.sayT = 0; this.mode = 'search';
    this.plane.radarSilent = false;
    this.routeI = 0; this.agTgt = null; this.agPhase = null; this.agCd = 0; this.diving = false; this.command = this.command || null;
    this.out.agKey = null; this.out.agTgt = null; this.out.land = false; this.out.gear = false;
  }
  // Rearmed and launched from the carrier: back to its orders with a clear head.
  relaunched() { this.rtb = false; this.broken = false; this.fear = 0; this.lastHp = this.plane.hp; this.agTgt = null; this.agPhase = null; if (this.command && this.command.type === 'rtb') this.command = null; }

  // Orders from a human flight lead over the radio.
  //  attack: shoot my target · cover: escort me · rejoin: formation, don't engage · ground: attack ground targets
  //  rtb: go home (land and rearm on the carrier if there is one) · hold / free: weapons hold / free
  order(type, leader, tgt) {
    if (type === 'free') { this.holdFire = false; return; }
    if (type === 'hold') { this.holdFire = true; return; }
    if (type === 'rtb') { this.rtb = true; this.broken = true; }
    else if (this.command && this.command.type === 'rtb') { this.rtb = false; this.broken = false; this.fear = Math.min(this.fear, 0.3); }
    this.command = { type, leader, tgt: tgt || null };
    if (type === 'attack' && tgt) { this.target = tgt; this.hist.length = 0; }
    if (type === 'ground') { this.agTgt = tgt && tgt.unit ? tgt : null; this.agPhase = null; }
  }

  say(ctx, text) { if (ctx.say && this.sayT <= 0) { ctx.say(text); this.sayT = 6; } }

  // Choose whom to fight among the enemies this jet knows about (own sensors + datalink picture).
  pickTarget(enemies, picture, ctx = {}) {
    const P = this.plane, A = this.A, vis = visRange();
    const cmd = this.command;
    if (cmd && cmd.type === 'attack' && cmd.tgt && cmd.tgt.alive && enemies.includes(cmd.tgt)) { this.target = cmd.tgt; return cmd.tgt; }
    const score = (e) => {
      const c = picture && picture.get(e);
      if (!c) return 1e12;
      _d.copy(c.pos).sub(P.pos);
      const d = _d.length();
      const ahead = _d.divideScalar(d || 1).dot(P.fwd);
      // an eyeball sighting behind it is only noticed by an alert pilot
      if (c.eyes && !c.radar && !c.irst && !c.dl && ahead < 0 && d > vis * A.rearSpot) return 1e12;
      let sc = d * (1 + Math.acos(clamp(ahead, -1, 1)) * 0.8) * (c.fresh ? 1 : 1.3);
      const pri = A.cfg.pri;
      if (pri === 'humans' && e.ent && e.ent.human) sc *= 0.3;
      if (pri === 'weak') sc *= 0.35 + 0.65 * Math.max(0, e.hp) / 100;
      // enemies that threaten me or a friend (locking them, or sitting on their tail)
      let threatK = e.lockTgt === P ? 1 : 0;
      if (ctx.friends) for (const f of ctx.friends) {
        if (f === P || !f.alive) continue;
        if (e.lockTgt === f) threatK = Math.max(threatK, 0.6);
        if (e.pos.distanceTo(f.pos) < 3000 && _t.copy(f.pos).sub(e.pos).normalize().dot(e.fwd) > 0.8) threatK = Math.max(threatK, 0.9);
      }
      sc *= 1 - (pri === 'threat' ? 0.65 : 0.5 * A.team) * threatK;
      // team players split the targets between the flight
      if (A.team > 0.4 && ctx.friends) { let n = 0; for (const f of ctx.friends) if (f !== P && f.alive && f.tgt === e) n++; sc *= 1 + n * 0.6 * A.team; }
      return sc;
    };
    let best = null, bs = 1e12;
    for (const e of enemies) { if (!e.alive) continue; const sc = score(e); if (sc < bs) { bs = sc; best = e; } }
    const cur = this.target;
    if (cur && cur.alive && enemies.includes(cur)) {
      const cs = score(cur);
      if (cs < 1e12 && cs < bs * 1.6) return cur;
      if (!best) return cur;
    }
    if (!best) {
      // nothing known: head for the nearest enemy's area without knowing exactly where it is
      for (const e of enemies) if (e.alive && (!best || e.pos.distanceToSquared(P.pos) < best.pos.distanceToSquared(P.pos))) best = e;
    }
    if (best !== this.target) { this.hist.length = 0; this.lastKnown = null; this.zone = null; }
    this.target = best;
    return best;
  }

  // Target state the AI "perceives": delayed by reaction time, then extrapolated.
  perceive(pos, vel) {
    this.hist.push({ t: this.time, p: pos.clone(), v: vel.clone() });
    while (this.hist.length > 2 && this.hist[1].t < this.time - this.A.react) this.hist.shift();
    const h = this.hist[0];
    const lag = this.time - h.t;
    _tp.copy(h.p).addScaledVector(h.v, lag);
    _tv.copy(h.v);
  }

  // ---------- morale: fear builds under fire, when outnumbered and when friends die ----------
  morale(dt, threat, ctx) {
    const P = this.plane, A = this.A;
    let f = this.fear;
    const loss = Math.max(0, this.lastHp - P.hp); this.lastHp = P.hp;
    f += (loss / 100) * 2.2 * A.fearK;
    // ongoing danger pushes fear toward a ceiling set by courage, rather than without limit
    let calm = true, level = 0;
    if (threat) {
      if (threat.active || threat.launch || threat.maws) level = 0.75;
      else if (threat.lock) level = 0.4;
    }
    if (ctx.friends && ctx.picture) {
      let fr = 0, en = 0;
      for (const x of ctx.friends) if (x.alive && x.pos.distanceTo(P.pos) < 20000) fr++;
      for (const [e, c] of ctx.picture) if (e.alive && c.pos.distanceTo(P.pos) < 20000) en++;
      if (en > fr) level += 0.2 * (en - fr);
    }
    // fear rises toward the level the danger justifies, and relaxes back down to it
    const ceil = level * A.fearK;
    if (f < ceil) f += (ceil - f) * Math.min(1, dt * 0.25);
    else f = Math.max(ceil, f - dt * 0.03 * (0.5 + A.s.nerve));
    if (level > 0) calm = false;
    if (ctx.friends && ctx.picture) {
      const fa = ctx.friends.filter((x) => x.alive).length;
      if (this.friendsAlive != null && fa < this.friendsAlive) f += 0.3 * A.fearK * (this.friendsAlive - fa);
      this.friendsAlive = fa;
    }
    if (ctx.enemies) {
      const ea = ctx.enemies.filter((x) => x.alive).length;
      if (this.enemiesAlive != null && ea < this.enemiesAlive) f -= 0.25 * (this.enemiesAlive - ea);
      this.enemiesAlive = ea;
    }
    this.fear = clamp(f, 0, 1.5);
    if (!this.broken && !A.fearless && this.fear > 1) {
      this.broken = true;
      this.say(ctx, P.hp < 50 ? "I'm hit, breaking off!" : threat && (threat.active || threat.launch) ? 'Missile on me, I\'m out of here!' : 'Too hot, breaking off!');
    } else if (this.broken && this.fear < 0.35 && P.hp > 40 && !this.rtb) {
      this.broken = false;
      this.say(ctx, 'Back in the fight.');
    }
  }

  // Highest ground along the flight path over the next `secs` seconds (so a ridge in between isn't missed).
  groundAhead(secs) {
    const P = this.plane;
    let g = groundHeight(P.pos.x, P.pos.z);
    for (let t = 0.5; t <= secs; t += 0.5) g = Math.max(g, groundHeight(P.pos.x + P.vel.x * t, P.pos.z + P.vel.z * t));
    return g;
  }

  // ---------- manoeuvres ----------
  orbit(center, radius, alt, o, thr = 0.85) {
    const P = this.plane;
    _t.set(P.pos.x - center.x, 0, P.pos.z - center.z);
    const r = Math.max(1, _t.length());
    _t.divideScalar(r);
    _d.set(-_t.z, 0, _t.x).addScaledVector(_t, clamp((radius - r) / radius, -1, 1) * 1.4);
    _d.y = clamp((alt - P.pos.y) / 2500, -0.5, 0.5);
    steer(P, _d.normalize(), 0.55, o);
    o.throttle = thr; o.wantStt = false;
  }
  formation(lead, idx, o) {
    const P = this.plane;
    const k = Math.ceil(idx / 2) || 1, side = idx % 2 ? 1 : -1;
    _t.copy(lead.pos).addScaledVector(lead.right, side * 700 * k).addScaledVector(lead.fwd, -350 * k);
    _t.y = Math.max(_t.y, groundHeight(_t.x, _t.z) + this.A.minAgl + 200);
    _aim.copy(_t).addScaledVector(lead.vel, 2.5).sub(P.pos);
    const along = _t.sub(P.pos).dot(lead.fwd);
    steer(P, _aim.normalize(), 0.7, o);
    o.throttle = clamp((lead.eng ?? lead.throttle ?? 1) + along / 500, 0.45, 1.2);
    o.wantStt = false;
  }

  // Return fire at the bandit before defending, if it is locked and inside the launch zone.
  counterShot(dt, target, ctx, o) {
    const P = this.plane, C = this.A.cfg;
    if (C.wpn !== 'all' || this.missileCd > 0 || !target || !target.alive || !P.radar.stt || P.tgt !== target) return false;
    const mKey = firstOf(P.stores, 'mrm');
    if (!mKey) return false;
    const dist = P.radar.pos.distanceTo(P.pos);
    _t.copy(P.radar.pos).sub(P.pos).divideScalar(dist);
    if (_t.dot(P.fwd) < Math.cos(0.35)) return false;
    const zone = launchZone(flyout(mKey, P.speed, airDensity(P.pos.y)), -_t.dot(P.radar.vel), P.radar.vel.length());
    if (dist > zone.rMax * 0.9 || dist < zone.rMin) return false;
    o.weapon = 'mrm'; o.wantStt = true;
    if (P.weapon !== 'mrm') return false; // selects the missile this frame, fires next
    o.missile = true; this.missileCd = this.A.mslCd; this.supportT = WEAPONS[mKey].guidance === 'sarh' ? 45 : 22;
    this.say(ctx, 'Fox 3, returning fire!');
    steer(P, _t, 0.3, o); o.throttle = 1.1;
    return true;
  }

  // ---------- carrier recovery: fly the approach, gear down, and let the deck crew catch it ----------
  approach(carrier, o) {
    const P = this.plane, u = carrier, D = u.D.deck;
    const SLOPE = Math.tan(0.061);                                    // 3.5 degree glideslope
    const td = u.fromDeck(-D.len / 2 + 55, 0, _u);                    // touchdown point on the deck
    const back = _t.set(-Math.sin(u.hdgR), 0, Math.cos(u.hdgR));     // astern
    const q = u.toDeck(P.pos);
    const behind = (-D.len / 2 + 55) - q.along;                       // metres short of the touchdown point
    const fwdAlong = -(P.fwd.x * back.x + P.fwd.z * back.z);
    if (this.onFinal && (behind < -40 || Math.abs(q.across) > 150 + Math.max(0, behind) * 0.1 || fwdAlong < 0.55)) {
      this.onFinal = false; this.waveT = 8;                            // waved off: go round again
    }
    this.waveT = (this.waveT || 0) - 1 / 60;
    let goal;
    if (!this.onFinal) {
      if (behind > 2500 && Math.abs(q.across) < behind * 0.22 && fwdAlong > 0.8 && this.waveT <= 0) this.onFinal = true;
      else {
        // fly out to the extended centerline astern, then turn in along it
        goal = _d.copy(td).addScaledVector(back, 7000); goal.y = td.y + 450;
        if (behind > 6000 || Math.hypot(P.pos.x - goal.x, P.pos.z - goal.z) < 2000) {
          // at the initial point: point up the centerline toward the ship
          goal.copy(td).addScaledVector(back, Math.max(0, behind - 2500)); goal.y = td.y + SLOPE * Math.max(0, behind - 2500) + 40;
        }
      }
    }
    if (this.onFinal) {
      // a carrot on the centerline and the glideslope a little ahead
      const look = clamp(behind * 0.3, 200, 1400);
      const cd = Math.max(0, behind - look);
      goal = _d.copy(td).addScaledVector(back, cd); goal.y = td.y + SLOPE * cd + 2;
    }
    // steer the flight path (not the nose) at the goal: add back the angle of attack
    const dir = _aim.copy(goal).sub(P.pos).normalize();
    _tv.copy(P.vel).normalize();
    dir.add(_lead.copy(P.fwd).sub(_tv)).normalize();
    steer(P, dir, 0.6, o);
    const want = this.onFinal ? 76 : 125;
    o.throttle = clamp(0.5 + (want - P.speed) * 0.05, 0.1, 1.0);
    o.airbrake = P.speed > want + 25;
    o.gear = this.onFinal || behind < 9000 && Math.abs(q.across) < 4000;
    o.flaps = this.onFinal ? 1 : P.speed < 135 ? 0.5 : 0;
    o.wantStt = false;
    // over the deck and nearly down: the AI's trap is assisted from here
    if (this.onFinal && u.onDeck(P.pos) && q.y < 25 && Math.abs(q.across) < 30 && P.speed < 110) o.land = true;
    this.mode = 'recover';
    return o;
  }

  // ---------- ground attack ----------
  strike(dt, ctx, o, keys) {
    const P = this.plane, A = this.A;
    const targets = (ctx.ground || []).filter((u) => u.alive);
    if (!targets.length) return false;
    // what can each store hit?
    const can = (key, u) => { const c = WEAPONS[key].cls; return c === 'arm' ? !!u.radarT : c === 'ashm' ? u.D.ship : !u.D.ship || c !== 'rkt'; };
    let key = this.agKey && keys.includes(this.agKey) ? this.agKey : null;
    if (!this.agTgt || !this.agTgt.alive || (key && !can(key, this.agTgt))) {
      // nearest useful target (prefer what it was told to hit, then air defences that threaten it)
      let best = null, bs = 1e12;
      for (const u of targets) {
        const k = keys.find((kk) => can(kk, u));
        if (!k) continue;
        const wc = WEAPONS[k].cls;
        let sc = u.pos.distanceTo(P.pos) * (ctx.priority && ctx.priority.has(u.id) ? 0.3 : 1);
        // ARMs and stand-off weapons go for air defences first; bombs and rockets leave the
        // long-range SAM batteries alone (that's a job for the SEAD jets) and avoid the guns
        if (wc === 'arm' || wc === 'agm') sc *= u.D.cat === 'sam' ? 0.5 : 1;
        else if (wc === 'bomb' || wc === 'rkt' || wc === 'gbomb') sc *= u.D.cat === 'sam' && u.D.radar && u.D.radar.range > 25000 ? 4 : u.D.cat === 'sam' || u.D.cat === 'aaa' ? 1.4 : 1;
        if (sc < bs) { bs = sc; best = u; key = k; }
      }
      this.agTgt = best; this.agPhase = 'ingress';
      if (best) this.say(ctx, `Rolling in on the ${best.name}.`);
    }
    const T = this.agTgt;
    if (!T) return false;
    key = key && can(key, T) ? key : keys.find((k) => can(k, T));
    if (!key) { this.agTgt = null; return false; }
    this.agKey = key;
    const w = WEAPONS[key];
    o.weapon = 'ag'; o.agKey = key; o.agTgt = T; o.wantStt = false;
    this.mode = 'strike';
    _t.copy(T.pos).sub(P.pos);
    const hd = Math.hypot(_t.x, _t.z), dist = _t.length();
    const los = _t.divideScalar(dist || 1);
    const off = Math.acos(clamp(los.dot(P.fwd), -1, 1));
    if (this.agPhase === 'egress') {
      this.diving = false;
      // weapon away: turn off the target and climb out of the SAM envelope, then come back around
      this.agCd -= dt;
      _d.copy(P.pos).sub(T.pos); _d.y = 0; _d.normalize(); _d.y = 0.25; _d.normalize();
      steer(P, _d, A.maxPull, o); o.throttle = 1.15;
      if (this.agCd <= 0) { this.agPhase = 'ingress'; if (!T.alive) this.agTgt = null; }
      return true;
    }
    const cruise = Math.max(groundHeight(P.pos.x, P.pos.z) + 1800, w.cls === 'bomb' || w.cls === 'rkt' ? 3000 : w.cls === 'ashm' ? 1200 : 5000);
    let release = false;
    switch (w.cls) {
      case 'arm': case 'ashm': {
        const rng = w.cls === 'arm' ? w.seeker * 0.75 : 32000;
        _d.copy(los); _d.y = clamp((cruise - P.pos.y) / 3000, -0.3, 0.3);
        steer(P, _d.normalize(), 0.7, o); o.throttle = 1.0;
        release = dist < rng && off < 0.35 && (w.cls !== 'arm' || T.radarMode > 0);
        break;
      }
      case 'agm': {
        if (hd > 11000) { _d.copy(los); _d.y = clamp((cruise - P.pos.y) / 3000, -0.3, 0.3); steer(P, _d.normalize(), 0.7, o); }
        else steer(P, los, 0.6, o);
        o.throttle = 1.0;
        release = P.agLocked && dist < w.seeker * 0.85;
        break;
      }
      case 'gbomb': {
        _d.copy(los); _d.y = 0; _d.normalize(); _d.y = clamp((cruise - P.pos.y) / 3000, -0.3, 0.3);
        steer(P, _d.normalize(), 0.6, o); o.throttle = 1.05;
        const ip = impactPoint(P, key);
        const glide = w.glide ? 1 + w.glide * 1.2 : 1;
        if (ip) release = ip.pos.distanceTo(T.pos) < 900 * glide || (hd < (P.pos.y - T.pos.y) * 1.6 * glide && off < 0.5 && hd > 1000);
        break;
      }
      default: {
        // iron bombs and rockets: approach at height, roll in once the target is ~25-30 degrees
        // below the nose, then steer the flight path so the CCIP pipper slides onto the target
        const rk = w.cls === 'rkt';
        const dh = P.pos.y - T.pos.y, dep = Math.atan2(dh, hd);
        const tol = (rk ? 40 : 22) * (1.6 - A.s.gun);
        if (!this.diving && dep >= (rk ? 0.3 : 0.45)) {
          if (off < 0.6 && P.vel.y < 40 && dep < 1.0) this.diving = true;
          else if (dep >= 1.0 && off < 1.0) { this.agPhase = 'egress'; this.agCd = 6; }   // on top of it: extend and come round
          // otherwise keep turning toward it until it's ahead
        }
        if (this.agPhase === 'egress') break;
        if (!this.diving) {
          const top = T.pos.y + (rk ? 1500 : 2600);
          _d.copy(los); _d.y = 0; _d.normalize(); _d.y = clamp((Math.max(cruise, top) - P.pos.y) / 2000, -0.3, 0.35);
          steer(P, _d.normalize(), 0.7, o); o.throttle = 1.0;
          // level release if the pipper happens to cross the target on the way in
          if (!rk && hd < 9000) { const ip = impactPoint(P, key); release = !!ip && ip.pos.distanceTo(T.pos) < tol; }
        } else {
          const ip = impactPoint(P, key);
          const vh = _u.copy(P.vel).normalize();
          // where the flight path meets the ground at the target's height
          if (vh.y < -0.05) _aim.copy(P.pos).addScaledVector(vh, dh / -vh.y); else _aim.copy(T.pos);
          let err = 1e9;
          if (ip) { _tv.copy(T.pos).sub(ip.pos); _tv.y = 0; err = _tv.length(); _aim.addScaledVector(_tv, 2.2); }   // over-correct: the pipper lags the flight path
          _aim.y = T.pos.y;
          _aim.sub(P.pos).normalize();
          steer(P, _aim, 0.8, o); o.throttle = rk ? 0.8 : 0.9;
          o.airbrake = P.speed > 270;
          release = !!ip && err < tol && dist < (rk ? 3500 : 6500);
          if (!release && (P.pos.y - groundHeight(P.pos.x, P.pos.z) < A.minAgl + 300 || hd < 400 || off > 1.2)) { this.agPhase = 'egress'; this.agCd = 10; this.diving = false; }
        }
      }
    }
    if (this.ripple > 0 && (w.cls === 'bomb' || w.cls === 'rkt')) release = true;   // rest of the pair / ripple
    if (release && this.agCd2 <= 0 && !this.holdFire) {
      o.missile = true;
      this.agCd2 = w.cls === 'rkt' ? 0.1 : w.cls === 'bomb' ? 0.26 : 1.2;
      this.agShots = (this.agShots || 0) + 1;
      this.ripple = (w.cls === 'bomb' && this.agShots < 2) || (w.cls === 'rkt' && this.agShots < 6) ? 1 : 0;
      // rockets ripple, iron bombs go in pairs, everything else one per pass
      if ((w.cls !== 'rkt' && w.cls !== 'bomb') || this.agShots >= (w.cls === 'rkt' ? 6 : 2)) {
        this.agShots = 0;
        this.agPhase = 'egress'; this.agCd = w.cls === 'arm' || w.cls === 'ashm' ? 10 : 7; this.diving = false;
        this.say(ctx, w.cls === 'arm' ? 'Magnum!' : w.cls === 'ashm' ? 'Vampire away!' : w.cls === 'agm' ? 'Rifle!' : 'Bombs away!');
      }
    }
    this.agCd2 = (this.agCd2 || 0) - dt;
    return true;
  }

  followRoute(route, o) {
    const P = this.plane;
    const wp = route[this.routeI % route.length];
    _d.set(wp[0] - P.pos.x, 0, wp[1] - P.pos.z);
    if (_d.length() < 1500) this.routeI = (this.routeI + 1) % route.length;
    _d.normalize();
    _d.y = clamp(((wp[2] || 3000) - P.pos.y) / 2500, -0.5, 0.5);
    steer(P, _d.normalize(), 0.55, o);
    o.throttle = 0.9; o.wantStt = false;
    this.mode = 'route';
    return o;
  }

  // ctx: { friends, enemies, picture, home (enemy area to search), base (own start), anchor (own start
  //        point at patrol altitude), lead (flight leader), idx (slot), say(text) }
  update(dt, target, combat, threat, ctx = {}) {
    const P = this.plane, A = this.A, C = A.cfg, o = this.out;
    this.time += dt;
    this.missileCd -= dt; this.flareCd -= dt; this.burstT -= dt; this.supportT -= dt; this.sayT -= dt; this.extendT -= dt;
    o.gun = false; o.missile = false; o.flare = false; o.chaff = false; o.airbrake = false;
    o.land = false; o.gear = false; o.flaps = 0; o.agKey = null; o.agTgt = null;
    if (o.weapon === 'ag') o.weapon = 'srm';
    if (!P.alive) return o;
    const cmd = this.command;
    this.morale(dt, threat, ctx);
    P.radarSilent = C.ord === 'ambush' && !this.committed;

    // ---------- priority 1: terrain ----------
    const speed = P.speed;
    const look = Math.max(3, Math.min(9, speed / 45));
    const gAhead = this.groundAhead(look);
    const agl = P.pos.y - gAhead;
    const futureAlt = P.pos.y + P.vel.y * look;
    const floor = A.minAgl * (this.broken && A.terrain ? 0.7 : 1);
    // on final to the carrier it flies the glideslope down to the deck instead
    const landing = this.onFinal && this.broken && ctx.carrier && ctx.carrier.alive;
    if (!landing && (agl < floor || futureAlt < gAhead + floor * 0.55)) {
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
    if (A.drone) {
      const a = this.time * 0.08, c = ctx.base || _u.set(0, 0, 0);
      _d.set(c.x * 0.3 + Math.cos(a) * 6000 - P.pos.x, 0, c.z * 0.3 + Math.sin(a) * 6000 - P.pos.z).normalize();
      _d.y = (3200 - P.pos.y) / 3000; _d.normalize();
      steer(P, _d, 0.5, o); o.throttle = 0.75; o.wantStt = false; this.mode = 'drone'; return o;
    }
    const hasTgt = !!(target && target.alive);

    // ---------- what it knows: its radar track, IRST, eyes or datalink, like a human ----------
    const trueDist = hasTgt ? target.pos.distanceTo(P.pos) : 1e9;
    const eyes = hasTgt && trueDist < visRange() && lineOfSight(P.pos, target.pos);
    const irst = P.irst && P.irst.contact;
    const pc = hasTgt && ctx.picture && ctx.picture.get(target);
    const known = hasTgt && ((P.radar.contact && !P.radarSilent) || eyes || irst || (pc && pc.mem > 0));
    if (known) {
      const src = eyes ? target : P.radar.contact ? P.radar : irst ? P.irst : pc || target;
      this.perceive(src.pos, src.vel);
      this.lastKnown = (this.lastKnown || new THREE.Vector3()).copy(src.pos);
      this.lostT = 0;
    } else this.lostT += dt;

    // ---------- priority 3: missile defence, from RWR / MAWS cues, after it notices them ----------
    let tPos = null, tDist = 1e9, tKind = null;
    if (threat) {
      for (const t of threat.list) if (t.dist < tDist) { tDist = t.dist; tPos = t.pos; tKind = t.kind; }
      if (!tPos && threat.launch && threat.emitter) { tPos = threat.emitter.pos || threat.emitter; tDist = 12000; tKind = 'launch'; }
    }
    // an ambusher that is found and shot at lights up its radar and fights
    if (C.ord === 'ambush' && !this.committed && ((threat && (threat.lock || threat.launch || threat.active)) || P.hp < 100)) { this.committed = true; P.radarSilent = false; }
    if (tPos) { if (!this.threatOn) { this.threatOn = true; this.noticeT = A.notice * (0.5 + Math.random()); } this.noticeT -= dt; }
    else this.threatOn = false;
    const radarThreat = tKind === 'active' || tKind === 'launch';
    const defendAt = radarThreat ? A.defendRadar * (this.broken ? 1.5 : 1) : A.defendIr * (this.broken ? 1.3 : 1);
    if (tPos && this.noticeT <= 0 && tDist < defendAt) {
      this.mode = 'defend';
      // a trained pilot with a shot of its own takes it before turning away
      if (hasTgt && radarThreat && tDist > 9000 && A.s.tac >= 0.4 && this.counterShot(dt, target, ctx, o)) return o;
      if (this.defendingId !== tKind) { this.defendingId = tKind; this.willFlare = Math.random() < A.flareP; this.willNotch = Math.random() < A.notch; }
      const los = _aim.copy(P.pos).sub(tPos).normalize();
      if (radarThreat && A.drag && tDist > 9000) {
        // still far away: turn cold and run so the missile burns out chasing it
        _d.copy(los); _d.y = P.pos.y > 2500 ? -0.15 : 0.02;
        _d.normalize();
        steer(P, _d, A.maxPull, o); o.throttle = 1.2;
      } else {
        // beam: fly perpendicular to the threat. Against radar missiles also dive so the ground is
        // behind it (the Doppler notch); against IR cut the burner.
        _d.crossVectors(los, UP).normalize();
        if (_d.dot(P.fwd) < 0) _d.negate();
        if (radarThreat && this.willNotch) _d.y = P.pos.y > 1800 ? -0.35 : 0.0;
        else _d.y = P.pos.y > 2200 ? -0.25 : 0.1;
        _d.normalize();
        steer(P, _d, tDist < 2500 ? 1.0 : A.maxPull, o);
        if (radarThreat) o.throttle = 1.1;
        else o.throttle = tDist < 1800 && A.flareP > 0.7 ? 0.4 : 1.15;
      }
      if (radarThreat) {
        if (this.willFlare && tKind === 'active' && tDist < 7000 && this.flareCd <= 0) { o.chaff = true; this.flareCd = 0.8; }
        // panicky, untrained pilots dump everything early
        else if (A.flareP < 0.5 && A.s.nerve < 0.3 && this.flareCd <= 0 && Math.random() < 0.3) { o.chaff = true; this.flareCd = 0.6; }
      } else {
        const flareAt = A.flareP > 0.7 ? 2200 : 3500 + (1 - A.s.nerve) * 1500;
        if (this.willFlare && tDist < flareAt && this.flareCd <= 0) { o.flare = true; this.flareCd = A.flareP > 0.7 ? 0.45 : 0.3; }
      }
      // keep supporting its own radar missile if the bandit is still inside the gimbal
      o.wantStt = this.supportT > 0;
      return o;
    }
    this.defendingId = null;

    // ---------- out of weapons: go home ----------
    const nM = countOf(P.stores, 'mrm'), nS = countOf(P.stores, 'srm');
    const agKeys = agKinds(P.stores);
    const strikeJob = (C.ord === 'strike' || (cmd && cmd.type === 'ground')) && agKeys.length > 0 && (ctx.ground || []).some((u) => u.alive);
    const wpn = this.holdFire ? 'hold' : C.wpn;
    const noMissiles = nM + nS === 0 || wpn === 'guns' || wpn === 'hold';
    const noGun = P.gunAmmo <= 0 || P.gunT.rate <= 0 || wpn === 'hold';
    if (!this.rtb && wpn !== 'hold' && !strikeJob && ((noMissiles && noGun) || (nM + nS === 0 && (A.style === 'bvr' || A.s.nerve < 0.4 || ctx.carrier)))) {
      this.rtb = true; this.broken = true; this.say(ctx, ctx.carrier ? 'Winchester, returning to the boat.' : 'Winchester, heading home.');
    }
    // badly damaged with a carrier nearby: go and get fixed
    if (!this.rtb && ctx.carrier && P.hp < 35) { this.rtb = true; this.broken = true; this.say(ctx, 'Hit bad, returning to the boat.'); }

    // ---------- broken off: land on the carrier, or run for home ----------
    if (this.broken && ctx.carrier && ctx.carrier.alive) return this.approach(ctx.carrier, o);
    this.onFinal = false;
    if (this.broken) {
      this.mode = 'bugout';
      const base = ctx.base || _u.set(0, 0, 0);
      _d.set(base.x - P.pos.x, 0, base.z - P.pos.z);
      const toBase = _d.length();
      _d.normalize();
      if (known) { _t.copy(P.pos).sub(_tp); _t.y = 0; _d.addScaledVector(_t.normalize(), 1.2).normalize(); }
      if (toBase < 4000 && !known) { this.orbit(base, 4000, 3000, o, 0.8); return o; }
      const want = A.terrain ? this.groundAhead(8) + A.minAgl + 250 : 3000;
      _d.y = clamp((want - P.pos.y) / 3000, -0.35, 0.3);
      steer(P, _d.normalize(), A.maxPull * 0.9, o);
      o.throttle = 1.2; o.wantStt = false;
      return o;
    }

    // ---------- radio commands from the flight lead ----------
    if (cmd && cmd.leader && cmd.leader.alive) {
      if (cmd.type === 'rejoin') { this.mode = 'escort'; this.formation(cmd.leader, ctx.idx || 1, o); return o; }
      if (cmd.type === 'cover' && (!known || trueDist > 9000 || (target.lockTgt !== cmd.leader && target.pos.distanceTo(cmd.leader.pos) > 9000))) { this.mode = 'escort'; this.formation(cmd.leader, ctx.idx || 1, o); return o; }
    }
    // ---------- strike: go after ground targets unless a fighter is right on top of it ----------
    if (strikeJob && !(known && trueDist < 6000 && countOf(P.stores, 'srm') + nM > 0) && this.strike(dt, ctx, o, agKeys)) return o;
    if (!hasTgt) {
      // nobody left in the air
      if (ctx.route && ctx.route.length && C.ord === 'route') return this.followRoute(ctx.route, o);
      if (ctx.anchor) { this.mode = 'patrol'; this.orbit(ctx.anchor, 5000, Math.max(2500, ctx.anchor.y), o, 0.8); return o; }
      _d.copy(P.fwd); _d.y = 0.05; _d.normalize();
      steer(P, _d, 0.4, o); o.throttle = 0.8; o.wantStt = false; return o;
    }

    // ---------- orders: when to commit to the fight ----------
    const ord = C.ord, commit = C.commit * 1000;
    const lead = ctx.lead && ctx.lead !== P && ctx.lead.alive ? ctx.lead : null;
    let engaged = true;
    if (ord === 'route' && ctx.route && ctx.route.length) {
      if (!this.committed && known && trueDist < commit) { this.committed = true; this.say(ctx, 'Committing.'); }
      if (this.committed && (trueDist > commit * 1.5 || this.lostT > 15)) this.committed = false;
      if (!this.committed) return this.followRoute(ctx.route, o);
    }
    if (ord === 'cap' && ctx.anchor) {
      const dA = (known ? _tp : target.pos).distanceTo(ctx.anchor);
      if (!this.committed && known && dA < commit) { this.committed = true; this.say(ctx, 'Committing.'); }
      if (this.committed && (dA > commit * 1.4 || this.lostT > 15)) this.committed = false;
      engaged = this.committed;
      if (!engaged) { this.mode = 'patrol'; this.orbit(ctx.anchor, 5000, ctx.anchor.y, o, 0.85); return o; }
    } else if (ord === 'escort' && lead) {
      const dL = (known ? _tp : target.pos).distanceTo(lead.pos);
      if (!this.committed && known && (dL < commit || target.lockTgt === lead)) this.committed = true;
      if (this.committed && dL > commit * 1.5 && target.lockTgt !== lead) this.committed = false;
      engaged = this.committed;
      if (!engaged) { this.mode = 'escort'; this.formation(lead, ctx.idx || 1, o); return o; }
    } else if (ord === 'ambush' && ctx.anchor) {
      if (!this.committed && known && trueDist < commit) { this.committed = true; P.radarSilent = false; this.say(ctx, 'Engaging!'); }
      engaged = this.committed;
      if (!engaged) {
        this.mode = 'ambush';
        const g = groundHeight(P.pos.x, P.pos.z);
        this.orbit(ctx.anchor, 3500, Math.max(g, this.groundAhead(8)) + Math.max(A.minAgl, 350) + 250, o, 0.7);
        return o;
      }
    }

    // ---------- no contact: search (in formation if it's a team player) ----------
    if (!known || !this.hist.length) {
      this.mode = 'search';
      if (lead && A.team > 0.5 && ord !== 'ambush') { this.formation(lead, ctx.idx || 1, o); return o; }
      const goal = this.lastKnown || ctx.home || _t.set(0, 3000, 0);
      _d.copy(goal).sub(P.pos); _d.y = (3500 - P.pos.y) * 0.5; _d.normalize();
      _d.addScaledVector(P.right, Math.sin(this.time * 0.4) * 0.25).normalize(); // weave sweeps the radar
      steer(P, _d, 0.6, o); o.throttle = 1.0; o.wantStt = false;
      if (this.lastKnown && P.pos.distanceTo(this.lastKnown) < 2000) this.lastKnown = null;
      return o;
    }

    // ---------- offence ----------
    this.mode = 'attack';
    const rel = _t.copy(_tp).sub(P.pos);
    const dist = rel.length();
    computeLeadDir(P.pos, P.vel, _tp, _tv, _lead, P.gunT);
    const losDir = _d.copy(rel).divideScalar(dist);
    const closing = -rel.dot(_aim.copy(_tv).sub(P.vel)) / dist;
    const tgtClosing = -rel.dot(_tv) / dist;           // > 0: target flying toward it
    const offBore = Math.acos(clamp(losDir.dot(P.fwd), -1, 1));
    let maxPull = A.maxPull;
    o.throttle = 1.0;

    // weapon choice by range, rules of engagement and preferred style
    const mrmOk = nM > 0 && wpn === 'all', srmOk = nS > 0 && (wpn === 'all' || wpn === 'nobvr');
    o.weapon = mrmOk && (dist > (A.closeIn ? 12000 : 4500) || !srmOk) ? 'mrm' : 'srm';
    o.wantStt = !P.radarSilent && dist < 30000 && (o.weapon === 'mrm' || dist < 9000);
    if (this.supportT > 0) o.wantStt = true;

    // long-range fighters keep their distance: extend away after shooting, then come back
    if (A.keepRange && mrmOk && dist < A.keepRange && dist > 2500 && closing > 50 && this.extendT <= -6) this.extendT = 10;
    if (this.extendT > 0 && dist > A.keepRange * 1.7) this.extendT = 0;
    if (this.extendT > 0) {
      _aim.copy(P.pos).sub(_tp); _aim.y = 0; _aim.normalize(); _aim.y = P.pos.y > 4000 ? -0.1 : 0.05;
      steer(P, _aim.normalize(), maxPull, o); o.throttle = 1.2;
      o.wantStt = this.supportT > 0;
      return o;
    }

    if (dist < 1700) {
      _aim.copy(_lead);
      this.wobbleT -= dt;
      if (this.wobbleT <= 0) { this.wobbleT = 0.6; this.wobble.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(A.aimNoise * 2); }
      _aim.add(this.wobble).normalize();
    } else {
      _aim.copy(_tp).addScaledVector(_tv, Math.min(dist / 700, 3)).sub(P.pos).normalize();
      // radar missile in the air: crank toward the edge of the radar's gimbal to slow the closure
      if (this.supportT > 0 && A.crank && dist > 6000) {
        _u.crossVectors(UP, _aim).normalize();
        _aim.multiplyScalar(0.62).addScaledVector(_u, this.crankSide || (this.crankSide = Math.random() < 0.5 ? -0.78 : 0.78)).normalize();
      } else this.crankSide = 0;
    }
    if (dist < 700 && closing > 110 && offBore > 0.35) {
      // about to overshoot: lag, throttle back, boards out
      _aim.copy(_tp).addScaledVector(_tv, -0.8).sub(P.pos).normalize();
      o.throttle = 0.3; o.airbrake = closing > 160;
    } else if (speed < A.speedFloor) {
      // too slow: unload and get the energy back (poor pilots keep pulling)
      if (A.s.fly > 0.35) { _aim.y -= 0.35; _aim.normalize(); maxPull = Math.min(maxPull, 0.6); }
      o.throttle = 1.2;
    } else if (dist > 3000 || speed < 200) {
      o.throttle = A.s.agg > 0.6 || dist < 15000 ? 1.2 : 1.0;
    } else if (dist < 1200 && closing > 60) {
      o.throttle = 0.7;
    }

    // don't fly into a wingman
    if (ctx.friends) for (const f of ctx.friends) {
      if (f === P || !f.alive) continue;
      _t.copy(f.pos).sub(P.pos);
      const fd = _t.length();
      if (fd < 320 && _t.dot(P.vel) > 0) { _aim.addScaledVector(_t.divideScalar(fd), -0.8).normalize(); break; }
    }
    steer(P, _aim, maxPull, o);

    // ---------- weapons ----------
    if (wpn === 'hold') return o;
    const aimErr = Math.acos(clamp(_lead.dot(P.fwd), -1, 1));
    const headOn = closing > 350 && -target.fwd.dot(losDir) > 0.8;
    if ((!headOn || A.headOnGun) && dist < A.gunRange && aimErr < A.aimTol + 2.2 / Math.max(dist, 50) && P.gunAmmo > 0) this.burstT = A.burst * (0.6 + Math.random() * 0.8);
    if (this.burstT > 0 && dist < A.gunRange * 1.15) o.gun = true;
    // never shoot through a friendly
    if (o.gun && ctx.friends) for (const f of ctx.friends) {
      if (f === P || !f.alive) continue;
      _t.copy(f.pos).sub(P.pos);
      const fd = _t.length();
      if (fd < dist + 200 && _t.dot(P.fwd) / Math.max(fd, 1) > Math.cos(0.12)) { o.gun = false; this.burstT = 0; break; }
    }
    if (wpn === 'guns' || this.missileCd > 0 || P.weapon !== o.weapon) return o;
    const sKey = firstOf(P.stores, 'srm'), mKey = firstOf(P.stores, 'mrm');
    if (o.weapon === 'srm' && srmOk && P.locked && dist > 500 && dist < WEAPONS[sKey].seeker * (A.s.agg > 0.7 ? 0.65 : 0.5)) {
      o.missile = true; this.missileCd = A.mslCd * (0.7 + Math.random() * 0.6);
    } else if (o.weapon === 'mrm' && mrmOk && P.radar.stt) {
      this.zoneT -= dt;
      if (this.zoneT <= 0 || !this.zone) { this.zoneT = 0.5; this.zone = launchZone(flyout(mKey, P.speed, airDensity(P.pos.y)), tgtClosing, _tv.length()); }
      // a smart pilot waits for a running target to come into the no-escape zone
      const range = tgtClosing < -50 && !A.coldShot ? this.zone.rMax * 0.45 : this.zone.rMax * A.mrmFrac;
      if (this.salvoLeft > 0 || (dist < range && dist > this.zone.rMin && offBore < 0.35 && P.vel.y > -30 && agl > 700)) {
        o.missile = true;
        if (this.salvoLeft > 0) { this.salvoLeft--; this.missileCd = A.mslCd * (1.2 + Math.random() * 0.6); }
        else if (A.salvo && nM > 1) { this.salvoLeft = 1; this.missileCd = 1.2; }
        else this.missileCd = A.mslCd * (1.2 + Math.random() * 0.6);
        // semi-active missiles need the radar lock all the way to impact
        this.supportT = WEAPONS[mKey].guidance === 'sarh' ? 45 : A.s.tac > 0.3 ? 22 : 6;
      }
    }
    return o;
  }
}
