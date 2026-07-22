import { chromium } from 'playwright-core';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const PASS = process.argv.find((arg) => arg.startsWith('--pass='))?.slice(7) || 'baseline';
const PORT = Number(process.argv.find((arg) => arg.startsWith('--port='))?.slice(7) || 8457);
const VIDEO = process.argv.includes('--video');
const RENOVATED = process.argv.includes('--renovated');
const HARDWARE = process.argv.includes('--hardware');
const REQUESTED_CUSTOMERS = Number(process.argv.find((arg) => arg.startsWith('--customers='))?.slice(12) || 0);
const PERF_IDLE_SECONDS = Number(process.argv.find((arg) => arg.startsWith('--perf-idle='))?.slice(12) || 6);
const PERF_WALK_SECONDS = Number(process.argv.find((arg) => arg.startsWith('--perf-walk='))?.slice(12) || 4);
const PERF_SAMPLES = Number(process.argv.find((arg) => arg.startsWith('--samples='))?.slice(10) || 1);
const LAPTOP_CYCLES = Number(process.argv.find((arg) => arg.startsWith('--laptop-cycles='))?.slice(16) || 0);
const CAPTURE = !process.argv.includes('--perf-only');
const PERFORMANCE = !process.argv.includes('--capture-only');
const CAPTURE_START = CAPTURE && !process.argv.includes('--full-only');
const CAPTURE_FULL = CAPTURE && !process.argv.includes('--start-only');
const OUT = path.join(ROOT, 'qa', 'pro-shop-overhaul', PASS);
const BASE_URL = `http://localhost:${PORT}/`;
const VIEWPORT = { width: 1600, height: 900 };
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const ALL_SHOTS = [
  { id: '01-entrance', at: [-0.8, 5.2], to: [-1.2, -2.0], pitch: -0.05 },
  { id: '02-checkout-customer', at: [0.5, 2.3], to: [2.9, 4.5], pitch: -0.10 },
  { id: '03-checkout-employee', at: [2.8, 5.1], to: [2.7, 4.0], pitch: -0.18 },
  { id: '04-center-aisle', at: [-0.8, 2.4], to: [-0.8, -5.4], pitch: -0.03 },
  { id: '05-club-displays', at: [-4.9, -0.2], to: [-9.9, -0.4], pitch: 0.02 },
  { id: '06-clothing', at: [-3.2, 4.0], to: [-5.0, 0.2], pitch: -0.03 },
  { id: '07-shoes', at: [1.65, 0.55], to: [5.0, -0.65], pitch: -0.05 },
  { id: '08-hats', at: [-0.2, -3.8], to: [1.55, -5.9], pitch: -0.03 },
  { id: '09-bags', at: [-0.75, -0.55], to: [2.15, -2.65], pitch: -0.05 },
  { id: '10-accessories', at: [-3.7, -2.9], to: [-3.7, -6.15], pitch: 0.01 },
  { id: '11-snacks-drinks', at: [3.55, 3.72], to: [4.60, 1.35], pitch: -0.07 },
  { id: '12-office', at: [7.2, 4.3], to: [9.55, 4.5], pitch: -0.06 },
  { id: '13-stockroom', at: [7.4, -2.3], to: [8.1, -5.9], pitch: -0.04 },
  { id: '14-fitting-area', at: [0.75, -0.1], to: [4.45, -2.05], pitch: -0.04 },
  { id: '15-lounge', at: [1.0, -3.8], to: [4.9, -5.2], pitch: -0.03 },
  { id: '16-exterior-window', world: true, at: [-1.5, 243.5], to: [-8.5, 231.0], pitch: 0.03 },
  { id: '17-putting-studio', at: [-3.0, 3.15], to: [-6.5, 4.95], pitch: -0.13 },
  { id: '18-tour-vault', at: [1.75, -3.6], to: [5.15, -5.15], pitch: -0.05 },
];
const shotArg = process.argv.find((arg) => arg.startsWith('--shots='))?.slice(8);
const shotIds = shotArg ? new Set(shotArg.split(',').map((id) => id.trim())) : null;
const SHOTS = shotIds ? ALL_SHOTS.filter((shot) => shotIds.has(shot.id)) : ALL_SHOTS;
if (!SHOTS.length) throw new Error(`No fixed cameras matched --shots=${shotArg}`);

