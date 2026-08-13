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

# PHASE 1 — THE CORE LOOP

## The Phase 1 adversarial review, part A: a stranger from a fresh new game

**Driver:** `tools/qa/electron-p1-stranger-one-customer.js`. Real menu clicks,
real pointer lock, real WASD, real E, decisions taken only from on-screen text.
No `sendToCounter`, no teleport, no forced state.

**Verdict: the stranger cannot reach the checkout, and it is not a bug.**

| check | |
|---|---|
| got inside the clubhouse | PASS |
| opened the shop for business | **FAIL** |
| a customer came | FAIL |
| goods on the counter | FAIL |
| took the sale | FAIL |
| one ticket banked | FAIL |

First wall, step 8: *never found a prompt that opened the shop for business.*

The stranger did everything right. It read real prompts throughout — `Weeds - E
pull them`, `Shop doors - E open both · X open left leaf`, `Rangefinder display
- Laser rangefinder 3/6`, `Fairway Spring Water case · 28 inside - E tear the
tape` — pressed E on the shop doors, walked in, and swept five standing
positions × twelve looks each hunting the OPEN/CLOSED card.

The objectives card explains it in one line:

> **ARRIVING AT PINE HILLS 1/19 — Survey the neglected property.**

This is a **nineteen-task restoration campaign** and opening the shop is near the
end of it. `campaign.js` gates `objective('open', 'Open the clubhouse for
business')` behind installing the display shelves, repairing the structure,
opening three cartons, restocking six retail groups, and clearing every route.
`shopAcceptsWalkIns()` additionally requires trading hours **and** the player's
physical sign. A stranger three minutes into a new game is thirteen tasks away
from a customer, by design.

**The reading I took:** Verifier 3's "from a clean start" cannot mean "from a
fresh new game" without turning the core-loop gate into a test of the
restoration tutorial. So the review runs in two parts and neither is called the
other. Part A is above. Part B seeds **four facts** — `shop.open`,
`campaign.businessOpen`, `shop.signOpen`, stocked shelves and organic walk-ins —
and then uses **only real input** for everything about the customer and the
transaction. Nothing about the customer, the cart, the player's position or the
checkout phase is seeded.

**Two driver faults found on the way, both now controls:**

1. Probe lie #1 (recorded at the top of this report): `.difficulty-card` was
   never clicked because `clickByText` only queried `<button>`; the game never
   started and the driver blamed payment.
2. The sign search walked steadily **away** from the door while hunting for a
   card that hangs on that door's jamb — five searches, never facing the right
   wall. It now turns a full circle on the spot before taking a step, which is
   what a person entering a shop does.

## 1.1 "The customer never hands over the card" — chased to its root

The complaint has been read for two sessions as a bug in the card handoff. It is
not. Measured in Electron, step by step:

| measurement | result |
|---|---|
| shop open, stocked, trading hours, waited 3 min | **nobody came** |
| read the spawn gate's own inputs | every gate **open** — `shopAcceptsWalkIns` true, `campaignAllowsBusiness` true, capacity 5, footfall target 3 |
| measured the clock | **advancing** — 1.34 game-min per 10 wall seconds, `speedIdx 1`, not paused |
| watched the **floor** instead of the till | **3–4 customers present** |
| sampled what they do | cart up to 4, **queued at the counter**, `everAwaitingCheckout` **false**, `everBought` **false**, no `placing` phase ever |
| cross-tabbed type against the queue | `typesSeen: ["reservation", "walk-in-tee"]` and nothing else |

**Root cause:** customers arrive, shop, fill a basket and queue. The head of that
queue is tee-time or reservation business waiting for the **player** to serve it
at the desk. Nobody serves it, so the queue never advances, so the shoppers
behind never reach index 0, so placement never starts and nothing is ever
bought. The world is not broken — nobody was playing it.

That is why `electron-b-checkout-unsticks.js` can be 29/29 green and the owner
still sees no card: it uses `sendToCounter`, which drops a customer straight at
the head of the queue with a scripted cart and skips the entire arrival, browse
and queue chain that real customers must traverse.

