import fs from 'node:fs';
import path from 'node:path';

import {
  boot,
  configureFixture,
  enterFrontDesk,
  monitorClick,
  scanAll,
  waitForCameraStable,
} from './checkout-card-spike-probe.mjs';

const ITEMS = Object.freeze(['tees1', 'marker1', 'glove1']);
const TERM_WIDTH = 512;
const TERM_HEIGHT = 468;
const BYTES_PER_UPLOAD = TERM_WIDTH * TERM_HEIGHT * 4;
const OUT = path.resolve(
  process.env.TERMINAL_CANVAS_OUT
    || 'qa/steam-performance-master-pass/checkout-terminal-canvas-hotpath/after',
);

function assert(value, message) {
  if (!value) throw new Error(message);
}

function round(value, places = 3) {
  return Number.isFinite(value) ? Number(value.toFixed(places)) : null;
}

function summarizeFrames(intervals) {
  if (!intervals.length) return { count: 0 };
  const sorted = [...intervals].sort((a, b) => a - b);
  const durationMs = intervals.reduce((sum, value) => sum + value, 0);
  const slowCount = Math.max(1, Math.ceil(intervals.length * 0.01));
  const slowMean = [...intervals].sort((a, b) => b - a)
    .slice(0, slowCount).reduce((sum, value) => sum + value, 0) / slowCount;
  return {
    count: intervals.length,
    durationMs: round(durationMs),
    averageFps: round(intervals.length * 1000 / durationMs),
    onePercentLowFps: round(1000 / slowMean),
    p99FrameMs: round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))]),
    worstFrameMs: round(sorted[sorted.length - 1]),
    over33Ms: intervals.filter((value) => value > 33.333).length,
    over50Ms: intervals.filter((value) => value > 50).length,
    over100Ms: intervals.filter((value) => value > 100).length,
  };
}

async function installTerminalPaintProbe(page) {
  return page.evaluate(() => {
    const clubhouse = window.__fw.scene3d.clubhouse();
    const register = clubhouse.register;
    let texture = null;
    clubhouse.interior.traverse((object) => {
      if (texture || !object.material) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        const map = material?.map;
        if (map?.isCanvasTexture && map.image?.width === 512 && map.image?.height === 468) {
          texture = map;
          break;
        }
      }
    });
    if (!texture) throw new Error('Could not find the 512x468 physical terminal CanvasTexture.');
    const context = texture.image.getContext('2d');
    const originalFillRect = context.fillRect;
    const probe = {
      entryTextureVersion: texture.version,
      paintEvents: [],
      frames: [],
      startedAt: null,
      endedAt: null,
      lastFrameAt: null,
      done: false,
    };
    window.__terminalCanvasHotpathProbe = probe;

    context.fillRect = function terminalFillRectProbe(x, y, width, height) {
      if (x === 0 && y === 0 && width === texture.image.width && height === texture.image.height) {
        probe.paintEvents.push({
          atMs: performance.now(),
          stage: register.getTx()?.stage || null,
          textureVersionBefore: texture.version,
        });
      }
      return originalFillRect.call(this, x, y, width, height);
    };

    const frame = (now) => {
      const stage = register.getTx()?.stage || null;
      if (stage === 'card-busy' && probe.startedAt == null) {
        probe.startedAt = now;
        probe.lastFrameAt = now;
      }
      if (probe.startedAt != null && !probe.done) {
        if (probe.lastFrameAt != null && now > probe.lastFrameAt) {
          probe.frames.push({
            atMs: now - probe.startedAt,
            intervalMs: now - probe.lastFrameAt,
            stage,
            textureVersion: texture.version,
          });
        }
        probe.lastFrameAt = now;
        if (stage !== 'card-busy') {
          probe.endedAt = now;
          probe.done = true;
        }
      }
      if (!probe.done) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    probe.restore = () => { context.fillRect = originalFillRect; };
    return {
      entryTextureVersion: probe.entryTextureVersion,
      texture: { width: texture.image.width, height: texture.image.height },
    };
  });
}

