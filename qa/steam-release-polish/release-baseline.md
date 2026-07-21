# Steam Release Polish Baseline

Captured 2026-07-19 from the untouched gameplay at the branch starting commit.

## Branch preflight

- Branch: `overnight/steam-release-polish`
- Starting commit: `0c5137e5f0efac9627ce2309b9e66936f1eeb769`
- Source: newest verifiable local `main`; no Git remote is configured
- Starting branch worktree: clean
- Isolation: dedicated `Golf-Flipper-steam-release-polish` worktree
- Pre-existing active worktrees: inspected and left untouched
- Baseline unit suite: 516 passed, 0 failed, 0 skipped in 4.42 seconds
- Dependency audit: one high-severity direct dependency finding on Electron 33; remediation requires a major Electron upgrade and remains outside the initial checkout fix pass

## Scope and release gate

Repository instructions make the player-facing cash-register experience the only production priority until it is accepted. This baseline therefore covers the normal menu/new-game/continue path needed to reach checkout and the complete checkout transaction, recovery, presentation, and performance surfaces. Unrelated game systems remain unmodified and unclaimed until checkout passes its production gate.

The checkout acceptance sequence is treated as eleven physical steps, not merely a state machine. Card and cash must both pass through normal mouse and keyboard input. A fixture may create a repeatable stocked shop and place a real shelf-debited customer at the queue head; it may not mutate the transaction.

## Launch and fixed conditions

- Launch: `node tools/qa/run-playwright.cjs <route> --bootstrap`
- Runtime: branch-local static server spawned and torn down by the runner; Google Chrome controlled by Playwright
- Viewport: 1600×900 at device scale factor 1 for checkout; 1920×1080 for menu presentation
- Save fixture: relaxed mode, seed 424242, Willow Creek, tutorial hidden, ten sale units per stocked SKU
- Checkout customer: two shelf-debited products (`balls3`, `glove1`), forced payment method per route
- Time and lighting: 14:00, runtime default weather and quality
- Cashier camera: authored register focus pose; player enters with normal `E`
- Performance warm-up: loading veil complete plus renderer geometry/texture counts stable for four consecutive 500 ms samples

## Normal-player route results

| Route | Result | Evidence |
|---|---|---|
| Main menu at 1920×1080 | Functional, release-blocked | Public footnote says “Working build — placeholder art.” |
| New Empire — Relaxed | Functional, presentation weak | Property Market opens from a normal click; dense overlay remains on the menu surface |
| Continue | Pass | Boot fixture continues into the actual clubhouse with register API present |
| Customer presents two products | Pass | Two real units leave shelves and enter the held ledger |
| Individual barcode scanning | Pass | Each product is dragged over the physical scanner; duplicate scan is rejected and early total is refused |
| Card payment | State path passes; physical acceptance fails | Two clicks present/run the card. The live renderer never uses the existing swipe judge and no visible swipe occurs |
| Cash acceptance and deposit | Pass through deposit | Player takes tender, opens the drawer, and drags each note into the till |
| Cash change selection/handoff | Blocker | Normal clicks leave POS at `HOLDING $0.00`; customer-hand click cannot advance to receipt |
| Receipt | Card path state passes; presentation fails | Receipt prints and can be taken, but appears as a rigid floating strip with no print/tear/hand animation |
| Bagging | State path passes; presentation fails | Two items become bagged, but visibly disappear rather than entering a carried bag |
| Customer handoff | Accounting passes; physical acceptance fails | Revenue banks only at handoff, but the bag remains on the counter and no handoff animation occurs |
| Mid-transaction save/load | Inventory recovery passes | Both units return to shelves, held ledger clears, no phantom revenue, no ghost transaction, register unlocked |
| Save/reload money comparison | QA defect | Harness labels `9954854.780000001 → 9954854.78` as failure although the difference is below one cent |
| Console errors/page errors | 0 | All completed routes report `errorCount: 0` |
| Warnings/failed requests | Fail | Repeated Canvas2D readback warnings, shader warning, and aborted GLB requests during bootstrap/reload |

## Checkout acceptance matrix

| # | Required physical step | Card | Cash | Baseline verdict |
|---:|---|---|---|---|
| 1 | Customer places products | Partial | Partial | Products appear at the counter without placement animation |
| 2 | Player picks each product individually | Pass | Pass | Normal mouse drag |
| 3 | Barcode physically crosses scanner | Pass | Pass | Swept scanner zone registers each unique unit |
| 4 | POS updates item/quantity/price/subtotal/feedback | Partial | Partial | Data updates, but text is too small and stage guidance is stale |
| 5 | Mouse-driven physical card swipe | Fail | N/A | Live payment is two terminal clicks; swipe judge is not integrated |
| 6 | Physical cash drawer visibly opens | N/A | Partial | Drawer opens, but its wells are clipped below the viewport |
| 7 | Player deposits received cash | N/A | Pass | Each piece is dragged into the drawer |
| 8 | Player selects and gives correct change | N/A | Fail | Money wells do not respond reliably; route soft-locks |
| 9 | Receipt visibly prints and completes interaction | Partial | Blocked | Card receipt is interactive but visually floats/teleports |
| 10 | Player bags all products | Partial | Blocked | State changes correctly; no convincing physical bag fill |
| 11 | Player gives completed bag with clear feedback | Fail | Blocked | Sale banks, but bag remains on the counter |

