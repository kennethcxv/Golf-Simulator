# Course 1 failing-municipal environment

## Authoritative references

- Product brief: `C:/Users/Kenneth/.codex/attachments/63c7d427-0907-449b-9bad-f07c5871d402/pasted-text-1.txt`
- Visual boards: `Designs/ClubHouse/ChatGPT Image Jul 20, 2026, 02_52_25 PM.png` and `02_52_34 PM.png`
- Fixture/finish progression board: `Designs/ClubHouse/ChatGPT Image Jul 20, 2026, 02_51_59 PM.png`

The Course 1 row and detailed failing-municipal board govern the starting state. It must read as a course that operated successfully for years and has declined through deferred maintenance, not abandonment. The building and property remain open, safe, powered, and usable.

## Real-world dimensional contract

All authored source dimensions are meters. Runtime conversion occurs once in the loader.

| Element | Target |
| --- | ---: |
| Enclosed clubhouse footprint | 12.80 m x 9.75 m |
| Enclosed area | 124.80 m2 / 1,343.34 sq ft |
| Finished ceiling | 2.65 m |
| Exterior eave | 3.05 m |
| Roof pitch | 4:12 |
| Exterior wall assembly | 0.22 m |
| Interior partitions | 0.12 m |
| Main double-door clear opening | 1.80 m x 2.15 m |
| Service / maintenance doors | 0.95 m x 2.10 m |
| Standard window rough opening | 1.20 m x 1.25 m |
| Accessible sidewalk | 1.50 m minimum clear width |
| Accessible parking bay | 2.44 m plus 1.52 m access aisle |
| Standard parking bay | 2.65 m x 5.50 m |
| Parking count | 20 total, including 2 accessible bays |

The service spine contains an empty office, restroom, storage room, and tiny employee room. The restroom has capped supply rough-ins and a floor-waste flange only. The remaining space is the empty main/check-in area. No counter, furniture, shelving, display, stock, decoration, fixture, or equipment is part of the starting building.

## Modular Blender kit

Every assembled piece is also retained as a reusable source module with shared mesh data where appropriate.

- Walls: 0.60 m, 1.20 m, 2.40 m, window, single-door, and double-door bays; exterior siding, structural core, and interior drywall remain separable.
- Roof: field panel, ridge, rake, fascia, soffit, asphalt course, flashing, gutter, downspout, vent, and restrained patch modules.
- Openings: old aluminum window frame/sash/glazing, double entrance leaves, service leaf, maintenance leaf, jamb, casing, sill, lintel, closer, hinges, handles, and thresholds.
- Porch: slab, step, accessible ramp, square column, base/cap trim, beam, railing, and old wall-light modules.
- Interior: drywall partition bays, simple hollow-core door sets, concrete floor, suspended ceiling grid/tile/light, outlets, switches, emergency light, and capped restroom rough-ins only.
- Site: asphalt lot panels, curbs, sidewalk panels, faded/chipped stripe segments, accessible marking, concrete cracks, weed tufts, loading apron, cart path, road connection, putting green, flagpole, municipal sign, bench, trash can, charging area, maintenance shed, dumpster enclosure, electrical boxes, HVAC units, and bollards.
- Runtime: modular LOD0 source geometry, runtime-only material batching, independently moving leaves, and separately named simplified collision proxies. The Blender source remains unbatched and reusable.

## Production outputs

- Architecture source: `asset_sources/blender/course1_municipal/course1_municipal_clubhouse_architecture_v001.blend`
- Property source: `asset_sources/blender/course1_municipal/course1_municipal_property_v001.blend`
- Canonical GLBs: `Assets/course1_municipal/glb/`
- Runtime GLBs: `vendor/models/course1_municipal/`
- Repeatable builders: `tools/blender/build_course1_municipal.py` and `tools/blender/build_course1_municipal_property.py`
- Generated project-owned textures: `Assets/course1_municipal/textures/`
- Machine-readable audits: `asset_sources/blender/course1_municipal/*_audit.json`

The architecture audit records 704 production objects, 693 render meshes, 25 collision proxies, 30 materials, eight physical door leaves, no missing UVs, no unapplied scale, and no non-finite data. The property audit records 474 production objects, 453 render meshes, five collision proxies, 42 materials, 20 parking spaces including two accessible spaces, and five hinged utility components.

## Baseline evidence

Captured 2026-07-20 from commit `1dfb9de` on the isolated `feature/course-1-failing-municipal` worktree.

- Launch: `QA_BASE_URL=http://localhost:28573/ COURSE1_QA_PASS=baseline-pre-replacement node tools/qa/run-playwright.cjs tools/qa/course1-municipal-baseline.js --bootstrap`
- Evidence: `qa/course1_municipal/baseline-pre-replacement/`
- Normal controls: canvas click, `W`, `E`, `W`; 9.72 yd travelled through the entrance route.
- Browser: no blocking console, page, network, or HTTP errors; one Three.js shader warning.
- Listener growth: 0.
- Heap delta across the entrance route: +7,786,128 bytes before GC; retained-growth judgment is deferred to repeated after-runs.
- Current whole-scene render counters at the exterior camera: 9,262 draw calls, 15,396,604 rendered triangles, 638 materials, 193 referenced textures.

## Baseline visual defects, ranked by player impact

