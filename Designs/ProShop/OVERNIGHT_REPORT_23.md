# OVERNIGHT REPORT 23

> **PERCEPTION RATIO — 3 of 8.** Eight things were fixed and certified tonight.
> Three were verified by a check that could actually perceive what it certified:
> the golden lens (two captures at the same scale, an edge-position fit, twelve
> red rows to twelve green), the queue drain (277 clip frames extracted and
> looked at), and the broom roll (a contact sheet I read with my own eyes). The
> other five rest on properties read: frame intervals, buffer sizes, customer
> state, instance-matrix drift.
>
> **And the ratio understates the point.** Looking at pixels did not just verify
> tonight's work — it CAUGHT THREE OF MY OWN PROBES LYING, in code I had just
> written. A clip showed doors that my instrument swore were shut. Three
> photographs of the mop came back black or empty. A number would have caught
> none of it.
>
> The one thing I could not do is the one I most wanted: **I have never seen the
> mop head.** It is measured, simulated and unphotographed, and it is not claimed.

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

---

# B — THE TRANSACTION

## What the checks measured, before anything was changed

`tests/one-visit-one-payment.test.js` drives `createTx` → `scanItem` →
`attachGreenFeeToTx` → `payOnce` → `finalizeReservationCheckIn` **directly on the
sim modules**. Eleven tests, every one honest, every one green. Not one asks
whether a customer in the shop can reach that path.

They could not. **Four structural walls**, none of which a sim-level test can see:

1. the tee-time errand was raised from the **paid-sale site**
   (`clubhouse.js:1850`, inside `onCustomerPaid`), so the words arrived after the
   money;
2. `attachGreenFeeToTx` requires `tx.stage === 'scanning'` on an unbanked ticket;
3. the desk list filtered on `checkoutPhase` starting `'reservation'`, and a
   customer mid-sale is `'placing'` — so the booking was not on screen;
4. the **auto-payment timer starts payment on the last barcode**, so even a
   correctly timed ask arrived as the door shut behind it.

The queue checks (Goals 20, 21) measured the **list** — is IN QUEUE true, does
the front of the line abandon, does the look-ahead run. All true. None ever
measured the distance between two **bodies** during a handover, which is the
entire complaint.

## B1 They stay at the desk. DONE.

The desk branch is guarded by `stop.kind === 'counter'`, and the shopping
route's counter stop has already been **consumed** by the purchase that just
completed. On the next frame the route reads `'exit'` and the person walks out
mid-sentence, with their own line still on screen.

The route is pinned back to the counter, the F8 cart exclusion stops applying
once `bought` is true, and both desk-resolution sites clear the flag. Proven in
the same Electron run as B2: `stillInShop: true`, `phase: reservation-waiting`,
`errandPending: true`. They wait to be answered.

## B2 Three walls of four. NOT DONE.

Watched fail → watched pass, same driver, same staging, file-copy revert (never
`git stash`), revert asserted to have changed the file:

| | before | after |
|---|---|---|
| `deskErrandSpoken` | false | **true** |
| `tx.stage` at the ask | `card-ready` | **`scanning`** |
| dialogue | "These are all for me." | **"While I am here, can I check in for my tee time?"** |
| booking on the desk list | — | **`["1"]`, with `dueNow: false`** |

`dueNow: false` is the control: the booking is four hours out, so it is on that
list because **the person is standing there**, not because it came due.

**Where it stops.** The fourth thing a player must do — *click the row* — does
not render. `monitorScreenPoint` finds `tab-tee-sheet` and the click lands;
`deskHitTargets` then reports an empty hotspot list, so `select-reservation:1`
has no point to click. **The row is on the list and not on the screen.** The
driver stops exactly there rather than calling the sim underneath, which is how
this was reported done twice.

### One wrong fix, tried and reverted with evidence

`openWalkInCustomer` has carried a "still holding goods is a shopper" exclusion
since F8; `openReservationCustomer` never got one, so I added the mirror. **It
fires the F8 invariant.** With it the customer flips to `reservation-leaving` and
the console prints *"combined visitor reached the exit with 2 unpaid item(s)
after a desk outcome"* — the exact escape the exclusion exists to prevent, caused
by adding the exclusion. Something downstream releases a booking holder who is
neither desk business nor due. That release is the real bug; the exclusion only
exposes it. Left out, with the finding written into the predicate.

