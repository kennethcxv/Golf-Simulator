# GOAL 25 — AUDIT, FINISH, PROVE

Read this whole file before touching anything. **Every line is an INSTRUCTION.**
Ambiguity resolves toward the reading that changes the player-visible game;
record which reading you took.

This is a multi-session document. **Work it in order. Do not stop to ask.**

---

# WHY THIS BRIEF IS SHAPED THIS WAY

The last agent worked 30 hours on a fourteen-item brief and closed one item. It
was not short of skill — the item it closed had defeated three sessions. It
failed on **shape**: its brief put a QA harness at position two and the core-loop
blocker at position five, so it built ~20,000 lines of harness and ~13,000 lines
of tests *about* the harness, then spent 22 hours without a single commit
building a 3,041-line write-ahead log nobody requested.

So the rules below are not bureaucracy. They are the specific failure this
project keeps having.

## THE FIVE RULES

1. **Phases are gates.** You do not begin Phase N+1 until Phase N's adversarial
   review has run and its findings are fixed or explicitly listed. Within a
   phase, work items in the order given.

2. **5 commits or 45 minutes per item.** Then write NOT DONE with what you found
   and move to the next item. Return to it after the phase completes, not before.
   This rule has been in three briefs and ignored in all three. Obey it.

3. **Push after every item.** Nothing lives only in the working tree, ever. If
   you cannot make the suite green, commit to a branch anyway and name the red
   test in the message. 15,600 uncommitted lines sat at risk for 22 hours last
   session; that must not recur.

4. **Do not build a framework.** If your fix requires a new subsystem, abstraction
   layer, or 1,000+ line module, it is the wrong fix. Write down what you would
   have built and why, then do the small thing. The one exception is where this
   brief explicitly asks for a system.

5. **When two rules pull against each other:**
   > **PLAYER EXPERIENCE > REQUIRED VERIFICATION > ARCHITECTURAL CLEVERNESS.**

## THINGS YOU MAY NOT DO

- Replace the engine, the renderer, or the scene architecture.
- Extend, build on, or revert the settlement write-ahead log without asking me.
- Add a runtime dependency on a remote API. Development-time downloads are fine;
  the shipped game plays vendored local files.
- Weaken a test, a golden threshold, a lint baseline, or an acceptance criterion
  to make a failure disappear.
- Rebaseline the golden gate to make a red row green without diagnosing it first.
- Delete another agent's evidence or reports.
- Spend time proving theoretical failure states that no item here asks for.

## THE EVIDENCE STANDARD

`FOUND_FALSE.md` catalogues **eight distinct shapes** of "the check passed and
the thing was broken" — two customer populations, zero call sites, right object
wrong variable, two selectors, shipped disabled, visible but not painted, wrong
runtime, counted the numerator. Read it before you start. You will hit at least
two of them.

For every item you claim DONE:

- Reproduce the defect through the **real** Electron interaction path.
- Capture the failing baseline **before** you touch the fix area.
- Build a check that can **perceive** the defect — pixels, real input, frame
  timings, audio graph nodes, spatial paths, banked transactions. A check that
  reads an internal boolean has perceived nothing.
- File-copy revert the fix. **Assert the file content actually changed.** A
  silent no-op revert has produced a false green in this repo.
- Watch the check fail on the reverted file. Restore. Watch it pass.
- For anything that MOVES: record a clip, extract the frames, **look at them**,
  and name the frame that proves it by timestamp.
- Focused tests, lint, full suite, golden gate where it applies.
- Commit, push, append to the report.

**Electron only. `--clubhouse=pine-hills-v2`. The greybox stays** — assets 61,
62 and 63 render as grey volumes on purpose. Do not "fix" them.

---

# PHASE 0 — WHAT DID YOU ACTUALLY INHERIT?

Two agents have worked this repo since the last owner playtest and both reported
work that later proved false. **Verify. Do not trust either report.**

Write the answers at the top of your report before you change one line.

## 0.1 The tree

