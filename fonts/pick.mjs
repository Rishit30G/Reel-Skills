#!/usr/bin/env node
// Pick the font pair for a video from fonts/font-map.json.
//   node fonts/pick.mjs "60s product demo of our MCP server"   -> matches a niche by keywords
//   node fonts/pick.mjs educational                            -> niche by name
//   node fonts/pick.mjs talking-head --portable                -> swap macOS-only fonts for bundled stand-ins
//   node fonts/pick.mjs --list                                 -> all niches
// Prints JSON: niche, display/ui with CSS family, file paths (for PIL) and any stand-in notes.
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = dirname(fileURLToPath(import.meta.url));
const MAP = JSON.parse(readFileSync(join(DIR, 'font-map.json'), 'utf8'));
const args = process.argv.slice(2);
const portable = args.includes('--portable');
const query = args.filter((a) => !a.startsWith('--')).join(' ').toLowerCase().trim();

if (args.includes('--list') || !query) {
  for (const [k, n] of Object.entries(MAP.niches))
    console.log(`${k.padEnd(13)} display=${MAP.fonts[n.display].name.padEnd(18)} ui=${MAP.fonts[n.ui].name.padEnd(14)} reel: ${n.reel.join(', ')}`);
  console.log(`never: ${MAP.never.join(', ')}`);
  process.exit(0);
}

for (const bad of MAP.never)
  if (query.includes(bad.toLowerCase())) { console.error(`${bad} is on the never list.`); process.exit(1); }

function pickNiche(q) {
  if (MAP.niches[q]) return { niche: q, score: Infinity, hits: [q] };
  let best = { niche: 'educational', score: 0, hits: [] };
  for (const [k, n] of Object.entries(MAP.niches)) {
    const hits = n.match.filter((m) => new RegExp(`\\b${m}s?\\b`).test(q)); // whole words, so "ad" never matches "made"
    const score = hits.reduce((s, m) => s + m.split(' ').length, 0); // multi-word matches weigh more
    if (score > best.score) best = { niche: k, score, hits };
  }
  return best;
}

function resolve(id) {
  let f = MAP.fonts[id];
  const out = { id, reelName: f.name, status: f.status };
  if (f.note) out.note = f.note;
  if (f.settings) out.settings = f.settings;
  if (f.status === 'mac-system' && (portable || !existsSync(f.system))) {
    out.note = `${f.name} is macOS-only; using stand-in ${MAP.fonts[f.standin].name}.`;
    f = MAP.fonts[f.standin];
  } else if (f.status === 'stand-in') {
    f = MAP.fonts[f.standin];
  }
  out.css = f.css ?? f.name;
  out.files = f.files ? f.files.map((x) => join(DIR, x)) : [f.system, f.systemBold].filter(Boolean);
  return out;
}

const { niche, hits } = pickNiche(query);
const n = MAP.niches[niche];
const res = {
  niche,
  matchedOn: hits.length ? hits : ['(no keyword hit; defaulted to educational)'],
  display: resolve(n.display),
  ui: resolve(niche === 'educational' && /\b(code|terminal|cli|api|mcp|sdk)\b/.test(query) ? n.code : n.ui),
  alternates: n.alternates,
  why: n.why,
};
console.log(JSON.stringify(res, null, 2));