**Also found, not worked around:** attaching a reservation to a shopper *at
spawn* removes the customer outright.

## B3 The line advances when the FLOOR is clear. DONE.

The queue target is recomputed every frame as
`queueSlotW(counterQueue.indexOf(c))`. The instant the served customer is
**spliced out of the array**, every index behind them drops by one and the whole
line starts walking — into a slot the served customer is still physically
standing on, because leaving the array and leaving the floor are seconds apart.
Both previous fixes tuned steering and avoidance, which is downstream of a target
that was already wrong.

`queueAdvanceSlot` / `queueSlotIsClear` ask the floor: fall back freely, move up
**one step at a time**, and only into room that is genuinely empty. Clearance
0.95, wider than the 0.6 the steering code calls contact.

In Electron, four staged, positions sampled at 20 Hz:
`nobodyStartedEarly: true` — cleared at 3,357 ms, started moving at 148,601 ms.
`nobodyTouched: true` — closest approaches 1.324 / 0.599 / 0.600 yd.

**Limitation, plainly:** only the *second* person in the line moved inside the
run window, so the rule is exercised across one handover, not three. The
0.599/0.600 figures are the resolver's own resting separation, not near misses.
A side-on drain clip is still owed — the camera follows the player to the till,
because that is where a sale is taken.

**My first check was mis-calibrated and I am saying so:** it asked for more than
0.6 yd of clearance and failed at 0.599. `resolveCustomer` rejects any point
within 0.6 of another body, so two people in line **rest** at exactly that.
Asking for more than the simulation guarantees is a check that cannot pass, and
reporting it as a queue fault would have been wrong.

---

# C — NPC MOVEMENT. I looked first, and the answer is a measurement.

The brief names three candidates and asks me to pick one, say why, and vendor it.
**All three are available; the deciding fact is about this repository, not about
the libraries.**

## The requirement that eliminates two of them

> "a real navmesh baked from the shop's actual geometry, not a collider list"

- **`yuka` (0.7.8)** — pure ESM, trivially vendorable, good steering behaviours.
  Its navmesh is a **consumer**: `NavMesh.fromPolygons` takes a mesh someone
  already authored. It cannot bake one from the shop.
- **`three-pathfinding` (1.3.0)** — same, and smaller: A* over a navmesh you
  supply. No crowd avoidance at all.
- **`recast-navigation` (0.43.1)** — the WASM port of Recast/Detour. It is the
  only one that **generates** a navmesh from arbitrary geometry, and the only one
  with crowd simulation. It is the industry answer and it is the one the brief
  wants.

The shop has no authored navmesh. So the brief's own requirement selects recast.

## And recast cannot load in this build

The shipped CSP is:

```
script-src 'self' 'sha256-DMUMbakyPffSnql8XgUOiWKLXyTzINB6e9E0l4EGHiI='
```

with no `'wasm-unsafe-eval'`. **I did not assert this from the header text** — a
claim about a security policy is worth as much as a claim about a rendering path,
which is nothing until it is run. `tools/qa/electron-c-wasm-feasibility.js`
instantiates a real eight-byte WebAssembly module inside the shipped page:

```
syncCompile            refused: CompileError ... 'unsafe-eval' is not an allowed source of script
asyncCompile           refused: CompileError ...
instantiate            refused: CompileError ...
instantiateStreaming   refused: CompileError ...
```

Four entry points, all refused, in Chromium's own words.

## The decision, and why it is not mine to take alone

Adopting recast requires adding **`'wasm-unsafe-eval'`** to `script-src`. That
directive is much narrower than `'unsafe-eval'` — it permits WebAssembly
compilation and nothing else, no `eval()` of strings — and it is the standard
directive for exactly this case. But it is still a change to the security posture
of a game that ships on Steam, on the same page that renders the store's payment
flow, and the same repository already declined a full `'unsafe-eval'` for KTX2.

So **C is NOT DONE**, and it is not stalled on my judgement of the libraries. It
is one line of `index.html` away from being possible, and that line is the
owner's to approve:

```html
script-src 'self' 'wasm-unsafe-eval' 'sha256-…'
```

Say the word and recast goes in. Until then, vendoring `yuka` would buy steering
behaviours the shop already has hand-rolled (`steerAhead.js`) and **not** the
navmesh, which is the part that is actually missing — so it would be motion for
its own sake.

