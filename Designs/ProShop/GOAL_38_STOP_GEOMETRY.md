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