### My C3 corridor gate is NOT the cause, and I checked because it is mine

Goal 25 warns that *"never places anything is not a pass"*, and my Goal 24 gate
was the obvious suspect. Disabled it by file copy, asserted the file changed,
re-ran: `everAwaitingCheckout` false and `everBought` false **exactly as
before**, same phases, same stops. Restored. An honest negative about my own
code, and it moved the search upstream where the cause actually was.

### Probe lies #2 and #3, both mine, both in the same probe

2. It imported `shopCustomerCapacity` from `src/sim/shop.js`, where it does not
   live — it is in `shopProgression.js`. The import returned `undefined`, so the
   probe would have reported `capacity: null`, which is **indistinguishable from
   the real zero it was built to detect**.
3. It asked "did anybody come" by waiting for `tx.items.length` — goods *on the
   counter*, the END of a twenty-game-minute visit — OR-ed with a
   `customerCount()` that does not exist on the API, so that arm was permanently
   0. Two separate ways to report an empty shop that had four people in it. It
   reads `footfallDiagnostics().onFloor` now, the number the arrival loop owns.

### A fourth correction: the seed opened the shop without restoring it

Customers walked into a shop with no installed fixtures and nothing to buy.
`disableCampaign()` restores fixtures in **state**; `refreshShopProgression()` is
the accessor that relays them, retargets the customer fixture stops and rebuilds
stock so the **scene** agrees. Only the pair is honest — state-restored and
scene-empty is the same class of fault as everything else in `FOUND_FALSE`.

## The Phase 1 review, part B: the checkout gate

Part A established that a fresh game gates customers behind nineteen restoration
tasks. Part B therefore seeds the **world** and tests the **checkout**. What is
seeded, in full, and nothing else:

- `shop.open`, `shop.signOpen`, `campaign.businessOpen`
- `disableCampaign()` **plus** `refreshShopProgression()` — state and scene
- three SKUs stocked to 8 on the shelf, organic walk-ins on, clock at 10:00
- the player placed inside the shop

**What is NOT seeded, and never is:** the customer, their cart, their arrival,
the queue, the checkout phase, or any part of the transaction. Walking to the
counter, taking the desk, ringing goods up, answering the tee time, paying and
watching them leave are all real mouse and keyboard.

Player entry was folded into the seed after two runs disagreed about it — one
threaded the porch doors, the next ended pressed against the jamb looking at
trees. Straight-line steering cannot reliably path through a doorway, and
getting through a door is not what Phase 1 gates. Part A reports on the entrance
honestly and it deserves its own item if it needs one.

**The stranger gained navigation and mouse calibration**, because it could shop,
queue and read prompts but could not cross a room. It looks at a waypoint and
walks to it with mouse and W. The pixels-per-radian factor is **calibrated
against the running build** — measured at −952 px/rad on this profile — because
mouse sensitivity is a saved player preference and a hard-coded constant would
mis-steer on every profile but this one.

### Part B's progression, run by run

The gate driver was wrong five times before it was right, and each wrong run
named an innocent part of the game. They are listed because the pattern is the
point: **a driver that cannot perform an action reports the same as a game that
refused it.**

| run | what it reported | what was actually true |
|---|---|---|
| 1 | "clicked forty times on the register and no ticket ever banked" | the game never started — `.difficulty-card` is a div and the helper queried `<button>` |
| 2 | "never found a prompt that opened the shop" | it walked *away* from the door while hunting a card hanging on that door's jamb |
| 3 | "ran out of legs", distance `null` | `DOOR_MAIN` is `{wall:'S', x:-0.8}` and **has no `z`** — the waypoint was NaN, so every distance comparison was false |
| 4 | "the player took the desk and no customer ever placed goods" | standing at the desk is not *serving* it; the queue head was waiting for a click |
| 5 | same | the desk picker preferred `tab-check-in`, which is always enabled, so it clicked one tab **six times** and never selected a row |

