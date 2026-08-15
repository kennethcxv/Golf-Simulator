# PLAN_12 — overnight 2026-08-04, queues H through P

Written BEFORE code, per the brief. Sections ordered by dependency. Times are honest
estimates; the cut line at the bottom says what I expect not to reach. Phase 2's
adversarial objections and my answers are appended at the end.

Standing constraints owned everywhere: Electron only; screenshot at the player camera or
UNCONFIRMED; every new instrument gets a negative control; sub-items count separately;
a clean negative is a completed item; suite green before each commit; commit and push
incrementally.

One divergence logged up front: the brief says write `OVERNIGHT_REPORT_12.md`, but that
file already exists (last session's report — the brief itself quotes findings from it,
e.g. "the set is 19 files" and "the positioning pre-check is already clear"). Overwriting
a committed report would destroy the record it cites. The new report will be
`OVERNIGHT_REPORT_13.md`, with this divergence stated in it.

---

## H1 — pressing `i` crashes the game (45 min, mostly done)

**Already reproduced before this plan was written**, because the plan should state a
verified cause: `tools/qa/keyboard-sweep.js` (new) pressed a–i in walk mode and the run
died on `i` with `ReferenceError: setMaintenanceVisible is not defined` at
`src/main.js:2296`, veil up, screenshot captured. Root cause: `makeCourseMaintenancePanel`
is imported at main.js:33 and **never called**; `maintenancePanel` stays null forever;
`setMaintenanceVisible` is called in the walk-mode key switch and **defined nowhere in the
repo**. This shipped in the initial commit — the fault predates every session; adding `i`
to a preventDefault path elsewhere merely made the key reachable enough for a player to
press it.

**Change**
- `src/main.js`: define `setMaintenanceVisible(visible)` — lazily create the panel via
  `makeCourseMaintenancePanel(app, handlers)` on first use, append into `gameUi`, wire
  `handlers` = { setVisible, toggleInspection, selectTool } against the walk/scene APIs
  that exist in this slice, each call optional-chained so a missing course capability
  degrades to a toast, never a throw.
- `tools/qa/keyboard-sweep.js` stays as the regression net: full a–z, 0–9, named keys,
  zero pageerrors required.
- `tests/main-key-handler-contract.test.js` (new): parse `src/main.js` source, collect
  bare identifiers invoked inside the keydown handlers, assert each is defined in module
  scope or imported. The checker self-tests against a synthetic snippet containing an
  undefined callee (it must catch it) so the instrument cannot silently match nothing.

