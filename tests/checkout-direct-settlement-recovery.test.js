import test from 'node:test';
import assert from 'node:assert/strict';

import { checkoutSale, pickFromShelf } from '../src/sim/checkout.js';
import { inventoryPosition } from '../src/sim/inventoryLifecycle.js';
import { deserialize, newGame, serialize } from '../src/sim/state.js';

const round2 = (value) => Math.round(Number(value) * 100) / 100;

function rowsFor(state, id) {
  const key = (suffix) => `checkout:${id}:${suffix}`;
  return {
    sale: state.ledger.entries.filter((entry) => entry.idempotencyKey === key('sale')),
    tax: state.ledger.entries.filter((entry) => entry.idempotencyKey === key('salestax')),
    cogs: state.ledger.entries.filter((entry) => entry.idempotencyKey === key('cogs')),
    outcomes: state.ledger.outcomes.filter((outcome) => outcome.idempotencyKey === key('completed')),
    tickets: state.shop.transactionHistory.filter((ticket) => ticket.transactionId === id),
  };
}

function coreSnapshot(state, skuIds) {
  return {
    cash: state.cash,
    held: structuredClone(state.shop.held),
    positions: Object.fromEntries(skuIds.map((skuId) => [
      skuId,
      inventoryPosition(state, skuId),
    ])),
    entries: structuredClone(state.ledger.entries),
    processedIds: structuredClone(state.ledger.processedIds),
    salesLive: structuredClone(state.shop.salesLive || { units: 0, revenue: 0 }),
    salesToday: structuredClone(state.shop.salesToday || {}),
    salesTax: structuredClone(state.salesTax),
  };
}

test('exported checkoutSale resumes after inventory moves but before any books post', () => {
  const state = newGame('relaxed', 26000);
  const id = 'direct-wal-after-inventory';
  const item = { uid: 'direct-wal-inventory-unit', skuId: 'balls1', price: 15 };
  assert.equal(pickFromShelf(state, item.skuId, item.uid).ok, true);
  const opening = coreSnapshot(state, ['balls1']);

  assert.throws(() => checkoutSale(state, [item], 'Inventory Fault Golfer', id, {
    taxRate: 0.07,
    qaFaultAfterInventory() {
      throw new Error('direct checkout interrupted after inventory');
    },
  }), /direct checkout interrupted after inventory/);

  assert.deepEqual(Object.keys(state.shop.pendingCheckouts), [`checkout:${id}`]);
  assert.equal(inventoryPosition(state, item.skuId).sold, opening.positions.balls1.sold + 1);
  assert.equal(state.shop.held.some((held) => held.uid === item.uid), false);
  assert.equal(state.cash, opening.cash, 'books have not received sale or tax cash yet');
  assert.equal(state.shop.salesLive?.units || 0, opening.salesLive.units);
  assert.equal(state.shop.salesLive?.revenue || 0, opening.salesLive.revenue);
  assert.deepEqual(state.shop.salesToday || {}, opening.salesToday);
  assert.deepEqual(state.salesTax, opening.salesTax);
  const torn = rowsFor(state, id);
  assert.equal(torn.sale.length, 0);
  assert.equal(torn.tax.length, 0);
  assert.equal(torn.cogs.length, 0);
  assert.equal(torn.outcomes.length, 0);
  assert.equal(torn.tickets.length, 0);

  const recovered = checkoutSale(state, [item], 'Inventory Fault Golfer', id, { taxRate: 0.07 });
  assert.equal(recovered.ok, true, recovered.reason);
  assert.equal(recovered.recovered, true);
  assert.deepEqual(Object.keys(state.shop.pendingCheckouts), []);
  const complete = rowsFor(state, id);
  assert.equal(complete.sale.length, 1);
  assert.equal(complete.tax.length, 1);
  assert.equal(complete.cogs.length, 1);
  assert.equal(complete.outcomes.length, 1);
  assert.equal(complete.tickets.length, 1);
  assert.equal(inventoryPosition(state, item.skuId).sold, opening.positions.balls1.sold + 1,
    'inventory is not moved a second time during reconciliation');
  assert.equal(round2(state.cash), round2(opening.cash + 16.05));
  assert.equal(state.shop.salesLive.units, opening.salesLive.units + 1);
  assert.equal(state.shop.salesLive.revenue, round2(opening.salesLive.revenue + 15));
  assert.equal(state.salesTax.collected, round2(opening.salesTax.collected + 1.05));
});

