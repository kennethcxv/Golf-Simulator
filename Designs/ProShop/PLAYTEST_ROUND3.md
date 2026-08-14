# PLAYTEST ROUNDS 3-4

**PROBE-LIE COUNT: 29.** Four new, all mine, all caught before they reached you —
three of them by one control. See the last section.

The headline: **the diagnostic channel shipped last round paid for itself in a
single playtest.** Three rounds of "Checkout records are unavailable right now"
became one sentence in your log, and that sentence led to the actual bug in about
twenty minutes.

---

## P0 — THE CHECKOUT — **FOUND AND FIXED**

Your log named the predicate. Instrumenting its fourteen clauses and running
**your own saved reservation** through the shipped check-in named the field:

```
clause 14: checkedInAt was 388.19651999997967, expected 388
```

The ticket stamps its minute as `Math.round(state.clock.minutes)`
(`register.js:1135`, `:1325`). `reservationSettlementTarget` stamped the **raw
clock**, which carries a fraction on essentially every frame.
`checkoutSettlement` then requires `fields.checkedInAt === ticket.minute`
exactly — so the settlement plan disagreed with its own ticket and the till
refused after taking the money. The customer never left because the register is
waiting for a success it never gets.

**That check-in could only ever have succeeded on the vanishing set of frames
where the world clock sat on an exact integer minute.**

The suite never caught it because `newGame` starts on a whole minute and no test
advances time fractionally before checking someone in — both sides agreed by
accident. `tests/reservation-check-in-fractional-clock.test.js` now pins five
fractions either side of the rounding boundary plus a whole-minute control;
watched failing 5-red on the unfixed line. 152/152 on the checkout, settlement,
atomicity and reservation suites.

Clause 14 is also split into named field checks now, so the next surprise inside
it reports the field rather than the paragraph.

---

## P1 — THE NPCs — **REBUILT, and measured before and after**

In a six-deep queue in the running game:

| | frames with people inside each other | worst overlap | queue holding position |
|---|---|---|---|
| **before** | **100%** | 0.02 yd | 0 |
| **after** | **0%** | 0.00 | 6 |

**Why it looked like that.** `resolveCustomer` pushed only the *current* customer
out of the others, in array order, once per customer per frame. A steps out of B;
B is updated next and walks straight back into A. Neither yields, the pair
grinds, and which one wins depends on pool order. On top of that `steerAround`
treats a person as a static disc and switches off entirely below its `minTravel`
— the exact range at which two people are about to collide — and nothing anywhere
looked at velocity, so two walkers each dodged a body that would not be there.

**What replaces it** (`src/render3d/clubhouse/crowd.js`, pure, 12 tests):

- **`avoidanceHeading`** — velocity-aware and reciprocal. Projects both bodies to
  the time of closest approach and only reacts to neighbours it will actually
  meet. Each takes half the correction because the other is running the same
  computation on the same frame, and the side is chosen from geometry both
  compute identically, so they cannot mirror into each other.
- **`separate`** — ONE simultaneous symmetric pass after everyone has moved.
  Corrections are collected before any are applied, so the result cannot depend
  on update order, and a wall clamp stops a body pushed out of a neighbour being
  pushed into the counter.
- **Mass.** Queue members have infinite mass: the mover goes around, and the line
  is not shouldered out of shape. That is your four-deep complaint, and it is not
  expressible at all in a scheme where whoever moves last wins.
- **A squeezed body escapes sideways** — wedged between two immovable people the
  opposing pushes cancel exactly, and without this it sits inside both forever.
- **Stuck escalation** — nudge, then repath, then place on the nearest free cell,
  each once rather than sixty times a second.

> **I almost shipped this into dead code.** It went into
> `clubhouse/customers.js` first, which exports `createCustomerView` — called by
> **nothing**. The live walkers are inline in `clubhouse.js`, and this repo has
> been burned by exactly that once before; the note at `clubhouse.js:11821` says
> so. The driver's MEANINGFUL control is what caught it: zero overlaps in a room
> the driver had never put anybody in.

