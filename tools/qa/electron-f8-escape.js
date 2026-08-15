// F8 (Full_Goal_16) — the combined visitor's unpaid-exit escape, both ways.
//   ESCAPE LEG (__f8LegacyClassifier on — the old branch order, runtime-only):
//     a staged combined visitor shops, arrives at the counter holding goods,
//     and the walk-in classifier steals them into desk business — cart > 0
//     while checkoutPhase is walk-in-waiting IS the escape class (both desk
//     outcomes then release them to the door and the goods silently
//     restock). The invariant net must also SEE a violation when they leave.
//   FIXED LEG (flag off): the same staging keeps them a SHOPPER at the head
//     (cart branch wins; items go to the mat; deskErrandPending stays armed
//     for the post-payment ask via beginPendingDesk), and no violation ever
//     logs. A pure desk-only walk-in (negative control) still classifies as
//     desk business immediately — the gate is scoped to held goods.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/f8-escape');
  fs.mkdirSync(OUT, { recursive: true });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message || e)));
  const f8Logs = [];
  page.on('console', (m) => { if (m.text().includes('[F8-INVARIANT]')) f8Logs.push(m.text()); });
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  const boot = await import(`file:///${bootPath}`);
  await boot.clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForTimeout(2000);
  await page.bringToFront().catch(() => {});
  const out = { errs };

  // stock at least one shelf so the retail half has something to pick, and
  // open the sign so staged customers are not swept
  out.prep = await page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse();
    ch.setCombinedVisitChance?.(1);
    const state = window.__fw.state;
    const fixtures = (state.shop.fixtures || []).filter((f) => f.skus && f.skus.length);
    return { fixturesWithSkus: fixtures.length };
  });

  async function runLeg(name, { legacy }) {
    const leg = { name, legacy };
    await page.evaluate(([lg]) => {
      window.__f8LegacyClassifier = !!lg;
      window.__f8Violations = [];
      const ch = window.__fw.scene3d.clubhouse();
      window.__f8c = ch.sendWalkInToDesk({ skipRetailPlan: false, requestedTeeMinute: 600 });
      return true;
    }, [legacy]);
    // follow them up to 75 real seconds: shopping -> counter head
    const t0 = Date.now();
    let seen = null;
    while (Date.now() - t0 < 75000) {
      seen = await page.evaluate(() => {
        const c = window.__f8c;
        if (!c) return null;
        return {
          cart: c.cart.length,
          phase: c.checkoutPhase || null,
          errand: !!c.deskErrandPending,
          combined: !!c.combinedVisit,
          type: c.customerType,
          awaiting: !!c.awaitingCheckout,
          rejected: !!c.walkInRejected,
          released: !!c.reservationReleased,
          stop: c.stops && c.stops[c.stopIdx] ? c.stops[c.stopIdx].kind : null,
          violations: (window.__f8Violations || []).length,
        };
      });
      if (!seen) break;
      if (legacy && seen.phase === 'walk-in-waiting') break; // the theft happened
      if (!legacy && (seen.phase === 'placing' || seen.awaiting)) break; // the cart branch won
      if (seen.stop === 'gone') break;
      await page.waitForTimeout(900);
    }
    leg.atCounter = seen;
    await page.screenshot({ path: path.join(OUT, `${name}-counter.png`) });

    if (legacy && seen && seen.phase === 'walk-in-waiting') {
      // drive the desk outcome the fast way: reject the walk-in through the
      // same state fields the monitor's decline uses, then let them walk out
      await page.evaluate(() => {
        const c = window.__f8c;
        c.walkInRejected = true;
        c.checkoutPhase = null;
        // step them to the exit leg of their stops like the decline path does
        const exitIdx = c.stops.findIndex((s) => s.kind === 'exit');
        if (exitIdx >= 0) c.stopIdx = exitIdx;
      });
      const t1 = Date.now();
      let gone = null;
      while (Date.now() - t1 < 30000) {
        gone = await page.evaluate(() => ({
          stop: window.__f8c.stops[window.__f8c.stopIdx]?.kind || 'done',
          cart: window.__f8c.cart.length,
          violations: (window.__f8Violations || []).length,
        }));
        if (gone.violations > 0 || gone.stop === 'gone' || gone.cart === 0) break;
        await page.waitForTimeout(700);
      }
      leg.exit = gone;
    }
    return leg;
  }

  // ESCAPE LEG: the old classifier, reintroduced runtime-only
  out.escape = await runLeg('escape-legacy', { legacy: true });
  // clear the stage: remove the staged customer so legs cannot interfere
  await page.evaluate(() => {
    const c = window.__f8c;
    if (c) {
      const exitIdx = c.stops.findIndex((s) => s.kind === 'gone');
      if (exitIdx >= 0) c.stopIdx = exitIdx;
    }
    window.__f8LegacyClassifier = false;
  });
  await page.waitForTimeout(2500);

  // FIXED LEG: same staging, gate live
  out.fixed = await runLeg('fixed', { legacy: false });

  // NEGATIVE CONTROL: a PURE desk walk-in (no goods) must still classify as
  // desk business at once — the gate is scoped to held goods only
  out.pureDesk = await page.evaluate(async () => {
    const ch = window.__fw.scene3d.clubhouse();
    const c = ch.sendWalkInToDesk({ requestedTeeMinute: 660 });
    if (!c) return { fail: 'no spawn' };
    const t0 = performance.now();
    while (performance.now() - t0 < 20000) {
      if (c.checkoutPhase === 'walk-in-waiting') break;
      await new Promise((res) => { setTimeout(res, 400); });
    }
    return { phase: c.checkoutPhase, cart: c.cart.length };
  });

  out.f8ConsoleLines = f8Logs;
  out.checks = {
    escapeReproduced: !!(out.escape.atCounter
      && out.escape.atCounter.phase === 'walk-in-waiting'
      && out.escape.atCounter.cart > 0),
    invariantSawEscape: !!(out.escape.exit && out.escape.exit.violations > 0),
    fixedStaysShopper: !!(out.fixed.atCounter
      && out.fixed.atCounter.phase !== 'walk-in-waiting'
      && out.fixed.atCounter.errand === true
      && out.fixed.atCounter.violations === 0),
    pureDeskStillClassifies: out.pureDesk.phase === 'walk-in-waiting' && out.pureDesk.cart === 0,
    noPageErrors: errs.length === 0,
  };
  out.ok = Object.values(out.checks).every(Boolean);
  fs.writeFileSync(path.join(OUT, 'f8.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
