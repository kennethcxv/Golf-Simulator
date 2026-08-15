FULL GOAL 24 CONTINUATION — GPT‑5.6 SOL EXECUTION BRIEF

Read this entire file, then execute it in full. Every requirement is an instruction. Do not stop to ask questions. Inspect the repository and resolve ambiguity toward the interpretation that changes the player-visible game.

You are continuing work after another coding agent ran out of tokens. Some work is committed, some is only partially verified, and the final ledger changes may still be uncommitted. Treat the repository as the source of truth, not this summary. Preserve good work, recover incomplete work, fix the new regressions, and finish every unresolved Goal 24 item.

0. MISSION

Deliver a polished, performant, fully playable pine-hills-v2 clubhouse loop in Electron:

The game loads and runs smoothly.

Approaching and crossing the clubhouse door does not hitch.

Opening the ledger, turning pages, and cycling held tools do not hitch.

The ledger completely owns player input while open: no WASD, no controller translation, no mouse-look, no camera drift, no tool cycling. The only allowed actions are ledger interaction, closing it, and the global Escape recovery path.

A combined customer visit completes correctly: items, specific tee-time request or check-in, return to the register, one payment, bag, exit.

NPCs intelligently route around the checkout line and other bodies instead of grinding into them, and they never pass goods through another person.

The mop reads as a dense wet-cotton mass, has more visible strands without gaps, and barely reacts while merely carried; it moves substantially only while actively mopping.

The broom head remains square to the floor, but the shaft, handle, and hands no longer feel oddly tilted.

Audio is polished, pleasant, local, licensed, and free to use: distinct hover/click sounds, convincing ledger pickup/open/close/page sounds, drawer/cash sounds, and quiet simulator-style background music.

Escape works from every gameplay/UI/interaction state and exposes a reliable way to resume, restart the current scene/day when appropriate, or return to the main menu.

All unfinished Goal 24 work is completed or honestly marked with exact evidence and then revisited before the final report.

1. NON-NEGOTIABLE OPERATING RULES

1.1 Runtime and scope

Electron only.

Always test with --clubhouse=pine-hills-v2.

The greybox stays.

Do not replace the architecture with a new engine or large framework.

Do not add a runtime dependency on an external web API. Remote audio sources may be used only to obtain assets during development; the shipped game must use vendored local files.

Do not silently remove existing gameplay to improve performance.

Do not weaken tests, golden thresholds, or acceptance criteria to make failures disappear.

Do not reset, clean, stash, or discard unknown work until repository recovery is complete.

1.2 Work without asking

Do not ask the owner to choose between implementation options unless the repository makes the decision literally impossible.

Search the repository, prior goal files, comments, QA drivers, and git history to recover intent.

Record each ambiguity and the interpretation selected in the report.

If an item reaches the old stop rule of five commits or 45 focused minutes, record it as NOT DONE, move to the next item, and return to it after the first pass. Do not end the overall run.

1.3 Evidence rules

A green suite is necessary but is not evidence that a player-visible defect is fixed.

For every item:

Reproduce the defect through the real Electron interaction path.

Capture baseline evidence before modifying the fix area.

Build a check that can perceive the actual defect.

Make a file-copy revert of the relevant fix and assert that the file hash/content really changed.

Watch the check fail on the unfixed file.

Restore the fix and watch the same check pass.

For anything that moves, capture a clip or frame sequence and actually inspect the frames.

Run focused tests, lint, the full suite, and any relevant golden gate.

Commit and push the item separately.

Update Designs/ProShop/OVERNIGHT_REPORT_24.md immediately.

A check that only reads an internal boolean/property is not sufficient. It must observe pixels, real input, real screen transitions, real frame timings, real audio playback state, actual spatial paths, or banked transaction history.

1.4 Performance evidence

For every reported hitch, record the same-machine before/after data:

event name;

number of runs;

cold or warm state;

median frame time;

p95 frame time;

worst frame time;

number of frames over 33 ms;

number of frames over 50 ms;

longest main-thread task;

whether the spike is CPU, GPU-submit, shader/material warmup, asset decode/upload, synchronous I/O, garbage collection, navmesh generation/query, geometry rebuild, or unknown;

the exact stack/marker or strongest evidence for the cause.

Use Electron/Chromium tracing, performance.mark/measure, PerformanceObserver, DevTools protocol tracing, and a requestAnimationFrame frame-time recorder behind a QA/dev flag. Do not leave noisy production logging enabled.

Do not call a recurring interaction hitch fixed while it still produces a repeatable frame over 50 ms. Aim for p95 under 20 ms and worst frames under 33 ms after warmup. If cold initialization cannot meet that, move the expensive work into the loading/idle phase without increasing time-to-first-playable, and report exact numbers.

2. REPOSITORY RECOVERY — DO THIS BEFORE EDITING

Run and save the output of at least:

git status --short
git branch --show-current
git log --oneline --decorate -30
git diff --stat
git diff
git diff --cached
git remote -v

