// SALES TAX IS CUSTOMER-SIDE, AND IT IS NOT THE PLAYER'S MONEY.
//
// Reported 2026-07-29: "I asked for tax by state. Build it on the right side of the till.
// Wholesale goods bought for resale are exempt from sales tax in the US — the resale exemption.
// So do NOT tax supplier orders. Leave BALANCE.wholesaleSalesTaxRate at 0 and keep it wired
// as-is. Instead: each property has a STATE, and that state's sales-tax rate applies to
// customer purchases at checkout… The tax is not the player's money — it accrues as a
// liability and is remitted, visible in Finances."
//
// Four claims, each with a way to fail:
//   1. the rate follows the PROPERTY, and a zero-tax state really charges nothing
//   2. the customer pays subtotal + tax, and only the subtotal is revenue
//   3. the liability accrues, is remitted on the cycle, and does not move profit
//   4. supplier orders are still untaxed
import test from 'node:test';
import assert from 'node:assert/strict';

import { BALANCE } from '../src/sim/balance.js';
import {
  deserializeWithReport, newGame, SALES_TAX_SAVE_VERSION, SAVE_VERSION, serialize,
} from '../src/sim/state.js';
import { quotePurchaseOrders } from '../src/sim/inventoryLifecycle.js';
import { generateListing, generateMarketplace } from '../src/sim/marketplace.js';
import { checkoutSale, pickFromShelf } from '../src/sim/checkout.js';
import {
  completeSale, createTx, netOf, scanItem, subtotal, taxOf, totalOf,
} from '../src/sim/register.js';
import {
  accrueSalesTax, ensureSalesTax, remitSalesTax, salesTaxOn, salesTaxOwed, salesTaxRate,
  taxJurisdictionLabel, taxJurisdictionOf, tickSalesTax, SALES_TAX_CYCLE_DAYS,
  SALES_TAX_MAX_DAY,
} from '../src/sim/salesTax.js';
import {
  PROPERTY_JURISDICTIONS, SALES_TAX_JURISDICTIONS, formatTaxRate, salesTaxRateOf,
} from '../src/data/salesTax.js';

const clubIn = (code, seed = 4242) => {
  const st = newGame('relaxed', seed);
  st.property.taxJurisdiction = code;
  return st;
};

test('non-default collected and remitted tax survives save/load and retry stays idempotent', () => {
  const state = clubIn('NC', 4241);
  const first = accrueSalesTax(state, 12.34, {
    idempotencyKey: 'sales-tax-save-round-trip:first',
    taxableSales: 176.29,
  });
  assert.equal(first.ok, true);
  state.clock.minutes = SALES_TAX_CYCLE_DAYS * 1440;
  assert.equal(tickSalesTax(state, SALES_TAX_CYCLE_DAYS).amount, 12.34);
  const second = accrueSalesTax(state, 2.22, {
    idempotencyKey: 'sales-tax-save-round-trip:second',
    taxableSales: 31.71,
  });
  assert.equal(second.ok, true);

  const before = structuredClone(ensureSalesTax(state));
  assert.deepEqual(before, {
    collected: 14.56,
    remitted: 12.34,
    owed: 2.22,
    nextRemitDay: SALES_TAX_CYCLE_DAYS * 2,
    lastRemitAmount: 12.34,
    lastRemitDay: SALES_TAX_CYCLE_DAYS,
    taxableSales: 31.71,
  }, 'every persisted amount and remittance-date field is non-default');
  const persisted = JSON.parse(serialize(state));
  assert.deepEqual(persisted.salesTax, before, 'the liability is part of the durable snapshot');

  const loaded = deserializeWithReport(persisted);
  assert.equal(loaded.report.recovered, false);
  assert.deepEqual(ensureSalesTax(loaded.state), before,
    'collected, owed, remitted, taxable sales, and remittance dates all survive load');

  const cashBeforeRetry = loaded.state.cash;
  const entriesBeforeRetry = loaded.state.ledger.entries.length;
  const retried = accrueSalesTax(loaded.state, 2.22, {
    idempotencyKey: 'sales-tax-save-round-trip:second',
    taxableSales: 31.71,
  });
  assert.equal(retried.duplicate, true);
  assert.equal(retried.amount, 0);
  assert.equal(loaded.state.cash, cashBeforeRetry, 'retry after reload moves no cash');
  assert.equal(loaded.state.ledger.entries.length, entriesBeforeRetry,
    'retry after reload appends no accounting row');
  assert.deepEqual(ensureSalesTax(loaded.state), before, 'retry after reload changes no liability');
});

