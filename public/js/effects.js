// CPU particle systems for smoke, fire, flares, sparks and explosions.
import * as THREE from 'three';

const VERT = `
attribute float size;
attribute vec4 pcolor;
varying vec4 vColor;
uniform float scale;
void main(){
  vColor = pcolor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = clamp(size * scale / max(-mv.z, 0.1), 0.0, 900.0);
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = `
varying vec4 vColor;
uniform float soft;
void main(){
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c) * 2.0;
  if (d > 1.0) discard;
  float a = pow(1.0 - d, soft);
  gl_FragColor = vec4(vColor.rgb, vColor.a * a);
}`;

class ParticleSystem {
  constructor(scene, max, additive) {
    this.max = max; this.count = 0;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.size = new Float32Array(max);
    this.c0 = new Float32Array(max * 3); this.c1 = new Float32Array(max * 3);
    this.a0 = new Float32Array(max); this.life = new Float32Array(max); this.age = new Float32Array(max);
    this.s0 = new Float32Array(max); this.s1 = new Float32Array(max);
    this.drag = new Float32Array(max); this.grav = new Float32Array(max);
    this.geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage);
    this.sizeAttr = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', this.posAttr);
    this.geo.setAttribute('pcolor', this.colAttr);
    this.geo.setAttribute('size', this.sizeAttr);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { scale: { value: 800 }, soft: { value: additive ? 1.6 : 0.9 } },
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 3 : 2;
    scene.add(this.points);
  }

  emit(px, py, pz, vx, vy, vz, life, s0, s1, c0, c1, a0, drag = 0, grav = 0) {
    let i;
    if (this.count < this.max) i = this.count++;
    else i = Math.floor(Math.random() * this.max);
    const i3 = i * 3;
    this.pos[i3] = px; this.pos[i3 + 1] = py; this.pos[i3 + 2] = pz;
    this.vel[i3] = vx; this.vel[i3 + 1] = vy; this.vel[i3 + 2] = vz;
    this.c0[i3] = c0[0]; this.c0[i3 + 1] = c0[1]; this.c0[i3 + 2] = c0[2];
    this.c1[i3] = c1[0]; this.c1[i3 + 1] = c1[1]; this.c1[i3 + 2] = c1[2];
    this.a0[i] = a0; this.life[i] = life; this.age[i] = 0;
    this.s0[i] = s0; this.s1[i] = s1; this.drag[i] = drag; this.grav[i] = grav;
  }

  update(dt) {
    let n = this.count;
    for (let i = 0; i < n; i++) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) {
        n--;
        if (i !== n) this.copy(n, i);
        i--;
        continue;
      }
      const i3 = i * 3, i4 = i * 4;
      const k = Math.exp(-this.drag[i] * dt);
      this.vel[i3] *= k; this.vel[i3 + 1] = this.vel[i3 + 1] * k + this.grav[i] * dt; this.vel[i3 + 2] *= k;
      this.pos[i3] += this.vel[i3] * dt; this.pos[i3 + 1] += this.vel[i3 + 1] * dt; this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      const t = this.age[i] / this.life[i];
      this.col[i4] = this.c0[i3] + (this.c1[i3] - this.c0[i3]) * t;
      this.col[i4 + 1] = this.c0[i3 + 1] + (this.c1[i3 + 1] - this.c0[i3 + 1]) * t;
      this.col[i4 + 2] = this.c0[i3 + 2] + (this.c1[i3 + 2] - this.c0[i3 + 2]) * t;
      const fadeIn = Math.min(1, t * 12);
      this.col[i4 + 3] = this.a0[i] * (1 - t) * (1 - t * 0.3) * fadeIn;
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * Math.sqrt(t);
    }
    this.count = n;
    this.geo.setDrawRange(0, n);
    this.posAttr.needsUpdate = true; this.colAttr.needsUpdate = true; this.sizeAttr.needsUpdate = true;
  }

  copy(from, to) {
    const f3 = from * 3, t3 = to * 3;
    for (let k = 0; k < 3; k++) {
      this.pos[t3 + k] = this.pos[f3 + k]; this.vel[t3 + k] = this.vel[f3 + k];
      this.c0[t3 + k] = this.c0[f3 + k]; this.c1[t3 + k] = this.c1[f3 + k];
    }
    for (let k = 0; k < 4; k++) this.col[to * 4 + k] = this.col[from * 4 + k];
    this.size[to] = this.size[from]; this.a0[to] = this.a0[from]; this.life[to] = this.life[from];
    this.age[to] = this.age[from]; this.s0[to] = this.s0[from]; this.s1[to] = this.s1[from];
    this.drag[to] = this.drag[from]; this.grav[to] = this.grav[from];
  }

  clear() { this.count = 0; this.geo.setDrawRange(0, 0); }
}

const WHITE = [0.95, 0.95, 0.95], GREY = [0.55, 0.55, 0.57], DARK = [0.12, 0.12, 0.12], DARK2 = [0.25, 0.24, 0.23];
const FIRE0 = [1.0, 0.85, 0.5], FIRE1 = [0.9, 0.25, 0.05], FLARE0 = [1, 1, 0.9], FLARE1 = [1, 0.6, 0.2];
const R = () => Math.random() - 0.5;

export class Effects {
  constructor(scene) {
    this.smoke = new ParticleSystem(scene, 9000, false);
    this.fire = new ParticleSystem(scene, 5000, true);
    // flash sprites for explosions
    this.flashes = [];
    this.scene = scene;
  }

  setViewport(heightPx, fovDeg) {
    const s = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
    this.smoke.mat.uniforms.scale.value = s;
    this.fire.mat.uniforms.scale.value = s;
  }

  missileTrail(p, v, burning) {
    if (burning) {
      this.fire.emit(p.x, p.y, p.z, v.x * 0.2, v.y * 0.2, v.z * 0.2, 0.08, 1.6, 0.6, FIRE0, FIRE1, 0.9);
      this.smoke.emit(p.x + R(), p.y + R(), p.z + R(), R() * 2, R() * 2, R() * 2, 3.5 + Math.random(), 1.5, 9, WHITE, GREY, 0.55, 0.3, 0.6);
    } else {
      this.smoke.emit(p.x, p.y, p.z, 0, 0, 0, 1.2, 0.8, 3, WHITE, GREY, 0.18, 0.3, 0.3);
    }
  }

  flare(p) {
    this.fire.emit(p.x, p.y, p.z, 0, 0, 0, 0.07, 9, 6, FLARE0, FLARE1, 1.0);
    this.smoke.emit(p.x + R(), p.y + R(), p.z + R(), R(), R(), R(), 2.5, 1.2, 6, WHITE, GREY, 0.35, 0.4, 0.8);
  }

  muzzle(p, v) {
    this.fire.emit(p.x, p.y, p.z, v.x, v.y, v.z, 0.04, 1.8, 0.8, FIRE0, FIRE1, 0.9);
  }

  spark(p, v) {
    for (let i = 0; i < 6; i++) {
      this.fire.emit(p.x, p.y, p.z, v.x + R() * 60, v.y + R() * 60, v.z + R() * 60, 0.25 + Math.random() * 0.2, 0.9, 0.3, FIRE0, FIRE1, 1, 1.5);
    }
    this.smoke.emit(p.x, p.y, p.z, v.x * 0.5, v.y * 0.5, v.z * 0.5, 1.2, 1.5, 6, DARK2, GREY, 0.5, 1.2, 0.5);
  }

  damageSmoke(p, v, hp) {
    const dark = hp < 25;
    this.smoke.emit(p.x + R(), p.y + R(), p.z + R(), v.x * 0.1 + R() * 3, v.y * 0.1 + R() * 3, v.z * 0.1 + R() * 3, 3 + Math.random() * 2, 1.5, 10, dark ? DARK : DARK2, GREY, dark ? 0.6 : 0.35, 0.5, 1);
    if (dark) this.fire.emit(p.x, p.y, p.z, v.x * 0.15, v.y * 0.15, v.z * 0.15, 0.25, 2.4, 1, FIRE0, FIRE1, 0.9);
  }

  vapor(p, v, a) {
    this.smoke.emit(p.x, p.y, p.z, v.x * 0.85, v.y * 0.85, v.z * 0.85, 0.35, 0.4, 1.6, WHITE, WHITE, a, 0.5, 0);
  }

  explosion(p, v, big = false) {
    const n = big ? 90 : 45, sp = big ? 70 : 45;
    for (let i = 0; i < n; i++) {
      this.fire.emit(p.x, p.y, p.z, v.x * 0.3 + R() * sp, v.y * 0.3 + R() * sp, v.z * 0.3 + R() * sp,
        0.5 + Math.random() * 0.8, big ? 8 : 5, big ? 22 : 12, FIRE0, FIRE1, 1, 2.0, 2);
    }
    for (let i = 0; i < n * 0.7; i++) {
      this.smoke.emit(p.x + R() * 6, p.y + R() * 6, p.z + R() * 6, v.x * 0.2 + R() * sp * 0.5, v.y * 0.2 + R() * sp * 0.5, v.z * 0.2 + R() * sp * 0.5,
        3 + Math.random() * 4, big ? 10 : 6, big ? 40 : 22, DARK, GREY, 0.65, 0.9, 1.5);
    }
    if (big) {
      for (let i = 0; i < 25; i++) {
        // burning debris
        this.fire.emit(p.x, p.y, p.z, v.x * 0.5 + R() * 160, v.y * 0.5 + R() * 160 + 30, v.z * 0.5 + R() * 160, 1.5 + Math.random(), 2.5, 1, FIRE0, FIRE1, 1, 0.6, -9.8);
      }
    }
  }

  update(dt) {
    this.smoke.update(dt);
    this.fire.update(dt);
  }

  clear() { this.smoke.clear(); this.fire.clear(); }
}
