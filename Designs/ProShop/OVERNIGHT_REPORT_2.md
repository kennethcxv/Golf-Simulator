# Overnight session 2 — report

Ranked by what you should read first, not by item number. Rough durations at the
end of each entry.

Branch `feature/pro-shop-vertical-slice`. Full suite green before every commit;
final **2503 pass / 0 fail**.

---

## 1. You pre-authorized a fix that would have made things worse. I did not apply it. ⚠️

**TILL-REACH-001. You wrote: "approved. Pick the cheapest of your three options
that gives a genuinely walkable route behind the counter."** All three options
were changes to the v2 floor plan, and all three rested on a diagnosis that was
wrong.

**The desk was never the problem.** FLOOR_PLAN §7 already specifies the route —
*office → corridor mouth at (5.65, 4.3) → till*. The probe that produced the
original diagnosis flooded only `PUBLIC_ROOM_BOUNDS`, whose east edge is x 5.70,
so the corridor's one designed entrance lay **outside the grid**. The instrument
had walled off the doorway and then reported the room sealed.

Two further faults in the same flood fill, each of which alone would have
produced a confident wrong answer:

- **A closed door counted as a wall.** `walk.isFree()` answers "can I stand here
  now", not "is there a route". Every interior door collides while shut, so the
  office, the stockroom and the corridor all read as sealed rooms.
- **The grid stopped at the building**, so it could not represent "out the front
  and round the back" — it could not tell an inconvenient route from no route.

**What was actually wrong: a hand truck.** The collision sweep I ran last session
gave hulls to eleven props that declared collision and had never had it. Two of
them stand either side of the lane through the stock door:

| | hull | |
|---|---|---|
| mop / brooms corner | x 5.75 → 6.45 | |
| hand truck | x 6.90 → 7.54 | **moved** |
| east rack | x 8.14 → 8.76 | |

Mop-to-truck **0.45 yd**. Truck-to-rack **0.60 yd**. The player is **0.68**. That
single pinch cut off the office, the staff corridor and the staff side of the
till. The hand truck's own comment read *"remains reachable without narrowing the
door lane"* — true while it had no collider, false the moment it got one.

The truck now parks against the west partition. One clean **0.84-yd** lane at
x 6.96–7.80, lined up with the door's own opening. **No floor-plan change. No
seal reopened** — and options 1 and 2 from the original list would both have
reopened the anti-tunnelling seals added on 2026-07-28, re-introducing the
measured customer-body-shove bug.

Measured after: `staffStandIsReachable` **true**; the only unreachable region in
the whole building is the 53.08 yd² dead cavity behind v2's pulled-in west wall,
which the layout declares sealed until the shell is re-authored.

**The general lesson, and it is the useful one.** The collision sweep had a
whitelist-or-fail test for *which props own a collider*. It had nothing that
asked whether the building was still walkable afterwards. **Adding collision is a
navigation change.** The reachability assertion you asked for now exists in two
forms: `STOCK_LANE_CLEARWAY` joins `CLEARWAYS` (so the three systems that already
refuse to place things in a doorway refuse this route for free, and the clutter
seeder is clamped out of it exhaustively over its jitter box), and the audit no
longer checks one point — it groups every unreached free cell into connected
components and fails on any pocket ≥ 0.25 yd² not on a declared allow-list.

*~2h, most of it instrument correction.*

---

## 2. Section 3 is two items of ten. This is the session's biggest gap. ⚠️

You called checkout physicality "the largest piece, treat it as the session's
core". I delivered the two items you yourself separated out as *"things that
break the rhythm"*, and **not the eight presentation items**.

**Done:**

- **A completed transaction clears away.** It now clears itself after a
  five-second hold, and does not need dismissing.
- **Serving the next customer is seamless.** These were one bug:
  `checkoutActions()` offered exactly ONE control after a sale — "Return to
  Shop" — so the receipt sat there until you left the station, and leaving the
  station was therefore the only route to the next person. One line, both
  symptoms.

**Not done, with what each needs:**