test('v14 reconstructs a missing v13 authority from ledger evidence without reposting money', () => {
  assert.equal(SAVE_VERSION, 15);
  assert.equal(SALES_TAX_SAVE_VERSION, 14);
  const state = clubIn('NC', 4240);
  state.clock.minutes = (SALES_TAX_CYCLE_DAYS - 1) * 1440;
  assert.equal(accrueSalesTax(state, 10, {
    idempotencyKey: 'sales-tax-v13:first', taxableSales: 142.86,
  }).ok, true);
  assert.equal(tickSalesTax(state, SALES_TAX_CYCLE_DAYS).amount, 10);
  state.clock.minutes = (SALES_TAX_CYCLE_DAYS + 1) * 1440;
  assert.equal(accrueSalesTax(state, 3, {
    idempotencyKey: 'sales-tax-v13:second', taxableSales: 42.86,
  }).ok, true);

  const raw = JSON.parse(serialize(state));
  raw.version = SALES_TAX_SAVE_VERSION - 1;
  delete raw.salesTax;
  const cashBefore = raw.cash;
  const ledgerBefore = structuredClone(raw.ledger);

  const loaded = deserializeWithReport(raw);
  assert.deepEqual(loaded.report.migrations.find(({ version }) => (
    version === SALES_TAX_SAVE_VERSION
  )), {
    version: SALES_TAX_SAVE_VERSION,
    name: 'durable-sales-tax-liability',
  });
  assert.equal(loaded.report.recovered, false,
    'an authority absent from its older schema is a migration, not corrupt data');
  assert.deepEqual(loaded.report.repairs.filter((repair) => repair.path.startsWith('$.salesTax')), []);
  assert.deepEqual(ensureSalesTax(loaded.state), {
    collected: 13,
    remitted: 10,
    owed: 3,
    nextRemitDay: SALES_TAX_CYCLE_DAYS * 2,
    lastRemitAmount: 10,
    lastRemitDay: SALES_TAX_CYCLE_DAYS,
    taxableSales: 0,
  });
  assert.equal(loaded.state.cash, cashBefore, 'migration does not move cash');
  assert.deepEqual(loaded.state.ledger, ledgerBefore, 'migration does not append or rewrite ledger rows');
});

test('corrupt and extreme persisted tax fields heal once to bounded canonical values', () => {
  const state = clubIn('NC', 4239);
  const raw = JSON.parse(serialize(state));
  raw.clock.minutes = 1000 * 1440;
  raw.salesTax = {
    collected: Number.MAX_VALUE,
    remitted: 1.239,
    owed: -14,
    nextRemitDay: Number.MIN_SAFE_INTEGER,
    lastRemitAmount: -7,
    lastRemitDay: -999,
    taxableSales: 17.576,
    futurePolicy: { cadence: 11, modes: ['state', 'local'] },
  };

  const first = deserializeWithReport(raw);
  assert.equal(first.report.recovered, true);
  assert.deepEqual(ensureSalesTax(first.state), {
    collected: 1.24,
    remitted: 1.24,
    owed: 0,
    nextRemitDay: 1001,
    lastRemitAmount: 0,
    lastRemitDay: -1,
    taxableSales: 0,
    futurePolicy: { cadence: 11, modes: ['state', 'local'] },
  });
  const repairedPaths = new Set(first.report.repairs.map((repair) => repair.path));
  for (const field of [
    'collected', 'remitted', 'owed', 'nextRemitDay',
    'lastRemitAmount', 'lastRemitDay', 'taxableSales',
  ]) {
    assert.equal(repairedPaths.has(`$.salesTax.${field}`), true, `${field} repair is reported`);
  }
  assert.equal(repairedPaths.has('$.salesTax.futurePolicy'), false,
    'unknown nested data is preserved, not misreported as corruption');

  const extremeDay = SALES_TAX_MAX_DAY - 100;
  first.state.clock.minutes = extremeDay * 1440;
  const tick = tickSalesTax(first.state, extremeDay);
  assert.equal(tick.remitted, false);
  assert.ok(ensureSalesTax(first.state).nextRemitDay > extremeDay,
    'an extreme stale schedule advances in constant time to a future safe day');

  const canonical = structuredClone(ensureSalesTax(first.state));
  const second = deserializeWithReport(serialize(first.state));
  assert.equal(second.report.recovered, false, 'the repaired document is canonical on its next load');
  assert.deepEqual(ensureSalesTax(second.state), canonical);
});

