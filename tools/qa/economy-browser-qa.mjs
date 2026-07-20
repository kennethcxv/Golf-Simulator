import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

function arg(name, fallback) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((value) => value.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}

function findPlaywright() {
  const candidates = [];
  if (process.env.PLAYWRIGHT_MODULE) candidates.push(process.env.PLAYWRIGHT_MODULE);
  candidates.push('playwright');
  const cacheRoot = process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, 'npm-cache', '_npx')
    : null;
  if (cacheRoot && fs.existsSync(cacheRoot)) {
    const cached = fs.readdirSync(cacheRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(cacheRoot, entry.name, 'node_modules', 'playwright'))
      .filter((candidate) => fs.existsSync(path.join(candidate, 'package.json')))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    candidates.push(...cached);
  }
  for (const candidate of candidates) {
    try {
      return { api: require(candidate), modulePath: candidate };
    } catch {
      // Try the next installed runtime.
    }
  }
  throw new Error('Playwright is unavailable. Set PLAYWRIGHT_MODULE to an installed playwright package.');
}

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(?:([A-Za-z]:))/, '$1')), '..', '..');
const baseUrl = arg('url', 'http://127.0.0.1:8461/');
const phase = arg('phase', 'baseline');
const outDir = path.resolve(root, arg('out', `qa/economy-progression/${phase}`));
const headless = arg('headless', 'true') !== 'false';
const durationMs = Number(arg('duration-ms', '8000'));
fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(path.join(outDir, 'screenshots'), { recursive: true });
fs.mkdirSync(path.join(outDir, 'video'), { recursive: true });

const { api: playwright, modulePath } = findPlaywright();
const { chromium } = playwright;
const browser = await chromium.launch({
  headless,
  channel: 'chrome',
  args: ['--enable-precise-memory-info', '--force-device-scale-factor=1'],
});
const context = await browser.newContext({
  viewport: { width: 1600, height: 900 },
  deviceScaleFactor: 1,
  recordVideo: { dir: path.join(outDir, 'video'), size: { width: 1600, height: 900 } },
});

