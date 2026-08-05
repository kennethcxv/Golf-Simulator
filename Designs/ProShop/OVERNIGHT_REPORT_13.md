# Overnight report — 2026-08-05 (session 13, queues H–P)

**Named `_13`, not `_12` as the brief asked:** `OVERNIGHT_REPORT_12.md` already exists —
it is last session's committed report, and this brief quotes its findings ("the set is
19 files", "the positioning pre-check is already clear"), so overwriting it would destroy
the record the brief itself cites. Divergence logged here and in PLAN_12.md.

**Suite: 2753 pass / 0 fail** (grew from 2748: the H1 contract pair + the broom socket
authority). Nine commits, pushed. Tree runs clean.

**Phase 4 verifier results are their own section near the top.** Anything a verifier
disproved is listed there and in NOT DONE, however it was reported below.

---

## How the session ran

Per the brief's four phases. PLAN_12.md was written before any code; three adversarial
reviewers filed **39 objections**, all answered in the plan with the changes they forced
(the two biggest: M1's "full 1x day" was already priced at 10.5 wall-hours per leg in
COMBINED_VISITS.md, and my I2/I6 draft recreated the pushSpeed competing-authority defect
— tool-run 4.25 > pushSpeed 3.91, false on landing). The reviewed order was followed:
baselines before H2's writes, I1's rig before broom polish, O1 before verbatim captures.

Reality contradicted the plan in one place worth naming: the plan budgeted ~24 working
hours of items into one night and said so. The cut line fell after O1. Everything below
the cut is in NOT DONE with exactly what it needs.

---

## PHASE 4 — adversarial verification

*(merged when the three verifiers returned — see the section lower in this file)*

---

## H1 — pressing `i` crashed the game. FIXED. Meets the bar: yes.

**Commit `fe4c93a`.**

Reproduced before fixing: `tools/qa/keyboard-sweep.js` pressed a–i and the run died on
`i` with `ReferenceError: setMaintenanceVisible is not defined` (main.js:2296), fault
veil up. The cause was original-sin wiring: `makeCourseMaintenancePanel` was imported
from the initial commit and never called; `toggleCourseInspection` and
`selectCourseMaintenanceEquipment` were imported and never called either. The whole
maintenance-tablet wiring was lost, and `i` called a function that never existed.

Fix: the tablet is created lazily on first press with real handlers and `i` toggles it.
The pause-menu controls list now names it.

**"Check every other single-letter binding for the same fault" — answered mechanically:**
`tools/audit/key-handler-contract.mjs` resolves every bare identifier called in
main.js's four keydown handlers against the file's definitions and imports. Against the
pre-fix source it finds exactly `[setMaintenanceVisible]` — `i` was the only one. It now
runs in the suite (`tests/main-key-handler-contract.test.js`) with an embedded self-test,
so the fault class cannot come back quietly.

