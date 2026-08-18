# Block 2a — stop geometry, and why the ladder is still there in the morning

> "A stop no body may legally stand on must never be issued. Validate stops
> against the collider set and the player clearance at assignment time, not at
> arrival time."

That half is done. The measurement that was supposed to follow it — delete the
ladder, watch five minutes, see whether stalls stay near zero — **is parked, and
not because it was hard to write.**

## What landed

**`tools/qa/stop-geometry-audit.mjs`** — pure arithmetic on the shipped layout,
no renderer, no Electron. It applies the same rules
`tests/pine-hills-v2-layout.test.js` applies to stand points, plus the two the
browse points were never checked against: the front desk slab, which is not in
the fixture table, and a **formed queue**, which is not furniture but holds
floor for minutes.

On `pine-hills-v2` — 15 fixtures, 13 stop points:

    !! shelf_balls  browse[0]  (-1.25, -0.75)   backcounter 0.107 yd   (needs 0.30)
    !! tour_vault   browse[0]  ( 4.13, -1.65)   queueSlot5  0.677 yd   (needs 0.92)

**Two illegal stops of thirteen**, and the first is the class the nav report
named: a browse point 0.107 yd inside a neighbour's collider, which no body can
occupy, which the walker grinds at until the ladder abandons the errand.

**A correction to the brief.** It says `member_station`'s browse point sits
~0.98 yd from queue slot 0 and should be moved. It does not, any more:
measured at **1.222 yd**, which clears the 0.92 a standing pair needs. The B1
re-pitch turned the line SOUTH and lengthened it to six, and the fixture that
now collides with the tail is **`tour_vault`**, not `member_station`. Nothing
was moved on the strength of the old number.

**`legalStopPoint()` / `stopPointIsLegal()` in `src/sim/layout.js`** — the
runtime half. A stop is checked WHEN IT IS CHOSEN, against the same rects the
route proof already uses (`navigationRects`), and an impossible one is nudged to
the nearest standable point within 1.2 yd or **refused outright** so the caller
picks another. Nothing is moved at arrival and no beat is teleported.

Wired at `fixtureBrowsePose` in clubhouse.js — the single place a fixture-local
browse pose becomes a world stop, used by both the visit planner and the
build-mode retarget. Each stop now carries `stopNudgedYd` and `stopUnreachable`,
surfaced through `crowdDiagnostics()`, so a run can tell "the solver is still
failing" from "the shop is still issuing stops nobody may stand on" — the
distinction the ladder was hiding.

The collider set is built once per batch and threaded through, because posing it
per stop walked every placeable once per customer per stop on a layout change.

## Why the ladder is still on

**The measurement could not be taken, and five Electron runs went into finding
out why.** Each failure was real and each one is worth more than the run:

1. **Fresh profile, ladder off** — `people=0` for all five minutes. The driver's
   own guards fired: *"never had two people in the room at once — this watch has
   measured nothing about crowds."* A fresh `pine-hills-v2` is a failing
   municipal starter: closed, filthy, no trade. Already in HARNESS_DEBT and I
   walked into it anyway.
2. **Resumed save, ladder off** — `people=0` again, plus *"never got inside"*.
3. **The walk-in was six blind legs of held W** — the exact method goal 35
   proved does not reach the room. Replaced with `walkInsideClubhouse`, which
   aims at a visible door node and **presses E**, because the door is shut.
4. **Walk-in fixed** — *"inside after 4 legs via SOCKET_MainEntrance"* — and
   still `people=0`. The room was right; the shop was empty.
5. **Clock moved to 11:00** and the watch made to wait for a first arrival —
   still `people=0`.

The staged save is the **start of the campaign**: a shop that has never opened,
condition 10, the objective still reading *"enter the closed clubhouse."* There
are no customers because there is no trade, and no amount of instrument work
changes that.

