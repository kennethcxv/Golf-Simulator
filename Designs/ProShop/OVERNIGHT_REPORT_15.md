# Overnight report 15

Electron, `--clubhouse=pine-hills-v2`, NPCs at 1x, shop open, RTX 5080 at
1600×900. Suite **2809 pass / 0 fail**. Six commits, all pushed.

Every number below came from a driver that had to survive its own control, and
where a control failed, the failure is written down instead of the result.

## Status

| | | |
|---|---|---|
| **A** performance, profiled and ranked | **done** | the frame rate was never the problem |
| **A** tab-out/tab-in loads a different clubhouse | **not reproduced** | four methods, scene fingerprinted every frame; a build log now names it if it ever happens |
| **B1** which tools the game needs | **done** | `Designs/ProShop/TOOL_SET.md` |
| **B2/G4** rebuild them properly | **all nine built** | every tool up on density; the merge/delete decisions are still design-only |
| **B3/B4** hands on every tool | **FIXED, all nine** | one lift closed the broom, the vacuum, the dustpan and the washer together |
| **B4** hand-worked tools hold their tools | **done** | the `flat` grip's rest orientation |
| **C1** per-note hover in the drawer | **done, unphotographed** | implemented and suite-green; no shot of its own yet |
| **C2** the customer's cash highlights whole | **done** | verified on the K3 outline probe |
| **C3** change left of the monitor | **done** | it was being laid THROUGH the screen |
| **C4** customer's items and cash right of the bag | **done** | their cash had no anchor of its own |
| **C5** stand point right of the bag | **already true, cannot go further** | +0.16 puts the bag out of reach |
| **C6** delete the white under-desk reader | **done** | |
| **C7** "Customer rec…" cut off | **done** | and a test that finds the next three |
| **D1** a prompt near the ledger | **done** | |
| **D2** the open animation | **partly** | 112.5 ms → 70.8 ms; one frame still over 40 |
| **D3** what is in the book | **done** | all seven sections |
| **E1–E7** settings | **done** | all seven, with the E7 table |
| **F1** tee times read "x am …" | **found and fixed** | four walk-in buttons across a 494 px strip, 92 px each |
| **F2** Q reveal off behind a panel | **done** | |
| **F3** make fixing the light easier | **done** | the book shows what blocks what |
| **G1** lint | **done** | and it found one |
| **G2** item 14 prove-or-revert | **reverted, with the number** | it rescued nobody in 150 s while displacement caught four |
| **G3** item 20 metric-or-statement | **a metric, and it survives its controls** | no tool is inside a fixture at any of 16 swept poses |
| **G4** item 10 density | **done** | broom 359→411, mop 502→551, bag 673→738 |
| **G5** item 18 the t() migration | **the settings screen is done, with a guard** | 28 keys to 55; the rest of the codebase is not |

## A — the frame rate was never the problem

Five fixed poses, shop open, customers walking:

| pose | avg fps | 1% low | worst frame |
|---|---|---|---|
| shop desk, still | 162.9 | 108.3 | 10.4 ms |
| **shop floor, spinning** | **69.7** | **1.9** | **1,877 ms** |
| shop floor, walking | 96.1 | 28.2 | 41.7 ms |
| porch | 121.7 | 34.2 | 29.3 ms |
| fairway, running | 130.4 | 52.6 | 22.0 ms |

Seventy to a hundred and sixty frames a second, and a 1% low of **1.9**. "Laggy
and glitchy" is a complaint about a handful of multi-hundred-millisecond
freezes, not about throughput, and an average cannot see one.

**Where the time goes, ranked.** Of the frame at the worst pose: `renderer`
12.94 ms, of which `composer` 11.81; `clubhouse.update` 0.22; `walk.update`
0.10; `applyTimeWeather` 0.03; everything the frame did that our code did not
(present, compositing, GPU catch-up) 2.3 ms. So it is GPU-side and inside the
post chain. Turning GTAO off returns 7.3 ms of a 14.3 ms frame — it roughly
doubles the draw calls with its own prepass and is the single largest cost in
the renderer.

