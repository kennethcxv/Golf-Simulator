# Pro-shop overhaul completion audit

Audit reopened 2026-07-20 against the complete attached objective. The repository, current branch, runtime harnesses, retained evidence, and tests are authoritative. Earlier prose claims are not treated as proof.

## Provenance

- Required branch: `overnight/pro-shop-overhaul`
- Current branch: `overnight/pro-shop-overhaul`
- Starting `main`: `0c5137e5f0efac9627ce2309b9e66936f1eeb769`
- Current audited head: `dcc62fcdae7c6f2e92efdd10c210176a21d40c41`
- Merge base: the recorded starting `main` commit
- Worktree at audit start: clean
- Other worktrees: enumerated and untouched
- Merge into `main`: not performed

## Evidence classifications

- **Proved**: direct current-state evidence covers the full requirement.
- **Partial**: some implementation exists, but one or more explicit clauses lack direct proof or are contradicted.
- **Missing**: no current implementation/evidence covers the requirement.
- **Invalid evidence**: an artifact exists, but its protocol does not meet the stated gate.

## Phase-by-phase audit

| Phase | Verdict | Current evidence | Gap that must close |
|---|---|---|---|
| 1. Complete shop audit | Proved | `baseline-audit.md`, 16 baseline cameras in both states, `fixture-manifest.md`, branch provenance | Final report must link the manifest and retain exact launch protocol. |
| 2. Shop floor plan | Partial | Data-owned 21 x 13.5 layout, clearance tests, 18 cameras, authored fixture sockets | Basket station is not a distinct floor-plan fixture; fitting/demo/premium destinations have no customer sockets; emergency-route coverage is implicit rather than named. |
| 3. Fixture library | Partial | Eleven repeatable Blender GLBs plus existing register/merch GLBs; simple data collisions; named shared materials | Ball wall, shoe wall/bench, hat presentation, basket station, small spinner, freestanding/demo rack, and several physical sign/rail modules remain runtime procedural. The requested fixture contract is not tested across empty/partial/full/tier states. |
| 4. Product presentation | Partial | Exact 4-15 product slots for 42 retail lines; final full-stock screenshots; shared material kit | No automated geometry contract proves outward facing, shelf contact, clipping bounds, or absence of placeholder cubes for every SKU. Highest-instance draw-call behavior is not budgeted. |
| 5. Clothing displays | Partial | Folded and hanging apparel GLBs; polos, jacket, pants, shorts, gloves, socks in layout | Current player-camera evidence is visual only; no placement contract proves thickness/rail contact, and no tier/color/size presentation test exists. |
| 6. Club and bag displays | Partial | Blender club wall, separate head GLBs, exact slots, empty bag GLB, final screenshots | No distinct freestanding/demo rack asset; no normal-control customer reach/carry proof; bag opening/strap/club-socket requirements are not recorded by an asset inspection. |
| 7. Shoe, hat, accessory areas | Partial | Lit angled shoe wall, bench geometry, pegboard, variants, authored browse points | Shoe wall and hat tree are runtime procedural rather than production GLBs; the requirement calls for a hat wall/shelf and the accepted image still uses a freestanding tree. No player-driven try-on proof exists. |
| 8. Putting and demo area | Missing function | Premium putting-mat GLB and static putter/balls appear at tier 3 | The mat is visual-only: no browse/test socket, no short customer test state, no one/two-putt feedback, and no return/selection proof. |
| 9. Checkout area | Partial | Strong spatial/unit tests; recorded physical scanner/card/cash/receipt/bag/handoff interactions | `register-sale.js` calls `sendToCounter()` and directly prepares stock/camera. The checkout skill rejects programmatic state injection as end-to-end acceptance. A naturally arriving customer and normal player navigation are still required. |
| 10. Snacks and drinks | Partial | Blender fridge/rack, original fictional atlas, 24 drinks and 24 snacks, exact stock sockets | Refrigerator door is deliberately static. That is acceptable only if gameplay does not require opening, but normal-control browsing/selection still lacks direct proof. |
| 11. Fitting room | Missing function | Blender enclosure, curtain, bench, mirror, light/sign presentation | No authored occupancy socket, no customer fitting state, no navigation/occupancy test, no clipping proof, and no purchase-likelihood adapter. |
| 12. Lighting | Partial | Warm shell rig, display emissive strips, refrigerator light, daylight, final screenshots | No explicit basic/standard/premium lighting contract or test. Current tier relay does not prove light-count/color/intensity changes, and no focused lighting/shadow budget was measured. |
| 13. Materials | Proved visually | Shared Pinehollow material library, stylized procedural PBR maps, named GLB slots and remapping, accepted screenshots | Final asset inspection must record slot reuse and confirm no duplicate material explosion across repeated stock. |
| 14. Signs and wayfinding | Partial | Category headers and price rails for major retail fixtures; fitting, Tour Vault, drinks/snacks, scorecard signs | Checkout, stockroom, new-arrivals and tier/sale presentation are not all covered by a sign contract; interaction-range readability has only screenshot evidence. |
| 15. Customer browsing | Partial | Exclusive authored sockets for stock-bearing fixtures; ten-customer diagnostic reports unique reservations and 0.60-yard separation | Putting demo, premium case and fitting room are excluded because they have no SKUs/sockets. No retained normal-control run proves approach side, reach, basket use, return/abandon, and checkout together. |
| 16. Stocking | Mostly proved | Exact socket capacity is the sim capacity; one home fixture per retail SKU; category rejection, conservation, empty/full logic, prompt counts and preview | Player-driven Route A must still stock starter products through normal controls and retain evidence for empty, partial and full visual states. |
| 17. Shop tiers | Partial | Tier-3 supplier progression visibly populates Tour Vault and putting studio; `minTier` hides premium fixtures | Fresh games start at supplier tier 2, basic/standard presentation is not separately evidenced, lighting does not visibly tier, and no normal UI upgrade route proves purchase -> world change -> new stock. There is no tier-4 architecture, which must be handled honestly rather than claimed. |
| 18. Save and load | Partial | Layout, stock, renovation, progression and interrupted checkout have unit tests; one mid-sale browser reload exists | Required browser routes for basic layout, upgraded layout and partially stocked layout are absent. Fitting/demo customer safety and exact tier visual reconstruction are unproved. |
| 19. Performance | Missing gate | SwiftShader before/after captures record scene/resource metrics; listener count stayed 92 | Protocol omits checkout, laptop, refrigerator/glass, repeated interactions and leak samples. The exact final sample has only one frame, JS heap regressed 20.9%, and no repository budget/tolerance was set. This cannot support “acceptable” yet. |
| 20. Testing | Partial | 519-test suite covers layout, stock conservation, build mode, checkout state, doors and save migration | Missing explicit tests for empty/partial/full visual contracts, floating/clipping bounds, fitting occupancy, demo state, lighting tier, tier visual reconstruction, product batching/performance budget, and the five required normal-control routes. |

