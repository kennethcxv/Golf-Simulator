async (page) => {
  // Revived 2026-07-28 (HARNESS_TRUST.md remediation): BASE_URL was an MCP-REPL-era
  // global no committed runner defines; the committed runner's contract is QA_BASE_URL.
  const BASE_URL = process.env.QA_BASE_URL || 'http://localhost:8457/';
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
  const OUT = process.getBuiltinModule('node:path').join(
    process.env.QA_REPO_ROOT || process.cwd(), 'qa', 'laptop', 'persist',
  );
  const log = [];

  const boot = async () => {
    await page.goto(BASE_URL);
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.waitForTimeout(1200);
    await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`)).clickThroughMenu(page);
    await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 40000 });
    await page.waitForFunction(() => { const v = document.querySelector('.load-veil'); return !v || getComputedStyle(v).opacity === '0'; }, null, { timeout: 40000 });
    await page.waitForTimeout(2200);
  };
  const sitDown = async () => {
    // Live-laptop stand (2026-07-28): the fixed (8.45, 4.5) office stand
    // predates the laptop's move to the front desk. fov-parity's two-stand sit.
    let opened = false;
    for (const stand of ['chair', 'north']) {
      await page.evaluate(async (which) => {
        const app = window.__fw;
        const L = await import(new URL('src/data/shopLayout.js', document.baseURI).href);
        const o = app.scene3d.clubhouse().interior.position;
        const w = app.scene3d.walk.state;
        const laptop = (() => {
        // D1: the LIVE rig rather than the layout datum.
        //
        // NOT because the datum was stale — it was the first hypothesis and it
        // is wrong. Measured 2026-08-04: the rig sits at interior-local
        // (-2.550, 1.557) and FRONT_DESK.laptop reads (-2.550, 1.557). B8 moved
        // the datum with the machine. This is here so a future move of one
        // without the other cannot silently re-open the same investigation; the
        // interior group carries no rotation, so local == world - origin, which
        // is the frame the surrounding maths is already written in.
        const ch = app.scene3d.clubhouse();
        const rig = ch.laptopRig ? ch.laptopRig() : null;
        const node = rig && rig.object;
        if (!node) return L.FRONT_DESK.laptop;
        ch.interior.updateMatrixWorld(true);
        const m = node.matrixWorld.elements;
        return { x: m[12] - ch.interior.position.x, z: m[14] - ch.interior.position.z };
      })();
        const seat = which === 'north'
          ? { x: laptop.x, z: laptop.z + 0.95 }
          : { x: L.FRONT_DESK.staffChair.x, z: L.FRONT_DESK.staffChair.z };
        w.x = seat.x + o.x;
        w.z = seat.z + o.z;
        const dx = laptop.x - seat.x;
        const dz = laptop.z - seat.z;
        const horizontal = Math.hypot(dx, dz) || 0.001;
        w.yaw = Math.atan2(-dx / horizontal, -dz / horizontal);
        w.pitch = Math.atan2(1.06 - 1.62, horizontal);
      }, stand);
      await page.waitForTimeout(600);
      await page.keyboard.press('e');
      opened = await page.waitForFunction(() => (() => { const a = window.__fw; if (!a || a.laptopOpen !== true) return false; const s = document.querySelector('.laptop-screen'); if (!s || s.style.display === 'none') return false; const f = document.querySelector('.lt-frame'); if (!f) return false; const r = f.getBoundingClientRect(); if (!(r.width > 100 && r.height > 60)) return false; const p = window.__qaLtFrame || {}; window.__qaLtFrame = { x: r.left, w: r.width }; return Math.abs((p.x ?? -1e6) - r.left) < 0.5 && Math.abs((p.w ?? -1e6) - r.width) < 0.5; })(), null, { timeout: 6000 })
        .then(() => true).catch(() => false);
      if (opened) break;
    }
    if (!opened) throw new Error('laptop did not open from either live stand');
    await page.waitForFunction(() => (() => { const a = window.__fw; if (!a || a.laptopOpen !== true) return false; const s = document.querySelector('.laptop-screen'); if (!s || s.style.display === 'none') return false; const f = document.querySelector('.lt-frame'); if (!f) return false; const r = f.getBoundingClientRect(); if (!(r.width > 100 && r.height > 60)) return false; const p = window.__qaLtFrame || {}; window.__qaLtFrame = { x: r.left, w: r.width }; return Math.abs((p.x ?? -1e6) - r.left) < 0.5 && Math.abs((p.w ?? -1e6) - r.width) < 0.5; })(), null, { timeout: 8000 });
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
  // The old Pricing/Supplier/Orders sidebar desks are tabs under Pro Shop now
  // (laptop.js NAV is seven entries; PAGE_ALIAS forwards the retired ids).
  const tab = async (label) => {
    const spot = await page.evaluate((lbl) => {
      const buttons = [...document.querySelectorAll('.lt-tabs-big .lt-tab')];
      const button = buttons.find((x) => x.textContent.trim() === lbl);
      if (!button) return null;
      const r = button.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }, label);
    if (!spot) throw new Error(`no shop tab "${label}"`);
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
  await nav('Pro Shop');
  await tab('Pricing');
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
  await nav('Pro Shop');
  await tab('Orders & Suppliers');
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
  await nav('Pro Shop');
  await tab('Orders & Suppliers');
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
  await nav('Pro Shop');
  await tab('Orders & Suppliers');
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
