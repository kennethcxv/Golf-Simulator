# OVERNIGHT REPORT 23

> **PERCEPTION RATIO — 1 of 1 so far.** The one thing settled tonight was settled
> by looking at the pixels: two captures put side by side at the same scale, an
> edge-position fit that produced a magnification of 1.125 about the exact image
> centre, and a gate that went from twelve red rows to twelve green ones. No
> property was read and trusted.

---

## ZERO — THE GOLDEN GATE. There was no regression. The lens was never pinned.

**The instruction was to bisect `c27d3a2..HEAD`.** I did, and the answer is that
nothing in that range did it.

### What the bisect actually measured

Rather than five Electron captures walking the range, two captures partition it
completely:

| capture | vs | result |
|---|---|---|
| `c27d3a2` (the commit that COMMITTED the goldens) | its own `tests/goldens` | **12 of 12 FAIL**, 7.75–9.16% |
| `HEAD` | `c27d3a2`'s capture | **shop-floor 0.0000, stockroom-wall 0.0000**, tools ≤0.017 |

The baseline commit does not reproduce its own goldens, and HEAD draws a
pixel-identical picture to the baseline commit. Both facts together say the same
thing: **no commit in the range changed the picture.** The one exception is
`tool-mop` at 0.5246%, which is Goal 22's 820-hairs-to-16-bands change and is
the only intended visual difference in twenty commits.

So the cause was never in the repository.

### What it was

The failing captures were the same room shot through a **different lens**.

I measured it instead of guessing. `tools/qa/golden-shift-probe.mjs` slides one
image over the other across ±30 px and reports whether any offset collapses the
difference — a camera that MOVED can be undone by a translation, a camera that
changed LENS cannot. No offset helped (11.93% → 10.10% at the search boundary).
So I fitted the vertical map instead, with `tools/qa/golden-scale-probe.mjs`:

```
FIT  y_current = 1.1252 * y_golden - 64.25
fixed point y = 514.0        (the image centre is 514.0)
```

A clean magnification about the **exact principal point**. That is what a field
of view change looks like and it is what nothing else looks like. Solving for
the lens: if the current capture is at 60°, the golden was at 66.0°.

The instrumented capture then said it outright:

```
"walkFov": 60,            <- what the capture was actually running
"lens": { "before": 60, "shipped": 66, "after": 66 }
```

**66 is the shipped default** (`DEFAULT_PREFERENCES.camera.fov`). 60 is a
persisted *player preference*, living in the Electron profile's `localStorage`,
shared by every driver and every free-play session ever run on this machine.
Somebody — a driver, or one of the stranger verifier sessions playing the game
for thirty minutes — moved the slider. From that moment every golden capture was
a different lens, and the gate had no way to say so.

### Why the previous session's refusal was right

`npm run golden:accept` would have baked **field of view 60** into the reference
images permanently, and the gate would have gone green on a picture no player
ever sees. Refusing to rebaseline without an explanation was the correct call and
it is the reason this was recoverable.

### The fix, and the proof

The world pin (`47463cd`, seed + `forceNew`) was necessary and not sufficient.
**Anything the player can change and the profile can remember has to be pinned by
the capture**, or the gate measures the machine instead of the code. The capture
now reads the shipped default out of `preferences.js` and forces the lens to it
before the first pose, and records `before / shipped / after` in the manifest.

Watched fail → watched pass, same build, same commit, one variable:

| lens | gate |
|---|---|
| 60 (drifted profile) | 12 of 12 FAIL, 7.75–9.16% |
| 66 (shipped default) | **12 of 12 ok** — shop-floor 0.0000, stockroom-wall 0.0000 |

### Two instrument faults fixed on the way

1. **A pose that did not run read as a PASS.** The manifest said
   `SKIP bag-packed: only 1 goods packed` honestly, and the differ then compared
   *last run's leftover file*, scored 0.0000%, and printed green. The capture
   that never happened was the row the gate was most confident about. The
   capture now clears its output directory first, and the differ walks the
   **goldens** as the contract rather than the captures, so a missing pose is
   reported as `NOT CAPTURED` and fails.
2. **The reference had no record of the conditions it was shot under.** The seed
   and interior origin were in a manifest that was thrown away every run.
   `golden:accept` now copies it to `tests/goldens/capture-conditions.json`, and
   it carries the seed, the interior Y, the lens, the canvas size and the device
   pixel ratio. A future divergence is one line of diff.

### What is still red, honestly

`bag-packed` — **NOT CAPTURED**. `only 1 goods packed`: the pose stages a
three-item sale and clicks each item into the carrier, and two of the three do
not pack. That is a real fault in the bagging interaction, which is exactly
section **F**'s subject, and it is carried there rather than papered over. The
gate has one red row and it is telling the truth.

### Ledger entry

A new instrument-fault shape, and it is the one that cost a week:

