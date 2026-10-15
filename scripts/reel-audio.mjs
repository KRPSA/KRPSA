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
const { CUES, DURATION, MARKS } = sandbox.window.KRPSAReel;

const SR = 48000;
const N = Math.ceil((DURATION + 0.5) * SR);
const dry = [new Float32Array(N), new Float32Array(N)];
const wet = [new Float32Array(N), new Float32Array(N)];
const BPM = 120;
const BEAT = 60 / BPM;

let seed = 1;
const noise = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 2147483648 - 1;
};
const midi = (n) => 440 * 2 ** ((n - 69) / 12);

// Write a mono voice into the mix. fn(t) returns a sample at t seconds into the voice.
function place(t0, dur, fn, { gain = 1, pan = 0, send = 0 } = {}) {
  const i0 = Math.round(t0 * SR);
  const len = Math.round(dur * SR);
  const gl = Math.cos(((pan + 1) * Math.PI) / 4) * gain;
  const gr = Math.sin(((pan + 1) * Math.PI) / 4) * gain;
  for (let i = 0; i < len; i++) {
    const k = i0 + i;
    if (k < 0 || k >= N) continue;
    const v = fn(i / SR);
    dry[0][k] += v * gl;
    dry[1][k] += v * gr;
    if (send) {
      wet[0][k] += v * gl * send;
      wet[1][k] += v * gr * send;
    }
  }
}

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

// ------------------------------------------------------------------- music
const AM = [57, 60, 64];
const F = [53, 57, 60];
const C = [55, 60, 64];
const G = [55, 59, 62];
voice.pad(0, AM, 6.0, 0.8, 700);
voice.pad(6.0, AM, 2.0, 1, 1400);
[[8, AM], [10, F], [12, C], [14, G]].forEach(([t, n]) => voice.pad(t, n, 2.0, 0.9, 600));
// The stage: its length comes from the shot list, and everything after it is
// moved by MARKS.shift so it stays on the beat grid.
const S = MARKS.shift;
const STAGE_OUT = 19.75 + S;
const rateAt = (t) => (MARKS.ramps.find(([a, b]) => t >= a && t < b) ?? [0, 0, 1])[2];
[[16, AM, 4], [20, F, 2], [22, C, 2], [24, G, 2], [26, AM, STAGE_OUT - 26]].forEach(([t, n, d]) => voice.pad(t, n, d, 1, 1500));
voice.pad(20 + S, F, 1.25, 1, 1300);
voice.pad(21.25 + S, G, 1.25, 1, 1300);
voice.pad(22.5 + S, AM, 2.0, 0.7, 800);

for (let t = 2; t < 4; t += BEAT) voice.kick(t, 0.45);
for (let t = 2; t < 5.75; t += BEAT / 2) voice.bass(t, 33, BEAT / 2, 0.7, 260 + (t - 2) * 120);
for (let t = 2; t < 5.75; t += BEAT / 4) voice.hat(t, (t * 4) % 2 < 1 ? 0.6 : 0.35);
voice.kick(6.5, 0.9);
for (let t = 8; t < 16; t += 1) voice.kick(t, 0.55);
for (let t = 8; t < 16; t += 2) voice.bass(t, t < 10 ? 33 : t < 12 ? 29 : t < 14 ? 31 : 31, 1.8, 0.5, 300);
// Stage drums follow the speed ramps: half time in slow motion, sixteenth
// hats while fast-forwarding.
for (let t = 16; t < STAGE_OUT; t += BEAT) {
  const rate = rateAt(t);
  const beat = Math.round((t - 16) / BEAT);
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
for (let t = 20 + S; t < 22.5 + S; t += BEAT) {
  voice.kick(t, 0.7);
  voice.hat(t + BEAT / 2, 0.6);
}
for (let t = 20 + S; t < 22.5 + S; t += BEAT / 2) voice.bass(t, t < 21.25 + S ? 29 : 31, BEAT / 2, 0.7, 900);

// ------------------------------------------------------------------ cues
for (const cue of CUES) {
  const fn = voice[cue.type];
  if (!fn) throw new Error(`No voice for cue ${cue.type}`);
  if (cue.type === 'riser') fn(cue.t, cue.dur);
  else fn(cue.t, cue.v ?? 1);
}

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
