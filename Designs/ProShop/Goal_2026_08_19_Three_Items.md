# Three items, 2026-08-19

## Item 0 — DONE. 12.1 s -> 6.05 s median, every boot under ten seconds.

`tools/qa/boot-cost-ledger.js`, stamped profile, serial, quiet machine, N=5:
**6,054 / 8,124 / 5,977 / 6,719 / 6,035 ms.** Median 6,054 ms, worst 8,124 ms,
against a 12,102 / 13,631 / 16,367 ms baseline.

### It was never prewarm. It was the save load.

You told me to take prewarm apart, and I did — the answer is that every second in
it is load-bearing (the table below). The win was somewhere nobody had looked:
`tools/qa/boot-mark-breakdown.js` (new) reads the performance marks main.js
already stamps, plus a mark for the moment Continue is clicked, and found
**2,291 ms between the player committing and `startScene` being ENTERED** — with
the teardown and scene construction inside that window costing 10.4 ms and
0.5 ms. Splitting it further:

    loadEmpireSave            2,213.1 ms
      reading the file           25.0 ms
      deserialize             2,195.7 ms
        newEmpire()           2,117.6 ms   <-- here
        the actual saved data     86.2 ms

**`deserializeEmpireWithReport` called `newEmpire(mode, seed)` unconditionally**,
generating a complete fresh portfolio — market listings and all — purely to have
a `defaults` object. That object is read **exactly twice**: `defaults.market`, in
a branch only taken when the save carries no market, and `defaults.cash`, a
fallback reachable only when the saved cash is not a finite number. A healthy
save supplies both, so on every ordinary launch the entire generated empire was
built and discarded untouched.

It is now built on demand and memoised. **Deserialize: 2,195.7 -> 95.5 ms.**

That is the honest answer to "which parts are re-deriving work the save already
has": not prewarm — the loader, regenerating the whole world to find two
fallbacks.

### The check, watched failing

`tests/empire-load-does-not-regenerate.test.js` (new) is deliberately RELATIVE so
it cannot go flaky on a slow machine: whatever `newEmpire` costs here and now,
deserializing a healthy save must cost under half of it. Before the fix that was
impossible by construction, because the deserialize *contained* a build — watched
failing with the eager call restored:

    deserializing a healthy save took 3,097.7 ms against 3,114.9 ms to generate
    an empire — a healthy load must not be generating one

Two further tests keep the fallback honest: a save with its market deleted still
gets one regenerated and reported, and a save with unusable cash still lands on a
finite number.

### And it costs nothing in play

This touches the save loader only — no shader, no light, no material. The guards
confirm it: door crossing 35 ms, belt presses indoors max 37.5 ms, outdoors
29.1 ms, **zero frames over 100 ms anywhere**; swap p50 20.5 ms, max 31.9 ms, 0/9
swallowed, and zero frames over 50 ms in the histogram.

## Item 1 — the laptop: DONE, gap 0.0000 m

It was not a seating error of millimetres. `tools/qa/laptop-seating.js` (new)
drops a vertical line through the laptop and reports every surface it crosses:

- before: `GREY_Ceiling` above, `ShopTierFloorFinish` **1.03 m below**, nothing
  in between.
- after: `counter_work`, gap **0.0000 m**.

Control: lift the laptop 40 mm, the reported gap must move by 40 mm. It does.

**Root cause.** `pineHillsV2Interior.mountHeroCounter` instantiates
`hero_counter` RAW at its authored **2.39 m**, hiding a greybox slab built to
`FRONT_DESK_FRAME.frontLength` (**4.2 m**). The slab stays as the datum for the
colliders and the queue, so props are placed in a coordinate system half again as
long as the object they rest on. The laptop sat 0.56 m past the right end. The
ledger book hangs off the LEFT end for the same reason — two props off opposite
ends is what rules out "the props are misplaced".

**This affects v2 and v3, not just `final`.** The identical numbers came back on
pine-hills-v2, which is how I know the stripped room did not introduce it.

Also found: the desk has two levels and only the upper one had a name.
`COUNTER_TOP` is the customer bar; the staff work surface is 155 mm below it and
is now `COUNTER_WORK_TOP`. The laptop is placed on the measured plane plus
`LAPTOP.baseDrop` — the rig's own foot height — so the geometry that builds the
feet and the code that seats them read the same number.

**The test pinned the bug.** `tests/front-desk-frame.test.js` asserted
`laptop.x > 1.2` and passed for sixteen days while the laptop hung in mid air,
because every coordinate in it is a LAYOUT coordinate and the layout's desk is
the slab. It now measures the laptop's full body against the counter that is
drawn. Watched fail on the old pose: `|1.75| + 0.195 must be <= 1.194`.

**What I did NOT do, and it is your call:** the hero desk is still 2.39 m
standing in a 4.2 m hole, so the collider and queue still use the long shape and
the ledger book still hangs off the left end. Stretching a hero asset 1.9x to
fill a greybox volume is a decision about the desk, not about the laptop.