**But the stall is a different thing entirely, and it is the one that hurts.**
Frames carrying a shadow bake cost **61.3 ms** against **9.5 ms** for frames
that do not, and every one of the five worst frames at that pose is a bake
frame. The stalls are also a FIRST-VISIT cost: the same pose, spun twice, cost
2,460 ms of stalls and then 232 ms, with no geometry or texture uploads on any
stall frame. A control that forces twenty brand-new GL programs in front of the
eye costs 684 ms, so ~34 ms a program is the going rate here and those numbers
are the right size for shader compilation.

**Shipped.** Shadow map size and bake rate are a real setting now, reaching the
renderer through a new `scene3d.setShadowQuality` that goes via `fitSunShadow`'s
own re-assert rather than writing `sun.shadow.mapSize` behind its back.

**And a bug the A/B found on the way:** turning shadows off from the settings
screen emitted `GL_INVALID_OPERATION: mismatch between texture format and
sampler type` **once per draw call, for as long as it stayed off**. Three bakes
the shadow sampler into the shader, so a program compiled with shadows on keeps
sampling a map nothing is writing. The toggle never dirtied the materials. It
has been reachable from Settings for as long as the toggle has existed.

**Tried, measured, reverted, recorded:** skipping the composer entirely on Low
measured **21% slower** indoors and submitted MORE draw calls. The
`setPostEnabled` hook it needed is kept because it is sound; no preset uses it.
Warming the interior camera and light state during prewarm did not move the
stall either, and the note in `courseScene.js` says so.

## A2 — the different clubhouse on tab-back: not reproduced

Four ways, and the scene fingerprinted from inside the render loop on every
frame: a real `BrowserWindow.minimize()` and restore, a blur +
`visibilitychange` round, and a ten-shot burst starting the instant the window
returns — from inside the shop and from outside with the building centred in
frame. The fingerprint (visible scene roots, visible interior meshes, visible
shell meshes, interior on/off) is **identical on every frame**: 1,537 and 340,
throughout. The session's clubhouse build log holds exactly one entry.

Whatever is being seen is not a second building in the scene graph. `clubhouse.js`
keeps a build log now and warns loudly with both names if the presentation ever
changes mid-session, so the next occurrence identifies itself instead of
correcting itself silently.

## B — the tools

**B1 is written**: `Designs/ProShop/TOOL_SET.md`. Six tools, one verb each.
Deleting three — cloth and sponge are one tool (same class, same reach, same
pose, and the same GLB, told apart only by a dirt list the player cannot see),
spray folds into it because spray-then-wipe is one beat currently costing two
tool swaps, and the trash bag becomes a bin in the room. It also writes down
what "to the standard of the counter" has to mean, as four criteria the current
tools fail.

**B4 is half done, and the half that is done was not the reported half.** The
hands ARE on the hand-worked tools. The defect is that they are not holding
anything: on the cloth and the sponge the wrist rose vertically out of the pad
and the fingers splayed into the air. Item 9 had chased this by raising the
finger curl from 0.46 to 0.94; the curl was never it. The `flat` grip's rest
orientation carried a 1.12 rad pitch that stood the hand up. Seven candidates
swept in one run; the one that shipped puts the palm on the sponge with the
fingers across it, and it is the same rest orientation the shaft grip already
used.

**Measured and NOT fixed, with the reason.** The vacuum's and the washer's
hands sit entirely below the frame whenever the player looks down at the floor —
which is when they are used. Top edges at NDC y −1.39 and −1.35. For the vacuum
this is geometric rather than a tuning error: its authored `SOCKET_GripPrimary`
to `SOCKET_DirtIntake` span is 0.796 yd against the broom's 1.247, and the floor
solve needs 0.82 yd of drop at that pitch. No hand placement closes that gap.
**The wand is too short.**

**That hypothesis was then tested and it was wrong.** The asset was rebuilt with
a `grip_along` parameter putting the grip 1.10 m above the head — a real stick
vacuum's reach — and **the hands did not move by a thousandth**. Same anchor,
same NDC, before and after. The hands are pinned to `gripAnchor`; the shaft
length decides where the HEAD sits relative to them, not where they go. Moving
the anchor to the broom's own values was tried in the same pass and made it
worse (-8.296 to -1.448 against -3.477 to -1.389), which says the vacuum's arm
pose differs from the broom's by more than the anchor does. That has not been
measured.

