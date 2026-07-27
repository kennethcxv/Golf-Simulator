# Pro-Shop Phase 0 — A/B Scene Plan

How to build the new benchmark room **alongside** the current one so both can be
entered, photographed and measured under identical conditions.

This is a plan only. Nothing here is implemented, and Phase 0 does not implement it.

> **Status: approved by the user on 2026-07-27.** The `pine-hills-v2` variant approach in
> §1 is the agreed A/B mechanism. Approval covers the *strategy* only — Phase 3 still
> needs its own greybox review gate before any hero asset work begins, and Phase 1 has
> not been authorised.

---

## 1. The key finding: the mechanism already exists

`src/render3d/clubhouse.js:542-552` already resolves which interior to build:

```js
// ?clubhouse=<variant> query override, else state.property.clubhouseVariant
// accepted: 'mountain-lodge' | 'legacy' | 'pine-hills' | 'shed'
// default:  'modern-public'
```

The starter is `pine-hills` (`src/data/marketplace.js:71`). The `shed` variant proves
an entirely separate interior can coexist with the legacy one — it even installs a
whitelist trap (`clubhouse.js:587-608`) that force-hides every non-shed child.

**Recommendation: add a new variant rather than inventing a parallel scene system.**
It reuses a tested seam, keeps one world and one save format, and makes A/B a
one-token change.

| | |
|---|---|
| **New variant id** | `pine-hills-v2` |
| **New module** | `src/render3d/clubhouse/pineHillsV2Interior.js` |
| **Old room** | untouched — `pineHillsInterior.js` keeps building `pine-hills` |
| **Enter the old room** | default. `?clubhouse=pine-hills`, or just start a normal game |
| **Enter the new room** | `?clubhouse=pine-hills-v2` |

`main.cjs:73-77` already permits same-document navigation with a query string
(`?scene=shed` is the precedent), so the Electron build can reach the new room too.

### Should there be a debug selector?

**Yes, but only the query parameter.** It is already implemented, already trusted by
the Electron navigation guard, requires no UI, and cannot be reached by a player who
is not deliberately typing it. Do **not** add a settings toggle or a menu entry during
the benchmark — a player-facing switch turns an internal comparison into a shipped
feature and creates a save-compatibility surface that does not need to exist.

Optionally allow `state.property.clubhouseVariant = 'pine-hills-v2'` on a *new* save
once the room is stable, so the benchmark can be played end-to-end without a URL.
Do not migrate existing saves onto it until the removal conditions in §9 are met.

---

## 2. What the two rooms must share

The new room is a **presentation swap**, not a new simulation. These stay common:

| Contract | Where | Why it must not fork |
|---|---|---|
| `src/data/shopLayout.js` datums | `SHELL`, `INTERIOR`, `DOOR_MAIN`, `FRONT_DESK_FRAME`, `COUNTER`, `REGISTER`, `queueSlot`, `FIXTURES`, `RENO.room` | Sim, renderer, nav and tests all read them |
| `isInside`, `groundYAt`, `suppressesGroundCoverAt`, `doorWorld` | `clubhouse.js` API | Gate cleaning, tool belts, shadow policy, grime, GTAO exclusion |
| `addCol` / `addProp` registration | `clubhouse.js:742-797` | The only navigation authority |
| `cleanWithTool` + `applyCleaningTool` | `clubhouse.js:5226`, detail-interior seam `:1241` | Cleaning dispatch |
| The whole `register` surface | `simplifiedRegisterMode.js` | 20+ tests and the QA drivers pin it |
| Laptop rig surface | `laptopPose/Lid/Boot/Screen/ScreenCorners/Rig` | DOM projection depends on it |
| Save schema | `state.shop.*` | Both rooms must load the same save |

**Strong recommendation: do not change `shopLayout.js` in Phase 3.** Greybox the new
room *inside the existing footprint and datums* first. If the layout genuinely must
change, that is a separate, explicitly-approved change with a `reno.grime` resample
migration attached (§6).

---

## 3. Integration boundaries

### 3.1 Checkout boundary

The counter **mesh** is free to be replaced. The **frame** is not.

Everything about register interaction — camera poses, the swept-segment scan volume,
staging and bagging rects, drawer travel, monitor and terminal screen projections,
queue slots — derives from `FRONT_DESK_FRAME` (`shopLayout.js:207`) via
`frontDeskPose/Point/Vector`.

* **Allowed**: new counter geometry, new millwork, new materials, new register kit
  placement *as long as* `REGISTER.*` anchor points still land on real surfaces.
* **Required**: call `B.register.attachScreen/attachTerm/attachScanner/attachPrinter`
  with the new meshes, exactly as `fixtures.js:1948-2010` does. Devices carry live
  CanvasTextures on named faces (`POS_Screen` etc.).
