# Pro-Shop Phase 0 — Findings Report

Phase 0 (Baseline Capture and Safety Setup) of `Designs/ProShop/SLICE_BRIEF.md`.
No redesign, remodelling, asset generation or gameplay change was performed.

---

## 1. Repository state

| Field | Value |
|---|---|
| Branch | `feature/pro-shop-vertical-slice` |
| Initial commit SHA | `78ebbb7aafe7876446c5de778b78c362af5fc563` |
| Final Phase 0 commit SHA | the commit containing this file — reported on push |
| Baseline tag | `pro-shop-pre-rebuild-baseline` (annotated) |
| Tag object SHA | `85c6e66384389bb08e0de1fc5cb4de6e00940cc0` |
| Tag target | `78ebbb7aafe7876446c5de778b78c362af5fc563` |
| Remote | `https://github.com/kennethcxv/Golf-Simulator.git` |
| Working tree at session start | clean, no unrelated user changes |

The tag was created **before** any Phase 0 file existed, so it points at the tree as it
was found. It did not exist locally or remotely beforehand; the remote had no tags at
all. No branch was switched, merged, rebased, reset or deleted; no history was
rewritten; `main` was not touched.

---

## 2. Baseline evidence created

| Artefact | Count | Location |
|---|---|---|
| Screenshots | 10 PNG, 1600 × 900, 6.7 MB | `Baseline/screenshots/` |
| Video | 2 WebM, 85.5 s total, 13.5 MB | `Baseline/video/` |
| Performance captures | 21 samples (7 scenarios × 3 runs) | `Baseline/data/baseline-performance.json` |
| Machine-readable capture data | 4 JSON | `Baseline/data/` |
| Camera transforms | 10 poses | `BASELINE_CAMERA_TRANSFORMS.md` |
| Test protocol | 1 | `BASELINE_TEST_PROTOCOL.md` |
| Integration map | 1 | `CURRENT_INTEGRATION_MAP.md` |
| A/B plan | 1 | `AB_SCENE_PLAN.md` |
| Capture scripts (new, non-gameplay) | 4 | `tools/qa/proshop-baseline-*.js` |

Videos: `baseline-broom-interaction.webm` (42.5 s — equip, idle, walking, first
contact, continuous sweeping, direction changes, cleaning at a wall, stop, unequip)
and `baseline-laptop-checkout-customer.webm` (43.0 s — laptop open/page/exit, a
customer walking the route, goods on the staging tray, register framing).

Both are genuine screen recordings from Playwright's context recorder, not frame
sequences. Nothing was staged, and neither the broom, checkout, laptop, NPC behaviour
nor the scene was modified before recording.

---

## 3. Verified integration points

Full detail in `CURRENT_INTEGRATION_MAP.md`. The load-bearing facts:

* **The starter room is the `pine-hills` variant.** Property `willow-creek`, display
  name "Pine Hills Municipal Golf" (`src/data/marketplace.js:71`). Interior dressing is
  `src/render3d/clubhouse/pineHillsInterior.js`.
* **`src/data/shopLayout.js` is the room's coordinate bible** — read simultaneously by
  the renderer, the simulation, customer navigation, the grime grid, the collider
  registry and the test suite.
* **There is no separate interior scene.** The clubhouse is a building inside one
  continuous course world, entered through a real hinged door.
* **A variant seam already exists** (`clubhouse.js:542-552`, `?clubhouse=<id>`), and the
  `shed` variant proves a whole alternate interior can coexist. This is the recommended
  A/B mechanism.
* **Room construction is hybrid**: procedural shell always builds; authored Sheet-6 GLBs
  hide the matching procedural set in place. A failed GLB leaves the room intact.
* **Materials are canvas-procedural**, ~22 shared materials created once per
  `makeClubhouse`; there are effectively no bitmap textures indoors.
* **Interior lighting is 8 RectAreaLight ceiling panels** with a 4-panel render budget;
  `castShadow` is stripped from everything indoors.
* **Checkout is three separated layers** — money (`sim/register.js`), state contract
  (`sim/registerFlow.js`), physical driver (`simplifiedRegisterMode.js`). The live `tx`
  is a closure variable and is deliberately not persisted.