By run 5 the stranger reliably: boots through the real menu, picks a difficulty
card, calibrates its own mouse sensitivity (−952 px/rad on this profile),
navigates to the porch, **opens the doors with E**, walks inside, walks to the
counter, and takes the desk on a real prompt naming a real guest —
`Front desk - E check in Sonny Royce (10:00 AM tee)`. Four customers on the
floor, `tookTheSale` PASS.

What remains is completing that check-in through the monitor so the queue can
advance to the shoppers behind it.

### Run 6 — the stranger reproduced the owner's complaint

The gate driver now reliably: boots through the real menu, picks a difficulty
card, calibrates its own mouse sensitivity, navigates to the porch, **opens the
doors with E**, walks inside, walks to the counter (15 legs, arrives at 1.83 yd),
and takes the desk on a real prompt naming a real guest —
`Tee desk - E serve Ray Blackwood (4 players · 10:00 AM)`. It then clicks real
drawn hotspots: `tab-check-in`, `select-reservation:1`.

| check | |
|---|---|
| got inside | PASS |
| opened the shop | PASS |
| a customer came | PASS (5 on the floor) |
| goods on the counter | PASS |
| took the sale | PASS |
| **one ticket banked** | **FAIL** |
| **customer left** | **FAIL** |

**A transaction reached stage `done` and sat there, unbanked, for a full minute
across four beats.** That is the owner's sentence — *"I bag every item and the
sale will not complete"* — reproduced through real input, with no
`sendToCounter` anywhere near it.

This is the Phase 1.1 item, and it is now addressed rather than described: a
ticket at `done` banks only when `deliveryPhase === 'released'` **and** the
checkout flow is `CustomerLeaving`. The driver now records all three side by
side, because "the sale will not complete" is a symptom with no address until
those three are visible together.

---

## PHASE 0 GATE — the golden suite is RED, and it is diagnosed, not accepted

`npm run golden`: **12 of 12 captured poses FAIL.**

| pose | diff | budget |
|---|---|---|
| shop-floor | **23.45%** | 0.25 |
| stockroom-wall | 0.26% | 0.25 |
| every tool pose | **6.2 – 7.3%** | 0.75 |
| bag-packed | NOT CAPTURED — "only 1 goods packed" | — |

**It is not FOUND_FALSE shape 9 recurring.** That was my first suspicion, because
shape 9 is exactly this silhouette — many poses, one machine, nothing in the
repository. The capture manifest rules it out by recording the very things shape
9 taught us to record:

```
seed 1035912314   interiorY -0.45135   walkFov 66   dpr 1.5
```

Every one matches the pinned values, and the FOV is the shipped 66 rather than
the 60 that cost this project a week. **The world is pinned and the picture still
changed.**

**Looking at the pixels says what the numbers cannot.** Golden `shop-floor` is a
close-up of a pale panel and a green wall. Current `shop-floor` is a wide view
down the room — windows, daylight, a counter in the middle distance. Same pose
name, and something large that used to stand in front of the lens is no longer
there. Uniform ~7% on every tool pose fits the same cause: those are tool
close-ups, so a changed room moves a smaller fraction of their pixels.

The likely cause is the world's starting **content/restoration state** changing
under the Goal 24 door and campaign work — `campaign.js`, `propPlacement.js`,
`fixtures.js`, `shedInterior.js`, and the campaign snapshot handoff all moved in
that range. A bisect against `b914151` (the last commit before those fifteen) is
running to turn "something in this range" into "this range".

**Not rebaselined.** The brief forbids making a red row green without diagnosing
it, and a 23% whole-scene change is precisely what this gate exists to catch.

### BISECTED: the regression is in Codex's fifteen-commit range

Same machine, same `node_modules`, same pinned seed, same goldens, one commit
apart:

| tree | shop-floor | verdict |
|---|---|---|
| `b914151` — last commit before the continuation | **0.0000%** | **12 / 12 ok** |
| `5883666` — HEAD, after the fifteen | **23.4525%** | **12 / 12 FAIL** |

So this is not drift, not the profile, not the machine, and not shape 9. **The
range `9ea1596..5883666` introduced a whole-scene visual regression**, and it
shipped because the gate was never run — Codex's own report states plainly:
*"`npm run gate`, `npm run golden`, and `npm run golden:control` were not run."*

