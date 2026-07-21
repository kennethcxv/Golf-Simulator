// Focused flora LOD performance and visual probe.
//
// Run with the normal server active:
//   $env:FLORA_QA_PHASE='baseline'
//   $env:QA_RESULT_PATH='qa/flora_lod/baseline/results.json'
//   node tools/qa/run-playwright.cjs tools/qa/course-flora-lod-qa.js --bootstrap
async (page) => {
  const phase = process.env.FLORA_QA_PHASE || 'baseline';
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const outDir = process.env.FLORA_QA_OUT_DIR || `qa/flora_lod/${phase}`;
  const diagnostics = {
    console: [], pageErrors: [], failedRequests: [], ignoredPreProbeRequestFailures: [],
  };
  let qaDocumentCommitted = false;
  let qaDocumentRequests = new WeakSet();
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      diagnostics.console.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => diagnostics.pageErrors.push(error.message));
  page.on('request', (request) => {
    if (qaDocumentCommitted) qaDocumentRequests.add(request);
  });
  page.on('requestfailed', (request) => {
    const record = { url: request.url(), error: request.failure()?.errorText || 'unknown' };
    if (qaDocumentRequests.has(request)) diagnostics.failedRequests.push(record);
    else diagnostics.ignoredPreProbeRequestFailures.push(record);
  });
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame() && frame.url().startsWith(baseUrl)) {
      qaDocumentCommitted = true;
    }
  });

  const settle = async (frames = 10) => page.evaluate((count) => new Promise((resolve) => {
    let left = count;
    const tick = () => {
      left -= 1;
      if (left <= 0) resolve();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }), frames);

  const sample = async (durationMs) => page.evaluate((duration) => new Promise((resolve) => {
    const renderer = window.__fw.scene3d.renderer;
    const info = renderer.info;
    const priorAutoReset = info.autoReset;
    const deltas = [];
    const ui = { records: 0 };
    const root = document.querySelector('.ced-root');
    const observer = new MutationObserver((records) => { ui.records += records.length; });
    if (root) observer.observe(root, {
      subtree: true, attributes: true, childList: true, characterData: true,
    });
    info.autoReset = false;
    info.reset();
    let last = performance.now();
    const started = last;
    const tick = (now) => {
      const delta = now - last;
      last = now;
      if (delta > 0) deltas.push(delta);
      if (now - started < duration) {
        requestAnimationFrame(tick);
        return;
      }
      observer.disconnect();
      const totals = { calls: info.render.calls, triangles: info.render.triangles };
      info.reset();
      info.autoReset = priorAutoReset;
      const ordered = deltas.slice().sort((a, b) => a - b);
      const slowCount = Math.max(1, Math.ceil(ordered.length * 0.01));
      const slowest = ordered.slice(-slowCount);
      const avgMs = deltas.reduce((sum, value) => sum + value, 0) / Math.max(1, deltas.length);
      const lowMs = slowest.reduce((sum, value) => sum + value, 0) / slowest.length;
      resolve({
        frames: deltas.length,
        durationMs: +(last - started).toFixed(2),
        averageFps: +(1000 / avgMs).toFixed(2),
        onePercentLowFps: +(1000 / lowMs).toFixed(2),
        worstFrameMs: +(ordered.at(-1) || 0).toFixed(3),
        drawCallsPerFrame: +(totals.calls / Math.max(1, deltas.length)).toFixed(2),
        trianglesPerFrame: Math.round(totals.triangles / Math.max(1, deltas.length)),
        uiMutationRecords: ui.records,
        rawFrameDeltasMs: deltas.map((value) => +value.toFixed(3)),
      });
    };
    requestAnimationFrame(tick);
  }), durationMs);

  const summarize = (samples) => {
    const deltas = samples.flatMap((entry) => entry.rawFrameDeltasMs);
    const ordered = deltas.slice().sort((a, b) => a - b);
    const slowCount = Math.max(1, Math.ceil(ordered.length * 0.01));
    const slowest = ordered.slice(-slowCount);
    const avgMs = deltas.reduce((sum, value) => sum + value, 0) / Math.max(1, deltas.length);
    const lowMs = slowest.reduce((sum, value) => sum + value, 0) / slowest.length;
    return {
      sampleCount: samples.length,
      frames: deltas.length,
      averageFps: +(1000 / avgMs).toFixed(2),
      onePercentLowFps: +(1000 / lowMs).toFixed(2),
      worstFrameMs: +(ordered.at(-1) || 0).toFixed(3),
      drawCallsPerFrame: +(samples.reduce((sum, value) => sum + value.drawCallsPerFrame, 0)
        / samples.length).toFixed(2),
      trianglesPerFrame: Math.round(samples.reduce((sum, value) => sum + value.trianglesPerFrame, 0)
        / samples.length),
      uiMutationRecords: samples.reduce((sum, value) => sum + value.uiMutationRecords, 0),
      samples,
    };
  };

  const sceneCensus = async () => page.evaluate(() => {
    const s = window.__fw.scene3d;
    const materials = new Set();
    const textures = new Set();
    let nodes = 0;
    let meshes = 0;
    let instancedMeshes = 0;
    let instances = 0;
    s.scene.traverse((object) => {
      nodes += 1;
      if (!object.isMesh) return;
      meshes += 1;
      if (object.isInstancedMesh) {
        instancedMeshes += 1;
        instances += object.count || 0;
      }
      for (const material of (Array.isArray(object.material) ? object.material : [object.material])) {
        if (!material) continue;
        materials.add(material);
        for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
      }
    });
    return {
      nodes,
      meshes,
      instancedMeshes,
      instances,
      materialCount: materials.size,
      textureCountScene: textures.size,
      textureCountRenderer: s.renderer.info.memory.textures,
      geometryCount: s.renderer.info.memory.geometries,
      programCount: s.renderer.info.programs?.length ?? null,
      jsHeapUsedBytes: performance.memory?.usedJSHeapSize ?? null,
      jsHeapTotalBytes: performance.memory?.totalJSHeapSize ?? null,
      flora: s.floraDiagnostics?.() || null,
    };
  });

  await page.setViewportSize({ width: 1600, height: 900 });
  qaDocumentCommitted = false;
  qaDocumentRequests = new WeakSet();
  await page.goto(baseUrl);
  await page.waitForFunction(() => document.readyState === 'complete');
  const continueButton = page.getByRole('button', { name: 'Continue', exact: true });
  await continueButton.waitFor({ state: 'visible' });
  await page.waitForFunction(() => {
    const button = [...document.querySelectorAll('button')]
      .find((item) => item.textContent.trim() === 'Continue');
    return button && !button.disabled;
  });
  await continueButton.click();
  await page.waitForFunction(() => (
    window.__fw?.state?.course?.vec && window.__fw?.scene3d && window.__fw?.editorUi?.()
  ), null, { timeout: 90000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || getComputedStyle(veil).opacity === '0';
  }, null, { timeout: 90000 });
  await page.evaluate(() => {
    const weather = window.__fw.state.weather;
    weather.locked = true;
    weather.today = { tempHiF: 74, tempLoF: 55, rainIn: 0, humidity: 0.4, windMph: 6 };
  });

  await page.keyboard.press('j');
  await page.waitForFunction(() => window.__fw.editorUi().isActive());
  await page.locator('.ced-root').waitFor({ state: 'visible' });
  await settle(16);

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  await cdp.send('HeapProfiler.enable');
  await cdp.send('HeapProfiler.collectGarbage');
  const beforeDom = await cdp.send('Memory.getDOMCounters');
  const beforeMetrics = await cdp.send('Performance.getMetrics');

  await page.keyboard.press('Home');
  await page.waitForTimeout(1300);
  await settle(12);
  const overviewCamera = await page.evaluate(() => {
    const { camera, rig } = window.__fw.scene3d;
    return {
      position: camera.position.toArray().map((value) => +value.toFixed(3)),
      target: rig.target.toArray().map((value) => +value.toFixed(3)),
      yaw: +rig.yaw.toFixed(6), pitch: +rig.pitch.toFixed(6), dist: +rig.dist.toFixed(3),
    };
  });
  const overviewScreenshot = `${outDir}/course_overview.png`;
  await page.screenshot({ path: overviewScreenshot });
  const overviewSamples = [];
  for (let index = 0; index < 3; index += 1) {
    await settle(8);
    overviewSamples.push(await sample(1800));
  }
  const overview = summarize(overviewSamples);
  const census = await sceneCensus();

  // Player-facing close view through normal controls; validates that near hero
  // silhouettes survive the optimization without direct camera manipulation.
  await page.locator('.ced-camera').selectOption('tee');
  await settle(12);
  const teeScreenshot = `${outDir}/hole_01_tee_view.png`;
  await page.screenshot({ path: teeScreenshot });
  const teeFlora = await page.evaluate(() => window.__fw.scene3d.floraDiagnostics?.() || null);
  await page.getByRole('button', { name: 'Playtest', exact: true }).click();
  await page.waitForFunction(() => window.__fw.editorUi().isPlaytesting());
  await settle(12);
  const playerScreenshot = `${outDir}/hole_01_player.png`;
  await page.screenshot({ path: playerScreenshot });
  const playerFlora = await page.evaluate(() => window.__fw.scene3d.floraDiagnostics?.() || null);
  await page.getByRole('button', { name: /Editor/i }).click();
  await page.waitForFunction(() => !window.__fw.editorUi().isPlaytesting());

  await cdp.send('HeapProfiler.collectGarbage');
  const afterDom = await cdp.send('Memory.getDOMCounters');
  const afterMetrics = await cdp.send('Performance.getMetrics');
  const metrics = (entries) => Object.fromEntries(entries.metrics.map((entry) => [entry.name, entry.value]));
  const before = metrics(beforeMetrics);
  const after = metrics(afterMetrics);

  return {
    ok: diagnostics.pageErrors.length === 0 && diagnostics.failedRequests.length === 0,
    phase,
    launch: 'node tools/qa/run-playwright.cjs tools/qa/course-flora-lod-qa.js --bootstrap',
    fixture: 'relaxed empire seed 424242; first property; dry midday weather',
    viewport: { width: 1600, height: 900, deviceScaleFactor: 1 },
    overviewCamera,
    screenshots: { overview: overviewScreenshot, tee: teeScreenshot, player: playerScreenshot },
    performance: { overview, census, floraViews: { tee: teeFlora, player: playerFlora } },
    browser: {
      heapUsedBeforeBytes: before.JSHeapUsedSize ?? null,
      heapUsedAfterBytes: after.JSHeapUsedSize ?? null,
      heapDeltaBytes: before.JSHeapUsedSize == null ? null : after.JSHeapUsedSize - before.JSHeapUsedSize,
      eventListenersBefore: beforeDom.jsEventListeners,
      eventListenersAfter: afterDom.jsEventListeners,
      eventListenerDelta: afterDom.jsEventListeners - beforeDom.jsEventListeners,
      domNodesBefore: beforeDom.nodes,
      domNodesAfter: afterDom.nodes,
    },
    diagnostics,
  };
}