test('hostile current-schema cross-fields cannot invent a payable cash withdrawal', () => {
  const raw = JSON.parse(serialize(clubIn('NC', 4237)));
  raw.salesTax = {
    collected: 5,
    remitted: 10,
    owed: 999,
    nextRemitDay: 0,
    lastRemitAmount: 50,
    lastRemitDay: -1,
    taxableSales: 1,
  };
  const cashBefore = raw.cash;
  const ledgerBefore = structuredClone(raw.ledger);

  const loaded = deserializeWithReport(raw);
  assert.equal(loaded.report.recovered, true);
  assert.deepEqual(ensureSalesTax(loaded.state), {
    collected: 5,
    remitted: 5,
    owed: 0,
    nextRemitDay: SALES_TAX_CYCLE_DAYS,
    lastRemitAmount: 0,
    lastRemitDay: -1,
    taxableSales: 0,
  });
  assert.equal(loaded.state.cash, cashBefore, 'load does not move cash');
  assert.deepEqual(loaded.state.ledger, ledgerBefore, 'load does not rewrite accounting evidence');

  const entriesBeforeTick = loaded.state.ledger.entries.length;
  loaded.state.clock.minutes = SALES_TAX_CYCLE_DAYS * 1440;
  const ticked = tickSalesTax(loaded.state, SALES_TAX_CYCLE_DAYS);
  assert.equal(ticked.amount, 0, 'the corrupt payable amount cannot be remitted');
  assert.equal(loaded.state.cash, cashBefore, 'the next tax tick cannot withdraw unsupported cash');
  assert.equal(loaded.state.ledger.entries.length, entriesBeforeTick,
    'the next tax tick cannot post an unsupported remittance');

  const canonical = deserializeWithReport(serialize(loaded.state));
  assert.equal(canonical.report.recovered, false, 'cross-field repair is canonical after one load');
});

test('v13 reconstruction counts a durable tax identity once and reports exact duplicate rows', () => {
  const state = clubIn('NC', 4236);
  accrueSalesTax(state, 5, {
    idempotencyKey: 'sales-tax-v13:duplicate',
    source: 'checkout',
    taxableSales: 71.43,
  });
  const raw = JSON.parse(serialize(state));
  raw.version = SALES_TAX_SAVE_VERSION - 1;
  delete raw.salesTax;
  const row = raw.ledger.entries.find((entry) => (
    entry.idempotencyKey === 'sales-tax-v13:duplicate'
  ));
  raw.ledger.entries.push(structuredClone(row));
  const cashBefore = raw.cash;
  const ledgerBefore = structuredClone(raw.ledger);

  const loaded = deserializeWithReport(raw);
  assert.deepEqual(ensureSalesTax(loaded.state), {
    collected: 5,
    remitted: 0,
    owed: 5,
    nextRemitDay: SALES_TAX_CYCLE_DAYS,
    lastRemitAmount: 0,
    lastRemitDay: -1,
    taxableSales: 0,
  });
  assert.equal(loaded.report.recovered, true, 'duplicate migration evidence is surfaced');
  assert.match(
    loaded.report.repairs.find((repair) => repair.path === '$.ledger.entries[1]')?.message || '',
    /duplicate durable tax-row identity ignored/,
  );
  assert.equal(loaded.state.cash, cashBefore, 'deduplication does not move cash');
  assert.deepEqual(loaded.state.ledger, ledgerBefore, 'deduplication does not mutate the ledger');
});

