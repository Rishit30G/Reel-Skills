// Synthesized score + SFX for the showreel. 128 BPM, D minor, 32 beats = 15.0s.
// Writes audio/score_raw.wav (float32 stereo 48k). Loudness is normalized later.
import { writeFileSync } from 'node:fs';

const SR = 48000, BPM = 128, B = 60 / BPM, DUR = 15;
const N = Math.round(SR * DUR);
const bt = (b) => b * B;                       // beat -> seconds
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(0xC1A0DE);
const noise = () => rnd() * 2 - 1;

// buses
const dryL = new Float32Array(N), dryR = new Float32Array(N);
const duckL = new Float32Array(N), duckR = new Float32Array(N); // sidechained by kick
const sendL = new Float32Array(N), sendR = new Float32Array(N); // reverb send

function add(bus, i, l, r) {
  if (i < 0 || i >= N) return;
  bus[0][i] += l; bus[1][i] += r;
}
const DRY = [dryL, dryR], DUCK = [duckL, duckR], SEND = [sendL, sendR];
const panLR = (p) => [Math.cos((p + 1) * Math.PI / 4), Math.sin((p + 1) * Math.PI / 4)];

// TPT state-variable filter
function svf() {
  let ic1 = 0, ic2 = 0;
  return (x, fc, q = 0.707) => {
    const g = Math.tan(Math.PI * Math.min(fc, SR * 0.45) / SR), k = 1 / q;
    const a1 = 1 / (1 + g * (g + k)), a2 = g * a1, a3 = g * a2;
    const v3 = x - ic2, v1 = a1 * ic1 + a2 * v3, v2 = ic2 + a2 * ic1 + a3 * v3;
    ic1 = 2 * v1 - ic1; ic2 = 2 * v2 - ic2;
    return { lp: v2, bp: v1, hp: x - k * v1 - v2 };
  };
}
function polyblep(t, dt) {
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
}

