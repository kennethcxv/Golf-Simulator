# Construction finish visual QA

## Scope and method

- Branch: `feature/material-upgrades`
- Viewport: 1600 x 900, device scale factor 1
- Fixture: Willow Creek, deterministic QA save, first-person player camera
- Controls: laptop opened with `E`; category, finish, and quality chosen in the normal UI; confirmation clicked; laptop closed with `Escape`; the installed result was then inspected from the player camera and reloaded from autosave.
- Reference: `Designs/ClubHouse`
- Baseline: `qa/assets/material-upgrades-before/`
- Final category evidence: `qa/assets/material-upgrades-floor-final/`, `material-upgrades-ceiling/`, `material-upgrades-wall/`, `material-upgrades-window/`, `material-upgrades-door/`, `material-upgrades-garage-iteration3/`, and `material-upgrades-lighting-final/`
- Recorded normal-control evidence: `qa/assets/material-upgrades-final-video-v2/video/page@a4e8e1f4b02ee32d395a07296f046b8a.webm`, with the matching assertions in `material-upgrades-final-video-v2/result.json`

Representative launch commands:

```powershell
$env:QA_BASE_URL='http://localhost:8469/'
$env:CONSTRUCTION_FLOOR_QA_OUT='C:\Users\Kenneth\Documents\GitHub\Golf-Flipper\qa\assets\material-upgrades-floor-final'
node tools/qa/run-playwright.cjs tools/qa/construction-floor-purchase-qa.js

$env:CONSTRUCTION_GARAGE_QA_OUT='C:\Users\Kenneth\Documents\GitHub\Golf-Flipper\qa\assets\material-upgrades-garage-iteration3'
node tools/qa/run-playwright.cjs tools/qa/construction-garage-purchase-qa.js

$env:CONSTRUCTION_LIGHTING_QA_OUT='C:\Users\Kenneth\Documents\GitHub\Golf-Flipper\qa\assets\material-upgrades-lighting-final'
$env:VIDEO_DIR='C:\Users\Kenneth\Documents\GitHub\Golf-Flipper\qa\assets\material-upgrades-lighting-final\video'
node tools/qa/run-playwright.cjs tools/qa/construction-lighting-purchase-qa.js --bootstrap
```

## Fixed camera views

Coordinates are offsets from the clubhouse interior origin unless marked otherwise.

| View | Player position | Target / orientation | Time |
| --- | --- | --- | --- |
| Floor | `(-0.35, 2.40)` | target `(-0.35, -2.45)`, pitch `-0.55` | 14:00 |
| Ceiling | `(-0.60, 2.60)` | yaw `0`, pitch `0.62` (`0.44` for lighting) | 14:00 |
| East wall | `(1.35, -3.65)` | target `(5.62, -3.65)`, pitch `-0.10` | 14:00 |
| South windows | `(0.70, -1.75)` | target `(3.00, -6.55)`, pitch `0.02` | 14:00 |
| Entrance doors | `(-0.80, 3.45)` and near interaction at `(-0.80, 5.15)` | target `(-0.80, 6.55)`, pitch `0` | 14:00 |
| Garage / receiving bay | `(16.00, 0.25)` | target `(9.65, 0.25)`, pitch `0.01` | 11:00 |
| Wall sconces | `(0, -1.20)` | target `(0, -6.20)`, pitch `0.12` | 14:00 |
| Landscape lighting | `(-1.50, 13.50)` | target `(-1.50, 6.65)`, pitch `0.02` | 17:00 |
| Laptop | `(8.45, 4.50)` | yaw `-PI/2`, pitch `-0.05` | current fixture time |

## Iteration 1 — baseline and flooring language

Evidence: `qa/assets/material-upgrades-before/` to `qa/assets/material-upgrades-floor-final/`.

1. The original floor read as oversized patchwork boards rather than a believable installed commercial floor. Resolved with correctly scaled modular plank, tile, carpet, slab, and herringbone carriers.
2. Repeated large rectangular color blocks made the floor look procedurally random. Resolved with family-specific joint rhythms and controlled tone variation.
3. The orange/yellow floor palette fought the warm cream, golf green, and walnut direction. Resolved with muted oak, walnut, stone, and warm-neutral values.
4. There was no visible municipal-to-luxury progression. Resolved with five authored grades per family, changing joint precision, bevel restraint, roughness, depth, and detailing.
5. No herringbone geometry was available despite the country-club brief. Resolved with a true alternating herringbone field rather than a flat color substitute.
6. Hard surface, carpet, and tile families shared too much of the same silhouette. Resolved with distinct plank, slab, tile, carpet, and herringbone geometry.
7. Board seams were broad and visually noisy at player height. Resolved by tightening joints as quality increases and keeping relief restrained.
8. The previous finish lacked a controlled walnut presentation grade. Resolved with a final walnut palette pass that avoids the earlier salmon/pink lift.
9. Floor swaps risked changing the player surface height. Resolved by keeping every production carrier on the same one-metre footprint and the analytic walk plane authoritative.
10. The installed finish could not be visually proven after persistence. Resolved with matched installed and post-reload player-camera captures plus runtime material/variant assertions.

## Iteration 2 — garage-door composition

Evidence: `qa/assets/material-upgrades-garage/`, `material-upgrades-garage-iteration2/`, and `material-upgrades-garage-iteration3/`.

