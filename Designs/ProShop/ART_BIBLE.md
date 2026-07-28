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

### 7.3 Texture resolution — measured, not conventional

> **Revised.** The previous version of this section set a texel-density target of 256 px
> per yard and a 1024² hero ceiling. Both were written by convention. Measurement says the
> density target was **roughly 3× too low** and the size ceiling **4× too high**, which is
> the worst pairing available: assets that are simultaneously blurry where you stand and
> expensive where you do not. The numbers below come from
> `tools/qa/proshop-texel-density.js` against the live room.

**The unit.** Two quantities, both measured by casting rays one pixel apart and reading
back the world hit point and the UV:

* **`pixelsPerYard`** — what the display can resolve on a surface at a given distance.
  A property of the camera, not the asset. This is the **requirement**.
* **`texelsPerYard`** — what the asset supplies. A property of the map size and the tile
  size, independent of where the camera is. This is the **supply**.

A surface needs supply ≥ requirement at the **closest distance a player can reach it**,
and not one texel more. Above that the GPU picks a lower mip and the extra memory is
literally never sampled.

**Measured requirement in this room** (1600×900, FOV 66, and the analytic
`H / (2 d tan(fov/2))` agrees with the ray measurement to within 1 % — 346 predicted vs
350 measured at 2 yd):

| Standoff | Measured `pixelsPerYard` | What is at this distance |
|---|---|---|
| 0.5 yd | **767** | Nose against a counter front. The collision body radius is 0.34 yd, so ~0.5 yd is the closest realisable |
| 1 yd | 693 | Working at a worktop |
| 2 yd | 350 | Standing back from a fixture |
| 3 yd | 237 | Across the retail floor |
| 4 yd + | ≤ 173 | Ceiling, upper wall, far shelving |

**Ceilings.** Express the ceiling as **texels per yard**, then derive the map size from
the tile size — because tile size is the thing that actually varies, and a "512² map" means
nothing until you know how far it stretches.

| Class | Reachable to | Required `texelsPerYard` | Max tile at 256² | at 512² | at 1024² |
|---|---|---|---|---|---|
| **Hero** — counters, worktops, seat faces, anything within arm's reach | 0.5 yd | **768** | 0.33 yd | **0.67 yd** | 1.33 yd |
| **Standing** — fixture bodies, cabinet sides, shelf boards | 2 yd | **384** | 0.67 yd | 1.33 yd | 2.67 yd |
| **Background** — upper wall, ceiling, far dressing | 3 yd | **256** | 1.00 yd | 2.00 yd | 4.00 yd |
| **Out of reach** — ceiling field, beam faces | 4 yd + | **192** | 1.33 yd | 2.67 yd | 5.33 yd |

For a non-tiling unique-UV map, substitute the surface's own span for the tile size:
`mapSize = texelsPerYard × spanYd`.

**The practical consequence: 512² is the hero ceiling in this room, and 1024² is only
justified for a tile larger than 1.33 yd.** Nothing in a 17 × 10 yd room viewed from
0.5 yd needs 2048².

**Verified against a real surface.**

* `asset_065`'s rebuilt worktop supplies **1029 texels/yd** from a 512² map against 646
  required at its closest approach — 1.6× headroom, minimum observed mip 0.67, so mip 0
  is never sampled. Dropping it to 256² would supply 514 and go under at arm's length.
  **512² is the correct call for this asset by measurement, not by rounding.**

> **Correction, 2026-07-27.** An earlier version of this section stated that the reception
> counter supplies **701 texels/yd** and used it as the second anchor. That was wrong. The
> counter carries **no textures at all** — `tools/qa/proshop-counter-material-audit.js`
> reports 0 of 6 materials with a map. The 701 figure came from an unnamed 1024×640 map
> *behind* the counter that the probe's ray reached instead.
>
> **A surface with no texture is invisible to a texel-density probe**: there is no UV
> derivative to take, so the sample walks past it to whatever is behind. Any probe of this
> kind must report the object and texture it actually hit, which
> `tools/qa/proshop-texel-density.js` does — the error was in reading its output, not in
> the instrument.
>
> **The ceiling is unaffected.** The requirement curve is measured from the camera and the
> display, not from any surface, so 767 px/yd at 0.5 yd and the 768 texels/yd hero ceiling
> both stand. What is lost is a corroborating example — and what replaces it is a stronger
> statement of the same case: the room's best-looking object is not marginally
> under-resolved, it is untextured.

