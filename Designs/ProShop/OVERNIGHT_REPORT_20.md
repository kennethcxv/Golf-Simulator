# OVERNIGHT REPORT 20

Working `Designs/ProShop/Full_Goal_20.md` in the ordered form: A, B, C, D, E, F,
G, H, I, J, K. Verifier 3 (the stranger) launched before the first line of code
was changed. Every section closes on its own Phase 4.

Branch `feature/pro-shop-vertical-slice`, from `35f1dc4`.

---

## CARRIED IN FROM GOAL 19 — TWO VERDICTS THAT NEVER LANDED

Report 19 closed with Verifier 1 and Verifier 2 launched and their verdicts
marked "appended below when it lands". They were stopped before they reported.
Those two marks in Report 19 are permanently pending and should be read as
**unverified**, not as passed. Goal 20 re-runs both verifiers against this
night's work, and the opening section of Full_Goal_20 already re-opens five of
the claims they were sent to attack.

---

# A — THE QA MOUSE TRAP

**The complaint.** "My cursor gets locked inside the Electron window and I cannot
get it out until you are finished. I cannot use my own machine while you work."

## A0 The instrument, and what it caught on its first sample

The complaint is an operating-system fact, not a page fact, so the instrument
asks Windows rather than the game. `tools/qa/cursor-capture-watch.ps1` samples
two independent Win32 facts at 20 Hz for the length of a run:

| Fact | Free cursor | Captured cursor |
|---|---|---|
| `GetCursorInfo().flags & CURSOR_SHOWING` | 1 | 0 (pointer hidden) |
| `GetClipCursor()` rectangle | the whole virtual desktop | the window |

`GetCursorPos` is recorded alongside so a pinned or recentred pointer is visible
in the trace.

**Watched failing, first sample, on the build as it stood** — taken while a
routine verifier session was running:

```
header: virtualScreen 5120 x 1440
{"showing":0, "clip":[7,30,1608,930], "clipFree":0, "x":807, "y":480}
```

The pointer was hidden and Windows had shrunk the confinement rectangle from the
5120x1440 desktop to `[7,30,1608,930]` — the 1600x900 QA window, exactly. That is
the owner's machine being taken away, stated as a number. Every sample for the
duration of the run said the same.

## A1 Why it happens, and why the obvious fixes do not work

Every driver drives the camera the way a player does: click the canvas, the game
calls `canvas.requestPointerLock()`, the view turns. `courseScene.js:8117` gates
mouse-look on `document.pointerLockElement === canvas`, so **there is no way to
turn the view without a real lock**, and Chromium's pointer lock is an OS-level
seizure — it hides the system cursor and calls `ClipCursor()`.

The two directions the brief suggested that I measured and rejected:

- **"Never take OS focus."** Chromium only grants pointer lock to a *focused*
  window and drops it the moment focus leaves. "Locked but not focused" does not
  exist. Real pointer lock and a free cursor are mutually exclusive on one
  desktop — that is a property of the platform, not of this harness.
- **"Release the lock between driver steps."** The cursor is captured *during*
  the steps, which is where all the wall-clock is. It would not have satisfied
  "not for a frame".

## A2 What I did, and what it cost

I replaced the **lock primitive**, not the input. Under `--fw-qa` (planted by
`main.cjs` only when `FW_QA=1`, which only `tools/qa/run-electron.cjs` sets),
`src/core/qaLookCapture.js` swaps the four DOM members that mean "this page owns
the pointer": `requestPointerLock`, `exitPointerLock`, `pointerLockElement`, and
the per-event movement delta.

Everything else is the untouched real path. The events are still real, still
`isTrusted`, still injected through the browser's input pipeline, still
hit-tested, still dispatched to the same listeners in the same order. The game
reads pointer lock in **thirteen** places to decide what a click means; not one
of them changed, because from the page's side the lock is held. Editing thirteen
gameplay call sites would have been the *less* faithful fix.

The movement delta is recomputed from the same event's own coordinates, in a
capture-phase listener that runs before the game's. This is not an approximation
of what a lock would have delivered — it is identical. There is no physical
device behind an injected pointer, so the raw delta *is* the position delta.

**The costs, stated plainly:**

1. The genuine `requestPointerLock` code path is no longer exercised by a normal
   QA run. Mitigation: `FW_QA_POINTERLOCK=1` restores the real thing for a
   driver that needs to test the lock itself. That run does take the cursor,
   which is why it is opt-in and never the default.
