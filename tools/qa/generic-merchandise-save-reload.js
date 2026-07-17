async (page) => {
  // Durable reference-46 generic-merchandise carton recovery probe.
  //
  // A documented fixture establishes one repeatable eight-cap delivery. Every
  // lifecycle transition is then made through the player-facing E-key route.
  // At CUTTING, OPENING, and PARTIALLY_EMPTIED we call the game's own autosave,
  // inspect golfempire:autosave, reload, choose Continue, and compare the exact
  // durable carton fields with the reconstructed live state.

  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = 'C:/Users/Kenneth/Documents/GitHub/Golf-Flipper';
  const out = path.join(repo, 'qa', 'box_system_master', 'generic_merchandise', 'save_reload');
  fs.mkdirSync(out, { recursive: true });

  const fixtureOrderId = 940046;
  const fixtureQty = 8;
  const fixtureSpot = Object.freeze({ x: 8.25, z: -1.7, ry: 0 });
  const cameras = Object.freeze({
    box: { x: 8.25, z: -0.43, yaw: 0, pitch: -0.66 },
    hatWall: { x: -3.4, z: -0.10, yaw: 0, pitch: -0.24 },
    recycling: { x: 9.05, z: 1.3, yaw: -Math.PI / 2, pitch: -0.40 },
  });

  const diagnostics = [];
  const diagnosticCounts = {
    consoleError: 0,
    consoleWarning: 0,
    pageError: 0,
    requestFailed: 0,
  };
  let expectedNavigation = true;
  const noteDiagnostic = (kind, text) => {
    diagnosticCounts[kind] += 1;
    if (diagnostics.length < 100) diagnostics.push({ kind, text: String(text), at: new Date().toISOString() });
  };
  page.on('console', (message) => {
    if (message.type() === 'error') noteDiagnostic('consoleError', message.text());
    if (message.type() === 'warning') noteDiagnostic('consoleWarning', message.text());
  });
  page.on('pageerror', (error) => noteDiagnostic('pageError', error.message));
  page.on('requestfailed', (request) => {
    const failure = request.failure()?.errorText || 'unknown';
    if (expectedNavigation && /ERR_ABORTED/i.test(failure)) return;
    noteDiagnostic('requestFailed', `${request.url()} (${failure})`);
  });
  page.on('response', (response) => {
    if (response.status() >= 400) noteDiagnostic('requestFailed', `${response.url()} (HTTP ${response.status()})`);
  });

  async function waitForGame() {
    const continueButton = page.getByText('Continue', { exact: true });
    await continueButton.waitFor({ state: 'visible', timeout: 30000 });
    await continueButton.click();
    await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
    await page.waitForFunction(() => {
      const veil = document.querySelector('.load-veil');
      return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
    }, null, { timeout: 90000 });
    await page.waitForFunction(() => {
      const clubhouse = window.__fw?.scene3d?.clubhouse?.();
      return !!clubhouse && (typeof clubhouse.assetsReady !== 'function' || clubhouse.assetsReady());
    }, null, { timeout: 90000 });
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(500);
    expectedNavigation = false;

    await page.evaluate(() => {
      const app = window.__fw;
      app.speedIdx = 0;
      app.scene3d.walk.clearKeys?.();
      const clubhouse = app.scene3d.clubhouse();
      clubhouse.setOrganicWalkins?.(false);
      clubhouse.clearWalkins?.();
    });
  }

  async function acquirePointerLock() {
    const canvas = page.locator('canvas').first();
    await canvas.waitFor({ state: 'visible', timeout: 30000 });
    await page.bringToFront();
    await page.mouse.move(800, 450);
    await canvas.click({ position: { x: 800, y: 450 }, force: true });
    await page.waitForFunction(
      () => document.pointerLockElement === document.querySelector('canvas'),
      null,
      { timeout: 7000 },
    );
  }

  async function firstBoot() {
    expectedNavigation = true;
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto('http://localhost:8457/', { waitUntil: 'domcontentloaded' });
    await waitForGame();
    await acquirePointerLock();
  }

  async function reloadAndContinue() {
    expectedNavigation = true;
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForGame();
    await acquirePointerLock();
  }

  async function setCamera(pose) {
    await page.evaluate((next) => {
      const app = window.__fw;
      const origin = app.scene3d.clubhouse().interior.position;
      const walk = app.scene3d.walk;
      walk.clearKeys?.();
      walk.state.x = origin.x + next.x;
      walk.state.z = origin.z + next.z;
      walk.state.yaw = next.yaw;
      walk.state.pitch = next.pitch;
    }, pose);
    await page.waitForTimeout(300);
  }

  async function waitForFocus(pattern, timeout = 7000) {
    await page.waitForFunction(({ source, flags }) => {
      const label = window.__fw?.scene3d?.walk?.getFocusLabel?.() || '';
      return new RegExp(source, flags).test(label);
    }, { source: pattern.source, flags: pattern.flags }, { timeout });
    return page.evaluate(() => ({
      label: window.__fw.scene3d.walk.getFocusLabel?.() || null,
      tool: window.__fw.scene3d.walk.getTool?.() || null,
    }));
  }

  async function stageGeneric() {
    const staged = await page.evaluate(async ({ orderId, qty, spot }) => {
      const D = await import('/src/sim/deliveries.js');
      const app = window.__fw;
      const state = app.state;
      D.ensureDeliveries(state);
      const delivery = state.shop.deliveries;
      delivery.boxes = [];
      delivery.shipments = [];
      delivery.arrivedOrderIds = [];
      delivery.nextBoxId = 1;
      delivery.trash = 0;
      delivery.recycled = 0;
      state.shop.carry = null;
      state.shop.inventory.cap1.shelf = 0;
      state.shop.inventory.cap1.back = 0;
      if (state.notifications) {
        state.notifications.items = [];
        state.notifications.nextId = 1;
      }

      const manifest = {
        supplierId: 'willow-creek-merchandise-save-qa',
        supplier: 'Willow Creek Merchandise',
        boxes: [{ kind: 'merchbox', qty, w: 0.60, h: 0.40, d: 0.40, lb: +(qty * 0.25).toFixed(2), fragile: false }],
        boxCount: 1,
        weight: +(qty * 0.25).toFixed(2),
        fee: 9,
      };
      const [box] = D.arriveOrder(state, { id: orderId, skuId: 'cap1', qty, manifest });
      if (!box) throw new Error(`Could not stage generic delivery order ${orderId}.`);
      if (!D.pickUpBox(state, box.id).ok) throw new Error('Could not pick up the staged generic carton.');
      if (!D.putDownBox(state, box.id, spot).ok) throw new Error('Could not place the staged generic carton.');
      app.scene3d.clubhouse().rebuildBoxes();
      return { id: box.id, orderId: box.orderId, skuId: box.skuId, qty: box.qty };
    }, { orderId: fixtureOrderId, qty: fixtureQty, spot: fixtureSpot });

    await page.waitForFunction((boxId) => {
      const root = window.__fw?.scene3d?.scene?.getObjectByName(`DeliveryBox_${boxId}`);
      return !!root?.getObjectByName('delivery_generic_merchandise_box')
        && !!root?.getObjectByName('BOX_FLAP_FRONT')
        && !!root?.getObjectByName('CONTENT_SLOT_01')
        && !!root?.getObjectByName('BOX_CONTENT_01_cap1');
    }, staged.id, { timeout: 30000 });
    return staged;
  }

  async function liveSnapshot(boxId) {
    return page.evaluate(async (id) => {
      const D = await import('/src/sim/deliveries.js');
      const B = await import('/src/data/boxes.js');
      const state = window.__fw.state;
      D.ensureDeliveries(state);
      const delivery = state.shop.deliveries;
      const box = delivery.boxes.find((candidate) => candidate.id === id);
      if (!box) throw new Error(`Live box ${id} is missing.`);
      const durableBox = {
        id: box.id,
        orderId: box.orderId,
        skuId: box.skuId,
        box: box.box,
        dimensions: B.boxDims(box.box),
        loc: box.loc,
        qty: box.qty,
        cap: box.cap,
        initialQty: box.initialQty,
        cutProgress: box.cutProgress,
        tape: box.tape,
        tapeSegments: { ...box.tapeSegments },
        flapProgress: [...box.flapProgress],
        flaps: [...box.flaps],
        openingProgress: box.openingProgress,
        flattenProgress: box.flattenProgress,
        flat: box.flat,
        lifecycle: box.lifecycle,
        derivedLifecycle: D.boxLifecycleState(box),
        schemaVersion: box.schemaVersion,
      };
      return {
        box: durableBox,
        carry: state.shop.carry ? { ...state.shop.carry } : null,
        inventory: {
          shelf: state.shop.inventory.cap1.shelf,
          back: state.shop.inventory.cap1.back,
        },
        delivery: {
          boxCount: delivery.boxes.length,
          shipmentCount: delivery.shipments.length,
          arrivedOrderIds: [...delivery.arrivedOrderIds],
          shipments: delivery.shipments.map((shipment) => ({
            orderId: shipment.orderId,
            skuId: shipment.skuId,
            units: shipment.units,
            boxCount: shipment.boxCount,
          })),
        },
      };
    }, boxId);
  }

  async function visualSnapshot(boxId) {
    return page.evaluate((id) => {
      const scene = window.__fw.scene3d.scene;
      const root = scene.getObjectByName(`DeliveryBox_${id}`);
      const authored = root?.getObjectByName('delivery_generic_merchandise_box') || null;
      const names = [];
      root?.traverse((object) => { if (object.name) names.push(object.name); });
      const capProducts = names.filter((name) => /^BOX_CONTENT_\d{2}_cap1$/.test(name));
      const visibleCapProducts = [];
      root?.traverse((object) => {
        if (!/^BOX_CONTENT_\d{2}_cap1$/.test(object.name || '')) return;
        let visible = object.visible;
        for (let parent = object.parent; parent && parent !== root; parent = parent.parent) visible = visible && parent.visible;
        if (visible) visibleCapProducts.push(object.name);
      });
      return {
        deliveryRoot: root?.name || null,
        authoredRoot: authored?.name || null,
        assetId: authored?.userData?.asset_id || null,
        targetDimensionsM: authored?.userData?.target_dimensions_m || null,
        fourWalls: ['FRONT', 'BACK', 'LEFT', 'RIGHT'].every((side) => !!root?.getObjectByName(`BOX_WALL_${side}`)),
        fourFlaps: ['FRONT', 'BACK', 'LEFT', 'RIGHT'].every((side) => !!root?.getObjectByName(`BOX_FLAP_${side}`)),
        contentSlots: names.filter((name) => /^CONTENT_SLOT_\d{2}$/.test(name)).length,
        capProducts: capProducts.length,
        capProductNames: capProducts,
        visibleCapProducts: visibleCapProducts.length,
      };
    }, boxId);
  }

  async function autosaveSnapshot(boxId) {
    return page.evaluate(async (id) => {
      const app = window.__fw;
      const B = await import('/src/data/boxes.js');
      await app.autosave();
      const raw = localStorage.getItem('golfempire:autosave');
      if (!raw) throw new Error('The game autosave did not create golfempire:autosave.');
      const empire = JSON.parse(raw);
      const holding = empire.holdings.find((candidate) => candidate.property.id === empire.activeId);
      if (!holding) throw new Error(`Autosave has no active holding for ${empire.activeId}.`);
      const state = holding.state;
      const delivery = state.shop.deliveries;
      const box = delivery.boxes.find((candidate) => candidate.id === id);
      if (!box) throw new Error(`Autosave is missing box ${id}.`);
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
      const rawSha256 = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
      return {
        storageKey: 'golfempire:autosave',
        rawBytes: raw.length,
        rawSha256,
        rawContainsCap1: raw.includes('"skuId":"cap1"'),
        rawContainsMerchbox: raw.includes('"box":"merchbox"'),
        activeId: empire.activeId,
        box: {
          id: box.id,
          orderId: box.orderId,
          skuId: box.skuId,
          box: box.box,
          dimensions: B.boxDims(box.box),
          loc: box.loc,
          qty: box.qty,
          cap: box.cap,
          initialQty: box.initialQty,
          cutProgress: box.cutProgress,
          tape: box.tape,
          tapeSegments: { ...box.tapeSegments },
          flapProgress: [...box.flapProgress],
          flaps: [...box.flaps],
          openingProgress: box.openingProgress,
          flattenProgress: box.flattenProgress,
          flat: box.flat,
          lifecycle: box.lifecycle,
          derivedLifecycle: box.lifecycle,
          schemaVersion: box.schemaVersion,
        },
        carry: state.shop.carry ? { ...state.shop.carry } : null,
        inventory: {
          shelf: state.shop.inventory.cap1.shelf,
          back: state.shop.inventory.cap1.back,
        },
        delivery: {
          boxCount: delivery.boxes.length,
          shipmentCount: delivery.shipments.length,
          arrivedOrderIds: [...delivery.arrivedOrderIds],
          shipments: delivery.shipments.map((shipment) => ({
            orderId: shipment.orderId,
            skuId: shipment.skuId,
            units: shipment.units,
            boxCount: shipment.boxCount,
          })),
        },
      };
    }, boxId);
  }

  const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

  async function capture(fileName) {
    const file = path.join(out, fileName);
    await page.screenshot({ path: file });
    return file;
  }

  async function equipCutter() {
    const focused = await waitForFocus(/box cutter|finish the cut|cut the tape/i);
    if (focused.tool !== 'boxcutter') {
      await page.keyboard.press('e');
      await page.waitForFunction(() => window.__fw?.scene3d?.walk?.getTool?.() === 'boxcutter');
      await page.waitForTimeout(150);
    }
  }

  async function holdEUntil(boxId, condition, timeout = 6000) {
    await page.keyboard.down('e');
    try {
      await page.waitForFunction(({ id, wanted }) => {
        const box = window.__fw?.state?.shop?.deliveries?.boxes?.find((candidate) => candidate.id === id);
        if (!box) return false;
        const cut = box.cutProgress ?? box.tape ?? 0;
        if (wanted === 'mid-cut') return cut >= 0.40 && cut <= 0.65;
        if (wanted === 'cut') return cut >= 0.999;
        return false;
      }, { id: boxId, wanted: condition }, { timeout });
    } finally {
      await page.keyboard.up('e').catch(() => {});
    }
    await page.waitForTimeout(100);
  }

  async function stockCurrentArmful() {
    await setCamera(cameras.hatWall);
    await waitForFocus(/Hat tree.*hold \[E\] to stock/i);
    await page.keyboard.down('e');
    try {
      await page.waitForFunction(() => !window.__fw?.state?.shop?.carry, null, { timeout: 6000 });
    } finally {
      await page.keyboard.up('e').catch(() => {});
    }
    await page.waitForTimeout(650);
  }

  async function chooseRecyclingFocus() {
    const poses = [
      cameras.recycling,
      { x: 9.10, z: 1.3, yaw: -Math.PI / 2, pitch: -0.46 },
      { x: 9.85, z: -0.15, yaw: Math.PI, pitch: -0.42 },
    ];
    for (const pose of poses) {
      await setCamera(pose);
      const label = await page.evaluate(() => window.__fw.scene3d.walk.getFocusLabel?.() || '');
      if (/Recycling.*drop the flattened carton/i.test(label)) return pose;
    }
    throw new Error('Could not focus the recycling drop after save/load recovery.');
  }

  await firstBoot();
  const fixtureCase = await stageGeneric();
  await setCamera(cameras.box);
  const initialVisual = await visualSnapshot(fixtureCase.id);

  const checkpoints = {};
  const screenshots = [];

  // CUTTING: deliberately release before the three-segment cut completes.
  await equipCutter();
  await holdEUntil(fixtureCase.id, 'mid-cut');
  checkpoints.cutting = { saved: await autosaveSnapshot(fixtureCase.id) };
  screenshots.push(await capture('01-cutting-before-reload.png'));
  await reloadAndContinue();
  checkpoints.cutting.reloaded = await liveSnapshot(fixtureCase.id);
  checkpoints.cutting.reloadedVisual = await visualSnapshot(fixtureCase.id);
  await setCamera(cameras.box);
  screenshots.push(await capture('02-cutting-after-reload.png'));

  // Finish the existing cut through the normal two-step equip, then hold route.
  await equipCutter();
  await holdEUntil(fixtureCase.id, 'cut');

  // OPENING: one tap starts the authored front/back/side flap sequence. Autosave
  // while it is in flight; the animation itself is intentionally not a fixture.
  await page.keyboard.press('e');
  await page.waitForFunction((id) => {
    const box = window.__fw?.state?.shop?.deliveries?.boxes?.find((candidate) => candidate.id === id);
    return !!box && box.lifecycle === 'OPENING'
      && box.openingProgress > 0.20 && box.openingProgress < 0.80
      && box.flapProgress.some((value) => value > 0 && value < 1);
  }, fixtureCase.id, { timeout: 5000 });
  checkpoints.opening = { saved: await autosaveSnapshot(fixtureCase.id) };
  screenshots.push(await capture('03-opening-before-reload.png'));
  await reloadAndContinue();
  checkpoints.opening.reloaded = await liveSnapshot(fixtureCase.id);
  checkpoints.opening.reloadedVisual = await visualSnapshot(fixtureCase.id);
  await setCamera(cameras.box);
  screenshots.push(await capture('04-opening-after-reload.png'));

  // The one-shot animation is reconstructed by another normal E tap after load.
  await waitForFocus(/open the carton/i);
  await page.keyboard.press('e');
  await page.waitForFunction((id) => {
    const box = window.__fw?.state?.shop?.deliveries?.boxes?.find((candidate) => candidate.id === id);
    return !!box && box.flapProgress.length === 4 && box.flapProgress.every((value) => value >= 0.999);
  }, fixtureCase.id, { timeout: 5000 });

  // PARTIALLY_EMPTIED: take one real two-cap armful from 8 -> 6.
  await waitForFocus(/Willow Creek cap.*take an armful/i);
  await page.keyboard.press('e');
  await page.waitForFunction((id) => {
    const box = window.__fw?.state?.shop?.deliveries?.boxes?.find((candidate) => candidate.id === id);
    const carry = window.__fw?.state?.shop?.carry;
    return !!box && box.qty === 6 && box.lifecycle === 'PARTIALLY_EMPTIED'
      && carry?.skuId === 'cap1' && carry.qty === 2;
  }, fixtureCase.id, { timeout: 5000 });
  checkpoints.partiallyEmptied = { saved: await autosaveSnapshot(fixtureCase.id) };
  screenshots.push(await capture('05-partially-emptied-before-reload.png'));
  await reloadAndContinue();
  checkpoints.partiallyEmptied.reloaded = await liveSnapshot(fixtureCase.id);
  checkpoints.partiallyEmptied.reloadedVisual = await visualSnapshot(fixtureCase.id);
  await setCamera(cameras.box);
  screenshots.push(await capture('06-partially-emptied-after-reload.png'));

  // Prove the recovered carry and generic carton remain fully playable. Stock
  // the persisted two-cap armful, then move the remaining six caps in three
  // honest armfuls before flattening, carrying, and recycling the same box.
  await stockCurrentArmful();
  const recoveredCarryStocked = await liveSnapshot(fixtureCase.id);
  screenshots.push(await capture('07-recovered-two-caps-stocked.png'));

  const resumedArmfuls = [];
  let remaining = 6;
  for (let trip = 1; trip <= 3; trip += 1) {
    await setCamera(cameras.box);
    await waitForFocus(/Willow Creek cap.*take an armful/i);
    await page.keyboard.press('e');
    remaining -= 2;
    await page.waitForFunction(({ id, qty }) => {
      const box = window.__fw?.state?.shop?.deliveries?.boxes?.find((candidate) => candidate.id === id);
      const carry = window.__fw?.state?.shop?.carry;
      return !!box && box.qty === qty && carry?.skuId === 'cap1' && carry.qty === 2;
    }, { id: fixtureCase.id, qty: remaining }, { timeout: 5000 });
    const taken = await liveSnapshot(fixtureCase.id);
    screenshots.push(await capture(`${String(8 + (trip - 1) * 2).padStart(2, '0')}-resume-trip-${trip}-carried.png`));
    await stockCurrentArmful();
    const stocked = await liveSnapshot(fixtureCase.id);
    screenshots.push(await capture(`${String(9 + (trip - 1) * 2).padStart(2, '0')}-resume-trip-${trip}-stocked.png`));
    resumedArmfuls.push({ trip, taken, stocked });
  }

  await setCamera(cameras.box);
  await waitForFocus(/Empty Willow Creek cap box.*flatten/i);
  await page.keyboard.press('e');
  await page.waitForFunction((id) => {
    const box = window.__fw?.state?.shop?.deliveries?.boxes?.find((candidate) => candidate.id === id);
    return !!box && box.flat && box.flattenProgress >= 0.999;
  }, fixtureCase.id, { timeout: 5000 });
  const flattened = await liveSnapshot(fixtureCase.id);
  await page.waitForTimeout(3000);
  screenshots.push(await capture('14-flattened-after-recovery.png'));

  await page.keyboard.press('e');
  await page.waitForFunction((id) => {
    const box = window.__fw?.state?.shop?.deliveries?.boxes?.find((candidate) => candidate.id === id);
    return box?.loc === 'carried';
  }, fixtureCase.id, { timeout: 5000 });
  const recyclingPose = await chooseRecyclingFocus();
  screenshots.push(await capture('15-recycling-ready-after-recovery.png'));
  await page.keyboard.press('e');
  await page.waitForFunction((id) => !window.__fw?.state?.shop?.deliveries?.boxes?.some((box) => box.id === id), fixtureCase.id, { timeout: 5000 });
  await page.waitForTimeout(1200);
  screenshots.push(await capture('16-recycled-after-recovery.png'));
  const completed = await page.evaluate((id) => ({
    shelf: window.__fw.state.shop.inventory.cap1.shelf,
    back: window.__fw.state.shop.inventory.cap1.back,
    carry: window.__fw.state.shop.carry ? { ...window.__fw.state.shop.carry } : null,
    liveBoxes: window.__fw.state.shop.deliveries.boxes.length,
    recycled: window.__fw.state.shop.deliveries.recycled || 0,
    trash: window.__fw.state.shop.deliveries.trash || 0,
    visualGone: !window.__fw.scene3d.scene.getObjectByName(`DeliveryBox_${id}`),
  }), fixtureCase.id);

  const cuttingSaved = checkpoints.cutting.saved;
  const openingSaved = checkpoints.opening.saved;
  const partialSaved = checkpoints.partiallyEmptied.saved;
  const arrivedUnique = new Set(partialSaved.delivery.arrivedOrderIds).size === partialSaved.delivery.arrivedOrderIds.length;
  const partialConservation = partialSaved.box.qty
    + (partialSaved.carry?.qty || 0)
    + partialSaved.inventory.shelf
    + partialSaved.inventory.back;
  const snapshotConservation = (snapshot) => snapshot.box.qty
    + (snapshot.carry?.qty || 0)
    + snapshot.inventory.shelf
    + snapshot.inventory.back;
  const recoveredConservation = snapshotConservation(recoveredCarryStocked);
  const resumedConservation = resumedArmfuls.flatMap(({ taken, stocked }) => [
    snapshotConservation(taken),
    snapshotConservation(stocked),
  ]);
  const exactDimensions = (dimensions) => dimensions?.w === 0.60 && dimensions?.h === 0.40 && dimensions?.d === 0.40;
  const exactGenericVisual = (visual) => visual?.deliveryRoot === `DeliveryBox_${fixtureCase.id}`
    && visual.authoredRoot === 'delivery_generic_merchandise_box'
    && visual.assetId === 'delivery_generic_merchandise_box'
    && same(visual.targetDimensionsM, [0.60, 0.40, 0.40])
    && visual.fourWalls && visual.fourFlaps
    && visual.contentSlots === 8 && visual.capProducts === 8;

  const assertions = {
    cuttingPersisted:
      cuttingSaved.box.lifecycle === 'CUTTING'
      && cuttingSaved.box.cutProgress >= 0.35
      && cuttingSaved.box.cutProgress <= 0.70
      && cuttingSaved.box.cutProgress === cuttingSaved.box.tape,
    cuttingReloadExact: same(cuttingSaved.box, checkpoints.cutting.reloaded.box)
      && same(cuttingSaved.carry, checkpoints.cutting.reloaded.carry)
      && same(cuttingSaved.delivery, checkpoints.cutting.reloaded.delivery),
    openingPersisted:
      openingSaved.box.lifecycle === 'OPENING'
      && openingSaved.box.openingProgress > 0.20
      && openingSaved.box.openingProgress < 0.80
      && openingSaved.box.flapProgress.some((value) => value > 0 && value < 1),
    openingReloadExact: same(openingSaved.box, checkpoints.opening.reloaded.box)
      && same(openingSaved.carry, checkpoints.opening.reloaded.carry)
      && same(openingSaved.delivery, checkpoints.opening.reloaded.delivery),
    partialPersisted:
      partialSaved.box.lifecycle === 'PARTIALLY_EMPTIED'
      && partialSaved.box.qty === 6
      && partialSaved.box.cap === fixtureQty
      && partialSaved.carry?.skuId === 'cap1'
      && partialSaved.carry.qty === 2,
    partialReloadExact: same(partialSaved.box, checkpoints.partiallyEmptied.reloaded.box)
      && same(partialSaved.carry, checkpoints.partiallyEmptied.reloaded.carry)
      && same(partialSaved.inventory, checkpoints.partiallyEmptied.reloaded.inventory)
      && same(partialSaved.delivery, checkpoints.partiallyEmptied.reloaded.delivery),
    genericKindAndDimensionsPersisted: [
      cuttingSaved,
      checkpoints.cutting.reloaded,
      openingSaved,
      checkpoints.opening.reloaded,
      partialSaved,
      checkpoints.partiallyEmptied.reloaded,
    ].every((snapshot) => snapshot.box.box === 'merchbox'
      && exactDimensions(snapshot.box.dimensions)
      && snapshot.box.cap === fixtureQty
      && snapshot.box.initialQty === fixtureQty),
    authoredGenericVisualReconstructed: exactGenericVisual(initialVisual)
      && exactGenericVisual(checkpoints.cutting.reloadedVisual)
      && exactGenericVisual(checkpoints.opening.reloadedVisual)
      && exactGenericVisual(checkpoints.partiallyEmptied.reloadedVisual)
      && checkpoints.cutting.reloadedVisual.visibleCapProducts === 0
      && checkpoints.opening.reloadedVisual.visibleCapProducts === 8
      && checkpoints.partiallyEmptied.reloadedVisual.visibleCapProducts === 6,
    sameBoxAndOrderAcrossAllReloads: [
      cuttingSaved,
      checkpoints.cutting.reloaded,
      openingSaved,
      checkpoints.opening.reloaded,
      partialSaved,
      checkpoints.partiallyEmptied.reloaded,
    ].every((snapshot) => snapshot.box.id === fixtureCase.id && snapshot.box.orderId === fixtureOrderId && snapshot.box.skuId === 'cap1'),
    singleShipmentAndArrivalIdentity:
      partialSaved.delivery.boxCount === 1
      && partialSaved.delivery.shipmentCount === 1
      && arrivedUnique
      && partialSaved.delivery.arrivedOrderIds.length === 1
      && partialSaved.delivery.arrivedOrderIds[0] === fixtureOrderId
      && partialSaved.delivery.shipments[0]?.orderId === fixtureOrderId
      && partialSaved.delivery.shipments[0]?.units === fixtureQty,
    partialUnitsConserved: partialConservation === fixtureQty,
    recoveredCarryStockedNormally: recoveredCarryStocked.box.qty === 6
      && recoveredCarryStocked.inventory.shelf === 2
      && recoveredCarryStocked.inventory.back === 0
      && !recoveredCarryStocked.carry
      && recoveredConservation === fixtureQty,
    remainingSixStockedNormally: resumedArmfuls.length === 3
      && resumedArmfuls.every(({ trip, taken, stocked }) => taken.box.qty === 6 - trip * 2
        && taken.carry?.skuId === 'cap1' && taken.carry.qty === 2
        && stocked.box.qty === taken.box.qty && !stocked.carry
        && stocked.inventory.shelf === 2 + trip * 2)
      && resumedConservation.every((total) => total === fixtureQty),
    sameRecoveredBoxFlattened: flattened.box.id === fixtureCase.id
      && flattened.box.box === 'merchbox'
      && flattened.box.qty === 0
      && flattened.box.flat
      && flattened.box.flattenProgress >= 0.999
      && flattened.inventory.shelf === fixtureQty,
    completedThroughRecycling: completed.shelf === fixtureQty
      && completed.back === 0 && !completed.carry
      && completed.liveBoxes === 0 && completed.recycled === 1 && completed.trash === 0
      && completed.visualGone,
    ownAutosaveKeyUsed: [cuttingSaved, openingSaved, partialSaved]
      .every((snapshot) => snapshot.storageKey === 'golfempire:autosave'
        && snapshot.rawBytes > 0 && snapshot.rawSha256.length === 64
        && snapshot.rawContainsCap1 && snapshot.rawContainsMerchbox),
    noConsoleOrPageErrors: diagnosticCounts.consoleError === 0 && diagnosticCounts.pageError === 0,
    noFailedRequests: diagnosticCounts.requestFailed === 0,
  };

  const result = {
    ok: Object.values(assertions).every(Boolean),
    launch: 'node tools/qa/run-playwright.cjs tools/qa/generic-merchandise-save-reload.js --bootstrap',
    viewport: { width: 1600, height: 900, deviceScaleFactor: 1 },
    fixedCameras: cameras,
    fixture: {
      orderId: fixtureOrderId,
      skuId: 'cap1',
      qty: fixtureQty,
      boxKind: 'merchbox',
      dimensions: { w: 0.60, h: 0.40, d: 0.40 },
      model: 'delivery_generic_merchandise_box',
      spot: fixtureSpot,
    },
    savePath: 'window.__fw.autosave() -> localStorage["golfempire:autosave"] -> active empire holding state',
    checkpoints,
    initialVisual,
    recoveredCarryStocked,
    resumedArmfuls,
    flattened,
    completed,
    recyclingPose,
    conservation: {
      atPartialReload: partialConservation,
      afterRecoveredCarryStocked: recoveredConservation,
      throughoutNormalResume: resumedConservation,
      completedShelf: completed.shelf,
    },
    screenshots,
    assertions,
    diagnostics: { counts: diagnosticCounts, entries: diagnostics },
    generatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(out, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}
