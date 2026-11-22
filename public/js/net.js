// WebSocket client + remote aircraft proxy with latency-compensated extrapolation.
import * as THREE from 'three';

export class Net {
  constructor() {
    this.ws = null;
    this.handlers = new Map();
    this.rtt = 120;
    this.connected = false;
    this.pingTimer = null;
  }

  connect(name) {
    return new Promise((resolve, reject) => {
      if (this.ws && this.connected) { resolve(); return; }
      const url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
      let ws;
      try { ws = new WebSocket(url); } catch (e) { reject(e); return; }
      this.ws = ws;
      const timeout = setTimeout(() => { reject(new Error('Connection timed out')); try { ws.close(); } catch {} }, 6000);
      ws.onopen = () => {
        clearTimeout(timeout);
        this.connected = true;
        this.send({ t: 'hello', name });
        this.pingTimer = setInterval(() => this.send({ t: 'ping', c: performance.now() }), 1000);
        resolve();
      };
      ws.onerror = () => { clearTimeout(timeout); if (!this.connected) reject(new Error('Could not reach the game server')); };
      ws.onclose = () => {
        this.connected = false;
        clearInterval(this.pingTimer);
        this.emit('disconnected', {});
      };
      ws.onmessage = (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch { return; }
        if (msg.t === 'pong') {
          const r = performance.now() - msg.c;
          this.rtt = this.rtt * 0.8 + r * 0.2;
          return;
        }
        this.emit(msg.t, msg);
      };
    });
  }

  get oneWay() { return this.rtt / 2; }
  on(type, fn) { this.handlers.set(type, fn); }
  emit(type, msg) { const h = this.handlers.get(type); if (h) h(msg); }
  send(obj) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj)); }
}

const r2 = (x) => Math.round(x * 100) / 100;
const r4 = (x) => Math.round(x * 10000) / 10000;

export function packState(plane, extra) {
  const p = plane.pos, v = plane.vel, a = plane.acc, q = plane.quat, w = plane.omega;
  return Object.assign({
    t: 's',
    p: [r2(p.x), r2(p.y), r2(p.z)],
    v: [r2(v.x), r2(v.y), r2(v.z)],
    a: [r2(a.x), r2(a.y), r2(a.z)],
    q: [r4(q.x), r4(q.y), r4(q.z), r4(q.w)],
    w: [r4(w.x), r4(w.y), r4(w.z)],
    th: r2(plane.eng), hp: Math.round(plane.hp), al: plane.alive ? 1 : 0,
    f: plane.firing ? 1 : 0, ms: plane.missiles, ab: plane.airbrake ? 1 : 0,
  }, extra);
}

const _dq = new THREE.Quaternion(), _ax = new THREE.Vector3(), _pp = new THREE.Vector3(), _pq = new THREE.Quaternion();

export class RemotePlane {
  constructor(name) {
    this.name = name;
    this.isRemote = true;
    this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3(); this.acc = new THREE.Vector3();
    this.quat = new THREE.Quaternion(); this.omega = new THREE.Vector3();
    this.prevPos = new THREE.Vector3();
    this.fwd = new THREE.Vector3(0, 0, -1); this.up = new THREE.Vector3(0, 1, 0); this.right = new THREE.Vector3(1, 0, 0);
    this.offset = new THREE.Vector3();
    this.snap = null;
    this.hp = 100; this.alive = true; this.eng = 1; this.throttle = 1; this.firing = false; this.missiles = 4; this.airbrake = false;
    this.speed = 0; this.p = 0;
  }
  get ab() { return this.eng > 1.001; }

  hardReset() { this.snap = null; this.offset.set(0, 0, 0); }

  predict(now, outPos, outQuat) {
    const s = this.snap;
    const t = Math.min(0.6, Math.max(0, (now - s.time) / 1000));
    outPos.copy(s.p).addScaledVector(s.v, t).addScaledVector(s.a, 0.5 * t * t);
    const ang = s.w.length() * t;
    outQuat.copy(s.q);
    if (ang > 1e-6) { _dq.setFromAxisAngle(_ax.copy(s.w).normalize(), ang); outQuat.premultiply(_dq); }
    return t;
  }

  applyState(m, now, oneWay) {
    const had = !!this.snap;
    const snap = {
      p: new THREE.Vector3(...m.p), v: new THREE.Vector3(...m.v), a: new THREE.Vector3(...m.a),
      q: new THREE.Quaternion(...m.q), w: new THREE.Vector3(...m.w), time: now - oneWay,
    };
    // keep what is currently displayed, blend the correction away smoothly
    const shown = this.pos.clone();
    this.snap = snap;
    this.predict(now, _pp, _pq);
    if (had) {
      this.offset.copy(shown).sub(_pp);
      if (this.offset.length() > 250) this.offset.set(0, 0, 0);
    } else { this.offset.set(0, 0, 0); this.pos.copy(_pp); this.prevPos.copy(_pp); this.quat.copy(_pq); }
    this.hp = m.hp; this.eng = m.th; this.throttle = m.th; this.firing = !!m.f; this.missiles = m.ms; this.airbrake = !!m.ab;
    if (m.al && !this.alive) this.alive = true;
  }

  update(now, dt) {
    this.prevPos.copy(this.pos);
    if (!this.snap) return;
    const t = this.predict(now, _pp, _pq);
    this.offset.multiplyScalar(Math.exp(-dt * 5));
    this.pos.copy(_pp).add(this.offset);
    this.vel.copy(this.snap.v).addScaledVector(this.snap.a, t);
    this.speed = this.vel.length();
    this.quat.slerp(_pq, Math.min(1, dt * 14));
    this.fwd.set(0, 0, -1).applyQuaternion(this.quat);
    this.up.set(0, 1, 0).applyQuaternion(this.quat);
    this.right.set(1, 0, 0).applyQuaternion(this.quat);
  }
}
