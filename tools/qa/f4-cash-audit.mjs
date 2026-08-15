// F4 (Full_Goal_16) — AUDIT FIRST. What does customerCash actually put on the
// desk, over 400 seeded sales at mixed totals? Reports: how often the tender
// carries sub-quarter coins (the "$29.96 counted out exactly" complaint), how
// often it is a clean note step, the goal's own fixture case, and the
// round-$20 negative control. Run BEFORE the fix to reproduce the complaint,
// and again AFTER to show only the intended branch changed.
import { createTx, customerCash, scanItem, stackTotal } from '../../src/sim/register.js';

// deterministic rng — the audit must say the same thing twice
function mulberry32(a) {
  return function next() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PRICES = [1.5, 2.25, 3.99, 4.5, 6.75, 8.99, 12.5, 14.99, 19.99, 24.5, 29.96, 34.99, 42.0, 55.25, 68.99, 89.5];
const SUB_QUARTER = ['0.1', '0.05', '0.01'];

function auditRun(samples = 400, seed = 20260807) {
  const rng = mulberry32(seed);
  const out = {
    samples,
    subQuarterTenders: 0,
    cleanStepTenders: 0,
    oddCoinTenders: 0,
    fallbackNull: 0,
    examples: { subQuarter: [], oddCoin: [] },
  };
  for (let i = 0; i < samples; i += 1) {
    const n = 1 + Math.floor(rng() * 4);
    const items = Array.from({ length: n }, (_, k) => ({
      uid: `u${i}-${k}`, skuId: `sku${k}`, price: PRICES[Math.floor(rng() * PRICES.length)],
    }));
    const tx = createTx({ items, rng, taxRate: 0.07, taxLabel: 'tax' });
    for (const it of tx.items) scanItem(tx, it.uid); // netOf counts SCANNED items only
    const tendered = customerCash(tx);
    if (!tendered) { out.fallbackNull += 1; continue; }
    const total = stackTotal(tendered);
    const cents = Math.round(total * 100) % 100;
    const hasSub = SUB_QUARTER.some((d) => (tendered[d] || 0) > 0);
    if (hasSub) {
      out.subQuarterTenders += 1;
      if (out.examples.subQuarter.length < 5) out.examples.subQuarter.push({ total, stack: tendered });
    }
    if (cents === 0 && (Math.round(total) % 5 === 0)) out.cleanStepTenders += 1;
    else {
      out.oddCoinTenders += 1;
      if (out.examples.oddCoin.length < 5) out.examples.oddCoin.push({ total, stack: tendered });
    }
  }
  return out;
}

// the goal's own fixture: a $35.31-class due must arrive as clean notes
function fixture() {
  const mk = (price, r) => {
    const tx = createTx({ items: [{ uid: 'f', skuId: 'f', price }], rng: () => r, taxRate: 0 });
    scanItem(tx, 'f');
    return { due: price, tendered: customerCash(tx) };
  };
  return {
    // r=0.9 keeps the odd-cents branch OFF; r=0.1 forces it ON
    due3531_noOdd: mk(35.31, 0.9),
    due3531_oddBranch: mk(35.31, 0.1),
    due2996_oddBranch: mk(29.96, 0.1),
    control_round20: mk(20.0, 0.9),
    control_round20_oddBranchToo: mk(20.0, 0.1), // no odd cents exist on a round due
  };
}

const audit = auditRun();
const fix = fixture();
console.log(JSON.stringify({ audit, fixture: fix }, null, 1));
