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

Three verifiers ran the game and tried to prove tonight's claims false. **No claim was
disproven; one queue item (K2) turned out not to reproduce at all.** Two claims got
sharpened, Verifier 1 found the L-queue's structural root (a dead, unreachable
front-desk surface), and Verifier 3 found the most important thing in this report: the
objectives card never renders.

### Verifier 2 — the tools and cleaning (I, J). All six claims held.

- **I1-mop VERIFIED, including motion**: two use-frames 500 ms apart show the head swung
  right-of-hands → bottom-left, intensity 0.692 → 0.441 — animated, not a static prop.
  Planted at 0.048. `qa/electron/verifier2/mop-use-a.png` / `-b.png`.
- **The short-tool finding is TRUE AS STATED — if anything understated**: the vacuum at
  its natural pitch is planted (0.024) with head NDC y −1.213 AND grip hand y −1.450 —
  the hands are framed out too, not just the head. `verifier2/vacuum-use.png` shows
  floor only.
- **I2 speeds independently re-measured**: 6.135 / 4.250 / 4.253 yd/s — within 0.034 of
  my numbers, moveIntent full on every frame (open lane, not a wall).
- **I3 confirmed open, with a corrected symptom**: at +1.0 rad there is no floating
  stick any more — there is NO TOOL AT ALL (fully stowed below frame, hands NDC y −4.6/
  −8.9). "No stick without a hand" is now satisfied vacuously; whether total vanish is
  the right read is the open I3 question. `verifier2/broom-lookup.png`.
- **J confirmed untouched**: Q reveal still renders the old translucent markers through
  walls, no object outlines. **E3 wiring live for rig tools**: mop intensity tracked the
  stroke (0.692 → 0.441), zero page errors across the session.

### Verifier 3 — the stranger. THE FINDING OF THE NIGHT.

