'use strict';

const fs = require('fs');
const path = require('path');

function loadPlaywright() {
  const candidates = [
    'playwright',
    process.env.PLAYWRIGHT_PATH,
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch {
      // Keep the shipped package free of browser-only QA dependencies.
    }
  }
  throw new Error('Playwright is unavailable. Install it or set PLAYWRIGHT_PATH.');
}

const { chromium } = loadPlaywright();
const ROOT = path.resolve(__dirname, '../..');
const PHASE = process.env.QA_PHASE || 'baseline';
const PORT = Number(process.env.QA_PORT || 8462);
const OUT = path.join(ROOT, 'qa/course-maintenance', PHASE, 'performance');
const FIXTURE_SEED = 20260719;
const HERO_INDEX = 3;
const SAMPLE_MS = Number(process.env.QA_SAMPLE_MS || 6000);
const SAMPLE_COUNT = Number(process.env.QA_SAMPLE_COUNT || 3);

function installListenerProbe() {
  const add = EventTarget.prototype.addEventListener;
  const remove = EventTarget.prototype.removeEventListener;
  const records = new WeakMap();
  const stats = { active: 0, added: 0, removed: 0, byType: {} };
  const captureOf = (options) => (
    typeof options === 'boolean' ? options : !!(options && options.capture)
  );

  EventTarget.prototype.addEventListener = function trackedAdd(type, fn, options) {
    if (!fn) return add.call(this, type, fn, options);
    let byType = records.get(this);
    if (!byType) {
      byType = new Map();
      records.set(this, byType);
    }
    let byFn = byType.get(type);
    if (!byFn) {
      byFn = new Map();
      byType.set(type, byFn);
    }
    let captures = byFn.get(fn);
    if (!captures) {
      captures = new Set();
      byFn.set(fn, captures);
    }
    const capture = captureOf(options);
    if (!captures.has(capture)) {
      captures.add(capture);
      stats.active++;
      stats.added++;
      stats.byType[type] = (stats.byType[type] || 0) + 1;
    }
    return add.call(this, type, fn, options);
  };

  EventTarget.prototype.removeEventListener = function trackedRemove(type, fn, options) {
    const capture = captureOf(options);
    const captures = records.get(this)?.get(type)?.get(fn);
    if (captures?.has(capture)) {
      captures.delete(capture);
      stats.active--;
      stats.removed++;
      stats.byType[type] = Math.max(0, (stats.byType[type] || 1) - 1);
    }
    return remove.call(this, type, fn, options);
  };
  window.__qaListenerStats = stats;
}

async function establishFixture(page) {
  await page.goto('http://127.0.0.1:' + PORT + '/', {
    waitUntil: 'domcontentloaded',
  });
  await page.evaluate(async (fixtureSeed) => {
    localStorage.clear();
    const module = await import(new URL('src/sim/empire.js', document.baseURI).href);
    const empire = module.newEmpire('relaxed', fixtureSeed);
    const property = empire.market.find((item) => (
      item.name === 'Willow Creek Municipal'
    ));
    const bought = module.buyProperty(empire, property.id);
    if (!bought.ok) throw new Error(bought.reason);
    bought.state.tractor.repaired = true;
    for (const step of Object.keys(bought.state.tractor.steps)) {
      bought.state.tractor.steps[step] = true;
    }
    localStorage.setItem(
      'golfempire:autosave',
      JSON.stringify(module.empireSnapshot(empire)),
    );
  }, FIXTURE_SEED);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.waitForFunction(
    () => window.__fw?.scene3d?.walk?.state && window.__fw?.state?.tractor?.repaired,
    null,
    { timeout: 20000 },
  );
  await page.waitForTimeout(9500);
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.__fw?.speedIdx === 0);
  await page.evaluate(() => window.__fw.scene3d.setGolfersFrozen(true));
}

