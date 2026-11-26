// Flight recorder: samples every aircraft, missile and ground unit a few times a second during a
// round, plus kill events. It drives the 3D replay viewer, the kill cam and the after-action map.
import * as THREE from 'three';
import { mapImage } from './builder.js';
import { SIDE_COLORS } from './scenario.js';
import { UNITS } from './ground.js';

const RATE = 0.2;            // s between samples
const MAX_T = 3600;          // stop recording after an hour
const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion();

export class Recorder {
  constructor() { this.clear(); }
  clear() { this.frames = []; this.events = []; this.ents = {}; this.units = []; this.t = 0; this.acc = 0; this.scn = null; this.me = -1; }
  start(scn, ents, units, me) {
    this.clear();
    this.scn = scn; this.me = me ? me.id : -1;
    for (const e of ents) this.reg(e);
    this.units = units.map((u) => ({ x: u.pos.x, z: u.pos.z, name: u.name, side: u.side, key: u.key || u.D.key || '', cat: u.D.cat, ship: !!u.D.ship }));
  }
  // a later round of the same match: keep recording on the same timeline, with a short gap so the
  // tracks don't join up across the respawn, and a marker for the debrief
  newRound(r, ents) {
    if (!this.frames.length) return;
    this.t += 3; this.acc = 0;
    for (const e of ents) if (!this.ents[e.id]) this.reg(e);
    this.event('round', { n: r });
  }
  // which round (1, 2, ...) was being flown at time t
  roundAt(t) { let n = 1; for (const ev of this.events) if (ev.type === 'round' && ev.t <= t) n = ev.n; return n; }
  get rounds() { return this.events.filter((ev) => ev.type === 'round').length + 1; }
  reg(e) { this.ents[e.id] = { name: e.name, side: e.side, type: e.plane.type }; }
  get length() { return this.frames.length ? this.frames[this.frames.length - 1].t : 0; }

  update(dt, ents, units, missiles) {
    this.t += dt; this.acc -= dt;
    if (this.acc > 0 || this.t > MAX_T) return;
    this.acc = RATE;
    const p = [];
    for (const e of ents) {
      const pl = e.plane;
      if (!pl.alive) continue;
      if (!this.ents[e.id]) this.reg(e);
      const q = pl.quat;
      p.push(e.id, Math.round(pl.pos.x * 10) / 10, Math.round(pl.pos.y * 10) / 10, Math.round(pl.pos.z * 10) / 10, +q.x.toFixed(4), +q.y.toFixed(4), +q.z.toFixed(4), +q.w.toFixed(4));
    }
    const m = [];
    for (const x of missiles) {
      const id = x.src ? x.src.id : x.id;
      if (id == null || !x.pos) continue;
      m.push(id, Math.round(x.pos.x), Math.round(x.pos.y), Math.round(x.pos.z), x.owner ? x.owner.side : -1, x.burning === false ? 0 : 1);
    }
    let u = '';
    for (const x of units) u += x.alive ? '1' : '0';
    const up = [];
    for (let i = 0; i < units.length; i++) if (units[i].speed > 0 || units[i].D.ship) up.push(i, Math.round(units[i].pos.x), Math.round(units[i].pos.z));
    this.frames.push({ t: this.t, p, m, u, up });
  }
  event(type, o) { this.events.push({ t: this.t, type, ...o }); }

