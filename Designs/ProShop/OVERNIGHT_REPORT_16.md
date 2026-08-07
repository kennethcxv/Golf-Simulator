# OVERNIGHT REPORT 16 — IN PROGRESS (working draft; finalized at night's end)

Phases: PLAN (done — PLAN_16.md), ADVERSARIAL REVIEW (done — 97 objections,
all answered in PLAN_16.md's Phase 2 section, remedies R-A…R-M), IMPLEMENT
(running), VERIFY (pending). This file accumulates verified findings as they
land so nothing depends on session memory. Claims here carry their evidence
path.

## Try this first — the owner's five minutes

1. **Mop at the till.** Grab the mop (hold F indoors, press 3, Enter), mop a
   patch — the head plants when you reach the floor and hovers when you
   can't — then walk to the till still holding it, look down like you're
   working, and press E. You're the cashier, no map, no dead prompt. Escape
   steps away and the mop is back in your hands.
2. **The wheel clicks now.** Every digit press in the tool wheel ticks; so
   does the laptop's nav rail, and every button everywhere else. Walk
   outside and listen to your own footsteps change when you step off the
   boards onto turf — then stop, and they stop.
3. **The ledger speaks like a book.** E on the club ledger: clasp, cover,
   the leaves. A and D turn pages (they never strafe the character), E
   closes it. You never lose the mouse.
4. **Sell something and watch the bag.** A customer at the counter: click a
   good and it slides ACROSS the counter INTO the carrier's mouth and is
   swallowed at full size — no shrinking toy. Cash lands ON the desk in
   real notes (a $35.31 basket arrives as two twenties, never
   ninety-six-cents counted out), the customer's arm comes BACK once the
   money is down, and they stand right of the bag where you can see them.
5. **The floor breathes with your standing.** Run the shop well and cheap
   and the room fills toward five; neglect it and price-gouge and it
   empties — same building, same cap.

## DISPROVEN CLAIMS (Phase 4 verifiers write this section FIRST)

_Pending: filled by the three game-only verifiers at night's end. Anything
they break moves from its section to NOT DONE, and the broken claim is
named here, at the top, before everything else._

## NOT DONE / UNCONFIRMED (running list; finalized at night's end)

- **F8 steps 2-3 — the single combined payment** (green-fee line into the
  open retail tx, one tender): NOT DONE, stopping point named in the F8
  section.
- **A3's ten QA fast-forward drivers**: retire/reseed logged in the A3
  section; not converted tonight.
- **First-load +5.1 s vs both baselines**: measured and attributed to the
  span's streamed content (A1 addendum); the per-commit bisection inside
  8baa596→HEAD, and moving the late streams behind the veil, are the named
  follow-ups.
- **Vacuum/dustpan legacy stroke clobber**: same defect class as the mop's
  B0 item, logged and deliberately NOT fixed (B6 says leave the other
  seven tools alone).
- **GL sampler-mismatch warnings**: lead logged in the C section, not
  chased.
- **C2 full typography pass**: paper/ink direction landed; the full pass
  is future work.
- **C4 locked-state screenshot**: the lock geometry landed and is pinned by
  the recorder; a dedicated locked-state player-camera shot was not taken.
- **The door sign's real-E press**: cue name proven resolving; the physical
  press lands in the stranger verifier's walk.
- **Register glass / canvas-on-mesh text surfaces**: no overlap recorder
  exists for them (F2 section lists every covered surface); UNCONFIRMED.
- **F6 card-held hand-position variance**: verified as pose-mode constancy
  + screenshot, not as a yd-variance measurement.

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

## G — the torso is one piece and the face sits on the skull: BUILT AND VERIFIED

**G1 (the pumping stomach).** The old vertical law moved the chest by the
full walk bob, the pelvis by 0.7x of it, and left the belt/buckle planted:
up to 2 cm of relative slide at the waist every stride, which reads as the
shirt detaching from the trousers and the stomach pumping. characterAsset.js
now applies ONE law: pelvis, belt, buckle and buckle tongue all carry `+ bob`
exactly as the chest does.

**G2 (the floating brows and moustache).** The brows sat at head-local
z 0.145 and the moustache bar at z 0.150 against a skull of radius 0.155
centred at z 0.054 — but the features sit at x ±0.058 / y −0.088, where the
sphere's surface is much closer than its equator. Both now seat by the full
radial solve (rear face pressed to the sphere along the feature's own radial):
brow z 0.139, mouth z 0.133.

**Instrument** (tools/qa/electron-g-characters.js): four customers built from
four seeds on the real shop floor, stepped through 120 REAL update() frames.
G1 metric: spread (max−min) of belt-vs-chest and pelvis-vs-chest vertical
offsets across the stride — a single law shows 0, relative slide shows the
slide. Negative control: the old static-belt law reintroduced runtime-only
for 40 frames must light the same metric. G2 metric: radial distance of each
feature's rear face from the skull centre minus the radius, computed in the
head group's own space (features are direct children; for a SphereGeometry
skull the analytic surface IS the mesh; local space makes it scale-proof
across the 0.87–0.99 per-seed root scales). Acceptance ≤ 2.5 mm proud and
≥ −6 mm pressed, ≥ 8 features across the seeds.

**Build-level negative control:** the same driver ran against the OLD
characterAsset (product edit stash-swapped out) and went red on both fronts
— exactly the failures the goal describes, measured:

| | before (old build) | after (fix) |
| --- | --- | --- |
| lockstep spread belt-vs-chest / pelvis-vs-chest | red (differential present) | **0.00000 / 0.00000** |
| runtime-reintroduction control sees differential | yes (0.0399) | yes (0.03994) |
| brow rear-face radial gap | **+14.2 mm proud** (all 8) | **−0.9 mm** (all 8) |
| moustache-bar rear-face radial gap | **+19.7 mm proud** (all 4) | **+0.3 mm** (all 4) |
| page errors | 0 | 0 |

**Player-camera evidence** (qa/electron/g-characters/{before,after}/):
`four-faces.png` (the row face-on), `close-face.png` (conversational
distance), and `profile-face.png` — the pair that actually shows it. The
float is along the face normal, so a face-on camera cannot see it by
construction (the first face-on pair looked identical; fault 56). In the
BEFORE profile the moustache bar hangs clear of the chin with wall visible
between bar and face and the brow disc rides off the forehead silhouette;
in the AFTER profile both sit on the head. Screenshots are Electron
player-camera frames at owner resolution with the HUD live.

## E — every button clicks, and the world has physical sounds: BUILT AND VERIFIED

**E1 (clicks everywhere).** The click cue now rides POINTERDOWN at the button
factory itself (`ui.js el()` — where nearly all player-facing buttons are
born), with a sink in main.js that excludes the laptop subtree (its own
dispatcher ticks centrally) and a delegated document fallback for buttons
born outside the factory. uiTick gained a 120 ms press-window so surfaces
that still fire their own tick on click never double-speak. The unknown-cue
QA warning ships in the sfx router (main.js): an unmapped cue name is
console-warned once and listed on `window.__fwUnknownCues`.

Real E1 gaps the instrument caught and the build closed:
- the TOOL WHEEL's digit and shortcut activations were silent (arrows,
  scroll and hover all ticked; a digit press waited ~57 ms for the equip
  sound) — both now tick at the press;