await mkdir(OUT, { recursive: true });
await mkdir(path.join(OUT, 'starting-state'), { recursive: true });
await mkdir(path.join(OUT, 'fully-stocked'), { recursive: true });
await mkdir(path.join(OUT, 'customer-flow'), { recursive: true });
await mkdir(path.join(OUT, 'video'), { recursive: true });

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: [HARDWARE ? '--use-angle=d3d11' : '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
});

const context = await browser.newContext({
  viewport: VIEWPORT,
  deviceScaleFactor: 1,
  recordVideo: VIDEO ? { dir: path.join(OUT, 'video'), size: VIEWPORT } : undefined,
});

await context.addInitScript(() => {
  const registrations = [];
  const adds = new Map();
  const removes = new Map();
  const originalAdd = EventTarget.prototype.addEventListener;
  const originalRemove = EventTarget.prototype.removeEventListener;
  EventTarget.prototype.addEventListener = function trackedAdd(type, listener, options) {
    adds.set(type, (adds.get(type) || 0) + 1);
    if (listener && typeof WeakRef !== 'undefined') {
      registrations.push({
        target: new WeakRef(this),
        listener: new WeakRef(listener),
        type,
        capture: typeof options === 'boolean' ? options : !!options?.capture,
        removed: false,
      });
    }
    return originalAdd.call(this, type, listener, options);
  };
  EventTarget.prototype.removeEventListener = function trackedRemove(type, listener, options) {
    removes.set(type, (removes.get(type) || 0) + 1);
    const capture = typeof options === 'boolean' ? options : !!options?.capture;
    for (let index = registrations.length - 1; index >= 0; index--) {
      const registration = registrations[index];
      if (!registration.removed && registration.type === type && registration.capture === capture
        && registration.target.deref() === this && registration.listener.deref() === listener) {
        registration.removed = true;
        break;
      }
    }
    return originalRemove.call(this, type, listener, options);
  };
  window.__qaListeners = {
    snapshot() {
      const object = (map) => Object.fromEntries([...map.entries()].sort(([a], [b]) => a.localeCompare(b)));
      const active = new Map();
      for (const registration of registrations) {
        if (registration.removed || !registration.listener.deref()) continue;
        const target = registration.target.deref();
        if (!target) continue;
        const activeTarget = !(target instanceof Node) || target.isConnected
          || target instanceof HTMLCanvasElement;
        if (activeTarget) active.set(registration.type, (active.get(registration.type) || 0) + 1);
      }
      return { active: object(active), adds: object(adds), removes: object(removes) };
    },
  };
});

const page = await context.newPage();
const consoleMessages = [];
const failedRequests = [];
page.on('console', (message) => {
  if (['warning', 'error'].includes(message.type())) {
    consoleMessages.push({ type: message.type(), text: message.text() });
  }
});
page.on('pageerror', (error) => consoleMessages.push({ type: 'pageerror', text: error.message }));
page.on('response', (response) => {
  if (response.status() >= 400) failedRequests.push({ status: response.status(), url: response.url() });
});
page.on('requestfailed', (request) => failedRequests.push({ error: request.failure()?.errorText, url: request.url() }));

async function bootThroughNormalUi() {
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  const continueButton = page.getByRole('button', { name: 'Continue', exact: true });
  if (await continueButton.isEnabled().catch(() => false)) {
    throw new Error('Acceptance capture requires an isolated fresh browser context; Continue was unexpectedly enabled');
  }
  await page.getByRole('button', { name: /New Empire.*Relaxed/ }).click();
  await page.getByRole('heading', { name: 'PROPERTY MARKET' }).waitFor();
  await page.getByRole('button', { name: 'Buy', exact: true }).first().click();
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 60_000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
  }, null, { timeout: 60_000 });
  // This is the same visible close control a keyboard player uses. The game
  // canvas continually reacquires the mouse while walking, so focus the real
  // button and activate it with Enter instead of mutating tutorial state.
  const guideClose = page.locator('button[title="Hide the guide"]');
  await guideClose.press('Enter');
  await page.locator('.objectives-card').waitFor({ state: 'hidden', timeout: 5_000 });
  await page.waitForTimeout(2_500);
}

