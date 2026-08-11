# Full Goal 21

Everything below comes from me playing the tip. **Every line is an INSTRUCTION,
not a defect report.** If a line is genuinely ambiguous, take the reading that
CHANGES the game, and record which you took.

---

## READ FIRST — FOUR MORE ITEMS WERE REPORTED DONE AND ARE STILL BROKEN

| Item | Reported | Reality on the tip |
|---|---|---|
| **I** loading screen | done | Unchanged. Same veil, same nothing |
| **G** NPC look-ahead | done | They still bump into things |
| **K** translations | done | 60%. It was 59% |
| **door lag** | measured as costing nothing, twice | Still lags on first approach and first open |

**This is the fourth session running where items pass their own checks and fail
in my hands.** You have found three distinct shapes of it: two populations, code
with zero production call sites, and the right object with the wrong variable.

For each of the four above, before changing anything: **say what the check
measured and why it passed.** Then look for a fourth shape, because three do not
explain all of this.

## SECTION Z — THE FOUND-FALSE LEDGER. Build this first, it is cheap.

Create `Designs/ProShop/FOUND_FALSE.md`. One row per item that has EVER been
reported done and found false by me, across every session: the item, how many
times it has happened, what each check measured, and the shape.

Then one rule, written into `CLAUDE.md`:

> **An item on the found-false ledger cannot be marked DONE again without a
> CLIP.** Real input, default camera, frames extracted and VIEWED, the frame
> that proves it named by timestamp. A number is not enough for these.

The ledger book, the NPC stuck rule and the broom are each on their third
appearance. That is what this file is for.

## SECTION Y — CLIPS, NOT SCREENSHOTS, FOR ANYTHING THAT MOVES

A screenshot cannot show a gesture, and the gesture is what keeps failing —
the ledger open, the set-down, a customer walking into a box, the mop's stroke.

**Standing rule from now on:** any DONE claim about something that MOVES ships
with a clip at the default camera, real input, frames extracted and viewed, and
the report names the frames that prove it. You already have the ffmpeg pattern
from my recording — use it on your own footage.

## THE STOP RULE STILL APPLIES

More than 5 commits or 45 minutes: STOP, write it down, NOT DONE, move on.

## STANDING RULES

Electron only, `--clubhouse=pine-hills-v2`. A green suite is not evidence. Every
instrument gets a negative control. Every fix gets a check you have watched fail.
Suite green before each commit. Commit and push per item. Every section ends with
its Phase 4 verification, and **a verifier finding is the next item.**

---

# A — THE QUEUE. Two rules, and one deletion.

## A1 Delete "IN QUEUE" entirely

Not fix it. **Remove it.** The check-in screen shows the person AT THE DESK and
nobody else. People in the line are not on the screen at all — they have not
asked for anything yet.

## A2 Customers in the front of the line NEVER leave

This is the worst bug of the night. A customer queues, waits while I serve the
person ahead, reaches the front — **and walks out before I can serve them.**

The rule:

- **Position 1 or 2 in the line: they never abandon.** Ever. However long it
  takes.
- **Position 3 or later: they may abandon** if the wait gets long, which is fair
  and is the pressure the game wants.

Verify it by watching a queue of four drain, on a clip.

---

# B — NPCs STILL WALK INTO THINGS

The look-ahead did not work. Before you touch it, say what the check measured.

What I want, plainly: **a customer never makes contact with a box, a fixture, the
counter, or another person.** They see the obstruction coming along their
intended line and change course before touching it.

The 1-second recovery rule stays as the net underneath.

Verify on a clip: follow one customer across the shop past two obstacles and a
second customer, and name the frames where the course changes.

---

# C — THE MOP AND THE HANDS

## C1 The mop is much better. It is now OVER-animated.

Real progress — thank you. Two things:

- **Too many strands.** It reads as a dense curtain rather than a mop head.
  Fewer, and let them move independently.
- **Over-animated.** Everything moves all the time, which reads as jelly rather
  than wet cotton. Damp cotton is HEAVY: it should lag, settle, and go still.
  Less motion, more weight.

## C2 The second hand still phases through, and both look low quality

The support hand passes into the shaft, and the hand meshes read as blobs at
viewmodel distance. This is hand-MESH work — fingers that read, a thumb on the
correct side — not another slider.

Screenshot both hands on the mop and the broom at the default camera, before and
after.

---

# D — THE PHONE

## D1 The mouse must work on the phone

I cannot click anything. Arrows and Enter are fine to keep, but **the mouse
clicks apps, rows and buttons** — that is the first thing anyone tries.

## D2 Better UI, better icons

The layout and the icons are placeholder-grade. Make it look like a phone
someone designed: proper app icons rather than text glyphs, a real status bar,
consistent spacing, readable type at its actual on-screen size.

Screenshot the home screen and two apps at their real size.

---

# E — THE LOADING SCREEN. It did not change.

Say what happened. Then build it: real images of the club and the course, tips
that teach something a new player needs, the club's name, progress that means
something. Thirteen seconds of a blank veil is the first thing anyone sees.

---

# F — THE DOOR STILL LAGS

Close the door on the first approach and the first open. It has been measured as
free twice and it is not free in my hands — so **reproduce it my way first**:
walk up to it from a cold boot, with real input, at the default camera, and time
the frames. Then fix what you find.

---

# G — TRANSLATIONS: 59% to 60% is not done

Finish them. If a locale cannot reach native quality, name it and say why. Report
per-locale counts.

---

# H — PERFORMANCE

Carried from Goal 20 and still open: **merge static meshes per material.** 2,413
draw calls is the measured lever. Then re-run the cap ladder and flip the default
to 120 if it paces.

---

# SECTION X — THE ONBOARDING BLOCKER. My addition, and I think it is the most important one here.

Your own stranger verifier played for twenty minutes and **never got inside the
pro shop.** It also found that the pressure washer gives no feedback on a tap,
the current task appears nowhere on screen, and the Tab overview opens onto
anonymous forest with no player marker.

Those have been sitting on a list for two sessions. They are worth more than any
polish item in this brief, because a player who cannot get through the front door
does not reach the things we have been polishing.

Fix the chain a stranger actually hits:

1. **Getting inside.** The door refuses with a message that teaches nothing about
   how to progress it. Make the path to being inside discoverable from the world.
2. **The pressure washer must respond to a tap** — a jet, a sound, a number that
   moves. Right now it is indistinguishable from a broken tool.
3. **The current task must be visible on screen.** The objectives card exists in
   the DOM and never renders. Fix that, and put the current task where a player
   looking for it would look.
4. **The Tab overview needs a player marker and a legend.**

Then re-run the stranger and report how far they get.

---

# PHASE 4 — ADVERSARIAL VERIFICATION, ending every section

Verifiers do NOT read code and do NOT treat the report as evidence. Real
keyboard, real mouse, real pointer lock, default camera, no state forcing.

**VERIFIER 3 — THE STRANGER runs FIRST**, before any fix, and again at the END
after section X, so I can see whether the onboarding work moved them.

**VERIFIER 1** — the four regressions at the top, plus A2 (the queue abandon
rule) and B (the NPC contact rule), on clips.

**VERIFIER 2** — everything else claimed DONE this session.

Anything a verifier breaks goes back on NOT DONE and is fixed before you move on.

---

# REPORTING

`Designs/ProShop/OVERNIGHT_REPORT_21.md`, as you go, under 2,000 lines.

Five running lists, and **the found-false ledger from section Z is now the
permanent home of the fifth** — the report points at it rather than repeating it.