- the LAPTOP NAV RAIL (its most-used buttons) called `go()` straight and
  never clicked — the rail and the Close button now run the laptop's own
  `click()` dispatcher; `go()` itself stays silent so programmatic jumps
  (aliases, search) never ghost-tick.

**E2 (physical sounds).** Eight new procedural voices in the house idiom
(layered, `varied()` pitch, no two alike): `footstep(surface, intensity)`
(boards knock in a tight woody band, turf presses low with a grass hiss),
`stationEnter`/`stationLeave` (cloth and one knuckle on the counter / the
same cloth leaving), `signFlip` (two card flaps and a small swing),
`ledgerOpen`/`ledgerTurn`/`ledgerClose` (clasp + cover thud + heavy leaves —
the ledger no longer speaks in menu ticks), `keypadTap` (plastic under a
finger, duller than the interface tick). The register terminal keys, the
door sign, the station enter/leave and the ledger keys all route through
them.

**Footsteps are driven by the gait itself:** the bob phase advance MOVED
out of the held-tool viewmodel (where an early return froze it whenever no
tool was drawn — the bare-handed player had no gait signal and no camera
bob at all) into the walk update; a footfall fires at each sin minimum,
gated by real displacement (0.22 yd per stride; a frame that jumps more
than any legal step CLEARS the gate — teleports are not strides — and
standing still >0.35 s forfeits stride credit, so credit can never carry
across a staging warp).