// Active registrations are tracked from the first application script onward. The browser's
// implicit removal of once-listeners is not observable here, so this is a stable upper bound;
// growth across repeated identical interactions is the leak signal that matters.
await context.addInitScript(() => {
  // Fix the New Empire seed so weather, listings, turf and customers are identical in every run.
  let qaRandomState = 0x4f1bbcdc;
  Math.random = () => {
    qaRandomState |= 0;
    qaRandomState = (qaRandomState + 0x6d2b79f5) | 0;
    let value = qaRandomState;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  const add = EventTarget.prototype.addEventListener;
  const remove = EventTarget.prototype.removeEventListener;
  const registrations = [];
  let adds = 0;
  let removes = 0;
  const captureOf = (options) => typeof options === 'boolean' ? options : !!options?.capture;
  EventTarget.prototype.addEventListener = function trackedAdd(type, listener, options) {
    const capture = captureOf(options);
    if (listener && !registrations.some((item) => item.target === this && item.type === type && item.listener === listener && item.capture === capture)) {
      registrations.push({ target: this, type, listener, capture });
      adds += 1;
    }
    return add.call(this, type, listener, options);
  };
  EventTarget.prototype.removeEventListener = function trackedRemove(type, listener, options) {
    const capture = captureOf(options);
    const index = registrations.findIndex((item) => item.target === this && item.type === type && item.listener === listener && item.capture === capture);
    if (index >= 0) {
      registrations.splice(index, 1);
      removes += 1;
    }
    return remove.call(this, type, listener, options);
  };
  Object.defineProperty(window, '__qaListeners', {
    value: {
      snapshot: () => {
        // Discard registrations whose DOM target has left the document. Those nodes and their
        // listeners are collectible and therefore are not active leak surface.
        for (let index = registrations.length - 1; index >= 0; index -= 1) {
          const target = registrations[index].target;
          if (target instanceof Node && target !== document && !target.isConnected) registrations.splice(index, 1);
        }
        return { activeUpperBound: registrations.length, adds, removes };
      },
    },
  });
});

const page = await context.newPage();
const consoleMessages = [];
const pageErrors = [];
const failedRequests = [];
page.on('console', (message) => {
  if (message.type() === 'error' || message.type() === 'warning') {
    consoleMessages.push({ type: message.type(), text: message.text().slice(0, 1000) });
  }
});
page.on('pageerror', (error) => pageErrors.push(error.message));
page.on('requestfailed', (request) => failedRequests.push({
  url: request.url(),
  reason: request.failure()?.errorText || 'unknown',
}));

async function measure(label, ms) {
  return page.evaluate(async ({ label, ms }) => {
    const renderer = window.__fw?.scene3d?.renderer;
    const scene = window.__fw?.scene3d?.scene;
    const intervals = [];
    const previousAutoReset = renderer?.info?.autoReset;
    if (renderer?.info) {
      renderer.info.autoReset = false;
      renderer.info.reset();
    }
    let uiMutations = 0;
    const ui = document.querySelector('.laptop-screen');
    const observer = ui ? new MutationObserver((records) => { uiMutations += records.length; }) : null;
    if (observer) observer.observe(ui, { subtree: true, childList: true, characterData: true, attributes: true });
    const start = performance.now();
    let previous = start;
    await new Promise((resolve) => {
      function frame(now) {
        intervals.push(now - previous);
        previous = now;
        if (now - start >= ms) resolve();
        else requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    });
    if (observer) observer.disconnect();

    const useful = intervals.slice(1).filter((value) => value > 0);
    const elapsed = useful.reduce((sum, value) => sum + value, 0);
    const descending = [...useful].sort((a, b) => b - a);
    const slowCount = Math.max(1, Math.ceil(descending.length * 0.01));
    const slowMean = descending.slice(0, slowCount).reduce((sum, value) => sum + value, 0) / slowCount;
    const aggregateCalls = renderer?.info?.render?.calls ?? null;
    const aggregateTriangles = renderer?.info?.render?.triangles ?? null;

    const materials = new Set();
    const textures = new Set();
    let textureBytesApprox = 0;
    const textureKeys = ['map', 'emissiveMap', 'roughnessMap', 'metalnessMap', 'normalMap', 'aoMap', 'alphaMap', 'bumpMap'];
    if (scene) scene.traverse((object) => {
      if (!object.material) return;
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        materials.add(material);
        for (const key of textureKeys) if (material[key]?.isTexture) textures.add(material[key]);
      }
    });
    for (const texture of textures) {
      const image = texture.image;
      const width = image?.videoWidth || image?.naturalWidth || image?.width || 0;
      const height = image?.videoHeight || image?.naturalHeight || image?.height || 0;
      const faces = Array.isArray(image) ? Math.max(1, image.length) : 1;
      textureBytesApprox += width * height * 4 * faces * 4 / 3;
    }

    const result = {
      label,
      durationMs: Math.round(elapsed),
      frameCount: useful.length,
      averageFps: elapsed ? Math.round((useful.length * 1000 / elapsed) * 100) / 100 : null,
      onePercentLowFps: slowMean ? Math.round((1000 / slowMean) * 100) / 100 : null,
      worstFrameMs: descending.length ? Math.round(descending[0] * 100) / 100 : null,
      drawCallsAverage: aggregateCalls === null || useful.length === 0 ? null : Math.round(aggregateCalls / useful.length * 100) / 100,
      trianglesAverage: aggregateTriangles === null || useful.length === 0 ? null : Math.round(aggregateTriangles / useful.length),
      materialCount: materials.size,
      textureCount: textures.size,
      textureMemoryApproxBytes: Math.round(textureBytesApprox),
      rendererTextureCount: renderer?.info?.memory?.textures ?? null,
      rendererGeometryCount: renderer?.info?.memory?.geometries ?? null,
      rendererProgramCount: renderer?.info?.programs?.length ?? null,
      jsHeapUsedBytes: performance.memory?.usedJSHeapSize ?? null,
      activeListeners: window.__qaListeners?.snapshot?.() ?? null,
      uiMutationCount: uiMutations,
      uiMutationsPerSecond: Math.round((uiMutations / Math.max(0.001, elapsed / 1000)) * 100) / 100,
    };
    if (renderer?.info) {
      renderer.info.autoReset = previousAutoReset;
      renderer.info.reset();
    }
    return result;
  }, { label, ms });
}

async function clickLaptopNav(label) {
  const spot = await page.evaluate((text) => {
    const button = [...document.querySelectorAll('.lt-navbtn')]
      .find((candidate) => candidate.textContent.trim().includes(text));
    if (!button) return null;
    button.scrollIntoView({ block: 'nearest' });
    const rect = button.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }, label);
  if (!spot) throw new Error(`Laptop navigation button not found: ${label}`);
  await page.mouse.move(spot.x, spot.y);
  await page.waitForTimeout(80);
  await page.mouse.click(spot.x, spot.y);
  await page.waitForTimeout(320);
  const active = await page.locator('.lt-navbtn.on').innerText().catch(() => '');
  if (!active.includes(label)) throw new Error(`Projected click missed ${label}; active page is ${active || 'unknown'}`);
}

await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 40000 });
await page.getByRole('button', { name: /New Empire.*Relaxed/i }).click();
await page.getByRole('button', { name: /^Buy$/i }).first().click();
await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 60000 });
await page.waitForFunction(() => {
  const veil = document.querySelector('.load-veil');
  return !veil || getComputedStyle(veil).opacity === '0';
}, null, { timeout: 60000 });
await page.waitForTimeout(3000);

