// ITEM 13 — "Nobody pays with change due so the drawer is unused. Make it
// common. Report the 1x split: exact, needs change, card."
//
// MEASURE FIRST. The complaint names an outcome ("the drawer is unused") and a
// cause ("nobody pays with change due"), and those are two different claims —
// the drawer can go unused because change is rare, OR because cash itself is
// rare, OR because change is due but handed over some other way. Guessing which
// and then "fixing" it is how six fixes here shipped green with no effect.
//
// So this samples the REAL functions the live register uses — customerCash and
// cashTotalOf from src/sim/register.js — across a wide spread of baskets, at 1x,
// and reports the split three ways:
//     card            the customer never opens the drawer
//     cash, exact     cash, and the tender equals the total: no change
//     cash, change    cash, and change is owed: the drawer opens
//
// Negative control: the same tally is run with the tender forced equal to the
// total, which must report 100% exact. A splitter that cannot see an exact
// payment cannot be trusted when it says exacts are rare.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/change-split');
  fs.mkdirSync(OUT, { recursive: true });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message || e)));

  await page.setViewportSize({ width: 1280, height: 720 });
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 240000 });
  await page.waitForTimeout(2500);

  const result = await page.evaluate(async () => {
    const reg = await import(new URL('src/sim/register.js', document.baseURI).href);
    const bag = await import(new URL('src/sim/paymentBag.js', document.baseURI).href);
    const app = window.__fw;
    // THE AUTHORITY IS THE BAG, not the identity trait. customerIdentity's
    // paymentPreference says of itself: "A neutral coin. Counter payments are
    // governed by the balanced shuffled bag (sim/paymentBag.js); this trait is
    // only a fallback/dialogue flavour." The first run of this driver read the
    // trait, found it 100% card across 1,961 identities, and would have had me
    // "fix" a number the counter never consults.

    // a deterministic stream so the run is repeatable
    let seed = 0x2f6e2b1;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };

    // PRICE COMES FROM THE CATALOG, not the inventory line. The first cut read
    // `inventory[id].price`, which does not exist — every price came back 0, so
    // cashTotalOf returned 0, every cash sample was discarded by the due>0
    // guard, and the tally reported 100% CARD from a bag that is provably
    // 15/15. The bag was never wrong; the harness was.
    const catalog = await import(new URL('src/data/shopItems.js', document.baseURI).href);
    const shopSim = await import(new URL('src/sim/shop.js', document.baseURI).href).catch(() => null);
    const skus = Object.keys(app.state.shop.inventory || {})
      .filter((id) => catalog.skuById(id));
    // and only SKUs that actually carry a price, so no sample is ever
    // discarded - a discarded sample is how this driver first reported 100% card
    const priceOf = (id) => {
      const sku = catalog.skuById(id);
      if (!sku) return 0;
      // the live sell price if the sim exposes one, else the catalogue's msrp
      const live = shopSim?.priceOf ? Number(shopSim.priceOf(app.state, id)) : NaN;
      return Number.isFinite(live) && live > 0 ? live : (Number(sku.msrp) || 0);
    };

    const priced = skus.filter((id) => priceOf(id) > 0);
    const makeTx = (rng) => {
      // a plausible basket: one to four lines
      const count = 1 + Math.floor(rng() * 4);
      const items = [];
      for (let i = 0; i < count; i += 1) {
        const id = priced[Math.floor(rng() * priced.length)];
        items.push({ uid: `u${i}`, skuId: id, price: priceOf(id), scanned: true, bagged: true });
      }
      return { items, rng, tendered: null, tenderedTotal: null };
    };

    const tally = (forceExact) => {
      const out = { card: 0, cashExact: 0, cashChange: 0, samples: 0, zeroDue: 0, changeAmounts: [], totals: [] };
      for (let i = 0; i < 4000; i += 1) {
        out.samples += 1;
        // payment preference: the same generator the identities use
        const method = bag.drawPaymentMethod(app.state, rand);
        if (method === 'card') { out.card += 1; continue; }
        const tx = makeTx(rand);
        let due = 0;
        try { due = reg.cashTotalOf(tx); } catch { due = 0; }
        if (!(due > 0)) { out.samples -= 1; out.zeroDue += 1; continue; }
        let tendered = 0;
        if (forceExact) tendered = due;
        else {
          try {
            const stack = reg.customerCash(tx);
            tendered = Object.entries(stack || {}).reduce(
              (sum, [denom, n]) => sum + Number(denom) * n, 0,
            );
          } catch { tendered = due; }
        }
        const change = Math.round((tendered - due) * 100) / 100;
        out.totals.push(Math.round(due * 100) / 100);
        if (change <= 0.0001) out.cashExact += 1;
        else { out.cashChange += 1; out.changeAmounts.push(change); }
      }
      const pct = (n) => +((n / Math.max(1, out.samples)) * 100).toFixed(1);
      return {
        samples: out.samples,
        // surfaced so a discarded-sample bug can never hide behind a clean split
        discardedZeroDue: out.zeroDue,
        card: out.card, cardPct: pct(out.card),
        cashExact: out.cashExact, cashExactPct: pct(out.cashExact),
        cashChange: out.cashChange, cashChangePct: pct(out.cashChange),
        medianChange: out.changeAmounts.length
          ? +out.changeAmounts.sort((a, b) => a - b)[Math.floor(out.changeAmounts.length / 2)].toFixed(2)
          : null,
        medianTotal: out.totals.length
          ? +out.totals.sort((a, b) => a - b)[Math.floor(out.totals.length / 2)].toFixed(2)
          : null,
      };
    };

    return { live: tally(false), control: tally(true) };
  });

  const checks = {
    sampled: result.live.samples > 500,
    // the bag promises 50/50 over complete batches
    cashIsHalfOfPayments: Math.abs(result.live.cardPct - 50) < 6,
    nothingSilentlyDiscarded: result.live.discardedZeroDue === 0,
    // The control must see exacts, or "exacts are rare" means nothing. It is
    // measured against the CASH half, not the whole sample - half of every run
    // is card and can never be exact-or-change either way.
    controlHasNoChangeDue: result.control.cashChangePct === 0,
    controlSeesEveryCashAsExact:
      result.control.cashExact === (result.control.samples - result.control.card),
    noPageErrors: errs.length === 0,
  };
  const out = { ...result, errs: errs.slice(0, 8), checks };
  out.ok = Object.values(checks).every(Boolean);
  fs.writeFileSync(path.join(OUT, 'change-split.json'), `${JSON.stringify(out, null, 1)}\n`);
  return out;
}
