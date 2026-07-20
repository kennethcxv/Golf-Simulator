async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const out = path.resolve(process.env.QA_OUTPUT_DIR || 'qa/inventory-delivery-loop/visual');
  fs.mkdirSync(out, { recursive: true });
  const diagnostics = [];
  const actions = [];
  const screenshots = [];
  const errors = { console: 0, page: 0, request: 0 };
  page.on('console', (message) => {
    if (message.type() === 'error') {
      errors.console += 1;
      diagnostics.push({ kind: 'console', text: message.text() });
    }
  });
  page.on('pageerror', (error) => {
    errors.page += 1;
    diagnostics.push({ kind: 'pageerror', text: error.message });
  });
  page.on('response', (response) => {
    if (response.status() >= 400) {
      errors.request += 1;
      diagnostics.push({ kind: 'http', text: `${response.status()} ${response.url()}` });
    }
  });

  const requireTruth = (condition, message) => { if (!condition) throw new Error(message); };
  const shot = async (name, description) => {
    const file = path.join(out, name);
    await page.screenshot({ path: file });
    screenshots.push({ file, description });
  };
  const press = async (key, description) => {
    await page.keyboard.press(key);
    actions.push({ kind: 'trusted-key', key, description });
  };
  const hold = async (key, ms, description) => {
    await page.keyboard.down(key);
    await page.waitForTimeout(ms);
    await page.keyboard.up(key);
    await page.waitForTimeout(300);
    actions.push({ kind: 'trusted-key-hold', key, ms, description });
  };
  const setCamera = async ({ lx, lz, yaw, pitch }) => {
    await page.evaluate((pose) => {
      const app = window.__fw;
      const origin = app.scene3d.clubhouse().interior.position;
      const walk = app.scene3d.walk.state;
      walk.x = origin.x + pose.lx;
      walk.z = origin.z + pose.lz;
      walk.yaw = pose.yaw;
      walk.pitch = pose.pitch;
      app.scene3d.walk.clearKeys?.();
    }, { lx, lz, yaw, pitch });
    await page.waitForTimeout(550);
  };
  const waitFocus = async (pattern, timeout = 10000) => {
    try {
      await page.waitForFunction(
        (source) => new RegExp(source, 'i').test(window.__fw.scene3d.walk.getFocusLabel?.() || ''),
        pattern.source,
        { timeout },
      );
    } catch (error) {
      const actual = await page.evaluate(() => window.__fw.scene3d.walk.getFocusLabel?.() || '(no focus)');
      throw new Error(`Focus timeout: expected ${pattern}; saw ${JSON.stringify(actual)}. ${error.message}`);
    }
  };
  const inventoryState = () => page.evaluate(async () => {
    const lifecycle = await import('/src/sim/inventoryLifecycle.js');
    const delivery = await import('/src/sim/deliveries.js');
    const result = lifecycle.reconcileInventory(window.__fw.state, { qa: true, context: 'browser-visual' });
    return {
      reconciled: result.ok,
      discrepancies: result.discrepancies,
      boxes: delivery.boxesOf(window.__fw.state).map((box) => ({
        id: box.id, persistentId: box.persistentId, skuId: box.skuId,
        qty: box.qty, initialQuantity: box.initialQuantity, loc: box.loc,
        surface: box.surface || null, surfaceSlot: box.surfaceSlot,
        tape: box.tape, flaps: [...box.flaps], flat: box.flat,
      })),
      carry: window.__fw.state.shop.carry,
      totals: lifecycle.inventoryLifecycleSummary(window.__fw.state).totals,
    };
  });

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  const continueButton = page.getByRole('button', { name: 'Continue', exact: true });
  await continueButton.waitFor({ state: 'visible', timeout: 30000 });
  await continueButton.click();
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
  }, null, { timeout: 90000 });
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1600);

  const fixture = await page.evaluate(async () => {
    const lifecycle = await import('/src/sim/inventoryLifecycle.js');
    const delivery = await import('/src/sim/deliveries.js');
    const app = window.__fw;
    app.speedIdx = 0;
    app.state.cash = 250000;
    app.empire.cash = 250000;
    app.state.shop.unlockedTier = 3;
    app.state.shop.orders = [];
    app.state.shop.deliveries.boxes = [];
    app.state.shop.deliveries.shipments = [];
    app.state.shop.deliveries.arrivedOrderIds = [];
    app.state.shop.deliveries.nextBoxId = 1;
    app.state.shop.carry = null;
    // Browser profiles intentionally persist between visual iterations. Reset
    // the documented fixture ledger so idempotent order keys cannot reconnect
    // this run to a carton cut during an earlier pass.
    app.state.shop.inventoryLifecycle = null;
    lifecycle.ensureInventoryLifecycle(app.state);
    const day = Math.floor(app.state.clock.minutes / 1440) * 1440;
    app.state.clock.minutes = day + 14 * 60;
    app.empire.clockMinutes = app.state.clock.minutes;
    app.scene3d.applyTimeWeather?.(14 * 60, app.state.weather);
    const clubhouse = app.scene3d.clubhouse();
    clubhouse.setOrganicWalkins?.(false);
    clubhouse.clearWalkins?.();
    const pad = lifecycle.submitPurchaseOrders(app.state, {
      idempotencyKey: 'visual-pad-nine', lines: [{ skuId: 'bag1', quantity: 9 }],
    });
    const fallback = lifecycle.submitPurchaseOrders(app.state, {
      idempotencyKey: 'visual-fallback-ten', lines: [{ skuId: 'balls2', quantity: 120 }],
    });
    clubhouse.rebuildBoxes();
    return {
      padOrderId: pad.orders[0].id,
      fallbackOrderId: fallback.orders[0].id,
      cost: pad.cost + fallback.cost,
    };
  });

  // Real laptop interaction, showing the same order objects that later make boxes.
  await setCamera({ lx: 8.45, lz: 4.5, yaw: -Math.PI / 2, pitch: -0.05 });
  await waitFocus(/laptop/);
  await press('e', 'open the physical laptop');
  await page.waitForFunction(() => window.__fw.laptopOpen === true, null, { timeout: 10000 });
  const ordersNav = page.locator('.lt-navbtn').filter({ hasText: 'Orders' }).first();
  await ordersNav.click();
  actions.push({ kind: 'trusted-mouse', description: 'open Orders application' });
  await page.waitForTimeout(500);
  await shot('01-live-orders.png', 'Submitted supplier orders before physical receipt.');
  await press('Escape', 'leave laptop');
  await page.waitForFunction(() => window.__fw.laptopOpen === false, null, { timeout: 10000 });

  const landed = await page.evaluate(async ({ padOrderId, fallbackOrderId }) => {
    const lifecycle = await import('/src/sim/inventoryLifecycle.js');
    const delivery = await import('/src/sim/deliveries.js');
    const app = window.__fw;
    const padOrder = lifecycle.purchaseOrderById(app.state, padOrderId);
    const fallbackOrder = lifecycle.purchaseOrderById(app.state, fallbackOrderId);
    const pad = delivery.arriveOrder(app.state, padOrder);
    const fallback = delivery.arriveOrder(app.state, fallbackOrder);
    app.scene3d.clubhouse().rebuildBoxes();
    app.scene3d.clubhouse().playDeliveryArrival({ kind: 'arrived', order: fallbackOrder, boxes: fallback });
    return {
      pad: pad.map((box) => box.id),
      fallback: fallback.map((box) => box.id),
      padCount: delivery.padCount(app.state),
      fallbackCount: delivery.fallbackCount(app.state),
    };
  }, fixture);
  requireTruth(landed.padCount === 9 && landed.fallbackCount === 10, 'expected 9 pad and 10 fallback boxes');

  await setCamera({ lx: 9.6, lz: -3.6, yaw: -Math.PI / 2, pitch: -0.12 });
  await waitFocus(/receiving door/);
  await press('e', 'open the receiving door for the arriving van');
  await page.waitForTimeout(1200);
  await setCamera({ lx: 11.35, lz: -2.0, yaw: -1.125, pitch: -0.18 });
  await page.waitForTimeout(3600);
  await shot('02-van-and-pad.png', 'Articulated delivery van parked at nine-box exterior pad.');
  await setCamera({ lx: 6.7, lz: -1.65, yaw: 0, pitch: -0.28 });
  await shot('03-safe-fallback-ten.png', 'Ten cartons in the marked interior fallback zone.');

  // Fixture setup chooses a real fallback box; placement/opening remain trusted controls.
  const heroId = await page.evaluate(async () => {
    const delivery = await import('/src/sim/deliveries.js');
    const app = window.__fw;
    const box = delivery.boxesOf(app.state)
      .filter((candidate) => candidate.loc === 'receiving-fallback')
      .sort((a, b) => (b.receivingSlot ?? -1) - (a.receivingSlot ?? -1))[0];
    if (!delivery.pickUpBox(app.state, box.id).ok) throw new Error('fixture could not lift top fallback carton');
    app.scene3d.clubhouse().rebuildBoxes();
    return box.id;
  });
  await setCamera({ lx: 6.9, lz: 0.75, yaw: 0, pitch: -0.35 });
  await waitFocus(/packing worktable/);
  await press('e', 'place carried carton on authored packing worktable');
  await page.waitForTimeout(450);
  const worktablePlacement = await page.evaluate(async (id) => {
    const delivery = await import('/src/sim/deliveries.js');
    const box = delivery.findBox(window.__fw.state, id);
    return { surface: box.surface, y: box.y, loc: box.loc, tape: box.tape };
  }, heroId);
  requireTruth(
    worktablePlacement.surface === 'worktable'
      && worktablePlacement.y === 0.925
      && worktablePlacement.tape === 0,
    `fresh worktable placement was not sealed: ${JSON.stringify(worktablePlacement)}`,
  );
  await shot('04-worktable-sealed.png', 'Sealed carton placed at the purpose-built worktable.');
  await waitFocus(/cut the tape/);
  for (let pass = 0; pass < 4; pass += 1) {
    const tape = await page.evaluate(async (id) => {
      const delivery = await import('/src/sim/deliveries.js');
      return delivery.findBox(window.__fw.state, id)?.tape || 0;
    }, heroId);
    if (tape >= 1) break;
    await hold('e', 900, `run authored cutter down the top seam (pass ${pass + 1})`);
  }
  const tapeCut = await page.evaluate(async (id) => {
    const delivery = await import('/src/sim/deliveries.js');
    return (delivery.findBox(window.__fw.state, id)?.tape || 0) >= 1;
  }, heroId);
  requireTruth(tapeCut, 'trusted cutter holds did not complete the top seam');
  // Reassert the fixed inspection pose after the hold. The normal collision
  // solver can nudge a stationary camera a few centimetres from the table.
  await setCamera({ lx: 6.9, lz: 0.75, yaw: 0, pitch: -0.35 });
  await waitFocus(/open a flap/);
  for (let index = 0; index < 3; index += 1) {
    const opened = await page.evaluate(async (id) => {
      const delivery = await import('/src/sim/deliveries.js');
      return delivery.flapsOpen(delivery.findBox(window.__fw.state, id));
    }, heroId);
    if (opened) break;
    await press('e', `open worktable flap ${index + 1}`);
    await page.waitForTimeout(350);
  }
  await shot('05-worktable-open-contents.png', 'Open carton with current product silhouettes and correctly hinged flaps.');
  await press('e', 'remove one armful from open carton');
  await page.waitForTimeout(450);
  await shot('06-product-carry-hands.png', 'Six actual product packs carried with two visible hands.');

  await setCamera({ lx: 8.25, lz: -0.60, yaw: -Math.PI / 2, pitch: -0.20 });
  await waitFocus(/receiving reserve/);
  await page.waitForTimeout(1300); // approximate the normal walk while the prior toast clears
  await press('e', 'store carried units on authored reserve rack');
  await page.waitForTimeout(600);
  await shot('07-loose-reserve-rack.png', 'Authoritative grouped reserve row with exact quantity tag.');
  await waitFocus(/Reserve:.*take an armful/);
  const beforeShelfStock = await page.evaluate(() => ({
    reserve: window.__fw.state.shop.inventory.balls2.back,
    shelf: window.__fw.state.shop.inventory.balls2.shelf,
  }));
  await press('e', 'take the visible SKU row back out of receiving reserve');
  await page.waitForTimeout(450);
  await shot('07b-reserve-armful.png', 'The same reserve SKU carried toward its authored retail fixture.');
  await setCamera({ lx: -6.9, lz: -4.05, yaw: 0, pitch: -0.10 });
  await waitFocus(/Ball wall.*hold.*stock/i);
  await hold('e', 1150, 'physically stock the carried reserve units onto the ball wall');
  const afterShelfStock = await page.evaluate(() => ({
    reserve: window.__fw.state.shop.inventory.balls2.back,
    shelf: window.__fw.state.shop.inventory.balls2.shelf,
    carry: window.__fw.state.shop.carry,
  }));
  requireTruth(
    beforeShelfStock.reserve - afterShelfStock.reserve === 6
      && afterShelfStock.shelf - beforeShelfStock.shelf === 6
      && afterShelfStock.carry == null,
    `reserve-to-shelf stocking did not conserve six units: ${JSON.stringify({ beforeShelfStock, afterShelfStock })}`,
  );
  await shot('07c-retail-shelf-stocked.png', 'Six reserve units physically stocked into their compatible retail slots.');
  await page.waitForTimeout(1500);

  const rackBoxId = await page.evaluate(async () => {
    const delivery = await import('/src/sim/deliveries.js');
    const app = window.__fw;
    const box = delivery.boxesOf(app.state)
      .filter((candidate) => candidate.loc === 'receiving-fallback')
      .sort((a, b) => (b.receivingSlot ?? -1) - (a.receivingSlot ?? -1))[0];
    if (!delivery.pickUpBox(app.state, box.id).ok) throw new Error('fixture could not lift next top fallback carton');
    app.scene3d.clubhouse().rebuildBoxes();
    return box.id;
  });
  await setCamera({ lx: 8.05, lz: -4.45, yaw: 0, pitch: -0.20 });
  await waitFocus(/carton rack/);
  await press('e', 'place unopened carton into authored rack slot');
  await page.waitForTimeout(500);
  const rackPlacement = await page.evaluate(async (id) => {
    const delivery = await import('/src/sim/deliveries.js');
    const box = delivery.findBox(window.__fw.state, id);
    return { surface: box.surface, slot: box.surfaceSlot, y: box.y };
  }, rackBoxId);
  requireTruth(/^reserve-rack:/.test(rackPlacement.surface || ''), 'box did not enter a rack slot');
  await shot('08-unopened-carton-rack.png', 'Persistent unopened carton occupying one authored rack slot.');

  const flatId = await page.evaluate(async () => {
    const delivery = await import('/src/sim/deliveries.js');
    const stocking = await import('/src/sim/stocking.js');
    const app = window.__fw;
    const box = delivery.boxesOf(app.state)
      .filter((candidate) => candidate.loc === 'receiving-fallback')
      .sort((a, b) => (b.receivingSlot ?? -1) - (a.receivingSlot ?? -1))[0];
    delivery.cutTape(app.state, box.id, 1);
    delivery.openFlap(app.state, box.id);
    delivery.openFlap(app.state, box.id);
    while (box.qty > 0) {
      delivery.takeFromBox(app.state, box.id);
      stocking.storeInBack(app.state);
    }
    delivery.flattenBox(app.state, box.id);
    if (!delivery.pickUpBox(app.state, box.id).ok) throw new Error('fixture could not lift flattened fallback carton');
    app.scene3d.clubhouse().rebuildStock();
    app.scene3d.clubhouse().rebuildBoxes();
    return box.id;
  });
  await setCamera({ lx: 7.0, lz: -0.15, yaw: Math.PI, pitch: -0.20 });
  await waitFocus(/recycling/);
  await page.waitForTimeout(2500); // let the prior rack-placement toast clear before recycling evidence
  await shot('09-recycling-before.png', 'Flattened carton carried to the two-stream recycling station.');
  await press('e', 'recycle flattened carton');
  await page.waitForTimeout(500);
  const recycled = await page.evaluate(async (id) => {
    const delivery = await import('/src/sim/deliveries.js');
    return !delivery.findBox(window.__fw.state, id);
  }, flatId);
  requireTruth(recycled, 'flattened carton remained after recycling');
  await shot('10-recycling-after.png', 'Recycling station after the carton leaves the world.');

  const performance = await page.evaluate(async () => {
    const app = window.__fw;
    const renderer = app.scene3d.renderer;
    const frameTimes = [];
    let last = null;
    const start = performance.now();
    await new Promise((resolve) => {
      const frame = (time) => {
        if (last != null) frameTimes.push(time - last);
        last = time;
        if (time - start >= 2200) resolve(); else requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
    const sorted = frameTimes.slice().sort((a, b) => a - b);
    const mean = frameTimes.reduce((sum, value) => sum + value, 0) / frameTimes.length;
    return {
      averageFps: +(1000 / mean).toFixed(2),
      onePercentLowFps: +(1000 / sorted[Math.max(0, Math.floor(sorted.length * 0.99))]).toFixed(2),
      worstFrameMs: +Math.max(...frameTimes).toFixed(2),
      rendererResources: { ...renderer.info.memory },
      boxCount: window.__fw.state.shop.deliveries.boxes.length,
    };
  });
  const finalState = await inventoryState();
  requireTruth(finalState.reconciled, `browser inventory mismatch: ${JSON.stringify(finalState.discrepancies)}`);

  return {
    ok: errors.console === 0 && errors.page === 0 && errors.request === 0 && finalState.reconciled,
    fixture,
    landed,
    worktablePlacement,
    rackPlacement,
    shelfStocking: { before: beforeShelfStock, after: afterShelfStock },
    recycled,
    screenshots,
    actions,
    performance,
    finalState,
    errors,
    diagnostics,
  };
}
