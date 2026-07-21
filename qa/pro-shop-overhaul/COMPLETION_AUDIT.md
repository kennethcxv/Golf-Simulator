# Pro-shop overhaul completion audit

Final audit: 2026-07-20. This supersedes the reopened audit at `2c3a442` and judges the complete attached objective against current code, normal-control browser evidence, raw diagnostics, tests, and committed artifacts.

## Provenance

- Required/current branch: `overnight/pro-shop-overhaul`
- Starting `main`: `0c5137e5f0efac9627ce2309b9e66936f1eeb769`
- Final implementation commit: `f4cb3b6`
- Dedicated worktree: `C:/Users/Kenneth/Documents/GitHub/Golf-Flipper-pro-shop-overhaul`
- Original worktree: preserved and untouched
- Merge into `main`: not performed
- External downloads: none; project-owned asset provenance is in `ASSET_SOURCES.md`

## Phase closure

| Phase | Verdict | Accepted implementation and evidence |
|---|---|---|
| 1. Complete shop audit | Proved | `baseline-audit.md`, `fixture-manifest.md`, the starting/full baseline cameras, exact starting commit, and original-worktree preservation establish the source state and ranked blockers. |
| 2. Shop floor plan | Proved | Data-owned 21 x 13.5 municipal footprint with low centre fixtures, perimeter departments, separate checkout/office/stockroom, basket/service stations, tiered experience destinations, authored traffic paths, and clearance/routing tests. The normal-control A/B/E route traverses the shop and both service doors. |
| 3. Fixture library | Proved | Sixteen repeatable fixture GLBs from `tools/blender/build_shop_fixtures.py`, named slots, applied transforms, believable game-scale dimensions, separate visual roles, and simple data-side collision. `shop-assets`, layout, build-mode, sockets, and tier tests cover the integrated library. |
| 4. Product presentation | Proved | Forty-two physical retail lines, 289 full-store units, one home fixture per SKU, exact 4-15-unit authored sockets, SKU-specific forms/orientation, shared geometry/materials, and empty/partial/full count contracts. Four accepted player-camera passes inspect every department. |
| 5. Clothing displays | Proved | Folded and hanging polos, jacket, pants, shorts, gloves, and socks use apparel/table modules with real thickness, rail/table contact, variants, category signs, prices, and fitting links. Visual passes 1-4 and Route C prove the player view and customer use. |
| 6. Club and bag displays | Proved | Three continuous club-wall bays use authored cradle geometry and distinct driver/iron/wedge/putter heads; four-position bag presentation uses empty-bag bodies without sightline-blocking fans. Premium case, demo rack, putting mat, and authored browse sockets complete the department. |
| 7. Shoe, hat, accessory areas | Proved | Blender shoe wall/try-on ledge, eight-facing hat wall, pegboard, ball wall, basket station, and category-compatible product sockets replaced the failing procedural presentations. Route A/B stocks the new shoe category; Route C records shoe, hat, and accessory browsing. |
| 8. Putting and demo area | Proved to requested retail scope | Tier-3 putting mat, cup/backstop, aim marks, separate three-putter demo rack, and non-blocking customer test socket are physical. A linked short customer state inspects and sweeps a putter, then removes its temporary visual. Route C records the destination. It intentionally does not become full golf gameplay. |
| 9. Checkout area | Proved | Integrated counter, employee corridor, scanner, display, empty live cash drawer, card terminal, printer, staging, basket set-down, impulse rack, bagging and handoff zones remain on the original transaction/save architecture. Natural ambient cash and card runs execute the complete physical sequence without setup hooks or state writes. |
| 10. Snacks and drinks | Proved | Blender glass-front refrigerator and four-tier snack rack hold water, sports drink, soda, crisps, bar, and crackers with 48 authored display units and original fictional packaging. Route C records live browsing. The refrigerator is static because selection does not require an opening-door mechanic. |
| 11. Fitting room | Proved | Tier-3 Blender enclosure includes curtain, mirror, bench/ledge, hooks, light, sign, walkable interior proxy, authored occupancy/facing socket, and a short linked customer fitting state. Socket/collision tests and Route C prove navigation and occupancy without a complex undressing system. |
| 12. Lighting | Proved | Warm general rig, daylight, focused club/apparel/checkout/refrigerator lighting, restrained shadow casters, and basic/standard/premium scales are implemented. `shop-tiers.test.js`, three-state reload proof, four accepted camera rounds, and performance counts cover quality and reconstruction. |
| 13. Materials | Proved | Shared stylized PBR kit covers cream, deep green, sage, walnut, oak, charcoal, brass, rubber, glass, kraft, fabric, and leather. Blender named slots remap through `merch.js`; full-store material/texture counts remain stable across repeated runs. |
| 14. Signs and wayfinding | Proved within existing systems | Original restrained signs/price rails identify retail departments, New Arrivals, Baskets & Cards, fitting, Tour Vault, demo, cold drinks, snacks, scorecards/member service, Pro Shop hours, and Receiving. Fictional branding and shared sign materials are used. No fake dynamic sale signage was added because the game has no sale-promotion system. |
| 15. Customer browsing | Proved | Authored approach/facing sockets cover every retail fixture plus fitting, putting, and premium experiences; reservations are exclusive. Route C records ten shoppers, club/apparel/shoe visits, 14 destinations, four basket users, queue depth five, natural shelf debit, checkout, safe held UIDs, and laptop use. |
| 16. Stocking | Proved | Capacity, visible socket count, prompts, preview, and placement share one source of truth; invalid category/full shelf behavior preserves held goods. Route A/B physically orders, receives, carries, cuts, opens, removes, and hold-E stocks balls and a newly unlocked shoe category. |
| 17. Shop tiers | Proved for the current 1-3 architecture | Basic, standard, and premium presentations differ in active fixtures, categories, lighting, capacity, premium destinations, and customer cap. Route B proves visible laptop order -> real lead time -> physical delivery -> placement/stock change. A luxury tier was not invented because the current progression architecture ends at tier 3. |
| 18. Save and load | Proved | Unit migration covers layout/tier/sockets/partial stock/lighting/fitting/demo. Route E uses Esc Save/Load for untouched basic, upgraded, and partially stocked states; cash, tier, every SKU, decor, layout, boxes, orders, held units, duplicates, fresh customers, and lighting all reconstruct exactly. |
| 19. Performance | Proved | `PERFORMANCE_ACCEPTANCE.md` supplies same-environment baseline/current data, three repeated empty/stress/walk samples, ten-customer counts, draw/triangle/material/texture/heap/listener/UI data, declared budgets, checkout/laptop coverage, and a 30-cycle soak. A discovered character GPU leak and FOV restoration defect were fixed and re-proved. |
| 20. Testing | Proved | Final `npm test`: 533 passed, 0 failed/skipped/cancelled. Coverage includes fixture/asset/socket/category/tier/lighting/stock visual state/checkout/door/laptop/save/conservation/disposal contracts. Browser Routes A-E, natural cash/card, four visual iterations, console checks, videos, and screenshots cover normal gameplay. |

