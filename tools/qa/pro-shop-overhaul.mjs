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
  { id: '05-club-displays', at: [-6.3, -0.2], to: [-9.9, -0.4], pitch: 0.02 },
  { id: '06-clothing', at: [-4.0, 3.4], to: [-5.0, 0.2], pitch: -0.02 },
  { id: '07-shoes', at: [2.4, 0.3], to: [5.1, -0.6], pitch: -0.02 },
  { id: '08-hats', at: [-0.2, -3.8], to: [1.55, -5.9], pitch: -0.03 },
  { id: '09-bags', at: [0.2, -0.8], to: [2.2, -2.65], pitch: -0.04 },
  { id: '10-accessories', at: [-3.7, -3.7], to: [-3.7, -6.15], pitch: 0.01 },
  { id: '11-snacks-drinks', at: [4.25, 3.35], to: [4.55, 1.50], pitch: -0.04 },
  { id: '12-office', at: [7.2, 4.3], to: [9.55, 4.5], pitch: -0.06 },
  { id: '13-stockroom', at: [7.4, -2.3], to: [8.1, -5.9], pitch: -0.04 },
  { id: '14-fitting-area', at: [1.6, -0.5], to: [4.6, -2.1], pitch: -0.03 },
  { id: '15-lounge', at: [1.0, -3.8], to: [4.9, -5.2], pitch: -0.03 },
  { id: '16-exterior-window', world: true, at: [-1.5, 243.5], to: [-8.5, 231.0], pitch: 0.03 },
  { id: '17-putting-studio', at: [-3.8, 4.2], to: [-7.0, 4.95], pitch: -0.12 },
  { id: '18-tour-vault', at: [2.3, -4.0], to: [5.25, -5.2], pitch: -0.04 },
];
const shotArg = process.argv.find((arg) => arg.startsWith('--shots='))?.slice(8);
const shotIds = shotArg ? new Set(shotArg.split(',').map((id) => id.trim())) : null;
const SHOTS = shotIds ? ALL_SHOTS.filter((shot) => shotIds.has(shot.id)) : ALL_SHOTS;
if (!SHOTS.length) throw new Error(`No fixed cameras matched --shots=${shotArg}`);

await mkdir(OUT, { recursive: true });
await mkdir(path.join(OUT, 'starting-state'), { recursive: true });
await mkdir(path.join(OUT, 'fully-stocked'), { recursive: true });
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
  const active = new Map();
  const adds = new Map();
  const removes = new Map();
  const originalAdd = EventTarget.prototype.addEventListener;
  const originalRemove = EventTarget.prototype.removeEventListener;
  EventTarget.prototype.addEventListener = function trackedAdd(type, listener, options) {
    active.set(type, (active.get(type) || 0) + 1);
    adds.set(type, (adds.get(type) || 0) + 1);
    return originalAdd.call(this, type, listener, options);
  };
  EventTarget.prototype.removeEventListener = function trackedRemove(type, listener, options) {
    active.set(type, Math.max(0, (active.get(type) || 0) - 1));
    removes.set(type, (removes.get(type) || 0) + 1);
    return originalRemove.call(this, type, listener, options);
  };
  window.__qaListeners = {
    snapshot() {
      const object = (map) => Object.fromEntries([...map.entries()].sort(([a], [b]) => a.localeCompare(b)));
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
    await continueButton.click();
  } else {
    await page.getByRole('button', { name: /New Empire.*Relaxed/ }).click();
    await page.getByRole('heading', { name: 'PROPERTY MARKET' }).waitFor();
    await page.getByRole('button', { name: 'Buy', exact: true }).first().click();
  }
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 60_000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
  }, null, { timeout: 60_000 });
  await page.getByRole('button', { name: 'Hide the guide' }).click().catch(() => {});
  await page.waitForTimeout(2_500);
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
    await page.screenshot({ path: path.join(OUT, folder, `${shot.id}.png`) });
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

console.log(`[${PASS}] boot`);
await bootThroughNormalUi();

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
  metrics.push(await measureFrames('empty-basic-idle', PERF_IDLE_SECONDS));
}

const stock = await setStock('full', 3);
await page.waitForTimeout(1_800); // tier change relays premium fixtures on the scene poll
let spawned = 0;
if (REQUESTED_CUSTOMERS > 0) {
  spawned = await page.evaluate((count) => {
    const clubhouse = window.__fw.scene3d.clubhouse();
    let made = 0;
    for (let i = 0; i < count; i++) made += clubhouse.debugSpawn() ? 1 : 0;
    return made;
  }, REQUESTED_CUSTOMERS);
  // Let shoppers traverse the real nav routes and settle into authored browse
  // sockets before the fixed-camera sweep begins.
  await page.waitForTimeout(10_000);
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
if (CAPTURE_FULL) {
  console.log(`[${PASS}] capture fully stocked`);
  await captureSet('fully-stocked');
}

if (PERFORMANCE) {
  console.log(`[${PASS}] measure full premium with ten customers`);
  await setCamera(SHOTS[3]);
  spawned += await page.evaluate(() => {
    const clubhouse = window.__fw.scene3d.clubhouse();
    let count = 0;
    for (let i = 0; i < 10; i++) count += clubhouse.debugSpawn() ? 1 : 0;
    return count;
  });
  await page.waitForTimeout(3_000);
  metrics.push(await measureFrames('full-premium-ten-customers-idle', PERF_IDLE_SECONDS));

  console.log(`[${PASS}] measure normal-control walk`);
  await setCamera(SHOTS[0]);
  await page.locator('canvas').click({ position: { x: 800, y: 450 } }).catch(() => {});
  const beforeWalk = await page.evaluate(() => ({ x: window.__fw.scene3d.walk.state.x, z: window.__fw.scene3d.walk.state.z }));
  await page.keyboard.down('w');
  const walkingMetrics = await measureFrames('full-premium-normal-control-walk', PERF_WALK_SECONDS);
  await page.keyboard.up('w');
  const afterWalk = await page.evaluate(() => ({ x: window.__fw.scene3d.walk.state.x, z: window.__fw.scene3d.walk.state.z }));
  metrics.push({ ...walkingMetrics, playerTravelYards: +Math.hypot(afterWalk.x - beforeWalk.x, afterWalk.z - beforeWalk.z).toFixed(2) });
}

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
  captureEnabled: CAPTURE,
  captureStartEnabled: CAPTURE_START,
  captureFullEnabled: CAPTURE_FULL,
  performanceEnabled: PERFORMANCE,
  renovated: RENOVATED,
  hardwareAcceleration: HARDWARE,
  startingState,
  stock,
  stockDiagnostics,
  customerDiagnostics,
  customersSpawned: spawned,
  cameras: SHOTS,
  metrics,
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
