# PLAN 16 — written before touching code

Full_Goal_16.md, four phases. This is Phase 1. Every item below carries: the
file-level change, how it is verified in a RUNNING build, the negative control
that would catch the instrument lying, what I expect to be hard, and a rough
time. Phase 2's objections and my answers are appended at the bottom before
implementation starts.

Standing rules bind every item: Electron only (`--clubhouse=pine-hills-v2`), a
green suite is not evidence, visual items need a player-camera screenshot or
they are UNCONFIRMED, every new instrument gets a negative control, measured
numbers only, suite green before each commit, commit incrementally and push.

**Reconnaissance this plan is built on** (all file:line references verified
against HEAD `fe9a85b` today): the mop/broom rig read in full
(`src/render3d/broomViewmodel.js`, `mopStrands.js`, `toolViewmodel.js`,
`fpHands.js`, `src/data/broomFeel.js`, `toolFeel.js`), plus mapped
reconnaissance of the ledger (`src/render3d/clubhouse/ledgerBook.js`), settings
(`src/ui/settingsPanel.js`, `main.cjs`, `src/core/i18n.js`), audio
(`src/core/audio.js`), and characters (`src/render3d/characterAsset.js`).

---

## ORDER OF WORK, and what I expect not to reach

Priority is the goal's own order (A, then B, then C…), with two inversions the
goal itself asks for: A1's baseline measurement runs FIRST (before tonight's
commits pollute HEAD), and B0+B1 run before any B change. B2 (the overlay) is
built immediately after B0's findings — the findings decide what the overlay
must expose, and the overlay then serves B3–B5.

1. A1 baseline measurement (measure only, no fixes yet)
2. B0 divergence investigation + B1 video (no geometry/config changes)
3. A3 speed-ladder removal
4. A1 fixes + A2/C5 ledger performance + C1/C6 control changes (one bundle,
   same files)
5. B2 live tuning overlay
6. B3 bristles/skirt + B4 plant + B5 tune (overlay in hand)
7. C2/C3/C4 ledger appearance
8. D settings (D1 first — it is this machine, quick to verify)
9. E audio
10. F checkout
11. G characters
12. Phase 4 verification + report (reserved last 90 minutes)

**Expected not to reach, in order of likelihood:** F8's full combined-visit
flow rebuild (state-machine surgery, the single biggest item), F3/F4/F5/F6
register presentation set (each small, together large), D2's seven empty
locales at full quality (es/fr completion is safe; the seven from zero are
volume). G is small and I expect to reach it by doing it before F's long tail
if F8 runs over. Anything not reached is reported NOT DONE, not shipped
shallow.

Total honest estimate: ~19–21 h of work against ~8–10 h of night. The list
above is priority order precisely so the cut line lands where the goal says it
should.

---

# A — PERFORMANCE

## A1 — measure the regression, attribute it, fix it

**Facts already established:** the tool rebuilds are `53ea8f9` (broom),
`cab0f09` (mop+trashbag), `704a00a` (other six); the commit immediately before
them is `8baa596`. The ledger's seven live sections landed earlier at
`b602d8e` (parent `65ce987`); the spine light is `readingLight` in
`ledgerBook.js:100-105` — a 0.85 m decay-2 point light that is ON only while
the book is open/opening (`update()` ledgerBook.js:1578-1583), so it cannot
cost anything in ordinary walking. The seven summaries are read on OPEN
(`readModel()` ledgerBook.js:1207), not per frame. So the standing suspects
for "laggier everywhere" are the tool triangle increases (~500 tris total —
small) and whatever else changed; the honest posture is to measure first and
suspect the sim/paint paths, not to assume the named suspects are guilty.

**Change (measurement, no code):** three checkouts measured at the same fixed
poses with the existing profiler (`tools/qa/perf-probe.js`, per the perf
pipeline's fixed-pose protocol):
- HEAD (tonight's start)
- `8baa596` (pre-tool-rebuild, has ledger sections)
- `65ce987` (pre-ledger-sections)

Baseline worktrees per the established recipe (short path, junction
node_modules, second port; control the baseline; beware the silent-404 trap —
a driver that 404s its module measures an empty page and reports a beautiful
frame time).

Poses: the profiler's existing fixed set, PLUS two poses this goal names:
standing at the front desk facing the ledger, and mid-shop facing the
apparel wall. Each pose: mean frame ms, p95, 1% low, over 10 s at 1x NPCs.

**Verify:** the deltas per checkout, ranked, in the report — HEAD vs 8baa596
attributes the tool rebuilds; 8baa596 vs 65ce987 attributes the ledger
sections. Fixes then follow the evidence (if the tool meshes are the cost:
shaft side-count reduction in the builders 20→14 where the part is a pole
under a yard from the lens, rebuild ONLY mop+broom GLBs per B6, re-measure; if
the cost is elsewhere: fix what the profile actually names).

**Negative control:** run the HEAD probe twice back-to-back; the two runs must
agree within noise (< 8% on mean frame time) or the instrument is too noisy to
attribute deltas with, and I say so rather than reporting phantom
attribution. Second control: one pose with the ledger held open vs closed at
HEAD isolates the spine light + open-book cost live.

**Hard part:** worktree baselines with node_modules junctions have bitten
before (silent 404s). Mitigation: each baseline run asserts the app actually
booted to gameplay (walk.x readable) before a single number is recorded.

**Time:** 45–60 min measurement; fixes unknown until measured (budget 60 min).

**INTERIM RESULT (measured during planning, before Phase 2 closed):** all
three checkouts probed with the SAME probe file, same machine, Electron,
pine-hills-v2 — `65ce987` (pre-ledger) → `8baa596` (pre-tools) → HEAD:
- Steady-state averages FLAT, direction mildly favourable: idle 9.59 → 9.36
  → 9.23 ms; interior spin 8.73 → 8.37 → 8.09; all four A/B rows within 2%.
  Neither the tool rebuilds nor the ledger sections moved steady-state at
  the fixed poses. The ranked per-change deltas the goal asks for are
  ≈ 0 ± noise, and will be reported as exactly that with both tables.
- Worst frames are a STALL LOTTERY, not a commit delta: spin-outdoors worst
  1459 (HEAD) / 448 / 33 ms; spin-interior worst 38 (HEAD) / 349 / 676 ms —
  the OLDEST build spikes worst indoors. First-encounter shader compiles
  (programs 245→285 mid-session) and shadow bakes land wherever they land.
- Therefore the felt regression lives where the goal itself points: first
  load (NOT measured by this probe at all), the ledger open, and page turns
  — the transition-stall class. A1's fix hunts stalls: a first-load
  instrument (frame trace boot→first playable frame, shader-prewarm coverage
  vs the 40 mid-session compiles), A2's ledger instrument, and a
  back-to-back HEAD repeat to bound run noise before any further delta is
  believed. If first-load DID regress across these commits, the first-load
  instrument re-runs on the two worktrees to attribute it.
- NOISE BOUND (HEAD vs HEAD, identical code, back-to-back): steady scenarios
  repeat within 1.4% on averages; but spin-outdoors swung 16% on its own
  average (worst frame 1459 → 224 ms) and 1% lows swung 2–4× on every
  scenario. So: averages on clean scenarios are trustworthy to ~2%; any
  claim built on 1%-lows or worst-frames from single runs is NOT, and the
  A1 report will only quote those with the noise bound beside them. The
  cross-commit steady deltas (≤ 4%, favourable direction) are inside noise
  → no steady-state regression is attributable to either suspect change.

## A2 — the ledger's cost specifically

**Facts:** open = `setOpen(true)` → prewarm-or-paint (ledgerBook.js:1480),
0.85 s animation (`OPEN_SECONDS` line 39). The 112.5→70.8 ms fix moved
`readModel()` + first `paintSpread()` into `prewarm()` (1443-1458), keyed
`${dayAbs}:${reviews.length}:${history.length}` (1444-1445), fired from the
prop's `label()` callback (clubhouse.js:10255) when the prompt appears. A page
turn (`turnPage`, 1509-1529) paints FOUR 768×512 canvases in one frame
(leafFront, leafBack via `paintIndexWith`, then left+right via
`paintSpread()`) plus starts the leaf animation.

**Change:**
- Instrument first: wrap each phase (readModel, each canvas paint, each
  texture upload) with performance.now() marks exposed via
  `ledgerBook.diagnostics()`, so the report can say WHICH phase pays.
- Page-turn split: frame 0 needs only the two LEAF canvases (they are what is
  visibly moving); the destination left/right faces are hidden behind the leaf
  until it settles, so `paintSpread()` moves to ~2 frames into the 0.55 s leaf
  animation (or is spread one-canvas-per-frame). Then no single frame paints
  more than two canvases.
- Spread cache: LRU (keyed spread index + content version) of painted
  ImageBitmaps; turning BACK to a visited spread becomes drawImage, ~0 paint.
  Idle pre-paint of the adjacent spreads after each turn completes.
- Open: if prewarm hit, the open frame paints nothing (verify, don't assume —
  the instrument will say). If the key misses mid-day (reviews/history grow),
  the label()-frame prewarm pays the 70 ms during GAMEPLAY instead — chunk
  `readModel()`'s twelve section reads across idle frames (a tiny scheduler in
  prewarm, two sections per frame) so no single frame carries the whole read.

**Verify (running build):** driver `tools/qa/electron-ledger-turn-cost.js` —
walk up (prewarm fires), open, 20 page turns (10 forward, 10 back), close,
reopen. Per-event worst frame ms from the harness's own rAF delta (the number
the player feels), plus the phase breakdown from diagnostics. Acceptance: open
< 16 ms worst frame, every turn < 16 ms worst frame, at 1x, on this machine,
at the default window size. If unreachable, the report says exactly which
phase refuses (e.g. "the two leaf uploads alone are 11 ms at 4K DPR") with
the measured split.

**Negative control:** the same driver with the cache and split disabled via a
QA flag must show the CURRENT cost (> 16 ms) — proving the instrument can see
the thing it claims was removed. Prewarm-key check: a scripted sale between
walk-ups must change the key and re-fire the work exactly once (observed via
the phase instrument), no more, no fewer.

**Hard part:** canvas paint may not be the cost — 768×512 sRGB uploads on a 4K
DPR renderer might be. The phase instrument decides before any fix is written.

**Time:** 90 min including the driver.

## A3 — remove the game speed-up entirely

