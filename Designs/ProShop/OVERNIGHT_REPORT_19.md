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

Written before changing anything, checked against the two known shapes.

**B4 (ledger open glitch).** The check (`electron-b-ledger-evidence.js`) grabbed
45 rAF frames at 640w around each E press and I judged them by eye for "boards
through the swing." Why it passed: the DoubleSide fix genuinely cured the class
it targeted (the cover's inner face CULLING for the whole swing), and in the
early swing (0–70°) the board IS visible — I generalized from those frames.
The late swing is the part the player sees: the cover crosses 70–140° nearly
edge-on (invisible at video scale), the title page stands "bare" against the
barrel spine, and at swing 0.72 the shell swap pops to the full spread
(`ledgerBook.js` SWAP_POINT). The user's 10fps recording samples land exactly
in that window (1.8–1.9s, 6.3–6.4s). The instrument had no per-frame predicate
— "a cover board must be visible in any frame where a page is" — so a human
eyeball passed a composition the design cannot actually produce. Instrument
shape: eyeball generalization, not two-populations.

**B5 (double set-down).** The check traced ONE object's state machine —
`ledgerBook.diagnostics().state/stateT` every rAF for 3.5s through the close —
and saw `open → closing → lowering → closed`, one clean pass, no repeats, no
stateT rewind. That result was TRUE and is precisely the evidence: the user's
footage shows the second animation starting ~0.2s AFTER `closed` lands
(14.10s at rest → 14.30s airborne again at held scale), INSIDE my trace
window. A bookState re-entry would have been caught; none was. Therefore the
second animation is driven from OUTSIDE the state machine — a second driver
moving the book (the user's own hypothesis: "two objects animating where I
see one" / a re-present at held scale). The instrument watched the right
object with the wrong scope. Shape: two-populations, the animation edition.
Candidates for section D: E key auto-repeat re-triggering `advance()` on the
freshly-closed book plus an auto-close reversing it, or a second driver in
clubhouse.js's ledger wiring. To be settled with a keylog + call-site trace.

**F2 (stuck rule).** The check (`tests/nav-stuck-one-second.test.js`) asserts
the pure `navStuckVerdict()` function on synthetic inputs plus two regex
source contracts (the 0.35s ladder gate, the give-up notification). "Watched
fail" was the pure function failing with the old constant restored. Nothing in
the check launches the game or watches an actor move. Why it passed while NPCs
still grind: customers sliding along a box face can register as MAKING
progress by the verdict's own inputs (moved≈step), actor-vs-actor collisions
produce no verdict at all, and whether the live plumbing even feeds
`noProgressT` for the movement states the player watches was never observed.
Shape: tested code with zero live observation — the same family as
tested-code-with-zero-call-sites. Section B settles what the live ladder
actually receives while a customer walks into a box.

**E1 (broom grip).** The check (`electron-e1-broom-grip.js`) applied four
`frame.yaw` candidates at ONE forced pose and I picked from four screenshots;
`broomDiagnostics()` supplied presence booleans (vmActive/twoHanded). It
measured one degree of freedom (yaw) at one camera pitch, and hand PRESENCE.
The complaints are hand SHAPE (the support hand renders as a fingerless
blob), hand ORIENTATION (upper-hand thumb on the wrong side), residual head
SLANT (a roll/pitch/bake composite that a yaw sweep cannot see), and SHADER
artefacts — none of which any instrument graded. Worse: the golden suite DID
flag the yaw bake as a visual family shift, and I accepted the new baselines
as "the intended change" — the one gate that could have argued was silenced
by my own rebaseline. Shape: instrument measures presence, complaint is about
form.

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
| B4 ledger open glitch | "full boards through the swing" | 45 rAF frames judged by eye | Early-swing frames show the board; the player-visible late window (cover edge-on + swap pop) had no predicate. Eyeball generalization. |
| B5 double set-down | "CANNOT REPRODUCE, traced per frame" | ONE object's bookState per rAF | The trace is true — the second animation never touches bookState. A second driver moves the book after `closed` lands. Two-populations, animation edition. |
| F2 stuck rule | "watched fail with old threshold restored" | Pure verdict fn + source regex | Never launched the game. Sliding registers as progress; actor-pair collisions produce no verdict; live plumbing unobserved. |
| E1 broom grip | "yaw 0.02 baked, both hands verified" | One DOF at one pose + presence booleans | Complaint is hand shape/orientation, head slant composite, shader artefacts — none instrumented; the golden flag was rebaselined away. |
