import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const phase = process.argv[2] || 'baseline';
const stamp = process.argv[3] || new Date().toISOString().replace(/[:.]/g, '-');
const url = process.env.GOLF_FLIPPER_URL || 'http://127.0.0.1:8463/';
const root = path.resolve(process.cwd(), 'qa', 'customer-simulation', phase);
const shotDir = path.join(root, 'screenshots', stamp);
const videoDir = path.join(root, 'video', stamp);
await mkdir(shotDir, { recursive: true });
await mkdir(videoDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-angle=swiftshader'],
});
const context = await browser.newContext({
  viewport: { width: 1600, height: 900 },
  deviceScaleFactor: 1,
  recordVideo: { dir: videoDir, size: { width: 1600, height: 900 } },
});

await context.addInitScript(() => {
  const stats = { adds: 0, removes: 0, active: 0, byType: {} };
  const registry = new WeakMap();
  const add = EventTarget.prototype.addEventListener;
  const remove = EventTarget.prototype.removeEventListener;
  const captureOf = (opts) => (typeof opts === 'boolean' ? opts : !!(opts && opts.capture));

  EventTarget.prototype.addEventListener = function trackedAdd(type, listener, opts) {
    if (listener) {
      let byKey = registry.get(this);
      if (!byKey) {
        byKey = new Map();
        registry.set(this, byKey);
      }
      const key = `${String(type)}|${captureOf(opts)}`;
      let listeners = byKey.get(key);
      if (!listeners) {
        listeners = new Set();
        byKey.set(key, listeners);
      }
      if (!listeners.has(listener)) {
        listeners.add(listener);
        stats.adds += 1;
        stats.active += 1;
        stats.byType[type] = (stats.byType[type] || 0) + 1;
      }
    }
    return add.call(this, type, listener, opts);
  };

  EventTarget.prototype.removeEventListener = function trackedRemove(type, listener, opts) {
    const byKey = registry.get(this);
    const key = `${String(type)}|${captureOf(opts)}`;
    const listeners = byKey && byKey.get(key);
    if (listeners && listeners.delete(listener)) {
      stats.removes += 1;
      stats.active -= 1;
      stats.byType[type] = Math.max(0, (stats.byType[type] || 0) - 1);
    }
    return remove.call(this, type, listener, opts);
  };

  window.__qaListenerStats = stats;
  window.__qaUiMutations = 0;
  add.call(document, 'DOMContentLoaded', () => {
    const observer = new MutationObserver((records) => {
      window.__qaUiMutations += records.length;
    });
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
    window.__qaUiObserver = observer;
  }, { once: true });
});

const page = await context.newPage();
const errors = [];
const warnings = [];
const failedRequests = [];
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
  if (message.type() === 'warning') warnings.push(message.text());
});
page.on('pageerror', (error) => errors.push(`PAGEERROR: ${error.message}`));
page.on('requestfailed', (request) => {
  failedRequests.push(`${request.url()} :: ${request.failure()?.errorText || 'failed'}`);
});

await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(900);
const continueButton = page.getByText('Continue', { exact: true });
if (await continueButton.count() && await continueButton.isEnabled()) {
  await continueButton.click();
} else {
  await page.getByText('New Empire — Relaxed', { exact: true }).click();
  await page.getByRole('button', { name: 'Buy', exact: true }).first().click();
}
await page.waitForFunction(() => (
  window.__fw
  && window.__fw.scene3d
  && window.__fw.scene3d.clubhouse
  && window.__fw.scene3d.clubhouse()
), null, { timeout: 40_000 });
await page.waitForFunction(() => {
  const veil = document.querySelector('.load-veil');
  return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
}, null, { timeout: 40_000 });
await page.waitForTimeout(1_200);

// Normal-control smoke before the fixed camera fixture.
await page.locator('canvas').first().click({ position: { x: 800, y: 450 } }).catch(() => {});
await page.keyboard.down('w');
await page.waitForTimeout(350);
await page.keyboard.up('w');
await page.keyboard.down('a');
await page.waitForTimeout(250);
await page.keyboard.up('a');
await page.keyboard.press('Escape');
const resumeButton = page.getByText('Resume', { exact: true });
if (await resumeButton.count() && await resumeButton.isVisible()) await resumeButton.click();

