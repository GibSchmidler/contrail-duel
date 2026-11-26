// 2D canvas HUD drawn over the 3D view.
import * as THREE from 'three';
import { JET, GRAV, airDensity, liftCoef } from './flight.js';
import { WEAPONS, RADAR, countOf, firstOf } from './arsenal.js';

const GREEN = '#9dffb8';
const RED = '#ff5a4a';
const AMBER = '#ffcc55';
const CYAN = '#7fe8ff';
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _u = new THREE.Vector3();

export class Hud {
  constructor(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.w = 1; this.h = 1; this.dpr = 1;
    this.flashT = 0;
    this.banner = null;
    this.hitT = 0;
    this.damageT = 0;
  }

  resize(w, h, dpr) {
    this.w = w; this.h = h; this.dpr = dpr;
    this.cv.width = Math.round(w * dpr); this.cv.height = Math.round(h * dpr);
    this.cv.style.width = w + 'px'; this.cv.style.height = h + 'px';
  }

  showBanner(text, sub = '', color = GREEN, dur = 2.5) { this.banner = { text, sub, color, t: dur, dur }; }

  draw(S, dt) {
    const c = this.ctx, w = this.w, h = this.h;
    this.flashT += dt;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, w, h);
    if (!S.active) return;
    const P = S.plane;
    const scale = Math.min(1.25, Math.max(0.75, h / 900));
    c.lineWidth = 1.6 * scale;
    c.font = `${Math.round(15 * scale)}px "Consolas","Menlo",monospace`;
    c.textBaseline = 'middle';
    c.shadowColor = 'rgba(0,0,0,0.7)'; c.shadowBlur = 3;
    c.strokeStyle = GREEN; c.fillStyle = GREEN;