**What I did NOT do:** I did not spend the remaining session hand-rolling the
navigation again. Four attempts are on record, one of them in a module the game
does not import. The measurement above is worth more than a fifth.

---

# D — THE MOP

## D1 The solver was never called. Zero call sites. DONE.

**What the old check measured, and why its control was void.**
`electron-b-mop-is-simulated.js` (Goal 22) read the drawn instance matrices,
walked the player, and compared: `stillDrift 0, walkDrift 0, settleDrift 0`. It
then **passed its own negative control** — *"a motionless head must produce a
still mop"* — because an all-zeros rig satisfies that trivially. A frozen rig and
a correctly resting rig are the same numbers.

The solver was fine. **Nobody was turning the handle.**
`createVerletMopStrands` builds the rig in `toolViewmodel.js` and stores it on
the entry, and the only `strandRig.update(...)` in the repository is in
`broomViewmodel.js`, which owns its own bespoke rig and knows nothing about this
one. **Six passes** of tuning momentum, trailing, whip, floor spread and
frame-rate independence — all against unit tests that step the rig by hand — and
in the game it has never moved once.

| | before | after |
|---|---|---|
| `walkDrift` | 0.00000 | **2.54322** |
| hang below the collar | — | **0.2239 yd** |
| `stillDrift` | 0.00000 | 0.00000 (still still) |
| bands / draw calls | 16 / 4 | 22 / 4 |

### The positive control took three goes and all three are on the record

1. A **2.2-yard teleport** read exactly 0.00 — collision recovery undid it inside
   the sample window.
2. A **90° yaw swing** read 3.12 once and 0.00 the next run — it raced the frame.
3. Translating the **rig's own parent** 2.0 yd in the scene graph, synchronously:
   **2.18729**.

The first two were testing the game's willingness to be pushed. The question is
whether the sampler can see a displacement at all, and only the third asks it.

## D The bands cover the head — geometry DONE, look UNVERIFIED

16 was right in direction and read as spikes because a sunflower fill
(`r = radius·√(i/N)`) puts the first strands almost on the axis. Three changes,
none of which works alone: **22 bands** (inside the 16–24 asked for), a
**collar** so they hang from the head's width rather than a point, and bands
**26 mm across tapering to 20 mm** instead of 12 mm.

**And I have not seen it.** Three photographs: black at 6:01 AM (the interior at
the hour the game *starts* is unreadable — reaching the stranger's finding K4
from a driver that could not photograph an object it had just measured), black
again at 14:00 indoors (interior lights are on the restoration path, so a fresh
save has none), and outdoors in daylight the head is not in frame at all —
**the held viewmodel is not drawn outdoors**. The rig follows the player and the
solver runs on it; whether it *looks* like a mop is unverified and is not
claimed. The photograph beside a reference is **NOT DONE**.

---

# E — THE BROOM HEAD. One value, and a contact sheet. DONE.

## Why five rounds found nothing to change

The head's roll about the shaft **was never a parameter**. The shaft is aimed
with `setFromUnitVectors(geom.axis, dir)` — the *minimal* rotation between two
directions, which by construction says nothing about roll *about* that
direction. The three terms that do touch roll (`rollLean`, `rollStroke`,
`tiltAxis`) are all zero unless the player is mid-stroke or wedged against a
wall. So at rest and while carrying, the head has sat at an angle that fell out
of the authored mesh, that nobody chose, and that **nobody could reach**.

`sweep.headRoll` in `src/data/broomFeel.js` is that angle, as one number,
applied always. It is left at **0 — the unchosen value** — because the brief
says: *do not report a number you chose.*

## The old sweep ran in a program you do not use

`tools/qa/broom-pitch-sweep.js` boots against `http://localhost:8457/` in a
browser. Any candidate ever picked from it was picked somewhere the game is not.
That is the **fourth instrument tonight** found running in the wrong place — the
door timings, the golden lens, my own desk-list probe, and this.

The new sweep runs in Electron and produced **thirteen photographs of empty
grass** on its first run: outdoors the held viewmodel is not drawn, and
`setTool` reported `equipped: true` and `vmActive: true` throughout. It now
shoots from the **golden suite's own tool pose**, which has thirteen committed
reference images proving the broom renders from it.

