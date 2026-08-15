# OVERNIGHT REPORT 5

Session of 2026-08-02 → 03. Ranked by what to read first.

**The queue was not emptied.** Items 1, 2, 3 (partly), 5 and 10 are done; 4, 6,
7, 8, 9 and 11 were not started. What happened is in §7 — one item on the list
turned out to be two hard geometry bugs rather than a polish pass, and a
regression I shipped earlier in the night ate a chunk of the session. Scaling
the rest down was not mine to decide, so it is reported rather than trimmed.

---

## 1. READ FIRST — I broke ~20 QA drivers earlier tonight, and fixed it

The **open/closed sign** (committed at the start of the session) silently broke
every harness that stages a customer.

A new day opens CLOSED. The closed-shop sweep sends everyone inside to the exit.
A driver that calls `sendToCounter()` and never flips the sign watched its
shopper quietly turn round and leave, then timed out waiting for a transaction
that could not happen. The checkout render suite had been failing since — I
found it because a render I was about to cite as evidence turned out to be two
and a half hours old.

**Found by bisect, not by guessing.** The failure reproduced at HEAD, then at
HEAD~2 (clearing NAV-WAIT-001), landing on the sign commit.

**Fixed at the cause.** `sendToCounter()` is an assertion by the caller — "there
is now a shopper heading to the counter" — so its customer is marked
`scriptedVisit` and the sweep leaves it alone, alongside the exemptions that
already existed for a due reservation and an in-progress transaction. The sign
gates *arrivals*; it must not delete a shopper somebody explicitly placed.
Patching twenty drivers would have treated the symptom and left the next harness
to rediscover it.

**Worth your attention beyond the fix:** this class of thing — a sim rule that
is correct in the game and wrong for the harness — will happen again as more
gating lands. The exemption list in that sweep is now three entries long and is
effectively the definition of "a customer who is here on purpose".

*Commit: `de1fb87`. ~50 min including the bisect.*

---

## 2. THE BROOM — the bug was geometry, not tuning

**It could never have worked.** Two hard facts, each provable with arithmetic,
and no amount of tuning could have fixed either:

1. **The handle could not reach the floor.** The gripping hand was held 1.350 yd
   above the boards; the FP asset's own sockets measure **1.247 yd** from
   `GripPrimary` to `FloorContact`. The broom was **0.103 yd too short to touch
   the floor at any pitch.** The bristles hung in mid-air at every pose and the
   solve dutifully drew them there.
2. **The viewmodel lens hid the floor.** At 50° vertical from an eye 1.62 yd up,
   floor is not visible until **3.47 yd ahead** at level pitch — so a bristle
   head anywhere within a broom's reach was off the bottom of frame *by
   construction*. Rounds 1–4 answered that by flattening the carry until the
   head rose into view: measured at **12.7° below horizontal**, a broom held out
   like a rifle. That flattening *is* what reads as "pointing at the ceiling".

The composition was being asked to satisfy two mutually exclusive constraints.
Three rounds of tuning could not have found this because it is not a tuning
problem.

**Measured, before → after** (`tools/qa/broom-aim.js`, new):

| pitch | shaft below horizontal | head above floor |
|---|---|---|
| level | 12.7° → **28.5°** | ~1.3 yd → **0.60 yd** (carried) |
| −0.45 | 34.9° → **42.0°** | floating → **0.012 yd** |
| −1.00 | 46.3° → **33.1°** | floating → **0.012 yd** |

0.012 yd *is* `floorKiss`. The bristles are on the boards, not near them. A
glance down of 26° now plants it, instead of 45°.

**The arms** were three separate defects, not one: a capsule is `span + 2r` long
overall so the forearm overshot the wrist by its own radius and its cap sat on
the fingers (that cap was the "nub"); the elbow was an absolute offset that
drifted to 0.40 yd while the skin was clamped to 0.312, so **the forearm could
not reach its own hand** and hung below it with a visible gap; and the elbows sat
almost straight below the wrists, drawing two vertical posts instead of arms
entering from the lower corners. All three fixed — tapered forearm, elbow placed
at the authored length by construction, elbows out and toward the viewer.

**The grip:** the wrist sat on the shaft's centreline, so the palm straddled the
handle and its flat far side poked through as a pale disc. It now rests against
the handle with the fingers closing over it.

**The sweep was always real** — and this is the interesting one. Measured 0.58
rad of arc with 6 direction reversals over 2.6 s, intensity peaking 0.89.
Negative control: the same window with the button *not* held measures **0.00 rad
and 0 reversals**. The arc was never missing. It was invisible because the head
was floating in mid-air with nothing to sweep against.

