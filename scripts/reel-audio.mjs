// Synthesises the reel soundtrack from the cue sheet in reel.js, so every beep,
// shot and steel ping lands on the frame that shows it. No samples are used.
//
//   node scripts/reel-audio.mjs out.wav
import { readFile, writeFile } from 'node:fs/promises';
import vm from 'node:vm';

// Resolve against this module's URL, not a path pasted into a file:// string,
// so a checkout path containing '#', '?' or '%' still finds reel.js.
const sandbox = { window: {} };
vm.runInNewContext(await readFile(new URL('../reel.js', import.meta.url), 'utf8'), sandbox);
const { CUES, DURATION, MARKS, SHOTS, TARGETS } = sandbox.window.KRPSAReel;

const SR = 48000;
const N = Math.round(DURATION * SR);
// Music and effects go to separate buses, so the music alone can tape-stop into
// slow motion and duck under the shots; each has a dry pair and a reverb send.
const bus = () => ({
  dry: [new Float32Array(N), new Float32Array(N)],
  wet: [new Float32Array(N), new Float32Array(N)],
});
const music = bus();
const fx = bus();
let target = music; // the bus place() writes to
let speed = 1; // varispeed of the voice being placed (see the cue loop)
const BPM = 120;
const BEAT = 60 / BPM;

let seed = 1;
const noise = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 2147483648 - 1;
};
const midi = (n) => 440 * 2 ** ((n - 69) / 12);

// Write a mono voice into the mix. fn(t) returns a sample at t seconds into the voice;
// pan is -1..1, or a function of t for a voice that moves.
function place(t0, dur, fn, { gain = 1, pan = 0, send = 0 } = {}) {
  let src = fn;
  let length = dur;
  if (speed !== 1) {
    // Varispeed, like tape: render the voice, then read it back faster or
    // slower, so pitch and length move together.
    const s = speed;
    const buf = new Float32Array(Math.ceil(dur * SR) + 1);
    for (let i = 0; i < buf.length; i++) buf[i] = fn(i / SR);
    length = dur / s;
    src = (t) => {
      const x = t * s * SR;
      const i = Math.floor(x);
      return i + 1 < buf.length ? buf[i] + (buf[i + 1] - buf[i]) * (x - i) : 0;
    };
  }
  const i0 = Math.round(t0 * SR);
  const len = Math.round(length * SR);
  const moving = typeof pan === 'function';
  let gl = moving ? 0 : Math.cos(((pan + 1) * Math.PI) / 4) * gain;
  let gr = moving ? 0 : Math.sin(((pan + 1) * Math.PI) / 4) * gain;
  for (let i = 0; i < len; i++) {
    const k = i0 + i;
    if (k < 0 || k >= N) continue;
    const v = src(i / SR);
    if (moving) {
      const p = Math.min(1, Math.max(-1, pan(i / SR)));
      gl = Math.cos(((p + 1) * Math.PI) / 4) * gain;
      gr = Math.sin(((p + 1) * Math.PI) / 4) * gain;
    }
    target.dry[0][k] += v * gl;
    target.dry[1][k] += v * gr;
    if (send) {
      target.wet[0][k] += v * gl * send;
      target.wet[1][k] += v * gr * send;
    }
  }
}

// ------------------------------------------------------------------- stage
// Stage time (s, the shot timer) at video time t and back: the clock runs at
// each speed ramp's rate. Checked against the shots so it cannot drift from reel.js.
const rateAt = (t) => (MARKS.ramps.find(([a, b]) => t >= a && t < b) ?? [0, 0, 1])[2];
const stageOf = (t) =>
  MARKS.ramps.reduce((st, [a, b, r]) => st + (r - 1) * Math.min(Math.max(t - a, 0), b - a), MARKS.stageStart + t - MARKS.resume);
function videoOf(st) {
  let lo = MARKS.resume;
  let hi = DURATION;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (stageOf(mid) < st) lo = mid;
    else hi = mid;
  }
  return hi;
}
for (const s of SHOTS) if (Math.abs(videoOf(s.st) - s.t) > 1e-6) throw new Error(`Stage clock out of sync at shot ${s.i}`);
// How long the tape stop into a slow ramp at t runs (deeper the slower the
// ramp), reaching back no further than the start of the slow ramp before it:
// quick slow motion into bullet time leaves less room, and two stops must not
// overlap.
const stopLength = (t, rate) =>
  Math.min(0.22 + 0.25 * (1 - rate), t - Math.max(...MARKS.ramps.filter(([a, , r]) => r < 1 && a < t - 1e-6).map(([a]) => a)));
// How far a sound of the world is slowed or sped up inside a ramp: less than
// the picture, so it still reads.
const vari = (t) => {
  const r = rateAt(t);
  return r < 1 ? r ** 0.6 : r ** 0.4;
};
// Where a target sits left to right as seen from its shooting area (+x is
// screen right); a pair of plates sits side by side.
function panOf(key, plate) {
  const tg = TARGETS[key];
  const area = Object.values(TARGETS).filter((o) => o.from === tg.from);
  const mid = area.reduce((x, o) => x + o.pos[0], 0) / area.length;
  const p = Math.min(0.5, Math.max(-0.5, (tg.pos[0] - mid) / 6));
  return tg.kind === 'plates' ? p + ((plate ?? 0) - 0.5) * 0.12 : p;
}
// The key of the first target of a kind, if the stage has one.
const keyOf = (kind) => Object.keys(TARGETS).find((key) => TARGETS[key].kind === kind);

// Topology-preserving state-variable filter (stable under fast sweeps). k is the
// damping: small k rings, large k is broad.
function svf(k = 0.7) {
  let ic1 = 0;
  let ic2 = 0;
  return (x, fc, mode = 'low') => {
    const g = Math.tan((Math.PI * Math.min(Math.max(fc, 10), SR * 0.45)) / SR);
    const a1 = 1 / (1 + g * (g + k));
    const a2 = g * a1;
    const a3 = g * a2;
    const v3 = x - ic2;
    const v1 = a1 * ic1 + a2 * v3;
    const v2 = ic2 + a2 * ic1 + a3 * v3;
    ic1 = 2 * v1 - ic1;
    ic2 = 2 * v2 - ic2;
    return mode === 'low' ? v2 : mode === 'band' ? v1 : x - k * v1 - v2;
  };
}
const saw = (ph) => 2 * (ph - Math.floor(ph + 0.5));
const env = (t, a, d) => (t < a ? t / a : Math.exp(-(t - a) / d));

