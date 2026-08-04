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
  const { clickThroughMenu } = await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`);
  await clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
  }, null, { timeout: 90000 });
  await page.waitForTimeout(1800);

  await page.evaluate(async () => {
    const delivery = await import(new URL('src/sim/deliveries.js', document.baseURI).href);
    const boxes = await import(new URL('src/data/boxes.js', document.baseURI).href);
    const items = await import(new URL('src/data/shopItems.js', document.baseURI).href);
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
    const sku = items.skuById('balls1');
    const manifest = boxes.planShipment(sku, 12);
    const hero = delivery.arriveOrder(app.state, { id: 99001, skuId: sku.id, qty: 12, manifest })[0];
    delivery.pickUpBox(app.state, hero.id);
    delivery.putDownBox(app.state, hero.id, { x: 7.4, z: -5.2, ry: 0 });
    app.scene3d.clubhouse().rebuildStock();
    app.scene3d.clubhouse().rebuildBoxes();
    const origin = app.scene3d.clubhouse().interior.position;
    const walk = app.scene3d.walk.state;
    walk.x = origin.x + 7.4;
    walk.z = origin.z - 4.1;
    walk.yaw = 0;
    walk.pitch = -0.42;
  });
  await page.waitForTimeout(600);
  await page.locator('canvas').first().click({ position: { x: 800, y: 450 } });
  await page.waitForTimeout(300);

  const read = async (step) => page.evaluate(async (name) => {
    const delivery = await import(new URL('src/sim/deliveries.js', document.baseURI).href);
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

  await page.keyboard.down('e');
  await page.waitForTimeout(1750);
  await page.keyboard.up('e');
  await page.waitForTimeout(300);
  states.push(await read('after-cut'));
  await page.screenshot({ path: path.join(out, '02-after-cut.png') });

  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('e');
    await page.waitForTimeout(350);
    states.push(await read(`tap-${i + 1}`));
    await page.screenshot({ path: path.join(out, `0${i + 3}-tap-${i + 1}.png`) });
  }

  return {
    ok: diagnostics.length === 0,
    states,
    diagnostics,
    pointerLocked: await page.evaluate(() => !!document.pointerLockElement),
  };
}
