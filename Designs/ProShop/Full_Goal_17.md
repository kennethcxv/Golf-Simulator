# Full Goal 17

**I am away for two days and cannot answer anything.** Work continuously until I
physically stop you. Do not stop when a section is done, do not stop when the
queue looks empty, and do not stop to ask. Compact your context whenever you need
to and keep going.

This document is deliberately longer than two days of work. **You are not
expected to finish it.** What I want is depth: take your time on each item, get it
genuinely right, and move on. A shallow pass over everything is worth less to me
than five items done properly.

**Every line here is an INSTRUCTION, not a defect report.** Do the thing it says.
If a line is genuinely ambiguous, take the reading that CHANGES the game rather
than the one that preserves it, and record which you took.

---

# HOW TO RUN THIS

Five phases per section, repeated for each section. Do not plan the whole document
up front — a plan written two days ahead of the work is worthless.

## Phase 0 — Explain the section back to me, in your own words

**Before planning, before reading any code**, write into the plan file what you
believe each item in the section is asking for, in your own words, as an action
you are going to take. One or two sentences each.

This exists because of a specific failure. An item phrased as a state — "no hands
visible on any handheld tool" — was read as a defect to repair rather than a
change to make, and several hours went into proving the opposite of what was
wanted. Writing the item back as a verb catches that in thirty seconds.

If your restatement and the brief disagree, the brief wins. If you cannot tell,
take the reading that changes the game and say so.

## Phase 1 — Plan the section

Append to `Designs/ProShop/PLAN_17.md`. For each item:

- what you will change, at file level
- how you will verify it **in a running Electron build** — the specific driver,
  screenshot or measurement
- the negative control that would catch the instrument being wrong
- **the definition of done, in one sentence a player would recognise.** Not "the
  metric reads under X" — "the strands visibly trail the head when I walk."
- what you expect to be hard, and what you might get wrong
- rough time

## Phase 2 — Adversarial review of the plan

Spawn four reviewers. Give all four this context: **44 instrument faults are
logged in this project, and six consecutive rounds on the mop and broom shipped
measurements that disagreed with what the player sees on screen.** Their job is
not to improve the implementation. It is to predict where the plan produces a
false green.

- **Reviewer 1 — VERIFICATION.** For each item, can the stated check actually
  fail if the fix does not work? Name every check that would pass on a broken
  build.
- **Reviewer 2 — HISTORY.** Read `HARNESS_DEBT.md`, `DEFECTS.md`,
  `TOOL_STANDARD_AUDIT.md` and the last five overnight reports. Which items
  repeat a mistake already made here? Cite the prior instance.
- **Reviewer 3 — THE DIVERGENCE.** For every item, would this plan detect that
  the PLAYER sees something different from what the instrument reports? That gap
  has recurred in the D key, the Q double-binding, the paused sim, the wrong
  lens, the bounding box, the tone-mapped magenta and the mop strands. Find where
  this plan is exposed to it again.
- **Reviewer 4 — BLAST RADIUS.** What else does each change touch? Which previous
  section could this silently break? Name the specific check that would catch it,
  and if none exists, say so.

Write every objection into the plan with your written answer beside it — accepted
and how, or rejected and why. Do **not** require agreement to proceed. Answer
them and go.

## Phase 3 — Implement

Work the section. If reality contradicts the plan, follow reality and record the
divergence. Several of this project's best findings came from a plan being wrong.

## Phase 4 — Adversarial verification of the section

Spawn verifiers. They do **not** read code. They run the game and try to prove
your claims false. A screenshot showing the defect still present beats any
assertion.

For a tools section: real keyboard, real mouse, real pointer lock, no API state
forcing, the default camera. For a UI section: every screen, every state, at the
default resolution. For a performance section: the actual moments named, timed.

**Anything a verifier breaks goes back on NOT DONE, however it was reported. Then
fix it before moving on.** A verifier finding is not a note for later — it is the
next item.