    if (P.alive) {
      this.ladder(S, scale);
      this.tapes(S, scale);
      this.reticles(S, scale);
      this.weapons(S, scale);
      this.radar(S, scale);
      this.rwr(S, scale);
      this.tsd(S, scale);
      this.dlz(S, scale);
      this.ground(S, scale);
      this.ccip(S, scale);
      this.systems(S, scale);
      this.warnings(S, scale);
      this.coach(S, scale);
      this.radioMenu(S, scale);
    }
    this.markers(S, scale);
    this.target(S, scale);
    this.mission(S, scale);
    this.lesson(S, scale);
    this.scoreboard(S, scale);
    this.bannerDraw(dt, scale);
    if (S.ping != null) {
      c.textAlign = 'left'; c.fillStyle = 'rgba(157,255,184,0.6)';
      c.font = `${Math.round(12 * scale)}px "Consolas","Menlo",monospace`;
      c.fillText(`PING ${Math.round(S.ping)} ms`, 14, h - 14);
    }
    if (S.hint) {
      c.textAlign = 'center'; c.fillStyle = 'rgba(255,255,255,0.75)';
      c.font = `${Math.round(13 * scale)}px "Consolas","Menlo",monospace`;
      c.fillText(S.hint, w / 2, h - 16);
    }
    this.vignette(S);
  }

  // ---------------------------------------------------------------
  ladder(S, sc) {
    const c = this.ctx, P = S.plane;
    const heading = Math.atan2(P.fwd.x, -P.fwd.z);
    const cx = this.w / 2, cy = this.h / 2;
    c.save();
    c.beginPath(); c.rect(cx - 260 * sc, cy - 230 * sc, 520 * sc, 460 * sc); c.clip();
    c.font = `${Math.round(12 * sc)}px "Consolas","Menlo",monospace`;
    for (let deg = -80; deg <= 80; deg += 10) {
      const th = (deg * Math.PI) / 180;
      const dir = _v.set(Math.sin(heading) * Math.cos(th), Math.sin(th), -Math.cos(heading) * Math.cos(th));
      const pt = S.project(_w.copy(S.camPos).addScaledVector(dir, 5000));
      if (pt.behind) continue;
      // horizontal reference direction on screen: project a point offset to the right
      const rightDir = _u.set(Math.cos(heading), 0, Math.sin(heading));
      const pr = S.project(_w.copy(S.camPos).addScaledVector(dir, 5000).addScaledVector(rightDir, 120));
      let dx = pr.x - pt.x, dy = pr.y - pt.y;
      const len = Math.hypot(dx, dy) || 1; dx /= len; dy /= len;
      const half = (deg === 0 ? 150 : 70) * sc, gap = 30 * sc;
      c.strokeStyle = deg === 0 ? 'rgba(157,255,184,0.85)' : 'rgba(157,255,184,0.5)';
      c.setLineDash(deg < 0 ? [6 * sc, 5 * sc] : []);
      c.beginPath();
      c.moveTo(pt.x - dx * half, pt.y - dy * half); c.lineTo(pt.x - dx * gap, pt.y - dy * gap);
      c.moveTo(pt.x + dx * gap, pt.y + dy * gap); c.lineTo(pt.x + dx * half, pt.y + dy * half);
      if (deg !== 0) { // end ticks toward horizon
        const tx = -dy * (deg > 0 ? 8 : -8) * sc, ty = dx * (deg > 0 ? 8 : -8) * sc;
        c.moveTo(pt.x - dx * half, pt.y - dy * half); c.lineTo(pt.x - dx * half - tx, pt.y - dy * half - ty);
        c.moveTo(pt.x + dx * half, pt.y + dy * half); c.lineTo(pt.x + dx * half - tx, pt.y + dy * half - ty);
      }
      c.stroke();
      c.setLineDash([]);
      if (deg !== 0) {
        c.fillStyle = 'rgba(157,255,184,0.6)'; c.textAlign = 'center';
        c.fillText(String(Math.abs(deg)), pt.x + dx * (half + 18 * sc), pt.y + dy * (half + 18 * sc));
      }
    }
    c.restore();
  }

  tapes(S, sc) {
    const c = this.ctx, P = S.plane, w = this.w, h = this.h;
    const cx = w / 2, cy = h / 2;
    const kts = P.speed * 1.944, ft = P.pos.y * 3.281;
    c.strokeStyle = GREEN; c.fillStyle = GREEN;
    const bw = 86 * sc, bh = 30 * sc;
    const lx = cx - 300 * sc, rx = cx + 300 * sc;
    // speed box
    c.strokeRect(lx - bw, cy - bh / 2, bw, bh);
    c.textAlign = 'right'; c.font = `bold ${Math.round(18 * sc)}px "Consolas","Menlo",monospace`;
    c.fillStyle = P.speed < 90 ? RED : GREEN;
    c.fillText(Math.round(kts).toString(), lx - 8 * sc, cy);
    c.fillStyle = GREEN; c.font = `${Math.round(13 * sc)}px "Consolas","Menlo",monospace`;
    c.fillText('KTS', lx - 8 * sc, cy - 28 * sc);
    c.textAlign = 'left';
    const rows = [
      `M ${P.mach.toFixed(2)}`,
      `G ${P.g.toFixed(1)}`,
      `α ${((P.alpha * 180) / Math.PI).toFixed(0)}°`,
      `MAX ${P.maxG.toFixed(1)}`,
    ];
    rows.forEach((t, i) => {
      c.fillStyle = i === 1 && P.g > 7.5 ? AMBER : GREEN;
      c.fillText(t, lx - bw, cy + (34 + i * 18) * sc);
    });
    // speed ticks
    c.save(); c.beginPath(); c.rect(lx - 6 * sc, cy - 120 * sc, 30 * sc, 240 * sc); c.clip();
    c.strokeStyle = 'rgba(157,255,184,0.6)';
    const pxPerKt = 1.4 * sc;
    for (let k = Math.floor((kts - 90) / 10) * 10; k < kts + 90; k += 10) {
      const y = cy + (kts - k) * pxPerKt;
      c.beginPath(); c.moveTo(lx, y); c.lineTo(lx + (k % 50 === 0 ? 14 : 7) * sc, y); c.stroke();
    }
    // corner-speed caret: slowest speed that still reaches max G = tightest, fastest turn
    const F = P.F || JET;
    const cornerKts = Math.sqrt((2 * F.gMax * P.mass * GRAV) / (airDensity(P.pos.y) * F.S * liftCoef(F.aStall, F))) * 1.944;
    const ccy = cy + Math.max(-114 * sc, Math.min(114 * sc, (kts - cornerKts) * pxPerKt)); // pinned to the tape edge when off-scale
    c.fillStyle = Math.abs(kts - cornerKts) < 25 ? '#7fe8ff' : 'rgba(127,232,255,0.6)';
    c.beginPath(); c.moveTo(lx + 24 * sc, ccy - 6 * sc); c.lineTo(lx + 15 * sc, ccy); c.lineTo(lx + 24 * sc, ccy + 6 * sc); c.fill();
    c.restore();
    // throttle bar
    const tx = lx - bw - 18 * sc, ty = cy - 60 * sc, th = 120 * sc;
    c.strokeStyle = GREEN; c.strokeRect(tx, ty, 8 * sc, th);
    const tf = Math.min(1, P.throttle / 1.2);
    c.fillStyle = P.ab ? AMBER : GREEN;
    c.fillRect(tx, ty + th * (1 - tf), 8 * sc, th * tf);
    c.beginPath(); c.moveTo(tx - 3 * sc, ty + th * (1 - 1 / 1.2)); c.lineTo(tx + 11 * sc, ty + th * (1 - 1 / 1.2)); c.stroke();
    c.textAlign = 'center'; c.fillStyle = P.ab ? AMBER : GREEN;
    c.fillText(P.ab ? 'AB' : Math.round(Math.min(P.throttle, 1) * 100) + '%', tx + 4 * sc, ty - 14 * sc);
    if (P.airbrake) { c.fillStyle = AMBER; c.fillText('BRK', tx + 4 * sc, ty - 32 * sc); }

    // altitude box
    c.strokeStyle = GREEN; c.strokeRect(rx, cy - bh / 2, bw, bh);
    c.textAlign = 'right'; c.font = `bold ${Math.round(18 * sc)}px "Consolas","Menlo",monospace`;
    c.fillStyle = GREEN;
    c.fillText(Math.round(ft).toString(), rx + bw - 8 * sc, cy);
    c.font = `${Math.round(13 * sc)}px "Consolas","Menlo",monospace`;
    c.fillText('FT', rx + bw - 8 * sc, cy - 28 * sc);
    c.textAlign = 'left';
    const vs = P.vel.y * 196.85;
    c.fillText(`VS ${vs >= 0 ? '+' : ''}${Math.round(vs / 100) * 100}`, rx, cy + 34 * sc);
    if (S.agl < 1500) { c.fillStyle = S.agl < 400 ? RED : AMBER; c.fillText(`R ${Math.round(S.agl * 3.281)}`, rx, cy + 52 * sc); }
    c.fillStyle = GREEN;
    // alt ticks
    c.save(); c.beginPath(); c.rect(rx - 24 * sc, cy - 120 * sc, 24 * sc, 240 * sc); c.clip();
    c.strokeStyle = 'rgba(157,255,184,0.6)';
    const pxPerFt = 0.12 * sc;
    for (let k = Math.floor((ft - 1000) / 100) * 100; k < ft + 1000; k += 100) {
      const y = cy + (ft - k) * pxPerFt;
      c.beginPath(); c.moveTo(rx, y); c.lineTo(rx - (k % 500 === 0 ? 14 : 7) * sc, y); c.stroke();
    }
    c.restore();

    // heading tape
    const hd = ((Math.atan2(P.fwd.x, -P.fwd.z) * 180) / Math.PI + 360) % 360;
    const hy = 56 * sc, pxPerDeg = 6 * sc;
    c.save(); c.beginPath(); c.rect(cx - 180 * sc, hy - 20 * sc, 360 * sc, 40 * sc); c.clip();
    c.strokeStyle = GREEN; c.fillStyle = GREEN; c.textAlign = 'center';
    for (let d = Math.floor((hd - 35) / 5) * 5; d < hd + 35; d += 5) {
      const x = cx + (d - hd) * pxPerDeg;
      c.beginPath(); c.moveTo(x, hy + 12 * sc); c.lineTo(x, hy + (d % 10 === 0 ? 2 : 7) * sc); c.stroke();
      if (d % 10 === 0) c.fillText(String(((d % 360) + 360) % 360).padStart(3, '0'), x, hy - 8 * sc);
    }
    c.restore();
    c.beginPath(); c.moveTo(cx, hy + 14 * sc); c.lineTo(cx - 6 * sc, hy + 22 * sc); c.lineTo(cx + 6 * sc, hy + 22 * sc); c.closePath(); c.stroke();
  }

  reticles(S, sc) {
    const c = this.ctx;
    c.strokeStyle = GREEN; c.fillStyle = GREEN;
    // gun cross (boresight)
    const g = S.project(S.gunPoint);
    if (!g.behind) {
      const s = 12 * sc;
      c.beginPath();
      c.moveTo(g.x - s, g.y); c.lineTo(g.x - 4 * sc, g.y); c.moveTo(g.x + 4 * sc, g.y); c.lineTo(g.x + s, g.y);
      c.moveTo(g.x, g.y - s); c.lineTo(g.x, g.y - 4 * sc); c.moveTo(g.x, g.y + 4 * sc); c.lineTo(g.x, g.y + s);
      c.stroke();
      // seeker field of view circle
      if (S.seekerPx > 0) {
        c.setLineDash([4 * sc, 6 * sc]);
        c.strokeStyle = S.lock.locked ? RED : 'rgba(157,255,184,0.45)';
        c.beginPath(); c.arc(g.x, g.y, S.seekerPx, 0, Math.PI * 2); c.stroke();
        c.setLineDash([]);
      }
    }
    // flight path marker
    const f = S.project(S.fpmPoint);
    if (!f.behind) {
      const r = 7 * sc;
      c.strokeStyle = GREEN;
      c.beginPath(); c.arc(f.x, f.y, r, 0, Math.PI * 2);
      c.moveTo(f.x - r, f.y); c.lineTo(f.x - r * 2.4, f.y);
      c.moveTo(f.x + r, f.y); c.lineTo(f.x + r * 2.4, f.y);
      c.moveTo(f.x, f.y - r); c.lineTo(f.x, f.y - r * 1.9);
      c.stroke();
    }
    // lead computing pipper
    if (S.leadPoint && !g.behind) {
      const l = S.project(S.leadPoint);
      if (!l.behind) {
        const inRange = S.oppDist < 1200;
        c.strokeStyle = inRange ? GREEN : 'rgba(157,255,184,0.55)';
        const r = 14 * sc;
        c.beginPath(); c.arc(l.x, l.y, r, 0, Math.PI * 2); c.stroke();
        c.fillStyle = c.strokeStyle;
        c.beginPath(); c.arc(l.x, l.y, 2.2 * sc, 0, Math.PI * 2); c.fill();
        // range arc around pipper (full = 0 m, empty = 1600 m)
        const frac = Math.max(0, 1 - S.oppDist / 1600);
        c.lineWidth = 3 * sc;
        c.beginPath(); c.arc(l.x, l.y, r + 5 * sc, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2); c.stroke();
        c.lineWidth = 1.6 * sc;
        // line from gun cross to pipper
        c.globalAlpha = 0.35; c.beginPath(); c.moveTo(g.x, g.y); c.lineTo(l.x, l.y); c.stroke(); c.globalAlpha = 1;
      }
    }
    // hit marker
    if (this.hitT > 0 && !g.behind) {
      this.hitT -= 1 / 60;
      c.strokeStyle = '#ffffff';
      const a = 9 * sc, b = 17 * sc;
      c.beginPath();
      c.moveTo(g.x - a, g.y - a); c.lineTo(g.x - b, g.y - b); c.moveTo(g.x + a, g.y - a); c.lineTo(g.x + b, g.y - b);
      c.moveTo(g.x - a, g.y + a); c.lineTo(g.x - b, g.y + b); c.moveTo(g.x + a, g.y + a); c.lineTo(g.x + b, g.y + b);
      c.stroke();
    }
  }

  // Everything the pilot knows about, drawn where it is: the designated target gets the full
  // treatment (box / range / closure / lock diamond); other contacts get small symbols by source.
  target(S, sc) {
    const c = this.ctx, w = this.w, h = this.h;
    if (!S.plane.alive) return;
    const margin = 40 * sc;
    c.font = `${Math.round(13 * sc)}px "Consolas","Menlo",monospace`;
    for (const k of S.contacts || []) {
      if (k.tgt) continue;
      const pt = S.project(k.pos);
      const on = !pt.behind && pt.x > margin && pt.x < w - margin && pt.y > margin && pt.y < h - margin;
      if (!on) continue;
      const s = Math.max(7 * sc, Math.min(30, 1400 / Math.max(k.dist, 1)));
      c.lineWidth = 1.4 * sc;
      if (k.kind === 'friend') {
        c.strokeStyle = CYAN; c.fillStyle = CYAN;
        c.beginPath(); c.arc(pt.x, pt.y, s * 0.8, Math.PI, 0); c.stroke();
        if (k.dist < 6000) { c.textAlign = 'center'; c.fillText(k.name, pt.x, pt.y - s - 8 * sc); }
        continue;
      }
      c.strokeStyle = k.kind === 'irst' ? AMBER : k.kind === 'dl' || k.kind === 'mem' ? 'rgba(255,90,74,0.55)' : RED;
      c.fillStyle = c.strokeStyle;
      if (k.kind === 'irst') { c.setLineDash([3 * sc, 3 * sc]); c.beginPath(); c.arc(pt.x, pt.y, s, 0, Math.PI * 2); c.stroke(); c.setLineDash([]); }
      else if (k.kind === 'eyes') {
        const q = s * 0.45; c.beginPath();
        for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { c.moveTo(pt.x + sx * s, pt.y + sy * (s - q)); c.lineTo(pt.x + sx * s, pt.y + sy * s); c.lineTo(pt.x + sx * (s - q), pt.y + sy * s); }
        c.stroke();
      } else if (k.kind === 'dl') { c.beginPath(); c.moveTo(pt.x, pt.y - s); c.lineTo(pt.x + s, pt.y + s * 0.7); c.lineTo(pt.x - s, pt.y + s * 0.7); c.closePath(); c.stroke(); }
      else { if (k.kind === 'mem') c.setLineDash([3 * sc, 3 * sc]); c.strokeRect(pt.x - s * 0.7, pt.y - s * 0.7, s * 1.4, s * 1.4); c.setLineDash([]); }
      c.textAlign = 'center';
      if (k.kind !== 'irst') c.fillText(k.dist > 2000 ? (k.dist / 1000).toFixed(0) : Math.round(k.dist / 100) / 10 + '', pt.x, pt.y + s + 11 * sc);
    }
    const T = S.tgt;
    if (!T) return;
    const R = S.radar;
    const pos = T.pos;
    const pt = S.project(pos);
    const on = !pt.behind && pt.x > margin && pt.x < w - margin && pt.y > margin && pt.y < h - margin;
    const dist = T.dist;
    const irst = T.kind === 'irst';
    const tracked = T.kind === 'stt' || T.kind === 'trk' || T.kind === 'mem';
    const visual = T.kind === 'eyes' || T.visual;
    const distTxt = irst ? 'IRST' : dist > 2000 ? (dist / 1000).toFixed(1) + ' km' : Math.round(dist) + ' m';
    const memory = T.kind === 'mem' || T.kind === 'dl';
    c.strokeStyle = RED; c.fillStyle = RED; c.lineWidth = 1.6 * sc;
    if (on) {
      const s = Math.max(12 * sc, Math.min(60, 2400 / Math.max(dist, 1)));
      if (irst) {
        c.strokeStyle = AMBER; c.fillStyle = AMBER;
        c.setLineDash([3 * sc, 3 * sc]); c.beginPath(); c.arc(pt.x, pt.y, s, 0, Math.PI * 2); c.stroke(); c.setLineDash([]);
        c.textAlign = 'center'; c.fillText('IRST', pt.x, pt.y + s + 12 * sc);
      } else if (tracked || T.kind === 'dl') {
        c.setLineDash(memory ? [4 * sc, 4 * sc] : []);
        c.lineWidth = (R.stt ? 2.4 : 1.8) * sc;
        c.strokeRect(pt.x - s, pt.y - s, s * 2, s * 2);
        c.setLineDash([]); c.lineWidth = 1.6 * sc;
        c.textAlign = 'center';
        c.fillText(distTxt, pt.x, pt.y + s + 12 * sc);
        if (S.closure != null && !memory) c.fillText(`${S.closure > 0 ? '+' : ''}${Math.round(S.closure * 1.944)} kt`, pt.x, pt.y + s + 27 * sc);
        c.fillText(R.stt ? 'STT' : T.kind === 'dl' ? 'LINK' : memory ? 'MEM' : 'TGT', pt.x, pt.y - s - 10 * sc);
      } else {
        const k = s * 0.45;
        c.lineWidth = 2 * sc;
        c.beginPath();
        for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { c.moveTo(pt.x + sx * s, pt.y + sy * (s - k)); c.lineTo(pt.x + sx * s, pt.y + sy * s); c.lineTo(pt.x + sx * (s - k), pt.y + sy * s); }
        c.stroke(); c.lineWidth = 1.6 * sc;
        c.textAlign = 'center'; c.fillText(distTxt, pt.x, pt.y + s + 12 * sc);
      }
      if (visual && dist < 2500) {
        c.textAlign = 'center';
        c.fillText(T.name || 'BANDIT', pt.x, pt.y - s - (tracked ? 24 : 10) * sc);
        const bw = 44 * sc;
        c.strokeRect(pt.x - bw / 2, pt.y - s - (tracked ? 40 : 26) * sc, bw, 5 * sc);
        c.fillRect(pt.x - bw / 2, pt.y - s - (tracked ? 40 : 26) * sc, (bw * Math.max(0, T.hp)) / 100, 5 * sc);
      }
      if (S.lock.inCone || S.lock.locked) {
        const d = (S.lock.locked ? s + 8 * sc : s + 30 * sc * (1 - S.lock.progress));
        c.strokeStyle = S.lock.locked ? RED : AMBER;
        c.lineWidth = 2 * sc;
        c.beginPath(); c.moveTo(pt.x, pt.y - d); c.lineTo(pt.x + d, pt.y); c.lineTo(pt.x, pt.y + d); c.lineTo(pt.x - d, pt.y); c.closePath(); c.stroke();
        c.lineWidth = 1.6 * sc;
        if (S.lock.locked && Math.floor(this.flashT * 4) % 2 === 0) { c.fillStyle = RED; c.textAlign = 'center'; c.fillText('LOCK', pt.x, pt.y + d + 42 * sc); }
      }
    } else {
      const cs = S.camSpace(pos);
      let dx = cs.x, dy = -cs.y;
      if (Math.hypot(dx, dy) < 1e-3) dy = 1;
      const a = Math.atan2(dy, dx);
      const Rr = Math.min(w, h) * 0.36;
      const x = w / 2 + Math.cos(a) * Rr, y = h / 2 + Math.sin(a) * Rr;
      c.save(); c.translate(x, y); c.rotate(a);
      c.beginPath(); c.moveTo(16 * sc, 0); c.lineTo(-8 * sc, -11 * sc); c.lineTo(-3 * sc, 0); c.lineTo(-8 * sc, 11 * sc); c.closePath();
      if (tracked) c.fill(); else c.stroke();
      c.restore();
      c.textAlign = 'center';
      c.fillText(distTxt, w / 2 + Math.cos(a) * (Rr - 30 * sc), h / 2 + Math.sin(a) * (Rr - 30 * sc));
    }
  }

  weapons(S, sc) {
    const c = this.ctx, P = S.plane, w = this.w, h = this.h;
    const x = w - 24 * sc;
    const lh = 20 * sc;
    let y = h - 176 * sc - (S.ag ? lh : 0);
    c.textAlign = 'right';
    c.font = `${Math.round(15 * sc)}px "Consolas","Menlo",monospace`;
    // remember which types this jet started with so the rows keep their names at zero
    const L = P.T.loadouts[P.loadout].st;
    const srm = firstOf(P.stores, 'srm') || firstOf(L, 'srm'), mrm = firstOf(P.stores, 'mrm') || firstOf(L, 'mrm');
    const nS = countOf(P.stores, 'srm'), nM = countOf(P.stores, 'mrm');
    const row = (txt, sel, ok) => {
      c.fillStyle = !ok ? RED : sel ? '#ffffff' : 'rgba(157,255,184,0.75)';
      c.fillText((sel ? '▸ ' : '') + txt, x, y); y += lh;
    };
    row(`1 SRM ${srm ? WEAPONS[srm].name : '—'} ×${nS}`, P.weapon === 'srm', nS > 0);
    row(`2 MRM ${mrm ? WEAPONS[mrm].name : '—'} ×${nM}`, P.weapon === 'mrm', nM > 0 || P.weapon !== 'mrm');
    if (S.ag) row(`3 ${S.ag.cls} ${S.ag.name} ×${S.ag.n}${S.ag.kinds > 1 ? ' +' : ''}`, P.weapon === 'ag', S.ag.n > 0);
    row(P.T.gun === 'none' ? 'NO GUN' : `GUN ${P.gunT.name.split(' ')[0]} ${P.gunAmmo}`, false, P.gunAmmo > 0);
    row(`FLR ${P.flares}  CHF ${P.chaff}`, false, P.flares > 0 || P.chaff > 0);
    // radar status + my AMRAAMs in flight
    const R = S.radar;
    c.fillStyle = R.stt ? RED : R.contact ? GREEN : 'rgba(157,255,184,0.6)';
    const acq = P.wantStt && !R.stt;
    c.fillText(`RDR ${R.stt ? 'STT LOCK' : acq ? (R.contact ? 'ACQ…' : 'LOCK – NO TGT') : R.contact ? 'SRCH TRK' : 'SRCH'}${R.notched ? ' NOTCH' : R.masked && R.contact ? ' MASKED' : ''}`, x, y); y += lh;
    if (S.myMrm.length) { c.fillStyle = CYAN; c.fillText('MSL: ' + S.myMrm.join(' · '), x, y); y += lh; }
    if (P.irst && P.T.irst) { c.fillStyle = P.irst.contact ? AMBER : 'rgba(157,255,184,0.6)'; c.fillText(P.irst.contact ? 'IRST TRK' : 'IRST SRCH', x, y); }

    // own hull
    const bx = 24 * sc, by = h - 70 * sc, bw = 180 * sc;
    c.textAlign = 'left'; c.fillStyle = GREEN;
    c.fillText('HULL', bx, by - 14 * sc);
    c.strokeStyle = GREEN; c.strokeRect(bx, by, bw, 10 * sc);
    c.fillStyle = P.hp > 50 ? GREEN : P.hp > 25 ? AMBER : RED;
    c.fillRect(bx, by, (bw * Math.max(0, P.hp)) / 100, 10 * sc);
    // G tolerance
    if (P.gloc > 0.05) {
      c.fillStyle = P.gloc > 0.7 ? RED : AMBER;
      c.fillText('G-STRESS', bx, by - 44 * sc);
      c.strokeStyle = c.fillStyle; c.strokeRect(bx, by - 34 * sc, bw, 6 * sc);
      c.fillRect(bx, by - 34 * sc, bw * Math.min(1, P.gloc), 6 * sc);
    }
  }

  // Fire-control radar: a sector scope, auto-scaled, showing own-radar tracks and datalink tracks.
  radar(S, sc) {
    const c = this.ctx, P = S.plane, w = this.w, h = this.h, Rd = S.radar;
    const Rp = 78 * sc, cx = w / 2, cy = h - 18 * sc;
    const blips = S.blips || [];
    const tgtB = blips.find((b) => b.tgt);
    const ref = tgtB ? tgtB.pos.distanceTo(P.pos) : 0;
    const range = !tgtB || ref > 18000 ? 40000 : ref > 8000 ? 20000 : 10000;
    const g = Math.min(1.4, (P.radarT || RADAR).gimbal);
    c.fillStyle = 'rgba(0,20,8,0.3)'; c.strokeStyle = 'rgba(157,255,184,0.45)';
    c.beginPath(); c.moveTo(cx, cy); c.arc(cx, cy, Rp, -Math.PI / 2 - g, -Math.PI / 2 + g); c.closePath(); c.fill(); c.stroke();
    c.beginPath(); c.arc(cx, cy, Rp / 2, -Math.PI / 2 - g, -Math.PI / 2 + g); c.stroke();
    c.font = `${Math.round(10 * sc)}px "Consolas","Menlo",monospace`; c.textAlign = 'left'; c.fillStyle = 'rgba(157,255,184,0.7)';
    c.fillText(`${range / 1000}`, cx + Math.sin(g) * Rp + 4 * sc, cy - Math.cos(g) * Rp);
    const sweep = Math.sin(this.flashT * 1.6) * g;
    if (!Rd.stt) { c.strokeStyle = 'rgba(157,255,184,0.25)'; c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + Math.sin(sweep) * Rp, cy - Math.cos(sweep) * Rp); c.stroke(); }
    for (const b of blips) {
      _v.copy(b.pos).sub(P.pos);
      const d = _v.length();
      const az = Math.atan2(_v.dot(P.right), _v.dot(P.fwd));
      if (Math.abs(az) > g + 0.05 && !b.dl) continue;
      const rr = Math.min(1, d / range) * Rp;
      const aa = Math.max(-g, Math.min(g, az));
      const px = cx + Math.sin(aa) * rr, py = cy - Math.cos(aa) * rr;
      c.globalAlpha = b.fresh ? 1 : 0.5;
      c.fillStyle = b.stt ? RED : b.friend ? CYAN : b.dl ? AMBER : GREEN; c.strokeStyle = c.fillStyle;
      const s = (b.tgt ? 4.5 : 3.2) * sc;
      if (b.friend) { c.beginPath(); c.arc(px, py, s, Math.PI, 0); c.stroke(); }
      else if (b.dl) { c.beginPath(); c.moveTo(px, py - s); c.lineTo(px + s, py + s); c.lineTo(px - s, py + s); c.closePath(); c.stroke(); }
      else if (b.stt) c.fillRect(px - s, py - s, 2 * s, 2 * s); else c.strokeRect(px - s, py - s, 2 * s, 2 * s);
      if (b.tgt && !b.stt) { c.beginPath(); c.arc(px, py, s + 4 * sc, 0, Math.PI * 2); c.stroke(); }
      if (b.vel && !b.friend) {
        const ha = Math.atan2(b.vel.dot(P.right), b.vel.dot(P.fwd));
        c.beginPath(); c.moveTo(px, py); c.lineTo(px + Math.sin(ha) * 9 * sc, py - Math.cos(ha) * 9 * sc); c.stroke();
      }
      if (b.tgt) c.fillText(`${Math.round(b.pos.y * 3.281 / 1000)}`, px + 6 * sc, py - 4 * sc);
      c.globalAlpha = 1;
    }
    c.fillStyle = GREEN; c.beginPath(); c.moveTo(cx, cy - 6 * sc); c.lineTo(cx - 4 * sc, cy + 2 * sc); c.lineTo(cx + 4 * sc, cy + 2 * sc); c.closePath(); c.fill();
  }

  // Tactical situation display (like an F-16 HSD or F/A-18 SA page): a heading-up map of only what
  // this jet knows. Own radar/IRST/eyes tracks, datalink tracks, wingmen, RWR bearings (no range),
  // missiles the warner sees, known SAM threat rings, mission points, and the radar's coverage.
  tsd(S, sc) {
    const range = S.map;
    if (!range) return;
    const c = this.ctx, P = S.plane, w = this.w, h = this.h;
    const R = Math.round(Math.min(84 * sc, w * 0.075));
    const cx = w - 24 * sc - R, cy = h - 176 * sc - (S.ag ? 20 * sc : 0) - 30 * sc - R;
    // heading-up frame from the horizontal part of the nose (keep the last one when pointing straight up/down)
    let fx = P.fwd.x, fz = P.fwd.z;
    const fl = Math.hypot(fx, fz);
    if (fl > 0.05) { fx /= fl; fz /= fl; this.mapF = [fx, fz]; } else if (this.mapF) [fx, fz] = this.mapF; else { fx = 0; fz = -1; }
    const rx = -fz, rz = fx, k = R / range;
    const toMap = (pos) => { const dx = pos.x - P.pos.x, dz = pos.z - P.pos.z; return [cx + (dx * rx + dz * rz) * k, cy - (dx * fx + dz * fz) * k]; };
    const inside = (x, y, m = 0) => Math.hypot(x - cx, y - cy) <= R - m;
    const clampRim = (x, y, m) => { const d = Math.hypot(x - cx, y - cy), lim = R - m; return d <= lim ? [x, y, false] : [cx + ((x - cx) * lim) / d, cy + ((y - cy) * lim) / d, true]; };
    const font = (px, bold) => { c.font = `${bold ? 'bold ' : ''}${Math.round(px * sc)}px "Consolas","Menlo",monospace`; };
    const blink = Math.floor(this.flashT * 6) % 2 === 0;
    c.save();
    c.lineWidth = 1.3 * sc;
    c.fillStyle = 'rgba(0,16,6,0.5)'; c.strokeStyle = 'rgba(157,255,184,0.5)';
    c.beginPath(); c.arc(cx, cy, R, 0, Math.PI * 2); c.fill(); c.stroke();
    c.save();
    c.beginPath(); c.arc(cx, cy, R, 0, Math.PI * 2); c.clip();
    c.shadowBlur = 0;
    // terrain and coastlines, dimmed so the symbols stay readable, turned to match the heading
    const MI = S.mapImg;
    if (MI) {
      const cell = MI.size / MI.canvas.width;
      c.save();
      c.translate(cx, cy);
      c.transform(rx * k, -fx * k, rz * k, -fz * k, 0, 0);
      c.translate(-P.pos.x - MI.size / 2, -P.pos.z - MI.size / 2);
      c.scale(cell, cell);
      c.globalAlpha = 0.5; c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
      c.fillStyle = MI.sea; c.fillRect(-MI.canvas.width, -MI.canvas.width, MI.canvas.width * 3, MI.canvas.width * 3);  // open sea past the edge
      c.drawImage(MI.canvas, 0, 0);
      c.restore();
      c.fillStyle = 'rgba(0,16,6,0.25)'; c.fillRect(cx - R, cy - R, 2 * R, 2 * R);
    }
    c.strokeStyle = 'rgba(157,255,184,0.2)'; c.beginPath(); c.arc(cx, cy, R / 2, 0, Math.PI * 2); c.stroke();
    // radar coverage: the scan volume ahead of the nose
    const RT = P.radarT || RADAR;
    if (RT && RT.range) {
      const g = Math.min(1.4, RT.gimbal), rr = Math.min(R * 1.2, RT.range * k);
      c.fillStyle = S.radar && S.radar.stt ? 'rgba(255,90,74,0.07)' : 'rgba(157,255,184,0.07)';
      c.beginPath(); c.moveTo(cx, cy); c.arc(cx, cy, rr, -Math.PI / 2 - g, -Math.PI / 2 + g); c.closePath(); c.fill();
    }
    // known SAM / AAA sites: threat rings (solid and red while their radar is up, dashed amber when silent)
    font(9);
    c.textAlign = 'center';
    for (const g of S.gnd || []) {
      if (g.friend || !g.ring) continue;
      const [x, y] = toMap(g.pos), rr = g.ring * k;
      if (Math.hypot(x - cx, y - cy) > R + rr) continue;
      c.strokeStyle = g.emit ? 'rgba(255,90,74,0.8)' : 'rgba(255,204,85,0.55)';
      c.setLineDash(g.emit ? [] : [4 * sc, 3 * sc]);
      c.beginPath(); c.arc(x, y, Math.max(rr, 3 * sc), 0, Math.PI * 2); c.stroke();
      c.setLineDash([]);
      c.fillStyle = c.strokeStyle; c.fillText(g.code || 'SAM', x, y);
    }
    c.restore();
    // compass: north marker and ticks every 30°
    const nA = Math.atan2(-fx, -fz);   // screen angle of world north (-z): 0 = up, clockwise
    font(9, true); c.textAlign = 'center';
    c.strokeStyle = 'rgba(157,255,184,0.45)';
    for (let i = 0; i < 12; i++) {
      const a = nA + (i * Math.PI) / 6, len = i % 3 ? 3 : 6;
      c.beginPath(); c.moveTo(cx + Math.sin(a) * R, cy - Math.cos(a) * R); c.lineTo(cx + Math.sin(a) * (R - len * sc), cy - Math.cos(a) * (R - len * sc)); c.stroke();
    }
    c.fillStyle = GREEN; c.fillText('N', cx + Math.sin(nA) * (R - 12 * sc), cy - Math.cos(nA) * (R - 12 * sc));
    // ground units: targets, friendly ships
    for (const g of S.gnd || []) {
      let [x, y] = toMap(g.pos);
      if (!inside(x, y, 3 * sc)) { if (!g.tgt) continue; [x, y] = clampRim(x, y, 4 * sc); }
      const s = 3.2 * sc;
      c.strokeStyle = g.friend ? CYAN : g.tgt ? RED : g.emit ? AMBER : GREEN;
      c.beginPath();
      if (g.friend) c.arc(x, y, s, 0, Math.PI * 2);
      else { c.moveTo(x, y - s); c.lineTo(x + s, y); c.lineTo(x, y + s); c.lineTo(x - s, y); c.closePath(); }
      c.stroke();
    }
    // mission points: waypoints, targets, home. Off-map ones sit on the rim so you can steer to them.
    const MC = { wp: CYAN, target: RED, danger: AMBER, info: '#ffffff', home: GREEN };
    const pts = (S.marks || []).map((m) => ({ pos: m.pos, col: MC[m.icon] || '#ffffff' }));
    if (S.race && S.race.gate && !S.race.done) pts.push({ pos: S.race.gate, col: CYAN, gate: true });
    for (const m of pts) {
      const [x, y, off] = clampRim(...toMap(m.pos), 5 * sc);
      const s = 3.6 * sc;
      c.strokeStyle = m.col; c.fillStyle = m.col;
      c.globalAlpha = off ? 0.6 : 1;
      c.beginPath();
      if (m.gate) c.arc(x, y, s, 0, Math.PI * 2);
      else { c.moveTo(x, y + s); c.lineTo(x - s, y - s); c.lineTo(x + s, y - s); c.closePath(); }
      c.stroke();
      c.globalAlpha = 1;
    }
    // aircraft: same symbols as the radar scope, with a heading stick
    font(9);
    for (const t of S.contacts || []) {
      const [x, y] = toMap(t.pos);
      if (!inside(x, y, 2 * sc)) continue;
      const friend = t.kind === 'friend';
      const col = friend ? CYAN : t.kind === 'stt' ? RED : t.kind === 'dl' || t.kind === 'irst' ? AMBER : t.kind === 'eyes' ? '#ffffff' : GREEN;
      c.strokeStyle = col; c.fillStyle = col;
      c.globalAlpha = t.kind === 'mem' ? 0.45 : 1;
      const s = (t.tgt ? 3.8 : 3) * sc;
      c.beginPath();
      if (friend) { c.arc(x, y, s, Math.PI, 0); c.stroke(); }
      else if (t.kind === 'dl') { c.moveTo(x, y - s); c.lineTo(x + s, y + s); c.lineTo(x - s, y + s); c.closePath(); c.stroke(); }
      else if (t.kind === 'irst') { c.arc(x, y, s, 0, Math.PI * 2); c.stroke(); }
      else if (t.kind === 'stt') c.fillRect(x - s, y - s, 2 * s, 2 * s);
      else c.strokeRect(x - s, y - s, 2 * s, 2 * s);
      if (t.vel) {
        const vx = t.vel.x * rx + t.vel.z * rz, vy = t.vel.x * fx + t.vel.z * fz, vl = Math.hypot(vx, vy);
        if (vl > 20) { c.beginPath(); c.moveTo(x, y); c.lineTo(x + (vx / vl) * 8 * sc, y - (vy / vl) * 8 * sc); c.stroke(); }
      }
      if (t.tgt && !friend) { c.beginPath(); c.arc(x, y, s + 3 * sc, 0, Math.PI * 2); c.stroke(); c.textAlign = 'left'; c.fillText(`${Math.round(t.pos.y * 3.281 / 1000)}`, x + 7 * sc, y - 5 * sc); }
      c.globalAlpha = 1;
    }
    // my missiles in flight
    c.fillStyle = CYAN;
    for (const p of S.myMsl || []) { const [x, y] = toMap(p); if (inside(x, y)) { c.beginPath(); c.arc(x, y, 1.6 * sc, 0, Math.PI * 2); c.fill(); } }
    // missiles the warning system sees coming
    font(10, true); c.textAlign = 'center';
    for (const t of S.threats || []) {
      const [x, y] = clampRim(...toMap(t.pos), 6 * sc);
      c.fillStyle = blink ? RED : '#ffffff'; c.fillText('M', x, y);
    }
    // RWR: bearing only, so the emitter sits on the rim, not at a range
    const T = S.threat;
    if (T && T.emitters) {
      font(9, true);
      for (const e of T.emitters) {
        const [x, y] = toMap(e.pos), a = Math.atan2(x - cx, cy - y);
        const col = e.launch ? (blink ? RED : AMBER) : e.lock ? RED : AMBER;
        c.strokeStyle = col; c.fillStyle = col; c.lineWidth = 2.2 * sc;
        c.beginPath(); c.moveTo(cx + Math.sin(a) * (R - 7 * sc), cy - Math.cos(a) * (R - 7 * sc)); c.lineTo(cx + Math.sin(a) * (R + 2 * sc), cy - Math.cos(a) * (R + 2 * sc)); c.stroke();
        c.lineWidth = 1.3 * sc;
        c.fillText(e.code || 'F', cx + Math.sin(a) * (R + 10 * sc), cy - Math.cos(a) * (R + 10 * sc));
      }
    }
    // own jet
    c.fillStyle = '#ffffff';
    c.beginPath(); c.moveTo(cx, cy - 6 * sc); c.lineTo(cx + 4.5 * sc, cy + 4 * sc); c.lineTo(cx, cy + 2 * sc); c.lineTo(cx - 4.5 * sc, cy + 4 * sc); c.closePath(); c.fill();
    // range and heading
    font(10); c.fillStyle = 'rgba(157,255,184,0.75)';
    c.textAlign = 'left'; c.fillText(`${range / 1000}`, cx + R * 0.72, cy - R * 0.86);
    c.textAlign = 'right'; c.fillText(`${String(Math.round(((Math.atan2(fx, -fz) * 180) / Math.PI + 360) % 360)).padStart(3, '0')}°`, cx - R * 0.66, cy - R * 0.86);
    c.textAlign = 'center'; font(9); c.fillText('MAP · O', cx, cy + R + 10 * sc);
    c.restore();
  }

  // Radar warning receiver: who is painting us and from where. Bearing only, no range.
  rwr(S, sc) {
    const c = this.ctx, P = S.plane, w = this.w, h = this.h, T = S.threat;
    const Rr = 44 * sc, cx = w / 2 - 170 * sc, cy = h - 58 * sc;
    c.strokeStyle = 'rgba(157,255,184,0.4)'; c.fillStyle = 'rgba(0,20,8,0.3)';
    c.beginPath(); c.arc(cx, cy, Rr, 0, Math.PI * 2); c.fill(); c.stroke();
    c.beginPath(); c.arc(cx, cy, Rr * 0.45, 0, Math.PI * 2); c.stroke();
    c.font = `bold ${Math.round(12 * sc)}px "Consolas","Menlo",monospace`; c.textAlign = 'center';
    c.fillStyle = 'rgba(157,255,184,0.6)'; c.fillText('RWR', cx, cy + Rr + 10 * sc);
    const blink = Math.floor(this.flashT * 6) % 2 === 0;
    const sym = (pos, txt, color, inner) => {
      _v.copy(pos).sub(P.pos);
      const az = Math.atan2(_v.dot(P.right), _v.dot(P.fwd));
      const rr = (inner ? 0.45 : 0.8) * Rr;
      c.fillStyle = color; c.fillText(txt, cx + Math.sin(az) * rr, cy - Math.cos(az) * rr);
    };
    if (T && T.emitters) for (const e of T.emitters) {
      const color = e.launch ? (blink ? RED : AMBER) : e.lock ? AMBER : GREEN;
      sym(e.pos, (e.launch ? '◆' : '') + (e.code || 'F'), color, e.lock);
    }
    if (T) for (const t of T.list) if (t.kind === 'active') sym(t.pos, 'M', blink ? RED : '#ffffff', true);
  }

  // Dynamic launch zone for the selected missile (right of the altitude tape).
  dlz(S, sc) {
    const D = S.dlz, c = this.ctx, P = S.plane;
    if (!D || !S.tgt || S.tgt.kind === 'irst') return;
    const range = S.tgt.dist;
    const x = this.w / 2 + 300 * sc + 110 * sc, top = this.h / 2 - 110 * sc, H = 220 * sc;
    const full = Math.max(D.rMax * 1.25, Math.min(range * 1.1, D.rMax * 2.5));
    const yOf = (r) => top + H * (1 - Math.min(1, r / full));
    c.strokeStyle = GREEN; c.fillStyle = GREEN; c.lineWidth = 1.6 * sc;
    c.beginPath(); c.moveTo(x, yOf(D.rMax)); c.lineTo(x, yOf(D.rMin)); c.stroke();
    c.beginPath(); c.moveTo(x - 6 * sc, yOf(D.rMax)); c.lineTo(x + 6 * sc, yOf(D.rMax)); c.moveTo(x - 6 * sc, yOf(D.rMin)); c.lineTo(x + 6 * sc, yOf(D.rMin)); c.stroke();
    // no-escape segment
    c.lineWidth = 4 * sc; c.beginPath(); c.moveTo(x, yOf(Math.max(D.rNe, D.rMin))); c.lineTo(x, yOf(D.rMin)); c.stroke(); c.lineWidth = 1.6 * sc;
    // target range caret
    const ry = yOf(range);
    const inRange = range < D.rMax && range > D.rMin, noEscape = range < D.rNe && range > D.rMin;
    c.fillStyle = noEscape ? RED : inRange ? AMBER : GREEN;
    c.beginPath(); c.moveTo(x - 4 * sc, ry); c.lineTo(x - 14 * sc, ry - 6 * sc); c.lineTo(x - 14 * sc, ry + 6 * sc); c.closePath(); c.fill();
    c.font = `${Math.round(12 * sc)}px "Consolas","Menlo",monospace`; c.textAlign = 'center';
    c.fillStyle = GREEN; c.fillText(WEAPONS[D.key].short, x, top - 14 * sc);
    c.fillText((D.rMax / 1000).toFixed(0), x + 18 * sc, yOf(D.rMax));
    if (noEscape) { if (Math.floor(this.flashT * 4) % 2 === 0) { c.fillStyle = RED; c.fillText('SHOOT', x, top + H + 16 * sc); } }
    else if (inRange) { c.fillStyle = AMBER; c.fillText('IN RNG', x, top + H + 16 * sc); }
    else if (range <= D.rMin) { c.fillStyle = AMBER; c.fillText('MIN', x, top + H + 16 * sc); }
  }

  warnings(S, sc) {
    const c = this.ctx, w = this.w, h = this.h, T = S.threat || {};
    const blink = Math.floor(this.flashT * 5) % 2 === 0;
    c.textAlign = 'center';
    c.font = `bold ${Math.round(22 * sc)}px "Consolas","Menlo",monospace`;
    let y = h / 2 + 140 * sc;
    const line = (txt, color, flash) => { if (!flash || blink) { c.fillStyle = color; c.fillText(txt, w / 2, y); } y += 28 * sc; };
    if (T.active) line('MISSILE ACTIVE', RED, S.threatDist > 2500);
    else if (T.maws) line('MISSILE', RED, S.threatDist > 2000);
    else if (T.launch) line('LAUNCH', RED, true);
    else if (T.lock) line('RADAR LOCK', AMBER, false);
    // direction cues on a ring for missiles we can actually sense
    for (const t of S.threats || []) {
      const cs = S.camSpace(t.pos);
      const a = Math.atan2(-cs.y, cs.x);
      const R = Math.min(w, h) * 0.3;
      c.save(); c.translate(w / 2 + Math.cos(a) * R, h / 2 + Math.sin(a) * R); c.rotate(a);
      c.fillStyle = RED;
      c.beginPath(); c.moveTo(14 * sc, 0); c.lineTo(-6 * sc, -9 * sc); c.lineTo(-6 * sc, 9 * sc); c.closePath(); c.fill();
      c.restore();
    }
    if (S.pullUp && blink) { c.fillStyle = RED; c.fillText('PULL UP', w / 2, y); y += 28 * sc; }
    if (S.plane.speed < 90) { c.fillStyle = AMBER; c.fillText('SPEED', w / 2, y); y += 28 * sc; }
    if (S.bounds > 0) { c.fillStyle = blink ? RED : AMBER; c.fillText(`RETURN TO COMBAT AREA ${Math.ceil(S.bounds)}`, w / 2, y); y += 28 * sc; }
    if (S.msg) { c.fillStyle = AMBER; c.font = `${Math.round(16 * sc)}px "Consolas","Menlo",monospace`; c.fillText(S.msg, w / 2, y); }
  }

  scoreboard(S, sc) {
    const c = this.ctx, w = this.w;
    const y = 18 * sc;
    const teams = S.teams || [];
    if (teams.length === 2) {
      c.font = `bold ${Math.round(16 * sc)}px "Consolas","Menlo",monospace`;
      const [a, b] = teams;
      c.fillStyle = a.color; c.textAlign = 'right'; c.fillText(`${a.name}  ${a.won}`, w / 2 - 16 * sc, y);
      c.fillStyle = '#cccccc'; c.textAlign = 'center'; c.fillText('–', w / 2, y);
      c.fillStyle = b.color; c.textAlign = 'left'; c.fillText(`${b.won}  ${b.name}`, w / 2 + 16 * sc, y);
      // aircraft still in the fight on each side
      const pip = (x0, dir, t) => {
        for (let i = 0; i < t.total; i++) {
          const x = x0 + dir * i * 11 * sc;
          c.fillStyle = i < t.alive ? t.color : 'rgba(255,255,255,0.18)';
          c.beginPath(); c.moveTo(x, y + 12 * sc); c.lineTo(x + 4 * sc, y + 21 * sc); c.lineTo(x - 4 * sc, y + 21 * sc); c.closePath(); c.fill();
        }
      };
      pip(w / 2 - 22 * sc, -1, a); pip(w / 2 + 22 * sc, 1, b);
      c.fillStyle = 'rgba(255,255,255,0.6)'; c.textAlign = 'center';
      c.font = `${Math.round(11 * sc)}px "Consolas","Menlo",monospace`;
      c.fillText(`FIRST TO ${S.roundsToWin}${S.timeLeft != null ? '  ·  ' + Math.floor(S.timeLeft / 60) + ':' + String(Math.floor(S.timeLeft % 60)).padStart(2, '0') : ''}`, w / 2, y + 34 * sc);
    }
    // kill feed
    c.font = `${Math.round(13 * sc)}px "Consolas","Menlo",monospace`; c.textAlign = 'right';
    let fy = 22 * sc;
    for (const f of S.feed || []) {
      c.globalAlpha = Math.min(1, f.t);
      c.fillStyle = f.color || '#ffffff';
      c.fillText(f.text, w - 18 * sc, fy); fy += 18 * sc;
    }
    c.globalAlpha = 1;
    if (S.spectate) {
      c.textAlign = 'center'; c.font = `${Math.round(15 * sc)}px "Consolas","Menlo",monospace`;
      c.fillStyle = '#ffffff'; c.fillText(S.spectate, w / 2, this.h - 40 * sc);
    }
    if (S.countdown > 0) {
      c.textAlign = 'center';
      c.font = `bold ${Math.round(64 * sc)}px "Consolas","Menlo",monospace`;
      c.fillStyle = GREEN;
      c.fillText(String(Math.ceil(S.countdown)), w / 2, this.h * 0.32);
      c.font = `${Math.round(15 * sc)}px "Consolas","Menlo",monospace`;
      c.fillText(S.countdownMsg || '', w / 2, this.h * 0.32 + 46 * sc);
    }
  }

  bannerDraw(dt, sc) {
    const b = this.banner;
    if (!b) return;
    b.t -= dt;
    if (b.t <= 0) { this.banner = null; return; }
    const c = this.ctx;
    const a = Math.min(1, b.t / 0.4, (b.dur - b.t) / 0.15 + 0.2);
    c.globalAlpha = Math.max(0, a);
    c.textAlign = 'center';
    c.font = `bold ${Math.round(40 * sc)}px "Consolas","Menlo",monospace`;
    c.fillStyle = b.color;
    c.fillText(b.text, this.w / 2, this.h * 0.24);
    if (b.sub) {
      c.font = `${Math.round(17 * sc)}px "Consolas","Menlo",monospace`;
      c.fillStyle = '#ffffff';
      c.fillText(b.sub, this.w / 2, this.h * 0.24 + 38 * sc);
    }
    c.globalAlpha = 1;
  }

  // Ground units I know about: SAM/AAA sites, ships, targets. Diamond = enemy, square box =
  // designated A/G target (fills as the seeker locks), circle = friendly ship.
  ground(S, sc) {
    const c = this.ctx, list = S.gnd;
    if (!list || !list.length) return;
    c.font = `${Math.round(11 * sc)}px "Consolas","Menlo",monospace`; c.textAlign = 'center';
    for (const g of list) {
      const p = S.project(g.pos);
      if (p.behind || p.x < -40 || p.x > this.w + 40 || p.y < -40 || p.y > this.h + 40) continue;
      const s = (g.tgt ? 12 : 7) * sc;
      const col = g.friend ? CYAN : g.emit ? AMBER : g.dead ? 'rgba(157,255,184,0.35)' : GREEN;
      c.strokeStyle = col; c.fillStyle = col;
      if (g.friend) { c.beginPath(); c.arc(p.x, p.y, s, 0, Math.PI * 2); c.stroke(); }
      else if (g.tgt) {
        c.strokeRect(p.x - s, p.y - s, 2 * s, 2 * s);
        if (g.lock != null) {
          // seeker lock progress: corner brackets close in
          const k = 1 - g.lock, e = s + 10 * sc * k;
          c.strokeStyle = g.lock >= 1 ? RED : AMBER;
          for (const [dx, dy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
            c.beginPath(); c.moveTo(p.x + dx * e, p.y + dy * (e - 6 * sc)); c.lineTo(p.x + dx * e, p.y + dy * e); c.lineTo(p.x + dx * (e - 6 * sc), p.y + dy * e); c.stroke();
          }
          if (g.lock >= 1) { c.fillStyle = RED; c.fillText('LOCK', p.x, p.y + s + 24 * sc); }
        }
      } else { c.beginPath(); c.moveTo(p.x, p.y - s); c.lineTo(p.x + s, p.y); c.lineTo(p.x, p.y + s); c.lineTo(p.x - s, p.y); c.closePath(); c.stroke(); }
      if (g.emit && !g.friend) { c.fillStyle = AMBER; c.fillText(g.code || 'SAM', p.x, p.y - s - 8 * sc); }
      if (g.tgt || g.dist < 6000) {
        c.fillStyle = col;
        c.fillText(`${g.name}${g.how === 'intel' ? ' (intel)' : ''} ${(g.dist / 1000).toFixed(1)}`, p.x, p.y + s + 10 * sc);
      }
    }
  }

  // Continuously computed impact point for bombs and rockets, with the bomb fall line.
  ccip(S, sc) {
    const C = S.ccip;
    if (!C) return;
    const c = this.ctx, p = S.project(C.pos), f = S.fpm ? S.project(S.fpm) : null;
    if (p.behind) {
      c.fillStyle = AMBER; c.textAlign = 'center'; c.font = `${Math.round(13 * sc)}px "Consolas","Menlo",monospace`;
      c.fillText('CCIP — NOSE DOWN TO SEE THE IMPACT POINT', this.w / 2, this.h / 2 + 100 * sc);
      return;
    }
    const x = Math.max(10, Math.min(this.w - 10, p.x)), y = Math.max(10, Math.min(this.h - 10, p.y));
    c.strokeStyle = S.ccipHot ? RED : GREEN; c.fillStyle = c.strokeStyle;
    if (f && !f.behind) { c.setLineDash([6 * sc, 5 * sc]); c.beginPath(); c.moveTo(f.x, f.y); c.lineTo(x, y); c.stroke(); c.setLineDash([]); }
    c.beginPath(); c.arc(x, y, 14 * sc, 0, Math.PI * 2); c.stroke();
    c.beginPath(); c.arc(x, y, 2 * sc, 0, Math.PI * 2); c.fill();
    c.font = `${Math.round(11 * sc)}px "Consolas","Menlo",monospace`; c.textAlign = 'left';
    c.fillText(`${C.t.toFixed(1)}s`, x + 18 * sc, y);
    if (S.ccipHot && Math.floor(this.flashT * 4) % 2 === 0) { c.textAlign = 'center'; c.fillText('ON TARGET', x, y - 24 * sc); }
  }

  // Flaps, gear, trim, speed brake, and a damage diagram of the jet.
  systems(S, sc) {
    const c = this.ctx, Y = S.sys;
    if (!Y) return;
    const x = 24 * sc;
    let y = this.h - 120 * sc;
    c.textAlign = 'left'; c.font = `${Math.round(13 * sc)}px "Consolas","Menlo",monospace`;
    const tag = (txt, col) => { c.fillStyle = col; c.fillText(txt, x, y); y -= 17 * sc; };
    if (Y.fire) tag(Math.floor(this.flashT * 4) % 2 ? 'FIRE!' : '', RED);
    if (Y.gear) tag(Y.gearOver ? 'GEAR — OVERSPEED' : 'GEAR DOWN', Y.gearOver ? RED : GREEN);
    if (Y.flaps > 0) tag(`FLAPS ${Y.flaps === 1 ? 'FULL' : 'HALF'}${Y.flapsOver ? ' — BLOWN UP' : ''}`, Y.flapsOver ? AMBER : GREEN);
    if (Y.brake) tag('SPD BRK', AMBER);
    if (Math.abs(Y.trim) > 0.01) tag(`TRIM ${Y.trim > 0 ? 'NOSE UP' : 'NOSE DN'} ${Math.round(Math.abs(Y.trim) * 100)}`, CYAN);
    // damage diagram (only once something is hit)
    const D = Y.dmg;
    if (!D || !Object.values(D).some((v) => v > 0.02)) return;
    const col = (v) => (v >= 1 ? RED : v >= 0.5 ? AMBER : v > 0.02 ? '#e8f070' : 'rgba(157,255,184,0.5)');
    const cx = 230 * sc, cy = this.h - 112 * sc, k = sc * 1.1;
    c.lineWidth = 2 * sc;
    const poly = (pts, v) => { c.fillStyle = col(v); c.beginPath(); pts.forEach(([px, py], i) => (i ? c.lineTo : c.moveTo).call(c, cx + px * k, cy + py * k)); c.closePath(); c.fill(); };
    poly([[-4, -34], [4, -34], [5, -22], [-5, -22]], D.radar);            // nose / radar
    poly([[-5, -22], [5, -22], [6, 10], [-6, 10]], D.fuel);               // fuselage tanks
    poly([[-6, -6], [-36, 10], [-36, 16], [-6, 12]], D.wingL);            // left wing
    poly([[6, -6], [36, 10], [36, 16], [6, 12]], D.wingR);                // right wing
    poly([[-6, 10], [6, 10], [5, 26], [-5, 26]], D.eng);                  // engine
    poly([[-5, 22], [-16, 32], [16, 32], [5, 22]], D.tail);               // tail
    c.lineWidth = 1.6 * sc;
    c.fillStyle = 'rgba(255,255,255,0.7)'; c.textAlign = 'center'; c.font = `${Math.round(10 * sc)}px "Consolas","Menlo",monospace`;
    c.fillText('DAMAGE', cx, cy + 44 * k);
  }

  // Briefing map markers projected into the view.
  markers(S, sc) {
    const c = this.ctx, list = S.marks;
    if (!list || !list.length || !S.plane.alive) return;
    const COL = { wp: CYAN, target: RED, danger: AMBER, info: '#ffffff', home: GREEN };
    c.font = `${Math.round(11 * sc)}px "Consolas","Menlo",monospace`; c.textAlign = 'center';
    for (const m of list) {
      const p = S.project(m.pos);
      if (p.behind) continue;
      const col = COL[m.icon] || '#ffffff';
      c.strokeStyle = col; c.fillStyle = col;
      const s = 6 * sc;
      c.beginPath(); c.moveTo(p.x, p.y + s); c.lineTo(p.x - s, p.y - s); c.lineTo(p.x + s, p.y - s); c.closePath(); c.stroke();
      c.fillText(`${m.label || m.icon.toUpperCase()} ${(m.dist / 1000).toFixed(0)}km`, p.x, p.y - s - 9 * sc);
    }
  }

  // Objectives, mission score, survival wave, time trial, deck status and respawn timer.
  mission(S, sc) {
    const c = this.ctx, w = this.w, h = this.h;
    c.textAlign = 'left'; c.font = `${Math.round(13 * sc)}px "Consolas","Menlo",monospace`;
    let y = 96 * sc;
    const x = 18 * sc;
    if (S.missionTitle) { c.fillStyle = '#ffffff'; c.fillText(S.missionTitle, x, y); y += 19 * sc; }
    for (const o of S.obj || []) {
      const mark = o.state === 'done' ? '✔' : o.state === 'failed' ? '✖' : '▢';
      c.fillStyle = o.state === 'done' ? GREEN : o.state === 'failed' ? RED : o.optional ? 'rgba(255,255,255,0.6)' : '#ffffff';
      const pr = o.state === 'active' && o.prog > 0 && o.prog < 1 ? ` ${Math.round(o.prog * 100)}%` : '';
      c.fillText(`${mark} ${o.label}${o.optional ? ' (optional)' : ''}${pr}`, x, y); y += 18 * sc;
    }
    if (S.missionScore) { c.fillStyle = AMBER; c.fillText(S.missionScore, x, y); y += 18 * sc; }
    // time trial
    const R = S.race;
    if (R) {
      c.textAlign = 'center'; c.font = `bold ${Math.round(22 * sc)}px "Consolas","Menlo",monospace`;
      c.fillStyle = R.high > 0 ? (Math.floor(this.flashT * 5) % 2 ? RED : AMBER) : '#ffffff';
      c.fillText(R.time, w / 2, 92 * sc);
      c.font = `${Math.round(13 * sc)}px "Consolas","Menlo",monospace`; c.fillStyle = '#ffffff';
      c.fillText(`GATE ${Math.min(R.next + 1, R.gates)}/${R.gates}${R.laps > 1 ? `  LAP ${R.lap}/${R.laps}` : ''}${R.pen > 0 ? `  +${R.pen.toFixed(1)}s` : ''}${R.best ? `  BEST ${R.best}` : ''}`, w / 2, 114 * sc);
      if (R.high > 0) { c.fillStyle = RED; c.fillText(`TOO HIGH — get below ${R.ceiling} m above the ground`, w / 2, 134 * sc); }
      if (R.gate && S.plane.alive && !R.done) {
        const p = S.project(R.gate);
        if (!p.behind && p.x > 0 && p.x < w && p.y > 0 && p.y < h) {
          c.strokeStyle = GREEN; c.beginPath(); c.arc(p.x, p.y, 9 * sc, 0, Math.PI * 2); c.stroke();
          c.fillStyle = GREEN; c.fillText(`${(R.dist / 1000).toFixed(1)} km`, p.x, p.y + 22 * sc);
        } else {
          // arrow on the edge pointing toward the next gate
          const cs = S.camSpace(R.gate);
          const a = Math.atan2(-cs.y, cs.x), Rr = Math.min(w, h) * 0.38;
          c.save(); c.translate(w / 2 + Math.cos(a) * Rr, h / 2 + Math.sin(a) * Rr); c.rotate(a);
          c.fillStyle = GREEN; c.beginPath(); c.moveTo(16 * sc, 0); c.lineTo(-8 * sc, -10 * sc); c.lineTo(-8 * sc, 10 * sc); c.closePath(); c.fill();
          c.restore();
        }
      }
    }
    c.textAlign = 'center';
    if (S.deck) { c.font = `bold ${Math.round(17 * sc)}px "Consolas","Menlo",monospace`; c.fillStyle = CYAN; c.fillText(S.deck, w / 2, h * 0.62); }
    if (S.respawn != null) { c.font = `bold ${Math.round(18 * sc)}px "Consolas","Menlo",monospace`; c.fillStyle = '#ffffff'; c.fillText(`Back in the fight in ${Math.ceil(S.respawn)} s`, w / 2, h * 0.62); }
    if (S.carrierCue && S.plane.alive) {
      // carrier approach: glideslope / lineup cue
      const K = S.carrierCue;
      c.font = `${Math.round(13 * sc)}px "Consolas","Menlo",monospace`;
      c.fillStyle = K.ok ? GREEN : AMBER;
      c.fillText(`${K.name} ${(K.dist / 1000).toFixed(1)} km · ${K.line} · ${K.slope}${K.gear ? '' : ' · GEAR UP (J)'}`, w / 2, h * 0.66);
    }
  }

  wrap(text, maxW) {
    const c = this.ctx, out = [];
    let line = '';
    for (const word of text.split(' ')) {
      const t = line ? line + ' ' + word : word;
      if (c.measureText(t).width > maxW && line) { out.push(line); line = word; } else line = t;
    }
    if (line) out.push(line);
    return out;
  }
  // training lesson prompt (top centre)
  lesson(S, sc) {
    const L = S.lesson;
    if (!L) return;
    const c = this.ctx, w = this.w;
    const bw = Math.min(680 * sc, w - 40), x = (w - bw) / 2, pad = 12 * sc;
    c.font = `${Math.round(15 * sc)}px "Consolas","Menlo",monospace`;
    const lines = this.wrap(L.text, bw - pad * 2);
    c.font = `${Math.round(12.5 * sc)}px "Consolas","Menlo",monospace`;
    const hints = L.hint ? this.wrap(L.hint, bw - pad * 2) : [];
    const y0 = 128 * sc, bh = pad * 2 + 20 * sc + lines.length * 20 * sc + hints.length * 17 * sc + (hints.length ? 6 * sc : 0);
    c.shadowBlur = 0;
    c.fillStyle = L.done ? 'rgba(20,80,40,0.72)' : 'rgba(0,0,0,0.55)'; c.fillRect(x, y0, bw, bh);
    c.strokeStyle = L.done ? GREEN : 'rgba(157,255,184,0.5)'; c.strokeRect(x, y0, bw, bh);
    c.textAlign = 'left';
    let y = y0 + pad + 8 * sc;
    c.font = `bold ${Math.round(12.5 * sc)}px "Consolas","Menlo",monospace`; c.fillStyle = GREEN;
    c.fillText(`${L.name.toUpperCase()} · STEP ${L.n}/${L.of}${L.done ? '   ✔ DONE' : ''}`, x + pad, y); y += 22 * sc;
    c.font = `${Math.round(15 * sc)}px "Consolas","Menlo",monospace`; c.fillStyle = '#ffffff';
    for (const t of lines) { c.fillText(t, x + pad, y); y += 20 * sc; }
    c.font = `${Math.round(12.5 * sc)}px "Consolas","Menlo",monospace`; c.fillStyle = 'rgba(255,255,255,0.65)';
    y += 6 * sc;
    for (const t of hints) { c.fillText(t, x + pad, y); y += 17 * sc; }
    c.shadowBlur = 3;
  }

  // missile defence coach: what is guiding on you and how to beat it, plus BEAM markers on the
  // heading tape (fly to one to put the threat on your wing: the notch)
  coach(S, sc) {
    const K = S.coach;
    if (!K) return;
    const c = this.ctx, w = this.w, h = this.h, P = S.plane, cx = w / 2;
    if (K.beam) {
      const hd = ((Math.atan2(P.fwd.x, -P.fwd.z) * 180) / Math.PI + 360) % 360, hy = 56 * sc, px = 6 * sc;
      const offs = K.beam.map((b) => ((b - hd + 540) % 360) - 180);
      const near = offs.reduce((a, b) => (Math.abs(b) < Math.abs(a) ? b : a));
      c.save(); c.strokeStyle = c.fillStyle = K.notched ? GREEN : AMBER; c.textAlign = 'center';
      c.font = `bold ${Math.round(11 * sc)}px "Consolas","Menlo",monospace`;
      for (const o of offs) {
        if (Math.abs(o) > 33) continue;
        const x = cx + o * px;
        c.beginPath(); c.moveTo(x, hy + 14 * sc); c.lineTo(x - 7 * sc, hy + 26 * sc); c.lineTo(x + 7 * sc, hy + 26 * sc); c.closePath(); c.fill();
        c.fillText('BEAM', x, hy + 36 * sc);
      }
      if (Math.abs(near) > 33) {
        const s = Math.sign(near), x = cx + s * 196 * sc;
        c.beginPath(); c.moveTo(x + s * 12 * sc, hy); c.lineTo(x, hy - 9 * sc); c.lineTo(x, hy + 9 * sc); c.closePath(); c.fill();
        c.textAlign = s > 0 ? 'left' : 'right';
        c.fillText(`BEAM ${Math.round(Math.abs(near))}°`, x + s * 18 * sc, hy);
      }
      c.restore();
    }
    const pad = 10 * sc, bw = Math.min(540 * sc, Math.max(w * 0.56, Math.min(w - 40, 420))), x = cx - bw / 2;
    c.font = `${Math.round(13 * sc)}px "Consolas","Menlo",monospace`;
    const tips = this.wrap(K.tip, bw - pad * 2);
    const rows = 2 + tips.length + (K.notch ? 1 : 0);
    const bh = pad * 2 + rows * 18 * sc, y0 = h * 0.7;
    c.shadowBlur = 0;
    c.fillStyle = 'rgba(0,0,0,0.5)'; c.fillRect(x, y0, bw, bh);
    const col = K.notched || K.coasting ? GREEN : K.title.startsWith('LAST') ? RED : AMBER;
    c.strokeStyle = col; c.strokeRect(x, y0, bw, bh);
    c.textAlign = 'left';
    let y = y0 + pad + 8 * sc;
    c.font = `bold ${Math.round(14 * sc)}px "Consolas","Menlo",monospace`; c.fillStyle = col;
    c.fillText(K.title, x + pad, y); y += 18 * sc;
    c.font = `${Math.round(12.5 * sc)}px "Consolas","Menlo",monospace`; c.fillStyle = 'rgba(255,255,255,0.8)';
    c.fillText(K.line, x + pad, y); y += 18 * sc;
    if (K.notch) {
      const n = K.notch, ok = n.vr < n.need;
      c.fillStyle = ok && n.below ? GREEN : 'rgba(255,255,255,0.8)';
      c.fillText(`NOTCH vs ${n.of}: closing ${n.vr} m/s ${ok ? '✔' : '✘'} (need < ${n.need}) · ${n.below ? 'below it ✔' : 'ABOVE IT ✘ — dive'}`, x + pad, y);
      y += 18 * sc;
    }
    c.font = `${Math.round(13 * sc)}px "Consolas","Menlo",monospace`; c.fillStyle = '#ffffff';
    for (const t of tips) { c.fillText(t, x + pad, y); y += 18 * sc; }
    c.shadowBlur = 3;
  }

  radioMenu(S, sc) {
    if (!S.radio) return;
    const c = this.ctx, x = 18 * sc;
    let y = this.h * 0.42;
    c.fillStyle = 'rgba(0,0,0,0.45)'; c.fillRect(x - 8 * sc, y - 22 * sc, 260 * sc, (S.radio.length + 1.6) * 19 * sc);
    c.textAlign = 'left'; c.font = `bold ${Math.round(14 * sc)}px "Consolas","Menlo",monospace`; c.fillStyle = CYAN;
    c.fillText('RADIO — WINGMEN', x, y); y += 22 * sc;
    c.font = `${Math.round(13 * sc)}px "Consolas","Menlo",monospace`; c.fillStyle = '#ffffff';
    S.radio.forEach((t, i) => { c.fillText(`${i + 1}  ${t}`, x, y); y += 19 * sc; });
  }

  vignette(S) {
    const c = this.ctx, w = this.w, h = this.h, P = S.plane;
    c.shadowBlur = 0;
    if (this.damageT > 0) {
      this.damageT -= 1 / 60;
      c.fillStyle = `rgba(255,30,10,${Math.min(0.35, this.damageT)})`;
      c.fillRect(0, 0, w, h);
    }
    if (!P.alive) return;
    const neg = P.g < -1.5;
    const k = P.blackedOut ? 1 : Math.max(0, (P.gloc - 0.35) / 0.65);
    if (k <= 0) return;
    const inner = Math.max(0, (1 - k) * Math.max(w, h) * 0.45);
    const grd = c.createRadialGradient(w / 2, h / 2, inner, w / 2, h / 2, Math.max(w, h) * 0.75);
    const col = neg ? '120,0,0' : '0,0,0';
    grd.addColorStop(0, `rgba(${col},0)`);
    grd.addColorStop(0.5, `rgba(${col},${0.6 * k})`);
    grd.addColorStop(1, `rgba(${col},${Math.min(1, 1.2 * k)})`);
    c.fillStyle = grd; c.fillRect(0, 0, w, h);
    if (P.blackedOut) {
      c.fillStyle = `rgba(${col},0.88)`; c.fillRect(0, 0, w, h);
      c.fillStyle = '#888'; c.textAlign = 'center'; c.font = '16px "Consolas","Menlo",monospace';
      c.fillText('G-LOC — ease off the stick', w / 2, h / 2);
    }
  }
}
