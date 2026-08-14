# PLAYTEST ROUND 3 — six items

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