| Rule | Gate |
|---|---|
| No runtime texture exceeds 512 on its long edge without written justification | [T] `tests/proshop-texture-budget.test.js` reads dimensions out of the shipped GLBs |
| A hero surface supplies ≥ 768 texels/yd | [T] `tools/qa/proshop-texel-density.js`, `texelsPerYard` at the target. **Read the `hit` and `tex` fields, not just the number** — an untextured surface has no UV derivative, so the sample passes through it and reports whatever is behind. A missing texture reads as a passing one otherwise |
| A hero surface has a texture at all | [T] `tools/qa/proshop-counter-material-audit.js` reports textured-material counts per asset. This exists because the row above cannot detect the absence it is meant to police |
| No surface supplies more than 2× its class requirement | [T] same probe: a minimum observed mip ≥ 1 across every pose means mip 0 is never sampled and the map can be halved |
| Signage and readable text | up to 512 on the long edge | [V] legibility at 2 yd |

**Where the ceiling is applied.** The Blender builder exports canonical and runtime GLBs
identically at source resolution; the ceiling is applied to the *runtime* GLB afterwards by
`tools/blender/pack_ktx2.mjs --max-size 512`. That split is deliberate — the canonical
asset keeps full-resolution source — but it means the reduction is easy to lose by
re-running the builder and forgetting the pack step, which is what the budget test exists
to catch.

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

### 7.4.1 Palette calibration — bringing a CC0 albedo onto palette

> Added because §7.4 requires a texture and §8 requires a palette, and satisfying both at
> once is a real job that nobody had costed. `Spike/TEXTURE_VALIDATION.md` Arm F applied CC0
> maps over palette-tinted bases and **drifted off palette** — every individual value in it
> looked reasonable. Calibration was estimated at 1.5–3 h of the 2.75–5.25 h per asset, so
> this is most of the texture pass, not a finishing step.

**Why tinting a downloaded map does not put it on palette.** The renderer computes

```
albedo_linear = baseColorFactor × texture_linear
```

so the shipped colour is the **product** of two colours. A downloaded albedo arrives with
its own hue, its own mean brightness and its own saturation. Multiply a walnut tint into
an already-brown wood photo and the result is browner, darker and more saturated than
either — reliably off palette, and off by a different amount for every source map.

**The rule: the map carries variation, the tint carries hue.** Three steps, all arithmetic,
none by eye. `tools/blender/cc0_calibrate.py` performs and reports them.

| Step | What happens | Why this operation |
|---|---|---|
| 1. **Desaturate** | Collapse the map to its Rec. 709 luminance | Strips the source's hue so it stops competing with the palette. After this the map is achromatic and contributes only light and dark |
| 2. **Exposure-normalise** | One multiply in linear space, chosen so the map's p99 luminance reaches 0.95 | A constant multiply in linear is an exposure change: it preserves **every ratio exactly**, so grain contrast survives. A gamma or levels curve would not. p99 rather than max so one specular pixel does not set the exposure |
| 3. **Solve the tint** | `baseColorFactor = target_linear / mean_luminance_of_normalised_map` | The mean of (constant × image) is constant × mean, so this lands the shipped mean **exactly** on the §8 value. The tint is computed, never eyeballed |

Step 2 is not optional and is not cosmetic. Without it, a dark source cannot reach a
lighter palette value at all: `baseColorFactor` is clamped to [0, 1], so if the required
tint exceeds 1.0 the colour is simply unreachable by multiplication. Wood051 hits this —
see below.

**What gets tinted, what does not.**

| Map | Calibrate? | Colour space |
|---|---|---|
| Albedo / base colour | **Yes** — all three steps | sRGB |
| Roughness, metalness, AO | **No.** These are data, not colour. Desaturating or tinting them changes material response, not appearance | Non-Color / linear |
| Normal | **No.** Never touch a normal map's values | Non-Color / linear |
| Emissive | Tint only, to the §8 emissive value; no exposure normalisation — its absolute level is the light output | sRGB |

#### Worked example — asset_065, the stockroom worktable

Measured with `python tools/blender/cc0_calibrate.py --report` against the three ambientCG
(CC0 1.0) sources in `asset_sources/textures/cc0_spike/`.

| | Worktop | Underframe / shelf | Legs, brackets |
|---|---|---|---|
| Source | `Wood051` albedo | `Wood062` albedo | `Metal032` albedo |
| Source mean, as sRGB | `#42352F` | `#63544B` | `#7D8994` |
| Source mean luminance (linear) | 0.0388 | 0.0955 | 0.2425 |
| Source contrast (p90/p10) | 1.95 | 3.17 | **1.14** |
| §8 target | Medium walnut `#6B4A2F` | Dark walnut `#3E2A1B` | Black powder-coat `#1C1E1F` |
| **1.** desaturate | mean chroma 0.0266 → 0 | 0.0549 → 0 | 0.0892 → 0 |
| **2.** exposure gain | **×15.03** → mean 0.5837 | ×4.39 → mean 0.4192 | ×3.46 → mean 0.8386 |
| **3.** solved `baseColorFactor` | 0.2519, 0.1173, 0.0487 | 0.1149, 0.0552, 0.0261 | 0.0138, 0.0155, 0.0163 |
| Shipped mean | `#6B4A2F` ✔ | `#3E2A1B` ✔ | `#1C1E1F` ✔ |
| **Same tint, skipping step 1** | `#7E4627` — **off by 20.4** | `#472816` — off by 10.5 | `#191E23` — off by 4.7 |