test('exported checkoutSale retries a post-core interruption through one durable settlement', () => {
  const state = newGame('relaxed', 26001);
  const id = 'direct-wal-post-core';
  const items = [
    { uid: 'direct-wal-ball', skuId: 'balls1', price: 15 },
    { uid: 'direct-wal-glove', skuId: 'glove1', price: 19 },
  ];
  for (const item of items) assert.equal(pickFromShelf(state, item.skuId, item.uid).ok, true);
  const opening = coreSnapshot(state, ['balls1', 'glove1']);

  assert.throws(() => checkoutSale(state, items, 'Durable Direct Golfer', id, {
    taxRate: 0.07,
    qaFaultAfterCoreCommit() {
      throw new Error('direct checkout interrupted after core');
    },
  }), /direct checkout interrupted after core/);

  assert.deepEqual(Object.keys(state.shop.pendingCheckouts), [`checkout:${id}`]);
  const torn = rowsFor(state, id);
  assert.equal(torn.sale.length, 1, 'sale revenue reached its idempotent ledger checkpoint');
  assert.equal(torn.tax.length, 1, 'tax cash reached its idempotent ledger checkpoint');
  assert.equal(torn.cogs.length, 1, 'COGS reached its idempotent ledger checkpoint');
  assert.equal(torn.outcomes.length, 0, 'the injected interruption precedes outcome publication');
  assert.equal(torn.tickets.length, 0, 'the injected interruption precedes ticket publication');
  assert.equal(inventoryPosition(state, 'balls1').sold, opening.positions.balls1.sold + 1);
  assert.equal(inventoryPosition(state, 'glove1').sold, opening.positions.glove1.sold + 1);
  assert.equal(state.shop.salesLive.units, opening.salesLive.units + 2);
  assert.equal(state.shop.salesLive.revenue, round2(opening.salesLive.revenue + 34));
  assert.equal(state.salesTax.collected, round2(opening.salesTax.collected + 2.38));
  const coreAfterFault = coreSnapshot(state, ['balls1', 'glove1']);

  const recovered = checkoutSale(state, items, 'Durable Direct Golfer', id, { taxRate: 0.07 });
  assert.equal(recovered.ok, true, recovered.reason);
  assert.equal(recovered.recovered, true);
  assert.equal(recovered.transactionId, id);
  assert.equal(recovered.net, 34);
  assert.equal(recovered.tax, 2.38);
  assert.equal(recovered.total, 36.38);
  assert.deepEqual(Object.keys(state.shop.pendingCheckouts), []);
  assert.deepEqual(coreSnapshot(state, ['balls1', 'glove1']), coreAfterFault,
    'retry publishes only the missing durable tails and never replays core authority');

  const complete = rowsFor(state, id);
  assert.equal(complete.sale.length, 1);
  assert.equal(complete.tax.length, 1);
  assert.equal(complete.cogs.length, 1);
  assert.equal(complete.outcomes.length, 1);
  assert.equal(complete.tickets.length, 1);

  const beforeDuplicate = structuredClone(state);
  const duplicate = checkoutSale(state, items, 'Durable Direct Golfer', id, { taxRate: 0.07 });
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.duplicate, true);
  assert.deepEqual(state, beforeDuplicate, 'an explicit completed identity is a read-only duplicate');
});