  index(t) {
    const F = this.frames;
    let lo = 0, hi = F.length - 1;
    if (hi < 0) return -1;
    if (t <= F[0].t) return 0;
    if (t >= F[hi].t) return hi;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (F[mid].t <= t) lo = mid; else hi = mid; }
    return lo;
  }
  // Interpolated state at time t: jets (id -> {pos, quat, vel}), missiles and which units are alive.
  at(t) {
    const i = this.index(t), F = this.frames;
    const out = { jets: new Map(), missiles: [], units: '', up: [] };
    if (i < 0) return out;
    const A = F[i], B = F[Math.min(i + 1, F.length - 1)];
    const k = B.t > A.t ? Math.max(0, Math.min(1, (t - A.t) / (B.t - A.t))) : 0, span = Math.max(1e-3, B.t - A.t);
    const bIdx = new Map();
    for (let j = 0; j < B.p.length; j += 8) bIdx.set(B.p[j], j);
    for (let j = 0; j < A.p.length; j += 8) {
      const id = A.p[j], jb = bIdx.get(id);
      const pos = new THREE.Vector3(A.p[j + 1], A.p[j + 2], A.p[j + 3]);
      _qa.set(A.p[j + 4], A.p[j + 5], A.p[j + 6], A.p[j + 7]);
      const vel = new THREE.Vector3();
      if (jb != null && B !== A) {
        const pb = new THREE.Vector3(B.p[jb + 1], B.p[jb + 2], B.p[jb + 3]);
        vel.subVectors(pb, pos).divideScalar(span);
        pos.lerp(pb, k);
        _qb.set(B.p[jb + 4], B.p[jb + 5], B.p[jb + 6], B.p[jb + 7]);
        _qa.slerp(_qb, k);
      } else if (jb == null && k > 0.5 && B !== A) continue;      // gone by the next sample
      out.jets.set(id, { pos, quat: _qa.clone(), vel });
    }
    const mb = new Map();
    for (let j = 0; j < B.m.length; j += 6) mb.set(B.m[j], j);
    for (let j = 0; j < A.m.length; j += 6) {
      const jb = mb.get(A.m[j]);
      const pos = new THREE.Vector3(A.m[j + 1], A.m[j + 2], A.m[j + 3]), vel = new THREE.Vector3();
      if (jb != null && B !== A) { const pb = new THREE.Vector3(B.m[jb + 1], B.m[jb + 2], B.m[jb + 3]); vel.subVectors(pb, pos).divideScalar(span); pos.lerp(pb, k); }
      else if (k > 0.5) continue;
      out.missiles.push({ id: A.m[j], pos, vel, side: A.m[j + 4], burning: !!A.m[j + 5] });
    }
    out.units = (k > 0.5 ? B : A).u;
    out.up = A.up;
    return out;
  }
}

