import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const BASE_URL = process.env.GOLF_FLIPPER_URL || 'http://127.0.0.1:8463/';
const OUT = path.join(ROOT, 'qa', 'player-experience-polish');
const BASELINE = path.join(OUT, 'baseline');
const PERF = path.join(OUT, 'performance', 'baseline');
const LOGS = path.join(OUT, 'logs');
const VIEWPORT = { width: 1440, height: 900 };
const DEVICE_SCALE_FACTOR = 1;
const FIXED_TIME_MINUTE = 14 * 60;
const CAMERA = {
  exterior: { at: [-1.5, 243.5], to: [-8.5, 231.0], pitch: 0.03 },
  entrance: { at: [-8.8, 233.2], to: [-9.2, 226.0], pitch: -0.05 },
  checkout: { at: [-7.5, 230.3], to: [-5.1, 232.5], pitch: -0.10 },
  office: { at: [0.45, 232.5], to: [1.6, 232.5], pitch: -0.05 },
};

await Promise.all([
  fs.mkdir(BASELINE, { recursive: true }),
  fs.mkdir(PERF, { recursive: true }),
  fs.mkdir(LOGS, { recursive: true }),
]);

const consoleMessages = [];
const pageErrors = [];
const failedRequests = [];
let phase = 'launch';
const audit = {
  launch: {
    command: `GOLF_FLIPPER_URL=${BASE_URL} node tools/qa/player-experience-baseline.mjs`,
    server: 'node tools/serve.cjs (PORT=8463)',
    browser: 'Google Chrome via Playwright',
    viewport: VIEWPORT,
    deviceScaleFactor: DEVICE_SCALE_FACTOR,
    locale: 'en-US',
    reducedMotion: 'no-preference',
    colorScheme: 'dark',
    fixedGameMinute: FIXED_TIME_MINUTE,
    cameras: CAMERA,
  },
  controls: {},
  menu: {},
  marketplace: {},
  pause: {},
  laptop: {},
  course: {},
  captures: [],
};

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: [
    '--enable-precise-memory-info',
    '--force-color-profile=srgb',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
  ],
});

const context = await browser.newContext({
  viewport: VIEWPORT,
  deviceScaleFactor: DEVICE_SCALE_FACTOR,
  locale: 'en-US',
  reducedMotion: 'no-preference',
  colorScheme: 'dark',
});

// The menu derives its new-empire seed from Math.random. Pinning the global stream
// makes the save fixture, decorative variation, weather, and customer choices
// repeatable between baseline and final runs.
await context.addInitScript(() => {
  let state = 0x5f3759df;
  Math.random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
});

const page = await context.newPage();
const cdp = await context.newCDPSession(page);

page.on('console', (message) => {
  consoleMessages.push({ type: message.type(), text: message.text().slice(0, 1000) });
});
page.on('pageerror', (error) => pageErrors.push(error.stack || error.message));
page.on('requestfailed', (request) => {
  failedRequests.push({ phase, url: request.url(), error: request.failure()?.errorText || 'unknown' });
});

async function shot(name) {
  const target = path.join(BASELINE, `${name}.png`);
  await page.screenshot({ path: target, animations: 'disabled' });
  audit.captures.push(path.relative(ROOT, target).replaceAll('\\', '/'));
}

async function focusSequence(count) {
  await page.evaluate(() => document.activeElement?.blur());
  const sequence = [];
  for (let i = 0; i < count; i++) {
    await page.keyboard.press('Tab');
    sequence.push(await page.evaluate(() => {
      const node = document.activeElement;
      if (!node) return null;
      return {
        tag: node.tagName,
        text: (node.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 100),
        disabled: !!node.disabled,
        className: typeof node.className === 'string' ? node.className : '',
      };
    }));
  }
  return sequence;
}

async function waitForWorld() {
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 60_000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
  }, null, { timeout: 60_000 });
  await page.waitForTimeout(1_500);
}