## The deliverable

**`Designs/ProShop/E_BROOM_ROLL_CONTACT_SHEET.png`** — thirteen candidates
across a quarter-turn either way, cropped to the head, each captioned with its
number, degrees and radians. **#7 is the current shipped 0.** Tell me the number
and it goes in.

`tools/qa/contact-sheet.mjs` is general — any sweep manifest, numbered grid. Its
first output was thirteen pictures of grass cropped to the frame centre, so the
region of interest is a parameter now: a held tool is not in the middle of the
picture.

---

# THE FIVE LISTS

## 1. DONE, and how it was verified

| item | verified by |
|---|---|
| Golden gate: the lens was never pinned | **pixels measured and viewed** — a 1.125× magnification about the exact principal point, then 12/12 green |
| A2: the resolution control was inert | buffer sizes and GPU ms, before/after |
| A1: the cap counts vsyncs; default is your panel | frame-interval evenness, 0.2% → 98.7% at cap 120 |
| B1: they stay at the desk to be answered | live customer state after a full visit |
| B3: the line advances when the floor is clear | 20 Hz body sampling + **277 clip frames viewed** |
| D1: the mop's solver is called | drift 0 → 2.54, with a positive control on the instrument |
| D: 22 bands from a collar | unit tests with the old fill as control — **look unverified** |
| E: the head's roll is one value | **contact sheet viewed** |

## 2. NOT DONE, and why

- **A1 (merge)** — 428 calls spread over 231 materials, no subtree worth more
  than 91, and the biggest ones animate. Not draw-call bound on this machine.
  Stopped at the rule with the census committed.
- **A3 (the hitch)** — located, attributed, reproducible: 2–13 s **inside the
  draw submit**, on the *approach*, not the door. Shadow map eliminated with a
  control. Same family as the first-equip stall; I did not try a seventeenth
  `renderer.compile()`.
- **B2 (one payment)** — three walls of four removed. The fourth: the desk row
  is on the list and **not on the screen**, so there is nothing to click.
- **C (navigation)** — recast is the right library and **this build cannot load
  WebAssembly**. One line of CSP, and it is the owner's line.
- **D (the photograph)** — could not get the head into a lit frame.
- **F, G, H, I, J, K** — not started.

## 3. Found false, or found wrong, by me, tonight

- My resolution ladder set a preference **nothing consumes** — four identical
  rungs. Two selectors, aimed at myself.
- My door probe read `ch.doorApi.doors` (not on the returned object), reported
  `doorActuallyOpened: false`, and **the clip showed the doors plainly open**.
- My desk-list probe read `ch.frontDeskReservations` instead of
  `ch.frontDeskBridge()` — an empty list that looked like a missing row.
- My queue check asked for **more clearance than the simulation guarantees**
  (>0.6 against a 0.6 resolver floor) and would have reported a resting queue as
  a collision.
- My `openReservationCustomer` fix **fired the F8 invariant**. Reverted with
  evidence, by file copy, revert asserted.
- Two positive controls for the mop that the game quietly undid.
- A tuner slider whose label the **player-strings ratchet** correctly refused.

## 4. Owner decisions waiting

