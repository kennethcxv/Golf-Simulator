# ASSET PRODUCTION AUDIT — clubhouse pro shop

Baseline captured 2026-07-14 from the running game (`qa/assets/before/`, 10 poses,
1600×900, stocked retail displays). Every judgement below is from a screenshot or a
measurement, not from reading code.

**Reference:** `Designs/RefrenceImages` — 13 images. Panels 1–8 are the photoreal art
direction (warm cream plaster, dark walnut post-and-beam, coffered ceiling, oak plank
floor, brass, deep green). The last two panels are explicitly labelled *"MATCHING GAME
ART STYLE"* and are the real target: **stylized, warm, readable — not photoreal.**

---

## 0. THE MEASUREMENT THAT CHANGED THE PLAN

| Metric (whole scene, stocked, 1600×900) | Before |
|---|---|
| Draw calls / frame | **10,874** |
| Triangles drawn / frame | 9,514,304 |
| Scene meshes | 1,543 |
| Scene triangles | 1,657,918 |
| Unique materials | **276** |
| Unique textures | 119 |

Triangle census by geometry type:

| Geometry | Triangles | Meshes |
|---|---|---|
| `BufferGeometry` (loaded GLBs — trees, house, tractor) | **1,553,386** | 214 |
| `PlaneGeometry` | 76,944 | 73 |
| `CylinderGeometry` | 10,312 | 353 |
| `BoxGeometry` | 9,576 | 798 |
| `SphereGeometry` | 7,156 | 76 |
| everything else | ~2,000 | ~80 |

**The clubhouse interior is 1,214 meshes carrying ~42,000 triangles — an average of 34
triangles per mesh.** 94% of the scene's triangles are the *outdoor* GLBs; the shop
contributes almost none of them.

So the interior is **draw-call bound, not triangle bound.** Every drawer pull, brass
clip and light strip is a separate mesh with its own material. The correct optimisation
is therefore *merge static geometry, share materials, instance repeats* — **not** reduce
detail. Geometric detail is close to free here; mesh count is the entire cost.

This is why the required work below adds silhouette detail (dimpled balls, sculpted club
heads, real shoes and bags) while *reducing* draw calls.

---

## 1. THE HONEST HEADLINE

The **architecture is decent** and the **fixture carcasses are better than the brief
assumed** — they already use a beveled `roundedBox()`, plinths, crowns, brass gallery
edges and under-shelf light strips. They are not "unmodified boxes".

The failure is concentrated in three places:

1. **Merchandise.** Nearly every product is a primitive. Polos are flat saturated slabs.
   Club heads are blobs. Shoes are lumps. Bags are cylinders. This is what makes the shop
   read as a prototype.
2. **Materials.** Every paint, metal, glass and plastic is a **flat colour value** — the
   exact thing the brief forbids. There is not one roughness map, normal map or AO map
   anywhere inside the building.
3. **Emptiness.** The displays hold a handful of sparse items against acres of bare shelf.
   The reference is *dense*. The stockroom is nearly empty.

**Correction to the brief's premise:** the brief lists "Weak shelves / weak tables /
placeholder lounge furniture" as if the millwork were the problem. Measured against the
screenshots, the millwork is the *strongest* thing in the room. The merchandise is the
problem. I have re-prioritised accordingly and say so rather than silently following the
list.

---

## 2. MATERIAL AUDIT (`src/render3d/clubhouse/materials.js`)