## Invalid or insufficient retained QA

### Four-pass visual gate

`tools/qa/pro-shop-overhaul.mjs` runs the normal-control walk only when performance capture is enabled. The retained visual rounds were invoked with `--capture-only`, so their `metrics` arrays are empty and they contain no normal-control proof. The defect tables describe real revisions, but the browser-game visual-QA skill counts an iteration only when the same round includes launch, normal controls, console/network inspection, all fixed cameras, explicit comparison, ten defects, and subsequent fixes. Four compliant iterations still have to be run and retained.

### Checkout gate

The retained card/cash videos physically exercise the register after setup, but `tools/qa/register-sale.js`:

1. directly fills shelf inventory,
2. directly places the player behind the counter,
3. calls `sendToCounter(['balls3', 'glove1'], mode)` to create the active transaction.

Those are useful deterministic component tests, not full end-to-end acceptance. A compliant route must start a fresh game, navigate with normal controls, allow a customer to arrive/browse/pick/place products through the live customer system, then complete all eleven checkout steps through mouse/keyboard controls.

### Performance gate

The before/after files are useful scene diagnostics, but they do not satisfy the performance skill because the full scenario is not identical at a statistically useful frame count and several required stress interactions are missing. A fixed hardware/browser/quality protocol, multiple samples, interaction repetition, budgets/tolerances, and raw results are required.

## Required implementation milestones

1. Add data-owned experience sockets and short fitting, putting-demo, and premium-browse customer states without replacing the customer state machine.
2. Complete the missing production fixture modules that materially affect the player camera, starting with hat wall, shoe wall/bench, basket station, ball wall and demo rack; rebuild by repeatable Blender Python and integrate the GLBs.
3. Make tier presentation a tested world contract: standard starting fit-out, premium supplier transformation, fixture visibility, lighting state, save reconstruction and no stale placeholders.
4. Add geometry/presentation contract tests for every SKU and fixture state, plus fitting/demo/tier/performance budgets.
5. Replace continuation-prone QA boot with a guaranteed fresh New Empire route, and add normal-control proof to every visual iteration.
6. Add natural-customer card and cash acceptance without `sendToCounter` or direct transaction mutation.
7. Run browser Routes A-E, four compliant visual passes with ten defects and fixes each, and a complete performance protocol.
8. Replace `FINAL_REPORT.md` with all 28 requested report items and only evidence-supported completion claims.

## Completion status

**Not complete.** The current branch is a strong visual prototype and deterministic checkout component pass, but explicit functional, tier, end-to-end, four-iteration, save/load and performance gates remain open.
