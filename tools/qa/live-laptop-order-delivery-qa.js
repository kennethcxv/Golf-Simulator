async (page) => {
  // Live supplier-order acceptance through the current diegetic laptop.
  //
  // The documented --bootstrap fixture supplies an isolated empire/property. From there the
  // player route is real input: E opens the laptop, mouse clicks drive Shop -> Order, the basket
  // and confirmation, Escape returns to walking, and keyboard 3 advances the running game across
  // the scheduled delivery minute. The only time shortcut is a deterministic fixture that parks
  // the clock 0.75 game-minute before the order's own deliveryMin; this harness never invokes
  // placeOrder(), tickDeliveries(), arriveOrder(), or rebuildBoxes() itself.

  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = 'C:/Users/Kenneth/Documents/GitHub/Golf-Flipper';
  const out = path.join(repo, 'qa', 'box_system_master', 'delivery', 'live-order-flow');
  fs.mkdirSync(out, { recursive: true });

  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const viewport = Object.freeze({ width: 1600, height: 900 });
  const fixture = Object.freeze({
    skuId: 'polo1',
    productName: 'Club polo',
    quantity: 16,
    cash: 5000,
    unlockedTier: 3,
    startHour: 9,
    arrivalLeadMinutes: 0.75,
  });
  // Independent acceptance contract. These values come from the signed-off
  // business/packaging brief, not from the production functions used below as
  // a second cross-check: 16 polos at $16, eight per apparel carton, Sunday
  // Round Apparel freight at $12 + $4 per carton.
  const contract = Object.freeze({
    startingCash: 5000,
    skuId: 'polo1',
    productName: 'Club polo',
    quantity: 16,
    unitCost: 16,
    unitsPerBox: 8,
    boxCount: 2,
    supplierId: 'sunday',
    supplier: 'Sunday Round Apparel',
    freightBase: 12,
    freightPerBox: 4,
    goods: 256,
    freight: 20,
    total: 276,
    finalCash: 4724,
    labelHeader: 'PINEHOLLOW / APPAREL',
    labelWeightLb: 5,
    labelHandling: 'PRO SHOP STOCK',
  });

  const diagnosticCounts = {
    consoleError: 0,
    consoleWarning: 0,
    pageError: 0,
    requestFailed: 0,
  };
  const diagnostics = [];
  let expectedNavigation = true;
  const noteDiagnostic = (kind, value) => {
    diagnosticCounts[kind] += 1;
    if (diagnostics.length < 160) diagnostics.push({
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
    // Only the expected top-level document replacement may abort. An aborted
    // asset/module request during that window remains a real failure.
    if (expectedNavigation
      && request.isNavigationRequest()
      && request.frame() === page.mainFrame()
      && /ERR_ABORTED/i.test(failure)) return;
    noteDiagnostic('requestFailed', `${request.url()} (${failure})`);
  });
  page.on('response', (response) => {
    if (response.status() >= 400) {
      noteDiagnostic('requestFailed', `${response.url()} (HTTP ${response.status()})`);
    }
  });

  const evidence = {
    launch: 'VIDEO_DIR=qa/box_system_master/delivery/live-order-flow/video node tools/qa/run-playwright.cjs tools/qa/live-laptop-order-delivery-qa.js --bootstrap',
    outputDirectory: out,
    viewport,
    fixture,
    independentContract: contract,
    fixtureBoundary: [
      'The --bootstrap runner creates an ephemeral browser context and a deterministic owned property.',
      'The harness sets only cash, supplier tier, quiet presentation state, fixed player cameras, weather/time of day, and the pre-arrival clock edge.',
      'Order creation, billing, shipment creation, delivery arrival, van presentation, unloading, and box staging remain production-owned.',
    ],
    screenshots: [],
    inputActions: [],
  };
  let storageBaseline = null;
  let storageIsolation = null;
  let actionError = null;
  const arrivalMediaOut = path.join(out, 'delivery-arrival-with-audio.webm');
  let arrivalCaptureActive = false;

  const requireTruth = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  const roundMoney = (value) => Math.round(Number(value) * 100) / 100;
  const moneyValues = (text) => [...String(text || '').matchAll(/\$([\d,]+(?:\.\d{1,2})?)/g)]
    .map((match) => Number(match[1].replaceAll(',', '')));
  const storageSnapshot = () => page.evaluate(() => ({
    local: Object.fromEntries(Array.from({ length: localStorage.length }, (_, index) => {
      const key = localStorage.key(index);
      return [key, localStorage.getItem(key)];
    })),
    session: Object.fromEntries(Array.from({ length: sessionStorage.length }, (_, index) => {
      const key = sessionStorage.key(index);
      return [key, sessionStorage.getItem(key)];
    })),
  }));
  const sameRecord = (left, right) => JSON.stringify(left) === JSON.stringify(right);
  const authorityBytes = (snapshot) => Buffer.from(JSON.stringify(snapshot), 'utf8');
  const byteIdentical = (left, right) => authorityBytes(left).equals(authorityBytes(right));

  async function orderAuthoritySnapshot(skuId) {
    return page.evaluate((requestedSkuId) => {
      const app = window.__fw;
      const state = app.state;
      const deliveries = state.shop.deliveries;
      return {
        stateCash: state.cash,
        empireCash: app.empire.cash,
        orderCount: state.shop.orders.length,
        orderIds: state.shop.orders.map((order) => order.id),
        ordersAuthority: structuredClone(state.shop.orders),
        nextOrderId: state.shop.nextOrderId,
        boxCount: deliveries.boxes.length,
        boxesAuthority: structuredClone(deliveries.boxes),
        nextBoxId: deliveries.nextBoxId,
        shipmentCount: deliveries.shipments.length,
        shipmentsAuthority: structuredClone(deliveries.shipments),
        arrivedOrderIds: [...deliveries.arrivedOrderIds],
        txCount: state.ledger.txLog.length,
        txLog: structuredClone(state.ledger.txLog),
        ledgerToday: structuredClone(state.ledger.today),
        shopOrderExpense: state.ledger.today.expense.shopOrders,
        inventory: structuredClone(state.shop.inventory[requestedSkuId]),
        inventoryAuthority: structuredClone(state.shop.inventory),
      };
    }, skuId);
  }

  async function clickCenter(locator, label) {
    await locator.waitFor({ state: 'visible', timeout: 15000 });
    const count = await locator.count();
    requireTruth(count === 1, `${label}: expected one current UI target, found ${count}`);
    await locator.scrollIntoViewIfNeeded();
    const box = await locator.boundingBox();
    requireTruth(box && box.width > 2 && box.height > 2, `${label}: target has no clickable bounds`);
    const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await page.mouse.move(point.x, point.y, { steps: 4 });
    await page.mouse.down();
    await page.mouse.up();
    evidence.inputActions.push({ type: 'trusted-mouse-click', label, point });
  }

  async function pressKey(key, label = key) {
    await page.keyboard.press(key);
    evidence.inputActions.push({ type: 'trusted-key-press', key, label });
  }

  async function capture(file, description, extra = {}) {
    const target = path.join(out, file);
    await page.screenshot({ path: target });
    const entry = { file: target, description, ...extra };
    evidence.screenshots.push(entry);
    return entry;
  }

  async function startArrivalMediaCapture() {
    const started = await page.evaluate(async () => {
      const audio = window.__fw?.audio;
      if (!audio || typeof audio.startCapture !== 'function' || typeof audio.truck !== 'function') {
        throw new Error('The production delivery audio/capture API is unavailable.');
      }
      if (!window.__liveOrderQaOriginalTruck) {
        const originalTruck = audio.truck;
        window.__liveOrderQaOriginalTruck = originalTruck;
        window.__liveOrderQaTruckCueTrace = [];
        audio.truck = (...args) => {
          window.__liveOrderQaTruckCueTrace.push({ name: 'truck', atMs: performance.now() });
          return originalTruck(...args);
        };
      }
      audio.setMuted(false);
      audio.setVolume(0.8);
      const captureState = await audio.startCapture(document.getElementById('game'), { fps: 30 });
      if (captureState.audioTracks < 1 || captureState.videoTracks < 1
        || captureState.audioContextState !== 'running') {
        throw new Error(`Arrival capture did not start with live audio/video: ${JSON.stringify(captureState)}.`);
      }
      return captureState;
    });
    arrivalCaptureActive = true;
    return started;
  }

  async function stopArrivalMediaCapture(started) {
    const downloadName = path.basename(arrivalMediaOut);
    const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
    const stopPromise = page.evaluate((name) => (
      window.__fw.audio.stopCapture({ downloadName: name })
    ), downloadName);
    try {
      const [download, stopped] = await Promise.all([downloadPromise, stopPromise]);
      const failure = await download.failure();
      if (failure) throw new Error(`Arrival media download failed: ${failure}.`);
      await download.saveAs(arrivalMediaOut);
      const cueTrace = await page.evaluate(() => (
        JSON.parse(JSON.stringify(window.__liveOrderQaTruckCueTrace || []))
      ));
      return {
        output: arrivalMediaOut,
        bytesOnDisk: fs.statSync(arrivalMediaOut).size,
        cueTrace,
        ...started,
        ...stopped,
      };
    } finally {
      arrivalCaptureActive = false;
    }
  }

  async function waitForGame() {
    const continueButton = page.getByRole('button', { name: 'Continue', exact: true });
    await continueButton.waitFor({ state: 'visible', timeout: 30000 });
    requireTruth(await continueButton.isEnabled(), 'Continue is present but disabled; --bootstrap fixture is required');
    await clickCenter(continueButton, 'Continue');
    await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
    await page.waitForFunction(() => {
      const veil = document.querySelector('.load-veil');
      return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
    }, null, { timeout: 90000 });
    await page.waitForFunction(() => {
      const clubhouse = window.__fw?.scene3d?.clubhouse?.();
      return !!clubhouse
        && (typeof clubhouse.assetsReady !== 'function' || clubhouse.assetsReady())
        && (typeof clubhouse.deliveryEquipmentReady !== 'function'
          || clubhouse.deliveryEquipmentReady());
    }, null, { timeout: 90000 });
    await page.waitForFunction(() => {
      const stage = window.__fw?.scene3d?.scene?.getObjectByName('DeliveryPalletStage');
      return stage?.userData?.ready === true
        && Array.from({ length: 5 }, (_, index) => (
          stage.getObjectByName(`DeliveryPallet_${index + 1}`)
        )).every(Boolean);
    }, null, { timeout: 90000 });
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(650);
    expectedNavigation = false;
  }

  async function acquirePointerLock() {
    const canvas = page.locator('canvas').first();
    await canvas.waitFor({ state: 'visible', timeout: 30000 });
    await page.bringToFront();
    if (await page.evaluate(() => document.pointerLockElement === document.querySelector('canvas'))) return;
    await clickCenter(canvas, 'world canvas / acquire look control');
    await page.waitForFunction(
      () => document.pointerLockElement === document.querySelector('canvas'),
      null,
      { timeout: 7000 },
    );
  }

  async function setPlayerCamera(camera) {
    await page.evaluate((pose) => {
      const walk = window.__fw.scene3d.walk.state;
      walk.x = pose.x;
      walk.z = pose.z;
      walk.yaw = pose.yaw;
      walk.pitch = pose.pitch;
      window.__fw.scene3d.walk.clearKeys?.();
    }, camera);
    await page.waitForTimeout(500);
  }

  async function deriveDeliveryCameras() {
    return page.evaluate(async () => {
      const { DELIVERY_PALLET_STAGING } = await import('/src/data/deliveryStaging.js');
      const app = window.__fw;
      const scene = app.scene3d.scene;
      const clubhouse = app.scene3d.clubhouse();
      const origin = clubhouse.interior.position;
      const slab = scene.getObjectByName('DeliveryReceivingSlab');
      const van = scene.getObjectByName('DeliveryEquipmentRoot_delivery_van');
      if (!slab || !van) throw new Error('Authored receiving slab or delivery van root is unavailable');
      slab.updateWorldMatrix(true, true);
      van.updateWorldMatrix(true, true);
      const slabWorld = slab.getWorldPosition(slab.position.clone());
      const vanParkWorld = van.getWorldPosition(van.position.clone());
      const yaw = 0.83;
      const distance = Math.max(
        4.60,
        Math.hypot(
          DELIVERY_PALLET_STAGING.receivingApron.length,
          DELIVERY_PALLET_STAGING.receivingApron.width,
        ) * 0.90,
      );
      const staging = {
        x: slabWorld.x + Math.sin(yaw) * distance,
        z: slabWorld.z + Math.cos(yaw) * distance,
        yaw,
        pitch: -0.30,
      };
      const targetX = (slabWorld.x + vanParkWorld.x) / 2;
      const targetZ = (slabWorld.z + vanParkWorld.z) / 2;
      const arrival = {
        x: targetX - 3.2,
        z: targetZ + 5.4,
        yaw: Math.atan2(-(targetX - (targetX - 3.2)), -(targetZ - (targetZ + 5.4))),
        pitch: -0.12,
      };
      return {
        staging,
        arrival,
        authored: {
          slabWorld: { x: slabWorld.x, y: slabWorld.y, z: slabWorld.z },
          vanParkWorld: { x: vanParkWorld.x, y: vanParkWorld.y, z: vanParkWorld.z },
          interiorOrigin: { x: origin.x, y: origin.y, z: origin.z },
          receivingApron: { ...DELIVERY_PALLET_STAGING.receivingApron },
        },
      };
    });
  }

  async function deliveryFraming() {
    return page.evaluate(() => {
      const app = window.__fw;
      const scene = app.scene3d.scene;
      const camera = app.scene3d.camera;
      camera.updateWorldMatrix(true, false);
      camera.updateProjectionMatrix();
      return Array.from({ length: 5 }, (_, index) => {
        const anchor = scene.getObjectByName(`DeliveryPallet_${index + 1}`);
        if (!anchor) return { name: `DeliveryPallet_${index + 1}`, exists: false };
        anchor.updateWorldMatrix(true, false);
        const world = anchor.getWorldPosition(anchor.position.clone());
        const ndc = world.clone().project(camera);
        return {
          name: anchor.name,
          exists: true,
          world: { x: world.x, y: world.y, z: world.z },
          ndc: { x: ndc.x, y: ndc.y, z: ndc.z },
          inFrame: Math.abs(ndc.x) <= 0.94 && Math.abs(ndc.y) <= 0.94
            && ndc.z >= -1 && ndc.z <= 1,
        };
      });
    });
  }

  async function seatAtLaptop() {
    await page.evaluate(() => {
      const app = window.__fw;
      const origin = app.scene3d.clubhouse().interior.position;
      const walk = app.scene3d.walk.state;
      walk.x = 8.45 + origin.x;
      walk.z = 4.5 + origin.z;
      walk.yaw = -Math.PI / 2;
      walk.pitch = -0.05;
      app.scene3d.walk.clearKeys?.();
    });
    await page.waitForFunction(() => {
      const prompt = document.querySelector('.shop-prompt');
      return !!prompt && /Laptop.*\[E\].*GOLF SIMULATOR/i.test(prompt.textContent || '');
    }, null, { timeout: 10000 });
    await pressKey('e', 'open physical laptop');
    await page.waitForFunction(() => window.__fw.laptopOpen === true, null, { timeout: 8000 });
    await page.waitForFunction(() => {
      const frame = document.querySelector('.lt-frame');
      const screen = document.querySelector('.laptop-screen');
      if (!frame || !screen || screen.style.display === 'none') return false;
      const box = frame.getBoundingClientRect();
      const previous = window.__liveOrderLaptopSettle || {};
      window.__liveOrderLaptopSettle = { x: box.left, width: box.width };
      return box.width > 100
        && Math.abs((previous.x ?? 0) - box.left) < 0.05
        && Math.abs((previous.width ?? 0) - box.width) < 0.05;
    }, null, { timeout: 15000, polling: 120 });
    await page.waitForTimeout(250);
  }

  try {
    fs.writeFileSync(path.join(out, 'run-state.json'), `${JSON.stringify({
      status: 'running',
      updatedAt: new Date().toISOString(),
      harness: 'tools/qa/live-laptop-order-delivery-qa.js',
    }, null, 2)}\n`);

    await page.setViewportSize(viewport);
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    storageBaseline = await storageSnapshot();
    await waitForGame();
    await acquirePointerLock();

    const fixtureState = await page.evaluate((requested) => {
      const app = window.__fw;
      const state = app.state;
      const delivery = state.shop?.deliveries;
      const before = {
        orders: state.shop?.orders?.length ?? -1,
        boxes: delivery?.boxes?.length ?? -1,
        shipments: delivery?.shipments?.length ?? -1,
        carry: state.shop?.carry ?? null,
      };
      app.speedIdx = 0;
      app.empire.cash = requested.cash;
      state.cash = requested.cash;
      state.shop.unlockedTier = requested.unlockedTier;
      const dayStart = Math.floor(state.clock.minutes / 1440) * 1440;
      state.clock.minutes = dayStart + requested.startHour * 60;
      app.empire.clockMinutes = state.clock.minutes;
      if (state.weather) state.weather.locked = true;
      app.scene3d.applyTimeWeather?.(requested.startHour * 60, state.weather);
      const clubhouse = app.scene3d.clubhouse();
      clubhouse.setOrganicWalkins?.(false);
      clubhouse.clearWalkins?.();
      app.scene3d.walk.clearKeys?.();
      return {
        before,
        after: {
          cash: state.cash,
          empireCash: app.empire.cash,
          clockMinutes: state.clock.minutes,
          unlockedTier: state.shop.unlockedTier,
          speedIdx: app.speedIdx,
        },
      };
    }, fixture);
    requireTruth(fixtureState.before.orders === 0, `isolated bootstrap has ${fixtureState.before.orders} pre-existing orders`);
    requireTruth(fixtureState.before.boxes === 0, `isolated bootstrap has ${fixtureState.before.boxes} pre-existing boxes`);
    requireTruth(fixtureState.before.shipments === 0, `isolated bootstrap has ${fixtureState.before.shipments} pre-existing shipments`);
    requireTruth(fixtureState.before.carry == null, 'isolated bootstrap begins with a carried delivery object');
    requireTruth(fixtureState.after.cash === fixture.cash
      && fixtureState.after.empireCash === fixture.cash, 'cash fixture did not synchronize the empire wallet');
    requireTruth(contract.goods === contract.quantity * contract.unitCost
      && contract.freight === contract.freightBase + contract.freightPerBox * contract.boxCount
      && contract.total === contract.goods + contract.freight
      && contract.finalCash === contract.startingCash - contract.total,
    `independent acceptance arithmetic is internally inconsistent: ${JSON.stringify(contract)}`);
    evidence.fixtureState = fixtureState;

    await page.evaluate(() => {
      const trace = [];
      const push = (event) => {
        const button = event.target?.closest?.('button');
        trace.push({
          type: event.type,
          key: event.key || null,
          code: event.code || null,
          button: Number.isFinite(event.button) ? event.button : null,
          trusted: event.isTrusted,
          target: button ? String(button.textContent || '').trim().replace(/\s+/g, ' ') : null,
          targetClass: button?.className || event.target?.className || null,
          at: performance.now(),
        });
        if (trace.length > 200) trace.shift();
      };
      window.__liveOrderQaTrace = trace;
      window.__liveOrderQaTraceHandler = push;
      window.addEventListener('keydown', push, true);
      window.addEventListener('pointerdown', push, true);
      const contextPrototype = window.CanvasRenderingContext2D?.prototype;
      if (contextPrototype && !window.__liveOrderQaOriginalFillText) {
        const originalFillText = contextPrototype.fillText;
        const originalClearRect = contextPrototype.clearRect;
        window.__liveOrderQaOriginalFillText = originalFillText;
        window.__liveOrderQaOriginalClearRect = originalClearRect;
        window.__liveOrderQaTracedCanvases = new Set();
        contextPrototype.clearRect = function liveOrderQaObservedClearRect(...args) {
          const canvas = this?.canvas;
          if (canvas) {
            canvas.__liveOrderQaCurrentText = [];
            window.__liveOrderQaTracedCanvases.add(canvas);
          }
          return originalClearRect.apply(this, args);
        };
        contextPrototype.fillText = function liveOrderQaObservedFillText(value, ...args) {
          const text = String(value || '');
          const canvas = this?.canvas;
          if (canvas) {
            if (!Array.isArray(canvas.__liveOrderQaCurrentText)) {
              canvas.__liveOrderQaCurrentText = [];
            }
            canvas.__liveOrderQaCurrentText.push({
              text,
              x: Number(args[0]),
              y: Number(args[1]),
              at: performance.now(),
            });
            if (canvas.__liveOrderQaCurrentText.length > 80) {
              canvas.__liveOrderQaCurrentText.shift();
            }
            window.__liveOrderQaTracedCanvases.add(canvas);
          }
          return originalFillText.call(this, value, ...args);
        };
      }
    });

    const cameras = await deriveDeliveryCameras();
    evidence.fixedPlayerCameras = cameras;
    await setPlayerCamera(cameras.staging);
    const baselineFraming = await deliveryFraming();
    requireTruth(baselineFraming.every((entry) => entry.exists && entry.inFrame),
      `empty receiving baseline does not frame all five pallets: ${JSON.stringify(baselineFraming)}`);
    await capture(
      'baseline-delivery-area-empty-before-order.png',
      'Isolated authored five-pallet receiving area before the laptop order.',
      { palletFraming: baselineFraming },
    );

    await seatAtLaptop();
    const currentUiContract = await page.evaluate(() => ({
      nav: [...document.querySelectorAll('.lt-navbtn')].map((button) => button.textContent.trim()),
      heading: document.querySelector('.lt-h1')?.textContent?.trim() || null,
    }));
    const expectedCurrentNav = [
      'Home', 'Tee Times', 'Shop', 'Course', 'Upgrades', 'Finances', 'Settings', 'Close Laptop',
    ];
    requireTruth(JSON.stringify(currentUiContract.nav) === JSON.stringify(expectedCurrentNav),
      `laptop navigation changed; refusing obsolete selectors: ${JSON.stringify(currentUiContract.nav)}`);
    requireTruth(!currentUiContract.nav.includes('Supplier')
      && !currentUiContract.nav.includes('Orders')
      && !currentUiContract.nav.includes('Deliveries'),
    'retired laptop navigation unexpectedly returned; current Shop-tab harness is no longer authoritative');

    const shopNav = page.locator('.lt-navbtn').filter({ hasText: /^Shop$/ });
    await clickCenter(shopNav, 'current laptop navigation: Shop');
    await page.waitForFunction(() => document.querySelector('.lt-h1')?.textContent?.trim() === 'Shop');
    const shopTabLabels = await page.locator('.lt-tabs-big .lt-tab').allTextContents();
    requireTruth(JSON.stringify(shopTabLabels.map((label) => label.trim()))
      === JSON.stringify(['Stock', 'Order', 'Pricing', 'Deliveries']),
    `current Shop tabs changed: ${JSON.stringify(shopTabLabels)}`);
    const orderTab = page.locator('.lt-tabs-big .lt-tab').filter({ hasText: /^Order$/ });
    await clickCenter(orderTab, 'current Shop tab: Order');
    await page.waitForFunction(() => document.querySelector('.lt-tabs-big .lt-tab.on')?.textContent?.trim() === 'Order');
    evidence.currentUiContract = {
      ...currentUiContract,
      shopTabs: shopTabLabels.map((label) => label.trim()),
      route: 'Shop -> Order -> automatic Deliveries tab',
      retiredSelectorsUsed: [],
    };

    const productCard = page.locator('.lt-product').filter({
      has: page.locator('.lt-prodname').filter({ hasText: /^Club polo$/ }),
    });
    requireTruth(await productCard.count() === 1, 'current Order grid does not expose exactly one Club polo product card');
    const plus = productCard.locator('.lt-qbtn').filter({ hasText: /^\+$/ });
    for (let quantity = 1; quantity <= fixture.quantity; quantity += 1) {
      await clickCenter(plus, `Club polo quantity + (${quantity}/${fixture.quantity})`);
      await productCard.locator('.lt-qty').filter({ hasText: new RegExp(`^${quantity}$`) })
        .waitFor({ state: 'visible', timeout: 3000 });
    }

    const expectedQuote = await page.evaluate(async (requested) => {
      const { skuById } = await import('/src/data/shopItems.js');
      const { planShipment } = await import('/src/data/boxes.js');
      const { orderCost } = await import('/src/sim/shop.js');
      const sku = skuById(requested.skuId);
      if (!sku) throw new Error(`Missing production catalog SKU ${requested.skuId}`);
      const manifest = planShipment(sku, requested.quantity);
      const goods = orderCost(sku, requested.quantity);
      return {
        sku: { id: sku.id, name: sku.name, category: sku.cat, unitCost: sku.cost },
        goods,
        freight: manifest.fee,
        total: Math.round((goods + manifest.fee) * 100) / 100,
        manifest,
      };
    }, fixture);
    requireTruth(fixture.cash === contract.startingCash
      && fixture.skuId === contract.skuId
      && fixture.productName === contract.productName
      && fixture.quantity === contract.quantity,
    'deterministic fixture drifted from the independent acceptance contract');
    requireTruth(expectedQuote.sku.id === contract.skuId
      && expectedQuote.sku.name === contract.productName
      && expectedQuote.sku.unitCost === contract.unitCost,
    `production catalog drifted from the hard-coded SKU contract: ${JSON.stringify(expectedQuote.sku)}`);
    requireTruth(expectedQuote.goods === contract.goods
      && expectedQuote.freight === contract.freight
      && expectedQuote.total === contract.total,
    `production quote drifted from hard-coded $${contract.goods} + $${contract.freight} = $${contract.total}: ${JSON.stringify(expectedQuote)}`);
    requireTruth(expectedQuote.manifest.boxCount === contract.boxCount
      && expectedQuote.manifest.supplierId === contract.supplierId
      && expectedQuote.manifest.supplier === contract.supplier
      && expectedQuote.manifest.boxes.length === contract.boxCount
      && expectedQuote.manifest.boxes.every((box) => box.qty === contract.unitsPerBox),
    `production packing drifted from two eight-unit Sunday Round cartons: ${JSON.stringify(expectedQuote.manifest)}`);
    const quoteText = await page.locator('.lt-ordersummary .lt-cash').textContent();
    const quotedTotals = moneyValues(quoteText);
    requireTruth(quotedTotals.length === 1, `could not parse one basket total from ${JSON.stringify(quoteText)}`);
    requireTruth(roundMoney(quotedTotals[0]) === contract.total
      && roundMoney(quotedTotals[0]) === expectedQuote.total,
    `laptop quote ${quotedTotals[0]} does not equal independent/production total ${contract.total}`);
    evidence.quote = { expected: expectedQuote, uiText: quoteText.trim(), parsedTotal: quotedTotals[0] };
    await capture('order-01-current-shop-basket.png',
      'Current Shop -> Order basket with sixteen Club polos and the live goods-plus-freight total.');

    const preFirstPlaceOrder = await orderAuthoritySnapshot(fixture.skuId);
    requireTruth(preFirstPlaceOrder.stateCash === contract.startingCash
      && preFirstPlaceOrder.empireCash === contract.startingCash,
    `pre-click wallet is not the contractual $${contract.startingCash}: ${JSON.stringify(preFirstPlaceOrder)}`);
    const placeOrderButton = page.locator('.lt-ordersummary .lt-primary').filter({ hasText: /^Place Order$/ });
    await clickCenter(placeOrderButton, 'Place Order');
    const confirmBar = page.locator('.lt-confirm');
    await confirmBar.waitFor({ state: 'visible', timeout: 5000 });
    const postConfirmationOpen = await orderAuthoritySnapshot(fixture.skuId);
    requireTruth(byteIdentical(postConfirmationOpen, preFirstPlaceOrder),
      `opening the order confirmation mutated finance/order state: ${JSON.stringify({ preFirstPlaceOrder, postConfirmationOpen })}`);
    const confirmationText = (await confirmBar.textContent()).trim().replace(/\s+/g, ' ');
    const confirmationMoney = moneyValues(confirmationText);
    requireTruth(confirmationMoney.length === 3,
      `confirmation must state total, goods, and freight exactly once: ${confirmationText}`);
    requireTruth(roundMoney(confirmationMoney[0]) === contract.total
      && roundMoney(confirmationMoney[1]) === contract.goods
      && roundMoney(confirmationMoney[2]) === contract.freight
      && roundMoney(confirmationMoney[0]) === expectedQuote.total,
    `confirmation money does not reconcile: ${JSON.stringify(confirmationMoney)}`);
    requireTruth(new RegExp(`${contract.boxCount} boxes? to the pad outside`, 'i').test(confirmationText),
      `confirmation does not state the exact ${contract.boxCount}-box receiving plan`);
    await capture('order-02-confirmation.png',
      'Player-facing confirmation states stock, freight, total, and exact physical box count.');

    const cancelPreviewButton = page.locator('.lt-confirm .lt-cancel').filter({ hasText: /^Cancel$/ });
    await clickCenter(cancelPreviewButton, 'Cancel order preview / preserve basket and authority');
    await confirmBar.waitFor({ state: 'hidden', timeout: 5000 });
    const postConfirmationCancel = await orderAuthoritySnapshot(fixture.skuId);
    requireTruth(byteIdentical(postConfirmationCancel, preFirstPlaceOrder),
      `trusted confirmation cancellation mutated finance/order state: ${JSON.stringify({ preFirstPlaceOrder, postConfirmationCancel })}`);
    requireTruth(await productCard.locator('.lt-qty').filter({ hasText: new RegExp(`^${fixture.quantity}$`) }).count() === 1,
      'trusted confirmation cancellation did not preserve the exact basket quantity');
    await capture('order-02b-confirmation-cancelled.png',
      'Trusted visible Cancel returns to the unchanged sixteen-polo basket without creating an order.');

    await clickCenter(placeOrderButton, 'Place Order / reopen confirmation after cancellation');
    await confirmBar.waitFor({ state: 'visible', timeout: 5000 });
    const postConfirmationReopen = await orderAuthoritySnapshot(fixture.skuId);
    requireTruth(byteIdentical(postConfirmationReopen, preFirstPlaceOrder),
      `reopening the order confirmation after cancellation mutated authority: ${JSON.stringify({ preFirstPlaceOrder, postConfirmationReopen })}`);
    const reopenedConfirmationText = (await confirmBar.textContent()).trim().replace(/\s+/g, ' ');
    requireTruth(reopenedConfirmationText === confirmationText,
      `reopened confirmation changed its exact quote: ${JSON.stringify({ confirmationText, reopenedConfirmationText })}`);
    evidence.confirmation = {
      text: confirmationText,
      reopenedText: reopenedConfirmationText,
      parsedMoney: confirmationMoney,
      preFirstPlaceOrder,
      postConfirmationOpen,
      postConfirmationCancel,
      postConfirmationReopen,
      authorityByteLength: authorityBytes(preFirstPlaceOrder).byteLength,
      sideEffectFree: byteIdentical(postConfirmationOpen, preFirstPlaceOrder),
      cancelledByteIdentical: byteIdentical(postConfirmationCancel, preFirstPlaceOrder),
      reopenedByteIdentical: byteIdentical(postConfirmationReopen, preFirstPlaceOrder),
    };

    const beforePurchase = postConfirmationReopen;
    const confirmOrderButton = page.locator('.lt-confirm .lt-primary').filter({ hasText: /^Place the order$/ });
    await clickCenter(confirmOrderButton, 'Place the order / commit once');
    await page.waitForFunction(({ expectedOrderCount, skuId }) => {
      const state = window.__fw.state;
      return state.shop.orders.length === expectedOrderCount
        && state.shop.orders.some((order) => order.skuId === skuId);
    }, {
      expectedOrderCount: beforePurchase.orderCount + 1,
      skuId: fixture.skuId,
    }, { timeout: 5000 });
    await page.waitForFunction(() => document.querySelector('.lt-tabs-big .lt-tab.on')?.textContent?.trim() === 'Deliveries');
    await page.waitForTimeout(750);

    const afterPurchase = await page.evaluate((requested) => {
      const state = window.__fw.state;
      const order = state.shop.orders.find((candidate) => candidate.skuId === requested.skuId);
      const rows = [...document.querySelectorAll('.lt-order')].map((row) => row.textContent.trim().replace(/\s+/g, ' '));
      return {
        stateCash: state.cash,
        empireCash: window.__fw.empire.cash,
        orderCount: state.shop.orders.length,
        orderIds: state.shop.orders.map((candidate) => candidate.id),
        nextOrderId: state.shop.nextOrderId,
        boxCount: state.shop.deliveries.boxes.length,
        shipmentCount: state.shop.deliveries.shipments.length,
        txCount: state.ledger.txLog.length,
        txLog: structuredClone(state.ledger.txLog),
        txTop: structuredClone(state.ledger.txLog[0]),
        ledgerToday: structuredClone(state.ledger.today),
        shopOrderExpense: state.ledger.today.expense.shopOrders,
        inventory: structuredClone(state.shop.inventory[requested.skuId]),
        order: order ? structuredClone(order) : null,
        activeTab: document.querySelector('.lt-tabs-big .lt-tab.on')?.textContent?.trim() || null,
        rows,
      };
    }, fixture);
    requireTruth(afterPurchase.orderCount === beforePurchase.orderCount + 1, 'purchase did not create exactly one order');
    requireTruth(afterPurchase.order?.id === beforePurchase.nextOrderId
      && afterPurchase.nextOrderId === beforePurchase.nextOrderId + 1
      && afterPurchase.orderIds.filter((id) => id === afterPurchase.order.id).length === 1,
    `order allocator did not create exactly one unique authority: ${JSON.stringify({ beforePurchase, afterPurchase })}`);
    requireTruth(afterPurchase.txCount === beforePurchase.txCount + 1, 'purchase did not create exactly one transaction row');
    requireTruth(afterPurchase.stateCash === contract.finalCash
      && roundMoney(beforePurchase.stateCash - afterPurchase.stateCash) === contract.total,
      'state wallet was not deducted by the exact quoted total once');
    requireTruth(afterPurchase.empireCash === contract.startingCash
      || afterPurchase.empireCash === contract.finalCash,
    `paused-frame empire wallet entered an impossible intermediate state: ${afterPurchase.empireCash}`);
    requireTruth(roundMoney(afterPurchase.shopOrderExpense - beforePurchase.shopOrderExpense) === contract.total,
      'shopOrders ledger line does not equal the exact purchase total');
    requireTruth(afterPurchase.txTop?.kind === 'exp'
      && afterPurchase.txTop?.key === 'shopOrders'
      && afterPurchase.txTop?.amt === contract.total
      && afterPurchase.txTop?.bal === contract.finalCash,
    `transaction row is not the exact settled order: ${JSON.stringify(afterPurchase.txTop)}`);
    requireTruth(afterPurchase.order?.cost === contract.total
      && afterPurchase.order?.goods === contract.goods
      && afterPurchase.order?.fee === contract.freight,
    'created order does not preserve the exact quote breakdown');
    requireTruth(afterPurchase.order?.manifest?.boxCount === expectedQuote.manifest.boxCount
      && JSON.stringify(afterPurchase.order?.manifest?.boxes) === JSON.stringify(expectedQuote.manifest.boxes),
    'created order manifest drifted from the exact quoted packing plan');
    requireTruth(afterPurchase.boxCount === beforePurchase.boxCount
      && afterPurchase.shipmentCount === beforePurchase.shipmentCount,
    'physical delivery was created early, before its scheduled minute');
    requireTruth(JSON.stringify(afterPurchase.inventory) === JSON.stringify(beforePurchase.inventory),
      'ordering added inventory before physical unboxing/stock transfer');
    requireTruth(afterPurchase.activeTab === 'Deliveries', 'accepted order did not land on the current Deliveries tab');
    requireTruth(afterPurchase.rows.some((row) => row.includes(fixture.productName)
      && row.includes(String(fixture.quantity))
      && row.includes(`${expectedQuote.manifest.boxCount} boxes`)),
    `current Deliveries tab does not show the exact live order: ${JSON.stringify(afterPurchase.rows)}`);
    evidence.purchase = {
      before: beforePurchase,
      after: afterPurchase,
      empireSyncDeferredWhilePaused: afterPurchase.empireCash !== afterPurchase.stateCash,
    };
    await capture('order-03-on-the-way.png',
      'The accepted order appears on the current Shop -> Deliveries tab without early stock or boxes.');

    await pressKey('Escape', 'close laptop and return to normal walking');
    await page.waitForFunction(() => window.__fw.laptopOpen === false, null, { timeout: 8000 });
    await acquirePointerLock();

    const preArrival = await page.evaluate(({ orderId, lead }) => {
      const app = window.__fw;
      const state = app.state;
      const order = state.shop.orders.find((candidate) => candidate.id === orderId);
      if (!order) throw new Error(`Order ${orderId} disappeared before its scheduled edge`);
      app.speedIdx = 0;
      state.clock.minutes = order.deliveryMin - lead;
      app.empire.clockMinutes = state.clock.minutes;
      const minuteOfDay = ((state.clock.minutes % 1440) + 1440) % 1440;
      app.scene3d.applyTimeWeather?.(minuteOfDay, state.weather);
      return {
        orderId: order.id,
        deliveryMin: order.deliveryMin,
        clockMinutes: state.clock.minutes,
        deltaMinutes: order.deliveryMin - state.clock.minutes,
        status: order.status,
        orders: state.shop.orders.length,
        boxes: state.shop.deliveries.boxes.length,
        shipments: state.shop.deliveries.shipments.length,
        cash: state.cash,
        txCount: state.ledger.txLog.length,
      };
    }, { orderId: afterPurchase.order.id, lead: fixture.arrivalLeadMinutes });
    requireTruth(Math.abs(preArrival.deltaMinutes - fixture.arrivalLeadMinutes) < 1e-9,
      'pre-arrival fixture is not exactly 0.75 game-minute before deliveryMin');
    requireTruth(preArrival.orders === 1 && preArrival.boxes === 0 && preArrival.shipments === 0,
      'delivery exists physically before the scheduled edge');
    await setPlayerCamera(cameras.staging);
    const emptyFraming = await deliveryFraming();
    requireTruth(emptyFraming.every((entry) => entry.exists && entry.inFrame),
      'scheduled empty receiving shot lost one or more authored pallets');
    await capture('01-delivery-area-empty.png',
      'Order is paid and on the road, but the receiving pallets remain empty before deliveryMin.',
      { orderId: afterPurchase.order.id, preArrival, palletFraming: emptyFraming });

    await setPlayerCamera(cameras.arrival);
    const arrivalWallStart = Date.now();
    const arrivalMediaStarted = await startArrivalMediaCapture();
    await pressKey('3', 'normal player 16x speed across scheduled delivery minute');
    await page.waitForFunction((orderId) => {
      const state = window.__fw.state;
      return !state.shop.orders.some((order) => order.id === orderId)
        && state.shop.deliveries.shipments.some((shipment) => shipment.orderId === orderId);
    }, afterPurchase.order.id, { timeout: 12000 });
    await page.waitForFunction(() => {
      const diagnostic = window.__fw.scene3d.clubhouse().deliveryEquipmentDiagnostics?.();
      const van = window.__fw.scene3d.scene.getObjectByName('DeliveryEquipmentRoot_delivery_van');
      if (!diagnostic?.activeArrival || diagnostic.activeArrival.phase !== 'approach' || !van?.visible) return false;
      const camera = window.__fw.scene3d.camera;
      van.updateWorldMatrix(true, false);
      camera.updateWorldMatrix(true, false);
      const ndc = van.getWorldPosition(van.position.clone()).project(camera);
      return Math.abs(ndc.x) <= 0.92 && Math.abs(ndc.y) <= 0.92
        && ndc.z >= -1 && ndc.z <= 1;
    }, null, { timeout: 6000 });
    const arriving = await page.evaluate((orderId) => {
      const app = window.__fw;
      const diagnostic = app.scene3d.clubhouse().deliveryEquipmentDiagnostics?.();
      const van = app.scene3d.scene.getObjectByName('DeliveryEquipmentRoot_delivery_van');
      const camera = app.scene3d.camera;
      van.updateWorldMatrix(true, false);
      camera.updateWorldMatrix(true, false);
      const world = van.getWorldPosition(van.position.clone());
      const ndc = world.clone().project(camera);
      const orderBoxes = app.state.shop.deliveries.boxes.filter((box) => box.orderId === orderId);
      const sceneRoots = orderBoxes.map((box) => {
        const root = app.scene3d.scene.getObjectByName(`DeliveryBox_${box.id}`);
        return {
          boxId: box.id,
          exists: !!root,
          presentationState: root?.userData?.deliveryPresentationState || null,
          interactionEnabled: root?.userData?.deliveryInteractionEnabled ?? null,
        };
      });
      return {
        clockMinutes: app.state.clock.minutes,
        stateCash: app.state.cash,
        empireCash: app.empire.cash,
        activeArrival: diagnostic?.activeArrival || null,
        pendingOrderIds: diagnostic?.pendingOrderIds || [],
        van: {
          visible: van.visible,
          world: { x: world.x, y: world.y, z: world.z },
          ndc: { x: ndc.x, y: ndc.y, z: ndc.z },
        },
        boxesCreatedByPipeline: orderBoxes.length,
        sceneRoots,
        toast: [...document.querySelectorAll('.toast')].map((entry) => entry.textContent.trim())
          .find((text) => /Delivery inbound/i.test(text)) || null,
      };
    }, afterPurchase.order.id);
    requireTruth(arriving.clockMinutes >= afterPurchase.order.deliveryMin,
      'production delivery settled before its own deliveryMin');
    requireTruth(arriving.stateCash === contract.finalCash
      && arriving.empireCash === contract.finalCash,
    'normal-speed simulation did not synchronize the exact club debit back to the empire wallet');
    requireTruth(arriving.activeArrival?.phase === 'approach' && arriving.van.visible,
      'authored delivery van did not enter its real approach phase');
    requireTruth(arriving.pendingOrderIds.map(String).includes(String(afterPurchase.order.id)),
      'arriving boxes are not protected by the van pending-order boundary');
    requireTruth(arriving.boxesCreatedByPipeline === expectedQuote.manifest.boxCount,
      'scheduled pipeline did not create the exact manifest box count');
    requireTruth(arriving.sceneRoots.every((entry) => entry.exists
      && entry.interactionEnabled === false
      && entry.presentationState === 'van-cargo-pending'),
    `van cargo is prematurely interactive or absent: ${JSON.stringify(arriving.sceneRoots)}`);
    requireTruth(!!arriving.toast, 'player-facing delivery-arrival toast was not visible during approach');
    evidence.arrival = {
      preArrival,
      wallClockToArrivalMs: Date.now() - arrivalWallStart,
      arriving,
    };
    await capture('02-delivery-arriving.png',
      'Authored van approaches under normal 16x time input with paid cartons still protected as cargo.',
      { orderId: afterPurchase.order.id, arriving });
    await pressKey('Space', 'pause after the scheduled arrival has fired');

    await page.waitForFunction(({ orderId, boxCount }) => {
      const app = window.__fw;
      const boxes = app.state.shop.deliveries.boxes.filter((box) => box.orderId === orderId);
      const diagnostic = app.scene3d.clubhouse().deliveryEquipmentDiagnostics?.();
      return boxes.length === boxCount
        && !diagnostic?.activeArrival
        && boxes.every((box) => {
          const root = app.scene3d.scene.getObjectByName(`DeliveryBox_${box.id}`);
          return root?.visible
            && root.userData.deliveryPresentationState === 'pallet-ready'
            && root.userData.deliveryInteractionEnabled === true;
        });
    }, { orderId: afterPurchase.order.id, boxCount: expectedQuote.manifest.boxCount }, { timeout: 30000 });
    await page.waitForTimeout(450);
    const arrivalMedia = await stopArrivalMediaCapture(arrivalMediaStarted);
    requireTruth(arrivalMedia.bytesOnDisk === arrivalMedia.bytes
      && arrivalMedia.bytesOnDisk > 100000
      && arrivalMedia.audioTracks >= 1
      && arrivalMedia.videoTracks >= 1
      && arrivalMedia.mimeType.includes('webm')
      && arrivalMedia.nonSilentAudioWindows > 0
      && arrivalMedia.audioPeak > 0.0001
      && arrivalMedia.audioPeak < 0.95,
    `arrival media does not retain healthy live game audio/video: ${JSON.stringify(arrivalMedia)}`);
    requireTruth(arrivalMedia.cueTrace.filter((entry) => entry.name === 'truck').length === 1,
      `the production delivery approach did not emit exactly one truck cue: ${JSON.stringify(arrivalMedia.cueTrace)}`);
    evidence.arrivalMediaCapture = arrivalMedia;
    await setPlayerCamera(cameras.staging);
    const stagedFraming = await deliveryFraming();
    requireTruth(stagedFraming.every((entry) => entry.exists && entry.inFrame),
      'staged delivery shot lost one or more authored pallets');

    const staged = await page.evaluate(async ({ orderId, skuId }) => {
      const { DELIVERY_PALLET_STAGING } = await import('/src/data/deliveryStaging.js');
      const THREE = await import('three');
      const app = window.__fw;
      const state = app.state;
      const camera = app.scene3d.camera;
      const scene = app.scene3d.scene;
      scene.updateMatrixWorld(true);
      camera.updateWorldMatrix(true, false);
      camera.updateProjectionMatrix();
      const cameraWorld = camera.getWorldPosition(new THREE.Vector3());
      const viewportWidth = app.scene3d.renderer?.domElement?.clientWidth || window.innerWidth;
      const viewportHeight = app.scene3d.renderer?.domElement?.clientHeight || window.innerHeight;
      const readabilityThreshold = Object.freeze({ widthPx: 48, heightPx: 28, areaPx: 1344 });
      const raycaster = new THREE.Raycaster();
      raycaster.layers.mask = camera.layers.mask;
      const canvasIds = new Map();
      const canvasId = (canvas) => {
        if (!canvas) return null;
        if (!canvasIds.has(canvas)) canvasIds.set(canvas, `label-canvas-${canvasIds.size + 1}`);
        return canvasIds.get(canvas);
      };
      const nodeEffectivelyVisible = (object) => {
        for (let node = object; node; node = node.parent) {
          if (node.visible === false) return false;
        }
        return true;
      };
      const materialEffectivelyVisible = (object) => {
        const materials = Array.isArray(object?.material) ? object.material : [object?.material];
        return materials.some((material) => material
          && material.visible !== false
          && material.colorWrite !== false
          && Number(material.opacity ?? 1) > 0.02);
      };
      const renderableHit = (hit) => hit?.object?.isMesh
        && nodeEffectivelyVisible(hit.object)
        && materialEffectivelyVisible(hit.object);
      const rayEvidence = (labelMesh, target) => {
        const delta = target.clone().sub(cameraWorld);
        const distance = delta.length();
        raycaster.near = 0.01;
        raycaster.far = distance + 0.02;
        raycaster.set(cameraWorld, delta.normalize());
        const direct = raycaster.intersectObject(labelMesh, false)[0] || null;
        const firstSceneHit = raycaster.intersectObjects(scene.children, true).find(renderableHit) || null;
        const unoccluded = !!direct && (!firstSceneHit
          || firstSceneHit.object === labelMesh
          || firstSceneHit.distance >= direct.distance - 0.0015);
        return {
          directDistance: direct?.distance ?? null,
          firstSceneDistance: firstSceneHit?.distance ?? null,
          firstSceneObject: firstSceneHit?.object?.name || null,
          unoccluded,
          direct,
        };
      };
      const boxes = state.shop.deliveries.boxes.filter((box) => box.orderId === orderId);
      const sceneBoxes = boxes.map((box) => {
        const root = app.scene3d.scene.getObjectByName(`DeliveryBox_${box.id}`);
        root.updateWorldMatrix(true, true);
        const world = root.getWorldPosition(root.position.clone());
        const ndc = world.clone().project(camera);
        let bounds = null;
        root.traverseVisible((object) => {
          if (!object.isMesh || !object.geometry) return;
          if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
          const candidate = object.geometry.boundingBox.clone().applyMatrix4(object.matrixWorld);
          if (bounds) bounds.union(candidate);
          else bounds = candidate;
        });
        if (!bounds) throw new Error(`DeliveryBox_${box.id} has no visible render bounds`);
        const pallet = app.scene3d.scene.getObjectByName(`DeliveryPallet_${Number(box.padPalletIndex) + 1}`);
        if (!pallet) throw new Error(`DeliveryBox_${box.id} references missing pallet ${box.padPalletIndex}`);
        pallet.updateWorldMatrix(true, true);
        const palletWorld = pallet.getWorldPosition(world.clone());
        const footprintCorners = [
          [bounds.min.x, bounds.min.z],
          [bounds.min.x, bounds.max.z],
          [bounds.max.x, bounds.min.z],
          [bounds.max.x, bounds.max.z],
        ].map(([x, z]) => pallet.worldToLocal(world.clone().set(x, bounds.min.y, z)));
        const maxLocalAbsX = Math.max(...footprintCorners.map((corner) => Math.abs(corner.x)));
        const maxLocalAbsZ = Math.max(...footprintCorners.map((corner) => Math.abs(corner.z)));
        const footprintAllowance = DELIVERY_PALLET_STAGING.maxFootprintOverhang + 0.003;
        const withinPalletFootprint = maxLocalAbsX
            <= DELIVERY_PALLET_STAGING.length / 2 + footprintAllowance
          && maxLocalAbsZ <= DELIVERY_PALLET_STAGING.width / 2 + footprintAllowance;
        const palletTopY = palletWorld.y + DELIVERY_PALLET_STAGING.height;
        const labelMesh = root.getObjectByName('LABEL_DYNAMIC');
        let labelEffectivelyVisible = !!labelMesh;
        for (let node = labelMesh; node; node = node.parent) {
          if (node.visible === false) labelEffectivelyVisible = false;
        }
        const labelMaterials = labelMesh
          ? (Array.isArray(labelMesh.material) ? labelMesh.material : [labelMesh.material])
          : [];
        const labelOpacity = labelMaterials.map((material) => Number(material?.opacity ?? 1));
        const labelMaterialVisible = labelMaterials.length > 0 && labelMaterials.every((material) => (
          material?.visible !== false && Number(material?.opacity ?? 1) > 0.02
        ));
        const labelTexture = labelMaterials.find((material) => material?.map)?.map || null;
        const labelCanvas = labelTexture?.source?.data || labelTexture?.image || null;
        const sourceTextTrace = Array.isArray(labelCanvas?.__liveOrderQaCurrentText)
          ? labelCanvas.__liveOrderQaCurrentText.map((entry) => ({ ...entry }))
          : [];
        const normalizedSourceText = sourceTextTrace
          .map((entry) => String(entry.text || '').trim().replace(/\s+/g, ' '));
        const shippedQuantity = box.initialQty ?? box.cap ?? box.qty;
        const expectedPayloadText = {
          supplier: String(box.supplier || '').toUpperCase(),
          order: `ORDER ${String(box.orderId || 0).padStart(4, '0')}`,
          product: String(box.skuId === skuId ? 'CLUB POLO' : box.skuId).toUpperCase(),
          quantity: `QTY ${shippedQuantity}${box.lb == null ? '' : ` ${box.lb} LB`}`,
        };
        const exactPayloadMatches = Object.fromEntries(Object.entries(expectedPayloadText).map(([key, value]) => [
          key,
          normalizedSourceText.filter((entry) => entry === value).length,
        ]));

        let labelView = {
          withinScreenBounds: false,
          readable: false,
          frontFacing: false,
          unoccluded: false,
          readabilityThreshold,
          reason: 'LABEL_DYNAMIC geometry unavailable',
        };
        if (labelMesh?.geometry) {
          if (!labelMesh.geometry.boundingBox) labelMesh.geometry.computeBoundingBox();
          const localBounds = labelMesh.geometry.boundingBox;
          const localCenter = localBounds.getCenter(new THREE.Vector3());
          const localSize = localBounds.getSize(new THREE.Vector3());
          const projectedCorners = [];
          for (const x of [localBounds.min.x, localBounds.max.x]) {
            for (const y of [localBounds.min.y, localBounds.max.y]) {
              for (const z of [localBounds.min.z, localBounds.max.z]) {
                const worldCorner = new THREE.Vector3(x, y, z).applyMatrix4(labelMesh.matrixWorld);
                const ndcCorner = worldCorner.clone().project(camera);
                projectedCorners.push({
                  world: { x: worldCorner.x, y: worldCorner.y, z: worldCorner.z },
                  ndc: { x: ndcCorner.x, y: ndcCorner.y, z: ndcCorner.z },
                  screen: {
                    x: (ndcCorner.x + 1) * viewportWidth / 2,
                    y: (1 - ndcCorner.y) * viewportHeight / 2,
                  },
                });
              }
            }
          }
          const screenXs = projectedCorners.map((entry) => entry.screen.x);
          const screenYs = projectedCorners.map((entry) => entry.screen.y);
          const screenBounds = {
            minX: Math.min(...screenXs),
            maxX: Math.max(...screenXs),
            minY: Math.min(...screenYs),
            maxY: Math.max(...screenYs),
          };
          screenBounds.width = screenBounds.maxX - screenBounds.minX;
          screenBounds.height = screenBounds.maxY - screenBounds.minY;
          screenBounds.area = screenBounds.width * screenBounds.height;
          const withinScreenBounds = projectedCorners.every((entry) => (
            entry.ndc.z >= -1 && entry.ndc.z <= 1
              && entry.screen.x >= 6 && entry.screen.x <= viewportWidth - 6
              && entry.screen.y >= 6 && entry.screen.y <= viewportHeight - 6
          ));
          const readable = screenBounds.width >= readabilityThreshold.widthPx
            && screenBounds.height >= readabilityThreshold.heightPx
            && screenBounds.area >= readabilityThreshold.areaPx;

          const localAxes = [
            { key: 'x', size: localSize.x },
            { key: 'y', size: localSize.y },
            { key: 'z', size: localSize.z },
          ].sort((left, right) => right.size - left.size);
          const sampleLocals = [localCenter.clone()];
          for (const horizontal of [-0.30, 0.30]) {
            for (const vertical of [-0.30, 0.30]) {
              const sample = localCenter.clone();
              sample[localAxes[0].key] += localAxes[0].size * horizontal;
              sample[localAxes[1].key] += localAxes[1].size * vertical;
              sampleLocals.push(sample);
            }
          }
          const raySamples = sampleLocals.map((sample) => {
            const target = sample.applyMatrix4(labelMesh.matrixWorld);
            const hit = rayEvidence(labelMesh, target);
            return {
              target: { x: target.x, y: target.y, z: target.z },
              directDistance: hit.directDistance,
              firstSceneDistance: hit.firstSceneDistance,
              firstSceneObject: hit.firstSceneObject,
              unoccluded: hit.unoccluded,
            };
          });
          const centerTarget = localCenter.clone().applyMatrix4(labelMesh.matrixWorld);
          const centerHit = rayEvidence(labelMesh, centerTarget).direct;
          let frontFacingDot = null;
          if (centerHit?.face?.normal) {
            const normal = centerHit.face.normal.clone().transformDirection(labelMesh.matrixWorld).normalize();
            const toCamera = cameraWorld.clone().sub(centerHit.point).normalize();
            frontFacingDot = normal.dot(toCamera);
          }
          labelView = {
            viewport: { width: viewportWidth, height: viewportHeight },
            screenBounds,
            projectedCorners,
            withinScreenBounds,
            readable,
            readabilityThreshold,
            frontFacingDot,
            frontFacing: Number.isFinite(frontFacingDot) && frontFacingDot >= 0.10,
            unoccluded: raySamples.every((sample) => sample.unoccluded),
            raySamples,
          };
        }
        return {
          id: box.id,
          orderId: box.orderId,
          skuId: box.skuId,
          quantity: box.qty,
          capacity: box.cap,
          loc: box.loc,
          padPalletIndex: box.padPalletIndex,
          lifecycle: box.lifecycle,
          boxKind: box.box,
          modelId: box.modelId,
          layoutId: box.layoutId,
          supplier: box.supplier,
          packingState: box.packingState,
          presentationState: root.userData.deliveryPresentationState,
          interactionEnabled: root.userData.deliveryInteractionEnabled,
          deliveryModelId: root.userData.deliveryModelId,
          deliveryLayoutId: root.userData.deliveryLayoutId,
          dynamicLabel: !!labelMesh,
          label: {
            effectivelyVisible: labelEffectivelyVisible,
            materialVisible: labelMaterialVisible,
            opacity: labelOpacity,
            hasTexture: !!labelTexture,
            canvasTexture: !!labelTexture?.isCanvasTexture,
            textureUuid: labelTexture?.uuid || null,
            textureSurfaceAspect: labelTexture?.userData?.deliveryLabelSurfaceAspect ?? null,
            sourceCanvasId: canvasId(labelCanvas),
            sourceCanvasSize: labelCanvas ? { width: labelCanvas.width, height: labelCanvas.height } : null,
            sourceTextTrace,
            normalizedSourceText,
            expectedPayloadText,
            exactPayloadMatches,
            exactPayloadText: Object.values(exactPayloadMatches).every((count) => count === 1),
            view: labelView,
            payloadAuthority: {
              skuId: box.skuId,
              quantity: box.initialQty ?? box.cap ?? box.qty,
              supplier: box.supplier,
              orderId: box.orderId,
            },
          },
          world: { x: world.x, y: world.y, z: world.z },
          ndc: { x: ndc.x, y: ndc.y, z: ndc.z },
          inFrame: Math.abs(ndc.x) <= 0.96 && Math.abs(ndc.y) <= 0.96
            && ndc.z >= -1 && ndc.z <= 1,
          bounds: {
            min: { x: bounds.min.x, y: bounds.min.y, z: bounds.min.z },
            max: { x: bounds.max.x, y: bounds.max.y, z: bounds.max.z },
          },
          pallet: {
            index: box.padPalletIndex,
            validIndex: Number.isInteger(box.padPalletIndex)
              && box.padPalletIndex >= 0
              && box.padPalletIndex < DELIVERY_PALLET_STAGING.count,
            world: { x: palletWorld.x, y: palletWorld.y, z: palletWorld.z },
            topY: palletTopY,
            maxLocalAbsX,
            maxLocalAbsZ,
            footprintAllowance,
            withinFootprint: withinPalletFootprint,
            supportedVertically: bounds.min.y >= palletTopY - 0.012,
          },
        };
      });
      const intersections = [];
      for (let left = 0; left < sceneBoxes.length; left += 1) {
        for (let right = left + 1; right < sceneBoxes.length; right += 1) {
          const a = sceneBoxes[left].bounds;
          const b = sceneBoxes[right].bounds;
          const overlap = {
            x: Math.max(0, Math.min(a.max.x, b.max.x) - Math.max(a.min.x, b.min.x)),
            y: Math.max(0, Math.min(a.max.y, b.max.y) - Math.max(a.min.y, b.min.y)),
            z: Math.max(0, Math.min(a.max.z, b.max.z) - Math.max(a.min.z, b.min.z)),
          };
          intersections.push({
            leftId: sceneBoxes[left].id,
            rightId: sceneBoxes[right].id,
            overlap,
            overlapVolume: overlap.x * overlap.y * overlap.z,
          });
        }
      }
      const diagnostic = app.scene3d.clubhouse().deliveryEquipmentDiagnostics?.();
      const shipments = state.shop.deliveries.shipments.filter((shipment) => shipment.orderId === orderId);
      const arrivalNotices = state.notifications.items.filter((item) => (
        item.kind === 'delivery' && item.dedupeKey === `arrived:${orderId}`
      ));
      return {
        clockMinutes: state.clock.minutes,
        cash: state.cash,
        empireCash: app.empire.cash,
        nextOrderId: state.shop.nextOrderId,
        txCount: state.ledger.txLog.length,
        txLog: structuredClone(state.ledger.txLog),
        ledgerToday: structuredClone(state.ledger.today),
        orderStillPending: state.shop.orders.some((order) => order.id === orderId),
        arrivedOrderIdOccurrences: state.shop.deliveries.arrivedOrderIds.filter((id) => id === orderId).length,
        shipmentCount: shipments.length,
        shipment: shipments[0] ? structuredClone(shipments[0]) : null,
        inventory: structuredClone(state.shop.inventory[skuId]),
        boxes: sceneBoxes,
        intersections,
        arrivalNotices: arrivalNotices.map((item) => structuredClone(item)),
        labelCanvasSourceCount: canvasIds.size,
        stagingContract: { ...DELIVERY_PALLET_STAGING },
        equipment: diagnostic,
      };
    }, { orderId: afterPurchase.order.id, skuId: fixture.skuId });
    requireTruth(!staged.orderStillPending, 'delivered order remains in the on-road collection');
    requireTruth(staged.cash === contract.finalCash
      && staged.empireCash === contract.finalCash
      && staged.nextOrderId === preFirstPlaceOrder.nextOrderId + 1
      && staged.txCount === preFirstPlaceOrder.txCount + 1
      && roundMoney(staged.ledgerToday.expense.shopOrders - preFirstPlaceOrder.shopOrderExpense) === contract.total,
    `final fixture does not reconcile to $${contract.finalCash}, one order, and one $${contract.total} transaction: ${JSON.stringify({ preFirstPlaceOrder, staged })}`);
    requireTruth(staged.arrivedOrderIdOccurrences === 1, 'order arrival authority was not settled exactly once');
    requireTruth(staged.shipmentCount === 1, 'delivery created duplicate or missing shipment history');
    requireTruth(staged.shipment?.units === fixture.quantity
      && staged.shipment?.boxCount === expectedQuote.manifest.boxCount,
    `shipment history does not match ordered units/boxes: ${JSON.stringify(staged.shipment)}`);
    requireTruth(staged.boxes.length === expectedQuote.manifest.boxCount,
      'staged physical boxes do not match the manifest count');
    const paddedOrderId = String(afterPurchase.order.id).padStart(4, '0');
    const independentLabelText = Object.freeze({
      header: contract.labelHeader,
      supplier: contract.supplier.toUpperCase(),
      order: `ORDER ${paddedOrderId}`,
      product: contract.productName.toUpperCase(),
      quantity: `QTY ${contract.unitsPerBox} ${contract.labelWeightLb} LB`,
      handling: contract.labelHandling,
    });
    requireTruth(staged.boxes.every((box, index) => (
      box.orderId === afterPurchase.order.id
      && box.skuId === fixture.skuId
      && box.quantity === expectedQuote.manifest.boxes[index].qty
      && box.loc === 'pad'
      && Number.isInteger(box.padPalletIndex)
      && box.lifecycle === 'SEALED'
      && box.boxKind === expectedQuote.manifest.boxes[index].kind
      && box.modelId === expectedQuote.manifest.boxes[index].modelId
      && box.layoutId === expectedQuote.manifest.boxes[index].layoutId
      && box.deliveryModelId === box.modelId
      && box.deliveryLayoutId === box.layoutId
      && box.dynamicLabel
      && box.label.effectivelyVisible
      && box.label.materialVisible
      && box.label.opacity.every((opacity) => opacity > 0.02)
      && box.label.hasTexture
      && box.label.canvasTexture
      && Number.isFinite(box.label.textureSurfaceAspect)
      && !!box.label.sourceCanvasId
      && box.label.sourceCanvasSize?.width === 512
      && box.label.sourceCanvasSize?.height === 320
      && box.label.exactPayloadText
      && box.label.view?.withinScreenBounds
      && box.label.view?.readable
      && box.label.view?.frontFacing
      && box.label.view?.unoccluded
      && box.label.payloadAuthority.skuId === contract.skuId
      && box.label.payloadAuthority.quantity === contract.unitsPerBox
      && box.label.payloadAuthority.supplier === contract.supplier
      && box.label.payloadAuthority.orderId === afterPurchase.order.id
      && box.pallet.validIndex
      && box.pallet.index >= 0
      && box.pallet.index <= 4
      && box.pallet.withinFootprint
      && box.pallet.supportedVertically
      && box.presentationState === 'pallet-ready'
      && box.interactionEnabled === true
      && box.inFrame
    )), `one or more staged boxes violate identity, packaging, label, interaction, or framing contracts: ${JSON.stringify(staged.boxes)}`);
    const labelCanvasIds = staged.boxes.map((box) => box.label.sourceCanvasId);
    requireTruth(staged.labelCanvasSourceCount === staged.boxes.length
      && new Set(labelCanvasIds).size === staged.boxes.length,
    `staged cartons do not own one independently observed label canvas each: ${JSON.stringify(labelCanvasIds)}`);
    const supportChecks = [];
    for (const palletIndex of [...new Set(staged.boxes.map((box) => box.pallet.index))]) {
      const stack = staged.boxes
        .filter((box) => box.pallet.index === palletIndex)
        .sort((left, right) => left.bounds.min.y - right.bounds.min.y);
      stack.forEach((box, index) => {
        const supportY = index === 0 ? box.pallet.topY : stack[index - 1].bounds.max.y;
        supportChecks.push({
          palletIndex,
          boxId: box.id,
          supportY,
          boxBottomY: box.bounds.min.y,
          gap: box.bounds.min.y - supportY,
          supported: Math.abs(box.bounds.min.y - supportY) <= 0.025,
        });
      });
    }
    requireTruth(supportChecks.every((entry) => entry.supported),
      `one or more staged boxes float above or sink into their pallet/box support: ${JSON.stringify(supportChecks)}`);
    requireTruth(staged.intersections.every((entry) => entry.overlapVolume <= 1e-7),
      `staged box volumes overlap: ${JSON.stringify(staged.intersections)}`);
    requireTruth(staged.cash === afterPurchase.stateCash && staged.empireCash === afterPurchase.stateCash,
      'arrival charged the wallet a second time');
    requireTruth(staged.txCount === afterPurchase.txCount, 'arrival created an extra financial transaction');
    requireTruth(JSON.stringify(staged.inventory) === JSON.stringify(beforePurchase.inventory),
      'arrival put stock directly into inventory before the player unboxed it');
    requireTruth(staged.arrivalNotices.length === 1,
      `arrival notification was missing or duplicated: ${staged.arrivalNotices.length}`);
    const perBoxLabelEvidence = staged.boxes.map((box) => ({
      boxId: box.id,
      textureUuid: box.label.textureUuid,
      sourceCanvasId: box.label.sourceCanvasId,
      expected: independentLabelText,
      actual: box.label.normalizedSourceText,
      exactFieldCounts: Object.fromEntries(Object.entries(independentLabelText).map(([field, expected]) => [
        field,
        box.label.normalizedSourceText.filter((text) => text === expected).length,
      ])),
      view: box.label.view,
    }));
    requireTruth(perBoxLabelEvidence.every((entry) => (
      Object.values(entry.exactFieldCounts).every((count) => count === 1)
      && entry.view.withinScreenBounds
      && entry.view.readable
      && entry.view.frontFacing
      && entry.view.unoccluded
    )), `each actual CanvasTexture must contain one exact independent label payload and be readable in the evidence view: ${JSON.stringify(perBoxLabelEvidence)}`);
    const requiredBeats = ['queued', 'approach', 'parked', 'doors-opening', 'cargo-open', 'unload', 'doors-closing', 'departing', 'complete'];
    const orderBeats = (staged.equipment?.beatHistory || [])
      .filter((entry) => String(entry.orderId) === String(afterPurchase.order.id))
      .map((entry) => entry.beat);
    requireTruth(JSON.stringify(orderBeats) === JSON.stringify(requiredBeats),
      `delivery van beat order is incomplete: ${JSON.stringify(orderBeats)}`);
    requireTruth((staged.equipment?.callbackErrors || []).length === 0,
      `delivery presentation callback errors: ${JSON.stringify(staged.equipment?.callbackErrors)}`);
    evidence.staged = {
      ...staged,
      palletFraming: stagedFraming,
      supportChecks,
      independentLabelText,
      perBoxLabelEvidence,
      requiredBeats,
      orderBeats,
    };
    evidence.finalReconciliation = {
      expected: {
        startingCash: contract.startingCash,
        goods: contract.goods,
        freight: contract.freight,
        total: contract.total,
        finalCash: contract.finalCash,
        newTransactions: 1,
        newOrdersAllocated: 1,
        arrivedAuthorities: 1,
        shipments: 1,
      },
      actual: {
        startingCash: preFirstPlaceOrder.stateCash,
        goods: afterPurchase.order.goods,
        freight: afterPurchase.order.fee,
        total: afterPurchase.order.cost,
        finalCash: staged.cash,
        newTransactions: staged.txCount - preFirstPlaceOrder.txCount,
        newOrdersAllocated: staged.nextOrderId - preFirstPlaceOrder.nextOrderId,
        arrivedAuthorities: staged.arrivedOrderIdOccurrences,
        shipments: staged.shipmentCount,
      },
    };
    await capture('03-boxes-staged.png',
      'Exact order cartons are labelled, non-overlapping, interactive, and staged on the authored pallets.',
      { orderId: afterPurchase.order.id, boxes: staged.boxes, palletFraming: stagedFraming });

    const trustedInputTrace = await page.evaluate(() => (
      (window.__liveOrderQaTrace || []).map((entry) => ({ ...entry }))
    ));
    evidence.trustedInputTrace = trustedInputTrace;
    const trustedPointerEntries = trustedInputTrace
      .filter((entry) => entry.type === 'pointerdown' && entry.trusted);
    const pointerTargets = trustedPointerEntries.map((entry) => entry.target);
    const trustedKeys = trustedInputTrace
      .filter((entry) => entry.type === 'keydown' && entry.trusted)
      .map((entry) => String(entry.key || '').toLowerCase());
    evidence.inputProof = {
      trustedKeys,
      pointerTargets,
      shopNavClicks: trustedPointerEntries.filter((entry) => (
        entry.target === 'Shop' && /\blt-navbtn\b/.test(String(entry.targetClass || ''))
      )).length,
      orderTabClicks: trustedPointerEntries.filter((entry) => (
        entry.target === 'Order' && /\blt-tab\b/.test(String(entry.targetClass || ''))
      )).length,
      plusClicks: pointerTargets.filter((target) => target === '+').length,
      placeOrderClicks: pointerTargets.filter((target) => target === 'Place Order').length,
      previewCancelClicks: trustedPointerEntries.filter((entry) => (
        entry.target === 'Cancel' && /\blt-cancel\b/.test(String(entry.targetClass || ''))
      )).length,
      commitClicks: pointerTargets.filter((target) => target === 'Place the order').length,
    };
    requireTruth(trustedKeys.includes('e'), 'trusted E input did not open the physical laptop');
    requireTruth(trustedKeys.includes('escape'), 'trusted Escape input did not return to walking');
    requireTruth(trustedKeys.includes('3'), 'trusted 3 input did not drive the scheduled delivery edge');
    requireTruth(evidence.inputProof.shopNavClicks === 1
      && evidence.inputProof.orderTabClicks === 1,
    'current Shop navigation and Order tab were not each entered by exactly one trusted mouse click');
    requireTruth(evidence.inputProof.plusClicks === fixture.quantity,
      `basket quantity was not entered by ${fixture.quantity} trusted + clicks`);
    requireTruth(evidence.inputProof.placeOrderClicks === 2
      && evidence.inputProof.previewCancelClicks === 1
      && evidence.inputProof.commitClicks === 1,
    'order preview was not opened twice, cancelled once, and committed once by exact trusted clicks');
  } catch (error) {
    actionError = error;
    evidence.failure = {
      message: String(error?.message || error),
      stack: String(error?.stack || ''),
      at: new Date().toISOString(),
    };
    await page.screenshot({ path: path.join(out, 'failure.png') }).catch(() => {});
  } finally {
    if (storageBaseline) {
      try {
        const beforeRestore = await storageSnapshot();
        await page.evaluate((baseline) => {
          localStorage.clear();
          sessionStorage.clear();
          for (const [key, value] of Object.entries(baseline.local)) localStorage.setItem(key, value);
          for (const [key, value] of Object.entries(baseline.session)) sessionStorage.setItem(key, value);
          if (window.__liveOrderQaTraceHandler) {
            window.removeEventListener('keydown', window.__liveOrderQaTraceHandler, true);
            window.removeEventListener('pointerdown', window.__liveOrderQaTraceHandler, true);
          }
          if (window.__liveOrderQaOriginalFillText && window.CanvasRenderingContext2D?.prototype) {
            window.CanvasRenderingContext2D.prototype.fillText = window.__liveOrderQaOriginalFillText;
          }
          if (window.__liveOrderQaOriginalClearRect && window.CanvasRenderingContext2D?.prototype) {
            window.CanvasRenderingContext2D.prototype.clearRect = window.__liveOrderQaOriginalClearRect;
          }
          for (const canvas of window.__liveOrderQaTracedCanvases || []) {
            delete canvas.__liveOrderQaCurrentText;
          }
          delete window.__liveOrderQaTraceHandler;
          delete window.__liveOrderQaTrace;
          delete window.__liveOrderQaOriginalFillText;
          delete window.__liveOrderQaOriginalClearRect;
          delete window.__liveOrderQaTracedCanvases;
        }, storageBaseline);
        const afterRestore = await storageSnapshot();
        storageIsolation = {
          baselineLocalKeys: Object.keys(storageBaseline.local).sort(),
          baselineSessionKeys: Object.keys(storageBaseline.session).sort(),
          changedBeforeRestore: !sameRecord(beforeRestore, storageBaseline),
          restoredExactly: sameRecord(afterRestore, storageBaseline),
          localStorageBytes: Object.entries(storageBaseline.local)
            .reduce((sum, [key, value]) => sum + key.length + String(value).length, 0),
        };
      } catch (error) {
        storageIsolation = {
          baselineLocalKeys: Object.keys(storageBaseline.local).sort(),
          baselineSessionKeys: Object.keys(storageBaseline.session).sort(),
          changedBeforeRestore: null,
          restoredExactly: false,
          error: String(error?.message || error),
        };
        if (!actionError) actionError = error;
      }
    }
  }

  evidence.storageIsolation = storageIsolation;
  evidence.diagnostics = { counts: diagnosticCounts, entries: diagnostics };
  const assertions = {
    actionRouteCompleted: !actionError,
    currentLaptopNavigationContract: evidence.currentUiContract?.route === 'Shop -> Order -> automatic Deliveries tab'
      && evidence.currentUiContract?.retiredSelectorsUsed?.length === 0,
    independentContractMatchesProductionAndUi: evidence.quote?.parsedTotal === contract.total
      && evidence.quote?.expected?.goods === contract.goods
      && evidence.quote?.expected?.freight === contract.freight
      && evidence.quote?.expected?.total === contract.total,
    confirmationOpenIsSideEffectFree: evidence.confirmation?.sideEffectFree === true,
    confirmationCancelIsByteIdentical: evidence.confirmation?.cancelledByteIdentical === true,
    confirmationReopenIsByteIdentical: evidence.confirmation?.reopenedByteIdentical === true,
    exactlyOneOrderCreated: evidence.purchase?.after?.orderCount === evidence.purchase?.before?.orderCount + 1,
    exactlyOneDeduction: evidence.purchase?.after?.txCount === evidence.purchase?.before?.txCount + 1
      && roundMoney((evidence.purchase?.before?.stateCash ?? 0) - (evidence.purchase?.after?.stateCash ?? 0))
        === contract.total
      && evidence.purchase?.after?.stateCash === contract.finalCash,
    noEarlyInventoryOrBoxes: evidence.purchase
      ? evidence.purchase.after.boxCount === evidence.purchase.before.boxCount
        && evidence.purchase.after.shipmentCount === evidence.purchase.before.shipmentCount
        && JSON.stringify(evidence.purchase.after.inventory) === JSON.stringify(evidence.purchase.before.inventory)
      : false,
    normalSpeedKeyCrossedScheduledMinute: evidence.arrival?.arriving?.clockMinutes
      >= evidence.purchase?.after?.order?.deliveryMin,
    authoredVanArrivalRan: evidence.arrival?.arriving?.activeArrival?.phase === 'approach',
    exactPhysicalShipmentStaged: evidence.staged?.boxes?.length === evidence.quote?.expected?.manifest?.boxCount
      && evidence.staged?.shipmentCount === 1
      && evidence.staged?.boxes?.every((box) => box.pallet?.validIndex
        && box.pallet?.withinFootprint
        && box.label?.effectivelyVisible
        && box.label?.materialVisible
        && box.label?.exactPayloadText
        && box.label?.view?.withinScreenBounds
        && box.label?.view?.readable
        && box.label?.view?.frontFacing
        && box.label?.view?.unoccluded),
    exactPerBoxLabelCanvasEvidence: evidence.staged?.labelCanvasSourceCount
      === evidence.staged?.boxes?.length
      && evidence.staged?.perBoxLabelEvidence?.every((entry) => (
        Object.values(entry.exactFieldCounts || {}).every((count) => count === 1)
        && entry.view?.withinScreenBounds
        && entry.view?.readable
        && entry.view?.frontFacing
        && entry.view?.unoccluded
      )),
    noDuplicateArrivalOrRecharge: evidence.staged?.arrivedOrderIdOccurrences === 1
      && evidence.staged?.txCount === evidence.purchase?.after?.txCount
      && evidence.staged?.cash === contract.finalCash
      && evidence.staged?.nextOrderId === evidence.confirmation?.preFirstPlaceOrder?.nextOrderId + 1,
    finalFixtureReconciles: JSON.stringify(evidence.finalReconciliation?.actual)
      === JSON.stringify(evidence.finalReconciliation?.expected),
    exactVanBeatSequence: JSON.stringify(evidence.staged?.orderBeats)
      === JSON.stringify(evidence.staged?.requiredBeats),
    trustedNormalControls: evidence.inputProof?.plusClicks === fixture.quantity
      && evidence.inputProof?.placeOrderClicks === 2
      && evidence.inputProof?.previewCancelClicks === 1
      && evidence.inputProof?.commitClicks === 1
      && evidence.inputProof?.shopNavClicks === 1
      && evidence.inputProof?.orderTabClicks === 1
      && evidence.inputProof?.trustedKeys?.includes('e')
      && evidence.inputProof?.trustedKeys?.includes('escape')
      && evidence.inputProof?.trustedKeys?.includes('3'),
    storageRestoredExactly: storageIsolation?.restoredExactly === true,
    noConsoleOrPageErrors: diagnosticCounts.consoleError === 0 && diagnosticCounts.pageError === 0,
    noFailedRequests: diagnosticCounts.requestFailed === 0,
  };
  const ok = Object.values(assertions).every(Boolean);
  const result = {
    ok,
    assertions,
    blocker: ok ? null : {
      message: actionError
        ? String(actionError?.message || actionError)
        : `Fail-closed assertions: ${Object.entries(assertions).filter(([, pass]) => !pass).map(([name]) => name).join(', ')}`,
    },
    ...evidence,
    completedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(out, 'diagnostics.json'), `${JSON.stringify(result.diagnostics, null, 2)}\n`);
  fs.writeFileSync(path.join(out, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
  fs.writeFileSync(path.join(out, 'run-state.json'), `${JSON.stringify({
    status: ok ? 'passed' : 'failed',
    result: path.join(out, 'result.json'),
    screenshots: result.screenshots.map((entry) => entry.file),
    blocker: result.blocker,
    updatedAt: new Date().toISOString(),
  }, null, 2)}\n`);
  return result;
}