* **Required**: keep `refreshCheckoutAvailability` (`clubhouse.js:1417`) wired so the
  campaign facilities `frontCounter` / `registerHardware` still gate visibility.
* **Forbidden**: moving `FRONT_DESK_FRAME` without re-deriving reach circles and
  re-running `tests/checkout-space.test.js`.

### 3.2 Laptop boundary

The laptop is **procedural, not a GLB** (`src/core/laptopRig.js`). The new room supplies
a worktop at `FRONT_DESK.laptop` and nothing else.

* Keep the 1024 × 640 16:10 screen contract and corner order `[tl, tr, br, bl]`.
* Keep the seat pose reachable and unobstructed — the focus camera has no collision,
  but the player must be able to stand where the `[E]` prop takes focus.
* **Fix OBS-1 first or explicitly defer it.** Leaving the laptop strands the camera at
  34° FOV — confirmed on **both** exit routes ("Close Laptop" button and Escape), and a
  second enter/exit cycle does not recover it. `walk.state.fov` stays correct at 66
  throughout, so only the lens write-back is missing. Any A/B screenshot taken after a
  laptop visit in the same session will be at the wrong FOV. Until it is fixed, every
  capture harness must assert `camera.fov === walk.state.fov` before shooting.

### 3.3 Cleaning-system boundary

* `reno.grime` is exactly **104 cells (13 × 8)** over `RENO.room`. Keep the room
  dimensions and the grid is untouched.
* The floor dirt plan (`clubhouse/dirt.js`) is hardcoded against `DOOR_MAIN`,
  `TRAFFIC_PATHS`, `FIXTURES` and `MAT`. A new fixture layout needs a matching new dirt
  plan or grime will paint where nothing walks.
* Overlays live at **y 0.026 (grime) and y 0.028 (wet)**, renderOrder 3 and 4. The new
  floor mesh must sit below them and must not z-fight.
* The held-tool contact solve assumes a **flat floor** (`courseScene.js:8281`). No
  steps, ramps or split levels in the benchmark room without reworking that solve.
* Keep the visual name whitelist alive: `DebrisGritInstances`, `DebrisLitterInstances`,
  `WetFloorOverlay`.
* `PINE_HILLS_CLEANUP_POSES` are hand-authored x/z/radius against the current
  architecture. Moving walls orphans them; the new room needs its own pose table.

### 3.4 Customer-routing boundary

* Nav is a grid A* rebuilt off `colVersion`. **Every solid surface must register an
  analytic collider** — GLB collision is contractually inactive.
* Door colliders must keep the `door` flag or the doorway becomes a wall.
* Queue slots come from `shopLayout.queueSlot`; keep the approach corridor clear.
* Re-test in **both** neglected and restored states, and repeatedly — the anti-slop
  checklist explicitly requires the route be tested more than once.

---

## 4. Asset and namespace isolation

Keep every new asset in its own tree so the old room is provably untouched and so a
rollback is a directory delete.

```
asset_sources/proshop_v2/**          Blender sources
Assets/proshop_v2/glb/**             canonical exports
Assets/proshop_v2/previews/**        reference renders
vendor/models/proshop_v2/**          runtime tree the game loads
```

Naming: `pv2_<family>_<name>_v<N>.glb`, e.g. `pv2_counter_main_v1.glb`.

* **Do not** add files to `vendor/models/clubhouse/` or `vendor/models/checkout/`.
* **Do not** modify any existing GLB.
* **Do not** extend `assetsRegistry.js` — it enforces exactly 50 assets
  (`:33-38`) and the benchmark is not part of the 51-100 sheet programme.
* Load through `CachedGLTFLoader` (`src/render3d/gltfCache.js`), not the plain loader —
  the benchmark should not add uncached loads.

---

## 5. Material-library isolation

`src/render3d/clubhouse/materials.js` (822 lines) is canvas-procedural and shared by
every builder, created once per `makeClubhouse`. **Do not edit it.**

Instead add `src/render3d/clubhouse/proshopV2Materials.js` exporting
`makeProShopV2Materials(clubName)`, and pass the result only into the v2 builder. Two
consequences to accept deliberately:

* Materials will **not** be shared between the two rooms, so the A/B comparison
  measures the new material library honestly rather than a hybrid.
* Baseline material count is **815 unique materials / 227 unique textures**. The brief
  requires a *limited* library, so the v2 room should come in well under that; track it
  in every performance capture.

---

## 6. Save-state risks

| Risk | Mitigation |
|---|---|
| `reno.grime` length is exactly 104 | Keep room dimensions. If they change, write a resample migration modelled on the 7×5→13×8 precedent at `sim/shop.js:131-154` |
| Fixture ids are persisted in `shop.layout` and `FURNISHED_CLUBHOUSE_FIXTURE_IDS` | Reuse existing fixture ids; do not rename |
| `reno.wet` / `reno.solution` silently reset on room-size change | Acceptable (cosmetic, re-derived) but state it in the phase report |
| Campaign repair sites, debris spots and facility markers are authored in interior-local coordinates | The v2 room must place equivalents or the starter loop softlocks |
| Both rooms must load the same save | Never fork `STATE_SAVE_KEYS` or `SAVE_VERSION` for the benchmark |