1. The 21 yd x 13.5 yd shell is approximately 2,552 sq ft, almost twice the requested 1,200–1,500 sq ft footprint.
2. The interior is filled with retail shelving, counters, displays, lounge furniture, stock, rugs, boxes, and decor, directly violating the intentionally empty starting-shell requirement.
3. There is no small asphalt parking lot around the clubhouse; lawn runs to the porch and service walls.
4. Faded parking stripes, accessible bays, cracked paving, and weeds-through-cracks are absent.
5. The facade reads as a broad renovated retail pavilion with formal columns and multiple roof projections, not the simple rectangular municipal building in the references.
6. Siding is uniformly saturated deep green; the dark rectangular grime bands read as overlay errors instead of sun fade, peeling paint, and individually warped boards.
7. White triangular roof/trim pieces visibly protrude at both front corners and break the silhouette.
8. The rear wall is almost blank and lacks a believable maintenance/delivery composition, exterior lights, electrical service, HVAC, and loading apron.
9. The current shed and cart are isolated on grass with no charging slab, canopy, outlets, bollards, cart path, or service-yard organization.
10. The property lacks the tiny putting green, flagpole, municipal entrance sign composition, bench, trash cans, dumpster enclosure, and road/cart-path connections.
11. Windows are oversized dark retail panes with decorative casing rather than modest, aging aluminum municipal windows.
12. The porch is visually overbuilt and too symmetrical; its bright ornamental columns and pristine railings conflict with the cheap-construction brief.
13. The roof reads as several competing gables/dormers and a near-black monolith instead of a simple patched asphalt gable roof with aged gutters.
14. Exterior daytime lighting crushes the porch and siding into black-green values, hiding material and wear detail from the player camera.
15. Interior coffer beams, pendants, walnut wainscot, trophy lounge, and framed art signal an upscale finished shop rather than a low-ceiling empty municipal shell.
16. The service-wing fixed camera is physically blocked by existing retail displays, revealing that the current layout cannot present or furnish four empty utility rooms cleanly.

## Visual review and revision record

All review media is under `qa/course1_municipal/` and is intentionally ignored by Git.

1. `blender_review/*-v001.png`: identified the absent property context, over-dark porch, weak doorway hierarchy, overly dominant roof, insufficient side-wall aging, unreadable sign, incomplete rear-service story, missing accessible route, missing parking composition, and missing maintenance/utility context.
2. `blender_review/property-*-v002.png`: identified tiled lawn UVs, a flat practice-green silhouette, saturated accessible paint, disorderly access-aisle hatching, disconnected curb ramp, light-pole/route conflicts, pristine stripes, unfinished charging canopy, underdeveloped shed finish, and a primitive dumpster enclosure.
3. `blender_review/property-*-v003.png`: identified remaining lawn repetition, overly bright practice turf, oversized accessible symbols, weak tactile-pad contrast, hard lawn boundary, insufficient stripe wear, a pole too near circulation, weak canopy lettering, sparse utility detailing, and dark façade values.
4. `blender_review/property-*-v004.png` plus `architecture-*-v004..v006.png`: corrected continuous terrain UVs, mowing bands, accessible markings/hatching, ramp connection, pole location, faded paint, complete utility modules, warm ceiling values, door pivots, and façade readability. This became the accepted Blender asset pass.
5. `runtime-integration-smoke/`: identified legacy visual overlap, furnished interior leakage, invisible obstacles, excessive unbatched draw calls, missing authored door leaves, invalid moving transforms, a hard secondary-lawn boundary, stale service-wing cameras, and crushed siding/ceiling values. The runtime lease, batching, metadata, cameras, collision authority, and materials were revised.
6. `runtime-authored-collision/` and `material-lighting-v2/`: accepted the final player-camera pass after exact Blender collision proxies, seven doorway interactions, empty-start visibility, ceiling correction, and façade tuning were verified.

## Runtime acceptance evidence

- Normal entrance route: canvas click, `W`, `E`, `W`; 10.27 yd travelled through the authored double door.
- Door functional pass: all seven doorway interactions opened through normal `E` control; each leaf reached approximately 99–100 degrees.
- Collision: 15 authored wall/partition colliders, eight live door-leaf colliders, and three shed colliders; zero invalid moving transforms.
- Empty start: all 18 legacy default fixtures are hidden and non-colliding; no direct interior child remains visible in the fresh-save inspection.
- Customization round trip: a player-added worktable autosaved, reloaded, retained 16 visible meshes, and left architecture and inventory byte-equivalent at the JSON level.
- Console: no blocking console, page, network, or HTTP errors. The pre-existing Three.js shader compiler warning remains non-blocking; teardown-only `ERR_ABORTED` requests are classified separately.
- Screenshots: `qa/course1_municipal/final-acceptance/01..08*.png`.
- Video: `qa/course1_municipal/final-video/*.webm`, 1600x900, normal-control entrance followed by fixed property review views.

## Matched performance comparison

| Metric | Before | Final | Result |
| --- | ---: | ---: | ---: |
| Exterior idle average FPS, mean of 3 samples | 32.14 | 88.66 | +176% |
| Exterior idle 1% low FPS, mean of 3 samples | 20.67 | 45.30 | +119% |
| Entrance-route average FPS | 96.63 | 134.36 | +39% |
| Entrance-route 1% low FPS | 39.97 | 59.88 | +50% |
| Draw calls at matched exterior camera | 9,262 | 2,362 | -74.5% |
| Rendered triangles | 15,396,604 | 13,458,236 | -12.6% |
| Resident geometries | 1,566 | 477 | -69.5% |
| Referenced textures | 193 | 188 | -2.6% |
| Listener growth during route | 0 | 0 | stable |

The final matched pass is non-regressing across frame rate, 1% lows, draw calls, triangle throughput, listener count, and resident-resource counts. Existing checkout and save state were not deleted or structurally migrated; the unfurnished municipal lease only suppresses the old starting presentation and permits future non-default fixture IDs.