If a verifier disproves something you claimed, say so at the **top** of the
report.

## Phase 5 — Regression gate, after every section

Before starting the next section, run all of these. Any failure is fixed
immediately, not logged:

1. **The invariant suite** (see below). All of it.
2. **The 60-second walk.** Boot cold, walk in, open a door, open the ledger, enter
   the register, equip a tool. Record frame times. Nothing over 16 ms except the
   first frame.
3. **Every previous section's verifier**, re-run. This is how eight sections over
   two days avoid quietly undoing each other.

---

# STANDING INVARIANTS

These must be true after every section, forever. Build a single command that
checks all of them and run it in Phase 5. Where an invariant has no check yet,
write one.

1. **No frame over 16 ms during normal play.** Not on load, not on a door, not on
   the ledger, not on a settings change.
2. **No text is ever cut off.** No ellipsis, no fade, no clipping. Anywhere.
3. **No text ever overlaps other text.** Anywhere.
4. **No UI element touches the edge of its container.** Everything has margin.
5. **The four stick tools have visible hands; the five hand-worked tools have
   none.** Both halves, or a build that lost hands everywhere passes.
6. **Nothing the player carries is ever left floating, ever unputdownable, and
   never allows a tool swap.**
7. **No NPC is stuck for more than 3 seconds.** See G10.
8. **Every player-facing string goes through `t()`.**
9. **No duplicate keys in any object literal.** The lint exists — keep it green.
10. **The suite is green and the tree is clean at every commit.**

---

# RULES

Electron only, never Chrome. `npm run dev -- --clubhouse=pine-hills-v2`.

A green suite is not evidence. Fixes have shipped green with no effect in this
game more times than anyone can count.

Every visual or interaction item needs a screenshot from the running build at the
player's camera, or it is UNCONFIRMED — not complete.

Every new instrument gets a negative control before its result is trusted.

Where you report a number, report the measured number.

**Commit and push after every item**, not at the end. If you stop for any reason,
whatever is finished must be banked.

If an item turns out bigger than it looks, say so rather than shipping a shallow
version. That call has been right every time it has been made.

---

# REQUIREMENTS FOR SUCCEEDING AT THIS

These are here because I have watched a great deal of effort produce measurements
instead of results. Read them as part of the brief.

## 1. Build a tuning overlay before you tune anything

Six rounds on the mop and broom have failed for one structural reason: **you
cannot see the screen and I cannot edit the values.** Every round has been you
guessing a number, measuring it, and me telling you it looks wrong.

Build a dev-only in-game panel with live sliders for every value that governs how
a tool looks and feels — hand anchor x/y/z, grip roll, hand scale, arm pose, elbow
offsets, strand and bristle stiffness, lag, splay, slack, sweep arc, stroke rate,
hand-follow radius, wrist roll, weight, damping, carry hover, plant blend. It
updates the held tool **live as I drag**, no reload, no re-equip. A button writes
the values back to the config file so what I tune is what ships.

Show the relevant diagnostics live in the same panel — head above floor, hand NDC,
palm-to-shaft distance — so I can watch your instruments agree or disagree with my
eyes in real time.

**Build this first.** It is the highest-value thing you can produce unattended and
it makes every future feel question cheap.

## 2. When a measurement disagrees with what I report, the disagreement is the finding

Do not re-run the measurement and tell me it is fine. Do not conclude I am
mistaken. Find out what the number is actually about.

The recurring shapes, all from this project:

- a rig computes the right value and something downstream overwrites it (the
  floor-anchor solve, thrown away by the idle rest-pose reset)
- the driver reaches a state the player never occupies (`speedIdx 0` is paused,
  not 1x; `walk.setSpraying(true)` is not a held mouse button)
- the driver projects through a lens that did not draw the thing
- a bounding box is measured where a pixel was needed
- the asset measured is not the asset shipped (a stale packed GLB)

