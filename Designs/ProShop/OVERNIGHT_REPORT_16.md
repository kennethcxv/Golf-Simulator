# OVERNIGHT REPORT 16 — IN PROGRESS (working draft; finalized at night's end)

Phases: PLAN (done — PLAN_16.md), ADVERSARIAL REVIEW (done — 97 objections,
all answered in PLAN_16.md's Phase 2 section, remedies R-A…R-M), IMPLEMENT
(running), VERIFY (pending). This file accumulates verified findings as they
land so nothing depends on session memory. Claims here carry their evidence
path.

## A1 — the regression, measured (three checkouts + noise bound)

Same probe file (HEAD's perf-probe.js), Electron, pine-hills-v2, same
machine, sequential runs. Evidence: scratchpad a1-head.json / a1-head2.json /
a1-pretools.json / a1-preledger.json (to be copied beside this report at
close).

- Steady-state averages FLAT across 65ce987 (pre-ledger) → 8baa596
  (pre-tools) → HEAD: idle 9.59 → 9.36 → 9.23 ms; interior spin 8.73 → 8.37
  → 8.09; every A/B row within 2%. Direction mildly favourable. **Neither
  the tool rebuilds nor the ledger sections regressed steady-state at the
  fixed poses. Ranked deltas ≈ 0 ± noise.**
- Worst frames are a stall lottery, not a commit delta: spin-outdoors worst
  1459 (HEAD) / 448 / 33 ms; spin-interior worst 38 (HEAD) / 349 / 676 ms —
  the OLDEST build spikes worst indoors.
- NOISE BOUND (HEAD vs HEAD): clean-scenario averages repeat within 1.4%;
  spin-outdoors average swung 16% run-to-run (worst frame 1459 → 224); 1%
  lows swing 2–4x everywhere. Single-run worst-frame/1%-low claims are not
  evidence; the report only quotes them with this bound beside them.
- CPU digest (both HEAD runs): updateMatrixWorld ~1.37 s self-time (the
  known 2,208-object clubhouse subtree), getParameters+getProgram+setProgram
  ~1.0 s — 40 shader programs compile MID-SESSION (245→285). The stall class
  the player feels lives here plus the ledger moments.
- Console shows a flood of `GL_INVALID_OPERATION: Mismatch between texture
  format and sampler type (signed/unsigned/float/shadow)` warnings on HEAD
  AND on both baselines (a1-*.err) — pre-existing, not tonight's regression;
  logged as a lead, not chased yet.
- Ledger open TODAY (existing driver, harness window): **worst frame 250 ms
  on the open**, 2 frames > 40 ms (a2-ledger-before.json). Far worse than
  the 70.8 ms recorded in report 15 — measured before any fix; A2's work
  targets this with the R-E acceptance (no ≥33 ms frame, owner resolution,
  content-correctness checks).
- STILL TO RUN for A1 (R-D): live-sim pose variants (clock+NPC asserted
  advancing), first-load instrument (built:
  tools/qa/electron-first-load.js) on HEAD + both worktrees.

## B0 — the divergence (instruments landed, first numbers pending)

**Candidate 4 (is my build your build): CLEARED with evidence.**
- The held tools load straight from
  vendor/models/assets_51_100/firstperson/*.glb — `npm run dev` is
  `electron . --dev`, no Vite, no pack step, no cache directory exists.
- asset_072_mop_fp.glb sha256 114d15d5…, asset_074_broom_fp.glb 43256a46… —
  both **git-clean**, i.e. byte-identical to the committed artifacts
  (cab0f09 / 53ea8f9). Player and instruments load the same files. The
  modified .blend SOURCES in the tree have not produced drifted GLBs.

**Candidate 1 (rig output overwritten downstream): CONFIRMED IN SOURCE AND
CAUGHT IN THE RUNNING GAME.** courseScene.js:8679-8686 writes
`group.position.x = rest.x + sin(phase)·span` and `group.rotation.z =
restZ + cos(phase)·0.035` every USING frame, guarded by
`!(walkTool === 'broom' && broomVm.isActive())` — broom exempt, mop NOT.
The B0 real-input run (qa/electron/b0-divergence/mop-fresh/b0.json,
sampled post-render every frame) shows, while mopping with a real held
button under real pointer lock:
- drawn rotation.z spans **−0.034…+0.035** — exactly the legacy block's
  ±0.035 wobble; the rig's own roll (rollLean + rollStroke ≈ ±0.14,
  stroke-locked) never reaches the drawn transform;
- drawn x − rest.x sweeps **−0.186…+0.190** — exactly ±MOP_SPAN (0.19),
  sinusoidal about rest.x, the :8682 line verbatim;
- while STILL, rotation.z sits pinned at the rig's solved −0.129 and x
  stays put — the rig owns the pose the moment the button is released.
- Throughout: vmActive true, geomSource 'live', draw camera fov 78 — the
  rig ran perfectly and its diagnostics were perfect. **The player mops
  with the pre-Phase-6 flat lateral slide; every value six rounds tuned
  never reached the screen while the button was held.**
Flat-paint at rest: hand blob (2,831 px) sits 3 px from the shaft blob —
the hand IS on the mop when still; the detachment complaints concern
motion, where the clobber owns the frame.
Planned fix (after B1's before-video is recorded): the stroke block's two
visual writes gate on `rigFor(walkTool)?.isActive()` for mop+broom
(scoped per B6; vacuum+dustpan carry the same defect and are listed under
"found, not asked, not touched tonight").

**The mop's visible skirt is welded BY CONSTRUCTION.**
build_assets_71_80.py:485 joins the modelled strands into the single static
MESH_MopSkirt; toolViewmodel.js:371-383 hangs the 14 procedural strands on
the collar and NEVER hides the skirt. The player's eye is on an authored
bundle that cannot move; the procedural strands move among it. "The strands
do not move at all" and "tips travel 0.2546 yd" are both true — of
different meshes. Broom equivalent: MESH_BroomBristles is the same welded
construction (build_assets_71_80.py:514); the broom got NO procedural
bristles at all (goal B3 says this itself).

**Real-input path: PROVEN under the harness** (electron-realinput-spike):
pointer lock from a real click; real locked mouse deltas turn the view
(−0.479 rad); a real W hold walks 3.117 yd; unlocked-deltas control reads 0.
Tool belt is F (hold ≥230 ms opens the wheel; digits select; a tap cycles);
digits 1-3 are SPEED keys (A3 removes 2/3). Equip through the real
wheel works; wheel shows all nine tools with the cleaning kit owned.

**Staging declared for B0 legs:** cleaning-kit ownership seeded
(state.shop.inventory.vac1.back=1; read-back = wheel items available) and
one teleport to the shop floor before input begins. Everything after is
real input. Owner-resolution acceptance operational: window sized to
2546×1403 DIP @1.5 (3840×2160 physical) via qa-boot's ownerResolution()
(R-A).

## B0 — VERDICT (all four candidates resolved, with evidence)

**The divergence was real, and it was candidate 1 twice over — two separate
mechanisms, one per tool, both invisible to every instrument that measured
sockets instead of drawn meshes.**

**Mechanism A — the whole-tool head-lag pivot (BROOM; the "hand is not on
the broom when I move").** `buildHeadLag()` (broomViewmodel.js:362-386)
wraps "the contact socket's SIBLINGS" on a pivot and swings them by
headLag.angle. In the rebuilt GLBs the socket's parent is the whole-tool
node (`LOD0_BroomHeld`), so the pivot grabbed ALL 13 broom meshes — handle,
grip wrap, butt cap, bristles, everything (probe:
qa/electron/b0-divergence + the pivot child list). The SOCKETS have no
meshes under them, so they stay unswung; the hand seats on the socket.
Every fast head motion — hardest during a real camera TURN, where the
head's world-lateral speed is yaw-rate × reach — swings the ENTIRE drawn
broom about the contact point while the hand stays put. Measured on the
real input path (b0-divergence/broom-fresh):
- world hand-to-grip-socket: 0.033–0.037 yd across the whole walk+turn
  (attached, always — this is why six rounds of socket-space numbers
  passed);
- the GLB's own socket-to-grip-wrap distance: 0.217 yd at rest → 0.286 yd
  mid-turn (the drawn mesh moves off its own sockets);
- flat-paint pixel gap hand↔shaft: **3 px at rest, 169 px walking, 273–302
  px turning** (screenshots flat-rest/walking/turning.png; controls:
  hidden hands 0 green px, tone-mapped flat frame 0 green px).
The five prior rounds swept PITCH (slow head motion, tiny lag angle) with
`using=true`; the player TURNS (fast lateral head motion, lag angle to its
±0.42 clamp). Candidate 2 — the driver-state gap — is thereby confirmed as
the reason the defect survived six instrumented rounds.

**Mechanism A′ — the same pivot, built EMPTY (MOP).** The mop's
ToolHeadLagPivot exists with ZERO children: buildHeadLag ran while the
PROCEDURAL fallback meshes were still the socket's siblings, and
adoptAuthored() later retired (removed) them — leaving an empty pivot,
`headLag.built` latched true, and the authored mop NEVER re-wrapped. So
the mop's visible mesh never swings at all (no head-lag life), while the
strand rig still receives headLag.angle as its carry signal. Which bug a
tool gets — whole-tool swing or no swing — depends on whether the authored
GLB had adopted when buildHeadLag first ran. Both are wrong; they are
DIFFERENT wrong per session timing.

**Mechanism B — the legacy stroke writer (MOP; "the strands do not move").**
Confirmed in-game (see above): courseScene.js:8682/8685 overwrites the
drawn x (±0.19 = MOP_SPAN exactly) and roll (±0.035 exactly) every USING
frame — broom exempt, mop not. The rig's arc/weight/lag never reach the
screen while the button is held.

**Mechanism C — the welded skirt share.** Flat-paint census
(mop-fresh/flat-strand-vs-skirt.png): the authored welded MESH_MopSkirt is
**7,926 px** of the visible head; the 14 procedural strands are **2,674 px
(25.2%)** — a quarter of the skirt, in thin threads distributed through a
solid welded bundle. The motion the collar-local instrument honestly
measured is carried by a minority of the pixels and visually drowned by
the static bundle, and while mopping the whole assembly rides Mechanism
B's flat slide.

**Cleared:** candidate 3 (one lens: every mesh under Tool_broom on layer
29, drawn by the fov-78 vm camera — probe byMask 536870912 × 80 objects);
candidate 4 (git-clean GLBs, no cache, no Vite — see above).

**The fixes B0's evidence dictates — IMPLEMENTED AND VERIFIED post-fix on
the same real-input instrument:**
1. buildHeadLag wraps HEAD meshes only (name allow/deny lists + 0.5 yd
   world radius from the contact socket), tears down cleanly (rotation
   zeroed before children are handed back) and REBUILDS whenever the
   contact socket node changes — the fallback→authored adoption no longer
   latches an empty or whole-tool pivot (broomViewmodel.js).
2. updateHeadLag differences the head position in the CAMERA frame, so a
   stroke swings the head and a camera turn does not (broomViewmodel.js).
3. The legacy stroke block's two visual writes gate on `rigOwnsHeldTool`
   (mop+broom; courseScene.js — vacuum/dustpan same defect, logged not
   fixed, per B6).

**Post-fix numbers (same driver, same real input path, controls green):**
- Broom flat-paint hand↔shaft min gap: **3 px at rest, 3 px walking, 3 px
  turning** (was 3 / 169 / 273–302). The hand is on the broom when the
  player moves.
- Mop while mopping: drawn roll span **0.261 rad** (the rig's stroke roll)
  — was exactly the legacy ±0.035; drawn-x still sweeps ~0.38 but so does
  the never-clobbered broom's (0.392): both are the rig's own arc now.
- vmActive true / geomSource live / fov 78 throughout, as before — the
  difference is the DRAWN transform now belongs to the rig.

## B1 — the BEFORE clips, recorded and watched

Both sessions recorded through the real input path (real lock, F-wheel,
digits, W/A/D, held button, default pitch, nothing framed):
qa/electron/b1/broom-before/*.webm and mop-before/*.webm, frames extracted
at 0.7 s steps (broom 34.2 s / 49 frames, mop 34.8 s / 50). Capture
caveats, stated per R3#8: Playwright's compositor webm at 800×600 with a
letterbox band, frame-dropping — the AFTER clips will use a better capture
and this size is written next to every claim below.

**Broom (watched):** through the walk, the turn, and even while the sweep
button is held, the broom rides nearly HORIZONTAL — head floating at chest
height, level like a carried rifle (frames t021700, t030100). At the
default pitch the floor is never in frame and the plant never engages
(carry pose by design above pitch −0.10), so holding the sweep button
strokes the head through the AIR at chest height — nothing about the
picture says "sweeping". One bare hand grips mid-shaft with a floating
forearm entering from the bottom edge. The transient hand/shaft
detachment B0 measured (302 px mid-turn) is TOO FAST for 0.7 s stills —
it lives between these frames and is proven by the per-frame instrument,
not by the stills; both are true.

**Mop (watched):** at the default pitch the mop is barely a tool on
screen at all — frame t024500 shows a dark handle BUTT aimed at the lens
with the hand behind it; head, collar and every strand live below the
bottom frame edge. A HUD prompt ("Mop dry — use the bucket in the
cleaning bay") sits mid-screen. While the button is held, what little is
visible rides the legacy x-slide (per-frame proof above); the yarn the
project spent two rounds animating is not in the frame to be seen.

**What this says in words:** the six-round argument was about grips and
strands, but at the player's own pitch the mop shows its butt and the
broom sweeps the air. If it looks wrong to me too — it does — the
strongest single feel problem at DEFAULT pitch is that the working pose
only exists below a pitch the player is never told to hold. That
observation feeds B5's tuning (and the overlay's exercise mode makes it
tunable live).

## D1 — implemented, not yet verified

main.cjs: display-info and set-resolution now speak PHYSICAL pixels
(`size × scaleFactor`); `fits` compares against the display, not the DIP
work area; a size the display shows but a chromed window cannot hold
applies as borderless-fullscreen instead of throwing; FW_FAKE_DISPLAY
injects a fake display AT the activeDisplay() boundary so the negative
control exercises the shipped comparison. Verification (driver applying 4K
+ asserting content bounds × scale, list screenshot on this 4K machine,
fake-display control) still to run.

## Instruments built so far tonight

- tools/qa/electron-realinput-spike.js — real input pre-flight (green).
- tools/qa/electron-b0-divergence.js — the B0 instrument (legs: mop-fresh /
  broom-fresh / mop-restore / broom-restore / mop-beltswap).
- tools/qa/electron-first-load.js — A1 first-load stall instrument (built,
  not yet run).
- qa-boot.mjs ownerResolution() — R-A owner-window sizing + caption.
- Baseline worktrees C:/wt-gf-pretools (8baa596) and C:/wt-gf-preledger
  (65ce987), junctioned node_modules, probes proven booting to gameplay.

## Instrument faults tonight (running count, continues report 15's list)

45. The B0 driver's first group lookup matched a node name that does not
    exist (`HeldToolAuthored:.*072_mop` — the held groups are `Tool_<id>`);
    every region capture read "offscreen" and the shaft paint found zero
    meshes while the checks beside them passed. Caught by frames=0 in its
    own output; fixed by the name probe (electron-nameprobe.js).
46. The first wheel-equip attempt clicked the wheel item by coordinates and
    the canvas intercepted the click at owner resolution; the run died
    before writing its JSON. The wheel's own keyboard surface (digits +
    Enter) is resolution-independent and is the player's path too.
