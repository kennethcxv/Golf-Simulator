# Course Editor Rebuild — Production Report

Built 2026-07-16 against the binding reference set `Designs/RefrenceImages/Course`
(2 images: the full-detail editor sheet and the simpler usability-target sheet).
Backup checkpoint: branch `course-editor-pre-rebuild` at `591f839`.

## What was wrong (measured from the live game, screenshots in `Designs/CourseEditor/baseline/`)

1. **Straight rectangular strips** — holes painted as straight waypoint corridors at
   constant radius (2.3 cells ≈ 18 yd everywhere); the 9 holes formed one perimeter
   "racetrack" of parallel bands.
2. **World-aligned mowing stripes** — one fixed direction (`vec2(1.0, 0.32)`) for the
   entire property.
3. **Random trees** — hash noise over every out-of-play cell (`h > 0.78`), zero intent.
4. **Black void** — the terrain mesh ended exactly at the 960×640 yd grid; beyond it,
   empty sky. At night the whole scene was near-black because editing followed the
   game clock (the reference complaint's 4:29 AM screenshot).
5. **Editor** — plan-ghost overlay only (no live sculpt), no undo, blocked in
   first-person mode, no green/bunker/water/path/object/measure tools, no hole cards,
   no playtest.

## Systems preserved

- Course save data model (zones + elevation grids, holes, structures) and every
  consumer of it: turf simulation, golfers, sections, renovation downtime, tee-time
  reservations, progression, marketplace valuation.
- The plan-then-confirm cost philosophy (now: live edits + pending bill, charged
  exactly once on Build) and `terrainEdit.js` itself (still used by its tests).
- The walkable first-person course, clubhouse, register — untouched.
- Save compatibility: SAVE_VERSION 4 → 5 with migration (old saves gain
  intentionally-planted `course.objects` from their own seed, hole extras get
  defaults, paths default empty).

## Systems replaced / added

### Data & generation (`src/sim/`)
- **`courseShaping.js` (new)** — the shared organic toolkit: Catmull-Rom spline
  corridors with variable-width profiles (landing-zone swells, strategic pinches),
  rotated-ellipse/kidney green complexes with plateaus, aim-aligned rectangular tee
  boxes, lobed bunker blobs with carved depressions, fringe/first-cut/heavy-rough
  transition bands, cart-path routing, per-hole land movement (falling, climbing,
  swale), and INTENTIONAL vegetation: framing lines with gaps, clustered groves,
  dogleg specimen trees, deep boundary forest. Used by BOTH the starting course and
  every marketplace listing.
- **`startingCourse.js`** — Willow Creek rerouted: varied directions, doglegs both
  ways, an S-shaped par 5, two-bend par 4s; par 34 preserved; all contract tests kept.
- **`constants.js`** — five new surfaces: FRINGE, HEAVY (heavy rough), DIRT, BED
  (landscaping), SEMI (first cut). All wired through turf simulation policies.
- **`courseEditor.js` (new)** — headless editor core: stroke-grouped undo/redo with
  exact inverses (terrain, paint, stamps, objects, paths, holes), pending-bill
  economics (preview free, charged exactly once on apply, refused when broke,
  renovation scheduling on affected open holes), discard-restores-everything,
  measure (yards/elevation/slope), course statistics (acreage, counts, difficulty).
- **`playtest.js` (new)** — a real stroke loop: club ladder (driver→putter),
  launch physics, per-surface bounce/roll (green ≠ rough ≠ sand ≠ path), slope pull,
  water penalty + drop at last rest, OOB re-drop, forgiving cup with gravity-well lip.

### Rendering (`src/render3d/courseScene.js`)
- Splat shader: 13 zone branches (was 8); **flow-field mowing stripes** — every cell
  stores its hole's local direction (bent through recorded waypoints), stripes follow
  the routing and differ per hole; visible floor on overgrown turf, stronger when mown.
- **Environment ring** — 2,600 yd of displaced rolling countryside matched to the
  boundary heights, plus a 34-cell-deep procedural boundary forest that fades with
  distance. No black void at any zoom/pitch.
- Trees render from `course.objects` (typed instancing per Kenney variant); non-tree
  objects (shrubs/rocks/props/decor: 16 types) render GLB-first with procedural
  low-poly fallbacks; one InstancedMesh per part.
- Cart paths as smooth Catmull-Rom **ribbon meshes** (asphalt/concrete/gravel/dirt)
  riding the terrain, sky-facing winding enforced; PATH zone reads as a worn shoulder.
- Bunker bowls carved from the (now-depressed) elevation; pond water level derived
  from the shore ring; softened water specular.
- **Editor lighting override** — Midday / Morning / Golden hour / Overcast presets;
  the game clock no longer decides whether you can see while editing.
- Editor renderables: world-space brush ring, valid/invalid placement ghost,
  measure line + label, playtest ball + dashed aim arc; `frameCourse`/`frameHole`
  camera helpers; fractional-cell ground raycast.

### UI (`src/ui/courseEditor.js`, new; `src/styles.css`)
Reference-matched chrome: top bar (Playtest · Undo · Redo · Save · Holes · Stats ·
pending bill · Build it/Discard · money · daylight picker · Exit), 10-tool left rail
(Select, Terrain, Paint, Tee, Green, Bunker, Water, Objects, Paths, Measure) showing
ONLY the active tool's few controls, TIP box, contextual bottom hint bar, compass.
Hole selection = card grid with real mini-layout canvases + Add-hole card + footer
(Frame it / Edit Hole). Hole settings = name, par stepper + Auto, auto yardage,
handicap, Back/Middle/Forward tee, A/B/C pins, reorder, duplicate-settings,
delete-with-confirm. Stats = toggleable panel, basic up top, acreage/inventory in a
collapsible. Save = rename + Build-&-save + Export JSON download (no fake publish
button — no sharing backend exists). Playtest = hole/par/yardage/lie/strokes chips,
club select, hold-to-charge power bar, drag-to-aim (defaults to the flag), Esc back
to the editor with the edit session intact.

### Wiring (`src/main.js`)
`courseMode: 'editor'` alongside walk/overview; **E** (overview) and **J** (on foot)
open it; time pauses, golfers freeze, HUD/tutorial hide; exit restores the previous
mode and autosaves. The old works panel is retired (`worksPanel.js` no longer used).

## Tests

`tests/courseEditor.test.js` (14) — sculpt live+undo+bill, smooth/flatten convergence,
paint+sod+undo, green stamp + collar, bunker/water/stream stamps, tee stamp + pins
A/B/C, object CRUD + refusal on greens + scatter + undo chain, path add/edit/remove
with byte-identical zone restore, hole add/settings/reorder/delete, economics
(preview-free, exactly-once, insufficient-funds refusal, no double charge),
renovation scheduling + discard, full serialize round-trip, measure, statistics.
`tests/playtest.test.js` (6) — tee spawn, full drive flight+rollout, surface
ordering, water penalty + drop, holed putt, club ladder.
Suite total at time of writing: **737/737 pass** (`npm test`).

## In-game QA (Chrome DevTools MCP, isolated profiles)

- Every tool driven through real pointer events: terrain drag ($-billed stroke),
  paint, green/bunker/water stamps (+16 green/+13 fringe/+18 water cells), object
  place/ghost, 3-point path + right-click finish, measure (133 yd / −1.7 ft / −0.2°).
- Undo/redo adjusted the bill both ways; **Build it charged exactly once**
  ($28,529 then $18,848 in separate sessions); refused when broke; Discard restored
  zones byte-identically; edits persisted through autosave + reload.
- Hole cards / settings / rename / pins verified. Stats panel live.
- **Playtest**: full-power drive flew and rolled out 226 yd; complete hole played
  through the real UI: driver → wedge → putter, holed in 3 (birdie), water/OOB
  penalties covered headlessly.
- Resolutions: 1280×720, 1600×900, 1920×1080 all readable (rail compresses,
  bill chip hides at narrow widths).
- Console: zero errors. (One warning: a guard I added around
  `clubhouse.dispose()` catching a `customerItemGeo` ReferenceError from the
  parallel checkout session's in-progress clubhouse.js — flagged for that track.)
- Screenshots: `Designs/CourseEditor/baseline/` (before) and
  `Designs/CourseEditor/qa/` (25 after-shots: overviews, framed hole, fairway
  stripes, green complex, bunker, water, hole cards, settings, save, playtest
  ground/holed, paint/objects/terrain panels, golden hour, resolutions).

## Known non-blocking limitations

1. Object GLBs: trees are the real Kenney models; shrubs/rocks/props currently use
   stylized low-poly procedural meshes (same flat-shaded language). A Blender pass
   (`vendor/models/course/<type>.glb` are auto-preferred by the loader when present)
   would elevate closeups.
2. Mowing style variants (stripes/cross/plain) follow the existing maintenance
   policies; a per-hole style picker in the editor UI is future work.
3. The stream tool cuts water cells; it does not yet carve a continuous flowing
   surface between elevations.
4. Playtest is the editor's validation loop (aim/power/clubs/surfaces/penalties);
   it is not yet the full golfer-facing game mode.
5. The parallel checkout session's commits (`9747543`, `f828821`) swept most of this
   feature's files into their history; the work is all committed, but not in one
   tidy feature commit.
