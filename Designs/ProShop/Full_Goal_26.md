# FULL GOAL 26

**Every line is an INSTRUCTION.** Ambiguity resolves toward the reading that
changes the player-visible game. Record which reading you took.

This is many sessions of work. **Work it in phase order and do not stop to ask.**

---

# WHY AUDIO IS PHASE 1

I have asked for real audio in Goal 23, Goal 24 and Goal 25. Three times. Every
time it is placed late in the brief, every time the session runs out before
reaching it, and every time the report says the same thing: *there is not one
audio file in the repository.*

So it is first. Not because it is the most important thing in the game, but
because **the last item in a brief never gets done in this project**, and audio
has now proven that three times over.

**You may not begin Phase 2 until the sounds play.** No exceptions, no partial
credit, no "the sample player exists." I must be able to hear cash going into
the drawer.

---

# THE RULES

1. **Phases are gates.** Phase N+1 does not begin until Phase N's adversarial
   review has run and its findings are fixed or explicitly listed as NOT DONE
   with a reason.

2. **5 commits or 45 minutes per item** — then NOT DONE, move to the next item
   in the same phase, and return after the phase closes. Never carry an item
   into the next phase.

3. **Push after every item.** Nothing lives only in the working tree.

4. **Do not build a framework.** If the fix needs a 1,000-line subsystem, it is
   the wrong fix — except where this brief explicitly asks for a system.

5. **Work continuously.** Compact and keep going. But when you genuinely cannot
   continue — context exhausted, quota gone, a decision only I can make — then
   **write the handoff and stop cleanly.** Do not repeat yourself in a loop; that
   wastes a session. One clear statement of where you got to is worth more than
   ten restatements.

6. **When two rules conflict:**
   > **PLAYER EXPERIENCE > REQUIRED VERIFICATION > ARCHITECTURAL CLEVERNESS.**

## THE EVIDENCE STANDARD

Read `FOUND_FALSE.md` before you start. Nine shapes of "the check passed and the
thing was broken" are catalogued there and you will hit two of them.

For anything you claim DONE: reproduce it through the real Electron path, capture
the failing baseline first, build a check that can **perceive** the thing (pixels,
audio graph nodes, real input, frame timings, spatial paths), file-copy revert and
**assert the file changed**, watch the check fail, restore, watch it pass. Anything
that MOVES needs a clip with the frames extracted and viewed. Anything that makes
a SOUND needs the audio graph recorded.

**Electron only. `--clubhouse=pine-hills-v2`. The greybox stays.**

---

# PHASE 1 — AUDIO. EVERYTHING, AND NOTHING ELSE UNTIL IT PLAYS.

Every sound in this game is oscillators and filtered noise. That is *why* the
ledger sounds like static and electricity and the money sounds like nothing.

## 1.0 You have permission to go and get files

**Use any library, API, package or archive you like**, provided the licence is
free for commercial use with no attribution trap and no legal ambiguity. Download
at development time; the shipped game plays vendored local files only.

Starting points, all CC0:
- Kenney — https://kenney.nl/assets/ui-audio, `/interface-sounds`, `/casino-audio`
- Freesound, filtered to CC0 or CC-BY
- OpenGameArt, where the **downloadable file itself** is marked CC0 or CC-BY
- Any npm package or archive whose licence file says CC0, CC-BY, MIT or public
  domain for the audio content

**Never:** NonCommercial; vague "royalty free" with no licence text; a preview
file whose download carries a different licence; a runtime call to a remote API;
AI-generated static standing in for real foley.

**If a specific sound genuinely cannot be sourced, say exactly which one and I
will record or buy it — but exhaust the list first, and do not let one missing
file stop the other twenty.**

## 1.1 Make it satisfying

This is the instruction, not a nicety. The money is the reward loop of the whole
game. Layer sounds, vary pitch and volume slightly per play so repeats don't
grate, and time every cue to the **visual contact** rather than the button press.

## 1.2 The money — the one I care about most

- **The drawer opening.** Currently silent. A real till drawer: the latch, the
  slide, the stop at the end of travel.
- **Cash going in: a continuous run, "tchhhhh", for as long as money is going in,
  stopping when the last piece lands.** Not one impact. Driven by real animation
  progress and pieces landing — cancels cleanly if the transaction is interrupted.
- **Each note or coin landing on the one before it.** Stacking, weighty. The pile
  it lands on changes the sound: the first note hits a wooden well and thuds, the
  tenth hits nine notes and barely does.
- Individual note and coin movement and placement.
- Settling — the little rattle of a coin against its neighbours.
- Final payment confirmation, subtle, distinct from menu UI.
- The drawer closing.

