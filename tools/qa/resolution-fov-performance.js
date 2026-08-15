// Fixed checkout-adjacent camera matrix for visual and performance integration review.
// Run twice against the same fixture and compare with compare-performance-runs.mjs.
//
//   $env:QA_BASE_URL='http://127.0.0.1:8469/'
//   $env:RESOLUTION_FOV_QA_ROOT='qa/overnight/performance/before'
//   node tools/qa/run-playwright.cjs tools/qa/resolution-fov-performance.js --bootstrap
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const outputRoot = path.resolve(process.env.RESOLUTION_FOV_QA_ROOT
    || path.join(process.cwd(), 'qa', 'overnight', 'performance', 'run'));
  const sampleMs = Math.max(500, Number(process.env.QA_PERF_SAMPLE_MS || 1800));
  const absoluteThresholds = {
    minimumAverageFps: Number(process.env.QA_MIN_AVERAGE_FPS || 30),
    minimumOnePercentLowFps: Number(process.env.QA_MIN_ONE_PERCENT_LOW_FPS || 12),
    maximumWorstFrameMs: Number(process.env.QA_MAX_WORST_FRAME_MS || 100),
  };
  const phase = String(process.env.QA_PERF_PHASE || 'run').replace(/[^a-z0-9._-]+/gi, '_');
  fs.mkdirSync(outputRoot, { recursive: true });

  const diagnostics = { consoleErrors: [], consoleWarnings: [], pageErrors: [], requestFailures: [] };
  page.on('console', (message) => {
    if (message.type() === 'error') diagnostics.consoleErrors.push(message.text());
    if (message.type() === 'warning') diagnostics.consoleWarnings.push(message.text());
  });
  page.on('pageerror', (error) => diagnostics.pageErrors.push(error.message));
  page.on('requestfailed', (request) => diagnostics.requestFailures.push({
    url: request.url(),
    error: request.failure()?.errorText || 'unknown',
  }));

  await page.addInitScript(() => {
    const originalAdd = EventTarget.prototype.addEventListener;
    const originalRemove = EventTarget.prototype.removeEventListener;
    const targets = new WeakMap();
    const counters = { added: 0, removed: 0, active: 0, byType: {} };
    const captureOf = (options) => typeof options === 'boolean' ? options : !!options?.capture;
    const listenersFor = (target, type, capture, create) => {
      let byKey = targets.get(target);
      if (!byKey && create) {
        byKey = new Map();
        targets.set(target, byKey);
      }
      if (!byKey) return null;
      const key = `${type}:${capture ? 1 : 0}`;
      let listeners = byKey.get(key);
      if (!listeners && create) {
        listeners = new Set();
        byKey.set(key, listeners);
      }
      return listeners || null;
    };
    EventTarget.prototype.addEventListener = function trackedAdd(type, listener, options) {
      if (listener) {
        const listeners = listenersFor(this, type, captureOf(options), true);
        if (!listeners.has(listener)) {
          listeners.add(listener);
          counters.added += 1;
          counters.active += 1;
          counters.byType[type] = (counters.byType[type] || 0) + 1;
        }
      }
      return originalAdd.call(this, type, listener, options);
    };
    EventTarget.prototype.removeEventListener = function trackedRemove(type, listener, options) {
      const listeners = listener ? listenersFor(this, type, captureOf(options), false) : null;
      if (listeners?.delete(listener)) {
        counters.removed += 1;
        counters.active -= 1;
        counters.byType[type] = Math.max(0, (counters.byType[type] || 0) - 1);
      }
      return originalRemove.call(this, type, listener, options);
    };
    globalThis.__qaEventListeners = counters;
    globalThis.__qaUiMutations = { batches: 0, records: 0, addedNodes: 0, removedNodes: 0 };
    addEventListener('DOMContentLoaded', () => {
      const observer = new MutationObserver((records) => {
        globalThis.__qaUiMutations.batches += 1;
        globalThis.__qaUiMutations.records += records.length;
        for (const record of records) {
          globalThis.__qaUiMutations.addedNodes += record.addedNodes.length;
          globalThis.__qaUiMutations.removedNodes += record.removedNodes.length;
        }
      });
      observer.observe(document.documentElement, {
        attributes: true,
        childList: true,
        characterData: true,
        subtree: true,
      });
      globalThis.__qaUiObserver = observer;
    }, { once: true });
  });

  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  // Same player-facing boot as the strict register drivers: the menu entries
  // are not accessible-role buttons, and a clean profile has no save to
  // continue. The bootstrap fixture normally seeds one, so Continue stays the
  // deterministic primary path.
  await page.waitForTimeout(1000);
  const { clickThroughMenu } = await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`);
  await clickThroughMenu(page);
  const firstAffordableProperty = page.getByRole('button', { name: 'Buy', exact: true }).first();
  if (await firstAffordableProperty.isVisible({ timeout: 3000 }).catch(() => false)) {
    await firstAffordableProperty.click();
  }
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || getComputedStyle(veil).opacity === '0';
  }, null, { timeout: 90000 });
  // Rule 5: this file's numbers gate an integration decision — refuse software GL.
  const { gateRenderer } = await import(
    `file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/perf-renderer-gate.mjs`
  );
  const rendererGate = await gateRenderer(page);
  await page.evaluate(() => {
    const app = window.__fw;
    app.speedIdx = 0;
    const day = Math.floor(app.state.clock.minutes / 1440) * 1440;
    app.state.clock.minutes = day + 14 * 60;
    app.state.weather.locked = true;
    app.state.weather.today = {
      tempHiF: 72, tempLoF: 54, rainIn: 0, humidity: 0.48, windMph: 5,
    };
    app.scene3d.applyTimeWeather?.(14 * 60, app.state.weather);
    const offset = app.scene3d.clubhouse().interior.position;
    const walk = app.scene3d.walk.state;
    walk.x = offset.x + 2.80;
    walk.z = offset.z + 5.35;
    walk.yaw = 0;
    walk.pitch = -0.18;
    app.scene3d.walk.clearKeys?.();
    const clubhouse = app.scene3d.clubhouse();
    clubhouse.setOrganicWalkins?.(false);
    clubhouse.clearWalkins?.();
    for (const skuId of ['tees1', 'marker1', 'glove1']) {
      const inventory = app.state.shop.inventory[skuId];
      if (inventory) inventory.shelf = Math.max(inventory.shelf, 12);
    }
    clubhouse.rebuildStock();
  });
  await page.waitForFunction(async () => {
    const app = window.__fw;
    const clubhouse = app?.scene3d?.clubhouse?.();
    if (!clubhouse) return false;
    const clubhouseReady = (!clubhouse.assetsReady || clubhouse.assetsReady())
      && (!clubhouse.deliveryEquipmentReady || clubhouse.deliveryEquipmentReady());
    if (!clubhouseReady) return false;
    if (app.scene3d.assetBarrier) await app.scene3d.assetBarrier();
    return true;
  }, null, { timeout: 120000 });
  // Keep the measured player-camera fixture free of randomly generated customer
  // cosmetics. The checkout customer is created only after all comparable samples.
  await page.waitForTimeout(1800);

  const environment = await page.evaluate(() => {
    const renderer = window.__fw.scene3d.renderer;
    const gl = renderer.getContext();
    const extension = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      userAgent: navigator.userAgent,
      devicePixelRatio: devicePixelRatio,
      gpu: extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : 'masked',
      contextLost: gl.isContextLost(),
    };
  });
  const listenerBaseline = await page.evaluate(() => ({
    ...globalThis.__qaEventListeners,
    byType: { ...globalThis.__qaEventListeners.byType },
  }));

  const quick = /^(1|true|yes)$/i.test(String(process.env.QA_PERF_QUICK || ''));
  const resolutions = quick ? [{ width: 1600, height: 900 }] : [
    { width: 1280, height: 720 },
    { width: 1600, height: 900 },
    { width: 1920, height: 1080 },
  ];
  const fovs = quick ? [60] : [50, 60, 75];
  const cases = [];

  // Prime every projection/resolution combination before recording. Several
  // screen-dependent materials and LODs are created lazily on first visibility;
  // measuring that creation in only the first run makes the pair incomparable.
  for (const viewport of resolutions) {
    await page.setViewportSize(viewport);
    for (const fov of fovs) {
      await page.evaluate((nextFov) => {
        const camera = window.__fw.scene3d.camera;
        camera.fov = nextFov;
        camera.updateProjectionMatrix();
        return new Promise((resolve) => {
          let frames = 10;
          const tick = () => {
            frames -= 1;
            if (frames <= 0) resolve();
            else requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        });
      }, fov);
    }
  }
  await page.waitForTimeout(500);

  for (const viewport of resolutions) {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(500);
    for (const fov of fovs) {
      await page.evaluate((nextFov) => {
        const camera = window.__fw.scene3d.camera;
        camera.fov = nextFov;
        camera.updateProjectionMatrix();
      }, fov);
      await page.waitForTimeout(350);
      const before = await page.evaluate(() => ({
        listeners: globalThis.__qaEventListeners.active,
        mutations: { ...globalThis.__qaUiMutations },
      }));
      const measured = await page.evaluate((durationMs) => new Promise((resolve) => {
        const deltas = [];
        const rendererInfo = window.__fw.scene3d.renderer.info;
        const previousAutoReset = rendererInfo.autoReset;
        rendererInfo.autoReset = false;
        rendererInfo.reset();
        const startedAt = performance.now();
        let previous = startedAt;
        const tick = (now) => {
          if (now - startedAt >= durationMs) {
            const sorted = deltas.slice(5).sort((a, b) => a - b);
            const mean = sorted.reduce((sum, value) => sum + value, 0) / Math.max(1, sorted.length);
            const slowCount = Math.max(1, Math.ceil(sorted.length * 0.01));
            const slowMean = sorted.slice(-slowCount)
              .reduce((sum, value) => sum + value, 0) / slowCount;
            const totalDrawCalls = rendererInfo.render.calls;
            const totalTriangles = rendererInfo.render.triangles;
            rendererInfo.autoReset = previousAutoReset;
            rendererInfo.reset();
            resolve({
              durationMs: now - startedAt,
              frameCount: sorted.length,
              averageFps: 1000 / Math.max(0.001, mean),
              onePercentLowFps: 1000 / Math.max(0.001, slowMean),
              averageFrameMs: mean,
              worstFrameMs: sorted.at(-1) || 0,
              framesOver33Ms: sorted.filter((value) => value > 33).length,
              framesOver100Ms: sorted.filter((value) => value > 100).length,
              totalDrawCalls,
              totalTriangles,
              drawCallsPerFrame: totalDrawCalls / Math.max(1, deltas.length),
              trianglesPerFrame: totalTriangles / Math.max(1, deltas.length),
            });
            return;
          }
          deltas.push(now - previous);
          previous = now;
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }), sampleMs);
      const after = await page.evaluate(() => {
        const app = window.__fw;
        const renderer = app.scene3d.renderer;
        const materials = new Map();
        const textures = new Map();
        const mapKeys = [
          'map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap',
          'alphaMap', 'bumpMap', 'displacementMap', 'lightMap', 'envMap',
        ];
        const mipBytes = (width, height) => {
          let bytes = 0;
          let w = Math.max(1, width | 0);
          let h = Math.max(1, height | 0);
          while (true) {
            bytes += w * h * 4;
            if (w === 1 && h === 1) return bytes;
            w = Math.max(1, w >> 1);
            h = Math.max(1, h >> 1);
          }
        };
        app.scene3d.scene.traverse((object) => {
          if (!object.isMesh) return;
          for (const material of (Array.isArray(object.material) ? object.material : [object.material])) {
            if (!material) continue;
            materials.set(material.uuid, material);
            for (const key of mapKeys) {
              const texture = material[key];
              if (texture?.isTexture) textures.set(texture.uuid, texture);
            }
          }
        });
        let estimatedTextureMipBytes = 0;
        for (const texture of textures.values()) {
          const image = texture.source?.data || texture.image;
          estimatedTextureMipBytes += mipBytes(
            Number(image?.width || image?.videoWidth || 1),
            Number(image?.height || image?.videoHeight || 1),
          );
        }
        const info = renderer.info;
        const gl = renderer.getContext();
        return {
          listeners: globalThis.__qaEventListeners.active,
          mutations: { ...globalThis.__qaUiMutations },
          renderer: {
            drawCalls: info.render.calls,
            triangles: info.render.triangles,
            geometries: info.memory.geometries,
            textures: info.memory.textures,
            programs: info.programs?.length ?? null,
            contextLost: gl.isContextLost(),
            glError: gl.getError(),
          },
          scene: {
            materialCount: materials.size,
            referencedTextureCount: textures.size,
            estimatedTextureMipBytes,
          },
          heapBytes: performance.memory?.usedJSHeapSize ?? null,
          effectiveFov: app.scene3d.camera.fov,
        };
      });
      const uiMutationBatches = after.mutations.batches - before.mutations.batches;
      const screenshot = path.join(outputRoot, `player-${viewport.width}x${viewport.height}-fov${fov}.png`);
      await page.screenshot({ path: screenshot, fullPage: false });
      cases.push({
        key: `${viewport.width}x${viewport.height}@${fov}`,
        viewport,
        fov,
        requestedFov: fov,
        effectiveFov: after.effectiveFov,
        sampleMs,
        performance: Object.fromEntries(Object.entries(measured).map(([key, value]) => [
          key,
          typeof value === 'number' ? Number(value.toFixed(3)) : value,
        ])),
        renderer: after.renderer,
        scene: after.scene,
        heapBytes: after.heapBytes,
        activeListeners: after.listeners,
        activeListenerDeltaDuringCase: after.listeners - before.listeners,
        uiMutationBatches,
        uiMutationRecords: after.mutations.records - before.mutations.records,
        uiMutationBatchesPerSecond: Number((uiMutationBatches / (measured.durationMs / 1000)).toFixed(3)),
        screenshot: screenshot.replaceAll('\\', '/'),
      });
      cases.at(-1).renderer.drawCalls = Number(measured.drawCallsPerFrame.toFixed(3));
      cases.at(-1).renderer.triangles = Number(measured.trianglesPerFrame.toFixed(3));
    }
  }

  // Enter the real cashier for a clean resolution-only layout matrix. This
  // camera intentionally uses its authored FOV instead of the player's setting.
  const fixtureCustomer = await page.evaluate(() => (
    window.__fw.scene3d.clubhouse().sendToCounter(['tees1', 'marker1', 'glove1'], 'card')
  ));
  if (!fixtureCustomer) throw new Error('Could not create the fixed checkout visual fixture.');
  await page.waitForFunction(() => {
    const transaction = window.__fw.scene3d.clubhouse().register.getTx();
    return transaction?.items?.length === 3;
  }, null, { timeout: 20000 });
  // Stand at the live register before pressing E, exactly as the strict
  // acceptance driver does: the FOV matrix leaves the player-camera wherever
  // the last case put it, which is outside the front-desk interaction radius.
  await page.evaluate(async () => {
    const { REGISTER } = await import(new URL('src/data/shopLayout.js', document.baseURI).href);
    const app = window.__fw;
    const origin = app.scene3d.clubhouse().interior.position;
    const walk = app.scene3d.walk.state;
    walk.x = REGISTER.stand.x + origin.x;
    walk.z = REGISTER.stand.z + origin.z;
    const dx = REGISTER.monitor.x - REGISTER.stand.x;
    const dz = REGISTER.monitor.z - REGISTER.stand.z;
    const horizontal = Math.hypot(dx, dz) || 0.001;
    walk.yaw = Math.atan2(-dx / horizontal, -dz / horizontal);
    walk.pitch = Math.atan2(1.185 - 1.62, horizontal);
  });
  await page.keyboard.press('e');
  await page.waitForFunction(
    () => window.__fw.scene3d.clubhouse().register.isActive(), null, { timeout: 10000 },
  );
  await page.waitForTimeout(1200);
  const authoredCashierFov = await page.evaluate(() => window.__fw.scene3d.camera.fov);
  const cashierCases = [];
  for (const viewport of resolutions) {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(500);
    const effectiveFov = await page.evaluate(() => window.__fw.scene3d.camera.fov);
    const screenshot = path.join(outputRoot, `cashier-${viewport.width}x${viewport.height}-authored-fov.png`);
    await page.screenshot({ path: screenshot, fullPage: false });
    cashierCases.push({
      viewport,
      effectiveFov,
      screenshot: screenshot.replaceAll('\\', '/'),
    });
  }

  const listenerFinal = await page.evaluate(() => ({
    ...globalThis.__qaEventListeners,
    byType: { ...globalThis.__qaEventListeners.byType },
  }));
  const performanceFailures = cases.flatMap((entry) => {
    const failures = [];
    if (entry.performance.averageFps < absoluteThresholds.minimumAverageFps) {
      failures.push(`average FPS ${entry.performance.averageFps} < ${absoluteThresholds.minimumAverageFps}`);
    }
    if (entry.performance.onePercentLowFps < absoluteThresholds.minimumOnePercentLowFps) {
      failures.push(`1% low FPS ${entry.performance.onePercentLowFps} < ${absoluteThresholds.minimumOnePercentLowFps}`);
    }
    if (entry.performance.worstFrameMs > absoluteThresholds.maximumWorstFrameMs) {
      failures.push(`worst frame ${entry.performance.worstFrameMs} ms > ${absoluteThresholds.maximumWorstFrameMs} ms`);
    }
    return failures.length ? [{ key: entry.key, failures }] : [];
  });
  const nonAbortedRequestFailures = diagnostics.requestFailures
    .filter((entry) => !/ERR_ABORTED|NS_BINDING_ABORTED/i.test(entry.error));
  const reportPath = path.join(outputRoot, 'result.json');
  const ok = !environment.contextLost
    && diagnostics.consoleErrors.length === 0
    && diagnostics.pageErrors.length === 0
    && nonAbortedRequestFailures.length === 0
    && cases.length === resolutions.length * fovs.length
    && cases.every((entry) => entry.performance.frameCount > 0
      && Math.abs(entry.effectiveFov - entry.requestedFov) <= 0.01
      && !entry.renderer.contextLost
      && entry.renderer.glError === 0)
    && cashierCases.length === resolutions.length
    && cashierCases.every((entry) => Math.abs(entry.effectiveFov - authoredCashierFov) <= 0.01)
    && (quick || performanceFailures.length === 0)
    && listenerFinal.active - listenerBaseline.active <= 2;
  const report = {
    schemaVersion: 1,
    ok,
    capturedAt: new Date().toISOString(),
    phase,
    fixture: 'deterministic Continue boot; 14:00 locked weather; customer-free player-camera FOV matrix; three-product card customer and normal E cashier resolution matrix; DPR 1',
    fixtureCustomer,
    authoredCashierFov,
    sampleMs,
    absoluteThresholds,
    thresholdsEnforced: !quick,
    performanceFailures,
    rendererGate,
    environment,
    listenerBaseline,
    listenerFinal,
    activeListenerGrowth: listenerFinal.active - listenerBaseline.active,
    diagnostics,
    nonAbortedRequestFailures,
    cases,
    cashierCases,
    reportPath: reportPath.replaceAll('\\', '/'),
  };
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}
