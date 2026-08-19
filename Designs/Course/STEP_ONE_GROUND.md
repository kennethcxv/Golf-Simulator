# STEP ONE — THE GROUND

2026-08-18. Stopped here, as instructed. What follows is what the ground looks
like now, what each change was measured against, and what step two should be.

---

## Part one first: the thing that made sessions mix assets

`Assets/MANIFEST.md` — **generated**, never typed, by
`npm run assets:manifest`. Every asset the game may load, with a status derived
from the loaders in `src/` and the files on disk:

> **1,962 assets — 718 SHIPPING, 1,214 NOT WIRED, 30 SUPERSEDED.**

`npm run assets:check` is in the gate and fails two ways: if anything under
`src/` (or `main.cjs`, `index.html`, or the staging manifest) names an archived
path, and if the manifest disagrees with the tree. That second failure is the
one that matters over time — a checked-in inventory that drifts is a wrong
answer wearing the filename of the right one.

**hero/v3 and hero/v4 are in `Assets/_archive/`.** `ARCHIVED.json` records both
their new home and their **former path**, and the check fails on either. The old
spelling matters more: after the move `Assets/models/hero/v4/apparel_polo_hung.glb`
resolves to nothing, and a missing GLB in this renderer is a caught fetch and a
silent absence — the failure mode that hides.

**Watched fail before green.** A deliberate v4 reference added at
`src/render3d/clubhouse/merch.js:126` turned three tests red — the archived
reference, the stale manifest, and "a loader points at nothing" — and the tool
exited 1 naming the file and line. Restored from a file copy; all eight pass.
Evidence: `qa/asset-manifest/watchedfail.txt`.

### Two things the manifest found on its first run

- **`Assets/models/hero/` holds 63 files nothing loads**, including a
  `broom_head.glb` that is not the broom the game draws — the drawn one is
  `asset_074_broom.glb` from sheet 08. Three directories deep, same subject,
  one live.
- **`Assets/pro_shop/` is 495 files and 248 MiB with no loader at all.** The
  products in the shop are procedural proxies.

Neither is fixed here. They are now *written down*, which is the whole point.

---

## Part two: the ground

### The reference came first

`Designs/Course/Ground/` — 14 photographs from Wikimedia Commons, each credited
in its folder's `sources.json`, fetched with `tools/course/fetch_ground_ref.mjs`
(which carries the v6 lessons forward: browse categories rather than
full-text-searching, check magic bytes, never write a partial under the final
name, and a `--control` that proves the audit rejects an HTML error page, a
truncated file and an uncredited image). `--audit`: **14 images, 0 unusable.**

### What was actually wrong

Not "the surfaces have no textures". They had **real CC0 Poly Haven
photographs**, and had since July. The faults were:

1. **One image was doing seven surfaces.** `leafy_grass` — a leafy meadow —
   served fairway, semi, tee, green, fringe, rough and heavy rough, separated
   only by a tint and a UV scale.
2. **The shader threw the photograph's colour away before drawing it.**
   `FW_STYLIZE(tex, tint)` was `(0.46 + luma(tex) * 1.28) * tint`: the texture
   contributed brightness and nothing else. That is precisely "flat colour
   fields with a pattern on top", and it is why better photographs would not
   have helped.
3. **There was no roughness map.** Roughness was a per-zone constant, 0.82 to
   0.98. Moisture darkened the albedo and stopped there, so watered turf looked
   like turf in shade.
4. **The mow pattern was `col *= 1.0 + band * amp`** — one number, identical at
   the player's feet and at three hundred yards, identical whichever way they
   faced.

### What replaced them

`tools/course/turf.py` — weave.py's method, which is what finally got real maps
onto the garments: **one periodic height field per surface, with the normal, the
occlusion and the roughness derived from it and from nothing else**, so the
three cannot disagree. Four surfaces, 512 px over a one-metre tile (1.95 mm per
texel, so a 3 mm blade is resolvable):

| surface | height field | relief | used by |
|---|---|--:|---|
| `turf_close` | the **lay** of mown blades over a clumping ground, 9:1 anisotropic | 2.2 mm | fairway, semi, tee, green, fringe |
| `turf_rough` | clumps, near-isotropic — nothing has rolled uncut grass into a direction | 7.5 mm | rough, heavy, scrub, the environment ring |
| `sand` | fine grain over a wandering rake swell | 1.4 mm | bunkers |
| `hard` | broom-finished concrete with exposed aggregate | 1.7 mm | cart paths, dirt |

