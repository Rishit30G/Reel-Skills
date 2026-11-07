// Two-pass EBU R128 loudness normalization to -14 LUFS integrated, -1 dBTP.
import { spawnSync } from 'node:child_process';

const dir = new URL('.', import.meta.url).pathname;
const src = dir + 'score_raw.wav', dst = dir + 'score.wav';
const TARGET = 'I=-14:TP=-1:LRA=11';
const ff = (args) => {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stderr;
};

const m = JSON.parse(ff(['-i', src, '-af', `loudnorm=${TARGET}:print_format=json`, '-f', 'null', '-'])
  .match(/\{[\s\S]*?\}/)[0]);

// linear=true keeps it a static gain (no pumping) whenever the measured range allows it
ff(['-y', '-i', src, '-af',
  `loudnorm=${TARGET}:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}` +
  `:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true,aresample=48000`,
  '-c:a', 'pcm_s24le', dst]);

const check = ff(['-i', dst, '-af', 'ebur128=peak=true', '-f', 'null', '-']);
const summary = check.slice(check.lastIndexOf('Summary:'));
const I = summary.match(/I:\s+(-?[\d.]+) LUFS/)[1];
const P = summary.match(/Peak:\s+(-?[\d.]+) dBFS/)?.[1];
console.log(`mastered audio/score.wav  input ${m.input_i} LUFS -> ${I} LUFS integrated, true peak ${P} dBFS`);