## 1.3 The ledger

Real recordings for: pickup, cover open, cover close, page turn left, page turn
right. Multiple variants with small bounded pitch and volume variation. Predecoded
and pooled so first use does not hitch.

## 1.4 The menu

Every clickable control makes a sound, **loud enough to hear** — measure the
actual output level, do not guess a gain. Includes controls inside dialogs.
Cancel and destructive actions get their own variant. Disabled controls stay
silent. Keyboard activation sounds the same as a click. Nothing double-fires on
bubbling.

Build an inventory of every clickable menu and dialog control and verify each
emits **exactly one** sound event.

## 1.5 Background music

Quiet, loopable, unobtrusive — the kind a calm management sim has. No drone, no
mower timbre, no dominant melody. Seamless loop with no click at the boundary,
sitting below UI and customer sounds, respecting volume and mute, not restarting
on scene transitions, not decoded on a gameplay-critical frame.

## 1.6 Kill the startup noise

A loud mower-like static plays on load. Find the real source — a stray
oscillator, a bad loop seam, a duplicated node, a decode error, a too-short
sample looping — and remove it. **Do not lower the master volume.**

## 1.7 Audio performance

One shared context. Each SFX decoded once. Pooled buffers, bounded voice count.
No synchronous fetch or decode during a door crossing, a page turn, a payment or
a menu click.

## 1.8 The paperwork

`THIRD_PARTY_ASSETS.md`: local filename, source page, original title, creator,
licence and version, required attribution, conversions performed, date obtained —
for every file. Normalise, trim silence, short fades, no clipping.

## PHASE 1 GATE — ADVERSARIAL REVIEW

A verifier taps the audio graph and records what actually plays: node created,
buffer, timestamp, peak level. **A source test asserting a callback exists proves
nothing** — that exact check certified a silent menu for two sessions.

Every event fires **once**, at the right moment, at an audible level. Report the
measured peak in dBFS for each cue. Then list every file with its licence.

**You do not start Phase 2 until this review passes.**

---

# PHASE 2 — THE WALK-UP IS BROKEN AND IT BLOCKS PLAY

## 2.1 The player's body blocks the queue

I finish a transaction. The second person walks up, **gets blocked by something**,
sidesteps right to left, then walks in place without moving, then leaves. The next
person does the same. It happens **when I am standing in the middle of the cash
register from the opposite side.**

**That is me.** My collider is standing in the queue's path.

**While I am at the register, my player must not collide with anything.** I am
behind the counter operating a till; I am not an obstacle in the customer lane.
Clear the player from the NPC occupancy test for the whole time register mode
owns the camera, and restore it on exit.

Then check the same question everywhere else I stand still for a long time: the
laptop, the desk screen, the ledger.

**Evidence:** stand exactly where I stand, run four customers through, clip it,
and view the frames. Nobody sidesteps, nobody walks in place, nobody leaves
without being served.

## 2.2 Items dropped on the counter must behave like objects

Right now they overlap and phase through each other. Make them behave the way
things do when you put them down on a real checkout counter: they come to rest
**on** the surface, they come to rest **against** each other, they do not
interpenetrate, and a later item does not occupy the same space as an earlier one.

They do not need full rigid-body physics. They need resting contact and no
overlap. Stack or spread as space requires; a tall item may lean, nothing floats,
nothing intersects.

**Evidence:** six items placed one at a time, clip, frames viewed, plus a
pairwise overlap measurement across every frame that must read zero.

## PHASE 2 GATE

A verifier serves four customers back to back from the register position, and
photographs the counter after each. No walk-in-place, no interpenetration, no
customer leaving unserved.

---

# PHASE 3 — NPC NAVIGATION. MAKE IT OVERKILL.

I want this system to be **perfect**. Not adequate. Every item under NPCs in the
register must be 100% done and provable.

## 3.1 Recast in production, not in a QA driver

It is vendored and it initialises. **Zero production customers query it.** That
is the zero-call-sites shape and it has happened in this repo before with a
1,400-line movement module imported by nothing.

- One initialisation.
- One navmesh baked from the static geometry during loading or an idle phase —
  **never on a gameplay frame.**
- No rebake per spawn, per door approach, or per frame.
- Production customer routing queries it. Prove the call site.

## 3.2 The full behaviour list, all of it

- **Never** runs in place.
- **Never** grinds along a wall, fixture or body.
- **Never** walks into another person or into me.
- A shopper blocked by the queue **routes around it** and reaches the item.
- Queue bodies and moving people are **dynamic obstacles** — do not rebake the
  static mesh for them.