- Branch, HEAD, clean or dirty. Anything uncommitted goes to a branch **now**.
- Full suite: pass count, and every red test named.
- Lint ratchet: at baseline or above?
- `npm run golden`: 12/12 or not? `golden-capture.js` was mid-rewrite. **If the
  gate is red, diagnose it — do not accept.** A wrong field of view cost this
  project a week and was only recoverable because nobody rebaselined.

## 0.2 The quarantine breach

A third agent's ledger WIP was quarantined, and the last agent then edited into
`keyBindings.js`, `i18n.js` and `main.js` anyway. **List every file carrying
mixed-author hunks** so you know whose work is whose before you edit them.

## 0.3 Verify these six claims specifically

Each one is either unproven or was contradicted by its own driver.

| Claim | The question you must answer |
|---|---|
| **The bag is faked** | Is `bagFill` actually gone? Photograph the bag empty and with three items under one fixed camera. Are the two frames pixel-identical at the mouth? |
| **Recast is integrated** | Does a **production** customer query the navmesh, or does only a QA driver? Zero call sites at module scale has already happened once — a 1,400-line movement module imported by nothing. |
| **The crosshair rule works** | Its own driver passed with the change **reverted**. Find a scenario that fails without it. If none exists, say plainly that the rule should be removed rather than proven. |
| **C3's corridor gate** | The last agent flagged a possible early return bypassing the check, and its driver could not distinguish a frozen handoff from a correctly delayed one. Read the code. |
| **The door stall is fixed** | Do not re-audit the fix — it is the best-evidenced work in this repo. Just run the driver once and confirm it still reports every sample under 33 ms. |
| **B4b** | A refused ticket must bank goods only. Prove it **in the game**, not in Node. |

## 0.4 The settlement WAL

It is live in `completeSale`. Read enough of it to know what it does. **Do not
extend it, do not build on it, do not revert it.** If an item below tempts you
into it, stop and say so in the report.

## PHASE 0 GATE

The tree is committed and pushed, the suite state is known and named, the golden
gate is green or its redness is diagnosed, and the six claims above have verdicts.
**Then continue.**

---

# PHASE 1 — THE CORE LOOP

This is the game. Nothing in Phases 2–6 matters if a customer cannot buy
something.

## 1.1 The customer never hands over the card

I bag every item and the sale will not complete. No card is offered. **This is
the blocker and it has had no attention in two sessions.**

**The flow, step by step. Step 7 is the bug:**

1. Customer picks products, reaches the counter.
2. I scan and bag every product.
3. Customer asks for a **specific tee time**, or to check in for a booking.
4. I open the desk screen.
5. I book it, adjust to another valid time, or refuse.
6. The desk action completes.
7. **The desk screen exits by itself. The register workspace and camera come
   back.** Camera, focus, pointer-lock state, register stage and prompts must
   match the normal check-in flow. I must never have to back out of the computer
   manually to discover the card is waiting.
8. Customer presents payment.
9. **One payment.** Booked: goods and green fee on one ticket. Refused: goods
   only — the sale is never lost.
10. Customer leaves; the next one proceeds.

**Cases:** accepted at the asked time; adjusted to another time; refused or
unavailable; check-in for an existing booking; card; cash if that path exists;
the laptop's clear-the-counter action while wedged.

**Never:** double banking, lost products, a duplicated green fee, or anyone
leaving unpaid.

**Evidence:** a real-input clip of the accepted path and the refused path,
end to end. Assert the return to checkout by observing the **real register camera
and card target**, not by reading a workspace string.

## 1.2 The tee-time ask must name a time

A customer with goods asks *"have you got a time free today?"* and never says
when, so there is nothing to book. They ask for a **specific time**, like every
other walk-in, with the same wording shape and the same desk buttons.

## 1.3 The status line

It reads *"all items are being bagged, the customer's cash is being prepared"*
even when a tee time is outstanding. Say what is actually happening.

## 1.4 The bag shows nothing

If Phase 0.3 found `bagFill` still present: **delete it.** No block, no mass, no
contents at the mouth. An item travels to the mouth, sinks in, stops being drawn,
and nothing appears in its place. Empty and full are pixel-identical.

## 1.5 A laptop button to remove a customer