Verified in Electron: 41 keys swept with return-to-walk recovery between presses, zero
page errors; `i` asserted on the DOM (`getClientRects`, after `offsetParent` — null by
spec for the fixed-position panel — scored a fully rendered tablet as invisible on the
probe's first run). Screenshot: `qa/electron/keyboard-sweep/i-panel-open.png` — the
tablet fully alive: category scores, aimed-patch row, eight equipment buttons, work
order. Negative control: the same driver FAILED on the unfixed build (banked).

F3 rider: the pre-fix crash wrote the real `crash.log` line (version header + stack),
banked to `qa/electron/keyboard-sweep/crash-log-banked.txt` before anything could rotate
it.

## H2 — autosave: 5 minutes, rollover, quit; rotating; visible. DONE. Meets the bar: yes.

**Commit `b8ba95e`.**

Every write records its **trigger** in `autosave-meta` (`interval` / `rollover` /
`quit` / `mutation`) — the review's core objection was that ~15 mutation sites already
called autosave(), so "a fresh file exists" proves nothing; the driver attributes each
phase by the trigger field read off disk in a mutation-free window.

- **interval**: proven by a real 5-minute idle soak — trigger `interval` landed at 275 s
  with nothing else writing.
- **rollover**: hooked on `daysPassed > 0` (value-watching, so sleep skips and multi-day
  batches save once per crossing); proven at 1x across midnight.
- **quit**: both pause-menu exits; proven with a REAL app exit
  (`tools/qa/autosave-quit-for-real.js` lets the app die; the wrapper validates
  trigger `quit` on disk inside the run window).
- **rotation**: on rotating triggers the current good primary copies to `autosave-prev`
  before the write — with the store's own `.bak` pairs, four physical fallbacks.
  **The first landing failed silently**: `autosave-prev` was missing from the IPC
  save-key allowlist, `fw:save` threw, and my rotation guard swallowed it — caught only
  because the driver checks for the file on disk rather than trusting the code path.
  Allowlist fixed; the guard logs what it skips now.
- **visible**: a small bottom-right "Autosaved" chip at every write, proven visible at
  the rollover write moment (`qa/electron/autosave/after-rollover.png`).
- Continue falls back to `autosave-prev` when the whole primary pair fails validation.

## H3 — the checkout swing tag is gone. DONE. Meets the bar: yes.

**Commit `2b74cb8`.**

C7 deleted the shelf rails and product swing tags; the third tag nobody caught was
`buildItemMesh`'s checkout tag — a brass tether + green-backed label riding 9.5 cm off
every item across the counter, its printed digits encoding the price. Deleted. The
barcode survives as a **flush sticker on the package face** at the product's own anchor
(same mesh name and userData — the scanner validates that plane's transform).

Verified in Electron (`tools/qa/h3-tag-free-checkout.js`): a staged three-item sale;
zero Tether/Backing/Carrier nodes in the scene; every sticker carries its real barcode
canvas texture (asserted, because a blank sticker scans green — `judgeBarcodeRead`
never sees pixels); screenshots `qa/electron/h3-tags/counter-staged.png` and
`-close.png` — item on the counter mid-transaction with nothing swinging off it. The
driver failed its own controls twice first (invented SKU ids staged nobody; then a
dangling `barcodeCarrier` reference), which is what the controls are for.

Scan mechanic: the acceptance flow reads a sticker end-to-end (picked → scanned →
bagged). `register-acceptance-cash.js` then times out on the SECOND pick — **verified
pre-existing at HEAD in a baseline worktree**, not introduced by H3. Filed under
harness debt in NOT DONE.

## I2 — tool-run capped, one authority chain. DONE, measured. Meets the bar: yes.

**Commits `05dff77` (+ `cda6eed`, mislabelled — see Commits), measurement in `a28ae8f`.**

Measured from the running build on open ground (the first attempt measured 0.507 yd/s
on every leg — the shop floor has no 1.6-second runway, the same wall-not-dead-input
conflation the withdrawn hold-W finding taught; the fairway does):

| leg | yd/s |
|---|---|
| run, empty-handed (before = after; the pre-change with-tool speed was this same code path) | **6.101** |
| run, broom out | **4.232** |
| run, mop out | **4.226** |

`TOOL_RUN_MULTIPLIER = 1.25` lives in locomotion.js, applied at the single speed site.
The half that matters: **pushSpeed now derives from TOOL_RUN_SPEED_YD_S** (4.89 = 4.25 ×
1.15) — deriving from the walk while a faster tool-run existed would have recreated the
original pushSpeed defect one shelf higher (reviewer 2's objection, accepted).
**Recommendation, as asked: run speed should NOT differ by tool** — all two-handed
carries, and a per-tool spread is a difference no player can read while every derived
constant has to chase the worst case anyway.

## I7 — the 1.247 has an authority. DONE. Meets the bar: yes.

**Commit `444581f`.**

The handle reach was a hand-typed measurement whose comment pointed at a
`broom-asset-sockets` test that **did not exist**. Now: `tools/gen/extract-broom-metrics.mjs`
parses the FP GLB (explicit path — the held asset, not sheet_08's world prop), composes
node transforms, and measures the SAME quantity the constant records
(GripPrimary→FloorContact — not a handle-mesh bbox, which is a different number; the
review caught that). Measured **1.2472** — the hand-typed 1.247 was honest. Generated
into `src/data/broomMetrics.js` with the GLB's SHA-256; the now-real
`tests/broom-asset-sockets.test.js` fails when the GLB and the constant disagree, and
carries a permanent negative control (the wrong socket pair reads 0.8407 — the
extractor demonstrably cannot return the right number for any pair).

## I1 — every stick tool through the broom's rig. LARGELY DONE, two findings. Meets the bar: mop yes; vacuum/dustpan/washer partially (see findings).

**Commit `a28ae8f`.** Driver: `tools/qa/tool-rig-verify.js`; screenshots
`qa/electron/tool-rig/*.png` (9 tools × rest + use).

One rig instance per stick tool from the factory the broom was approved through, per-tool
feel derived from BROOM_FEEL (`src/data/toolFeel.js`). The rig gained exactly one
behaviour switch (`anchor: 'floor' | 'carry'`) and per-asset socket names (the first
generalized run read `fallback` geometry for three tools because the rig only knew the
broom's socket vocabulary — SOCKET_DirtIntake, SOCKET_PanIntake, SOCKET_Grip,
SOCKET_SprayEmission are now feel data).

- **mop — the full treatment, on screen.** 78° lens pass, hip hands, planted head
  (0.048 ≈ its floorKiss), live sockets, wet-head arc/lag. `mop-use.png`: hand large in
  frame, cotton head on the boards. The reported "reads far away, has no real animation"
  is answered.
- **vacuum + dustpan — rigged and PLANTED (0.024 / 0.012, with stoop anchors), and the
  finding I1 asked for, measured to the corner:** their grip→contact runs are 0.796 /
  ~0.85 yd, and a sub-0.9 yd tool cannot satisfy hands-in-frame AND head-in-frame AND
  planted through a 78° lens — the planted head sits at the player's feet, below any
  frame that also holds hip-height hands. **Short tools need their own pose family in
  the rig — a composition change, not a number. OPEN.**
- **washer — 'carry' rig** (no plant, no reach cap, no up-look stow: walls are its job);
  hands and wand on screen; the lance's bearing still reads broom-ish (composition
  residual, open).
- **spray / cloth / sponge / trashbag — NOT rigged, by design (the second finding):**
  one-hand surface tools keep close-carry + useMotion; a two-hand shaft solve would put
  a phantom hand on a spray bottle.

An instrument lesson banked in the driver: my "drawn-pixel evidence" band-diff — added
to satisfy the review — measured the toast bar plus a global exposure shift (94%
"changed" while the vacuum was nowhere in frame). Demoted to non-evidence; the on-screen
claims are head/hand NDC at each tool's own natural work pitch, plus the screenshots.

## M1 — combined visits. MECHANISM PROVEN END-TO-END TO THE TILL; one gate widened; the split measured at the act boundary. Meets the bar: partially (the paid leg needs the player's hands by design).

**Commit `d9ee8b9` (part 1).** Evidence: `qa/audit/combined-visits-BEFORE.json`,
`-AFTER.json`; full-day leg launched (below).

What the measurement found, against the three prior "reported and not believed" rounds:

- **The C6 splice works.** Before-leg (45 game-min peak window, 1x, forced walk-in
  arrivals, pre-fix): 3 of 3 desk errands rolled combined intent, 3 of 3 STARTED the
  retail leg after check-in, 2 of 3 reached the till with goods. **0 paid — and
  purchasesCompleted was 0 for everyone including the 8 retail-only shoppers**, because
  purchases only complete when the player plays the till, and no unattended harness
  does. "Nobody does both" and "nobody ever completes a purchase in an unattended
  window" were the same observation.
- **The organic gate was the scarcity.** Walk-in tee requests required purpose
  'tee-time' AND a friendly/exacting personality — 0.58 × 2/6 ≈ 19% of arrivals could
  even ask. The personality clause is gone (wanting a tee time is a purpose, not a
  personality trait); purpose stays the gate.
- **After-leg (same window, same protocol): desk errands 3 → 13; combined funnel
  4 offered → 4 started → 4 reached the till with goods.** The customer's whole
  contribution to "both" now completes routinely; the paid step is the player's.
- The act-based accounting is already wired at the paid hop
  (`onCustomerPaid` → `combinedCompleted`, visit recorded as 'tee-time+retail').

**The full 9:00–19:30 day at 1x is running in the background as this report is written**
(COMBINED_VISITS.md prices it at multiple wall-hours; the peak window is the documented
honest substitute). It will land at `qa/audit/combined-visits-FULLDAY.json`, and the
user's real saves restore automatically when it completes. Window numbers above are
labeled as windows; nothing here claims to be a day.

Remaining for M1 (in NOT DONE): a till-played existence proof of one PAID combined
visit, the buy-only/book-only/both table from the full-day json, and the
shop-footfall/A7 re-measure the review scheduled.

## N1 — F1 settings menu re-verified: GENUINELY FINE, evidenced. Meets the bar: yes.

**Commit `5a5c6d0`** (driver `tools/qa/settings-verify.js`), screenshots
`qa/electron/settings/settings-*.png`.

The brief said F1 is wrong in the running game. Two-phase verification says otherwise:

- Phase 1 (change through the real UI): the settings shell opens from the pause menu;
  every listed control exists and operated — FOV, mouse sensitivity, invert Y, master +
  three category volumes, graphics preset, render scale, AO/bloom/shadows, UI scale,
  and the NATIVE window mode + resolution rows (displayInfo returned the real mode and
  a resolution list). **FOV applied to the live walk camera** (74° read back from
  `scene3d.camera.fov`).
- Phase 2 (relaunch, no UI touched): fov 74, sensitivity 1.65, invertY true, master
  0.55, quality 'low' **all returned from disk**, and the live camera followed the
  persisted FOV.

Screenshot `settings-display-changed.png` shows the full Display page. Two honest
residuals: no runtime accessor exposes the master gain node (preference verified, node
not), and sibling rows don't re-render immediately after a preset change (the toggles
still show pre-preset states until the tab re-renders — cosmetic, real, small).
If what the user hit was the laptop's own lens ignoring FOV, that is OBS-1 (known,
separate). `fw:crash-log` answered over IPC in the same run — N3's last piece.

## N3 — F3 crash handling: VERIFIED within headless limits. Meets the bar: yes, with one stated blind.

The real crash pipeline was exercised by H1's genuine crash: the fault line landed in
`crash.log` with the version header (banked). `fw:crash-log` round-trips over IPC. The
restart offer is a native dialog suppressed under FW_QA by design — **the dialog click
itself is untestable headless and is recorded as exactly that**, not claimed.

## N4 — F4 save robustness re-verified against the REAL saves dir. HOLDS. Meets the bar: yes.

Driver `tools/qa/save-robustness-boot.js`; per-case artifacts
`qa/electron/save-robustness/`. The user's saves were stashed first and restored after.

| case planted | result |
|---|---|
| corrupt JSON, primary AND backup | menu up, Continue DISABLED, no veil, 0 page errors |
| truncated primary, good backup | Continue enabled → **booted from the backup generation** |
| wrong-version (empireVersion 9999), bad backup | Continue DISABLED (refuses a future save), no crash |
| empty primary + empty backup | Continue DISABLED, no crash |

None crashed; every state was presented honestly. Positive control: normal boots
resumed working after restore (every subsequent driver run).

## O1 — em dashes out of the player's text. DONE. Meets the bar: yes.

**Commit `5a5c6d0`.** 432 em dashes replaced across 60 files — in **string literals
only**, via a lexical sweep (`tools/audit/em-dash-fix.mjs`) that walks the same
string/comment/regex states the auditor scans with, so comments keep their dashes and
the two tools cannot disagree. ` — ` became ` - `, the dash a person types. The
auditor's before-run (368 hits, banked at `qa/audit/em-dash-before.txt`) is its own
negative control; the after-run reports zero.

Fallout handled in the same change-set, as the review demanded: 96 test files' expected
literals moved with their strings, and the three tests pinning UI copy as REGEX
literals were moved by hand. Suite 2753/2753.

---

## UNCONFIRMED — shipped, not seen working

1. **How the mop/vacuum/dustpan/washer rigs FEEL in motion.** Every number and still
   frame is banked; nobody has watched a pan recording of the new rigs mid-stroke.
2. **pushSpeed 4.89 as felt gameplay** (I6). Derived from the right authority now and
   the tool-run speeds are measured, but "walk forward sweeping and the pile stays
   ahead" is still not observed — the pile-seeding fault in `broom-push-beats-walk.js`
   is undiagnosed. Carried from last session, now with the bristle-relative measurement
   plan from the review attached.
3. **The eight non-broom tool sounds as heard audio** — rig intensity now feeds E3's
   hook for rig tools (wiring verified); still nobody has listened.
4. **The full-day M1 numbers** — running as this is written; json lands at
   `qa/audit/combined-visits-FULLDAY.json` by morning with the saves auto-restore after.

## NOT DONE

| item | state and what it needs |
|---|---|
| **I3** broom look-up on screen | Not started tonight. Needs: preserve the pre-change pan FIRST, record, watch, fix what the frames show, 12-step pitch ladder control. |
| **I4** opposed hands + hand mesh | Not started. The grip rolls live in BROOM_FEEL.compose (handRollUpper/Lower); the review's plan (yaw the grip cluster instead of same-side rolls) is recorded in PLAN_12. |
| **I5** collider clamp for nine tools | Not started. The reviewed design (independent geometric penetration + contactMade precondition, open-floor zero-correction control) is in PLAN_12 §I5. |
| **I6** pushSpeed playtest | Blocked on the driver's pile-seeding fault; the bristle-relative invariant and margin control are specced in PLAN_12. |
| **J1/J2** reveal + media | Not started. J2's groundwork exists in the registry (six-class DIRT taxonomy with per-tool declarations already disjoint where it matters: vacuum=dust+debris vs mop=smear+grime+film); the two pinned two-media tests/drivers must be rewritten inside J2's block (review R3#4). |
| **K1–K5** checkout | Not started, with two pre-banked facts: the bag is already on the counter at ring-up start (screenshot `qa/electron/h3-tags/counter-staged-close.png`, bearing on K2), and register.js:575 already denominates tender via makeChange — K4 is visual-only (R3#14). |
| **L1–L4** desk, tee sheet, ledger, lamp | Not started. L-order per review: L1 sim fix → L2 grid → L1 evidence through the final UI → L3 (content-ready predicate, not the open flag) → L4 captures after the copy pass. |
| **M1 remainder** | Till-played paid-combined existence proof; the full-day split table; shop-footfall + one customer-day leg re-run (R3#9, #1's post-H2 leg). |
| **N2** key rebinding | Untouched by design — lands whole or not at all. |
| **N5** stranger list | Superseded by Phase 4's Verifier 3 (below) — their cold 20-minute list IS this deliverable, produced post-O1 as the review required. |
| **O2** copy rewrite | Not started beyond O1's mechanical pass. |
| **O3** final polish walk | Not reached. |
| **P1** texture pass (19 files) | Not started — all-or-zero honoured. The block must end with the part-visibility re-sweep + whitelist reconciliation (R3#10), and regenerating broomMetrics if the FP broom is ever in scope (R3#11). |
| **Harness debt found tonight** | `register-acceptance-cash.js` times out on its second pick at HEAD (pre-existing, proven in a baseline worktree); `combined-visit-day.js` counts completeCustomer returns naively (1414 "served" for 10 check-ins — cosmetic, the tally is authoritative). |

## UNASSESSED-AESTHETIC — yours to grade

1. **A8 hand pose and sleeves** — unchanged from report 11/12; deliberately left open.
2. **The mop/vacuum/dustpan/washer look** — `qa/electron/tool-rig/*-use.png`. The
   geometry claims are measured; whether each reads House Flipper-grade is yours.
3. **The washer's lance bearing** — visibly broom-ish composition, `washer-use.png`.
4. **The barcode sticker** — the tag is gone; whether a flush sticker on the package
   face is the right look for your shop is taste (`qa/electron/h3-tags/*.png`).
5. **The "Autosaved" chip** — size/placement (`qa/electron/autosave/after-rollover.png`).
6. **The eight tool tones** — still unheard.

## Count

Parent-level, this queue (31 items H1–P1): **11 done** (H1 H2 H3, I1 I2 I7, N1 N3 N4,
O1, M1-part-1 measured+fixed+funnel-proven), **20 open** (I3 I4 I5 I6, J1 J2, K1–K5,
L1–L4, M1-remainder, N2 N5→verifier-3, O2 O3, P1). No forced closures; two prior-session
items (A8 sub-items) remain yours.

## Commits

```
fe4c93a  H1: pressing i crashed the run - the maintenance tablet was never wired
b8ba95e  H2: the game saves itself - 5-minute timer, day rollover, quit - rotating and visible
2b74cb8  H3: the checkout swing tag is gone; the barcode is a flush sticker
05dff77  I2: shift with a tool out is capped at 4.25 yd/s, and pushSpeed derives from it
cda6eed  (MISLABELLED - carries I7's data files under I2's message; a failed `git add`
          left staged files and the retry committed them under the wrong message.
          Content is correct and complete across cda6eed+444581f; label noted, history
          not rewritten on the shared branch.)
444581f  I7: the 1.247 gets an authority measured from the GLB itself
d9ee8b9  M1 (part 1): wanting a tee time is a purpose, not a personality trait
a28ae8f  I1: the broom's rig becomes every stick tool's rig - mop full, two findings measured
5a5c6d0  O1 + N1/N4 drivers: em dashes out of player text; settings and saves re-verified
```