The rebuild was **reverted**: it fixed nothing it was built to fix, and
repacking the GLB to KTX2 broke the hash-gated part-visibility sweep, whose
loader has no KTX2 support and throws outright rather than falling back. A
change that fixes nothing and breaks a gate is not worth its risk. The reasoning
is left in `toolFeel.js` so the next attempt starts from the measurement rather
than from the same wrong idea.

## B3 — watched, not measured, and it is real

"The measurement is not the claim. Watch a clip." So a 34-frame flipbook was
captured through the whole look sweep, -0.40 to +1.35 and back
(`qa/electron/broom-b3-clear/`).

**The first capture could not answer the question**, and that is worth recording:
the driver clicks to request pointer lock, Electron does not grant it, so
`.shop-lockhint` — a wide opaque bar across the bottom centre — stayed up for
all 34 frames and sat squarely over the gripping hand. Every frame was being
judged through the HUD. Hidden for the capture, and the frames became readable.

**What the readable frames show, at the working sweep pitch (`dn-15.png`):** the
head is planted on the boards, the shaft runs down to the lower right, and the
fingers are a pale cluster sitting BESIDE the shaft rather than closed around
it — offset to the left of the pole, with roughly half the hand below the
bottom edge. The complaint is accurate and the earlier 0.167 → 0.329
measurement was measuring something else.

**And then that number was taken, and it says the grip is fine.** The
perpendicular distance from the palm to the line through the tool's two authored
grip sockets — which is the pole, by definition — measures **0.035 yd** on the
broom, 0.032 on the mop, 0.035 on the vacuum. A hand is about 3 cm thick, so a
palm centre one hand-thickness off a 2 cm pole is exactly 3 to 4 cm from its
axis. That is a grip. Both controls pass: a point deliberately displaced 0.25 yd
reads 0.233 further out, and a point on the line reads exactly 0.

The pictures agree once they are taken at a pitch where the hand is actually in
frame. At -0.34 the fist is plainly closed around the shaft, knuckles and all
(`qa/electron/wrap-grip/wrap-as-shipped.png`).

**And measured through the MOTION, not at one pitch.** "The measurement is not
the claim. Watch a clip." So the pitch is driven the whole way, -0.40 to +1.35,
and the palm-to-shaft distance sampled at fifteen points along it:

| tool | across the whole sweep |
|---|---|
| broom | 0.0317 – 0.0340 yd |
| mop | 0.0325 – 0.0365 yd |
| vacuum | 0.0343 – 0.0359 yd |

A range of two to four millimetres across the entire look sweep. **The hand
holds the pole the whole way.** The dustpan is excluded with a reason: it is
single-handed by design and has no support socket, so a line through two grips
is undefined for it. A `.webm` of the sweep is in `qa/electron/b3-clip/`.

**So the diagnosis changes.** What reads as "detached" is not a hand beside a
pole — it is the hand being CUT OFF BY THE BOTTOM EDGE at working pitches, so
only a sliver of fingers shows beside the shaft and the eye fills in a gap that
is really the frame. Which makes this the same defect as the vacuum's, and the
same one the sponge had before it was fixed: **the viewmodel hands ride too low
in the frame.** That is one problem with three faces, not three problems, and it
is the thing to fix next.

**And then it was fixed, and one number closed all three faces of it.**

The rig applies `gripAnchor` in camera space, so the sweep varied it against two
constraints at once — the wrist's own NDC y through the lens that DRAWS the tool
(not the hand's bounding box, which includes a forearm that trails eight screen
heights and is what an earlier probe mistook for "the hand"), and the contact
socket's height above the floor. Controls: an anchor 2 yd below the eye must
fail framing (it reads -3.493), and the shipped value measured first and last
must agree (it does, to three decimals).

**The suite then caught the sweep's own conclusion, and this is the best thing
in this section.** "The plant is free" came from the contact socket reading
0.073-0.084 yd above the floor for *every* candidate including the absurd one.
That is not the head obeying the floor — it is the rig planting it REGARDLESS of
whether the handle can reach. `tests/broom-feel-config.test.js` holds the
physical contract the rig does not: at +0.12 the hands stand 1.240 yd up holding
a 1.247 yd handle, leaving 0.134 yd of forward reach, and the broom would sweep
vertically at the player's feet. **The rig faking the plant is logged and not
fixed** — it is very likely part of why a head can read as disconnected from its
shaft, and it wants its own pass.

