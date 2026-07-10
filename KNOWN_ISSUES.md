# FAIRWAY STATE — KNOWN ISSUES / PRE-SHIP GAPS

Honest list of what is placeholder, missing, or deliberately deferred. Anything listed
under "Needs a real art/audio pass" must be replaced before this could ship commercially.

## Needs a real art pass before release

- ~~Procedural ground textures~~ — replaced with real CC0 PBR sets (Poly Haven,
  diffuse+normal; see ASSET_SOURCES.md). ~~Gumdrop/cone trees~~ — replaced with Kenney
  Nature Kit CC0 models (color-remapped to realistic tones). Still placeholder: the
  box clubhouse (v4 Task 5 in progress at this line's writing), golfer/customer capsule
  characters, and shop interior fixtures — real character models and a shop kit remain
  pre-ship requirements.
- ~~Sky horizon blows out white at low sun angles~~ — fixed by v4's bloom threshold
  (40); re-verified at 6:50 AM and 7:35 PM low sun, both facings (qa/v5-sky-*.png).
  ~~Water surfaces have no ripple normals~~ — v4 Water.js + waternormals. Still open:
  **no rain particles**, and **tee-number sprites render as solid black squares when
  viewed against the light** (lit sprite material; fine sun-side, black anti-sun-side —
  seen clearly in the v5 dawn/dusk sky shots). Both queued for the polish pass.
- **Pro shop interior is simple geometric primitives** — hollow box shelving, box
  stock stacks, capsule-and-sphere customers, flat procedural wood/plaster. Needs a real
  modular shop kit, item models per SKU, and characters before ship. Register queue
  interaction and counter purchase animations are also deferred.
- **UI is hand-rolled DOM/canvas styling** — functional, consistent, but needs a real UI
  art/iconography pass (currently text + simple shapes/emoji glyphs).
- **Key art / branding / trailer** — nothing exists; "FAIRWAY STATE" is a working title.

- **AI-generated tree models attempted (v5), not achievable in this environment** —
  the plan was Tripo (tripo3d.ai) tree variants imported alongside the Kenney set with a
  same-angle side-by-side and an honest keep/replace call. Probe results: the tripo-mcp
  server requires the Tripo Blender addon, which is not installed (the machine's addon.py
  is vanilla blender-mcp with no Tripo command handlers); its MCP config carries an empty
  env (no API key); and no TRIPO_API_KEY / ~/.tripo credentials exist anywhere on the
  system, ruling out direct REST calls too. Higgsfield was explicitly excluded (image/video
  generator — no usable meshes). **Kenney Nature Kit trees remain the shipping asset.**
  AI-generated or hand-authored realistic trees stay on the pre-ship art-pass list; with a
  Tripo key + addon (or an artist), the import path is ready — GLBs drop into
  vendor/models/trees/ and register in courseScene.js's tree table.

## Needs a real audio pass before release

- All sound is procedurally synthesized WebAudio placeholder (mower hum, sprinkler ticks,
  ball strike clicks, ambient birdsong, shop doorbell/register). Real recorded SFX and a
  music bed are required for ship quality.

## Deferred by design (post-launch roadmap, per spec)

- Multiple course themes/climates, tournament broadcast systems, course sharing/Workshop,
  multiplayer, localization, Steamworks integration (Electron shell is in place so this
  bolts on without restructuring).

## Technical debt / open items

- ~~Electron native save bridge smoke-tested but not deep-QA'd~~ — deep-QA'd via CDP
  attach (tools/qa-electron-saves.mjs, 15 checks ALL PASS): bridge API, v5 shop boot in
  the real shell, byte-identical native round-trip, real files in
  `%APPDATA%\FAIRWAY STATE\saves\` (note: userData derives from **productName**, not
  package name), reload→Continue restore, office-menu slot save, delete/list, zero
  console/CSP errors. Gotchas recorded: `npm start -- --dev` can be eaten by npm
  ("config dev" warning) — use `npx electron . --remote-debugging-port=<port>`; and
  9223 may be held by a running GlassWaterV2 dev instance, so the tool takes a port arg.
- **Colorblind-safe palette pass pending** — zone colors are green-band heavy and turf
  health reads by hue; the Health/Moisture data views help but a proper colorblind-safe
  indicator pass (patterns/icons) is a pre-ship accessibility requirement, as is
  localization (zh-Hans/de/es/ja/ko per the spec) and remappable controls.
- **Balance is judgment-call tier** — every number in balance.js/club.js/shop.js needs
  real playtesting; the spec's external-playtest pass (with actual golfers) has not
  happened and no amount of build time substitutes for it.
- ~~CSP meta tag~~ — done (importmap hash pinned in index.html; verified in browser
  and Electron).
