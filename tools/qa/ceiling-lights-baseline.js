async (page) => {
  const BASE = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const OUT = process.env.QA_OUT_DIR || 'qa/ceiling-lights/baseline';
  const STRESS = process.env.QA_STRESS === '1';
  const METRICS_ONLY = process.env.QA_METRICS_ONLY === '1';
  const ISOLATE_PRESENTATIONS = process.env.QA_ISOLATE_PRESENTATIONS === '1';
  const diagnostics = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      diagnostics.push(`console:${message.type()}: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => diagnostics.push(`pageerror:${error.message}`));
  page.on('requestfailed', (request) => {
    diagnostics.push(`requestfailed:${request.url()}:${request.failure()?.errorText || 'unknown'}`);
  });

  await page.setViewportSize({ width: 1600, height: 900 });
  const initialUrl = new URL(BASE);
  if (ISOLATE_PRESENTATIONS) initialUrl.searchParams.set('clubhouse', 'legacy');
  await page.goto(initialUrl.toString());
  await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 45000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
  }, null, { timeout: 45000 });

  await page.evaluate(async ({ stressMode, isolatePresentations }) => {
    const app = window.__fw;
    const inventory = await import('/src/sim/propertyInventory.js');
    const shop = await import('/src/sim/shop.js');
    app.state.tutorial.complete = true;
    app.state.tutorial.hidden = true;
    // The pre-change renderer kept the built-in ceiling circuit powered in this
    // bootstrap state. Disable campaign repair gating so the post-change replay
    // measures the same illuminated room instead of benefiting from nine lights
    // being intentionally off.
    app.state.campaign.enabled = false;
    // Performance evidence must not gain or lose random shopper geometry between
    // samples. Normal-gameplay acceptance exercises customers separately.
    app.scene3d.clubhouse().setOrganicWalkins(false);
    app.scene3d.clubhouse().clearWalkins();
    void isolatePresentations;
    if (stressMode) {
      // Stress mode contains only the requested production fixtures rather than
      // also inheriting the two legacy pendants used by the baseline replay.
    } else {
      app.state.shop.inventory.light1.back = 2;
      inventory.importLegacyStoredPlaceables(app.state, 'light1', 2);
      shop.placeDecor(app.state, 'light1', 0);
      shop.placeDecor(app.state, 'light1', 1);
    }
  }, { stressMode: STRESS, isolatePresentations: ISOLATE_PRESENTATIONS });
  await page.waitForTimeout(2200);

  let stressSetup = null;
  if (STRESS) {
    stressSetup = await page.evaluate(async () => {
      const app = window.__fw;
      const inventory = await import('/src/sim/propertyInventory.js');
      const shop = await import('/src/sim/shop.js');
      app.state.campaign.enabled = false;
      app.state.shop.progression.tier = 'premium';
      app.state.shop.unlockedTier = 3;
      app.state.shop.orders = [];

      const firstRow = [
        ['ceiling-light-basic', -8, -4],
        ['ceiling-light-standard', -5.75, -4],
        ['ceiling-light-premium', -3.75, -4],
        ['ceiling-light-premium-single', -2.55, -4],
        ['ceiling-light-high-end', -0.8, -4],
        // The authored lounge table already supplies the protected footprint
        // required by the low chandelier; no unrelated furniture is added to
        // this light-only performance sample.
        ['ceiling-light-luxury', -5.9, 0.6],
      ];
      const repeatedRows = [-0.1, 2.8].flatMap((z) => [
        ['ceiling-light-basic', -8, z],
        ['ceiling-light-standard', -5.75, z],
        ['ceiling-light-premium', -3.75, z],
        ['ceiling-light-premium-single', -2.55, z],
        ['ceiling-light-high-end', -0.8, z],
      ]);
      const requested = [...firstRow, ...repeatedRows];
      const requestedBySku = new Map();
      for (const [skuId] of requested) {
        requestedBySku.set(skuId, (requestedBySku.get(skuId) || 0) + 1);
      }
      for (const [skuId, quantity] of requestedBySku) {
        app.state.shop.inventory[skuId].back = quantity;
        inventory.importLegacyStoredPlaceables(app.state, skuId, quantity);
      }

      const failures = [];
      const placedIds = [];
      for (const [skuId, x, z] of requested) {
        const placed = shop.placeDecorFree(app.state, skuId, {
          area: 'clubhouse', mount: 'ceiling', x, y: 0, z, ry: 0,
          surfaceId: 'clubhouse:ceiling', authoredSpot: null,
        });
        if (placed.ok) placedIds.push(placed.placement?.id || null);
        else failures.push({ skuId, x, z, reason: placed.reason });
      }
      return {
        requestedCount: requested.length,
        placedCount: placedIds.length,
        placedIds,
        failures,
        protectedFootprintSource: 'authored clubhouse lounge table',
      };
    });
    await page.waitForFunction((expected) => {
      const rows = window.__fw.scene3d.clubhouse().propertyFurnitureDiagnostics()
        .filter((row) => row.skuId?.startsWith('ceiling-light-'));
      return rows.length === expected && rows.every((row) => row.loaded || row.loadError);
    }, stressSetup.placedCount, { timeout: 45000 });
    await page.waitForTimeout(2200);
    stressSetup.runtime = await page.evaluate(() => {
      const clubhouse = window.__fw.scene3d.clubhouse();
      const rows = clubhouse.propertyFurnitureDiagnostics()
        .filter((row) => row.skuId?.startsWith('ceiling-light-'));
      const basicControllers = [];
      window.__fw.scene3d.scene.traverse((object) => {
        const controller = object.userData?.ceilingLightController;
        if (controller && /PropertyFurniture_ceiling-light-basic/i.test(object.name || '')) {
          basicControllers.push(controller);
        }
      });
      let independentPowerMaterials = false;
      if (basicControllers.length >= 2) {
        const [first, second] = basicControllers;
        first.setOn(false, { notify: false });
        independentPowerMaterials = first.emitterMaterials.every((material) => material.emissiveIntensity === 0)
          && second.isOn()
          && second.emitterMaterials.some((material) => material.emissiveIntensity > 0);
        first.setOn(true, { notify: false });
      }
      return {
        loadedCount: rows.filter((row) => row.loaded).length,
        loadErrors: rows.filter((row) => row.loadError).map((row) => ({
          skuId: row.skuId, loadError: row.loadError,
        })),
        activeRuntimeLights: rows.reduce((sum, row) => (
          sum + (row.lighting?.activeRuntimeLightCount || 0)
        ), 0),
        independentPowerMaterials,
        physicalLightBudget: clubhouse.ceilingLightingDiagnostics().physicalLightBudget,
      };
    });
  }

  async function setPose({ at, target, targetY = 3.25, minute = 840 }) {
    await page.evaluate(({ at, target, targetY, minute }) => {
      const app = window.__fw;
      const interior = app.scene3d.clubhouse().interior.position;
      const walk = app.scene3d.walk.state;
      app.scene3d.walk.clearKeys();
      app.scene3d.walk.setSpraying(false);
      const day = Math.floor(app.state.clock.minutes / 1440);
      app.state.clock.minutes = day * 1440 + minute;
      app.scene3d.applyTimeWeather(minute, app.state.weather);
      walk.x = interior.x + at[0];
      walk.z = interior.z + at[1];
      const dx = target[0] - at[0];
      const dz = target[1] - at[1];
      const horizontal = Math.hypot(dx, dz) || 0.001;
      walk.yaw = Math.atan2(-dx / horizontal, -dz / horizontal);
      walk.pitch = Math.atan2(targetY - (walk.eye || 1.62), horizontal);
    }, { at, target, targetY, minute });
    await page.waitForTimeout(900);
  }

  const shots = [];
  async function shot(id, pose) {
    await setPose(pose);
    const path = `${OUT}/${id}.png`;
    await page.screenshot({ path, timeout: 60000 });
    shots.push(path);
  }

  if (!METRICS_ONLY) {
    await shot('01-sales-ceiling-entry-day', {
      at: [-0.6, 5.1], target: [-2.3, -0.5], targetY: 3.25, minute: 840,
    });
    await shot('02-sales-ceiling-reverse-day', {
      at: [-3.2, -4.8], target: [-2.2, 1.6], targetY: 3.3, minute: 840,
    });
    await shot('03-office-ceiling-day', {
      at: [9.25, 5.45], target: [8.25, 3.7], targetY: 3.35, minute: 840,
    });
    await shot('04-stockroom-ceiling-day', {
      at: [8.8, -5.45], target: [7.9, -2.8], targetY: 3.35, minute: 840,
    });
    await shot('05-existing-pendants-day', {
      at: [-5.8, 4.6], target: [-1.2, 1.7], targetY: 3.0, minute: 840,
    });
    await shot('06-existing-pendants-night', {
      at: [-5.8, 4.6], target: [-1.2, 1.7], targetY: 3.0, minute: 1260,
    });
  }

  await setPose({ at: [-5.8, 4.6], target: [-1.2, 1.7], targetY: 3.0, minute: 1260 });
  if (METRICS_ONLY) await page.waitForTimeout(8000);
  const collectedPerformanceSamples = [];
  const sampleCount = METRICS_ONLY ? 4 : 3;
  for (let run = 0; run < sampleCount; run += 1) {
    collectedPerformanceSamples.push(await page.evaluate(() => new Promise((resolve) => {
      const renderer = window.__fw.scene3d.renderer;
      const frames = [];
      const started = performance.now();
      let previous = started;
      let settled = false;
      function finish(now = performance.now()) {
        if (settled) return;
        settled = true;
        const usable = frames.length ? frames : [now - started];
        const sorted = [...usable].sort((a, b) => a - b);
        const total = usable.reduce((sum, value) => sum + value, 0);
        resolve({
          durationMs: now - started,
          frameCount: frames.length,
          averageFps: frames.length * 1000 / Math.max(total, 0.001),
          onePercentLowFps: 1000 / Math.max(
            sorted[Math.max(0, Math.floor(sorted.length * 0.99) - 1)], 0.001,
          ),
          worstFrameMs: Math.max(...usable),
          drawCalls: renderer.info.render.calls,
          renderedTriangles: renderer.info.render.triangles,
          geometryCount: renderer.info.memory.geometries,
          textureResourceCount: renderer.info.memory.textures,
          jsHeapBytes: performance.memory?.usedJSHeapSize ?? null,
          timedOut: frames.length === 0,
        });
      }
      setTimeout(() => finish(), 6500);
      function tick(now) {
        if (settled) return;
        frames.push(now - previous);
        previous = now;
        if (now - started < 5000) {
          requestAnimationFrame(tick);
          return;
        }
        finish(now);
      }
      requestAnimationFrame(tick);
    })));
  }
  const warmupPerformanceSample = METRICS_ONLY ? collectedPerformanceSamples.shift() : null;
  const performanceSamples = collectedPerformanceSamples;

  const sceneMetrics = await page.evaluate(() => {
    const scene = window.__fw.scene3d.scene;
    let visibleMeshes = 0;
    let sceneTriangles = 0;
    let lights = 0;
    let activeLights = 0;
    const materials = new Set();
    scene.traverse((object) => {
      if (object.isLight) {
        lights += 1;
        if (object.visible && object.intensity > 0) activeLights += 1;
      }
      if (!object.isMesh || !object.visible) return;
      visibleMeshes += 1;
      const count = object.geometry?.index?.count
        ?? object.geometry?.attributes?.position?.count
        ?? 0;
      sceneTriangles += (count / 3) * (object.isInstancedMesh ? object.count : 1);
      for (const material of (Array.isArray(object.material) ? object.material : [object.material])) {
        if (material) materials.add(material.uuid);
      }
    });
    return {
      visibleMeshes,
      sceneTriangles: Math.round(sceneTriangles),
      materialCount: materials.size,
      lights,
      activeLights,
    };
  });

  const cdp = await page.context().newCDPSession(page);
  const evaluated = await cdp.send('Runtime.evaluate', {
    expression: 'window', objectGroup: 'ceiling-lights-baseline-listeners',
  });
  const listeners = await cdp.send('DOMDebugger.getEventListeners', {
    objectId: evaluated.result.objectId,
  });
  await cdp.send('Runtime.releaseObjectGroup', {
    objectGroup: 'ceiling-lights-baseline-listeners',
  });

  return {
    ok: diagnostics.filter((entry) => (
      entry.startsWith('console:error') || entry.startsWith('pageerror')
    )).length === 0
      && (!STRESS || (
        stressSetup.placedCount === stressSetup.requestedCount
        && stressSetup.failures.length === 0
        && stressSetup.runtime.loadedCount === stressSetup.requestedCount
        && stressSetup.runtime.loadErrors.length === 0
        && stressSetup.runtime.independentPowerMaterials
        && stressSetup.runtime.physicalLightBudget.allocatedPhysicalLights
          === stressSetup.runtime.physicalLightBudget.limit
      )),
    scenario: STRESS ? 'sixteen placed production ceiling lights' : 'identical baseline replay',
    stressSetup,
    viewport: { width: 1600, height: 900, deviceScaleFactor: 1 },
    fixedCamera: {
      coordinateSpace: 'clubhouse-local yards',
      performancePose: { at: [-5.8, 4.6], target: [-1.2, 1.7], targetY: 3.0 },
      time: '21:00',
      weather: 'bootstrap save fixture',
    },
    shots,
    warmupPerformanceSample,
    performanceSamples,
    sceneMetrics,
    activeWindowEventListeners: listeners.listeners.length,
    textureMemoryBytes: null,
    uiUpdateFrequencyHz: null,
    diagnostics,
  };
}
