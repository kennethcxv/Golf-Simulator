async (page) => {
  const base = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const out = process.env.QA_OUTPUT_DIR || 'qa/steam-release-polish/baseline/performance';

  await page.addInitScript(() => {
    const state = window.__steamReleasePerf = {
      listeners: { added: 0, removed: 0, byType: {} },
      canvas2d: { fillText: 0, fillRect: 0, getImageData: 0, bySize: {} },
    };
    const add = EventTarget.prototype.addEventListener;
    const remove = EventTarget.prototype.removeEventListener;
    EventTarget.prototype.addEventListener = function wrappedAdd(type, listener, options) {
      state.listeners.added++;
      state.listeners.byType[type] = (state.listeners.byType[type] || 0) + 1;
      return add.call(this, type, listener, options);
    };
    EventTarget.prototype.removeEventListener = function wrappedRemove(type, listener, options) {
      state.listeners.removed++;
      state.listeners.byType[type] = (state.listeners.byType[type] || 0) - 1;
      return remove.call(this, type, listener, options);
    };
    for (const name of ['fillText', 'fillRect', 'getImageData']) {
      const original = CanvasRenderingContext2D.prototype[name];
      CanvasRenderingContext2D.prototype[name] = function wrappedCanvasMethod(...args) {
        state.canvas2d[name]++;
        const key = `${this.canvas.width}x${this.canvas.height}`;
        const bucket = state.canvas2d.bySize[key] ||= { fillText: 0, fillRect: 0, getImageData: 0 };
        bucket[name]++;
        return original.apply(this, args);
      };
    }
  });

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(base);
  await page.waitForTimeout(1200);
  await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 40_000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
  }, null, { timeout: 40_000 });
  await page.waitForTimeout(2500);

  await page.evaluate(() => {
    const app = window.__fw;
    app.speedIdx = 0;
    const minute = 14 * 60;
    app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440 + minute;
    app.scene3d.applyTimeWeather(minute, app.state.weather);
    for (const id of Object.keys(app.state.shop.inventory)) {
      const inv = app.state.shop.inventory[id];
      if (['rug1', 'plant1', 'poster1', 'board1', 'light1', 'lounge1', 'vac1'].includes(id)) {
        inv.back = 0;
        inv.shelf = 0;
      } else {
        inv.shelf = Math.max(inv.shelf, 10);
        inv.back = 0;
      }
    }
    app.scene3d.clubhouse().rebuildStock();
    const walk = app.scene3d.walk.state;
    walk.x = 2.80 - 8;
    walk.z = 5.10 + 228;
    walk.yaw = 0;
    walk.pitch = -0.18;
  });
  await page.waitForTimeout(800);

  const waitForRendererStability = async (label, timeoutMs = 15_000) => {
    const started = Date.now();
    let previous = null;
    let stableSamples = 0;
    const samples = [];
    while (Date.now() - started < timeoutMs) {
      const sample = await page.evaluate(() => ({
        geometries: window.__fw.scene3d.renderer.info.memory.geometries,
        textures: window.__fw.scene3d.renderer.info.memory.textures,
      }));
      samples.push(sample);
      if (previous && sample.geometries === previous.geometries && sample.textures === previous.textures) {
        stableSamples++;
        if (stableSamples >= 4) return { label, stable: true, waitedMs: Date.now() - started, samples };
      } else {
        stableSamples = 0;
      }
      previous = sample;
      await page.waitForTimeout(500);
    }
    return { label, stable: false, waitedMs: Date.now() - started, samples };
  };

  const idleStability = await waitForRendererStability('idle');
  await page.screenshot({ path: `${out}/01-idle-fixed-camera.png` });

  await page.evaluate(() => {
    const renderer = window.__fw.scene3d.renderer;
    if (window.__steamReleaseRenderProbe) return;
    const probe = window.__steamReleaseRenderProbe = {
      lastCalls: 0,
      lastTriangles: 0,
      currentCalls: 0,
      currentTriangles: 0,
      inGameFrame: false,
      frames: [],
    };
    const render = renderer.render;
    const reset = renderer.info.reset.bind(renderer.info);
    renderer.info.reset = function measuredReset(...args) {
      probe.lastCalls = 0;
      probe.lastTriangles = 0;
      return reset(...args);
    };
    renderer.render = function measuredRender(...args) {
      const result = render.apply(this, args);
      const calls = renderer.info.render.calls || 0;
      const triangles = renderer.info.render.triangles || 0;
      if (probe.inGameFrame) {
        probe.currentCalls += calls >= probe.lastCalls ? calls - probe.lastCalls : calls;
        probe.currentTriangles += triangles >= probe.lastTriangles ? triangles - probe.lastTriangles : triangles;
      }
      probe.lastCalls = calls;
      probe.lastTriangles = triangles;
      return result;
    };
    const gameRender = window.__fw.scene3d.render;
    window.__fw.scene3d.render = function measuredGameFrame(...args) {
      probe.currentCalls = 0;
      probe.currentTriangles = 0;
      probe.inGameFrame = true;
      const at = performance.now();
      try {
        return gameRender.apply(this, args);
      } finally {
        const ended = performance.now();
        probe.inGameFrame = false;
        probe.frames.push({
          at,
          cpuRenderMs: ended - at,
          calls: probe.currentCalls,
          triangles: probe.currentTriangles,
        });
        if (probe.frames.length > 20_000) probe.frames.splice(0, 10_000);
      }
    };
  });

  const sample = (label, durationMs) => page.evaluate(async ({ label, durationMs }) => {
    const app = window.__fw;
    const renderer = app.scene3d.renderer;
    const scene = app.scene3d.scene;
    const geometries = new Set();
    const materials = new Set();
    const textures = new Set();
    const images = new Set();
    let nodes = 0;
    let meshes = 0;
    let shadowCasters = 0;
    scene.traverse((node) => {
      nodes++;
      if (!node.isMesh) return;
      meshes++;
      if (node.castShadow) shadowCasters++;
      if (node.geometry) geometries.add(node.geometry);
      const list = Array.isArray(node.material) ? node.material : [node.material];
      for (const material of list) {
        if (!material) continue;
        materials.add(material);
        for (const value of Object.values(material)) {
          if (value?.isTexture) {
            textures.add(value);
            const image = value.image || value.source?.data;
            if (image) images.add(image);
          }
        }
      }
    });
    let estimatedTextureBytes = 0;
    let estimatedUniqueImageBytes = 0;
    const imageDetails = [];
    let texturesWithoutDimensions = 0;
    for (const texture of textures) {
      const image = texture.image || texture.source?.data;
      const width = Number(image?.videoWidth || image?.naturalWidth || image?.width || 0);
      const height = Number(image?.videoHeight || image?.naturalHeight || image?.height || 0);
      if (width > 0 && height > 0) estimatedTextureBytes += width * height * 4 * (texture.generateMipmaps === false ? 1 : 4 / 3);
      else texturesWithoutDimensions++;
    }
    for (const image of images) {
      const width = Number(image?.videoWidth || image?.naturalWidth || image?.width || 0);
      const height = Number(image?.videoHeight || image?.naturalHeight || image?.height || 0);
      if (width > 0 && height > 0) {
        const estimatedBytes = width * height * 4 * 4 / 3;
        estimatedUniqueImageBytes += estimatedBytes;
        const source = String(image.currentSrc || image.src || image.id || `${image.constructor?.name || 'image'}:${width}x${height}`);
        imageDetails.push({ source: source.slice(-180), width, height, estimatedBytes });
      }
    }
    const listenerBefore = structuredClone(window.__steamReleasePerf.listeners);
    const canvasBefore = structuredClone(window.__steamReleasePerf.canvas2d);
    const renderProbe = window.__steamReleaseRenderProbe;
    const startIndex = renderProbe.frames.length;
    const started = performance.now();
    await new Promise((resolve) => setTimeout(resolve, durationMs));
    const elapsedMs = performance.now() - started;
    const recorded = renderProbe.frames.slice(Math.max(0, startIndex - 1));
    const frames = [];
    for (let i = 1; i < recorded.length; i++) frames.push(recorded[i].at - recorded[i - 1].at);
    const calls = recorded.slice(1).map((frame) => frame.calls);
    const triangles = recorded.slice(1).map((frame) => frame.triangles);
    const cpuRenderTimes = recorded.slice(1).map((frame) => frame.cpuRenderMs);
    const sorted = [...frames].sort((a, b) => a - b);
    const mean = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
    const p99Frame = sorted[Math.max(0, Math.ceil(sorted.length * 0.99) - 1)] || 0;
    const listenerAfter = structuredClone(window.__steamReleasePerf.listeners);
    const canvasAfter = structuredClone(window.__steamReleasePerf.canvas2d);
    const bySizeDelta = {};
    for (const [size, after] of Object.entries(canvasAfter.bySize)) {
      const before = canvasBefore.bySize[size] || {};
      bySizeDelta[size] = Object.fromEntries(
        Object.entries(after).map(([key, value]) => [key, value - (before[key] || 0)]),
      );
    }
    return {
      label,
      durationMs: elapsedMs,
      frameSamples: frames.length,
      averageFps: frames.length && mean(frames) > 0 ? 1000 / mean(frames) : 0,
      onePercentLowFps: p99Frame > 0 ? 1000 / p99Frame : 0,
      worstFrameMs: sorted.at(-1) || 0,
      p95FrameMs: sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] || 0,
      p99FrameMs: p99Frame,
      longFramesOver50Ms: frames.filter((value) => value > 50).length,
      averageDrawCalls: mean(calls),
      peakDrawCalls: Math.max(0, ...calls),
      averageTriangles: mean(triangles),
      peakTriangles: Math.max(0, ...triangles),
      averageCpuRenderMs: mean(cpuRenderTimes),
      worstCpuRenderMs: Math.max(0, ...cpuRenderTimes),
      scene: {
        nodes,
        meshes,
        geometries: geometries.size,
        materials: materials.size,
        textures: textures.size,
        shadowCasters,
        estimatedTextureBytes,
        uniqueImages: images.size,
        estimatedUniqueImageBytes,
        largestImages: imageDetails.sort((a, b) => b.estimatedBytes - a.estimatedBytes).slice(0, 12),
        texturesWithoutDimensions,
        rendererMemory: { ...renderer.info.memory },
      },
      jsHeap: performance.memory ? {
        usedBytes: performance.memory.usedJSHeapSize,
        totalBytes: performance.memory.totalJSHeapSize,
        limitBytes: performance.memory.jsHeapSizeLimit,
      } : null,
      listeners: {
        before: listenerBefore,
        after: listenerAfter,
        netGrowth: (listenerAfter.added - listenerAfter.removed) - (listenerBefore.added - listenerBefore.removed),
      },
      canvas2d: {
        fillTextCalls: canvasAfter.fillText - canvasBefore.fillText,
        fillRectCalls: canvasAfter.fillRect - canvasBefore.fillRect,
        getImageDataCalls: canvasAfter.getImageData - canvasBefore.getImageData,
        bySize: bySizeDelta,
      },
    };
  }, { label, durationMs });

  const idle = await sample('idle-fixed-camera', 5000);
  const characterInstances = Number(process.env.QA_CHARACTER_INSTANCES || 0);
  let crowd = null;
  let crowdStability = null;
  if (characterInstances > 0) {
    await page.evaluate((target) => {
      const app = window.__fw;
      const clubhouse = app.scene3d.clubhouse();
      const origin = clubhouse.interior.position;
      while (clubhouse.customers.length < target) clubhouse.debugSpawn(false);
      for (let i = 0; i < clubhouse.customers.length; i++) {
        const customer = clubhouse.customers[i];
        const x = origin.x - 3.4 + (i % 4) * 1.75;
        const z = origin.z - 2.5 + Math.floor(i / 4) * 1.45;
        customer.mesh.position.set(x, customer.mesh.position.y, z);
        customer.cart.length = 0;
        customer.linger = 1e9;
        customer.stops = [{ kind: 'fixture', x, z, faceX: origin.x + 2.8, faceZ: origin.z + 4.0 }];
        customer.stopIdx = 0;
        customer.speed = 0;
      }
    }, characterInstances);
    await page.waitForTimeout(1200);
    crowdStability = await waitForRendererStability('character-crowd');
    await page.screenshot({ path: `${out}/01b-character-crowd-fixed-camera.png` });
    crowd = await sample(`${characterInstances}-character-crowd`, 8000);
  }
  const customer = await page.evaluate(() => {
    const clubhouse = window.__fw.scene3d.clubhouse();
    const name = clubhouse.sendToCounter(['balls3', 'glove1'], 'card');
    // A 100-cycle soak intentionally takes longer than normal checkout patience.
    // Keep this fixture at the till so failures measure register re-entry, not a
    // shopper correctly abandoning an hour-long transaction.
    const fixture = clubhouse.customers.at(-1);
    if (fixture) fixture.patience = 3600;
    return name;
  });
  await page.waitForFunction(() => window.__fw.scene3d.clubhouse().register.hasTx());
  await page.keyboard.press('e');
  await page.waitForFunction(() => window.__fw.scene3d.clubhouse().register.isActive());
  // Upload the camera-mounted checkout hand before the active baseline. Without
  // one normal action, its first render during later stress can masquerade as
  // transition-driven renderer growth.
  await page.keyboard.press('t');
  await page.waitForTimeout(800);
  const activeStability = await waitForRendererStability('register-active');
  await page.screenshot({ path: `${out}/02-register-active-fixed-camera.png` });
  const active = await sample('register-active', 8000);

  const stressBefore = await page.evaluate(() => ({
    listeners: structuredClone(window.__steamReleasePerf.listeners),
    heap: performance.memory?.usedJSHeapSize || null,
  }));
  let normalReentryFailures = 0;
  const transitionCycles = Number(process.env.QA_TRANSITION_CYCLES || 25);
  const transitionSettleMs = Number(process.env.QA_TRANSITION_SETTLE_MS || 600);
  for (let i = 0; i < transitionCycles; i++) {
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !window.__fw.scene3d.clubhouse().register.isActive());
    await page.waitForTimeout(transitionSettleMs);
    await page.keyboard.press('e');
    try {
      await page.waitForFunction(
        () => window.__fw.scene3d.clubhouse().register.isActive(),
        null,
        { timeout: 2000 },
      );
    } catch (_) {
      normalReentryFailures++;
      await page.evaluate(() => window.__fw.scene3d.clubhouse().register.enter());
      await page.waitForFunction(() => window.__fw.scene3d.clubhouse().register.isActive());
    }
  }
  const stressAfter = await page.evaluate(() => ({
    listeners: structuredClone(window.__steamReleasePerf.listeners),
    heap: performance.memory?.usedJSHeapSize || null,
  }));
  const postStressStability = await waitForRendererStability('post-stress');
  const postStress = await sample(`register-post-${transitionCycles}-transitions`, 5000);

  return {
    configuration: {
      browser: 'Google Chrome via Playwright',
      viewport: '1600x900',
      deviceScaleFactor: 1,
      quality: 'runtime default',
      fixedTime: '14:00',
      fixture: 'relaxed seed 424242, two-item card customer, fully stocked sale inventory',
      warmupMs: 3300,
      characterInstances,
      rendererStability: {
        idle: idleStability,
        crowd: crowdStability,
        active: activeStability,
        postStress: postStressStability,
      },
    },
    customer,
    idle,
    crowd,
    crowdStability,
    active,
    stress: {
      cycles: transitionCycles,
      normalReentryFailures,
      before: stressBefore,
      after: stressAfter,
      listenerNetGrowth: (stressAfter.listeners.added - stressAfter.listeners.removed)
        - (stressBefore.listeners.added - stressBefore.listeners.removed),
      heapGrowthBytes: stressBefore.heap == null || stressAfter.heap == null ? null : stressAfter.heap - stressBefore.heap,
    },
    postStress,
  };
}