- Two customers heading opposite ways step around each other.
- Nobody hands goods **through** another body.
- Nobody starts moving until the person ahead has **fully cleared** the desk.
- Single file, evenly spaced, everyone facing the counter, at any queue depth.
- The second person advances after a sale completes, every time.

## 3.3 The machinery it needs

A stuck detector based on **real progress toward the path target**, not on
velocity. Bounded repath timing with jitter so agents do not all repath on one
frame. Local separation and reciprocal avoidance — both parties yield, not one.
Arrival radii that prevent oscillation. Alternative approach sockets when the
primary is occupied. Smooth steering and turning. Recovery when a path goes
invalid.

A recovery teleport may exist **only** as a last resort after repeated failed
repaths, must be off-camera where possible, and must be reported every time it
fires. **Routing is the intended behaviour.**

## PHASE 3 GATE

Two verifiers.

**One:** stage three queuers blocking the corridor to the right-side merchandise,
spawn a shopper whose item is behind them. Overhead clip and player-view clip,
frames inspected. Revert the integration and show the old grinding fails the same
check.

**Two:** watch a busy shop for **ten minutes** and report every contact — body to
body, body to fixture, body to player, product through body — with duration. Any
sustained contact is a finding and a finding is the next item.

---

# PHASE 4 — TIME AND BOOKINGS

## 4.1 Time flows too slowly

The day drags. Look at what comparable shop and management sims use — a full game
day in the region of ten to twenty real minutes is the normal band — pick a rate,
say why you picked it, and make sure nothing that depends on wall-clock time
breaks when the clock runs faster. Sim speed options must still work.

## 4.2 Walk-ins can only ask for the next hour

If it is 6:45 am, a walk-in may ask for **7:00, 7:30 or 8:00** and nothing else.
There is no walk-in demand for 9 am — nobody walks into a pro shop to book
something three hours out.

**If everything inside the next hour is already booked, there is no walk-in
request at all**, and the desk says so plainly: *no times available within the
next hour.*

## 4.3 Walk-ins should be rare

Most golfers book ahead. Walk-ins are the exception, not the default traffic.
Weight the generators accordingly.

## 4.4 The phone and the inbox book anything

A caller or an email at 6 am can book **6 pm the same day, or tomorrow, or later
in the week.** No next-hour restriction — that rule exists because a walk-in is
physically standing at the desk, and a caller is not.

## 4.5 More of them

Calls, voicemails and emails should arrive **more frequently**. This is where the
booking business comes from, and if the phone is quiet the tee sheet is empty and
there is nothing to run.

## PHASE 4 GATE

Simulate a full week. Report: walk-in requests per day and their lead times
(every one must be inside the next hour), phone and email requests per day and
their lead times (spread across the day and into following days), the walk-in
share of total bookings, and how long a game day takes in real minutes.

---

# PHASE 5 — THE MOP AND THE HANDS. USE THE REFERENCE IMAGES.

Both references are in `Designs/ProShop/Images/Goal_26/`. **Look at them at full
size before you change anything.**

## 5.1 The mop — `MopReferenceImage.png`

Three specific faults, in my words:

- **Too thin.** It needs more body.
- **It does not connect to the stem.** There is a gap between the yarn and the
  shaft. On a real mop the yarn is clamped into a band that meets the handle.
- **Each strand looks like four connected pieces instead of one coherent piece.**

That third one names the cause: the strands are built from **four stacked
cylinder segments and the joins are visible.** A strand must read as one
continuous tapered rope — smooth tube geometry along the curve, not a chain of
cylinders with corners at every node. The solver can keep four simulation nodes;
the *geometry* must not show them.

Match the reference: a dense head, a real collar meeting the handle, strands that
read as single continuous ropes, clumped into a mass with the ragged hem a mop
actually has.

## 5.2 The mop needs weight

The strings fly everywhere. It must feel **heavy**. Carried: they barely move, a
sharp turn produces a small slow response, no flailing, no jitter at rest.
Actively mopping: they drag, compress, lag and recover, and settle smoothly when
the stroke stops. **Separate carry and active parameters** — one solver tuning
cannot do both.

## 5.3 The hands — `HandsReferenceImage.png`

**Sixth time asking.** Both hands, both tools, matching that reference.

Fingers that read as fingers at viewmodel distance. A thumb on the correct side.
Enough geometry that nothing looks faceted. Correct grip contact on the shaft of
both tools. Not dozens of draw calls per finger. Consistent skin material.

**This is mesh work, not a slider.** Go through `golf-assets` if that is what it
takes. Every previous session has deferred this because it is asset work and
asset work is slower — do it anyway.

