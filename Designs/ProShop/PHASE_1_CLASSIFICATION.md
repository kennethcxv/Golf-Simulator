# Pro-Shop Phase 1 — Bounded Reality Check

Phase 1 of `SLICE_BRIEF.md`. Inspects **only** the systems the benchmark slice needs and
classifies each. No implementation, no redesign, and **nothing was fixed** — including
the defects found below.

Baseline evidence this builds on: `Designs/ProShop/Baseline/`.
New evidence produced by this phase: `Designs/ProShop/Phase1/data/`.

---

## Classification key

| Bucket | Meaning |
|---|---|
| **PRESERVE** | Works. Do not touch it. |
| **PRESERVE LOGIC, REPLACE PRESENTATION** | The simulation is sound; the visible layer is what gets rebuilt. |
| **MINOR LOGIC FIX REQUIRED** | A specific, small, evidenced defect must be fixed. |
| **REBUILD ONLY IF PROVEN BROKEN** | Do not rebuild on suspicion; rebuild only against evidence. |

---

## Summary table

| # | System | Classification | Defect | Evidence |
|---|---|---|---|---|
| 1 | Starter clubhouse construction | PRESERVE LOGIC, REPLACE PRESENTATION | — | §1 |
| 2 | Cleaning logic | **MINOR LOGIC FIX REQUIRED** | CLEAN-1 | §2 |
| 3 | Broom logic | PRESERVE LOGIC, REPLACE PRESENTATION | — (presentation only) | §3 |
| 4 | Dirt state | PRESERVE | — | §4 |
| 5 | Checkout integration | PRESERVE LOGIC, REPLACE PRESENTATION | LAPTOP-1 latently | §5 |
| 6 | Laptop integration | **MINOR LOGIC FIX REQUIRED** | LAPTOP-1 | §6 |
| 7 | Customer route | PRESERVE LOGIC, REPLACE PRESENTATION | — | §7 |
| 8 | Save and reload | **PRESERVE** — verified by test | — | §8 |
| 9 | Asset loading | PRESERVE | — | §9 |
| 10 | Materials | PRESERVE LOGIC, REPLACE PRESENTATION | — | §10 |
| 11 | Lighting | PRESERVE LOGIC, REPLACE PRESENTATION | LIGHT-1 | §11 |
| 12 | Performance tooling | PRESERVE | PERF-1 | §12 |

**Nothing needs rebuilding.** No system landed in "REBUILD ONLY IF PROVEN BROKEN" — none
was proven broken. Two systems need a small logic fix, both one-liners; two more carry
minor defects in lighting config and QA tooling. Everything else is a presentation rebuild
sitting on sound simulation, which is the outcome the brief hoped for and did not assume.

The three findings most likely to change Phase 2–5 plans:

1. **The room looks flat because nothing indoors casts a shadow** (§10) — not because it has
   too many materials. Reducing the material count will not change the look.
2. **The requested soft shadows have never shipped** (§11) — three.js r185 silently coerces
   `PCFSoftShadowMap` to `PCFShadowMap` at first render.
3. **The broom complaints are all presentation** (§3) — the simulation underneath is correct,
   so Phase 6 is a viewmodel/rig problem, not a rewrite.

### Contract-test baseline — 189 / 189 passing

Every test that pins a system in this slice currently passes, run this phase:

```
node --test tests/campaign.test.js tests/checkout-space.test.js \
  tests/cleaning-debris.test.js tests/cleaning-disposal-wiring.test.js \
  tests/cleaning-save-persistence.test.js tests/cleaning-tool-registry.test.js \
  tests/cleaning-tool-state.test.js tests/cleaning-wet-solution.test.js \
  tests/clubhouse-restoration-actions.test.js tests/clubhouse-restoration-state.test.js \
  tests/customer-nav.test.js tests/inventory-conservation.test.js \
  tests/laptop-pages.test.js tests/laptop-projection.test.js tests/laptop-rig.test.js \
  tests/laptop-seat.test.js tests/register-flow.test.js tests/save-stability.test.js \
  tests/shop-reno.test.js
# tests 189 / pass 189 / fail 0   (36.7 s)
```

**This is the Phase 7 acceptance gate.** Re-run this exact command against the new room;
any failure is a regression introduced by the rebuild, not a pre-existing condition.

Worth stating plainly: the two defects found in this phase are **not** caught by any of
these tests. CLEAN-1 is invisible to them because no test asserts campaign tool
attribution, and the laptop FOV defect is invisible because no test asserts lens
restoration on exit. A green suite is necessary, not sufficient.

---

## 1. Starter clubhouse construction — PRESERVE LOGIC, REPLACE PRESENTATION

The orchestration is the machinery a new room must ride on; the visible shell and
dressing are the replaceable skin. The brief's §2.2 explicitly licenses replacing the
latter, and the architecture already supports a room swap.

**Preserve — this is the chassis:**

* `makeClubhouse(ctx)` (`clubhouse.js:524`), the roots `group` / `interior` / `custGroup`
  (`:566-611`), `L2W`/`W2L` (`:613-614`) and `isInside` (`:617-619`).
