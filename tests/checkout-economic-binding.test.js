import test from 'node:test';
import assert from 'node:assert/strict';

import { checkoutSale, heldUnits, pickFromShelf } from '../src/sim/checkout.js';
import {
  acceptCash,
  bagItem,
  changeDue,
  completeSale,
  createTx,
  depositTendered,
  enterCardDigit,
  goodsLinesOf,
  handOverChange,
  handOverGoods,
  insertCard,
  makeChange,
  newDrawer,
  openDrawer,
  packReceipt,
  presentCard,
  printReceipt,
  requestPayment,
  runCard,
  scanItem,
  submitCardAmount,
  takeFromDrawer,
  takeReceipt,
  totalOf,
} from '../src/sim/register.js';
import { deserialize, newGame, serialize } from '../src/sim/state.js';

function stableSerialize(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${stableSerialize(value[key])}`
  )).join(',')}}`;
}

function resign(plan) {
  delete plan.signature;
  plan.signature = stableSerialize(plan);
  return plan;
}

function finishCardAndHandoff(tx) {
  assert.equal(requestPayment(tx).ok, true);
  assert.equal(presentCard(tx).ok, true);
  assert.equal(insertCard(tx).ok, true);
  for (const digit of String(Math.round(totalOf(tx) * 100))) {
    assert.equal(enterCardDigit(tx, Number(digit)).ok, true);
  }
  assert.equal(submitCardAmount(tx).ok, true);
  assert.equal(runCard(tx, { force: 'approved' }).result, 'approved');
  assert.equal(printReceipt(tx).ok, true);
  assert.equal(takeReceipt(tx).ok, true);
  assert.equal(packReceipt(tx).ok, true);
  for (const item of goodsLinesOf(tx)) assert.equal(bagItem(tx, item.uid).ok, true);
  assert.equal(handOverGoods(tx).ok, true);
  assert.equal(tx.stage, 'done');
}

function finishCashAndHandoff(state, tx) {
  assert.equal(requestPayment(tx).ok, true);
  tx.tendered = makeChange(20);
  assert.equal(acceptCash(tx).ok, true);
  assert.equal(openDrawer(tx).ok, true);
  assert.equal(depositTendered(tx, state.shop.drawer).ok, true);
  for (const [denomination, count] of Object.entries(makeChange(changeDue(tx)))) {
    for (let index = 0; index < count; index += 1) {
      assert.equal(takeFromDrawer(tx, state.shop.drawer, Number(denomination)).ok, true);
    }
  }
  assert.equal(handOverChange(tx, state.shop.drawer).ok, true);
  assert.equal(printReceipt(tx).ok, true);
  assert.equal(takeReceipt(tx).ok, true);
  assert.equal(packReceipt(tx).ok, true);
  for (const item of goodsLinesOf(tx)) assert.equal(bagItem(tx, item.uid).ok, true);
  assert.equal(handOverGoods(tx).ok, true);
  assert.equal(tx.stage, 'done');
}

function capturePendingRetail({
  seed,
  transactionId,
  uid,
  method = 'card',
  taxRate = 0.07,
}) {
  const state = newGame('relaxed', seed);
  if (method === 'cash') state.shop.drawer = newDrawer();
  assert.equal(pickFromShelf(state, 'balls1', uid).ok, true);
  const tx = createTx({
    id: transactionId,
    items: [{ uid, skuId: 'balls1', name: 'Practice Balls', price: 15 }],
    mode: 'relaxed',
    prefer: method,
    taxRate,
    rng: () => 0.9,
  });
  assert.equal(scanItem(tx, uid).ok, true);
  if (method === 'cash') finishCashAndHandoff(state, tx);
  else finishCardAndHandoff(tx);

  const pristine = JSON.parse(serialize(state));
  assert.throws(() => completeSale(state, tx, 'Economic Binding Golfer', {
    qaFaultAfterCoreCommit() {
      throw new Error('capture signed economic settlement');
    },
  }), /capture signed economic settlement/);
  const settlementId = `checkout:${transactionId}`;
  const plan = structuredClone(state.shop.pendingCheckouts[settlementId]);
  assert.ok(plan, 'the injected interruption retains a genuine signed WAL');
  for (const line of plan.inventory.entries) {
    pristine.shop.inventoryLifecycle.operations[`customer-pick:${line.uid}`]
      .checkoutPriceAuthority = structuredClone(plan.inventory.priceAuthority);
  }
  return { pristine, plan, settlementId };
}

