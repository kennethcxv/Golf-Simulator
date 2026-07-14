# SESSION STATE — the physical register

Resume from this file. Never rely on conversation memory.

- **Branch** `main` · **Tests 427 green** — run `node --test` **from the repo root only**
- **Dev server** `node tools/serve.cjs`, port **8457**
- **The register, in full:** `REGISTER.md` — read that before touching the counter
- **Evidence** `qa/register/{card,cash,recover}/` + `qa/assets/models/` (qa/ is gitignored)

## What shipped

| Commit | What |
|--------|------|
| `84303ab` | The transaction sim + the save hole it exposed |
| `950db66` | The workspace, derived against real reach circles |
| `5884eb4` | The register kit, and an EMPTY till |
| `6598820` | Register mode — the counter you work with your hands |
| `494909a` | Patience, discoverability, save/reload acceptance |

The old `[E]`-to-charge checkout is gone. You now drag goods across a scanner, take
notes off the counter, open a till, put each note in its own well, count change back
out, and hand over a bag. Money moves in exactly one place, at the very end.

## Where things are

```
src/sim/register.js                     the transaction. Pure, 45 tests. Owns every rule.
src/render3d/clubhouse/registerMode.js  the counter. Moves meshes. Owns NO rules.
src/data/shopLayout.js  → REGISTER      the workspace, derived (see checkout-space.test.js)
tools/blender/build_register.py         cash_drawer (EMPTY), basket, bag_open, impulse_rack, divider
tools/qa/register-{boot,sale,recover}.js
```

## Landmines (the full list is in REGISTER.md)

- **NEVER SLEEP FOR STATE.** Bit me three times. Headless rAF is throttled: a fixed wait
  under-ran the receipt printer (reported "never printed"; it printed 2s later) and the
  camera ease (projected a pixel 90px off, so clicks landed on bare counter and the run
  reported "scanned: 0" as though the scanner were broken). Wait for the condition.
- **`forward = (−sin yaw, −cos yaw)`** — yaw 0 faces −z. `yaw = π` "to face the counter"
  points you at the back wall.
- **A 0..1 canvas needs 0..1 UVs.** Blender's `smart_project` gives an atlas UV, so a
  canvas painted onto a model's screen face samples a magnified corner — the register
  rendered as a black slab. Displays are their own `PlaneGeometry` now.
- **`cube()` in the Blender scripts takes FULL dimensions**, not half-extents.
- **Inspect every generated model.** `inspect_glb.py`. It caught a rack with detached
  sides, a basket handle whose arms splayed past the grip, and a drawer whose face plate
  was on the wrong side.
- **A hard rect edge is not a hitbox.** Bagging failed by ONE MILLIMETRE before it became
  proximity-to-the-bag.

## Next, in priority order

1. **THE ANIMATIONS.** The brief asked for ~22 and there are none. The register is fully
   physical — real objects, real motion — but the ACTORS are not animated. Goods appear on
   the counter instead of being set down. The card and the notes appear instead of being
   drawn from a pocket. The player has no visible hands at the till. This is the single
   biggest gap between what is there and a polished retail sim, and it is the next job.
2. **Customers.** Still procedural primitives, now standing at a counter modelled around
   them. They were the loudest placeholder before the asset pass and they still are.
   The animation work above lands on top of whatever replaces them, so do this first.
3. **The basket.** Modelled and on the floor; customers do not use it.
4. Card **timeout** exists in the sim (`runCard(tx, {timeout:true})`, tested) but nothing
   in the game fires it — it needs a visible timer the player can watch.
5. The office course map (a 240×160 canvas that reads as a green squiggle) and the lounge
   course photograph (a flat gradient plane).
6. Then the pre-existing queue: P1-5 finish the hands, P1-6 tutorial chapters,
   P2-3 employees who do real physical work, P2-5 rain decisions.
