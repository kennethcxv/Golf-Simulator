# OVERNIGHT REPORT 6

Session of 2026-08-03. Ranked by what to read first.

**Queue A is done except part of A8. Queue B was not started.** A1–A7 are
complete, measured and pushed. A8 got two of its four parts. B9, B4, B7, B8,
B11 and B6 were not begun.

Every commit ran the full suite green. Eight commits, all pushed to
`feature/pro-shop-vertical-slice`.

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

## 7. A8 — two of four. This one is bigger than it looks.

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

**Not done, and I would rather say so than ship a shallow version:**

- **The sleeve asymmetry is real** — I have it on camera. The left arm shows a
  green cuff partway along; the right exits bare. Both arms run the same solve
  with mirrored offsets, so it is not the arm code. The two wrists sit at very
  different depths on the shaft, so one elbow (where the cuff lives) projects
  inside the frame and the other projects outside it. Fixing it properly means
  placing the cuff by *screen* distance from the wrist rather than by world
  distance along the arm — a change to how the arm is composed, not a constant.
- **The hand pose is still anatomically wrong.** Bigger, but the lower hand
  reads as a pale ovoid with a thumb rather than fingers wrapped around a shaft.
  This wants reference footage and a real grip pose, which is the job you
  originally asked for.
- **The look-up float** — not investigated. The tool declares
  `floorAnchored: true` with the comment "the head stays down when you look
  about", so something is overriding it; I did not get to find what.
- **Which tool cleans which surface** is a *feature*, not a polish item: dirt
  that reads as its own type, and a hold-to-reveal filtered by the equipped
  tool. That is its own session.

*~50 m.*

---

## 8. What I did not start, and the order I would take it

**B9 (load time), B4 (tee times), B7 (061/099 geometry), B8 (laptop to
B-stand), B11 (mechanical debt), B6 (the 12-file texture pass).**

Queue A ran to about eight hours. A1 alone was a state-machine bug with two
independent causes, and A5 turned out to need the summary column rebuilt rather
than padded. I would take **B9 next** — profiling is self-contained and 18.2 s
is still the worst number in the project — then **B4**, then **A8 properly** as
its own block, then **B6** last and unbroken as you specified.

---

## 9. Two things found on the way, recorded rather than fixed

1. **Writing `state.shop.progression.tier` at runtime throws
   `fixtureSockets is not defined`** out of a rebuild path. An exception inside
   the frame callback stops the loop: the clock froze at 840.04 and every shop
   measured zero, which reads exactly like a scaling failure. It cost me a run
   before I traced it. Not A7's to fix, but it is a live crash on a supported
   state change.
2. **The reader's backspace key needs a GLB edit** (§3). Hash-gated kit.

## 10. Instrument failures I caught before using them

Stated because the standing rule is that a new instrument gets a negative
control, and three of mine failed theirs:

- The card-seat probe identified the card by ISO-ish proportions and **matched a
  broken floor tile 257 yards away**, then reported a confident seating number
  about it. Now identified by `userData.kind === 'payment-card'`.
- The key-occlusion probe counted each coloured key's own drawn label as an
  occluder and reported confirm/clear/backspace blocked by themselves.
- The monitor-layout probe reported **616 for every case** — the panel's own
  border, which is by definition the lowest thing drawn and says nothing about
  where the buttons landed.

And once more, the one from last session: I nearly read the broom arm zoom crops
as current evidence. They were **eleven hours old** — only the pitch renders
re-shoot on that driver. Checked the mtimes first, which is the only reason that
is a note here and not a correction.