2. Under the shim the page always reports `document.hasFocus() === true`.
   Without that, `courseScene`'s focus backstop would release every held key the
   instant the owner clicked their own window — which would make the fix
   useless, since being able to work while a run happens is the entire point.
   The real focus-loss backstop keeps its unit coverage but is not exercised by
   QA runs.
3. The QA window still *takes* focus when it launches. The cursor is free, so
   alt-tabbing away now works and stays working; the window appearing on top at
   launch is a residual annoyance I did not spend the section on.

`tests/qa-look-capture.test.js` (5 tests) pins the dangerous half: the shim is
inert without the flag, inert with `--fw-dev`/`--fw-clubhouse` alone, and inert
when `--fw-qa-pointerlock` overrides it. It also pins that the first event after
a lock reports a zero delta, so a re-grab can never whip the view.

## A3 An instrument fault this section found in my own harness

The free-play bridge every stranger verifier drives — `sweep` — nudged the
pointer out to `800+dx` and returned it to `800` on **every step**. The return
move's delta is the exact negative of the nudge, so:

> **every camera sweep the bridge has ever run netted to zero turn.**

Verifier sessions that reported "I looked around" were standing still. Fixed: a
sweep now travels, wrapping to the far side of the window when it runs out of
room, which costs the 140 px `applyMouseLook` clamps a single event to — under
10% of a pass, and a full pass is about 170 degrees, so most sweeps never wrap.

This goes on **REPORTED DONE PREVIOUSLY, FOUND FALSE**: it silently degraded
three nights of stranger verification.

## A4 The instrument's negative control caught a fault in the instrument

Run with nothing playing, the watcher reported the cursor **captured**. It was
sitting free on the desktop. PowerShell starts DPI-unaware, so Windows answered
the two APIs in two different coordinate spaces — `GetSystemMetrics` said the
virtual screen was 5120 px wide while `GetClipCursor` reported a 4267 px free
rectangle, which is 5120/1.2, the display's scale factor. The comparison between
them was meaningless, and it failed **towards "captured"**, which is the
direction that would have let me declare victory on a broken measurement.

Declaring DPI awareness was not enough on its own (7680 vs 6400 — the monitors
run at different scale factors). The fix is to stop needing that precision: a
captured cursor is confined to a *window*, measured at 1601x900, and a free one
gets the whole desktop, so requiring the clip to cover at least one monitor
separates the two by a factor of eight. Both directions now verified:

| | cursor shown | clip rectangle | verdict |
|---|---|---|---|
| nothing running | 27/27 samples | `[0,0,6400,2160]` | free |
| a QA run, before the fix | 0/28 samples | `[7,30,1608,930]` | captured |

## A5 Phase 4 — adversarial verification

**The OS half.** `tools/qa/cursor-capture-watch.ps1` at 20 Hz across the whole
acceptance run, **1,802 samples**:

```
frames with the cursor HIDDEN     0
frames with the cursor CONFINED   0
distinct clip rectangles          [0,0,6400,2160]   (the desktop, always)
distinct cursor positions         1  -> 2564,1989
```

The driver issued over two hundred mouse moves and the physical pointer never
moved once. "Not for a frame" is measured, not asserted.

**The page half** (`tools/qa/electron-a-mousetrap.js`, all seven green):

- a real canvas click takes the look: **true**
- a 1,170 px sweep turns the view by **−2.457 rad** against a predicted
  **−2.457** — exact, so the shim delivers the deltas a real lock would have
- every mousemove `isTrusted`: **true**
- real key holds still walk the player: **3.117 yd** on a 900 ms W
- **negative control**: with the look released the identical sweep moved the
  view **0.00000 rad** while **40 events still arrived** — proving a gate rather
  than an absence of input
- re-grabbing the look after release turns the view again (**3.826 rad**), so
  the gate is not one-way

The first run of this driver failed `lookHeldAfterClick` and passed on the
second click. The load veil was still over the canvas and the click landed on
the curtain. That was the driver's fault, not the game's, and it is fixed by
waiting for the veil — recorded here because "the instrument is more likely to
be wrong than the fix" held again.

**Residual, stated rather than hidden:** the real `requestPointerLock` path is
no longer exercised by a default QA run (`FW_QA_POINTERLOCK=1` restores it), and
`document.hasFocus()` always reports true under the shim.

---

# B — THE MOP

## B1 What House Flipper's mop does that ours does not

Done as research this time, and the most useful finding is that the reference is
not what it has been assumed to be. House Flipper's mop is **not** a strand
simulation. Contemporary coverage describes cleaning as "vaguely waving a mop –
which looks suspiciously like a broom – in their general vicinity", and in House
Flipper 2 the mop is gone entirely: stains are cleaned with a cloth and spray.
The head is a flat block that stays planted on the floor and pivots on the
stick; the fibres are close to static.

