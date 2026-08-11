# Full Goal 23

**Every line is an INSTRUCTION.** If a line is genuinely ambiguous, take the
reading that CHANGES the game, and record which you took.

This is more than one night. **Work it in order and do not stop to ask.** The
order is deliberate: the things I feel every second come first.

---

## READ FIRST — THE GOLDEN GATE FAILURE MAY BE THE LAG

You left 12 of 13 golden poses failing at 7.75–9.17%, edges only, deterministic,
and correctly refused to rebaseline. **Do the bisect between `c27d3a2` and HEAD
first.** Something changed in the render loop — you named `ensurePlayerPin()`
being added to the top of `render()` as a candidate.

An edge-only, whole-scene pixel change is the signature of an antialiasing or
render-target change. **That is also exactly the signature of a performance
regression.** Find what changed before you optimise anything, because you may be
about to tune around a bug.

## THE STOP RULE IS PER ITEM

5 commits or 45 minutes **on one item**, then NOT DONE and move on. Not a session
budget.

## STANDING RULES

Electron only, `--clubhouse=pine-hills-v2`. A green suite is not evidence.
Anything that MOVES needs a clip with its frames viewed. A check that reads a
property has not perceived anything — **if you cannot perceive it, say so.**
Every fix gets a check you have watched fail, and assert the revert changed the
file. Suite green before each commit. Commit and push per item.

---

# A — PERFORMANCE. The game is horrible to play. This is the whole section.

## A1 The lag I feel constantly

Not the stalls — the baseline. It never feels smooth. Measure and fix:

- **Merge static meshes per material.** 2,413 draw calls, measured, named as the
  lever two sessions ago, never touched. The runtime batching pattern is already
  proven on 10 props.
- Then re-run the cap ladder. **If 120 paces, flip the default.**

## A2 Fullscreen and higher resolutions are unplayable

My panel is 4K. Going fullscreen or raising the resolution makes it far worse.
Measure GPU ms, CPU submit ms and achieved fps at 1080p windowed, 1440p, 4K
windowed and 4K fullscreen. Then fix what the numbers point at.

## A3 The door still hitches on first open

Third attempt. Both previous ones were void — one ran in headless Chrome against
localhost, one never reached the door. **Confirm the door actually opened before
trusting any number.**

## A4 Report the numbers

GPU ms, CPU submit ms, draw calls, achieved fps per cap, worst frame in a
60-second indoor walk, before and after. And say plainly whether the first-equip
and first-ledger stalls still fire.

---

# B — THE TRANSACTION. Three faults, one flow, and it is the core of the game.

## B1 A customer said "one more thing, I have a tee time" — and then left

They announce it and walk out. They must **stay at the desk and wait** for me to
handle the tee time. Nobody who has asked for something leaves before I answer.

## B2 The flow I want, in order, as one payment

1. They put their items on the desk.
2. I scan them.
3. **Then** they ask for their tee time.
4. I book it or check them in.
5. **One transaction: items plus the green fee. They pay once.**
6. They take their bag and go to the course.

This has been reported done twice, with measured splits, and **I have never once
seen it.** Before changing anything, say what those checks measured. Both known
shapes fit: a path that exists and is never taken, or a check reading one
customer population while the shop runs the other.

Then prove it on a clip: one customer, shelves to counter to tee sheet to one
payment to the door.

## B3 The queue still walks into the person paying

Reported fixed twice. Still happening. A customer finishes, pauses for a second
or two, and **the next one starts moving and walks into their back.**

The rule: **nobody moves until the person ahead has fully cleared the desk.** Not
started to move — cleared. The served customer leaving is what releases the next.

Clip a queue of four draining, and name the frames where each person starts.

---

# C — NPC MOVEMENT. Use a real solution. Stop hand-rolling it.

They still get stuck walking the same line and running in place. Every attempt to
fix this by hand has failed, and one of them turned out to be in a module the game
does not even import.

**Bring in a real navigation library.** Look at:

- **`recast-navigation-js`** — a WASM port of Recast/Detour, the navmesh system
  most commercial games use. Proper navmesh generation from your geometry, plus
  crowd simulation with agent avoidance built in. This is the industry answer.
- **`yuka`** — a JS game-AI library with steering behaviours and navmesh support.
  Lighter, easier to vendor.
- **`three-pathfinding`** — smallest, navmesh A* only, no crowd avoidance.

**Pick one, say why, and vendor it** the way you vendored `postprocessing`. What I
want from it:

- an agent **never** runs in place, never grinds along a surface, never walks into
  another person
- a real navmesh baked from the shop's actual geometry, not a collider list
- crowd avoidance so two customers going opposite ways step around each other

If none of them fits, say which and why with the specific reason, and then fix the
hand-rolled one properly — but look first.

---

# D — THE MOP. 16 bands is right. Make them fill the head.

You cut it from 820 fibres to 16 bands, which was correct. Now it is too sparse
and reads as spikes.

**A real string mop is thick bands that COVER the whole head.** The bands hang
from a wide collar, splay across the full width, and read as **connected and
matted** — a full mass of yarn, not individual spikes radiating from a point.

- keep the count in the 16–24 range
- **widen the collar** so the bands originate across the head's whole width
  rather than from a point
- make them read as one mass: touching, overlapping, matted together
- the whole head is covered when it hangs

