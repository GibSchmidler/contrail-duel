// Environment: procedural terrain (deterministic so every client matches), shader water, sky,
// clouds and lights. Several maps, times of day and weather settings.
import * as THREE from 'three';

const SIZE = 80000;      // terrain extent (m)
const N = 320;           // grid segments (250 m)
const STEP = SIZE / N;
const HALF = SIZE / 2;
export const ARENA_RADIUS = 30000;

// ------------------------------------------------------------------ noise
function hash(i, j) {
  let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vnoise(x, y) {
  const i = Math.floor(x), j = Math.floor(y);
  const fx = x - i, fy = y - j;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hash(i, j), b = hash(i + 1, j), c = hash(i, j + 1), d = hash(i + 1, j + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y, oct = 6) {
  let s = 0, a = 0.5, f = 1;
  for (let o = 0; o < oct; o++) { s += a * vnoise(x * f, y * f); f *= 2.03; a *= 0.5; }
  return s;
}
const ridge = (x, y, oct) => 1 - Math.abs(fbm(x, y, oct) * 2 - 1);
function smooth(a, b, x) { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
const edgeFade = (h, x, z, to = -60) => { const k = smooth(31000, 39500, Math.hypot(x, z)); return h + (to - h) * k; };

// ------------------------------------------------------------------ maps
// Each map: height function (metres) + a palette for the terrain and water shaders.
export const MAPS = {
  islands: {
    name: 'Islands', desc: 'A green archipelago with forested hills, beaches and snow-capped peaks.',
    height(x, z) {
      const n = fbm(x / 9000 + 10.3, z / 9000 + 3.7);
      const r = ridge(x / 4500 + 7.1, z / 4500 + 1.9, 5);
      let h = (n - 0.45) * 2600 + r * r * 1300 * smooth(0.42, 0.68, n);
      h -= smooth(30000, 39000, Math.hypot(x, z)) * 1500;
      return h;
    },
    pal: { grass: 0x5d7d38, forest: 0x2f4d26, rock: 0x77706a, sand: 0xd8c693, snow: 0xf2f4f7, deep: 0x124a72, shallow: 0x2aaab0, sandH: 16, rockH: 1150, snowH: 1680, treeH: 950, rockSlope: 0.42, forest: 0.75, ice: 0, dry: 0 },
  },
  alps: {
    name: 'Alpine', desc: 'High jagged ridges, deep valleys and glacier lakes. Great for terrain masking.',
    height(x, z) {
      const n = fbm(x / 14000 + 3.1, z / 14000 + 8.4);
      const r = ridge(x / 5200 + 1.3, z / 5200 + 4.2, 5);
      const r2 = ridge(x / 2100 + 9.1, z / 2100 + 2.2, 4);
      let h = 260 + (n - 0.42) * 1300 + r * r * r * 2000 * smooth(0.32, 0.64, n) + r2 * r2 * 200 * smooth(0.34, 0.6, n);
      if (n < 0.37) h -= (0.37 - n) * 3600;  // valley lakes
      return edgeFade(h, x, z, -80);
    },
    pal: { grass: 0x5a7d3a, forest: 0x25411f, rock: 0x6d6964, sand: 0x8f877a, snow: 0xf4f6fa, deep: 0x1a4c5e, shallow: 0x3f948e, sandH: 6, rockH: 1550, snowH: 2000, treeH: 1350, rockSlope: 0.45, forest: 0.85, ice: 0, dry: 0 },
  },
  desert: {
    name: 'Desert Canyons', desc: 'Red sandstone mesas cut by deep canyons, dune fields and a coastline to the east.',
    height(x, z) {
      const n = fbm(x / 11000 + 5.5, z / 11000 + 1.1);
      const t = Math.max(0, n - 0.36) * 2600;
      const stepH = 230, k = Math.floor(t / stepH), f = t / stepH - k;
      let h = 140 + k * stepH + smooth(0.72, 0.97, f) * stepH;       // terraced mesas with cliff faces
      const c = Math.abs(fbm(x / 9000 + 2.2, z / 9000 + 7.7, 4) - 0.5);
      h -= (1 - smooth(0.0, 0.045, c)) * Math.max(0, h - 70);           // river canyons cut to the floor
      h += Math.sin((x * 0.8 + z * 0.6) / 380 + fbm(x / 3000, z / 3000, 3) * 7) * 12 * (1 - smooth(150, 380, h)); // dunes
      h -= smooth(14000, 30000, x + (fbm(z / 8000, 1.3, 3) - 0.5) * 14000) * 900;  // the coast
      return edgeFade(h, x, z);
    },
    pal: { grass: 0xb08a5c, forest: 0x7a6844, rock: 0xa8553a, sand: 0xdcbc8a, snow: 0xffffff, deep: 0x115878, shallow: 0x45c6b8, sandH: 150, rockH: 520, snowH: 1e9, treeH: 0, rockSlope: 0.12, forest: 0.15, ice: 0, dry: 1 },
  },
  arctic: {
    name: 'Arctic Fjords', desc: 'Snowbound mountains plunging into icy fjords. Cold, bright and featureless.',
    height(x, z) {
      const n = fbm(x / 9500 + 12.2, z / 9500 + 6.6);
      const r = ridge(x / 3800 + 4.4, z / 3800 + 2.7, 5);
      const fj = ridge(x / 7000 + 1.7, z / 7000 + 9.9, 3);
      let h = (n - 0.4) * 2400 + r * r * 1800 * smooth(0.36, 0.6, n);
      h -= smooth(0.8, 0.95, fj) * 1500;
      return edgeFade(h, x, z, -120);
    },
    pal: { grass: 0x6c6e58, forest: 0x34443a, rock: 0x4b4d52, sand: 0x6a6964, snow: 0xf3f6fb, deep: 0x0f3652, shallow: 0x30707e, sandH: 5, rockH: 1e9, snowH: 160, treeH: 220, rockSlope: 0.36, forest: 0.3, ice: 1, dry: 0 },
  },
};

export const TIMES = {
  dawn:  { name: 'Dawn', el: 7, az: 80, sun: 0xffb27a, sunI: 2.0, sky: 0xa3b2d8, gnd: 0x4b4136, hemiI: 0.85, zenith: 0x3b5d9c, horizon: 0xf2b88e, stars: 0 },
  day:   { name: 'Day', el: 40, az: 35, sun: 0xfff1dc, sunI: 2.4, sky: 0xc4dcff, gnd: 0x56633f, hemiI: 1.1, zenith: 0x2a63bd, horizon: 0xbcd2e8, stars: 0 },
  dusk:  { name: 'Dusk', el: 4, az: 262, sun: 0xff8f52, sunI: 1.8, sky: 0x8d88b8, gnd: 0x3f3430, hemiI: 0.75, zenith: 0x2b3b7a, horizon: 0xf29c6c, stars: 0.15 },
  night: { name: 'Night (moonlit)', el: 38, az: 200, sun: 0xa6b8ff, sunI: 0.55, sky: 0x3b4c78, gnd: 0x12161c, hemiI: 0.5, zenith: 0x040916, horizon: 0x1a2742, stars: 1, moon: true },
};

export const WEATHER = {
  clear:     { name: 'Clear', clouds: 14, alt: [2600, 5200], fog: 0.000015, vis: 10000, grey: 0, chop: 0.7 },
  scattered: { name: 'Scattered clouds', clouds: 80, alt: [1800, 5000], fog: 0.000026, vis: 8000, grey: 0.05, chop: 1.0 },
  broken:    { name: 'Broken clouds', clouds: 170, alt: [1500, 3800], fog: 0.000032, vis: 7000, grey: 0.25, chop: 1.3, sunMul: 0.8 },
  overcast:  { name: 'Overcast', clouds: 45, alt: [1200, 3200], deck: 4300, fog: 0.00004, vis: 6000, grey: 0.5, chop: 1.6, sunMul: 0.4 },
  haze:      { name: 'Haze', clouds: 18, alt: [3000, 5500], fog: 0.00008, vis: 3500, grey: 0.18, chop: 0.6, sunMul: 0.85 },
};

// ------------------------------------------------------------------ heights (shared by physics + rendering)
let heights = new Float32Array((N + 1) * (N + 1));
export let MAX_TERRAIN = 0;
export let MAP_KEY = '';
let visRangeM = 8000;
// How far a pilot can spot another jet by eye in this weather (also used by the AI).
export function visRange() { return visRangeM; }

function generate(key, out, n = N) {
  const fn = (MAPS[key] || MAPS.islands).height;
  const step = SIZE / n;
  for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) out[i * (n + 1) + j] = fn(-HALF + j * step, -HALF + i * step);
  return out;
}
function loadHeights(key) {
  MAP_KEY = MAPS[key] ? key : 'islands';
  generate(MAP_KEY, heights);
  let m = 0;
  for (let k = 0; k < heights.length; k++) if (heights[k] > m) m = heights[k];
  MAX_TERRAIN = m;
}
loadHeights('islands');

// Low-res height grid for the scenario builder's map preview.
export function previewHeights(key, n = 160) { return { n, size: SIZE, h: generate(key, new Float32Array((n + 1) * (n + 1)), n) }; }

export function terrainHeight(x, z) {
  const fj = (x + HALF) / STEP, fi = (z + HALF) / STEP;
  if (fj < 0 || fi < 0 || fj >= N || fi >= N) return -1500;
  const j = Math.floor(fj), i = Math.floor(fi);
  const tx = fj - j, tz = fi - i;
  const ha = heights[i * (N + 1) + j];
  const hd = heights[i * (N + 1) + j + 1];
  const hb = heights[(i + 1) * (N + 1) + j];
  const hc = heights[(i + 1) * (N + 1) + j + 1];
  if (tx + tz <= 1) return ha + (hd - ha) * tx + (hb - ha) * tz;
  return hc + (hb - hc) * (1 - tx) + (hd - hc) * (1 - tz);
}
// Solid surface (sea level is solid too).
export function groundHeight(x, z) { return Math.max(0, terrainHeight(x, z)); }

// Terrain masking: true when the straight line from a to b clears the ground.
export function lineOfSight(a, b, clearance = 0) {
  if (a.y > MAX_TERRAIN && b.y > MAX_TERRAIN) return true;
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const len = Math.hypot(dx, dy, dz);
  const n = Math.ceil(len / 200);
  if (n < 2) return true;
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const y = a.y + dy * t;
    if (y > MAX_TERRAIN) continue;
    if (groundHeight(a.x + dx * t, a.z + dz * t) + clearance > y) return false;
  }
  return true;
}

// Mutable so importers always see the current light.
export const SUN_DIR = new THREE.Vector3(0.45, 0.62, -0.64).normalize();
export const FOG_COLOR = new THREE.Color(0xb9cfe4);

// ------------------------------------------------------------------ procedural textures
// Tileable fbm on a size x size grid with the given base period (must divide size).
function tileFbm(size, period, oct, seed) {
  const out = new Float32Array(size * size);
  for (let o = 0, p = period, a = 0.5; o < oct; o++, p *= 2, a *= 0.5) {
    const cell = size / p;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const fx = x / cell, fy = y / cell;
      const i = Math.floor(fx), j = Math.floor(fy);
      const u = fx - i, v = fy - j;
      const su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v);
      const h = (a2, b2) => hash(((a2 % p) + p) % p + seed * 131, ((b2 % p) + p) % p + o * 977 + seed * 17);
      const n = h(i, j) + (h(i + 1, j) - h(i, j)) * su + (h(i, j + 1) - h(i, j)) * sv + (h(i, j) - h(i + 1, j) - h(i, j + 1) + h(i + 1, j + 1)) * su * sv;
      out[y * size + x] += a * n;
    }
  }
  return out;
}
function canvasTex(size, fill, repeat = true) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d');
  const img = g.createImageData(size, size);
  fill(img.data);
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}
// Detail textures centred on mid grey so the palette colour * 2 * texel keeps the palette's brightness.
function makeTerrainTextures() {
  const S = 256;
  const A = tileFbm(S, 4, 5, 1), B = tileFbm(S, 16, 3, 2), C = tileFbm(S, 8, 4, 3);
  const put = (d, k, r, g, b) => { d[k] = Math.max(0, Math.min(255, r * 255)); d[k + 1] = Math.max(0, Math.min(255, g * 255)); d[k + 2] = Math.max(0, Math.min(255, b * 255)); d[k + 3] = 255; };
  const grass = canvasTex(S, (d) => {
    for (let p = 0; p < S * S; p++) {
      const s = Math.random() * 0.12, v = 0.38 + A[p] * 0.22 + B[p] * 0.1 + s;
      const warm = (C[p] - 0.45) * 0.12;
      put(d, p * 4, v + warm, v + 0.02, v - warm * 0.5);
    }
  });
  const forest = canvasTex(S, (d) => {
    for (let p = 0; p < S * S; p++) {
      const crowns = Math.pow(Math.max(0, B[p] - 0.3) * 1.6, 1.4); // clumpy tree crowns
      const v = 0.28 + crowns * 0.45 + A[p] * 0.12 + Math.random() * 0.06;
      put(d, p * 4, v * 0.95, v, v * 0.9);
    }
  });
  const rock = canvasTex(S, (d) => {
    for (let p = 0; p < S * S; p++) {
      const y = Math.floor(p / S);
      const strata = Math.sin((y / S) * Math.PI * 2 * 9 + A[p] * 9) * 0.07;
      const crack = Math.pow(1 - Math.abs(C[p] * 2 - 1), 10) * -0.22;
      const v = 0.42 + A[p] * 0.18 + strata + crack + Math.random() * 0.08;
      put(d, p * 4, v + 0.01, v, v - 0.01);
    }
  });
  const sand = canvasTex(S, (d) => {
    for (let p = 0; p < S * S; p++) {
      const x = p % S;
      const rip = Math.sin((x / S) * Math.PI * 2 * 14 + A[p] * 12) * 0.035;
      const v = 0.45 + A[p] * 0.1 + rip + Math.random() * 0.07;
      put(d, p * 4, v + 0.01, v, v - 0.02);
    }
  });
  const snow = canvasTex(S, (d) => {
    for (let p = 0; p < S * S; p++) {
      const v = 0.47 + A[p] * 0.07 + B[p] * 0.03 + Math.random() * 0.025;
      put(d, p * 4, v - 0.01, v, v + 0.015);
    }
  });
  const macro = canvasTex(S, (d) => { for (let p = 0; p < S * S; p++) { const v = A[p] * 0.7 + C[p] * 0.3; put(d, p * 4, v, B[p], C[p]); } });
  // fine relief for the lighting: gullies and lumps much smaller than the 250 m height grid
  const D = tileFbm(S, 8, 6, 5);
  const bump = canvasTex(S, (d) => { for (let p = 0; p < S * S; p++) { const r = 1 - Math.abs(D[p] * 2 - 0.9); const v = D[p] * 0.6 + r * r * 0.4; put(d, p * 4, v, v, v); } });
  bump.repeat.set(SIZE / 1400, SIZE / 1400);
  return { grass, forest, rock, sand, snow, macro, bump };
}
// Tileable wave normal map built from a periodic height field.
function makeWaterNormals() {
  const S = 256;
  const H = tileFbm(S, 8, 5, 7);
  const F = tileFbm(S, 32, 2, 9);
  return canvasTex(S, (d) => {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const h = (xx, yy) => H[((yy + S) % S) * S + ((xx + S) % S)];
      const dx = (h(x + 1, y) - h(x - 1, y)) * 6, dy = (h(x, y + 1) - h(x, y - 1)) * 6;
      const l = Math.hypot(dx, dy, 1);
      const k = (y * S + x) * 4;
      d[k] = (-dx / l * 0.5 + 0.5) * 255; d[k + 1] = (-dy / l * 0.5 + 0.5) * 255; d[k + 2] = F[y * S + x] * 255; d[k + 3] = 255;
    }
  });
}

