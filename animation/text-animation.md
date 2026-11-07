# Text animation: which easing goes with which section

Source: viewcci reel "The best animations to use for each section of your video!"
https://www.instagram.com/viewcci/reel/DfOw9cVuW9B/ (1080x1920, 18 s, watched frame by frame 2026-11-06).

The idea: pick the easing curve based on what the moment is doing in the edit,
not one curve for everything. Every text move is short: 3 to 6 frames at 30 fps
(0.1 to 0.2 s), with motion blur while it moves.

## The cheat sheet

| Section of the video | Easing to use | What it looked like in the reel |
|---|---|---|
| Hooks and intros | **Cubic Out** or **Rebound Out** | "HOOKS & INTROS" flies in tilted (~-15°), small and blurred, lands in ~4 frames, overshoots to ~108% scale, settles by ~0.3 s. Biggest move in the video. |
| Hard cuts | **None** | "HARD CUTS" just appears. At most 1 blurred frame, no tween. Text cuts with the picture. |
| Pop-ups (callouts, captions that appear mid-talk) | **Ease Out** or **Quad Out** | "POP-UPS" slides in horizontally from the left, fast start, soft stop, ~3 frames. No overshoot. |
| Removing text (exits) | **Quad In** or **Ease In** | "REMOVE TEXT" holds, then drifts left slowly and accelerates off-frame over ~6 frames. Exits speed up; they never ease out. |
| Long clips (slow, continuous moves) | **Linear** | "LONG CLIPS" rises with a slight tilt at constant speed. Linear only where the move spans a long shot (slow push, drift, scroll). |
| End card / CTA | **Rebound Out** | Follow card (avatar + handle + "Following" pill) rises from below, overshoots and settles, ~0.35 s. |

Rule of thumb: **entrances ease out, exits ease in, hooks and CTAs get overshoot,
cuts get nothing, only long moves get linear.**

## Curves in code (render contract: pure functions of t, 0..1)

```js
const clamp01 = t => Math.min(1, Math.max(0, t));
export const ease = {
  linear:    t => t,
  quadIn:    t => t * t,
  quadOut:   t => 1 - (1 - t) * (1 - t),
  cubicOut:  t => 1 - Math.pow(1 - t, 3),
  easeIn:    t => t * t * t,                // close to CSS ease-in
  easeOut:   t => 1 - Math.pow(1 - t, 2.5), // close to CSS ease-out
  // "Rebound Out": overshoots ~8-10% then settles (back-out)
  reboundOut: (t, s = 1.70158) => 1 + (s + 1) * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2),
  none:      t => (t > 0 ? 1 : 0),
};
// progress of a move that starts at t0 and lasts d seconds, at film time t
export const p = (t, t0, d, fn) => fn(clamp01((t - t0) / d));
```

Typical settings taken from the reel (30 fps):
- Hook entrance: `reboundOut`, 0.25-0.35 s, from rotate -15°, scale 0.6, blur 8px, y +80px.
- Pop-up entrance: `quadOut`, 0.10-0.15 s, from x -300px.
- Exit: `quadIn`, 0.20 s, to x -600px, add blur as speed rises.
- Long clip drift: `linear`, the whole shot length.
- CTA card: `reboundOut`, 0.35 s, from y +200px, scale 0.9.

Motion blur: fake it with a blur (or 3-5 sub-frame copies) proportional to the
frame-to-frame velocity, so it is 0 at rest. Never blur a resting word.

## Look of the reel (for reference, not a template)

- Left column of overlays, talking head on the right, dark warm footage.
- Labels "Use this" / "For this" small and white; the section word in a heavy
  geometric sans, all caps, warm cream/gold, two lines, tight leading.
- Curve icons: rounded squares with a gold stroke, white curve, label underneath.
- Every 2-4 s a new section word plus a new curve icon. That fits the CLAUDE.md rhythm rule.
- Watch out: the reel puts a soft glow on its labels and boxes. Our CLAUDE.md bans
  glow on UI chrome, so take the motion from it, not the glow.

## When editing a video

1. Label each text event as hook, cut, pop-up, exit, long move or CTA.
2. Give it the easing from the table above. Don't use one curve for everything.
3. Keep moves 3-6 frames unless it's a long-clip drift.
4. Check entrances and exits on the contact sheet: there should be one blurred,
   moving frame between the empty frame and the landed one.
