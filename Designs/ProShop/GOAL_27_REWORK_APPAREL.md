# GOAL 27 REWORK, ITEM 1 — THE APPAREL

Eight meshes, two materials, one twelve-cell atlas. Reference photographs first,
beside the result each round.

Build: `blender --factory-startup -b --python tools/blender/hero/build_apparel.py -- cycles`
Atlas: `node tools/blender/hero/make_apparel_art.mjs`
Comparisons: `node tools/blender/hero/apparel_vs_ref.mjs`

---

## THE REFERENCE, AND WHAT IT ACTUALLY SHOWS

Downloaded to `ref/apparel/` and looked at, not cited:

| file | what it settled |
|---|---|
| `polo-folded-stack.jpg` | A retail fold is a STACK OF LEAVES. The front edge is a row of soft lips that do not line up, and that row is what reads as cloth at thumbnail size. The collar lies FLAT, splayed in a wide V with its points resting on the shirt. |
| `polo-flat.jpg` | Collar stand and points, placket width against body width, ribbed cuff, side vent. |
| `polo-hung-rack.jpg` | Folded polos by colourway: the edges of a stack are irregular, never concentric. |
| `tee-folded.jpg` | No collar, so the read is the print and the layered front lips. |
| `hoodie-hung.jpg` | The hood is a fat soft roll standing above the shoulders; drawcords on the chest; the pocket is a band with a shadow at its top edge. Also a hung tee: shoulders peak over the hanger, sleeves fall close to the body. |
| `trousers-stack.jpg` | The fold end is a FAT CYLINDRICAL ROLL. That is the whole read; the waistband and welt pocket are secondary. |
| `cap.jpg` | Six panels with seams, apex button, eyelets, a stiff brim with a stitched border. |

---

## WHAT WAS BUILT

`cloth_lib.py` — the vocabulary the old build did not have:

- `folded()` — a stack of leaves as ONE watertight loft, with the leaf lips
  biased to the front and sides, a wandering offset per leaf, a real interior
  cap on the top face, and a sag plus creases displaced onto it.
- `collar_flat()` — the collar as it lies on a folded shirt: splayed, points
  spread, a fold that stands proud and settles at the tips.
- `collar()` — the standing version for hung garments: one band round the neck
  with a V left open at the front, its two ends being the points.
- `draped()` — a hung garment as a closed lens-section surface that peaks at the
  shoulders, hollows at the neck and falls with a soft wobble.
- `strip()`, `fold_line()`, `sleeve()`, `hanger()`, and three MEASUREMENT
  helpers — `edge_x`, `surface_y`, `top_z` — because parts placed on these
  surfaces by arithmetic landed inside them four times.

---

## WHAT THE ASSERTIONS CAUGHT, ON MY OWN WORK

This is the part worth reading. Every one of these was caught by the rebuilt
checks on a first attempt, and every one would have shipped under the old ones:

| what failed | measured |
|---|---|
| collar buried in the folded polo | 8.14 mm inside the body |
| placket buried | 14.80 mm inside |
| size tag buried | 19.93 mm inside |
| size tag, re-guessed, floating | clear of the shirt entirely |
| hanger in two pieces | `[128, 128]` shells |
| hanger after a boolean union | a 6 mm fragment; the solver would not weld two swept tubes at a sharp apex |
| collar on the hung polo | loose: above the shirt and out the back of it |
| button on the hung polo | 20.69 mm inside the chest |
| collar band | not a closed surface, so the placket measured 47 mm "inside" it |
| hoodie drawcord | loose, 3.74 mm above the fold |
| cap crown | not a closed surface — a zero-radius pole ring |
| collar vs sleeve ridge | 8.69 mm through each other |

Three instrument improvements came out of it:

1. `assert_assembly` now **refuses to measure parts that are not closed
   surfaces**. Parity is undefined for an open strip and it answers confidently
   and wrongly — that is where the phantom 47 mm came from.
2. A loose part now reports **how far**: "nearest is body at 3.74 mm" instead of
   "touches nothing".
3. `surface_y` and `top_z` **raise instead of returning a default**. A silent
   0.0 from a probe that found nothing put a button 20.69 mm inside a shirt.

---

## COST

| asset | triangles | parts | materials |
|---|---|---|---|
| polo-folded | 5,922 | 7 | 2 shared |
| polo-hung | 2,376 | 8 | 2 shared |
| tee-folded | 4,846 | 3 | 2 shared |
| tee-hung | 2,044 | 5 | 2 shared |
| hoodie-folded | 4,782 | 3 | 2 shared |
| hoodie-hung | 2,324 | 8 | 2 shared |
| trousers-folded | 5,026 | 6 | 2 shared |
| cap | 1,476 | 10 | 2 shared |

**NEW MATERIALS FOR THE WHOLE FAMILY: 2** — one cloth, one trim, both reading
the same twelve-cell atlas. A new colourway costs a UV offset and nothing else.
The folded meshes are the expensive ones because the leaf lips and the interior
top cap are geometry; they can drop to about 2,500 by halving the ring count if
the shelf ever holds twelve of them.

---

## MY OWN VERDICT, ITEM BY ITEM

Reviewed against the reference strips in each garment's folder. I am not going
to tell you these are finished, because they are not.

| asset | verdict | the first thing that gives it away |
|---|---|---|
| polo-folded | ITERATE (closest) | Reads as a folded polo now — splayed collar, placket, two buttons, three leaf lips. The collar V is still narrower than the reference and the collar rib wants its own colour break. |
| hoodie-hung | ITERATE | Recognisably a hoodie on a hanger. The hood is a fat ring rather than a hood with an opening, and the hanger's hook shows THROUGH that opening as a white shape. |
| cap | ITERATE | Reads as a cap in silhouette. The brim is too short and too wide, the six panel seams do not survive the render, and the eyelets and adjuster are invisible. |
| tee-hung | ITERATE | Reads as a shirt. Sleeves are tapered cylinders with visible ends rather than sleeves that grow out of a shoulder. |
| polo-hung | ITERATE | Same sleeve fault, and the collar sits too low and too tight to the neck to read from the front. |
| trousers-folded | ITERATE | The fat fold roll reads. The waistband, belt loops and welt pocket are all too shallow to survive lighting — they vanish. |
| tee-folded | ITERATE | A soft slab with a faint neck arc. Without the collar a polo has, there is not enough on it to say "t-shirt" rather than "folded cloth". |
| hoodie-folded | WEAKEST | Does not read as a hoodie at all. The hood folded on top is a plain roll and there is nothing else to identify it. |

**What I think the next round is, in order of return:**

1. **Sleeves that grow out of the shoulder** rather than cylinders pushed into
   it — one change fixes three garments.
2. **Deeper trim relief.** Waistband, belt loops, pocket and cap seams are all
   modelled but all too shallow to survive lighting. They need 2-3x the relief.
3. **A hood with an opening** instead of a ring, which also stops the hanger
   hook showing through it.
4. **Print and trim cells in the atlas** — a chest print on the tee and a
   contrast collar rib on the polo would do more for identification than any
   further geometry.

The fabric atlas was the single biggest improvement: untextured, every one of
these read as moulded plastic regardless of shape.
