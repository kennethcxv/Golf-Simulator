import test from 'node:test';
import assert from 'node:assert/strict';

import {
  placementPreviewOf,
  placementPreviewSignature,
} from '../src/render3d/clubhouse/registerPlacementPreview.js';

test('placement preview reports the physical POS state without inventing a transaction', () => {
  const customer = {
    name: 'Robin K.',
    checkoutPhase: 'placing',
    checkoutPlacement: { activeUid: 'u2' },
    cart: [
      { uid: 'u1', skuId: 'balls3', price: 47, placed: true },
      { uid: 'u2', skuId: 'glove1', price: 19, placed: false },
      { uid: 'u3', skuId: 'tees1', price: 6, placed: false },
    ],
  };

  assert.deepEqual(placementPreviewOf(customer), {
    customer: 'Robin K.',
    state: 'CustomerPlacingProducts',
    activeUid: 'u2',
    placedItems: 1,
    totalItems: 3,
    items: [
      { uid: 'u1', skuId: 'balls3', price: 47, placed: true },
      { uid: 'u2', skuId: 'glove1', price: 19, placed: false },
      { uid: 'u3', skuId: 'tees1', price: 6, placed: false },
    ],
  });
  assert.match(placementPreviewSignature(placementPreviewOf(customer)), /u2:glove1:0/);
  assert.equal('tx' in placementPreviewOf(customer), false);
});

test('placement preview is hidden outside sequential customer placement and deduplicates uids', () => {
  assert.equal(placementPreviewOf(null), null);
  assert.equal(placementPreviewOf({ checkoutPhase: 'waiting', cart: [] }), null);

  const preview = placementPreviewOf({
    checkoutPhase: 'placing',
    cart: [
      { uid: 'u1', skuId: 'balls1', placed: true },
      { uid: 'u1', skuId: 'balls1', placed: false },
    ],
  });
  assert.equal(preview.totalItems, 1);
  assert.equal(preview.placedItems, 1);
});

test('placement preview signature changes only when visible placement data changes', () => {
  const customer = {
    name: 'Casey L.',
    checkoutPhase: 'placing',
    checkoutPlacement: { activeUid: null },
    cart: [{ uid: 'u8', skuId: 'marker1', price: 8, placed: false }],
  };
  const before = placementPreviewSignature(placementPreviewOf(customer));
  customer.unrelatedAnimationPhase = 12.3;
  assert.equal(placementPreviewSignature(placementPreviewOf(customer)), before);
  customer.cart[0].placed = true;
  assert.notEqual(placementPreviewSignature(placementPreviewOf(customer)), before);
});
