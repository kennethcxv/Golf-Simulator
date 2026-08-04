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
      // Try the next installed runtime. The repository intentionally keeps QA
      // tooling optional for the shipped Electron package.
    }
  }
  throw new Error('Playwright is unavailable. Install it or set PLAYWRIGHT_PATH.');
}

const { chromium } = loadPlaywright();
const ROOT = path.resolve(__dirname, '../..');
const PHASE = process.env.QA_PHASE || 'baseline';
const PORT = Number(process.env.QA_PORT || 8462);
const OUT = path.join(ROOT, 'qa/course-maintenance', PHASE);
const HOLES_OUT = path.join(OUT, 'holes');
const VIDEO_OUT = path.join(OUT, 'video-tmp');
const FIXTURE_SEED = 20260719;

function installListenerProbe() {
  const add = EventTarget.prototype.addEventListener;
  const remove = EventTarget.prototype.removeEventListener;
  const targetMaps = new WeakMap();
  const totals = { active: 0, added: 0, removed: 0, byType: {} };
  const captureOf = (options) => (
    typeof options === 'boolean' ? options : !!(options && options.capture)
  );
  const onceOf = (options) => !!(options && typeof options === 'object' && options.once);

  EventTarget.prototype.addEventListener = function trackedAdd(type, fn, options) {
    if (!fn) return add.call(this, type, fn, options);
    let map = targetMaps.get(this);
    if (!map) {
      map = new Map();
      targetMaps.set(this, map);
    }
    let fnMap = map.get(type);
    if (!fnMap) {
      fnMap = new Map();
      map.set(type, fnMap);
    }
    const capture = captureOf(options);
    let entries = fnMap.get(fn);
    if (!entries) {
      entries = new Map();
      fnMap.set(fn, entries);
    }
    if (entries.has(capture)) return add.call(this, type, fn, options);

    let wrapped = fn;
    if (onceOf(options)) {
      wrapped = function trackedOnce(...args) {
        if (entries.has(capture)) {
          entries.delete(capture);
          totals.active--;
          totals.removed++;
          totals.byType[type] = Math.max(0, (totals.byType[type] || 1) - 1);
        }
        return typeof fn === 'function'
          ? fn.apply(this, args)
          : fn.handleEvent(...args);
      };
    }
    entries.set(capture, wrapped);
    totals.active++;
    totals.added++;
    totals.byType[type] = (totals.byType[type] || 0) + 1;
    return add.call(this, type, wrapped, options);
  };

  EventTarget.prototype.removeEventListener = function trackedRemove(type, fn, options) {
    const capture = captureOf(options);
    const entries = targetMaps.get(this)?.get(type)?.get(fn);
    const wrapped = entries?.get(capture) || fn;
    if (entries?.has(capture)) {
      entries.delete(capture);
      totals.active--;
      totals.removed++;
      totals.byType[type] = Math.max(0, (totals.byType[type] || 1) - 1);
    }
    return remove.call(this, type, wrapped, options);
  };
  window.__qaListenerStats = totals;
}

async function establishFixture(page) {
  await page.evaluate(async (fixtureSeed) => {
    localStorage.clear();
    const empireModule = await import(new URL('src/sim/empire.js', document.baseURI).href);
    const empire = empireModule.newEmpire('relaxed', fixtureSeed);
    const willow = empire.market.find((property) => (
      property.name === 'Willow Creek Municipal'
    ));
    if (!willow) throw new Error('Willow Creek Municipal fixture is missing.');
    const bought = empireModule.buyProperty(empire, willow.id);
    if (!bought.ok) throw new Error(bought.reason);
    localStorage.setItem(
      'golfempire:autosave',
      JSON.stringify(empireModule.empireSnapshot(empire)),
    );
  }, FIXTURE_SEED);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.waitForFunction(
    () => window.__fw?.state?.course?.holes?.length === 9,
    null,
    { timeout: 20000 },
  );
  await page.waitForTimeout(9500);
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.__fw?.speedIdx === 0);
}

async function positionOverviewCamera(page, holeIndex) {
  return page.evaluate((index) => {
    const app = window.__fw;
    const hole = app.state.course.holes[index];
    const cellYd = 8;
    const worldW = app.state.course.w * cellYd;
    const worldH = app.state.course.h * cellYd;
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
    const rig = app.scene3d.rig;
    rig.target.set((tee.x + pin.x) / 2, 0, (tee.z + pin.z) / 2);
    rig.yaw = Math.atan2(-direction.x, -direction.z);
    rig.pitch = 0.86;
    rig.dist = Math.min(540, Math.max(145, len * 1.04));
    rig.apply();
    return {
      hole: index + 1,
      tee: hole.tee,
      pin: hole.pin,
      camera: {
        target: { x: rig.target.x, z: rig.target.z },
        yaw: rig.yaw,
        pitch: rig.pitch,
        dist: rig.dist,
      },
    };
  }, holeIndex);
}

async function positionPlayerAtTee(page, holeIndex) {
  return page.evaluate((index) => {
    const app = window.__fw;
    const hole = app.state.course.holes[index];
    const cellYd = 8;
    const worldW = app.state.course.w * cellYd;
    const worldH = app.state.course.h * cellYd;
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
    walk.x = tee.x - direction.x * 8;
    walk.z = tee.z - direction.z * 8;
    walk.yaw = Math.atan2(-direction.x, -direction.z);
    walk.pitch = -0.08;
    return {
      hole: index + 1,
      position: { x: walk.x, z: walk.z },
      yaw: walk.yaw,
      pitch: walk.pitch,
    };
  }, holeIndex);
}