| item | what it needs |
|---|---|
| PIN on the card reader, camera derived from its bounding box | a new pose in `registerCameraPoses.js` + an ease; the pose must be *derived*, not authored, per §5's datum rule |
| scanner visibly scans through its five phases | the phase machine already exists and is pure (`checkoutScanPresentation.js`); what is missing is the item's motion being driven from `phaseT` |
| receipt visibly prints | `printerPaper` exists and is toggled visible; needs a travel animation and the sound on emergence |
| cash/card handoff seeable | this is a camera problem, not an animation one — it currently occupies the whole left of frame |
| bag upright, items parented to it | parenting is the real work; the bag is currently a drop target, not a container |
| price tags at stocking time, parented to the item | they spawn at checkout today; moving them to stocking touches `stocking.js` and the catalogue proxy |
| oversized items staged rather than balanced on the desk | needs a decision from you: scale, lay on side, or stage beside the counter |
| tray collider matching its visual | contained and measurable; the closest of the eight to a quick win |

**Why I stopped rather than pushed on.** Your own standing rule this session:
*"where a fix is presentation, verify it by looking at the rendered result, not by
asserting on state."* Eight presentation changes in a 6,792-line driver, made
overnight without a visual check on each, is exactly the work that rule forbids.
I would rather hand you two verified items and an honest list than ten
unverified edits.

*~1h.*

---

## 3. The input fix — and why the first one could never have worked

Your diagnosis was right about the mechanism and I want to be precise about why
the previous fix failed. **Reconciling on keydown cannot recover from the case it
was written for**: a stranded Meta turns D into Win+D, the OS consumes it, and
the keydown the reconcile was waiting for is the one the fault prevents. The page
sits in the phantom state while you press D and nothing happens.

So reconciliation now runs from **every event carrying `getModifierState`** —
mousemove above all, because looking around is the input a player produces
constantly without deciding to. Pointer and wheel events too.

**The interval backstop cannot reconcile, and I did not pretend it could.** A
timer carries no event, so there is no modifier state to ask for. What it *can*
settle is the precondition: `document.hasFocus()`, polled, because blur is not
guaranteed when focus moves to browser chrome.

**Negative control, run before trusting anything:** with the mousemove reconcile
removed, the W/A/S/D sweep stays **8/8 green** while the three new checks go red
in both variants — exactly the blind spot. Restored: **24/24**.

**"W reloading the page" is the half no page code can repair.** Nothing in `src/`
calls `location.reload`, so the browser was acting on a real Ctrl held below it.
Two answers shipped: `preventDefault` on the walk keys while pointer-locked, and
a **HUD chip** showing what the walk controller believes is held. Shift renders
plainly — holding it to run is normal, and a chip that lit every sprint would
train you to ignore it. Ctrl/Alt/Meta render as an alert, because the walker
binds none of them and any of the three being down *is* the fault.

**Honest limit:** `preventDefault` stops the page-level default and any shortcut
the browser lets a page claim. It **cannot** stop a browser-reserved chord —
Ctrl+W, Ctrl+T, Ctrl+N in Chrome. The only thing that can is the Keyboard Lock
API, which needs fullscreen and turns Escape into a press-and-hold. I did not
ship that: trapping you in the window overnight to fix a modifier that should not
be stuck is the wrong trade. Say the word and it is ~10 lines.

*~1h.*

---

## 4. The dark state — approved, implemented, and one result nobody predicted

Option A, hemisphere only, scale **0.40**, blended over 1.5 yd at the threshold,
applied as the **last statement of `applyTimeWeather`** (it runs every frame and
assigns `hemi.intensity` unconditionally in all three branches; anything scaling
it elsewhere is undone before the next render).

| | in-room mean | vs control | p3 ceiling band | nav-band contrast |
|---|---|---|---|---|
| 1.00 (control) | 107.66 | — | 85.35 | 39.8 |
| **0.40 (shipped)** | **87.07** | **−19.1%** | 56.13 | **50.5** |
| 0.20 | 78.47 | −27.1% | 43.89 | 55.3 |