**Leading mechanism, not yet proven to the line:** `73db290` added a **global
placed-static batch** to `propPlacement.js` (+189 lines — `placedStaticBatch`,
`batchedDrawCalls`, "geometry already copied into the global static batch") and
its own message says it "removes five submissions". Props are exactly what stands
in front of the `shop-floor` lens, and this repository already carries a note
that batched props draw via `layers.mask = 0` rather than `visible = false`, so
any scene-graph probe measures geometry that never draws. A batch that drops or
relocates five submissions is a whole-scene change that no test in the suite
looks at — which is precisely why the pixel gate exists.

**Not rebaselined, and it must not be** until someone decides whether those five
submissions were meant to disappear.

## PHASE 0 GATE — CLOSED

| requirement | state |
|---|---|
| tree committed and pushed | ✅ `4b4f361` + six items on `goal25/phase0-inherited-tree` |
| suite state known and every red named | ✅ 3606 shared / 3555 clean / 3592 after rebuild, 8 reds named |
| golden gate green or redness diagnosed | ✅ **diagnosed and bisected to a commit range** |
| six claims have verdicts | ✅ below |

| claim | verdict |
|---|---|
| B4b — refused ticket banks goods only | **CLOSED.** 36.38 with `serviceTotal: 0` |
| the bag is faked | **VERIFIED BY PIXELS.** empty-vs-full **0.000%**, rebuilt-`bagFill` control seen at 4.07% |
| return to card | wired, two real call sites, not a zero-call-site shape |
| recast in production | **QA-ONLY — zero importers in `src/`.** FOUND_FALSE shape 2, as the brief predicted |
| C3 corridor gate | **not bypassed.** One call site; both early returns deny rather than permit. Also proven *not* to be the cause of the empty till |
| the door stall | not re-run — superseded by the golden regression in the same commit range, which is the more urgent fact about that work |

### NARROWED TO ONE COMMIT — and it is in the HARNESS, not the game

| commit | shop-floor | verdict |
|---|---|---|
| `dc8663b` "Goal 24: phase-align perceptive control" | **0.0000%** | 12 / 12 ok |
| `458de6b` **"qa: scope deterministic seed pin to world creation"** | **15.33%** | 12 / 12 FAIL |

`458de6b` changes `tools/qa/lib/qa-boot.mjs`. **No game code is involved.** So the
first reading — "Codex shipped a visual regression" — is wrong, and I am
correcting it here rather than leaving it in the earlier section.

What actually happened, and it is subtler than a regression:

- The **goldens** were captured with the OLD stub, which held `Math.random`
  pinned to one constant through the whole of asynchronous scene construction.
  Codex's own report records what that did: duplicate three.js UUIDs, and
  GLTFLoader reusing one collision-authoring material for visible meshes. The
  reference images are a picture of a **corrupted world** — deterministic, and
  wrong.
- `458de6b` correctly narrowed the stub to the exact `onNewGame` seed draw and
  restored native RNG before any scene object is built. The world is now built
  properly, so it no longer matches its own reference.

### AND THE GATE IS NOW NON-DETERMINISTIC, WHICH IS THE REAL DAMAGE

Two captures at the **same commit**, same machine, minutes apart:

```
shop-floor   23.4525%      shop-floor   23.7509%
```

**A 0.30-point swing at a pose whose entire budget is 0.25%.** The pin that made
this gate meaningful is gone; native RNG now runs during world construction, so
two captures of the same build disagree by more than the budget they are judged
against.

**This means the golden gate is currently unusable, not merely red**, and
`npm run golden:accept` would produce a baseline that fails its own next run.
That is why it has not been rebaselined and must not be.

**The fix is small and is the next item:** the world-creation stub should return
a **seeded pseudo-random sequence** rather than a constant. That restores
byte-reproducibility without reintroducing the constant-RNG corruption —
different values each call, identical values each run. One function in
`qa-boot.mjs`, and then a fresh baseline is legitimate.