**Verify** — keyboard-sweep full pass in Electron (it FAILED pre-fix, which is the
instrument's negative control, already banked); `i` opens/closes the maintenance panel,
screenshot of the panel open at the player camera; suite green.

**Risk** — the panel's handlers reference course-maintenance verbs this pro-shop slice may
not fully support; wiring them naively could resurrect a second latent crash. Mitigation:
every handler body optional-chains and the sweep presses `i` twice (open + close) plus
clicks nothing — panel interactions beyond visibility are out of H1's scope.

## H2 — autosave: 5 min + rollover + quit, rotating, visible (75 min)

Recon done: `autosave()` exists (main.js:1168) writing `scopedKey('autosave')` +
`autosave-meta` on ~15 mutation events; `src/core/nativeSaveStore.cjs` already writes
atomically (temp + fsync + rename) and keeps the previous good primary as `.bak`, and
`loadStatus` repairs from backup. So the single-write-corruption case is already covered;
what is missing is cadence (no timer), rollover/quit triggers, a second rotation
generation, and any player-visible signal.

**Change**
- `src/main.js`:
  - `AUTOSAVE_INTERVAL_MS = 5 * 60_000`; timer armed while `app.screen === 'game'` and an
    empire exists; skipped while paused at 0-speed to avoid writing identical states.
  - Day rollover: hook the existing day-advance path (the sim's minute wrap; find the one
    place `state.clock.minutes` crosses a 1440 boundary in the tick) → `autosave()`.
  - Quit: pause-menu Quit and menu `onQuit` await `autosave()` before `fw:quit`;
    `window.addEventListener('beforeunload')` fires a best-effort save.
  - Rotation: before writing, if the current `autosave` primary parses, copy it to
    `scopedKey('autosave-prev')` (same saveData path → prev also gets a `.bak`). Four
    physical fallbacks deep.
  - Feedback: a small `hud-autosave` chip ("Autosaved") fading over ~1.6 s, not a toast.
- Load side: `loadEmpireSave` fallback order autosave → autosave-prev when the primary
  chain fails validation.

**Verify** — Electron drivers: (1) rollover: set clock to 23:59, run 1x, assert a fresh
autosave write (file mtime + meta) and the chip visible in a screenshot; (2) interval: a
6-minute real-time soak asserting ≥1 timed write; (3) quit: mutate state, quit via pause
menu, relaunch, Continue, assert the mutation survived; (4) rotation: corrupt the primary
AND its .bak on disk, boot, assert autosave-prev loads with the recovery message.

**Negative control** — corrupt every generation → the menu must surface "could not be
read" and leave the tree bootable to a NEW game, not crash. Also assert NO autosave write
happens on the menu screen (timer must not run outside the game).

**Risk** — `beforeunload` + async IPC is unreliable by nature; the honest claim will be
"quit via the in-game menus always saves; OS-kill is best-effort", stated in the report.

## H3 — price tags still on items at checkout (60 min)

Recon done: C7 genuinely removed the shelf rails (`fixtures.js`) and the product swing
tags (`catalogProductVisual.js`) — but `buildItemMesh` in
`simplifiedRegisterMode.js:3579` hangs a **9.5 cm swing tag off every checkout item**: a
brass tether + green backing plane + barcode label whose printed digits literally encode
the price in digits 7–11. That is the tag the user is still seeing.

**Change** — remove tether + backing + carrier; render the barcode as a flush sticker at
the product's own `RuntimeProductBarcodeAnchor` (package face), bars only, no printed
digit row (the digits are the price). The scanner contract survives: `judgeBarcodeRead`
reads the label plane's transform, and the plane still exists on the package face with
the same orientation semantics.

**Verify** — walk a full sale in Electron: screenshots of the counter with staged items
before scanning, mid-scan, and bagged; the pre-fix screenshot with the swing tag visible
is captured FIRST as the before. Register acceptance driver stays green (scanning still
works — the claim that can fail).

**Negative control** — the after-screenshots must still show the flush barcode on the
package face; if no barcode is visible at all, the instrument is looking at the wrong
items or the scanner broke, both of which the acceptance driver catches.

**Risk** — some SKUs' anchors were authored for the swing offset and may sit proud of the
mesh; a flush sticker could float. Mitigation: clamp sticker to the visible-bounds face
along the anchor normal.

## I2 — shift-with-tool is far too fast (30 min) — BEFORE I6

**Change** — measure first: hold Shift+W with broom in the open lane, report yd/s
(expected 3.4 × 1.8 = 6.12). Add `TOOL_RUN_MULTIPLIER` (≈1.25 → 4.25 yd/s) to
`src/data/locomotion.js`; apply at the single speed site in `courseScene.js` when a
cleaning tool is held. Report before/after numbers. Recommendation to write into the
report: one tool-run number for all tools (they are all two-handed carries; per-tool
differentiation buys nothing a stranger can read), unless the mounted-cart case says
otherwise.

**Verify** — the same measurement after; both numbers from the running build via
position-over-time, not from the constant.

**Negative control** — run WITHOUT a tool must still measure ~6.12; only the tool case
changes.

## I6 — pushSpeed has never been playtested (60 min, after I2)

**Change** — first fix the instrument: `broom-push-beats-walk.js` returns inconclusive
because the seeded pile is not being swept; diagnose (sweep contact vs seed position,
medium filter, surface id) with the driver reporting WHICH precondition failed. Then the
measurement: walk forward at the fastest tool speed while sweeping; assert the pile's
lead over the bristles never goes negative for N frames. If I2 lowers tool-run below
pushSpeed 3.91, keep the margin; if tool-run had stayed 6.12 the derivation itself would
have to move — say which happened in the report.

**Verify** — driver produces a real verdict on the live build, both at walk and at
tool-run speed.

**Negative control** — set pushSpeed temporarily to 1.0 in-page (runtime override, not a
commit): the driver must FAIL with overrun; restore. An instrument that cannot see an
overrun cannot clear one.

## I3 — the broom look-up still glitches on screen (60 min)

**Change** — record the +pitch pan via VIDEO_DIR, extract frames, look at them, and fix
what is seen, not the numbers. Expected fix shape: the stow currently caps
(GRIP_STOW_MAX 0.45) so at high pitch the broom hovers half-stowed — replace cap with a
full exit: stow scales until the entire viewmodel is below the frame bottom by ~+0.9 rad,
eased, monotonic (no fight between reach cap and stow). Whatever the frames actually
show wins over this prediction.

**Verify** — re-record the same pan; frame strip into the report; screenshots at 0, +0.5,
+0.9, +1.2 rad. The claim "no stick without a hand at any pitch" checked per frame.

**Negative control** — the frames at pitch ≤ 0 must be pixel-identical in framing to the
pre-change recording (the fix must not touch the working range).

## I4 — hands on opposite sides + a better hand mesh (60 min)

**Change** — `src/data/broomFeel.js` grip rolls back to opposed (upper palm-down over the
shaft, lower palm-up under it, the push-broom hold); solve the fingers-face-camera
problem by yawing the grip cluster a few degrees toward the lens instead of rolling both
hands to the same side. Then the mesh: knuckle ridge + distinct thumb wrap + correct
scale on the procedural hands, at the fidelity the 420 px crop demands.

**Verify** — screenshots at player camera and at 420 px crop, rest + mid-sweep.
Aesthetic grading stays with the user (UNASSESSED-AESTHETIC); what I verify is the
measurable part: hands on opposite sides of the shaft in the crop, no interpenetration.

**Risk** — this is taste-adjacent; I can land "anatomically plausible opposed grip" and
still miss "reads high quality". The crop goes in the report either way.

## I5 — the collider clamp E2 never finished (75 min)

**Change** — in the shared floor-anchor solve in `courseScene.js`: after the vertical
solve, query the walk collider at the tool's contact XZ; if blocked, binary-search the
contact back along the camera→contact horizontal ray to the fixture face + margin, apply
to the group, re-sample residual. All nine tools inherit it because it lives in the
shared solve, not per tool.

**Verify** — extend `floor-anchor-probe.js` to report penetration depth per tool pressed
against the counter (drive the player into it); nine screenshots, one per tool, pressed
against a fixture; penetration ≤ 0.05 yd for all nine (was 0.60–0.76).

**Negative control** — open floor: clamp correction must be 0.000 for all nine (proves
the clamp cannot fight the anchor where there is nothing to clamp against).

## I7 — the known-blind 1.247 (45 min)

**Change** — `tools/build/extract-broom-metrics.mjs`: parse the broom GLB's JSON chunk,
read the handle node's accessor min/max, emit `src/data/broomMetrics.generated.js` with
the length and the GLB's SHA-256. Test recomputes the hash and compares; BROOM_FEEL
imports the generated constant.

**Verify** — generated value equals 1.247 within float tolerance (or the true value, and
then every dependent test updates — finding, not chore).

**Negative control** — point the extractor at a wrong node once during dev: value must
change and the test must fail. Then restore.

## I1 — every stick tool gets the broom's treatment (150 min, partial delivery likely)

**Change** — the broom's rig (`broomViewmodel.js`: separate 78° lens pass, hip-height
hands, floor-anchored head with plant window, sweep arc, weighted lag, grip stow) becomes
config-driven: a `viewmodel` descriptor per tool in `cleaningTools.js` (grip sockets,
head socket, lens, arc params, anchor mode). Two-handed stick tools (mop, vacuum,
dustpan, washer, scrub if long-handled) adopt it as config. One-handed tools (sponge,
spray, cloth) need a one-hand rig variant — that is a REAL code change and will be
reported as a rig finding, exactly as the brief predicts.

