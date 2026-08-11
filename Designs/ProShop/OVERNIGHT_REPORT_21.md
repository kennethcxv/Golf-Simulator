# OVERNIGHT REPORT 21

Working `Designs/ProShop/Full_Goal_21.md` together with everything left unfinished
from Goal 20. Order as instructed: **Z and Y first**, then A, B, C, D, X, E, F,
G, H. Verifier 3 (the stranger) launched before the first line changed and runs
again after section X.

Branch `feature/pro-shop-vertical-slice`, from `9bf16b5`.

The fifth running list lives in `Designs/ProShop/FOUND_FALSE.md` now. This report
points at it rather than repeating it.

---

# CARRIED IN — ONE GOAL-20 ITEM THAT LANDED AFTER THE REPORT CLOSED

**Verifier 2's finding 4: the ledger could not be reached in normal play.** Forty
minutes at the desk, crosshair on the cover, prompt saying "Front desk".

**This is the FOURTH SHAPE the brief asks for**, and it is distinct from the
three already named:

> **TWO SELECTORS.** Two different rules answer the same question, and the fix
> configured the one that does not run.

Stations were chosen by a selector of their own — first match in `walkProps`
registration order, gated only on `facing > -0.2`, which is a hundred degrees off
axis. The front desk is registered eight thousand lines before the book, so it
always won. The book's `focusBias: 0.55` and `aimY` were added in an earlier goal
*specifically to beat the desk*, with a comment saying so — and they are read
only by the general scoring loop, which the station selector returns before ever
reaching.

Nothing was broken. Nothing was uncalled. The right object had the right
variable. The fix simply landed on a branch that never executed.

Fixed by lifting the general loop's scoring into `walkPropAimScore` and using it
in both places, so the two cannot disagree again. The forgiving station gate
stays as an eligibility floor — standing at the counter and pressing E without
looking squarely at it still works — but among qualifying stations the one under
the crosshair wins.

**Verified** (`tools/qa/electron-f-ledger-reach.js`, six checks green): looking
at the book names the book, looking away still names the desk, E opens it, **D
does not turn the page**, **E does** (spread 0 → 1), and **Q closes it**. F3 and
F4 were green in source for a whole session and had never once been exercised by
a player.

---

# SECTION Z — THE FOUND-FALSE LEDGER

`Designs/ProShop/FOUND_FALSE.md` now exists. Every item ever reported done and
found false, one row per item, with **what each check measured and why it
passed**, grouped by subject: the ledger book (3), the NPC stuck rule (3), the
broom (3), the mop (6), the queue and desk screen (3), the loading screen (2),
translations (2), the door lag (2), the stranger's own instrument (1), the
voicemail (1), the bag (2).

It names five shapes rather than three:

| # | Shape | The question that catches it |
|---|---|---|
| 1 | Two populations | *Is this the only code that decides this?* |
| 2 | Zero call sites | *What player action reaches this line?* |
| 3 | Right object, wrong variable | *Is the number I read the number the player sees?* |
| 4 | **Two selectors** | *Which branch actually chose, and does it read what I set?* |
| 5 | **Shipped disabled** | *Under what live conditions does this code execute at all?* |

Shape 4 is the ledger, above. Shape 5 is the leading suspect for the NPC
look-ahead and is investigated in section B.

The rule is written into `CLAUDE.md`, at the top, above the two skills:

> An item on the found-false ledger cannot be marked DONE again without a CLIP.
> Real input, default camera, frames extracted and VIEWED, and the report names
> the frame that proves it by timestamp. A number is not enough for these.

---

# SECTION Y — CLIPS, NOT SCREENSHOTS

`tools/qa/clip-frames.mjs` turns any recorded run into frames that can be
looked at:

```
VIDEO_DIR=qa/clips/<name> node tools/qa/run-electron.cjs <driver> --clubhouse=pine-hills-v2
node tools/qa/clip-frames.mjs qa/clips/<name> --fps 8
```

It writes one PNG per sampled frame **named by its timestamp**, contact sheets
for reading a whole gesture at once, and `frames/index.json` mapping frame →
seconds → tile → cell, so a claim can cite "the course changes at 3.40 s"
instead of "it seems to work". It finds ffmpeg via `FFMPEG`, the winget install,
or PATH.

## Y's own first use, and what it immediately showed

Recorded the ledger acceptance run: 336 frames, 42.0 s, 12 sheets. Looking at
`tiles-10.png` (frames 271-300, 33.75-37.50 s) showed **three things that no
still and no number in two sessions had reported**:

