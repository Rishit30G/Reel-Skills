// Claude — motion reel. A pure function of time: window.seek(t) paints frame t.
// No transitions, timers or carried state. All randomness is seeded (mulberry32).
'use strict';
(() => {
  const W = 1920, H = 1080, FPS = 60;
  const C = {
    ink: '#141413', paper: '#FAF9F5', clay: '#D97757', mid: '#B0AEA5',
    ink2: '#1E1D1B', ink3: '#2B2A27',
  };
  const bg = document.getElementById('bg').getContext('2d');
  const fg = document.getElementById('fg').getContext('2d');
  const layer = document.getElementById('txt');

  // ---------- math ----------
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const lerp = (a, b, t) => a + (b - a) * t;
  const seg = (x, a, b) => clamp((x - a) / (b - a));
  const bump = (x) => (x <= 0 || x >= 1 ? 0 : Math.sin(Math.PI * x));
  const frac = (x) => x - Math.floor(x);
  const TAU = Math.PI * 2;
  const E = {
    linear: (x) => x,
    sine: (x) => -(Math.cos(Math.PI * x) - 1) / 2,
    cubic: (x) => 1 - Math.pow(1 - x, 3),
    inCubic: (x) => x * x * x,
    inOutCubic: (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
    inQuart: (x) => x * x * x * x,
    expo: (x) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x)),
    inExpo: (x) => (x <= 0 ? 0 : Math.pow(2, 10 * x - 10)),
    inOutExpo: (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x < 0.5 ? Math.pow(2, 20 * x - 10) / 2 : (2 - Math.pow(2, -20 * x + 10)) / 2),
    back: (x) => { const c1 = 1.9, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); },
    elastic: (x) => (x <= 0 ? 0 : x >= 1 ? 1 : Math.pow(2, -10 * x) * Math.sin((x * 10 - 0.75) * (TAU / 3)) + 1),
    bounce: (x) => {
      const n1 = 7.5625, d1 = 2.75;
      if (x < 1 / d1) return n1 * x * x;
      if (x < 2 / d1) return n1 * (x -= 1.5 / d1) * x + 0.75;
      if (x < 2.5 / d1) return n1 * (x -= 2.25 / d1) * x + 0.9375;
      return n1 * (x -= 2.625 / d1) * x + 0.984375;
    },
  };
  // damped spring 0 -> 1, t in seconds
  function spr(t, f = 3.2, z = 0.42) {
    if (t <= 0) return 0;
    const w = TAU * f, wd = w * Math.sqrt(1 - z * z);
    return 1 - Math.exp(-z * w * t) * (Math.cos(wd * t) + (z * w / wd) * Math.sin(wd * t));
  }
  const warp = (x) => Math.floor(x) + E.cubic(frac(x)); // motion that pumps on the beat
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const hash = (i, j = 0) => mulberry32((i * 73856093) ^ (j * 19349663) ^ 0x5eed)();
  function hex(c) { const n = parseInt(c.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function mix(a, b, t) {
    const A = hex(a), B = hex(b);
    return `rgb(${A.map((v, i) => Math.round(lerp(v, B[i], clamp(t)))).join(',')})`;
  }
  function alpha(c, a) { const [r, g, b] = hex(c); return `rgba(${r},${g},${b},${a})`; }

  // ---------- beat grid (measured, from beats.json) ----------
  let BEATS, P;
  function bT(n) { // beat index -> seconds
    const bs = BEATS.beats, last = bs.length - 1;
    if (n <= 0) return bs[0] + n * P;
    if (n >= last) return bs[last] + (n - last) * P;
    const i = Math.floor(n);
    return lerp(bs[i], bs[i + 1], n - i);
  }
  function tB(t) { // seconds -> beat index
    const bs = BEATS.beats, last = bs.length - 1;
    if (t <= bs[0]) return (t - bs[0]) / P;
    if (t >= bs[last]) return last + (t - bs[last]) / P;
    let i = 0;
    while (bs[i + 1] <= t) i++;
    return i + (t - bs[i]) / (bs[i + 1] - bs[i]);
  }

  // ---------- type: immediate-mode DOM text pool ----------
  const pool = new Map();
  let FID = 0;
  const BASE = {}, CAP = {};
  const FAM = { d: 'Disp', m: 'Mono' };
  const axes = (fam, wght, wdth) => (fam === 'Disp' ? `"wght" ${wght}, "wdth" ${wdth}` : `"wght" ${wght}`);
  // o: x, y (baseline), size, font d|m, wght, wdth, color, ax (0..1), rot, sx, sy, ls (em), clip [t r b l] px, z, letters(i,n,ch)
  function text(id, str, o) {
    let r = pool.get(id);
    const per = !!o.letters;
    if (!r) {
      const el = document.createElement('div');
      el.className = 't';
      layer.appendChild(el);
      r = { el, str: null, per: null, spans: [] };
      pool.set(id, r);
    }
    if (r.str !== str || r.per !== per) {
      r.el.textContent = ''; r.spans = [];
      if (per) for (const ch of str) { const s = document.createElement('span'); s.textContent = ch; r.el.appendChild(s); r.spans.push(s); }
      else r.el.textContent = str;
      r.str = str; r.per = per;
    }
    r.used = FID;
    const fam = FAM[o.font || 'd'], size = o.size, base = BASE[fam] * size;
    const wght = o.wght ?? 400, wdth = o.wdth ?? 100;
    const st = r.el.style;
    st.display = 'block';
    st.fontFamily = fam;
    st.fontSize = size + 'px';
    st.color = o.color || C.ink;
    st.letterSpacing = (o.ls || 0) + 'em';
    st.fontVariationSettings = axes(fam, wght, wdth);
    st.zIndex = o.z || 0;
    const ax = o.ax || 0, sc = o.sc ?? 1;
    st.transform = `translate(${o.x}px,${o.y}px) rotate(${o.rot || 0}deg) scale(${sc * (o.sx ?? 1)},${sc * (o.sy ?? 1)}) translate(${-ax * 100}%,${-base}px)`;
    st.clipPath = o.clip ? `inset(${o.clip.map((v) => v + 'px').join(' ')})` : 'none';
    if (per) {
      const n = r.spans.length;
      for (let i = 0; i < n; i++) {
        const L = o.letters(i, n, r.str[i]) || {};
        const s = r.spans[i].style;
        s.transformOrigin = `50% ${base}px`;
        s.transform = `translate(${L.x || 0}px,${L.y || 0}px) rotate(${L.rot || 0}deg) scale(${L.sx ?? 1},${L.sy ?? 1})`;
        s.fontVariationSettings = axes(fam, L.wght ?? wght, L.wdth ?? wdth);
        s.color = L.color || '';
        s.visibility = L.hide ? 'hidden' : '';
      }
    }
  }
  function sweepPool() {
    for (const r of pool.values()) if (r.used !== FID && r.el.style.display !== 'none') r.el.style.display = 'none';
  }
  // clip that cuts at the baseline (for letters rising out of a floor)
  const floorClip = (size, fam = 'Disp', extra = 0) => [-900, -900, size - BASE[fam] * size - extra, -900];

  // measurement (cached; done with the same per-letter spans the film renders)
  const mdiv = document.createElement('div');
  mdiv.style.cssText = 'position:absolute;left:0;top:0;visibility:hidden;white-space:pre;line-height:1';
  const mcache = new Map();
  function measure(str, size, wght = 400, wdth = 100, font = 'd', ls = 0) {
    const key = [str, size, wght, wdth, font, ls].join('|');
    if (mcache.has(key)) return mcache.get(key);
    const fam = FAM[font];
    mdiv.style.fontFamily = fam; mdiv.style.fontSize = size + 'px'; mdiv.style.letterSpacing = ls + 'em';
    mdiv.style.fontVariationSettings = axes(fam, wght, wdth);
    mdiv.textContent = '';
    const spans = [...str].map((ch) => { const s = document.createElement('span'); s.style.display = 'inline-block'; s.textContent = ch; mdiv.appendChild(s); return s; });
    const x0 = mdiv.getBoundingClientRect().left;
    const xs = spans.map((s) => { const r = s.getBoundingClientRect(); return { l: r.left - x0, w: r.width, c: r.left - x0 + r.width / 2 }; });
    const res = { w: mdiv.getBoundingClientRect().width, xs };
    mcache.set(key, res);
    return res;
  }

  // ---------- canvas helpers ----------
  let cam = { s: 1, x: 0, y: 0 };
  function applyCam(ctx) { ctx.setTransform(cam.s, 0, 0, cam.s, cam.x, cam.y); }
  function camAbout(s, fx, fy, sx = fx, sy = fy) { cam = { s, x: sx - fx * s, y: sy - fy * s }; }
  function fillScreen(ctx, col) { ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = col; ctx.fillRect(0, 0, W, H); ctx.restore(); }
  function ellipse(ctx, x, y, rx, ry, rot, col) {
    ctx.beginPath(); ctx.ellipse(x, y, Math.max(0.01, rx), Math.max(0.01, ry), rot, 0, TAU); ctx.fillStyle = col; ctx.fill();
  }
  function diamond(ctx, x, y, s, fill, stroke, lw = 2.5) {
    ctx.beginPath(); ctx.moveTo(x, y - s); ctx.lineTo(x + s, y); ctx.lineTo(x, y + s); ctx.lineTo(x - s, y); ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
  }
  // shape library as radius-by-angle tables so any two morph cleanly
  const NP = 120;
  const SH = [0, 1, 2, 3].map((k) => {
    const a = new Float32Array(NP);
    for (let i = 0; i < NP; i++) {
      const th = (i / NP) * TAU;
      if (k === 0) a[i] = 0.88 / Math.max(Math.abs(Math.cos(th)), Math.abs(Math.sin(th)));           // square
      else if (k === 1) a[i] = 1;                                                                       // circle
      else if (k === 2) { const n = 3, s = TAU / n, u = ((th + Math.PI / 2) % s + s) % s; a[i] = 1.25 * Math.cos(Math.PI / n) / Math.cos(u - Math.PI / n); } // triangle
      else { const n = 4, s = TAU / n, u = (((th) % s) + s) % s / s; const w = Math.abs(2 * u - 1); a[i] = 0.5 + 0.8 * Math.pow(w, 2.2); } // 4-point star
    }
    return a;
  });
  function shape(ctx, ka, kb, p, x, y, size, rot, fill, stroke, lw = 3) {
    const A = SH[((ka % 4) + 4) % 4], B = SH[((kb % 4) + 4) % 4];
    ctx.beginPath();
    for (let i = 0; i < NP; i++) {
      const th = (i / NP) * TAU, r = lerp(A[i], B[i], p) * size;
      const px = x + Math.cos(th + rot) * r, py = y + Math.sin(th + rot) * r;
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
  }
  function ballAt(ctx, x, y, r, sx, sy, rot, col) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.scale(sx, sy);
    ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fillStyle = col; ctx.fill(); ctx.restore();
  }
  // parabolic hop path through keys [{b,x,y,h}]; h = apex height of the hop arriving at that key
  function hopPath(keys, b) {
    if (b <= keys[0].b) return { x: keys[0].x, y: keys[0].y };
    for (let i = 1; i < keys.length; i++) {
      const k0 = keys[i - 1], k1 = keys[i];
      if (b <= k1.b) {
        const u = (b - k0.b) / (k1.b - k0.b);
        return { x: lerp(k0.x, k1.x, u), y: lerp(k0.y, k1.y, u) - 4 * k1.h * u * (1 - u) };
      }
    }
    const k = keys[keys.length - 1];
    return { x: k.x, y: k.y };
  }
  // squash on landing, stretch along velocity in flight
  function ballPose(pathFn, b, landings, r, floorY) {
    const p = pathFn(b), q = pathFn(b + 0.01);
    const vx = (q.x - p.x) / 0.01, vy = (q.y - p.y) / 0.01, v = Math.hypot(vx, vy);
    let st = 1 + clamp((v - 900) / 5000, 0, 0.42), rot = Math.atan2(vy, vx), sx = st, sy = 1 / st;
    let k = 0;
    for (const lb of landings) { const d = b - lb; if (d >= -0.015 && d < 0.4) k = Math.max(k, Math.exp(-Math.max(0, d) * 16) * (d < 0 ? 0.5 : 1)); }
    if (k > 0.02) {
      const sq = 1 - 0.42 * k;
      sx = lerp(sx, 1 / Math.sqrt(sq) * (1 + 0.15 * k), k); sy = lerp(sy, sq, k); rot = lerp(rot, 0, k);
      if (p.y > floorY - r * 1.2) p.y = Math.max(p.y, floorY - r * sy);
    }
    return { x: p.x, y: p.y, sx, sy, rot };
  }

  // ---------- layout (filled in init once fonts are live) ----------
  const L = {};
  function init() {
    document.body.appendChild(mdiv);
    for (const fam of ['Disp', 'Mono']) {
      const d = document.createElement('div');
      d.style.cssText = `position:absolute;visibility:hidden;font-family:${fam};font-size:100px;line-height:1;white-space:pre`;
      d.innerHTML = 'H<span style="display:inline-block;width:1px;height:0"></span>';
      document.body.appendChild(d);
      BASE[fam] = d.lastChild.offsetTop / 100;
      d.remove();
      const cx = document.createElement('canvas').getContext('2d');
      cx.font = `400 100px ${fam}`;
      CAP[fam] = cx.measureText('H').actualBoundingBoxAscent / 100;
    }
    // opening name
    const N = { size: 330, wght: 820, wdth: 100, x: 190, base: 700 };
    N.m = measure('CLAUDE', N.size, N.wght, N.wdth);
    N.cx = N.m.xs.map((s) => N.x + s.c);
    N.r = 0.105 * N.size;
    N.px = N.x + N.m.w + 0.06 * N.size + N.r;
    N.fy = N.base - N.r;
    L.N = N;
    // S1 kinetic type
    const m1 = measure('MOTION', 100, 900, 125), m2 = measure('DESIGNER', 100, 900, 100);
    const S1 = { x: 150, size1: 1480 / m1.w * 100, size2: 1620 / m2.w * 100 };
    const cap1 = CAP.Disp * S1.size1, cap2 = CAP.Disp * S1.size2, gap = 0.13 * S1.size2, mono = 100;
    const top = (H - (cap1 + gap + cap2 + mono)) / 2;
    S1.base1 = top + cap1; S1.base2 = S1.base1 + gap + cap2; S1.baseM = S1.base2 + mono;
    L.S1 = S1;
    // S2 stack of rows
    const S2 = { size: 124 / CAP.Disp, rows: 6, sp: 166 };
    S2.cap = CAP.Disp * S2.size;
    S2.yc = [...Array(S2.rows)].map((_, r) => H / 2 + (r - 2.5) * S2.sp);
    S2.rowW = measure('MOTION', S2.size, 520, 94).w;
    L.S2 = S2;
    // S3 lanes
    L.lanes = {
      keys: ['linear', 'sine', 'expo', 'back', 'elastic', 'bounce'],
      names: ['linear', 'easeInOutSine', 'easeOutExpo', 'easeOutBack', 'easeOutElastic', 'easeOutBounce'],
      y: [...Array(6)].map((_, r) => H / 2 + (r - 2.5) * 150),
      x0: 720, x1: 1720, sq: 58,
    };
    // S4 timeline
    L.tl = {
      top: 612, ty: [718, 808, 898, 988], x0: 470, x1: 1800, b0: 15.75, b1: 20.25,
      tracks: ['position', 'scale', 'rotation', 'fill'],
      kf: [
        { tr: 0, b: 16 }, { tr: 0, b: 17 }, { tr: 0, b: 18 }, { tr: 0, b: 19.5 },
        { tr: 1, b: 16 }, { tr: 1, b: 18 }, { tr: 1, b: 19 },
        { tr: 2, b: 16.5 }, { tr: 2, b: 17.5 }, { tr: 2, b: 19 },
        { tr: 3, b: 18 }, { tr: 3, b: 19.5 },
      ],
      fly: [0, 4, 7, 1, 8, 5],
      vals: {
        x: [[16, 520], [17, 960], [18, 1400], [19.5, 960]],
        s: [[16, 1], [18, 1.45], [19, 0.85]],
        r: [[16.5, 0], [17.5, 90], [19, 225]],
        f: [[18, 0], [19.5, 1]],
      },
    };
    // end card
    const EN = { size: 300, wght: 820, wdth: 100, x: 150, base: 560 };
    EN.m = measure('CLAUDE', EN.size, EN.wght, EN.wdth);
    EN.r = 0.105 * EN.size;
    EN.px = EN.x + EN.m.w + 0.06 * EN.size + EN.r;
    EN.fy = EN.base - EN.r;
    L.EN = EN;
  }
  const xOf = (b) => L.tl.x0 + (b - L.tl.b0) / (L.tl.b1 - L.tl.b0) * (L.tl.x1 - L.tl.x0);
  function kfVal(list, b) {
    if (b <= list[0][0]) return list[0][1];
    for (let i = 1; i < list.length; i++) if (b <= list[i][0]) {
      const [b0, v0] = list[i - 1], [b1, v1] = list[i];
      return lerp(v0, v1, E.inOutExpo((b - b0) / (b1 - b0)));
    }
    return list[list.length - 1][1];
  }

  // ============ S0 · the ball writes the name (beats 0-4.9) ============
  function s0Keys() {
    const N = L.N, keys = [{ b: 0, x: N.cx[0] - 520, y: 330, h: 0 }];
    N.cx.forEach((x, i) => keys.push({ b: 1 + i * 0.5, x, y: N.fy, h: i === 0 ? 420 : 300 }));
    keys.push({ b: 4, x: N.px, y: N.fy, h: 330 });
    return keys;
  }
  function S0(b, t) {
    const N = L.N, keys = s0Keys();
    fillScreen(bg, C.paper);
    // floor line snaps out from the first impact
    if (b >= 1) {
      const u = E.expo(seg(b, 1, 1.55));
      const xa = lerp(N.cx[0], 110, u), xb = lerp(N.cx[0], 1810, u);
      bg.fillStyle = C.ink; bg.fillRect(xa, N.base, xb - xa, 5);
    }
    // letters spring out of the floor where the ball lands
    text('name', 'CLAUDE', {
      x: N.x, y: N.base, size: N.size, wght: N.wght, wdth: N.wdth, color: C.ink, clip: floorClip(N.size),
      letters: (i) => {
        const tt = (b - (1 + i * 0.5)) * P, r = spr(tt, 3.0, 0.38);
        return { y: (1 - r) * N.size * 0.92, sy: 1 + 0.18 * Math.max(0, 1 - r) * (tt > 0 ? 1 : 0), sx: 1 - 0.08 * Math.max(0, 1 - r) };
      },
    });
    // animator's motion path: the ball's future, dotted, with keyframes and a tangent handle
    if (b < 3.95) {
      fg.fillStyle = C.ink;
      for (let bb = Math.max(0, b + 0.02); bb < Math.min(4, b + 1.15); bb += 0.014) {
        const p = hopPath(keys, bb), a = 0.5 * (1 - (bb - b) / 1.15);
        fg.globalAlpha = a; fg.beginPath(); fg.arc(p.x, p.y, 3.2, 0, TAU); fg.fill();
      }
      fg.globalAlpha = 1;
      const next = keys.find((k) => k.b > b + 0.02);
      for (const k of keys.slice(1)) {
        if (k.b <= b + 0.02 || k.b > b + 1.15) continue;
        const a = 1 - (k.b - b) / 1.15;
        fg.strokeStyle = alpha(C.ink, 0.8 * a); fg.lineWidth = 2.5;
        fg.strokeRect(k.x - 8, k.y - 8, 16, 16);
        if (k === next) {
          fg.strokeStyle = alpha(C.clay, a); fg.lineWidth = 2;
          fg.beginPath(); fg.moveTo(k.x - 70, k.y); fg.lineTo(k.x + 70, k.y); fg.stroke();
          for (const hx of [-70, 70]) { fg.beginPath(); fg.arc(k.x + hx, k.y, 6, 0, TAU); fg.fillStyle = C.clay; fg.fill(); }
        }
      }
    }
    // the ball
    const lands = keys.slice(1).map((k) => k.b);
    let pose;
    if (b < 4) pose = ballPose((x) => hopPath(keys, x), b, lands, N.r, N.base);
    else {
      const d = (b - 4) * P, k = Math.exp(-d * 9) * Math.cos(d * 38);
      pose = { x: N.px, sx: 1 + 0.4 * k, sy: 1 - 0.42 * k, rot: 0 };
      pose.y = N.base - N.r * pose.sy;
    }
    ballAt(fg, pose.x, pose.y, N.r, pose.sx, pose.sy, pose.rot, C.clay);
  }
  function camS0(b, frame) {
    const N = L.N, s0 = 1 + 0.035 * E.inOutCubic(seg(b, 0, 4));
    let sh = b >= 4 ? 16 * Math.exp(-(b - 4) * P * 9) : 0;
    const jx = (hash(frame, 1) - 0.5) * 2 * sh, jy = (hash(frame, 2) - 0.5) * 2 * sh;
    if (b < 1.05) {
      // open on an extreme close-up of the ball, pull back as it is thrown into frame
      const e = E.inOutCubic(seg(b, 0, 1.0)), s = Math.exp(lerp(Math.log(9), Math.log(s0), e));
      const keys = s0Keys(), p = hopPath(keys, b);
      const nx = 960 + (p.x - 960) * s0, ny = 540 + (p.y - 540) * s0;
      camAbout(s, p.x, p.y, lerp(960, nx, e), lerp(560, ny, e));
      return;
    }
    if (b < 4.05) { camAbout(s0, 960, 540, 960 + jx, 540 + jy); return; }
    const u = seg(b, 4.05, 4.9);
    const dip = 1 - 0.04 * bump(seg(b, 4.0, 4.3));   // anticipation before the push
    const s = Math.exp(lerp(Math.log(s0), Math.log(52), E.inQuart(u))) * dip;
    const sx0 = 960 + (N.px - 960) * s0, sy0 = 540 + (N.fy - 540) * s0;
    const e = E.inOutCubic(u);
    camAbout(s, N.px, N.fy, lerp(sx0, 960, e) + jx, lerp(sy0, 540, e) + jy);
  }

  // ============ S1 · MOTION / DESIGNER (beats 4.9-8) ============
  function S1(b, t) {
    const S = L.S1, S2 = L.S2;
    // MOTION: rises out of its baseline while stretching wide, then travels into the stack
    const uT = E.inOutExpo(seg(b, 7.5, 8.0));
    const size = lerp(S.size1, S2.size, uT);
    const mBase = lerp(S.base1, S2.yc[2] + S2.cap / 2, uT);
    text('motion', 'MOTION', {
      x: lerp(S.x, 960, uT), ax: lerp(0, 0.5, uT), y: mBase, size, wght: 900, wdth: 125, color: C.ink, z: 3,
      clip: floorClip(size, 'Disp', 6),
      letters: (i) => {
        const d = i * 0.05;
        return {
          y: (1 - E.expo(seg(b, 5 + d, 5.55 + d))) * size * 0.98,
          wdth: lerp(62, 125, E.expo(seg(b, 5 + d, 5.85 + d))) - 48 * bump(seg(b, 7 + d, 7.42 + d)),
        };
      },
    });
    // DESIGNER: tracks in from the right, drops out through its baseline
    if (b >= 6 && b < 8) {
      const u = E.expo(seg(b, 6, 6.6));
      text('designer', 'DESIGNER', {
        x: lerp(2000, S.x, u), y: S.base2, size: S.size2, wght: 900, wdth: 100, color: C.ink,
        ls: lerp(0.9, 0, E.expo(seg(b, 6, 6.8))), clip: floorClip(S.size2, 'Disp', 6),
        letters: (i) => {
          const d = i * 0.028;
          return {
            y: S.size2 * 0.98 * E.inExpo(seg(b, 7.22 + d, 7.5 + d)),
            wdth: 100 - 20 * bump(seg(b, 7.0 + i * 0.025, 7.28 + i * 0.025)),
          };
        },
      });
    }
    // typed UI line + cursor
    if (b >= 6.5 && b < 7.9) {
      const str = 'motion design showreel · 2026';
      const n = Math.floor(seg(b, 6.5, 6.5 + str.length * 0.028) * str.length);
      const mw = measure(str, 46, 500, 100, 'm');
      const wipe = mw.w * E.inExpo(seg(b, 7.2, 7.5));
      text('s1mono', str.slice(0, n), { x: S.x + 4, y: S.baseM, size: 46, font: 'm', wght: 500, color: C.ink, clip: [-40, -40, -40, wipe] });
      const cx = S.x + 4 + (n < str.length ? mw.xs[n]?.l ?? mw.w : mw.w + 6);
      if ((n < str.length || Math.floor(b * 4) % 2 === 0) && b < 7.2) {
        fg.fillStyle = C.ink; fg.fillRect(cx, S.baseM - CAP.Mono * 46, 26, CAP.Mono * 46 + 2);
      }
    }
  }

  // ============ S2 · the variable-font wave (beats 8-12.2) ============
  function S2(b, t) {
    const S = L.S2;
    const amp = E.cubic(seg(b, 8.05, 8.7));
    const flat = 1 - 0.975 * E.inExpo(seg(b, 11.45, 11.8));
    const hi = b < 10 ? 2 : Math.floor((b - 10) * 4) % 6;
    if (b < 11.8) {
      for (let r = 0; r < S.rows; r++) {
        const d = Math.abs(r - 2) * 0.05;
        const yc = lerp(S.yc[2], S.yc[r], E.expo(seg(b, 8 + d, 8.55 + d)));
        text('row' + r, 'MOTION', {
          x: 960, ax: 0.5, y: yc + flat * S.cap / 2, sy: flat, size: S.size, wght: 900, wdth: 125,
          color: r === hi ? C.paper : C.ink, z: r === 2 ? 2 : 1,
          letters: (i) => {
            const ph = warp(b) * 1.9 - r * 0.75 - i * 0.6;
            return {
              wght: 900 - amp * 780 * (0.5 - 0.5 * Math.cos(ph)),
              wdth: 125 - amp * 63 * (0.5 - 0.5 * Math.cos(ph + 0.5)),
            };
          },
        });
      }
    } else {
      // the rows become bars that grow until the frame is ink
      for (let r = 0; r < S.rows; r++) {
        const d = Math.abs(r - 2.5) * 0.03;
        const w = lerp(S.rowW, 2200, E.expo(seg(b, 11.8 + d, 12.12 + d)));
        const h = lerp(S.cap * 0.025, 180, E.inOutCubic(seg(b, 11.84 + d, 12.14 + d)));
        bg.fillStyle = C.ink; bg.fillRect(960 - w / 2, S.yc[r] - h / 2, w, h);
      }
    }
  }

  // ============ S3 + S4 · easing race -> keyframe timeline (beats 12.1-20) ============
  function panelTop(b) {
    if (b < 15.4) return 0;
    if (b < 19.55) return lerp(0, L.tl.top, E.expo(seg(b, 15.4, 16.0)));
    return lerp(L.tl.top, 0, E.inOutExpo(seg(b, 19.55, 20.0)));
  }
  function S34(b, t, frame) {
    const LN = L.lanes, TL = L.tl, pt = panelTop(b);
    fillScreen(bg, C.paper);
    bg.fillStyle = C.ink; bg.fillRect(-200, pt, W + 400, H - pt + 400);

    // ---- S3 lanes ----
    if (b < 15.6) {
      const u = seg(b, 12.5, 14.5);
      LN.keys.forEach((k, r) => {
        const y = LN.y[r], d = r * 0.03, ease = E[k];
        // lane rule: draws on, then retracts into the diamond
        const xa = lerp(LN.x0, LN.x1, E.inExpo(seg(b, 14.9 + d, 15.3 + d)));
        const xb = lerp(LN.x0, LN.x1, E.expo(seg(b, 12.1 + d, 12.5 + d)));
        bg.fillStyle = alpha(C.paper, 0.16); bg.fillRect(xa, y - 1, xb - xa, 2);
        const x = LN.x0 + (LN.x1 - LN.x0) * ease(u);
        if (x > xa) { bg.fillStyle = C.clay; bg.fillRect(xa, y - 1.5, Math.max(0, x - xa), 3); }
        // label, typed in / wiped out
        const name = LN.names[r];
        const n = Math.floor(seg(b, 12.12 + d, 12.5 + d) * name.length);
        const mw = measure(name, 44, 500, 100, 'm');
        const wipe = mw.w * E.inExpo(seg(b, 14.85 + d, 15.2 + d));
        text('lane' + r, name.slice(0, n), { x: 100, y: y + 16, size: 44, font: 'm', wght: 500, color: alpha(C.paper, 0.7), clip: [-20, wipe - 4, -20, -20] });
        // curve glyph with a dot riding it
        const gx = 540, gw = 110, gh = 70, gp = seg(b, 12.15 + d, 12.55 + d) * (1 - seg(b, 14.85 + d, 15.2 + d));
        if (gp > 0) {
          bg.strokeStyle = alpha(C.paper, 0.5); bg.lineWidth = 3; bg.beginPath();
          for (let s = 0; s <= 40 * gp; s++) { const q = s / 40, px = gx + q * gw, py = y + gh / 2 - ease(q) * gh; s ? bg.lineTo(px, py) : bg.moveTo(px, py); }
          bg.stroke();
          if (u > 0 && u < 1 || b < 15) { bg.fillStyle = C.clay; bg.beginPath(); bg.arc(gx + u * gw, y + gh / 2 - ease(u) * gh, 8, 0, TAU); bg.fill(); }
        }
        // onion skin
        if (u > 0 && u < 1.2) for (let g = 5; g >= 1; g--) {
          const ug = clamp(u - g * 0.03), gxp = LN.x0 + (LN.x1 - LN.x0) * ease(ug);
          if (Math.abs(gxp - x) < 6) continue;
          fg.strokeStyle = alpha(C.paper, 0.3 * (1 - g / 6)); fg.lineWidth = 2;
          fg.strokeRect(gxp - LN.sq / 2, y - LN.sq / 2, LN.sq, LN.sq);
        }
        // square -> diamond
        const pop = spr((b - (12.2 + r * 0.035)) * P, 3.6, 0.45);
        const hit = 1 + 0.22 * Math.exp(-Math.max(0, b - 14.5) * 9) * (b >= 14.5 ? 1 : 0);
        const dm = E.back(seg(b, 14.75 + r * 0.07, 15.1 + r * 0.07));
        if (b < 15.45 + r * 0.04) {
          const s = lerp(LN.sq, 42, dm) * pop * hit;
          fg.save(); fg.translate(x, y); fg.rotate(dm * Math.PI / 4);
          fg.fillStyle = C.clay; fg.fillRect(-s / 2, -s / 2, s, s); fg.restore();
        }
      });
    }

    // ---- S4 timeline ----
    if (b >= 15.4) {
      const off = 540 * E.inExpo(seg(b, 19.5, 19.9));
      const ty = TL.ty.map((y) => y + off);
      const phX = xOf(Math.max(b, TL.b0));
      const reached = (kb) => b >= kb;
      // ruler
      if (b > 15.8) {
        const ru = seg(b, 15.8, 16.2);
        for (let q = 0; q <= 18; q++) {
          const bb = TL.b0 + q * 0.25, x = xOf(bb);
          if (x > lerp(TL.x0, TL.x1 + 10, E.expo(ru))) break;
          const major = Math.abs(bb - Math.round(bb)) < 1e-6;
          bg.fillStyle = alpha(C.paper, major ? 0.5 : 0.2);
          bg.fillRect(x - 1, TL.top + 28 + off + (major ? 0 : 10), 2, major ? 24 : 14);
          if (major) text('rul' + bb, 'f' + Math.round(bT(bb) * FPS), { x: x + 8, y: TL.top + 46 + off, size: 22, font: 'm', wght: 500, color: alpha(C.paper, 0.45) });
        }
        bg.fillStyle = C.ink3; bg.fillRect(0, TL.top + 60 + off, W, 2);
      }
      // tracks
      TL.tracks.forEach((name, tr) => {
        const n = Math.floor(seg(b, 15.85 + tr * 0.06, 16.2 + tr * 0.06) * name.length);
        text('trk' + tr, name.slice(0, n), { x: 100, y: ty[tr] + 15, size: 42, font: 'm', wght: 500, color: alpha(C.paper, 0.7) });
        bg.fillStyle = C.ink2; bg.fillRect(TL.x0 - 30, ty[tr] - 30, TL.x1 - TL.x0 + 60, 60);
        const ks = TL.kf.filter((k) => k.tr === tr);
        for (let i = 1; i < ks.length; i++) {
          const xa = xOf(ks[i - 1].b), xb = xOf(ks[i].b), full = reached(ks[i].b);
          bg.fillStyle = full ? alpha(C.clay, 0.55) : alpha(C.paper, 0.22);
          const xe = full ? xb : clamp(phX, xa, xb);
          if (reached(ks[i - 1].b)) { bg.fillStyle = alpha(C.clay, 0.55); bg.fillRect(xa, ty[tr] - 1.5, xe - xa, 3); }
          bg.fillStyle = alpha(C.paper, 0.22); bg.fillRect(xe, ty[tr] - 1, xb - xe, 2);
        }
      });
      // keyframes: six fly in from the race, the rest pop in
      TL.kf.forEach((k, j) => {
        const fi = TL.fly.indexOf(k), tx = xOf(k.b), tyy = ty[k.tr];
        let x = tx, y = tyy, s = 17, pop = 1, flying = false;
        if (fi >= 0) {
          const u = E.inOutExpo(seg(b, 15.45 + fi * 0.04, 16.0 + fi * 0.04));
          x = lerp(L.lanes.x1, tx, u); y = lerp(L.lanes.y[fi], tyy, u) - 90 * Math.sin(Math.PI * u);
          s = lerp(21, 17, u); flying = u < 1;
          if (b < 15.45 + fi * 0.04) return;
        } else {
          const order = TL.kf.filter((q) => TL.fly.indexOf(q) < 0).indexOf(k);
          pop = spr((b - (16.0 + order * 0.07)) * P, 3.4, 0.4);
          if (pop <= 0) return;
        }
        const on = reached(k.b);
        const hitPop = on ? 1 + 0.5 * Math.exp(-(b - k.b) * P * 14) : 1;
        if (flying || on) diamond(fg, x, y, s * pop * hitPop, C.clay, null);
        else diamond(fg, x, y, s * pop, C.ink, alpha(C.paper, 0.85), 2.5);
      });
      // playhead
      if (b >= 15.85) {
        const dy = -70 * (1 - E.back(seg(b, 15.85, 16.2))) + off;
        fg.fillStyle = C.clay;
        fg.fillRect(phX - 1.5, TL.top + 48 + dy, 3, H);
        const hw = 104, hy = TL.top + 8 + dy;
        fg.beginPath(); fg.roundRect(phX - hw / 2, hy, hw, 40, 6); fg.fill();
        fg.fillStyle = C.ink; fg.font = '700 26px Mono'; fg.textAlign = 'center';
        fg.fillText(String(frame).padStart(4, '0'), phX, hy + 29); fg.textAlign = 'left';
      }
      // stage: the object these keyframes drive
      if (b >= 15.95) {
        const V = TL.vals;
        const px = kfVal(V.x, b), ps = kfVal(V.s, b), pr = kfVal(V.r, b), pf = kfVal(V.f, b);
        const pop = spr((b - 15.95) * P, 3.2, 0.42);
        const py = lerp(318, 540, E.inOutExpo(seg(b, 19.55, 20.0)));
        // its motion path, the same language as the opening
        if (b < 19.5) {
          const pa = E.expo(seg(b, 16.0, 16.5));
          fg.fillStyle = alpha(C.ink, 0.35);
          for (let x = 520; x <= lerp(520, 1400, pa); x += 22) { fg.beginPath(); fg.arc(x, 318, 3, 0, TAU); fg.fill(); }
          for (const [kb, kx] of V.x) if (kx <= lerp(520, 1400, pa) && kb < 19.5) { fg.strokeStyle = alpha(C.ink, 0.7); fg.lineWidth = 2.5; fg.strokeRect(kx - 8, 318 - 8, 16, 16); }
          const ro = `x ${Math.round(px)}   s ${ps.toFixed(2)}   r ${Math.round(pr)}°`;
          const hide = seg(b, 19.3, 19.5);
          text('readout', ro, { x: px, ax: 0.5, y: 318 + 150 * Math.max(1, ps) * 0.7 + 58, size: 36, font: 'm', wght: 500, color: alpha(C.ink, 0.6), clip: [-20, -20, lerp(-20, 40, hide), -20] });
        }
        const s = 170 * ps * pop;
        fg.save(); fg.translate(px, py); fg.rotate(pr * Math.PI / 180);
        fg.fillStyle = mix(C.ink, C.clay, pf); fg.fillRect(-s / 2, -s / 2, s, s); fg.restore();
      }
    }
  }

  // ============ S5 · radial repeater (beats 20-24, lives on in the grid) ============
  function ringFrame(ctx, b) {
    ctx.fillStyle = C.ink; ctx.fillRect(-200, -200, W + 400, H + 400);
    const cx = 960, cy = 540, N = 24;
    const pulse = b >= 20.7 ? 1 + 0.05 * Math.exp(-frac(b) * 7) : 1;
    const spin = warp(Math.max(0, b - 20)) * 0.42;
    // outer dot ring
    if (b >= 22.5) {
      const shown = E.cubic(seg(b, 22.5, 23.1)) * 72;
      ctx.fillStyle = C.mid;
      for (let j = 0; j < shown; j++) {
        const a = (j / 72) * TAU - spin * 0.25 - Math.PI / 2;
        ctx.beginPath(); ctx.arc(cx + Math.cos(a) * 455 * pulse, cy + Math.sin(a) * 455 * pulse, 4, 0, TAU); ctx.fill();
      }
    }
    // inner counter-rotating outline ring
    if (b >= 21.5) {
      for (let k = 0; k < 12; k++) {
        const u = E.expo(seg(b, 21.5 + k * 0.012, 22.1 + k * 0.012));
        if (u <= 0) continue;
        const a = (k / 12) * TAU - spin * 1.4;
        const m = Math.max(0, b - 20 - k * 0.02 - 1) + 2;
        const i = Math.floor(m), p = E.inOutExpo(clamp(frac(m) / 0.45));
        shape(ctx, i, i + 1, p, cx + Math.cos(a) * 175 * u * pulse, cy + Math.sin(a) * 175 * u * pulse, 30 * u, a + spin, null, C.paper, 3);
      }
    }
    // main ring: the keyed square unfurls into 24 copies, morphing on each beat
    for (let k = N - 1; k >= 0; k--) {
      const u = E.expo(seg(b, 20 + k * 0.007, 20.75 + k * 0.007));
      const th = (k / N) * TAU + spin;
      const R = 330 * u * pulse;
      const m = Math.max(0, b - 20 - k * 0.02 - 1);
      const i = Math.floor(m), p = E.inOutExpo(clamp(frac(m) / 0.45));
      const size = lerp(82, 36, u);
      const rot = (225 * Math.PI / 180) + th * u;
      shape(ctx, i, i + 1, p, cx + Math.cos(th) * R, cy + Math.sin(th) * R, size, rot, C.clay, null);
    }
  }
  function S5(b, t) {
    ringFrame(bg, b);
    const deg = Math.round(((warp(Math.max(0, b - 20)) * 0.42) * 180 / Math.PI) % 360);
    const lines = ['repeater ×24', 'offset  0.02', `rotate  ${String(deg).padStart(3, ' ')}°`];
    lines.forEach((s, j) => {
      const n = Math.floor(seg(b, 20.6 + j * 0.15, 20.9 + j * 0.15) * s.length);
      const mw = measure(s, 42, 500, 100, 'm');
      const wipe = mw.w * E.inExpo(seg(b, 23.6 + j * 0.05, 23.9 + j * 0.05));
      text('rep' + j, s.slice(0, n), { x: 100, y: 478 + j * 64, size: 42, font: 'm', wght: 500, color: alpha(C.paper, j === 2 ? 0.85 : 0.55), clip: [-20, wipe - 2, -20, -20] });
    });
  }

  // ============ S6 · grid montage (beats 24-28) ============
  const LIB = ['ball', 'weight', 'ease', 'counter', 'sines', 'rings', 'morph', 'bars', 'stack', 'ring'];
  const GLYPHS = ['A', '&', 'g', 'R', '?', 'M'];
  function content(ctx, id, w, h, b, frame, seed) {
    const bgc = { ball: C.paper, weight: C.clay, ease: C.ink2, counter: C.paper, sines: C.ink, rings: C.clay, morph: C.paper, bars: C.ink2, stack: C.ink, paper: C.paper }[id];
    if (id === 'ring') { ctx.save(); const k = Math.max(w / W, h / H); ctx.translate(w / 2, h / 2); ctx.scale(k * 1.05, k * 1.05); ctx.translate(-960, -540); ringFrame(ctx, b); ctx.restore(); return; }
    ctx.fillStyle = bgc; ctx.fillRect(0, 0, w, h);
    const u = Math.min(w, h), ph = b + seed * 0.37;
    if (id === 'ball') {
      const fy = h * 0.8, r = u * 0.075, p = frac(ph), hy = 4 * p * (1 - p);
      const sq = Math.exp(-Math.min(p, 1 - p) * 30);
      ctx.fillStyle = C.ink; ctx.fillRect(w * 0.15, fy, w * 0.7, 4);
      const x = w / 2 + Math.sin(ph * Math.PI) * w * 0.22;
      ballAt(ctx, x, fy - r * (1 - 0.4 * sq) - hy * h * 0.5, r, 1 + 0.35 * sq - 0.15 * (1 - sq) * Math.abs(1 - 2 * p), 1 - 0.4 * sq + 0.2 * (1 - sq) * Math.abs(1 - 2 * p), 0, C.clay);
    } else if (id === 'weight') {
      const g = GLYPHS[(Math.floor(ph * 2) + seed) % GLYPHS.length], wt = Math.round(100 + 800 * (0.5 - 0.5 * Math.cos(ph * TAU)));
      ctx.fillStyle = C.ink; ctx.font = `${wt} ${u * 0.82}px Disp`; ctx.textAlign = 'center';
      ctx.fillText(g, w / 2, h / 2 + CAP.Disp * u * 0.41);
    } else if (id === 'ease') {
      const y = h / 2, x0 = w * 0.15, x1 = w * 0.85, s = u * 0.16;
      ctx.fillStyle = alpha(C.paper, 0.18); ctx.fillRect(x0, y - 1, x1 - x0, 2);
      const q = frac(ph * 0.5) * 2, dir = q < 1, e = E.inOutExpo(dir ? q : 2 - q);
      for (let g = 4; g >= 0; g--) {
        const qq = clamp((dir ? q : 2 - q) - (dir ? g : -g) * 0.035), ee = E.inOutExpo(qq), x = lerp(x0, x1, ee);
        if (g) { ctx.strokeStyle = alpha(C.paper, 0.3 * (1 - g / 5)); ctx.lineWidth = 2; ctx.strokeRect(x - s / 2, y - s / 2, s, s); }
      }
      ctx.fillStyle = C.paper; const x = lerp(x0, x1, e); ctx.fillRect(x - s / 2, y - s / 2, s, s);
    } else if (id === 'counter') {
      ctx.fillStyle = C.ink; ctx.textAlign = 'left';
      ctx.font = `700 ${u * 0.42}px Mono`;
      const str = String(frame).padStart(4, '0'), tw = ctx.measureText(str).width;
      ctx.fillText(str, w / 2 - tw / 2, h / 2 + CAP.Mono * u * 0.21);
      ctx.fillStyle = C.clay; ctx.font = `500 ${u * 0.075}px Mono`;
      ctx.fillText('frame / 900', w / 2 - tw / 2, h / 2 + CAP.Mono * u * 0.21 + u * 0.14);
    } else if (id === 'sines') {
      for (let j = 0; j < 7; j++) {
        ctx.strokeStyle = j === 3 ? C.clay : alpha(C.paper, 0.75); ctx.lineWidth = j === 3 ? 5 : 3; ctx.beginPath();
        const amp = u * 0.08 * (1 + 0.8 * Math.exp(-frac(b) * 5));
        for (let x = 0; x <= w; x += 8) { const y = h / 2 + (j - 3) * h * 0.11 + Math.sin(x / w * TAU * 1.5 + ph * Math.PI + j * 0.55) * amp; x ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
        ctx.stroke();
      }
    } else if (id === 'rings') {
      ctx.strokeStyle = C.ink;
      for (let j = 0; j < 7; j++) {
        const a = (frac(ph * 2) + j) / 7, r = a * Math.hypot(w, h) * 0.55;
        ctx.lineWidth = Math.max(0.5, 14 * (1 - a)); ctx.beginPath(); ctx.arc(w / 2, h / 2, r, 0, TAU); ctx.stroke();
      }
    } else if (id === 'morph') {
      const m = ph * 2, i = Math.floor(m), p = E.inOutExpo(clamp(frac(m) / 0.5));
      shape(ctx, i + seed, i + seed + 1, p, w / 2, h / 2, u * 0.3, ph * 1.2, C.ink, null);
    } else if (id === 'bars') {
      const n = 16, bw = w * 0.7 / n, env = 0.35 + 0.65 * Math.exp(-frac(b) * 4);
      for (let j = 0; j < n; j++) {
        const v = (0.2 + 0.8 * hash(j + seed * 31, Math.floor(b * 4))) * env * h * 0.62;
        ctx.fillStyle = C.clay; ctx.fillRect(w * 0.15 + j * bw + 3, h * 0.82 - v, bw - 6, v);
      }
    } else if (id === 'stack') {
      ctx.fillStyle = C.paper; ctx.textAlign = 'center';
      for (let r = 0; r < 5; r++) {
        const wt = Math.round(500 - 400 * Math.cos(warp(ph) * 1.9 - r * 0.8));
        ctx.font = `${wt} ${h * 0.17}px Disp`;
        ctx.fillStyle = r === 2 ? C.clay : C.paper;
        ctx.fillText('MOTION', w / 2, h * (0.2 + r * 0.17) + CAP.Disp * h * 0.085);
      }
    }
  }
  // per-cell schedule: [switchBeat, contentId]; flips straddle each switch
  function schedule2() {
    return [
      [[24, 'crop'], [24.3, 'ringfit'], [25.75, 'counter']],
      [[24, 'crop'], [24.25, 'ball'], [25, 'sines']],
      [[24, 'crop'], [24.375, 'weight'], [25.25, 'rings']],
      [[24, 'crop'], [24.5, 'ease'], [25.5, 'morph']],
    ];
  }
  function schedule3(i, j) {
    const d = i + j, k = i * 3 + j;
    return [[26 + d * 0.0625, LIB[k % LIB.length]], [26.5 + d * 0.0625, LIB[(k + 4) % LIB.length]],
      [27 + d * 0.0625, LIB[(k + 7) % LIB.length]], [27.5 + d * 0.05, 'paper']];
  }
  const FLIP = 0.22;
  function drawGrid(ctx, n, gap, sched, b, frame, fromCrop) {
    const cw = (W - (n - 1) * gap) / n, ch = (H - (n - 1) * gap) / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const idx = i * n + j, S = sched(i, j, idx), rx = j * (cw + gap), ry = i * (ch + gap);
      // which content, and the flip squash around each switch
      let cur = null, sx = 1;
      for (let q = 0; q < S.length; q++) {
        const [sb, id] = S[q];
        if (b >= sb - FLIP / 2) {
          if (id === 'ringfit' || (q === 0 && id === 'crop')) { cur = id; sx = 1; }
          else if (b < sb) { cur = S[q - 1] ? S[q - 1][1] : null; sx = Math.cos(Math.PI * (b - (sb - FLIP / 2)) / FLIP); }
          else if (b < sb + FLIP / 2) { cur = id; sx = Math.sin(Math.PI * (b - (sb - FLIP / 2)) / FLIP) * -1 * -1; sx = Math.abs(Math.cos(Math.PI * (b - (sb - FLIP / 2)) / FLIP)); }
          else { cur = id; sx = 1; }
        }
      }
      if (!cur) continue;
      ctx.save();
      ctx.translate(rx + cw / 2, ry + ch / 2); ctx.scale(Math.max(0.001, sx), 1); ctx.translate(-cw / 2, -ch / 2);
      ctx.beginPath(); ctx.rect(0, 0, cw, ch); ctx.clip();
      if (cur === 'crop') { ctx.translate(-rx, -ry); ringFrame(ctx, b); }
      else if (cur === 'ringfit') {
        // cell 0 eases from a crop of the full frame to the whole ring fitted inside it
        const u = E.inOutExpo(seg(b, 24.3, 24.8)), k = lerp(1, Math.max(cw / W, ch / H) * 1.05, u);
        ctx.translate(lerp(-rx, cw / 2, u), lerp(-ry, ch / 2, u)); ctx.scale(k, k);
        ctx.translate(lerp(0, -960, u), lerp(0, -540, u)); ringFrame(ctx, b);
      } else content(ctx, cur, cw, ch, b, frame, idx);
      ctx.restore();
    }
  }
  function S6(b, t, frame) {
    fillScreen(bg, C.ink);
    const closing = 1 - E.inOutCubic(seg(b, 27.8, 28));
    if (b < 26.45) {
      const gap = 14 * E.expo(seg(b, 24, 24.3));
      drawGrid(bg, 2, gap, (i, j, idx) => schedule2()[idx], b, frame);
    }
    if (b >= 25.9) drawGrid(bg, 3, 12 * closing, (i, j) => schedule3(i, j), b, frame);
  }

  // ============ S7 · end card (beats 27.5-32) ============
  function S7(b, t) {
    const EN = L.EN;
    if (b >= 28) fillScreen(bg, C.paper);
    // floor line
    if (b >= 28) {
      const u = E.expo(seg(b, 28, 28.5));
      const xa = lerp(EN.px, 110, u), xb = lerp(EN.px, 1810, u);
      bg.fillStyle = C.ink; bg.fillRect(xa, EN.base, xb - xa, 5);
      // name radiates out of the floor from the impact
      text('endname', 'CLAUDE', {
        x: EN.x, y: EN.base, size: EN.size, wght: EN.wght, wdth: EN.wdth, color: C.ink, clip: floorClip(EN.size, 'Disp', 3),
        letters: (i) => {
          const tt = (b - (28 + (5 - i) * 0.125)) * P, r = spr(tt, 3.0, 0.4);
          return { y: (1 - r) * EN.size * 0.92, wdth: 100 + 25 * Math.max(0, 1 - r) * (tt > 0 ? 1 : 0) };
        },
      });
      // role line
      const RS = 112, rb = EN.base + 150;
      text('role', 'Motion designer', {
        x: EN.x + 4, y: rb, size: RS, wght: 520, wdth: 100, color: C.ink, clip: floorClip(RS, 'Disp', 40),
        letters: (i) => ({ y: (1 - E.expo(seg(b, 29 + i * 0.02, 29.45 + i * 0.02))) * RS * 1.3 }),
      });
      // typed mono line
      const str = 'every frame is a function of time.';
      const n = Math.floor(seg(b, 29.5, 29.5 + str.length * 0.03) * str.length);
      const mb = rb + 96, mw = measure(str, 44, 500, 100, 'm');
      text('endmono', str.slice(0, n), { x: EN.x + 8, y: mb, size: 44, font: 'm', wght: 500, color: alpha(C.ink, 0.72) });
      if (b >= 29.5 && (n < str.length || Math.floor(b * 2) % 2 === 0)) {
        const cx = EN.x + 8 + (n < str.length ? (mw.xs[n]?.l ?? mw.w) : mw.w + 6);
        fg.fillStyle = C.clay; fg.fillRect(cx, mb - CAP.Mono * 44, 25, CAP.Mono * 44 + 2);
      }
      // skills list, revealed behind a sweeping clay bar
      const items = ['01  kinetic type', '02  easing & timing', '03  shape systems', '04  synthesized sound'];
      items.forEach((s, j) => {
        const x0 = 1810 - measure(items[3], 46, 500, 100, 'm').w, y = EN.base + 88 + j * 66, sb = 30 + j * 0.25, u = seg(b, sb, sb + 0.5);
        const mw2 = measure(s, 46, 500, 100, 'm'), w = mw2.w + 8;
        let barL = x0, barR = x0;
        if (u < 0.5) barR = x0 + w * E.expo(u * 2); else { barL = x0 + w * E.inOutExpo((u - 0.5) * 2); barR = x0 + w; }
        if (u >= 0.5) text('item' + j, s, {
          x: x0, y, size: 46, font: 'm', wght: 500, color: C.ink, clip: [-20, Math.max(0, w - (barL - x0)), -20, -20],
          letters: (i) => ({ color: i < 2 ? C.clay : undefined }),
        });
        if (u > 0 && u < 1) { fg.fillStyle = C.clay; fg.fillRect(barL - 4, y - CAP.Mono * 46 - 12, barR - barL, CAP.Mono * 46 + 24); }
      });
    }
    // the ball drops in, becomes the period, then takes one last hop
    let x = EN.px, y, sx = 1, sy = 1;
    if (b < 28) {
      const u = seg(b, 27.55, 28);
      y = lerp(-140, EN.fy, u * u);
      const st = 1 + 0.45 * u * u; sx = 1 / st; sy = st;
    } else {
      const d = (b - 28) * P;
      const land = Math.exp(-d * 8) * Math.cos(d * 36);
      sx = 1 + 0.45 * land; sy = 1 - 0.45 * land;
      const antic = bump(seg(b, 30.7, 31.0)) * 0.22;
      sy -= antic; sx += antic * 0.8;
      let hop = 0;
      if (b >= 31 && b < 31.5) { const q = seg(b, 31, 31.5); hop = 4 * 150 * q * (1 - q); const v = Math.abs(1 - 2 * q); sy += 0.25 * v; sx -= 0.18 * v; }
      if (b >= 31.5) { const d2 = (b - 31.5) * P, l2 = Math.exp(-d2 * 9) * Math.cos(d2 * 34); sx += 0.3 * l2; sy -= 0.3 * l2; }
      y = EN.base - EN.r * sy - hop;
    }
    ballAt(fg, x, y, EN.r, sx, sy, 0, C.clay);
  }

  // ============ frame ============
  function camFor(b, frame) {
    if (b < 4.9) return camS0(b, frame);
    let s = 1, sh = 0;
    if (b >= 4.9 && b < 27.5) s *= 1 + 0.007 * Math.exp(-frac(b) * 9);
    for (const [ib, a] of [[14.5, 6], [28, 16]]) if (b >= ib) sh += a * Math.exp(-(b - ib) * P * 9);
    if (b >= 28) s *= 1 + 0.02 * E.cubic(seg(b, 28, 32));
    camAbout(s, 960, 540, 960 + (hash(frame, 1) - 0.5) * 2 * sh, 540 + (hash(frame, 2) - 0.5) * 2 * sh);
  }
  function paint(t) {
    FID++;
    const frame = Math.round(t * FPS), b = tB(t);
    for (const ctx of [bg, fg]) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, W, H); ctx.globalAlpha = 1; }
    camFor(b, frame);
    applyCam(bg); applyCam(fg);
    layer.style.transform = `matrix(${cam.s},0,0,${cam.s},${cam.x},${cam.y})`;
    if (b < 4.9) S0(b, t);
    else if (b < 12.15) { fillScreen(bg, C.clay); if (b < 8) S1(b, t); if (b >= 8) S2(b, t); }
    else if (b < 20) S34(b, t, frame);
    else if (b < 24) S5(b, t);
    else if (b < 28) S6(b, t, frame);
    if (b >= 27.5) S7(b, t);
    sweepPool();
  }

  window.ready = (async () => {
    await Promise.all([
      document.fonts.load('900 100px Disp'), document.fonts.load('100 100px Disp'),
      document.fonts.load('500 30px Mono'), document.fonts.load('700 30px Mono'),
    ]);
    await document.fonts.ready;
    BEATS = await (await fetch('beats.json')).json();
    P = BEATS.period;
    init();
    window.DURATION = 15;
    return true;
  })();
  window.seek = (t) => paint(t);

  // preview only: real-time playback (never used in render mode)
  if (!/render/.test(location.search)) {
    document.body.classList.add('preview');
    const fit = () => { const k = Math.min(innerWidth / W, innerHeight / H); document.getElementById('stage').style.transform = `scale(${k})`; };
    addEventListener('resize', fit); fit();
    document.getElementById('aud').src = 'audio/score.wav';
    window.ready.then(() => paint(0));
    document.getElementById('play').addEventListener('click', async () => {
      await window.ready;
      document.body.classList.remove('preview');
      const aud = document.getElementById('aud');
      aud.currentTime = 0; aud.play();
      const loop = () => { paint(Math.min(aud.currentTime, 14.999)); if (!aud.ended) requestAnimationFrame(loop); };
      requestAnimationFrame(loop);
    });
  }
})();