* **The wrapped `interior.add`** (`:578-608`), which strips `castShadow` from everything
  indoors. The comment records why: it measured ~27 % of the shadow bake across 1,300+
  caster meshes. New room content must flow through this funnel or the 10 Hz bake
  re-inflates.
* **The nine fallback visibility handles** (`shell.js:45-55` `PRODUCTION_VISUAL_FALLBACK_KEYS`,
  frozen registry at `:1155-1165`). Sheet-6 leases these atomically
  (`sheet06ProductionRuntime.js:425-465`); a replacement shell that does not expose the
  same nine keys makes activation **fail closed** (`FALLBACK_MISSING`) — which is the
  correct failure mode, but it must be understood.
* Disposal ownership (`clubhouse.js:10160-10222`), which protects merch-owned,
  props-61-100 and Pine Hills cache-owned resources from double-free.
* The 80 yd interior draw gate (`:410`), pinned for exactness by
  `tests/editor-prewarm-light-variants.test.js:19`.

**Replace — this is the skin:** `createPineHillsInterior` (`pineHillsInterior.js:857`) —
the warm-oak floor, neglect visuals, three live canvas boards, 11 dressing GLBs and the
cleanup poses. It consumes **zero kit materials**, so replacing it is self-contained.

**The A/B seam is real.** Variant resolution at `clubhouse.js:542-552` accepts
`?clubhouse=` and `state.property.clubhouseVariant`; the shed variant proves a substitute
room rides the same funnel (`:556-608`). This confirms the approved `AB_SCENE_PLAN.md` §1
approach is viable and needs no new machinery.

---

## 2. Cleaning logic — **MINOR LOGIC FIX REQUIRED**

### DEFECT CLEAN-1 — campaign cleaning attribution never fires for five of the nine tools

`cleanWithTool` (`src/render3d/clubhouse.js:5226`) defines a `finish()` helper at
**`clubhouse.js:5266`** whose only unique job is:

```js
const finish = (result) => {
  if ((result.did || 0) <= 0) return result;
  recordCampaignCleaning(state, toolId, result.did);   // <- the only call site that matters
  ...
};
```

`finish()` is invoked by exactly **two** of the eight success paths:

| Success path | Line | Calls `finish()`? |
|---|---|---|
| SWEEP — broom | 5285 | **no** |
| SCOOP — dustpan | 5296 | **no** |
| SUCTION — vacuum | 5307 | **no** |
| STROKE — mop | 5330 | **no** |
| CARRY — trash bag | 5364 | **no** |
| STROKE — cloth / sponge | 5345 | yes |
| SPRAY | 5351 | yes |

So `recordCampaignCleaning` never runs for **broom, dustpan, vacuum, mop or trash bag**
on the floor path. The only other attribution site is `clubhouse.js:5246`, the discrete
Pine Hills target pre-gate.

**Empirically confirmed twice.** After a full broom sweep with measured `did` of
0.24–0.31, and again after a vacuum pass that measurably reduced total grime from
**79.914 → 67.109** (condition 9 → 14), `state.campaign.cleaningToolsUsed` was still
`{}` (`Phase1/data/phase1-save-reload.json`, `Baseline/data/baseline-broom-video.json`).

**Blast radius — deliberately checked, and smaller than it first looks.**
`campaign.cleaningToolsUsed` is read at `src/sim/campaign.js:942`, feeding two derived
strings:

```js
const debrisTool = !tools.broom ? 'Push broom' : !tools.dustpan ? 'Dustpan' : ...
const floorTool  = !tools.vacuum ? 'Shop vacuum' : !tools.spray ? 'Cleaning spray' : ...
```

These are consumed **only** at `campaign.js:982` and `:990` as `tool:`, which becomes
`recommendedTool` on the objective. **No objective's `complete` condition reads
`tools.*`** — verified by scanning the whole objective list.

**Therefore the starter loop does not softlock.** The actual symptom is that the
recommended-tool hint never advances: the game permanently tells the player to use the
"Push broom" and the "Shop vacuum" no matter how long they have been using them.

**Severity:** medium — player-visible wrong guidance for the slice's headline loop, but
not blocking. **Fix size:** route the five bypassing branches through `finish()`, or call
`recordCampaignCleaning` in each. Two-to-five lines. **Not fixed in Phase 1.**

### Otherwise: sound

The dispatch architecture is genuinely good and should be preserved as-is:

* One entry point, `cleanWithTool(toolId, wx, wz, dirX, dirZ, dt, options)`, switching on
  `toolClass` — adding a tool never touches the renderer.
* The registry at `src/data/cleaningTools.js` is a real single source of truth: ids,
  classes, reach, radius, sockets, grips, belt order.
* Contact points come from the **tool's own authored socket**, not a camera offset
  (`toolSockets.js:1-14` records the bugs that caused).
* The stroke-phase gate banks skipped `dt` so `Σ gatedDt == Σ dt` — cleaning rate is
  cadence-independent (`courseScene.js:8361-8367`). Do not "simplify" this away.