For when the game wedges. Small, and it makes every other bug survivable.

## PHASE 1 ADVERSARIAL REVIEW

Spawn a verifier that has **read no code**. Real keyboard, real mouse, real
pointer lock, default camera, no state forcing, no QA shortcuts.

Its one question: **can it complete a full customer — products, a specific tee
time, one payment, bag, out the door?**

Anything it breaks is your next item. Fix, re-run, repeat until it passes.

---

# PHASE 2 — NPCs

## 2.1 Recast in production

If Phase 0.3 found it QA-only, wire it into real customer routing: one
initialization, one navmesh baked from the static geometry during loading or an
idle phase — **never on a gameplay frame** — and no rebake per spawn or per door
approach.

## 2.2 A blocked shopper walks around the queue

Merchandise to the right of the desk stays purchasable. When a line forms, a
shopper heading for it currently runs into the queue and never arrives.

Required: they detect the blocked corridor, take a valid longer route, never
grind against a body, fixture or wall, reach the item, buy it, then queue.

Use path queries plus crowd/local avoidance. Queue bodies are **dynamic
obstacles** — do not rebake the static mesh for them. Add a stuck detector based
on real progress toward the target, bounded repath timing with jitter so agents
do not all repath on one frame, arrival radii that prevent oscillation, and
recovery when a path goes invalid.

A teleport may exist only as a last-resort valve after repeated failed repaths,
must be off-camera where possible, and must be reported. **Routing is the
intended behaviour.**

**Evidence:** stage three queuers blocking the corridor, spawn a shopper whose
item is behind them, capture an overhead clip and a player-view clip, and inspect
the frames. Revert the integration and show the old grinding fails the same check.

## 2.3 No early or through-body handoff

A customer may not begin placing goods because they are index zero in an array.
Their **body** must arrive at the handoff position, the product's whole
trajectory must be clear of every other body, and the previous customer must
have left the corridor.

**"Never places anything" is not a pass.** Your driver must distinguish three
outcomes: correctly delayed, early through-body flight, and frozen. Serve one
customer, advance the second while the first is still leaving, and record the
product's actual path frame by frame.

## PHASE 2 ADVERSARIAL REVIEW

A verifier watches a busy shop for five minutes and reports every contact: body
to body, body to fixture, product through body. Any sustained contact is a
finding and a finding is the next item.

---

# PHASE 3 — THE LEDGER

## 3.1 A hotkey

Asked for in Goal 22 and Goal 23 and still absent. Route it through the binding
table, keep `K` if it is conflict-free, make it remappable and visible in
Controls. It opens from valid walk states, does not fire while a text field or
exclusive modal owns the keyboard, and may close the book on a second press.

## 3.2 The book owns all input

A previous check measured **exact zeros** for movement and I can still walk. It
called `ledgerBook.setCarried(true)` — the artificial carried state — while a
real player presses E or K, which is a different state entirely. **Say this in
the report before you change the implementation.**

While the book is open, opening, closing, or turning a page, none of these do
anything: WASD, arrow keys, gamepad movement, sprint, crouch, jump, mouse-look,
gamepad look, camera bob or drift, scroll or tool-cycle bindings, tool use, world
interaction through the book.

The camera stays composed on the book. Only book interaction, close, and the
global Escape path are live.

**Do not zero the velocity after the fact.** Stop the deltas entering the
world-camera update. Save the pre-ledger camera and input state and restore it
exactly on close.

**The test walks and looks normally first**, opens with a real E or K, holds
movement keys and moves the mouse across several real frames, measures exact
position, yaw, pitch, camera transform and active tool, turns a page while still
trying to move, closes, and confirms movement resumes.

## 3.3 A hover outline

When the crosshair genuinely aims at the cover: a clear, tasteful outline
comparable to the money highlight, plus the prompt. It clears the moment aim is
lost, never highlights the whole desk, never goes stale after open or close, and
does not clone a material per frame.

## 3.4 Smooth open, close and page turns

It opens the right way now and the motion snaps. **Film it, extract the frames,
look at them**, and fix the discontinuity you see. Continuous easing, believable
acceleration and settle, correct hinge direction, no restart-from-assumed-endpoint
when interrupted, and Escape resolves to a valid state. Pre-build page content so
no synchronous work happens inside an animation frame.