## D1 And the solver still does not run

You measured drift while walking as **zero** — the yarn has never animated. Fix
that first. **Your control was void** (zero passes "motionless is still"
trivially), so build a positive control: force a known displacement and confirm
the instance matrices change.

Photograph the head at the default player camera beside a reference photo of a
real string mop.

---

# E — THE BROOM HEAD IS STILL TILTED RIGHT. I am tired of repeating this.

Fifth time. Read this and do it properly:

1. **The orientation is not an exposed parameter** — you found it is composed
   inside the rig from `rollLean`, `rollStroke` and a tilt axis in
   `broomViewmodel.js`. **Expose it as one value.**
2. **The existing sweep tool runs in the wrong runtime** — `broom-pitch-sweep.js`
   boots against `localhost:8457` in a browser. Any candidate ever picked from it
   was picked in a program I do not run. Rebuild it in Electron.
3. Sweep that one value at the default player camera, screenshot each candidate,
   and **give me a numbered contact sheet.** I will pick.

Do not report a number you chose. The head must be square to the floor.

---

# F — THE BAG. Fake it. That is the instruction.

Stop trying to physically contain items. Four sessions have gone into geometry
that clamps, inverts, stands up and still pokes through.

**Make it LOOK like the item goes in, and then it is gone.** The item travels to
the bag's mouth, sinks into it, and is hidden — culled, clipped, or simply not
drawn. The bag reads as full because its shape changes or its contents show at the
mouth, not because a body is really in there.

That is what every shop sim in this genre does and it is the right answer. Any
size of item, any shape, always clean.

---

# G — AUDIO

## G1 The menu sounds are far too quiet

They exist now — thank you — and I can barely hear them. **Raise them.** Measure
the actual output level rather than guessing at a gain, and match them to the
in-game UI clicks.

## G2 The cash going into the register

Still cannot hear it. What I want: **each note or coin landing on the one before
it** — that stacking, satisfying sound those games have. Not the handling rustle,
which is what `billHandle`/`coinHandle` currently play. It needs its own voice
with weight.

## G3 And it needs to be real recorded audio, not synthesis

Every sound in this game is built from oscillators and filtered noise. That is
*why* things sound electric. Bring in real CC0 or CC-BY samples for the ledger,
the menu and the money, wire a sample player alongside the synth, and report every
licence.

---

# H — CREDIT CARDS

Still all Pine Hills cards. I asked for **multiple variants that read like real
payment cards** — different networks, different banks, so different customers
carry different cards.

Invented names and marks only. Nothing trademarked, no real logos, no lifted
colour schemes. Build it data-driven so a new card is a new row.

Screenshot four different cards in a customer's hand at the default camera.

---

# I — THE LEDGER

## I1 It still opens wrong. Open it RIGHT TO LEFT.

The cover swings from the right side across to the left, the way a book opens.
Show me **every frame of that** in a clip, and name the frames.

You already filmed this once and the frames showed the shut book presenting as a
flat card and the open book snapping into place without moving for 25 frames.
Watch the frames again and fix what you see.

## I2 While I am holding the book, WASD must not move me

Holding the book locks me to it. No walking, no strafing. I am reading.

## I3 Still open from Goal 20: the UI rebuild and the real sounds

See G3 for the sounds.

---

# J — EVERYTHING ELSE FROM GOAL 22 THAT WAS NEVER STARTED

Work these in this order once A through I are done or stopped:

- **The loading screen alternates** — two or three plates per load, a few seconds
  each, cross-fading
- **The phone**: mouse clicks, better icons, proper status bar, notifications for
  calls and email so I know when one arrives
- **The overview must FRAME THE PLAYER** — the pin is 28% off the left edge
- **The card in the customer's fingers** — flat now, still phasing through
- **The bunker rake viewmodel** — deformed lumps filling the top third
- **Clips owed** for the queue-abandon rule and the NPC look-ahead

---

# K — THE FOURTEEN THINGS THE STRANGER FOUND INSIDE

Your own closing verifier got inside and found fourteen problems. These are real
and I want them on the record, worked after J. The four that matter most:

1. **E is silent indoors on objects the game itself names.** The refusal rule from
   Section 1 stops at the door.
2. **The prompt bar is sticky** — it advertises objects the crosshair is nowhere
   near. It cannot be trusted.
3. **B means two things** — the tool wheel says B is the push broom; B opens Build
   mode.
4. **The interior is unreadably dark at 6:00 AM**, which is when the game starts.

---

# PHASE 4 — ADVERSARIAL VERIFICATION

**VERIFIER 3 — THE STRANGER runs at the END**, and its job this time is not the
door. It is: **can a stranger complete one full customer — items, tee time, one
payment, bag, out?** That is section B's real verification.

**VERIFIER 1** — A, B, C on clips.
**VERIFIER 2** — D through I.

Anything a verifier breaks goes back on NOT DONE and is fixed before you move on.

---

# REPORTING

`Designs/ProShop/OVERNIGHT_REPORT_23.md`, as you go, under 2,000 lines. The
found-false ledger is the permanent fifth list.

**And keep the line from last time at the top:** how many of tonight's fixes were
verified by a check that could actually perceive the thing it certified — audio
recorded, pixels viewed, frames looked at — versus a property read. Last night it
was 2 of 3. That ratio is the health of this project.