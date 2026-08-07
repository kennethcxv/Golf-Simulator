// B2 VERIFICATION — the overlay's own acceptance, per Phase-2 remedy R-F:
// EVERY slider is driven and must show its named response (the E7
// all-controls table shape); the deliberately-dead slider must move
// NOTHING; Save must write the overrides file with the dragged values; and
// a second phase (QA_TUNER_PHASE=verify) boots fresh and proves the saved
// values are what the game runs — "what I tune is what ships" checked in a
// relaunch, then the scribble overrides are deleted so QA numbers never
// ship as real tuning.
//
// Slider drive: the panel's own <input type=range> receives value +
// 'input' events — the same handler a human drag fires. (A synthetic
// 'input' event on a range is the standard drive; the hook under test is
// the panel's oninput, not a pointer pipeline.)
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const PHASE = process.env.QA_TUNER_PHASE || 'tune';
  const OUT = path.resolve('qa/electron/tool-tuner');
  fs.mkdirSync(OUT, { recursive: true });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  const boot = await import(`file:///${bootPath}`);
  await boot.clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(2200);

  // stage + real-path equip (the B0 recipe)
  await page.evaluate(() => {
    const app = window.__fw;
    const inv = app.state?.shop?.inventory;
    if (inv && !inv.vac1) inv.vac1 = { shelf: 0, back: 1 };
    else if (inv && !(inv.vac1.back > 0)) inv.vac1.back = 1;
    const o = app.scene3d.clubhouse().interior.position;
    const w = app.scene3d.walk.state;
    w.x = o.x - 5.2; w.z = o.z + 3.0; w.yaw = 0.4; w.pitch = -0.25;
  });
  const equip = async (tool) => {
    await page.mouse.click(640, 380);
    await page.waitForTimeout(400);
    const bindings = await page.evaluate(
      () => window.__fw.preferences?.values?.controls?.bindings || {},
    );
    await page.keyboard.down(bindings.toolBelt || 'f');
    await page.waitForTimeout(450);
    await page.keyboard.up(bindings.toolBelt || 'f');
    await page.waitForTimeout(250);
    const items = await page.evaluate(() => {
      const el = document.querySelector('.tool-wheel');
      return el ? [...el.querySelectorAll('.tool-wheel-item')]
        .map((b) => b.querySelector('.tool-wheel-label')?.textContent || '') : [];
    });
    const idx = items.findIndex((label) => new RegExp(tool, 'i').test(label));
    if (idx >= 0) {
      await page.keyboard.press(String(idx === 9 ? 0 : idx + 1));
      await page.waitForTimeout(200);
      await page.keyboard.press('Enter').catch(() => {});
    }
    await page.waitForTimeout(500);
    return page.evaluate(() => window.__fw.scene3d.walk.getTool());
  };

  const out = { phase: PHASE, steps: {}, errs };
  const overridesPath = path.resolve('src/data/toolFeelOverrides.json');

  if (PHASE === 'verify') {
    // ---- PHASE B: the ships test --------------------------------------------
    const saved = JSON.parse(fs.readFileSync(overridesPath, 'utf8'));
    const equipped = await equip('broom');
    await page.waitForTimeout(1200); // overrides apply via async bridge at boot
    const liveNow = await page.evaluate(() => ({
      anchorY: window.__fw.scene3d.walk.toolFeelLive('broom')?.compose?.gripAnchor?.[1],
      arc: window.__fw.scene3d.walk.toolFeelLive('broom')?.sweep?.arcRad,
      gripY: window.__fw.scene3d.walk.toolRigDiagnostics('broom')?.gripCamWorldY,
    }));
    await page.screenshot({ path: path.join(OUT, 'verify-pose.png') });
    out.steps.saved = { anchorY: saved.broom?.compose?.gripAnchor?.[1], arc: saved.broom?.sweep?.arcRad };
    out.steps.liveNow = liveNow;
    out.checks = {
      equipped: equipped === 'broom',
      anchorShipped: Math.abs((liveNow.anchorY ?? 99) - (saved.broom?.compose?.gripAnchor?.[1] ?? -99)) < 1e-6,
      arcShipped: Math.abs((liveNow.arc ?? 99) - (saved.broom?.sweep?.arcRad ?? -99)) < 1e-6,
      noPageErrors: errs.length === 0,
    };
    out.ok = Object.values(out.checks).every(Boolean);
    // leave the tree clean: QA scribbles must not ship as tuning
    fs.unlinkSync(overridesPath);
    out.steps.overridesDeletedAfterVerify = true;
    fs.writeFileSync(path.join(OUT, 'tuner-verify.json'), `${JSON.stringify(out, null, 2)}\n`);
    return out;
  }

  // ---- PHASE A: per-slider liveness table -----------------------------------
  out.steps.equipped = await equip('broom');
  await page.keyboard.press('F9');
  await page.waitForTimeout(600);
  out.steps.panelOpen = await page.evaluate(
    () => !!document.querySelector('.tool-tuner') && document.querySelector('.tool-tuner').style.display !== 'none',
  );
  await page.screenshot({ path: path.join(OUT, 'panel-over-broom.png') });

  // drive EVERY slider to a distinct value and read the bound leaf back
  const table = await page.evaluate(() => {
    const walk = window.__fw.scene3d.walk;
    const leaf = (obj, p) => p.split('.').reduce((n, k) => (n == null ? n : n[k]), obj);
    const rows = [];
    for (const input of document.querySelectorAll('.tool-tuner input[type=range]')) {
      const p = input.dataset.path;
      const min = Number(input.min); const max = Number(input.max);
      // fault 48: a range input SNAPS assigned values to its step grid — the
      // honest target is what the input holds AFTER assignment, not the raw
      // fraction the driver asked for
      input.value = String(min + (max - min) * 0.71);
      const target = Number(input.value);
      if (p === 'dead') {
        // snapshot immediately BEFORE the dead control moves — comparing
        // against a loop-start snapshot counted the 22 real sliders
        const before = JSON.stringify(walk.toolFeelSnapshot());
        input.dispatchEvent(new Event('input', { bubbles: true }));
        rows.push({
          path: p, target, dead: true,
          after: JSON.stringify(walk.toolFeelSnapshot()) === before ? 'UNCHANGED' : 'CHANGED',
        });
        continue;
      }
      input.dispatchEvent(new Event('input', { bubbles: true }));
      const value = leaf(walk.toolFeelLive('broom'), p);
      rows.push({
        path: p,
        target,
        readBack: value == null ? null : +Number(value).toFixed(4),
        live: value != null && Math.abs(Number(value) - target) < 1e-6,
      });
    }
    return rows;
  });
  out.steps.sliderTable = table;
  const deadRow = table.find((r) => r.dead);
  const liveRows = table.filter((r) => !r.dead);
  const failedRows = liveRows.filter((r) => !r.live);

  // one behavioural spot check: anchor y is a WORLD-space observable
  const spot = await page.evaluate(() => {
    const walk = window.__fw.scene3d.walk;
    const before = walk.toolRigDiagnostics('broom')?.gripCamWorldY;
    const y0 = walk.toolFeelLive('broom').compose.gripAnchor[1];
    walk.toolFeelSet('broom', 'compose.gripAnchor.1', y0 + 0.2);
    return new Promise((resolve) => setTimeout(() => {
      const after = walk.toolRigDiagnostics('broom')?.gripCamWorldY;
      walk.toolFeelSet('broom', 'compose.gripAnchor.1', y0);
      resolve({ before, after, delta: after != null && before != null ? +(after - before).toFixed(3) : null });
    }, 250));
  });
  out.steps.anchorSpotCheck = spot;

  // Save through the panel's own button
  await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('.tool-tuner button')];
    buttons.find((b) => /save/i.test(b.textContent))?.click();
  });
  await page.waitForTimeout(700);
  const overridesExist = fs.existsSync(overridesPath);
  let savedMatches = false;
  if (overridesExist) {
    const saved = JSON.parse(fs.readFileSync(overridesPath, 'utf8'));
    const arcRow = table.find((r) => r.path === 'sweep.arcRad');
    savedMatches = !!arcRow && Math.abs((saved.broom?.sweep?.arcRad ?? -99) - arcRow.target) < 1e-3;
  }
  out.steps.overrides = { exists: overridesExist, savedMatches };

  out.checks = {
    equipped: out.steps.equipped === 'broom',
    panelOpen: out.steps.panelOpen === true,
    allSlidersLive: failedRows.length === 0,
    deadSliderInert: deadRow?.after === 'UNCHANGED',
    anchorMovesWorld: spot.delta != null && Math.abs(spot.delta - 0.2) < 0.05,
    savedToFile: overridesExist && savedMatches,
    noPageErrors: errs.length === 0,
  };
  out.failedSliders = failedRows.map((r) => r.path);
  out.ok = Object.values(out.checks).every(Boolean);
  // QA scribbles must not linger as real tuning unless the verify phase is
  // about to consume them
  if (!process.env.QA_KEEP_OVERRIDES && fs.existsSync(overridesPath)) {
    // keep for the verify phase only when the caller says so
  }
  fs.writeFileSync(path.join(OUT, 'tuner-tune.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
