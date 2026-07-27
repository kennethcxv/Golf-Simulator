# Pro-Shop Phase 0 — Current Integration Map

What actually runs today, verified against code at `78ebbb7` rather than taken from
documentation. Paths are repo-relative; `file:line` references were checked in this
session. Anything not confirmed is marked **UNVERIFIED**.

---

## 0. Orientation

### Boot chain

```
main.cjs:48-82            Electron BrowserWindow → loadFile('index.html')
index.html:9              importmap: three → ./vendor/three.module.js
index.html:16             <script type="module" src="src/main.js">
src/main.js:2824 boot()   → menu; onNewGame (:2826) → newStarterEmpire(mode, RANDOM SEED) (:2829)
                          → buyProperty(empire, 'willow-creek')  [src/sim/empire.js:259]
                          → initCampaign(state, {fresh:true})    [src/sim/campaign.js:398]
src/main.js:741           app.scene3d = makeCourseScene(canvas, state)
src/render3d/courseScene.js:3780   makeClubhouse({...})
src/render3d/clubhouse.js:524      the entire building
```

Per-frame: `main.js` RAF (`:2558`) → `scene3d.render(dtMs, state)` →
`courseScene.js:9553` → `clubhouseApi.update(dtMs)` (`:9601`) + `syncCameraVisibility()`.

**There is no separate interior scene.** The clubhouse is a building inside one
continuous course world; the player walks in through a real hinged door.

### The single most important fact for a room rebuild

`src/data/shopLayout.js` (627 lines) is the room's coordinate bible. It is consumed
simultaneously by the renderer, the simulation, customer navigation, the grime grid,
the collider registry and the test suite. Everything else in this document ultimately
keys off it.

### Central files by size

| File | Lines | Role |
|---|---|---|
| `src/render3d/courseScene.js` | 10,897 | whole 3D scene, walk controller, held-tool rig |
| `src/render3d/clubhouse.js` | 10,644 | room build, customers, cleaning dispatch, API hub |
| `src/render3d/clubhouse/simplifiedRegisterMode.js` | 6,750 | physical register driver |
| `src/main.js` | 2,978 | app shell, input, modes, saves |
| `src/ui/laptop.js` | 2,930 | back-office UI |
| `src/render3d/clubhouse/fixtures.js` | 2,045 | fixtures + `buildCheckout` |
| `src/sim/state.js` | 1,709 | schema / serialize / heal |
| `src/render3d/clubhouse/pineHillsInterior.js` | 1,642 | **the starter interior dressing** |
| `src/sim/shop.js` | 1,561 | shop economy, grime grid |
| `src/sim/register.js` | 1,475 | transaction money logic |
| `src/sim/inventoryLifecycle.js` | 1,459 | lot ledger |
| `src/render3d/clubhouse/customers.js` | 1,323 | **DEAD — imported nowhere** |
| `src/sim/clubhouseRestoration.js` | 1,221 | restoration reducer |
| `src/data/shopLayout.js` | 627 | the room's coordinate bible |

---

## 1. Clubhouse construction

| | |
|---|---|
| **Path** | `src/render3d/clubhouse.js`, `src/render3d/clubhouse/{shell,doors,fixtures,pineHillsInterior,materials}.js` |
| **Entry point** | `makeClubhouse(ctx)` — `clubhouse.js:524`, called from `courseScene.js:3780` |
| **Ownership** | `courseScene.js` owns the scene and the walk controller; `clubhouse.js` owns the building and returns a large API object (`:10225-10640`) reached via `app.scene3d.clubhouse()` |

**Variant resolution** — `clubhouse.js:542-552`: `?clubhouse=` query, else
`state.property.clubhouseVariant`. The starter is **`pine-hills`**
(`src/data/marketplace.js:71`; `STARTING_PROPERTY_ID = 'willow-creek'`, display name
"Pine Hills Municipal Golf"). Other variants: `modern-public` (default),
`mountain-lodge`, `legacy`, `shed`; plus tier-gated `resortStyle` / `premiumPrivate`
presentations keyed off `state.property.tierId` (starter tier is `neglectedPublic`,
so both are dormant).

**Construction is hybrid:**

1. **Procedural base, always built** — `clubhouse/shell.js:97 buildShell(B)`: walls as
   box runs around real openings, glazed mullioned windows, gabled roof, coffered
   ceiling and beams, walnut wainscot, and the interior lighting rig. Doors:
   `clubhouse/doors.js:34 buildDoors` — real hinged slabs with colliders that toggle
   with the swing.
