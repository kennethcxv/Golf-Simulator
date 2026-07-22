async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const out = path.resolve(process.env.QA_OUTPUT_DIR || 'qa/inventory-delivery-loop/smoke');
  fs.mkdirSync(out, { recursive: true });
  const diagnostics = [];
  page.on('console', (message) => {
    if (message.type() === 'error') diagnostics.push({ kind: 'console', text: message.text() });
  });
  page.on('pageerror', (error) => diagnostics.push({ kind: 'pageerror', text: error.message }));

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  const continueButton = page.getByText('Continue', { exact: true }).first();
  await continueButton.waitFor({ state: 'visible', timeout: 30000 });
  await continueButton.click();
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
  }, null, { timeout: 90000 });
  await page.waitForTimeout(1800);

  await page.evaluate(async () => {
    const delivery = await import('/src/sim/deliveries.js');
    const boxes = await import('/src/data/boxes.js');
    const placement = await import('/src/sim/boxPlacement.js');
    const surfaces = await import('/src/data/boxPlacementSurfaces.js');
    const items = await import('/src/data/shopItems.js');
    const app = window.__fw;
    app.speedIdx = 0;
    app.state.cash = 250000;
    app.state.shop.deliveries.boxes = [];
    app.state.shop.deliveries.shipments = [];
    app.state.shop.deliveries.arrivedOrderIds = [];
    app.state.shop.deliveries.nextBoxId = 1;
    app.state.shop.orders = [];
    app.state.shop.carry = null;
    app.state.shop.inventory.balls1.shelf = 0;
    if (app.state.shop.reno) {
      app.state.shop.reno.grime?.fill?.(0);
      app.state.shop.reno.clutter = [];
    }
    const sku = items.skuById('balls1');
    const manifest = boxes.planShipment(sku, 12);
    const hero = delivery.arriveOrder(app.state, { id: 99001, skuId: sku.id, qty: 12, manifest })[0];
    const picked = delivery.pickUpBox(app.state, hero.id);
    if (!picked.ok) throw new Error(`Could not stage delivery carton: ${picked.reason}`);
    const packingSurface = placement.surfaceById(
      app.state,
      surfaces.PACKING_STATION_BOX_SURFACE_ID,
    );
    if (!packingSurface?.available) throw new Error('Packing-bench surface is unavailable.');
    const placed = delivery.putDownBox(app.state, hero.id, {
      kind: 'surface',
      surfaceId: surfaces.PACKING_STATION_BOX_SURFACE_ID,
      x: 0,
      z: 0,
      ry: 0,
    });
    if (!placed.ok) throw new Error(`Could not stage packing-bench carton: ${placed.reason}`);
    app.scene3d.clubhouse().rebuildStock();
    app.scene3d.clubhouse().rebuildBoxes();
    app.scene3d.clubhouse().rebuildReno?.();
    const origin = app.scene3d.clubhouse().interior.position;
    const walk = app.scene3d.walk.state;
    // Generated shops may move the packing bench. Surface placement persists
    // local x/z offsets, so aim from its resolved world pose.
    walk.x = origin.x + packingSurface.worldPose.x;
    walk.z = origin.z + packingSurface.worldPose.z + 1.34;
    walk.yaw = 0;
    walk.pitch = -0.35;
  });
  await page.waitForTimeout(600);
  await page.locator('canvas').first().click({ position: { x: 800, y: 450 } });
  await page.waitForTimeout(300);

  const read = async (step) => page.evaluate(async (name) => {
    const delivery = await import('/src/sim/deliveries.js');
    const app = window.__fw;
    const box = delivery.boxesOf(app.state)[0];
    return {
      step: name,
      focus: app.scene3d.walk.getFocusLabel?.(),
      tool: app.scene3d.walk.getTool?.(),
      box: box && {
        id: box.id, tape: box.tape, flaps: [...box.flaps], qty: box.qty,
        state: delivery.boxState(box), loc: box.loc, surface: box.surface || null,
      },
      carry: app.state.shop.carry ? { ...app.state.shop.carry } : null,
      shelf: app.state.shop.inventory.balls1.shelf,
    };
  }, step);
  const states = [await read('sealed')];
  await page.screenshot({ path: path.join(out, '01-sealed.png') });
  await page.waitForFunction(
    () => /tap \[E\] once to equip/i.test(window.__fw.scene3d.walk.getFocusLabel?.() || ''),
    null,
    { timeout: 5000 },
  );

  // A sealed carton deliberately uses two separate normal-control gestures:
  // tap E to equip the cutter, then hold E to run its accessibility path down
  // the tape. Combining those gestures made this smoke stop at cutter equip
  // while still reporting success.
  await page.keyboard.press('e');
  await page.waitForFunction(
    () => window.__fw.scene3d.walk.getTool?.() === 'boxcutter',
    null,
    { timeout: 3000 },
  );
  states.push(await read('cutter-equipped'));
  await page.screenshot({ path: path.join(out, '02-cutter-equipped.png') });

  await page.keyboard.down('e');
  try {
    await page.waitForFunction(
      () => (window.__fw.state.shop.deliveries.boxes[0]?.tape || 0) >= 1,
      null,
      { timeout: 5000 },
    );
  } finally {
    await page.keyboard.up('e').catch(() => {});
  }
  await page.waitForTimeout(300);
  states.push(await read('tape-cut'));
  await page.screenshot({ path: path.join(out, '03-tape-cut.png') });

  await page.keyboard.press('e');
  await page.waitForFunction(
    () => {
      const box = window.__fw.state.shop.deliveries.boxes[0];
      const flaps = box?.flapProgress || box?.flaps || [];
      return flaps.length >= 2 && flaps.every((flap) => flap >= 1);
    },
    null,
    { timeout: 5000 },
  );
  states.push(await read('carton-open'));
  await page.screenshot({ path: path.join(out, '04-carton-open.png') });

  await page.keyboard.press('e');
  await page.waitForFunction(
    () => window.__fw.state.shop.carry?.skuId === 'balls1',
    null,
    { timeout: 3000 },
  );
  states.push(await read('armful-taken'));
  await page.screenshot({ path: path.join(out, '05-armful-taken.png') });

  await page.evaluate(async () => {
    const app = window.__fw;
    const layout = await import('/src/sim/layout.js');
    const fixture = layout.fixtureById(app.state, 'shelf_balls');
    if (!fixture) throw new Error('Operational shop has no ball-wall fixture.');
    const origin = app.scene3d.clubhouse().interior.position;
    const walk = app.scene3d.walk.state;
    const distance = 0.95;
    walk.x = origin.x + fixture.x + Math.sin(fixture.ry) * distance;
    walk.z = origin.z + fixture.z + Math.cos(fixture.ry) * distance;
    walk.yaw = fixture.ry;
    walk.pitch = -0.75;
    app.scene3d.walk.clearKeys?.();
  });
  await page.waitForTimeout(500);
  const shelfAim = await page.evaluate(async () => {
    const app = window.__fw;
    const layout = await import('/src/sim/layout.js');
    const focus = app.scene3d.walk.getFocus?.();
    const fixture = layout.fixtureById(app.state, 'shelf_balls');
    const origin = app.scene3d.clubhouse().interior.position;
    return {
      label: app.scene3d.walk.getFocusLabel?.() || null,
      focus: focus ? {
        kind: focus.kind,
        label: focus.label || null,
        prop: focus.prop ? {
          x: focus.prop.x,
          z: focus.prop.z,
          r: focus.prop.r,
          fixtureLayoutId: focus.prop.fixtureLayoutId || null,
        } : null,
      } : null,
      tool: app.scene3d.walk.getTool?.() || null,
      fixture,
      walk: {
        x: app.scene3d.walk.state.x - origin.x,
        z: app.scene3d.walk.state.z - origin.z,
        yaw: app.scene3d.walk.state.yaw,
        pitch: app.scene3d.walk.state.pitch,
      },
    };
  });
  fs.writeFileSync(path.join(out, 'shelf-aim.json'), `${JSON.stringify(shelfAim, null, 2)}\n`);
  await page.waitForFunction(
    () => /(?:Ball wall|Golf balls).*hold \[E\] to stock/i.test(window.__fw.scene3d.walk.getFocusLabel?.() || ''),
    null,
    { timeout: 5000 },
  );
  await page.keyboard.down('e');
  try {
    await page.waitForFunction(
      () => !window.__fw.state.shop.carry,
      null,
      { timeout: 5000 },
    );
  } finally {
    await page.keyboard.up('e').catch(() => {});
  }
  await page.waitForTimeout(1400);
  states.push(await read('shelf-stocked'));
  await page.screenshot({ path: path.join(out, '06-shelf-stocked.png') });

  const sealed = states.find((state) => state.step === 'sealed');
  const equipped = states.find((state) => state.step === 'cutter-equipped');
  const cut = states.find((state) => state.step === 'tape-cut');
  const opened = states.find((state) => state.step === 'carton-open');
  const taken = states.find((state) => state.step === 'armful-taken');
  const stocked = states.find((state) => state.step === 'shelf-stocked');
  const assertions = {
    sealedCartonFocused: /tap \[E\] once to equip/i.test(sealed?.focus || ''),
    cutterEquipped: equipped?.tool === 'boxcutter',
    tapeFullyCut: cut?.box?.tape >= 1,
    cartonFullyOpened: /take an armful/i.test(opened?.focus || ''),
    armfulRemoved: taken?.carry?.skuId === 'balls1' && taken.box.qty < sealed.box.qty,
    compatibleShelfStocked: stocked?.carry == null && stocked?.shelf > 0,
    quantityConserved: stocked?.shelf + stocked?.box?.qty === sealed?.box?.qty,
    diagnosticsClean: diagnostics.length === 0,
  };

  return {
    ok: Object.values(assertions).every(Boolean),
    assertions,
    states,
    diagnostics,
    pointerLocked: await page.evaluate(() => !!document.pointerLockElement),
  };
}