async function proveNormalControls() {
  const before = await page.evaluate(() => {
    const walk = window.__fw.scene3d.walk.state;
    return { x: walk.x, z: walk.z, yaw: walk.yaw };
  });
  await page.locator('canvas').click({ position: { x: 800, y: 450 } });
  await page.keyboard.down('ArrowLeft');
  await page.waitForTimeout(240);
  await page.keyboard.up('ArrowLeft');
  await page.keyboard.down('w');
  await page.waitForTimeout(850);
  await page.keyboard.up('w');
  const after = await page.evaluate(() => {
    const walk = window.__fw.scene3d.walk.state;
    return { x: walk.x, z: walk.z, yaw: walk.yaw };
  });
  const distance = Math.hypot(after.x - before.x, after.z - before.z);
  if (distance < 0.25) throw new Error(`Normal-control proof moved only ${distance.toFixed(2)} yards`);
  return {
    input: ['canvas click', 'ArrowLeft', 'W'],
    before,
    after,
    playerTravelYards: +distance.toFixed(2),
    yawDeltaRadians: +(after.yaw - before.yaw).toFixed(3),
  };
}

async function pauseClockThroughNormalControl() {
  const before = await page.evaluate(() => ({
    speedIdx: window.__fw.speedIdx,
    minutes: window.__fw.state.clock.minutes,
  }));
  if (before.speedIdx !== 0) await page.keyboard.press('Space');
  await page.waitForTimeout(900);
  const after = await page.evaluate(() => ({
    speedIdx: window.__fw.speedIdx,
    minutes: window.__fw.state.clock.minutes,
  }));
  if (after.speedIdx !== 0) throw new Error('Space did not pause the simulation clock');
  return {
    input: before.speedIdx === 0 ? [] : ['Space'],
    before,
    after,
    driftMinutes: +(after.minutes - before.minutes).toFixed(3),
  };
}

async function setCamera(shot) {
  await page.evaluate((pose) => {
    const app = window.__fw;
    const offset = app.scene3d.clubhouse().interior.position;
    const world = ([x, z]) => pose.world ? { x, z } : { x: x + offset.x, z: z + offset.z };
    const at = world(pose.at);
    const to = world(pose.to);
    const state = app.scene3d.walk.state;
    app.scene3d.walk.clearKeys();
    state.x = at.x;
    state.z = at.z;
    const dx = to.x - at.x;
    const dz = to.z - at.z;
    const distance = Math.hypot(dx, dz) || 1;
    state.yaw = Math.atan2(-dx / distance, -dz / distance);
    state.pitch = pose.pitch;
    const clock = app.state.clock;
    clock.minutes = Math.floor(clock.minutes / 1440) * 1440 + 14 * 60;
    app.scene3d.applyTimeWeather(14 * 60, app.state.weather);
  }, shot);
  await page.waitForTimeout(650);
}

async function captureSet(folder) {
  for (const shot of SHOTS) {
    await setCamera(shot);
    await page.screenshot({
      path: path.join(OUT, folder, `${shot.id}.jpg`),
      type: 'jpeg',
      quality: 86,
    });
  }
}

async function setStock(mode, tier) {
  return page.evaluate(async ({ mode: stockMode, tier: shopTier, renovated }) => {
    const { capacityOf } = await import('/src/data/fixtureSlots.js');
    const { skuById, RETAIL_CATS } = await import('/src/data/shopItems.js');
    const app = window.__fw;
    app.state.shop.unlockedTier = shopTier;
    if (renovated && stockMode === 'full' && app.state.shop.reno) {
      app.state.shop.reno.grime.fill(0);
      for (const pile of app.state.shop.reno.clutter) pile.cleared = true;
      app.scene3d.clubhouse().rebuildReno();
    }
    let lines = 0;
    let units = 0;
    for (const [id, inventory] of Object.entries(app.state.shop.inventory)) {
      const sku = skuById(id);
      if (!sku || !RETAIL_CATS.has(sku.cat)) continue;
      inventory.shelf = stockMode === 'full' && sku.tier <= shopTier ? capacityOf(id) : 0;
      inventory.back = 0;
      lines += inventory.shelf > 0 ? 1 : 0;
      units += inventory.shelf;
    }
    app.scene3d.clubhouse().rebuildStock();
    return { tier: shopTier, lines, units };
  }, { mode, tier, renovated: RENOVATED });
}

