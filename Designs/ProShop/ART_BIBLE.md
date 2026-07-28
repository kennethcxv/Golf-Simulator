# Golf Simulator — Pro-Shop Art Bible

The standard every asset, material and light in the starter pro-shop slice is judged
against. Scope, phase order and prohibitions live in `SLICE_BRIEF.md`; acceptance
procedure lives in `ANTI_SLOP_CHECKLIST.md`. This document does not restate either.

What makes this bible worth following is that it is written against **this** renderer,
measured, rather than against general art advice. Where a rule exists, it exists because a
specific measurement or a specific visible difference demanded it.

**Every spec below carries a gate:**

* **[T] Technical gate** — machine-verifiable. The check is named.
* **[V] Visual gate** — human judgement. The side-by-side to look at is named.

A rule that fits neither is an adjective and has been cut.

---

## 1. The two anchors

Every rule in this document traces to a visible difference between these two objects,
both currently in the room, both shot in-game at gameplay framing:

**`reference/best-vs-worst.png`** — and the full plates alongside it.

| | Best in room | Worst in room |
|---|---|---|
| Object | Reception counter run (`MESH_CounterTop`, `MESH_DeskPlinthSet`, `MESH_OfficeDeskDrawerFrontSet`, `MESH_OfficeDeskBrassPullSet`) | Floor debris (`DebrisGritInstances`, `DebrisLitterInstances`) |
| Triangles | 188 top / 216 plinth / 648 drawer fronts / 2,520 pulls | **36 per grit instance, 32 per litter instance** |
| Silhouette | Stile-and-rail panels, returned corner, posts, bullnose worktop edge | Flattened lump; reads as a decal |
| Bevel | Consistent, catches light along every edge | None visible at working distance |
| Material | Walnut with believable grain scale, brass pulls, distinct worktop | Single flat colour, no identity |
| Contact | Sits on the floor; plinth grounds it | Floats visually — no bevel or contact break |

**Still true:** the debris is *not* a two-triangle quad, which is what it looks like. It is
a 36-triangle dodecahedron flattened to 0.22 of its height. It has geometry and still reads
as a sticker. **Triangle count is not the problem, and adding triangles is not the fix.**

> ### SUPERSEDED — the original diagnosis was wrong
>
> This section originally concluded: *"The difference is bevel, material identity and
> contact — not density."* That was tested on one asset in
> `Spike/BIBLE_VALIDATION.md` and **it does not hold.**
>
> The control asset already satisfied all three claims — `baseY` exactly `0.0000`, bevels
> present at **8–24 mm** (*larger* than §5 asks for), materials palette-aligned — and still
> read as a primitive. Applying the bible's bevel, material and contact specs in three
> separate arms changed almost nothing at object scale.
>
> **The actual discriminator is texture presence.** A survey of every GLB family:
>
> | family | files | with zero embedded images |
> |---|---|---|
> | checkout kit | 49 | **1 (2 %)** |
> | sheet_06 architecture | 10 | **0 (0 %)** |
> | sheet_07 fixtures | 10 | **10 (100 %)** |
> | sheet_08 tools | 10 | **10 (100 %)** |
> | clubhouse / merch | 152 | **129 (85 %)** |
>
> ### How the error happened — worth preserving
>
> **The anchors were selected badly, and the selection encoded the wrong conclusion.**
> I picked the reception counter as "best" and floor debris as "worst" by eye, then derived
> every rule from the differences I could see between them. What I did not check is that
> the counter area is served by the **checkout kit — the one family that is 98 % textured**
> — while the debris and the worktable are from families that are **100 % untextured**.
>
> So the anchors differed in texture *and* in bevel, material and contact at the same time,
> and I attributed the gap to the three properties I had looked at rather than the one I
> had not. Choosing anchors from the same asset family, or checking what varies between
> them before writing rules, would have caught it.
>
> The rules below are still worth following — they were just aimed at the wrong cause.
> §7.4 now carries the requirement that actually matters.

---

## 2. Renderer facts you must design against

These are measured properties of this engine. Designing against a generic PBR mental model
will produce assets that fail here.

### 2.1 Contact darkening is GTAO, and only GTAO

| Setting | Value |
|---|---|
| Resolution | **Full** (1600 × 900 render target) |
| `blendIntensity` | **1.0** |
| `samples` | **24** |
| `uniforms.radius` | **1.5** yards |

Configured once in `GTAO_CONFIG` (`render3d/courseScene.js`) and pinned by
`tests/gtao-config.test.js`.

