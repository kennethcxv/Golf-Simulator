# OVERNIGHT REPORT 6

Session of 2026-08-03. Ranked by what to read first.

**Everything is done except B6 and part of A8.**

* **Queue A:** A1–A7 complete. A8 got three of its four parts — closer rig,
  readable hands, and the sleeve bug. The hand grip anatomy, the look-up float
  and the tool/surface legibility *feature* are not done (§8, §12).
* **Queue B:** B9, B4, B7, B8 and B11 complete. **B6 is deliberately at zero**,
  per your "all twelve or do zero and say so" (§9).

Every commit ran the full suite green — **2,710 pass / 0 fail** at the last.
Fourteen commits, all pushed to `feature/pro-shop-vertical-slice`.

Two results you should know are *negative* before you read further, because both
contradict the brief's premise and I could not make them say otherwise: **A4 (the
reader phasing through the counter) does not reproduce**, and **B9's target of
under 10 seconds is not reachable** without an architectural change I have costed
rather than attempted.

---

## 1. READ FIRST — the sign was never on screen. It was 360 yards away.

A2 asked which of three things was wrong: tickSpin not called, the E handler
not animating, or the test asserting source text. **None of them.** All three
were clean — the swing is ticked from the clubhouse update, the E verb calls
`applyFacing(true)`, the easing is there.

`clubhouse.js` built a **world** point with `L2W()` and then assigned it as the
group's **interior-local** position. The building offset landed twice, so the
painted card hung at world `(-719.4, 13.5)` while the clubhouse sits at
`(-360, 4)` — **360.02 yards from its own E hotspot**, which took the world
point correctly and stayed on the jamb. It was also mounted off the SHELL wall
*centreline* rather than the interior face, so even at the right coordinates it
sat 0.025 yd inside the wall; `isInside()` agreed it was not in the room.

So: you pressed E on an invisible hotspot, got the toast and the trading gate,
and never saw a card turn, because there was no card to see.

Placement is a named point now (`src/data/shopSignPlacement.js`), taken once and
used in both frames. The turn is **measured** rather than read:
`tools/qa/shop-sign-turn.js` samples the card's world bearing every animation
frame across a real E press — **75 distinct bearings over a π-radian sweep**,
against 1 bearing and 0 travel while idle.

*Evidence: `Baseline/round6/sign-closed.png`, `sign-open.png`, `sign-turn.json`.*

**Worth your attention beyond the fix.** This is the fourth "reported success,
effect absent" — and the pattern behind it is now clear enough to name. Each
time, the thing asserted was *how the code behaves*, and the thing that was
wrong was *where the object is*. A source regex cannot see a coordinate frame.
The two new tests check the point is inside the interior envelope, proud of the
wall, at reading height and clear of the door aperture, and they fail on the old
datum — I reverted it to confirm that rather than assuming.

*~1 h 10 m.*

---

## 2. A1 — the reader was killing sales on a four-second clock

Reproduced first, as asked. `tools/qa/checkout-card-lockout.js` runs the
identical four-item **$300.56** card sale twice and varies exactly one thing:
how long the player takes to click the offered card.

| clicked after | result |
|---|---|
| 400 ms | reaches CardAmountEntry, sale completes |
| 6000 ms | flow already in Recovery; card click, reader X and every other verb refused |

Item count and amount held constant, so **the trigger is time**, not the basket
and not the amount. Two defects, either fatal alone:

**CardInsertReady carried a 4-second machine watchdog on a state that waits for
a human.** The card route used to insert on a timer; when it became "the offered
card waits in the customer's hand until it is clicked" (2026-07-30) the timeout
stayed behind. CardAmountEntry had already been reasoned through the same way.
CardInserting and CardProcessing keep theirs — those really are machine-driven.

**A recovery the renderer could not reconcile parked the flow in Recovery
forever.** `transitionCheckout` permits only the stored resume state out of
Recovery, so the till was dead with a customer still standing at it. It could
not reconcile because CardInsertReady recovers to CardPresented, whose adapter
demanded stage `card-present` while the live stage was `card-ready`.