async function measureFrames(label, seconds = 6) {
  await page.evaluate(({ label: scenario, seconds: duration }) => {
    const root = document.querySelector('.shop-overlay') || document.body;
    const sample = {
      label: scenario,
      duration,
      deltas: [],
      drawCalls: [],
      drawnTriangles: [],
      uiMutations: 0,
      running: true,
      previous: performance.now(),
      previousCalls: 0,
      previousTriangles: 0,
    };
    const observer = new MutationObserver((records) => { sample.uiMutations += records.length; });
    observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true });
    sample.observer = observer;
    const renderer = window.__fw.scene3d.renderer;
    renderer.info.autoReset = false;
    renderer.info.reset();
    function frame(now) {
      if (!sample.running) return;
      sample.deltas.push(now - sample.previous);
      sample.previous = now;
      const calls = renderer.info.render.calls;
      const triangles = renderer.info.render.triangles;
      sample.drawCalls.push(calls - sample.previousCalls);
      sample.drawnTriangles.push(triangles - sample.previousTriangles);
      sample.previousCalls = calls;
      sample.previousTriangles = triangles;
      requestAnimationFrame(frame);
    }
    window.__qaPerfSample = sample;
    requestAnimationFrame(frame);
  }, { label, seconds });

  await page.waitForTimeout(seconds * 1_000);

  return page.evaluate(() => {
    const sample = window.__qaPerfSample;
    sample.running = false;
    sample.observer.disconnect();
    const scene3d = window.__fw.scene3d;
    const renderer = scene3d.renderer;
    renderer.info.autoReset = true;
    const sorted = sample.deltas.slice(1).sort((a, b) => a - b);
    const averageMs = sorted.reduce((sum, value) => sum + value, 0) / Math.max(1, sorted.length);
    const p99Ms = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))] || 0;
    const worstMs = sorted.at(-1) || 0;
    const drawSamples = sample.drawCalls.slice(1).filter((value) => value > 0);
    const triangleSamples = sample.drawnTriangles.slice(1).filter((value) => value > 0);
    const average = (values) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);

    let visibleMeshes = 0;
    let sceneTriangles = 0;
    const materials = new Set();
    const textures = new Set();
    scene3d.scene.traverse((object) => {
      if (!object.isMesh || !object.visible) return;
      visibleMeshes++;
      const geometry = object.geometry;
      const triangles = geometry?.index
        ? geometry.index.count / 3
        : (geometry?.attributes?.position?.count || 0) / 3;
      sceneTriangles += triangles * (object.isInstancedMesh ? object.count : 1);
      for (const material of (Array.isArray(object.material) ? object.material : [object.material])) {
        if (!material) continue;
        materials.add(material.uuid);
        for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap']) {
          if (material[key]) textures.add(material[key]);
        }
      }
    });
    let estimatedTextureBytes = 0;
    for (const texture of textures) {
      const image = texture.image;
      const width = image?.videoWidth || image?.naturalWidth || image?.width || 0;
      const height = image?.videoHeight || image?.naturalHeight || image?.height || 0;
      estimatedTextureBytes += width * height * 4 * (texture.generateMipmaps === false ? 1 : 4 / 3);
    }
    const listenerSnapshot = window.__qaListeners.snapshot();
    const activeListenerCount = Object.values(listenerSnapshot.active).reduce((sum, count) => sum + count, 0);
    return {
      label: sample.label,
      durationSeconds: sample.duration,
      sampledFrames: sorted.length,
      averageFps: averageMs ? +(1000 / averageMs).toFixed(2) : 0,
      onePercentLowFps: p99Ms ? +(1000 / p99Ms).toFixed(2) : 0,
      worstFrameMs: +worstMs.toFixed(2),
      drawCallsPerFrame: +average(drawSamples).toFixed(2),
      trianglesDrawnPerFrame: +average(triangleSamples).toFixed(2),
      visibleMeshes,
      sceneTriangles: Math.round(sceneTriangles),
      uniqueMaterials: materials.size,
      uniqueTextures: textures.size,
      estimatedTextureMemoryMiB: +(estimatedTextureBytes / 1024 / 1024).toFixed(2),
      textureMemoryMethod: 'RGBA8 dimensions plus 4/3 mip estimate; compressed/GPU overhead unavailable',
      geometriesInMemory: renderer.info.memory.geometries,
      texturesInMemory: renderer.info.memory.textures,
      javascriptHeapMiB: performance.memory ? +(performance.memory.usedJSHeapSize / 1024 / 1024).toFixed(2) : null,
      activeEventListeners: activeListenerCount,
      listenersByType: listenerSnapshot.active,
      uiMutations: sample.uiMutations,
      uiMutationFrequencyHz: +(sample.uiMutations / sample.duration).toFixed(2),
    };
  });
}