> **Do not raise the radius.** 2.4 was measured. It reads as broad blotchy staining
> spreading a foot across the floor rather than as contact, and it made the room look
> dirty rather than grounded. Intensity and resolution buy grounding; radius buys spread.
> Evidence: `Spike/LIGHTING_SPIKE.md` addendum and `Phase1/data/ao-verify/`.

**Design consequence:** occlusion is computed in screen space from depth and normals, at a
1.5 yd search radius. It rewards **geometry that creates a real crevice** — a plinth, a
recessed toe-kick, a stile-and-rail panel, a lid seam — and does nothing at all for a
painted-on line. If you want an edge to read, it has to exist.

### 2.2 No interior light can cast a shadow

* **RectAreaLights cannot cast shadows in three.js.** The eight authored ceiling panels
  (`shell.js:914-956`) never will. This is not a setting.
* **Sun shadows are deliberately stripped from every interior mesh**
  (`clubhouse/interiorShadowPolicy.js`, funnelled through the wrapped `interior.add`). That
  policy is **correct and stays**: Arm 2 of the lighting spike enabled interior casting
  across 2,186 of 2,191 meshes and the room only got uniformly darker — the roof blocks the
  sun, so everything indoors simply sits in shadow. It bought no grounding.

**Design consequence:** an asset gets no cast shadow indoors. Its read comes from
silhouette, material response, and GTAO in its own crevices. Assets that depend on a key
light raking across them to look good will look flat here.

### 2.3 "Softer shadows" is currently impossible, not a tuning task

`courseScene.js` requests `PCFShadowMap`. It previously requested `PCFSoftShadowMap`, which
three.js **r185 silently coerces to PCF at first render** (`vendor/three.module.js:9148`).
`sun.shadow.radius` is only consulted by `PCFSoftShadowMap` and `VSMShadowMap`, so under
plain PCF **it does nothing**. Softening would require moving to VSM, a different change
with its own artefacts.

Do not write "soften the shadows" into an asset note. It is not available.

### 2.4 The room starts dark, and that is a gameplay beat

`powered = !campaign.enabled || repairComplete(state, 'ceiling')`
(`clubhouse.js:1049-1057`). Under the starter campaign the room is **unlit until the player
repairs the ceiling**. Then: **`panel-02` flickers** and **`panel-07` is dead** by default
(`shell.js:1001-1002`), and repair must permanently stop the flicker.

**Design consequence:** every asset must read in an under-lit room, and the neglected and
restored lighting states are both shipping states. An asset approved only under full
lighting has been approved under conditions the player does not start in.

### 2.5 Material count is not the appearance problem

The scene carries ~815 unique materials against 227 unique textures. That is **per-GLB
instance duplication** — the plain (uncached) `GLTFLoader` mints fresh `THREE.Material`
objects per file even when the embedded images are byte-identical, and the shared texture
pool interns *textures*, never *materials*.

**Consolidating them will not change how the room looks.** It is a hygiene and memory task,
not an art task. Do not schedule it as a visual improvement, and do not let it block one.

### 2.6 Measured budget context

Interior subtree, current room: **2,191 meshes, 673,418 triangles.** The heaviest items are
architecture, not props — the wainscot panel run alone is 48,384 triangles. Texture
inventory is dominated by 256² (78 textures), then 1024² (23), 512² (21), 128² (21), with
12 at 2048².

---

## 3. UNRESOLVED — interior key light

**This is the largest open question in the slice, and it is deliberately not settled here.**

The lighting spike's Arm 3 added a warm shadow-casting directional light inside the room. It
was **not adopted**, and it is **deferred to Phase 5**.

### What is actually known, stated precisely

The contact-luma decomposition, mean over three floor-contact points
(`Spike/lighting/contact/`):

| Configuration | contact luma | Δ vs control |
|---|---|---|
| control | 67.6 | — |
| **Arm 4 — AO alone (shipped)** | 62.8 | **−4.8** |
| Arm 2 — interior sun shadows (rejected) | 42.0 | −25.7 |
| Arm 3 — Arm 2 + key light | 42.3 | +0.4 vs Arm 2 |
| Arm 5 — everything | 38.7 | −29.0 |

> **A correction to how this was previously summarised, including by me.** The large
> 90.6 → 53.5 movement at the table legs is **Arm 2's doing, not the key light's.** The key
> light's marginal contribution at contact points is **+0.4 — it very slightly lightened
> them.** And Arm 2 is the arm we rejected, because its darkening is global dimming rather
> than grounding: it darkens open floor far from any object just as much.
>
> The metric is at fault as much as the reading. Mean luminance over a crop cannot tell
> "darker everywhere" apart from "darker at the contact". The crops can, and they show only
> AO producing a localised pool at the leg base.