**So: `navLadder` is unchanged and still `true`.** Deleting it on the strength
of a five-minute watch of an empty room would be exactly the class of claim this
project has been burned by all week — a green number from an instrument pointed
at nothing.

### What finishing it needs

One thing, and it is not code: **a save with the shop open and trading.** The
nav rebuild's own `qa/nav/after` run had one. With that, the run is a single
command and the verdict is immediate:

    QA_RESUME=1 QA_ELECTRON_USER_DATA_DIR=<a trading save> QA_NAV_LADDER=0 \
    QA_NAV_MINUTES=5 node tools/qa/run-electron.cjs \
      tools/qa/nav-five-minute-watch.js --clubhouse=pine-hills-v2

The watch now reports `stopsNudged`, `stopsUnreachable` and `ladderOn` on every
15-second sample, so the answer the brief asks for — *"if not, say what is still
issuing impossible stops"* — is printed rather than inferred.

## The two illegal stops are still in the data

The runtime validator nudges them, which is the durable fix — the player can
move fixtures, so a data-only fix would be wrong the moment they did. But
`shelf_balls`' browse point being 0.107 yd inside the back counter is a layout
bug as well as a nav one, and the audit will keep naming it until somebody moves
it. Left alone tonight because moving an authored stand point is a floor-plan
decision with a test suite pinned to it.

---

# The measurement, taken after all — and it says NO

The blocker was staging, not the idea. `QA_NAV_STAGE=n` spawns shoppers through
the **production spawn path** (`sendWalkInToDesk` / `sendToCounter`, alternating
so both the queue and the shelves are used) — the same staged-pinch method the
nav rebuild used for its own ladder-off run. Only the ARRIVAL is scripted; they
route, queue and browse like anyone else.

Two runs, same save, same eight-person crowd, four minutes each, one boot apart:

| | ladder OFF | ladder ON |
|---|---|---|
| worst no-progress | **227.59 s** | **7.67 s** |
| stall episodes | 168 | 56 |
| shove frames | 11,858 (48.35/s) | 711 (2.90/s) |
| contact episodes | **0** | **4** |
| frames touching | **0** | 30 |
| frames interpenetrating | **0** | **2** |
| closest approach | **0.7566 yd** | **0.5628 yd** |
| people at 245 s | 8 (nobody ever left) | 4 (they finished and went) |
| **stops unreachable** | **0** | **0** |

## The ladder is not deleted, and now there is a number for it

With it off the crowd is **perfect** — zero contacts, zero touching frames,
closest approach 0.7566 yd — and **nobody completes an errand**: the population
never drops from eight, and one walker is held **227 seconds** on a 245-second
watch. With it on, people finish and leave, at the price of 4 contact episodes,
30 touching frames and **2 frames of actual interpenetration**.

That is the trade, measured in one boot on one crowd instead of inferred across
two afternoons.

## And the brief's hypothesis is wrong, which is the useful part

> "So fix the stop geometry. … Then delete the ladder and measure again. If not,
> say what is still issuing impossible stops."

**Nothing is.** `stopsUnreachable` is **0 in both runs** — every stop issued to
every customer was one a body could stand on, and the validator nudged exactly
one of them. Stop legality is fixed and it did not move the stalls.

What is left is in the `infeasible` column. With the ladder OFF it **freezes at
691** and never rises again while stalls climb linearly to 168 — the same
walkers, permanently unsolvable, never re-solving. That is not an unreachable
stop; that is the linear program having no feasible velocity at all, which is
**mutual deadlock**: two or more bodies each yielding to the other, forever. It
is the symmetry case the ORCA rebuild already flagged.

So the next move on the ladder is not another rung and not more stop validation.
It is a **deadlock break in the solver** — when a body's LP has been infeasible
for N consecutive frames, one of the pair must take priority and move. Deferred
tonight: that is surgery on the crowd solver, and the only verification I have
is a staged crowd. It should be done against a trading save with organic
arrivals, with this A/B as the before.