**The contrast goes UP.** Nav-band contrast rises 39.8 → 50.5 as the fill falls,
because what is being removed is flat, unoccluded, everywhere-equal irradiance.
Your complaint was that the room reads flat, not only that it reads bright — this
addresses the flatness directly rather than as a side effect. Neither legibility
floor binds at any scale swept, so 0.40 is chosen for level and contrast, not
against a limit.

**The course is untouched, checked at the mechanism** rather than through the
image: outside, the indoorness factor is 0 and the hemisphere carries 0.9 at
every scale, identical to the control.

**The proposal's own §5 prediction was wrong**, and the correction is instructive:
it averaged in the doorway pose it had *already established* was 7.8%
fill-driven, and so predicted a number the change was never going to reach.
Excluding that pose, the three genuinely-interior poses land at 87.07 — the
"mid-80s" §5 meant.

*~1h.*

---

## 5. Boxes: three presses, and the cutter retires

Look at a box, press E — the tape tears and half the lid lifts. Press E — the
other half. Press E — an armful comes out into your hands. No tool, no drag, no
aiming.

The tape does not get its own press: tearing it and lifting the first flap is one
motion for a person. Two flap phases instead of three, each a main flap plus the
side flap beside it, so **every press moves something visible** — the old middle
phase opened one small side flap and read as nothing happening.

`nextBoxStep` is both what the prompt renders and what the action dispatches on,
so a prompt naming a step you cannot take stops being expressible.

**THE BOX CUTTER AS AN ITEM: it retires, without being deleted.** It was never in
the tool wheel. The only way to hold one was for a prop to ask for it through the
`tool` getter, and no prop asks any more — so it cannot be equipped. The
viewmodel and held-model machinery stay in `courseScene.js`, now unreachable.
Deleting ~200 lines across a hot shared file is its own change and I did not
smuggle it into this one. **Flagging it as a follow-up.**

Verified live: the probe stands the player in front of a carton and presses the
real E key three times, requiring each prompt to name the press about to be made.
Measured: *"tear the tape open"* → *"open the other flap"* → *"take an armful"*,
tool `null` at every step.

*~1h15.*

---

## 6. Time — SIM-TIME-001 fixed; the day length is measured below

The ruled split, implemented. **Decisions** scale with the game clock (browse
dwell, organic arrival rolls, patience); **locomotion** stays wall-rate capped at
4×; full dt scaling stays rejected — at 16× a 1.4 yd/s customer covers 0.37 yd
per frame against a 0.32-yd body radius and tunnels, the exact class the corridor
seals just closed.

The arrival roll was the single biggest contributor to the empty fast-forward
shop: it fired on wall time, so a 16× game hour rolled 1/16th as many times as a
1× one.

Animation is not a decision and stays on wall dt: character rigs, the impatient
beat, the bag-acceptance hold. Scaling those makes choreography unreadable at
speed and buys nothing, since none of them gate throughput.

The multiplier is pushed from the frame loop **every frame** rather than on the
speed control, because pause/resume, the editor, the pause menu and the golf-day
presentation all move `speedIdx` from different places, and any one of them
forgetting would put the shop back where it was.

### The fix, measured

Same protocol as the ruling run: one game hour from 10:00, restored room, ten
scripted spawns, fresh boot per leg.

| speed | visits completed BEFORE | visits completed AFTER |
|---|---|---|
| 16× | **0 of 10** | **10 of 11** |
| 4× | **0 of 11** | **11 of 12** |
| 1× | 10 of 11 | 9 of 10 |

Fast-forward went from *nobody finishes a visit* to *the shop runs*. The 1× leg
is unchanged in shape — one customer legitimately mid-visit at the bell, exactly
as the ruling run described it.

Nav blocks still scale with WALL time (587 at 1×, 31 at 4×, 29 at 16×), which is
correct and expected: locomotion is still wall-rate, capped. A 1× shop generates
~20× the pathing work per game-minute that a 16× shop does, so **the standing
consequence in DEFECTS.md holds — trap-geometry claims are still a 1×
measurement.** What changed is throughput, not the physics.

### The day length — proposed, applied, and the ladder had to move with it