// Deterministic content fixture: advance the real simulation for eight complete days. This uses
// the same daily tick, revenue, expense, rounds, reviews, weather and saveable state as gameplay;
// it never writes numbers into a UI component.
const fixture = await page.evaluate(async () => {
  const app = window.__fw;
  const empireSim = await import('/src/sim/empire.js');
  const time = await import('/src/sim/time.js');
  for (let day = 0; day < 8; day += 1) empireSim.empireUpdate(app.empire, 1440);
  const clubhouse = app.scene3d.clubhouse();
  const origin = clubhouse.interior.position;
  const walk = app.scene3d.walk.state;
  walk.x = 8.45 + origin.x;
  walk.z = 4.5 + origin.z;
  walk.yaw = -Math.PI / 2;
  walk.pitch = -0.05;
  const calendar = time.calendarOf(app.state.clock.minutes);
  app.scene3d.applyTimeWeather(calendar.minuteOfDay, app.state.weather);
  return {
    seed: app.state.seed,
    dayAbs: calendar.dayAbs,
    cash: app.state.cash,
    ledgerDays: app.state.ledger?.history?.length || 0,
    camera: { x: walk.x, z: walk.z, yaw: walk.yaw, pitch: walk.pitch },
  };
});
await page.waitForTimeout(1000);
await page.screenshot({ path: path.join(outDir, 'screenshots', 'player-camera.png') });

const idle = await measure('idle-fixed-clubhouse-camera', durationMs);

await page.keyboard.press('e');
await page.waitForFunction(() => window.__fw?.laptopOpen === true, null, { timeout: 10000 });
await page.waitForFunction(() => {
  const frame = document.querySelector('.lt-frame');
  if (!frame) return false;
  const rect = frame.getBoundingClientRect();
  const previous = window.__qaFrameRect || {};
  window.__qaFrameRect = { left: rect.left, width: rect.width };
  return rect.width > 100 && Math.abs((previous.left ?? 0) - rect.left) < 0.05 && Math.abs((previous.width ?? 0) - rect.width) < 0.05;
}, null, { timeout: 20000, polling: 120 });
await page.waitForTimeout(350);

const pages = [
  'Home', 'Pro Shop', 'Supplier', 'Orders', 'Deliveries', 'Inventory', 'Pricing',
  'Reservations', 'Course', 'Carts & rentals', 'Employees', 'Finances', 'Reviews',
  'Analytics', 'Renovation', 'Property', 'Settings',
];
const pageAudit = [];
const longPageScreens = new Set(['Finances', 'Renovation', 'Property']);
for (const label of pages) {
  await clickLaptopNav(label);
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  await page.screenshot({ path: path.join(outDir, 'screenshots', `${slug}.png`) });
  pageAudit.push(await page.evaluate((expected) => ({
    expected,
    title: document.querySelector('.lt-h1')?.textContent?.trim() || null,
    active: document.querySelector('.lt-navbtn.on')?.textContent?.trim() || null,
    crash: /could not be drawn/i.test(document.querySelector('.lt-err')?.textContent || ''),
    nodeCount: document.querySelector('.lt-content')?.querySelectorAll('*').length || 0,
    scrollHeight: document.querySelector('.lt-content')?.scrollHeight || 0,
    clientHeight: document.querySelector('.lt-content')?.clientHeight || 0,
  }), label));
  if (longPageScreens.has(label)) {
    const contentPoint = await page.evaluate(() => {
      const rect = document.querySelector('.lt-content')?.getBoundingClientRect();
      return rect ? { x: rect.left + rect.width * 0.72, y: rect.top + rect.height * 0.72 } : null;
    });
    if (contentPoint) {
      await page.mouse.move(contentPoint.x, contentPoint.y);
      await page.mouse.wheel(0, 5000);
      await page.waitForTimeout(250);
      await page.screenshot({ path: path.join(outDir, 'screenshots', `${slug}-bottom.png`) });
    }
  }
}