Both fixed at the cause. The adapter now accepts a card the customer is still
holding out, and a new `abandonCheckoutRecovery` gives an **unauthorized**
checkout a guaranteed way back to the scanned basket. An authorized one is still
refused — that case must reconcile, and dropping a paid customer back to
scanning is the one thing worse than a stuck till.

*~1 h 15 m.*

---

## 3. A3/A4 — the card is in the slot; the glass is a terminal

**The card.** 7.9% of its volume was inside the reader; the rest hung in mid-air
underneath. `0.062` was tuned when the card still drew at world scale — against
the 1.85× reader it seats nothing. The offset is the card's own half-length now,
which puts its top edge on the authored socket inside `Terminal_ChipSlot`.
**Measured back at 30.1%**, and it stays right at any scale.

**The glass.** Four full-bleed gradient bands on a 70 mm screen, with the amount
no bigger than the word above it. Replaced with one dark ground and hierarchy in
the type: quiet status line, small letterspaced eyebrow naming the figure, the
figure dominant on a real margin, hairline, prompt small and muted. Colour
appears once as an accent and never as a background. The old painter is deleted,
not parked beside its replacement.

*Evidence: `Baseline/round6/reader-r10-screen.png`, `reader-r10-closeup.png`.*

**The backspace key — this one I could not fix properly, and did not fake.**
All thirteen keys are reachable by their own centre ray; the yellow key is not
occluded. But it is authored **19% shallower** than a digit key and its cap ends
**within 0.2 mm** of the card-slot lip, which is why it reads squashed. There is
no room on that deck: the bottom key row ends at z=0.002 and the lip starts at
z=0.010, for a key 0.0069 deep. **Giving it real room means editing
`payment_terminal.glb`**, which is hash-gated. That is a Blender job, not a
scene tweak.

**A4 — not reproduced.** The 0.104 yd of "penetration" I first measured was an
AABB artefact: the counter's bounding box spans the bay carved out of it, so a
correctly parked reader reads as permanently inside the wood. Two sound tests —
corner containment by ray parity, and a swept-segment test between consecutive
frames, both against *visible* counter meshes only — find **zero crossings,
before and after**. I filmed the descent too; the reader clears frame in under
400 ms, which is quick enough that "it went through the desk" is a fair
impression of a device that shrinks and drops. I changed the path anyway, since
you asked for it routed and it costs nothing: a quadratic Bezier through a
control point at seat height, so it slides out of the bay, clears the counter
edge, then climbs — and runs the same curve in reverse coming home.

*~1 h 40 m.*

---

## 4. A5 — the status panel is laid out now, not nudged

Outstanding three sessions. The cause: every block in the summary column was a
literal `y` plus hand-added corrections (`choiceOffset`, `taxOffset`), so the
column's height depended on which optional rows happened to be present and
nothing knew where the bottom landed. With a payment choice showing, the action
grid solved to **y=604 with height 38 — 642 on a 640-tall canvas.** The primary
button was six pixels outside its own panel card and two pixels off the bottom
of the screen.

It is measured before it is drawn now. Anchoring the controls to the bottom
padding alone was not enough — that guarantees the margin and not the middle,
and with two stacked buttons the money block solved straight up into the status
card. So the column is budgeted, and when it must give ground it does so in a
stated order: tighter row pitch → tender rows paired two to a line → a one-line
instruction → drop the **least load-bearing** tender row. Dropping the topmost
instead is how CHANGE DUE vanished while SELECTED survived, on the one screen
where you are counting change.

Also: "Ready for the next customer" was rendering as "READY FOR T...", and
"TRANSACTION COMPLETE" as "TRANSACTION COMPLE...". Two or fewer controls take a
row each now, and the status heading shrinks a step before it truncates. A
`DISCOUNT $0.00` row on every single sale was clutter rather than spacing.

*Evidence: `Baseline/round6/status-panel-r10.png` — the three states you named,
side by side. ~1 h 20 m.*

---

## 5. A7 — footfall scales on the club's standing, not on its own output

