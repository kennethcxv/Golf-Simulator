# SESSION STATE — autonomous production overhaul

Resume from this file. Never rely on conversation memory.

- **Branch** `main` · **Last commit** `f547d32` (P1-1 pressure washing)
- **Tests** 315 green (`node --test` **from the repo root only** — never `node --test tests/`)
- **Dev server** `node tools/serve.cjs` on port **8457**
- **Evidence** `qa/autonomous-overhaul/before/` and `.../pass-01/` (qa/ is gitignored — on disk only)
- **Queue** `AUTONOMOUS_BACKLOG.md` · **Record** `DEV_LOG.md`

## Done this session

| Commit | What |
|--------|------|
| `46512cb` | P0-1 course-map drift — held-key normalisation + transition reset |
| `0baac43` | P0-2 depenetration, stuck recovery, Unstuck menu, door occupancy |
| `0f51120` | P0-3 laptop seat fitted to the screen (9.7% → 53.7% of viewport) |
| `7cd5afe` | P0-7 inventory conservation — shoppers can no longer delete stock |
| `f547d32` | P1-1 pressure washing — mask erosion, soap gate, tool tiers |

**All P0 defects from the brief are closed and verified live.**

## Next, in order

1. **P1-2 fixture placement / build mode** (XL). The one genuinely missing core system.
   `walk.isFree(x, z, r)` already exists (added in P0-2) and is what placement validation needs.
   Rules to enforce: no overlap, doors stay clear, checkout stays reachable, customer routes
   survive, nothing traps the player. Nav must rebake on commit (`makeNav` in
   `render3d/clubhouse/nav.js`, `colVersion` bumps in `addCol`/`removeCol`).
2. **P1-3 checkout staff space** — the brief says there is not enough room behind the counter.
   Measure the clearance against the 0.34 yd player radius before changing anything.
3. **P1-4 box sizes by contents** + visible contents + tactile hold-to-stock.
4. **P1-6 tutorial** extended to the full loop (washer, soap, boxes, stocking, checkout).
5. **P2** reviews with real causes, analytics with explanations, employees/wages, rent schedule,
   weather → attendance, cart progression.

## Landmines / conventions learned the hard way

- **Walk yaw**: forward = `(−sin y, −cos y)`. Facing −z is **yaw 0**, not π. Aim formula:
  `yaw = atan2(−dx/d, −dz/d)`.
- **Building local → world** is a pure translation: `world = local + (−8, 228)`.
- The laptop's E-prop sits ~0.6 yd from the stockroom door — a blind `E` near that door opens the
  laptop instead, and while `laptopOpen` is true **all** walk input is parked. Check
  `walk.getFocusLabel()` before pressing E in any script.
- `F` **cycles** the tool belt; calling it twice lands past the washer. In QA use
  `walk.setTool('washer')` directly.
- The door E-prompt radius is **2.1 yd**. Standing at 2.2 yd, nothing happens.
- Playwright's synthetic `keyboard.up('d')` sends lowercase `d` even with Shift held, so it
  **cannot** reproduce the real stranded-key bug. Dispatch `new KeyboardEvent('keyup', {key:'D'})`
  to reproduce what Chrome actually delivers.
- Wash surfaces must avoid the windows (south windows: 2.4 × 1.9, sill 0.85, at local x −8.3 and
  −4.9; the west gable has none). A grime plane over glass reads as a black tarp.
- Anything added to the tool belt needs an entry in `audio.js` `TOOL_LOOP_LEVEL`, or
  `setTargetAtTime` gets `undefined` and throws.