* **The laptop is fully procedural**, with a 1024 × 640 DOM page homography-projected
  onto the screen quad every frame.
* **Dirt is `reno.grime[104]`** (13 × 8) drawn as one 1024 × 640 canvas, plus 18 debris
  clusters. Shop condition is derived, never stored.
* **The broom already has an authored FP viewmodel with sockets and clips** — this is
  not a static offset (see §4, Tool presentation).
* **`src/render3d/clubhouse/customers.js` (1,323 lines) is dead code**, imported
  nowhere. The live customer implementation is inline in `clubhouse.js`.
* **The registry `audio:` cue tables are dead data** — no runtime consumer.

---

## 4. Observed presentation weaknesses

Observations only. No solutions are proposed and nothing was fixed.

### Assets

* Floor debris renders as **flat, untextured tan quads lying on the boards**
  (`09-floor-dirt-read.png`, `07-cleaning-route.png`). They read as placeholder decals
  rather than litter, and have no thickness or shading.
* Fidelity is inconsistent across the room: the counter millwork and register hardware
  are comparatively detailed, while the coffee machine, water cooler, sofa and snack
  boxes read as simple flat-shaded primitives (`02`, `05`, `07`).
* Snack and merchandise packaging are flat cards with printed faces, not boxes (`07`).
* Cardboard delivery boxes are reused at several scales and stack in unconvincing
  intersecting poses (`02`, `10`).

### Materials

* The floor is a single, strongly saturated orange-toned wood used across the entire
  room, with a visible repeating plank pattern and no variation by traffic or zone
  (`02`, `07`, `09`).
* Large architectural surfaces are flat untextured colour fields. The partition in
  `10-back-of-room-clutter.png` fills roughly half the frame with a single featureless
  beige surface.
* Wall, wainscot and ceiling read as three flat tones with little material identity;
  there is minimal roughness or normal variation to catch the light.
* 815 unique materials and 227 unique textures are live in the scene — a very large
  count for a room whose surfaces read as flat.

### Lighting

* Illumination is even and diffuse to the point of flatness. Contact shadows are weak
  and few objects feel grounded (`01`, `02`, `05`).
* The ceiling plane reads brighter than the merchandise it is meant to light.
* **The checkout is not lit as a focal point** — it receives the same ambient treatment
  as the rest of the room, so it does not draw the eye on entry (`01`, `03`).
* Merchandise bays are darker than the circulation space, which inverts the retail
  hierarchy (`02`, `06`).
* Engine requests `PCFSoftShadowMap`; three.js silently downgrades to `PCFShadowMap`
  every boot. The shipped shadow filtering is not the one the code asks for.

### Composition

* **The reception counter sits immediately inside the entrance and blocks the entrance
  sightline** (`01-entrance-looking-inward.png`). The player's first view is the back
  of a desk rather than the shop.
* The room centre is occupied by a counter island plus a tall tee-time board column,
  which cuts the space into halves that cannot see each other (`02`, and the recon
  panorama).
* **Merchandise fixtures are largely empty at the starting state** — long runs of bare
  black pegboard and empty shelving dominate the merchandise wall (`02`, `06`).
* The back-of-room corner has no legible purpose: boxes, a bin, an office desk and a
  course map compete without hierarchy (`10`).
* An orange rectangular outline is drawn on the floor in the back area (`10`) — a
  placement-zone marker visible during normal play, which reads as a debug artifact.
* Delivery boxes are scattered across circulation routes rather than staged, so the
  clutter reads as accidental rather than authored (`02`, `05`, `07`).

### Tool presentation

* **Better than expected, and this should be stated plainly.** The broom has an
  authored first-person GLB with `SOCKET_FloorContact/GripPrimary/GripSupport`, authored
  `Broom_Equip / SweepLeft / SweepRight / Unequip / BristleContact` clips, a procedural
  rise-and-settle equip ease, gait bob, idle sway, a lateral push-pull with roll wobble,
  rig recoil, articulated two-segment fingers, and a floor-contact solve that nudges the
  head so the bristles meet the boards.