**You asked: how many real minutes should pass between placing an order and
stocking it? My answer: 20 to 45.** Long enough to be a wait you plan around,
short enough that the shelf you noticed empty gets filled in the same sitting.

`gameMinutesPerRealSecond` **1/30 → 4/30**. The default game day goes from
**twelve real hours to three**; 45 minutes at the top of the ladder. A standard
one-day lead now lands in ~45 real minutes at top speed and an express order the
same game day, typically 10–20.

**And the speed ladder moved with it, because it had to.** The rungs are
*compressions* of the baseline NPC clock, not abstract numbers. Quartering the
day multiplied every rung by four, so `[0, 1, 4, 16]` would have become 4× / 16×
/ **64×**. Measured at 64×:

| compression | visits completed, one game hour |
|---|---|
| 4× (the new default) | **11 of 12** |
| 16× | **10 of 11** |
| **64×** | **5 of 11** ← |

Past a certain compression the walking simply does not fit in the day: NPC
locomotion is capped at 4× by the ruling (uncapped, bodies tunnel colliders), so
a fast-forward that outruns the cap empties the shop — **the exact defect
SIM-TIME-001 was raised for, re-created by the other route.** I measured that
rather than shipping it.

So the rungs divide by the same four: `speeds` **[0, 1, 4, 16] → [0, 1, 2, 4]**.
Compressions are now 4× / 8× / 16×, days of 3h / 90min / 45min. **The fastest day
is exactly as fast as it was before this change.** What moved is the default,
from twelve real hours to three.

Two things I had to fix on the way, both mine:

- **`simSpeed` was `BALANCE.speeds[idx]` alone**, which does not include the base
  rate. Shortening the day would have sped the clock and left the shoppers
  wall-bound — SIM-TIME-001 arriving by the other door, in the same commit that
  fixed it. It is now the ratio of game time to wall time against
  `npcTimingBaselineGameMinutesPerRealSecond`, so changing the day length carries
  the NPCs with it automatically.
- **The speed-curve harness hard-coded `SPEED_IDX = {1:1, 4:2, 16:3}`.** With the
  new ladder, asking it for "4×" would have set index 2, which is now 2× — the
  harness would have reported the wrong rung's numbers under the right rung's
  name. It now reads the live ladder from the page before labelling anything.

*~1h30 including three full curve runs.*

---

## 7. Section 6 — the rest

**Materials go to inventory.** `purchaseConstructionFinish` did both jobs in one
call — took the money *and* set the finish installed — so ordering vinyl meant
the floor was already vinyl before anyone laid it. Buying now puts the material
in your materials; fitting is the separate, free act, and it already required
ownership. Buying something you already own is refused rather than quietly routed
into an install: a button labelled Buy must not be able to lay a floor.

**Which upgrade types this affects, and which stay automatic — you asked:**

- **Construction finishes** (flooring, ceilings, walls, …) — **affected**.
  Materials with a real placement step that already existed.
- **Decor and fixtures** — already correct; always ordered then placed.
- **UPGRADES** (triplex mowers, spray rig, smart irrigation, premium supplier,
  reciprocal clubs, corporate partners, tournament host) — **stay automatic**.
  These are capabilities, not objects. Buying a deep-tine aerator means the crew
  has one; a "fit the aerator" step would be a menu tax with no gesture behind it.
- **Amenities and staff** — **stay automatic**, same reason.

**Laptop search.** One field over products, upgrades, amenities, materials and
the pages. Your test case exposed a **naming bug rather than a search bug**: the
catalogue calls it "Clubhouse repair components" while the prompt over a broken
fitting says "repair with clubhouse kit". Two names for one object. The entry now
carries the words the game says out loud, and an exact keyword outranks a name
that merely contains the word — so **"kit" returns the repair kit first**, above
the three items with "kit" in their catalogue names.

**Shipping into the cart.** Amazon's shape and for Amazon's reason: the delivery
choice is part of deciding, so it belongs above the button you press. It sat
*under* the total, which meant changing it silently changed a number you had
already scrolled past. Stacked rows, plain-language arrival, the price difference
on the row, and a freight line and total directly above Place Order.