**Before any work in the tools section: delete the packed asset cache, rebuild
from source, and confirm the GLB hash the game loads matches the one you built.**
If they differ, that alone may explain six rounds of tool measurements.

## 3. Reproduce my experience before diagnosing it

Real keyboard, real mouse, real pointer lock, default camera, no state forcing,
nothing framed for a probe. Record it. **Watch it.** Then say in words what you
see. If it looks wrong to you too, say so — that is the first useful thing.

## 4. Copy an existing game rather than inventing

For the mop and broom, the reference is House Flipper. For checkout and bagging,
the references are Supermarket Simulator and TCG Card Shop Simulator. Search for
footage, study it, describe in the report what they do that we do not, then match
it. Do not design from first principles when a shipped answer exists.

## 5. Never take control away from the player

Any animation that freezes input is wrong unless I asked for it. If something
needs time, let me keep looking around while it happens.

## 6. Fix the class, not the instance

Every item in this brief that names one broken thing is naming a family. One
overlapping label means auditing every label. One floating carried object means
auditing every carryable. One missing put-down verb means auditing every verb.
Report the size of the family you found and the count you fixed.

## 7. Performance is a feature and it has a budget

No single frame over 16 ms during normal play. Name the budget for each thing you
add and measure against it. If a change costs frame time, say how much in the same
breath as shipping it.

## 8. Build the test that would have caught it

Every fix gets a check that fails on the unfixed build. **Prove that: break it,
watch the check go red, restore.** A check you have not seen fail is not a check.

## 9. Before writing any instrument, check it against the fault list

`HARNESS_DEBT.md` holds 44 logged instrument faults. Read the list before building
a new probe and say in the plan which of those shapes your probe could take.

## 10. Screenshot the state you changed, at the default camera

Not a probe pose. Not a crop framed to flatter. What the player sees, from where
the player stands.

---

# A — PERFORMANCE. First, and it is a regression.

The game is far laggier than before the last session. These are moments I
measured by playing.

## A1 The first 30 seconds after entering the game

Laggy throughout, then it settles.

You have established the shape: first-visit shader compiles at roughly 34 ms per
program, and 42 programs arriving after the load veil lifted. The prewarm covers
geometry from one pose, but a program's cache key also carries the light counts,
the shadow map size and the clipping planes — properties of the **frame**, not the
geometry.

Fix it properly. The player must not pay for compilation during play. Options
worth measuring: warming both light states behind the veil (you tried once and it
did not move the number — find out why), interning materials so 745 programs
collapse toward 274, or extending the veil until the scene is genuinely warm and
telling the player what it is doing.

Report the measured frame times through the first 30 seconds, before and after.

## A2 Opening a door is laggy

Every time, not just the first. Find what a door opening actually costs —
geometry, nav rebake, light re-count, shadow refit — and fix it.

## A3 Opening the ledger takes 3 to 5 seconds

The worst single moment in the game. You measured it at 112 ms once and brought it
to 71 ms; it is now seconds. Something grew enormously — most likely the seven live
page summaries, the pages being painted more than once, or the new spine light
forcing a shadow refit.

Get it under 16 ms. If that is impossible, get the **visible** delay to zero: open
instantly and fill pages in as they finish.

## A4 Changing quality presets lags

Low to Epic stutters badly. Toggling `shadowMap.enabled` recompiles every material
by design — that is correct — but it must not be paid mid-frame while I watch. Do
it behind a brief, honest "applying" state, or spread it across frames.

## A5 The game opens at 1080p and should open at my display's resolution

Launch full-window at the monitor's native resolution. Mine is 4K.

## A6 The resolution list is wrong

It says 1440p and 4K are **bigger than my display**. My display is 4K. You are
comparing against the window, not the monitor. Read the real display.

---

# B — THE MOP. Redesign it completely.

## B1 The mop is awful. Start over.

Do not patch it. Delete it and build a new one.

