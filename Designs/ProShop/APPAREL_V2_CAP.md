# APPAREL V2 — THE CAP

Build: `blender --factory-startup -b --python tools/blender/hero/build_cap.py -- cycles views=12 way=cream`
Control: `blender --factory-startup -b --python tools/blender/hero/control_assertions.py`
Frames: `qa/hero/apparel_v2/cap/cream/` and `.../navy/`

---

## WHY V1 COULD NOT BE TUNED INTO THIS

v1's crown was **one lofted dome** with six tubes swept over it, a spatula for a
bill and a decal card for the badge. The brief's diagnosis was right and it is
structural, not cosmetic: soften a dome and you still have a dome. So no line of
v1's cap survives. `build_cap.py` is a new file.

Three specific things v1 had backwards, all visible in the four reference views
and in none of the seven photographs v1 was built from:

| v1 | the reference |
|---|---|
| base circle scaled 0.965 in **y** | the base oval's LONG axis is front-to-back — a head is longer than it is wide, and v1 had it the wrong way round. Half of why it read as a melon. |
| widest at the base, tapering like a swim cap | widest about **two-fifths up**. A blocked crown flares over the head and tucks back in at the sweatband. |
| the back is closed | **the back is not closed.** Two panels are cut away in a wide U, you look into the hat, and a strap crosses the bottom. Three of eight turntable frames are of that. |

## THE REFERENCE