**Facts (mapped):** the ladder is `speeds: [0, 1, 2, 4]` (balance.js:109) —
index 0 is PAUSE and is load-bearing (editor, pause menu, prewarm, modals,
~200 QA drivers freeze with it). The deletion target is rungs 2/4 only →
`[0, 1]`. The SIM-TIME-001 split does NOT collapse to nothing: `decision` is
4 even at 1x because the whole day is compressed (4/30 game-min/s against the
1/30 NPC authoring baseline; tests/sim-time-locomotion.test.js:69-70 requires
decision > 1 at the default rung "or the short day empties the shop"). At
1x-only, the LOCOMOTION half goes dead (mult is always 1: caps at
clubhouse.js:10584, balance.js:188-194 never bind); the decision half is
day-compression, not speed-up, and stays. The register/patience clocks are
already wall-time (patience drains raw dt, clubhouse.js:10977) — register
feel is untouched by the deletion. `state.golfDay.speedRung` PERSISTS into
saves (state.js:589-610) and prices golfer pace on load (golfDay.js:536) — a
save written at 2x/4x needs a load-time clamp to 1. Binding ids
`speedNormal`/`speedFast` (keyBindings.js:48-50) orphan player rebinds when
removed.

**Change:**
- balance.js: `speeds: [0, 1]`; delete `simSpeedMultipliers`' rung variation —
  locomotion is the constant 1; decision becomes a named DAY_COMPRESSION
  constant so nothing reads as a speed feature; golfer `speedRung` pricing
  reads 1.
- main.js: HUD `setSpeed` cycles pause↔play only; keys: Space keeps
  pause-toggle, '1' keeps pause/resume parity if kept at all, delete
  `speedNormal`/`speedFast` bindings (with a preferences normalize that drops
  orphaned rebinds); the per-frame `speedRung` write pins 1; the
  `pausePrevSpeed` save/restore machinery survives (it restores to 1).
- hud.js: glyphs `['⏸','▶']`; title copy updated; the chip toggles
  pause/play.
- Save healer: deserialize clamps `golfDay.speedRung` to 1.
- Tests that pin the ladder are REWRITTEN as part of the item (they pin the
  old contract, which is being deleted): sim-time-locomotion.test.js
  (becomes: locomotion is 1 at the only rung; decision equals the
  day-compression constant), golfer-pace.test.js (cap cases at rung 16 go),
  accessibility-settings.test.js:45-49 (pause restore — survives),
  scene-initialization-performance.test.js:31 (survives).
- QA drivers that pressed '2'/'3' to REACH states (golf-gameplay-normal.cjs —
  15 call sites, the heaviest; simplified-front-desk-lifecycle-acceptance.mjs;
  pro-shop-routes.mjs; delivery-eta.js; maintenance-production.js;
  scenario-performance-master.js) are re-pointed at a QA-only clock seeder
  (set `state.clock.minutes` / lead-time fields directly — reaching a state
  by teleporting the clock is not the same feature as animating NPCs at 4x,
  and it is QA-only, not shipped). Drivers whose PURPOSE was the ladder
  (proshop-speed-curve.js, proshop-walk-speed.js rung legs, perf-probe's
  'spin-speed16-live' pose, proshop-baseline-performance 'live-speed16')
  are retired with a note in each file and in the report.

**Verify:** boot, screenshot the HUD (pause/play chip only, no ▶▶); press the
old '2'/'3' keys → nothing (and rebind UI no longer offers them); the
day-length number the goal asks for, MEASURED live: run the clock through a
full trading window and report game-minutes-to-real-minutes (expected ≈
105 real minutes for the 6:00→20:00 window, 180 for the calendar day — the
measured number goes in the report, not the arithmetic); NPC walk speed
sampled over 10 s unchanged from 1x baseline.