* Genuine gaps, verified in code: **no separate viewmodel camera** (the tool renders in
  the main camera at the main FOV); **no surface-normal alignment** (`cleaningAim` is a
  floor-plane projection with no normal); **no look-velocity spring inertia** (bob is
  time-based); the contact solve samples only the flat floor constant, so heads can
  still clip furniture.

### Interaction feel

* **Cleaning contact is frequently refused near fixtures.** During the recorded sweep,
  samples returned `blocked` or `occluded` at several positions while the player was
  visibly working the floor (`data/baseline-broom-video.json`). Successful strokes
  returned `did` 0.24–0.31.
* **The aim window is narrow and unforgiving.** The contact point is
  `eyeHeight / tan(−pitch)` ahead and is discarded past the tool's reach. A first
  capture route at a natural-looking pitch of −0.34 produced 45 seconds of sweeping in
  which the broom never once touched a cluster. A player who does not look steeply
  enough down gets no feedback and no explanation.
* **Neglect does not read.** The shop is `condition 10/100 — "filthy"` with
  `grime` mean 0.757 across 104 cells, yet the floor in `09-floor-dirt-read.png` looks
  close to clean. The gap between the simulated dirt state and the visible dirt state is
  the single largest presentation failure found, and it undermines the entire
  before/after premise of the slice.

### Logic

* **OBS-1 — leaving the laptop does not restore the camera lens.** Escape correctly
  returns `view` to `course` and the screen to `desk`, but `camera.fov` stays at the
  laptop's **34°** instead of the walk FOV **66°**, and stays there permanently.
  Reproduced in two independent scripts. Evidence in
  `data/baseline-systems-video.json` and `data/baseline-performance.json`
  (`laptopEntry.fovAfterExit: 34`). **Not fixed** — Phase 0 does not change gameplay
  code.
* `state.campaign.cleaningToolsUsed` remained `{}` after a sweep that returned
  `did > 0`, even though `recordCampaignCleaning` is called on success
  (`clubhouse.js:5268`) and `campaign.enabled` was `true`. Not investigated further.
* Pressing the interact verb at the counter did not flip `register.isActive()` in the
  recorded pass; the focus-label probe did not match a register prop from the positions
  tried. Whether this is a harness aiming problem or a real interaction issue is
  **unresolved**.
* `src/render3d/clubhouse/customers.js` (1,323 lines) and `src/data/customerSockets.js`
  are dead code. The registry `audio:` cue tables are dead data.

### Performance

Measured on an **RTX 5080** — not a minimum-spec statement.

* Averages are comfortable everywhere: 98–120 FPS, 8.4–10.2 ms.
* **1 % lows are the real story**: 30.8 FPS spinning in place, 34.2 walking-and-spinning,
  36.7 in the live 16× scenario. Four of seven scenarios drop into the 30–46 FPS band.
* **Worst single frame 216.6 ms** during `spin-interior`. Fast camera movement is the
  worst case, most plausibly the 100 ms shadow re-fit plus culling churn across a
  ~3,450-object interior subtree. Not isolated.
* **Time to first interactive frame is 18.2 s**, of which ~13 s elapses *after* the
  clubhouse already exists.
* Draw calls scale sharply with framing: 676 walking → 3,015 at the entrance sightline
  → 7,340 in the live scenario.
* Sweeping is cheap — the best 1 % low of any scenario (96.5 FPS). Cleaning feedback is
  not a performance problem today.

### Unknown / needs human review

* Whether the "Close Laptop" button restores the FOV correctly (only Escape was tested).
* Whether the register interact failure above is real or a harness artifact.
* Whether the empty merchandise fixtures are intended at the starting state or a
  stocking bug.
* Whether the orange floor outline in `10` is intended to be visible in normal play.
* Minimum-spec behaviour — completely unmeasured.
* Texture memory in bytes — not obtainable from WebGL.
* Audio quality. Nothing was captured; all audio is synthesised WebAudio.
* Save/reload behaviour — not exercised by this baseline.

---

## 5. Blockers

Things Phase 1 must know before it starts.