async function cycleLaptop(count) {
  if (count <= 0) return null;
  await page.evaluate(() => window.__fw.scene3d.clubhouse().prepareCheckoutQa());
  await setCamera({ at: [8.5, 4.5], to: [9.55, 4.5], pitch: -0.05 });
  await page.locator('canvas').click({ position: { x: 800, y: 450 } });
  const read = () => page.evaluate(() => {
    const listenerSnapshot = window.__qaListeners.snapshot();
    return {
      roots: document.querySelectorAll('.laptop-screen').length,
      visibleFrames: [...document.querySelectorAll('.laptop-screen')]
        .filter((root) => root.style.display !== 'none').length,
      listeners: listenerSnapshot.active,
      activeEventListeners: Object.values(listenerSnapshot.active).reduce((sum, value) => sum + value, 0),
      javascriptHeapMiB: performance.memory ? +(performance.memory.usedJSHeapSize / 1024 / 1024).toFixed(2) : null,
      fov: window.__fw.scene3d.camera.fov,
      near: window.__fw.scene3d.camera.near,
      laptopOpen: window.__fw.laptopOpen,
    };
  });
  // Warm the persistent laptop shell, its live page, and the thumbnail renderer before taking
  // the baseline. The soak measures repeated interaction growth, not legitimate first-use setup.
  await page.waitForFunction(() => /laptop/i.test(window.__fw.scene3d.walk.getFocusLabel() || ''),
    null, { timeout: 10_000 });
  await page.keyboard.press('e');
  await page.waitForFunction(() => window.__fw.laptopOpen === true && document.querySelector('.lt-frame'),
    null, { timeout: 12_000 });
  await page.locator('.lt-navbtn').filter({ hasText: 'Inventory' }).first().click();
  await page.waitForTimeout(250);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__fw.laptopOpen === false, null, { timeout: 10_000 });
  await page.waitForTimeout(500);
  const before = await read();
  const failures = [];
  let cyclesCompleted = 0;
  for (let index = 0; index < count; index++) {
    const promptReady = await page.waitForFunction(() => /laptop/i.test(
      window.__fw.scene3d.walk.getFocusLabel() || '',
    ), null, { timeout: 10_000 }).then(() => true).catch(() => false);
    if (!promptReady) { failures.push(`cycle ${index + 1}: laptop prompt did not return`); break; }
    await page.keyboard.press('e');
    const opened = await page.waitForFunction(() => window.__fw.laptopOpen === true
      && document.querySelector('.lt-frame'), null, { timeout: 12_000 })
      .then(() => true).catch(() => false);
    if (!opened) { failures.push(`cycle ${index + 1}: laptop did not open`); break; }
    if (index % 5 === 4) {
      await page.locator('.lt-navbtn').filter({ hasText: 'Inventory' }).first().click();
      await page.waitForTimeout(120);
    }
    await page.keyboard.press('Escape');
    const closed = await page.waitForFunction(() => window.__fw.laptopOpen === false,
      null, { timeout: 10_000 }).then(() => true).catch(() => false);
    if (!closed) { failures.push(`cycle ${index + 1}: laptop did not close`); break; }
    cyclesCompleted++;
  }
  await page.waitForTimeout(1_500);
  const after = await read();
  const listenerDelta = after.activeEventListeners - before.activeEventListeners;
  const heapDeltaMiB = before.javascriptHeapMiB == null || after.javascriptHeapMiB == null
    ? null : +(after.javascriptHeapMiB - before.javascriptHeapMiB).toFixed(2);
  return {
    cyclesRequested: count,
    cyclesCompleted,
    before,
    after,
    listenerDelta,
    heapDeltaMiB,
    failures,
    checks: {
      allCyclesCompleted: failures.length === 0,
      oneRootOnly: after.roots === 1,
      noVisibleLeftovers: after.visibleFrames === 0 && !after.laptopOpen,
      noListenerGrowth: listenerDelta === 0,
      heapBounded: heapDeltaMiB == null || heapDeltaMiB <= 24,
      lensRestored: after.fov === before.fov && after.near === before.near,
    },
  };
}

