# OVERNIGHT REPORT — Full Goal 19

Session start 2026-08-10 ~17:20. Branch `feature/pro-shop-vertical-slice`, HEAD at
start `4678128`. Tree carried the same 19 pre-existing `.blend` re-saves from the
open Blender (left unstaged, as last night) plus the untracked `dev/` stray.
Order worked: V3 stranger FIRST, then A, B, C, D, G, E, F, with the golden
world-Y pin inserted before C, and Phase 4 verification closing every section.

## TOP — VERIFIER DISPROOFS AND HEADLINE FINDINGS

(Filled as verifiers run. Four disproofs arrived with the goal itself — see the
fifth running list at the bottom.)

---

## V3 — THE STRANGER (run first this time)

Launched at session start, before any fix: a subagent playing the CURRENT build
from the main menu through a free-play command bridge
(`tools/qa/electron-freeplay-bridge.js` — file-IO REPL: it appends key/mouse
commands, the bridge screenshots after every command). It has read no code and
no docs; its only knowledge is the screen. Isolated `--user-data-dir` profile,
so it gets the clean-profile menu (Continue disabled). Report lands later in
this section.

## GROUND TRUTH — the user's ledger recording, frame by frame

16.03s at 30fps, 2292x1588. Extracted to `qa/ledger-truth/` (6 tiled overview
sheets at 10fps + 132 single frames at 30fps over the three event windows) and
VIEWED. Timeline (t=0 at video start):

- 0.0–0.5s approach; book closed on the desk.
- 0.6–1.7s pickup: book rises CLOSED and holds ~1.2s.
- **1.8–1.9s D1 GLITCH: the display pops from closed-cover directly to a bare
  cream title page standing alone, with the cover coiled into a green cylinder
  at its left. No cover boards behind the page, no hinge swing. ~2 frames at
  10fps.** (`overview-01.png` row 4 tiles 1–2; user's Image 3 is this state.)
- 2.0–3.9s full spread, correct.
- ~3.9s player presses close. 4.0–4.3s the book descends STILL OPEN (title
  page + coiled cover all the way down), shuts on the desk at ~4.3s.
- **4.6–5.3s D3 FIRST CONFIRMATION: after landing, the closed book RISES AGAIN
  to held scale and descends a second time.** (`overview-02.png` rows 3–4.)
- 5.5–6.2s player re-opens: rise, closed hold; **6.3–6.4s the same D1 rolled-
  cover pop**; 6.5s spread. 8.4s+ page turns (turn curls look correct).
- 12.0–13.5s reading The Deed. ~13.6s close pressed.
- **13.7–13.9s D2 GLITCH: the book sits ON THE DESK as a bare title page with
  the coiled-cylinder cover — the open-book presentation persists into the
  set-down.** (user's Image 4 is this state.) Shuts at ~14.0s.
- **14.10s at rest closed (setdown-25). 14.20s still at rest (setdown-28).
  14.30s AIRBORNE AGAIN at held-presentation scale, closed (setdown-31).
  14.40s descending (setdown-34); second landing ~14.5s. D3 CONFIRMED — both
  closes in the video double-play, and the second pass is a re-presentation of
  the closed book ~0.2s after the first landing completes.**

Reading for D: the open/close never hinges the cover — it pops between
closed-board and coiled-roll presentations (D1/D2 are the same defect seen in
both directions), and the set-down is animated twice by what looks like two
systems each moving "the" book once (D3). Code verification when section D
opens; the frames win over any instrument.

## THE FOUR REGRESSION STATEMENTS (what each check measured, why it passed)

## A — THE PHONE AND THE EMAIL

## B — THE QUEUE

## GOLDEN GATE — WORLD-Y PIN

## C — CHECKOUT

## D — THE LEDGER

## G — PERFORMANCE

## E — THE MOP AND THE BROOM

## F — SETTINGS UI

---

## RUNNING LIST 1 — UNCONFIRMED

## RUNNING LIST 2 — NOT DONE

## RUNNING LIST 3 — VERIFIER FINDINGS STILL OPEN

## RUNNING LIST 4 — FIXED BUT NOT ASKED FOR

## RUNNING LIST 5 — REPORTED DONE PREVIOUSLY, FOUND FALSE

| Item | What was reported | What the check measured | Why it passed while broken |
|---|---|---|---|
| B4 ledger open glitch | "same frame window now shows the full boards through the swing" | (statement pending — frames first) | (pending) |
| B5 double set-down | "CANNOT REPRODUCE, traced per frame" | (statement pending — frames first) | (pending) |
| F2 stuck rule | "watched fail with old threshold restored" | (statement pending) | (pending) |
| E1 broom grip | "yaw 0.02 baked, both hands verified on screen" | (statement pending) | (pending) |
