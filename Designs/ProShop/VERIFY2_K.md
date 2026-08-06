# VERIFY2_K — adversarial verification of queue K (2026-08-05)

Verifier ran the GAME in Electron only (`node tools/qa/run-electron.cjs tools/qa/<driver>.js`).
No src/ edits. Nothing committed. Probe drivers (untracked): `tools/qa/verify2-k1-longname-stamp.js`,
`verify2-k1-oneword.js`, `verify2-k3-coins-card-hover.js`, `verify2-k4-totals.js`,
`verify2-k4-exact.js`, `verify2-k5-faces.js`, `verify2-k5-declined2.js`.
All evidence under `qa/electron/verify2-k/` (gitignored).

**Environment note.** A parallel session was live-editing the working tree during this pass; two runs
died on half-saved intermediate states (`boundAction is not defined` in main.js, then `keyForAction is
not defined` in courseScene.js — both later coherent). All subsequent runs were pinned to a temporary
worktree at HEAD `6222f69` (contains K1/K3/K4/K5 commits), junctioned node_modules; worktree removed
after evidence was copied back. The first K1 run executed on the live tree during a coherent window
with zero page errors; its bag numbers match the worktree runs exactly.

---

## K1 — bag scale 1.35, wrinkle bump, stamp never cut off

**Verdict: REFUTED** (on the "stamp NEVER prints cut off" absolute; the scale and wrinkle sub-claims hold).

What ran: `verify2-k1-longname-stamp.js` — set `state.clubName = 'Northamptonshire County Golf and
Country Club'` (45 chars) before the texture rebuild, card flow to card-entry, plus a cash leg with
`uiPrefs.checkout.largeTextAndTargets = true`. Then `verify2-k1-oneword.js` — a single-word name.

Confirmed:
- Live `FrontDeskShoppingBag.scale` read 1.35 (uniform) at four checkpoints (card tx-start, card-entry,
  cash tx-start, cash-tender), and equals the module's own `CHECKOUT_BAG_PRESENTATION.scale`.
  `largeTextAndTargets` changed nothing about the bag (`qa/electron/verify2-k/k1-longname/verify2-k1.json`).
- Wrinkle: 15 of 75 bag materials carry a bump map (1 shared source); faint crease veining is visible on
  the flanks in `k1-longname/card-entry-oblique.png`. Subtle, top face reads smooth, but present.
- The 45-char multi-word name fits: balanced two-line split, subtitle fitted, all ink inside the border
  (ink x∈[51,588] on the 640-wide canvas) — `k1-longname/stamp-longname.png`, in situ
  `k1-longname/card-entry-top.png`.

Refuted:
- **A single-word club name ≥ ~34 chars prints cut off mid-letter at both edges.** The laptop
  Settings club-name input has **no maxlength** (`src/ui/laptop.js:3204`), so this is enterable in
  normal play. With `Llanfairpwllgwyngyllgogerychwyrndrobwllllantysiliogogogoch` (58 chars) the stamp
  ink spans x=0..639 with 69 ink pixels on the canvas edges — photographed:
  `qa/electron/verify2-k/k1-longname/stamp-oneword.png` (reads "NGYLLGOGERYCHWYRNDROBWLLLLA", both
  ends amputated, text runs under the border).
- Mechanism (for the fixer): `checkoutDisplayBrandLines` keeps ≤2 words on ONE line
  (`simplifiedRegisterMode.js:134-147`); `setFittedCanvasFont` floors at `height*0.04` = 30px
  (`:836-842`); `fillText` is unclipped. 540px maxWidth / (~16px per glyph at the floor) ≈ 33-char
  ceiling for one token.

Repro: laptop Settings > Club name > paste a 58-char single word > run any checkout, or
`node tools/qa/run-electron.cjs tools/qa/verify2-k1-oneword.js`.

## K2 — bag present and posed from transaction start (at the new 1.35)

**Verdict: CONFIRMED.**

