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

## B2 — the live tuning overlay: BUILT AND VERIFIED

F9 opens src/ui/toolTuner.js over the running game (sim keeps running, tool
stays drawn). Broom|Mop tabs; sliders for every group the goal names (hand
anchor xyz, grip rolls, hand scale, elbow offsets + forearm length + depth,
strand stiffness/lag/splay/slack, sweep arc/stroke rate/hand follow/wrist
roll, weight lagHz/damping/settle, carry hover + plant window); numbers
beside each; diagnostics strip at 4 Hz including palm-to-shaft, head above
floor, hand NDC, WHICH CAMERA DREW THE TOOL, and a rendered-frame region
pixel-motion row (the two R-F rendered-frame rows). RMB over the game =
look; Exercise replays walk/turn/work against the real key handlers.
Save → src/data/toolFeelOverrides.json via IPC; courseScene merges it over
the defaults at boot. Verified (tools/qa/electron-tool-tuner.js, two
phases): **22/22 sliders live** (post-snap targets, fault 48), the
deliberately-dead slider changed NOTHING, a +0.2 anchor drag moved the
world grip +0.192, Save wrote the dragged values, and a RELAUNCH booted
with exactly the saved values (ships test) — then the QA scribbles were
deleted so they cannot ship as tuning. Panel screenshot:
qa/electron/tool-tuner/panel-over-broom.png.

## B3 — the moving fibres ARE the visible fibres now

Mop: welded MESH_MopSkirt hidden at adopt; the procedural rig sized up to
BE the skirt (26 strands × 3 segments, ~1.5× thicker). Proof in the
player's pixels: hiding the procedural strands now kills the head region's
motion energy (working p90 737 → 32, ≈ still-noise) — the thing that moves
is the thing the eye sees. Broom: first bristles ever — welded
MESH_BroomBristles hidden, a bar-layout rig (22 tufts × 2 rows × 2
segments) hangs from the block with push-broom params (fast chase, low
slack, small splay), riding the head-lag pivot so it fans with the swing.
Screenshot (owner window, default pitch, real equip):
b0-divergence/broom-fresh/01-equipped-default-pitch.png — a visible comb
of individual tufts where the slab was. Hand/shaft gaps re-verified 3/3/3
px after the change.

## B4 — plant authority follows reach: BUILT AND VERIFIED

Work-pose authority fades over a 12 cm ease as the hands sink below the
plant height (broomViewmodel workBlendEff); `planted` follows the
effective blend; and the courseScene cleaning gate — which named the BROOM
alone, the same broom-only family as B0's clobber — now banks unplanted
strokes for the rig-owned pair, so the mop stops cleaning while carried
too. Verified by a dedicated ladder instrument
(tools/qa/electron-b4-plant.js, qa/electron/b4-plant/b4.json, all 8
checks): geomSource 'live' on every rung (null = FAIL); shipped anchor
plants at the kiss (headAboveFloor 0.012, workBlend 1); LEGAL low anchors
(-0.9, -1.5 — hands still above the floor holding a 1.247 yd handle) still
plant, which the instrument's own first run taught it; the scandal case —
hands BELOW the floor (-2.0, -2.4) — now REFUSES (workBlend 0, head riding
the carry hover at 0.54-0.60 yd) where the old rig faked 0.073; shipped
rung sampled first and last agrees (no drift); a real held sweep at full
up-look cleans exactly ZERO (`did: 0` with the gate banking dt) while the
same instrument sees cleaning land at work pitch (positive control).
Instrument fault #50 for the ledger: the ladder's first run failed its own
too-strict thresholds — -0.9/-1.5 are reaches a real handle spans, and the
"failure" was the acceptance bounds, not the rig; the corrected ladder
asserts BOTH halves (legal plants, below-floor refuses).

## B5 — grip and carry tuned through the overlay's own door, values listed

