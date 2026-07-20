import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';

const url = process.env.GOLF_FLIPPER_URL || 'http://127.0.0.1:8457/';
const outputRoot = path.resolve(process.cwd(), process.env.QA_PLACEMENT_OUTPUT
  || 'qa/integration-seven/final-visual-review/placement');
await fs.mkdir(outputRoot, { recursive: true });

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--enable-precise-memory-info', '--force-device-scale-factor=1'],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
  recordVideo: { dir: path.join(outputRoot, 'video'), size: { width: 1440, height: 900 } },
});
const page = await context.newPage();
const consoleErrors = [];
const pageErrors = [];
page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
page.on('pageerror', (error) => pageErrors.push(error.stack || error.message));

async function waitForGame() {
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90_000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
  }, null, { timeout: 90_000 });
}

async function startFreshGame() {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
  const polishedNewGame = page.locator('.menu-screen .menu-action').filter({ hasText: /^New game/ });
  if (await polishedNewGame.count()) {
    await polishedNewGame.click();
    await page.getByRole('dialog', { name: 'New game' }).waitFor();
    await page.locator('.difficulty-card').filter({ hasText: /^Relaxed/ }).click();
  } else {
    await page.getByRole('button', { name: /New Empire.*Relaxed/ }).click();
  }
  await page.getByRole('button', { name: 'Buy', exact: true }).first().click();
  await waitForGame();
}

async function aimAt(id) {
  const result = await page.evaluate(async (objectId) => {
    const app = window.__fw;
    const THREE = await import('three');
    const { objectById } = await import('/src/sim/layout.js');
    const scene = app.scene3d.scene;
    const clubhouse = app.scene3d.clubhouse();
    const walk = app.scene3d.walk;
    const object = objectById(app.state, objectId);
    if (!object) throw new Error(`Missing layout object ${objectId}`);
    let root = null;
    scene.traverse((node) => {
      if (!root && node.parent?.name === 'ClubhousePlaceables' && node.userData?.placeableId === objectId) root = node;
    });
    if (!root) throw new Error(`Missing rendered root ${objectId}`);
    // Resolve the authored root only to prove the selection target exists. Game
    // actions still enter through the player's B/E/R/arrow/Escape controls below.
    const local = object.transform;
    scene.updateMatrixWorld(true);
    let aimMesh = null;
    let aimScore = -1;
    root.traverse((node) => {
      if (!node.isMesh || !node.visible || !node.geometry) return;
      const score = node.geometry.index?.count || node.geometry.attributes.position?.count || 0;
      if (score > aimScore) {
        aimScore = score;
        aimMesh = node;
      }
    });
    const center = new THREE.Box3().setFromObject(aimMesh || root).getCenter(new THREE.Vector3());
    const towardRoom = new THREE.Vector2(-8 - center.x, 228 - center.z);
    if (towardRoom.lengthSq() < 0.01) towardRoom.set(0, 1);
    towardRoom.normalize().multiplyScalar(2.25);
    walk.clearKeys();
    walk.state.x = center.x + towardRoom.x;
    walk.state.z = center.z + towardRoom.y;
    app.speedIdx = 0;
    const minute = Math.floor(app.state.clock.minutes / 1440) * 1440 + 330;
    app.state.clock.minutes = minute;
    app.scene3d.applyTimeWeather(330, app.state.weather);
    return {
      id: object.id,
      transform: structuredClone(object.transform),
      center: center.toArray(),
      inside: clubhouse.isInside(walk.state.x, walk.state.z),
    };
  }, id);
  assert.equal(result.inside, true, 'QA camera is inside the clubhouse');
  await page.waitForTimeout(250);
  await page.evaluate((center) => {
    const app = window.__fw;
    const walk = app.scene3d.walk;
    const camera = app.scene3d.camera;
    const dx = center[0] - camera.position.x;
    const dy = center[1] - camera.position.y;
    const dz = center[2] - camera.position.z;
    const horizontal = Math.hypot(dx, dz) || 1;
    walk.state.yaw = Math.atan2(-dx, -dz);
    walk.state.pitch = Math.atan2(dy, horizontal);
  }, result.center);
  await page.waitForTimeout(500);
  return result;
}

async function transformFor(id) {
  return page.evaluate(async (objectId) => {
    const { objectById } = await import('/src/sim/layout.js');
    return structuredClone(objectById(window.__fw.state, objectId).transform);
  }, id);
}

async function batchDiagnostics() {
  return page.evaluate(() => {
    const app = window.__fw;
    const camera = app.scene3d.camera;
    const root = app.scene3d.scene.getObjectByName('ClubhousePlaceables');
    const batches = app.scene3d.scene.getObjectByName('ClubhousePlaceableRenderBatches');
    const authoredRoots = root.children.filter((child) => child !== batches && child.userData?.placeableId);
    return {
      batchMeshes: batches.children.filter((child) => child.isMesh && child.visible).length,
      authoredRoots: authoredRoots.length,
      authoredRootsRendering: authoredRoots.filter((child) => child.visible && child.layers.test(camera.layers)).length,
      diagnostics: app.scene3d.clubhouse().furnitureDiagnostics(),
    };
  });
}