// ------------------------------------------------------------------ shaders
const TERRAIN_FRAG = `
  // The sea is opaque, so the seabed is never seen. Not drawing it stops it fighting the water
  // surface for the depth buffer, which flickers badly at long range.
  if (vWPos.y < -0.3) discard;
  float slope = 1.0 - clamp(normalize(vWNorm).y, 0.0, 1.0);
  float h = vWPos.y;
  vec2 uvA = vWPos.xz / 64.0, uvB = vWPos.xz / 820.0;
  vec4 mac = texture2D(tMacro, vWPos.xz / 5200.0);
  float nz = mac.r - 0.5;
  float p1 = texture2D(tMacro, vWPos.xz / 900.0).r, p2 = texture2D(tMacro, vWPos.xz / 2600.0).b;
  vec3 tGr = texture2D(tGrass, uvA).rgb * 0.55 + texture2D(tGrass, uvB).rgb * 0.45;
  vec3 tFo = texture2D(tForest, uvA * 0.7).rgb * 0.6 + texture2D(tForest, uvB).rgb * 0.4;
  vec3 tRo = texture2D(tRock, vec2(uvA.x, uvA.y + h / 90.0)).rgb * 0.55 + texture2D(tRock, uvB + vec2(0.0, h / 700.0)).rgb * 0.45;
  vec3 tSa = texture2D(tSand, uvA).rgb * 0.6 + texture2D(tSand, uvB).rgb * 0.4;
  vec3 tSn = texture2D(tSnow, uvA).rgb * 0.5 + texture2D(tSnow, uvB).rgb * 0.5;
  // vegetation: forest density from the vertex mask, thinning out up the mountain
  float forest = clamp(smoothstep(0.25, 0.6, vColor.r + (p1 - 0.45) * 0.5) * uForest * (1.0 - smoothstep(uTreeH - 250.0, uTreeH + 80.0, h + nz * 300.0)) * (1.0 - smoothstep(0.35, 0.55, slope)), 0.0, 1.0);
  vec3 grass = cGrass * (0.62 + p1 * 0.55 + vColor.g * 0.25);
  grass = mix(grass, grass * vec3(1.3, 1.1, 0.6), smoothstep(0.4, 0.62, p2) * 0.7 * (1.0 - uDry));
  grass = mix(grass, grass * vec3(1.28, 1.08, 0.62), smoothstep(0.42, 0.68, mac.b) * 0.65 * (1.0 - uDry)); // dry meadows
  grass = mix(grass, grass * vec3(0.78, 0.9, 0.8), smoothstep(0.5, 0.75, mac.g) * 0.5);
  vec3 col = mix(grass * tGr, cForest * tFo, forest) * 2.0;
  // dry scrub on the desert map fades into sand on flat ground
  col = mix(col, cSand * tSa * 2.0, uDry * 0.7 * (1.0 - smoothstep(0.06, 0.16, slope)) * smoothstep(0.45, 0.75, p2));
  float wRock = smoothstep(uRockSlope - 0.08, uRockSlope + 0.06, slope + nz * 0.18);
  wRock = max(wRock, smoothstep(uRockH - 180.0, uRockH + 120.0, h + nz * 360.0));
  float wSand = (1.0 - smoothstep(uSandH - 4.0, uSandH + 12.0, h + nz * 40.0)) * (1.0 - smoothstep(0.22, 0.42, slope));
  float wSnow = smoothstep(uSnowH - 90.0, uSnowH + 90.0, h + nz * 420.0) * (1.0 - smoothstep(0.5, 0.78, slope));
  col = mix(col, cRock * tRo * 2.0, wRock);
  col = mix(col, cSand * tSa * 2.0, wSand);
  col = mix(col, cSnow * tSn * 2.0, wSnow);
  // wet sand and seabed
  col *= mix(1.0, 0.7, (1.0 - smoothstep(0.0, 3.0, h)) * wSand);
  col *= 1.0 - slope * 0.22;
  col = mix(col, cSand * 0.55, 1.0 - smoothstep(-6.0, 0.0, h));
  diffuseColor.rgb = col;
`;

