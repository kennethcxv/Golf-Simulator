async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const repoRoot = process.env.QA_REPO_ROOT || process.cwd();
  const iteration = Number(process.env.QA_ITERATION || 1);
  const outDir = process.env.QA_OUT_DIR
    || path.join(repoRoot, 'qa', 'clothing_racks', 'browser', `iteration-${iteration}`);
  const measurePerformance = process.env.QA_MEASURE_PERF === '1';
  const verifyReload = process.env.QA_SAVE_RELOAD === '1';
  fs.mkdirSync(outDir, { recursive: true });

  const diagnostics = { consoleErrors: [], consoleWarnings: [], pageErrors: [], failedRequests: [] };
  let intentionalReloadInProgress = false;
  page.on('console', (message) => {
    if (message.type() === 'error') diagnostics.consoleErrors.push(message.text());
    if (message.type() === 'warning') diagnostics.consoleWarnings.push(message.text());
  });
  page.on('pageerror', (error) => diagnostics.pageErrors.push(error.message));
  page.on('requestfailed', (request) => {
    const error = request.failure()?.errorText || 'unknown';
    // Chromium cancels still-pending fetches with ERR_ABORTED when Playwright
    // intentionally reloads the page. The post-reload loaded-count/path gates
    // below prove the rack requests restarted and completed successfully.
    if (intentionalReloadInProgress && error === 'net::ERR_ABORTED') return;
    diagnostics.failedRequests.push({ url: request.url(), error });
  });

  const waitForGame = async () => {
    await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 45000 });
    await page.waitForFunction(() => {
      const veil = document.querySelector('.load-veil');
      return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
    }, null, { timeout: 45000 });
    await page.waitForTimeout(1800);
  };

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(baseUrl);
  await page.getByText('Continue', { exact: true }).click();
  await waitForGame();

  const fixtureResult = await page.evaluate(async () => {
    const app = window.__fw;
    const inventory = await import('/src/sim/propertyInventory.js');
    const shop = await import('/src/sim/shop.js');
    const layout = await import('/src/sim/layout.js');
    const campaign = await import('/src/sim/campaign.js');
    const state = app.state;
    const clubhouse = app.scene3d.clubhouse();
    app.scene3d.walk.clearKeys();
    clubhouse.setOrganicWalkins(false);
    clubhouse.clearWalkins();
    state.tutorial.complete = true;
    state.tutorial.hidden = true;
    // Complete the opening campaign through its supported state transition so
    // both markers and damaged repair pieces leave the finished-showroom view.
    // Rack ownership, placement, and persistence still use production APIs.
    campaign.disableCampaign(state);
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

    // The fixture is a clean, save-backed showroom. Store movable retail
    // fixtures through the production layout API so the rack silhouettes can
    // be judged without unrelated starter displays occupying the same floor.
    const storedFixtures = [];
    const retainedFixtures = [];
    for (const fixture of layout.placedFixtures(state)) {
      const result = layout.storeObject(state, fixture.id, { history: false });
      if (result.ok) storedFixtures.push(fixture.id);
      else retainedFixtures.push({ id: fixture.id, reason: result.reason });
    }

    // Remove only pre-existing decor through its save authorities. A fresh
    // --bootstrap run has none, but this keeps a rerun deterministic.
    state.shop.reno.decor = [];
    state.propertyInventory.items = [];
    state.propertyInventory.placements = [];
    state.propertyInventory.pendingDeliveries = [];
    state.propertyInventory.operations = [];
    state.propertyInventory.nextItemId = 1;
    state.propertyInventory.nextPlacementId = 1;

    const racks = [
      { skuId: 'furn-clothing-racks-basic', x: -9.50, z: -1.80, ry: 0, controls: true },
      { skuId: 'furn-clothing-racks-standard', x: -7.30, z: -1.80, ry: 0 },
      { skuId: 'furn-clothing-racks-premium', x: -4.85, z: -1.80, ry: 0 },
      { skuId: 'furn-clothing-racks-luxury', x: -1.55, z: -1.80, ry: 0 },
      { skuId: 'furn-clothing-racks-executive', x: 2.20, z: -1.80, ry: 0 },
    ];
    const placements = [];
    for (const rack of racks) {
      state.shop.inventory[rack.skuId] = { shelf: 0, back: 1 };
      inventory.importLegacyStoredPlaceables(state, rack.skuId, 1);
      if (rack.controls) continue;
      const placed = shop.placeDecorFree(state, rack.skuId, {
        area: 'clubhouse', mount: 'floor', x: rack.x, y: 0, z: rack.z,
        ry: rack.ry, surfaceId: `qa:clothing-rack:${rack.skuId}`,
      });
      placements.push({ skuId: rack.skuId, ok: placed.ok, reason: placed.reason || null });
    }
    clubhouse.refreshCampaign();
    return { racks, placements, storedFixtures, retainedFixtures };
  });

  // Place Basic through the same B -> I -> E -> aim -> E controls used by a
  // player. The fixture only prepared ownership and the other four comparison
  // tiers; it does not bypass the real placement interaction under test.
  const aimAtFloor = async (at, target) => {
    await page.evaluate(({ at, target }) => {
      const app = window.__fw;
      const interior = app.scene3d.clubhouse().interior;
      const walk = app.scene3d.walk.state;
      app.scene3d.walk.clearKeys();
      const origin = interior.localToWorld(new interior.position.constructor(at[0], 0, at[1]));
      const destination = interior.localToWorld(new interior.position.constructor(target[0], 0, target[1]));
      walk.x = origin.x;
      walk.z = origin.z;
      const dx = destination.x - origin.x;
      const dz = destination.z - origin.z;
      const distance = Math.hypot(dx, dz) || 0.001;
      walk.yaw = Math.atan2(-dx / distance, -dz / distance);
      walk.pitch = -Math.atan2(walk.eye || 1.62, distance);
    }, { at, target });
    await page.waitForTimeout(450);
  };

  await aimAtFloor([-9.50, 2.00], [-9.50, -1.80]);
  await page.keyboard.press('b');
  await page.waitForFunction(() => window.__fw.scene3d.clubhouse().build.isActive());
  await page.keyboard.press('i');
  await page.waitForFunction(() => window.__fw.scene3d.clubhouse().build.isInventoryOpen());
  await page.keyboard.press('e');
  await page.waitForFunction(() => (
    window.__fw.scene3d.clubhouse().build.diagnostics().decorCarry?.skuId
      === 'furn-clothing-racks-basic'
  ));
  await aimAtFloor([-9.50, 2.00], [-9.50, -1.80]);
  const legalBasicPreview = await page.evaluate(() => (
    window.__fw.scene3d.clubhouse().build.diagnostics()
  ));
  if (legalBasicPreview.validation.ok) await page.keyboard.press('e');
  await page.waitForFunction(() => window.__fw.state.shop.reno.decor.some((entry) => (
    entry.skuId === 'furn-clothing-racks-basic'
  )), null, { timeout: 10000 });
  await page.keyboard.press('b');
  await page.waitForFunction(() => !window.__fw.scene3d.clubhouse().build.isActive());

  await page.waitForFunction(() => {
    let count = 0;
    window.__fw.scene3d.scene.traverse((object) => {
      if (object.name?.startsWith('PropertyFurniture_furn-clothing-racks-')) count += 1;
    });
    return count === 5;
  }, null, { timeout: 20000 });
  await page.evaluate(async () => {
    const groups = [];
    window.__fw.scene3d.scene.traverse((object) => {
      if (object.name?.startsWith('PropertyFurniture_furn-clothing-racks-')) groups.push(object);
    });
    await Promise.all(groups.map((group) => group.userData.ready));
  });
  await page.waitForTimeout(1600);
  await page.evaluate(async () => {
    const ui = await import('/src/ui/ui.js');
    ui.clearNotifications();
  });
  await page.waitForTimeout(350);

  const setCamera = async ({ at, target, targetY = 1.15, minute = 840 }) => {
    await page.evaluate(({ at, target, targetY, minute }) => {
      const app = window.__fw;
      const interior = app.scene3d.clubhouse().interior;
      const walk = app.scene3d.walk.state;
      app.scene3d.walk.clearKeys();
      app.scene3d.walk.setSpraying(false);
      const atWorld = interior.localToWorld(new interior.position.constructor(at[0], 0, at[1]));
      const targetWorld = interior.localToWorld(new interior.position.constructor(target[0], 0, target[1]));
      walk.x = atWorld.x;
      walk.z = atWorld.z;
      const dx = targetWorld.x - atWorld.x;
      const dz = targetWorld.z - atWorld.z;
      const horizontal = Math.hypot(dx, dz) || 0.001;
      walk.yaw = Math.atan2(-dx / horizontal, -dz / horizontal);
      walk.pitch = Math.atan2(targetY - (walk.eye || 1.62), horizontal);
      const day = Math.floor(app.state.clock.minutes / 1440);
      app.state.clock.minutes = day * 1440 + minute;
      app.scene3d.applyTimeWeather(minute, app.state.weather);
    }, { at, target, targetY, minute });
    await page.waitForTimeout(800);
  };

  // Exercise actual first-person movement after placement. Direct camera
  // datums are used only for repeatable comparison screenshots.
  await setCamera({ at: [-3.80, 5.55], target: [-3.80, -1.80], targetY: 1.15 });
  await page.mouse.click(800, 450);
  const movementBefore = await page.evaluate(() => ({
    x: window.__fw.scene3d.walk.state.x, z: window.__fw.scene3d.walk.state.z,
  }));
  await page.keyboard.down('w');
  await page.waitForTimeout(700);
  await page.keyboard.up('w');
  await page.keyboard.down('d');
  await page.waitForTimeout(320);
  await page.keyboard.up('d');
  const movementAfter = await page.evaluate(() => ({
    x: window.__fw.scene3d.walk.state.x, z: window.__fw.scene3d.walk.state.z,
  }));
  const movementDistance = Math.hypot(
    movementAfter.x - movementBefore.x,
    movementAfter.z - movementBefore.z,
  );

  const cameras = [
    { id: '01-progression-wide', at: [-3.80, 5.55], target: [-3.80, -1.80], targetY: 1.10 },
    { id: '02-basic-standard', at: [-8.40, 2.55], target: [-8.40, -1.80], targetY: 1.02 },
    { id: '03-premium', at: [-4.85, 2.35], target: [-4.85, -1.80], targetY: 1.15 },
    { id: '04-high-end', at: [-1.55, 2.55], target: [-1.55, -1.80], targetY: 1.20 },
    { id: '05-luxury', at: [2.00, 2.45], target: [2.20, -1.80], targetY: 1.25 },
    { id: '06-player-side', at: [4.95, 0.75], target: [1.75, -1.80], targetY: 1.18 },
    { id: '07-finished-backs', at: [0.35, -5.55], target: [0.35, -1.80], targetY: 1.15 },
    // Joint-scale views directly evidence the reported shelf, support, and rod
    // failures; the wider progression views alone can hide centimeter gaps.
    { id: '08-premium-joints', at: [-4.25, 0.20], target: [-4.98, -1.80], targetY: 1.02 },
    { id: '09-high-end-joints', at: [-1.00, 0.15], target: [-1.55, -1.80], targetY: 1.15 },
    { id: '10-luxury-joints', at: [2.75, 0.18], target: [2.20, -1.80], targetY: 1.08 },
  ];
  const screenshots = [];
  for (const camera of cameras) {
    await setCamera(camera);
    await page.evaluate(async () => {
      const ui = await import('/src/ui/ui.js');
      ui.clearNotifications();
    });
    await page.waitForTimeout(150);
    const file = path.join(outDir, `${camera.id}.png`);
    await page.screenshot({ path: file });
    screenshots.push(file);
  }

  const rackDiagnostics = await page.evaluate(() => {
    const groups = [];
    window.__fw.scene3d.scene.traverse((object) => {
      if (object.name?.startsWith('PropertyFurniture_furn-clothing-racks-')) groups.push(object);
    });
    return groups.map((group) => {
      const collisionNodes = [];
      const qaNodes = [];
      const lights = [];
      const textures = new Set();
      const materials = new Set();
      group.traverse((node) => {
        if (/^COLLISION_/i.test(node.name || '')) collisionNodes.push({ name: node.name, visible: node.visible });
        if (/^QA_/i.test(node.name || '')) qaNodes.push(node.name);
        if (node.isLight) lights.push({ name: node.name, visible: node.visible, intensity: node.intensity });
        if (!node.isMesh) return;
        for (const material of (Array.isArray(node.material) ? node.material : [node.material])) {
          if (!material) continue;
          materials.add(material.uuid);
          for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap']) {
            if (material[key]) textures.add(material[key].uuid);
          }
        }
      });
      const lod = group.userData.authoredLod;
      const functional = group.userData.functionalNodes;
      return {
        groupName: group.name,
        modelPath: group.userData.modelPath,
        loaded: group.userData.loaded === true,
        loadError: group.userData.loadError || null,
        collisionNodes,
        qaNodes,
        lights,
        materialCount: materials.size,
        textureCount: textures.size,
        runtimeBatch: group.userData.runtimeBatch || null,
        lod: lod ? {
          levels: lod.levels.map((level) => ({
            name: level.object.name, distance: level.distance, visible: level.object.visible,
          })),
          visibleLevelCount: lod.levels.filter((level) => level.object.visible).length,
        } : null,
        functional: functional ? {
          names: functional.names,
          hangNodes: functional.hangNodes.length,
          shelfNodes: functional.shelfNodes.length,
          lightNodes: functional.lightNodes.length,
          interactionPoint: functional.interactionPoint?.name || null,
          placementFootprint: functional.placementFootprint?.name || null,
        } : null,
      };
    }).sort((a, b) => a.modelPath.localeCompare(b.modelPath));
  });

  const saveRoundTrip = await page.evaluate(async () => {
    const E = await import('/src/sim/empire.js');
    const snapshot = E.empireSnapshot(window.__fw.empire);
    const restored = E.deserializeEmpire(JSON.stringify(snapshot));
    const restoredState = E.activeState(restored);
    const racks = restoredState.propertyInventory.placements.filter((entry) => (
      entry.assetId.startsWith('pro-shop-furniture:clothing-racks:')
    ));
    return {
      serializedBytes: JSON.stringify(snapshot).length,
      rackCount: racks.length,
      assetIds: racks.map((entry) => entry.assetId).sort(),
      poses: racks.map((entry) => ({ assetId: entry.assetId, pose: entry.pose })),
    };
  });

  await setCamera(cameras[0]);
  const performanceRuns = [];
  const performanceRunCount = measurePerformance ? 3 : 1;
  const performanceDuration = measurePerformance ? 5000 : 2500;
  for (let run = 0; run < performanceRunCount; run += 1) {
    performanceRuns.push(await page.evaluate((duration) => new Promise((resolve) => {
      const renderer = window.__fw.scene3d.renderer;
      const uiRoot = document.querySelector('#app') || document.body;
      let mutationRecords = 0;
      const observer = new MutationObserver((records) => { mutationRecords += records.length; });
      observer.observe(uiRoot, { childList: true, subtree: true, attributes: true, characterData: true });
      const deltas = [];
      const startedAt = performance.now();
      let previous = startedAt;
      const tick = (now) => {
        deltas.push(now - previous);
        previous = now;
        if (now - startedAt < duration) return requestAnimationFrame(tick);
        observer.disconnect();
        const sorted = [...deltas].sort((a, b) => a - b);
        const total = deltas.reduce((sum, value) => sum + value, 0);
        const onePercentIndex = Math.max(0, Math.ceil(sorted.length * 0.99) - 1);
        resolve({
          durationMs: now - startedAt,
          frameCount: deltas.length,
          averageFps: deltas.length * 1000 / Math.max(1, total),
          onePercentLowFps: 1000 / Math.max(0.001, sorted[onePercentIndex] || 0.001),
          worstFrameMs: Math.max(...deltas),
          jsHeapUsedBytes: performance.memory?.usedJSHeapSize ?? null,
          uiMutationRecordsPerSecond: mutationRecords / Math.max(0.001, (now - startedAt) / 1000),
          rendererMemory: { ...renderer.info.memory },
        });
      };
      requestAnimationFrame(tick);
    }), performanceDuration));
  }

  const renderWork = await page.evaluate(() => new Promise((resolve) => {
    const renderer = window.__fw.scene3d.renderer;
    renderer.info.autoReset = false;
    renderer.info.reset();
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const result = {
        drawCalls: renderer.info.render.calls,
        renderedTriangles: renderer.info.render.triangles,
        renderedLines: renderer.info.render.lines,
        renderedPoints: renderer.info.render.points,
      };
      renderer.info.autoReset = true;
      resolve(result);
    }));
  }));

  const sceneResources = await page.evaluate(() => {
    let visibleMeshes = 0;
    let sceneTriangles = 0;
    const materials = new Set();
    const textures = new Map();
    window.__fw.scene3d.scene.traverseVisible((object) => {
      if (!object.isMesh) return;
      visibleMeshes += 1;
      const geometry = object.geometry;
      const count = geometry?.index?.count ?? geometry?.attributes?.position?.count ?? 0;
      sceneTriangles += (count / 3) * (object.isInstancedMesh ? object.count : 1);
      for (const material of (Array.isArray(object.material) ? object.material : [object.material])) {
        if (!material) continue;
        materials.add(material.uuid);
        for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap']) {
          const texture = material[key];
          if (!texture || textures.has(texture.uuid)) continue;
          const image = texture.image;
          const width = image?.width || image?.videoWidth || 0;
          const height = image?.height || image?.videoHeight || 0;
          textures.set(texture.uuid, Math.ceil(width * height * 4 * 4 / 3));
        }
      }
    });
    return {
      visibleMeshes,
      sceneTriangles: Math.round(sceneTriangles),
      uniqueMaterials: materials.size,
      uniqueTextures: textures.size,
      estimatedTextureBytesRGBA8WithMipmaps: [...textures.values()].reduce((sum, value) => sum + value, 0),
    };
  });

  let reloadResult = null;
  if (verifyReload) {
    const autosave = await page.evaluate(() => window.__fw.autosave());
    intentionalReloadInProgress = true;
    await page.reload();
    await page.getByText('Continue', { exact: true }).click();
    await waitForGame();
    await page.waitForFunction(() => {
      let count = 0;
      window.__fw.scene3d.scene.traverse((object) => {
        if (object.name?.startsWith('PropertyFurniture_furn-clothing-racks-')) count += 1;
      });
      return count === 5;
    }, null, { timeout: 30000 });
    reloadResult = await page.evaluate(async () => {
      const groups = [];
      window.__fw.scene3d.scene.traverse((object) => {
        if (object.name?.startsWith('PropertyFurniture_furn-clothing-racks-')) groups.push(object);
      });
      await Promise.all(groups.map((group) => group.userData.ready));
      return {
        placementCount: window.__fw.state.propertyInventory.placements.filter((entry) => (
          entry.assetId.startsWith('pro-shop-furniture:clothing-racks:')
        )).length,
        loadedCount: groups.filter((group) => group.userData.loaded).length,
        paths: groups.map((group) => group.userData.modelPath).sort(),
      };
    });
    await setCamera(cameras[0]);
    await page.mouse.click(800, 450);
    await page.waitForTimeout(250);
    await page.evaluate(async () => {
      const ui = await import('/src/ui/ui.js');
      ui.clearNotifications();
    });
    const reloadShot = path.join(outDir, '08-after-autosave-reload.png');
    await page.screenshot({ path: reloadShot });
    screenshots.push(reloadShot);
    reloadResult.autosave = autosave;
    await page.waitForTimeout(500);
    intentionalReloadInProgress = false;
  }

  const cdp = await page.context().newCDPSession(page);
  const evaluated = await cdp.send('Runtime.evaluate', {
    expression: 'window', objectGroup: `clothing-rack-iteration-${iteration}-listeners`,
  });
  const listenerResult = await cdp.send('DOMDebugger.getEventListeners', {
    objectId: evaluated.result.objectId,
  });
  await cdp.send('Runtime.releaseObjectGroup', {
    objectGroup: `clothing-rack-iteration-${iteration}-listeners`,
  });

  const expected = {
    'basic.glb': { hang: 3, shelf: 0, lightNodes: 0, lights: 0 },
    'standard.glb': { hang: 3, shelf: 3, lightNodes: 0, lights: 0 },
    'premium.glb': { hang: 3, shelf: 12, lightNodes: 0, lights: 0 },
    'high-end.glb': { hang: 9, shelf: 27, lightNodes: 3, lights: 3 },
    'luxury.glb': { hang: 9, shelf: 36, lightNodes: 6, lights: 6 },
  };
  const rackGates = rackDiagnostics.map((rack) => {
    const file = rack.modelPath.split('/').at(-1);
    const contract = expected[file];
    return {
      file,
      loaded: rack.loaded && !rack.loadError,
      collisionHidden: rack.collisionNodes.length === 1 && rack.collisionNodes.every((node) => !node.visible),
      noQaMerchandise: rack.qaNodes.length === 0,
      lodConfigured: rack.lod?.levels.length === 3
        && rack.lod.visibleLevelCount === 1
        && rack.lod.levels.map((level) => level.name).join(',') === 'LOD0,LOD1,LOD2',
      functionalNodes: !!contract
        && rack.functional?.hangNodes === contract.hang
        && rack.functional?.shelfNodes === contract.shelf
        && rack.functional?.lightNodes === contract.lightNodes
        && rack.functional?.interactionPoint === 'INTERACTION_POINT'
        && rack.functional?.placementFootprint === 'PLACEMENT_FOOTPRINT',
      authoredLights: !!contract && rack.lights.length === contract.lights,
      pbrResources: rack.materialCount > 0 && rack.textureCount > 0,
      runtimeBatched: rack.runtimeBatch?.reducedBy > 0
        && rack.runtimeBatch?.levels?.length === 3,
    };
  });
  if (verifyReload && reloadResult?.loadedCount === 5 && reloadResult?.autosave?.ok) {
    // A successful post-navigation world/rack load proves these were Chromium
    // cancellation events, not missing resources. Other network error codes,
    // HTTP failures, console errors, and page errors remain hard diagnostics.
    diagnostics.failedRequests = diagnostics.failedRequests.filter((entry) => (
      entry.error !== 'net::ERR_ABORTED'
    ));
  }
  const hardDiagnostics = diagnostics.consoleErrors.length + diagnostics.pageErrors.length + diagnostics.failedRequests.length;
  const gates = {
    comparisonFixturePlaced: fixtureResult.placements.every((entry) => entry.ok),
    basicPlacedThroughNormalControls: legalBasicPreview.validation.ok
      && rackDiagnostics.some((rack) => rack.modelPath.endsWith('/basic.glb')),
    allFiveRuntimeAssetsLoaded: rackDiagnostics.length === 5 && rackGates.every((rack) => rack.loaded),
    collisionsHidden: rackGates.every((rack) => rack.collisionHidden),
    noEmbeddedQaMerchandise: rackGates.every((rack) => rack.noQaMerchandise),
    lodsExclusiveAndConfigured: rackGates.every((rack) => rack.lodConfigured),
    functionalContractsExact: rackGates.every((rack) => rack.functionalNodes),
    authoredLightingPresent: rackGates.every((rack) => rack.authoredLights),
    pbrResourcesPresent: rackGates.every((rack) => rack.pbrResources),
    runtimeDrawReduction: rackGates.every((rack) => rack.runtimeBatched),
    normalFirstPersonMovement: movementDistance > 0.20,
    saveRoundTripPreserved: saveRoundTrip.rackCount === 5,
    autosaveReloadPreserved: !verifyReload
      || (reloadResult?.placementCount === 5 && reloadResult?.loadedCount === 5 && reloadResult?.autosave?.ok),
    noHardDiagnostics: hardDiagnostics === 0,
    performanceFloor: performanceRuns.every((run) => run.averageFps >= 30 && run.worstFrameMs <= 120),
  };

  return {
    ok: Object.values(gates).every(Boolean),
    phase: `browser-visual-qa-iteration-${iteration}`,
    launch: `node tools/qa/run-playwright.cjs tools/qa/clothing-racks-qa.js --bootstrap`,
    fixture: fixtureResult,
    legalBasicPreview,
    movement: { before: movementBefore, after: movementAfter, distance: movementDistance },
    cameras,
    screenshots,
    rackDiagnostics,
    rackGates,
    saveRoundTrip,
    reloadResult,
    performanceRuns,
    renderWork,
    sceneResources,
    activeWindowEventListeners: listenerResult.listeners.length,
    gates,
    diagnostics,
  };
}
