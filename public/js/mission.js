// Mission logic run by the host (or in practice): objectives, triggers, timed and triggered
// waves, scoring rules, survival waves and time-trial gates.
import * as THREE from 'three';
import { JETS, JETS_OF, COUNTRIES } from './aircraft.js';
import { aiDefault, PERSONALITIES, MAX_PER_SIDE } from './scenario.js';
import { groundHeight } from './world.js';

const rnd = (a) => a[Math.floor(Math.random() * a.length)];
const _v = new THREE.Vector3();

export class Mission {
  // api: { ents(), units(), spawn(group) -> ents, say(text, color), banner(text, sub, color), wake() }
  constructor(scn, api) { this.s = scn; this.api = api; this.reset(); }

  reset() {
    const s = this.s;
    this.t = 0; this.evalT = 0; this.result = null;
    this.obj = s.objectives.map((o) => ({ ...o, state: 'active', prog: 0 }));
    this.trig = s.triggers.map((t) => ({ ...t, fired: false }));
    this.waves = s.waves.map((w) => ({ ...w, spawned: false, ents: [] }));
    this.score = [0, 0]; this.kills = [0, 0];
    this.sv = s.mode === 'survival' ? { wave: 0, breakT: 8, ents: [], cleared: 0 } : null;
  }
  get rules() { return this.s.rules; }

  // ---------------- events (from the game) ----------------
  onKill(victim, killer) {
    const P = this.rules.pts;
    if (killer && killer.side !== victim.side && !killer.unit) { this.kills[killer.side]++; this.score[killer.side] += P.air; }
    else if (killer && killer.unit && killer.side !== victim.side) this.score[killer.side] += P.air;
    if (P.death) this.score[victim.side] -= P.death;
  }
  onUnitDead(u, killer) {
    if (killer && killer.side !== u.side) this.score[killer.side] += this.rules.pts.ground;
  }

  pendingWaves(side) {
    if (this.sv && side === 1 && !this.isSurvivalOver()) return true;
    return this.waves.some((w) => !w.spawned && w.side === side && w.when === 'time');
  }

  spawnWave(w) {
    if (w.spawned) return;
    w.spawned = true;
    w.ents = this.api.spawn(w);
    this.api.say(`${w.name}: ${w.ents.length} aircraft inbound`, w.side === 0 ? '#7fb8ff' : '#ff8a7a');
  }

  // ---------------- survival ----------------
  isSurvivalOver() { return this.s.survival.max > 0 && this.sv.cleared >= this.s.survival.max; }
  survival(dt) {
    const S = this.s.survival, sv = this.sv;
    const alive = sv.ents.filter((e) => e.plane.alive).length;
    if (sv.wave > 0 && alive === 0 && sv.breakT <= 0) {
      sv.cleared = sv.wave;
      this.api.banner(`WAVE ${sv.wave} CLEARED`, this.isSurvivalOver() ? '' : 'Land on the carrier to rearm (J: gear)', '#9dffb8');
      sv.breakT = S.gap;
      if (this.isSurvivalOver()) return;
    }
    if (sv.breakT > 0) {
      sv.breakT -= dt;
      if (sv.breakT <= 0) this.nextSurvivalWave();
    }
  }
  nextSurvivalWave() {
    const S = this.s.survival, sv = this.sv;
    sv.wave++;
    const n = Math.min(MAX_PER_SIDE, Math.round(S.start + (sv.wave - 1) * S.grow));
    const country = S.country === 'random' ? rnd(Object.keys(COUNTRIES)) : S.country;
    const jets = JETS_OF(country);
    const skill = sv.wave <= 2 ? 'rookie' : sv.wave <= 5 ? 'pilot' : sv.wave <= 9 ? (Math.random() < 0.5 ? 'pilot' : 'ace') : 'ace';
    const defend = this.api.units()[S.defend];
    const slots = [];
    for (let i = 0; i < n; i++) {
      const strike = defend && i > 0 && Math.random() < S.strike;
      let jet = rnd(jets), lo = '';
      if (strike) {
        const ok = jets.filter((k) => JETS[k].loadouts.antiship || JETS[k].loadouts.strike);
        if (ok.length) { jet = rnd(ok); lo = JETS[jet].loadouts.antiship && defend.D.ship ? 'antiship' : 'strike'; }
      }
      const per = rnd(Object.keys(PERSONALITIES));
      const ai = { ...aiDefault(skill, per), ord: strike && lo ? 'strike' : 'engage' };
      slots.push({ pilot: 'ai', jet, skill, loadout: lo, ai });
    }
    // come in from a random bearing ~24 km from what they're attacking
    const c = defend ? defend.pos : _v.set(this.s.sides[0].x, 0, this.s.sides[0].z);
    const a = Math.random() * Math.PI * 2, R = 24000;
    let x = c.x + Math.sin(a) * R, z = c.z - Math.cos(a) * R;
    const d = Math.hypot(x, z); if (d > 28000) { x *= 28000 / d; z *= 28000 / d; }
    const hdg = (Math.atan2(c.x - x, -(c.z - z)) * 180) / Math.PI;
    const ents = this.api.spawn({ name: `Wave ${sv.wave}`, side: 1, x, z, alt: 3500 + Math.random() * 3000, spd: 240, hdg, form: 'spread', spacing: 1200, slots });
    sv.ents = ents;
    this.api.banner(`WAVE ${sv.wave}`, `${n} ${COUNTRIES[country].short} aircraft inbound`, '#ff8a7a');
  }