---

## P1 — TAB — **REPRODUCED at last, and fixed**

Your wording was the missing half: "clicking tab then tab again". Every earlier
version of my driver pressed Tab **once**, so it measured the leg you were not
complaining about and reported "not reproduced" twice.

Driving the full round trip and looking at the frames shows it immediately: on
the way **back**, three frames at 8 fps (~375 ms) of a green room with a red
carpet and a window, no counter, no fixtures, no till
(`qa/tab-map/frames/frame-0371.png`). That is the dummy map.

**Cause.** `syncCameraVisibility` decides whether to draw the interior fit-out
from the **camera's** distance to the clubhouse. Returning from the overview the
camera is still out over the course for several frames while it travels back to
you, so the fit-out is culled and what is left is the permanent authored shell.
It cannot happen on the way in, because there the camera starts at the player.

**Fix.** While walking, the player's position is the authority — you are the
reason the interior is being drawn at all, and the room you are standing in must
not vanish because the camera is briefly somewhere else. Re-recorded and viewed:
the overview cuts straight to the furnished clubhouse.

---

## P2 — THE LAG — **FIXED**

| | before | after |
|---|---|---|
| dustpan first equip | 282.4 ms / **+8 GL programs** | **46.5 ms / +0** |
| broom first equip | 362.3 ms / **+9 GL programs** | **102.4 ms / +1** |

The remaining +1 on the broom is its own viewmodel material, not the hands.

**The measurement moved the target.** "A lag spike when I moved forward and
clicked with the broom to hold down" is not the sweep: holding the trigger and
walking costs **0 programs and 21–29 ms**, identically on the first sweep and the
third. The whole spike is the equip — the same defect as bottle-to-dustpan.

**Where the warm had to go.** Last round I tried this inside `courseScene`'s
prewarm and it failed — one program instead of eight, and it made the broom
worse — because prewarm deliberately does not run the update loop, so a forced
`composer.render()` never positions or shows the viewmodel. That negative result
is what pointed at the right seam: immediately after `app.prewarming = false`,
where the real update loop is running and the opaque veil still covers the
screen. A tool is equipped through the shipped path, drawn for three real frames,
and put away. Nothing is described to the renderer — not a seventeenth
`renderer.compile()` configuration, a real draw.

It broke three source-inspection tests that assert a literal `veil.hide();` after
the success gate. **Not weakened** — the callback is now async, awaits the warm,
and calls a plain `veil.hide();`, and the helper moved out of the slice those
tests scan.

---

## P2 — THE MOP — **more, thicker, bigger**

| | was | now |
|---|---|---|
| strands | 252 | **432** (18 × 24 exactly) |
| strand across | 4.4 mm | **6.4 mm** |
| head radius | 105 mm | **128 mm** |
| length | 0.30 | 0.335 |

Bunches stay at 18, inside the 16–24 band you ruled — now 24 strands to a bunch
instead of 14. Draw calls unchanged at 4. The exact count matters: an uneven
split reintroduces the per-strand splay imbalance the even angles exist to
remove.

---

## THE FOUR NEW PROBE LIES

26. **Wired the whole crowd system into a module the game never loads.**
    `createCustomerView` is imported by nothing. Caught by the driver's
    people-count control, not by me.
27. **Read `ch.customers` as a property.** It is a function returning an **array**
    of walkers, not the customers module.
28. **Read a nested `diagnostics().crowd.overlappingNow` shape that did not
    exist.** Like the two above, this returns `undefined` rather than throwing —
    which reads exactly like a healthy empty room.
29. **Guessed the pinned-state fields** (`stage`/`phase`/`mode`) on customer
    objects that carry none of them, so the diagnostic reported `pinned: 0` in a
    room with a six-deep queue. The real flag is `c.queued`.