## Baseline visual review

This is the baseline defect review, not one of the four required post-baseline fix iterations.

1. Main menu, bottom edge: unreleased “Working build — placeholder art” text is visible in a 1920×1080 capture.
2. Customer, upper-left/center of cashier view: body is a crude box-and-sphere assembly with disconnected-looking head, cap, and limbs.
3. Counter center: the customer hand is a detached floating target rather than part of an arm animation.
4. Drawer, bottom edge: essential money wells are partially outside the camera frame.
5. Drawer, bottom center: invisible pull interaction competes visually/spatially with the money wells; change clicks produce no held cash.
6. POS, left third: item lines, prices, subtotal, and status are too small and dim to read comfortably.
7. HUD, bottom center: “Drag goods over the scanner” remains visible through payment, receipt, bagging, and handoff.
8. Card stage, counter center: card and reader interaction is tiny/obscured; no swipe path or readable orientation is visible.
9. Receipt, right-center: paper appears as a stiff narrow rectangle floating from the printer with no feed, curl, or tear motion.
10. Bagging, right side: purchased products vanish when bagged; the bag does not visibly fill or change silhouette.
11. Handoff, right foreground: the completed bag remains on the counter after revenue is banked.
12. Toast stack, screen center: multiple messages overlap and obscure the work surface during cash handling and bagging.
13. Checkout HUD, bottom-right: unrelated turf Health/Moisture chips remain visible during register mode.
14. Counter hardware: POS, reader, scanner, and printer have inconsistent scale and unclear visual hierarchy.
15. Cash view: notes clip under/through the POS base and drawer dividers; drawer materials read as flat black primitives.
16. Whole interaction: no first-person hands appear for pickup, scanning, cash, receipt, bagging, or handoff.
17. Customer/card/cash: items, tender, card, and receipt pop into existence rather than arriving through character animation.
18. Background behind customer: delivery cartons and merchandise clutter weaken the checkout silhouette and marketing composition.

## Performance baseline summary

Three identical game-frame runs were retained. Values below are medians; full raw JSON is stored beside the screenshots.

| Scenario | Avg FPS | 1% low FPS | Worst frame (median) | Avg CPU render | Avg draws | Avg triangles |
|---|---:|---:|---:|---:|---:|---:|
| Idle fixed cashier approach | 60.31 | 39.37 | 27.40 ms | 16.06 ms | 4,948 | 5,667,031 |
| Register active fixed camera | 116.88 | 73.53 | 42.60 ms | 7.08 ms | 3,907 | 5,838,390 |

Register-active resource median: 1,539 nodes, 1,265 meshes, 1,138 unique scene geometries, 268 materials, 182 texture objects, 494 shadow casters, about 134 MB used JS heap, and about 5.91 GiB estimated decoded/mipmapped unique-image data. Many decoded images are 4096×4096.

Across 25 normal Escape/`E` transitions, all three runs had zero net event-listener growth and zero re-entry failures. Heap deltas were noisy (+2.6 to +20.9 MiB before later GC), so this short route does not prove a leak. Scene geometry increased by two while renderer-resident geometry increased by 10–134, which requires the later 100-transition stabilization gate before any lifecycle claim.

## Baseline blocker counts

| Severity | Count |
|---|---:|
| Blocker | 3 |
| Critical | 3 |
| High | 14 |
| Medium | 8 |
| Low | 1 |
| Cosmetic | 2 |
| Total | 31 |

The authoritative issue list is `release-blocker-list.md`.

## Retained evidence

- `baseline/menu/01-main-menu.png`
- `baseline/menu/02-new-game-route.png`
- `baseline/menu-result.json`
- `baseline/checkout-card-video/01-customer-at-counter.png` through `13-done.png`
- `baseline/checkout-card-video-result.json`
- `baseline/video-card-complete/*.webm`
- `baseline/checkout-cash/01-customer-at-counter.png` through `09-change-counted.png`
- `baseline/checkout-cash/runner-failure.png`
- `baseline/video-cash/*.webm`
- `baseline/recovery/1-half-scanned.png`
- `baseline/recovery/2-after-reload.png`
- `baseline/recovery-result.json`
- `baseline/register-boot-final.json`
- `baseline/performance-game-frame-{1,2,3}/01-idle-fixed-camera.png`
- `baseline/performance-game-frame-{1,2,3}/02-register-active-fixed-camera.png`
- `baseline/performance-game-frame-{1,2,3}.json`

## Honest baseline conclusion

The existing pure transaction and inventory-recovery logic are useful foundations, and the card state path can bank a correct sale. The player-facing checkout is not release-ready: cash is blocked, card payment is not a swipe, handoff is not physical, high-frequency actor animation is absent, the UI guidance is stale, and the frame contains obvious placeholder character work. Checkout must remain the only implementation priority.