function economicAuthorities(state) {
  return structuredClone({
    cash: state.cash,
    drawer: state.shop.drawer,
    inventory: state.shop.inventory,
    held: heldUnits(state),
    inventoryLifecycle: state.shop.inventoryLifecycle,
    ledger: state.ledger,
    salesLive: state.shop.salesLive,
    salesToday: state.shop.salesToday,
    salesTax: state.salesTax,
    checkoutProjectionIds: state.shop.checkoutProjectionIds,
    transactionHistory: state.shop.transactionHistory,
    nextTransactionNo: state.shop.nextTransactionNo,
  });
}

function assertForgedWalQuarantines({ pristine, plan, settlementId, uid }) {
  resign(plan);
  pristine.shop.pendingCheckouts = { [settlementId]: plan };
  const before = economicAuthorities(pristine);

  const loaded = deserialize(pristine);

  assert.equal(loaded.shop.pendingCheckoutsQuarantine?.active, true,
    'the economically contradictory WAL is quarantined');
  assert.deepEqual(loaded.shop.pendingCheckouts, {});
  assert.deepEqual(economicAuthorities(loaded), before,
    'rejection happens before cash, stock, books, analytics, drawer, or ticket mutation');
  assert.equal(loaded.shop.held.some((item) => item.uid === uid), true,
    'the rejected WAL cannot consume its held product');
}

for (const [index, scenario] of [
  {
    name: 'cash impact',
    mutate(spec) { spec.cashImpact = 0; },
  },
  {
    name: 'profit impact',
    mutate(spec) { spec.profitImpact = 0; },
  },
  {
    name: 'accounting class',
    mutate(spec) { spec.accountingClass = 'liability'; },
  },
  {
    name: 'aggregate target',
    mutate(spec) {
      spec.aggregate = { side: 'revenue', key: 'forgedCheckoutRevenue', amount: 150 };
    },
  },
].entries()) {
  test(`a re-signed retail WAL cannot override its sale ${scenario.name}`, () => {
    const transactionId = `economic-sale-${scenario.name.replaceAll(' ', '-')}`;
    const uid = `${transactionId}-unit`;
    const captured = capturePendingRetail({
      seed: 27400 + index,
      transactionId,
      uid,
      taxRate: 0,
    });
    const sale = captured.plan.postings.find((posting) => posting.component === 'sale');
    assert.ok(sale);
    scenario.mutate(sale.spec);

    assertForgedWalQuarantines({ ...captured, uid });
  });
}

for (const [index, scenario] of [
  {
    name: 'sales revenue projection',
    mutate(plan) {
      const projection = plan.projections.find((entry) => entry.kind === 'sales');
      assert.ok(projection);
      projection.delta.revenue += 100;
      projection.after.revenue = projection.before.revenue + projection.delta.revenue;
    },
  },
  {
    name: 'sales quantity projection',
    mutate(plan) {
      const projection = plan.projections.find((entry) => entry.kind === 'sales');
      assert.ok(projection);
      projection.delta.units = 2;
      projection.delta.perSku.balls1 = 2;
      projection.after.units = projection.before.units + 2;
      projection.after.perSku.balls1 = projection.before.perSku.balls1 + 2;
    },
  },
  {
    name: 'sales-tax projection',
    mutate(plan) {
      const projection = plan.projections.find((entry) => entry.kind === 'tax');
      assert.ok(projection);
      projection.delta = { collected: 9.99, owed: 9.99, taxableSales: 99 };
      projection.after = {
        collected: projection.before.collected + projection.delta.collected,
        owed: projection.before.owed + projection.delta.owed,
        taxableSales: projection.before.taxableSales + projection.delta.taxableSales,
      };
    },
  },
].entries()) {
  test(`a re-signed retail WAL cannot forge its ${scenario.name}`, () => {
    const transactionId = `economic-${scenario.name.replaceAll(' ', '-')}`;
    const uid = `${transactionId}-unit`;
    const captured = capturePendingRetail({
      seed: 27410 + index,
      transactionId,
      uid,
    });
    scenario.mutate(captured.plan);

    assertForgedWalQuarantines({ ...captured, uid });
  });
}

