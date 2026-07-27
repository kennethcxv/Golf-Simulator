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
| Machine-readable capture data | 5 JSON | `Baseline/data/` |
| Interactable census (47 labelled props) | 1 | `Baseline/data/baseline-open-questions.json` |
| Camera transforms | 10 poses | `BASELINE_CAMERA_TRANSFORMS.md` |
| Test protocol | 1 | `BASELINE_TEST_PROTOCOL.md` |
| Integration map | 1 | `CURRENT_INTEGRATION_MAP.md` |
| A/B plan | 1 | `AB_SCENE_PLAN.md` |
| Capture scripts (new, non-gameplay) | 5 | `tools/qa/proshop-baseline-*.js` |

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
* Merchandise fixtures are largely empty at the starting state — long runs of bare
  black pegboard and empty shelving dominate the merchandise wall (`02`, `06`).
  **Confirmed intended at review**: you have just bought the clubhouse and have not
  stocked it. This is *not* a defect. It is recorded only because empty fixtures are
  a large share of the entrance sightline, so the rebuild has to make bare shelving
  read as "opportunity" rather than "unfinished".
* The back-of-room corner has no legible purpose: boxes, a bin, an office desk and a
  course map compete without hierarchy (`10`).
* An orange rectangular outline is drawn on the floor in the back area (`10`).
  **Corrected after investigation**: this is deliberate, not a debug artifact. It is a
  campaign marker from `clubhouse/campaignWorld.js:45 outlineMarker()` — burnt orange
  `0xb66d3d` for the eight repair sites, warm tan `0xc59a4a` for the eight facility
  install sites. Markers hide themselves once the work completes and recolour as repair
  progresses (`campaignWorld.js:185-197`), so they are transient quest affordances.
  The fair criticism is only that they are *styled* as a wireframe box plus a cylinder
  corner pip, which reads as programmer art beside the rest of the room — an art note
  for Phase 3/5, not a bug.
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

* **OBS-1 — leaving the laptop does not restore the camera lens.** Now tested on **both**
  exit routes (`data/baseline-open-questions.json`):

  | Exit route | on enter | in laptop | after exit | after moving again |
  |---|---|---|---|---|
  | "Close Laptop" button | 66 | 34 | **34** | **34** |
  | Escape key | 66 | 34 | **34** | **34** |

  A second enter-and-exit cycle does not recover it either. `view` returns to `course`
  and the screen to `desk` correctly — only the lens is stranded, permanently, for the
  rest of the session.

  Crucially **`walk.state.fov` stays 66 throughout** while `camera.fov` sits at 34, so
  the intended value is never lost: something writes `camera.fov = LAPTOP_FOV` on entry
  and nothing writes it back on exit. That makes this a small, well-scoped fix rather
  than a design question. **Not fixed** — Phase 0 does not change gameplay code.
* `state.campaign.cleaningToolsUsed` remained `{}` after a sweep that returned
  `did > 0`, even though `recordCampaignCleaning` is called on success
  (`clubhouse.js:5268`) and `campaign.enabled` was `true`. Not investigated further.
* **The register works — the earlier miss was my harness, now resolved.** With a
  customer waiting (`flow: WaitingForCashier`, `hasTx: true`), the interact verb opens
  register mode correctly and advances the flow to `WaitingForScan`. My first probe
  searched focus labels matching `/register|till|checkout|counter/`, and the prop is
  labelled **"Tee desk — [E] arrivals, check-in & walk-ins"**, so nothing matched.
  A full interactable census of the room (47 labels, in
  `data/baseline-open-questions.json`) confirms there is no separately-labelled till.
  *Observation for the slice:* one prop labelled for "arrivals, check-in & walk-ins" is
  also the only way to serve a shop customer holding golf balls. That wording does not
  advertise the till, which is a discoverability weakness rather than a bug.
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

