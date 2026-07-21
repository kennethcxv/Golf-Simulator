async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = process.cwd();
  const iteration = process.env.STORE_DISPLAY_ITERATION || 'iteration-01';
  const out = process.env.STORE_DISPLAY_QA_OUT
    ? path.resolve(repo, process.env.STORE_DISPLAY_QA_OUT)
    : path.join(repo, 'qa', 'store_display_assets', 'browser', iteration);
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8458/';
  fs.mkdirSync(out, { recursive: true });

  const diagnostics = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      diagnostics.push({ kind: `console:${message.type()}`, message: message.text() });
    }
  });
  page.on('pageerror', (error) => diagnostics.push({ kind: 'pageerror', message: error.message }));
  page.on('requestfailed', (request) => diagnostics.push({
    kind: 'requestfailed',
    message: `${request.url()} (${request.failure()?.errorText || 'unknown'})`,
  }));

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(`${baseUrl}?storeDisplayShowroom=clothing_rack`, { waitUntil: 'domcontentloaded' });
  await page.getByText('Continue', { exact: true }).click();
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.()?.storeDisplays, null, {
    timeout: 90_000,
  });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
  }, null, { timeout: 90_000 });
  await page.waitForFunction(() => {
    const diagnostics = window.__fw?.scene3d?.clubhouse?.()?.storeDisplays?.diagnostics?.();
    return diagnostics?.state === 'ready';
  }, null, { timeout: 90_000 });

  const setup = await page.evaluate(() => {
    const app = window.__fw;
    app.speedIdx = 0;
    const day = Math.floor(app.state.clock.minutes / 1440) * 1440;
    app.state.clock.minutes = day + 14 * 60;
    app.state.weather.today = {
      tempHiF: 72, tempLoF: 54, rainIn: 0, humidity: .48, windMph: 5,
    };
    app.state.weather.locked = true;
    app.scene3d.walk.clearKeys?.();
    const clubhouse = app.scene3d.clubhouse();
    clubhouse.setOrganicWalkins?.(false);
    clubhouse.clearWalkins?.();
    return {
      shopStateBefore: JSON.stringify(app.state.shop),
      display: clubhouse.storeDisplays.diagnostics(),
    };
  });
  await page.locator('#game').click({ position: { x: 800, y: 450 } });
  await page.waitForTimeout(150);

  async function showFamily(family) {
    const value = await page.evaluate(async (familyId) => {
      const app = window.__fw;
      const runtime = app.scene3d.clubhouse().storeDisplays;
      const current = runtime.diagnostics();
      if (current.family !== familyId || current.state !== 'ready') await runtime.showFamily(familyId);
      const diagnostic = runtime.diagnostics();
      const walk = app.scene3d.walk;
      walk.clearKeys?.();
      walk.state.x = diagnostic.cameraPose.x;
      walk.state.z = diagnostic.cameraPose.z;
      walk.state.yaw = diagnostic.cameraPose.yaw;
      walk.state.pitch = diagnostic.cameraPose.pitch;
      const day = Math.floor(app.state.clock.minutes / 1440) * 1440;
      app.state.clock.minutes = day + 14 * 60;
      app.scene3d.applyTimeWeather?.(14 * 60, app.state.weather);
      return diagnostic;
    }, family);
    await page.waitForTimeout(700);
    return value;
  }

  const families = setup.display.availableFamilies;
  const captures = [];
  const familyDiagnostics = [];
  for (let index = 0; index < families.length; index += 1) {
    const family = families[index];
    const diagnostic = await showFamily(family);
    familyDiagnostics.push(diagnostic);
    const file = path.join(out, `${String(index + 1).padStart(2, '0')}-${family}.png`);
    await page.screenshot({ path: file });
    await page.waitForTimeout(250);
    captures.push(file);
  }

  // Exercise the gallery through the same keyboard path as the player. Camera
  // injection establishes only a deterministic starting pose; movement itself
  // uses browser keyboard events and the production walk controller.
  await showFamily('clothing_rack');
  const normalControlsBefore = await page.evaluate(() => {
    const state = window.__fw.scene3d.walk.state;
    return { x: state.x, z: state.z, yaw: state.yaw, pitch: state.pitch };
  });
  await page.keyboard.down('w');
  await page.waitForTimeout(650);
  await page.keyboard.up('w');
  await page.keyboard.down('d');
  await page.waitForTimeout(450);
  await page.keyboard.up('d');
  await page.waitForTimeout(250);
  const normalControlsAfter = await page.evaluate(() => {
    const state = window.__fw.scene3d.walk.state;
    return { x: state.x, z: state.z, yaw: state.yaw, pitch: state.pitch };
  });
  await page.screenshot({ path: path.join(out, '19-normal-controls-after.png') });

  await showFamily('built_in_cabinetry');
  await page.waitForTimeout(2200);
  const frameSamples = [];
  for (let sample = 0; sample < 3; sample += 1) {
    frameSamples.push(await page.evaluate(() => new Promise((resolve) => {
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
  const flatFrames = frameSamples.flat().filter((value) => value > 0);
  const sortedSlow = [...flatFrames].sort((a, b) => b - a);
  const slowCount = Math.max(1, Math.ceil(sortedSlow.length * .01));
  const slowMean = sortedSlow.slice(0, slowCount).reduce((sum, value) => sum + value, 0) / slowCount;
  const duration = flatFrames.reduce((sum, value) => sum + value, 0);

  const renderer = await page.evaluate(() => new Promise((resolve) => {
    const s3 = window.__fw.scene3d;
    const output = s3.renderer;
    const activeLayers = s3.camera.layers;
    output.info.autoReset = false;
    output.info.reset();
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const materials = new Set();
      const textures = new Set();
      let meshes = 0;
      let nodes = 0;
      let sceneTriangles = 0;
      s3.scene.traverse((object) => {
        if (object.layers.test(activeLayers)) nodes += 1;
        if (!object.isMesh || !object.visible || !object.layers.test(activeLayers)) return;
        meshes += 1;
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

  const stateCheck = await page.evaluate(() => ({
    shopStateAfter: JSON.stringify(window.__fw.state.shop),
    display: window.__fw.scene3d.clubhouse().storeDisplays.diagnostics(),
  }));
  const movementDistance = Math.hypot(
    normalControlsAfter.x - normalControlsBefore.x,
    normalControlsAfter.z - normalControlsBefore.z,
  );
  const expectedUnloadDiagnostics = diagnostics.filter((entry) => /ERR_ABORTED/u.test(entry.message));
  const blockingDiagnostics = diagnostics.filter((entry) => !expectedUnloadDiagnostics.includes(entry)
    && !(/WebGLProgram/u.test(entry.message) && /uninitialized variable/u.test(entry.message)));
  const report = {
    ok: familyDiagnostics.every((item) => item.state === 'ready' && item.loaded === 5)
      && movementDistance > .2
      && setup.shopStateBefore === stateCheck.shopStateAfter
      && blockingDiagnostics.length === 0,
    iteration,
    viewport: { width: 1600, height: 900 },
    familyCount: families.length,
    assetCountShown: familyDiagnostics.reduce((sum, item) => sum + item.loaded, 0),
    captures,
    familyDiagnostics,
    normalControls: { before: normalControlsBefore, after: normalControlsAfter, movementDistance },
    saveStateUntouched: setup.shopStateBefore === stateCheck.shopStateAfter,
    performance: {
      sampleCount: flatFrames.length,
      averageFps: flatFrames.length / (duration / 1000),
      onePercentLowFps: 1000 / slowMean,
      worstFrameMs: Math.max(...flatFrames),
      renderer,
      browser,
    },
    diagnostics,
    expectedUnloadDiagnostics,
    blockingDiagnostics,
  };
  fs.writeFileSync(path.join(out, 'visual-qa-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}