// ------------------------------------------------------------------ voices
const DUB = 0.16; // a heartbeat's second thump follows its first by this much
const voice = {
  kick(t0, v = 1) {
    let ph = 0;
    place(t0, 0.5, (t) => {
      ph += (48 + 140 * Math.exp(-t * 32)) / SR;
      const click = t < 0.004 ? noise() * (1 - t / 0.004) * 0.5 : 0;
      return (Math.sin(2 * Math.PI * ph) * Math.exp(-t * 7) + click) * v;
    }, { gain: 0.9 });
  },
  sub(t0, v = 1, dur = 1.6) {
    let ph = 0;
    const lp = svf(0.5);
    place(t0, dur, (t) => {
      ph += (34 + 46 * Math.exp(-t * 3)) / SR;
      const body = Math.sin(2 * Math.PI * ph) * Math.exp(-t * 1.8);
      const rumble = lp(noise(), 180) * Math.exp(-t * 4) * 1.4;
      return (body + rumble) * v;
    }, { gain: 1, send: 0.15 });
  },
  clap(t0, v = 1) {
    const bp = svf(0.9);
    place(t0, 0.3, (t) => {
      const burst = t < 0.03 ? (Math.floor(t / 0.009) % 2 ? 0.6 : 1) : 1;
      return bp(noise(), 1500, 'band') * Math.exp(-t * 18) * burst * v * 2.4;
    }, { gain: 0.5, send: 0.35 });
  },
  hat(t0, v = 1, pan = 0.25) {
    const hp = svf(0.6);
    place(t0, 0.06, (t) => hp(noise(), 7000, 'high') * Math.exp(-t * 90) * v, { gain: 0.22, pan });
  },
  bass(t0, note, dur, v = 1, cutoff = 900) {
    let ph = 0;
    const lp = svf(0.35);
    const f = midi(note);
    place(t0, dur, (t) => {
      ph += f / SR;
      const x = saw(ph) * 0.6 + saw(ph * 1.005) * 0.4;
      return lp(x, cutoff * (0.35 + Math.exp(-t * 9))) * env(t, 0.004, dur * 0.45) * v;
    }, { gain: 0.42 });
  },
  // A held chord. v and cutoff may be functions of how far through it is
  // (0..1), for a chord that swells or opens up as it goes.
  pad(t0, notes, dur, v = 1, cutoff = 1100, { attack = 0.6, release = 0.8 } = {}) {
    const level = typeof v === 'function' ? v : () => v;
    const fc = typeof cutoff === 'function' ? cutoff : () => cutoff;
    notes.forEach((n, k) => {
      const f = midi(n);
      const lp = svf(0.4);
      const ph = [0, 0.33, 0.66];
      place(t0, dur + release, (t) => {
        let x = 0;
        [-0.006, 0, 0.0071].forEach((d, j) => {
          ph[j] += (f * (1 + d)) / SR;
          x += saw(ph[j]);
        });
        const p = Math.min(1, t / dur);
        const a = Math.min(1, t / attack) * (t > dur ? Math.max(0, 1 - (t - dur) / release) : 1);
        return lp(x / 3, fc(p)) * a * level(p);
      }, { gain: 0.07, pan: (k / Math.max(1, notes.length - 1) - 0.5) * 0.7, send: 0.5 });
    });
  },
  // A soft bell: a sine and a quieter partial a twelfth up that dies sooner.
  bell(t0, note, v = 1, pan = 0) {
    const f = midi(note);
    let a = 0;
    let b = 0;
    place(t0, 1.8, (t) => {
      a += f / SR;
      b += (3 * f) / SR;
      const x = Math.sin(2 * Math.PI * a) * Math.exp(-t * 1.8) + Math.sin(2 * Math.PI * b) * 0.3 * Math.exp(-t * 7);
      return x * Math.min(1, t / 0.004) * v;
    }, { gain: 0.07, pan, send: 0.6 });
  },
  stab(t0, v = 1, notes = [57, 60, 64, 69]) {
    notes.forEach((n, k) => {
      const lp = svf(0.6);
      let ph = 0;
      const f = midi(n);
      place(t0, 0.7, (t) => {
        ph += f / SR;
        return lp(saw(ph) + (ph % 1 < 0.5 ? 0.4 : -0.4), 300 + 4200 * Math.exp(-t * 14)) * Math.exp(-t * 6) * v;
      }, { gain: 0.13, pan: (k - 1.5) * 0.25, send: 0.6 });
    });
    voice.kick(t0, 0.6 * v);
  },
  hit(t0, v = 1) {
    voice.kick(t0, v);
    const hp = svf(0.5);
    place(t0, 0.9, (t) => hp(noise(), 3000, 'high') * Math.exp(-t * 5) * v, { gain: 0.16, send: 0.5 });
    let ph = 0;
    place(t0, 0.5, (t) => {
      ph += (90 + 60 * Math.exp(-t * 20)) / SR;
      return Math.sin(2 * Math.PI * ph) * Math.exp(-t * 9) * v;
    }, { gain: 0.35, send: 0.3 });
  },
  whoosh(t0, v = 1, dur = 0.45) {
    const bp = svf(1.4);
    place(t0, dur, (t) => {
      const p = t / dur;
      return bp(noise(), 300 + 5200 * Math.sin(p * Math.PI) ** 2, 'band') * Math.sin(p * Math.PI) ** 2 * v;
    }, { gain: 0.5, pan: 0, send: 0.3 });
  },
  riser(t0, dur) {
    const bp = svf(1.1);
    let ph = 0;
    place(t0, dur, (t) => {
      const p = t / dur;
      ph += (180 + 900 * p * p) / SR;
      return (bp(noise(), 400 + 7000 * p * p, 'band') * 0.9 + Math.sin(2 * Math.PI * ph) * 0.25) * p * p;
    }, { gain: 0.45, send: 0.4 });
  },
  swell(t0) {
    const lp = svf(0.5);
    place(t0, 0.34, (t) => lp(noise(), 800 + 9000 * (t / 0.34)) * (t / 0.34) ** 2, { gain: 0.35, send: 0.4 });
  },
  heart(t0) {
    [0, DUB].forEach((d, k) => {
      let ph = 0;
      place(t0 + d, 0.25, (t) => {
        ph += (58 - 14 * t) / SR;
        return Math.sin(2 * Math.PI * ph) * Math.exp(-t * 16) * (k ? 0.7 : 1);
      }, { gain: 0.85 });
    });
  },
  beep(t0) {
    // A shot timer's start beep: a bright square-ish tone, ~0.3 s.
    let ph = 0;
    place(t0, 0.34, (t) => {
      ph += 3000 / SR;
      const sq = Math.tanh(Math.sin(2 * Math.PI * ph) * 3);
      const a = Math.min(1, t / 0.004) * (t > 0.3 ? Math.max(0, 1 - (t - 0.3) / 0.04) : 1);
      return sq * a;
    }, { gain: 0.17, send: 0.25 });
  },
  freeze(t0) {
    let ph = 0;
    const lp = svf(0.5);
    place(t0, 0.7, (t) => {
      ph += (420 * Math.exp(-t * 5)) / SR;
      return (saw(ph) * 0.6 + lp(noise(), 2000 * Math.exp(-t * 6)) * 0.5) * Math.exp(-t * 3);
    }, { gain: 0.35, send: 0.4 });
  },
  scan(t0) {
    let ph = 0;
    place(t0, 0.7, (t) => {
      ph += (1800 + 3800 * (t / 0.7)) / SR;
      return Math.sin(2 * Math.PI * ph) * Math.sin((t / 0.7) * Math.PI) * 0.4;
    }, { gain: 0.12, pan: -0.3, send: 0.6 });
  },
  blip(t0, v = 1) {
    let a = 0;
    let b = 0;
    place(t0, 0.12, (t) => {
      a += 1320 / SR;
      b += 1980 / SR;
      return (Math.sin(2 * Math.PI * a) + 0.5 * Math.sin(2 * Math.PI * b)) * Math.exp(-t * 40) * v;
    }, { gain: 0.16, pan: 0.3, send: 0.5 });
  },
  tick(t0, v = 1) {
    const bp = svf(2);
    place(t0, 0.03, (t) => bp(noise(), 3600, 'band') * Math.exp(-t * 200) * v * 3, { gain: 0.25, pan: -0.2 });
  },
  click(t0, v = 1) {
    const bp = svf(4);
    let ph = 0;
    place(t0, 0.07, (t) => {
      ph += 2650 / SR;
      return (bp(noise(), 4200, 'band') * Math.exp(-t * 300) * 2 + Math.sin(2 * Math.PI * ph) * Math.exp(-t * 70) * 0.5) * v;
    }, { gain: 0.5, pan: 0.15, send: 0.2 });
  },
  slide(t0, v = 1) {
    const bp = svf(1.6);
    place(t0, 0.09, (t) => bp(noise(), 2400 + 4000 * t, 'band') * Math.exp(-t * 35) * v * 2, { gain: 0.45, send: 0.2 });
    voice.click(t0 + 0.07, v);
  },
  shot(t0, v = 1) {
    // Crack, body and room: noise through falling filters plus a low thump.
    const lp = svf(0.5);
    const hp = svf(0.6);
    let ph = 0;
    place(t0, 0.7, (t) => {
      const n = noise();
      const crack = t < 0.006 ? hp(n, 4000, 'high') * 2.2 : 0;
      const body = lp(n, 900 + 6000 * Math.exp(-t * 40)) * Math.exp(-t * 16) * 1.4;
      ph += (75 * Math.exp(-t * 8) + 38) / SR;
      const thump = Math.sin(2 * Math.PI * ph) * Math.exp(-t * 14) * 0.9;
      return Math.tanh((crack + body + thump) * 1.6) * v;
    }, { gain: 0.62, pan: -0.05, send: 0.55 });
  },
  steel(t0) {
    const partials = [[1150, 1.0, 1.1], [2730, 0.6, 0.7], [4230, 0.4, 0.45], [6110, 0.25, 0.3]];
    const ph = partials.map(() => 0);
    place(t0, 1.4, (t) => {
      let x = t < 0.003 ? noise() * 0.8 : 0;
      partials.forEach(([f, a, d], k) => {
        ph[k] += f / SR;
        x += Math.sin(2 * Math.PI * ph[k]) * a * Math.exp(-t / d);
      });
      return x * 0.5;
    }, { gain: 0.3, pan: 0.25, send: 0.5 });
  },
  clank(t0, v = 1) {
    const lp = svf(0.8);
    let a = 0;
    let b = 0;
    place(t0, 0.35, (t) => {
      a += 190 / SR;
      b += 437 / SR;
      return (lp(noise(), 1200) * 0.8 + Math.sin(2 * Math.PI * a) * 0.6 + Math.sin(2 * Math.PI * b) * 0.4) * Math.exp(-t * 14) * v;
    }, { gain: 0.4, pan: 0.2, send: 0.3 });
  },
  brass(t0, v = 1) {
    [0, 0.07, 0.12, 0.16].forEach((d, k) => {
      let ph = 0;
      const f = 5200 + k * 900;
      place(t0 + d, 0.08, (t) => {
        ph += f / SR;
        return Math.sin(2 * Math.PI * ph) * Math.exp(-t * 60) * v * (1 - k * 0.2);
      }, { gain: 0.25, pan: 0.5, send: 0.2 });
    });
  },
  drop(t0) {
    voice.sub(t0, 1);
    voice.kick(t0, 1);
    voice.whoosh(t0 - 0.02, 0.4, 0.3);
  },
  logo(t0) {
    voice.sub(t0, 1.1, 2.5);
    voice.hit(t0, 1);
    voice.pad(t0, [45, 52, 57, 59, 64, 71], 2.6, 1.4, 2400);
  },
};

