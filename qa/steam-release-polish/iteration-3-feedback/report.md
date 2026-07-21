# Iteration 3 — Player feedback and checkout hands

## Scope

This pass kept `src/sim/register.js`, inventory conservation, revenue posting, and
save data unchanged. It revised only first-person presentation, checkout notices,
customer timing, warning-producing canvas setup, and QA diagnostics.

Baseline references are the accepted iteration-2 card and cash recordings in
`../iteration-2-motion/`. The clearest before frames are `03-scanned-one.png`,
`07-card-swipe-incomplete.png`, `09-change-counted.png`, `10-receipt-printed.png`,
and `12a-handoff-motion.png`: every cashier-owned object moved without a visible
cashier hand.

## Visible defect list and fixes

1. Scanned products floated with the pointer. The shared first-person rig now uses
   a two-hand checkout carry pose that follows the projected pointer.
2. The card moved through the reader without a grip. A one-hand pinch pose now
   follows the actual swipe samples.
3. Customer tender jumped into cashier ownership without a visible reach. Cash
   pickup now triggers the pinch pose and tactile kick.
4. Drawer controls moved without a hand. The normal `[D]` path now shows the hand
   reaching toward the till.
5. Notes and coins left the drawer with no cashier contact. Denomination clicks now
   put the hand inside the visible well/cup being selected.
6. Receipt pickup had no player animation. The hand now reaches to the physical
   printer output while the paper moves away.
7. Bagging and carrier handoff had no player support. Products use the two-hand
   cradle and the final palm click uses a longer two-hand handoff beat.
8. Hands had no response to contact. Checkout actions now use the shared rig's
   recoil/kick and settle motion in addition to the existing differentiated SFX.
9. Hands snapped out of existence on release. The shared rig now preserves its last
   pose while easing below view.
10. Old checkout responses could remain under a newer transaction stage. Checkout
    uses a replacing toast channel, including explicit invalid-swipe and handoff
    messages.
11. World/simulation notices could cover checkout feedback. Non-checkout toasts are
    suppressed only while register mode is active; they resume normally afterward.
12. Material-derived texture canvases emitted repeated readback warnings because
    their first context was GPU-backed. They now establish
    `willReadFrequently` on the first `getContext` call; the washing dirt sheet uses
    the same correct setup.
13. Deliberately canceled menu-scene GLB requests were reported as gameplay network
    failures. The runner now excludes only Chromium `ERR_ABORTED` cancellation;
    actual request failures and HTTP failures remain recorded.
14. A following shopper could start a transaction inside the paid/handoff framing.
    The queue now waits until register mode releases the completion beat.
15. A camera-owned hand rig could survive clubhouse teardown. Register disposal now
    detaches and disposes its hand geometry/materials during the normal lifecycle.

## Functional and visual acceptance

- Card: `card-accepted-2/result.json` — `ok: true`, zero application errors, five
  asserted hand checkpoints (scan, physical invalid swipe, receipt, bagging,
  handoff), 2 units and $66 posted only after handoff, order held UIDs cleared.
- Cash: `cash-accepted/result.json` — `ok: true`, zero application errors, seven
  asserted hand checkpoints (scan, tender, drawer, change, receipt, bagging,
  handoff), correct physical denomination flow, 2 units and $66 posted only after
  handoff, order held UIDs cleared.
- Both routes were driven through the normal `[E]`, keyboard, and mouse controls at
  1600×900 and include full Playwright WebM recordings.
- Visual review accepted the reduced 0.55-scale grip at the real projected pointer
  height. Key after frames: card `07-card-swipe-incomplete.png`,
  `10b-receipt-taken.png`, `12a-handoff-motion.png`; cash
  `07-drawer-open.png`, `09-change-counted.png`, `10b-receipt-taken.png`, and
  `12a-handoff-motion.png`.
- The repeated Canvas2D warnings and harness cancellation noise are gone. Both runs
  retain one Chromium/ANGLE `THREE.WebGLProgram` X4000 warning; there are no page
  errors, application console errors, or real request failures.
- Unit/integration suite: 524/524 passing, including the new grip and lowering tests.

## Remaining work for iteration 4

The final checkout pass will target lifecycle/re-entry, save/load, responsive
framing, and measured before/after performance. It will not expand into unrelated
economy or course systems.