At `register.isActive()` with zero items rung (POS shows "RINGING PRODUCTS", TOTAL $0.00) the bag is
already laid at counter-left, face-up, mouth toward the goods, scale 1.35, euler (-1.571, 0, 1.571),
not sunk: `k1-longname/card-tx-start-frame.png`, `k1-longname/card-tx-start-top.png`. Same in the cash
flow across all three K4 legs (`k4-totals/verify2-k4.json` → `bagAtStart` per leg) and with
largeTextAndTargets on (`k1-longname/cash-largetext-tx-start-frame.png`).

## K3 — cash hover highlight is the outline of the note only

**Verdict: REFUTED** on the attacked surfaces (coins, presented card). The plain note case holds.

What ran: `verify2-k3-coins-card-hover.js` — cash customer with prices 6.90/9.20/19.62 and
`tx.rng = () => 0.2` set before ringing (odd-cents digger → tender {20:2, 0.1:2, 0.01:2} = $40.22),
frozen-pose probe renders A/B (controls) and C (hovered) at 0.38 m plus a coin-tight 0.20 m pose;
then a card customer hovered at card-ready. Controls were pixel-identical (controlChanged 0) in all
three probe pairs, so every diff below is the hover's own contribution.

Held:
- The two $20 notes get border frames that track their rotation; note faces untouched
  (note-centre box: 0 changed pixels; blob detector: 0 filled masses at the calibrated kernel).
  `k3-coins-card/cash-hovered.png`, `k3-coins-card/cash-diff.png`. No inverted-hull sheets on money;
  all 12 shells are flat ShapeGeometry frames, 0 hull shells, 0 outline sprites.

Refuted:
- **Coins do not get rings.** Every coin wears a SQUARE frame, visibly larger than the coin's disc,
  with a doubled edge at oblique view (the two per-face frames of a ~2 mm-thick piece both visible),
  and the coin frames overlap the neighbouring $20's face; one note's frame stands orphaned on bare
  desk (its note hidden under the pile). Close-up: `k3-coins-card/coin-hovered.png`; wider:
  `k3-coins-card/cash-hovered.png`. Mechanism: the ellipse branch keys on
  `round = /Cylinder/i.test(mesh.geometry.type)` (`simplifiedRegisterMode.js:1613`) — kit coins are
  GLTF `BufferGeometry`, so the authored "elliptical for coin-like rounds" path (:1578) is dead for
  every piece of kit money (K4 confirms all tender pieces are kit geometry).
- **The presented card is not outline-only.** Hover adds the outer frame plus a SOLID beige patch
  over the top-left of the card face — the chip mesh's own frame band, drawn by the per-mesh
  traversal (`applyGrabHighlight` outlines every child mesh, :1598) — obscuring the start of the
  wordmark. A-vs-C proof: `k3-coins-card/card-diff.png` (solid red block inside the card face);
  visual: `k3-coins-card/card-hovered.png` vs `card-unhovered-a.png`. The calibrated blob metric
  nearly missed it (46 px at kernel 41 — the patch is just under 2 kernel widths), so the metric
  under-reads this class of defect; the photograph is the finding.

Repro (coins): stage cash, set the three prices, `tx.rng = () => 0.2` before ringing, ring, hover the
pile at cash-tender. Repro (card): any card customer, hover the offered card at card-ready.
Discovery for future probes: the presented card parents under `ClubhouseCustomers` (the customer's
hand), NOT `clubhouse.interior` — interior-only traversals cannot see it.

## K4 — desk pieces always equal the tendered plan

**Verdict: CONFIRMED.**

What ran: `verify2-k4-totals.js` (three legs) + `verify2-k4-exact.js`. Per leg: negative control
(zero `from:'tender'` money in the scene before the stage), then mesh-root census vs `tx.tendered`
via the sim's own `stackTotal/cashTotalOf/changeDue`.

| leg | due | plan | meshes | sum | change |
|---|---|---|---|---|---|
| over-100 | $153.28 | {50:4} | {50:4} | $200.00 | $46.72 |
| exact-40 | $40.00 | {20:2} | {20:2} | $40.00 | $0.00 (exact-change customer) |
| odd-coins (rng 0.2) | $38.22 | {20:2, 0.1:2, 0.01:2} | same | $40.22 | $2.00 |
| pathological (mis-staged, kept) | $2349.72 | {50:47} | {50:47} | $2350.00 | $0.28 |

