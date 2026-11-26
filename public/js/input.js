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
  chaff: ['KeyZ'],
  selSrm: ['Digit1'],
  selMrm: ['Digit2'],
  selAg: ['Digit3'],
  trimUp: ['BracketRight'],
  trimDown: ['BracketLeft'],
  trimReset: ['Backslash'],
  flaps: ['KeyK'],
  gear: ['KeyJ'],
  radio: ['KeyM'],
  freeCam: ['KeyP'],
  radarLock: ['Tab', 'KeyL'],
  airbrake: ['KeyB'],
  precision: ['ShiftLeft', 'ShiftRight'],
  camera: ['KeyV'],
  padlock: ['KeyT'],
  lookBack: ['KeyG'],
  lookWing: ['KeyU'],
  lookLeft: ['Comma', 'Numpad4'],
  lookRight: ['Period', 'Numpad6'],
  lookUp: ['Slash', 'Numpad8'],
  cycle: ['KeyN'],
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
    this.trim = 0; this.flaps = 0; this.gear = false; this.brake = false;
    this.enabled = true;
    this.mouse = { dx: 0, dy: 0, down: false, wheel: 0 };
    window.addEventListener('mousemove', (e) => { if (this.mouse.down) { this.mouse.dx += e.movementX; this.mouse.dy += e.movementY; } });
    window.addEventListener('mousedown', (e) => { if (e.target && e.target.id === 'hud') this.mouse.down = true; });
    window.addEventListener('mouseup', () => { this.mouse.down = false; });
    window.addEventListener('wheel', (e) => { if (e.target && e.target.id === 'hud') this.mouse.wheel += Math.sign(e.deltaY); }, { passive: true });
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
  // a digit key tapped this frame (1-9), or 0 when none
  digit() { for (let i = 1; i <= 9; i++) if (this.pressed.has('Digit' + i) || this.pressed.has('Numpad' + i)) return i; return 0; }
  endFrame() { this.pressed.clear(); this.mouse.dx = this.mouse.dy = 0; this.mouse.wheel = 0; }

  // Returns flight control input for this frame.
  flight(dt) {
    if (!this.enabled) {
      return { pitch: this.pitch.update(0, dt), roll: this.roll.update(0, dt), yaw: this.yaw.update(0, dt), throttle: this.throttle, airbrake: false, precision: false, trim: this.trim, flaps: this.flaps, gear: this.gear };
    }
    // trim biases the stick (the FBW holds that G with hands off); flaps cycle up / half / full
    if (this.held('trimUp')) this.trim = Math.min(0.35, this.trim + dt * 0.12);
    if (this.held('trimDown')) this.trim = Math.max(-0.35, this.trim - dt * 0.12);
    if (this.tapped('trimReset')) this.trim = 0;
    if (this.tapped('flaps')) this.flaps = this.flaps === 0 ? 0.5 : this.flaps === 0.5 ? 1 : 0;
    if (this.tapped('gear')) this.gear = !this.gear;
    if (this.tapped('airbrake')) this.brake = !this.brake;
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
      airbrake: this.brake,
      precision,
      trim: this.trim,
      flaps: this.flaps, gear: this.gear,
    };
  }

  reset() { this.pitch.v = this.roll.v = this.yaw.v = 0; this.throttle = 1.0; this.trim = 0; this.flaps = 0; this.gear = false; this.brake = false; }
}