// ---------------- after-action map ----------------
// Draws the whole round from above: every track, kills, ground units, markers and gates, with
// aircraft shown where they were at time t (tracks after t are faded).
export function drawAar(canvas, rec, t, opts = {}) {
  const S = rec.scn;
  if (!S || !rec.frames.length) return;
  const css = canvas.clientWidth || 480, dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (canvas.width !== Math.round(css * dpr)) { canvas.width = canvas.height = Math.round(css * dpr); }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // fit the view around everything that happened
  if (!rec.view) {
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    const grow = (x, z) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); };
    for (const f of rec.frames) for (let j = 0; j < f.p.length; j += 8) grow(f.p[j + 1], f.p[j + 3]);
    for (const u of rec.units) grow(u.x, u.z);
    for (const g of S.gates || []) grow(g[0], g[2]);
    const half = Math.max(4000, (Math.max(x1 - x0, z1 - z0) / 2) * 1.12);
    rec.view = { cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, half: Math.min(half, 40000) };
  }
  const V = rec.view, sc = css / (2 * V.half);
  const px = (x, z) => [(x - V.cx + V.half) * sc, (z - V.cz + V.half) * sc];
  // terrain
  const M = mapImage(S.map), n = M.canvas.width, f = n / M.size;
  const sx = (V.cx - V.half + M.size / 2) * f, sz = (V.cz - V.half + M.size / 2) * f, sw = 2 * V.half * f;
  ctx.fillStyle = '#123'; ctx.fillRect(0, 0, css, css);
  ctx.drawImage(M.canvas, sx, sz, sw, sw, 0, 0, css, css);
  ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(0, 0, css, css);
  ctx.font = '600 10.5px system-ui, sans-serif'; ctx.textAlign = 'center';
  const label = (txt, x, y, col) => { ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.strokeText(txt, x, y); ctx.fillStyle = col; ctx.fillText(txt, x, y); };
  // gates
  if (S.gates && S.gates.length) {
    ctx.strokeStyle = 'rgba(120,255,160,0.5)'; ctx.lineWidth = 1; ctx.beginPath();
    S.gates.forEach((g, i) => { const [x, y] = px(g[0], g[2]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.stroke();
    for (const g of S.gates) { const [x, y] = px(g[0], g[2]); ctx.strokeStyle = '#78ffa0'; ctx.beginPath(); ctx.arc(x, y, 3.5, 0, Math.PI * 2); ctx.stroke(); }
  }
  // markers
  for (const m of S.markers || []) { const [x, y] = px(m.x, m.z); ctx.fillStyle = '#ffe08a'; ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill(); label(m.label, x, y - 7, '#ffe08a'); }
  // tracks
  const tracks = {};
  for (const fr of rec.frames) for (let j = 0; j < fr.p.length; j += 8) (tracks[fr.p[j]] || (tracks[fr.p[j]] = [])).push([fr.t, fr.p[j + 1], fr.p[j + 3]]);
  for (const id of Object.keys(tracks)) {
    const E = rec.ents[id], tr = tracks[id];
    if (!E) continue;
    const col = SIDE_COLORS[E.side], mine = +id === rec.me;
    for (const past of [true, false]) {
      ctx.strokeStyle = col; ctx.globalAlpha = past ? 0.95 : 0.22; ctx.lineWidth = mine ? 2.4 : 1.4;
      ctx.beginPath();
      let started = false, prevT = -1;
      for (const [tt, x, z] of tr) {
        if (past ? tt > t : tt < t) continue;
        const [a, b] = px(x, z);
        if (!started || tt - prevT > 1.5) { ctx.moveTo(a, b); started = true; } else ctx.lineTo(a, b);
        prevT = tt;
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  // missile shots so far: from launch point to where it ended
  for (const ev of rec.events) {
    if (ev.type !== 'kill' || ev.t > t || !ev.at || !ev.from) continue;
    const [a, b] = px(ev.from[0], ev.from[1]), [c, d] = px(ev.at[0], ev.at[1]);
    ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(a, b); ctx.lineTo(c, d); ctx.stroke(); ctx.setLineDash([]);
  }
  // ground units
  const st = rec.at(t);
  rec.units.forEach((u, i) => {
    let ux = u.x, uz = u.z;
    for (let j = 0; j < st.up.length; j += 3) if (st.up[j] === i) { ux = st.up[j + 1]; uz = st.up[j + 2]; }
    const [x, y] = px(ux, uz), alive = st.units[i] !== '0';
    ctx.fillStyle = alive ? (u.side === 0 ? '#7fb4ff' : '#ff7a6a') : 'rgba(120,120,120,0.9)';
    ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.lineWidth = 1.2;
    ctx.beginPath();
    if (u.cat === 'sam') { ctx.moveTo(x, y - 5); ctx.lineTo(x + 5, y); ctx.lineTo(x, y + 5); ctx.lineTo(x - 5, y); ctx.closePath(); }
    else if (u.ship) ctx.ellipse(x, y, 7, 3, 0, 0, Math.PI * 2);
    else ctx.rect(x - 4, y - 4, 8, 8);
    ctx.fill(); ctx.stroke();
    if (!alive) { ctx.strokeStyle = '#ff5040'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(x - 5, y - 5); ctx.lineTo(x + 5, y + 5); ctx.moveTo(x + 5, y - 5); ctx.lineTo(x - 5, y + 5); ctx.stroke(); }
  });
  // deaths so far
  for (const ev of rec.events) {
    if (ev.type !== 'kill' || ev.t > t || !ev.at) continue;
    const [x, y] = px(ev.at[0], ev.at[1]), E = rec.ents[ev.victim];
    ctx.strokeStyle = E ? SIDE_COLORS[E.side] : '#fff'; ctx.lineWidth = 2.2;
    ctx.beginPath(); ctx.moveTo(x - 5, y - 5); ctx.lineTo(x + 5, y + 5); ctx.moveTo(x + 5, y - 5); ctx.lineTo(x - 5, y + 5); ctx.stroke();
  }
  // missiles in flight at t
  for (const m of st.missiles) { const [x, y] = px(m.pos.x, m.pos.z); ctx.fillStyle = '#fff'; ctx.fillRect(x - 1.5, y - 1.5, 3, 3); }
  // aircraft at t
  for (const [id, s] of st.jets) {
    const E = rec.ents[id];
    if (!E) continue;
    const [x, y] = px(s.pos.x, s.pos.z);
    const fx = -2 * (s.quat.x * s.quat.z + s.quat.w * s.quat.y), fz = -(1 - 2 * (s.quat.x * s.quat.x + s.quat.y * s.quat.y));
    const a = Math.atan2(fz, fx);
    ctx.save(); ctx.translate(x, y); ctx.rotate(a);
    ctx.fillStyle = +id === rec.me ? '#ffffff' : SIDE_COLORS[E.side]; ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(8, 0); ctx.lineTo(-5, -5); ctx.lineTo(-2, 0); ctx.lineTo(-5, 5); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
    if (opts.labels !== false) label(E.name, x, y - 9, SIDE_COLORS[E.side]);
  }
  // scale bar
  const km = V.half > 15000 ? 10 : V.half > 6000 ? 5 : 2;
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(10, css - 12); ctx.lineTo(10 + km * 1000 * sc, css - 12); ctx.stroke();
  ctx.textAlign = 'left'; label(`${km} km`, 10, css - 18, '#fff');
}

// ---------------- briefing map ----------------
// The plan view before a mission: terrain, your start point, known ground units, objective zones,
// markers and time-trial gates. Enemy waves and trigger zones stay secret.
export function drawBrief(canvas, S) {
  const css = canvas.clientWidth || 420, dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = canvas.height = Math.round(css * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
  const grow = (x, z) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); };
  grow(S.sides[0].x, S.sides[0].z);
  if (S.mode === 'battle' && S.sides[1].slots.length) grow(S.sides[1].x, S.sides[1].z);
  for (const u of S.units) grow(u.x, u.z);
  for (const m of S.markers) grow(m.x, m.z);
  for (const g of S.gates) grow(g[0], g[2]);
  for (const o of S.objectives) if (o.kind === 'reach') grow(o.x, o.z);
  const half = Math.min(40000, Math.max(6000, (Math.max(x1 - x0, z1 - z0) / 2) * 1.25)), cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, sc = css / (2 * half);
  const px = (x, z) => [(x - cx + half) * sc, (z - cz + half) * sc];
  const M = mapImage(S.map), n = M.canvas.width, f = n / M.size;
  ctx.fillStyle = '#123'; ctx.fillRect(0, 0, css, css);
  ctx.drawImage(M.canvas, (cx - half + M.size / 2) * f, (cz - half + M.size / 2) * f, 2 * half * f, 2 * half * f, 0, 0, css, css);
  ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(0, 0, css, css);
  ctx.font = '600 11px system-ui, sans-serif'; ctx.textAlign = 'center';
  const label = (t, x, y, col) => { ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.strokeText(t, x, y); ctx.fillStyle = col; ctx.fillText(t, x, y); };
  // threat rings
  for (const u of S.units) {
    const D = UNITS[u.key]; if (!D || u.side === 0) continue;
    const R = D.radar ? D.radar.range * 0.8 : D.optical || 0; if (!R || (D.cat !== 'sam' && !D.ship)) continue;
    const [x, y] = px(u.x, u.z);
    ctx.fillStyle = 'rgba(255,80,60,0.07)'; ctx.strokeStyle = 'rgba(255,90,70,0.5)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(x, y, R * sc, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
  for (const o of S.objectives) if (o.kind === 'reach') { const [x, y] = px(o.x, o.z); ctx.setLineDash([5, 4]); ctx.strokeStyle = '#7dffa0'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(x, y, o.r * sc, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); }
  if (S.gates.length) {
    ctx.strokeStyle = 'rgba(120,255,160,0.7)'; ctx.lineWidth = 1.4; ctx.beginPath();
    S.gates.forEach((g, i) => { const [x, y] = px(g[0], g[2]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.stroke();
    S.gates.forEach((g, i) => { const [x, y] = px(g[0], g[2]); ctx.strokeStyle = i ? '#78ffa0' : '#fff'; ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.stroke(); });
  }
  for (const u of S.units) {
    const D = UNITS[u.key]; if (!D) continue;
    const [x, y] = px(u.x, u.z), col = u.side === 0 ? '#7fb4ff' : '#ff7a6a';
    ctx.fillStyle = col; ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.lineWidth = 1.3; ctx.beginPath();
    if (D.cat === 'sam') { ctx.moveTo(x, y - 6); ctx.lineTo(x + 6, y); ctx.lineTo(x, y + 6); ctx.lineTo(x - 6, y); ctx.closePath(); }
    else if (D.ship) ctx.ellipse(x, y, 8, 3.5, 0, 0, Math.PI * 2);
    else if (D.cat === 'aaa') ctx.arc(x, y, 4.5, 0, Math.PI * 2);
    else ctx.rect(x - 4.5, y - 4.5, 9, 9);
    ctx.fill(); ctx.stroke();
    label(u.name || D.short, x, y + 16, col);
  }
  for (const m of S.markers) {
    const [x, y] = px(m.x, m.z), col = { target: '#ff6a5a', danger: '#ffa040', home: '#7fc4ff', info: '#ffffff' }[m.icon] || '#ffe08a';
    ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - 14); ctx.stroke();
    ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(x, y - 14); ctx.lineTo(x + 9, y - 11); ctx.lineTo(x, y - 8); ctx.fill();
    label(m.label, x + 3, y - 18, col);
  }
  // our start point and heading
  const sd = S.sides[0], [bx, by] = px(sd.x, sd.z);
  const hdg = sd.hdg != null ? (sd.hdg * Math.PI) / 180 : Math.atan2(S.sides[1].x - sd.x, -(S.sides[1].z - sd.z));
  ctx.save(); ctx.translate(bx, by); ctx.rotate(hdg);
  ctx.fillStyle = SIDE_COLORS[0]; ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(0, -12); ctx.lineTo(8, 8); ctx.lineTo(0, 3); ctx.lineTo(-8, 8); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.restore();
  label(`${sd.name} start`, bx, by + 22, SIDE_COLORS[0]);
  const km = half > 15000 ? 10 : half > 6000 ? 5 : 2;
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(10, css - 12); ctx.lineTo(10 + km * 1000 * sc, css - 12); ctx.stroke();
  ctx.textAlign = 'left'; label(`${km} km`, 10, css - 18, '#fff'); label('N ▲', 10, 16, '#fff');
}