**Bob and idle sway were never wired.** An audit of all 102 feel keys against the
renderer found **22 that nothing read**, including every `idle.*` value and the
walk bob — so the module's own claim of "stride-locked bob, idle sway" was false
and tuning those numbers did nothing. `walk.bobRate` was asserted by a *test*
while being read by no code at all. Now wired; obsolete knobs deleted. Dead keys
**22 → 5** (the remainder are audio/particle knobs owned by another subsystem —
named here rather than silently ignored: `audio.loopGain`,
`audio.reversalAccent`, `particles.burstPerContact`, `particles.driftAlongStroke`,
`particles.hop`).

> That audit's **first result was wrong and was thrown away**: it reported all
> 102 keys dead, including `camera.fov`. A negative control — a list of keys that
> are unquestionably read — caught it (a failed `rg` invocation). Only the run
> where the control passed is reported.

**Evidence:** `Designs/ProShop/Baseline/round5/` — `broom-r5-level.png`,
`broom-r5-planted.png`, `broom-r5-grip-closeup.png`, `broom-r5-sweeping.png`,
plus `broom-aim.json` and `broom-sweep.json`.
**Clip:** `Designs/ProShop/Baseline/video/round5-broom-interaction.webm`, same
beats as the baseline. Note the first ~20 s is the loading screen — the beats run
from `equip-broom@3.0s` to `unequip@35.2s` on the driver's clock.

### What still does not match House Flipper — honestly

You asked for my judgement here, and it is worth more than the green run:

- **The hands are too small to read at normal viewing size.** They are properly
  modelled — four articulated fingers close over the shaft, verified at 8× crop
  — but at 1× they are pale shapes. House Flipper's hands are chunkier and fill
  more of the lower frame. This is a proportion decision I did not want to make
  unilaterally.
- **The forearms are short and leave frame quickly.** You see maybe 15% of frame
  height of arm. The reference shows more forearm, more sleeve, more body.
- **The two arms are asymmetric in what you see** — the left shows its green
  sleeve, the right exits as bare skin. That reads as an oversight, because it is.
- **At level pitch the head is 0.60 yd above the boards**, not on them. This is
  geometrically forced: a floor-contacting head at level pitch needs a ~112°
  lens, which would fisheye the handle. The honest fix is that you look down to
  sweep, which is what House Flipper does too — but a purist would say a carried
  broom should trail on the ground.
- **The broom reads slightly small/far overall.**

*Commit: `fa4c534`. ~3 h.*

---

## 3. NAV-WAIT-001 — closed, with the class gone rather than exempted

A browse stand now carries an occupancy claim taken on approach inside 2.60 yd;
a customer that cannot have it holds at a spaced point derived from
`fixtureBrowsePoint` (so hold points rotate with the display), 0.70 yd apart with
the first row 1.85 yd back — **outside** the approach band, so the waiting cannot
become the new shoving. Reaching a hold point is deliberately *not* reaching the
stop. The claim is released on every exit route. The crowd is bounded at 8.

**Measured on the instrument the defect was filed against** — same window, speed
and spawn count:

| | neglected | restored |
|---|---|---|
| block episodes | **95 → 0** | **82 → 1** |
| over the 20 s cap | **43 → 0** | **41 → 0** |
| p50 / p95 / max | 17.8/45.4/93.6 s → none | 20.1/54.0/75.3 → **12.6/12.6/12.6** |
| recovery within 15 s | 27.4% → **100%** | 17.1% → **100%** |
| nav blocks | 349 → **9** | 353 → **4** |
| still inside at close | 1 → **0** | 1 → **0** |

`waived: 0`, `waivedByDefect: {}` in both legs — **the class disappeared from the
log rather than being exempted from it**, which was the recorded acceptance
signal. **Zero episodes remain red** under the 20 s cap and the 75% floor.

**Negative control:** a fix that bought quiet by making customers do less would
produce the same episode count. `transactions` was 0 in the before-run too (this
window never had sales), and `stillInsideAtClose` went 1 → 0 in both legs — *more*
shoppers completed and left.

**Caveat, stated because it points the other way:** the acceptance run overlapped
a 283 s test suite. Episodes are wall-clock, so contention *inflates* them. The
measurement is conservative.

The exemption died with the defect in the same commit; `DEFECT_EXEMPTIONS` is now
empty and a new test keeps it that way.

*Commits: `b178e0b`. ~40 min (implementation was carried over).*

---

## 4. CHECKOUT — four of six

- **Held tools drop at the till.** ✅ `walkExit()` hid the shared held rig, but
  the broom draws in its **own pass** gated only on its own `active` flag — so
  hiding `heldRoot` left a broom hanging over the checkout camera. Switched off
  on the way out, re-armed on the way back.
- **The customer takes the bag in one hand.** ✅ `ReceiveBag` raised *both*
  shoulders. Needed a new `elbL` override because both elbows shared one value,
  so a single bend could not say "one arm working, one resting".
