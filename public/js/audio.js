// All sound is synthesized with WebAudio (no asset files).
// Signal flow: sources -> (own-jet bus, cockpit muffling) -> master -> compressor -> out,
// with a shared convolution reverb send for booms, the gun and distant sounds.
import * as THREE from 'three';
import { JET, SOUND_SPEED } from './flight.js';

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const _d = new THREE.Vector3(), _r = new THREE.Vector3();

export class Audio {
  constructor() {
    this.ctx = null; this.enabled = true;
    this.listenerPos = null; this.listenerQuat = null; this.listenerVel = null;
  }

  start() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();

    // ---------- output chain ----------
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 12; comp.ratio.value = 5; comp.attack.value = 0.004; comp.release.value = 0.25;
    comp.connect(ctx.destination);
    this.master = ctx.createGain(); this.master.gain.value = 0.7; this.master.connect(comp);
    this.verb = ctx.createConvolver(); this.verb.buffer = this.impulse(2.8, 2.6);
    const verbOut = ctx.createGain(); verbOut.gain.value = 0.5;
    this.verb.connect(verbOut).connect(this.master);

    // ---------- noise sources ----------
    this.white = this.noise('white'); this.pink = this.noise('pink'); this.brown = this.noise('brown');

    // ---------- own jet bus (muffled in the cockpit) ----------
    this.ownFilter = ctx.createBiquadFilter(); this.ownFilter.type = 'lowpass'; this.ownFilter.frequency.value = 18000; this.ownFilter.Q.value = 0.5;
    this.ownBus = ctx.createGain(); this.ownBus.gain.value = 1;
    this.ownBus.connect(this.ownFilter).connect(this.master);

    // engine core rumble
    this.rumF = this.filter('lowpass', 300, 0.7);
    this.rumG = this.gain(0);
    this.loop(this.brown).connect(this.rumF).connect(this.rumG).connect(this.ownBus);
    // turbine whine: two detuned partials + a harmonic
    this.turbG = this.gain(0);
    const turbF = this.filter('bandpass', 2000, 2.5);
    turbF.connect(this.turbG).connect(this.ownBus);
    this.turb = [this.osc('sawtooth', 700), this.osc('sawtooth', 704), this.osc('sine', 1750)];
    const tg = [0.5, 0.5, 0.35];
    this.turb.forEach((o, i) => o.connect(this.gain(tg[i])).connect(turbF));
    this.turbF = turbF;
    // afterburner roar with flutter and crackle
    this.abG = this.gain(0);
    const abF = this.filter('lowpass', 900, 0.6);
    this.loop(this.pink).connect(abF).connect(this.abG).connect(this.ownBus);
    this.abCrkG = this.gain(0);
    const crk = this.gain(0.5);
    const crkF = this.filter('bandpass', 260, 1.2);
    this.loop(this.white, 0.37).connect(crkF).connect(crk).connect(this.abCrkG).connect(this.ownBus);
    const flutter = this.osc('sine', 17); const flutterD = this.gain(0.45); flutter.connect(flutterD).connect(crk.gain);
    const flutter2 = this.osc('sine', 6.3); const flutterD2 = this.gain(0.2); flutter2.connect(flutterD2).connect(crk.gain);
    // airflow
    this.windF = this.filter('bandpass', 700, 0.55);
    this.windG = this.gain(0);
    this.loop(this.pink, 0.81).connect(this.windF).connect(this.windG).connect(this.ownBus);
    // high-AoA buffet (low rumble shaken at ~11 Hz)
    this.bufG = this.gain(0);
    const bufAM = this.gain(0.5);
    this.loop(this.brown, 0.29).connect(this.filter('lowpass', 160, 1)).connect(bufAM).connect(this.bufG).connect(this.ownBus);
    const bufL = this.osc('square', 11); const bufD = this.gain(0.5); bufL.connect(bufD).connect(bufAM.gain);
    // airbrake hiss
    this.brakeG = this.gain(0);
    this.loop(this.white, 0.53).connect(this.filter('bandpass', 1500, 0.8)).connect(this.brakeG).connect(this.ownBus);

    // ---------- cannon: ~100 rounds/s rattle + low body + barrel whirr ----------
    this.gunG = this.gain(0);
    this.gunG.connect(this.master);
    const gunSend = this.gain(0.35); this.gunG.connect(gunSend).connect(this.verb);
    const gunAM = this.gain(0.55);
    this.loop(this.white, 0.11).connect(this.filter('bandpass', 1100, 0.7)).connect(gunAM).connect(this.gunG);
    const gunSaw = this.osc('sawtooth', 100); const gunDepth = this.gain(-0.5); gunSaw.connect(gunDepth).connect(gunAM.gain);
    const body = this.osc('sawtooth', 100);
    body.connect(this.filter('lowpass', 260, 1.5)).connect(this.gain(0.9)).connect(this.gunG);
    this.whirrG = this.gain(0); this.whirr = this.osc('triangle', 420);
    this.whirr.connect(this.whirrG).connect(this.master);
    this.wasFiring = false;