console.log(`[${PASS}] boot`);
await bootThroughNormalUi();
const normalControlProof = await proveNormalControls();
const clockControlProof = await pauseClockThroughNormalControl();
// Fixed comparison cameras are deliberately actor-free. Customer flow is
// captured separately below, after the clean starting/full sweeps, so a random
// head or basket cannot invalidate the same-camera comparison.
const visualIsolation = await page.evaluate(() => window.__fw.scene3d.clubhouse().prepareCheckoutQa());

const startingState = await page.evaluate(() => ({
  branch: 'overnight/pro-shop-overhaul',
  course: window.__fw.state.clubName,
  tier: window.__fw.state.shop.unlockedTier,
  condition: window.__fw.state.shop.condition,
  fixtureLayout: window.__fw.state.shop.layout,
}));
const metrics = [];
if (CAPTURE_START) {
  console.log(`[${PASS}] capture starting state`);
  await captureSet('starting-state');
}

if (PERFORMANCE) {
  console.log(`[${PASS}] measure empty basic`);
  await setStock('empty', 1);
  await setCamera(SHOTS[0]);
  await page.waitForTimeout(3_000);
  for (let sample = 1; sample <= PERF_SAMPLES; sample++) {
    await page.waitForTimeout(1_000);
    metrics.push({
      ...(await measureFrames('empty-basic-idle', PERF_IDLE_SECONDS)),
      sample,
      samplesRequested: PERF_SAMPLES,
    });
  }
}

const stock = await setStock('full', 3);
await page.waitForTimeout(1_800); // tier change relays premium fixtures on the scene poll
let spawned = 0;
if (CAPTURE_FULL) {
  console.log(`[${PASS}] capture fully stocked`);
  await captureSet('fully-stocked');
}
if (REQUESTED_CUSTOMERS > 0) {
  spawned = await page.evaluate((count) => {
    const clubhouse = window.__fw.scene3d.clubhouse();
    let made = 0;
    for (let i = 0; i < count; i++) made += clubhouse.debugSpawn() ? 1 : 0;
    return made;
  }, REQUESTED_CUSTOMERS);
  // Let shoppers traverse the real nav routes and settle into authored browse
  // sockets before the fixed-camera sweep begins.
  await page.keyboard.press('Space');
  await page.waitForTimeout(16_000);
  await page.keyboard.press('Space');
}
const stockDiagnostics = await page.evaluate(() => {
  const root = window.__fw.scene3d.scene.getObjectByName('shop-stock');
  if (!root) return [];
  return root.children.filter((child) => child.name).map((child) => {
    let meshes = 0;
    let vertices = 0;
    child.traverse((object) => {
      if (!object.isMesh) return;
      meshes += 1;
      vertices += object.geometry?.attributes?.position?.count || 0;
    });
    return { name: child.name, meshes, vertices, visible: child.visible };
  });
});
const customerDiagnostics = await page.evaluate(() => {
  const api = window.__fw.scene3d.clubhouse();
  const customers = Array.isArray(api.customers) ? api.customers : api.customers();
  let minSeparationYards = null;
  for (let i = 0; i < customers.length; i++) {
    for (let j = i + 1; j < customers.length; j++) {
      const distance = customers[i].mesh.position.distanceTo(customers[j].mesh.position);
      minSeparationYards = minSeparationYards == null ? distance : Math.min(minSeparationYards, distance);
    }
  }
  const reservedSockets = customers.flatMap((customer) => customer.stops
    .map((stop) => stop.socketKey).filter(Boolean));
  return {
    active: customers.length,
    minSeparationYards: minSeparationYards == null ? null : +minSeparationYards.toFixed(3),
    reservedSockets,
    uniqueReservedSockets: new Set(reservedSockets).size,
  };
});
if (CAPTURE && REQUESTED_CUSTOMERS > 0) {
  // Live-flow evidence is separate from the matched fixture cameras. Frame it
  // from the aisle edge so a shopper cannot fill the lens while the rest of
  // the browsing route disappears behind them.
  await setCamera({ at: [-2.65, 2.75], to: [-0.7, -4.6], pitch: -0.035 });
  await page.screenshot({
    path: path.join(OUT, 'customer-flow', '01-browsing.jpg'),
    type: 'jpeg', quality: 86,
  });
  await setCamera({ at: [0.05, 1.55], to: [2.9, 4.5], pitch: -0.08 });
  await page.screenshot({
    path: path.join(OUT, 'customer-flow', '02-checkout-approach.jpg'),
    type: 'jpeg', quality: 86,
  });
}