async function setCamera(camera) {
  await page.evaluate(({ pose, minute }) => {
    const app = window.__fw;
    const clock = app.state.clock;
    clock.minutes = Math.floor(clock.minutes / 1440) * 1440 + minute;
    app.speedIdx = 0;
    app.scene3d.applyTimeWeather(minute, app.state.weather);
    const walk = app.scene3d.walk;
    walk.clearKeys();
    const state = walk.state;
    state.x = pose.at[0];
    state.z = pose.at[1];
    const dx = pose.to[0] - pose.at[0];
    const dz = pose.to[1] - pose.at[1];
    const length = Math.hypot(dx, dz) || 1;
    state.yaw = Math.atan2(-dx / length, -dz / length);
    state.pitch = pose.pitch;
  }, { pose: camera, minute: FIXED_TIME_MINUTE });
  await page.waitForTimeout(500);
}

async function connectedListenerCount() {
  const objectGroup = `qa-listeners-${Date.now()}`;
  const evaluated = await cdp.send('Runtime.evaluate', {
    expression: '[window, document, ...document.querySelectorAll("*")]',
    objectGroup,
    returnByValue: false,
  });
  const arrayId = evaluated.result.objectId;
  if (!arrayId) return { count: null, targets: null, note: 'CDP did not return an object id.' };
  const props = await cdp.send('Runtime.getProperties', {
    objectId: arrayId,
    ownProperties: true,
    accessorPropertiesOnly: false,
    generatePreview: false,
  });
  const objectIds = props.result
    .filter((item) => /^\d+$/.test(item.name) && item.value?.objectId)
    .map((item) => item.value.objectId);
  let count = 0;
  const byType = {};
  const batches = [];
  for (let i = 0; i < objectIds.length; i += 80) batches.push(objectIds.slice(i, i + 80));
  for (const batch of batches) {
    const results = await Promise.all(batch.map((objectId) =>
      cdp.send('DOMDebugger.getEventListeners', { objectId }).catch(() => ({ listeners: [] }))));
    for (const result of results) {
      for (const listener of result.listeners || []) {
        count++;
        byType[listener.type] = (byType[listener.type] || 0) + 1;
      }
    }
  }
  await cdp.send('Runtime.releaseObjectGroup', { objectGroup }).catch(() => {});
  return {
    count,
    targets: objectIds.length,
    byType,
    note: 'Exact CDP count across window, document, and every currently connected DOM node; detached targets are excluded.',
  };
}

async function rendererMetrics() {
  return page.evaluate(() => new Promise((resolve) => {
    const scene3d = window.__fw.scene3d;
    const renderer = scene3d.renderer;
    renderer.info.autoReset = false;
    renderer.info.reset();
    // The app's frame callback was registered before this callback, so one rAF
    // gives renderer.info exactly one complete game frame after the reset.
    requestAnimationFrame(() => {
      const materials = new Set();
      const textures = new Map();
      let visibleMeshes = 0;
      let sceneTriangles = 0;
      scene3d.scene.traverse((object) => {
        if (!object.isMesh || !object.visible) return;
        visibleMeshes++;
        const geometry = object.geometry;
        const triangles = geometry?.index
          ? geometry.index.count / 3
          : (geometry?.attributes?.position?.count || 0) / 3;
        sceneTriangles += triangles * (object.isInstancedMesh ? object.count : 1);
        const list = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of list) {
          if (!material) continue;
          materials.add(material.uuid);
          for (const value of Object.values(material)) {
            if (!value?.isTexture || textures.has(value.uuid)) continue;
            const image = value.image;
            const width = image?.naturalWidth || image?.videoWidth || image?.width || 0;
            const height = image?.naturalHeight || image?.videoHeight || image?.height || 0;
            const mipFactor = value.generateMipmaps === false ? 1 : 4 / 3;
            textures.set(value.uuid, {
              bytes: Math.round(width * height * 4 * mipFactor),
              width,
              height,
              name: value.name || '(unnamed)',
              type: value.isCompressedTexture ? 'compressed' : value.isDataTexture ? 'data' : 'image',
            });
          }
        }
      });
      const result = {
        drawCallsPerFrame: renderer.info.render.calls,
        renderedTrianglesPerFrame: renderer.info.render.triangles,
        visibleMeshes,
        sceneTriangles: Math.round(sceneTriangles),
        materialCount: materials.size,
        textureCount: textures.size,
        textureMemoryEstimatedBytes: [...textures.values()].reduce((sum, texture) => sum + texture.bytes, 0),
        textureMemoryNote: 'RGBA8-equivalent estimate from loaded image dimensions, including a 4/3 mip factor when mipmaps are enabled; exact browser GPU allocation is unavailable.',
        largestTextureEstimates: [...textures.values()].sort((a, b) => b.bytes - a.bytes).slice(0, 12),
        rendererTextureObjects: renderer.info.memory.textures,
        rendererGeometryObjects: renderer.info.memory.geometries,
      };
      renderer.info.autoReset = true;
      resolve(result);
    });
  }));
}