async function prepareHeroRoute(page, fraction) {
  return page.evaluate(({ heroIndex, fraction }) => {
    const app = window.__fw;
    const state = app.state;
    const hole = state.course.holes[heroIndex];
    const cellYd = 8;
    const worldW = state.course.w * cellYd;
    const worldH = state.course.h * cellYd;
    const world = (point) => ({
      x: (point.x + 0.5) * cellYd - worldW / 2,
      z: (point.y + 0.5) * cellYd - worldH / 2,
    });
    const tee = world(hole.tee);
    const pin = world(hole.pin);
    const dx = pin.x - tee.x;
    const dz = pin.z - tee.z;
    const len = Math.hypot(dx, dz);
    const direction = { x: dx / len, z: dz / len };
    const start = {
      x: tee.x + direction.x * len * fraction,
      z: tee.z + direction.z * len * fraction,
    };

    for (let i = 0; i < state.course.zones.length; i++) {
      const x = i % state.course.w;
      const y = Math.floor(i / state.course.w);
      const ax = x - hole.tee.x;
      const ay = y - hole.tee.y;
      const bx = hole.pin.x - hole.tee.x;
      const by = hole.pin.y - hole.tee.y;
      const t = Math.max(0, Math.min(1, (ax * bx + ay * by) / (bx * bx + by * by)));
      const px = hole.tee.x + bx * t;
      const py = hole.tee.y + by * t;
      if (Math.hypot(x - px, y - py) > 5) continue;
      const zone = state.course.zones[i];
      const target = zone === 3 ? 4 : zone === 4 ? 10 : zone === 2 ? 14 : zone === 1 ? 45 : null;
      if (target !== null) state.turf.heightMm[i] = target + 9;
    }
    app.scene3d.updateTurf(state);

    const yaw = Math.atan2(-direction.x, -direction.z);
    const walkApi = app.scene3d.walk;
    walkApi.cart.mounted = false;
    walkApi.cart.speed = walkApi.cart.speed || 22;
    walkApi.placeCart(start.x, start.z, yaw);
    walkApi.state.x = start.x - direction.x * 2.5;
    walkApi.state.z = start.z - direction.z * 2.5;
    walkApi.state.yaw = yaw;
    walkApi.state.pitch = -0.08;
    return {
      start,
      direction,
      yaw,
      target: pin,
      focus: walkApi.getFocusLabel(),
    };
  }, { heroIndex: HERO_INDEX, fraction });
}

async function positionIdleCamera(page) {
  return page.evaluate((heroIndex) => {
    const app = window.__fw;
    const state = app.state;
    const hole = state.course.holes[heroIndex];
    const cellYd = 8;
    const worldW = state.course.w * cellYd;
    const worldH = state.course.h * cellYd;
    const world = (point) => ({
      x: (point.x + 0.5) * cellYd - worldW / 2,
      z: (point.y + 0.5) * cellYd - worldH / 2,
    });
    const tee = world(hole.tee);
    const pin = world(hole.pin);
    const dx = pin.x - tee.x;
    const dz = pin.z - tee.z;
    const len = Math.hypot(dx, dz);
    const direction = { x: dx / len, z: dz / len };
    const walk = app.scene3d.walk.state;
    walk.x = tee.x + direction.x * len * 0.32;
    walk.z = tee.z + direction.z * len * 0.32;
    walk.yaw = Math.atan2(-direction.x, -direction.z);
    walk.pitch = -0.06;
    return { x: walk.x, z: walk.z, yaw: walk.yaw, pitch: walk.pitch };
  }, HERO_INDEX);
}