// ---------- instruments ----------
const kickTimes = [];
function kick(b, gain = 1) {
  const t0 = bt(b); kickTimes.push(t0);
  const s0 = Math.round(t0 * SR), len = Math.round(0.55 * SR);
  let ph = 0;
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    const f = 44 + 120 * Math.exp(-t * 32);
    ph += f / SR;
    let v = Math.sin(2 * Math.PI * ph) * Math.exp(-t * 6.5);
    v += noise() * Math.exp(-t * 900) * 0.5;         // beater click
    v = Math.tanh(v * 1.6) * 0.9 * gain;
    add(DRY, s0 + i, v, v);
  }
}
function clap(b, gain = 1) {
  const s0 = Math.round(bt(b) * SR), len = Math.round(0.35 * SR), f = svf();
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    let env = 0;
    for (const o of [0, 0.011, 0.022]) if (t >= o) env = Math.max(env, Math.exp(-(t - o) * 260));
    env = Math.max(env, t > 0.022 ? 0.55 * Math.exp(-(t - 0.022) * 16) : 0);
    const v = f(noise(), 1250, 1.3).bp * env * 1.5 * gain;
    add(DRY, s0 + i, v * 0.95, v);
    add(SEND, s0 + i, v * 0.35, v * 0.35);
  }
}
function hat(b, open = false, gain = 1, pan = 0.25) {
  const s0 = Math.round(bt(b) * SR), dec = open ? 9 : 55, len = Math.round((open ? 0.35 : 0.08) * SR);
  const f = svf(), [pl, pr] = panLR(pan);
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    const v = f(noise(), 8200, 0.9).hp * Math.exp(-t * dec) * 0.28 * gain;
    add(DRY, s0 + i, v * pl, v * pr);
  }
}
function bass(b, dur, midi, gain = 1) {
  const s0 = Math.round(bt(b) * SR), len = Math.round(bt(dur) * SR), f = svf();
  const fr = mtof(midi), dt = fr / SR; let ph = 0, ph2 = 0;
  for (let i = 0; i < len + 2400; i++) {
    const t = i / SR;
    ph += dt; if (ph >= 1) ph -= 1; ph2 += dt / 2; if (ph2 >= 1) ph2 -= 1;
    const saw = 2 * ph - 1 - polyblep(ph, dt);
    const cut = 180 + 1400 * Math.exp(-t * 14);
    const rel = i < len ? 1 : Math.exp(-(i - len) / SR * 60);
    const env = Math.min(1, t * 400) * rel;
    const v = (f(saw, cut, 1.1).lp * 0.55 + Math.sin(2 * Math.PI * ph2 * 2) * 0.45) * env * 0.55 * gain;
    add(DUCK, s0 + i, v, v);
  }
}
function saws(freq, detunes, t, phs, dt) { // multi-saw helper (phase array)
  let v = 0;
  for (let k = 0; k < detunes.length; k++) {
    const d = dt * Math.pow(2, detunes[k] / 1200);
    phs[k] += d; if (phs[k] >= 1) phs[k] -= 1;
    v += 2 * phs[k] - 1 - polyblep(phs[k], d);
  }
  return v / detunes.length;
}
function stab(b, midis, gain = 1, decay = 3.2) {
  const s0 = Math.round(bt(b) * SR), len = Math.round(1.4 * SR);
  midis.forEach((m, n) => {
    const fr = mtof(m), dt = fr / SR, phs = [0.1, 0.4, 0.7], fL = svf(), fR = svf();
    const pan = (n / Math.max(1, midis.length - 1)) * 1.2 - 0.6, [pl, pr] = panLR(pan);
    for (let i = 0; i < len; i++) {
      const t = i / SR;
      const x = saws(fr, [-9, 0, 9], t, phs, dt);
      const cut = 500 + 4200 * Math.exp(-t * 9);
      const env = Math.min(1, t * 300) * Math.exp(-t * decay);
      const v = fL(x, cut, 0.9).lp * env * 0.16 * gain;
      add(DUCK, s0 + i, v * pl, v * pr);
      add(SEND, s0 + i, v * pl * 0.6, v * pr * 0.6);
    }
  });
}
function pad(b, dur, midis, gain = 1, cutoff = 900) {
  const s0 = Math.round(bt(b) * SR), len = Math.round(bt(dur) * SR), rel = Math.round(0.6 * SR);
  midis.forEach((m, n) => {
    const fr = mtof(m), dt = fr / SR, phs = [0.2, 0.5, 0.8], f = svf();
    const [pl, pr] = panLR((n % 2 ? 0.45 : -0.45));
    for (let i = 0; i < len + rel; i++) {
      const t = i / SR;
      const env = Math.min(1, t / 0.35) * (i < len ? 1 : Math.exp(-(i - len) / SR * 7));
      const x = saws(fr, [-12, 0, 11], t, phs, dt);
      const v = f(x, cutoff * (1 + 0.25 * Math.sin(t * 3.1 + n)), 0.8).lp * env * 0.07 * gain;
      add(DUCK, s0 + i, v * pl, v * pr);
      add(SEND, s0 + i, v * pl * 0.8, v * pr * 0.8);
    }
  });
}
function pluck(b, midi, gain = 1, pan = 0, bright = 1) {
  const s0 = Math.round(bt(b) * SR), len = Math.round(0.9 * SR), fr = mtof(midi), [pl, pr] = panLR(pan);
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    const idx = 2.6 * bright * Math.exp(-t * 22);
    const v = Math.sin(2 * Math.PI * fr * t + idx * Math.sin(2 * Math.PI * fr * 2 * t))
      * Math.exp(-t * 7.5) * Math.min(1, t * 2000) * 0.32 * gain;
    add(DRY, s0 + i, v * pl, v * pr);
    add(SEND, s0 + i, v * pl * 0.5, v * pr * 0.5);
  }
}
function blip(b, freq, gain = 1, pan = 0) {
  const s0 = Math.round(bt(b) * SR), len = Math.round(0.12 * SR), [pl, pr] = panLR(pan);
  let ph = 0;
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    ph += freq * (1 + 0.15 * Math.exp(-t * 60)) / SR;
    const v = Math.sin(2 * Math.PI * ph) * Math.exp(-t * 38) * Math.min(1, t * 3000) * 0.22 * gain;
    add(DRY, s0 + i, v * pl, v * pr);
    add(SEND, s0 + i, v * pl * 0.4, v * pr * 0.4);
  }
}
function tick(b, gain = 1, pan = 0, fc = 3800) {
  const s0 = Math.round(bt(b) * SR), len = Math.round(0.03 * SR), f = svf(), [pl, pr] = panLR(pan);
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    const v = f(noise(), fc, 2.5).bp * Math.exp(-t * 320) * 0.5 * gain;
    add(DRY, s0 + i, v * pl, v * pr);
  }
}
// band-passed noise sweep; f0->f1 Hz across [b0,b1] beats, swell shape
function whoosh(b0, b1, f0, f1, gain = 1, pan0 = -0.5, pan1 = 0.5) {
  const s0 = Math.round(bt(b0) * SR), len = Math.round(bt(b1 - b0) * SR), f = svf();
  for (let i = 0; i < len + 4800; i++) {
    const u = Math.min(1, i / len);
    const tail = i < len ? 1 : Math.exp(-(i - len) / SR * 30);
    const env = Math.pow(Math.sin(Math.PI * Math.min(u, 0.999) * 0.5 + 0.0), 2.2) * tail;
    const fc = f0 * Math.pow(f1 / f0, u);
    const [pl, pr] = panLR(pan0 + (pan1 - pan0) * u);
    const v = f(noise(), fc, 1.6).bp * env * 0.55 * gain;
    add(DRY, s0 + i, v * pl, v * pr);
    add(SEND, s0 + i, v * pl * 0.3, v * pr * 0.3);
  }
}
function sweepTone(b0, b1, f0, f1, gain = 1) { // sine glide (falling-ball whistle, collapse zip)
  const s0 = Math.round(bt(b0) * SR), len = Math.round(bt(b1 - b0) * SR);
  let ph = 0;
  for (let i = 0; i < len; i++) {
    const u = i / len, fr = f0 * Math.pow(f1 / f0, u);
    ph += fr / SR;
    const v = Math.sin(2 * Math.PI * ph) * Math.min(1, u * 8) * Math.min(1, (1 - u) * 30) * 0.12 * gain;
    add(DRY, s0 + i, v, v);
    add(SEND, s0 + i, v * 0.5, v * 0.5);
  }
}
function impact(b, gain = 1) {
  const s0 = Math.round(bt(b) * SR), len = Math.round(2.2 * SR), f = svf();
  let ph = 0;
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    ph += (34 + 40 * Math.exp(-t * 5)) / SR;
    const sub = Math.sin(2 * Math.PI * ph) * Math.exp(-t * 2.2) * 0.8;
    const crash = f(noise(), 5200, 0.7).hp * Math.exp(-t * 2.6) * 0.22;
    const v = (Math.tanh(sub * 1.3) + crash) * gain;
    add(DRY, s0 + i, v, v * 0.98);
    add(SEND, s0 + i, crash * 0.6 * gain, crash * 0.6 * gain);
  }
}
function riser(b0, b1, gain = 1) {
  const s0 = Math.round(bt(b0) * SR), len = Math.round(bt(b1 - b0) * SR), f = svf();
  let ph = 0;
  for (let i = 0; i < len; i++) {
    const u = i / len;
    const fc = 400 * Math.pow(22, u);
    ph += (110 * Math.pow(4, u)) / SR; if (ph >= 1) ph -= 1;
    const env = Math.pow(u, 2.4);
    const v = (f(noise(), fc, 2.2).bp * 0.6 + (2 * ph - 1) * 0.08) * env * 0.5 * gain;
    const w = Math.sin(u * 40) * 0.3;
    add(DRY, s0 + i, v * (1 - w), v * (1 + w));
  }
}
// the race sonified: a tone whose pitch follows an easing curve
function easedGlide(b0, b1, f0, f1, ease, gain = 1, pan = 0) {
  const s0 = Math.round(bt(b0) * SR), len = Math.round(bt(b1 - b0) * SR), hold = Math.round(0.25 * SR), [pl, pr] = panLR(pan);
  let ph = 0;
  for (let i = 0; i < len + hold; i++) {
    const u = Math.min(1, i / len), p = ease(u);
    const fr = f0 * Math.pow(f1 / f0, p);
    ph += fr / SR;
    const env = Math.min(1, i / 600) * (i < len ? 1 : Math.exp(-(i - len) / SR * 18));
    const v = (Math.sin(2 * Math.PI * ph) + 0.25 * Math.sin(4 * Math.PI * ph)) * env * 0.05 * gain;
    add(DRY, s0 + i, v * pl, v * pr);
    add(SEND, s0 + i, v * pl * 0.5, v * pr * 0.5);
  }
}

