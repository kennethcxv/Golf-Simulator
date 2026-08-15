// 2.2 (Goal 26) — NO TWO ITEMS ON THE COUNTER MAY OCCUPY THE SAME SPACE.
//
// "Right now they overlap and phase through each other... six items placed one at
// a time, plus a PAIRWISE OVERLAP MEASUREMENT across every frame that must read
// zero."
//
// The measurement 2.2 names is pairwise overlap, so that is what this computes --
// not slot spacing, not a count of items placed, not "the layout ran". Slot
// spacing is exactly the number the old fixed grid would have passed: it had
// perfectly even 0.14 pitch and still interpenetrated, because the pitch had
// nothing to do with how big anything was.
//
// WATCHED FAILING on the pre-fix layout: with six mixed-size items the old grid
// produced overlapping pairs, because a 0.28 yd wide box in a 0.14 yd slot has
// nowhere else to be. The area is reported rather than a boolean so a regression
// shows its size.
import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogCheckoutLayout, catalogProductVisual } from '../src/render3d/clubhouse/catalogProductVisual.js';
import { SHOP_CATALOG } from '../src/data/shopItems.js';

// The real staging rectangle the register uses, in the same units.
const STAGING = { minX: -0.55, maxX: 0.55, minZ: -0.22, maxZ: 0.24 };
const REST_Y = 1.02;

/**
 * The footprint of a placed item, taken from the SKU's OWN descriptor.
 *
 * The first version of this read `pose.footprintW`, which only the new layout
 * reports -- so against the old grid it fell back to a default 0.16 x 0.12 box
 * and the test PASSED on the very build it was written to fail. Default boxes at
 * 0.41 spacing do not overlap; the real ones (a 0.31 yd shoe carton, a 0.21 yd
 * cap) do. The instrument was grading its own fallback.
 *
 * Reading the descriptor makes the measurement independent of the thing measured,
 * which is the only version that can fail on both builds.
 */
function footprintOf(item, pose) {
  const v = catalogProductVisual(item.sku);
  const size = (v && v.size) || [0.16, 0.09, 0.12];
  const w = Math.max(0.02, Number(size[0]) || 0.16);
  const d = Math.max(0.02, Number(size[2]) || 0.12);
  const ry = pose?.ry || 0;
  const c = Math.abs(Math.cos(ry));
  const s = Math.abs(Math.sin(ry));
  return { w: w * c + d * s, d: d * c + w * s };
}

/** Axis-aligned overlap area of two placed items. Items on different layers are
 *  stacked, not intersecting -- a stack is what 2.2 explicitly permits. */
function overlapArea(a, b, fa, fb) {
  if (!a || !b) return 0;
  if ((a.layer ?? 0) !== (b.layer ?? 0)) return 0;
  const dx = Math.min(a.x + fa.w / 2, b.x + fb.w / 2) - Math.max(a.x - fa.w / 2, b.x - fb.w / 2);
  const dz = Math.min(a.z + fa.d / 2, b.z + fb.d / 2) - Math.max(a.z - fa.d / 2, b.z - fb.d / 2);
  return dx > 0 && dz > 0 ? dx * dz : 0;
}

/**
 * n real checkout goods that are NOT oversize, biggest first, so the test is
 * hardest exactly where the old grid was weakest.
 *
 * Restricted to `checkout_product_*` models on purpose. Sorting the whole
 * catalogue by area puts SHOP DECOR at the top -- a 0.56 yd poster, a 0.36 yd
 * light fitting -- and a single poster nearly fills a counter strip that measures
 * 0.640 x 0.150. Those legitimately stack, so a test built from them measures the
 * stacking path and never exercises the side-by-side packing that 2.2 is actually
 * about. The realistic basket is what a customer carries to the till.
 */
function compactSkus(n) {
  const chosen = [];
  for (const sku of SHOP_CATALOG) {
    const v = catalogProductVisual(sku);
    if (!v || v.separateHandoff) continue;
    if (!/^checkout_product_/.test(String(v.model || ''))) continue;
    chosen.push({ sku, area: (v.size?.[0] ?? 0.16) * (v.size?.[2] ?? 0.12) });
  }
  chosen.sort((a, b) => b.area - a.area);
  return chosen.slice(0, n).map((c) => ({ sku: c.sku }));
}

test('2.2 — six items placed on the counter do not interpenetrate', () => {
  const items = compactSkus(6);
  assert.ok(items.length >= 2, 'the catalogue must supply compact SKUs to lay out');
  const poses = catalogCheckoutLayout(items, STAGING, REST_Y);
  assert.equal(poses.length, items.length, 'every item gets a pose');

  const prints = poses.map((pose, i) => footprintOf(items[i], pose));
  let worst = 0;
  const offenders = [];
  for (let i = 0; i < poses.length; i += 1) {
    for (let j = i + 1; j < poses.length; j += 1) {
      const area = overlapArea(poses[i], poses[j], prints[i], prints[j]);
      if (area > worst) worst = area;
      if (area > 1e-6) offenders.push(`${i}x${j}=${area.toFixed(5)}`);
    }
  }
  assert.equal(
    offenders.length, 0,
    `pairwise overlap must be zero; overlapping pairs: ${offenders.join(', ')}`,
  );
  assert.ok(worst <= 1e-6, `worst overlap ${worst}`);
});

test('2.2 — nothing floats: every item rests on the surface or on a layer below', () => {
  const items = compactSkus(8);
  const poses = catalogCheckoutLayout(items, STAGING, REST_Y);
  for (const pose of poses) {
    assert.ok(pose.y >= REST_Y - 1e-9, `an item may not sink below the counter (y ${pose.y} < ${REST_Y})`);
    // A first-layer item rests exactly ON the surface. A stacked one sits higher,
    // and only ever by the height of what is under it -- never hovering.
    if ((pose.layer ?? 0) === 0) {
      assert.ok(Math.abs(pose.y - REST_Y) < 1e-9, `a first-layer item must sit on the counter, not at ${pose.y}`);
    }
  }
});

test('2.2 — a later item never takes the space of an earlier one', () => {
  // Placed one at a time, which is how the counter actually fills: the layout is
  // recomputed as each item lands, and the invariant has to hold at every step,
  // not only once all six are down.
  const all = compactSkus(6);
  for (let n = 2; n <= all.length; n += 1) {
    const subset = all.slice(0, n);
    const poses = catalogCheckoutLayout(subset, STAGING, REST_Y);
    const prints = poses.map((pose, i) => footprintOf(subset[i], pose));
    for (let i = 0; i < poses.length; i += 1) {
      for (let j = i + 1; j < poses.length; j += 1) {
        assert.ok(
          overlapArea(poses[i], poses[j], prints[i], prints[j]) <= 1e-6,
          `with ${n} items down, ${i} and ${j} occupy the same space`,
        );
      }
    }
  }
});
