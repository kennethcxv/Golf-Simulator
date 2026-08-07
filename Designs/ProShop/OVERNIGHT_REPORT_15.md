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
| **B2** rebuild them properly | **NOT DONE** | the largest single item in the brief; scoped, not built |
| **B3** broom hand follows the head, mop strands | **confirmed on a clip, not fixed** | the fingers sit BESIDE the shaft, not on it |
| **B4** hands on the handheld tools | **partly** | the pad grip fixed; the vacuum and washer measured and diagnosed, not fixed |
| **C1** per-note hover in the drawer | **done, unphotographed** | implemented and suite-green; no shot of its own yet |
| **C2** the customer's cash highlights whole | **done** | verified on the K3 outline probe |
| **C3–C5** change position, item position, stand point | **NOT DONE** | |
| **C6** delete the white under-desk reader | **done** | |
| **C7** "Customer rec…" cut off | **done** | and a test that finds the next three |
| **D1** a prompt near the ledger | **done** | |
| **D2** the open animation | **partly** | 112.5 ms → 70.8 ms; one frame still over 40 |
| **D3** what is in the book | **done** | all seven sections |
| **E1–E7** settings | **done** | all seven, with the E7 table |
| **F1** tee times read "x am …" | **NOT FOUND** | nine monitor states audited, none truncates a time |
| **F2** Q reveal off behind a panel | **done** | |
| **F3** make fixing the light easier | **NOT DONE** | |
| **G1** lint | **done** | and it found one |
| **G2–G5** | **NOT DONE** | |

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

Not fixed. What it needs is the gripping hand pinned to the shaft AXIS rather
than to a camera-space anchor that happens to be near it, which is the same
family of problem as the vacuum's above — and the vacuum's taught that guessing
at this costs a full asset rebuild for nothing. The next attempt should start by
measuring the perpendicular distance from the hand's palm to the shaft line,
because that is the number the picture is about and nobody has taken it.

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