// easing set shared with the film (must match film.js)
const E = {
  linear: (x) => x,
  sine: (x) => -(Math.cos(Math.PI * x) - 1) / 2,
  cubic: (x) => 1 - Math.pow(1 - x, 3),
  expo: (x) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x)),
  back: (x) => { const c1 = 1.9, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); },
  elastic: (x) => (x <= 0 ? 0 : x >= 1 ? 1 : Math.pow(2, -10 * x) * Math.sin((x * 10 - 0.75) * (2 * Math.PI / 3)) + 1),
  bounce: (x) => {
    const n1 = 7.5625, d1 = 2.75;
    if (x < 1 / d1) return n1 * x * x;
    if (x < 2 / d1) return n1 * (x -= 1.5 / d1) * x + 0.75;
    if (x < 2.5 / d1) return n1 * (x -= 2.25 / d1) * x + 0.9375;
    return n1 * (x -= 2.625 / d1) * x + 0.984375;
  },
};

// ---------- arrangement (beats) ----------
const D2 = 38, Bb1 = 34, F2 = 41, C2 = 36;
const CH = {
  Dm: [62, 65, 69, 74], Bb: [58, 62, 65, 70], F: [60, 65, 69, 72], C: [60, 64, 67, 72],
};

// Bar 0: the ball falls and writes the name
sweepTone(0, 1, 1400, 260, 1.1);
impact(1, 0.55);
whoosh(1, 1.35, 2500, 7000, 0.35, 0, 0);            // floor line snaps out
const nameNotes = [62, 65, 67, 69, 72, 74];
nameNotes.forEach((m, i) => { pluck(1 + i * 0.5, m, 1.0, -0.55 + i * 0.22); tick(1 + i * 0.5, 0.5, -0.55 + i * 0.22); });
pad(1, 3, [50, 57, 62], 0.8, 700);
whoosh(3.5, 4, 600, 3000, 0.4);

