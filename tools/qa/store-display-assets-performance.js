async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = process.cwd();
  const mode = process.env.STORE_DISPLAY_PERF_MODE || 'default';
  const out = process.env.STORE_DISPLAY_PERF_OUT
    ? path.resolve(repo, process.env.STORE_DISPLAY_PERF_OUT)
    : path.join(repo, 'qa', 'store_display_assets', 'performance', mode);
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8458/';
  fs.mkdirSync(out, { recursive: true });
  if (!['default', 'showroom'].includes(mode)) throw new Error(`Unknown performance mode: ${mode}`);

  const diagnostics = [];
  page.on('console', (message) => {
    if (['error', 'warning'].includes(message.type())) diagnostics.push({
      kind: `console:${message.type()}`, message: message.text(),
    });
  });
  page.on('pageerror', (error) => diagnostics.push({ kind: 'pageerror', message: error.message }));
  page.on('requestfailed', (request) => diagnostics.push({
    kind: 'requestfailed',
    message: `${request.url()} (${request.failure()?.errorText || 'unknown'})`,
  }));

  const query = mode === 'showroom' ? '?storeDisplayShowroom=built_in_cabinetry' : '';
  await page.goto(`${baseUrl}${query}`, { waitUntil: 'domcontentloaded' });
  await page.getByText('Continue', { exact: true }).click();
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90_000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
  }, null, { timeout: 90_000 });
  await page.waitForFunction((selectedMode) => {
    const clubhouse = window.__fw?.scene3d?.clubhouse?.();
    if (!clubhouse) return false;
    const baseReady = !clubhouse.assetsReady || clubhouse.assetsReady();
    const equipmentReady = !clubhouse.deliveryEquipmentReady || clubhouse.deliveryEquipmentReady();
    const sheet06 = clubhouse.sheet06Production?.diagnostics?.() || null;
    const sheet06Ready = !clubhouse.sheet06Production
      || (sheet06?.actualSharedGameIntegrated === true && sheet06?.activationStatus === 'active');
    if (!baseReady || !equipmentReady || !sheet06Ready) return false;
    if (selectedMode === 'showroom') {
      const display = clubhouse.storeDisplays?.diagnostics?.();
      return display?.state === 'ready' && display.loaded === 5;
    }
    return true;
  }, mode, { timeout: 90_000 });

  const fixture = await page.evaluate(async (selectedMode) => {
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    app.speedIdx = 0;
    app.scene3d.walk.clearKeys?.();
    clubhouse.setOrganicWalkins?.(false);
    clubhouse.clearWalkins?.();
    const day = Math.floor(app.state.clock.minutes / 1440) * 1440;
    app.state.clock.minutes = day + 14 * 60;
    app.state.weather.today = {
      tempHiF: 72, tempLoF: 54, rainIn: 0, humidity: .48, windMph: 5,
    };
    app.state.weather.locked = true;
    if (selectedMode === 'showroom') {
      const display = clubhouse.storeDisplays.diagnostics();
      Object.assign(app.scene3d.walk.state, display.cameraPose);
      return { mode: selectedMode, display };
    }
    const { capacityOf } = await import('/src/data/fixtureSlots.js');
    if (app.state.shop.reno) {
      app.state.shop.reno.grime.fill(0);
      for (const clutter of app.state.shop.reno.clutter || []) clutter.cleared = true;
    }
    const nonRetail = new Set(['rug1', 'plant1', 'poster1', 'board1', 'light1', 'lounge1', 'vac1']);
    for (const [id, entry] of Object.entries(app.state.shop.inventory || {})) {
      if (!entry || typeof entry !== 'object') continue;
      entry.shelf = nonRetail.has(id) ? 0 : capacityOf(id);
      entry.back = nonRetail.has(id) ? 0 : Math.max(6, Number(entry.back) || 0);
    }
    clubhouse.rebuildStock?.();
    clubhouse.rebuildReno?.();
    const origin = clubhouse.interior.position;
    const state = app.scene3d.walk.state;
    state.x = origin.x - 4.0;
    state.z = origin.z + 3.4;
    const targetX = origin.x - 5.4;
    const targetZ = origin.z;
    const dx = targetX - state.x;
    const dz = targetZ - state.z;
    const distance = Math.hypot(dx, dz) || 1;
    state.yaw = Math.atan2(-dx / distance, -dz / distance);
    state.pitch = -.02;
    return { mode: selectedMode, interiorOffset: origin.toArray() };
  }, mode);
  await page.waitForTimeout(2200);
  await page.screenshot({ path: path.join(out, `${mode}-performance-view.png`) });

  const samples = [];
  for (let index = 0; index < 3; index += 1) {
    samples.push(await page.evaluate(() => new Promise((resolve) => {
      const values = [];
      let prior = performance.now();
      const started = prior;
      function tick(now) {
        values.push(now - prior);
        prior = now;
        if (now - started >= 2500) resolve(values.slice(1));
        else requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    })));
  }
  const frames = samples.flat().filter((value) => value > 0);
  const duration = frames.reduce((sum, value) => sum + value, 0);
  const slow = [...frames].sort((a, b) => b - a);
  const slowCount = Math.max(1, Math.ceil(slow.length * .01));
  const slowMean = slow.slice(0, slowCount).reduce((sum, value) => sum + value, 0) / slowCount;

  const renderer = await page.evaluate(() => new Promise((resolve) => {
    const s3 = window.__fw.scene3d;
    const output = s3.renderer;
    const activeLayers = s3.camera.layers;
    output.info.autoReset = false;
    output.info.reset();
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const materials = new Set();
      const textures = new Set();
      let nodes = 0;
      let meshes = 0;
      let sceneTriangles = 0;
      s3.scene.traverse((object) => {
        if (object.layers.test(activeLayers)) nodes += 1;
        if (!object.isMesh || !object.visible || !object.layers.test(activeLayers)) return;
        meshes += 1;
        const geometry = object.geometry;
        sceneTriangles += (geometry?.index
          ? geometry.index.count / 3
          : (geometry?.attributes?.position?.count || 0) / 3) * (object.isInstancedMesh ? object.count : 1);
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
  const expected = diagnostics.filter((entry) => /ERR_ABORTED/u.test(entry.message)
    || (/WebGLProgram/u.test(entry.message) && /uninitialized variable/u.test(entry.message)));
  const blocking = diagnostics.filter((entry) => !expected.includes(entry));
  const report = {
    ok: blocking.length === 0 && frames.length > 100,
    mode,
    fixture,
    sampleCount: frames.length,
    averageFps: frames.length / (duration / 1000),
    onePercentLowFps: 1000 / slowMean,
    worstFrameMs: Math.max(...frames),
    renderer,
    browser,
    diagnostics,
    expectedDiagnostics: expected,
    blockingDiagnostics: blocking,
  };
  fs.writeFileSync(path.join(out, `${mode}-performance.json`), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}