So "match House Flipper's mop" cannot mean "copy its yarn", because its yarn
barely moves. What it does that ours does not is narrower and more useful:

1. **The head stays welded to the floor plane** through the whole stroke. Ours
   swings on an arc and the contact reads as intermittent.
2. **The tool reads as one object being pushed**, not a stick with a decoration
   on the end. Their head's motion is dominated by the floor constraint; ours is
   dominated by the swing.
3. **Feedback is immediate and legible** — dirt lifts under the head on contact,
   which is what sells the contact even when the fibres are stiff.

Our own yarn is a strand simulation and should be better than the reference, not
equal to it. That is what B2 does; (1) is a head-plant question and stays open.

## B2 The yarn is simulated now

The rig being replaced drives every strand with `lag += (target - lag) * dt *
chase` — a first-order filter chasing an angle derived from the head's swing. It
has no momentum, no floor, and no idea where it is in the room. Everything it
could not express was added as another input: the mopping stroke (Goal 16), then
the head's carry fan (Goal 17), then the head's world delta so turning on the
spot would stir it (Goal 19). Three signals, three patches, still animation.

`src/render3d/mopVerlet.js` replaces it with position-based dynamics — Verlet
integration, iterated distance constraints, and a real floor — with the nodes in
**world space**. That last part is why it is not a fourth patch: the strands read
the anchor's own world matrix, so stroke, carry, walking, strafing, turning and a
stumble are all simply *where the head is*. The three drive signals collapse into
one line.

I did not vendor a library. The small JS Verlet engines (`mattdesl/verlet3d`,
`VerletExpressJS`, `trzy/verlet`) are particle-and-stick systems that allocate an
object per particle and per constraint, model no floor friction, and do not write
into an `InstancedMesh`; at 640 strands x 4 nodes that is 2,560 live objects a
frame plus an adapter, against ~90 lines of flat `Float32Array` arithmetic. What
failed five times was not that the code was local — it was that it was a lag
curve.

**The old rig measured against the new tests** (`tools/qa/mop-rig-control.mjs`,
kept as the permanent negative control for `tests/mop-verlet-strands.test.js`):

| | old rig | new rig | assertion |
|---|---|---|---|
| tips move with a MOTIONLESS head | **0.0099 yd / 30 frames** | 0 | < 1e-6 |
| tip offset while the head is carried | **0.000000 yd** | −0.09 | < −0.02 |
| spread, free → planted | 1.28x | 3.4x | > 1.5x |
| flatten, free → planted | 0.78 | 0.53 | < 0.75 |

The first row is the "canned loop" the brief names: the old rest pose contains a
literal `Math.sin(time * 1.7 + phase)`, so a mop standing still shimmered for
ever. The second is "welded", and it is exactly zero — sliding the head across
the room moved the yarn **not at all** unless someone separately computed a carry
number and passed it in.

Seven tests cover the four behaviours plus determinism, teleport safety and
frame-rate independence (30 fps and 60 fps settle to within 0.01 yd).

## B3 More fibres, finer, ragged

640 strands (was 480) at 3.0 mm tapering to 1.6 mm (was 3.8/2.6), four segments
instead of three so the drape curves rather than kinks, and each strand cut to
its own length within ±18% so the hem is ragged instead of machined. Still one
instanced draw call per segment index: **4 calls**.

## B5 Phase 4 — adversarial verification, and the part I did not get right

Photographed at the default player camera with the mop equipped through the
player's own gesture (`qa/electron/b-tool-photos/`). Two faults appeared in the
frames that **no simulation test could have caught**, which is the whole reason
the brief demands a picture:

1. On a strafe reversal the yarn whipped **clean above its own collar** — mean
   tip height +0.101 in the head's frame, every tip above the anchor.
2. A planted head splayed so hard it read as a flat disc rather than a bundle.

Both are physical, so the fix was physical: wet cotton is heavy and damps fast.
Gravity 11 → 19, damping 0.90 → 0.865, buckle 0.55 → 0.30. The whip came down to
+0.047 and the plant kept its volume.

**And then the honest part. The mop still does not look like a mop.** At the
player camera it reads as a small, sparse, wispy fan — closer to a feather
duster than wet yarn. The solver is doing its job (the spread on planting, the
trail on the strafe and the whip on the reversal are all clearly visible in the
frames), but three things about the *appearance* are wrong and I did not fix
them:

- the head is small — 0.115 yd of radius is about 10 cm, where a real mop head
  splays to nearer 30
- at 3.4 mm the fibres read as hair or wire rather than rope, even at 820 of them
- the pale grey against a dark interior makes the whole head read as a ghost

Raising the count from 640 to 820 and the fibre from 3.0 to 3.4 mm helped and did
not solve it. **This goes on NOT DONE with the photographs**, because the
45-minute rule fired and because another round of guessing at density is exactly
the loop this tool has been stuck in for six attempts. What is different now is
that the physics underneath is real and tested, so the remaining work is a
modelling question — head size, fibre thickness, material — and not a motion
question.

**The broom's numbers in this run are uninformative and I am not claiming
anything from them.** Its bristles are laid out as a symmetric bar, so the MEAN
tip position cancels to zero by construction — which is exactly what the run
reported (meanX 0.00000, identical to five decimal places across idle, strafe
and reversal). That is a property of the statistic, not evidence that the broom
is frozen. Measuring the broom needs a per-strand variance, which it did not get.

## B6 Found while here: the mop's wetness was painting an invisible mesh

`setMopDamp` tints every mesh matching `/skirt/i`. `MESH_MopSkirt` has been
**hidden** since Goal 19 E1 — the player sees the procedural fibres — so for as
long as the skirt has been invisible the damp-darkening has been applied to a
mesh nobody renders. Exactly the fault E1 was: the right material, the wrong
mesh. The visible yarn is tinted now too.

---

# D3 — THE CHECKOUT TABLE'S NUMERIC COLUMNS

Image 1 shows `1$279.00`. The cause is arithmetic, not taste: `drawItemRows`
right-aligned Price, Unit and Total at three hard-coded x positions (476, 530,
604). A total is drawn at 20 px bold, so `$279.00` is about 78 px wide and starts
near x=526 — **four pixels inside the unit column's right edge at 530**. A bigger
total starts further left, so the fault was going to get worse with every sale.

Every numeric column is now as wide as the widest thing in it, its own header
included, laid out right-to-left with a guaranteed 18 px gap. Headers are
right-aligned over their columns, which is what a numeric header has to be if it
is to stay over the figures beneath it. `summaryRow()` thirty lines below already
knew this ("sizing them independently is what printed CHANGE D$21.78"); the
lesson had never reached the table.

**Why the existing overlap detector missed it.** This screen already has a rect
audit (`MONITOR_OVERLAPS`) and a sweep that renders every screen and pairs any
two intersecting text rects. It reported clean. The reason is in the fixtures:
**all three checkout models in the sweep omit `items`**, so every one of them
rendered the empty "Waiting for products" state and the sweep has never once
drawn the item table. The recorder was right; it was never given the input. Added
a checkout fixture with four rows, including a $1,249.95 total and a 12-unit
quantity.

---

# RUNNING LISTS

## UNCONFIRMED

- **D3 — proven by the rect sweep, not yet photographed on the in-world screen.**
- **B2 motion at the player camera.** The spread, trail and whip are visible in
  the frames and the solver is tested, but "does it FEEL like a mop in the hand"
  is a judgement only the owner can make, and the appearance problem below may be
  loud enough to drown it.

## NOT DONE

- **B3 — the mop still does not look like a mop** (`qa/electron/b-tool-photos/
  mop-planted.png`, `mop-reversed.png`). Sparse, wispy, ghost-pale. Three
  candidate causes named in B5: head radius too small, fibre too thin to read as
  rope, material too pale for a dark room. Stopped at the 45-minute rule rather
  than guess at density a seventh time.
- **B1 point 1 — the head-plant.** The research finding is that House Flipper's
  mop reads as one object because its head is welded to the floor plane through
  the whole stroke, while ours swings on an arc. That is a head-pose question in
  `broomViewmodel`, not a strand question, and it is untouched.
- **B4 — the broom's head is still sideways.** Not started; the section's time
  went to the solver, and the run that would have diagnosed it produced only the
  uninformative symmetric-bar statistic described in B5.

## VERIFIER FINDINGS STILL OPEN

Verifier 3 (the stranger) played 27 minutes, 110 commands, from the main menu
having read nothing. It used the `qa inside` concession once and recorded it, and
it makes no sound claims because screenshots carry no audio. Full write-up in
`Designs/ProShop/verifier3_goal20.md`. Worst first:

