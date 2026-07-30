async (page) => {
  // THE SALES-TAX LIABILITY, ON THE FINANCES PAGE, WITH MONEY ACTUALLY IN IT.
  //
  //   node tools/qa/run-playwright.cjs tools/qa/laptop-sales-tax-card.js
  //
  // Reported 2026-07-29: "The tax is not the player's money — it accrues as a liability and is
  // remitted, visible in Finances."
  //
  // "Visible" is a claim about the render, so this rings real sales through the sim, opens the
  // laptop, and photographs the card — twice: once for the starter's North Carolina 7%, and
  // once with the deed moved to Oregon, where the card has to say the register adds nothing
  // rather than showing an empty 0% liability. The Oregon pass is the negative control: if the
  // card were hardcoded copy, both shots would read the same.
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = path.resolve(process.env.QA_REPO_ROOT || process.cwd());
  const outDir = path.resolve(process.env.GREYBOX_DATA_OUT
    || path.join(repo, 'Designs', 'ProShop', 'Greybox', 'data'));
  fs.mkdirSync(outDir, { recursive: true });
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const SEED = Number(process.env.GREYBOX_SEED || 20260727);

  const errs = [];
  page.on('pageerror', (e) => errs.push(`PAGEERROR: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(`CONSOLE: ${m.text()}`); });

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(`${baseUrl}?clubhouse=pine-hills-v2`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(600);
  await page.evaluate(async (seed) => {
    localStorage.clear();
    const E = await import('/src/sim/empire.js');
    localStorage.setItem('golfempire:autosave', JSON.stringify(E.empireSnapshot(E.newStarterEmpire('relaxed', seed))));
  }, SEED);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  await page.getByRole('button', { name: /^Continue/ }).first().click();
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 120000 });
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 120000 });
  await page.waitForTimeout(3000);

  // Ring three real sales so the liability has money in it. Through checkoutSale, which is the
  // sim's own command — a hand-written state.salesTax.owed would prove only that the card can
  // print a number it was given.
  const rung = await page.evaluate(async () => {
    const app = window.__fw;
    const st = app.state;
    const C = await import('/src/sim/checkout.js');
    const T = await import('/src/sim/salesTax.js');
    const results = [];
    for (const [skuId, price] of [['balls2', 30], ['cap1', 22], ['glove1', 26]]) {
      st.shop.inventory[skuId].shelf = Math.max(2, st.shop.inventory[skuId].shelf);
      const pick = C.pickFromShelf(st, skuId);
      if (!pick.ok) { results.push({ skuId, ok: false, reason: pick.reason }); continue; }
      const sale = C.checkoutSale(st, [{ uid: pick.uid, skuId, price }], 'QA walk-in');
      results.push({ skuId, ok: sale.ok, net: sale.net, tax: sale.tax, total: sale.total });
    }
    return {
      results,
      jurisdiction: T.taxJurisdictionLabel(st),
      owed: T.salesTaxOwed(st),
      revenue: st.ledger?.today?.revenue?.shopSales || 0,
    };
  });

  const openLaptop = async () => {
    await page.evaluate(async () => {
      const app = window.__fw;
      const L = await import('/src/data/shopLayout.js');
      const origin = app.scene3d.clubhouse().interior.position;
      const st = app.scene3d.walk.state;
      const laptop = L.FRONT_DESK.laptop;
      const seat = { x: L.FRONT_DESK.staffChair.x, z: L.FRONT_DESK.staffChair.z };
      st.x = seat.x + origin.x;
      st.z = seat.z + origin.z;
      const dx = laptop.x - seat.x;
      const dz = laptop.z - seat.z;
      const horizontal = Math.hypot(dx, dz) || 0.001;
      st.yaw = Math.atan2(-dx / horizontal, -dz / horizontal);
      st.pitch = Math.atan2(1.06 - 1.62, horizontal);
      const clock = app.state.clock;
      clock.minutes = Math.floor(clock.minutes / 1440) * 1440 + 9 * 60;
      app.scene3d.applyTimeWeather(9 * 60, app.state.weather);
    });
    await page.waitForTimeout(800);
    await page.keyboard.press('KeyE');
    let open = await page.waitForFunction(() => window.__fw.laptopOpen === true, null, { timeout: 6000 })
      .then(() => true).catch(() => false);
    if (!open) {
      await page.evaluate(async () => {
        const app = window.__fw;
        const L = await import('/src/data/shopLayout.js');
        const origin = app.scene3d.clubhouse().interior.position;
        const st = app.scene3d.walk.state;
        const laptop = L.FRONT_DESK.laptop;
        st.x = laptop.x + origin.x;
        st.z = laptop.z + 0.95 + origin.z;
        st.yaw = Math.atan2(0, 0.95);
        st.pitch = Math.atan2(1.06 - 1.62, 0.95);
      });
      await page.waitForTimeout(700);
      await page.keyboard.press('KeyE');
      open = await page.waitForFunction(() => window.__fw.laptopOpen === true, null, { timeout: 9000 })
        .then(() => true).catch(() => false);
    }
    await page.waitForFunction(() => {
      const r = document.querySelector('.laptop-screen');
      return r && r.style.display !== 'none';
    }, null, { timeout: 15000 }).catch(() => {});
    return open;
  };
  const laptopOpened = await openLaptop();
  await page.waitForTimeout(1400);

  const goToFinances = async () => {
    await page.evaluate(() => window.__fw.laptop.go('finances'));
    await page.waitForTimeout(700);
  };
  await goToFinances();
  await page.screenshot({ path: path.join(outDir, 'laptop-salestax-1-taxed.png') });

  const readCard = () => page.evaluate(() => {
    const heads = [...document.querySelectorAll('.lt-minihead')];
    const head = heads.find((h) => (h.textContent || '').includes('Sales Tax'));
    if (!head) return null;
    const card = head.closest('.lt-card');
    const rows = [...card.querySelectorAll('.lt-row')].map((r) => r.textContent.trim());
    return {
      chip: card.querySelector('.lt-chip')?.textContent || null,
      rows,
      meta: [...card.querySelectorAll('.lt-meta')].map((m) => m.textContent.trim()),
      text: card.textContent.replace(/\s+/g, ' ').trim(),
    };
  });
  const taxedCard = await readCard();

  // NEGATIVE CONTROL: move the deed to a state with no sales tax and redraw. The card must
  // change what it SAYS, not just the number it shows.
  await page.evaluate(() => {
    window.__fw.state.property.taxJurisdiction = 'OR';
    window.__fw.state.salesTax = null;   // a fresh Oregon club has collected nothing
    window.__fw.laptop.render();
  });
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(outDir, 'laptop-salestax-2-oregon.png') });
  const oregonCard = await readCard();

  const findings = {
    laptopOpened,
    salesRang: rung.results.every((r) => r.ok),
    // Cash rose by the ticket, revenue by the goods, and the difference is held.
    liabilityAccrued: rung.owed > 0,
    revenueExcludesTax: Math.abs(rung.revenue - rung.results.reduce((sum, r) => sum + (r.net || 0), 0)) < 0.01,
    liabilityEqualsChargedTax: Math.abs(rung.owed - rung.results.reduce((sum, r) => sum + (r.tax || 0), 0)) < 0.01,
    cardVisible: !!taxedCard,
    cardNamesTheState: !!taxedCard && /North Carolina/.test(taxedCard.chip || ''),
    cardShowsTheRate: !!taxedCard && /7%/.test(taxedCard.chip || ''),
    cardShowsHeldAmount: !!taxedCard && /Held for the state/.test(taxedCard.text),
    // THE CENTS ARE THE POINT of a tax liability. The first run printed "$5" for $5.46
    // because formatMoney rounds to the dollar; a card that hides the cents cannot be
    // reconciled against a receipt.
    cardKeepsTheCents: !!taxedCard
      && taxedCard.text.includes(`Held for the state$${rung.owed.toFixed(2)}`),
    cardSaysItIsNotYours: !!taxedCard && /not yours/.test(taxedCard.text),
    // The control.
    oregonCardVisible: !!oregonCard,
    oregonNamesTheState: !!oregonCard && /Oregon/.test(oregonCard.chip || ''),
    oregonSaysNothingIsCharged: !!oregonCard && /no general sales tax/.test(oregonCard.text),
    oregonDropsTheHeldRow: !!oregonCard && !/Held for the state/.test(oregonCard.text),
    cardsDiffer: !!taxedCard && !!oregonCard && taxedCard.text !== oregonCard.text,
  };

  const result = {
    what: 'the sales-tax liability card in Finances, with real sales behind it, in two jurisdictions',
    rung,
    taxedCard,
    oregonCard,
    findings,
    shots: ['laptop-salestax-1-taxed.png', 'laptop-salestax-2-oregon.png'],
    errs: errs.slice(0, 12),
    ok: Object.values(findings).every((v) => v === true) && errs.length === 0,
  };
  fs.writeFileSync(path.join(outDir, 'laptop-sales-tax-card.json'), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}