> **SHAPE 9 — THE PINNED WORLD IN AN UNPINNED MACHINE.** A determinism pin that
> covers the simulation and not the *presentation*. The seed, the clock and the
> spawn were all pinned and byte-reproducible; the field of view was a saved
> preference that any other program on the machine could edit. Ask of any golden
> or budget: *what, outside this repository, can change this number?*

---

# A — PERFORMANCE

## A2 The resolution control was inert. DONE.

**What the previous checks measured:** nothing had ever measured this. Every
resolution number in this project was taken at whatever size the window happened
to be — A4 of Goal 17 already records a figure voided because the window changed
size underneath it.

My own first attempt at the new ladder was wrong in the named way: it set
`preferences.display.resolution` and measured four identical rungs.
`display.resolution` is a stored string **nothing in the renderer consumes** —
the settings panel builds its own list from `fw:display-info` and calls
`fw:set-resolution`. Two selectors, aimed at myself.

Driving the real IPC the rungs were *still* identical. Since A5 of Goal 17 the
game maximises before first paint, and **on Windows a maximised window ignores
`setContentSize`**. The handler returned `true` every time.

| rung | before | after | GPU median |
|---|---|---|---|
| 1080p | 3840x2055, 7.89 MP | **1920x1081, 2.08 MP** | 4.90 -> **3.72 ms** |
| 1440p | 3840x2055, 7.89 MP | **2562x1441, 3.69 MP** | 4.89 -> **4.01 ms** |
| 4K | 3840x2160, 8.29 MP | 3840x2160, 8.29 MP | 5.09 -> 5.11 ms |
| fullscreen | 3840x2160, 8.29 MP | 3840x2160, 8.29 MP | 5.11 ms |

`fw:set-resolution` now leaves the maximised state and returns what it *applied*
in physical pixels instead of a bare `true`.

**And the honest part: I could not reproduce "4K and fullscreen are unplayable"
as a frame-rate problem.** At 4K fullscreen the game holds 181.8 fps with a GPU
median of 5.1 ms against a 5.5 ms panel budget. A3 found something that fits the
symptom far better.

## A1 The cap counts vsyncs now, and the default is your panel. DONE.

**What the old check measured:** `electron-a1-fps-cap.js` reported achieved fps
and "% of intervals within 20% of the requested interval". Both numbers were
right. The conclusion — *60 is the only rung that HOLDS, ship it as the default*
— was wrong, because the rung that holds best was the one the check could not
score: uncapped had no target, so `onCadencePct` came back `null`, and a null was
read as "not applicable" instead of "measure it against the panel".

Measured standing inside the shop, panel **181.8 Hz**:

| cap | achieved | even | 1% low |
|---|---|---|---|
| 60 | 60.6 fps | 94.4% | 22.0 ms |
| 120 | 97.1 fps | **0.2%** | 12.0 ms |
| 144 | 181.8 fps | *cap ignored* | 11.6 ms |
| 0 | 181.8 fps | 99.2% | 6.5 ms |

Two things there. The shipped default hands a high-refresh player **a third of
the frames their hardware presents**, with a 1% low three times worse than
uncapped. And a cap of 120 put two intervals in a thousand on the cadence it was
asking for: a display presents on a fixed grid, so to average 120 on a 181.8 Hz
panel the loop must alternate one vsync and two. That is a 5.5/11 ms sawtooth. It
averages right and feels wrong — and **"it never feels smooth" is what a sawtooth
feels like**.

No tolerance can fix a wall-clock compare, because the only reachable rates are
refresh/1, refresh/2, refresh/3. So `src/core/frameCap.js` counts presented
frames: it measures the panel from rAF gaps (median, so one GC pause cannot
redefine the display) and renders every Nth tick.

**Watched fail then watched pass, in Electron, same driver:**

| cap | evenness before -> after |
|---|---|
| 60 | 94.4% -> **97.8%** |
| 120 | **0.2% -> 98.7%** (97.1 -> 90.9 fps, deliberately) |
| 144 | 24.0% -> **99.3%** |
| 0 | 99.2% -> 99.1% |

The unit tests run the **shipped predecessor** over the identical vsync stream as
the control and assert it misses its own cadence. Eight tests; I watched two fail
on a first version that scored the warm-up as steady state.

**The default is now 0 — match the display.**

### And what this machine's stored profile says

Read straight out of the Electron profile before the harness touched anything:

    camera.fov 60          (the shipped default is 66 - this is what broke the golden gate)
    display.quality "ultra"
    display.renderScale 1.15
    display.shadowQuality "high"
    display.fpsCap 60

So the complaint "it never feels smooth" was being made **at 60 fps on a 181.8 Hz
panel**. That is the single largest feel-level number in this report.

## A1 (second half) Merge static meshes per material — NOT DONE, and measured

The brief names 2,413 draw calls as the lever. Measured indoors at the shop
floor: **574** draw calls standing, 942 peak on the walk. The ~2,900-call figure
is the **outdoor** view of the clubhouse (2,915 calls, 8.69 M triangles), which is
also where A3's stall lives.