* The discrete-target pre-gate before the floor gate is deliberate and fixes a real bug
  (CLEAN-SCUFF-001, `clubhouse.js:5229-5235`).

### Observed friction (not a defect, but Phase 6 input)

Cleaning contact is refused fairly often near fixtures. Across the recorded broom pass
and this phase's clip probe, results included `blocked` and `occluded` at positions where
the player was visibly working the floor. That is `cleaningGate` (`clubhouse.js:5185`)
doing its job — point-in-collider plus segment-occlusion from the camera — but the player
gets no feedback explaining the refusal.

---

## 3. Broom logic — PRESERVE LOGIC, REPLACE PRESENTATION

The user's Phase 0 verdict was **FAIL**: *"completely detached from the person and just
has some floating hands in front of it"*, must not pass through tables, and looking down
must work. Phase 1's job was to establish whether those are logic defects or presentation
gaps. **They are presentation gaps.** The simulation underneath is correct.

Measured this phase (`Phase1/data/phase1-diagnostics.json`), broom equipped, mouse held:

| view pitch | contact height above floor | contact NDC y | head on screen? |
|---|---|---|---|
| +0.20 | **+0.31 m** | −1.79 | **no** |
| 0.00 | **+0.22 m** | −1.30 | **no** |
| −0.20 | +0.14 m | −0.94 | yes |
| −0.40 | +0.08 m | −0.63 | yes |
| −0.62 | +0.03 m | −0.34 | yes |
| −0.80 | +0.00 m | −0.11 | yes |
| −1.00 | −0.00 m | +0.14 | yes |
| −1.25 | +0.02 m | +0.48 | yes |

Three findings, each mapping to one of the three complaints:

1. **"You should be able to look down with the broom."** At a level view the working end
   of the broom is **below the bottom of the screen** (NDC y −1.30 at pitch 0, −1.79 at
   +0.20). The player cannot see what they are sweeping until they pitch down past about
   −0.2 rad (≈12°), and the head only actually meets the floor at about −0.8 rad (≈46°).
   At shallow angles it hovers up to **31 cm above the boards**.
2. **"Detached from the person."** The tool's root translates about **0.6 m relative to
   the camera** across the pitch range (z offset −0.47 → +0.14) because `floorAnchored:
   true` solves the head onto the floor plane rather than anchoring the tool to the hands.
   The tool slides through your grip to stay floor-locked — which is exactly what reads
   as detachment.
3. **"Floating hands."** `src/render3d/fpHands.js:203` builds a **deliberately short
   0.11-unit forearm stub** ending in a cuff disc. There is no upper arm, no shoulder and
   no body. The source itself acknowledges the failure mode at `fpHands.js:59-62`, adding
   a 28° clamp so the sleeve does not present as "a flat green disc".

**Not verified:** geometric interpenetration of the broom mesh with furniture. I measured
contact height, not mesh intersection, so complaint 2 (phasing through tables) is
**UNVERIFIED** as a measurement. The architecture makes it entirely plausible — tool
viewmodels are parented under the main camera and rendered by the main camera with no
depth separation and no viewmodel occlusion — but I will not assert what I did not
measure.

### What must be preserved

* The registry contract (`cleaningTools.js`) — ids, tool classes, socket names, `BELT_ORDER`.
* Socket-derived contact: `SOCKET_FloorContact` drives cleaning, never a camera offset.
* The authored/procedural adoption handshake (`toolViewmodel.js:270-298`) — the procedural
  broom shows instantly so equipping never waits on I/O, and the authored GLB swaps in
  with its own sockets aligned onto the registry socket. **Registry sockets never move.**
* Stroke-phase `dt` banking.
* Reduced-motion gating.

### What Phase 6 must change

Presentation only: a viewmodel camera (or FOV/layer separation), hand-anchored rather than
floor-solved framing, arms that connect to a body, surface-normal-aware contact, and a
head that is visible at a natural working pitch.

---

## 4. Dirt state — PRESERVE

`state.shop.reno` is a clean, well-migrated data model and needs no changes.

| Field | Shape | Verified this phase |
|---|---|---|
| `reno.grime` | `number[104]` (13 × 8) | mutated 79.914 → 67.109 by vacuum, survived reload exactly |
| `reno.debris` | `{x,z,a,kind}[]`, 18 seeded, mass 3.93 | survived reload exactly, positions included |
| `reno.cleaning` | pan/bag/mop/bucket | survived reload exactly |
| `reno.clutter`, `reno.windows`, `reno.architecture`, `reno.lightPanels`, `reno.targetProgress`, `reno.cleanupMilestones` | — | all survived reload exactly |

Shop condition is **derived, never stored** (`sim/shop.js:321+`) — confirmed by watching it
move 9 → 14 as grime fell, with no stored field changing.