    // ---------- seeker: growl while searching, high steady tone when locked ----------
    this.tone = this.osc('triangle', 400);
    this.toneVib = this.osc('sine', 6); this.toneVibD = this.gain(0);
    this.toneVib.connect(this.toneVibD).connect(this.tone.frequency);
    this.toneAM = this.gain(1);
    const growl = this.osc('sawtooth', 31); this.growlD = this.gain(0); growl.connect(this.growlD).connect(this.toneAM.gain);
    this.toneG = this.gain(0);
    this.tone.connect(this.toneAM).connect(this.filter('lowpass', 2600, 0.7)).connect(this.toneG).connect(this.master);

    // ---------- warnings ----------
    this.warn = this.osc('square', 1000);
    this.warnG = this.gain(0);
    this.warn.connect(this.filter('lowpass', 2400, 0.7)).connect(this.warnG).connect(this.master);
    this.warnT = 0; this.warnIdx = -1;
    this.gpwT = 0;

    // ---------- pilot: strained breathing at high G + heartbeat near blackout ----------
    this.strainG = this.gain(0);
    const strainAM = this.gain(0.5);
    this.loop(this.pink, 1.3).connect(this.filter('bandpass', 850, 1.6)).connect(strainAM).connect(this.strainG).connect(this.master);
    const breath = this.osc('sine', 0.55); const breathD = this.gain(0.5); breath.connect(breathD).connect(strainAM.gain);
    this.hbT = 0;