async function rendererSnapshot(page) {
  return page.evaluate(() => {
    const app = window.__fw;
    const info = app.scene3d.renderer.info;
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
    let sizedTextures = 0;
    for (const texture of textures) {
      const image = texture.image;
      const width = image?.videoWidth || image?.naturalWidth || image?.width || 0;
      const height = image?.videoHeight || image?.naturalHeight || image?.height || 0;
      if (width && height) {
        estimatedRgbaMipBytes += width * height * 4 * 4 / 3;
        sizedTextures++;
      }
    }
    return {
      renderer: {
        calls: info.render.calls,
        triangles: info.render.triangles,
        points: info.render.points,
        lines: info.render.lines,
        geometries: info.memory.geometries,
        textures: info.memory.textures,
        programs: info.programs?.length ?? null,
      },
      materialCount: materials.size,
      referencedTextureCount: textures.size,
      estimatedRgbaMipBytes: Math.round(estimatedRgbaMipBytes),
      sizedTextures,
      jsHeapBytes: performance.memory?.usedJSHeapSize ?? null,
      listeners: window.__qaListenerStats,
      state: {
        conditionRating: app.conditionRatingVal,
        overallRating: app.overallRating,
        tractorRepaired: app.state.tractor.repaired,
        saveJsonBytes: new Blob([
          localStorage.getItem('golfempire:autosave') || '',
        ]).size,
      },
    };
  });
}

async function main() {
  fs.mkdirSync(HOLES_OUT, { recursive: true });
  fs.mkdirSync(VIDEO_OUT, { recursive: true });

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({
    viewport: { width: 1600, height: 900 },
    deviceScaleFactor: 1,
    recordVideo: {
      dir: VIDEO_OUT,
      size: { width: 1600, height: 900 },
    },
  });
  await context.addInitScript(installListenerProbe);

  const page = await context.newPage();
  const consoleEvents = [];
  const pageErrors = [];
  const failedRequests = [];
  page.on('console', (message) => {
    if (['warning', 'error'].includes(message.type())) {
      consoleEvents.push({ type: message.type(), text: message.text() });
    }
  });
  page.on('pageerror', (error) => pageErrors.push(String(error.stack || error)));
  page.on('requestfailed', (request) => failedRequests.push({
    url: request.url(),
    failure: request.failure()?.errorText || 'unknown',
  }));

  await page.goto('http://127.0.0.1:' + PORT + '/', {
    waitUntil: 'domcontentloaded',
  });
  await establishFixture(page);

  const fixture = await page.evaluate(() => ({
    seed: window.__fw.empire.seed,
    property: window.__fw.state.clubName,
    propertySeed: window.__fw.state.seed,
    clockMinutes: window.__fw.state.clock.minutes,
    weather: window.__fw.state.weather.today,
    viewport: {
      width: innerWidth,
      height: innerHeight,
      dpr: devicePixelRatio,
    },
  }));

  await page.keyboard.press('Tab');
  await page.waitForFunction(() => window.__fw?.courseMode === 'overview');
  await page.evaluate(() => {
    const app = window.__fw;
    app.scene3d.setGolfersFrozen(true);
    Object.assign(app.scene3d.rig, {
      yaw: -0.78,
      pitch: 1.12,
      dist: 650,
    });
    app.scene3d.rig.target.set(0, 0, 0);
    app.scene3d.rig.apply();
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, 'course-overview.png') });

  const fixedCameras = [];
  for (let index = 0; index < 9; index++) {
    const camera = await positionOverviewCamera(page, index);
    await page.waitForTimeout(350);
    const file = 'hole-' + String(index + 1).padStart(2, '0') + '-overview.png';
    await page.screenshot({ path: path.join(HOLES_OUT, file) });
    fixedCameras.push({ ...camera, file });
  }

  await page.keyboard.press('Tab');
  await page.waitForFunction(() => window.__fw?.courseMode === 'walk');
  const playerCameras = [];
  for (const holeIndex of [3, 5]) {
    const camera = await positionPlayerAtTee(page, holeIndex);
    await page.waitForTimeout(650);
    const file = 'hole-' + String(holeIndex + 1).padStart(2, '0')
      + '-tee-player.png';
    await page.screenshot({ path: path.join(HOLES_OUT, file) });
    playerCameras.push({ ...camera, file });
  }

  const snapshot = await rendererSnapshot(page);
  const video = page.video();
  await page.close();
  await context.close();
  const recordedPath = video ? await video.path() : null;
  await browser.close();

  let videoPath = null;
  if (recordedPath && fs.existsSync(recordedPath)) {
    videoPath = path.join(OUT, 'walkthrough.webm');
    if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath);
    fs.renameSync(recordedPath, videoPath);
  }
  if (fs.existsSync(VIDEO_OUT) && fs.readdirSync(VIDEO_OUT).length === 0) {
    fs.rmdirSync(VIDEO_OUT);
  }

  const evidence = {
    capturedAt: new Date().toISOString(),
    launch: 'node tools/serve.cjs; Playwright Chrome headless',
    url: 'http://127.0.0.1:' + PORT + '/',
    phase: PHASE,
    fixture,
    fixedCameras,
    playerCameras,
    console: {
      warningsAndErrors: consoleEvents,
      pageErrors,
      failedRequests,
    },
    snapshot,
    videoPath: videoPath ? path.relative(ROOT, videoPath) : null,
  };
  fs.writeFileSync(
    path.join(OUT, 'capture.json'),
    JSON.stringify(evidence, null, 2),
  );
  process.stdout.write(JSON.stringify(evidence, null, 2) + '\n');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
