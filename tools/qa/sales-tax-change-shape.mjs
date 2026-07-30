// DOES SALES TAX ACTUALLY PRODUCE CHANGE UNDER A DOLLAR?
//
//   node tools/qa/sales-tax-change-shape.mjs
//
// Reported 2026-07-29: "I have never once had to give change under a dollar. Sales tax is what
// produces odd totals — $24.00 becomes $25.44 and now cash handling actually means something.
// Say in your report whether it does that in practice, with example totals."
//
// "In practice" is the whole question, so this does not reason about it: it builds real baskets
// out of the real catalogue at the real retail markup, rings them at each jurisdiction's rate,
// lets the real customerCash() decide what the customer pulls out of their wallet, and counts
// how much of the change is coin.
//
// It prints the BEFORE column too — the same baskets at 0% — because the claim is comparative.
// Without it, "38% of sales need coins" could be true of the untaxed game as well.
import { SHOP_CATALOG, skuById } from '../../src/data/shopItems.js';
import { newGame } from '../../src/sim/state.js';
import { priceFor } from '../../src/sim/shop.js';
import {
  createTx, scanItem, subtotal, netOf, taxOf, totalOf, cashTotalOf, customerCash,
  stackTotal, makeChange,
} from '../../src/sim/register.js';
import { SALES_TAX_JURISDICTIONS, salesTaxRateOf, formatTaxRate } from '../../src/data/salesTax.js';

const state = newGame('relaxed', 20260729);

// A deterministic RNG so the run is repeatable and the two columns see identical wallets.
//
// THE SEED IS HASHED AND THE STREAM IS WARMED, and the first draft of this did neither.
// Raw xorshift32 on consecutive small seeds returns a first value of roughly seed x 6.2e-5 —
// so wallets 1000..4999 all opened below 0.35, every customer took customerCash's
// dig-for-the-odd-coins branch, and the sweep reported 0.0% sub-dollar change in every
// jurisdiction including the 9.75% one. That was a fact about the seeding, not about the game.
// The assertion at the bottom of this block is what would have caught it.
function rngFrom(seed) {
  let s = Math.imul(seed >>> 0 || 1, 2654435761) >>> 0;
  const next = () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
  next(); next(); next();
  return next;
}

// SELF-CHECK ON THE INSTRUMENT. customerCash() adds the odd cents about 35% of the time; if
// the wallet stream is degenerate that branch fires always or never and the whole sweep is a
// lie in one direction or the other. Measured over the same seeds the sweep uses.
{
  let below = 0;
  const trials = 4000;
  for (let i = 0; i < trials; i++) if (rngFrom(1000 + i)() < 0.35) below += 1;
  const share = below / trials;
  if (share < 0.28 || share > 0.42) {
    throw new Error(`wallet seeding is degenerate: ${(share * 100).toFixed(1)}% of first draws `
      + 'fell below 0.35, expected ~35%. Every number below would be meaningless.');
  }
  console.log(`instrument check: ${(share * 100).toFixed(1)}% of wallets dig for odd coins (expect ~35%)`);
}

// Retail-priced SKUs only: the campaign-only repair components are not something a
// customer walks up to the counter with.
const SELLABLE = SHOP_CATALOG.filter((sku) => sku.msrp > 0 && !sku.campaign);

function basketFor(rng) {
  const count = 1 + Math.floor(rng() * 3); // 1–3 items, the shape the shop actually sees
  const items = [];
  for (let i = 0; i < count; i++) {
    const sku = SELLABLE[Math.floor(rng() * SELLABLE.length)];
    items.push({
      uid: `u${i}`,
      skuId: sku.id,
      name: sku.name,
      price: priceFor(skuById(sku.id), 1, null),
    });
  }
  return items;
}

const COIN_CENTS = 100;

