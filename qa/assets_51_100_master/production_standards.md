# Assets 51–100 production standards

These standards are the shared contract for Blender sources, GLB exports, runtime integration, first-person presentation, cleaning behavior, persistence, and QA. They apply to all fifty primary assets and their supporting variants.

## Authority and source protection

- The exact seven files in `reference_inventory.json` are the authoritative visual references.
- The written master objective takes precedence when a reference illustration simplifies or contradicts gameplay. In particular, cleaning follows the physical tool path, vacuumed debris travels to the nozzle, broomed debris forms a pile, and progress bars remain supplemental.
- Raw Tripo and third-party source files are immutable. Derived work uses new traceable Blender files.
- No external asset may be downloaded without explicit approval. Every approved external input needs a source URL, author, license, retrieval date, and affected output list.
- Pineview logos and AI-rendered label text are reference placeholders. Production artwork uses original Pinehollow/Golf Flipper-safe branding.

## Units, axes, scale, and transforms

- Blender uses Metric units with unit scale `1.0`; one Blender unit is one meter.
- Runtime world-space is yard-based. Imported meter-authored GLBs use the established `METERS_TO_YARDS = 1.0936133` conversion exactly once at the integration boundary.
- Positive Z is up in Blender. GLB conversion and Three.js loading must not introduce mirrored geometry or a second unit conversion.
- Every source records target width, height, and depth in meters before modeling. Player clearance, reach, and navigation are checked against the real clubhouse layout.
- Apply scale and rotation before export. Object scale must be `[1, 1, 1]` unless a documented animation or instancing contract requires otherwise.
- Static asset origins sit at the footprint center on the finished floor. Wall assets use a centered wall-mount origin. Moving parts use their physical hinge, slide, axle, grip, or deformation origin.

## Canonical paths and naming

- New sources: `asset_sources/blender/assets_51_100/sheet_06` through `sheet_10`.
- Canonical exports: `Assets/assets_51_100/glb/sheet_06` through `sheet_10`.
- Runtime exports: `vendor/models/assets_51_100/sheet_06` through `sheet_10`.
- First-person variants: `asset_sources/blender/assets_51_100/firstperson`, `Assets/assets_51_100/glb/firstperson`, and `vendor/models/assets_51_100/firstperson`.
- File stems use `asset_NNN_descriptive_name`, for example `asset_079_pressure_washer_wand`.
- Root nodes use `A_NNN_NAME_ROOT`. Render meshes use `MESH_`, collision proxies use `COL_`, sockets use `SOCKET_`, and LOD groups use `LOD0_`, `LOD1_`, and `LOD2_`.
- No `Cube`, `Cylinder`, `Material.001`, unnamed nodes, cameras, or lights may ship in an export.

## Hierarchy, pivots, sockets, and animation

- Moving and interactive components remain separate objects under one clean asset root.
- Required common sockets are `SOCKET_PLACEMENT` and, where carried, `SOCKET_CARRY`.
- Handheld tools author `SOCKET_GRIP_R`, optional `SOCKET_GRIP_L`, `SOCKET_CONTACT`, and `SOCKET_EFFECT` in the GLB. Runtime code reads sockets; it does not scatter hand-tuned magic offsets.
- Doors author hinge origins and separate leaves. Drawers use their real slide axes. Wheels, casters, levers, triggers, wringers, clock hands, phone handsets, lamp arms, cabinet doors, and tool heads use their actual motion centers.
- Animation names follow `idle`, `equip`, `unequip`, `use_start`, `use_loop`, `use_stop`, `contact`, and the asset-specific verb such as `door_open`, `drawer_open`, `wringer_close`, or `bag_fill`.
- Exercise every moving part in Blender and after clean reimport. Collision state and interaction targets must track the animated state.

## Geometry and shading

- Manufactured edges receive intentional bevels sized for the asset scale. Weighted/smoothed normals must not create black seams or melted profiles.
- Silhouette and construction detail get geometry; micro-scratches and fine fabric grain stay in textures or shaders.
- Hidden duplicate geometry, zero-area faces, inverted normals, non-manifold accidental edges, loose floating components, and coplanar z-fighting are release blockers.
- Repeated modules share geometry or use instancing. Architecture remains modular instead of one monolithic mesh.
- First-person tools use a dedicated high-quality LOD. World models retain correct proportions and use lower-cost distant LODs where the expected instance count justifies them.

## UVs, textures, and materials

- UV islands do not overlap unless intentional mirroring or shared atlas occupancy is documented. Maintain consistent texel density, orientation, seams, and at least eight-pixel padding at the target resolution.
- Preferred texture sizes: architecture atlas 2048² (4096² only with measured need), hero furniture/tool 2048², small props 1024², tiny labels 512–1024 with shared atlases.
- Use mipmaps and compressed runtime textures where supported. No asset gets a unique high-resolution texture merely to carry a flat color.
- Materials use the Pinehollow palette: warm cream, deep golf green, muted sage, medium walnut, natural oak, warm charcoal, and restrained brass.
- Stylized PBR is mandatory: plausible roughness/metalness separation, readable normal response, restrained glass, and coherent material scale. Brass/steel are metallic; painted wood, leather, cloth, rubber, glass, and paper are not.
- Glass is single-surface where practical, restrained in opacity/reflection, and excluded from shadow casting unless a measured visual benefit justifies it.

## Category budgets

Budgets are review thresholds, not targets. A manifest record may exceed one only with player-camera evidence and identical-scenario performance measurements.

