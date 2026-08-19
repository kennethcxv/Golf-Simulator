# The club wall: I tried to place it, and the room says booth-or-clubs

Item 3. **The racks are not placed.** Not because the wall was misread — it was
read right — but because building it turned up a hard trade that is yours, not
mine. Everything below is measured against the real layout audit
(`tests/pine-hills-v2-layout.test.js`, 21 checks), not reasoned about.

## The wall is right

The desk is a south-wall counter at (3.30, 3.35) whose customer side faces
north; the door is on the entry axis at x −0.8. So the wall opposite it is the
**north wall**, and your framing holds: walk in, clubs ahead, desk to the right.

## Four things the room said when I built it

**1. A stock rack is 3.0 yd wide, not 1.5.** `FIXTURE_HALF.rack = [1.5, 0.45]`
is **half**-extents. Three need **9.00 yd**; the north wall is **8.30**.

**2. The lounge owns the east third of that wall.** `LOUNGE.bounds` is
x 2.40 → 5.70, under a mandate to stay visible from the door — and the audit
proved it, failing `door→chairA sightline crosses rack_putters` the moment a
rack went east of 2.40. **The retail run on that wall is 5.00 yd, not 8.30.**

**3. Slim towers do fit.** Re-authored at **1.50 × 0.90** via an explicit
`footprint` (which `fixtureRect` honours over `FIXTURE_HALF`, and which the
collider, the browse sockets, the layout tests and the drawn geometry in
`fixtures.js` all read, so it is narrow to every one of them at once), three
racks sit at x −1.80 / −0.10 / 1.60 with 0.20 between them and 0.05 clear of the
lounge. **Envelope, overlap and lounge-sightline checks all passed.** Three
narrow towers is also the honest read of a municipal starter's club wall.

**4. And then the fitting booth has nowhere to go.** The booth is 2.2 × 1.7 and
currently occupies x −1.45 → 0.75 of that same 5.00 yd run. Every alternative
home I measured costs the **F1 door sightline** — the metric the whole D1 floor
plan was designed to win, 41 rays fanned ±55° from the door eye, gate at 60%:

| booth at | F1 |
|---|---|
| its proven north-wall spot, no racks | **passes** |
| mid-floor east (3.60, 0.70) | **53.7%** |
| flush to the east partition (4.55, 0.60) | **58.5%** |
| west wall, north end | worse — it lands straight ahead of the door |
| beside the door, south wall | worse — it is closest to the eye, so it eats whole rays |

58.5% was also what the *first* attempt gave with full-width racks, so the racks
themselves cost about 1.5 points and **the booth is the rest of it**. There is no
spot in a 70 m² room for a 2.05 m booth that is both out of the door's fan and
off the one wall the clubs need.

## So it is booth or clubs, and that is yours

- **Clubs.** Cut `fittingroom` from v2 the way the cut list already trades
  shoerack, bagstand and the rest to the upgrade path. Three slim racks land on
  your wall and every gate stays green. Cost: no fitting booth in the starter,
  and `runtimeManifest.js` reads `fixturePose('fittingroom')` at module load, so
  that call needs a guard first.
- **Booth.** Keep it where it is and the wall holds **one** rack (x 0.75 → 2.40
  is 1.65 yd). Putters or drivers, not the set.
- **Both, smaller.** Two slim racks fit beside the booth only if the booth also
  narrows, which is a change to an authored analytic hull.

Say which and it is a short session's work. The layout is reverted and the audit
is 21/21.

## One thing that is true whichever you pick

`pine-hills-v3` is presentation-only — `CLUBHOUSE_LAYOUT_VARIANT` resolves it to
`pine-hills-v2` — so **the layout is shared**. Placing clubs for the photograph
places them in pine-hills-v2 too, drawn grey. There is no v3-only path without
splitting the seam CLAUDE.md protects, and no lit frame of the clubs can exist
until the placement is real.
