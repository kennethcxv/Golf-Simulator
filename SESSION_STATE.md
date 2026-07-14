# SESSION STATE — the physical laptop

Resume from this file. Never rely on conversation memory.

- **Branch** `main` · **Tests 461 green** — run `node --test` **from the repo root only**
- **Dev server** `node tools/serve.cjs`, port **8457**
- **The laptop, in full:** `LAPTOP.md` — read that before touching the office
- **The register, in full:** `REGISTER.md` — read that before touching the counter
- **Evidence** `qa/laptop/{before,after,pages,debug,cycle,persist,scale,thumbs}/` (qa/ is gitignored)

## What shipped this session

| Commit | What |
|--------|------|
| `dcc40b5` | The rig and the map, as testable geometry |
| `f0d17b3` | **THE BUG** — the interface was always one frame behind |
| `70523a7` | The numbers the pages needed, recorded rather than invented |
| `e54010f` | Fairway Office — sixteen applications, one screen |

The laptop's interface is now **welded to its glass, every frame** (measured drift: 0px). It was
crumpled into a skewed trapezoid in the corner of the lid, with the 3D canvas painting a **rival
desktop** underneath it — one defect that read, from outside, as four of the brief's ten
complaints at once.

## Where things are

```
src/core/laptopRig.js              the machine's frame. Pure geometry, 10 tests.
src/core/laptopProjection.js       the map onto the glass + its inverse, 6 tests.
src/render3d/clubhouse.js          the machine itself (search: THE LAPTOP)
src/main.js                        enter/exit + the per-frame weld (search: alignLaptopUi)
src/ui/laptop.js                   Fairway Office. 16 applications. Knows nothing about 3D.
src/render3d/clubhouse/thumbs.js   real product renders, cached
tools/qa/laptop-{look,tour,cycle,persist}.js
```

## Landmines (the full list is in LAPTOP.md)

- **NEVER SLEEP FOR STATE.** Headless rAF is throttled. Wait for the *condition*, never the clock.
  It bit me again this session: a harness that pressed E the instant the lid closed reported
  "cycle 2 never opened", which was my bug, not the game's.
- **`replaceChildren()` STRINGIFIES `null`** into the literal text "null" — `el()` filters, the raw
  DOM API does not. That is how the Supplier page printed "nullnull". Use `paint()`.
- **`em`, not `rem`, in the laptop stylesheet.** `rem` resolves against the *document* root, so the
  interface-scale setting would silently do nothing.
- **The interface (1024x640) and the panel must stay 16:10.** Pinned by a test. Any other aspect
  stretches every glyph.
- **World-space objects hang off `scene`, not `interior`** — `interior` carries the clubhouse's own
  offset and will put them 228 yards up the fairway.
- **The seat distance is DERIVED** from the panel, the field of view and the window shape. A
  hardcoded seat is wrong the moment any of the three change — that is how it once ended up at
  9.7% of the viewport.

## Next, in priority order

1. **THE ANIMATIONS** (still job #1, from the register brief). ~22 named animations were asked for
   and none exist. The register is fully physical — real objects, real motion — but the ACTORS are
   not animated. Goods appear on the counter rather than being set down. The card and the notes
   appear rather than being drawn from a pocket. The player has no visible hands.
2. **Customers.** Still procedural primitives. The animation work lands on top of whatever replaces
   them, so do this first.
3. **Product models for accessories and decor.** Eight SKUs share one kraft-carton model, so on the
   Supplier and Inventory pages a tee bag, a bag towel, a rangefinder and an umbrella are the same
   picture. The clubs had the same problem and are fixed; this is one level down.
4. **The basket.** Modelled and on the shop floor; customers do not use it.
5. Card **timeout** exists in the register sim (`runCard(tx, {timeout:true})`, tested) but nothing
   in the game fires it — it needs a visible timer the player can watch.
6. The office **wall map** is still a 240x160 canvas that reads as a green squiggle, and the lounge
   course photograph is a flat gradient plane.
7. Then the pre-existing queue: P1-5 finish the hands, P1-6 tutorial chapters, P2-3 employees who
   do real physical work, P2-5 rain decisions.