async function readProbe(page) {
  return page.evaluate(() => {
    const probe = window.__terminalCanvasHotpathProbe;
    const clubhouse = window.__fw.scene3d.clubhouse();
    const register = clubhouse.register;
    let texture = null;
    clubhouse.interior.traverse((object) => {
      if (texture || !object.material) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        const map = material?.map;
        if (map?.isCanvasTexture && map.image?.width === 512 && map.image?.height === 468) {
          texture = map;
          break;
        }
      }
    });
    const paintEvents = probe.paintEvents.map((event) => ({ ...event }));
    const busyUploadCount = paintEvents.filter((event) => event.stage === 'card-busy').length;
    const resultUploadCount = paintEvents.filter((event) => event.stage !== 'card-busy').length;
    probe.restore();
    return {
      entryTextureVersion: probe.entryTextureVersion,
      finalTextureVersion: texture.version,
      textureVersionDelta: texture.version - probe.entryTextureVersion,
      busyFrameCount: probe.frames.filter((frame) => frame.stage === 'card-busy').length,
      busyUploadCount,
      resultUploadCount,
      paintEvents,
      frames: probe.frames.map((record) => ({ ...record })),
      elapsedMs: probe.endedAt - probe.startedAt,
      finalStage: register.getTx()?.stage || null,
    };
  });
}