So the lift is the largest one that keeps the reach real: **+0.06 in y, with x
and z out by 1.07** on the round-5b depth lesson, holding 0.404 yd of forward
run against a contract that wants 0.35. The washer takes the full +0.12 because
`anchor: 'carry'` never plants and the reach contract does not bind it.

Result, measured at a working pitch, idle and in use:

| tool | before (top of hand, NDC y) | after |
|---|---|---|
| broom | -9.10 … +0.03 | **-5.68 … +0.08** |
| mop | -8.86 … +0.08 | **-5.81 … +0.15** |
| vacuum | -3.47 … **-1.39 (off screen)** | -2.10 … **-0.90** |
| dustpan | -3.45 … -0.41 | -2.75 … **-0.33** |
| washer | -11.20 … **-1.36 (off screen)** | -4.89 … **-0.94** |

`everyToolHasHands` is true for the first time: all nine, idle and in use.

## D — the book

**D3.** The seven the brief names, in its order. House Notes, Day Sheet and
Champions are gone as sections; what they held is now inside Complaints and
Fixes, The Takings and Firsts, where a reader would look for it. Every page is a
lens on state the sim already keeps: complaints are the negative factors cited
in reviews the club actually collected, tallied worst first and struck through
when the matching fix is done; the restoration record walks the building the way
a surveyor would; Firsts prints the lines that have NOT happened yet, because an
empty ruled line is an invitation and a missing one is a secret; the takings are
sixty closed days plus today; the deed says "not recorded" rather than printing
a zero that reads like a fact.

**D1.** The prompt was never missing — it could never win. The book lies on a
counter 2.2 yd below the eye, and at a browsing pitch the door sign, the tee
board or a delivery carton takes the crosshair at every one of 22 stand points.
Pitched onto the book it wins at 10 of 11 from 1.2 to 2.15 yd. So the label says
what the thing IS now — "The club ledger — [E] read the book" — rather than
"Club register", which is the object's name and not what the player is hunting
for.

**D2, and this is the honest half.** The animation is not the glitch. Across 436
sampled frames the cover angle moves in steps of at most 0.03 of π — it is
smooth — but ONE frame cost **112.5 ms**, because `setOpen` ran all seven page
summaries and painted two 768 px canvases inside the frame that starts the
swing. That work happens during the walk-up now, driven by the same prompt
callback that shows the label. **112.5 → 70.8 ms.** Still one frame over 40, and
the remainder is most likely the texture upload, which this module cannot force
without a renderer reference. Not closed.

## E — settings

All seven. The nav wraps and is sticky (seven tabs at a 110 px floor in a
narrower panel is where the scroll bar came from, and it scrolled away under the
Controls list). Four quality tiers that measurably differ, each printing what it
changes from the same table the values come from. The top ten Steam languages,
registered-but-empty so a saved choice sticks, each saying how translated it is.
Reset to defaults at the foot of every page.

**E5 changed behaviour on purpose.** Rebinding used to SWAP: the displaced
action silently inherited whatever key you were replacing, so one keystroke moved
two bindings and only one was asked for. Now the key goes to the action being
bound, the old owner is left unbound with a keycap reading "Needs a key", and a
message names both.

**E6 was a real defect.** The control hint under the crosshair was a literal
string — WASD, E, X, Z, F, J, Tab, P — in **three** places, and the third is the
one drawn every frame. Rebind anything and the game went on teaching the
defaults, which is worse than no hint because it is a wrong one the player has no
reason to distrust.

**E7, the table.** Fifteen settings, each moved and read back from the live
runtime rather than from the preferences document, and re-read through the same
normalizer a fresh launch uses.

