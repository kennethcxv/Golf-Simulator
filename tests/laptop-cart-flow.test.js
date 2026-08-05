// BROWSING AND REVIEWING ARE TWO SCREENS.
//
// Reported 2026-07-29: "Rework ordering into a real cart flow: browse and add items to cart
// on one screen, then a SEPARATE cart screen showing the line items, delivery choice,
// subtotal, taxes and total. Not all on one page."
//
// The basket used to sit at the top of the browse page above the product grid: choosing a
// delivery speed changed a total the player had already scrolled past, and the line items
// were never listed — only a count. "Not all on one page" is a claim about BOTH screens, so
// these tests pin what the cart screen gained AND what the browse screen lost.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { BALANCE } from '../src/sim/balance.js';
import { newGame } from '../src/sim/state.js';
import { quotePurchaseOrders } from '../src/sim/inventoryLifecycle.js';
import { tabLabel, tabsOf } from '../src/ui/laptopSearch.js';

const laptop = readFileSync(new URL('../src/ui/laptop.js', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

const slice = (from, to) => {
  const start = laptop.indexOf(from);
  const end = laptop.indexOf(to);
  assert.ok(start >= 0 && end > start, `could not slice ${from} .. ${to}`);
  return laptop.slice(start, end);
};

test('the Pro Shop has a Cart tab that reports what is in it', () => {
  // The tab EXISTS in the page map that both the tab bar and the search paths read, and the
  // only thing the page decides for itself is the badge. The literal tab array this used to
  // grep for is gone — it was the second copy of the labels the sidebar already held.
  assert.deepEqual(tabsOf('shop').map(([id]) => id), ['stock', 'order', 'cart', 'prices', 'deliveries']);
  assert.equal(tabLabel('shop', 'cart'), 'Cart');
  assert.match(laptop, /v === 'cart' && cart\.size \? `Cart \(\$\{cart\.size\}\)` : label/);
  assert.match(laptop, /ss\.tab === 'cart' \? shopCartTab\(st, ss\)/);
});

test('the cart screen carries all five things the brief lists', () => {
  const cartTab = slice('function shopCartTab(st, ss) {', 'function shopPricesTab(st) {');
  assert.match(cartTab, /lt-cartitem/, 'line items');
  assert.match(cartTab, /lt-shipping/, 'delivery choice');
  assert.match(cartTab, /money\('Subtotal', goods\)/, 'subtotal');
  assert.match(cartTab, /Sales tax/, 'taxes');
  assert.match(cartTab, /lt-carttotal/, 'total');
  assert.match(cartTab, /primaryBtn\('Place Order'/, 'and the button that spends the money');
  // Order on the page is the argument: the delivery chooser must come BEFORE the totals it
  // changes. Under the total it silently altered a number the player had already read.
  assert.ok(
    cartTab.indexOf('lt-shipping') < cartTab.indexOf("money('Subtotal'"),
    'the delivery chooser must sit above the totals it changes',
  );
});

test('the money lives in a sticky rail so Place Order never leaves the lid', () => {
  // Reported 2026-07-29: "Place Order sits below the lid's fold with a full cart. Fix it — a
  // confirm button you have to scroll to find is the same defect as the shipping options
  // sitting under the total." The structural half is held here (items column + rail, with the
  // chooser, totals and button all inside the rail); the geometric half — button box inside
  // the 640 px scroller with eight lines in the basket, before AND after scrolling — is
  // measured live by tools/qa/laptop-cart-flow.js.
  const cartTab = slice('function shopCartTab(st, ss) {', 'function shopPricesTab(st) {');
  assert.match(cartTab, /lt-cartsplit/);
  assert.match(cartTab, /lt-cartmaincol/);
  const rail = cartTab.slice(cartTab.indexOf("class: 'lt-cartrail'"));
  assert.ok(rail.includes('lt-shipping'), 'the delivery chooser rides the rail');
  assert.ok(rail.includes("money('Subtotal'"), 'so do the totals');
  assert.ok(rail.includes("primaryBtn('Place Order'"), 'and the button that spends the money');
  assert.ok(!rail.includes('lt-cartitem'), 'the line items do NOT - they are the column that scrolls');
  // The stickiness itself is CSS, and a class with no position:sticky behind it is decor.
  assert.match(styles, /\.lt-cartrail \{[^}]*position: sticky/s);
  assert.match(styles, /\.lt-cartsplit \{[^}]*grid-template-columns/s);
});

test('the browse screen no longer carries the money', () => {
  const orderTab = slice('function shopOrderTab(st, ss) {', 'function shopCartTab(st, ss) {');
  for (const gone of ['lt-shipping', 'lt-carttotal', "primaryBtn('Place Order'", 'Sales tax', 'submitPurchaseOrders']) {
    assert.ok(!orderTab.includes(gone), `${gone} must not be on the browse screen`);
  }
  // What it keeps: the grid, and a way across to the cart.
  assert.match(orderTab, /lt-grid/);
  assert.match(orderTab, /lt-cartstrip/);
  assert.match(orderTab, /'Review cart'/);
});

test('both screens quote from one function, so they cannot disagree', () => {
  // Freight is priced per SUPPLIER on the grouped box count, so any second derivation from
  // the cart alone is wrong. Two quotes would let the strip and the cart show different
  // numbers for the same basket.
  assert.match(laptop, /function cartQuote\(st, ss\) \{/);
  const cartQuoteBody = slice('function cartQuote(st, ss) {', 'const arrivalWord =');
  assert.match(cartQuoteBody, /quotePurchaseOrders\(st, cartLines, speed\)/);
  const orderTab = slice('function shopOrderTab(st, ss) {', 'function shopCartTab(st, ss) {');
  const cartTab = slice('function shopCartTab(st, ss) {', 'function shopPricesTab(st) {');
  assert.match(orderTab, /cartQuote\(st, ss\)/);
  assert.match(cartTab, /cartQuote\(st, ss\)/);
  assert.ok(!orderTab.includes('quotePurchaseOrders('), 'the browse screen must not quote for itself');
});

test('the cart screen is laid out', () => {
  assert.match(styles, /\.lt-cartitem \{/);
  assert.match(styles, /\.lt-cartitemsum \{[^}]*tabular-nums/);
  assert.match(styles, /\.lt-cartstrip \{/);
});

// --- the tax the cart screen shows ------------------------------------------------

test('wholesale sales tax is a real rate, wired end to end, and zero by default', () => {
  // The line has to read a number rather than print a hardcoded zero, or the feature is a
  // label. It is 0 because turning it on makes every order in the game more expensive, and
  // the opening bundle, the starting cash and the economy tests were all tuned against
  // goods + freight. Re-tuning the economy is a decision, not a side effect of adding a row.
  assert.equal(BALANCE.wholesaleSalesTaxRate, 0);
  const state = newGame('relaxed', 4242);
  const quote = quotePurchaseOrders(state, [{ skuId: 'balls1', quantity: 4 }], 'standard');
  assert.equal(quote.ok, true);
  assert.equal(quote.taxRate, 0);
  assert.equal(quote.tax, 0);
  assert.equal(quote.total, Math.round((quote.goods + quote.freight) * 100) / 100);
  assert.equal(quote.orders.every((order) => order.tax === 0), true);
});

test('raising the rate charges the tax and reports it separately', () => {
  // The negative control for the line above: if the rate did nothing, this test could not
  // tell a wired feature from a decorative label.
  const original = BALANCE.wholesaleSalesTaxRate;
  try {
    BALANCE.wholesaleSalesTaxRate = 0.06;
    const state = newGame('relaxed', 4242);
    const quote = quotePurchaseOrders(state, [{ skuId: 'balls1', quantity: 4 }], 'standard');
    assert.equal(quote.taxRate, 0.06);
    assert.ok(quote.tax > 0, 'a non-zero rate must produce a non-zero tax');
    const expected = Math.round((quote.goods + quote.freight) * 0.06 * 100) / 100;
    assert.ok(Math.abs(quote.tax - expected) < 0.02, `tax ${quote.tax} should be about ${expected}`);
    assert.ok(
      Math.abs(quote.total - (quote.goods + quote.freight + quote.tax)) < 0.02,
      'the total must include the tax it reports',
    );
  } finally {
    BALANCE.wholesaleSalesTaxRate = original;
  }
});