### So what is the key light actually for?

Not contact. **Directional form and cast shadow.** In `Spike/lighting/compare/arm2-vs-arm3-07-cleaning-route.png`
it produces a visible shadow band across the floor and gives the snack rack legible
tonal separation — things AO cannot do. That is a real and unreplaced gap.

**Both halves matter and they do different jobs.** AO grounds objects; a key light gives
them form. The shipped AO is the whole of the first job and none of the second.

### Conditions any interior key light must satisfy

1. Gated to the **same power state** as the eight panels — dark until the ceiling repair.
2. Gated to the **same fault state**, so a room with a dead and a flickering panel does not
   read as evenly lit from an invisible source.
3. Motivated by something the player can see. Arm 3's direction corresponded to no window
   or fixture, so its shadows were physically arbitrary.
4. Resolves the `THREE.WebGLProgram: VALIDATE_STATUS false` error and the +3 s load
   regression Arm 3 carried.
5. Re-measured on the contact crops, not on whole-frame metrics.

### What this blocks

**No shadow-softness spec, no final exposure value, and no final contrast target appear in
this bible.** All three depend on whether a shadow-casting interior light exists. Writing
them now would mean re-approving every asset judged against them.

> **Any asset approved before this resolves is being judged under provisional lighting.**
> Record that on its approval. Expect a re-review of material response and wear levels after
> Phase 5, and do not treat a Phase-4 approval as final for anything lighting-dependent.

---

## 4. Units, scale and dimensions

| Spec | Value | Gate |
|---|---|---|
| World unit | **The yard.** All runtime coordinates, radii and layout datums are yards | [T] `shopLayout.js` is authored in yards; any new datum must be |
| Authoring unit | **Metres in Blender**, converted once at adoption by `METERS_TO_YARDS = 1.0936133` | [T] `sheet06AssetCache.js` applies the scale exactly once and re-checks after placement |
| Export scale | Applied (scale 1,1,1 in the exported node) | [T] existing asset-validation tooling |
| Room envelope | Walkable **17 × 10 yd**; ceiling 3.2 yd | [T] `clubhouse().isInside` grid sample |
| Counter top height | **1.055 yd** (`COUNTER_TOP`, `shopLayout.js:469`) | [T] `tests/checkout-space.test.js` |
| Staff corridor | ≥ **1.1 yd** behind the counter | [T] `tests/checkout-space.test.js` |
| Walker diameter | 0.64 yd (nav radius 0.32) — no gap narrower | [T] `nav.path` between route stops |

**Do not change `shopLayout.js` datums to suit an asset.** They are read by the simulation,
navigation, the grime grid and the test suite simultaneously. Fit the asset to the datum.

---

## 5. Bevel language

The single clearest difference between the two anchors. The counter's edges catch light
along their whole length; the debris has no bevel and dies flat.

| Class | Bevel width | Segments | Gate |
|---|---|---|---|
| Architectural edge (counter run, wall panel, door frame) | **4 mm** | 2 | [V] anchor plate: counter worktop edge |
| Furniture and fixture edge (shelf board, table top, plinth) | **3 mm** | 2 | [V] same |
| Prop edge (mug, box, kettle, bottle) | **1.5 mm** | 1–2 | [V] against `best-counter-millwork.png` |
| Small clutter (debris, tee, marker, coin) | **1 mm** | 1 | [V] against the worst plate — this is the rule the debris breaks |
| Fabric, foam, upholstery | no hard bevel; model the soft form | [V] lounge seating |

Rules:

* **Nothing ships with a razor edge.** Every hard-surface edge takes a bevel. [V]
* Bevel width is **absolute, not relative** — a 4 mm bevel is 4 mm on a door frame and on a
  drawer front. Scaling bevels with the object is what makes a prop family look unrelated. [V]
* Bevels must not distort a hinge line, a drawer runner, or a contact face. [T] moving-part
  travel check.
* **Do not add bevels to buy realism on an object that lacks form.** The debris needs a
  silhouette and a material first; a bevel on a flat lump is still a flat lump.

### Correction — the room is over-bevelled, not under-bevelled