const fixture = await page.evaluate(() => {
  const app = window.__fw;
  const day = Math.floor(app.state.clock.minutes / 1440);
  app.state.clock.minutes = day * 1440 + 10 * 60;
  app.scene3d.applyTimeWeather(10 * 60, app.state.weather);
  const inventory = app.state.shop.inventory;
  for (const id of ['balls1', 'balls2', 'tees1', 'glove1', 'cap1', 'polo1']) {
    if (inventory[id]) inventory[id].shelf = Math.max(inventory[id].shelf, 8);
  }
  const clubhouse = app.scene3d.clubhouse();
  clubhouse.rebuildStock();
  for (let i = 0; i < 5; i += 1) clubhouse.debugSpawn(false);
  clubhouse.sendToCounter(['balls1'], 'card');
  const customers = typeof clubhouse.customers === 'function' ? clubhouse.customers() : clubhouse.customers;
  return { customers: customers.length, clock: app.state.clock.minutes };
});
await page.waitForTimeout(8_500);

const cameras = [
  { id: '01-exterior-approach', atW: [-1.5, 243.5], toW: [-8.8, 234.4], pitch: -0.02 },
  { id: '02-entry-door', at: [-0.8, 3.9], to: [-0.8, 6.1], pitch: -0.03 },
  { id: '03-browsing-floor', at: [-3.6, 2.8], to: [-5.5, -0.2], pitch: -0.04 },
  { id: '04-register-queue', at: [0.2, 1.7], to: [2.8, 4.6], pitch: -0.07 },
  { id: '05-lounge', at: [1.2, -3.1], to: [4.2, -5.2], pitch: -0.04 },
];

const screenshots = [];
for (const camera of cameras) {
  await page.evaluate((shot) => {
    const app = window.__fw;
    const convert = (point, world) => (world
      ? { x: point[0], z: point[1] }
      : { x: point[0] - 8, z: point[1] + 228 });
    const at = convert(shot.atW || shot.at, !!shot.atW);
    const to = convert(shot.toW || shot.to, !!shot.toW);
    const walk = app.scene3d.walk.state;
    app.scene3d.walk.clearKeys();
    walk.x = at.x;
    walk.z = at.z;
    const dx = to.x - at.x;
    const dz = to.z - at.z;
    const distance = Math.hypot(dx, dz) || 1;
    walk.yaw = Math.atan2(-dx / distance, -dz / distance);
    walk.pitch = shot.pitch;
    const day = Math.floor(app.state.clock.minutes / 1440);
    app.state.clock.minutes = day * 1440 + 10 * 60;
    app.scene3d.applyTimeWeather(10 * 60, app.state.weather);
  }, camera);
  await page.waitForTimeout(700);
  const file = path.join(shotDir, `${camera.id}.png`);
  await page.screenshot({ path: file });
  screenshots.push(file);
}

const probe = await page.evaluate(() => {
  const app = window.__fw;
  const clubhouse = app.scene3d.clubhouse();
  const customers = typeof clubhouse.customers === 'function' ? clubhouse.customers() : clubhouse.customers;
  return {
    customers: customers.map((customer) => ({
      name: customer.name,
      currentStop: customer.stops?.[customer.stopIdx]?.kind || null,
      queued: !!customer.queued,
      cart: customer.cart?.length || 0,
      awaitingCheckout: !!customer.awaitingCheckout,
      stuckSec: customer.stuckT || 0,
    })),
    listenerStats: window.__qaListenerStats,
    uiMutations: window.__qaUiMutations,
    renderer: {
      drawCalls: app.scene3d.renderer.info.render.calls,
      triangles: app.scene3d.renderer.info.render.triangles,
      geometries: app.scene3d.renderer.info.memory.geometries,
      textures: app.scene3d.renderer.info.memory.textures,
    },
  };
});

const video = page.video();
await page.close();
const videoPath = video ? await video.path() : null;
await context.close();
await browser.close();

const report = {
  phase,
  stamp,
  url,
  viewport: { width: 1600, height: 900, deviceScaleFactor: 1 },
  fixedTime: '10:00 AM',
  normalControls: ['canvas click', 'W 350ms', 'A 250ms', 'Escape'],
  cameras,
  fixture,
  screenshots,
  videoPath,
  errors,
  warnings,
  failedRequests,
  probe,
};
await writeFile(path.join(root, `visual-${stamp}.json`), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
