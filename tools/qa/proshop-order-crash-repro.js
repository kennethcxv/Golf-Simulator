async (page) => {
  // BLOCKER 3 â€” reproduce "the shop page could not be drawn: Cannot read
  // properties of undefined (reading 'cat')" reported while ordering, and
  // establish whether the order actually went through.
  //
  //   node tools/qa/run-playwright.cjs tools/qa/proshop-order-crash-repro.js
  //
  // The laptop shell catches page-draw errors and prints e.message, which
  // throws the stack away â€” so this installs a hook that records the stack
  // BEFORE the shell swallows it. Without that, "reading 'cat'" could be any of
  // five call sites.
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = path.resolve(process.env.QA_REPO_ROOT || process.cwd());
  const outDir = path.resolve(process.env.GREYBOX_DATA_OUT
    || path.join(repo, 'Designs', 'ProShop', 'Greybox', 'data'));
  fs.mkdirSync(outDir, { recursive: true });
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const SEED = Number(process.env.GREYBOX_SEED || 20260727);

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(`${baseUrl}?clubhouse=pine-hills-v2`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.readyState === 'complete');
  await page.evaluate(async (seed) => {
    localStorage.clear();
    const E = await import('/src/sim/empire.js');
    const empire = E.newStarterEmpire('relaxed', seed);
    localStorage.setItem('golfempire:autosave', JSON.stringify(E.empireSnapshot(empire)));
  }, SEED);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 120000 });
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 120000 });
  await page.waitForTimeout(2500);

  // The laptop shell catches draw errors and keeps only e.message, throwing the
  // stack away. A window.TypeError hook cannot help â€” engine-thrown TypeErrors
  // never go through the JS constructor â€” so listen where the stack still
  // exists: unhandled errors, and console.error, which the shell also reaches.
  await page.evaluate(() => {
    window.__catCrashes = [];
    const note = (message, stack, via) => {
      if (!/reading '(cat|name|id)'/.test(String(message))) return;
      window.__catCrashes.push({ message: String(message), stack: stack || null, via });
    };
    window.addEventListener('error', (e) => note(e.message, e.error?.stack, 'window.error'));
    window.addEventListener('unhandledrejection', (e) => note(e.reason?.message, e.reason?.stack, 'rejection'));
    const originalError = console.error;
    console.error = (...args) => {
      for (const a of args) note(a?.message ?? a, a?.stack, 'console.error');
      return originalError.apply(console, args);
    };
  });

  const openLaptop = async () => page.evaluate(async () => {
    const app = window.__fw;
    const L = await import('/src/data/shopLayout.js');
    const o = app.scene3d.clubhouse().interior.position;
    const w = app.scene3d.walk.state;
    const laptop = L.FRONT_DESK.laptop;
    w.x = laptop.x + o.x;
    w.z = laptop.z + 0.95 + o.z;
    w.yaw = 0;
    w.pitch = Math.atan2(1.06 - 1.62, 0.95);
  });
  await openLaptop();
  await page.waitForTimeout(500);
  await page.keyboard.press('e');
  await page.waitForFunction(() => window.__fw.laptopOpen === true, null, { timeout: 15000 });
  // The screen animates in; nav clicks land on nothing until the frame settles.
  // (Home draws no .lt-h1, so wait on the nav rail, which every page has.)
  await page.waitForFunction(() => document.querySelectorAll('.lt-navbtn').length > 3, null, { timeout: 20000 });
  await page.waitForTimeout(1500);

  const goPage = async (label) => {
    await page.evaluate((want) => {
      const b = [...document.querySelectorAll('.lt-navbtn')]
        .find((x) => x.textContent.trim().toLowerCase().includes(want.toLowerCase()));
      if (b) b.click();
    }, label);
    await page.waitForTimeout(900);
  };

  const drawState = async () => page.evaluate(() => {
    const err = document.querySelector('.lt-err');
    return {
      title: document.querySelector('.lt-h1')?.textContent?.trim() || null,
      crashed: !!(err && /could not be drawn/.test(err.textContent || '')),
      errText: err ? err.textContent.trim().slice(0, 200) : null,
    };
  });

  const orderState = async () => page.evaluate(() => {
    const st = window.__fw.state;
    return {
      orders: (st.shop?.orders || []).map((o) => ({ id: o.id, skuId: o.skuId, qty: o.qty, status: o.status })),
      boxes: (st.shop?.deliveries?.boxes || []).map((b) => ({ skuId: b.skuId, qty: b.qty })),
      cash: st.cash,
    };
  });

  const steps = [];
  const record = async (label) => {
    const [draw, orders, crashes] = await Promise.all([
      drawState(), orderState(), page.evaluate(() => window.__catCrashes.slice()),
    ]);
    steps.push({ label, draw, orderCount: orders.orders.length, orders: orders.orders, cash: orders.cash, crashes });
    return { draw, orders, crashes };
  };
  const clickTab = async (name) => {
    await page.evaluate((want) => {
      const b = [...document.querySelectorAll('.lt-tab')]
        .find((x) => x.textContent.trim().toLowerCase() === want.toLowerCase());
      if (b) b.click();
    }, name);
    await page.waitForTimeout(700);
  };

  await goPage('Pro Shop');
  await record('pro shop opened (Inventory tab)');

  // Every top-level tab, drawn once â€” the crash was reported "when ordering
  // various things", so exercise each surface rather than guessing one.
  for (const tab of ['Orders & Suppliers', 'Pricing', 'Deliveries', 'Inventory']) {
    // eslint-disable-next-line no-await-in-loop
    await clickTab(tab);
    // eslint-disable-next-line no-await-in-loop
    await record(`tab: ${tab}`);
  }

  // Order several DIFFERENT lines from the inventory rows â€” one sku might be
  // fine while another is missing from the catalog.
  await clickTab('Inventory');
  const queued = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.lt-content tr')];
    const picked = [];
    for (const row of rows) {
      const btn = [...row.querySelectorAll('button')].find((b) => /^Order$/i.test(b.textContent.trim()));
      if (!btn) continue;
      picked.push(row.querySelector('td')?.textContent?.trim().slice(0, 40) || '?');
      btn.click();
      if (picked.length >= 8) break;
    }
    return picked;
  });
  await page.waitForTimeout(900);
  await record(`queued ${queued.length} lines: ${queued.join(' | ')}`);

  await clickTab('Orders & Suppliers');
  await record('order tab with cart');

  // Clicking "Place Order" only works when the basket is affordable, and eight
  // lines is not. The decisive reproduction is the sim's own multi-line entry
  // point â€” the exact call the basket makes â€” so the order really is the shape
  // the game creates when you "order various things".
  const submitted = await page.evaluate(async () => {
    const L = await import('/src/sim/inventoryLifecycle.js');
    const st = window.__fw.state;
    const res = L.submitPurchaseOrders(st, {
      lines: [
        { skuId: 'balls1', quantity: 2 },
        { skuId: 'chips1', quantity: 2 },
        { skuId: 'towel1', quantity: 1 },
      ],
    });
    const placed = (st.shop.orders || [])[st.shop.orders.length - 1] || null;
    return {
      ok: res.ok,
      reason: res.reason || null,
      // THIS is the bug's seed: a shipment with more than one line names no
      // single sku, so every consumer resolving order.skuId gets undefined.
      orderSkuId: placed ? placed.skuId : undefined,
      orderLines: placed ? (placed.lines || []).map((l) => l.skuId) : [],
    };
  });
  await page.waitForTimeout(400);
  const after = await record(`submitted a 3-line order (skuId=${JSON.stringify(submitted.orderSkuId)})`);

  // Re-draw: the reported crash appeared on the page that draws AFTER the
  // order commits. Deliveries hosts the order rows.
  await goPage('Home');
  await goPage('Pro Shop');
  const redraw = await record('pro shop re-drawn after ordering');
  await clickTab('Deliveries');
  const deliveries = await record('deliveries tab after ordering');

  const crashed = steps.filter((s) => s.draw.crashed);
  const anyCatCrash = steps.flatMap((s) => s.crashes);
  const out = {
    reproduced: crashed.length > 0 || anyCatCrash.length > 0,
    crashedSteps: crashed.map((s) => ({ label: s.label, errText: s.draw.errText })),
    // The question the walk asked directly: did the order land?
    ordersAfter: after.orders.orders,
    orderLanded: after.orders.orders.length > 0,
    redrawCrashed: redraw.draw.crashed,
    deliveriesCrashed: deliveries.draw.crashed,
    catCrashStacks: [...new Map(anyCatCrash.map((c) => [c.stack, c])).values()].slice(0, 4),
    queuedLines: queued,
    submitted,
    steps: steps.map((s) => ({ label: s.label, ...s.draw, orderCount: s.orderCount })),
  };
  fs.writeFileSync(path.join(outDir, 'order-crash-repro.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
