async (page) => {
  // Assets 51-100 + first-person cleaning baseline.
  //
  // The established 01-50 route already owns the canonical clubhouse fixture,
  // thirteen fixed cameras, renderer counters, and browser diagnostics. Reuse
  // that exact route so the two master passes remain directly comparable, then
  // add architecture and current-tool cameras plus fixed vacuum/washer stress
  // samples. This script changes only the isolated browser save fixture.
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const crypto = process.getBuiltinModule('node:crypto');
  const repo = path.resolve(process.env.QA_REPO_ROOT || process.cwd());
  const out = process.env.ASSET_QA_OUT
    ? path.resolve(repo, process.env.ASSET_QA_OUT)
    : path.join(repo, 'qa', 'assets_51_100_master', 'baseline', 'current');
  fs.mkdirSync(out, { recursive: true });

  const inheritedPath = path.join(repo, 'tools', 'qa', 'assets-01-50-baseline.js');
  const inheritedSource = fs.readFileSync(inheritedPath, 'utf8');
  const inheritedSha256 = crypto.createHash('sha256').update(inheritedSource).digest('hex');
  const inheritedRun = Function(`"use strict"; return (${inheritedSource});`)();
  const oldOut = process.env.ASSET_QA_OUT;
  process.env.ASSET_QA_OUT = path.relative(repo, out).split(path.sep).join('/');
  let baseline;
  try {
    baseline = await inheritedRun(page);
  } finally {
    if (oldOut === undefined) delete process.env.ASSET_QA_OUT;
    else process.env.ASSET_QA_OUT = oldOut;
  }

  const extraDiagnostics = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      extraDiagnostics.push({ kind: `console:${message.type()}`, message: message.text() });
    }
  });
  page.on('pageerror', (error) => extraDiagnostics.push({ kind: 'pageerror', message: error.message }));
  page.on('requestfailed', (request) => {
    const failure = request.failure()?.errorText || 'unknown';
    extraDiagnostics.push({
      kind: /ERR_ABORTED/i.test(failure) ? 'requestaborted' : 'requestfailed',
      message: `${request.url()} (${failure})`,
    });
  });

  const cameras = [
    { id: '14-entry-porch-and-double-doors', x: -4.8, z: 11.6, tx: -0.8, tz: 6.4, pitch: -0.02 },
    { id: '15-south-windows-and-siding', x: -8.0, z: 12.8, tx: -6.4, tz: 6.5, pitch: 0.02 },
    { id: '16-interior-wall-floor-ceiling', x: -1.0, z: 1.4, tx: -7.5, tz: -3.8, pitch: 0.13 },
    { id: '17-front-and-back-counter-context', x: 0.2, z: 2.0, tx: 3.2, tz: 4.6, pitch: -0.08 },
    { id: '18-lounge-furniture-context', x: 1.0, z: -2.6, tx: 4.0, tz: -5.0, pitch: -0.05 },
    { id: '19-office-desk-chair-and-props', x: 7.0, z: 3.6, tx: 9.3, tz: 4.6, pitch: -0.04 },
    { id: '20-stockroom-shelving-and-cleaning-corner', x: 7.1, z: -2.0, tx: 6.1, tz: 1.45, pitch: -0.07 },
    { id: '23-fitting-room-three-quarter', x: -6.75, z: 4.40, tx: -9.30, tz: 4.40, pitch: -0.04 },
    { id: '24-packing-worktable-and-mounted-tools', x: 8.75, z: 0.45, tx: 6.90, tz: -0.90, pitch: -0.24 },
    { id: '25-cleaning-bay-player-approach', x: 8.85, z: 0.05, tx: 6.85, tz: 1.52, pitch: -0.24 },
    { id: '26-stock-shelf-box-supports', x: 6.95, z: -3.25, tx: 8.10, tz: -5.82, pitch: -0.12 },
    { id: '27-entry-safety-and-utilities', x: 2.70, z: 3.85, tx: -0.40, tz: 6.25, pitch: 0.10 },
    { id: '28-pressure-washer-storage-clearance', x: 8.15, z: -4.45, tx: 6.38, tz: -5.65, pitch: -0.24 },
  ];

  async function pose(camera, tool = null, dirty = false) {
    await page.evaluate(({ shot, heldTool, makeDirty }) => {
      const app = window.__fw;
      const clubhouse = app.scene3d.clubhouse();
      const walk = app.scene3d.walk;
      const origin = clubhouse.interior.position;
      walk.clearKeys?.();
      walk.state.x = origin.x + shot.x;
      walk.state.z = origin.z + shot.z;
      const targetX = origin.x + shot.tx;
      const targetZ = origin.z + shot.tz;
      const dx = targetX - walk.state.x;
      const dz = targetZ - walk.state.z;
      const distance = Math.hypot(dx, dz) || 1;
      walk.state.yaw = Math.atan2(-dx / distance, -dz / distance);
      walk.state.pitch = shot.pitch;
      if (makeDirty && app.state.shop?.reno?.grime) {
        app.state.shop.reno.grime.fill(0.82);
        clubhouse.rebuildReno?.();
      }
      if (app.state.shop?.inventory?.vac1) app.state.shop.inventory.vac1.back = Math.max(1, app.state.shop.inventory.vac1.back || 0);
      walk.setSpraying?.(false);
      walk.setSoaping?.(false);
      walk.setTool?.(heldTool);
      const day = Math.floor(app.state.clock.minutes / 1440) * 1440;
      app.state.clock.minutes = day + 14 * 60;
      app.scene3d.applyTimeWeather?.(14 * 60, app.state.weather);
    }, { shot: camera, heldTool: tool, makeDirty: dirty });
    await page.waitForTimeout(700);
  }

  const extraCaptures = [];
  for (const camera of cameras) {
    await pose(camera);
    const file = path.join(out, `${camera.id}.png`);
    await page.screenshot({ path: file });
    extraCaptures.push(file);
  }

  const vacuumCamera = { id: '21-current-vacuum-viewmodel', x: -0.2, z: 1.8, tx: -0.2, tz: -0.2, pitch: -0.30 };
  await pose(vacuumCamera, 'vacuum', true);
  const vacuumFile = path.join(out, `${vacuumCamera.id}.png`);
  await page.screenshot({ path: vacuumFile });
  extraCaptures.push(vacuumFile);

  const washerCamera = { id: '22-current-pressure-washer-viewmodel', x: -1.0, z: 11.5, tx: -1.0, tz: 6.4, pitch: -0.02 };
  await pose(washerCamera, 'washer');
  const washerFile = path.join(out, `${washerCamera.id}.png`);
  await page.screenshot({ path: washerFile });
  extraCaptures.push(washerFile);

  async function measureScenario(name, camera, tool, useTool) {
    await pose(camera, tool, tool === 'vacuum');
    await page.evaluate((on) => window.__fw.scene3d.walk.setSpraying?.(on), useTool);
    await page.waitForTimeout(800);
    const sample = await page.evaluate(async () => {
      const hud = document.querySelector('.hud') || document.querySelector('#ui');
      let uiMutations = 0;
      const observer = new MutationObserver((records) => { uiMutations += records.length; });
      if (hud) observer.observe(hud, { subtree: true, childList: true, characterData: true, attributes: true });
      const frames = [];
      let prior = performance.now();
      const start = prior;
      await new Promise((resolve) => {
        function tick(now) {
          frames.push(now - prior);
          prior = now;
          if (now - start >= 5000) resolve();
          else requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
      });
      observer.disconnect();
      return { frames: frames.slice(1), uiMutations, durationMs: performance.now() - start };
    });
    await page.evaluate(() => {
      const walk = window.__fw.scene3d.walk;
      walk.setSpraying?.(false);
      walk.setSoaping?.(false);
    });

    const renderer = await page.evaluate(() => new Promise((resolve) => {
      const s3 = window.__fw.scene3d;
      const output = s3.renderer;
      output.info.autoReset = false;
      output.info.reset();
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const materials = new Set();
        const textures = new Set();
        let nodes = 0;
        let visibleMeshes = 0;
        let sceneTriangles = 0;
        s3.scene.traverse((object) => {
          nodes += 1;
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
              if (material[key]) textures.add(material[key].uuid);
            }
          }
        });
        const result = {
          drawCalls: output.info.render.calls,
          renderedTriangles: output.info.render.triangles,
          sceneTriangles: Math.round(sceneTriangles),
          sceneNodes: nodes,
          visibleMeshes,
          materialCount: materials.size,
          textureCount: textures.size,
          textureMemoryBytes: null,
          textureMemoryReason: 'Three.js renderer exposes texture count but not allocated byte size.',
          geometriesInMemory: output.info.memory.geometries,
          texturesInMemory: output.info.memory.textures,
        };
        output.info.autoReset = true;
        resolve(result);
      }));
    }));

    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Performance.enable');
    const metrics = await cdp.send('Performance.getMetrics');
    await cdp.detach();
    const browser = Object.fromEntries(metrics.metrics.map((metric) => [metric.name, metric.value]));
    const frameTimes = sample.frames.filter((value) => value > 0);
    const slowest = [...frameTimes].sort((a, b) => b - a);
    const onePercentCount = Math.max(1, Math.ceil(slowest.length * 0.01));
    const onePercentFrame = slowest.slice(0, onePercentCount).reduce((sum, value) => sum + value, 0) / onePercentCount;
    const duration = frameTimes.reduce((sum, value) => sum + value, 0);
    return {
      name,
      tool,
      usingTool: useTool,
      durationMs: sample.durationMs,
      frameCount: frameTimes.length,
      averageFps: frameTimes.length * 1000 / duration,
      onePercentLowFps: 1000 / onePercentFrame,
      worstFrameMs: slowest[0] || null,
      uiMutationCount: sample.uiMutations,
      uiMutationsPerSecond: sample.uiMutations / (sample.durationMs / 1000),
      renderer,
      browser: {
        jsHeapUsedBytes: browser.JSHeapUsedSize ?? null,
        jsHeapTotalBytes: browser.JSHeapTotalSize ?? null,
        eventListeners: browser.JSEventListeners ?? null,
        nodes: browser.Nodes ?? null,
        documents: browser.Documents ?? null,
      },
    };
  }

  const performanceScenarios = {
    inheritedIdleExterior: baseline.performance,
    vacuumActive: await measureScenario('vacuum-active-dirty-shop-floor', vacuumCamera, 'vacuum', true),
    pressureWasherActive: await measureScenario('pressure-washer-active-south-siding', washerCamera, 'washer', true),
  };

  await page.evaluate(() => {
    const walk = window.__fw.scene3d.walk;
    walk.setSpraying?.(false);
    walk.setSoaping?.(false);
    walk.setTool?.(null);
  });

  const diagnostics = [...(baseline.diagnostics || []), ...extraDiagnostics];
  const blockingDiagnostics = diagnostics.filter((entry) => ![
    'console:warning',
    'requestaborted',
  ].includes(entry.kind));
  const report = {
    ...baseline,
    ok: blockingDiagnostics.length === 0,
    capturedAt: new Date().toISOString(),
    launch: 'node tools/qa/run-playwright.cjs tools/qa/assets-51-100-baseline.js --bootstrap',
    inheritedBaselineScript: {
      path: 'tools/qa/assets-01-50-baseline.js',
      sha256: inheritedSha256,
    },
    methodology: {
      ...baseline.methodology,
      extraFixedCameras: 'Thirteen architecture/furniture cameras plus current vacuum and pressure-washer viewmodel cameras.',
      stressScenarios: 'Five-second fixed-route samples with the current vacuum and pressure washer actively running after 0.8-second warm-up.',
      uiUpdateFrequency: 'MutationObserver record count under the HUD/UI root during each five-second stress sample.',
    },
    cameras: [...(baseline.cameras || []), ...cameras, vacuumCamera, washerCamera],
    captures: [...(baseline.captures || []), ...extraCaptures],
    performanceScenarios,
    diagnostics,
  };
  fs.writeFileSync(path.join(out, 'baseline-result.json'), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}