// Bars 1-6: groove
for (let b = 4; b < 27; b++) kick(b);
kick(27, 0.9); kick(27.5, 0.6);
for (let b = 5; b < 28; b += 2) clap(b, b >= 26 ? 0.7 : 1);
for (let b = 4; b < 27.5; b += 0.5) {
  const off = (b % 1) === 0.5;
  if (b >= 8 && b < 12.5) { hat(b, off, off ? 0.8 : 0.6); hat(b + 0.25, false, 0.35, -0.2); }
  else if (b >= 12.5 && b < 14.5) { /* race: keep it clear */ }
  else if (off) hat(b, b >= 16, 0.85);
  else if (b >= 20) hat(b, false, 0.5, -0.2);
}
const bassRoots = { 1: D2, 2: Bb1, 3: F2, 4: C2, 5: D2, 6: Bb1 };
for (let bar = 1; bar <= 6; bar++) {
  for (let q = 0; q < 4; q++) {
    const b = bar * 4 + q;
    if (bar === 3 && q < 2) continue;
    bass(b + 0.5, 0.42, bassRoots[bar] + (q === 3 && bar % 2 ? 12 : 0));
  }
}
// bar 1: drop, zoom into the dot, two slams
stab(4, CH.Dm, 1.2);
impact(4, 0.35);
whoosh(4, 4.8, 300, 6000, 0.7, -0.3, 0.3);
stab(5, [50, 57, 62], 0.9, 6);
stab(6, [53, 60, 65], 0.9, 6);
// bar 2: variable-font wave
pad(8, 3.5, CH.Bb, 1.0, 1100);
sweepTone(11.5, 12, 1800, 200, 1.0);
whoosh(11.75, 12.25, 5000, 400, 0.6, 0.4, -0.4);
// bar 3: the easing race, sonified
const lanePitch = [53, 57, 60, 65, 69, 72];
['linear', 'sine', 'expo', 'back', 'elastic', 'bounce'].forEach((k, i) =>
  easedGlide(12.5, 14.5, mtof(lanePitch[i]), mtof(lanePitch[i] + 7), E[k], 1.1, -0.6 + i * 0.24));
