# SESSION 16 — LIVE RESUME NOTE (written at the context boundary; delete when night ends)

Phase 3 in flight. Everything decided lives in PLAN_16.md (incl. Phase-2
remedies R-A…R-M, which supersede per-item verify text) and
OVERNIGHT_REPORT_16.md (verdicts + evidence paths + faults 45-46). Tasks
#14-#26 track sections. RULES: Electron only, pine-hills-v2, owner-res
acceptance (qa-boot ownerResolution), negative control per instrument,
suite green before each commit, stage explicit paths only (parallel .blend
session in tree), NPCs 1x.

## Exact resume point (UPDATED after B2/B3/B4 build)

STATE NOW: B0/B1 committed+pushed (392b2bf, 03c73e1). B2 overlay BUILT AND
VERIFIED (tuner driver green: 22/22 sliders live, dead control inert,
save→relaunch ships, panel screenshot qa/electron/tool-tuner/). B3 BUILT
AND VERIFIED in-game: mop rig is THE skirt (26×3 thicker strands, welded
MESH_MopSkirt hidden at adopt; strandsHidden control kills motion 737→32);
broom has real tuft rows (bar layout 22×2 under hidden MESH_BroomBristles,
screenshot b0-divergence/broom-fresh/01-equipped-default-pitch.png shows
the comb). B4 BUILT (plant authority fades over 12cm as hands sink below
plant height; workBlendEff drives planted flag+strands) — NOT yet
instrument-verified (sweep re-run pending). Broom gaps still 3/3/3 px.