**Instrument** (tools/qa/electron-e-audio.js, per R-G): everything is proven
at the MASTER BUS through `audio.qaMasterTap()` (a 2048-bin analyser on the
same post-volume node the capture instrument reads — ≈42 ms of history per
read, so a short burst cannot die by polling luck), never at a dispatch
counter alone. Depth = one real press per surface: silence-wait against the
measured ambient bed, press, then the first sample ≥ bed + 0.0018 within
the surface's window (50 ms ticks / 80 ms physical gestures and
click-activated controls / 200 ms across the tool-equip stall), AND the
wrapped cue counter must have fired. Stochastic rows (noise bursts against
a live bed) take up to three real presses — every press must dispatch; one
audible crossing proves the row; dispatch failure is terminal.

**Run 17 (all 14 checks green; run 18 confirmed — two consecutive full-green runs, the ledger turn at 25.9 ms on its first press):**

| check | number |
| --- | --- |
| pause-nav Settings | 23.7 ms, cue fired |
| settings tab | 12.3 ms |
| HUD clock chip | 21.4 ms |
| tool-wheel digit | 47.7 ms (across the ~55 ms equip stall) |
| laptop nav | 11.5 ms through the laptop's own dispatcher |
| NEGATIVE: pause status text | zero cue dispatched, bus flat (0.0022 bed) |
| breadth (pointerdown-only, never click) | pause-nav 7/7, pause page 1/1, settings 74/74 across six tabs, HUD 3/3, wheel 9/9, laptop 16/16 — 100% wired everywhere |
| footsteps turf | 6 cues vs 5.54 expected from the 8.7 rad/s stride over 4 s; zone agreement 6/6; median cue-to-camera-trough offset 5.1 ms |
| footsteps boards | 3 cues vs 3.46 expected over 2.5 s; agreement 3/3; median offset 16.3 ms |
| wall push (negative) | pinned at 0.10 yd with the bob pumping: ZERO cues |
| ledger open/turn/close | 9.4 / 30.4 / 57.6 ms, each with its own cue counted once |
| voices vs family reference (paper() = 0.0133) | signFlip 0.0120, stationEnter 0.0155, stationLeave 0.0125, keypadTap 0.0122 |
| unknown-cue control | bogus name listed + warned once; real name never listed |
| AV capture medley | 132/132 non-silent windows, peak 0.0128, 6.6 s |

**What the instrument taught (the run-8→11 physics):** there is no "pause
duck" on the click channel — `applyVolume` ducks ambience ×0.18 and sfx
×0.35 while paused but NEVER uiBus. The naked uiTick is ~0.005 at the bus;
every louder ״tick״ reading was ambient-plus-cue superposition. A cue rides
ON the bed, it does not multiply it — multiplicative floors (bed × k) are
unmeetable by construction outdoors, and the honest detector is ADDITIVE
(bed + Δ, Δ=0.0018 under the naked cue's own level). Likewise the footfall
reference: the camera's own bob minima, detrended by a HALF-period boxcar
at the MEASURED sample spacing (the uncapped window samples rAF at ~180 Hz;
an assumed 16.7 ms crushed the signal, and a full-period window nulls the
sine outright), matched per cue rather than census-then-match.

**Stated limits:** stationEnter/stationLeave and keypadTap are proven as
voices through the game's own cue router plus their wiring sites in code;
their in-world trigger moments (entering the till, terminal digits) are
exercised by the F-section drivers where those modes actually run, and the
door sign's real E press is left to the stranger pass — the cue NAME is
proven resolving (unknown-cue list stays empty when it fires). The turf
count check leans on the stride-rate expectation because terrain slope
drowns an 18 mm camera bob outdoors; the boards leg carries the timing
proof on a flat slab.

## F1 — Q + register goes straight to the cashier: BUILT AND VERIFIED

A work station in reach now OUTRANKS the equipped tool's prompt.
`walkStationPropInReach()` (courseScene) checks station-flagged props (the
till, clubhouse.js:1880, and the ledger desk) inside their own radius with
a deliberately wide cone — anything not directly behind you, because a
player arrives at a counter looking DOWN at the floor they were mopping —
and wins the focus before the tool label blocks return. The fourth route
(interact falling through to the course editor from the overview handler)
is guarded: E at an open station never opens the drafting table.

**Driver** (tools/qa/electron-f1-station.js, all real input): the mop is
equipped through the player's own door — INSIDE the shop (the wheel only
offers the cleaning kit indoors; at spawn it lists course tools — washer /
hose / divot / rake), hold-F, digit 3 ("3 M Mop"), Enter. All four routes
then open the cashier and never the editor:

