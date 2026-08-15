async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const out = path.resolve(process.env.QA_OUTPUT_DIR
    || 'qa/inventory-delivery-loop/save-load');
  fs.mkdirSync(out, { recursive: true });
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(`PAGEERROR: ${error.message}`));

  const boot = async () => {
    const continueButton = page.getByRole('button', { name: 'Continue', exact: true });
    await continueButton.waitFor({ state: 'visible', timeout: 30000 });
    await continueButton.click();
    await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
    await page.waitForFunction(() => {
      const veil = document.querySelector('.load-veil');
      return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
    }, null, { timeout: 90000 });
    await page.waitForTimeout(1200);
  };
  const setCamera = () => page.evaluate(() => {
    const app = window.__fw;
    const origin = app.scene3d.clubhouse().interior.position;
    const walk = app.scene3d.walk.state;
    walk.x = origin.x + 6.9;
    walk.z = origin.z + 0.75;
    walk.yaw = 0;
    walk.pitch = -0.35;
  });
  const snapshot = () => page.evaluate(async () => {
    const lifecycle = await import(new URL('src/sim/inventoryLifecycle.js', document.baseURI).href);
    const delivery = await import(new URL('src/sim/deliveries.js', document.baseURI).href);
    const app = window.__fw;
    const reconciliation = lifecycle.reconcileInventory(app.state, {
      qa: true,
      context: 'browser-save-reload',
    });
    const orders = app.state.shop.orders.map((order) => ({
      id: order.id,
      state: order.state,
      processingState: order.processingState,
      dispatchState: order.dispatchState,
      receivingState: order.receivingState,
      completionState: order.completionState,
      boxIds: [...(order.boxIds || [])],
      remainingUnreceivedQuantity: order.remainingUnreceivedQuantity,
      lines: (order.lines || []).map((line) => ({ ...line })),
    }));
    const boxes = delivery.boxesOf(app.state).map((box) => ({
      id: box.id,
      persistentId: box.persistentId,
      parentOrderId: box.parentOrderId,
      skuId: box.skuId,
      initialQuantity: box.initialQuantity,
      qty: box.qty,
      remainingQuantity: box.remainingQuantity,
      loc: box.loc,
      currentLocation: box.currentLocation,
      surface: box.surface || null,
      surfaceSlot: box.surfaceSlot ?? null,
      x: box.x ?? null,
      y: box.y ?? null,
      z: box.z ?? null,
      ry: box.ry ?? null,
      tape: box.tape,
      flaps: [...box.flaps],
      flat: box.flat,
      contents: structuredClone(box.contents || []),
      allocations: (box.allocations || []).map((allocation) => ({ ...allocation })),
    }));
    return {
      orders,
      boxes,
      carry: app.state.shop.carry ? structuredClone(app.state.shop.carry) : null,
      totals: lifecycle.inventoryLifecycleSummary(app.state).totals,
      reconciled: reconciliation.ok,
      discrepancies: reconciliation.discrepancies,
    };
  });

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await boot();
  const fixture = await page.evaluate(async () => {
    const lifecycle = await import(new URL('src/sim/inventoryLifecycle.js', document.baseURI).href);
    const delivery = await import(new URL('src/sim/deliveries.js', document.baseURI).href);
    const app = window.__fw;
    app.state.cash = 250000;
    app.empire.cash = 250000;
    app.state.shop.unlockedTier = 3;
    app.state.shop.orders = [];
    app.state.shop.deliveries.boxes = [];
    app.state.shop.deliveries.shipments = [];
    app.state.shop.deliveries.arrivedOrderIds = [];
    app.state.shop.deliveries.nextBoxId = 1;
    app.state.shop.carry = null;
    app.state.shop.inventoryLifecycle = null;
    lifecycle.ensureInventoryLifecycle(app.state);
    const submitted = lifecycle.submitPurchaseOrders(app.state, {
      idempotencyKey: 'browser-save-two-boxes',
      lines: [{ skuId: 'balls2', quantity: 24 }],
    });
    if (!submitted.ok) throw new Error(submitted.reason);
    const boxes = delivery.arriveOrder(app.state, submitted.orders[0]);
    if (boxes.length !== 2) throw new Error(`Expected two cartons, got ${boxes.length}.`);

    if (!delivery.pickUpBox(app.state, boxes[0].id).ok) throw new Error('Could not lift mid-cut carton.');
    delivery.putDownBox(app.state, boxes[0].id, {
      x: 6.9, y: 0.925, z: -0.9, ry: 0, surface: 'worktable', surfaceSlot: 0,
    });
    delivery.cutTape(app.state, boxes[0].id, 0.55);

    if (!delivery.pickUpBox(app.state, boxes[1].id).ok) throw new Error('Could not lift partial carton.');
    delivery.putDownBox(app.state, boxes[1].id, { x: 7.45, z: -4.95, ry: 0.12 });
    delivery.cutTape(app.state, boxes[1].id, 1);
    delivery.openFlap(app.state, boxes[1].id);
    delivery.openFlap(app.state, boxes[1].id);
    const taken = delivery.takeFromBox(app.state, boxes[1].id);
    if (!taken.ok || taken.taken !== 6) throw new Error(`Expected six carried units: ${JSON.stringify(taken)}`);
    app.scene3d.clubhouse().rebuildBoxes();
    app.scene3d.clubhouse().rebuildStock();
    return { orderId: submitted.orders[0].id, boxIds: boxes.map((box) => box.id) };
  });
  await setCamera();
  await page.waitForTimeout(600);
  const before = await snapshot();
  if (!before.reconciled) throw new Error(`Pre-save discrepancy: ${JSON.stringify(before.discrepancies)}`);
  await page.screenshot({ path: path.join(out, '01-before-autosave.png') });
  await page.evaluate(() => window.__fw.autosave());
  await page.waitForTimeout(300);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await boot();
  await setCamera();
  await page.waitForTimeout(600);
  const after = await snapshot();
  await page.screenshot({ path: path.join(out, '02-after-reload.png') });

  const canonical = (value) => JSON.stringify(value);
  const exact = canonical(before) === canonical(after);
  const ok = exact && after.reconciled && errors.length === 0;
  return {
    ok,
    fixture,
    exact,
    before,
    after,
    errors,
  };
}
