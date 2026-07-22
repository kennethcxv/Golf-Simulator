import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const URL = process.env.GOLF_FLIPPER_URL || 'http://127.0.0.1:8463/';
const QA_ROOT = path.join(ROOT, 'qa', 'player-experience-polish');
const EVIDENCE_LABEL = process.env.QA_PERF_LABEL || 'final';
const OUT = path.join(QA_ROOT, 'performance', EVIDENCE_LABEL);
const COMPARE_PATH = process.env.QA_COMPARE_WITH
  ? path.resolve(ROOT, process.env.QA_COMPARE_WITH)
  : (EVIDENCE_LABEL === 'final' ? path.join(QA_ROOT, 'performance', 'baseline', 'idle-exterior.json') : null);
const LOGS = path.join(QA_ROOT, 'logs');
const VIEWPORT = { width: 1440, height: 900 };
const FIXED_TIME_MINUTE = 14 * 60;
const CAMERA = { atOffset: [6.5, 15.5], toOffset: [-0.5, 3.0], pitch: 0.03 };

await Promise.all([fs.mkdir(OUT, { recursive: true }), fs.mkdir(LOGS, { recursive: true })]);

const consoleMessages = [];
const pageErrors = [];
const failedRequests = [];
let phase = 'launch';
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
  deviceScaleFactor: 1,
  locale: 'en-US',
  reducedMotion: 'no-preference',
  colorScheme: 'dark',
});
await context.addInitScript(() => {
  let state = 0x5f3759df;
  Math.random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
});

const page = await context.newPage();
const cdp = await context.newCDPSession(page);
page.on('console', (message) => consoleMessages.push({ type: message.type(), text: message.text().slice(0, 1200) }));
page.on('pageerror', (error) => pageErrors.push(error.stack || error.message));
page.on('requestfailed', (request) => failedRequests.push({
  phase,
  url: request.url(),
  error: request.failure()?.errorText || 'unknown',
}));

async function waitForWorld() {
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 60_000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
  }, null, { timeout: 60_000 });
  await page.waitForTimeout(1_500);
}

async function setCamera() {
  await page.evaluate(({ pose, minute }) => {
    const app = window.__fw;
    app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440 + minute;
    app.speedIdx = 0;
    app.scene3d.applyTimeWeather(minute, app.state.weather);
    const origin = app.scene3d.clubhouse().interior.position;
    const at = [origin.x + pose.atOffset[0], origin.z + pose.atOffset[1]];
    const to = [origin.x + pose.toOffset[0], origin.z + pose.toOffset[1]];
    const walk = app.scene3d.walk;
    walk.clearKeys();
    walk.state.x = at[0];
    walk.state.z = at[1];
    const dx = to[0] - at[0];
    const dz = to[1] - at[1];
    const length = Math.hypot(dx, dz) || 1;
    walk.state.yaw = Math.atan2(-dx / length, -dz / length);
    walk.state.pitch = pose.pitch;
  }, { pose: CAMERA, minute: FIXED_TIME_MINUTE });
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
  for (let index = 0; index < objectIds.length; index += 80) {
    const results = await Promise.all(objectIds.slice(index, index + 80).map((objectId) =>
      cdp.send('DOMDebugger.getEventListeners', { objectId }).catch(() => ({ listeners: [] }))));
    for (const result of results) {
      for (const listener of result.listeners || []) {
        count += 1;
        byType[listener.type] = (byType[listener.type] || 0) + 1;
      }
    }
  }
  await cdp.send('Runtime.releaseObjectGroup', { objectGroup }).catch(() => {});
  return {
    count,
    targets: objectIds.length,
    byType,
    note: 'Exact CDP count across window, document, and every connected DOM node; detached targets are excluded.',
  };
}

