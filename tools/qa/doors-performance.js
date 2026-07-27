async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repoRoot = process.env.QA_REPO_ROOT || process.cwd();
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const out = path.join(repoRoot, 'qa', 'doors', 'performance');
  fs.mkdirSync(out, { recursive: true });

  const baselinePath = path.join(repoRoot, 'qa', 'doors', 'baseline', 'performance.json');
  const baseline = fs.existsSync(baselinePath)
    ? JSON.parse(fs.readFileSync(baselinePath, 'utf8'))
    : null;

  await page.addInitScript(() => {
    const originalAdd = EventTarget.prototype.addEventListener;
    const originalRemove = EventTarget.prototype.removeEventListener;
    const registrations = new WeakMap();
    const summary = { active: 0, added: 0, removed: 0, byType: Object.create(null) };
    EventTarget.prototype.addEventListener = function trackedAdd(type, listener, options) {
      if (listener) {
        let target = registrations.get(this);
        if (!target) {
          target = new Map();
          registrations.set(this, target);
        }
        let listeners = target.get(type);
        if (!listeners) {
          listeners = new Set();
          target.set(type, listeners);
        }
        if (!listeners.has(listener)) {
          listeners.add(listener);
          summary.active += 1;
          summary.added += 1;
          summary.byType[type] = (summary.byType[type] || 0) + 1;
        }
      }
      return originalAdd.call(this, type, listener, options);
    };
    EventTarget.prototype.removeEventListener = function trackedRemove(type, listener, options) {
      const listeners = registrations.get(this)?.get(type);
      if (listener && listeners?.delete(listener)) {
        summary.active -= 1;
        summary.removed += 1;
        summary.byType[type] = Math.max(0, (summary.byType[type] || 0) - 1);
      }
      return originalRemove.call(this, type, listener, options);
    };
    window.__doorsQaListeners = summary;
    window.__doorsQaUi = { callbacks: 0, records: 0 };
    addEventListener('DOMContentLoaded', () => {
      const observer = new MutationObserver((records) => {
        window.__doorsQaUi.callbacks += 1;
        window.__doorsQaUi.records += records.length;
      });
      observer.observe(document.documentElement, {
        attributes: true, childList: true, characterData: true, subtree: true,
      });
      window.__doorsQaObserver = observer;
    }, { once: true });
  });

  const browserDiagnostics = [];
  const browserNotices = [];
  page.on('console', (message) => {
    if (message.type() === 'warning' || message.type() === 'error') {
      const entry = `console:${message.type()}: ${message.text()}`;
      if (message.type() === 'warning'
          && message.text().includes('PCFSoftShadowMap has been deprecated')) {
        browserNotices.push(entry);
      } else {
        browserDiagnostics.push(entry);
      }
    }
  });
  page.on('pageerror', (error) => browserDiagnostics.push(`pageerror: ${error.message}`));
  page.on('requestfailed', (request) => {
    const errorText = request.failure()?.errorText || 'unknown';
    const message = `requestfailed: ${request.url()} (${errorText})`;
    if (errorText === 'net::ERR_ABORTED') browserNotices.push(message);
    else browserDiagnostics.push(message);
  });

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.getByText('Continue', { exact: true }).click().catch(() => {});
  await page.waitForFunction(() => (
    window.__fw?.scene3d?.clubhouse?.()?.architecturalDoors?.diagnostics?.().ready === true
  ), null, { timeout: 120000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
  }, null, { timeout: 60000 });
  await page.addStyleTag({
    content: '.toast-wrap, .notification-center { display: none !important; }',
  });
  await page.evaluate(() => {
    const clubhouse = window.__fw.scene3d.clubhouse();
    clubhouse.setOrganicWalkins(false);
    clubhouse.clearWalkins();
  });

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable').catch(() => {});

  async function collectGarbage() {
    await cdp.send('HeapProfiler.collectGarbage').catch(() => {});
  }

  async function browserCounters() {
    const [dom, perf] = await Promise.all([
      cdp.send('Memory.getDOMCounters').catch(() => null),
      cdp.send('Performance.getMetrics').catch(() => null),
    ]);
    const metrics = Object.fromEntries((perf?.metrics || []).map((entry) => [entry.name, entry.value]));
    return {
      documents: dom?.documents ?? null,
      domNodes: dom?.nodes ?? null,
      activeEventListeners: dom?.jsEventListeners ?? null,
      jsHeapUsedBytes: metrics.JSHeapUsedSize ?? null,
      jsHeapTotalBytes: metrics.JSHeapTotalSize ?? null,
    };
  }

  async function setPose(at, target, pitch = -0.04) {
    await page.evaluate(({ atLocal, targetLocal, lookPitch }) => {
      const scene = window.__fw.scene3d;
      const clubhouse = scene.clubhouse();
      clubhouse.group.updateWorldMatrix(true, false);
      const atWorld = clubhouse.group.localToWorld(
        clubhouse.group.position.clone().set(atLocal[0], 0, atLocal[1]),
      );
      const targetWorld = clubhouse.group.localToWorld(
        clubhouse.group.position.clone().set(targetLocal[0], 0, targetLocal[1]),
      );
      scene.walk.clearKeys();
      scene.walk.state.x = atWorld.x;
      scene.walk.state.z = atWorld.z;
      scene.walk.state.yaw = Math.atan2(-(targetWorld.x - atWorld.x), -(targetWorld.z - atWorld.z));
      scene.walk.state.pitch = lookPitch;
      const day = Math.floor(window.__fw.state.clock.minutes / 1440);
      window.__fw.state.clock.minutes = day * 1440 + 14 * 60;
      window.__fw.state.weather.today.rainIn = 0;
      scene.applyTimeWeather(14 * 60, window.__fw.state.weather);
    }, { atLocal: at, targetLocal: target, lookPitch: pitch });
    await page.waitForTimeout(650);
  }

  async function sceneResources() {
    return page.evaluate(() => {
      const scene = window.__fw.scene3d;
      const renderer = scene.renderer;
      const geometries = new Set();
      const materials = new Set();
      const textures = new Set();
      let visibleMeshes = 0;
      let visibleSceneTriangles = 0;
      scene.scene.traverseVisible((object) => {
        if (!object.isMesh) return;
        visibleMeshes += 1;
        const geometry = object.geometry;
        if (geometry) {
          geometries.add(geometry.uuid);
          const triangles = geometry.index
            ? geometry.index.count / 3
            : (geometry.attributes?.position?.count || 0) / 3;
          visibleSceneTriangles += triangles * (object.isInstancedMesh ? object.count : 1);
        }
        const list = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of list) {
          if (!material) continue;
          materials.add(material.uuid);
          for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap']) {
            if (material[key]) textures.add(material[key]);
          }
        }
      });
      let textureMemoryEstimateBytes = 0;
      for (const texture of textures) {
        const image = texture.image || texture.source?.data;
        const width = Number(image?.width || image?.videoWidth || 0);
        const height = Number(image?.height || image?.videoHeight || 0);
        if (width > 0 && height > 0) textureMemoryEstimateBytes += width * height * 4 * (4 / 3);
      }
      return {
        visibleMeshes,
        visibleGeometries: geometries.size,
        materialCount: materials.size,
        textureCount: textures.size,
        textureMemoryEstimateBytes: Math.round(textureMemoryEstimateBytes),
        visibleSceneTriangles: Math.round(visibleSceneTriangles),
        rendererGeometries: renderer.info.memory.geometries,
        rendererTextures: renderer.info.memory.textures,
        rendererPrograms: renderer.info.programs?.length ?? null,
      };
    });
  }

  async function rendererFrame() {
    return page.evaluate(() => new Promise((resolve) => {
      const info = window.__fw.scene3d.renderer.info;
      const previousAutoReset = info.autoReset;
      info.autoReset = false;
      info.reset();
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const result = {
          drawCalls: info.render.calls,
          renderedTriangles: info.render.triangles,
          renderedLines: info.render.lines,
          renderedPoints: info.render.points,
          accumulatedFrames: 2,
        };
        info.autoReset = previousAutoReset;
        resolve(result);
      }));
    }));
  }

  async function frameRun(durationMs) {
    return page.evaluate((duration) => new Promise((resolve) => {
      const deltas = [];
      let previous = performance.now();
      const started = previous;
      const tick = (now) => {
        deltas.push(now - previous);
        previous = now;
        if (now - started < duration) requestAnimationFrame(tick);
        else resolve({ durationMs: now - started, deltas: deltas.slice(5) });
      };
      requestAnimationFrame(tick);
    }), durationMs);
  }

  async function measure(label, { runs = 3, durationMs = 2200, warmupMs = 1200 } = {}) {
    await page.waitForTimeout(warmupMs);
    await collectGarbage();
    const countersBefore = await browserCounters();
    const inPageBefore = await page.evaluate(() => ({
      heap: performance.memory?.usedJSHeapSize ?? null,
      listeners: window.__doorsQaListeners.active,
      uiCallbacks: window.__doorsQaUi.callbacks,
      uiRecords: window.__doorsQaUi.records,
    }));
    const rawRuns = [];
    for (let index = 0; index < runs; index += 1) rawRuns.push(await frameRun(durationMs));
    const renderer = await rendererFrame();
    const resources = await sceneResources();
    await collectGarbage();
    const countersAfter = await browserCounters();
    const inPageAfter = await page.evaluate(() => ({
      heap: performance.memory?.usedJSHeapSize ?? null,
      listeners: window.__doorsQaListeners.active,
      uiCallbacks: window.__doorsQaUi.callbacks,
      uiRecords: window.__doorsQaUi.records,
    }));
    const deltas = rawRuns.flatMap((run) => run.deltas).filter((value) => value > 0);
    const sortedSlow = [...deltas].sort((a, b) => b - a);
    const slowCount = Math.max(1, Math.ceil(sortedSlow.length * 0.01));
    const slowMean = sortedSlow.slice(0, slowCount)
      .reduce((sum, value) => sum + value, 0) / slowCount;
    const totalDurationMs = deltas.reduce((sum, value) => sum + value, 0);
    return {
      label,
      protocol: {
        browser: await page.evaluate(() => navigator.userAgent),
        viewport: await page.evaluate(() => [innerWidth, innerHeight]),
        deviceScaleFactor: await page.evaluate(() => devicePixelRatio),
        runs,
        requestedDurationMsPerRun: durationMs,
        retainedFrameCount: deltas.length,
        warmupMs,
      },
      averageFps: deltas.length * 1000 / totalDurationMs,
      onePercentLowFps: 1000 / slowMean,
      worstFrameMs: sortedSlow[0] || null,
      rawRuns: rawRuns.map((run) => ({
        durationMs: run.durationMs,
        retainedFrameCount: run.deltas.length,
        averageFrameMs: run.deltas.reduce((sum, value) => sum + value, 0)
          / Math.max(1, run.deltas.length),
        worstFrameMs: Math.max(...run.deltas),
      })),
      renderer,
      resources,
      browserCounters: {
        before: countersBefore,
        after: countersAfter,
        listenerGrowth: countersAfter.activeEventListeners == null
          ? null : countersAfter.activeEventListeners - countersBefore.activeEventListeners,
        heapGrowthBytes: countersAfter.jsHeapUsedBytes == null
          ? null : countersAfter.jsHeapUsedBytes - countersBefore.jsHeapUsedBytes,
      },
      instrumentation: {
        listenerBefore: inPageBefore.listeners,
        listenerAfter: inPageAfter.listeners,
        listenerGrowth: inPageAfter.listeners - inPageBefore.listeners,
        heapBeforeBytes: inPageBefore.heap,
        heapAfterBytes: inPageAfter.heap,
        heapGrowthBytes: inPageBefore.heap == null || inPageAfter.heap == null
          ? null : inPageAfter.heap - inPageBefore.heap,
        uiCallbacks: inPageAfter.uiCallbacks - inPageBefore.uiCallbacks,
        uiRecords: inPageAfter.uiRecords - inPageBefore.uiRecords,
        uiCallbacksPerSecond: (inPageAfter.uiCallbacks - inPageBefore.uiCallbacks)
          / (totalDurationMs / 1000),
        uiRecordsPerSecond: (inPageAfter.uiRecords - inPageBefore.uiRecords)
          / (totalDurationMs / 1000),
      },
    };
  }

  async function mainState() {
    return page.evaluate(() => window.__fw.scene3d.clubhouse().doors
      .filter((door) => door.isMain)
      .map((door) => ({ leaf: door.mainLeaf, desiredOpen: door.desiredOpen, angle: door.angle })));
  }

  // Match the pre-change baseline: main entrance open, fixed interior camera,
  // 1600x900 DPR 1, 2.5+ seconds warm-up, clear deterministic bootstrap save.
  await setPose([-0.8, 7.7], [-0.8, 6.5], -0.04);
  await page.waitForFunction(() => /Shop doors/.test(
    window.__fw?.scene3d?.walk?.getFocusLabel?.() || '',
  ), null, { timeout: 8000 });
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(1200);
  await setPose([-0.8, 4.35], [-0.8, 6.5], -0.04);
  const normal = await measure('normal-three-authored-doors', {
    runs: 3, durationMs: 2400, warmupMs: 2500,
  });
  await page.screenshot({ path: path.join(out, '01-normal-main-open-fixed-camera.png') });

  // Repeated real E interactions expose listeners, UI churn, heap retention,
  // collider drift, and animation hot-path spikes.
  await setPose([-0.8, 8.8], [-0.8, 7.13], -0.06);
  const interactionBeforeCounters = await browserCounters();
  const interactionBeforeResources = await sceneResources();
  const interactionBeforePage = await page.evaluate(() => ({
    listeners: window.__doorsQaListeners.active,
    listenerTypes: { ...window.__doorsQaListeners.byType },
    uiCallbacks: window.__doorsQaUi.callbacks,
    uiRecords: window.__doorsQaUi.records,
  }));
  await page.evaluate(() => {
    window.__doorsInteractionFrames = { active: true, deltas: [], previous: performance.now() };
    const tick = (now) => {
      const probe = window.__doorsInteractionFrames;
      if (!probe?.active) return;
      probe.deltas.push(now - probe.previous);
      probe.previous = now;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const interactionStates = [];
  for (let cycle = 0; cycle < 12; cycle += 1) {
    await page.keyboard.press('KeyE');
    await page.waitForTimeout(720);
    interactionStates.push(await mainState());
  }
  const interactionFrames = await page.evaluate(() => {
    window.__doorsInteractionFrames.active = false;
    return window.__doorsInteractionFrames.deltas.slice(5);
  });
  await collectGarbage();
  const interactionAfterCounters = await browserCounters();
  const interactionAfterResources = await sceneResources();
  const interactionAfterPage = await page.evaluate(() => ({
    listeners: window.__doorsQaListeners.active,
    listenerTypes: { ...window.__doorsQaListeners.byType },
    uiCallbacks: window.__doorsQaUi.callbacks,
    uiRecords: window.__doorsQaUi.records,
  }));
  const interactionSorted = [...interactionFrames].sort((a, b) => b - a);
  const interactionSlowCount = Math.max(1, Math.ceil(interactionSorted.length * 0.01));
  const interactionSlowMean = interactionSorted.slice(0, interactionSlowCount)
    .reduce((sum, value) => sum + value, 0) / interactionSlowCount;
  const interaction = {
    cycles: 12,
    sampledFrames: interactionFrames.length,
    averageFps: interactionFrames.length * 1000
      / interactionFrames.reduce((sum, value) => sum + value, 0),
    onePercentLowFps: 1000 / interactionSlowMean,
    worstFrameMs: interactionSorted[0] || null,
    states: interactionStates,
    alternatingStateCount: interactionStates.filter((state, index) => (
      state.every((leaf) => leaf.desiredOpen === (index % 2 === 1))
    )).length,
    counters: {
      before: interactionBeforeCounters,
      after: interactionAfterCounters,
      listenerGrowth: interactionAfterCounters.activeEventListeners == null
        ? null
        : interactionAfterCounters.activeEventListeners
          - interactionBeforeCounters.activeEventListeners,
      heapGrowthBytes: interactionAfterCounters.jsHeapUsedBytes == null
        ? null
        : interactionAfterCounters.jsHeapUsedBytes - interactionBeforeCounters.jsHeapUsedBytes,
    },
    instrumentedListenerGrowth: interactionAfterPage.listeners - interactionBeforePage.listeners,
    listenerTypesBefore: interactionBeforePage.listenerTypes,
    listenerTypesAfter: interactionAfterPage.listenerTypes,
    uiCallbacks: interactionAfterPage.uiCallbacks - interactionBeforePage.uiCallbacks,
    uiRecords: interactionAfterPage.uiRecords - interactionBeforePage.uiRecords,
    resourcesBefore: interactionBeforeResources,
    resourcesAfter: interactionAfterResources,
  };

  const api = page.evaluate(() => window.__fw.scene3d.clubhouse().architecturalDoors.createStressSet({
    visible: false,
  }));
  await api;
  await page.waitForFunction(() => {
    const stress = window.__fw.scene3d.clubhouse().architecturalDoors.diagnostics().stress;
    return stress?.loadedCount === 53;
  }, null, { timeout: 120000 });
  await setPose([0, -17.5], [0, -27.5], -0.04);
  const stressControl = await measure('stress-camera-hidden-control', {
    runs: 2, durationMs: 2200, warmupMs: 1500,
  });

  await page.evaluate(() => {
    const doors = window.__fw.scene3d.clubhouse().architecturalDoors;
    doors.forceStressLod(null);
    doors.setStressVisible(true);
  });
  await page.waitForTimeout(1800);
  const stressNatural = await measure('exact-53-natural-lod', {
    runs: 3, durationMs: 2400, warmupMs: 1000,
  });
  await page.screenshot({ path: path.join(out, '02-exact-53-natural-lod.png') });
  const stressNaturalDiagnostics = await page.evaluate(() => (
    window.__fw.scene3d.clubhouse().architecturalDoors.diagnostics()
  ));

  await page.evaluate(() => {
    window.__fw.scene3d.clubhouse().architecturalDoors.forceStressLod(0);
  });
  await page.waitForTimeout(1200);
  const stressLod0 = await measure('exact-53-forced-lod0-worst-case', {
    runs: 2, durationMs: 2200, warmupMs: 800,
  });
  await page.screenshot({ path: path.join(out, '03-exact-53-forced-lod0.png') });
  const stressLod0Diagnostics = await page.evaluate(() => (
    window.__fw.scene3d.clubhouse().architecturalDoors.diagnostics()
  ));

  const toggleBeforeCounters = await browserCounters();
  const toggleBeforeResources = await sceneResources();
  for (let cycle = 0; cycle < 10; cycle += 1) {
    await page.evaluate((visible) => {
      window.__fw.scene3d.clubhouse().architecturalDoors.setStressVisible(visible);
    }, cycle % 2 === 1);
    await page.waitForTimeout(80);
  }
  await collectGarbage();
  const toggleAfterCounters = await browserCounters();
  const toggleAfterResources = await sceneResources();
  const toggleStability = {
    cycles: 10,
    before: { counters: toggleBeforeCounters, resources: toggleBeforeResources },
    after: { counters: toggleAfterCounters, resources: toggleAfterResources },
    listenerGrowth: toggleAfterCounters.activeEventListeners == null
      ? null : toggleAfterCounters.activeEventListeners - toggleBeforeCounters.activeEventListeners,
    stableVisibleResources: ['visibleMeshes', 'visibleGeometries', 'materialCount', 'textureCount',
      'textureMemoryEstimateBytes', 'visibleSceneTriangles', 'rendererGeometries', 'rendererTextures']
      .every((key) => toggleBeforeResources[key] === toggleAfterResources[key]),
  };

  await page.evaluate(() => {
    const doors = window.__fw.scene3d.clubhouse().architecturalDoors;
    doors.setStressVisible(false);
    doors.forceStressLod(null);
  });
  await setPose([-0.8, 4.35], [-0.8, 6.5], -0.04);
  const recovery = await measure('post-stress-hidden-recovery', {
    runs: 2, durationMs: 2200, warmupMs: 1500,
  });

  const percentDelta = (after, before) => (
    Number.isFinite(after) && Number.isFinite(before) && before !== 0
      ? ((after - before) / before) * 100
      : null
  );
  const baselineDelta = baseline ? {
    averageFps: {
      before: baseline.averageFps,
      after: normal.averageFps,
      delta: normal.averageFps - baseline.averageFps,
      percent: percentDelta(normal.averageFps, baseline.averageFps),
    },
    onePercentLowFps: {
      before: baseline.onePercentLowFps,
      after: normal.onePercentLowFps,
      delta: normal.onePercentLowFps - baseline.onePercentLowFps,
      percent: percentDelta(normal.onePercentLowFps, baseline.onePercentLowFps),
    },
    worstFrameMs: {
      before: baseline.worstFrameMs,
      after: normal.worstFrameMs,
      delta: normal.worstFrameMs - baseline.worstFrameMs,
      percent: percentDelta(normal.worstFrameMs, baseline.worstFrameMs),
    },
    drawCalls: {
      before: baseline.drawCalls,
      after: normal.renderer.drawCalls,
      delta: normal.renderer.drawCalls - baseline.drawCalls,
      percent: percentDelta(normal.renderer.drawCalls, baseline.drawCalls),
    },
    renderedTriangles: {
      before: baseline.renderedTriangles,
      after: normal.renderer.renderedTriangles,
      delta: normal.renderer.renderedTriangles - baseline.renderedTriangles,
      percent: percentDelta(normal.renderer.renderedTriangles, baseline.renderedTriangles),
    },
    materialCount: {
      before: baseline.materialCount,
      after: normal.resources.materialCount,
      delta: normal.resources.materialCount - baseline.materialCount,
      percent: percentDelta(normal.resources.materialCount, baseline.materialCount),
    },
    textureMemoryEstimateBytes: {
      before: baseline.textureMemoryEstimateBytes,
      after: normal.resources.textureMemoryEstimateBytes,
      delta: normal.resources.textureMemoryEstimateBytes - baseline.textureMemoryEstimateBytes,
      percent: percentDelta(normal.resources.textureMemoryEstimateBytes,
        baseline.textureMemoryEstimateBytes),
    },
  } : null;

  const stressCounts = stressNaturalDiagnostics.stress;
  const naturalLodTotal = Object.values(stressCounts?.lods || {})
    .reduce((sum, count) => sum + count, 0);
  const expectedTiers = { basic: 15, standard: 15, premium: 10, 'high-end': 8, luxury: 5 };
  const stressDelta = {
    drawCalls: stressNatural.renderer.drawCalls - stressControl.renderer.drawCalls,
    renderedTriangles: stressNatural.renderer.renderedTriangles
      - stressControl.renderer.renderedTriangles,
    visibleSceneTriangles: stressNatural.resources.visibleSceneTriangles
      - stressControl.resources.visibleSceneTriangles,
    materials: stressNatural.resources.materialCount - stressControl.resources.materialCount,
    textureMemoryEstimateBytes: stressNatural.resources.textureMemoryEstimateBytes
      - stressControl.resources.textureMemoryEstimateBytes,
  };
  const gates = {
    baselineAvailableAndMatched: Boolean(baseline)
      && JSON.stringify(baseline.protocol.viewport) === JSON.stringify(normal.protocol.viewport)
      && baseline.protocol.deviceScaleFactor === normal.protocol.deviceScaleFactor,
    normalAverageFpsWithin15Percent: !baseline
      || normal.averageFps >= baseline.averageFps * 0.85,
    normalOnePercentLowWithin25Percent: !baseline
      || normal.onePercentLowFps >= baseline.onePercentLowFps * 0.75,
    normalDrawCallBudget: !baseline
      || normal.renderer.drawCalls <= baseline.drawCalls + 180,
    normalRenderedTriangleBudget: !baseline
      || normal.renderer.renderedTriangles <= baseline.renderedTriangles + 350000,
    normalTextureMemoryBudget: !baseline
      || normal.resources.textureMemoryEstimateBytes
        <= baseline.textureMemoryEstimateBytes + 64 * 1024 * 1024,
    normalNoListenerGrowth: normal.instrumentation.listenerGrowth <= 1
      && (normal.browserCounters.listenerGrowth == null
        || normal.browserCounters.listenerGrowth <= 1),
    interactionAlternatedAllCycles: interaction.alternatingStateCount === interaction.cycles,
    interactionNoListenerGrowth: interaction.instrumentedListenerGrowth <= 1
      && (interaction.counters.listenerGrowth == null || interaction.counters.listenerGrowth === 0),
    interactionNoResourceGrowth: ['visibleMeshes', 'visibleGeometries', 'materialCount',
      'textureCount', 'rendererGeometries', 'rendererTextures']
      .every((key) => interaction.resourcesBefore[key] === interaction.resourcesAfter[key]),
    exactStressCount: stressCounts?.requestedCount === 53 && stressCounts?.loadedCount === 53,
    exactStressTierMix: JSON.stringify(stressCounts?.tiers) === JSON.stringify(expectedTiers),
    allStressInstancesAssignedLod: naturalLodTotal === 53,
    naturalStressFrameBudget: stressNatural.averageFps >= 30
      && stressNatural.onePercentLowFps >= 10,
    naturalStressRendererBudget: stressDelta.drawCalls <= 1200
      && stressDelta.renderedTriangles <= 3000000,
    forcedLod0FrameBudget: stressLod0.averageFps >= 24,
    forcedLod0AppliedToAll: stressLod0Diagnostics.stress?.lods?.[0] === 53,
    toggleNoListenerGrowth: toggleStability.listenerGrowth == null
      || toggleStability.listenerGrowth === 0,
    toggleNoResourceGrowth: toggleStability.stableVisibleResources,
    recoveryFrameRate: baseline
      ? recovery.averageFps >= baseline.averageFps * 0.85
      : recovery.averageFps >= normal.averageFps * 0.75,
    recoveryDrawCalls: recovery.renderer.drawCalls <= normal.renderer.drawCalls + 4,
    noBrowserErrors: browserDiagnostics.length === 0,
  };

  const report = {
    ok: Object.values(gates).every(Boolean),
    methodology: {
      normal: 'Same bootstrap save, Chrome channel, 1600x900 DPR 1, 14:00 dry weather, open Luxury main entrance, fixed interior camera and renderer two-frame accumulation as the retained pre-change baseline.',
      sampling: 'Three 2.4-second rAF samples for normal and natural stress; two 2.2-second samples for controls, forced LOD0 and recovery; five startup frames removed from every raw run.',
      stress: 'Exact authored set of 15 Basic, 15 Standard, 10 Premium, 8 High-End and 5 Luxury doors. Hidden-camera control and visible set share one camera; natural LOD and forced LOD0 are both retained.',
      heapAndListeners: 'Chrome Performance/DOM counters plus an add/removeEventListener registry, forced GC at comparison boundaries, and document-wide MutationObserver UI frequency. Interaction accepts one non-scaling transient click target only when Chrome reports zero active-listener growth.',
      textureMemory: 'Reachable visible material textures estimated as RGBA8 bytes plus a 4/3 mip-chain factor, matching the baseline method.',
      proposedTolerance: 'Normal scene: no more than 15% average-FPS and 25% 1%-low regression, +180 accumulated draw calls, +350k accumulated rendered triangles, or +64 MiB texture estimate. Exact 53-door natural stress: >=30 average FPS, >=10 1%-low, <=1200 incremental accumulated calls and <=3M incremental triangles; forced LOD0 >=24 FPS; post-stress recovery remains within 15% of the retained baseline with renderer counts restored.',
    },
    baselinePath: path.relative(repoRoot, baselinePath).replaceAll('\\', '/'),
    baseline,
    normal,
    interaction,
    stressControl,
    stressNatural,
    stressLod0,
    stressNaturalDiagnostics,
    stressLod0Diagnostics,
    stressDelta,
    toggleStability,
    recovery,
    baselineDelta,
    gates,
    browserDiagnostics,
    browserNotices,
    units: {
      frameRate: 'frames/second from requestAnimationFrame deltas',
      worstFrame: 'milliseconds',
      renderer: 'two accumulated rendered frames for draw calls and triangles',
      memory: 'bytes',
      ui: 'document MutationObserver callbacks and records',
    },
  };
  fs.writeFileSync(path.join(out, 'result.json'), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}
