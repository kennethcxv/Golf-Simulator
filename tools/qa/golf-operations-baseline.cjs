'use strict';

// Golf operations baseline capture. This deliberately exercises the shipped
// reservation/check-in path before the production operations layer replaces it.
//
// Run with a Playwright installation available to Node:
//   PLAYWRIGHT_MODULE=<path-to-playwright> node tools/qa/golf-operations-baseline.cjs

const fs = require('fs');
const path = require('path');

const playwrightModule = process.env.PLAYWRIGHT_MODULE || 'playwright';
const { chromium } = require(playwrightModule);

const URL = process.env.QA_URL || 'http://127.0.0.1:8467/';
const OUT = path.resolve(process.env.QA_OUT || 'qa/golf-operations/baseline');
const VIEWPORT = { width: 1600, height: 900 };

async function clickProjectedNav(page, label) {
  const button = page.locator('.lt-navbtn').filter({ hasText: label });
  const box = await button.boundingBox();
  if (!box) throw new Error(`Projected laptop navigation is not visible: ${label}`);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.click(x, y);
}

async function sampleRuntime(page, durationMs) {
  return page.evaluate(async (duration) => {
    const scene3d = window.__fw.scene3d;
    const renderer = scene3d.renderer;
    const intervals = [];

    await new Promise((resolve) => {
      let start = 0;
      let last = 0;
      function frame(t) {
        if (!start) {
          start = t;
          last = t;
          requestAnimationFrame(frame);
          return;
        }
        intervals.push(t - last);
        last = t;
        if (t - start >= duration) resolve();
        else requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    });

    const sorted = [...intervals].sort((a, b) => b - a);
    const slowN = Math.max(1, Math.ceil(sorted.length * 0.01));
    const slowMean = sorted.slice(0, slowN).reduce((a, b) => a + b, 0) / slowN;
    const avgMs = intervals.reduce((a, b) => a + b, 0) / Math.max(1, intervals.length);

    const frameRender = await new Promise((resolve) => {
      const oldAuto = renderer.info.autoReset;
      renderer.info.autoReset = false;
      requestAnimationFrame(() => {
        renderer.info.reset();
        requestAnimationFrame(() => {
          const value = {
            calls: renderer.info.render.calls,
            triangles: renderer.info.render.triangles,
          };
          renderer.info.autoReset = oldAuto;
          resolve(value);
        });
      });
    });

    const materials = new Set();
    const textures = new Set();
    let sceneTriangles = 0;
    scene3d.scene.traverse((object) => {
      if (!object.isMesh || !object.visible) return;
      const geometry = object.geometry;
      const triangles = geometry?.index
        ? geometry.index.count / 3
        : (geometry?.attributes?.position ? geometry.attributes.position.count / 3 : 0);
      sceneTriangles += triangles * (object.isInstancedMesh ? object.count : 1);
      for (const material of (Array.isArray(object.material) ? object.material : [object.material])) {
        if (!material) continue;
        materials.add(material.uuid);
        for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap']) {
          if (material[key]) textures.add(material[key]);
        }
      }
    });

    // Explicit estimate source: width x height x RGBA8 x mip-chain factor.
    let textureBytes = 0;
    for (const texture of textures) {
      const image = texture.image;
      const width = image?.videoWidth || image?.naturalWidth || image?.width || 0;
      const height = image?.videoHeight || image?.naturalHeight || image?.height || 0;
      textureBytes += width * height * 4 * (texture.generateMipmaps === false ? 1 : 4 / 3);
    }

    return {
      sampleDurationMs: duration,
      frames: intervals.length,
      averageFps: +(1000 / avgMs).toFixed(2),
      onePercentLowFps: +(1000 / slowMean).toFixed(2),
      worstFrameMs: +Math.max(...intervals).toFixed(2),
      drawCalls: frameRender.calls,
      renderedTriangles: frameRender.triangles,
      sceneTriangles: Math.round(sceneTriangles),
      materialCount: materials.size,
      textureCount: textures.size,
      textureMemoryBytesEstimatedRgbaMipmapped: Math.round(textureBytes),
      rendererTextureCount: renderer.info.memory.textures,
      rendererGeometryCount: renderer.info.memory.geometries,
      jsHeapUsedBytes: performance.memory?.usedJSHeapSize ?? null,
    };
  }, durationMs);
}

