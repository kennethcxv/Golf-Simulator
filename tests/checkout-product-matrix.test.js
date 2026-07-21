import test from 'node:test';
import assert from 'node:assert/strict';

import { SHOP_CATALOG, skuById } from '../src/data/shopItems.js';
import { capacityOf } from '../src/data/fixtureSlots.js';
import { catalogCheckoutLayout, catalogProductVisual } from '../src/render3d/clubhouse/catalogProductVisual.js';
import { pickFromShelf, heldUnits } from '../src/sim/checkout.js';
import {
  bagItem,
  completeSale,
  createTx,
  handOverGoods,
  insertCard,
  packReceipt,
  presentCard,
  printReceipt,
  requestPayment,
  runCard,
  scanItem,
  submitCardAmount,
  enterCardDigit,
  subtotal,
  takeReceipt,
  totalOf,
} from '../src/sim/register.js';
import { newGame } from '../src/sim/state.js';
import { priceFor } from '../src/sim/shop.js';
import {
  PRODUCT_MATRIX,
  PRODUCT_MATRIX_REQUIRED_COUNTS,
  PRODUCT_MATRIX_REQUIRED_COVERAGE,
  matrixCoverage,
} from '../tools/qa/simplified-register-product-matrix-spec.mjs';

const STAGING = Object.freeze({ minX: 2.30, maxX: 3.10, minZ: 3.78, maxZ: 4.12 });
const REST_Y = 1.067;
const cents = (value) => Math.round(Number(value || 0) * 100);

test('product matrix covers the required basket sizes and retail families', () => {
  assert.deepEqual(PRODUCT_MATRIX.map((entry) => entry.skuIds.length), PRODUCT_MATRIX_REQUIRED_COUNTS);
  const coverage = matrixCoverage();
  for (const requirement of PRODUCT_MATRIX_REQUIRED_COVERAGE) {
    assert.ok(coverage.has(requirement), `matrix covers ${requirement}`);
  }
  for (const entry of PRODUCT_MATRIX) {
    assert.equal(new Set(entry.skuIds).size, entry.skuIds.length, `${entry.id} has no duplicate fixture SKU`);
    for (const skuId of entry.skuIds) {
      assert.ok(SHOP_CATALOG.some((sku) => sku.id === skuId), `${entry.id}/${skuId} is a catalog SKU`);
    }
  }
});

test('1/2/3/5-item checkout staging is deterministic, finite, and size-aware', () => {
  for (const entry of PRODUCT_MATRIX) {
    const items = entry.skuIds.map((skuId) => ({ sku: skuById(skuId) }));
    const first = catalogCheckoutLayout(items, STAGING, REST_Y);
    const replay = catalogCheckoutLayout(items, STAGING, REST_Y);
    assert.deepEqual(first, replay, `${entry.id} layout replays exactly`);
    assert.equal(first.length, entry.skuIds.length);
    assert.equal(new Set(first.map((pose) => `${pose.x.toFixed(5)}:${pose.z.toFixed(5)}`)).size,
      first.length, `${entry.id} gives every unit a distinct staging center`);
    first.forEach((pose, index) => {
      const visual = catalogProductVisual(skuById(entry.skuIds[index]));
      assert.ok(Number.isFinite(pose.x) && Number.isFinite(pose.y)
        && Number.isFinite(pose.z) && Number.isFinite(pose.ry), `${entry.id}/${index} pose is finite`);
      assert.ok(pose.x >= STAGING.minX && pose.x <= STAGING.maxX, `${entry.id}/${index} x center is on staging`);
      assert.ok(pose.z >= STAGING.minZ && pose.z <= STAGING.maxZ, `${entry.id}/${index} z center is on staging`);
      assert.equal(pose.y, REST_Y, `${entry.id}/${index} rests on the counter`);
      assert.equal(pose.sizeClass, visual.separateHandoff ? 'oversize' : 'compact',
        `${entry.id}/${entry.skuIds[index]} uses its declared handoff class`);
    });
  }
});

