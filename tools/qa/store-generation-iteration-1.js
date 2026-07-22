async (page) => {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const base = process.env.QA_BASE_URL || 'http://localhost:8467/';
  const iteration = Number(process.env.QA_ITERATION || 2);
  const out = path.join(process.cwd(), 'qa', 'store-generation', `iteration-${iteration}`);
  await fs.mkdir(out, { recursive: true });
  const diagnostics = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      diagnostics.push(`console:${message.type()}: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => diagnostics.push(`pageerror:${error.message}`));
  page.on('requestfailed', (request) => {
    diagnostics.push(`requestfailed:${request.url()} (${request.failure()?.errorText || 'unknown'})`);
  });

  await page.setViewportSize({ width: 1600, height: 900 });
  const cameras = [
    { id: 'entry', x: -0.7, z: 5.5, tx: -4.2, tz: -1.6, pitch: -0.08 },
    { id: 'center', x: 1.1, z: 2.3, tx: -5.4, tz: -4.0, pitch: -0.04 },
    { id: 'checkout-office', x: -0.3, z: 1.0, tx: 6.9, tz: 4.0, pitch: -0.03 },
    { id: 'stockroom', x: 8.85, z: 1.15, tx: 7.75, tz: -4.65, pitch: -0.04 },
  ];

  async function waitForGame() {
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
  }

  async function installFixture(courseLevel) {
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.evaluate(async (level) => {
      const E = await import('/src/sim/empire.js');
      const empire = E.newEmpire('relaxed', 701000 + level * 977);
      empire.cash = 10_000_000;
      const property = empire.market.find((entry) => entry.shopLevel === level);
      if (!property) throw new Error(`No launch property supplies shop level ${level}`);
      const bought = E.buyProperty(empire, property.id);
      if (!bought.ok) throw new Error(bought.reason);
      bought.state.tutorial.complete = true;
      bought.state.tutorial.hidden = true;
      localStorage.setItem('golfempire:autosave', JSON.stringify(E.empireSnapshot(empire)));
    }, courseLevel);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByText('Continue', { exact: true }).click();
    await waitForGame();
    // Enter pointer lock through the same canvas click a player uses, then let
    // the one-shot welcome/tractor notices expire before evidence capture.
    await page.mouse.click(800, 450);
    await page.waitForTimeout(4600);
    return page.evaluate(() => {
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
      return {
        clubName: app.state.clubName,
        propertyId: app.state.property?.id,
        generation: structuredClone(app.state.shop.generation),
        shelfUnits: Object.values(app.state.shop.inventory).reduce((sum, entry) => sum + (entry?.shelf || 0), 0),
      };
    });
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
      walk.pitch = view.pitch;
    }, camera);
    await page.waitForTimeout(650);
  }

  const courses = [];
  for (let courseLevel = 1; courseLevel <= 5; courseLevel++) {
    const fixture = await installFixture(courseLevel);
    for (const camera of cameras) {
      await pose(camera);
      await page.screenshot({ path: path.join(out, `course-${courseLevel}-${camera.id}.png`) });
    }
    await pose({ x: -0.7, z: 5.5, tx: -0.7, tz: -1.5, pitch: -0.04 });
    const before = await page.evaluate(() => {
      const { x, z } = window.__fw.scene3d.walk.state;
      return { x, z };
    });
    await page.keyboard.down('w');
    await page.waitForTimeout(500);
    await page.keyboard.up('w');
    const after = await page.evaluate(() => {
      const { x, z } = window.__fw.scene3d.walk.state;
      return { x, z };
    });
    courses.push({
      courseLevel,
      fixture,
      normalControlDistance: Math.hypot(after.x - before.x, after.z - before.z),
    });
  }

  async function sceneMetrics(listenerGroup) {
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
        const count = object.geometry?.index?.count ?? object.geometry?.attributes?.position?.count ?? 0;
        sceneTriangles += (count / 3) * (object.isInstancedMesh ? object.count : 1);
        for (const surface of (Array.isArray(object.material) ? object.material : [object.material])) {
          if (surface) materials.add(surface.uuid);
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
    const evaluated = await cdp.send('Runtime.evaluate', { expression: 'window', objectGroup: listenerGroup });
    const listeners = await cdp.send('DOMDebugger.getEventListeners', { objectId: evaluated.result.objectId });
    await cdp.send('Runtime.releaseObjectGroup', { objectGroup: listenerGroup });
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
      const frames = [];
      const calls = [];
      const triangles = [];
      const uiRoot = document.querySelector('#ui') || document.body;
      let mutations = 0;
      const observer = new MutationObserver((records) => { mutations += records.length; });
      observer.observe(uiRoot, { subtree: true, childList: true, attributes: true, characterData: true });
      let previous = performance.now();
      const started = previous;
      function tick(now) {
        frames.push(now - previous);
        calls.push(renderer.info.render.calls || 0);
        triangles.push(renderer.info.render.triangles || 0);
        previous = now;
        if (now - started < duration) return requestAnimationFrame(tick);
        observer.disconnect();
        const sorted = [...frames].filter((value) => value > 0).sort((a, b) => a - b);
        const total = frames.reduce((sum, value) => sum + value, 0);
        const p99 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))] || 0;
        resolve({
          durationMs: now - started,
          frameCount: frames.length,
          averageFps: frames.length * 1000 / total,
          onePercentLowFps: p99 ? 1000 / p99 : null,
          worstFrameMs: Math.max(...frames),
          averageDrawCalls: calls.reduce((sum, value) => sum + value, 0) / calls.length,
          averageRenderedTriangles: triangles.reduce((sum, value) => sum + value, 0) / triangles.length,
          uiMutationRecords: mutations,
          uiUpdatesPerSecond: mutations * 1000 / (now - started),
        });
      }
      requestAnimationFrame(tick);
    }), durationMs);
  }

  // Match the immutable baseline's fully stocked luxury scenario after the
  // generated-shop screenshots are complete.
  await page.evaluate(() => {
    const app = window.__fw;
    for (const item of Object.values(app.state.shop.inventory)) item.shelf = Math.max(item.shelf || 0, 8);
    app.scene3d.clubhouse().rebuildStock?.();
  });
  await pose(cameras[1]);
  await page.waitForTimeout(800);
  const resourcesBefore = await sceneMetrics(`store-generation-${iteration}-before`);
  const performanceSamples = [];
  for (let sample = 0; sample < 3; sample++) performanceSamples.push(await performanceSample());
  const resourcesAfter = await sceneMetrics(`store-generation-${iteration}-after`);

  const result = {
    ok: diagnostics.filter((entry) => entry.startsWith('console:error') || entry.startsWith('pageerror')).length === 0,
    iteration,
    branch: 'feature/store-generation',
    viewport: { width: 1600, height: 900, deviceScaleFactor: 1 },
    fixedFixture: { time: '14:00', weather: 'clear', cameras },
    courses,
    performanceSamples,
    resourcesBefore,
    resourcesAfter,
    resourceGrowth: {
      geometryCount: resourcesAfter.geometryCount - resourcesBefore.geometryCount,
      textureResourceCount: resourcesAfter.textureResourceCount - resourcesBefore.textureResourceCount,
      materialCount: resourcesAfter.materialCount - resourcesBefore.materialCount,
      activeWindowEventListeners: resourcesAfter.activeWindowEventListeners - resourcesBefore.activeWindowEventListeners,
      jsHeapUsedBytes: resourcesAfter.jsHeapUsedBytes - resourcesBefore.jsHeapUsedBytes,
    },
    metricSources: {
      frameTiming: 'requestAnimationFrame intervals; three matched five-second Course-5 center-camera samples',
      render: 'THREE.WebGLRenderer.info sampled each frame; reset-per-frame counters are retained but not used as scene totals',
      scene: 'visible scene traversal with instanced triangle multiplication and unique material UUIDs',
      heapAndListeners: 'Chrome DevTools Protocol Performance and DOMDebugger metrics',
      uiUpdateFrequency: 'MutationObserver records per second under #ui',
      textureMemory: 'unmeasured; resident texture count reported instead',
    },
    diagnostics,
  };
  await fs.writeFile(path.join(out, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}