  // ---------------- per frame ----------------
  update(dt) {
    this.t += dt;
    for (const w of this.waves) if (!w.spawned && w.when === 'time' && this.t >= w.t) this.spawnWave(w);
    if (this.sv) this.survival(dt);
    this.evalT -= dt;
    if (this.evalT > 0) return;
    this.evalT = 0.25;
    const ents = this.api.ents(), units = this.api.units();
    const jetsOf = (k) => ents.filter((e) => e.side === k && e.plane.alive);
    // objectives
    for (const o of this.obj) {
      if (o.state !== 'active') continue;
      const enemy = 1 - o.side;
      switch (o.kind) {
        case 'destroy': {
          const list = o.units.length ? o.units.map((i) => units[i]).filter(Boolean) : units.filter((u) => u.side === enemy && u.D.cat !== 'ship');
          const dead = list.filter((u) => !u.alive).length;
          o.prog = list.length ? dead / list.length : 0;
          if (list.length && dead === list.length) this.complete(o);
          break;
        }
        case 'defend': {
          const list = o.units.map((i) => units[i]).filter(Boolean);
          if (list.some((u) => !u.alive)) this.fail(o, 'was destroyed');
          o.prog = list.length ? list.reduce((a, u) => a + Math.max(0, u.hp) / u.maxHp, 0) / list.length : 1;
          break;
        }
        case 'eliminate': {
          const left = jetsOf(enemy).length;
          o.prog = left ? 0 : 1;
          if (!left && !this.pendingWaves(enemy) && this.t > 3) this.complete(o);
          break;
        }
        case 'kills': o.prog = Math.min(1, this.kills[o.side] / o.n); if (this.kills[o.side] >= o.n) this.complete(o); break;
        case 'reach':
          // an aircraft, or one of the side's vehicles / ships, gets there
          if (jetsOf(o.side).some((e) => Math.hypot(e.plane.pos.x - o.x, e.plane.pos.z - o.z) < o.r) ||
              units.some((u) => u.alive && u.side === o.side && u.speed0 > 0 && Math.hypot(u.pos.x - o.x, u.pos.z - o.z) < o.r)) this.complete(o);
          break;
        case 'survive':
          o.prog = Math.min(1, this.t / o.t);
          if (!jetsOf(o.side).length && !this.rules.respawn) this.fail(o, 'everyone was shot down');
          else if (this.t >= o.t) this.complete(o);
          break;
      }
    }
    // triggers
    for (const tr of this.trig) {
      if (tr.fired) continue;
      let go = false;
      switch (tr.when) {
        case 'start': go = this.t > 0.5; break;
        case 'time': go = this.t >= tr.t; break;
        case 'enter': go = jetsOf(tr.side).some((e) => Math.hypot(e.plane.pos.x - tr.x, e.plane.pos.z - tr.z) < tr.r); break;
        case 'unitDead': go = !!units[tr.unit] && !units[tr.unit].alive; break;
        case 'waveDead': { const w = this.waves.find((x) => x.id === tr.wave); go = !!w && w.spawned && w.ents.every((e) => !e.plane.alive); break; }
        case 'objective': { const o = this.obj.find((x) => x.id === tr.obj); go = !!o && o.state === 'done'; break; }
        case 'kills': go = this.kills[tr.side] >= tr.n; break;
      }
      if (!go) continue;
      tr.fired = true;
      this.act(tr);
    }
  }

