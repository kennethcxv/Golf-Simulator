# SESSION STATE — clubhouse production-asset pass

Resume from this file. Never rely on conversation memory.

- **Branch** `main` · **Tests** 361 green — run `node --test` **from the repo root only**
- **Dev server** `node tools/serve.cjs`, port **8457**
- **Evidence** `qa/assets/{before,pass-1,pass-2,pass-3,final}/` + `qa/assets/models/`
  (qa/ is gitignored — on disk only)
- **Audit / decisions** `ASSET_PRODUCTION_AUDIT.md` · **Asset provenance** `ASSET_SOURCES.md`

## The asset pipeline (new this session)

Blender **5.1.2** drives headlessly. The **MCP addon socket is not running** — recorded
blocker — but headless CLI is the better pipeline anyway because the authoring scripts
are committed, so every asset is reproducible instead of being an unexplainable binary.

```
BL="C:/Program Files/Blender Foundation/Blender 5.1/blender.exe"
"$BL" --background --factory-startup --python tools/blender/build_merch.py   # 11 goods
"$BL" --background --factory-startup --python tools/blender/build_props.py   # 12 props
"$BL" --background --factory-startup --python tools/blender/inspect_glb.py   # previews + measure
```

23 GLBs land in `vendor/models/clubhouse/` (2.0 MB). `src/render3d/clubhouse/merch.js`
loads them, **remaps every `M_*` material slot onto the shared kit**, caches tints by
colour, and `bake()`s each display into one mesh per material.

**Screenshot harness:** `tools/qa/shoot-clubhouse.js` — edit `PASS` at the top, then run
it through the Playwright MCP `browser_run_code_unsafe` with `filename`. It reloads,
stocks the retail displays, **pins the clock to 2 PM**, shoots the same 10 poses, and
measures draw calls properly.

## Shipped this session

| Commit | What |
|--------|------|
| `92a4377` | Audit against the running game + the QA harness |
| `bc92ad0` | Pass 1 — 11 merchandise models; material kit with real roughness/normal maps |
| `993840e` | Pass 2 — 12 props; stockroom; register kit; crest; landscaping |

**Before → final:** meshes 1,603 → 1,289 (−20%), geometries 2,603 → 1,542 (−41%),
materials 296 → 270, draw calls 11,176 → 10,890. Triangles up 17% deliberately.

## Next, in priority order

1. **Customers/characters.** They are procedural primitives standing in a room that is
   now modelled around them, so they are the loudest remaining placeholder. Not touched
   this session (out of scope for an environment pass) but they are next.
2. **The office course map** (240×160 canvas, reads as a green squiggle) and the **lounge
   course photograph** (a flat gradient plane).
3. **Wire `cash_drawer.glb`.** The asset is an OPEN till and is built and loaded but not
   placed, because there is no open/close animation to hang it on. That is a systems job.
4. **Exterior grime** still reads as a soft dark smear rather than dirt (pre-existing).
5. Then the pre-existing queue from the previous session: P1-5 finish the hands,
   P1-6 tutorial chapters, P2-3 employees who do real physical work, P2-5 rain decisions.

## Landmines learned this session

- **Tinted materials need NEUTRAL GREY base maps.** `color` multiplies into `map`, so a
  green polo tint over the sage-green weave came out near-black and every cap in the shop
  read as a mushroom.
- **A shoe's upper is `M_leather`, not `M_fabric`.** Tinting only fabric left every shoe
  on the wall the same brown.
- **`roundedBox()` has planar, world-scaled UVs** (constant texel density across fixtures).
  Anything carrying a 0..1 label — a ball box, a product carton — must use a plain
  `BoxGeometry` or the label is cropped and tiled into mush.
- **The GLBs load async.** `buildCheckout`/`buildLounge`/`buildStockroomDressing` run once
  at construction, so any prop placed inline there would simply never appear. They defer
  through `merch.onReady()`. And register the restock hook at the **end** of the build:
  a fast-failing GLB can call back before the state `rebuildStock()` closes over exists.
- **The game clock runs while the harness shoots** (~8 game-minutes per real second), so
  ten shots drift 80 minutes and the exterior lands at 2:33 AM in one pass and 1:42 PM in
  another. Pin it.
- **The boot veil outlives `clubhouse()`** and is opaque — it photographed a black screen
  over the checkout once. Wait for `.load-veil` to actually go.
- **Backroom decor spawns translucent green placement ghosts** (gated on `inv.back > 0`,
  clubhouse.js:1288). They will sit on top of the art in every screenshot. Park them.
- **Continuous surfaces, not assemblies.** The first Blender batch assembled detached
  primitives — a box torso with floating box sleeves, a plank sole with an egg on the toe
  — and rendered WORSE than the primitives it replaced. `lib_model.py`'s `loft()` and
  `outline_solid()` exist because a shirt and a shoe are single skins.
- **A golf bag with no clubs in it is just a bin.** The fan of club heads out of the top
  IS the silhouette.
- **Inspect every generated model before it goes in the game** —
  `tools/blender/inspect_glb.py` renders previews and measures tris/UVs/dimensions. It
  caught the loaf-shaped shoe, the detached iron sole, the nub cap bill and the floating
  hand-truck grips.
