// node render.mjs              full render -> out/claude-motion-reel.mp4 (H.264 yuv420p CRF 16 + score)
// node render.mjs --contact    one frame per beat -> out/contact.png
// node render.mjs --at 1.2,3.4 single frames -> out/probe-<t>.png
import http from 'node:http';
import { readFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { extname, join } from 'node:path';
import os from 'node:os';
import puppeteer from 'puppeteer-core';

const ROOT = new URL('.', import.meta.url).pathname;
const FPS = 60, DUR = 15, W = 1920, H = 1080;
const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const opt = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };

// 1. score -> -14 LUFS master -> measured beat grid
if (!flag('--no-audio')) {
  for (const s of ['audio/score.mjs', 'audio/master.mjs', 'audio/beats.mjs']) {
    const r = spawnSync(process.execPath, [join(ROOT, s)], { stdio: 'inherit' });
    if (r.status) process.exit(r.status);
  }
}

// 2. static server (fetch() needs http, not file://)
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.ttf': 'font/ttf', '.otf': 'font/otf', '.css': 'text/css', '.wav': 'audio/wav' };
const server = http.createServer(async (req, res) => {
  try {
    const p = join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!p.startsWith(ROOT)) throw new Error('outside root');
    res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' });
    res.end(await readFile(p));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const URL_ = `http://127.0.0.1:${server.address().port}/index.html?render=1`;

const CHROME = process.env.CHROME || join(os.homedir(),
  '.cache/puppeteer/chrome-headless-shell/mac_arm-138.0.7204.92/chrome-headless-shell-mac-arm64/chrome-headless-shell');
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'shell', protocolTimeout: 60000,
  args: ['--force-color-profile=srgb', '--hide-scrollbars', '--font-render-hinting=none', '--disable-lcd-text', '--autoplay-policy=no-user-gesture-required'],
});
async function newPage() {
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => { console.error('page error:', e.message); process.exitCode = 1; });
  await page.goto(URL_, { waitUntil: 'load' });
  if (process.env.DEBUG) console.log('page loaded');
  await page.evaluate(() => window.ready);
  if (process.env.DEBUG) console.log('page ready');
  return page;
}
async function shoot(page, t, path) {
  await page.evaluate((t) => window.seek(t), t);
  await page.screenshot({ path, type: 'png', clip: { x: 0, y: 0, width: W, height: H }, optimizeForSpeed: true });
}
async function renderTimes(times, pathFor, workers = Math.min(6, Math.max(1, os.cpus().length - 2))) {
  // pages are brought up one at a time: background tabs can stall font loading
  const pages = [];
  for (let i = 0; i < Math.min(workers, times.length); i++) pages.push(await newPage());
  let next = 0, done = 0;
  const t0 = Date.now();
  await Promise.all(pages.map(async (page) => {
    while (next < times.length) {
      const i = next++;
      await shoot(page, times[i], pathFor(i));
      if (++done % 60 === 0) process.stdout.write(`\r  ${done}/${times.length} frames  ${((Date.now() - t0) / done).toFixed(0)} ms/frame`);
    }
  }));
  if (times.length >= 60) process.stdout.write('\n');
}

const OUT = join(ROOT, 'out');
await mkdir(OUT, { recursive: true });
const beats = JSON.parse(await readFile(join(ROOT, 'beats.json'), 'utf8'));

if (flag('--contact')) {
  // one frame per beat, caught just after the hit so each move reads
  const dir = join(OUT, 'contact'); await rm(dir, { recursive: true, force: true }); await mkdir(dir);
  const off = Number(opt('--offset') ?? 0.35);
  const times = beats.beats.map((b) => Math.min(DUR - 1 / FPS, Math.max(0, b + beats.period * off)));
  await renderTimes(times, (i) => join(dir, `b${String(i).padStart(2, '0')}.png`));
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-framerate', '1', '-i', join(dir, 'b%02d.png'),
    '-vf', 'scale=480:270:flags=lanczos,pad=488:278:4:4:color=0x777777,tile=8x4', '-frames:v', '1', join(OUT, 'contact.png')]);
  console.log('wrote out/contact.png (8x4, beats 0-31, +' + off + ' beat)');
} else if (opt('--beats')) {
  // arbitrary beat positions (e.g. mid-transition) tiled into out/sheet.png
  const bs = opt('--beats').split(',').map(Number), cols = Number(opt('--cols') ?? 6);
  const dir = join(OUT, 'sheet'); await rm(dir, { recursive: true, force: true }); await mkdir(dir);
  const times = bs.map((b) => Math.min(DUR - 1 / FPS, Math.max(0, beats.beats[0] + b * beats.period)));
  await renderTimes(times, (i) => join(dir, `s${String(i).padStart(2, '0')}.png`));
  const rows = Math.ceil(bs.length / cols);
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-framerate', '1', '-i', join(dir, 's%02d.png'),
    '-vf', `scale=640:360:flags=lanczos,pad=648:368:4:4:color=0x777777,tile=${cols}x${rows}`, '-frames:v', '1', join(OUT, 'sheet.png')]);
  console.log(`wrote out/sheet.png (${bs.join(', ')})`);
} else if (opt('--at')) {
  const times = opt('--at').split(',').map(Number);
  await renderTimes(times, (i) => join(OUT, `probe-${times[i].toFixed(3)}.png`));
  console.log('wrote', times.map((t) => `out/probe-${t.toFixed(3)}.png`).join(' '));
} else {
  const dir = join(OUT, 'frames'); await rm(dir, { recursive: true, force: true }); await mkdir(dir);
  const N = Math.round(DUR * FPS);
  const times = [...Array(N)].map((_, i) => i / FPS);
  console.log(`rendering ${N} frames @ ${FPS}fps`);
  await renderTimes(times, (i) => join(dir, `f${String(i).padStart(4, '0')}.png`));
  const dst = join(OUT, 'claude-motion-reel.mp4');
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y',
    '-framerate', String(FPS), '-i', join(dir, 'f%04d.png'), '-i', join(ROOT, 'audio/score.wav'),
    '-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p',
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
    '-c:a', 'aac', '-b:a', '320k', '-ar', '48000', '-t', String(DUR), '-movflags', '+faststart', dst], { stdio: 'inherit' });
  console.log('wrote out/claude-motion-reel.mp4');
}
await browser.close();
server.close();
