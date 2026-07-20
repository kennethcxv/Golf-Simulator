# Pro-shop overhaul baseline audit

## Provenance and protocol

- Branch: `overnight/pro-shop-overhaul`
- Starting commit: `0c5137e5f0efac9627ce2309b9e66936f1eeb769`
- Source branch: local `main` (the repository has no configured remote)
- Original worktree preserved: `integration/all-verified-work-2026-07-18` had unrelated changes and was not modified.
- Dedicated worktree: `C:/Users/Kenneth/Documents/GitHub/Golf-Flipper-pro-shop-overhaul`
- Baseline tests: 516 passed, 0 failed (`npm test`).
- Browser: Chrome 150 through Playwright, headless, 1600 x 900 CSS pixels, device scale factor 1.
- Game route: New Empire - Relaxed, buy the first listed course, enter through the normal game UI.
- Lighting: game clock pinned to 2:00 PM before every fixed camera.
- Evidence: `qa/pro-shop-overhaul/baseline/starting-state/`, `baseline/fully-stocked/`, and `baseline-performance/run.json`.

The fully stocked set is an inspection fixture only: tier 3 is enabled in memory, every eligible retail socket is filled, and no save is written. It exists so empty shelves cannot hide product scale, orientation, clipping, or density defects.

## Player-camera audit

### Entrance and circulation

- The entrance has a clear central axis and readable floor rug, but the rail, hat stand, feature plinth, cartons, and litter create competing silhouettes immediately inside the door.
- The feature plinth is a tall opaque slab that blocks the bag, shoe, and lounge sightline instead of presenting merchandise.
- The main aisle is physically broad, yet the center reads accidental because fixtures do not form a deliberate low-to-high merchandising hierarchy.
- Delivery cartons can accumulate in prime circulation and checkout approach space during ordinary time progression.
- The starting shop is appropriately modest and dirty, but it looks abandoned rather than operational: multiple major fixtures are completely empty while small accessories are already dense.

### Checkout and employee side

- Counter depth, cashier corridor, register reach, scanner placement, and customer approach are fundamentally sound and protected by existing tests.
- The monitor, card terminal, scanner, printer, bags, and staging surface sit on the furniture rather than floating.
- The back-counter sign is attractive but overlarge and overexposed; the category/brand hierarchy is weak from the sales floor.
- The basket stack is hidden low at the aisle end and does not read as a basket station.
- There is no dedicated customer set-down cue, membership/scorecard stand, or clearly framed impulse zone.
- Boxes can visually obstruct the office opening and customer approach even when collision rules keep the counter itself legal.

### Clubs and bags

- Full club bays expose the largest visual failure: shafts extend through the lower cabinetry, heads appear suspended, and the two rack rows do not visibly support the clubs.
- Shafts are too thin and near-black at player distance; grips and head shapes disappear against the dark walnut.
- The driver, iron, wedge, and putter bays share the same spacing language, so valuable categories lack distinct presentation.
- The black/gold header signs clip at the camera edge, have poor contrast, and are less readable than the cream signs elsewhere.
- Bag silhouettes are stronger than the former cylinders, but club fans are too uniform and the platform sign cuts across the merchandise.
- No demo-club rack or putting trial area exists.

### Apparel, hats, and shoes

- Hanging polos read as flat cards with hard rectangular hems and little garment thickness.
- Folded polos form overly perfect rectangular bricks; stacks are too broad and dense for the modest table.
- The apparel table plus rear rail creates a high opaque block across the center sightline when full.
- Outerwear uses one dark silhouette with minimal variant identity.
- The hat tree is overcrowded: brims and crowns overlap, several hats appear to orbit the pole instead of resting on visible pegs, and lower hats sit near knee height.
- The shoe wall has the best existing presentation: paired products, angled illuminated shelves, believable scale, and a nearby bench. It still lacks size-box stock and browsing markers.
- A bench and mirror exist, but there is no enclosed fitting room, occupancy point, hook, curtain/door, or fitting-room sign.

### Balls and accessories

- Ball boxes are fronted and tier variants are readable, but there are no price rails and the large wall unit makes partial stock look excessively sparse.
- Accessories share a generic shelf rather than hooks/pegboard appropriate to markers, divot tools, gloves, and packaged smalls.
- Towels are simplified white rolls without branding or clear category read.
- Umbrellas lean as a tight spike bundle at the edge of the fixture.
- Product labels are readable only at close inspection, and no dedicated rangefinder or sunglasses premium display exists.

### Snacks, drinks, and impulse retail

- No drinks refrigerator exists.
- No water, sports drinks, soft drinks, energy bars, crackers, chips, or countertop snack presentation exists.
- The requested camera sees only checkout furniture because this category is absent.

### Office, stockroom, fitting, and lounge

