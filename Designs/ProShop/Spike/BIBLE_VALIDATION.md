# Art Bible Validation Spike — one asset, four arms

Branch `spike/bible-validation`, off `13cdb37`. **Throwaway. Do not merge.**

`ART_BIBLE.md` §1 claims the room's problem is *bevel language, material assignment and
floor contact, not geometric fidelity*. That claim now governs Phases 4 and 5. This tested
it on one object.

**Result up front: the diagnosis does not hold.** The control already satisfied all three.
The discriminator between the best and worst assets in this room is something the bible
never requires: **texture**.

---

## Subject

**`asset_065_stockroom_worktable`** — a modeled GLB with its own Blender builder, standing
on the floor so contact is testable, and part of hero asset #8 (cleaning-tool station), so
the result generalises to the hero list.

**Changed from the bible's stated worst anchor, deliberately.** The floor debris is a
`DodecahedronGeometry(0.045, 0)` instanced primitive — 4 cm across, generated in code, no
GLB, no UVs, no separable parts. A bevel arm and a material-assignment arm are meaningless
on it, and nothing learned from it would transfer to a 3-yard counter.

---

## Method

Lighting-spike protocol: fixed seed 20260727, 1600 × 900, FOV 66 asserted against the walk
lens on every frame, clock pinned 13:00, customers hidden, doors closed, toasts suppressed.
Three fixed angles — three-quarter, front elevation, floor-contact close-up — plus crops via
`bible_crops.py`. Harness: `tools/qa/spike-bible-arm.js`.

Each arm rebuilds the GLB through the real pipeline
(`blender --background --python tools/blender/build_assets_61_70.py -- --asset 65`), which
exports canonical *and* runtime copies and validates. Verified deterministic first: a no-op
rebuild reproduced sha256 `212b820e…` byte-identically.

**Only asset 065 was touched.** The Arm C materials are asset-065-local; the shared palette
in `assets_51_100_lib.py` that all of 61–100 draw from was deliberately not edited.

---

## What the control already had

Measured before any change was made — and this is most of the answer:

| Bible claim | Control state |
|---|---|
| Floor contact | **Already correct.** `baseY` above floor `0.0000`; GLB bounds minimum z `0.0`; legs meet the boards with clean AO and no hover or sink |
| Bevel language | **Already present, and larger than the bible asks.** Worktop 24 mm/3 seg, dark edge 10 mm, legs 10 mm, aprons 8 mm, shelf 14 mm, caps 4 mm — against the bible's 3 mm furniture spec |
| Material assignment | **Already palette-aligned.** `MAT_S08_LabelCream` is `#e8dfc9`, the exact warm-cream hex the bible lists — because I derived the bible's palette from these assets |
| Texture | **Zero images, zero textures.** All five materials are flat `baseColorFactor` + roughness |

The asset reads as a primitive *while already satisfying bevel, palette and contact*. That
alone falsifies the premise before a single arm ran.

---

## Arm-by-arm

### Arm B — bevels only

Bible §5 furniture spec applied: worktop 24 → 3 mm (3 → 2 segments), dark edge 10 → 3, legs
10 → 3, aprons 8 → 3, shelf 14 → 3, brass caps 4 → 1.5 (detail class). No remodelling, no
material or transform change. GLB 70,512 → 67,964 bytes; subtree 8,164 → 8,004 tris.

**Small genuine improvement, and one important side effect.**

`compare/worktop-edge.png`: the control's 24 mm chamfer reads soft and slightly plastic; the
bible's 3 mm gives a crisp arris that reads more like a timber worktop. Note the *direction*
— the bible's spec **reduced** the shipped bevel. "The room lacks bevel language" is not
true of this asset; if anything it was over-bevelled.

**The side effect matters more than the improvement.** `compare/leg-floor-contact.png`:
shrinking the worktop bevel **exposed a hidden modelling defect**. The brass corner caps sat
centred at z 0.914 with 0.012 thickness, putting their top face at 0.920 — exactly coplanar
with the worktop top (0.8775 + 0.085/2) and their bodies buried in the slab. The oversized
bevel had been *hiding* that. In Arm B it appears as a bright brass square sunk into the
corner.

That is a real lesson: **an oversized bevel can conceal a geometry error**, and tightening
bevels to spec is a defect-finding pass as much as an art pass.

### Arm C — plus material assignment and roughness

