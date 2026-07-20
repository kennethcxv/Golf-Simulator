import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const BASE_URL = process.env.GOLF_FLIPPER_URL || 'http://127.0.0.1:8463/';
const EVIDENCE_LABEL = process.env.QA_EVIDENCE_LABEL || 'baseline';
const OUT = path.join(ROOT, 'qa', 'player-experience-polish', EVIDENCE_LABEL, 'operations');
const LOGS = path.join(ROOT, 'qa', 'player-experience-polish', 'logs');
await Promise.all([fs.mkdir(OUT, { recursive: true }), fs.mkdir(LOGS, { recursive: true })]);

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--force-color-profile=srgb', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
});
const context = await browser.newContext({
  viewport: { width: 1600, height: 900 },
  deviceScaleFactor: 1,
  locale: 'en-US',
  reducedMotion: 'no-preference',
});
await context.addInitScript(() => {
  let state = 0x5f3759df;
  Math.random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
});

const page = await context.newPage();
const messages = [];
page.on('console', (message) => messages.push({ type: message.type(), text: message.text().slice(0, 1000) }));
page.on('pageerror', (error) => messages.push({ type: 'pageerror', text: error.stack || error.message }));

async function waitForWorld() {
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 60_000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
  }, null, { timeout: 60_000 });
  await page.waitForTimeout(1_000);
}

