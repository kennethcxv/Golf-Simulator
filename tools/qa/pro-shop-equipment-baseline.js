async (page) => {
  // Fixed-camera, fixed-time baseline for the equipment program. The fixture only
  // selects a deterministic save and camera poses; the rendered game is untouched.
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const out = path.resolve(process.env.EQUIPMENT_QA_OUT
    || 'qa/pro-shop-equipment/baseline');
  fs.mkdirSync(out, { recursive: true });

  const diagnostics = { consoleErrors: [], consoleWarnings: [], pageErrors: [], requestFailures: [] };
  page.on('console', (message) => {
    if (message.type() === 'error') diagnostics.consoleErrors.push(message.text());
    if (message.type() === 'warning') diagnostics.consoleWarnings.push(message.text());
  });
  page.on('pageerror', (error) => diagnostics.pageErrors.push(error.message));
  page.on('requestfailed', (request) => diagnostics.requestFailures.push({
    url: request.url(),
    error: request.failure()?.errorText || 'unknown',
  }));

  await page.goto(baseUrl);
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.getByText('Continue', { exact: true }).click().catch(() => {});
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    if (!veil) return true;
    const style = getComputedStyle(veil);
    return style.display === 'none' || Number.parseFloat(style.opacity || '1') <= 0.01;
  }, null, { timeout: 90000 });
  await page.waitForTimeout(1200);

  const cameraDefinitions = [
    { id: 'checkout', local: true, at: [0.5, 2.3], to: [3.0, 4.5], pitch: -0.10 },
    { id: 'office', local: true, at: [7.0, 3.6], to: [9.3, 4.6], pitch: -0.04 },
    { id: 'stockroom', local: true, at: [7.1, -2.0], to: [8.1, -5.8], pitch: -0.06 },
    { id: 'golf-cart', token: 'golf_cart', distance: 3.8, pitch: -0.08 },
    { id: 'ball-washer', token: 'ball_washer', distance: 2.6, pitch: -0.08 },
    { id: 'bench', token: 'bench_course', distance: 3.2, pitch: -0.08 },
    { id: 'trash-can', token: 'trash_course', distance: 2.6, pitch: -0.08 },
  ];

  async function pose(definition) {
    return page.evaluate((shot) => {
      const app = window.__fw;
      const scene = app.scene3d.scene;
      const walk = app.scene3d.walk;
      const clubhouse = app.scene3d.clubhouse();
      const day = Math.floor(app.state.clock.minutes / 1440) * 1440;
      app.state.clock.minutes = day + 14 * 60;
      app.scene3d.applyTimeWeather?.(14 * 60, app.state.weather);
      walk.clearKeys?.();

      let ax, az, tx, tz;
      if (shot.local) {
        const origin = clubhouse.interior.position;
        ax = origin.x + shot.at[0];
        az = origin.z + shot.at[1];
        tx = origin.x + shot.to[0];
        tz = origin.z + shot.to[1];
      } else {
        const matches = [];
        scene.traverse((object) => {
          if (String(object.name || '').toLowerCase().includes(shot.token)) matches.push(object);
        });
        const target = matches.find((object) => object.visible) || matches[0];
        if (!target) return { found: false, token: shot.token };
        const p = target.getWorldPosition(target.position.clone());
        tx = p.x;
        tz = p.z;
        ax = tx + shot.distance * 0.72;
        az = tz + shot.distance;
      }
      const dx = tx - ax;
      const dz = tz - az;
      const distance = Math.hypot(dx, dz) || 1;
      walk.state.x = ax;
      walk.state.z = az;
      walk.state.yaw = Math.atan2(-dx / distance, -dz / distance);
      walk.state.pitch = shot.pitch;
      return { found: true, at: [ax, az], target: [tx, tz] };
    }, definition);
  }

  async function samplePerformance(label, durationMs = 4000) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Performance.enable');
    const sample = await page.evaluate(async (duration) => {
      const ui = document.querySelector('#ui');
      let uiUpdates = 0;
      const observer = new MutationObserver((records) => { uiUpdates += records.length; });
      if (ui) observer.observe(ui, { subtree: true, childList: true, characterData: true, attributes: true });
      const frames = [];
      let previous = performance.now();
      const started = previous;
      await new Promise((resolve) => {
        const tick = (now) => {
          frames.push(now - previous);
          previous = now;
          if (now - started >= duration) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      observer.disconnect();
      return { frames: frames.slice(1), uiUpdates, elapsedMs: performance.now() - started };
    }, durationMs);
    const renderer = await page.evaluate(() => new Promise((resolve) => {
      const app = window.__fw.scene3d;
      const output = app.renderer;
      output.info.autoReset = false;
      output.info.reset();
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const materials = new Set();
        const textures = new Set();
        let visibleMeshes = 0;
        let sceneTriangles = 0;
        let textureMemoryBytes = 0;
        app.scene.traverse((object) => {
          if (!object.isMesh || !object.visible) return;
          visibleMeshes += 1;
          const geometry = object.geometry;
          const triangles = geometry?.index
            ? geometry.index.count / 3
            : (geometry?.attributes?.position?.count || 0) / 3;
          sceneTriangles += triangles * (object.isInstancedMesh ? object.count : 1);
          for (const material of (Array.isArray(object.material) ? object.material : [object.material])) {
            if (!material) continue;
            materials.add(material.uuid);
            for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap']) {
              const texture = material[key];
              if (!texture || textures.has(texture.uuid)) continue;
              textures.add(texture.uuid);
              const image = texture.image;
              if (image?.width && image?.height) textureMemoryBytes += image.width * image.height * 4 * 4 / 3;
            }
          }
        });
        const result = {
          drawCalls: output.info.render.calls,
          renderedTriangles: output.info.render.triangles,
          sceneTriangles: Math.round(sceneTriangles),
          visibleMeshes,
          materialCount: materials.size,
          textureCount: textures.size,
          textureMemoryBytes: Math.round(textureMemoryBytes),
          geometriesInMemory: output.info.memory.geometries,
          texturesInMemory: output.info.memory.textures,
        };
        output.info.autoReset = true;
        resolve(result);
      }));
    }));
    const metrics = await cdp.send('Performance.getMetrics');
    await cdp.detach();
    const perf = Object.fromEntries(metrics.metrics.map((entry) => [entry.name, entry.value]));
    const frames = sample.frames.filter((value) => value > 0);
    const descending = [...frames].sort((a, b) => b - a);
    const count = Math.max(1, Math.ceil(descending.length * 0.01));
    const onePercentFrameMs = descending.slice(0, count).reduce((sum, value) => sum + value, 0) / count;
    return {
      label,
      durationMs: sample.elapsedMs,
      averageFps: frames.length * 1000 / frames.reduce((sum, value) => sum + value, 0),
      onePercentLowFps: 1000 / onePercentFrameMs,
      worstFrameMs: descending[0] || null,
      uiUpdates: sample.uiUpdates,
      uiUpdatesPerSecond: sample.uiUpdates / (sample.elapsedMs / 1000),
      renderer,
      browser: {
        jsHeapUsedBytes: perf.JSHeapUsedSize ?? null,
        jsHeapTotalBytes: perf.JSHeapTotalSize ?? null,
        eventListeners: perf.JSEventListeners ?? null,
      },
    };
  }

  const captures = [];
  const resolvedCameras = [];
  for (const definition of cameraDefinitions) {
    const resolved = await pose(definition);
    resolvedCameras.push({ ...definition, resolved });
    if (!resolved.found) continue;
    await page.waitForTimeout(650);
    const file = path.join(out, `${definition.id}.png`);
    await page.screenshot({ path: file });
    captures.push(file);
  }

  await pose(cameraDefinitions[0]);
  await page.waitForTimeout(800);
  const performance = await samplePerformance('fixed-checkout-camera');
  const blockingRequestFailures = diagnostics.requestFailures.filter((failure) => !/ERR_ABORTED/i.test(failure.error));
  const result = {
    ok: diagnostics.consoleErrors.length === 0
      && diagnostics.pageErrors.length === 0
      && blockingRequestFailures.length === 0,
    capturedAt: new Date().toISOString(),
    launch: 'node tools/qa/run-playwright.cjs tools/qa/pro-shop-equipment-baseline.js --bootstrap',
    viewport: { width: 1600, height: 900, deviceScaleFactor: 1 },
    fixture: { seed: 424242, time: '2:00 PM', cameraOnly: true },
    cameraDefinitions: resolvedCameras,
    captures,
    performance,
    diagnostics: { ...diagnostics, blockingRequestFailures },
  };
  fs.writeFileSync(path.join(out, 'baseline-result.json'), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}