1. The first luxury door was too dark to read against the deep-green siding. Resolved with a warmer walnut value and revised daytime review camera.
2. The first camera was too close and cropped away the receiving-bay context. Resolved with the fixed service-yard camera showing window, sign, ramp, and pallets.
3. The door lacked a complete perimeter casing. Resolved with two casing legs, a head casing, reveal, and threshold.
4. Upper glazing was crossed by heavy panel/stile lines. Resolved by stopping carriage courses below the glazing band.
5. The glazing read as four dark holes rather than windows. Resolved with unobstructed clear panes and brighter restrained trim.
6. The window surrounds disappeared into the door field. Resolved with thin brass trim on the luxury country-club grade.
7. The pull handle was too small to communicate function from the player camera. Resolved with a wider low-mounted brass pull.
8. The door sat flat on the facade with no threshold/reveal depth. Resolved with a charcoal back reveal and grounded threshold.
9. Municipal, standard, and premium silhouettes were insufficiently distinct. Resolved with vertical ribbed steel, insulated panel, and charcoal flush profiles.
10. High-end and luxury grades did not initially read as carriage doors. Resolved with oak/walnut carriage stiles, courses, glazing, and restrained hardware.

## Iteration 3 — lighting integration baseline

Evidence: `qa/assets/material-upgrades-lighting-iteration1/` and the first complete run in `material-upgrades-lighting-iteration2/`.

1. Legacy hanging-lantern visuals remained visible alongside the new lighting families. Resolved by suppressing their fixture meshes while retaining the established practical light sources.
2. The first runtime batch could not accommodate the new fixture descriptors. Resolved by replacing mount resources safely while preserving placement capacity.
3. LED panels were too small at the ceiling-camera distance. Resolved by increasing authored panel width and depth.
4. Eight chandeliers were displayed even though the catalog quote specifies two. Resolved by capping the chandelier instance count to two.
5. Sconces initially inherited ceiling placement behavior. Resolved with a separate `wall_light_mount` path and ten perimeter datums.
6. Sconces were underscaled and lost against the wall treatment. Resolved with a larger shade/backplate silhouette.
7. Landscape fixtures were authored against facade/siding coordinates instead of grade. Resolved by moving them to porch and path-ground datums.
8. Landscape fixtures changed mesh appearance but emitted no real scene light. Resolved with three quality-scaled, shadowless `THREE.PointLight` sources.
9. The landscape selection did not fully hide indoor construction fixtures. Resolved with mutually exclusive ceiling, wall, and landscape mount modes.
10. The aborted first run did not prove the complete purchase/reload route. Resolved with a normal-control run covering LED panels, chandeliers, sconces, landscape lighting, autosave, and reload.

## Iteration 4 — lighting presentation refinement

Evidence: `qa/assets/material-upgrades-lighting-iteration2/` to `material-upgrades-lighting-final/`.

1. The early landscape fixtures appeared attached to the siding. Resolved with eight authored bollards placed on exterior ground/porch datums.
2. The early fixtures were too small to read as a 24-fixture quoted installation. Resolved with a taller quality-scaled bollard silhouette while retaining eight representative scene datums.
3. No light pool reached the porch surface. Resolved with three warm practical sources placed over representative fixture clusters.
4. The facade remained almost uniformly dark around the entry. Resolved by aiming the warm pools at the porch and approach without adding expensive shadows.
5. The first landscape frame cropped most approach context. Resolved with the wider fixed landscape camera.
6. Legacy fixture silhouettes competed with the new bollards. Resolved by hiding legacy fixture visuals whenever production lighting is active.
7. Indoor fixture meshes could remain visible after selecting landscape lighting. Resolved with direct visibility diagnostics and a zero-visible-indoor assertion.
8. The active light state was not inspectable. Resolved with `lightSourceCount` and `lightSourcesActive` runtime diagnostics.
9. The reload frame could not prove that the actual lights returned. Resolved by asserting the saved landscape variant, direct mesh visibility, and practical-light activity after reload.
10. The final pass needed a clean error record. Resolved: no page errors, console errors, or failed requests; only the pre-existing Three.js shader warning remains.

## Final category acceptance

| Category | Families x grades | Normal-control evidence | Result |
| --- | ---: | --- | :---: |
| Flooring | 8 x 5 = 40 | municipal catalog, luxury herringbone purchase, player view, reload | PASS |
| Ceilings | 5 x 5 = 25 | municipal drop ceiling, luxury coffered purchase, player view, reload | PASS |
| Walls | 6 x 5 = 30 | municipal drywall, luxury moulding purchase, player view, reload | PASS |
| Windows | 4 x 5 = 20 | municipal aluminum, luxury country-club purchase, player view, reload | PASS |
| Doors | 5 x 5 = 25 | municipal hollow core, luxury double entry, normal `E` interaction, reload | PASS |
| Garage doors | 1 x 5 = 5 | municipal ribbed steel, luxury carriage purchase, player view, reload | PASS |
| Lighting | 6 x 5 = 30 | LED, chandelier, sconce, landscape purchase sequence, practical lights, reload | PASS |

All seven category result files and the final recorded run report `ok: true` and zero captured page/console errors. The 4.23 MB WebM records the normal-control lighting purchase sequence and persistence reload represented by its adjacent screenshots and result manifest. Clean Blender re-import reports 10/10 assets, 120/120 mandatory checks, 175 tagged variants, 35 families, and zero failed checks. The only retained browser diagnostic is the pre-existing Three.js `potentially uninitialized variable` shader warning.
