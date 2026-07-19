async (page) => {
  // Focused QA-only A/B profiler for the production delivery-van presentation.
  //
  // Recommended run:
  //   $env:HEADED='1'
  //   $env:QA_RESULT_PATH='qa/steam-performance-master-pass/delivery-arrival-warm-ab.json'
  //   node tools/qa/run-playwright.cjs tools/qa/delivery-arrival-warm-ab-probe.js --bootstrap
  //
  // The fixture enters through the normal Continue boot, creates authoritative
  // delivery cartons with sim/deliveries.js, and hands that load to the real
  // clubhouse delivery presentation. Production files and save storage are not
  // edited. Short presentation phases are held on one exact rendered pose by
  // reversibly passing dt=0 through the public clubhouse update function.

  const startedAt = Date.now();
  const numberEnv = (name, fallback, minimum = 100) => {
    const parsed = Number(process.env[name]);
    return Number.isFinite(parsed) ? Math.max(minimum, Math.floor(parsed)) : fallback;
  };
  const sampleMs = numberEnv('DELIVERY_AB_SAMPLE_MS', 1400);
  const coldApproachMs = numberEnv('DELIVERY_AB_COLD_APPROACH_MS', 850);
  const warmupMs = numberEnv('DELIVERY_AB_WARMUP_MS', 3500);
  const settleMs = numberEnv('DELIVERY_AB_SETTLE_MS', 180, 0);
  const fixtureOrderId = 98174141;
  const fixtureSkuId = 'cap1';
  const fixtureBoxCount = 9;
  const fixtureUnitsPerBox = 8;
  const fixedCamera = Object.freeze({ x: 25.2, z: 9.2, yaw: 1.00, pitch: -0.14 });
  const fixedWeather = Object.freeze({
    tempHiF: 74,
    tempLoF: 55,
    rainIn: 0,
    humidity: 0.40,
    windMph: 6,
  });
  const variants = Object.freeze([
    'normal',
    'root-hidden',
    'gtao-disabled',
    'shadows-disabled',
    'collider-sync-bypass',
    'normal-repeat',
  ]);
  const result = {
    ok: false,
    protocol: {
      launch: 'HEADED=1 node tools/qa/run-playwright.cjs tools/qa/delivery-arrival-warm-ab-probe.js --bootstrap',
      viewport: { width: 1600, height: 900 },
      deviceScaleFactor: 1,
      fixedClock: '14:00 local game time',
      fixedWeather,
      fixedCamera: {
        ...fixedCamera,
        coordinates: 'clubhouse-local x/z; yaw/pitch radians',
        source: 'delivery-equipment acceptance approach camera',
      },
      sampleMs,
      coldApproachMs,
      warmupMs,
      settleMs,
      coldDefinition: 'first fixed-camera hidden render and first live visible approach before route-specific shader warm-up',
      warmDefinition: 'same fixed camera after explicit hidden warm-up; each live phase is then held at one production pose while variants are reversed between samples',
      phaseHold: 'QA-only replacement of clubhouse.update that calls the exact original update with dt=0; composer rendering, delivery update work, and collider synchronization continue every frame',
      rendererCounters: 'EffectComposer.render wrapper sets WebGLRenderer.info.autoReset=false, resets once immediately before each composed frame, and reads counters after all passes complete',
      frameTiming: 'requestAnimationFrame deltas; 1% low is reciprocal of the mean worst 1% frame time',
      heap: 'performance.memory, CDP Runtime.getHeapUsage, and CDP Performance metrics without in-sample forced GC',
      listeners: 'pre-navigation window/document add-minus-remove counts plus CDP Memory.getDOMCounters.jsEventListeners',
      fixture: 'nine real cap1 merch cartons created through sim/deliveries.arriveOrder and presented by clubhouse.presentDeliveryArrival; no localStorage write',
      variants,
    },
    environment: {},
    fixture: null,
    availability: {},
    samples: [],
    comparisons: [],
    lifecycle: [],
    diagnostics: {
      consoleErrors: [],
      consoleWarnings: [],
      pageErrors: [],
      requestFailures: [],
      phaseHolds: [],
      skipped: [],
    },
  };

  let phase = 'init';
  const diagnosticEntry = (text) => ({
    phase,
    text: String(text).slice(0, 1000),
    atMs: Date.now() - startedAt,
  });
  page.on('console', (message) => {
    if (message.type() === 'error') result.diagnostics.consoleErrors.push(diagnosticEntry(message.text()));
    if (message.type() === 'warning') result.diagnostics.consoleWarnings.push(diagnosticEntry(message.text()));
  });
  page.on('pageerror', (error) => result.diagnostics.pageErrors.push(diagnosticEntry(error.message)));
  page.on('requestfailed', (request) => result.diagnostics.requestFailures.push({
    ...diagnosticEntry(request.failure()?.errorText || 'unknown'),
    url: request.url(),
    resourceType: request.resourceType(),
  }));

  // Install before navigation so listener counts include application startup.
  await page.addInitScript(() => {
    const rawAdd = EventTarget.prototype.addEventListener;
    const rawRemove = EventTarget.prototype.removeEventListener;
    const counts = {};
    const keyFor = (target, type) => `${target === window ? 'window' : 'document'}:${type}`;
    EventTarget.prototype.addEventListener = function deliveryProbeAdd(type, listener, options) {
      if (this === window || this === document) {
        const key = keyFor(this, type);
        counts[key] = (counts[key] || 0) + 1;
      }
      return rawAdd.call(this, type, listener, options);
    };
    EventTarget.prototype.removeEventListener = function deliveryProbeRemove(type, listener, options) {
      if (this === window || this === document) {
        const key = keyFor(this, type);
        counts[key] = (counts[key] || 0) - 1;
      }
      return rawRemove.call(this, type, listener, options);
    };
    window.__deliveryArrivalListenerProbe = { counts };
  });

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  await cdp.send('HeapProfiler.enable');

  const browserSnapshot = async () => {
    const [dom, performanceMetrics, runtimeHeap] = await Promise.all([
      cdp.send('Memory.getDOMCounters'),
      cdp.send('Performance.getMetrics'),
      cdp.send('Runtime.getHeapUsage'),
    ]);
    const metrics = Object.fromEntries(
      performanceMetrics.metrics.map((entry) => [entry.name, entry.value]),
    );
    return {
      cdp: {
        documents: dom.documents,
        nodes: dom.nodes,
        jsEventListeners: dom.jsEventListeners,
        jsHeapUsedBytes: metrics.JSHeapUsedSize ?? null,
        jsHeapTotalBytes: metrics.JSHeapTotalSize ?? null,
        runtimeHeap,
      },
    };
  };

  const lifecycleSnapshot = async (name, { collectGarbage = false } = {}) => {
    if (collectGarbage) {
      await cdp.send('HeapProfiler.collectGarbage');
      await page.waitForTimeout(60);
      await cdp.send('HeapProfiler.collectGarbage');
    }
    const [browser, game] = await Promise.all([
      browserSnapshot(),
      page.evaluate(() => {
        const counts = { ...(window.__deliveryArrivalListenerProbe?.counts || {}) };
        const renderer = window.__fw?.scene3d?.renderer;
        return {
          sceneId: window.__fw?.scene3d?.scene?.uuid || null,
          screen: window.__fw?.screen || null,
          trackedListeners: {
            net: Object.values(counts).reduce((sum, value) => sum + value, 0),
            byType: counts,
          },
          performanceMemoryUsedBytes: performance.memory?.usedJSHeapSize ?? null,
          rendererGeometries: renderer?.info?.memory?.geometries ?? null,
          rendererTextures: renderer?.info?.memory?.textures ?? null,
          rendererPrograms: renderer?.info?.programs?.length ?? null,
        };
      }),
    ]);
    const snapshot = { name, atMs: Date.now() - startedAt, ...game, ...browser };
    result.lifecycle.push(snapshot);
    return snapshot;
  };

  phase = 'navigate';
  await page.goto('http://localhost:8457/', { waitUntil: 'domcontentloaded' });
  await page.setViewportSize({ width: 1600, height: 900 });
  const continueButton = page.getByText('Continue', { exact: true });
  await continueButton.waitFor({ state: 'visible', timeout: 30000 });
  await continueButton.click();
  await page.waitForFunction(() => (
    window.__fw?.screen === 'game' && !!window.__fw?.scene3d?.clubhouse?.()
  ), null, { timeout: 90000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    const hidden = !veil || getComputedStyle(veil).display === 'none'
      || Number.parseFloat(getComputedStyle(veil).opacity || '1') <= 0.01;
    return hidden && window.__fw?.prewarming !== true;
  }, null, { timeout: 90000 });
  await page.waitForFunction(() => {
    const clubhouse = window.__fw?.scene3d?.clubhouse?.();
    return !!clubhouse && clubhouse.assetsReady?.() && clubhouse.deliveryEquipmentReady?.();
  }, null, { timeout: 90000 });
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

  phase = 'fixed-fixture';
  const fixedState = await page.evaluate(({ camera, weather }) => {
    const app = window.__fw;
    const state = app.state;
    const origin = app.scene3d.clubhouse().interior.position;
    const walk = app.scene3d.walk;
    const day = Math.floor(state.clock.minutes / 1440) * 1440;
    app.speedIdx = 0;
    walk.clearKeys?.();
    walk.state.x = origin.x + camera.x;
    walk.state.z = origin.z + camera.z;
    walk.state.yaw = camera.yaw;
    walk.state.pitch = camera.pitch;
    state.clock.minutes = day + 14 * 60;
    if (app.empire) app.empire.clockMinutes = state.clock.minutes;
    if (state.weather) {
      state.weather.locked = true;
      state.weather.today = { ...weather };
    }
    app.scene3d.applyTimeWeather?.(14 * 60, state.weather);
    const clubhouse = app.scene3d.clubhouse();
    clubhouse.setOrganicWalkins?.(false);
    clubhouse.clearWalkins?.();
    const vanRoot = app.scene3d.scene.getObjectByName('delivery_van');
    return {
      saveKeyPresent: localStorage.getItem('golfempire:autosave') != null,
      stateSeed: state.seed ?? null,
      clubName: state.clubName ?? null,
      sceneId: app.scene3d.scene.uuid,
      clockMinutes: state.clock.minutes,
      speedIdx: app.speedIdx,
      cameraWorld: {
        x: walk.state.x,
        z: walk.state.z,
        yaw: walk.state.yaw,
        pitch: walk.state.pitch,
      },
      vanRootExists: !!vanRoot,
      vanRootVisible: vanRoot?.visible ?? null,
    };
  }, { camera: fixedCamera, weather: fixedWeather });
  await page.waitForTimeout(120);

  // The composer wrapper is the counter authority. Unlike an independent rAF
  // reader, it samples only after all composed passes for that game frame.
  await page.evaluate(() => {
    const app = window.__fw;
    const renderer = app.scene3d.renderer;
    const composer = app.scene3d.post?.composer;
    if (!renderer?.info || !composer?.render) {
      throw new Error('Delivery A/B probe requires the live renderer and EffectComposer.');
    }
    const originalComposerRender = composer.render;
    const originalAutoReset = renderer.info.autoReset;
    let active = null;
    let nextToken = 0;
    const mean = (values) => values.length
      ? values.reduce((sum, value) => sum + value, 0) / values.length
      : 0;
    const percentile = (sorted, fraction) => (
      sorted.length
        ? sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))]
        : 0
    );
    const summarizeFrames = (input) => {
      const values = input.slice(3).filter((value) => value > 0).sort((a, b) => a - b);
      const durationMs = values.reduce((sum, value) => sum + value, 0);
      const worstCount = Math.max(1, Math.ceil(values.length * 0.01));
      const worstOnePercent = values.slice(-worstCount);
      return {
        frames: values.length,
        durationMs: +durationMs.toFixed(3),
        avgFps: durationMs > 0 ? +(values.length * 1000 / durationMs).toFixed(2) : null,
        low1Fps: mean(worstOnePercent) > 0 ? +(1000 / mean(worstOnePercent)).toFixed(2) : null,
        avgMs: +mean(values).toFixed(3),
        p50Ms: +percentile(values, 0.50).toFixed(3),
        p95Ms: +percentile(values, 0.95).toFixed(3),
        p99Ms: +percentile(values, 0.99).toFixed(3),
        worstMs: +(values[values.length - 1] || 0).toFixed(3),
        over33ms: values.filter((value) => value > 33.333).length,
        over50ms: values.filter((value) => value > 50).length,
        over100ms: values.filter((value) => value > 100).length,
      };
    };
    const summarizeCounter = (values) => {
      const sorted = values.slice().sort((a, b) => a - b);
      return {
        samples: sorted.length,
        average: +mean(sorted).toFixed(2),
        p50: +percentile(sorted, 0.50).toFixed(2),
        p95: +percentile(sorted, 0.95).toFixed(2),
        max: Math.max(0, ...sorted),
      };
    };
    const phaseState = () => {
      const diagnostics = app.scene3d.clubhouse()?.deliveryEquipmentDiagnostics?.();
      const vanRoot = app.scene3d.scene.getObjectByName('delivery_van');
      return {
        activeArrival: diagnostics?.activeArrival || null,
        vanRootVisible: vanRoot?.visible ?? null,
        gtaoEnabled: app.scene3d.post?.gtao?.enabled ?? null,
        shadowMapEnabled: renderer.shadowMap?.enabled ?? null,
        sunCastShadow: app.scene3d.post?.sun?.castShadow ?? null,
      };
    };
    const resourceState = () => {
      const scene = app.scene3d.scene;
      const geometries = new Set();
      const materials = new Set();
      const textures = new Set();
      let nodes = 0;
      let meshes = 0;
      scene.traverse((object) => {
        nodes += 1;
        if (object.isMesh || object.isPoints || object.isLine) meshes += 1;
        if (object.geometry?.uuid) geometries.add(object.geometry.uuid);
        const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of objectMaterials) {
          if (!material?.uuid) continue;
          materials.add(material.uuid);
          for (const value of Object.values(material)) {
            if (value?.isTexture && value.uuid) textures.add(value.uuid);
          }
          for (const uniform of Object.values(material.uniforms || {})) {
            const value = uniform?.value;
            if (value?.isTexture && value.uuid) textures.add(value.uuid);
            if (Array.isArray(value)) {
              for (const entry of value) if (entry?.isTexture && entry.uuid) textures.add(entry.uuid);
            }
          }
        }
      });
      const counts = { ...(window.__deliveryArrivalListenerProbe?.counts || {}) };
      return {
        sceneNodes: nodes,
        sceneMeshes: meshes,
        sceneGeometries: geometries.size,
        sceneMaterials: materials.size,
        sceneTextures: textures.size,
        rendererGeometries: renderer.info.memory.geometries,
        rendererTextures: renderer.info.memory.textures,
        rendererPrograms: renderer.info.programs?.length ?? null,
        performanceMemoryUsedBytes: performance.memory?.usedJSHeapSize ?? null,
        trackedListeners: {
          net: Object.values(counts).reduce((sum, value) => sum + value, 0),
          byType: counts,
        },
      };
    };

    renderer.info.autoReset = false;
    composer.render = function deliveryProbeComposerRender(...args) {
      renderer.info.autoReset = false;
      renderer.info.reset();
      const value = originalComposerRender.apply(this, args);
      const sample = active;
      if (sample?.running) {
        sample.drawCalls.push(renderer.info.render.calls || 0);
        sample.triangles.push(renderer.info.render.triangles || 0);
      }
      return value;
    };

    const runtime = {
      originalComposerRender,
      originalAutoReset,
      variantRestore: null,
      phaseHold: null,
      start(meta) {
        if (active) throw new Error(`Delivery sample ${active.meta?.label} is already active.`);
        const token = ++nextToken;
        active = {
          token,
          meta,
          started: performance.now(),
          last: null,
          deltas: [],
          drawCalls: [],
          triangles: [],
          running: true,
          phaseStart: phaseState(),
        };
        const tick = (time) => {
          const sample = active;
          if (!sample || !sample.running || sample.token !== token) return;
          if (sample.last != null) sample.deltas.push(time - sample.last);
          sample.last = time;
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
        return active.phaseStart;
      },
      stop() {
        if (!active) throw new Error('No delivery A/B sample is active.');
        const sample = active;
        sample.running = false;
        active = null;
        return {
          meta: sample.meta,
          elapsedMs: +(performance.now() - sample.started).toFixed(2),
          frame: summarizeFrames(sample.deltas),
          renderer: {
            calls: summarizeCounter(sample.drawCalls),
            triangles: summarizeCounter(sample.triangles),
            source: 'complete EffectComposer frames, reset before and read after composer.render',
          },
          resources: resourceState(),
          phaseStart: sample.phaseStart,
          phaseEnd: phaseState(),
        };
      },
      phaseState,
      availability() {
        const clubhouse = app.scene3d.clubhouse();
        const hook = clubhouse?.deliveryEquipmentPerformanceHooks;
        return {
          normal: { available: true },
          'root-hidden': {
            available: !!app.scene3d.scene.getObjectByName('delivery_van'),
            reason: app.scene3d.scene.getObjectByName('delivery_van')
              ? null : 'delivery_van root is absent',
          },
          'gtao-disabled': {
            available: typeof app.scene3d.post?.gtao?.enabled === 'boolean',
            reason: typeof app.scene3d.post?.gtao?.enabled === 'boolean'
              ? null : 'post.gtao.enabled is not exposed',
          },
          'shadows-disabled': {
            available: typeof renderer.shadowMap?.enabled === 'boolean'
              && typeof app.scene3d.post?.sun?.castShadow === 'boolean',
            reason: typeof renderer.shadowMap?.enabled === 'boolean'
              && typeof app.scene3d.post?.sun?.castShadow === 'boolean'
              ? null : 'renderer shadow map or post sun shadow control is not exposed',
          },
          'collider-sync-bypass': {
            available: typeof hook?.setColliderSyncEnabled === 'function',
            reason: typeof hook?.setColliderSyncEnabled === 'function'
              ? null : 'no existing deliveryEquipmentPerformanceHooks.setColliderSyncEnabled hook; production closure is intentionally untouched',
          },
          'normal-repeat': { available: true },
        };
      },
      restoreVariant() {
        const restore = runtime.variantRestore;
        runtime.variantRestore = null;
        if (restore) restore();
        return phaseState();
      },
      applyVariant(name) {
        runtime.restoreVariant();
        const availability = runtime.availability()[name];
        if (!availability?.available) return { ...availability, name, state: phaseState() };
        const vanRoot = app.scene3d.scene.getObjectByName('delivery_van');
        if (name === 'root-hidden') {
          const previous = vanRoot.visible;
          vanRoot.visible = false;
          runtime.variantRestore = () => { vanRoot.visible = previous; };
        } else if (name === 'gtao-disabled') {
          const gtao = app.scene3d.post.gtao;
          const previous = gtao.enabled;
          gtao.enabled = false;
          runtime.variantRestore = () => { gtao.enabled = previous; };
        } else if (name === 'shadows-disabled') {
          const shadowMap = renderer.shadowMap;
          const sun = app.scene3d.post.sun;
          const previous = { shadowMapEnabled: shadowMap.enabled, sunCastShadow: sun.castShadow };
          shadowMap.enabled = false;
          sun.castShadow = false;
          runtime.variantRestore = () => {
            shadowMap.enabled = previous.shadowMapEnabled;
            sun.castShadow = previous.sunCastShadow;
          };
        } else if (name === 'collider-sync-bypass') {
          const hook = app.scene3d.clubhouse().deliveryEquipmentPerformanceHooks;
          hook.setColliderSyncEnabled(false);
          runtime.variantRestore = () => { hook.setColliderSyncEnabled(true); };
        }
        return { available: true, name, state: phaseState() };
      },
      holdPhase(expectedPhase) {
        if (runtime.phaseHold) throw new Error(`Phase ${runtime.phaseHold.expectedPhase} is already held.`);
        const clubhouse = app.scene3d.clubhouse();
        const before = phaseState();
        if (before.activeArrival?.phase !== expectedPhase) {
          throw new Error(`Cannot hold ${expectedPhase}; active phase is ${before.activeArrival?.phase || 'none'}.`);
        }
        const originalUpdate = clubhouse.update;
        clubhouse.update = function deliveryProbeHeldUpdate() {
          return originalUpdate.call(this, 0);
        };
        runtime.phaseHold = { clubhouse, originalUpdate, expectedPhase, before };
        return before;
      },
      releasePhase() {
        const hold = runtime.phaseHold;
        if (!hold) return { released: false, state: phaseState() };
        runtime.restoreVariant();
        hold.clubhouse.update = hold.originalUpdate;
        runtime.phaseHold = null;
        return { released: true, before: hold.before, state: phaseState() };
      },
      uninstall() {
        runtime.releasePhase();
        runtime.restoreVariant();
        composer.render = originalComposerRender;
        renderer.info.reset();
        renderer.info.autoReset = originalAutoReset;
        delete window.__deliveryArrivalAbRuntime;
      },
    };
    window.__deliveryArrivalAbRuntime = runtime;
  });

  result.environment = await page.evaluate(() => {
    const app = window.__fw;
    const renderer = app.scene3d.renderer;
    const gl = renderer.getContext();
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      userAgent: navigator.userAgent,
      viewport: { width: innerWidth, height: innerHeight },
      devicePixelRatio,
      rendererPixelRatio: renderer.getPixelRatio(),
      gpu: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : 'masked',
      sceneId: app.scene3d.scene.uuid,
      postprocessing: {
        gtao: app.scene3d.post?.gtao?.enabled ?? null,
        bloom: app.scene3d.post?.bloom?.enabled ?? null,
      },
      shadows: {
        rendererEnabled: renderer.shadowMap?.enabled ?? null,
        sunCastShadow: app.scene3d.post?.sun?.castShadow ?? null,
      },
    };
  });
  result.availability = await page.evaluate(() => window.__deliveryArrivalAbRuntime.availability());
  result.fixture = { fixedState };
  await lifecycleSnapshot('fixed-camera-cold-before-samples', { collectGarbage: true });

  const measureOne = async ({ phaseTag, temperature, variant, durationMs, live = false }) => {
    phase = `${phaseTag}:${temperature}:${variant}`;
    const applied = await page.evaluate(
      (name) => window.__deliveryArrivalAbRuntime.applyVariant(name),
      variant,
    );
    if (!applied.available) {
      const skipped = {
        phaseTag, temperature, variant, reason: applied.reason || 'variant unavailable',
      };
      result.diagnostics.skipped.push(skipped);
      return null;
    }
    await page.waitForTimeout(settleMs);
    const meta = { label: phase, phaseTag, temperature, variant, live };
    await page.evaluate((value) => window.__deliveryArrivalAbRuntime.start(value), meta);
    await page.waitForTimeout(durationMs);
    const inPage = await page.evaluate(() => window.__deliveryArrivalAbRuntime.stop());
    const browser = await browserSnapshot();
    const record = { ...inPage, ...browser };
    result.samples.push(record);
    await page.evaluate(() => window.__deliveryArrivalAbRuntime.restoreVariant());
    await page.waitForTimeout(settleMs);
    return record;
  };

  const measureSnapshotAb = async (phaseTag, temperature = 'warm') => {
    for (const variant of variants) {
      await measureOne({ phaseTag, temperature, variant, durationMs: sampleMs, live: false });
    }
  };

  // First fixed-camera render is retained separately from the warm static A/B.
  await measureOne({
    phaseTag: 'hidden-prearrival',
    temperature: 'cold',
    variant: 'normal',
    durationMs: sampleMs,
    live: false,
  });
  phase = 'hidden-warmup';
  await page.waitForTimeout(warmupMs);
  await measureSnapshotAb('hidden-prearrival', 'warm');

  phase = 'stage-real-delivery';
  const fixture = await page.evaluate(async ({ orderId, skuId, boxCount, unitsPerBox }) => {
    const deliveries = await import('/src/sim/deliveries.js');
    const boxes = await import('/src/data/boxes.js');
    const app = window.__fw;
    const state = app.state;
    deliveries.ensureDeliveries(state);
    const dimensions = boxes.boxDims('merchbox');
    const manifestBoxes = Array.from({ length: boxCount }, () => ({
      kind: 'merchbox',
      qty: unitsPerBox,
      w: dimensions.w,
      h: dimensions.h,
      d: dimensions.d,
      lb: 5.1,
      fragile: false,
    }));
    const manifest = {
      supplierId: 'delivery-arrival-warm-ab-probe',
      supplier: 'Pinehollow Performance Supply',
      boxes: manifestBoxes,
      boxCount,
      weight: +(boxCount * 5.1).toFixed(1),
      fee: 0,
    };
    const order = { id: orderId, skuId, qty: boxCount * unitsPerBox, manifest };
    const created = deliveries.arriveOrder(state, order);
    if (created.length !== boxCount) {
      throw new Error(`Expected ${boxCount} delivery cartons, received ${created.length}.`);
    }
    const clubhouse = app.scene3d.clubhouse();
    const handle = clubhouse.presentDeliveryArrival({
      orderId,
      boxCount,
      skuId,
      supplier: manifest.supplier,
    });
    if (!handle) throw new Error('Production presentDeliveryArrival rejected the A/B fixture.');
    window.__deliveryArrivalAbHandle = handle;
    window.__deliveryArrivalAbResult = null;
    handle.promise.then((value) => { window.__deliveryArrivalAbResult = value; });
    clubhouse.rebuildBoxes();
    return {
      orderId,
      skuId,
      quantity: order.qty,
      requestedBoxCount: boxCount,
      createdBoxes: created.map((box) => ({
        id: box.id,
        orderId: box.orderId,
        skuId: box.skuId,
        qty: box.qty,
        kind: box.box,
        loc: box.loc,
        padPalletIndex: box.padPalletIndex,
      })),
      handle: { id: handle.id, orderId: handle.orderId, status: handle.status },
      localStorageWrittenByProbe: false,
    };
  }, {
    orderId: fixtureOrderId,
    skuId: fixtureSkuId,
    boxCount: fixtureBoxCount,
    unitsPerBox: fixtureUnitsPerBox,
  });
  result.fixture = { ...result.fixture, delivery: fixture };
  await page.waitForFunction((orderId) => {
    const active = window.__fw?.scene3d?.clubhouse?.()
      ?.deliveryEquipmentDiagnostics?.()?.activeArrival;
    return active?.phase === 'approach' && String(active.orderId) === String(orderId);
  }, fixtureOrderId, { timeout: 30000 });

  // Retain first-use compilation and mount cost separately; the warm A/B below
  // never compares a cold approach against already-warm variant samples.
  await measureOne({
    phaseTag: 'approach',
    temperature: 'cold',
    variant: 'normal',
    durationMs: coldApproachMs,
    live: true,
  });

  const waitAndHoldPhase = async (expectedPhase, minimumProgress) => {
    phase = `wait:${expectedPhase}`;
    await page.waitForFunction(({ orderId, wanted, progress }) => {
      const active = window.__fw?.scene3d?.clubhouse?.()
        ?.deliveryEquipmentDiagnostics?.()?.activeArrival;
      return String(active?.orderId) === String(orderId)
        && active?.phase === wanted
        && Number(active?.progress) >= progress;
    }, {
      orderId: fixtureOrderId,
      wanted: expectedPhase,
      progress: minimumProgress,
    }, { timeout: 30000 });
    const before = await page.evaluate(
      (wanted) => window.__deliveryArrivalAbRuntime.holdPhase(wanted),
      expectedPhase,
    );
    await page.waitForTimeout(80);
    const after = await page.evaluate(() => window.__deliveryArrivalAbRuntime.phaseState());
    result.diagnostics.phaseHolds.push({ expectedPhase, before, after });
    if (after.activeArrival?.phase !== expectedPhase) {
      throw new Error(`Phase hold drifted from ${expectedPhase} to ${after.activeArrival?.phase || 'none'}.`);
    }
    return after;
  };

  const releasePhase = async (expectedPhase) => {
    const released = await page.evaluate(() => window.__deliveryArrivalAbRuntime.releasePhase());
    result.diagnostics.phaseHolds.push({ expectedPhase, release: released });
    if (!released.released) throw new Error(`Phase ${expectedPhase} did not have an active hold.`);
    await page.waitForTimeout(50);
  };

  const phaseTargets = [
    ['approach', 0.42],
    ['opening', 0.18],
    ['open-hold', 0.05],
    ['unloading', 0.18],
    ['closing', 0.18],
    ['departing', 0.35],
  ];
  for (const [phaseTag, targetProgress] of phaseTargets) {
    await waitAndHoldPhase(phaseTag, targetProgress);
    try {
      await measureSnapshotAb(phaseTag, 'warm');
      const held = await page.evaluate(() => window.__deliveryArrivalAbRuntime.phaseState());
      if (held.activeArrival?.phase !== phaseTag) {
        throw new Error(`A/B variants advanced held phase ${phaseTag} to ${held.activeArrival?.phase || 'none'}.`);
      }
    } finally {
      await releasePhase(phaseTag);
    }
  }

  phase = 'wait:complete';
  await page.waitForFunction((orderId) => {
    const diagnostics = window.__fw?.scene3d?.clubhouse?.()?.deliveryEquipmentDiagnostics?.();
    return diagnostics?.beatHistory?.some((entry) => (
      entry.beat === 'complete' && String(entry.orderId) === String(orderId)
    ));
  }, fixtureOrderId, { timeout: 30000 });
  result.fixture.completion = await page.evaluate(() => ({
    handleStatus: window.__deliveryArrivalAbHandle?.status || null,
    result: window.__deliveryArrivalAbResult || null,
    diagnostics: window.__fw.scene3d.clubhouse().deliveryEquipmentDiagnostics(),
    presentation: window.__fw.scene3d.clubhouse().deliveryBoxPresentationDiagnostics?.() || null,
  }));
  await lifecycleSnapshot('after-delivery-and-ab', { collectGarbage: true });

  const comparable = result.samples.filter((entry) => entry.meta.temperature === 'warm');
  for (const sample of comparable) {
    if (sample.meta.variant === 'normal' || sample.meta.variant === 'normal-repeat') continue;
    const baseline = comparable.find((candidate) => (
      candidate.meta.phaseTag === sample.meta.phaseTag
      && candidate.meta.variant === 'normal'
    ));
    if (!baseline) continue;
    const percent = (next, previous) => (
      Number.isFinite(next) && Number.isFinite(previous) && previous !== 0
        ? +(((next - previous) / previous) * 100).toFixed(2)
        : null
    );
    result.comparisons.push({
      phaseTag: sample.meta.phaseTag,
      variant: sample.meta.variant,
      baseline: 'normal',
      avgFpsDeltaPercent: percent(sample.frame.avgFps, baseline.frame.avgFps),
      low1FpsDeltaPercent: percent(sample.frame.low1Fps, baseline.frame.low1Fps),
      avgFrameMsDeltaPercent: percent(sample.frame.avgMs, baseline.frame.avgMs),
      drawCallsDelta: +(sample.renderer.calls.average - baseline.renderer.calls.average).toFixed(2),
      trianglesDelta: +(sample.renderer.triangles.average - baseline.renderer.triangles.average).toFixed(2),
      rendererGeometriesDelta:
        sample.resources.rendererGeometries - baseline.resources.rendererGeometries,
      rendererProgramsDelta:
        sample.resources.rendererPrograms == null || baseline.resources.rendererPrograms == null
          ? null : sample.resources.rendererPrograms - baseline.resources.rendererPrograms,
    });
  }

  const normalRepeatDrift = comparable.map((baseline) => {
    if (baseline.meta.variant !== 'normal') return null;
    const repeat = comparable.find((candidate) => (
      candidate.meta.phaseTag === baseline.meta.phaseTag
      && candidate.meta.variant === 'normal-repeat'
    ));
    if (!repeat) return null;
    return {
      phaseTag: baseline.meta.phaseTag,
      avgFpsDelta: +(repeat.frame.avgFps - baseline.frame.avgFps).toFixed(2),
      drawCallsDelta: +(repeat.renderer.calls.average - baseline.renderer.calls.average).toFixed(2),
      trianglesDelta: +(repeat.renderer.triangles.average - baseline.renderer.triangles.average).toFixed(2),
      rootVisibleRestored: repeat.phaseStart.vanRootVisible === baseline.phaseStart.vanRootVisible,
      gtaoRestored: repeat.phaseStart.gtaoEnabled === baseline.phaseStart.gtaoEnabled,
      shadowsRestored: repeat.phaseStart.shadowMapEnabled === baseline.phaseStart.shadowMapEnabled
        && repeat.phaseStart.sunCastShadow === baseline.phaseStart.sunCastShadow,
    };
  }).filter(Boolean);
  result.reversibility = normalRepeatDrift;
  result.checks = {
    exactViewport: result.environment.viewport.width === 1600
      && result.environment.viewport.height === 900
      && Math.abs(result.environment.devicePixelRatio - 1) < 1e-3,
    fixedClock: fixedState.clockMinutes % 1440 === 14 * 60,
    realNineCartonLoad: fixture.createdBoxes.length === fixtureBoxCount,
    allRequestedPhasesMeasured: phaseTargets.every(([name]) => (
      result.samples.some((entry) => entry.meta.phaseTag === name && entry.meta.variant === 'normal')
    )),
    rendererCountersNonzero: result.samples.every((entry) => (
      entry.renderer.calls.samples > 0
      && entry.renderer.calls.max > 0
      && entry.renderer.triangles.max > 0
    )),
    phaseHoldsStable: result.samples.filter((entry) => !entry.meta.live).every((entry) => (
      entry.meta.phaseTag === 'hidden-prearrival'
      || entry.phaseStart.activeArrival?.phase === entry.meta.phaseTag
        && entry.phaseEnd.activeArrival?.phase === entry.meta.phaseTag
        && Math.abs(
          Number(entry.phaseEnd.activeArrival?.progress)
            - Number(entry.phaseStart.activeArrival?.progress),
        ) <= 0.001
    )),
    safeVariantsRestored: normalRepeatDrift.every((entry) => (
      entry.rootVisibleRestored && entry.gtaoRestored && entry.shadowsRestored
    )),
    colliderBypassHonest: result.availability['collider-sync-bypass']?.available === true
      || result.diagnostics.skipped.some((entry) => entry.variant === 'collider-sync-bypass'),
    noPageErrors: result.diagnostics.pageErrors.length === 0,
    noConsoleErrors: result.diagnostics.consoleErrors.length === 0,
  };
  result.ok = Object.values(result.checks).every(Boolean);
  phase = 'cleanup';
  await page.evaluate(() => window.__deliveryArrivalAbRuntime?.uninstall?.());
  result.completedAt = new Date().toISOString();
  result.elapsedMs = Date.now() - startedAt;
  return result;
}
