# SESSION 16 RESUME MAP (live; delete at night end)

## Exact resume point (UPDATED after G)

STATE NOW: A, B (all of B0–B5), C, D committed and pushed through 3f38f51
(+ D4/D5 in 14c5523). A3 committed (speeds [0,1], Space the only time
control, day length measured). G BUILT AND VERIFIED tonight, committing
next: characterAsset one vertical law (pelvis/belt/buckle/tongue `+ bob`)
+ full-radial feature seats (brow z 0.139, mouth z 0.133); driver
tools/qa/electron-g-characters.js green AFTER (lockstep 0/0, control
0.0399, seats −0.9/+0.3 mm) and red BEFORE via stash swap (lockstep red,
brow +14.2 mm, mouth +19.7 mm); profile screenshot pair under
qa/electron/g-characters/{before,after}/ (face-on hides a normal-axis
float — fault 56). Suite 2821/0. Report carries G section + faults 47–56.

IN PROGRESS: E (audio). Design = PLAN_16.md R-G (RMS depth per surface,
breadth enumeration, unknown-cue warning ships with E1; footstep zone/cue
100% agreement, count ±20% of bobPhase minima; ledger flip cue within
50 ms of leaf start). Anchors found so far:
- audio.js: return block 1818, uiTick 373, varied() 935, thunk 480,
  paper 643; uiBus for UI one-shots.
- main.js:880 = walk.hooks.sfx router (silently swallows unknown names —
  add the warning + QA counter here).
- ui.js el() = the button factory for menus/settings; laptop.js:499
  ALREADY plays uiTick centrally for laptop clicks → el() hook must skip
  `.laptop` or laptop buttons double-tick.
- clubhouse.js:8915 sign flip fires sfx('uiTick') → becomes 'signFlip'.
- courseScene.js bobPhase: declared 6951, advanced 7044 (walkMoving
  gate exists), used for held sway 8292. Footstep = sin(bobPhase) minima
  + displacement gate + boards/turf via clubhouse containment.
STILL TO FIND: ledger open/turn/close cue sites in main.js ledger key
handler; register keypad tap site; cashier station enter/leave site.

THEN: F (checkout, R-H — biggest remaining build), first-load instrument
run (A1 remainder, electron-first-load.js exists), Phase 4 verifiers
(game-only), final report assembly + disproven-claims-at-top + owner
five-minute script on page 1. Carry-forward NOT DONE (already in report):
A3's ten QA fast-forward drivers, vacuum/dustpan clobber (B6), GL
sampler-mismatch warnings lead, C2 full typography pass, C4 locked-state
screenshot.

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
  interior.position offset (-5.2,+3.0) declared as staging. Digits 1-3
  are FREE since A3 (speed keys deleted; Space toggles pause). Held
  groups = scene.getObjectByName('Tool_<id>'), hands chain
  FirstPersonRightHand < FirstPersonHands < Tool_<id>; THREE via
  `import(new URL('vendor/three.module.js', document.baseURI).href)`;
  sharp via createRequire AT TOP of driver (TDZ fault 47).
- Walk camera forward = (−sin yaw, 0, −cos yaw) (mouseLook.js YXZ);
  negative pitch looks down. Procedural characters: root children chest
  group y 1.07 / pelvis y 0.98; head group y 0.62 under chest; skull
  SphereGeometry r 0.155 at head-local z 0.054; features are direct head
  children (local radial = mesh-true seat check); belt = CylinderGeometry
  radiusTop 0.205, buckle BoxGeometry width 0.062, brow width 0.052,
  mouth width 0.058 (find-by-geometry-params).
- A1 DONE-measured: steady flat across 65ce987→8baa596→HEAD (tables in
  report + scratchpad a1-*.json); stall-class is the regression; ledger
  open worst 250ms; first-load driver built (electron-first-load.js) NOT
  yet run (run on HEAD+2 worktrees C:/wt-gf-pretools, C:/wt-gf-preledger).
- The ~55ms ANGLE canvas→texture sync is per UPLOAD-FRAME and
  size-independent; same-frame uploads share ONE stall → batch, don't
  split (13-run ledger chain in report).
- Checkout/audio/settings/ledger/characters maps: file:line specifics all
  in PLAN_16.md sections; explorers' full text gone with old context —
  PLAN carries what matters.
- Suite was 2821 green at session start (fe9a85b) and stays the gate
  before every commit; never `git add -A` (parallel Blender session's
  .blend files sit modified in the tree). Stop hook active: never stop;
  compact-and-continue.