- **Study House Flipper's mop first.** Find footage, watch it, describe in the
  report what it does that ours does not. Then match it.
- The head, the strands, the handle, the grip, the motion, the floor contact — all
  new.
- The strands must visibly move: they trail the stroke, splay against the floor
  when planted, swing behind on direction changes, and settle when I stop. **I
  have been told they move and shown a measurement of 0.25 yd of travel, and they
  do not move at all on my screen.** Resolve that before you build — Requirement 2.
- It must look professional. Not a cone with a texture on it.

Verify on video, with real input, at the default camera. Then tune with the
overlay and report the values you chose.

## B2 The broom's head looks like a rake

The bristles read as separated tines rather than a brush. Fix the geometry: dense
bristles, a defined block, a visible ferrule.

## B3 The broom's bristles do not move

Only the mop was given strands, and they do not work either. Once the mop is
right, apply the same system to the broom, sized for a stiff push broom — shorter
travel, faster settle, less slack than yarn.

## B4 Fix the plant you logged and did not fix

Your own note: *the rig plants the tool head on the floor regardless of whether
the handle can physically reach.* That is why the plant number read 0.073–0.084 for
every candidate in your sweep including one two yards below the eye.

It is very likely upstream of the hand reading as detached — a head pinned to the
floor while the hands sit where the handle cannot span means the shaft is drawn
between two points that do not belong to the same object.

## B5 Leave the other seven tools alone

---

# C — THE LEDGER

## C1 Opening it is wrong in three separate ways

**The sequence I want:**

1. I press E. The book comes to my hands, **closed**.
2. I press E again. It opens to the first page.

**What happens now:** one E press plays a strange animation where the left side
appears already open and then swings toward the closing direction until it aligns
with the right. Replace it entirely — that is the wrong animation, not a mistuned
one.

It also takes 3 to 5 seconds (A3) and freezes me while it happens (Requirement 5).

## C2 Too much text on some pages, and it overflows

**Complaints and Fixes is the worst.** Far too much on one page.

**No string in this book may ever show an ellipsis.** If a page has more content
than fits, paginate it — the book already paginates the guest register, so use the
same machinery. Overflow is a layout decision, not a truncation.

Sweep every page at full content and at empty.

## C3 Words overlap other words

Throughout the book. Fix them and fix the class: measure before drawing, and
extend the truncation recorder to record **overlaps** as well as cuts.

## C4 The page-turn animation phases through the previous page

Flipping shows a slice of the last page through the turning leaf. Polish it —
depth sorting, the leaf's own thickness, or the order the faces draw.

## C5 The bookmark is wrong

It sits in the middle, it looks bad, and I am fairly sure it is backwards — it
should hang up and it hangs down. Fix its position, orientation and look.

## C6 Page turns are laggy

Under 16 ms. See A3.

## C7 The section locks look unaligned and sloppy

Firsts is the worst. Align them and make the locked state read as deliberate.

## C8 Make the pages look better

Typography, ruling, ink weight, margins, paper. It reads as a canvas with text on
it rather than a page from a book.

---

# D — CARRYING THINGS. A whole system, and it is broken.

Every rule below applies to **everything carryable**, not just the ledger. Find
the full set and make them all obey.

## D1 A carried thing must not be left floating

Carry the book, click the cashier, and the book stays hanging in the air where I
was standing. Whatever I carry comes with me or is put down — never abandoned in
mid-air.

## D2 There is no way to put the book down

Add one. The same verb as every other carryable thing.

## D3 Carrying something must block the tool belt

While carrying the book I can still cycle through my cleaning tools. I should not
be able to. My hands are full.

## D4 Make this one system

Audit every carryable object — the ledger, boxes, cartons, anything else — and give
them all the same rules: one pick-up verb, one put-down verb, no tool switching
while carrying, nothing left floating, and the carried thing follows me into and
out of every station.