Census of the interior (`electron-a1-batch-census.js`): 686 drawable meshes, 659
mergeable across **231 distinct materials**, so a perfect per-material merge saves
**428 calls**. But the prize is spread thin and the branches are not inert:

| subtree | drawable | materials | would save |
|---|---|---|---|
| DeliveryEquipmentInteriorRoot | 103 | 12 | 91 |
| CheckoutHardwareVisualRoot | 70 | 26 | 44 |
| SHEET06_PRODUCTION_INTERIOR_LIVE | 57 | 4 | 36 |
| PineHillsV2InteriorLayer | 52 | 21 | 31 |
| FrontDeskLedgerBook | 39 | 9 | **30 — and this one OPENS** |

No single subtree saves more than 91 calls, several of the biggest demonstrably
animate (the ledger book opens; delivery crates are unpacked; checkout hardware
moves), and the frame is not draw-call bound on this machine: CPU submit is
3.5 ms median inside a 5.5 ms budget and the game already sits at panel rate.

**Stopped at the 45-minute rule with the measurement written down** rather than
spending hours collapsing interactive geometry for headroom that is not binding.
The census driver is committed so the decision can be revisited with numbers.

## A3 The hitch is real, it is NOT the door, and it is located. NOT DONE.

**What the two previous checks measured.**

1. `doors-performance.js` timed door frames in **headless Chrome against
   `localhost:8457`**. It never ran the shipped build. Void.
2. `electron-f-door-lag.js` (Goal 21) did run in Electron, cold, with real keys —
   and **never asked whether the door opened**. It walked forward for three
   seconds, pressed E, and timed the frames either side.

The new driver refuses to report a number until the leaves have swung. Its first
run said `doorActuallyOpened: false` — **and that was my instrument, not the
game**: it read `ch.doorApi.doors`, which is passed *into* the sub-builders and is
not on the returned object. The clip showed the doors plainly open. The accessor
is `ch.doors`; fixed, and the frames are what caught it.

With the door confirmed (`angles 0,0 -> 1.7453, -1.7453`, both leaves, 100 deg):

| phase | frames | median | p95 | worst |
|---|---|---|---|---|
| still | 427 | 5.5 | 11.1 | 22.0 |
| control — walking AWAY | 349 | 5.6 | 11.6 | 22.6 |
| **approach — walking TO the door** | 577 | 5.5 | 11.1 | **13,112.9** |
| open — pressing E | 354 | 5.6 | 11.5 | 33.1 |

**The press is clean. The stall fires before you get there.** That is why two
attempts at "the door press is slow" found nothing: they were timing the wrong
moment.

Seven runs. Stalls in five: **13,112.9 / 12,590.1 / 8,973.5 / 8,200.4 / 2,947.3
ms**. Two runs clean. Every stall attributed:

- **100% of it is inside `scene3d.render()`** — the draw submit, not sim or input.
- Across the stall frame: programs 217->217, textures 302->302, geometries
  1404->1404, heap 440.6->440.6 MB, calls 2915, triangles 8,688,145 — **nothing
  is created**. Not a shader compile three.js can see, not an allocation.
- **Not the shadow map.** With `shadowQuality: off` the stalls persisted at
  8,200.4 ms and 12,590.1 ms. Mechanism eliminated with a control.
- Resource Timing returned zero entries for the whole session, so "no downloads"
  is **not** established — that instrument is void under `file://` and I am not
  claiming it.

This is the same family as the first-equip stall already on record, where sixteen
`renderer.compile()` configurations were measured and all failed. **I did not try
a seventeenth.**

**Reframing worth having: the hitch is not the door, it is the clubhouse
exterior view**, and it fires whenever the player is near the building. A 2–13
second freeze on approach is a much better fit for "the game is horrible to play"
than any frame-rate number in A2.

## A4 The numbers, before and after

Standing inside the shop, `pine-hills-v2`, clock 14:00, sim paused:

| | value |
|---|---|
| draw calls, indoors standing | 574 (942 peak on a 60 s walk) |
| draw calls, outdoors at the clubhouse | 2,915 |
| triangles, indoors | 4.79 M (8.69 M outdoors) |
| GPU median / p95 | 3.85 / 4.63 ms indoors, 5.11 ms at 4K fullscreen |
| CPU submit median / p95 / worst | 3.6 / 4.7 / 8.3 ms |
| 60 s indoor walk at cap 60 | median 16.5 ms, p95 21.1, worst 22.3, **0% dropped** |
| achieved fps per cap | see the ladder above; default now 0 -> 181.8 fps |

**Do the first-equip and first-ledger stalls still fire?** The first-equip stall
is untouched this session and is on record as unfixed after sixteen attempts. A3
found what is very likely the same mechanism firing on the clubhouse exterior,
which nobody had attributed before. Neither is fixed tonight and neither is
claimed to be.