| route | result |
| --- | --- |
| mop out, mopping pitch (-0.55) at the till | register opens, body enters register-mode |
| extreme down-pitch (-1.2) | opens |
| aim above the counter (the dead hose-focus state) | opens |
| E AGAIN with the register open | register stays, courseMode never becomes 'editor' |
| NEGATIVE: E in open floor with the mop out | nothing opens, nothing fires |
| NEGATIVE: station scan 8 yd away | stationInReach() is null — the priority is scoped to the radius |

Route screenshots under qa/electron/f1-station/. The first run of this
driver also caught two of its own faults (fault 64).

## F4 — cash arrives in realistic denominations: AUDITED, FIXED, RE-AUDITED

The plan said audit-first, and the audit reproduced the complaint exactly:
over 400 seeded sales at mixed totals, **135/400 tenders (33.8%) carried
sub-quarter coins** — a fifty, a ten, two dimes and a penny for a $60.21
due — because customerCash's 35% dig-for-coins branch paid ANY odd cents.
The fix scopes the gesture to LARGE coins: the customer digs only when the
odd cents are a clean quarter multiple. Re-audit on the same seed:
**0/400 sub-quarter tenders; 396 clean note steps; the 4 odd-coin tenders
are exactly the intended gesture** ($80.25 = notes + one quarter, $150.50 =
three fifties + a half-dollar). Fixtures: $35.31 due tenders $40 as two
twenties whichever branch rolls; $29.96 tenders a twenty and a ten; a round
$20.00 presents exactly one $20 note in both branches (the negative
control). Instrument: tools/qa/f4-cash-audit.mjs (seeded, deterministic;
its own first run caught itself scanning nothing — netOf counts SCANNED
items only — and printed empty tenders rather than a false pass). The
desk-mesh half (drawn notes/coins equal the tender) rides the combined
checkout driver.

## F5 — customer and cash stand right of the bag: BUILT (probe pending)

The winning move was the CUSTOMER, not the bag: the v2 queue head moves
0.22 yd east (local -0.48 → -0.26; world 2.82 → 3.04) to stand nearly
opposite the cashier, the line pitch shortens 0.80 → 0.69 so slot 2 lands
back on the exact member_station clearance the old line proved out
(world 4.42 unchanged), the customer's laid tender moves right (-0.55 →
-0.38, still clear of the change pile at -0.23), the presented-cash clamp's
left bound comes off the bag strip (-0.70 → -0.48; the mouth ends at
-0.82), and the paying customer now FACES THE CASHIER's own stand
(COUNTER.staffStand) instead of the register-block datum out by the bag —
they address the person, not the carrier. tests/pine-hills-v2-layout.test.js
re-pinned to the new head with the ruling recorded; checkout-space and the
full layout suite green. The cashier-pose pixel fractions (face + tender
visible over the whole payment) ride the combined checkout driver.

## F7 — concurrency scaled by standing: CAPS RAISED (seed runs pending)

The formula was always there (drive = reputation 0.55 + cleanliness 0.20 +
rating 0.25, price-factored, clamped 0.55-1.35) — the TIER CAP pinned it:
a starter floor held 2, so every standing produced the same crowd. Ceilings
now: starter 2 → **5**, standard 4 → **8**, premium 6 → **10**, luxury 8 →
**12** (drive then spans ≈3-7 customers at starter instead of pinning),
with the tier unlock copy updated and shop-progression tests re-pinned.
The queue holds 3 line slots + the 9-point overflow sunflower = 12
positions, matching the luxury cap.

**Driver results** (electron-f7-concurrency.js, sign opened through the
sim's own flipSign, three standings seeded smallest-first — at 1x a crowd
GROWS on arrivals alone but takes many sim-minutes to drain, so the seeds
run poor → mid → rich and each window only ever fills; judged from
sim-minute 5 of 10):

| standing | drive | peak on floor | mean | target tracked |
| --- | --- | --- | --- | --- |
| neglected-expensive (reputation cats 25, fee 2x fair) | 0.096 | **1** | 1.0 | within one at every sample |
| as-found (cats 55, fair fee) | 0.508 | **3** | 3.0 | within one |
| well-run-cheap (cats 90, fee 0.6x fair) | 0.916 | **5** | 5.0 | within one |

