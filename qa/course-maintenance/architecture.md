# Course-maintenance architecture

## Scope and ownership

The vertical slice adds a one-yard simulation layer around a data-selected hero
hole while preserving the existing eight-yard course turf model as the
course-wide interface. Hole 4 is the selected fixture for Willow Creek, but no
maintenance action branches on the number 4. Selection, bounds, surfaces, issue
placement, world coordinates, persistence IDs, and work-order labels derive
from course and hole data.

The fine layer owns local paths and visible state inside its mask. The coarse
layer remains the interface used by weather, staff policy, golfers, reviews,
rating, and the editor.

```text
existing course + hole data
          |
          v
data-driven hero selection -> one-yard surface mask -> local tools / issues
          |                           |
          |                           v
          +------------------- coarse-cell synchronization
                                      |
                         golfers / rating / green speed
```

## Fine turf model

The selected region is a cell-aligned `Uint8Array` mask with 104,192 possible
one-yard cells, of which 56,320 are active. It represents green, fringe, tee,
fairway, rough, native rough, and bunker. Parallel typed fields store height,
target height, moisture, health, wear, disease pressure/type/severity,
fertilizer and pending release, compaction, mowing and raking history, visual
bits, and recent-service days. Stable save IDs combine the hole prefix with the
fine-cell index.

Runtime-only topology groups active cells by surface and by existing coarse
cell. Tools update only a bounded brush around the real implement path. Dirty
rows drive localized terrain-overlay uploads, and coarse dirty cells drive
localized synchronization back into established turf arrays. There is no
individual-blade simulation, full-grid render update, or whole-region
percentage completion.

## Simulation bridge

Fine-to-coarse synchronization averages localized state into the existing turf
contract. Coarse-to-fine reconciliation imports later weather, staff, scenario,
or editor deltas without erasing one-yard deviations. A coarse shadow prevents
the two layers from repeatedly applying their own writes.

The condition score reads real fields and bounded issue collections. Its rating
modifier is consumed through the existing course-quality path, and the selected
green exposes a green-speed modifier. Small mistakes are clamped so maintenance
changes play quality without making golf impossible.

Hourly progression handles drying, fertilizer release, disease risk/recovery,
health response, and enabled sprinkler coverage. Daily progression handles
treatment duration, wear recovery, score updates, and coarse synchronization.
Long-absence health is bounded; tests advance 14 days and reload the result.

## Interaction and presentation

The normal first-person controller supplies player position, aim, held input,
equipment mount state, and mower path. The maintenance layer adds:

- a physical yard work board and a compact, toggleable tablet;
- one-yard inspection with plain-language causes and target values;
- push greens mower and tractor reel paths with blade state, overlap, missed
  patches, speed quality, stripes, clipping particles, and WebAudio loops;
- hose and sprinkler coverage, visible wetness, dry state, and overwatering;
- rotary-spreader and treatment-sprayer coverage with inventory and particles;
- staged divot repair, ball-mark repair, local bunker rake paths, debris
  collection, and bounded disease treatment;
- contextual issue geometry and halos that disappear or change after repair.

Authored equipment is loaded through the existing GLB path. Runtime batching
merges only non-pivot sibling meshes; wheels, reels, handles, and other moving
parts remain independently animatable. Shared materials/geometries, merged
vertex-colored debris clusters, and distance culling bound render cost.

## Persistence

The regular empire snapshot owns the maintenance payload. It includes every
fine field plus issues, inspection, route, inventory, equipment, irrigation,
work order, score/history, and time state. Static surface data carries both a
surface hash and a hash of the authored course layout.

On load, a matching layout restores directly from its saved surface mask and
builds runtime topology tile-by-tile. If the course or mask changed, loading
falls back to geometry-derived reconstruction and records a migration reason.
Older saves with no maintenance payload build a fresh region safely.

Broad agronomy fields use row-band RLE: repeated adjacent rows are referenced,
while unique rows decode directly into row-major typed arrays. Sparse fields use
ordinary RLE. Encoded fields are cached by a monotonically increasing save
revision; every agronomy mutation invalidates that cache even when it does not
cross a visible-state threshold.

## Scaling to more holes

The next extension can instantiate the same model per selected hole and keep
inactive holes coarse-only. The reusable seams are:

1. `selectHeroHole`/selection policy;
2. mask construction from hole corridor and course zones;
3. typed fine fields and save IDs;
4. fine/coarse reconciliation;
5. tool brush functions independent of hole number;
6. issue seeding and bounded visual pools;
7. renderer groups keyed by model identity;
8. snapshot/restore with layout migration.

Scaling should stream or activate a small number of regions rather than
materializing nine fine grids at once. The course editor remains the source of
authored geometry; changing it invalidates and safely rebuilds affected masks.
