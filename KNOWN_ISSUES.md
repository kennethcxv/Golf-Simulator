# FAIRWAY STATE — KNOWN ISSUES / PRE-SHIP GAPS

Honest list of what is placeholder, missing, or deliberately deferred. Anything listed
under "Needs a real art/audio pass" must be replaced before this could ship commercially.

## Needs a real art pass before release

- **All course visuals are procedural placeholders** — flat-color zone rendering with
  hillshading; no grass/sand/water textures, no trees/props sprites, no golfer character
  art (golfers render as dots/simple shapes).
- **Pro shop interior is simple geometric primitives** — boxes for shelves/counter,
  capsule customers, flat-color materials. Needs real modular shop kit models + characters.
- **UI is hand-rolled DOM/canvas styling** — functional, consistent, but needs a real UI
  art/iconography pass (currently text + simple shapes/emoji glyphs).
- **Key art / branding / trailer** — nothing exists; "FAIRWAY STATE" is a working title.

## Needs a real audio pass before release

- All sound is procedurally synthesized WebAudio placeholder (mower hum, sprinkler ticks,
  ball strike clicks, ambient birdsong, shop doorbell/register). Real recorded SFX and a
  music bed are required for ship quality.

## Deferred by design (post-launch roadmap, per spec)

- Multiple course themes/climates, tournament broadcast systems, course sharing/Workshop,
  multiplayer, localization, Steamworks integration (Electron shell is in place so this
  bolts on without restructuring).

## Technical debt / open items

- **CSP meta tag not yet in index.html** — needs the inline-importmap hash computed and
  pinned (Phase 7 polish, before ship). No third-party code loads meanwhile.
- **Electron native save bridge smoke-tested but not deep-QA'd** — browser/localStorage
  path fully exercised; userData file save/load via the preload bridge needs one CDP-attach
  verification pass (bridge mirrors GlassWaterV2's proven pattern).
- **Colorblind-safe palette pass pending** — zone colors are currently green-band heavy;
  needs the accessibility pass promised in the spec (with turf-health indicators, Phase 2+).
