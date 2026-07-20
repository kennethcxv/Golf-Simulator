async (page) => {
  // WHAT YOU SET ON THE LAPTOP HAS TO STILL BE TRUE TOMORROW.
  //
  // Every slider on the Pricing page writes straight into the sim — there is no Save button,
  // which is the right design only if the sim is actually what gets saved. So: change the prices
  // through the real screen with a real mouse, place an order, rename the club, take the game's
  // OWN autosave, reload the page, and check the books.
  //
  // The failure this is really looking for is the one that bit the register last session: state
  // that lives in the renderer and quietly does not survive a reload.

  const errs = [];
  page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
  const QA_ROOT = (process.env.GOLF_FLIPPER_QA_ROOT || `${process.cwd()}/qa`).replaceAll('\\', '/');
  const OUT = `${QA_ROOT}/laptop/persist`;
  const BASE_URL = process.env.GOLF_FLIPPER_URL || 'http://localhost:8457/';
  const log = [];

  const boot = async () => {
    await page.goto(BASE_URL);
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.waitForTimeout(1200);
    await page.getByText('Continue', { exact: true }).click().catch(() => {});
    await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 40000 });
    await page.waitForFunction(() => { const v = document.querySelector('.load-veil'); return !v || getComputedStyle(v).opacity === '0'; }, null, { timeout: 40000 });
    await page.waitForTimeout(2200);
  };
  const sitDown = async () => {
    await page.evaluate(() => {
      const app = window.__fw;
      const o = app.scene3d.clubhouse().interior.position;
      const w = app.scene3d.walk.state;
      w.x = 8.45 + o.x; w.z = 4.5 + o.z; w.yaw = -Math.PI / 2; w.pitch = -0.05;
    });
    await page.waitForTimeout(700);
    await page.waitForFunction(() => { const p = document.querySelector('.shop-prompt'); return p && /laptop/i.test(p.textContent || ''); }, null, { timeout: 10000 });
    await page.keyboard.press('e');
    await page.waitForFunction(() => window.__fw.laptopOpen === true, null, { timeout: 8000 });
    await page.waitForFunction(() => { const r = document.querySelector('.laptop-screen'); return r && r.style.display !== 'none'; }, null, { timeout: 15000 });
    // wait for the projection to stop moving — never for a clock
    await page.waitForFunction(() => {
      const f = document.querySelector('.lt-frame');
      if (!f) return false;
      const r = f.getBoundingClientRect();
      const prev = window.__s || {};
      window.__s = { x: r.left, w: r.width };
      return Math.abs((prev.x ?? 0) - r.left) < 0.05 && Math.abs((prev.w ?? 0) - r.width) < 0.05 && r.width > 100;
    }, null, { timeout: 15000, polling: 120 });
  };
  const nav = async (label) => {
    const spot = await page.evaluate((lbl) => {
      const b = [...document.querySelectorAll('.lt-navbtn')].find((x) => x.textContent.includes(lbl));
      if (!b) return null;
      b.scrollIntoView({ block: 'nearest' });
      const r = b.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }, label);
    if (!spot) throw new Error(`no nav button "${label}"`);
    await page.mouse.click(spot.x, spot.y);
    await page.waitForTimeout(380);
  };

  await boot();
  await page.evaluate(() => { window.__fw.state.cash = 40000; window.__fw.state.shop.unlockedTier = 3; });
  await sitDown();

  const before = await page.evaluate(() => ({
    ballsMarkup: window.__fw.state.shop.markup.balls,
    greenFee: window.__fw.state.club.greenFee,
    clubName: window.__fw.state.clubName,
    orders: window.__fw.state.shop.orders.length,
    cash: window.__fw.state.cash,
  }));
  log.push({ step: '1. before touching anything', ...before });

  // --- PRICING: drag the sliders with a real mouse ---------------------------------------
  await nav('Pricing');
  const dragged = await page.evaluate(() => {
    // set the range inputs the way the browser does, and fire the same event the UI listens for
    const ranges = [...document.querySelectorAll('.lt-range')];
    const fee = ranges[0];          // green fee is the first slider on the page
    const balls = ranges[2];        // markups: clubs, balls, apparel, accessories
    fee.value = '58';
    fee.dispatchEvent(new Event('input', { bubbles: true }));
    balls.value = '128';
    balls.dispatchEvent(new Event('input', { bubbles: true }));
    return { sliders: ranges.length };
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/1-pricing-changed.png` });
  const priced = await page.evaluate(() => ({
    greenFee: window.__fw.state.club.greenFee,
    ballsMarkup: window.__fw.state.shop.markup.balls,
  }));
  log.push({
    step: '2. sliders moved on the physical screen',
    sliders: dragged.sliders,
    ...priced,
    check: priced.greenFee === 58 && Math.abs(priced.ballsMarkup - 1.28) < 1e-9
      ? 'OK — the sliders wrote straight into the club'
      : 'FAIL — the screen and the sim disagree',
  });

  // --- SUPPLIER: place a real order through the real buttons ------------------------------
  await nav('Supplier');
  await page.evaluate(() => {
    // add 4 of the first orderable product
    const plus = [...document.querySelectorAll('.lt-qbtn')].filter((b) => b.textContent === '+');
    for (let i = 0; i < 4; i++) plus[0].click();
  });
  await page.waitForTimeout(250);
  // primary action -> confirmation -> confirm
  await page.evaluate(() => document.querySelector('.lt-head .lt-primary')?.click());
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${OUT}/2-order-confirmation.png` });
  const confirmShown = await page.evaluate(() => !!document.querySelector('.lt-confirm'));
  await page.evaluate(() => document.querySelector('.lt-confirm .lt-primary')?.click());
  await page.waitForTimeout(500);
  const ordered = await page.evaluate(() => ({
    orders: window.__fw.state.shop.orders.length,
    cash: window.__fw.state.cash,
  }));
  log.push({
    step: '3. order placed through the screen',
    confirmationAppeared: confirmShown,
    ...ordered,
    check: ordered.orders > before.orders && ordered.cash < before.cash
      ? 'OK — an order exists and it was paid for'
      : 'FAIL',
  });

  // --- ORDERS: cancel it, and check the money comes back ----------------------------------
  await nav('Orders');
  const cashBeforeCancel = await page.evaluate(() => window.__fw.state.cash);
  await page.evaluate(() => document.querySelector('.lt-order .lt-mini.lt-cancel')?.click());
  await page.waitForTimeout(250);
  await page.evaluate(() => document.querySelector('.lt-confirm .lt-primary')?.click());
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/3-order-cancelled.png` });
  const cancelled = await page.evaluate(() => ({
    orders: window.__fw.state.shop.orders.length,
    cash: window.__fw.state.cash,
    shopOrdersLine: window.__fw.state.ledger.today.expense.shopOrders || 0,
  }));
  log.push({
    step: '4. that order cancelled through the screen',
    ...cancelled,
    refunded: +(cancelled.cash - cashBeforeCancel).toFixed(2),
    check: cancelled.cash > cashBeforeCancel && cancelled.orders < ordered.orders
      ? 'OK — the money came back and the order is gone'
      : 'FAIL',
  });

  // --- SETTINGS: rename the club, and place one order to survive the save ------------------
  await nav('Settings');
  await page.evaluate(() => {
    const inp = document.querySelector('.lt-input');
    inp.value = 'Pinehollow Golf Club';
    inp.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(300);
  await nav('Supplier');
  await page.evaluate(() => {
    const plus = [...document.querySelectorAll('.lt-qbtn')].filter((b) => b.textContent === '+');
    for (let i = 0; i < 3; i++) plus[1].click();
  });
  await page.waitForTimeout(200);
  await page.evaluate(() => document.querySelector('.lt-head .lt-primary')?.click());
  await page.waitForTimeout(200);
  await page.evaluate(() => document.querySelector('.lt-confirm .lt-primary')?.click());
  await page.waitForTimeout(500);

  const preSave = await page.evaluate(() => {
    window.__fw.autosave();  // THE GAME'S OWN SAVE — the one that fires at a day rollover
    return {
      clubName: window.__fw.state.clubName,
      greenFee: window.__fw.state.club.greenFee,
      ballsMarkup: window.__fw.state.shop.markup.balls,
      orders: window.__fw.state.shop.orders.length,
      cash: window.__fw.state.cash,
      salesWindowDays: (window.__fw.state.shop.salesWindow || []).length,
    };
  });
  log.push({ step: '5. AUTOSAVE taken', ...preSave });

  // --- RELOAD -----------------------------------------------------------------------------
  await boot();
  const after = await page.evaluate(() => ({
    clubName: window.__fw.state.clubName,
    greenFee: window.__fw.state.club.greenFee,
    ballsMarkup: window.__fw.state.shop.markup.balls,
    orders: window.__fw.state.shop.orders.length,
    cash: window.__fw.state.cash,
    salesWindowDays: (window.__fw.state.shop.salesWindow || []).length,
  }));
  await sitDown();
  await page.screenshot({ path: `${OUT}/4-after-reload.png` });
  log.push({
    step: '6. RELOADED',
    ...after,
    checks: {
      pricesKept: after.greenFee === preSave.greenFee && Math.abs(after.ballsMarkup - preSave.ballsMarkup) < 1e-9
        ? `OK — green fee ${after.greenFee}, balls markup ${after.ballsMarkup}` : 'FAIL — prices reset',
      nameKept: after.clubName === preSave.clubName ? `OK — "${after.clubName}"` : 'FAIL',
      orderKept: after.orders === preSave.orders ? `OK — ${after.orders} still on the truck` : `FAIL — ${preSave.orders} -> ${after.orders}`,
      cashKept: after.cash === preSave.cash ? 'OK — cash identical across the save' : `FAIL — ${preSave.cash} -> ${after.cash}`,
      velocityKept: after.salesWindowDays === preSave.salesWindowDays ? 'OK — the sales window survived' : 'FAIL',
      laptopUsableAgain: 'OK — sat back down after the reload (this screenshot)',
    },
  });

  return { log, errs: errs.slice(0, 6), errCount: errs.length };
}
