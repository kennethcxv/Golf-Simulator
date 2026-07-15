# SESSION STATE — the P0 foundation overhaul

Resume from this file. Never rely on conversation memory.

- **Branch** `main` · **Tests 505 green** — run `node --test` **from the repo root only**
- **Dev server** `node tools/serve.cjs`, port **8457**
- **The P0 foundation overhaul, in full:** `FOUNDATION_OVERHAUL_AUDIT.md` — the collision / placement / navigation baseline (most already existed & tested) + the D1/D2 fixes + the prioritised P0 backlog
- **The visual pass, in full:** `VISUALS.md` — the Tripo asset pipeline and every prop it touched
- **The asset baseline & audit:** `ASSET_PRODUCTION_AUDIT.md` — the honest before-state
- **The delivery loop, in full:** `DELIVERY.md` — read that before touching boxes, stocking or supply
- **The laptop, in full:** `LAPTOP.md` — read that before touching the office
- **The register, in full:** `REGISTER.md` — read that before touching the counter
- **Evidence** `qa/assets/v2-*`, `qa/register/`, `qa/delivery/`, `qa/laptop/` (qa/ is gitignored)

## What shipped THIS session — the P0 foundation overhaul

The brief put collision / placement / navigation / inventory as P0, ahead of assets and UI.
Recon found most of that foundation **already built and tested** — `validatePlacement`
(`sim/layout.js`), `unstick.js`, `nav.js` (A\*), `sweptBy` (`doorMath.js`), and a real build
mode with a green/red ghost. So this session closed the two most player-visible **holes** in
those systems rather than rebuilding. Full baseline + prioritised backlog in
`FOUNDATION_OVERHAUL_AUDIT.md`.

| Commit | What |
|--------|------|
| `bd93aec` | **A set-down box occupies real space (D1)** — `legalBoxDrop` refuses walls/fixtures/doorways/other boxes and snaps to the nearest legal spot; `rebuildBoxes` registers a box collider, so a world box is solid to the player AND baked into the customer nav grid (same collider list). 9 new tests. |
| `3ca6c60` | **A door won't close through the player (D2)** — the player is now a first-class actor in the swept-arc guard `doorBlockedBy`, closing the wide main door's swing-tip gap (arc 2.35yd vs the old 2.0yd radial gate). |

Both verified in-browser on the live game (box: an open cell blocks the moment a box lands, free
again just aside; door: held open through a player parked at the 2.06yd swing tip, closes when
they step clear). **505 tests green** (was 496 + 9 new). Evidence: `qa/foundation-overhaul/{before,after}/`.

**Next P0** (from the audit, deferred, higher-effort): D3 doors invisible to the customer
pathfinder (customers stall at shut doors); D4 player/other customers not in the nav bake
(shoving); D5 decor/dressing placement unvalidated (latent); D6 two disagreeing walkability
models + render-collider drift. Then P1 (tool wheel, real inventory, physical vacuum pickup)
and P2 (cohesive UI, characters).

## What shipped a prior session — the visual production pass

| Commit | What |
|--------|------|
| `074605c` | Tripo pipeline + real chairs (lounge armchairs, office task chair) |
| `5b5e1eb` | Real POS touchscreen + card terminal at the till; live screens re-seated on real glass |
| `f2e2aab` | Real shoes, caps, rangefinder on the shelves — baked to one draw call each |
| `47b1d6d` | Office course map, lounge course photo, trophy cups |

Nine owner-supplied Tripo scans folded onto the finished logic, render-only, 496 tests green.
`tools/blender/process_tripo.py` keeps each scan's baked atlas via a new `merch.instantiateRaw`;
repeated products still bake to one draw call, so mesh count (1235, was 1289) and materials
(248, was 270) both went DOWN. Gondola (`display_shelf.glb`) + headcover processed but NOT
placed — wiring the gondola as a functional fixture is a feature, not a polish (see VISUALS.md).

## What shipped a prior session — the physical delivery loop

| Commit | What |
|--------|------|
| `d31a53a` | An order is a shipment, not a line item — suppliers, freight, manifest, 9 statuses |
| `beff148` | A shelf holds what it has room for — slot model, capacity = slot count |
| `6bdbf46` | No part of this loop is one E press — tape, flaps, contents into the HANDS |
| `e237bdb` | The loop in 3D — labelled boxes, real flaps, the box cutter, hold-to-interact |
| `0b517b8` | Nine procedural delivery/stocking sounds |