async function frameAndUiMetrics(sampleFrames = 360) {
  return page.evaluate((framesWanted) => new Promise((resolve) => {
    const roots = [...document.querySelectorAll('.hud-min,.shop-overlay,.objectives-card,.toast-wrap,.pause-veil-ui')];
    let mutationRecords = 0;
    const mutationByRoot = {};
    const observers = roots.map((root, index) => {
      const key = `${root.className || root.tagName}#${index}`;
      mutationByRoot[key] = 0;
      const observer = new MutationObserver((records) => {
        mutationRecords += records.length;
        mutationByRoot[key] += records.length;
      });
      observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true });
      return observer;
    });
    const deltas = [];
    let previous = null;
    const started = performance.now();
    const frame = (now) => {
      if (previous != null) deltas.push(now - previous);
      previous = now;
      if (deltas.length < framesWanted) {
        requestAnimationFrame(frame);
        return;
      }
      observers.forEach((observer) => observer.disconnect());
      const sorted = [...deltas].sort((a, b) => b - a);
      const worstOnePercent = sorted.slice(0, Math.max(1, Math.ceil(sorted.length * 0.01)));
      const averageDelta = deltas.reduce((sum, value) => sum + value, 0) / deltas.length;
      const onePercentDelta = worstOnePercent.reduce((sum, value) => sum + value, 0) / worstOnePercent.length;
      const durationMs = now - started;
      resolve({
        samples: deltas.length,
        durationMs,
        averageFps: 1000 / averageDelta,
        onePercentLowFps: 1000 / onePercentDelta,
        worstFrameTimeMs: Math.max(...deltas),
        averageFrameTimeMs: averageDelta,
        javascriptHeapUsedBytes: performance.memory?.usedJSHeapSize ?? null,
        javascriptHeapLimitBytes: performance.memory?.jsHeapSizeLimit ?? null,
        uiMutationRecords: mutationRecords,
        uiMutationRecordsPerSecond: mutationRecords / (durationMs / 1000),
        uiMutationRecordsPerFrame: mutationRecords / deltas.length,
        uiMutationByRoot: mutationByRoot,
        uiMetricNote: 'MutationObserver records for HUD, interaction overlay, objective card, notifications, and pause UI during the sampled interval.',
      });
    };
    requestAnimationFrame(frame);
  }), sampleFrames);
}