Read:

Designs/ProShop/Full_Goal_24.md

Designs/ProShop/OVERNIGHT_REPORT_24.md

Designs/ProShop/HARNESS_DEBT.md

the relevant Goal 22 and Goal 23 files

recent commits for Goal 24

all new/modified Goal 24 QA drivers

Pay special attention to likely unfinished changes in:

src/render3d/clubhouse.js

src/render3d/courseScene.js

src/core/keyBindings.js

tools/qa/electron-g12-ledger-hotkey-and-lock.js

The previous agent stopped while rewriting the G1/G2 test to drive the ledger by actual state predicates instead of assuming a fixed number of keypresses. Determine whether those changes are working-tree-only, partially committed, or already landed.

Create a short recovery section at the top of the report with:

current branch and HEAD;

clean/dirty state;

uncommitted files and their intended item;

which prior commits are confirmed present;

whether the remote already contains them;

any merge/conflict risk.

Do not create a blanket “recovery commit.” Group recovered changes under the item they belong to and verify them first.

3. KNOWN CONTINUITY STATE — VERIFY, DO NOT BLINDLY REDO

The previous run appears to have reached the following state. Confirm all of it against git history and current behavior.

3.1 Work believed completed and committed

CSP allows 'wasm-unsafe-eval' while broad 'unsafe-eval' remains refused.

Recast was vendored as one bundle so core and generators share one initialized WASM instance.

A navmesh bake proof ran successfully, but this does not mean production NPCs use it correctly.

The artificial checkout bagFill was deleted and a visual check showed the bag unchanged when items disappear inside.

The main combined checkout failure was largely repaired: specific tee-time wording, actionable desk rows, booking/refusal paths, status text, and a laptop “Clear the counter” action.

A geometric broom-head squareness solve was committed.

A general “aimed prop beats nearby station/tool prompt” rule was committed, but its QA driver could not distinguish fixed from reverted behavior.

3.2 Work believed partial or unverified

B still had a B4b failing measurement, and there is now a real player-reported transition bug after checking in/booking the combined customer.

C3 received a partial body/corridor gate, but the driver could not distinguish a frozen placement from a valid delayed handoff.

Inspect C3 carefully for an accidental early return that bypasses the corridor-clear check.

G1 ledger hotkey K and G2 open-ledger movement lock were started, but final state-driven verification did not finish.

The crosshair rule is not yet proven by a discriminating before/after player scenario.

The overnight report was written before the later C and G work and is incomplete.

3.3 Work not shown as completed

C2 real NPC navigation around a queue.

D door stall.

E mop visual and dynamics pass.

F2 hand mesh quality.

G3 ledger hover outline.

G4 smooth ledger open/close/page motion.

G5 real ledger sounds.

H full audio pass.

I3 remaining ledger UI navigation rebuild.

J static-mesh merging/draw-call reduction.

Final three verifiers.

4. EXECUTION ORDER

The new performance and core-loop regressions take priority over cosmetic work. Execute in this order:

Repository recovery.

Performance baseline and regression containment.

Door stall.

Ledger/open/page/tool-switch hitches.

Combined checkout return-to-card flow.

Global Escape/recovery system.

NPC navigation C2 and handoff C3.

Ledger G1–G5 and I3.

Broom and hands F1/F2 regression pass.

Mop E1/E2.

Audio H1–H4 plus all cash/book/menu requirements.

Static mesh merge J and remaining performance cleanup.

Crosshair discriminating verification.

Full verifiers and final report.

Completed Goal 24 items must receive smoke/regression checks during the final verifier, but do not spend time reimplementing them unless current behavior is wrong.

5. P0 PERFORMANCE REGRESSION PASS

The game is now significantly more laggy. It takes longer to load, and the following interactions visibly hitch:

approaching the clubhouse door;

crossing/entering through the door;

opening the ledger;

turning ledger pages;

cycling held items such as broom/mop;

potentially carrying the broom after the new per-frame squareness work.

5.1 Build one reusable performance driver

Create an Electron QA driver that records frame times and markers around all of these events. It must use real input/clicks/keypresses wherever practical.

Required scenarios:

Cold launch: process start → main menu interactive.

Start game: click Start/Continue → first controllable in-game frame.

Door approach: begin several yards outside → approach threshold.

Door crossing: cross outside-to-inside and inside-to-outside.

Ledger open: aim/interact or use the real hotkey → fully open/readable.

Page turn: ten alternating turns after the book is already open.

Ledger close: fully open → back to normal walk state.

Tool cycle: at least 20 tool changes through the real binding/input path.

First equip versus repeated equip: separate cold first-use cost from recurring cost.

NPC/nav activation: scene load and first customer route request.

Run enough repetitions to distinguish one-time warmup from recurring spikes. Preserve raw JSON and a concise table.

5.2 Investigate likely regression sources; do not assume