// Struck steel: inharmonic partials [Hz, level, decay s], each a slightly
// detuned pair so the ring shimmers, after a short bright strike.
function ring(t0, partials, dur, { gain, pan = 0, send = 0.4, strike = 0.6 }) {
  const ph = partials.map(() => [0, 0]);
  const hp = svf(0.7);
  place(t0, dur, (t) => {
    let x = t < 0.004 ? hp(noise(), 3500, 'high') * strike * (1 - t / 0.004) : 0;
    partials.forEach(([f, a, d], k) => {
      ph[k][0] += f / SR;
      ph[k][1] += (f * 1.0023) / SR;
      x += (Math.sin(2 * Math.PI * ph[k][0]) + Math.sin(2 * Math.PI * ph[k][1])) * 0.5 * a * Math.exp(-t / d);
    });
    return x;
  }, { gain, pan, send });
}
// A short knock: a noise burst through a resonance plus a decaying body tone.
function knock(t0, { f = 1200, k = 0.5, body = 120, bodyDecay = 30, len = 0.2, noiseDecay = 200, gain, pan = 0, send = 0.2 }) {
  const bp = svf(k);
  let ph = 0;
  place(t0, len, (t) => {
    ph += body / SR;
    return bp(noise(), f, 'band') * Math.exp(-t * noiseDecay) * 2 + Math.sin(2 * Math.PI * ph) * Math.exp(-t * bodyDecay);
  }, { gain, pan, send });
}
// Band-passed noise swept along a path: fc(p) and level(p) for p in 0..1.
function swish(t0, dur, fc, level, { k = 1.2, gain, pan = 0, send = 0.3 }) {
  const bp = svf(k);
  place(t0, dur, (t) => bp(noise(), fc(t / dur), 'band') * level(t / dur), { gain, pan, send });
}