Two things this example is here to teach:

* **Wood051 is unreachable without step 2.** Its mean luminance is 0.0388 while medium
  walnut's red channel needs 0.147, so the tint would have to be **3.79** — nearly four
  times the legal maximum. Tinting the raw map cannot produce medium walnut at any tint
  value. This is not a subtlety; it is the difference between the colour being achievable
  and not.
* **The drift scales with the source's own saturation.** The wood maps, which carry the
  most hue, drift furthest (20.4 and 10.5 in sRGB 0–255 distance). The near-neutral metal
  drifts least (4.7). An asset calibrated by eye will therefore look *nearly* right on its
  metal and clearly wrong on its wood — which is exactly the failure Arm F showed.

#### Acceptance

| Check | Gate |
|---|---|
| Shipped mean albedo within **3.0** sRGB 0–255 distance of the §8 target | [T] `cc0_calibrate.py --report` reports `gapToTarget`; the solve is exact, so anything above 3.0 means a step was skipped |
| Calibrated map mean chroma **< 0.01** — it is achromatic | [T] same report, `meanChroma` after bake |
| **Predicted visible span ≥ 8 sRGB code values** | [T] `cc0_calibrate.py --emit` reports `visibleSpanCodeValues` and `textureWorthCarrying`. **This replaces the source-contrast gate**, which could not distinguish a map that will be visible from one that will not — see §7.4.2 |
| Source contrast ratio p90/p10 **≥ 1.5** | [T] retained as a source-quality screen only. A map flatter than this is not carrying surface information regardless of where it lands. It is **not sufficient**: Metal032 fails at 1.14 and would still fail the span gate on a dark target after any contrast fix |
| Clipped fraction after exposure normalisation **< 0.5 %** | [T] `--bake` reports `clippedFraction`. Wood062 measures **0.67 %** and exceeds this. Left as-is deliberately: the remedy is a per-map exposure ceiling, and the procedure's value is that it has no per-map knobs. 0.17 points of clipping on an albedo is invisible; if a future source is materially worse, lower `CEILING` globally rather than adding a knob |
| Roughness, metalness and normal maps are untouched by calibration and tagged Non-Color | [T] existing colour-space check |
| The calibrated surface reads as the same production as the reception counter run | **[V] PRODUCED** — `Designs/ProShop/Spike/bible/compare/palette-calibration-worktop.png`, arms A / F / I. **It failed, and the counter is why.** One frame proved impossible (a solid partition stands between the two rooms — `tools/qa/proshop-counter-worktop-sightline.js`), so the plate is a matched-camera pair at 1.6 yd. The counter turns out to carry **no textures at all** (0/6 materials) and its top is natural oak, not medium walnut. Full finding: `Spike/TEXTURE_VALIDATION.md` addendum Part 3 |

### 7.4.2 What decides whether a texture will be visible at all

**A map's contrast ratio does not tell you whether its grain will be seen.** The palette
value it lands on decides that too, and the two multiply.

Calibration preserves contrast ratio exactly — that is why exposure normalisation is a
constant multiply in linear space rather than a curve. But the sRGB transfer function is
steeply compressive near black, so the same ratio spans far fewer *visible* code values on a
dark target than on a light one. Measured on asset_065:

| Material | Source | Source contrast | §8 target | Visible span | Measured on-screen `detail` |
|---|---|---|---|---|---|
| Medium walnut | Wood051 | 1.95 | `#6B4A2F` | **33.1** | 3.02 — clearly legible grain |
| Dark walnut | Wood062 | 3.17 | `#3E2A1B` | **34.5** | — |
| Black powder-coat | Metal032 | 1.14 | `#1C1E1F` | **2.4** | 0.09 — **flatter than untextured** |
| Muted brass | Metal032 | 1.14 | `#A8823C` | **9.7** | — |

The last two rows are the same photograph at the same contrast and differ by 4×.