## PHASE 5 GATE

A verifier equips each tool, stands still, walks, turns sharply, and uses it, and
photographs each at the default player camera. Put those photographs **side by
side with the reference images** in the report and say plainly how close they are.

---

# PHASE 6 — THE LEDGER UI REBUILD

The interface itself, not the motion — the motion is done. Recover the exact
Goal 23 I3 requirements from the repo rather than inventing them, then deliver:

- Clear current **section and page identity** — where am I, at a glance.
- Obvious **navigation to every section** from anywhere.
- Back and forward that behave.
- **No dead-end pages.**
- Keyboard **and** mouse usable.
- Readable hierarchy, spacing and type at the reading camera.
- Consistent page-turn direction.
- Selected and hover states.
- State persistence across close and reopen.
- No lag from navigation or page generation.

## PHASE 6 GATE

A verifier opens the book, navigates to every section, uses back and forward,
turns twenty pages, closes and reopens, and photographs three pages at native
canvas resolution. Judge the type by eye.

---

# PHASE 7 — PERFORMANCE

## 7.1 Merge static meshes per material

Named in Goal 23, Goal 24 and Goal 25. **Never started.** Last measured: 574 draw
calls standing, 942 peak, 838 static meshes, 290 materials — measure again first.

Classify meshes: static visual, interactive, animated, skinned, collision-only,
visibility-switched. Merge compatible static visual geometry per material and
render state; instance where repeated transforms suit it better. Preserve world
transforms, normals, UVs, lighting, shadows, material identity, culling and
appearance. Do not destroy hit targets. Do not merge across visibility zones if
it makes the doorway render more. Do not produce one enormous mesh that ruins
culling.

**Target:** 30% fewer standing draw calls, 25% fewer at peak.

**This may also be the answer to the first-use stalls** — fewer programs to
compile means fewer to compile on first draw.

## 7.2 Resolution follows the monitor

Drag the window from my 4K panel to my 1440p panel and the render resolution
should follow — 4K on the 4K screen, 1440p on the 1440p screen. Same for going
fullscreen or changing a display. Watch for the monitor change, read the actual
display, resize the drawing buffer.

Note the known trap: **a maximised window on Windows silently ignores
`setContentSize`.** An earlier session found that and it is why resolution has
never been testable from the QA side.

## 7.3 4K and fullscreen

Measure GPU ms, CPU submit ms, draw calls and achieved fps at **1080p windowed,
1440p, 4K windowed and 4K fullscreen**, then fix what the numbers point at.

## 7.4 First-use stalls

- **First page turn.** One `basic` program still compiles —
  `LedgerTurningLeafBack`. Diff the cacheKey built during the warm against the
  one built on the turn; the difference between those two strings names the
  condition your warm is not reproducing.
- **First tool equip** — dust cleaner, broom, mop.
- **First cashier button press.**
- **First check-in press.**

Sixteen `renderer.compile()` configurations have failed. **Do the gesture behind
the veil instead** — actually open the ledger and turn a page, actually equip
every tool, actually enter register mode, real render path, real lighting, real
resolution, one frame each, then restore. Run it after the game is interactive,
not at the veil boundary where a burst of compiles once coincided with a GPU
crash.

**Verify by the program counter, not milliseconds.** The ms are noise — the same
build gave 33 ms and 464 ms for one gesture.

## 7.5 Tool cycling

100 real cycles. No rebuild from source geometry, no repeated GLB parse, texture
decode or material compile. First-use per tool, warmed p95 and max, object and
material counts before and after, heap before and after. No recurring frame over
33 ms after warmup, no memory trend, no duplicate viewmodels.

## 7.6 Tab overview

Still takes 3–5 seconds. One cause was fixed (the interior culled on the return);
find the rest. And the overview itself is **a field of scattered trees with no
clubhouse and no fairway in it** — it should show my course.

## 7.7 The numbers

Report GPU ms, CPU submit ms, draw calls, achieved fps per cap, and the worst
frame in a 60-second indoor walk — before and after.

## PHASE 7 GATE

One Electron run with a frame-time overlay: load, door approach and crossing,
ledger open/page/close, warmed tool cycling, Tab round trip. No recurring frame
over 50 ms, no memory growth. **Watch the video.**

---

# PHASE 8 — GLOBAL ESCAPE

One top-level capture-phase Escape router with explicit priority. Nothing
lower-level double-handles it.

Priority: cancel an active drag or placement → if the ledger is open or
animating, close it and restore camera and input → if the laptop, register, desk
screen, phone or any modal is open, unwind one layer → otherwise the pause menu.