**Constraint for Phase 3:** `reno.grime` is exactly 13 × 8 over `RENO.room` (17.9 × 11).
Changing room dimensions without a resample migration corrupts saved progress — the
precedent to copy is the 7×5 → 13×8 resample at `sim/shop.js:131-154`. The floor dirt
*plan* (`clubhouse/dirt.js`) is separately hardcoded against `DOOR_MAIN`, `TRAFFIC_PATHS`,
`FIXTURES` and `MAT`, so a new fixture layout needs a new dirt plan or grime will paint
where nobody walks.

**The Phase 0 headline finding is a rendering problem, not a data problem.** The room is
genuinely filthy in the data — mean grime 0.757, dirtiest cells 0.947 — and simply does
not look it. That is `dirt.js`'s canvas presentation, and it is Phase 5 work.

---

## 5. Checkout integration — PRESERVE LOGIC, REPLACE PRESENTATION

Three cleanly separated layers, and only the bottom one is furniture.

* `sim/register.js` — pure money. `completeSale` is the sole banking path with idempotent
  ledger keys. Knows nothing about three.js.
* `sim/registerFlow.js` — a pure 30-state contract with validated transitions and recovery
  resolvers (`:11-42`, `:482-549`, `:674-695`). Zero geometry, zero DOM.
* `simplifiedRegisterMode.js` — the physical driver, and **100 % datum-derived**. Every
  position, camera pose, drawer travel and queue reference comes from `FRONT_DESK_FRAME`
  transforms (`:12-14`, `:229-258`). `registerCameraPoses.js:1-3` states outright that
  relocating reception cannot break the cameras.
* `fixtures.js:1738 buildCheckout` — **this is the replaceable layer**: procedural counter,
  kit GLB placement, collider registration, and the `attach*` handshake.

**The single datum that governs everything:** `FRONT_DESK_FRAME`
(`src/data/shopLayout.js:207-221`). From it derive `COUNTER` (`:435`), `queueSlot` (`:449`),
`COUNTER_TOP` = 1.055 (`:469`), and the whole `REGISTER` workspace (`:480-532`) including
the 3D scan volume at y 1.06–1.34 and the drawer's 0.44 travel. **Move the frame, never
the individual offsets.**

**Contract for a new room:**

- [ ] `FRONT_DESK_FRAME` stays the authoring datum; counter-top height matches 1.055 or the
      datum is updated in exactly one place.
- [ ] The new counter registers colliders equivalent to `FRONT_DESK_COLLIDERS`
      (`shopLayout.js:281-291`) through `addCol` — never GLB collision — preserving
      `STAFF_CORRIDOR_MIN` 1.1 behind the counter. `tests/checkout-space.test.js` must stay
      green **unmodified**.
- [ ] New hardware is handed to `attachScreen/attachTerm/attachScanner/attachPrinter` after
      placement, keeping the authored node names (`POS_Screen`, `Terminal_Screen`,
      `CARD_INSERT_SOCKET`, `SCAN_RAY_ORIGIN`, `PaperRollPivot`, `ANCHOR_Bag*`,
      `CashDrawer_Tray`…), each of which already has a procedural fallback.
- [ ] `setAvailability({counter, hardware})` (`fixtures.js:2016`) is honoured so the campaign
      reveal still works.
- [ ] Queue head stays outside `DOOR_CLEARWAY` (`shopLayout.js:66`).

---

## 6. Laptop integration — **MINOR LOGIC FIX REQUIRED**

### DEFECT LAPTOP-1 — root cause found, and it is not where I first guessed

Phase 0 observed the camera stranded at FOV 34 after leaving the laptop, on both exit
routes. The cause is a **poisoned snapshot in the walk controller**, not a missing restore:

1. `enterLaptop` sets the lens **first** — `setCameraLens(LAPTOP_FOV, LAPTOP_NEAR)`
   (`main.js:356`) — deliberately, because the seat pose is derived from the live camera
   FOV (comment at `:354-355`).
2. It then calls `walk.focusOn(pose)` (`main.js:363`). Inside,
   **`courseScene.js:6812`** does `if (!walkFocusPose && focusBaseFov == null) focusBaseFov = camera.fov;`
   — and `camera.fov` is *already 34*. The "restore this later" snapshot records the
   laptop lens.
3. `exitLaptop` **does restore correctly**: `setCameraLens(walkFov(), WALK_NEAR)` at
   `main.js:413`. At that instant the FOV really is 66.
4. ~0.4 s later the focus ease-out completes and `courseScene.js:7948-7957` runs once:
   `camera.fov = focusBaseFov` — stomping 66 back to **34**.

This explains every observation: both exit routes fail because *they are the same function
and the bug is not in it*; a second cycle cannot recover because `focusBaseFov` is
re-snapshotted from the already-wrong 34, a stable fixed point; and `walk.state.fov` stays
66 because `setCameraLens` bypasses it entirely.

**Why it never showed at the front desk:** `enterFrontDesk` (`main.js:426`) calls `focusOn`
*without* a prior lens change, so its snapshot is 66 and the restore is a harmless no-op.
Only paths that change the lens **before** `focusOn` are affected.

