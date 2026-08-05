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
import { newGame } from '../src/sim/state.js';
import { quotePurchaseOrders } from '../src/sim/inventoryLifecycle.js';
import { generateListing, generateMarketplace } from '../src/sim/marketplace.js';
import { checkoutSale, pickFromShelf } from '../src/sim/checkout.js';
import {
  completeSale, createTx, netOf, scanItem, subtotal, taxOf, totalOf,
} from '../src/sim/register.js';
import {
  accrueSalesTax, ensureSalesTax, remitSalesTax, salesTaxOn, salesTaxOwed, salesTaxRate,
  taxJurisdictionLabel, taxJurisdictionOf, tickSalesTax, SALES_TAX_CYCLE_DAYS,
} from '../src/sim/salesTax.js';
import {
  PROPERTY_JURISDICTIONS, SALES_TAX_JURISDICTIONS, formatTaxRate, salesTaxRateOf,
} from '../src/data/salesTax.js';

const clubIn = (code, seed = 4242) => {
  const st = newGame('relaxed', seed);
  st.property.taxJurisdiction = code;
  return st;
};

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