**Verify** — extend `floor-tools-onscreen.js`: per tool, rest + mid-use screenshots at
the player camera; per tool the broom-standard numbers (head-above-boards at rest/use,
hand NDC on screen, lens active).

**Negative control** — the broom itself re-measured through the same driver must not move
(the generalization cannot regress the reference tool).

**Risk (the big one)** — this is the largest single item in the queue; the one-hand
variant may not land tonight. Partial delivery = whichever tools pass the broom-standard
numbers, each with screenshots; the rest stay NOT DONE with the rig finding written up.

## J2 — a medium and a colour per tool (60 min) — before J1's colours mean anything

**Change** — `cleaningTools.js`: `medium` per tool + a reveal palette. Honest overlaps
declared rather than invented: broom+dustpan share debris (pair by design: broom piles,
dustpan collects); spray+cloth share smudges (spray loosens, cloth lifts). Distinct:
vacuum=dust, mop=grime, scrub=stains, sponge=spills, washer=exterior grime. Dirt
spawns tagged by medium in `dirt.js`; the Q reveal filters and colours by the held
tool's medium.

**Verify** — the tool-to-medium map as a table in the report; screenshot of the reveal
with each of the nine tools held, each showing its colour.

**Negative control** — holding a tool must NOT reveal another medium's dirt in its
colour: seed two media side by side, screenshot shows only the held tool's medium lit.

