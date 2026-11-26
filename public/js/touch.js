// Touch controls for phones and tablets. The left half of the screen is a floating joystick
// (pitch and roll): put your thumb down anywhere there and drag. The right side has the weapon
// buttons and a throttle lever; dragging on empty screen on the right looks around (free look).
// Buttons press the same virtual keys as the keyboard, so every feature works the same way.
const STICK_R = 62;          // joystick travel in CSS pixels

export function isTouchDevice() {
  return (window.matchMedia && matchMedia('(pointer: coarse)').matches) || 'ontouchstart' in window || navigator.maxTouchPoints > 1;
}

const BTN = [
  // id, label, key code, hold (true = held while pressed), class
  ['fire', 'FIRE', 'KeyX', true, 'big red'],
  ['gun', 'GUN', 'Space', true, 'big'],
  ['wpn', 'WPN', 'TouchWpn', false, ''],
  ['lock', 'LOCK', 'Tab', false, ''],
  ['tgt', 'TGT', 'KeyN', false, ''],
  ['flr', 'FLR', 'KeyC', true, 'amber'],
  ['chf', 'CHF', 'KeyZ', true, 'amber'],
];
const TOP = [
  ['pause', '❚❚', 'Escape'], ['view', 'VIEW', 'KeyV'], ['map', 'MAP', 'KeyO'], ['radio', 'RADIO', 'KeyM'],
  ['gear', 'GEAR', 'KeyJ'], ['flaps', 'FLAP', 'KeyK'], ['brk', 'BRK', 'KeyB'], ['back', 'SIX', 'KeyG', true],
];

export class TouchControls {
  constructor(input) {
    this.input = input;
    this.on = false;
    this.stickId = null; this.lookId = null; this.thrId = null;
    this.stick0 = { x: 0, y: 0 };
    this.last = {};
    const root = this.root = document.createElement('div');
    root.id = 'touch';
    root.innerHTML = `
      <div class="tstick"><div class="tbase"></div><div class="tknob"></div></div>
      <div class="ttop">${TOP.map(([id, l]) => `<button data-b="${id}" data-l="${l}"><b>${l}</b></button>`).join('')}</div>
      <div class="tbtns">${BTN.map(([id, l, , , cls]) => `<button data-b="${id}" class="tb-${id} ${cls}"><b>${l}</b><i></i></button>`).join('')}</div>
      <div class="tthr"><div class="tfill"></div><div class="tab"></div><span>THR</span></div>
      <div class="tradio"></div>
      <div class="tdead"><button data-b="next">NEXT JET</button><button data-b="free">FREE CAM</button></div>
      <div class="trotate">Turn your device sideways to fly</div>`;
    document.body.appendChild(root);
    this.el = (s) => root.querySelector(s);
    this.stickEl = this.el('.tstick'); this.knob = this.el('.tknob');
    this.thr = this.el('.tthr'); this.fill = this.el('.tfill');
    this.radioEl = this.el('.tradio');
    this.keys = {};
    for (const [id, , code, hold] of BTN) this.keys[id] = { code, hold };
    for (const [id, , code, hold] of TOP) this.keys[id] = { code, hold: !!hold };
    this.keys.next = { code: 'KeyN' }; this.keys.free = { code: 'KeyP' };

    const opt = { passive: false };
    root.addEventListener('touchstart', (e) => this.start(e), opt);
    root.addEventListener('touchmove', (e) => this.move(e), opt);
    root.addEventListener('touchend', (e) => this.end(e), opt);
    root.addEventListener('touchcancel', (e) => this.end(e), opt);
    // the first touch anywhere switches the touch layout on (and keyboard use switches it off)
    window.addEventListener('touchstart', () => this.enable(true), { passive: true });
    window.addEventListener('keydown', (e) => { if (!e.code.startsWith('Touch') && this.on && e.isTrusted && !this.anyTouch) this.enable(false); });
    if (isTouchDevice()) this.enable(true);
  }

  enable(v) {
    if (this.on === v) return;
    this.on = v;
    document.body.classList.toggle('touch', v);
    if (!v) this.releaseAll();
  }

  releaseAll() {
    const I = this.input;
    for (const k of Object.values(this.keys)) I.release(k.code);
    I.stick.active = false; I.mouse.down = false;
    this.stickId = this.lookId = this.thrId = null;
    this.stickEl.classList.remove('live');
    this.root.querySelectorAll('button.dn').forEach((b) => b.classList.remove('dn'));
  }

  start(e) {
    e.preventDefault();
    this.anyTouch = true;
    this.tryFullscreen();
    for (const t of e.changedTouches) {
      const b = t.target.closest && t.target.closest('button[data-b]');
      if (b) { this.press(b, t.identifier); continue; }
      if (t.target.closest && t.target.closest('.tthr')) { this.thrId = t.identifier; this.setThrottle(t); continue; }
      if (t.clientX < window.innerWidth * 0.45 && this.stickId === null) {
        this.stickId = t.identifier;
        this.stick0 = { x: t.clientX, y: t.clientY };
        this.stickEl.style.left = t.clientX + 'px'; this.stickEl.style.top = t.clientY + 'px';
        this.stickEl.classList.add('live');
        this.setStick(t);
      } else if (this.lookId === null) {
        this.lookId = t.identifier; this.lookXY = { x: t.clientX, y: t.clientY };
        this.input.mouse.down = true;
      }
    }
  }