// The stage's own voices. They take the cue as a third argument for its extra
// fields: pan (from the cue's target), k (which plate) and dur.
const stage = {
  // Paper: a dull, quiet thud of cardboard on its stick.
  paper(t0, v = 1, { pan = 0 } = {}) {
    const lp = svf(0.8);
    const bp = svf(1.1);
    let ph = 0;
    place(t0, 0.14, (t) => {
      const n = noise();
      ph += (150 + 90 * Math.exp(-t * 70)) / SR;
      const thud = Math.sin(2 * Math.PI * ph) * Math.exp(-t * 40);
      const slap = bp(n, 750, 'band') * Math.exp(-t * 60) * 2.2;
      const pap = t < 0.005 ? lp(n, 2500) * 0.8 : 0;
      return (thud + slap + pap) * v;
    }, { gain: 0.18, pan, send: 0.12 });
  },
  // A popper: a big plate, so a low, long ring.
  popper(t0, v = 1, { pan = 0 } = {}) {
    ring(t0, [[560, 1, 0.55], [1370, 0.55, 0.42], [2460, 0.38, 0.28], [3980, 0.22, 0.16]], 1.5, { gain: 0.16 * v, pan, send: 0.5 });
  },
  // ...that tips over and lands flat: a dead thump with a short clang.
  fall(t0, v = 1, { pan = 0 } = {}) {
    knock(t0, { f: 520, k: 0.9, body: 82, bodyDecay: 16, len: 0.4, noiseDecay: 45, gain: 0.3 * v, pan, send: 0.25 });
    ring(t0 + 0.004, [[330, 0.6, 0.12], [810, 0.4, 0.07]], 0.4, { gain: 0.12 * v, pan, strike: 0 });
  },
  // Metal plates: small, so a fast, high ping; each plate (k) a little apart
  // in pitch so a pair reads as two. They tip back onto the base with a tick.
  plates(t0, v = 1, { pan = 0, k = 0 } = {}) {
    const m = 1 + (k ?? 0) * 0.035;
    ring(t0, [[1780 * m, 1, 0.22], [4080 * m, 0.55, 0.13], [6830 * m, 0.32, 0.08]], 0.7, { gain: 0.17 * v, pan, send: 0.4, strike: 0.9 });
    knock(t0 + 0.2, { f: 2400, k: 0.6, body: 640, bodyDecay: 80, len: 0.07, noiseDecay: 220, gain: 0.05 * v, pan });
  },
  // A sear lets go: a sharp snap, the weight's clunk and a spring's twang.
  latch(t0, v = 1, { pan = 0 } = {}) {
    knock(t0, { f: 3800, k: 0.3, body: 1900, bodyDecay: 90, len: 0.05, noiseDecay: 380, gain: 0.14 * v, pan });
    knock(t0 + 0.014, { f: 700, k: 0.8, body: 135, bodyDecay: 20, len: 0.3, noiseDecay: 40, gain: 0.24 * v, pan, send: 0.3 });
    let ph = 0;
    place(t0 + 0.014, 0.6, (t) => {
      ph += (245 * (1 + 0.025 * Math.sin(2 * Math.PI * 11 * t))) / SR;
      return Math.sin(2 * Math.PI * ph) * Math.exp(-t * 7) * v;
    }, { gain: 0.05, pan, send: 0.4 });
  },
  // The swinger's pivot creaking as it turns round: stick-slip pulses through
  // two resonances.
  creak(t0, v = 1, { pan = 0 } = {}) {
    const r1 = svf(0.06);
    const r2 = svf(0.1);
    const dur = 0.24;
    let ph = 0;
    place(t0, dur, (t) => {
      const p = t / dur;
      const prev = ph;
      ph += (46 + 34 * p + noise() * 6) / SR;
      const x = Math.floor(ph) !== Math.floor(prev) ? 1 : 0;
      return (r1(x, 690, 'band') + r2(x, 1720, 'band') * 0.6) * Math.sin(Math.PI * p) ** 1.5 * v;
    }, { gain: 0.6, pan, send: 0.3 });
  },
  // The mover's carriage: the cable yanks its brake off with a heavy clank and
  // a rattle of the target on its stick.
  carriage(t0, v = 1, { pan = 0 } = {}) {
    knock(t0, { f: 1300, k: 0.5, body: 150, bodyDecay: 18, len: 0.35, noiseDecay: 70, gain: 0.2 * v, pan, send: 0.3 });
    ring(t0, [[380, 0.8, 0.09], [930, 0.6, 0.06], [2050, 0.35, 0.04]], 0.3, { gain: 0.1 * v, pan, strike: 0.8 });
    [0.05, 0.09, 0.14].forEach((d, j) =>
      knock(t0 + d, { f: 1700, k: 0.8, body: 420, bodyDecay: 90, len: 0.05, noiseDecay: 260, gain: 0.05 * v * 0.7 ** j, pan }),
    );
  },
  // ...and hitting the buffer at the end of the rail: a dead, heavy thud.
  buffer(t0, v = 1, { pan = 0 } = {}) {
    knock(t0, { f: 380, k: 1.0, body: 72, bodyDecay: 14, len: 0.45, noiseDecay: 35, gain: 0.26 * v, pan, send: 0.25 });
    knock(t0 + 0.01, { f: 1500, k: 0.7, body: 260, bodyDecay: 45, len: 0.12, noiseDecay: 160, gain: 0.07 * v, pan });
  },
  // The drop turner's panel swinging round.
  turn(t0, v = 1, { pan = 0, dur = 0.3 } = {}) {
    swish(t0, dur, (p) => 450 + 1300 * Math.sin(p * Math.PI), (p) => Math.sin(p * Math.PI) ** 2 * v, { gain: 0.32, pan, k: 1.4 });
  },
  // ...and hitting its stop.
  clack(t0, v = 1, { pan = 0 } = {}) {
    knock(t0, { f: 1500, k: 0.35, body: 105, bodyDecay: 26, len: 0.25, noiseDecay: 160, gain: 0.15 * v, pan });
    ring(t0, [[430, 0.7, 0.05], [1160, 0.5, 0.035]], 0.2, { gain: 0.08 * v, pan, strike: 0 });
  },
  // Reload: the slide locks back on the last round.
  lock(t0, v = 1) {
    ring(t0, [[3150, 1, 0.045], [5450, 0.5, 0.03], [1720, 0.45, 0.06]], 0.2, { gain: 0.09 * v, pan: -0.1, send: 0.2, strike: 1.2 });
  },
  // The magazine release clicks and the empty magazine slides out.
  magout(t0, v = 1) {
    knock(t0, { f: 4300, k: 0.4, body: 2100, bodyDecay: 120, len: 0.04, noiseDecay: 400, gain: 0.12 * v, pan: -0.1 });
    swish(t0 + 0.012, 0.13, (p) => 1600 + 2200 * p, (p) => Math.sin(p * Math.PI) * (1 - p * 0.4) * v, { gain: 0.24, pan: -0.15, k: 1.6, send: 0.15 });
  },
  // ...and hits the ground, with a small bounce.
  magdrop(t0, v = 1) {
    [0, 0.075].forEach((d, j) =>
      knock(t0 + d, { f: 1100, k: 0.7, body: 360, bodyDecay: 55, len: 0.12, noiseDecay: 70, gain: 0.16 * v * (j ? 0.45 : 1), pan: -0.25, send: 0.2 }),
    );
  },
  // A fresh magazine slides in and seats.
  magin(t0, v = 1) {
    swish(t0 - 0.07, 0.075, (p) => 1300 + 1600 * p, (p) => p * p * v, { gain: 0.22, pan: -0.1, k: 1.6, send: 0.1 });
    knock(t0, { f: 2700, k: 0.5, body: 165, bodyDecay: 32, len: 0.2, noiseDecay: 240, gain: 0.15 * v, pan: -0.1, send: 0.25 });
    ring(t0, [[1460, 0.8, 0.04], [2620, 0.5, 0.03]], 0.15, { gain: 0.07 * v, pan: -0.1, strike: 0 });
  },
  // The slide release is pressed and the slide slams home.
  slidefwd(t0, v = 1) {
    knock(t0 - 0.045, { f: 4100, k: 0.4, body: 2400, bodyDecay: 140, len: 0.03, noiseDecay: 450, gain: 0.08 * v, pan: -0.1 });
    swish(t0 - 0.03, 0.032, (p) => 2600 + 3000 * p, (p) => p * v, { gain: 0.24, pan: -0.1, k: 1.4, send: 0.1 });
    knock(t0, { f: 3300, k: 0.45, body: 125, bodyDecay: 30, len: 0.25, noiseDecay: 300, gain: 0.18 * v, pan: -0.1, send: 0.3 });
    ring(t0, [[2120, 1, 0.07], [3540, 0.6, 0.05], [5650, 0.4, 0.035]], 0.3, { gain: 0.08 * v, pan: -0.1, send: 0.3, strike: 0.8 });
  },
  // Into slow motion: a tape stop falls into the ramp, then a low boom and a
  // dark tail while the picture crawls. v = 1 - rate.
  slowmo(t0, v = 1) {
    const L = stopLength(t0, 1 - v);
    const lp = svf(0.5);
    const lp2 = svf(0.7);
    let ph = 0;
    let ph2 = 0;
    place(t0 - L, L + 1.1, (t) => {
      if (t < L) {
        const p = t / L;
        ph += (190 * (1 - 0.8 * p * p)) / SR;
        const x = lp(saw(ph) * 0.5 + saw(ph * 1.5) * 0.25 + noise() * 0.35, 2600 * (1 - 0.85 * p));
        return x * (0.25 + 0.75 * p);
      }
      const u = t - L;
      ph2 += (26 + 40 * Math.exp(-u * 3)) / SR;
      return Math.sin(2 * Math.PI * ph2) * Math.exp(-u * 2.8) + lp2(noise(), 260) * Math.exp(-u * 2.2) * 1.2;
    }, { gain: 0.16 + 0.3 * v, send: 0.5 });
  },
  // Into fast forward: a riser snaps up to the ramp, then a thin tape flutter
  // for as long as the picture runs fast.
  ffwd(t0, v = 1, { dur = 1 } = {}) {
    const pre = 0.32;
    const bp = svf(1.0);
    let ph = 0;
    place(t0 - pre, pre + 0.1, (t) => {
      const p = Math.min(1, t / pre);
      ph += (240 + 2100 * p * p) / SR;
      const x = bp(noise(), 500 + 6800 * p * p, 'band') + Math.sin(2 * Math.PI * ph) * 0.25;
      return x * (t < pre ? p * p : Math.exp(-(t - pre) * 45)) * v;
    }, { gain: 0.36, send: 0.35 });
    const bp2 = svf(0.9);
    place(t0, dur, (t) => {
      const flutter = 0.65 + 0.35 * Math.sin(2 * Math.PI * 13 * t);
      const a = Math.min(1, t / 0.06, (dur - t) / 0.12);
      return bp2(noise(), 3600 + 700 * Math.sin(2 * Math.PI * 3 * t), 'band') * flutter * a * v;
    }, { gain: 0.07, send: 0.2 });
  },
  // A camera cut: a soft swish across the stereo field, peaking mid-move.
  cut(t0, v = 1, { dur = 0.4, pan = 0.3 } = {}) {
    swish(t0, dur, (p) => 420 + 2300 * Math.sin(p * Math.PI) ** 2, (p) => Math.sin(p * Math.PI) ** 2 * v, {
      gain: 0.19,
      pan: (t) => pan * ((2 * t) / dur - 1),
      k: 1.5,
      send: 0.35,
    });
  },
};
Object.assign(voice, stage);

