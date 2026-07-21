async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = process.env.QA_REPO_ROOT || process.cwd();
  const out = process.env.CLEANING_SAVE_QA_OUT_DIR
    ? path.resolve(repo, process.env.CLEANING_SAVE_QA_OUT_DIR)
    : path.join(repo, 'qa', 'property-expansion-world-overhaul', 'cleaning-tools', 'save-reload');
  const base = process.env.QA_BASE_URL || 'http://localhost:8467/';
  fs.mkdirSync(out, { recursive: true });

  const errors = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });

  const waitForGame = async () => {
    await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
    await page.waitForFunction(() => {
      const veil = document.querySelector('.load-veil');
      return !veil || getComputedStyle(veil).display === 'none'
        || parseFloat(getComputedStyle(veil).opacity) < 0.02;
    }, null, { timeout: 90000 });
    await page.waitForTimeout(700);
  };

  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.getByText('Continue', { exact: true }).click();
  await waitForGame();

  const fixture = await page.evaluate(async () => {
    const app = window.__fw;
    const walk = app.scene3d.walk;
    const origin = app.scene3d.clubhouse().interior.position;
    const local = { x: -5.5, z: 3.2 };
    walk.clearKeys?.();
    walk.setTool?.(null);
    walk.state.x = origin.x + local.x;
    walk.state.z = origin.z + local.z;
    walk.state.yaw = 0;
    walk.state.pitch = -0.62;
    const vacuum = app.state.shop.inventory.vac1 || (app.state.shop.inventory.vac1 = {});
    vacuum.back = Math.max(1, Number(vacuum.back) || 0);
    app.state.shop.reno.grime.fill(0.82);
    app.state.shop.reno.debris = [];
    for (let index = 0; index < 8; index += 1) {
      const angle = index / 8 * Math.PI * 2;
      app.state.shop.reno.debris.push({
        x: local.x + Math.cos(angle) * 0.38,
        z: local.z - 0.78 + Math.sin(angle) * 0.38,
        a: 0.32,
      });
    }
    app.scene3d.clubhouse().rebuildReno?.();
    await walk.toolViewmodelsReady?.('vacuum');
    return { local, grimeBefore: [...app.state.shop.reno.grime], debrisBefore: app.state.shop.reno.debris.length };
  });

  await page.locator('#game').click({ position: { x: 800, y: 450 } });
  await page.keyboard.press('f');
  await page.waitForFunction(() => window.__fw.scene3d.walk.getTool?.() === 'vacuum');
  await page.mouse.down({ button: 'left' });
  await page.waitForTimeout(1600);
  await page.screenshot({ path: path.join(out, '01-vacuum-progress-before-save.png') });
  await page.mouse.up({ button: 'left' });
  await page.waitForTimeout(250);

  const worked = await page.evaluate((grimeBefore) => {
    const reno = window.__fw.state.shop.reno;
    const grimeChanged = reno.grime.some((value, index) => value < grimeBefore[index]);
    return {
      selectedTool: window.__fw.scene3d.walk.getTool?.(),
      grimeChanged,
      debrisRemaining: reno.debris.length,
    };
  }, fixture.grimeBefore);

  const before = await page.evaluate(async () => {
    const app = window.__fw;
    const reno = app.state.shop.reno;
    reno.pan = 0.421;
    reno.bag = 0.842;
    reno.windows[1] = 0.234;
    const washSurface = Object.keys(reno.wash || {})[0];
    if (!washSurface) throw new Error('wash state was not initialized');
    reno.wash[washSurface].grime[0] = 0.123;
    const record = {
      grime: [...reno.grime],
      debris: reno.debris.map((entry) => ({ ...entry })),
      pan: reno.pan,
      bag: reno.bag,
      window: reno.windows[1],
      washSurface,
      washCell: reno.wash[washSurface].grime[0],
    };
    await app.autosave();
    return record;
  });

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByText('Continue', { exact: true }).click();
  await waitForGame();
  await page.screenshot({ path: path.join(out, '02-progress-after-reload.png') });

  const after = await page.evaluate((washSurface) => {
    const reno = window.__fw.state.shop.reno;
    return {
      grime: [...reno.grime],
      debris: reno.debris.map((entry) => ({ ...entry })),
      pan: reno.pan,
      bag: reno.bag,
      window: reno.windows[1],
      washCell: reno.wash[washSurface].grime[0],
      wetAllZero: Array.isArray(reno.wet) && reno.wet.every((value) => value === 0),
      solutionAllZero: Array.isArray(reno.solution) && reno.solution.every((value) => value === 0),
    };
  }, before.washSurface);

  const match = {
    normalControlVacuumWorked: worked.selectedTool === 'vacuum'
      && worked.grimeChanged
      && worked.debrisRemaining < fixture.debrisBefore,
    grime: JSON.stringify(after.grime) === JSON.stringify(before.grime),
    debris: JSON.stringify(after.debris) === JSON.stringify(before.debris),
    pan: after.pan === before.pan,
    bag: after.bag === before.bag,
    window: after.window === before.window,
    wash: after.washCell === before.washCell,
    transientWetnessReset: after.wetAllZero && after.solutionAllZero,
  };
  return {
    ok: Object.values(match).every(Boolean) && errors.length === 0,
    fixture: { debrisBefore: fixture.debrisBefore },
    worked,
    before: {
      grimeCells: before.grime.length,
      debrisCount: before.debris.length,
      pan: before.pan,
      bag: before.bag,
      window: before.window,
      washSurface: before.washSurface,
      washCell: before.washCell,
    },
    after: {
      grimeCells: after.grime.length,
      debrisCount: after.debris.length,
      pan: after.pan,
      bag: after.bag,
      window: after.window,
      washCell: after.washCell,
      wetAllZero: after.wetAllZero,
      solutionAllZero: after.solutionAllZero,
    },
    match,
    errors,
  };
}
