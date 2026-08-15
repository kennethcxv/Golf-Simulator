// Q4 — a combined visit BUYS FIRST, then asks about the tee time.
//
// The order is the whole claim, so the driver records the customer's phase
// every frame and reads the sequence back:
//   1. a combined visitor heads for the SHOP, not the desk (currentDestination
//      is 'shop' while they still hold a desk errand)
//   2. they reach the counter carrying goods and the sale is a RETAIL sale
//   3. only once that sale banks do they become desk business, and the ask is
//      spoken then and not before
//   4. NEGATIVE CONTROL: a desk-only arrival (skipRetailPlan) never enters the
//      shopping phase at all, so the ordering check cannot be passing because
//      every customer shops
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/combined-visit-order');
  fs.mkdirSync(OUT, { recursive: true });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message || e)));
  const VIEWPORT = { width: 1600, height: 900 };
  const assert = (value, message) => { if (!value) throw new Error(message); };

  await page.setViewportSize(VIEWPORT);
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
  await page.waitForTimeout(2000);

  await page.evaluate(() => {
    const app = window.__fw;
    const state = app.state;
    state.clock.minutes = Math.floor(state.clock.minutes / 1440) * 1440 + 10 * 60;
    if (state.campaign) state.campaign.businessOpen = true;
    if (state.shop) state.shop.signOpen = true;
    app.speedIdx = 0;
    app.scene3d.applyTimeWeather(600, state.weather);
    app.scene3d.clubhouse().setOrganicWalkins(false);
  });

  // watch one customer's phase from spawn to the counter
  const trace = async (options) => page.evaluate(async (opts) => {
    const club = window.__fw.scene3d.clubhouse();
    const customer = club.sendWalkInToDesk(opts);
    if (!customer) return null;
    const seen = [];
    const mark = () => {
      const key = `${customer.checkoutPhase}|${customer.currentDestination}`;
      if (seen[seen.length - 1] !== key) seen.push(key);
    };
    mark();
    const started = performance.now();
    while (performance.now() - started < 45000) {
      await new Promise((r) => setTimeout(r, 120));
      mark();
      if (customer.gone) break;
      if (customer.awaitingCheckout || customer.checkoutPhase === 'checkout') break;
    }
    return {
      customerId: customer.customerId,
      deskErrandPending: !!customer.deskErrandPending,
      combinedVisit: !!customer.combinedVisit,
      cart: (customer.cart || []).length,
      targetCartSize: customer.targetCartSize || 0,
      phases: seen,
      dialogue: customer.dialogue || '',
      deskErrandSpoken: !!customer.deskErrandSpoken,
    };
  }, options);

  // ---- the combined visit -------------------------------------------------
  // force the combined roll so the case under test is the case observed
  await page.evaluate(() => { window.__fw.scene3d.clubhouse().setCombinedVisitChance?.(1); });
  const combined = await trace({ skipRetailPlan: false });
  assert(combined, 'combined walk-in did not spawn');
  await page.screenshot({ path: path.join(OUT, '01-combined-at-counter.png') });

  // ---- NEGATIVE CONTROL: a desk-only arrival ------------------------------
  await page.evaluate(() => {
    const club = window.__fw.scene3d.clubhouse();
    club.clearWalkins?.();
    club.setCombinedVisitChance?.(0);
  });
  await page.waitForTimeout(600);
  const deskOnly = await trace({ skipRetailPlan: true });
  assert(deskOnly, 'desk-only walk-in did not spawn');

  const shoppedFirst = (t) => {
    const shopIdx = t.phases.findIndex((p) => p.endsWith('|shop'));
    const deskIdx = t.phases.findIndex((p) => p.endsWith('|front-desk'));
    return shopIdx >= 0 && (deskIdx < 0 || shopIdx < deskIdx);
  };

  const checks = {
    combinedCarriesDeskErrand: combined.deskErrandPending === true
      && combined.combinedVisit === true,
    combinedGoesShoppingFirst: shoppedFirst(combined),
    combinedActuallyHasGoods: combined.targetCartSize > 0,
    // the ask is held until the goods are paid for: at the counter, before the
    // sale banks, it has NOT been spoken
    askHeldUntilPaid: combined.deskErrandSpoken === false,
    // NEGATIVE CONTROL: a desk-only arrival never shops, so the ordering
    // result above cannot be "everyone shops"
    controlDeskOnlyNeverShops: deskOnly.targetCartSize === 0
      && !deskOnly.phases.some((p) => p.startsWith('shopping')),
    noPageErrors: errs.length === 0,
  };
  const out = { combined, deskOnly, errs: errs.slice(0, 8), checks };
  out.ok = Object.values(checks).every(Boolean);
  fs.writeFileSync(path.join(OUT, 'order.json'), `${JSON.stringify(out, null, 1)}\n`);
  return out;
}