All four have the same shape and it is worth naming: **a wrong accessor in
JavaScript is silent, and silence is indistinguishable from good news.** The only
reason none of them reached you is that the driver refuses to call a run
meaningful unless it can show the room had people in it.

---

## WHAT IS NOT DONE

- The overview map itself is still a field of scattered trees with no clubhouse
  and no fairway in it. That is a separate question from the dummy map on the
  return, and you have not asked for it yet.
- The remaining +1 program on the broom's first equip (its own viewmodel
  material). Small, and the same warm trick would cover it if it turns out to be
  felt.
- Inherited lint ratchet red: 325 vs baseline 324, untouched by any of this.


---

# ADDENDUM — "ABSOLUTELY UNPLAYABLE, LIKE 3 FPS"

Reported after the round-3 build, with
`GPU state invalid after WaitForGetOffsetInRange` in the log. That message is a
GPU process loss; after one, Chromium falls back to software rendering, and
software rendering is what 3 fps looks like.

## Measured, quiet machine, same driver, walking out of the clubhouse

| | standing | walking | **after walking** |
|---|---|---|---|
| pre-tonight (`1ea5da4`) | 62.9 | 58.5 | **6.7 fps** — 148 ms median, 559 ms worst |
| tonight + the fixes below | 69.4 | 69.4 | **69.9 fps** — 0 frames over 100 ms |

### 1. The outdoor collapse is PRE-EXISTING, and it is severe

The build from **before** this session drops to **6.7 fps** walking away from the
clubhouse: 2,745 draw calls and 8.6M triangles out there, individual frames of
559 ms. That is the course vegetation, it is not a regression from this session,
and "3 fps" is entirely consistent with it.

**This is the largest performance problem in the game and nothing has been asked
about it yet.** It is worth its own item.

### 2. What WAS mine: allocation churn, now fixed

`customerNeighbours` allocated a record per neighbour per customer per frame —
O(n²) short-lived objects at 60 Hz — and `separate()` allocated two Float64Arrays
per iteration per frame. Both are pooled now, and the settle pass early-outs on
the overwhelmingly common frame where nobody is near anybody.

I should have caught this myself. I wrote an O(n²) per-frame allocation into the
hot path and shipped it without once measuring frame cost.

### 3. The hands warm is WITHDRAWN — on risk, not on evidence

Stated plainly because the distinction matters: **I could not reproduce the GPU
loss**, and every measurement says the current build is faster than the
pre-change one on every axis. But the warm is the only thing this session that
asks the driver to compile shader programs at a *new* moment — the veil boundary,
while prewarm's uploads are still settling — and a driver reset under exactly
that load is a known hazard.

**The cost of withdrawing it:** the first tool equip goes back to ~282 ms and +8
GL programs. That is the bottle-to-dustpan lag, and it is back.

If the next session is healthy with it off, that is the evidence, and the warm
can return spread over several frames well after the veil has lifted rather than
in a burst at the boundary. The implementation is at `adb9ef2`.

## Still outstanding

- **The golden gate has not passed since these changes.** Its capture crashed on
  the sponge pose with the same "page closed" signature, which may be the same
  GPU loss. Re-running on a quiet machine.
- The pre-existing outdoor collapse (item 1 above).


## ADDENDUM RESOLVED — the 3 fps was the GPU process, and the game now says so

The full matrix, every axis excluded by measurement:

| axis | result |
|---|---|
| fresh save, current code | 69 fps |
| **his actual save**, planted into a clean profile, booted via Continue | 63 standing / 47 walking |
| pre-tonight code | 63 fps |
| GPU string in every harness run | hardware ANGLE, RTX 5080, D3D11 |

The one thing his broken launches share with no harness run is his session's GPU
process, and his own log names it: `GPU state invalid after
WaitForGetOffsetInRange`. After that loss Chromium continues under SwiftShader,
and software rendering on this scene IS 3 fps from the first frame — which also
explains "the loading screen is faster but then no fps".