1. **`Designs/` was entirely untracked.** `.gitignore` excluded `/Designs/`, so
   `SLICE_BRIEF.md` and `ANTI_SLOP_CHECKLIST.md` — the documents the brief calls the
   permanent source of truth — existed **only on this machine's disk** and were in no
   commit. `git status` reported "clean" for exactly that reason.
   **Action taken:** `.gitignore` was changed from `/Designs/` to `/Designs/*` plus a
   narrow, commented negation for `/Designs/ProShop/` (and its baseline videos, since
   `*.webm` is also globally ignored as generated QA evidence). All other `Designs/`
   content remains ignored, verified with `git check-ignore`.
   **This is a deviation from "commit only the Phase 0 baseline package" and from
   "no ignored junk staged", made deliberately** because the alternative was a Phase 0
   whose evidence could not be committed at all. Reverse it if you disagree — the tag
   `pro-shop-pre-rebuild-baseline` is unaffected either way.
2. **OBS-1 (laptop FOV) contaminates any capture taken after a laptop visit.** Until it
   is fixed, every capture harness must assert `camera.fov === walk.state.fov` before
   shooting, and performance routes must run the laptop scenario last. The first
   performance run of this session was discarded for exactly this reason.
3. **The new-game seed is random** (`src/main.js:2829`). Terrain, and therefore the
   clubhouse's world Y, differ every run; world coordinates are not reproducible and
   anything seen through a window changes. All Phase 0 poses use local coordinates
   relative to the live `interior.position`. Comparison runs should seed explicitly.
4. **`tools/qa/shoot-clubhouse.js` is stale.** Its `L2W` helper hardcodes `(x−8, z+228)`,
   which does not resolve to this room. Do not reuse it or trust output derived from it.
5. **`shopLayout.js` changes ripple into sim, renderer, nav and tests at once.** The A/B
   plan recommends greyboxing inside the existing datums first.
6. **`reno.grime` is exactly 104 cells.** Changing room dimensions without a resample
   migration corrupts saved cleaning progress.
7. **`clubhouse.js` and `merch.js` are hot shared files** across parallel sessions.
   Stage single hunks.
8. **No performance threshold exists yet.** The brief defers budgets to these
   measurements, so no pass/fail is claimed. §8 of `BASELINE_PERFORMANCE.md` proposes
   candidates for human approval.

---

## 6. Human review required

Please inspect, in this order:

1. **`Baseline/screenshots/09-floor-dirt-read.png`** — confirm the finding that a
   "filthy" 10/100 room does not look dirty. This is the most consequential observation
   in the report.
2. **`Baseline/screenshots/01-entrance-looking-inward.png`** — confirm the entrance
   sightline is blocked by the counter.
3. **`Baseline/screenshots/02-wide-room-overview.png`** and **`06-main-merchandise-wall.png`**
   — judge whether the empty fixtures are intended at the starting state.
4. **`Baseline/screenshots/10-back-of-room-clutter.png`** — confirm the blank partition
   and the orange floor outline, and decide whether that marker should be visible in play.
5. **`Baseline/video/baseline-broom-interaction.webm`** — judge the current broom feel
   for yourself. The code review says it is well beyond a static offset; whether it
   *feels* good is a human call and this agent must not make it.
6. **`Baseline/video/baseline-laptop-checkout-customer.webm`** — watch the laptop exit
   and confirm the FOV never returns to normal (OBS-1).
7. **`BASELINE_PERFORMANCE.md` §8** — approve or reject the candidate budgets, and rule
   on whether 30.8 FPS at the 1 % low is acceptable given the averages sit near 100+.
8. **`AB_SCENE_PLAN.md` §1** — approve the `pine-hills-v2` variant approach before any
   room code is written.
9. **Blocker 1 above** — confirm or reverse the `.gitignore` change.

**Silence is not approval.** Phase 1 must not begin until you say so.

---

## 7. What was deliberately not done

Per the stopping rule: Phase 1 was not started; no art bible was written; no asset,
material, lighting, broom, interaction or room change was made; the old room was not
deleted or modified; and **none of the defects found above were fixed**, including
OBS-1.

The only files added outside `Designs/ProShop/` are the four
`tools/qa/proshop-baseline-*.js` capture scripts, which contain no gameplay code and
exist so a later session can reproduce this evidence, plus the `.gitignore` change
described in Blocker 1.