test('v13 reconstruction rejects every row in a conflicting duplicate identity', () => {
  const state = clubIn('NC', 4234);
  accrueSalesTax(state, 5, {
    idempotencyKey: 'sales-tax-v13:conflicting-duplicate',
    source: 'checkout',
    taxableSales: 71.43,
  });
  const raw = JSON.parse(serialize(state));
  raw.version = SALES_TAX_SAVE_VERSION - 1;
  delete raw.salesTax;
  const conflicting = structuredClone(raw.ledger.entries[0]);
  conflicting.amount = 777;
  conflicting.cashImpact = 777;
  raw.ledger.entries.unshift(conflicting);
  const cashBefore = raw.cash;
  const ledgerBefore = structuredClone(raw.ledger);

  const loaded = deserializeWithReport(raw);
  assert.deepEqual(ensureSalesTax(loaded.state), {
    collected: 0,
    remitted: 0,
    owed: 0,
    nextRemitDay: SALES_TAX_CYCLE_DAYS,
    lastRemitAmount: 0,
    lastRemitDay: -1,
    taxableSales: 0,
  }, 'ordering cannot choose either amount from a conflicting durable identity');
  for (const index of [0, 1]) {
    assert.match(
      loaded.report.repairs.find((repair) => (
        repair.path === `$.ledger.entries[${index}]`
      ))?.message || '',
      /conflicting duplicate durable tax-row identity ignored/,
    );
  }
  assert.equal(loaded.state.cash, cashBefore, 'conflict rejection does not move cash');
  assert.deepEqual(loaded.state.ledger, ledgerBefore, 'conflict rejection does not mutate the ledger');
});

test('v13 reconstruction rejects a forged line-key-only row and reports the evidence', () => {
  const state = clubIn('NC', 4235);
  accrueSalesTax(state, 777, {
    idempotencyKey: 'sales-tax-v13:forged',
    source: 'checkout',
    taxableSales: 11100,
  });
  const raw = JSON.parse(serialize(state));
  raw.version = SALES_TAX_SAVE_VERSION - 1;
  delete raw.salesTax;
  Object.assign(raw.ledger.entries[0], {
    direction: 'expense',
    category: 'not-tax',
    accountingClass: 'operating',
    cashImpact: -777,
    profitImpact: -777,
    source: 'forged',
  });
  const cashBefore = raw.cash;
  const ledgerBefore = structuredClone(raw.ledger);

  const loaded = deserializeWithReport(raw);
  assert.deepEqual(ensureSalesTax(loaded.state), {
    collected: 0,
    remitted: 0,
    owed: 0,
    nextRemitDay: SALES_TAX_CYCLE_DAYS,
    lastRemitAmount: 0,
    lastRemitDay: -1,
    taxableSales: 0,
  });
  assert.equal(loaded.report.recovered, true, 'forged migration evidence is surfaced');
  assert.match(
    loaded.report.repairs.find((repair) => repair.path === '$.ledger.entries[0]')?.message || '',
    /canonical liability posting shape/,
  );
  assert.equal(loaded.state.cash, cashBefore, 'rejecting forged evidence does not move cash');
  assert.deepEqual(loaded.state.ledger, ledgerBefore, 'rejecting forged evidence does not rewrite it');
});

test('unknown nested sales-tax fields survive an otherwise exact current-schema round trip', () => {
  const raw = JSON.parse(serialize(clubIn('NC', 4238)));
  raw.salesTax.futureAuthority = {
    version: 2,
    filing: { cadence: 'quarterly', jurisdictions: ['state', 'county'] },
  };
  const loaded = deserializeWithReport(raw);
  assert.equal(loaded.report.recovered, false);
  const persisted = JSON.parse(serialize(loaded.state));
  assert.deepEqual(persisted.salesTax.futureAuthority, raw.salesTax.futureAuthority);
});

// --- 1. the rate follows the property ------------------------------------------------------

test('every jurisdiction resolves to a real rate, and two of them are zero', () => {
  for (const j of SALES_TAX_JURISDICTIONS) {
    const rate = salesTaxRateOf(j.code);
    assert.ok(Number.isFinite(rate) && rate >= 0 && rate < 0.15, `${j.code} has an implausible rate ${rate}`);
    assert.equal(rate, Math.round((j.stateRate + j.localRate) * 1e5) / 1e5,
      `${j.code}'s combined rate must be state + local, with nothing else added`);
  }
  // The zero path is not a rounding artefact — those states levy no general sales tax at all,
  // and a property there has to charge nothing rather than a very small something.
  assert.equal(salesTaxRateOf('OR'), 0);
  assert.equal(salesTaxRateOf('MT'), 0);
  // …and the highest one in the table is a real outlier, so the roster genuinely spreads.
  const rates = SALES_TAX_JURISDICTIONS.map((j) => salesTaxRateOf(j.code));
  assert.ok(Math.max(...rates) - Math.min(...rates) > 0.09, 'the roster must span a real range');
});

