// PLAYTEST 3, ITEM 6 — "THE CUSTOMER'S ITEMS MUST NOT TOUCH THE BAG."
//
// "When the customer puts goods down, they must never intersect or rest against
// the shopping bag. Not overlapping, not touching."
//
// Two words carry the whole test. NOT OVERLAPPING is an area check and NOT
// TOUCHING is a distance one, and a check that only measures overlap passes on
// a carton resting flush against the bag -- which is precisely the state being
// complained about. So this asserts a POSITIVE GAP.
//
// The measurement is on the layout's own numbers rather than on re-derived
// footprints: `catalogCheckoutLayout` reports `footprintW` per pose for exactly
// this reason, so a check grades the arithmetic the layout used instead of
// grading its own.
//
// WHY THIS FAILED BEFORE THE FIX, and it is not the gap being too small: the
// staging strip starts at register x -0.74 and the bagging footprint's right
// edge is -0.82, so 0.08 of clear counter was designed in. 2.2's ruling then
// distributed item CENTRES across the full span and let outer items OVERHANG,
// because the staging contract constrains centres and not extents. A 0.31-wide
// carton centred on the left end reaches 0.075 past the bag. The gap was real
// and the overhang ate it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogCheckoutLayout } from '../src/render3d/clubhouse/catalogProductVisual.js';
import { REGISTER, frontDeskLocalPoint } from '../src/data/shopLayout.js';
import { SHOP_CATALOG } from '../src/data/shopItems.js';
import { catalogProductVisual } from '../src/render3d/clubhouse/catalogProductVisual.js';

// The register rect and the poses are in two different frames, so the bag's edge
// has to be brought into the pose frame the same way the layout brings it. The
// layout exports nothing for that, so the comparison is done in REGISTER space
// by asking the layout for poses and converting back is not possible -- instead
// the check uses the layout's OWN keep-out contract: with a keep-out supplied,
// no pose's left edge may sit left of where the unconstrained layout would have
// put it, and the leftmost edge must move right by at least the overhang.
//
// Concretely and independently of frames: run the SAME items twice, once with
// the bag keep-out and once without, and require that the keep-out moved the
// leftmost edge to the right. That is a differential measurement, so it cannot
// be satisfied by a layout that ignores the parameter -- which is the failure
// mode a single-run assertion would sail straight past.
// IN THE PACKER'S OWN FRAME, not the pose frame. `frontDeskPose` is mirrored
// with respect to local x, so `pose.x - w/2` is not the bag-side edge at all --
// it is the far edge, and an earlier version of this test read it as the near
// one and reported the fix as making things worse. `localMinX` is the bag-side
// edge as the layout computed it.
function bagSideEdge(poses) {
  let best = Infinity;
  for (const pose of poses) {
    if (!pose || !Number.isFinite(pose.localMinX)) continue;
    best = Math.min(best, pose.localMinX);
  }
  return best;
}

// THE COMPACT GOODS, AND THIS IS THE TRAP THIS FILE ALMOST FELL INTO.
//
// `catalogCheckoutLayout` has two paths. Items whose descriptor says
// `separateHandoff` go down the OVERSIZE branch, which poses them by hand and
// reports no `footprintW` at all; only the compact branch runs the packer this
// test is about. `SHOP_CATALOG.slice(0, 3)` is all oversize, so the first
// version of this measured nothing and said so ("no footprints to measure") --
// which is the same shape as probe lie 8 in the Goal 26 report, where sorting
// the catalogue by area put shop DECOR first and graded the stacking path
// instead of the side-by-side packing.
//
// Widest first, because the widest item is the one whose overhang reaches the
// bag; a test built from tee pouches would pass on a layout that never clears
// anything.
const COMPACT = SHOP_CATALOG
  .map((sku) => ({ sku, d: catalogProductVisual(sku) }))
  .filter((row) => row.d && !row.d.separateHandoff && Array.isArray(row.d.size))
  .sort((a, b) => (b.d.size[0] || 0) - (a.d.size[0] || 0));

function bulkySkus(n) {
  assert.ok(COMPACT.length >= n, `the catalogue has too few compact goods for ${n}`);
  return COMPACT.slice(0, n).map((row) => ({ sku: row.sku }));
}