2. **Authored GLB overlay (Sheet 6, assets 51-60)** —
   `assets51to100/sheet06ProductionRuntime.js`. When an authored GLB validates, the
   matching procedural set is hidden *in place* (`shell.js:45-55`
   `PRODUCTION_VISUAL_FALLBACK_KEYS`). If the GLB fails to load, the procedural room
   stays visible. **The room can never fail to exist.**
3. **Variant dressing** — `createPineHillsInterior` (`clubhouse.js:1178`): warm-oak
   public floor, backdrop, canvas tee-time/logo/menu boards, neglect visuals, 11
   dressing GLBs, restoration `[E]` targets, cleanup poses.

**Scene-graph roots** (`clubhouse.js:566-611`): `group` (exterior, at terrain baseY),
`interior` (at floorY), `custGroup` (customers, world space). `interior.add` is
**wrapped** (`:578-608`) to strip `castShadow` from everything indoors — the sun
cannot reach inside, and contact shadows come from GTAO.

**Measured footprint** (this baseline): local X −8.5…+8.5, Z −5.0…+5.0 → **17.0 × 10.0**.
Datum: `SHELL` 18.4 × 11.5 yd, `INTERIOR` 17.9 × 11 (`shopLayout.js:28-38`).
Interior world position `(-360, y, 4)`; **y varies per run** because the seed is random.

**Risks when replacing the room** — `shopLayout.js` changes ripple into customer
routing, the grime grid, reach-circle checkout tests, manifest placements and campaign
sites simultaneously. The procedural↔GLB handshake must be reproduced or authored
assets double-render. Three separate systems can own the entrance door
(`architecturalDoorInstallation`, `sheet06Production`, `modernPublicClubhouse`).

**Must preserve** — the returned API: `group/interior`, `update`,
`syncCameraVisibility`, `isInside`, `groundYAt`, `suppressesGroundCoverAt`,
`doorWorld`, the laptop rig surface, the whole `register` surface, cleaning surfaces,
`dispose`; registration into the shared `walkProps`/`propColliders` via `addCol`/`addProp`;
and the rule stated at `clubhouse.js:6-7` — the renderer is *a live window onto
`state.shop`, never a second simulation*.

---

## 2. Checkout

| | |
|---|---|
| **Paths** | `src/sim/register.js` (money), `src/sim/registerFlow.js` (state contract), `src/render3d/clubhouse/simplifiedRegisterMode.js` (physical driver), `src/render3d/clubhouse/fixtures.js:1738 buildCheckout` (meshes) |
| **Entry points** | `createRegisterMode(B)` — `simplifiedRegisterMode.js:661`, created at `clubhouse.js:1394`. Player enters via `[E]` on the front desk (`clubhouse.js:1704-1713`). |

Three deliberately separated layers:

* **`sim/register.js`** — pure functions over a `tx` object. `createTx :133`,
  `scanItem :181`, `requestPayment :241`, card path `:269-503`, drawer `:515-726`,
  receipt `:773-810`, and **`completeSale(state, tx, who) :1253`** — the only banking
  path, with idempotent ledger keys `checkout:{txId}:sale|cogs|cash-over-short`.
* **`sim/registerFlow.js`** — `CHECKOUT_STATE_ORDER :11-42`, 29 states from
  `CustomerApproaching` to `TransactionComplete` plus `Recovery`. Owns no money, no
  DOM, no three.js.
* **`simplifiedRegisterMode.js`** — the physical driver. **The live `tx` and `customer`
  are closure variables (`:867-868`), not on `state`.**

**Visual dependencies** — kit GLBs from `vendor/models/checkout/` (49 files, staged
from `Assets/checkout/glb/`), loaded by `clubhouse/merch.js` under prototype keys
`kit:${name}`: `pos_monitor`, `payment_terminal`, `receipt_printer`,
`customer_display`, `cash_drawer`, `cash_bill_*`, `cash_coin_*`, `payment_card`,
`shopping_bag`, `loose_receipt`. Placed at `fixtures.js:1948-2010` from
`shopLayout.REGISTER` (`:480-532`) and handed to register mode via
`attachScreen/attachTerm/attachScanner/attachPrinter`. A missing model degrades to a
canvas-texture fallback; **the register still functions logically**.

