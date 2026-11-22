// Environment: procedural terrain (deterministic so both clients match), sea, sky, clouds, lights.
import * as THREE from 'three';

const SIZE = 80000;      // terrain extent (m)
const N = 320;           // grid segments
const STEP = SIZE / N;
const HALF = SIZE / 2;
export const ARENA_RADIUS = 22000;

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
function smooth(a, b, x) { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }

function rawHeight(x, z) {
  const n = fbm(x / 9000 + 10.3, z / 9000 + 3.7);
  const r = 1 - Math.abs(fbm(x / 4500 + 7.1, z / 4500 + 1.9, 5) * 2 - 1);
  let h = (n - 0.45) * 2600 + r * r * 1300 * smooth(0.42, 0.68, n);
  // fade to deep sea at the far edges
  const d = Math.hypot(x, z);
  h -= smooth(30000, 39000, d) * 1500;
  return h;
}

// Precomputed heights so physics matches the rendered triangles exactly.
const heights = new Float32Array((N + 1) * (N + 1));
for (let i = 0; i <= N; i++) {
  for (let j = 0; j <= N; j++) {
    heights[i * (N + 1) + j] = rawHeight(-HALF + j * STEP, -HALF + i * STEP);
  }
}

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

export const SUN_DIR = new THREE.Vector3(0.45, 0.62, -0.64).normalize();
export const FOG_COLOR = new THREE.Color(0xb9cfe4);

export class World {
  constructor(scene) {
    this.scene = scene;
    scene.fog = new THREE.FogExp2(FOG_COLOR, 0.000026);
    scene.background = FOG_COLOR.clone();

    const sun = new THREE.DirectionalLight(0xfff1dc, 2.4);
    sun.position.copy(SUN_DIR).multiplyScalar(1000);
    scene.add(sun);
    scene.add(new THREE.HemisphereLight(0xc4dcff, 0x56633f, 1.1));

    this.buildSky();
    this.buildTerrain();
    this.buildSea();
    this.buildClouds();
  }

  buildSky() {
    const geo = new THREE.SphereGeometry(150000, 32, 16);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        sunDir: { value: SUN_DIR },
        horizon: { value: FOG_COLOR },
        zenith: { value: new THREE.Color(0x2f6cc0) },
      },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = modelViewMatrix*vec4(position,1.0); gl_Position = projectionMatrix*p; gl_Position.z = gl_Position.w; }`,
      fragmentShader: `uniform vec3 sunDir; uniform vec3 horizon; uniform vec3 zenith; varying vec3 vDir;
        void main(){
          float h = clamp(vDir.y, -1.0, 1.0);
          vec3 col = mix(horizon, zenith, pow(max(h,0.0), 0.55));
          col = mix(col, horizon*0.92, smoothstep(0.0,-0.2,h));
          float s = max(dot(normalize(vDir), sunDir), 0.0);
          col += vec3(1.0,0.9,0.7)*pow(s, 600.0)*3.0 + vec3(1.0,0.85,0.6)*pow(s, 12.0)*0.25;
          gl_FragColor = vec4(col,1.0);
        }`,
    });
    this.sky = new THREE.Mesh(geo, mat);
    this.sky.renderOrder = -1;
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);
  }

  buildTerrain() {
    const geo = new THREE.PlaneGeometry(SIZE, SIZE, N, N);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    const sand = new THREE.Color(0xc9b98b), grass = new THREE.Color(0x5d7a3a), forest = new THREE.Color(0x3c5a2c);
    const rock = new THREE.Color(0x7b736a), snow = new THREE.Color(0xf2f4f7), seabed = new THREE.Color(0x6f8a8a);
    for (let k = 0; k < pos.count; k++) {
      const h = heights[k];
      pos.setY(k, h);
      const x = pos.getX(k), z = pos.getZ(k);
      const n = vnoise(x / 700, z / 700) * 0.2 - 0.1;
      if (h < 0) c.copy(seabed);
      else if (h < 40) c.copy(sand);
      else if (h < 500) c.copy(grass).lerp(forest, Math.min(1, h / 500 + n));
      else if (h < 1300) c.copy(forest).lerp(rock, Math.min(1, Math.max(0, (h - 500) / 800 + n)));
      else if (h < 1750) c.copy(rock);
      else c.copy(rock).lerp(snow, Math.min(1, (h - 1750) / 200));
      c.multiplyScalar(0.9 + n);
      colors[k * 3] = c.r; colors[k * 3 + 1] = c.g; colors[k * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    this.terrain = new THREE.Mesh(geo, mat);
    this.scene.add(this.terrain);
  }

  buildSea() {
    const geo = new THREE.PlaneGeometry(400000, 400000);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshPhongMaterial({ color: 0x2a5d80, specular: 0x8899aa, shininess: 60, transparent: true, opacity: 0.92 });
    this.sea = new THREE.Mesh(geo, mat);
    this.sea.position.y = 0;
    this.scene.add(this.sea);
  }

  buildClouds() {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 128;
    const g = cv.getContext('2d');
    for (let i = 0; i < 14; i++) {
      const x = 64 + (Math.random() - 0.5) * 50, y = 64 + (Math.random() - 0.5) * 30, r = 20 + Math.random() * 26;
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, 'rgba(255,255,255,0.55)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: true, color: 0xffffff });
    this.clouds = new THREE.Group();
    let seed = 1;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let c = 0; c < 80; c++) {
      const a = rnd() * Math.PI * 2, d = 2000 + rnd() * 24000;
      const cx = Math.cos(a) * d, cz = Math.sin(a) * d, cy = 1800 + rnd() * 3200;
      const puffs = 5 + Math.floor(rnd() * 7);
      if (Math.abs(cx) < 2000 && Math.abs(cz) < 7000 && Math.abs(cy - 3000) < 900) continue; // keep the merge lane clear
      for (let p = 0; p < puffs; p++) {
        const s = new THREE.Sprite(mat);
        const size = 500 + rnd() * 700;
        s.scale.set(size * 1.6, size, 1);
        s.position.set(cx + (rnd() - 0.5) * 1400, cy + (rnd() - 0.5) * 250, cz + (rnd() - 0.5) * 1400);
        this.clouds.add(s);
      }
    }
    this.scene.add(this.clouds);
  }

  update(camera) {
    this.sky.position.copy(camera.position);
  }
}