| Material | Current | Maps | Verdict |
|---|---|---|---|
| `walnut` | canvas grain texture | albedo only | **Usable after cleanup** — needs roughness + normal |
| `walnutDark` | canvas grain texture | albedo only | Usable after cleanup |
| `oakFloor` | canvas plank texture | albedo only | Usable after cleanup |
| `plaster` | canvas noise | albedo only | Usable after cleanup |
| `concrete` | canvas noise | albedo only | Usable after cleanup |
| `leather` | canvas mottle | albedo only | Usable after cleanup |
| `sageFabric` | canvas weave | albedo only | Usable after cleanup |
| `kraft` | canvas fibre | albedo only | Usable after cleanup — no flute normal |
| `ceiling` | **flat colour** | none | **Must be replaced** |
| `trimPaint` | **flat colour** | none | **Must be replaced** |
| `greenPaint` | **flat colour** | none | **Must be replaced** |
| `sagePaint` | **flat colour** | none | **Must be replaced** |
| `brass` | **flat colour** | none | **Must be replaced** — no brushed anisotropy |
| `iron` | **flat colour** | none | **Must be replaced** — powder-coat is not metallic |
| `chrome` | **flat colour** | none | **Must be replaced** |
| `charcoal` | **flat colour** | none | **Must be replaced** |
| `feltGreen` | **flat colour** | none | **Must be replaced** |
| `glass` | **flat colour**, opacity 0.22 | none | **Must be replaced** |
| rubber | **does not exist** | — | **Must be created** |
| plastic | **does not exist** | — | **Must be created** |
| powder-coated metal | **does not exist** | — | **Must be created** |
| dirty flooring | handled separately (`dirt.js` mask) | — | Retain |

**11 of 22 required materials are flat colour values with no maps at all.** Roughness is
a single scalar per material, so every wooden surface in the building has identical
sheen, and brass, chrome and charcoal are separated only by hue.

---

## 3. FIXTURE AUDIT (`src/render3d/clubhouse/fixtures.js`)

Dimensions are yards (≈ metres). Triangle counts derived from the geometry constructors
in source (segment counts are explicit), not guessed.

| Asset | Implementation | Quality | Size (w×h×d) | Tris | Mats | Collision | Visible | Decision |
|---|---|---|---|---|---|---|---|---|
| Club-wall bay (`rackUnit`) ×3 | beveled boxes, header, sign, 2 cradle rails, 16 brass clips, 3 drawers | **Usable after cleanup** | 3.0 × 2.4 × 0.9 | ~700 | 4 | AABB | yes | Retain; **upper tier is empty** — populate, add cornice, real bay lighting |
| Wall unit (`shelfUnit`) ×3 | sides, back, plinth, crown, 3 boards, brass edges, light strips | **Usable after cleanup** | 3.0 × 2.4 × 0.6 | ~600 | 4 | AABB | yes | Retain; densify contents |
| Apparel table (`tableUnit`) | top, apron, 4 legs, nesting table, hang rail | **Usable after cleanup** | 2.2 × 1.0 × 1.4 | ~500 | 4 | AABB | yes | Retain |
| Apparel rail (`railUnit`) | 2 uprights, bar, hanging sign | **Usable after cleanup** | 2.1 × 1.9 × 0.7 | ~400 | 4 | AABB | yes | Retain |
| Hat tree (`hatstandUnit`) | pole, 2 collars, foot, 8 pegs | Background-only | 0.8 × 1.8 × 0.8 | ~350 | 3 | AABB | yes | Retain, minor |
| Bag platform (`bagstandUnit`) | 2-tier plinth, back rail, 2 posts, sign | **Usable after cleanup** | 2.5 × 1.2 × 1.2 | ~300 | 4 | AABB | yes | Retain |
| Shoe wall (`shoerackUnit`) | back, sides, crown, 3 angled boards, lips, strips, bench, mirror | **Usable after cleanup** | 2.7 × 2.1 × 0.5 | ~700 | 5 | AABB | yes | Retain |
| Feature pedestal (`featureUnit`) | cylinder top, brass band, column, foot, felt | Production-ready | ⌀1.76 × 0.95 | ~300 | 3 | AABB | yes | **Retain as-is** |
| Checkout island (`buildCheckout`) | body, 3 insets, top, foot rail | **Usable after cleanup** | 3.2 × 1.0 × 1.0 | ~250 | 3 | AABB | yes | Retain; **register kit must be replaced** |
| Back counter (`backcounterUnit`) | cabinets, 4 doors, pulls, 2 hutch boards | **Usable after cleanup** | 3.2 × 2.0 × 0.5 | ~400 | 3 | AABB | yes | Retain; **hutch is empty** |
| Backroom shelving (`backshelfUnit`) ×3 | 2 posts + 3 plain boards | **Must be remodeled** | 2.6 × 2.3 × 0.6 | ~60 | 1 | AABB | yes | **Weakest fixture in the game.** No uprights, no bracing, no feet, and **nothing on it** |
| Lounge chair (`clubChair`) ×2 | 6 beveled boxes + 4 legs | **Must be remodeled** | 0.95 × 0.9 × 0.95 | ~450 | 3 | AABB | yes | Reads as a blob; needs a real club-chair silhouette |
| Coffee table | cylinder top/post/foot + 3 magazine slabs | Usable after cleanup | ⌀1.0 × 0.47 | ~200 | 3 | AABB | yes | Retain |
| Club events board | framed plane + canvas sign | **Production-ready** | 0.85 × 1.06 | 4 | 2 | none | yes | **Retain as-is** — reads well |
| Packing bench | top, under-shelf, 4 legs, clipboard, tape gun | Usable after cleanup | 1.7 × 1.0 × 0.85 | ~150 | 4 | AABB | yes | Retain |
| Cleaning corner | bucket, mop, broom cylinders | Background-only | — | ~120 | 4 | AABB | yes | Retain |
| Pendant lantern | flat black box + white panels | **Must be remodeled** | 0.4 × 0.5 | ~60 | 2 | none | yes | Crude; visible on entry |
| Wall wordmark | **flat green text decal + 3 flat triangles painted on plaster** | **Must be replaced** | — | 2 | 1 | none | yes | Ref 4 has a framed, backlit crest panel |
| Office course map | **green squiggle on a dark board** | **Must be replaced** | — | 2 | 1 | none | yes | Ref 7 has a real framed course map |
| Trophies | 3 gold cylinders | **Must be remodeled** | — | ~90 | 1 | none | yes | Ref 8 has cups with handles and plinths |
| Office chair | black blob | **Must be remodeled** | — | ~120 | 1 | AABB | yes | |

