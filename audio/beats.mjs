// Measures the beat grid from the mastered score and writes beats.json.
// Kick-band onset envelope -> autocorrelation tempo -> comb phase -> per-beat onset snap -> least-squares grid.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const root = new URL('..', import.meta.url).pathname;
const SR = 48000, HOP = 64, DUR = 15;
const raw = execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', root + 'audio/score.wav',
  '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-'], { maxBuffer: 1 << 28 });
const x = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);

// kick band: two cascaded one-pole lowpasses at ~140 Hz, 10 ms RMS window
const a = 1 - Math.exp(-2 * Math.PI * 140 / SR);
let s1 = 0, s2 = 0;
const lp = new Float32Array(x.length);
for (let i = 0; i < x.length; i++) { s1 += a * (x[i] - s1); s2 += a * (s1 - s2); lp[i] = s2; }
const WIN = 480, nh = Math.floor(x.length / HOP), env = new Float32Array(nh);
for (let h = 0; h < nh; h++) {
  let e = 0;
  for (let i = Math.max(0, h * HOP - WIN); i < h * HOP; i++) e += lp[i] * lp[i];
  env[h] = Math.log(1e-7 + e / WIN);
}
const D = Math.round(0.012 / (HOP / SR));
const onset = new Float32Array(nh);
for (let h = D; h < nh; h++) onset[h] = Math.max(0, env[h] - env[h - D]);

// tempo by autocorrelation over 90-180 BPM
const hopT = HOP / SR;
let bestLag = 0, bestR = -1;
for (let lag = Math.round(60 / 180 / hopT); lag <= Math.round(60 / 90 / hopT); lag++) {
  let r = 0;
  for (let h = 0; h + lag < nh; h++) r += onset[h] * onset[h + lag];
  if (r > bestR) { bestR = r; bestLag = lag; }
}
let period = bestLag * hopT;

// phase by comb sum
let bestOff = 0, bestS = -1;
for (let o = 0; o < bestLag; o++) {
  let s = 0;
  for (let h = o; h < nh; h += bestLag) s += onset[h] + 0.5 * (onset[h - 1] || 0) + 0.5 * (onset[h + 1] || 0);
  if (s > bestS) { bestS = s; bestOff = o; }
}
let offset = bestOff * hopT;

// onset peaks (for reporting + snapping)
const thr = 0.3 * onset.reduce((m, v) => Math.max(m, v), 0);
const peaks = [];
for (let h = 2; h < nh - 2; h++)
  if (onset[h] > thr && onset[h] >= onset[h - 1] && onset[h] > onset[h + 1] && onset[h] >= onset[h - 2] && onset[h] >= onset[h + 2]) {
    if (peaks.length && h * hopT - peaks[peaks.length - 1] < 0.1) continue;
    peaks.push(attack(h * HOP));
  }
// sample-accurate attack: first sample reaching 25% of the local peak amplitude
function attack(c) {
  const lo = Math.max(0, c - Math.round(0.03 * SR)), hi = Math.min(lp.length, c + Math.round(0.03 * SR));
  let pk = 0;
  for (let i = lo; i < hi; i++) pk = Math.max(pk, Math.abs(lp[i]));
  for (let i = lo; i < hi; i++) if (Math.abs(lp[i]) >= 0.25 * pk) return i / SR;
  return c / SR;
}
const LAG = 0;

// snap each grid beat to the nearest measured onset (±30 ms), then least-squares refit
const snapped = [];
for (let k = -1; offset + k * period < DUR + period; k++) {
  const g = offset + k * period;
  let best = null;
  for (const p of peaks) if (Math.abs(p - LAG - g) < 0.03 && (!best || Math.abs(p - LAG - g) < Math.abs(best - g))) best = p - LAG;
  if (best !== null) snapped.push([k, best]);
}
if (snapped.length >= 4) {
  const n = snapped.length, sx = snapped.reduce((s, [k]) => s + k, 0), sy = snapped.reduce((s, [, t]) => s + t, 0);
  const sxx = snapped.reduce((s, [k]) => s + k * k, 0), sxy = snapped.reduce((s, [k, t]) => s + k * t, 0);
  period = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  offset = (sy - period * sx) / n;
}
// reduce offset to the first beat at or just before t=0
const k0 = Math.floor((offset + period * 0.5) / period);
offset -= k0 * period;
const beats = [];
for (let k = 0; offset + k * period < DUR - 1e-6; k++) beats.push(+(offset + k * period).toFixed(5));
const resid = snapped.map(([k, t]) => Math.abs(t - (offset + (k + k0) * period)));
const out = {
  source: 'audio/score.wav',
  method: 'kick-band onset envelope, autocorrelation tempo, onset-snapped least-squares grid',
  bpm: +(60 / period).toFixed(3),
  period: +period.toFixed(6),
  offset: +offset.toFixed(5),
  beats,
  downbeats: beats.filter((_, i) => i % 4 === 0),
  snappedBeats: snapped.length,
  maxResidualMs: +(Math.max(...resid) * 1000).toFixed(2),
  onsets: peaks.map((p) => +(p - LAG).toFixed(4)),
};
writeFileSync(root + 'beats.json', JSON.stringify(out, null, 1));
console.log(`beats.json: ${out.bpm} BPM, offset ${out.offset}s, ${beats.length} beats, ${snapped.length} snapped, max residual ${out.maxResidualMs} ms`);