// ------------------------------------------------------------------- music
const AM = [57, 60, 64];
const F = [53, 57, 60];
const C = [55, 60, 64];
const G = [55, 59, 62];
const E = [52, 56, 59, 64]; // the dominant, under the course walk
const ROOT = new Map([[AM, 33], [F, 29], [C, 36], [G, 31]]);
// Music is laid out section by section on the final timeline, between cues
// found by type; I() maps a time of the original cut onto it where a section
// needs one the cues do not give. The picture slows some scenes down so their
// words can be read and plays two inserted chapters (the Divisions chapter
// right after the motto, the course walk before the stage), but the beats
// always run at BEAT on the final timeline, so the tempo never drags.
const I = MARKS.ins;
const DIVI = MARKS.inserts.find((x) => x.kind === 'divisions');
const FLY = MARKS.inserts.find((x) => x.kind === 'flyover'); // the course walk
const DIV_END = DIVI.at + DIVI.dur;
const FLY_END = FLY.at + FLY.dur;
const S = MARKS.shift;
// the final times of the cues of a type in [a, b)
const cuesOf = (type, a, b) => CUES.filter((c) => c.type === type && c.t >= a - 1e-6 && c.t < b).map((c) => c.t);
// n mod m, also for a step before its anchor (n < 0)
const mod = (n, m) => ((n % m) + m) % m;

// The grooves lock to the picture. A cue that carries its own kick (a stab on
// a command, a hit, a drop, the logo, the heartbeat, the boom into slow
// motion) is a beat the viewer sees, so each groove runs at BEAT from such a
// cue, or into one, as a pick-up that lands on it; where the picture's beats
// are not a whole number of beats apart it starts again from the next one.
// No groove kick plays within KICK_CLEAR s of one of these cues (the cue's
// own kick stands in for a beat that lands on it, and one just before or
// after it would stumble into it), and no other groove note within CLEAR s
// of one unless it is on it: no flams. A heartbeat's second thump counts as
// a cue of its own.
const CLEAR = 0.12;
const KICK_CLEAR = 0.2;
const KICKS = CUES.flatMap((c) =>
  c.type === 'heart' ? [c.t, c.t + DUB] : ['hit', 'stab', 'drop', 'logo', 'slowmo'].includes(c.type) ? [c.t] : [],
);
const free = (t) => KICKS.every((k) => Math.abs(k - t) >= CLEAR || Math.abs(k - t) < 1e-3);
const kick = (t, v) => KICKS.every((k) => Math.abs(k - t) >= KICK_CLEAR) && voice.kick(t, v);
// The steps of a groove anchored at `at` that fall in [from, to), as
// { t, n, whole, hold, room } with n counted from the anchor: negative
// before it, for a pick-up anchored on the cue it lands on. `at` may also be
// a list of anchors, for a groove that starts again from each in turn and
// runs up to the next; each step then also carries k, its anchor's index.
// Steps that would flam a cue are left out, and so is any within CLEAR of
// the end of its run, where the next grid takes over (so a groove that ends
// on the next one's anchor leaves that beat to it). Where the picture's
// beats are not a whole number of steps apart, the step before the next
// grid runs long: whole is false for a step with less than a full step left
// before it (kicks and claps skip it), hold is how long a note on the step
// lasts, up to the next grid for the last whole one, and room is all the
// time there is before it.
function grid(at, from, to, step = BEAT) {
  if (Array.isArray(at)) {
    const anchors = [...at].sort((p, q) => p - q);
    return anchors.flatMap((a, k) =>
      grid(a, Math.max(a, from), Math.min(anchors[k + 1] ?? to, to), step).map((s) => ({ ...s, k })),
    );
  }
  const out = [];
  for (let n = Math.ceil((from - at - 1e-3) / step); at + n * step < to - CLEAR; n++) {
    const t = at + n * step;
    const room = to - t;
    if (free(t)) out.push({ t, n, whole: room > step - 0.03, hold: room < 2 * step - 0.03 ? room : step, room });
  }
  return out;
}

// The motto: the pad comes up under its three slams, and a pulse on the
// grid of the last one, a bass note a beat and a soft kick every two, grows
// into the Divisions chapter; the blinds close over the motto on the beat
// before it, which runs long into the chapter's own downbeat.
voice.pad(0, AM, DIVI.at, 0.8, 700);
{
  const slam = cuesOf('hit', 0, DIVI.at).pop();
  for (const { t, n, whole, hold } of grid(slam, slam + BEAT, DIVI.at)) {
    if (!whole) continue;
    const p = (t - slam) / (DIVI.at - slam);
    if (n % 2 === 0) kick(t, 0.3 + 0.25 * p);
    voice.bass(t, 33, hold, 0.35 + 0.3 * p, 220 + 260 * p);
  }
}

// The Divisions chapter: a lighter groove under the equipment morphs that
// starts again as each division lands, so its name is a downbeat and the
// chord changes with it (where a division holds for more than a whole
// number of beats, its last beat holds on); the chapter's title is the
// first, on the cut from the motto. It stops under the line-up's whoosh, and
// the line-up's hit brings it back, in A minor, through the blinds out of
// the chapter up to MAKE READY's stab.
{
  const [open] = cuesOf('stab', DIVI.at, DIV_END);
  const [lineup] = cuesOf('hit', DIVI.at, DIV_END);
  const brk = cuesOf('whoosh', open, lineup).pop() ?? lineup;
  const [ready] = cuesOf('stab', DIV_END, DURATION);
  // the divisions before Open land with a cue each (a part seating follows
  // its entrance by 0.25-0.3 s); the title's own whoosh is not one of them
  const marks = CUES.filter((c) => c.t > DIVI.at + 1 && c.t < open);
  const entrances = marks.filter((c, i) => i === 0 || c.t - marks[i - 1].t > 0.4).map((c) => c.t);
  const bars = [DIVI.at, ...entrances, open, lineup];
  const chords = [F, C, G, AM, F, G, AM];
  bars.forEach((at, k) => {
    const next = bars[k + 1] ?? ready;
    const to = next === lineup ? brk : next;
    const chord = chords[Math.min(k, chords.length - 1)];
    voice.pad(at, chord, next - at, 0.85, 900);
    for (const { t, n, whole, hold } of grid(at, at, to)) {
      if (!whole) continue;
      if (n % 2 === 0) kick(t, 0.6);
      if (n % 4 === 2) voice.clap(t, 0.45);
      voice.bass(t, ROOT.get(chord), hold, 0.55, 700);
    }
    for (const { t, n } of grid(at, at, to, BEAT / 2)) if (n % 2) voice.hat(t, 0.5);
  });
}

// The range commands, as the blinds open after the chapter: a build on A
// from MAKE READY to the start signal. Each command's stab starts a bar (they
// land more than a whole number of beats apart, so the beat before each runs
// long); the kick gives way halfway, and STANDBY's heartbeat takes over the
// pulse, quicker than the beat: a bass note and a hat on each of its beats,
// around its double thump, up to the breath before the beep, where STANDBY's
// riser peaks.
{
  const [beep] = cuesOf('beep', DIV_END, DURATION);
  const stabs = cuesOf('stab', DIV_END, beep);
  const anchors = [...stabs, ...cuesOf('heart', DIV_END, beep)];
  const a = stabs[0];
  const riser = CUES.find((c) => c.type === 'riser' && c.t >= stabs.at(-1) && c.t < beep);
  const b = riser ? riser.t + riser.dur : I(5.87);
  voice.pad(a, AM, beep - a, 0.8, 700);
  for (const { t, whole } of grid(anchors, a, b)) if (whole && t < I(4)) kick(t, 0.45);
  for (const { t, n, k, whole, hold } of grid(anchors, a, b, BEAT / 2)) {
    // a heartbeat's note holds up to the next, whole beat or not
    if (whole || (k >= stabs.length && n === 0)) voice.bass(t, 33, hold, 0.7, 260 + ((t - a) / (b - a)) * 450);
  }
  for (const { t, n } of grid(anchors, a, b, BEAT / 4)) voice.hat(t, n % 2 ? 0.35 : 0.6);
}