Same building, same starter cap of five — the room breathes with the
standing, exactly the goal's ask. Peak screenshots per seed under
qa/electron/f7-concurrency/; the drive term that moved is recorded beside
every sample (reputation + price moved, cleanliness deliberately held).
The old ceiling of 2 could never have shown the 1-vs-3-vs-5 spread.

**F7 status: BUILT AND VERIFIED.**

## F8 — nobody leaves with unpaid goods: THE ESCAPE IS CLOSED (one-payment merge NOT DONE)

The 2026-08-06 order ruling had already built the right rail — a combined
visitor SHOPS FIRST and the desk business is held back
(`deskErrandPending`) until the goods are paid, raised at the paid-sale
site by `beginPendingDesk()`. What survived of the goal's bug was the
CLASSIFIER: `openWalkInCustomer()` never looked at the cart, so a combined
visitor arriving at the counter HOLDING GOODS was still stolen into desk
business ahead of the cart branch — and both desk outcomes (booked or
rejected) release desk customers to the door, silently restocking the cart
as a lost sale on the way out. The fix is the goal's own step 1:
`openWalkInCustomer` additionally requires an EMPTY cart. Step 4 ships
with it: the exit net now recognises the escape class (a combined visitor
reaching the door with items after a desk outcome) and shouts —
`[F8-INVARIANT]` on the console and `window.__f8Violations` for drivers —
while still healing the world.

**Driver** (tools/qa/electron-f8-escape.js, first run green on all five):

| leg | result |
| --- | --- |
| ESCAPE (legacy classifier reintroduced runtime-only via `__f8LegacyClassifier` — the ledgerTurnLegacy pattern) | the staged combined visitor reached the counter holding 2 items and was classified `walk-in-waiting` — desk business with unpaid goods, photographed (escape-legacy-counter.png) |
| the invariant at their exit | 1 violation counted, the console line fired, the goods restocked |
| FIXED build, same staging | the same visitor stays a SHOPPER at the counter (cart 4, `deskErrandPending` still armed for the post-payment ask), zero violations |
| NEGATIVE: a pure desk walk-in (no goods) | still classifies as desk business immediately — the gate is scoped to held goods |

**NOT DONE — the single combined payment (goal steps 2-3).** Items and the
green fee remain two transactions: the shipped rail pays retail first,
then `beginPendingDesk` raises the tee-time ask and the fee settles
through the reservation payment path. Folding the fee INTO the open retail
tx (a `service:green-fee` LINE carrying the check-in tx's no-sales-tax
flag and its greenFees revenue key, one tender covering both) touches the
register's transaction model — tax split, revenue split, and the
receiptless finalize fork — exactly the 2.5-3 h seam the plan priced and
named first NOT-REACHED candidate. The stopping point is precise:
`bookWalkIn` still calls `beginReservationPayment` unconditionally; the
append-a-line variant plus the two split rules in sim/register.js is the
whole remaining change, designed in PLAN_16.md F8.

## F3 — items go INTO the bag at full size: BUILT AND VERIFIED

The carrier gained a depth-only interior shell (`BagInteriorOccluder`:
colorWrite off, depth written before the goods draw) and both motion paths
lost their shrink: a rung-up good slides across the counter THROUGH the
authored mouth and on inside along the mouth's own axis, swallowed because
the bag is around it. Nothing is miniaturized — the packed item is parented
into the carrier at FULL SCALE, hidden; the resume path restores the same
way, and the fulfillment contracts are re-pinned to the new invariant.

**Instrument** (electron-f-checkout.js over a staged real sale — a spawned
cash customer walks in, places goods, the player enters with real E through
the F1 door, and a real click rings the item): flat-paint pixel census per
frame beside a per-frame projected-bbox tracker.

| measure | fixed build | occluder-hidden CONTROL |
| --- | --- | --- |
| painted pixels across the slide | 10,063 → 0 by the mouth | 38,350 → settles at 1,045 and STAYS (the item sits visible in the mouth) |
| projected bbox height over the whole track | 147.0 → 148.4 px (±0.5%) | — |
| final state | visible=false, checkoutVisualState packed-in-bag, scale untouched | — |

