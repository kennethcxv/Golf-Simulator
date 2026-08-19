# The club wall is on the wall opposite the desk

Item 3, **DONE**. Frames in `qa/clubwall/`, instrument
`tools/qa/club-wall-frame.js`, layout audit 21/21, `GATE_EXIT=0`.

## Where they are

Your placement: the **north wall**, opposite the south-wall desk at (3.30, 3.35)
whose customer side faces north, with the door on the entry axis at x -0.8.
Drivers nearest the door, putters nearest the desk -- the order a customer meets
them walking in. Confirmed in the live scene by `matrixWorld`, not by the numbers
I typed:

    Fixture_rack_drivers   world x -361.75
    Fixture_rack_irons     world x -360.00
    Fixture_rack_putters   world x -358.50

`qa/clubwall/01-door-clubs-and-desk.png` is the acceptance frame: standing just
inside the door, the club wall runs along the left with DRIVERS & WOODS, IRONS &
WEDGES and PUTTER STUDIO racked, and the front desk with the register is on the
right. **Clubs and desk in one frame**, which is the whole claim the placement
was chosen to make.

All twelve hero club materials are **drawn** -- `layers.mask` non-zero and every
ancestor visible, because batched props draw through the mask and a scene-graph
`visible` check measures geometry that never draws:

    DriverCrown DriverFace DriverShaft DriverGrip
    IronBody IronFace IronShaft IronGrip
    PutterBody PutterFace PutterShaft PutterGrip

## What it cost, and it is not what I expected

**Two things had to change, and one of them turned out to be a gain.**

**1. The racks are re-authored as slim towers, 1.50 x 0.60.** `FIXTURE_HALF.rack`
is [1.5, 0.45] -- **half**-extents -- so a stock rack is 3.0 yd wide and three
need 9.00. The north wall is 8.30, and the **LOUNGE owns everything east of
x 2.40** on it under a visible-from-the-door mandate the audit enforces (it
failed `door->chairA sightline crosses rack_putters` the moment a rack went
past). The retail run is 5.00 yd. Three towers at 1.50 sit at -1.80 / -0.10 /
1.60 with 0.20 between them and 0.05 clear of the lounge. `fixtureRect()` honours
an explicit footprint over `FIXTURE_HALF`, and that is THE definition -- the
collider, the layout tests, the browse sockets and the drawn geometry in
`fixtures.js` all read it -- so a slim rack is slim to every one at once.

**2. The fitting booth is cut, and the room got BETTER for it.** The booth used
2.2 of those 5.00 yd. I measured every alternative home against F1 (41 rays,
+-55 deg from the door eye, 80% of the empty-room distance, gate 60%):

| booth at | F1 |
|---|---|
| mid-floor east | 53.7% |
| flush to the east partition | 58.5% |
| west wall / beside the door | worse |
| **cut, club wall in place** | **73.2%** |

The booth was itself the biggest obstruction in the door's fan. Cutting it and
hanging three slim towers flat on the wall **raised** the D1 sightline the whole
v2 plan was designed to win. That was not the trade I predicted.

The booth joins the upgrade path exactly as shoerack, bagstand and the rest of
the cut list already do. **One line reverts it**: take `'fittingroom'` out of
`cutFixtures`. Asset 63 needed no other change -- it is already in
`FIXTURE_GATED_PROP_ASSETS`, so it hides while the fixture is uninstalled -- but
`runtimeManifest.js` read `fixturePose('fittingroom').x` at module load and would
have thrown on a variant that cuts it, so that lookup now falls back.

## Two honest notes on the frame

**The wall is underlit.** The room is lit -- ceiling panels on, architecture
restored -- but the club wall itself reads dark against it. That is the standing
`vertical-surfaces-unlit` defect (hung garments measured 1-6% against folded
30-44%, and six causes were ruled out by measurement: it is the room light, not
the asset). It is not something this placement introduced, and it is the next
thing worth fixing if you want this wall to sell clubs.

**The frame is staged, and here is exactly how.** The starter is a failing
municipal shop, so the driver pins the clock to 10:30, marks the architecture
restored and every ceiling panel working (the repair beat the player does), and
puts four of each club SKU on the shelf. The first pass without the lighting step
photographed a correctly built wall in the dark and the game's own HUD said why:
"the ceiling circuit is dead; repair the ceiling first." Shop condition still
reads *filthy* in the frame, which is the honest starter.

**The layout seam stands:** `pine-hills-v3` is presentation-only, so
pine-hills-v2 has these three racks too, drawn grey. There is no v3-only path
without splitting the seam CLAUDE.md protects.
