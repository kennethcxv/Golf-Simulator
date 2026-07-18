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
  const outDir = process.env.OUT_DIR || 'qa/course_master_final/claude_completion/lifecycle';
  const CYCLES = Number(process.env.CYCLES || 12);

  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

  await page.goto('http://localhost:8457/');
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

  async function openEditor() {
    await page.keyboard.press('j');
    await page.waitForFunction(() => window.__fw.editorUi().isActive(), null, { timeout: 30000 });
    await page.locator('.ced-root').waitFor({ state: 'visible' });
  }
  async function closeEditor() {
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !window.__fw.editorUi().isActive(), null, { timeout: 30000 }).catch(async () => {
      const exit = page.getByRole('button', { name: 'Exit', exact: true });
      if (await exit.count()) await exit.click();
      await page.waitForFunction(() => !window.__fw.editorUi().isActive(), null, { timeout: 30000 });
    });
  }

  await openEditor();
  await page.waitForTimeout(1500);
  const checkpoints = [{ label: 'baseline', ...(await sample()) }];

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
  checkpoints.push({ label: `after ${playtested} playtest round trips`, ...(await sample()) });

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
  await page.evaluate(() => window.__fw.save?.());
  await page.waitForTimeout(900);
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
  };
  const leaks = Object.entries(growth)
    .filter(([k, v]) => (k === 'domNodes' ? v > 400 : v > Math.max(40, base[k] * 0.25)))
    .map(([k, v]) => `${k} grew by ${v} across ${CYCLES} identical cycles`);
  // Scene nodes deserve a slope test rather than a percentage of a large base:
  // a steady handful per playtest round trip is invisible to a 25% threshold
  // and still unbounded over a long session.
  if (playtestNodeSlope !== null && playtestNodeSlope > 4) {
    leaks.push(`scene nodes grow ${playtestNodeSlope}/cycle across the back half of the playtest loop`);
  }

  return {
    ok: leaks.length === 0 && saveDrift.length === 0 && errors.length === 0,
    suite: 'course-lifecycle-stress',
    cycles: CYCLES,
    playtestRoundTrips: playtested,
    playtestNodeSlope,
    playtestSamples,
    checkpoints,
    growth,
    leaks,
    saveReload: { before, after, drift: saveDrift },
    consoleErrors: errors.slice(0, 20),
  };
}
