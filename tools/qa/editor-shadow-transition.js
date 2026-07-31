async (page) => {
  const outPath = process.env.QA_RESULT_PATH
    || 'qa/steam-performance-master-pass/editor-shadow-transition/result.json';
  const outDir = outPath.replace(/[\\/][^\\/]+$/, '');

  const diagnostics = { consoleErrors: [], warnings: [], pageErrors: [], requestFailures: [] };
  page.on('console', (message) => {
    if (message.type() === 'error') diagnostics.consoleErrors.push(message.text());
    if (message.type() === 'warning') diagnostics.warnings.push(message.text());
  });
  page.on('pageerror', (error) => diagnostics.pageErrors.push(error.message));
  page.on('requestfailed', (request) => diagnostics.requestFailures.push({
    url: request.url(),
    error: request.failure()?.errorText || 'unknown',
  }));

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('http://localhost:8457/', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.getByText('Continue', { exact: true }).waitFor({ timeout: 20000 });
  await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.screen === 'game' && window.__fw?.scene3d?.walk?.isActive(), null,
    { timeout: 90000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || getComputedStyle(veil).opacity === '0';
  }, null, { timeout: 90000 });
  await page.waitForTimeout(1200);

  await page.evaluate(() => {
    const app = window.__fw;
    app.speedIdx = 0;
    app.state.weather.locked = true;
    app.state.weather.today = { tempHiF: 74, tempLoF: 55, rainIn: 0, humidity: 0.4, windMph: 6 };
    app.scene3d.clubhouse().setOrganicWalkins(false);
    app.scene3d.clubhouse().clearWalkins();
  });

  const sceneSnapshot = () => page.evaluate(() => {
    const scene3d = window.__fw.scene3d;
    const sun = scene3d.post.sun;
    let nodes = 0;
    scene3d.scene.traverse(() => { nodes += 1; });
    return {
      mode: window.__fw.courseMode,
      mapUuid: sun.shadow.map?.texture?.uuid || sun.shadow.map?.uuid || null,
      mapSize: [sun.shadow.mapSize.x, sun.shadow.mapSize.y],
      cameraBounds: {
        left: sun.shadow.camera.left,
        right: sun.shadow.camera.right,
        top: sun.shadow.camera.top,
        bottom: sun.shadow.camera.bottom,
      },
      target: sun.target.position.toArray(),
      rigTarget: scene3d.rig.target.toArray(),
      programs: scene3d.renderer.info.programs?.length ?? null,
      geometries: scene3d.renderer.info.memory.geometries,
      textures: scene3d.renderer.info.memory.textures,
      nodes,
      listeners: performance.getEntriesByType ? null : null,
    };
  });

  const startCollector = () => page.evaluate(() => {
    const renderer = window.__fw.scene3d.renderer;
    const priorAutoReset = renderer.info.autoReset;
    renderer.info.autoReset = false;
    renderer.info.reset();
    const record = { running: true, last: null, deltas: [], renderer, priorAutoReset };
    window.__editorShadowCollector = record;
    const tick = (time) => {
      if (!record.running) return;
      if (record.last != null) record.deltas.push(time - record.last);
      record.last = time;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const stopCollector = () => page.evaluate(() => {
    const record = window.__editorShadowCollector;
    record.running = false;
    const ordered = record.deltas.filter((value) => value > 0).sort((a, b) => a - b);
    const mean = (values) => values.length
      ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
    const worstCount = Math.max(1, Math.ceil(ordered.length * 0.01));
    const result = {
      frames: ordered.length,
      avgFps: +(1000 / mean(ordered)).toFixed(2),
      low1Fps: +(1000 / mean(ordered.slice(-worstCount))).toFixed(2),
      p95Ms: +(ordered[Math.floor(ordered.length * 0.95)] || 0).toFixed(3),
      p99Ms: +(ordered[Math.floor(ordered.length * 0.99)] || 0).toFixed(3),
      worstMs: +(ordered.at(-1) || 0).toFixed(3),
      over33ms: ordered.filter((value) => value > 33.333).length,
      totalCalls: record.renderer.info.render.calls,
      totalTriangles: record.renderer.info.render.triangles,
    };
    record.renderer.info.reset();
    record.renderer.info.autoReset = record.priorAutoReset;
    delete window.__editorShadowCollector;
    return result;
  });

  const baseline = await sceneSnapshot();
  const cycles = [];
  for (let cycle = 1; cycle <= 3; cycle += 1) {
    await startCollector();
    await page.keyboard.press('j');
    await page.waitForFunction(() => window.__fw.editorUi().isActive(), null, { timeout: 12000 });
    await page.waitForTimeout(1800);
    const performance = await stopCollector();
    const editor = await sceneSnapshot();
    if (cycle === 1) {
      await page.screenshot({ path: `${outDir}/editor-focused-shadow.png` });
    }
    await page.getByRole('button', { name: 'Exit', exact: true }).click();
    await page.waitForFunction(() => !window.__fw.editorUi().isActive()
      && window.__fw.courseMode === 'walk', null, { timeout: 30000 });
    await page.waitForTimeout(500);
    const restored = await sceneSnapshot();
    cycles.push({ cycle, performance, editor, restored });
  }

  const knownWarnings = diagnostics.warnings.filter((warning) => /dyn_index_vec4_float4_int/.test(warning));
  const unexpectedWarnings = diagnostics.warnings.filter((warning) => !/dyn_index_vec4_float4_int/.test(warning));
  const result = {
    ok: diagnostics.consoleErrors.length === 0
      && diagnostics.pageErrors.length === 0
      && diagnostics.requestFailures.length === 0
      && unexpectedWarnings.length === 0
      && cycles.every((cycle) => cycle.editor.mapSize[0] === 2048
        && cycle.editor.mapSize[1] === 2048
        && cycle.editor.mapUuid === baseline.mapUuid
        && cycle.restored.mode === 'walk'
        && cycle.restored.mapSize[0] === 2048
        && cycle.performance.worstMs < 250),
    baseline,
    cycles,
    diagnostics: { ...diagnostics, knownWarnings, unexpectedWarnings },
  };
  return result;
}