## 3.5 The UI rebuild

Recover the exact Goal 23 I3 requirements from the repo rather than inventing
them. "Where am I" and "how do I get anywhere else" are closed. Verify the rest:
section identity, navigation to every section, back and forward, no dead ends,
keyboard and mouse, readable hierarchy, consistent turn direction, selected and
hover states, state persistence, no lag from page generation.

## PHASE 3 ADVERSARIAL REVIEW

A verifier opens the book by hotkey and by aiming, tries every movement and look
input while it is open, turns twenty pages, navigates to three sections, closes
with Escape and with the hotkey, and confirms it can walk afterwards. On clips.

---

# PHASE 4 — TOOLS AND VISUALS

## 4.1 The broom head is tilted right

A sweep and a thirteen-candidate contact sheet already exist. **Pick the square
one yourself, bake it, photograph the result.** Square to the floor is the whole
criterion — it is not a taste call and I do not want another sheet.

If a later per-frame squareness solve made the **shaft** feel canted, fix that
too: the head correction belongs at the head pivot, not on the whole broom group,
and the hands must not inherit the roll. Cache immutable mesh measurements; only
cheap transform maths runs per frame.

## 4.2 The hands, and this is the fifth time

Both hands, both tools. The lower one is a blob; they read as low-poly lumps at
viewmodel distance.

**This is mesh work.** Fingers that read as fingers, a thumb on the correct side,
enough geometry to avoid faceting, correct grip contact on both tools, and not
dozens of draw calls per finger. Go through `golf-assets` if that is what it
takes. Photograph both tools, both hands, idle and active.

## 4.3 The mop reads as separate rods

It is a comb of pale rods with daylight between every one. **I want one mass:
each strand reading as a strand, and no gaps.**

Seven passes have gone into guessing the count. **Decide the shape of the answer
first and say which you took:** many more thin overlapping strands; flat ribbons
that overlap into a sheet at lower cost; or modelled/cloth-baked geometry through
`golf-assets`. Merge or instance them — not hundreds of draw calls. Damp cotton
material, not plastic.

## 4.4 The mop is too reactive

Heavy and damped. Carried: strands barely move, a sharp turn produces a small
slow response, no flailing, no jitter at rest. Actively mopping: they drag,
compress, lag and recover, responding to stroke direction and floor contact, and
settle smoothly when the stroke stops. **Separate carry and active parameters** —
one over-reactive solver cannot do both.

## PHASE 4 ADVERSARIAL REVIEW

A verifier equips each tool, stands still, walks, turns sharply, and uses it —
and photographs each at the default player camera. It judges by eye against a
reference photo of the real object.

---

# PHASE 5 — AUDIO

Every sound is synthesized from oscillators, which is why the ledger sounds like
static and electricity. There is not one audio file in the repository. The sample
player and licence gate are already built.

## 5.1 Where to get files — you do not need to ask me

Prefer CC0 so the game can ship without attribution complexity.

- **Kenney UI Audio** — CC0 — https://kenney.nl/assets/ui-audio
- **Kenney Interface Sounds** — CC0 — https://kenney.nl/assets/interface-sounds
- **Kenney Casino Audio** — CC0 — https://kenney.nl/assets/casino-audio
- Other Kenney packs only after checking that pack's own page says CC0.

For book, page, foley or music Kenney does not cover: Freesound filtered to CC0
or Attribution; OpenGameArt where the **downloadable file itself** is marked CC0
or CC-BY; or another library with explicit commercial-use terms.

**Never:** NonCommercial; vague "royalty free" with no licence text; a preview
file whose download carries a different licence; AI-generated static standing in
for real foley; a runtime call to a remote audio API.

Vendor everything locally. Record each file in `THIRD_PARTY_ASSETS.md`: local
filename, source page, original title, creator, licence and version, required
attribution, conversions performed, date obtained. Normalise, trim silence, short
fades, no clipping.

