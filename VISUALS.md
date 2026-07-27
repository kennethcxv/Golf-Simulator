# THE VISUAL PRODUCTION PASS

The systems were finished; this pass rebuilds how they **look**. The owner dropped nine
Tripo scans into `Assets/` and a 42-image Pinehollow reference library into
`Designs/RefrenceImages/`, and this folds them onto the working clubhouse, checkout and
office logic without touching a rule. Every commit is render-only; 496 tests stay green
throughout.

> The bar was "a polished commercial simulator" (TCG Shop Sim / House Flipper tier). The
> honest state before this pass is in `ASSET_PRODUCTION_AUDIT.md`: the millwork and
> architecture were already decent, and the failure was concentrated in the **merchandise**
> and a handful of flat decals. So this pass is targeted, not a rebuild.

---

## What a Tripo scan becomes

`tools/blender/process_tripo.py` is the whole pipeline. `inspect_tripo.py` established that
Tripo ships each asset normalised to a unit cube with the pivot already at base-centre, so
the job is small and deterministic: **uniform-scale to a real-world size**, optional yaw,
optional decimate, export Y-up **with the baked PBR atlas kept**. The authoring script is
committed, so every prop is reproducible from the raw in `Assets/`.

The Steam release budget keeps that authored atlas but caps the derived runtime
copy at 1024px. `optimize_runtime_textures.py` performs the same cap across the
older course-prop exports and re-imports every candidate before replacement;
raw `Assets/` files are never overwritten.

Keeping the atlas is the load-bearing decision, and it forks the loader:

| | |
|---|---|
| **`merch.instantiate(name)`** | Remaps every material onto the shared clubhouse kit to hold the material count flat. Right for goods stocked by the dozen. |
| **`merch.instantiateRaw(name)`** | Leaves the Tripo atlas exactly as authored. A clone still shares geometry **and** the one material by reference. |

- **Hero singletons** (chairs, the card terminal, the POS kiosk) are `instantiateRaw` and
  cost one draw call and one material each.
- **Repeated products** (the shoe, cap, rangefinder) are also `instantiateRaw`, but they are
  decimated to 3-4k tris and — because every copy shares one baked-atlas material —
  `rebuildStock`'s existing per-material `bake()` collapses a whole shelf of them into a
  **single draw call**, texture intact. The kit's own trick, extended to the scans.

Measured with the shop fully stocked, after all four parts: **scene meshes 1235** (was 1289),
**unique materials 248** (was 270) — both *down*, because single atlases replaced the
per-tint procedural materials. Triangles up ~8% for the decimated detail. No draw-call
explosion. The audit's discipline held.

---

## What shipped

| Commit | What |
|--------|------|
| `074605c` | The pipeline + real chairs: green-leather club armchairs (lounge), a real executive task chair (office) |
| `5b5e1eb` | A real POS touchscreen and card terminal at the till; the live transaction canvas re-seated on the real glass |
| `f2e2aab` | Real spiked golf shoes, six-panel caps and a laser rangefinder on the shelves (baked to one draw call each) |
| `47b1d6d` | The office course map redrawn as a titled map; the lounge course photo as a painterly landscape; real trophy cups |

The checkout screens needed care: the transaction display has to ride the device's real
glass, and the Tripo screens sit at different places and tilts than the old models.
`tools/blender/measure_screens.py` finds each screen as the largest flat panel facing out
and reports its centre and normal; `attachScreen`/`attachTerm` plant the canvas there. The
whole sale still runs end to end (`register-sale.js`: scan -> refuse-unscanned -> total ->
drawer -> change -> receipt -> bag -> hand-over, revenue banked only on hand-over, zero
errors) — the transaction was never touched.

---

## Landmines

- **`instantiateRaw` keeps the atlas; `instantiate` throws it away.** Use Raw for a hero prop
  or a bakeable product; use the kit remap for anything that must stay flat on materials.
- **A repeated textured product must share ONE material**, or `bake()` cannot collapse the
  shelf and every copy is its own draw call. `clone()` shares the material by reference —
  rely on that, do not per-instance clone the material.
- **A Tripo screen faces an arbitrary axis.** The kiosk's glass faced its own +x; measure
  the face (`measure_screens.py`), do not guess a tilt. The old hardcoded offsets were
  calibrated to the retired Blender models and are wrong for the scans.
- **Orient a screen plane against WORLD-UP, not `setFromUnitVectors`.** Aligning +Z to the
  normal leaves a free roll, which tilted the register text ~10 deg off the bezel. Build the
  basis from the projected up.
- **Re-running `process_tripo.py` re-exports every prop.** Blender's GLB bytes are not
  deterministic, so `git checkout` the props you did not mean to change, or the diff fills
  with churn.

---

## What is NOT done — stated plainly

- **The gondola is processed but not placed.** `display_shelf.glb` (a walnut-and-steel
  accessories gondola, the reference's centre-floor unit) is ready, but wiring it as a
  *functional* fixture cascades into the slot table, per-SKU home-fixture assignment (which
  the delivery-to-shelf loop reads), customer pathing and build mode. That is a feature, not
  a polish, and it was left rather than rushed. Same for `headcover.glb`: there is no
  standalone headcover SKU on a fixture (the bag model ships its own covers), so it waits for
  a home.
- **The animations.** Still job #1 from the register brief. ~22 named animations were asked
  for and the actors — customers at the till, the cashier's hands, the box being set down —
  are not animated. Everything is physical and correct; nothing is *animated*.
- **Customers are still procedural primitives.** The loudest remaining placeholder, and out
  of scope here (the brief said not to touch customer AI).
- **Hanging/folded polos still read flat.** The audit's "worst asset"; they are modelled
  garments, but no Tripo apparel was supplied, so they were left. A cloth/tint pass could
  help but there is no scan to drop in.
- **Pendants, exterior grime, AO maps** — the audit's minor §11 items, left as acceptable.
- **The reference library (`Designs/RefrenceImages/`, 42 images, 80 MB) is NOT committed** —
  no reference image ever was, and 80 MB of binaries is not worth versioning. It is the art
  direction, kept local.
- **No video.** Screenshots only, under `qa/assets/v2-*/`.

---

## Running it

```bash
node --test                     # from the repo ROOT only. 496 green.
node tools/serve.cjs            # port 8457

# the assets (Blender 5.1)
BL="C:/Program Files/Blender Foundation/Blender 5.1/blender.exe"
"$BL" --background --factory-startup --python tools/blender/inspect_tripo.py    # LOOK first
"$BL" --background --factory-startup --python tools/blender/process_tripo.py    # normalise
"$BL" --background --factory-startup --python tools/blender/measure_screens.py  # screen poses
```

**Evidence** (`qa/` is gitignored): `qa/assets/v2-before` (the honest baseline) against
`v2-furniture`, `v2-checkout`, `v2-products`, `v2-art`; `qa/register/cash` and
`qa/register/roll-check` for the live till screens.
