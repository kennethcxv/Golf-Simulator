async (page) => {
  // Matched checkout performance capture. Run with:
  //   node tools/qa/run-playwright.cjs tools/qa/register-performance.js --bootstrap
  //
  // This intentionally changes no production code. Instrumentation is installed only
  // in this isolated browser page and is discarded when the runner closes its context.
  const fs = await import('node:fs/promises');
  const OUT = process.getBuiltinModule('node:path').join(
    process.env.QA_REPO_ROOT || process.cwd(), 'qa', 'cash-register-production', 'performance',
  );
  const SAMPLE_COUNT = 5;
  const SAMPLE_MS = 4000;
  const WARMUP_MS = 2000;
  const GC_SETTLE_MS = 750;
  const STAGE_SAMPLE_COUNT = 5;
  const STAGE_SAMPLE_MS = 500;
  const STAGE_WARMUP_MS = 250;
  const TRANSACTION_LEAK_COUNT = 10;
  const INTERACTION_CYCLES = 10;
  const REPRESENTATIVE_CARD_ITEMS = Object.freeze(['balls3', 'glove1', 'tees1']);
  const REPRESENTATIVE_CASH_ITEMS = Object.freeze(['tees1', 'marker1', 'glove1']);
  const REPRESENTATIVE_STAGE_REQUIREMENTS = {
    card: ['cardSwipe', 'receipt', 'bagging'],
    cash: ['drawerChange'],
  };
  const REQUIRED_REPRESENTATIVE_STAGES = [
    ...REPRESENTATIVE_STAGE_REQUIREMENTS.card,
    ...REPRESENTATIVE_STAGE_REQUIREMENTS.cash,
  ];
  const errors = [];
  const runtimeErrors = [];
  const routeErrors = [];
  const nonBenignRequestFailures = [];
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const detail = `console: ${message.text()}`;
    runtimeErrors.push(detail);
    errors.push(detail);
  });
  page.on('pageerror', (error) => {
    const detail = `pageerror: ${error.message}`;
    runtimeErrors.push(detail);
    errors.push(detail);
  });
  page.on('requestfailed', (request) => {
    const failure = request.failure();
    if (!failure || failure.errorText === 'net::ERR_ABORTED') return;
    const detail = `requestfailed: ${request.url()} (${failure.errorText})`;
    nonBenignRequestFailures.push(detail);
    errors.push(detail);
  });

  await fs.mkdir(OUT, { recursive: true });
  await fs.mkdir(`${OUT}/runs`, { recursive: true });
  // Preserve the previous raw capture before replacing the convenient latest files.
  // This keeps intermittent frame spikes auditable instead of letting a rerun erase them.
  let priorResult = null;
  let priorRunId = null;
  try {
    const priorRaw = await fs.readFile(`${OUT}/register-performance.json`, 'utf8');
    const prior = JSON.parse(priorRaw);
    const priorId = String(prior.generatedAt || 'prior-run').replace(/[:.]/g, '-');
    priorResult = prior;
    priorRunId = priorId;
    await fs.writeFile(`${OUT}/runs/${priorId}.json`, priorRaw, 'utf8');
    const priorReport = await fs.readFile(`${OUT}/README.md`, 'utf8');
    await fs.writeFile(`${OUT}/runs/${priorId}.md`, priorReport, 'utf8');
  } catch (_) {
    // First run, or an interrupted prior run with no parseable result.
  }

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');

  const round = (value, places = 2) => value == null || !Number.isFinite(value)
    ? null
    : Number(value.toFixed(places));

  function summarizeFrames(frameTimes) {
    if (!frameTimes.length) return {
      frameCount: 0,
      durationMs: 0,
      avgFps: null,
      onePercentLowFps: null,
      avgFrameMs: null,
      p50FrameMs: null,
      p95FrameMs: null,
      p99FrameMs: null,
      worstFrameMs: null,
      framesOver33Ms: 0,
      framesOver50Ms: 0,
      framesOver100Ms: 0,
    };
    const sortedSlow = [...frameTimes].sort((a, b) => b - a);
    const slowCount = Math.max(1, Math.ceil(sortedSlow.length * 0.01));
    const slowMean = sortedSlow.slice(0, slowCount).reduce((sum, n) => sum + n, 0) / slowCount;
    const sortedFast = [...frameTimes].sort((a, b) => a - b);
    const percentile = (p) => sortedFast[Math.min(sortedFast.length - 1, Math.floor(sortedFast.length * p))];
    const durationMs = frameTimes.reduce((sum, n) => sum + n, 0);
    return {
      frameCount: frameTimes.length,
      durationMs: round(durationMs, 1),
      avgFps: round(frameTimes.length * 1000 / durationMs),
      onePercentLowFps: round(1000 / slowMean),
      avgFrameMs: round(durationMs / frameTimes.length, 3),
      p50FrameMs: round(percentile(0.50), 3),
      p95FrameMs: round(percentile(0.95), 3),
      p99FrameMs: round(percentile(0.99), 3),
      worstFrameMs: round(sortedSlow[0], 3),
      framesOver33Ms: frameTimes.filter((n) => n > 33.333).length,
      framesOver50Ms: frameTimes.filter((n) => n > 50).length,
      framesOver100Ms: frameTimes.filter((n) => n > 100).length,
    };
  }

  const median = (values) => {
    const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (!sorted.length) return null;
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  };

  function distribution(values) {
    const finite = values.filter(Number.isFinite);
    const centre = median(finite);
    const mad = centre == null ? null : median(finite.map((value) => Math.abs(value - centre)));
    return {
      min: finite.length ? round(Math.min(...finite), 3) : null,
      median: round(centre, 3),
      max: finite.length ? round(Math.max(...finite), 3) : null,
      medianAbsoluteDeviation: round(mad, 3),
    };
  }

  function aggregateSamples(samples) {
    const frames = samples.flatMap((sample) => sample.frameTimesMs);
    const aggregate = summarizeFrames(frames);
    const fpsValues = samples.map((sample) => sample.summary.avgFps);
    const fpsMean = fpsValues.reduce((sum, n) => sum + n, 0) / fpsValues.length;
    const variance = fpsValues.reduce((sum, n) => sum + (n - fpsMean) ** 2, 0) / fpsValues.length;
    aggregate.sampleAvgFpsStdDev = round(Math.sqrt(variance), 3);
    const avgFpsDistribution = distribution(samples.map((sample) => sample.summary.avgFps));
    const onePercentLowDistribution = distribution(samples.map((sample) => sample.summary.onePercentLowFps));
    const p99Distribution = distribution(samples.map((sample) => sample.summary.p99FrameMs));
    const worstDistribution = distribution(samples.map((sample) => sample.summary.worstFrameMs));
    const robustWorstSpread = (worstDistribution.medianAbsoluteDeviation || 0) * 1.4826;
    // This classification is descriptive only. An isolated sample is never removed
    // from the aggregate or from the <=100 ms stability gate.
    const tailCandidateThreshold = Math.max(
      (worstDistribution.median || 0) * 2,
      (worstDistribution.median || 0) + Math.max(10, robustWorstSpread * 3),
    );
    aggregate.sampleDistributions = {
      avgFps: avgFpsDistribution,
      onePercentLowFps: onePercentLowDistribution,
      p99FrameMs: p99Distribution,
      worstFrameMs: worstDistribution,
    };
    aggregate.tailStability = {
      samplesWithFramesOver33Ms: samples.filter((sample) => sample.summary.framesOver33Ms > 0).length,
      samplesWithFramesOver50Ms: samples.filter((sample) => sample.summary.framesOver50Ms > 0).length,
      samplesWithFramesOver100Ms: samples.filter((sample) => sample.summary.framesOver100Ms > 0).length,
      isolatedTailCandidateThresholdMs: round(tailCandidateThreshold, 3),
      isolatedTailCandidateSamples: samples
        .filter((sample) => sample.summary.worstFrameMs > tailCandidateThreshold)
        .map((sample) => sample.index),
      qualification: 'Candidates are retained in every aggregate and gate; the label only identifies samples that deserve host-scheduler/GPU follow-up.',
    };
    return aggregate;
  }

  async function heapSnapshot({ collect = false } = {}) {
    if (collect) await cdp.send('HeapProfiler.collectGarbage').catch(() => {});
    const response = await cdp.send('Performance.getMetrics');
    const metrics = Object.fromEntries(response.metrics.map((metric) => [metric.name, metric.value]));
    const browserMemory = await page.evaluate(() => performance.memory ? {
      usedJSHeapSize: performance.memory.usedJSHeapSize,
      totalJSHeapSize: performance.memory.totalJSHeapSize,
      jsHeapSizeLimit: performance.memory.jsHeapSizeLimit,
    } : null);
    return {
      source: collect
        ? 'Chrome DevTools Protocol Performance.getMetrics after explicit HeapProfiler.collectGarbage'
        : 'Chrome DevTools Protocol Performance.getMetrics without an additional immediate GC',
      explicitGcImmediatelyBeforeRead: collect,
      jsHeapUsedBytes: metrics.JSHeapUsedSize ?? browserMemory?.usedJSHeapSize ?? null,
      jsHeapUsedMiB: round((metrics.JSHeapUsedSize ?? browserMemory?.usedJSHeapSize ?? 0) / 1048576, 3),
      jsHeapTotalBytes: metrics.JSHeapTotalSize ?? browserMemory?.totalJSHeapSize ?? null,
      domNodes: metrics.Nodes ?? null,
      documents: metrics.Documents ?? null,
      layoutObjects: metrics.LayoutObjects ?? null,
    };
  }

  async function listenerSnapshot() {
    // CDP can enumerate listeners without monkey-patching addEventListener. The scope is
    // explicit: window, document, and every Element in the current document. EventTargets
    // hidden inside library objects are not exposed by the browser and remain unmeasured.
    const evaluated = await cdp.send('Runtime.evaluate', {
      expression: '[window, document, ...document.querySelectorAll("*")]',
      objectGroup: 'qa-perf-listeners',
      returnByValue: false,
    });
    const properties = await cdp.send('Runtime.getProperties', {
      objectId: evaluated.result.objectId,
      ownProperties: true,
    });
    const targets = properties.result
      .filter((property) => /^\d+$/.test(property.name) && property.value?.objectId)
      .map((property) => property.value.objectId);
    const batches = [];
    for (let i = 0; i < targets.length; i += 30) {
      const part = targets.slice(i, i + 30);
      batches.push(...await Promise.all(part.map(async (objectId) => {
        try {
          const found = await cdp.send('DOMDebugger.getEventListeners', { objectId });
          return found.listeners;
        } catch (_) {
          return [];
        }
      })));
    }
    const listeners = batches.flat();
    const rawByType = {};
    for (const listener of listeners) rawByType[listener.type] = (rawByType[listener.type] || 0) + 1;
    const profilerTypes = await page.evaluate(() => window.__qaPerf?.listenerTypes || []);
    const adjustedByType = { ...rawByType };
    for (const type of profilerTypes) {
      adjustedByType[type] = Math.max(0, (adjustedByType[type] || 0) - 1);
      if (!adjustedByType[type]) delete adjustedByType[type];
    }
    return {
      source: 'CDP DOMDebugger.getEventListeners over window + document + all current Elements',
      targetsInspected: targets.length,
      total: listeners.length - profilerTypes.length,
      byType: adjustedByType,
      profilerListenersExcluded: profilerTypes.length,
      unmeasured: 'Listeners on non-DOM EventTargets that are not reachable through CDP enumeration',
    };
  }

  async function renderSnapshot() {
    return page.evaluate(() => new Promise((resolve) => {
      const s3 = window.__fw.scene3d;
      const renderer = s3.renderer;
      const isWorldVisible = (object) => {
        for (let node = object; node; node = node.parent) if (!node.visible) return false;
        return true;
      };
      // EffectComposer issues several renderer.render calls per game frame. Reset after
      // the app's current rAF, then read after the following app rAF to retain one full
      // composed frame instead of only the final fullscreen pass.
      requestAnimationFrame(() => {
        renderer.info.autoReset = false;
        renderer.info.reset();
        requestAnimationFrame(() => {
          const render = { ...renderer.info.render };
          const materials = new Set();
          const textures = new Map();
          const geometries = new Set();
          let visibleMeshes = 0;
          let sceneTriangles = 0;
          const textureKeys = [
            'map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap',
            'emissiveMap', 'alphaMap', 'lightMap', 'envMap',
          ];
          s3.scene.traverse((object) => {
            if (!object.isMesh || !isWorldVisible(object)) return;
            visibleMeshes++;
            const geometry = object.geometry;
            if (geometry) {
              geometries.add(geometry.uuid);
              const triangleCount = geometry.index
                ? geometry.index.count / 3
                : (geometry.attributes?.position?.count || 0) / 3;
              sceneTriangles += triangleCount * (object.isInstancedMesh ? object.count : 1);
            }
            const list = Array.isArray(object.material) ? object.material : [object.material];
            for (const material of list) {
              if (!material) continue;
              materials.add(material.uuid);
              for (const key of textureKeys) {
                const texture = material[key];
                if (texture) textures.set(texture.uuid, texture);
              }
            }
          });
          let estimatedTextureBytes = 0;
          let textureDimensionsKnown = 0;
          for (const texture of textures.values()) {
            const image = texture.image || texture.source?.data;
            const width = image?.videoWidth || image?.naturalWidth || image?.width || 0;
            const height = image?.videoHeight || image?.naturalHeight || image?.height || 0;
            if (!width || !height) continue;
            textureDimensionsKnown++;
            // Explicit estimate, not a driver allocation claim: RGBA8 at four bytes per
            // texel, plus 1/3 for a complete mip chain when mip generation is enabled.
            estimatedTextureBytes += width * height * 4 * (texture.generateMipmaps === false ? 1 : 4 / 3);
          }
          renderer.info.autoReset = true;
          resolve({
            source: 'THREE.WebGLRenderer.info accumulated for one complete composed game frame',
            drawCalls: render.calls,
            renderedTriangles: render.triangles,
            renderedLines: render.lines,
            renderedPoints: render.points,
            visibleSceneMeshes: visibleMeshes,
            sceneTrianglesBeforeFrustumCulling: Math.round(sceneTriangles),
            uniqueVisibleGeometries: geometries.size,
            uniqueVisibleMaterials: materials.size,
            uniqueVisibleTextures: textures.size,
            geometriesInRendererMemory: renderer.info.memory.geometries,
            texturesInRendererMemory: renderer.info.memory.textures,
            estimatedVisibleTextureBytes: Math.round(estimatedTextureBytes),
            estimatedVisibleTextureMiB: Math.round(estimatedTextureBytes / 1048576 * 1000) / 1000,
            textureDimensionsKnown,
            textureMemoryQualification: 'Estimate assumes RGBA8 and complete mip chains; exact GPU allocation is unavailable from WebGL.',
          });
        });
      });
    }));
  }

  async function resetProfiler() {
    await page.evaluate(() => {
      const perf = window.__qaPerf;
      if (perf.ensureCustomerTiming) perf.ensureCustomerTiming();
      perf.inputEvents = Object.fromEntries(perf.listenerTypes.map((type) => [type, 0]));
      perf.posRedraws = 0;
      perf.terminalRedraws = 0;
      perf.registerHintMutations = 0;
      for (const timing of Object.values(perf.cpuTiming || {})) {
        timing.calls = 0;
        timing.totalMs = 0;
        timing.maxMs = 0;
      }
    });
  }

  async function readProfiler(durationMs) {
    await page.waitForTimeout(30); // allow MutationObserver delivery from the final sampled frame
    return page.evaluate((ms) => {
      const perf = window.__qaPerf;
      return {
        source: 'Page-local CanvasRenderingContext2D and MutationObserver instrumentation',
        durationMs: ms,
        posRedraws: perf.posRedraws,
        posRedrawsPerSecond: Math.round(perf.posRedraws * 100000 / ms) / 100,
        terminalRedraws: perf.terminalRedraws,
        terminalRedrawsPerSecond: Math.round(perf.terminalRedraws * 100000 / ms) / 100,
        registerHintMutations: perf.registerHintMutations,
        registerHintMutationsPerSecond: Math.round(perf.registerHintMutations * 100000 / ms) / 100,
        inputEvents: { ...perf.inputEvents },
        cpuTiming: Object.fromEntries(Object.entries(perf.cpuTiming || {}).map(([name, timing]) => [name, {
          source: timing.source,
          calls: timing.calls,
          totalMs: Math.round(timing.totalMs * 1000) / 1000,
          maxCallMs: Math.round(timing.maxMs * 1000) / 1000,
          meanCallMs: timing.calls ? Math.round(timing.totalMs / timing.calls * 1000000) / 1000000 : 0,
          cpuMsPerSecond: Math.round(timing.totalMs * 100000 / ms) / 100,
        }])),
      };
    }, durationMs);
  }

  async function settleBeforeSampling({ warmupMs = WARMUP_MS, gcSettleMs = GC_SETTLE_MS } = {}) {
    const started = Date.now();
    await cdp.send('HeapProfiler.collectGarbage').catch(() => {});
    await page.waitForTimeout(gcSettleMs);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.waitForTimeout(warmupMs);
    return {
      explicitGc: true,
      gcSettleMs,
      warmupMs,
      twoAnimationFrameBoundary: true,
      elapsedMs: Date.now() - started,
    };
  }

  async function captureFrameSamples(label, {
    sampleCount = SAMPLE_COUNT,
    sampleMs = SAMPLE_MS,
    warmupMs = WARMUP_MS,
    gcSettleMs = GC_SETTLE_MS,
  } = {}) {
    const settle = await settleBeforeSampling({ warmupMs, gcSettleMs });
    await resetProfiler();
    const samples = [];
    for (let index = 0; index < sampleCount; index++) {
      const frameTimesMs = await page.evaluate((sampleMs) => new Promise((resolve) => {
        const times = [];
        let started = null;
        let previous = null;
        function frame(now) {
          if (started == null) {
            started = now;
            previous = now;
          } else {
            times.push(now - previous);
            previous = now;
          }
          if (now - started >= sampleMs) resolve(times);
          else requestAnimationFrame(frame);
        }
        requestAnimationFrame(frame);
      }), sampleMs);
      samples.push({
        index: index + 1,
        summary: summarizeFrames(frameTimesMs),
        frameTimesMs: frameTimesMs.map((n) => round(n, 3)),
      });
      samples[samples.length - 1].tailStable = samples[samples.length - 1].summary.worstFrameMs <= 100;
      samples[samples.length - 1].tailStabilityRule = 'No sampled rAF delta may exceed 100 ms; this does not exclude the frame from pooled metrics.';
    }
    const durationMs = samples.reduce((sum, sample) => sum + sample.summary.durationMs, 0);
    return {
      label,
      settle,
      samples,
      aggregate: aggregateSamples(samples),
      ui: await readProfiler(durationMs),
    };
  }

  async function waitForCameraStable(timeout = 12000) {
    await page.evaluate(() => { window.__qaPerfCameraProbe = null; });
    await page.waitForFunction(() => {
      const camera = window.__fw.scene3d.camera;
      const now = {
        x: camera.position.x, y: camera.position.y, z: camera.position.z,
        qx: camera.quaternion.x, qy: camera.quaternion.y,
        qz: camera.quaternion.z, qw: camera.quaternion.w,
      };
      const old = window.__qaPerfCameraProbe;
      if (!old) {
        window.__qaPerfCameraProbe = { ...now, stable: 0 };
        return false;
      }
      const delta = Math.hypot(
        now.x - old.x, now.y - old.y, now.z - old.z,
        now.qx - old.qx, now.qy - old.qy, now.qz - old.qz, now.qw - old.qw,
      );
      const stable = delta < 0.00035 ? old.stable + 1 : 0;
      window.__qaPerfCameraProbe = { ...now, stable };
      return stable >= 7;
    }, null, { timeout, polling: 'raf' });
  }

  const routeProject = (local) => page.evaluate((point) => window.__qaPerfRoute.project(point), local);
  const routeItem = (uid) => page.evaluate((id) => window.__qaPerfRoute.item(id), uid);
  const routeItemPickPoint = (uid) => page.evaluate((id) => window.__qaPerfRoute.itemPickPoint(id), uid);
  const routeMoney = (from, denom = null) => page.evaluate(
    ([source, value]) => window.__qaPerfRoute.money(source, value), [from, denom],
  );
  const routeKind = (kind, pickOnly = false) => page.evaluate(
    ([value, onlyPickable]) => window.__qaPerfRoute.kind(value, onlyPickable), [kind, pickOnly],
  );
  const routeNamed = (name) => page.evaluate((value) => window.__qaPerfRoute.named(value), name);

  async function moveMouseLine(from, to, steps = 16, delayMs = 13) {
    for (let step = 1; step <= steps; step++) {
      const t = step / steps;
      await page.mouse.move(
        from.x + (to.x - from.x) * t,
        from.y + (to.y - from.y) * t,
      );
      if (delayMs) await page.waitForTimeout(delayMs);
    }
  }

  async function waitForTxStage(stages, timeout = 12000) {
    const wanted = Array.isArray(stages) ? stages : [stages];
    await page.waitForFunction((values) => {
      const tx = window.__fw.scene3d.clubhouse().register.getTx();
      return !!tx && values.includes(tx.stage);
    }, wanted, { timeout });
  }

  async function scanAndStageCurrentOrder() {
    const scanner = { x: 2.70, y: 1.17, z: 4.22 };
    const stageTargets = [
      { x: 3.32, y: 1.17, z: 4.30 },
      { x: 3.38, y: 1.17, z: 4.38 },
      { x: 3.32, y: 1.17, z: 4.48 },
      { x: 3.38, y: 1.17, z: 4.56 },
    ];
    const uids = await page.evaluate(() => window.__fw.scene3d.clubhouse()
      .register.getTx().items.map((item) => item.uid));
    for (let index = 0; index < uids.length; index++) {
      const uid = uids[index];
      const physical = await routeItem(uid);
      if (!physical) throw new Error(`Performance route could not find physical product ${uid}.`);
      // A model's AABB centre can land in empty space (notably the finger gap of the
      // glove), so projecting that centre does not guarantee that the production
      // raycaster will pick the requested product. Ask the read-only probe for a
      // visible surface point, then still perform the interaction through the real
      // pointer handlers.
      const from = await routeItemPickPoint(uid) || await routeProject(physical);
      if (!from.inView) throw new Error(`Performance route product ${uid} was outside the cashier camera.`);
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      const grabbedTarget = await page.waitForFunction((id) => {
        const flow = window.__fw.scene3d.clubhouse().register.getFlow();
        // A barcode already inside the assistance volume can advance from ProductHeld
        // to ProductScanning within the same frame. Keep the UID assertion, but search
        // recent history instead of requiring pickup to remain the final transition.
        const pickedRequestedUid = (flow?.history || []).slice(-8)
          .some((entry) => entry.event === `product-picked-up:${id}`);
        return ['ProductHeld', 'ProductScanning'].includes(flow?.state) && pickedRequestedUid;
      }, uid, { timeout: 1200 }).then(() => true).catch(() => false);
      if (!grabbedTarget) {
        await page.mouse.up();
        const flow = await page.evaluate(() => window.__fw.scene3d.clubhouse().register.getFlow());
        throw new Error(`Performance route pointer did not grab ${uid}; flow=${flow?.state || 'none'}, event=${flow?.history?.at(-1)?.event || 'none'}.`);
      }
      let rotated = null;
      // Match the production acceptance route: every picked product is deliberately
      // turned at least once, and four quarter-turns cover every authored label pose.
      for (let turn = 0; turn < 4; turn++) {
        await page.mouse.wheel(0, 120);
        await page.waitForTimeout(70);
        rotated = await routeItem(uid);
        if (rotated && rotated.barcodeFacing <= -0.35) break;
      }
      if (!rotated || rotated.barcodeFacing > -0.35) {
        await page.mouse.up();
        throw new Error(`Performance route could not rotate ${uid}'s barcode toward the scanner (dot ${rotated?.barcodeFacing ?? 'missing'}).`);
      }
      const scannerPixel = await routeProject(scanner);
      await moveMouseLine(from, scannerPixel);
      await page.waitForFunction((id) => {
        const tx = window.__fw.scene3d.clubhouse().register.getTx();
        return !!tx?.items.find((item) => item.uid === id)?.scanned;
      }, uid, { timeout: 5000 });
      const target = await routeProject(stageTargets[index % stageTargets.length]);
      await moveMouseLine(scannerPixel, target);
      await page.mouse.up();
      await page.waitForFunction((id) => {
        const tx = window.__fw.scene3d.clubhouse().register.getTx();
        return !!tx?.items.find((item) => item.uid === id)?.staged;
      }, uid, { timeout: 5000 });
    }
  }

  async function captureRepresentativeStage(key, label) {
    await page.screenshot({ path: `${OUT}/stage-${key}.png` });
    const capture = await captureFrameSamples(label, {
      sampleCount: STAGE_SAMPLE_COUNT,
      sampleMs: STAGE_SAMPLE_MS,
      warmupMs: STAGE_WARMUP_MS,
      gcSettleMs: 250,
    });
    capture.state = await page.evaluate(() => {
      const register = window.__fw.scene3d.clubhouse().register;
      const tx = register.getTx();
      return {
        flow: register.getFlow ? register.getFlow()?.state || null : null,
        transactionStage: tx?.stage || null,
        method: tx?.method || null,
        drawerOpen: !!tx?.drawerOpen,
        deposited: !!tx?.deposited,
        selectedChangeTotal: tx ? Object.entries(tx.hand || {})
          .reduce((sum, [denom, count]) => sum + Number(denom) * count, 0) : null,
        receiptPrinted: !!tx?.receiptPrinted,
        receiptPacked: !!tx?.receiptPacked,
        baggedItems: tx?.items.filter((item) => item.bagged).length || 0,
      };
    });
    capture.render = await renderSnapshot();
    // Do not trigger a second GC while a six-second CardSwiping pointer capture is
    // live. The stage already received its pre-sample GC; this is the immediate
    // post-sample heap reading, qualified as such in its source metadata.
    capture.heap = await heapSnapshot({ collect: false });
    capture.screenshot = `stage-${key}.png`;
    return capture;
  }

  async function captureActivationWindow(action, durationMs = 2000) {
    const pending = page.evaluate((windowMs) => new Promise((resolve) => {
      const frameTimesMs = [];
      let started = null;
      let previous = null;
      window.__qaPerfActivationProbeReady = false;
      function frame(now) {
        if (started == null) {
          started = now;
          previous = now;
          window.__qaPerfActivationProbeStarted = now;
          window.__qaPerfActivationProbeReady = true;
        } else {
          frameTimesMs.push(now - previous);
          previous = now;
        }
        if (now - started >= windowMs) {
          resolve({
            frameTimesMs,
            started,
            ended: now,
            actionAt: window.__qaPerfActivationActionAt || null,
          });
        } else requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    }), durationMs);
    await page.waitForFunction(() => window.__qaPerfActivationProbeReady, null, { timeout: 3000 });
    await page.evaluate(() => { window.__qaPerfActivationActionAt = performance.now(); });
    await action();
    const raw = await pending;
    return {
      label: 'First activation hitch window (includes frames immediately before and after E)',
      durationMs,
      actionOffsetMs: round(raw.actionAt - raw.started, 3),
      summary: summarizeFrames(raw.frameTimesMs),
      frameTimesMs: raw.frameTimesMs.map((value) => round(value, 3)),
      qualification: 'This cold activation window is reported separately and is not discarded by the matched-scene warm-up.',
    };
  }

  // --- deterministic boot -----------------------------------------------------------
  await page.goto('http://localhost:8457/');
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.waitForTimeout(900);
  await page.getByText('Continue', { exact: true }).click().catch(() => {});
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 40000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
  }, null, { timeout: 40000 });

  const environment = await page.evaluate(async () => {
    const THREE = await import('/vendor/three.module.js');
    const app = window.__fw;
    const ch = app.scene3d.clubhouse();
    if (typeof ch.setOrganicWalkins === 'function') ch.setOrganicWalkins(false);
    if (typeof ch.clearWalkins === 'function') ch.clearWalkins();
    app.speedIdx = 0;
    app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440 + 14 * 60;
    app.state.weather.today = { tempHiF: 72, tempLoF: 54, rainIn: 0, humidity: 0.48, windMph: 5 };
    const excluded = new Set(['rug1', 'plant1', 'poster1', 'board1', 'light1', 'lounge1', 'vac1']);
    for (const [skuId, inventory] of Object.entries(app.state.shop.inventory)) {
      inventory.shelf = excluded.has(skuId) ? 0 : Math.max(10, inventory.shelf || 0);
      inventory.back = 0;
    }
    ch.rebuildStock();
    app.scene3d.applyTimeWeather(14 * 60, app.state.weather);
    app.scene3d.walk.clearKeys();
    const walk = app.scene3d.walk.state;
    // This is the exact cashier pose used by registerMode, so idle and active share
    // camera position, orientation, FOV, lighting, background, viewport, and stock.
    const eye = { x: 2.78, y: 1.68, z: 5.24 };
    const at = { x: 2.52, y: 1.04, z: 4.02 };
    const dx = at.x - eye.x;
    const dz = at.z - eye.z;
    const dh = Math.hypot(dx, dz);
    walk.x = eye.x + ch.interior.position.x;
    walk.z = eye.z + ch.interior.position.z;
    walk.yaw = Math.atan2(-dx / dh, -dz / dh);
    walk.pitch = Math.atan2(at.y - eye.y, dh);
    app.scene3d.camera.fov = 60;
    app.scene3d.camera.updateProjectionMatrix();

    // Count only relevant UI work and physical input. These six listeners are removed
    // from CDP listener totals so comparisons describe the game, not the profiler.
    const listenerTypes = ['pointerdown', 'pointerup', 'pointermove', 'wheel', 'keydown', 'keyup'];
    window.__qaPerf = {
      listenerTypes,
      inputEvents: Object.fromEntries(listenerTypes.map((type) => [type, 0])),
      posRedraws: 0,
      terminalRedraws: 0,
      registerHintMutations: 0,
      cpuTiming: {
        registerUpdateIncludingCashierHandIk: {
          source: 'performance.now around register.update; includes register logic, physical props, camera easing, and cashierHands.update IK',
          calls: 0, totalMs: 0, maxMs: 0,
        },
        activeCustomerCharacterAnimation: {
          source: 'performance.now around the active checkout customer characterAsset.char.update animation call',
          calls: 0, totalMs: 0, maxMs: 0,
        },
      },
    };
    for (const type of listenerTypes) {
      window.addEventListener(type, () => { window.__qaPerf.inputEvents[type]++; }, true);
    }
    const originalFillRect = CanvasRenderingContext2D.prototype.fillRect;
    CanvasRenderingContext2D.prototype.fillRect = function qaPerfFillRect(x, y, width, height) {
      const perf = window.__qaPerf;
      if (perf && x === 0 && y === 0 && width === this.canvas.width && height === this.canvas.height) {
        if (width === 384 && height === 240) perf.posRedraws++;
        if (width === 192 && height === 144) perf.terminalRedraws++;
      }
      return originalFillRect.apply(this, arguments);
    };
    const hint = document.querySelector('.reg-hint');
    if (hint) {
      new MutationObserver((records) => { window.__qaPerf.registerHintMutations += records.length; })
        .observe(hint, { attributes: true, childList: true, characterData: true, subtree: true });
    }

    const recordCpu = (bucket, started) => {
      const elapsed = performance.now() - started;
      bucket.calls++;
      bucket.totalMs += elapsed;
      bucket.maxMs = Math.max(bucket.maxMs, elapsed);
    };
    const register = ch.register;
    // The clubhouse exposes only the register's interaction surface (getTx, swipeAt, …) and
    // drives its per-frame update through an internal closure, so `ch.register.update` is not
    // a function here. Guard the CPU-timing wrap so the capture still completes; the
    // register-update sub-timing is honestly marked unavailable rather than crashing the run.
    if (!register.__qaPerfUpdateWrapped && typeof register.update === 'function') {
      const originalRegisterUpdate = register.update.bind(register);
      register.update = (...args) => {
        const started = performance.now();
        try { return originalRegisterUpdate(...args); }
        finally { recordCpu(window.__qaPerf.cpuTiming.registerUpdateIncludingCashierHandIk, started); }
      };
      register.__qaPerfUpdateWrapped = true;
    } else if (typeof register.update !== 'function') {
      window.__qaPerf.cpuTiming.registerUpdateIncludingCashierHandIk.source
        += ' — UNAVAILABLE: ch.register exposes no update (per-frame update runs on an internal closure); sub-timing not captured';
    }
    window.__qaPerf.ensureCustomerTiming = () => {
      const customer = register.getCustomer && register.getCustomer();
      const char = customer?.mesh?.userData?.char;
      if (!char || char.__qaPerfUpdateWrapped) return !!char;
      const originalCharacterUpdate = char.update.bind(char);
      char.update = (...args) => {
        const started = performance.now();
        try { return originalCharacterUpdate(...args); }
        finally {
          if (register.getCustomer && register.getCustomer() === customer) {
            recordCpu(window.__qaPerf.cpuTiming.activeCustomerCharacterAnimation, started);
          }
        }
      };
      char.__qaPerfUpdateWrapped = true;
      return true;
    };

    const isWorldVisible = (object) => {
      for (let node = object; node; node = node.parent) if (!node.visible) return false;
      return true;
    };
    const objects = (predicate) => {
      const found = [];
      ch.interior.traverse((object) => {
        if (isWorldVisible(object) && predicate(object)) found.push(object);
      });
      return found;
    };
    const describe = (object) => {
      if (!object) return null;
      const bounds = new THREE.Box3().setFromObject(object);
      const centre = bounds.isEmpty()
        ? object.getWorldPosition(new THREE.Vector3())
        : bounds.getCenter(new THREE.Vector3());
      centre.sub(ch.interior.position);
      return {
        x: centre.x, y: centre.y, z: centre.z,
        uid: object.userData?.uid || null,
        denom: object.userData?.denom == null ? null : Number(object.userData.denom),
        from: object.userData?.from || null,
        pick: !!object.userData?.pick,
      };
    };
    window.__qaPerfRoute = {
      project(local) {
        const point = new THREE.Vector3(
          local.x + ch.interior.position.x,
          local.y + ch.interior.position.y,
          local.z + ch.interior.position.z,
        ).project(app.scene3d.camera);
        const rect = document.querySelector('canvas').getBoundingClientRect();
        return {
          x: rect.left + (point.x + 1) * rect.width / 2,
          y: rect.top + (-point.y + 1) * rect.height / 2,
          inView: point.z >= -1 && point.z <= 1 && Math.abs(point.x) <= 1 && Math.abs(point.y) <= 1,
        };
      },
      item(uid) {
        const object = objects((entry) => entry.userData?.kind === 'item' && entry.userData.uid === uid)[0];
        const out = describe(object);
        if (out && object.userData.bc) {
          const rotation = object.userData.bc.getWorldQuaternion(new THREE.Quaternion());
          out.barcodeFacing = new THREE.Vector3(0, 0, 1).applyQuaternion(rotation).normalize().y;
        }
        return out;
      },
      itemPickPoint(uid) {
        const roots = objects((entry) => entry.userData?.kind === 'item');
        const target = roots.find((entry) => entry.userData.uid === uid);
        if (!target) return null;

        // Find a pixel where the same item-only raycast used by registerMode will
        // actually hit this root. Projecting an AABB centre is insufficient for
        // concave silhouettes such as the glove, whose centre can be empty space.
        const canvas = document.querySelector('canvas');
        const rect = canvas.getBoundingClientRect();
        const bounds = new THREE.Box3().setFromObject(target);
        const projected = [];
        for (const x of [bounds.min.x, bounds.max.x]) {
          for (const y of [bounds.min.y, bounds.max.y]) {
            for (const z of [bounds.min.z, bounds.max.z]) {
              const point = new THREE.Vector3(x, y, z).project(app.scene3d.camera);
              projected.push({
                x: rect.left + (point.x + 1) * rect.width / 2,
                y: rect.top + (-point.y + 1) * rect.height / 2,
              });
            }
          }
        }
        const minX = Math.max(rect.left + 1, Math.min(...projected.map((point) => point.x)));
        const maxX = Math.min(rect.right - 1, Math.max(...projected.map((point) => point.x)));
        const minY = Math.max(rect.top + 1, Math.min(...projected.map((point) => point.y)));
        const maxY = Math.min(rect.bottom - 1, Math.max(...projected.map((point) => point.y)));
        if (!(maxX > minX && maxY > minY)) return null;

        const candidates = [];
        for (let row = 1; row <= 9; row++) {
          for (let column = 1; column <= 9; column++) {
            const u = column / 10;
            const v = row / 10;
            candidates.push({
              x: minX + (maxX - minX) * u,
              y: minY + (maxY - minY) * v,
              centreDistance: (u - 0.5) ** 2 + (v - 0.5) ** 2,
            });
          }
        }
        candidates.sort((a, b) => a.centreDistance - b.centreDistance);
        const picker = new THREE.Raycaster();
        for (const candidate of candidates) {
          picker.setFromCamera({
            x: ((candidate.x - rect.left) / rect.width) * 2 - 1,
            y: -(((candidate.y - rect.top) / rect.height) * 2 - 1),
          }, app.scene3d.camera);
          const first = picker.intersectObjects(roots, true)[0];
          if (!first) continue;
          let root = first.object;
          while (root && !root.userData.pick && root.parent) root = root.parent;
          if (root?.userData?.uid === uid) {
            return { x: candidate.x, y: candidate.y, inView: true };
          }
        }
        return null;
      },
      money(from, denom = null) {
        const found = objects((entry) => entry.userData?.kind === 'money'
          && entry.userData.from === from
          && (denom == null || Number(entry.userData.denom) === Number(denom)));
        return describe(found[found.length - 1]);
      },
      kind(kind, pickOnly = false) {
        return describe(objects((entry) => entry.userData?.kind === kind
          && (!pickOnly || entry.userData.pick))[0]);
      },
      named(name) {
        return describe(objects((entry) => entry.name === name)[0]);
      },
    };

    const gl = app.scene3d.renderer.getContext();
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      url: location.href,
      userAgent: navigator.userAgent,
      hardwareConcurrency: navigator.hardwareConcurrency,
      deviceMemoryGiB: navigator.deviceMemory || null,
      devicePixelRatio,
      viewport: { width: innerWidth, height: innerHeight },
      webglVendor: debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
      webglRenderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      camera: {
        x: walk.x, y: eye.y + ch.interior.position.y, z: walk.z,
        yaw: walk.yaw, pitch: walk.pitch, fov: app.scene3d.camera.fov,
      },
      fixture: 'newEmpire(relaxed, seed 424242), Willow Creek, 2 PM clear weather, paused simulation, stocked retail shelves',
    };
  });
  environment.browserVersion = await page.context().browser().version();
  await page.waitForTimeout(900);

  async function completeCardPaymentForLeakProbe() {
    await page.keyboard.press('t');
    await waitForTxStage('card-present');
    await page.waitForTimeout(900);
    const terminal = await routeProject({ x: 2.05, y: 1.115, z: 3.88 });
    if (!terminal.inView) throw new Error('Leak probe card terminal was outside the cashier camera.');
    await page.mouse.click(terminal.x, terminal.y);
    await waitForTxStage('card-ready');
    await waitForCameraStable();

    for (let attempt = 1; attempt <= 5; attempt++) {
      const swipe = await page.evaluate(() => window.__fw.scene3d.clubhouse().register.swipeAt());
      const top = await routeProject(swipe.top);
      const bottom = await routeProject(swipe.bot);
      if (!top.inView || !bottom.inView) throw new Error('Leak probe swipe channel left the camera.');

      let started = false;
      for (let startTry = 0; startTry < 3 && !started; startTry++) {
        await page.mouse.move(top.x, top.y);
        await page.mouse.down();
        started = await page.waitForFunction(() => (
          window.__fw.scene3d.clubhouse().register.getFlow()?.state === 'CardSwiping'
        ), null, { timeout: 900 }).then(() => true).catch(() => false);
        if (!started) {
          await page.mouse.up();
          await page.waitForTimeout(80);
        }
      }
      if (!started) throw new Error(`Leak probe could not begin card swipe ${attempt}.`);
      await moveMouseLine(top, bottom, 16, 12);
      await page.mouse.up();

      const landed = await page.waitForFunction(() => {
        const tx = window.__fw.scene3d.clubhouse().register.getTx();
        return !!tx && ['card-busy', 'card-declined', 'receipt'].includes(tx.stage);
      }, null, { timeout: 6000 }).then(() => true).catch(() => false);
      if (!landed) {
        await waitForTxStage('card-ready', 3000).catch(() => {});
        continue;
      }
      await waitForTxStage(['card-declined', 'receipt'], 14000);
      const stage = await page.evaluate(() => window.__fw.scene3d.clubhouse().register.getTx()?.stage);
      if (stage === 'receipt') return;
      const retry = await routeProject({ x: 2.05, y: 1.115, z: 3.88 });
      await page.mouse.click(retry.x, retry.y);
      await waitForTxStage('card-ready');
      await waitForCameraStable();
    }
    throw new Error('Leak probe exhausted five physical card attempts.');
  }

  async function completeCashPaymentForLeakProbe() {
    await page.keyboard.press('t');
    await waitForTxStage('cash-tender');
    await page.waitForTimeout(950);
    const tender = await routeMoney('tender');
    if (!tender) throw new Error('Leak probe cash customer presented no visible tender.');
    const tenderPoint = await routeProject(tender);
    await page.mouse.click(tenderPoint.x, tenderPoint.y);
    await waitForTxStage('cash-drawer');
    await page.keyboard.press('d');
    await page.waitForFunction(() => !!window.__fw.scene3d.clubhouse().register.getTx()?.drawerOpen,
      null, { timeout: 6000 });
    await waitForCameraStable();

    for (let guard = 0; guard < 32; guard++) {
      const piece = await routeMoney('tender');
      if (!piece) break;
      const slot = await routeMoney('drawer', piece.denom);
      if (!slot) throw new Error(`Leak probe drawer had no ${piece.denom} compartment.`);
      const from = await routeProject(piece);
      const to = await routeProject({ x: slot.x, y: 1.17, z: slot.z });
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await moveMouseLine(from, to, 14, 10);
      await page.mouse.up();
      await page.waitForTimeout(80);
    }
    await page.waitForFunction(() => !!window.__fw.scene3d.clubhouse().register.getTx()?.deposited,
      null, { timeout: 8000 });

    const change = await page.evaluate(async () => {
      const registerSim = await import('/src/sim/register.js');
      const app = window.__fw;
      const tx = app.scene3d.clubhouse().register.getTx();
      const due = registerSim.changeDue(tx);
      return {
        due,
        plan: registerSim.makeChangeFrom(registerSim.drawerContents(tx, app.state.shop.drawer), due),
      };
    });
    if (!change.plan) throw new Error(`Leak probe could not make $${change.due.toFixed(2)} change.`);
    for (const [denom, count] of Object.entries(change.plan)) {
      for (let index = 0; index < count; index++) {
        const piece = await routeMoney('drawer', Number(denom));
        if (!piece) throw new Error(`Leak probe lost visible ${denom} change.`);
        const point = await routeProject(piece);
        await page.mouse.click(point.x, point.y);
        await page.waitForTimeout(75);
      }
    }

    if (change.due > 0) {
      await waitForCameraStable();
      const palm = await routeKind('palm');
      if (!palm) throw new Error('Leak probe customer palm did not appear for change.');
      const palmPoint = await routeProject(palm);
      await page.mouse.click(palmPoint.x, palmPoint.y);
    } else {
      await page.keyboard.press('d');
    }
    await waitForTxStage('receipt', 10000);
  }

  async function packAndHandoffForLeakProbe() {
    await page.waitForFunction(() => {
      const tx = window.__fw.scene3d.clubhouse().register.getTx();
      return !!tx?.receiptPrinted && !!window.__qaPerfRoute.kind('receipt', true);
    }, null, { timeout: 14000 });
    await waitForCameraStable();
    const receipt = await routeKind('receipt', true);
    const receiptPoint = await routeProject(receipt);
    const bagPoint = { x: 3.50, y: 1.17, z: 4.44 };
    const bagPixel = await routeProject(bagPoint);
    await page.mouse.move(receiptPoint.x, receiptPoint.y);
    await page.mouse.down();
    await waitForTxStage('bagging', 6000);
    await waitForCameraStable();
    await moveMouseLine(receiptPoint, bagPixel, 16, 11);
    await page.mouse.up();
    await page.waitForFunction(() => !!window.__fw.scene3d.clubhouse().register.getTx()?.receiptPacked,
      null, { timeout: 6000 });

    for (let guard = 0; guard < 12; guard++) {
      const pending = await page.evaluate(() => window.__fw.scene3d.clubhouse().register
        .getTx()?.items.filter((item) => !item.bagged).map((item) => item.uid) || []);
      if (!pending.length) break;
      const candidates = (await Promise.all(pending.map(async (uid) => ({ uid, item: await routeItem(uid) }))))
        .filter((entry) => entry.item)
        .sort((a, b) => b.item.z - a.item.z);
      const candidate = candidates[guard % candidates.length];
      if (!candidate) throw new Error('Leak probe found no visible unbagged product.');
      const from = await routeItemPickPoint(candidate.uid) || await routeProject(candidate.item);
      const beforeCount = await page.evaluate(() => window.__fw.scene3d.clubhouse().register
        .getTx().items.filter((item) => item.bagged).length);
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await moveMouseLine(from, bagPixel, 14, 10);
      await page.mouse.up();
      await page.waitForFunction((count) => window.__fw.scene3d.clubhouse().register
        .getTx()?.items.filter((item) => item.bagged).length > count,
      beforeCount, { timeout: 2500 });
    }
    await page.waitForFunction(() => {
      const tx = window.__fw.scene3d.clubhouse().register.getTx();
      return !!tx && tx.items.every((item) => item.bagged);
    }, null, { timeout: 6000 });
    await page.waitForTimeout(760);

    const handles = [
      await routeNamed('ANCHOR_BagHandleFront'),
      await routeNamed('ANCHOR_BagHandleBack'),
      await routeNamed('BagHandleFrontPivot'),
      await routeNamed('BagHandleBackPivot'),
      await routeKind('bag'),
    ].filter(Boolean);
    let handlePoint = null;
    for (const handle of handles) {
      const base = await routeProject(handle);
      for (const offset of [{ x: 0, y: 0 }, { x: -8, y: 0 }, { x: 8, y: 0 }, { x: 0, y: -8 }]) {
        const point = { x: base.x + offset.x, y: base.y + offset.y };
        await page.mouse.move(point.x, point.y);
        await page.mouse.down();
        const caught = await page.waitForFunction(() => (
          window.__fw.scene3d.clubhouse().register.getFlow()?.state === 'BagHandoff'
        ), null, { timeout: 700 }).then(() => true).catch(() => false);
        if (caught) {
          handlePoint = point;
          break;
        }
        await page.mouse.up();
      }
      if (handlePoint) break;
    }
    if (!handlePoint) throw new Error('Leak probe could not grab the filled bag handles.');
    await waitForCameraStable();
    const palm = await routeKind('palm');
    if (!palm) throw new Error('Leak probe customer palm disappeared during bag handoff.');
    const palmPoint = await routeProject(palm);
    await moveMouseLine(handlePoint, palmPoint, 18, 11);
    await page.mouse.up();
    await page.waitForFunction(() => !window.__fw.scene3d.clubhouse().register.hasTx(), null,
      { timeout: 12000 });
  }

  async function checkoutResidueSnapshot() {
    return page.evaluate(() => {
      const app = window.__fw;
      const ch = app.scene3d.clubhouse();
      const register = ch.register;
      const customers = typeof ch.customers === 'function' ? ch.customers()
        : Array.isArray(ch.customers) ? ch.customers : [];
      const kinds = {};
      let tenderOrHandMoney = 0;
      let packingMotions = 0;
      const geometries = new Set();
      const materials = new Set();
      const textures = new Set();
      ch.interior.traverse((object) => {
        const kind = object.userData?.kind;
        if (kind) kinds[kind] = (kinds[kind] || 0) + 1;
        if (kind === 'money' && ['tender', 'hand'].includes(object.userData?.from)) tenderOrHandMoney++;
        if (object.userData?.packingMotion) packingMotions++;
        if (!object.isMesh) return;
        if (object.geometry) geometries.add(object.geometry.uuid);
        for (const material of (Array.isArray(object.material) ? object.material : [object.material])) {
          if (!material) continue;
          materials.add(material.uuid);
          for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'alphaMap']) {
            if (material[key]) textures.add(material[key].uuid);
          }
        }
      });
      const shop = app.state.shop;
      const history = shop.transactionHistory || [];
      const lastTicket = history[0] || null;
      return {
        active: register.isActive(),
        hasTx: register.hasTx(),
        customers: customers.length,
        heldUnits: (shop.held || []).length,
        transactionHistory: history.length,
        salesUnits: (shop.salesLive || {}).units || 0,
        salesRevenue: (shop.salesLive || {}).revenue || 0,
        lastTicket: lastTicket ? {
          customer: lastTicket.customer || null,
          method: lastTicket.method || null,
          items: Array.isArray(lastTicket.items) ? lastTicket.items.length : Number(lastTicket.items || 0),
          total: Number(lastTicket.total || 0),
        } : null,
        queue: typeof ch.checkoutQueue === 'function' ? ch.checkoutQueue() : [],
        domElements: document.querySelectorAll('*').length,
        kinds,
        tenderOrHandMoney,
        packingMotions,
        liveSceneResources: {
          geometries: geometries.size,
          materials: materials.size,
          textures: textures.size,
        },
        rendererMemory: {
          geometries: app.scene3d.renderer.info.memory.geometries,
          textures: app.scene3d.renderer.info.memory.textures,
        },
      };
    });
  }

  // --- idle baseline ---------------------------------------------------------------
  await page.screenshot({ path: `${OUT}/idle-fixed-camera.png` });
  const idle = await captureFrameSamples('Idle clubhouse fixed cashier camera');
  idle.render = await renderSnapshot();
  idle.heap = await heapSnapshot({ collect: true });
  idle.listeners = await listenerSnapshot();

  // --- active register, same camera ------------------------------------------------
  const customer = await page.evaluate((items) => window.__fw.scene3d.clubhouse()
    .sendToCounter(items, 'card'), REPRESENTATIVE_CARD_ITEMS);
  await page.waitForFunction((expectedCount) => (
    window.__fw.scene3d.clubhouse().register.getTx()?.items.length === expectedCount
  ), REPRESENTATIVE_CARD_ITEMS.length, { timeout: 20000 });
  await page.evaluate(() => window.__qaPerf.ensureCustomerTiming());
  await resetProfiler();
  const firstActivation = await captureActivationWindow(() => page.keyboard.press('e'));
  firstActivation.ui = await readProfiler(firstActivation.durationMs);
  await page.waitForFunction(() => window.__fw.scene3d.clubhouse().register.isActive(), null, { timeout: 10000 });
  await page.waitForFunction(() => {
    const app = window.__fw;
    const ch = app.scene3d.clubhouse();
    return Math.hypot(
      app.scene3d.camera.position.x - (2.78 + ch.interior.position.x),
      app.scene3d.camera.position.z - (5.24 + ch.interior.position.z),
    ) < 0.025;
  }, null, { timeout: 10000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/active-register-fixed-camera.png` });
  const active = await captureFrameSamples('Active three-item physical register, scanning stage');
  active.render = await renderSnapshot();
  active.heap = await heapSnapshot({ collect: true });
  active.listeners = await listenerSnapshot();

  // --- representative checkout stages, driven through normal controls --------------
  // The idle/active pair above remains the matched comparison. These route captures
  // add workload evidence at the states that actually exercise the changed checkout
  // code; they are not substituted into the idle-versus-active deltas.
  const representativeStages = {};
  // The matched idle/active comparison above is the core deliverable and is already
  // captured. This normal-control checkout route adds supplementary per-stage workloads;
  // make it best-effort so an RNG barcode-rotation or swipe flake cannot discard the whole
  // capture and its report. Anything it fails to reach is simply absent from the stage table.
  let cashCustomer = null;
  let change = { due: 0, plan: {} };
  let cardRouteCompleted = false;
  let cashRouteCompleted = false;
  try {
  await scanAndStageCurrentOrder();
  await page.keyboard.press('t');
  await waitForTxStage('card-present');
  await page.waitForTimeout(900);
  const cardTerminal = await routeProject({ x: 2.05, y: 1.115, z: 3.88 });
  if (!cardTerminal.inView) throw new Error('Performance route card terminal was outside the cashier camera.');
  await page.mouse.click(cardTerminal.x, cardTerminal.y);
  await waitForTxStage('card-ready');
  await waitForCameraStable();

  // Sampling holds the pointer in CardSwiping for roughly three seconds. That is
  // useful workload evidence but intentionally outside the player's valid swipe
  // duration. Release it through the normal pointer path, wait for the terminal's
  // ordinary "swipe again" recovery, then perform up to five fresh physical swipes.
  // Treating the sampled hold as a payment attempt used to time out this route before
  // receipt/bagging/cash stages could be captured.
  {
    let top = null;
    let started = false;
    for (let startTry = 0; startTry < 3 && !started; startTry++) {
      const swipe = await page.evaluate(() => window.__fw.scene3d.clubhouse().register.swipeAt());
      top = await routeProject(swipe.top);
      const bottom = await routeProject(swipe.bot);
      if (!top.inView || !bottom.inView) {
        throw new Error('Performance route card swipe channel left the swipe camera.');
      }
      await page.mouse.move(top.x, top.y);
      await page.mouse.down();
      started = await page.waitForFunction(() => (
        window.__fw.scene3d.clubhouse().register.getFlow()?.state === 'CardSwiping'
      ), null, { timeout: 900 }).then(() => true).catch(() => false);
      if (!started) {
        await page.mouse.up();
        await page.waitForTimeout(80);
      }
    }
    if (!started) throw new Error('Performance route could not begin sampled card swipe.');
    representativeStages.cardSwipe = await captureRepresentativeStage(
      'card-swipe', 'Physical card held in the reader channel through normal pointer capture',
    );
    await page.mouse.up();
    await waitForTxStage('card-ready', 3000);
  }

  for (let attempt = 1; attempt <= 5; attempt++) {
    let top = null;
    let bottom = null;
    let started = false;
    for (let startTry = 0; startTry < 3 && !started; startTry++) {
      const swipe = await page.evaluate(() => window.__fw.scene3d.clubhouse().register.swipeAt());
      top = await routeProject(swipe.top);
      bottom = await routeProject(swipe.bot);
      if (!top.inView || !bottom.inView) {
        throw new Error('Performance route card swipe channel left the swipe camera.');
      }
      await page.mouse.move(top.x, top.y);
      await page.mouse.down();
      started = await page.waitForFunction(() => (
        window.__fw.scene3d.clubhouse().register.getFlow()?.state === 'CardSwiping'
      ), null, { timeout: 900 }).then(() => true).catch(() => false);
      if (!started) {
        await page.mouse.up();
        await page.waitForTimeout(80);
      }
    }
    if (!started) throw new Error(`Performance route could not begin card swipe ${attempt}.`);
    await moveMouseLine(top, bottom, 16, 12);
    await page.mouse.up();

    const landed = await page.waitForFunction(() => {
      const tx = window.__fw.scene3d.clubhouse().register.getTx();
      return !!tx && ['card-busy', 'card-declined', 'receipt'].includes(tx.stage);
    }, null, { timeout: 6000 }).then(() => true).catch(() => false);
    if (!landed) {
      await waitForTxStage('card-ready', 3000).catch(() => {});
      continue;
    }
    await waitForTxStage(['card-declined', 'receipt'], 14000);
    const stage = await page.evaluate(() => window.__fw.scene3d.clubhouse().register.getTx()?.stage);
    if (stage === 'receipt') break;
    const retryTerminal = await routeProject({ x: 2.05, y: 1.115, z: 3.88 });
    await page.mouse.click(retryTerminal.x, retryTerminal.y);
    await waitForTxStage('card-ready');
    await waitForCameraStable();
  }
  await waitForTxStage('receipt', 14000);
  await page.waitForFunction(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return !!tx?.receiptPrinted && !!window.__qaPerfRoute.kind('receipt', true);
  }, null, { timeout: 14000 });
  await waitForCameraStable();
  representativeStages.receipt = await captureRepresentativeStage(
    'receipt-ready', 'Printed physical receipt waiting at the printer',
  );

  const receipt = await routeKind('receipt', true);
  const receiptPixel = await routeProject(receipt);
  await page.mouse.move(receiptPixel.x, receiptPixel.y);
  await page.mouse.down();
  await waitForTxStage('bagging', 5000);
  await waitForCameraStable();
  const bagPoint = { x: 3.50, y: 1.17, z: 4.44 };
  const bagPixel = await routeProject(bagPoint);
  await moveMouseLine(receiptPixel, bagPixel, 18, 13);
  await page.mouse.up();
  await page.waitForFunction(() => !!window.__fw.scene3d.clubhouse().register.getTx()?.receiptPacked, null,
    { timeout: 6000 });
  representativeStages.bagging = await captureRepresentativeStage(
    'bagging', 'Physical shopping bag with packed receipt and products ready for bagging',
  );

  // Finish this fixture transaction so the later cash route is a genuine new order,
  // rather than a state mutation layered onto a card transaction.
  for (let guard = 0; guard < 12; guard++) {
    const pendingItems = await page.evaluate(() => window.__fw.scene3d.clubhouse().register
      .getTx()?.items.filter((item) => !item.bagged).map((item) => item.uid) || []);
    if (!pendingItems.length) break;
    const candidates = (await Promise.all(pendingItems.map(async (uid) => ({ uid, physical: await routeItem(uid) }))))
      .filter((entry) => entry.physical)
      .sort((a, b) => b.physical.z - a.physical.z);
    const candidate = candidates[guard % candidates.length];
    if (!candidate) throw new Error('Performance route could not find an unbagged product.');
    const from = await routeProject(candidate.physical);
    const to = await routeProject(bagPoint);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await moveMouseLine(from, to, 16, 13);
    await page.mouse.up();
    await page.waitForTimeout(120);
  }
  await page.waitForFunction(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return !!tx && tx.items.every((item) => item.bagged);
  }, null, { timeout: 6000 });
  await page.waitForTimeout(760);
  const bagHandles = [
    await routeNamed('ANCHOR_BagHandleFront'),
    await routeNamed('ANCHOR_BagHandleBack'),
    await routeNamed('BagHandleFrontPivot'),
    await routeNamed('BagHandleBackPivot'),
    await routeKind('bag'),
  ].filter(Boolean);
  let handlePixel = null;
  for (const handle of bagHandles) {
    const base = await routeProject(handle);
    for (const offset of [{ x: 0, y: 0 }, { x: -8, y: 0 }, { x: 8, y: 0 }, { x: 0, y: -8 }]) {
      const point = { x: base.x + offset.x, y: base.y + offset.y };
      await page.mouse.move(point.x, point.y);
      await page.mouse.down();
      const caught = await page.waitForFunction(() => (
        window.__fw.scene3d.clubhouse().register.getFlow()?.state === 'BagHandoff'
      ), null, { timeout: 700 }).then(() => true).catch(() => false);
      if (caught) {
        handlePixel = point;
        break;
      }
      await page.mouse.up();
    }
    if (handlePixel) break;
  }
  if (!handlePixel) throw new Error('Performance route could not grab the filled bag handles.');
  await waitForCameraStable();
  const customerPalm = await routeKind('palm');
  const palmPixel = await routeProject(customerPalm);
  await moveMouseLine(handlePixel, palmPixel, 20, 14);
  await page.mouse.up();
  await page.waitForFunction(() => !window.__fw.scene3d.clubhouse().register.hasTx(), null, { timeout: 12000 });
  cardRouteCompleted = true;
  // A completed handoff deliberately keeps the cashier camera active while the
  // paid customer takes their first departing steps. Wait for that normal post-sale
  // presentation and queue departure to finish before introducing the cash customer;
  // otherwise the next E is routed into the still-active prior mode and the new flow
  // remains at WaitingForCashier instead of entering a fresh scan session.
  await page.waitForFunction((paidCustomer) => {
    const ch = window.__fw.scene3d.clubhouse();
    const queue = typeof ch.checkoutQueue === 'function' ? ch.checkoutQueue() : [];
    const customers = typeof ch.customers === 'function' ? ch.customers() : [];
    return !ch.register.isActive()
      && queue.length === 0
      && !customers.some((entry) => entry.name === paidCustomer);
  }, customer, { timeout: 20000 });

  // Start a separate normal-control cash route and pause it only after the customer
  // tender has been deposited and the required change is physically selected.
  await page.evaluate((items) => {
    const app = window.__fw;
    app.state.shop.markup.accessories = 1.15;
    app.state.shop.markup.apparel = 1.15;
    for (const id of items) {
      app.state.shop.inventory[id].shelf = Math.max(10, app.state.shop.inventory[id].shelf || 0);
    }
    app.scene3d.clubhouse().rebuildStock();
  }, REPRESENTATIVE_CASH_ITEMS);
  cashCustomer = await page.evaluate((items) => window.__fw.scene3d.clubhouse()
    .sendToCounter(items, 'cash'), REPRESENTATIVE_CASH_ITEMS);
  await page.waitForFunction((expectedCount) => (
    window.__fw.scene3d.clubhouse().register.getTx()?.items.length === expectedCount
  ), REPRESENTATIVE_CASH_ITEMS.length, { timeout: 20000 });
  await page.keyboard.press('e');
  await page.waitForFunction(() => {
    const register = window.__fw.scene3d.clubhouse().register;
    return register.isActive()
      && ['EnteringCashierMode', 'WaitingForScan'].includes(register.getFlow()?.state);
  }, null, { timeout: 10000 });
  await waitForCameraStable();
  await scanAndStageCurrentOrder();
  await page.keyboard.press('t');
  await waitForTxStage('cash-tender');
  await page.waitForTimeout(950);
  const firstTender = await routeMoney('tender');
  if (!firstTender) throw new Error('Performance cash route did not present physical tender.');
  const firstTenderPixel = await routeProject(firstTender);
  await page.mouse.click(firstTenderPixel.x, firstTenderPixel.y);
  await waitForTxStage('cash-drawer');
  await page.keyboard.press('d');
  await page.waitForFunction(() => !!window.__fw.scene3d.clubhouse().register.getTx()?.drawerOpen, null,
    { timeout: 6000 });
  await waitForCameraStable();
  for (let guard = 0; guard < 24; guard++) {
    const piece = await routeMoney('tender');
    if (!piece) break;
    const slot = await routeMoney('drawer', piece.denom);
    if (!slot) throw new Error(`Performance cash route had no drawer compartment for ${piece.denom}.`);
    const from = await routeProject(piece);
    const to = await routeProject({ x: slot.x, y: 1.17, z: slot.z });
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await moveMouseLine(from, to, 16, 13);
    await page.mouse.up();
    await page.waitForTimeout(90);
  }
  await page.waitForFunction(() => !!window.__fw.scene3d.clubhouse().register.getTx()?.deposited, null,
    { timeout: 8000 });
  change = await page.evaluate(async () => {
    const registerSim = await import('/src/sim/register.js');
    const app = window.__fw;
    const tx = app.scene3d.clubhouse().register.getTx();
    const due = registerSim.changeDue(tx);
    return {
      due,
      plan: registerSim.makeChangeFrom(registerSim.drawerContents(tx, app.state.shop.drawer), due),
    };
  });
  if (change.due <= 0 || !change.plan) {
    throw new Error(`Performance cash route requires non-zero makeable change; got ${change.due}.`);
  }
  for (const [denom, count] of Object.entries(change.plan)) {
    for (let index = 0; index < count; index++) {
      const piece = await routeMoney('drawer', Number(denom));
      if (!piece) throw new Error(`Performance cash route lost visible ${denom} change.`);
      const point = await routeProject(piece);
      await page.mouse.click(point.x, point.y);
      await page.waitForTimeout(90);
    }
  }
  await waitForCameraStable();
  representativeStages.drawerChange = await captureRepresentativeStage(
    'drawer-change', 'Open physical drawer with customer change selected in the cashier hand',
  );
  const changePalm = await routeKind('palm');
  if (!changePalm) throw new Error('Performance cash route customer palm disappeared before change handoff.');
  const changePalmPixel = await routeProject(changePalm);
  await page.mouse.click(changePalmPixel.x, changePalmPixel.y);
  await waitForTxStage('receipt', 10000);
  await packAndHandoffForLeakProbe();
  await page.waitForFunction(() => !window.__fw.scene3d.clubhouse().register.isActive(), null,
    { timeout: 10000 });
  cashRouteCompleted = true;
  } catch (routeError) {
    const detail = `representative checkout route: ${routeError.message}`;
    routeErrors.push(detail);
    errors.push(detail);
    // Leave register mode cleanly so the interaction-stress probe starts from a known state.
    const routeWasActive = await page.evaluate(() => (
      !!window.__fw.scene3d.clubhouse().register.isActive()
    )).catch(() => false);
    if (routeWasActive) await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(400);
    await page.evaluate(() => {
      const reg = window.__fw.scene3d.clubhouse().register;
      if (reg.isActive && reg.isActive() && reg.leave) reg.leave();
    }).catch(() => {});
  }

  // --- ten completed transactions: heap/listener/transient-residue leak probe -------
  // The matched performance pair above remains the frame-budget comparison. This loop
  // answers a different production question: after ten complete physical sales, do the
  // register/customer/receipt/card/cash/bag paths return to the same quiescent shape?
  // Only customer spawning and fixture cleanup use QA helpers; every checkout action is
  // routed through the live keyboard, wheel, and canvas-pointer handlers.
  const pauseResume = page.getByRole('button', { name: 'Resume', exact: true });
  if (await pauseResume.isVisible().catch(() => false)) await pauseResume.click();
  await page.mouse.up().catch(() => {});
  const activeBeforeLeakProbe = await page.evaluate(() => (
    window.__fw.scene3d.clubhouse().register.isActive()
  )).catch(() => false);
  if (activeBeforeLeakProbe) await page.keyboard.press('Escape').catch(() => {});
  await page.evaluate((stockCount) => {
    const app = window.__fw;
    const ch = app.scene3d.clubhouse();
    if (typeof ch.setOrganicWalkins === 'function') ch.setOrganicWalkins(false);
    if (typeof ch.clearWalkins === 'function') ch.clearWalkins();
    app.state.shop.inventory.tees1.shelf = Math.max(
      stockCount + 4,
      app.state.shop.inventory.tees1.shelf || 0,
    );
    ch.rebuildStock();
  }, TRANSACTION_LEAK_COUNT);
  await page.waitForFunction(() => {
    const ch = window.__fw.scene3d.clubhouse();
    const customers = typeof ch.customers === 'function' ? ch.customers()
      : Array.isArray(ch.customers) ? ch.customers : [];
    return !ch.register.isActive() && !ch.register.hasTx() && customers.length === 0;
  }, null, { timeout: 12000 });
  await page.waitForTimeout(500);

  const transactionLeakStress = {
    targetTransactions: TRANSACTION_LEAK_COUNT,
    completedTransactions: 0,
    route: 'Ten one-item sales alternating card/cash, including physical scan, payment, receipt packing, product bagging, bag handoff, banking, register exit, and natural customer removal.',
    iterations: [],
    error: null,
  };
  transactionLeakStress.startedAt = new Date().toISOString();
  transactionLeakStress.residueBefore = await checkoutResidueSnapshot();
  transactionLeakStress.heapBefore = await heapSnapshot({ collect: true });
  transactionLeakStress.listenersBefore = await listenerSnapshot();
  const transactionLeakStarted = Date.now();
  try {
    for (let index = 0; index < TRANSACTION_LEAK_COUNT; index++) {
      const method = index % 2 === 0 ? 'card' : 'cash';
      const before = await checkoutResidueSnapshot();
      const customerName = await page.evaluate((payment) => (
        window.__fw.scene3d.clubhouse().sendToCounter(['tees1'], payment)
      ), method);
      if (!customerName) throw new Error(`transaction ${index + 1}: sendToCounter returned no customer.`);
      await page.waitForFunction((name) => {
        const ch = window.__fw.scene3d.clubhouse();
        const tx = ch.register.getTx();
        return !!tx && tx.items.length === 1 && ch.checkoutQueue()[0]?.name === name;
      }, customerName, { timeout: 20000 });
      await page.evaluate(() => window.__qaPerf.ensureCustomerTiming());

      await page.keyboard.press('e');
      await page.waitForFunction(() => window.__fw.scene3d.clubhouse().register.isActive(), null,
        { timeout: 10000 });
      await waitForCameraStable();
      await scanAndStageCurrentOrder();
      if (method === 'card') await completeCardPaymentForLeakProbe();
      else await completeCashPaymentForLeakProbe();
      await packAndHandoffForLeakProbe();
      await page.waitForFunction(() => !window.__fw.scene3d.clubhouse().register.isActive(), null,
        { timeout: 12000 });
      await page.waitForFunction((name) => {
        const ch = window.__fw.scene3d.clubhouse();
        const customers = typeof ch.customers === 'function' ? ch.customers()
          : Array.isArray(ch.customers) ? ch.customers : [];
        return !customers.some((customer) => customer.name === name);
      }, customerName, { timeout: 30000 });
      await page.waitForTimeout(300);

      const after = await checkoutResidueSnapshot();
      if (after.transactionHistory !== before.transactionHistory + 1) {
        throw new Error(`transaction ${index + 1}: history delta was ${after.transactionHistory - before.transactionHistory}.`);
      }
      if (after.salesUnits !== before.salesUnits + 1) {
        throw new Error(`transaction ${index + 1}: sales-unit delta was ${after.salesUnits - before.salesUnits}.`);
      }
      if (after.heldUnits !== before.heldUnits) {
        throw new Error(`transaction ${index + 1}: held units changed ${before.heldUnits} -> ${after.heldUnits}.`);
      }
      if (after.salesRevenue <= before.salesRevenue) {
        throw new Error(`transaction ${index + 1}: revenue did not increase (${before.salesRevenue} -> ${after.salesRevenue}).`);
      }
      if (!after.lastTicket || after.lastTicket.customer !== customerName
          || after.lastTicket.method !== method || after.lastTicket.items !== 1) {
        throw new Error(`transaction ${index + 1}: newest ticket did not match ${customerName}/${method}/1 item.`);
      }
      if (after.active || after.hasTx || after.customers || after.queue.length
          || after.tenderOrHandMoney || after.packingMotions) {
        throw new Error(`transaction ${index + 1}: transient checkout state remained after customer removal.`);
      }

      const iterationHeap = await heapSnapshot({ collect: true });
      const iterationListeners = await listenerSnapshot();
      transactionLeakStress.iterations.push({
        index: index + 1,
        method,
        customer: customerName,
        revenueDelta: round(after.salesRevenue - before.salesRevenue, 2),
        heapMiB: iterationHeap.jsHeapUsedMiB,
        listeners: iterationListeners.total,
        domElements: after.domElements,
        rendererMemory: after.rendererMemory,
        liveSceneResources: after.liveSceneResources,
      });
      transactionLeakStress.completedTransactions++;
    }
  } catch (leakError) {
    transactionLeakStress.error = leakError.message;
    errors.push(`ten-transaction leak probe: ${leakError.message}`);
  }
  transactionLeakStress.durationMs = Date.now() - transactionLeakStarted;
  // Always return to a quiescent fixture before the independent mode-cycle probe,
  // even when a physical gesture above exposed an incomplete transaction.
  await page.mouse.up().catch(() => {});
  const leakProbeWasActive = await page.evaluate(() => (
    window.__fw.scene3d.clubhouse().register.isActive()
  )).catch(() => false);
  if (leakProbeWasActive) await page.keyboard.press('Escape').catch(() => {});
  await page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse();
    if (typeof ch.clearWalkins === 'function') ch.clearWalkins();
  });
  await page.waitForFunction(() => {
    const ch = window.__fw.scene3d.clubhouse();
    const customers = typeof ch.customers === 'function' ? ch.customers()
      : Array.isArray(ch.customers) ? ch.customers : [];
    return !ch.register.isActive() && !ch.register.hasTx() && customers.length === 0;
  }, null, { timeout: 12000 });
  await page.waitForTimeout(500);
  transactionLeakStress.residueAfter = await checkoutResidueSnapshot();
  transactionLeakStress.heapAfter = await heapSnapshot({ collect: true });
  transactionLeakStress.listenersAfter = await listenerSnapshot();

  // --- repeated normal-control interaction stress ---------------------------------
  // Compare like with like: both listener snapshots must be taken with the same live
  // transaction and active register DOM. The old loop started inactive after a route
  // failure, so its first Escape opened the pause menu. That intentionally adds nine
  // click listeners plus one backdrop pointer listener and was falsely reported as a
  // +10 register leak even though no listener accumulated on later cycles.
  if (await pauseResume.isVisible().catch(() => false)) await pauseResume.click();
  const stressStateSnapshot = () => page.evaluate(() => {
    const register = window.__fw.scene3d.clubhouse().register;
    return {
      active: register.isActive(),
      hasTx: register.hasTx(),
      flow: register.getFlow()?.state || null,
      stage: register.getTx()?.stage || null,
    };
  });
  async function enterStressRegister(label) {
    const attempts = [];
    for (let attempt = 1; attempt <= 3; attempt++) {
      await page.waitForTimeout(80);
      await page.keyboard.press('e');
      const ready = await page.waitForFunction(() => {
        const register = window.__fw.scene3d.clubhouse().register;
        return register.isActive() && register.getFlow()?.state === 'WaitingForScan';
      }, null, { timeout: 3000 }).then(() => true).catch(() => false);
      const state = await stressStateSnapshot().catch(() => null);
      attempts.push({ attempt, state });
      if (!ready) continue;
      await waitForCameraStable();
      return;
    }
    throw new Error(`${label}: normal E input never reached WaitingForScan; attempts=${JSON.stringify(attempts)}`);
  }
  async function leaveStressRegister(label) {
    await page.keyboard.press('Escape');
    const left = await page.waitForFunction(() => !window.__fw.scene3d.clubhouse().register.isActive(), null,
      { timeout: 8000 }).then(() => true).catch(() => false);
    if (left) return;
    const state = await stressStateSnapshot().catch(() => null);
    throw new Error(`${label}: Escape did not leave register mode; state=${JSON.stringify(state)}`);
  }
  let stressHeapBefore = null;
  let stressListenersBefore = null;
  let stressHeapAfter = null;
  let stressListenersAfter = null;
  let stressStarted = null;
  let stressDurationMs = 0;
  let interactionStressError = null;
  let stressUi = {
    source: 'Unavailable because the interaction-stress route did not complete.',
    durationMs: 0,
    posRedraws: null,
    posRedrawsPerSecond: null,
    terminalRedraws: null,
    terminalRedrawsPerSecond: null,
    registerHintMutations: null,
    registerHintMutationsPerSecond: null,
    inputEvents: {},
    cpuTiming: {},
  };
  try {
  let stressState = await page.evaluate(() => {
    const reg = window.__fw.scene3d.clubhouse().register;
    return { active: reg.isActive(), hasTx: reg.hasTx(), flow: reg.getFlow()?.state || null };
  });
  if (!stressState.hasTx) {
    if (stressState.active) {
      await page.waitForFunction(() => !window.__fw.scene3d.clubhouse().register.isActive(), null,
        { timeout: 7000 });
    }
    await page.evaluate(() => {
      const app = window.__fw;
      const ch = app.scene3d.clubhouse();
      app.state.shop.inventory.tees1.shelf = Math.max(10, app.state.shop.inventory.tees1.shelf || 0);
      ch.rebuildStock();
      const customerName = ch.sendToCounter(['tees1'], 'card');
      const customers = typeof ch.customers === 'function' ? ch.customers() : [];
      const customer = customers.find((entry) => entry.name === customerName);
      if (customer) customer.patience = 300;
    });
    await page.waitForFunction(() => window.__fw.scene3d.clubhouse().register.hasTx(), null,
      { timeout: 20000 });
    stressState = { active: false, hasTx: true };
  }
  if (!stressState.active || stressState.flow !== 'WaitingForScan') {
    if (stressState.active) await leaveStressRegister('interaction normalization leave');
    await enterStressRegister('interaction normalization enter');
  }
  // Normalize any interrupted drawer/swipe state before the baseline. Subsequent
  // cycles now begin and end at the same recovered checkout checkpoint.
  await leaveStressRegister('interaction baseline leave');
  await enterStressRegister('interaction baseline enter');
  await resetProfiler();
  stressHeapBefore = await heapSnapshot({ collect: true });
  stressListenersBefore = await listenerSnapshot();
  stressStarted = Date.now();
  for (let cycle = 0; cycle < INTERACTION_CYCLES; cycle++) {
    await leaveStressRegister(`interaction cycle ${cycle + 1} leave`);
    await enterStressRegister(`interaction cycle ${cycle + 1} enter`);
  }
  // One physical item click exercises routed pointer input as well as the mode cycle.
  const itemPixel = await page.evaluate(async () => {
    const THREE = await import('/vendor/three.module.js');
    const app = window.__fw;
    const items = [];
    app.scene3d.clubhouse().interior.traverse((object) => {
      if (object.visible && object.userData?.kind === 'item') items.push(object);
    });
    if (!items.length) return null;
    const centre = new THREE.Box3().setFromObject(items[0]).getCenter(new THREE.Vector3());
    centre.project(app.scene3d.camera);
    const rect = document.querySelector('canvas').getBoundingClientRect();
    return {
      x: rect.left + (centre.x + 1) * rect.width / 2,
      y: rect.top + (-centre.y + 1) * rect.height / 2,
    };
  });
  if (itemPixel) {
    await page.mouse.move(itemPixel.x, itemPixel.y);
    await page.mouse.down();
    await page.mouse.up();
  }
  await page.waitForTimeout(300);
  stressDurationMs = Date.now() - stressStarted;
  stressUi = await readProfiler(stressDurationMs);
  stressHeapAfter = await heapSnapshot({ collect: true });
  stressListenersAfter = await listenerSnapshot();
  } catch (stressError) {
    interactionStressError = stressError.message;
    errors.push(`interaction-stress probe: ${stressError.message}`);
    await page.mouse.up().catch(() => {});
    stressDurationMs = stressStarted ? Date.now() - stressStarted : 0;
    if (stressStarted) {
      stressUi = await readProfiler(Math.max(1, stressDurationMs)).catch(() => stressUi);
      stressHeapAfter = await heapSnapshot({ collect: true }).catch(() => null);
      stressListenersAfter = await listenerSnapshot().catch(() => null);
    }
  }

  const pct = (from, to) => from ? round((to - from) / from * 100) : null;
  const delta = (from, to, places = 2) => round(to - from, places);
  const comparison = {
    avgFps: {
      idle: idle.aggregate.avgFps, active: active.aggregate.avgFps,
      delta: delta(idle.aggregate.avgFps, active.aggregate.avgFps),
      deltaPct: pct(idle.aggregate.avgFps, active.aggregate.avgFps),
    },
    onePercentLowFps: {
      idle: idle.aggregate.onePercentLowFps, active: active.aggregate.onePercentLowFps,
      delta: delta(idle.aggregate.onePercentLowFps, active.aggregate.onePercentLowFps),
      deltaPct: pct(idle.aggregate.onePercentLowFps, active.aggregate.onePercentLowFps),
    },
    worstFrameMs: {
      idle: idle.aggregate.worstFrameMs, active: active.aggregate.worstFrameMs,
      delta: delta(idle.aggregate.worstFrameMs, active.aggregate.worstFrameMs, 3),
      deltaPct: pct(idle.aggregate.worstFrameMs, active.aggregate.worstFrameMs),
    },
    drawCalls: {
      idle: idle.render.drawCalls, active: active.render.drawCalls,
      delta: delta(idle.render.drawCalls, active.render.drawCalls, 0),
      deltaPct: pct(idle.render.drawCalls, active.render.drawCalls),
    },
    renderedTriangles: {
      idle: idle.render.renderedTriangles, active: active.render.renderedTriangles,
      delta: delta(idle.render.renderedTriangles, active.render.renderedTriangles, 0),
      deltaPct: pct(idle.render.renderedTriangles, active.render.renderedTriangles),
    },
    uniqueVisibleMaterials: {
      idle: idle.render.uniqueVisibleMaterials, active: active.render.uniqueVisibleMaterials,
      delta: delta(idle.render.uniqueVisibleMaterials, active.render.uniqueVisibleMaterials, 0),
      deltaPct: pct(idle.render.uniqueVisibleMaterials, active.render.uniqueVisibleMaterials),
    },
    estimatedVisibleTextureMiB: {
      idle: idle.render.estimatedVisibleTextureMiB, active: active.render.estimatedVisibleTextureMiB,
      delta: delta(idle.render.estimatedVisibleTextureMiB, active.render.estimatedVisibleTextureMiB, 3),
      deltaPct: pct(idle.render.estimatedVisibleTextureMiB, active.render.estimatedVisibleTextureMiB),
    },
    jsHeapUsedMiB: {
      idle: idle.heap.jsHeapUsedMiB, active: active.heap.jsHeapUsedMiB,
      delta: delta(idle.heap.jsHeapUsedMiB, active.heap.jsHeapUsedMiB, 3),
      deltaPct: pct(idle.heap.jsHeapUsedMiB, active.heap.jsHeapUsedMiB),
    },
    listeners: {
      idle: idle.listeners.total, active: active.listeners.total,
      delta: delta(idle.listeners.total, active.listeners.total, 0),
      deltaPct: pct(idle.listeners.total, active.listeners.total),
    },
  };
  const robustComparison = {
    source: 'Median of five independent per-scene samples; informational companion to the unchanged pooled-frame gates.',
    avgFps: {
      idle: idle.aggregate.sampleDistributions.avgFps.median,
      active: active.aggregate.sampleDistributions.avgFps.median,
    },
    onePercentLowFps: {
      idle: idle.aggregate.sampleDistributions.onePercentLowFps.median,
      active: active.aggregate.sampleDistributions.onePercentLowFps.median,
    },
    p99FrameMs: {
      idle: idle.aggregate.sampleDistributions.p99FrameMs.median,
      active: active.aggregate.sampleDistributions.p99FrameMs.median,
    },
    worstFrameMs: {
      idle: idle.aggregate.sampleDistributions.worstFrameMs.median,
      active: active.aggregate.sampleDistributions.worstFrameMs.median,
    },
  };
  for (const metric of Object.values(robustComparison)) {
    if (!metric || typeof metric !== 'object' || !Object.hasOwn(metric, 'idle')) continue;
    metric.delta = delta(metric.idle, metric.active, 3);
    metric.deltaPct = pct(metric.idle, metric.active);
  }

  const interactionStressComplete = !interactionStressError
    && !!stressHeapBefore && !!stressHeapAfter && !!stressListenersBefore && !!stressListenersAfter;
  const listenerGrowth = interactionStressComplete
    ? stressListenersAfter.total - stressListenersBefore.total
    : null;
  const heapGrowthMiB = interactionStressComplete
    ? round(stressHeapAfter.jsHeapUsedMiB - stressHeapBefore.jsHeapUsedMiB, 3)
    : null;
  const transactionHeapGrowthMiB = round(
    transactionLeakStress.heapAfter.jsHeapUsedMiB - transactionLeakStress.heapBefore.jsHeapUsedMiB,
    3,
  );
  const transactionListenerGrowth = transactionLeakStress.listenersAfter.total
    - transactionLeakStress.listenersBefore.total;
  const transactionDomGrowth = transactionLeakStress.residueAfter.domElements
    - transactionLeakStress.residueBefore.domElements;
  const transactionRendererGeometryGrowth = transactionLeakStress.residueAfter.rendererMemory.geometries
    - transactionLeakStress.residueBefore.rendererMemory.geometries;
  const transactionRendererTextureGrowth = transactionLeakStress.residueAfter.rendererMemory.textures
    - transactionLeakStress.residueBefore.rendererMemory.textures;
  const transactionLiveGeometryGrowth = transactionLeakStress.residueAfter.liveSceneResources.geometries
    - transactionLeakStress.residueBefore.liveSceneResources.geometries;
  const transactionLiveMaterialGrowth = transactionLeakStress.residueAfter.liveSceneResources.materials
    - transactionLeakStress.residueBefore.liveSceneResources.materials;
  const transactionLiveTextureGrowth = transactionLeakStress.residueAfter.liveSceneResources.textures
    - transactionLeakStress.residueBefore.liveSceneResources.textures;
  // The first card and first cash sale can legitimately populate renderer caches for
  // branch-specific assets. Leak gating therefore uses the slope after both branches
  // have run (iteration 2 -> iteration 10), while still reporting total baseline growth.
  const transactionResourceTailStart = transactionLeakStress.iterations[1] || null;
  const transactionResourceTailEnd = transactionLeakStress.iterations.at(-1) || null;
  const transactionRendererGeometryTailGrowth = transactionResourceTailStart && transactionResourceTailEnd
    ? transactionResourceTailEnd.rendererMemory.geometries
      - transactionResourceTailStart.rendererMemory.geometries
    : null;
  const transactionRendererTextureTailGrowth = transactionResourceTailStart && transactionResourceTailEnd
    ? transactionResourceTailEnd.rendererMemory.textures
      - transactionResourceTailStart.rendererMemory.textures
    : null;
  const transientKindCount = (snapshot, kind) => Number(snapshot.kinds[kind] || 0);
  const transactionResidueClear = !transactionLeakStress.residueAfter.active
    && !transactionLeakStress.residueAfter.hasTx
    && transactionLeakStress.residueAfter.customers === 0
    && transactionLeakStress.residueAfter.queue.length === 0
    && transactionLeakStress.residueAfter.heldUnits === transactionLeakStress.residueBefore.heldUnits
    && transactionLeakStress.residueAfter.tenderOrHandMoney === 0
    && transactionLeakStress.residueAfter.packingMotions === 0
    && ['receipt', 'payment-card', 'bag', 'palm'].every((kind) => (
      transientKindCount(transactionLeakStress.residueAfter, kind)
        === transientKindCount(transactionLeakStress.residueBefore, kind)
    ))
    && transactionDomGrowth <= 0;
  const transactionRendererResourcesStable = transactionRendererGeometryTailGrowth != null
    && transactionRendererTextureTailGrowth != null
    && transactionRendererGeometryTailGrowth <= 0
    && transactionRendererTextureTailGrowth <= 0
    && transactionLiveGeometryGrowth <= 0
    && transactionLiveMaterialGrowth <= 0
    && transactionLiveTextureGrowth <= 0;
  Object.assign(transactionLeakStress, {
    heapGrowthMiB: transactionHeapGrowthMiB,
    listenerGrowth: transactionListenerGrowth,
    domGrowth: transactionDomGrowth,
    rendererMemoryGrowth: {
      geometries: transactionRendererGeometryGrowth,
      textures: transactionRendererTextureGrowth,
    },
    rendererMemoryTailGrowthAfterBothBranchesWarm: {
      fromIteration: transactionResourceTailStart?.index || null,
      toIteration: transactionResourceTailEnd?.index || null,
      geometries: transactionRendererGeometryTailGrowth,
      textures: transactionRendererTextureTailGrowth,
    },
    liveSceneResourceGrowth: {
      geometries: transactionLiveGeometryGrowth,
      materials: transactionLiveMaterialGrowth,
      textures: transactionLiveTextureGrowth,
    },
    residueClear: transactionResidueClear,
    rendererResourcesStable: transactionRendererResourcesStable,
  });
  const idleFpsCvPct = round(idle.aggregate.sampleAvgFpsStdDev / idle.aggregate.avgFps * 100, 3);
  const activeFpsCvPct = round(active.aggregate.sampleAvgFpsStdDev / active.aggregate.avgFps * 100, 3);
  // A single OS/GPU scheduling interruption can invert the idle/active comparison.
  // Treat such a run as evidence of instability, never as a clean performance pass.
  const captureStable = idleFpsCvPct <= 5 && activeFpsCvPct <= 5
    && idle.aggregate.worstFrameMs <= 100 && active.aggregate.worstFrameMs <= 100;
  const activationStable = firstActivation.summary.worstFrameMs <= 100;
  const capturedRepresentativeStages = Object.keys(representativeStages);
  const missingCardStages = REPRESENTATIVE_STAGE_REQUIREMENTS.card
    .filter((key) => !Object.hasOwn(representativeStages, key));
  const missingCashStages = REPRESENTATIVE_STAGE_REQUIREMENTS.cash
    .filter((key) => !Object.hasOwn(representativeStages, key));
  const stageStateValid = {
    cardSwipe: representativeStages.cardSwipe?.state.flow === 'CardSwiping'
      && representativeStages.cardSwipe?.state.method === 'card',
    receipt: representativeStages.receipt?.state.flow === 'ReceiptPrinting'
      && representativeStages.receipt?.state.method === 'card'
      && representativeStages.receipt?.state.receiptPrinted === true,
    bagging: representativeStages.bagging?.state.flow === 'Bagging'
      && representativeStages.bagging?.state.method === 'card'
      && representativeStages.bagging?.state.receiptPacked === true,
    // The sampled drawer workload is captured after denomination selection and
    // before the selected bills are placed in the customer's hand. GivingChange
    // starts only after that placement, so SelectingChange is the live expected flow.
    drawerChange: representativeStages.drawerChange?.state.flow === 'SelectingChange'
      && representativeStages.drawerChange?.state.method === 'cash'
      && representativeStages.drawerChange?.state.drawerOpen === true
      && representativeStages.drawerChange?.state.deposited === true
      && representativeStages.drawerChange?.state.selectedChangeTotal > 0,
  };
  const representativeCardStagesValid = cardRouteCompleted && missingCardStages.length === 0
    && REPRESENTATIVE_STAGE_REQUIREMENTS.card.every((key) => stageStateValid[key]);
  const representativeCashStagesValid = cashRouteCompleted && missingCashStages.length === 0
    && REPRESENTATIVE_STAGE_REQUIREMENTS.cash.every((key) => stageStateValid[key]);
  const representativeStagesComplete = representativeCardStagesValid && representativeCashStagesValid;
  const representativeStageTailStable = representativeStagesComplete
    && REQUIRED_REPRESENTATIVE_STAGES.every((key) => representativeStages[key].aggregate.worstFrameMs <= 100);
  const gates = {
    rationale: 'No repository budgets exist. Proposed feature-overhead gates: each scene sample-FPS CV <=5% and worst frame <=100 ms for a valid capture; all named card/receipt/bagging/cash representative stages must be captured through normal controls with no route, console/page, or non-benign request failures, and every representative stage must remain <=100 ms worst-frame; avg FPS <=10% loss; 1% low <=15% loss; worst frame <=25% increase when delta exceeds 5 ms; draw calls <=20% increase; triangles/materials <=25% increase; ten complete physical sales must finish with <=15 MiB post-GC heap growth, zero listener/transient-state growth, no positive DOM growth, no renderer-memory growth after both payment branches are warm, and no live-scene resource growth; the independent mode-cycle probe also requires <=15 MiB heap and zero listeners; static register UI <=1 redraw/mutation per second.',
    sampleStability: captureStable,
    firstActivationHitch: activationStable,
    representativeCardStages: representativeCardStagesValid,
    representativeCashStages: representativeCashStagesValid,
    representativeStageTail: representativeStageTailStable,
    representativeRouteErrors: routeErrors.length === 0,
    consolePageErrors: runtimeErrors.length === 0,
    nonBenignRequestFailures: nonBenignRequestFailures.length === 0,
    avgFps: comparison.avgFps.deltaPct >= -10,
    onePercentLowFps: comparison.onePercentLowFps.deltaPct >= -15,
    worstFrameMs: comparison.worstFrameMs.delta <= 5 || comparison.worstFrameMs.deltaPct <= 25,
    drawCalls: comparison.drawCalls.deltaPct <= 20,
    renderedTriangles: comparison.renderedTriangles.deltaPct <= 25,
    uniqueVisibleMaterials: comparison.uniqueVisibleMaterials.deltaPct <= 25,
    tenTransactionCompletion: transactionLeakStress.completedTransactions === TRANSACTION_LEAK_COUNT
      && !transactionLeakStress.error,
    transactionHeap: transactionHeapGrowthMiB <= 15,
    transactionListeners: transactionListenerGrowth === 0,
    transactionResidue: transactionResidueClear,
    transactionRendererResources: transactionRendererResourcesStable,
    interactionStressCompletion: interactionStressComplete,
    interactionHeap: interactionStressComplete && heapGrowthMiB <= 15,
    interactionListeners: interactionStressComplete && listenerGrowth === 0,
    staticUi: active.ui.posRedrawsPerSecond <= 1
      && active.ui.terminalRedrawsPerSecond <= 1
      && active.ui.registerHintMutationsPerSecond <= 1,
  };
  const failedGates = Object.entries(gates)
    .filter(([key, passed]) => key !== 'rationale' && passed === false)
    .map(([key]) => key);
  const evidenceGateKeys = new Set([
    'sampleStability',
    'representativeCardStages',
    'representativeCashStages',
    'representativeRouteErrors',
    'consolePageErrors',
    'nonBenignRequestFailures',
    'tenTransactionCompletion',
    'interactionStressCompletion',
  ]);
  const evidenceIncompleteGates = failedGates.filter((key) => evidenceGateKeys.has(key));
  const performanceFailedGates = failedGates.filter((key) => !evidenceGateKeys.has(key));
  const likelyRegression = evidenceIncompleteGates.length ? null : performanceFailedGates.length > 0;

  const result = {
    generatedAt: new Date().toISOString(),
    protocol: {
      buildMode: 'localhost development build at http://localhost:8457/',
      runner: 'tools/qa/run-playwright.cjs --bootstrap, isolated Chrome context',
      viewport: '1600x900 CSS pixels, device scale factor 1',
      scenarios: 'Idle clubhouse and active three-item card checkout use the exact same 2 PM cashier camera, FOV, save fixture, stock, weather, and paused game clock. The normal keyboard/mouse route completes that card sale and a separate three-item cash sale while capturing card swipe, receipt, bagging, and open-drawer/change workloads. A separate ten-sale normal-control loop alternates card/cash and waits for each paid customer to leave before measuring leaks.',
      warmupMs: WARMUP_MS,
      explicitGcSettleMs: GC_SETTLE_MS,
      sampleCount: SAMPLE_COUNT,
      sampleDurationMs: SAMPLE_MS,
      representativeStageSampleCount: STAGE_SAMPLE_COUNT,
      representativeStageSampleDurationMs: STAGE_SAMPLE_MS,
      representativeStageWarmupMs: STAGE_WARMUP_MS,
      frameMetricDefinition: 'Average FPS = sampled rAF frames / elapsed frame time. 1% low FPS = 1000 / mean duration of slowest ceil(1%) frames. Worst frame is maximum sampled rAF delta.',
      outlierPolicy: 'All frames and samples remain in pooled results and gates. Median/MAD tail labels are descriptive follow-up flags only and never exclude an outlier.',
    },
    environment,
    customer,
    cashCustomer,
    idle,
    active,
    comparison,
    robustComparison,
    firstActivation,
    representativeStages,
    representativeRoute: {
      controls: 'Playwright keyboard, wheel, pointer down/move/up/click routed through the live game canvas; no transaction-stage mutation or renderer action hook.',
      cardCustomer: customer,
      cardExpectedItems: [...REPRESENTATIVE_CARD_ITEMS],
      cashCustomer,
      cashExpectedItems: [...REPRESENTATIVE_CASH_ITEMS],
      cashChangeDue: change.due,
      cashChangePlan: change.plan,
      requiredStages: REQUIRED_REPRESENTATIVE_STAGES,
      capturedStages: capturedRepresentativeStages,
      complete: representativeStagesComplete,
      errors: routeErrors,
      card: {
        required: REPRESENTATIVE_STAGE_REQUIREMENTS.card,
        captured: REPRESENTATIVE_STAGE_REQUIREMENTS.card.filter((key) => capturedRepresentativeStages.includes(key)),
        missing: missingCardStages,
        stateValid: Object.fromEntries(REPRESENTATIVE_STAGE_REQUIREMENTS.card
          .map((key) => [key, !!stageStateValid[key]])),
        completed: cardRouteCompleted,
      },
      cash: {
        required: REPRESENTATIVE_STAGE_REQUIREMENTS.cash,
        captured: REPRESENTATIVE_STAGE_REQUIREMENTS.cash.filter((key) => capturedRepresentativeStages.includes(key)),
        missing: missingCashStages,
        stateValid: Object.fromEntries(REPRESENTATIVE_STAGE_REQUIREMENTS.cash
          .map((key) => [key, !!stageStateValid[key]])),
        completed: cashRouteCompleted,
      },
      completedCardSaleBeforeCashFixture: cardRouteCompleted,
      completedCashSale: cashRouteCompleted,
    },
    transactionLeakStress,
    interactionStress: {
      cycles: INTERACTION_CYCLES,
      route: 'Escape leaves register, E re-enters it, repeated through normal keyboard routing; final item click uses normal pointer routing.',
      durationMs: stressDurationMs,
      ui: stressUi,
      error: interactionStressError,
      heapBefore: stressHeapBefore,
      heapAfter: stressHeapAfter,
      heapGrowthMiB,
      listenersBefore: stressListenersBefore,
      listenersAfter: stressListenersAfter,
      listenerGrowth,
    },
    stability: {
      captureStable,
      activationStable,
      representativeStagesComplete,
      representativeStageTailStable,
      idleSampleFpsCvPct: idleFpsCvPct,
      activeSampleFpsCvPct: activeFpsCvPct,
      idleTail: idle.aggregate.tailStability,
      activeTail: active.aggregate.tailStability,
      rule: 'Both matched sample-FPS coefficients of variation must be <=5%; neither matched scene, the cold activation window, nor any representative stage may contain a >100 ms frame.',
    },
    gates,
    failedGates,
    evidenceIncompleteGates,
    performanceFailedGates,
    likelyRegression,
    likelyCauseInference: [
      'Median/MAD and per-sample slow-frame counts distinguish a repeated tail from an isolated candidate, but every candidate remains included in the gate.',
      'registerUpdateIncludingCashierHandIk and activeCustomerCharacterAnimation are explicit wall-clock wrappers around the live update calls; they localize CPU cost only to those call boundaries and are not a browser CPU profile.',
      'If frame tails rise without corresponding update-call maxima, host scheduling, browser compositing, or GPU work remains a follow-up hypothesis rather than an attributed cause.',
    ],
    errors,
    runtimeErrors,
    routeErrors,
    nonBenignRequestFailures,
    limitations: [
      'Idle versus active is a matched feature-overhead comparison, not a historical pre-change versus post-change benchmark.',
      'WebGL does not expose exact GPU texture allocation; texture MiB is an explicit RGBA8+mipmap estimate.',
      'CDP listener enumeration covers window, document, and current DOM Elements; listeners on inaccessible non-DOM EventTargets are unmeasured.',
      'Headless Chrome rAF timing is useful for matched regression checks but is not a substitute for a headed target-hardware capture.',
    ],
  };

  const value = (metric, suffix = '') => metric == null ? 'unavailable' : `${metric}${suffix}`;
  const deltaCell = (metric, suffix = '') => `${metric.delta >= 0 ? '+' : ''}${value(metric.delta, suffix)} (${metric.deltaPct >= 0 ? '+' : ''}${value(metric.deltaPct, '%')})`;
  const gateCell = (key) => gates[key] ? 'PASS' : 'FAIL';
  const tailRows = [
    ...idle.samples.map((sample) => ['Idle', sample]),
    ...active.samples.map((sample) => ['Active', sample]),
  ].map(([scene, sample]) => `| ${scene} ${sample.index} | ${sample.summary.avgFps} | ${sample.summary.onePercentLowFps} | ${sample.summary.p99FrameMs} | ${sample.summary.worstFrameMs} | ${sample.summary.framesOver33Ms} / ${sample.summary.framesOver50Ms} / ${sample.summary.framesOver100Ms} | ${sample.tailStable ? 'PASS' : 'FAIL'} |`).join('\n');
  const stageRows = Object.entries(representativeStages).map(([key, stage]) => {
    const registerCpu = stage.ui.cpuTiming.registerUpdateIncludingCashierHandIk;
    const customerCpu = stage.ui.cpuTiming.activeCustomerCharacterAnimation;
    return `| ${key} (${stage.state.flow || stage.state.transactionStage}) | ${stage.aggregate.avgFps} | ${stage.aggregate.sampleDistributions.avgFps.median} | ${stage.aggregate.onePercentLowFps} | ${stage.aggregate.sampleDistributions.onePercentLowFps.median} | ${stage.aggregate.worstFrameMs} | ${registerCpu.meanCallMs} / ${customerCpu.meanCallMs} | [image](./${stage.screenshot}) |`;
  }).join('\n');
  const transactionLeakRows = transactionLeakStress.iterations.map((iteration) => (
    `| ${iteration.index} | ${iteration.method} | ${iteration.customer} | $${iteration.revenueDelta.toFixed(2)} | ${iteration.heapMiB} | ${iteration.listeners} | ${iteration.domElements} | ${iteration.rendererMemory.geometries} / ${iteration.rendererMemory.textures} | ${iteration.liveSceneResources.geometries} / ${iteration.liveSceneResources.materials} / ${iteration.liveSceneResources.textures} |`
  )).join('\n');
  const report = `# Cash-register performance capture

Generated: ${result.generatedAt}

This is a matched current-build feature-overhead capture: the idle clubhouse is the baseline and the active three-item physical register is the comparison. It is not a historical before/after code benchmark.

## Protocol

- Chrome ${environment.browserVersion}, ${environment.viewport.width}x${environment.viewport.height}, DPR ${environment.devicePixelRatio}
- GPU: ${environment.webglRenderer}
- Fixture: ${environment.fixture}
- ${SAMPLE_COUNT} x ${SAMPLE_MS / 1000}-second rAF samples per matched scene
- Before **both** matched scenes: explicit GC, ${GC_SETTLE_MS} ms settle, two rAF boundaries, then ${WARMUP_MS / 1000}-second warm-up
- Representative stages: ${STAGE_SAMPLE_COUNT} x ${STAGE_SAMPLE_MS}-ms samples after a short explicit-GC/settle; they supplement rather than replace the matched comparison
- Representative route fixtures: card ${REPRESENTATIVE_CARD_ITEMS.length} items (${REPRESENTATIVE_CARD_ITEMS.join(', ')}); cash ${REPRESENTATIVE_CASH_ITEMS.length} items (${REPRESENTATIVE_CASH_ITEMS.join(', ')})
- Average FPS = sampled frames / elapsed time; 1% low = inverse mean of slowest 1% frame durations
- All raw frames remain pooled. Per-sample medians/MADs and isolated-tail candidate labels do not remove or discount outliers.
- Proposed gates: ${gates.rationale}
- Matched capture stability: ${captureStable ? 'PASS' : 'FAIL'} (idle FPS CV ${idleFpsCvPct}%, active FPS CV ${activeFpsCvPct}%)
- Cold first activation: ${gateCell('firstActivationHitch')} (${firstActivation.summary.worstFrameMs} ms worst; preserved separately from warm-up)
- Representative card stages: ${gateCell('representativeCardStages')} (required ${REPRESENTATIVE_STAGE_REQUIREMENTS.card.join(', ')}; captured ${REPRESENTATIVE_STAGE_REQUIREMENTS.card.filter((key) => capturedRepresentativeStages.includes(key)).join(', ') || 'none'}; missing ${missingCardStages.join(', ') || 'none'}; completed sale ${cardRouteCompleted ? 'yes' : 'no'})
- Representative cash stages: ${gateCell('representativeCashStages')} (required ${REPRESENTATIVE_STAGE_REQUIREMENTS.cash.join(', ')}; captured ${REPRESENTATIVE_STAGE_REQUIREMENTS.cash.filter((key) => capturedRepresentativeStages.includes(key)).join(', ') || 'none'}; missing ${missingCashStages.join(', ') || 'none'}; completed sale ${cashRouteCompleted ? 'yes' : 'no'})
- Representative-stage tail gate: ${gateCell('representativeStageTail')}
- Representative-route errors: ${routeErrors.length ? routeErrors.join(' | ') : 'none'} (${gateCell('representativeRouteErrors')})
- Console/page errors: ${runtimeErrors.length ? runtimeErrors.join(' | ') : 'none'} (${gateCell('consolePageErrors')})
- Non-benign request failures: ${nonBenignRequestFailures.length ? nonBenignRequestFailures.join(' | ') : 'none'} (${gateCell('nonBenignRequestFailures')})

## Matched results

| Metric | Idle baseline | Active register | Delta | Gate |
|---|---:|---:|---:|---|
| Average FPS | ${value(comparison.avgFps.idle)} | ${value(comparison.avgFps.active)} | ${deltaCell(comparison.avgFps)} | ${gateCell('avgFps')} |
| 1% low FPS | ${value(comparison.onePercentLowFps.idle)} | ${value(comparison.onePercentLowFps.active)} | ${deltaCell(comparison.onePercentLowFps)} | ${gateCell('onePercentLowFps')} |
| Worst frame | ${value(comparison.worstFrameMs.idle, ' ms')} | ${value(comparison.worstFrameMs.active, ' ms')} | ${deltaCell(comparison.worstFrameMs, ' ms')} | ${gateCell('worstFrameMs')} |
| Draw calls / composed frame | ${value(comparison.drawCalls.idle)} | ${value(comparison.drawCalls.active)} | ${deltaCell(comparison.drawCalls)} | ${gateCell('drawCalls')} |
| Rendered triangles / frame | ${value(comparison.renderedTriangles.idle)} | ${value(comparison.renderedTriangles.active)} | ${deltaCell(comparison.renderedTriangles)} | ${gateCell('renderedTriangles')} |
| Unique visible materials | ${value(comparison.uniqueVisibleMaterials.idle)} | ${value(comparison.uniqueVisibleMaterials.active)} | ${deltaCell(comparison.uniqueVisibleMaterials)} | ${gateCell('uniqueVisibleMaterials')} |
| Estimated visible textures | ${value(comparison.estimatedVisibleTextureMiB.idle, ' MiB')} | ${value(comparison.estimatedVisibleTextureMiB.active, ' MiB')} | ${deltaCell(comparison.estimatedVisibleTextureMiB, ' MiB')} | informational |
| Post-GC JS heap | ${value(comparison.jsHeapUsedMiB.idle, ' MiB')} | ${value(comparison.jsHeapUsedMiB.active, ' MiB')} | ${deltaCell(comparison.jsHeapUsedMiB, ' MiB')} | informational |
| Enumerated game listeners | ${value(comparison.listeners.idle)} | ${value(comparison.listeners.active)} | ${deltaCell(comparison.listeners)} | informational |

Additional renderer memory: idle ${idle.render.geometriesInRendererMemory} geometries / ${idle.render.texturesInRendererMemory} textures; active ${active.render.geometriesInRendererMemory} geometries / ${active.render.texturesInRendererMemory} textures. Scene-visible geometry counts are ${idle.render.uniqueVisibleGeometries} idle and ${active.render.uniqueVisibleGeometries} active.

## Median and per-sample tail evidence

The gate above continues to use every pooled frame. This companion view makes it clear whether a tail repeats across samples or appears in one host-sensitive run.

| Metric (sample median) | Idle | Active | Delta |
|---|---:|---:|---:|
| Average FPS | ${robustComparison.avgFps.idle} | ${robustComparison.avgFps.active} | ${deltaCell(robustComparison.avgFps)} |
| 1% low FPS | ${robustComparison.onePercentLowFps.idle} | ${robustComparison.onePercentLowFps.active} | ${deltaCell(robustComparison.onePercentLowFps)} |
| p99 frame | ${robustComparison.p99FrameMs.idle} ms | ${robustComparison.p99FrameMs.active} ms | ${deltaCell(robustComparison.p99FrameMs, ' ms')} |
| Worst frame | ${robustComparison.worstFrameMs.idle} ms | ${robustComparison.worstFrameMs.active} ms | ${deltaCell(robustComparison.worstFrameMs, ' ms')} |

| Sample | Avg FPS | 1% low | p99 ms | Worst ms | Frames >33 / >50 / >100 ms | <=100 ms tail gate |
|---|---:|---:|---:|---:|---:|---|
${tailRows}

- Idle isolated-tail candidate samples: ${idle.aggregate.tailStability.isolatedTailCandidateSamples.length ? idle.aggregate.tailStability.isolatedTailCandidateSamples.join(', ') : 'none'} (threshold ${idle.aggregate.tailStability.isolatedTailCandidateThresholdMs} ms)
- Active isolated-tail candidate samples: ${active.aggregate.tailStability.isolatedTailCandidateSamples.length ? active.aggregate.tailStability.isolatedTailCandidateSamples.join(', ') : 'none'} (threshold ${active.aggregate.tailStability.isolatedTailCandidateThresholdMs} ms)

## Normal-control checkout stages

The route uses the same keyboard, wheel, and pointer handlers as gameplay: it rotates/scans/stages products, performs a mouse card swipe, prints and packs the receipt, bags and hands off that sale, then opens the drawer, deposits tender, and selects the computed physical change on a new cash sale.

Cash fixture change: $${change.due.toFixed(2)} using ${JSON.stringify(change.plan)}. Setup creates deterministic customers and reads projections/state, but does not mutate a transaction stage or invoke a renderer action hook.

| Stage | Pooled FPS | Median sample FPS | Pooled 1% low | Median sample 1% low | Worst ms | Mean register+hand IK / customer animation call ms | Evidence |
|---|---:|---:|---:|---:|---:|---:|---|
${stageRows}

The update instrumentation is explicit but bounded: register timing includes all of \`register.update\` (including \`cashierHands.update\` IK), while customer timing wraps only the active checkout character's \`char.update\`. Neither is a full browser CPU profile.

## Ten-transaction leak probe

This separate probe completes ${TRANSACTION_LEAK_COUNT} one-item physical transactions, alternating card and cash. Each iteration uses normal scan/payment/receipt/bag/handoff controls and waits for the paid customer to leave naturally before taking a post-GC heap, listener, DOM, and renderer-resource sample.

| # | Method | Customer | Revenue delta | Post-GC heap MiB | Listeners | DOM elements | Renderer geometry / texture | Live geometry / material / texture |
|---:|---|---|---:|---:|---:|---:|---:|---:|
${transactionLeakRows || '| — | — | — | — | — | — | — | — | — |'}

- Completed: ${transactionLeakStress.completedTransactions}/${TRANSACTION_LEAK_COUNT} (${gateCell('tenTransactionCompletion')})${transactionLeakStress.error ? ` — ${transactionLeakStress.error}` : ''}
- Post-GC heap growth: ${transactionHeapGrowthMiB >= 0 ? '+' : ''}${transactionHeapGrowthMiB} MiB (${gateCell('transactionHeap')})
- Listener growth: ${transactionListenerGrowth >= 0 ? '+' : ''}${transactionListenerGrowth} (${gateCell('transactionListeners')})
- DOM growth: ${transactionDomGrowth >= 0 ? '+' : ''}${transactionDomGrowth}; transient register/customer residue returned to baseline: ${transactionResidueClear ? 'yes' : 'no'} (${gateCell('transactionResidue')})
- Total renderer memory growth, geometry / texture: ${transactionRendererGeometryGrowth >= 0 ? '+' : ''}${transactionRendererGeometryGrowth} / ${transactionRendererTextureGrowth >= 0 ? '+' : ''}${transactionRendererTextureGrowth}
- Warm-branch renderer slope (iteration ${transactionResourceTailStart?.index || '—'} -> ${transactionResourceTailEnd?.index || '—'}), geometry / texture: ${transactionRendererGeometryTailGrowth == null ? 'unavailable' : `${transactionRendererGeometryTailGrowth >= 0 ? '+' : ''}${transactionRendererGeometryTailGrowth}`} / ${transactionRendererTextureTailGrowth == null ? 'unavailable' : `${transactionRendererTextureTailGrowth >= 0 ? '+' : ''}${transactionRendererTextureTailGrowth}`} (${gateCell('transactionRendererResources')})
- Live scene-resource growth, geometry / material / texture: ${transactionLiveGeometryGrowth >= 0 ? '+' : ''}${transactionLiveGeometryGrowth} / ${transactionLiveMaterialGrowth >= 0 ? '+' : ''}${transactionLiveMaterialGrowth} / ${transactionLiveTextureGrowth >= 0 ? '+' : ''}${transactionLiveTextureGrowth} (${gateCell('transactionRendererResources')})
- Probe duration: ${(transactionLeakStress.durationMs / 1000).toFixed(1)} seconds

## Cold first-activation window

- E action offset: ${firstActivation.actionOffsetMs} ms into a ${firstActivation.durationMs} ms raw rAF window
- Average FPS ${firstActivation.summary.avgFps}; 1% low ${firstActivation.summary.onePercentLowFps}; p99 ${firstActivation.summary.p99FrameMs} ms; worst ${firstActivation.summary.worstFrameMs} ms
- Slow frames >33 / >50 / >100 ms: ${firstActivation.summary.framesOver33Ms} / ${firstActivation.summary.framesOver50Ms} / ${firstActivation.summary.framesOver100Ms} (${gateCell('firstActivationHitch')})
- Mean/max register update including hand IK: ${firstActivation.ui.cpuTiming.registerUpdateIncludingCashierHandIk.meanCallMs} / ${firstActivation.ui.cpuTiming.registerUpdateIncludingCashierHandIk.maxCallMs} ms; active customer animation: ${firstActivation.ui.cpuTiming.activeCustomerCharacterAnimation.meanCallMs} / ${firstActivation.ui.cpuTiming.activeCustomerCharacterAnimation.maxCallMs} ms

## Interaction-growth probe

- ${INTERACTION_CYCLES} normal Escape/E leave/re-enter cycles plus one routed item click
- Route completion: ${interactionStressComplete ? 'complete' : `incomplete â€” ${interactionStressError || 'unknown error'}`} (${gateCell('interactionStressCompletion')})
- Listener growth: ${listenerGrowth == null ? 'unavailable' : `${listenerGrowth >= 0 ? '+' : ''}${listenerGrowth}`} (${gateCell('interactionListeners')})
- Post-GC heap growth: ${heapGrowthMiB == null ? 'unavailable' : `${heapGrowthMiB >= 0 ? '+' : ''}${heapGrowthMiB} MiB`} (${gateCell('interactionHeap')})
- Input observed: ${JSON.stringify(stressUi.inputEvents)}
- UI work during stress: POS ${stressUi.posRedraws}, terminal ${stressUi.terminalRedraws}, register-hint mutations ${stressUi.registerHintMutations}
- Static active UI rates: POS ${active.ui.posRedrawsPerSecond}/s, terminal ${active.ui.terminalRedrawsPerSecond}/s, register hint ${active.ui.registerHintMutationsPerSecond}/s (${gateCell('staticUi')})

## Verdict

${result.likelyRegression == null
    ? `Likely regression / budget breach: **INDETERMINATE** because required evidence is incomplete. Evidence gates: ${evidenceIncompleteGates.join(', ') || 'unknown'}. All failed gates: ${failedGates.join(', ')}.`
    : result.likelyRegression
      ? `Likely regression / budget breach: **YES**. Failed gates: ${failedGates.join(', ')}.`
      : 'Likely regression / budget breach: **NO** under the proposed matched-scene tolerances.'}

Tail interpretation is based on the retained raw samples above. An isolated candidate is not attributed to the host, GC, or game without supporting timing evidence, and it remains a gate input. The listener, post-GC heap, UI redraw, register-update, and customer-animation probes provide separate evidence instead of inferring a cause from FPS alone.

All captured errors/failures: ${errors.length ? errors.join(' | ') : 'none'}

## Measurement qualifications

- Texture MiB is an estimate assuming RGBA8 and mipmaps; exact GPU allocation is unavailable from WebGL.
- Listener totals cover window, document, and all current DOM Elements through CDP; inaccessible non-DOM EventTargets are unmeasured.
- Raw per-frame samples and complete metric sources are retained in [register-performance.json](./register-performance.json).
`;

  const verdictOf = (capture) => {
    if (!capture) return 'unavailable';
    if (capture.likelyRegression == null) return `INDETERMINATE (${(capture.failedGates || []).join(', ') || 'unstable capture'})`;
    return capture.likelyRegression
      ? `FAIL (${(capture.failedGates || []).join(', ') || 'budget breach'})`
      : 'PASS (all explicit gates green)';
  };
  const leakValue = (capture, key) => capture?.transactionLeakStress?.[key] ?? 'unavailable';
  const rendererTailOf = (capture) => {
    const tail = capture?.transactionLeakStress?.rendererMemoryTailGrowthAfterBothBranchesWarm;
    return tail ? `${tail.geometries >= 0 ? '+' : ''}${tail.geometries} / ${tail.textures >= 0 ? '+' : ''}${tail.textures}` : 'unavailable';
  };
  const liveGrowthOf = (capture) => {
    const growth = capture?.transactionLeakStress?.liveSceneResourceGrowth;
    return growth
      ? `${growth.geometries >= 0 ? '+' : ''}${growth.geometries} / ${growth.materials >= 0 ? '+' : ''}${growth.materials} / ${growth.textures >= 0 ? '+' : ''}${growth.textures}`
      : 'unavailable';
  };
  const stagesOf = (capture) => Object.keys(capture?.representativeStages || {}).join(', ') || 'none';
  const errorCountOf = (capture) => Array.isArray(capture?.errors) ? capture.errors.length : 'unavailable';
  const priorLink = priorResult && priorRunId
    ? `[runs/${priorRunId}.json](./runs/${priorRunId}.json)`
    : 'unavailable';
  const beforeAfter = `# Cash-register performance — superseding validation

**Current authority:** [register-performance.json](./register-performance.json), generated ${result.generatedAt}.

The immediately preceding validation is preserved unchanged at ${priorLink}. It is superseded by the current run, not overwritten or silently discarded. Both columns use the same isolated 1600x900 fixture/protocol when a prior capture is available.

| Gate or evidence | Superseded prior | Current run |
|---|---:|---:|
| Overall verdict | ${verdictOf(priorResult)} | ${verdictOf(result)} |
| Idle / active average FPS | ${priorResult ? `${priorResult.idle.aggregate.avgFps} / ${priorResult.active.aggregate.avgFps}` : 'unavailable'} | ${idle.aggregate.avgFps} / ${active.aggregate.avgFps} |
| Active 1% low / worst frame | ${priorResult ? `${priorResult.active.aggregate.onePercentLowFps} FPS / ${priorResult.active.aggregate.worstFrameMs} ms` : 'unavailable'} | ${active.aggregate.onePercentLowFps} FPS / ${active.aggregate.worstFrameMs} ms |
| Ten completed physical sales | ${priorResult ? `${leakValue(priorResult, 'completedTransactions')}/${leakValue(priorResult, 'targetTransactions')}` : 'unavailable'} | ${transactionLeakStress.completedTransactions}/${transactionLeakStress.targetTransactions} |
| Ten-sale post-GC heap growth | ${priorResult ? `${leakValue(priorResult, 'heapGrowthMiB')} MiB` : 'unavailable'} | ${transactionHeapGrowthMiB} MiB |
| Ten-sale listener / DOM growth | ${priorResult ? `${leakValue(priorResult, 'listenerGrowth')} / ${leakValue(priorResult, 'domGrowth')}` : 'unavailable'} | ${transactionListenerGrowth} / ${transactionDomGrowth} |
| Warm renderer geometry / texture slope | ${rendererTailOf(priorResult)} | ${rendererTailOf(result)} |
| Live geometry / material / texture growth | ${liveGrowthOf(priorResult)} | ${liveGrowthOf(result)} |
| Required representative stages | ${stagesOf(priorResult)} | ${stagesOf(result)} |
| Captured error/failure count | ${errorCountOf(priorResult)} | ${errors.length} |
| Static POS / terminal / hint updates per second | ${priorResult ? `${priorResult.active.ui.posRedrawsPerSecond} / ${priorResult.active.ui.terminalRedrawsPerSecond} / ${priorResult.active.ui.registerHintMutationsPerSecond}` : 'unavailable'} | ${active.ui.posRedrawsPerSecond} / ${active.ui.terminalRedrawsPerSecond} / ${active.ui.registerHintMutationsPerSecond} |

The current run is authoritative only if its verdict is PASS; otherwise both artifacts remain diagnostic evidence and the checkout performance gate remains open.
`;

  await fs.writeFile(`${OUT}/register-performance.json`, JSON.stringify(result, null, 2), 'utf8');
  await fs.writeFile(`${OUT}/README.md`, report, 'utf8');
  await fs.writeFile(`${OUT}/BEFORE_AFTER.md`, beforeAfter, 'utf8');
  const runId = result.generatedAt.replace(/[:.]/g, '-');
  await fs.writeFile(`${OUT}/runs/${runId}.json`, JSON.stringify(result, null, 2), 'utf8');
  await fs.writeFile(`${OUT}/runs/${runId}.md`, report, 'utf8');
  return {
    out: OUT,
    report: `${OUT}/README.md`,
    raw: `${OUT}/register-performance.json`,
    idle: { frames: idle.aggregate, render: idle.render, heapMiB: idle.heap.jsHeapUsedMiB, listeners: idle.listeners.total },
    active: { frames: active.aggregate, render: active.render, heapMiB: active.heap.jsHeapUsedMiB, listeners: active.listeners.total },
    firstActivation: firstActivation.summary,
    representativeStages: Object.fromEntries(Object.entries(representativeStages)
      .map(([key, stage]) => [key, { frames: stage.aggregate, cpuTiming: stage.ui.cpuTiming }])),
    transactionLeakStress: {
      completed: transactionLeakStress.completedTransactions,
      target: transactionLeakStress.targetTransactions,
      heapMiB: transactionHeapGrowthMiB,
      listeners: transactionListenerGrowth,
      dom: transactionDomGrowth,
      rendererGeometry: transactionRendererGeometryGrowth,
      rendererTexture: transactionRendererTextureGrowth,
      rendererGeometryTail: transactionRendererGeometryTailGrowth,
      rendererTextureTail: transactionRendererTextureTailGrowth,
      error: transactionLeakStress.error,
    },
    interactionGrowth: { heapMiB: heapGrowthMiB, listeners: listenerGrowth },
    failedGates,
    likelyRegression: result.likelyRegression,
    errorCount: errors.length,
  };
}
