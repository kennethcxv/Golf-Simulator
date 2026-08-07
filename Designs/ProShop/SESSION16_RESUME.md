# SESSION 16 — LIVE RESUME NOTE (written at the context boundary; delete when night ends)

Phase 3 in flight. Everything decided lives in PLAN_16.md (incl. Phase-2
remedies R-A…R-M, which supersede per-item verify text) and
OVERNIGHT_REPORT_16.md (verdicts + evidence paths + faults 45-46). Tasks
#14-#26 track sections. RULES: Electron only, pine-hills-v2, owner-res
acceptance (qa-boot ownerResolution), negative control per instrument,
suite green before each commit, stage explicit paths only (parallel .blend
session in tree), NPCs 1x.

## Exact resume point

1. Background bash b4s84ghrr = re-run of BOTH B0 legs against the FIXED
   build: `QA_B0_LEG=broom-fresh|mop-fresh node tools/qa/run-electron.cjs
   tools/qa/electron-b0-divergence.js --clubhouse=pine-hills-v2`.
   ACCEPT: broom flat-turning minGapPx collapses (was 273-302; rest 3);
   mop working gxSpan no longer ±0.19-legacy (was exactly rest.x±MOP_SPAN)
   and grz no longer ±0.035; headLagReason now "swinging N head part(s) of
   M siblings" with N ≪ 13 on broom, N>0 on mop (was whole-tool 13 / empty).
   If legs FAIL boot: my three fixes broke something — check
   broomViewmodel.js (teardownHeadLag/buildHeadLag/updateHeadLag edits) and
   courseScene.js rigOwnsHeldTool (declared just above the stroke block).
2. Then: `npm test` (suite green) → commit fixes+instruments+PLAN_16+
   REPORT_16+SESSION16_RESUME (explicit paths; NEVER `git add -A`) → push.
3. Then B1: extract+READ frames of the BEFORE clips
   (qa/electron/b1/{broom,mop}-before/*.webm) via
   `QA_WEBM=<file> QA_FRAMES_OUT=<dir> node tools/qa/run-electron.cjs
   tools/qa/webm-frames.js`; describe in report citing frame times. Record
   AFTER clips with same b1 driver (`VIDEO_DIR=... QA_B1_TOOL=broom|mop
   ... electron-b1-watch.js`), read, describe.
4. Then B2 overlay (PLAN R-F: structuredClone liveFeel registry in
   courseScene where rigs are built at :6547; rig refreshFromFeel();
   mopStrands params; src/ui/toolTuner.js F9 dev panel; save via new IPC
   fw:save-tool-feel → src/data/toolFeelOverrides.json deep-merged in
   toolFeel.js; per-slider liveness driver; exercise mode). Then B3
   (hide MESH_MopSkirt + MESH_BroomBristles, bar-layout bristle rig), B4
   (plant reach gate), B5 tune. Then C bundle (A2 ledger split+cache; C1
   keep pointer lock, OPEN_SECONDS 0.85→0.4, face re-solve per frame; C6
   consume A/D via live bindings + stopPropagation, main.js:517-533), D2-D5,
   G (BEFORE E/F per R-L), E, F. Remaining time governs; NOT-DONE list per
   goal.

## Key facts a fresh context must not re-derive

- B0 SOLVED (full verdict in report): (A) buildHeadLag pivot grabbed ALL
  13 broom meshes (socket parent = LOD0_BroomHeld) → whole drawn broom
  swings on turns while hand rides unswung sockets → 3px rest / 302px turn
  gap; (A') mop pivot EMPTY (built on fallback, latched); (B) legacy
  stroke writer courseScene:8682/8685 clobbered mop x/roll every using
  frame (broom-only guard); (C) procedural strands only 25.2% of skirt
  pixels vs welded MESH_MopSkirt; candidates 3/4 cleared (all layer 29 fov
  78; GLBs git-clean, no cache). FIXES IMPLEMENTED tonight: bounded pivot
  selection (HEAD_NAME/SHAFT_NAME/0.5yd radius) + rebuild on socket change
  + zero-rotation teardown; camera-frame lag differencing; rigOwnsHeldTool
  gate. Vacuum/dustpan have same clobber — logged, NOT fixed (B6).
- Real-input recipe: hold F ≥450ms opens wheel (tap cycles) → press item
  DIGIT (click intercepted by canvas at owner res) → Enter → click canvas
  re-locks. walk.getTool() (NOT walk.tool()). Mop/broom need
  state.shop.inventory.vac1.back≥1 + player inside; stage teleport
  interior.position offset (-5.2,+3.0) declared as staging. Digits 1-3 are
  SPEED keys. Held groups = scene.getObjectByName('Tool_<id>'), hands
  chain FirstPersonRightHand < FirstPersonHands < Tool_<id>; THREE via
  `import(new URL('vendor/three.module.js', document.baseURI).href)`;
  sharp via createRequire AT TOP of driver (TDZ fault 47).
- A1 DONE-measured: steady flat across 65ce987→8baa596→HEAD (tables in
  report + scratchpad a1-*.json); stall-class is the regression; ledger
  open worst 250ms (a2-ledger-before.json); first-load driver built
  (electron-first-load.js) NOT yet run (run on HEAD+2 worktrees
  C:/wt-gf-pretools, C:/wt-gf-preledger — cd into worktree, use its own
  tools/qa copy perf-probe-head.js pattern).
- D1 main.cjs DONE (physical px + activeDisplay + FW_FAKE_DISPLAY +
  borderless apply) — NOT yet verified; settingsPanel copy line still to
  update in D pass; driver per R-M (apply 4K, assert contentSize×scale,
  fake-display control).
- A3 map in PLAN (ladder [0,1,2,4]→[0,1]; decision-compression STAYS;
  speedRung save clamp; 6 reach-drivers reseed; 4 pinned tests rewrite;
  goal wants day-length measured live).
- Checkout/audio/settings/ledger/characters maps: file:line specifics all
  in PLAN_16.md sections; explorers' full text gone with old context —
  PLAN carries what matters.
- Suite was 2821 green at session start (fe9a85b). Stop hook active: never
  stop; compact-and-continue.