test('an unknown code falls back rather than throwing or charging nothing by accident', () => {
  // A save from a build with a jurisdiction that has since been renamed must not silently
  // become tax-free — that would be a quiet economy change on load.
  const st = clubIn('ZZ');
  assert.ok(salesTaxRate(st) > 0, 'an unrecognised code falls back to the default, not to zero');
  assert.equal(taxJurisdictionOf(st).code, 'NC');
});

test('every authored property has a home state, and so does a generated listing', () => {
  for (const listing of generateMarketplace(7)) {
    assert.ok(listing.taxJurisdiction, `${listing.id} has no jurisdiction`);
    assert.equal(listing.taxJurisdiction, PROPERTY_JURISDICTIONS[listing.id],
      `${listing.id} must carry its authored home state`);
  }
  for (const seed of [1, 99, 4242, 777777]) {
    const listing = generateListing(seed);
    assert.ok(salesTaxRateOf(listing.taxJurisdiction) >= 0, `generated listing ${listing.id} has no rate`);
    assert.ok(SALES_TAX_JURISDICTIONS.some((j) => j.code === listing.taxJurisdiction));
  }
});

test('the label says the state and the rate, and trims false precision', () => {
  assert.equal(taxJurisdictionLabel(clubIn('NC')), 'North Carolina · 7%');
  assert.equal(taxJurisdictionLabel(clubIn('OR')), 'Oregon · 0%');
  assert.equal(formatTaxRate(0.0975), '9.75%');
  assert.equal(formatTaxRate(0.0625), '6.25%');
  assert.equal(formatTaxRate(0.06), '6%');
  assert.equal(formatTaxRate(0), '0%');
});

// --- 2. the customer pays subtotal + tax ---------------------------------------------------

test('tax is computed on the cent-exact base, and the reporter\'s $24 becomes $25.68', () => {
  assert.equal(salesTaxOn(24, 0.07), 1.68);
  assert.equal(salesTaxOn(24.99, 0.07), 1.75);
  assert.equal(salesTaxOn(0, 0.07), 0);
  assert.equal(salesTaxOn(24, 0), 0);

  const tx = createTx({ items: [{ uid: 'a', skuId: 'balls1', name: 'Balls', price: 24 }], taxRate: 0.07 });
  scanItem(tx, 'a');
  assert.equal(subtotal(tx), 24);
  assert.equal(netOf(tx), 24);
  assert.equal(taxOf(tx), 1.68);
  assert.equal(totalOf(tx), 25.68);
});

test('a discount reduces the taxable sale price, because that is what was paid for the goods', () => {
  const tx = createTx({
    items: [{ uid: 'a', skuId: 'balls1', name: 'Balls', price: 100 }],
    discount: 0.1,
    taxRate: 0.07,
  });
  scanItem(tx, 'a');
  assert.equal(subtotal(tx), 100);
  assert.equal(netOf(tx), 90);
  assert.equal(taxOf(tx), 6.3, 'tax on 90, not on 100');
  assert.equal(totalOf(tx), 96.3);
});

test('NEGATIVE CONTROL - a zero-rate property charges exactly the subtotal', () => {
  // If taxOf() ignored the rate, or defaulted to something non-zero, this is where it shows.
  const tx = createTx({ items: [{ uid: 'a', skuId: 'balls1', name: 'Balls', price: 24 }], taxRate: 0 });
  scanItem(tx, 'a');
  assert.equal(taxOf(tx), 0);
  assert.equal(totalOf(tx), 24);
  assert.equal(totalOf(tx), subtotal(tx), 'in Oregon the total IS the subtotal');
});

