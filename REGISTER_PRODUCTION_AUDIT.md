# REGISTER PRODUCTION — PHASE 8 AUDIT (the physical card swipe)

The brief asks for a "complete physical cash register production pass" and lists a
long failure catalogue: *press E to charge, scans instantly, one-button card, money
as UI text, hidden drawer, automatic change, invisible hands, teleported products.*

Read against the code, **almost none of that failure list is still true.** The
checkout was already rebuilt into a physical counter last cycle — the honest state,
in the register's own words, is in `REGISTER.md`. This audit records the current
baseline, matches the brief's demands against what already exists, and names the one
concrete, high-value mechanic the brief asks for that genuinely does **not** exist:
the **physical card swipe (brief Phase 8)**. That is this session's scope.

Baseline evidence: `qa/register-production/before/` (gitignored).

---

## What the brief asks for vs. what already ships

| Brief demand | State today | Where |
|---|---|---|
| Not "press E to charge" | ✅ Gone. A real physical counter with a cursor. | `registerMode.js` |
| Products placed / picked up physically | ✅ Goods are meshes you grab and move. | `buildItemMesh`, `grab`/`release` |
| Labels scanned physically | ✅ Drag the barcode across a **swept** scan volume; a fast flick can't tunnel. | `segmentHitsBox`, `tests/register-scanzone` |
| POS monitor readable, itemised | ✅ Line items, subtotal, discount, total, live status line — on the real glass. | `drawScreen` |
| Cash drawer opens physically | ✅ A modelled drawer that slides on easing. | `update`, `cash_drawer.glb` |
| Money is physical, not UI text | ✅ Drawn FAIRWAY RESERVE notes + coins, deposited **one piece at a time** into wells. | `depositPiece`, `billTexture` |
| Change selected & handed back physically | ✅ Click notes out of the drawer into your hand, click the customer's palm. | `takeFromDrawer`, `handOverChange`, `palm` |
| Receipt prints as a physical object | ✅ A receipt mesh you pick up off the printer. | `printReceipt`, `receiptMesh` |
| Bagging | ✅ Drag each item into the open bag; a proximity ring that matches its own hitbox. | `bagItem`, `bagRing` |
| Transaction state machine | ✅ Explicit stages, money moves in exactly one guarded place. | `sim/register.js`, 45 tests |
| Save / recovery safe | ✅ `shop.held` is a saved location; reload returns goods, banks nothing. | `recoverCheckout`, `tests/register-abandon` |
| **Card paid by a physical mouse swipe** | ❌ **MISSING.** Card is *click to present → click to run → auto-approve.* | `tapTerminal`, `drawTerm` |
| First-person hands / ~22 animations | ❌ Deferred (biggest gap; see below). | — |
| Customer models / animations | ❌ Still procedural primitives. | — |

---

## The card interaction, view by view (brief Phase 1 dimensions)

Baseline `before/02-card-ready-click-to-run.png`: the POS shows the itemised order and
the status line **"CARD READY — RUN THE TERMINAL"**, and the terminal is run by
**clicking it**. Against the brief's checklist for this view:

- **Missing interaction** — the brief's Phase 8 is explicit: *"The player moves the
  mouse from top to bottom. The card physically follows the downward mouse movement
  through the swipe channel."* Today there is no swipe: a click presents the card, a
  second click authorises it. This is the "one button card payment" the failure list
  calls out, and the single most specific mechanic in the brief that is absent.
- **No swipe channel** — the terminal prop has a screen but no visible reader slot for
  a card to travel down.
- **Bad scale / camera** — the terminal is small and sits ~21° off-axis from the
  cashier pose (`before/01`), too small to work a precise gesture against. The swipe
  needs its own brief-mandated camera focus (Phase 8: *"Camera smoothly focuses on the
  physical card swiper"*).
- **Weak feedback** — the terminal screen says "TAP TO PAY / click to run"; there is no
  swipe prompt, no direction/speed guidance, no "swipe slower / again / downward" of
  the kind the brief specifies.

Everything downstream of a successful read — the bank's decline chance, the
"second card clears more often" logic, the receipt, the void/abandon safety — is
already correct and tested, so the fix is surgical: replace **how `card-ready` is
exited** (a physical swipe instead of a click) and feed a good swipe into the existing
`runCard` path. No money rule changes.

---

## This session's scope

**Brief Phase 8 — the physical card swipe.** A pure, tested gesture validator
(`sim/cardSwipe.js`) that judges a top-to-bottom mouse path by direction, travel,
reversal and speed with the brief's forgiving messages; wired into `registerMode` as a
card that rides a visible channel under the cursor, with a swipe-focus camera and
terminal screen states. A successful swipe enters the existing `card-busy → runCard`
authorisation, preserving every money rule and the decline/retry flow.

## Deferred, and honest about it

- **First-person hands & the ~22 animations** — the biggest remaining gap, called out
  in `REGISTER.md` and open as task #91. High-effort, depends on a hand rig and on the
  customers being more than primitives; not a one-session job and easy to do badly.
- **Customer models / checkout animations (Phase 11)** — customers are still procedural
  primitives; the animation work lands on whatever replaces them, so it waits on that.
- **Cash-change POS clarity (reference-driven)** — the one reference image the owner
  supplied is a cash-change screen (big *Received / Total / Change / Giving* numbers).
  Ours is a correct but plain status line. A dedicated big-number change panel is a
  strong, self-contained follow-up if this session's swipe lands with time to spare.
- **Impulse rack is scenery; payment timeout is in the sim but unfired in game** — both
  noted in `REGISTER.md`, both out of this session's scope.
