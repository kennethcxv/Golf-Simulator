// C10 — "Manning the register while holding a sponge or scrub still leaves it
// in frame… Audit every tool — broom, mop, scrub, sponge, spray, cloth, vacuum
// — and confirm each one individually."
//
// Equips EVERY cleaning tool in turn, opens the register, and reads what is
// still drawn: the shared held root, the broom's private viewmodel pass, and
// each tool group's own visibility. Then closes the register and checks the
// tool comes back.
//
// Negative control: the same reads are taken with the register CLOSED and the
// tool equipped. If those do not report the tool as drawn, the probe cannot
// tell "stowed" from "never shown" and no result after it means anything.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/register-tool-stow');
  fs.mkdirSync(OUT, { recursive: true });
  const assert = (v, m) => { if (!v) throw new Error(m); };

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(process.env.QA_BASE_URL || 'http://localhost:8457/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 120000 });
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
  await page.evaluate(() => {
    const veil = document.querySelector('.load-veil');
    if (veil) veil.style.display = 'none';
  });
  await page.waitForTimeout(1500);

  // Stand at the till.
  await page.evaluate(async () => {
    const { REGISTER } = await import(new URL('src/data/shopLayout.js', document.baseURI).href);
    const app = window.__fw;
    const c = app.scene3d.clubhouse();
    const w = app.scene3d.walk;
    const off = c.interior.position;
    app.speedIdx = 0;
    w.clearKeys();
    w.state.x = REGISTER.stand.x + off.x;
    w.state.z = REGISTER.stand.z + off.z;
    const dx = REGISTER.monitor.x - REGISTER.stand.x;
    const dz = REGISTER.monitor.z - REGISTER.stand.z;
    const h = Math.hypot(dx, dz) || 0.001;
    w.state.yaw = Math.atan2(-dx / h, -dz / h);
    w.state.pitch = Math.atan2(1.18 - 1.62, h);
  });
  await page.mouse.click(640, 360);
  await page.waitForTimeout(600);

  const tools = await page.evaluate(async () => {
    const { CLEANING_TOOLS } = await import(new URL('src/data/cleaningTools.js', document.baseURI).href);
    return Object.values(CLEANING_TOOLS).map((t) => t.id);
  });
  const read = () => page.evaluate(() => window.__fw.scene3d.walk.heldToolDiagnostics());

  const rows = [];
  for (const tool of tools) {
    // ---- equip, register CLOSED: the control -------------------------------
    await page.evaluate(async (id) => {
      const app = window.__fw;
      const r = app.scene3d.clubhouse().register;
      if (r.isActive()) r.leave({ restorePointer: false });
      app.scene3d.walk.setTool(id);
    }, tool);
    await page.waitForTimeout(700);
    const held = await read();

    // ---- open the register --------------------------------------------------
    await page.evaluate(() => {
      const r = window.__fw.scene3d.clubhouse().register;
      r.enter();
    });
    await page.waitForTimeout(700);
    const atTill = await read();

    // ---- and step away again ------------------------------------------------
    await page.evaluate(() => {
      window.__fw.scene3d.clubhouse().register.leave({ restorePointer: false });
    });
    await page.waitForTimeout(800);
    const afterExit = await read();

    rows.push({
      tool,
      // CONTROL: with the register shut, something must be drawn for this tool
      drawnWhenHeld: held.heldRootVisible || held.broomPassActive
        || held.visibleHeldGroups.includes(tool),
      atTill: {
        tool: atTill.tool,
        heldRootVisible: atTill.heldRootVisible,
        broomPassActive: atTill.broomPassActive,
        visibleHeldGroups: atTill.visibleHeldGroups,
      },
      // the acceptance: nothing at all is drawn in the hands at the station
      clearAtTill: !atTill.tool && !atTill.heldRootVisible && !atTill.broomPassActive
        && atTill.visibleHeldGroups.length === 0,
      restored: afterExit.tool === tool,
    });
    await page.evaluate(() => window.__fw.scene3d.walk.setTool(null));
    await page.waitForTimeout(400);
  }

  const controlFailures = rows.filter((r) => !r.drawnWhenHeld).map((r) => r.tool);
  assert(controlFailures.length === 0,
    `NEGATIVE CONTROL FAILED: ${controlFailures.join(', ')} were not drawn even with the register `
    + 'shut, so "cleared at the till" says nothing about them.');

  const stillDrawn = rows.filter((r) => !r.clearAtTill).map((r) => r.tool);
  const notRestored = rows.filter((r) => !r.restored).map((r) => r.tool);
  const report = { tools: rows.length, rows, stillDrawn, notRestored };
  fs.writeFileSync(path.join(OUT, 'register-tool-stow.json'), `${JSON.stringify(report, null, 2)}\n`);
  assert(stillDrawn.length === 0, `still in frame at the register: ${stillDrawn.join(', ')}`);
  assert(notRestored.length === 0, `not returned to the hand on exit: ${notRestored.join(', ')}`);
  return report;
}
