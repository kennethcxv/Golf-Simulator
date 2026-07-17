import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizedFourFlaps,
  remainingTapeSegments,
  smoothDeliveryProgress,
  visibleContentsForBox,
} from '../src/render3d/clubhouse/deliveryBoxVisual.js';

test('legacy two-flap saves expand to four authored hinge poses without resealing', () => {
  assert.deepEqual(normalizedFourFlaps([1, 0.25]), [1, 0.25, 1, 0.25]);
  assert.deepEqual(normalizedFourFlaps([1, 1]), [1, 1, 1, 1]);
  assert.deepEqual(normalizedFourFlaps(null), [0, 0, 0, 0]);
});

test('authored four-flap progress is clamped and preserved', () => {
  assert.deepEqual(normalizedFourFlaps([-2, 0.2, 0.7, 4]), [0, 0.2, 0.7, 1]);
});

test('tape segments disappear monotonically along the cut path', () => {
  assert.equal(remainingTapeSegments(0, 10), 10);
  assert.equal(remainingTapeSegments(0.39, 10), 7);
  assert.equal(remainingTapeSegments(0.5, 10), 5);
  assert.equal(remainingTapeSegments(1, 10), 0);
});

test('contents are prebuilt but deplete in readable fullness levels', () => {
  const full = { qty: 8, initialQty: 8 };
  const threeQuarter = { qty: 6, initialQty: 8 };
  const half = { qty: 4, initialQty: 8 };
  const low = { qty: 1, initialQty: 8 };
  assert.equal(visibleContentsForBox(full, 8), 8);
  assert.equal(visibleContentsForBox(threeQuarter, 8), 6);
  assert.equal(visibleContentsForBox(half, 8), 4);
  assert.equal(visibleContentsForBox(low, 8), 1);
  assert.equal(visibleContentsForBox({ qty: 0, initialQty: 8 }, 8), 0);
  assert.equal(visibleContentsForBox({ qty: 6, initialQty: 6 }, 8), 6,
    'a six-unit case cannot render eight physical products');
});

test('visual easing has stable endpoints', () => {
  assert.equal(smoothDeliveryProgress(-1), 0);
  assert.equal(smoothDeliveryProgress(0), 0);
  assert.equal(smoothDeliveryProgress(1), 1);
  assert.equal(smoothDeliveryProgress(2), 1);
});
