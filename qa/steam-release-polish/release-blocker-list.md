# Steam Release Polish Blocker List

Baseline inventory for the checkout-first release gate. Status is `Open` unless explicitly changed in a later QA iteration.

| ID | Severity | Area | Player-visible defect | Baseline evidence |
|---|---|---|---|---|
| B-001 | Blocker | Menu | Public menu says “Working build — placeholder art.” | `baseline/menu/01-main-menu.png` |
| B-002 | Blocker | Cash | Change money cannot be selected reliably; POS remains at `HOLDING $0.00` and the sale soft-locks before receipt. | `baseline/checkout-cash/09-change-counted.png`, `runner-failure.png` |
| B-003 | Blocker | Card | Live renderer never uses the existing swipe judge; payment is two terminal clicks instead of a physical mouse swipe. | `baseline/checkout-card-video/06-card-presented.png`, result log steps 8–10 |
| C-001 | Critical | Handoff | Sale banks while the completed bag remains visibly on the counter; no physical customer handoff occurs. | `baseline/checkout-card-video/12-handed-over.png` |
| C-002 | Critical | Animation | No first-person hands or player checkout animations exist for scanning, cash, receipt, bagging, or handoff. | All checkout baseline frames; `REGISTER.md` “What is NOT done” |
| C-003 | Critical | Character | Checkout customer is a crude procedural primitive assembly that reads as placeholder art. | `baseline/checkout-card-video/02-register-mode.png` |
| H-001 | High | Camera | Open drawer and required wells are clipped below the viewport. | `baseline/checkout-cash/07-drawer-open.png` |
| H-002 | High | Interaction | Drawer pull hotspot and money wells compete for the same projected area; correct change clicks do not become held cash. | Cash video and failed result |
| H-003 | High | HUD | Scanner instruction remains unchanged through payment, receipt, bagging, and handoff. | Card frames 05–12 |
| H-004 | High | POS | Item lines, prices, totals, and status text are too small/low-contrast at 1600×900. | Card frame 05 |
| H-005 | High | Card | Card and reader are tiny/obscured and do not communicate stripe orientation or swipe direction. | Card frame 06 |
| H-006 | High | Character | Change/bag target is a detached floating hand/palm with no connected arm motion. | Cash frame 09, card frame 11 |
| H-007 | High | Receipt | Receipt is a rigid floating strip with no feed, curl, tear, or hand motion. | Card frame 10 |
| H-008 | High | Bagging | Products disappear when bagged instead of visibly entering and filling a carrier. | Card frame 11 |
| H-009 | High | Feedback | Toasts stack over the center work area and obscure the interaction. | Cash frame 07, card frame 11 |
| H-010 | High | Diagnostics | Repeated Canvas2D readback warnings and a WebGL shader warning occur on normal boot. | `baseline/register-boot-final.json` |
| H-011 | High | Loading | Normal bootstrap/reload reports aborted GLB requests; cause must be separated from intentional navigation aborts. | Boot/card/recovery JSON diagnostics |
| H-012 | High | Rendering | Idle approach submits roughly 4,948 draws and 5.67M triangles per median frame. | Performance raw runs |
| H-013 | High | Textures | 182 texture objects/169 unique decoded images estimate to about 5.91 GiB with many 4096² images. | Performance raw runs |
| H-014 | High | Lifecycle | Renderer-resident geometry grows 10–134 across 25 transitions while scene geometry grows by two; 100-cycle plateau is unproven. | Performance raw runs |
| M-001 | Medium | HUD | Turf Health/Moisture chips remain visible during checkout. | All register-mode frames |
| M-002 | Medium | Composition | Background delivery cartons and stock clutter weaken customer/register silhouette. | Card frame 02 |
| M-003 | Medium | Bag | Open carrier, bag stack, and persistent handoff bag have unclear lifecycle and duplicate visual roles. | Card frames 10–12 |
| M-004 | Medium | Customer | Basket model exists but checkout customers do not visibly carry/fill/use it. | Baseline frames; `REGISTER.md` |
| M-005 | Medium | Card | Payment timeout exists in the sim but is untriggered in the live register. | `REGISTER.md` |
| M-006 | Medium | QA | Recovery driver reports a sub-cent binary-float formatting difference as “money invented.” | `baseline/recovery-result.json` |
| M-007 | Medium | Hardware | POS, scanner, terminal, printer, and contactless-looking base have inconsistent scale and unclear hierarchy. | Card frame 05 |
| M-008 | Medium | Shadows | Register scene retains 494 shadow casters, increasing cost without prioritizing checkout hero objects. | Performance raw runs |
| L-001 | Low | Menu state | New-game property market is presented while `app.screen` still reports `menu`, complicating transition diagnostics. | `baseline/menu-result.json` |
| P-001 | Cosmetic | Merchandising | Background signage and product labels intersect or crowd window/display lines. | Card frame 02 |
| P-002 | Cosmetic | Typography | In-world headings, POS monospace, HUD chips, and toasts use inconsistent casing, density, and hierarchy. | Menu and checkout baseline |

## Baseline counts

| Severity | Open |
|---|---:|
| Blocker | 3 |
| Critical | 3 |
| High | 14 |
| Medium | 8 |
| Low | 1 |
| Cosmetic | 2 |
| Total | 31 |

Fix order: B-002, B-003, C-001, C-002/C-003, checkout readability/feedback, then measured rendering and texture bottlenecks. B-001 is the first menu cleanup after checkout accepts both payment branches.

## Checkout gate disposition after iteration 4