**Pivot / UV / normal quality (all procedural fixtures):** pivots are at the group origin
on the floor plane and are correct — build mode rotates and re-places them without drift.
`roundedBox()` generates analytic normals and per-face planar UVs with constant world-space
texel density, which is genuinely good. Plain `BoxGeometry`/`CylinderGeometry` parts (the
majority) have default UVs and hard normals — acceptable for small parts, wrong for
anything that shows a large flat face.

---

## 4. MERCHANDISE AUDIT (`clubhouse.js rebuildStock`) — **the real failure**

| Product | Implementation | Quality | Decision |
|---|---|---|---|
| **Polos / jackets (hanging)** | `BoxGeometry(0.3, 0.38, 0.035)` body + 2 box sleeves, **saturated flat green/blue** | **Must be replaced** | Reads as coloured cardboard. **Worst asset in the shop.** |
| **Polos (folded)** | `BoxGeometry(0.3, 0.055, 0.24)` slabs | **Must be replaced** | Reads as stacked LEGO |
| **Driver head** | `SphereGeometry(0.075, 10, 8)` scaled | **Must be replaced** | A squashed ball |
| **Iron head** | `roundedBox(0.095, 0.085, 0.022)` | **Must be replaced** | A flat blue tab |
| **Putter head** | `roundedBox(0.13, 0.03, 0.045)` | **Must be remodeled** | Closest to right; still crude |
| **Club shafts** | `CylinderGeometry(…, 6)` — **6-sided** | **Must be remodeled** | Visibly faceted |
| **Golf balls** | `SphereGeometry(0.026, 8, 6)` | **Must be replaced** | 8×6 segments, no dimples |
| **Ball boxes** | `BoxGeometry` + canvas label on +z | **Usable after cleanup** | Labels are good (fictional brands already). Rows are sparse; no bevel |
| **Golf bags** | `CylinderGeometry(0.15, 0.125, 0.95, 12)` + band | **Must be replaced** | Reads as a thermos flask |
| **Shoes** | flat blobs | **Must be replaced** | Reads as a computer mouse |
| **Caps** | hemisphere + cylinder-slice brim | **Usable after cleanup** | Best merch asset; keep the approach |
| **Gloves** | `BoxGeometry(0.11, 0.02, 0.2)` | **Must be remodeled** | A white tile |
| **Socks** | cylinders | Background-only | Acceptable |
| **Towels** | cylinders | Background-only | Acceptable |
| **Umbrellas** | cylinder + cone | **Must be remodeled** | |
| **Delivery boxes** | plain kraft cubes | **Usable after cleanup** | Need tape, flaps, labels |