export async function runCheckoutTerminalCanvasHotpath(page) {
  fs.mkdirSync(OUT, { recursive: true });
  const errors = { console: [], page: [], requestFailed: [] };
  page.on('console', (message) => {
    if (message.type() === 'error') errors.console.push(message.text());
  });
  page.on('pageerror', (error) => errors.page.push(String(error?.stack || error)));
  page.on('requestfailed', (request) => errors.requestFailed.push({
    url: request.url(),
    error: request.failure()?.errorText || 'unknown',
  }));

  await boot(page);
  const fixture = await configureFixture(page);
  const customer = await page.evaluate((skuIds) => (
    window.__fw.scene3d.clubhouse().sendToCounter(skuIds, 'card')
  ), ITEMS);
  assert(customer, 'Could not create the deterministic card customer.');
  await page.waitForFunction(() => (
    window.__fw.scene3d.clubhouse().register.getTx()?.items.length === 3
  ), null, { timeout: 15000 });
  await enterFrontDesk(page);
  await monitorClick(page, 'start-scanning');
  await page.waitForFunction(() => (
    window.__fw.scene3d.clubhouse().register.workspace() === 'scan'
  ), null, { timeout: 5000 });
  await waitForCameraStable(page);
  await scanAll(page);
  await page.waitForFunction(() => {
    const register = window.__fw.scene3d.clubhouse().register;
    return register.workspace() === 'card' && register.getTx()?.stage === 'card-ready';
  }, null, { timeout: 7000 });
  await waitForCameraStable(page);

  const card = await page.evaluate(() => (
    window.__fw.scene3d.clubhouse().register.presentedCardScreenPoint()
  ));
  assert(card?.inView, 'Presented card is outside the production card camera.');
  await page.mouse.click(card.x, card.y);
  await page.waitForFunction(() => (
    window.__fw.scene3d.clubhouse().register.getTx()?.stage === 'card-entry'
  ), null, { timeout: 5000 });
  await page.evaluate(() => { window.__fw.scene3d.clubhouse().register.getTx().rng = () => 1; });

  const instrumentation = await installTerminalPaintProbe(page);
  assert(instrumentation.texture.width === TERM_WIDTH && instrumentation.texture.height === TERM_HEIGHT,
    `Unexpected terminal canvas ${instrumentation.texture.width}x${instrumentation.texture.height}.`);
  const ok = await page.evaluate(() => (
    window.__fw.scene3d.clubhouse().register.cardKeyScreenPoint('OK')
  ));
  assert(ok?.inView, 'Reader OK key is outside the production card camera.');
  await page.mouse.click(ok.x, ok.y);
  await page.waitForFunction(() => (
    window.__fw.scene3d.clubhouse().register.getTx()?.stage === 'card-busy'
  ), null, { timeout: 4000 });
  const screenshot = path.join(OUT, 'card-processing.png');
  await page.screenshot({ path: screenshot });
  await page.waitForFunction(() => window.__terminalCanvasHotpathProbe?.done, null, { timeout: 7000 });
  const measured = await readProbe(page);

  // The removed implementation painted once synchronously on submit and then
  // unconditionally from every rAF update that observed card-busy. The matched
  // run's busy frames therefore provide the exact policy projection for this
  // authorization cadence (plus the final transition frame, which the observer
  // sees after runCard has changed the stage).
  const beforeCounterfactualBusyUploads = 3 + measured.busyFrameCount;
  const beforeCounterfactualTextureVersionDelta = beforeCounterfactualBusyUploads + measured.resultUploadCount;
  const result = {
    ok: true,
    generatedAt: new Date().toISOString(),
    protocol: {
      route: 'normal E, monitor click, physical product clicks, physical card click, physical terminal OK',
      viewport: { width: 1600, height: 900, deviceScaleFactor: 1 },
      authorizationSeconds: 1.15,
      textureUploadAccounting: 'THREE.Texture.version increments once per needsUpdate=true; RGBA8 bytes = 512*468*4',
      beforeCounterfactual: 'matched-run exact call count from the removed policy: one submit paint plus one drawTerm call for every measured update that began in card-busy',
    },
    fixture,
    customer,
    texture: {
      ...instrumentation.texture,
      bytesPerUpload: BYTES_PER_UPLOAD,
      mebibytesPerUpload: round(BYTES_PER_UPLOAD / 1048576, 6),
    },
    before: {
      busyUploadCount: beforeCounterfactualBusyUploads,
      textureVersionDeltaThroughResult: beforeCounterfactualTextureVersionDelta,
      estimatedBusyUploadBytes: beforeCounterfactualBusyUploads * BYTES_PER_UPLOAD,
      estimatedBusyUploadMiB: round(beforeCounterfactualBusyUploads * BYTES_PER_UPLOAD / 1048576, 6),
    },
    after: {
      ...measured,
      estimatedBusyUploadBytes: measured.busyUploadCount * BYTES_PER_UPLOAD,
      estimatedBusyUploadMiB: round(measured.busyUploadCount * BYTES_PER_UPLOAD / 1048576, 6),
      frames: summarizeFrames(measured.frames.map((frame) => frame.intervalMs)),
    },
    delta: {
      busyUploadCount: measured.busyUploadCount - beforeCounterfactualBusyUploads,
      busyUploadPercent: round((measured.busyUploadCount / beforeCounterfactualBusyUploads - 1) * 100),
      estimatedBusyUploadBytes: (measured.busyUploadCount - beforeCounterfactualBusyUploads) * BYTES_PER_UPLOAD,
      estimatedBusyUploadMiB: round((measured.busyUploadCount - beforeCounterfactualBusyUploads) * BYTES_PER_UPLOAD / 1048576, 6),
    },
    errors: {
      ...errors,
      nonBenignRequestFailures: errors.requestFailed.filter((entry) => !/ERR_ABORTED/.test(entry.error)),
    },
    screenshot,
  };
  fs.writeFileSync(path.join(OUT, 'checkout-terminal-canvas-hotpath.json'), `${JSON.stringify(result, null, 2)}\n`);
  return {
    ok: true,
    out: OUT,
    raw: path.join(OUT, 'checkout-terminal-canvas-hotpath.json'),
    screenshot,
    before: result.before,
    after: {
      busyUploadCount: result.after.busyUploadCount,
      textureVersionDeltaThroughResult: result.after.textureVersionDelta,
      estimatedBusyUploadMiB: result.after.estimatedBusyUploadMiB,
      frames: result.after.frames,
      finalStage: result.after.finalStage,
    },
    delta: result.delta,
    errors: result.errors,
  };
}
