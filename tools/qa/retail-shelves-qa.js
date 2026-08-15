async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const repoRoot = process.env.QA_REPO_ROOT || process.cwd();
  const iteration = Math.max(1, Number(process.env.QA_ITERATION || 1));
  const outDir = process.env.QA_OUT_DIR
    || path.join(repoRoot, 'qa', 'retail_shelves', 'browser', `iteration-${iteration}`);
  const measurePerformance = process.env.QA_MEASURE_PERF === '1';
  const verifyReload = process.env.QA_SAVE_RELOAD === '1';
  const debugStock = process.env.QA_DEBUG_STOCK === '1';
  fs.mkdirSync(outDir, { recursive: true });

  const diagnostics = { consoleErrors: [], consoleWarnings: [], pageErrors: [], failedRequests: [] };
  let intentionalReload = false;
  page.on('console', (message) => {
    if (message.type() === 'error') diagnostics.consoleErrors.push(message.text());
    if (message.type() === 'warning') diagnostics.consoleWarnings.push(message.text());
  });
  page.on('pageerror', (error) => diagnostics.pageErrors.push(error.message));
  page.on('requestfailed', (request) => {
    const error = request.failure()?.errorText || 'unknown';
    if (intentionalReload && error === 'net::ERR_ABORTED') return;
    if (error === 'net::ERR_ABORTED'
        && /\/vendor\/models\/(?:shed|clubhouse_ext_opt)\.glb(?:\?|$)/.test(request.url())) return;
    if (error === 'net::ERR_ABORTED'
        && /\/vendor\/models\/pro_shop_furniture\/retail-shelving\/shelf_[^/?]+\.glb(?:\?|$)/
          .test(request.url())) return;
    diagnostics.failedRequests.push({ url: request.url(), error });
  });

  const waitForGame = async () => {
    await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
    await page.waitForFunction(() => {
      const veil = document.querySelector('.load-veil');
      return !veil || getComputedStyle(veil).display === 'none'
        || Number(getComputedStyle(veil).opacity) <= 0.01;
    }, null, { timeout: 90000 });
    await page.waitForTimeout(1400);
  };

  const clearUi = async () => page.evaluate(async () => {
    const ui = await import(new URL('src/ui/ui.js', document.baseURI).href);
    ui.clearNotifications();
    ui.clearToasts();
    window.__fw.scene3d.clubhouse().interior.traverse((object) => {
      if (/^SHEET06_60_damage-/i.test(object.name || '') || object.name === 'LOD0_FloorDamageWood') {
        object.visible = false;
      }
    });
    let style = document.querySelector('#retail-shelf-qa-presentation');
    if (!style) {
      style = document.createElement('style');
      style.id = 'retail-shelf-qa-presentation';
      style.textContent = '.notification-center,.toast-wrap,.shop-lockhint{display:none!important}';
      document.head.appendChild(style);
    }
  });

  const setCamera = async ({ at, target, targetY = 1.18, minute = 840, fov = 70 }) => {
    await page.evaluate(({ at, target, targetY, minute, fov }) => {
      const app = window.__fw;
      const interior = app.scene3d.clubhouse().interior;
      const walk = app.scene3d.walk;
      walk.clearKeys();
      walk.clearFocus?.();
      walk.setSpraying(false);
      const Vector3 = interior.position.constructor;
      const origin = interior.localToWorld(new Vector3(at[0], 0, at[1]));
      const destination = interior.localToWorld(new Vector3(target[0], targetY, target[1]));
      walk.state.x = origin.x;
      walk.state.z = origin.z;
      const dx = destination.x - origin.x;
      const dz = destination.z - origin.z;
      const horizontal = Math.hypot(dx, dz) || 0.001;
      walk.state.yaw = Math.atan2(-dx, -dz);
      walk.state.pitch = Math.atan2(targetY - (walk.state.eye || 1.62), horizontal);
      app.scene3d.camera.fov = fov;
      app.scene3d.camera.updateProjectionMatrix();
      const day = Math.floor(app.state.clock.minutes / 1440);
      app.state.clock.minutes = day * 1440 + minute;
      app.scene3d.applyTimeWeather(minute, app.state.weather);
    }, { at, target, targetY, minute, fov });
    await clearUi();
    await page.waitForTimeout(650);
  };

  const frameMetrics = async (durationMs) => page.evaluate((duration) => new Promise((resolve) => {
    const deltas = [];
    const renderer = window.__fw.scene3d.renderer;
    let uiMutationRecords = 0;
    const observer = new MutationObserver((records) => { uiMutationRecords += records.length; });
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
    const startedAt = performance.now();
    let previous = startedAt;
    const tick = (now) => {
      deltas.push(now - previous);
      previous = now;
      if (now - startedAt < duration) return requestAnimationFrame(tick);
      const samples = deltas.slice(2);
      const sorted = [...samples].sort((a, b) => a - b);
      const total = samples.reduce((sum, value) => sum + value, 0);
      const elapsedSeconds = Math.max(0.001, (now - startedAt) / 1000);
      const p99 = sorted[Math.max(0, Math.ceil(sorted.length * 0.99) - 1)] || 0;
      let visibleMeshes = 0;
      let sceneTriangles = 0;
      const materials = new Set();
      const textures = new Map();
      window.__fw.scene3d.scene.traverseVisible((object) => {
        if (!object.isMesh) return;
        visibleMeshes += 1;
        const count = object.geometry?.index?.count
          ?? object.geometry?.attributes?.position?.count ?? 0;
        sceneTriangles += count / 3 * (object.isInstancedMesh ? object.count : 1);
        for (const material of (Array.isArray(object.material) ? object.material : [object.material])) {
          if (!material) continue;
          materials.add(material.uuid);
          for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap']) {
            const texture = material[key];
            if (!texture || textures.has(texture.uuid)) continue;
            const image = texture.image;
            const width = Number(image?.videoWidth || image?.naturalWidth || image?.width || 0);
            const height = Number(image?.videoHeight || image?.naturalHeight || image?.height || 0);
            textures.set(texture.uuid, Math.ceil(width * height * 4 * 4 / 3));
          }
        }
      });
      observer.disconnect();
      resolve({
        durationMs: now - startedAt,
        frameCount: samples.length,
        averageFps: samples.length * 1000 / Math.max(1, total),
        onePercentLowFps: p99 > 0 ? 1000 / p99 : 0,
        worstFrameMs: sorted.at(-1) || 0,
        drawCalls: renderer.info.render.calls,
        renderedTriangles: renderer.info.render.triangles,
        rendererMemory: { ...renderer.info.memory },
        visibleMeshes,
        sceneTriangles: Math.round(sceneTriangles),
        uniqueMaterials: materials.size,
        uniqueTextures: textures.size,
        estimatedTextureBytesRGBA8WithMipmaps: [...textures.values()].reduce((sum, value) => sum + value, 0),
        heapBytes: performance.memory?.usedJSHeapSize ?? null,
        uiMutationRecords,
        uiMutationRecordsPerSecond: uiMutationRecords / elapsedSeconds,
      });
    };
    requestAnimationFrame(tick);
  }), durationMs);

  const eventListenerCounts = async () => {
    const cdp = await page.context().newCDPSession(page);
    try {
      const counts = {};
      for (const [name, expression] of [
        ['window', 'window'],
        ['document', 'document'],
        ['canvas', "document.querySelector('canvas')"],
      ]) {
        const evaluated = await cdp.send('Runtime.evaluate', {
          expression, objectGroup: 'retail-shelf-listeners',
        });
        if (!evaluated.result.objectId) {
          counts[name] = 0;
          continue;
        }
        const result = await cdp.send('DOMDebugger.getEventListeners', {
          objectId: evaluated.result.objectId,
        });
        counts[name] = result.listeners.length;
      }
      counts.total = counts.window + counts.document + counts.canvas;
      return counts;
    } finally {
      await cdp.send('Runtime.releaseObjectGroup', { objectGroup: 'retail-shelf-listeners' })
        .catch(() => {});
      await cdp.detach().catch(() => {});
    }
  };

  const runtimeHeapUsage = async () => {
    const cdp = await page.context().newCDPSession(page);
    try {
      await cdp.send('HeapProfiler.collectGarbage');
      return await cdp.send('Runtime.getHeapUsage');
    } finally {
      await cdp.detach().catch(() => {});
    }
  };

  const runtimeHealthSnapshot = async () => ({
    eventListeners: await eventListenerCounts(),
    heap: await runtimeHeapUsage(),
  });

  const performanceRuns = async () => {
    const runs = [];
    const count = measurePerformance ? 3 : 1;
    const duration = measurePerformance ? 5000 : 1800;
    for (let index = 0; index < count; index += 1) runs.push(await frameMetrics(duration));
    return runs;
  };

  const capture = async (name, options = {}) => {
    await clearUi();
    await page.waitForTimeout(180);
    const filename = path.join(outDir, `${name}.png`);
    await page.screenshot({
      path: filename,
      ...(options.clip ? { clip: options.clip } : {}),
    });
    return filename;
  };

  await page.setViewportSize({ width: 1600, height: 900 });
  const url = new URL(baseUrl);
  url.searchParams.set('clubhouse', 'legacy');
  intentionalReload = true;
  await page.goto(url.toString());
  intentionalReload = false;
  await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`)).clickThroughMenu(page);
  await waitForGame();

  const baselineFixture = await page.evaluate(async () => {
    const app = window.__fw;
    const layout = await import(new URL('src/sim/layout.js', document.baseURI).href);
    const state = app.state;
    const clubhouse = app.scene3d.clubhouse();
    app.speedIdx = 0;
    app.scene3d.walk.clearKeys();
    clubhouse.setOrganicWalkins(false);
    clubhouse.clearWalkins();
    state.tutorial.complete = true;
    state.tutorial.hidden = true;
    state.campaign.enabled = false;
    state.campaign.businessOpen = false;
    state.shop.reno.grime.fill(0);
    state.shop.reno.windows.fill(0);
    for (const clutter of state.shop.reno.clutter) clutter.cleared = true;
    state.shop.reno.debris = [];
    state.shop.reno.debrisSeeded = true;
    state.shop.orders = [];
    state.shop.carry = null;
    state.shop.deliveries.boxes = [];
    state.shop.deliveries.shipments = [];
    state.shop.deliveries.arrivedOrderIds = [];
    const storedFixtures = [];
    for (const fixture of layout.placedFixtures(state)) {
      const result = layout.storeObject(state, fixture.id, { history: false });
      if (result.ok) storedFixtures.push(fixture.id);
    }
    const layoutState = layout.ensureLayout(state);
    layoutState.extra = [];
    layoutState.history = { undo: [], redo: [] };
    state.shop.reno.decor = [];
    state.propertyInventory.items = [];
    state.propertyInventory.placements = [];
    state.propertyInventory.pendingDeliveries = [];
    state.propertyInventory.operations = [];
    state.propertyInventory.nextItemId = 1;
    state.propertyInventory.nextPlacementId = 1;
    clubhouse.refreshCampaign();
    return {
      storedFixtures,
      remainingFixtures: layout.placedFixtures(state).map((fixture) => fixture.id),
      remainingLayoutExtra: layoutState.extra.length,
      routeIntact: layout.routesIntact(state),
    };
  });
  if (!baselineFixture.routeIntact || baselineFixture.remainingFixtures.length
      || baselineFixture.remainingLayoutExtra) {
    throw new Error(`Retail shelf QA baseline was not isolated: ${JSON.stringify(baselineFixture)}`);
  }

  const overviewCamera = { at: [-4.30, -1.15], target: [-4.30, -6.15], targetY: 1.28, fov: 74 };
  await setCamera(overviewCamera);
  const screenshots = [await capture('00-empty-wall-baseline')];
  const performanceBefore = await performanceRuns();

  const fixture = await page.evaluate(async () => {
    const app = window.__fw;
    const inventory = await import(new URL('src/sim/propertyInventory.js', document.baseURI).href);
    const shop = await import(new URL('src/sim/shop.js', document.baseURI).href);
    const placement = await import(new URL('src/sim/propertyPlacement.js', document.baseURI).href);
    const placeables = await import(new URL('src/data/placeableItems.js', document.baseURI).href);
    const layout = await import(new URL('src/data/shopLayout.js', document.baseURI).href);
    const state = app.state;
    const north = -layout.INTERIOR.d / 2 + 0.02;
    const highEndSpec = placeables.placeableSpecBySkuId('furn-freestanding-shelving-luxury');
    const productionNorth = north + highEndSpec.wallSnap.surfaceOffset;
    const shelves = [
      { tier: 'basic', skuId: 'furn-freestanding-shelving-basic', x: -9.75, controls: true },
      { tier: 'standard', skuId: 'furn-freestanding-shelving-standard', x: -8.39 },
      { tier: 'premium', skuId: 'furn-freestanding-shelving-premium', x: -6.80 },
      { tier: 'high-end', skuId: 'furn-freestanding-shelving-luxury', x: -4.25 },
      { tier: 'luxury', skuId: 'furn-freestanding-shelving-executive', x: -0.25 },
    ];
    const placements = [];
    for (const shelf of shelves) {
      const spec = placeables.placeableSpecBySkuId(shelf.skuId);
      state.shop.inventory[shelf.skuId] = { shelf: 0, back: 1 };
      inventory.importLegacyStoredPlaceables(state, shelf.skuId, 1);
      shelf.targetZ = productionNorth + spec.placementProfile.depth / 2 + 0.02;
      if (shelf.controls) continue;
      const pose = spec.wallSnap?.enabled
        ? placement.snapPlaceablePose(spec, { x: shelf.x, z: north }, 0)
        : {
          area: 'clubhouse', mount: 'floor', x: shelf.x, y: 0, z: shelf.targetZ,
          ry: 0, surfaceId: 'clubhouse:floor', authoredSpot: null,
        };
      const placed = shop.placeDecorFree(state, shelf.skuId, pose);
      placements.push({
        tier: shelf.tier, skuId: shelf.skuId, ok: placed.ok,
        reason: placed.reason || null, pose: placed.placement?.pose || pose,
      });
    }
    return { north, productionNorth, shelves, placements };
  });

  const aimAtFloor = async (at, target) => setCamera({ at, target, targetY: 0.02, fov: 68 });
  if (fixture.placements.some((entry) => !entry.ok)) {
    throw new Error(`Direct comparison fixture placement failed: ${JSON.stringify(fixture.placements)}`);
  }
  const basic = fixture.shelves[0];
  await aimAtFloor([basic.x, -3.30], [basic.x, basic.targetZ]);
  await page.keyboard.press('b');
  await page.waitForFunction(() => window.__fw.scene3d.clubhouse().build.isActive());
  await page.keyboard.press('i');
  await page.waitForFunction(() => window.__fw.scene3d.clubhouse().build.isInventoryOpen());
  await page.keyboard.press('e');
  await page.waitForFunction(() => (
    window.__fw.scene3d.clubhouse().build.diagnostics().decorCarry?.skuId
      === 'furn-freestanding-shelving-basic'
  ));
  await aimAtFloor([basic.x, -3.30], [basic.x, basic.targetZ]);
  const basicPreview = await page.evaluate(() => window.__fw.scene3d.clubhouse().build.diagnostics());
  if (!basicPreview.validation.ok) {
    throw new Error(`Basic shelf normal-control placement invalid: ${JSON.stringify(basicPreview.validation)}`);
  }
  await page.keyboard.press('e');
  await page.waitForFunction(() => window.__fw.state.propertyInventory.placements.some((entry) => (
    entry.assetId === 'pro-shop-furniture:freestanding-shelving:basic'
  )), null, { timeout: 15000 });
  await page.keyboard.press('b');
  await page.waitForFunction(() => !window.__fw.scene3d.clubhouse().build.isActive());
  const postPlacementBuildState = await page.evaluate(() => (
    window.__fw.scene3d.clubhouse().build.diagnostics()
  ));

  await page.waitForFunction(() => {
    const roots = [];
    window.__fw.scene3d.scene.traverse((object) => {
      if (object.name?.startsWith('PropertyFurniture_furn-freestanding-shelving-')) roots.push(object);
    });
    return roots.length === 5 && roots.every((root) => root.userData.loaded === true);
  }, null, { timeout: 45000 });
  await page.evaluate(async () => {
    const roots = [];
    window.__fw.scene3d.scene.traverse((object) => {
      if (object.name?.startsWith('PropertyFurniture_furn-freestanding-shelving-')) roots.push(object);
    });
    await Promise.all(roots.map((root) => root.userData.ready));
  });
  await page.waitForTimeout(900);

  const focusShelfTarget = async (skuId, componentName = null, nodeName = null) => {
    const aim = await page.evaluate(({ skuId, componentName, nodeName }) => {
      const app = window.__fw;
      let root = null;
      app.scene3d.scene.traverse((object) => {
        if (object.name === `PropertyFurniture_${skuId}`) root = object;
      });
      if (!root) return { ok: false, reason: 'root-not-found' };
      const controller = componentName
        ? root.userData.interactiveComponents?.find((entry) => entry.name === componentName)
        : null;
      const node = controller?.interactionNode
        || (nodeName ? root.userData.functionalNodes?.byName?.[nodeName] : null)
        || root.userData.functionalNodes?.interactionPoint;
      if (!node) return { ok: false, reason: 'interaction-node-not-found' };
      root.visible = true;
      root.updateWorldMatrix(true, true);
      node.updateWorldMatrix(true, false);
      const Vector3 = root.position.constructor;
      const Quaternion = root.quaternion.constructor;
      const target = node.getWorldPosition(new Vector3());
      const forward = new Vector3(0, 0, 1).applyQuaternion(root.getWorldQuaternion(new Quaternion()));
      const distance = componentName || nodeName ? 1.12 : 1.42;
      const floorWorldY = app.scene3d.clubhouse().interior.getWorldPosition(new Vector3()).y;
      const walk = app.scene3d.walk;
      walk.clearKeys();
      walk.clearFocus?.();
      walk.state.x = target.x + forward.x * distance;
      walk.state.z = target.z + forward.z * distance;
      const dx = target.x - walk.state.x;
      const dy = target.y - (floorWorldY + (walk.state.eye || 1.62));
      const dz = target.z - walk.state.z;
      const spatial = Math.hypot(dx, dy, dz) || 0.001;
      walk.state.yaw = Math.atan2(-dx, -dz);
      walk.state.pitch = Math.asin(dy / spatial);
      app.scene3d.camera.fov = componentName || nodeName ? 58 : 64;
      app.scene3d.camera.updateProjectionMatrix();
      return { ok: true, target: target.toArray(), componentName, nodeName };
    }, { skuId, componentName, nodeName });
    await page.waitForTimeout(650);
    const focus = await page.evaluate(() => {
      const prop = window.__fw.scene3d.walk.getFocus?.()?.prop;
      return {
        label: window.__fw.scene3d.walk.getFocusLabel?.() || null,
        component: prop?.furnitureComponent || null,
        retailShelfStock: prop?.retailShelfStock || null,
        retailShelfStorage: prop?.retailShelfStorage || null,
        storageZone: prop?.storageZone || null,
        lightControl: prop?.lightControl || null,
      };
    });
    return { aim, focus };
  };

  const basicPlacementId = await page.evaluate(() => (
    window.__fw.state.propertyInventory.placements.find((entry) => (
      entry.assetId === 'pro-shop-furniture:freestanding-shelving:basic'
    ))?.id || null
  ));
  await page.evaluate(async (placementId) => {
    const lifecycle = await import(new URL('src/sim/inventoryLifecycle.js', document.baseURI).href);
    const stocking = await import(new URL('src/sim/stocking.js', document.baseURI).href);
    const adopted = lifecycle.adoptExternalInventory(window.__fw.state, {
      skuId: 'balls2', quantity: 1, stage: lifecycle.INVENTORY_STAGE.RESERVE,
      note: `Browser QA stock for ${placementId}`,
    });
    if (!adopted.ok) throw new Error(adopted.reason);
    stocking.setCarry(window.__fw.state, 'balls2', 1, adopted.allocations);
  }, basicPlacementId);
  const normalStockInput = await focusShelfTarget('furn-freestanding-shelving-basic');
  await page.keyboard.press('e');
  await page.waitForFunction((placementId) => {
    const placement = window.__fw.state.propertyInventory.placements.find((entry) => entry.id === placementId);
    return Object.values(placement?.retailShelfStock?.zones || {}).some((zone) => (
      zone.skuId === 'balls2' && zone.quantity === 1
    ));
  }, basicPlacementId, { timeout: 10000 });

  const stockingFixture = await page.evaluate(async () => {
    const app = window.__fw;
    const lifecycle = await import(new URL('src/sim/inventoryLifecycle.js', document.baseURI).href);
    const stocking = await import(new URL('src/sim/stocking.js', document.baseURI).href);
    const retail = await import(new URL('src/sim/retailShelfStocking.js', document.baseURI).href);
    const state = app.state;
    const linesByTier = {
      basic: [['balls2', 2]],
      standard: [['balls1', 2], ['glove1', 2], ['tees1', 2]],
      premium: [['polo1', 2], ['cap1', 2], ['shoe1', 2]],
      luxury: [
        ['balls3', 2], ['glove2', 2], ['polo2', 2], ['pants2', 2], ['shorts1', 2],
        ['cap2', 2], ['jacket2', 2], ['towel1', 2], ['marker1', 2], ['visor1', 2],
        ['sock1', 2], ['sunglasses2', 2], ['bottle1', 2], ['range2', 2], ['umb1', 2],
      ],
      executive: [
        ['divot1', 2], ['range2', 2], ['sunglasses2', 2], ['bottle1', 2], ['umb1', 2],
        ['scorecard1', 2], ['water1', 2], ['sportdrink2', 2], ['soda1', 2], ['chips1', 2],
        ['bar2', 2], ['crackers1', 2], ['bag1', 2], ['bag3', 2], ['shoe3', 2],
      ],
    };
    const results = [];
    for (const [runtimeTier, lines] of Object.entries(linesByTier)) {
      const placement = state.propertyInventory.placements.find((entry) => (
        entry.assetId === `pro-shop-furniture:freestanding-shelving:${runtimeTier}`
      ));
      if (!placement) throw new Error(`Missing ${runtimeTier} shelf placement`);
      for (const [skuId, quantity] of lines) {
        const adopted = lifecycle.adoptExternalInventory(state, {
          skuId, quantity, stage: lifecycle.INVENTORY_STAGE.RESERVE,
          note: `Browser QA stock for ${placement.id}`,
        });
        if (!adopted.ok) throw new Error(adopted.reason);
        stocking.setCarry(state, skuId, quantity, adopted.allocations);
        const stocked = retail.stockRetailShelf(state, placement.id, quantity);
        results.push({ runtimeTier, skuId, quantity, ...stocked });
        if (!stocked.ok || state.shop.carry) throw new Error(stocked.reason || `Carry did not clear for ${skuId}`);
      }
    }
    app.scene3d.clubhouse().rebuildStock();
    return {
      results: results.map((entry) => ({
        runtimeTier: entry.runtimeTier,
        skuId: entry.skuId,
        ok: entry.ok,
        moved: entry.moved || 0,
        placementId: entry.placementId || null,
        zoneName: entry.zoneName || null,
      })),
      summaries: state.propertyInventory.placements
        .filter((entry) => entry.assetId.startsWith('pro-shop-furniture:freestanding-shelving:'))
        .map((entry) => ({
          assetId: entry.assetId,
          placementId: entry.id,
          summary: retail.retailShelfPlacementSummary(state, entry.id),
        })),
    };
  });
  await page.waitForFunction(() => {
    let count = 0;
    window.__fw.scene3d.scene.traverse((object) => {
      if (object.name?.startsWith('retail-shelf:')) count += 1;
    });
    return count === 5;
  }, null, { timeout: 20000 });
  await page.waitForTimeout(850);

  await setCamera(overviewCamera);
  screenshots.push(await capture('01-five-tier-stocked-overview'));
  screenshots.push(await capture('01a-five-tier-progression-crop', {
    clip: { x: 0, y: 145, width: 1600, height: 630 },
  }));
  await setCamera({ at: [-8.20, -3.05], target: [-9.12, -6.18], targetY: 0.92, fov: 50 });
  screenshots.push(await capture('02-basic-standard-stocked'));
  await setCamera({ at: [-9.72, -3.34], target: [-9.84, -6.18], targetY: 0.86, fov: 40 });
  screenshots.push(await capture('02a-basic-wire-detail', {
    clip: { x: 500, y: 55, width: 720, height: 820 },
  }));
  await setCamera({ at: [-8.39, -3.00], target: [-8.39, -6.18], targetY: 0.98, fov: 54 });
  screenshots.push(await capture('02b-standard-detail'));
  await setCamera({ at: [-6.80, -2.85], target: [-6.80, -6.16], targetY: 1.00, fov: 50 });
  screenshots.push(await capture('03-premium-stocked'));
  await setCamera({ at: [-4.10, -2.55], target: [-4.25, -6.15], targetY: 1.18, fov: 62 });
  screenshots.push(await capture('04-high-end-stocked'));
  screenshots.push(await capture('04a-high-end-catalog-crop', {
    clip: { x: 170, y: 145, width: 1260, height: 650 },
  }));

  if (debugStock) {
    const debug = await page.evaluate(async () => {
      const { Raycaster } = await import(new URL('vendor/three.module.js', document.baseURI).href);
      const app = window.__fw;
      const camera = app.scene3d.camera;
      const projected = [];
      const rayHits = [];
      const stockRoots = [];
      const visibleMeshes = [];
      app.scene3d.scene.traverseVisible((object) => {
        if (object.isMesh) visibleMeshes.push(object);
      });
      app.scene3d.scene.traverse((root) => {
        if (!root.name?.startsWith('retail-shelf:')) return;
        stockRoots.push(root);
        const mesh = root.getObjectByProperty('isMesh', true);
        if (!mesh) return;
        mesh.geometry.computeBoundingBox();
        const Box3 = mesh.geometry.boundingBox.constructor;
        const center = new Box3().setFromObject(root).getCenter(root.position.clone());
        const ndc = center.clone().project(camera);
        projected.push({ name: root.name, world: center.toArray(), ndc: ndc.toArray() });
        const raycaster = new Raycaster(camera.position, center.clone().sub(camera.position).normalize());
        raycaster.far = camera.position.distanceTo(center) + 0.75;
        rayHits.push({
          name: root.name,
          hits: raycaster.intersectObjects(visibleMeshes, false)
            .filter((hit) => {
              let cursor = hit.object;
              while (cursor) {
                if (!cursor.visible) return false;
                cursor = cursor.parent;
              }
              return true;
            })
            .slice(0, 20)
            .map((hit) => ({
              distance: hit.distance,
              name: hit.object.name,
              material: Array.isArray(hit.object.material)
                ? hit.object.material.map((material) => material?.name || null)
                : hit.object.material?.name || null,
              point: hit.point.toArray(),
            })),
        });
      });
      for (const root of stockRoots) root.traverse((node) => {
        if (!node.isMesh) return;
        const originals = Array.isArray(node.material) ? node.material : [node.material];
        node.material = originals.map((source) => {
          const material = source.clone();
          material.map = null;
          material.transparent = false;
          material.opacity = 1;
          material.color?.setHex(0xff20d5);
          material.emissive?.setHex(0xff20d5);
          material.emissiveIntensity = 5;
          material.depthTest = true;
          material.depthWrite = true;
          return material;
        });
        if (node.material.length === 1) [node.material] = node.material;
        node.frustumCulled = false;
        node.renderOrder = 9998;
      });
      return { camera: camera.position.toArray(), projected, rayHits };
    });
    screenshots.push(await capture('debug-stock-emissive-depth'));
    await page.evaluate(() => window.__fw.scene3d.scene.traverse((root) => {
      if (root.name?.startsWith('retail-shelf:')) root.position.z += 0.40;
    }));
    screenshots.push(await capture('debug-stock-emissive-forward'));
    await page.evaluate(() => window.__fw.scene3d.scene.traverse((node) => {
      if (!node.isMesh || !node.parent) return;
      let parent = node.parent;
      let isStock = false;
      while (parent) {
        if (parent.name?.startsWith('retail-shelf:')) { isStock = true; break; }
        parent = parent.parent;
      }
      if (!isStock) return;
      for (const material of (Array.isArray(node.material) ? node.material : [node.material])) {
        material.depthTest = false;
        material.depthWrite = false;
      }
      node.renderOrder = 10000;
    }));
    screenshots.push(await capture('debug-stock-emissive-xray'));
    return { ok: true, phase: `retail-shelves-stock-debug-${iteration}`, debug, screenshots };
  }

  const interactionHealthBefore = await runtimeHealthSnapshot();
  const componentSnapshot = async (skuId, componentName, label) => page.evaluate(
    ({ skuId: targetSkuId, componentName: targetComponentName, label: sampleLabel }) => {
      let root = null;
      window.__fw.scene3d.scene.traverse((object) => {
        if (object.name === `PropertyFurniture_${targetSkuId}`) root = object;
      });
      const component = root?.userData.interactiveComponents?.find((entry) => (
        entry.name === targetComponentName
      ));
      return component ? {
        label: sampleLabel,
        progress: component.progress,
        target: component.target,
        open: component.isOpen(),
        position: component.node.position.toArray(),
        quaternion: component.node.quaternion.toArray(),
      } : { label: sampleLabel, missing: true };
    },
    { skuId, componentName, label },
  );

  const highEndDoorSku = 'furn-freestanding-shelving-luxury';
  const luxuryDoorSku = 'furn-freestanding-shelving-executive';
  const cabinetDoorNames = [
    'CabinetDoor_Bay01_Left', 'CabinetDoor_Bay01_Right',
    'CabinetDoor_Bay02_Left', 'CabinetDoor_Bay02_Right',
    'CabinetDoor_Bay03_Left', 'CabinetDoor_Bay03_Right',
  ];
  const waitForComponentProgress = async (skuId, componentName, threshold, comparison) => (
    page.waitForFunction(({ targetSkuId, targetComponentName, targetThreshold, targetComparison }) => {
      let root = null;
      window.__fw.scene3d.scene.traverse((object) => {
        if (object.name === `PropertyFurniture_${targetSkuId}`) root = object;
      });
      const component = root?.userData.interactiveComponents?.find((entry) => (
        entry.name === targetComponentName
      ));
      if (!component) return false;
      return targetComparison === 'at-least'
        ? component.progress >= targetThreshold : component.progress <= targetThreshold;
    }, {
      targetSkuId: skuId,
      targetComponentName: componentName,
      targetThreshold: threshold,
      targetComparison: comparison,
    }, { timeout: 6000 })
  );
  const allDoorCycles = [];
  for (const skuId of [highEndDoorSku, luxuryDoorSku]) {
    for (const componentName of cabinetDoorNames) {
      const cycle = {
        skuId,
        componentName,
        samples: [await componentSnapshot(skuId, componentName, 'closed')],
        inputs: [],
      };
      const openInput = await focusShelfTarget(skuId, componentName);
      cycle.inputs.push(openInput);
      if (openInput.focus.component === componentName) await page.keyboard.press('e');
      await waitForComponentProgress(skuId, componentName, 0.22, 'at-least');
      cycle.samples.push(await componentSnapshot(skuId, componentName, 'opening-quarter'));
      await waitForComponentProgress(skuId, componentName, 0.50, 'at-least');
      cycle.samples.push(await componentSnapshot(skuId, componentName, 'opening-half'));
      await waitForComponentProgress(skuId, componentName, 0.98, 'at-least');
      cycle.samples.push(await componentSnapshot(skuId, componentName, 'open-full'));
      const closeInput = await focusShelfTarget(skuId, componentName);
      cycle.inputs.push(closeInput);
      if (closeInput.focus.component === componentName) await page.keyboard.press('e');
      await waitForComponentProgress(skuId, componentName, 0.78, 'at-most');
      cycle.samples.push(await componentSnapshot(skuId, componentName, 'closing'));
      await waitForComponentProgress(skuId, componentName, 0.02, 'at-most');
      cycle.samples.push(await componentSnapshot(skuId, componentName, 'closed-again'));
      allDoorCycles.push(cycle);
    }
  }

  const highEndLightPlacementId = await page.evaluate(() => (
    window.__fw.state.propertyInventory.placements.find((entry) => (
      entry.assetId === 'pro-shop-furniture:freestanding-shelving:luxury'
    ))?.id || null
  ));
  const highEndLightInputs = [];
  const highEndLightStates = [await page.evaluate((placementId) => (
    window.__fw.state.propertyInventory.placements.find((entry) => entry.id === placementId)
      ?.lightState?.isOn
  ), highEndLightPlacementId)];
  for (const expectedOn of [false, true]) {
    const input = await focusShelfTarget(highEndDoorSku, null, 'INTERACT_ShelfLights');
    highEndLightInputs.push(input);
    if (input.focus.lightControl === 'power') await page.keyboard.press('e');
    await page.waitForFunction(({ placementId, expected }) => (
      window.__fw.state.propertyInventory.placements.find((entry) => entry.id === placementId)
        ?.lightState?.isOn === expected
    ), { placementId: highEndLightPlacementId, expected: expectedOn }, { timeout: 10000 });
    await page.waitForTimeout(260);
    highEndLightStates.push(expectedOn);
    await setCamera({ at: [-4.10, -2.55], target: [-4.25, -6.15], targetY: 1.18, fov: 62 });
    screenshots.push(await capture(expectedOn
      ? '04c-high-end-lights-on' : '04b-high-end-lights-off'));
  }

  const highEndDoorName = 'CabinetDoor_Bay02_Left';
  const highEndDoorMotion = { samples: [], inputPasses: [] };
  const highEndDoorInput = await focusShelfTarget(highEndDoorSku, highEndDoorName);
  highEndDoorMotion.inputPasses.push(highEndDoorInput);
  highEndDoorMotion.samples.push(await componentSnapshot(highEndDoorSku, highEndDoorName, 'closed'));
  if (highEndDoorInput.focus.component === highEndDoorName) {
    await page.keyboard.press('e');
    await page.waitForTimeout(115);
    highEndDoorMotion.samples.push(await componentSnapshot(highEndDoorSku, highEndDoorName, 'opening-quarter'));
    await page.waitForTimeout(115);
    highEndDoorMotion.samples.push(await componentSnapshot(highEndDoorSku, highEndDoorName, 'opening-half'));
    await page.waitForTimeout(350);
    highEndDoorMotion.samples.push(await componentSnapshot(highEndDoorSku, highEndDoorName, 'open-full'));

    const closeInput = await focusShelfTarget(highEndDoorSku, highEndDoorName);
    highEndDoorMotion.inputPasses.push(closeInput);
    if (closeInput.focus.component === highEndDoorName) await page.keyboard.press('e');
    await page.waitForTimeout(115);
    highEndDoorMotion.samples.push(await componentSnapshot(highEndDoorSku, highEndDoorName, 'closing'));
    await page.waitForTimeout(420);
    highEndDoorMotion.samples.push(await componentSnapshot(highEndDoorSku, highEndDoorName, 'closed-again'));

    const repeatInput = await focusShelfTarget(highEndDoorSku, highEndDoorName);
    highEndDoorMotion.inputPasses.push(repeatInput);
    if (repeatInput.focus.component === highEndDoorName) await page.keyboard.press('e');
    await page.waitForTimeout(520);
    highEndDoorMotion.samples.push(await componentSnapshot(highEndDoorSku, highEndDoorName, 'repeat-open-full'));
  }
  screenshots.push(await capture('05-high-end-door-open'));

  const highEndPlacementId = await page.evaluate(() => (
    window.__fw.state.propertyInventory.placements.find((entry) => (
      entry.assetId === 'pro-shop-furniture:freestanding-shelving:luxury'
    ))?.id || null
  ));
  await page.evaluate(async (placementId) => {
    const lifecycle = await import(new URL('src/sim/inventoryLifecycle.js', document.baseURI).href);
    const stocking = await import(new URL('src/sim/stocking.js', document.baseURI).href);
    const adopted = lifecycle.adoptExternalInventory(window.__fw.state, {
      skuId: 'range2', quantity: 1, stage: lifecycle.INVENTORY_STAGE.RESERVE,
      note: `Browser QA cabinet stock for ${placementId}`,
    });
    if (!adopted.ok) throw new Error(adopted.reason);
    stocking.setCarry(window.__fw.state, 'range2', 1, adopted.allocations);
  }, highEndPlacementId);
  const highEndStorageZone = 'STORAGE_ZONE_Bay02_Level01';
  const highEndStorageInput = await focusShelfTarget(highEndDoorSku, null, highEndStorageZone);
  if (highEndStorageInput.focus.retailShelfStorage === highEndPlacementId
      && highEndStorageInput.focus.storageZone === highEndStorageZone) {
    await page.keyboard.press('e');
  }
  await page.waitForFunction(({ placementId, zoneName }) => {
    const placement = window.__fw.state.propertyInventory.placements.find((entry) => entry.id === placementId);
    const zone = placement?.retailShelfStorage?.zones?.[zoneName];
    return zone?.skuId === 'range2' && zone.quantity === 1 && !window.__fw.state.shop.carry;
  }, { placementId: highEndPlacementId, zoneName: highEndStorageZone }, { timeout: 10000 });
  const highEndCompanionDoorInput = await focusShelfTarget(
    highEndDoorSku, 'CabinetDoor_Bay02_Right',
  );
  if (highEndCompanionDoorInput.focus.component === 'CabinetDoor_Bay02_Right') {
    await page.keyboard.press('e');
    await page.waitForFunction((placementId) => (
      window.__fw.state.propertyInventory.placements.find((entry) => entry.id === placementId)
        ?.componentStates?.CabinetDoor_Bay02_Right === true
    ), highEndPlacementId, { timeout: 10000 });
  }
  await page.waitForTimeout(520);
  await setCamera({ at: [-4.25, -2.95], target: [-4.25, -6.14], targetY: 0.43, fov: 52 });
  screenshots.push(await capture('06-high-end-cabinet-stored-product'));

  const cabinetStorageCycles = [];
  for (let cycle = 0; cycle < 2; cycle += 1) {
    const takeInput = await focusShelfTarget(highEndDoorSku, null, highEndStorageZone);
    if (takeInput.focus.retailShelfStorage === highEndPlacementId) await page.keyboard.press('e');
    await page.waitForFunction(() => window.__fw.state.shop.carry?.skuId === 'range2', null, { timeout: 10000 });
    const storeInput = await focusShelfTarget(highEndDoorSku, null, highEndStorageZone);
    if (storeInput.focus.retailShelfStorage === highEndPlacementId) await page.keyboard.press('e');
    await page.waitForFunction(({ placementId, zoneName }) => {
      const placement = window.__fw.state.propertyInventory.placements.find((entry) => entry.id === placementId);
      return placement?.retailShelfStorage?.zones?.[zoneName]?.quantity === 1
        && !window.__fw.state.shop.carry;
    }, { placementId: highEndPlacementId, zoneName: highEndStorageZone }, { timeout: 10000 });
    cabinetStorageCycles.push({ cycle: cycle + 1, takeInput, storeInput });
  }
  const cabinetStorageResult = await page.evaluate(({ placementId, zoneName }) => {
    const placement = window.__fw.state.propertyInventory.placements.find((entry) => entry.id === placementId);
    return {
      placementId,
      zoneName,
      zone: placement?.retailShelfStorage?.zones?.[zoneName] || null,
      carry: window.__fw.state.shop.carry,
      reserve: window.__fw.state.shop.inventory.range2?.back || 0,
    };
  }, { placementId: highEndPlacementId, zoneName: highEndStorageZone });

  const luxuryDoorInput = await focusShelfTarget(
    luxuryDoorSku, 'CabinetDoor_Bay02_Right',
  );
  if (luxuryDoorInput.focus.component === 'CabinetDoor_Bay02_Right') {
    await page.keyboard.press('e');
    await page.waitForFunction(() => window.__fw.state.propertyInventory.placements.some((entry) => (
      entry.assetId === 'pro-shop-furniture:freestanding-shelving:executive'
        && entry.componentStates?.CabinetDoor_Bay02_Right === true
    )), null, { timeout: 10000 });
  }
  const luxuryCompanionDoorInput = await focusShelfTarget(
    luxuryDoorSku, 'CabinetDoor_Bay02_Left',
  );
  if (luxuryCompanionDoorInput.focus.component === 'CabinetDoor_Bay02_Left') {
    await page.keyboard.press('e');
    await page.waitForFunction(() => window.__fw.state.propertyInventory.placements.some((entry) => (
      entry.assetId === 'pro-shop-furniture:freestanding-shelving:executive'
        && entry.componentStates?.CabinetDoor_Bay02_Left === true
    )), null, { timeout: 10000 });
  }
  await page.waitForTimeout(520);
  screenshots.push(await capture('07-luxury-door-open'));

  const luxuryPlacementId = await page.evaluate(() => (
    window.__fw.state.propertyInventory.placements.find((entry) => (
      entry.assetId === 'pro-shop-furniture:freestanding-shelving:executive'
    ))?.id || null
  ));
  await page.evaluate(async (placementId) => {
    const lifecycle = await import(new URL('src/sim/inventoryLifecycle.js', document.baseURI).href);
    const stocking = await import(new URL('src/sim/stocking.js', document.baseURI).href);
    const adopted = lifecycle.adoptExternalInventory(window.__fw.state, {
      skuId: 'range2', quantity: 1, stage: lifecycle.INVENTORY_STAGE.RESERVE,
      note: `Browser QA luxury cabinet stock for ${placementId}`,
    });
    if (!adopted.ok) throw new Error(adopted.reason);
    stocking.setCarry(window.__fw.state, 'range2', 1, adopted.allocations);
  }, luxuryPlacementId);
  const luxuryStorageZone = 'STORAGE_ZONE_Bay02_Level01';
  const luxuryStorageInput = await focusShelfTarget(luxuryDoorSku, null, luxuryStorageZone);
  if (luxuryStorageInput.focus.retailShelfStorage === luxuryPlacementId
      && luxuryStorageInput.focus.storageZone === luxuryStorageZone) {
    await page.keyboard.press('e');
  }
  await page.waitForFunction(({ placementId, zoneName }) => {
    const placement = window.__fw.state.propertyInventory.placements.find((entry) => entry.id === placementId);
    const zone = placement?.retailShelfStorage?.zones?.[zoneName];
    return zone?.skuId === 'range2' && zone.quantity === 1 && !window.__fw.state.shop.carry;
  }, { placementId: luxuryPlacementId, zoneName: luxuryStorageZone }, { timeout: 10000 });
  await page.waitForTimeout(420);
  await setCamera({ at: [-0.25, -2.95], target: [-0.25, -6.12], targetY: 0.45, fov: 52 });
  screenshots.push(await capture('07a-luxury-cabinet-stored-product'));
  const luxuryStorageCycles = [];
  for (let cycle = 0; cycle < 2; cycle += 1) {
    const takeInput = await focusShelfTarget(luxuryDoorSku, null, luxuryStorageZone);
    if (takeInput.focus.retailShelfStorage === luxuryPlacementId) await page.keyboard.press('e');
    await page.waitForFunction(() => window.__fw.state.shop.carry?.skuId === 'range2', null, { timeout: 10000 });
    const storeInput = await focusShelfTarget(luxuryDoorSku, null, luxuryStorageZone);
    if (storeInput.focus.retailShelfStorage === luxuryPlacementId) await page.keyboard.press('e');
    await page.waitForFunction(({ placementId, zoneName }) => {
      const placement = window.__fw.state.propertyInventory.placements.find((entry) => entry.id === placementId);
      return placement?.retailShelfStorage?.zones?.[zoneName]?.quantity === 1
        && !window.__fw.state.shop.carry;
    }, { placementId: luxuryPlacementId, zoneName: luxuryStorageZone }, { timeout: 10000 });
    luxuryStorageCycles.push({ cycle: cycle + 1, takeInput, storeInput });
  }
  const luxuryStorageResult = await page.evaluate(({ placementId, zoneName }) => {
    const placement = window.__fw.state.propertyInventory.placements.find((entry) => entry.id === placementId);
    return {
      placementId,
      zoneName,
      zone: placement?.retailShelfStorage?.zones?.[zoneName] || null,
      carry: window.__fw.state.shop.carry,
    };
  }, { placementId: luxuryPlacementId, zoneName: luxuryStorageZone });
  const luxuryLightInputs = [];
  const luxuryLightStates = [await page.evaluate((placementId) => (
    window.__fw.state.propertyInventory.placements.find((entry) => entry.id === placementId)?.lightState?.isOn
  ), luxuryPlacementId)];
  for (const expectedOn of [false, true, false]) {
    const input = await focusShelfTarget(
      'furn-freestanding-shelving-executive', null, 'INTERACT_ShelfLights',
    );
    luxuryLightInputs.push(input);
    if (input.focus.lightControl === 'power') await page.keyboard.press('e');
    await page.waitForFunction(({ placementId, expected }) => (
      window.__fw.state.propertyInventory.placements.find((entry) => entry.id === placementId)
        ?.lightState?.isOn === expected
    ), { placementId: luxuryPlacementId, expected: expectedOn }, { timeout: 10000 });
    await page.waitForTimeout(260);
    luxuryLightStates.push(expectedOn);
    if (expectedOn === false && luxuryLightStates.length === 2) {
      await setCamera({ at: [2.35, -3.20], target: [-0.25, -6.13], targetY: 1.15, fov: 66 });
      screenshots.push(await capture('08-luxury-lights-off'));
    } else if (expectedOn === true) {
      await setCamera({ at: [2.35, -3.20], target: [-0.25, -6.13], targetY: 1.15, fov: 66 });
      screenshots.push(await capture('09-luxury-lights-on'));
      await setCamera({ at: [-0.25, -2.98], target: [-0.25, -6.13], targetY: 1.22, fov: 60 });
      screenshots.push(await capture('09a-luxury-front-lights-on'));
    }
  }
  const interactionHealthAfter = await runtimeHealthSnapshot();
  const interactionStability = {
    repeatedInputActions: allDoorCycles.length * 2
      + 3 + 1 + 1 + 1
      + cabinetStorageCycles.length * 2 + luxuryStorageCycles.length * 2
      + highEndLightInputs.length + luxuryLightInputs.length,
    listenerGrowth: interactionHealthAfter.eventListeners.total
      - interactionHealthBefore.eventListeners.total,
    heapUsedGrowthBytes: interactionHealthAfter.heap.usedSize - interactionHealthBefore.heap.usedSize,
    heapTotalGrowthBytes: interactionHealthAfter.heap.totalSize - interactionHealthBefore.heap.totalSize,
  };
  await setCamera({ at: [2.35, -3.20], target: [-0.25, -6.13], targetY: 1.15, fov: 66 });
  screenshots.push(await capture('10-luxury-three-quarter-final-off'));

  await setCamera({ at: [3.8, 1.25], target: [3.8, -1.0], targetY: 1.2, fov: 68 });
  await page.mouse.click(800, 450);
  const movementBefore = await page.evaluate(() => ({
    x: window.__fw.scene3d.walk.state.x, z: window.__fw.scene3d.walk.state.z,
  }));
  await page.keyboard.down('w');
  await page.waitForTimeout(600);
  await page.keyboard.up('w');
  await page.keyboard.down('d');
  await page.waitForTimeout(280);
  await page.keyboard.up('d');
  const movementAfter = await page.evaluate(() => ({
    x: window.__fw.scene3d.walk.state.x, z: window.__fw.scene3d.walk.state.z,
  }));
  const movementDistance = Math.hypot(
    movementAfter.x - movementBefore.x, movementAfter.z - movementBefore.z,
  );

  const collision = await page.evaluate(() => {
    const app = window.__fw;
    let root = null;
    app.scene3d.scene.traverse((object) => {
      if (object.name === 'PropertyFurniture_furn-freestanding-shelving-premium') root = object;
    });
    const bounds = new root.position.constructor();
    // Box3 is available from the loaded model's cached world bounds constructor.
    const geometryNode = root.getObjectByProperty('isMesh', true);
    geometryNode.geometry.computeBoundingBox();
    const Box3 = geometryNode.geometry.boundingBox.constructor;
    const worldBounds = new Box3().setFromObject(root);
    worldBounds.getCenter(bounds);
    const walk = app.scene3d.walk;
    walk.clearKeys();
    walk.clearFocus?.();
    walk.state.x = bounds.x;
    walk.state.z = worldBounds.max.z + 1.05;
    walk.state.yaw = 0;
    walk.state.pitch = 0;
    return {
      start: { x: walk.state.x, z: walk.state.z },
      bounds: { minX: worldBounds.min.x, maxX: worldBounds.max.x, minZ: worldBounds.min.z, maxZ: worldBounds.max.z },
    };
  });
  await page.keyboard.down('w');
  await page.waitForTimeout(950);
  await page.keyboard.up('w');
  collision.end = await page.evaluate(() => ({
    x: window.__fw.scene3d.walk.state.x, z: window.__fw.scene3d.walk.state.z,
  }));
  collision.distance = Math.hypot(
    collision.end.x - collision.start.x, collision.end.z - collision.start.z,
  );
  collision.stoppedBeforeMesh = collision.end.z >= collision.bounds.maxZ - 0.02;

  const placementValidation = await page.evaluate(async () => {
    const placementAuthority = await import(new URL('src/sim/propertyPlacement.js', document.baseURI).href);
    const placeables = await import(new URL('src/data/placeableItems.js', document.baseURI).href);
    const layout = await import(new URL('src/data/shopLayout.js', document.baseURI).href);
    const state = window.__fw.state;
    const clonedEmptyState = structuredClone(state);
    clonedEmptyState.propertyInventory.placements = [];
    const byAsset = (suffix) => state.propertyInventory.placements.find((entry) => (
      entry.assetId === `pro-shop-furniture:freestanding-shelving:${suffix}`
    ));
    const validate = (targetState, spec, pose, options = {}) => ({
      pose,
      ...placementAuthority.validatePlaceablePlacement(targetState, spec, pose, options),
    });
    const basicSpec = placeables.placeableSpecBySkuId('furn-freestanding-shelving-basic');
    const premiumSpec = placeables.placeableSpecBySkuId('furn-freestanding-shelving-premium');
    const highEndSpec = placeables.placeableSpecBySkuId('furn-freestanding-shelving-luxury');
    const luxurySpec = placeables.placeableSpecBySkuId('furn-freestanding-shelving-executive');
    const basic = byAsset('basic');
    const standard = byAsset('standard');
    const premium = byAsset('premium');
    const highEnd = byAsset('luxury');
    const luxury = byAsset('executive');
    const north = -layout.INTERIOR.d / 2 + 0.02;
    const cornerPose = placementAuthority.snapPlaceablePose(
      highEndSpec, { x: -layout.INTERIOR.w / 2 + 1.9, z: north }, 0,
    );
    const rotatedPose = placementAuthority.snapPlaceablePose(basicSpec, { x: 1.5, z: -1.5 }, Math.PI / 2);
    const invalidOverlapPose = { ...premium.pose, x: standard.pose.x, z: standard.pose.z };
    const invalidWallRotationPose = { ...highEnd.pose, ry: highEnd.pose.ry + Math.PI / 2 };
    const invalidOutsidePose = { ...basic.pose, x: layout.INTERIOR.w };
    return {
      wallSnappedBuiltIn: validate(state, luxurySpec, luxury.pose, { exceptPlacementId: luxury.id }),
      nearCornerWall: validate(clonedEmptyState, highEndSpec, cornerPose),
      adjacentBasic: validate(state, basicSpec, basic.pose, { exceptPlacementId: basic.id }),
      adjacentStandard: validate(state, placeables.placeableSpec(standard.assetId), standard.pose, {
        exceptPlacementId: standard.id,
      }),
      validNinetyDegreeRotation: validate(clonedEmptyState, basicSpec, rotatedPose),
      invalidOverlap: validate(state, premiumSpec, invalidOverlapPose, { exceptPlacementId: premium.id }),
      invalidWallRotation: validate(state, highEndSpec, invalidWallRotationPose, {
        exceptPlacementId: highEnd.id,
      }),
      invalidOutsideBounds: validate(clonedEmptyState, basicSpec, invalidOutsidePose),
    };
  });

  const runtimeDiagnostics = await page.evaluate(async () => {
    const placementAuthority = await import(new URL('src/sim/propertyPlacement.js', document.baseURI).href);
    const placeables = await import(new URL('src/data/placeableItems.js', document.baseURI).href);
    const layout = await import(new URL('src/data/shopLayout.js', document.baseURI).href);
    const app = window.__fw;
    const placed = app.state.propertyInventory.placements;
    const results = [];
    const shelfSurfaceOffset = placeables
      .placeableSpecBySkuId('furn-freestanding-shelving-luxury')?.wallSnap?.surfaceOffset || 0;
    const productionNorth = -layout.INTERIOR.d / 2 + 0.02 + shelfSurfaceOffset;
    app.scene3d.scene.traverse((root) => {
      if (!root.name?.startsWith('PropertyFurniture_furn-freestanding-shelving-')) return;
      const collisionNodes = [];
      const storageNodes = [];
      const materials = new Set();
      const textures = new Set();
      root.traverse((node) => {
        if (node.isMesh && /^COLLISION_/i.test(node.name || '')) {
          collisionNodes.push({ name: node.name, visible: node.visible });
        }
        if (/^STORAGE_ZONE_/i.test(node.name || '')) storageNodes.push(node.name);
        if (!node.isMesh) return;
        for (const material of (Array.isArray(node.material) ? node.material : [node.material])) {
          if (!material) continue;
          materials.add(material.uuid);
          for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap']) {
            if (material[key]) textures.add(material[key].uuid);
          }
        }
      });
      const runtimeSkuId = root.name.slice('PropertyFurniture_'.length);
      const spec = placeables.placeableSpecBySkuId(runtimeSkuId);
      const placement = placed.find((entry) => entry.assetId === spec?.assetId);
      const stockRoot = app.scene3d.scene.getObjectByName(`retail-shelf:${placement?.id}`);
      const stockMetadata = stockRoot?.userData.retailShelfStock || null;
      let stockMeshes = 0;
      let storageStockMeshes = 0;
      const storageProductRoots = [];
      const stockMeshDetails = [];
      stockRoot?.traverse((node) => {
        if (node.name?.startsWith('CabinetStorage_')) storageProductRoots.push(node.name);
        if (!node.isMesh) return;
        stockMeshes += 1;
        let cursor = node.parent;
        while (cursor && cursor !== stockRoot) {
          if (cursor.name?.startsWith('CabinetStorage_')) {
            storageStockMeshes += 1;
            break;
          }
          cursor = cursor.parent;
        }
        const material = Array.isArray(node.material) ? node.material[0] : node.material;
        stockMeshDetails.push({
          name: node.name,
          visible: node.visible,
          material: material?.name || null,
          color: material?.color?.getHexString?.() || null,
          emissive: material?.emissive?.getHexString?.() || null,
          opacity: material?.opacity ?? null,
          transparent: material?.transparent ?? null,
          map: material?.map?.name || material?.map?.uuid || null,
        });
      });
      const validation = placementAuthority.validatePlaceablePlacement(
        app.state, spec, placement?.pose, { exceptPlacementId: placement?.id },
      );
      const productionWallClearance = placement?.pose && spec?.placementProfile
        ? placement.pose.z - spec.placementProfile.depth / 2 - productionNorth : null;
      const functional = root.userData.functionalNodes;
      const lod = root.userData.authoredLod;
      const zoneNames = (functional?.names || []).filter((name) => (
        /^SHELF_ZONE_(?:\d+|BAY\d+_LEVEL\d+)$/.test(name)
      ));
      const Vector3 = root.position.constructor;
      const zonePositions = zoneNames.map((name) => {
        const node = functional.byName[name];
        return { name, local: node.position.toArray(), world: node.getWorldPosition(new Vector3()).toArray() };
      });
      const firstMesh = root.getObjectByProperty('isMesh', true);
      firstMesh.geometry.computeBoundingBox();
      const Box3 = firstMesh.geometry.boundingBox.constructor;
      const furnitureBounds = new Box3().setFromObject(root);
      const stockBounds = stockRoot ? new Box3().setFromObject(stockRoot) : null;
      results.push({
        skuId: runtimeSkuId,
        assetId: placement?.assetId || null,
        placementId: placement?.id || null,
        pose: placement?.pose || null,
        loaded: root.userData.loaded === true,
        loadError: root.userData.loadError || null,
        modelPath: root.userData.modelPath,
        shelfZones: zoneNames.length,
        zonePositions,
        lightNodes: functional?.lightNodes?.length || 0,
        runtimeLights: root.userData.runtimeLights?.length || 0,
        lightControl: functional?.lightControl?.name || null,
        lightState: placement?.lightState || null,
        lightingDiagnostics: root.userData.ceilingLightController?.diagnostics?.() || null,
        interactionPoint: functional?.interactionPoint?.name || null,
        placementFootprint: functional?.placementFootprint?.name || null,
        wallSnapAnchor: functional?.wallSnapAnchor?.name || null,
        floorContactCenter: functional?.floorContactCenter?.name || null,
        collisionNodes,
        storageNodes,
        components: (root.userData.interactiveComponents || []).map((component) => ({
          name: component.name, type: component.type, open: component.isOpen(),
          progress: component.progress, storageCapacity: component.storageCapacity,
        })),
        lod: lod ? {
          levels: lod.levels.map((level) => ({ name: level.object.name, distance: level.distance })),
          selections: [0, 10, 25].map((distance) => (
            lod.levels.findIndex((level) => level.object === lod.getObjectForDistance(distance))
          )),
        } : null,
        runtimeBatch: root.userData.runtimeBatch || null,
        materialCount: materials.size,
        textureCount: textures.size,
        stockMeshes,
        storageStockMeshes,
        storageProductRoots,
        stockMetadata,
        functionalStorageCapacity: Number(spec?.functionalProfile?.storageCapacity) || 0,
        functionalStorageZoneCapacity: Number(spec?.functionalProfile?.storageZoneCapacity) || 0,
        storageAssignments: Object.entries(placement?.retailShelfStorage?.zones || {})
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([zoneName, zone]) => ({ zoneName, skuId: zone.skuId, quantity: zone.quantity })),
        stockMeshDetails,
        productionWallClearance,
        furnitureBounds: {
          min: furnitureBounds.min.toArray(), max: furnitureBounds.max.toArray(),
        },
        stockBounds: stockBounds ? {
          min: stockBounds.min.toArray(), max: stockBounds.max.toArray(),
        } : null,
        validation,
      });
    });
    return results.sort((a, b) => a.modelPath.localeCompare(b.modelPath));
  });

  const saveRoundTrip = await page.evaluate(async () => {
    const empire = await import(new URL('src/sim/empire.js', document.baseURI).href);
    const snapshot = empire.empireSnapshot(window.__fw.empire);
    const restored = empire.deserializeEmpire(JSON.stringify(snapshot));
    const state = empire.activeState(restored);
    return {
      serializedBytes: JSON.stringify(snapshot).length,
      placements: state.propertyInventory.placements
        .filter((entry) => entry.assetId.startsWith('pro-shop-furniture:freestanding-shelving:'))
        .map((entry) => {
          const zones = Object.entries(entry.retailShelfStock?.zones || {}).sort(([a], [b]) => a.localeCompare(b));
          const storageZones = Object.entries(entry.retailShelfStorage?.zones || {})
            .sort(([a], [b]) => a.localeCompare(b));
          return {
            assetId: entry.assetId,
            pose: entry.pose,
            componentStates: entry.componentStates,
            lightState: entry.lightState,
            zoneCount: zones.length,
            units: zones.reduce((sum, [, zone]) => sum + zone.quantity, 0),
            stockSignature: zones.map(([name, zone]) => `${name}:${zone.skuId}:${zone.quantity}`).join('|'),
            storageZoneCount: storageZones.length,
            storageUnits: storageZones.reduce((sum, [, zone]) => sum + zone.quantity, 0),
            storageSignature: storageZones
              .map(([name, zone]) => `${name}:${zone.skuId}:${zone.quantity}`).join('|'),
          };
        }),
    };
  });

  await setCamera(overviewCamera);
  const performanceAfter = await performanceRuns();
  const performanceDelta = performanceAfter.map((after, index) => {
    const before = performanceBefore[Math.min(index, performanceBefore.length - 1)];
    return {
      averageFpsPercent: before.averageFps > 0
        ? (after.averageFps - before.averageFps) / before.averageFps * 100 : 0,
      onePercentLowFpsPercent: before.onePercentLowFps > 0
        ? (after.onePercentLowFps - before.onePercentLowFps) / before.onePercentLowFps * 100 : 0,
      drawCalls: after.drawCalls - before.drawCalls,
      renderedTriangles: after.renderedTriangles - before.renderedTriangles,
      visibleMeshes: after.visibleMeshes - before.visibleMeshes,
      sceneTriangles: after.sceneTriangles - before.sceneTriangles,
      uniqueMaterials: after.uniqueMaterials - before.uniqueMaterials,
      uniqueTextures: after.uniqueTextures - before.uniqueTextures,
      estimatedTextureBytesRGBA8WithMipmaps:
        after.estimatedTextureBytesRGBA8WithMipmaps - before.estimatedTextureBytesRGBA8WithMipmaps,
      heapBytes: after.heapBytes != null && before.heapBytes != null
        ? after.heapBytes - before.heapBytes : null,
      uiMutationRecordsPerSecond:
        after.uiMutationRecordsPerSecond - before.uiMutationRecordsPerSecond,
    };
  });

  let reloadResult = null;
  if (verifyReload) {
    const autosave = await page.evaluate(() => window.__fw.autosave());
    intentionalReload = true;
    await page.reload({ waitUntil: 'domcontentloaded' });
    await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`)).clickThroughMenu(page);
    await waitForGame();
    try {
      await page.waitForFunction(() => {
        const roots = window.__fw.scene3d.clubhouse().propertyFurnitureDiagnostics()
          .filter((entry) => entry.skuId.startsWith('furn-freestanding-shelving-'));
        return roots.length === 5
          && roots.every((root) => root.loaded === true && !root.loadError && root.lod?.levels === 3);
      }, null, { timeout: 90000 });
    } catch (error) {
      const reloadDebug = await page.evaluate(() => ({
        placements: window.__fw.state.propertyInventory.placements
          .filter((entry) => entry.assetId.startsWith('pro-shop-furniture:freestanding-shelving:'))
          .map((entry) => ({ id: entry.id, assetId: entry.assetId })),
        roots: window.__fw.scene3d.clubhouse().propertyFurnitureDiagnostics()
          .filter((entry) => entry.skuId.startsWith('furn-freestanding-shelving-'))
          .map((entry) => ({
            placementId: entry.placementId,
            skuId: entry.skuId,
            loaded: entry.loaded,
            loadError: entry.loadError,
            lod: entry.lod,
          })),
      }));
      fs.writeFileSync(
        path.join(outDir, 'reload-timeout-diagnostics.json'),
        `${JSON.stringify(reloadDebug, null, 2)}\n`,
      );
      throw error;
    }
    intentionalReload = false;
    await page.waitForTimeout(1100);
    reloadResult = await page.evaluate((autosaveResult) => ({
      autosavePlacements: window.__fw.state.propertyInventory.placements
        .filter((entry) => entry.assetId.startsWith('pro-shop-furniture:freestanding-shelving:'))
        .map((entry) => {
          const zones = Object.entries(entry.retailShelfStock?.zones || {});
          const storageZones = Object.entries(entry.retailShelfStorage?.zones || {});
          return {
            assetId: entry.assetId,
            componentStates: entry.componentStates,
            lightState: entry.lightState,
            zoneCount: zones.length,
            units: zones.reduce((sum, [, zone]) => sum + zone.quantity, 0),
            storageZoneCount: storageZones.length,
            storageUnits: storageZones.reduce((sum, [, zone]) => sum + zone.quantity, 0),
            storageSignature: storageZones
              .map(([name, zone]) => `${name}:${zone.skuId}:${zone.quantity}`).sort().join('|'),
          };
        }),
      loadedRoots: window.__fw.scene3d.clubhouse().propertyFurnitureDiagnostics()
        .filter((entry) => entry.skuId.startsWith('furn-freestanding-shelving-')),
      autosave: autosaveResult,
    }), autosave);
    await setCamera(overviewCamera);
    screenshots.push(await capture('11-after-autosave-reload'));
  }

  const expected = {
    'shelf_basic.glb': {
      zones: 3, collision: 7, doors: 0, storage: 0, storageCapacity: 0,
      lightNodes: 0, lights: 0, lightControl: null,
    },
    'shelf_standard.glb': {
      zones: 3, collision: 7, doors: 0, storage: 0, storageCapacity: 0,
      lightNodes: 0, lights: 0, lightControl: null,
    },
    'shelf_premium.glb': {
      zones: 3, collision: 7, doors: 0, storage: 0, storageCapacity: 0,
      lightNodes: 0, lights: 0, lightControl: null,
    },
    'shelf_high_end.glb': {
      zones: 15, collision: 9, doors: 6, storage: 6, storageCapacity: 36,
      lightNodes: 3, lights: 3, lightControl: 'INTERACT_ShelfLights',
    },
    'shelf_luxury.glb': {
      zones: 15, collision: 9, doors: 6, storage: 6, storageCapacity: 36,
      lightNodes: 15, lights: 3, lightControl: 'INTERACT_ShelfLights',
    },
  };
  const assetGates = runtimeDiagnostics.map((asset) => {
    const contract = expected[asset.modelPath.split('/').at(-1)];
    return {
      skuId: asset.skuId,
      loaded: asset.loaded && !asset.loadError,
      functionalNodes: !!contract
        && asset.shelfZones === contract.zones
        && asset.interactionPoint === 'INTERACTION_POINT'
        && asset.placementFootprint === 'PLACEMENT_FOOTPRINT'
        && asset.wallSnapAnchor === 'WALL_SNAP_ANCHOR'
        && asset.floorContactCenter === 'FLOOR_CONTACT_CENTER',
      collisionContract: !!contract
        && asset.collisionNodes.length === contract.collision
        && asset.collisionNodes.every((node) => !node.visible),
      cabinetContract: !!contract
        && asset.components.length === contract.doors
        && asset.storageNodes.length === contract.storage
        && asset.functionalStorageCapacity === contract.storageCapacity
        && asset.functionalStorageZoneCapacity === (contract.storage ? 6 : 0),
      lightingContract: !!contract
        && asset.lightNodes === contract.lightNodes
        && asset.runtimeLights === contract.lights
        && asset.lightControl === contract.lightControl
        && (!!asset.lightingDiagnostics === (contract.lights > 0)),
      lodContract: asset.lod?.levels?.length === 3
        && JSON.stringify(asset.lod.selections) === JSON.stringify([0, 1, 2]),
      runtimeBatched: asset.runtimeBatch?.reducedBy > 0
        && asset.runtimeBatch?.levels?.length === 3,
      pbrResources: asset.materialCount > 0 && asset.textureCount > 0,
      dynamicStockVisible: asset.stockMeshes > 0 && asset.productionWallClearance >= -0.05,
      placementValid: asset.validation.ok,
    };
  });
  const placedAssets = runtimeDiagnostics.map((asset) => asset.assetId);
  const wallSnapped = runtimeDiagnostics
    .filter((asset) => /:(?:luxury|executive)$/.test(asset.assetId))
    .every((asset) => asset.pose?.surfaceId?.startsWith('wall:north:') && asset.validation.ok);
  const assignedUnits = stockingFixture.summaries.reduce((sum, entry) => sum + entry.summary.units, 0);
  const roundTripUnits = saveRoundTrip.placements.reduce((sum, entry) => sum + entry.units, 0);
  const roundTripStorageUnits = saveRoundTrip.placements
    .reduce((sum, entry) => sum + entry.storageUnits, 0);
  const roundTripHighEnd = saveRoundTrip.placements.find((entry) => (
    entry.assetId === 'pro-shop-furniture:freestanding-shelving:luxury'
  ));
  const roundTripLuxury = saveRoundTrip.placements.find((entry) => (
    entry.assetId === 'pro-shop-furniture:freestanding-shelving:executive'
  ));
  const doorSamples = Object.fromEntries(highEndDoorMotion.samples.map((sample) => [sample.label, sample]));
  const doorMotionVerified = highEndDoorMotion.inputPasses.length === 3
    && highEndDoorMotion.inputPasses.every((input) => input.focus.component === highEndDoorName)
    && doorSamples.closed?.progress <= 0.02
    && doorSamples['opening-quarter']?.progress >= 0.12
    && doorSamples['opening-quarter']?.progress <= 0.48
    && doorSamples['opening-half']?.progress >= 0.32
    && doorSamples['opening-half']?.progress <= 0.78
    && doorSamples['open-full']?.progress >= 0.98
    && doorSamples.closing?.progress > 0.05
    && doorSamples.closing?.progress < 0.95
    && doorSamples['closed-again']?.progress <= 0.02
    && doorSamples['repeat-open-full']?.progress >= 0.98;
  const allDoorCyclesVerified = allDoorCycles.length === 12 && allDoorCycles.every((cycle) => {
    const samples = Object.fromEntries(cycle.samples.map((sample) => [sample.label, sample]));
    return cycle.inputs.length === 2
      && cycle.inputs.every((input) => input.focus.component === cycle.componentName)
      && samples.closed?.progress <= 0.02
      && samples['opening-quarter']?.progress >= 0.20
      && samples['opening-quarter']?.progress < 0.50
      && samples['opening-half']?.progress >= 0.48
      && samples['opening-half']?.progress < 0.82
      && samples['open-full']?.progress >= 0.98
      && samples.closing?.progress > 0.05
      && samples.closing?.progress <= 0.80
      && samples['closed-again']?.progress <= 0.02;
  });
  const validPlacementCases = [
    placementValidation.wallSnappedBuiltIn,
    placementValidation.nearCornerWall,
    placementValidation.adjacentBasic,
    placementValidation.adjacentStandard,
    placementValidation.validNinetyDegreeRotation,
  ];
  const invalidPlacementCases = [
    placementValidation.invalidOverlap,
    placementValidation.invalidWallRotation,
    placementValidation.invalidOutsideBounds,
  ];
  const baselineUiRate = performanceBefore.reduce((sum, run) => (
    sum + run.uiMutationRecordsPerSecond
  ), 0) / Math.max(1, performanceBefore.length);
  const afterUiRate = performanceAfter.reduce((sum, run) => (
    sum + run.uiMutationRecordsPerSecond
  ), 0) / Math.max(1, performanceAfter.length);
  const performanceWithinBudget = !measurePerformance || performanceAfter.every((run, index) => (
    run.averageFps >= 55
      && run.onePercentLowFps >= 30
      && run.worstFrameMs <= 120
      && performanceDelta[index].drawCalls <= 400
  ));
  const hardDiagnostics = diagnostics.consoleErrors.length
    + diagnostics.pageErrors.length + diagnostics.failedRequests.length;
  const gates = {
    comparisonFixturePlaced: fixture.placements.length === 4
      && fixture.placements.every((entry) => entry.ok),
    basicPlacedThroughNormalControls: basicPreview.validation.ok
      && placedAssets.includes('pro-shop-furniture:freestanding-shelving:basic'),
    buildModeCleansUpAfterPlacement: !postPlacementBuildState.active
      && !postPlacementBuildState.decorCarry
      && !postPlacementBuildState.ghost?.visible,
    normalStockInteraction: normalStockInput.aim.ok
      && normalStockInput.focus.retailShelfStock === basicPlacementId,
    allFiveModelsLoaded: assetGates.length === 5 && assetGates.every((entry) => entry.loaded),
    exactFunctionalContracts: assetGates.every((entry) => entry.functionalNodes),
    hiddenMultipartCollisions: assetGates.every((entry) => entry.collisionContract),
    exactCabinetStorageContracts: assetGates.every((entry) => entry.cabinetContract),
    authoredLightingActive: assetGates.every((entry) => entry.lightingContract),
    runtimeLodsSwitch: assetGates.every((entry) => entry.lodContract),
    runtimeDrawReduction: assetGates.every((entry) => entry.runtimeBatched),
    pbrTexturesResolved: assetGates.every((entry) => entry.pbrResources),
    dynamicProductsVisible: assetGates.every((entry) => entry.dynamicStockVisible),
    allPlacementsValid: assetGates.every((entry) => entry.placementValid),
    wallAnchorsSnapped: wallSnapped,
    placementMatrixValid: validPlacementCases.every((entry) => entry.ok)
      && invalidPlacementCases.every((entry) => !entry.ok),
    everyCabinetDoorMotionThroughNormalInput: allDoorCyclesVerified,
    fullDoorMotionThroughNormalInput: doorMotionVerified,
    bothDoorsOpenedThroughNormalInput: highEndDoorInput.focus.component === 'CabinetDoor_Bay02_Left'
      && luxuryDoorInput.focus.component === 'CabinetDoor_Bay02_Right'
      && runtimeDiagnostics.filter((asset) => asset.components.some((component) => component.open)).length === 2,
    companionCabinetDoorOpenedThroughNormalInput:
      highEndCompanionDoorInput.focus.component === 'CabinetDoor_Bay02_Right'
      && luxuryCompanionDoorInput.focus.component === 'CabinetDoor_Bay02_Left'
      && runtimeDiagnostics.find((asset) => (
        asset.assetId === 'pro-shop-furniture:freestanding-shelving:luxury'
      ))?.components?.find((component) => component.name === 'CabinetDoor_Bay02_Right')?.open === true,
    normalCabinetStorageInteraction: highEndStorageInput.focus.retailShelfStorage === highEndPlacementId
      && highEndStorageInput.focus.storageZone === highEndStorageZone
      && cabinetStorageResult.zone?.skuId === 'range2'
      && cabinetStorageResult.zone?.quantity === 1
      && cabinetStorageResult.carry == null
      && cabinetStorageCycles.every((cycle) => (
        cycle.takeInput.focus.retailShelfStorage === highEndPlacementId
          && cycle.storeInput.focus.retailShelfStorage === highEndPlacementId
      ))
      && luxuryStorageInput.focus.retailShelfStorage === luxuryPlacementId
      && luxuryStorageInput.focus.storageZone === luxuryStorageZone
      && luxuryStorageResult.zone?.skuId === 'range2'
      && luxuryStorageResult.zone?.quantity === 1
      && luxuryStorageResult.carry == null
      && luxuryStorageCycles.every((cycle) => (
        cycle.takeInput.focus.retailShelfStorage === luxuryPlacementId
          && cycle.storeInput.focus.retailShelfStorage === luxuryPlacementId
      )),
    cabinetProductRenderedInsideOpenBay: runtimeDiagnostics.some((asset) => (
      asset.assetId === 'pro-shop-furniture:freestanding-shelving:luxury'
        && asset.stockMetadata?.storageProductCount === 1
        && asset.stockMetadata?.storageAssignments?.some((assignment) => (
          assignment.zoneName === highEndStorageZone
            && assignment.skuId === 'range2'
            && assignment.quantity === 1
        ))
    )) && runtimeDiagnostics.some((asset) => (
      asset.assetId === 'pro-shop-furniture:freestanding-shelving:executive'
        && asset.stockMetadata?.storageProductCount === 1
        && asset.stockMetadata?.storageAssignments?.some((assignment) => (
          assignment.zoneName === luxuryStorageZone
            && assignment.skuId === 'range2'
            && assignment.quantity === 1
        ))
    )),
    integratedLightsToggleThroughNormalInput: JSON.stringify(highEndLightStates)
      === JSON.stringify([true, false, true])
      && JSON.stringify(luxuryLightStates) === JSON.stringify([true, false, true, false])
      && highEndLightInputs.every((input) => input.focus.lightControl === 'power')
      && luxuryLightInputs.every((input) => input.focus.lightControl === 'power'),
    repeatedInteractionsDoNotGrowListeners: interactionStability.repeatedInputActions >= 10
      && interactionStability.listenerGrowth === 0,
    repeatedInteractionsHeapStable: interactionStability.heapUsedGrowthBytes <= 16 * 1024 * 1024,
    uiUpdateRateStable: !measurePerformance
      || afterUiRate <= Math.max(30, baselineUiRate + 10),
    normalFirstPersonMovement: movementDistance > 0.2,
    collisionStopsPlayer: collision.stoppedBeforeMesh && collision.distance < 1.15,
    saveRoundTripPreservesStock: saveRoundTrip.placements.length === 5
      && roundTripUnits === assignedUnits
      && roundTripStorageUnits === 2
      && roundTripHighEnd?.storageUnits === 1
      && roundTripHighEnd?.lightState?.isOn === true
      && roundTripLuxury?.storageUnits === 1
      && roundTripLuxury?.lightState?.isOn === false,
    autosaveReloadPreservesRuntime: !verifyReload || (
      reloadResult?.autosavePlacements?.length === 5
      && reloadResult.loadedRoots.length === 5
      && reloadResult.loadedRoots.every((entry) => entry.loaded && !entry.loadError)
      && reloadResult.autosavePlacements.reduce((sum, entry) => sum + entry.storageUnits, 0) === 2
      && reloadResult.autosavePlacements.find((entry) => (
        entry.assetId === 'pro-shop-furniture:freestanding-shelving:luxury'
      ))?.lightState?.isOn === true
      && reloadResult.autosavePlacements.find((entry) => (
        entry.assetId === 'pro-shop-furniture:freestanding-shelving:executive'
      ))?.lightState?.isOn === false
    ),
    noHardBrowserDiagnostics: hardDiagnostics === 0,
    performanceWithinBudget,
  };
  const inspectionChecklist = [
    'five-tier silhouette and quality progression',
    'reference-specific dimensions and proportions',
    'player build-mode placement',
    'wall, near-corner, adjacent, rotated, overlap, and out-of-bounds placement cases',
    'dynamic product stocking through E',
    'product fit inside authored shelf clearances',
    'every cabinet leaf closed, quarter, half, full, closing, and closed again through E',
    'repeated cabinet motion plus both built-ins store/take cycles through E',
    'both warm integrated-light circuits switched off/on through E',
    'hidden multipart collision meshes',
    'first-person movement and collision response',
    'LOD0/LOD1/LOD2 runtime switching',
    'PBR texture resolution',
    'save/load inventory conservation',
    'console, page, and request diagnostics',
    'before/after frame-time, render work, materials, texture memory, heap, listeners, and UI update rate',
  ];
  const runtimeEnvironment = await page.evaluate(() => {
    const renderer = window.__fw.scene3d.renderer;
    const gl = renderer.getContext();
    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      userAgent: navigator.userAgent,
      viewport: [innerWidth, innerHeight],
      devicePixelRatio,
      webglVendor: debugInfo ? gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
      webglRenderer: debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    };
  });
  const result = {
    ok: Object.values(gates).every(Boolean),
    phase: `retail-shelves-browser-iteration-${iteration}`,
    launch: `node tools/qa/run-playwright.cjs tools/qa/retail-shelves-qa.js --bootstrap`,
    iteration,
    baselineFixture,
    fixture,
    basicPreview,
    postPlacementBuildState,
    normalStockInput,
    stockingFixture,
    allDoorCycles,
    highEndLightInputs,
    highEndLightStates,
    highEndDoorInput,
    highEndDoorMotion,
    highEndStorageInput,
    highEndCompanionDoorInput,
    cabinetStorageCycles,
    cabinetStorageResult,
    luxuryDoorInput,
    luxuryCompanionDoorInput,
    luxuryStorageInput,
    luxuryStorageCycles,
    luxuryStorageResult,
    luxuryLightInputs,
    luxuryLightStates,
    interactionHealth: {
      before: interactionHealthBefore,
      after: interactionHealthAfter,
      stability: interactionStability,
    },
    movement: { before: movementBefore, after: movementAfter, distance: movementDistance },
    collision,
    placementValidation,
    screenshots,
    runtimeDiagnostics,
    assetGates,
    saveRoundTrip,
    reloadResult,
    performance: {
      protocol: {
        scenario: 'legacy clubhouse, business closed, game speed paused, fixed comparison camera',
        viewport: [1600, 900],
        warmupMs: 1400,
        runs: measurePerformance ? 3 : 1,
        sampleDurationMs: measurePerformance ? 5000 : 1800,
        frameRateUnits: 'frames per second',
        frameTimeUnits: 'milliseconds',
        memoryUnits: 'bytes',
        textureEstimate: 'RGBA8 with complete mip chain, unique visible textures',
      },
      environment: runtimeEnvironment,
      before: performanceBefore,
      after: performanceAfter,
      delta: performanceDelta,
      uiRateSummary: { baselineRecordsPerSecond: baselineUiRate, afterRecordsPerSecond: afterUiRate },
    },
    inspectionChecklist,
    gates,
    diagnostics,
  };
  fs.writeFileSync(path.join(outDir, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}
