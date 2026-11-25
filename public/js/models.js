// Procedural low-poly jets and missiles (nose points to -Z). Each jet is built from its
// MODELS entry: fuselage, intakes, wings, canards, tails, nozzles, canopy and sensors, with a
// camouflage shader and national markings. Every mesh carries userData.part so a wreck can
// break the airframe apart along real seams (nose, wings, tails).
import * as THREE from 'three';
import { jetOf, DEFAULT_JET } from './aircraft.js';
import { MODELS } from './models_jets.js';

const PI = Math.PI;

// ---------------- geometry helpers ----------------
// Flat panel from an [x, z] polygon, thickness t, centred on y = 0.
function panelXZ(pts, t) {
  const s = new THREE.Shape(); s.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false });
  g.rotateX(PI / 2); g.translate(0, t / 2, 0);
  return g;
}
// Vertical panel from a [z, y] profile, thickness t, centred on x = 0.
function panelZY(pts, t) {
  const s = new THREE.Shape(); s.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false });
  g.rotateY(-PI / 2); g.translate(t / 2, 0, 0);
  return g;
}
function lathe(prof, segs, sx, sy, y = 0) {
  const g = new THREE.LatheGeometry(prof.map(([r, z]) => new THREE.Vector2(Math.max(r, 0.001), z)), segs);
  g.rotateX(PI / 2); g.scale(sx, sy, 1); g.translate(0, y, 0);
  return g;
}
// Eight-corner block: front face (tl, tr, br, bl) and back face (tl, tr, br, bl).
function block(f, b) {
  const P = [...f, ...b];
  const quads = [[0, 1, 2, 3], [5, 4, 7, 6], [4, 5, 1, 0], [3, 2, 6, 7], [4, 0, 3, 7], [1, 5, 6, 2]];
  const pos = [];
  for (const [a, b2, c, d] of quads) for (const i of [a, b2, c, a, c, d]) pos.push(...P[i]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}
const mirrorX = (g) => g.clone().scale(-1, 1, 1);
// z range of a polygon [[x, z]...] cut at x = xs (for placing decals on wings)
function chordAt(pts, xs) {
  let zmin = 1e9, zmax = -1e9;
  for (let i = 0; i < pts.length; i++) {
    const [x0, z0] = pts[i], [x1, z1] = pts[(i + 1) % pts.length];
    if ((x0 - xs) * (x1 - xs) > 0 || x0 === x1) continue;
    const z = z0 + (z1 - z0) * ((xs - x0) / (x1 - x0));
    zmin = Math.min(zmin, z); zmax = Math.max(zmax, z);
  }
  return [zmin, zmax];
}

// ---------------- camouflage shader ----------------
// Paint is computed from the body-space position, so the pattern stays put when a wreck
// tears the airframe into pieces. uScorch blackens it for burnt wreckage.
function paintMaterial(p, scorch = 0) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.62, metalness: p.metal ?? 0.3, flatShading: true, side: THREE.DoubleSide });
  const U = {
    uTop: { value: new THREE.Color(p.top) }, uBelly: { value: new THREE.Color(p.belly) },
    uPatch: { value: new THREE.Color(p.patch ?? p.top) }, uPatch2: { value: new THREE.Color(p.patch2 ?? p.patch ?? p.top) },
    uPattern: { value: p.pattern || 0 }, uScale: { value: p.scale || 0.2 }, uScorch: { value: scorch },
  };
  m.userData.uniforms = U;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBody; varying vec3 vBodyN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBody = position; vBodyN = normal;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vBody; varying vec3 vBodyN;