The original framing here implied assets lacked bevels. They do not.
`asset_065_stockroom_worktable` ships with worktop 24 mm / 3 segments, dark edge 10 mm,
legs 10 mm, aprons 8 mm, shelf 14 mm — every one **larger** than the table above asks for.
Applying the 3 mm spec *reduced* them.

**Keep the values.** At 3 mm the worktop reads as a timber arris; the shipped 24 mm chamfer
reads soft and slightly plastic (`Spike/bible/compare/worktop-edge.png`). But stop
describing the room as missing bevel language, and expect a bevel pass to be a
**tightening** job.

### A bevel pass is also a defect-finding pass

This is the strongest practical reason to do one, and it was discovered by accident.

Tightening the worktop bevel from 24 mm to 3 mm **exposed a hidden coplanar defect**: the
brass corner caps sat centred at z 0.914 with 0.012 thickness, putting their top face at
0.920 — exactly coplanar with the worktop top (0.8775 + 0.085/2) and their bodies buried
inside the slab. The oversized bevel had been covering it. At 3 mm it appears as a bright
brass square sunk into the corner
(`Spike/bible/compare/leg-floor-contact.png`, panels B and D).

**An oversized bevel can conceal a geometry error indefinitely.** Any asset receiving a
bevel pass must be re-inspected at the tightened width before the pass is called done — the
new edge will reveal intersections the old one was hiding. [V] corner and junction crops
before and after. [T] a coplanar-face check between adjacent parts would catch this class
automatically and does not exist yet.

---

## 6. Polygon targets

Derived from what the room already spends, not invented. Counts are per object, triangles.

| Class | Target | Ceiling | Anchor |
|---|---|---|---|
| Hero fixture (counter run, register assembly, wall shelving) | 4,000 | 8,000 | counter parts sum ≈ 3,600 |
| Secondary fixture (freestanding rack, display table, bench) | 1,200 | 2,500 | — |
| Functional prop (monitor, printer, kettle, till drawer) | 400 | 1,000 | `MESH_DeskPhoneHandset` 188 |
| Surface prop (mug, scorecard, pen pot, plant pot) | 150 | 400 | `MESH_CounterPlantPot` 188 |
| Small clutter (debris, tee, ball marker) | 60 | 150 | debris currently 36 |
| Detail set (handles, pulls, hinges, catches) | 600 | 1,500 | `MESH_OfficeDeskBrassPullSet` **2,520 — over budget** |

**Two things this table is saying:**

1. **`MESH_OfficeDeskBrassPullSet` is the room's clearest example of misallocated detail** —
   2,520 triangles of drawer pulls on a desk whose top is 188. Detail must go where the eye
   goes. [T] a per-mesh triangle census; the probe used for §2.6 is the check.
2. **Raising the debris from 36 triangles will not fix it.** Its budget is fine. Its
   problem is §5 and §7.

Architecture is exempt from these numbers and governed by the room, but note that the
wainscot run at 48,384 triangles is the single largest interior item — if the greybox
re-authors panelling, that is where the budget is. [T] census.

---

## 7. Materials

### 7.1 The shared kit

Materials come from `makeClubhouseMaterials()` (`clubhouse/materials.js`), which is
**per-instance, not global** — a v2 room can own its own kit cleanly, and the variant
adapters and `pineHillsInterior` consume none of it.

| Rule | Gate |
|---|---|
| An asset uses only kit slot names; no one-off materials without a documented exception | [T] material-name audit against the kit's exported keys |
| **Tintable bases stay neutral grey** — `color` multiplies into `map`, and a green tint on a green weave read near-black (`materials.js:764-770`) | [T] assert base colour of tintable slots is achromatic |
| Data maps stay linear; albedo stays sRGB | [T] existing colour-space check |
| Glass is glass, not transparent plastic; metal is not plastic | [V] anchor plate — brass pulls vs the debris' flat fill |

### 7.2 Roughness and metalness

| Family | Roughness | Metalness | Note |
|---|---|---|---|
| Painted wall / plaster | 0.85 – 0.95 | 0 | |
| Walnut, medium and dark | 0.55 – 0.70 | 0 | Grain scale believable at 1 yd |
| Secondary wood / oak floor | 0.60 – 0.75 | 0 | |
| Powder-coated metal | 0.55 – 0.70 | 0 | **Non-metal**: powder coat is a paint film |
| Brushed steel | 0.30 – 0.45 | **1** | |
| Muted brass | 0.35 – 0.50 | **1** | Restrained — this is a municipal club, not a hotel |
| Clear glass | 0.02 – 0.08 | 0 | |
| Retail plastic | 0.40 – 0.60 | 0 | |
| Upholstery / felt | 0.85 – 1.00 | 0 | |
| Rubber | 0.90 – 1.00 | 0 | |
| Dirt / dust overlay | 0.90 – 1.00 | 0 | Never metallic |