**Material explosion:** `rebuildStock()` constructs `new THREE.MeshStandardMaterial(...)`
**inside the per-SKU, per-fixture loop**. Stocking the shop added 685 meshes and 77
materials. No instancing anywhere, despite products being the most-repeated objects in
the building.

---

## 5. ARCHITECTURE AUDIT (`shell.js`, `exterior.js`)

| Asset | Quality | Decision |
|---|---|---|
| Walls, floor, ceiling, coffered beams, wainscot, trim | **Usable after cleanup** | Retain — reads correctly. Wants roughness/normal maps |
| Windows (mullioned, glazed) | Production-ready | Retain |
| Doors (hinged, glazed, green) | Production-ready | Retain |
| Exterior siding / foundation / porch / columns | **Usable after cleanup** | Retain |
| Roof | Background-only | Flat green plane; wants shingle normal |
| **Gutters, downspouts, fascia, soffits** | **Do not exist** | **Must be created** — brief requires them; ref 9 shows them |
| **Landscaping (beds, shrubs)** | **Do not exist** | **Must be created** — grass runs straight into the foundation |
| Exterior grime (wash system) | Works, but **reads as a dark smear**, not dirt | Cleanup — soften, break up |

---

## 6. EXTERNAL ASSETS ON DISK

| Location | Contents | Status |
|---|---|---|
| `Assets/` | 18 owner-supplied GLBs (tractor, shed, tools, signs, cart, house) | Already integrated; **none are clubhouse-interior assets** |
| `vendor/models/trees/` | 6 Kenney CC0 trees | In use outdoors |
| `vendor/models/` | 20 game-ready GLBs | In use outdoors |
| `vendor/textures/` | 7 Poly Haven CC0 sets + water normal | Exterior only; **interior uses none** |

**There is not one purpose-made clubhouse-interior asset on disk.** Everything inside the
building is generated at runtime.

---

## 7. TOOLING — BLENDER

Blender **5.1.2 is installed** and drives fine headlessly
(`blender --background --python`), exporting glTF. **The Blender MCP addon socket is not
running**, so the interactive MCP tools are unavailable — this is recorded as a blocker,
but headless CLI is the better pipeline anyway: the authoring scripts get committed, so
every asset is reproducible rather than a binary that appeared from nowhere.

Meshy/Tripo generation is **not authorised** (costs the owner credits) and is not used.

---

## 8. DECISIONS — WHAT HAPPENS

**Production-ready, retained untouched (3):** feature pedestal, club events board, windows/doors.

**Usable after cleanup (material + density pass):** all fixture carcasses, architecture,
ball boxes, caps, delivery boxes.

**Must be remodeled or replaced (the work):**
1. **Material kit** — roughness + normal + AO for every surface; kill all 11 flat-colour
   materials; add rubber, plastic, powder-coat, brushed brass, real glass.
2. **Merchandise** — polos, club heads, shafts, balls, bags, shoes, gloves.
3. **Backroom shelving** — the weakest fixture; and fill the stockroom.
4. **Register kit** — real scanner, card terminal, receipt printer, cash drawer.
5. **Wall crest panel** and **framed course map** — replace the flat decals.
6. **Lounge chairs** and **trophies**.
7. **Gutters, downspouts, landscaping.**
8. **Draw calls** — share materials, instance repeated products, merge static parts.

**Requires a dedicated external model:** none. Everything above is reachable with
Blender-authored GLBs (organic shapes: bag, shoe, club heads, chair) plus procedural
THREE.js (everything dynamic).

---

## 9. PASS LOG

