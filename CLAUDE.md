# Motion studio rules

## Render contract
- Every film is a pure function of time: `window.seek(t)` paints frame t.
- No CSS transitions, no setTimeout, no requestAnimationFrame in render mode,
  no state carried between frames. Seeded noise only (mulberry32), never Math.random.
- Render with `node render.mjs`, encode H.264 yuv420p, CRF 16.

## Look
- Banned defaults: centered title on gradient, everything fading in,
  corner labels and frame borders, glow on UI chrome, generic particle bursts.
- One display face, one UI face. One accent color unless the brief says otherwise.
- Every 2 to 4 seconds something new must happen on screen.

## Fonts
- Before choosing type for a new video, read `fonts/FONTS.md` and run
  `node fonts/pick.mjs "<the brief>"` to get the niche (storytelling, vlogs,
  educational, talking-head, hooks) and its display + UI pair. Say which niche you picked and why.
- Use only that pair (alternates replace a slot, never add one). Load them via `fonts/fonts.css`.
- macOS-only fonts are fine for drafts; pass `--portable` for client deliverables.
- Never Papyrus, Arial or Comic Sans.

## Sound
- Score and SFX are synthesized in code unless a track is supplied.
- Place hits on the measured beat grid (beats.json). Loudness -14 LUFS.

## Hooks
- When I ask for a hook for a new video, start from `hooks/viral-hooks.md`
  (100 proven fill-in-the-blank hooks, indexed by type; original PDF in `hooks/`).
- Pick the 2-3 hook types that fit the video, fill in the blanks with its own
  words and numbers, keep the rest of each sentence unchanged, and give me
  3 versions to test. Say which hook number each one comes from.
- The hook has to land in the first 2 seconds of the film.

## Text animation
- When I ask to edit or animate a video, read `animation/text-animation.md` first
  and pick each text move's easing by section: hooks Cubic/Rebound Out, cuts None,
  pop-ups Ease/Quad Out, exits Quad/Ease In, long clips Linear, CTA Rebound Out.

## Loop before you show me anything
1. Render one frame per beat as a contact sheet and LOOK at it.
2. Score it 1-10 on: hook in first 2s, readability at phone size,
   motion quality, variety, brand accuracy, sound sync.
3. Fix the 3 worst problems. Repeat until every score is 8+.
4. Only then do the full render.
