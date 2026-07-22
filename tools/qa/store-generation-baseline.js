async (page) => {
  // Immutable baseline for feature/store-generation. This deliberately captures
  // the existing single authored shop at every available fit-out tier before the
  // course-scoped generator changes any simulation or rendering code.
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const base = process.env.QA_BASE_URL || 'http://localhost:8467/';
  const out = path.join(process.cwd(), 'qa', 'store-generation', 'baseline');
  await fs.mkdir(out, { recursive: true });

  const diagnostics = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      diagnostics.push(`console:${message.type()}: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => diagnostics.push(`pageerror: ${error.message}`));
  page.on('requestfailed', (request) => {
    diagnostics.push(`requestfailed: ${request.url()} (${request.failure()?.errorText || 'unknown'})`);
  });

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  const continueButton = page.getByText('Continue', { exact: true });
  if (await continueButton.count()) await continueButton.click();
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
  }, null, { timeout: 90000 });
  await page.waitForFunction(() => {
    const clubhouse = window.__fw.scene3d.clubhouse();
    return (!clubhouse.assetsReady || clubhouse.assetsReady())
      && (!clubhouse.deliveryEquipmentReady || clubhouse.deliveryEquipmentReady());
  }, null, { timeout: 90000 });

  const fixture = await page.evaluate(() => {
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    app.speedIdx = 0;
    app.scene3d.walk.clearKeys?.();
    clubhouse.setOrganicWalkins?.(false);
    clubhouse.clearWalkins?.();
    const day = Math.floor(app.state.clock.minutes / 1440) * 1440;
    app.state.clock.minutes = day + 14 * 60;
    app.state.weather.today = {
      tempHiF: 72, tempLoF: 54, rainIn: 0, humidity: 0.48, windMph: 5,
    };
    app.state.weather.locked = true;
    app.scene3d.applyTimeWeather?.(14 * 60, app.state.weather);
    for (const item of Object.values(app.state.shop.inventory)) item.shelf = Math.max(item.shelf || 0, 8);
    clubhouse.rebuildStock?.();
    return {
      seed: app.state.seed,
      propertyId: app.state.property?.id || null,
      progressionTier: app.state.shop.progression?.tier || null,
      layout: structuredClone(app.state.shop.layout || null),
      interiorOrigin: clubhouse.interior.position.toArray(),
    };
  });
  await page.waitForTimeout(1200);

  async function setTier(tier) {
    return page.evaluate(async (tierId) => {
      const app = window.__fw;
      const { ensureShopProgression } = await import('/src/sim/shopProgression.js');
      ensureShopProgression(app.state, { legacy: true });
      app.state.shop.progression.tier = tierId;
      app.state.shop.progression.pending = null;
      app.state.shop.progression.legacyFullLayout = false;
      app.scene3d.clubhouse().refreshShopProgression?.();
      return {
        tier: tierId,
        progression: app.state.shop.progression,
        layout: structuredClone(app.state.shop.layout || null),
        visuals: app.scene3d.clubhouse().shopProgressionDiagnostics?.() || null,
      };
    }, tier);
  }

  async function pose(camera) {
    await page.evaluate((view) => {
      const app = window.__fw;
      const origin = app.scene3d.clubhouse().interior.position;
      const walk = app.scene3d.walk.state;
      app.scene3d.walk.clearKeys?.();
      walk.x = origin.x + view.x;
      walk.z = origin.z + view.z;
      const dx = origin.x + view.tx - walk.x;
      const dz = origin.z + view.tz - walk.z;
      const distance = Math.hypot(dx, dz) || 1;
      walk.yaw = Math.atan2(-dx / distance, -dz / distance);
      walk.pitch = view.pitch || 0;
    }, camera);
    await page.waitForTimeout(650);
  }

  const cameras = [
    { id: 'entry', x: -0.7, z: 5.5, tx: -4.2, tz: -1.6, pitch: -0.08 },
    { id: 'center', x: 1.1, z: 2.3, tx: -5.4, tz: -4.0, pitch: -0.04 },
    { id: 'checkout-office', x: -0.3, z: 1.0, tx: 6.9, tz: 4.0, pitch: -0.03 },
  ];
  const tiers = ['basic', 'standard', 'premium', 'luxury'];
  const tierEvidence = [];
  const screenshots = [];
  for (const tier of tiers) {
    tierEvidence.push(await setTier(tier));
    await page.waitForTimeout(700);
    for (const camera of cameras) {
      await pose(camera);
      const name = `${tier}-${camera.id}.png`;
      await page.screenshot({ path: path.join(out, name) });
      screenshots.push(name);
    }
  }

  // Exercise the actual walk controls on the matched luxury floor. The state
  // setup above is only a deterministic fixture; movement remains player input.
  await pose({ x: -0.7, z: 5.5, tx: -0.7, tz: -1.5, pitch: -0.04 });
  const beforeWalk = await page.evaluate(() => {
    const { x, z } = window.__fw.scene3d.walk.state;
    return { x, z };
  });
  await page.keyboard.down('w');
  await page.waitForTimeout(600);
  await page.keyboard.up('w');
  const afterWalk = await page.evaluate(() => {
    const { x, z } = window.__fw.scene3d.walk.state;
    return { x, z };
  });

  async function sceneMetrics() {
    const browserMetrics = await page.evaluate(() => {
      const app = window.__fw;
      const scene = app.scene3d.scene;
      const renderer = app.scene3d.renderer;
      let visibleMeshes = 0;
      let sceneTriangles = 0;
      const materials = new Set();
      scene.traverse((object) => {
        if (!object.isMesh || !object.visible) return;
        visibleMeshes += 1;
        const geometry = object.geometry;
        const count = geometry?.index?.count ?? geometry?.attributes?.position?.count ?? 0;
        sceneTriangles += (count / 3) * (object.isInstancedMesh ? object.count : 1);
        for (const material of (Array.isArray(object.material) ? object.material : [object.material])) {
          if (material) materials.add(material.uuid);
        }
      });
      return {
        visibleMeshes,
        sceneTriangles: Math.round(sceneTriangles),
        materialCount: materials.size,
        geometryCount: renderer.info.memory.geometries,
        textureResourceCount: renderer.info.memory.textures,
        jsHeapUsedBytes: performance.memory?.usedJSHeapSize ?? null,
        jsHeapTotalBytes: performance.memory?.totalJSHeapSize ?? null,
      };
    });
    const cdp = await page.context().newCDPSession(page);
    const metrics = await cdp.send('Performance.getMetrics');
    const byName = Object.fromEntries(metrics.metrics.map(({ name, value }) => [name, value]));
    const evaluated = await cdp.send('Runtime.evaluate', {
      expression: 'window', objectGroup: 'store-generation-baseline-listeners',
    });
    const listeners = await cdp.send('DOMDebugger.getEventListeners', { objectId: evaluated.result.objectId });
    await cdp.send('Runtime.releaseObjectGroup', { objectGroup: 'store-generation-baseline-listeners' });
    await cdp.detach();
    return {
      ...browserMetrics,
      jsHeapUsedBytes: byName.JSHeapUsedSize ?? browserMetrics.jsHeapUsedBytes,
      jsHeapTotalBytes: byName.JSHeapTotalSize ?? browserMetrics.jsHeapTotalBytes,
      activeWindowEventListeners: listeners.listeners.length,
      textureMemoryBytes: null,
    };
  }

  async function performanceSample(durationMs = 5000) {
    return page.evaluate((duration) => new Promise((resolve) => {
      const renderer = window.__fw.scene3d.renderer;
      const uiRoot = document.querySelector('#ui') || document.body;
      const frameTimes = [];
      const drawCalls = [];
      const triangles = [];
      let mutations = 0;
      const observer = new MutationObserver((records) => { mutations += records.length; });
      observer.observe(uiRoot, { subtree: true, childList: true, attributes: true, characterData: true });
      const started = performance.now();
      let prior = started;
      function tick(now) {
        frameTimes.push(now - prior);
        drawCalls.push(renderer.info.render.calls || 0);
        triangles.push(renderer.info.render.triangles || 0);
        prior = now;
        if (now - started < duration) {
          requestAnimationFrame(tick);
          return;
        }
        observer.disconnect();
        const sorted = [...frameTimes].filter((value) => value > 0).sort((a, b) => a - b);
        const total = frameTimes.reduce((sum, value) => sum + value, 0);
        const percentile99 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))] || 0;
        resolve({
          durationMs: now - started,
          frameCount: frameTimes.length,
          averageFps: frameTimes.length * 1000 / total,
          onePercentLowFps: percentile99 > 0 ? 1000 / percentile99 : null,
          worstFrameMs: Math.max(...frameTimes),
          averageDrawCalls: drawCalls.reduce((sum, value) => sum + value, 0) / drawCalls.length,
          averageRenderedTriangles: triangles.reduce((sum, value) => sum + value, 0) / triangles.length,
          uiMutationRecords: mutations,
          uiUpdatesPerSecond: mutations * 1000 / (now - started),
        });
      }
      requestAnimationFrame(tick);
    }), durationMs);
  }

  await pose(cameras[1]);
  const resourcesBefore = await sceneMetrics();
  const performanceSamples = [];
  for (let sample = 0; sample < 3; sample++) performanceSamples.push(await performanceSample());
  for (let cycle = 0; cycle < 12; cycle++) {
    await setTier(cycle % 2 ? 'luxury' : 'basic');
  }
  await setTier('luxury');
  await page.waitForTimeout(800);
  const resourcesAfterInteractions = await sceneMetrics();

  const result = {
    ok: diagnostics.filter((entry) => entry.startsWith('console:error') || entry.startsWith('pageerror')).length === 0,
    branch: 'feature/store-generation',
    baselineCommit: '0e2a01c1c7666de55ff50ae698a5ad0fbdd446a4',
    viewport: { width: 1600, height: 900, deviceScaleFactor: 1 },
    fixedFixture: { time: '14:00', weather: 'clear/save fixture', cameraCount: cameras.length },
    fixture,
    cameras,
    tierEvidence,
    screenshots,
    normalControls: {
      route: 'keyboard W from the shop entry on the luxury floor',
      before: beforeWalk,
      after: afterWalk,
      distance: Math.hypot(afterWalk.x - beforeWalk.x, afterWalk.z - beforeWalk.z),
    },
    performanceSamples,
    resourcesBefore,
    resourcesAfterInteractions,
    resourceGrowth: {
      geometryCount: resourcesAfterInteractions.geometryCount - resourcesBefore.geometryCount,
      textureResourceCount: resourcesAfterInteractions.textureResourceCount - resourcesBefore.textureResourceCount,
      materialCount: resourcesAfterInteractions.materialCount - resourcesBefore.materialCount,
      activeWindowEventListeners: resourcesAfterInteractions.activeWindowEventListeners - resourcesBefore.activeWindowEventListeners,
      jsHeapUsedBytes: resourcesAfterInteractions.jsHeapUsedBytes - resourcesBefore.jsHeapUsedBytes,
    },
    metricSources: {
      frameTiming: 'requestAnimationFrame intervals in milliseconds; three matched five-second samples',
      render: 'THREE.WebGLRenderer.info sampled each animation frame',
      scene: 'visible scene traversal with instanced triangle multiplication and unique material UUIDs',
      heapAndListeners: 'Chrome DevTools Protocol Performance and DOMDebugger metrics',
      uiUpdateFrequency: 'MutationObserver records per second under #ui during every performance sample',
      textureMemory: 'unmeasured; THREE exposes resident texture count but not decoded GPU bytes',
    },
    diagnostics,
  };
  await fs.writeFile(path.join(out, 'baseline-result.json'), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}
