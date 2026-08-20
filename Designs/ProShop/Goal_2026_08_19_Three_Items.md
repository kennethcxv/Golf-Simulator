# Three items, 2026-08-19

## Item 0 — load time: 12.1 s -> 9.2 s best, ~11.9 s typical. TARGET NOT RELIABLY MET.

Measured with `tools/qa/boot-cost-ledger.js`, same stamped profile, serial runs,
nothing else on the machine:

| | min | median |
|---|---|---|
| baseline | 12,102 ms | 13,631 ms |
| after | **9,234 ms** | 11,926 ms |

Under 10 s happens on the best boot and not on the typical one.

### What the veil is actually made of

`tools/qa/prewarm-draw-anatomy.js` (new) ledgers EVERY warm draw by what it
buys. The decisive rows:

| draw | phase | ms | programs minted | calls | triangles |
|---|---|---|---|---|---|
| 14 | Warming the day | 7,337 | 28 | 3,729 | 9,855,542 |
| 15 | Warming the day | 28 | 0 | 3,357 | 8,524,073 |

Near-identical geometry, 260x the cost, and the only difference is the programs.
That **refutes the shadow-bake theory** (the warm viewport shrinks the colour
pass but not the shadow map, so it was the obvious suspect) and leaves exactly
one cost: program linking.

`tools/qa/program-key-stability.js` (new) dumps every program identity and diffs
it across two stamped boots: byte-identical, with a within-boot capture as its
control. So the driver disk cache IS being hit, and the residual ~69 ms per
cached program is real work that cannot be cached away.

**The arithmetic that decides the target:** ~238 programs must exist before the
veil lifts, at ~69 ms each cached and ~495 ms cold. That is the floor, and it
leaves roughly 100 programs of headroom for a 10 s veil. Getting there means
cutting the program COUNT, not shortening budgets. Goal 29 already measured
programs<120 mechanically unreachable, so this is a project, not a night.

**Deferral is not available.** courseScene.js carries a standing ruling of yours
— "stop skipping the work, tell the player instead" — written because every
skipped draw came back as a 10-16 s freeze in play. Linking is atomic per program
at 60-130 ms, so spreading 125 programs across the first seconds of play trades a
wait for a stutter. I did not do it.

### What was retired

`laptop-view`, the last surviving warm stage. On a quiet boot it costs 2,628 ms;
on a contended one it read 7,300 ms while drawing ONE frame and warming ZERO
thumbnails (`laptopThumbs: frames:0`) — its 4 s budget cannot interrupt its own
first atomic frame, so it pays for the expensive half and skips the half it
exists for. Its measured value is 1,197.8 ms of first-open protection, once, on
a desk you walk across the room to reach. It cannot move to an idle warm after
the veil: it takes the camera and opens the real screen.

**The trade, stated:** the first laptop open of a session now costs about 1.2 s.

### A caution about every boot number in this repo

Identical stamped boots measured 12.1, 23.8, 27.7, 39.1, 42.3 and 84.8 s. My own
backgrounded QA run poisoned one measurement by 2x. Boot timings here are only
meaningful as min-of-N, serial, with nothing else running.

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

## Item 2 — the latency is REAL, and it is the EXIT. Characterised, not fixed.

`tools/qa/editor-input-to-pixel.js` (new). Real `j` key, sim live, keydown to the
frame after the state flips. Both controls behave: floor 25-27 ms, and a
deliberate 300 ms delay is seen at +302 to +312 ms.

| | p50 | max |
|---|---|---|
| enter the editor (6/6 on the real keydown) | 17.4 ms | 21.3 ms |
| first tool press inside | 8.7 ms | 14.0 ms, worst block 7.8 ms |
| exit with NOTHING edited | 50.6 ms | 56.7 ms |
| **exit after actually using a tool** | — | **6,609.4 ms** |

Samples for exit: 54.6, 50.9, 50.5, 50.6, 49.8, 48.5, **6609.4**. The long one is
the rep where a tool was used, so the session was dirty and the exit went through
"Discard & leave".