stab(14.5, CH.F, 1.1); clap(14.5, 1.0); impact(14.5, 0.3);
for (let i = 0; i < 6; i++) tick(14.75 + i * 0.07, 0.7, -0.6 + i * 0.24, 5200);
whoosh(15.4, 16, 800, 5000, 0.5, 0.5, -0.5);
// bar 4: timeline keyframes (blips on each keyframe crossing)
const kfMel = [[16, 72], [17, 76], [18, 79], [19, 84], [16.5, 67], [17.5, 67], [18.5, 71], [19.5, 74]];
kfMel.forEach(([b, m]) => blip(b, mtof(m), b % 1 ? 0.6 : 1, (b - 18) * 0.3));
pad(16, 3.75, CH.C, 0.8, 1300);
whoosh(19.5, 20, 400, 4000, 0.55);
// bar 5: radial repeater — circling arpeggio
const arp = [62, 65, 69, 72, 76, 72, 69, 65];
for (let i = 0; i < 16; i++) {
  const b = 20 + i * 0.25;
  pluck(b, arp[i % 8] + (i >= 8 ? 12 : 0), 0.55, Math.sin(i * Math.PI / 4) * 0.7, 0.7);
}
stab(20, CH.Dm, 0.8, 4);
// bar 6: grid montage — flips, snare roll, riser, then silence before the drop
// flips follow the film's grid schedule
[24.25, 24.375, 24.5, 25, 25.25, 25.5, 25.75].forEach((b, i) => tick(b, 1.0, i % 2 ? 0.5 : -0.5, 2600));
for (const base of [26, 26.5, 27]) for (let d = 0; d < 5; d++) tick(base + d * 0.0625, 0.7, -0.6 + d * 0.3, 2200 + d * 400);
for (let d = 0; d < 5; d++) tick(27.5 + d * 0.05, 0.6, -0.6 + d * 0.3, 3200);
for (let b = 26; b < 27.75; b += (b < 27 ? 0.25 : 0.125)) clap(b, 0.25 + (b - 26) * 0.35);
riser(24.5, 27.9, 1.0);
pad(24, 3.5, CH.Bb, 0.7, 1500);
// bar 7: end card
kick(28, 1.15); impact(28, 1.0); clap(28, 0.8);
stab(28, [...CH.Dm, 50], 1.3, 1.6);
// letters rise right-to-left, radiating from the ball's impact
nameNotes.forEach((m, i) => pluck(28 + i * 0.125, m + 12, 0.55, 0.55 - i * 0.22, 0.6));
pad(28, 3.6, [50, 57, 62, 65, 69], 1.1, 1000);
whoosh(28.9, 29.3, 1200, 4500, 0.35);
pluck(29, 69, 0.6, -0.2);
for (let i = 0; i < 34; i++) tick(29.5 + i * 0.03, 0.22, 0.2, 4500);
for (let i = 0; i < 4; i++) blip(30 + i * 0.25, mtof([74, 77, 81, 86][i]), 0.6, 0.5);
pluck(30.75, 62, 0.4, 0);
kick(31, 0.45); pluck(31, 74, 0.9, 0.3); pluck(31.5, 81, 0.35, 0.35);

// ---------- mix ----------
// kick sidechain envelope
const sc = new Float32Array(N).fill(1);
for (const t0 of kickTimes) {
  const s0 = Math.round(t0 * SR);
  for (let i = 0; i < SR * 0.4 && s0 + i < N; i++) {
    const d = 1 - 0.75 * Math.exp(-(i / SR) * 11) * Math.min(1, i / 60 + 0.6);
    sc[s0 + i] = Math.min(sc[s0 + i], d);
  }
}
// Freeverb-style reverb on the send bus
function reverb(inp, spread) {
  const out = new Float32Array(N);
  const combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617].map((l) => {
    const len = Math.round((l + spread) * SR / 44100);
    return { buf: new Float32Array(len), i: 0, store: 0 };
  });
  const aps = [556, 441, 341, 225].map((l) => ({ buf: new Float32Array(Math.round((l + spread) * SR / 44100)), i: 0 }));
  const fb = 0.86, damp = 0.25;
  for (let n = 0; n < N; n++) {
    const x = inp[n] * 0.015;
    let acc = 0;
    for (const c of combs) {
      const y = c.buf[c.i];
      c.store = y * (1 - damp) + c.store * damp;
      c.buf[c.i] = x + c.store * fb;
      c.i = (c.i + 1) % c.buf.length;
      acc += y;
    }
    for (const a of aps) {
      const y = a.buf[a.i];
      a.buf[a.i] = acc + y * 0.5;
      a.i = (a.i + 1) % a.buf.length;
      acc = y - acc;
    }
    out[n] = acc;
  }
  return out;
}
const wetL = reverb(sendL, 0), wetR = reverb(sendR, 23);
const outL = new Float32Array(N), outR = new Float32Array(N);
for (let n = 0; n < N; n++) {
  const fade = Math.min(1, (N - n) / (SR * 0.25));
  const l = dryL[n] + duckL[n] * sc[n] + wetL[n] * 0.9;
  const r = dryR[n] + duckR[n] * sc[n] + wetR[n] * 0.9;
  outL[n] = Math.tanh(l * 0.9) * fade;
  outR[n] = Math.tanh(r * 0.9) * fade;
}

// float32 WAV
function writeWav(path, chans) {
  const n = chans[0].length, nc = chans.length, bytes = n * nc * 4;
  const buf = Buffer.alloc(44 + bytes);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + bytes, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(3, 20); buf.writeUInt16LE(nc, 22);
  buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * nc * 4, 28); buf.writeUInt16LE(nc * 4, 32); buf.writeUInt16LE(32, 34);
  buf.write('data', 36); buf.writeUInt32LE(bytes, 40);
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < nc; c++) { buf.writeFloatLE(chans[c][i], o); o += 4; }
  writeFileSync(path, buf);
}
const here = new URL('.', import.meta.url).pathname;
writeWav(here + 'score_raw.wav', [outL, outR]);
console.log('wrote audio/score_raw.wav', (N / SR).toFixed(3) + 's');
