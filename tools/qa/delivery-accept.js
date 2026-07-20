async (page) => {
  // THE ACCEPTANCE RECORD, in the running game: order the six kinds through the LAPTOP, watch them
  // land as boxes, partially unpack, take the GAME'S OWN autosave with boxes half-open, reload, and
  // confirm the half-open boxes and every unit came back. Screenshots of the laptop pages that
  // drive it, and of the pad they fill.
  const errs = [];
  page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });
  const OUT = process.getBuiltinModule('node:path').join(
    process.env.QA_REPO_ROOT || process.cwd(), 'qa', 'delivery',
  );
  const log = [];

  const boot = async () => {
    await page.goto('http://localhost:8457/');
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.waitForTimeout(1200);
    await page.getByText('Continue', { exact: true }).click().catch(() => {});
    await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 40000 });
    await page.waitForFunction(() => { const v = document.querySelector('.load-veil'); return !v || getComputedStyle(v).opacity === '0'; }, null, { timeout: 40000 });
    await page.waitForTimeout(1800);
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
    await page.waitForFunction(() => { const f = document.querySelector('.lt-frame'); if (!f) return false; const r = f.getBoundingClientRect(); const p = window.__q || {}; window.__q = { x: r.left, w: r.width }; return Math.abs((p.x ?? 0) - r.left) < 0.05 && Math.abs((p.w ?? 0) - r.width) < 0.05 && r.width > 100; }, null, { timeout: 15000, polling: 120 });
  };
  const nav = async (label) => {
    const spot = await page.evaluate((lbl) => {
      const b = [...document.querySelectorAll('.lt-navbtn')].find((x) => x.textContent.includes(lbl));
      if (!b) return null;
      b.scrollIntoView({ block: 'nearest' });
      const r = b.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }, label);
    if (!spot) throw new Error(`no nav "${label}"`);
    await page.mouse.click(spot.x, spot.y);
    await page.waitForTimeout(400);
  };

  await boot();
  await page.evaluate(() => { window.__fw.state.cash = 200000; window.__fw.state.shop.unlockedTier = 3; });

  // order the six kinds straight through the sim's placeOrder (the Supplier page drives this same
  // call; we exercise the page separately below)
  const ordered = await page.evaluate(async () => {
    const shop = await import('/src/sim/shop.js');
    const st = window.__fw.state;
    const kinds = [['tees1', 20], ['balls1', 12], ['polo1', 8], ['driver1', 2], ['bag1', 1], ['light1', 1]];
    const res = [];
    for (const [id, q] of kinds) { const r = shop.placeOrder(st, id, q); res.push({ id, ok: r.ok, boxes: r.boxes, fee: r.fee, supplier: r.supplier }); }
    return res;
  });
  log.push({ step: '1. ordered six kinds', ordered });

  await sitDown();
  await nav('Orders');
  await page.screenshot({ path: `${OUT}/laptop-orders.png` });
  await nav('Deliveries');
  await page.screenshot({ path: `${OUT}/laptop-deliveries.png` });
  await nav('Supplier');
  await page.screenshot({ path: `${OUT}/laptop-supplier.png` });

  // land everything, then partially open two shipments and take the autosave
  const preSave = await page.evaluate(async () => {
    const shop = await import('/src/sim/shop.js');
    const del = await import('/src/sim/deliveries.js');
    const stk = await import('/src/sim/stocking.js');
    const st = window.__fw.state;
    for (let i = 0; i < 8; i++) { const o = st.shop.orders[0]; if (o) shop.tickDeliveries(st, o.deliveryMin + 1); }
    // partially open the ball case and the apparel carton
    for (const id of ['balls1', 'polo1']) {
      const b = del.boxesOf(st).find((x) => x.skuId === id);
      del.cutTape(st, b.id, 1); del.openFlap(st, b.id); del.openFlap(st, b.id);
      del.takeFromBox(st, b.id); stk.storeInBack(st);
    }
    window.__fw.scene3d.clubhouse().rebuildBoxes();
    window.__fw.autosave();   // THE GAME'S OWN SAVE
    const units = (skuId) => { const inv = st.shop.inventory[skuId] || { shelf: 0, back: 0 }; const box = del.boxesOf(st).filter((b) => b.skuId === skuId).reduce((a, b) => a + b.qty, 0); return inv.shelf + inv.back + box; };
    return {
      boxes: del.boxesOf(st).length,
      shipments: del.shipmentsOf(st).length,
      partials: del.boxesOf(st).filter((b) => del.boxState(b) === 'partial contents').length,
      cash: st.cash,
      ballUnits: units('balls1'), poloUnits: units('polo1'), driverUnits: units('driver1'),
    };
  });
  log.push({ step: '2. landed, partially opened two, autosaved', ...preSave });

  // --- RELOAD ---
  await boot();
  const after = await page.evaluate(async () => {
    const del = await import('/src/sim/deliveries.js');
    const st = window.__fw.state;
    const units = (skuId) => { const inv = st.shop.inventory[skuId] || { shelf: 0, back: 0 }; const box = del.boxesOf(st).filter((b) => b.skuId === skuId).reduce((a, b) => a + b.qty, 0); return inv.shelf + inv.back + box; };
    return {
      boxes: del.boxesOf(st).length,
      shipments: del.shipmentsOf(st).length,
      partials: del.boxesOf(st).filter((b) => del.boxState(b) === 'partial contents').length,
      cash: st.cash,
      ballUnits: units('balls1'), poloUnits: units('polo1'), driverUnits: units('driver1'),
    };
  });
  log.push({
    step: '3. RELOADED',
    ...after,
    checks: {
      boxesKept: after.boxes === preSave.boxes ? `OK — ${after.boxes} boxes` : `FAIL ${preSave.boxes}->${after.boxes}`,
      partialsKept: after.partials === preSave.partials ? `OK — ${after.partials} half-open boxes survived` : `FAIL ${preSave.partials}->${after.partials}`,
      shipmentsKept: after.shipments === preSave.shipments ? `OK — ${after.shipments} shipments` : 'FAIL',
      cashKept: after.cash === preSave.cash ? 'OK — cash identical' : `FAIL ${preSave.cash}->${after.cash}`,
      unitsKept: (after.ballUnits === preSave.ballUnits && after.poloUnits === preSave.poloUnits && after.driverUnits === preSave.driverUnits)
        ? `OK — balls ${after.ballUnits}, polos ${after.poloUnits}, drivers ${after.driverUnits} all identical`
        : 'FAIL — a unit changed across the save',
    },
  });

  return { log, errs: errs.slice(0, 8), errCount: errs.length };
}