1. **A new player cannot get past the porch.** The door demands "clear the
   entrance and wash the porch"; the washer produced no visible water or feedback
   on five attempts, and X/E on the threshold debris gave no pickup, no prompt
   and no refusal message. Fifteen minutes, zero progress, zero corrective
   feedback. (Caveat it states itself: its rig cannot hold LMB. Silence on a
   wrong input is still the failure.) **This is the most serious finding of the
   night — it is a hard progression wall on the first screen of the game.**
2. "Milestone — Serve the first business day — COMPLETE" fires the instant the
   shop opens, before anyone has been served.
3. Large blank untextured surfaces dominate the shop interior — grey slab panels
   behind and floating above the counter, a featureless brown wall filling half
   the frame from the desk. Reads as missing assets.
4. **Q is overloaded**: it pulses the dirt overlay AND silently swaps the held
   tool away. The washer vanished with no message and took two unexplained F
   presses to recover, because one F-cycle slot is empty hands with no feedback.
5. The tee desk's first prompt named the wrong person — "E serve Chip Lambros"
   opened Lena Rhodes' checkout.
6. "Click each product once to ring it up" is untrue: the first click physically
   shoves the item, and the shove wedged a scorecard under the bag box.
7. Rain renders through the covered porch roof as white streaks hanging from the
   ceiling; stray white wedge artifacts at frame edges outside.
8. Between guests the register resets to CHECKOUT/"No customer" while a check-in
   guest stands at the desk, leaving the player to guess the CHECK IN tab.
9. The change-drawer camera keeps animating after "the drawer is opening" and
   swallows clicks made during the slide.
10. The Q dirt-reveal is a pulse of flat blue/yellow squares floating over walls
    and door glass rather than lying on surfaces.
11. Customers are clone-stamped (same head, two cap colours) on visible grey base
    plates like miniatures; the guest being served faces away from the till.
12. An empty outlined box sits in the main menu's bottom-right corner; Chip's
    not-arrived state shows a greyed "CHECK IN · CARD" with a truncated
    "WAITING FOR ..." badge.

What it praised, which is worth as much: boot is ~6 s to menu and ~7 s into the
world with a progress bar and a real tip; the Relaxed/Realistic dialog is honest;
gaze text is consistently helpful; hold-F's labelled tool radial is "the moment
the tool system finally made sense"; and **the whole front-desk loop** — honest
unavailability negotiation with a nearest-slot offer, correct arithmetic
($16 + 7% = $17.12), the tactile denomination drawer with SHORT BY / EXACT
CHANGE, and a graceful anti-stuck recovery with the toast "Stepped you back to
where you last had room."

It never reached the retail floor, the broom or the ledger: finding 1 consumed
the session. That is itself the finding.

## FIXED BUT NOT ASKED FOR

- The free-play bridge's `sweep` (A3) — not in the brief, but it invalidates the
  verifier the brief puts first.
- The mop's wetness tint, which was being applied to a hidden mesh (B4 above).
- The cursor watcher's own DPI fault (A4), found by its negative control.

## REPORTED DONE PREVIOUSLY, FOUND FALSE

1. **"Stranger verifiers looked around the room."** Three sessions' worth of
   camera sweeps produced zero net rotation, because the bridge's own sweep
   helper moved out and straight back every step. The check that "passed" was
   the absence of an error from `page.mouse.move` — never a measured yaw delta.
   Found in A3, fixed in `tools/qa/electron-freeplay-bridge.js`.

2. **"The front desk screen has an overlap detector and it is clean."** It does
   have one, it is correctly written, and it has a planted-overlap control of its
   own that passes. It reported clean while the screen printed `1$279.00`
   because **all three of its checkout fixtures omit `items`**, so every one
   rendered the empty "Waiting for products" state and the item table was never
   drawn. The check that passed measured a screen that says "waiting". Found in
   D3; fixture added, and the sweep now fails on the old column positions
   (watched: `not ok 4 - no front-desk monitor screen draws text over its own
   text`) and passes on the new ones.

3. **"The mop's yarn trails when you carry it" (Goal 19, E4).** E4 added a carry
   drive from the head's world delta and measured tip travel afterwards. With
   that signal absent — which is every code path that does not compute and pass
   it — the measured tip offset while sliding the head across the room is
   **0.000000 yd**. The yarn was welded, and the fix was a fourth input to a
   filter rather than a physical cause. Measured in B2 by
   `tools/qa/mop-rig-control.mjs`.

4. **"The mop reads as damp when it holds water."** `setMopDamp` has been tinting
   `MESH_MopSkirt`, hidden since Goal 19 E1, for as long as the skirt has been
   hidden. The player-visible yarn was never touched. Same shape as E1 itself.