async function rendererMetrics() {
  return page.evaluate(() => new Promise((resolve) => {
    const scene3d = window.__fw.scene3d;
    const renderer = scene3d.renderer;
    renderer.info.autoReset = false;
    renderer.info.reset();
    requestAnimationFrame(() => {
      const materials = new Set();
      const textures = new Map();
      let visibleMeshes = 0;
      let sceneTriangles = 0;
      scene3d.scene.traverse((object) => {
        if (!object.isMesh || !object.visible) return;
        visibleMeshes += 1;
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

async function frameAndUiMetrics(sampleFrames = 600) {
  return page.evaluate((framesWanted) => new Promise((resolve) => {
    const roots = [...document.querySelectorAll('.hud-min,.shop-overlay,.objectives-card,.toast-wrap,.notification-center,.pause-veil-ui')];
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

const average = (numbers) => numbers.reduce((sum, number) => sum + number, 0) / numbers.length;
const median = (numbers) => [...numbers].sort((a, b) => a - b)[Math.floor(numbers.length / 2)];

function normalizedSummary(report) {
  const runs = report.runs;
  return {
    averageFpsMean: report.summary.averageFpsMean,
    onePercentLowFpsMean: report.summary.onePercentLowFpsMean,
    worstFrameTimeMs: report.summary.worstFrameTimeMs,
    javascriptHeapUsedBytesFinal: report.summary.javascriptHeapUsedBytesFinal,
    uiMutationRecordsPerFrameMean: report.summary.uiMutationRecordsPerFrameMean,
    drawCallsPerFrameMedian: report.summary.drawCallsPerFrameMedian,
    renderedTrianglesPerFrameMedian: report.summary.renderedTrianglesPerFrameMedian,
    materialCountMedian: report.summary.materialCountMedian,
    textureCountMedian: report.summary.textureCountMedian ?? median(runs.map((run) => run.renderMetrics.textureCount)),
    rendererTextureObjectsMedian: report.summary.rendererTextureObjectsMedian
      ?? median(runs.map((run) => run.renderMetrics.rendererTextureObjects)),
    textureMemoryEstimatedBytesMedian: report.summary.textureMemoryEstimatedBytesMedian,
    activeEventListenerDelta: report.activeEventListenerDelta,
  };
}

let performanceReport = null;
let comparison = null;
try {
  phase = 'initial-navigation';
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
  const polishedNewGame = page.locator('.menu-screen .menu-action').filter({ hasText: /^New game/ });
  if (await polishedNewGame.count()) {
    await page.locator('.menu-screen').waitFor({ state: 'visible' });
    await polishedNewGame.click();
    await page.getByRole('dialog', { name: 'New game' }).waitFor();
    await page.locator('.difficulty-card').filter({ hasText: /^Relaxed/ }).click();
  } else {
    await page.getByRole('button', { name: 'New Empire — Relaxed' }).click();
  }
  await page.locator('.listing').first().waitFor({ state: 'visible', timeout: 15_000 });
  await page.getByRole('button', { name: 'Buy', exact: true }).first().click();
  await waitForWorld();

  phase = 'fixed-camera';
  await setCamera();
  await page.screenshot({ path: path.join(OUT, 'idle-exterior.png'), animations: 'disabled' });
  await page.evaluate(() => { window.__fw.speedIdx = 1; });
  await page.waitForTimeout(5_000);

  phase = 'performance-sample';
  const listenersBefore = await connectedListenerCount();
  const runs = [];
  for (let run = 1; run <= 3; run += 1) {
    runs.push({
      run,
      frameMetrics: await frameAndUiMetrics(600),
      renderMetrics: await rendererMetrics(),
    });
    if (run < 3) await page.waitForTimeout(1_500);
  }
  const listenersAfter = await connectedListenerCount();
  const values = (selector) => runs.map(selector);
  performanceReport = {
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
      textureCountMedian: median(values((run) => run.renderMetrics.textureCount)),
      rendererTextureObjectsMedian: median(values((run) => run.renderMetrics.rendererTextureObjects)),
      textureMemoryEstimatedBytesMedian: median(values((run) => run.renderMetrics.textureMemoryEstimatedBytes)),
    },
    runs,
    activeEventListenersBefore: listenersBefore,
    activeEventListenersAfter: listenersAfter,
    activeEventListenerDelta: listenersAfter.count == null || listenersBefore.count == null
      ? null
      : listenersAfter.count - listenersBefore.count,
  };
  await fs.writeFile(path.join(OUT, 'idle-exterior.json'), `${JSON.stringify(performanceReport, null, 2)}\n`);

  if (COMPARE_PATH) {
    const baseline = JSON.parse(await fs.readFile(COMPARE_PATH, 'utf8'));
    const baselineSummary = normalizedSummary(baseline);
    const finalSummary = normalizedSummary(performanceReport);
    const definitions = [
    ['Average FPS', 'averageFpsMean', 'higher', 5],
    ['1% low FPS', 'onePercentLowFpsMean', 'higher', 10],
    ['Worst frame (ms)', 'worstFrameTimeMs', 'lower', 20],
    ['JS heap final (bytes)', 'javascriptHeapUsedBytesFinal', 'lower', 25],
    ['UI mutations / frame', 'uiMutationRecordsPerFrameMean', 'lower', 10],
    ['Draw calls / frame', 'drawCallsPerFrameMedian', 'lower', 5],
    ['Rendered triangles / frame', 'renderedTrianglesPerFrameMedian', 'lower', 5],
    ['Materials', 'materialCountMedian', 'lower', 5],
    ['Visible textures', 'textureCountMedian', 'lower', 5],
    ['Resident textures', 'rendererTextureObjectsMedian', 'lower', 5],
    ['Texture estimate (bytes)', 'textureMemoryEstimatedBytesMedian', 'lower', 5],
    ];
    const metrics = definitions.map(([label, key, direction, tolerancePercent]) => {
      const before = baselineSummary[key];
      const after = finalSummary[key];
      const deltaPercent = before ? ((after - before) / before) * 100 : null;
      const regressionPercent = direction === 'higher' ? -deltaPercent : deltaPercent;
      return {
        label,
        key,
        direction,
        baseline: before,
        final: after,
        deltaPercent,
        tolerancePercent,
        pass: regressionPercent <= tolerancePercent,
      };
    });
    const listenerLeakPass = performanceReport.activeEventListenerDelta <= 0;
    comparison = {
      comparedWith: path.relative(ROOT, COMPARE_PATH).replaceAll('\\', '/'),
      scenarioMatch: baseline.scenario === performanceReport.scenario,
      browserMatch: baseline.browser === performanceReport.browser,
      baseline: baselineSummary,
      final: finalSummary,
      metrics,
      listenerLeakPass,
      pass: metrics.every((metric) => metric.pass) && listenerLeakPass,
      toleranceNote: 'Noise guardrails: 5% for steady render counts/FPS, 10% for 1% lows and UI mutations, 20% worst-frame, 25% final heap. Active listener count may not increase within the final sample.',
    };
    await fs.writeFile(path.join(OUT, 'comparison.json'), `${JSON.stringify(comparison, null, 2)}\n`);
    const format = (value) => Number.isFinite(value) ? value.toLocaleString('en-US', { maximumFractionDigits: 2 }) : 'n/a';
    const rows = metrics.map((metric) => `| ${metric.label} | ${format(metric.baseline)} | ${format(metric.final)} | ${format(metric.deltaPercent)}% | ${metric.pass ? 'Pass' : 'Regressed'} |`);
    const markdown = [
      '# Performance comparison',
      '',
      performanceReport.scenario,
      '',
      `Paired baseline: \`${comparison.comparedWith}\`.`,
      '',
      '| Metric | Baseline | Final | Change | Result |',
      '| --- | ---: | ---: | ---: | --- |',
      ...rows,
      '',
      `Listener balance: ${performanceReport.activeEventListenersBefore.count} → ${performanceReport.activeEventListenersAfter.count} (delta ${performanceReport.activeEventListenerDelta}); ${listenerLeakPass ? 'Pass' : 'Regressed'}.`,
      '',
      `Overall: ${comparison.pass ? 'Pass — no meaningful regression.' : 'Regressed — investigate before acceptance.'}`,
      '',
      comparison.toleranceNote,
      '',
    ].join('\n');
    await fs.writeFile(path.join(OUT, 'comparison.md'), markdown);
  }
} finally {
  const unexpectedRequestFailures = failedRequests.filter((entry) =>
    !(entry.error.includes('ERR_ABORTED') && /\.(glb|gltf)(\?|$)/i.test(entry.url)));
  await fs.writeFile(path.join(LOGS, `${EVIDENCE_LABEL}-performance-browser.json`), `${JSON.stringify({
    consoleMessages,
    pageErrors,
    failedRequests,
    unexpectedRequestFailures,
  }, null, 2)}\n`);
  await browser.close();
}

const consoleErrors = consoleMessages.filter((entry) => entry.type === 'error');
console.log(JSON.stringify({
  pass: comparison?.pass ?? true,
  compared: !!comparison,
  evidenceLabel: EVIDENCE_LABEL,
  summary: performanceReport?.summary ?? null,
  listenerDelta: performanceReport?.activeEventListenerDelta ?? null,
  consoleErrors: consoleErrors.length,
  pageErrors: pageErrors.length,
  failedRequests: failedRequests.length,
}, null, 2));
if (consoleErrors.length || pageErrors.length || (comparison && !comparison.pass)) process.exitCode = 1;