## J1 — the reveal shows the OBJECT, not a marker (75 min)

**Change** — replace the blue circles / flat patches with the thing itself: dirt decals
re-rendered through geometry (depthTest false) tinted by medium — the decal IS the
silhouette of the dirt; debris props get an inverted-hull outline shell; cleanable
surfaces (windows) get an edge highlight on their own mesh. Colours from J2.

**Verify** — screenshots: reveal held with dirt+debris+window in frame; the shapes on
screen must be the objects' own shapes (compare against the non-reveal frame).

**Negative control** — objects with no cleanable state must show NO outline in the same
frame (seed a clean patch next to a dirty one).

## K2 → K3 → K5 → K4 → K1 — checkout (25+35+30+60+45 min)

- **K2**: move bag spawn to transaction begin (or persistent on the counter);
  verify: screenshot at the moment the first item stages — bag already present.
  Control: bag must not double-spawn at the old trigger (count bag meshes).
- **K3**: hover highlight becomes the note's outline only — edge shell/line around the
  bill mesh, nothing over the interior. Verify: hover screenshot; interior pixels
  unchanged vs non-hover frame except the outline band.
- **K5**: reader glass palette lightened, DUE amount stays dominant (largest element,
  highest contrast). Verify: screenshot; measure relative luminance of glass vs before,
  amount px height unchanged.
- **K4**: tendered cash uses the drawer's bill mesh + `billTexture`, denominated to sum
  to the tender ($30 = $20+$10 fanned on the desk). Verify: force a $24.36 sale, $30
  tender; screenshot; the driver asserts the spawned denominations sum to tender.
  Control: tender $23 → $20+$1+$1+$1, sum asserted again (two cases, not one).
- **K1**: bag scaled down (still > the pre-A6 original — judged against monitor+reader
  per the pre-resolved decision), crease/wrinkle normals on the paper, stamp redrawn.
  Verify: screenshot beside monitor and reader; before/after pair.

## L1 — tee-time check-in fails at the asked time (60 min)

**Change** — instrument first in a 1x Electron run: walk-in asks a time → what
`teeTimeOffers` offered → what `createWalkInBooking` booked → what
`checkInReservation` did. Fix where it actually breaks. Then the required table:
several requested times, asked vs offered vs booked, at 1x.

**Verify** — the table from the running build, plus the desk flow screenshot at the
moment a check-in succeeds at the asked time.

**Negative control** — a deliberately full slot must still fail check-in with the honest
message (the fix must not make check-in always succeed).

## L2 — rebuild the tee-sheet UI (90 min)

**Change** — `frontDesk.js`: replace the 3-offer buttons with a full-day slot grid
(30-min slots, ~27–32): states free / booked / near-ask (±30 min of the request,
visually distinct) / selected (about-to-book). One glance answers "what's free, what's
near what they asked, what am I about to book".

**Verify** — screenshot with a real request active showing all four states at once
(seeded bookings guarantee a booked slot in frame).

**Negative control** — the grid's slot count must equal the reservation sheet's slot
count for the day (driver compares grid children to `daySheet` length — the UI cannot
silently truncate).

## L3 — the ledger book exists and can be found (120 min)

**Change** — per #127's ruling (pre-resolved): a physical book on the front desk
(procedural: covers, page block, canvas-rendered spread), `[E] Open the ledger` prompt
via the standard interactable path; opens IN PLACE with the laptop's focus-pose pattern
(eased camera, DOM overlay is NOT used — pages are canvas textures on the spread so it
stays diegetic); page-turn on click/Q-E; auto-records what the game already tracks
(day-one: first visits by named party holders, bookings, best day takings — whatever
`state` actually holds tonight; schema `state.ledgerBook.entries[]` with a healer).
Blank pages day one are correct.

**Verify** — Electron: walk to desk → prompt screenshot → open → page-turn screenshots;
record appears after a booking; save/load round-trip keeps it.

**Negative control** — fresh profile: book opens to blank pages WITHOUT error (the empty
state is the day-one state, it must not manufacture entries).

## L4 — the lamp teaches itself (45 min, after L3)

**Change** — the C8 prompt chain stays the world's voice; the ledger gains a standing
"House notes" page stating the loop in plain words (what breaks, what it needs, where
kits come from, what to do). Then write the shortest first-time path, step by step, into
the report.

**Verify** — screenshots: dead-lamp prompt rungs + the House-notes page.

**Negative control** — the House-notes page must render on a fresh profile (not gated on
any progress flag).

## M1 — combined visits (75 min)

