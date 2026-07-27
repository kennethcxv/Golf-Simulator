# Premium Clubhouse Architecture Specification

## Reference authority

The visual authority is the Course 5 row in `Designs/ClubHouse/ChatGPT Image Jul 20, 2026, 02_52_25 PM.png`:

- symmetrical two-storey private-country-club massing;
- warm cream masonry with stone, brick, and premium dark wood hierarchy;
- deep columned arrival, hipped charcoal roof, dormers, and restrained copper accents;
- circular fountain drive, formal planting, broad terraces, and a screened service court;
- large, bright, deliberately empty interior volumes intended for player furnishing.

The furniture/options sheet is not an architectural target. No furniture, reception desk, retail display, loose equipment, or decorative prop belongs in the authored clubhouse shell.

## Real-world scale

All source geometry is authored in metres, Z-up, and exported to glTF Y-up.

| Element | Dimension |
| --- | ---: |
| Enclosed main floor | 32.0 m × 10.0 m = 320 m² |
| Enclosed upper floor | 32.0 m × 10.0 m = 320 m² |
| Total enclosed area | 640 m² / 6,889 ft² gross |
| Finished floor above grade | 0.30 m |
| Floor-to-floor | 3.60 m |
| Clear interior height | 3.18 m minimum |
| Main eave | 7.55 m |
| Main ridge | 10.85 m |
| Exterior wall thickness | 0.30 m |
| Standard structural bay | 4.00 m |
| Main double door clear opening | 2.40 m × 2.80 m |
| Secondary door clear opening | 1.10 m × 2.40 m |
| Tall ground-floor window | 1.50 m × 2.45 m |
| Upper window | 1.30 m × 1.75 m |
| Grand portico | 10.0 m × 4.2 m |
| Covered veranda depth | 3.2 m |
| Accessible sidewalk | 2.0 m clear |

The 640 m² enclosed total intentionally lands near the upper end of the requested 5,500–7,000 sq ft range without counting porches, terraces, canopies, or service aprons.

## Modular construction contract

The authored `.blend` and GLB keep architectural units as separately named hierarchy nodes. Repetition uses 4 m structural bays so future wings can extend without stretching geometry.

Required reusable families:

1. `MOD_WALL_*_4000` — solid, window, double-door, and service-door bays with exterior finish, structural thickness, and cream interior liner.
2. `MOD_CORNER_PIER_600` and `MOD_QUOIN_*` — reusable corners and masonry termination pieces.
3. `MOD_WINDOW_*` — tall, upper, arched, and wide window assemblies with separate glass and mullions.
4. `MOD_DOOR_*` — single and double doors. Every leaf is parented to a hinge empty at the physical hinge axis.
5. `MOD_COLUMN_TUSCAN_550` — base, shaft, neck, capital, and abacus as a reusable column hierarchy.
6. `MOD_CORNICE_4000`, `MOD_TRIM_*`, and `MOD_COPPER_GUTTER_4000` — reusable facade and roof-edge trim.
7. `MOD_ROOF_SLOPE_4000`, `MOD_ROOF_HIP_END`, `MOD_DORMER_1800`, and `MOD_PORTICO_PEDIMENT` — reusable roof construction with slate and copper pieces separated.
8. `MOD_VERANDA_BAY_4000`, `MOD_PORCH_SLAB_4000`, `MOD_STAIR_1800`, and `MOD_SIDEWALK_4000` — reusable circulation architecture.
9. `MOD_FOUNTAIN_*`, `MOD_DRIVE_*`, `MOD_PARKING_*`, and `MOD_SERVICE_*` — site modules, not baked terrain decoration.

Every visible mesh has applied rotation/scale, intentional bevels, UVs, and one of the shared project-owned PBR materials. Collision proxies are separate `COL_*` objects and must never be used as visible meshes.

## Entrance and circulation program

- Center front: member entrance beneath the two-storey grand portico.
- Front-left arrival: covered bag drop connected to the valet loop.
- Front-right arrival: tournament entrance with its own canopy and queue apron.
- East side: member locker entrance opening to the veranda/terrace circulation.
- West service side: separate employee entrance.
- Rear-west: large maintenance entrance.
- Rear-east: loading dock with level apron and weather canopy.
- Rear center: golf-cart staging, dimensioned for at least 18 carts without blocking the loading dock.

The building interior remains an open architectural shell on both levels. Structural columns, floor/roof assemblies, stairs, doors, windows, base trim, cornices, and fixed lighting mounts are architecture; furniture, counters, displays, equipment, and loose decor are excluded.

## Optimization and expansion

- One shared material set across all modules; texture atlases are project-owned and generated repeatably.
- Repeated modules share mesh data inside the source and are cloned from templates at runtime.
- No transmission material may trigger per-pane scene refraction; glass uses restrained alpha blending.
- LOD0 preserves player-camera silhouette and edge highlights. LOD1 removes masonry micro-relief and fine mullions. LOD2 uses facade/roof massing only.
- Collision is analytic or low-complexity convex geometry, never render geometry.
- Wing-end sockets, roof continuation sockets, porch continuation sockets, and finished-floor datums remain stable across future additions.
- The building source never overwrites raw Tripo assets and uses only project-owned generated materials.

## Production gates

Completion requires in-game normal-control traversal, working door pivots/collisions, empty interiors visible from the player camera, day and night screenshots, four visual review/fix iterations, console/network review, full tests, and a matched performance comparison including FPS, 1% low, worst frame, draw calls, triangles, materials, texture memory, heap, listeners, and UI update rate.