Packed two files per surface, not three, because the terrain shader is close to
WebGL's 16 texture units: `_alb.png` is RGB albedo + **A roughness**, `_nrm.png`
is RG normal xy + **B occlusion** + A height. Normal z is reconstructed as
`sqrt(1 - x² - y²)`, which is exact for a unit normal and is what frees blue.
Eight units for four surfaces, against the seven they replace.

**The zone tints were kept, not replaced.** Each zone's multiplier is
`target ÷ tile mean` in linear light, so a fairway's *average* lands exactly
where it was tuned in the game and the tile's departure from that average — the
part that was being discarded — is what is new. Sand and the cart path depart
deliberately: the boards show near-white sand where the tint was a warm tan, and
light grey concrete where the path zone borrowed the rough.

### The tile control caught two things, and once it was the picture

`tools/course/turf_control.py` writes a contact sheet **to be looked at**
(`qa/course/ground_tiles.png`) and reports anisotropy, seam, relief and chroma
with a stated failing condition for each.

- **The sand rendered as corrugated iron** and every number was green when it
  did. A pure cosine at 62% of the field gives every groove the same depth,
  width and phase across the whole metre. Fixed by irregularity, not amplitude:
  the phase wanders along the groove, the depth is modulated per groove, and the
  grain took the majority of the field back.
- **The first slope formula overstated relief a hundredfold** — it treated the
  tile as the cell, so a four-texel feature came out with its normal lying
  almost flat. The control read normal-xy spread 0.89 where it should be ~0.10.
  Turf would have shaded like crumpled foil.
- **The anisotropy metric was asking the wrong question.** It measured
  adjacent-texel steps, which only see the highest frequency, and reported sand
  at 1.05 — "no rake in the bunker". A bunker's *grain* genuinely is isotropic;
  the 95 mm rake swell that carries all the direction contributes almost nothing
  to an adjacent-texel difference. The metric now reports two bands and each
  surface declares which one carries its direction.

`--control` feeds it a flat tile, an isotropic tile and a tile that does not
wrap; each is named, and the real tile passes.

### Mowing, rebuilt as the thing it physically is

The bands alternate the direction the roller laid the grass. Which band looks
light depends on where you are standing — that is why they nearly vanish in the
near foreground of `mow/cambridge_stripes.jpg`, peak toward the horizon, and
**swap when you walk to the other end**.

So the band is applied twice, both times as what it is. It **tilts the lay** in
tangent space (the tile's blades already run along tangent +u, because the
sample UV is rotated into the flow field — which is also what makes the mowing
follow the mower's path around a dogleg instead of running in a fixed world
direction), and it leaves a small albedo residual scaled by how far along the
ground the eye is looking and by whether it is looking with the lay or against
it.

**Measured, in one boot, with the old mechanism as the control** — the shader
carries a QA-only `uMowViewDep` uniform, default 1, that restores the flat
multiply:

| mean \|luma\| the mowing contributes (0-255) | far | mid | **near (at your feet)** | far/near |
|---|--:|--:|--:|--:|
| **shipped** — the lay tilt + a view-scaled residual | 2.58 | 1.71 | 0.96 | **2.70** |
| **control** — the flat `col *= 1 + band * amp` it replaced | 2.33 | 2.91 | 2.74 | **0.85** |

The control is not an argument from the source: `uMowViewDep` was set to 0 in
the same boot, four frames were shot (mow off / mow on, both mechanisms), and
the difference images were measured. The old mechanism came out **slightly
stronger at the player's feet than toward the horizon** — 0.85 — which is
"painted on" stated as a number. The shipped one is 2.70.

The absolute magnitudes are small because the starter course is neglected:
`fade` bottoms out at 0.4 while the grass is overgrown, so this is the mow
pattern at its *weakest*. `qa/ground_r4/09_mow_on.png` against
`09_mow_off.png` is the pair; `qa/ground_r2/04_fairway_turned.png` is the same
fairway with the player turned round, where the bands read most clearly.

### Wet versus dry

