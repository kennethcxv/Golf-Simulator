'use strict';

// Repeatable golf-loop performance baseline/after harness. It uses the same
// course, camera, viewport, warm-up, browser, sample durations, and golfer load
// for both labels. Three samples per scenario are retained to expose host noise.

const fs = require('fs');
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const URL = process.env.QA_URL || 'http://127.0.0.1:8469/';
const OUT = path.resolve(process.env.QA_OUT || 'qa/golf-gameplay-loop/baseline/performance');
const LABEL = process.env.QA_LABEL || 'before-main';
const VIEWPORT = { width: 1600, height: 900 };
const SAMPLE_MS = 5000;
const SAMPLE_COUNT = 3;

async function placeFirstTeeCamera(page) {
  return page.evaluate(() => {
    const state = window.__fw.state;
    const hole = state.course.holes[0];
    const cellYd = 8;
    const worldW = state.course.w * cellYd;
    const worldH = state.course.h * cellYd;
    const point = (p) => ({
      x: (p.x + 0.5) * cellYd - worldW / 2,
      z: (p.y + 0.5) * cellYd - worldH / 2,
    });
    const tee = point(hole.tee);
    const pin = point(hole.pin);
    const dx = pin.x - tee.x;
    const dz = pin.z - tee.z;
    const len = Math.hypot(dx, dz) || 1;
    const walk = window.__fw.scene3d.walk.state;
    walk.x = tee.x - (dx / len) * 16;
    walk.z = tee.z - (dz / len) * 16;
    const targetX = tee.x + (dx / len) * 36;
    const targetZ = tee.z + (dz / len) * 36;
    walk.yaw = Math.atan2(-(targetX - walk.x), -(targetZ - walk.z));
    walk.pitch = -0.045;
    return { x: walk.x, z: walk.z, targetX, targetZ, yaw: walk.yaw, pitch: walk.pitch };
  });
}