The bbox steadiness IS the anti-shrink signature, and the BEFORE control
ran it against the pre-F3 register module (the E-commit's file, swapped in
for one boot and restored): the old build packs the item **visible at 0.38
scale** — a miniature keepsake sitting in the carrier at 1,045 painted
pixels forever, its projected height collapsed to **90.2 px against the
fixed build's steady 147–148 px** at the same camera. Old: a toy in the
bag. New: the real thing, swallowed. The occluder control proves the
occluder is what ends visibility: hide the shell and the same slide keeps
its pixels.

**F4's drawn half closed on the same run:** with the presented-channel
filter, ancestor-walk root counting, and the unseen click PAD excluded,
the desk meshes equal the tender exactly — **{50:1, 10:1} drawn for
{50:1, 10:1} tendered**, and no sub-quarter coin exists to draw. F4 is
sim-audited AND pixel-backed end to end.

## F5 — customer and cash visible from the cashier's frame: VERIFIED

From the working camera during a live cash wait, flat-paint censuses
sampled through the payment: the customer's head at **16,449 px minimum
against a 16,449 px bag-hidden baseline — 100% of the head stays visible
with the carrier shown** — and the laid tender at **53,453 px minimum**
(the notes are unmissable). The layout move behind the numbers is in the
F5 build section above.

## F6 — cash laid down, card held out: BUILT AND VERIFIED

The pose map splits the payment into the goal's two beats, and the
flow-tagged pose trail (sampled at 250 ms with the register's own flow
state beside each entry) shows exactly the intended gesture:

- **cash**: `Idle@ProductScanned → Present@CashPresented ×4 (the ~1 s reach
  while the tender lands) → CashLaid@CashPresented` for the rest of the
  wait — the arm comes back and the customer stands settled while the
  notes rest on the desk.
- **card** (its own staged run, f-card.json): `Idle → Present@CardPresented
  → Present@CardInsertReady ×9+` — the card NEVER leaves the held-out
  hand until taken. Screenshot f6-card-held.png.

The arm-region pixel-diff between the two cash beats is visible in the F5
sample series (same run, same frames); the numeric hand-variance
measurement is listed under NOT DONE as approximated by pose-mode
constancy.

## F2 — the tee-time overlap, then every screen: BUILT AND VERIFIED