**The pause menu offers:** Resume, Restart the current day, Return to main menu,
Quit — with confirmation on the destructive ones.

Escape must never corrupt pointer lock, leave input disabled, accidentally bank
or void a transaction, duplicate an overlay, or strand me between modes.

**Test with real Escape presses from every one of these:** the main menu and each
of its dialogs, the loading veil once input is possible, walking, the door
transition, tool use, tool switching, ledger opening, ledger open, page turn,
ledger closing, register scanning, bagging, card presentation, cash entry, the
laptop, the desk screen, a combined transaction, placement mode. After each,
confirm I can resume and still move and look.

---

# PHASE 9 — THE REMAINDER

Work these in order. Each is small; none has been done.

1. **The card in the customer's fingers still phases through.** Flat now, still
   intersecting the hand.
2. **The prompt bar is sticky** — it names objects the crosshair is nowhere near.
   You have documented that `walkStationPropInReach` does this deliberately.
   **I am overruling it: the crosshair decides the prompt.** A station in reach
   may keep working for E without claiming the prompt.
3. **The interior is unreadably dark at 6 am**, which is when the game starts.
   The lights are on the restoration path, so either the game does not start at
   6 am, or the lobby has one working bulb from the beginning. Pick one and say
   which.
4. **The bunker rake viewmodel** — I reported deformed lumps filling the top
   third; a previous session could not reproduce it. Photograph it at the default
   camera and tell me what you see.
5. **The other ten of the stranger's fourteen findings.** They are listed in
   `OVERNIGHT_REPORT_22.md`. Work them.
6. **The phone** — mouse clicks, better icons, a proper status bar, and
   notifications when a call or email arrives.

---

# PHASE 10 — FINAL VERIFICATION

## 10.1 Regression sweep

Confirm without reimplementing unless broken: the bag shows nothing; the
tee-time wording names a time; the status line is honest; the green fee bills
once on the accepted path; goods are retained on the refused path; the laptop
clear-counter voids safely; the checkout does not wedge; the broom head is square;
the ledger locks movement and look; CSP still refuses broad `unsafe-eval`.

## 10.2 The three verifiers

**Verifier 1 — Phases 1 to 4 on clips and recordings.** Audio events with levels.
The walk-up with four customers. Item stacking. The blocked shopper routing. A
week of bookings with lead times.

**Verifier 2 — Phases 5 to 9.** Mop and hands beside their reference images.
Ledger UI. Draw calls before and after. Resolution following the monitor. Escape
from every state. The remainder list.

**Verifier 3 — the stranger.** Clean start, no code read, real input, no
developer shortcuts. One question:

> **Can a stranger complete one full customer — products, a tee time, one
> payment, bag, out through the door — and then serve a second and a third
> without getting stuck, hearing silence where a sound belongs, or hitting a
> stall?**

A verifier finding is the next item. Fix it, re-run that verifier, then re-run
Verifier 3.

## 10.3 Done means done

Do not claim DONE when: the before/after check cannot distinguish the code; a
movement clip was not viewed; an audio cue was not recorded playing; a recurring
frame over 50 ms remains; it only works through a QA shortcut; a licence is
unknown; the commit was not pushed; the suite was not green.

---

# REPORTING

`Designs/ProShop/OVERNIGHT_REPORT_26.md`, appended as you go, under 2,000 lines.

**At the top, always:**

1. **Perception ratio** — fixes verified by a check that could perceive the thing
   it certified, over total fixes.
2. **Probe-lie count** — how many of your own checks scored the same before and
   after, or measured the wrong object. Recent sessions logged 17, 21, 25, 31.
   A zero means you are not looking hard enough.
3. **Phase status** — which phases are gated closed.
4. **Audio table** — every file, its cue, source, creator, licence, measured peak.
5. **Performance table** — before and after.

**Per item:** symptom, reproduction, root cause, what the previous check measured
if it misled, files changed, before/after numbers, clip and screenshot paths with
confirmation the frames were viewed, the focused test command and result, the
revert-fail proof, suite and golden result, commit hash, push status, remaining
caveat.

Add every new false-positive shape to `FOUND_FALSE.md`.

---

# WHEN YOU FINISH — OR WHEN YOU CANNOT CONTINUE

Give me: a DONE / PARTIAL / NOT DONE table for every phase and item; exact before
and after performance numbers; the audio table with licences; the Verifier 3
result in its own words; commit hashes and push status; remaining defects stated
plainly; paths to the report and every important clip.

**Do not say "should be fixed." State what you observed.**

# START

Phase 1. Go and get the audio files. Nothing else until I can hear the cash.