for (const [index, scenario] of [
  {
    name: 'amount',
    mutate(outcome) { outcome.amount = 999; },
  },
  {
    name: 'count',
    mutate(outcome) { outcome.count = 2; },
  },
  {
    name: 'unit count',
    mutate(outcome) { outcome.metadata.units = 2; },
  },
].entries()) {
  test(`a re-signed retail WAL cannot forge its completion outcome ${scenario.name}`, () => {
    const transactionId = `economic-outcome-${scenario.name.replaceAll(' ', '-')}`;
    const uid = `${transactionId}-unit`;
    const captured = capturePendingRetail({
      seed: 27420 + index,
      transactionId,
      uid,
    });
    scenario.mutate(captured.plan.outcomeSpec);

    assertForgedWalQuarantines({ ...captured, uid });
  });
}

test('a re-signed card WAL cannot smuggle a cash-drawer CAS target', () => {
  const transactionId = 'economic-card-drawer-target';
  const uid = `${transactionId}-unit`;
  const captured = capturePendingRetail({
    seed: 27430,
    transactionId,
    uid,
    method: 'card',
    taxRate: 0,
  });
  const before = structuredClone(captured.pristine.shop.drawer);
  const after = structuredClone(before);
  after['20'] += 1;
  captured.plan.drawer = { before, after };

  assertForgedWalQuarantines({ ...captured, uid });
});

test('a re-signed cash WAL cannot make its drawer target exceed the ticket cash', () => {
  const transactionId = 'economic-cash-drawer-target';
  const uid = `${transactionId}-unit`;
  const captured = capturePendingRetail({
    seed: 27431,
    transactionId,
    uid,
    method: 'cash',
    taxRate: 0,
  });
  assert.ok(captured.plan.drawer);
  captured.plan.drawer.after['20'] += 1;

  assertForgedWalQuarantines({ ...captured, uid });
});

function inflateRetailPlan(plan, amount, { mutateLinePrice = false } = {}) {
  const ticket = plan.ticketDraft;
  const sale = plan.postings.find((posting) => posting.component === 'sale');
  const projection = plan.projections.find((entry) => entry.kind === 'sales');
  assert.ok(sale);
  assert.ok(projection);
  if (mutateLinePrice) {
    ticket.items[0].price = amount;
    plan.inventory.priceAuthority.lines[0].price = amount;
    plan.inventory.priceAuthority.goodsSubtotal = amount;
    ticket.pricing.goodsSubtotal = amount;
  }
  ticket.net = amount;
  ticket.total = amount;
  ticket.cash = amount;
  ticket.pricing.saleRevenue = amount;
  ticket.pricing.total = amount;
  plan.inventory.priceAuthority.saleRevenue = amount;
  plan.inventory.priceAuthority.total = amount;
  sale.spec.amount = amount;
  sale.spec.metadata.ticketTotal = amount;
  projection.delta.revenue = amount;
  projection.after.revenue = projection.before.revenue + amount;
  plan.outcomeSpec.amount = amount;
}

test('a re-signed retail WAL cannot inflate net revenue beyond its frozen line prices', () => {
  const transactionId = 'economic-frozen-price-net-inflation';
  const uid = `${transactionId}-unit`;
  const captured = capturePendingRetail({
    seed: 27432,
    transactionId,
    uid,
    taxRate: 0,
  });
  inflateRetailPlan(captured.plan, 115);

  assertForgedWalQuarantines({ ...captured, uid });
});

test('a re-signed retail WAL cannot coherently rewrite a frozen held-unit quote', () => {
  const transactionId = 'economic-frozen-price-line-inflation';
  const uid = `${transactionId}-unit`;
  const captured = capturePendingRetail({
    seed: 27433,
    transactionId,
    uid,
    taxRate: 0,
  });
  inflateRetailPlan(captured.plan, 115, { mutateLinePrice: true });

  assertForgedWalQuarantines({ ...captured, uid });
});