**Rule: do not texture black powder-coat.** `#1C1E1F` cannot carry a visible map from any
source. Racks, brackets, shelf standards and stands are all black powder-coat per §8, so
that is three maps per family not worth authoring, storing or paying VRAM for. Give them
roughness variation or geometry instead — both survive at that brightness, because neither
is read through the albedo's transfer curve.

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

### 8.1 The conversion — hex is sRGB, `baseColorFactor` is LINEAR

Every hex above is an **sRGB** value: what you would type into a colour picker, sample
from a screenshot, or read off this table. Almost nothing downstream wants that number
directly.

| Consumer | Wants | Convert? |
|---|---|---|
| glTF `pbrMetallicRoughness.baseColorFactor` | linear | **yes** |
| Blender Principled BSDF **Base Color** socket | linear | **yes** |
| `THREE.Color.setHex(h)` / `.set('#hex')` | sRGB, converts internally | no |
| `THREE.Color.setRGB(r, g, b)` with no colour space argument | linear | **yes** |
| An albedo *texture* tagged sRGB | sRGB | no |
| CSS, UI, swatch documents | sRGB | no |

The conversion is the IEC 61966-2-1 EOTF, applied per channel to the 0–1 byte value.
**It is not `x ** 2.2`** — the standard has a linear toe below 0.04045, and at the dark
end of this palette (dark walnut, black powder-coat, deep green shadow) the difference
is visible:

```
c_srgb  = byte / 255
c_lin   = c_srgb / 12.92                          if c_srgb <= 0.04045
        = ((c_srgb + 0.055) / 1.055) ** 2.4       otherwise
```

Use `tools/blender/palette.py` — `hex_to_linear_rgba('6B4A2F')` — rather than
reimplementing it. Do not derive these by eye.

| Name | Hex (sRGB) | Linear `baseColorFactor` R, G, B |
|---|---|---|
| Warm cream | `#E8DFC9` | 0.806952, 0.737910, 0.584078 |
| Plaster shadow | `#CFC6B0` | 0.623960, 0.564712, 0.434154 |
| Medium walnut | `#6B4A2F` | 0.147027, 0.068478, 0.028426 |
| Dark walnut | `#3E2A1B` | 0.048172, 0.023153, 0.010960 |
| Deep green | `#2F4A35` | 0.028426, 0.068478, 0.035601 |
| Deep green shadow | `#21351F` | 0.015209, 0.035601, 0.013702 |
| Sage green | `#9FB09A` | 0.346704, 0.434154, 0.323143 |
| Charcoal | `#2B2E30` | 0.024158, 0.027321, 0.029557 |
| Black powder-coat | `#1C1E1F` | 0.011612, 0.012983, 0.013702 |
| Muted brass | `#A8823C` | 0.391572, 0.223228, 0.045186 |
| Warm panel light | `#FFD8AD` | 1.000000, 0.686685, 0.417885 |
| Dead diffuser | `#C9C1B3` | 0.584078, 0.533276, 0.450786 |

**The failure this prevents.** `Spike/TEXTURE_VALIDATION.md` Arm C wrote medium walnut as
`0.420, 0.290, 0.184` — the raw bytes over 255 — into a `baseColorFactor`. That is the
*sRGB* triple. The surface shipped as `#AD9377`, a washed-out tan. The exporter, the GLB
validator and the renderer all accepted it silently; it was only caught by looking at a
screenshot. There is no automatic check for "that colour is wrong", so the conversion is
pinned instead.

[T] `tests/palette-colorspace.test.js` asserts the table above against an independent
implementation of the EOTF, asserts the round trip back to hex, and carries a negative
control that fails if the raw-bytes shortcut is reintroduced.

### 8.2 Conflict — the shipping builder palette is not this palette

`tools/blender/palette.py` exposes **two** tables. `ART_BIBLE_SRGB_HEX` is §8 above and is
the authority for this slice. `PALETTE_SRGB_HEX` is what the assets 51–100 builders have
actually shipped, and the two disagree on most entries:

| Name | §8 | Shipped builder value |
|---|---|---|
| Warm cream | `#E8DFC9` | `#E8DFC9` — agrees |
| Medium walnut | `#6B4A2F` | `#704934` |
| Deep green | `#2F4A35` | `#173F32` |
| Charcoal | `#2B2E30` | `#292C2A` (`warm_charcoal`) |
| Muted brass | `#A8823C` | `#9B7A3B` (`restrained_brass`) |

Retinting fifty already-shipped assets is a Phase 3 decision, not a texture-infrastructure
change, so both tables stand and a builder states which one it draws from. **A Tier 1
pro-shop asset draws from `ART_BIBLE_SRGB_HEX`.** [T] the palette audit in §8 rules below
samples against the §8 values.

### 8.3 Rules

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