const report = { url, controls: [], consoleErrors, pageErrors };
try {
  await startFreshGame();
  const id = 'asset-099';
  const before = await aimAt(id);
  report.before = before;
  report.beforeBatch = await batchDiagnostics();
  await page.screenshot({ path: path.join(outputRoot, '01-before-move.png') });

  await page.keyboard.press('b');
  report.controls.push('B enter renovation');
  await page.waitForFunction(() => window.__fw.scene3d.clubhouse().build.isActive());
  await page.keyboard.press('e');
  report.controls.push('E pick up');
  await page.waitForFunction((objectId) => {
    const diagnostic = window.__fw.scene3d.clubhouse().build.diagnostics();
    return diagnostic.carrying === objectId && diagnostic.previewLoaded;
  }, id, { timeout: 20_000 });
  await page.keyboard.press('o');
  report.controls.push('O restore exact original preview');
  await page.waitForFunction(() => window.__fw.scene3d.clubhouse().build.diagnostics().valid);
  await page.keyboard.press('ArrowRight');
  report.controls.push('ArrowRight fine nudge');
  await page.keyboard.press('r');
  report.controls.push('R rotate');
  // The preview is evaluated on the next scene frame; validity may already be
  // true from the preceding candidate, so wait for the keyed transform itself.
  await page.waitForTimeout(250);
  await page.waitForFunction(() => window.__fw.scene3d.clubhouse().build.diagnostics().valid);
  report.preview = await page.evaluate(() => window.__fw.scene3d.clubhouse().build.diagnostics());
  assert.equal(report.preview.previewLoaded, true);
  assert.equal(report.preview.valid, true);
  assert.notDeepEqual(report.preview.candidate, before.transform, 'preview proposes a changed transform');
  await page.screenshot({ path: path.join(outputRoot, '02-valid-preview.png') });

  const expected = structuredClone(report.preview.candidate);
  await page.keyboard.press('e');
  report.controls.push('E confirm placement');
  await page.waitForFunction(() => !window.__fw.scene3d.clubhouse().build.isCarrying());
  report.afterPlacement = await transformFor(id);
  assert.deepEqual(report.afterPlacement, expected, 'final transform exactly matches the valid preview');
  report.afterPlacementBatch = await batchDiagnostics();
  assert.equal(report.afterPlacementBatch.authoredRootsRendering, 0, 'authored selection roots do not render twice');
  assert.ok(report.afterPlacementBatch.batchMeshes > 0 && report.afterPlacementBatch.batchMeshes <= 10,
    `expected compact render batches, got ${report.afterPlacementBatch.batchMeshes}`);
  await page.screenshot({ path: path.join(outputRoot, '03-after-placement.png') });

  await page.evaluate(() => window.__fw.autosave());
  report.controls.push('normal autosave');
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.getByText('Continue', { exact: true }).click();
  await waitForGame();
  report.afterReload = await transformFor(id);
  assert.deepEqual(report.afterReload, expected, 'save/reload preserves the exact committed transform');

  await aimAt(id);
  await page.keyboard.press('b');
  report.controls.push('B enter after reload');
  await page.keyboard.press('e');
  report.controls.push('E pick up after reload');
  await page.waitForFunction((objectId) => window.__fw.scene3d.clubhouse().build.diagnostics().carrying === objectId,
    id, { timeout: 20_000 });
  await page.keyboard.press('Escape');
  report.controls.push('Escape cancel move');
  await page.waitForFunction(() => !window.__fw.scene3d.clubhouse().build.isCarrying());
  report.afterCancel = await transformFor(id);
  assert.deepEqual(report.afterCancel, expected, 'cancel preserves the saved transform');
  report.finalBatch = await batchDiagnostics();
  report.selectionMatrix = [];
  for (const selectionId of ['asset-083', 'asset-087', 'asset-093']) {
    const aimed = await aimAt(selectionId);
    await page.waitForTimeout(500);
    const focusBeforePickUp = await page.evaluate(() => window.__fw.scene3d.clubhouse().build.diagnostics().focusedId);
    await page.screenshot({ path: path.join(outputRoot, `selection-${selectionId}.png`) });
    report.selectionMatrix.push({ id: selectionId, aimed, focusBeforePickUp });
    assert.equal(focusBeforePickUp, selectionId, `center-screen focus selects ${selectionId}`);
    await page.keyboard.press('e');
    report.controls.push(`E select ${selectionId}`);
    await page.waitForFunction((objectId) => (
      window.__fw.scene3d.clubhouse().build.diagnostics().carrying === objectId
    ), selectionId, { timeout: 20_000 });
    const selected = await page.evaluate(() => window.__fw.scene3d.clubhouse().build.diagnostics());
    Object.assign(report.selectionMatrix.at(-1), {
      selected: selected.carrying,
      previewLoaded: selected.previewLoaded,
    });
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !window.__fw.scene3d.clubhouse().build.isCarrying());
  }
  await page.keyboard.press('b');
  report.controls.push('B exit renovation');
  assert.equal(await page.evaluate(() => window.__fw.scene3d.clubhouse().build.isActive()), false);
  await page.screenshot({ path: path.join(outputRoot, '04-after-reload-cancel.png') });

  assert.deepEqual(consoleErrors, []);
  assert.deepEqual(pageErrors, []);
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.error = error.stack || error.message;
  process.exitCode = 1;
} finally {
  await fs.writeFile(path.join(outputRoot, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  await context.close();
  await browser.close();
}
