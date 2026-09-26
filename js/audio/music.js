// Orbitality: a generative ambient score, synthesised live with the Web Audio API
// (no audio files). Slow detuned pads over a low drone, sparse bell "stars", and
// while you fly a quiet arpeggio that rises and falls and sweeps side to side like
// an orbit.
//
// The harmony follows the body you orbit: bright D Lydian around Earth, a colder
// E minor at the Moon, darker D Aeolian at Mars and open fifths in deep space.
// Burns open the pads up, high time warp doubles the arpeggio, pausing muffles
// everything, and catching the target or crashing plays a short cue.
//
// `Score` is the synthesiser and only needs an AudioContext, so the same code can
// be rendered offline. `Music` is the live controller: autoplay unlock, the on/off
// preference, tab visibility, and turning game state into score changes.

const PREF_KEY = 'orbitality.music.v1';
const LOOKAHEAD = 0.6; // s of events scheduled ahead of the audio clock

// levels (linear gain) of each voice, before the master compressor
const LEVEL = 1;
const PAD = 0.045; // per sawtooth, two per chord note
const BASS = 0.07;
const BELL = 0.12;
const ARP = 0.055;
const SHIMMER = 0.035;

const SEMITONE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** 'C#4' -> MIDI note number. */
function midi(name) {
  const m = /^([A-G])([#b]?)(\d)$/.exec(name);
  return 12 * (Number(m[3]) + 1) + SEMITONE[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
}
const notes = (s) => s.split(' ').map(midi);
const hz = (m) => 440 * 2 ** ((m - 69) / 12);
const chord = (bass, pad) => ({ bass: midi(bass), pad: notes(pad) });

// Each palette: a slow chord cycle (pad notes low to high), a bell scale that
// sits well over every chord, the notes of the "caught" cue, and its mood.
export const PALETTES = {
  earth: { // warm and bright: D Lydian
    chords: [
      chord('D2', 'A3 D4 F#4 C#5'), // Dmaj7
      chord('B1', 'F#3 B3 D4 C#5'), // Bm(add9)
      chord('G1', 'G3 B3 F#4 C#5'), // Gmaj7(#11)
      chord('A1', 'E3 A3 E4 B4'), // Asus2
    ],
    bells: notes('D5 E5 F#5 A5 B5 C#6 E6'),
    cue: notes('D5 A5 C#6 E6 F#6'),
    chordSec: 15, bellRate: 0.28, cutoff: 1500, bass: 1,
  },
  moon: { // colder and sparser: E minor with a Lydian C
    chords: [
      chord('E2', 'G3 B3 F#4 B4'), // Em(add9)
      chord('C2', 'G3 B3 E4 F#4'), // Cmaj7(#11)
      chord('A1', 'G3 C4 E4 B4'), // Am9
      chord('B1', 'F#3 A3 E4 B4'), // B7sus4
    ],
    bells: notes('E5 F#5 A5 B5 D6 E6 F#6'),
    cue: notes('E5 B5 D6 F#6 B6'),
    chordSec: 18, bellRate: 0.2, cutoff: 1250, bass: 0.6,
  },
  mars: { // dusty and darker: D Aeolian
    chords: [
      chord('D2', 'F3 A3 E4 A4'), // Dm(add9)
      chord('Bb1', 'F3 A3 D4 E4'), // Bbmaj7(#11)
      chord('G1', 'F3 Bb3 D4 A4'), // Gm9
      chord('A1', 'G3 D4 E4 A4'), // A7sus4
    ],
    bells: notes('D5 E5 F5 A5 C6 D6'),
    cue: notes('D5 A5 C6 E6 F6'),
    chordSec: 16, bellRate: 0.22, cutoff: 1000, bass: 1.1,
  },
  deep: { // interplanetary cruise: open, suspended chords
    chords: [
      chord('D2', 'A3 D4 E4 A4'), // Dsus2
      chord('C2', 'G3 C4 D4 G4'), // Csus2
      chord('Bb1', 'F3 C4 E4 A4'), // Bbmaj9(#11)
      chord('A1', 'E3 A3 D4 E4'), // Asus4
    ],
    bells: notes('D5 E5 G5 A5 D6'),
    cue: notes('D5 A5 D6 E6 A6'),
    chordSec: 22, bellRate: 0.13, cutoff: 900, bass: 1.2,
  },
};

const BODY_PALETTE = { earth: 'earth', moon: 'moon', mars: 'mars', venus: 'mars', mercury: 'moon' };
export const paletteFor = (bodyId) => BODY_PALETTE[bodyId] || 'deep';

// arpeggio: up and back down through the chord, like periapsis to apoapsis and back
const PATTERN = [0, 1, 2, 3, 2, 1];
const STEP = 0.42; // s per note; half that at high time warp

/** Small seeded PRNG so offline renders can be reproduced. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stereo reverb impulse: decaying noise that gets darker as it fades. */
function impulse(ctx, seconds, rand) {
  const rate = ctx.sampleRate;
  const len = Math.floor(rate * seconds);
  const pre = Math.floor(rate * 0.025);
  const buf = ctx.createBuffer(2, len, rate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let lp = 0;
    for (let i = pre; i < len; i++) {
      const x = (i - pre) / (len - pre);
      lp += (0.7 - 0.6 * x) * (rand() * 2 - 1 - lp);
      d[i] = lp * Math.exp(-7 * x) * (1 - x);
    }
  }
  return buf;
}

export class Score {
  constructor(ctx, out, { seed = (Math.random() * 2 ** 32) >>> 0 } = {}) {
    this.ctx = ctx;
    this.rand = mulberry32(seed);

    // everything -> muffle (pause) -> duck -> master fade -> compressor -> out
    this.muffle = this.filter('lowpass', 18000, 0.7);
    this.duck = this.gain(1);
    this.master = this.gain(0);
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 12;
    comp.ratio.value = 3;
    comp.attack.value = 0.03;
    comp.release.value = 0.4;
    this.muffle.connect(this.duck).connect(this.master).connect(comp).connect(out);

    // shared reverb, and a slow dotted-time echo for bells and arpeggio
    const reverb = ctx.createConvolver();
    reverb.buffer = impulse(ctx, 3.5, this.rand);
    this.reverb = this.gain(1);
    this.reverb.connect(reverb).connect(this.gain(0.8)).connect(this.muffle);
    this.echo = this.gain(1);
    const delay = ctx.createDelay(2);
    delay.delayTime.value = STEP * 1.5;
    const tone = this.filter('lowpass', 2600, 0.5);
    this.echo.connect(delay).connect(tone).connect(this.gain(0.42)).connect(delay);
    this.send(tone, this.muffle, 0.5);
    this.send(tone, this.reverb, 0.4);

    // pads: chord voices -> filter with a slow sweep -> dry, and reverb above the bass
    this.padBus = this.gain(1);
    this.padFilter = this.filter('lowpass', PALETTES.earth.cutoff, 0.5);
    this.padBus.connect(this.padFilter);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.04;
    lfo.connect(this.gain(300)).connect(this.padFilter.frequency);
    lfo.start();
    this.send(this.padFilter, this.muffle, 0.7);
    this.padFilter.connect(this.filter('highpass', 220, 0.5)).connect(this.gain(0.55)).connect(this.reverb);

    // shimmer: two sines an octave above the chord's top notes, brought up while burning
    this.shimmer = this.gain(0);
    this.send(this.shimmer, this.muffle, 0.3);
    this.send(this.shimmer, this.reverb, 1);
    this.shimmerOsc = [0, 1].map((i) => {
      const o = ctx.createOscillator();
      o.frequency.value = 440;
      o.connect(this.panner(i ? 0.4 : -0.4)).connect(this.gain(SHIMMER)).connect(this.shimmer);
      o.start();
      return o;
    });

    this.bells = this.gain(1);
    this.send(this.bells, this.muffle, 0.35);
    this.send(this.bells, this.echo, 0.3);
    this.send(this.bells, this.reverb, 0.8);

    this.arp = this.gain(0);
    this.send(this.arp, this.muffle, 0.4);
    this.send(this.arp, this.echo, 0.25);
    this.send(this.arp, this.reverb, 0.45);

    this.fx = this.gain(1);
    this.send(this.fx, this.muffle, 0.8);
    this.send(this.fx, this.reverb, 0.6);

    this.paletteId = 'earth';
    this.palette = PALETTES.earth;
    this.voices = []; // sounding chords, oldest first
    this.chordIndex = 0;
    this.nextChord = 0;
    this.nextAttack = 6;
    this.nextBell = 0;
    this.lastBell = -1;
    this.bellScale = 1;
    this.arpOn = false;
    this.arpUntil = 0;
    this.nextArp = 0;
    this.arpStep = 0;
    this.stepSec = STEP;
    this.fast = false;
    this.intensity = 0;
  }

  // ---------------------------------------------------------------- node helpers

  gain(v) {
    const g = this.ctx.createGain();
    g.gain.value = v;
    return g;
  }

  filter(type, freq, q) {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    return f;
  }

  panner(v) {
    if (!this.ctx.createStereoPanner) return this.gain(1);
    const p = this.ctx.createStereoPanner();
    p.pan.value = v;
    return p;
  }

  send(from, to, level) {
    from.connect(this.gain(level)).connect(to);
  }

  // ---------------------------------------------------------------- timeline

  /** Schedule every note that starts before `end` (audio clock seconds). */
  scheduleUntil(end) {
    // after a stall or a suspend, carry on from now rather than catching up
    const soon = this.ctx.currentTime + 0.03;
    if (this.nextChord < soon) this.nextChord = soon;
    while (this.nextChord < end) {
      const p = this.palette;
      const dur = p.chordSec * (0.85 + 0.3 * this.rand());
      this.playChord(p.chords[this.chordIndex++ % p.chords.length], this.nextChord, dur, this.nextAttack);
      this.nextAttack = 5;
      this.nextChord += dur;
    }

    if (this.nextBell < soon) this.nextBell = soon + 1 + 2 * this.rand();
    while (this.nextBell < end) {
      this.bellGesture(this.nextBell);
      const rate = this.palette.bellRate * this.bellScale;
      this.nextBell += Math.max(1, -Math.log(1 - this.rand()) / rate);
    }

    if (this.arpOn || this.nextArp < this.arpUntil) {
      if (this.nextArp < soon) this.nextArp = soon;
      while (this.nextArp < end && (this.arpOn || this.nextArp < this.arpUntil)) {
        this.arpNote(this.nextArp);
        this.nextArp += this.stepSec;
      }
    }
  }

  /** The chord sounding at time t. */
  chordAt(t) {
    for (let i = this.voices.length - 1; i >= 0; i--) {
      if (this.voices[i].start <= t) return this.voices[i].chord;
    }
    return this.voices[0]?.chord || this.palette.chords[0];
  }

  // ---------------------------------------------------------------- voices

  playChord(c, t, dur, attack) {
    const ctx = this.ctx;
    const release = 7;
    const env = this.gain(0);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(1, t + attack);
    env.gain.setValueAtTime(1, t + dur);
    env.gain.linearRampToValueAtTime(0, t + dur + release);
    const cut = this.gain(1); // ends the chord early on a palette change or cue
    env.connect(cut).connect(this.padBus);

    const nodes = [env, cut];
    const oscs = [];
    const osc = (type, freq, detune, dest) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      o.detune.value = detune;
      o.connect(dest);
      o.start(t);
      oscs.push(o);
    };
    // two slightly detuned saws per note, one each side, for a slow chorus
    for (const side of [-1, 1]) {
      const g = this.gain(PAD);
      g.connect(this.panner(0.5 * side)).connect(env);
      nodes.push(g);
      for (const m of c.pad) osc('sawtooth', hz(m), side * (4 + 5 * this.rand()), g);
    }
    // drone: the bass note, plus a quieter octave so small speakers can hear it
    for (const [shift, level] of [[0, 1], [12, 0.5]]) {
      const g = this.gain(BASS * level * this.palette.bass);
      g.connect(env);
      nodes.push(g);
      osc(shift ? 'triangle' : 'sine', hz(c.bass + shift), 0, g);
    }

    const top = c.pad.slice(-2);
    this.shimmerOsc.forEach((o, i) => o.frequency.setTargetAtTime(hz(top[i] + 12), t, 0.4));

    const v = { chord: c, start: t, stopAt: t + dur + release + 0.05, cut, oscs };
    for (const o of oscs) o.stop(v.stopAt);
    oscs[0].onended = () => {
      for (const n of [...oscs, ...nodes]) n.disconnect();
      this.voices.splice(this.voices.indexOf(v), 1);
    };
    this.voices.push(v);
  }

  /** Fade out every chord from time t (they may still be in their attack). */
  endChords(t, release) {
    for (const v of this.voices) {
      if (v.stopAt <= t) continue;
      v.cut.gain.setValueAtTime(1, t);
      v.cut.gain.linearRampToValueAtTime(0, t + release);
      v.stopAt = Math.min(v.stopAt, t + release + 0.05);
      for (const o of v.oscs) o.stop(v.stopAt);
    }
  }

  bellGesture(t) {
    const scale = this.palette.bells;
    let i;
    do i = Math.floor(this.rand() * scale.length); while (i === this.lastBell && scale.length > 1);
    this.lastBell = i;
    // mostly single notes; sometimes a rising pair or a falling three-note "shooting star"
    const r = this.rand();
    const count = r < 0.72 ? 1 : r < 0.92 ? 2 : 3;
    const dir = count === 3 ? -1 : 1;
    for (let k = 0; k < count; k++) {
      const j = Math.max(0, Math.min(scale.length - 1, i + k * dir));
      this.bell(scale[j], t + k * 0.19, 0.55 + 0.45 * this.rand() - 0.12 * k, this.rand() * 1.2 - 0.6);
    }
  }

  /** A soft struck bell: a sine plus two inharmonic partials that die away faster. */
  bell(m, t, vel, pan) {
    const f = hz(m);
    const out = this.panner(pan);
    out.connect(this.bells);
    const oscs = [];
    for (const [ratio, level, tau] of [[1, 1, 1.1], [2.76, 0.3, 0.45], [5.4, 0.1, 0.18]]) {
      if (f * ratio > 9000) continue;
      const o = this.ctx.createOscillator();
      o.frequency.value = f * ratio;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(BELL * vel * level, t + 0.008);
      g.gain.setTargetAtTime(0, t + 0.008, tau);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + 0.01 + tau * 6);
      oscs.push([o, g]);
    }
    oscs[0][0].onended = () => {
      for (const [o, g] of oscs) { o.disconnect(); g.disconnect(); }
      out.disconnect();
    };
  }

  arpNote(t) {
    const n = PATTERN.length;
    if (this.arpStep % n === 0) this.stepSec = this.fast ? STEP / 2 : STEP; // tempo changes on the cycle
    const step = this.arpStep++;
    if (step % n !== 0 && this.rand() < 0.2) return; // leave gaps so it breathes
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = hz(this.chordAt(t).pad[PATTERN[step % n]] + 12);
    const f = this.filter('lowpass', 3200, 3);
    f.frequency.setValueAtTime(3200, t);
    f.frequency.setTargetAtTime(700, t, 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(ARP * (step % n === 0 ? 1 : 0.7), t + 0.005);
    g.gain.setTargetAtTime(0, t + 0.005, 0.3);
    const p = this.panner(0.35 * Math.cos((2 * Math.PI * step) / n));
    o.connect(f).connect(g).connect(p).connect(this.arp);
    o.start(t);
    o.stop(t + 2);
    o.onended = () => { o.disconnect(); f.disconnect(); g.disconnect(); p.disconnect(); };
  }

  // ---------------------------------------------------------------- controls

  /** Move to another body's harmony with a slow crossfade. */
  setPalette(id) {
    if (id === this.paletteId || !PALETTES[id]) return;
    const t = this.ctx.currentTime + 0.05;
    this.paletteId = id;
    this.palette = PALETTES[id];
    this.chordIndex = 0;
    this.arpStep = 0;
    this.endChords(t, 6);
    this.nextChord = t;
    this.nextAttack = 4;
    this.padFilter.frequency.setTargetAtTime(this.palette.cutoff * (1 + 1.4 * this.intensity), t, 2);
  }

  /** Burns: 0 idle, 1 burning. Opens the pad filter and brings in the shimmer. */
  setIntensity(x) {
    const now = this.ctx.currentTime;
    const up = x > this.intensity;
    this.intensity = x;
    this.padFilter.frequency.setTargetAtTime(this.palette.cutoff * (1 + 1.4 * x), now, up ? 0.6 : 1.8);
    this.padBus.gain.setTargetAtTime(1 + 0.25 * x, now, up ? 0.6 : 1.8);
    this.shimmer.gain.setTargetAtTime(x, now, up ? 1 : 2);
  }

  setArp(on) {
    if (on === this.arpOn) return;
    const now = this.ctx.currentTime;
    this.arpOn = on;
    this.arp.gain.setTargetAtTime(on ? 1 : 0, now, on ? 1.5 : 0.4);
    if (!on) this.arpUntil = now + 2.5;
    else if (this.nextArp < now) this.arpStep = 0;
  }

  /** High time warp: the arpeggio doubles its speed from the next cycle. */
  setFast(on) {
    this.fast = on;
  }

  /** Fewer bells, for the title screen. */
  setSparse(on) {
    this.bellScale = on ? 0.7 : 1;
  }

  /** Paused: muffled and quieter. */
  setMuffled(on) {
    const now = this.ctx.currentTime;
    this.muffle.frequency.setTargetAtTime(on ? 650 : 18000, now, on ? 0.25 : 0.5);
    this.duck.gain.setTargetAtTime(on ? 0.6 : 1, now, 0.3);
  }

  fadeTo(level, seconds) {
    this.master.gain.setTargetAtTime(level * LEVEL, this.ctx.currentTime, seconds / 3);
  }

  /** 'caught': rising chime and back to the home chord. 'crashed': a low boom. */
  cue(kind) {
    const t = this.ctx.currentTime + 0.05;
    if (kind === 'caught') {
      this.palette.cue.forEach((m, i) => this.bell(m, t + i * 0.13, 1 - i * 0.08, -0.5 + i * 0.25));
      this.chordIndex = 0;
      this.endChords(t + 0.3, 5);
      this.nextChord = t + 0.3;
      this.nextAttack = 2.5;
      this.nextBell = Math.max(this.nextBell, t + 3);
    } else if (kind === 'crashed') {
      this.impact(t);
    }
  }

  impact(t) {
    const ctx = this.ctx;
    const b = this.chordAt(t).bass;
    // a sine falling an octave and a rumble of noise that darkens as it fades
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(hz(b + 12), t);
    o.frequency.exponentialRampToValueAtTime(hz(b), t + 2.5);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0, t);
    og.gain.linearRampToValueAtTime(0.22, t + 0.03);
    og.gain.setTargetAtTime(0, t + 0.03, 0.9);
    o.connect(og).connect(this.fx);
    o.start(t);
    o.stop(t + 6);

    const len = Math.floor(ctx.sampleRate * 3);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = this.rand() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = this.filter('lowpass', 1200, 0.7);
    f.frequency.setValueAtTime(1200, t);
    f.frequency.exponentialRampToValueAtTime(80, t + 2.5);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0, t);
    ng.gain.linearRampToValueAtTime(0.15, t + 0.02);
    ng.gain.setTargetAtTime(0, t + 0.02, 0.7);
    src.connect(f).connect(ng).connect(this.fx);
    src.start(t);
    o.onended = () => { o.disconnect(); og.disconnect(); src.disconnect(); f.disconnect(); ng.disconnect(); };

    // the pads dim for a moment
    const c = this.palette.cutoff;
    this.padFilter.frequency.setTargetAtTime(c * 0.5, t, 0.3);
    this.padFilter.frequency.setTargetAtTime(c * (1 + 1.4 * this.intensity), t + 3, 2);
  }
}