**If something genuinely cannot be sourced under those terms, tell me exactly
what it is and I will fetch it — but exhaust the list first.**

## 5.2 Kill the startup noise

A loud mower-like static plays on load. It is the first thing anyone hears and it
sounds broken. Find the real source — a stray oscillator, a bad loop seam, a
duplicated node, a decode error, a too-short sample looping — and remove or
replace it. **Do not just lower the master volume.**

## 5.3 The menu

Every clickable control makes a sound, including inside dialogs. Cancel and
destructive actions may use their own variant. Disabled controls stay silent.
Keyboard activation sounds the same as a click. Nothing double-fires on bubbling.

Build an inventory of every clickable menu and dialog control and verify each
emits **exactly one** sound event.

## 5.4 The money

The last report claimed these existed and I hear nothing. Cover the events a
player actually sees:

- individual notes and coins moving and being placed
- stacking and settling
- **the drawer opening** — currently silent
- **a continuous run while cash goes in** — "trrrrrrr" for the whole animation,
  driven by real animation progress and pieces landing, stopping when the last
  one lands. Not one generic impact. Cancels cleanly if the transaction is
  interrupted.
- final payment confirmation, distinct from menu UI

## 5.5 The ledger

Real recordings for pickup, cover open, cover close, page turn left, page turn
right. Multiple variants with small bounded pitch and volume variation. **Timed
to the visual contact, not the button press.** Predecoded and pooled so first use
does not hitch.

## 5.6 Background music

Quiet, loopable, unobtrusive, the kind a calm management sim has. No drone, no
mower timbre, no dominant melody. Seamless loop with no click at the boundary,
sitting below UI and customer sounds, respecting volume and mute, not restarting
on every scene transition, and not decoded on a gameplay-critical frame.

## 5.7 Audio performance

One shared context. Each small SFX decoded once. Pooled buffers, bounded voice
count. No synchronous fetch or decode during a door crossing, a page turn, a
payment or a menu click.

## PHASE 5 ADVERSARIAL REVIEW

A verifier taps the audio graph and records what actually plays: node created,
buffer, timestamp. **A source test asserting a callback exists proves nothing** —
that exact check certified a silent menu for two sessions. Every event fires once,
at the right moment, at an audible level.

---

# PHASE 6 — PERFORMANCE

## 6.1 Merge static meshes per material

Never started. Last measured: 574 draw calls standing, 942 peak, 838 static
meshes, 290 materials. **Measure again first.**

Classify meshes: static visual, interactive, animated, skinned, collision-only,
visibility-switched. Merge compatible static visual geometry per material and
render state; instance where repeated transforms suit it better. Preserve world
transforms, normals, UVs, lighting and shadow behaviour, material identity,
culling and appearance. Do not merge interactive objects in a way that destroys
hit targets. Do not merge across visibility zones if it makes the doorway render
more. Do not produce one enormous mesh that ruins culling.

**Target:** 30% fewer standing draw calls, 25% fewer at peak, unless profiling
shows another bottleneck dominates. Report before and after for meshes,
materials, draw calls, triangles, load time and doorway frame time.

## 6.2 Tool cycling

Switching tools lags. No tool may be rebuilt from source geometry on selection —
no repeated GLB parse, texture decode, material compile or audio decode. Inactive
tools hide and cache; one active viewmodel, no accumulating duplicates.

**Check:** 100 real cycles. First-use per tool, warmed p95 and max, object and
material counts before and after, heap before and after. No recurring frame over
33 ms after warmup, no memory trend, no duplicates.

## 6.3 Ledger open and page turns

Same standard. Pre-create page meshes and prewarm materials before the player can
interact. No frame over 33 ms after warmup across 50 page turns, no memory growth.

## 6.4 The cap and the numbers

Re-run the cap ladder. Report GPU ms, CPU submit ms, draw calls, achieved fps per
cap, and the worst frame in a 60-second indoor walk, before and after. Say plainly
whether the first-equip stall still fires.

## PHASE 6 ADVERSARIAL REVIEW