async function sample(page, label) {
  return page.evaluate(async ({ duration, label: sampleLabel }) => {
    const scene3d = window.__fw.scene3d;
    const renderer = scene3d.renderer;
    const intervals = [];
    let uiMutationCallbacks = 0;
    const observer = new MutationObserver(() => { uiMutationCallbacks++; });
    observer.observe(document.querySelector('#ui') || document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    });
    await new Promise((resolve) => {
      let start = 0;
      let last = 0;
      const frame = (time) => {
        if (!start) {
          start = time;
          last = time;
          requestAnimationFrame(frame);
          return;
        }
        intervals.push(time - last);
        last = time;
        if (time - start >= duration) resolve();
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
    let courseCharacters = 0;
    scene3d.scene.traverse((object) => {
      if (object.userData?.char && object.position.z < 210) courseCharacters++;
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
      label: sampleLabel,
      durationMs: duration,
      samples: intervals.length,
      validFrameSample: intervals.length >= 30,
      averageFps: +(1000 / averageMs).toFixed(2),
      onePercentLowFps: +(1000 / slowMean).toFixed(2),
      worstFrameMs: +Math.max(...intervals).toFixed(2),
      ...renderInfo,
      sceneTriangles: Math.round(sceneTriangles),
      materials: materials.size,
      textures: textures.size,
      estimatedTextureMemoryBytes: Math.round(estimatedTextureMemoryBytes),
      rendererTextures: renderer.info.memory.textures,
      rendererGeometries: renderer.info.memory.geometries,
      jsHeapBytes: performance.memory?.usedJSHeapSize ?? null,
      activeListeners: window.__qaListeners?.().active ?? null,
      listenerRegistrations: window.__qaListeners?.().registrations ?? null,
      uiMutationCallbacks,
      uiMutationCallbacksPerSecond: +(uiMutationCallbacks / (duration / 1000)).toFixed(2),
      courseCharacters,
    };
  }, { duration: SAMPLE_MS, label });
}

function summarize(samples) {
  const valid = samples.filter((entry) => entry.validFrameSample);
  const source = valid.length ? valid : samples;
  const median = (key) => {
    const values = source.map((entry) => entry[key]).sort((a, b) => a - b);
    return values[Math.floor(values.length / 2)];
  };
  return {
    validRuns: valid.length,
    totalRuns: samples.length,
    statisticallyUsable: valid.length >= 2,
    medianAverageFps: median('averageFps'),
    medianOnePercentLowFps: median('onePercentLowFps'),
    medianWorstFrameMs: median('worstFrameMs'),
    medianDrawCalls: median('drawCalls'),
    medianRenderedTriangles: median('renderedTriangles'),
    medianSceneTriangles: median('sceneTriangles'),
    medianMaterials: median('materials'),
    medianTextures: median('textures'),
    medianEstimatedTextureMemoryBytes: median('estimatedTextureMemoryBytes'),
    medianRendererGeometries: median('rendererGeometries'),
    medianHeapBytes: median('jsHeapBytes'),
    medianUiMutationCallbacksPerSecond: median('uiMutationCallbacksPerSecond'),
    medianCourseCharacters: median('courseCharacters'),
  };
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const consoleMessages = [];
  const pageErrors = [];
  const failedRequests = [];
  const launch = {
    headless: true,
    args: ['--enable-precise-memory-info', '--enable-gpu', '--enable-webgl', '--ignore-gpu-blocklist'],
  };
  if (process.env.QA_BROWSER_PATH) launch.executablePath = process.env.QA_BROWSER_PATH;
  else launch.channel = 'chrome';
  const browser = await chromium.launch(launch);
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  await context.addInitScript(() => {
    let qaSeed = 20260719;
    Math.random = () => {
      qaSeed = (Math.imul(qaSeed, 1664525) + 1013904223) >>> 0;
      return qaSeed / 4294967296;
    };
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
  page.on('console', (message) => consoleMessages.push({ type: message.type(), text: message.text().slice(0, 700) }));
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
    const setup = await page.evaluate(() => {
      const app = window.__fw;
      app.speedIdx = 0;
      app.state.clock.minutes = 9 * 60 + 20;
      app.state.club.lastRounds = 0;
      app.scene3d.applyTimeWeather(9 * 60 + 20, app.state.weather);
      app.scene3d.setGolfersFrozen(true);
      return { seed: app.state.seed, mode: app.state.mode, clubName: app.state.clubName };
    });
    const camera = await placeFirstTeeCamera(page);
    await page.waitForTimeout(8000);

    const listenersBefore = await page.evaluate(() => window.__qaListeners());
    const idle = [];
    for (let i = 0; i < SAMPLE_COUNT; i++) idle.push(await sample(page, `idle-${i + 1}`));
    await page.screenshot({ path: path.join(OUT, `${LABEL}-idle.png`) });

    const activeSetup = await page.evaluate(async () => {
      const app = window.__fw;
      const reservations = await import('/src/sim/reservations.js');
      const golf = await import('/src/sim/golfDay.js');
      reservations.resetGolfOperationsQA(app.state, { horizonDays: 7 });
      const create = (holder, minute, arrival, transport, size) => {
        app.state.clock.minutes = arrival;
        const booked = reservations.bookSlot(app.state, 0, minute, {
          holder,
          customerNames: Array.from({ length: size }, (_, index) => index ? `${holder} Guest ${index + 1}` : holder),
          partySize: size,
          transport,
        });
        if (!booked.ok) throw new Error(booked.reason);
        const entry = booked.res;
        reservations.markReservationArrived(app.state, entry.id, arrival);
        reservations.confirmReservation(app.state, entry.id, arrival);
        const payment = reservations.beginReservationPayment(app.state, entry.id, 'card');
        reservations.completeReservationPayment(app.state, entry.id, { transactionId: payment.transactionId });
        reservations.checkInReservation(app.state, entry.id, { atMinute: arrival });
      };
      create('Avery Monroe', 600, 560, 'walk', 2);
      create('Devon Park', 600, 561, 'ride', 2);
      create('Caleb Foster', 630, 562, 'walk', 3);
      create('Imani Cole', 660, 563, 'ride', 2);
      app.state.clock.minutes = 700;
      golf.golfDayTick(app.state, 700);
      // Keep the exact idle/baseline lighting while advancing canonical play.
      app.scene3d.applyTimeWeather(560, app.state.weather);
      app.scene3d.setGolfersFrozen(false);
      return {
        minuteOfDay: 700,
        visualMinuteOfDay: 560,
        parties: app.state.golfDay.parties.length,
        golfers: app.state.golfDay.parties.reduce((sum, party) => sum + party.golfers.length, 0),
        carts: app.state.golfDay.carts.filter((cart) => cart.status === 'assigned').length,
      };
    });
    await page.waitForFunction(() => {
      let count = 0;
      window.__fw.scene3d.scene.traverse((object) => {
        if (object.userData?.golferId) count++;
      });
      return count >= 9;
    }, null, { timeout: 60000 });
    await page.waitForTimeout(3000);
    const ambient = [];
    for (let i = 0; i < SAMPLE_COUNT; i++) ambient.push(await sample(page, `ambient-${i + 1}`));
    await page.screenshot({ path: path.join(OUT, `${LABEL}-ambient.png`) });
    const listenersAfter = await page.evaluate(() => window.__qaListeners());

    const evidence = {
      capturedAt: new Date().toISOString(),
      label: LABEL,
      commit: process.env.QA_COMMIT || null,
      url: URL,
      browser: await browser.version(),
      viewport: { ...VIEWPORT, deviceScaleFactor: 1 },
      quality: 'repository defaults',
      fixture: {
        ...setup,
        day: 0,
        minuteOfDay: 560,
        camera,
        idle: { lastRounds: 0, golfersFrozen: true },
        ambient: { canonicalLivePlay: activeSetup, minimumLiveGolferVisuals: 9 },
        warmupMs: 8000,
        sampleCount: SAMPLE_COUNT,
        sampleDurationMs: SAMPLE_MS,
      },
      raw: { idle, ambient },
      summary: { idle: summarize(idle), ambient: summarize(ambient) },
      listeners: {
        before: listenersBefore,
        after: listenersAfter,
        activeDelta: listenersAfter.active - listenersBefore.active,
        registrationDelta: listenersAfter.registrations - listenersBefore.registrations,
      },
      consoleMessages,
      pageErrors,
      failedRequests,
    };
    fs.writeFileSync(path.join(OUT, `${LABEL}.json`), `${JSON.stringify(evidence, null, 2)}\n`);
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
