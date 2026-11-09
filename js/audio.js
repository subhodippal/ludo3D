// Procedural sound effects with the Web Audio API (no audio files needed)

class Sfx {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.vibrate = true;
    this.master = null;
    this._noise = null;
  }

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.7;
      const comp = this.ctx.createDynamicsCompressor();
      this.master.connect(comp).connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 0.5;
      this._noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this._noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  get ok() { return this.enabled && this.ctx && this.ctx.state === 'running'; }

  buzz(pattern) {
    if (this.vibrate && navigator.vibrate) try { navigator.vibrate(pattern); } catch { /* ignore */ }
  }

  _tone({ freq = 440, to = null, type = 'sine', dur = 0.15, vol = 0.3, delay = 0, attack = 0.005 }) {
    if (!this.ok) return;
    const t0 = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(this.master);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  _noiseHit({ dur = 0.06, vol = 0.3, freq = 2500, q = 1.2, delay = 0, type = 'bandpass' }) {
    if (!this.ok) return;
    const t0 = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t0, Math.random() * 0.3);
    src.stop(t0 + dur + 0.02);
  }

  // Dice hitting the board / walls; strength 0..1
  diceHit(strength = 0.5) {
    const s = Math.min(1, Math.max(0.05, strength));
    this._noiseHit({ dur: 0.04 + s * 0.05, vol: 0.12 + s * 0.45, freq: 1800 + Math.random() * 1600, q: 2.5 });
    this._tone({ freq: 180 + Math.random() * 80, type: 'triangle', dur: 0.06, vol: 0.12 * s });
  }

  diceShake() {
    for (let i = 0; i < 5; i++) this._noiseHit({ dur: 0.03, vol: 0.12, freq: 3000 + Math.random() * 2000, q: 3, delay: i * 0.045 });
  }

  hop(step = 0) {
    const f = 420 + step * 38;
    this._tone({ freq: f, to: f * 1.5, type: 'triangle', dur: 0.09, vol: 0.22 });
    this._noiseHit({ dur: 0.03, vol: 0.08, freq: 900, q: 1, delay: 0.1 });
  }

  land() {
    this._tone({ freq: 160, to: 90, type: 'sine', dur: 0.14, vol: 0.35 });
    this._noiseHit({ dur: 0.05, vol: 0.12, freq: 700, q: 0.8 });
  }

  enterBoard() {
    [523, 659, 784].forEach((f, i) => this._tone({ freq: f, type: 'triangle', dur: 0.14, vol: 0.2, delay: i * 0.06 }));
  }

  capture() {
    this._tone({ freq: 880, to: 110, type: 'sawtooth', dur: 0.45, vol: 0.16 });
    this._tone({ freq: 90, to: 50, type: 'sine', dur: 0.35, vol: 0.45, delay: 0.05 });
    this._noiseHit({ dur: 0.25, vol: 0.2, freq: 600, q: 0.6, type: 'lowpass' });
    this.buzz([40, 40, 80]);
  }

  home() {
    [659, 784, 988, 1319].forEach((f, i) => this._tone({ freq: f, type: 'sine', dur: 0.3, vol: 0.2, delay: i * 0.08 }));
    this.buzz(30);
  }

  six() {
    this._tone({ freq: 988, type: 'sine', dur: 0.18, vol: 0.18 });
    this._tone({ freq: 1319, type: 'sine', dur: 0.25, vol: 0.18, delay: 0.09 });
  }

  // bright "ta-da" with sparkle
  cheer() {
    [784, 988, 1175, 1568].forEach((f, i) => this._tone({ freq: f, type: 'triangle', dur: 0.22, vol: 0.16, delay: 0.12 + i * 0.06 }));
    for (let i = 0; i < 6; i++) this._tone({ freq: 2000 + Math.random() * 1800, type: 'sine', dur: 0.08, vol: 0.06, delay: 0.35 + i * 0.05 });
  }

  // distant firecracker: thump + crackle
  firework(power = 1) {
    const v = Math.min(1, 0.5 + power * 0.25);
    this._noiseHit({ dur: 0.35, vol: 0.28 * v, freq: 260, q: 0.7, type: 'lowpass' });
    this._tone({ freq: 120, to: 50, type: 'sine', dur: 0.3, vol: 0.25 * v });
    for (let i = 0; i < 7; i++) {
      this._noiseHit({ dur: 0.025, vol: 0.09 * v, freq: 3500 + Math.random() * 3000, q: 4, delay: 0.25 + Math.random() * 0.5 });
    }
  }

  pop() {
    this._tone({ freq: 500, to: 1100, type: 'sine', dur: 0.1, vol: 0.2 });
  }

  turn() { this._tone({ freq: 660, type: 'sine', dur: 0.08, vol: 0.1 }); }
  click() { this._tone({ freq: 1200, to: 800, type: 'square', dur: 0.04, vol: 0.06 }); }
  error() { this._tone({ freq: 220, to: 160, type: 'square', dur: 0.15, vol: 0.08 }); }

  // ---- Snakes & Ladders
  // one rung of a ladder climb; pitch rises with each step
  climb(step = 0) {
    const f = 520 * Math.pow(2, Math.min(step, 24) / 12);
    this._tone({ freq: f, type: 'triangle', dur: 0.1, vol: 0.18 });
    this._tone({ freq: f * 2, type: 'sine', dur: 0.06, vol: 0.05, delay: 0.02 });
  }

  // snake hiss: filtered noise swell
  hiss(dur = 0.9) {
    if (!this.ok) return;
    const t0 = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noise;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 3800;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.32, t0 + 0.12);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
  }

  chomp() {
    this._noiseHit({ dur: 0.08, vol: 0.4, freq: 900, q: 1 });
    this._tone({ freq: 140, to: 60, type: 'square', dur: 0.16, vol: 0.18 });
    this.buzz([50, 30, 50]);
  }

  // long descending slide down the snake
  slide(dur = 1.2) {
    this._tone({ freq: 900, to: 120, type: 'sawtooth', dur, vol: 0.09 });
    this._tone({ freq: 450, to: 70, type: 'sine', dur, vol: 0.18 });
  }

  // triumphant rising arpeggio at the top of a ladder
  ladderTop() {
    [523, 659, 784, 1047, 1319].forEach((f, i) => this._tone({ freq: f, type: 'triangle', dur: 0.2, vol: 0.18, delay: i * 0.05 }));
    this.buzz(25);
  }

  boing() { this._tone({ freq: 300, to: 160, type: 'sine', dur: 0.25, vol: 0.2 }); this._tone({ freq: 160, to: 420, type: 'triangle', dur: 0.18, vol: 0.12, delay: 0.2 }); }

  win() {
    const notes = [523, 659, 784, 1047, 784, 1047, 1319];
    notes.forEach((f, i) => {
      this._tone({ freq: f, type: 'triangle', dur: 0.28, vol: 0.22, delay: i * 0.13 });
      this._tone({ freq: f / 2, type: 'sine', dur: 0.28, vol: 0.12, delay: i * 0.13 });
    });
    this.buzz([60, 60, 60, 60, 200]);
  }
}

export const sfx = new Sfx();
