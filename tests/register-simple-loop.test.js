import test from 'node:test';
import assert from 'node:assert/strict';

import {
  bagScannedItem,
  createTx,
  requestPayment,
  scanItem,
} from '../src/sim/register.js';

const item = { uid: 'simple-loop-item', skuId: 'balls1', name: 'Golf balls', price: 24 };

test('one product click can durably ring and bag the same owned item', () => {
  const tx = createTx({ items: [item], prefer: 'card' });

  assert.equal(bagScannedItem(tx, item.uid).ok, false, 'bagging cannot precede ring-up');
  assert.equal(scanItem(tx, item.uid).ok, true);
  assert.equal(bagScannedItem(tx, item.uid).ok, true);
  assert.equal(tx.items[0].scanned, true);
  assert.equal(tx.items[0].bagged, true);
  assert.equal(scanItem(tx, item.uid).ok, false, 'the item cannot be charged twice');
  assert.equal(bagScannedItem(tx, item.uid).ok, false, 'the item cannot be bagged twice');
  assert.equal(requestPayment(tx).ok, true, 'the normal payment gate remains intact');
});

test('the combined ring-and-bag checkpoint survives JSON save and reload', () => {
  const tx = createTx({ items: [item], prefer: 'cash' });
  scanItem(tx, item.uid);
  bagScannedItem(tx, item.uid);

  const restored = JSON.parse(JSON.stringify(tx));
  assert.equal(restored.items[0].scanned, true);
  assert.equal(restored.items[0].bagged, true);
  assert.equal(requestPayment(restored).ok, true);
  assert.equal(restored.stage, 'cash-tender');
});
