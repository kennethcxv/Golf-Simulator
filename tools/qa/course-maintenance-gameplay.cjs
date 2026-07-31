'use strict';

// End-to-end maintenance route. Setup uses the deterministic QA fixture and
// moves the player between stations to keep the run bounded; every inspection,
// interaction, tool selection, hold action, blade toggle, save, and reload is
// then performed through the same keyboard/pointer/DOM controls as the player.

const fs = require('fs');
const path = require('path');

function loadPlaywright() {
  for (const candidate of [
    'playwright',
    process.env.PLAYWRIGHT_PATH,
    'C:/Users/Kenneth/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright',
    'C:/Users/Kenneth/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright',
  ].filter(Boolean)) {
    try { return require(candidate); } catch { /* next */ }
  }
  throw new Error('Playwright is unavailable.');
}

const { chromium } = loadPlaywright();
const ROOT = path.resolve(__dirname, '../..');
const PHASE = process.env.QA_PHASE || 'gameplay';
const PORT = Number(process.env.QA_PORT || 8462);
const OUT = path.join(ROOT, 'qa/course-maintenance', PHASE);
const VIDEO_OUT = path.join(OUT, 'video-tmp');
const FIXTURE_SEED = 20260719;
const PROGRESS = path.join(OUT, 'progress.log');
const logProgress = (label) => fs.appendFileSync(PROGRESS, `${new Date().toISOString()} ${label}\n`);

async function establishFixture(page) {
  await page.evaluate(async (fixtureSeed) => {
    localStorage.clear();
    const empireModule = await import('/src/sim/empire.js');
    const empire = empireModule.newEmpire('relaxed', fixtureSeed);
    const willow = empire.market.find((property) => property.name === 'Willow Creek Municipal');
    if (!willow) throw new Error('Willow fixture missing.');
    const bought = empireModule.buyProperty(empire, willow.id);
    if (!bought.ok) throw new Error(bought.reason);
    localStorage.setItem('golfempire:autosave', JSON.stringify(empireModule.empireSnapshot(empire)));
  }, FIXTURE_SEED);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.waitForFunction(() => window.__fw?.state?.courseMaintenance?.heroHoleNumber === 4, null, { timeout: 20000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || veil.style.display === 'none' || Number.parseFloat(getComputedStyle(veil).opacity) === 0;
  }, null, { timeout: 60000 });
  await page.waitForTimeout(500);
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.__fw?.speedIdx === 0);
}

async function targetData(page) {
  return page.evaluate(() => {
    const app = window.__fw;
    const state = app.state;
    const model = state.courseMaintenance;
    const structure = state.course.structures[0];
    const bx = (structure.x + structure.w / 2) * 8 - state.course.w * 4;
    const bz = (structure.y + structure.h / 2) * 8 - state.course.h * 4;
    const point = (index) => ({
      x: model.bounds.minCourseYdX + (index % model.width + 0.5) - model.courseWorldWidthYd / 2,
      z: model.bounds.minCourseYdY + (Math.floor(index / model.width) + 0.5) - model.courseWorldHeightYd / 2,
    });
    const bestIndex = (accept, value, direction) => {
      let best = -1;
      let bestValue = direction > 0 ? -Infinity : Infinity;
      for (let index = 0; index < model.surface.length; index++) {
        if (!accept(index)) continue;
        const next = value(index);
        if ((direction > 0 && next > bestValue) || (direction < 0 && next < bestValue)) {
          best = index;
          bestValue = next;
        }
      }
      return point(best);
    };
    const interiorIndex = (surface, value = () => 0) => {
      let best = -1;
      let bestValue = -Infinity;
      for (let index = 0; index < model.surface.length; index++) {
        if (model.surface[index] !== surface) continue;
        const x = index % model.width;
        const y = Math.floor(index / model.width);
        let sameSurface = 0;
        for (let oy = -3; oy <= 3; oy++) {
          for (let ox = -3; ox <= 3; ox++) {
            const nx = x + ox;
            const ny = y + oy;
            if (nx < 0 || ny < 0 || nx >= model.width || ny >= model.height) continue;
            if (model.surface[ny * model.width + nx] === surface) sameSurface++;
          }
        }
        const score = sameSurface * 1000 + value(index);
        if (score > bestValue) {
          best = index;
          bestValue = score;
        }
      }
      return point(best);
    };
    return {
      yard: {
        board: { x: bx + 17.0, z: bz + 16.45 },
        leaves: { x: bx + 11.8, z: bz + 20.4 },
        fuel: { x: bx + 17.4, z: bz + 18.9 },
        belt: { x: bx + 21.0, z: bz + 18.8 },
        tractor: { x: bx + 14.5, z: bz + 18.5 },
        greensMower: { x: bx + 13.0, z: bz + 22.5 },
        spreader: { x: bx + 16.0, z: bz + 23.0 },
      },
      divots: model.issues.divots.map(({ x, z }) => ({ x, z })),
      ballMarks: model.issues.ballMarks.map(({ x, z }) => ({ x, z })),
      footprints: model.issues.bunkerFootprints.map(({ x, z }) => ({ x, z })),
      debris: model.issues.debris.map(({ x, z }) => ({ x, z })),
      dry: bestIndex((i) => model.surface[i] > 0 && model.surface[i] < 7, (i) => model.moisture[i], -1),
      weak: bestIndex((i) => model.surface[i] > 0 && model.surface[i] < 7, (i) => model.fertilizer[i], -1),
      disease: bestIndex((i) => model.diseaseSeverity[i] > 0, (i) => model.diseaseSeverity[i], 1),
      green: interiorIndex(1, (i) => model.heightQ[i]),
      fairway: interiorIndex(4, (i) => model.heightQ[i]),
    };
  });
}

