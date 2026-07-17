async (page) => {
  // Durable hero-apparel carton recovery probe.
  //
  // A documented fixture establishes one repeatable eight-polo delivery. Every
  // lifecycle transition is then made through the player-facing E-key route.
  // At CUTTING, OPENING, and PARTIALLY_EMPTIED we call the game's own autosave,
  // inspect golfempire:autosave, reload, choose Continue, and compare the exact
  // durable carton fields with the reconstructed live state.

  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = 'C:/Users/Kenneth/Documents/GitHub/Golf-Flipper';
  const out = path.join(repo, 'qa', 'box_system_master', 'hero_apparel', 'save_reload');
  fs.mkdirSync(out, { recursive: true });

  const heroOrderId = 930001;
  const heroQty = 8;
  const heroSpot = Object.freeze({ x: 8.25, z: -1.7, ry: 0 });
  const cameras = Object.freeze({
    box: { x: 8.25, z: -0.43, yaw: 0, pitch: -0.66 },
    apparelTable: { x: -5.9, z: 2.05, yaw: 0, pitch: -0.42 },
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

  async function stageHero() {
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
      state.shop.inventory.polo1.shelf = 0;
      state.shop.inventory.polo1.back = 0;
      if (state.notifications) {
        state.notifications.items = [];
        state.notifications.nextId = 1;
      }

      const manifest = {
        supplierId: 'pinehollow-apparel-save-qa',
        supplier: 'Pinehollow Apparel Works',
        boxes: [{ kind: 'apparel', qty, w: 0.60, h: 0.35, d: 0.40, lb: +(qty * 0.5).toFixed(1), fragile: false }],
        boxCount: 1,
        weight: +(qty * 0.5).toFixed(1),
        fee: 9,
      };
      const [box] = D.arriveOrder(state, { id: orderId, skuId: 'polo1', qty, manifest });
      if (!box) throw new Error(`Could not stage hero delivery order ${orderId}.`);
      if (!D.pickUpBox(state, box.id).ok) throw new Error('Could not pick up the staged hero carton.');
      if (!D.putDownBox(state, box.id, spot).ok) throw new Error('Could not place the staged hero carton.');
      app.scene3d.clubhouse().rebuildBoxes();
      return { id: box.id, orderId: box.orderId, skuId: box.skuId, qty: box.qty };
    }, { orderId: heroOrderId, qty: heroQty, spot: heroSpot });

    await page.waitForFunction((boxId) => {
      const root = window.__fw?.scene3d?.scene?.getObjectByName(`DeliveryBox_${boxId}`);
      return !!root?.getObjectByName('BOX_FLAP_FRONT') && !!root?.getObjectByName('CONTENT_SLOT_01');
    }, staged.id, { timeout: 30000 });
    return staged;
  }

  async function liveSnapshot(boxId) {
    return page.evaluate(async (id) => {
      const D = await import('/src/sim/deliveries.js');
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
          shelf: state.shop.inventory.polo1.shelf,
          back: state.shop.inventory.polo1.back,
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

  async function autosaveSnapshot(boxId) {
    return page.evaluate(async (id) => {
      const app = window.__fw;
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
      return {
        storageKey: 'golfempire:autosave',
        rawBytes: raw.length,
        activeId: empire.activeId,
        box: {
          id: box.id,
          orderId: box.orderId,
          skuId: box.skuId,
          box: box.box,
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
          shelf: state.shop.inventory.polo1.shelf,
          back: state.shop.inventory.polo1.back,
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
        if (wanted === 'mid-cut') return cut >= 0.40 && cut < 0.90;
        if (wanted === 'cut') return cut >= 0.999;
        return false;
      }, { id: boxId, wanted: condition }, { timeout });
    } finally {
      await page.keyboard.up('e').catch(() => {});
    }
    await page.waitForTimeout(100);
  }

  await firstBoot();
  const hero = await stageHero();
  await setCamera(cameras.box);

  const checkpoints = {};
  const screenshots = [];

  // CUTTING: deliberately release before the three-segment cut completes.
  await equipCutter();
  await holdEUntil(hero.id, 'mid-cut');
  checkpoints.cutting = { saved: await autosaveSnapshot(hero.id) };
  screenshots.push(await capture('01-cutting-before-reload.png'));
  await reloadAndContinue();
  checkpoints.cutting.reloaded = await liveSnapshot(hero.id);
  await setCamera(cameras.box);
  screenshots.push(await capture('02-cutting-after-reload.png'));

  // Finish the existing cut through the normal two-step equip, then hold route.
  await equipCutter();
  await holdEUntil(hero.id, 'cut');

  // OPENING: one tap starts the authored front/back/side flap sequence. Autosave
  // while it is in flight; the animation itself is intentionally not a fixture.
  await page.keyboard.press('e');
  await page.waitForFunction((id) => {
    const box = window.__fw?.state?.shop?.deliveries?.boxes?.find((candidate) => candidate.id === id);
    return !!box && box.lifecycle === 'OPENING'
      && box.openingProgress > 0.20 && box.openingProgress < 0.80
      && box.flapProgress.some((value) => value > 0 && value < 1);
  }, hero.id, { timeout: 5000 });
  checkpoints.opening = { saved: await autosaveSnapshot(hero.id) };
  screenshots.push(await capture('03-opening-before-reload.png'));
  await reloadAndContinue();
  checkpoints.opening.reloaded = await liveSnapshot(hero.id);
  await setCamera(cameras.box);
  screenshots.push(await capture('04-opening-after-reload.png'));

  // The one-shot animation is reconstructed by another normal E tap after load.
  await waitForFocus(/open the carton/i);
  await page.keyboard.press('e');
  await page.waitForFunction((id) => {
    const box = window.__fw?.state?.shop?.deliveries?.boxes?.find((candidate) => candidate.id === id);
    return !!box && box.flapProgress.length === 4 && box.flapProgress.every((value) => value >= 0.999);
  }, hero.id, { timeout: 5000 });

  // PARTIALLY_EMPTIED: take one real two-garment armful from 8 -> 6.
  await waitForFocus(/Club polo.*take an armful/i);
  await page.keyboard.press('e');
  await page.waitForFunction((id) => {
    const box = window.__fw?.state?.shop?.deliveries?.boxes?.find((candidate) => candidate.id === id);
    const carry = window.__fw?.state?.shop?.carry;
    return !!box && box.qty === 6 && box.lifecycle === 'PARTIALLY_EMPTIED'
      && carry?.skuId === 'polo1' && carry.qty === 2;
  }, hero.id, { timeout: 5000 });
  checkpoints.partiallyEmptied = { saved: await autosaveSnapshot(hero.id) };
  screenshots.push(await capture('05-partially-emptied-before-reload.png'));
  await reloadAndContinue();
  checkpoints.partiallyEmptied.reloaded = await liveSnapshot(hero.id);
  await setCamera(cameras.box);
  screenshots.push(await capture('06-partially-emptied-after-reload.png'));

  // Prove the recovered carry and carton remain playable: stock the recovered
  // armful, return to the same box, and take the next armful with normal controls.
  await setCamera(cameras.apparelTable);
  await waitForFocus(/Apparel tables.*hold \[E\] to stock/i);
  await page.keyboard.down('e');
  try {
    await page.waitForFunction(() => !window.__fw?.state?.shop?.carry, null, { timeout: 6000 });
  } finally {
    await page.keyboard.up('e').catch(() => {});
  }
  await page.waitForTimeout(650);
  await setCamera(cameras.box);
  await waitForFocus(/Club polo.*take an armful/i);
  await page.keyboard.press('e');
  await page.waitForFunction((id) => {
    const box = window.__fw?.state?.shop?.deliveries?.boxes?.find((candidate) => candidate.id === id);
    const carry = window.__fw?.state?.shop?.carry;
    return !!box && box.qty === 4 && carry?.skuId === 'polo1' && carry.qty === 2;
  }, hero.id, { timeout: 5000 });
  const resumed = await liveSnapshot(hero.id);
  screenshots.push(await capture('07-recovered-normal-controls-resumed.png'));

  const cuttingSaved = checkpoints.cutting.saved;
  const openingSaved = checkpoints.opening.saved;
  const partialSaved = checkpoints.partiallyEmptied.saved;
  const arrivedUnique = new Set(partialSaved.delivery.arrivedOrderIds).size === partialSaved.delivery.arrivedOrderIds.length;
  const partialConservation = partialSaved.box.qty
    + (partialSaved.carry?.qty || 0)
    + partialSaved.inventory.shelf
    + partialSaved.inventory.back;
  const resumedConservation = resumed.box.qty
    + (resumed.carry?.qty || 0)
    + resumed.inventory.shelf
    + resumed.inventory.back;

  const assertions = {
    cuttingPersisted:
      cuttingSaved.box.lifecycle === 'CUTTING'
      && cuttingSaved.box.cutProgress >= 0.35
      && cuttingSaved.box.cutProgress < 1
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
      && partialSaved.box.cap === heroQty
      && partialSaved.carry?.skuId === 'polo1'
      && partialSaved.carry.qty === 2,
    partialReloadExact: same(partialSaved.box, checkpoints.partiallyEmptied.reloaded.box)
      && same(partialSaved.carry, checkpoints.partiallyEmptied.reloaded.carry)
      && same(partialSaved.inventory, checkpoints.partiallyEmptied.reloaded.inventory)
      && same(partialSaved.delivery, checkpoints.partiallyEmptied.reloaded.delivery),
    sameBoxAndOrderAcrossAllReloads: [
      cuttingSaved,
      checkpoints.cutting.reloaded,
      openingSaved,
      checkpoints.opening.reloaded,
      partialSaved,
      checkpoints.partiallyEmptied.reloaded,
    ].every((snapshot) => snapshot.box.id === hero.id && snapshot.box.orderId === heroOrderId && snapshot.box.skuId === 'polo1'),
    singleShipmentAndArrivalIdentity:
      partialSaved.delivery.boxCount === 1
      && partialSaved.delivery.shipmentCount === 1
      && arrivedUnique
      && partialSaved.delivery.arrivedOrderIds.length === 1
      && partialSaved.delivery.arrivedOrderIds[0] === heroOrderId
      && partialSaved.delivery.shipments[0]?.orderId === heroOrderId
      && partialSaved.delivery.shipments[0]?.units === heroQty,
    partialUnitsConserved: partialConservation === heroQty,
    recoveredStateRemainsPlayable:
      resumed.box.qty === 4
      && resumed.box.lifecycle === 'PARTIALLY_EMPTIED'
      && resumed.inventory.shelf === 2
      && resumed.inventory.back === 0
      && resumed.carry?.skuId === 'polo1'
      && resumed.carry.qty === 2
      && resumedConservation === heroQty,
    ownAutosaveKeyUsed: [cuttingSaved, openingSaved, partialSaved]
      .every((snapshot) => snapshot.storageKey === 'golfempire:autosave' && snapshot.rawBytes > 0),
    noConsoleOrPageErrors: diagnosticCounts.consoleError === 0 && diagnosticCounts.pageError === 0,
    noFailedRequests: diagnosticCounts.requestFailed === 0,
  };

  const result = {
    ok: Object.values(assertions).every(Boolean),
    launch: 'node tools/qa/run-playwright.cjs tools/qa/hero-box-save-reload.js --bootstrap',
    viewport: { width: 1600, height: 900, deviceScaleFactor: 1 },
    fixedCameras: cameras,
    fixture: { orderId: heroOrderId, skuId: 'polo1', qty: heroQty, spot: heroSpot },
    savePath: 'window.__fw.autosave() -> localStorage["golfempire:autosave"] -> active empire holding state',
    checkpoints,
    resumed,
    conservation: { atPartialReload: partialConservation, afterNormalControlsResume: resumedConservation },
    screenshots,
    assertions,
    diagnostics: { counts: diagnosticCounts, entries: diagnostics },
    generatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(out, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}