async function frameSample(page, durationMs) {
  return page.evaluate(async (duration) => {
    const renderer = window.__fw.scene3d.renderer;
    const info = renderer.info;
    const oldAutoReset = info.autoReset;
    info.autoReset = false;
    info.reset();
    const frameTimes = [];
    let mutationCount = 0;
    const ui = document.getElementById('ui');
    const observer = new MutationObserver((records) => {
      mutationCount += records.length;
    });
    if (ui) {
      observer.observe(ui, {
        subtree: true,
        childList: true,
        attributes: true,
        characterData: true,
      });
    }
    const heapBefore = performance.memory?.usedJSHeapSize ?? null;
    const start = performance.now();
    let previous = null;
    await new Promise((resolve) => {
      function next(now) {
        if (previous !== null) frameTimes.push(now - previous);
        previous = now;
        if (now - start >= duration) {
          resolve();
        } else {
          requestAnimationFrame(next);
        }
      }
      requestAnimationFrame(next);
    });
    observer.disconnect();
    const elapsedMs = performance.now() - start;
    const heapAfter = performance.memory?.usedJSHeapSize ?? null;
    const sortedWorst = [...frameTimes].sort((a, b) => b - a);
    const worstCount = Math.max(1, Math.ceil(sortedWorst.length * 0.01));
    const worstOnePercentMs = sortedWorst
      .slice(0, worstCount)
      .reduce((sum, value) => sum + value, 0) / worstCount;
    const frameCount = frameTimes.length;
    const renderCalls = info.render.calls;
    const renderedTriangles = info.render.triangles;
    const renderedLines = info.render.lines;
    const renderedPoints = info.render.points;
    info.autoReset = oldAutoReset;
    info.reset();
    return {
      durationMs: elapsedMs,
      frameCount,
      averageFps: frameCount / (elapsedMs / 1000),
      onePercentLowFps: 1000 / worstOnePercentMs,
      worstFrameMs: sortedWorst[0] || 0,
      p99FrameMs: sortedWorst[Math.max(0, worstCount - 1)] || 0,
      longFramesOver50Ms: frameTimes.filter((value) => value > 50).length,
      longFramesOver100Ms: frameTimes.filter((value) => value > 100).length,
      drawCallsPerFrame: renderCalls / Math.max(1, frameCount),
      trianglesPerFrame: renderedTriangles / Math.max(1, frameCount),
      linesPerFrame: renderedLines / Math.max(1, frameCount),
      pointsPerFrame: renderedPoints / Math.max(1, frameCount),
      uiMutationsPerSecond: mutationCount / (elapsedMs / 1000),
      uiMutationCount: mutationCount,
      jsHeapBeforeBytes: heapBefore,
      jsHeapAfterBytes: heapAfter,
      jsHeapDeltaBytes: heapBefore !== null && heapAfter !== null
        ? heapAfter - heapBefore
        : null,
    };
  }, durationMs);
}

async function mountNormally(page) {
  await page.waitForTimeout(350);
  await page.keyboard.press('e');
  await page.waitForFunction(
    () => window.__fw.scene3d.walk.cart.mounted,
    null,
    { timeout: 3000 },
  );
}

async function unmountNormally(page) {
  await page.keyboard.press('e');
  await page.waitForFunction(
    () => !window.__fw.scene3d.walk.cart.mounted,
    null,
    { timeout: 3000 },
  );
}

function mean(samples, key) {
  const values = samples.map((sample) => sample[key]).filter(Number.isFinite);
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;
}

function summarize(samples) {
  const keys = [
    'averageFps',
    'onePercentLowFps',
    'worstFrameMs',
    'longFramesOver50Ms',
    'longFramesOver100Ms',
    'drawCallsPerFrame',
    'trianglesPerFrame',
    'uiMutationsPerSecond',
    'jsHeapDeltaBytes',
  ];
  return Object.fromEntries(keys.map((key) => [key, mean(samples, key)]));
}

