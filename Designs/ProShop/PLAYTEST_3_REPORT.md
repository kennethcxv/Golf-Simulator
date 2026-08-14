# PLAYTEST 3 — REPORT

Working `Designs/ProShop/Goal_26_Playtest_3.md` in the order written.

## 1. Probe-lie count this round: **9** (running total **31**)

Checks I wrote that measured the wrong thing. Every one was caught by a number
disagreeing with something I already knew, never by re-reading the code.

| # | The probe | What it reported | What was actually wrong |
|---|---|---|---|
| 23 | `qaNavOpenPoint` | every open point in the shop unreachable; 72 candidates became 0 and the run aborted | it compared `nearestOpenWorld`'s output to the point against a 0.05 yd threshold. That call returns a CELL CENTRE, so a perfectly walkable point comes back displaced by half a cell diagonal (0.0707). `isOpenWorld` is the actual answer |
| 24 | the errand verdict | `arrived: true` printed next to `goalSent: false` | `out.watch.arrivedSeconds !== null` is `undefined !== null`, i.e. true, on the aborted run |
| 25 | the blocked-shopper errand | "sent past the blockade, never got within 4.3 yd" | `rows[0]` handed the errand to whoever was first in the array: a customer 17.4 yd away and still out in the car park |
| 26 | `electron-ledger-real-keys` run 1 | a clean run, no freeze, 97 key presses | the book was opened with `setOpen()`, so `app.ledgerOpen` stayed false and the key handler is INSTALLED BY `enterLedger()` and gated on that flag. Every press went nowhere; `spread` never left 0 |
| 27 | `electron-ledger-reopens-at-page-one` | `no page canvas handle` | called `debugPageCanvas`; the accessor is `pageCanvas`. The pixel half of the check silently did not run |
| 28 | the checkout routing gate, against my own edit | "missing normal-play routes: coinHandle" | I had written `sfx(handleCue)` with the cue in a variable. The gate greps the source for a literal inside an `sfx()` call and cannot see through an indirection — the cue WAS routed. Defeating the instrument is not satisfying it |
| 29 | the bag-clearance test | "no footprints to measure" | it drew items from `SHOP_CATALOG.slice(0, 3)`, which is all `separateHandoff` goods. Those take the OVERSIZE branch, which poses by hand and reports no footprint — so it graded the wrong path entirely. Same shape as probe lie 8 |
| 30 | the same test, next version | the fix "pushed goods TOWARD the bag" | `frontDeskPose` is MIRRORED with respect to the local x the packer works in (measured: local −0.9 → world +0.10, local −0.5 → world −0.30). Reading `pose.x - w/2` as the bag-side edge reads the FAR edge, so a correct fix reported as a regression |
| 31 | `electron-rake-explode-id` (last session's, re-run) | 74 meshes near the camera, all hands and distant terrain, no rake | its staging left the camera at world Y **−1.181**, under the ground. "Nothing near the camera" was a fact about where it put the player |

Two of these (23, 28) are worth their own line because they are the same shape
from opposite directions: an instrument that cannot perceive the thing it is
asked about will report its own blindness as a fact about the world.

## 2. Status

| Item | Status |
|---|---|
| **P0 — the click hurts** | **FIXED BY REPLACEMENT.** The Kenney interface pack is deleted, recipe entries and files both |
| **P0 — the ledger froze at page 6** | **NOT REPRODUCED.** Four attempts, three of them my own staging faults. Detail below |
| **1 — SFX audition switcher** | **DONE.** 7 families, 30 options, proved on the live audio graph |
| **2 — the cash register** | **DONE.** Sequenced, quieter, and picking cash up has its own voice |
| **3 — the ledger** | **DONE.** Reopens at page one; the SFX are in the switcher for you to pick |
| **4 — background music** | **DONE.** 4 tracks plus an off switch, in PLAYER settings |
| **5 — the mop** | **DONE** except the density ruling, which is yours |
| **6 — items must not touch the bag** | **DONE.** 0.127 yd of overlap measured and removed |
| 7 — Phase 3 verifier one | **SETTLED: it was my staging.** The clause itself is still unmeasured |
| 8 — Phase 10 verifier 3, the stranger | **HALF ANSWERED.** No stalls, detector proved. The three-customer half did NOT run: the stranger never got inside |
| 9 — the exploded rake | **IDENTIFIED, NOT FIXED.** It is a HAND, and last session ruled that out wrongly |
| 10 — Phase 7's merge | **MEASURED, NOT STARTED.** Dedup is NOT required: 47.6% without it |

## 3. P0 — THE CLICK

You were right about the cause. `Assets/audio/CREDITS.md` recorded the UI set as
Kenney's Interface Sounds, which are sci-fi by design, and that is where the
"space menu" came from.

Not tuned. **Replaced.** Twelve recipe variants deleted and twelve orphaned files
removed from `Assets/audio/`, so the piercing click cannot come back by someone
re-vendoring that tree.

That left `uiOpen`, `uiClose`, `uiError` and `checkoutComplete` with no recording
at all, falling back to the oscillators the samples exist to replace. Those four
now play a small wooden drawer, a low click, a latch refusing to seat, and the
antique till bell.

The menu click itself is the `menuButton` family below, defaulting to "Wooden
button" and measuring **-23.6 to -22.5 dBFS** — quiet, as asked.

## 4. ITEM 1 — THE AUDITION SWITCHER

**Developer tab → Sound auditions.** Changing a family plays it immediately. The
music picker is on the **player** Audio tab per item 4, with an off switch.

| family | options | labels |
|---|---|---|
| Menu buttons | 6 | Wooden button, Felt tap, Low muted click, Soft wooden click, Typewriter key, Wooden latch |
| Cash drawer | 5 | Wooden drawer light / deep / small / old, Wooden slide long |
| Cash landing | 4 | Coins bright, Paper money, Banknotes, Coins into a bowl |
| Ledger page turn | 4 | Single page crisp / soft, Book page close / airy |
| Ledger pickup | 3 | Book grab, Book handling, Book open soft |
| Ledger close | 4 | Book close, Close soft, Board heavy, Set down on the desk |
| Background music | 4 | Calm lo-fi, Piano sparse, Piano warm, Electric piano |

Every file CC0, every one in `THIRD_PARTY_ASSETS.md` and `Assets/audio/CREDITS.md`.

**Proved on the live audio graph**, not in the UI
(`tools/qa/electron-sfx-audition-gate.js`, `qa/electron/sfx-audition/`). Each of
26 options was pinned, its cue fired, the peak read off the master bus and the
FILE read from `__fwSample` on the buffer that actually started:

| family | options | distinct files heard | peak dBFS |
|---|---|---|---|
| cashLand | 4 | 4 | -20.0 .. -16.8 |
| drawerOpen | 5 | 5 | -18.3 .. -15.1 |
| ledgerClose | 4 | 4 | -20.0 .. -16.2 |
| ledgerPickup | 3 | 3 | -20.6 .. -17.2 |
| ledgerTurn | 4 | 4 | -18.4 .. -13.8 |
| menuButton | 6 | 6 | -23.6 .. -22.5 |

Distinct-files-equals-option-count is the line a UI-only picker fails: it would
show 26 labels and play one file.

**Defaults are pinned and provisional.** Without a pin the bank draws at random
across a family, and these are competing recordings rather than variants of one
sound — an unpinned menu would click like a typewriter, then a felt pad, then a
latch. Each default is the most literal reading of "a real button, a felt key, a
wooden switch", and is expected to be overruled by ear.

**Watched fail before it passed.** `tests/sample-bank-audition.test.js` with the
selection path reverted by file copy to draw from every buffer, the way a
UI-only picker does: tests 2 and 3 failed, 1/4/5/6 passed. Restored: 6/6. The
revert was asserted by diff in both directions.

## 5. ITEM 2 — THE CASH REGISTER

The overlap had a single cause, three consecutive lines:

```js
sfx('drawerUnlock');
sfx('drawerOpen');
sfx('billHandle');
```

Three impacts inside one millisecond, and the cash motions queued at `delay:
0.18` on top. Four sounds fighting over half a second.

`drawerOpenSequence()` now plays the latch, waits for it to die, plays the slide,
and **returns how long the pair takes**. The register calls it before queuing
anything and uses that number for the cash delay. The length is read from the
buffer the bank would actually pick, so auditioning a longer drawer re-times the
cash rather than desynchronising it.

Measured (`tools/qa/electron-drawer-sequence.js`), stamped with `ctx.currentTime`
because it is the only clock sharing a timebase with the scheduled sources:

```
drawerUnlock  at 2.5013   0.4107 s long   drawer-unlock-2.ogg
drawerOpen    at 2.9520   1.3076 s long   opt-drawer-wood-deep.ogg
gap 0.4507 s          simultaneousAttacks: false
total 1.7625 s        <- what the cash now waits for
```

- **Warm wood, not the metal till** — via the audition default.
- **Levels down**: drawerOpen 0.9→0.55, drawerUnlock 0.85→0.5, drawerClose
  0.9→0.55, cash-run peak 0.78→0.46. Run stop fade 0.13→0.06 s, because "it runs
  past" was a tail still sounding after the last piece had landed.
- **Picking cash back up** now has its own recording (`cashPickup`, 3 CC0
  variants). You said there was nothing there; there was a cue, but it was
  `billHandle`/`coinHandle` — **the same one that plays when cash goes down**, so
  one gesture in two directions had one sound and neither read as itself.
- A handful of coins no longer rustles like paper: the accept path fired
  `billHandle` unconditionally and now picks by what was actually tendered.

Two ReferenceErrors caught by the lint ratchet before they shipped: `cashPickup`
called `coinHandle()` and `drawerOpenSequence` called `drawerOpen()` — those are
the EXPORTED keys; the local functions are `coin` and `drawer`. And an ordering
bug of my own: the motions read `drawerVoiceSeconds` in a `forEach` that ran
BEFORE the assignment, so the first sale of every session would have used zero —
exactly the overlap being removed.

## 6. ITEM 3 — THE LEDGER

**It reopens at page one.** This deliberately reverses Phase 6's "state
persistence across close and reopen", which was implemented and verified last
session. **You have overruled it and I have recorded the overrule in the code, in
the driver header and here, so nobody restores it.** No test pinned the
persistence — the Phase 6 change was a deletion, not an assertion — so nothing
had to be removed.

Red then green on the real build
(`tools/qa/electron-ledger-reopens-at-page-one.js`):

```
unfixed (HEAD restored by file copy, revert asserted by diff both ways):
    turned to spread 3 -> closed fully -> reopened at spread 3   FALSE
fixed:
    turned to spread 3 -> closed fully -> reopened at spread 0   TRUE
    and the page really repainted (ink 55 px)
```

The check is the DIFFERENCE between two opens: "spread is 0 after opening" passes
trivially on a book nobody turned, so the run is void unless the turn moved it.

**Frame viewed**: `qa/electron/ledger-reopen/c-reopened.png` shows CLUB REGISTER,
the contents list, footer "1 of 10", after a close from spread 3.

One bug found writing it: `if (!prewarm()) paintSpread()` skips the repaint when
the prewarm already ran during the walk-up, so resetting the index without
repainting would leave the canvas showing the old page while the book believed it
was on the first. The repaint is now forced whenever the spread moved.

The SFX half is the switcher: ledgerTurn (4), ledgerPickup (3), ledgerClose (4),
all real paper and board. Name the winners.

## 7. P0 — THE LEDGER FREEZE: NOT REPRODUCED

Four attempts. **I could not make it happen, and three of the four runs were
void for reasons that were mine.**

| attempt | how | result |
|---|---|---|
| 1 | `turnPage()` API, clean profile | 5 spreads walked, rAF alive throughout, paint never above 4.8 ms |
| 2 | same, **your save** (Continue) | identical: 9 pages, 5 spreads, same page map, no freeze |
| 3 | real ArrowRight/ArrowLeft key presses | **VOID** — opened with `setOpen()`, so `app.ledgerOpen` stayed false and the key handler was never installed. 97 presses, `spread` never left 0 |
| 4 | real keys through `walk.hooks.openLedger` | all 5 spreads, reading speed AND mashed at 25 ms, rAF alive, no page errors |

What I can tell you positively:

- **Page 6 on a starter book is `Firsts`**, not the takings — the page list is
  BUILT, and the guest register and notes both paginate. Page kinds are now
  exposed in the book's diagnostics so any future report can name the painter.
- The freeze leaves **no trace in `crash.log`** — consistent with a hang rather
  than a throw. Your crash log is full of something else entirely: a
  `checkout.refused.sale-refused` error firing **every frame** from inside the
  render loop, 03:33–03:35 on 14 Aug. That is a separate defect and I have not
  touched it.
- `wrapLines`, `drawFitted`, `ruledRows` and the deferred-paint drain all have
  bounded loops; I read them looking for the hang and did not find it.

**What I would try next**, so the trail is not lost: drive it at your window
size and DPI rather than the harness default, and with the book CARRIED before
opening. Both change which code paths run and neither was covered above.

I have kept your saves: a copy of `%APPDATA%\GOLF EMPIRE\saves` was taken before
attempt 2 and nothing was written back.

## 8. ITEM 7 — PHASE 3 VERIFIER ONE: SETTLED, AND IT WAS MY STAGING

You asked the right question. `sent: true` only means the splice landed.

**It adopted the goal and never let go.** One distinct stop coordinate across the
whole 60 s window, kind `browse` throughout, ladder rung 0 throughout, closing
monotonically 17.42 → 10.53 yd. It did not arrive because the errand went to a
customer 17.4 yd away and still outside, walking at 0.116 yd/s. The window
expired mid-walk. The earlier 4.313-with-blockade / 4.303-without pair was two
measurements of the same interrupted walk.

Two QA surfaces were needed to ask the question at all, because **a stop is not a
constant**: the stuck ladder's rung 4 rewrites `stop.x/stop.z` to the nearest
deliverable cell, and rung 5 abandons the stop outright. A driver holding the
coordinates it handed over is measuring a goal the customer may no longer own.
`qaCustomerTrack` now reports `stopX/stopZ/stopCount/stuckEscalation`, and
`qaNavOpenPoint` answers "can a walker be delivered here at all".

With the staging fixed — runner inside the building, on the near side of the
pinned line, closest to the goal — the result is different and reproducible
across two runs: from 2.03 yd out it closed to **1.897**, pressed to **0.696 yd**
from a pinned body, ran the ladder to **rung 4**, and abandoned the stop.

**That is not yet a finding.** Its control has not run: the same customer sent to
the same point with the blockade removed. The first attempt at that control
failed because the 120 s watch gave the runner time to finish its route and leave
the shop; the watch now stops the moment the outcome is decided. The gate's clips
are still outstanding.


## 9. ITEM 5 — THE MOP

Both halves of "they form a RING floating around AND BELOW it" were real, and
both are measurements rather than impressions:

- **RADIAL.** The hub is a cone of bottom radius `HEAD_R * 0.52` = 0.0874. The
  bunch centres sat at `radius * (0.52 + 0.48 * 0.78)` = **0.150**, spreading
  inward only to 0.129. The nearest yarn began **42 mm outside** the widest part
  of the clamp that is supposed to grip it, and everything inside 0.129 was
  empty.
- **VERTICAL.** The hub spans y 0.007–0.045; the yarn hung from y = 0, so the
  strand tops began **7 mm under** the underside of the clamp.

`collarRadiusFrac` (0.50) puts the bunches inside the hub's grip and the rig now
sits at y 0.022, in the middle of the hub's body.

**And the head did not shrink, which I got wrong first.** Moving the anchors in
takes 0.39 of a radius off where the strands start; at the old splay the tips
reached only 0.1259 against a 0.168 head. I had fixed the gap by narrowing the
whole head, and the suite caught it. Swept rather than guessed, because tip
radius after settling is not linear in splay:

```
0.52 -> 0.1259    0.70 -> 0.1364    0.90 -> 0.1476
1.10 -> 0.1583    1.30 -> 0.1684    1.50 -> 0.1779
```

**splay 1.30** puts the hem at 0.1684 against a head radius of 0.168 — the rim
exactly. Anchored at the middle, open at the hem: a cone that FILLS the head
rather than a ring that outlines it, which is item 5's fourth bullet too.

**Thicker**: 7.6 → 10.2 mm across. **This raises a test bar from 8 mm to 11 mm**
and the reason is written into the test rather than widened quietly. The 8 mm bar
was set against 380 strands on a 0.256-wide ball, where a thick strand was a
large share of the silhouette; at 972 strands on a 0.336-wide disc it is a much
smaller one. If you look at 10.2 mm and call it pipe, the test names the two
places to put back. 13 mm is still refused.

**The hollow tubes were already fixed** — the cylinders have been capped
(`openEnded` false) since Goal 26 round 2, so that fault is not in the build you
photographed unless you are on an older one.

**Not touched, because it is your ruling**: the number of bunches and the
daylight between them. Everything above changes WHERE bunches hang and how thick
a strand is, so 5.1 composes with it either way.

Photograph: `qa/electron/mop-portrait/mop-head-crop.png`. The daylight ring is
gone and the strands emerge from under the clamp. In that light the red hub reads
large against the yarn — a judgement I cannot make for you, and it sits right
next to the density ruling.

## 10. ITEM 6 — THE GOODS CLEAR THE BAG

**The gap was already designed in and the overhang ate it.** The staging strip
starts at register x −0.74 and the bagging footprint's right edge is −0.82: 0.08
of clear counter, with a note in `shopLayout.js` saying "clearly right of the bag
has to be a gap, not a shared edge". What reached the bag was 2.2's own ruling —
item CENTRES distributed across the full span, outer items allowed to OVERHANG,
because the staging contract constrains centres rather than extents.

Measured on the unfixed build: **an item's bag-side edge at −0.9472 against a bag
ending at −0.8200. 0.127 yd driven into the bag.**

The keep-out now applies to the EDGE rather than the centre, per row, and both
call sites pass it — including the customer's set-down path in `clubhouse.js`,
which is the one your sentence names. `rowFits` was narrowed with it, or 2.2's
non-overlap guarantee would have turned back into an overlap in the squeeze;
there is a test for that case.

Red then green, revert asserted both ways. The bar is a gap **greater than
zero**, not an overlap of zero: a flush rest passes an overlap test and is
exactly the state you are complaining about.

Suite 3659 pass / 0 fail. Lint ratchet 323.


## 11. ITEM 9 — THE EXPLODED RAKE IS A HAND, AND THAT WAS RULED OUT IN ERROR

**I am overturning last session's own conclusion, and the photograph is why.**

`Designs/ProShop/Images/Goal_26/findings/rake-exploded-viewmodel.png`, viewed at
full size rather than described: the cluster floating in the sky is
**unmistakably a first-person hand**. Four finger capsules in a row, a palm mass
behind them, a thumb capsule off to the right, two flat plates driven through it
at an angle, and a curved ribbon trailing below. That is the exact part list in
`fpHands.js` — fingers, `Palm`, `ThumbProx`/`ThumbDist`, `HandCuffBody` (the
plates) and `HandCuffRoll` (the ribbon).

And the bottom-right of the same frame shows a hand gripping the shaft
**correctly**. So it is not "the hands"; it is **one of the two hands**.

Last session wrote: *"The hands are ruled out by measurement... with the rake
equipped the hands measure at world y 1.48 and 1.59 against a camera at 1.52.
They are where hands belong."* Two plausible numbers for two hands is exactly
what you get if the probe read the hand ROOTS, or the good hand twice, while the
displaced thing is a hand's MESHES under a mis-transformed node. The picture and
the numbers disagree, and the picture wins.

**Why today's re-run found nothing.** `walk.setTool('rake')` returns `'rake'`
happily, but there is **no `Tool_rake` in the scene at all** — the tool roots
present are vacuum, mop, broom, dustpan, spray, cloth, sponge, trashbag. The rake
is on the outdoor belt and the run stood indoors. Worth a line of its own: the
tool API accepts an id it has no viewmodel for and reports success.

**NOT FIXED.** The next attempt needs the player outdoors and ON GROUND — the old
driver's teleport put the camera at world Y −1.181, under the terrain — and then
`electron-rake-parts.js` names the parts against the tool's own origin rather
than against the camera. My expectation from the picture is that it will name one
hand's meshes, and that the fault is a socket or parent transform on the hand the
rake's grip resolves to, not the rake.

## 12. ITEM 10 — THE MERGE: DEDUP IS NOT REQUIRED, AND I HAVE NOT STARTED

Measured in Electron at a standing indoor frame
(`tools/qa/electron-merge-headroom.js`, `qa/electron/merge-headroom/`):

| | |
|---|---|
| standing draw calls | **1446** |
| mergeable meshes | 1037 |
| distinct materials among them | 349 |
| meshes per material | **2.97** — your three-per-material figure, confirmed |
| best case after merge | **758 calls, −47.6%** |
| materials dedup would remove | 100 (349 → 249) |
| best case after dedup THEN merge | 658 calls, −54.5% |

**So: dedup does NOT have to come first.** The 30% target is reachable on the
merge alone with 17 points of headroom to spare. Dedup would add roughly a
further 7 points and is worth doing, but it is not a blocker and I would not
sequence it first.

Two honest caveats, because "best case" is doing real work in that sentence:

- It assumes a PERFECT merge — every mergeable mesh of one material becomes one
  draw. A real merge gives some of that back to frustum culling, because a merged
  buffer cannot be culled per-part. Indoors, where most of these meshes share a
  room, that loss should be small; on the course it would not be.
- My counts differ from the 817/2482 in your brief because I counted only what
  actually DRAWS at a standing frame: single-material, non-instanced,
  non-skinned, and not already batched away behind `layers.mask = 0`. 1265
  meshes were excluded on that last ground alone, and a target derived from
  scene-graph mesh counts would be promising to remove draw calls that nobody is
  making.

**I have not started the merge**, per your instruction to measure first.


## 13. ITEM 8 — THE STRANGER: ONE HALF ANSWERED, ONE HALF NOT RUN

Written with no developer shortcuts, as asked: no `debugSpawn`, no
`qaSendCustomerTo`, nothing writing sim state. Real keys, real mouse, the game's
own controls. State is READ freely — that is observation — and never written.

**ANSWERED: there are no stalls.** 23,967 frames drawn, **longest frame gap
54 ms**. And the number can be believed, because the detector was proved on the
spot: a deliberate 500 ms block of the main thread took the recorded maximum from
54 ms to **517 ms**. A stall detector that cannot see a half-second hitch would
report a smooth session on a stuttering build, and this repo has shipped that
shape of lie before.

No page errors. No F8 invariant violations. Seven cue starts, all synth voices.

**NOT RUN: the three customers.** `reachedInside: false`. The stranger walked
forward in six bursts with look-steps between them and never got into the
building, so the shop sign never opened (`signOpen: false` throughout), no
customer ever arrived (`customersSeen: 0`) and the register was never active. The
question you actually asked — one full customer, then a second and a third — was
therefore never put to the game.

That is partly my driver: "hold W six times" is a crude stand-in for a person
following "look around, then walk toward the clubhouse". The next attempt should
follow the tutorial's own prompts rather than guessing a heading.

**TWO THINGS FELL OUT OF IT ANYWAY, and both are real:**

1. **`deskAction('exit')` returned `ok: true` twenty-five times in a row and
   nothing happened.** The desk screen offers `exit` as a live, hit-testable,
   non-disabled hotspot while the register is inactive; pressing it reports
   success and changes no state. An action that always succeeds and never does
   anything is worse than a disabled one, because a stranger presses it, sees the
   click register, and concludes the game is broken elsewhere.

2. **Twenty game-minutes from 6:01 AM with the shop shut.** Trading hours start
   at minute 360 and the clock ran 360 → 380 with `signOpen` false the whole
   time. Whether a stranger is *supposed* to have to open the shop by hand on Day
   1 is a design question I cannot answer for you — but if they are, nothing in
   twenty minutes told them so.
