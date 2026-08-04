async (page) => {
  // Fixed-pose delivery-arrival scene census and reversible A/B profiler.
  //
  // Run only while no other tools/qa/run-playwright.cjs process is active:
  //   $env:HEADED='1'
  //   $env:QA_RESULT_PATH='qa/steam-performance-master-pass/delivery-arrival-scene-census/result.json'
  //   $env:DELIVERY_CENSUS_SCREENSHOT_DIR='qa/steam-performance-master-pass/delivery-arrival-scene-census/screenshots'
  //   node tools/qa/run-playwright.cjs tools/qa/delivery-arrival-scene-census.js --bootstrap
  //
  // Focused warm interleaved example (rounds > 1 enables interleaving and
  // bracket-normalized comparisons unless DELIVERY_CENSUS_COMPARISON_MODE is set):
  //   $env:DELIVERY_CENSUS_VARIANTS='interior-gtao-excluded,interior-root-hidden'
  //   $env:DELIVERY_CENSUS_ROUNDS='5'
  //   $env:DELIVERY_CENSUS_SAMPLE_MS='1800'
  //
  // The fixture is held at one production open-hold pose by passing dt=0 through
  // the public clubhouse update function. Every A/B mutation is QA-only, is
  // restored after its sample, and is checked again during final cleanup.

  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const crypto = process.getBuiltinModule('node:crypto');
  const childProcess = process.getBuiltinModule('node:child_process');
  const startedAt = Date.now();
  const numberEnv = (name, fallback, minimum = 0) => {
    const parsed = Number(process.env[name]);
    return Number.isFinite(parsed) ? Math.max(minimum, Math.floor(parsed)) : fallback;
  };
  const flagEnv = (name, fallback = false) => {
    const raw = process.env[name];
    if (raw == null || String(raw).trim() === '') return fallback;
    return /^(1|true|yes|on)$/i.test(String(raw).trim());
  };
  const sampleMs = numberEnv('DELIVERY_CENSUS_SAMPLE_MS', 2600, 500);
  const variantWarmupMs = numberEnv('DELIVERY_CENSUS_VARIANT_WARMUP_MS', 900, 100);
  const settleMs = numberEnv('DELIVERY_CENSUS_SETTLE_MS', 220, 50);
  const gpuDrainMs = numberEnv('DELIVERY_CENSUS_GPU_DRAIN_MS', 260, 50);
  const rounds = Math.min(50, numberEnv('DELIVERY_CENSUS_ROUNDS', 1, 1));
  const screenshotDir = path.resolve(
    process.env.DELIVERY_CENSUS_SCREENSHOT_DIR
      || 'qa/steam-performance-master-pass/delivery-arrival-scene-census/screenshots',
  );
  fs.mkdirSync(screenshotDir, { recursive: true });

  const sourceFiles = [
    'tools/qa/delivery-arrival-scene-census.js',
    'src/render3d/courseScene.js',
    'src/render3d/clubhouse.js',
    'src/render3d/clubhouse/shell.js',
    'src/render3d/clubhouse/deliveryEquipment.js',
    'src/sim/deliveries.js',
    'vendor/addons/postprocessing/GTAOPass.js',
  ];
  const sourceHashes = Object.fromEntries(sourceFiles.map((relativePath) => {
    const absolutePath = path.resolve(relativePath);
    if (!fs.existsSync(absolutePath)) {
      return [relativePath, { exists: false, sha256: null, bytes: null }];
    }
    const bytes = fs.readFileSync(absolutePath);
    return [relativePath, {
      exists: true,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      bytes: bytes.length,
    }];
  }));
  const git = (() => {
    try {
      const head = childProcess.execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: process.cwd(), encoding: 'utf8', windowsHide: true,
      }).trim();
      const status = childProcess.execFileSync('git', ['status', '--porcelain'], {
        cwd: process.cwd(), encoding: 'utf8', windowsHide: true,
      }).trim();
      return {
        head,
        dirty: status.length > 0,
        changedPathCount: status ? status.split(/\r?\n/).length : 0,
      };
    } catch (error) {
      return { head: null, dirty: null, changedPathCount: null, error: String(error.message || error) };
    }
  })();

  const fixedCamera = Object.freeze({ x: 25.2, z: 9.2, yaw: 1.00, pitch: -0.14 });
  const fixedWeather = Object.freeze({
    tempHiF: 74,
    tempLoF: 55,
    rainIn: 0,
    humidity: 0.40,
    windMph: 6,
  });
  const fixture = Object.freeze({
    orderId: 98174142,
    skuId: 'cap1',
    boxCount: 9,
    unitsPerBox: 8,
  });
  const availableVariants = Object.freeze([
    'baseline',
    'interior-root-hidden',
    'interior-gtao-excluded',
    'interior-point-lights-off',
    'essential-interior-lights-only',
    'shadows-off',
    'production-gtao-mask-disabled',
  ]);
  const variantListEnv = String(process.env.DELIVERY_CENSUS_VARIANTS || '').trim();
  const configuredVariants = variantListEnv
    ? variantListEnv.split(',').map((name) => name.trim()).filter(Boolean)
    : availableVariants.filter((name) => name !== 'production-gtao-mask-disabled');
  const unknownVariants = configuredVariants.filter((name) => !availableVariants.includes(name));
  if (unknownVariants.length) {
    throw new Error(`Unknown DELIVERY_CENSUS_VARIANTS: ${unknownVariants.join(', ')}`);
  }
  // A baseline is always required even when the env list contains treatments only.
  const variants = Object.freeze([
    'baseline',
    ...configuredVariants.filter((name, index) => (
      name !== 'baseline' && configuredVariants.indexOf(name) === index
    )),
  ]);
  const explicitInterleave = flagEnv('DELIVERY_CENSUS_INTERLEAVED') || rounds > 1;
  const comparisonAliases = Object.freeze({
    first: 'first-baseline',
    'first-baseline': 'first-baseline',
    nearest: 'nearest-baseline',
    'nearest-baseline': 'nearest-baseline',
    bracket: 'bracket-normalized',
    'bracket-normalized': 'bracket-normalized',
  });
  const requestedComparisonMode = String(
    process.env.DELIVERY_CENSUS_COMPARISON_MODE
      || (explicitInterleave ? 'bracket-normalized' : 'first-baseline'),
  ).trim().toLowerCase();
  const comparisonMode = comparisonAliases[requestedComparisonMode];
  if (!comparisonMode) {
    throw new Error(
      `Unknown DELIVERY_CENSUS_COMPARISON_MODE: ${requestedComparisonMode}. `
      + 'Use first-baseline, nearest-baseline, or bracket-normalized.',
    );
  }
  const interleaved = explicitInterleave || comparisonMode !== 'first-baseline';
  const treatmentVariants = Object.freeze(variants.filter((name) => name !== 'baseline'));
  const roundDigits = Math.max(2, String(rounds + 1).length);
  const interleavedPlan = [];
  if (interleaved) {
    for (let round = 1; round <= rounds; round += 1) {
      interleavedPlan.push({
        variant: 'baseline',
        name: `baseline-r${String(round).padStart(roundDigits, '0')}`,
        round,
        role: 'round-baseline',
      });
      // Alternating the treatment order balances within-bracket drift when more
      // than one focused variant is requested.
      const ordered = round % 2 === 1
        ? treatmentVariants
        : treatmentVariants.slice().reverse();
      for (const variant of ordered) {
        interleavedPlan.push({
          variant,
          name: `${variant}-r${String(round).padStart(roundDigits, '0')}`,
          round,
          role: 'treatment',
        });
      }
    }
    interleavedPlan.push({
      variant: 'baseline',
      name: `baseline-r${String(rounds + 1).padStart(roundDigits, '0')}`,
      round: rounds + 1,
      role: 'closing-baseline',
    });
  }
  const result = {
    ok: false,
    protocol: {
      launch: 'HEADED=1 node tools/qa/run-playwright.cjs tools/qa/delivery-arrival-scene-census.js --bootstrap',
      viewport: { width: 1600, height: 900 },
      deviceScaleFactor: 1,
      fixedCamera: {
        ...fixedCamera,
        coordinates: 'clubhouse-local x/z; yaw/pitch radians',
        source: 'delivery equipment acceptance approach camera',
      },
      fixedClock: '14:00 local game time',
      fixedWeather,
      deliveryPose: 'production open-hold phase, progress >= 0.05, held via clubhouse.update(dt=0)',
      fixture: 'nine authoritative cap1 merch cartons created by sim/deliveries.arriveOrder; no fixture localStorage write',
      sampleMs,
      variantWarmupMs,
      settleMs,
      gpuDrainMs,
      rounds,
      interleaved,
      comparisonMode,
      measurementOrder: interleaved
        ? interleavedPlan.map((entry) => entry.name)
        : [...variants, 'baseline-repeat'],
      frameTiming: 'requestAnimationFrame deltas; 1% low is reciprocal of mean worst 1% frame duration',
      rendererCounters: 'WebGLRenderer.info reset immediately before and read after each complete EffectComposer frame',
      gpuTiming: 'EXT_disjoint_timer_query_webgl2 every sixth composed frame when available; otherwise explicitly unavailable',
      gtaoIsolation: 'clubhouse interior hidden only around GTAOPass._renderOverride normal/depth G-buffer draw; beauty render and exterior delivery root stay visible',
      productionGtaoMaskControl: 'production-gtao-mask-disabled temporarily restores GTAOPass.prototype.render so the shipped public render wrapper can be compared against an exact control',
      essentialLightRule: 'retain up to three active interior PointLights ranked by finite-range influence at the delivery van and fixed camera; ties use stable scene traversal order',
      variants,
    },
    git,
    sourceHashes,
    environment: {},
    fixture: null,
    sceneCensus: null,
    baselineState: null,
    essentialLights: null,
    samples: [],
    comparisons: [],
    comparisonSummary: [],
    restoration: [],
    lifecycle: [],
    diagnostics: {
      consoleErrors: [],
      consoleWarnings: [],
      pageErrors: [],
      requestFailures: [],
    },
  };

  let phase = 'init';
  const diagnosticEntry = (text) => ({
    phase,
    atMs: Date.now() - startedAt,
    text: String(text).slice(0, 1200),
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

  await page.addInitScript(() => {
    const rawAdd = EventTarget.prototype.addEventListener;
    const rawRemove = EventTarget.prototype.removeEventListener;
    const counts = {};
    const keyFor = (target, type) => `${target === window ? 'window' : 'document'}:${type}`;
    EventTarget.prototype.addEventListener = function deliveryCensusAdd(type, listener, options) {
      if (this === window || this === document) {
        const key = keyFor(this, type);
        counts[key] = (counts[key] || 0) + 1;
      }
      return rawAdd.call(this, type, listener, options);
    };
    EventTarget.prototype.removeEventListener = function deliveryCensusRemove(type, listener, options) {
      if (this === window || this === document) {
        const key = keyFor(this, type);
        counts[key] = (counts[key] || 0) - 1;
      }
      return rawRemove.call(this, type, listener, options);
    };
    window.__deliveryCensusListenerCounts = counts;
  });

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  await cdp.send('HeapProfiler.enable');
  const lifecycleSnapshot = async (name, collectGarbage = false) => {
    if (collectGarbage) {
      await cdp.send('HeapProfiler.collectGarbage');
      await page.waitForTimeout(60);
      await cdp.send('HeapProfiler.collectGarbage');
    }
    const [dom, perf, runtimeHeap, game] = await Promise.all([
      cdp.send('Memory.getDOMCounters'),
      cdp.send('Performance.getMetrics'),
      cdp.send('Runtime.getHeapUsage'),
      page.evaluate(() => {
        const app = window.__fw;
        const renderer = app?.scene3d?.renderer;
        const counts = { ...(window.__deliveryCensusListenerCounts || {}) };
        return {
          screen: app?.screen || null,
          sceneId: app?.scene3d?.scene?.uuid || null,
          performanceMemoryUsedBytes: performance.memory?.usedJSHeapSize ?? null,
          trackedListeners: {
            net: Object.values(counts).reduce((sum, value) => sum + value, 0),
            byType: counts,
          },
          rendererMemory: renderer ? { ...renderer.info.memory } : null,
          rendererPrograms: renderer?.info?.programs?.length ?? null,
        };
      }),
    ]);
    const metrics = Object.fromEntries(perf.metrics.map((entry) => [entry.name, entry.value]));
    const snapshot = {
      name,
      atMs: Date.now() - startedAt,
      ...game,
      cdp: {
        documents: dom.documents,
        nodes: dom.nodes,
        jsEventListeners: dom.jsEventListeners,
        jsHeapUsedBytes: metrics.JSHeapUsedSize ?? null,
        jsHeapTotalBytes: metrics.JSHeapTotalSize ?? null,
        runtimeHeap,
      },
    };
    result.lifecycle.push(snapshot);
    return snapshot;
  };

  phase = 'navigate';
  await page.goto('http://localhost:8457/', { waitUntil: 'domcontentloaded' });
  await page.setViewportSize({ width: 1600, height: 900 });
  const { clickThroughMenu } = await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`);
    await clickThroughMenu(page);
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

  phase = 'fixed-state';
  const fixedState = await page.evaluate(({ camera, weather }) => {
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    const state = app.state;
    const origin = clubhouse.interior.position;
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
    clubhouse.setOrganicWalkins?.(false);
    clubhouse.clearWalkins?.();
    return {
      screen: app.screen,
      sceneId: app.scene3d.scene.uuid,
      clockMinutes: state.clock.minutes,
      speedIdx: app.speedIdx,
      saveKeyPresent: localStorage.getItem('golfempire:autosave') != null,
      clubhouseOrigin: { x: origin.x, y: origin.y, z: origin.z },
      walk: { ...walk.state },
    };
  }, { camera: fixedCamera, weather: fixedWeather });
  await page.waitForTimeout(180);

  phase = 'stage-delivery';
  const stagedDelivery = await page.evaluate(async (fixtureSpec) => {
    const deliveries = await import(new URL('src/sim/deliveries.js', document.baseURI).href);
    const boxes = await import(new URL('src/data/boxes.js', document.baseURI).href);
    const app = window.__fw;
    const state = app.state;
    deliveries.ensureDeliveries(state);
    const dims = boxes.boxDims('merchbox');
    const manifest = {
      supplierId: 'delivery-arrival-scene-census',
      supplier: 'Pinehollow Performance Supply',
      boxes: Array.from({ length: fixtureSpec.boxCount }, () => ({
        kind: 'merchbox', qty: fixtureSpec.unitsPerBox,
        w: dims.w, h: dims.h, d: dims.d, lb: 5.1, fragile: false,
      })),
      boxCount: fixtureSpec.boxCount,
      weight: +(fixtureSpec.boxCount * 5.1).toFixed(1),
      fee: 0,
    };
    const order = {
      id: fixtureSpec.orderId,
      skuId: fixtureSpec.skuId,
      qty: fixtureSpec.boxCount * fixtureSpec.unitsPerBox,
      manifest,
    };
    const created = deliveries.arriveOrder(state, order);
    if (created.length !== fixtureSpec.boxCount) {
      throw new Error(`Expected ${fixtureSpec.boxCount} cartons; received ${created.length}.`);
    }
    const clubhouse = app.scene3d.clubhouse();
    const handle = clubhouse.presentDeliveryArrival({
      orderId: order.id,
      boxCount: manifest.boxCount,
      skuId: order.skuId,
      supplier: manifest.supplier,
    });
    if (!handle) throw new Error('Production presentDeliveryArrival rejected the census fixture.');
    window.__deliveryCensusHandle = handle;
    window.__deliveryCensusCompletion = null;
    handle.promise.then((value) => { window.__deliveryCensusCompletion = value; });
    clubhouse.rebuildBoxes();
    return {
      orderId: order.id,
      skuId: order.skuId,
      requestedBoxCount: fixtureSpec.boxCount,
      createdBoxes: created.map((box) => ({
        id: box.id, orderId: box.orderId, skuId: box.skuId,
        qty: box.qty, kind: box.box, loc: box.loc,
      })),
      handle: { id: handle.id, orderId: handle.orderId, status: handle.status },
      localStorageWrittenByFixture: false,
    };
  }, fixture);
  result.fixture = { fixedState, delivery: stagedDelivery };
  await page.waitForFunction((orderId) => {
    const active = window.__fw?.scene3d?.clubhouse?.()
      ?.deliveryEquipmentDiagnostics?.()?.activeArrival;
    return String(active?.orderId) === String(orderId)
      && active?.phase === 'open-hold'
      && Number(active?.progress) >= 0.05;
  }, fixture.orderId, { timeout: 60000 });

  phase = 'install-runtime-and-hold';
  const install = await page.evaluate(() => {
    const app = window.__fw;
    const scene3d = app.scene3d;
    const scene = scene3d.scene;
    const renderer = scene3d.renderer;
    const composer = scene3d.post?.composer;
    const gtao = scene3d.post?.gtao;
    const sun = scene3d.post?.sun;
    const clubhouse = scene3d.clubhouse();
    const interior = clubhouse?.interior;
    const vanRoot = scene.getObjectByName('delivery_van')
      || scene.getObjectByName('DeliveryEquipmentRoot_delivery_van');
    if (!renderer?.info || !composer?.render || !gtao?._renderOverride || !interior || !vanRoot) {
      throw new Error('Delivery census requires renderer, composer, GTAO internals, clubhouse interior, and delivery van root.');
    }

    const originalComposerRender = composer.render;
    const originalAutoReset = renderer.info.autoReset;
    const originalGtaoRenderOverride = gtao._renderOverride;
    const originalGtaoRender = gtao.render;
    const prototypeGtaoRender = Object.getPrototypeOf(gtao)?.render;
    if (typeof prototypeGtaoRender !== 'function') {
      throw new Error('Delivery census requires the original GTAOPass.prototype.render control.');
    }
    const originalClubhouseUpdate = clubhouse.update;
    const gl = renderer.getContext();
    const timer = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    const gpuPending = [];
    const samples = new Map();
    let active = null;
    let nextToken = 0;
    let composedFrame = 0;
    let variantRestore = null;
    let gtaoExclusionActive = false;
    let productionGtaoMaskDisabled = false;

    const mean = (values) => values.length
      ? values.reduce((sum, value) => sum + value, 0) / values.length
      : 0;
    const percentile = (sorted, fraction) => (
      sorted.length
        ? sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))]
        : 0
    );
    const summarizeCounter = (values) => {
      const sorted = values.slice().sort((a, b) => a - b);
      return {
        samples: sorted.length,
        average: +mean(sorted).toFixed(3),
        p50: +percentile(sorted, 0.50).toFixed(3),
        p95: +percentile(sorted, 0.95).toFixed(3),
        max: +(sorted[sorted.length - 1] || 0).toFixed(3),
      };
    };
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

    const lightPath = (light) => {
      const parts = [];
      let current = light;
      while (current && current !== scene) {
        const index = current.parent?.children?.indexOf(current) ?? -1;
        parts.push(`${current.name || current.type}[${index}]`);
        current = current.parent;
      }
      return parts.reverse().join('/');
    };
    const pointLights = [];
    interior.traverse((object) => {
      if (object.isPointLight) pointLights.push(object);
    });
    const pointLightOriginals = pointLights.map((light, traversalIndex) => ({
      light,
      traversalIndex,
      uuid: light.uuid,
      visible: light.visible,
      intensity: light.intensity,
      path: lightPath(light),
    }));

    const vanWorld = vanRoot.getWorldPosition(vanRoot.position.clone());
    const cameraWorld = scene3d.camera.position.clone();
    const lightDetails = pointLightOriginals.map((entry) => {
      const world = entry.light.getWorldPosition(entry.light.position.clone());
      const distanceToVan = world.distanceTo(vanWorld);
      const distanceToCamera = world.distanceTo(cameraWorld);
      const range = Number(entry.light.distance) || Infinity;
      const reach = (distance) => Number.isFinite(range)
        ? Math.max(0, 1 - distance / Math.max(0.001, range))
        : 1 / (1 + distance);
      const influenceScore = entry.intensity
        * ((reach(distanceToVan) ** 2) + 0.35 * (reach(distanceToCamera) ** 2));
      return {
        ...entry,
        world: { x: world.x, y: world.y, z: world.z },
        distanceToVan,
        distanceToCamera,
        range,
        influenceScore,
      };
    });
    const eligible = lightDetails.filter((entry) => entry.visible && entry.intensity > 0);
    const ranked = eligible.slice().sort((a, b) => (
      b.influenceScore - a.influenceScore || a.traversalIndex - b.traversalIndex
    ));
    const essential = new Set(ranked.slice(0, Math.min(3, ranked.length)).map((entry) => entry.uuid));

    const stateSnapshot = () => ({
      phase: clubhouse.deliveryEquipmentDiagnostics?.()?.activeArrival || null,
      interiorVisible: interior.visible,
      vanVisible: vanRoot.visible,
      gtaoEnabled: gtao.enabled,
      gtaoExclusionActive,
      gtaoOverrideRestored: gtao._renderOverride === originalGtaoRenderOverride,
      productionGtaoMaskDisabled,
      gtaoRenderRestored: gtao.render === originalGtaoRender,
      shadowMapEnabled: renderer.shadowMap.enabled,
      sunCastShadow: sun?.castShadow ?? null,
      pointLights: pointLightOriginals.map((entry) => ({
        uuid: entry.uuid,
        path: entry.path,
        visible: entry.light.visible,
        intensity: entry.light.intensity,
        essential: essential.has(entry.uuid),
      })),
      camera: {
        x: scene3d.walk.state.x,
        z: scene3d.walk.state.z,
        yaw: scene3d.walk.state.yaw,
        pitch: scene3d.walk.state.pitch,
      },
    });

    const triangleCount = (object) => {
      const geometry = object.geometry;
      if (!geometry) return 0;
      const count = geometry.index?.count ?? geometry.attributes?.position?.count ?? 0;
      return (count / 3) * (object.isInstancedMesh ? object.count : 1);
    };
    const censusRoot = (root, label) => {
      let nodes = 0;
      let effectiveVisibleNodes = 0;
      let meshes = 0;
      let effectiveVisibleMeshes = 0;
      let instancedMeshes = 0;
      let triangles = 0;
      let effectiveVisibleTriangles = 0;
      let matrixAutoUpdate = 0;
      let shadowCasters = 0;
      let effectiveVisibleShadowCasters = 0;
      const shadowCasterNames = [];
      const materials = new Set();
      const visibleMaterials = new Set();
      const geometries = new Set();
      const textures = new Set();
      const lightCounts = {};
      const visibleLightCounts = {};
      const visit = (object, ancestorVisible) => {
        const effectiveVisible = ancestorVisible && object.visible;
        nodes += 1;
        if (effectiveVisible) effectiveVisibleNodes += 1;
        if (object.matrixAutoUpdate) matrixAutoUpdate += 1;
        if (object.isLight) {
          lightCounts[object.type] = (lightCounts[object.type] || 0) + 1;
          if (effectiveVisible && Number(object.intensity ?? 1) > 0) {
            visibleLightCounts[object.type] = (visibleLightCounts[object.type] || 0) + 1;
          }
        }
        if (object.isMesh || object.isPoints || object.isLine) {
          meshes += 1;
          if (object.isInstancedMesh) instancedMeshes += 1;
          const objectTriangles = triangleCount(object);
          triangles += objectTriangles;
          if (effectiveVisible) {
            effectiveVisibleMeshes += 1;
            effectiveVisibleTriangles += objectTriangles;
          }
          if (object.isMesh && object.castShadow) {
            shadowCasters += 1;
            if (effectiveVisible) effectiveVisibleShadowCasters += 1;
            if (shadowCasterNames.length < 24) shadowCasterNames.push(object.name || object.type);
          }
          if (object.geometry?.uuid) geometries.add(object.geometry.uuid);
          const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
          for (const material of objectMaterials) {
            if (!material?.uuid) continue;
            materials.add(material.uuid);
            if (effectiveVisible) visibleMaterials.add(material.uuid);
            for (const value of Object.values(material)) {
              if (value?.isTexture && value.uuid) textures.add(value.uuid);
            }
            for (const uniform of Object.values(material.uniforms || {})) {
              const value = uniform?.value;
              if (value?.isTexture && value.uuid) textures.add(value.uuid);
              if (Array.isArray(value)) {
                for (const item of value) if (item?.isTexture && item.uuid) textures.add(item.uuid);
              }
            }
          }
        }
        for (const child of object.children || []) visit(child, effectiveVisible);
      };
      visit(root, true);
      return {
        label,
        uuid: root.uuid,
        name: root.name || null,
        type: root.type,
        visible: root.visible,
        nodes,
        effectiveVisibleNodes,
        meshes,
        effectiveVisibleMeshes,
        instancedMeshes,
        triangles: Math.round(triangles),
        effectiveVisibleTriangles: Math.round(effectiveVisibleTriangles),
        matrixAutoUpdate,
        shadowCasters,
        effectiveVisibleShadowCasters,
        shadowCasterNames,
        materials: materials.size,
        effectiveVisibleMaterials: visibleMaterials.size,
        geometries: geometries.size,
        textures: textures.size,
        lights: lightCounts,
        effectiveVisibleLights: visibleLightCounts,
      };
    };
    const sceneCensus = () => {
      const topLevel = scene.children.map((child, index) => {
        let label = child.name || `${child.type}#${index}`;
        if (child === clubhouse.group) label = 'clubhouse-shell';
        if (child === clubhouse.interior) label = 'clubhouse-interior';
        return censusRoot(child, label);
      }).sort((a, b) => b.nodes - a.nodes);
      const mandatory = new Set([
        clubhouse.group.uuid,
        clubhouse.interior.uuid,
        vanRoot.uuid,
      ]);
      const majorRoots = topLevel.filter((entry, index) => index < 30 || mandatory.has(entry.uuid));
      return {
        wholeScene: censusRoot(scene, 'scene-total'),
        clubhouseShell: censusRoot(clubhouse.group, 'clubhouse-shell'),
        clubhouseInterior: censusRoot(clubhouse.interior, 'clubhouse-interior'),
        deliveryVan: censusRoot(vanRoot, 'delivery-van'),
        topLevelRootCount: topLevel.length,
        majorRoots,
      };
    };

    const resourceState = () => {
      const counts = { ...(window.__deliveryCensusListenerCounts || {}) };
      return {
        scene: censusRoot(scene, 'scene-total'),
        interior: censusRoot(interior, 'clubhouse-interior'),
        rendererMemory: { ...renderer.info.memory },
        rendererPrograms: renderer.info.programs?.length ?? null,
        performanceMemoryUsedBytes: performance.memory?.usedJSHeapSize ?? null,
        trackedListeners: {
          net: Object.values(counts).reduce((sum, value) => sum + value, 0),
          byType: counts,
        },
      };
    };

    const restoreVariant = () => {
      const restore = variantRestore;
      variantRestore = null;
      if (restore) restore();
      return stateSnapshot();
    };
    const applyVariant = (name) => {
      restoreVariant();
      if (name === 'baseline') {
        variantRestore = () => {};
      } else if (name === 'interior-root-hidden') {
        const previous = interior.visible;
        interior.visible = false;
        variantRestore = () => { interior.visible = previous; };
      } else if (name === 'interior-gtao-excluded') {
        const previous = gtao._renderOverride;
        gtaoExclusionActive = true;
        gtao._renderOverride = function deliveryCensusGtaoInteriorMask(...args) {
          const wasVisible = interior.visible;
          interior.visible = false;
          try {
            return previous.apply(this, args);
          } finally {
            interior.visible = wasVisible;
          }
        };
        variantRestore = () => {
          gtao._renderOverride = previous;
          gtaoExclusionActive = false;
        };
      } else if (name === 'interior-point-lights-off') {
        const previous = pointLightOriginals.map((entry) => ({
          light: entry.light, visible: entry.light.visible,
        }));
        for (const entry of previous) entry.light.visible = false;
        variantRestore = () => {
          for (const entry of previous) entry.light.visible = entry.visible;
        };
      } else if (name === 'essential-interior-lights-only') {
        const previous = pointLightOriginals.map((entry) => ({
          light: entry.light, visible: entry.light.visible,
        }));
        for (const entry of previous) {
          if (!essential.has(entry.light.uuid)) entry.light.visible = false;
        }
        variantRestore = () => {
          for (const entry of previous) entry.light.visible = entry.visible;
        };
      } else if (name === 'shadows-off') {
        const previous = {
          shadowMapEnabled: renderer.shadowMap.enabled,
          sunCastShadow: sun?.castShadow,
        };
        renderer.shadowMap.enabled = false;
        if (sun) sun.castShadow = false;
        variantRestore = () => {
          renderer.shadowMap.enabled = previous.shadowMapEnabled;
          if (sun) sun.castShadow = previous.sunCastShadow;
        };
      } else if (name === 'production-gtao-mask-disabled') {
        const previous = gtao.render;
        productionGtaoMaskDisabled = true;
        gtao.render = prototypeGtaoRender;
        variantRestore = () => {
          gtao.render = previous;
          productionGtaoMaskDisabled = false;
        };
      } else {
        throw new Error(`Unknown delivery census variant: ${name}`);
      }
      return stateSnapshot();
    };

    renderer.info.autoReset = false;
    composer.render = function deliveryCensusComposerRender(...args) {
      renderer.info.autoReset = false;
      renderer.info.reset();
      composedFrame += 1;
      const sample = active;
      let query = null;
      if (sample?.running && timer && composedFrame % 6 === 0 && gpuPending.length < 12) {
        query = gl.createQuery();
        gl.beginQuery(timer.TIME_ELAPSED_EXT, query);
      }
      let value;
      try {
        value = originalComposerRender.apply(this, args);
      } finally {
        if (query) {
          gl.endQuery(timer.TIME_ELAPSED_EXT);
          gpuPending.push({ query, token: sample.token });
        }
      }
      if (sample?.running) {
        sample.calls.push(renderer.info.render.calls || 0);
        sample.triangles.push(renderer.info.render.triangles || 0);
      }
      return value;
    };
    const pollGpu = () => {
      for (let index = gpuPending.length - 1; index >= 0; index -= 1) {
        const pending = gpuPending[index];
        if (!gl.getQueryParameter(pending.query, gl.QUERY_RESULT_AVAILABLE)) continue;
        const disjoint = gl.getParameter(timer.GPU_DISJOINT_EXT);
        const elapsedNs = gl.getQueryParameter(pending.query, gl.QUERY_RESULT);
        const sample = samples.get(pending.token);
        if (sample && !disjoint && Number.isFinite(elapsedNs)) sample.gpuMs.push(elapsedNs / 1e6);
        else if (sample && disjoint) sample.gpuDisjoint += 1;
        gl.deleteQuery(pending.query);
        gpuPending.splice(index, 1);
      }
      if (window.__deliveryArrivalSceneCensusRuntime) requestAnimationFrame(pollGpu);
    };
    if (timer) requestAnimationFrame(pollGpu);

    clubhouse.update = function deliveryCensusHeldUpdate() {
      return originalClubhouseUpdate.call(this, 0);
    };

    const runtime = {
      applyVariant,
      restoreVariant,
      stateSnapshot,
      sceneCensus,
      resourceState,
      essentials: {
        count: essential.size,
        selected: ranked.slice(0, Math.min(3, ranked.length)).map((entry) => ({
          uuid: entry.uuid,
          path: entry.path,
          traversalIndex: entry.traversalIndex,
          world: entry.world,
          intensity: entry.intensity,
          range: Number.isFinite(entry.range) ? entry.range : null,
          distanceToVan: +entry.distanceToVan.toFixed(4),
          distanceToCamera: +entry.distanceToCamera.toFixed(4),
          influenceScore: +entry.influenceScore.toFixed(6),
        })),
        all: lightDetails.map((entry) => ({
          uuid: entry.uuid,
          path: entry.path,
          traversalIndex: entry.traversalIndex,
          visible: entry.visible,
          intensity: entry.intensity,
          range: Number.isFinite(entry.range) ? entry.range : null,
          distanceToVan: +entry.distanceToVan.toFixed(4),
          distanceToCamera: +entry.distanceToCamera.toFixed(4),
          influenceScore: +entry.influenceScore.toFixed(6),
          selected: essential.has(entry.uuid),
        })),
      },
      gpu: {
        supported: !!timer,
        extension: timer ? 'EXT_disjoint_timer_query_webgl2' : null,
        cadence: 'every sixth complete EffectComposer frame',
      },
      start(meta) {
        if (active) throw new Error(`Sample ${active.meta.name} is already active.`);
        const token = ++nextToken;
        const sample = {
          token,
          meta,
          running: true,
          started: performance.now(),
          last: null,
          deltas: [],
          calls: [],
          triangles: [],
          gpuMs: [],
          gpuDisjoint: 0,
          stateStart: stateSnapshot(),
        };
        samples.set(token, sample);
        active = sample;
        const tick = (time) => {
          if (!sample.running) return;
          if (sample.last != null) sample.deltas.push(time - sample.last);
          sample.last = time;
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
        return { token, state: sample.stateStart };
      },
      stop() {
        if (!active) throw new Error('No delivery census sample is active.');
        const sample = active;
        sample.running = false;
        sample.elapsedMs = performance.now() - sample.started;
        sample.stateEnd = stateSnapshot();
        active = null;
        return sample.token;
      },
      finish(token) {
        const sample = samples.get(token);
        if (!sample || sample.running) throw new Error(`Sample ${token} is absent or still active.`);
        return {
          meta: sample.meta,
          elapsedMs: +sample.elapsedMs.toFixed(2),
          frame: summarizeFrames(sample.deltas),
          renderer: {
            calls: summarizeCounter(sample.calls),
            triangles: summarizeCounter(sample.triangles),
            programs: renderer.info.programs?.length ?? null,
            source: 'complete EffectComposer frames, reset immediately before and read immediately after composer.render',
          },
          gpu: {
            ...runtime.gpu,
            timing: summarizeCounter(sample.gpuMs),
            disjointSamples: sample.gpuDisjoint,
            pendingQueriesAtFinish: gpuPending.filter((entry) => entry.token === token).length,
          },
          resources: resourceState(),
          stateStart: sample.stateStart,
          stateEnd: sample.stateEnd,
        };
      },
      uninstall() {
        const before = stateSnapshot();
        restoreVariant();
        clubhouse.update = originalClubhouseUpdate;
        composer.render = originalComposerRender;
        gtao._renderOverride = originalGtaoRenderOverride;
        gtaoExclusionActive = false;
        gtao.render = originalGtaoRender;
        productionGtaoMaskDisabled = false;
        for (const pending of gpuPending.splice(0)) gl.deleteQuery(pending.query);
        renderer.info.reset();
        renderer.info.autoReset = originalAutoReset;
        delete window.__deliveryArrivalSceneCensusRuntime;
        return { before, after: stateSnapshot(), clubhouseUpdateRestored: clubhouse.update === originalClubhouseUpdate };
      },
    };
    window.__deliveryArrivalSceneCensusRuntime = runtime;
    return {
      state: stateSnapshot(),
      essentials: runtime.essentials,
      gpu: runtime.gpu,
    };
  });
  result.baselineState = install.state;
  result.essentialLights = install.essentials;
  result.sceneCensus = await page.evaluate(() => (
    window.__deliveryArrivalSceneCensusRuntime.sceneCensus()
  ));

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
      gpuTimer: window.__deliveryArrivalSceneCensusRuntime.gpu,
      postprocessing: {
        gtaoEnabled: app.scene3d.post?.gtao?.enabled ?? null,
        bloomEnabled: app.scene3d.post?.bloom?.enabled ?? null,
      },
      shadows: {
        rendererEnabled: renderer.shadowMap?.enabled ?? null,
        sunCastShadow: app.scene3d.post?.sun?.castShadow ?? null,
        mapSize: app.scene3d.post?.sun?.shadow?.mapSize
          ? { x: app.scene3d.post.sun.shadow.mapSize.x, y: app.scene3d.post.sun.shadow.mapSize.y }
          : null,
      },
    };
  });
  await lifecycleSnapshot('held-pose-before-variants', true);

  // Compile the exact light/shadow variants before the measured sweep. Each is
  // restored first so warmup order does not leak state into another variant.
  for (const name of variants) {
    phase = `prewarm:${name}`;
    await page.evaluate((variant) => (
      window.__deliveryArrivalSceneCensusRuntime.applyVariant(variant)
    ), name);
    await page.waitForTimeout(variantWarmupMs);
    const restored = await page.evaluate(() => (
      window.__deliveryArrivalSceneCensusRuntime.restoreVariant()
    ));
    result.restoration.push({ name: `prewarm:${name}`, restored });
    await page.waitForTimeout(80);
  }

  const stateMatchesBaseline = (state) => {
    const baseline = result.baselineState;
    if (!state || !baseline) return false;
    if (state.interiorVisible !== baseline.interiorVisible
      || state.vanVisible !== baseline.vanVisible
      || state.gtaoEnabled !== baseline.gtaoEnabled
      || state.gtaoExclusionActive !== false
      || state.gtaoOverrideRestored !== true
      || state.productionGtaoMaskDisabled !== false
      || state.gtaoRenderRestored !== true
      || state.shadowMapEnabled !== baseline.shadowMapEnabled
      || state.sunCastShadow !== baseline.sunCastShadow
      || state.pointLights.length !== baseline.pointLights.length) return false;
    return state.pointLights.every((entry, index) => {
      const expected = baseline.pointLights[index];
      return entry.uuid === expected.uuid
        && entry.visible === expected.visible
        && Math.abs(entry.intensity - expected.intensity) <= 1e-9;
    });
  };

  const captureScreenshot = async (name) => {
    const file = path.join(screenshotDir, `${String(result.samples.length + 1).padStart(2, '0')}-${name}.png`);
    await page.screenshot({ path: file, fullPage: false, animations: 'disabled' });
    const bytes = fs.readFileSync(file);
    return {
      path: path.relative(process.cwd(), file).replace(/\\/g, '/'),
      absolutePath: file,
      bytes: bytes.length,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    };
  };

  const measureVariant = async (variant, planEntry = null) => {
    const name = planEntry?.name || variant;
    const meta = {
      name,
      variant,
      round: planEntry?.round ?? null,
      role: planEntry?.role || (variant === 'baseline' ? 'baseline' : 'treatment'),
      sequenceIndex: result.samples.length,
      pose: 'open-hold',
    };
    phase = `measure:${name}`;
    const applied = await page.evaluate((variant) => (
      window.__deliveryArrivalSceneCensusRuntime.applyVariant(variant)
    ), variant);
    await page.waitForTimeout(settleMs);
    const started = await page.evaluate((sampleMeta) => (
      window.__deliveryArrivalSceneCensusRuntime.start(sampleMeta)
    ), meta);
    await page.waitForTimeout(sampleMs);
    const token = await page.evaluate(() => (
      window.__deliveryArrivalSceneCensusRuntime.stop()
    ));
    await page.waitForTimeout(gpuDrainMs);
    const sample = await page.evaluate((sampleToken) => (
      window.__deliveryArrivalSceneCensusRuntime.finish(sampleToken)
    ), token);
    sample.appliedState = applied;
    sample.startToken = started.token;
    sample.measuredAtMs = Date.now() - startedAt;
    sample.screenshot = await captureScreenshot(name);
    result.samples.push(sample);
    const restored = await page.evaluate(() => (
      window.__deliveryArrivalSceneCensusRuntime.restoreVariant()
    ));
    result.restoration.push({
      name: `sample:${name}`,
      state: restored,
      matchesBaseline: stateMatchesBaseline(restored),
    });
    await page.waitForTimeout(90);
    return sample;
  };

  if (interleaved) {
    for (const entry of interleavedPlan) await measureVariant(entry.variant, entry);
  } else {
    for (const name of variants) await measureVariant(name);
    const repeat = await measureVariant('baseline');
    repeat.meta.name = 'baseline-repeat';
    repeat.screenshot = {
      ...repeat.screenshot,
      note: 'filename retains baseline because capture occurred before repeat label assignment',
    };
  }

  const sampleVariant = (sample) => sample?.meta?.variant || sample?.meta?.name;
  const sampleIndex = new Map(result.samples.map((sample, index) => [sample, index]));
  const baselineSamples = result.samples.filter((sample) => sampleVariant(sample) === 'baseline');
  const firstBaseline = baselineSamples[0];
  const nearestBaseline = (sample) => baselineSamples.reduce((nearest, candidate) => {
    if (!nearest) return candidate;
    const distance = Math.abs(sampleIndex.get(candidate) - sampleIndex.get(sample));
    const nearestDistance = Math.abs(sampleIndex.get(nearest) - sampleIndex.get(sample));
    return distance < nearestDistance ? candidate : nearest;
  }, null);
  const comparisonReference = (sample) => {
    if (comparisonMode === 'first-baseline') {
      return { modeUsed: comparisonMode, entries: [{ sample: firstBaseline, weight: 1 }] };
    }
    if (comparisonMode === 'nearest-baseline') {
      return { modeUsed: comparisonMode, entries: [{ sample: nearestBaseline(sample), weight: 1 }] };
    }
    const index = sampleIndex.get(sample);
    const before = baselineSamples.filter((candidate) => sampleIndex.get(candidate) < index).at(-1);
    const after = baselineSamples.find((candidate) => sampleIndex.get(candidate) > index);
    if (!before || !after) {
      return {
        modeUsed: 'nearest-baseline-fallback',
        entries: [{ sample: nearestBaseline(sample), weight: 1 }],
      };
    }
    const beforeIndex = sampleIndex.get(before);
    const afterIndex = sampleIndex.get(after);
    const afterWeight = (index - beforeIndex) / (afterIndex - beforeIndex);
    return {
      modeUsed: comparisonMode,
      entries: [
        { sample: before, weight: 1 - afterWeight },
        { sample: after, weight: afterWeight },
      ],
    };
  };
  const weighted = (reference, read) => {
    const values = reference.entries.map(({ sample, weight }) => ({ value: read(sample), weight }));
    return values.every(({ value }) => Number.isFinite(value))
      ? values.reduce((sum, entry) => sum + entry.value * entry.weight, 0)
      : null;
  };
  const roundedDelta = (value, reference, digits) => (
    Number.isFinite(value) && Number.isFinite(reference)
      ? +(value - reference).toFixed(digits)
      : null
  );
  const comparisonInputs = interleaved
    ? result.samples.filter((sample) => sampleVariant(sample) !== 'baseline')
    : result.samples.filter((sample) => sample !== firstBaseline);
  for (const sample of comparisonInputs) {
    const reference = comparisonReference(sample);
    const baseline = {
      avgFps: weighted(reference, (entry) => entry.frame.avgFps),
      low1Fps: weighted(reference, (entry) => entry.frame.low1Fps),
      p95Ms: weighted(reference, (entry) => entry.frame.p95Ms),
      worstMs: weighted(reference, (entry) => entry.frame.worstMs),
      drawCalls: weighted(reference, (entry) => entry.renderer.calls.average),
      triangles: weighted(reference, (entry) => entry.renderer.triangles.average),
      programs: weighted(reference, (entry) => entry.renderer.programs),
      gpuAverageMs: weighted(reference, (entry) => (
        entry.gpu.timing.samples ? entry.gpu.timing.average : null
      )),
    };
    result.comparisons.push({
      name: sample.meta.name,
      variant: sampleVariant(sample),
      round: sample.meta.round,
      comparisonMode: reference.modeUsed,
      baselineReference: reference.entries.map((entry) => ({
        name: entry.sample.meta.name,
        round: entry.sample.meta.round,
        sequenceIndex: sampleIndex.get(entry.sample),
        weight: +entry.weight.toFixed(6),
      })),
      normalizedBaseline: Object.fromEntries(Object.entries(baseline).map(([key, value]) => [
        key,
        Number.isFinite(value) ? +value.toFixed(3) : null,
      ])),
      avgFpsDelta: roundedDelta(sample.frame.avgFps, baseline.avgFps, 2),
      avgFpsPercent: baseline.avgFps
        ? +((sample.frame.avgFps / baseline.avgFps - 1) * 100).toFixed(2) : null,
      low1FpsDelta: roundedDelta(sample.frame.low1Fps, baseline.low1Fps, 2),
      p95MsDelta: roundedDelta(sample.frame.p95Ms, baseline.p95Ms, 3),
      worstMsDelta: roundedDelta(sample.frame.worstMs, baseline.worstMs, 3),
      drawCallsDelta: roundedDelta(sample.renderer.calls.average, baseline.drawCalls, 2),
      trianglesDelta: roundedDelta(sample.renderer.triangles.average, baseline.triangles, 2),
      programsDelta: roundedDelta(sample.renderer.programs, baseline.programs, 3),
      gpuAverageMsDelta: sample.gpu.timing.samples
        ? roundedDelta(sample.gpu.timing.average, baseline.gpuAverageMs, 3) : null,
    });
  }
  for (const variant of [...new Set(result.comparisons.map((entry) => entry.variant))]) {
    const entries = result.comparisons.filter((entry) => entry.variant === variant);
    const meanField = (field, digits) => {
      const values = entries.map((entry) => entry[field]).filter(Number.isFinite);
      return values.length
        ? +(values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(digits)
        : null;
    };
    result.comparisonSummary.push({
      variant,
      samples: entries.length,
      avgFpsDeltaMean: meanField('avgFpsDelta', 2),
      avgFpsPercentMean: meanField('avgFpsPercent', 2),
      low1FpsDeltaMean: meanField('low1FpsDelta', 2),
      p95MsDeltaMean: meanField('p95MsDelta', 3),
      worstMsDeltaMean: meanField('worstMsDelta', 3),
      drawCallsDeltaMean: meanField('drawCallsDelta', 2),
      trianglesDeltaMean: meanField('trianglesDelta', 2),
      programsDeltaMean: meanField('programsDelta', 3),
      gpuAverageMsDeltaMean: meanField('gpuAverageMsDelta', 3),
    });
  }

  await lifecycleSnapshot('held-pose-after-variants', true);
  phase = 'cleanup';
  const cleanup = await page.evaluate(() => (
    window.__deliveryArrivalSceneCensusRuntime.uninstall()
  ));
  cleanup.matchesBaseline = stateMatchesBaseline(cleanup.after);
  result.restoration.push({ name: 'final-uninstall', ...cleanup });

  // Let the real presentation resume and prove the QA hold did not strand it.
  await page.waitForFunction((orderId) => {
    const diagnostics = window.__fw?.scene3d?.clubhouse?.()?.deliveryEquipmentDiagnostics?.();
    return diagnostics?.beatHistory?.some((entry) => (
      entry.beat === 'complete' && String(entry.orderId) === String(orderId)
    ));
  }, fixture.orderId, { timeout: 60000 });
  result.fixture.completion = await page.evaluate(() => ({
    handleStatus: window.__deliveryCensusHandle?.status || null,
    result: window.__deliveryCensusCompletion || null,
    diagnostics: window.__fw.scene3d.clubhouse().deliveryEquipmentDiagnostics(),
  }));
  await lifecycleSnapshot('after-delivery-completion', true);

  const sampleByName = Object.fromEntries(result.samples.map((entry) => [entry.meta.name, entry]));
  const samplesByVariant = Object.fromEntries(variants.map((variant) => [
    variant,
    result.samples.filter((sample) => sampleVariant(sample) === variant),
  ]));
  const variantCheck = (variant, predicate) => (
    !variants.includes(variant)
    || (samplesByVariant[variant]?.length > 0 && samplesByVariant[variant].every(predicate))
  );
  const visibleActiveLights = (sample) => sample?.stateStart?.pointLights
    ?.filter((entry) => entry.visible && entry.intensity > 0).length ?? null;
  const cameraStable = result.samples.every((sample) => {
    const camera = sample.stateStart.camera;
    return Math.abs(camera.x - fixedState.walk.x) <= 1e-6
      && Math.abs(camera.z - fixedState.walk.z) <= 1e-6
      && Math.abs(camera.yaw - fixedState.walk.yaw) <= 1e-6
      && Math.abs(camera.pitch - fixedState.walk.pitch) <= 1e-6;
  });
  result.checks = {
    exactViewport: result.environment.viewport.width === 1600
      && result.environment.viewport.height === 900
      && Math.abs(result.environment.devicePixelRatio - 1) < 1e-3
      && Math.abs(result.environment.rendererPixelRatio - 1) < 1e-3,
    fixedClock: fixedState.clockMinutes % 1440 === 14 * 60,
    fixedCameraStable: cameraStable,
    realNineCartonLoad: stagedDelivery.createdBoxes.length === fixture.boxCount,
    allRequestedVariantsMeasured: variants.every((name) => (
      samplesByVariant[name]?.length >= (interleaved ? (name === 'baseline' ? rounds + 1 : rounds) : 1)
    )),
    baselineRepeated: interleaved
      ? samplesByVariant.baseline?.length === rounds + 1
      : !!sampleByName['baseline-repeat'],
    interleavedOrderComplete: !interleaved || (
      result.samples.length === interleavedPlan.length
      && result.samples.every((sample, index) => sample.meta.name === interleavedPlan[index].name)
    ),
    normalizedComparisonsComplete: result.comparisons.every((comparison) => (
      comparison.baselineReference.length === (comparisonMode === 'bracket-normalized' ? 2 : 1)
      && comparison.baselineReference.every((entry) => (
        Number.isFinite(entry.sequenceIndex) && Number.isFinite(entry.weight)
      ))
    )),
    screenshotsCaptured: result.samples.every((sample) => (
      sample.screenshot.bytes > 0 && /^[a-f0-9]{64}$/.test(sample.screenshot.sha256)
    )),
    sourceHashesCaptured: Object.values(sourceHashes).every((entry) => (
      entry.exists && /^[a-f0-9]{64}$/.test(entry.sha256)
    )),
    rendererCountersNonzero: result.samples.every((sample) => (
      sample.renderer.calls.samples > 0
      && sample.renderer.calls.max > 0
      && sample.renderer.triangles.samples > 0
      && sample.renderer.triangles.max > 0
      && Number(sample.renderer.programs) > 0
    )),
    interiorSunCastersSuppressed: result.sceneCensus?.clubhouseInterior?.shadowCasters === 0
      && result.sceneCensus?.clubhouseInterior?.effectiveVisibleShadowCasters === 0,
    shellSunCastersPreserved: (result.sceneCensus?.clubhouseShell?.shadowCasters || 0) > 0,
    interiorRootHiddenEffective: variantCheck(
      'interior-root-hidden',
      (sample) => sample.stateStart?.interiorVisible === false,
    ),
    gtaoInteriorMaskEffective: variantCheck(
      'interior-gtao-excluded',
      (sample) => sample.stateStart?.gtaoExclusionActive === true
        && sample.stateStart?.interiorVisible === true,
    ),
    allInteriorPointLightsRemoved: variantCheck(
      'interior-point-lights-off',
      (sample) => visibleActiveLights(sample) === 0,
    ),
    essentialLightSubsetApplied: variantCheck(
      'essential-interior-lights-only',
      (sample) => visibleActiveLights(sample) === result.essentialLights.count,
    ),
    shadowsOffEffective: variantCheck(
      'shadows-off',
      (sample) => sample.stateStart?.shadowMapEnabled === false
        && sample.stateStart?.sunCastShadow === false,
    ),
    productionGtaoMaskDisabledEffective: variantCheck(
      'production-gtao-mask-disabled',
      (sample) => sample.stateStart?.productionGtaoMaskDisabled === true
        && sample.stateStart?.gtaoRenderRestored === false
        && sample.stateStart?.interiorVisible === true,
    ),
    everyVariantRestored: result.restoration
      .filter((entry) => entry.name.startsWith('sample:'))
      .every((entry) => entry.matchesBaseline),
    finalRuntimeRestored: cleanup.matchesBaseline && cleanup.clubhouseUpdateRestored,
    deliveryCompletedAfterRelease: result.fixture.completion.handleStatus === 'completed'
      || result.fixture.completion.result?.ok === true,
    noPageErrors: result.diagnostics.pageErrors.length === 0,
    noConsoleErrors: result.diagnostics.consoleErrors.length === 0,
  };
  result.ok = Object.values(result.checks).every(Boolean);
  result.completedAt = new Date().toISOString();
  result.elapsedMs = Date.now() - startedAt;
  return result;
}
