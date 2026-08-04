# OVERNIGHT REPORT 7 — 2026-08-04

Ranked by what to read first. Suite green at every commit; final run
**2729 pass / 0 fail**. All work pushed to `feature/pro-shop-vertical-slice`.

**Thirteen items done and verified. One partial. Fifteen not started.** The
not-started list is §14 and it is specific, because "everything below is
authorised" was not the same as "everything below fits in one night".

---

## 1 · C2 — the broom still rose, and BOTH instruments were blind in the same place

*≈1 h 30 m · clip `round7/c2-lookup-pan.webm` · stills `c2-after-*.png` ·
traces `c2-lookup-trace-before/after.json`*

You said the measurement was the finding. It was.

A8's QA driver and A8's unit test both swept to `BROOM_FEEL.pitch.maxPitch`
(0.30) on the belief that it was the look limit. It is the reach **curve's**
clamp. `mouseLook.js` clamps the player at **±1.35**, so 78% of the up-look
range had never been measured by anything.

Recorded and watched a six-second level → full-up → level pan first, as asked.
In words: the anchor holds until the shaft goes vertical, and then the whole
broom starts riding the view; at +1.0 rad you are looking at a fist with a stick
standing out of it.

Matched A/B on identical live geometry (`geomSource` is pinned in the trace now —
the GLB and the fallback rig put the grip in different places, so two runs
without it compare two different brooms):

| pitch | before | after |
|---|---:|---:|
| 0.000 | 0.600 | 0.600 |
| 0.755 | 0.639 | 0.639 |
| 0.955 | **0.687** | 0.609 |
| 1.350 | **0.980** | 0.600 |

**lift 0.380 → 0.000 yd.**

The cause was not the anchor. `gripAnchor` is applied through
`camera.matrixWorld`, so craning to 77° hoists your hands 1.07 yd — and at 3.16
yd of hand height a 1.36 yd handle cannot reach the boards. Past that the head
is rigidly slung under hands that ride the camera. Anchoring the head harder
cannot fix that, so the **hands** are capped instead, at exactly the height from
which the handle still reaches. Gated on `pitch > 0`, so the whole working range
is untouched — held by its own test.

The test that missed it now sweeps to `PITCH_LIMIT`, imported from `mouseLook`
rather than retyped, and checks twelve steps rather than two endpoints — this
defect saturated partway up, where A8's was monotone. Negative control: with the
cap disabled it fails with *"looking up to 1.35 rad lifted the head 0.559 yd off
the boards"*.

## 2 · C10 — the register stow was never fixed for ANY tool, including the broom

*≈50 m · `round7/c10-register-tool-stow.json`*

You were right that the previous fix was broom-specific. It was worse than that:
`broomVm.setActive(false)` lived inside `walkExit()`, and **`walkExit()` runs on
scene dispose and on nothing else**. The till never reached it.

Measured, with the new stow disabled: **all nine tools still drawn at the
counter** — washer, vacuum, mop, broom, dustpan, spray, cloth, sponge, trashbag.

The general case is general because it enumerates nothing. It puts the tool
**down** through `walkSetTool()` — the one setter every held tool already passes
through on its way into the hands — so the world pass, the broom's private
viewmodel pass, the first-person hands, the tool viewmodels and the effect
timers are covered by construction. Ticked every frame right after
`clubhouse.update()`, so the till stows in the frame it opens; restores only
into an empty hand.

**9/9 clear at the till, 9/9 restored on exit, 9/9 visible with it shut** (that
last is the control — a probe that cannot see a held tool cannot report it
stowed). The unit test holds the *property*, not the list: the stow must route
through `walkSetTool`, must name no tool id, and must not reach into `broomVm`.

## 3 · E1 — the tool audit table

*≈1 h · full table in `Designs/ProShop/TOOL_STANDARD_AUDIT.md` ·
`round7/e1-tool-standard-audit.json`*

Nine tools, six axes, measured off the live posed rig. The broom is the control,
measured by the same code in the same run.