async function shot(name) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`), animations: 'disabled' });
}

// Create the shared deterministic save through the real menu and property market.
await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
await page.locator('.menu-screen .menu-action').filter({ hasText: /^New game/ }).click();
await page.getByRole('dialog', { name: 'New game' }).waitFor();
await page.locator('.difficulty-card').filter({ hasText: /^Relaxed/ }).click();
await page.getByRole('heading', { name: 'Property market' }).waitFor();
await page.getByRole('button', { name: 'Buy', exact: true }).first().click();
await waitForWorld();
await page.evaluate(() => window.__fw.autosave());

const result = { delivery: null, cleaning: {}, placement: {}, frontDesk: {}, maintenance: {} };

// Delivery, box cutter, flaps, armful, and stocking are already encoded in the
// repository's normal-control QA route. Configure only its URL and output path.
const deliverySource = await fs.readFile(path.join(ROOT, 'tools', 'qa', 'delivery-loop.js'), 'utf8');
const deliveryOut = OUT.replaceAll('\\', '/');
const configuredDelivery = deliverySource
  .replace("const OUT = 'C:/Users/Kenneth/Documents/GitHub/Golf-Flipper/qa/delivery';", `const OUT = '${deliveryOut}';`)
  .replaceAll('http://localhost:8457/', BASE_URL);
try {
  result.delivery = await (0, eval)(configuredDelivery)(page);
} catch (error) {
  await shot('delivery-failure');
  result.delivery = { failed: true, error: error.stack || error.message };
}

// Haul one real clutter pile with E.
const clutterCandidates = await page.evaluate(() => {
  const app = window.__fw;
  return app.state.shop.reno.clutter
    .filter((entry) => !entry.cleared)
    .map(({ x, z }) => ({ x, z }));
});
let selectedClutter = null;
const clutterPoses = [
  { dx: 0, dz: 1.3, yaw: 0 },
  { dx: 0, dz: -1.3, yaw: Math.PI },
  { dx: 1.3, dz: 0, yaw: Math.PI / 2 },
  { dx: -1.3, dz: 0, yaw: -Math.PI / 2 },
];
for (const pile of clutterCandidates) {
  for (const pose of clutterPoses) {
    await page.evaluate(({ target, camera }) => {
      const app = window.__fw;
      const origin = app.scene3d.clubhouse().interior.position;
      const walk = app.scene3d.walk;
      walk.clearKeys();
      walk.setTool(null);
      walk.state.x = origin.x + target.x + camera.dx;
      walk.state.z = origin.z + target.z + camera.dz;
      walk.state.yaw = camera.yaw;
      walk.state.pitch = -0.08;
    }, { target: pile, camera: pose });
    await page.waitForTimeout(160);
    const label = await page.evaluate(() => window.__fw.scene3d.walk.getFocusLabel?.() || null);
    if (label?.includes('Old clutter')) {
      selectedClutter = { ...pile, pose, label };
      break;
    }
  }
  if (selectedClutter) break;
}
result.cleaning.clutterBefore = await page.evaluate((selection) => {
  const app = window.__fw;
  const walk = app.scene3d.walk;
  return {
    x: selection?.x ?? null,
    z: selection?.z ?? null,
    pose: selection?.pose ?? null,
    uncleared: app.state.shop.reno.clutter.filter((entry) => !entry.cleared).length,
    walkActive: walk.isActive(),
  };
}, selectedClutter);
result.cleaning.clutterPrompt = await page.evaluate(() => window.__fw.scene3d.walk.getFocusLabel?.() || null);
await shot('10-cleaning-clutter-before');
await page.keyboard.press('e');
await page.waitForTimeout(500);
result.cleaning.clutterAfter = await page.evaluate(() => ({
  uncleared: window.__fw.state.shop.reno.clutter.filter((entry) => !entry.cleared).length,
  prompt: window.__fw.scene3d.walk.getFocusLabel?.() || null,
}));
await shot('11-cleaning-clutter-after');

// Give the player the game's own vacuum item, equip with F, and hold the normal
// use trigger over a dirty floor patch.
const grimeBefore = await page.evaluate(() => {
  const app = window.__fw;
  app.state.shop.inventory.vac1.back = Math.max(1, app.state.shop.inventory.vac1.back);
  const walk = app.scene3d.walk;
  walk.clearKeys();
  walk.setTool(null);
  walk.state.x = -8;
  walk.state.z = 229.8;
  walk.state.yaw = 0;
  walk.state.pitch = -0.55;
  return app.state.shop.reno.grime.reduce((sum, value) => sum + value, 0);
});
await page.keyboard.press('f');
await page.waitForTimeout(500);
result.cleaning.vacuumPrompt = await page.evaluate(() => window.__fw.scene3d.walk.getFocusLabel?.() || null);
await shot('12-cleaning-vacuum-equipped');
await page.mouse.move(800, 450);
await page.mouse.down();
await page.waitForTimeout(1_200);
await page.mouse.up();
await page.waitForTimeout(250);
const grimeAfter = await page.evaluate(() => window.__fw.state.shop.reno.grime.reduce((sum, value) => sum + value, 0));
result.cleaning.vacuum = { grimeBefore, grimeAfter, cleaned: grimeBefore - grimeAfter };
await shot('13-cleaning-vacuum-after');

// Move an existing fixture through Build Mode. Camera placement is a fixture;
// B/E/R/E are the actual controls that enter, pick up, rotate, and place it.
const placementFixture = await page.evaluate(async () => {
  const app = window.__fw;
  const layout = await import('/src/sim/layout.js');
  const origin = app.scene3d.clubhouse().interior.position;
  const fixtures = layout.placedFixtures(app.state);
  const fixture = fixtures.find((entry) => !entry.stored);
  if (!fixture) return null;
  let destination = null;
  for (let z = -4; z <= 4 && !destination; z += layout.GRID) {
    for (let x = -8; x <= 8; x += layout.GRID) {
      if (Math.hypot(x - fixture.x, z - fixture.z) < 2) continue;
      const valid = layout.validatePlacement(app.state, fixture.id, x, z, fixture.ry || 0);
      if (valid.ok) { destination = { x, z }; break; }
    }
  }
  const walk = app.scene3d.walk;
  walk.clearKeys();
  walk.setTool(null);
  walk.state.x = origin.x + fixture.x;
  walk.state.z = origin.z + fixture.z + 2.4;
  walk.state.yaw = 0;
  walk.state.pitch = -0.6;
  return { id: fixture.id, title: fixture.title || fixture.kind, from: { x: fixture.x, z: fixture.z }, destination };
});
result.placement.fixture = placementFixture;
if (placementFixture?.destination) {
  await page.keyboard.press('b');
  await page.waitForTimeout(350);
  result.placement.enterPrompt = await page.locator('.shop-prompt').textContent();
  await shot('14-placement-mode');
  await page.keyboard.press('e');
  await page.waitForTimeout(350);
  result.placement.carrying = await page.evaluate(() => window.__fw.scene3d.clubhouse().build.isCarrying());
  await shot('15-placement-carrying');
  await page.keyboard.press('r');
  await page.evaluate((destination) => {
    const app = window.__fw;
    const origin = app.scene3d.clubhouse().interior.position;
    const walk = app.scene3d.walk;
    walk.state.x = origin.x + destination.x;
    walk.state.z = origin.z + destination.z + 2.4;
    walk.state.yaw = 0;
    walk.state.pitch = -0.6;
  }, placementFixture.destination);
  await page.waitForTimeout(350);
  result.placement.placePrompt = await page.locator('.shop-prompt').textContent();
  await page.keyboard.press('e');
  await page.waitForTimeout(500);
  result.placement.placed = await page.evaluate((id) => {
    const moved = window.__fw.state.shop.layout.moved[id];
    return moved ? { x: moved.x, z: moved.z, ry: moved.ry } : null;
  }, placementFixture.id);
  result.placement.autoExited = await page.evaluate(() => !window.__fw.scene3d.clubhouse().build.isActive());
  await shot('16-placement-complete');
  if (!result.placement.autoExited) await page.keyboard.press('b');
}

// Book a due tee time through the reservation simulation, then perform the
// counter check-in with the register's normal E interaction.
result.frontDesk.before = await page.evaluate(async () => {
  const app = window.__fw;
  const reservations = await import('/src/sim/reservations.js');
  const time = await import('/src/sim/time.js');
  const cal = time.calendarOf(app.state.clock.minutes);
  app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440 + 8 * 60;
  const booked = reservations.bookSlot(app.state, cal.dayAbs, 8 * 60 + 30, 'Morgan Lee');
  const walk = app.scene3d.walk;
  walk.clearKeys();
  walk.setTool(null);
  walk.state.x = 2.8 - 8;
  walk.state.z = 5.1 + 228;
  walk.state.yaw = 0;
  walk.state.pitch = -0.18;
  return { booked, cash: app.state.cash };
});
await page.waitForTimeout(700);
result.frontDesk.prompt = await page.evaluate(() => window.__fw.scene3d.walk.getFocusLabel?.() || null);
await shot('17-front-desk-checkin-before');
await page.keyboard.press('e');
await page.waitForTimeout(600);
result.frontDesk.after = await page.evaluate(() => ({
  reservation: window.__fw.state.reservations.booked.find((entry) => entry.name === 'Morgan Lee') || null,
  cash: window.__fw.state.cash,
}));
await shot('18-front-desk-checkin-after');

// Course maintenance: pause the simulation with the normal Space control so
// whole-course evaporation cannot hide the local gain, then choose a real
// fairway cell, cycle to the hose with F, and hold the mouse trigger.
const maintenanceSpeedBefore = await page.evaluate(() => window.__fw.speedIdx);
if (maintenanceSpeedBefore !== 0) await page.keyboard.press('Space');
result.maintenance.clockPaused = await page.evaluate(() => window.__fw.speedIdx === 0);
result.maintenance.before = await page.evaluate(async () => {
  const app = window.__fw;
  const constants = await import('/src/sim/constants.js');
  const section = app.state.sections.find((entry) => entry.cells?.length);
  const index = section.cells[Math.floor(section.cells.length / 2)];
  const x = index % app.state.course.w;
  const y = Math.floor(index / app.state.course.w);
  const worldW = app.state.course.w * constants.CELL_YD;
  const worldH = app.state.course.h * constants.CELL_YD;
  const targetX = (x + 0.5) * constants.CELL_YD - worldW / 2;
  const targetZ = (y + 0.5) * constants.CELL_YD - worldH / 2;
  const walk = app.scene3d.walk;
  walk.clearKeys();
  walk.setTool(null);
  walk.state.x = targetX;
  walk.state.z = targetZ + 2.5;
  walk.state.yaw = 0;
  walk.state.pitch = -0.45;
  const moisture = Array.from(app.state.turf.moisture).reduce((sum, value) => sum + value, 0);
  return { cell: { x, y, index }, moisture, cellMoisture: app.state.turf.moisture[index] };
});
for (let guard = 0; guard < 6; guard++) {
  if (await page.evaluate(() => window.__fw.scene3d.walk.getTool() === 'hose')) break;
  await page.keyboard.press('f');
  await page.waitForTimeout(180);
}
result.maintenance.tool = await page.evaluate(() => window.__fw.scene3d.walk.getTool());
result.maintenance.prompt = await page.evaluate(() => window.__fw.scene3d.walk.getFocusLabel?.() || null);
await shot('19-course-maintenance-hose');
await page.mouse.move(800, 450);
await page.mouse.down();
await page.waitForTimeout(1_200);
await page.mouse.up();
await page.waitForTimeout(250);
result.maintenance.after = await page.evaluate((index) => ({
  moisture: Array.from(window.__fw.state.turf.moisture).reduce((sum, value) => sum + value, 0),
  cellMoisture: window.__fw.state.turf.moisture[index],
  tool: window.__fw.scene3d.walk.getTool(),
}), result.maintenance.before.cell.index);
await shot('20-course-maintenance-after');
if (maintenanceSpeedBefore !== 0) await page.keyboard.press('Space');

result.runtime = {
  consoleErrors: messages.filter((entry) => entry.type === 'error'),
  pageErrors: messages.filter((entry) => entry.type === 'pageerror'),
  warnings: messages.filter((entry) => entry.type === 'warning'),
};
await fs.writeFile(path.join(OUT, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
await fs.writeFile(path.join(LOGS, `${EVIDENCE_LABEL}-operations-browser.json`), `${JSON.stringify(messages, null, 2)}\n`);
await browser.close();

console.log(JSON.stringify({
  deliveryFailed: !!result.delivery?.failed,
  clutterCleared: result.cleaning.clutterAfter?.uncleared < result.cleaning.clutterBefore?.uncleared,
  vacuumCleaned: result.cleaning.vacuum?.cleaned,
  placement: result.placement.placed,
  frontDeskStatus: result.frontDesk.after?.reservation?.status,
  maintenanceMoistureDelta: result.maintenance.after?.cellMoisture - result.maintenance.before?.cellMoisture,
  consoleErrors: result.runtime.consoleErrors.length,
  pageErrors: result.runtime.pageErrors.length,
}, null, 2));