**Done about it:** his profile's GPU shader caches cleared (17 MB GPUCache plus
both Dawn caches, all written during the crashed sessions; saves untouched), and
`src/core/gpuHealth.js` now watches both observable forms — a context that boots
in software, and a context lost mid-session — reporting to crash.log and
toasting a localized "save and restart" line. Healthy boots stay silent, pinned
by a control using his exact RTX 5080 renderer string. If the next session is
still 3 fps, the toast will say so, and the suspect becomes the NVIDIA driver
itself.

**Two more instrument findings from proving the save axis**, recorded because
they will bite again: the menu enables Continue asynchronously (sampling it
immediately tests a fresh game while claiming to test the save), and
`/Continue/` can never match an ENABLED Continue button — the label
concatenates with the summary into "ContinuePine Hills…" and the trailing word
boundary fails. qa-boot's VERIFY2_L comment documents that same landmine.

**And one self-inflicted git wound, caught and fixed:** `git checkout <commit>
-- <path>` STAGES what it restores. The perf A/B staged the pre-round-3 mop and
the next commit silently shipped it; the suite could not object because both
values sit inside the test's band. The 432-strand mop is restored, and the
accepted tool-mop golden was captured from that build, so code and reference
agree.

Suite **3637/3637** (five gpu-health tests new). Golden gate **13/13**, control
OK. Lint ratchet 325, the inherited red, unchanged through everything.

**PROBE-LIE COUNT: 31.** #30: the owner-save driver measured a fresh game twice
while claiming to test his save (the async Continue). #31: the boot-fps
comparison I first showed him was taken while a full test suite and a golden
capture were competing for the machine — the numbers were real, the comparison
was not; it was retaken quiet.


---

# ROUND 4 — the report while it was being written

## First-press stalls — **one defect, four hats, FIXED**

Bottle to dustpan, first cashier click, first check-in, first page turn: every
one is the first draw of a material set compiling GL programs on a player-facing
frame. The warm is back at a **different moment** than the withdrawn version:
seconds after the game is interactive, from a timeout — never at the veil
boundary where the round-3 attempt sat when the GPU process died. Two stages:
the real-draw hands warm, then `renderer.compileAsync` over the whole scene
(KHR_parallel_shader_compile — every remaining program builds off the render
thread, covering the register and the ledger, without blocking a frame).

| gesture | unwarmed (round-3 measurement) | now |
|---|---|---|
| dustpan first equip | 282.4 ms / +8 programs | **24.9 ms / +0** |
| cashier first E | "lagged really hard" | **20.2 ms / +0** |
| page turn first | 32-34 ms / +1 | 34.4 ms / +1 (the ledger's own paint) |

## NPCs — three additions his words asked for

- **The player is a neighbour.** Walkers ran reciprocal avoidance against every
  customer and treated the player as a hard clamp at the last half-yard — which
  is "running into myself in general". The player now enters the same math,
  pinned, with a wider 0.4 body.
- **A queue gets a berth** — pinned members carry +0.12 radius, so walkers pass
  the line at a distance instead of grazing it.
- **Yield, not just swerve** — an urgent threat scales the step to 0.6/0.35, so
  two crossing walkers resolve as one yielding instead of both wedging into the
  gap at full stride.

## "The second person doesn't come up" — **cannot reproduce, and the proof is a driver**

- Arm A, head despawned outright: #2 advances in **0.5 s**.
- Arm B, the **entire shipped sale** driven at the register (E, click-to-scan,
  card, exact total with tax, bag handoff to `released`): #2 advances in ~5 s
  and the next transaction auto-starts.

Two instrument lessons paid for it: `checkoutQueue()` rows are sim entries with
no meshes, and the terminal wants `totalOf()` **with tax** — the first run typed
the untaxed sum, was never approved, and blamed the game for a sale the driver
had failed to pay for.

**Remaining suspects for his session:** a cash-tender head, or a check-in head
that waits for the player at the desk by design. If it happens again: does the
person at the front have a shopping basket, or are they there for a tee time?