**Change** — measure FIRST with the customer-day harness at 1x, full day, shop OPEN,
scriptedVisit exemption active: buy-only / book-only / both counts. Then make both
common: desk-served customers (check-in + walk-in) roll a browse-after-desk continuation
(~0.35–0.45), shoppers roll a smaller book-after-buy. Re-run the full day.

**Verify** — the split across a full 1x day with real arrivals, before and after, in the
report. "Both" should be a common outcome (target ≥20% of mixed-capable arrivals, exact
number reported, not forced).

**Negative control** — the harness's own totals must reconcile: buyOnly + bookOnly +
both + neither = arrivals (the counter cannot invent or lose customers).

## N1 / N3 / N4 — the reported-done trio (30 + 20 + 40 min)

- **N1**: in Electron, open settings from the pause menu; verify each control on the
  user's list exists and operates; change FOV/sensitivity/volume/preset; relaunch;
  verify persisted. Screenshot open. If something is genuinely broken (the user says it
  is), fix it; if fine, show why with the relaunch evidence. My recon says the panel code
  covers the full list INCLUDING native resolution/fullscreen — the gap, if any, is in
  reachability or persistence, so that is where the verification aims.
- **N3**: H1's crash (pre-fix) already exercised the real pipeline once. Verify the log
  file under userData/logs actually contains the fault line; exercise `fw:crash-log`
  round-trip; the restart dialog is native and headless-suppressed (FW_QA) — the dialog
  click itself is untestable headless and will be reported as exactly that.
- **N4**: write corrupt / truncated / wrong-version / empty saves into the REAL
  userData saves dir for both slot and autosave keys; boot each; none may crash; the
  menu must present the honest state. Screenshots of each message.
  Control: a VALID save must still load normally after the bad-save sweep (the healer
  must not be so aggressive it eats good saves).

## N5 — the stranger pass (45 min)

Fresh profile, first ten minutes, played cold in Electron at 1x. Every
would-not-know-what-to-do moment, ranked by how early it happens, with timestamps and
screenshots. NO fixes. The list goes in the report verbatim.

## O1 — em dashes out of everything the player reads (60 min)

**Change** — audit script (`tools/audit/em-dash-strings.mjs`): walk src, strip comments,
list string literals containing `—` (plus canvas-drawn text paths). Fix every
player-visible one by rewriting the sentence (not by swapping in a hyphen). Code
comments untouched.

**Verify** — script reports zero player-string hits; spot screenshots (a toast, a
prompt, a laptop page) confirming live text.

**Negative control** — the script run against HEAD~ (pre-fix) must report the known
hits — an auditor that finds nothing before the fix is broken.

## O2 — copy pass (60 min, prioritized not exhaustive)

Worst offenders first: toasts, prompts, tutorial lines, laptop intros, error messages.
Short sentences. Plain words. Before/after samples in the report. If the sweep cannot
cover everything tonight, the report says which surfaces were done and which were not.

## N2 — key rebinding, one piece (NOT EXPECTED TONIGHT)

Binding table in data; every compare site in `courseScene` walkKeyDown/Up + `main.js`
handlers reads the table; capture panel in settings; conflicts; persistence; reset.
Tap-vs-hold for Q's two verbs. It lands whole or not at all — if the earlier queues eat
the night, this stays NOT DONE by design rather than half-routed.

## O3 — final polish walk (only if everything above lands)

## P1 — the 19-file texture pass, one block, LAST (3.5–4 h, NOT EXPECTED TONIGHT)

All 19 or zero, pre-resolved. sheet_07's nine (61–64, 66–70) + sheet_08's ten (71–80),
via `build_pf_*`-style Blender headless with the ShaderNodeMix pattern (the only pattern
that exports baseColorFactor), three local CC0 families, ART_BIBLE §7.4.1 palette,
`tests/proshop-basecolor-factor.test.js` gating, texture memory measured against 150 MB
before/after, per-asset before/after screenshots. If the night ends before P1 starts,
zero files are touched (all-or-zero).

---

## Order and the expected cut

H1 → H2 → H3 → I2 → I6 → I3 → I4 → I5 → I7 → I1 → J2 → J1 → K2 → K3 → K5 → K4 → K1 →
L1 → L2 → L3 → L4 → M1 → N1 → N3 → N4 → N5 → O1 → O2 → [cut expected around here] →
N2 → O3 → P1 → Phase 4 verification → report.