**Minimal fix (described, not implemented)** — one line, in `courseScene.js`, either:
snapshot `walk.fov || 66` at `:6812`, **or** restore `camera.fov = walk.fov || 66` at
`:7950-7956` and delete `focusBaseFov`. A `main.js`-only reorder is *not* viable, because
the seat pose depends on the post-change FOV.

**Everything else about the laptop is sound and should be preserved:** pure-geometry rig,
pure-homography projection with a degenerate-quad null guard, a seat pose *derived* from
live lid corners (so it follows the laptop to a new desk with no logic change), and a
1024 × 640 16:10 DOM contract. The mesh is fully procedural — there is no GLB to re-author.

**Phase 7 gate addition:** assert `camera.fov === walkFov()` and `camera.near === 0.15`
after leaving the laptop **and** the register. No existing test pins this, which is exactly
why the defect shipped.

---

## 7. Customer route — PRESERVE LOGIC, REPLACE PRESENTATION

Headless simulation plus pure A*, datum-driven at every joint. No route-logic defect found.

* `customerSimulation.js` is the persisted authority and imports neither three.js nor the
  DOM (`:1-7`), with a reload healer wired into the heal chain (`state.js:1667`).
* `nav.js` is pure A* with string-pulling (`:1-4`), rebuilt lazily from the shared collider
  registry on `colVersion` bumps (`clubhouse.js:9468-9474`).
* The live actors (`clubhouse.js:8107-9800`) build every stop from shopLayout datums via
  `L2W` — no world-space literal survives a datum move. Characters are procedural, and are
  presentation.

**Contract for a new room:**

- [ ] Every wall and furniture collider registers through `addCol` — analytic boxes are the
      only navigation authority. Unregistered geometry means customers walk through it;
      over-registered doorways become walls.
- [ ] Door colliders keep their `door` flag so `navFresh` can exclude them
      (`clubhouse.js:9470`).
- [ ] The footprint stays inside the nav bounds (building centre ±16 x, −13/+15 z,
      `:9462-9466`) or the bounds constant moves with it.
- [ ] `DOOR_MAIN`, `DOOR_CLEARWAY`, `MAT`, `BASKET_STATION`, `queueSlot` and each fixture's
      browse/stock sockets stay valid and ≥ 0.64 apart from colliders (walker diameter).
- [ ] Fixture ids keep their identities — they are persisted **and** used as route keys.
- [ ] A walkable chain exists: spawn → porch → door gap → aisle → every browsable fixture
      front → queue head → door. This is testable headlessly by running `nav.path` between
      consecutive stops once the greybox registers its colliders — **the cheapest possible
      Phase 3 gate.**

**Resolves the Phase 0 open item.** The `[E]`-at-the-counter anomaly has a non-defect
explanation: the dedicated register prop at `REGISTER.scanner` (`clubhouse.js:1679`) is
gated on `facilityInstalled('frontCounter'/'registerHardware')` (`:1681-1682`), and on a
fresh campaign start those facilities are not yet installed — so its label returns null.
The prop I *did* reach ("Tee desk") is the reception prop, which is ungated. Both my
label-regex miss and the facility gate are true; neither is a bug.

---

## 8. Save and reload — **PRESERVE** (verified)

Phase 0 never exercised this. Phase 1 did, and it passes cleanly.

Method (`tools/qa/proshop-phase1-save-reload.js`): fresh Relaxed game → fingerprint 23
state fields → mutate the world through the real tool path (vacuum at three of the
dirtiest grime cells) → fingerprint again → `app.autosave()` → full page reload → return
through the real **Continue** control → fingerprint again → diff.

**Result: 0 differences.** An 828 KB save round-tripped grime, debris (count, mass and
every position), cleaning tool state, clutter, windows, architecture components, light
panels, target progress, cleanup milestones, condition, cash, inventory shelf/back totals,
drawer, held units, campaign facilities, `uiPrefs` and save version — all exactly.

The Continue control correctly read `Continue — Pine Hills Municipal Golf · Day 1`.

This satisfies the anti-slop requirement "cleaning progress survives save and reload" for
the **current** room. It must be re-run against the new room in Phase 7, in both
directions (§ `AB_SCENE_PLAN.md` §6).

**Do not touch** `SAVE_VERSION`, `STATE_SAVE_KEYS`, the healer chain order at
`sim/state.js:1633-1677`, or the empire envelope.

---

## 9. Asset loading — PRESERVE

Every piece is deliberate, guarded, and either tested or self-verifying. Nothing is proven
broken; the known inefficiencies are levers, not defects.

* `gltfCache.js` (58 lines) — module-level promise map, clones share geometry/materials/
  decoded textures, cached hits still report virtual `itemStart/itemEnd` so the idle
  barrier stays truthful, failed loads evict, `clearGltfCache()` on scene dispose.