**Save-state dependencies** — `shop.drawer` (denomination stacks), `shop.held[]`,
`shop.paymentBag`, `shop.nextTransactionNo`, `shop.transactionHistory`,
`uiPrefs.checkout*`. **The in-flight `tx` is deliberately not persisted**; a save mid-sale
reloads to the pre-payment state via `recoverCheckout` (`sim/checkout.js:236`).

**Risks** — register camera poses, the swept-segment scan volume, staging/bagging
rects, drawer travel and queue slots are all derived from `FRONT_DESK_FRAME`
(`shopLayout.js:207`). Move the counter mesh freely; move the *frame* only through
that datum. Reach invariants are pinned by tests (`PLAYER_DIAM 0.68`,
`STAFF_CORRIDOR_MIN 1.1`, drawer travel 0.44).

**Must preserve** — money integrity and the idempotent `completeSale` ledger keys;
exactly-once held-unit lifecycle with uid replay protection; the `registerFlow` state
contract (pinned by 20+ tests and `tools/qa/simplified-register-acceptance.mjs`).

---

## 3. Laptop

| | |
|---|---|
| **Paths** | `src/core/laptopRig.js` (geometry), `src/core/laptopProjection.js` (homography), `clubhouse.js:2049-2148` (mesh), `src/ui/laptop.js` (UI), `src/main.js:349-420` (mode transitions) |
| **Entry point** | `[E]` on the laptop prop (`clubhouse.js:2293-2299`) → `enterLaptop(startPage)` (`main.js:349`) |