uniform vec3 uTop, uBelly, uPatch, uPatch2; uniform float uPattern, uScale, uScorch;
float h3(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float vn(vec3 p){ vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h3(i), h3(i + vec3(1,0,0)), f.x), mix(h3(i + vec3(0,1,0)), h3(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h3(i + vec3(0,0,1)), h3(i + vec3(1,0,1)), f.x), mix(h3(i + vec3(0,1,1)), h3(i + vec3(1,1,1)), f.x), f.y), f.z); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  vec3 bp = vec3(abs(vBody.x), vBody.y, vBody.z); // symmetric left/right like real schemes
  float topness = smoothstep(-0.3, 0.25, vBodyN.y);
  vec3 col = mix(uBelly, uTop, topness);
  if (uPattern > 0.5 && uPattern < 1.5) {
    float n = vn(bp * uScale + 3.1) * 0.65 + vn(bp * uScale * 2.3 + 9.7) * 0.35;
    col = mix(col, uPatch, smoothstep(0.55, 0.58, n) * topness);
  } else if (uPattern > 1.5 && uPattern < 2.5) {
    vec3 q = floor(vec3(bp.x * 0.8 + bp.z * 0.6, bp.y * 0.5, bp.z * 0.8 - bp.x * 0.6) * uScale + 0.5);
    float n = h3(q);
    col = mix(col, uPatch, step(0.5, n) * topness);
    col = mix(col, uPatch2, step(0.84, n) * topness);
  } else if (uPattern > 2.5) {
    float n = vn(floor(bp * uScale * 5.0) / 5.0 * 3.0);
    col = mix(col, uPatch, step(0.56, n));
  }
  float sn = vn(bp * 1.4 + 7.0);
  col = mix(col, vec3(0.055, 0.05, 0.045), clamp(uScorch * (0.55 + sn * 0.6), 0.0, 1.0));
  diffuseColor.rgb = col;
}`);
  };
  m.customProgramCacheKey = () => 'camo';
  return m;
}

// ---------------- markings ----------------
const texCache = new Map();
function canvasTex(key, w, h, draw) {
  if (texCache.has(key)) return texCache.get(key);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  draw(ctx, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  texCache.set(key, t);
  return t;
}
function starPath(ctx, cx, cy, R, r) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -PI / 2 + (i * PI) / 5, rr = i % 2 ? r : R;
    ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  }
  ctx.closePath();
}
// Insignia: [texture, width/height aspect]
function insignia(kind) {
  if (typeof document === 'undefined') return null;
  switch (kind) {
    case 'usa': case 'usaFaint': {
      const col = kind === 'usa' ? '#454a51' : '#5f656c';
      return [canvasTex(kind, 512, 256, (c, w, h) => {
        c.strokeStyle = col; c.lineWidth = 10;
        c.beginPath(); c.arc(w / 2, h / 2, 92, 0, PI * 2); c.stroke();
        c.strokeRect(46, h / 2 - 30, 120, 60); c.strokeRect(w - 166, h / 2 - 30, 120, 60);
        starPath(c, w / 2, h / 2 + 6, 88, 34); c.stroke();
      }), 2];
    }
    case 'rus':
      return [canvasTex('rus', 256, 256, (c, w, h) => {
        starPath(c, w / 2, h / 2 + 10, 118, 46);
        c.lineJoin = 'miter'; c.strokeStyle = '#c8241c'; c.lineWidth = 20; c.stroke();
        c.strokeStyle = '#ffffff'; c.lineWidth = 11; c.stroke();
        c.fillStyle = '#d42a20'; c.fill();
      }), 1];
    case 'chn':
      return [canvasTex('chn', 512, 256, (c, w, h) => {
        c.fillStyle = '#e8c020'; c.fillRect(16, h / 2 - 38, w - 32, 76);
        c.fillStyle = '#c8241c'; c.fillRect(26, h / 2 - 28, w - 52, 56);
        c.fillStyle = '#e8c020'; c.beginPath(); c.arc(w / 2, h / 2, 118, 0, PI * 2); c.fill();
        starPath(c, w / 2, h / 2 + 8, 112, 44); c.fillStyle = '#e8c020'; c.fill();
        starPath(c, w / 2, h / 2 + 8, 98, 38); c.fillStyle = '#c8241c'; c.fill();
        c.fillStyle = '#e8c020'; c.font = 'bold 50px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillText('八一', w / 2, h / 2 + 14);
      }), 2];
    case 'uk':
      return [canvasTex('uk', 256, 256, (c, w, h) => {
        c.fillStyle = '#8aa3bd'; c.beginPath(); c.arc(w / 2, h / 2, 120, 0, PI * 2); c.fill();
        c.fillStyle = '#d0a0a2'; c.beginPath(); c.arc(w / 2, h / 2, 56, 0, PI * 2); c.fill();
      }), 1];
    case 'fr':
      return [canvasTex('fr', 256, 256, (c, w, h) => {
        c.fillStyle = '#2b4c9b'; c.beginPath(); c.arc(w / 2, h / 2, 120, 0, PI * 2); c.fill();
        c.fillStyle = '#f2f2f2'; c.beginPath(); c.arc(w / 2, h / 2, 82, 0, PI * 2); c.fill();
        c.fillStyle = '#c8302b'; c.beginPath(); c.arc(w / 2, h / 2, 42, 0, PI * 2); c.fill();
      }), 1];
    case 'se':
      return [canvasTex('se', 256, 256, (c, w, h) => {
        c.fillStyle = '#2f68b3'; c.beginPath(); c.arc(w / 2, h / 2, 120, 0, PI * 2); c.fill();
        c.fillStyle = '#f2c230';
        const crown = (x, y, s) => {
          c.beginPath(); c.moveTo(x - s, y + s * 0.6); c.lineTo(x - s, y - s * 0.4); c.lineTo(x - s * 0.5, y); c.lineTo(x, y - s * 0.7);
          c.lineTo(x + s * 0.5, y); c.lineTo(x + s, y - s * 0.4); c.lineTo(x + s, y + s * 0.6); c.closePath(); c.fill();
        };
        crown(w / 2 - 44, h / 2 - 30, 30); crown(w / 2 + 44, h / 2 - 30, 30); crown(w / 2, h / 2 + 46, 30);
      }), 1];
  }
  return null;
}
function textTex(text, col, edge) {
  return canvasTex(`t:${text}:${col}:${edge}`, 512, 192, (c, w, h) => {
    c.font = `bold ${text.length > 3 ? 120 : 150}px "Arial Narrow", Arial, sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
    if (edge) { c.lineWidth = 14; c.strokeStyle = edge; c.lineJoin = 'round'; c.strokeText(text, w / 2, h / 2); }
    c.fillStyle = col; c.fillText(text, w / 2, h / 2);
  });
}
const decalMats = new Map();
function decalMat(tex) {
  if (decalMats.has(tex)) return decalMats.get(tex);
  const m = new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, roughness: 0.7, metalness: 0.1, polygonOffset: true, polygonOffsetFactor: -4, side: THREE.DoubleSide });
  decalMats.set(tex, m);
  return m;
}