async function resourceSnapshot(page) {
  return page.evaluate(async () => {
    const app = window.__fw;
    const renderer = app.scene3d.renderer;
    const materials = new Set();
    const textures = new Set();
    const textureKeys = [
      'map', 'normalMap', 'roughnessMap', 'metalnessMap',
      'aoMap', 'emissiveMap', 'alphaMap', 'bumpMap',
    ];
    app.scene3d.scene.traverse((object) => {
      if (!object.material) return;
      const list = Array.isArray(object.material)
        ? object.material
        : [object.material];
      for (const material of list) {
        materials.add(material.uuid);
        for (const key of textureKeys) {
          if (material[key]) textures.add(material[key]);
        }
      }
    });
    let estimatedRgbaMipBytes = 0;
    let sizedTextureCount = 0;
    for (const texture of textures) {
      const image = texture.image;
      const width = image?.videoWidth || image?.naturalWidth || image?.width || 0;
      const height = image?.videoHeight || image?.naturalHeight || image?.height || 0;
      if (width && height) {
        estimatedRgbaMipBytes += width * height * 4 * 4 / 3;
        sizedTextureCount++;
      }
    }
    const gl = renderer.getContext();
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    const empireModule = await import(new URL('src/sim/empire.js', document.baseURI).href);
    const saveStart = performance.now();
    const snapshot = empireModule.empireSnapshot(app.empire);
    const json = JSON.stringify(snapshot);
    localStorage.setItem('golfempire:qa-performance', json);
    const saveMs = performance.now() - saveStart;
    const loadStart = performance.now();
    empireModule.deserializeEmpire(
      JSON.parse(localStorage.getItem('golfempire:qa-performance')),
    );
    const loadMs = performance.now() - loadStart;
    localStorage.removeItem('golfempire:qa-performance');
    return {
      renderer: {
        drawingBufferWidth: gl.drawingBufferWidth,
        drawingBufferHeight: gl.drawingBufferHeight,
        pixelRatio: renderer.getPixelRatio(),
        geometries: renderer.info.memory.geometries,
        textures: renderer.info.memory.textures,
        programs: renderer.info.programs?.length ?? null,
        gpuVendor: debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : null,
        gpuRenderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : null,
      },
      materialCount: materials.size,
      referencedTextureCount: textures.size,
      sizedTextureCount,
      estimatedRgbaMipBytes: Math.round(estimatedRgbaMipBytes),
      jsHeapBytes: performance.memory?.usedJSHeapSize ?? null,
      listeners: JSON.parse(JSON.stringify(window.__qaListenerStats)),
      save: {
        bytes: new Blob([json]).size,
        stringifyAndLocalStorageMs: saveMs,
        parseAndDeserializeMs: loadMs,
      },
      browser: {
        userAgent: navigator.userAgent,
        hardwareConcurrency: navigator.hardwareConcurrency,
        deviceMemoryGiB: navigator.deviceMemory ?? null,
      },
    };
  });
}

async function forceBrowserGc(page) {
  return page.evaluate(() => {
    if (typeof globalThis.gc !== 'function') return false;
    globalThis.gc();
    globalThis.gc();
    return true;
  });
}

async function memoryAndListenerSnapshot(page) {
  return page.evaluate(() => ({
    listeners: JSON.parse(JSON.stringify(window.__qaListenerStats)),
    heapBytes: performance.memory?.usedJSHeapSize ?? null,
  }));
}

