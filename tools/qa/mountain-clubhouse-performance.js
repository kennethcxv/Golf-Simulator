async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const variant = process.env.MOUNTAIN_PERF_VARIANT || 'mountain-lodge';
  const repo = process.env.QA_REPO_ROOT || process.cwd();
  const outDir = path.join(repo, 'qa', 'mountain-clubhouse', 'performance');
  fs.mkdirSync(outDir, { recursive: true });

  const diagnostics = { consoleErrors: [], pageErrors: [], requestFailures: [] };
  page.on('console', (message) => {
    if (message.type() === 'error') diagnostics.consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => diagnostics.pageErrors.push(error.stack || error.message));
  page.on('requestfailed', (request) => diagnostics.requestFailures.push({
    url: request.url(), error: request.failure()?.errorText || 'unknown',
  }));

  const url = new URL(process.env.QA_BASE_URL || 'http://localhost:8861/');
  url.searchParams.set('clubhouse', variant);
  await page.goto(url.toString());
  await page.setViewportSize({ width: 1600, height: 900 });
  await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || getComputedStyle(veil).display === 'none'
      || Number(getComputedStyle(veil).opacity) <= 0.01;
  }, null, { timeout: 90000 });
  if (variant === 'mountain-lodge') {
    await page.waitForFunction(() => (
      window.__fw.scene3d.clubhouse().mountainLodge.diagnostics().status !== 'loading'
    ), null, { timeout: 120000 });
  }

  await page.evaluate(() => {
    const app = window.__fw;
    app.speedIdx = 0;
    app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440 + 14 * 60;
    app.state.weather.today = {
      ...(app.state.weather.today || {}),
      tempHiF: 67, tempLoF: 46, rainIn: 0, humidity: 0.38, windMph: 5,
    };
    app.scene3d.applyTimeWeather(14 * 60, app.state.weather);
    app.scene3d.clearGolfers?.();
    const ch = app.scene3d.clubhouse();
    const center = ch.group.position;
    const walk = app.scene3d.walk;
    walk.clearKeys();
    walk.clearFocus?.();
    walk.state.x = center.x;
    walk.state.z = center.z + 30;
    walk.state.yaw = 0;
    walk.state.pitch = 0.055;
    for (const name of [
      'DeliveryEquipmentRoot_delivery_van', 'DeliveryEquipmentRoot_pallet_jack',
      'DeliveryBoxWorldRoot', 'DeliveryPalletStage',
    ]) {
      const root = app.scene3d.scene.getObjectByName(name);
      if (root) root.visible = false;
    }
    const customers = typeof ch.customers === 'function'
      ? ch.customers()
      : (Array.isArray(ch.customers) ? ch.customers : []);
    for (const customer of customers) if (customer.mesh) customer.mesh.visible = false;
  });

  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(outDir, `${variant}.png`) });

  const metrics = await page.evaluate(() => new Promise((resolve) => {
    const s3 = window.__fw.scene3d;
    const renderer = s3.renderer;
    const warmFrames = 90;
    const measuredFrames = 120;
    const intervals = [];
    let previous = performance.now();
    let frame = 0;

    const finish = () => {
      const calls = renderer.info.render.calls / measuredFrames;
      const drawnTriangles = renderer.info.render.triangles / measuredFrames;
      renderer.info.autoReset = true;
      let sceneMeshes = 0;
      let sceneTriangles = 0;
      const materials = new Set();
      const textures = new Set();
      s3.scene.traverse((node) => {
        if (!node.isMesh || !node.visible) return;
        sceneMeshes += 1;
        const count = node.geometry?.index?.count
          || node.geometry?.attributes?.position?.count || 0;
        sceneTriangles += count / 3 * (node.isInstancedMesh ? node.count : 1);
        for (const material of (Array.isArray(node.material) ? node.material : [node.material])) {
          if (!material) continue;
          materials.add(material.uuid);
          for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap']) {
            if (material[key]) textures.add(material[key].uuid);
          }
        }
      });
      const sorted = intervals.slice().sort((a, b) => a - b);
      const percentile = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] || 0;
      resolve({
        frameWindow: measuredFrames,
        meanFrameMs: intervals.reduce((sum, value) => sum + value, 0) / intervals.length,
        p95FrameMs: percentile(0.95),
        p99FrameMs: percentile(0.99),
        drawCallsPerFrame: calls,
        trianglesDrawnPerFrame: drawnTriangles,
        sceneMeshes,
        sceneTriangles: Math.round(sceneTriangles),
        uniqueMaterials: materials.size,
        uniqueTextures: textures.size,
        geometriesInMemory: renderer.info.memory.geometries,
        texturesInMemory: renderer.info.memory.textures,
      });
    };

    const step = (now) => {
      frame += 1;
      if (frame === warmFrames) {
        renderer.info.autoReset = false;
        renderer.info.reset();
        intervals.length = 0;
        previous = now;
      } else if (frame > warmFrames) {
        intervals.push(now - previous);
        previous = now;
      }
      if (frame >= warmFrames + measuredFrames) finish();
      else requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }));

  const nonAborted = diagnostics.requestFailures.filter((failure) => !failure.error.includes('ERR_ABORTED'));
  return {
    ok: diagnostics.consoleErrors.length === 0
      && diagnostics.pageErrors.length === 0
      && nonAborted.length === 0,
    variant,
    protocol: {
      viewport: '1600x900@1',
      fixedTime: '2:00 PM',
      fixedWeather: 'dry 67F/46F',
      camera: 'dynamic clubhouse center + 30 yd, front-facing',
      warmFrames: 90,
      measuredFrames: 120,
    },
    metrics,
    diagnostics,
  };
}