The arithmetic bug was in source (the check-in note's baseline at y 502
INSIDE a button row starting at y 500); the note now owns the 482-500 band
and the grid starts at 512 with the same 616 bottom line. The monitor
gained the C3-pattern rect recorder: while `window.__monitorRectAudit` is
on, every drawn string and button leaves its rect and a scan pairs any two
that intersect (exemption stated first: a button's own centred label).

**Sweep** (electron-f2-sweep.js, real clicks at `monitorScreenPoint`
projections): a due-now reservation seeded through the sim's own
`bookReservation` carrying a 90-character note — the goal's case — plus a
live walk-in ask. All six screens drawn and audited: home, checkout,
check-in, the reservation DETAIL (screenshot
tee-time-detail-after.png: the note in its band, the action button clear
below), the walk-in detail, and the tee sheet. **MONITOR_OVERLAPS: empty
across all of them.** The planted control (two self-pairing strings laid
across the grid) was caught — 2 recorded pairs — before the clean sweep
was believed.

**DOM sweep** (same run): pause, all six settings pages, and the laptop's
first page audited for intersecting text leaves with the declared
exemptions (ancestor/descendant; invisible; borders may kiss; and rects
CLAMPED to overflow-clipping ancestors — the first pass flagged a keycap
whose layout rect ran under the pause footer while every drawn pixel was
clipped away, the false-positive class the clamp exemption names).
**Zero hits on every surface.**

**Surfaces and their recorders (the enumeration R-H requires):** ledger
book — its own C3 recorder (LEDGER_OVERLAPS, planted-control proven);
front-desk/register monitor — MONITOR_OVERLAPS (this section); DOM
(pause, settings, laptop, HUD text) — the clip-clamped leaf audit.
UNCONFIRMED, no recorder exists: the card terminal's small canvas glyphs
and transient toasts. Listed, not silently skipped.

## A1 addendum — the FIRST LOAD, measured on three builds

The fixed-pose probes called steady-state flat; the first-load instrument
(electron-first-load.js — segments to playable, then the first ten seconds
of play, with a content assertion and an injected-stall control) ran on
HEAD and both baseline worktrees. The numbers, same machine, same scene
(content fractions 0.877 / 0.899 / 0.878):

| | pre-tools 8baa596 | pre-ledger 65ce987 | HEAD tonight |
| --- | --- | --- | --- |
| page → menu ready | 529 ms | 520 ms | 844 ms |
| menu click → walk active | 639 ms | 624 ms | 1106 ms |
| walk active → veil gone | 2206 ms | 2209 ms | 3944 ms |
| **page → playable** | **7.8 s** | **7.8 s** | **12.9 s** |
| first-10-s worst frame | 25.8 ms | 22.3 ms | 40 ms |
| frames ≥ 33 ms / ≥ 100 ms | 0 / 0 | 0 / 0 | 9 / 0 |
| median frame | 11 ms | 11 ms | 17 ms |
| shader programs | 207 flat | 207 flat | 209 flat |
| triangles over the ten seconds | 5.09 M static | 5.11 M static | **5.08 M → 6.36 M** (+358 draw calls) |

**Finding, stated plainly: HEAD loads 5.1 s slower (+65%) and its first ten
seconds are rougher (9 dropped-frame-class hitches vs zero, median +6 ms)
than BOTH baselines — which agree with each other to within 70 ms.** The
attribution the numbers support: programs are flat on every build (not
shader compiles — the A1 stall-class conclusion holds), while HEAD alone
STREAMS ~1.3 million triangles of content into the scene during the first
ten seconds that the baselines never had. The regression is the added
world of the 8baa596→HEAD span (strand rigs, retail deltas, tonight's
additions included) arriving late rather than before the veil lifts. No
≥100 ms hitch exists on any build; the injected 120 ms control was counted
by the same instrument on each. Per-commit bisection of the +5.1 s is
named in NOT DONE.

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
47. `sharp` was required mid-driver after an earlier use of the same name
    — TDZ crash that a stale JSON read then masked. Declarations via
    createRequire live at the top of a driver, before any awaits.
48. Range inputs snap assigned values to their step grid; twelve tuner
    sliders "failed" against raw float targets. Compare against the
    post-assignment input.value, and snapshot the dead-control check
    immediately before its own dispatch.
49. (process) Two commits rode a red em-dash linter: the first because the
    suite tail swallowed the fail line, the second because `grep` exiting 0
    on the text "# fail 1" satisfied the `&&` chain. Never gate a commit on
    grepping pass/fail prose; gate on the runner's exit code.
50. The B4 reach ladder's own thresholds were wrong: its −0.9/−1.5 anchors
    are LEGAL reaches (hands above the floor with a 1.247 yd handle must
    plant), and an up-look returns `{did:0}`, not null. The instrument was
    failing correct behaviour; the fix was to the instrument.
51. C6's held-D leg pressed during the ledger's 0.4 s 'opening' phase, which
    turnPage refuses by design; the driver read it as a broken key. Wait for
    state === 'open' before judging turn keys.
52. With the Electron window unfocused, rAF throttles to ~1 fps and every
    timing read shows ~950 ms phantom frames. page.bringToFront() before any
    frame-cost measurement.
53. The D1 fake-display control run THREW inside the apply legs, died before
    writing its JSON, and three "control failed" readings were a stale file
    from the previous run. Control modes must skip the legs they cannot
    perform, and drivers must write their JSON even on early exit.
54. Neither env nor argv crosses Playwright's electron.launch into the main
    process on this stack; the D1 fake display reached main.cjs only via a
    marker file beside it (fw-fake-display.txt).
55. G2's first seat instrument raycast from each feature toward the skull
    centre — from INSIDE the sphere for the moustache bar, so the ray exited
    the far side and returned null ("cannot measure" read as a feature
    fault). Replaced with the head-local radial-distance solve, which is
    mesh-true for a SphereGeometry skull and scale-proof per seed.
56. The G2 evidence camera missed twice: the first pair shot the stage from
    an assumed yaw (a window, no subjects in frame), and the second was
    face-on, where a float along the face normal is invisible by
    construction — both frames looked identical while 14–20 mm of float was
    present. Forward is (−sin yaw, −cos yaw) per mouseLook's YXZ order, and
    displacement must be shot perpendicular to its axis: the profile shows
    it as a silhouette gap.
57. Keyboard presses never stamped the press mark — the ledger turn measured
    6.5 SECONDS from a stale mouse click. Presses are presses: a
    window-capture keydown listener (registered before the ledger handler
    exists, so its stopPropagation cannot eat it) stamps the same clock.
58. A moving-average detrend of width equal to the bob period NULLS the
    sine entirely (a centered boxcar's gain is sinc(pi W/T)); the boards
    "minima" it left were noise. Width T/2 keeps 64% with phase intact.
59. The uncapped Electron window samples rAF at ~180 Hz; an assumed
    16.7 ms/sample made an 11-sample half-window span 60 ms and crushed a
    36 mm bob to an 8 mm residual. Sample spacing is MEASURED now.
60. There is no pause duck on the click channel — uiBus never ducks; the
    "ducked tick" was superposition (tick ~0.005 riding a 0.015 outdoor
    bed). Multiplicative floors are unmeetable by construction; cue
    detection over a bed is ADDITIVE (bed + delta).
61. A retry that reopened the ledger INSIDE the measured act slept past
    the 420 ms poller — the row read zero samples while the cue counter
    said the close fired three times. Stage mutations belong OUTSIDE the
    measurement window.
62. Under pointer lock the wheel's mouse click lands on the CANVAS (the
    wheel is keyboard-driven there by design); the click's "pass" in an
    early run was the equipped hands swinging — a false green the cue
    counter killed. Real-input instruments must drive each surface by the
    input mode the player actually has in that state.
63. The B4/G stash-swap pattern reused for E's before states does not
    compose with live Electron edits: a run launched while product files
    were mid-edit loaded a half-written courseScene and every evaluate hung
    (the 20-minute silent run). Launch drivers only from a settled tree.
64. The F1 driver's first run had two faults of its own: it opened the tool
    wheel at SPAWN, where the wheel legitimately offers course tools only
    (washer/hose/divot/rake — the cleaning kit is an indoors offer), and it
    left the wheel OPEN through every route, where the wheel is modal and
    eats the interact key — all four routes read "register never opened"
    while the till prompt sat right there in the frame. Equip indoors,
    close the wheel, verify the modal class is gone.
65. `sendToCounter` returns the customer's display NAME, not the entity —
    two checkout-driver runs died dereferencing a string (`itemMeshes.get`
    on run 2, `cart.length` on run 3) before clubhouse gained the
    read-only `customerByName()` handle.
66. The pose trail installed AFTER the control ring's node-side pixel
    counting (~3.5 s of sharp work per 8-frame capture) and woke to a
    tender already landed and aged — every sample read the settled beat.
    Samplers start BEFORE the action whose onset they claim to witness,
    and each entry carries the flow state so beats are judged against the
    flow, not wall time.
67. A bill GLB carries the money flag on its sub-meshes and nests
    unflagged intermediate nodes, so the drawn-tender census counted every
    note two and three times ({10:3, 50:2} for a fifty-and-a-ten), and a
    direct-parent root test still double-counted — the root test walks
    EVERY ancestor. The unfiltered first pass also matched the whole
    drawer float and passed trivially: a filter that cannot name its
    channel ('tender' vs 'drawer') is not a filter.
68. (process) A patch script written against the wrong belief about which
    round had applied crashed mid-file on a stale anchor, leaving a mixed
    state — and its first delivery attempt had already died to the >20 kB
    bash-heredoc truncation trap this session documented earlier. Patch
    scripts go through Write-tool files, and every anchor is grepped
    against the LIVE file before the script runs.
69. The before-control's collapse-ratio formula read only the last 40
    track samples — all post-pack steady-state — and reported "no
    collapse" over a run whose endpoint facts (visible at 0.38 scale,
    90.2 px against 147) were the collapse. Ratios computed over a window
    must PROVE the window contains the transition; endpoints against the
    other build's steady state are the safer comparison.
70. Every monitor tab "click" of the first two sweep runs silently missed
    the window: `monitorActionPoint` speaks MONITOR-CANVAS coordinates and
    the driver fed them to the mouse as client pixels — the monitor drew
    'home' once and the whole "clean sweep" covered one screen. The audit
    telemetry counters (MONITOR_AUDIT_STATS.draws/lastScreen) exposed it in
    one probe; `monitorScreenPoint` is the client-pixel projection. A
    sweep must prove its surfaces were ENTERED, not only that its recorder
    stayed quiet.
71. `bookReservation` rejects minutes off the tee-sheet grid ("Not a tee
    time on the sheet") — the due-now seeding failed silently until the
    probe tried four leads. Sim seeding APIs validate; drivers read the
    reason, not just the boolean.