1. **The shut book presents as a flat vertical card** before it opens — the
   "stands it up like a little sign" pose, on the closed state this time.
2. **The open book fills the entire frame and then does not move for 25
   consecutive frames.** It snaps between states. This is exactly the Goal-20 F5
   complaint ("it still does not read as a book being picked up, opened, closed
   and set down") and it is visible in one contact sheet.
3. **The register's pages are empty** — ruled columns with headers and no rows.

None of those are what the driver was asserting, and all three are obvious the
moment the frames are on screen. That is the argument for Section Y in a
sentence.

Ledger UI, sounds and gesture (Goal 20 F1, F2, F5) remain **NOT DONE** and now
have frame evidence attached.

---

# VERIFIER 3 — THE OPENING RUN

Real input, no concessions used, 88 shots, ~25 minutes, game clock 6:04 → 8:47.

> **Did they get inside the pro shop? NO. Never.**

The door states its price clearly ("Clear the entrance and wash the porch before
repairing the doors") and the rail even carries live numbers ("wash to 60%,
currently 11%"). It still could not be done, for three reasons, and one of them
was not on anyone's list:

1. **The door-pocket warp trap** — eight "Stepped you back to where you last had
   room" toasts; every walk over ~1.5 s warped them into the front-door alcove,
   once from mid-lawn during a sprint. **A third of the session.** Fixed, X1.
2. **The critical path is hold-only**, and the bridge has no mouse-hold command,
   so the 60% wash gate was untestable end to end. The Goal-20 tap hint *did*
   fire and was quoted back verbatim ("Hold the button down to use a tool. A tap
   does nothing.") — a stranger-verified fix, and still not enough on its own.
3. **"Clear the entrance" maps to no verb the player can find.** Debris ignores
   E and X *silently*, and the tool belt holds washer, hose, divot kit and rake —
   no broom, no debris bag. The Debris bag exists, unconnected, in the tablet's
   equipment list.

Its other findings, all now on NOT DONE: the bunker rake viewmodel fills the top
third of the screen with deformed lumps; no current task is visible without
opening a menu, and the trackers that exist are only discoverable from the pause
menu's Controls page; the Q chip says "reveal dirt" but omits that it is a hold;
Tab opens on blank forest with no player pin and no legend, and its view chips
are overlapped by the phone badge; failed E/X interactions are completely silent;
unhealthy turf renders as flat salmon that reads as a debug tint.

What it praised: a ~6 s boot to a clean menu with a correctly-disabled Continue,
the door's live requirement numbers, tools that teach their own controls on
equip, held-Q's dirt reveal ("excellent"), the muddy footprints and CLOSED
plaque selling the fantasy, an honest pause menu, and a management layer that is
genuinely deep once found.

**Harness debt it found:** PowerShell's `Add-Content -Encoding utf8` puts a BOM
on the first line of `commands.jsonl` and the bridge drops that line silently;
and a pointer-locked `click` steers the camera before clicking, so DOM surfaces
must be driven by keyboard. Both belong in the bridge.

---

# A — THE QUEUE

## A1 "IN QUEUE" is deleted

Not fixed — removed. Three sessions went into making that badge tell the truth;
the answer is that it should not exist. The check-in screen shows the person **at
the desk** and nobody else, because everyone behind them has not asked for
anything yet, and a row for someone who has not spoken is a row the player can
plan against before the conversation happens. That is why it kept reading wrong
however accurate the label became. The constants are gone too — a constant left
lying about is how a deleted concept comes back.

## A2 The front of the line never leaves

Positions one and two are unconditional, however long it takes. From third place
back, patience is real, and that is where the pressure the game wants actually
lives: felt by the people you have not started on, not by the one you are halfway
through serving.

The rule sits at the single live fuse rather than at its call sites, because
copies are how the last one drifted. **Its test caught a live defect:**
`Number(null)` is `0`, and `0` is the front of the line, so any customer whose
queue position came back null would have been pinned in the shop for ever,
unable to leave. Second time this exact coercion has bitten.

**A correction that belongs at the top of this section:** the rule was first
written into `clubhouse/customers.js` — see section B — and would have done
nothing. It is in `clubhouse.js` now.

---

# B — NPCs STILL WALK INTO THINGS

## What the check measured, and why it passed

Eight headless tests called `steerAround` directly against a hand-drawn room of
literal boxes. All eight were correct. All eight passed.

**Not one of them asked whether the shop ever calls it — and it does not.**

`src/render3d/clubhouse/customers.js` is 1,400 lines containing `resolveMotion`,
`servicePatienceExpired`, the queue handling and the look-ahead I added. Its only
export, `createCustomerView`, **has zero call sites**. No file imports it, there
is no dynamic import, and the two references to it anywhere in the repository are
a comment and a test that reads it as *text*. The live customer loop is inline in
`clubhouse.js`.

That is shape 2 — zero call sites — at a scale nobody had considered: not a
function, a whole module.

## The hypothesis I had, and why measurement killed it

I predicted shape 5, "shipped disabled", and blamed my own `minTravel: 0.62`
guard against nav waypoints that are shifted at 0.28. It was a good story. It was
wrong. On the live path:

```
calls 3269   engaged 3006 (92.0%)   tooShort 263   steered 297 (9.1%)   trapped 0
travel mean 3.617 yd   max 12.02 yd   minTravel 0.62
```

The guard never mattered. Recorded in `FOUND_FALSE.md` as a refuted hypothesis,
because one that measurement kills is worth as much as one it confirms.

## What landed

The look-ahead now runs where customers actually walk, using an occupancy test
that mirrors `resolveCustomer` exactly — a look-ahead that disagrees with the
resolver makes the walker jitter between two opinions. Counters ride on
`navBlockDiagnostics().steer`, so "does this code run" is never again a question
that needs a hypothesis.

**Still UNCONFIRMED:** the brief asks for a clip following one customer past two
obstacles and a second customer, with the frames where the course changes named.
297 course changes in a minute is a number, not a clip, and B is a found-false
item. Not claimed done.

---

# SECTION X — THE ONBOARDING BLOCKER

## X1 The warp trap

The mechanism is not a bug in any single line. Breadcrumbs are only recorded
while **not** overlapping, so inside a persistent snag zone none are ever added;
the newest surviving crumb is therefore wherever the player last stood cleanly,
which can be minutes old and yards away; and `recall()` teleported them to it.

A crumb now only counts as "where you last had room" if it is both **recent and
near**. When none qualifies, `recall` declines and the caller falls through to
`nearestFree` — a local step out of the geometry, which is what a player expects.
The unbounded search is kept for the pause menu's own Unstick button, where the
player has explicitly asked to be moved.

Seven tests; **four fail on the old recall**, including the mid-lawn sprint
verbatim.

**Method note worth more than the fix:** the first attempt at that watched-fail
silently patched nothing, and all seven tests passed. That would have been
recorded as proof. It was caught only because passing was the wrong answer. A
revert must now assert that it changed the file.

---

# RUNNING LISTS

## UNCONFIRMED

- **B** — the look-ahead demonstrably runs (92% engaged, 297 course changes) but
  the brief asks for a **clip** naming the frames where a customer changes
  course. B is a found-false item, so the clip is mandatory. Not claimed done.
- **A2** — the rule is live and unit-tested; the brief asks for a queue of four
  draining on a clip. Not claimed done.
- **X1** — seven tests and a watched fail, but a stranger has not yet walked the
  porch again. Verifier 3's closing run is the check that counts.

## NOT DONE

- **Goal 20 F1, F2, F5** — the ledger's UI rebuild, its sounds, its open/close
  gesture. Frame evidence in `qa/clips/ledger/tiles-10.png`: the shut book
  presents as a flat card, the open book fills the frame and does not move for
  25 frames, and the pages are empty.
- **Goal 20 E2** — the card in the fingers. A measuring probe was written rather
  than a fourth guess; it returned null and needs work before the fix does.
- **X2** — the pressure washer still gives nothing on a tap but the hint.
- **X3** — the current task is invisible without opening a menu.
- **X4** — the Tab overview has no player marker and no legend.
- **C, D, E, F, G, H** — the mop's density and weight, the phone's mouse and
  icons, the loading screen, the door lag, the translations, the draw calls.
- **The bunker rake viewmodel** — deformed lumps filling the top third of the
  screen (Verifier 3, finding 3).
- **Silent E/X on debris**, and **"clear the entrance" mapping to no findable
  verb** — the second half of why a stranger cannot get inside.

## VERIFIER FINDINGS STILL OPEN

Verifier 3's opening run, above: findings 2 through 9 are all open except the
warp trap. Full write-up in `Designs/ProShop/verifier3_goal21_open.md`.

**Harness debt:** the bridge drops a BOM'd first command line silently, and
pointer-locked clicks steer the camera before clicking. Both need fixing before
the closing stranger run, or that run inherits the same blindfold.

## FIXED BUT NOT ASKED FOR

_(nothing yet)_

## REPORTED DONE PREVIOUSLY, FOUND FALSE

See `Designs/ProShop/FOUND_FALSE.md` — the permanent home of this list.
