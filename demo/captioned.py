# Screen-recording tutorial: segments, speed ramps, eased zooms, step captions. Silent.
# python captioned.py SRC OUT.mp4 cuts/<name>.py [--sheet SHEET.png]
# Cut file defines SW, SH, SEGS, CAPS. Every output frame is a pure function of output time.
import subprocess, sys, math, runpy
import numpy as np, cv2
from PIL import Image, ImageDraw, ImageFont

SRC, OUT = sys.argv[1], sys.argv[2]
CUT = runpy.run_path(sys.argv[3])
SHEET = sys.argv[sys.argv.index('--sheet') + 1] if '--sheet' in sys.argv else None
SW, SH, SEGS, CAPS = CUT['SW'], CUT['SH'], CUT['SEGS'], CUT['CAPS']
BG = (255, 255, 255)
OW, OH, FPS = 1920, 1080, 60
XF = 18           # crossfade frames between segments
FADE_OUT = 1.0
ACCENT = (201, 100, 66)   # Claude clay, matches the send button in the recording
INK = (31, 30, 29)
FONT = '/Users/rishitgupta/Code/motion-studio/fonts/Archivo.ttf'

def ease(x):
    x = min(max(x, 0.0), 1.0)
    return x * x * (3 - 2 * x)

def view_at(keys, f):
    if f <= keys[0][0]: return keys[0][1]
    for (f0, a), (f1, b) in zip(keys, keys[1:]):
        if f <= f1:
            u = ease((f - f0) / (f1 - f0)) if f1 > f0 else 1.0
            cx = a[0] + (b[0] - a[0]) * u
            cy = a[1] + (b[1] - a[1]) * u
            w = math.exp(math.log(a[2]) + (math.log(b[2]) - math.log(a[2])) * u)
            return cx, cy, w
    return keys[-1][1]

def render(img, view):
    cx, cy, w = view
    h = w * OH / OW
    cx = min(max(cx, w / 2), SW - w / 2) if w <= SW else SW / 2
    cy = min(max(cy, h / 2), SH - h / 2) if h <= SH else SH / 2
    s = OW / w
    src, k = img, 1.0
    if s < 0.8:  # prefilter big downscales so text doesn't alias
        k = min(1.0, s * 1.25)
        src = cv2.resize(img, None, fx=k, fy=k, interpolation=cv2.INTER_AREA)
    sk = s / k
    M = np.float32([[sk, 0, OW / 2 - cx * k * sk], [0, sk, OH / 2 - cy * k * sk]])
    return cv2.warpAffine(src, M, (OW, OH), flags=cv2.INTER_CUBIC,
                          borderMode=cv2.BORDER_CONSTANT, borderValue=BG)

# --- captions: a step number chip + one plain sentence, bottom center ---
def font(size, wght):
    f = ImageFont.truetype(FONT, size)
    try: f.set_variation_by_axes([wght, 100])
    except Exception:
        try: f.set_variation_by_axes([wght])
        except Exception: pass
    return f

F_TXT, F_NUM = font(40, 560), font(34, 760)