**This is the thing you are feeling, and it is the case every real player meets** —
someone who opens the editor uses it. Enter and the tool press are fast, so the
retired warm stage is exonerated; the 79.3 ms was measuring the wrong end of the
gesture, and so was I this morning until I could drive the exit.

**It is NOT a main-thread stall.** Worst block across the whole 6.6 s was 29.8 ms.
The rebuild is already chunked across frames (goal 35 did that). It is six
seconds of *waiting* on an await, with the frame loop running throughout — which
is why every frame-time probe ever pointed at this has said the editor is fine.

**What I tried and REVERTED.** Rolling the course state back synchronously and
deferring only the mesh refresh, so the player leaves immediately. Measured
6,609 -> 5,218 ms: about a fifth, which means the bulk is NOT the discard's mesh
refresh but the rebuild that `exitEditor` itself triggers when the course has
changed (the same settle that goal 32 measured killing a 4.8 s grass compile).
One sample either side, on a save-mutating path, is not enough to ship a
reordering, so it is out of the tree. The target for whoever takes this is named:
the course/grass rebuild on the way OUT, not the discard.

**Four instrument faults found on the way**, each of which produced numbers I
nearly reported:

- `j` is not a toggle; the bound action only calls `enterEditor()`. Pressing it
  to leave looked like six swallowed presses.
- Escape never reaches the page (0/6 at a capture listener on window). Browsers
  reserve it for releasing pointer lock, so a synthetic Escape may never arrive.
  That is a harness limit and is not reported as a finding about the game.
- `page.click()` aims at a coordinate, and the exit button sits at x=2468 where
  the synthetic click missed it. The element's own `click()` works. This is the
  pointer-capture trap in HARNESS_DEBT wearing a different hat.
- the completion test `active() === want` is trivially true the instant it is
  armed if the editor was ALREADY in that state, so five bogus sub-30 ms "exits"
  appeared for presses that opened nothing. Such samples are discarded now.

And one thing that is NOT a bug: picking a tool dirties the session, so
`requestExit()` opens a "Leave the editor?" confirmation rather than leaving.
Six exits timed out at 20 s each and were nearly reported as the editor being
stuck. It is not stuck; it is asking.

### Your "Warming the day" question, answered

You asked whether the 1440-minute sweep can be cached across sessions. **It can,
and it is worth 33 ms.** The phase totals 4,407 ms and the two light states it
finds account for 4,374 ms of that (1,067 + 3,307), so the 144-step probing loop
itself is the remaining ~33 ms. Caching the minute list would save that and
nothing else. The cost is not the sweep; it is the **56 programs** the two
distinct light censuses force three.js to link, because it keys programs on
counts by light type.

That does suggest the one lever here that is not deferral: hold the interior
light census CONSTANT across the day (practicals always present, driven to zero
intensity) so no time of day introduces a new program. It would remove the phase
outright. I did not do it, because it makes the cheap lighting states cost what
the expensive one costs on every frame forever, and proving that trade needs
frame-time evidence indoors — which is exactly the "do not trade a stall in play
for a shorter veil" rule you set.

## The guards you asked for, A/B, stamped profile

| | baseline | after |
|---|---|---|
| door crossing, worst block | 30.0 ms | **28.7 ms** |
| belt presses INSIDE, max | 1,704.2 ms | **37.5 ms** |
| belt presses just OUTSIDE, max | 312.4 ms | **25.0 ms** |
| tool swap p50 | 16.0 ms | 19.3 / 21.1 ms |
| tool swap max | 35.7 ms | 31.2 / 35.3 ms |
| swaps swallowed | 0/9 | 0/9 |

One swap run read max 311.1 ms; two repeats did not, and the baseline histogram
carries a 437 ms outlier of its own. It is where the outlier landed, not a
regression.

Gate: `GATE_EXIT=0`, suite 3783/0, `bag-packed` rebaselined alone after reading
its diff (the change is confined to the laptop's old and new positions).

**A trap for whoever rebaselines next:** `node tools/golden-diff.mjs --accept
--only=bag-packed` silently ignores `--only` and accepted all 13. I restored the
other twelve from git by hand.
