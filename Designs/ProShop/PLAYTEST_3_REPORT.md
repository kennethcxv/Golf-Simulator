# PLAYTEST 3 — REPORT

Working `Designs/ProShop/Goal_26_Playtest_3.md` in the order written.

## 1. Probe-lie count this round: **6** (running total **28**)

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
| 5 — the mop | NOT STARTED |
| 6 — items must not touch the bag | NOT STARTED |
| 7 — Phase 3 verifier one | **SETTLED: it was my staging.** The clause itself is still unmeasured |
| 8 — Phase 10 verifier 3, the stranger | NOT STARTED |
| 9 — the exploded rake | NOT STARTED |
| 10 — Phase 7's merge | NOT STARTED |

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
