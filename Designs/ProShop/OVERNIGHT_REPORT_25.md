# Overnight Report 25

**PERCEPTION RATIO: 0 of 0 fixes so far.** Phase 0 is measurement; nothing has
been claimed fixed yet.

**PROBE-LIE COUNT: 1.** My own Phase 1 stranger driver reported
`wall: payment — "clicked forty times on the register and no ticket ever
banked"` after fourteen beats. Every screenshot was the same NEW GAME difficulty
dialog: the game had never started. `.difficulty-card` is a div, my
`clickByText` helper only queried `<button>`, so no card was ever picked. That
is *A PROBE THAT CANNOT SEE THE THING REPORTS THE SAME AS A THING THAT DID NOT
HAPPEN*, and it would have been written up as a payment bug. Caught by looking at
the pixels, which is the only thing that ever catches it. Two controls added: the
driver now fails closed if the dialog is still on screen after confirming, and
`out.wall` is pinned to the FIRST wall instead of being overwritten by the last.

**PHASE STATUS:** Phase 0 measured, gate not yet closed (golden gate outstanding).
Phase 1 in progress.

**PERFORMANCE HEADLINE:** not re-measured yet. Phase 6.

---

# PHASE 0 — WHAT WAS ACTUALLY INHERITED

## 0.1 The tree

| | |
|---|---|
| Branch at intake | `feature/pro-shop-vertical-slice` |
| HEAD at intake | `5883666` "Checkpoint checkout recovery (runtime GLB binding test red)" |
| State | **dirty** — 64 paths |
| Action taken | committed **whole** to `goal25/phase0-inherited-tree` as `4b4f361` and pushed; working tree now clean |

The preservation commit is a preservation commit, not an endorsement. Its message
names every hunk by author: my G1/G2 ledger WIP (`keyBindings.js` binds `K`,
`main.js` opens/closes, `clubhouse.js` adds `ledgerHasThePlayer()`,
`courseScene.js` consumes it, plus the G12 driver), my mop-sweep WIP
(`toolViewmodel.js` + the sweep driver + contact sheet), and Codex's leavings
(`firstDoorVisibilityReady.js`, `fixtures.js`, `campaign.js`, `layout.js`,
`registerFlow.js`, two tests, a lint-baseline move).

Codex had already checkpointed the settlement work itself at `5883666` with its
red named, so the 15,600 uncommitted lines from the audit are no longer at risk.

### CAN THIS REPOSITORY PASS ITS OWN SUITE FROM A CLEAN CLONE? NO.

Measured three ways at the same commit, same machine, same `node_modules`:

| Tree | Result |
|---|---|
| Shared working tree | **3606 / 3606** — zero red |
| Fresh detached worktree | **3555 / 3603** — **45 red**, 3 skipped |
| Same worktree after `node tools/build-vendor-models.mjs` | **3592 / 3603** — **8 red**, 3 skipped |

So Codex's claim is confirmed in substance and sharpened. `vendor/models/checkout`
is 49 generated GLBs, ignored file-by-file through a **generated nested
`.gitignore`** (`vendor/models/.gitignore`, itself a machine-written path list),
rebuilt from `Assets/` by `tools/build-vendor-models.mjs`. A clean checkout does
not have them, and that accounts for **37 of the 45** reds.

**Eight reds survive the documented rebuild**, and these are genuine clean-clone
failures that no untracked mirror explains:

1. `Sheets 6-10 and first-person references resolve to the supplied files`
2. `assets that declare no collision ship no player blocker`
3. `Sheet-6 clean-Blender reimport evidence is complete and production-green`
4. `ceiling-light progression has six purchasable variants, five primary tiers, and all runtime files`
5. `tests\chairs.test.js`
6. `modern clubhouse source and exports retain production dimensions and provenance`
7. `resort source/export/manifest remain reproducible and dimensionally correct`
8. `the tuning overlay takes pointer events, or no slider can be dragged`

**Stated plainly, as asked:** every "suite green" claim in every report in this
project — mine included — is conditional on one machine's untracked state. The
honest statement of the gate is *"3606/3606 on a tree that has had
`build-vendor-models` run and carries LFS-materialised asset sources"*. From
`git clone && npm ci && npm test` it is 3555/3603; from
`git clone && npm ci && node tools/build-vendor-models.mjs && npm test` it is
3592/3603. `npm test` does not perform or enforce the rebuild, and nothing warns.

### Lint ratchet: RED, and it was red before I touched it

`node tools/lint-ratchet.mjs` → **325 findings vs baseline 324**. I proved this is
not mine two ways: the three ledger-touched files (`main.js` 43,
`clubhouse.js` 44, `courseScene.js` 35) lint **identically** in my tree and in a
clean worktree at HEAD, and the ratchet **fails at HEAD in the clean worktree
too**. Codex lowered the baseline from 331 to 324 in its final commit while the
tree measured 325. Recorded, not weakened, not fixed — it is inherited debt and
not a Phase 1 item.

### Golden gate

Not yet run. Codex reverted its own mid-flight `golden-capture.js` rewrite back
to HEAD and stated plainly that it did not re-run the gate, so the gate is the
previously committed implementation with no fresh evidence either way. This is
the one Phase 0 item still open.

## 0.2 The quarantine breach

Skipped per instruction and read from `OVERNIGHT_REPORT_24.md`. Mixed-author
files are `src/core/i18n.js` (checkout owns the three `*.integrityUnavailable`
keys and `till.saleCompletedPresentationSkipped`; G1 owns `controls.ledgerBook`),
`src/render3d/clubhouse.js`, and `src/render3d/courseScene.js`. Pure ledger files
are `src/core/keyBindings.js`, `src/main.js`, and the G12 driver.
`tools/lint-baseline.json` is quarantined because its aggregate spans authors.

## 0.3 The six claims

| Claim | Verdict |
|---|---|
| **B4b — a refused ticket banks goods only** | **TRUE NOW.** Goal 24 left this measured-failing. The refused row banks **36.38 with `serviceTotal: 0`** and two goods lines. This was the standing NOT DONE and it is closed. |
| **Return to card after the desk action** | **Wired, and not a zero-call-site shape.** `returnFromDeskAnswerToCheckout()` has two real call sites — `beginReservationPayment` when a ticket is open, and `reject-walkin`. `everyAnswerReturnedToVisibleCheckoutAndTender` passes. Still to be confirmed by the stranger, because the driver that proves it uses QA shortcuts. |
| **The bag is faked** | Not yet re-photographed this session. |
| **Recast in production** | Not yet answered. |
| **The crosshair rule** | Not yet answered. |
| **C3's corridor gate** | Not yet answered. |
| **The door stall** | Not yet re-run. |

`electron-b-checkout-unsticks.js` — which Codex extended substantially — reports
**29 / 29 green** on this build, including `askNamesATime`,
`statusNamesTheTeeTime`, `bookedTicketCarriesExactlyOneGreenFee`,
`refusedTicketIsGoodsOnly`, and `b5ClearTheCounterWorks`. That covers Phase 1.2,
1.3, 1.5 and B4b **on an instrumented path**. It stages customers with
`ch.sendToCounter()`, writes `state.shop.open`, teleports the player to
`REGISTER.stand`, and clicks products by projecting world positions — so it is
not the owner's experience and it is not the Phase 1 gate.

## 0.4 The settlement WAL

Read only. `src/sim/checkoutSettlement.js` is 3,041 lines exporting 20 entry
points; `reconcilePendingCheckout` is called from five sites in `register.js`,
inside `completeSale` and the service-payment path. Not extended, not built on,
not reverted. No Phase 1 item so far has tempted me into it.

---