1. **`'wasm-unsafe-eval'` in the CSP** — unblocks recast-navigation for section C.
2. **A number from the broom contact sheet** (#1–#13).
3. The 332-finding lint baseline still awaits the breakdown review.

## 5. The found-false ledger — the permanent list

Tonight adds one shape, and it is the one that cost a week:

> **SHAPE 9 — THE PINNED WORLD IN AN UNPINNED MACHINE.** A determinism pin that
> covers the simulation and not the *presentation*. The seed, the clock and the
> spawn were pinned and byte-reproducible; the field of view was a saved
> preference any other program on the machine could edit. **Ask of any golden or
> budget: what, outside this repository, can change this number?**

And a second, sharper statement of an old one:

> **A PROBE THAT CANNOT SEE THE THING REPORTS THE SAME AS A THING THAT DID NOT
> HAPPEN.** Three times tonight, in code I had just written. The door, the desk
> list, the mop. Every one was caught by looking at pixels, and none of them
> would have been caught by a number.

---

# CLOSING

**Seven commits, all pushed. Suite 3064/3064 throughout. Lint ratchet at the
frozen 332.** The golden gate has one honest red row — `bag-packed`, NOT
CAPTURED, which is section F's subject.

The single most useful sentence in this report is probably not a fix at all:
**the complaint "it never feels smooth" was being made at 60 fps on a 181.8 Hz
panel**, by a default this project chose and defended with a measurement that
could not score the rung that won.

---

# F — THE BAG. Faked. DONE in code, UNVERIFIED visually.

G4.2 said *"packed goods STAY VISIBLE at FULL SIZE — the bag's own walls are
what hides them; no path may switch a packed good off."* That is now reversed on
instruction.

G4.2 was itself a correction of a worse fault: goods used to **shrink and pop
out** in full view above the rim. That objection is about *where* the item
disappears, not whether it does, and the two-leg motion already answers it —
travel to the mouth, then sink **down inside** at full size. Hiding now happens
only after that, behind the paper. Nothing pops, nothing shrinks, **and no body
has to fit**.

The bag still reads as full: the mouth grows a kraft-coloured mass rising with
the count and never reaching the rim (`1 − 1/(1 + n·0.55)`), authored to the
bag's own interior rather than measured off a product, so it cannot clip.

### The test would have passed unchanged, and that is the part worth recording

`visible = true` is still at the top of `packMeshIntoBag`, and the new
`visible = false` sits below the slice the assertion cut at — **the suite went
green on a build whose contract had been turned round.** A green test asserting
a contract nobody holds is worse than no test. It now asserts the new rule, and
its title says so.

**Not verified visually.** I have no clip of an item entering this bag. The
golden `bag-packed` pose — exactly the picture that would show it — still fails
to stage at *"only 1 goods packed"* of three. That is the gate's one honest red
row, and the staging fault is in the click-to-bag path, not the packing rule.

---

# G1 — The click is measured at −25.9 dBFS and raised. NOT CONFIRMED.

**What the old check measured:** Goal 22 counted graph *events* — oscillators
created, gains scheduled, `start()` called. That proved the menu was no longer
silent. It says nothing about loudness: a node at 0.0001 and a node at 0.5
produce identical event counts.

Measured off the master bus with the audio module's own `qaMasterTap`, against a
clean **zero** silence floor:

| cue | peak | dBFS |
|---|---|---|
| `uiTick` | 0.0509 | **−25.9** |
| `uiConfirm` | 0.0615 | −24.1 |

**And the menu and the in-game clicks are the same call.** `window.__fwUiClick`
routes every button in the game to `uiTick`, so *"match them to the in-game UI
clicks"* was already true — they were equally quiet together.

**The first measurement was not trustworthy and the fix was to the instrument.**
One shot read −33.7 dBFS on one run and −29.4 on the next with no code change
between them: the cue decays over 50 ms and the tap polls on animation frames.
The driver fires eight shots per window and takes the max.

**And I cannot confirm the fix.** `uiTick` went 0.05 → 0.16, a factor of 3.2,
and the measured peak did **not** rise: −25.9 before, −27.9 after, inside the
tap's own scatter. The chain is a plain gain cascade — `uiTick → uiBus → master
→ destination`, no compressor anywhere in `audio.js` — so 3.2× at the source *is*
3.2× at the output by arithmetic. The change is almost certainly real and my
instrument cannot see it, which means **it is not verified**.

Kept, because reverting a correct fix on the word of a broken instrument is the
same error in the other direction. **G1 is NOT DONE**: it needs a tap that can
resolve a 10 dB step, or your ears.

---

# SESSION CLOSE

**Eleven commits, all pushed. Suite 3064/3064. Lint ratchet frozen at 332.
Golden gate 12 of 12 green with the lens pinned, and one honest red row.**

**Not started: G2, G3, H, I, J, K.** Named here rather than quietly dropped.

The three sentences worth keeping:

1. **The golden gate never had a regression.** The world was pinned and the
   *lens* was not, and a saved player preference on this machine had moved it
   from 66 to 60. Refusing to rebaseline last session is what made it
   recoverable.
2. **"It never feels smooth" was being said at 60 fps on a 181.8 Hz panel**, by
   a default this project chose and defended with a measurement that could not
   score the rung that won.
3. **Three of my own probes lied tonight, in code I had just written**, and all
   three were caught by looking at pixels. A number would have caught none of
   them.