Sum of estimates through O2 ≈ 24 working hours, which is more night than exists even
before Phase 4. **Expected not reached: N2, O3, P1**, and likely partial: I1 (one-hand
tools), O2 (worst offenders only), J1 (dirt+debris before window edges). Phase 4 and the
report are RESERVED and happen regardless — they are not on the cut line.

## What I might get wrong (pre-registered)

1. I1's "most of this should be config" may be optimistic — the broom rig may be more
   broom-shaped than its config suggests. The finding gets reported either way.
2. I6's driver failed once already for a reason I have not found yet; if the pile
   seeding is fighting a sim rule (media filter from J2 could change it mid-night!),
   the order I6-before-J2 could cost a re-run. Mitigation: re-run I6's driver after J2
   lands, cheap.
3. M1's "make both common" touches arrival intent distribution — the same numbers A7
   (concurrency scaling) reads. Risk of double-tuning; measure A7's gate after.
4. H2's rollover hook: if day advance happens in more than one place (sim tick vs sleep
   skip), a single hook misses one path. The driver tests BOTH paths if a sleep/skip
   verb exists.
5. L3's book prop sits on the same desk the delivery/checkout choreography uses; a
   collider there could break NPC pathing — the customer-day harness re-runs after L3.

---

# PHASE 2 — adversarial review: objections and answers

Three reviewers ran against this plan (verification / history / scope-and-order). 39
objections total. Every one is answered below — accepted with the change it forces, or
rejected with why. Unanimity was not sought.

## Reviewer 1 — verification (can the stated check actually fail?)

1. **[H2, HIGH] The three positive checks pass with the new triggers entirely absent**,
   because ~15 mutation sites already call autosave(). ACCEPTED — every autosave write
   now records its trigger in `autosave-meta` (`interval` / `rollover` / `quit` /
   `mutation`), and each driver asserts the TRIGGER FIELD inside a mutation-free window.
2. **[I6, HIGH] `pileStaysAhead` measures feet, not bristles** — in the exact marginal
   regime I2 creates, the pile falls behind the bristles on screen while the check stays
   green. ACCEPTED — the invariant is recomputed against the tool contact socket world
   position, and the overrun control re-runs at the margin (pushSpeed just below tool-run
   speed), not only at the gross pushSpeed=1.0 case.
3. **[I5, HIGH] Penetration measured against the same collider query the clamp consumes**
   — a missing counter collider makes the clamp a no-op AND reports 0.00. ACCEPTED — the
   probe gains an independent geometric measurement (raycast against the DRAWN fixture
   meshes, tool excluded), and each screenshot's stated falsifier is "no tool pixels
   beyond the fixture face plane".