Asset-065-local materials per bible §7.2 and §8:

| | shipped | bible |
|---|---|---|
| medium walnut | `704934`, rough 0.49 | `6B4A2F`, rough 0.62 |
| natural oak | `B98A59`, rough 0.54 | `B98A59`, rough 0.68 |
| warm charcoal | `292C2A`, rough 0.56 | `2B2E30`, rough 0.60 |
| brass | `9B7A3B`, 0.32 / **0.88** | `A8823C`, 0.42 / **1.00** |

**One error caught rather than shipped.** The first attempt passed hex/255 straight into the
material helper, but glTF `baseColorFactor` is **linear** — `6B4A2F` came back as `#ad9377`,
washed out. Routed through the library's `hex_to_linear_rgba` and re-verified the live values
match the bible exactly. Had I not checked the runtime values against the spec, this arm
would have reported a material change that was really a colour-space bug.

**Result: marginal.** `compare/whole-table.png` — the lower shelf reads less orange, the
worktop is fractionally warmer. The object still reads as flat coloured boxes. Correcting
roughness by 0.1 and hex by a few percent on an untextured surface changes very little,
because there is no surface detail for the roughness to modulate.

### Arm D — plus contact correction

**There was nothing to correct about floor contact.** `baseY` stayed `0.0000` in every arm.
Pivot at origin, base flat, no hover, no sink, no intersection with the floor.

So Arm D addressed the intersection Arm B exposed: the corner caps were re-seated on the
surface at z 0.926 instead of buried at 0.914.

**This produced the single clearest visible improvement in the whole spike** —
`compare/leg-floor-contact.png`, panel D: the cap now reads as a proud brass corner
protector with its own shadow, rather than a hole in the slab. And it is worth being precise
about what that means: it is *one small detail*, and it was only needed because Arm B
uncovered it. It did not change how the object reads.

---

## 1. Does the bible's diagnosis hold? Which arm moved it most?

**No. Not for this asset, and the survey below says not for most of the room either.**

At object scale (`compare/whole-table.png`) all four arms read the same: a flat tan slab on
black posts. Ranked by what actually moved:

1. **Arm D** — the only clearly visible improvement, and confined to one 12 cm detail.
2. **Arm B** — a real edge-quality improvement, plus a defect-finding side effect worth more
   than the improvement.
3. **Arm C** — marginal.
4. None of them changed whether the object reads as furniture.

### What the discriminator actually is

I surveyed every GLB family in the room for embedded images:

| family | files | with **zero** images | images total |
|---|---|---|---|
| checkout kit | 49 | **1 (2 %)** | 145 |
| sheet_06 architecture (51-60) | 10 | **0 (0 %)** | 21 |
| sheet_07 fixtures (61-70) | 10 | **10 (100 %)** | 0 |
| sheet_08 tools (71-80) | 10 | **10 (100 %)** | 0 |
| clubhouse / merch | 152 | **129 (85 %)** | 58 |

This explains the bible's own anchors. I picked the reception counter as "best in room" and
floor debris as "worst" — and the counter area is served by the **checkout kit, the one
family that is 98 % textured**, while the worktable is sheet_07, which is 100 % untextured.

**The bible attributed to bevel, palette and contact a difference that is actually texture
presence.** Bevels and palette were already right in both. The best assets have surfaces;
the worst have flat colour fields.

### What that means for the bible

Three corrections it needs before Phase 4 relies on it:

* **§1's diagnosis is wrong** and should be replaced: the discriminator is texture, not
  bevel/material-assignment/contact.
* **§5's bevel table is wrong in direction.** Shipped furniture is bevelled at 8–24 mm and
  the 3 mm spec tightens it. 3 mm reads better here, so keep the value — but stop describing
  the room as lacking bevels, and add that tightening a bevel can expose geometry the old
  one was hiding.
* **§7 never requires a prop to be textured at all.** It specifies texel density and
  resolution ceilings, which presuppose textures that 100 % of sheet_07 and sheet_08 do not
  have. That is the gap that made the whole diagnosis wrong.

Also worth flagging: §7.2's "metalness is binary" is violated by the shipped best-in-class
assets (brass at 0.88, brushed steel at 0.82). Arm C set it to 1.0 with no visible harm, so
the rule is probably fine — but it was written without checking, and it should be verified
against the checkout kit before it gates anything.

---