  act(tr) {
    switch (tr.do) {
      case 'spawn': { const w = this.waves.find((x) => x.id === tr.target); if (w) this.spawnWave(w); break; }
      case 'message': if (tr.text) { this.api.say(tr.text, '#ffe08a'); this.api.banner(tr.text, '', '#ffe08a', 3); } break;
      case 'complete': { const o = this.obj.find((x) => x.id === tr.target); if (o && o.state === 'active') this.complete(o); break; }
      case 'fail': { const o = this.obj.find((x) => x.id === tr.target); if (o && o.state === 'active') this.fail(o, ''); break; }
      case 'win': this.result = { win: tr.winSide, why: tr.text || '' }; break;
      case 'radar': this.api.wake(); break;
    }
  }
  complete(o) {
    o.state = 'done'; o.prog = 1;
    this.score[o.side] += o.pts * (this.rules.pts.obj ? 1 : 0);
    this.api.say(`Objective complete: ${o.label || defaultLabel(o, this.api.units())}`, '#9dffb8');
  }
  fail(o, why) {
    o.state = 'failed';
    this.api.say(`Objective failed: ${o.label || defaultLabel(o, this.api.units())}${why ? ' — ' + why : ''}`, '#ff6a5a');
  }

  // Has the round been decided? alive = [blue, red] aircraft alive. Returns { win, why } or null.
  check(alive, timeUp) {
    if (this.result) return this.result;
    const R = this.rules, S = this.s;
    const wiped = (k) => alive[k] === 0 && !R.respawn && !this.pendingWaves(k);
    if (this.sv) {
      const def = this.api.units()[S.survival.defend];
      if (def && !def.alive) return { win: 1, why: `${def.name} was sunk on wave ${this.sv.wave}` };
      if (wiped(0)) return { win: 1, why: `Shot down on wave ${this.sv.wave}` };
      if (this.isSurvivalOver() && alive[1] === 0) return { win: 0, why: `Survived all ${S.survival.max} waves` };
      return null;
    }
    if (R.win === 'score') {
      for (const k of [0, 1]) if (this.score[k] >= R.scoreLimit) return { win: k, why: `${this.score[k]} points` };
      if (timeUp) return { win: this.score[0] === this.score[1] ? -1 : this.score[0] > this.score[1] ? 0 : 1, why: 'Time is up' };
      if (wiped(0) && wiped(1)) return { win: -1, why: '' };
      if (wiped(0)) return { win: 1, why: '' };
      if (wiped(1)) return { win: 0, why: '' };
      return null;
    }
    if (R.win === 'objectives') {
      // a side with no jets left loses only if it has no ground forces left to win with either
      const units = this.api.units();
      const out = (k) => wiped(k) && !units.some((u) => u.alive && u.side === k);
      for (const k of [0, 1]) {
        const mine = this.obj.filter((o) => o.side === k && !o.optional);
        if (!mine.length) continue;
        const failed = mine.find((o) => o.state === 'failed');
        if (failed) return { win: 1 - k, why: `Objective failed: ${failed.label || defaultLabel(failed, this.api.units())}` };
        const need = mine.filter((o) => o.kind !== 'defend');
        if (need.length && need.every((o) => o.state === 'done')) return { win: k, why: 'All objectives complete' };
      }
      if (out(0) && out(1)) return { win: -1, why: '' };
      if (out(0)) return { win: 1, why: 'No aircraft left to finish the job' };
      if (out(1)) return { win: 0, why: 'The enemy has nothing left' };
      if (timeUp) {
        // defenders win on time; attackers who ran out of time lose
        const att = [0, 1].filter((k) => this.obj.some((o) => o.side === k && !o.optional && o.kind !== 'defend' && o.state === 'active'));
        return { win: att.length === 1 ? 1 - att[0] : -1, why: 'Time is up' };
      }
      return null;
    }
    // last side standing (jets, or ground forces that can still fight)
    const fights = (k) => this.api.units().some((u) => u.alive && u.side === k && (u.D.msl || u.gunT));
    const a = !wiped(0) || fights(0), b = !wiped(1) || fights(1);
    if (!a || !b || timeUp) {
      let win = -1;
      if (a && !b) win = 0; else if (b && !a) win = 1;
      else if (timeUp && alive[0] !== alive[1]) win = alive[0] > alive[1] ? 0 : 1;
      return { win, why: timeUp ? 'Time is up' : '' };
    }
    return null;
  }