- The office has a strong window and course map but is visually under-dressed; the closed laptop reads as a thin grey slab and the chair partially blocks the player camera.
- Stockroom rack geometry is structurally credible, but unrelated dressing cartons are visually indistinguishable from real inventory boxes.
- Dense cartons overlap rack bracing and obscure stocking clarity; category zones and receiving labels are weak.
- The lounge is coherent and attractive, but its trophy shelf is too small, the painting/calendar/events style is inconsistent, and it does not form a deliberate transition from retail.
- The exterior communicates a modest municipal shop, but the facade is flat, the window merchandise story is absent, and grime reads as a broad dark overlay rather than localized wear.

## Ranked visible defects from the baseline pass

1. Club shafts pass through lower cabinetry and lack believable cradle support (club wall, center and lower third).
2. Full apparel forms a large flat wall that blocks the central composition (center-left foreground).
3. The feature plinth is an opaque sightline blocker with no convincing featured product (center-right).
4. Snacks and drinks are entirely absent (checkout-adjacent zone).
5. No fitting room exists despite the labelled audit location (east sales wall).
6. No putting/demo area exists (putter zone).
7. Hat crowns and brims overlap and do not visibly contact authored pegs (center floor).
8. Club category signs are clipped, dark, and inconsistent with the rest of the sign system (west wall top).
9. Product price labels and shelf-capacity cues are absent throughout (all retail walls).
10. Accessories use shelf rows where pegboard hooks are needed (north wall).
11. The basket station is hidden below the normal sightline (checkout aisle end).
12. Checkout lacks a clearly framed customer staging and bagging story from the approach (south-east).
13. Delivery cartons and trash compete with the entrance and office routes (center and south-east floor).
14. Starting stock distribution makes major categories look abandoned while smalls look finished (whole shop).
15. Bags have uniform club fans and a sign crossing the product silhouette (east-center).
16. Shoe wall lacks size boxes and authored browse/try-on markers (east wall).
17. The office laptop looks too thin and visually inert when closed (office desk).
18. Stockroom dressing cartons obscure real stock state and rack structure (stockroom north/east).
19. Lighting is warm but flat; products receive little focused hierarchy beyond shelf strips (whole sales floor).
20. Cream walls are blown out in window-adjacent views while dark walnut loses detail (office/lounge contrast).
21. Large ceiling beams dominate several compositions and crop fixture signs (upper third).
22. Exterior window display and retail identity are weak from outside (south facade).
23. Tier 3 changes available products but does not visibly upgrade the fixture library, finishes, or lighting.
24. Browse stops are inferred from fixture position with random offsets rather than authored sockets.

## Functional, console, and performance baseline

- Normal-control `W` input moved the player 0.85 yards in the instrumented route.
- Customer browse positions are currently generated from a single open-side heuristic with random jitter; there are no per-fixture browse sockets.
- Stocking capacity and visual slots share `fixtureSlots.js`, which is a strong invariant to preserve.
- Checkout physical placement has extensive existing coverage and must not be replaced.
- No JavaScript console errors or page errors were recorded. Repeated Canvas2D `willReadFrequently` warnings were recorded.
- Some GLB requests end as `net::ERR_ABORTED` during asynchronous prewarm/load churn; the visible scene falls back without a fatal error, but final QA must confirm required new assets load successfully.

The headless host used SwiftShader and was severely CPU-bound. These figures are retained only as an identical before/after regression baseline:

| Scenario | Average FPS | 1% low | Worst frame | Visible meshes | Scene triangles | Materials | Textures | JS heap | Active listeners |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Empty/basic idle | 0.33 | 0.33 | 2991.8 ms | 1075 | 1,748,207 | 223 | 160 | 53.44 MiB | 92 |
| Full/premium/10 shoppers | 0.22 | 0.22 | 4599.8 ms | 1348 | 2,125,241 | 296 | 173 | 72.14 MiB | 92 |
| Full/premium normal-control walk | sampler starved | sampler starved | unmeasured | 1348 | 2,125,241 | 296 | 173 | 99.64 MiB | 92 |

Texture memory is an RGBA8 dimension-plus-mipmap estimate and not an exact GPU allocation. The walk sampler was starved by the software renderer, so zero frames is recorded as unmeasured rather than treated as zero performance.

## Floor-plan direction

- Keep the main door, office opening, stock door, receiving path, cashier corridor, laptop seat, and checkout queue clear.
- Maintain the modest municipal footprint and current ownership/economy architecture.
- Keep low fixtures around the entrance and center aisle; push tall presentation to perimeter walls.
- Replace the opaque feature slab with a low arrivals table/putting feature.
- Consolidate clubs on the west wall with real sockets, a short demo rack, and a compact mat that does not enter the center circulation lane.
- Keep apparel as a low folded table plus perimeter hanging presentation rather than a central wall.
- Turn the east sales wall into a coherent shoe/fitting/bag sequence.
- Add a compact refrigerator/snack bay near checkout without entering the queue or cashier corridor.
- Add a visible basket station and scorecard/membership stand at the entrance/checkout transition.
- Author explicit browse and stocking sockets for every retail fixture.
