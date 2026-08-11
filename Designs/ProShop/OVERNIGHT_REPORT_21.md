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

# RUNNING LISTS

## UNCONFIRMED

_(nothing yet)_

## NOT DONE

- **Goal 20 F1, F2, F5** — the ledger's UI rebuild, its sounds, its open/close
  gesture. Frame evidence in `qa/clips/ledger/tiles-10.png`.
- **Goal 20 E2** — the card in the fingers. A measuring probe was written rather
  than a fourth guess; it returned null and needs work before the fix does.

## VERIFIER FINDINGS STILL OPEN

_(Verifier 3's opening run in flight)_

## FIXED BUT NOT ASKED FOR

_(nothing yet)_

## REPORTED DONE PREVIOUSLY, FOUND FALSE

See `Designs/ProShop/FOUND_FALSE.md` — the permanent home of this list.