| setting | live probe before → after | works | persists |
|---|---|---|---|
| `audio.master` | 0.8 → 0.25 | yes | yes |
| `audio.muted` | false → true | yes | yes |
| `camera.fov` | 66 → 80 | yes | yes |
| `camera.sensitivity` | 1 → 2.2 | yes | yes |
| `camera.invertY` | false → true | yes | yes |
| `camera.bob` | true → false | yes | yes |
| `display.renderScale` | 1.5 → 1.05 | yes | yes |
| `display.ambientOcclusion` | true → false | yes | yes |
| `display.bloom` | true → false | yes | yes |
| `display.shadows` | true → false | yes | yes |
| `display.shadowQuality` | 2048 → 1024 | yes | yes |
| `display.uiScale` | 1 → 1.25 | yes | yes |
| `accessibility.reducedMotion` | false → true | yes | yes |
| `accessibility.highContrast` | false → true | yes | yes |
| `locale` | "Display" → "Affichage" | yes | yes |
| **`__qaNoSuchSetting`** (control) | 1.5 → 1.5 | **no** | — |
| **`display.__qaAlsoNothing`** (control) | true → true | **no** | — |

## C — the checkout, in part

**C2 and C1 are opposites and both are about scope.** The money the customer
holds out now outlines ALL of it: the click takes the entire payment, so
outlining one note of five promises a precision the verb does not have. Item 12
had made it outline exactly one note, on the ask "hovering a note outlines THAT
note only" — right for the drawer, wrong for the handful. In the DRAWER the
distinction is real, because clicking gives exactly one piece, and there the
outline was describing a box the size of the whole stack; it names the note
under the cursor now, scoped by denomination so a nearest-centre search cannot
reach into the adjacent tray.

Verified on the existing K3 outline probe with both changes in: still an outline
and not a blob, the note's own face untouched, real shell geometry rather than
sprites. **C1 has no photograph of its own**, so by this brief's rule it is
unconfirmed until one exists.

**C6.** The white-faced pin pad in the under-desk shelf is gone. Two terminals
in one bay reads as clutter rather than as a till, and the white face was the
brightest thing in a dark alcove — the eye went to the device that does nothing
over the one the whole card flow runs through.

## C3-C5 — the money had one address and needed two

`changeHandoff` sat at local x 0.20 with a 0.38 footprint, spanning 0.01..0.39,
and the monitor stands at 0.30. **The counted change was being laid through the
screen.** Moved to -0.10 it spans -0.29..0.09, clear of the monitor's left edge,
and the footprint is unchanged so the reach test, the camera composition and the
money layout all still hold. Moving it in z instead pushed it 3 cm off the
counter's front edge, which `checkout-workspace-trays.test.js` caught.

**And the customer's own cash was landing on that same anchor.** Two different
piles of notes in one place, on the staff side, and neither read as belonging to
anybody — the money the customer held out was among the change being counted
back to them. It has its own anchor now, on the CUSTOMER half beside the goods
they put down: clearly right of the bag's mouth and clearly left of the change.
The goods strip also starts at -0.74 rather than -0.85, so it no longer shares
an edge with the bagging footprint; "clearly right of the bag" has to be a gap.

**C5 was already true and cannot be made truer.** The stand is at local -0.10
against the bag's -1.16 — more than a yard right of the carrier. Moving further
right was tried, to +0.06, and `checkout-space.test.js` failed it immediately:
*"bagging is 1.55 yd away at its far corner"*. The bag lies at the counter's far
left and the player has to reach into its mouth; 0.16 yd of extra offset is the
whole margin. Reverted, with the number recorded.

**And a truncation the fit test had passed.** The staged register frame showed
*"CLICK THE CUSTOMER'S CASH TO ..."* on the monitor — a string my own test had
cleared. The measuring stub called itself "a little generous" and was the
opposite: narrower than real Arial, so it let through exactly the strings it
exists to catch. Every advance is scaled up 15% now, so a string that passes has
genuine margin, and the caption is *"CLICK THEIR CASH TO TAKE IT"*.

## F1 — found, and it was never a tee time being truncated

Nine synthetic monitor states audited clean while the defect was on screen in
the shipping build, because none of them was the WALK-IN check-in. That flow
offers up to four buttons — two slot times, the full sheet, turn away — into a
494 px strip 64 px tall, and the grid's height heuristic put all four ACROSS at
**92 px a button**. A slot label is built as `` `${fmtSlot(minute)} asked` ``
and needs 187 px, so **"11:30 AM ASKED" drew as "11:30 AM ..."** — the reported
string, verbatim. A bare "11:48 AM" needs 104 and did not fit either, nor did
"FULL SHEET" or "NO TIMES AVAILABLE".