Profile these hypotheses specifically:

Recast/navmesh generation happening synchronously on startup, door approach, or first NPC activation.

Rebuilding a navmesh more than once for static geometry.

Recast initialization or large geometry extraction running on the render thread.

The broom’s new per-frame Box3.setFromObject, world-matrix updates, geometry scans, or allocations.

Mop strand simulation/geometry creating many objects or allocations.

Ledger geometry, text, materials, outlines, or page content being created lazily on open/turn.

Audio files being fetched/decoded synchronously on first interaction.

Shader compilation or texture upload caused by first visibility of the interior, ledger, or tool.

Materials/geometries being cloned, disposed, and recreated during tool cycling.

Event listeners or render loops being registered repeatedly.

Garbage generated by per-frame arrays, vectors, bounds, strings, or closures.

The standing draw-call count and static mesh count.

The previous agent described the per-frame broom measurement as cheap, but this new player report is evidence that it may not be. Measure it. Preserve the square-to-floor result while moving expensive mesh inspection out of the hot path.

5.3 Performance implementation principles

Static navmesh: initialize once and bake/load once.

Prefer a pre-baked serialized navmesh if the geometry is stable and the library supports it.

Otherwise bake during an explicit loading/idle phase or worker path, not on a gameplay frame.

Dynamic people/queue obstacles must use crowd/local avoidance or lightweight obstacle updates, not a full rebake.

Cache immutable local-space bounds/centers/socket data.

Reuse vectors/matrices and avoid new in frame loops.

Pre-create or pool tool viewmodels; switch visibility/state instead of rebuilding.

Pre-create ledger page meshes/layouts and prewarm materials before the player can interact.

Decode small SFX once and pool playback voices.

Stream or asynchronously decode background music without blocking the main thread.

Prewarm shaders/materials during loading or idle frames without increasing time-to-first-playable.

Do not merely add longer loading screens; reduce and schedule the work.

5.4 Performance acceptance

No repeatable visible hitch for door approach/crossing, ledger open/close/page, or warmed tool cycling.

No recurring frame over 50 ms in those interactions.

Warm p95 should be under 20 ms; target worst under 33 ms.

Cold-only costs must be scheduled before the interaction and must not worsen time-to-first-playable.

Memory must not climb continuously over 50 ledger page turns or 100 tool switches.

No duplicated audio contexts, render loops, or event handlers.

Save and inspect a clip with a frame-time overlay for each interaction.

Commit and push performance infrastructure separately from each behavioral fix so regressions remain bisectable.

6. D — DOOR APPROACH/ENTRY STALL

The earlier diagnosis was specific:

2.9 to 13.1 seconds;

five runs in seven;

100% inside the draw submit;

on the approach, not just the press;

nothing was created in the measured application layer;

not the shadow map;

the interaction press itself was clean.

The owner now also sees a lag spike while approaching and passing through the door.

6.1 Required investigation

Correlate Chromium/Electron frame timing with GPU submit and scene changes. Inspect:

first visibility of interior meshes/materials;

texture upload and shader compilation;

transparent/alpha-heavy interior geometry;

synchronous occlusion/visibility changes;

large matrix-world or bounds updates;

first-time Recast/navmesh work;

first-time audio decode/start;

draw-call explosion at the doorway;

duplicate interior/exterior rendering;

static meshes that should be merged/instanced;

any renderer state transition that blocks on the GPU.

Do not re-diagnose this as shadows without contradictory measurements.

6.2 Required proof

Seven before runs and seven after runs, same route and camera.

Include both approach and threshold crossing markers.

Capture frame-time overlay video.

State plainly whether the expensive draw-submit event still fires after the fix.

If it still fires, quantify it and continue until it is not player-visible.

7. TOOL-CYCLING HITCH

Cycling through held items currently lags substantially.

7.1 Behavior

Tool switching must feel immediate.

No tool may be rebuilt from source geometry every time it is selected.

No repeated GLB parse, texture decode, material compilation, audio decode, or physics-structure allocation on each switch.

Inactive tools may be hidden/detached, but safely cached.

One active viewmodel only; no accumulating hidden duplicates.

Preserve correct hand placement and tool state.

7.2 Required check

Use the real cycle binding for at least 100 switches. Record:

first-use time per tool;

warmed switch p95/max;

object/mesh/material/geometry counts before and after;

heap before and after;

event-listener and render-callback counts if available.

Acceptance: no recurring frame over 33 ms after warmup, no memory growth trend, no duplicate viewmodels.

8. B — COMBINED CUSTOMER CHECKOUT MUST RETURN TO THE CARD

A customer buys items and then asks for a golf time/check-in. After the player books or checks them in, the game remains on the desk/computer screen instead of returning to the normal checkout view where the card is presented.

This is a current core-loop blocker even though earlier B tests banked money.

8.1 Correct flow

For a combined visit:

Real customer selects real products.

Customer reaches counter.

Player scans and bags every product.

