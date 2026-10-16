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
const N = Math.ceil((DURATION + 0.5) * SR);
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
  pad(t0, notes, dur, v = 1, cutoff = 1100) {
    notes.forEach((n, k) => {
      const f = midi(n);
      const lp = svf(0.4);
      const ph = [0, 0.33, 0.66];
      place(t0, dur + 0.8, (t) => {
        let x = 0;
        [-0.006, 0, 0.0071].forEach((d, j) => {
          ph[j] += (f * (1 + d)) / SR;
          x += saw(ph[j]);
        });
        const a = Math.min(1, t / 0.6) * (t > dur ? Math.max(0, 1 - (t - dur) / 0.8) : 1);
        return lp(x / 3, cutoff) * a * v;
      }, { gain: 0.07, pan: (k / Math.max(1, notes.length - 1) - 0.5) * 0.7, send: 0.5 });
    });
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
    [0, 0.16].forEach((d, k) => {
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
    const L = 0.22 + 0.25 * v;
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
// Music is written against the original cut; I() maps those times onto the
// final timeline, which adds the Divisions chapter and the course walk.
const I = MARKS.ins;
const [DIVI, FLYI] = MARKS.inserts;
voice.pad(0, AM, 6.0, 0.8, 700);
voice.pad(6.0, AM, 2.0, 1, 1400);
[[8, AM], [10, F], [12, C]].forEach(([t, n]) => voice.pad(t, n, Math.min(2.0, DIVI.at - t), 0.9, 600));
[[14, G]].forEach(([t, n]) => voice.pad(I(t), n, 2.0, 0.9, 600));
// The Divisions chapter: a lighter groove under the equipment morphs.
{
  const prog = [F, C, G, AM];
  for (let k = 0, t = DIVI.at; t < DIVI.at + DIVI.dur - 0.5; k++, t += 3) voice.pad(t, prog[k % 4], Math.min(3, DIVI.at + DIVI.dur - t), 0.85, 900);
  const t0 = DIVI.at; // on the chapter's own beat, with its cues
  for (let t = t0; t < DIVI.at + DIVI.dur - 0.3; t += BEAT) {
    const beat = Math.round((t - t0) / BEAT);
    if (beat % 2 === 0) voice.kick(t, 0.6);
    voice.hat(t + BEAT / 2, 0.5);
    if (beat % 4 === 2) voice.clap(t, 0.45);
    voice.bass(t, [29, 24, 31, 33][Math.floor(beat / 6) % 4], BEAT, 0.55, 700);
  }
}
// The course walk: a held chord rising into the stage.
voice.pad(FLYI.at, G, FLYI.dur, 0.9, 1200);
// The stage: its length comes from the shot list, and everything after it is
// moved by MARKS.shift so it stays on the beat grid.
const S = MARKS.shift;
const STAGE_OUT = 19.75 + S;
[[16, AM, 4], [20, F, 2], [22, C, 2], [24, G, 2], [26, AM, STAGE_OUT - 26]].forEach(([t, n, d]) => voice.pad(I(t), n, d, 1, 1500));
voice.pad(I(20 + S), F, 1.25, 1, 1300);
voice.pad(I(21.25 + S), G, 1.25, 1, 1300);
voice.pad(I(22.5 + S), AM, 2.0, 0.7, 800);

for (let t = 2; t < 4; t += BEAT) voice.kick(t, 0.45);
for (let t = 2; t < 5.75; t += BEAT / 2) voice.bass(t, 33, BEAT / 2, 0.7, 260 + (t - 2) * 120);
for (let t = 2; t < 5.75; t += BEAT / 4) voice.hat(t, (t * 4) % 2 < 1 ? 0.6 : 0.35);
voice.kick(6.5, 0.9);
for (let t = 8; t < 16; t += 1) if (t < DIVI.at - 0.2 || t >= DIVI.at + 0.2) voice.kick(I(t), 0.55);
for (let t = 8; t < 16; t += 2) voice.bass(I(t), t < 10 ? 33 : t < 12 ? 29 : t < 14 ? 31 : 31, 1.8, 0.5, 300);
// Stage drums follow the speed ramps: half time in slow motion, sixteenth
// hats while fast-forwarding.
for (let t = I(16); t < I(STAGE_OUT); t += BEAT) {
  const rate = rateAt(t);
  const beat = Math.round((t - I(16)) / BEAT);
  if (rate < 0.1) {
    // bullet time: a single held heartbeat
    if (beat % 4 === 0) voice.kick(t, 0.5);
    continue;
  }
  if (rate < 1) {
    if (beat % 2 === 0) voice.kick(t, 0.75);
    if (beat % 4 === 2) voice.clap(t, 0.6);
    voice.bass(t, 33, BEAT, 0.6, 500);
    continue;
  }
  voice.kick(t, 0.85);
  voice.hat(t + BEAT / 2, 0.8);
  if (beat % 2 === 1) voice.clap(t, 0.8);
  if (rate > 1) [0.25, 0.75].forEach((d) => voice.hat(t + BEAT * d, 0.45));
  for (const d of [0, BEAT / 2]) voice.bass(t + d, beat % 8 < 4 ? 33 : 29, BEAT / 2, 0.85, rate > 1 ? 1800 : 1200);
}
for (let t = I(20 + S); t < I(22.5 + S); t += BEAT) {
  voice.kick(t, 0.7);
  voice.hat(t + BEAT / 2, 0.6);
}
for (let t = I(20 + S); t < I(22.5 + S); t += BEAT / 2) voice.bass(t, t < I(21.25 + S) ? 29 : 31, BEAT / 2, 0.7, 900);

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
(MARKS.cuts ?? []).forEach(([at, dur, rig], i) => {
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
  const n = Math.round((0.22 + 0.25 * (1 - rate)) * SR);
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
    const fadeOut = t > DURATION - 1 ? Math.max(0, (DURATION + 0.4 - t) / 1.4) : 1;
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
