# Production Landscaping Library

## Asset audit

The six files in `vendor/models/trees/` are retained only as immutable legacy inputs. New authoring no longer exposes them.

| Legacy asset | Decision | Production resolution |
| --- | --- | --- |
| `tree_default.glb` | Replace in UI; retain for save compatibility | Runtime alias to `fill_a` |
| `tree_detailed.glb` | Replace in UI; retain for save compatibility | Runtime alias to `shade_a` |
| `tree_fat.glb` | Replace in UI; retain for save compatibility | Runtime alias to `oak_b` |
| `tree_oak.glb` | Replace in UI; retain for save compatibility | Runtime alias to `oak_a` |
| `tree_pineDefaultA.glb` | Replace in UI; retain for save compatibility | Runtime alias to `pine_a` |
| `tree_pineRoundB.glb` | Replace in UI; retain for save compatibility | Runtime alias to `pine_b` |

The pre-existing production flora remains in service:

- Keep as hero/authoring assets: `oak_a`, `oak_b`, `maple_a`, `shade_a`, `flower_a`, `pine_a`, `spruce_a`, `shrub_round`, `shrub_flower`, `bush_native`, `reed_clump`, `grass_clump`, `rock_s`, `rock_m`, `boulder_a`, and `shore_rock`.
- Keep as lightweight LOD/support assets: `fill_a`, `fill_b`, `birch_a`, `pine_b`, `cedar_a`, and `pine_far`.
- Replace the procedural runtime hedge and flower patch with `hedge_a` and `flower_bed_a`. Legacy `hedge`, `flowers`, `bush_round`, `bush_flower`, and `reeds` IDs remain hidden migration aliases.
- Delete: none. Removing legacy files would break imported courses and older saves; they are no longer player-selectable.

## New original assets

`tools/blender/build_course_flora.py` authors and exports the following additions:

- Player-placeable: `cypress_a`, `palm_a`, `acacia_a`, `eucalyptus_a`, `ornamental_small_a`, `hedge_a`, `groundcover_a`, and `flower_bed_a`.
- Renderer-only LOD: `cypress_far`, `palm_far`, `acacia_far`, `eucalyptus_far`, and `deciduous_far`.

All geometry is original and generated in-repository. No third-party or generated external assets are used. Each variant ships with its `.blend` source, one-mesh GLB, one vertex-color material, applied transforms, ground-contact pivot, bounded triangle count, and clean re-import report.

Regenerate and validate this set with:

```powershell
& 'C:\Program Files\Blender Foundation\Blender 5.1\blender.exe' --background --factory-startup --python tools/blender/build_course_flora.py -- landscape validate render
```

## Runtime contract

- The editor exposes direct production IDs with cost, climate, mature height, root radius, and canopy radius.
- Placement protects the complete canopy/use footprint from playing surfaces, cart paths, structures, property edges, water, and other objects.
- Hover previews use the same loaded geometry, authored scale, ground contact, and rotation committed by placement.
- Trees use hysteretic near, medium, and far LOD tiers. Far proxies do not cast shadows.
- Hero flora and close landscape layers use subtle weather-scaled wind deformation. Distant proxies stay static to protect frame time.
- GLB geometry/materials are shared across instanced rebuilds and protected from accidental disposal.

## Acceptance evidence

The ignored `qa/property-expansion-world-overhaul/landscaping/` directory contains before/after screenshots, recorded browser runs, Blender contact sheets, re-import reports, lifecycle results, and identical-camera performance captures.

Final controlled overview comparison:

- Average FPS: 74.91 before, 70.48 after.
- One-percent low: 55.99 before, 51.02 after.
- Draw calls per frame: 1,572.47 before, 1,572.34 after.
- Triangles per frame: 7,206,121 before, 7,149,325 after.
- Browser errors and failed requests: zero.
