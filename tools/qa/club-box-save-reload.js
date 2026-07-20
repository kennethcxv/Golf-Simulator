async (page) => {
  // Durable Asset Sheet 05, reference-48 golf-club carton recovery probe.
  //
  // A documented fixture establishes one repeatable two-driver delivery. CUTTING
  // and OPENING are reached through the player-facing E-key route. The normal
  // take action intentionally fills the two-club armful, which would move a
  // two-unit carton directly from OPEN to EMPTY. To exercise the durable
  // PARTIALLY_EMPTIED state honestly, the checkpoint fixture calls the same
  // conserved simulation verb with `want = 1`; every action after that reload is
  // performed through normal controls at the real Drivers & woods rack and bin.

  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = path.resolve(process.env.QA_REPO_ROOT || process.cwd());
  const out = path.join(repo, 'qa', 'box_system_master', 'club_box_lifecycle', 'save_reload');
  fs.mkdirSync(out, { recursive: true });

  const fixtureOrderId = 960048;
  const fixtureQty = 2;
  const fixtureSpot = Object.freeze({ x: 8.25, z: -1.7, ry: 0 });
  const cameras = Object.freeze({
    box: { x: 8.25, z: -0.43, yaw: 0, pitch: -0.66 },
    clubRack: { x: -8.35, z: -3.2, yaw: Math.PI / 2, pitch: -0.12 },
    recycling: { x: 9.05, z: 1.3, yaw: -Math.PI / 2, pitch: -0.40 },
  });

  const partialCheckpointFixture = Object.freeze({
    method: 'takeFromBox(state, boxId, 1)',
    reason: 'The normal E action requests all available arm room (clubs = 2), so a two-unit carton otherwise transitions directly from OPEN to EMPTY.',
    conservation: 'The production simulation verb moves exactly one existing driver from the carton to carry; it does not inject stock.',
    recoveryRule: 'All actions after the PARTIALLY_EMPTIED reload use normal keyboard controls.',
  });

  const diagnostics = [];
  const diagnosticCounts = {
    consoleError: 0,
    consoleWarning: 0,
    pageError: 0,
    requestFailed: 0,
  };
  let expectedNavigation = true;
  const noteDiagnostic = (kind, value) => {
    diagnosticCounts[kind] += 1;
    if (diagnostics.length < 100) diagnostics.push({
      kind,
      text: String(value),
      at: new Date().toISOString(),
    });
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

  async function focusInfo() {
    return page.evaluate(() => ({
      label: window.__fw?.scene3d?.walk?.getFocusLabel?.() || null,
      tool: window.__fw?.scene3d?.walk?.getTool?.() || null,
    }));
  }

  async function waitForFocus(pattern, timeout = 7000) {
    await page.waitForFunction(({ source, flags }) => {
      const label = window.__fw?.scene3d?.walk?.getFocusLabel?.() || '';
      return new RegExp(source, flags).test(label);
    }, { source: pattern.source, flags: pattern.flags }, { timeout });
    return focusInfo();
  }

  async function stageClubBox() {
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
      state.shop.inventory.driver1.shelf = 0;
      state.shop.inventory.driver1.back = 0;
      if (state.notifications) {
        state.notifications.items = [];
        state.notifications.nextId = 1;
      }

      const manifest = {
        supplierId: 'pinehollow-club-supply-save-qa',
        supplier: 'Pinehollow Club Supply',
        boxes: [{
          kind: 'clubbox',
          qty,
          w: 1.25,
          h: 0.18,
          d: 0.18,
          lb: +(1.1 + qty * 0.8).toFixed(1),
          fragile: false,
        }],
        boxCount: 1,
        weight: +(1.1 + qty * 0.8).toFixed(1),
        fee: 9,
      };
      const [box] = D.arriveOrder(state, { id: orderId, skuId: 'driver1', qty, manifest });
      if (!box) throw new Error(`Could not stage club delivery order ${orderId}.`);
      if (!D.pickUpBox(state, box.id).ok) throw new Error('Could not pick up the staged club carton.');
      if (!D.putDownBox(state, box.id, spot).ok) throw new Error('Could not place the staged club carton.');
      app.scene3d.clubhouse().rebuildBoxes();
      return { id: box.id, orderId: box.orderId, skuId: box.skuId, qty: box.qty };
    }, { orderId: fixtureOrderId, qty: fixtureQty, spot: fixtureSpot });

    await page.waitForFunction((boxId) => {
      const root = window.__fw?.scene3d?.scene?.getObjectByName(`DeliveryBox_${boxId}`);
      return !!root?.getObjectByName('delivery_golf_club_box')
        && !!root?.getObjectByName('BOX_FLAP_FRONT')
        && !!root?.getObjectByName('CONTENT_SLOT_01')
        && !!root?.getObjectByName('CONTENT_SLOT_02')
        && !!root?.getObjectByName('BOX_CONTENT_01_driver1')
        && !!root?.getObjectByName('BOX_CONTENT_02_driver1');
    }, staged.id, { timeout: 30000 });
    return staged;
  }

  async function liveSnapshot(boxId) {
    return page.evaluate(async (id) => {
      const D = await import('/src/sim/deliveries.js');
      const B = await import('/src/data/boxes.js');
      const V = await import('/src/render3d/clubhouse/deliveryBoxVisual.js');
      const state = window.__fw.state;
      D.ensureDeliveries(state);
      const delivery = state.shop.deliveries;
      const box = delivery.boxes.find((candidate) => candidate.id === id);
      if (!box) throw new Error(`Live box ${id} is missing.`);
      return {
        box: {
          id: box.id,
          orderId: box.orderId,
          skuId: box.skuId,
          box: box.box,
          dimensions: B.boxDims(box.box),
          model: V.DELIVERY_MODEL_BY_BOX_KIND[box.box] || null,
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
        },
        carry: state.shop.carry ? { ...state.shop.carry } : null,
        inventory: {
          shelf: state.shop.inventory.driver1.shelf,
          back: state.shop.inventory.driver1.back,
        },
        delivery: {
          boxCount: delivery.boxes.length,
          shipmentCount: delivery.shipments.length,
          recycled: delivery.recycled || 0,
          trash: delivery.trash || 0,
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
      const authored = root?.getObjectByName('delivery_golf_club_box') || null;
      const names = [];
      root?.traverse((object) => { if (object.name) names.push(object.name); });
      const productObjects = [];
      root?.traverse((object) => {
        if (!/^BOX_CONTENT_\d{2}_driver1$/.test(object.name || '')) return;
        let visible = object.visible;
        for (let parent = object.parent; parent; parent = parent.parent) visible = visible && parent.visible;
        let meshCount = 0;
        let authoredAccentMeshCount = 0;
        object.traverse((child) => {
          if (!child.isMesh) return;
          meshCount += 1;
          if (child.userData?.slot === 'M_SKUAccent') authoredAccentMeshCount += 1;
        });
        const catalogVisual = object.userData?.catalogVisual || null;
        const requiredAuthoredDriverNodes = [
          'DriverHead', 'ClubShaft', 'ClubGrip', 'SkuAccentBand', 'ANCHOR_ProductBarcode',
        ];
        const missingAuthoredDriverNodes = requiredAuthoredDriverNodes
          .filter((name) => !object.getObjectByName(name));
        productObjects.push({
          name: object.name,
          visible,
          yaw: +object.rotation.y.toFixed(6),
          meshCount,
          authoredAccentMeshCount,
          catalogKind: catalogVisual?.kind || null,
          catalogModel: catalogVisual?.model || null,
          missingAuthoredDriverNodes,
          hasAuthoredDriver: catalogVisual?.kind === 'driver'
            && catalogVisual?.model === 'checkout_product_driver'
            && missingAuthoredDriverNodes.length === 0
            && authoredAccentMeshCount > 0,
        });
      });
      const requiredNodes = [
        'BOX_BASE',
        'BOX_WALL_FRONT', 'BOX_WALL_BACK', 'BOX_WALL_LEFT', 'BOX_WALL_RIGHT',
        'BOX_FLAP_FRONT', 'BOX_FLAP_BACK', 'BOX_FLAP_LEFT', 'BOX_FLAP_RIGHT',
        'FLAP_TOP_FRONT', 'FLAP_TOP_BACK', 'FLAP_TOP_LEFT', 'FLAP_TOP_RIGHT',
        'TAPE_CENTER',
        ...Array.from({ length: 12 }, (_, index) => `TAPE_CENTER_SEG_${String(index + 1).padStart(2, '0')}`),
        'TAPE_END_LEFT', 'TAPE_END_RIGHT',
        'LABEL_MAIN', 'LABEL_SHIPPING', 'LABEL_DYNAMIC',
        'INSERT_BOTTOM', 'INSERT_SIDE_FRONT', 'INSERT_SIDE_BACK',
        'END_PADDING_LEFT', 'END_PADDING_RIGHT',
        'SHAFT_SUPPORT_01', 'SHAFT_SUPPORT_02', 'HEAD_SUPPORT_01', 'HEAD_SUPPORT_02',
        'CONTENT_SLOT_01', 'CONTENT_SLOT_02',
        'COLLISION_CLOSED', 'COLLISION_OPEN',
        'INTERACTION_TARGET', 'CUT_PATH', 'VOLUME_CONTENTS',
        'BOX_FLAT_BUNDLE', 'FLAT_PANEL_BASE', 'FLAT_PANEL_FRONT',
        'FLAT_PANEL_BACK', 'FLAT_PANEL_LEFT', 'FLAT_PANEL_RIGHT', 'FLAT_LABEL',
      ];
      const dynamicLabel = root?.getObjectByName('LABEL_DYNAMIC');
      const dynamicMaterial = Array.isArray(dynamicLabel?.material)
        ? dynamicLabel.material[0]
        : dynamicLabel?.material;
      const mainLabel = root?.getObjectByName('LABEL_MAIN');
      return {
        deliveryRoot: root?.name || null,
        authoredRoot: authored?.name || null,
        assetId: authored?.userData?.asset_id || null,
        targetDimensionsM: authored?.userData?.target_dimensions_m || null,
        carryProfile: authored?.userData?.carry_profile || null,
        contentCapacity: authored?.userData?.content_capacity || null,
        missingRequiredNodes: requiredNodes.filter((name) => !root?.getObjectByName(name)),
        fourWalls: ['FRONT', 'BACK', 'LEFT', 'RIGHT'].every((side) => !!root?.getObjectByName(`BOX_WALL_${side}`)),
        fourFlaps: ['FRONT', 'BACK', 'LEFT', 'RIGHT'].every((side) => !!root?.getObjectByName(`BOX_FLAP_${side}`)),
        contentSlots: names.filter((name) => /^CONTENT_SLOT_\d{2}$/.test(name)).length,
        products: productObjects.length,
        productObjects,
        visibleProducts: productObjects.filter((product) => product.visible).length,
        productsParallel: productObjects.every((product) => Math.abs(product.yaw) <= 1e-5),
        actualCatalogProducts: productObjects.every((product) => product.hasAuthoredDriver),
        labelSourceSlot: mainLabel?.userData?.slot || null,
        dynamicLabelHasCanvasTexture: !!dynamicMaterial?.map?.isCanvasTexture,
        collisionsHidden: ['COLLISION_CLOSED', 'COLLISION_OPEN', 'VOLUME_CONTENTS']
          .every((name) => root?.getObjectByName(name)?.visible === false),
      };
    }, boxId);
  }

  async function autosaveSnapshot(boxId) {
    return page.evaluate(async (id) => {
      const app = window.__fw;
      const B = await import('/src/data/boxes.js');
      const V = await import('/src/render3d/clubhouse/deliveryBoxVisual.js');
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
      const rawSha256 = [...new Uint8Array(digest)]
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
      return {
        storageKey: 'golfempire:autosave',
        rawBytes: raw.length,
        rawSha256,
        rawContainsDriver1: raw.includes('"skuId":"driver1"'),
        rawContainsClubbox: raw.includes('"box":"clubbox"'),
        activeId: empire.activeId,
        box: {
          id: box.id,
          orderId: box.orderId,
          skuId: box.skuId,
          box: box.box,
          dimensions: B.boxDims(box.box),
          model: V.DELIVERY_MODEL_BY_BOX_KIND[box.box] || null,
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
          shelf: state.shop.inventory.driver1.shelf,
          back: state.shop.inventory.driver1.back,
        },
        delivery: {
          boxCount: delivery.boxes.length,
          shipmentCount: delivery.shipments.length,
          recycled: delivery.recycled || 0,
          trash: delivery.trash || 0,
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
  const screenshots = [];

  async function capture(fileName) {
    const file = path.join(out, fileName);
    await page.screenshot({ path: file });
    const context = await page.evaluate(() => ({
      pointerLocked: document.pointerLockElement === document.querySelector('canvas'),
      focus: window.__fw?.scene3d?.walk?.getFocusLabel?.() || null,
      tool: window.__fw?.scene3d?.walk?.getTool?.() || null,
    }));
    screenshots.push({ file, ...context });
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

  async function stockCurrentClub() {
    await setCamera(cameras.clubRack);
    await waitForFocus(/Drivers & woods.*hold \[E\] to stock/i);
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
    throw new Error('Could not focus the recycling drop after club-box save/load recovery.');
  }

  await firstBoot();
  const fixtureCase = await stageClubBox();
  await setCamera(cameras.box);
  const initialVisual = await visualSnapshot(fixtureCase.id);

  const checkpoints = {};

  // CUTTING: release while the persisted segmented-tape path is incomplete.
  await equipCutter();
  await holdEUntil(fixtureCase.id, 'mid-cut');
  checkpoints.cutting = { saved: await autosaveSnapshot(fixtureCase.id) };
  await capture('01-cutting-before-reload.png');
  await reloadAndContinue();
  checkpoints.cutting.reloaded = await liveSnapshot(fixtureCase.id);
  checkpoints.cutting.reloadedVisual = await visualSnapshot(fixtureCase.id);
  await setCamera(cameras.box);
  await capture('02-cutting-after-reload.png');

  await equipCutter();
  await holdEUntil(fixtureCase.id, 'cut');

  // OPENING: autosave while the independent authored flaps are in motion.
  await page.keyboard.press('e');
  await page.waitForFunction((id) => {
    const box = window.__fw?.state?.shop?.deliveries?.boxes?.find((candidate) => candidate.id === id);
    return !!box && box.lifecycle === 'OPENING'
      && box.openingProgress > 0.20 && box.openingProgress < 0.80
      && box.flapProgress.some((value) => value > 0 && value < 1);
  }, fixtureCase.id, { timeout: 5000 });
  checkpoints.opening = { saved: await autosaveSnapshot(fixtureCase.id) };
  await capture('03-opening-before-reload.png');
  await reloadAndContinue();
  checkpoints.opening.reloaded = await liveSnapshot(fixtureCase.id);
  checkpoints.opening.reloadedVisual = await visualSnapshot(fixtureCase.id);
  await setCamera(cameras.box);
  await capture('04-opening-after-reload.png');

  await waitForFocus(/open the carton/i);
  await page.keyboard.press('e');
  await page.waitForFunction((id) => {
    const box = window.__fw?.state?.shop?.deliveries?.boxes?.find((candidate) => candidate.id === id);
    return !!box && box.flapProgress.length === 4 && box.flapProgress.every((value) => value >= 0.999);
  }, fixtureCase.id, { timeout: 5000 });

  // PARTIALLY_EMPTIED: the player action has no one-unit modifier for clubs.
  // Establish the strongest honest partial fixture with the production conserved
  // verb, then prove its save and all subsequent gameplay through normal controls.
  const partialSetup = await page.evaluate(async (id) => {
    const D = await import('/src/sim/deliveries.js');
    const state = window.__fw.state;
    const before = D.findBox(state, id)?.qty ?? null;
    const result = D.takeFromBox(state, id, 1);
    window.__fw.scene3d.clubhouse().rebuildBoxes();
    const box = D.findBox(state, id);
    return {
      before,
      result,
      after: box?.qty ?? null,
      lifecycle: box?.lifecycle ?? null,
      carry: state.shop.carry ? { ...state.shop.carry } : null,
    };
  }, fixtureCase.id);
  await page.waitForFunction((id) => {
    const box = window.__fw?.state?.shop?.deliveries?.boxes?.find((candidate) => candidate.id === id);
    const carry = window.__fw?.state?.shop?.carry;
    return !!box && box.qty === 1 && box.lifecycle === 'PARTIALLY_EMPTIED'
      && carry?.skuId === 'driver1' && carry.qty === 1;
  }, fixtureCase.id, { timeout: 5000 });
  checkpoints.partiallyEmptied = {
    fixture: partialCheckpointFixture,
    setup: partialSetup,
    saved: await autosaveSnapshot(fixtureCase.id),
  };
  await capture('05-partially-emptied-before-reload.png');
  await reloadAndContinue();
  checkpoints.partiallyEmptied.reloaded = await liveSnapshot(fixtureCase.id);
  checkpoints.partiallyEmptied.reloadedVisual = await visualSnapshot(fixtureCase.id);
  await setCamera(cameras.box);
  await capture('06-partially-emptied-after-reload.png');

  // Normal-control recovery: stock the persisted one-driver carry, return for
  // the remaining driver, stock it, then flatten and recycle the same carton.
  await stockCurrentClub();
  const recoveredCarryStocked = await liveSnapshot(fixtureCase.id);
  await capture('07-recovered-driver-stocked.png');

  await setCamera(cameras.box);
  await waitForFocus(/Fairline driver.*take an armful/i);
  await page.keyboard.press('e');
  await page.waitForFunction((id) => {
    const box = window.__fw?.state?.shop?.deliveries?.boxes?.find((candidate) => candidate.id === id);
    const carry = window.__fw?.state?.shop?.carry;
    return !!box && box.qty === 0 && box.lifecycle === 'EMPTY'
      && carry?.skuId === 'driver1' && carry.qty === 1;
  }, fixtureCase.id, { timeout: 5000 });
  const remainingDriverTaken = await liveSnapshot(fixtureCase.id);
  await capture('08-remaining-driver-carried.png');

  await stockCurrentClub();
  const allDriversStocked = await liveSnapshot(fixtureCase.id);
  await capture('09-all-drivers-stocked.png');

  await setCamera(cameras.box);
  await waitForFocus(/Empty Fairline driver box.*flatten/i);
  await page.waitForTimeout(2200);
  await page.keyboard.press('e');
  await page.waitForFunction((id) => {
    const box = window.__fw?.state?.shop?.deliveries?.boxes?.find((candidate) => candidate.id === id);
    return !!box && box.flat && box.flattenProgress >= 0.999;
  }, fixtureCase.id, { timeout: 5000 });
  const flattened = await liveSnapshot(fixtureCase.id);
  await page.waitForTimeout(2500);
  await capture('10-flattened-after-recovery.png');

  await page.keyboard.press('e');
  await page.waitForFunction((id) => {
    const box = window.__fw?.state?.shop?.deliveries?.boxes?.find((candidate) => candidate.id === id);
    return box?.loc === 'carried';
  }, fixtureCase.id, { timeout: 5000 });
  const recyclingPose = await chooseRecyclingFocus();
  await capture('11-recycling-ready-after-recovery.png');
  await page.keyboard.press('e');
  await page.waitForFunction(
    (id) => !window.__fw?.state?.shop?.deliveries?.boxes?.some((box) => box.id === id),
    fixtureCase.id,
    { timeout: 5000 },
  );
  await page.waitForTimeout(1200);
  await capture('12-recycled-after-recovery.png');
  const completed = await page.evaluate((id) => ({
    shelf: window.__fw.state.shop.inventory.driver1.shelf,
    back: window.__fw.state.shop.inventory.driver1.back,
    carry: window.__fw.state.shop.carry ? { ...window.__fw.state.shop.carry } : null,
    liveBoxes: window.__fw.state.shop.deliveries.boxes.length,
    recycled: window.__fw.state.shop.deliveries.recycled || 0,
    trash: window.__fw.state.shop.deliveries.trash || 0,
    visualGone: !window.__fw.scene3d.scene.getObjectByName(`DeliveryBox_${id}`),
  }), fixtureCase.id);

  const cuttingSaved = checkpoints.cutting.saved;
  const openingSaved = checkpoints.opening.saved;
  const partialSaved = checkpoints.partiallyEmptied.saved;
  const allCheckpointSnapshots = [
    cuttingSaved,
    checkpoints.cutting.reloaded,
    openingSaved,
    checkpoints.opening.reloaded,
    partialSaved,
    checkpoints.partiallyEmptied.reloaded,
  ];
  const allVisuals = [
    initialVisual,
    checkpoints.cutting.reloadedVisual,
    checkpoints.opening.reloadedVisual,
    checkpoints.partiallyEmptied.reloadedVisual,
  ];
  const exactDimensions = (dimensions) => dimensions?.w === 1.25
    && dimensions?.h === 0.18
    && dimensions?.d === 0.18;
  const exactClubVisual = (visual) => visual?.deliveryRoot === `DeliveryBox_${fixtureCase.id}`
    && visual.authoredRoot === 'delivery_golf_club_box'
    && visual.assetId === 'delivery_golf_club_box'
    && same(visual.targetDimensionsM, [1.25, 0.18, 0.18])
    && visual.carryProfile === 'long_two_hand'
    && Number(visual.contentCapacity) === 2
    && visual.missingRequiredNodes.length === 0
    && visual.fourWalls && visual.fourFlaps
    && visual.contentSlots === 2
    && visual.products === 2
    && visual.productsParallel
    && visual.actualCatalogProducts
    && visual.labelSourceSlot === 'M_Label'
    && visual.dynamicLabelHasCanvasTexture
    && visual.collisionsHidden;
  const conservation = (snapshot) => snapshot.box.qty
    + (snapshot.carry?.qty || 0)
    + snapshot.inventory.shelf
    + snapshot.inventory.back;
  const conservedSnapshots = [
    partialSaved,
    checkpoints.partiallyEmptied.reloaded,
    recoveredCarryStocked,
    remainingDriverTaken,
    allDriversStocked,
    flattened,
  ];
  const arrivedUnique = new Set(partialSaved.delivery.arrivedOrderIds).size
    === partialSaved.delivery.arrivedOrderIds.length;

  const assertions = {
    cuttingPersisted: cuttingSaved.box.lifecycle === 'CUTTING'
      && cuttingSaved.box.cutProgress >= 0.35
      && cuttingSaved.box.cutProgress <= 0.70
      && cuttingSaved.box.cutProgress === cuttingSaved.box.tape,
    cuttingReloadExact: same(cuttingSaved.box, checkpoints.cutting.reloaded.box)
      && same(cuttingSaved.carry, checkpoints.cutting.reloaded.carry)
      && same(cuttingSaved.inventory, checkpoints.cutting.reloaded.inventory)
      && same(cuttingSaved.delivery, checkpoints.cutting.reloaded.delivery),
    openingPersisted: openingSaved.box.lifecycle === 'OPENING'
      && openingSaved.box.openingProgress > 0.20
      && openingSaved.box.openingProgress < 0.80
      && openingSaved.box.flapProgress.some((value) => value > 0 && value < 1),
    openingReloadExact: same(openingSaved.box, checkpoints.opening.reloaded.box)
      && same(openingSaved.carry, checkpoints.opening.reloaded.carry)
      && same(openingSaved.inventory, checkpoints.opening.reloaded.inventory)
      && same(openingSaved.delivery, checkpoints.opening.reloaded.delivery),
    strongestHonestPartialFixtureDocumented: checkpoints.partiallyEmptied.fixture.method
      === 'takeFromBox(state, boxId, 1)'
      && partialSetup.before === 2
      && partialSetup.result?.ok
      && partialSetup.result.taken === 1
      && partialSetup.result.left === 1
      && partialSetup.after === 1
      && partialSetup.lifecycle === 'PARTIALLY_EMPTIED'
      && partialSetup.carry?.skuId === 'driver1'
      && partialSetup.carry.qty === 1,
    partialPersisted: partialSaved.box.lifecycle === 'PARTIALLY_EMPTIED'
      && partialSaved.box.qty === 1
      && partialSaved.box.cap === fixtureQty
      && partialSaved.carry?.skuId === 'driver1'
      && partialSaved.carry.qty === 1,
    partialReloadExact: same(partialSaved.box, checkpoints.partiallyEmptied.reloaded.box)
      && same(partialSaved.carry, checkpoints.partiallyEmptied.reloaded.carry)
      && same(partialSaved.inventory, checkpoints.partiallyEmptied.reloaded.inventory)
      && same(partialSaved.delivery, checkpoints.partiallyEmptied.reloaded.delivery),
    clubKindDimensionsAndModelPersisted: allCheckpointSnapshots.every((snapshot) => snapshot.box.box === 'clubbox'
      && exactDimensions(snapshot.box.dimensions)
      && snapshot.box.model === 'delivery_golf_club_box'
      && snapshot.box.cap === fixtureQty
      && snapshot.box.initialQty === fixtureQty),
    authoredClubVisualReconstructed: allVisuals.every(exactClubVisual)
      && initialVisual.visibleProducts === 0
      && checkpoints.cutting.reloadedVisual.visibleProducts === 0
      && checkpoints.opening.reloadedVisual.visibleProducts === 2
      && checkpoints.partiallyEmptied.reloadedVisual.visibleProducts === 1,
    sameBoxAndOrderAcrossReloads: allCheckpointSnapshots.every((snapshot) => snapshot.box.id === fixtureCase.id
      && snapshot.box.orderId === fixtureOrderId
      && snapshot.box.skuId === 'driver1'),
    singleShipmentAndArrivalIdentity: partialSaved.delivery.boxCount === 1
      && partialSaved.delivery.shipmentCount === 1
      && arrivedUnique
      && partialSaved.delivery.arrivedOrderIds.length === 1
      && partialSaved.delivery.arrivedOrderIds[0] === fixtureOrderId
      && partialSaved.delivery.shipments[0]?.orderId === fixtureOrderId
      && partialSaved.delivery.shipments[0]?.skuId === 'driver1'
      && partialSaved.delivery.shipments[0]?.units === fixtureQty,
    unitsConservedAcrossPartialAndResume: conservedSnapshots.every((snapshot) => conservation(snapshot) === fixtureQty),
    recoveredCarryStockedWithNormalControls: recoveredCarryStocked.box.qty === 1
      && recoveredCarryStocked.inventory.shelf === 1
      && recoveredCarryStocked.inventory.back === 0
      && !recoveredCarryStocked.carry,
    remainingDriverTakenWithNormalControls: remainingDriverTaken.box.qty === 0
      && remainingDriverTaken.box.lifecycle === 'EMPTY'
      && remainingDriverTaken.carry?.skuId === 'driver1'
      && remainingDriverTaken.carry.qty === 1
      && remainingDriverTaken.inventory.shelf === 1,
    bothDriversStockedAtCorrectFixture: allDriversStocked.box.qty === 0
      && allDriversStocked.inventory.shelf === fixtureQty
      && allDriversStocked.inventory.back === 0
      && !allDriversStocked.carry,
    sameRecoveredBoxFlattened: flattened.box.id === fixtureCase.id
      && flattened.box.box === 'clubbox'
      && flattened.box.qty === 0
      && flattened.box.flat
      && flattened.box.flattenProgress >= 0.999
      && flattened.inventory.shelf === fixtureQty,
    recycledExactlyOnce: completed.shelf === fixtureQty
      && completed.back === 0
      && !completed.carry
      && completed.liveBoxes === 0
      && completed.recycled === 1
      && completed.trash === 0
      && completed.visualGone,
    ownAutosaveKeyUsed: [cuttingSaved, openingSaved, partialSaved]
      .every((snapshot) => snapshot.storageKey === 'golfempire:autosave'
        && snapshot.rawBytes > 0
        && snapshot.rawSha256.length === 64
        && snapshot.rawContainsDriver1
        && snapshot.rawContainsClubbox),
    pointerLockHeldForEvidence: screenshots.every((entry) => entry.pointerLocked),
    zeroConsoleOrPageErrors: diagnosticCounts.consoleError === 0 && diagnosticCounts.pageError === 0,
    zeroFailedRequests: diagnosticCounts.requestFailed === 0,
  };

  const result = {
    ok: Object.values(assertions).every(Boolean),
    launch: 'node tools/qa/run-playwright.cjs tools/qa/club-box-save-reload.js --bootstrap',
    viewport: { width: 1600, height: 900, deviceScaleFactor: 1 },
    fixedCameras: cameras,
    fixture: {
      orderId: fixtureOrderId,
      skuId: 'driver1',
      qty: fixtureQty,
      boxKind: 'clubbox',
      dimensions: { w: 1.25, h: 0.18, d: 0.18 },
      model: 'delivery_golf_club_box',
      spot: fixtureSpot,
    },
    partialCheckpointFixture,
    savePath: 'window.__fw.autosave() -> localStorage["golfempire:autosave"] -> active empire holding state',
    checkpoints,
    initialVisual,
    recoveredCarryStocked,
    remainingDriverTaken,
    allDriversStocked,
    flattened,
    completed,
    recyclingPose,
    conservation: conservedSnapshots.map((snapshot) => conservation(snapshot)),
    screenshots,
    assertions,
    diagnostics: { counts: diagnosticCounts, entries: diagnostics },
    generatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(out, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}