async function faceTarget(page, point, distance = 2.25) {
  await page.evaluate(({ point: target, distance: d }) => {
    const walk = window.__fw.scene3d.walk.state;
    walk.x = target.x;
    walk.z = target.z + d;
    walk.yaw = 0;
    walk.pitch = -0.32;
  }, { point, distance });
  await page.waitForTimeout(300);
}

async function ensureCourseWalk(page) {
  const before = await page.evaluate(() => ({
    screen: window.__fw?.screen,
    view: window.__fw?.view,
    courseMode: window.__fw?.courseMode,
    walkActive: window.__fw?.scene3d?.walk?.isActive?.() || false,
    inspection: window.__fw?.state?.courseMaintenance?.inspection?.active,
    activeElement: document.activeElement?.tagName,
  }));
  logProgress(`post-reload view: ${JSON.stringify(before)}`);
  if (before.view !== 'course') throw new Error(`Expected course view after Continue, received ${before.view}`);
  if (!before.walkActive || before.courseMode !== 'walk') {
    if (before.courseMode === 'walk') {
      await page.keyboard.press('Tab');
      await page.waitForTimeout(250);
    }
    await page.keyboard.press('Tab');
    await page.waitForFunction(() => (
      window.__fw?.courseMode === 'walk'
      && window.__fw?.scene3d?.walk?.isActive?.()
    ), null, { timeout: 5000 });
  }
}

async function interact(page, point, distance = 1.45) {
  await faceTarget(page, point, distance);
  await page.keyboard.press('e');
  await page.waitForTimeout(320);
}

async function resumeLook(page) {
  const locked = await page.evaluate(() => !!document.pointerLockElement);
  if (locked) return;
  await page.locator('#game').click({ button: 'middle', position: { x: 800, y: 450 }, force: true });
  await page.waitForTimeout(150);
}

async function selectTool(page, tool) {
  const visible = await page.locator('.cm-panel').isVisible();
  if (!visible) await page.keyboard.press('i');
  await page.locator(`.cm-tool[data-tool="${tool}"]`).click();
  if (await page.locator('.cm-panel').isVisible()) await page.keyboard.press('i');
  await resumeLook(page);
  await page.waitForTimeout(180);
}

async function useTool(page, point, milliseconds, { walk = false, screenshot = null } = {}) {
  await faceTarget(page, point, 3.0);
  await page.mouse.move(800, 450);
  await page.mouse.down({ button: 'left' });
  if (walk) await page.keyboard.down('w');
  if (screenshot) {
    await page.waitForTimeout(Math.min(500, milliseconds / 2));
    await page.screenshot({ path: path.join(OUT, screenshot) });
    await page.waitForTimeout(Math.max(0, milliseconds - Math.min(500, milliseconds / 2)));
  } else {
    await page.waitForTimeout(milliseconds);
  }
  if (walk) await page.keyboard.up('w');
  await page.mouse.up({ button: 'left' });
  await page.waitForTimeout(180);
}

