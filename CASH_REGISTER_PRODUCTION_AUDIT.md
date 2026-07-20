# Cash Register Production Audit

Date: 2026-07-14  
Reference: `Designs/CashRegister/Screenshot 2026-07-14 210007.png`  
Baseline: `qa/cash-register-production/before/`

## Reference composition

The single 2225 x 1258 reference was opened at full resolution before implementation.
It uses an intimate cashier viewpoint rather than a wide room camera: the tilted POS
occupies roughly the lower-center/right half of the frame, the open bill drawer is
immediately beneath it, the customer is close across the counter at upper-center/left,
and enough shop floor remains visible to keep the interaction physical. The target is
therefore a 55-70 degree cashier view with a legible POS and customer together, plus
short, reversible focus moves for the scanner, card reader, drawer, receipt, and bag.

## Baseline run

The game was launched through `npm.cmd run serve` at 1600 x 900, device scale factor 1,
and 2:00 PM lighting. A deterministic QA save and `sendToCounter` fixture were used only
to avoid waiting for customer RNG; every checkout action after setup used normal mouse
and keyboard events. `tools/qa/run-playwright.cjs` provides an isolated Playwright
runner because the shared MCP Chrome profile was already locked by another session.

- Boot: zero console errors; repeated Canvas2D readback warnings and several aborted
  optional GLB requests were recorded.
- Card: the two-item fixture could be scanned, physically swiped, approved, receipted,
  bagged, and banked. This is not final acceptance because it bypasses approach and
  placement, uses only two items, floats every prop without hands, and has no recording.
- Cash: the run reached visible tender, drawer opening, individual deposit, and change
  selection, then stalled when the normal palm click did not advance to receipt.
- Save/load: existing browser and unit evidence covers mid-scan recovery, but not a
  partially mutated cash drawer.

## Highest-impact defects

1. Organic shoppers can collect only one item, so the required three-item card order
   is impossible without a diagnostic fixture.
2. The customer's carried item and the register's item mesh duplicate the same product.
3. All counter products appear in one frame; no sequential placement animation exists.
4. Checkout uses a block customer with no hand IK, payment, change, bag, or reaction poses.
5. Products, card, bills, coins, receipt, and bag move or float without first-person hands.
6. Every runtime barcode is the same top-face label; it encodes no SKU and has no facing
   requirement or player-controlled item rotation.
7. `scanFlash` is never rendered, so scanning has no visible beam/light.
8. The POS is too small in the normal cashier view and omits transaction number,
   thumbnails, persistent tender/change fields, and several required explicit states.
9. The swipe close-up loses the POS, most of the customer, and physical hand context;
   the added swipe rails visually intersect the raw terminal.
10. The drawer occupies the HUD region, lacks separate animated housing/tray/clips, and
    accepts deposits anywhere instead of denomination-specific compartments.
11. Cash drawer mutations persist before completion; void/save can retain partial cash.
12. Cash receipts print tendered `$0.00` because deposited tender has already been emptied.
13. Incorrect realistic-mode change is not reconciled with actual cash movement.
14. The receipt appears fully formed, is deleted on click, and never physically enters the bag.
15. Bagged product meshes are hidden rather than represented in the bag and leak invisibly
    in the scene graph after repeated transactions.
16. The bag does not move into a hand or to the customer; a fixed translucent palm sphere
    banks the sale and a different bag appears on the customer.
17. Pointer-lock loss, blur, and leaving register mode do not fully recover swipe/grab/
    drawer/print state or restore pointer lock.
18. There is no cash-register matched performance baseline, four-pass evidence matrix,
    ten-defect/fix log per pass, or card/cash acceptance video.

## Asset audit

The existing build scripts collide on `cash_drawer.glb`; running `build_props.py` after
`build_register.py` silently replaces the newer drawer. Generated register components are
joined into one mesh with no moving hierarchy, animation, collision nodes, or interaction
anchors, and no `.blend` production source is retained. The live POS and terminal are raw
single-mesh Tripo assets with 4096-square atlases. The current scanner is a handheld gun,
not a counter glass bed. Raw Tripo inputs remain immutable and no external assets will be
downloaded.

## Implementation order

1. Make drawer/inventory/revenue mutations atomic and add regression coverage.
2. Enable organic multi-item baskets and sequential customer placement without duplicate props.
3. Build/export separated production register components with pivots, collision proxies,
   anchors, stylized PBR materials, and believable dimensions.
4. Integrate hands, SKU barcodes, rotation/orientation scanning, scanner light, and focused cameras.
5. Finish card/cash physicality, receipt emergence/collection, visible bagging, and bag handoff.
6. Complete recovery, full tests, matched performance runs, four visual fix passes, and
   uninterrupted normal-control card/cash recordings.

This audit deliberately does not treat passing unit tests or the fixture-driven card run
as completion evidence.