**Acceptance test**: save in the old room, reload with `?clubhouse=pine-hills-v2`, and
confirm cleaning progress, stock, drawer and campaign state all survive — then the
reverse. That round trip is the real proof the swap is presentation-only.

---

## 7. Duplicating the fixed cameras

The Phase 0 capture script already expresses every pose in **local room coordinates**
relative to the live `interior.position`, which is exactly what makes it reusable:

```bash
# old room
HEADED=1 node tools/qa/run-playwright.cjs tools/qa/proshop-baseline-capture.js

# new room — same poses, same settings
HEADED=1 BASELINE_VARIANT=pine-hills-v2 \
  BASELINE_OUT=Designs/ProShop/Benchmark/screenshots \
  node tools/qa/run-playwright.cjs tools/qa/proshop-baseline-capture.js
```

To enable that, Phase 3 needs one small change to the capture script: read an optional
`BASELINE_VARIANT` env var and append `?clubhouse=<variant>` to the boot URL. The pose
table, FOV, resolution, clock pin and settle timings stay byte-identical, which is what
the anti-slop comparison gate demands.

Poses that must not drift: the ten in `BASELINE_CAMERA_TRANSFORMS.md`. If the new room
makes a pose meaningless (for example the merchandise wall moves), **keep the old pose
and add a new one** rather than silently re-aiming — a changed camera cannot be used to
hide a regression.

---

## 8. Keeping the performance comparison fair

Run `tools/qa/proshop-baseline-performance.js` against both variants with the same
variant flag, on the same machine, in the same session.

Non-negotiables:

* Same GPU, same resolution (1600 × 900), same DPR (1.0), same FOV (66).
* Clock pinned to 13:00, `speedIdx = 0`, except the deliberate 16× scenario.
* 3 runs per scenario, compare **1 % lows and worst frames**, not just averages — the
  baseline averages 100–120 FPS on an RTX 5080 while dipping to 30.8 FPS at the 1 % low,
  so averages alone will hide a real regression.
* Keep `laptop-open` last, and keep asserting the FOV restore, until OBS-1 is fixed.
* **The seed is random per new game** (`main.js:2829`), so the terrain outside the
  windows differs between runs. Either seed the empire explicitly for comparison runs,
  or take enough runs that terrain variance is visible in the spread. Interior-only
  scenarios are the trustworthy ones until this is addressed.
* Report both rooms' numbers side by side in one table, as the anti-slop comparison
  gate requires.

---

## 9. Conditions required before the old room may be removed

All of these, with no exceptions, per `SLICE_BRIEF.md` §8 and §15 and the anti-slop
final approval gate:

1. The user has **explicitly approved** the new benchmark room in writing.
2. Side-by-side screenshots exist for all ten fixed poses at identical settings, and a
   human has confirmed the new room is clearly better.
3. Side-by-side performance tables exist for all seven scenarios, with no unapproved
   frame-time regression over 10 %, and no new recurring stutter.
4. The full player sequence runs end to end in the new room: enter → clean → restore →
   checkout → laptop → serve a customer → save → reload.
5. Save round-trip passes in both directions (§6).
6. These suites pass against the new room: `checkout-space`, `customer-nav`,
   `laptop-seat` / `laptop-rig` / `laptop-projection`, `register-*`, `shop-reno`,
   `clubhouse-restoration-actions`, `props-71-100-placement`, and the save-reload
   matrices.
7. The customer route has been tested repeatedly, in neglected **and** restored states.
8. No placeholder remains in the benchmark area.
9. The anti-slop checklist is completed with every applicable item PASS, and all
   deviations documented.
10. The `pro-shop-pre-rebuild-baseline` tag still resolves, so the old room remains
    recoverable from git regardless.

Until every one of those holds, `pineHillsInterior.js` and the `pine-hills` variant
stay in the tree and stay reachable.

---

## 10. Recommended phase sequence

| Phase | A/B action |
|---|---|
| 1 | Classify systems. Confirm the variant seam is the right hook; do not write room code |
| 2 | Art bible. Define the v2 material families and dimensions |
| 3 | Add `pine-hills-v2` variant + greybox inside the **existing** datums. Add `BASELINE_VARIANT` to the capture script. Stop for approval |
| 4 | Hero assets, one per session, each compared against the old room at a fixed pose |
| 5 | v2 material library + lighting; capture both rooms before and after |
| 6 | Broom polish; compare against `baseline-broom-interaction.webm` |
| 7 | Wire checkout / laptop / inventory / customers / save into the v2 room |
| 8 | Final benchmark review; only then consider §9 |