**Metalness is binary.** 0 or 1, never between. Anything reading as "slightly metallic" is a
roughness problem. [T] assert metalness ∈ {0, 1} across the slice's materials.

**No material may exist to hide weak geometry.** [V]

### 7.3 Texture resolution

| Use | Size | Gate |
|---|---|---|
| Tiling surface (wall, floor, fabric) | **256²**, the room's dominant working size | [T] texture census |
| Hero asset albedo | **1024²** ceiling | [T] census |
| Small prop | **256²** ceiling | [T] census |
| Signage and readable text | up to **1024** on the long edge | [V] legibility at 2 yd |
| Anything above 1024² | requires written justification | [T] census flags them |

Texel density target: **256 px per yard** on hero and fixture surfaces, ±25 %. [T]
computable from UV area against world area. This is what keeps a counter and the shelf
beside it looking like the same production.

### 7.4 Textured surface is REQUIRED — this is the rule that was missing

> Added after `Spike/BIBLE_VALIDATION.md` found that the bible specified texture
> *resolution* and *density* while never requiring a texture to exist at all. Every §7.3
> number above presupposes a map that **100 % of sheet_07 and sheet_08 assets do not have.**

| Rule | Gate |
|---|---|
| Every fixture, furniture and hero asset ships with **at minimum an albedo and a roughness map**. Flat `baseColorFactor` + a roughness scalar is not an acceptable surface | [T] GLB image count > 0 per asset — the survey script in `Spike/BIBLE_VALIDATION.md` is the check |
| A **normal map** is required on any surface a player stands within 2 yd of: worktops, counter fronts, shelf boards, seat faces | [T] `normalTexture` present |
| Small clutter and instanced debris are **exempt** — at 4 cm they cannot carry a readable map | [T] exempt list |
| Materials that are genuinely uniform (glass, powder-coated metal, painted trim) may ship albedo-flat, but still need roughness variation | [V] side-by-side against a textured neighbour |
| No asset ships whose material count exceeds its **distinct real-world material count** | [T] material census |

**Why this outranks everything else in §5–§8.** Measured on one asset across three arms:
correcting bevels to spec, correcting palette hex and roughness into range, and correcting
contact produced *marginal* change at object scale. The object still read as coloured boxes,
because there was no surface for any of those corrections to modulate. The counter reads
better than the worktable because the checkout kit carries 145 embedded images across 49
files and sheet_07 carries zero — not because its bevels or its palette are better.

**Do not approve a hero asset that ships with zero embedded images.** That is now the single
highest-value technical gate in this document.

---

## 8. Palette

Approved palette per `SLICE_BRIEF.md` §6, given as values. Sampled from or aligned to
colours already in the room where one existed.

| Name | Hex | Where it is allowed |
|---|---|---|
| Warm cream | `#E8DFC9` | Walls above chair rail, ceiling field, signage ground |
| Plaster shadow | `#CFC6B0` | Wall in shade; never as a fill colour |
| Medium walnut | `#6B4A2F` | Counter run, trim, chair rail, furniture frames |
| Dark walnut | `#3E2A1B` | Plinths, toe-kicks, beam faces, drawer interiors |
| Deep green | `#2F4A35` | Club identity: signage ground, polo goods, logo rug |
| Deep green shadow | `#21351F` | Fabric fold and cuff interior only |
| Sage green | `#9FB09A` | Lower wall panelling, restrained accent |
| Charcoal | `#2B2E30` | Display table tops, monitor housings, electronics |
| Black powder-coat | `#1C1E1F` | Racks, brackets, shelf standards, stands |
| Muted brass | `#A8823C` | Pulls, catches, small fixings **only** — never a large surface |
| Warm panel light | `#FFD8AD` | Ceiling panel emissive (existing rig value) |
| Dead diffuser | `#C9C1B3` | The `panel-07` dead-panel face (existing value) |

Rules:

* **Brass is a jewellery metal here.** If a brass surface is larger than a hand, it is
  wrong. [V] anchor plate: the counter's pulls are the correct dose.
* **No colour outside this table ships** without an approved exception. [T] a palette audit
  sampling material base colours and flagging any outside a tolerance of the listed values.
* Merchandise packaging is exempt — retail goods are allowed branded colour, and that
  contrast is what makes the shelves read. [V]