await clickLaptopNav('Home');
const listenerBeforeCycles = await page.evaluate(() => window.__qaListeners?.snapshot?.() ?? null);
const interactivePromise = measure('laptop-repeated-navigation', durationMs);
const cycleLabels = ['Home', 'Finances', 'Reviews', 'Pricing'];
let cycle = 0;
while (cycle < 24) {
  await clickLaptopNav(cycleLabels[cycle % cycleLabels.length]);
  cycle += 1;
}
const interactive = await interactivePromise;
await clickLaptopNav('Home');
const listenerAfterCycles = await page.evaluate(() => window.__qaListeners?.snapshot?.() ?? null);
await page.screenshot({ path: path.join(outDir, 'screenshots', 'laptop-final.png') });

const overlayAudit = await page.evaluate(() => {
  const visible = (selector) => {
    const node = document.querySelector(selector);
    if (!node) return false;
    const style = getComputedStyle(node);
    return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0;
  };
  return {
    laptopOpen: window.__fw?.laptopOpen === true,
    worldHudVisible: visible('.hud-min'),
    objectiveCardVisible: visible('.objectives-card'),
  };
});

const report = {
  phase,
  createdAt: new Date().toISOString(),
  launch: {
    command: `node tools/qa/economy-browser-qa.mjs --url=${baseUrl} --phase=${phase} --out=${path.relative(root, outDir).replaceAll('\\', '/')}`,
    baseUrl,
    browser: await browser.version(),
    playwrightModule: modulePath,
    viewport: { width: 1600, height: 900, deviceScaleFactor: 1 },
    headless,
  },
  fixture,
  fixedCamera: {
    name: 'clubhouse-laptop-desk',
    position: fixture.camera,
    lighting: `simulation day ${fixture.dayAbs}, current deterministic weather/time`,
  },
  metrics: { idle, interactive },
  listenerGrowth: { before: listenerBeforeCycles, after: listenerAfterCycles },
  overlayAudit,
  pageAudit,
  consoleMessages,
  pageErrors,
  failedRequests,
  metricSources: {
    frameTiming: 'requestAnimationFrame intervals over fixed-duration samples',
    drawCallsAndTriangles: 'THREE.WebGLRenderer.info.render sampled every animation frame',
    materialsAndTextures: 'unique scene traversal identities at sample end',
    textureMemory: 'RGBA8 dimensions with 4/3 mip estimate; approximate, not GPU-driver allocation',
    heap: 'Chromium performance.memory.usedJSHeapSize with --enable-precise-memory-info',
    listeners: 'instrumented EventTarget registrations; active value is an upper bound because browser-internal once removal is not observable',
    uiUpdates: 'MutationObserver records beneath .laptop-screen during the sample',
  },
};

const video = page.video();
await context.close();
if (video) {
  const rawVideo = await video.path();
  const finalVideo = path.join(outDir, 'video', `${phase}-normal-controls.webm`);
  if (path.resolve(rawVideo) !== path.resolve(finalVideo)) {
    if (fs.existsSync(finalVideo)) fs.rmSync(finalVideo);
    fs.renameSync(rawVideo, finalVideo);
  }
  report.video = path.relative(root, finalVideo).replaceAll('\\', '/');
}
await browser.close();
fs.writeFileSync(path.join(outDir, 'browser-report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({
  phase,
  outDir,
  pages: pageAudit.length,
  consoleErrors: consoleMessages.filter((message) => message.type === 'error').length,
  pageErrors: pageErrors.length,
  failedRequests: failedRequests.length,
  idle,
  interactive,
  listenerGrowth: report.listenerGrowth,
  video: report.video,
}, null, 2));