`ref/apparel/cap-bfp-front | -left | -rear | -right` — one cap, four square-on
views, downloaded for this pass. That matched set is what v1 never had, and it
is what made the crown profile arguable rather than guessed. Plus
`cap-detail.jpg` (the seams and the bill's stitch rows from above),
`cap-variety.jpg` (the bill's double curvature) and `cap.jpg`.

The render set is deliberately the same four views, so the comparison lines up.

## HOW IT IS BUILT

**Six panel objects**, each its own solidified surface over 60 degrees, each
dished toward its middle and **tucked in at both seams** — that tuck is the
difference between a seam and a stripe. Six **seam ridges** sit in the grooves
the tucks leave: 2.4 mm from the floor of the groove to the top of the ridge.

The panels **stop short of the apex** and leave a 17 mm hole, which is what the
**covered button** is for — a cap does not come to a point.

The two back panels have their bottom edge lifted into the **U**, the cut edge
is bound with its own tape in the contrast colour, and a **snapback** bridges
it: a pegged tail, a tail with six holes cut through it by boolean difference,
and two pegs engaged.

The **bill** is a solidified surface with both of its curvatures driven by the
distance actually travelled forward, a rolled binding on its free edge, three
concentric stitch rows following that edge, a charcoal **underside** on its own
atlas cell, and a topstitched **bill seam** where it enters the crown.

The **crest** is a shaped patch sampled off the crown's own surface function,
lifted 1.4 mm, given thickness and bordered with a satin edge — an applied
badge, not a card leaning on the front.

## COST

| | |
|---|---|
| triangles | **11,874** |
| parts | 44 |
| materials | **2** — the shared ApparelCloth and ApparelTrim, unchanged |
| atlas cells | 6 of the shared sheet — crown, bill, trim, crest, underbrim, sweatband. A colourway still costs no program. |
| size | 168 x 269 x 142 mm |

946 part pairs checked: nothing interpenetrates past the 6 mm a seated part may
sink except where declared, nothing is loose, every part is one closed piece.
`node tools/validate-gltf.mjs Assets/models/hero/apparel_cap_cream.glb` — 0
errors, 0 warnings.

## THE INSTRUMENTS FAILED FIRST. AGAIN. FOUR TIMES.

Each was found by measuring rather than by reasoning, and each now has a control
in `control_assertions.py` that has been watched failing.

**1. `point_inside` grazed along coplanar faces.** Two adjacent cap panels were
reported as interpenetrating **by 85.53 mm**. 85 mm is the crown's own radius,
which is the tell — a point 85 mm from the nearest surface of a 2.6 mm shell
cannot be inside it. The query point sat at z = +0.00, exactly in the plane of
the neighbour's bottom rim, so the single **+x** ray the library had always cast
ran *along* those faces and counted one crossing. Every other direction said
outside.

That is not a rare accident here: nearly everything in the project is modelled
with a flat bottom at z = 0. Parity now votes across three mutually
incommensurate, non-axis-aligned directions. PART 5 of the control reproduces
the old reading (+83.52 mm with one +x ray) beside the new one (−0.00 mm).

**2. A boolean leaves an empty material slot, and every polygon points at it.**
The punched snapback tail came out with slots `[None]` and `material_index 0`
everywhere, so `data.materials.append(trim)` landed in slot 1, which nothing
used, and the strap rendered in Blender's default white — with UVs a probe
confirmed were exactly right. `apply_mods` now drops slots when every slot is
empty. PART 6 of the control shows the raw `convert()` result (1 empty slot)
beside the cleaned one (0).

**3. The camera named "underbrim" was not photographing the underbrim.**
Orbiting the subject centre at −14 degrees put it level with the bill's tip, so
the frame showed the crown's interior through the base opening and the bill's
underside never appeared. I nearly rebuilt the two-cell UV split over it. The
split measured 50.1% / 49.9% by area with mean face normals of +0.735 and
−0.738 — the geometry had been right the whole time. The camera now aims at the
bill, and `brimonly-above/below.png` shows the bill alone from each side.

**4. Every square-on view was framed off the bounding SPHERE.** `fit_distance`
sizes the shot from the subject's radius, which for a cap 269 mm long and
142 mm tall is nearly two and a half times the height of its front silhouette —
so the cap sat in about a third of the frame, and beside a reference photograph
that fills its tile, faults at 40 pixels stayed at 40 pixels. `hero_lib.fit_view`
now measures the subject's real half-extents along the camera's own right and up
axes. The front view went from a third of the frame to nearly all of it, and the
crest's inner keyline and the bill's binding only became arguable at that size.

## THE ROUNDS, AND WHAT EACH FRAME SAID

Reviewed at full size, frame by frame, never off the contact sheet.

| round | what the frames said | what changed |
|---|---|---|
| 1 | `threequarter`: PINE HILLS printed **mirrored**. `side`: the bill's side edge is a **vertical cliff** — a 19 mm drop across 13 mm of bill. `underbrim`: the corner is a hard triangular flap. | the bill's curvatures move from v-space to distance-travelled; `flip_u=False` |
| 2 | `side`: the bill/crown junction reads as a **slot cut in the fabric**. The snapback reads as a **black bracket** clipped to the hat. The stitch-row ends spray into needles. `threequarter`: the crown reads as **quilting** — the knit's diamonds were ~3 mm on a cap panel. | bill seam added; strap moved to the trim colour and shortened; rows start at v=0.30; knit frequency doubled and amplitude eased |
| 3 | `side`: a **green racing stripe** along the bottom of a cream hat — one contrast hem ring run the whole way round. The crown's bottom edge is a hard white line: solidify's rim band facing outward. | hem split into self-coloured hem + contrast arch tape; the panel hem now rolls under |
| 4 | `side`: the strap's ends still break the silhouette. The crown reads slightly moulded — one unbroken specular sweep per panel. | strap ends dive inward and finish inside the panel; 0.33 mm of cloth slack wanders across each panel |
| 5 | `crown-detail`: the ring round the button is a **green wire hoop in six pieces** — 2.2 x 1.2 mm is far too fat to be thread, and each seam ridge cut it. The reference has no ring at all. | ring deleted; button smaller and flatter; seams run right up to it |
| 6 | `front` and `rear`, reframed: the snapback's pegs are faceted **hexagonal nuts** and the punched holes are decagons. Neither is a fault at a third of frame; both are obvious at full frame, which is the argument for fixing the framing before finishing the model. | pegs become smooth domes on a shank; hole cutters 16-sided; tail ends dive 4.2 mm inward |
| 7 | `back-detail` at macro: the punched tail carries a row of **diamond-shaped highlights** down its face. The boolean re-triangulates the strap and a fully smooth normal across those new triangles is what a flat moulded band must not have. | the two tails shade by angle at 30 degrees; the hole rims come out sharp, which they should be |

## WHAT IS STILL NOT RIGHT

Honest list, so it is on the record rather than found later.

- **Two eyelets per panel is what the brief asked for; all four reference caps
  have one.** Twelve reads as a vented performance cap, which is defensible for
  golf, but it is not what the photographs show. `EYELETS_PER_PANEL = 1` is a
  one-line change if you want it.
- **Every extra colourway costs an atlas cell**, because the weave is painted
  into each cell rather than tinted. Five ways are wired; more means a bigger
  sheet. The alternative is a per-colour `baseColorFactor`, which costs a
  material each, which the brief forbids.
- **The inside is unfinished.** `inside.png` looks straight up into the crown:
  the six panels meet at hairline gaps because there is no lining behind them,
  and three snapback pegs just break the inner wall. Neither is reachable from
  any camera a player has — the cap hangs on a rail — but it is on the record.
- **The bill's weave washes out at macro range.** One 256 px atlas cell spread
  over a 170 mm bill is about 1.5 px per mm, so the top surface reads as flat
  colour in `brim-detail`. It is fine at any distance a player stands at, and
  the fix is a bigger cell rather than a second material.
- **11,874 triangles** is the most expensive item in the hero set after the
  hand. If it is going on a wall rail in quantity, the panels are the place to
  cut (nu 11 → 9 and nv 13 → 11 saves about 900).

## EVIDENCE

- `qa/hero/apparel_v2/cap/cream/` — 12-view turntable, front / side / rear /
  three-quarter / top, silhouette, underbrim, inside, and three close-ups
- `qa/hero/apparel_v2/cap/navy/` — the second colourway, same geometry
- `qa/hero/apparel_v2/cap/cap-vs-ref-cream.png` — the render beside the
  reference, front over front and rear over rear
- `qa/hero/apparel_v2/cap/brimonly-above.png` / `-below.png` — the bill alone,
  which is how the two-cell underside was settled
- `qa/hero/apparel_v2/cap/v1-vs-v2.png` — what changed
- `Assets/models/hero/apparel_cap_cream.glb`, `apparel_cap_navy.glb`