* Campaign markers (`#C59A4A` facility, `#B66D3D` repair) are **UI affordances, not palette**.
  They are deliberately outside the room's colour language so they read as interactive.

---

## 9. Wear, dirt and the two states

The room ships in two states and both are judged.

| Rule | Gate |
|---|---|
| Dirt lives in a **separate layer** from the clean base material; cleaning reveals a believable clean surface | [T] `reno.grime` drives the overlay, not the base material |
| Wear follows **use**: hand height on doors, foot height on plinths, traffic lines on floor | [V] neglected-state screenshots |
| Wear is **authored, never randomised** | [V] |
| Damage is restrained — the room is neglected, not derelict | [V] |
| The restored state must not erase all character | [V] before/after at identical camera |
| Dirt must read at gameplay distance | [V] `Baseline/screenshots/09-floor-dirt-read.png` — the current floor is `condition 10 — filthy` and does **not** read as dirty. This is the standing failure the slice must fix. |

**The grime grid is 13 × 8 = 104 cells over the room** and its plan is authored against
`DOOR_MAIN`, `TRAFFIC_PATHS`, `FIXTURES` and `MAT`. A new fixture layout needs a new dirt
plan or grime paints where nobody walks. [T] `tests/shop-reno.test.js`.

---

## 10. Pivots, collision and LOD

| Spec | Rule | Gate |
|---|---|---|
| Pivot | At the functional origin: floor contact for standing objects, hinge line for doors, slide axis for drawers | [T] pivot assertion in asset validation |
| Socket authority | **Registry sockets are gameplay truth and never move.** Authored GLB sockets are aligned onto them at adoption; visuals swap, gameplay geometry does not | [T] `toolViewmodel.js` adoption path; `sheet06AssetCache.js` socket validation |
| Placement | Objects are positioned by landing `SOCKET_PLACEMENT` on the target datum | [T] `propPlacement.js` |
| Collision | **Analytic AABBs registered through `addCol` are the only navigation authority.** GLB collision stays inactive | [T] `sheet06AssetCache.js` collision contract; `tests/customer-nav.test.js` |
| Collision shape | Matches the gameplay silhouette, not the visual detail — no snagging on trim | [T] nav path between route stops |
| Doors | Colliders carry the `door` flag or the doorway becomes a wall | [T] `tests/customer-nav.test.js` |
| LOD | Required for purchasable furniture (`_lod1`, `_lod2` convention already in `proShopFurniture.js`). **Not required** for fixed interior dressing — the interior is distance-gated at 80 yd and culled wholesale | [T] file-presence check |
| Shadow flags | Interior meshes must flow through `interior.add` so `castShadow` is stripped | [T] traverse assert: zero interior casters |

---

## 11. How an asset is accepted

Follow `ANTI_SLOP_CHECKLIST.md`. This bible adds three slice-specific requirements:

1. **Judged in the under-lit state as well as the lit one.** §2.4 — the room starts dark.
2. **Judged against the anchors.** A new asset is placed beside `best-vs-worst.png` and must
   sit at or above the counter, not between the counter and the debris.
3. **Provisional-lighting flag.** Until §3 resolves, every approval records that it was made
   under provisional lighting and is subject to re-review after Phase 5.

---

## 12. What this bible deliberately does not specify

| Deferred | Why | Unblocks when |
|---|---|---|
| Shadow softness | Not achievable under PCF; §2.3 | VSM is evaluated, or never |
| Final exposure value | Depends on whether a shadow-casting interior light exists | §3 resolves |
| Final contrast / tonemapping target | Same | §3 resolves |
| Minimum-spec polygon and texture budgets | Every measurement is from one RTX 5080 | A second machine is measured |
| Material consolidation targets | Hygiene, not appearance; §2.5 | Independent of this slice |

---

## Reference plates

```
Designs/ProShop/ArtBible/reference/
  best-vs-worst.png            the anchor plate every rule traces to
  best-counter-millwork.png    best asset, gameplay framing
  best-counter-corner.png      best asset, returned corner and panel language
  worst-floor-debris.png       worst asset in situ on the boards
  worst-snack-packaging.png    printed-card packaging, the second-worst family
  reference.json               poses, seed, FOV assertion, live GTAO settings
```

Captured by `tools/qa/proshop-artbible-reference.js`: fixed seed 20260727, 1600 × 900,
FOV 66 asserted against the walk lens, clock pinned 13:00, customers hidden, doors closed,
toasts suppressed, shop condition 10.