Roughness is a map now, and moisture drives it: `mix(rough, rough * 0.52, wet)`.
Over the near and mid fairway, soaking the turf (`state.turf.moisture` 0 → 100)
moved the **mean** luma by **0.23 of 255** while the **mean absolute** change was
**13.0 of 255**. A redistribution, not a tint — which is what a roughness change
does and what the old albedo-only darkening could not have produced.

### Judged where the brief said to judge it

`tools/qa/ground-eye-height.js` walks the player onto the course with
`scene3d.walk.enter`, aims down the playing line of hole 1, and shoots at the
default player camera. Eight stands plus the mow A/B. It refuses to continue if
the clock pin did not take or the soak did not land — both of which happened on
the first run and would have been reported as findings.

Frames: `qa/ground_r4/` (and `qa/ground_r2/`, `qa/ground_r3/` for the earlier
rounds). Every one was looked at.

---

## What the ground looks like now

- **Fairway at eye height** reads as turf: a fine directional lay, low-amplitude
  tonal drift, and the near-to-far gradient a real photograph has. It is no
  longer one flat green with a pattern painted on it.
- **The rough is a different surface**, not a darker fairway — clumped, four
  times the relief, near-isotropic, with real shadow between the tufts.
- **The bunker is the biggest single win.** Pale, barely saturated, with soft
  irregular rake undulation. It matches `bunker/atalaya.jpg` closely.
- **The cart path is concrete with aggregate** and a normal map, where it was a
  canvas speckle with neither.
- **Looking at your feet, there is blade structure and no banding**; looking down
  the hole, the bands are there; turning round changes them.

### What is honestly still short

- **The mow bands are faint on the starter course**, by design: `fade` bottoms
  out at 0.4 while the grass is overgrown, so a neglected course shows a ghost
  of a pattern and a maintained one shows it at full strength. Nobody has yet
  seen it at full strength, because nothing in this session mowed the course.
- **The frames are at the harness window, not through `ownerResolution`** —
  `app.evaluate` is not available in this Electron shim, so the driver said so
  rather than grading small frames silently. They came out at 3840×2055 anyway.
- **Wear is not placement-driven.** The `wear` channel exists and is read, but
  it comes from the simulation, so there is no worn ground beside a tee or
  around a green's walk-off until the sim puts it there.
- **The bunker lip is a darkening ramp**, where the reference shows a band of
  dead brown grass and exposed soil.
- **The green is the same tile as the fairway** at the same scale, differing by
  tint and roughness. A putting surface is cut at 3 mm against a fairway's 12 mm
  and should have its own, finer, tile.

---

## Step two should be WEAR

Not more surfaces — the six the brief named are done. The thing that most
separates these frames from the reference boards is that the game's ground is
**uniformly maintained**. Real turf records where people and machines go:

1. **Traffic wear as placement, not simulation.** A worn, compacted, part-bare
   apron beside every tee, a walk-off scar at each green, and a scuffed margin
   where carts leave the path. It is a mask authored from the course vector
   (tee polygon, green polygon, path centreline) rather than something the turf
   sim has to grow into, and it is the same shape of change as the mow flow
   field — a per-cell field the shader already knows how to read.
2. **A bunker lip band**: dead brown grass and exposed soil at the rolled edge,
   off the bunker's own signed distance, which is already in the shader.
3. **A green-specific tile** at 3 mm cut.

Reference for (1) is thin on the current board — `fairway/hole_and_path.jpg`
shows it beside the path and nothing shows it close. Step two should start by
fetching that, the same way this started.

**Not started. Awaiting the word.**

---

## The gate

`npm run gate` — lint ratchet **323** (frozen baseline, unchanged), asset
manifest ok, vendor models 139/139, suite **3,783 / 3,783**, and all **13 golden
poses ok** with no rebaseline. The goldens are all indoor — shop floor,
stockroom, the ten held tools — so the ground change does not touch them, which
is worth stating plainly rather than letting "goldens pass" imply the ground was
checked by them. **It was not.** The ground's evidence is the eight in-game
stands and the mow A/B above.

One gate run had to be repeated: a `golden:capture` orphaned by an earlier
timeout kept the Electron QA repo lock (owner pid 47764, its Electron child
51600). Both were killed and the lock directory removed.
