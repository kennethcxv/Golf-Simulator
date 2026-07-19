async (page) => {
  // MASTER ASSET 01-50 BASELINE
  //
  // Captures a deterministic, fully stocked player-camera baseline before the
  // cross-sheet production pass. Camera injection is limited to establishing a
  // repeatable visual fixture; later interaction acceptance uses normal controls.
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = path.resolve(process.env.QA_REPO_ROOT || process.cwd());
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const out = process.env.ASSET_QA_OUT
    ? path.resolve(repo, process.env.ASSET_QA_OUT)
    : path.join(repo, 'qa', 'assets_01_50_master', 'baseline', 'current');
  fs.mkdirSync(out, { recursive: true });

  const viewport = { width: 1600, height: 900 };
  const cameras = [
    { id: '01-checkout-overview', x: 0.5, z: 2.3, tx: 2.9, tz: 4.5, pitch: -0.10 },
    { id: '02-checkout-customer-side', x: 4.5, z: 5.4, tx: 2.7, tz: 4.4, pitch: -0.10 },
    { id: '03-club-and-putter-racks', x: -6.3, z: -0.2, tx: -9.9, tz: -0.4, pitch: 0.02 },
    { id: '04-ball-and-accessory-walls', x: -6.9, z: -3.5, tx: -6.9, tz: -6.2, pitch: 0.05 },
    { id: '05-apparel-and-tables', x: -4.0, z: 3.4, tx: -5.4, tz: 0.0, pitch: -0.02 },
    { id: '06-bag-and-shoe-displays', x: 2.3, z: 1.7, tx: 3.7, tz: -1.9, pitch: -0.02 },
    { id: '07-lounge', x: 1.3, z: -3.3, tx: 4.3, tz: -5.3, pitch: -0.03 },
    { id: '08-office', x: 7.2, z: 4.3, tx: 9.6, tz: 4.6, pitch: -0.06 },
    { id: '09-stockroom', x: 7.4, z: -2.3, tx: 8.1, tz: -5.9, pitch: -0.04 },
    { id: '10-receiving-and-pallets', x: 16.3, z: 4.9, yaw: 0.52, pitch: -0.25 },
    { id: '11-delivery-service-bay', x: 25.2, z: 9.2, yaw: 1.00, pitch: -0.14 },
    { id: '12-stockroom-equipment-close', x: 8.8, z: -1.8, yaw: 0.74, pitch: -0.20 },
    { id: '13-exterior', x: 6.5, z: 15.5, tx: -0.5, tz: 3.0, pitch: 0.03 },
    // Asset 20 was hidden behind the polo-table framing in camera 05. These
    // dedicated normal-eye-height views prove its front, depth and finished rear.
    { id: '14-asset20-front', x: 0.0, z: 0.9, tx: -2.4, tz: 0.9, pitch: -0.08 },
    { id: '15-asset20-three-quarter', x: -0.2, z: 2.2, tx: -2.4, tz: 0.9, pitch: -0.07 },
    { id: '16-asset20-rear', x: -4.4, z: 1.0, tx: -2.4, tz: 0.9, pitch: -0.07 },
  ];

  const diagnostics = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      diagnostics.push({ kind: `console:${message.type()}`, message: message.text() });
    }
  });
  page.on('pageerror', (error) => diagnostics.push({ kind: 'pageerror', message: error.message }));
  page.on('requestfailed', (request) => {
    const failure = request.failure()?.errorText || 'unknown';
    diagnostics.push({
      kind: /ERR_ABORTED/i.test(failure) ? 'requestaborted' : 'requestfailed',
      message: `${request.url()} (${failure})`,
    });
  });

  await page.setViewportSize(viewport);
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.getByText('Continue', { exact: true }).click();
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
  }, null, { timeout: 90000 });
  await page.waitForFunction(() => {
    const clubhouse = window.__fw?.scene3d?.clubhouse?.();
    if (!clubhouse) return false;
    const baseReady = !clubhouse.assetsReady || clubhouse.assetsReady();
    const equipmentReady = !clubhouse.deliveryEquipmentReady || clubhouse.deliveryEquipmentReady();
    const sheet06 = clubhouse.sheet06Production?.diagnostics?.() || null;
    const sheet06Ready = !clubhouse.sheet06Production
      || (sheet06?.actualSharedGameIntegrated === true && sheet06?.activationStatus === 'active');
    const runtime = clubhouse.assets51to100Runtime?.diagnostics?.() || null;
    const runtimeReady = !clubhouse.assets51to100Runtime
      || (runtime?.placed === 40 && runtime?.failed === 0);
    return baseReady && equipmentReady && sheet06Ready && runtimeReady;
  }, null, { timeout: 90000 });

  const fixture = await page.evaluate(async () => {
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    const { capacityOf } = await import('/src/data/fixtureSlots.js');
    app.speedIdx = 0;
    app.scene3d.walk.clearKeys?.();
    clubhouse.setOrganicWalkins?.(false);
    clubhouse.clearWalkins?.();
    const day = Math.floor(app.state.clock.minutes / 1440) * 1440;
    app.state.clock.minutes = day + 14 * 60;
    app.state.weather.today = {
      tempHiF: 72,
      tempLoF: 54,
      rainIn: 0,
      humidity: 0.48,
      windMph: 5,
    };
    app.state.weather.locked = true;
    if (app.state.shop.reno) {
      app.state.shop.reno.grime.fill(0);
      for (const clutter of app.state.shop.reno.clutter || []) clutter.cleared = true;
      app.state.shop.reno.debris = [];
      app.state.shop.reno.debrisSeeded = true;
    }
    const nonRetail = new Set(['rug1', 'plant1', 'poster1', 'board1', 'light1', 'lounge1', 'vac1']);
    const parkedNonRetail = [];
    for (const [id, entry] of Object.entries(app.state.shop.inventory || {})) {
      if (entry && typeof entry === 'object') {
        if (nonRetail.has(id)) {
          entry.shelf = 0;
          entry.back = 0;
          parkedNonRetail.push(id);
          continue;
        }
        // Full means every authored physical slot, not an arbitrary count that
        // the renderer must silently clamp. This keeps labels, state and pixels
        // on the same eight-place Asset 20 contract (and likewise for all lines).
        entry.shelf = capacityOf(id);
        entry.back = Math.max(6, Number(entry.back) || 0);
      }
    }
    clubhouse.rebuildStock?.();
    clubhouse.rebuildReno?.();
    app.scene3d.applyTimeWeather?.(14 * 60, app.state.weather);
    return {
      description: 'Willow Creek bootstrap, paused at 2 PM, clear weather, clean/clutter-free shop, fully stocked retail inventory, organic customers disabled',
      interiorOffset: clubhouse.interior.position.toArray(),
      inventoryEntries: Object.keys(app.state.shop.inventory || {}).length,
      parkedNonRetail,
      deliveryEquipment: clubhouse.deliveryEquipmentDiagnostics?.() || null,
      assets51to100Runtime: clubhouse.assets51to100Runtime?.diagnostics?.() || null,
    };
  });
  await page.waitForTimeout(1200);

  // Fixed-camera evidence has its own normal-control acceptance route. Hide only the
  // automation reminder here so changing pointer-lock state cannot pollute performance samples.
  const pointerLockAcquired = false;
  await page.evaluate(() => {
    const hint = document.querySelector('.shop-lockhint');
    if (hint) hint.style.visibility = 'hidden';
  });
  await page.waitForTimeout(180);

  const captured = [];
  for (const camera of cameras) {
    await page.evaluate((shot) => {
      const app = window.__fw;
      const walk = app.scene3d.walk;
      const state = walk.state;
      walk.clearKeys?.();
      const origin = app.scene3d.clubhouse().interior.position;
      state.x = shot.world ? shot.x : origin.x + shot.x;
      state.z = shot.world ? shot.z : origin.z + shot.z;
      if (Number.isFinite(shot.yaw)) state.yaw = shot.yaw;
      else {
        const targetX = shot.world ? shot.tx : origin.x + shot.tx;
        const targetZ = shot.world ? shot.tz : origin.z + shot.tz;
        const dx = targetX - state.x;
        const dz = targetZ - state.z;
        const distance = Math.hypot(dx, dz) || 1;
        state.yaw = Math.atan2(-dx / distance, -dz / distance);
      }
      state.pitch = shot.pitch;
      const day = Math.floor(app.state.clock.minutes / 1440) * 1440;
      app.state.clock.minutes = day + 14 * 60;
      app.scene3d.applyTimeWeather?.(14 * 60, app.state.weather);
    }, camera);
    await page.waitForTimeout(500);
    const file = path.join(out, `${camera.id}.png`);
    await page.screenshot({ path: file });
    captured.push(file);
  }

  const frameSamples = [];
  for (let sample = 0; sample < 3; sample += 1) {
    const frames = await page.evaluate(() => new Promise((resolve) => {
      const values = [];
      let prior = performance.now();
      const start = prior;
      function tick(now) {
        values.push(now - prior);
        prior = now;
        if (now - start >= 2500) resolve(values.slice(1));
        else requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    }));
    frameSamples.push(frames);
  }

  const flatFrames = frameSamples.flat().filter((value) => value > 0);
  const sortedSlow = [...flatFrames].sort((a, b) => b - a);
  const slowCount = Math.max(1, Math.ceil(sortedSlow.length * 0.01));
  const slowMean = sortedSlow.slice(0, slowCount).reduce((sum, value) => sum + value, 0) / slowCount;
  const duration = flatFrames.reduce((sum, value) => sum + value, 0);

  const renderer = await page.evaluate(() => new Promise((resolve) => {
    const s3 = window.__fw.scene3d;
    const output = s3.renderer;
    output.info.autoReset = false;
    output.info.reset();
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const materials = new Set();
      const textures = new Set();
      let meshes = 0;
      let sceneTriangles = 0;
      let shadowCasters = 0;
      let nodes = 0;
      s3.scene.traverse((object) => {
        nodes += 1;
        if (!object.isMesh || !object.visible) return;
        meshes += 1;
        if (object.castShadow) shadowCasters += 1;
        const geometry = object.geometry;
        const triangles = geometry?.index
          ? geometry.index.count / 3
          : (geometry?.attributes?.position?.count || 0) / 3;
        sceneTriangles += triangles * (object.isInstancedMesh ? object.count : 1);
        for (const material of (Array.isArray(object.material) ? object.material : [object.material])) {
          if (!material) continue;
          materials.add(material.uuid);
          for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap']) {
            if (material[key]) textures.add(material[key].uuid);
          }
        }
      });
      const result = {
        drawCalls: output.info.render.calls,
        renderedTriangles: output.info.render.triangles,
        sceneTriangles: Math.round(sceneTriangles),
        sceneNodes: nodes,
        visibleMeshes: meshes,
        materialCount: materials.size,
        textureCount: textures.size,
        textureMemoryBytes: null,
        shadowCasters,
        geometriesInMemory: output.info.memory.geometries,
        texturesInMemory: output.info.memory.textures,
      };
      output.info.autoReset = true;
      resolve(result);
    }));
  }));

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const performanceMetrics = await cdp.send('Performance.getMetrics');
  const browser = Object.fromEntries(performanceMetrics.metrics.map((metric) => [metric.name, metric.value]));
  await cdp.detach();

  const report = {
    capturedAt: new Date().toISOString(),
    launch: 'node tools/qa/run-playwright.cjs tools/qa/assets-01-50-baseline.js --bootstrap',
    methodology: {
      viewport,
      deviceScaleFactor: 1,
      warmup: 'shader veil cleared, all declared clubhouse/delivery assets ready, then 1.2 seconds',
      frameSampling: 'three consecutive 2.5 second requestAnimationFrame samples at fixed camera 13',
      textureMemory: 'unmeasured; renderer exposes count but not byte size',
      cameraEstablishment: 'documented deterministic fixture; normal-control acceptance is separate',
      pointerLockAcquired,
    },
    fixture,
    cameras,
    captures: captured,
    performance: {
      frameCount: flatFrames.length,
      averageFps: flatFrames.length * 1000 / duration,
      onePercentLowFps: 1000 / slowMean,
      worstFrameMs: sortedSlow[0] || null,
      renderer,
      browser: {
        jsHeapUsedBytes: browser.JSHeapUsedSize ?? null,
        jsHeapTotalBytes: browser.JSHeapTotalSize ?? null,
        eventListeners: browser.JSEventListeners ?? null,
        nodes: browser.Nodes ?? null,
        documents: browser.Documents ?? null,
      },
    },
    diagnostics,
  };
  fs.writeFileSync(path.join(out, 'baseline-result.json'), `${JSON.stringify(report, null, 2)}\n`);
  const blockingDiagnostics = diagnostics.filter((entry) => ![
    'console:warning',
    'requestaborted',
  ].includes(entry.kind));
  return { ok: blockingDiagnostics.length === 0, ...report };
}