- **The reader screen is straight.** ✅ `TERMINAL_FLOAT_ROLL` was −0.075 rad =
  **4.3°** about the device's own face axis — enough to read as crooked without
  reading as deliberate, with every horizontal in the UI sloping together. The
  facing solve's own comment already claimed "yaw-only facing, no pitch or roll"
  while this constant quietly rolled it. Now true. **Verified by looking**
  (`checkout-round7/07-card-inserted-closeup.png`): bezel, keypad rows and body
  all level.
- **The card is the reader's scale.** ⚠️ Implemented, **not visually confirmed.**
  Both assets are authored life-size — `payment_card.glb` 0.0856 × 0.054 (a real
  credit card), `payment_terminal.glb` 0.100 wide — so a card in that slot should
  be ~86% of the reader's width. The reader is presented at 1.85× while the card
  hung off `root` at 1.0 and inherited none of it. It now tracks the reader's
  current scale through the whole rise, and returns to life size in a hand. **But
  the card is not visible in the card-inserted render** (what looks like one is
  the keypad's backspace key), so this rests on measured asset dimensions and the
  scale chain, not a picture. **Please look at this one.**
- **The cash hover highlight.** ⏸️ Already an outline shell rather than a flat
  overlay — that landed in round 7. I did **not** re-verify it visually this
  session, so I am not claiming it looks right, only that the blob is gone by
  construction.
- **The status UI.** ❌ **Not done.** "Ready for next" still sits flush against
  the bottom with no margin, and the panel still reads cluttered. This is the one
  checkout item genuinely outstanding.

*Commit: `de1fb87`. ~50 min.*

---

## 5. THE SIGN TURNS VISIBLY ✅

`applyFacing()` assigned the target yaw outright, so the card teleported through
180° between two frames — you flipped it and it had simply always been that way.
It now swings over 0.28 s, smoothstepped so it starts, travels and settles. The
sound already existed; it now has something to belong to. The yaw is still
derived from `signIsOpen()` rather than tracked alongside it, so the animation
interpolates *to* the state instead of becoming a second copy of it.

*Commit: `3338043`. ~20 min.*

---

## 6. DIRT VISIBILITY — already built, verified, not rebuilt

All three halves already exist and work: hold-**Q** reveal through geometry, the
**Tab** overview lighting standing columns over every remaining pile with a count
in the toast, and the reticle prompt when the crosshair is over cleanable dirt
within the tool's own reach.

Verified live rather than asserted from code: `tools/qa/dirt-visibility.js`
returns `ok: true, problems: []` — alpha 0 idle → 1 held, **18 clusters** marked,
`drawsThroughGeometry: true`.

You asked for both halves to be built. They were, in an earlier session. I have
not rebuilt them and did not pad the session by re-verifying beyond one run.

*~10 min.*

---

## 7. NOT STARTED — and why

**4. Tee times**, **6. the 12-file texture pass**, **7. the two structural
assembly defects (061, 099)**, **8. laptop relocation to B-stand**, **9. load
time**, **11. mechanical debt.**

The queue assumed the broom was a polish pass. It was two geometry bugs that
three previous rounds had been tuning *around*, and diagnosing it properly — the
handle-length arithmetic, the lens arithmetic, the arm-reach clamp, the dead-key
audit and its own failed first instrument — took about three hours. The sign
regression took another fifty minutes of bisecting, and it was mine.

I flagged this rather than shipping shallow versions of six more items. In
particular **item 6 (the texture pass) should not be started in a partial
session**: twelve assets sourced, UV'd, palette-solved and memory-checked is a
long unbroken run, and half of it is worse than none.

**Suggested order next time:** item 9 (load time — profiling is self-contained
and the 18.2 s number is embarrassing), then item 4 (tee times — small and
player-facing), then item 6 as its own session.

---

## Standing-rule compliance

- **Every new instrument got a negative control before its result was trusted.**
  Three fired: the broom-aim probe caught a driver that photographed an unequipped
  broom (`vmActive: false`); the sweep probe proved 0.00 rad idle vs 0.58 rad
  swept; the feel-key audit reported all 102 keys dead and was thrown away until
  the control passed. A fourth near-miss is in §1 — I nearly cited a 2.5-hour-old
  render as evidence of a fix.
- **Numbers are the measured ones**, throughout.
- **Presentation was verified by looking**, at 1× and at 8× crop where the detail
  mattered — except the card scale, which is called out as unconfirmed in §4.
- **Full suite green before each commit:** 2693 pass / 0 fail at every commit.
- **Committed incrementally and pushed:** `b178e0b`, `fa4c534`, `de1fb87`,
  `3338043`, all on `feature/pro-shop-vertical-slice`.