* **The cached-vs-plain split is the real cost.** Cached: `courseScene.js`, `merch.js`,
  `pineHillsInterior.js`. **Plain** (uncached, re-parses on every clubhouse rebuild and
  never shares material identity across files): `buildProps` (`clubhouse.js:1133`),
  `sheet06Architecture`, `propertyFurnitureVisuals`, `placeables`,
  `architecturalDoorVisuals`, `shedInterior`, and all four variant adapters. **This is the
  main mechanical source of the 815-material figure** (§10).
* `sheet06AssetCache.js` is exemplary and must be copied, not bypassed: root/socket/pivot
  validation before anything is shown, collision contract enforced at normalisation,
  metres→yards applied exactly once and re-checked, and the procedural fallback hidden
  **only after** validation *and* the initial state apply both succeed (`:562-567`).
  The room can never fail to exist.

### The 18.2 s load, explained

The ~13 s after the clubhouse object exists is owned end-to-end by `prewarm()`
(`courseScene.js:10590-10747`), in this order: wait for asset idle (bounded 8 s, fails
open) → cash-kit handshake → `renderer.compile` → `initTexture` over ~297 textures batched
24 per frame → **one full-scene draw with frustum culling disabled and a full shadow bake**
(because ANGLE defers the real compile to first draw, `:10638-10640`) → an editor-camera
warm pass with two more bakes → three 120°-apart spin frames, each with another bake.

So: six-plus forced full renders each carrying a 2048² shadow bake. **This is a deliberate
trade — load time bought to remove first-look hitches.** Which step dominates is
**UNVERIFIED**; no per-step timing exists. That matters because Phase 1 *also* measured a
200 ms first-look spike that prewarm evidently does not fully prevent (§12) — so the trade
is currently being paid without being fully collected.

---

## 10. Materials — PRESERVE LOGIC, REPLACE PRESENTATION

The material *system* is sound engineering. The material *look* is the replaceable part,
and the module's own header says so (`materials.js:5-6`: "a photo-texture pass can swap
them slot-for-slot later").

**`makeClubhouseMaterials` is per-instance, not global** — called once per `makeClubhouse`
(`clubhouse.js:804`), disposed with the instance (`:10165-10201`), and `materials.js` holds
**zero module-level mutable state**. A v2 room can own its own kit cleanly. Better still,
the four variant adapters **and** `pineHillsInterior.js` consume **zero kit materials**, so
replacing the kit touches only the starter room's own builders — exactly the rebuild target.

### Why 815 materials look flat — the two causes are unrelated

This resolves the Phase 0 observation, and the answer changes what Phase 5 should do.

**The 815 count is instance duplication, not 815 distinct looks.** Only `FILES` models get
remapped onto the shared kit; `RAW` (23), `KIT` (46), the Sheet-6 architecture GLBs, ~40
props, doors, placeables and furniture each keep one authored material set **per file**,
and the plain loader mints fresh `THREE.Material` instances even when the embedded images
are byte-identical across files — which `sharedTexturePool.js:3-5` proves they are. The
pool interns *textures*, never *materials*. Add ~300 inline one-off constructors (the 8
ceiling panels alone mint 16 materials) and the number is explained.

**The flatness has a different cause: there are no interior shadows at all.**

* RectAreaLights cannot cast shadows in three.js, and the panels additionally set
  `castShadow = false` (`shell.js:941`).
* Sun shadows are deliberately stripped from every interior mesh by the wrapped
  `interior.add` (`clubhouse.js:572-608`) and `interiorShadowPolicy.js:5-18`.
* So the **only** contact darkening indoors is GTAO — at half resolution, blend 0.4,
  radius 0.7 in walk mode.
* Meanwhile the canvas maps are deliberately low-amplitude: grain alpha 0.03–0.07, normal
  strength attenuated by `normalScale` 0.25–0.9, 256 px bases for most families.

Under an even warm wash from four rendered panels with no directional key and no shadowing,
that derived relief has nothing to catch.

> **Consequence for Phase 5: reducing the material count will not change the look.**
> The flat read is a lighting-and-amplitude problem, not a material-count problem. Treat
> them as two separate workstreams — one for hygiene/perf, one for appearance.

**Contract for a v2 kit:** same slot keys consumed by `merch.js` `SLOT`/`TINTABLE` (plus
`rugTex`, `signTexture`); tintable bases stay **neutral grey** because `color` multiplies
into `map` (a green tint on a green weave read near-black — `materials.js:764-770`);
linear data maps; tolerate the `glass.emissive` write from `setTimeMood`
(`shell.js:1107-1109`); register into the same lifecycle.

---

## 11. Lighting — PRESERVE LOGIC, REPLACE PRESENTATION

The interior rig is a save-driven state machine wearing procedural fixtures. The state
machine is preserved; the fixtures are presentation. The world/post stack is **course-global**
— changing exposure or tonemapping to flatter one room would break the brief's own
consistency requirement (§12) everywhere else, so it defaults to preservation.

**What is actually running** — and the code's header misleads about this:

* 8 RectAreaLight panels (`shell.js:914-956`), 2 accent points, 3 cool window fills, porch
  light + sconce.