The whole retail loop is physical now: `sim/deliveries.js` (the box as an object) + `sim/stocking.js`
(your hands) + `data/{suppliers,boxes,fixtureSlots}.js`. The manifest is packed ONCE and read by both
the screen and the pad. Fixture compatibility reads `FIXTURES[].skus` — no second table. Proven
end-to-end in the browser with real key presses; autosave/reload keeps half-open boxes and every unit.

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
THE DELIVERY LOOP (this session)
src/data/suppliers.js              who ships what, and freight (base + per box)
src/data/boxes.js                  packaging by contents + planShipment (THE packer)
src/data/fixtureSlots.js           every place a unit stands; capacity = slot count
src/sim/deliveries.js              the box as an object: tape, flaps, contents, recycle
src/sim/stocking.js                your hands, and fixture compatibility
src/render3d/clubhouse.js          the boxes + cutter + armful (search: physical deliveries)
src/render3d/courseScene.js        tap-vs-hold, the box cutter tool, weight-on-speed
tools/qa/delivery-{accept,loop,shelves,boxes-visual}.js

THE LAPTOP (last session)
src/core/laptopRig.js              the machine's frame. Pure geometry, 10 tests.
src/core/laptopProjection.js       the map onto the glass + its inverse, 6 tests.
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

## Landmines added THIS session (full list in DELIVERY.md)

- **The manifest is packed ONCE** (`planShipment`) and read by both the screen and the pad. Never
  re-pack in `arriveOrder` — that is how the two drift a box apart with nobody able to say which is
  right.
- **`shop.orders` means IN TRANSIT** to every reader in the game. A landed order becomes a
  `shipment`; leaving it in `orders` beside its boxes double-counts every unit (the conservation
  test will catch it, but know why).
- **Fixture compatibility is `FIXTURES[].skus`**, not a second table. A second table is a second
  truth that drifts the first time a line moves walls.
- **Capacity is the slot count** (`data/fixtureSlots.js`), read by BOTH the sim and the renderer.
  A "full" shelf that draws fewer than capacity is the brief's "do not fake full shelves" violation.
- **A held key repeats its keydown ~30×/s** — a tap verb bound to the press fires thirty times.
  Tap verbs check the auto-repeat flag; hold verbs run per-frame off the held-key set.
- **The player's hands (`state.shop.carry`) are a real inventory location.** Anything that counts
  units must count them, or an armful looks like destroyed stock.

## Next, in priority order

1. **THE ANIMATIONS** (still job #1, from the register brief). ~22 named animations were asked for
   and none exist. The register is fully physical — real objects, real motion — but the ACTORS are
   not animated. The box cutter, the washer, the vacuum now have first-person hands (P1-5 partial);
   the customers and the checkout actors still do not.
2. **Customers.** Still procedural primitives. The animation work lands on top of whatever replaces
   them, so do this first.
3. **The gondola.** `display_shelf.glb` is processed and ready; wiring it as a functional
   accessories fixture is the next real asset job (new `kind`, carcass, slots, home-fixture
   reassignment, customer pathing, build mode). See VISUALS.md for why it was left.
4. **Laptop product THUMBNAILS.** `thumbs.js` builds simplified primitives, not the merch GLBs, so
   the shop now shows a real shoe/cap/rangefinder while the Supplier/Inventory cards still show a
   primitive or a kraft carton. Needs an async preload of the Tripo props into the thumb rig.
5. **The hand truck.** `STOCKROOM.handTruck` has a floor spot; the oversized-fixture-needs-a-hand-
   truck rule is not enforced (a heavy crate just walks you slowly at 0.45×).
6. **The basket.** Modelled and on the shop floor; customers do not use it.
7. Card **timeout** exists in the register sim (`runCard(tx, {timeout:true})`, tested) but nothing
   in the game fires it — it needs a visible timer the player can watch.

Done this pass (was on this list): the office wall map (redrawn, titled), the lounge course photo
(painterly landscape), the trophies (real cups), and the shoe/cap/rangefinder shelf models.
