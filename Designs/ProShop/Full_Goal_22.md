# Full Goal 22

Everything here comes from me playing the build, plus everything left unfinished
from Goals 20 and 21. **Every line is an INSTRUCTION, not a defect report.** If a
line is genuinely ambiguous, take the reading that CHANGES the game, and record
which you took.

---

## READ FIRST — THREE MORE ITEMS ARE FOUND-FALSE, AND ONE IS ON ITS THIRD PASS

| Item | Reported | Reality |
|---|---|---|
| **Main menu sound** (Goal 20 H1) | done, one delegated listener, a test pinned it | Silent. New Game, Settings, everything |
| **Items in the bag** (Goal 19 C1, Goal 20 E1) | done twice — "insideFrac 1", then "a long item stands up" | Big items still stick out |
| **Buy AND book in one visit** (M1, then Goal 17 G13) | done twice, with a measured split | **I have never once seen it happen** |

Add all three to `FOUND_FALSE.md` with what each check measured. Per the rule
you wrote, **none of them can be marked done again without a clip whose frames
you have viewed.**

The menu one is worth dwelling on: a source test asserted the listener exists and
a driver confirmed buttons respond visibly. Neither could hear anything. **A test
that cannot perceive the thing it certifies is not a test of that thing** — which
is the whole subject of section A.

## THE STOP RULE IS PER ITEM

More than 5 commits or 45 minutes **on one item**: stop, write it down, NOT DONE,
move on. It is not a session budget. Keep going and keep committing per item.

## STANDING RULES

Electron only, `--clubhouse=pine-hills-v2`. A green suite is not evidence.
Anything that MOVES needs a clip with its frames viewed. Every instrument gets a
negative control. Every fix gets a check you have watched fail — **and assert the
revert changed the file.** Suite green before each commit. Commit and push per
item. Every section ends with its Phase 4 verification.

---

# SECTION 1 — THE FRONT DOOR. Alone, first, and nothing else until it is done.

**Two strangers have now played this game for a combined 45 minutes and neither
has ever got inside the pro shop.** Everything else in this brief is polish on a
room nobody can reach.

You have already fixed two of the three reasons — the warp trap and the dead
trigger. The third is still there, and it is the one that matters:

## 1A "Clear the entrance" maps to no verb a player can find

The threshold debris ignores **E and X in silence**. No pickup, no prompt, no
refusal message. And the tool belt on the porch holds washer, hose, divot kit and
rake — **there is no broom and no debris bag**, while a Debris bag sits
unconnected in the tablet's equipment list.

Make clearing the entrance a thing a player can discover and do:

- the debris is aimed at and named by the crosshair, like every other prop
- a verb that works, with the tool it needs available where the task is
- **a failed E or X says why.** Silence is the defect, not the refusal

## 1B Then walk it yourself, cold, and get inside

From a fresh profile, with real input, no concessions, no teleports: boot, clear
the entrance, wash the porch to 60%, repair the doors, open them, stand inside.
**Record the whole thing as one clip** and name the frame where you cross the
threshold.

If any step cannot be completed, that step is the next item.

---

# SECTION A — AUDIO. The structural problem first.

## A1 Every sound in this game is synthesized, and that is why it sounds wrong

`src/core/audio.js` builds every effect from oscillators and filtered noise. That
is why the ledger sounds, in my words, **staticy and like electricity** — because
that is what it is. A page turn is broadband fibrous noise with a specific decay;
an oscillator cannot be it, however carefully tuned.

