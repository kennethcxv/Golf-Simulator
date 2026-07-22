// Long-session lifecycle stress for the Course Editor.
//
// Drives the editor through repeated hole switches, camera changes, playtest
// entry/exit and a save/reload, sampling GPU and DOM resource counts at each
// checkpoint. The question is not "is the number big" but "does it stabilise" —
// a counter that climbs linearly across identical cycles is a leak.
//
//   node tools/qa/run-playwright.cjs tools/qa/course-lifecycle-stress.js --bootstrap
//
// CYCLES overrides the repeat count (default 12).

async function courseLifecycleStress(page) {
  const fs = process.getBuiltinModule('node:fs');
  const outDir = process.env.OUT_DIR || 'qa/course_master_final/claude_completion/lifecycle';
  const CYCLES = Number(process.env.CYCLES || 12);
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  fs.mkdirSync(outDir, { recursive: true });

  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

  const cdp = await page.context().newCDPSession(page);
  await page.goto(baseUrl);
  await page.waitForFunction(() => document.readyState === 'complete');
  const cont = page.getByRole('button', { name: 'Continue', exact: true });
  await cont.waitFor({ state: 'visible', timeout: 60000 });
  await page.waitForFunction(() => {
    const b = [...document.querySelectorAll('button')].find((i) => i.textContent.trim() === 'Continue');
    return b && !b.disabled;
  });
  await cont.click();
  await page.waitForFunction(
    () => window.__fw?.state?.course?.vec && window.__fw?.scene3d && window.__fw?.editorUi?.(),
    null,
    { timeout: 90000 },
  );
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || getComputedStyle(veil).opacity === '0';
  }, null, { timeout: 90000 });

  const sample = () => page.evaluate(() => {
    const r = window.__fw.scene3d.renderer;
    let nodes = 0;
    window.__fw.scene3d.scene.traverse(() => { nodes += 1; });
    return {
      geometries: r.info.memory.geometries,
      textures: r.info.memory.textures,
      programs: r.info.programs.length,
      sceneNodes: nodes,
      domNodes: document.getElementsByTagName('*').length,
      heapMB: performance.memory
        ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1)
        : null,
    };
  });

  const waitForRendererStable = async ({ minimumMs = 6500, timeoutMs = 20000 } = {}) => {
    const started = Date.now();
    const samples = [];
    let previous = null;
    let unchanged = 0;
    while (Date.now() - started < timeoutMs) {
      await page.waitForTimeout(500);
      const current = await page.evaluate(() => {
        const info = window.__fw.scene3d.renderer.info;
        return { geometries: info.memory.geometries, textures: info.memory.textures };
      });
      samples.push(current);
      unchanged = previous
        && current.geometries === previous.geometries
        && current.textures === previous.textures ? unchanged + 1 : 0;
      previous = current;
      if (Date.now() - started >= minimumMs && unchanged >= 4) {
        return { stable: true, durationMs: Date.now() - started, samples };
      }
    }
    return { stable: false, durationMs: Date.now() - started, samples };
  };

  const listenerCensus = async () => {
    const targets = {
      window: 'window',
      document: 'document',
      html: 'document.documentElement',
      canvas: 'document.querySelector("canvas")',
      editor: 'document.querySelector(".ced-root")',
    };
    const byTarget = {};
    let sampledTotal = 0;
    for (const [label, expression] of Object.entries(targets)) {
      const evaluated = await cdp.send('Runtime.evaluate', {
        expression,
        returnByValue: false,
        objectGroup: 'course-lifecycle-listeners',
      });
      const objectId = evaluated.result?.objectId;
      if (!objectId) {
        byTarget[label] = 0;
        continue;
      }
      const response = await cdp.send('DOMDebugger.getEventListeners', { objectId });
      byTarget[label] = response.listeners?.length || 0;
      sampledTotal += byTarget[label];
    }
    const fullDocument = await cdp.send('Memory.getDOMCounters');
    return {
      fullDocument: {
        documents: fullDocument.documents,
        domNodes: fullDocument.nodes,
        jsEventListeners: fullDocument.jsEventListeners,
      },
      sampledTargets: { total: sampledTotal, byTarget },
    };
  };

  async function openEditor() {
    await page.keyboard.press('j');
    await page.waitForFunction(() => window.__fw.editorUi().isActive(), null, { timeout: 30000 });
    await page.locator('.ced-root').waitFor({ state: 'visible' });
  }
  async function closeEditor() {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(120);
    const leaveModal = page.locator('.ced-modal');
    if (await leaveModal.isVisible().catch(() => false)) {
      const buildAndLeave = leaveModal.getByRole('button', { name: 'Build & leave', exact: true });
      if (await buildAndLeave.count()) await buildAndLeave.click();
      else await leaveModal.getByRole('button', { name: 'Discard & leave', exact: true }).click();
    }
    await page.waitForFunction(() => !window.__fw.editorUi().isActive(), null, { timeout: 30000 });
  }

  await openEditor();
  await page.waitForTimeout(1500);
  const warmup = await waitForRendererStable();
  await cdp.send('HeapProfiler.collectGarbage');
  const checkpoints = [{ label: 'baseline', ...(await sample()) }];
  const listenersBefore = await listenerCensus();

  // ---- cycle: production terrain edit + visible Undo/Redo ----------------
  // This is deliberately pointer-driven. It exercises the same throttled
  // stroke, scoped refresh and toolbar actions the player uses, while one
  // continuous rAF probe catches any long frame across the entire soak.
  await page.getByRole('button', { name: 'Terrain', exact: true }).click();
  await page.waitForTimeout(300);
  const canvas = page.locator('canvas').first();
  const canvasBox = await canvas.boundingBox();
  const editCycles = [];
  await page.evaluate(() => {
    const probe = { running: true, deltas: [], last: performance.now() };
    window.__courseLifecycleFrameProbe = probe;
    const tick = (now) => {
      if (!probe.running) return;
      const delta = now - probe.last;
      probe.last = now;
      if (delta > 0) probe.deltas.push(delta);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const waitFrames = (count = 3) => page.evaluate((requested) => new Promise((resolve) => {
    let left = requested;
    const tick = () => {
      left -= 1;
      if (left <= 0) resolve();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }), count);
  for (let c = 0; c < CYCLES; c++) {
    const x = canvasBox.x + canvasBox.width * (0.54 + (c % 4) * 0.025);
    const y = canvasBox.y + canvasBox.height * (0.51 + (c % 3) * 0.025);
    const editStarted = Date.now();
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 18, y + 7, { steps: 4 });
    await page.mouse.up();
    await waitFrames(3);
    const editMs = Date.now() - editStarted;

    const undoStarted = Date.now();
    await page.locator('.ced-top-btn[title^="Undo"]').click();
    await waitFrames(3);
    const undoMs = Date.now() - undoStarted;

    const redoStarted = Date.now();
    await page.locator('.ced-top-btn[title^="Redo"]').click();
    await waitFrames(3);
    const redoMs = Date.now() - redoStarted;
    const resources = await sample();
    editCycles.push({ cycle: c + 1, editMs, undoMs, redoMs, resources });
  }
  const editFrameSummary = await page.evaluate(() => {
    const probe = window.__courseLifecycleFrameProbe;
    probe.running = false;
    const ordered = probe.deltas.slice().sort((a, b) => a - b);
    const mean = probe.deltas.reduce((sum, value) => sum + value, 0) / Math.max(1, probe.deltas.length);
    return {
      frames: probe.deltas.length,
      averageFps: +(1000 / Math.max(0.001, mean)).toFixed(2),
      medianFrameMs: +(ordered[Math.floor(ordered.length / 2)] || 0).toFixed(2),
      worstFrameMs: +(ordered[ordered.length - 1] || 0).toFixed(2),
      framesOver33ms: probe.deltas.filter((value) => value > 33).length,
      framesOver100ms: probe.deltas.filter((value) => value > 100).length,
    };
  });
  checkpoints.push({ label: `after ${CYCLES} edit+undo+redo cycles`, ...(await sample()) });
  await page.screenshot({ path: `${outDir}/after_edit_cycles.png` });

  // ---- cycle: hole switches + camera presets ------------------------------
  const holeCount = await page.evaluate(() => window.__fw.state.course.holes.length);
  const VIEWS = ['frame-hole', 'tee', 'green', 'course-overview'];
  for (let c = 0; c < CYCLES; c++) {
    const index = c % holeCount;
    await page.locator('.ced-holechip').click();
    await page.locator('.ced-holecard').nth(index).click();
    const frame = page.getByRole('button', { name: 'Frame it', exact: true });
    if (await frame.count()) await frame.click();
    await page.waitForTimeout(250);
    await page.locator('.ced-camera').selectOption(VIEWS[c % VIEWS.length]);
    await page.waitForTimeout(250);
  }
  checkpoints.push({ label: `after ${CYCLES} hole+camera cycles`, ...(await sample()) });

  // ---- cycle: editor close/open -------------------------------------------
  for (let c = 0; c < CYCLES; c++) {
    await closeEditor();
    await page.waitForTimeout(150);
    await openEditor();
    await page.waitForTimeout(150);
  }
  checkpoints.push({ label: `after ${CYCLES} editor open/close`, ...(await sample()) });

  // ---- cycle: playtest in/out ---------------------------------------------
  let playtested = 0;
  const playtestSamples = [];
  for (let c = 0; c < CYCLES; c++) {
    const play = page.getByRole('button', { name: 'Playtest', exact: true });
    if (!(await play.count())) break;
    await play.click();
    try {
      await page.waitForFunction(() => window.__fw.editorUi().isPlaytesting(), null, { timeout: 20000 });
    } catch (_) { break; }
    await page.waitForTimeout(400);
    const back = page.getByRole('button', { name: /Editor$/ });
    if (await back.count()) await back.click();
    else await page.keyboard.press('Escape');
    await page.waitForFunction(() => !window.__fw.editorUi().isPlaytesting(), null, { timeout: 20000 });
    await page.waitForTimeout(300);
    playtested += 1;
    // Per-cycle, because the shape matters: a first-cycle jump that then flattens
    // is lazy warm-up, a constant per-cycle delta is a leak.
    const s = await sample();
    playtestSamples.push({ cycle: playtested, sceneNodes: s.sceneNodes, domNodes: s.domNodes, geometries: s.geometries });
  }
  await cdp.send('HeapProfiler.collectGarbage');
  checkpoints.push({ label: `after ${playtested} playtest round trips`, ...(await sample()) });
  const listenersAfter = await listenerCensus();
  await cdp.send('Runtime.releaseObjectGroup', { objectGroup: 'course-lifecycle-listeners' });

  // Slope over the back half only, so first-run warm-up cannot mask or fake it.
  let playtestNodeSlope = null;
  if (playtestSamples.length >= 4) {
    const half = playtestSamples.slice(Math.floor(playtestSamples.length / 2));
    const first = half[0];
    const last = half[half.length - 1];
    playtestNodeSlope = +((last.sceneNodes - first.sceneNodes) / Math.max(1, half.length - 1)).toFixed(1);
  }

  await page.screenshot({ path: `${outDir}/after_cycles.png` });

  // ---- save + reload: the course must come back identical ------------------
  const before = await page.evaluate(() => {
    const c = window.__fw.state.course;
    let zoneSum = 0;
    for (let i = 0; i < c.zones.length; i++) zoneSum += c.zones[i] * (i % 7 + 1);
    return {
      holes: c.holes.length,
      zoneSum,
      objects: (c.objects || []).length,
      paths: (c.paths || []).length,
      waters: c.vec ? c.vec.waters.length : 0,
      bunkers: c.vec ? c.vec.holes.reduce((s, h) => s + (h.bunkers || []).length, 0) : 0,
    };
  });
  const saveStarted = Date.now();
  await page.locator('.ced-top-btn[title="Save the course"]').click();
  const saveModal = page.locator('.ced-modal');
  await saveModal.waitFor({ state: 'visible', timeout: 10000 });
  const saveAction = saveModal.getByRole('button', { name: /^(Build & save|Save)$/ });
  await saveAction.click();
  await saveModal.waitFor({ state: 'hidden', timeout: 30000 });
  await page.waitForTimeout(900);
  const saveDurationMs = Date.now() - saveStarted;
  await page.reload();
  await page.waitForFunction(() => document.readyState === 'complete');
  const cont2 = page.getByRole('button', { name: 'Continue', exact: true });
  await cont2.waitFor({ state: 'visible', timeout: 60000 });
  await cont2.click();
  await page.waitForFunction(
    () => window.__fw?.state?.course && window.__fw?.scene3d,
    null,
    { timeout: 90000 },
  );
  await page.waitForTimeout(2500);
  const after = await page.evaluate(() => {
    const c = window.__fw.state.course;
    let zoneSum = 0;
    for (let i = 0; i < c.zones.length; i++) zoneSum += c.zones[i] * (i % 7 + 1);
    return {
      holes: c.holes.length,
      zoneSum,
      objects: (c.objects || []).length,
      paths: (c.paths || []).length,
      waters: c.vec ? c.vec.waters.length : 0,
      bunkers: c.vec ? c.vec.holes.reduce((s, h) => s + (h.bunkers || []).length, 0) : 0,
    };
  });
  await page.screenshot({ path: `${outDir}/after_reload.png` });

  const saveDrift = Object.keys(before).filter((k) => before[k] !== after[k]);

  // A counter that grows across identical cycles is the signal. Allow modest
  // slack for lazily-loaded assets warming on first use.
  const base = checkpoints[0];
  const last = checkpoints[checkpoints.length - 1];
  const growth = {
    geometries: last.geometries - base.geometries,
    textures: last.textures - base.textures,
    programs: last.programs - base.programs,
    sceneNodes: last.sceneNodes - base.sceneNodes,
    domNodes: last.domNodes - base.domNodes,
    fullDocumentListeners: listenersAfter.fullDocument.jsEventListeners
      - listenersBefore.fullDocument.jsEventListeners,
    sampledTargetListeners: listenersAfter.sampledTargets.total
      - listenersBefore.sampledTargets.total,
    heapMB: last.heapMB !== null && base.heapMB !== null ? +(last.heapMB - base.heapMB).toFixed(1) : null,
  };
  const leaks = Object.entries(growth)
    .filter(([k, v]) => {
      if (v === null) return false;
      if (k === 'domNodes') return v > 400;
      if (k === 'fullDocumentListeners') return v > 24;
      if (k === 'sampledTargetListeners') return v > 4;
      if (k === 'heapMB') return v > 64;
      return v > Math.max(40, base[k] * 0.25);
    })
    .map(([k, v]) => `${k} grew by ${v} across ${CYCLES} identical cycles`);
  // Scene nodes deserve a slope test rather than a percentage of a large base:
  // a steady handful per playtest round trip is invisible to a 25% threshold
  // and still unbounded over a long session.
  if (playtestNodeSlope !== null && playtestNodeSlope > 4) {
    leaks.push(`scene nodes grow ${playtestNodeSlope}/cycle across the back half of the playtest loop`);
  }
  if (!warmup.stable) leaks.push('renderer resources did not stabilize before the edit soak');

  return {
    ok: leaks.length === 0 && saveDrift.length === 0 && errors.length === 0
      && editFrameSummary.framesOver100ms === 0,
    suite: 'course-lifecycle-stress',
    cycles: CYCLES,
    playtestRoundTrips: playtested,
    playtestNodeSlope,
    playtestSamples,
    editCycles,
    editFrameSummary,
    warmup,
    checkpoints,
    growth,
    leaks,
    listeners: { before: listenersBefore, after: listenersAfter },
    saveReload: { before, after, drift: saveDrift, action: saveAction ? 'visible Save dialog' : null, saveDurationMs },
    consoleErrors: errors.slice(0, 20),
  };
}