It **was** scaled, by yesterday's unit sales, and that is the defect rather than
a tuning miss. Units sold is an *output* of footfall, so using it as the input
closes a loop on itself: few customers sell few units, few units bring few
customers, and no move you make breaks out. The default of 2 units resolved to
exactly one shopper.

**The input I chose.** Reputation carries three quarters — it is the existing
"how is this club doing" stock, and critically it is an *integral* of past trade
rather than a mirror of it, so it cannot lock. Cleanliness carries the other
quarter: the term you can move today with a broom, and the reason the cleaning
half of the game exists — but a modifier, because a spotless shop nobody has
heard of should still be quiet. Tier capacity stays the ceiling. Revenue is
deliberately absent as a direct term; reputation already integrates it.

**Measured at 1x**, starter tier, capacity 2:

| shop | reputation | condition | drive | target | peak | mean |
|---|---|---|---|---|---|---|
| low | 25 | 0 | 0.06 | 1 | 1 | 0.92 |
| mid | 55 | 34 | 0.47 | 1 | 1 | 1.00 |
| high | 85 | 47 | 0.82 | 2 | 2 | 1.96 |
| closed (control) | 85 | 47 | — | 0 | 0 | 0 |

The spread is capped by the starter room holding two. The model's own curve at
larger fit-outs: **capacity 4 → 1/2/3, capacity 8 → 1/4/7.**

**NAV-WAIT-001 does not reopen.** Churn gate re-run at 1x with 10 simultaneous
shoppers in both legs: neglected **0 episodes**; restored **1 episode of 12.6 s**
against a 20 s cap, recovery rate **1.00** against a 0.75 floor. Zero red, zero
waived, zero exemptions.

*~1 h 30 m.*

---

## 6. A6 — the bag, and a tolerance that was hiding an error

Life size instead of 0.78, and the counter lift derived from the scale rather
than baked as a literal — which is exactly what the round-5 bag test caught when
the size changed. That catch was worth having: solving
`min.y = COUNTER_TOP + lift − h·flatten·scale` against the test's own reading
gives h = **0.116**, not the 0.101 the constant claimed. At 0.78 the flank was
already sitting **3.4 mm below the counter top** and passing only on the 4 mm
tolerance. It seats 3 mm proud at any scale now.

Kraft at 0.96 roughness is matte to the point of being unlit — a flat brown
cut-out beside the terminal. At 0.86 the laid flank has a gradient across its
width and reads as a bag with a fold.

*Evidence: `Baseline/round6/bag-r10.png`. ~35 m.*

---

## 7. A8 — four of six. This one is bigger than it looks.

**Done and looked at:**

- **Closer.** `gripAnchor` z −0.86 → −0.70. Round 5b spent depth to pull the
  hands off the bottom edge and bought that framing by shrinking everything. The
  aim probe still reports `pointsAtFloor: true`, no ceiling poses, head 0.012
  above the boards at working pitch.
- **Hands that read.** The shared first-person hands are authored at 0.88 for
  tools held at arm's length; gripped at working distance the modelled fingers,
  knuckles and thumb were a pixel or two wide. `fpHands.setHandScale` scales the
  hand *groups* — deliberately not the root, whose position the viewmodel
  subtracts when seating a hand on a solved grip.

**Not done, and I would rather say so than ship a shallow version** (the sleeve
asymmetry below WAS fixed later in the session — see §8):

- ~~**The sleeve asymmetry**~~ — **FIXED later in the session, see §8.** The
  diagnosis written here held: the two wrists sit at different depths, so one
  elbow (where the cuff lives) projects inside the frame and the other outside
  it. The fix is the one this paragraph predicted — the forearm is scaled by the
  wrist's own depth so the *projected* length matches on both arms.
- **The hand pose is still anatomically wrong.** Bigger, but the lower hand
  reads as a pale ovoid with a thumb rather than fingers wrapped around a shaft.
  This wants reference footage and a real grip pose, which is the job you
  originally asked for.
- ~~**The look-up float**~~ — **FIXED later in the session, see §8.** The guess
  written here was right that something overrode `floorAnchored: true`, and
  wrong about where: courseScene skips the broom entirely because the viewmodel
  owns its pose, and the viewmodel blended a floor-referenced planted pose
  against a camera-referenced carried one. 1.206 yd of clearance at full
  up-look, now 0.602.