**Stop tuning synthesis and bring in real recorded audio.** CC0 or CC-BY sources
(freesound.org, Kenney, ambientCG's audio, any pack with a compatible licence).
Wire a small sample player alongside the existing synth so both can coexist, and
migrate the sounds that most obviously need it:

- **the ledger**: a leather creak on the lift, a real paper sweep per page turn, a
  dull board thump on the close
- **the menu**: a click on every button
- **cash into the register**: the drawer, the notes, the coins

Report the licence of everything you add, and put the attribution file where a
shipped build would carry it.

## A2 The main menu is still silent. Fix it and prove it with audio.

The check that passed asserted a listener exists. **Build a check that can
perceive sound**: wrap the audio graph and record what actually plays when each
menu button is pressed — the node created, the buffer, the time. A press with no
audio node is the failure, and that is measurable without ears.

## A3 A sound when the cash goes into the register

The money leaving the desk and landing in the drawer. It is one of the most
satisfying moments in this genre and it is currently mute.

---

# SECTION B — THE MOP. There are about a thousand fibres. I want 10 to 20.

This is the sixth attempt and I think the count is why every one has failed.

**A string mop has fifteen to thirty THICK bands of yarn, not a thousand
threads.** Look at one. Each band is a rope — several millimetres across, hanging
heavy, moving as one piece.

- **10 to 20 strands maximum.**
- Each one **thick**, like a rope, not a hair.
- The physics you built is right — keep it. Fewer, heavier bodies will read
  *better* under it, not worse, and it will cost a fraction of the frame.

Then photograph it at the default player camera and put it beside a reference
photo of a real string mop in the report.

## B1 The hand meshes are still blobs

Both hands, on the mop and the broom. Fingers that read as fingers, thumb on the
correct side. This is mesh work.

---

# SECTION C — THE BROOM'S HEAD IS STILL SIDEWAYS

Fourth time on this. Before touching a value: **say what the previous check
measured and why it passed.** You already know yaw was the wrong axis. Sweep
roll and pitch, at the default camera, screenshot each candidate, and give me a
contact sheet to pick from rather than a number you chose.

---

# SECTION D — THE BAG. Big items still stick out.

The stand-up rule landed and it is not enough. **Any item, at any size, must be
contained by the bag or visibly leaning out of its MOUTH — never through a wall,
a base or a side.**

If a body genuinely cannot fit at all, that is a design answer, not a geometry
one: it does not go in a bag. A boxed rangefinder gets carried, handed over, or
bagged in something bigger. Decide, say which you chose, and make the case
impossible rather than clamped.

**Add the case to the golden bag pose:** one oversized item, one long item, two
small ones, in one frame.

---

# SECTION E — THE QUEUE FOLLOWS PROPERLY

A customer finishes their transaction and **stands there for one or two seconds**,
and the person behind them starts walking and runs into them.

The rule:

- **Nobody behind moves until the person in front has fully cleared the desk.**
  Not started to move — cleared.
- The served customer leaving is what releases the next one.
- Nobody ever walks into the back of the person ahead.

Verify on a clip: a queue of four, drained, with the frames where each person
starts moving named.

---

# SECTION F — PERFORMANCE

## F1 Changing resolution or going fullscreen makes the game very laggy

New, and probably the worst performance finding yet. My panel is 4K. Going
fullscreen or raising the resolution is unplayable.

Measure it: GPU ms, CPU submit ms and achieved fps at 1080p windowed, 1440p, 4K
windowed and 4K fullscreen. Then fix what the numbers point at. My guess is the
render scale and DPR interacting, but measure rather than take my guess.

## F2 The door still lags on first open

Your last two attempts: the old check ran in **headless Chrome against
localhost** — the wrong runtime entirely — and your replacement was void because
the player never reached the door and the E press pulled weeds instead.

Third attempt: get the player to the door, confirm the door **actually opened**
before trusting any number, and time the frames. The driver's control and phase
split were right; only its arrival was wrong.

## F3 Draw calls

2,413 measured, still untouched. **Merge static meshes per material.** Then
re-run the cap ladder and flip the default to 120 if it paces. Say plainly
whether the first-equip and first-ledger stalls still fire.

---

# SECTION G — THE PHONE AND THE EMAIL

## G1 Notify me

I do not know when a call or an email arrives. A clear, unmissable notification
for both — on screen, audible, and persistent until I look.

## G2 The mouse must work on the phone

Still cannot click anything. Keep the arrows; add the mouse.

## G3 Better icons and layout

Real app icons rather than text glyphs, a proper status bar, readable type at its
actual on-screen size. Screenshot the home screen and two apps at real size.

---

# SECTION H — CREDIT CARDS THAT LOOK LIKE CREDIT CARDS

The card art should read as a real payment card: the chip, the raised number
band, the network mark, the bank's own colour.

**Multiple variants**, so different customers carry different cards — the way you
see a mix of networks and banks in a real till.

**Nothing trademarked.** Invent the networks and the banks: plausible names,
plausible marks, no real logos, no real colour schemes lifted wholesale. Build it
data-driven so more can be added by adding a row.

Screenshot four different cards in a customer's hand at the default camera.

---

# SECTION I — THE LEDGER

## I1 A shortcut key to open it, the way the phone has one

Routed through the binding table so it shows in Controls and the control line.

## I2 Real book sounds

See A1. Leather, paper, board. Not synthesis.

## I3 The UI rebuild, still open from Goal 20

The whole interface: what a page shows, how sections are found, the type, the
hierarchy. Obvious at a glance where you are and how to get anywhere else.

## I4 The open and close gesture, still open

The double animation is gone. It still does not read as a book being picked up,
opened, closed and set down. Your own clip showed the shut book presenting as a
flat card and the open book filling the frame without moving for 25 frames.
**Watch the frames and fix what you see.**

---

# SECTION J — BUY AND BOOK IN ONE VISIT. I have never seen it.

Reported done twice, with measurements, across two sessions. **Not once in my
play.**

Find out why. The two known shapes both fit: a combined path that exists and is
never taken, or a check reading one customer population while the shop runs the
other. Say which before changing anything.

Then make it common enough that I see it, and **prove it on a clip** — one
customer, shelves to counter to tee sheet to one payment.

---

# SECTION K — THE LOADING SCREEN ALTERNATES

The plates are good. Now **show more than one per load**: two or three, each held
for a few seconds, cross-fading between them. A long wait should move through the
club rather than sit on one picture.

---

# SECTION L — TRANSLATIONS TO 100%

Six of nine are done. **Finish Spanish, French and German.** Report per-locale
counts.

---

# SECTION M — CARRIED OVER

## M1 The overview must FRAME THE PLAYER

The pin is built and sits 28% off the left edge, because the overview frames the
course. Frame the player, not just mark them. **Check the projection lands
on screen** — you already added that question to the driver.

## M2 The card in the fingers (Goal 20 E2)

Flat and angled now, and the fingers still pass through it. Your measuring probe
returned null; fix the probe first, then the pose.

## M3 The clips A2 and B still owe

The queue abandon rule and the NPC look-ahead are live and unit-tested. Both are
found-false items, so under your own rule they need clips before they can be
called done.

## M4 The bunker rake viewmodel

Deformed lumps filling the top third of the screen (Verifier 3).

---

# PHASE 4 — ADVERSARIAL VERIFICATION

**VERIFIER 3 — THE STRANGER runs FIRST**, and **AGAIN at the very end**. The
second run is the only check that matters for Section 1: did they get inside?

**VERIFIER 1** — Section 1, the three found-false items at the top, and every
DONE claim in A through E, on clips.

**VERIFIER 2** — F through M.

Anything a verifier breaks goes back on NOT DONE and is fixed before you move on.
If a verifier disproves a claim, say so at the TOP of the report with what the
original check measured.

---

# REPORTING

`Designs/ProShop/OVERNIGHT_REPORT_22.md`, as you go, under 2,000 lines. The
found-false ledger is the permanent home of the fifth list.

**And one line I want in the report, at the top:** how many of tonight's fixes
were verified by a check that could actually perceive the thing it certified —
audio you recorded, pixels you looked at, frames you viewed — versus a property
you read. That ratio is the health of this project.