Method: candidate values applied through walk.toolFeelSet (the identical
code path the F9 sliders drive), each iteration screenshotted at
level-carry / work-sweep / mid-turn per tool
(qa/electron/b5-tune/*.png), frames READ, then the landed set saved
through the overlay's ship path into src/data/toolFeelOverrides.json —
committed, so these ARE the shipping values and the file is yours to edit.

Landed values (before → after):
- broom compose.carryHover 0.60 → 0.44 — the B1 "carried level like a
  rifle at chest height" read is gone; at level look the head now dips
  floorward and the shaft angles down (broom-level.png).
- mop compose.bearingOffset −0.20 → −0.34 and compose.gripAnchor.x 0.257 →
  0.30 — the mop stops aiming its butt at the lens; the shaft lies
  diagonally across the lower frame with the hand wrapped on it and strand
  tips entering frame (mop-level.png).
- mop compose.carryHover 0.60 → 0.44 — same lowered carry as the broom.
Everything else measured right at defaults and was left alone; every one
of these is live on an F9 slider if any reads wrong on your monitor.
One property of Save to know: it writes the FULL current table for both
tools (as specced in the plan), so toolFeelOverrides.json pins every value
— delete a key (or the file) to fall back to the code defaults for it.
B0 exit re-check at the tuned values: hand/shaft pixel gaps 3/3/3 px at
rest/walk/turn, all controls green — the tuning moved framing, not the
grip.
After-clips recorded through the same real-input session as the
before-clips (qa/electron/b1/{broom,mop}-after/*.webm, frames extracted
beside them) and WATCHED: at frame t023800 of the broom's clip the tool
rides low and angled with the tufted head dipping floorward and the hand
wrapped on the shaft — against the before-clip's chest-high horizontal
carry at the same beats (t021700/t030100). Same 800×600 recorder as the
before set, stated per R3#8 so the pair is like-for-like.

Exit condition (R-F.7): the B0 real-input instrument re-run at the tuned
values (hand/shaft pixel gaps + controls) — result recorded below when
the chain lands; after-clips of both tools recorded and watched as B1's
counterparts.

## C1/C6 — control never leaves the player: BUILT AND VERIFIED

C1: `enterLedger` keeps POINTER LOCK (the old exitPointerLock was the
"control taken away"); OPEN_SECONDS 0.85 → 0.4; the rise re-solves the
face pose EVERY frame, so turning mid-open brings the book to where you
look now, and the open state's soft-follow already rode the view. Locked
reading gets button paging (LMB next / RMB back — a locked cursor has no
meaningful clientX). C6: page keys read the LIVE moveLeft/moveRight
bindings and stopPropagation actually consumes them; opening mid-strafe
clears held keys (the reviewer's ordering case). Verified on real input
(tools/qa/electron-ledger-turn-cost.js): lock true through the whole
open; held D for 0.9 s → pages turn AND body displacement 0.0000 yd; W
with the book open walks 0.47 yd (movement deliberately stays alive —
the reading that CHANGES the game); ambient control clean.

## A2/C5 — the turn's cost, hunted to this stack's floor (11-run chain)

What the instruments convicted, in order (all in
qa/electron/ledger-turn-cost/ledger-cost.json history + code comment):
paints are 0.3 ms (split across frames: no help — 3 hitch frames instead
of 1); uploads size-independent (half-res leaf: no change); mipmaps off:
no change; shader programGrowth across turns: 0; ambient windows at the
same desk: 18–23 ms worst, ZERO over-33 (room acquitted); direct API
turns identical to key turns (harness acquitted). Verdict: **every frame
carrying canvas uploads pays one fixed ~55 ms ANGLE canvas→texture sync;
same-frame uploads share it.** So the turn is BATCHED back to one
upload frame — one ~55–62 ms beat per turn, this stack's floor — and
the visibility-split that tripled the felt hitches was reverted on its
own evidence. Final acceptance: ≤1 hitch frame per turn (measured 6
over 16 turns, worst 62.2), ambient clean, C1/C6 green. The OPEN splits into two honest numbers: the FIRST open of a session
pays a one-time 270–780 ms beat (first-visibility of the open shell +
compiles + model read — varies run to run), and **every open after it is
clean: worst frame 22.2 ms, ZERO frames over 33 in the final acceptance
run** — the recurring experience meets the bound outright. The goal's
"under 16 ms or explain exactly what stops you" is answered both ways:
reopens effectively make it; the first open and the per-turn beat are
stopped by the sync stall and session warm-up, with the probe chain as
the exhibit. Leaf canvases stay half-res (less CPU paint, motion
hides it) and page textures drop mipmaps (never needed at reading
distance). Instrument faults 51–52 logged: the D-hold that read
"no page turned" from a leaf-in-flight guard, and the focus-throttle
that produced 950 ms phantom frames until bringToFront.

## C2/C3/C4 — the pages, the overlap class, the locks

C3, the class fix: every page canvas now RECORDS the rect of every string
it draws (a fillText wrap installed at canvas creation), and every paint
scans for collisions into an overlap ledger exposed via diagnostics —
the front desk records truncations, the ledger records collisions. On
its FIRST live run it caught two real classes at real content: (1) the
Contents rows collided by ~3.5 px at seven sections (the solved row step
ran tighter than the glyph height — the row font now fits the step); (2)
`ruledRows`' NOTE lines ran into the next row's label by 10.7 px at the
28 px floor (note rows now carry their own budgeted height, and the
separator rule moved below the note it used to cross). Third catch, by
eye on the screenshots: the value column rasterised into the page MESH's
gutter crop ("waiting on the ceili…") — texture-space text clipped at
the UV edge, the reviewer's predicted class — pulled in to −72.
Final sweep: **zero overlaps across all seven sections in the live
build** (qa/electron/ledger-pages/pages.json + section-*.png at the
owner window). Control caveat, stated: the artificial planted-collision
control came back inconclusive (the plant landed on an unscanned
canvas), but the recorder demonstrated it can fail loudly by catching
two real collision classes before its clean sweep — that is the
stronger form of the same evidence.

C4: the ToC padlock right-aligns to the page-number column edge and
centres on its row like a digit (was 6 px off-column with the shackle
poking above the row). No section is locked in tonight's fresh-save
staging, so the realigned glyph ships code-verified with the recorder
armed; a locked-state screenshot is listed under UNCONFIRMED rather than
faked.

C2: paper fibre (130 deterministic laid-lines at whisper alpha) joins
the existing aged-parchment ground; leaf pages at half res and no
mipmaps on page textures (from A2's chain). The Firsts/Restoration
spread screenshot reads as ruled paper with even rows and an aligned
"not yet" column. A full typography pass (ink weights per painter)
remains open and is listed honestly rather than claimed.

main.cjs: display-info and set-resolution now speak PHYSICAL pixels
(`size × scaleFactor`); `fits` compares against the display, not the DIP
work area; a size the display shows but a chromed window cannot hold
applies as borderless-fullscreen instead of throwing; FW_FAKE_DISPLAY
injects a fake display AT the activeDisplay() boundary so the negative
control exercises the shipped comparison. Verification (driver applying 4K
+ asserting content bounds × scale, list screenshot on this 4K machine,
fake-display control) still to run.

## A3 — the speed-up is gone, and the day is measured

The ladder is `[0, 1]`: pause survives (editor, pause menu, prewarm and
two hundred QA drivers freeze with it), and 1x is the only speed a
running world has. The HUD chip is a pause/play toggle; the bound 1/2/3
speed actions are deleted from the bindings table (orphaned rebinds
normalize away); `simSpeedMultipliers` is no longer a speed feature —
it is the day-compression constant (decision 4x the NPC authoring
baseline, which the shop's population NEEDS; locomotion 1) — and
`golferPaceScale` ignores whatever rung a legacy save presents. Saves
carrying old rungs are clamped at the deserializer door with a repair
note. The pace test that pinned "fast-forward moves bodies" now pins
the opposite contract: no rung moves a body, ever.

Measured live (tools/qa/electron-a3-speed.js, all checks green):
**0.1333 game-minutes per real second → a full calendar day is 180.0
real minutes and the 6:00→20:00 trading window is 105.0 real minutes.**
Pressing the old '2'/'3' keys changes nothing while the clock keeps
advancing (the pause key is the probe's positive control: Space stops
the clock to 0.000 drift); a save planted with speedRung 4 reloads at 1
through a real save→reload→Continue cycle. QA drivers that used
fast-forward to REACH states (golf-gameplay-normal.cjs and five others
named in PLAN_16 A3) and the four whose PURPOSE was the ladder are
retire-or-reseed work listed under NOT DONE for tonight — the product
and its tests carry the deletion.

## D1 — the list reads the monitor, verified where the player touches it

What the display reports vs what the list shows, on this machine: the
display reports **3840×2160 physical at scaleFactor 1.5**, and the list
now shows 1440p and 4K as fitting — with 4K flagged borderless (a
chromed window cannot hold it) and APPLYING as borderless-fullscreen at
exactly 3840×2160. A 2560×1440 windowed apply lands at 2562×1442 — the
DIP grid at scale 1.5 quantizes to 1.5-px steps, so ±3 px is
exact-as-physically-possible and the bound says so. The negative control
runs the SHIPPED comparison against a faked 1600×900 display (delivered
by marker file after argv and env both failed to cross the QA launcher)
and correctly refuses 1080p/1440p/4K while accepting 720p and native.
Faults 53–54 for the ledger: the control's fake made the apply leg THROW
by design, which crashed the driver before it wrote its JSON — three
"control failed" readings were the previous run's stale file; and the
launcher's env/argv channels silently do not reach Electron main on this
stack (the marker file is the channel that cannot be stripped).

## D3 — the controls display reads the live bindings

The pause menu's Controls page rendered hardcoded key literals; it now
builds every keycap from the bindings table at show time (rebind strafe
to J and the Walk row says J, no reload), keeps the non-bindable rows
(mouse, Space, Esc) written out, and the dead 1/2/3 speed row is gone
with A3's ladder.

## D2 — the settings surface in ten languages, honestly counted

Every offered locale now carries a full table: **117/117 keys in en, es,
fr, de, pt-BR, ru, zh-Hans, ja, ko and tr**, verified by the coverage
instrument per locale and pinned by the updated i18n tests (the old tests
pinned the empty-table world and were rewritten to the new contract:
every locale full, translated locales draw their own words, missing lines
still fall through to English and never to a raw key). On-screen proof:
the existing language driver passes with its English negative control,
and the tofu check is a read frame — qa/electron/d2-tofu/settings-*.png
shows the zh-Hans page rendering real glyphs in a correct layout (视角 /
按键 / 辅助功能 tabs, natural copy throughout), no box-tofu; ja/ko/ru
frames captured beside it. The honest denominators, stated as the plan
demands: these 117 keys are the SETTINGS SURFACE — roughly 1,500
player-facing strings elsewhere in the game remain unrouted English, so
"the game is translated" is NOT the claim; and the translations are
model-authored pending native review. The screenshot also caught a
wiring gap the coverage number could not: the reset FOOTER button was a
hardcoded literal beside a translated description — two new keys
(reset.footerButton, reset.confirm) now route it in all ten languages.
The em-dash linter flagged my de/pt/ru/zh strings and each was re-set in
locale-correct punctuation (en-dash for the Latin/Cyrillic scripts, a
colon for the Chinese full-width dash) rather than exempted.

## D4/D5 — committed 14c5523 (scroll owner + spacing), all checks green

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