// The start signal, the sights, and targets and scoring. The beep's drop is
// a downbeat with a kick a beat after it, and the frozen clock holds on a
// chord. The split's hit starts the sights' groove (a kick a second, a bass
// note every two, soft hats between), in A minor, and F as the sights settle
// (on its grid, by the click). The first dry recoil lands on a beat of the
// scoring hit's grid, and the groove runs on that from there, into C on the
// next bar line, so that the blinds hand the sights over to the scoring hit
// on the beat. The blinds play at speed and the table slowed down, so the
// first zone lights a beat and a quarter after the hit: the hit's beat holds
// into it, and from there the groove runs on the grid of the course walk's
// hit, on whose beat the first zone lights (the zones and the cards come a
// beat and a half apart), into the G on the next bar line, and lands on the
// walk's hit as the push peaks.
{
  const [beep] = cuesOf('beep', I(5.9), I(6.1));
  const [split] = cuesOf('hit', I(7.9), I(8.1));
  const [score] = cuesOf('hit', I(12.9), I(13.5));
  const [walk] = cuesOf('hit', FLY.at, FLY.at + 0.01);
  const [click] = cuesOf('click', split, score); // as the sights settle
  const settle = split + Math.round((click - split) / BEAT) * BEAT;
  const [dry] = cuesOf('whoosh', settle, score); // the first dry recoil
  const recoil = score - Math.round((score - dry) / BEAT) * BEAT;
  const turn = recoil + 4 * BEAT;
  const [lit] = cuesOf('blip', score, walk);
  const zone = walk - Math.round((walk - lit) / BEAT) * BEAT; // the first zone, on the walk's grid
  const change = zone + Math.round((I(14) - zone) / (4 * BEAT)) * 4 * BEAT;
  kick(beep + BEAT, 0.9);
  voice.pad(beep, AM, split - beep, 1, 1400);
  voice.pad(split, AM, settle - split, 0.9, 600);
  voice.pad(settle, F, turn - settle, 0.9, 600);
  voice.pad(turn, C, change - turn, 0.9, 600);
  voice.pad(change, G, walk - change, 0.9, 600, { release: 0.4 });
  const anchors = [split, settle, recoil, score, zone];
  for (const { t, n, whole, room } of grid(anchors, split, walk)) {
    if (!whole) continue;
    if (n % 2 === 0) kick(t, 0.55);
    if (n % 4 === 0) voice.bass(t, t < settle ? 33 : t < turn ? 29 : 31, Math.min(1.8, room), 0.5, 300);
  }
  for (const { t, n } of grid(anchors, split, walk, BEAT / 2)) if (n % 2) voice.hat(t, 0.3);
}

// The course walk: a held E, the dominant, swells and opens up over the walk
// into the A minor the stage lands on, over a pedal that builds as it goes:
// an eighth-note bass, a soft kick every two beats and then every beat, hats
// coming in on the off-beats and then in sixteenths. The walk is not a whole
// number of beats long, and its hit lands on the scoring groove's beat, so
// the pedal runs on the stage drop's grid, as a pick-up that lands on the
// drop: the walk's hit holds a beat and a fifth into it.
{
  const at = FLY.at;
  const [drop] = cuesOf('drop', FLY_END, FLY_END + 0.01);
  const p = (t) => (t - at) / (drop - at);
  voice.pad(at, E, drop - at, (q) => 0.55 + 0.65 * q * q, (q) => 450 * 7 ** q, { release: 0.12 });
  for (const { t, n, whole } of grid(drop, at, drop)) if (whole && (n % 2 === 0 || p(t) > 0.75)) kick(t, 0.35 + 0.3 * p(t));
  for (const { t, hold } of grid(drop, at, drop, BEAT / 2)) voice.bass(t, 28, hold, 0.4 + 0.3 * p(t), 250 + 850 * p(t) ** 2);
  for (const { t, n } of grid(drop, at, drop, BEAT / 4)) {
    if ((mod(n, 4) === 2 && p(t) > 0.3) || (n % 2 && p(t) > 0.7)) voice.hat(t, (n % 2 ? 0.25 : 0.4) + 0.3 * p(t));
  }
}

// The stage: its length comes from the shot list, and everything after it is
// moved by MARKS.shift so it stays on the beat grid. Its drums run on the
// stage drop's grid and follow the speed ramps: half time in slow motion,
// sixteenth hats while fast-forwarding. The boom into each slow ramp is a
// downbeat the grid starts again from (the tape stop into the ramp covers the
// jump). The chords go round once up to the reload, and again with the
// picture after it: A minor on the boom into the drone's held shot over area
// C, F on the next downbeat after it lets go into the mover (the boom into
// the slower ramp there, when there is one), G on the next once the picture
// is back at speed for the low port, and A minor again on the last shot's
// bullet time, which holds still up to the hit factor's pick-up.
const STAGE_OUT = I(19.75 + S);
const LAND = cuesOf('hit', I(19.9 + S), I(21 + S)).pop(); // the hit factor lands...
const SLAM = cuesOf('hit', I(19.9 + S), LAND - 1e-3)[0] ?? LAND; // ...just after the operators slam
const HF_FROM = SLAM - Math.ceil((SLAM - STAGE_OUT) / BEAT) * BEAT; // the pick-up's first beat
{
  const [drop] = cuesOf('drop', MARKS.resume, MARKS.resume + 0.01);
  const anchors = [drop, ...cuesOf('slowmo', drop, HF_FROM)];
  // a time moved onto the grid in force there
  const snap = (t) => {
    const a = anchors.findLast((x) => x <= t + BEAT / 2);
    return a + Math.round((t - a) / BEAT) * BEAT;
  };
  const rampAt = (t) => MARKS.ramps.find(([a]) => Math.abs(a - t) < 1e-6);
  const hold = anchors.find((a) => a > videoOf(MARKS.events.reload.at(-1))) ?? anchors.at(-1);
  const last = anchors.at(-1);
  // where the slow motion from `hold` ends: its first ramp, then the whole run
  const [, letGo] = rampAt(hold);
  let back = letGo;
  for (let r; (r = rampAt(back)) && r[2] < 1; ) back = r[1];
  // the next half-time downbeat (an even beat on the grid in force there)
  const bar = (t) => {
    const a = anchors.findLast((x) => x <= t + 1e-6);
    return a + Math.ceil((t - a) / (2 * BEAT) - 1e-6) * 2 * BEAT;
  };
  const chords = [
    ...[[16, AM], [20, F], [22, C], [24, G]].map(([t, n]) => [snap(I(t)), n]),
    [hold, AM],
    [bar(letGo), F],
    [bar(back), G],
    [last, AM],
  ].filter(([t], k, all) => k === 0 || (t > all[k - 1][0] + BEAT && t < HF_FROM));
  chords.forEach(([t, n], k) => voice.pad(t, n, (chords[k + 1]?.[0] ?? HF_FROM) - t, 1, 1500));
  anchors.forEach((at, k) => {
    // the last bullet time's groove ends with it: the pick-up takes over
    const ramp = rampAt(at);
    const to = anchors[k + 1] ?? (ramp?.[2] < 0.1 ? Math.min(ramp[1], HF_FROM) : HF_FROM);
    for (const { t, n } of grid(at, at, to, BEAT / 4)) {
      const rate = rateAt(t);
      const beat = n / 4;
      const on = n % 4 === 0;
      // kicks and claps want a whole beat before the next grid, the bass an eighth
      const whole = to - t > BEAT - 0.03;
      const eighth = to - t > BEAT / 2 - 0.03;
      if (rate < 0.1) {
        // bullet time: a single held heartbeat
        if (on && beat % 4 === 0 && whole) kick(t, 0.5);
        continue;
      }
      if (rate < 1) {
        if (!on || !eighth) continue;
        if (beat % 2 === 0 && whole) kick(t, 0.75);
        if (beat % 4 === 2 && whole) voice.clap(t, 0.6);
        voice.bass(t, 33, Math.min(BEAT, to - t), 0.6, 500);
        continue;
      }
      if (on && whole) kick(t, 0.85);
      if (on && whole && beat % 2 === 1) voice.clap(t, 0.8);
      if (n % 4 === 2) voice.hat(t, 0.8);
      if (rate > 1 && n % 2) voice.hat(t, 0.45);
      if (n % 2 === 0 && eighth) voice.bass(t, beat % 8 < 4 ? 33 : 29, BEAT / 2, 0.85, rate > 1 ? 1800 : 1200);
    }
  });
}

