// Keyboard input. Digital keys are turned into smooth analog axes so taps give
// small corrections and holding gives full deflection. Shift = precision mode.
const BINDS = {
  noseDown: ['KeyW', 'ArrowUp'],
  noseUp: ['KeyS', 'ArrowDown'],
  rollLeft: ['KeyA', 'ArrowLeft'],
  rollRight: ['KeyD', 'ArrowRight'],
  yawLeft: ['KeyQ'],
  yawRight: ['KeyE'],
  throttleUp: ['KeyR'],
  throttleDown: ['KeyF'],
  gun: ['Space'],
  missile: ['KeyX'],
  flare: ['KeyC'],
  airbrake: ['KeyB'],
  precision: ['ShiftLeft', 'ShiftRight'],
  camera: ['KeyV'],
  padlock: ['KeyT'],
  lookBack: ['KeyG'],
  pause: ['Escape'],
  help: ['KeyH'],
};

class Axis {
  constructor(rise, fall) { this.v = 0; this.rise = rise; this.fall = fall; }
  update(target, dt) {
    const same = target !== 0 && (this.v === 0 || Math.sign(target) === Math.sign(this.v));
    const rate = same && Math.abs(target) > Math.abs(this.v) ? this.rise : this.fall;
    const d = target - this.v;
    const step = rate * dt;
    this.v = Math.abs(d) <= step ? target : this.v + Math.sign(d) * step;
    return this.v;
  }
}

export class Input {
  constructor() {
    this.down = new Set();
    this.pressed = new Set();
    this.invertPitch = false; // false: W = nose down (flight stick style)
    this.pitch = new Axis(3.2, 7);
    this.roll = new Axis(5, 9);
    this.yaw = new Axis(3, 6);
    this.throttle = 1.0;
    this.enabled = true;
    window.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
      if (!this.down.has(e.code)) this.pressed.add(e.code);
      this.down.add(e.code);
    });
    window.addEventListener('keyup', (e) => { this.down.delete(e.code); });
    window.addEventListener('blur', () => { this.down.clear(); });
  }

  held(action) { return BINDS[action].some((k) => this.down.has(k)); }
  tapped(action) { return BINDS[action].some((k) => this.pressed.has(k)); }
  endFrame() { this.pressed.clear(); }

  // Returns flight control input for this frame.
  flight(dt) {
    if (!this.enabled) {
      return { pitch: this.pitch.update(0, dt), roll: this.roll.update(0, dt), yaw: this.yaw.update(0, dt), throttle: this.throttle, airbrake: false, precision: false };
    }
    let p = (this.held('noseUp') ? 1 : 0) - (this.held('noseDown') ? 1 : 0);
    if (this.invertPitch) p = -p;
    const r = (this.held('rollRight') ? 1 : 0) - (this.held('rollLeft') ? 1 : 0);
    const y = (this.held('yawRight') ? 1 : 0) - (this.held('yawLeft') ? 1 : 0);
    const precision = this.held('precision');
    const ps = precision ? 0.3 : 1, rs = precision ? 0.3 : 1, ys = precision ? 0.6 : 1;
    if (this.held('throttleUp')) this.throttle = Math.min(1.2, this.throttle + dt * 0.55);
    if (this.held('throttleDown')) this.throttle = Math.max(0, this.throttle - dt * 0.55);
    return {
      pitch: this.pitch.update(p * ps, dt),
      roll: this.roll.update(r * rs, dt),
      yaw: this.yaw.update(y * ys, dt),
      throttle: this.throttle,
      airbrake: this.held('airbrake'),
      precision,
    };
  }

  reset() { this.pitch.v = this.roll.v = this.yaw.v = 0; this.throttle = 1.0; }
}