4. **[M1, HIGH] A full 1x day is 10.5 wall-hours per leg; the 75-min estimate cannot
   contain it.** ACCEPTED — see the M1 rewrite below (converges with R2#1/#2, R3#1).
5. **[M1, HIGH] A classifier that counts the rolled intent reconciles perfectly while
   zero customers finish both acts.** ACCEPTED — classification is by OBSERVED COMPLETED
   ACTS: a finished ticket AND a booking record joined on customer/party id, never the
   intent flag.
6. **[I1, HIGH] The broom-standard numbers are the rig's own accessors; a tool that never
   draws posts passing numbers.** ACCEPTED — per tool, the driver adds independent drawn
   evidence: pixel-diff of the frame with tool equipped vs unequipped must show
   substantial change in the expected band, and each screenshot carries a stated
   falsifier. The numbers become supporting, the images the judge.
7. **[I7, MED] The verify clause accepts every outcome, and the handle-mesh min/max is
   not the quantity 1.247 records.** ACCEPTED — the extractor computes the same quantity
   (GripPrimary→FloorContact socket distance, from GLB node transforms), verifies against
   1.247 ± 0.002, and a mismatch FAILS the run (that failure would be the finding, and it
   stops the line rather than silently re-pointing the tests).
8. **[H3, MED] A blank flush sticker scans green — judgeBarcodeRead never sees pixels.**
   ACCEPTED — the driver additionally asserts the sticker material carries the barcode
   canvas texture and pixel-diffs the sticker's screen region against the package ground.
9. **[H1, MED] Optional-chained degradation means a panel that never shows still passes a
   zero-pageerror sweep.** ACCEPTED — the sweep asserts the DOM: after `i`, `.cm-panel`
   is visible with rendered children; after the second `i`, hidden.
10. **[I3, MED] "Pixel-identical" cannot be literal in a live scene.** ACCEPTED amended —
    the control is structural: viewmodel screen-bbox at pitch ≤ 0 within tolerance of
    the preserved pre-change values, plus a 12-step pitch ladder for the hover claim.
11. **[J2, MED] Driver-seeded dirt verifies the filter, not that organic spawns carry
    media.** ACCEPTED — a unit test pins every spawnable dirt kind to a medium at the
    spawn path, and the runtime probe samples live spawned dirt for a medium tag.
12. **[K4, MED] The denomination assert reads the spawner's own list.** ACCEPTED —
    asserts move to the SCENE: spawned bill meshes' actual material textures resolved
    against the per-denomination texture cache, plus a close-in screenshot where
    numerals are legible.
13. **[K5, MED] Glass luminance + amount height do not measure dominance.** ACCEPTED —
    the metric is the amount's CONTRAST (digit-pixel vs glass-pixel luminance delta),
    which must not drop while the glass lightens.
14. **[L3, MED] Data asserts stay green while the canvas spread shows stale blank
    pages.** ACCEPTED — verification includes a screenshot of the rendered spread with
    the entry text visible, pixel-diffed against the blank-page spread.
15. **[N1, MED] DOM-level persistence passes without in-game effect.** ACCEPTED — each
    control gets an in-game falsifier: camera.fov read from the live scene, measured yaw
    per synthetic mouse delta, audio gain node values, window bounds via displayInfo.

## Reviewer 2 — history (which recorded mistake does this repeat?)

1. **[M1, HIGH] COMBINED_VISITS.md already priced the full 1x day at 10.5 wall-hours per
   leg and endorsed the 60-minute peak window as the honest substitute.** ACCEPTED — M1
   uses peak-window legs before AND after (like for like), states the substitution and
   cites the doc; a full-day 1x leg LAUNCHES at session end so it harvests by morning,
   and the report says exactly what it is.
2. **[M1, HIGH] The change is written as probability rolls when the record says the split
   is structurally 0%** (browse stops only exist in the no-desk spawn branch;
   releaseReservationCustomer hard-routes to exit; recordCustomerVisit is
   single-purpose). ACCEPTED — M1 is rewritten as the structural change the record
   demands: a browse-stop claim reachable from desk release, the release path routed
   through it, and two-purpose visit recording. Time-boxed as the session it is.
3. **[I2+I6, HIGH] TOOL_RUN_MULTIPLIER at 4.25 yd/s against pushSpeed 3.91 recreates the
   pushSpeed competing-authority defect — false on landing.** ACCEPTED — one authority
   chain: locomotion.js exports TOOL_RUN_SPEED_YD_S, and pushSpeed derives from THAT
   (fastest sustained sweeping speed × margin), so the two cannot drift. I6 verifies at
   tool-run speed.
4. **[I5, MED] "Penetration ≤ 0.05 for all nine" scores no-contact as success** (four
   tools never reached the fixture in the prior audit). ACCEPTED — contactMade is a
   per-tool precondition; a no-contact row FAILS the driver rather than passing it.
5. **[I7, MED] Extracting the wrong quantity and promoting it repeats the maxPitch
   trust failure.** ACCEPTED — same resolution as R1#7 (socket distance, ±0.002 gate,
   mismatch stops the line).
6. **[H2+N4, MED] The prior corrupt-save sweep matched `autosave-meta.json` before
   `autosave.json`; H2 adds more prefix-colliding names.** ACCEPTED — the sweep resolves
   exact filenames from the store's own pathsFor(), and each corruption case asserts the
   loader's reported `source` field to prove the corrupted file is the one read.
7. **[L3, MED] Ten drivers once waited on `app.laptopOpen` set 1350 ms before the screen
   existed.** ACCEPTED — the ledger exposes a content-ready predicate set AFTER the
   first spread paint; every driver waits on that, never on the open flag.
8. **[L2, LOW] Grid-vs-daySheet compares the UI to its own input.** ACCEPTED — the
   expected slot count derives independently from the operating-hours constants.
9. **[I3, LOW] The pre-change recording must be captured and preserved BEFORE the fix.**
   ACCEPTED — banked to a `-before` path first, like H3's before-screenshot.
10. **[I1, LOW] "Hand NDC on screen" already stayed green across a visually broken
    frame.** ACCEPTED — folded into R1#6's resolution (images judge, numbers support).

## Reviewer 3 — scope and order (what silently breaks what?)

1. **[H2 ↔ M1/L3 harness, HIGH] Interval autosave writes land inside wall-clock-gated
   measurements whose baseline never contained them.** ACCEPTED — M1's before leg and
   one customer-day baseline leg run BEFORE H2 lands; the post-H2 re-run then measures
   the write cost itself. Order updated below.