Report the full list of carryables and confirm each obeys. Add this to the
invariant suite.

---

# E — SETTINGS

## E1 Switching presets lags

See A4.

## E2 The scrollbar is in the wrong place

It wraps the whole panel, so it looks like the entire page scrolls when only the
movement section does. Put it inside the scrolling section and nowhere else.

## E3 Spacing

Padding between the reset-to-defaults button and the bottom of the page. Then
sweep the panel for the same class of fault — controls flush to edges, sections
with no breathing room, rows that touch — and fix them all. Screenshot every page
before and after.

## E4 Rebinding must update the general controls display

Changing a key in Controls must change it in the formatted controls list too,
immediately, in the same layout.

## E5 Translate all ten languages properly

Not machine drafts marked UNREVIEWED. Real translations for every key that goes
through `t()`. Report the key count and honest coverage per language, and say what
is still English.

---

# F — AUDIO. Make the game feel alive.

## F1 A click on every button, everywhere

Menus, settings, the laptop, the register, the ledger, the desktop UI. If it can
be pressed, it makes a sound.

## F2 Sounds for everything physical

The register drawer. Coins and notes. The card reader's beep and its keys.
Entering and leaving the cashier. Footsteps that change with the surface. The
ledger opening, closing, every page turn. Doors. The sign. Boxes. Every tool's
contact with every surface.

Layered — start transient, body, tail — and pitch-varied so repeats do not grate.
Report what you added and which are placeholders.

---

# G — CHECKOUT AND CUSTOMERS

## G1 Q and the cashier

With the mop out and Q held, entering the register must go **straight to the
cashier**. No map, no Q overlay, no dirt reveal. I should not have to release Q
and swap to empty hands first.

## G2 The tee-time screen overlaps its own text, and its buttons are too tight

"x am is open" runs over the line below it, and the first available time sits
under the line showing what they asked for.

Fix that screen. Add padding between the two bottom boxes and the page edge. Add
padding between the **Full Sheet** and **Turn Away** buttons and the bottom of
that section — they are far too tight against it right now.

Then **sweep every screen in the game for overlapping text and cramped edges and
fix all of it** — front desk, laptop, ledger, HUD, menus, register glass. Report
every one you found with the screen and the strings.

## G3 Items must physically go into the bag

They shrink and vanish, which reads as fake. Let the item travel into the bag's
mouth and go out of sight because the bag is around it. Occlude if you must, but
nothing shrinks.

## G4 THE BAG SYSTEM — here is the decision, do not redesign it

I asked what other games do. Across Supermarket Simulator, TCG Card Shop
Simulator and the rest of the genre the pattern is consistent, so use it:

1. **A bag is always present** on the counter at the bagging position. The player
   never spawns one, never fetches one, and never waits for one.
2. **Scanned items go into that bag**, one at a time, and stay visible in it until
   the sale completes.
3. **When payment completes, the customer takes the bag and carries it out with
   them.** It leaves the shop in their hand. It does not vanish, and the player
   does not hand it over as a separate step.
4. **A fresh empty bag appears at the bagging position immediately**, ready for
   the next customer.

That answers all three of my questions: the bag is already there, it does not
disappear, and it is not handed over — it is taken. Build exactly that.

## G5 Cash: cents, matching amounts, realistic denominations

- Coins on the desk, not only notes.
- The cash on the desk **matches what they handed over**.
- The amounts are **realistic**. Nobody pays $29.96 to get four cents back. Model
  how people actually pay: round notes, plus coins for an odd amount, or round up
  to the next note.

## G6 Move the customer and their cash right

The bag blocks them. Move the customer's stand point and their cash placement
right so neither sits behind it.

## G7 Cash and card are different gestures

- **Cash:** they lay it on the desk and take their hand back. They do not stand
  holding it out.
- **Card:** they hold it up and keep holding it until I take it.

## G8 Remove the game speed-up entirely