The physical transaction gate is accepted. Normal-control card and cash routes,
interruption/re-entry, responsive 1280×720 framing, save/load recovery, and the
100-cycle lifecycle soak are documented in `iteration-4-hardening/report.md`.

Resolved by the four checkout iterations:

- `B-002`, `B-003`, `C-001`, `C-002`
- `H-001` through `H-009`, `H-011`, and `H-014`
- `M-001`, `M-003`, and `M-006`

Resolved by the final register-presentation pass:

- `M-002`: restoration cartons and clutter were moved out of the customer and
  register silhouette, with versioned migration for existing saves.
- `M-004`: customers visibly carry a filled authored basket, place it on the
  counter, and leave without a duplicate basket after handoff or cancellation.
- `M-005`: the live terminal now shows and enforces a 15-second card-session
  timeout, returns the expired card, and supports a clean retry.
- `M-007`: the POS, scanner, terminal, and printer have a deliberate scale and
  task hierarchy, reinforced by compact workflow plaques.
- `P-001`: signage and display labels were resized and repositioned away from
  window and product sightlines.
- `P-002`: brand, operational UI, and numeric/data surfaces now use explicit
  serif, sans-serif, and monospace roles with restrained casing.

Four browser iterations, both payment branches, timeout/retry, recovery,
performance, shader, and packaged-desktop evidence are documented in
`register-presentation/report.md`.

## Menu gate disposition

`B-001` and `L-001` are resolved. The release-facing build disclaimer was replaced
with product copy, New Empire now enters an explicit `market` screen while hiding
the menu, and closing the property market restores the menu without an orphaned
backdrop. Normal browser controls, before/after screenshots, video, screen-state
assertions, and diagnostics are documented in `menu-polish/report.md`.

## Character gate disposition

`C-003` is resolved. Customers and course golfers retain the proven procedural
joint animation but now use an original Blender-authored modular body kit with
readable anatomy, face, headwear, clothing silhouette, hands, and shoes. Shared
geometry and wardrobe materials keep the twelve-character stress scene within the
accepted render budget. Four visual iterations, the final normal-control checkout,
asset/pivot inspection, and paired performance evidence are documented in
`character-polish/report.md`.

## Shader diagnostic disposition

`H-010` is resolved. An instrumented WebGL boot traced X4000 to dynamic channel
indexing in Three r185's GTAO Poisson denoise shader. The game now patches that
specific material instance to its behaviorally equivalent fixed channel without
editing vendor code. Baseline/final shader logs, focused tests, a detached-control
performance comparison, and a clean 25-transition confirmation are documented in
`shader-diagnostics/report.md`.

## Rendering budget disposition

`H-012`, `H-013`, and `M-008` are resolved. Twenty-eight derived runtime GLBs
now enforce a reproducible 1024px atlas cap while the raw owner assets remain
untouched. Directional shadows update once per composed frame, minor character
and stock details no longer submit low-value sun shadows, and planar water no
longer recursively renders color during GTAO's normal pass. Decoded image memory
fell 92.5%, idle draw submissions fell 46.5%, and twelve-character shadow
casters fell 29.7%. Four visual iterations, Blender re-import validation, a
normal-control transaction video, and the final performance soak are documented
in `texture-budget/report.md`.

## Desktop runtime disposition

`S-001` is resolved. Electron 33.4.11 was upgraded to 43.1.1, `npm audit` is
clean, native persistence now validates its sender/key/payload boundary, and
unrequested navigation/windows/webviews are denied. An isolated real-Electron
run proves menu boot, native files, reload/Continue, WebGL, pointer lock,
cleanup, and zero console/CSP errors. Evidence is documented in
`electron43/report.md`.

## Final release-gate disposition

All 31 baseline findings are resolved. There are no known blocker, critical,
high, medium, low, or cosmetic defects remaining in the checkout-first release
scope established by repository instructions.

The broader final-player routes found and resolved seven additional release-polish
defects after the checkout gate was accepted:

| ID | Severity | Area | Finding | Disposition |
|---|---|---|---|---|
| F-001 | High | Pause | Opening and closing the pause menu changed an intentionally paused speed of zero back to normal speed. | Fixed; the exact prior speed is restored and the world route proves zero remains zero. |
| F-002 | High | Accessibility | Reduced motion, UI scale, tool-sway control, and hold/toggle tool use were absent or nonfunctional. | Fixed; all controls apply, persist, and are asserted through the normal pause menu. |
| F-003 | Medium | Settings | FOV changed the camera but its visible value stayed at 60 degrees; sensitivity had no numeric value. | Fixed; both values update live and the 125% UI capture remains unclipped. |
| F-004 | Medium | Branding | The office map used Pinehollow and the entrance monument retained baked Greenfield branding in a Willow Creek save. | Fixed with live save branding; the raw monument asset remains untouched. |
| F-005 | Medium | Stockroom | Every backroom rack duplicated the entire stored quantity, creating overflowing cartons. | Fixed with shared six-unit case allocation and rack-specific capacity/slot tests. |
| F-006 | Medium | Checkout feedback | A failed-swipe warning could remain visible after a later swipe had already entered authorization. | Fixed; accepted gestures clear superseded checkout feedback. |
| F-007 | Low | QA portability | Several browser routes embedded one machine's Playwright cache and output paths. | Fixed with repository-relative output, base URL, and dynamic local Playwright discovery. |

All seven supplemental findings are resolved; final open count remains zero.

| Severity | Baseline | Final open |
|---|---:|---:|
| Blocker | 3 | 0 |
| Critical | 3 | 0 |
| High | 14 | 0 |
| Medium | 8 | 0 |
| Low | 1 | 0 |
| Cosmetic | 2 | 0 |
| Total | 31 | 0 |