// ---------------- missiles ----------------
// len, r: body; tail/mid/canard: [span, chord] fins; lattice: grid tail fins (R-77);
// intakes: ramjet air intakes (Meteor); colours of body and nose.
const MSL = {
  aim9m:   { len: 2.87, r: 0.064, tail: [0.42, 0.3], canard: [0.36, 0.2], nose: 0x2a2a2a },
  aim9x:   { len: 3.02, r: 0.064, tail: [0.3, 0.22], canard: [0.12, 0.08], nose: 0x7a6a3a },
  aim120:  { len: 3.66, r: 0.089, tail: [0.42, 0.32], mid: [0.32, 0.5], nose: 0xd8d8d0 },
  aim120d: { len: 3.66, r: 0.089, tail: [0.38, 0.32], mid: [0.32, 0.5], nose: 0xd8d8d0, body: 0xdcdcd6 },
  r73:     { len: 2.9, r: 0.085, tail: [0.36, 0.32], canard: [0.3, 0.22], nose: 0x3a3a38, body: 0xcfd1cc },
  r74m:    { len: 2.9, r: 0.085, tail: [0.34, 0.3], canard: [0.26, 0.2], nose: 0x5a5440, body: 0xb9bcb8 },
  r77:     { len: 3.6, r: 0.1, lattice: [0.34, 0.16], mid: [0.12, 1.0], nose: 0xcfcfc8, body: 0xcfd1cc },
  r771:    { len: 3.71, r: 0.1, lattice: [0.34, 0.16], mid: [0.12, 1.0], nose: 0xcfcfc8, body: 0xc7c9c4 },
  r77m:    { len: 3.71, r: 0.1, lattice: [0.3, 0.16], mid: [0.1, 1.1], nose: 0xbfc0b8, body: 0xb6bab7 },
  r27er:   { len: 4.78, r: 0.13, tail: [0.42, 0.5], mid: [0.38, 0.55], canard: [0.22, 0.2], nose: 0xd8d8d0, body: 0xd5d5cf },
  pl10:    { len: 3.0, r: 0.08, tail: [0.24, 0.3], nose: 0x7a6a3a, body: 0xd8d8d4 },
  pl12:    { len: 3.93, r: 0.1, tail: [0.4, 0.35], mid: [0.25, 0.6], nose: 0xd8d8d0, body: 0xd4d4ce },
  pl15:    { len: 4.0, r: 0.1, tail: [0.24, 0.32], nose: 0xd8d8d0, body: 0xd0d0cc },
  irist:   { len: 2.94, r: 0.064, tail: [0.25, 0.25], canard: [0.08, 0.5], nose: 0x5a4a30, body: 0xe0e0dc },
  micair:  { len: 3.1, r: 0.08, tail: [0.25, 0.28], mid: [0.06, 1.6], nose: 0x7a6a3a, body: 0xe2e2de },
  micaem:  { len: 3.1, r: 0.08, tail: [0.25, 0.28], mid: [0.06, 1.6], nose: 0xd8d8d0, body: 0xe2e2de },
  meteor:  { len: 3.65, r: 0.089, tail: [0.32, 0.35], intakes: true, nose: 0xd8d8d0, body: 0xe6e6e2 },
};
const _mslMat = new Map();
const mslMat = (hex) => { if (!_mslMat.has(hex)) _mslMat.set(hex, new THREE.MeshStandardMaterial({ color: hex, roughness: 0.5, metalness: 0.2 })); return _mslMat.get(hex); };
export function buildMissileMesh(key = 'aim9x') {
  const d = MSL[key] || MSL.aim9x;
  const g = new THREE.Group();
  const white = mslMat(d.body || 0xe6e6e2), nose = mslMat(d.nose), band = mslMat(0xd8b400);
  const R = d.r * 1.7, L = d.len; // slightly oversized so they read at a distance
  const body = new THREE.CylinderGeometry(R, R, L, 8); body.rotateX(PI / 2);
  g.add(new THREE.Mesh(body, white));
  const cl = d.r > 0.09 ? 0.6 : 0.34;
  const cone = new THREE.ConeGeometry(R, cl, 8); cone.rotateX(-PI / 2); cone.translate(0, 0, -L / 2 - cl / 2);
  g.add(new THREE.Mesh(cone, nose));
  const bandG = new THREE.CylinderGeometry(R * 1.02, R * 1.02, 0.08, 8); bandG.rotateX(PI / 2); bandG.translate(0, 0, -L * 0.18);
  g.add(new THREE.Mesh(bandG, band));
  const fins = (span, chord, z, thick = 0.02) => {
    for (let i = 0; i < 4; i++) {
      const f = new THREE.BoxGeometry(thick, span, chord); f.translate(0, R + span / 2, z);
      const m = new THREE.Mesh(f, white); m.rotation.z = (i * PI) / 2 + PI / 4; g.add(m);
    }
  };
  if (d.tail) fins(d.tail[0], d.tail[1], L / 2 - d.tail[1] / 2);
  if (d.lattice) fins(d.lattice[0], d.lattice[1], L / 2 - 0.12, 0.09);
  if (d.mid) fins(d.mid[0], d.mid[1], -0.15);
  if (d.canard) fins(d.canard[0], d.canard[1], -L / 2 + 0.35);
  if (d.intakes) for (const s of [-1, 1]) { const b = new THREE.BoxGeometry(0.1, 0.12, 0.9); b.translate(s * (R + 0.04), -R * 0.4, 0.4); g.add(new THREE.Mesh(b, white)); }
  return g;
}