// ------------------------------------------------------------------ live controller

function readPref() {
  try { return localStorage.getItem(PREF_KEY) !== 'off'; } catch { return true; }
}

function writePref(on) {
  try { localStorage.setItem(PREF_KEY, on ? 'on' : 'off'); } catch { /* ignore */ }
}

const SETTERS = {
  palette: (s, v) => s.setPalette(v),
  sparse: (s, v) => s.setSparse(v),
  arp: (s, v) => s.setArp(v),
  fast: (s, v) => s.setFast(v),
  intensity: (s, v) => s.setIntensity(v),
  muffled: (s, v) => s.setMuffled(v),
};

export class Music {
  constructor() {
    this.enabled = readPref();
    this.ctx = null;
    this.score = null;
    this.controls = [];
    this.world = null;
    this.body = null; // body whose palette is playing
    this.pendingBody = null;
    this.pendingSince = 0;
    this.want = {};
    this.sent = {};
    // browsers only start audio from a user gesture, so try on every one
    const wake = () => this.wake();
    for (const type of ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown']) {
      document.addEventListener(type, wake, { capture: true, passive: true });
    }
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.ctx?.suspend().catch(() => {});
      else this.wake();
    });
  }

  wake() {
    if (!this.enabled || document.hidden) return;
    if (!this.ctx && !this.start()) return;
    if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
  }

  start() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    try {
      this.ctx = new AC({ latencyHint: 'playback' });
    } catch {
      try { this.ctx = new AC(); } catch { return false; }
    }
    this.score = new Score(this.ctx, this.ctx.destination);
    this.sent = {};
    this.push();
    this.score.fadeTo(1, 4);
    setInterval(() => {
      if (this.ctx.state === 'running') this.score.scheduleUntil(this.ctx.currentTime + LOOKAHEAD);
    }, 100);
    return true;
  }

  setEnabled(on) {
    this.enabled = on;
    writePref(on);
    this.sync();
    if (on) {
      this.wake();
      this.score?.fadeTo(1, 2);
    } else if (this.score) {
      this.score.fadeTo(0, 0.5);
      setTimeout(() => { if (!this.enabled) this.ctx.suspend().catch(() => {}); }, 700);
    }
  }

  toggle() {
    this.setEnabled(!this.enabled);
  }

  /** Wire a button to toggle music. Buttons with data-text show "Music: on/off". */
  bind(el) {
    this.controls.push(el);
    el.addEventListener('click', () => this.toggle());
    this.sync();
  }

  sync() {
    for (const el of this.controls) {
      el.classList.toggle('off', !this.enabled);
      if (el.hasAttribute('data-text')) el.textContent = `Music: ${this.enabled ? 'on' : 'off'}`;
      else el.setAttribute('aria-pressed', String(this.enabled));
    }
  }

  /**
   * Called every frame with the game state: { world, scene: 'menu' | 'flight',
   * body, flying, burning, fast, paused }. Only changes reach the score.
   */
  update(s) {
    const now = performance.now();
    if (s.world !== this.world) {
      // new level or back to the menu: switch at once
      this.world = s.world;
      this.body = this.pendingBody = s.body;
    } else if (s.body !== this.pendingBody) {
      this.pendingBody = s.body;
      this.pendingSince = now;
    } else if (s.body !== this.body && now - this.pendingSince > 2000) {
      // stayed in the new sphere of influence, not just grazing its edge
      this.body = s.body;
    }
    const w = this.want;
    w.palette = paletteFor(this.body);
    w.sparse = s.scene === 'menu';
    w.arp = !!s.flying;
    w.fast = !!s.fast;
    w.intensity = s.burning ? 1 : 0;
    w.muffled = !!s.paused;
    this.push();
  }

  push() {
    if (!this.score) return;
    for (const k in this.want) {
      if (this.sent[k] === this.want[k]) continue;
      this.sent[k] = this.want[k];
      SETTERS[k](this.score, this.want[k]);
    }
  }

  /** One-off cue: 'caught' or 'crashed'. */
  cue(kind) {
    if (this.score && this.enabled && this.ctx.state === 'running') this.score.cue(kind);
  }
}