test('a terminal sold-operation quote cannot override its retained customer-pick quote', () => {
  const state = newGame('relaxed', 27434);
  const transactionId = 'economic-terminal-price-precedence';
  const uid = `${transactionId}-unit`;
  assert.equal(pickFromShelf(state, 'balls1', uid).ok, true);
  const item = { uid, skuId: 'balls1', name: 'Practice Balls', price: 15 };

  assert.throws(() => checkoutSale(state, [item], 'Terminal Quote Golfer', transactionId, {
    taxRate: 0,
    qaFaultAfterInventory() {
      throw new Error('capture checkout after inventory');
    },
  }), /capture checkout after inventory/);

  const settlementId = `checkout:${transactionId}`;
  const plan = state.shop.pendingCheckouts[settlementId];
  const terminal = state.shop.inventoryLifecycle.operations[plan.inventory.referenceId];
  const frozenPick = structuredClone(
    state.shop.inventoryLifecycle.operations[`customer-pick:${uid}`].checkoutPriceAuthority,
  );
  inflateRetailPlan(plan, 115, { mutateLinePrice: true });
  terminal.checkoutPriceAuthority = structuredClone(plan.inventory.priceAuthority);
  resign(plan);
  assert.deepEqual(
    state.shop.inventoryLifecycle.operations[`customer-pick:${uid}`].checkoutPriceAuthority,
    frozenPick,
    'the earlier held-unit quote remains independent of the terminal rewrite',
  );
  const cashBefore = state.cash;
  const ledgerBefore = structuredClone(state.ledger);

  const loaded = deserialize(state);

  assert.equal(loaded.shop.pendingCheckoutsQuarantine?.active, true);
  assert.deepEqual(loaded.shop.pendingCheckouts, {});
  assert.equal(loaded.cash, cashBefore, 'the contradictory quote cannot replay cash');
  assert.deepEqual(loaded.ledger, ledgerBefore, 'the contradictory quote cannot replay books');
});

test('a re-signed cash WAL cannot describe under-given change as register overage', () => {
  const transactionId = 'economic-unreachable-cash-overage';
  const uid = `${transactionId}-unit`;
  const captured = capturePendingRetail({
    seed: 27435,
    transactionId,
    uid,
    method: 'cash',
    taxRate: 0,
  });
  const ticket = captured.plan.ticketDraft;
  const amount = 1;
  ticket.lost = -amount;
  ticket.cash = ticket.total + amount;
  captured.plan.drawer.after['1'] += 1;
  const propertyId = captured.plan.postings[0].spec.propertyId;
  const idempotencyKey = `checkout:${transactionId}:cash-overage`;
  const entryId = `le:${propertyId}:${idempotencyKey}`;
  const marker = structuredClone(captured.plan.checkoutSettlement);
  captured.plan.postings.push({
    component: 'cash-overage',
    spec: {
      strictIdentity: true,
      idempotencyKey,
      entryId,
      propertyId,
      relatedId: transactionId,
      direction: 'revenue',
      lineKey: 'cashOverShort',
      category: 'cashOverShort',
      amount,
      day: ticket.minute === 0 ? 0 : Math.floor(ticket.minute / 1440),
      timestamp: ticket.minute,
      source: 'checkout',
      metadata: { checkoutSettlement: marker },
    },
  });
  ticket.ledgerIdempotencyKeys['cash-overage'] = idempotencyKey;
  ticket.ledgerEntryIds['cash-overage'] = entryId;

  assertForgedWalQuarantines({ ...captured, uid });
});

test('a re-signed WAL cannot post a current-property checkout to another property', () => {
  const transactionId = 'economic-cross-property-rewrite';
  const uid = `${transactionId}-unit`;
  const captured = capturePendingRetail({
    seed: 27436,
    transactionId,
    uid,
    taxRate: 0,
  });
  const forgedPropertyId = 'property:forged-other';
  for (const posting of captured.plan.postings) {
    posting.spec.propertyId = forgedPropertyId;
    posting.spec.entryId = `le:${forgedPropertyId}:${posting.spec.idempotencyKey}`;
    captured.plan.ticketDraft.ledgerEntryIds[posting.component] = posting.spec.entryId;
  }
  captured.plan.outcomeSpec.propertyId = forgedPropertyId;
  captured.plan.outcomeSpec.id = `out:${forgedPropertyId}:${captured.plan.outcomeSpec.idempotencyKey}`;

  assertForgedWalQuarantines({ ...captured, uid });
});