test('the ticket the customer pays and the revenue the shop books are different numbers', () => {
  const st = clubIn('NC');
  st.shop.inventory.balls2.shelf = 4;
  st.shop.inventory.cap1.shelf = 4;
  pickFromShelf(st, 'balls2');
  pickFromShelf(st, 'cap1');
  const cash0 = st.cash;
  const items = [{ skuId: 'balls2', price: 30 }, { skuId: 'cap1', price: 20 }];
  const res = checkoutSale(st, items, 'Walk-in');
  assert.equal(res.ok, true);
  assert.equal(res.net, 50, 'the goods');
  assert.equal(res.tax, 3.5, '7% of 50');
  assert.equal(res.total, 53.5, 'what the customer handed over');
  assert.equal(Math.round((st.cash - cash0) * 100) / 100, 53.5, 'cash rose by the whole ticket');
  assert.equal(st.ledger.today.revenue.shopSales, 50, 'revenue is the goods and only the goods');
  assert.equal(salesTaxOwed(st), 3.5, 'the rest is held for the state');
});

test('the same basket in Oregon books the same revenue and no liability', () => {
  const st = clubIn('OR');
  st.shop.inventory.balls2.shelf = 4;
  st.shop.inventory.cap1.shelf = 4;
  pickFromShelf(st, 'balls2');
  pickFromShelf(st, 'cap1');
  const cash0 = st.cash;
  const res = checkoutSale(st, [{ skuId: 'balls2', price: 30 }, { skuId: 'cap1', price: 20 }], 'Walk-in');
  assert.equal(res.ok, true);
  assert.equal(res.tax, 0);
  assert.equal(res.total, 50);
  assert.equal(Math.round((st.cash - cash0) * 100) / 100, 50);
  assert.equal(st.ledger.today.revenue.shopSales, 50, 'the shop earns the same either way');
  assert.equal(salesTaxOwed(st), 0);
});

// --- 3. the liability -----------------------------------------------------------------------

test('accrued tax moves cash but never profit', () => {
  const st = clubIn('NC');
  const cash0 = st.cash;
  const revenue0 = st.ledger.today.revenue.shopSales || 0;
  const result = accrueSalesTax(st, 3.5, { idempotencyKey: 'test:accrue:1' });
  assert.equal(result.ok, true);
  assert.equal(Math.round((st.cash - cash0) * 100) / 100, 3.5, 'the money is really in the till');
  assert.equal(st.ledger.today.revenue.shopSales || 0, revenue0, 'and it is not on the revenue line');
  const entry = st.ledger.entries.find((e) => e.idempotencyKey === 'test:accrue:1');
  assert.ok(entry, 'it is a real ledger entry, auditable like any other');
  assert.equal(entry.profitImpact, 0, 'held money is not profit');
  assert.equal(entry.cashImpact, 3.5);
  assert.equal(entry.accountingClass, 'liability');
  assert.equal(salesTaxOwed(st), 3.5);
});

test('accrual is idempotent, so a retried sale cannot double the liability', () => {
  const st = clubIn('NC');
  accrueSalesTax(st, 3.5, { idempotencyKey: 'test:accrue:dup' });
  const again = accrueSalesTax(st, 3.5, { idempotencyKey: 'test:accrue:dup' });
  assert.equal(again.duplicate, true);
  assert.equal(again.amount, 0);
  assert.equal(salesTaxOwed(st), 3.5, 'still one accrual');
});

test('remitting pays the state, clears the liability, and is not a loss', () => {
  const st = clubIn('NC');
  accrueSalesTax(st, 12.34, { idempotencyKey: 'test:remit:accrue' });
  const cashBefore = st.cash;
  const profitBefore = st.ledger.entries.reduce((sum, e) => sum + e.profitImpact, 0);
  const out = remitSalesTax(st, 7);
  assert.equal(out.ok, true);
  assert.equal(out.amount, 12.34);
  assert.equal(Math.round((cashBefore - st.cash) * 100) / 100, 12.34, 'the money left the till');
  const profitAfter = st.ledger.entries.reduce((sum, e) => sum + e.profitImpact, 0);
  assert.equal(Math.round((profitAfter - profitBefore) * 100) / 100, 0,
    'paying out money that was never income is not a loss');
  assert.equal(salesTaxOwed(st), 0);
  assert.equal(ensureSalesTax(st).remitted, 12.34);
  // Nothing to remit twice.
  assert.equal(remitSalesTax(st, 7).amount, 0);
});

