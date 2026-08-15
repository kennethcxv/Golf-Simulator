async (page) => {
  // Cross-category delivery-carton lifecycle proof for the retail lines that
  // do not have a dedicated browser acceptance route elsewhere.
  //
  // DOCUMENTED QA FIXTURE BOUNDARY
  // --------------------------------
  // The fixture resets only the five target inventories, clears unrelated
  // customers/clutter, creates each shipment through the production
  // planShipment -> arriveOrder path, and initially sets its sealed carton on
  // one validated stockroom-floor target. It does not edit tape, flaps,
  // contents, carry, shelf counts, flattening, or disposal state after arrival.
  //
  // Every player-visible transition is then normal input: [X] picks up the
  // closed carton, [E] commits its placement, LMB is dragged along the live
  // authored CUT_PATH, [E] opens/takes/flattens/carries/recycles, and held [E]
  // stocks the physical fixture. A held [E] at an incompatible fixture proves
  // that no invalid stock route is exposed and no quantity moves.

  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = path.resolve(process.env.QA_REPO_ROOT || process.cwd());
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const phase = String(process.env.SKU_STOCK_QA_PHASE || 'after').toLowerCase();
  const iteration = Math.max(1, Number.parseInt(process.env.SKU_STOCK_QA_ITERATION || '1', 10));
  const out = path.join(
    repo,
    'qa',
    'box_system_master',
    'sku_stock_lifecycle',
    phase,
    `iteration-${String(iteration).padStart(2, '0')}`,
  );
  fs.mkdirSync(out, { recursive: true });
  const lifecycleMediaOut = path.join(out, 'box-lifecycle-with-audio.webm');

  const diagnostics = [];
  const diagnosticCounts = {
    consoleError: 0,
    consoleWarning: 0,
    pageError: 0,
    requestFailed: 0,
  };
  let measuredDocumentReady = false;
  const noteDiagnostic = (kind, detail) => {
    diagnosticCounts[kind] += 1;
    if (diagnostics.length < 150) diagnostics.push({ kind, detail: String(detail), atMs: Date.now() });
  };
  page.on('console', (message) => {
    if (message.type() === 'error') noteDiagnostic('consoleError', message.text());
    if (message.type() === 'warning') noteDiagnostic('consoleWarning', message.text());
  });
  page.on('pageerror', (error) => noteDiagnostic('pageError', error.message));
  page.on('requestfailed', (request) => {
    const failure = request.failure()?.errorText || 'unknown';
    if (!measuredDocumentReady && /ERR_ABORTED/i.test(failure)) return;
    noteDiagnostic('requestFailed', `${request.url()} (${failure})`);
  });
  page.on('response', (response) => {
    if (response.status() >= 400) noteDiagnostic('requestFailed', `${response.url()} (HTTP ${response.status()})`);
  });

  const stockroomFixtureSpot = Object.freeze({ x: 8.25, z: -1.70, ry: 0 });
  const recyclingCamera = Object.freeze({ x: 8.15, z: 1.30, yaw: -Math.PI / 2, pitch: -0.40 });
  const cases = Object.freeze([
    {
      skuId: 'balls1', expectedQty: 12, expectedBoxKind: 'ballcase', expectedLayout: 'BALL12',
      fixtureId: 'shelf_balls', fixtureTitle: 'Ball wall', fixtureCamera: { x: -7.90, z: -4.70, yaw: 0, pitch: -0.45 },
      wrongFixtureId: 'shelf_acc', wrongFixtureTitle: 'Accessories', wrongCamera: { x: -3.70, z: -4.70, yaw: 0, pitch: -0.20 },
    },
    {
      skuId: 'tees1', expectedQty: 12, expectedBoxKind: 'carton', expectedLayout: 'ACCESSORY_CARD12',
      fixtureId: 'shelf_acc', fixtureTitle: 'Accessories', fixtureCamera: { x: -4.70, z: -4.70, yaw: 0, pitch: -0.32 },
      wrongFixtureId: 'shelf_balls', wrongFixtureTitle: 'Ball wall', wrongCamera: { x: -6.90, z: -4.70, yaw: 0, pitch: -0.20 },
    },
    {
      skuId: 'shoe1', expectedQty: 4, expectedBoxKind: 'shoebox', expectedLayout: 'SHOE4',
      fixtureId: 'shoerack', fixtureTitle: 'Shoe wall', fixtureCamera: { x: 3.62, z: -1.25, yaw: -Math.PI / 2, pitch: -0.52 },
      wrongFixtureId: 'bagstand', wrongFixtureTitle: 'Bag platforms', wrongCamera: { x: 2.20, z: -1.18, yaw: 0, pitch: -0.18 },
    },
    {
      skuId: 'bag1', expectedQty: 1, expectedBoxKind: 'bagcarton', expectedLayout: 'BAG1',
      fixtureId: 'bagstand', fixtureTitle: 'Bag platforms', fixtureCamera: { x: 1.60, z: -1.10, yaw: 0, pitch: -0.52 },
      wrongFixtureId: 'shoerack', wrongFixtureTitle: 'Shoe wall', wrongCamera: { x: 3.62, z: -0.60, yaw: -Math.PI / 2, pitch: -0.16 },
    },
    {
      skuId: 'water1', expectedQty: 12, expectedBoxKind: 'provisions', expectedLayout: 'DRINK12',
      fixtureId: 'snackrack', fixtureTitle: 'Grab & Go', fixtureCamera: { x: -6.60, z: 4.55, yaw: Math.PI, pitch: -0.52 },
      wrongFixtureId: 'table_polos', wrongFixtureTitle: 'Apparel table', wrongCamera: { x: -5.90, z: 2.05, yaw: 0, pitch: -0.35 },
    },
  ]);
  const targetSkuIds = cases.map((entry) => entry.skuId);
  const fixtureInjection = Object.freeze([
    'The --bootstrap save is replaced with a clean relaxed-mode property by the normal QA runner.',
    'The isolated property wallet is fixed at $5,000 so the player-facing HUD remains representative.',
    'Target SKU shelf/back counts are reset to zero before the measured routes.',
    'Delivery arrays are cleared once before the first route; unique box/order IDs remain monotonic across all five cases.',
    'Each sealed carton is created with production planShipment and arriveOrder, then initially placed through pickUpBox/putDownBox on one validated stockroom-floor target.',
    'Organic walk-ins, renovation grime/clutter, weather, clock, notifications, and the player camera are fixed for repeatable evidence.',
    'No tape, flap, carton quantity, carried-goods, stocked-goods, flattening, recycling, or disposal state is injected after arrival.',
  ]);

  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(600);
  await page.goto(baseUrl);
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.waitForTimeout(900);
  await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
  }, null, { timeout: 90000 });
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.()?.assetsReady?.(), null, { timeout: 90000 });
  await page.waitForTimeout(1200);
  measuredDocumentReady = true;

  await page.evaluate(async (skuIds) => {
    const app = window.__fw;
    const state = app.state;
    const D = await import(new URL('src/sim/deliveries.js', document.baseURI).href);
    D.ensureDeliveries(state);
    // Keep the HUD believable in visual evidence while leaving every stock,
    // carton and lifecycle transition under the production route below.
    app.empire.cash = 5000;
    state.cash = 5000;
    app.speedIdx = 0;
    app.scene3d.walk.clearKeys?.();
    const day = Math.floor(state.clock.minutes / 1440) * 1440;
    state.clock.minutes = day + 14 * 60;
    if (state.weather) state.weather.locked = true;
    app.scene3d.applyTimeWeather?.(14 * 60, state.weather);
    const delivery = state.shop.deliveries;
    delivery.boxes = [];
    delivery.shipments = [];
    delivery.arrivedOrderIds = [];
    delivery.nextBoxId = 970001;
    delivery.trash = 0;
    delivery.recycled = 0;
    state.shop.carry = null;
    for (const skuId of skuIds) {
      if (!state.shop.inventory[skuId]) state.shop.inventory[skuId] = { shelf: 0, back: 0 };
      state.shop.inventory[skuId].shelf = 0;
      state.shop.inventory[skuId].back = 0;
    }
    if (state.shop.reno) {
      state.shop.reno.grime?.fill?.(0);
      state.shop.reno.clutter = [];
    }
    if (state.notifications) {
      state.notifications.items = [];
      state.notifications.nextId = 1;
    }
    const clubhouse = app.scene3d.clubhouse();
    clubhouse.setOrganicWalkins?.(false);
    clubhouse.clearWalkins?.();
    clubhouse.rebuildReno?.();
    clubhouse.refreshCondition?.();
    clubhouse.rebuildStock?.();
    clubhouse.rebuildBoxes();
  }, targetSkuIds);

  const viewport = await page.evaluate(() => ({
    width: innerWidth,
    height: innerHeight,
    dpr: devicePixelRatio,
  }));
  if (viewport.width !== 1600 || viewport.height !== 900 || Math.abs(viewport.dpr - 1) > 0.001) {
    throw new Error(`Fixed viewport contract failed: ${JSON.stringify(viewport)}.`);
  }

  const canvas = page.locator('canvas').first();
  await canvas.waitFor({ state: 'visible', timeout: 30000 });
  await page.bringToFront();
  await page.mouse.move(800, 450);
  await canvas.click({ position: { x: 800, y: 450 }, force: true });
  await page.waitForFunction(
    (target) => document.pointerLockElement === target,
    await canvas.elementHandle(),
    { timeout: 7000 },
  );

  await page.evaluate(() => {
    const trace = {
      keyDown: {}, keyUp: {}, pointerDown: 0, pointerUp: 0,
      heldLmbMoves: 0, lmbHeld: false,
    };
    const increment = (bucket, key) => { bucket[key] = (bucket[key] || 0) + 1; };
    document.addEventListener('keydown', (event) => increment(trace.keyDown, event.key.toLowerCase()), true);
    document.addEventListener('keyup', (event) => increment(trace.keyUp, event.key.toLowerCase()), true);
    document.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      trace.pointerDown += 1;
      trace.lmbHeld = true;
    }, true);
    window.addEventListener('pointerup', (event) => {
      if (event.button !== 0) return;
      trace.pointerUp += 1;
      trace.lmbHeld = false;
    }, true);
    document.addEventListener('mousemove', () => {
      if (trace.lmbHeld) trace.heldLmbMoves += 1;
    }, true);
    window.__skuStockLifecycleInputTrace = trace;
  });

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
    await page.waitForTimeout(260);
  }

  async function inputTrace() {
    return page.evaluate(() => JSON.parse(JSON.stringify(window.__skuStockLifecycleInputTrace)));
  }

  async function startLifecycleMediaCapture() {
    return page.evaluate(async () => {
      const audio = window.__fw?.audio;
      if (!audio || typeof audio.startCapture !== 'function') {
        throw new Error('The production audio/video capture API is unavailable.');
      }
      // The four blade cues left with the box cutter (2026-07-30); the three
      // carton presses own material-distinct cues instead.
      const cueNames = [
        'boxup', 'boxdown', 'boxTapeTear', 'boxFlapFold', 'boxContentsShift',
        'flap', 'itemRemoval', 'stock', 'fullShelf', 'boxFlatten', 'disposal',
      ];
      window.__boxLifecycleAudioCueTrace = [];
      for (const name of cueNames) {
        if (typeof audio[name] !== 'function') {
          throw new Error(`Required production audio cue ${name} is unavailable.`);
        }
        const original = audio[name].bind(audio);
        audio[name] = (...args) => {
          window.__boxLifecycleAudioCueTrace.push({ name, atMs: performance.now() });
          return original(...args);
        };
      }
      audio.setMuted(false);
      audio.setVolume(0.8);
      const started = await audio.startCapture(document.getElementById('game'), { fps: 30 });
      if (started.audioTracks < 1 || started.videoTracks < 1
        || started.audioContextState !== 'running') {
        throw new Error(`Lifecycle capture did not start with live audio/video: ${JSON.stringify(started)}.`);
      }
      return started;
    });
  }

  async function stopLifecycleMediaCapture(started) {
    const downloadName = path.basename(lifecycleMediaOut);
    const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
    const stopPromise = page.evaluate((name) => (
      window.__fw.audio.stopCapture({ downloadName: name })
    ), downloadName);
    const [download, stopped] = await Promise.all([downloadPromise, stopPromise]);
    const failure = await download.failure();
    if (failure) throw new Error(`Lifecycle media download failed: ${failure}.`);
    await download.saveAs(lifecycleMediaOut);
    const cueTrace = await page.evaluate(() => (
      JSON.parse(JSON.stringify(window.__boxLifecycleAudioCueTrace || []))
    ));
    return {
      output: lifecycleMediaOut,
      bytesOnDisk: fs.statSync(lifecycleMediaOut).size,
      cueTrace,
      ...started,
      ...stopped,
    };
  }

  async function focusInfo() {
    return page.evaluate(() => ({
      label: window.__fw.scene3d.walk.getFocusLabel?.() || null,
      tool: window.__fw.scene3d.walk.getTool?.() || null,
      pointerLocked: document.pointerLockElement === document.querySelector('canvas'),
    }));
  }

  async function waitForFocus(pattern, timeout = 7000) {
    await page.waitForFunction(({ source, flags }) => {
      const label = window.__fw?.scene3d?.walk?.getFocusLabel?.() || '';
      return new RegExp(source, flags).test(label);
    }, { source: pattern.source, flags: pattern.flags }, { timeout });
    return focusInfo();
  }

  async function boxSnapshot(boxId) {
    return page.evaluate(async (id) => {
      const D = await import(new URL('src/sim/deliveries.js', document.baseURI).href);
      const box = D.findBox(window.__fw.state, id);
      if (!box) return { exists: false, lifecycle: 'DISCARDED' };
      return {
        exists: true,
        id: box.id,
        skuId: box.skuId,
        boxKind: box.box,
        layoutId: box.layoutId,
        modelId: box.modelId,
        loc: box.loc,
        surfaceId: box.surfaceId || null,
        x: box.x ?? null,
        z: box.z ?? null,
        ry: box.ry ?? null,
        qty: box.qty,
        cap: box.cap,
        state: D.boxState(box),
        lifecycle: D.boxLifecycleState(box),
        cutProgress: box.cutProgress ?? box.tape ?? 0,
        tapeSegments: { ...(box.tapeSegments || {}) },
        flapProgress: [...(box.flapProgress || box.flaps || [])],
        openingProgress: box.openingProgress || 0,
        flattenProgress: box.flattenProgress || 0,
        flat: !!box.flat,
      };
    }, boxId);
  }

  async function waitForBox(boxId, condition, timeout = 7000) {
    await page.waitForFunction(({ id, wanted }) => {
      const box = window.__fw?.state?.shop?.deliveries?.boxes?.find((entry) => entry.id === id);
      if (wanted === 'gone') return !box;
      if (!box) return false;
      if (wanted === 'world') return box.loc === 'world';
      if (wanted === 'carried') return box.loc === 'carried';
      if (wanted === 'cut') return (box.cutProgress ?? box.tape ?? 0) >= 0.999;
      if (wanted === 'open') return Array.isArray(box.flapProgress)
        && box.flapProgress.length === 4
        && box.flapProgress.every((value) => value >= 0.999);
      if (wanted === 'flat') return box.flat && (box.flattenProgress || 0) >= 0.999;
      if (wanted.startsWith('qty:')) return box.qty === Number(wanted.slice(4));
      return false;
    }, { id: boxId, wanted: condition }, { timeout });
  }

  async function quantitySnapshot(skuId, boxId, step) {
    return page.evaluate(async ({ sku, id, label }) => {
      const { capacityOf } = await import(new URL('src/data/fixtureSlots.js', document.baseURI).href);
      const state = window.__fw.state;
      const box = state.shop.deliveries.boxes.find((entry) => entry.id === id);
      const carry = state.shop.carry?.skuId === sku ? state.shop.carry.qty : 0;
      const inventory = state.shop.inventory[sku] || { shelf: 0, back: 0 };
      return {
        step: label,
        box: box?.qty || 0,
        carry,
        shelf: inventory.shelf,
        back: inventory.back,
        total: (box?.qty || 0) + carry + inventory.shelf + inventory.back,
        shelfCapacity: capacityOf(sku),
      };
    }, { sku: skuId, id: boxId, label: step });
  }

  async function allTargetInventory() {
    return page.evaluate((skuIds) => Object.fromEntries(skuIds.map((skuId) => [
      skuId,
      {
        shelf: window.__fw.state.shop.inventory[skuId]?.shelf || 0,
        back: window.__fw.state.shop.inventory[skuId]?.back || 0,
      },
    ])), targetSkuIds);
  }

  async function stageExactCase(spec, index) {
    const staged = await page.evaluate(async ({ skuId, orderId, spot }) => {
      const D = await import(new URL('src/sim/deliveries.js', document.baseURI).href);
      const B = await import(new URL('src/data/boxes.js', document.baseURI).href);
      const I = await import(new URL('src/data/shopItems.js', document.baseURI).href);
      const P = await import(new URL('src/data/productPackaging.js', document.baseURI).href);
      const state = window.__fw.state;
      const sku = I.skuById(skuId);
      const contract = P.productPackagingFor(skuId);
      const manifest = B.planShipment(sku, contract.unitsPerBox);
      const [box] = D.arriveOrder(state, {
        id: orderId,
        skuId,
        qty: contract.unitsPerBox,
        manifest,
      });
      if (!box) throw new Error(`Production arrival rejected exact QA shipment ${orderId}/${skuId}.`);
      const picked = D.pickUpBox(state, box.id);
      if (!picked.ok) throw new Error(`Fixture could not pick up ${skuId}: ${picked.reason}`);
      const placed = D.putDownBox(state, box.id, spot);
      if (!placed.ok) throw new Error(`Fixture could not place ${skuId}: ${placed.reason}`);
      window.__fw.scene3d.clubhouse().rebuildBoxes();
      return {
        id: box.id,
        orderId,
        skuId,
        name: sku.name,
        boxKind: box.box,
        layoutId: box.layoutId,
        modelId: box.modelId,
        qty: box.qty,
        cap: box.cap,
        manifest,
        packaging: {
          unitsPerBox: contract.unitsPerBox,
          allowedFixtures: [...contract.allowedStocking.fixtureIds],
          allowedCategory: contract.allowedStocking.category,
        },
      };
    }, { skuId: spec.skuId, orderId: 971000 + index, spot: stockroomFixtureSpot });

    await page.waitForFunction(({ id, qty, layoutId }) => {
      const root = window.__fw?.scene3d?.scene?.getObjectByName(`DeliveryBox_${id}`);
      if (!root || !root.getObjectByName('CUT_PATH')
        || !root.getObjectByName(`CONTENT_SLOT_${layoutId}_01`)) return false;
      const names = [];
      root.traverse((object) => { if (object.name) names.push(object.name); });
      return names.filter((name) => /^BOX_CONTENT_\d+_/i.test(name)).length === qty;
    }, { id: staged.id, qty: staged.qty, layoutId: staged.layoutId }, { timeout: 45000 });
    return staged;
  }

  async function boxCamera(boxId, { open = false, close = false } = {}) {
    const box = await boxSnapshot(boxId);
    if (!box.exists || !Number.isFinite(box.x) || !Number.isFinite(box.z)) {
      throw new Error(`Cannot derive player camera for carton ${boxId}: ${JSON.stringify(box)}.`);
    }
    const dimensions = await page.evaluate(async (kind) => {
      const B = await import(new URL('src/data/boxes.js', document.baseURI).href);
      return B.boxDims(kind);
    }, box.boxKind);
    const distance = dimensions.h >= 0.80
      ? (close ? 1.30 : 1.62)
      : (close ? 1.08 : 1.34);
    const eyeHeight = 1.62;
    const targetHeight = open ? Math.min(dimensions.h * 0.78, dimensions.h - 0.05) : dimensions.h * 0.55;
    const pitch = -Math.atan2(Math.max(0.25, eyeHeight - targetHeight), distance);
    return { x: box.x, z: box.z + distance, yaw: 0, pitch };
  }

  async function repositionThroughNormalControls(boxId) {
    await setCamera(await boxCamera(boxId));
    const before = await waitForFocus(/\[X\] reposition closed carton/i);
    const inputBefore = await inputTrace();
    await page.keyboard.press('x');
    await waitForBox(boxId, 'carried');
    await page.waitForFunction(() => window.__fw.scene3d.clubhouse().boxPlacement.isActive(), null, { timeout: 3000 });

    const candidates = [
      { x: 8.25, z: -0.34, yaw: 0, pitch: -0.88 },
      { x: 8.62, z: -0.34, yaw: 0, pitch: -0.88 },
      { x: 7.88, z: -0.34, yaw: 0, pitch: -0.88 },
      { x: 8.25, z: -0.18, yaw: 0, pitch: -0.98 },
    ];
    let chosen = null;
    let diagnostics = null;
    for (const candidate of candidates) {
      await setCamera(candidate);
      await page.waitForTimeout(160);
      diagnostics = await page.evaluate(() => window.__fw.scene3d.clubhouse().boxPlacement.diagnostics());
      if (diagnostics.visible && diagnostics.legal) {
        chosen = candidate;
        break;
      }
    }
    if (!chosen) throw new Error(`No legal normal-control floor placement for carton ${boxId}: ${JSON.stringify(diagnostics)}.`);
    await waitForFocus(/\[E\] place/i);
    await page.keyboard.press('e');
    await waitForBox(boxId, 'world');
    const after = await boxSnapshot(boxId);
    return {
      pickupFocus: before,
      inputBefore,
      inputAfter: await inputTrace(),
      placementCamera: chosen,
      placementDiagnostics: diagnostics,
      placed: after,
      usedNormalSecondaryPickup: true,
      usedNormalPlacementCommit: true,
    };
  }

  // Ported off the box-cutter equip 2026-07-30 — cartons tear on a press, no
  // tool, no drag. proshop-box-open-loop.js owns the gesture contract; this
  // driver holds the per-SKU stocking claims around it.
  async function awaitTearPrompt() {
    const focus = await waitForFocus(/tear the tape/i);
    const current = await focusInfo();
    if (current.tool !== null) {
      throw new Error(`A carton press must not involve a tool: ${JSON.stringify(current)}`);
    }
    return { focus, tool: current.tool };
  }

  const captures = [];
  let captureIndex = 0;
  async function visualCensus(boxId, spec) {
    return page.evaluate(({ id, fixtureId, skuId }) => {
      const root = window.__fw.scene3d.scene.getObjectByName(`DeliveryBox_${id}`);
      const camera = window.__fw.scene3d.camera;
      const names = [];
      root?.traverse((object) => { if (object.name) names.push(object.name); });
      const projectedBoxBounds = (() => {
        if (!root || !camera) return null;
        root.updateWorldMatrix(true, true);
        camera.updateMatrixWorld(true);
        const point = camera.position.clone();
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        root.traverseVisible((object) => {
          if (!object.isMesh || !object.geometry) return;
          if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
          const bounds = object.geometry.boundingBox;
          if (!bounds) return;
          for (const x of [bounds.min.x, bounds.max.x]) {
            for (const y of [bounds.min.y, bounds.max.y]) {
              for (const z of [bounds.min.z, bounds.max.z]) {
                point.set(x, y, z).applyMatrix4(object.matrixWorld).project(camera);
                if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
                const px = (point.x * 0.5 + 0.5) * innerWidth;
                const py = (0.5 - point.y * 0.5) * innerHeight;
                minX = Math.min(minX, px);
                minY = Math.min(minY, py);
                maxX = Math.max(maxX, px);
                maxY = Math.max(maxY, py);
              }
            }
          }
        });
        if (![minX, minY, maxX, maxY].every(Number.isFinite)) return null;
        const width = Math.max(0, maxX - minX);
        const height = Math.max(0, maxY - minY);
        return { minX, minY, maxX, maxY, width, height, area: width * height };
      })();
      // The held cutter and its player arm were deleted with the tool
      // (2026-07-30); any residue reappearing in the scene is a regression.
      const cutterResidue = !!window.__fw.scene3d.scene.getObjectByName('DeliveryBoxCutterAuthored')
        || !!window.__fw.scene3d.scene.getObjectByName('BoxCutterPlayerArm');
      const stockDisplay = window.__fw.scene3d.clubhouse().stockDisplayDiagnostics()
        .displays.find((display) => display.fixtureId === fixtureId && display.stockId === skuId) || null;
      return {
        rootExists: !!root,
        contentNodes: names.filter((name) => /^BOX_CONTENT_\d+_/i.test(name)).length,
        visibleContentNodes: (() => {
          let count = 0;
          root?.traverse((object) => {
            if (/^BOX_CONTENT_\d+_/i.test(object.name || '') && object.visible) count += 1;
          });
          return count;
        })(),
        noCutterResidue: !cutterResidue,
        projectedBoxBounds,
        recycling: !!window.__fw.scene3d.scene.getObjectByName('DeliveryRecyclingStationAuthored'),
        fourFlaps: ['FRONT', 'BACK', 'LEFT', 'RIGHT'].every((side) => !!root?.getObjectByName(`BOX_FLAP_${side}`)),
        flatBundle: !!root?.getObjectByName('BOX_FLAT_BUNDLE'),
        stockDisplay,
      };
    }, { id: boxId, fixtureId: spec.fixtureId, skuId: spec.skuId });
  }

  async function capture(spec, boxId, stage, note, quantity = null) {
    captureIndex += 1;
    const filename = `${String(captureIndex).padStart(2, '0')}-${spec.skuId}-${stage}.png`;
    const file = path.join(out, filename);
    await page.screenshot({ path: file });
    const entry = {
      file,
      skuId: spec.skuId,
      stage,
      note,
      focus: await focusInfo(),
      box: await boxSnapshot(boxId),
      quantity: quantity || await quantitySnapshot(spec.skuId, boxId, stage),
      visual: await visualCensus(boxId, spec),
    };
    captures.push(entry);
    fs.writeFileSync(path.join(out, 'run-state.json'), `${JSON.stringify({
      status: 'running',
      phase,
      iteration,
      captureCount: captures.length,
      captures: captures.map((captureEntry) => captureEntry.file),
      updatedAt: new Date().toISOString(),
    }, null, 2)}\n`);
    return entry;
  }

  async function pressToTear(spec, boxId) {
    await setCamera(await boxCamera(boxId, { close: true }));
    await awaitTearPrompt();
    const inputBefore = await inputTrace();
    const stationary = await boxSnapshot(boxId);
    if (stationary.cutProgress !== 0 || stationary.lifecycle !== 'SEALED') {
      throw new Error(`${spec.skuId} carton was not sealed at the tear press: ${JSON.stringify(stationary)}.`);
    }
    await page.keyboard.press('e');
    await waitForBox(boxId, 'cut', 4000);
    const tornCapture = await capture(
      spec,
      boxId,
      'tape-torn',
      'One E press tore the tape outright; no tool, no drag, the carton still closed until the flap press.',
    );
    return {
      tornCapture: tornCapture.file,
      tornTapeState: tornCapture.box.tapeSegments,
      tornProjectedBounds: tornCapture.visual.projectedBoxBounds,
      tornNoCutterResidue: tornCapture.visual.noCutterResidue,
      inputBefore,
      inputAfter: await inputTrace(),
    };
  }

  async function attemptInvalidFixture(spec, boxId, ledger) {
    await setCamera(spec.wrongCamera);
    await page.waitForTimeout(350);
    const focusBefore = await focusInfo();
    const carryBefore = await quantitySnapshot(spec.skuId, boxId, 'invalid-before');
    const allInventoryBefore = await allTargetInventory();
    await page.keyboard.down('e');
    await page.waitForTimeout(700);
    await page.keyboard.up('e');
    await page.waitForTimeout(180);
    const carryAfter = await quantitySnapshot(spec.skuId, boxId, 'invalid-after');
    const allInventoryAfter = await allTargetInventory();
    ledger.push(carryBefore, carryAfter);
    const exposedStockAction = /hold \[E\] to stock/i.test(focusBefore.label || '');
    const visibleBlockedFeedback = /cannot be stocked here.*take it to/i.test(focusBefore.label || '');
    const unchanged = JSON.stringify(carryBefore) === JSON.stringify({ ...carryAfter, step: carryBefore.step })
      && JSON.stringify(allInventoryBefore) === JSON.stringify(allInventoryAfter);
    const evidence = {
      wrongFixtureId: spec.wrongFixtureId,
      wrongFixtureTitle: spec.wrongFixtureTitle,
      focusBefore,
      exposedStockAction,
      visibleBlockedFeedback,
      normalInput: 'held E for 700 ms',
      carryBefore,
      carryAfter,
      allInventoryBefore,
      allInventoryAfter,
      unchanged,
    };
    await capture(
      spec,
      boxId,
      'invalid-fixture-blocked',
      `Carried ${spec.skuId} is aimed at incompatible ${spec.wrongFixtureTitle}; normal held E exposes no stock verb and moves zero units.`,
      carryAfter,
    );
    return evidence;
  }

  async function stockCurrentArmful(spec, boxId, ledger, label) {
    await setCamera(spec.fixtureCamera);
    const focus = await waitForFocus(new RegExp(`${spec.fixtureTitle}.*hold \\[E\\] to stock`, 'i'));
    await page.keyboard.down('e');
    try {
      await page.waitForFunction((skuId) => !window.__fw.state.shop.carry
        || window.__fw.state.shop.carry.skuId !== skuId, spec.skuId, { timeout: 6000 });
    } finally {
      await page.keyboard.up('e').catch(() => {});
    }
    await page.waitForTimeout(1400);
    const snapshot = await quantitySnapshot(spec.skuId, boxId, label);
    ledger.push(snapshot);
    return { focus, snapshot };
  }

  async function recycleEmptyBox(spec, boxId) {
    await setCamera(await boxCamera(boxId, { open: true }));
    await waitForFocus(/Empty .* box.*\[E\] flatten/i);
    await page.keyboard.press('e');
    await waitForBox(boxId, 'flat', 4500);
    await page.keyboard.press('e');
    await waitForBox(boxId, 'carried', 3500);
    await page.waitForFunction(
      () => !document.querySelector('.toast'),
      null,
      { timeout: 4500 },
    ).catch(() => {});
    await setCamera(recyclingCamera);
    const focus = await waitForFocus(/Recycling.*\[E\] drop the flattened carton in/i);
    await page.keyboard.press('e');
    await waitForBox(boxId, 'gone', 5000);
    await page.waitForTimeout(700);
    return { focus, normalInput: 'E flatten -> E carry -> E recycling drop' };
  }

  const caseResults = [];
  let lifecycleMediaStarted = null;
  let lifecycleMediaCapture = null;
  let blocker = null;
  try {
    for (let index = 0; index < cases.length; index += 1) {
      const spec = cases[index];
      const staged = await stageExactCase(spec, index + 1);
      const ledger = [await quantitySnapshot(spec.skuId, staged.id, 'sealed-fixture')];
      const caseInputBefore = await inputTrace();
      if (index === 0) lifecycleMediaStarted = await startLifecycleMediaCapture();
      const normalPlacement = await repositionThroughNormalControls(staged.id);
      await setCamera(await boxCamera(staged.id));
      await waitForFocus(/tear the tape/i);
      await capture(
        spec,
        staged.id,
        'sealed-after-normal-placement',
        'The sealed exact-SKU carton was picked up with X and committed to a green production placement with E.',
      );

      const tearPrompt = await awaitTearPrompt();
      const cutter = await pressToTear(spec, staged.id);
      await setCamera(await boxCamera(staged.id, { open: true }));
      await waitForFocus(/open the other flap/i);
      await page.keyboard.press('e');
      await waitForBox(staged.id, 'open', 5000);
      const openedQuantity = await quantitySnapshot(spec.skuId, staged.id, 'open-full');
      ledger.push(openedQuantity);
      await capture(
        spec,
        staged.id,
        'open-full',
        `All ${spec.expectedQty} exact authored products are visible after the normal four-flap opening animation.`,
        openedQuantity,
      );

      const stockingTrips = [];
      let invalidFixture = null;
      let remaining = staged.qty;
      let trip = 0;
      while (remaining > 0) {
        trip += 1;
        await setCamera(await boxCamera(staged.id, { open: true }));
        await waitForFocus(/\[E\] take an armful/i);
        const beforeTake = remaining;
        await page.keyboard.press('e');
        await page.waitForFunction(({ skuId, boxId, before }) => {
          const box = window.__fw.state.shop.deliveries.boxes.find((entry) => entry.id === boxId);
          const carry = window.__fw.state.shop.carry;
          return !!box && box.qty < before && carry?.skuId === skuId && carry.qty > 0;
        }, { skuId: spec.skuId, boxId: staged.id, before: beforeTake }, { timeout: 4000 });
        const afterTake = await quantitySnapshot(spec.skuId, staged.id, `trip-${trip}-taken`);
        ledger.push(afterTake);
        remaining = afterTake.box;
        if (trip === 1) {
          await capture(
            spec,
            staged.id,
            'first-armful-box-depletion',
            'The first normal E take moves one SKU-specific armful into the carry overlay and reduces only the carton count.',
            afterTake,
          );
          invalidFixture = await attemptInvalidFixture(spec, staged.id, ledger);
        }
        const stocked = await stockCurrentArmful(spec, staged.id, ledger, `trip-${trip}-stocked`);
        stockingTrips.push({ trip, beforeTake, afterTake, stocked });
        if (trip === 1) {
          await capture(
            spec,
            staged.id,
            'first-armful-stocked',
            'The first armful has landed on the correct authored fixture through normal held-E stock flights.',
            stocked.snapshot,
          );
        }
      }

      await page.waitForFunction(
        () => !document.querySelector('.toast'),
        null,
        { timeout: 4500 },
      ).catch(() => {});
      await setCamera(spec.fixtureCamera);
      const emptyStock = await quantitySnapshot(spec.skuId, staged.id, 'carton-empty-all-units-stocked');
      ledger.push(emptyStock);
      await capture(
        spec,
        staged.id,
        'carton-empty-all-units-stocked',
        'Every shipped unit is out of the carton and on its compatible physical display; carry and backroom counts are zero.',
        emptyStock,
      );

      const disposal = await recycleEmptyBox(spec, staged.id);
      const disposedQuantity = await quantitySnapshot(spec.skuId, staged.id, 'recycled');
      ledger.push(disposedQuantity);
      await capture(
        spec,
        staged.id,
        'recycled',
        'The flattened carton is absent only after the normal recycling-station drop completes.',
        disposedQuantity,
      );
      if (index === 0) {
        lifecycleMediaCapture = await stopLifecycleMediaCapture(lifecycleMediaStarted);
      }
      if (index < cases.length - 1) {
        await page.waitForFunction(
          () => !document.querySelector('.toast'),
          null,
          { timeout: 4500 },
        ).catch(() => {});
      }

      const contractReadback = await page.evaluate(async ({ skuId, fixtureId, wrongFixtureId }) => {
        const S = await import(new URL('src/sim/stocking.js', document.baseURI).href);
        const F = await import(new URL('src/data/fixtureSlots.js', document.baseURI).href);
        const I = await import(new URL('src/data/shopItems.js', document.baseURI).href);
        return {
          correctAccepts: S.accepts(S.fixtureById(fixtureId), skuId),
          wrongAccepts: S.accepts(S.fixtureById(wrongFixtureId), skuId),
          capacity: F.capacityOf(skuId),
          armful: S.armfulOf(I.skuById(skuId)),
        };
      }, spec);
      const caseInputAfter = await inputTrace();
      const caseCaptures = captures.filter((entry) => entry.skuId === spec.skuId);
      const openCapture = caseCaptures.find((entry) => entry.stage === 'open-full');
      const firstTakeCapture = caseCaptures.find((entry) => entry.stage === 'first-armful-box-depletion');
      const firstStockCapture = caseCaptures.find((entry) => entry.stage === 'first-armful-stocked');
      const emptyCapture = caseCaptures.find((entry) => entry.stage === 'carton-empty-all-units-stocked');
      const assertions = {
        exactManifest: staged.qty === spec.expectedQty
          && staged.cap === spec.expectedQty
          && staged.boxKind === spec.expectedBoxKind
          && staged.layoutId === spec.expectedLayout
          && staged.manifest.boxCount === 1,
        stockingContract: staged.packaging.allowedFixtures.includes(spec.fixtureId)
          && contractReadback.correctAccepts
          && !contractReadback.wrongAccepts,
        skuSpecificArmfulTrips: stockingTrips.length
          === Math.ceil(spec.expectedQty / contractReadback.armful)
          && stockingTrips.every((trip) => (
            trip.afterTake.carry === Math.min(contractReadback.armful, trip.beforeTake)
          )),
        normalPickupAndPlacement: normalPlacement.usedNormalSecondaryPickup
          && normalPlacement.usedNormalPlacementCommit
          && normalPlacement.placed.loc === 'world'
          && normalPlacement.placed.surfaceId === 'floor:clubhouse',
        pressTearNoTool: tearPrompt.tool === null
          && cutter.inputAfter.keyDown.e - cutter.inputBefore.keyDown.e === 1
          && cutter.inputAfter.pointerDown === cutter.inputBefore.pointerDown
          && cutter.tornNoCutterResidue
          && cutter.tornProjectedBounds?.width >= 180
          && cutter.tornProjectedBounds?.height >= 180
          && cutter.tornProjectedBounds?.area >= 35000,
        invalidFixtureBlocked: !!invalidFixture
          && !invalidFixture.exposedStockAction
          && invalidFixture.visibleBlockedFeedback
          && invalidFixture.unchanged,
        exactQuantityConservation: ledger.every((entry) => entry.total === spec.expectedQty),
        visibleContentDepletionMatchesState: openCapture?.visual.visibleContentNodes === spec.expectedQty
          && firstTakeCapture?.visual.visibleContentNodes === firstTakeCapture.quantity.box
          && emptyCapture?.visual.visibleContentNodes === 0,
        partialStockFixtureEvidence: firstStockCapture?.quantity.shelf > 0
          && firstStockCapture.quantity.shelf < firstStockCapture.quantity.shelfCapacity
          && firstStockCapture.visual.stockDisplay?.visible
          && firstStockCapture.visual.stockDisplay.meshes > 0,
        noBackroomOrCarryRemainder: disposedQuantity.back === 0 && disposedQuantity.carry === 0,
        allCartonUnitsStocked: disposedQuantity.box === 0 && disposedQuantity.shelf === spec.expectedQty,
        finalStockGeometryVisible: emptyCapture?.visual.stockDisplay?.visible
          && emptyCapture.visual.stockDisplay.meshes > 0,
        fullFixtureEvidenceWhenExactCartonFillsIt: spec.skuId === 'tees1'
          ? disposedQuantity.shelf === disposedQuantity.shelfCapacity
          : disposedQuantity.shelf > 0 && disposedQuantity.shelf < disposedQuantity.shelfCapacity,
        cartonDisposedExactlyOnce: !(await boxSnapshot(staged.id)).exists,
        normalInputOccurred: (caseInputAfter.keyDown.x || 0) > (caseInputBefore.keyDown.x || 0)
          && (caseInputAfter.keyDown.e || 0) > (caseInputBefore.keyDown.e || 0),
      };
      caseResults.push({
        spec,
        staged,
        normalPlacement,
        tearPrompt,
        cutter,
        stockingTrips,
        invalidFixture,
        disposal,
        contractReadback,
        ledger,
        final: disposedQuantity,
        input: { before: caseInputBefore, after: caseInputAfter },
        assertions,
        ok: Object.values(assertions).every(Boolean),
      });
    }
  } catch (error) {
    blocker = {
      message: error?.message || String(error),
      stack: error?.stack || null,
      completedCases: caseResults.map((entry) => entry.spec.skuId),
      latestCapture: captures.at(-1)?.file || null,
    };
  }

  const finalState = await page.evaluate((skuIds) => ({
    liveBoxes: window.__fw.state.shop.deliveries.boxes.length,
    recycled: window.__fw.state.shop.deliveries.recycled || 0,
    trash: window.__fw.state.shop.deliveries.trash || 0,
    carry: window.__fw.state.shop.carry,
    inventory: Object.fromEntries(skuIds.map((skuId) => [skuId, {
      shelf: window.__fw.state.shop.inventory[skuId]?.shelf || 0,
      back: window.__fw.state.shop.inventory[skuId]?.back || 0,
    }])),
    pointerLocked: document.pointerLockElement === document.querySelector('canvas'),
  }), targetSkuIds);
  const finalInputTrace = await inputTrace();
  // The blade cues left with the cutter (2026-07-30): the first press tears
  // (boxTapeTear), the second folds (boxFlapFold), the armful shifts contents.
  const requiredAudioCueOrder = [
    'boxup', 'boxdown', 'boxTapeTear', 'boxFlapFold', 'boxContentsShift',
    'itemRemoval', 'stock', 'boxFlatten', 'disposal',
  ];
  const audioCueOrderIndices = requiredAudioCueOrder.map((name) => (
    lifecycleMediaCapture?.cueTrace.findIndex((entry) => entry.name === name) ?? -1
  ));
  const assertions = {
    allFiveRoutesCompleted: caseResults.length === cases.length && caseResults.every((entry) => entry.ok),
    exactFiveDisposals: finalState.liveBoxes === 0
      && finalState.recycled === cases.length
      && finalState.trash === 0
      && !finalState.carry,
    allTargetUnitsOnCorrectDisplays: cases.every((spec) => (
      finalState.inventory[spec.skuId].shelf === spec.expectedQty
      && finalState.inventory[spec.skuId].back === 0
    )),
    // The held-LMB clauses left with the cutter (2026-07-30): opening is three
    // E presses, so the audit is key-driven and pointer use stays balanced.
    realInputAudit: (finalInputTrace.keyDown.x || 0) >= cases.length
      && finalInputTrace.pointerDown === finalInputTrace.pointerUp
      && (finalInputTrace.keyDown.e || 0) > cases.length * 5,
    fortyEvidenceScreenshots: captures.length === cases.length * 8,
    pointerLockHeld: finalState.pointerLocked && captures.every((entry) => entry.focus.pointerLocked),
    noConsoleOrPageErrors: diagnosticCounts.consoleError === 0 && diagnosticCounts.pageError === 0,
    noFailedRequests: diagnosticCounts.requestFailed === 0,
    retainedLifecycleMediaWithLiveAudio: !!lifecycleMediaCapture
      && lifecycleMediaCapture.audioTracks >= 1
      && lifecycleMediaCapture.videoTracks >= 1
      && lifecycleMediaCapture.audioContextState === 'running'
      && lifecycleMediaCapture.downloaded
      && lifecycleMediaCapture.bytes > 0
      && lifecycleMediaCapture.bytesOnDisk === lifecycleMediaCapture.bytes
      && lifecycleMediaCapture.nonSilentAudioWindows > 0
      && lifecycleMediaCapture.audioPeak > 0.0001
      && lifecycleMediaCapture.audioPeak < 0.95,
    semanticAudioCuesOccurredInLifecycleOrder: audioCueOrderIndices.every((index) => index >= 0)
      && audioCueOrderIndices.every((index, position) => (
        position === 0 || index > audioCueOrderIndices[position - 1]
      )),
    noBlocker: !blocker,
  };
  const result = {
    ok: Object.values(assertions).every(Boolean),
    phase,
    iteration,
    outputDirectory: out,
    launch: `$env:HEADED='1'; $env:SKU_STOCK_QA_PHASE='${phase}'; $env:SKU_STOCK_QA_ITERATION='${iteration}'; $env:VIDEO_DIR='qa/box_system_master/sku_stock_lifecycle/${phase}/iteration-${String(iteration).padStart(2, '0')}/video'; node tools/qa/run-playwright.cjs tools/qa/sku-stock-lifecycle-qa.js --bootstrap`,
    viewport,
    fixedConditions: { clock: '14:00', weatherLocked: true, organicWalkins: false, viewport: '1600x900@1x' },
    fixtureInjection,
    normalInputBoundary: 'All lifecycle/stock/disposal mutations after exact sealed-carton staging come from Playwright keyboard/mouse events.',
    caseResults,
    captures,
    finalState,
    finalInputTrace,
    lifecycleMediaCapture,
    audioEvidence: { requiredCueOrder: requiredAudioCueOrder, observedIndices: audioCueOrderIndices },
    diagnostics: { counts: diagnosticCounts, entries: diagnostics },
    assertions,
    blocker,
  };
  fs.writeFileSync(path.join(out, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
  fs.writeFileSync(path.join(out, 'run-state.json'), `${JSON.stringify({
    status: result.ok ? 'passed' : 'failed',
    phase,
    iteration,
    result: path.join(out, 'result.json'),
    captureCount: captures.length,
    captures: captures.map((entry) => entry.file),
    blocker,
    updatedAt: new Date().toISOString(),
  }, null, 2)}\n`);
  return result;
}
