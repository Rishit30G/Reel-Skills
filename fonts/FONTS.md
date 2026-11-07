# Fonts by content niche

Source: viewcci reel "Full font breakdown for each niche" (instagram.com/viewcci/reel/DefXH-ZveGx), watched 2026-11-06.
The machine-readable version is `font-map.json`; `pick.mjs` resolves it.

## How to choose

1. Read the brief and pick **one** niche (or run `node fonts/pick.mjs "<the brief>"`).
2. Use that niche's **display** face for headlines/hook text and its **ui** face for captions, labels, lower thirds.
   That is the whole type system (CLAUDE.md: one display face, one UI face).
3. An alternate may *replace* a slot when the brief calls for it. It is never added as a third face.
4. If code or a terminal is on screen, JetBrains Mono takes the ui slot.
5. The hook in the first 2s uses the video's display face. Use the `hooks` niche only when the whole video is a hook-led short (teaser, promo, launch, stat bomb).
6. Never: **Papyrus, Arial, Comic Sans.**

## The map

| Niche | Fonts in the reel | Display (we use) | UI (we use) | Alternates |
|---|---|---|---|---|
| **Storytelling**: brand story, case study, customer journey | Inter, Playfair Display, Poppins, Garamond | Playfair Display | Inter | EB Garamond (display), Poppins (ui) |
| **Vlogs**: day in the life, BTS, event recap, office/culture | Noteworthy, Tahoma, Typewriter, Mojito | Noteworthy ¹ | Tahoma ¹ | Mojito → Bebas Neue (display), American Typewriter ¹ for date/place stamps |
| **Educational**: explainer, tutorial, product demo, walkthrough | Coolvetica, SF Pro, IvyPresto, Sequel | Coolvetica → **Archivo** wdth 75 wght 800 | SF Pro → **Inter** | IvyPresto → Instrument Serif Italic, Sequel → Inter opsz 32 |
| **Talking head**: founder POV, opinion, podcast, interview captions | Switzer, Creato, Haas Grotesk, Tempting | Switzer | Creato → **Poppins** | Haas Grotesk → Switzer, Tempting → Instrument Serif Italic (one word only) |
| **Hooks**: teasers, promos, launches, big numbers | Anton, Montserrat, Bebas Neue, Impact | Anton | Montserrat | Bebas Neue, Impact ¹ |

**Bold** = free stand-in for a font that is commercial or personal-use only.
¹ macOS system font. Renders on this Mac via `local()`. For client deliverables or other machines, use `--portable`,
which swaps in Patrick Hand (Noteworthy), Inter (Tahoma), Special Elite (American Typewriter) and Anton (Impact).

## Not bundled, and why

| Font | Why it's not here | Stand-in |
|---|---|---|
| Coolvetica | Free for personal use only | Archivo narrowed |
| SF Pro | Apple licenses it for Apple-platform UI only | Inter |
| IvyPresto, Sequel Sans, Neue Haas Grotesk, Mojito | Commercial | see table |
| Creato Display, Tempting | No trusted source checked yet | Poppins, Instrument Serif Italic |

Have a license? Drop the TTF/OTF in `fonts/`, add an `@font-face` in `fonts.css`, and change that font's `status` to
`bundled` with its `files` in `font-map.json`. Everything else picks it up.

## Using it

Browser films (`render.mjs` serves the project root):

```html
<link rel="stylesheet" href="fonts/fonts.css">
```
```js
await Promise.all([document.fonts.load('800 100px "Playfair Display"'), document.fonts.load('500 40px Inter')]);
await document.fonts.ready; // before the first seek(t)
```

Python / PIL (`demo/*.py`): take the paths from `pick.mjs` output (`display.files[0]`). Variable fonts open at their
default instance in PIL; use `font.set_variation_by_axes([wght])` or a static file (Poppins/Switzer ship statics).

`specimen.html` shows every niche pair. Open it with `npm run preview` → http://localhost:8080/fonts/specimen.html
