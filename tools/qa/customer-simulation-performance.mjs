import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const phase = process.argv[2] || 'baseline';
const stamp = process.argv[3] || new Date().toISOString().replace(/[:.]/g, '-');
const url = process.env.GOLF_FLIPPER_URL || 'http://127.0.0.1:8463/';
const durationMs = Number(process.env.QA_SAMPLE_MS || 6_000);
const sampleCount = Number(process.env.QA_SAMPLES || 3);
const outputDir = path.resolve(process.cwd(), 'qa', 'customer-simulation', phase, 'performance');
await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH || undefined,
  args: [
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--use-angle=swiftshader',
    '--enable-precise-memory-info',
  ],
});
const context = await browser.newContext({
  viewport: { width: 1600, height: 900 },
  deviceScaleFactor: 1,
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
    const key = `${String(type)}|${captureOf(opts)}`;
    const listeners = registry.get(this)?.get(key);
    if (listeners && listeners.delete(listener)) {
      stats.removes += 1;
      stats.active -= 1;
      stats.byType[type] = Math.max(0, (stats.byType[type] || 0) - 1);
    }
    return remove.call(this, type, listener, opts);
  };
  window.__qaListenerStats = stats;
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
  const relaxedEmpire = page.getByRole('button', { name: /New Empire.*Relaxed/ });
  if (!(await relaxedEmpire.count()) || !(await relaxedEmpire.first().isVisible())) {
    await page.getByText('New game', { exact: true }).click();
  }
  await relaxedEmpire.first().click();
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
await page.waitForTimeout(3_000);

await page.evaluate(() => {
  window.__qaHudMutations = 0;
  const hud = document.querySelector('.hud-min');
  if (hud) {
    const observer = new MutationObserver((records) => {
      window.__qaHudMutations += records.length;
    });
    observer.observe(hud, { subtree: true, childList: true, attributes: true, characterData: true });
    window.__qaHudObserver = observer;
  }
});

async function positionCamera(clockMinute = 330) {
  await page.evaluate((minute) => {
    const app = window.__fw;
    const day = Math.floor(app.state.clock.minutes / 1440);
    app.state.clock.minutes = day * 1440 + minute;
    app.scene3d.applyTimeWeather(minute, app.state.weather);
    const at = { x: -8 + 0.2, z: 228 + 1.7 };
    const to = { x: -8 + 2.8, z: 228 + 4.6 };
    const walk = app.scene3d.walk.state;
    app.scene3d.walk.clearKeys();
    walk.x = at.x;
    walk.z = at.z;
    const dx = to.x - at.x;
    const dz = to.z - at.z;
    const distance = Math.hypot(dx, dz) || 1;
    walk.yaw = Math.atan2(-dx / distance, -dz / distance);
    walk.pitch = -0.07;
  }, clockMinute);
}

async function resourceSnapshot() {
  return page.evaluate(() => new Promise((resolve) => {
    const app = window.__fw;
    const renderer = app.scene3d.renderer;
    renderer.info.autoReset = false;
    renderer.info.reset();
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const materials = new Set();
        const textures = new Map();
        let visibleMeshes = 0;
        let sceneTriangles = 0;
        app.scene3d.scene.traverse((object) => {
          if (!object.isMesh || !object.visible) return;
          visibleMeshes += 1;
          const geometry = object.geometry;
          const triangles = geometry?.index
            ? geometry.index.count / 3
            : (geometry?.attributes?.position?.count || 0) / 3;
          sceneTriangles += triangles * (object.isInstancedMesh ? object.count : 1);
          const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
          for (const material of objectMaterials) {
            if (!material) continue;
            materials.add(material.uuid);
            for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap']) {
              const texture = material[key];
              if (texture) textures.set(texture.uuid, texture);
            }
          }
        });
        let estimatedTextureBytes = 0;
        let measuredTextureImages = 0;
        for (const texture of textures.values()) {
          const images = Array.isArray(texture.image) ? texture.image : [texture.image || texture.source?.data];
          for (const image of images) {
            const width = image?.videoWidth || image?.naturalWidth || image?.width || 0;
            const height = image?.videoHeight || image?.naturalHeight || image?.height || 0;
            if (!width || !height) continue;
            measuredTextureImages += 1;
            const mipFactor = texture.generateMipmaps === false ? 1 : 4 / 3;
            estimatedTextureBytes += width * height * 4 * mipFactor;
          }
        }
        const snapshot = {
          drawCallsPerSampledFrame: renderer.info.render.calls,
          trianglesDrawnPerSampledFrame: renderer.info.render.triangles,
          visibleMeshes,
          sceneTriangles: Math.round(sceneTriangles),
          materialCount: materials.size,
          sceneTextureCount: textures.size,
          measuredTextureImages,
          estimatedTextureBytes: Math.round(estimatedTextureBytes),
          rendererTextureCount: renderer.info.memory.textures,
          rendererGeometryCount: renderer.info.memory.geometries,
          jsHeapUsedBytes: performance.memory?.usedJSHeapSize ?? null,
          jsHeapTotalBytes: performance.memory?.totalJSHeapSize ?? null,
          listenerStats: structuredClone(window.__qaListenerStats),
        };
        renderer.info.autoReset = true;
        resolve(snapshot);
      });
    });
  }));
}