- **Which tool cleans which surface** is a *feature*, not a polish item: dirt
  that reads as its own type, and a hold-to-reveal filtered by the equipped
  tool. That is its own session.

*~50 m.*

---

## 8. Queue B — B9, B4, B7, B8 and B11 are done; B6 is not

### B9 — the load is 132 shader compiles, and nothing else

PHASE_1_CLASSIFICATION named every phase of `prewarm()` and then said, correctly,
"which step dominates is UNVERIFIED". It is verified now, of an **18,578 ms**
new-game-click-to-veil-clear:

| phase | ms | share |
|---|---:|---:|
| **forced warm draw** (one `composer.render`) | **9,741** | **52%** |
| before prewarm (modules, scene, room) | 4,605 | 25% |
| assets-idle | 971 | 5% |
| editor-camera warm | 891 | 5% |
| initTexture (276 textures) | 692 | 4% |
| renderer.compile (link only) | 104 | <1% |
| three spin frames | 62 | <1% |

**The 9.7 s is one-time program compilation.** The *identical* render immediately
after it costs **51 ms**, so it is not the shadow bake, the post chain or
geometry. `renderer.info.programs` is **132** — about **73 ms each**, ANGLE
translating to HLSL and D3D compiling, serialized because a program's real
compile lands on its first draw.

**Three things I tried that did not work**, recorded so nobody spends the
afternoon twice:

* Deduplicating the warm set by program key cut objects submitted from **5,310 to
  887** and moved the time by **nothing**. Kept anyway — it keeps ~4,400
  redundant draws and their shadow submissions out of the frame.
* `renderer.compileAsync()` — the parallel-shader-compile path, which should have
  been exactly right — cost **1,350 ms** against 104 ms for the sync link and
  returned only ~200 ms. A net **half-second loss**. Reverted, with the number in
  a comment.
* Restricting the warm set to what the player sees first: **785 of the 887** warm
  objects are already within 60 yd of spawn. Nothing distant to defer.

**Under 10 s is not reachable by trimming.** Zeroing every non-compile phase in
prewarm saves 2.6 s and lands at ~16 s. Options, with costs:

| option | saving | cost |
|---|---|---|
| **A. Intern materials the way textures are interned** | proportional to the program-count drop; the only lever on the dominant term | days. Touches every builder. §10 of the classification already names the cause: the shared pool interns *textures*, never *materials*, and program count follows material and light-count variety |
| **B. Defer the editor-camera warm to first editor entry** | 0.9 s | a ~0.9 s hitch the first time the editor opens. A real trade about your game, not mine — left for you |
| **C. Drop the veil early, warm the rest during play** | up to 9 s of *perceived* load | hitches in the first seconds. Reintroduces exactly what prewarm exists to remove |

Corrected the record too: asset loading was classified **PRESERVE** with 18.2 s
inside it, and BASELINE_PERFORMANCE listed the number without calling it a
defect. Both now say so, as **LOAD-1**.

*~2 h. Most of it went on the three failed candidates rather than the profile —
each had to be built and measured before it could be ruled out, and compileAsync
in particular looked right on paper.*

### B4 — a 1:00 ask is offered 1:00, 1:30 and 12:30

Two faults pulling opposite ways. The dropdown was **every open slot across three
days sorted by clock**, so a 1:00 ask produced forty options starting this
morning — the right answer was in there and so was every wrong one. And the
cutoff was a **wall**: anything past 60 minutes was refused outright, so a
customer whose only option was 90 minutes out always walked.

Offers are clustered now, and past the window the answer belongs to the
**customer** — each walk-in carries how far they will stretch, so it stays
deterministic and testable rather than a dice roll at the counter.

**Measured at 1x**, party of two, against live reservation state:

| asked | offered (nearest first) | beyond window |
|---|---|---|
| 7:00 AM | 7:00, 7:30 | no |
| 9:30 AM | 9:30, 10:00, 9:00 | no |
| 1:00 PM | **1:00, 1:30, 12:30** | no |
| 4:00 PM | 4:00, 4:30, 3:30 | no |
| 6:30 PM | 4:30 (−120) — **declined** | YES, one offer |
| 3:00 AM | 7:00 (+240) — **declined** | YES, one offer |