    // ---------- the other jet: distance, Doppler and stereo position ----------
    this.oppPan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    this.oppG = this.gain(0);
    this.oppF = this.filter('lowpass', 2000, 0.6);
    if (this.oppPan) this.oppG.connect(this.oppPan).connect(this.master); else this.oppG.connect(this.master);
    const oppSend = this.gain(0.25); this.oppG.connect(oppSend).connect(this.verb);
    this.oppF.connect(this.oppG);
    this.oppNoise = this.loop(this.pink, 0.66); this.oppNoise.connect(this.gain(1.2)).connect(this.oppF);
    this.oppRum = this.loop(this.brown, 0.9); this.oppRum.connect(this.gain(0.9)).connect(this.oppF);
    this.oppWhine = this.osc('sawtooth', 900); this.oppWhine.connect(this.filter('bandpass', 1800, 3)).connect(this.gain(0.08)).connect(this.oppG);
    this.lastHit = 0; this.lastDmg = 0;
  }

  // ---------- building blocks ----------
  noise(kind) {
    const ctx = this.ctx, len = ctx.sampleRate * 3;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'white') d[i] = w * 0.5;
      else if (kind === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
      else { // pink (Paul Kellet)
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
      }
    }
    // crossfade the loop seam
    const fade = 2048;
    for (let i = 0; i < fade; i++) { const k = i / fade; d[i] = d[i] * k + d[len - fade + i] * (1 - k); }
    return buf;
  }
  impulse(dur, decay) {
    const ctx = this.ctx, len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        // sparse early echoes off the terrain, then a smooth diffuse tail
        const early = i < ctx.sampleRate * 0.25 && Math.random() < 0.004 ? 2.5 : 1;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * early * (i < 40 ? i / 40 : 1);
      }
    }
    return buf;
  }
  gain(v) { const g = this.ctx.createGain(); g.gain.value = v; return g; }
  filter(type, f, q = 1) { const b = this.ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; }
  osc(type, f) { const o = this.ctx.createOscillator(); o.type = type; o.frequency.value = f; o.start(); return o; }
  loop(buf, offset = 0) {
    const s = this.ctx.createBufferSource(); s.buffer = buf; s.loop = true;
    s.start(0, (offset * buf.duration) % buf.duration); return s;
  }
  set(param, v, tc = 0.05) { if (this.ctx) param.setTargetAtTime(v, this.ctx.currentTime, tc); }

  // Spatialize a one-shot: returns { gain, delay, pan, cutoff } or null when inaudible.
  place(pos, ref) {
    if (!pos || !this.listenerPos) return { gain: 1, delay: 0, pan: 0, cutoff: 16000 };
    const d = this.listenerPos.distanceTo(pos);
    const gain = Math.min(1, Math.pow(ref / Math.max(d, 1), 1.1));
    if (gain < 0.012) return null;
    return {
      gain,
      delay: Math.min(1.2, Math.max(0, d - 150) / SOUND_SPEED), // sound travel time
      pan: this.panFor(pos),
      cutoff: clamp(16000 * Math.pow(ref / Math.max(d, 1), 0.8), 350, 16000),
    };
  }
  panFor(pos) {
    if (!this.listenerQuat || !this.listenerPos) return 0;
    _d.copy(pos).sub(this.listenerPos).normalize();
    _r.set(1, 0, 0).applyQuaternion(this.listenerQuat);
    return clamp(_d.dot(_r) * 0.85, -0.85, 0.85);
  }
  // A one-shot output node with distance filtering and panning, auto-cleaned.
  out(sp, t0, life, verbAmt = 0.3) {
    const ctx = this.ctx;
    const f = this.filter('lowpass', sp.cutoff, 0.5);
    const g = this.gain(sp.gain);
    f.connect(g);
    let last = g;
    if (ctx.createStereoPanner && sp.pan) { const p = ctx.createStereoPanner(); p.pan.value = sp.pan; g.connect(p); last = p; }
    last.connect(this.master);
    if (verbAmt > 0) { const s = this.gain(verbAmt + (1 - sp.gain) * 0.6); last.connect(s).connect(this.verb); }
    setTimeout(() => { try { last.disconnect(); } catch {} }, (t0 - ctx.currentTime + life + 0.5) * 1000);
    return f;
  }
  nz(dest, t, dur, { buf = this.white, type = 'lowpass', f0 = 2000, f1 = f0, q = 0.7, g0 = 0.5, attack = 0.002, rate = 1 } = {}) {
    const ctx = this.ctx;
    const s = ctx.createBufferSource(); s.buffer = buf; s.playbackRate.value = rate;
    const f = this.filter(type, f0, q);
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(g0, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(dest);
    s.start(t, Math.random() * (buf.duration - dur - 0.1 > 0 ? buf.duration - dur - 0.1 : 0)); s.stop(t + dur + 0.05);
  }
  tn(dest, t, dur, { type = 'sine', f0 = 440, f1 = f0, g0 = 0.3, attack = 0.003 } = {}) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(10, f1), t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(g0, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest); o.start(t); o.stop(t + dur + 0.05);
  }

  // ---------- per-frame continuous sounds ----------
  update(dt, s) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const on = this.enabled && s.active;
    const live = on && s.alive;
    const eng = s.eng || 0, ab = clamp((eng - 1) / (JET.maxThrottle - 1), 0, 1);
    const sp = s.speed || 0, g = s.g || 1;

    // cockpit: canopy muffles the outside, chase view hears the exhaust
    this.set(this.ownFilter.frequency, s.cockpit ? 2200 : 16000, 0.08);
    this.set(this.ownBus.gain, s.cockpit ? 0.75 : 1, 0.08);

    this.set(this.rumG.gain, live ? 0.28 + eng * 0.4 : 0, 0.15);
    this.set(this.rumF.frequency, 160 + eng * 260 + ab * 300, 0.25);
    const tf = 520 + eng * 900;
    this.set(this.turb[0].frequency, tf, 0.35); this.set(this.turb[1].frequency, tf * 1.006, 0.35); this.set(this.turb[2].frequency, tf * 2.5, 0.35);
    this.set(this.turbF.frequency, tf * 2.2, 0.35);
    this.set(this.turbG.gain, live ? (0.012 + eng * 0.02) * (s.cockpit ? 1.6 : 1) : 0, 0.25);
    this.set(this.abG.gain, live ? ab * 0.55 : 0, 0.18);
    this.set(this.abCrkG.gain, live ? ab * 0.35 : 0, 0.18);

    this.set(this.windG.gain, live ? Math.min(0.32, sp / 1100) + Math.max(0, g - 4) * 0.012 : 0, 0.2);
    this.set(this.windF.frequency, 300 + sp * 2.6, 0.2);
    const aoa = clamp(((s.alpha || 0) / JET.aFbw - 0.6) / 0.4, 0, 1);
    this.set(this.bufG.gain, live ? aoa * clamp(sp / 120, 0.2, 1) * 0.5 : 0, 0.08);
    this.set(this.brakeG.gain, live && s.airbrake ? Math.min(0.16, sp / 1500) : 0, 0.12);

    // gun: hard attack, short tail, barrel whirr spins down after release
    const firing = live && s.firing;
    this.set(this.gunG.gain, firing ? 0.42 : 0, firing ? 0.006 : 0.03);
    if (firing) {
      this.whirr.frequency.cancelScheduledValues(t); this.whirr.frequency.setTargetAtTime(430, t, 0.05);
      this.whirrG.gain.cancelScheduledValues(t); this.whirrG.gain.setTargetAtTime(0.025, t, 0.05);
    } else if (this.wasFiring) {
      this.whirr.frequency.cancelScheduledValues(t); this.whirr.frequency.setValueAtTime(430, t); this.whirr.frequency.exponentialRampToValueAtTime(90, t + 0.7);
      this.whirrG.gain.cancelScheduledValues(t); this.whirrG.gain.setValueAtTime(0.03, t); this.whirrG.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
    }
    this.wasFiring = firing;

    // seeker
    if (live && s.locked) {
      this.set(this.toneG.gain, 0.075, 0.02); this.set(this.tone.frequency, 1180, 0.02);
      this.set(this.toneVibD.gain, 8); this.set(this.growlD.gain, 0);
    } else if (live && s.inCone) {
      this.set(this.toneG.gain, 0.06, 0.03); this.set(this.tone.frequency, 380 + s.lockProgress * 260, 0.05);
      this.set(this.toneVibD.gain, 25); this.set(this.growlD.gain, 0.8 - s.lockProgress * 0.5);
    } else this.set(this.toneG.gain, 0, 0.03);

    // warnings: missile launch warning (alternating two-tone, faster when close), then ground proximity
    const td = s.threatDist ?? 1e9;
    if (live && td < 6000) {
      const period = td < 1500 ? 0.1 : td < 3000 ? 0.18 : 0.32;
      this.warnT += dt;
      const idx = Math.floor(this.warnT / period);
      if (idx !== this.warnIdx) {
        this.warnIdx = idx;
        this.warn.frequency.setValueAtTime(idx % 2 ? 1450 : 1000, t);
        this.warnG.gain.setValueAtTime(0.06, t); this.warnG.gain.setValueAtTime(0, t + period * 0.7);
      }
    } else if (live && s.pullUp) {
      this.gpwT -= dt;
      if (this.gpwT <= 0) {
        this.gpwT = 0.55;
        this.warnG.gain.cancelScheduledValues(t);
        this.warn.frequency.setValueAtTime(500, t); this.warn.frequency.exponentialRampToValueAtTime(900, t + 0.3);
        this.warnG.gain.setValueAtTime(0.07, t); this.warnG.gain.setValueAtTime(0, t + 0.32);
      }
    } else { this.warnT = 0; this.warnIdx = -1; this.gpwT = 0; this.set(this.warnG.gain, 0, 0.02); }

    // pilot
    this.set(this.strainG.gain, live && g > 6.5 ? Math.min(0.14, (g - 6.5) * 0.045) : 0, 0.3);
    const gl = s.gloc || 0;
    if (live && gl > 0.45) {
      this.hbT -= dt;
      if (this.hbT <= 0) {
        this.hbT = 0.95 - clamp((gl - 0.45) / 0.55, 0, 1) * 0.5;
        this.tn(this.master, t, 0.14, { f0: 70, f1: 40, g0: 0.35 });
        this.tn(this.master, t + 0.17, 0.12, { f0: 60, f1: 36, g0: 0.22 });
      }
    } else this.hbT = 0;

    // the other jet
    const O = s.opp;
    if (on && O && O.alive && this.listenerPos) {
      const d = Math.max(this.listenerPos.distanceTo(O.pos), 5);
      _d.copy(this.listenerPos).sub(O.pos).divideScalar(d); // source -> listener
      const vs = O.vel.dot(_d);
      const vl = this.listenerVel ? -this.listenerVel.dot(_d) : 0;
      const dop = clamp((SOUND_SPEED + vl) / Math.max(40, SOUND_SPEED - vs), 0.45, 2.4);
      const oe = O.eng ?? 1, oab = clamp((oe - 1) / (JET.maxThrottle - 1), 0, 1);
      const lvl = Math.min(1, Math.pow(320 / d, 1.15)) * (0.45 + oe * 0.35 + oab * 0.5);
      this.set(this.oppG.gain, lvl * (s.cockpit ? 0.6 : 1) * 0.9, 0.06);
      this.set(this.oppF.frequency, clamp(9000 * Math.pow(250 / d, 0.7), 300, 9000) * (s.cockpit ? 0.5 : 1), 0.08);
      this.set(this.oppNoise.playbackRate, dop, 0.06); this.set(this.oppRum.playbackRate, dop, 0.06);
      this.set(this.oppWhine.frequency, (520 + oe * 900) * dop, 0.06);
      if (this.oppPan) this.set(this.oppPan.pan, this.panFor(O.pos), 0.05);
    } else this.set(this.oppG.gain, 0, 0.1);
  }

  // ---------- one-shots ----------
  explosion(pos, big) {
    if (!this.ctx || !this.enabled) return;
    const sp = this.place(pos, big ? 700 : 450);
    if (!sp) return;
    const t = this.ctx.currentTime + sp.delay;
    const life = big ? 3.2 : 1.8;
    const o = this.out(sp, t, life, big ? 0.6 : 0.4);
    // sub-bass thump, body, crack and (for kills) a tail of debris crackles
    this.tn(o, t, big ? 1.4 : 0.8, { f0: big ? 85 : 110, f1: 26, g0: big ? 1.0 : 0.7, attack: 0.004 });
    this.nz(o, t, big ? 2.6 : 1.3, { buf: this.brown, f0: big ? 1600 : 2200, f1: 120, g0: big ? 1.1 : 0.8, attack: 0.003 });
    if (sp.cutoff > 2000) this.nz(o, t, 0.12, { type: 'highpass', f0: 1800, f1: 900, g0: 0.5 });
    if (big) {
      for (let i = 0; i < 9; i++) {
        const tt = t + 0.25 + Math.random() * 1.4;
        this.nz(o, tt, 0.05 + Math.random() * 0.12, { type: 'bandpass', f0: 600 + Math.random() * 2400, f1: 300, q: 1.5, g0: 0.15 + Math.random() * 0.2 });
      }
    }
  }
  // my bullets striking the bandit: metallic ticks (rate-limited, the gun fires 100 rounds/s)
  hit() {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    if (t - this.lastHit < 0.045) return;
    this.lastHit = t;
    const f = 2300 + Math.random() * 2200;
    this.tn(this.master, t, 0.07, { type: 'triangle', f0: f, f1: f * 0.8, g0: 0.16 });
    this.tn(this.master, t, 0.05, { type: 'sine', f0: f * 1.47, f1: f * 1.3, g0: 0.08 });
    this.nz(this.master, t, 0.04, { type: 'highpass', f0: 3500, g0: 0.2 });
  }
  // getting hit
  damage(kind) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    if (kind === 'msl') {
      this.explosion(null, false);
      this.nz(this.master, t, 0.9, { type: 'bandpass', f0: 900, f1: 200, q: 0.8, g0: 0.6 });
      return;
    }
    if (t - this.lastDmg < 0.06) return;
    this.lastDmg = t;
    this.tn(this.master, t, 0.16, { f0: 150, f1: 45, g0: 0.55 });
    this.nz(this.master, t, 0.12, { type: 'bandpass', f0: 1300 + Math.random() * 600, f1: 400, q: 1.2, g0: 0.45 });
  }
  launch(pos) {
    if (!this.ctx || !this.enabled) return;
    const sp = this.place(pos, 400);
    if (!sp) return;
    const t = this.ctx.currentTime + sp.delay;
    const o = this.out(sp, t, 3.2, 0.35);
    this.nz(o, t, 0.08, { type: 'highpass', f0: 1200, g0: 0.6 });               // rail release / ignition
    this.tn(o, t, 0.25, { f0: 120, f1: 50, g0: 0.5 });
    this.nz(o, t, 3.0, { buf: this.pink, type: 'bandpass', f0: 1600, f1: 280, q: 0.9, g0: 0.9, attack: 0.05 }); // receding motor
    this.nz(o, t, 2.4, { buf: this.brown, f0: 700, f1: 120, g0: 0.6, attack: 0.04 });
  }
  flare() {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    for (let i = 0; i < 2; i++) {
      const tt = t + i * 0.07;
      this.tn(this.master, tt, 0.07, { f0: 380, f1: 90, g0: 0.3 });
      this.nz(this.master, tt, 0.06, { type: 'highpass', f0: 2500, g0: 0.25 });
      this.nz(this.master, tt + 0.03, 0.7, { type: 'bandpass', f0: 5200, f1: 2500, q: 0.8, g0: 0.07, attack: 0.03 });
    }
  }
  beep(freq = 880, dur = 0.12, g0 = 0.12) {
    if (!this.ctx || !this.enabled) return;
    this.tn(this.master, this.ctx.currentTime, dur, { type: 'triangle', f0: freq, g0, attack: 0.005 });
  }
  click() { if (this.ctx && this.enabled) this.nz(this.master, this.ctx.currentTime, 0.04, { type: 'highpass', f0: 3000, g0: 0.15 }); }
}