**Negative control:** BEFORE deletion, the same day-length instrument at the
old 4x reads ~¼ the minutes (the instrument measures sim speed); a legacy
save fixture carrying `speedRung: 4` loads clamped to 1 (probe reads 1, and
golfer route pricing matches a fresh save's).

**Hard part:** the QA clock seeder has to reach the SAME states the '3' key
did (supplier lead times, reservation arrivals, hourly maintenance ticks) —
each converted driver re-runs green before the commit, or is named in the
report as retired-with-reason.

**Time:** 2 h (grew from 90 min: six reach-drivers + four measure-drivers +
four pinned tests is the real bill).

---

# B — MOP AND BROOM (nothing else in the tool set)

## B0 — the divergence is the finding (FIRST, before any change)

**What reconnaissance already found tonight, to be CONFIRMED in pixels before
any conclusion is written:**

1. **The mop's visible skirt is a welded mesh by construction, and my strands
   are drawn alongside it.** `toolViewmodel.js:371-383` adds the procedural
   strand rig to `MESH_MopCollar` and NEVER hides `MESH_MopSkirt`. And the
   rebuilt mop's skirt is not even a cone any more:
   `tools/blender/build_assets_71_80.py:485` JOINS individually modelled
   strands into the single static `MESH_MopSkirt`. So the player looks at an
   authored bundle of strands that CANNOT move, with my 14 thin (0.0072 yd)
   moving strands somewhere among it. "The strands do not move at all" and
   "tips travel 0.2546 yd" would both be true — of different meshes. My trail
   driver even used the skirt as its rigidity control — the control WAS the
   mesh the player sees.
2. **The broom hand has a two-writers seam and a legacy path.** `fpHands`
   applies grip poses every frame (applyGrips, fpHands.js:417-452, fed by
   `syncGrips` at courseScene.js:6955), then the rig — when active — seats the
   hands on the solved shaft afterwards (seat(), broomViewmodel.js:985-1007,
   called from the rig update at courseScene.js:8504). While the rig is
   active, the rig wins. But courseScene.js:8679-8694 keeps a LEGACY pose path
   that runs whenever the rig is NOT active — and every driver of mine
   activates the rig explicitly, while a real session might not
   (save-restore, belt-queue, a missed `setActive`). If the user's session
   ever runs the legacy path, they see detached hands while my instruments,
   in my session, measure a perfect grip.
3. My grip sweep held `using=true` and drove PITCH; the user walks and TURNS
   under pointer lock with `using` mostly false. Any divergence excited by
   yaw/walk with using=false is invisible to the sweep by construction.
4. **The mop has a second writer the broom is exempt from — found in source
   after this plan's first draft.** The legacy stroke block
   (courseScene.js:8679-8686) writes `group.position.x = rest.x +
   sin(phase)·span` and `group.rotation.z = restZ + cos·0.035` on every
   USING frame, guarded by `!(walkTool === 'broom' && broomVm.isActive())`
   — broom exempt, MOP NOT. The mop's rig solves its pose at :8504; this
   block then clobbers the drawn x (in the old held-root local frame) and
   the roll, AFTER the rig, every mopping frame. The rig's diagnostics
   report the solved pose; the player watches the clobbered one. This is
   the goal's candidate 1 — "a rig that updates and is then overwritten
   measures perfectly and draws nothing" — in the exact shape it predicted.
   The real-input driver therefore also logs, per frame, |drawn group
   transform − rig-solved transform| as a two-writers detector (control:
   the broom, which is exempted, must read ~0 on the same metric).

**Change (instruments only, no geometry/config):**

- `tools/qa/electron-strand-visibility.js` — equip the mop at the default
  camera, real player-camera screenshot; then flat-paint (pixel-probe recipe:
  NoToneMapping, post off) the procedural strands pure green and
  MESH_MopSkirt pure red; count both colours. Then the same during a sweep
  and during a carry-walk, three frames each. This answers, in the player's
  own pixels: how much of the visible skirt is the welded mesh vs the moving
  strands.
  - *Controls:* hide the strand rig → green count must be 0; hide the skirt →
    red count must be 0. Run both. A tone-mapped frame (deliberately skip the
    flat-shot mode) must FAIL the pure-colour match — proving the flat mode is
    load-bearing, the fault class the hand-pixel probe already survived.
- `tools/qa/electron-real-input-divergence.js` — REAL input: keys via
  Electron `webContents.sendInputEvent` (keyDown/keyUp W, A, D), mouse via
  sendInputEvent mouseMove while pointer-locked (acquired by a real click),
  NO walk API state forcing, default pitch. Sequence per tool (broom, mop):
  equip via the real belt key, walk 3 s, turn 90°, sweep 2 s (real mouse
  button). Per frame, log: rig `isActive()`, `geomSource`, palm-to-shaft
  distance (right hand world pos vs the live socket axis), hand NDC, fpHands
  root visibility, and which pose path ran (one-line instrumentation counter
  on the legacy path at courseScene.js:8679). Record the webm (VIDEO_DIR).
  - *Controls:* with the rig forced inactive for one run, palm-to-shaft must
    BLOW UP (proves the metric can fail); with hands hidden, the hand-pixel
    count must read 0 (existing proven instrument).
- Build parity: the held tools load from
  `vendor/models/assets_51_100/firstperson/asset_0XX_*_fp.glb` (registry `fp.glb`
  paths, cleaningTools.js) with no pack step between the file and the loader.
  Hash those files against fresh `tools/blender` exports; delete
  `node_modules/.vite` (the only cache in the serving path) and re-hash.
  Noted going in: the `.blend` SOURCES for these exact tools sit modified and
  uncommitted in the working tree right now — source-vs-artifact drift is a
  live possibility, not a hypothetical. *Control:* a deliberately truncated
  copy must hash differently (trivial but stated, per the rules).

**Verify:** the B0 section of the report names which candidate(s) it was,
with the pixel counts, the per-frame divergence log, the path counter, and
the hash table as evidence. If none of them reproduce the user's picture,
that is written plainly as the finding.

**Hard part:** real pointer lock inside the QA harness (Electron's
sendInputEvent + pointer lock has been flaky in this project's history — the
D-key failure lived exactly here). If pointer lock refuses to engage under
synthetic events, I fall back to real-window `robotjs`-style OS input — and
if that is also unavailable, the report says the real-input axis is
UNCONFIRMED rather than pretending.

**Time:** 90 min.

## B1 — reproduce the experience, on video, and say what I see

**Change:** none — the real-input driver above already records the webm at
the default camera with no API forcing. Watch both clips (broom, mop) frame
by frame. Write in the report, in words, what the clips show — before knowing
what the fix will be.

**Verify:** the clips exist at qa/electron/real-input/*.webm, are watched,
and the report contains the description. If it looks wrong to me too, the
report says so in the first line of section B.

**Negative control:** n/a (this item IS the human-eye check; its control is
the instruments beside it).

**Time:** 20 min (shared with B0's driver run).

## B2 — the live tuning overlay (the most-wanted deliverable)

**Design, concrete:**

- **Mutable feel:** courseScene builds each rig's feel from
  `structuredClone(TOOL_VM_FEEL[id])` (clones drop the deep-freeze) held in a
  `liveFeel` registry. The rig already reads almost every value per frame
  (verified in source: compose/sweep/stroke/weight/pitch/surface/walk/idle
  read live through `feel.*` and `cc`); the exceptions are constructor-
  captured (vmCamera fov/near/far, elbow offset Vector3s, HEAD_LAG constants,
  hand scale, arm geometry dimensions) — the rig gains `refreshFromFeel()`
  that re-reads exactly those (updateProjectionMatrix, re-copy vectors,
  re-derive HEAD_LAG, re-call setHandScale, rebuild the two arm meshes when
  their dimensions moved).
- **Strand params:** `mopStrands.js` gains a `params` object (count, radius,
  length, segment chase base/falloff, push gain, drag gain, slack spread,
  splay, carry chase) read LIVE in update(); count/length/radius changes
  rebuild the 14-mesh rig in place (cheap). B3's bristle rig uses the same
  contract.
- **Panel:** `src/ui/toolTuner.js`, DOM, toggled by F9, dev-gated
  (`devSessionActive()` OR `?tooltuner=1`). Tabs: Broom | Mop. Groups exactly
  as the goal lists them: hand anchor x/y/z; grip roll upper/lower; hand
  scale; elbow offsets + forearm length + depth scaling; strand/bristle
  stiffness, lag, splay, slack; sweep arc, stroke rate, hand follow radius,
  wrist roll; weight lag Hz, damping, settle; carry hover and the plant blend
  window (carryAbove/workBelow). Each slider: live numeric readout, drag →
  `liveFeel` leaf write (+ refreshFromFeel for the captured set) — the held
  tool updates the same frame, no reload, no re-equip.
- **Diagnostics strip in the same panel, 10 Hz:** headAboveFloor, hand NDC
  upper/lower, palm-to-shaft (added to rig diagnostics), seatError,
  geomSource, strand tip travel over the last 60 frames — the user's eyes and
  my instruments on one screen at last.
- **Save button:** writes the FULL current values for both tools to
  `src/data/toolFeelOverrides.json` via IPC (`fw:save-tool-feel` in main.cjs,
  fs.writeFileSync, pretty-printed). `toolFeel.js` imports and deep-merges
  the JSON before freezing, so what was tuned is what ships on next boot —
  and the file is hand-editable (B5's "so I can move them myself").
- **Input while tuning:** opening the panel releases pointer lock but does
  NOT pause the sim and does NOT unequip (a `tuningMode` flag suppresses the
  pause-on-unlock path); holding RMB over the game canvas re-locks for a
  look-around, releasing returns to the sliders. The tool must stay drawn and
  animating with the panel open or "live as I drag" is a lie.

**Verify (running build):** driver `tools/qa/electron-tool-tuner.js`: open
panel, drag gripAnchor.y +0.2 via real slider events → rig diagnostics
`gripCamWorldY` moves +0.2 (±0.01) within 2 frames, screenshot before/after
shows the hands visibly higher; drag strand slack to max → tip-travel
readout grows; press Save → JSON exists and contains the dragged values;
relaunch → diagnostics reflect the saved values (ships test). Player-camera
screenshots of the panel over the held broom and mop.

**Negative control:** one deliberately unwired "dead" slider in QA mode must
move NOTHING (diagnostics bit-identical over 60 frames) — the panel cannot
placebo. And with the panel closed, 120 frames of diagnostics must be
bit-identical to a build without the panel (the tuner costs nothing when
shut).

**Hard part:** the pause-on-pointer-unlock suppression (that path guards real
gameplay; the flag must be impossible to leave on outside dev), and arm
geometry rebuild without leaking (dispose old geometries).

**Time:** 2 h.

## B3 — the broom gets real bristles; the mop's visible skirt becomes the moving one

**Change:**
- Generalize `mopStrands.js` → strand/bristle rig with `layout: 'ring'|'bar'`
  and the params object from B2. Mop: hide `MESH_MopSkirt` (keep collar),
  raise the procedural rig to BE the skirt — ~26 strands, thicker (radius up
  ~2x), two rings + centre fill, length matched to the authored silhouette so
  the mop reads the same at rest and actually moves. Broom: hide
  `MESH_BroomBristles` (the builder joins its modelled tufts into one static
  mesh at build_assets_71_80.py:514 — same welded construction as the mop
  skirt; `BroomBristleSeat`, the bedding strip, stays), build a bar-layout
  bristle rig — ~9 columns × 2 rows of short stiff tufts along the head's
  local X, 2 segments each, stiff chase, low slack, splay-on-plant, fast
  settle (push-broom character per the goal: shorter travel, faster settle,
  less slack).
- Both driven from the rig update exactly as today (strokeX, lagV, workBlend,
  headLag.angle).

**Verify (running build, player camera):** the REAL-PIXEL motion instrument:
`tools/qa/electron-bristle-motion.js` captures consecutive real screenshots
during a sweep and during a carry-turn; per-pixel diff inside the head's
screen box must exceed a floor while the stroke reverses (the bristles
visibly move in the player's own pixels), and settle to near-zero diff within
the settle window at stop. Screenshots + the B1-style webm re-recorded after
the change, watched, described.

**Negative control:** the same diff with the strand/bristle update frozen (QA
hook) must read near zero while the camera holds still — proving the diff
measures bristle motion, not compression noise or HUD flicker. And the
hidden-skirt assertion runs the OTHER way: the authored skirt/block painted
flat must count 0 px after hiding (it is genuinely gone from the frame).

**Hard part:** matching the authored silhouette closely enough that the mop
does not read as a different object at rest; the bar-layout splay reading as
bristle bend rather than fur.

**Time:** 2 h.

## B4 — the head plants only when the handle can reach

**Change (broomViewmodel.js, the solve):** the plant is currently a floor
snap from EITHER side: `drop = gripY - (floor + hover)` clamps into
±gripLen and the head lands at floor+hover even when the hands are below the
floor (the sweep's absurd 2-yd-below control planted at 0.073 yd — that
number is in broomFeel.js's own comment). Fix: compute
`reachDeficit = drop - gripLen * 0.985`; the plant is legal only when
`0 <= drop <= gripLen * 0.985` (hands above the contact, handle long enough).
When illegal, the head hangs on the shaft sphere below/along the hands (the
pure carry solve) and `workBlendEff` eases to 0 over the deficit margin so
there is no pop at the boundary; the `planted` flag returned to the sim
follows `workBlendEff`, so cleaning cannot land while the head is visibly
unplanted.

**Verify:** re-run the gripAnchor sweep (the existing
electron-hand-framing-sweep) — the absurd candidates must now NOT plant
(headAboveFloor grows with the deficit) while every legal candidate still
plants at 0.073–0.084; and a shaft-integrity assertion at every sample:
|hand-to-contact-socket distance − gripLen| < 0.01 yd — the two ends of the
shaft belong to the same object at every pose, which is the defect's actual
sentence. Player-camera screenshots at level look, working pitch, and full
up-look.

**Negative control:** the old build's sweep numbers ARE the before (already
in report 15); the new sweep must differ exactly where reach fails and
nowhere else (bit-close elsewhere: |Δ headAboveFloor| < 0.005 on legal
candidates — the fix must not move the working range).

**Hard part:** the boundary ease — a hard gate pops the head at the exact
pitch where reach runs out; the smoothstep window has to be tuned on the
overlay.

**Time:** 60 min.

## B5 — perfect the grip, and report the values

**Change:** with B0's answer, B3's moving bristles, B4's honest plant and
B2's overlay: tune both tools by eye on live video loops (walk, turn, sweep),
save via the overlay, and list every changed value with before → after in the
report so the user can move them.

**Verify:** the B1 driver re-recorded at the tuned values; clips watched;
report describes what the final state looks like. Screenshots at level,
working, and carry poses for both tools.

**Negative control:** the overlay's saved JSON diffed against the shipped
defaults — every reported value change appears in the diff and nothing
unreported does.

**Time:** 60 min.

## B6 — the other seven tools stay untouched

`toolFeelOverrides.json` carries only broom+mop keys tonight; the suite's
existing tool declaration tests keep the other seven pinned. Any incidental
improvement found for them is written in the report's "not asked" list, not
shipped.

---

# C — THE LEDGER

## C1 — shorten the open, never take control

**Facts:** `enterLedger()` (main.js:494-543) exits pointer lock, clears walk
input, hides the walk overlay; the book flies to a face pose over 0.85 s
(OPEN_SECONDS, ledgerBook.js:39); the face pose is solved once per open
(computeFacePose, 1396-1433). That is "control taken away": the lock drop +
nothing responding while the book flies.

**Change:** keep pointer lock and mouse look ALIVE through open and while
reading — do not exitPointerLock, do not clear camera input; OPEN_SECONDS
0.85 → 0.4 with the same swap beat fraction; the face pose re-solves against
the live camera every update frame while open (cheap math, already written)
so the book rides the view like the register's card reader instead of being
pinned to where the camera was; W/S keep walking (the book follows the face;
`syncStationToolStow` already stows the held tool while open). Escape or E
closes as today; walking does not force-close.

**Verify:** driver: open the book, apply real mouse deltas DURING the opening
animation → view yaw changes on those exact frames (control never left);
pointer lock state polled true throughout; W during open moves walk.x while
the book's screen NDC stays pinned to the face. Player-camera screenshots
mid-open. Stopwatch: prompt-press → readable page < 0.55 s.

**Negative control:** the REGISTER must still park movement in the same
instrumented run (proves the "walk.x moved" probe can detect parking when it
exists); and with the book closed the same mouse deltas move the view
identically (baseline for the "look stayed live" comparison).

**Hard part:** the book following a walking, turning camera without swimming
(needs a small eased follow, not a rigid parent — the reader's parkScale
pattern is the precedent).

**Time:** 60 min (bundled with C6 below — same handler).

## C2 — the pages look like paper

**Change (ledgerBook.js painters):** a shared page-background painter: warm
paper tint with per-page deterministic fibre noise (hash-seeded, no
Math.random), faint edge darkening toward the spine, aged outer-edge
vignette; ruling lines thinner and lower-contrast; ink switches to
near-black warm brown with headers heavier (Georgia stays), letter-spacing on
headers, consistent margins from one MARGINS constant instead of per-painter
literals.

**Verify:** player-camera screenshots of every section spread before/after at
the reading pose (the driver walks all sections via goToSection).

**Negative control:** the paint-rect recorder from C3 runs on the new
painters — prettier pages that now overlap or truncate are a regression the
recorder must catch, not a surprise.

**Time:** 60 min.

## C3 — words must not overlap, as a class

**Facts:** the ledger's only guard is `fitLine` (chop+ellipsis, records
nothing); the truncation RECORDER lives in the front desk
(`MONITOR_TRUNCATIONS`, frontDeskMonitorUi.js:107) with its fit test
(`tests/front-desk-monitor-fits.test.js`) built on an overestimating
measuring stub.

**Change:** a draw-rect recorder inside ledgerBook's painters: every text
draw goes through a helper that records {page, id, rect} into
`LEDGER_DRAWS[]`; after each page paint, rect-intersection scan appends any
hit to `LEDGER_OVERLAPS[]` (and keeps recording truncations as the front desk
does). New test `tests/ledger-page-fits.test.js` paints all twelve sections
at FULL content (fixtures with maximal strings) and at EMPTY, through the
front desk's proven measuring-stub pattern, asserting zero overlaps and zero
authored-copy truncations. Then fix what it finds (the goal says several
exist).

**Verify:** the test, plus player-camera screenshots of the worst offender
pages before/after.

**Negative control:** the test first paints a page with a deliberately
overlapping pair and asserts the recorder SEES it (the front desk test's own
control pattern, kept).

**Hard part:** building honest full-content fixtures for twelve section
models (names, histories, longest realistic strings).

**Time:** 75 min.

## C4 — the section locks align

**Facts:** locks draw only on the Contents rows (paintContents,
ledgerBook.js:644-652): body strokeRect at x = PAGE_W−118 width 20, shackle
arc r 7.5 centred on the body's TOP edge, while unlocked rows right-align
their page number at PAGE_W−92 — two different right edges, and the shackle
rides the body edge rather than sitting on it. ("Firsts" is usually the
locked one — clubRoster.js:297 — so it shows the worst.)

**Change:** one right-hand column: the lock glyph and the page numbers share
a right edge and a per-row vertical centre; the shackle arc sits ON the body
top with the body centred on the text baseline; stroke width scaled with
TYPE_SCALE.

**Verify:** screenshot of the Contents page before/after; recorder assertion:
every locked row's glyph rect right edge equals the number column's right
edge ±1 px and vertical centre within 1 px of the row's text centre.

**Negative control:** the assertion run against the OLD painter must FAIL
(it is measuring the misalignment the eye sees, not something that was
already true).

**Time:** 30 min.

## C5 — page turns under 16 ms

Covered by A2's split+cache; the acceptance number and driver live there.
This item is the C-side pointer to it in the report.

## C6 — A and D must not walk the character while the book is open

**Facts:** the ledger's capture-phase keydown (main.js:517-533) handles
literal 'a'/'d' with preventDefault but no stopPropagation, and the ledger
never parks walk input, so `walkKeyDown` (courseScene.js:7778, bubble) still
records the keys and `heldAction('moveLeft')` strafes the player per frame
(courseScene.js:8199). The register's precedent consumes every key while
active (main.js:2302-2306).

**Change:** while `app.ledgerOpen`: the handler reads the LIVE
moveLeft/moveRight bindings (not literals) for page turns, calls
stopPropagation + preventDefault on the keys it handles, and walk-side those
two actions are suppressed (the station predicate that already stows tools
gains "movement keys bound to page turns are not movement while the book is
open"). W/S deliberately stay live per C1. On close, any held state clears
(no stuck strafe).

**Verify:** driver: open book, hold real D for 1 s → spread advances once per
press pattern, walk.x delta < 1e-3; release, close, hold D → player strafes
(same instrument, both signs). Rebind moveRight to L in settings and repeat —
L turns pages while D (now unbound) does nothing, proving the live-bindings
read.

**Negative control:** the walk.x instrument must show movement with the book
CLOSED (it can see what it claims to exclude), per the C1 control.

**Time:** in C1's bundle.

---

# D — SETTINGS

## D1 — the resolution list reads the monitor, not the DIP work area

**Facts (found in source):** `main.cjs:190` marks a candidate `fits` by
comparing physical-pixel presets against `display.workAreaSize` — Electron
DIP units minus the taskbar. On this 4K monitor at Windows scaling, the work
area is ~2560×1392 DIP, so 2560×1440 and 3840×2160 read "larger than this
display", which is the reported bug verbatim. The same wrong comparison
blocks apply (main.cjs:208-211).

**Change (main.cjs):** report physical pixels: `physical = size ×
scaleFactor` (rounded); `fits = w <= physical.width && h <=
physical.height`. Apply path: convert the chosen physical size to DIP for
`setContentSize` (÷ scaleFactor); a selection that equals/exceeds the work
area applies as borderless-native instead of a clipped window. The renderer
row copy ("This display has room for X × Y") switches to the physical size,
with the work-area note kept for windowed mode.

**Verify (this machine IS the 4K monitor):** driver reads `fw:display-info`
and screenshots the display page: 2560×1440 and 3840×2160 enabled, "room
for 3840×2160" text; report quotes the raw IPC payload (size, scaleFactor,
workArea) — the goal explicitly asks what the display reports vs what the
list shows.

**Negative control:** a QA-only env override (`FW_FAKE_DISPLAY=1600x900@1`)
flows through the same handler and must mark 1080p+ as not fitting — the
comparison direction still works; the fix did not just hardcode `fits:true`.

**Time:** 45 min.

## D2 — the ten languages, honestly

**Facts:** one table file (`src/core/i18n.js`), EN = 115 keys; es/fr = 87
each (the same 28 recent keys missing); zh-Hans, ru, pt-BR, de, ja, ko, tr =
0 keys (fall through to English); there are NO "UNREVIEWED" markers anywhere
— that premise of the goal text doesn't exist in this codebase; the report
will say so.

**Change:** complete es/fr (+28 each) and author the full 115 for the seven
empty locales — real translations of short settings/UI copy written with
per-key context (each key's English meaning + where it renders), placeholder
`{tokens}` preserved. The report gives coverage() per language and states
plainly that these are model-authored translations pending native review —
that is the honest coverage statement, not a marker in the code.

**Verify:** `coverage()` read live for all ten (must be 115/115); the
existing `settings-language.js` driver extended to screenshot the settings
pages in ALL ten locales (it already proves on-screen rendering with an
English negative control) — CJK/Cyrillic actually rendering in the DOM is
the visual check.

**Negative control:** the driver's existing control — English must NOT
change when another locale is edited — plus a missing-key canary: delete one
key from one locale in a scratch copy and the coverage instrument must count
114, proving it counts keys, not files.

**Hard part:** volume (⅞ × 115 strings × 7 locales ≈ 833 strings) done to
real quality — the honest cut line is es/fr first, then zh-Hans/de/pt-BR/ru,
then ja/ko/tr; whatever is not finished stays English and is REPORTED as
English rather than filled with junk.

**Time:** 2 h if all ten; the cut line protects quality.

## D3 — rebinding updates the formatted controls display

**Facts:** the pause menu's "Controls" page (main.js:1788-1820) renders
hardcoded keycap literals and never reads
`preferences.values.controls.bindings`.

**Change:** rebuild that page from `BINDABLE_ACTIONS` + live bindings via
`describeKey`/`keyForAction`, grouped exactly as the current layout
(`.ctl-cols` CSS kept), re-rendered on the preferences-changed event; keys
with no binding show "unbound".

**Verify:** driver: rebind moveLeft to Q in Settings→Controls, open the
Controls display page → the Walk row shows Q (DOM assert + screenshot),
immediately, no reload; reset bindings → shows A again.

**Negative control:** an action left at default must show the default cap in
the same run (the display reads the table, it did not just print the one key
the driver changed).

**Time:** 40 min.

## D4 — the scrollbar belongs to the scrolling section

**Facts:** nothing inside the settings panel scrolls; the outer hosts own the
bar (`.pause-content` overflow-y:auto styles.css:1873; `.modal.wide`
overflow-y:auto styles.css:1075), so the bar frames the entire panel while
only the page body visually moves under the sticky tabs.

**Change:** `.settings-page` becomes the scroll owner (flex column shell;
tabs fixed; page overflow-y:auto with min-height:0); the two hosts stop
scrolling while settings is mounted (scoped `:has(.settings-shell)` rules —
Chromium-only app, `:has` is safe here); the menu modal keeps its Done row
visible below the scrolling page.

**Verify:** screenshots of the Controls tab (longest) in both mounts — the
bar visibly inside the page area, tabs and footer pinned; programmatic:
scrolling the page changes `.settings-page.scrollTop` while the host's stays 0.

**Negative control:** a deliberately short page (Audio) must show NO bar at
all (the change scoped scrolling, it did not paint a cosmetic bar).

**Time:** 45 min.

## D5 — spacing, the class not the instance

**Change:** `.settings-footer` gains real bottom padding; then a DOM audit
pass in the driver: for every settings page in both mounts, report any
control whose bounding rect sits within 4 px of the container edge or of the
previous row; fix each hit (padding/margin in styles.css).

**Verify:** the audit reports zero hits after; before/after screenshots of
EVERY settings page (the goal asks for all of them), both mounts.

**Negative control:** the audit run against the OLD css must report the
reset-button flush case the goal names (the instrument sees the known
instance before it is trusted on the sweep).

**Time:** 45 min.

---

# E — AUDIO

**Facts:** `src/core/audio.js` is a complete procedural WebAudio engine with
the exact requested idiom (layered transient/body/tail one-shots,
`varied()` pitch spread) and a rich existing cue inventory; drawer, coins,
card reader, doors, boxes, tool contact and scanner are ALREADY wired. The
real gaps: most DOM buttons are silent (menus, pause, HUD, editor, panels,
half the laptop), and five physical families are missing or generic —
footsteps, cashier enter/leave, sign flip, ledger's own cues (generic
uiTick/paper today), and keypad typing.

## E1 — a click on every button

**Change:** three hooks cover the game:
1. `ui.js` `el()` (line 9) — every DOM `onClick` on a `button` fires a
   pointerdown click cue through one shared `uiClick()` (routed via the ui
   bus, respecting volumes/mute), plus a document-level delegated
   pointerdown fallback for buttons built outside `el()` (menu.js builds
   raw buttons). Laptop clicks stay owned by the laptop's own `click()`
   (gated by its uiSounds pref) — the delegated hook skips `.laptop` to
   avoid doubles.
2. Laptop: audit the 81 button sites — `primaryBtn` and the remaining
   handlers route through `click()`.
3. Register's 3D raycast buttons: the three hit sites already tick; audit
   for the misses.

**Verify:** driver clicks a representative button on every surface (main
menu, pause nav, settings, laptop×3 pages, register glass, HUD chip, course
editor, build panel, empire/club/inspect panels) with a QA counter wrapped
around the ui-bus cue; each click increments exactly once. Report the
per-surface table.

**Negative control:** pointerdown on dead space and on a disabled button
increments nothing; and with the delegated hook removed (QA flag), menu.js
buttons go silent again — the counter measures the hook, not some other
path.

**Time:** 60 min.

## E2 — the physical world sounds

**Change (each in the house layered style, pitch-varied):**
- **Footsteps:** a step event derived from the existing stride clock
  (`bobPhase`, courseScene.js:6997 — footfalls at the bob minima) gated by
  real displacement (courseScene.js:8227); surface from
  `clubhouseApi.groundYAt` (boards) vs turf zones (grass) — two voices
  (boards knock+creak tail, turf soft thud+swish), walk/run intensity from
  speed. New `footstep(surface, intensity)` synth.
- **Cashier station:** enter/leave cues at simplifiedRegisterMode
  enter()/leave() — cloth+counter-knock in, step-back out.
- **Sign flip:** replace the generic uiTick at clubhouse.js:8915 with a
  two-layer card flap + swing tail.
- **Ledger:** dedicated cover open thump, close clap, and a real page-flip
  swish tied to the leaf animation (replacing uiTick at main.js page-turn
  sites; the book's internal `paper` cues stay).
- **Register keypad typing:** short key click on the POS tap path distinct
  from uiTick.
- Already complete and NOT rebuilt (verified in the map): drawer, coins/
  notes, card reader beeps, doors, boxes, tool contact, scanner, bag. The
  report lists these as pre-existing, not tonight's work.

**Verify:** a cue-dispatch counter table per event driven by a scripted
session (walk boards→grass, enter/leave station, flip sign, open ledger,
turn 3 pages, type on keypad); each fires the NEW cue name ≥1. Plus the
B1-style listen: I play the session live and describe what is audible in
the report (dispatch is not sound; the listen note says the synths actually
speak).

**Negative control:** an unknown cue name through the same dispatch logs a
loud QA-mode warning instead of vanishing (the silent-swallow at
main.js:862 is exactly how a dead sound ships green — the warning makes the
instrument fail visibly); standing still fires zero footsteps over 5 s
(displacement gate holds).

**Hard part:** footstep feel (rate vs stride, volume floor so it does not
grate); keeping every new cue inside the gesture-armed context rules.

**Time:** 2 h.

---

# F — CHECKOUT

## F1 — Q + register goes straight to the cashier

**Facts (mapped):** E is the interact key; inside `walkInteract()`
(courseScene.js:7640-7670) there is NO branch for focus kind `'tool'`, and
three mechanisms steal or kill the register prop's focus while a cleaning
tool is out: the vacuum/washer labelHook hijack (courseScene.js:7493-7524)
replaces focus with kind `'tool'` before the prop scan runs; the
`facing > 0.3` test (7571) rejects the prop while the player looks down
mopping; and the cleaning-readout fallback (7582-7589) yields a dead
`'hose'` focus with a null cell — E does nothing. The MAP appears via a
fourth route: when `walkActive()` is false the interact key falls through to
`enterEditor()` (main.js:2610-2616). Q itself never consumes E (it only
records `qPressedAt`, main.js:2527-2545), and the dirt overlay is already
zeroed while the register is open (courseScene.js:8578-8581).

**Change:** station props (register/front desk) take focus PRIORITY over
equipped-tool focus inside their radius — the labelHook hijack and readout
fallback yield to a station prop in reach; the facing gate for station props
relaxes to the prop's own wider cone; the interact→editor fallthrough never
fires while a station prop is in reach. `syncStationToolStow`
(courseScene.js:7309-7325) already stows the tool on entry; Q's overlay
returns on exit via the existing stationOpen gate.

**Verify:** driver with REAL held Q (sendInputEvent keyDown, no keyUp), mop
equipped, walk to the register at a mopping pitch, press E → cashier UI on
the next frame's screenshot, no Q overlay, no editor; leave → dirt overlay
returns while Q still held.

**Negative control:** Q held AWAY from the register still shows the dirt
reveal (the fix scoped to station reach, Q lives); and E in open floor with
the mop out still does nothing (the dead-focus fix did not make E fire
randomly).

**Time:** 45 min.

## F2 — the tee-time screen's overlapping text, then every screen

**Facts (mapped):** the overlap is arithmetic, found in source: the check-in
note draws at baseline y=502 (`frontDeskMonitorUi.js:530-535`) while the slot
action grid starts its first button row at y=500
(`drawActionGrid(actions, 482, 500, …)` at :540, grid geometry :347-367) —
the note sits INSIDE the first button. The two bottom boxes are the home-tab
cards at :379-403; the empty-state comment (:483-495) records the grid
running flush to the panel's bottom edge. The monitor already has the
truncation recorder (`MONITOR_TRUNCATIONS`, :98-132) and its fit test.

**Change:** re-layout `drawReservationDetail` — the note gets its own band
above the grid (grid y moves down; panel bottom gains padding); extend the
recorder to log draw RECTS and overlaps (C3's pattern) on this monitor; then
the SWEEP: run the ledger recorder (C3), the monitor recorder, and a DOM
computed-rect overlap audit (laptop pages, HUD, menus, settings) across
their surfaces; fix every hit.

**Verify:** tee-time screen screenshot before/after with a walk-in ask live;
the sweep's overlap table in the report (screen + the two strings per hit),
re-run clean after fixes.

**Negative control:** each recorder class first catches a planted overlap
(canvas and DOM both) before its clean sweep is believed.

**Time:** 90 min.

## F3 — items go INTO the bag

**Facts (mapped):** two motion paths both shrink: the click-to-ring slide
(`updateScanMotion`, simplifiedRegisterMode.js:5606-5673 — shrink at
:5629-5633, t>0.62 → ×0.48, packed at 0.38 scale :5652) and the drag-drop
(`updateBagDropMotions` :6329-6349, shrink :6337, packed :6345). The bag
mouth is a computed point (:1375-1379) over `REGISTER.bag`
(shopLayout.js:1065); the bag is drawn side-lying at
`CHECKOUT_BAG_PRESENTATION` scale 1.35 (:284-331).

**Change:** scale stays 1.0 on both paths; the item arcs to the mouth and
descends INSIDE along the bag's local axis, occluded by the bag's own
geometry — the bag gets an interior occluder (depth-writing, colour-masked
inner shell at the mouth) so the item disappears because the bag is around
it; removed only once fully below the mouth line. Packed-item minis inside
the bag (the 0.38 stack) are replaced by the real items resting at reduced
VISIBILITY, not reduced scale — or simply removed once hidden (the mouth
occluder decides what is honest to keep).

**Verify:** 6-frame grab during both paths; projected bbox height of the
item must track perspective only (no scale collapse at fixed distance);
final frames show the item partially then fully occluded by the bag lip.
Player-camera clip watched and described.

**Negative control:** the old build's frames show the shrink under the same
instrument (bbox collapsing at constant distance) — the before IS the
control.

**Time:** 75 min.

## F4 — cash with coins, matching, in realistic denominations

**Facts (mapped) — most of this may already exist in the sim, so the item
OPENS WITH AN AUDIT, not a rebuild:** `customerCash(tx)`
(sim/register.js:567-577) already rounds the due UP to the next clean step
(50/20/10/5 by size) with a 35% chance of adding the odd cents — $35.31 due
→ $40 tendered → `makeChange(40)` = two twenties. Coin denominations exist
(`COINS` :33), coin meshes exist (cash_coin_* GLBs, simplifiedRegisterMode
~:4020-4110), and `presentedTenderLayout`
(checkoutPaymentPresentation.js:57-88) lays notes in a fan with coins at the
edge. There is an exact-amount fallback when the till cannot make change
(:5318-5321). If the player sees $29.96-style exactness, either the fallback
fires often (drawer float too poor), the presentation shows something other
than the tender, or the pile is simply occluded (F5).

**Change:** audit first — 20 scripted cash sales at mixed totals, logging
due, tendered pieces, displayed meshes, and fallback hits. Fix the measured
gap only: likely candidates are the fallback frequency (seed a healthier
drawer float), the 35% odd-cents branch presenting pennies-exact (tighten to
notes + LARGE coins only — nobody counts out 96¢), and mesh visibility.
The invariant the goal states becomes a test: displayed tender == tx.tendered
sum, and tendered is round (multiple of 5) unless the odd-coins branch chose
notes+quarters.

**Verify:** driver reads the desk meshes per sale (note/coin counts sum to
the tender), screenshots show coins on the desk from the cashier pose;
$35.31 shows $40 on the desk in the clip.

**Negative control:** a round $20.00 total presents exactly one $20 note (no
invented coins); and the audit's logger first reproduces the CURRENT
complaint on the unmodified build (whatever it turns out to be) before the
fix is believed.

**Time:** 60 min (audit 20 + fix 40).

## F5 — customer and cash move right of the bag

**Facts (mapped):** queue head at local (−0.48, −1.05) (shopLayout.js:960-962)
facing the register datum at (−1.2, 0) — NEAR THE BAG (bag at local −1.16,
:1065; bagging rect −1.22…−0.82, :1122); cash pile anchor x clamped
−0.70…−0.15 (simplifiedRegisterMode.js:4660-4665), authored tender rect at
(−0.55, −0.22) (:1119). A prior ruling (shopLayout.js:966-980) says the
stand is "already right of the bag, cannot go further" — so the winning move
is likely the BAG moving LEFT along the counter plus the cash clamp moving
right, not the customer moving.

**Change:** measured from the cashier's default pose first (pixel probe on
customer face + tender pile). Then: bag anchor left along the counter
(within the counter's authored span), cash pile clamp right
(−0.55 → ≈ −0.35), customer facing target moved off the bag datum so they
address the cashier, and the stand point right only if the :966-980
constraint proves soft. Re-measure.

**Verify:** player-camera screenshot from the cashier position mid-sale with
a bagged item and presented cash: customer face pixels > 0 and tender pixels
> 0 (flat-paint pixel check from the F3/F4 instruments), before/after.

**Negative control:** the old layout's probe shows the occlusion (before IS
the control); and the bag must still be reachable for bagging (the F3
driver re-runs green after the move — the fix must not break the verb it
sits beside).

**Time:** 40 min.

## F6 — cash laid down, card held out

**Facts (mapped):** `PayCash` and `PayCard` are ONE identical static
held-out reach (characterAsset.js:625-639); the per-frame flow→pose map
(clubhouse.js:10981-10990) pins every payment state to `'Present'`, so even
though the tender pieces already fly to the desk (`presentTender`,
simplifiedRegisterMode.js:4745-4780), the arm never comes back. The card is
already held up and pickable until taken (:5256-5311, ready point
:2394-2397).

**Change:** split the poses: `PayCash` becomes a two-beat gesture — reach to
the desk while the tender lands, then the flow state advances to a new
`CashPresented→AwaitingChange` pose (arm withdrawn, hands at rest) once
`presentTender` completes; the flow→pose map at clubhouse.js:10981-10990
routes cash states to the withdrawn pose and card states to the held-out
one. Card path unchanged (it is already correct per the goal).

**Verify:** two scripted payments filmed; frame checks: cash — the hand
world position diverges from the tender pile after landing (retreat
measured), pile meshes stay; card — hand+card hold position until the take.
Player-camera screenshots of both moments.

**Negative control:** the old build's frames show the identical held-out arm
in both cases under the same instrument (the difference is measured, not
asserted).

**Time:** 50 min.

## F7 — concurrency scaled by standing

**Facts (mapped):** the formula exists —
`drive = reputation×0.55 + cleanliness×0.20 + rating×0.25`, × price factor
clamped 0.55–1.35 (shopFootfall.js:94-99);
`target = clamp(round(capacity × drive), 1, capacity)` (:173-182); capacity
is the TIER cap: starter **2**, standard 4, premium 6, luxury 8
(shopProgression.js:19-43); spawn gate at clubhouse.js:10666-10668.

**Change:** raise the ceilings so the formula shows: starter 2 → 5,
standard 4 → 8, premium 6 → 10, luxury 8 → 12 (drive 0.55–1.35 then spans
≈3–7 customers at starter instead of pinning at 2); queue/browse slot counts
checked against the new peaks (3 line slots + overflow exist,
shopLayout.js:372-387 — overflow behaviour observed at peak).

**Verify:** three seeded standings (well-run cheap / mid / neglected
expensive), 10 sim-minutes each at 1x; log peak + mean simultaneous
customers; the three pairs land in the report as the goal asks.

**Negative control:** the neglected-expensive seed shows LOWER concurrency
than the well-run-cheap seed under the SAME cap — the formula, not the cap,
is what the numbers now show; and the drive breakdown probe
(shopFootfall.js:136-169) confirms which term moved each seed.

**Time:** 45 min.

## F8 — nobody leaves with unpaid goods

**Facts (mapped) — the escape is a branch-ordering bug, and the combined
payment genuinely does not exist:**
- At the counter stop, `openWalkInCustomer(c)` (clubhouse.js:10130-10136)
  wins at :10931 BEFORE the cart branch at :10950 can run, and it checks
  only `customerType === 'walk-in-tee'` — never `c.cart` or
  `deskErrandPending`. A combined visitor (45% of walk-in-tee spawns,
  `COMBINED_VISIT_CHANCE` :8689) is classified as tee-time desk business;
  the put-items-on-desk path (:10963-10970) is unreachable for them.
- Both desk outcomes then release them with the goods: booked →
  `bookWalkIn` :10362 → green-fee-only tx → `releaseReservationCustomer`
  :10177 jumps them to the exit; rejected → `rejectWalkIn` :10396 → exit.
  The goods silently restock on the way out (`surrenderCart` :9934,
  lostSales++).
- Items and green fee are TWO transactions everywhere today: retail
  (`register.begin`) vs the `service:green-fee` check-in tx
  (reservationCheckIn.js:59-102, no sales tax, own revenue key). "One
  payment" is a new build, not a re-order.

**Change, in the goal's own step order:**
1. Counter branch order: a customer with `c.cart.length` places items FIRST
   (the existing :10963-10970 path) regardless of walk-in type —
   `openWalkInCustomer` additionally requires an empty cart.
2. After the scan completes, a customer with `deskErrandPending` does NOT
   advance to payment: the monitor raises the tee-time ask (the existing
   walk-in panel), booking appends a `service:green-fee` LINE to the OPEN
   retail transaction (taxed per its own rule — the line carries the
   check-in tx's no-sales-tax flag and its `greenFees` revenue key so the
   books stay honest), and ONE tender covers both.
3. `bookWalkIn` while a retail tx is open appends instead of opening
   `beginReservationPayment`; rejection with items on the desk proceeds to
   items-only payment.
4. The invariant, enforced and instrumented: holding unpaid items ⇒ no exit
   transition exists except through `completeCustomer`; a QA-mode assert
   logs loudly if any exit path sees a non-empty unpaid cart.

**Verify:** the goal's repro FIRST, unmodified build, on camera: seed a
combined visitor, watch them collect, ask, and leave unpaid (the driver
asserts the escape actually happens — the bug reproduces here before the
fix is believed to fix anything). Then the fixed build: the same seed
places items, scans, asks, books, pays ONCE (register total = items + fee;
ledger/revenue split assert: retail to sales, fee to greenFees), exits with
zero unpaid items. Watched end to end, clip in the report.

**Negative control:** a browse-only customer still leaves freely; a
tee-time-only walk-in still transacts fee-only through the OLD single-tx
path; and the QA invariant assert fires on the UNFIXED build's repro
(proving the assert can see the escape it guards against).

**Hard part:** the single-payment merge touches the register's transaction
model (revenue split, tax split, receiptless finalize fork at
simplifiedRegisterMode.js:6516-6528). Biggest item of the night; first
candidate for NOT-REACHED if A or B overruns, and the report will say
exactly where it stopped.

**Time:** 2.5–3 h.

---

# G — CHARACTERS

## G1 — the torso reads as one piece in motion

**Facts (from source):** four vertical laws meet at the waist every frame —
torso/shirt bobs 1.0× (characterAsset.js:718), pelvis 0.7× (:719), belt +
buckle never move (fixed y at :103/:111), hips never bob (:705). At stride
the shirt hem slides ±2 cm against a static belt at 2.8 Hz. The waist is the
one joint with NO connective piece (yoke above, hipCap below, nothing at
pelvis↔belt↔hem).

**Change:** one vertical law for the trunk: belt+buckle parent to (or bob
identically with) the pelvis, pelvis bob factor = the chest's, so shirt,
stomach and belt move together; the residual seam moves to pelvis↔hip where
hipCap already covers it; hem overlap margin re-checked at both bob extremes.

**Verify:** four customers mid-stride screenshotted before/after at the bob
extremes (drive `char.update` to sin(2w) = ±1 deterministically on a staged
scene); plus a transform assertion across a full stride: max |hem-bottom −
belt-top| gap < the overlap margin at every phase step.

**Negative control:** the gap assertion on the OLD rig must FAIL at the
extremes (the instrument sees the defect it claims to close), and the
static-pose screenshot must be pixel-close before/after (the fix touched
motion, not the standing look).

**Time:** 45 min.

## G2 — brows and moustaches sit on the face

**Facts:** there IS no moustache mesh — the floating dark slab in profile is
the MOUTH box at z 0.158 (~25 mm proud of the 0.155-radius skull at its
height); the brows at z 0.158 float ~6 mm. Eyes and nose are correctly
embedded (rear faces inside the skull).

**Change:** seat both on the skull surface: z = sqrt(0.155² − (y−0.06)²) +
half-depth − ε at each feature's height (brow ends tilted to hug the curve),
proud by ≤ 2 mm like the eyes/nose; mouth thinned slightly so it reads as
lips against skin, not a slab.

**Verify:** profile screenshots at conversational distance, before/after,
same character seed; geometric assert in-scene: rear-face-to-skull-surface
distance ≤ 2 mm for brow and mouth.

**Negative control:** the same assert on the eyes must ALREADY pass on the
old build (the instrument agrees with the two features everyone can see are
seated), and the old brow/mouth readings must reproduce ~6 mm / ~25 mm.

**Time:** 30 min.

---

# Reporting

`Designs/ProShop/OVERNIGHT_REPORT_16.md`: per item — what changed, how
verified, screenshot/clip path, twenty-minute-stranger bar yes/no; then
UNCONFIRMED / NOT DONE / unasked fixes; Phase 4's verification results as
their own section, and any verifier-disproven claim at the TOP. Last 90
minutes reserved: suite green, shelve half-done work off the tree, commit,
push, write.

---

# PHASE 2 — ADVERSARIAL REVIEW: objections and answers

Three reviewers ran against this plan: R1 VERIFICATION (42 objections), R2
HISTORY (17), R3 DIVERGENCE (38). Their full outputs are preserved in the
session transcript; every objection is answered below. Where many objections
converge on one fault in the plan, the remedy is written ONCE as R-A…R-M and
the per-objection lines point at it. **These remedies supersede the per-item
verification text above wherever they conflict.** Proceeding without
requiring agreement, per the brief.

The one-sentence summary of what the reviews caught: the plan rebuilt the
six-round failure with nicer prose — scene-graph metrics grading scene-graph
fixes, dispatch counters grading sound, a paused-sim profiler grading a live
complaint, and every screenshot taken at 62% of the owner's resolution. The
remedies move the acceptance evidence into the player's own pixels, input
path, resolution, and live sim.

## Consolidated remedies

**R-A. OWNER-RESOLUTION ACCEPTANCE.** Verified: every driver inherits a
1600×940 DIP window (main.cjs:76-78) with the shipped DPR cap 1.5
(courseScene.js:690) while the owner plays this machine's 4K display. A new
qa-boot helper sizes the window to the primary display's full bounds
(borderless, native size, real scaleFactor) and returns a caption string;
ALL acceptance-grade screenshots, clips, perf numbers and legibility
verdicts run through it and carry "window × DPR" in filename or caption.
Iteration evidence may stay small; acceptance evidence may not. The shipped
DPR cap stays in force — the acceptance environment reproduces the shipped
pipeline at the owner's window, it does not invent a new one.

**R-B. PIXELS BESIDE EVERY SCENE-GRAPH METRIC IN B.** (1) B0's first number
becomes the reproduction: 60 consecutive default-pipeline frames during a
real-input sweep on the UNMODIFIED build, per-pixel diff over the skirt
region — if ~0, the owner's "strands do not move" is reproduced in owner
pixels, one number. (2) The real-input log samples hand/socket world
matrices in onAfterRender (after ALL writers), not at rig-update time, and
one frame in N is flat-painted (hand green / shaft red — fault-44 recipe
with the tone-mapped failing control) to log the PIXEL gap between blobs.
(3) B3's primary metric stays the proven collar/head-local tip travel; the
pixel diff runs its frozen-rig control DURING an identical scripted sweep
(head-motion baseline), acceptance = unfrozen ≥ 1.5× frozen baseline in the
strand-band mask, settle below the frozen baseline's noise floor within 12
frames. (4) B4 asserts geomSource === 'live' on every sample (null =
sample FAILS), and adds a real-input full-up-look leg: flat-painted head
blob's screen row must rise ≥ 40 px AND a held sweep at full up-look must
clear ZERO dirt (dirt overlay pixels unchanged). (5) The which-camera
question is logged per frame: `toolDrawCamera` (courseScene.js:11964) falls
back to the main camera when a rig is inactive — the divergence log records
which camera drew the tool every frame.

**R-C. REAL INPUT IS LOAD-BEARING, PROVEN FIRST, THREE SESSION SHAPES.** The
spike driver (tools/qa/electron-realinput-spike.js, written) runs before any
B instrument: lock, look, walk, equip, work-hold, with the unlocked-deltas
negative control. If pointer lock fails under the harness, OS-level input
(Win32 SendInput via PowerShell) becomes the plan of record IMMEDIATELY, not
a maybe. The B0 divergence driver then runs three session shapes — fresh
boot, restored save with the tool on the belt, and belt-queue swap — because
the legacy-path candidates (save-restore, missed setActive) only exist in
session histories a fresh boot never enters. C1/C6 inherit the same input
machinery and must detect-and-report a lock-never-acquired run rather than
score it.

**R-D. LIVE-SIM + FIRST-LOAD PERF, CONTENT-ASSERTED.** Verified: the stock
probe pauses the sim for every fixed pose (perf-probe.js:100) — report 14
fault #15's exact shape. The probe gains live variants: each pose sampled
with the game clock ASSERTED advancing and at least one NPC position
advancing during the window; the report states live/paused per pose, and
"laggier everywhere" claims may only cite live poses. A first-load
instrument measures launch→first-gameplay-frame, worst rAF delta and count
of ≥33 ms frames in the first 10 s, per checkout. Every pose records
renderer.info triangles (must sit in an expected band per checkout) plus a
screenshot with a non-background-fraction floor — an empty or wrong scene
disqualifies the run instead of averaging into it. Attribution language:
deltas name SPANS (65ce987..8baa596 is 15 commits, 8baa596..HEAD is 8);
any above-noise delta is bisected before a cause is named.

**R-E. A2/C5 ACCEPTANCE REDEFINED.** "Worst frame < 16 ms" is unsatisfiable
under vsync (every rAF delta ≈ 16.7 ms) — the metric becomes: under vsync at
owner resolution (R-A), no rAF delta in the open/turn/walk-up windows may
exceed 33 ms (2× the vsync median = a visibly dropped frame), graded over 20
turns + 3 opens + 3 walk-ups; the disable-flag control must show ≥ 33 ms
deltas in the same mode. Content correctness joins speed: after the turn
sequence, a cache-bypass repaint must pixel-match the cached presentation
within tolerance, and a mid-sequence scripted sale must visibly change the
totals region of the affected spread (pixel-diff > 0 there). The walk-up
prewarm window is graded by the same 33 ms bound as the open. A2 re-runs
after D1 lands so the number is banked at the owner's true display config;
both configs' numbers go in the report.

**R-F. OVERLAY: PER-SLIDER LIVENESS, EXERCISE MODE, ONE FEEL AUTHORITY,
PIXEL ROW, SHIPS-IN-PIXELS.** (1) The tuner driver drives EVERY slider
min→max through real input events and asserts a named response per slider
(diagnostic delta or pixel delta, expected direction stated) — the E7
all-controls table shape; any slider with no measurable response is FAILED
by name in the report. The one deliberately-dead slider stays as the
placebo control. (2) An "exercise" toggle replays a canned walk/turn/sweep
through the real input handlers while the panel is open, so stroke/weight
values are tuned against the motion they govern — without it, "live as I
drag" is true only of the idle pose. (3) Split-brain audit: every reader of
TOOL_VM_FEEL/BROOM_FEEL is enumerated (courseScene reads BROOM_FEEL.dirt
directly at :8516, and the sim gate reads feel values) and routed through
the live registry; one behavioural assert per group (drag workBelow → the
planted flag's onset pitch moves in the same run). (4) The diagnostics
strip gains two rows computed from the RENDERED frame: which camera drew
the tool this frame, and a 10 Hz pixel-diff of the tool's screen region.
(5) The panel-cost control is rewritten to be satisfiable: fixed-seed
fixed-dt stepped scene, closed-panel frame-time mean within 0.2 ms of
no-panel mean over 1000 frames (bit-identical floats across builds was an
impossible control and would have been quietly reinterpreted at 2 a.m.).
(6) The ships test compares SCREENSHOTS (same pose, default pipeline,
stated pixel tolerance) between the tuned session and a relaunch — not
diagnostics. (7) B5's exit condition is the full B0+B3 instrument set
re-run green at the tuned values, numbers beside the before values.

**R-G. AUDIO: RMS AND TIMING, NOT DISPATCH.** The master-bus AnalyserNode
instrument that already exists in-repo is the depth check: per surface, one
representative REAL pointerdown click must produce master-bus RMS above a
stated floor within 50 ms, with context.state === 'running' logged at click
time (a suspended context is a finding, not a pass). The dispatch counter
becomes the BREADTH check only: buttons enumerated programmatically per
surface (querySelectorAll + registered 3D hit sites), all driven, wired/total
reported, below-100% listed by id. Footsteps: per step event, position→zone
logged beside the cue name, 100% agreement required; step count over a
measured walk within ±20% of bobPhase minima; footstep-to-footfall timing
offset reported. Ledger flip cue asserted within 50 ms of leaf-animation
start. E2's per-cue evidence is an AnalyserNode RMS/duration capture per new
cue family; the listen note stays as colour, not as evidence. The
unknown-cue QA warning ships with E1, not just E2.

**R-H. F-SECTION: PIXEL FLOORS AND VARIANT COVERAGE.** F3: flat-painted
item's pixel count must decrease monotonically to 0 across the mouth
crossing WHILE its scene-space bbox height stays constant (the pixel
signature of occlusion, not scale), 60 fps capture from the real cashier
pose watched, plus a 4-pose orbit confirming the occluder masks only bag
interior. F4: per-denomination pixel floors from the cashier pose
(flat-paint calibration); the goal's own case as a fixture ($27.40 → a
twenty and a ten, no sub-quarter coin meshes AND no sub-quarter coin
pixels); if the audit cannot reproduce the complaint, the item reports a
finding, not a fix. F5: fraction floors — ≥ 60% of the customer head-blob's
bag-hidden baseline visible with the bag shown, tender ≥ a stated px count
— evaluated as the MINIMUM over the whole payment sequence sampled every
5th frame; `checkout-space.test.js` and the reach assert gate any bag move,
with the new margin quoted the way C5's revert quoted it. F6: retreat floor
≥ 0.25 yd toward the body AND arm-region pixel-diff between beats above a
stated threshold; card-hold position variance < 0.01 yd over the wait; both
clips watched-and-described. F7: floors, not just a table — well-run-cheap
starter peak ≥ 4 (the old cap was 2), neglected-expensive peak lower by ≥
1, observed vs shopFootfallTarget within 1 at each sampled minute, sampled
AFTER a stated ramp-up window; screenshot at each logged peak from the
player's standing position, visible bodies counted against the number. F8:
three verified runs — seeded booking, seeded CHECK-IN (the goal's second
variant), and ORGANIC (fixed RNG seed that provably rolls a combined visit)
— each ending in the zero-unpaid-exit assert; the invariant assert is a
hard driver FAIL when it fires (not a log line) and stays armed during
F7's concurrency runs; the register total is asserted from the register
UI's rendered text region, not the tx object; the logged
register-acceptance-cash SECOND-PICK TIMEOUT (report 13, never closed) is
named as a prerequisite with its own diagnosis budget inside F8's estimate.
F1: four approach cases, one per documented entry route (labelHook hijack
state, extreme down-pitch, dead hose-focus state, walkActive-false→editor),
each asserting cashier-UI pixels present AND Q-overlay pixels absent. F2:
exclusion rules for the DOM rect audit are stated BEFORE it runs
(ancestor/descendant exempt, same-stacking-context text nodes only), the
sweep runs at max-content fixtures, and every text-drawing surface is
enumerated in the report with its covering recorder — any surface without
one (register glass, canvas-on-mesh) is listed UNCONFIRMED rather than
silently skipped.

**R-I. SEEDS, SAVES, AND REBUILD HYGIENE.** All Electron seeding goes
through the native save path (the localStorage seed is a logged no-op in
Electron — HARNESS_DEBT §6.2) with a read-back control before any number is
sampled: the live runtime's seeded fields must equal the seed. A3
additionally copies THE OWNER'S OWN autosave from userData into the run and
verifies the speedRung clamp and golfer pacing on that file, not only on a
fixture. A3's converted reach-drivers must each name the invariant that
still travels through the live sim after the seed (seed the clock → real
frames at 1x → the sim's own scheduler fires) and demonstrate they CAN fail
on a broken build. Any GLB rebuild in A1's fix path names --no-compress,
regenerates the hash gates + broomMetrics if touched, and re-runs B0's
parity table after. B0's parity check first proves the exporter is
deterministic (export twice, hashes match) or falls back to canonical
geometry digests — otherwise uncommitted .blend sources guarantee a
spurious drift finding.

**R-J. C-SECTION TIGHTENED.** C1: the look-alive check becomes pixel-based
(consecutive frames during open must differ in the world region consistent
with the applied real deltas) with the A2 hitch bound active during the
open window; "readable" = page-area text pixels above a stated count; the
swim hard-part gets its check — over 3 s of walk+turn with the book open,
per-frame book-NDC delta stays under a stated bound, VALIDATED by
deliberately halving the follow stiffness and watching the check fail. C6:
displacement asserted as √(Δx²+Δz²) < ε at two camera yaws 90° apart; the
key-held-BEFORE-open ordering case and release-while-open case join the
driver; press semantics stated (N discrete presses → N turns; a 1 s hold →
exactly 1). C3: a live-Electron leg paints all twelve sections at
full-content fixtures with the recorder armed on REAL canvas metrics and
asserts LEDGER_OVERLAPS empty there; the stub test remains the fast CI
guard. C4: acceptance adds a screenshot-side check — lock glyph pixels
located by colour, right-edge column vs number column ±1 px on the rendered
frame. C2: an effect assertion (background-region pixel variance above a
floor + mean tint in the stated paper range, sampled with the cache
bypassed) plus the texel:pixel ratio at the reading pose stated in the
report; all twelve spreads screenshotted at owner resolution, not two.

**R-K. G-SECTION ON THE LIVE FLOOR.** G1: verification adds a live
pine-hills-v2 capture — four organically walking customers, 60 fps, watched
— with the hem/belt gap sampled per frame on a REAL walker (the staged
sin-extreme scene remains as the deterministic control); a waist-band
pixel-diff (motion energy at the seam) quantifies before/after; the
static-pose diff threshold is stated now (< 1% of frame pixels). G2: the
≤ 2 mm assert measures against the skull MESH by inward raycast, not the
analytic sphere (instrument must not share the fix's model); it loops ALL
seeds/variants; the profile screenshot is taken from the player's counter
position, three seeds, with a pixel check: no background-coloured column
between the brow/mouth blob and the head silhouette.

**R-L. SCOPE AND ORDER HONESTY.** G moves UP the order, before E and F
(both prior nights cut at roughly the first third; G is small, player-facing
and now planned against found mechanisms). D2 is retitled in plan and
report: "the settings surface in ten languages" with the honest denominator
stated — ~115 t()-routed keys out of ~1,500+ player-facing strings; every
locale remains English outside that surface (the goal itself scopes D2 this
way; the report must not let 115/115 read as "the game is translated").
B3's first step is a named sweep for tests/drivers/hash-gates pinning
skirt/bristle visibility, re-baselined deliberately inside the estimate
(13F paid this bill five times mid-commit). B6 gains teeth: a fixed-pose
screenshot of each of the seven untouched tools at night start and night
end, pixel-diff under a stated threshold, one line each in the report.

**R-M. REMAINING INSTRUMENT FIXES.** D1: the driver APPLIES 3840×2160 and
one windowed size and asserts content-bounds × scaleFactor equals the chosen
physical size with a framebuffer-dimension check (the list was fixed in
pixels; the apply is what the player touches); FW_FAKE_DISPLAY injects at
the screen-API boundary so the control exercises the shipped comparison.
D3: the rebind is driven through the real capture UI (click the keycap,
send the real key), and the claim drops "immediately" for the honest
"reflects live bindings whenever shown, no app reload" — asserted by
opening the page post-rebind in the same session. D4: with the longest page
mounted, the HOST must satisfy scrollHeight ≤ clientHeight in both mounts
(no host bar can exist at all) + a mid-scroll screenshot while wheel events
are active (overlay scrollbars are invisible idle). D5: the proximity audit
includes text-node rects and both mounts' chrome, and runs at default +
owner-native sizes (narrow if time permits). D2: a tofu check per
CJK/Cyrillic locale (rendered width differs from an equal-length
box-glyph string) — coverage counts keys, screenshots prove DOM, neither
sees missing glyphs. B1: the description must cite frame numbers, and the
B0 pixel metrics run on the RECORDED video frames so the video argues with
the describer; recording uses the in-page 60 fps canvas captureStream
recorder at owner resolution (Playwright's compositor webm is
frame-dropping and silent), capture fps stated beside every watched claim.

## Per-objection dispositions

**Reviewer 1 (VERIFICATION):** 1 ACCEPTED → R-B(2,5). 2 ACCEPTED → R-C.
3 ACCEPTED → R-B(3). 4 ACCEPTED → R-F(1). 5 ACCEPTED (rewritten control) →
R-F(5). 6 ACCEPTED → R-E, R-A. 7 ACCEPTED → R-E. 8 ACCEPTED → R-B(4).
9 ACCEPTED → R-D. 10 ACCEPTED → R-D. 11 ACCEPTED → R-G (incl. real
pointerdown mechanism). 12 ACCEPTED → R-G breadth enumeration. 13 ACCEPTED
→ R-G. 14 ACCEPTED → R-G. 15 ACCEPTED → R-H(F3). 16 ACCEPTED → R-H(F5).
17 ACCEPTED → R-H(F4). 18 ACCEPTED → R-H(F6). 19 ACCEPTED → R-J(C1).
20 ACCEPTED → R-J(C1 swim check). 21 ACCEPTED → R-J(C6). 22 ACCEPTED →
R-H(F7). 23 ACCEPTED → R-H(F8 three runs). 24 ACCEPTED → R-H(F1).
25 ACCEPTED → R-H(F2). 26 ACCEPTED → R-M(D1). 27 ACCEPTED → R-J(C3).
28 ACCEPTED → R-J(C4). 29 ACCEPTED — A3 verify gains the sim-minute-rate
instrument across the keypress, the static remaining-readers sweep in the
report, and a prefs fixture for orphaned rebinds. 30 ACCEPTED → R-E
(walk-up window graded). 31 ACCEPTED → R-M(B1). 32 ACCEPTED → R-F(7).
33 ACCEPTED → R-L(B6 screenshots). 34 ACCEPTED → R-I (determinism check).
35 ACCEPTED → R-M(D2 tofu). 36 ACCEPTED → R-M(D3 honest claim).
37 ACCEPTED → R-M(D4). 38 ACCEPTED → R-M(D5). 39 ACCEPTED → R-J(C2 effect
assertion). 40 ACCEPTED → R-K(G1). 41 ACCEPTED → R-K(G2 mesh raycast).
42 ACCEPTED → R-H(F8 invariant = hard FAIL).

**Reviewer 2 (HISTORY):** 1 ACCEPTED → R-D (and yes: it is instrument code,
the "no code" line was wrong). 2 ACCEPTED → R-B(3) — collar-local stays
primary, pixel diff demoted to visibility evidence with the sweep-time
frozen control. 3 ACCEPTED → R-L(D2 denominator). 4 ACCEPTED → R-D (spans,
bisect before naming). 5 ACCEPTED → R-E + R-A (acceptance at owner config,
re-run after D1). 6 ACCEPTED → R-I (invariant-through-the-sim + can-fail
demonstration per converted driver). 7 ACCEPTED → R-H(F8 prerequisite named
with budget). 8 ACCEPTED → R-I (native save path + read-back). 9 ACCEPTED →
R-D (Electron-proven per checkout, self-bracketing first pose re-sampled
last; the "second port" line was the browser recipe and is struck).
[Note: the interim A1 numbers above were in fact produced under
run-electron.cjs per checkout — the objection's demand is met and the
bracketing is added for the live re-runs.] 10 ACCEPTED → R-C (C1/C6 inherit
the fallback ladder + lock-detection). 11 ACCEPTED → R-F(1). 12 ACCEPTED →
R-G (E1 gains RMS + context-state + the unknown-cue warning). 13 ACCEPTED →
R-L(B3 pinned-test sweep first). 14 ACCEPTED → R-I (pack flags + gate
regeneration + re-hash). 15 ACCEPTED → R-H(F5 gate = checkout-space test,
margin quoted). 16 ACCEPTED → R-H(F3 pixel signature). 17 ACCEPTED →
R-L (G moves before E/F; A3 re-estimated at 2.5–3 h; F2's sweep breadth
capped by the enumerate-and-mark-UNCONFIRMED rule rather than a fantasy
90 min).

**Reviewer 3 (DIVERGENCE):** 1 PARTIAL → R-F(4) — the two rendered-frame
rows are added; the auto-red-per-slider wiring is REJECTED (a slider whose
value legitimately has no visible effect at the current pose — e.g. a
settle time while idle — would false-alarm constantly; the per-slider
liveness table in R-F(1) covers dead sliders systematically, and the
exercise mode puts every stroke value under visible motion). 2 ACCEPTED →
R-F(2), with the stated limitation that the exercise replay is synthetic
events into the real handlers — one mouse cannot drag a slider and sweep
simultaneously, and the limitation is written in the report. 3 ACCEPTED →
R-F(3). 4 ACCEPTED → R-F(6). 5 ACCEPTED → R-B(1) — it becomes B0's first
number. 6 ACCEPTED → R-B(2,5). 7 ACCEPTED → R-C (spike first; OS input is
the committed fallback). 8 ACCEPTED → R-M(B1 in-page recorder at owner
res). 9 ACCEPTED → R-B(3) + the head-coverage-at-real-pitch number joins
the report (if the head occupies ~0% of the frame at the player's sweeping
pitch, that IS a finding). 10 ACCEPTED → R-B(4). 11 ACCEPTED → R-L(B6).
12 ACCEPTED → R-D. 13 ACCEPTED → R-E + R-A. 14 ACCEPTED → R-I (owner's own
autosave). 15 ACCEPTED → R-J(C1). 16 ACCEPTED → R-J(C6 ordering cases).
17 ACCEPTED → R-J(C3 live leg). 18 ACCEPTED → R-J(C2 at owner res +
texel ratio). 19 ACCEPTED → R-J(C4 screenshot acceptance). 20 ACCEPTED →
R-G. 21 ACCEPTED → R-G (AV capture + footstep timing). 22 ACCEPTED →
R-H(F8 organic run + UI-pixel total). 23 ACCEPTED → R-H(F3 60 fps + orbit).
24 ACCEPTED → R-H(F6 pixel-diff + watched). 25 ACCEPTED → R-H(F4 pixel
floors). 26 ACCEPTED → R-H(F5 minimum-over-sequence). 27 ACCEPTED →
R-H(F2 surface enumeration + UNCONFIRMED). 28 ACCEPTED → R-H(F1 four
routes). 29 ACCEPTED → R-H(F7 peak screenshot + body count). 30 ACCEPTED →
R-M(D1 apply). 31 ACCEPTED → R-M(D3 real UI). 32 ACCEPTED → R-M(D4
mid-scroll). 33 PARTIAL → R-M(D2): settings+pause screenshots at owner res
for all ten locales with the longest-string page audited per locale;
the full every-surface-per-locale sweep is out of tonight's budget and the
coverage boundary is stated in the report instead of implied away.
34 PARTIAL → R-M(D5): default + owner-native; the narrow third size only
if time remains, and the matrix says which ran. 35 ACCEPTED → R-K(G1 live
walker). 36 ACCEPTED → R-K(G2 all seeds, counter-position camera).
37 ACCEPTED → R-A. 38 ACCEPTED — the report's first page carries the
five-minute owner script with, per step, the exact clip/screenshot the
night produced at the same pose and resolution.

## What the remedies cost

The remedies add real hours (owner-res re-captures, per-slider sweep, live
perf variants, three F8 runs, AV capture). The cut line moves accordingly:
the order becomes A, B, C, D-lite (D1/D3/D4/D5 + es/fr completion), G, E,
F1/F2/F8-repro — with F3-F7 and the seven empty locales as the first
casualties, reported NOT DONE if unreached. That trade — fewer items,
each actually verified against the player's screen — is the entire lesson
of rounds one through six.
