async (page) => {
  // Delivery ETA acceptance through the physical laptop glass. State setup only
  // creates a repeatable scenario; every supplier/navigation action is a real
  // mouse click at the projected screen coordinates and time uses game hotkeys.
  const errors = [];
  const path = process.getBuiltinModule('node:path');
  page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`CONSOLE: ${m.text()}`); });
  const OUT = process.env.QA_OUT_DIR || path.join(
    process.env.QA_REPO_ROOT || process.cwd(),
    'qa', 'checkout-delivery-groundskeeping-balance', 'current', 'delivery',
  );
  const shot = page.__qaOriginalScreenshot ? page.__qaOriginalScreenshot.bind(page) : page.screenshot.bind(page);
  const goto = page.__qaOriginalGoto ? page.__qaOriginalGoto.bind(page) : page.goto.bind(page);
  const log = [];

  await goto(process.env.QA_BASE_URL || 'http://127.0.0.1:18457/');
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.waitForTimeout(900);
  await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 40000 });
  await page.waitForFunction(() => { const v = document.querySelector('.load-veil'); return !v || getComputedStyle(v).opacity === '0'; }, null, { timeout: 40000 });
  await page.waitForTimeout(1200);

  await page.evaluate(async () => {
    const app = window.__fw;
    const st = app.state;
    const del = await import('/src/sim/deliveries.js');
    st.cash = 200000;
    st.shop.unlockedTier = 3;
    st.shop.orders = [];
    st.shop.nextOrderId = 1;
    delete st.shop.starterOrderMin;
    st.tutorial.complete = true; // quote the normal local-supplier pace
    del.ensureDeliveries(st);
    st.shop.deliveries.boxes = [];
    st.shop.deliveries.shipments = [];
    const o = app.scene3d.clubhouse().interior.position;
    const w = app.scene3d.walk.state;
    w.x = 8.45 + o.x; w.z = 4.5 + o.z; w.yaw = -Math.PI / 2; w.pitch = -0.05;
  });
  await page.keyboard.press(' '); // pause: supplier decisions do not burn the promise
  const pausedBefore = await page.evaluate(() => window.__fw.state.clock.minutes);
  await page.waitForTimeout(1200);
  const pausedAfter = await page.evaluate(() => window.__fw.state.clock.minutes);

  const sit = async () => {
    if (await page.evaluate(() => !!window.__fw.laptopOpen)) return;
    await page.keyboard.press('e');
    await page.waitForFunction(() => window.__fw.laptopOpen === true, null, { timeout: 8000 });
    await page.waitForFunction(() => {
      const f = document.querySelector('.lt-frame');
      if (!f) return false;
      const r = f.getBoundingClientRect();
      const old = window.__etaSettle || {};
      window.__etaSettle = { x: r.left, y: r.top, w: r.width };
      return r.width > 100 && Math.abs((old.x ?? 0) - r.left) < 0.05 && Math.abs((old.w ?? 0) - r.width) < 0.05;
    }, null, { timeout: 15000, polling: 120 });
  };
  const point = async (selector, text) => page.evaluate(({ selector, text }) => {
    const nodes = [...document.querySelectorAll(selector)];
    const el = text == null ? nodes[0] : nodes.find((n) => n.textContent.trim().includes(text));
    if (!el) return null;
    el.scrollIntoView({ block: 'nearest' });
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, text: el.textContent.trim() };
  }, { selector, text });
  const clickProjected = async (selector, text) => {
    const p = await point(selector, text);
    if (!p) throw new Error(`Missing projected control ${selector} ${text || ''}`);
    await page.mouse.move(p.x, p.y);
    await page.waitForTimeout(80);
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(250);
    return p;
  };
  const nav = (label) => clickProjected('.lt-navbtn', label);

  await sit();
  await nav('Supplier');
  const card = await page.evaluate(() => {
    const c = [...document.querySelectorAll('.lt-product')].find((x) => x.textContent.includes('Range-rock dozen'));
    if (!c) return null;
    const b = c.querySelectorAll('.lt-qbtn')[1];
    const r = b.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  if (!card) throw new Error('Range-rock supplier card not found');
  for (let i = 0; i < 4; i++) {
    await page.mouse.click(card.x, card.y);
    await page.waitForTimeout(100);
  }

  const standardSummary = await page.evaluate(() => document.querySelector('.lt-content').innerText);
  await shot({ path: `${OUT}/01-standard-cart-eta.png` });
  await clickProjected('.lt-tab', 'Express');
  const expressSummary = await page.evaluate(() => document.querySelector('.lt-content').innerText);
  await shot({ path: `${OUT}/02-express-cart-eta.png` });
  await clickProjected('.lt-primary', 'Place order');
  const confirmText = await page.evaluate(() => document.querySelector('.lt-confirm')?.innerText || '');
  await shot({ path: `${OUT}/03-confirmation-eta.png` });
  await clickProjected('.lt-primary', 'Place the order');
  await page.waitForFunction(() => window.__fw.state.shop.orders.length === 1);
  await shot({ path: `${OUT}/04-orders-received.png` });

  const placed = await page.evaluate(() => {
    const o = window.__fw.state.shop.orders[0];
    return { ...o, remaining: o.deliveryMin - window.__fw.state.clock.minutes };
  });
  await nav('Home');
  const homeText = await page.evaluate(() => document.querySelector('.lt-content').innerText);
  await shot({ path: `${OUT}/05-home-next-delivery.png` });
  await nav('Deliveries');
  const trackingText = await page.evaluate(() => document.querySelector('.lt-content').innerText);
  await shot({ path: `${OUT}/06-delivery-tracking.png` });

  // Advance with the player's 2x hotkey (the game's 4x speed setting), then
  // pause on dispatch so the tracking copy can be inspected without racing it.
  await page.keyboard.press('2');
  await page.waitForFunction(() => ['shipped', 'out', 'arriving'].includes(window.__fw.state.shop.orders[0]?.status), null, { timeout: 15000 });
  await page.keyboard.press(' ');
  await nav('Orders');
  const dispatchedText = await page.evaluate(() => document.querySelector('.lt-content').innerText);
  await shot({ path: `${OUT}/07-orders-dispatched.png` });

  await page.keyboard.press('2');
  await page.waitForFunction(() => window.__fw.state.shop.orders[0]?.status === 'arriving', null, { timeout: 15000 });
  await page.keyboard.press(' ');
  await nav('Deliveries');
  const arrivingText = await page.evaluate(() => document.querySelector('.lt-content').innerText);
  await shot({ path: `${OUT}/08-arriving-soon.png` });

  // Fill the real receiving collection to capacity; the normal clock crosses
  // the promise and the normal delivery tick must turn the van away.
  await page.evaluate(async () => {
    const del = await import('/src/sim/deliveries.js');
    const st = window.__fw.state;
    for (let i = 0; i < del.PAD_CAPACITY; i++) {
      st.shop.deliveries.boxes.push({ id: 8000 + i, skuId: 'tees1', qty: 1, cap: 1, orderId: 0, loc: 'pad', box: 'carton' });
    }
  });
  await page.keyboard.press('2');
  await page.waitForFunction(() => window.__fw.state.shop.orders[0]?.blocked === true, null, { timeout: 10000 });
  await page.keyboard.press(' ');
  // Stay on the page: the tracking application itself must refresh from live
  // state rather than requiring a navigation round trip.
  await page.waitForFunction(() => document.querySelector('.lt-content')?.innerText.includes('Delayed — receiving area blocked'), null, { timeout: 3000 });
  const blockedText = await page.evaluate(() => document.querySelector('.lt-content').innerText);
  await shot({ path: `${OUT}/09-blocked-eta.png` });

  log.push({
    pause: { before: pausedBefore, after: pausedAfter, unchanged: pausedBefore === pausedAfter },
    placed: {
      id: placed.id, service: placed.service, expressFee: placed.expressFee,
      processingMinutes: placed.timing.processingMinutes,
      transitMinutes: placed.timing.transitMinutes,
      remaining: placed.remaining,
    },
    screens: {
      standardQuote: /Usually .*game hours/.test(standardSummary),
      expressQuote: /Express handling/.test(expressSummary) && /half the wait/i.test(expressSummary),
      confirmationEta: /game hours|game minutes/.test(confirmText),
      ordersEta: /Expected today|Arrives in approximately/.test(dispatchedText),
      homeEta: /Arrives in approximately|Expected today/.test(homeText),
      trackingEta: /Arrives in approximately|Expected today/.test(trackingText),
      dispatched: /Shipped|Out for delivery/.test(dispatchedText),
      arriving: /Arriving soon/.test(arrivingText),
      blocked: /Delayed — receiving area blocked/.test(blockedText),
    },
  });
  return { log, errorCount: errors.length, errors: errors.slice(0, 10) };
}
