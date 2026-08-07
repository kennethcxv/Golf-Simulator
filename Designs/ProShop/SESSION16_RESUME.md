# SESSION 16 RESUME MAP (live; delete at night end)

## Exact resume point (UPDATED mid-E/F)

STATE NOW: A-D + G committed and pushed (G = 7509071). E BUILT AND GREEN:
electron-e-audio.js run 17 all 14 checks; run 18 = second-green
confirmation with the turn-stall retry. E product: audio.js eight voices +
qaMasterTap(2048) + uiTick debounce; ui.js el() pointerdown hook; main.js
sfx router warning + footstep hook + __fwUiClick sink + delegated
fallback + ledger cues; courseScene bobPhase RELOCATED to walk update
(barehanded gait existed nowhere before) + footfall detector (0.22 yd
gate, teleport clamp, idle reset); toolWheel digit/shortcut ticks;
laptop nav-rail clicks. F PRODUCT LANDED (drivers partly pending):
F1 station-priority focus (walkStationPropInReach + station flags on till
prop 1880 + ledger prop + overview-interact guard in main.js + walk API
stations()/stationInReach()); F2 monitor note band 496/grid 512 + rect
recorder MONITOR_OVERLAPS + planted control; F3 bag occluder shell +
full-size slide-in + hide (both paths + restore), contracts re-pinned;
F4 customerCash quarter-gate (audit 135/400 sub-quarter -> 0/400,
f4-cash-audit.mjs); F5 queue head -0.26 (world 3.04, slot2 unchanged at
4.42 via pitch 0.69) + tender -0.38 + clamp -0.48 + face the cashier
(staffStand), layout test re-pinned; F6 CashLaid pose + flow-map split
(cash lands -> arm back; card held; both settle after PaymentComplete);
F7 caps 5/8/10/12 + tests re-pinned (footfallDiagnostics is the probe);
F8 escape closed (openWalkInCustomer empty-cart gate + __f8LegacyClassifier
QA flag + loud exit invariant [F8-INVARIANT]/__f8Violations). Drivers
BUILT not yet run: electron-f1-station.js, electron-f8-escape.js.
Suite: one flaky-looking 2820/1 (em-dash?) then clean re-runs; an
authoritative run is in flight before the E/F commits.

COMMIT PLAN (shared hot files force the split): commit 1 "E" =
audio/ui/toolWheel/laptop/main/courseScene + report + resume; commit 2
"F product pass" = clubhouse/customers/characterAsset/
simplifiedRegisterMode/frontDeskMonitorUi/shopLayout/shopProgression/
sim-register + re-pinned tests + f-drivers + f4 audit. One push.

THEN: F drivers (f1, f8-escape, the combined checkout driver for
F3/F4-mesh/F5-fractions/F6-clips, F7 seeds, F2 sweep), first-load run
(A1 remainder), Phase 4 verifiers, final report. F8 one-payment merge =
the plan's first NOT-REACHED candidate; steps 1+4 are DONE, 2-3 (green-fee
line into the open retail tx, one tender) NOT DONE unless time allows —
the seam and design live in PLAN_16.md F8.

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