| tool | reach | carried spread | floor-ref | poses | into fixture |
|---|---:|---:|:--:|---:|---:|
| **broom** | **0.012** | **0.003** | **yes** | 112 | **0.000** |
| mop | 0.081 | 0.631 | no | 137 | 0.755 |
| dustpan | 0.235 | 0.640 | no | **1** | 0.603 |
| vacuum | 0.265 | 0.611 | no | 89 | 0.705 |
| washer | 0.977 | 1.367 | no | **1** | 0.324 |

Four findings the table makes rather than implies:

1. **mop, vacuum and dustpan all DECLARE `floorAnchored: true` and none of them
   are.** The shared floor solve nudges the head by at most 0.06 yd; the measured
   error is 0.61–0.64. The clamp saturates on frame one and the head rides the
   camera the rest of the way.
2. **mop hovers 0.081 yd off the boards** at its own working pitch — your 0.103
   bug, one tool over. Vacuum and dustpan hover ~0.25.
3. **Four tools are static props**: dustpan, spray, washer and trashbag return
   ONE distinct pose across two seconds of held use. The machinery exists (four
   others show 89–137), so they are simply not wired into it.
4. **Hands and sleeves are already uniform** at 2 and 4 across all nine, because
   the broom rebuild fixed them in the SHARED rig. Worth knowing before anyone
   opens nine files.

Its own control caught an instrument bug first: the initial version swept the
whole pitch range and reported the broom at 0.59. That 0.59 is the design — head
on the boards looking down, carried looking level — and a pose blending between
two intended heights is not the same claim as a head riding the view. The spread
is measured within the carried band now.

**So "most of this should be config" is half right.** The animation wiring is
config-shaped; the anchor and the collider clamp are one real piece of code
shared by four tools, and they are the same extraction. **E2 and E3 are not
done.**

## 4 · F5 — the first ten minutes, as a stranger

*≈40 m · list in `Designs/ProShop/FIRST_RUN_LEGIBILITY.md` · shots
`round7/f5-*.png`*

Captured on a genuinely clean profile with the HUD left on, so the list is
written from the screen and not from the code. Ten moments, ranked by how early.
**Eight land before the player touches the front door.** Nothing fixed, as asked.

The three that would change the most:

- **13.0 s** from Relaxed to a playable frame (368 ms to walk-active). B9's
  stated target was under ten.
- The **objectives card is not visible in either captured frame**, while a toast
  about a tractor the player cannot see owns the top right. The game's only
  statement of what to do loses to a piece of colour.
- Sweeping the view through twelve headings at spawn, the **only** interaction
  prompt in any direction is **"Weeds — [E] pull them."** The objective says
  walk to the clubhouse. The first verb a stranger discovers is gardening.

Plus: `Test scene: Maintenance Shed` is in the shipping menu one row under
Credits; the objective reads `2/18` on the first screen; and the hint bar tells a
first-time player about the course editor on frame one.

One thing I attempted to measure and **could not** — which tools a fresh profile
can equip. My probe looped `setTool` nine times in one tick and `walk.setTool` is
debounced, so its eight refusals are the debounce, not ownership. Not claimed.

## 5 · C4 — the bag really did go through the desk, and the wrong arm was reaching

*≈1 h 30 m · `round7/c4-handoff-over-desk.png`, `c4-carried-at-hip.png`,
`c4-c11-c12-handoff.json`*

Measured on a live card sale at 1×: **0.375 yd** of the carrier sat below the
counter top while its footprint was still on the counter. The control — the same
bag resting on the counter a moment earlier — read **0.000**. Photographed: a
flat brown triangle sticking out of the desk.

The destination is the customer's LEFT carry grip, and that grip is on a hanging
arm at hip height, well below the counter top. A straight lerp from a bag on the
slab to a point under the slab goes through it, and the old +0.14 arc was a
constant against a depth set by the bag's own height. It is a derived floor now:
while the footprint is still over the slab the lowest point is held at the
counter top, and the moment it clears the front edge it descends to the hand.
Across, out, then down.

**worst sink 0.375 → −0.020 yd** (negative = clear of the top; the number is
exactly the clearance, so it is a bound rather than a tolerance).

