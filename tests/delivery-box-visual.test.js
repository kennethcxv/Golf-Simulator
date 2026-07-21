import test from 'node:test';
import assert from 'node:assert/strict';

import {
  deliveryPackingComponentRole,
  deliveryPackingComponentVisible,
  normalizedFourFlaps,
  remainingTapeSegments,
  smoothDeliveryProgress,
  visibleContentsForBox,
} from '../src/render3d/clubhouse/deliveryBoxVisual.js';

test('empty open cartons retain only the permanent bottom insert until flattening', () => {
  assert.equal(deliveryPackingComponentRole('INSERT_BOTTOM'), 'permanent');
  assert.equal(deliveryPackingComponentRole('UNNAMED_BED', { persists_when_empty: true }), 'permanent',
    'authored persistence metadata wins over naming conventions');
  assert.equal(deliveryPackingComponentRole('INSERT_BOTTOM', { persists_when_empty: false }), 'disposable',
    'an explicit removable insert does not survive the final unit');
  assert.equal(deliveryPackingComponentRole('CUSTOM_PACKER', { packing_role: 'moulded_cradle' }), 'disposable',
    'authored packing_role marks otherwise unnamed packing for cleanup');
  assert.equal(deliveryPackingComponentRole('INSERT_DIVIDER_LONG'), 'disposable');
  assert.equal(deliveryPackingComponentRole('DIVIDER_CROSS'), 'disposable');
  assert.equal(deliveryPackingComponentRole('TISSUE_BASE'), 'disposable');
  assert.equal(deliveryPackingComponentRole('BAG_FOAM_BLOCK_01'), 'disposable');
  assert.equal(deliveryPackingComponentRole('LONG_PRODUCT_SUPPORT_02'), 'disposable');
  assert.equal(deliveryPackingComponentRole('FREIGHT_CORNER_BLOCK_01'), 'disposable');
  assert.equal(deliveryPackingComponentRole('CORNER_PAD_L_F'), 'disposable');
  assert.equal(deliveryPackingComponentRole('END_PADDING_LEFT'), 'disposable');
  assert.equal(deliveryPackingComponentRole('BASE_LINER'), 'disposable');
  assert.equal(deliveryPackingComponentRole('BASE_REINFORCEMENT_+0005'), 'disposable');
  assert.equal(deliveryPackingComponentRole('BOX_WALL_FRONT'), null);

  assert.equal(deliveryPackingComponentVisible('permanent', true, 0, 0), true,
    'the empty open carton still shows its bottom insert');
  assert.equal(deliveryPackingComponentVisible('disposable', true, 0, 0), false,
    'tissue and dividers leave with the final product');
  assert.equal(deliveryPackingComponentVisible('disposable', true, 1, 0), true);
  assert.equal(deliveryPackingComponentVisible('permanent', false, 0, 0), false,
    'the insert stays hidden while the carton is sealed');
  assert.equal(deliveryPackingComponentVisible('permanent', true, 0, 0.46), false,
    'the compact flat bundle takes over at the flatten handoff');
});

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