async function main() {
  fs.mkdirSync(path.join(OUT, 'video'), { recursive: true });
  const consoleMessages = [];
  const pageErrors = [];
  const failedRequests = [];
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-precise-memory-info'],
  });
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    recordVideo: { dir: path.join(OUT, 'video'), size: VIEWPORT },
  });

  await context.addInitScript(() => {
    const originalAdd = EventTarget.prototype.addEventListener;
    const originalRemove = EventTarget.prototype.removeEventListener;
    const registry = new WeakMap();
    let active = 0;
    const captureOf = (opts) => (typeof opts === 'boolean' ? opts : !!(opts && opts.capture));

    EventTarget.prototype.addEventListener = function addEventListener(type, listener, opts) {
      if (listener) {
        let byType = registry.get(this);
        if (!byType) {
          byType = new Map();
          registry.set(this, byType);
        }
        let entries = byType.get(type);
        if (!entries) {
          entries = [];
          byType.set(type, entries);
        }
        const capture = captureOf(opts);
        if (!entries.some((entry) => entry.listener === listener && entry.capture === capture)) {
          entries.push({ listener, capture });
          active++;
        }
      }
      return originalAdd.call(this, type, listener, opts);
    };

    EventTarget.prototype.removeEventListener = function removeEventListener(type, listener, opts) {
      const entries = registry.get(this)?.get(type);
      const capture = captureOf(opts);
      const i = entries
        ? entries.findIndex((entry) => entry.listener === listener && entry.capture === capture)
        : -1;
      if (i >= 0) {
        entries.splice(i, 1);
        active--;
      }
      return originalRemove.call(this, type, listener, opts);
    };
    window.__qaActiveListeners = () => active;
  });

  const page = await context.newPage();
  const video = page.video();
  page.on('console', (message) => consoleMessages.push({
    type: message.type(),
    text: message.text().slice(0, 500),
  }));
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('requestfailed', (request) => failedRequests.push({
    url: request.url(),
    failure: request.failure()?.errorText || 'failed',
  }));

  try {
    await page.goto(URL, { waitUntil: 'domcontentloaded' });
    await page.locator('button').filter({ hasText: 'New Empire' }).first().click();
    await page.getByRole('button', { name: 'Buy', exact: true }).first().click();
    await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 60000 });
    await page.waitForFunction(() => {
      const veil = document.querySelector('.load-veil');
      return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
    }, null, { timeout: 60000 });
    await page.waitForTimeout(2500);

    const fixture = await page.evaluate(async () => {
      const app = window.__fw;
      const reservations = await import('/src/sim/reservations.js');
      const time = await import('/src/sim/time.js');
      const cal = time.calendarOf(app.state.clock.minutes);
      app.state.clock.minutes = cal.dayAbs * 1440 + 9 * 60 + 20;
      const names = ['Priya Nguyen', 'Marcus Reed', 'Elaine Castillo'];
      const minutes = [600, 630, 660];
      const created = minutes.map((minute, i) => reservations.bookSlot(app.state, cal.dayAbs, minute, names[i]));
      app.scene3d.applyTimeWeather(9 * 60 + 20, app.state.weather);
      const clubhouse = app.scene3d.clubhouse();
      const walk = app.scene3d.walk.state;
      walk.x = clubhouse.interior.position.x + 0.5;
      walk.z = clubhouse.interior.position.z + 2.3;
      walk.yaw = -2.75;
      walk.pitch = -0.08;
      return {
        dayAbs: cal.dayAbs,
        created: created.map((entry) => ({
          ok: entry.ok,
          name: entry.res?.name,
          minute: entry.res?.minute,
        })),
      };
    });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(OUT, '01-front-desk-fixed-camera.png') });

    await page.evaluate(() => {
      const app = window.__fw;
      const origin = app.scene3d.clubhouse().interior.position;
      const walk = app.scene3d.walk.state;
      walk.x = 8.45 + origin.x;
      walk.z = 4.5 + origin.z;
      walk.yaw = -Math.PI / 2;
      walk.pitch = -0.05;
    });
    await page.waitForTimeout(700);
    await page.keyboard.press('e');
    await page.waitForFunction(() => window.__fw.laptopOpen === true, null, { timeout: 10000 });
    await page.waitForFunction(() => {
      const root = document.querySelector('.laptop-screen');
      const frame = document.querySelector('.lt-frame');
      return root && root.style.display !== 'none' && frame?.getBoundingClientRect().width > 100;
    }, null, { timeout: 20000 });
    await page.waitForTimeout(900);

    await clickProjectedNav(page, 'Reservations');
    await page.waitForFunction(() => document.querySelector('.lt-h1')?.textContent.includes('Reservations'));
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT, '02-legacy-tee-sheet.png') });

    const listenersBefore = await page.evaluate(() => window.__qaActiveListeners());
    let mutationCount = 0;
    await page.exposeFunction('__qaMutation', () => { mutationCount++; });
    await page.evaluate(() => {
      const root = document.querySelector('.lt-content');
      window.__qaObserver = new MutationObserver(() => window.__qaMutation());
      window.__qaObserver.observe(root, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
      });
    });
    for (let i = 0; i < 6; i++) {
      await clickProjectedNav(page, i % 2 ? 'Reservations' : 'Home');
      await page.waitForTimeout(160);
    }
    await page.waitForTimeout(1200);
    await page.evaluate(() => window.__qaObserver.disconnect());
    const listenersAfter = await page.evaluate(() => window.__qaActiveListeners());
    const runtime = await sampleRuntime(page, 5000);
    await page.screenshot({ path: path.join(OUT, '03-bookings-after-repeat-navigation.png') });

    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.__fw.laptopOpen === false, null, { timeout: 10000 });
    await page.evaluate(() => {
      const app = window.__fw;
      const walk = app.scene3d.walk.state;
      walk.x = 2.80 - 8;
      walk.z = 5.10 + 228;
      walk.yaw = 0;
      walk.pitch = -0.18;
    });
    await page.waitForFunction(() => (
      window.__fw.scene3d.clubhouse().customers.some((customer) => customer.isGolfer && customer.queued)
    ), null, { timeout: 45000 });
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(OUT, '04-arrival-at-register.png') });

    const beforeCheckIn = await page.evaluate(() => ({
      cash: window.__fw.state.cash,
      due: window.__fw.state.reservations.booked
        .filter((reservation) => reservation.status === 'booked')
        .map((reservation) => ({ id: reservation.id, name: reservation.name, status: reservation.status })),
      npcNames: window.__fw.scene3d.clubhouse().customers
        .filter((customer) => customer.isGolfer)
        .map((customer) => customer.name),
    }));
    await page.keyboard.press('e');
    await page.waitForTimeout(700);
    const afterCheckIn = await page.evaluate(() => ({
      cash: window.__fw.state.cash,
      reservations: window.__fw.state.reservations.booked.map((reservation) => ({
        id: reservation.id,
        name: reservation.name,
        status: reservation.status,
      })),
      greenFees: window.__fw.state.ledger.today.revenue.greenFees,
    }));
    await page.screenshot({ path: path.join(OUT, '05-single-key-auto-charge.png') });

    const evidence = {
      capturedAt: new Date().toISOString(),
      branch: 'overnight/golf-operations',
      commit: process.env.QA_COMMIT || '0c5137e',
      launch: `QA_URL=${URL}`,
      browser: await browser.version(),
      viewport: { ...VIEWPORT, deviceScaleFactor: 1 },
      fixture,
      fixedCameras: {
        frontDeskOverview: { local: { x: 0.5, z: 2.3 }, yaw: -2.75, pitch: -0.08 },
        laptopSeat: { local: { x: 8.45, z: 4.5 }, yaw: -Math.PI / 2, pitch: -0.05 },
        cashier: { world: { x: -5.2, z: 233.1 }, yaw: 0, pitch: -0.18 },
      },
      runtime,
      listeners: {
        beforeRepeatedNavigation: listenersBefore,
        afterRepeatedNavigation: listenersAfter,
        delta: listenersAfter - listenersBefore,
      },
      uiMutationCallbacksDuringSixNavClicks: mutationCount,
      beforeCheckIn,
      afterCheckIn,
      consoleMessages,
      pageErrors,
      failedRequests,
    };
    fs.writeFileSync(path.join(OUT, 'baseline.json'), `${JSON.stringify(evidence, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  } finally {
    await context.close();
    const videoPath = await video.path();
    fs.copyFileSync(videoPath, path.join(OUT, 'baseline-route.webm'));
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