Every offered slot was checked against `availableSlots()` for the same day and
party size. An impossible ask returns exactly **one** offer rather than an empty
list, because the instruction there is to offer it.

*~1 h. The new module imports nothing, which was deliberate — reservations.js
already imports the caller, so putting the offer logic there would have closed a
cycle.*

### B7 — both structural burials fixed; the whitelist shrank by two

Population-wide: **8 assets / 13 parts → 7 / 12.**

**061** — `CounterCarcass` was one solid slab filling the whole volume. It is now
the panels *around* an open staff bay: a solid drawer bank that still carries the
three drawer faces, a customer-side wall, an end panel, and a bay deck. Built
from panels rather than bored, because the cut is axis-aligned so the panels ARE
the boolean's result without its material re-indexing. Nothing gains a millimetre
toward the aisle, so `staff_corridor_clear` holds by construction.

**099 took three passes, and the third is the interesting one.** The hollow was
faked **twice** — a solid black bore standing inside the wall, *and* a solid
`StandRim` disc capping the top. Boring to 0.068 left a plug on the tray; boring
to 0.050 left the tray embedded in the 2 mm beneath; boring past it to 0.040
*still* reported invisible. At that point I stopped guessing and read the
exported buffers, which is where the lid turned up. Looking down at an umbrella
stand showed a green plate. Both are real geometry now.

`assets_51_100_lib` gains `bore()`, plus one thing the existing pattern needed:
popping the material slots the boolean brings across. Re-indexing faces is not
enough — the cutter's empty slot survives and the publisher's validator fails the
asset, which it did on the first attempt.

*~1 h 45 m, and roughly an hour of that was 099's three failed bores. Reading
the exported buffers first would have found the lid in ten minutes; I guessed at
depths three times instead, which is the lesson worth keeping from it.*

### B8 — the laptop stands at the counter's east end

Moved to the proposal's own clearance-safe pose: local x −1.72 → **+1.75**, which
clears the receipt printer by 0.67 yd where the first choice would have left 0.36.

The proposal claimed the seat pose, focus camera and E prop are all derived from
the laptop's transform and would follow. Measured rather than assumed: the E
prompt reads "Laptop — [E] open GOLF SIMULATOR" at the new position, the focus
camera solves **0.252 yd** on the screen's own normal, the lid opens to 1.869 rad,
and the save round-trips.

**B-stand means the chair stays** — the whole reason for picking it over B-sit.
The `laptop-seat` protected rect, derived from the chair back when the chair was
the laptop's seat, becomes `laptop-stand` derived from the laptop; otherwise a
keep-clear zone would sit 3.5 yd from the machine it exists for.

*Evidence: `Baseline/round6/laptop-bstand-position.png`, `laptop-bstand-focus.png`.*

*~50 m for the move and its verification.*

### B11 — 36 drivers off the removed menu, 11 perf drivers gated

Full accounting in **`Designs/ProShop/HARNESS_DEBT.md`** — every remaining file
listed with a reason rather than a number.

| category | before | after |
|---|---:|---:|
| drivers booting through the removed menu | **36** | **4**, all deliberate |
| perf drivers carrying the renderer gate | **5** | **11** |
| stale cutter-era drivers | 15 matches | 15 — **nothing to do** |

The menu port went by two codemods kept in `tools/qa/lib/` so the next sweep is
not hand work: 23 files by regex-anchored statement shapes, 6 by **brace walking**
the if/else blocks (regex could not be trusted with those), 3 by hand.
`laptop-tour.js` was one of the three — its else-branch also buys the first
course, so it became `if (bootMode === 'new-game')` rather than being collapsed.

The 4 that keep the raw call do not *boot* through the menu; Continue's presence
is what they assert.