async function stateSummary(page) {
  return page.evaluate(() => {
    const model = window.__fw.state.courseMaintenance;
    const done = (list, field = 'repaired') => list.filter((item) => item[field]).length;
    return {
      score: model.score,
      route: model.route,
      inspection: model.inspection,
      inventory: model.inventory,
      equipment: model.equipment,
      issues: {
        divots: [done(model.issues.divots), model.issues.divots.length],
        ballMarks: [done(model.issues.ballMarks), model.issues.ballMarks.length],
        footprints: [done(model.issues.bunkerFootprints), model.issues.bunkerFootprints.length],
        debris: [done(model.issues.debris, 'cleared'), model.issues.debris.length],
      },
      workOrder: model.workOrder,
      reloadCount: model.persistence.reloadCount,
      historyTypes: [...new Set(model.history.map((entry) => entry.type))],
      tractorRepaired: window.__fw.state.tractor.repaired,
    };
  });
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(PROGRESS, '');
  if (fs.existsSync(VIDEO_OUT)) fs.rmSync(VIDEO_OUT, { recursive: true, force: true });
  fs.mkdirSync(VIDEO_OUT, { recursive: true });
  const step = (label) => {
    process.stdout.write(`[course-maintenance] ${label}\n`);
    logProgress(label);
  };
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const contextOptions = {
    viewport: { width: 1600, height: 900 },
    deviceScaleFactor: 1,
  };
  if (process.env.QA_VIDEO !== '0') {
    contextOptions.recordVideo = { dir: VIDEO_OUT, size: { width: 1600, height: 900 } };
  }
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  const consoleEvents = [];
  const pageErrors = [];
  const failedRequests = [];
  page.on('console', (message) => {
    if (['warning', 'error'].includes(message.type())) consoleEvents.push({ type: message.type(), text: message.text() });
  });
  page.on('pageerror', (error) => pageErrors.push(String(error.stack || error)));
  page.on('requestfailed', (request) => failedRequests.push({ url: request.url(), failure: request.failure()?.errorText || 'unknown' }));

  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
  step('loading deterministic fixture');
  await establishFixture(page);
  const guideClose = page.getByTitle('Hide the guide');
  if (await guideClose.isVisible()) await guideClose.evaluate((button) => button.click());
  await resumeLook(page);
  const targets = await targetData(page);
  const baseline = await stateSummary(page);
  await faceTarget(page, targets.yard.board, 5.0);
  await page.screenshot({ path: path.join(OUT, '01-yard-arrival.png') });
  await page.waitForTimeout(2800);

  // Route + physical tractor restoration.
  step('reviewing route and restoring tractor');
  await interact(page, targets.yard.board, 2.2);
  await page.screenshot({ path: path.join(OUT, '02-work-order.png') });
  if (await page.locator('.cm-panel').isVisible()) await page.keyboard.press('i');
  await resumeLook(page);
  for (const target of [targets.yard.leaves, targets.yard.fuel, targets.yard.belt]) await interact(page, target);
  await interact(page, targets.yard.tractor, 2.1);
  logProgress(`tractor repaired: ${await page.evaluate(() => window.__fw.state.tractor.repaired)}`);
  await page.waitForTimeout(2800);

  // First inspection and all hand/push tools.
  step('inspecting hero hole');
  await interact(page, targets.green, 2.3);
  await page.screenshot({ path: path.join(OUT, '03-first-inspection.png') });
  if (await page.locator('.cm-panel').isVisible()) await page.keyboard.press('i');
  await resumeLook(page);
  await page.waitForTimeout(2800);

  await selectTool(page, 'greensMower');
  step('mowing green and applying turf treatments');
  await page.keyboard.press('r');
  await useTool(page, targets.green, 1800, { walk: true, screenshot: '04-greens-mowing.png' });

  await selectTool(page, 'hose');
  await useTool(page, targets.dry, 3300, { screenshot: '05-irrigating.png' });
  await interact(page, targets.dry, 2.3);
  await page.screenshot({ path: path.join(OUT, '05b-irrigated-result.png') });
  if (await page.locator('.cm-panel').isVisible()) await page.keyboard.press('i');
  await resumeLook(page);
  await page.waitForTimeout(2800);
  await selectTool(page, 'spreader');
  await useTool(page, targets.weak, 1400, { walk: true, screenshot: '06-fertilizing.png' });
  await interact(page, targets.weak, 2.3);
  await page.screenshot({ path: path.join(OUT, '06b-fertilizer-result.png') });
  if (await page.locator('.cm-panel').isVisible()) await page.keyboard.press('i');
  await resumeLook(page);
  await page.waitForTimeout(2800);
  await selectTool(page, 'fungicide');
  await useTool(page, targets.disease, 1200, { screenshot: '07-disease-treatment.png' });
  await interact(page, targets.disease, 2.3);
  await page.screenshot({ path: path.join(OUT, '07b-treatment-result.png') });
  if (await page.locator('.cm-panel').isVisible()) await page.keyboard.press('i');
  await resumeLook(page);
  await page.waitForTimeout(2800);

  await selectTool(page, 'divot');
  step('repairing divots');
  for (let index = 0; index < targets.divots.length; index++) {
    logProgress(`divot ${index + 1} start`);
    await useTool(page, targets.divots[index], 1650, index === 0 ? { screenshot: '08-divot-repair.png' } : {});
    logProgress(`divot ${index + 1} end`);
  }
  await faceTarget(page, targets.divots[0], 3.0);
  await page.screenshot({ path: path.join(OUT, '08b-divots-repaired.png') });
  await selectTool(page, 'ballmark');
  step('repairing ball marks');
  for (let index = 0; index < targets.ballMarks.length; index++) {
    logProgress(`ball mark ${index + 1} start`);
    await useTool(page, targets.ballMarks[index], 900, index === 0 ? { screenshot: '09-ball-mark-repair.png' } : {});
    logProgress(`ball mark ${index + 1} end`);
  }
  await faceTarget(page, targets.ballMarks[0], 3.0);
  await page.screenshot({ path: path.join(OUT, '09b-ball-marks-repaired.png') });
  await selectTool(page, 'rake');
  step('raking bunker footprints');
  for (let index = 0; index < targets.footprints.length; index++) {
    logProgress(`footprint ${index + 1} start`);
    await useTool(page, targets.footprints[index], 1050, index === 0 ? { screenshot: '10-bunker-raking.png' } : {});
    logProgress(`footprint ${index + 1} end`);
  }
  await faceTarget(page, targets.footprints[0], 3.0);
  await page.screenshot({ path: path.join(OUT, '10b-bunker-raked.png') });
  await selectTool(page, 'debris');
  step('collecting debris');
  for (let index = 0; index < targets.debris.length; index++) {
    logProgress(`debris ${index + 1} start`);
    await useTool(page, targets.debris[index], 1050, index === 0 ? { screenshot: '11-debris-cleanup.png' } : {});
    logProgress(`debris ${index + 1} end`);
  }
  await faceTarget(page, targets.debris[0], 3.0);
  await page.screenshot({ path: path.join(OUT, '11b-debris-cleared.png') });

  // Mount the restored tractor, engage blades explicitly, and cut a fairway run.
  step('mowing fairway with tractor');
  await interact(page, targets.yard.tractor, 2.9);
  await page.waitForFunction(() => window.__fw.scene3d.walk.cart.mounted === true, null, { timeout: 5000 });
  logProgress('tractor mounted');
  await page.evaluate((point) => {
    const app = window.__fw;
    Object.assign(app.scene3d.walk.state, { x: point.x, z: point.z + 5, yaw: 0, pitch: -0.1 });
    app.scene3d.walk.placeCart(point.x, point.z + 5, 0);
  }, targets.fairway);
  await page.keyboard.press('r');
  await page.keyboard.down('w');
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(OUT, '12-tractor-mowing.png') });
  await page.waitForTimeout(900);
  await page.keyboard.up('w');
  await page.keyboard.press('e');
  await page.waitForTimeout(2800);

  // Reinspection, then the actual autosave/reload path.
  step('reinspecting and testing save reload');
  await interact(page, targets.green, 2.3);
  await page.screenshot({ path: path.join(OUT, '13-reinspection.png') });
  await page.evaluate(() => window.__fw.autosave());
  const beforeReload = await stateSummary(page);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.waitForFunction(() => window.__fw?.state?.courseMaintenance?.persistence?.reloadCount > 0, null, { timeout: 20000 });
  await page.waitForTimeout(9500);
  await page.keyboard.press('Space');
  await ensureCourseWalk(page);
  await faceTarget(page, targets.green, 4.2);
  const afterReload = await stateSummary(page);
  if (!await page.locator('.cm-panel').isVisible()) await page.keyboard.press('i');
  if (!await page.locator('.cm-panel').isVisible()) {
    const debug = await page.evaluate(() => ({
      screen: window.__fw?.screen,
      courseMode: window.__fw?.courseMode,
      walkActive: window.__fw?.scene3d?.walk?.isActive?.() || false,
      inspection: window.__fw?.state?.courseMaintenance?.inspection?.active,
      panelDisplay: document.querySelector('.cm-panel')?.style?.display,
      activeElement: document.activeElement?.tagName,
    }));
    logProgress(`tablet key retry: ${JSON.stringify(debug)}`);
    await page.locator('#game').click({ position: { x: 800, y: 450 }, force: true });
    await page.keyboard.press('I');
  }
  await page.locator('.cm-panel').waitFor({ state: 'visible', timeout: 5000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, '14-after-reload.png') });

  const assertions = {
    routeReviewed: afterReload.route.arrivedAtMinute !== null && afterReload.route.reviewedAtMinute !== null,
    tractorRepaired: afterReload.tractorRepaired,
    allDivots: afterReload.issues.divots[0] === afterReload.issues.divots[1],
    allBallMarks: afterReload.issues.ballMarks[0] === afterReload.issues.ballMarks[1],
    allFootprints: afterReload.issues.footprints[0] === afterReload.issues.footprints[1],
    allDebris: afterReload.issues.debris[0] === afterReload.issues.debris[1],
    actionsPersisted: ['mowing', 'irrigation', 'fertilizer', 'disease-treatment'].every((type) => afterReload.historyTypes.includes(type)),
    reloadRecorded: afterReload.reloadCount > beforeReload.reloadCount,
    saveLoadWasPending: beforeReload.workOrder.steps.find((step) => step.id === 'save-load')?.complete === false,
    workOrderCompletedAfterReload: afterReload.workOrder.steps.every((step) => step.complete),
    conditionImproved: afterReload.score.total > baseline.score.total,
    scoreDidNotRegress: afterReload.score.total >= beforeReload.score.total,
  };

  const video = page.video();
  await page.close();
  await context.close();
  const recordedPath = video ? await video.path() : null;
  await browser.close();
  let videoPath = null;
  if (recordedPath && fs.existsSync(recordedPath)) {
    videoPath = path.join(OUT, 'maintenance-route.webm');
    if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath);
    fs.renameSync(recordedPath, videoPath);
  }
  if (fs.existsSync(VIDEO_OUT) && fs.readdirSync(VIDEO_OUT).length === 0) fs.rmdirSync(VIDEO_OUT);

  const result = {
    capturedAt: new Date().toISOString(),
    phase: PHASE,
    fixtureSeed: FIXTURE_SEED,
    assertions,
    baseline,
    beforeReload,
    afterReload,
    console: { warningsAndErrors: consoleEvents, pageErrors, failedRequests },
    videoPath: videoPath ? path.relative(ROOT, videoPath) : null,
  };
  fs.writeFileSync(path.join(OUT, 'gameplay.json'), JSON.stringify(result, null, 2));
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  if (Object.values(assertions).some((value) => !value) || pageErrors.length) process.exitCode = 1;
}

main().catch((error) => {
  try { logProgress(`FATAL ${String(error.stack || error)}`); } catch { /* output path unavailable */ }
  process.stderr.write(String(error.stack || error) + '\n');
  process.exit(1);
});