2. **[I3/I4 ↔ I1, HIGH] Broom polish lands in a rig I1 rewrites the same night, and
   I1's guard cannot see a stow or grip regression.** ACCEPTED — I1 moves AHEAD of
   I3/I4; the polish lands once, in the final rig.
3. **[I5 ↔ I1, MED] Same staleness for the clamp evidence.** ACCEPTED — I5 follows I1;
   floor-anchor-probe re-runs as part of I1's verify.
4. **[J2 ↔ dirt-media contracts, HIGH] dirt-media-routing.test.js deepEquals the
   two-media world and dirt-reveal-by-tool.js requires the vacuum to show both media —
   both go red at J2's commit.** ACCEPTED — both rewrites are budgeted INSIDE J2's
   block, before J1 consumes the palette.
5. **[J1 ↔ dirt-visibility instruments, MED] J1 deletes the presentation
   dirt-visibility.js proves.** ACCEPTED — dirt-visibility.js updates inside J1's
   block; J2 reconciles the `tool.dirt`/`medium` double-bookkeeping first.
6. **[L1 ↔ L2, HIGH] L1's evidence is produced through the 3-offer UI L2 deletes two
   items later.** ACCEPTED — L1's sim fix lands first, L2's grid lands second, L1's
   table and screenshots are captured through the FINAL UI; tee-time-offers.js updates
   inside L2's block.
7. **[L4/N5 ↔ O1/O2, HIGH] Verbatim prompt evidence captured before the copy rewrite is
   stale by morning, and clubhouse-restoration-actions.test.js:491 pins an em-dash
   prompt O1 must rewrite.** ACCEPTED — O1/O2 move BEFORE L4's captures and N5's
   stranger pass; every pinned-string test updates in the same commit as its string.
8. **[O1/O2 ↔ earlier drivers + Phase 4, MED] Message-asserting drivers banked earlier
   tonight fail on rewritten strings at Phase 4.** ACCEPTED — an explicit post-O2
   re-run list (lamp-teaches-itself, H2's message control, L1's full-slot control) runs
   before Phase 4.
9. **[M1 ↔ A7 gate, MED] Browse-after-desk adds floor occupancy shop-footfall.js never
   modeled.** ACCEPTED — shop-footfall.js and one customer-day leg run inside M1's
   verify.
10. **[P1 ↔ part-visibility sweep, MED/HIGH] Rebuilding 19 GLBs invalidates recorded
    SHA-256s and whitelist child names.** ACCEPTED — if P1 is attempted, the re-sweep +
    whitelist reconciliation is the mandatory final step inside the all-or-zero block.
    (P1 remains expected-cut.)
11. **[I7 ↔ P1, MED] The broom exists twice; the plan does not name which GLB is
    pinned.** ACCEPTED — I7 pins `assets/pro_shop/firstperson/asset_074_broom_fp.glb`
    by explicit path (the held tool the I-queue polishes); regenerating broomMetrics
    becomes a P1 step if the pinned file is ever in scope.
12. **[H2 ↔ N4, LOW] N4's sweep is written against the old two-generation tree.**
    ACCEPTED — N4 enumerates keys from H2's final generation list.
13. **[H1 ↔ N3, LOW] The pre-fix crash log artifact should be banked before dozens of
    relaunches.** ACCEPTED — N3's log-file check runs FIRST in Phase 3, before H1's fix
    commits.
14. **[H3/K4, LOW] Checked, no collision: nothing pins the tether nodes, and
    register.js already denominates tender via makeChange — K4 is visual-only.**
    NOTED — K4's scope shrinks to visuals driven by the sim's existing denomination
    list; H3 proceeds as planned.

## The revised order Phase 2 forces

N3-bank → H1 → [exclusive window: M1-before peak leg + customer-day baseline leg;
meanwhile node-only authoring: I7 extractor, O1 auditor, H3/H2 code edits unrun] →
H3 verify → H2 land+verify → N4 → M1 structural fix → M1-after peak leg + footfall +
customer-day leg (exclusive) → I2 → I1 → I3 → I4 → I5 → J2 → J1 → I6 → I7 →
K2 → K3 → K5 → K4 → K1 → L1-fix → L2 → L1-verify → L3 → L4 → N1 → O1 → O2 →
post-O2 driver re-runs → L4/N5 verbatim captures → launch M1 full-day 1x leg
(background, harvests by morning) → PHASE 4 verifiers → report.

Unreached expectation unchanged: N2, O3, P1 — plus whatever the clock takes beyond them.