async function interactionStress(page, count, rounds = 3) {
  const gcAvailable = await forceBrowserGc(page);
  await page.waitForTimeout(350);
  const before = await memoryAndListenerSnapshot(page);
  const checkpoints = [];
  for (let round = 0; round < rounds; round++) {
    for (let i = 0; i < count; i++) {
      await prepareHeroRoute(page, 0.03);
      await mountNormally(page);
      await page.waitForTimeout(60);
      await unmountNormally(page);
    }
    await forceBrowserGc(page);
    await page.waitForTimeout(600);
    checkpoints.push(await memoryAndListenerSnapshot(page));
  }
  const after = checkpoints.at(-1);
  return {
    cyclesPerRound: count,
    rounds,
    totalCycles: count * rounds,
    browserGcAvailable: gcAvailable,
    before,
    checkpoints,
    after,
    activeListenerGrowth: after.listeners.active - before.listeners.active,
    jsHeapGrowthBytes: before.heapBytes !== null && after.heapBytes !== null
      ? after.heapBytes - before.heapBytes
      : null,
  };
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--js-flags=--expose-gc'],
  });
  const context = await browser.newContext({
    viewport: { width: 1600, height: 900 },
    deviceScaleFactor: 1,
  });
  await context.addInitScript(installListenerProbe);
  const page = await context.newPage();

  const messages = new Map();
  const pageErrors = [];
  const failedRequests = [];
  page.on('console', (message) => {
    if (!['warning', 'error'].includes(message.type())) return;
    const key = message.type() + ':' + message.text();
    const row = messages.get(key) || {
      type: message.type(),
      text: message.text(),
      count: 0,
    };
    row.count++;
    messages.set(key, row);
  });
  page.on('pageerror', (error) => pageErrors.push(String(error.stack || error)));
  page.on('requestfailed', (request) => failedRequests.push({
    url: request.url(),
    failure: request.failure()?.errorText || 'unknown',
  }));

  await establishFixture(page);
  await positionIdleCamera(page);
  await page.waitForTimeout(5000);
  await page.screenshot({ path: path.join(OUT, 'idle-fixed-camera.png') });

  const idleSamples = [];
  for (let i = 0; i < SAMPLE_COUNT; i++) {
    idleSamples.push(await frameSample(page, SAMPLE_MS));
    await page.waitForTimeout(400);
  }

  const activeSamples = [];
  for (let i = 0; i < SAMPLE_COUNT; i++) {
    await prepareHeroRoute(page, 0.03);
    await mountNormally(page);
    await page.keyboard.down('w');
    const sample = await frameSample(page, SAMPLE_MS);
    await page.keyboard.up('w');
    activeSamples.push(sample);
    if (i === 0) {
      await page.screenshot({ path: path.join(OUT, 'mowing-route.png') });
    }
    await unmountNormally(page);
    await page.waitForTimeout(400);
  }

  const stress = await interactionStress(page, 20);
  const resources = await resourceSnapshot(page);
  const fixture = await page.evaluate(() => ({
    empireSeed: window.__fw.empire.seed,
    property: window.__fw.state.clubName,
    propertySeed: window.__fw.state.seed,
    heroHole: 4,
    clockMinutes: window.__fw.state.clock.minutes,
    weather: window.__fw.state.weather.today,
    viewport: {
      width: innerWidth,
      height: innerHeight,
      dpr: devicePixelRatio,
    },
  }));

  await context.close();
  await browser.close();

  const evidence = {
    capturedAt: new Date().toISOString(),
    phase: PHASE,
    launch: 'node tools/serve.cjs; Playwright Chrome headless',
    fixture,
    protocol: {
      warmupMs: 5000,
      sampleMs: SAMPLE_MS,
      samplesPerScenario: SAMPLE_COUNT,
      idle: 'Hole 4 fairway, fixed first-person camera, paused clock',
      active: 'Repaired tractor fixture at Hole 4, normal E mount, W drive and path mowing',
      interactionStress: 'Three forced-GC checkpoints across 60 normal E mount/dismount cycles',
      textureMemory: 'Estimated RGBA8 bytes including 4/3 mip overhead for sized referenced textures; not driver allocation',
      uiFrequency: 'MutationObserver records per second under #ui',
      listenerCount: 'Instrumented EventTarget add/remove active count from document start',
    },
    proposedRegressionGate: {
      averageFpsPercent: -10,
      onePercentLowFpsPercent: -15,
      worstFrameMsPercent: 20,
      drawCallsPercent: 15,
      trianglesPercent: 15,
      materialCountPercent: 15,
      estimatedTextureBytesPercent: 15,
      saveBytesPercent: 20,
      saveOrLoadTimePercent: 25,
      activeListenerGrowthAllowed: 0,
      rationale: 'A localized hero-hole mask may add one material/texture path, but it must not materially degrade the full course.',
    },
    idle: {
      samples: idleSamples,
      mean: summarize(idleSamples),
    },
    activeMowing: {
      samples: activeSamples,
      mean: summarize(activeSamples),
    },
    interactionStress: stress,
    resources,
    console: {
      warningsAndErrors: [...messages.values()],
      pageErrors,
      failedRequests,
    },
  };
  fs.writeFileSync(
    path.join(OUT, 'raw.json'),
    JSON.stringify(evidence, null, 2),
  );
  process.stdout.write(JSON.stringify(evidence, null, 2) + '\n');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