And the arm. `ReceiveBag` raised the RIGHT shoulder to −1.00 while the bag
attaches to `carryGrip('L')` — the customer reached with one hand and received in
the other. `WalkBag` then held the LEFT shoulder at −1.18 for the whole walk out,
carrying a shop bag at waist height like a lantern, to keep it visible over a
counter they are walking away from.

Receiving hand: **0.757 → 0.588** of the customer's own standing height (hip is
~0.52). Carried hand on the way out: **0.851 → below 0.58**.
`tests/bag-handoff-pose.test.js` drives the real `char.update()`; with the old
poses restored all three of its tests fail.

## 6 · C1 — there were two signs, and the second was driven by the wrong question

*≈1 h 15 m · `round7/c1-board-closed.png`, `c1-board-open.png`,
`c1-sign-both.json`*

The exterior board was repainted from `campaignAllowsBusiness()` — a one-time
campaign **milestone**, permanently true in a non-campaign game. It read
"OPEN TODAY / 6 AM – 8 PM" through every night you had turned the card indoors
to CLOSED.

The interior card had a quieter version of the same fault: `applyFacing()` ran at
build and on the E press and nowhere else, so the midnight rollover moved the sim
to CLOSED and left the card facing OPEN until someone pressed E twice.

Both are driven by one registry now, synced every frame from a single
`signIsOpen(state)` read. A sign that is not registered is driven by nothing, and
the new source sweep fails if any renderer file paints an OPEN/CLOSED sign
without joining it — proven by planting one.

**My first draft reproduced the original bug exactly** by letting the campaign
milestone win over the daily sign: the greybox starter IS a campaign profile with
`businessOpen` false. Caught by `tools/qa/shop-sign-both.js`, which hashes the
board's canvas across a real E press. Board hash `e1c5955e → 5ebd8f7f`; card
bearing `0 → 3.1416`. Negative control: both still across 700 ms with nothing
pressed.

Found by looking at the render: the 0.72 yd board was eaten by the porch column
from every straight-on approach. There is exactly **0.44 yd** of clear wall at
reading height between the door casing and the column, so the board is
0.34 × 0.26 centred in it.

## 7 · C11 / C12 / C13 — the counter

*≈1 h 20 m · `round7/c13-due-dominates.png`, `c12-bag-at-reader-scale.png`*

**C11.** The card's return is gone: it used to arc out of the reader (+0.025 sin
hop) and then a second motion carried it toward the customer and faded it out
mid-slide. It goes straight out of the slot onto the counter now, flat, and stays
— measured 1.1 mm of vertical extent, resting 3.7 mm proud of the top, visible.
My first attempt stood it on **edge** (38.4 mm tall, 15.5 mm *below* the top)
because the card model is already thin in its own Y, so identity is flat.
*Known and not fixed:* the card is disposed when the sale banks, so it does not
outlive the customer.

**C12.** The bag is tied to `TERMINAL_HARDWARE_SCALE` (1.85) rather than picked a
third time — the terminal draws at that scale for exactly the same reason, and
the brief asks the bag to match it. One constant, so they cannot drift. The flank
still rests ON the counter: **2.4 mm proud**, measured, with the lift derived
from the scale rather than baked.

**C13.** The amount due is the 152 px headline, not a 25 px footer line. Round
10's finding is not undone — the running KEYED figure stays live and carries the
caret at 52 px. The KEYED label was drawn into the headline's descenders at first
(+76 under a 152 px figure); the gap is +96 now, found by looking.

Two measurement bugs found while re-checking C4 against the bigger bag, both
recorded in the code: a point test on the anchor let the bag's near face stay
over the counter for another 0.13 yd, and feeding `frontDeskLocalPoint` a
**world** box centre answered "nowhere near the counter" for every frame and put
0.76 yd of bag back inside the desk.

## 8 · C7 — every price tag deleted, and the tests that required them reversed

*≈45 m · `round7/c7-shelf-no-tags.png`*

Two things put a price in front of the player and both are gone, not gated:
`ProductSwingTag` (a kraft plane on every club/hang/apparel product, riding the
goods onto the shelf, into the hands, across the counter and into the bag) and
`priceRail()` (a "NAME $12.34" board under every display bay, plus its four
layout parameters at nine call sites).

