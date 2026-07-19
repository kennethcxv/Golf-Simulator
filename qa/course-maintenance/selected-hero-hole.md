# Selected hero hole

## Decision

Hole 4 at Willow Creek Municipal is the course-maintenance vertical slice.

- Par 5, 482 yards
- Tee at course cell (44, 8)
- Pin at course cell (104, 14)
- Full tee, fairway, rough, green, and greenside-bunker context
- The pond is 11 coarse cells (88 yards) from the play corridor and is visible
  in the approach-complex overview
- The longest uninterrupted fairway on the existing nine, giving mowing paths,
  overlap, misses, and alternating stripes enough distance to read
- Tractor travel from the maintenance yard is meaningful without requiring a
  new course route or a redesign of the other eight holes

The system will store this choice as a heroHoleId in data. Surface membership
will come from a generated region mask around the selected hole, not from
Hole-4-specific branches in tools or simulation code.

## Nine-hole inspection

All holes were inspected in the running game at 1600x900, DPR 1, on the fixed
Willow Creek fixture (empire seed 20260719, property seed 872962804).

| Hole | Length | Bunker | Water context | Equipment distance | Maintenance-readiness |
| --- | ---: | --- | ---: | ---: | --- |
| 1 | 276 yd | Yes | 59.2 cells | 11.0 cells | Excellent access and debris, no useful water context |
| 2 | 129 yd | Nearby/associated | 90.0 cells | 48.7 cells | Disease present, but short and visually crowded |
| 3 | 266 yd | Yes | 66.5 cells | 63.6 cells | Strong bunker/debris work, weak irrigation story |
| 4 | 482 yd | Yes | 11.0 cells | 62.3 cells | Best full-surface mowing canvas and visible pond context |
| 5 | 129 yd | No | In play | 68.9 cells | Best water context, but no bunker and too little mowing |
| 6 | 273 yd | Yes | 11.4 cells | 50.5 cells | Strong runner-up; pond is not visually part of the hole |
| 7 | 435 yd | Yes | 49.2 cells | 9.9 cells | Excellent access and length, weak irrigation context |
| 8 | 116 yd | No | 93.2 cells | 51.1 cells | Disease present, but lacks bunker and mowing depth |
| 9 | 275 yd | Yes | 60.1 cells | 34.1 cells | Disease/debris and home-hole access, no water context |

Distances are from the existing course grid analysis. The player-camera review
is preserved in [baseline/holes/](baseline/holes/), and the full fly-through
is [baseline/walkthrough.webm](baseline/walkthrough.webm).

## Baseline Hole 4 condition

The current coarse simulation reports:

| Surface | Health | Moisture | Nutrients | Height | Wear | Condition |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Main fairway | 52 | 42 | 44 | 22.1 mm | 10 | 44 |
| Tee | 58 | 46 | 45 | 15.8 mm | 33 | 44 |
| Green | 57 | 44 | 35 | 5.8 mm | 16 | 52 |
| Bunker | n/a | n/a | n/a | n/a | 0 | Not scored |

The fairway target is 14 mm, the tee target is 10 mm, and the green target is
4 mm. These real starting gaps support a visible restoration without inventing
a disconnected percentage task.

## Visible baseline weaknesses

- Tool writes are one 8-yard course cell at a time, so paths cannot follow an
  implement at believable resolution.
- Existing mowing stripes come from a section policy, not the path the mower
  actually drove.
- Turf wear is a generic tint; divots and ball marks are not discrete repair
  targets.
- Fertilizer and fungicide are whole-section UI buttons.
- Bunker wear has no localized footprint or persistent rake-line presentation.
- The giant tee-number sign obscures much of the player camera at the tee.
- Morning sun blows out the left half of the Hole 4 tee view.
- The current score is course-wide and does not explain Hole 4 category changes.

Only hero-hole presentation and maintenance feedback will be changed. The
nine-hole routing, course editor, and global visual redesign remain out of
scope.