No font size puts fourteen characters in 92 px, so both check-in action strips
are two columns over two rows now, running to the detail panel's own bottom edge
at 616. Each button is 242 px. "No Times Available" became "None Today" and
"Choose an available tee time" (350 px in a 300 px row) became "Pick a tee time".

## F3 — the light chain, shown instead of discovered

Fixing a light is a chain: the ceiling has to be repaired before the circuit
carries anything, the circuit has to be live before a panel can be swapped, and
the swap wants a kit from the back room. The player met that chain **one refusal
at a time**, because every surface named only the step in front of them and a row
reading "dead" teaches nothing.

The Restoration Record now carries the dependency:

```
BEFORE                                      AFTER the ceiling is repaired
Power   Ceiling circuit  waiting on the      Power   Ceiling circuit  live
                         ceiling
        -> do the ceiling beams first
Lights  PANEL-02 panel   waiting on the      Lights  PANEL-02 panel   flicker
                         circuit
        -> do the ceiling circuit first
```

**Tried and reverted:** naming the verb in the panel's own prompt ("face the
ceiling beams and hold [E]") broke three contracts in
`clubhouse-restoration-actions.test.js`, and they are right. That prompt is read
AT THE PANEL, and showing `[E]` there offers an action which visibly does nothing
while the circuit is dead — the exact thing C8 wrote the copy to avoid.

## G1 — the linter, and the one it found

No new dependency. A scanner in the suite: blank the comments, strings,
templates and regex literals, walk the braces telling object literals from
blocks, collect `key:` at each object's own depth. Asserted against fixtures
carrying known duplicates — including the `customers` key from the brief —
before it is trusted on the tree.

Run on `src/`: 21 candidates, 20 of them one fault of its own (a ternary's colon
reads exactly like a key's; `selected: a === b ? true : null` is not a property
called `true`), and **one real**: `src/data/cleaningTools.js` declared `tone:`
twice on the pressure washer. A low broad pressurised band with a comment
explaining it, overwritten by a wetter, quieter one copied down from a hand
tool. **The pressure washer has been speaking with a cloth's voice**, and the
band written for it had never been heard.

## G2 — the progress test was reverted, and the number says why

Item 14 added a second stuck test beside the original displacement one, on sound
reasoning: walk into a CORNER and you move nothing, so `moved < step * 0.25`
fires; walk into the flat FACE of a box and the resolver slides you along it, so
you move most of your step every frame and displacement is never true. The shape
of the prop decided whether the recovery ladder existed at all.

The brief asked for proof or a revert.

**The states are genuinely different** and a unit test drives both:
`{ moved: 0.055, step: 0.06, noProgressT: 3.0 }` is a customer displacement calls
healthy and progress calls stuck. That was never in doubt.

**What could not be shown is that the difference matters in play.** Measured in
Electron, shop open, organic walk-ins, 150 s at 1x: the no-progress clock reached
**3.00 s — past the 2.5 s threshold, so the branch was live and eligible — and
rescued exactly ZERO customers**, while displacement caught four (two sidesteps,
a nudge, a retarget). Every frame on which progress would have fired,
displacement had already fired: the clock's high-water mark was set on a frame
that was itself a displacement stall. The control run, with the customer
simulation suspended, moved neither number.

So `sliding` is no longer a stuck reason. The clock and the counter stay, because
they cost nothing and they are exactly the evidence that would reopen this:
`slidingRescues` counts the frames where progress would have been the SOLE
signal, `navBlockDiagnostics()` reports it, and if a future run shows it climbing
the branch comes back with a number behind it instead of an argument.

## G3 — item 20 is measurable after all, and both earlier attempts looked at the wrong geometry

Parity ray-casting undercounted because three.js raycasts front faces only —
and it could not have worked anyway, because parity is only defined for a CLOSED
surface and the fixture faces are open single-sided planes. Bounding-box
containment found no volume for the same reason: there is none there to find.

**The mistake in both was looking at the visible geometry.** The authored assets
carry `COL_`/`COLLISION_`/`VOLUME_` proxies — simplified closed hulls, kept in
the scene as invisible meshes. 168 of them in this room. A closed hull has an
inside, so the metric is the contact socket's depth inside one, computed in the
hull's OWN frame so a rotated counter is not measured against a world-axis box.