// ---------------- jets ----------------
const _glass = {
  smoke: new THREE.MeshStandardMaterial({ color: 0x3a5068, roughness: 0.12, metalness: 0.35 }),
  gold: new THREE.MeshStandardMaterial({ color: 0x8c7a44, roughness: 0.15, metalness: 0.55 }),
};
const _dark = new THREE.MeshStandardMaterial({ color: 0x232527, roughness: 0.5, metalness: 0.7, flatShading: true, side: THREE.DoubleSide });
const _mouth = new THREE.MeshBasicMaterial({ color: 0x0a0b0c, side: THREE.DoubleSide });
const _burnt = new THREE.MeshStandardMaterial({ color: 0x6b5d50, roughness: 0.45, metalness: 0.8, flatShading: true, side: THREE.DoubleSide });
const _frame = new THREE.MeshStandardMaterial({ color: 0x2f3237, roughness: 0.6, metalness: 0.4 });

// opts.scorch (0..1) builds burnt wreckage: no flames, stores or markings.
export function buildJet(typeKey = DEFAULT_JET, opts = {}) {
  const key = MODELS[typeKey] ? typeKey : DEFAULT_JET;
  const M = MODELS[key], T = jetOf(key), P = M.paint;
  const wreck = opts.scorch != null;
  const g = new THREE.Group();
  const paint = paintMaterial(P, wreck ? opts.scorch : 0);
  const radome = new THREE.MeshStandardMaterial({ color: P.radome, roughness: 0.55, metalness: 0.2, flatShading: true, side: THREE.DoubleSide });
  if (wreck) radome.color.lerp(new THREE.Color(0x111111), opts.scorch * 0.8);
  const add = (geo, mat, part) => { const m = new THREE.Mesh(geo, mat); m.userData.part = part; g.add(m); return m; };
  const both = (geo, mat, partR, partL) => { add(geo, mat, partR); add(mirrorX(geo), mat, partL || partR); };

  // fuselage: radome, forward fuselage and the rest, split where the airframe would tear
  const F = M.fus, prof = F.prof;
  const sp = F.split;
  const k = prof.findIndex(([, z]) => z > sp);
  const [r0, z0] = prof[k - 1], [r1, z1] = prof[k];
  const rs = r0 + (r1 - r0) * ((sp - z0) / (z1 - z0));
  const front = [...prof.slice(0, k), [rs, sp]], back = [[rs, sp], ...prof.slice(k)];
  const radLen = Math.min(2.4, (sp - prof[0][1]) * 0.55);
  const rk = Math.max(1, front.findIndex(([, z]) => z > prof[0][1] + radLen));
  add(lathe(front.slice(0, rk + 1), F.segs, F.sx, F.sy, F.y || 0), radome, 'nose');
  add(lathe(front.slice(rk), F.segs, F.sx, F.sy, F.y || 0), paint, 'nose');
  add(lathe(back, F.segs, F.sx, F.sy, F.y || 0), paint, 'core');
  if (wreck) {
    const cap = new THREE.CircleGeometry(rs * 0.92, 10); cap.scale(F.sx, F.sy, 1); cap.translate(0, F.y || 0, sp);
    add(cap, _dark, 'nose'); add(cap.clone().translate(0, 0, 0.02), _dark, 'core');
  }

  // flat lifting body between nacelles (Flankers, MiG-29, F-15), LERX, tail stinger
  if (M.body) { const b = M.body; const geo = panelXZ(b.pts, b.t); geo.translate(0, b.y, 0); both(geo, paint, 'core'); }
  if (M.lerx) { const b = M.lerx; const geo = panelXZ(b.pts, b.t); geo.translate(0, b.y, 0); both(geo, paint, 'core'); }
  if (M.stinger) {
    const s = M.stinger;
    add(lathe([[s.r, s.z0], [s.r * 0.95, (s.z0 + s.z1) / 2], [s.r * 0.6, s.z1 - 0.3], [0.05, s.z1]], 10, 1, 1, s.y), paint, 'core');
  }

  // intakes and engine nacelles
  for (const n of M.nacelles || []) {
    const hw = n.w / 2, hh = n.h / 2, hw1 = n.w1 / 2, hh1 = n.h1 / 2;
    const zf = n.z0, zb = n.z1, L = n.lip;
    // front corners (tl, tr, br, bl); the lip rakes the mouth
    let ztl = zf, ztr = zf, zbr = zf, zbl = zf;
    if (n.intake === 'rect' || n.intake === 'dsi') { zbl = zbr = zf + L; }                     // top lip forward
    if (n.intake === 'chin' || n.intake === 'chin2') { ztl = ztr = zf + L; }                   // lower lip forward ("smile")
    if (n.intake === 'caret') { zbr = zf + L * 0.5; ztl = zf + L * 0.5; zbl = zf + L; }         // swept in two planes
    const x = n.x, y = n.y;
    const fq = [[x - hw, y + hh, ztl], [x + hw, y + hh, ztr], [x + hw, y - hh, zbr], [x - hw, y - hh, zbl]];
    const bq = [[x - hw1, y + hh1, zb], [x + hw1, y + hh1, zb], [x + hw1, y - hh1, zb], [x - hw1, y - hh1, zb]];
    let geo;
    if (n.intake === 'round') {
      geo = new THREE.CylinderGeometry(hw, hw1, zb - zf, 12, 1, false, PI, PI); geo.rotateX(PI / 2); geo.scale(1, hh / hw, 1); geo.translate(x - hw * 0.4, y, (zf + zb) / 2);
    } else geo = block(fq, bq);
    const mouth = block(fq.map(([a, b, c]) => [x + (a - x) * 0.86, y + (b - y) * 0.82, c + 0.02]), fq.map(([a, b, c]) => [x + (a - x) * 0.86, y + (b - y) * 0.82, c + 0.25]));
    if (x === 0) { add(geo, paint, 'core'); add(mouth, _mouth, 'core'); }
    else { both(geo, paint, 'core'); both(mouth, _mouth, 'core'); }
    if (n.intake === 'dsi') { // diverterless bump ahead of the mouth
      const bump = new THREE.SphereGeometry(1, 10, 6); bump.scale(n.w * 0.32, 0.22, 0.7);
      bump.translate(x - Math.sign(x) * hw * 0.9, x === 0 ? y + hh : y + hh * 0.2, zf - 0.1);
      if (x === 0) add(bump, paint, 'core'); else both(bump, paint, 'core');
    }
    if (n.intake === 'round') { // half shock cone (Rafale)
      const c = new THREE.ConeGeometry(hw * 0.45, 0.6, 8); c.rotateX(-PI / 2); c.translate(x - hw * 0.75, y, zf - 0.15);
      both(c, _dark, 'core');
    }
    if (n.intake === 'chin2') { // Typhoon's split "smiling" intake
      const sp2 = new THREE.BoxGeometry(0.08, n.h * 0.8, 0.5); sp2.translate(0, y, zf + L * 0.5);
      add(sp2, paint, 'core');
    }
  }

  // nozzles and afterburner flames
  const flames = [];
  const flameMats = {
    outer: new THREE.MeshBasicMaterial({ color: 0xff8a3d, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    inner: new THREE.MeshBasicMaterial({ color: 0xbfd8ff, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    disc: new THREE.MeshBasicMaterial({ color: 0xff7030, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  };
  const nozzleList = [];
  for (const n of M.nozzles) { nozzleList.push(n); if (n.x !== 0) nozzleList.push({ ...n, x: -n.x }); }
  for (const n of nozzleList) {
    if (n.type === '2d') {
      const hz = n.len / 2;
      const fq = [[-n.w / 2, n.h / 2, -hz], [n.w / 2, n.h / 2, -hz], [n.w / 2, -n.h / 2, -hz], [-n.w / 2, -n.h / 2, -hz]];
      const bq = [[-n.w / 2, n.h * 0.38, hz], [n.w / 2, n.h * 0.38, hz], [n.w / 2, -n.h * 0.38, hz], [-n.w / 2, -n.h * 0.38, hz]];
      const geo = block(fq, bq); geo.translate(n.x, n.y, n.z);
      add(geo, _dark, 'core');
    } else {
      const geo = new THREE.CylinderGeometry(n.r * (n.type === 'tvc' ? 0.95 : 0.88), n.r, n.len, 14, 1, true); geo.rotateX(PI / 2); geo.translate(n.x, n.y, n.z);
      add(geo, n.type === 'tvc' ? _burnt : _dark, 'core');
      if (n.type === 'tvc') { // the movable petal ring
        const ring = new THREE.CylinderGeometry(n.r * 1.03, n.r * 1.03, 0.25, 14, 1, true); ring.rotateX(PI / 2); ring.translate(n.x, n.y, n.z - n.len * 0.3);
        add(ring, _dark, 'core');
      }
    }
    const disc = new THREE.CircleGeometry(n.r * 0.8, 12); disc.translate(n.x, n.y, n.z + n.len * 0.3);
    add(disc, _mouth, 'core');
    if (!wreck) {
      const fg = new THREE.Group();
      fg.position.set(n.x, n.y, n.z + n.len / 2 - 0.05);
      const sc = n.r / 0.62;
      const outer = new THREE.ConeGeometry(0.62 * sc, 4 * sc, 14, 1, true); outer.rotateX(PI / 2); outer.translate(0, 0, 2 * sc);
      const inner = new THREE.ConeGeometry(0.4 * sc, 2.5 * sc, 12, 1, true); inner.rotateX(PI / 2); inner.translate(0, 0, 1.25 * sc);
      fg.add(new THREE.Mesh(outer, flameMats.outer), new THREE.Mesh(inner, flameMats.inner), new THREE.Mesh(new THREE.CircleGeometry(0.66 * sc, 14), flameMats.disc));
      if (n.type === '2d') fg.scale.set(1.3, 0.6, 1);
      fg.userData.base = fg.scale.clone();
      fg.traverse((o) => { o.userData.part = 'flame'; });
      g.add(fg); flames.push(fg);
    }
  }

  // wings, canards, stabilators
  const surface = (S, partR, partL) => {
    const geo = panelXZ(S.pts, S.t);
    if (S.dihedral) geo.rotateZ(S.dihedral);
    geo.translate(0, S.y, 0);
    both(geo, paint, partR, partL);
  };
  surface(M.wing, 'wingR', 'wingL');
  if (M.canard) surface(M.canard, 'nose');
  if (M.stab) surface(M.stab, 'stabR', 'stabL');
  if (M.tipPods) {
    const [x, y, z, len, r] = M.tipPods;
    const pod = new THREE.CylinderGeometry(r, r, len, 8); pod.rotateX(PI / 2); pod.translate(x, y, z);
    both(pod, radome, 'wingR', 'wingL');
  }

  // vertical tails (single on the centreline, or a canted pair), ventral fins
  const finMatrix = (x, y0, cant, side) => new THREE.Matrix4().makeTranslation(x * side, y0, 0).multiply(new THREE.Matrix4().makeRotationZ(-cant * side));
  const fs = M.fins;
  const finParts = fs.x === 0 ? [[1, 'fin']] : [[1, 'finR'], [-1, 'finL']];
  const finDecals = [];
  for (const [side, part] of finParts) {
    const mtx = finMatrix(fs.x, fs.y0, fs.cant, side);
    const geo = panelZY(fs.pts, fs.t); geo.applyMatrix4(mtx);
    add(geo, paint, part);
    finDecals.push({ mtx, part, side });
  }
  if (M.ventral) {
    const v = M.ventral;
    for (const side of [1, -1]) {
      const geo = panelZY(v.pts, 0.08); geo.applyMatrix4(finMatrix(v.x, v.y0, -v.cant, side));
      add(geo, paint, 'core');
    }
  }

  // canopy, sensors, probe
  const C = M.canopy;
  const can = new THREE.SphereGeometry(1, 16, 10); can.scale(C.w, C.h, C.len / 2); can.translate(0, C.y, C.z);
  const canopy = add(can, _glass[C.glass || 'smoke'], 'canopy');
  if (C.framed) {
    const fr = new THREE.TorusGeometry(1, 0.04, 4, 16, PI); fr.scale(C.w * 1.02, C.h * 1.02, 1); fr.translate(0, C.y, C.z - C.len * 0.18);
    add(fr, _frame, 'canopy');
  }
  if (M.irst) { const b = new THREE.SphereGeometry(0.17, 10, 8); b.translate(...M.irst); add(b, _glass.gold, 'nose'); }
  if (M.probe) {
    const len = 1.3, pr = new THREE.CylinderGeometry(0.03, 0.05, len, 6); pr.rotateX(PI / 2);
    if (M.probe === 'side') pr.translate(0.45, 0.55, prof[0][1] + 2.2); else pr.translate(0, F.y || 0, prof[0][1] - len / 2 + 0.05);
    add(pr, _dark, 'nose');
  }

  // ---- markings ----
  if (!wreck && typeof document !== 'undefined') {
    const ins = insignia(P.ins);
    const decal = (tex, w, h, mtx, part) => {
      const geo = new THREE.PlaneGeometry(w, h); geo.applyMatrix4(mtx);
      const m = new THREE.Mesh(geo, decalMat(tex)); m.userData.part = part; m.renderOrder = 1; g.add(m);
    };
    const W = M.wing, tipX = Math.max(...W.pts.map((p) => p[0]));
    const xs = tipX * 0.66, [za, zb] = chordAt(W.pts, xs), zc = (za + zb) / 2;
    if (ins) {
      const [tex, asp] = ins;
      const s = Math.min(1.5, (zb - za) * 0.75) * (asp > 1 ? 0.8 : 1);
      const dih = (W.dihedral || 0) * xs;
      const yTop = (W.y || 0) + W.t / 2 + 0.03, yBot = (W.y || 0) - W.t / 2 - 0.03;
      const wingDecal = (side, top) => decal(tex, s * asp, s, new THREE.Matrix4().makeTranslation(side * xs, (top ? yTop : yBot) + dih, zc).multiply(new THREE.Matrix4().makeRotationX(top ? -PI / 2 : PI / 2)), side > 0 ? 'wingR' : 'wingL');
      // USA style: top of the left wing and bottom of the right; others both wings
      if (P.ins.startsWith('usa')) { wingDecal(-1, true); wingDecal(1, false); }
      else { wingDecal(1, true); wingDecal(-1, true); wingDecal(1, false); wingDecal(-1, false); }
      if (P.insFus) {
        const [x, y, z, sz] = P.insFus;
        for (const side of [1, -1]) decal(tex, sz * asp, sz, new THREE.Matrix4().makeTranslation(side * x, y, z).multiply(new THREE.Matrix4().makeRotationY(side * PI / 2)), 'core');
      }
      if (P.finIns) for (const fd of finDecals) {
        const zc2 = (fs.pts[0][0] + fs.pts[1][0] + fs.pts[2][0] + fs.pts[3][0]) / 4, yc = fs.pts[2][1] * 0.5;
        const sz = Math.min(1.3, fs.pts[2][1] * 0.42);
        for (const face of [1, -1]) {
          if (fs.x !== 0 && face !== fd.side) continue; // a pair of fins: outer faces only
          decal(tex, sz * asp, sz, fd.mtx.clone().multiply(new THREE.Matrix4().makeTranslation(face * (fs.t / 2 + 0.02), yc, zc2 + 0.3)).multiply(new THREE.Matrix4().makeRotationY(face * PI / 2)), fd.part);
        }
      }
    }
    if (P.tail) {
      const tex = textTex(P.tail, P.tailCol, null);
      for (const fd of finDecals) {
        const zc2 = (fs.pts[1][0] + fs.pts[2][0]) / 2 - 0.4, yc = fs.pts[2][1] * 0.55;
        for (const face of [1, -1]) {
          if (fs.x !== 0 && face !== fd.side) continue;
          decal(tex, 1.9, 0.72, fd.mtx.clone().multiply(new THREE.Matrix4().makeTranslation(face * (fs.t / 2 + 0.02), yc, zc2)).multiply(new THREE.Matrix4().makeRotationY(face * PI / 2)), fd.part);
        }
      }
    }
    if (P.bort) {
      const [x, y, z, sz] = P.bortPos;
      const tex = textTex(P.bort, P.bortCol, P.bortEdge);
      for (const side of [1, -1]) decal(tex, sz * 2.7, sz, new THREE.Matrix4().makeTranslation(side * x, y, z).multiply(new THREE.Matrix4().makeRotationY(side * PI / 2)), 'nose');
    }
  }

  // ---- stores: one mesh per missile type this jet can carry, at each station ----
  const used = new Set(); for (const L of Object.values(T.loadouts)) for (const s of L.st) if (s) used.add(s);
  const stations = wreck ? [] : T.stations.map(([x, y, z, kind]) => {
    const st = {};
    if (kind === 'bay') return st; // internal: out of sight until launch
    for (const mk of used) {
      const m = buildMissileMesh(mk);
      m.position.set(x, y, z);
      m.visible = false; m.traverse((o) => { o.userData.part = 'store'; }); g.add(m); st[mk] = m;
    }
    if (kind === 'wing' || kind === 'body') {
      const ph = kind === 'wing' ? Math.max(0.2, (M.wing.y || 0) - y - 0.1) : 0.25;
      const py = new THREE.Mesh(new THREE.BoxGeometry(0.12, ph, 1.5), paint); py.position.set(x, y + 0.1 + ph / 2, z);
      py.userData.part = kind === 'wing' ? (x > 0 ? 'wingR' : 'wingL') : 'core'; g.add(py);
    } else if (kind === 'tip') {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.14, 2.6), paint); rail.position.set(x, y, z);
      rail.userData.part = x > 0 ? 'wingR' : 'wingL'; g.add(rail);
    }
    return st;
  });

  g.traverse((o) => { o.frustumCulled = true; });
  return {
    group: g, type: key, flames, canopy, model: M,
    cockpit: [0, C.y - 0.15, C.z + 0.2],
    setStores(stores) { stations.forEach((st, i) => { for (const k2 in st) st[k2].visible = !!stores && stores[i] === k2; }); },
    setThrottle(eng, t) {
      const ab = Math.max(0, (eng - 1) / 0.2);
      const flick = 0.9 + 0.1 * Math.sin(t * 60) + 0.05 * Math.sin(t * 97);
      const len = (0.25 + eng * 0.35 + ab * 1.2) * flick;
      for (const f of flames) {
        f.visible = eng > 0.05;
        const b = f.userData.base;
        f.scale.set(b.x * (0.8 + ab * 0.25), b.y * (0.8 + ab * 0.25), len);
      }
      flameMats.outer.opacity = 0.15 + ab * 0.5;
      flameMats.inner.opacity = 0.25 + ab * 0.55;
      flameMats.disc.opacity = 0.35 + eng * 0.3 + ab * 0.3;
    },
    dispose() {
      g.traverse((o) => { if (o.geometry && o.userData.part !== 'store') o.geometry.dispose(); });
      paint.dispose(); radome.dispose(); for (const m of Object.values(flameMats)) m.dispose();
    },
  };
}

// Small torn-metal fragments (shared geometry).
export const FRAGMENT_GEOS = [
  new THREE.BoxGeometry(0.9, 0.06, 0.6), new THREE.BoxGeometry(0.4, 0.05, 1.3),
  new THREE.TetrahedronGeometry(0.5), new THREE.BoxGeometry(0.35, 0.35, 0.8),
];

// Ejection seat with pilot, and a round canopy parachute with its rigging lines.
export function buildPilot() {
  const g = new THREE.Group();
  const seatMat = new THREE.MeshStandardMaterial({ color: 0x2a2b2c, roughness: 0.8, flatShading: true });
  const suit = new THREE.MeshStandardMaterial({ color: 0x4d5a3a, roughness: 0.9, flatShading: true });
  const helmet = new THREE.MeshStandardMaterial({ color: 0xd9d6cc, roughness: 0.5 });
  const seat = new THREE.Group();
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.62, 1.15, 0.18), seatMat); back.position.set(0, 0.35, 0.32); seat.add(back);
  const pan = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.16, 0.62), seatMat); pan.position.set(0, -0.2, 0.05); seat.add(pan);
  g.add(seat);
  const man = new THREE.Group();
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.62, 0.3), suit); torso.position.set(0, 0.2, 0.08); man.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 8), helmet); head.position.set(0, 0.68, 0.06); man.add(head);
  for (const s of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.75), suit); leg.position.set(s * 0.12, -0.12, -0.3); man.add(leg);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.5, 0.1), suit); arm.position.set(s * 0.3, 0.2, 0.06); man.add(arm);
  }
  g.add(man);

  // parachute (origin at the pilot; canopy ~7 m above)
  const chute = new THREE.Group();
  const cg = new THREE.SphereGeometry(4.2, 16, 6, 0, Math.PI * 2, 0, Math.PI * 0.42);
  cg.scale(1, 0.55, 1);
  const cols = []; const pos = cg.attributes.position;
  const orange = new THREE.Color(0xf26b1d), white = new THREE.Color(0xf2efe6);
  for (let i = 0; i < pos.count; i++) {
    const a = Math.atan2(pos.getZ(i), pos.getX(i));
    const c = Math.floor(((a + Math.PI) / (Math.PI * 2)) * 8) % 2 ? orange : white;
    cols.push(c.r, c.g, c.b);
  }
  cg.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  const canopyMesh = new THREE.Mesh(cg, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide, flatShading: true }));
  canopyMesh.position.y = 7.2 - 4.2 * 0.55 * Math.cos(Math.PI * 0.42);
  chute.add(canopyMesh);
  const rim = 4.2 * Math.sin(Math.PI * 0.42), rimY = 7.2 - 4.2 * 0.55 * Math.cos(Math.PI * 0.42) + 4.2 * 0.55 * Math.cos(Math.PI * 0.42);
  const lp = [];
  for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; lp.push(0, 0.5, 0, Math.cos(a) * rim, rimY - 0.05, Math.sin(a) * rim); }
  const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
  chute.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x3a3a3a, transparent: true, opacity: 0.6 })));
  chute.visible = false;
  g.add(chute);
  return { group: g, seat, man, chute };
}