The gate split matters: six drivers reporting **absolute** numbers now refuse
SwiftShader; two that pin their own swiftshader flags and compare two runs of
*themselves* declare `allowSoftware` and carry the label, because refusing
relative numbers would just delete a working harness. Three are not gated and say
why — one is a hash-pinned frozen fixture whose bytes are the contract, two never
sample a frame.

**The cutter category was already closed.** All 15 matches are *provenance
comments* recording the 2026-07-30 port. The count was counting its own receipts.

*~1 h 20 m, front-loaded onto the two codemods. Doing 29 of the 36 files by hand
would have been faster once and slower every time after.*

### A8 — the sleeve bug is fixed

"One arm sleeved, one bare" is not asymmetric code. Both arms run the same solve
with mirrored offsets; the two hands grip at different **heights**, so their
wrists sit at different depths and a fixed 0.26 yd forearm projects to two
different screen lengths. The cuff lives at the elbow, so the nearer arm's landed
off-frame and the further arm's did not. One number, two arms, two answers.

The forearm is scaled by the wrist's own depth now, so the projected length
matches on both. Verified by looking — both arms leave the frame the same way —
and the aim probe is unchanged.

*~40 m.*

### A8 — the look-up float, and a round-5 call reversed

Added after the first draft of this report, which listed the float as "not
investigated at all". It is now.

`cleaningTools.js` does declare `floorAnchored: true` for the broom, and
courseScene honours it for the mop, vacuum and dustpan — but line 8235 hands the
broom off wholesale (`if (id === 'broom' && broomVm.isActive()) continue`), so
the floor-contact solve never runs for it. The anchoring is the viewmodel's, and
the viewmodel **blended across two reference frames**: the planted pose measured
the head against the boards, the carried pose measured it as a constant below
hands that ride `camera.matrixWorld`. Above `carryAbove` (−0.10 rad) the blend
is all carry, so the head had no floor reference at all and rose with the view.

Measured live, bristle clearance above the boards:

| view pitch | before | after |
|---|---:|---:|
| +0.30 (max up) | **1.206 yd** | 0.602 |
| 0 (level) | 0.601 | 0.600 |
| −0.40 and below | 0.012 | 0.012 |

3.6 ft of clearance at full up-look — chest height. The constant behind it had
been tuned twice (0.34 → 0.30 → 0.65) as a framing knob without anyone noticing
it was the wrong *kind* of quantity.

Both poses are floor-referenced now and only the hover height blends.
`carryHover` is 0.60, which is not a new tuning value but the measured
level-look clearance the old drop produced — so the carried pose and round 5's
31° shaft angle are unchanged at level and only the response to pitch differs.
Spread across the whole carried band is now **0.002 yd** against 0.605.

**This reverses a round-5 decision on purpose.** A world-space carry was tried
then and reverted because the head "fell off the bottom of the frame (measured
NDC y −1.08 at pitch +0.30)". That is not the defect — it is what looking at a
ceiling with a broom in your hands looks like. Your hands and the shaft ride the
camera regardless, so the frame is never empty; I looked at the +0.30 render to
confirm it rather than trusting the argument. courseScene's own floor-anchor
contract already said the head should swing below the frame at the horizon.

**The test is the point.** The old one asserted `carryDrop > 0 && < 0.8` and
passed through every round of this, because a range check on a constant cannot
express which datum the constant is measured from — the same shape of failure as
A2. `tests/broom-floor-anchor.test.js` builds a socketed rig, drives the real
`update()` solve across the pitch range, and asserts the head's floor clearance
does not depend on view pitch. I reverted the fix to confirm it fails: *"looking
up lifted the head 0.229 yd off the boards"*.

*Evidence: `qa/broom-round6/lookup-float/pitch0p3.png` (up), `pitch0.png`
(level). ~1 h 10 m.*

**Still not done on A8:** the hand grip anatomy against reference footage, and
the dirt-type / tool-filtered reveal. That last one is a feature, not a polish
item, and wants its own session.

---

## 9. B6 — the texture pass: **zero, as instructed**

You said: *"If you cannot finish all twelve, do zero and say so."* I did zero,
and I am saying so.

What I established before stopping, so the next session starts further along:

* **The local CC0 library is three material families**, not twelve —
  `asset_sources/textures/cc0_spike/` holds Metal032, Wood051 and Wood062 at 1K,
  with calibrated colour variants in `cc0_calibrated/`. That may well be *enough*,
  because the shared pool means twelve assets can share three sources and texture
  memory counts sources rather than instances — but it needs confirming per asset
  rather than assuming.
* **The palette pipeline exists and is documented**, including the
  `ShaderNodeMix` / RGBA / MULTIPLY / factor-pinned-to-1.0 recipe that is the only
  shape the glTF exporter recognises as a `baseColorFactor`. The comment in
  `build_assets_61_70.py` around asset 065 is the reference implementation, and
  `tests/proshop-basecolor-factor.test.js` already fails a textured material that
  ships without a factor.
* **061 was rebuilt this session** (B7), so its texture pass must come after that
  geometry, not before it.

The work per asset is source → UV → map → calibrate → verify factor → screenshot,
across twelve assets and two builder files, plus the memory measurement against
the 150 MB threshold before and after. It is a session, and a session I did not
have left after B9 through B11. Starting it and stopping halfway is the outcome
you specifically ruled out.

---

## 10. Two things found on the way, recorded rather than fixed

1. **Writing `state.shop.progression.tier` at runtime throws
   `fixtureSockets is not defined`** out of a rebuild path. An exception inside
   the frame callback stops the loop: the clock froze at 840.04 and every shop
   measured zero, which reads exactly like a scaling failure. It cost me a run
   before I traced it. Not A7's to fix, but it is a live crash on a supported
   state change.
2. **The reader's backspace key needs a GLB edit** (§3). Hash-gated kit.
3. **`course-perf.js` is broken independently of anything here.** It waits for
   `getByText('New Empire — Realistic')`, a menu label that no longer exists, and
   dies there. Its new renderer gate is in place for when that is fixed. Same
   class as the stale labels the B11 port removed elsewhere, and worth a sweep
   for `New Empire` across the harness.
4. **`laptop-tour.js` fails on "marketplace: no affordable Buy button"** — before
   and after this session, verified by stashing. An economy fixture problem.

## 11. Instrument failures I caught before using them

Stated because the standing rule is that a new instrument gets a negative
control, and five of mine failed theirs:

- The card-seat probe identified the card by ISO-ish proportions and **matched a
  broken floor tile 257 yards away**, then reported a confident seating number
  about it. Now identified by `userData.kind === 'payment-card'`.
- The key-occlusion probe counted each coloured key's own drawn label as an
  occluder and reported confirm/clear/backspace blocked by themselves.
- The monitor-layout probe reported **616 for every case** — the panel's own
  border, which is by definition the lowest thing drawn and says nothing about
  where the buttons landed.
- The A4 penetration probe used **AABB overlap**, which cannot tell "inside the
  alcove" from "inside the wood" and reported 0.104 yd of permanent phasing on a
  correctly parked reader.
- The laptop standoff check measured **XZ distance** and failed a good pose at
  0.095 yd. The lid leans back, so most of the standoff is vertical.
- The footfall driver's first run raised the shop tier at runtime, which threw
  out of a rebuild path and **stopped the frame loop** — so the clock froze and
  every shop measured zero, which reads exactly like the scaling failure it was
  supposed to be testing for.

And twice, the older lesson: I checked file mtimes before reading a render as
evidence. The broom arm crops were **eleven hours old** the first time and the
checkout renders had gone stale once before. Only the pitch renders re-shoot on
that driver.

---

## 12. What is left, and the order I would take it

1. **A8's last two** — the hand grip anatomy against reference footage, and then
   the dirt-type / tool-filtered reveal as its own block. That last one is a
   feature, not polish.
2. **B6** — the twelve-file texture pass, unbroken, with §9's findings as the
   head start.
3. **LOAD-1 option A** if you want the load under 10 s — interning materials the
   way textures are interned. Nothing else touches the dominant term.
4. **The laptop harness debt** — see §13. Ten of thirteen fail, none of it from
   B8, and it is the largest untended harness family left.
5. A sweep for stale menu labels like `New Empire — Realistic` across the
   harness.
