async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const repoRoot = process.env.QA_REPO_ROOT || process.cwd();
  const outDir = path.join(repoRoot, 'qa', 'retail_shelves', 'baseline');
  fs.mkdirSync(outDir, { recursive: true });

  const diagnostics = { consoleErrors: [], consoleWarnings: [], pageErrors: [], failedRequests: [] };
  page.on('console', (message) => {
    if (message.type() === 'error') diagnostics.consoleErrors.push(message.text());
    if (message.type() === 'warning') diagnostics.consoleWarnings.push(message.text());
  });
  page.on('pageerror', (error) => diagnostics.pageErrors.push(error.message));
  page.on('requestfailed', (request) => diagnostics.failedRequests.push({
    url: request.url(), error: request.failure()?.errorText || 'unknown',
  }));

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(baseUrl);
  await page.getByText('Continue', { exact: true }).click();
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 40000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
  }, null, { timeout: 40000 });
  await page.waitForTimeout(2500);

  // Exercise the documented player path before using fixed QA cameras.
  const normalControls = { before: await page.evaluate(() => ({ ...window.__fw.scene3d.walk.state })) };
  await page.keyboard.press('p');
  await page.waitForTimeout(900);
  normalControls.afterEntry = await page.evaluate(() => ({ ...window.__fw.scene3d.walk.state }));
  const canvas = page.locator('canvas').first();
  await canvas.click({ position: { x: 800, y: 450 } }).catch(() => {});
  await page.keyboard.down('w');
  await page.waitForTimeout(350);
  await page.keyboard.up('w');
  await page.waitForTimeout(250);
  normalControls.after = await page.evaluate(() => ({ ...window.__fw.scene3d.walk.state }));
  normalControls.movedDistance = Math.hypot(
    normalControls.after.x - normalControls.before.x,
    normalControls.after.z - normalControls.before.z,
  );

  const clubhouseAnchor = await page.evaluate(() => {
    const interior = window.__fw.scene3d.clubhouse().interior;
    const world = new interior.position.constructor();
    interior.getWorldPosition(world);
    return { x: world.x, y: world.y, z: world.z, rotationY: interior.rotation.y };
  });
  const cameras = [
    { id: '01-entry-wide', atLocal: [-0.8, 5.2], targetLocal: [-1.2, -2.0], pitch: -0.05 },
    { id: '02-retail-wall', atLocal: [-4.9, -2.8], targetLocal: [-7.0, -5.8], pitch: -0.02 },
    { id: '03-placement-floor', atLocal: [2.3, 1.7], targetLocal: [-2.8, 0.0], pitch: -0.04 },
  ];
  const setCamera = async (camera) => {
    await page.evaluate((pose) => {
      const app = window.__fw;
      const walk = app.scene3d.walk;
      const state = walk.state;
      const interior = app.scene3d.clubhouse().interior;
      const vectorType = interior.position.constructor;
      const at = interior.localToWorld(new vectorType(pose.atLocal[0], 1.6, pose.atLocal[1]));
      const target = interior.localToWorld(new vectorType(pose.targetLocal[0], 1.6, pose.targetLocal[1]));
      walk.clearKeys();
      walk.setSpraying(false);
      const day = Math.floor(app.state.clock.minutes / 1440);
      app.state.clock.minutes = day * 1440 + 14 * 60;
      app.scene3d.applyTimeWeather(14 * 60, app.state.weather);
      state.x = at.x;
      state.z = at.z;
      const dx = target.x - at.x;
      const dz = target.z - at.z;
      const length = Math.hypot(dx, dz) || 1;
      state.yaw = Math.atan2(-dx / length, -dz / length);
      state.pitch = pose.pitch;
    }, camera);
    await page.waitForTimeout(750);
  };

  const screenshots = [];
  for (const camera of cameras) {
    await setCamera(camera);
    const file = path.join(outDir, `${camera.id}.png`);
    await page.screenshot({ path: file });
    screenshots.push(file);
  }

  await setCamera(cameras[2]);
  await page.waitForTimeout(5000);
  const performanceRuns = [];
  for (let run = 0; run < 3; run += 1) {
    performanceRuns.push(await page.evaluate(() => new Promise((resolve) => {
      const renderer = window.__fw.scene3d.renderer;
      const uiRoot = document.querySelector('#app') || document.body;
      let mutationRecords = 0;
      const observer = new MutationObserver((records) => { mutationRecords += records.length; });
      observer.observe(uiRoot, { childList: true, subtree: true, attributes: true, characterData: true });
      const deltas = [];
      const startedAt = performance.now();
      let previous = startedAt;
      const finish = () => {
        observer.disconnect();
        const sorted = [...deltas].sort((a, b) => a - b);
        const total = deltas.reduce((sum, value) => sum + value, 0);
        const onePercentIndex = Math.max(0, Math.ceil(sorted.length * 0.99) - 1);
        resolve({
          durationMs: performance.now() - startedAt,
          frameCount: deltas.length,
          averageFps: deltas.length * 1000 / Math.max(1, total),
          onePercentLowFps: 1000 / Math.max(0.001, sorted[onePercentIndex] || 0.001),
          worstFrameMs: Math.max(...deltas),
          jsHeapUsedBytes: performance.memory?.usedJSHeapSize ?? null,
          uiMutationRecordsPerSecond: mutationRecords / Math.max(0.001, (performance.now() - startedAt) / 1000),
          rendererMemory: { ...renderer.info.memory },
        });
      };
      const tick = (now) => {
        deltas.push(now - previous);
        previous = now;
        if (now - startedAt >= 5000) finish();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    })));
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

  const cdp = await page.context().newCDPSession(page);
  const evaluated = await cdp.send('Runtime.evaluate', { expression: 'window', objectGroup: 'retail-shelf-listeners' });
  const listenerResult = await cdp.send('DOMDebugger.getEventListeners', { objectId: evaluated.result.objectId });
  await cdp.send('Runtime.releaseObjectGroup', { objectGroup: 'retail-shelf-listeners' });

  const report = {
    ok: diagnostics.consoleErrors.length === 0 && diagnostics.pageErrors.length === 0,
    phase: 'untouched-baseline',
    launch: 'node tools/qa/run-playwright.cjs tools/qa/retail-shelves-baseline.js --bootstrap',
    viewport: { width: 1600, height: 900, deviceScaleFactor: 1 },
    fixture: { property: 'willow-creek', seed: 424242, time: '14:00', weather: 'bootstrap default' },
    clubhouseAnchor,
    cameras,
    normalControls,
    screenshots,
    performanceRuns,
    renderWork,
    sceneResources,
    activeWindowEventListeners: listenerResult.listeners.length,
    diagnostics,
  };
  fs.writeFileSync(path.join(outDir, 'baseline-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}