Customer asks for a specific tee time or requests check-in for the relevant booking.

Player opens the desk/check-in screen.

Player books/checks in or refuses as appropriate.

The desk action completes.

The UI automatically exits the computer/desk screen and restores the checkout/register workspace and camera.

The customer presents the correct payment method.

The player completes one payment.

Booked path: goods + green fee on one ticket.

Refused/unavailable path: goods only; the sale is never lost.

Customer leaves and the next customer can proceed.

The return must match the normal check-in flow’s camera, focus, cursor/pointer-lock state, register stage, and prompts. Do not require the player to manually back out of the computer to discover the card.

8.2 Cases to cover

New tee-time request mid-sale, accepted at requested time.

New tee-time request adjusted to another valid time.

New tee-time request refused/unavailable.

Existing booking check-in mid-sale.

Card payment.

Cash payment if that path exists for combined visits.

Laptop “Clear the counter” while wedged.

No double banking, no lost products, no duplicate green fee, no customer exiting unpaid.

Locate and resolve the previously reported B4b failure rather than removing it from the verdict.

8.3 Required evidence

A real-input Electron clip must show the entire accepted path and the refusal path. The verifier must assert the screen transition back to checkout by observing the real register camera/UI/card target, not by reading a workspace string alone.

9. GLOBAL ESCAPE AND RECOVERY

Escape must work during every scene, modal, animation, transaction, and interaction so the player can recover from a stuck state.

9.1 One authoritative Escape router

Implement one top-level, capture-phase Escape handler with explicit priority. Prevent double handling by lower-level components.

Recommended behavior:

Cancel active drag/placement/temporary capture safely.

If the ledger is open or animating, close/cancel it and restore the previous safe camera/input state.

If the laptop, register, desk/check-in computer, phone, modal, dialog, or other full-screen interaction is open, unwind one layer safely.

If no interaction layer is open, show a pause/recovery menu.

The pause/recovery menu must offer at minimum:

Resume;

Restart current scene/day/interaction using the project’s correct existing reset semantics;

Return to main menu;

Quit where appropriate for Electron.

Destructive restart/return actions require confirmation.

Escape must not corrupt pointer lock, leave inputs disabled, bank/void a transaction accidentally, duplicate overlays, or strand the player between modes.

9.2 Escape test matrix

Test Escape during:

main menu;

every main-menu dialog;

loading veil after the app is capable of receiving input;

normal walking;

door transition;

tool use;

tool switching;

ledger opening animation;

ledger fully open;

ledger page turn;

ledger closing animation;

register scanning;

bagging;

card presentation;

cash entry;

laptop;

tee-time/check-in computer;

a combined transaction;

item placement/build mode;

any scene/cutscene/modal found in the repository.

Use real Escape keyboard input. Verify that the player can resume and still move/interact afterward.

10. C — REAL NPC NAVIGATION AND CROWD BEHAVIOR

CSP and Recast vendoring are only prerequisites. Production NPC movement must now use a real navmesh/crowd solution.

10.1 C1 production integration

Confirm:

Recast initializes once.

Static walkable geometry produces or loads one navmesh.

The navmesh covers all customer-relevant clubhouse routes.

Off-mesh/unwalkable areas are excluded.

Production customers query/use it; a QA-only path proof is insufficient.

The navmesh does not rebake during normal play, door approach, or every customer spawn.

10.2 C2 blocked customer goes around the queue

Current failure:

Merchandise to the right of the desk remains purchasable.

When a line forms, an NPC trying to reach it runs into the people in line and fails to get the item.

Required behavior:

The shopper identifies that the direct corridor is blocked.

They select a valid longer path around the queue/desk obstruction.

They never continuously grind against another NPC, the player, fixtures, or walls.

They reach the target product, perform the normal purchase interaction, then route to checkout.

Other agents continue moving naturally.

Use Recast path queries plus Detour crowd/local avoidance or the project’s equivalent integration. Queue bodies and moving NPCs are dynamic obstacles; do not rebake the entire static navmesh every frame.

Add:

a stuck detector based on actual progress toward the path target;

bounded repath timing with jitter so all agents do not repath on one frame;

local separation/avoidance;

alternative target approach points/sockets;

arrival radii that prevent oscillation;

smooth steering and turning;

recovery when a path becomes invalid;

no teleporting as the normal solution.

A recovery teleport may exist only as a last-resort safety valve after repeated failed repaths, must be off-camera if possible, and must be reported. The intended behavior is real routing.

10.3 C2 verification scenario

Stage at least three queueing customers so the direct path to the right-side product is blocked. Spawn a shopper whose selected item is behind that obstruction.

The check must observe:

generated path length and waypoints;

the NPC taking the long route;

no contact/grinding interval longer than a small tolerance;

positive progress over time;

item reached and claimed;

shopper subsequently reaching the queue;

no overlap with other body capsules beyond tolerance.