  // compact state for guests
  pack() { return { o: this.obj.map((o) => [o.state === 'done' ? 1 : o.state === 'failed' ? 2 : 0, Math.round(o.prog * 100)]), sc: this.score, k: this.kills, w: this.sv ? this.sv.wave : 0 }; }
  unpack(m) {
    if (!m) return;
    (m.o || []).forEach(([st, p], i) => { const o = this.obj[i]; if (o) { o.state = st === 1 ? 'done' : st === 2 ? 'failed' : 'active'; o.prog = p / 100; } });
    if (m.sc) this.score = m.sc; if (m.k) this.kills = m.k;
    if (this.sv && m.w != null) this.sv.wave = m.w;
  }
}

export function defaultLabel(o, units) {
  const names = o.units.map((i) => units && units[i] ? units[i].name : `unit ${i + 1}`);
  switch (o.kind) {
    case 'destroy': return names.length ? `Destroy ${names.slice(0, 3).join(', ')}${names.length > 3 ? '…' : ''}` : 'Destroy all enemy ground targets';
    case 'defend': return `Protect ${names.slice(0, 3).join(', ') || 'our units'}`;
    case 'eliminate': return 'Shoot down every enemy aircraft';
    case 'kills': return `Score ${o.n} air kills`;
    case 'reach': return 'Reach the marked zone';
    case 'survive': return `Hold out for ${Math.round(o.t / 60)} min`;
  }
  return o.kind;
}

// ---------------- time trials ----------------
// Gates are [x, y, z, radius]. Each racer flies them in order; flying above the ceiling
// (metres above the ground, canyon runs) costs a time penalty.
export class Race {
  constructor(scn) { this.s = scn; this.gates = scn.gates.map(([x, y, z, r]) => ({ pos: new THREE.Vector3(x, y, z), r })); this.reset(); }
  reset() { this.state = new Map(); }
  get total() { return this.gates.length * this.s.laps; }
  of(e) {
    let st = this.state.get(e);
    if (!st) { st = { next: 0, lap: 1, t: 0, pen: 0, high: 0, done: false, splits: [], started: false }; this.state.set(e, st); }
    return st;
  }
  // returns 'gate' | 'lap' | 'finish' | null
  update(e, dt, prev) {
    const st = this.of(e), pl = e.plane;
    if (st.done || !pl.alive || !this.gates.length) return null;
    if (st.started) st.t += dt;
    if (this.s.ceiling > 0 && st.started) {
      const agl = pl.pos.y - groundHeight(pl.pos.x, pl.pos.z);
      if (agl > this.s.ceiling) { st.high += dt; if (st.high > 1) st.pen += dt; } else st.high = 0;
    }
    const g = this.gates[st.next];
    // passed when the flight path this frame comes within the gate's radius of its centre
    const d = distToSeg(g.pos, prev || pl.prevPos, pl.pos);
    if (d > g.r) return null;
    if (!st.started) st.started = true;
    st.splits.push(st.t + st.pen);
    st.next++;
    if (st.next >= this.gates.length) {
      if (st.lap >= this.s.laps) { st.done = true; st.final = st.t + st.pen; return 'finish'; }
      st.lap++; st.next = 0; return 'lap';
    }
    return 'gate';
  }
}
const _a = new THREE.Vector3(), _b = new THREE.Vector3();
function distToSeg(p, a, b) {
  _a.subVectors(b, a); const l2 = _a.lengthSq();
  const t = l2 > 0 ? Math.max(0, Math.min(1, _b.subVectors(p, a).dot(_a) / l2)) : 0;
  return _b.copy(a).addScaledVector(_a, t).distanceTo(p);
}