async function frameSample(label) {
  await page.evaluate(() => { window.__qaHudMutations = 0; });
  const timing = await page.evaluate((duration) => new Promise((resolve) => {
    const frameTimes = [];
    const start = performance.now();
    let previous = start;
    const tick = (now) => {
      frameTimes.push(now - previous);
      previous = now;
      if (now - start >= duration) {
        const sorted = [...frameTimes].sort((a, b) => a - b);
        const worstCount = Math.max(1, Math.ceil(sorted.length * 0.01));
        const worstOnePercent = sorted.slice(-worstCount);
        const worstOnePercentMean = worstOnePercent.reduce((sum, value) => sum + value, 0) / worstOnePercent.length;
        resolve({
          durationMs: now - start,
          frames: frameTimes.length,
          averageFps: frameTimes.length * 1000 / (now - start),
          onePercentLowFps: 1000 / worstOnePercentMean,
          worstFrameMs: sorted[sorted.length - 1],
          meanFrameMs: frameTimes.reduce((sum, value) => sum + value, 0) / frameTimes.length,
          hudMutations: window.__qaHudMutations,
          hudMutationsPerSecond: window.__qaHudMutations * 1000 / (now - start),
        });
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }), durationMs);
  return { label, timing, resources: await resourceSnapshot() };
}

await positionCamera(330);
await page.waitForTimeout(2_000);
const idle = [];
for (let i = 0; i < sampleCount; i += 1) idle.push(await frameSample(`idle-${i + 1}`));

const stressFixture = await page.evaluate(() => {
  const app = window.__fw;
  const inventory = app.state.shop.inventory;
  for (const entry of Object.values(inventory)) entry.shelf = Math.max(entry.shelf || 0, 12);
  const clubhouse = app.scene3d.clubhouse();
  clubhouse.rebuildStock();
  for (let i = 0; i < 12; i += 1) clubhouse.debugSpawn(false);
  const customers = typeof clubhouse.customers === 'function' ? clubhouse.customers() : clubhouse.customers;
  const positions = [
    [-5.8, -4.2], [-4.7, -4.2], [-3.6, -4.2], [-2.5, -4.2],
    [-5.8, -1.8], [-4.7, -1.8], [-3.6, -1.8], [-2.5, -1.8],
    [-0.2, 3.0], [0.7, 3.6], [1.6, 4.2], [2.5, 4.8],
  ];
  customers.slice(0, positions.length).forEach((customer, index) => {
    customer.mesh.position.x = positions[index][0] - 8;
    customer.mesh.position.z = positions[index][1] + 228;
    customer.pathGoal = null;
  });
  return { activeCustomers: customers.length, positionedCustomers: Math.min(customers.length, positions.length) };
});
await positionCamera(600);
await page.waitForTimeout(2_000);
const stress = [];
for (let i = 0; i < sampleCount; i += 1) stress.push(await frameSample(`stress-${i + 1}`));

const summarize = (samples) => {
  const average = (getter) => samples.reduce((sum, sample) => sum + getter(sample), 0) / samples.length;
  return {
    averageFps: average((sample) => sample.timing.averageFps),
    onePercentLowFps: average((sample) => sample.timing.onePercentLowFps),
    worstFrameMs: Math.max(...samples.map((sample) => sample.timing.worstFrameMs)),
    drawCallsPerSampledFrame: average((sample) => sample.resources.drawCallsPerSampledFrame),
    trianglesDrawnPerSampledFrame: average((sample) => sample.resources.trianglesDrawnPerSampledFrame),
    materialCount: average((sample) => sample.resources.materialCount),
    estimatedTextureBytes: average((sample) => sample.resources.estimatedTextureBytes),
    jsHeapUsedBytes: average((sample) => sample.resources.jsHeapUsedBytes || 0),
    activeEventListeners: average((sample) => sample.resources.listenerStats.active),
    hudMutationsPerSecond: average((sample) => sample.timing.hudMutationsPerSecond),
  };
};

const report = {
  phase,
  stamp,
  url,
  protocol: {
    browser: 'Chrome headless via Playwright',
    viewport: { width: 1600, height: 900, deviceScaleFactor: 1 },
    renderer: 'WebGL/SwiftShader (fixed launch flags)',
    warmupMs: 3_000,
    sampleDurationMs: durationMs,
    samplesPerScenario: sampleCount,
    idle: 'Fixed register camera at 05:30, shop closed, no fixture customers',
    stress: 'Fixed register camera at 10:00, twelve on-screen fixture customers',
    textureMemory: 'Estimated RGBA8 bytes from reachable material textures; includes 4/3 mip factor when enabled',
    uiFrequency: 'MutationObserver records per second under .hud-min',
  },
  stressFixture,
  idle,
  stress,
  summary: { idle: summarize(idle), stress: summarize(stress) },
  errors,
  warnings,
  failedRequests,
};

await writeFile(path.join(outputDir, `performance-${stamp}.json`), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
await context.close();
await browser.close();