function ringOne(items, rate, walletSeed) {
  const tx = createTx({ items, taxRate: rate, rng: rngFrom(walletSeed) });
  for (const item of tx.items) scanItem(tx, item.uid);
  tx.method = 'cash';
  const due = cashTotalOf(tx);
  const tendered = customerCash(tx);
  const handed = stackTotal(tendered);
  const change = Math.round((handed - due) * 100) / 100;
  const changeCents = Math.round(change * 100);
  const pieces = change > 0 ? makeChange(change) : {};
  const coinPieces = Object.entries(pieces)
    .filter(([denom]) => Number(denom) < 1)
    .reduce((sum, [, n]) => sum + n, 0);
  return {
    subtotal: subtotal(tx),
    net: netOf(tx),
    tax: taxOf(tx),
    total: totalOf(tx),
    due,
    handed,
    change,
    // The reporter's actual complaint: change that is not a whole number of dollars.
    subDollarComponent: changeCents % COIN_CENTS !== 0,
    coinPieces,
    wholeDollarTotal: Math.round(due * 100) % COIN_CENTS === 0,
  };
}

const SAMPLES = 4000;
const rows = [];

for (const j of SALES_TAX_JURISDICTIONS) {
  const rate = salesTaxRateOf(j.code);
  const bags = rngFrom(97);           // identical baskets for every jurisdiction
  let taxedOdd = 0;
  let untaxedOdd = 0;
  let taxedCoins = 0;
  let untaxedCoins = 0;
  let wholeTotals = 0;
  for (let i = 0; i < SAMPLES; i++) {
    const items = basketFor(bags);
    const walletSeed = 1000 + i;
    const taxed = ringOne(items, rate, walletSeed);
    const untaxed = ringOne(items, 0, walletSeed);
    if (taxed.subDollarComponent) taxedOdd += 1;
    if (untaxed.subDollarComponent) untaxedOdd += 1;
    taxedCoins += taxed.coinPieces;
    untaxedCoins += untaxed.coinPieces;
    if (taxed.wholeDollarTotal) wholeTotals += 1;
  }
  rows.push({
    code: j.code,
    state: j.state,
    rate: formatTaxRate(rate),
    subDollarChangeTaxed: `${((taxedOdd / SAMPLES) * 100).toFixed(1)}%`,
    subDollarChangeUntaxed: `${((untaxedOdd / SAMPLES) * 100).toFixed(1)}%`,
    coinsPerSaleTaxed: (taxedCoins / SAMPLES).toFixed(2),
    coinsPerSaleUntaxed: (untaxedCoins / SAMPLES).toFixed(2),
    wholeDollarTotals: `${((wholeTotals / SAMPLES) * 100).toFixed(1)}%`,
  });
}

console.log(`\n=== SUB-DOLLAR CHANGE, ${SAMPLES} baskets per jurisdiction, identical wallets ===\n`);
console.log('code state              rate    coin change (taxed / 0%)   coins per sale   whole-$ totals');
for (const r of rows) {
  console.log(
    r.code.padEnd(5),
    r.state.padEnd(18),
    r.rate.padEnd(7),
    `${r.subDollarChangeTaxed.padStart(6)} / ${r.subDollarChangeUntaxed.padStart(6)}`.padEnd(26),
    `${r.coinsPerSaleTaxed} / ${r.coinsPerSaleUntaxed}`.padEnd(16),
    r.wholeDollarTotals,
  );
}

// Worked examples at the starter's own rate, including the reporter's $24.00.
const NC = salesTaxRateOf('NC');
console.log(`\n=== WORKED TICKETS at ${formatTaxRate(NC)} (Pine Hills Municipal, North Carolina) ===\n`);
console.log('subtotal    tax     total    customer hands   change     pieces');
const examples = [
  [{ uid: 'x', skuId: 'balls1', name: 'flat 24', price: 24 }],
  ...Array.from({ length: 7 }, (_, i) => basketFor(rngFrom(31 + i * 7))),
];
for (const items of examples) {
  const r = ringOne(items, NC, 4242);
  const pieces = r.change > 0 ? makeChange(r.change) : {};
  const shape = Object.entries(pieces)
    .sort((a, b) => Number(b[0]) - Number(a[0]))
    .map(([d, n]) => `${n}×${Number(d) >= 1 ? `$${d}` : `${Math.round(Number(d) * 100)}c`}`)
    .join(' ');
  console.log(
    `$${r.subtotal.toFixed(2)}`.padStart(9),
    `$${r.tax.toFixed(2)}`.padStart(7),
    `$${r.total.toFixed(2)}`.padStart(8),
    `$${r.handed.toFixed(2)}`.padStart(15),
    `$${r.change.toFixed(2)}`.padStart(9),
    ` ${shape || '—'}`,
  );
}
console.log('');