All four shapes: meshes == plan, sums tie to the cent, accounting ties (received − due = change), all
pieces kit geometry, negative controls quiet. POS cross-check in `k4-totals/over-100-player-frame.png`
(RECEIVED $200.00 / TOTAL $153.28 / CHANGE $46.72). Evidence: `k4-totals/verify2-k4.json`,
`verify2-k4-exact.json`, `*-closeup.png`, `exact-40-player-frame.png`.

Honest notes: (1) the 47x$50 leg was my instrument's bug — the pricing loop read `cashTotalOf` before
items were scanned (it counts scanned items only), inflating item 0 to $2,172 — kept because the
mesh/plan contract held even at a 47-piece tender; the true exact-change leg was restaged correctly in
`verify2-k4-exact.js` (7% tax, net 3738c → $40.00 exactly). (2) One of the four fifties in the
over-100 leg landed on-edge as a sliver (`k4-totals/over-100-closeup.png`, left) — a minor tender
presentation quirk, outside this claim's scope, counted correctly by both the census and the POS.

## K5 — reader: light glass, amount dominant (incl. DECLINED / PROCESSING / card-present / idle READY)

**Verdict: CONFIRMED**, with one reachability finding.

What ran: `verify2-k5-faces.js` + `verify2-k5-declined2.js`. Term-canvas dumps (512x468 ground truth)
plus in-scene probe close-ups for every face.

- Idle READY on the counter, pre-transaction: light glass (median luma 227), dark brand line, muted
  READY — `k5-faces/face-idle-ready.png`, `closeup-idle-ready.png`.
- Card-present/insert: `face-card-present.png` (green INSERT CARD, $35.31 dominant, red X legible).
- PROCESSING (card-busy, captured inside the 1.15 s window): `face-processing.png`,
  `closeup-processing.png` — amount dominant, no cancel X (correct: payment not pullable).
- Entry-error (production-reachable warn face — keyed $0.01, submitted): red accents
  "AMOUNT MUST MATCH TOTAL", warn-vs-glass contrast 4.27:1 — `face-entry-error.png`.
- DECLINED: red DECLINED + "TRY ANOTHER CARD OR CASH" on the light glass, $35.31 dominant, measured
  warn contrast 4.09:1 (antialiased-pixel average; pure #BC3F30 on #E9EEE9 computes ~4.9:1) — plainly
  legible: `face-declined2.png`, in-scene `closeup-declined2.png`. Amount-band contrast delta 231 vs
  bare-glass control 0 — the amount stays the headline on every face.

Reachability finding: **the prescribed attack `tx.rng = () => 0.01` cannot decline** —
`DECLINE_CHANCE = 0` (`src/sim/register.js:300`), proven live: rng-0.01 customer authorized
(`cardResult: 'approved'`). The declined face is only reachable via `runCard(tx, {force:'declined'})`
(or timeout). Forcing the stage externally also exposed that the glass repaints on events, not per
frame — the declined face required a leave/re-enter to paint (the natural in-mode path calls
`drawTerm()` itself, so this is a QA-shortcut artifact, not a game defect). Screenshot of the stale
glass case is deliberately not presented as a finding.

---

## Summary

| claim | verdict |
|---|---|
| K1 bag 1.35 / wrinkle / stamp never cut off | REFUTED (one-word name ≥ ~34 chars clips; scale + wrinkle confirmed) |
| K2 bag present from tx start | CONFIRMED |
| K3 hover outline-only | REFUTED on coins (square, oversized, doubled frames) and card (solid patch over face); notes clean |
| K4 desk pieces == tendered plan | CONFIRMED (4 tender shapes incl. >$100 fifties and exact change) |
| K5 reader light glass, amount dominant | CONFIRMED (all faces; decline unreachable in production — DECLINE_CHANCE 0) |
