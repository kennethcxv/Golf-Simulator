async (page) => {
  // GOLF SIMULATOR — the money paths, driven through the glass with a real mouse.
  //
  // What this proves, in order: an order placed on the Supplier page charges the wallet
  // exactly once and lands on the Orders page; the delivery van files a real notification;
  // a pricing slider moved with the mouse changes what the shop actually charges; all of it
  // survives save → reload; Escape hands the room back; and the interface stays readable at
  // 1280×720, 1600×900 and 1920×1080 (screenshots under qa/laptop_ui/).
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
  page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
  const OUT = process.getBuiltinModule('node:path').join(
    process.env.QA_REPO_ROOT || process.cwd(), 'qa', 'laptop_ui',
  );
  const log = [];
  const fail = (why) => { throw new Error(why); };

  async function bootIntoClub() {
    // Explicit navigation fallback (2026-07-28): this file relied on the runner
    // having already navigated; on a fresh context it sat on about:blank.
    if (!/^https?:/.test(page.url())) {
      await page.goto(process.env.QA_BASE_URL || 'http://localhost:8457/', { waitUntil: 'domcontentloaded' });
    }
    await page.waitForTimeout(1000);
    const cont = page.getByText('Continue', { exact: true });
    if (await cont.isEnabled().catch(() => false)) {
      await cont.click();
    } else {
      // Live menu flow (2026-07-28): New game → difficulty card → confirm.
      await page.getByRole('button', { name: /New game/i }).click();
      await page.locator('.difficulty-card').filter({ hasText: 'Relaxed' }).click();
      const confirmStart = page.getByRole('button', { name: /^(Start|Confirm|Yes)/i }).first();
      if (await confirmStart.isVisible({ timeout: 1500 }).catch(() => false)) await confirmStart.click();
      await page.waitForTimeout(900);
      const buy = await page.evaluate(() => {
        const btns = [...document.querySelectorAll('button')]
          .filter((b) => b.textContent.trim() === 'Buy' && !b.disabled);
        if (!btns.length) return null;
        const r = btns[0].getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      });
      if (!buy) fail('marketplace: no affordable Buy button');
      await page.mouse.click(buy.x, buy.y);
    }
    await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 60000 });
    await page.waitForFunction(() => { const v = document.querySelector('.load-veil'); return !v || getComputedStyle(v).opacity === '0'; }, null, { timeout: 60000 });
    await page.waitForTimeout(2000);
  }

  async function seatAtLaptop() {
    await page.evaluate(() => {
      const app = window.__fw;
      const o = app.scene3d.clubhouse().interior.position;
      const w = app.scene3d.walk.state;
      w.x = 8.45 + o.x; w.z = 4.5 + o.z; w.yaw = -Math.PI / 2; w.pitch = -0.05;
    });
    await page.waitForTimeout(500);
  }
  async function openLaptop() {
    await page.keyboard.press('e');
    await page.waitForFunction(() => window.__fw.laptopOpen === true, null, { timeout: 8000 });
    await page.waitForFunction(() => { const r = document.querySelector('.laptop-screen'); return r && r.style.display !== 'none'; }, null, { timeout: 15000 });
    await page.waitForFunction(() => {
      const f = document.querySelector('.lt-frame');
      if (!f) return false;
      const r = f.getBoundingClientRect();
      const prev = window.__settle || {};
      window.__settle = { x: r.left, w: r.width };
      return Math.abs((prev.x ?? 0) - r.left) < 0.05 && Math.abs((prev.w ?? 0) - r.width) < 0.05 && r.width > 100;
    }, null, { timeout: 15000, polling: 120 });
    await page.waitForTimeout(250);
  }
  async function clickGlass(selectorFilter) {
    const spot = await page.evaluate(selectorFilter);
    if (!spot) return false;
    await page.mouse.move(spot.x, spot.y);
    await page.waitForTimeout(60);
    await page.mouse.click(spot.x, spot.y);
    await page.waitForTimeout(320);
    return true;
  }
  const navTo = (label) => clickGlass(`(() => {
    const b = [...document.querySelectorAll('.lt-navbtn')].find((x) => x.textContent.trim().includes(${JSON.stringify(label)}));
    if (!b) return null;
    b.scrollIntoView({ block: 'nearest' });
    const r = b.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);

  await page.goto('http://localhost:8457/');
  await page.setViewportSize({ width: 1600, height: 900 });
  await bootIntoClub();
  await page.evaluate(() => {
    const st = window.__fw.state;
    st.cash = 60000;
    st.shop.unlockedTier = 3;
    st.clock.minutes = Math.floor(st.clock.minutes / 1440) * 1440 + 9 * 60; // 9 AM, quiet
  });
  await seatAtLaptop();

  // --- the physical machine, closed, in its room --------------------------------------------
  await page.screenshot({ path: `${OUT}/01-laptop-closed.png` });
  await page.keyboard.press('e');
  await page.waitForTimeout(700); // lid mid-swing, boot screen up
  await page.screenshot({ path: `${OUT}/02-laptop-opening.png` });
  await page.waitForFunction(() => { const r = document.querySelector('.laptop-screen'); return r && r.style.display !== 'none'; }, null, { timeout: 15000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/03-laptop-live.png` });

  // --- 1. place a supplier order through the glass -------------------------------------------
  const before = await page.evaluate(() => ({ cash: window.__fw.state.cash, orders: window.__fw.state.shop.orders.length }));
  await navTo('Suppliers');
  // six clicks of the first product's [+]
  for (let i = 0; i < 6; i++) {
    const ok = await clickGlass(`(() => {
      const b = [...document.querySelectorAll('.lt-qbtn')].find((x) => x.textContent.trim() === '+');
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
    if (!ok) fail('supplier: no [+] button on the glass');
  }
  const quoted = await page.evaluate(() => {
    const b = [...document.querySelectorAll('.lt-primary')].find((x) => /^Place order/.test(x.textContent.trim()));
    return b ? b.textContent.trim() : null;
  });
  if (!quoted) fail('supplier: no Place order button after adding items');
  await clickGlass(`(() => {
    const b = [...document.querySelectorAll('.lt-primary')].find((x) => /^Place order/.test(x.textContent.trim()));
    const r = b.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  // the confirmation bar — click the confirm, not the cancel
  const confirmed = await clickGlass(`(() => {
    const b = [...document.querySelectorAll('.lt-confirm .lt-primary')].find((x) => /Place the order/.test(x.textContent));
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  if (!confirmed) fail('supplier: confirmation bar did not appear');
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => ({
    cash: window.__fw.state.cash,
    orders: window.__fw.state.shop.orders.length,
    lastOrderCost: window.__fw.state.shop.orders.at(-1)?.cost ?? null,
    pageId: (document.querySelector('.lt-h1') || {}).textContent,
    txTop: window.__fw.state.ledger.txLog[0],
  }));
  const charged = Math.round((before.cash - after.cash) * 100) / 100;
  if (after.orders !== before.orders + 1) fail(`order count ${before.orders} → ${after.orders}, expected +1`);
  if (Math.abs(charged - after.lastOrderCost) > 0.001) fail(`charged ${charged} but order cost is ${after.lastOrderCost} — not exactly once`);
  if (!(after.txTop && after.txTop.key === 'shopOrders')) fail('transaction log did not record the purchase');
  log.push({ step: 'order', quoted, charged, landedOn: after.pageId, tx: after.txTop });
  await page.screenshot({ path: `${OUT}/04-order-placed.png` });

  // --- 2. let the van arrive; the office hears about it --------------------------------------
  await page.evaluate(async () => {
    const { update } = await import('/src/sim/state.js');
    const st = window.__fw.state;
    const o = st.shop.orders.at(-1);
    update(st, Math.max(60, o.deliveryMin - st.clock.minutes + 10));
  });
  const notif = await page.evaluate(() => {
    const items = window.__fw.state.notifications.items;
    return { count: items.length, first: items[0] ? { kind: items[0].kind, text: items[0].text, read: items[0].read } : null, unreadBadge: !!document.querySelector('.lt-belldot') };
  });
  if (!notif.first) fail('no notification after the delivery window');
  log.push({ step: 'notification', ...notif });
  await navTo('Notifications');
  await page.screenshot({ path: `${OUT}/05-notifications.png` });
  const opened = await clickGlass(`(() => {
    const b = [...document.querySelectorAll('.lt-order button')].find((x) => x.textContent.trim() === 'Open');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  const afterOpen = await page.evaluate(() => (document.querySelector('.lt-h1') || {}).textContent);
  log.push({ step: 'notification-open', clicked: opened, landedOn: afterOpen });

  // --- 3. move a price with the mouse; the shop follows --------------------------------------
  await navTo('Pricing');
  const markupBefore = await page.evaluate(() => window.__fw.state.shop.markup.balls);
  const slid = await clickGlass(`(() => {
    const rows = [...document.querySelectorAll('.lt-row')];
    const row = rows.find((x) => x.textContent.includes('Golf balls') && x.querySelector('.lt-range'));
    if (!row) return null;
    const r = row.querySelector('.lt-range').getBoundingClientRect();
    return { x: r.left + r.width * 0.9, y: r.top + r.height / 2 };
  })()`);
  if (!slid) fail('pricing: no golf-balls markup slider');
  const priceCheck = await page.evaluate(async () => {
    const st = window.__fw.state;
    const { priceFor } = await import('/src/sim/shop.js');
    const { SHOP_CATALOG } = await import('/src/data/shopItems.js');
    const sku = SHOP_CATALOG.find((s) => s.cat === 'balls' && s.tier <= st.shop.unlockedTier);
    return { markup: st.shop.markup.balls, sku: sku.id, ringsUpAt: priceFor(sku, st.shop.markup.balls, null) };
  });
  if (Math.abs(priceCheck.markup - markupBefore) < 0.01) fail('pricing: slider click did not move the markup');
  log.push({ step: 'pricing', markupBefore, ...priceCheck });
  await page.screenshot({ path: `${OUT}/06-pricing-changed.png` });

  // --- 4. save, reload, and check it all held ------------------------------------------------
  const saved = await page.evaluate(async () => {
    const { saveData } = await import('/src/core/storage.js');
    const { empireSnapshot } = await import('/src/sim/empire.js');
    await saveData('autosave', empireSnapshot(window.__fw.empire));
    return true;
  });
  if (!saved) fail('could not write the autosave');
  await page.reload();
  await page.waitForTimeout(1200);
  await page.getByText('Continue', { exact: true }).click();
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  const persisted = await page.evaluate(() => {
    const st = window.__fw.state;
    return {
      markup: st.shop.markup.balls,
      notifications: st.notifications.items.length,
      txLog: st.ledger.txLog.length,
      boxesOrOrders: st.shop.orders.length + (st.shop.deliveries ? st.shop.deliveries.boxes.length : 0),
    };
  });
  if (Math.abs(persisted.markup - priceCheck.markup) > 0.001) fail(`markup did not survive the reload: ${persisted.markup} vs ${priceCheck.markup}`);
  if (persisted.notifications < 1) fail('notifications did not survive the reload');
  if (persisted.txLog < 1) fail('transaction log did not survive the reload');
  log.push({ step: 'persistence', ...persisted });

  // --- 5. Escape hands the room back ----------------------------------------------------------
  await seatAtLaptop();
  await openLaptop();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
  const closed = await page.evaluate(() => ({
    laptopOpen: window.__fw.laptopOpen,
    uiHidden: (document.querySelector('.laptop-screen') || {}).style?.display === 'none',
  }));
  if (closed.laptopOpen || !closed.uiHidden) fail('Escape did not close the laptop cleanly');
  await page.screenshot({ path: `${OUT}/07-laptop-closed-again.png` });
  log.push({ step: 'escape-close', ...closed });

  // --- 6. the three required resolutions ------------------------------------------------------
  for (const [w, h] of [[1280, 720], [1600, 900], [1920, 1080]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(400);
    await openLaptop();
    const metrics = await page.evaluate(() => {
      const f = document.querySelector('.lt-frame').getBoundingClientRect();
      const nav = document.querySelector('.lt-navbtn').getBoundingClientRect();
      return {
        frame: { w: Math.round(f.width), h: Math.round(f.height) },
        viewportShare: Math.round((f.width / window.innerWidth) * 100) / 100,
        navRowPx: Math.round(nav.height * 10) / 10,
      };
    });
    await page.screenshot({ path: `${OUT}/dashboard-${w}x${h}.png` });
    log.push({ step: `resolution-${w}x${h}`, ...metrics });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  }

  return { log, errs: errs.slice(0, 10), errCount: errs.length };
}