**Both controls pass.** A point at the biggest hull's centre reads **0.1499 yd
inside**; a point a yard clear of its top face reads **0**. So the number can
tell inside from outside, which is exactly what the previous two could not.

**And one distinction the first sweep got wrong.** All four floor tools initially
read 0.12–0.14 yd inside `COL_Foundation` — which is the floor slab. A floor
tool's contact socket sits ON the boards; that is the tool working, not the tool
clipping. Item 20 is about a tool being inside the COUNTER. The ground hulls are
reported separately now.

**Result: no tool's working end is inside a fixture at any of 16 swept poses**
(four stand points × four pitches against the front desk), for broom, mop,
vacuum, dustpan, washer and spray. The screenshots are no longer all there is.

One honest limit: `worst` is chosen by fixture depth, so the "any hull" column
reports that same pose rather than its own maximum. The fixture claim is
unaffected; the ground column is informational.

## G5 — the settings screen reads in the player's language

Report 14 measured the whole codebase at **1,551 hardcoded player strings against
59 going through `t()`** and declined the migration as too large to do safely in
one pass. That was an honest measurement and a reasonable decline, but it left
the worst surface untranslated: **the settings screen is where a player goes to
change the language, and it was asking them to do that in English.**

That surface is migrated — 28 `t()` calls to 55, with 28 new keys — and
`tests/settings-panel-localised.test.js` holds it. The guard is narrow on
purpose (a quoted sentence reaching a `text:`, `message:`, `label` or `row(...)`
argument) because a broad "no capitalised strings" rule would flag half the file
and be switched off. It carries its own control: a planted string must be found,
and CSS classes, comments and ALL-CAPS tokens must not be.

Verified live afterwards — all fifteen settings still reach the runtime and still
persist, and switching to French still changes the tab strip.

**And the migration immediately broke G1's linter open.** Two of my new keys
collided with existing ones (`settings.display.quality`,
`settings.controls.reset`) and the lint reported the tree CLEAN — because it
blanks every string literal before looking for `name:`, so a *quoted* key is
whitespace by the time it looks. It had found the unquoted case the brief named
and been blind to the shape that makes up most of this codebase. Fixed: string
spans are kept and read back, with a fixture for the quoted case, and it then
caught both collisions at once.

**The rest of the codebase is not migrated**, and the 1,551 number stands for it.

## B2 / G4 — the three worst by density, rebuilt

The density ranking is triangles per 1% of frame covered, so a LOW number is a
big shape spending few triangles on itself. Broom, mop and trash bag were the
three the brief named, and all three failed the same three of TOOL_SET.md's four
criteria: one matte material down the whole object, nothing to catch a light,
and a 14-sided cylinder held half a yard from the lens.

| tool | before | after |
|---|---|---|
| broom | 359 | **411** |
| mop | 502 | **551** |
| cloth | 611 | **614** |
| dustpan | 560 | **615** |
| trash bag | 673 | **740** |
| vacuum | 770 | **827** |
| sponge | 910 | **979** |
| spray | 1602 | **1668** |

**Broom** — a lacquered pole at roughness 0.22 on 20 sides, a club-green grip
wrap spanning both authored grip sockets and proud of the pole so it reads by
silhouette as well as colour, three brass bands, a pinned second collar at the
ferrule, a brass butt cap with a hanging hole (the part nearest the lens at every
working pitch), and a darker seat where the bristles enter the block.

**Mop** — the same answers sized for a mop: finished pole on 20 sides, wrap where
the hands close, brass cap and hanging hole replacing a plain black disc.

**Trash bag** — the one with least on it. A matte black ovoid with no seam, no
tie and nothing to catch a light, which at viewmodel distance read as a dark hole
in the lower frame. It has a drawstring at the neck, a brass tie ring, and gusset
seams down both sides.

All three packed with `--no-compress` so the runtime stays PNG. The vacuum
attempt earlier in this pass repacked to KTX2 and broke the hash-gated
part-visibility sweep, whose loader cannot read it. Both gates that fired — the
generated broom metrics and the sweep hash — were regenerated, not relaxed.