Capture and inspect an overhead clip and a player-view clip. Revert the production navigation integration and show the old straight-line/grinding behavior fails the same check.

10.4 C3 no early or through-body handoff

Current partial implementation may only test that the next customer is near the queue-head slot. That is not enough because the previous customer can still be walking through the handoff corridor.

Required behavior:

A customer cannot begin placing goods merely because they are array index zero.

Their body must physically arrive at the desk handoff position.

The full hand/product trajectory to the staging mat must be clear of every other body.

The previous customer must have cleared the corridor.

No product crosses another body.

No goods are handed over before the customer’s turn.

The placement must eventually proceed once the route clears; “never place anything” is not a passing result.

Build a discriminating driver that serves customer one, advances customer two while customer one is still leaving, and records the actual product trajectory over frames. It must distinguish:

correct delayed handoff;

early through-body flight;

frozen/no handoff.

Capture the clip and inspect frame-by-frame.

11. G — LEDGER: COMPLETE INPUT OWNERSHIP, UX, MOTION, AND PERFORMANCE

11.1 G1 finish the ledger hotkey

Route the ledger through the central binding table.

Preserve K as the default if it is conflict-free in the current repository.

Make it remappable and visible in controls/help.

The hotkey must open the ledger from valid walk states.

It must not fire while text input or another exclusive modal legitimately owns the keyboard.

Pressing the hotkey again may close it if that matches the project’s interaction conventions.

Finalize tools/qa/electron-g12-ledger-hotkey-and-lock.js using actual state predicates, not a hard-coded number of keypresses.

11.2 G2 the ledger owns all movement and look input

The previous check recorded exact zeros because it called ledgerBook.setCarried(true). That tested the artificial carried state. A real player presses E/K to open/read the book, which is a different state. Record this fact in the report before changing the implementation further.

While the ledger is open or in its opening/closing/page-turn interaction state:

WASD does nothing.

Arrow movement does nothing.

Gamepad movement does nothing.

Sprint, crouch, jump, and any locomotion actions do nothing.

Mouse movement does not change player yaw or pitch.

Gamepad look does not change yaw or pitch.

Camera head bob/sway does not drift.

Scroll wheel/tool-cycle bindings do not change the held tool.

Tool use does not fire.

World interaction does not fire through the book.

The camera remains composed on the ledger.

Only book interaction, book close, and global Escape are active.

Do not just zero velocity after movement. Prevent the movement/look deltas from entering the world-camera update while the ledger owns input. Save the pre-ledger camera/input state and restore it exactly on close or Escape.

The real-input test must:

Walk and look normally before opening.

Open through E or K.

Hold movement keys and move the mouse for multiple real frames.

Measure exact world position, yaw, pitch, camera transform, and active tool before/after.

Turn a page while still attempting movement/look.

Close the ledger.

Confirm movement/look resume normally.

11.3 G3 hover/selectable outline

When the crosshair genuinely aims at the ledger cover:

show a clear but tasteful outline/highlight comparable to the money highlight;

show the ledger prompt;

remove the outline immediately when aim/reach is lost;

do not highlight the entire desk;

do not leave stale highlights after opening/closing;

do not add a per-frame material clone or expensive outline rebuild.

Verify from multiple valid standing positions, bare-handed and with a tool equipped.

11.4 G4 smooth opening, closing, and page turns

Current motion snaps and now also hitches.

Film opening, closing, and page turns at real frame cadence.

Inspect the frame sequence.

Use continuous easing with no transform discontinuity.

Do not restart an animation from an assumed endpoint when interrupted.

Page turns should have believable acceleration/deceleration and settle without popping.

Opening and closing should preserve correct hinge direction.

Interruption by Escape must resolve to a valid state.

Prebuild/cache page content and avoid synchronous work inside the animation frame.

Acceptance:

no visible snap;

no recurring frame over 33 ms after warmup;

no page content flashing/missing;

no input leak;

no accumulated meshes/materials over 100 page turns.

11.5 G5 real, polished ledger audio

Replace static/electrical/procedural-noise ledger audio with real local recordings:

pickup/grab;

cover open;

cover close;

page turn left;

page turn right;

optional subtle settle/thump if it improves polish.

Use multiple variants where available and tiny bounded pitch/volume variation to avoid repetition. Audio timing must match the visual contact/turn, not merely the button press. Predecode/pool the sounds so first use does not hitch.

12. I3 — FINISH THE LEDGER UI REBUILD

The prior work reportedly solved “where am I?” and “how do I get anywhere else?” only partially. Recover the exact Goal 23 I3 requirements from the repository rather than inventing them.

At minimum verify:

clear current section/page identity;

obvious navigation to every ledger section;

back/forward behavior;

no dead-end pages;

keyboard and mouse usability;

readable hierarchy and spacing;

consistent page-turn direction;

selected/hover states;

persistence of intended ledger state;

Escape and hotkey behavior;

no lag from navigation or page generation.