| Pass | What changed | Evidence |
|---|---|---|
| before | baseline, stocked, clock-pinned to 2 PM | `qa/assets/before/` |
| pass-1 | 11 merchandise models; material kit rebuilt with roughness/normal maps | `qa/assets/pass-1/` |
| pass-2 | 12 props; stockroom; register kit; crest; landscaping | `qa/assets/pass-2/` |
| pass-3 | crest re-sited above the hutch; clock pinned; baseline re-shot | `qa/assets/pass-3/` |
| final | pendant scale | `qa/assets/final/` |

The `before` set was **re-shot from the pre-asset-pass commit (92a4377) using the
final harness**, because the first baseline was taken with an unpinned clock and
its exterior landed at 1:42 PM while pass-2's landed at 2:33 AM. Comparing those
would have been meaningless. Every image in `before/` and `final/` is now the same
ten poses at the same 2:00 PM.

---

## 10. RESULTS

### Performance (whole scene, stocked, 1600×900, 2 PM)

| Metric | Before | Final | Δ |
|---|---|---|---|
| Draw calls / frame | 11,176 | **10,890** | −2.6% |
| Scene meshes | 1,603 | **1,289** | **−19.6%** |
| Unique materials | 296 | **270** | −8.8% |
| Geometries in memory | 2,603 | **1,542** | **−40.8%** |
| Scene triangles | 1,659,502 | 1,942,208 | +17.0% |
| Unique textures | 119 | 168 | +41% |
| Textures in memory | 164 | 213 | +49 |

Read this honestly: **draw calls barely moved.** Baking the merchandise per
material bought a real saving, and then I spent it — a full stockroom, a hand
truck, a register kit, two club chairs, trophies, a stocked hutch, shrub beds and
rainwater goods are all new objects that were not there before. The scene is
**substantially denser at slightly lower draw-call cost**, and mesh count is down
a fifth. That is the win; claiming a large draw-call reduction would be a lie.

Triangles are up 17% **by choice** — the profile said the interior was carrying 34
triangles per mesh and was draw-call bound, so geometric detail was the cheap axis.
Texture count is up because 11 materials that had no maps at all now carry
roughness and normal maps. I did not measure texture bytes and will not guess at
a figure.

### Assets

- **Retained untouched (3):** feature pedestal, club-events board, windows/doors.
- **Cleaned:** every fixture carcass and architectural surface, via the material kit.
- **Created (23 GLBs):** polo (hanging + folded), jacket, glove, shoe, bag, driver /
  iron / wedge / putter heads, cap, lounge chair, task chair, trophy, register,
  scanner, card terminal, receipt printer, cash drawer, carton (closed + open),
  hand truck, pendant.
- **Regenerated:** the entire first Blender batch — see below.
- **Rejected:** the first cut of polo, shoe and bag. Rendered, inspected, and thrown
  away because they read **worse** than the primitives they were meant to replace.
- **Still requiring external generation:** none.

---

## 11. REMAINING VISIBLE WEAKNESSES — stated, not hidden

1. **The office course map** is a 240×160 canvas and reads as a green squiggle. It
   is genuinely data-driven (it draws the real course plan), so it is honest — just
   low-resolution.
2. **The lounge "course photograph"** is still a flat green/blue gradient plane.
3. **The nearest ceiling pendant** reads as a dark shape when you stand directly
   under it — you are looking at the underside of its base plate.
4. **The exterior grime** still reads as a soft dark smear rather than dirt. This was
   already flagged in SESSION_STATE before this session and is unchanged.
5. **`cash_drawer.glb` is built but not placed.** It is an *open* till and there is no
   open/close animation to hang it on; wiring that is a systems job, not an art one.
   The asset is ready for it.
6. **No ambient-occlusion maps.** three samples `aoMap` from the `uv1` channel and the
   procedural fixtures only author `uv`. Contact darkening comes from the light rig
   and shadows instead.
7. **Customers/characters are untouched.** They are procedural primitives and they
   stand in these rooms. Out of scope for this session, but they are the next thing
   that will read as placeholder.
8. **The ball wall's top shelf** is still thin when stock is low — by design (it shows
   real inventory), but it means a poorly-stocked shop still looks sparse.
