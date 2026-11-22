// All sound is synthesized with WebAudio (no asset files).
export class Audio {
  constructor() { this.ctx = null; this.enabled = true; this.listenerPos = null; }

  start() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain(); this.master.gain.value = 0.55; this.master.connect(ctx.destination);

    // noise buffer
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
    this.brown = buf;
    const wbuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const wd = wbuf.getChannelData(0);
    for (let i = 0; i < len; i++) wd[i] = Math.random() * 2 - 1;
    this.white = wbuf;

    // engine: brown noise roar + low whine
    this.engNoise = ctx.createBufferSource(); this.engNoise.buffer = buf; this.engNoise.loop = true;
    this.engFilter = ctx.createBiquadFilter(); this.engFilter.type = 'lowpass'; this.engFilter.frequency.value = 400;
    this.engGain = ctx.createGain(); this.engGain.gain.value = 0;
    this.engNoise.connect(this.engFilter).connect(this.engGain).connect(this.master);
    this.engNoise.start();
    this.whine = ctx.createOscillator(); this.whine.type = 'sawtooth'; this.whine.frequency.value = 180;
    this.whineFilter = ctx.createBiquadFilter(); this.whineFilter.type = 'bandpass'; this.whineFilter.frequency.value = 1200; this.whineFilter.Q.value = 6;
    this.whineGain = ctx.createGain(); this.whineGain.gain.value = 0;
    this.whine.connect(this.whineFilter).connect(this.whineGain).connect(this.master);
    this.whine.start();
    // wind
    this.wind = ctx.createBufferSource(); this.wind.buffer = wbuf; this.wind.loop = true;
    this.windFilter = ctx.createBiquadFilter(); this.windFilter.type = 'bandpass'; this.windFilter.frequency.value = 800; this.windFilter.Q.value = 0.7;
    this.windGain = ctx.createGain(); this.windGain.gain.value = 0;
    this.wind.connect(this.windFilter).connect(this.windGain).connect(this.master);
    this.wind.start();

    // gun: buzz
    this.gun = ctx.createOscillator(); this.gun.type = 'square'; this.gun.frequency.value = 100;
    this.gunNoise = ctx.createBufferSource(); this.gunNoise.buffer = wbuf; this.gunNoise.loop = true;
    this.gunFilter = ctx.createBiquadFilter(); this.gunFilter.type = 'lowpass'; this.gunFilter.frequency.value = 1800;
    this.gunGain = ctx.createGain(); this.gunGain.gain.value = 0;
    const gunMix = ctx.createGain(); gunMix.gain.value = 0.6;
    this.gun.connect(gunMix); this.gunNoise.connect(gunMix);
    gunMix.connect(this.gunFilter).connect(this.gunGain).connect(this.master);
    this.gun.start(); this.gunNoise.start();

    // seeker tone
    this.tone = ctx.createOscillator(); this.tone.type = 'sine'; this.tone.frequency.value = 600;
    this.toneLfo = ctx.createOscillator(); this.toneLfo.frequency.value = 8;
    this.toneLfoGain = ctx.createGain(); this.toneLfoGain.gain.value = 0;
    this.toneLfo.connect(this.toneLfoGain).connect(this.tone.frequency);
    this.toneGain = ctx.createGain(); this.toneGain.gain.value = 0;
    this.tone.connect(this.toneGain).connect(this.master);
    this.tone.start(); this.toneLfo.start();

    // missile warning
    this.warn = ctx.createOscillator(); this.warn.type = 'square'; this.warn.frequency.value = 1400;
    this.warnGain = ctx.createGain(); this.warnGain.gain.value = 0;
    const warnF = ctx.createBiquadFilter(); warnF.type = 'lowpass'; warnF.frequency.value = 3000;
    this.warn.connect(warnF).connect(this.warnGain).connect(this.master);
    this.warn.start();
    this.warnT = 0;
  }

  set(param, v, tc = 0.05) { if (this.ctx) param.setTargetAtTime(v, this.ctx.currentTime, tc); }

  // per-frame continuous sounds
  update(dt, s) {
    if (!this.ctx) return;
    const on = this.enabled && s.active;
    const eng = s.eng || 0, ab = Math.max(0, (eng - 1) / 0.2);
    this.set(this.engGain.gain, on && s.alive ? 0.25 + eng * 0.35 + ab * 0.4 : 0, 0.15);
    this.set(this.engFilter.frequency, 250 + eng * 500 + ab * 600, 0.2);
    this.set(this.whineGain.gain, on && s.alive ? 0.01 + eng * 0.025 : 0, 0.2);
    this.set(this.whine.frequency, 140 + eng * 160, 0.3);
    const sp = s.speed || 0;
    this.set(this.windGain.gain, on && s.alive ? Math.min(0.4, sp / 900) * (s.cockpit ? 0.6 : 1) + Math.max(0, (s.g || 1) - 5) * 0.03 : 0, 0.2);
    this.set(this.windFilter.frequency, 400 + sp * 3, 0.2);
    this.set(this.gunGain.gain, on && s.firing ? 0.38 : 0, 0.01);
    this.set(this.gunNoise.playbackRate, 1, 0.1);

    // seeker
    if (on && s.locked) {
      this.set(this.toneGain.gain, 0.08); this.set(this.tone.frequency, 1250); this.set(this.toneLfoGain.gain, 0);
    } else if (on && s.inCone) {
      this.set(this.toneGain.gain, 0.05); this.set(this.tone.frequency, 600 + s.lockProgress * 300); this.set(this.toneLfoGain.gain, 60);
    } else this.set(this.toneGain.gain, 0, 0.03);

    // missile warning beeps (faster when closer)
    if (on && s.threatDist < 6000) {
      const period = s.threatDist < 1500 ? 0.12 : s.threatDist < 3000 ? 0.25 : 0.5;
      this.warnT += dt;
      const phase = (this.warnT % period) / period;
      this.warnGain.gain.setValueAtTime(phase < 0.5 ? 0.07 : 0, this.ctx.currentTime);
    } else this.set(this.warnGain.gain, 0, 0.02);
  }

  burst(gain, freq, dur, type = 'lowpass', buf = this.white) {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = buf;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.frequency.exponentialRampToValueAtTime(Math.max(40, freq * 0.2), t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random()); src.stop(t + dur + 0.05);
  }

  explosion(pos, big) {
    let gain = big ? 1.2 : 0.8;
    if (pos && this.listenerPos) {
      const d = this.listenerPos.distanceTo(pos);
      gain *= Math.min(1, 300 / Math.max(d, 1));
      if (gain < 0.02) return;
    }
    this.burst(gain, big ? 900 : 1400, big ? 2.2 : 1.2, 'lowpass', this.brown);
    this.burst(gain * 0.4, 3000, 0.4);
  }
  hit() { this.burst(0.35, 2500, 0.08, 'highpass'); }
  launch() { this.burst(0.5, 2000, 1.4, 'bandpass'); }
  flare() { this.burst(0.18, 4000, 0.15, 'highpass'); }
  click() { this.burst(0.15, 3000, 0.04, 'highpass'); }
}