* **The lanterns, recessed cans and display spots described at `shell.js:802-805` are never
  built.** `addCan` (`:809`), `addLantern` (`:832`) and `addDisplaySpot` (`:878`) have
  **zero call sites anywhere in `src/`**, so the index-gated branches at `:1037-1060` are
  all dead. ~80 lines of unreachable builders plus a header describing a rig that no longer
  exists. Hygiene issue, zero runtime cost — but actively misleading to anyone rebuilding
  the room, which is why it is recorded here.

**The contract a new room's lighting must satisfy:** the 11-method `shell.lighting` API
(`setShopTier`, `setTimeMood`, `refreshCondition`, `setWindowDirt`,
`setCeilingCircuitPowered`, `refreshRestoration`, `setCameraLocalPosition`,
`panelRenderBudget`, `updateFlicker`, …); save-driven fault states (panel-02 flickers,
panel-07 dead by default, repair must permanently stop the flicker); the campaign ceiling
power gate (`clubhouse.js:1049-1057`) — under the starter campaign **the room begins dark
until the ceiling repair beat**; exactly 4 of 8 panels rendered by `layers.mask`; the
rect-area backend, which is pinned three ways including a source-regex test
(`tests/clubhouse-lighting-compatibility.test.js:53-61`); and no interior shadow casting.

### DEFECT LIGHT-1 — the requested soft shadows have never shipped

`courseScene.js:677` requests `PCFSoftShadowMap`. The vendored three.js is **r185**, where
`WebGLShadowMap.render` coerces it: `vendor/three.module.js:9148-9151` warns and sets
`this.type = PCFShadowMap`. The mutation happens at the first shadow render, which is why
the warning fires once per boot. **The engine has been running plain PCF all along.**

Severity: minor, one line — request `PCFShadowMap` and tune `sun.shadow.radius` if softness
is wanted. **Not fixed.** But Phase 5 should know that "make the shadows softer" is
currently a no-op request, not a tuning problem.

---

## 12. Performance tooling — PRESERVE

`tools/qa/perf-probe.js` and the Phase 0/1 harnesses are sound and should be reused rather
than replaced.

### Attribution attempt for the interior spin cost

Phase 0 measured a 216.6 ms worst frame while turning, and the user ruled the deep dips a
defect. Phase 1 tried to attribute it (`Phase1/data/phase1-diagnostics.json`).

**Established, consistent across two independent runs:**

| scenario | avg ms | 1 % low ms | worst ms | frames > 33 ms |
|---|---|---|---|---|
| cold — first spin of the session | 10.6 | 70.8–72.9 | **200.0–200.1** | 7–10 |
| warm — after two full revolutions | 9.8–9.9 | 29.2–31.3 | 33.4–41.7 | 3–4 |

**The 200 ms+ spike is a first-look cost, not a recurring one.** Once every direction has
been rendered once, the worst frame drops by ~5×. It is almost certainly shader
compilation and GPU upload as unseen geometry enters the frustum for the first time —
consistent with the load-veil prewarm not covering every viewing angle.

**Not established — and I will not claim it.** Single-run A/B toggles of GTAO, bloom and
shadow-map size produced differences that fell **within run-to-run variance** between the
two runs (e.g. bloom-off showed 4 stutters in one run and 0 in the other). No single
subsystem was isolated as the cause of the recurring ~29–31 ms 1 % low. Proper attribution
needs repeated runs per toggle, which belongs in Phase 5 when lighting is actually being
changed.

### DEFECT PERF-1 — the shadow-map A/B arm measures nothing

