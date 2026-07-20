async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const out = path.resolve(process.env.QA_OUTPUT_DIR || 'qa/inventory-delivery-loop/baseline');
  fs.mkdirSync(out, { recursive: true });

  const viewport = Object.freeze({ width: 1600, height: 900 });
  const cameras = Object.freeze({
    laptop: { lx: 8.45, lz: 4.5, yaw: -Math.PI / 2, pitch: -0.05 },
    receiving: { lx: 11.2, lz: -3.6, yaw: -Math.PI / 2, pitch: -0.15 },
    sealedBox: { lx: 7.4, lz: -4.1, yaw: 0, pitch: -0.28 },
    openBox: { lx: 7.4, lz: -4.1, yaw: 0, pitch: -0.48 },
    shelf: { lx: -6.9, lz: -5.4, yaw: 0, pitch: -0.05 },
  });
  const diagnostics = [];
  const diagnosticsByKind = {
    consoleError: 0,
    consoleWarning: 0,
    pageError: 0,
    requestFailed: 0,
  };
  const note = (kind, text) => {
    diagnosticsByKind[kind] += 1;
    if (diagnostics.length < 100) diagnostics.push({ kind, text: String(text) });
  };
  page.on('console', (message) => {
    if (message.type() === 'error') note('consoleError', message.text());
    if (message.type() === 'warning') note('consoleWarning', message.text());
  });
  page.on('pageerror', (error) => note('pageError', error.message));
  page.on('requestfailed', (request) => {
    const failure = request.failure()?.errorText || 'unknown';
    if (/ERR_ABORTED/i.test(failure)) return; // optional lazy GLBs cancelled during teardown/navigation
    note('requestFailed', `${request.url()} (${failure})`);
  });
  page.on('response', (response) => {
    if (response.status() >= 400) note('requestFailed', `${response.url()} (HTTP ${response.status()})`);
  });

  await page.addInitScript(() => {
    const originalAdd = EventTarget.prototype.addEventListener;
    const originalRemove = EventTarget.prototype.removeEventListener;
    const targets = new WeakMap();
    const counts = Object.create(null);
    let total = 0;
    const captureOf = (options) => options === true || !!(options && options.capture);
    EventTarget.prototype.addEventListener = function qaTrackedAdd(type, listener, options) {
      if (listener) {
        let entries = targets.get(this);
        if (!entries) {
          entries = [];
          targets.set(this, entries);
        }
        const capture = captureOf(options);
        const duplicate = entries.some((entry) => (
          entry.type === type && entry.listener === listener && entry.capture === capture
        ));
        if (!duplicate) {
          entries.push({ type, listener, capture });
          counts[type] = (counts[type] || 0) + 1;
          total += 1;
        }
      }
      return originalAdd.call(this, type, listener, options);
    };
    EventTarget.prototype.removeEventListener = function qaTrackedRemove(type, listener, options) {
      const entries = targets.get(this);
      if (entries && listener) {
        const capture = captureOf(options);
        const index = entries.findIndex((entry) => (
          entry.type === type && entry.listener === listener && entry.capture === capture
        ));
        if (index >= 0) {
          entries.splice(index, 1);
          counts[type] = Math.max(0, (counts[type] || 0) - 1);
          total = Math.max(0, total - 1);
        }
      }
      return originalRemove.call(this, type, listener, options);
    };
    window.__inventoryQaListeners = {
      snapshot: () => ({ total, byType: { ...counts } }),
    };
  });

  const result = {
    schemaVersion: 1,
    kind: 'inventory-delivery-baseline',
    startedAt: new Date().toISOString(),
    baseUrl,
    viewport,
    deviceScaleFactor: 1,
    cameras,
    fixtureBoundary: [
      'The runner bootstrap creates an isolated owned property.',
      'Direct state setup is used only to establish repeatable full-shelf and nine-box visual/performance fixtures.',
      'Laptop entry, box cutting, flap opening, product removal, carrying, and shelf stocking use trusted mouse/keyboard input.',
    ],
    screenshots: [],
    inputActions: [],
    performance: {},
  };

  const requireTruth = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  const capture = async (name, description) => {
    const file = path.join(out, name);
    await page.screenshot({ path: file });
    result.screenshots.push({ file, description });
    return file;
  };
  const press = async (key, description = key) => {
    await page.keyboard.press(key);
    result.inputActions.push({ kind: 'trusted-key', key, description });
  };
  const hold = async (key, durationMs, description) => {
    await page.keyboard.down(key);
    await page.waitForTimeout(durationMs);
    await page.keyboard.up(key);
    result.inputActions.push({ kind: 'trusted-key-hold', key, durationMs, description });
  };
  const clickCenter = async (locator, description) => {
    await locator.waitFor({ state: 'visible', timeout: 20000 });
    const box = await locator.boundingBox();
    requireTruth(box && box.width > 2 && box.height > 2, `${description} has no clickable bounds`);
    const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await page.mouse.move(point.x, point.y, { steps: 4 });
    await page.mouse.down();
    await page.mouse.up();
    result.inputActions.push({ kind: 'trusted-mouse-click', description, point });
  };

  const setCamera = async (pose) => {
    await page.evaluate((camera) => {
      const app = window.__fw;
      const origin = app.scene3d.clubhouse().interior.position;
      const walk = app.scene3d.walk.state;
      walk.x = camera.lx + origin.x;
      walk.z = camera.lz + origin.z;
      walk.yaw = camera.yaw;
      walk.pitch = camera.pitch;
      app.scene3d.walk.clearKeys?.();
    }, pose);
    await page.waitForTimeout(450);
  };

  const acquireLook = async () => {
    const canvas = page.locator('canvas').first();
    await clickCenter(canvas, 'acquire first-person look control');
    const locked = await page.waitForFunction(
      () => document.pointerLockElement === document.querySelector('canvas'),
      null,
      { timeout: 2500 },
    ).then(() => true).catch(() => false);
    result.pointerLockAttempts ||= [];
    result.pointerLockAttempts.push({ locked });
    return locked;
  };

  const listenerSnapshot = () => page.evaluate(() => (
    window.__inventoryQaListeners?.snapshot?.() || { total: null, byType: {} }
  ));

  const measure = async (label, durationMs = 3200) => page.evaluate(async ({ sampleLabel, ms }) => {
    const app = window.__fw;
    const renderer = app.scene3d.renderer;
    const composer = app.scene3d.post.composer;
    const scene = app.scene3d.scene;
    const prompt = document.querySelector('.shop-prompt');
    const laptop = document.querySelector('.laptop-screen');
    const mutationCounts = { prompt: 0, laptop: 0 };
    const observers = [];
    if (prompt) {
      const observer = new MutationObserver((records) => { mutationCounts.prompt += records.length; });
      observer.observe(prompt, { childList: true, subtree: true, characterData: true, attributes: true });
      observers.push(observer);
    }
    if (laptop) {
      const observer = new MutationObserver((records) => { mutationCounts.laptop += records.length; });
      observer.observe(laptop, { childList: true, subtree: true, characterData: true, attributes: true });
      observers.push(observer);
    }

    const materials = new Set();
    const geometries = new Set();
    const textures = new Set();
    let sceneTriangles = 0;
    let sceneObjects = 0;
    let visibleMeshes = 0;
    const textureKeys = [
      'map', 'alphaMap', 'aoMap', 'bumpMap', 'displacementMap', 'emissiveMap',
      'envMap', 'lightMap', 'metalnessMap', 'normalMap', 'roughnessMap',
    ];
    scene.traverse((object) => {
      sceneObjects += 1;
      if (!object.visible || (!object.isMesh && !object.isInstancedMesh)) return;
      visibleMeshes += 1;
      if (object.geometry) {
        geometries.add(object.geometry.uuid);
        const indexCount = object.geometry.index?.count;
        const vertexCount = object.geometry.attributes?.position?.count || 0;
        const triangles = (indexCount || vertexCount) / 3;
        sceneTriangles += triangles * (object.isInstancedMesh ? object.count : 1);
      }
      const list = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of list) {
        if (!material) continue;
        materials.add(material.uuid);
        for (const key of textureKeys) {
          if (material[key]?.isTexture) textures.add(material[key]);
        }
      }
    });
    let textureBytesEstimate = 0;
    for (const texture of textures) {
      const image = texture.image;
      const width = Number(image?.videoWidth || image?.naturalWidth || image?.width || 0);
      const height = Number(image?.videoHeight || image?.naturalHeight || image?.height || 0);
      if (width > 0 && height > 0) textureBytesEstimate += width * height * 4 * (4 / 3);
    }

    const frameTimes = [];
    const drawCalls = [];
    const renderedTriangles = [];
    const originalComposerRender = composer.render;
    const originalAutoReset = renderer.info.autoReset;
    renderer.info.autoReset = false;
    composer.render = function inventoryQaMeasuredRender(...args) {
      renderer.info.reset();
      const value = originalComposerRender.apply(this, args);
      drawCalls.push(renderer.info.render.calls || 0);
      renderedTriangles.push(renderer.info.render.triangles || 0);
      return value;
    };
    const start = performance.now();
    let previous = null;
    try {
      await new Promise((resolve) => {
        const onFrame = (time) => {
          if (previous != null) frameTimes.push(time - previous);
          previous = time;
          if (time - start >= ms) resolve();
          else requestAnimationFrame(onFrame);
        };
        requestAnimationFrame(onFrame);
      });
    } finally {
      composer.render = originalComposerRender;
      renderer.info.reset();
      renderer.info.autoReset = originalAutoReset;
    }
    observers.forEach((observer) => observer.disconnect());

    const sorted = frameTimes.slice().sort((a, b) => a - b);
    const mean = frameTimes.reduce((sum, value) => sum + value, 0) / Math.max(1, frameTimes.length);
    const worstCount = Math.max(1, Math.ceil(sorted.length * 0.01));
    const worstOnePercent = sorted.slice(-worstCount);
    const lowMean = worstOnePercent.reduce((sum, value) => sum + value, 0) / worstOnePercent.length;
    const average = (values) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
    const heapBytes = performance.memory?.usedJSHeapSize ?? null;
    const listeners = window.__inventoryQaListeners?.snapshot?.() || { total: null, byType: {} };
    return {
      label: sampleLabel,
      durationMs: +(performance.now() - start).toFixed(2),
      frameSamples: frameTimes.length,
      rendererFrameSamples: drawCalls.length,
      averageFps: +(1000 / mean).toFixed(2),
      onePercentLowFps: +(1000 / lowMean).toFixed(2),
      worstFrameMs: +Math.max(...frameTimes).toFixed(2),
      drawCalls: +average(drawCalls).toFixed(2),
      renderedTriangles: +average(renderedTriangles).toFixed(2),
      sceneTriangles: Math.round(sceneTriangles),
      materialCount: materials.size,
      textureCount: textures.size,
      textureMemoryEstimateMiB: +(textureBytesEstimate / 1048576).toFixed(2),
      javascriptHeapMiB: heapBytes == null ? null : +(heapBytes / 1048576).toFixed(2),
      activeEventListeners: listeners,
      uiUpdatesPerSecond: {
        prompt: +(mutationCounts.prompt / (ms / 1000)).toFixed(2),
        laptop: +(mutationCounts.laptop / (ms / 1000)).toFixed(2),
      },
      rendererResources: {
        geometries: renderer.info.memory.geometries,
        textures: renderer.info.memory.textures,
        programs: renderer.info.programs?.length ?? null,
      },
      sceneResources: { objects: sceneObjects, visibleMeshes, geometries: geometries.size },
      sources: {
        frame: 'requestAnimationFrame deltas in Chromium at the fixed player camera',
        renderer: 'THREE.WebGLRenderer.info sampled once per animation frame',
        scene: 'visible Three.js scene traversal; instanced geometry multiplied by instance count',
        textureMemory: 'estimated RGBA8 bytes from unique material texture dimensions with 4/3 mip allowance',
        heap: 'performance.memory.usedJSHeapSize',
        listeners: 'EventTarget add/remove listener accounting installed before application boot',
        uiFrequency: 'MutationObserver records per second for shop prompt and laptop screen',
      },
    };
  }, { sampleLabel: label, ms: durationMs });

  await page.setViewportSize(viewport);
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  const continueButton = page.getByRole('button', { name: 'Continue', exact: true });
  await continueButton.waitFor({ state: 'visible', timeout: 30000 });
  requireTruth(await continueButton.isEnabled(), 'Continue is disabled; run with --bootstrap');
  await clickCenter(continueButton, 'continue isolated fixture');
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
  }, null, { timeout: 90000 });
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1200);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('HeapProfiler.enable');
  const collectHeap = async (label) => {
    await cdp.send('HeapProfiler.collectGarbage');
    await page.waitForTimeout(100);
    return {
      label,
      ...(await page.evaluate(() => ({
        usedMiB: performance.memory?.usedJSHeapSize == null
          ? null
          : +(performance.memory.usedJSHeapSize / 1048576).toFixed(2),
        totalMiB: performance.memory?.totalJSHeapSize == null
          ? null
          : +(performance.memory.totalJSHeapSize / 1048576).toFixed(2),
      }))),
    };
  };

  await page.evaluate(() => {
    const app = window.__fw;
    app.speedIdx = 0;
    app.state.cash = 250000;
    app.empire.cash = 250000;
    app.state.shop.unlockedTier = 3;
    if (app.state.weather) app.state.weather.locked = true;
    const day = Math.floor(app.state.clock.minutes / 1440) * 1440;
    app.state.clock.minutes = day + 14 * 60;
    app.empire.clockMinutes = app.state.clock.minutes;
    app.scene3d.applyTimeWeather?.(14 * 60, app.state.weather);
    const clubhouse = app.scene3d.clubhouse();
    clubhouse.setOrganicWalkins?.(false);
    clubhouse.clearWalkins?.();
  });
  await acquireLook();

  // The first visual baseline is the existing laptop surface reached through normal controls.
  await setCamera(cameras.laptop);
  await page.waitForFunction(() => /laptop/i.test(document.querySelector('.shop-prompt')?.textContent || ''), null, { timeout: 10000 });
  await press('e', 'open the physical laptop');
  await page.waitForFunction(() => window.__fw.laptopOpen === true, null, { timeout: 10000 });
  const ordersNav = page.locator('.lt-navbtn').filter({ hasText: 'Orders' }).first();
  await clickCenter(ordersNav, 'open Orders on the physical laptop');
  await page.waitForTimeout(500);
  await capture('01-laptop-orders.png', 'Existing laptop Orders view reached with normal player input.');
  await press('Escape', 'leave the physical laptop');
  await page.waitForFunction(() => window.__fw.laptopOpen === false, null, { timeout: 10000 });
  await acquireLook();

  // Highest expected receiving-pad and retail-shelf fixture for the matched performance baseline.
  result.stressFixture = await page.evaluate(async () => {
    const delivery = await import('/src/sim/deliveries.js');
    const lifecycle = await import('/src/sim/inventoryLifecycle.js');
    const items = await import('/src/data/shopItems.js');
    const shop = await import('/src/sim/shop.js');
    const app = window.__fw;
    const state = app.state;
    delivery.ensureDeliveries(state);
    lifecycle.ensureInventoryLifecycle(state);
    state.shop.carry = null;
    for (const sku of items.SHOP_CATALOG) {
      if (state.shop.inventory[sku.id] && !['supplies', 'decor'].includes(sku.cat)) {
        const inventory = state.shop.inventory[sku.id];
        const target = shop.shelfCapacity(sku);
        const added = Math.max(0, target - inventory.shelf);
        if (added > 0) {
          const adopted = lifecycle.adoptExternalInventory(state, {
            skuId: sku.id,
            quantity: added,
            stage: lifecycle.INVENTORY_STAGE.SHELF,
            note: 'Matched fully-stocked performance fixture',
          });
          if (!adopted.ok) throw new Error(`Could not stock ${sku.id}: ${adopted.reason}`);
          inventory.shelf += added;
        }
      }
    }
    const orders = [
      ['balls1', 12], ['polo1', 8], ['driver1', 2], ['bag1', 1], ['range2', 4],
      ['tees1', 12], ['shoe1', 4], ['vac1', 1], ['light1', 1],
    ];
    const made = [];
    const orderIds = [];
    const arrivalStart = performance.now();
    for (const [skuId, qty] of orders) {
      const submitted = lifecycle.submitPurchaseOrders(state, {
        idempotencyKey: `performance-${skuId}-${qty}`,
        lines: [{ skuId, quantity: qty }],
      });
      if (!submitted.ok) throw new Error(`Could not order ${skuId}: ${submitted.reason}`);
      for (const order of submitted.orders) {
        orderIds.push(order.id);
        made.push(...delivery.arriveOrder(state, order));
      }
    }
    app.scene3d.clubhouse().rebuildStock();
    app.scene3d.clubhouse().rebuildBoxes();
    return {
      boxes: made.length,
      boxIds: made.map((box) => box.id),
      orderIds,
      arrivalAndRebuildMs: +(performance.now() - arrivalStart).toFixed(2),
      skus: orders.map(([skuId, qty]) => ({ skuId, qty })),
      fullRetailLines: items.SHOP_CATALOG.filter((sku) => !['supplies', 'decor'].includes(sku.cat)).length,
    };
  });
  requireTruth(result.stressFixture.boxes === 9, `expected nine visible boxes, found ${result.stressFixture.boxes}`);
  await setCamera(cameras.receiving);
  await capture('02-receiving-nine-boxes.png', 'Nine simultaneous delivery boxes at the fixed receiving camera.');
  await page.waitForTimeout(1800);
  result.heapBeforeRepeatedInteractions = await collectHeap('nine-box stress state before repeated interactions');
  result.performance.stress = await measure('nine-boxes-and-fully-stocked-shelves');
  result.listenersBeforeRepeatedInteractions = await listenerSnapshot();

  // A single deterministic box remains for the normal-controls opening and stocking path.
  result.heroFixture = await page.evaluate(async () => {
    const delivery = await import('/src/sim/deliveries.js');
    const lifecycle = await import('/src/sim/inventoryLifecycle.js');
    const app = window.__fw;
    const state = app.state;
    state.shop.carry = null;
    const hero = delivery.boxesOf(state).find((box) => box.skuId === 'balls1' && box.qty > 0);
    if (!hero) throw new Error('The matched stress fixture did not produce a balls1 hero carton.');
    const shelfUnits = state.shop.inventory.balls1.shelf;
    if (shelfUnits > 0) {
      const moved = lifecycle.moveInventory(state, {
        from: lifecycle.INVENTORY_STAGE.SHELF,
        to: lifecycle.INVENTORY_STAGE.RESERVE,
        skuId: 'balls1',
        quantity: shelfUnits,
        reason: 'Open shelf capacity for normal-control performance route',
      });
      if (!moved.ok) throw new Error(`Could not open hero shelf capacity: ${moved.reason}`);
      state.shop.inventory.balls1.shelf = 0;
      state.shop.inventory.balls1.back += shelfUnits;
    }
    delivery.pickUpBox(state, hero.id);
    delivery.putDownBox(state, hero.id, { x: 7.4, z: -5.2, ry: 0 });
    app.scene3d.clubhouse().rebuildStock();
    app.scene3d.clubhouse().rebuildBoxes();
    return { boxId: hero.id, skuId: hero.skuId, qty: hero.qty, loc: hero.loc, shelfUnitsMovedToReserve: shelfUnits };
  });

  await setCamera(cameras.sealedBox);
  await page.waitForFunction(
    () => /(box|case|carton)/i.test(window.__fw.scene3d.walk.getFocusLabel?.() || ''),
    null,
    { timeout: 10000 },
  );
  result.sealedFocus = await page.evaluate(() => ({
    label: window.__fw.scene3d.walk.getFocusLabel?.(),
    tool: window.__fw.scene3d.walk.getTool?.(),
  }));
  await capture('03-sealed-box-cutter.png', 'Sealed hero case and automatically equipped cutter from player camera.');
  await hold('e', 1800, 'cut the carton tape along the interaction seam');
  await page.waitForFunction(
    () => /open a flap/i.test(window.__fw.scene3d.walk.getFocusLabel?.() || ''),
    null,
    { timeout: 5000 },
  );
  for (let flap = 0; flap < 3; flap += 1) {
    const open = await page.evaluate(async (boxId) => {
      const delivery = await import('/src/sim/deliveries.js');
      const box = delivery.boxesOf(window.__fw.state).find((entry) => entry.id === boxId);
      return !!box && delivery.flapsOpen(box);
    }, result.heroFixture.boxId);
    if (open) break;
    await press('e', `open carton flap ${flap + 1}`);
    await page.waitForTimeout(350);
  }
  result.openState = await page.evaluate(async (boxId) => {
    const delivery = await import('/src/sim/deliveries.js');
    const box = delivery.boxesOf(window.__fw.state).find((entry) => entry.id === boxId);
    return box ? { tape: box.tape, flaps: box.flaps, qty: box.qty, state: delivery.boxState(box) } : null;
  }, result.heroFixture.boxId);
  await setCamera(cameras.openBox);
  await capture('04-open-box-visible-contents.png', 'Opened carton with current visible product contents.');
  await press('e', 'take a product armful from the opened box');
  await page.waitForTimeout(350);
  result.carryState = await page.evaluate(async () => {
    const stocking = await import('/src/sim/stocking.js');
    return stocking.carriedGoods(window.__fw.state);
  });
  requireTruth(result.carryState?.skuId === 'balls1' && result.carryState?.qty > 0, 'normal-control unboxing did not put product in the player’s arms');
  await capture('05-product-carry.png', 'Product armful carried from the opened carton.');
  await setCamera(cameras.shelf);
  await page.waitForFunction(
    () => /(ball|dozen|display)/i.test(window.__fw.scene3d.walk.getFocusLabel?.() || ''),
    null,
    { timeout: 10000 },
  );
  const shelfBefore = await page.evaluate(() => window.__fw.state.shop.inventory.balls1.shelf);
  await hold('e', 1100, 'stock the compatible ball display one unit at a time');
  await page.waitForTimeout(350);
  const shelfAfter = await page.evaluate(() => window.__fw.state.shop.inventory.balls1.shelf);
  result.stocking = { shelfBefore, shelfAfter, moved: shelfAfter - shelfBefore };
  requireTruth(result.stocking.moved > 0, 'normal-control shelf stocking did not move product');
  await capture('06-stocked-shelf.png', 'Compatible shelf after normal-control partial stocking.');

  // Repeated open/close cycles expose listener and UI-update growth without mutating inventory.
  for (let index = 0; index < 5; index += 1) {
    await setCamera(cameras.laptop);
    await press('e', `repeated laptop entry ${index + 1}`);
    await page.waitForFunction(() => window.__fw.laptopOpen === true, null, { timeout: 8000 });
    await press('Escape', `repeated laptop exit ${index + 1}`);
    await page.waitForFunction(() => window.__fw.laptopOpen === false, null, { timeout: 8000 });
  }
  result.listenersAfterRepeatedInteractions = await listenerSnapshot();
  result.listenerGrowth = (
    result.listenersAfterRepeatedInteractions.total - result.listenersBeforeRepeatedInteractions.total
  );
  result.heapAfterRepeatedInteractions = await collectHeap('after five laptop cycles and one physical box lifecycle');
  result.postGcHeapGrowthMiB = result.heapBeforeRepeatedInteractions.usedMiB == null
    || result.heapAfterRepeatedInteractions.usedMiB == null
    ? null
    : +(result.heapAfterRepeatedInteractions.usedMiB - result.heapBeforeRepeatedInteractions.usedMiB).toFixed(2);
  // Match the clean-main idle comparison: its legacy fixture deleted the
  // eight non-hero pad cartons before this camera sample. Preserve those exact
  // conserved boxes, but park them in the bounded interior fallback so the
  // same exterior camera has no active prop/prompt in either build.
  result.idleFixture = await page.evaluate((heroId) => {
    const app = window.__fw;
    const parked = [];
    const boxes = app.state.shop.deliveries.boxes;
    for (const box of boxes) {
      if (box.id === heroId) continue;
      box.loc = 'receiving-fallback';
      box.currentLocation = 'receiving-fallback';
      box.receivingSlot = parked.length;
      box.surface = null;
      box.surfaceSlot = null;
      delete box.x;
      delete box.y;
      delete box.z;
      delete box.ry;
      parked.push(box.id);
    }
    app.scene3d.clubhouse().rebuildBoxes();
    return { parkedBoxIds: parked, retainedHeroId: heroId };
  }, result.heroFixture.boxId);
  await setCamera(cameras.receiving);
  result.performance.idleAfterInteractions = await measure('fixed-camera-after-five-laptop-cycles');

  result.serialization = await page.evaluate(async () => {
    const stateModule = await import('/src/sim/state.js');
    const state = window.__fw.state;
    const samples = [];
    let bytes = 0;
    for (let index = 0; index < 100; index += 1) {
      const start = performance.now();
      const snapshot = stateModule.serialize(state);
      samples.push(performance.now() - start);
      bytes = new TextEncoder().encode(snapshot).byteLength;
    }
    samples.sort((a, b) => a - b);
    const averageMs = samples.reduce((sum, value) => sum + value, 0) / samples.length;
    return {
      iterations: samples.length,
      bytes,
      averageMs: +averageMs.toFixed(3),
      p95Ms: +samples[Math.floor(samples.length * 0.95)].toFixed(3),
      worstMs: +samples[samples.length - 1].toFixed(3),
      source: '100 calls to src/sim/state.js serialize() on the full stress fixture',
    };
  });

  result.worldState = await page.evaluate(async () => {
    const delivery = await import('/src/sim/deliveries.js');
    const lifecycle = await import('/src/sim/inventoryLifecycle.js');
    const state = window.__fw.state;
    const reconciliation = lifecycle.reconcileInventory(state, { qa: true, context: 'performance-final' });
    return {
      orders: state.shop.orders.length,
      shipments: delivery.shipmentsOf(state).length,
      boxes: delivery.boxesOf(state).map((box) => ({
        id: box.id, orderId: box.orderId, skuId: box.skuId, qty: box.qty,
        cap: box.cap, loc: box.loc, tape: box.tape, flaps: box.flaps, flat: box.flat,
      })),
      carry: state.shop.carry,
      ballInventory: { ...state.shop.inventory.balls1 },
      held: structuredClone(state.shop.held || []),
      cash: state.cash,
      reconciled: reconciliation.ok,
      discrepancies: reconciliation.discrepancies,
    };
  });
  result.diagnostics = diagnostics;
  result.diagnosticsByKind = diagnosticsByKind;
  result.functionalChecks = {
    exactViewport: (await page.viewportSize()).width === viewport.width
      && (await page.viewportSize()).height === viewport.height,
    normalLaptopEntry: result.inputActions.some((entry) => entry.description === 'open the physical laptop'),
    sealedBoxFocused: /(box|case|carton)/i.test(result.sealedFocus?.label || ''),
    cutterVisiblePath: result.sealedFocus?.tool === 'boxcutter',
    tapeCut: result.openState?.tape >= 1,
    bothFlapsOpen: result.openState?.flaps?.every((value) => value >= 1),
    visibleContentsRemain: result.openState?.qty > 0,
    productCarried: result.carryState?.skuId === 'balls1' && result.carryState?.qty > 0,
    productStocked: result.stocking.moved > 0,
    inventoryReconciled: result.worldState.reconciled,
  };
  result.diagnosticChecks = {
    listenerGrowthBounded: result.listenerGrowth === 0,
    noConsoleErrors: diagnosticsByKind.consoleError === 0,
    noPageErrors: diagnosticsByKind.pageError === 0,
    noFailedRequests: diagnosticsByKind.requestFailed === 0,
  };
  result.ok = Object.values(result.functionalChecks).every(Boolean);
  result.acceptanceReady = result.ok && Object.values(result.diagnosticChecks).every(Boolean);
  result.completedAt = new Date().toISOString();
  await cdp.detach();
  return result;
}