Document the recovered requirements and map each one to evidence.

13. F — BROOM AND HANDS

13.1 F1 preserve square head; fix odd shaft/handle feel

The previous run replaced a constant head roll with a geometric square-to-floor solve. The head must remain square, but the owner now reports that the handle/stick feels tilted and odd.

Do not simply revert the squareness solve.

Investigate:

whether roll is applied to the entire broom group instead of a head-only pivot;

whether hand sockets inherit an unintended roll;

whether the shaft basis, grip orientation, or viewmodel camera offset changed;

whether cached/per-frame bristle measurements are noisy;

whether the tool is visually canted in common idle/use poses;

whether the solver causes the new performance hitch.

Prefer an architecture where:

shaft/handle pose is driven by the hands and intended viewmodel pose;

head correction happens at the appropriate head pivot/socket;

hands remain anatomically oriented;

immutable mesh measurements are cached;

only cheap transform math runs per frame.

Required proof:

same five or more poses used for head-squareness verification;

head square to the floor;

shaft/handle visually natural;

hands aligned;

no new lag;

before/after contact sheet and movement clip.

13.2 F2 hands are mesh work

Both hands on both broom and mop need to read as hands at viewmodel distance.

Replace the low-poly blob lower hand.

Add readable fingers and thumb on the correct side.

Increase geometry enough to avoid obvious faceting.

Maintain correct grip/contact with both tools.

Use golf-assets or the project’s asset workflow if needed.

Do not create dozens of separate draw calls per finger.

Preserve skin/material consistency.

Check common FOVs/aspect ratios.

Photograph both tools, both hands, idle and active poses.

14. E — MOP VISUAL MASS AND CONTROLLED DYNAMICS

14.1 Resolve the shape: many visual strands, efficient geometry

The mop still reads as pale rods with daylight between them. It must read as one dense wet-cotton mass while retaining visible individual strands.

Resolve the old ambiguity this way unless repository evidence strongly contradicts it:

use many more visually thin, overlapping ribbon-like strands or an optimized modeled/baked head;

merge/instance them so they do not become hundreds of draw calls;

eliminate visible gaps from normal viewmodel distance;

keep individual strand cues at close range;

avoid a solid plastic block appearance;

use a material/normal/roughness treatment appropriate for damp cotton.

Do not implement hundreds of independent round-rod meshes.

14.2 Dynamics: active when used, quiet when carried

The mop should be heavy and damped.

While merely carried:

strands barely move;

sharp mouse turns cause only a small, slow response;

no rope-on-a-string flailing;

no jitter at rest.

While actively mopping:

strands visibly drag, compress, lag, and recover;

motion responds to stroke direction and floor contact;

damping remains believable;

the head settles smoothly when the stroke stops.

Use separate carry and active-use response parameters/states rather than one overly reactive solver.

14.3 Mop performance and evidence

No per-strand mesh/object allocation per frame.

Avoid one physics body per strand unless proven performant.

Prefer batched/merged geometry, shared material, and a bounded solver representation.

Record before/after draw calls, frame times, and memory.

Capture clips for sharp idle turns and active mopping.

Photograph the mop head close-up and at normal viewmodel distance.

15. H — COMPLETE AUDIO REPLACEMENT AND POLISH

15.1 Source policy

Use free, legally usable audio libraries. Prefer CC0 so the game can ship commercially without attribution complexity.

Approved first choices:

Kenney UI Audio — CC0: https://kenney.nl/assets/ui-audio

Kenney Interface Sounds — CC0: https://kenney.nl/assets/interface-sounds

Kenney Casino Audio — CC0: https://kenney.nl/assets/casino-audio

Kenney Foley/Music packs only after verifying the individual pack page says CC0.

For book/page/foley or music not covered by Kenney, use one of:

Freesound API/search restricted to Creative Commons 0 or Attribution only;

OpenGameArt assets whose actual downloadable file is clearly marked CC0 or CC-BY;

another reputable free library with an explicit commercial-use license.

Never use:

NonCommercial assets;

ambiguous “royalty free” files with no license text;

preview audio when the downloadable asset has a different/unknown license;

AI-generated placeholder static/noise for realistic foley;

a runtime call to an external audio API.

Vendor all chosen files into the repository and add/update THIRD_PARTY_ASSETS.md (or the repository’s existing equivalent) with:

local filename;

source page;

original filename/title;

creator;

license and version;

attribution text if required;

modifications/conversion performed;

date obtained.

Prefer OGG/WAV according to the existing engine path. Normalize, trim silence, add short fades, and prevent clipping. Keep source/master files only if repository policy allows; ship optimized local versions.

15.2 Remove the loud mower/static load sound

On game load there is a loud, annoying mower-like/static sound.

Identify the exact source and trigger.

Remove or replace it; do not merely lower the master volume for everything.

Confirm no oscillator/noise node, malformed loop seam, decode error, duplicated source, or very short sample is looping accidentally.