`barcodeSurface` stays and is not a tag — it decides which way a product turns to
be scanned. Department signs stay; they name a section, they do not price it.

The tests that asserted the tag EXISTS are reversed rather than deleted.
`tests/no-price-tags.test.js` holds what a behaviour test cannot — that the code
is gone and no flag can bring it back; stashing the two source files fails two of
its three tests. Live sweep on a fully stocked room: **0** swing tags against
**469** textured surfaces (the control).

*Named as a decision, not an oversight:* the cash drawer's denomination labels
stay. They label a drawer slot, not a product.

## 9 · C3 — the correction key is a digit key

*≈40 m · `round7/c3-terminal-front.png`*

Identical width and height to a digit (0.0225 × 0.0125), replacing A3's
three-column bar. A3's derived clearance carries over and is not optional: on the
pitch grid this key would drop its lower edge to 0.01375 and the chip slot's top
is 0.016, sitting 4.5 mm proud of the key faces. It is centred in the 13.25 mm
clear band instead.

Found by looking at the preview render, not by any test: the green confirm key
carried the glyph `"O"`, and in a seven-segment font `"O"` and `"0"` are the same
six segments — it read as a second zero beside the real one. It is a tick now.

*Worth knowing:* a bare `build_checkout_kit.py` run rebuilds all 36 checkout
assets and none come back byte-identical (a 518 KB diff on an untouched
`ball_shelf`), so a whole-kit build would have shipped 35 silently changed
runtime models behind a keypad tweak. Always pass `-- <asset>`.

## 10 · D1 — the laptop race is real, measured, and not the whole cause

*≈1 h 20 m · `Designs/ProShop/HARNESS_DEBT.md` §5*

**How many went green: 0 of 10.** The three that passed still pass.

HARNESS_DEBT §4's reading was wrong on all three counts, and §5 records the
measurements that disprove it: the datum is not stale (rig and
`FRONT_DESK.laptop` both read interior-local −2.550, 1.557), the laptop does
open, and `.lt-search` is not a drifted selector — it measures 217 × 15 px,
display block, visibility visible.

What IS true: `app.laptopOpen = true` is set on the first line of `enterLaptop()`
and the DOM it gates opens **1350 ms later**. Time-resolved at 400 ms polling:

```
t=0.4s flag=true  screen display:none    0x0
t=1.2s flag=true  screen display:none    0x0
t=1.6s flag=true  screen display:(empty) 1280x720
```

Every red driver waited on that flag and reached into a screen that was still
`display:none`. Playwright said so exactly — *"element is not visible"* — and §4
read it as selector drift. `laptop-bstand-verify` was green throughout because it
alone waits 1800 ms after the E press, **not** because its stance was better.

All 20 waits now require the screen up and the projected frame settled, and
`tools/qa/lib/qa-laptop.mjs` carries the shared helpers. But a hand-driven open
from the same stance in the same build reaches a clickable field and these
drivers do not, and I did not isolate the difference. §5 names the **bisect**
that ends the question rather than another theory — strip `laptop-round3` to
boot → stand → E → click, confirm it passes, re-add its setup one statement at a
time. Guessing has now cost two sessions.

## 11 · D5 / D6 — the cash highlight looked at, and A4 closed

*≈50 m combined · `round7/d5-cash-not-hovered.png`, `d5-cash-hovered.png`*

**D5 verified by looking, not by construction.** Cursor away: 0 outline shells,
0 sprites (the control). Cursor on it: 2 outline shells, 0 sprites, largest
0.211 yd. It is a silhouette outline that appears on hover with a "Take payment"
tooltip and no billboard halo. The claim holds.

*Found by looking, and not fixed:* C12's 1.85× bag now crowds the tender's
landing spot at counter-left, and the pile is small and low-contrast against the
walnut. The highlight is doing its job; what it highlights has become the least
visible thing on the counter. Moving the tender is a layout change against the
round-7 reference and nobody asked for it.