**The laptop is 100 % procedural — there is no GLB.** Built from `LAPTOP` constants
(`laptopRig.js:30-42`, 15.4" 16:10, `lidOpen = 1.87 rad`), positioned at
`FRONT_DESK.laptop`. Measured pose this baseline: world `(-359.08, y, 5.778)`, local
`(+0.92, +1.778)`, yaw 0, pitch −0.510.

**Screen** is a 512 × 320 CanvasTexture with modes `off | boot | live | desk`.
Entering stages lid → boot (420 ms) → live + UI open (1350 ms). Every frame while
open (`main.js:2557`), `alignLaptopUi` projects the four live screen corners to screen
pixels and welds the 1024 × 640 DOM page on with a CSS `matrix3d` homography.

**`src/ui/laptop.js` has exactly SEVEN pages** — `home, reservations, shop, course,
upgrades, finances, settings` (`PAGES :2811-2819`). Seventeen retired page ids forward
through `PAGE_ALIAS` (`:314-331`). *(A project memory note describing "~24 pages" is
historical — the aliases are why both counts appear in the codebase's history.)*
It reads live sim every render and writes only through `sim/*` mutators.

**Confirmed defect (OBS-1)** — exiting the laptop with Escape restores `view` to
`course` and the screen to `desk`, but **leaves `camera.fov` at the laptop's 34°**
instead of the walk FOV 66. Verified in two independent scripts; evidence in
`data/baseline-systems-video.json` and `data/baseline-performance.json`. Whether the
"Close Laptop" button behaves differently is **UNVERIFIED**. Not fixed — Phase 0 does
not change gameplay code.

**Must preserve** — the 1024 × 640 16:10 contract, corner order `[tl,tr,br,bl]`, the
degenerate-quad null guard (`main.js:278-282`), and `state.uiPrefs`.

---

## 4. Inventory

| | |
|---|---|
| **Paths** | `src/data/shopItems.js` (catalog), `src/sim/shop.js`, `src/sim/inventoryLifecycle.js`, `src/sim/stocking.js`, `src/data/fixtureSlots.js`, `src/render3d/clubhouse/catalogProductVisual.js` |

Numbers live at `state.shop.inventory[skuId] = {shelf, back}`. Every movement is also
journalled in a lot ledger (`inventoryLifecycle.js`) whose stages run
`inTransit → deliveredUnopened → openedBox → reserve → shelf → customerHeld → sold |
disposedLost`, with replay-protected operation keys.

**SKU → 3D**: `shopLayout.FIXTURES` (`:564-604`, 23 fixtures with SKU lists and
browse/stock sockets) + per-SKU authored slots in `src/data/fixtureSlots.js`.
`rebuildStock()` (`clubhouse.js:4550-4700`) disposes and rebuilds one baked mesh per
fixture × SKU from live inventory.

**Risk** — swapping a fixture mesh can remove the authored GLB sockets that
`resolveAuthoredFixtureSlot` (`clubhouse.js:509`) reads, and stock then floats at
fallback coordinates. This is a previously-fixed bug, documented at
`clubhouse.js:4578-4581`.

---

## 5. Cleaning, broom, dirt state

| | |
|---|---|
| **Registry** | `src/data/cleaningTools.js` (432 lines) — explicitly the single source of truth |
| **Dispatch** | `cleanWithTool(toolId, wx, wz, dirX, dirZ, dt, options)` — `clubhouse.js:5226` |
| **Per-frame rig** | `courseScene.js:8210 updateHeldFeel` and `:8274-8420` |
| **Viewmodels** | `src/render3d/toolViewmodel.js` (509), `src/render3d/fpHands.js` (437), `src/render3d/toolSockets.js` (127) |

`BELT_ORDER` (`cleaningTools.js:420`) is
`[null, washer, vacuum, mop, broom, dustpan, spray, cloth, sponge, trashbag]`.
Dispatch switches on `toolClass`: SWEEP → `sweepAt` (**moves debris, never deletes**),
SCOOP → `collectAt` + `addToPan`, SUCTION, STROKE (mop / cloth / sponge), SPRAY, CARRY.

**Gating** — `cleaningGate` (`:5185`) requires `isInside(-0.04)`, no collider at the
point, and no collider on the segment from the camera. `cleaningAim` (`:5198`) is a
**floor-plane projection with no raycast and no surface normal**; the contact point
lands `eyeHeight / tan(−pitch)` ahead and is discarded past the tool's reach. A
pre-gate forwards raw contact to `pineHillsInterior.applyCleaningTool` first, so wall
scuffs and cobwebs — which live where the floor gate would refuse — still work
(CLEAN-SCUFF-001, `clubhouse.js:5229-5235`).

### The broom, honestly assessed

Three assets: a world pickup GLB
(`vendor/models/assets_51_100/sheet_08/asset_074_broom.glb`, standing in the stockroom
at local `(6.96, 1.82)`, `[E]` to equip), an authored **first-person viewmodel**
(`vendor/models/assets_51_100/firstperson/asset_074_broom_fp.glb`, 206 KB, confirmed
on disk), and a procedural fallback (`cleaningTools.js:196-204`) that shows instantly
so equipping never waits on I/O.

The FP GLB contains sockets `SOCKET_DebrisPush / FloorContact / GripPrimary /
GripSupport` and clips `Broom_BristleContact / Equip / SweepLeft / SweepRight /
Unequip`. On adoption the authored mesh is scaled m→yd, yawed π, and translated so its
`SOCKET_FloorContact` lands exactly on the registry socket — **registry sockets never
move; only visuals swap** (`toolViewmodel.js:270-298`).

**This is not a static offset.** Present and verified: authored equip/unequip clips
plus a procedural rise-and-settle ease; looping sweep clips; gait bob and idle sway;
a procedural lateral push-pull with roll wobble; a contact-phase gate that only cleans
during the fast mid-drag and **banks the skipped dt so the total is preserved**
(`courseScene.js:8361-8367`); a floor-contact Y solve that nudges the head ±0.06 yd so
the bristles kiss the boards; recoil applied to the rig; articulated two-segment
fingers with orientation-true grips; reduced-motion gating.

**Genuine gaps**, cited: no separate viewmodel camera or FOV/layer separation — the
tool renders in the main camera at main FOV; no surface-normal alignment (the aim has
no normal); no look-velocity spring inertia (bob is time-based); the Y solve samples
only the flat floor constant, so heads can still clip furniture.

**Measured in this baseline** — sweeping landed `did` values of 0.24–0.31, but several
samples returned `blocked` or `occluded`: the collider gate refuses contact fairly
often near fixtures. `debrisTotal` correctly stayed at 3.93 throughout (sweeping moves
mass, it does not remove it). `state.campaign.cleaningToolsUsed` remained `{}` after a
successful sweep despite `recordCampaignCleaning` being called on `did > 0`
(`clubhouse.js:5268`) and `campaign.enabled` being `true` — **flagged for Phase 1, not
investigated further here.**

### Dirt state and save fields

| Field | Shape |
|---|---|
| `reno.grime` | `number[104]` — 13 × 8 grid, ~2 yd cells, 0..1. Mean 0.757 at fresh start |
| `reno.debris` | `{x,z,a,kind}[]`, max 96. 18 seeded, total mass 3.93 |
| `reno.clutter` | `{x,z,ry,cleared}[]` — 8 piles |
| `reno.windows` | `number[4]` — `[0.87, 0.79, 0.92, 0.89]` |
| `reno.wet` / `reno.solution` | `number[]` at 0.25 yd cells |
| `reno.cleaning` | pan (cap 1.8), bag (cap 7.5), mop (cap 24), bucket |
| `reno.wash` | 5 exterior surfaces × `{grime[], soap[]}` |
| `reno.architecture.components` | 7 components, all `restored:false` at start |

Floor dirt renders as **one 1024 × 640 CanvasTexture** on a plane at y 0.026
(`clubhouse/dirt.js:22`) — hundreds of art-directed elements (mud fans, footprint
trails, wall dust banks, corner buildup), each owned by exactly one grime cell.
Shop condition is **derived, never stored** (`shop.js:321+`).

**Risks** — `reno.grime.length` is exactly 13 × 8; changing room dimensions without a
resample migration (the 7×5→13×8 precedent is at `shop.js:131-154`) corrupts saved
progress. The grime plan is hardcoded against `DOOR_MAIN`, `TRAFFIC_PATHS`, `FIXTURES`
and `MAT`. Overlays sit at y 0.026/0.028 with renderOrder 3–4 and will z-fight a new
floor placed at the same height. The held-tool contact solve assumes a **flat floor**.

**Must preserve** — the registry contract (ids, toolClasses, socket names,
`BELT_ORDER`); `cleanWithTool`'s signature and pre-gate→gate→switch order; debris
conservation (broom moves, disposal is the only path to zero); monotonic target
progress and exactly-once milestone edges; socket-derived contact points (reverting to
camera-offset contact reintroduces documented wall-through-cleaning bugs); the
stroke-gate dt banking.

---

## 6. Particles

All pools pre-allocated; **zero per-frame allocation is an explicit invariant**.

* **Cleaning motes** — one `THREE.Points` pool of 26 (`clubhouse.js:4856-4874`);
  per-kind colour and size; suction converges on the head, sweep drifts along stroke.
* **Vacuum chunk pops** — 8-slot pool, 1-in-8 spawn, 0.24 s flight.
* **Spray** — per-tool colours plus a 28-particle mist burst with gravity droop and a
  fading glisten decal (`courseScene.js:7001-7107`).
* **Washer jet** — drawn stream nozzle→hit with 0.2 s pressure-lag ramp.

---

## 7. Audio

**All sound is synthesised WebAudio — there are no cleaning sound files**
(`src/core/audio.js`, 1,714 lines). Continuous loops come from `setToolLoop(toolId)`
(`:1536`): noise through a per-tool bandpass gated by an LFO (broom: 1500 Hz, Q 1.3,
2.6 Hz pulse, depth 0.60, level 0.040). One-shots: `strokeAccent` on stroke reversal,
`sprayPulse`, `vacuumPickup`, `wipe`, `disposal`, `equipTick`.

**The `audio:` blocks in the tool registry are dead data.** `cleaningTools.js` declares
`{loop:'broomSweep', start:'broomStart', stop:'broomStop'}` for every tool; grep
confirms **no runtime consumer** — loops are keyed by tool id instead. Worth knowing
before anyone "wires up" cue names that were never live.

---

## 8. Customer routing

| | |
|---|---|
| **Persisted ledger** | `src/sim/customerSimulation.js` (1,057) at `state.shop.customerSimulation` |
| **Live actors** | inline in `clubhouse.js` — `customers` array `:8108`, `spawnCustomer :8297` |
| **Navigation** | `src/render3d/clubhouse/nav.js:8 makeNav` — grid A*, 0.3 yd cells, 0.32 radius |

Route: spawn outside the porch → `walk` → `enter` (door, doorbell) → optional basket →
N fixture visits with claimed sockets → `counter` → `exit`. Characters are
**procedural** (`src/render3d/characterAsset.js:77`), not GLBs.

Nav is rebuilt lazily whenever `colVersion` changes; doors are excluded from the
collider set or doorways become walls. Queue slots come from `shopLayout.queueSlot`.
Patience is `PATIENCE_FULL = 600 s`, ticking only while the customer is *not* being
actively served. On expiry the cart is surrendered — "nobody leaves holding
merchandise" (`clubhouse.js:9604-9606`).

**Measured in this baseline** — `sendToCounter(['balls1','glove1'], 'card')` produced
customer "Dean Clarke"; after 9 s: 2 customers present, 1 in the checkout queue, flow
state `WaitingForCashier`, `register.hasTx() === true`. Pressing `[E]` at the counter
did **not** flip `register.isActive()` to true in that pass — the focus-label probe
did not match a register prop from the positions tried. **UNVERIFIED** whether that is
a harness aim problem or a real interaction issue; flagged for Phase 1.

> **DEAD CODE WARNING** — `src/render3d/clubhouse/customers.js` (1,323 lines,
> `createCustomerView :139`) is **imported nowhere**, verified by grep across `src/`,
> `tests/` and `tools/`. It is a parallel-session rewrite that was never wired in, and
> `src/data/customerSockets.js` is imported only by it. Do not treat either as the live
> implementation, and do not "fix" the live system to match them.

---

## 9. Save and reload

| | |
|---|---|
| **Paths** | `src/core/storage.js`, `src/core/nativeSaveStore.cjs`, `src/sim/state.js`, `src/sim/empire.js`, `src/sim/saveValidation.js` |

Storage is a facade over `window.fairwayNative` (Electron IPC → JSON files under
`userData/saves/`) or browser localStorage, with primary + backup keys and backup
recovery. The persisted document is the **empire envelope**
(`empireSnapshot`, `empire.js:685-710`, `empireVersion: 3`), not raw state.

Per-state `SAVE_VERSION = 13` with named migrations v2..v13 (`state.js:123-136`).
Load runs a long healer chain in an exact order (`state.js:1633-1677`): campaign
restore → `normalizeShopState` → `ensureLedger` → `ensureInventoryLifecycle` →
`migrateDrawer` → `ensurePaymentBag` → `ensureShopReno` → `ensureLayout` →
`ensureClubhouseRestoration` → `ensureDebris` → `ensureWet` → `ensureWash` →
`ensureCampaign` → `recoverCheckout` → `reconcileShelfCapacity` →
`recoverCustomerSimulation` → … Unknown fields are preserved via
`__unknownSaveFields`.

**Nothing visual is persisted** — the scene is fully rebuilt from state on load.

**Risk** — every restoration/cleaning/stock system keys off `shop.reno.*` and fixture
ids. A new room that renames or removes datums orphans persisted state.

**Not exercised by this baseline** — no save/reload cycle was captured.

---

## 10. Materials

`src/render3d/clubhouse/materials.js` (822 lines) —
**canvas-procedural, deterministic, zero binary textures.**
`makeClubhouseMaterials(clubName) :610` returns ~22 shared materials (plaster, ceiling,
oakFloor, concrete, walnut, walnutDark, rawWood, trimPaint, glass, brass, steel, iron,
charcoal, leather, sage, felt, rubber, plastic, merch tint slots). Albedo canvases are
Sobel-derived into normal maps and luminance-mapped into roughness; data maps stay
linear, albedo sRGB. Created **once per `makeClubhouse`** (`clubhouse.js:804`) and
passed to every builder. Exterior siding/roof are the only bitmap normal maps
(`vendor/textures/siding_nor.jpg`, `roof_nor.jpg`).

Measured this baseline: **815 unique materials, 227 unique textures, 297 textures in
memory, 244 shader programs** across the whole visible scene.

---

## 11. Lighting

**World** (`courseScene.js:672-760`): DPR capped at 1.5; **ACESFilmic, exposure 1.12**;
`SRGBColorSpace`; PCFSoft requested but silently downgraded to PCF by three.js.
Post chain: EffectComposer (MSAA 4, HalfFloat) → RenderPass → **GTAO at half
resolution** (blend 0.4, radius 0.7 in walk mode) → UnrealBloom (0.12, negligible) →
OutputPass. Sun `DirectionalLight 0xfff1da @ 2.8`; hemisphere 1.4; ambient 0.16.
Shadows are re-fit and baked every **100 ms**; **`fitSunShadow` owns `sun.target`**.
GTAO skips the whole interior subtree when the camera is ≥15 yd outside the footprint.

**Interior rig** (`shell.js:802-1153`): 8 authored **RectAreaLight ceiling panels**
(0xffd8ad, base 5.8) with a **4-panel render budget** by camera proximity; pendant
lanterns and recessed cans; display spots; three cool daylight fills at the windows
scaled by time of day and window dirt; porch light after dark. Fault states are
save-driven — `panel-02` flickers and `panel-07` is dead until repaired. A contract
note at `clubhouse.js:852-859` states rect-area panels are the approved backend and
must not be swapped for point proxies.

20 lights in the scene at baseline.

---

## 12. Asset loading

`src/render3d/gltfCache.js` (58 lines) — `CachedGLTFLoader` with a module-level
promise map; hits return a **deep clone** sharing geometry, materials and decoded
textures.

**Not everything uses it.** `courseScene.js`, `merch.js` and `pineHillsInterior` use
the cached loader; `buildProps` (`clubhouse.js:1133`), all four variant adapters,
`sheet06Architecture`, `propertyFurnitureVisuals`, `placeables`,
`architecturalDoorVisuals` and `shedInterior` use the **plain** uncached
`three/addons` loader.

Runtime tree is `vendor/models/` (CSP `default-src 'self'`); `Assets/` holds canonical
exports and Blender sources. `vendor/models/clubhouse/` has 152 GLBs,
`vendor/models/checkout/` 49.

The load veil is driven by a `DefaultLoadingManager` idle barrier with a **12 s
timeout**, so a missing file can never hold boot hostage; missing models degrade to
procedural stand-ins. Measured: **18.2 s** from new-game click to veil clear.

---

## 13. Performance and QA tooling

312 scripts in `tools/qa/`, 350 test files in `tests/`.

| Tool | Purpose |
|---|---|
| `tools/serve.cjs` | zero-dependency static server, port 8457 |
| `tools/qa/run-playwright.cjs` | the runner. Scripts must live under `tools/qa/`. `VIDEO_DIR` enables recording; `QA_RESULT_PATH` writes JSON; `ok:false` fails the process |
| `tools/qa/perf-probe.js` | the existing perf harness — course-focused, includes a CDP CPU profile |
| `tools/qa/shoot-clubhouse.js` | older 10-pose screenshot harness — **its `L2W` offset `(x−8, z+228)` is stale and does not resolve to this room** |
| `tools/qa/dilapidated-start-visual.js` | fresh-start visual proof; uses the correct live-`interior.position` pattern |
| `tools/qa/simplified-register-acceptance.mjs` | canonical register driver |
| `tools/qa/laptop-tour.js` | clicks every laptop page through the projected quad |
| `tools/qa/starter-loop-acceptance.js` | starter campaign loop |

**Added by this phase** (documentation/capture only, no gameplay code):

| Script | Output |
|---|---|
| `tools/qa/proshop-baseline-capture.js` | 10 screenshots + `data/baseline-capture.json` |
| `tools/qa/proshop-baseline-broom-video.js` | broom webm + `data/baseline-broom-video.json` |
| `tools/qa/proshop-baseline-systems-video.js` | laptop/customer/checkout webm + `data/baseline-systems-video.json` |
| `tools/qa/proshop-baseline-performance.js` | `data/baseline-performance.json` |

Acceptance suites to run before accepting any room replacement: `checkout-space`,
`customer-nav`, `laptop-seat` / `laptop-rig` / `laptop-projection`, `register-*`,
`shop-reno`, `clubhouse-restoration-actions`, `props-71-100-placement`, and the
save-reload matrices.

---

## 14. Cross-cutting risk summary

1. **`shopLayout.js` is load-bearing for sim, renderer and tests at once.**
2. **World anchor** comes from `course.structures[0]`; moving the building changes
   every local→world conversion, the spawn point and the nav bounds.
3. **Analytic colliders are the only navigation authority.** GLB collision is
   contractually inactive. New geometry must register through `addCol` or customers
   walk through walls.
4. **`isInside` / `groundYAt`** gate cleaning, tool belts, interior shadow policy,
   grime and GTAO exclusion.
5. **Perf assumptions are baked in**: 80 yd interior draw gate, GTAO interior
   exclusion, 4-panel light budget, interior `castShadow` stripping, 100 ms shadow
   bakes, half-res AO.
6. **Save compatibility**: `reno.grime` is exactly 104 cells; fixture ids are
   persisted.
7. **Dispose discipline**: `rebuildStructures()` fully disposes and rebuilds the
   clubhouse on any course structure edit; merch prototypes vs clones have strict
   ownership rules.
8. **`clubhouse.js` and `merch.js` are hot shared files** — parallel sessions commit
   into them. Stage single hunks.
