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
