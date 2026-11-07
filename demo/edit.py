# Cut a screen recording into a demo: segments, speed ramps, eased zooms.
# python edit.py SRC OUT.mp4 cuts/<name>.py   (cut file defines SW, SH, SEGS)
# Every output frame is a pure function of (segment, local t): no state between frames.
import subprocess, sys, math, runpy
import numpy as np, cv2

SRC, OUT = sys.argv[1], sys.argv[2]
CUT = runpy.run_path(sys.argv[3])
SW, SH, SEGS = CUT['SW'], CUT['SH'], CUT['SEGS']
TOP = CUT.get('TOP', 0)                    # source rows to drop (e.g. WP admin bar)
BG = CUT.get('BG', (255, 255, 255))        # letterbox fill, BGR
OW, OH, FPS = 1920, 1080, 60
XF = 12  # crossfade frames between segments

FADE_OUT = 0.8

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
    img, cy, sh = img[TOP:], cy - TOP, SH - TOP  # rows above TOP never show
    h = w * OH / OW
    # a view larger than the source letterboxes onto BG instead of smearing edges
    cx = min(max(cx, w / 2), SW - w / 2) if w <= SW else SW / 2
    cy = min(max(cy, h / 2), sh - h / 2) if h <= sh else sh / 2
    s = OW / w
    src, k = img, 1.0
    if s < 0.8:  # prefilter big downscales so text doesn't alias
        k = min(1.0, s * 1.25)
        src = cv2.resize(img, None, fx=k, fy=k, interpolation=cv2.INTER_AREA)
    sk = s / k
    M = np.float32([[sk, 0, OW / 2 - cx * k * sk], [0, sk, OH / 2 - cy * k * sk]])
    return cv2.warpAffine(src, M, (OW, OH), flags=cv2.INTER_CUBIC,
                          borderMode=cv2.BORDER_CONSTANT, borderValue=BG)

def frames(a, b, dur):
    n = round(dur * FPS)
    fsz = SW * SH * 3
    if b is None:
        p = subprocess.run(['ffmpeg', '-v', 'error', '-ss', str(a), '-i', SRC, '-frames:v', '1',
                            '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-'], capture_output=True)
        img = np.frombuffer(p.stdout[:fsz], np.uint8).reshape(SH, SW, 3)
        for _ in range(n): yield img
        return
    speed = (b - a) / dur
    p = subprocess.Popen(['ffmpeg', '-v', 'error', '-ss', str(a), '-i', SRC, '-t', str(b - a),
                          '-vf', f'setpts=(PTS-STARTPTS)/{speed},fps={FPS}',
                          '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-'], stdout=subprocess.PIPE)
    last = None
    for _ in range(n):
        buf = p.stdout.read(fsz)
        if len(buf) == fsz: last = np.frombuffer(buf, np.uint8).reshape(SH, SW, 3)
        yield last
    p.stdout.close(); p.wait()

enc = subprocess.Popen(['ffmpeg', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'bgr24',
                        '-s', f'{OW}x{OH}', '-r', str(FPS), '-i', '-',
                        '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p',
                        '-movflags', '+faststart', OUT], stdin=subprocess.PIPE)
total = sum(round(s[2] * FPS) for s in SEGS)
fade_n = round(FADE_OUT * FPS)
out_i, prev_tail = 0, None
for si, (a, b, dur, keys, xin) in enumerate(SEGS):
    n = round(dur * FPS)
    for i, img in enumerate(frames(a, b, dur)):
        fr = render(img, view_at(keys, i / max(n - 1, 1)))
        if xin and prev_tail is not None and i < XF:
            fr = cv2.addWeighted(prev_tail, 1 - ease((i + 1) / (XF + 1)), fr, ease((i + 1) / (XF + 1)), 0)
        if out_i >= total - fade_n:  # fade to white at the very end
            u = ease((out_i - (total - fade_n)) / fade_n)
            fr = cv2.addWeighted(fr, 1 - u, np.full_like(fr, 255), u, 0)
        enc.stdin.write(fr.tobytes())
        out_i += 1
        if i == n - 1: prev_tail = fr
    print(f'seg {si + 1}/{len(SEGS)} done, {out_i / FPS:.1f}s', flush=True)
enc.stdin.close(); enc.wait()