Ensure audio starts only after a valid user gesture when Chromium requires it.

Fade in background music gently.

15.3 Pleasant simulator background music

Add quiet, loopable, unobtrusive background music appropriate for a calm management/simulator game.

No harsh drone, mower timbre, static, or dominant melody.

Seamless loop with no click at the boundary.

Music should sit clearly below UI, book, register, and customer sounds.

Respect music/master volume controls and mute state.

Do not restart the track on scene/UI transitions unnecessarily.

Avoid decoding/starting it on a gameplay-critical frame.

Record the exact source and license.

15.4 H1 every main-menu control has hover and click sounds

Existing hover sound may remain if it is pleasant.

Every clickable main-menu control must have a distinct click/confirm sound, including controls inside dialogs.

Cancel/back/destructive actions may use their own appropriate variant.

Disabled controls make no confirm sound.

Keyboard/controller activation uses the same semantic sound as mouse click.

Do not double-play when events bubble.

Create an automated inventory of clickable menu/dialog controls and verify each semantic activation emits exactly one sound event.

15.5 H2 register drawer opening

Add a convincing drawer-open sound synchronized to the physical movement/contact. Add close sound if the drawer closes visibly and benefits from it.

15.6 H3 continuous cash-going-in sound

Cash going into the drawer must produce a continuous run of impacts/rustles for the duration of the animation — a convincing “trrrrrrr” sequence — and stop when the final note/coin lands.

Drive it from actual animation progress/pieces landing.

Do not play one generic impact.

Use several note/coin/stack variants or a carefully layered loop plus discrete impacts.

Stop/cancel cleanly if the transaction is interrupted.

No sound after the drawer sequence ends.

No missed sound if animation speed changes.

15.7 Complete money-event sound coverage

The earlier report claimed money sounds existed, but the owner heard nothing. Cover the actual player-visible money events, not just a generic transaction chime:

individual paper-note movement/placement;

individual coin movement/placement where coins are used;

note/coin stacking and settling;

the continuous deposit run while money travels into the drawer;

drawer opening/closing;

any existing deposit-confirmation voice/callout event in the design;

final payment confirmation, subtle and distinct from menu UI.

Drive each sound from the real animation/event that the player sees. A source/property test that says a callback exists is insufficient; the Electron verifier must hear/observe each event fire exactly once at the correct moment. Verify master/SFX volume, mute, cancellation, and no overlap explosion.

15.8 Ledger foley

Replace the static/electrical ledger pickup and page sounds as specified in G5. Verify waveforms and listen in Electron at normal volume.

15.9 Audio performance

One shared audio service/context.

Decode each small SFX once.

Pool/reuse buffers and limit simultaneous voices.

No synchronous fetch/decode during door crossing, ledger opening, page turn, payment, or menu click.

No clipping, DC pop, loop click, or duplicate playback.

Record first-use and warmed playback frame timings.

16. J — MERGE STATIC MESHES PER MATERIAL

The prior standing numbers were approximately:

574 draw calls standing;

942 peak draw calls;

838 static meshes;

290 materials.

This was never started and may contribute to door/scene stalls.

16.1 Implementation

Measure current numbers first; do not assume they are unchanged.

Classify meshes into static visual, interactive, animated, skinned, collision-only, and visibility-switched groups.

Merge compatible static visual geometry per material and render state.

Use instancing where repeated transforms/materials make it more appropriate.

Preserve world transforms, normals, UVs, light/shadow behavior, material identity, culling, and scene appearance.

Do not merge interactive/pickable objects in a way that destroys hit targets.

Keep collision/navigation geometry authoritative and separate where required.

Do not merge across visibility zones if it makes the doorway render substantially more geometry.

Avoid producing one enormous mesh that harms culling or upload time.

16.2 Acceptance

No visual or interaction regression in golden/player checks.

At least a meaningful measured reduction; target 30% or more in standing draw calls and 25% or more at peak unless profiling proves another bottleneck dominates.

Door approach and general frame timing improve or at minimum do not regress.

Scene load and memory do not regress.

Report before/after mesh, material, draw-call, triangle, load-time, and doorway frame-time numbers.

17. CROSSHAIR MUST BE PROVEN, NOT ASSUMED

The current crosshair driver reportedly passed with the relevant change reverted because the ledger itself was already registered as a station. It also found that looking level over the counter sometimes still named the ledger, which is the inverse failure.

Required final behavior:

Crosshair genuinely on the ledger cover and in reach → ledger prompt and ledger outline.

Looking level over the desk, not at the cover → front desk/register prompt.

Same results bare-handed and holding broom/mop/another tool.

Same results with and without a customer at the desk.

No stale focus retention from a prior sample.

Multiple real standing positions after collision resolution.

Use actual camera projection/crosshair pixels and real prompt pixels/text. Find a scenario that fails on the pre-fix code. If the current general rule is unnecessary for the ledger but beneficial elsewhere, add a separate discriminating prop-versus-station case or simplify the change honestly. Do not cite a test that scores identically before and after as evidence of a fix.