// The hit factor: the operators slam and the hit factor lands 2/3 of a beat
// later, so each is a downbeat: the pick-up out of the stage runs on the
// slam's grid, and the groove on the landing's, going from F to G two beats
// after it, up to the first range command.
{
  const [next] = cuesOf('stab', I(22 + S), I(25 + S));
  const change = LAND + 2 * BEAT;
  voice.pad(HF_FROM, F, change - HF_FROM, 1, 1300);
  voice.pad(change, G, next - change, 1, 1300);
  for (const [at, from, to] of [[SLAM, HF_FROM, LAND], [LAND, LAND, next]]) {
    for (const { t, whole } of grid(at, from, to)) if (whole) kick(t, 0.7);
    for (const { t, n, whole, hold } of grid(at, from, to, BEAT / 2)) {
      if (n % 2) voice.hat(t, 0.6);
      if (whole) voice.bass(t, t < change - 1e-3 ? 29 : 31, hold, 0.7, 900);
    }
  }
}

// Range is clear: each command's stab starts a bar (they land more than a
// whole number of beats apart, so each bar's last beat runs long), on Am, F
// and Am again, and the groove eases off bar by bar: the kick goes after the
// first, and RANGE IS CLEAR holds, its chord swelling and opening up over a
// long bass note, with no beat for the logo to miss, through the iris into
// the end card.
const [LOGO] = cuesOf('logo', I(24 + S), DURATION);
{
  const stabs = cuesOf('stab', I(22 + S), I(25 + S));
  const chords = [[AM, 33], [F, 29], [AM, 33]];
  stabs.forEach((at, k) => {
    const to = stabs[k + 1] ?? LOGO;
    const [chord, note] = chords[Math.min(k, chords.length - 1)];
    if (k === stabs.length - 1) {
      voice.pad(at, chord, to - at, (q) => 0.8 + 1.4 * q * q, (q) => 900 * 3.5 ** q, { release: 0.4 });
      voice.bass(at, note, to - at + 0.3, 0.6, 450);
      return;
    }
    voice.pad(at, chord, to - at, 0.8, 900);
    for (const { t, whole } of grid(at, at, to)) if (k === 0 && whole) kick(t, 0.5);
    for (const { t, n, whole, hold } of grid(at, at, to, BEAT / 2)) {
      if (n % 2) voice.hat(t, 0.45);
      if (whole) voice.bass(t, note, hold, 0.55, 700);
    }
  });
}

// The end card: the logo's chord carries on as a closing pad under the
// credit, A minor to F and home, a bar each on the logo's grid, with a bass
// note under each chord and a soft bell on the beats, until the reel fades
// out with the picture at DURATION.
const FADE = 1.4; // the master fade-out, ending at DURATION
{
  const bar = 4 * BEAT;
  const AM9 = [45, 52, 57, 59, 64];
  const FM7 = [41, 53, 57, 60, 64];
  const last = DURATION - (LOGO + 2 * bar);
  [[AM9, 33, bar], [FM7, 29, bar], [AM9, 33, last]].forEach(([chord, note, dur], k) => {
    const t = LOGO + k * bar;
    voice.pad(t, chord, dur, 0.9, 1300 - 150 * k, { attack: k ? 0.6 : 1.5 });
    voice.bass(t, note, dur, 0.45, 350);
  });
  const bells = [[0, 0, 76, 72], [69, 72, 77, 72], [69, 72, 76, 71]];
  for (const { t, n } of grid(LOGO, LOGO + 2 * BEAT, DURATION - FADE)) {
    const note = bells[Math.min(Math.floor(n / 4), bells.length - 1)][n % 4];
    if (note) voice.bell(t, note, 0.9 - 0.04 * n, n % 2 ? 0.25 : -0.25);
  }
}

// ------------------------------------------------------------------ cues
// Sounds of the world play through the speed ramps like tape, slowed or sped
// up with the picture; the ramp cues are the transition itself and are not.
target = fx;
for (const cue of CUES) {
  const fn = voice[cue.type];
  if (!fn) throw new Error(`No voice for cue ${cue.type}`);
  speed = cue.type === 'slowmo' || cue.type === 'ffwd' ? 1 : vari(cue.t);
  if (cue.type === 'riser') fn(cue.t, cue.dur);
  else if (cue.type in stage) fn(cue.t, cue.v ?? 1, { ...cue, pan: cue.target ? panOf(cue.target, cue.k) : 0 });
  else fn(cue.t, cue.v ?? 1);
}
speed = 1;

// ----------------------------------------------------------- moving targets
// Sampled in stage time like the picture (see swingAngle in reel.js), so the
// ramps stretch and squeeze them too. Targets are found by kind and timed from
// EVENTS, so a stage without one of them simply has no such sound.
const EV = MARKS.events;
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const STAGE_OUT_ST = stageOf(MARKS.stageEnd + 0.9); // stage time as the stage scene leaves

// The swinger: a soft whoosh through the bottom of every swing, loudest where
// it moves fastest, and a pivot creak at each turnaround, both dying away with
// the damping; it follows the target across the stereo field. It is the shot
// until the shooter leaves its area, then sits back and fades out.
const SWINGER = keyOf('swinger');
if (SWINGER) {
  const { theta0, period, damping } = MARKS.swinger;
  const rel = EV.swingerRelease;
  const w0 = (2 * Math.PI) / period;
  const theta = (tau) => theta0 * Math.cos(w0 * tau) * Math.exp(-damping * tau);
  const omega = (tau) => theta0 * Math.exp(-damping * tau) * (-w0 * Math.sin(w0 * tau) - damping * Math.cos(w0 * tau));
  const move = EV.moves.find(([a, , from]) => from === TARGETS[SWINGER].from && a > rel);
  const [leave, away] = move ?? [Infinity, Infinity];
  const end = Math.min(away + 2, STAGE_OUT_ST);
  const focus = (st) => (st < leave ? 1 : st < away ? 1 - 0.65 * ((st - leave) / (away - leave)) : 0.35 * clamp((end - st) / (end - away)));
  const base = panOf(SWINGER);
  const panAt = (st) => base + 0.4 * Math.sin(theta(st - rel));
  const t0 = videoOf(rel);
  const t1 = videoOf(end);
  const bp = svf(1.1);
  const lp = svf(0.7);
  place(t0, t1 - t0, (t) => {
    const T = t0 + t;
    const st = stageOf(T);
    const s = Math.abs(omega(st - rel)) / (theta0 * w0);
    const k = vari(T);
    const x = bp(noise(), (280 + 1500 * s) * k, 'band') + lp(noise(), 240 * k) * 0.6;
    return x * s * s * focus(st) * Math.min(1, t / 0.08);
  }, { gain: 0.2, pan: (t) => panAt(stageOf(t0 + t)), send: 0.35 });
  let prev = omega(0.001);
  for (let tau = 0.002; rel + tau < end; tau += 0.001) {
    const o = omega(tau);
    if (Math.sign(o) !== Math.sign(prev)) {
      const T = videoOf(rel + tau);
      speed = vari(T);
      voice.creak(T - 0.12 / speed, (Math.abs(theta(tau)) / theta0) * focus(rel + tau), { pan: panAt(rel + tau) });
      speed = 1;
    }
    prev = o;
  }
}