def caption_rgba(step, text):
    pad, chip, gap = 26, 60, 22
    tw = F_TXT.getbbox(text)[2]
    has_chip = step is not None
    W = pad + (chip + gap if has_chip else 0) + tw + pad + 8
    H = 100
    im = Image.new('RGBA', (W + 40, H + 40), (0, 0, 0, 0))
    sh = Image.new('RGBA', im.size, (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle((20, 26, 20 + W, 26 + H), 28, fill=(0, 0, 0, 60))
    sh = Image.fromarray(cv2.GaussianBlur(np.array(sh), (0, 0), 12))
    im.alpha_composite(sh)
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((20, 20, 20 + W, 20 + H), 28, fill=(255, 255, 255, 255),
                        outline=(225, 222, 216, 255), width=2)
    x = 20 + pad
    if has_chip:
        d.ellipse((x, 20 + (H - chip) // 2, x + chip, 20 + (H + chip) // 2), fill=ACCENT + (255,))
        d.text((x + chip / 2, 20 + H / 2), str(step), font=F_NUM, fill=(255, 255, 255, 255), anchor='mm')
        x += chip + gap
    d.text((x, 20 + H / 2), text, font=F_TXT, fill=INK + (255,), anchor='lm')
    return np.array(im)

CAP_IMGS = [caption_rgba(s, t) for (_, _, s, t) in CAPS]

def overlay(fr, t):
    for (a, b, _, _), cap in zip(CAPS, CAP_IMGS):
        if not (a <= t < b): continue
        u = ease((t - a) / 0.45) * (1 - ease((t - (b - 0.35)) / 0.35))
        if u <= 0: return fr
        h, w = cap.shape[:2]
        x0 = (OW - w) // 2
        y0 = int(OH - h - 34 + (1 - u) * 24)
        y1, x1 = min(y0 + h, OH), x0 + w
        reg = fr[y0:y1, x0:x1].astype(np.float32)
        c = cap[:y1 - y0]
        al = c[..., 3:4].astype(np.float32) / 255 * u
        rgb = c[..., 2::-1].astype(np.float32)  # RGBA -> BGR
        fr[y0:y1, x0:x1] = (reg * (1 - al) + rgb * al).astype(np.uint8)
        return fr
    return fr

def grab(t):
    p = subprocess.run(['ffmpeg', '-v', 'error', '-ss', f'{t:.3f}', '-i', SRC, '-frames:v', '1',
                        '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-'], capture_output=True)
    return np.frombuffer(p.stdout[:SW * SH * 3], np.uint8).reshape(SH, SW, 3)

def frames(a, b, dur):
    n = round(dur * FPS)
    fsz = SW * SH * 3
    if b is None:
        img = grab(a)
        for _ in range(n): yield img
        return
    speed = (b - a) / dur
    p = subprocess.Popen(['ffmpeg', '-v', 'error', '-ss', str(a), '-t', str(b - a), '-i', SRC,
                          '-vf', f'setpts=(PTS-STARTPTS)/{speed},fps={FPS}',
                          '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-'], stdout=subprocess.PIPE)
    last = None
    for _ in range(n):
        buf = p.stdout.read(fsz)
        if len(buf) == fsz: last = np.frombuffer(buf, np.uint8).reshape(SH, SW, 3)
        yield last
    p.stdout.close(); p.wait()

total = sum(round(s[2] * FPS) for s in SEGS)
starts, acc = [], 0
for s in SEGS: starts.append(acc); acc += round(s[2] * FPS)

if SHEET:  # one still per 2s of output, tiled, for review before the full render
    tiles = []
    for T in np.arange(0.5, total / FPS, 2.0):
        o = int(T * FPS)
        si = max(i for i, st in enumerate(starts) if st <= o)
        a, b, dur, keys, _ = SEGS[si]
        n = round(dur * FPS); i = o - starts[si]
        src_t = a if b is None else a + (b - a) * i / n
        fr = overlay(render(grab(src_t), view_at(keys, i / max(n - 1, 1))), o / FPS)
        tiles.append(cv2.resize(fr, (640, 360), interpolation=cv2.INTER_AREA))
    while len(tiles) % 4: tiles.append(np.full_like(tiles[0], 40))
    rows = [np.hstack(tiles[r:r + 4]) for r in range(0, len(tiles), 4)]
    cv2.imwrite(SHEET, np.vstack(rows))
    sys.exit()

enc = subprocess.Popen(['ffmpeg', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'bgr24',
                        '-s', f'{OW}x{OH}', '-r', str(FPS), '-i', '-', '-an',
                        '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p',
                        '-movflags', '+faststart', OUT], stdin=subprocess.PIPE)
fade_n = round(FADE_OUT * FPS)
out_i, prev_tail = 0, None
for si, (a, b, dur, keys, xin) in enumerate(SEGS):
    n = round(dur * FPS)
    for i, img in enumerate(frames(a, b, dur)):
        fr = render(img, view_at(keys, i / max(n - 1, 1)))
        if xin and prev_tail is not None and i < XF:
            fr = cv2.addWeighted(prev_tail, 1 - ease((i + 1) / (XF + 1)), fr, ease((i + 1) / (XF + 1)), 0)
        if i == n - 1: prev_tail = fr.copy()
        fr = overlay(fr, out_i / FPS)
        if out_i >= total - fade_n:
            u = ease((out_i - (total - fade_n)) / fade_n)
            fr = cv2.addWeighted(fr, 1 - u, np.full_like(fr, 255), u, 0)
        enc.stdin.write(fr.tobytes())
        out_i += 1
    print(f'seg {si + 1}/{len(SEGS)} done, {out_i / FPS:.1f}s', flush=True)
enc.stdin.close(); enc.wait()
