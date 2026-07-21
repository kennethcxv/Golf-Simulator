# Character Release-Polish Report

## Outcome

`C-003` is resolved. The box-and-sphere customer was replaced by an original,
Blender-authored modular character kit while preserving the existing articulated
walk, idle, browse, swing, checkout, and carry rig. The result reads as a stylised
person from the player camera, survives the complete checkout flow, and stays
within the measured crowd budget.

## Asset and integration

- Editable source: `tools/blender/build_character.py`.
- Runtime export: `vendor/models/clubhouse/character_parts.glb`.
- Source/license: original project-authored geometry; no external asset or texture.
- Scale: 2.00 game units at scale 1 (about 1.83 m); customers vary from 0.87 to
  0.99 scale. The final sampled checkout figure was 1.766 units tall at 0.8847
  scale with 0.003 units of ground clearance.
- Geometry: 10 shared visible geometries, 15 articulated mesh instances, and
  4,764 triangles for the sampled capped figure.
- Materials: named stylised-PBR source slots; runtime colours use the existing
  muted golf wardrobe palette and a finite shared-material cache.
- UVs/transforms: every authored part is smart-unwrapped with padding; rotation
  and scale are applied before GLB export.
- Hierarchy/pivots: named chest, head, shoulder, elbow, hip, knee, hand, and carry
  pivots are reported in `final-inspection/result.json`. The full transaction
  exercises the checkout arm and gravity-upright carrier anchor.
- Collision: the GLB contains a separately named simple customer proxy for asset
  inspection. Runtime movement deliberately retains the existing circular
  navigation/collision envelope, so art cannot alter pathing or save state.
- Loading/lifecycle: the GLB loads through the shared loading manager before
  prewarm completes. Geometry and palette materials are shared for the app session;
  per-character fallback resources remain owned and idempotently disposable.

## Visual iterations

### Iteration 1 — replace the placeholder silhouette

Baseline: `../iteration-4-hardening/card-1280-final-3/01-customer-at-counter.png`.
After: `iteration-1/01-customer-at-counter.png` and the retained full card video.

Visible defects catalogued: rectangular torso at screen left; detached box sleeves;
hard elbow corners; untapered forearms; no visible hand geometry; featureless sphere
head; no eyes/brows/mouth; cylinder-and-slab cap; rectangular thighs/calves; and
shoebox feet. The first Blender pass introduced tapered lofts, rounded anatomy,
hands, facial geometry, a cap/hair branch, shaped trousers, and rounded shoes while
keeping every original joint.

### Iteration 2 — correct authored facing and review all sides

Evidence: `iteration-2-final/01-staff-counter.png` through
`04-register-checkout-pose.png`, result JSON, and video.

Visible defects catalogued: face aimed away from the register camera; shirt placket
on the back; shoe toes reversed; cap brim projecting backward; crown reading as a
mushroom; eyes too button-like; nose too spherical; head too wide; bright sleeve
cuff ring; and bright trouser seam ring. The integration aligned Blender forward
to the established rig forward. Fixed staff, reverse, profile, and register cameras
then made the remaining form defects reproducible.

### Iteration 3 — repair cap, face, neck, and joint seams

Evidence: `iteration-3/01-staff-counter.png` through
`04-register-checkout-pose.png`, result JSON, and video.

Visible defects catalogued: flattened crown; weak forward brim; oversized head;
abrupt head/torso join; large eyes; bulbous nose; missing mouth; metallic-looking
sleeve seam; robotic knee seam; and unnecessary seam triangles. The revision used
a fitted lofted baseball crown, projected brim and band, smaller facial proportions,
a neck, restrained mouth, and continuous cloth/trouser surfaces. Sampled character
triangles fell from 5,132 to 4,576 at this stage.

### Iteration 4 — finish hands and small-scale clothing reads

Evidence: `iteration-4/01-staff-counter.png` through
`04-register-checkout-pose.png`, result JSON, and video.

Visible defects catalogued: ball-like palm; missing finger rhythm; weak thumb;
invisible collar; invisible placket; crown peak too sharp; head density above its
screen contribution; shoe density above its screen contribution; per-character
wardrobe materials; and a separate shirt-detail draw. The revision added a palm,
thumb and four-finger silhouette, restored collar/placket geometry, flattened the
crown, reduced hidden curvature density, shared the finite wardrobe palette, and
finally folded the shirt detail back into the torso mesh.

## Final visual and functional QA

- `final-inspection/`: front, reverse, profile, and register-pose frames at
  1280x720, a recorded normal-control register entry, dimensions, mesh/triangle
  counts, hierarchy, and all moving pivots.
- `final-transaction-accepted/`: complete normal-control card transaction with
  re-entry interruption, incomplete and accepted swipe, authorization, receipt,
  bagging, and animated handoff. Final accounting is revenue `$66`, 2 units,
  0 held units, and no active transaction.
- Browser/page errors: zero. The only runner diagnostic is the already-tracked
  Chromium/ANGLE X4000 shader warning (`H-010`).

## Performance comparison

Protocol: Google Chrome through Playwright, 1600x900, device scale 1, relaxed seed
424242, 14:00 fixed lighting, fully stocked shop, fixed register camera, 12 visible
characters, 8-second crowd/active samples, and 25 register re-entry cycles. Two
detached `e503749` control runs bracketed repeated after runs. Time-based samples
showed material host contention, so both raw runs are retained; the final run and
deterministic scene counters are reported below. Renderer calls/triangles include
the game's multi-pass frame. Texture memory is the harness's decoded-image estimate.

| Crowd metric | Control median | Final | Delta |
|---|---:|---:|---:|
| Average FPS | 29.18 | 40.57 | +39.0% |
| 1% low FPS | 21.00 | 31.45 | +49.8% |
| Worst frame | 48.95 ms | 38.50 ms | -21.3% |
| CPU render | 33.47 ms | 24.04 ms | -28.2% |
| Draw calls | 5,616.4 | 5,629.0 | +0.2% |
| Rendered triangles | 5,688,496 | 5,899,572 | +3.7% |
| Scene materials | 310 | 260 | -16.1% |
| Unique geometries | 1,285 | 1,093 | -14.9% |
| Texture objects / decoded estimate | 173 / 6,054.5 MiB | 173 / 6,054.5 MiB | unchanged |
| JS heap | 119.1 MiB | 90.5 MiB | -24.0% |
| Listener growth / UI text updates | 0 / 0 | 0 / 0 | unchanged |

The accepted tolerance for this close-range hero-art pass was at most 5% more
submitted geometry/draw work, no unbounded heap/listener growth, and no failed
normal re-entry. Final crowd draw calls rise 0.2% and triangles 3.7%; materials and
unique geometries fall materially. The active register rose 1.4% in calls and 4.0%
in triangles, completed all 25 re-entries with zero fallback, added zero listeners,
and ended the stress interval 20.5 MiB below its starting heap sample. The character
pass therefore introduces no measured performance regression. Project-wide texture,
shadow, and render budgets remain separate open blockers.