**Door and window furniture joins the collision sweep — and I could not
reproduce "door planks are walkable".** Doors had never been checked by anything
(the orphan pass skips `c.door` outright). Two filters keep the new stage honest:
**height** — a transom above the opening is *supposed* to be walk-through — and
the question asked is *"does this geometry have a collider"*, not *"is the
doorway blocked"*, because an open leaf has swung out of the way and the doorway
is then correctly walkable, which is the door working.

**Result: 96 pieces of door and window furniture across both variants, 0
walkable.** It is catching real geometry — leaves, glass, muntins, sash
mouldings, the window dirt film, and specifically
`MESH_BoardedApertureDamage_DATA`, which *is* the planks. 44 of 48 per variant
carry a collider directly; the remaining 4 have none of their own but sit inside
one, which is correct for trim on a leaf.

So this is a **measured negative, not a fix**: either last session's collision
sweep already closed it, or what you walked through is somewhere this filter does
not reach. If it recurs, the two things that would let me find it are **which
door** and **whether the clubhouse was dilapidated or restored** at the time.

**Laptop location: proposed, not moved**, per your instruction. Full ASCII
diagram and three costed options in `LAPTOP_LOCATION_PROPOSAL.md`.

*~2h.*

---

## 8. Instruments that lied, caught before their output was used

Twelve this month before tonight. **Nine more tonight**, every one caught before
its number reached you:

1. The reachability flood bounded to `PUBLIC_ROOM_BOUNDS` — walled off the
   doorway, then reported the room sealed. *(→ §1)*
2. …the same flood counting a **closed door as a wall**, so three rooms read as
   sealed.
3. …and stopping at the building, so it could not see "round the back".
4. The interior-fill sweep read the **shipped scale after the sweep had
   overwritten it**, reporting the sweep's own last value as the shipped one.
5. …captured frames while **the clock advanced**, so the outdoor control drifted
   with the sun rather than with the change.
6. …compared outdoor frames with **no measured noise floor**, failing on 0.03 of
   GTAO wobble until the noise was measured and the check replaced by an exact
   one at the mechanism.
7. …and its **nav-band legibility floor was measuring the HUD**. The probe hid
   `.hud`; the chips are `.hud-min` and the lock hint is `.shop-lockhint`, which
   sits inside the nav-band crop. White caption text meant the "≥ 6 contrast"
   floor passed on the caption at every scale. **A check that cannot fail is not
   a check** — and only with the overlay hidden does the contrast-rises result in
   §4 appear at all.
8. The walk-input harness's `preventDefault` check **passed vacuously** with
   `pointerLocked: false` — the run never acquired the lock. Skipped checks are
   now counted as skipped rather than folded into the pass tally.
9. The box-gesture probe stood the player at **yaw π, facing away from the
   carton**, focused the laptop behind them and pressed E on it. It now refuses
   to press anything until the carton is what is focused.

Four of these nine (1, 2, 3, 7) would have produced a *confident wrong answer*
rather than an obvious failure. Two of them (1, 2) already had: they are what put
the wrong diagnosis into `DEFECTS.md`.

---

## 9. What needs your decision

1. **Section 3's remaining eight items** — and specifically the oversized-item
   question, which is a design call: scale the presentation, lay it on its side,
   or stage it beside the counter?
2. **Laptop location** — A (leave it) / B-sit / B-stand / C (office). I lean
   **B-stand**: it removes a coupling rather than relocating one.
3. **Keyboard Lock** for the reserved browser chords — worth trapping Escape
   behind a press-and-hold, or not?
4. **The box cutter's ~200 dormant lines** — delete in a dedicated pass, or leave?

## 10. Section 7 (NPC behaviour) — not started, correctly

Your condition was "only start this if sections 1–6 are complete and committed".
Section 3 is two items of ten, so it is not. The before-measurement your CRITICAL
note requires also depends on the speed-curve run in §6, which is still going.
Starting it would have produced exactly the confound you wrote that note to
prevent.