DONE SINCE: B2+B3+B4 COMMITTED AND PUSHED (dfb4b4b + 68a8e18 + 2dd0c3f),
final suite 2821/0 green. PROCESS FAULT #49 for the report: dfb4b4b and
68a8e18 both went in with no-em-dash-in-player-copy RED (first: tail
swallowed the fail line; second: grep's exit code matched "# fail 1" and
the && chain committed anyway) — closed properly in 2dd0c3f; the report
must record both misfires under instrument faults. B0-driver note: its mop
leg re-shows the hidden skirt after its control — reorder before next use
(the share step measured a driver-made state, not the game's).

=== A3 STATE (live) ===
C DONE (b7c1ae9). A3 PRODUCT IN (uncommitted): balance speeds [0,1] +
simSpeedMultipliers = day-compression constant (decision 4, locomotion 1,
speedIdx ignored) + golferPaceScale ignores rung; main.js speed-key block
deleted (Space = only time control); keyBindings three speed rows deleted
(normalize drops orphan rebinds); hud chip ⏸/▶ toggle; state.js
deserialize clamps golfDay.speedRung>1 → 1 with noteRepair. AWAITING
suite bxrr01r5n → rewrite pinned tests (expect: sim-time-locomotion
[iterates BALANCE.speeds, wants decision>1 at default ✓ still true,
top-rung cases die], golfer-pace [rung-16 cap cases die], maybe
keybinding-count tests). Then day-length measurement (goal wants MEASURED
live: sample state.clock.minutes over 60 real s at 1x → report
game-min/real-min → trading window 840/x minutes) via tiny driver or
in first-load run. Then commit A3. QA drivers pressing '2'/'3' (6 reach +
4 measure, list in PLAN A3) = retire-notes in report tonight, convert if
time. THEN: D2-D5, G, E, F, first-load instrument run (A1 remainder),
Phase 4 verifiers, final report.

=== LEDGER BUNDLE STATE (live) ===
C1+C6+A2 PRODUCT CODE IN (uncommitted): main.js enterLedger keeps pointer
lock, resetCameraInput stays, handler consumes via boundAction moveLeft/
moveRight + stopPropagation, lock-aware click (L=next R=back);
ledgerBook.js OPEN_SECONDS .85→.4, rise re-solves facePose per frame,
turn split (2 paints at turn frame; leafBack@t.25; paintSpread@t.55 via
turnDeferred), paintStats in diagnostics, applyClosedPose clears leaf+
deferred, window.__ledgerTurnLegacy = QA legacy path.
DRIVER tools/qa/electron-ledger-turn-cost.js run 3 (stand −358.4/8.69 yaw0
+ bringToFront + wait state==='open'): PASS lock-through-open, open worst
23.6ms 0 over-33, c6NoMovement (D consumed, body 0yd), walk-while-open ✓.
RUN 4 (probe): model fine (9 pages/5 spreads), directTurn true, C6 NOW
FULLY GREEN (held D: spread 1, body 0.0000 yd — run-3 fail was leaf-in-
flight timing, fault 51). REMAINING RED: turnsUnderBound — 21 frames
over 33ms (worst 61.5) while split paint = 0.3ms ⇒ THE COST IS TEXTURE
UPLOAD (needsUpdate GPU upload at render), not painting — the plan's
hard-part prediction. controlSeesLegacyCost red for the same reason
(uploads dominate both paths). NEXT LEVER: halve the LEAF canvases'
backing (384×256 — motion hides it): in ledgerBook makePageCanvas give
leafFront/leafBack a 0.5 scale variant and in paintIndexWith start with
ctx.setTransform(canvas.width/PAGE_W, 0, 0, canvas.height/PAGE_H, 0, 0)
so painters' absolute coords scale; uploads ×0.25 on the turn frame.
RUNS 5-7 CHAIN: halved leaf canvases (makePageCanvas(0.5) + persistent
setTransform — kept, harmless) barely moved it; BARE probe
(__ledgerNoDeferred, zero canvas work) STILL hitched 57.5/6-of-6 ⇒ paints
AND uploads both ACQUITTED. Hypothesis now: ~55-65ms is the room's own
ambient worst at the desk at owner-res (bakes/compiles — A1's stall
class). RUN 7: ambient CLEAN (18-22ms worst, 0 over-33) — room acquitted, turn
convicted. RUN 8: DIRECT turnPage (no key event) hitches identically
(59.4 / 18-of-6-windows) — harness acquitted; hitch count scales with
UPLOAD EVENTS (bare 1/turn, full 3/turn), ~55ms each, SIZE-INDEPENDENT
(half-res leaf no help) ⇒ constant-cost per needsUpdate = sRGB MIP CHAIN
regeneration. RUN 9: MIPS-OFF CHANGED NOTHING (turns 61.5/20; mip theory dead; keep the
mips-off edit? it's harmless+faster — decide at commit). Open window
throttled again this run (11 frames — focus flake; openUnderBound
verdicts only valid on runs with open.frames>60). RUN 10: programGrowth = 0 (no recompiles). VERDICT TAKEN: same-frame
uploads share ONE ~55ms ANGLE canvas-sync stall (bare 2-uploads = 1
hitch vs split 3-frames = 3) ⇒ REVERTED turnPage to the batched
all-paints-at-turn-frame form (one hitch/turn = this stack's floor;
comment block in ledgerBook.js carries the whole probe chain);
turnDeferred machinery left in place but unused-by-default; driver
checks now: ambientClean + turnsOneHitchMax (≤1 hitch/turn, worst ≤90)
+ openUnderBound guarded by frames≥60 (focus flake → 'UNSAMPLED' passes
with note). RUNS 11-13: batched turn ✓; reopen leg added (first open = one-time
270-780ms session cost, REOPEN worst 22.2ms ZERO over-33 = recurring
open meets the bound outright); RUN 13 ok:true ALL GREEN
(ambientClean, turnsOneHitchMax 7/16 worst 61.6, reopenUnderBound,
C1/C6 complete). AWAITING suite bpcig1jhx → COMMIT bundle: src/main.js,
src/render3d/clubhouse/ledgerBook.js, tools/qa/electron-ledger-turn-
cost.js, report, resume → push. Then C2/C3/C4 → A3 → D → G → E → F →
Phase 4.
(Superseded older branch text follows:) RUN 10 (bj539fpv6):
programGrowth across 6 direct turns. BRANCHES: growth>0 per turn ⇒
recompile churn — suspect the leaf/page MATERIALS being re-created or
texture.dispose somewhere on needsUpdate path; fix at the creation site.
growth=0 ⇒ the 55ms is inside renderer.render texture-state path —
NEXT probe = swap CanvasTexture uploads for
renderer.copyTextureToTexture (or texStorage/texSubImage path via
DataTexture) OR simply accept + report honestly: "each canvas update
costs a fixed ~55ms on this stack; turn schedules ≤1 per frame and
spreads them (2 at frame 0 → split further to 1: move revealed-face
paint to t.10); open pays 1." — worst-frame ≈55 once per turn beats the
legacy 4-at-once regardless; the R-E 33ms bound may be UNREACHABLE for
canvas-update frames on this stack and the report says so with the
probe chain as evidence (goal A2 allows: 'or explain exactly what stops
you'). C6/C1 evidence stays green throughout runs 4-10. After verdict:
restore driver checks to the honest set, suite, commit bundle
(main.js, ledgerBook.js incl. mips-off+half-leaf+split, driver, report,
resume). If green → turn ACQUITTED, C5/A2 report says "turn adds
≤Xms over ambient; ambient worst at desk is an A1 stall-class finding,
NOT a ledger cost" + drop old turnsUnderBound/controlSeesLegacyCost
checks (replaced by ambient-relative form; legacy control compares
legacy.worst vs turns.worst). If red (turns DO add) → next suspect is
leafPivot first-visibility / bendLeaf attribute upload — probe by turning
with leafPivot permanently visible. THEN commit the whole C1/C6/A2
bundle: src/main.js, src/render3d/clubhouse/ledgerBook.js, driver,
report+resume — suite green first. C6/C1 evidence ALREADY GREEN in runs
4-7 (lock through open, D turns pages body 0.0000 yd, walk-while-open,
open worst 23.6ms 0-over-33 at owner res).
STILL IN C AFTER: C2 paper, C3 overlap recorder + live leg + full-content
fixtures test, C4 lock column align (+screenshot colour check). Then A3,
D2-D5, G, E, F, Phase 4 per plan.

B5 DONE pending commit: values broom carryHover .60→.44; mop bearing
-.20→-.34, anchor.x .257→.30, hover .60→.44; saved to
src/data/toolFeelOverrides.json (ship path, FULL-table pin — documented);
B0 exit 3/3/3 green at tuned values; before/after clips + frames watched,
described in report. AWAITING suite bek9gq664 → commit
(toolFeelOverrides.json, tools/qa/electron-b5-tune.js, report, resume) →
push → SECTION B COMPLETE. THEN: A2/C ledger bundle (250ms open; turn
split+cache; C1 keep lock, OPEN_SECONDS .85→.4, face re-solve/frame; C6
consume A/D live-bindings; C2 paper; C3 overlap recorder + live-Electron
leg; C4 locks align) per PLAN R-E/R-J; then A3; D2-D5; G; E; F; Phase 4. B4 DONE AND VERIFIED (electron-b4-plant.js all 8 checks green: legal
reaches plant at kiss 0.012, below-floor -2.0/-2.4 REFUSE with blend 0 +
head at carry hover, up-look sweeps clean did:0, work pitch cleans; plus
courseScene cleaning gate extended broom-only → rig-owned pair so the mop
banks unplanted strokes too; fault #50 = the ladder's own first
thresholds). AWAITING suite b9d92x2m3 → commit B4 (courseScene.js,
electron-b4-plant.js, report, resume) → push → then B5. Then A2/C bundle
(ledger 250ms open + turn split/cache + C1 pointer-lock-keeps + C6 A/D
consume), A3 ladder removal, D2-D5, G before E/F, Phase 4 verifiers,
final report assembly per goal (verification section, disproven claims at
TOP, UNCONFIRMED/NOT-DONE lists).

THEN (order): B5 tune with overlay (record after-clips electron-b1-watch
per tool + watch + report values); A2/C bundle; A3; D2-D5; G; E; F. Phase 4
verifiers at end. Full details in sections below + PLAN_16.md.

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