| Manifest category | LOD0 triangles | Meshes | Materials | Textures | Maximum texture | Maximum GLB |
|---|---:|---:|---:|---:|---:|---:|
| Architecture shell | 120,000 | 80 | 16 | 18 | 2048² | 24 MiB |
| Architecture module | 36,000 | 36 | 8 | 10 | 2048² | 10 MiB |
| Surface set | 12,000 | 20 | 10 | 18 | 2048² | 14 MiB |
| Large fixture | 28,000 | 28 | 8 | 8 | 2048² | 8 MiB |
| Furniture | 22,000 | 20 | 6 | 6 | 2048² | 7 MiB |
| Powered tool | 28,000 | 28 | 8 | 8 | 2048² | 9 MiB |
| Handheld tool | 14,000 | 18 | 6 | 6 | 2048² | 5 MiB |
| Small interactive | 12,000 | 16 | 6 | 6 | 2048² | 5 MiB |
| Small prop | 7,000 | 10 | 4 | 4 | 1024² | 3 MiB |
| Dedicated first-person variant | 18,000 | 20 | 6 | 6 | 2048² | 6 MiB; maximum 32 bones |

Architecture must still share sheet materials and modular geometry; these are per-export rejection ceilings, not permission to duplicate the full shell or consume every budget.

## Collision and placement

- Collision proxies are separately named, simplified, closed, and convex/simple where practical. Render meshes are not default collision for complex assets.
- Walkable floors, porch, and stairs use smooth navigation collision; decorative gaps and rail details never snag the player.
- Small wall props do not add movement-blocking colliders. Furniture colliders match the occupied silhouette without sealing usable negative space.
- Doors change collision with their leaf state and protect occupied swing space. Damaged/restored swaps remove stale colliders and stale interaction targets.
- A development-only collider visualization must cover Assets 51–100 and remain disabled in production.

## Unified first-person tool contract

- Tool definitions are data-driven and provide world asset, first-person asset, right/left grip sockets, contact/effect sockets, valid surfaces, strength, radius, audio, particles, decals, sway, and reduced-motion values.
- One reusable viewmodel controller owns equip, unequip, idle, aim, use, contact, invalid target, animation blending, audio loop cleanup, and camera response.
- Hands and forearms are authored/rigged stylized assets with a consistent deep-green sleeve. Procedural box-and-cylinder hands are baseline placeholders and cannot satisfy final acceptance.
- Long tools stay diagonally framed from the lower-right/lower-center while preserving the target. Tool sway never changes the authoritative aim ray.
- All visual effects originate at `SOCKET_EFFECT`; physical cleaning originates at `SOCKET_CONTACT` or the effect impact ray. Nothing emits from the camera or chest.
- Reduced-motion mode keeps contact/readability while removing recoil jitter, large equip arcs, and strong camera response.

## Cleaning-surface contract

- Every cleanable surface exposes a stable ID, surface/dirt classes, allowed tools, resistance, local/world projection data, bounds, masks, completion threshold, audio/effect profile, and versioned save payload.
- Dirt, grime, stain, and temporary wetness are distinct channels. Tools affect only declared classes.
- Updates are localized dirty regions with smooth brush falloff and surface-local coordinates. Rays stop at the first valid occluder and cannot clean through walls, behind a surface, or at unsupported range/angle.
- Pressure washing erodes the actual spray footprint, adds impact mist/wetness, and uses the physical nozzle origin.
- Vacuum debris visibly travels toward the nozzle and disappears only on intake. Mop cleaning follows stroke direction/contact and rejects carpet. Broom impulses consolidate debris into persistent piles; dustpan collects the pile. Spray wets/loosens grime; cloth and sponge remove only contacted prepared grime. Trash bags show empty/partial/full/tied states and update progress exactly once on disposal.
- Temporary wetness darkens surfaces slightly, raises reflectivity modestly, follows the application path, and fades without permanent gloss.

## Runtime lifecycle and persistence

- GLBs load through the existing cache/lifecycle boundary. No asset, material, geometry, raycaster, vector, matrix, audio node, or particle pool is created per frame.
- Effects use shared materials, pooling, fixed caps, impact batching, throttled updates, and distance culling.
- Save data is versioned and deterministic. It preserves placement, restoration/damage state, cleaning masks, debris piles, trash removal, tools, fill states, doors/cabinets, floor and panel selections, and safe equipped state.
- Reload never resurrects dirt/trash, duplicates furniture, leaves active effects/audio, loses tools, restores removed colliders, or substitutes a placeholder asset.
- Equip/use/drop, scene enter/exit, damaged/restored swaps, furniture animation, and save/reload stress loops must stabilize geometry, material, texture, listener, timer, animation-mixer, audio-node, and heap counts.

## QA and acceptance gates

- Preserve a fixed baseline before implementation: same browser, hardware, fixture, time/weather, viewport, device scale, quality, cameras, warm-up, and duration.
- Browser visual QA requires at least four complete inspect/fix/compare iterations. Each iteration uses normal controls, console/page/request checks, fixed-camera captures, and at least ten ranked visible defects before the fix pass.
- Validate at 1280×720, 1600×900, and 1920×1080; supported low/normal/high FOV; resize; high device-pixel ratio; and reduced-motion mode.
- Performance before/after evidence records average FPS, 1% low, worst frame, draw calls, rendered triangles, material count, texture memory or explicit unmeasured status, JavaScript heap, active listeners, and relevant UI update frequency.
- Final acceptance requires clean Blender reimport, player-camera comparison, normal-control interaction, collision, save/load, performance, console, screenshots, and recorded gameplay for every applicable asset/system. A passing build or isolated Blender render is not completion.
