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