**D6** — A4 is in `DEFECTS.md` as CANNOT REPRODUCE with both instruments named,
what each measured, and what would reopen it. It also records that C4's paid-bag
penetration — 0.375 yd through the same desk in the same beat, one prop over — is
a **plausible but unestablished** explanation of the original sighting.

## 12 · C6 — analysed, costed, NOT built

*≈30 m · `Designs/ProShop/COMBINED_VISITS.md`*

The combined share is not low. It is **structurally 0%**, and it is one gate:

```js
if (!toCounter && !walkInRequest) {   // ← every browse stop is built in here
```

A customer who is checking in against a reservation, or here to ask for a tee
time, never receives a shopping plan and never receives a browse stop.
`releaseReservationCustomer()` then sends them straight to `exit` whatever
happens at the desk. There is no branch in which a checked-in golfer turns round
and looks at the glove wall.

Building it is not a probability tweak. `checkoutPhase` currently encodes "why
this person is here" as a single value, and the desk lists key off its **string
prefix** (`startsWith('reservation')`); a combined visit is two reasons in
sequence, so the state has to be split into an errand LIST before the flow can be
spliced. And the acceptance measurement you asked for is **10.5 wall-hours per
leg** by the day driver's own header (SIM-TIME-001: NPC verification at 1× only),
so twenty-one hours of measurement on top of the feature.

The note carries the implementation plan and what I would do first.

## 13 · Instrument defects found this session, by their own controls

Recorded together because the pattern is the point — five of the six were caught
by a control, not by a result looking wrong.

| instrument | what it got wrong | how it was caught |
|---|---|---|
| A8's broom sweep + test | stopped at +0.30, believing broomFeel's `maxPitch` was the look limit | C2's re-measure over the real range |
| E1 tool audit v1 | swept both pose regimes and called the blend a defect | its own broom control |
| C4 sink probe v1 | conflated "no frames" with "no bag found" | the tick counter it lacked |
| C4 sink probe v2 | point test on a 0.5 yd object | the fix not moving the number |
| C4 clearance v1 | mixed a world box with a root-local handle | 0.166 yd of residual sink |
| C1 face function v1 | let a campaign milestone outrank the daily sign | the board's canvas hash not moving |

---

## 14 · NOT STARTED — and this is the whole list

Fifteen items. None of these were begun; none are partially in the tree.

| item | why not |
|---|---|
| **C5** desk pass-through | re-deriving `FRONT_DESK_FRAME` moves queue slots, counter height, register workspace and every camera pose. It is the largest single item in the queue and it is not a thing to start with two hours left. |
| **C8** lamp teaches itself | a diegetic teaching design, not a fix. Wants the F5 list (§4) in hand first — three of those ten items are the same problem. |
| **C9** the ledger | a new physical object with a book UI, an event feed and achievement migration. A session. |
| **D2** hand grip anatomy | reference study plus a rebuild of the lower hand. |
| **D3** tool-filtered dirt reveal | needs the dirt TYPES to read in world first, which is its own art pass. |
| **D4** material interning | approved and costed, not built. |
| **D7** remaining harness debt | the four raw-Continue drivers, the `New Empire` sweep, laptop-tour's economy fixture, the five dead feel keys. |
| **E2 / E3** fix the tools, audio per tool | §3 is the table that says what E2 actually is. E2 is one shared extraction plus four wirings; E3 is nine tools of audio. |
| **F1** settings menu | a real screen with persistence. |
| **F2** key rebinding | every bound key, including the preventDefault walk verbs. |
| **F3** crash handling | log, restart offer, asset and audio fallbacks. |
| **F4** save robustness | migrate-or-refuse plus a deliberately mangled fixture. |
| **G1** texture pass | twelve files or zero, and it was to be LAST with a clear run. There was no clear run. |

**What I would take next, in order:** E2 items 1–3 (one extraction, four tools,
and it removes the two worst rows in §3's table), then the D1 bisect (an hour,
and it ends a question that has now cost two sessions), then F3 and F4 — they are
the two items in Queue F that stop a stranger losing their game rather than
merely being confused by it.