## 2. Hours per arm

Two numbers, because they differ by an order of magnitude and only one of them is useful for
estimating Phase 5.

| Arm | Elapsed here | Realistic hand-authored equivalent |
|---|---|---|
| Setup, subject selection, pipeline verification, Arm A control | ~6 min | 2–3 h |
| Arm B — bevels | ~2 min | 1–2 h |
| Arm C — materials | ~2.5 min (incl. one redo for the colour-space bug) | 1–2 h |
| Arm D — contact / intersection | ~3.5 min | 1–2 h |
| **Total** | **~15 min execution** | **5–9 h** |

**The elapsed figures are not transferable and should not be used to plan Phase 5.** They are
that low for three specific reasons: this asset is generated by a committed Python builder, so
every arm was a small scripted diff rather than mesh surgery; the capture harness already
existed from the lighting spike; and the rebuild is one deterministic command.

**Use the right-hand column, with two adjustments.** Any asset without a scripted builder
needs Blender work by hand, so add time. And **none of these arms includes texturing**, which
is the change that actually matters — budget that separately at roughly **3–6 h per asset**
for UV work plus authored albedo/normal/roughness, more for anything needing readable
signage or branding.

---

## 3. Which of the eight hero assets need a rebuild versus an edit pass?

Classified against measured texture presence and mesh structure. "1 mesh" means the GLB is a
single merged blob with no separable parts — nothing to texture or detail without re-authoring.

| # | Hero asset | Measured | Verdict |
|---|---|---|---|
| 1 | **Checkout counter** | shell `asset_061`: 0 images, 6 mats, 13 meshes · kit `checkout_counter`: 4 images | **Edit pass + texture.** Good part hierarchy, already the best-reading object in the room. Texture the sheet_07 shell to match the kit it sits beside. |
| 2 | **Cash-register assembly** | monitor 4 img · drawer 5 img · terminal 3 img/50 meshes | **Edit pass only.** Already textured and finely parted. The lightest of the eight. |
| 3 | **Laptop workstation** | desk `asset_066`: 0 images, 5 mats, 11 meshes; laptop itself is procedural on canvas materials | **Edit pass + texture** on the desk. The laptop needs nothing — it already uses the textured procedural kit. |
| 4 | **Main wall shelving** | `asset_064`: 0 images, 3 mats, 10 meshes | **Edit pass + texture.** Parted well enough to texture; 3 materials is thin for a hero and will need splitting. |
| 5 | **Freestanding merchandise fixture** | `feature_table`: 0 images, 3 mats, **1 mesh** | **REBUILD.** One merged mesh with no separable parts. Nothing to bevel, texture or detail without re-authoring. |
| 6 | **Clothing / hat display** | `apparel_wall`: 0 images, 4 mats, **1 mesh** (`apparel_table` missing from the runtime tree entirely) | **REBUILD.** Same single-blob problem, plus a missing file to resolve. |
| 7 | **Golf bag / club display** | `bag_rack`: **3 images**, 7 mats, 3 meshes · `club_wall_bay`: 0 images, 5 mats, **1 mesh** | **Split verdict.** Bag rack = edit pass, it is already textured. Club wall bay = **REBUILD**, single mesh. |
| 8 | **Cleaning-tool station** | worktable `asset_065`: 0 images, 5 mats, 10 meshes · broom `asset_074`: 0 images, 4 mats, 7 meshes | **Edit pass + texture.** This spike's subject. Structure is sound — bevels, parts, sockets, contact all correct. It needs a surface. |

**Summary: 3 genuine rebuilds** (freestanding merchandise fixture, clothing/hat display,
club wall bay — all single-mesh blobs), **1 edit pass only** (register assembly),
**4 edit-pass-plus-texture** (checkout counter, laptop desk, wall shelving, cleaning station),
with the bag rack already in good shape.

The rebuild/edit line falls almost exactly on **mesh count**, not on bevels or materials.
Assets with 7–50 separable meshes can be rescued; assets that are one merged mesh cannot.

---

## Recommendation

Phase 4 (materials and lighting, now scheduled first) should add a **texture pass** as an
explicit workstream covering sheet_07 and sheet_08 — 20 files, currently 100 % untextured —
before any hero asset is judged. Texturing those is likely to move the room more than all
eight hero assets would under the bible as currently written.

And the bible needs the three corrections in §1 above before it gates anything.