One Electron run demonstrating: acceptable load time, a smooth door approach and
crossing, smooth ledger open, page and close, smooth warmed tool cycling, no
recurring frame over 50 ms in any of them, and no memory growth trend. With a
frame-time overlay, and **look at the video.**

---

# PHASE 7 — GLOBAL ESCAPE

One top-level capture-phase Escape handler with explicit priority. Lower-level
components must not double-handle it.

Priority: cancel an active drag or placement; if the ledger is open or animating,
close it and restore the previous camera and input state; if the laptop, register,
desk screen, phone or any modal is open, unwind one layer; otherwise show a pause
menu offering Resume, Restart the current day, Return to main menu, and Quit —
with confirmation on the destructive ones.

Escape must never corrupt pointer lock, leave input disabled, accidentally bank or
void a transaction, duplicate an overlay, or strand the player between modes.

**Test with real Escape presses during:** the main menu and each of its dialogs,
the loading veil once input is possible, walking, the door transition, tool use,
tool switching, ledger opening, open, page turn, closing, register scanning,
bagging, card presentation, cash entry, the laptop, the desk screen, a combined
transaction, and placement mode. After each, confirm the player can resume and
still move.

---

# PHASE 8 — FINAL VERIFICATION

## 8.1 Regression sweep

Without reimplementing unless broken, confirm: the bag shows nothing; the specific
tee-time wording; the correct status text; the green fee once on the accepted
path; goods retained on the refused path; the laptop clear-counter voiding safely;
CSP still refusing broad `unsafe-eval`; recast initializing once; the broom head
still square.

## 8.2 The three verifiers

**Verifier 1 — Phases 1 and 2 on clips.** The bag, the full combined transaction
both ways, the shopper routing around a queue, no grinding, no through-body
handoff.

**Verifier 2 — Phases 3 to 7.** Ledger hotkey, input lock, outline, motion, UI,
sounds. Broom head, shaft, hands. Mop mass and dynamics. Menu, drawer, cash and
music audio. Draw-call results. Escape from every state.

**Verifier 3 — the stranger.** From a clean start, having read nothing, with real
input and no developer shortcuts. One question:

> **Can a stranger complete one full customer — products, a specific tee time or
> check-in, one payment, bag, and out through the door — without getting stuck,
> guessing an invisible state, hitting a major hitch, or needing a developer
> tool?**

A verifier finding becomes the next item. Fix it, re-run that verifier, then
re-run Verifier 3.

## 8.3 Done means done

Do not claim DONE when the before/after check cannot distinguish the code; a
movement clip was not viewed; a recurring frame over 50 ms remains; the flow only
works through a QA shortcut; an audio licence is unknown; the commit was not
pushed; or the suite was not green before the commit.

---

# REPORTING

`Designs/ProShop/OVERNIGHT_REPORT_25.md`, appended as you go, under 2,000 lines.

**At the top, always:**

1. **Perception ratio** — fixes verified by a check that could perceive the thing
   it certified, over total fixes.
2. **Probe-lie count** — how many of your own checks scored the same before and
   after, or measured the wrong object. Recent sessions logged 13, 16 and 7.
   **A zero means you are not looking hard enough.**
3. **Phase status** — which phases are gated closed.
4. **Performance headline** — load, door, ledger, tool switch, draw calls, before
   and after.

**Per item:** the symptom, the reproduction, the root cause, what the previous
check measured if it misled, files changed, before/after numbers, clip and
screenshot paths with confirmation the frames were viewed, the focused test
command and result, the revert-fail proof, suite and golden result, commit hash
and push status, and any remaining caveat.

**Plus:** an audio asset table with sources and licences, a performance table, and
a verifier results table.

Add every new false-positive shape you find to `FOUND_FALSE.md`. That file has
been worth more than any single fix in this project.

---

# WHEN YOU FINISH

Do not write a narrative. Give me:

- a DONE / PARTIAL / NOT DONE table for every phase and item
- exact before and after performance numbers
- the Verifier 3 result, in its own words
- audio sources and licences
- commit hashes and push status
- remaining defects, stated plainly
- paths to the report and every important clip

**Do not say "should be fixed." State what you observed.**

# START

Phase 0. Verify what you inherited before you change anything.