18. REGRESSION CHECKS FOR ALREADY-LANDED ITEMS

Before final verification, confirm without reimplementing unless broken:

A bag

No bagFill, block, mass, or visible contents at the mouth.

Items sink, disappear, and nothing replaces them.

Empty and partially filled bag pixels remain identical under a controlled camera.

B existing checkout work

Specific tee-time wording.

Correct status text while tee time is outstanding.

Accepted path includes green fee once.

Refused path retains goods sale.

Laptop clear-counter action safely voids and returns stock.

C1

CSP still refuses broad unsafe eval.

Recast still initializes in Electron.

Production uses a single initialized instance.

F1 head

Broom head remains square after the handle/performance correction.

19. FINAL VERIFIERS

Verifier 0 — performance and recovery

A single Electron run must demonstrate:

acceptable load timing;

smooth door approach/crossing;

smooth ledger open/page/close;

smooth warmed tool cycling;

no recurring >50 ms frame in those events;

Escape recovery from the ledger, desk computer, register, and one other modal;

no memory growth trend.

Verifier 1 — A, B, C on clips

Bag unchanged empty versus filled.

Full combined transaction accepted and refused paths.

Shopper routes around a populated queue to right-side merchandise.

No grinding.

No early/through-body product handoff.

Verifier 2 — D through I

Door performance.

Dense, restrained mop idle and active motion.

Broom head/shaft/hands.

Ledger hotkey, full input lock, outline, smooth motion, UI navigation, polished sounds.

Menu, drawer, cash, and background audio.

Static-mesh/draw-call results.

Verifier 3 — stranger full-customer test

One question: Can a stranger complete one full customer — products, specific tee time/check-in, one payment, bag, and exit through the door — without getting stuck, guessing an invisible state, suffering a major hitch, or needing a developer tool?

Run it with real input from a clean start. The verifier must not call internal shortcuts that skip player interactions.

A verifier finding becomes the next item. Fix it, rerun the relevant verifier, then rerun Verifier 3.

20. COMMIT AND PUSH PLAN

Use one logical commit per completed item. Suggested order, adjusted to actual repository state:

qa: add unified interaction performance trace

perf: remove door approach and entry hitch

perf: eliminate ledger and tool-switch first-use stalls

fix: return combined checkout to card payment

feat: add global escape recovery routing

feat: route shoppers around checkout crowds

fix: prevent early and through-body item handoff

fix: finish ledger hotkey and full input lock

feat: add ledger outline and smooth cached page motion

fix: preserve square broom head with natural shaft and hands

feat: rebuild dense damped mop head

audio: replace menu ledger register cash and music assets

perf: merge compatible static meshes

qa: finish Goal 24 end-to-end verifiers

docs: finalize Overnight Report 24

Before every commit:

focused driver green;

relevant clips/screenshots inspected;

lint green;

full suite green;

golden gate green or intentionally updated with explicit visual evidence;

working tree contains only that item’s files where practical.

Push every completed commit. Record commit hashes in the report.

21. REPORTING

Update:

Designs/ProShop/OVERNIGHT_REPORT_24.md

Keep it under 2,000 lines.

At the top include:

Perception ratio — completed fixes verified by a check that could actually perceive the defect / completed fixes total.

Probe-lie count — how many probes/tests scored the same before and after or measured the wrong state.

Performance headline — load, door, ledger open, page turn, tool switch before/after.

Current completion count — DONE / PARTIAL / NOT DONE.

For every item include:

owner-reported symptom;

exact reproduction;

root cause;

what the previous check measured if it was misleading;

files changed;

before/after metrics;

clip/screenshot paths and confirmation that frames were viewed;

focused test command and result;

revert-fail proof;

full suite/golden result;

commit hash and push status;

remaining caveat.

Add an audio asset table with source/license/local path. Add a performance table. Add a verifier result table.

Do not claim DONE when:

the before/after check cannot distinguish the code;

a movement clip was not viewed;

a recurring >50 ms hitch remains;

the flow only works through internal QA shortcuts;

an audio file’s license is unknown;

the commit was not pushed;

the full suite was not green before commit.

22. FINAL RESPONSE FORMAT

When all work is complete, respond with:

A concise overall result.

A DONE/PARTIAL/NOT DONE table for every section in this brief.

Exact before/after performance numbers.

Exact full-customer verifier result.

Audio sources and licenses.

Commit hashes and push status.

Remaining defects, if any, stated plainly.

Path to the finalized overnight report and all important clips/screenshots.

Do not provide a vague narrative. Do not say “should be fixed.” State what was observed.

KICKOFF

Start now with repository recovery. Then build the unified performance baseline before modifying another gameplay subsystem. Preserve working Goal 24 commits, recover the unfinished G1/G2 state, and continue through every section without asking for permission.