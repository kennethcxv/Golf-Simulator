// Identical, no-video performance scenario for before/after comparison.

const fs = require('fs');
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const URL = process.env.QA_URL || 'http://127.0.0.1:8468/';
const OUT = process.env.QA_OUT ? path.resolve(process.env.QA_OUT) : null;
const LABEL = process.env.QA_LABEL || 'working-tree';

async function main() {
  if (OUT) fs.mkdirSync(OUT, { recursive: true });
  const consoleMessages = [];
  const pageErrors = [];
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.QA_BROWSER_PATH ? { executablePath: process.env.QA_BROWSER_PATH } : {}),
    args: ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
  });
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  await context.addInitScript(() => {
    let active = 0;
    let registrations = 0;
    const registry = new WeakMap();
    const originalAdd = EventTarget.prototype.addEventListener;
    const originalRemove = EventTarget.prototype.removeEventListener;
    const captureOf = (options) => typeof options === 'boolean' ? options : !!options?.capture;
    EventTarget.prototype.addEventListener = function patchedAdd(type, listener, options) {
      if (listener) {
        let types = registry.get(this);
        if (!types) { types = new Map(); registry.set(this, types); }
        let entries = types.get(type);
        if (!entries) { entries = []; types.set(type, entries); }
        const capture = captureOf(options);
        if (!entries.some((entry) => entry.listener === listener && entry.capture === capture)) {
          entries.push({ listener, capture });
          active++;
          registrations++;
        }
      }
      return originalAdd.call(this, type, listener, options);
    };
    EventTarget.prototype.removeEventListener = function patchedRemove(type, listener, options) {
      const entries = registry.get(this)?.get(type);
      const capture = captureOf(options);
      const index = entries?.findIndex((entry) => entry.listener === listener && entry.capture === capture) ?? -1;
      if (index >= 0) { entries.splice(index, 1); active--; }
      return originalRemove.call(this, type, listener, options);
    };
    window.__qaListeners = () => ({ active, registrations });
  });
  const page = await context.newPage();
  page.on('console', (message) => consoleMessages.push({ type: message.type(), text: message.text().slice(0, 500) }));
  page.on('pageerror', (error) => pageErrors.push(error.message));
  try {
    await page.goto(URL, { waitUntil: 'domcontentloaded' });
    await page.locator('button').filter({ hasText: 'New Empire' }).first().click();
    await page.getByRole('button', { name: 'Buy', exact: true }).first().click();
    await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 60000 });
    await page.waitForFunction(() => {
      const veil = document.querySelector('.load-veil');
      return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
    }, null, { timeout: 60000 });
    await page.waitForTimeout(2000);
    const fixture = await page.evaluate(async () => {
      const app = window.__fw;
      const reservations = await import(new URL('src/sim/reservations.js', document.baseURI).href);
      const { calendarOf } = await import(new URL('src/sim/time.js', document.baseURI).href);
      const cal = calendarOf(app.state.clock.minutes);
      reservations.initReservations(app.state);
      const created = [600, 630, 660].map((minute, index) => reservations.bookSlot(
        app.state, cal.dayAbs, minute, ['Priya Nguyen', 'Marcus Reed', 'Elaine Castillo'][index],
      ));
      app.state.clock.minutes = cal.dayAbs * 1440 + 9 * 60 + 20;
      app.speedIdx = 0;
      app.scene3d.applyTimeWeather(9 * 60 + 20, app.state.weather);
      const clubhouse = app.scene3d.clubhouse();
      const walk = app.scene3d.walk.state;
      walk.x = clubhouse.interior.position.x + 0.5;
      walk.z = clubhouse.interior.position.z + 2.3;
      walk.yaw = -2.75;
      walk.pitch = -0.08;
      return {
        created: created.map((entry) => ({ ok: entry.ok, name: entry.res?.name, minute: entry.res?.minute })),
        camera: { localX: 0.5, localZ: 2.3, yaw: -2.75, pitch: -0.08 },
      };
    });
    await page.waitForTimeout(2500);

    const listenersBefore = await page.evaluate(() => window.__qaListeners());
    const metrics = await page.evaluate(async () => {
      const scene3d = window.__fw.scene3d;
      const renderer = scene3d.renderer;
      let mutationCallbacks = 0;
      const observer = new MutationObserver(() => { mutationCallbacks++; });
      observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
      const intervals = [];
      await new Promise((resolve) => {
        let start = 0;
        let last = 0;
        const frame = (time) => {
          if (!start) { start = time; last = time; requestAnimationFrame(frame); return; }
          intervals.push(time - last);
          last = time;
          if (time - start >= 8000) resolve();
          else requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      });
      observer.disconnect();
      const sorted = [...intervals].sort((a, b) => b - a);
      const slowN = Math.max(1, Math.ceil(sorted.length * 0.01));
      const slowMean = sorted.slice(0, slowN).reduce((sum, value) => sum + value, 0) / slowN;
      const averageMs = intervals.reduce((sum, value) => sum + value, 0) / Math.max(1, intervals.length);

      const oldAutoReset = renderer.info.autoReset;
      renderer.info.autoReset = false;
      renderer.info.reset();
      const renderInfo = await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve({
        drawCalls: renderer.info.render.calls,
        renderedTriangles: renderer.info.render.triangles,
      }))));
      renderer.info.autoReset = oldAutoReset;

      const materials = new Map();
      const textures = new Map();
      let sceneTriangles = 0;
      scene3d.scene.traverse((object) => {
        if (!object.isMesh || !object.visible) return;
        const geometry = object.geometry;
        const triangles = geometry?.index ? geometry.index.count / 3
          : geometry?.attributes?.position ? geometry.attributes.position.count / 3 : 0;
        sceneTriangles += triangles * (object.isInstancedMesh ? object.count : 1);
        for (const material of (Array.isArray(object.material) ? object.material : [object.material])) {
          if (!material) continue;
          materials.set(material.uuid, material);
          for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap']) {
            if (material[key]) textures.set(material[key].uuid, material[key]);
          }
        }
      });
      let estimatedTextureMemoryBytes = 0;
      for (const texture of textures.values()) {
        const image = texture?.image;
        const width = Number(image?.width || image?.videoWidth || 0);
        const height = Number(image?.height || image?.videoHeight || 0);
        estimatedTextureMemoryBytes += width * height * 4 * (texture.generateMipmaps === false ? 1 : 4 / 3);
      }
      return {
        samples: intervals.length,
        averageFps: 1000 / averageMs,
        onePercentLowFps: 1000 / slowMean,
        worstFrameMs: Math.max(...intervals),
        ...renderInfo,
        sceneTriangles,
        materials: materials.size,
        textures: textures.size,
        estimatedTextureMemoryBytes,
        rendererTextures: renderer.info.memory.textures,
        rendererGeometries: renderer.info.memory.geometries,
        jsHeapBytes: performance.memory?.usedJSHeapSize ?? null,
        uiMutationCallbacks: mutationCallbacks,
      };
    });
    const listenersAfter = await page.evaluate(() => window.__qaListeners());
    const evidence = {
      capturedAt: new Date().toISOString(),
      // Declared software-relative (HARNESS_TRUST.md rule 5): SwiftShader is
      // pinned for determinism; numbers are before/after-comparable only.
      softwareRelativeOnly: true,
      label: LABEL,
      url: URL,
      browser: await browser.version(),
      fixture,
      metrics,
      listeners: {
        before: listenersBefore,
        after: listenersAfter,
        activeDelta: listenersAfter.active - listenersBefore.active,
        registrationDelta: listenersAfter.registrations - listenersBefore.registrations,
      },
      consoleMessages,
      pageErrors,
    };
    if (OUT) fs.writeFileSync(path.join(OUT, `${LABEL}.json`), `${JSON.stringify(evidence, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
