// Production maintenance acceptance. Fixture setup creates a readable damaged
// green, while section selection, order creation/assignment, time controls,
// editor planning/confirmation, and Continue all use player-facing controls.
async (page) => {
  const repo = process.cwd().replaceAll('\\', '/');
  const outDir = `${repo}/qa/checkout-delivery-groundskeeping-balance/current/maintenance`;
  const target = 'http://127.0.0.1:18457/';
  const shot = page.__qaOriginalScreenshot ? page.__qaOriginalScreenshot.bind(page) : page.screenshot.bind(page);
  const goto = page.__qaOriginalGoto ? page.__qaOriginalGoto.bind(page) : page.goto.bind(page);
  const errors = [];
  const log = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });

  const waitGame = async () => {
    const continueButton = page.getByRole('button', { name: 'Continue', exact: true });
    if (await continueButton.isVisible().catch(() => false)) await continueButton.click();
    await page.waitForFunction(() => window.__fw?.screen === 'game' && window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 90000 });
    await page.waitForFunction(() => {
      const veil = document.querySelector('.load-veil');
      return window.__fw?.prewarming !== true && (!veil || getComputedStyle(veil).display === 'none'
        || Number.parseFloat(getComputedStyle(veil).opacity || '1') <= 0.01);
    }, null, { timeout: 90000 });
    await page.waitForTimeout(650);
  };
  const reloadGame = async () => {
    await goto(target, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await waitGame();
  };
  const projectTarget = async () => page.evaluate(() => {
    const app = window.__fw;
    const section = app.sectionsById?.get?.(app.__qaMaintenanceSectionId)
      || app.state.sections.find((entry) => entry.id === app.__qaMaintenanceSectionId);
    const cell = app.__qaMaintenanceCell ?? section.cells[0];
    const cx = cell % app.state.course.w;
    const cy = Math.floor(cell / app.state.course.w);
    const x = (cx + 0.5) * 8 - app.state.course.w * 4;
    const z = (cy + 0.5) * 8 - app.state.course.h * 4;
    app.scene3d.rig.target.set(x, 0, z);
    app.scene3d.rig.dist = 105;
    app.scene3d.rig.pitch = 0.92;
    app.scene3d.rig.yaw = 0.5;
    app.scene3d.rig.apply();
    app.scene3d.camera.updateMatrixWorld(true);
    app.scene3d.camera.updateProjectionMatrix();
    const vector = app.scene3d.camera.position.clone().set(x, app.scene3d.heightAt(x, z) + 0.2, z).project(app.scene3d.camera);
    const rect = document.querySelector('#game').getBoundingClientRect();
    return {
      x: rect.left + (vector.x + 1) * rect.width / 2,
      y: rect.top + (1 - vector.y) * rect.height / 2,
    };
  });

  await page.setViewportSize({ width: 1600, height: 900 });
  await reloadGame();
  const fixture = await page.evaluate(async () => {
    const app = window.__fw;
    const { ZONE } = await import('/src/sim/constants.js');
    const st = app.state;
    st.tutorial.complete = true;
    st.tutorial.hidden = true;
    st.weather.locked = true;
    st.weather.today = { tempHiF: 74, tempLoF: 56, rainIn: 0, humidity: 0.45, windMph: 5 };
    st.clock.minutes = Math.floor(st.clock.minutes / 1440) * 1440 + 11 * 60;
    app.empire.clockMinutes = st.clock.minutes;
    app.speedIdx = 0;
    st.maintenance.orders = [];
    st.maintenance.orderHistory = [];
    st.maintenance.nextOrderId = 1;
    st.maintenance.crewUnits = 0;
    st.maintenance.lastReport = null;
    st.staff.employees = st.staff.employees.filter((employee) => employee.role !== 'groundskeeper');
    st.progression.unlocks = {};
    st.tractor.repaired = false;
    st.tractor.attachment = null;
    st.course.irrigationHeads = [];
    const section = st.sections.find((entry) => entry.zone === ZONE.GREEN && entry.size >= 8);
    for (const i of section.cells) {
      st.turf.moisture[i] = 18;
      st.turf.heightMm[i] = 10;
      st.turf.ballMarks[i] = 2 + (i % 3 === 0 ? 1 : 0);
      st.turf.wear[i] = 45;
      st.turf.disType[i] = 0;
      st.turf.disSev[i] = 0;
    }
    app.__qaMaintenanceSectionId = section.id;
    app.__qaMaintenanceCell = section.cells.find((i) => {
      const x = i % st.course.w;
      const y = Math.floor(i / st.course.w);
      const hole = st.course.holes.find((entry) => entry.id === section.holeId);
      return !hole?.pin || x !== hole.pin.x || y !== hole.pin.y;
    }) ?? section.cells[0];
    app.scene3d.updateTurf(st);
    app.scene3d.clubhouse?.()?.setOrganicWalkins?.(false);
    await app.autosave();
    return { id: section.id, name: section.name, cells: section.cells.length };
  });
  log.push({ step: 'fixture', ...fixture });

  // Normal Tab enters the overview, then a normal canvas click opens inspection.
  await page.keyboard.press('Tab');
  await page.waitForFunction(() => window.__fw.courseMode === 'overview');
  const point = await projectTarget();
  await page.mouse.click(point.x, point.y);
  await page.waitForFunction(() => document.querySelector('.inspect-panel')?.style.display !== 'none');
  await page.getByRole('button', { name: /Details/ }).click();
  await page.waitForTimeout(300);
  const inspectText = await page.locator('.inspect-panel').innerText();
  await shot({ path: `${outDir}/01-damaged-green-inspection.png` });

  const beforeOrder = await page.evaluate(() => {
    const app = window.__fw;
    const section = app.state.sections.find((entry) => entry.id === app.__qaMaintenanceSectionId);
    return {
      cash: app.state.cash,
      moisture: section.cells.map((i) => app.state.turf.moisture[i]),
      orders: app.state.maintenance.orders.length,
    };
  });
  await page.getByRole('button', { name: /Water.*min/i }).click();
  const planned = await page.evaluate(() => {
    const app = window.__fw;
    const section = app.state.sections.find((entry) => entry.id === app.__qaMaintenanceSectionId);
    const order = app.state.maintenance.orders.at(-1);
    return {
      cash: app.state.cash,
      moisture: section.cells.map((i) => app.state.turf.moisture[i]),
      orders: app.state.maintenance.orders.length,
      order: { id: order.id, status: order.status, assignment: order.assignment, duration: order.durationMinutes },
    };
  });

  await page.keyboard.press('g');
  await page.waitForFunction(() => window.__fw.groundsOpen === true);
  await page.waitForTimeout(450);
  const tier0Text = await page.locator('.grounds-panel').filter({ hasText: 'Work board' }).innerText();
  await shot({ path: `${outDir}/02-tier-zero-work-board.png` });
  const equipmentDisabled = await page.getByRole('button', { name: 'Equipment', exact: true }).isDisabled();

  // Hiring is fixture setup; assigning the now-real employee is a normal board click.
  await page.evaluate(() => window.__fw.state.staff.employees.push({
    id: 9901, name: 'Riley Grounds', role: 'groundskeeper', skill: 3, wage: 124, trainingDays: 0,
  }));
  await page.keyboard.press('g');
  await page.keyboard.press('g');
  await page.waitForTimeout(300);
  const cashBeforeAssignment = await page.evaluate(() => window.__fw.state.cash);
  await page.getByRole('button', { name: 'Groundskeeper', exact: true }).click({ force: true });
  const assigned = await page.evaluate(() => {
    const order = window.__fw.state.maintenance.orders.at(-1);
    return { status: order.status, assignment: order.assignment, cash: window.__fw.state.cash };
  });
  await shot({ path: `${outDir}/03-paid-staff-order.png` });

  // The 16x key is the normal time control. Turf stays unchanged until the first
  // hourly work tick completes the short green order.
  await page.keyboard.press('3');
  await page.waitForFunction(() => window.__fw.state.maintenance.orders.at(-1)?.status === 'complete', null, { timeout: 10000 });
  await page.keyboard.press('Space');
  const completed = await page.evaluate(() => {
    const app = window.__fw;
    const section = app.state.sections.find((entry) => entry.id === app.__qaMaintenanceSectionId);
    const order = app.state.maintenance.orders.at(-1);
    return {
      status: order.status,
      result: order.result,
      moisture: section.cells.map((i) => app.state.turf.moisture[i]),
    };
  });
  await shot({ path: `${outDir}/04-completed-timed-order.png` });

  // Close Grounds, open DESIGN with E, and construct a sprinkler through the
  // normal palette/canvas/confirm route. Planning must remain simulation-inert.
  await page.keyboard.press('g');
  await page.keyboard.press('e');
  await page.waitForTimeout(3200);
  await page.getByRole('button', { name: 'Place sprinkler', exact: true }).click();
  const buildPoint = await projectTarget();
  const moistureBeforeConstruction = completed.moisture;
  await page.mouse.click(buildPoint.x, buildPoint.y);
  const stagedConstruction = await page.evaluate(() => ({
    plan: [...window.__fw.plan.cells.values()].map((entry) => ({ ...entry })),
    heads: [...window.__fw.state.course.irrigationHeads],
  }));
  await page.locator('.works-palette').evaluate((element) => { element.scrollTop = 0; });
  await shot({ path: `${outDir}/05-design-staged-sprinkler.png` });
  await page.getByRole('button', { name: 'Confirm works', exact: true }).click();
  const built = await page.evaluate(() => {
    const app = window.__fw;
    const section = app.state.sections.find((entry) => entry.id === app.__qaMaintenanceSectionId);
    return {
      heads: [...app.state.course.irrigationHeads],
      moisture: section.cells.map((i) => app.state.turf.moisture[i]),
      planSize: app.plan.cells.size,
    };
  });
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    window.__fw.scene3d.rig.dist = 32;
    window.__fw.scene3d.rig.pitch = 0.75;
    window.__fw.scene3d.rig.apply();
  });
  await page.locator('.works-palette').evaluate((element) => { element.scrollTop = 0; });
  await page.waitForTimeout(450);
  await shot({ path: `${outDir}/06-confirmed-construction.png` });

  // Start two fresh player orders through inspection, return to first person,
  // then use the physical belt and held mouse controls on one real cell.
  await page.keyboard.press('e');
  const manualPoint = await projectTarget();
  await page.mouse.click(manualPoint.x, manualPoint.y);
  await page.getByRole('button', { name: /Water.*min/i }).click();
  await page.getByRole('button', { name: /Repair ball marks.*min/i }).click();
  await page.waitForTimeout(3200);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Tab');
  await page.waitForFunction(() => window.__fw.courseMode === 'walk');
  const manualBefore = await page.evaluate(() => {
    const app = window.__fw;
    const cell = app.__qaMaintenanceCell;
    const cx = cell % app.state.course.w;
    const cy = Math.floor(cell / app.state.course.w);
    const x = (cx + 0.5) * 8 - app.state.course.w * 4;
    const z = (cy + 0.5) * 8 - app.state.course.h * 4;
    const walk = app.scene3d.walk.state;
    walk.x = x;
    walk.z = z + 3;
    walk.yaw = 0;
    walk.pitch = -0.25;
    app.scene3d.walk.setTool(null);
    app.scene3d.walk.clearKeys();
    return {
      cell, moisture: app.state.turf.moisture[cell], ballMarks: app.state.turf.ballMarks[cell],
    };
  });
  await page.waitForTimeout(300);
  await page.keyboard.press('f');
  await page.keyboard.press('f');
  await page.waitForTimeout(3200);
  await page.mouse.move(800, 450);
  await page.mouse.down();
  await page.waitForTimeout(500);
  await shot({ path: `${outDir}/07-first-person-hand-watering.png` });
  await page.waitForTimeout(350);
  await page.mouse.up();
  const manualWater = await page.evaluate(() => {
    const app = window.__fw;
    const order = [...app.state.maintenance.orders].reverse().find((entry) => entry.type === 'water' && entry.status === 'open');
    return {
      tool: app.scene3d.walk.getTool(),
      moisture: app.state.turf.moisture[app.__qaMaintenanceCell],
      order: order ? { status: order.status, progress: order.progressMinutes, manualCells: [...order.manualCells] } : null,
    };
  });
  await page.keyboard.press('f');
  await page.waitForTimeout(3200);
  await page.mouse.down();
  await page.waitForTimeout(500);
  await shot({ path: `${outDir}/08-first-person-ball-mark-repair.png` });
  await page.waitForTimeout(350);
  await page.mouse.up();
  const manualRepair = await page.evaluate(() => {
    const app = window.__fw;
    const order = [...app.state.maintenance.orders].reverse().find((entry) => entry.type === 'repairBallMarks' && entry.status === 'open');
    return {
      tool: app.scene3d.walk.getTool(),
      ballMarks: app.state.turf.ballMarks[app.__qaMaintenanceCell],
      order: order ? { status: order.status, progress: order.progressMinutes, manualCells: [...order.manualCells] } : null,
    };
  });

  await page.evaluate(() => window.__fw.autosave());
  await reloadGame();
  const reloaded = await page.evaluate(() => ({
    heads: [...window.__fw.state.course.irrigationHeads],
    orders: window.__fw.state.maintenance.orders.map((order) => ({
      id: order.id, type: order.type, status: order.status, result: order.result,
      progress: order.progressMinutes, manualCells: order.manualCells,
    })),
    damageArrays: [window.__fw.state.turf.divots.length, window.__fw.state.turf.ballMarks.length],
    gridSize: window.__fw.state.course.w * window.__fw.state.course.h,
  }));

  const checks = {
    inspectionIsPlanning: /Maintenance map.*planning only/i.test(inspectText),
    localizedDamageReadable: /Ball marks/i.test(inspectText),
    plannedOrderInert: planned.orders === beforeOrder.orders + 1
      && planned.cash === beforeOrder.cash
      && JSON.stringify(planned.moisture) === JSON.stringify(beforeOrder.moisture)
      && planned.order.status === 'open',
    tierZeroExplained: /Tier 0\s*-\s*owner-operated/i.test(tier0Text),
    equipmentLocked: equipmentDisabled,
    assignmentPaid: assigned.assignment === 'staff' && assigned.status === 'queued' && assigned.cash < cashBeforeAssignment,
    timedCompletion: completed.status === 'complete'
      && completed.moisture.some((value, index) => value > planned.moisture[index]),
    stagedConstructionInert: stagedConstruction.plan.some((entry) => entry.irrigation === true)
      && stagedConstruction.heads.length === 0,
    constructionDoesNotMaintain: built.heads.length === 1
      && JSON.stringify(built.moisture) === JSON.stringify(moistureBeforeConstruction)
      && built.planSize === 0,
    manualWaterIsPhysical: manualWater.tool === 'hose'
      && manualWater.moisture > manualBefore.moisture
      && manualWater.order?.status === 'open'
      && manualWater.order.manualCells.includes(manualBefore.cell)
      && manualWater.order.progress > 0,
    manualRepairIsPhysical: manualRepair.tool === 'divot'
      && manualRepair.ballMarks < manualBefore.ballMarks
      && manualRepair.order?.status === 'open'
      && manualRepair.order.manualCells.includes(manualBefore.cell)
      && manualRepair.order.progress > 0,
    continuePersistsLifecycle: reloaded.heads.length === 1
      && reloaded.orders.some((order) => order.status === 'complete')
      && reloaded.orders.filter((order) => order.status === 'open' && order.manualCells?.length).length === 2
      && reloaded.damageArrays.every((length) => length === reloaded.gridSize),
  };
  log.push({ beforeOrder, planned, assigned, completed, stagedConstruction, built, manualBefore, manualWater, manualRepair, reloaded });
  const report = { ok: Object.values(checks).every(Boolean) && errors.length === 0, checks, errors, log };
  if (!report.ok) throw new Error(`Maintenance acceptance failed: ${JSON.stringify(report)}`);
  return report;
}