  move(e) {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier === this.stickId) this.setStick(t);
      else if (t.identifier === this.thrId) this.setThrottle(t);
      else if (t.identifier === this.lookId) {
        const m = this.input.mouse;
        m.dx += (t.clientX - this.lookXY.x) * 1.4; m.dy += (t.clientY - this.lookXY.y) * 1.4;
        this.lookXY = { x: t.clientX, y: t.clientY };
      }
    }
  }

  end(e) {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier === this.stickId) {
        this.stickId = null; this.input.stick.active = false; this.input.stick.x = this.input.stick.y = 0;
        this.stickEl.classList.remove('live'); this.knob.style.transform = '';
      } else if (t.identifier === this.thrId) this.thrId = null;
      else if (t.identifier === this.lookId) { this.lookId = null; this.input.mouse.down = false; }
      else {
        const b = this.root.querySelector(`button[data-t="${t.identifier}"]`);
        if (b) this.unpress(b);
      }
    }
    if (!e.touches.length) this.anyTouch = false;
  }

  press(b, id) {
    const k = this.keys[b.dataset.b];
    if (!k) return;
    b.dataset.t = id; b.classList.add('dn');
    if (b.dataset.digit) { this.input.press('Digit' + b.dataset.digit); this.input.release('Digit' + b.dataset.digit); return; }
    this.input.press(k.code);
    if (!k.hold) this.input.release(k.code);
    if (navigator.vibrate) try { navigator.vibrate(8); } catch {}
  }
  unpress(b) {
    const k = this.keys[b.dataset.b];
    delete b.dataset.t; b.classList.remove('dn');
    if (k && k.hold) this.input.release(k.code);
  }

  setStick(t) {
    let dx = t.clientX - this.stick0.x, dy = t.clientY - this.stick0.y;
    const d = Math.hypot(dx, dy);
    if (d > STICK_R) {
      // drag the base along so the thumb never runs off the end of the stick
      const over = d - STICK_R;
      this.stick0.x += (dx / d) * over; this.stick0.y += (dy / d) * over;
      dx = t.clientX - this.stick0.x; dy = t.clientY - this.stick0.y;
      this.stickEl.style.left = this.stick0.x + 'px'; this.stickEl.style.top = this.stick0.y + 'px';
    }
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
    const S = this.input.stick;
    S.active = true; S.x = dx / STICK_R; S.y = dy / STICK_R;
  }

  setThrottle(t) {
    const r = this.thr.getBoundingClientRect();
    const f = 1 - Math.min(1, Math.max(0, (t.clientY - r.top) / r.height));
    // bottom 0 %, 5/6 of the way up = 100 % military power, the top sixth is afterburner
    this.input.throttle = Math.round(Math.min(1.2, f * 1.2) * 100) / 100;
  }

  tryFullscreen() {
    if (this.fsTried) return;
    this.fsTried = true;
    const d = document.documentElement;
    try {
      const p = d.requestFullscreen ? d.requestFullscreen({ navigationUI: 'hide' }) : d.webkitRequestFullscreen ? d.webkitRequestFullscreen() : null;
      if (p && p.then) p.then(() => { try { screen.orientation.lock('landscape').catch(() => {}); } catch {} }).catch(() => {});
    } catch {}
  }

  // Called every frame. s: { show, alive, spectating, radio: [labels] | null, wpn, fire, gun, flr, chf, lock, tgt }
  update(s) {
    if (!this.on) return;
    const show = !!s.show;
    if (show !== this.last.show) { this.root.classList.toggle('show', show); if (!show) this.releaseAll(); this.last.show = show; }
    if (!show) return;
    this.root.classList.toggle('fc', !!s.freeCam);
    const flying = s.alive;
    if (flying !== this.last.flying) { this.root.classList.toggle('dead', !flying); if (!flying) this.releaseAll(); this.last.flying = flying; }
    // throttle lever position
    const thr = this.input.throttle;
    if (thr !== this.last.thr) {
      this.fill.style.height = `${(thr / 1.2) * 100}%`;
      this.fill.classList.toggle('ab', thr > 1.0);
      this.thr.querySelector('span').textContent = thr > 1.0 ? 'AB' : `${Math.round(thr * 100)}`;
      this.last.thr = thr;
    }
    // live labels on the buttons
    const sub = (id, txt) => { if (this.last['s' + id] !== txt) { this.el(`.tb-${id} i`).textContent = txt; this.last['s' + id] = txt; } };
    sub('fire', s.fire || ''); sub('gun', s.gun || ''); sub('wpn', s.wpn || ''); sub('flr', s.flr || ''); sub('chf', s.chf || '');
    sub('lock', s.lock || ''); sub('tgt', '');
    // gear / flaps / speedbrake state on their buttons
    const tog = (id, on, txt) => { const k = id + on + txt; if (this.last['t' + id] === k) return; this.last['t' + id] = k; const b = this.el(`.ttop [data-b="${id}"]`); b.classList.toggle('on', !!on); b.innerHTML = `<b>${b.dataset.l}</b>${txt ? `<i>${txt}</i>` : ''}`; };
    tog('gear', s.gear, s.gear ? 'DOWN' : ''); tog('flaps', s.flaps > 0, s.flaps === 1 ? 'FULL' : s.flaps > 0 ? 'HALF' : ''); tog('brk', s.brake, '');
    // radio menu: tappable list
    const rk = s.radio ? s.radio.join('|') : '';
    if (rk !== this.last.radio) {
      this.radioEl.innerHTML = s.radio ? s.radio.map((l, i) => `<button data-b="rad" data-digit="${i + 1}">${i + 1} · ${l}</button>`).join('') : '';
      this.keys.rad = { code: 'Digit1' };
      this.radioEl.classList.toggle('show', !!s.radio);
      this.last.radio = rk;
    }
  }
}