Four items previously listed here were resolved during review and are recorded above:
the "Close Laptop" button fails exactly as Escape does; the register works and the miss
was my harness; empty fixtures are intended; the orange outline is a deliberate campaign
marker. What remains genuinely open:

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
   whose evidence could not be committed at all.
   **Confirmed at review: kept.**
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
8. **The deep frame-time dips are a defect to fix, not a budget to preserve.** Ruled at
   review: averages of 98–120 FPS are fine, but 1 % lows of 30.8 FPS and a 216.6 ms worst
   frame are not acceptable on this hardware. Phase 1 should treat `spin-interior` as a
   bug to diagnose — the prime suspects, unisolated, are the 100 ms shadow re-fit and
   culling churn across the ~3,450-object interior subtree. See `BASELINE_PERFORMANCE.md`
   §8.
9. **The broom fails its review** (§6). Phase 6 must deliver player-attached framing, no
   geometry interpenetration, and correct look-down behaviour.

---

## 6. Review outcome

The baseline was reviewed by the user on **2026-07-27**, including a live pass through
the running game. Verdicts as given:

| Item | Verdict |
|---|---|
| Do the screenshots match the live game? | **Yes** — baseline confirmed honest |
| Entrance sightline blocked by the counter | **Confirmed**; the whole clubhouse is to be revamped |
| Floor dirt does not read as filthy | **Agreed**, but shot 09 was badly framed — re-shot (below) |
| Broom feel | **FAIL** — see below |
| Performance | Good on average, but **the deep lows are a defect, not a budget** |
| `.gitignore` deviation | **Keep it** (agent's discretion) |
| A/B plan — `pine-hills-v2` variant | **Approved** |
| Empty merchandise fixtures | **Intended** — you have just bought the clubhouse |
| Orange floor outline | User expected it to be unintended; investigation showed it is a deliberate self-clearing campaign marker |

### Broom verdict — FAIL

In the user's words, the broom *"is completely detached from the person and just has
some floating hands in front of it"*. Requirements stated at review:

1. It must be **attached to the player**, in the manner of House Flipper — not a tool
   floating in front of disembodied hands.
2. It **must not pass through tables and other geometry**.
3. **Looking down (and around) with the broom must work properly.**

This overrides the code-level assessment in §4, which found authored clips, sockets,
bob, sway and recoil present. Those exist, but the player-facing result is still read as
detached — and the player-facing result is what counts. Notably, all three complaints
map onto gaps the code review had already identified: no separate viewmodel camera, no
surface-normal alignment, a contact solve that samples only the flat floor constant, and
`floorAnchored: true` holding the head pinned to the floor plane while the view pitches.

This is **Phase 6** work (one polished cleaning tool). It is recorded here, not fixed.

### Shot 09 was re-framed

The original pose stood beside the counter, which then filled most of the frame and
reduced the floor to a corner detail. It has been re-shot from open floor at local
(−4.0, −1.0) looking −X, pitch −0.66, so the boards fill roughly 80 % of the image with
the `Shop condition 10 — filthy` badge legible top-right. Grime there reads 0.927 and
the room's dirtiest cells reach 0.947, so the framing is aimed at genuinely dirty floor.
Shots 01–08 and 10 keep their original poses; all ten were re-captured in one pass so
the set stays internally consistent.

### Still open

* **Phase 1 has not been authorised.** The brief requires each phase to be named
  explicitly. Silence is not approval.
* Minimum-spec performance behaviour remains unmeasured.

---

## 7. What was deliberately not done

Per the stopping rule: Phase 1 was not started; no art bible was written; no asset,
material, lighting, broom, interaction or room change was made; the old room was not
deleted or modified; and **none of the defects found above were fixed** — not OBS-1, not
the frame-time dips, not the broom, not the marker styling.

The only files added outside `Designs/ProShop/` are the five
`tools/qa/proshop-baseline-*.js` capture and diagnostic scripts, which contain no
gameplay code and exist so a later session can reproduce this evidence, plus the
`.gitignore` change described in Blocker 1.

Work done during the review pass, all of it evidence-only:

* Re-shot the ten screenshots in one pass with shot 09 re-framed (§6).
* Added `tools/qa/proshop-baseline-open-questions.js` to resolve the two open questions,
  producing `data/baseline-open-questions.json` including a full interactable census.
* Traced the orange floor marker to `clubhouse/campaignWorld.js` and corrected §4.
* Recorded the user's verdicts in §6 and the performance ruling in
  `BASELINE_PERFORMANCE.md` §8.