Played cold from the main menu (New game → Relaxed), Day 1 6:00 AM → 6:50 AM game time,
32 screenshots + full text log in `qa/electron/stranger/`. Sixteen ranked confusions;
the full ranked list is preserved verbatim in
`Designs/ProShop/FIRST_RUN_STRANGER_SESSION_13.md` (this is N5's deliverable). The top
of the ranking:

1. **The objectives card never renders.** The DOM carried the goal text the whole
   session — "Survey the neglected property", "Enter the closed clubhouse — Open the
   green entrance doors with E and step inside", the FIRST-USE maintenance card — and in
   32 screenshots NONE of it is ever on screen. The stranger never learned to go
   inside and spent all 50 game-minutes in the yard. Every downstream "dead end"
   complaint in the session (their #2, #9) traces to this one display-layer defect. This
   likely also explains a chunk of the F5/first-run pain the queue keeps circling.
2. **Holding a tool erases every world prompt.** With the washer out, the prompt line
   shows only the tool's own controls at every yaw — the porch's "wash to 60%
   (currently 11%)" gate is only readable while NOT holding the tool that works it.
3. **"Z set down" toasts "Your hands are empty" while a washer is visibly in the
   hands** — held tool vs carried thing is indistinguishable on screen.
4. **The opening briefing fires under the loading veil** and is gone by the first
   playable frame (the greenskeeper's disease hook never reaches the player's eyes —
   and it is kickered "NOT AVAILABLE" like an error when it does exist).
5. Tab overview announces "18 dirty spots marked" over an unbroken carpet of trees;
   unlabeled white triangles; "east of the porch" with no compass; the QA "Test scene"
   entry sitting in the player-facing menu; pointer-lock loss silently hides all
   prompts.

Their "what worked well" list is equally specific (the crosshair prompt grammar, the
load screen, the pause shell, the Q reveal payoff) and is preserved with the list.

### Verifier 1 — blockers and checkout (H, K, L). All claims held; two discoveries.

Eight Electron sessions, zero page errors, zero crash veils. Evidence:
`qa/electron/verify1/`, replayable drivers `tools/qa/verify1-*.js`.

- **H1 attacked harder than my own sweep and held**: `i` while pointer-unlocked, 14
  rapid presses at 60 ms, `i` in overview / pause / laptop / build mode / course editor
  — and **all 36 alphanumeric keys pressed inside LIVE register mode mid-sale** (a
  surface my sweep never touched): 0 faults, register active through all 36, sale
  intact. Incidental worth knowing: `e` in overview enters the course editor — by
  design, and it would surprise a player.
- **H2 verified on pixels and disk**: the chip's measured rect is bottom-right in
  frame at the rollover write; `autosave-meta.json` flipped `mutation` → `rollover`.
- **H3 verified from three angles** with a broadened name sweep
  (/tether|backing|carrier|swing|price.?tag|hangtag/): zero tag nodes; the one hit,
  `MarkerBackingCard`, is the marker product's own blister-card packaging.
- **K2: THE COMPLAINT DOES NOT REPRODUCE.** A 150 ms poll from before the customer
  arrived found exactly one `FrontDeskShoppingBag`, visible on the counter EVERY tick —
  before tx begin, at tx begin, at first staged item, at E-engage. The bag is built
  persistent at register init; the planned K2 change is already the shipped behaviour.
  Marked for the user's eyes rather than closed unilaterally: `verify1/k2-ring-start.png`.
- **L-queue confirmed broken as reported — with the structural root found.** L1's
  "check-in at the asked time fails" understates it: **the live desk flow has no asked
  time at all** — walk-ins ask generically, `requestedTeeMinute` is null on the register
  path, and the ask→offer→book loop only exists in `src/ui/frontDesk.js`, which is
  UNREACHABLE DEAD CODE: `enterFrontDesk` (main.js:439) gates on
  `ch.register.cashierPose?.()`, and `cashierPose` exists nowhere in src, so it always
  returns. L2 is confirmed as 3 offer buttons + "Cannot Accommodate" (no grid); L3:
  zero /ledger|book/i nodes in the whole scene, `state.ledgerBook` undefined; L4:
  "House notes" nowhere. **The L-queue's first move next session is deleting or reviving
  that dead front-desk surface — the tee-sheet rebuild has a home nobody can reach.**
- Housekeeping: Verifier 1 backed the real saves up separately
  (`qa/audit/saves-backup-verify1-*`) and did not restore (correct — the full-day leg
  still owns the profile; my chained restore reinstates the originals when it ends).

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

**The full 9:00–19:30 day at 1x COMPLETED before this report closed**
(`qa/audit/combined-visits-FULLDAY.json`, zero errors; the user's real saves were
restored automatically at its end — all three generations verified back on disk).
98 arrivals across the day, under the harness's forced-walk-in regime (it seeds desk
errands whenever the floor is quiet, so 95 of 98 arrivals were desk errands — that
ratio is the forcing, not organic life; the funnel is the evidence):

| full 1x day, acts the customer controls | n |
|---|---:|
| desk errands | 95 |
| rolled combined (book+buy intent) | **39 (41%)** |
| started the shopping leg after check-in | **39 of 39** |
| ever reached the till with goods | **8** |
| paid | 0 (no cashier exists in an unattended harness) |
| check-ins completed | 95 |
| retail-only arrivals | 3 |

Split at that boundary: book-only 56, book+shopped 39, of whom 8 queued at the till
with goods. **The 39→8 drop across a full day is a NEW finding the 45-minute windows
could not see**: thirty-one combined shoppers started the retail leg and never reached
the till — with 95 bodies through the floor and a till nobody serves, the likely
mechanisms are patience expiry in the queue-less wait and browse-stand saturation, both
of which a playing cashier drains. It needs one attended session (or the till-playing
driver) to separate "harness artifact" from "real mid-shop leak", and it is now on
M1's open list by number rather than by vibe.

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
4. **The 39→8 mid-shop leak in the full-day run** — measured, cause not yet separated
   (patience in an unserved queue vs browse saturation vs a real routing fault). One
   attended session or the till-playing driver decides it.

## NOT DONE

| item | state and what it needs |
|---|---|
| **I3** broom look-up on screen | Not started tonight. Needs: preserve the pre-change pan FIRST, record, watch, fix what the frames show, 12-step pitch ladder control. |
| **I4** opposed hands + hand mesh | Not started. The grip rolls live in BROOM_FEEL.compose (handRollUpper/Lower); the review's plan (yaw the grip cluster instead of same-side rolls) is recorded in PLAN_12. |
| **I5** collider clamp for nine tools | Not started. The reviewed design (independent geometric penetration + contactMade precondition, open-floor zero-correction control) is in PLAN_12 §I5. |
| **I6** pushSpeed playtest | Blocked on the driver's pile-seeding fault; the bristle-relative invariant and margin control are specced in PLAN_12. |
| **J1/J2** reveal + media | Not started. J2's groundwork exists in the registry (six-class DIRT taxonomy with per-tool declarations already disjoint where it matters: vacuum=dust+debris vs mop=smear+grime+film); the two pinned two-media tests/drivers must be rewritten inside J2's block (review R3#4). |
| **K1, K3, K4, K5** checkout | Not started, with pre-banked facts: register.js:575 already denominates tender via makeChange, so K4 is visual-only (R3#14). |
| **K2** bag present from tx start | **Does not reproduce** — Verifier 1 polled every 150 ms from before the customer arrived: one persistent bag, visible every tick. Left open for your eyes rather than closed unilaterally (`qa/electron/verify1/k2-ring-start.png`). |
| **L1–L4** desk, tee sheet, ledger, lamp | Not started — and Verifier 1 found the structural root: the whole ask→offer→book surface (`src/ui/frontDesk.js`) is unreachable dead code (its gate calls `cashierPose?.()`, defined nowhere), so the live desk path has no asked-time at all. Next session starts by deleting or reviving that surface; then L1 sim fix → L2 grid → L1 evidence through the final UI → L3 → L4. |
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

Parent-level, this queue (31 items H1–P1): **12 done** (H1 H2 H3, I1 I2 I7, N1 N3 N4 N5
— the stranger list is delivered in FIRST_RUN_STRANGER_SESSION_13.md — O1, and
M1-part-1 measured+fixed+funnel-proven), **1 does-not-reproduce awaiting your eyes**
(K2), **18 open** (I3 I4 I5 I6, J1 J2, K1 K3 K4 K5, L1–L4, M1-remainder, N2, O2 O3,
P1). No forced closures; A8's two sub-items remain yours from the prior queue.

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

---
---

# Session 13b - the ledger book, the reveal, the counter order, the nav, the languages

Continues the same branch. Everything below was verified in Electron at the
player's camera, never in Chrome, and never on a green suite alone.
**Suite at time of writing: 2787 pass / 0 fail.** Commits pushed as they landed.

## If a verifier reads one thing

Two claims here were **false when first measured, and the instrument was the
liar, not the game**:

1. **The card-hover "87% of the crop changed"** was not a broken highlight. Every
   checkout flow auto-inserts the customer's card within about a second of
   presentation and the workspace camera re-frames with it, so both "quiet"
   captures straddled a global change. Rebuilt on the beat that actually holds
   ('card-entry', waiting on the player's amount).
2. **Two accessibility settings reported as inert** were working. The probe read
   `documentElement.className`; `applyDocumentPreferences` writes them as
   `data-*` attributes.

A third, same family: a nav path request whose endpoints sit inside colliders
returns an **empty** path, which a naive check reads as a perfectly straight
line. Two attempts passed that way before the run was made self-discovering.

## The club register (the book ruling, twice over)

Built in Blender against `Designs/LedgerBook`:
`tools/blender/build_ledger_book.py` -> `vendor/models/clubhouse/ledger_book.glb`.
Green leather, gold-embossed double border, brass corner caps with edge lips
and studs, five raised spine bands between brass caps, strap-and-buckle clasp,
layered arched page block, ribbon. Two subtrees the runtime toggles
(`LB_Closed` with a hinged `LB_CoverFront`, `LB_Open` with curved `LB_FaceL/R`
carrying the live page canvases), so the cover swing and the open spread are
the same book rather than two props.

| Complaint | What changed | Evidence |
|---|---|---|
| "it's all backwards" | Both the GLB page UVs and the turning leaf's were mirrored. Viewer-left is local +x; the exporter flips v leaving Blender, so the leaf's front and back need opposite u. | `qa/electron/journal-probe/02-open-contents.png` |
| "make the ui and text bigger" | One `TYPE_SCALE` (1.34) drives every glyph; rows per page 6 -> 5 so the type has room; every column and layout constant moved with it. | same frame |
| "closer to the user... up and on an angle" | 0.40 m from the eye, tilted 0.60 rad off vertical: a lectern, not a table. | same frame |
| "not too white where we cant see it well" | Page material tinted to `0xd7cfb8`. An unlit canvas at full white read as a glowing screen. | same frame |
| "instructions on the bottom for how to switch pages" | Printed in the page's own foot; labels come from the LIVE binding table, so a rebound interact key cannot leave the book teaching the wrong key. | same frame |
| "make the page swipes look super cool" | A segmented sheet that BENDS through the arc, hinged on the viewer-right edge so a forward turn lifts the right page across. | `03-mid-turn-*-TURNING.png` |
| tools should stow like at the register | C10's station predicate gains the reading desk, so every tool present and future is covered by the one setter. | `courseScene.js syncStationToolStow` |

The turn had a real bug behind the cosmetics: it swung the wrong way about +z
and dived **through** the page block, so nothing was visible. The mid-turn frame
also could not be captured by Playwright at all - the screenshot round-trip is
slower than the 0.55 s turn, so every "mid-turn" shot was really an after-turn
shot. It is captured in-page now.

Drivers: `tools/qa/ledger-book.js` **20/20**, `tools/qa/house-notes.js` **11/11**.
The ledger driver's negative control was sharpened: the old page-wide dark-ink
counter was measuring printed table furniture (~3.7k px on a blank register).
It now measures the **signature band** - **0** blank, **942** with one signature.

**L4 rides here.** The dead-panel house note followed the wrong gate. While the
office circuit is unpowered it now blames the circuit; once power is restored
and the panel still gives nothing it blames the fitting. The old wording kept
claiming "the ceiling circuit is dead" after the player had repaired that very
circuit. House notes also paginate - the starter's 9 notes overflowed one page
and the floor and beam teachings were silently dropped.

## Q1 - the reveal shows the mess, not the room

One filled quad per grime **cell** was the blob: a cell is 1.375 m across, so a
dirty floor lit up as a wall of tiles saying nothing the condition chip does
not. Grime is now speckles scattered inside each cell, count and size scaling
with how dirty it is, placed by a deterministic hash so the same floor shows
the same patches every boot.

`tools/qa/reveal-specificity.js` **7/7**: **167 speckles over 20 dirty cells**
(8 per cell, where the blob build drew 1) and the largest is **0.371 m against
a 1.375 m cell - 27%**, so no single mark can read as a slab. The cell size
comes from the renderer's own grid through diagnostics, not a number copied
into the driver. Control: reveal off gives 0 instances and 0 alpha; releasing
the key returns alpha below 0.01 (polled, because the fade is exponential and a
fixed wait was measuring the fade rather than the off).

## Q4 - the goods come first, the tee time is asked about afterwards

A combined visit read backwards: check in at the desk, get handed a shopping
errand, wander to the shelves, queue a second time. The errand is walked FIRST
now and the desk business is raised at the counter once the sale banks, worded
for whether they hold a booking or are hoping for one.

`tools/qa/combined-visit-order.js` **6/6**, by recording the customer's phase
every frame: the combined visitor's first phase is `shopping|shop` with a
2-item cart while the desk errand is still pending, and the ask is unspoken
until the sale banks. Control: a desk-only arrival never enters a shopping
phase and carries no cart.

Two harness fixes were needed because the staging could not reach the case:
`sendWalkInToDesk` hard-coded a pure desk errand, and the combined-visit roll
is now pinnable from QA.

## Q5 - a box on the floor is a box the customers can see

Only boxes the **player** had put down registered a nav collider, on the
reasoning that delivered pad and stock stacks "sit at known-clear spots". They
do not. Resting on the floor is the honest predicate, whoever put it there.

`tools/qa/npc-obstacle-nav.js` **7/7** on a 10 m run the grid chose for itself:
clear, one waypoint and zero offset (a string-pulled straight shot); with a box
on the midpoint, four waypoints bending **1.5 m** and none inside the box
footprint; box removed, straight again. A live customer walked the same floor
with **zero** nav-block escalations.

## Q3 - languages, and settings that are not placebos

`src/core/i18n.js`: one table, English is the key set, other locales are
overlays, a missing line falls through to English rather than showing a raw
key, placeholders are named so word order can differ. Coverage is reported on
the page rather than implied.

`tools/qa/settings-language.js` **7/7**: choosing Spanish through the real
select turns the tabs into Sonido / Camara / Controles / Pantalla / Idioma /
Accesibilidad, the page body follows, and the choice is in the saved document.
Control: back to English restores the tab strip and body **byte-identically**.
Plus 10 unit tests on the fallthrough, placeholder and coverage rules.

The same driver audits whether settings DO anything, reading the thing each
drives rather than the value it stores: fov moves the camera, shadows move
`renderer.shadowMap.enabled`, uiScale moves the CSS custom property, high
contrast and reduced motion move their document attributes, mute and invert-Y
move the live document. **Zero inert.**

## N2 / F2 - full key rebinding, in one piece

One table drives walk, prompts, settings capture and the book.
`tools/qa/rebinding.js` **10/10**. The walk probe measures the best of four
headings, because the register stand faces a collider and a live key blocked by
furniture read as dead.

## NOT DONE (session 13b)

| Item | State |
|---|---|
| **Q2** card reader UI modernised | Not started. |
| **Q6** characters - hat intersects the skull, real golf clothes | Not started. |
| **Q7** one hand per tool, per-tool animation / sound / physics | Not started. Largest remaining piece; reference is `Screenshot 2026-08-06 021333.png` - a single hand wrapping the shaft, forearm running out of frame. |
| **O2** rewrite player copy | Worklist drafted. Should land WITH the i18n row labels: rewriting and translating the same string twice is wasted work. |
| **O3** final polish walk | Blocked on the above. |
| **P1** texture pass, 19 files | Deliberately last, all-or-none. |
| **M1** combined-visit share across a full 1x day | The ORDER is fixed and proven; the day-long share measurement is still outstanding. |
| **A8** broom hand pose and sleeves | Reserved: graded personally. |

## Known and accepted

- Ignored walk-ins never leave. Patience is re-pinned each time they are
  re-queued; this matches the reservation desk's policy and was left alone.
- Settings row labels are English while tabs and headers translate. The
  coverage line on the Language page says so rather than implying full support.