if (PERFORMANCE) {
  console.log(`[${PASS}] measure full premium with ten customers`);
  if (await page.evaluate(() => window.__fw.speedIdx === 0)) await page.keyboard.press('Space');
  for (let sample = 1; sample <= PERF_SAMPLES; sample++) {
    spawned += await page.evaluate(() => {
      const clubhouse = window.__fw.scene3d.clubhouse();
      clubhouse.prepareCheckoutQa();
      let count = 0;
      for (let i = 0; i < 10; i++) count += clubhouse.debugSpawn() ? 1 : 0;
      return count;
    });
    await setCamera(SHOTS[3]);
    await page.waitForTimeout(16_000);
    const activeCustomers = await page.evaluate(() => {
      const clubhouse = window.__fw.scene3d.clubhouse();
      const customers = Array.isArray(clubhouse.customers) ? clubhouse.customers : clubhouse.customers();
      return customers.length;
    });
    metrics.push({
      ...(await measureFrames('full-premium-ten-customers-idle', PERF_IDLE_SECONDS)),
      sample,
      samplesRequested: PERF_SAMPLES,
      activeCustomers,
    });
  }

  console.log(`[${PASS}] measure normal-control walk`);
  for (let sample = 1; sample <= PERF_SAMPLES; sample++) {
    await setCamera(SHOTS[0]);
    await page.locator('canvas').click({ position: { x: 800, y: 450 } }).catch(() => {});
    const beforeWalk = await page.evaluate(() => ({ x: window.__fw.scene3d.walk.state.x, z: window.__fw.scene3d.walk.state.z }));
    await page.keyboard.down('w');
    const walkingMetrics = await measureFrames('full-premium-normal-control-walk', PERF_WALK_SECONDS);
    await page.keyboard.up('w');
    const afterWalk = await page.evaluate(() => ({ x: window.__fw.scene3d.walk.state.x, z: window.__fw.scene3d.walk.state.z }));
    metrics.push({
      ...walkingMetrics,
      sample,
      samplesRequested: PERF_SAMPLES,
      playerTravelYards: +Math.hypot(afterWalk.x - beforeWalk.x, afterWalk.z - beforeWalk.z).toFixed(2),
    });
  }
}

const laptopCycles = PERFORMANCE ? await cycleLaptop(LAPTOP_CYCLES) : null;

const report = {
  pass: PASS,
  timestamp: new Date().toISOString(),
  baseUrl: BASE_URL,
  browser: await browser.version(),
  viewport: VIEWPORT,
  deviceScaleFactor: 1,
  clock: '2:00 PM pinned before every fixed-camera capture',
  warmupSeconds: 3,
  frameSampleSeconds: { idle: PERF_IDLE_SECONDS, walk: PERF_WALK_SECONDS },
  performanceSamples: PERF_SAMPLES,
  captureEnabled: CAPTURE,
  captureStartEnabled: CAPTURE_START,
  captureFullEnabled: CAPTURE_FULL,
  performanceEnabled: PERFORMANCE,
  renovated: RENOVATED,
  hardwareAcceleration: HARDWARE,
  startingState,
  bootRoute: ['New Empire — Relaxed', 'Property Market', 'Buy Willow Creek Municipal'],
  normalControlProof,
  clockControlProof,
  visualIsolation: {
    method: 'prepareCheckoutQa before fixed cameras; customer flow captured separately',
    ...visualIsolation,
  },
  stock,
  stockDiagnostics,
  customerDiagnostics,
  customersSpawned: spawned,
  cameras: SHOTS,
  metrics,
  laptopCycles,
  consoleMessages,
  failedRequests,
};
await writeFile(path.join(OUT, 'run.json'), `${JSON.stringify(report, null, 2)}\n`);

const video = page.video();
await context.close();
const rawVideoPath = video ? await video.path() : null;
if (rawVideoPath) await rename(rawVideoPath, path.join(OUT, 'video', `${PASS}.webm`));
await browser.close();

console.log(JSON.stringify(report, null, 2));
