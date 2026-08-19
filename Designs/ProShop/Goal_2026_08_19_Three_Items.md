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

## Item 2 — the editor: NO LATENCY FOUND on the paths I can measure

`tools/qa/editor-input-to-pixel.js` (new). Real `j` key, sim live, keydown to the
frame after the editor is up. Both controls behave: floor 25-26 ms, and a
deliberate 300 ms delay is seen at +306 to +311 ms.

| | p50 | max |
|---|---|---|
| enter the editor (real keydown) | 7.2-8.1 ms | 20.3-25.8 ms |
| first tool press inside | 7.5-8.1 ms | 12.6-14.8 ms, worst block 14.7 ms |

The retired stage's 79.3 ms was, if anything, pessimistic. **I have not fixed
anything here, because nothing I can measure is broken.**

**Exit is unmeasured and I will not claim it either way.** Escape never reaches
the page in the harness (0/6 on the real keydown) and the editor stays up through
a 20 s wait with no pause menu and no modal. Browsers reserve Escape for
releasing pointer lock, so a synthetic Escape may never arrive — I cannot
separate that from game behaviour without more work.

Two instrument faults found on the way, both of which had produced numbers I
nearly reported:

- the completion test `active() === want` is trivially true the instant it is
  armed if the editor was ALREADY in the wanted state, so five bogus sub-30 ms
  "exits" appeared for presses that never opened anything. Such samples are now
  discarded, not averaged in.
- picking a tool makes the session dirty, and `requestExit()` then opens a
  "Leave the editor?" confirmation instead of exiting. Six exits timed out at
  20 s each and were nearly reported as the editor being stuck. It is not stuck;
  it is asking.

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