test('the bag keep-out actually moves the goods (control: without it, they do not move)', () => {
  const items = bulkySkus(3);
  const without = catalogCheckoutLayout(items, REGISTER.staging, 1.0, null);
  const with_ = catalogCheckoutLayout(items, REGISTER.staging, 1.0, REGISTER.bagging);

  const a = bagSideEdge(without);
  const b = bagSideEdge(with_);
  assert.ok(Number.isFinite(a), 'the layout reported no footprints to measure');
  assert.ok(Number.isFinite(b), 'the layout reported no footprints to measure');

  // THE CONTROL, and it is the half that catches a keep-out that is wired but
  // inert: passing the rect must CHANGE the answer. A layout that ignores the
  // parameter returns the same numbers twice, and "the goods clear the bag"
  // would then be true only because the assertion was measuring nothing.
  assert.ok(b > a,
    `the keep-out did not move anything: bag-side edge ${a.toFixed(4)} -> ${b.toFixed(4)}`);
});

test('no item is placed left of the bag keep-out', () => {
  // Every count the counter actually sees, because the packer changes shape with
  // the row length and a single count would test one branch of it.
  for (let n = 1; n <= 6; n += 1) {
    const items = bulkySkus(n);
    const poses = catalogCheckoutLayout(items, REGISTER.staging, 1.0, REGISTER.bagging);
    const withoutKeepOut = catalogCheckoutLayout(items, REGISTER.staging, 1.0, null);
    const floor = bagSideEdge(withoutKeepOut);
    const edge = bagSideEdge(poses);
    assert.ok(Number.isFinite(edge), `no footprints reported at ${n} items`);
    // never further left than the unconstrained layout, at any count
    assert.ok(edge >= floor - 1e-9,
      `${n} items: the keep-out pushed goods TOWARD the bag (${edge.toFixed(4)} < ${floor.toFixed(4)})`);
  }
});

test('every item clears the bag by a POSITIVE gap, at every count', () => {
  // The clause is "not overlapping, NOT TOUCHING", so the bar is a gap greater
  // than zero rather than an overlap of zero. A flush rest passes an overlap
  // test and is exactly the state being complained about.
  const corners = [
    frontDeskLocalPoint(REGISTER.bagging.minX, REGISTER.bagging.minZ),
    frontDeskLocalPoint(REGISTER.bagging.minX, REGISTER.bagging.maxZ),
    frontDeskLocalPoint(REGISTER.bagging.maxX, REGISTER.bagging.minZ),
    frontDeskLocalPoint(REGISTER.bagging.maxX, REGISTER.bagging.maxZ),
  ];
  const bagEdge = Math.max(...corners.map((point) => point.x));
  for (let n = 1; n <= 6; n += 1) {
    const poses = catalogCheckoutLayout(bulkySkus(n), REGISTER.staging, 1.0, REGISTER.bagging)
      .filter((pose) => pose && Number.isFinite(pose.localMinX));
    assert.ok(poses.length, `no compact poses at ${n} items`);
    for (const pose of poses) {
      const gap = pose.localMinX - bagEdge;
      assert.ok(gap > 0,
        `${n} items: an item reaches the bag -- its edge is at ${pose.localMinX.toFixed(4)} `
        + `and the bag ends at ${bagEdge.toFixed(4)} (gap ${gap.toFixed(4)})`);
    }
  }
});

test('goods still do not overlap each other once the bag pushes them right', () => {
  // The keep-out narrows the span, and a narrower span is exactly where 2.2's
  // non-overlap guarantee would break if the fit test had not been narrowed with
  // it. Same adjacent-pair rule 2.2 uses, on the layout's own reported widths.
  for (let n = 2; n <= 6; n += 1) {
    const items = bulkySkus(n);
    const poses = catalogCheckoutLayout(items, REGISTER.staging, 1.0, REGISTER.bagging)
      .filter((p) => p && Number.isFinite(p.footprintW));
    const byLayer = new Map();
    for (const pose of poses) {
      const layer = pose.layer ?? 0;
      if (!byLayer.has(layer)) byLayer.set(layer, []);
      byLayer.get(layer).push(pose);
    }
    for (const [layer, row] of byLayer) {
      row.sort((p, q) => p.x - q.x);
      for (let i = 0; i + 1 < row.length; i += 1) {
        const gap = (row[i + 1].x - row[i].x)
          - (row[i].footprintW + row[i + 1].footprintW) / 2;
        assert.ok(gap > -1e-6,
          `${n} items, layer ${layer}: two goods overlap by ${(-gap).toFixed(4)} after the bag keep-out`);
      }
    }
  }
});