## Acceptance gate matrix

| Gate | Accepted evidence | Result |
|---|---|---|
| Four complete visual-QA iterations | `ITERATIONS.md`; matched before/after folders for passes 1-4; 18 starting + 18 full cameras per run; route videos; normal movement/clock proof; diagnostics; at least ten visible fixes each | Pass |
| Natural card checkout | `natural-checkout-acceptance/card/result.json` and video; Alex R. naturally browsed/picked `glove1`; $19 and one unit banked | Pass |
| Natural cash checkout | `natural-checkout-acceptance/cash/result.json` and video; Quinn B. naturally browsed/picked `tees1`; physical drawer/change/receipt/bag/handoff; $6 and one unit banked | Pass |
| Route A - basic store | `routes-a-b-e-acceptance/result.json`; normal entry/circulation and physical starter-ball stocking; natural checkout evidence supplies customer service | Pass |
| Route B - upgrade | Same result/video; laptop order, real lead time, cartons, placed plant, premium tier, new shoe category, visible capacity | Pass |
| Route C - browsing | `routes-c-d-acceptance-final/cash/result.json`; ten mixed shoppers, 14 destinations, baskets, queue and natural transaction | Pass |
| Route D - full-store stress | Same route plus `performance-acceptance/run.json`; 42 lines/289 units, ten shoppers, checkout, physical laptop, repeated frame/resource samples | Pass |
| Route E - save/load | Three normal Esc save/load snapshots with exact basic/upgraded/partial reconstruction and all nine assertions true | Pass |
| Performance/leaks | Three-sample hardware D3D11 protocol and 30 laptop cycles; flat customer GPU resources; listeners 85 -> 85; heap +9.42 MiB | Pass |
| Automated regression | `npm test` after final code changes | 533/533 |
| Branch hygiene | Dedicated branch/worktree, focused stable commits, no merge to `main` | Pass |

## Diagnostics and scoped limitations

- Chrome's D3D11 compiler emits one non-fatal Three.js X4000 warning. There are no accepted-run page errors or HTTP 4xx/5xx responses. GLB `ERR_ABORTED` entries occur during isolated-context teardown or deliberate scene replacement and remain preserved in raw JSON.
- The current progression architecture supports tiers 1-3 only. The report does not claim a nonexistent tier-4 luxury economy.
- The putting demo is a short customer retail beat, not a player putting minigame or ball-physics simulation, matching the instruction not to turn it into full golf gameplay.
- The refrigerator is glass-fronted and static; existing browsing/selection does not require opening it.
- The valid pre-overhaul D3D11 performance baseline has one sample per scenario; current acceptance has three, so baseline percentage deltas are directional. Current absolute budgets and repeated leak gates pass.
- `package.json` has no build script. Validation is `node --check`, the served browser game, Playwright gameplay, and the complete Node test suite.

## Completion status

**Complete.** Every definition-of-done item is implemented and supported by current normal-control, visual, persistence, performance, and automated evidence. Final report: `FINAL_REPORT.md`.