// The mover: its cable yanks the carriage free with a clank at moverRelease,
// then it runs along the rail at constant speed through EVENTS.mover — a low
// rumble, the wheels' whirr and a tick at each rail joint, slowed and lowered
// with the picture in slow motion — and hits the buffer with a thud. It crosses
// from left to right as the shooter sees it (see moverOffset), and so does its sound.
const MOVER = keyOf('mover');
if (MOVER && EV.mover) {
  const { start, dur } = EV.mover;
  const panAt = (st) => panOf(MOVER) + 0.3 * (2 * clamp((st - start) / dur) - 1);
  const tr = videoOf(EV.moverRelease ?? start);
  speed = vari(tr);
  voice.carriage(tr, 1, { pan: panAt(start) });
  const t0 = videoOf(start);
  const t1 = videoOf(start + dur);
  const lp = svf(0.6);
  const bp = svf(0.9);
  const rs = svf(0.08);
  let hum = 0;
  let wheel = 0;
  let joint = 0;
  place(t0, t1 - t0, (t) => {
    const T = t0 + t;
    const k = vari(T);
    const st = stageOf(T);
    hum += (55 * k) / SR;
    wheel += (21 * k) / SR;
    const j = Math.floor((st - start) / 0.17);
    const click = j !== joint ? 1 : 0;
    joint = j;
    const whirr = bp(noise(), 820 * k, 'band') * (0.7 + 0.3 * Math.sin(2 * Math.PI * wheel));
    const x = lp(noise(), 150 * k) * 1.4 + whirr * 0.6 + Math.sin(2 * Math.PI * hum) * 0.25 + rs(click, 2100 * k, 'band') * 0.5;
    return x * Math.min(1, t / 0.15, (t1 - T) / 0.015);
  }, { gain: 0.16, pan: (t) => panAt(stageOf(t0 + t)), send: 0.25 });
  speed = vari(t1);
  voice.buffer(t1, 1, { pan: panAt(start + dur) });
  speed = 1;
}

// Camera cuts: a soft swish through each move, swinging left or right in turn
// and kept clear of the next shot (starting earlier instead of running into it).
// A hard cut gets a short rise that stops on the cut instead.
(MARKS.cuts ?? []).forEach(([at, dur, rig], i) => {
  if (dur < 0.01) {
    swish(at - 0.16, 0.16, (p) => 700 + 2600 * p * p, (p) => p * p * 0.8, { gain: 0.24, k: 1.5, send: 0.35 });
    return;
  }
  const next = SHOTS.find((s) => s.t > at)?.t ?? Infinity;
  const end = Math.min(at + dur + 0.1, next - 0.035);
  const start = Math.min(at - 0.04, end - 0.3);
  voice.cut(start, rig === 'overview' ? 0.9 : 0.75, { dur: end - start, pan: i % 2 ? 0.35 : -0.35 });
});

// --------------------------------------------------------------- music bus
// Tape stops into slow motion: in the last moments before each slow ramp the
// music is read back slower and slower (deeper the slower the ramp), then
// picks up again at the new tempo.
for (const [a, , rate] of MARKS.ramps) {
  if (rate >= 1) continue;
  // speeding up out of bullet time is not another stop
  if (MARKS.ramps.some(([, b, r]) => Math.abs(b - a) < 1e-6 && r < rate)) continue;
  const n = Math.round(stopLength(a, rate) * SR);
  const floor = rate ** 1.5;
  const i1 = Math.round(a * SR);
  const i0 = i1 - n;
  for (const ch of [...music.dry, ...music.wet]) {
    const src = ch.slice(i0, i1 + 1);
    let pos = 0;
    for (let i = 0; i < n; i++) {
      const p = i / n;
      const j = Math.floor(pos);
      const fade = Math.min(1, (n - i) / (0.012 * SR));
      ch[i0 + i] = (src[j] + (src[j + 1] - src[j]) * (pos - j)) * (1 - 0.35 * p * p) * fade;
      pos += 1 - (1 - floor) * p * p;
    }
    for (let i = 0; i < 0.03 * SR; i++) ch[i1 + i] *= i / (0.03 * SR);
  }
}
// Duck the music a little under every shot so the shots punch through.
{
  const g = new Float32Array(N).fill(1);
  for (const s of SHOTS) {
    const i0 = Math.round((s.t - 0.005) * SR);
    for (let i = 0; i < 0.6 * SR && i0 + i < N; i++) {
      const u = i / SR - 0.005;
      g[i0 + i] = Math.min(g[i0 + i], 1 - 0.3 * (u < 0 ? 1 + u / 0.005 : Math.exp(-u / 0.14)));
    }
  }
  for (const ch of [...music.dry, ...music.wet]) for (let k = 0; k < N; k++) ch[k] *= g[k];
}
const dry = [0, 1].map((c) => music.dry[c].map((x, k) => x + fx.dry[c][k]));
const wet = [0, 1].map((c) => music.wet[c].map((x, k) => x + fx.wet[c][k]));

// ------------------------------------------------------------------ reverb
// Freeverb-style: parallel damped combs into series allpasses, per channel.
function reverb(input, offset) {
  const out = new Float32Array(N);
  const combs = [1557, 1617, 1491, 1422, 1277, 1356].map((d) => ({ buf: new Float32Array(d + offset), i: 0, store: 0 }));
  const alls = [556, 441, 341].map((d) => ({ buf: new Float32Array(d + offset), i: 0 }));
  for (let k = 0; k < N; k++) {
    let s = 0;
    for (const c of combs) {
      const y = c.buf[c.i];
      c.store = y * 0.75 + c.store * 0.25;
      c.buf[c.i] = input[k] * 0.015 + c.store * 0.86;
      c.i = (c.i + 1) % c.buf.length;
      s += y;
    }
    for (const a of alls) {
      const b = a.buf[a.i];
      a.buf[a.i] = s + b * 0.5;
      a.i = (a.i + 1) % a.buf.length;
      s = b - s;
    }
    out[k] = s;
  }
  return out;
}
const rv = [reverb(wet[0], 0), reverb(wet[1], 23)];

// ------------------------------------------------------------------- master
const mix = [new Float32Array(N), new Float32Array(N)];
let peak = 0;
for (let ch = 0; ch < 2; ch++) {
  for (let k = 0; k < N; k++) {
    const t = k / SR;
    const fadeOut = t > DURATION - FADE ? Math.max(0, (DURATION - t) / FADE) : 1;
    const v = Math.tanh((dry[ch][k] + rv[ch][k] * 0.9) * 1.1) * fadeOut;
    mix[ch][k] = v;
    peak = Math.max(peak, Math.abs(v));
  }
}
const norm = 0.89 / peak;
const data = Buffer.alloc(N * 4);
for (let k = 0; k < N; k++) {
  data.writeInt16LE(Math.round(mix[0][k] * norm * 32767), k * 4);
  data.writeInt16LE(Math.round(mix[1][k] * norm * 32767), k * 4 + 2);
}
const header = Buffer.alloc(44);
header.write('RIFF', 0);
header.writeUInt32LE(36 + data.length, 4);
header.write('WAVEfmt ', 8);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20);
header.writeUInt16LE(2, 22);
header.writeUInt32LE(SR, 24);
header.writeUInt32LE(SR * 4, 28);
header.writeUInt16LE(4, 32);
header.writeUInt16LE(16, 34);
header.write('data', 36);
header.writeUInt32LE(data.length, 40);
const out = process.argv[2] ?? 'reel.wav';
await writeFile(out, Buffer.concat([header, data]));
console.log(`Wrote ${out} (${(N / SR).toFixed(1)} s, peak normalised from ${peak.toFixed(2)})`);
