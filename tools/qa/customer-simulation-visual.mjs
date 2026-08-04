import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const phase = process.argv[2] || 'baseline';
const stamp = process.argv[3] || new Date().toISOString().replace(/[:.]/g, '-');
const url = process.env.GOLF_FLIPPER_URL || 'http://127.0.0.1:8463/';
const hardwareRenderer = process.env.QA_RENDERER === 'hardware';
const root = path.resolve(process.cwd(), 'qa', 'customer-simulation', phase);
const shotDir = path.join(root, 'screenshots', stamp);
const videoDir = path.join(root, 'video', stamp);
await mkdir(shotDir, { recursive: true });
await mkdir(videoDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH || undefined,
  args: hardwareRenderer
    ? []
    : ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-angle=swiftshader'],
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
const { clickThroughMenu } = await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`);
await clickThroughMenu(page);
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

const fixture = await page.evaluate(async () => {
  const app = window.__fw;
  const customerDomain = await import(new URL('src/sim/customerSimulation.js', document.baseURI).href);
  const {
    CUSTOMER_INTENT,
    CUSTOMER_STATE,
    customerSimulationOf,
    despawnCustomer,
    releaseSocket,
    transitionCustomer,
  } = customerDomain;
  const day = Math.floor(app.state.clock.minutes / 1440);
  app.state.clock.minutes = day * 1440 + 10 * 60;
  app.scene3d.applyTimeWeather(10 * 60, app.state.weather);
  app.speedIdx = 0;
  app.state.tutorial.hidden = true;

  // Each visual iteration starts with a controlled population. The live controller
  // still moves every visitor, claims every socket, opens the real door, and starts
  // the real register; this only replaces the random wait for a useful camera cast.
  const sim = customerSimulationOf(app.state);
  for (const customer of [...sim.active]) despawnCustomer(app.state, customer, { reason: 'visual QA reset' });
  sim.scheduled = [];
  sim.history = [];
  sim.serviceQueue = [];
  sim.socketClaims = {};
  sim.transitionEvents = [];
  sim.metrics = {
    spawned: 0,
    completed: 0,
    abandoned: 0,
    noShows: 0,
    recovered: 0,
    emergencyRepositions: 0,
    maxActiveObserved: 0,
    maxQueueObserved: 0,
  };
  app.state.shop.held = [];
  const inventory = app.state.shop.inventory;
  for (const id of ['balls1', 'balls2', 'tees1', 'glove1', 'cap1', 'polo1']) {
    if (inventory[id]) inventory[id].shelf = Math.max(inventory[id].shelf, 8);
  }
  const clubhouse = app.scene3d.clubhouse();
  clubhouse.rebuildStock();

  const placeInside = (intent, options, local, nextState) => {
    const actor = clubhouse.debugSpawn(false, intent, options);
    if (!actor) return null;
    releaseSocket(app.state, actor.entity);
    transitionCustomer(app.state, actor.entity, nextState, 'visual QA cast position', app.state.clock.minutes, { force: true });
    const world = { x: local.x + clubhouse.interior.position.x, z: local.z + clubhouse.interior.position.z };
    actor.entity.entered = true;
    actor.entity.position = world;
    actor.entity.maxActivities = 99;
    actor.entered = true;
    actor.mesh.position.x = world.x;
    actor.mesh.position.z = world.z;
    actor.stateSeen = null;
    return actor.id;
  };

  const exterior = clubhouse.debugSpawn(false, CUSTOMER_INTENT.PRO_SHOP_SHOPPER, { name: 'Avery Approach' });
  const exteriorStart = { x: clubhouse.interior.position.x - 5.2, z: clubhouse.interior.position.z + 15.0 };
  exterior.entity.position = exteriorStart;
  exterior.mesh.position.x = exteriorStart.x;
  exterior.mesh.position.z = exteriorStart.z;
  sim.socketClaims['exterior-arrival'] = { 'exterior-arrival-west': exterior.id };

  const cast = {
    exterior: exterior.id,
    browser: placeInside(
      CUSTOMER_INTENT.BROWSER,
      { name: 'Blake Browser', desiredSkuId: 'cap1' },
      { x: -1.1, z: 0.1 },
      CUSTOMER_STATE.CHOOSING_ACTIVITY,
    ),
    specific: placeInside(
      CUSTOMER_INTENT.SPECIFIC_ITEM,
      { name: 'Sasha Shopper', desiredSkuId: 'balls1' },
      { x: -3.4, z: -2.0 },
      CUSTOMER_STATE.CHOOSING_ACTIVITY,
    ),
    loungeA: placeInside(
      CUSTOMER_INTENT.LOUNGE_VISITOR,
      { name: 'Lee Lounge' },
      { x: 2.0, z: -3.5 },
      CUSTOMER_STATE.LOUNGE_USE,
    ),
    loungeB: placeInside(
      CUSTOMER_INTENT.LOUNGE_VISITOR,
      { name: 'Morgan Member' },
      { x: 4.7, z: -3.5 },
      CUSTOMER_STATE.LOUNGE_USE,
    ),
    register: clubhouse.sendToCounter(['balls1'], 'card'),
    queued: clubhouse.sendToCounter(['glove1', 'balls2'], 'cash'),
  };
  sim.socketClaims.ambient = {
    'lounge-chair-a': cast.loungeA,
    'lounge-chair-b': cast.loungeB,
  };
  sim.active.find((customer) => customer.id === cast.loungeA).occupancyAssignment = { socketId: 'lounge-chair-a' };
  sim.active.find((customer) => customer.id === cast.loungeB).occupancyAssignment = { socketId: 'lounge-chair-b' };
  sim.active.find((customer) => customer.id === sim.serviceQueue[1]).patienceSec = 32;
  const customers = typeof clubhouse.customers === 'function' ? clubhouse.customers() : clubhouse.customers;
  return {
    customers: customers.length,
    clock: app.state.clock.minutes,
    cast,
    diagnostics: clubhouse.customerDiagnostics ? clubhouse.customerDiagnostics() : null,
  };
});
const cameras = [];
const screenshots = [];
const takeShot = async (camera) => {
  cameras.push(camera);
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
    document.documentElement.classList.add('qa-clean-shot');
    if (!document.querySelector('#qa-clean-shot-style')) {
      const style = document.createElement('style');
      style.id = 'qa-clean-shot-style';
      style.textContent = '.qa-clean-shot .shop-lockhint,.qa-clean-shot .shop-prompt,.qa-clean-shot .toast-wrap,.qa-clean-shot .objectives-card{display:none!important}';
      document.head.append(style);
    }
    document.querySelectorAll('.toast').forEach((toast) => toast.remove());
  }, camera);
  await page.waitForTimeout(camera.settleMs ?? 700);
  const file = path.join(shotDir, `${camera.id}.png`);
  await page.screenshot({ path: file });
  screenshots.push(file);
};

await page.waitForTimeout(850);
const exteriorActor = await page.evaluate((id) => (
  window.__fw.scene3d.clubhouse().customerDiagnostics().actors.find((actor) => actor.id === id)
), fixture.cast.exterior);
await takeShot({
  id: '01-exterior-approach',
  atW: [exteriorActor.position.x + 3.1, exteriorActor.position.z + 3.8],
  toW: [exteriorActor.position.x, exteriorActor.position.z - 0.45],
  pitch: -0.035,
});
await page.evaluate((id) => {
  const actor = window.__fw.scene3d.clubhouse().customers().find((entry) => entry.id === id);
  // Keep the doorway camera deterministic on heavily contended QA hosts while
  // still exercising the real path, socket, and hinged-door controllers.
  if (actor?.entity) actor.entity.speed = 3;
}, fixture.cast.exterior);

await page.waitForFunction(() => {
  const states = window.__fw.scene3d.clubhouse().customerDiagnostics().byState;
  return [
    'Moving to display',
    'Browsing',
    'Inspecting product',
    'Selecting product',
    'Carrying product',
  ].some((state) => (states[state] || 0) > 0);
}, null, { timeout: 30_000 });
await takeShot({ id: '02-browsing-floor', at: [-2.7, -2.5], to: [-5.6, -5.7], pitch: -0.06, settleMs: 220 });

await page.waitForFunction((ids) => {
  const clubhouse = window.__fw.scene3d.clubhouse();
  const byId = new Map(clubhouse.customerDiagnostics().actors.map((actor) => [actor.id, actor]));
  const origin = clubhouse.interior.position;
  const expected = [
    { id: ids[0], x: origin.x + 3.2, z: origin.z - 5.35 },
    { id: ids[1], x: origin.x + 4.6, z: origin.z - 4.35 },
  ];
  return expected.every((seat) => {
    const actor = byId.get(seat.id);
    return actor && Math.hypot(actor.position.x - seat.x, actor.position.z - seat.z) < 0.16;
  });
}, [fixture.cast.loungeA, fixture.cast.loungeB], { timeout: 18_000 });
await takeShot({ id: '03-lounge', at: [3.85, -1.75], to: [3.85, -4.8], pitch: -0.09 });

await page.waitForFunction((id) => {
  const clubhouse = window.__fw.scene3d.clubhouse();
  const actor = clubhouse.customers().find((entry) => entry.id === id)?.entity;
  return actor && (
    ['Waiting for door', 'Entering'].includes(actor.state)
    || actor.stateHistory.some((event) => ['Waiting for door', 'Entering'].includes(event.to))
  );
}, fixture.cast.exterior, { timeout: 60_000, polling: 20 });
await page.evaluate((id) => {
  const actor = window.__fw.scene3d.clubhouse().customers().find((entry) => entry.id === id);
  if (actor?.entity) actor.entity.speed = 0.24;
}, fixture.cast.exterior);
const doorFrame = await page.evaluate((id) => {
  const clubhouse = window.__fw.scene3d.clubhouse();
  const actor = clubhouse.customerDiagnostics().actors.find((entry) => entry.id === id);
  const entity = clubhouse.customers().find((entry) => entry.id === id)?.entity;
  return {
    actor: actor.position,
    actorState: actor.state,
    entryTransitions: entity.stateHistory.filter((event) => ['Waiting for door', 'Entering'].includes(event.to)),
    door: clubhouse.doorWorld,
    mainDoor: clubhouse.doors?.[0] ? { open: clubhouse.doors[0].open, angle: clubhouse.doors[0].angle } : null,
  };
}, fixture.cast.exterior);
const doorDx = doorFrame.door.x - doorFrame.actor.x;
const doorDz = doorFrame.door.z - doorFrame.actor.z;
const doorLen = Math.hypot(doorDx, doorDz) || 1;
const doorUx = doorDx / doorLen;
const doorUz = doorDz / doorLen;
await takeShot({
  id: '04-entry-door',
  atW: [doorFrame.actor.x - doorUx * 1.7 + doorUz * 2.0, doorFrame.actor.z - doorUz * 1.7 - doorUx * 2.0],
  toW: [doorFrame.actor.x + doorUx * 0.7, doorFrame.actor.z + doorUz * 0.7],
  pitch: -0.04,
  settleMs: 140,
});

await takeShot({ id: '05-register-queue', at: [-1.7, 4.85], to: [0.7, 2.85], pitch: -0.07 });

const timeline = [];
for (let sample = 0; sample < 5; sample += 1) {
  await page.waitForTimeout(1_000);
  timeline.push(await page.evaluate(() => {
    const clubhouse = window.__fw.scene3d.clubhouse();
    const diagnostics = clubhouse.customerDiagnostics?.();
    return {
      at: window.__fw.state.clock.minutes,
      active: diagnostics?.active,
      queue: diagnostics?.queue,
      byState: diagnostics?.byState,
      recentTransitions: diagnostics?.recentTransitions?.slice(-12),
    };
  }));
}

const probe = await page.evaluate(() => {
  const app = window.__fw;
  const clubhouse = app.scene3d.clubhouse();
  const diagnostics = clubhouse.customerDiagnostics?.();
  return {
    customerDiagnostics: diagnostics,
    heldUnits: (app.state.shop.held || []).map((unit) => ({ uid: unit.uid, skuId: unit.skuId })),
    mainDoor: clubhouse.doors?.[0]
      ? { open: clubhouse.doors[0].open, angle: clubhouse.doors[0].angle }
      : null,
    checkoutStage: clubhouse.register.getTx()?.stage || null,
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
  renderer: hardwareRenderer ? 'Chrome hardware/default WebGL' : 'Chrome SwiftShader',
  normalControls: ['canvas click', 'W 350ms', 'A 250ms', 'Escape'],
  cameras,
  fixture,
  entryGate: doorFrame,
  timeline,
  screenshots,
  videoPath,
  errors,
  warnings,
  failedRequests,
  probe,
};
await writeFile(path.join(root, `visual-${stamp}.json`), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
