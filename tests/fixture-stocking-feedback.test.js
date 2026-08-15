import test from 'node:test';
import assert from 'node:assert/strict';

import { incompatibleStockingLabel } from '../src/render3d/clubhouse/fixtures.js';

test('wrong stocking fixtures identify the product and its correct destination without a stock verb', () => {
  const label = incompatibleStockingLabel('Accessories', 'Range-rock dozen', 'Ball wall');
  assert.equal(
    label,
    'Accessories - Range-rock dozen cannot be stocked here · take it to Ball wall',
  );
  assert.doesNotMatch(label, /\[E\]|stock the/i);
});

test('wrong stocking fixture feedback retains a safe destination when layout data is unavailable', () => {
  assert.equal(
    incompatibleStockingLabel('Shoe wall', 'Ironwood stand bag'),
    'Shoe wall - Ironwood stand bag cannot be stocked here · take it to its assigned display',
  );
});
