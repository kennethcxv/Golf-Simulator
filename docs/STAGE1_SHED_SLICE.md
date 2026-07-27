# Stage 1 — Shed Cleaning Slice

Branch `stage1/shed-cleaning-slice` (base `60e1971`). Status: **complete and certified** — 13-group acceptance `OK=true`, shed shell/content probes green, full suite green, plus a four-iteration visual-QA polish pass (`c5e5395`, `9956141`, `65942e9`, `683a8e3`).

## 1. What Stage 1 delivered

**Boot + scene.** `?scene=shed&fresh=1` (or the dev row on the main menu) boots a small real room — an 8.5 x 6.5 shed shell substituted for the clubhouse under the `shed` presentation (`src/render3d/clubhouse/shedShell.js`). The shell returns the full contract `makeClubhouse` consumes (windowDefs, lighting facade, production-visual fallbacks, colliders), so the shed drops into the existing walk/cleaning/lighting wiring with zero downstream change. Legacy clubhouse content is suppressed by a whitelist + `defineProperty` locks + construction allow-gates (`e520b0d`). Save state is scoped to its own keys (`golfempire:shed-autosave`), so shed play never touches a real campaign (`c3ee54f`).

**Sim foundation.** Pure THREE-free sim modules: `src/data/shedLayout.js` (room, openings, furniture, stations, target poses, authored 14-cluster debris seed), `src/sim/shedScene.js` (state recipe + healers), `src/sim/shedCleaning.js` (target schedules + monotonic progress reducer) (`1651e1b`).

**Eleven discrete targets.** Two corner cobwebs (vacuum), bench grease and door scuff (spray-then-scrub/wipe), floor oil patch (sponge), shelf dust (cloth), entry leaf drift (broom-then-bag), trash cans (bag), pizza box (direct [E]), and two windows. Each has a tool schedule with documented refusal reasons (`spray-first`, `sweep-first`, bag gates) enforced by the same dispatch the player drives (`1281899`).

**Windows as tool targets.** Window contact routes through `cleanShedWindow(state, index, amount)` — spray loosens the film to 0.3, cloth lifts the rest — draining the completion-gating film in `reno.windows[]` and mirror-driving the target. The generic schedule path deliberately cannot touch windows, so film and target can never diverge.

**Stations.** Mop bucket ([E] wring, [X] change water) and waste bin ([E] empty pan / tie + dispose bag) close the collect-and-dispose loop; disposal is required for completion.

**Checklist + completion beat.** A five-row HUD checklist (trash, sweep/dispose, vacuum+mop floor %, marks 0/6, windows 0/2) driven by `shedView`; per-target completion toasts + sparkle; "SHED RESTORED" strike-through state and a completion audio/toast beat, fired once (`ec319fb`).

**Persistence.** Mid-clean autosave/reload preserves targets, grime, debris (position-exact), pan/bag lifecycle, mop charge, and completion timestamp; transient wet/solution may dry but never resurrect. Certified by acceptance groups G9 + G12 across reload.

**Acceptance driver.** `tools/qa/shed-cleaning-acceptance.js` — a 13-group certification (boot census, checklist, per-target tool runs through the real dispatch, refusal toasts, stations, persistence x2, completion, teardown) run by `tools/qa/run-playwright.cjs` (`e95b34c`, hardened `8f4cec8`, census made order-insensitive `418d1df`).

**Final visual QA.** The repo's four-iteration protocol (`.agents/skills/browser-game-visual-qa`) ran on a fixed nine-camera set (`tools/qa/shed-visual-qa-capture.js`); each iteration ranked 10+ visible defects and fixed the top batch: seated roof + door header + retired window placeholder chrome; clutter variation + grease/scuff stain decals + leaf shapes; cobweb-rack clip + matte park mats + rooted spray plume; seated cans + matte ceiling + threshold saddle.

## 2. Shared-system gains already live in the clubhouse

These landed in shared FP/presentation systems, not shed files, so the clubhouse scene has them today:

- **Hands and grips** — orientation-true grips, hand quality, a floor-contact solver, and lower-right composition retunes for every held cleaning tool (`8033a56`).
- **Contact-phase gating** — cleaning progress accrues only during contact phases of the stroke, rate-neutral via dt accumulation, with a stroke-reversal (accent) hook (`afef356`, polarity corrected in `4e41861`).
- **Sheet-8 tool asset wave** — mop skirt, vacuum wand, cloth drape, spray label + pose (including deleting a runtime orient hack), broom and bag passes, plus new clips (`c8d1926`); authored shed kit mounts with placeholder retirement (`4428dc9`, `d271d9e`).
- **Audio** — timbre fixes plus `strokeAccent`, `cleanSparkle`, `sprayPulse`, and a completion tail (`d3ba200`).
- **Effects** — spray mist cone (now spawn-staggered so the plume stays rooted to the nozzle), vacuum chunk pops, wipe-streak decal, mop sheen (`db9fed7`, `65942e9`).
- **Targeted-refusal toasts** — schedule-gated refusals (spray-first/sweep-first) surface through the live held-button loop; `targetId` no longer suppresses the hint branch (`f8e5819`).
- **Toast lifetime hygiene** — scene-scoped notifications (clubhouse/course toasts no longer leak into the shed) and dedupe-replace so stacks age out (`ec319fb`).

## 3. Reuse map for the real clubhouse

- **Room-scoped target packs** — `shedCleaning.js`'s pattern (target ids + per-target `{tools, rate, phases, directE}` schedules + a monotonic reducer + a derived view) is the template: author one pack per clubhouse room, keep the reducer and checklist generic.
- **Window tool-cleaning** — replace the legacy [E]-wipe prop with the `cleanShedWindow` route (spray loosens, cloth lifts, film mirror-drives a target). The two-path trap is documented in `shedInterior.js`: renderer contact MUST call the window route, never the generic schedule.
- **Checklist HUD** — `src/ui/shedChecklist.js` + `shedView` is a drop-in shape for room task lists (counts, percent rows, strike-through complete state).
- **Wipe-streak decal** — one reused canvas quad repositioned per surface target (`SHED_WipeStreak`) scales to any wipeable surface set; no per-target allocation.
- **Evidence-driver + rubric method** — fixed camera matrix, scored rubric, ranked-defect iteration (Phase 0's `shed-cleaning-evidence.js`, the final pass's `shed-visual-qa-capture.js`) is the repeatable review instrument for any scene.
- **Acceptance-driver shape** — the 13-group structure (census -> feature groups through real input paths -> persistence x2 -> completion -> teardown, each group `expect`ed with structured failures) is the certification pattern for the clubhouse cleaning loop.

## 4. Known debt and watch items

- **`sheet06-collision-navigation-qa` fails on `main` too** — pre-existing, unrelated to this branch (verified during Task 9). Report-only.
- **G9 census flake — root-caused and fixed** (`418d1df`): the census compare was key-order-sensitive while async kit GLBs mount in fetch order; the ledger's "empty dupes list" signature reproduced twice and is now order-insensitive with the same name+count contract.
- **Window casing / placeholder overlay — closed** in visual-QA iteration 1: the shell's charcoal frame + muntin retire when the walnut casing mounts.
- **Capture-driver [E] pose-fan flake** — one iter-4 run missed the pizza-box focus on a slow frame and honestly reported `ok:false`; re-run green. If it recurs, widen the pose fan or assert-with-retry.
- **`AUTHORED_GRIP_REST` single-constant assumption** — grips share one rest constant; revisit if a future tool authors a different rest.
- **`notify` dedupe-replace is generic** — replaces by message identity across scenes; acceptable now, revisit when more scenes emit high-frequency toasts (completion frame can still hold the last 3 target toasts over the east window).
- **`ROW_TOTALS` duplication** — checklist row totals duplicate sim id-list lengths; tests hold them in sync.
- **Checklist interval handle** — the refresh interval handle is not cleared on teardown (non-accumulating; one interval per boot).
- **Cosmetic watch** — mop-wetness sheen can read as a paint streak on a clean floor mid-dry (drying formulas live in the shared wet system; recommend tuning only with the washer suite green), and siding band continuity across wall corners is imperfect at close range.

## 5. How to run everything

```
node tools/serve.cjs                       # dev server on http://localhost:8457
# boot the slice
http://localhost:8457/?scene=shed&fresh=1  # fresh dirty state (or use the menu dev row)

# certification (13 groups, OK=true expected)
node tools/qa/run-playwright.cjs tools/qa/shed-cleaning-acceptance.js

# probes
node tools/qa/run-playwright.cjs tools/qa/shed-shell-probe.js
node tools/qa/run-playwright.cjs tools/qa/shed-content-probe.js

# tool-presentation evidence matrix (clubhouse boot: 9 tools x idle/work/use + world props)
node tools/qa/run-playwright.cjs tools/qa/shed-cleaning-evidence.js --bootstrap

# shed visual-QA captures (nine fixed cameras, dirty boot -> scripted full clean)
SHED_VQA_ROOT=qa/shed_stage1/visual/latest \
  node tools/qa/run-playwright.cjs tools/qa/shed-visual-qa-capture.js

npm test                                   # full unit suite
```
