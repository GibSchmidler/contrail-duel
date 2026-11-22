// 2D canvas HUD drawn over the 3D view.
import * as THREE from 'three';

const GREEN = '#9dffb8';
const RED = '#ff5a4a';
const AMBER = '#ffcc55';
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
      this.warnings(S, scale);
    }
    this.target(S, scale);
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
      if (S.plane.missiles > 0 && S.seekerPx > 0) {
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

  target(S, sc) {
    const c = this.ctx, w = this.w, h = this.h;
    if (!S.opp || !S.opp.alive) return;
    const pt = S.project(S.opp.pos);
    const margin = 40 * sc;
    const on = !pt.behind && pt.x > margin && pt.x < w - margin && pt.y > margin && pt.y < h - margin;
    const dist = S.oppDist;
    const distTxt = dist > 2000 ? (dist / 1000).toFixed(1) + ' km' : Math.round(dist) + ' m';
    c.strokeStyle = RED; c.fillStyle = RED;
    if (on) {
      const s = Math.max(14 * sc, Math.min(60, 2400 / Math.max(dist, 1))) ;
      c.strokeRect(pt.x - s, pt.y - s, s * 2, s * 2);
      c.textAlign = 'center';
      c.font = `${Math.round(13 * sc)}px "Consolas","Menlo",monospace`;
      c.fillText(distTxt, pt.x, pt.y + s + 12 * sc);
      if (S.closure != null) c.fillText(`${S.closure > 0 ? '+' : ''}${Math.round(S.closure * 1.944)} kt`, pt.x, pt.y + s + 27 * sc);
      c.fillText(S.oppName || 'BANDIT', pt.x, pt.y - s - 10 * sc);
      // enemy health
      const bw = 44 * sc;
      c.strokeRect(pt.x - bw / 2, pt.y - s - 26 * sc, bw, 5 * sc);
      c.fillRect(pt.x - bw / 2, pt.y - s - 26 * sc, (bw * Math.max(0, S.opp.hp)) / 100, 5 * sc);
      // lock diamond
      if (S.lock.inCone || S.lock.locked) {
        const d = (S.lock.locked ? s + 8 * sc : s + 30 * sc * (1 - S.lock.progress));
        c.strokeStyle = S.lock.locked ? RED : AMBER;
        c.lineWidth = 2 * sc;
        c.beginPath(); c.moveTo(pt.x, pt.y - d); c.lineTo(pt.x + d, pt.y); c.lineTo(pt.x, pt.y + d); c.lineTo(pt.x - d, pt.y); c.closePath(); c.stroke();
        c.lineWidth = 1.6 * sc;
        if (S.lock.locked && Math.floor(this.flashT * 4) % 2 === 0) { c.fillStyle = RED; c.fillText('LOCK', pt.x, pt.y + d + 42 * sc); }
      }
    } else {
      // off-screen arrow around the center
      const cs = S.camSpace(S.opp.pos);
      let dx = cs.x, dy = -cs.y;
      if (Math.hypot(dx, dy) < 1e-3) dy = 1;
      const a = Math.atan2(dy, dx);
      const R = Math.min(w, h) * 0.36;
      const x = w / 2 + Math.cos(a) * R, y = h / 2 + Math.sin(a) * R;
      c.save(); c.translate(x, y); c.rotate(a);
      c.beginPath(); c.moveTo(16 * sc, 0); c.lineTo(-8 * sc, -11 * sc); c.lineTo(-3 * sc, 0); c.lineTo(-8 * sc, 11 * sc); c.closePath();
      c.fill(); c.restore();
      c.textAlign = 'center'; c.font = `${Math.round(13 * sc)}px "Consolas","Menlo",monospace`;
      c.fillText(distTxt, w / 2 + Math.cos(a) * (R - 30 * sc), h / 2 + Math.sin(a) * (R - 30 * sc));
    }
  }

  weapons(S, sc) {
    const c = this.ctx, P = S.plane, w = this.w, h = this.h;
    const x = w - 24 * sc, y = h - 120 * sc;
    c.textAlign = 'right'; c.fillStyle = GREEN;
    c.font = `${Math.round(15 * sc)}px "Consolas","Menlo",monospace`;
    c.fillStyle = P.gunAmmo > 0 ? GREEN : RED; c.fillText(`GUN ${P.gunAmmo}`, x, y);
    c.fillStyle = P.missiles > 0 ? GREEN : RED; c.fillText(`IR MSL ${P.missiles}`, x, y + 22 * sc);
    c.fillStyle = P.flares > 0 ? GREEN : RED; c.fillText(`FLARE ${P.flares}`, x, y + 44 * sc);
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

  radar(S, sc) {
    const c = this.ctx, P = S.plane, w = this.w, h = this.h;
    const R = 64 * sc, cx = w / 2, cy = h - R - 26 * sc, range = 8000;
    c.strokeStyle = 'rgba(157,255,184,0.45)'; c.fillStyle = 'rgba(0,20,8,0.25)';
    c.beginPath(); c.arc(cx, cy, R, 0, Math.PI * 2); c.fill(); c.stroke();
    c.beginPath(); c.arc(cx, cy, R / 2, 0, Math.PI * 2); c.stroke();
    c.beginPath(); c.moveTo(cx, cy - R); c.lineTo(cx, cy + R); c.moveTo(cx - R, cy); c.lineTo(cx + R, cy); c.stroke();
    const hd = Math.atan2(P.fwd.x, -P.fwd.z);
    const plot = (pos, color, size, label) => {
      const dx = pos.x - P.pos.x, dz = pos.z - P.pos.z;
      // rotate into heading-up frame
      const rx = dx * Math.cos(hd) + dz * Math.sin(hd);
      const ry = dx * Math.sin(hd) - dz * Math.cos(hd);
      let px = (rx / range) * R, py = -(ry / range) * R;
      const d = Math.hypot(px, py);
      if (d > R) { px *= R / d; py *= R / d; }
      c.fillStyle = color;
      c.beginPath(); c.arc(cx + px, cy + py, size, 0, Math.PI * 2); c.fill();
      if (label) {
        const dy = pos.y - P.pos.y;
        c.font = `${Math.round(11 * sc)}px "Consolas","Menlo",monospace`; c.textAlign = 'left';
        c.fillText(dy > 150 ? '▲' : dy < -150 ? '▼' : '', cx + px + 5 * sc, cy + py);
      }
    };
    if (S.opp && S.opp.alive) plot(S.opp.pos, RED, 4 * sc, true);
    for (const t of S.threats) plot(t.pos, AMBER, 2.5 * sc, false);
    c.fillStyle = GREEN; c.beginPath(); c.moveTo(cx, cy - 6 * sc); c.lineTo(cx - 4 * sc, cy + 4 * sc); c.lineTo(cx + 4 * sc, cy + 4 * sc); c.closePath(); c.fill();
  }

  warnings(S, sc) {
    const c = this.ctx, w = this.w, h = this.h;
    const blink = Math.floor(this.flashT * 5) % 2 === 0;
    c.textAlign = 'center';
    c.font = `bold ${Math.round(22 * sc)}px "Consolas","Menlo",monospace`;
    let y = h / 2 + 140 * sc;
    if (S.threats.length && S.threatDist < 6000) {
      if (blink || S.threatDist < 2000) { c.fillStyle = RED; c.fillText('MISSILE', w / 2, y); }
      y += 28 * sc;
      // direction cues on a ring
      for (const t of S.threats) {
        const cs = S.camSpace(t.pos);
        const a = Math.atan2(-cs.y, cs.x);
        const R = Math.min(w, h) * 0.3;
        c.save(); c.translate(w / 2 + Math.cos(a) * R, h / 2 + Math.sin(a) * R); c.rotate(a);
        c.fillStyle = RED;
        c.beginPath(); c.moveTo(14 * sc, 0); c.lineTo(-6 * sc, -9 * sc); c.lineTo(-6 * sc, 9 * sc); c.closePath(); c.fill();
        c.restore();
      }
    }
    if (S.pullUp && blink) { c.fillStyle = RED; c.fillText('PULL UP', w / 2, y); y += 28 * sc; }
    if (S.plane.speed < 90) { c.fillStyle = AMBER; c.fillText('SPEED', w / 2, y); y += 28 * sc; }
    if (S.bounds > 0) { c.fillStyle = blink ? RED : AMBER; c.fillText(`RETURN TO COMBAT AREA ${Math.ceil(S.bounds)}`, w / 2, y); y += 28 * sc; }
    if (S.msg) { c.fillStyle = AMBER; c.font = `${Math.round(16 * sc)}px "Consolas","Menlo",monospace`; c.fillText(S.msg, w / 2, y); }
  }

  scoreboard(S, sc) {
    const c = this.ctx, w = this.w;
    c.textAlign = 'center';
    c.font = `bold ${Math.round(16 * sc)}px "Consolas","Menlo",monospace`;
    const y = 18 * sc;
    c.fillStyle = '#9fd0ff'; c.textAlign = 'right'; c.fillText(`${S.myName}  ${S.scores.me}`, w / 2 - 16 * sc, y);
    c.fillStyle = '#cccccc'; c.textAlign = 'center'; c.fillText('–', w / 2, y);
    c.fillStyle = '#ff9c8f'; c.textAlign = 'left'; c.fillText(`${S.scores.opp}  ${S.oppName}`, w / 2 + 16 * sc, y);
    c.fillStyle = 'rgba(255,255,255,0.6)'; c.textAlign = 'center';
    c.font = `${Math.round(11 * sc)}px "Consolas","Menlo",monospace`;
    c.fillText(`FIRST TO ${S.roundsToWin}`, w / 2, y + 16 * sc);
    if (S.countdown > 0) {
      c.font = `bold ${Math.round(64 * sc)}px "Consolas","Menlo",monospace`;
      c.fillStyle = GREEN;
      c.fillText(String(Math.ceil(S.countdown)), w / 2, this.h * 0.32);
      c.font = `${Math.round(15 * sc)}px "Consolas","Menlo",monospace`;
      c.fillText('WEAPONS SAFE — MERGE INBOUND', w / 2, this.h * 0.32 + 46 * sc);
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