Sped-up customers running at 500 mph looks absurd and I do not want the feature.
Delete the speed ladder above 1x and every path that reads it, including the NPC
decision/locomotion split and any QA driver that relies on fast-forward.

Report the day length and how long a full trading day takes in real minutes at the
only speed that exists.

## G9 Multiple customers at once, scaled by how the course is doing

The formula exists; the starter tier's cap of 2 hides it. Raise the ceiling and
report measured concurrency at low, mid and high standing.

## G10 NPCs stuck for 3 seconds must find another way

If a customer has been moving for 3 seconds without making progress toward their
target, they take a different route — even a much longer one. Not a nudge, not a
repath along the same line: a genuinely different path, and if none exists, they
abandon that stop and move on.

You measured the progress clock peaking at 1.66 s against a 2.5 s threshold and
reverted the branch because displacement always fired first. The threshold I want
is **3 seconds of no progress**, and it must fire regardless of what displacement
thinks. Add this to the invariant suite: no NPC stuck longer than 3 seconds, ever,
in any observed run.

## G11 Tee-time check-in window

Check-in opens **one hour before** the tee time and closes **at** the tee time.

- Nobody checks in at 6:30 am for a 1 pm slot. Before the window opens they are
  told to come back.
- **They cannot be late.** Past their tee time the booking is gone, and the desk
  offers them the next available slots instead.
- Report what happens to a missed booking: does the slot free up, and does it
  count against anything.

## G12 Online reservations must show on the tee sheet

A slot already reserved online appears on the sheet in a distinct muted colour —
light grey — so I can see at a glance that it is taken and someone is coming.

- I must not be able to give that slot to a walk-in.
- The sheet distinguishes three states clearly: free, reserved-and-expected, and
  checked-in.
- Screenshot the sheet with all three states visible at once.

## G13 FLOW BUG — a customer took goods and left without paying

I watched someone walk in, pick up items, ask for a tee time, and leave. They
never put the items on the desk and I could never charge them.

**The flow I want for a customer doing both:**

1. They collect items from the shelves.
2. They come to the desk and **put the items down**.
3. I scan each item.
4. **Then** they ask for their tee time — a slot they want, or checking in against
   one they pre-registered.
5. I book or check in the tee time.
6. I charge them for **the items and the green fee together** — one transaction,
   one payment.

Find why the current path lets them leave with the goods, fix it, and report the
flow step by step. Verify it by watching a combined visit end to end.

---

# H — CHARACTERS

## H1 Their stomachs pump and detach while walking

The torso visibly separates in motion. Fix the rig so the body reads as one piece.
Screenshot four customers mid-stride, before and after.

## H2 Eyebrows and moustaches float in front of the face

From the side they sit off the skin with a visible gap. Seat them on the surface.
Screenshot a profile at conversational distance, before and after.

## H3 Skin phases through the belt

Parts of the torso pass through the belt. Fix the geometry or the fit so it never
happens on any body in any pose. Check every body type and several walk poses, not
one.

## H4 Facial features pop in when a customer gets close

At distance a customer has no face; walk up and it appears. That is an LOD swap
with no blend, and the pop is worse than either state.

Either carry the features at distance, or blend the swap so there is no visible
moment. Report the distance the swap happens at and what you did.

---

# REPORTING

Append to `Designs/ProShop/OVERNIGHT_REPORT_17.md` **as you go**, not at the end.
If you stop for any reason I want the record of what was done.

Per item: what changed, how it was verified, the screenshot or clip path, and
whether it meets the twenty-minute-stranger bar — yes or no.

Keep four running lists at the bottom and update them continuously: UNCONFIRMED,
NOT DONE, VERIFIER FINDINGS STILL OPEN, and anything you fixed that I did not ask
for.

**Do not stop.** When a section is finished, run the Phase 5 regression gate, then
plan the next section and keep working. Compact whenever you need to. I will stop
you myself when I am back.