test('every product-matrix sale scans, inventories, tickets, and banks exactly once', () => {
  for (const [caseIndex, entry] of PRODUCT_MATRIX.entries()) {
    const state = newGame('relaxed', 7000 + caseIndex);
    const items = entry.skuIds.map((skuId, itemIndex) => {
      state.shop.inventory[skuId].shelf = capacityOf(skuId);
      const uid = `${entry.id}-${itemIndex}`;
      assert.equal(pickFromShelf(state, skuId, uid).ok, true, `${entry.id}/${skuId} leaves its real shelf`);
      const sku = skuById(skuId);
      return {
        uid,
        skuId,
        name: sku.name,
        price: priceFor(sku, state.shop.markup[sku.cat] || 1, null),
      };
    });
    const opening = {
      cashCents: cents(state.cash),
      revenueCents: cents(state.ledger.today.revenue.shopSales || 0),
      liveUnits: (state.shop.salesLive || {}).units || 0,
      liveRevenueCents: cents((state.shop.salesLive || {}).revenue || 0),
      history: (state.shop.transactionHistory || []).length,
      salesToday: Object.fromEntries(entry.skuIds.map((skuId) => [skuId, state.shop.salesToday?.[skuId] || 0])),
    };
    const tx = createTx({ items, prefer: 'card', rng: () => 0.99 });
    let runningCents = 0;
    for (const item of items) {
      const scanned = scanItem(tx, item.uid);
      assert.equal(scanned.ok, true, `${entry.id}/${item.skuId} accepts one scan`);
      runningCents += cents(item.price);
      assert.equal(cents(subtotal(tx)), runningCents, `${entry.id} subtotal adds that item once`);
      assert.equal(scanItem(tx, item.uid).ok, false, `${entry.id}/${item.skuId} rejects repeated input`);
      assert.equal(cents(subtotal(tx)), runningCents, `${entry.id}/${item.skuId} cannot double-charge`);
    }
    const expectedCents = items.reduce((sum, item) => sum + cents(item.price), 0);
    assert.equal(cents(totalOf(tx)), expectedCents, `${entry.id} exact total`);
    assert.deepEqual(requestPayment(tx), { ok: true, method: 'card' });
    assert.equal(presentCard(tx).ok, true);
    assert.equal(insertCard(tx).ok, true);
    assert.equal(tx.cardEntryCents, 0, `${entry.id} reader opens at 0.00`);
    // the operator keys the total on the reader; nothing is prefilled for them
    for (const digit of String(expectedCents)) {
      assert.equal(enterCardDigit(tx, Number(digit)).ok, true);
    }
    assert.equal(cents(submitCardAmount(tx).amount), expectedCents, `${entry.id} keyed amount confirms exact total`);
    assert.equal(runCard(tx).result, 'approved');
    assert.equal(printReceipt(tx).ok, true);
    assert.equal(takeReceipt(tx).ok, true);
    assert.equal(packReceipt(tx).ok, true);
    for (const item of items) assert.equal(bagItem(tx, item.uid).ok, true);
    assert.equal(handOverGoods(tx).ok, true);
    const completed = completeSale(state, tx, entry.label);
    assert.equal(completed.ok, true);
    assert.equal(cents(completed.total), expectedCents);
    assert.equal(completeSale(state, tx, entry.label).ok, false, `${entry.id} cannot bank twice`);

    assert.equal(cents(state.cash) - opening.cashCents, expectedCents, `${entry.id} moves exact cash once`);
    assert.equal(cents(state.ledger.today.revenue.shopSales || 0) - opening.revenueCents,
      expectedCents, `${entry.id} books exact shop revenue once`);
    assert.equal((state.shop.salesLive || {}).units - opening.liveUnits, items.length,
      `${entry.id} live units advance exactly once per product`);
    assert.equal(cents((state.shop.salesLive || {}).revenue || 0) - opening.liveRevenueCents,
      expectedCents, `${entry.id} live revenue advances once`);
    assert.equal((state.shop.transactionHistory || []).length - opening.history, 1,
      `${entry.id} emits one ticket`);
    const ticket = state.shop.transactionHistory[0];
    assert.equal(cents(ticket.total), expectedCents);
    assert.deepEqual(ticket.items.map(({ uid, skuId, price }) => ({ uid, skuId, price })),
      items.map(({ uid, skuId, price }) => ({ uid, skuId, price })), `${entry.id} ticket keeps every exact line`);
    assert.equal(heldUnits(state).length, 0, `${entry.id} consumes every held unit`);
    for (const skuId of entry.skuIds) {
      assert.equal(state.shop.inventory[skuId].shelf, capacityOf(skuId) - 1,
        `${entry.id}/${skuId} remains sold from its physically full shelf`);
      assert.equal((state.shop.salesToday?.[skuId] || 0) - opening.salesToday[skuId], 1,
        `${entry.id}/${skuId} velocity advances exactly once`);
    }
  }
});
