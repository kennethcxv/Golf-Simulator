# Workstream inventory

Machine-readable form: `workstream_inventory.json`.

## Sources of change

Only two sources carried unique work. Everything else in the repository is a
checkpoint with zero unique commits.

| Source | Form | Volume | Disposition |
|---|---|---|---|
| Working tree (assets 51–100 + cleaning session) | **uncommitted**, 295 paths | +153 files, ~50k lines | integrated verbatim as 15 commits |
| `course-takeover-claude` | branch, 8 commits | 12 files, +991/−90 | integrated selectively — 6 full, 2 partial |

The working tree was byte-identical to that session's own snapshot
(`94a1711`), so "integrate from the snapshot ref" and "integrate from disk" were
the same operation. Verified by tree hash: both `65e362ea…`.

## Classification of changed files by workstream

| Workstream | Files | Landed in |
|---|---|---|
| **A** Course architecture/terrain | — (no unique changes; base already current) | — |
| **B** Course Editor correctness | `src/core/heldKeys.js`, `src/main.js`, `tests/input-drift.test.js` | `40e48b7` |
| **C** Course Editor performance | `courseScene.js`, `ui/courseEditor.js`, `sim/courseEditor.js`, `terrainNormals.js`, 2 tests, 1 probe | `ec56171` |
| **D** Course visuals/water/atmosphere | `courseScene.js` (ponds, ring colour, placeSpot) | `813ede4`, `bcb718b` |
| **E** Assets 1–50 Blender + GLB | `Assets/`, `asset_sources/`, `vendor/` | `62a5c94` |
| **F** Assets 1–50 runtime | (within clubhouse/checkout commits) | `3f80740`, `46deabb` |
| **G** Assets 51–100 Blender + GLB | `Assets/assets_51_100/`, `asset_sources/blender/assets_51_100/`, `vendor/models/assets_51_100/` | `62a5c94` |
| **H** Assets 51–100 runtime | `src/render3d/assets51to100/` (5 modules) | `ad44507` |
| **I** Checkout/cashier | `sim/checkout.js`, `simplifiedRegisterMode.js`, `catalogProductVisual.js`, `fixtureSlots.js` | `46deabb` |
| **J** Clubhouse architecture/furniture | `clubhouse.js` + 11 clubhouse/sim/data modules | `3f80740` |
| **K** Delivery/boxes/packaging | `boxPlacement*.js`, `authoredCutterPath.js`, `deliveryCarryProfile.js`, `deliveryBoxVisual.js`, `deliveryEquipment.js`, `productPackaging.js` | `d557b90` |
| **L** Cleaning registry + viewmodels | `cleaningTools.js`, `toolSockets.js`, `toolViewmodel.js`, `cleaningDebris.js`, `cleaningWet.js`, `core/audio.js` | `ef4e3fe` |
| **M** First-person hands | `fpHands.js`, `mouseLook.js` | `9f1245e` |
| **N/O/P/Q** Washer, vacuum, mop, broom gameplay | `courseScene.js` (tool integration), `clubhouse/washing.js` | `2192d2f` |
| **R** Save/load and migration | `src/sim/state.js` | `ddf4ff6` |
| **S** Performance/resource lifecycle | (within `3f80740` — double-free fix) | `3f80740` |
| **T** Tests and QA tooling | `tests/` (68), `tools/` (78), `qa/` manifests, `Designs/` | `513d9a4`, `8c62535`, `2be74c7`, `3009aa3` |
| **U** Unrelated/uncertain | `asset26-in-game.png` (stray root screenshot) | **not committed** |

`src/render3d/courseScene.js` spans workstreams C, D **and** N–Q, because it hosts
both the terrain system and the first-person walk mode where cleaning tools are
used. It was merged three separate times for that reason.

## The three duplicate implementations

The defining problem of this integration. Two sessions independently solved the
same three problems. None resolved to a simple "pick a side".

### 1. Pond shorelines — **merged both**

| | Base `14e9d4e` | Incoming `a4bc3d2` |
|---|---|---|
| Approach | raster boundary tracer (`cellComponentOutline`) | ungate `outlinedWaters` + tightest-bbox match |
| Strength | covers every water component, including streams | exact authored polygon, aligned to the carved bowl |
| Weakness | traces the domain-warped zone raster while the bowl is carved from the raw poly → shoreline systematically offset | matches no stream or legacy-grid component → falls through to `CircleGeometry` |

Taking either alone fails. Merged: incoming handles vec ponds exactly, the base's
tracer becomes the fallback for streams and legacy courses, and `CircleGeometry`
ends up unreachable — a lone cell emits four edges, so the `length >= 3` guard
always passes.

**Known caveat carried forward:** `cellComponentOutline` keys its edge map by
start vertex, so a checkerboard pinch can silently drop an edge. Realistic
rasters trace at 100% coverage. Neither implementation cuts island holes. Neither
ships an automated test for the shoreline itself.

### 2. Property boundary — **base geometry + incoming shader**

Different root causes: the base fixed the *shape*, the incoming fixed the
*colour*. Measured ring:terrain luminance ratio (sRGB→linear, ColorManagement on):

| luma | before | base geometry only | merged |
|---|---|---|---|
| 0.25 | 2.33× | 1.51× | **1.00×** |
| 0.50 | 2.60× | 1.69× | **1.00×** |
| 0.75 | 2.75× | 1.79× | **1.00×** |

The base alone leaves a ~1.7× step that *varies with luma*, so it shimmers with
texture detail. The base's geometry is kept because it is C1-continuous where the
incoming is C0 with a slope kink at the property line, and resolves the
straddling quad 1.65× finer.

**Regression found and fixed during this merge:** `placeSpot()` carried a private
copy of the older ring profile. Once the ring stopped decaying `edgeH`, that copy
sank the outer boundary forest into the ring — 0.35 yd at the line rising to
**16.50 yd** at the 272 yd tree limit, silently undoing `afc969c`. Neither branch
caught it. Fixed and verified numerically at a uniform 0.50 yd embed.

### 3. Terrain-edit performance — **incoming wholesale**

The base (`5cd07f4`) scoped only the position write loop; three unscoped
346,801-vertex passes survived every tick. The incoming stack is a strict superset
adding seven layers, notably windowed normals via a new pure `terrainNormals.js`
unit-tested bit-identical to a full solve.

The one genuine correctness disagreement: the base refused to scope whenever
relief was invalidated; the incoming honours `terrainRect` always. Resolved in
favour of the incoming, and **verified** — the probe reports 0 differing
components of 1,040,403 after undo.

## Rejected work, with reasons

| Item | Reason |
|---|---|
| `aa5ec1b` → `clubhouse.js` hunks | Self-labelled BRIDGE scaffolding, exit condition met; would emit a duplicate ESM export and break module load |
| `b67fb3f` → ring geometry hunks | Base geometry is C1-continuous and finer-resolved; incoming introduces a slope kink at the boundary |
| `2914ed0` | Superseded — schema v3 vs v4, 3-arg vs 4-arg `transactionStabilityReport`, 154KB vs 177KB |
| `68ebb7a`, `a718095`, `5d1e802` | Pre-work checkpoints, superseded by the work they preceded |
| `asset26-in-game.png` | Stray QA screenshot at repository root; left untracked, preserved in the snapshot ref |

Every rejected item remains reachable through a durable ref. Nothing was deleted.