try {
  phase = 'initial-navigation';
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  phase = 'origin-reset';
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
  phase = 'main-menu';
  await page.getByRole('heading', { name: 'GOLF EMPIRE' }).waitFor();

  audit.menu.visibleButtons = await page.getByRole('button').allTextContents();
  await shot('00-main-menu-1440x900');
  audit.menu.focusSequence = await focusSequence(6);

  phase = 'property-market';
  await page.getByRole('button', { name: 'New Empire — Relaxed' }).click();
  await page.getByRole('heading', { name: 'Property market' }).waitFor();
  audit.marketplace.listingCount = await page.locator('.listing').count();
  audit.marketplace.buyButtons = await page.getByRole('button', { name: 'Buy', exact: true }).count();
  await shot('01-new-game-property-market');
  audit.marketplace.focusSequence = await focusSequence(8);

  const buy = page.getByRole('button', { name: 'Buy', exact: true }).first();
  phase = 'world-loading';
  await buy.click();
  await page.locator('.load-veil').waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
  await shot('02-loading-transition');
  await waitForWorld();
  phase = 'gameplay';

  const beforeMove = await page.evaluate(() => ({ ...window.__fw.scene3d.walk.state }));
  await page.locator('canvas').click({ position: { x: 720, y: 450 } });
  await page.keyboard.down('w');
  await page.waitForTimeout(500);
  await page.keyboard.up('w');
  const afterMove = await page.evaluate(() => ({ ...window.__fw.scene3d.walk.state }));
  audit.controls.normalMovement = {
    before: { x: beforeMove.x, z: beforeMove.z },
    after: { x: afterMove.x, z: afterMove.z },
    distance: Math.hypot(afterMove.x - beforeMove.x, afterMove.z - beforeMove.z),
  };

  await setCamera(CAMERA.exterior);
  await shot('03-fixed-camera-exterior-hud');
  await setCamera(CAMERA.entrance);
  await shot('04-fixed-camera-entrance-prompt');
  await setCamera(CAMERA.checkout);
  await shot('05-fixed-camera-checkout');

  if (await page.evaluate(() => !!document.pointerLockElement)) await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.locator('.pause-veil-ui').waitFor({ state: 'visible', timeout: 5_000 });
  audit.pause.initialFocus = await page.evaluate(() => document.activeElement?.textContent?.trim() || 'none');
  audit.pause.focusSequence = await focusSequence(10);
  await shot('06-pause-save');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  audit.pause.settingsLabels = await page.locator('.pause-content').innerText();
  await shot('07-pause-settings');
  await page.getByRole('button', { name: 'Controls', exact: true }).click();
  audit.pause.controlsText = await page.locator('.pause-content').innerText();
  await shot('08-pause-controls');
  await page.getByRole('button', { name: 'Resume', exact: true }).click();

  // Use the repository's documented laptop interaction fixture, then press the
  // same E key as a player. The generic office beauty camera is close enough to
  // photograph the desk but not close enough to own its interaction focus.
  await page.evaluate(() => {
    const app = window.__fw;
    const origin = app.scene3d.clubhouse().interior.position;
    const walk = app.scene3d.walk;
    walk.clearKeys();
    walk.state.x = 8.45 + origin.x;
    walk.state.z = 4.5 + origin.z;
    walk.state.yaw = -Math.PI / 2;
    walk.state.pitch = -0.05;
  });
  await page.waitForTimeout(600);
  audit.laptop.focusLabel = await page.evaluate(() => window.__fw.scene3d.walk.getFocusLabel?.() || null);
  await page.keyboard.press('e');
  await page.waitForFunction(() => window.__fw.laptopOpen === true, null, { timeout: 10_000 });
  await page.waitForFunction(() => {
    const frame = document.querySelector('.lt-frame');
    return !!frame && frame.getBoundingClientRect().width > 100;
  }, null, { timeout: 15_000 });
  await page.waitForTimeout(1_000);
  audit.laptop.homeTitle = await page.locator('.lt-h1').textContent();
  await shot('09-laptop-home');
  const settingsButton = page.locator('.lt-navbtn').filter({ hasText: 'Settings' }).first();
  const settingsBox = await settingsButton.boundingBox();
  if (settingsBox) {
    await page.mouse.click(settingsBox.x + settingsBox.width / 2, settingsBox.y + settingsBox.height / 2);
    await page.waitForTimeout(500);
  }
  audit.laptop.settingsText = await page.locator('.lt-content').innerText();
  await shot('10-laptop-settings');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__fw.laptopOpen === false, null, { timeout: 5_000 });

  await page.keyboard.press('Tab');
  await page.waitForFunction(() => window.__fw.courseMode === 'overview', null, { timeout: 5_000 });
  audit.course.overviewHint = await page.locator('.hint-bar').innerText();
  await shot('11-course-overview');
  await page.keyboard.press('e');
  await page.waitForTimeout(300);
  audit.course.editorVisible = await page.locator('.works-palette').isVisible().catch(() => false);
  await shot('12-course-editor');
  await page.keyboard.press('e');
  await page.keyboard.press('Tab');
  await page.waitForFunction(() => window.__fw.courseMode === 'walk', null, { timeout: 5_000 });

  await setCamera(CAMERA.exterior);
  phase = 'performance-sample';
  await page.evaluate(() => { window.__fw.speedIdx = 1; });
  await page.waitForTimeout(5_000);
  const listenersBefore = await connectedListenerCount();
  const runs = [];
  for (let run = 1; run <= 3; run++) {
    const frameMetrics = await frameAndUiMetrics(600);
    const renderMetrics = await rendererMetrics();
    runs.push({ run, frameMetrics, renderMetrics });
    if (run < 3) await page.waitForTimeout(1_500);
  }
  const listenersAfter = await connectedListenerCount();
  const values = (selector) => runs.map(selector);
  const average = (numbers) => numbers.reduce((sum, number) => sum + number, 0) / numbers.length;
  const median = (numbers) => [...numbers].sort((a, b) => a - b)[Math.floor(numbers.length / 2)];
  const performance = {
    scenario: 'Fixed exterior player camera at 2:00 PM after a 5 s warm-up; three runs of 600 consecutive requestAnimationFrame intervals with 1.5 s between runs.',
    browser: 'Google Chrome headless, Playwright, 1440x900 CSS px, DPR 1',
    summary: {
      averageFpsMean: average(values((run) => run.frameMetrics.averageFps)),
      averageFpsMedian: median(values((run) => run.frameMetrics.averageFps)),
      onePercentLowFpsMean: average(values((run) => run.frameMetrics.onePercentLowFps)),
      onePercentLowFpsMedian: median(values((run) => run.frameMetrics.onePercentLowFps)),
      worstFrameTimeMs: Math.max(...values((run) => run.frameMetrics.worstFrameTimeMs)),
      javascriptHeapUsedBytesFinal: runs.at(-1).frameMetrics.javascriptHeapUsedBytes,
      uiMutationRecordsPerFrameMean: average(values((run) => run.frameMetrics.uiMutationRecordsPerFrame)),
      drawCallsPerFrameMedian: median(values((run) => run.renderMetrics.drawCallsPerFrame)),
      renderedTrianglesPerFrameMedian: median(values((run) => run.renderMetrics.renderedTrianglesPerFrame)),
      materialCountMedian: median(values((run) => run.renderMetrics.materialCount)),
      textureMemoryEstimatedBytesMedian: median(values((run) => run.renderMetrics.textureMemoryEstimatedBytes)),
    },
    runs,
    activeEventListenersBefore: listenersBefore,
    activeEventListenersAfter: listenersAfter,
    activeEventListenerDelta: listenersAfter.count == null || listenersBefore.count == null
      ? null
      : listenersAfter.count - listenersBefore.count,
  };
  await fs.writeFile(path.join(PERF, 'idle-exterior.json'), `${JSON.stringify(performance, null, 2)}\n`);

  audit.runtime = {
    consoleErrorCount: consoleMessages.filter((entry) => entry.type === 'error').length,
    consoleWarningCount: consoleMessages.filter((entry) => entry.type === 'warning').length,
    pageErrorCount: pageErrors.length,
    failedRequestCount: failedRequests.length,
  };
} finally {
  const runtimeLog = { consoleMessages, pageErrors, failedRequests };
  await fs.writeFile(path.join(LOGS, 'baseline-browser.json'), `${JSON.stringify(runtimeLog, null, 2)}\n`);
  await fs.writeFile(path.join(BASELINE, 'baseline-run.json'), `${JSON.stringify(audit, null, 2)}\n`);
  await browser.close();
}

console.log(JSON.stringify({
  ok: pageErrors.length === 0 && failedRequests.length === 0,
  captures: audit.captures.length,
  runtime: audit.runtime,
  output: path.relative(ROOT, OUT).replaceAll('\\', '/'),
}, null, 2));