test('the cycle remits and then advances, even in a state that collects nothing', () => {
  const taxed = clubIn('NC');
  accrueSalesTax(taxed, 9, { idempotencyKey: 'test:cycle:1' });
  const before = tickSalesTax(taxed, SALES_TAX_CYCLE_DAYS - 1);
  assert.equal(before.remitted, false, 'nothing happens before the cycle day');
  assert.equal(before.dueInDays, 1);
  const on = tickSalesTax(taxed, SALES_TAX_CYCLE_DAYS);
  assert.equal(on.remitted, true);
  assert.equal(on.amount, 9);
  assert.equal(on.dueInDays, SALES_TAX_CYCLE_DAYS);
  assert.equal(salesTaxOwed(taxed), 0);

  // A zero-tax property must not retry forever: the cycle advances whether or not anything
  // was owed, or nextRemitDay would sit in the past and the tick would fire every day.
  const free = clubIn('OR');
  const first = tickSalesTax(free, SALES_TAX_CYCLE_DAYS);
  assert.equal(first.remitted, false);
  assert.equal(ensureSalesTax(free).nextRemitDay, SALES_TAX_CYCLE_DAYS * 2);
  // …and a long skip lands on the next future cycle day, not on the day after the last one.
  tickSalesTax(free, SALES_TAX_CYCLE_DAYS * 9 + 3);
  assert.ok(ensureSalesTax(free).nextRemitDay > SALES_TAX_CYCLE_DAYS * 9 + 3);
});

test('the register books goods and tax separately when a real sale completes', () => {
  const st = clubIn('NC');
  st.shop.inventory.cap1.shelf = 2;
  const pick = pickFromShelf(st, 'cap1', 'unit-cap');
  assert.equal(pick.ok, true);
  const tx = createTx({
    id: 'salestax-test-1',
    items: [{ uid: 'unit-cap', skuId: 'cap1', name: 'Pine Hills cap', price: 22 }],
    taxRate: salesTaxRate(st),
    prefer: 'card',
  });
  scanItem(tx, 'unit-cap');
  tx.method = 'card';
  tx.cardResult = 'approved';
  tx.receiptPrinted = true;
  tx.receiptPacked = true;
  tx.items[0].bagged = true;
  // canComplete() wants the choreography finished: printed, packed, bagged, stage 'done'.
  // An earlier draft left it at 'handoff', completeSale refused, and the test passed anyway
  // through a fallback branch — which is a test that cannot fail.
  tx.stage = 'done';
  const cash0 = st.cash;
  const done = completeSale(st, tx, 'Walk-in');
  assert.equal(done.ok, true, done.reason || 'the sale must actually bank');
  assert.equal(taxOf(tx), 1.54, '22 at 7%');
  assert.equal(totalOf(tx), 23.54);
  assert.equal(done.tax, 1.54);
  assert.equal(done.net, 22);
  assert.equal(done.total, 23.54);
  assert.equal(Math.round((st.cash - cash0) * 100) / 100, 23.54);
  assert.equal(st.ledger.today.revenue.shopSales, 22);
  assert.equal(salesTaxOwed(st), 1.54);
});

// --- 4. the supplier side is still exempt --------------------------------------------------

test('supplier orders remain untaxed - the resale exemption, still wired at zero', () => {
  // The reporter's ruling: "Wholesale goods bought for resale are exempt from sales tax in the
  // US — the resale exemption. So do NOT tax supplier orders. Leave
  // BALANCE.wholesaleSalesTaxRate at 0 and keep it wired as-is."
  assert.equal(BALANCE.wholesaleSalesTaxRate, 0);
  const st = clubIn('TN'); // the highest rate in the table — if anything leaked, it leaks here
  assert.ok(salesTaxRate(st) > 0.09, 'the customer side of this property really is taxed');
  const quote = quotePurchaseOrders(st, [{ skuId: 'balls1', quantity: 4 }], 'standard');
  assert.equal(quote.ok, true);
  assert.equal(quote.taxRate, 0, 'the wholesale rate is not the retail rate');
  assert.equal(quote.tax, 0);
  assert.equal(quote.total, Math.round((quote.goods + quote.freight) * 100) / 100);
});