Both `tools/qa/perf-probe.js:152-164` and the shadow arm I wrote this phase are **no-ops in
walk mode.** `fitSunShadow` already pins the map to `SHADOW_WALK_MAP = 2048`
(`courseScene.js:9482`) and re-asserts on any drift (`:9499-9508` — "a QA/debug hand on
mapSize must never leave the fit half-applied"). Setting 2048 changes nothing, and the
teardown's "restore 4096" is reverted by the next 100 ms bake. Both arms measure the
identical configuration.

**This corrects my own reading above.** The shadow-map arm's null result was not evidence
that shadow resolution is cheap — it was evidence of nothing at all. Classic QA-harness
drift against a contract that moved. Severity: minor, harness-only. **Not fixed.**

### Mechanisms in scope for the recurring spin cost

Ranked by evidential support, with no single-cause claim:

1. **The 100 ms shadow re-fit and bake** (`courseScene.js:9561-9567`) — redraws all casters
   in the ±120 yd walk box into a 2048² map. Both harnesses already tag exactly these
   frames, and the measured `bakeAvgMs` (11.4–11.8 ms) against `plainAvgMs` (9.5–9.6 ms)
   quantifies it. **Best supported.**
2. **Culling and submission churn** across the ~3,450-object interior — draw calls measured
   1,376 idle → 3,950 spinning, with frustum tests across ~3,050 visible meshes in up to
   three geometry passes. Supported by the draw-call delta; per-pass split UNVERIFIED.
3. **First-draw shader compiles on ANGLE** for materials minted after prewarm. Plausible for
   the 200 ms outlier specifically; consistent with a synchronous program link. UNVERIFIED.
4. **Ruled out on code evidence:** the 4-panel RectAreaLight budget cannot be the cause — it
   runs at 2 Hz off *camera position*, which does not move while spinning in place, and
   flips only `layers.mask` while keeping the rendered count at 4, so no program
   invalidation occurs. **GTAO interior exclusion** likewise cannot toggle while the camera
   is inside the footprint (`clubhouse.js:492-504` needs ≥15 yd clearance outside).

**One experiment was invalid and is reported as such.** Setting `sun.castShadow = false`
at runtime made everything dramatically *worse* (1 % low 105–118 ms, worst 208–242 ms)
because toggling it forces shader recompiles across the scene. It measures recompilation,
not shadow cost. The same run also emitted 256 `GL_INVALID_OPERATION: glDrawElements —
mismatch between texture format and sampler type` warnings, which are harness-induced by
disposing and reallocating the shadow map mid-session, **not** a shipped defect.

### Recommendation for Phase 5

Add repeated-run A/B to the perf harness before drawing conclusions, and treat the
first-look spike as its own workstream — extending prewarm to cover yaw sweeps is a
different fix from reducing steady-state frame cost.

---

## 13. Consolidated defect register

Every defect found in Phase 1. **None was fixed** — Phase 1 inspects and classifies.

| ID | Severity | System | Summary | Fix size |
|---|---|---|---|---|
| **LAPTOP-1** | High | Laptop (+ latently Register) | Leaving the laptop strands `camera.fov` at 34. `focusOn` snapshots the FOV *after* the lens change (`courseScene.js:6812`), and the focus ease-out stomps the correct restore ~0.4 s later (`:7948-7957`). | 1 line |
| **CLEAN-1** | Medium | Cleaning | `finish()` (`clubhouse.js:5266`) is bypassed by 5 of 8 success paths, so `recordCampaignCleaning` never fires for broom, dustpan, vacuum, mop or trash bag. Tool hints never advance. | 2–5 lines |
| **LIGHT-1** | Minor | Lighting | `PCFSoftShadowMap` requested at `courseScene.js:677` is silently coerced to `PCFShadowMap` by three.js r185. Soft shadows have never shipped. | 1 line |
| **PERF-1** | Minor | QA tooling | The shadow-map A/B arm is a no-op in walk mode — `fitSunShadow` already pins 2048 and re-asserts. Both arms measure the same config. | harness only |
| **FRONTDESK-1** | Medium, out of scope | Legacy mode | `enterFrontDesk` (`main.js:429`) calls `ch.register.cashierPose()`, which exists nowhere in `src/`, and `frontDeskUi` is never assigned. The outdoor starter-desk `[E]` prop silently does nothing. | — |
| **DEAD-1** | Hygiene | Lighting | ~80 lines of unreachable builders (`shell.js:809-891`) plus a header describing a rig that no longer exists. | — |
| **DEAD-2** | Hygiene | Customers | `clubhouse/customers.js` (1,323 lines) imported nowhere. | — |

**None of these is caught by the 189-test suite.** No test asserts campaign tool
attribution, lens restoration on exit, or the effective shadow-map type. That is the gap
Phase 7's gate must close.

---

## 14. Hand-off to Phase 2

Phase 2 writes `Designs/ProShop/ART_BIBLE.md`. What this phase establishes that it needs:

* **Unit scale is yards.** Authored GLBs are metres and converted once at adoption
  (`METERS_TO_YARDS`); registry sockets are the gameplay authority and never move.
* **Room envelope is fixed for Phase 3**: local X −8.5…+8.5, Z −5.0…+5.0, ceiling ~3.2.
  Greybox inside the existing `shopLayout.js` datums; changing them ripples into sim,
  nav and tests simultaneously.
* **The material library must publish the same slot keys** `merch.js` consumes, with
  neutral-grey tintable bases.
* **Lighting must plan for contact shadows that do not currently exist.** If the art bible
  wants grounded objects, it has to say *how* — the current answer is GTAO alone at half
  resolution, and that is why the room reads flat.
* **Dirt must be authored to read at gameplay distance.** The data is already filthy
  (mean 0.757); `dirt.js`'s canvas presentation is what fails.
* **Budgets:** average frame time 8.4 ms idle / 10.2 ms locomotion is the baseline to hold.
  Deep dips are a defect to fix, not a budget (per the Phase 0 ruling), and the 200 ms
  first-look spike is its own workstream.

### Review gate

`SLICE_BRIEF.md` §15 requires human approval after Phase 1 system classification.
**Phase 2 has not been started.** The decisions needed:

1. Accept the twelve classifications, particularly that **nothing needs rebuilding**.
2. Rule on the four live defects — fix them now, fold into their phases, or defer.
   LAPTOP-1 is recommended for early treatment because it corrupts every visual capture
   taken after a laptop visit, including future A/B comparisons.
3. Confirm Phase 2 (art bible) may begin.
