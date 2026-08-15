# Full Goal 16

All night. All authorised. Never stop to ask. Work in the order below — it is
priority order, not convenience order.

**Every line in this document is an INSTRUCTION, not a defect report.** Do the
thing it says. Last session an item phrased as a state ("no hands visible on any
handheld tool") was read as a bug to repair rather than a change to make, and
hours went into proving the opposite of what was wanted. If a line here is
genuinely ambiguous, do the reading that changes the game rather than the one
that preserves it, and say in the report which you took.

## Standing rules

Electron only, never Chrome. `npm run dev -- --clubhouse=pine-hills-v2`.

A green suite is not evidence. Fixes on this project have shipped green with no
effect in the game more times than anyone can now count.

Every visual or interaction item needs a screenshot from the running build at the
player's camera, or it is UNCONFIRMED — not complete.

Every new instrument gets a negative control before its result is trusted.

Where you report a number, report the measured number.

Full suite green before each commit. Commit incrementally and push.

If an item turns out bigger than it looks, say so in the report rather than
shipping a shallow version of it. That call has been right every time it has
been made.

---

# A — PERFORMANCE. This is a regression and it comes first.

## A1 The game is far laggier than it was before the last session

Worst on first load, on picking up the ledger, and on turning the ledger's pages.

**Suspect your own work first.** Two changes from the last session are the
obvious candidates and both were shipped without a performance check:

- All nine tools were rebuilt and every one went **up** in triangle density.
  Broom 359→411, mop 502→551, cloth 611→614, sponge 910→979, dustpan 560→615,
  trashbag 673→740, vacuum 770→827, spray 1602→1668.
- The ledger gained a dedicated spine light (0.85 m, decay 2) and seven live page
  summaries, all read on open.

Measure against the commit immediately before the tool rebuilds. Report the
frame-time delta attributable to each change, ranked, at the same fixed poses
your existing profiler already uses. Then fix it.

Report before and after fps and 1% lows. Both numbers, at the same poses.

If a tool's new geometry is the cost, say which parts and by how much. Bevels and
side counts were raised on shafts held under a yard from the lens; a 20-sided
pole at that distance may not be buying anything a 14-sided one was not.

## A2 The ledger's cost specifically

Opening the book and turning its pages are the two worst moments. You already
found and partly fixed this once — the open was 112 ms and came down to 71 ms by
moving `readModel()` and the first `paintSpread()` into a walk-up prewarm.

71 ms is still a visible hitch, and page turns were never profiled at all. Both
paint two 768px canvases and upload them. Profile them properly and get the open
and every turn under 16 ms, or explain in the report exactly what stops you.

The prewarm is keyed on the day and the review/history counts. Check that key is
actually holding — if it misses, every walk-up repaints.

## A3 Remove the game speed-up entirely

Sped-up customers look absurd and I do not want the feature.

Delete the speed ladder above 1x, and every path that reads it. That includes the
NPC decision/locomotion split built for SIM-TIME-001, the perf harnesses that set
`speedIdx`, and any QA driver that relies on fast-forward to reach a state — those
need to reach it another way or say they cannot.

Report what the day length is now and how long a full trading day takes in real
minutes at the only speed that exists.

---

# B — MOP AND BROOM. Nothing else in the tool set this session.

Six rounds have now failed on these two objects, and the reason is structural:
you cannot see the game and I cannot edit the values. Fix that before anything
else in this section.

## B0 The divergence is the finding, and it is your first job

You have measured, with passing negative controls:

- mop strand tips travelling **0.2546 yd** carried and **0.1082 yd** mopping,
  against a frozen control reading exactly 0
- the broom's palm holding within **2–4 mm** of the shaft's own axis across the
  entire pitch sweep, both controls passing at every sample
- hand pixels counted in real screenshots at every pitch from boots to shelves,
  with a hidden control at 0

I am telling you the mop's strands **do not move at all**, and the broom's hand
**is not on the broom when I move**. Both cannot be true.

0.25 yd of tip travel on an object held less than a yard from the lens would be
impossible to miss. So your numbers are very probably correct about something
that is not what I am looking at. Find out which, and do it **before changing any
geometry or any config value.**

Candidates, in the order I would check them:

1. **Are you measuring the drawn meshes, or a rig whose output something
   downstream overwrites?** You have already found this exact shape twice: the
   floor-anchor solve computed the right correction and had it thrown away by the
   idle rest-pose reset, and the rig plants the head regardless of reach. A rig
   that updates and is then overwritten measures perfectly and draws nothing.
2. **Do your drivers reach the state I am in?** You call `walk.setSpraying(true)`
   and write `walk.state.pitch` directly. I hold a mouse button and move a mouse
   under pointer lock. The D-key failure, the Q double-binding and the
   paused-sim measurement were all exactly this gap.
3. **Does your camera framing match mine?** Your drivers pitch down to bring the
   head into frame. I do not — I look where the game puts me.
4. **Is my build your build?** Stale packed assets, a cached GLB, a variant
   mismatch. Delete the pack cache, rebuild from source, and confirm the GLB the
   game loads is the one you last built. If the hashes differ, that alone
   explains every measurement in this section.

Report which of these it was, with evidence. If it is none of them, say so
plainly — that is a real finding too and it changes what we do next.

## B1 Reproduce my experience, on video

Real keyboard, real mouse, real pointer lock. No API state forcing. The default
camera at the default pitch. Nothing framed for a probe.

Equip the broom. Walk forward. Turn. Sweep. Then the same with the mop.

Record it. **Watch it.** Then tell me in words what you see.

If it looks wrong to you too, say so — that is the first time in six rounds we
will have been looking at the same thing, and it is worth more than any number.

## B2 Build me a live tuning overlay

**This is the deliverable I most want out of tonight.**

A dev-only in-game panel with sliders for every value that governs how the mop
and broom look and feel:

- hand anchor x, y, z
- grip roll, upper and lower
- hand scale
- arm pose: elbow offsets, forearm length, depth scaling
- strand and bristle stiffness, lag, splay, slack
- sweep arc, stroke rate, hand follow radius, wrist roll
- weight: lag Hz, damping, settle
- carry hover and the plant blend window

It must update the held tool **live as I drag**, with no reload and no re-equip.
A button writes the current values back to the config file so what I tune is what
ships.

Show the numbers beside each slider, and show the diagnostics that matter — head
above floor, hand NDC, palm-to-shaft distance — live, in the same panel, so I can
see your instruments agree or disagree with my eyes in real time.

Six rounds have failed because of the gap between your measurements and my
screen. This closes it permanently, for every future feel question, not just
this one. **Build it before another diagnostic pass if that is quicker.**

## B3 The broom has no bristle motion at all

Only the mop got strands. The broom's bristles are still one solid block, which
is why "nothing changed" is literally true for the broom.

Give the broom real bristles: they splay against the floor when the head is
planted, trail behind the stroke, and settle when you stop. Same standard as the
mop, sized for a stiff push broom rather than soft yarn — shorter travel, faster
settle, less slack.

## B4 Fix the plant you logged and did not fix

Your own note from last session: *the rig plants the tool head on the floor
regardless of whether the handle can physically reach.* That is why the plant
number read 0.073–0.084 yd for every candidate in your sweep, including one two
yards below the eye.

It has been sitting in the report unfixed and it is very likely upstream of the
hand reading as detached — a head pinned to the floor while the hands are
somewhere the handle cannot span means the shaft is being drawn between two points
that do not belong to the same object.

Fix it. The head plants when the handle can reach and does not when it cannot.

## B5 Perfect the hand position and grip on both

This is the core verb of the game. A player does it for twenty minutes at a
stretch. It gets whatever time it needs.

Once B0 through B4 are done and the overlay exists, tune it — and tell me what
values you landed on so I can move them myself afterwards.

## B6 Leave the other seven tools alone this session

---

# C — THE LEDGER

## C1 The open takes too long and freezes me first

I click it, control is taken away, a long animation plays, then the page appears.
Shorten the animation and **never take control away from me** — if the book needs
a moment, let me keep looking around while it happens.

## C2 Make the pages look better

Typography, ruling, ink weight, margins, the paper itself. It reads as a canvas
with text on it rather than a page.

## C3 Words overlap in several places

Fix them, and fix the class rather than the instances: measure every string
against its box before drawing, on every page, at full content and at empty.

Your existing truncation recorder already does half of this. Extend it to record
**overlaps**, not just cuts, and add the ledger's pages to the fit test the front
desk already has.

## C4 The section locks look unaligned and sloppy

Align them. The "Firsts" page is the worst.

## C5 Page turns are laggy

See A2. Under 16 ms.

## C6 A and D turn pages AND walk my character

When A and D are my movement keys, turning a page also moves me. Consume the key
while the book is open, the way the register and laptop already do.

---

# D — SETTINGS

## D1 The resolution list is wrong

My monitor is 4K. The list tells me 1440p and 4K are bigger than my display.

You are reading the window, not the display. Read the actual monitor — Electron's
`screen.getDisplayMatching()` gives you the real work area, and you already call
it. Something downstream is comparing against the wrong number.

Report what my display actually reports and what the list now shows.

## D2 Translate all ten languages properly

Not machine-drafted placeholders marked UNREVIEWED. Actual translations for every
key, in all ten.

You were right to decline this when it was 1,551 hardcoded strings against 59
routed through `t()`. The settings screen is migrated now, so start with the
strings that already go through the table and get those genuinely right in all
ten. Report the key count and the coverage per language, honestly, and say what
is still English.

## D3 Rebinding must update the general controls display

Changing a key in Settings → Controls must change it in the formatted controls
list too, in the same nice layout, immediately.

## D4 The scrollbar is in the wrong place

It sits around the whole panel, so it looks like the entire page is scrolling
when only the movement section is. Put the scrollbar inside the scrolling section
and nowhere else.

## D5 Spacing

Add padding between the reset-to-defaults button and the bottom of the page.

Then sweep the whole panel for the same class of fault — controls flush against
edges, sections with no breathing room, rows that touch — and fix all of them.
Screenshot every settings page before and after.

---

# E — AUDIO. Make the game feel alive.

## E1 A click on every button, everywhere

Menus, settings, the laptop, the register, the ledger, the desktop UI. Every
button. If it can be pressed, it makes a sound.

## E2 Sounds for everything physical

The register drawer opening and closing. Coins and notes. The card reader beep
and the key presses. Entering and leaving the cashier station. Footsteps that
change with the surface. The ledger opening, closing, and each page turn. Doors.
The sign flipping. Boxes opening. Every tool's contact.

Layered — a start transient, a body, a tail — and pitch-varied so repeats do not
grate. Report what you added and which are placeholders.

---

# F — CHECKOUT

## F1 Q and the cashier

With the mop out and Q held, walking up to the register and entering it must go
**straight to the cashier**. No map, no Q overlay, no dirt reveal. I should not
have to release Q and swap to empty hands first.

## F2 Overlapping text on the tee-time screen, and everywhere else

The tee-time request UI runs its own text over itself: "x am is open" overlaps
the line below it, and the first available time sits under the line showing what
they asked for.

Fix that screen, add padding between the two bottom boxes and the page edge, and
then **sweep every screen in the game for overlapping text and fix all of it.**
The front desk, the laptop, the ledger, the HUD, the menus, the register glass.

Report every overlap you found, with the screen and the strings.

## F3 Items must physically go into the bag

They currently shrink and vanish, which reads as fake. Let the item travel into
the bag's mouth and go out of sight because the bag is around it, not because it
scaled to nothing. If it needs to be occluded rather than truly inside, occlude
it — but nothing shrinks.

## F4 Cash with cents, matching what they paid, in realistic denominations

Three things:

- The cash on the desk includes **coins**, not just notes.
- The amount on the desk **matches what they handed over**. If they pay $40 on a
  $35.31 total, I see $40 on the desk.
- The amounts are **realistic**. Nobody hands over $29.96 to get four cents back.
  People pay round — a twenty and a ten for $27.40, not exact change to the penny.
  Model how people actually pay: notes plus maybe coins for the odd amount, or
  round up to the next note.

## F5 Move the customer and their cash right

The bag blocks them. Move the customer's stand point and their cash placement to
the right so neither is behind the bag.

## F6 Cash and card are different gestures

- **Cash:** they lay it on the desk and take their hand back. They do not stand
  there holding it out.
- **Card:** they hold it up and keep holding it until I take it.

## F7 Multiple customers at once, scaled by how the course is doing

More than one in the shop at a time, and the number depends on rating, reputation
and green fee — a well-run cheap course is busy, a neglected expensive one is
empty. You built the formula already; the cap was the starter tier's 2. Raise the
ceiling so the formula can be seen, and report concurrency at low, mid and high
standing.

## F8 FLOW BUG — a customer took items and left without paying

I watched someone walk in, pick up items, ask for a tee time, and leave. They
never put the items on the desk for me to scan and I was never able to charge
them.

**The flow I want, for a customer doing both:**

1. They collect items from the shelves.
2. They come to the desk and **put the items down.**
3. I scan each item.
4. **Then** they ask for their tee time — either a slot they want, or checking in
   against one they pre-registered.
5. I book or check in the tee time.
6. I charge them for **the items and the green fee together**, one transaction,
   one payment.

Find why the current path lets them leave with the goods, fix it, and report the
flow you built step by step. Verify it by watching a combined visit end to end.

---

# G — CHARACTERS

## G1 Their stomachs pump and detach while walking

The torso separates visibly. Fix the rig so the body reads as one piece in
motion. Screenshot four customers mid-stride, before and after.

## G2 Eyebrows and moustaches float in front of the face

Seen from the side they sit off the skin with a visible gap. Seat them on the
surface. Screenshot a customer's profile at conversational distance, before and
after.

---

# Reporting

Write `Designs/ProShop/OVERNIGHT_REPORT_16.md`.

Per item: what changed, how it was verified, the screenshot or clip path, and
whether it meets the twenty-minute-stranger bar — yes or no.

Close with UNCONFIRMED, NOT DONE, and anything you fixed that I did not ask for.

Reserve the last 30 minutes to commit, shelve anything half-done so the tree runs
clean, and write the report.

**Read B0 before you start B. It is the item most likely to change what the rest
of the night looks like.**