# FAIRWAY STATE — KNOWN ISSUES / PRE-SHIP GAPS

Honest list of what is placeholder, missing, or deliberately deferred. Anything listed
under "Needs a real art/audio pass" must be replaced before this could ship commercially.

## Needs a real art pass before release

- **Course is real 3D (v3) but textures/models are procedural placeholders** — canvas-
  generated grass/sand/scrub tiles (a CC0 photo-texture + normal-map pass would lift
  realism significantly), low-poly gumdrop/cone trees (real tree models or billboard
  imposters needed), box-and-pyramid clubhouse, no golfer character models yet.
- **Sky horizon blows out white at low sun angles**; water surfaces have no ripple
  normals; no rain particles. All queued for the Phase 7 polish pass.
- **Pro shop interior is simple geometric primitives** — hollow box shelving, box
  stock stacks, capsule-and-sphere customers, flat procedural wood/plaster. Needs a real
  modular shop kit, item models per SKU, and characters before ship. Register queue
  interaction and counter purchase animations are also deferred.
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

- **Electron native save bridge smoke-tested but not deep-QA'd** — browser/localStorage
  path fully exercised; userData file save/load via the preload bridge needs one CDP-attach
  verification pass (bridge mirrors GlassWaterV2's proven pattern).
- **Colorblind-safe palette pass pending** — zone colors are green-band heavy and turf
  health reads by hue; the Health/Moisture data views help but a proper colorblind-safe
  indicator pass (patterns/icons) is a pre-ship accessibility requirement, as is
  localization (zh-Hans/de/es/ja/ko per the spec) and remappable controls.
- **Balance is judgment-call tier** — every number in balance.js/club.js/shop.js needs
  real playtesting; the spec's external-playtest pass (with actual golfers) has not
  happened and no amount of build time substitutes for it.
- ~~CSP meta tag~~ — done (importmap hash pinned in index.html; verified in browser
  and Electron).