const WATER_VERT = `
varying vec3 vW;
#include <fog_pars_vertex>
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vW = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const WATER_FRAG = `
uniform float uTime, uChop, uIce, uLight, uStars;
uniform vec3 uSunDir, uSunCol, uZenith, uHorizon, uDeep, uShallow;
uniform sampler2D tNormal, tDepth, tMacro;
uniform vec4 uDepthXf;
varying vec3 vW;
#include <fog_pars_fragment>
vec2 nrm(vec2 uv){ return texture2D(tNormal, uv).xy * 2.0 - 1.0; }
void main(){
  vec2 p = vW.xz;
  float dist = length(cameraPosition - vW);
  float fade = 1.0 / (1.0 + dist / 1800.0);
  float far = 1.0 / (1.0 + dist / 9000.0);
  vec2 s = nrm(p / 260.0 + vec2(uTime * 0.011, uTime * 0.007)) * 0.9
         + nrm(p / 95.0 + vec2(-uTime * 0.016, uTime * 0.012)) * 0.6 * fade
         + nrm(p / 31.0 + vec2(uTime * 0.03, -uTime * 0.026)) * 0.35 * fade
         + nrm(p / 1700.0 + vec2(uTime * 0.002, -uTime * 0.003)) * 0.8;
  vec3 N = normalize(vec3(s.x * uChop * 0.2 * far, 1.0, s.y * uChop * 0.2 * far));
  vec3 V = normalize(cameraPosition - vW);
  float ndv = max(dot(N, V), 0.0);
  float F = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
  vec3 R = reflect(-V, N); R.y = abs(R.y);
  vec3 sky = mix(uHorizon, uZenith, pow(R.y, 0.55));
  float sd = max(dot(R, uSunDir), 0.0);
  vec3 spec = uSunCol * (pow(sd, 900.0) * 7.0 + pow(sd, 90.0) * 0.35) * uLight;
  // depth from the terrain height field: turquoise shallows, dark deep water, surf at the shore
  vec2 duv = (p + uDepthXf.xy) * uDepthXf.z + uDepthXf.w;
  float dt = texture2D(tDepth, duv).r;
  float depth = dt * dt * 80.0;
  float dl = max(uSunDir.y, 0.0) * 0.75 + 0.35;
  vec3 body = mix(uShallow, uDeep, smoothstep(0.5, 26.0, depth)) * dl * uLight;
  body += uShallow * 0.08 * max(0.0, s.x + s.y) * fade; // light through wave crests
  vec3 col = mix(body, sky * 0.95, max(F, 0.08)) + spec;
  float foamN = texture2D(tNormal, p / 40.0 + vec2(uTime * 0.02, 0.0)).b;
  float shore = 1.0 - smoothstep(0.0, 1.3, depth);
  float surf = shore * smoothstep(0.45, 0.7, foamN + shore * 0.35 + 0.15 * sin(uTime * 1.3 + depth * 4.0)) * 0.7;
  float caps = smoothstep(0.86, 0.97, foamN) * max(0.0, uChop - 0.9) * 0.6 * fade;
  col = mix(col, vec3(0.92) * dl * uLight, clamp(surf + caps, 0.0, 1.0));
  // sea ice on the arctic map: broken floes away from the coast
  vec4 mac = texture2D(tMacro, p / 2600.0);
  float ice = uIce * smoothstep(0.52, 0.56, mac.r * 0.75 + mac.b * 0.35 + foamN * 0.08) * smoothstep(4.0, 18.0, depth);
  col = mix(col, vec3(0.86, 0.9, 0.95) * dl * uLight * (0.92 + foamN * 0.1), ice);
  gl_FragColor = vec4(col, 1.0);
  #include <fog_fragment>
  #include <colorspace_fragment>
}`;

const SKY_FRAG = `uniform vec3 sunDir; uniform vec3 horizon; uniform vec3 zenith; uniform vec3 sunCol; uniform float stars; uniform float moon; varying vec3 vDir;
  float h21(vec2 p){ p = fract(p * vec2(234.34, 435.345)); p += dot(p, p + 34.23); return fract(p.x * p.y); }
  void main(){
    vec3 d = normalize(vDir);
    float h = clamp(d.y, -1.0, 1.0);
    vec3 sunH = normalize(vec3(sunDir.x, 0.0, sunDir.z) + 1e-4);
    float toward = pow(max(dot(normalize(vec3(d.x, 0.0, d.z) + 1e-4), sunH), 0.0), 2.0);
    vec3 hz = mix(mix(horizon, zenith, 0.35), horizon, 0.45 + 0.55 * toward);
    vec3 col = mix(hz, zenith, pow(smoothstep(0.0, 0.55, h), 0.6));
    col = mix(col, horizon * 0.85, smoothstep(0.0, -0.2, h));
    float s = max(dot(d, sunDir), 0.0);
    if (moon > 0.5) col += vec3(0.85, 0.9, 1.0) * smoothstep(0.99965, 0.99975, s) * 1.4 + sunCol * pow(s, 40.0) * 0.08;
    else col += sunCol * (pow(s, 700.0) * 3.0 + pow(s, 14.0) * 0.28 + pow(s, 3.0) * 0.08 * (1.0 - h));
    if (stars > 0.0 && h > 0.0) {
      vec2 g = vec2(atan(d.z, d.x) * 180.0, h * 260.0);
      vec2 c = floor(g);
      float r = h21(c);
      float star = step(0.992, r) * smoothstep(0.45, 0.0, length(fract(g) - 0.5)) * (0.5 + 0.5 * h21(c + 7.0));
      col += vec3(star) * stars * smoothstep(0.0, 0.25, h);
    }
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }`;

// ------------------------------------------------------------------ world
export class World {
  constructor(scene) {
    this.scene = scene;
    this.time = 0;
    scene.fog = new THREE.FogExp2(FOG_COLOR.clone(), 0.000026);
    scene.background = FOG_COLOR.clone();
    this.sun = new THREE.DirectionalLight(0xfff1dc, 2.4);
    scene.add(this.sun);
    this.hemi = new THREE.HemisphereLight(0xc4dcff, 0x56633f, 1.1);
    scene.add(this.hemi);
    this.tex = makeTerrainTextures();
    this.waterNormals = makeWaterNormals();
    this.depthData = new Uint8Array((N + 1) * (N + 1));
    this.depthTex = new THREE.DataTexture(this.depthData, N + 1, N + 1, THREE.RedFormat, THREE.UnsignedByteType);
    this.depthTex.magFilter = THREE.LinearFilter; this.depthTex.minFilter = THREE.LinearFilter;
    this.env = { time: 'day', weather: 'scattered' };
    this.cloudTex = this.makeCloudTextures();
    this.buildSky();
    this.buildTerrain();
    this.buildSea();
    this.setMap('islands', true);
    this.setEnv('day', 'scattered');
  }

  // ---------------- sky ----------------
  buildSky() {
    const geo = new THREE.SphereGeometry(150000, 32, 16);
    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { sunDir: { value: SUN_DIR }, horizon: { value: new THREE.Color() }, zenith: { value: new THREE.Color() }, sunCol: { value: new THREE.Color() }, stars: { value: 0 }, moon: { value: 0 } },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = modelViewMatrix*vec4(position,1.0); gl_Position = projectionMatrix*p; gl_Position.z = gl_Position.w; }`,
      fragmentShader: SKY_FRAG,
    });
    this.sky = new THREE.Mesh(geo, this.skyMat);
    this.sky.renderOrder = -1;
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);
  }

  // ---------------- terrain ----------------
  buildTerrain() {
    const geo = new THREE.PlaneGeometry(SIZE, SIZE, N, N);
    geo.rotateX(-Math.PI / 2);
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 3), 3));
    const T = this.tex;
    const U = this.terrainUniforms = {
      tGrass: { value: T.grass }, tForest: { value: T.forest }, tRock: { value: T.rock }, tSand: { value: T.sand }, tSnow: { value: T.snow }, tMacro: { value: T.macro },
      cGrass: { value: new THREE.Color() }, cForest: { value: new THREE.Color() }, cRock: { value: new THREE.Color() }, cSand: { value: new THREE.Color() }, cSnow: { value: new THREE.Color() },
      uSandH: { value: 0 }, uRockH: { value: 0 }, uSnowH: { value: 0 }, uTreeH: { value: 0 }, uRockSlope: { value: 0 }, uForest: { value: 0 }, uDry: { value: 0 },
    };
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, bumpMap: T.bump, bumpScale: 6 });
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, U);
      sh.vertexShader = 'varying vec3 vWPos;\nvarying vec3 vWNorm;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWNorm = normalize(mat3(modelMatrix) * objectNormal);');
      const decl = 'varying vec3 vWPos;\nvarying vec3 vWNorm;\nuniform sampler2D tGrass, tForest, tRock, tSand, tSnow, tMacro;\nuniform vec3 cGrass, cForest, cRock, cSand, cSnow;\nuniform float uSandH, uRockH, uSnowH, uTreeH, uRockSlope, uForest, uDry;\n';
      sh.fragmentShader = decl + sh.fragmentShader.replace('#include <color_fragment>', TERRAIN_FRAG);
    };
    mat.customProgramCacheKey = () => 'terrain-v3';
    this.terrain = new THREE.Mesh(geo, mat);
    this.terrain.frustumCulled = false;
    this.scene.add(this.terrain);
  }

  // ---------------- water ----------------
  buildSea() {
    const geo = new THREE.PlaneGeometry(400000, 400000);
    geo.rotateX(-Math.PI / 2);
    // texel centres: u = ((x + HALF) / STEP + 0.5) / (N + 1)
    const k = 1 / (STEP * (N + 1));
    this.waterU = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uTime: { value: 0 }, uChop: { value: 1 }, uIce: { value: 0 }, uLight: { value: 1 }, uStars: { value: 0 },
      uSunDir: { value: SUN_DIR }, uSunCol: { value: new THREE.Color() }, uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() },
      uDeep: { value: new THREE.Color() }, uShallow: { value: new THREE.Color() },
      tNormal: { value: null }, tDepth: { value: null }, tMacro: { value: null },
      uDepthXf: { value: new THREE.Vector4(HALF, HALF, k, 0.5 / (N + 1)) },
    }]);
    this.waterU.tNormal.value = this.waterNormals; this.waterU.tDepth.value = this.depthTex; this.waterU.tMacro.value = this.tex.macro;
    this.waterU.uSunDir.value = SUN_DIR;
    const mat = new THREE.ShaderMaterial({ uniforms: this.waterU, vertexShader: WATER_VERT, fragmentShader: WATER_FRAG, fog: true });
    // Push the sea back in the depth buffer so low-lying shores always win against it, even far
    // away where depth precision is coarse. Safe because the seabed isn't drawn: anything behind
    // the water surface along a view ray is underwater anyway.
    mat.polygonOffset = true; mat.polygonOffsetFactor = 4; mat.polygonOffsetUnits = 64;
    this.sea = new THREE.Mesh(geo, mat);
    this.scene.add(this.sea);
  }

  setMap(key, force) {
    if (!force && key === MAP_KEY) return;
    loadHeights(key);
    const M = MAPS[MAP_KEY], P = M.pal;
    const geo = this.terrain.geometry;
    const pos = geo.attributes.position, col = geo.attributes.color;
    for (let k = 0; k < pos.count; k++) {
      const h = heights[k];
      pos.setY(k, h);
      const x = pos.getX(k), z = pos.getZ(k);
      const forest = smooth(0.38, 0.56, fbm(x / 2600 + 3.3, z / 2600 + 9.1, 4));
      col.setXYZ(k, forest, fbm(x / 1500 + 1.1, z / 1500 + 2.2, 3), 0);
      const d = Math.min(80, Math.max(0, -h));
      this.depthData[k] = Math.round(Math.sqrt(d / 80) * 255);
    }
    pos.needsUpdate = true; col.needsUpdate = true;
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    this.depthTex.needsUpdate = true;
    const U = this.terrainUniforms;
    U.cGrass.value.set(P.grass); U.cForest.value.set(P.forest); U.cRock.value.set(P.rock); U.cSand.value.set(P.sand); U.cSnow.value.set(P.snow);
    U.uSandH.value = P.sandH; U.uRockH.value = P.rockH; U.uSnowH.value = P.snowH; U.uTreeH.value = P.treeH; U.uRockSlope.value = P.rockSlope; U.uForest.value = P.forest; U.uDry.value = P.dry;
    this.waterU.uDeep.value.set(P.deep); this.waterU.uShallow.value.set(P.shallow); this.waterU.uIce.value = P.ice;
    this.buildClouds();
  }

  // ---------------- clouds ----------------
  makeCloudTextures() {
    const out = [];
    for (let v = 0; v < 4; v++) {
      const cv = document.createElement('canvas');
      cv.width = cv.height = 128;
      const g = cv.getContext('2d');
      let seed = 11 + v * 101;
      const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
      for (let i = 0; i < 26; i++) {
        const x = 64 + (rnd() - 0.5) * 70, y = 70 + (rnd() - 0.5) * 34 - (i / 26) * 10, r = 14 + rnd() * 24;
        const top = y < 64;
        const grd = g.createRadialGradient(x, y - r * 0.35, 0, x, y, r);
        grd.addColorStop(0, top ? 'rgba(255,255,255,0.6)' : 'rgba(250,250,252,0.5)');
        grd.addColorStop(0.6, top ? 'rgba(240,242,248,0.35)' : 'rgba(200,206,218,0.32)');
        grd.addColorStop(1, 'rgba(190,196,210,0)');
        g.fillStyle = grd; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
      }
      const t = new THREE.CanvasTexture(cv);
      t.colorSpace = THREE.SRGBColorSpace;
      out.push(t);
    }
    return out;
  }
  buildClouds() {
    if (this.clouds) {
      this.scene.remove(this.clouds);
      for (const m of this.cloudMats || []) m.dispose();
      if (this.deck) { this.deck.geometry.dispose(); this.deck.material.dispose(); }
    }
    const Wt = WEATHER[this.env.weather] || WEATHER.scattered;
    this.cloudMats = this.cloudTex.map((map) => new THREE.SpriteMaterial({ map, transparent: true, depthWrite: false, fog: true, color: 0xffffff }));
    this.clouds = new THREE.Group();
    let seed = 1 + Object.keys(MAPS).indexOf(MAP_KEY) * 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const [a0, a1] = Wt.alt;
    for (let c = 0; c < Wt.clouds; c++) {
      const a = rnd() * Math.PI * 2, d = 1500 + Math.sqrt(rnd()) * 27000;
      const cx = Math.cos(a) * d, cz = Math.sin(a) * d;
      const cy = Math.max(a0 + rnd() * (a1 - a0), groundHeight(cx, cz) + 700);
      const big = 0.7 + rnd() * 0.8;
      const puffs = 5 + Math.floor(rnd() * 8 * big);
      for (let p = 0; p < puffs; p++) {
        const s = new THREE.Sprite(this.cloudMats[Math.floor(rnd() * 4)]);
        const size = (450 + rnd() * 750) * big;
        s.scale.set(size * 1.7, size, 1);
        s.position.set(cx + (rnd() - 0.5) * 1600 * big, cy + (rnd() - 0.3) * 280 * big, cz + (rnd() - 0.5) * 1600 * big);
        this.clouds.add(s);
      }
    }
    this.deck = null;
    if (Wt.deck) {
      // solid overcast layer: dims the light below it, sunny above it
      const geo = new THREE.PlaneGeometry(220000, 220000);
      geo.rotateX(-Math.PI / 2);
      const mat = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true,
        uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { tMacro: { value: null }, uTop: { value: new THREE.Color() }, uBot: { value: new THREE.Color() } }]),
        vertexShader: `varying vec3 vW;\n#include <fog_pars_vertex>\nvoid main(){ vec4 wp = modelMatrix*vec4(position,1.0); vW = wp.xyz; vec4 mvPosition = viewMatrix*wp; gl_Position = projectionMatrix*mvPosition;\n#include <fog_vertex>\n}`,
        fragmentShader: `uniform sampler2D tMacro; uniform vec3 uTop, uBot; varying vec3 vW;\n#include <fog_pars_fragment>\nvoid main(){ float n = texture2D(tMacro, vW.xz/9000.0).r*0.6 + texture2D(tMacro, vW.xz/2300.0).g*0.4; bool below = cameraPosition.y < vW.y; vec3 c = below ? uBot*(0.85+n*0.3) : uTop*(0.9+n*0.15); gl_FragColor = vec4(c, smoothstep(0.18, 0.4, n)*0.97 + 0.03);\n#include <fog_fragment>\n#include <colorspace_fragment>\n}`,
      });
      mat.uniforms.tMacro.value = this.tex.macro;
      this.deck = new THREE.Mesh(geo, mat);
      this.deck.position.y = Wt.deck;
      this.deck.renderOrder = 1;
      this.clouds.add(this.deck);
    }
    this.scene.add(this.clouds);
    this.applyCloudTint();
  }
  applyCloudTint() {
    if (!this.cloudMats) return;
    const T = TIMES[this.env.time] || TIMES.day;
    const tint = new THREE.Color(0xffffff).lerp(new THREE.Color(T.sun), 0.35).multiplyScalar(T.moon ? 0.32 : Math.min(1, 0.55 + T.el / 50));
    for (const m of this.cloudMats) m.color.copy(tint);
    if (this.deck) {
      this.deck.material.uniforms.uTop.value.copy(tint).multiplyScalar(1.05);
      this.deck.material.uniforms.uBot.value.copy(tint).multiplyScalar(0.62);
    }
  }

  // ---------------- time of day + weather ----------------
  setEnv(time, weather) {
    const changedWeather = weather !== this.env.weather;
    this.env = { time: TIMES[time] ? time : 'day', weather: WEATHER[weather] ? weather : 'scattered' };
    const T = TIMES[this.env.time], Wt = WEATHER[this.env.weather];
    const el = (T.el * Math.PI) / 180, az = (T.az * Math.PI) / 180;
    SUN_DIR.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
    this.sun.position.copy(SUN_DIR).multiplyScalar(1000);
    const grey = new THREE.Color(T.moon ? 0x1c2230 : 0x9aa2ac);
    const horizon = new THREE.Color(T.horizon).lerp(grey, Wt.grey * 0.8);
    const zenith = new THREE.Color(T.zenith).lerp(grey, Wt.grey * 0.6);
    FOG_COLOR.copy(horizon);
    this.scene.fog.color.copy(horizon);
    this.scene.background.copy(horizon);
    this.baseFog = Wt.fog * (T.moon ? 1.15 : 1);
    this.scene.fog.density = this.baseFog;
    this.skyMat.uniforms.horizon.value.copy(horizon);
    this.skyMat.uniforms.zenith.value.copy(zenith);
    this.skyMat.uniforms.sunCol.value.set(T.sun);
    this.skyMat.uniforms.stars.value = T.stars * (1 - Wt.grey);
    this.skyMat.uniforms.moon.value = T.moon ? 1 : 0;
    this.sunCol = new THREE.Color(T.sun);
    this.sunI = T.sunI; this.hemiI = T.hemiI;
    this.sun.color.copy(this.sunCol);
    this.hemi.color.set(T.sky); this.hemi.groundColor.set(T.gnd);
    this.sunMul = Wt.sunMul || 1;
    const U = this.waterU;
    U.uSunCol.value.copy(this.sunCol); U.uZenith.value.copy(zenith); U.uHorizon.value.copy(horizon);
    U.uChop.value = Wt.chop; U.uLight.value = T.moon ? 0.35 : Math.min(1, 0.45 + T.el / 40);
    visRangeM = Math.min(Wt.vis, T.moon ? 4000 : T.el < 10 ? 7000 : 99999);
    if (changedWeather) this.buildClouds(); else this.applyCloudTint();
    this.lightK = T.moon ? 0.35 : Math.min(1, 0.5 + T.el / 30);
  }

  update(camera, dt = 0.016) {
    this.time += dt;
    this.sky.position.copy(camera.position);
    this.waterU.uTime.value = this.time;
    // under an overcast deck the sun is hidden; inside it you are flying in cloud
    let sunK = 1, fogK = 1;
    if (this.deck) {
      const dy = camera.position.y - this.deck.position.y;
      sunK = dy > 0 ? 1 : this.sunMul;
      if (Math.abs(dy) < 160) fogK = 1 + 60 * (1 - Math.abs(dy) / 160);
    } else sunK = this.sunMul;
    this.sun.intensity = this.sunI * sunK;
    this.hemi.intensity = this.hemiI * (0.75 + 0.25 * sunK);
    this.scene.fog.density = this.baseFog * fogK;
  }
}
