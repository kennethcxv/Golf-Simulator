# GOAL 26 — PLAYTEST ROUND 5

Work in the order written. Finish each item before starting the next.

**ITEM 3 IS A THIRD REPORT.** You have fixed it twice and I am still being walked
into. There is a specific lead in that section — read it before you touch
anything.

---

## P0 — THE COURSE EDITOR IS UNUSABLE

Opening the course editor, **I cannot click anything.** It is enormously laggy —
a click takes about **twenty seconds** to register.

Then I pressed Tab and the screen tore in half: the top portion showing the
course editor, the bottom half **solid black**. Screenshot attached.

This is a whole mode broken. Reproduce it, measure the click-to-response time,
and find what is eating twenty seconds a frame.

The half-black frame after Tab is likely a second bug in the same place — the
editor's viewport and the walk viewport disagreeing about who owns the canvas.

---

## P0 — TWO THINGS WRONG WITH LOADING IN

- **I start every game with a cleaning dustpan already in my hand.** I never
  equipped it. Nothing should be equipped on load.
- **I see the map before I load in.** The course/overview view is drawn for a
  moment before the walk camera takes over.

You fixed a related fault before — `syncCameraVisibility` decides the interior's
visibility from the CAMERA position, so on a transition the camera is still
somewhere else for a few frames. Check whether this is the same shape.

---

## 1 — FIRST-PRESS LAG IS BACK, ON EVERYTHING

Every new button press spikes. Turning a page in the book. Pressing **T** for the
phone. Each one lags the first time and is fine afterwards.

You have chased this before and narrowed it to programs compiling on a
player-facing frame. The deferred warm was supposed to cover it. Either it is not
covering these surfaces, or it is not running. Find out which, and verify by the
**program counter**, not milliseconds — you have already shown the ms are noise.

---

## 2 — CUSTOMERS ANNOUNCE THEMSELVES FROM THE BACK OF THE LINE

While someone is still standing in the queue, I get a notification saying *"hey
I'm X and these are for me"* or *"hey I'm X, can I get a tee time for X o'clock"*.

**They must reach the counter first, then ask.** Nobody speaks to me until they
are at the front and it is their turn.

---

## 3 — THIRD REPORT: MY BODY IS STILL SOLID, AND I HAVE A LEAD FOR YOU

I am still being walked into while reading the ledger and while at the register.
NPCs must pass straight through me — I cannot see myself, so a body I cannot see
blocking a lane I cannot see is invisible to me and obvious to them.

**THE LEAD, and check this first:** `playerBlocksCustomers` reads
`app.deskScreenOpen`. In an earlier session you established that this flag is
**only ever read and never set** — the real one is `app.frontDeskOpen`. If that
is still true, the desk screen never phases the player out at all, and the desk
screen is exactly where I do walk-in tee times.

Audit **every** flag that predicate reads the same way: prove each one is
actually written somewhere in `src/`, not just read.

Then verify in ordinary play rather than by staging four stations.

**And the part still outstanding from last round:** when I come back and somebody
is standing inside me, I should just move a bit. You rate-limited the clamp but
could not stage an overlap to watch the nudge fire. It still needs proving.

---

## 4 — THE WALK-IN TEE TIME NEEDS TWO ATTEMPTS

I go to the screen to give a walk-in a time, **it zooms me back out**, I click in
again, and then it works. Every time.

Something is ejecting me from the desk on the first entry. This may share a cause
with item 3 — if my body is still solid at the desk screen, a customer pressing
into me could be what pushes me out.

---

## 5 — AUDIO

- **The old synth is still playing underneath the book.** When I turn a page I
  hear the static blip AND the new page turn. Remove the synth fallback from
  **every ledger cue**, not just page turns. If the recording is missing, silence
  is better than the beep.
- **Coin and cash cues are firing on the wrong clicks.** The coin sound should
  play only when I press a coin; the cash sound only when I click a note. They
  are crossing over.
- **Add a transaction-complete sound.** There is nothing marking the end of a
  sale.
- **The cash drawer opening and closing is too loud.** Bring it down.

---

## 6 — THEN THE BLENDER ASSETS

You answered both questions and both answers are good: Blender 5.1.2 drives
headless with `--factory-startup -b --python <script>`, and the golden gate has
per-pose budgets that absorb a deliberate mesh change.

**Three assets, and only three,** in this order. Each one has failed repeatedly
*because* it is procedural geometry built from capsules at runtime — the hands
six times, the mop across eight passes, and the rake turned out to be a detached
hand floating in the sky.

1. **The hands** — match `HandsReferenceImage.png`.
2. **The mop head** — match `MopReferenceImage.png`.
3. **The broom head.**

For each: model it, keep it in the draw-call budget you measured, wire it in
**replacing** the procedural build rather than sitting beside it, photograph it
at the **default player camera** beside the reference, and put both in the report.

**Then stop and show me before starting the next one.** I would rather have one
hand that looks right than three objects that are almost there.

Two things you already know and should carry in:
- `tool-mop` sits at 0.7349% against a 0.75% budget, so the remodel **will** turn
  that pose red. That is correct, not broken. Show me the frame and I will accept
  it.
- An equipped tool has been reporting itself fully present and appearing in zero
  frames. If that is still unresolved, **fix it before modelling** — a new asset
  you cannot photograph is a new asset nobody can judge, which is how the hands
  failed six times.

---

## STILL MY DECISIONS — DO NOT GUESS

- **4.1, time compression.**
- **5.1, mop density** — though the remodel may settle it; if the reference
  geometry answers the question, say so.
- **The strand thickness bar** you raised from 8 mm to 11 mm.