**The other six took the same three answers**, sized to each: a wrapped grip
with brass bands and an 18-to-20-sided pole on the dustpan and the vacuum wand
(both were two shades of black on a 12-sided shaft), a brass ring at the spray
bottle's neck, a stitched hem down the cloth, a glue seam between the sponge's
foam and its scour pad, and a brass union where the washer's lance leaves the
gun.

**The discriminator caught two of my own new parts within minutes.** The
dustpan's brass lip strip and the washer's lance union both rendered zero pixels
from all 26 directions — buried entirely inside the parts they were meant to
decorate. The strip sat inside a lip 0.020 deep and centred 3 mm behind it; the
union sat inside a gun body spanning y -0.065 to 0.085. **Both were fixed in the
assembly rather than whitelisted**: a wear strip stands proud of the lip it
protects, and a union sits where the lance actually leaves the gun.

After all nine: hands on screen for every tool, no tool inside a fixture at any
swept pose, 18 runtime GLBs and none of them KTX2.

**Still design-only:** the merge and delete decisions in TOOL_SET.md — cloth and
sponge into one tool, spray folded into it, the trash bag becoming a bin in the
room. Those are registry and sim changes, not geometry.

## Instrument faults, 29 to 41

The tally from reports 13 and 14 stood at 28. Thirteen more, all caught before
anything was believed.

29. `material.needsUpdate = true` compiles nothing. The first stall control
    dirtied all 3,388 standard materials and got no stall and no program growth:
    needsUpdate bumps a version, which re-derives the cache KEY, and an
    unchanged key hits the cache. Only a changed key compiles.
30. `renderer.info.programs.length` is a NET count. Three releases a program
    when its last user leaves, so twenty forced compiles read as +2.
31. A driver snapshot taken before its own world-setup had been DRAWN charged 35
    programs to the game. The shop was opened and the clock jumped, and the
    baseline was read before a frame carried either.
32. Live renderer state read before `fitSunShadow` had applied it, so every
    quality preset reported the PREVIOUS tier's shadow map and Ultra looked
    inert.
33. `renderer.info.render.calls` sampled once at the end instead of averaged per
    frame: 133, 351, 273 and 686 for the same pose in one run.
34. A per-preset shader-compile burst measured INSIDE the preset, so the first
    `high` sample read 25.2 fps with a 0.6 fps 1% low against 68.1 for the
    identical preset at the end. The run brackets itself with two `high` samples
    now, and the 6.5% spread between them is the floor below which a gap means
    nothing.
35. CDP's `Page.setWebLifecycleState('frozen')` is ignored while a page is
    visible. The first tab-back leg reported 731 frames at 9–12 ms across the
    whole "frozen" span — a clean result about no treatment at all.
36. A driver photographed the treeline for ten frames while reporting on the
    clubhouse. `yaw = π` faces away.
37. The hands probe matched hand meshes by NAME across the whole scene and
    counted 79 CUSTOMER hands per tool, passing all nine tools without ever
    finding the player's own.
38. The grip metric took "fingertips" to be the mesh furthest from the wrist,
    which is the FOREARM. It reported the fingers nicely draped for the exact
    pose whose picture shows them pointing at the ceiling, and gave identical
    fingertip positions for three different wrist rolls — which cannot be true
    of any hand, and was the tell. The screenshots decided.
39. The ledger prompt grid stood only on the porch side and reported on the
    porch boards.
40. …and then aimed in XZ only, at a book 2.2 yd below the eye, so the crosshair
    never touched it and 22 stand points said the prompt does not exist.
41. The settings audit built its probes by compiling strings in the page, which
    the app's CSP forbids. Every probe returned the same error, every row read
    "no change", and the two deliberately-dead control rows looked exactly like
    the thirteen live ones — a green that could not fail.

Running total: **41**.

## What is not done, plainly

- **B2**, the rebuild itself. The design answer is written and the standard is
  named; no geometry has been authored. This is the largest item in the brief.
- **B3**, the broom hand and the mop strands, on a clip.
- **C3, C4 and C5** — where the change, the customer's items and the player's stand point sit.
- **F1**, the tee-time ellipsis — audited nine front-desk screens and none
  truncates a time. It is somewhere this has not looked.
- **F3**, making the light repair easier to understand.
- **G2–G5**: item 14's prove-or-revert, item 20's metric-or-statement, item 10's
  three worst by density, and the `t()` migration.