test('generated checkoutSale recovers after save/load, advances its cursor, and permits the next sale', () => {
  const state = newGame('relaxed', 26002);
  const firstItems = [{ uid: 'generated-wal-ball', skuId: 'balls1', price: 15 }];
  assert.equal(pickFromShelf(state, 'balls1', firstItems[0].uid).ok, true);
  const propertyId = state.property?.id || `club-${state.seed}`;
  const firstId = `${propertyId}:legacy-register-1`;

  assert.throws(() => checkoutSale(state, firstItems, 'Generated WAL Golfer', null, {
    taxRate: 0.07,
    qaFaultAfterCoreCommit() {
      throw new Error('save generated checkout after core');
    },
  }), /save generated checkout after core/);
  assert.deepEqual(Object.keys(state.shop.pendingCheckouts), [`checkout:${firstId}`]);

  // serialize() deliberately drains the durable settlement before writing. It
  // does not need the convenience generated-ID cursor to finish the sale.
  const loaded = deserialize(serialize(state));
  assert.deepEqual(Object.keys(loaded.shop.pendingCheckouts), []);
  assert.equal(rowsFor(loaded, firstId).sale.length, 1);
  assert.equal(rowsFor(loaded, firstId).tax.length, 1);
  assert.equal(rowsFor(loaded, firstId).cogs.length, 1);
  assert.equal(rowsFor(loaded, firstId).outcomes.length, 1);
  assert.equal(rowsFor(loaded, firstId).tickets.length, 1);
  assert.equal(loaded.shop.nextTransactionId, 1,
    'the caller-owned convenience cursor can lag the recovered durable ticket');
  const firstCore = coreSnapshot(loaded, ['balls1']);
  const secondItem = { uid: 'generated-wal-next-ball', skuId: 'balls1', price: 16 };
  assert.equal(pickFromShelf(loaded, secondItem.skuId, secondItem.uid).ok, true);
  const second = checkoutSale(loaded, [secondItem], 'Next Generated Golfer', null, { taxRate: 0.07 });
  assert.equal(second.ok, true, second.reason);
  assert.equal(second.transactionId, `${propertyId}:legacy-register-2`);
  assert.equal(loaded.shop.nextTransactionId, 3);
  assert.equal(rowsFor(loaded, firstId).sale.length, 1);
  assert.equal(rowsFor(loaded, firstId).tax.length, 1);
  assert.equal(rowsFor(loaded, firstId).cogs.length, 1);
  assert.equal(rowsFor(loaded, firstId).outcomes.length, 1);
  assert.equal(rowsFor(loaded, firstId).tickets.length, 1);

  const beforeOldRetry = coreSnapshot(loaded, ['balls1']);
  const oldRetry = checkoutSale(
    loaded,
    firstItems,
    'Generated WAL Golfer',
    firstId,
    { taxRate: 0.07 },
  );
  assert.equal(oldRetry.ok, false);
  assert.equal(oldRetry.duplicate, true);
  assert.deepEqual(coreSnapshot(loaded, ['balls1']), beforeOldRetry,
    'an old explicit identity cannot rebank a generated recovered sale');
  assert.notDeepEqual(beforeOldRetry, firstCore,
    'the new generated sale is independent of the recovered first sale');
});

test('a forged direct ticket without settlement authority cannot report recovered success', () => {
  const state = newGame('relaxed', 26003);
  const id = 'forged-direct-ticket';
  const item = { uid: 'forged-direct-unit', skuId: 'balls1', price: 15 };
  assert.equal(pickFromShelf(state, item.skuId, item.uid).ok, true);
  state.shop.transactionHistory.unshift({
    checkoutKind: 'direct',
    generatedTransactionId: false,
    number: 41,
    transactionId: id,
    customer: 'Forged Direct Golfer',
    method: 'card',
    total: 16.05,
    net: 15,
    tax: 1.05,
    taxRate: 0.07,
    cash: 16.05,
    lost: 0,
    items: [{ ...item, name: 'Range-rock dozen' }],
    ledgerEntryIds: { sale: 'bogus-sale-row' },
    ledgerIdempotencyKeys: { sale: `checkout:${id}:sale` },
    minute: state.clock.minutes,
  });
  const before = structuredClone(state);

  const refused = checkoutSale(
    state,
    [item],
    'Forged Direct Golfer',
    id,
    { taxRate: 0.07 },
  );
  assert.equal(refused.ok, false);
  assert.equal(refused.duplicate, true);
  assert.notEqual(refused.recovered, true);
  assert.deepEqual(state, before,
    'a ticket projection alone cannot move or claim any settlement authority');
});