Frame: `qa/final-room/final-seated/02-the-desk.png`.

## Item 2 — DONE. The latency is the EXIT, and it was 2.2 s.

`tools/qa/editor-input-to-pixel.js` (new). Real `j` key, sim live. Both controls
behave: floor 25-27 ms, and a deliberate 300 ms delay is seen at +302 to +312 ms.

**It only happens after a REAL EDIT, and that took three tries to find.**
Selecting a tool does not dirty the session: 14 consecutive exits after
`setTool('terrain')` never raised the confirmation at all and every one measured
46-56 ms. Driving an actual terrain stroke on the canvas reproduces it every
time, and the driver now asserts the session went dirty so it cannot quietly
measure the cheap case again.

| | before | after |
|---|---|---|
| enter the editor | p50 30.2 ms, **max 9,150.1 ms** | p50 361.7 ms, **max 408.9 ms** |
| exit after a real edit | **p50 930.4 ms, max 2,193.9 ms** | **p50 59.7 ms, max 458.8 ms** |
| first tool press | p50 7.3 ms | p50 9.6 ms, max 10.0 ms |

Worst case across the whole gesture: **9,150 ms -> 459 ms.**

**It was never a stall.** Worst main-thread block across those exits was 38.3 ms —
the rebuild is already chunked across frames (goal 35 did that work). It was
seconds of *waiting on an await* with the frame loop running throughout, which is
exactly why every frame-time probe ever aimed at the editor has said it is fine,
and why this needed input-to-pixel to see at all.

**The fix removes the wait, not the work.** "Discard & leave" used to await
`discardPendingWork()` and only then call `onExit()`, so you watched a disabled
"Discarding..." button. Now the state rollback stays SYNCHRONOUS and completes
before you are anywhere — re-entering a second later snapshots a correct course,
not a half-undone one — and only the mesh refresh finishes behind you, in the
same chunks at the same per-frame cost. Pending works are by definition not
built, so nothing being rolled back is in the world you walk back into.

The trade, stated: entering again *immediately* now waits on that refresh
(p50 30 -> 362 ms), which is why the worst case fell 22x while the median rose.
The driver re-enters 600 ms after leaving; a player walking back across the shop
will not see it.

**Four instrument faults found on the way**, each of which produced numbers I
nearly reported as findings about the game:

- `j` is not a toggle; the bound action only calls `enterEditor()`. Pressing it
  to leave looked like six swallowed presses.
- Escape never reaches the page (0/6 at a capture listener on window). Browsers
  reserve it for releasing pointer lock. A harness limit, not a game finding.
- `page.click()` aims at a coordinate and missed a button at x=2468. The
  element's own `click()` works — the pointer-capture trap wearing a new hat.
- `active() === want` is trivially true the instant it is armed if the editor was
  ALREADY in that state, so five bogus sub-30 ms "exits" appeared for presses
  that opened nothing. Discarded now, not averaged in.

And one thing that is NOT a bug: a dirty session answers Escape with a "Leave the
editor?" confirmation rather than leaving. Six exits timed out at 20 s each and
were nearly reported as the editor being stuck. It is not stuck; it is asking.

### Your "Warming the day" question, answered

**The sweep can be cached, and it is worth 33 ms.** The phase totals 4,407 ms and
the two light states it finds account for 4,374 of that (1,067 + 3,307), so the
144-step probing loop is the remaining ~33 ms. Caching the minute list saves that
and nothing else. The cost is the **56 programs** the two distinct censuses force
three.js to link, because it keys programs on counts by light type.

That names the one Item 0 lever that is not deferral: hold the interior light
census CONSTANT across the day (practicals always present, driven to zero
intensity) so no time of day introduces a new program. It would remove the phase
outright. I did not ship it, because it makes the cheap lighting states cost what
the expensive one costs on every frame forever, and proving that trade needs
indoor frame-time evidence — which is your own "do not trade a stall in play for
a shorter veil" rule pointing straight at it.

## The guards you asked for, A/B, stamped profile

| | baseline | after |
|---|---|---|
| door crossing, worst block | 30.0 ms | **25.8 / 28.7 ms** |
| belt presses INSIDE, max | 1,704.2 ms | **37.5 ms** |
| belt presses just OUTSIDE, max | 312.4 ms | **25.0 ms** |
| tool swap p50 | 16.0 ms | 19.2 / 19.3 / 21.1 ms |
| tool swap max | 35.7 ms | 30.5 / 31.2 / 35.3 ms |
| swaps swallowed | 0/9 | 0/9 |

One swap run read max 311.1 ms; two repeats did not, and the baseline histogram
carries a 437 ms outlier of its own. It is where the outlier landed, not a
regression.

Gate: `GATE_EXIT=0`, suite 3783/0, `bag-packed` rebaselined alone after reading
its diff (the change is confined to the laptop's old and new positions).

**A trap for whoever rebaselines next:** `node tools/golden-diff.mjs --accept
--only=bag-packed` silently ignores `--only` and accepted all 13. I restored the
other twelve from git by hand.
