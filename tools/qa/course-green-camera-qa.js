// Focused normal-control acceptance harness for Hole 7's Green View camera.
//
// Start the normal static server (`npm run serve`), then run the synthetic
// previous-default baseline followed by the unmodified candidate:
//
//   $env:COURSE_GREEN_QA_MODE='baseline-094'
//   $env:COURSE_GREEN_QA_PHASE='baseline-094'
//   $env:QA_RESULT_PATH='qa/course_green_camera/baseline-094/results.json'
//   $env:VIDEO_DIR='qa/course_green_camera/baseline-094/video'
//   $env:HEADED='1'
//   node tools/qa/run-playwright.cjs tools/qa/course-green-camera-qa.js --bootstrap
//
//   $env:COURSE_GREEN_QA_MODE='candidate-093'
//   $env:COURSE_GREEN_QA_PHASE='candidate-093'
//   $env:COURSE_GREEN_QA_BASELINE_RESULT='qa/course_green_camera/baseline-094/results.json'
//   $env:QA_RESULT_PATH='qa/course_green_camera/candidate-093/results.json'
//   $env:VIDEO_DIR='qa/course_green_camera/candidate-093/video'
//   node tools/qa/run-playwright.cjs tools/qa/course-green-camera-qa.js --bootstrap
//
// The baseline interception is deliberately guarded: it will only replace the
// one known 0.93 default in courseCamera.js and fails if the source no longer has
// exactly that shape. The candidate never intercepts application source.
async (page) => {
  const SCHEMA_VERSION = 1;
  const SAMPLE_COUNT = 3;
  const SAMPLE_DURATION_MS = 2500;
  const WARMUP_MS = 1000;
  const VISIBLE_SELECT_CYCLES = 10;
  const SAFE_EPSILON = 1e-4;
  const BASELINE_SOURCE = 'finite(options.greenTargetT, 0.93)';
  const BASELINE_REPLACEMENT = 'finite(options.greenTargetT, 0.94)';
  const VIEWPORTS = Object.freeze([
    Object.freeze({ key: '4x3', width: 1200, height: 900, aspect: 4 / 3 }),
    Object.freeze({ key: '16x9', width: 1600, height: 900, aspect: 16 / 9 }),
  ]);

  const modeAliases = new Map([
    ['baseline', 'baseline-094'],
    ['baseline-094', 'baseline-094'],
    ['candidate', 'candidate-093'],
    ['candidate-093', 'candidate-093'],
  ]);
  const requestedMode = String(process.env.COURSE_GREEN_QA_MODE || 'candidate-093').toLowerCase();
  const mode = modeAliases.get(requestedMode);
  if (!mode) throw new Error(`Unsupported COURSE_GREEN_QA_MODE: ${requestedMode}`);
  const isBaseline = mode === 'baseline-094';
  const expectedRouteT = isBaseline ? 0.94 : 0.93;
  const rawPhase = process.env.COURSE_GREEN_QA_PHASE || mode;
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(rawPhase)) {
    throw new Error(`Unsafe COURSE_GREEN_QA_PHASE: ${rawPhase}`);
  }
  const phase = rawPhase;
  const outDir = process.env.COURSE_GREEN_QA_OUT_DIR || `qa/course_green_camera/${phase}`;
  const baselineResultPath = process.env.COURSE_GREEN_QA_BASELINE_RESULT
    || 'qa/course_green_camera/baseline-094/results.json';
  const { mkdir, readFile } = await import('node:fs/promises');
  await mkdir(outDir, { recursive: true });

  const diagnostics = {
    console: [],
    benignConsole: [],
    pageErrors: [],
    failedRequests: [],
    ignoredPreProbeRequestFailures: [],
  };
  let qaDocumentCommitted = false;
  let qaDocumentRequests = new WeakSet();
  const baselineOverride = {
    requested: isBaseline,
    applied: false,
    handlerCalls: 0,
    replacements: 0,
    url: null,
    guardError: null,
  };

  page.on('console', (message) => {
    if (message.type() !== 'error' && message.type() !== 'warning') return;
    const record = `${message.type()}: ${message.text()}`;
    if (/THREE\.WebGLProgram: Program Info Log/i.test(record)
      && /dyn_index_vec4_float4_int/i.test(record)) diagnostics.benignConsole.push(record);
    else diagnostics.console.push(record);
  });
  page.on('pageerror', (error) => diagnostics.pageErrors.push(error.message));
  page.on('request', (request) => {
    if (qaDocumentCommitted) qaDocumentRequests.add(request);
  });
  page.on('requestfailed', (request) => {
    const record = { url: request.url(), error: request.failure()?.errorText || 'unknown' };
    if (qaDocumentRequests.has(request)) diagnostics.failedRequests.push(record);
    else diagnostics.ignoredPreProbeRequestFailures.push(record);
  });
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame() && frame.url().startsWith('http://localhost:8457/')) {
      qaDocumentCommitted = true;
    }
  });

  if (isBaseline) {
    await page.route('**/src/sim/courseCamera.js', async (route) => {
      baselineOverride.handlerCalls += 1;
      baselineOverride.url = route.request().url();
      const response = await route.fetch();
      const source = await response.text();
      const replacements = source.split(BASELINE_SOURCE).length - 1;
      baselineOverride.replacements = replacements;
      if (replacements !== 1) {
        baselineOverride.guardError = `Expected exactly one ${BASELINE_SOURCE}; found ${replacements}.`;
        await route.fulfill({
          status: 500,
          contentType: 'text/plain; charset=utf-8',
          body: baselineOverride.guardError,
        });
        return;
      }
      baselineOverride.applied = true;
      await route.fulfill({
        response,
        body: source.replace(BASELINE_SOURCE, BASELINE_REPLACEMENT),
      });
    }, { times: 1 });
  }

  const settle = async (frames = 10) => page.evaluate((count) => new Promise((resolve) => {
    let left = count;
    const tick = () => {
      left -= 1;
      if (left <= 0) resolve();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }), frames);

  const waitForAssets = async () => page.evaluate(async () => {
    const barrier = window.__fw?.scene3d?.assetBarrier?.(30000);
    if (!barrier) return { supported: false, idle: null, completed: null };
    if (barrier.idle) return { supported: true, idle: true, completed: true };
    const completed = await barrier.promise;
    return { supported: true, idle: false, completed: completed !== false };
  });

  const waitForClubhouseAssets = async () => {
    await page.waitForFunction(() => {
      const clubhouse = window.__fw?.scene3d?.clubhouse?.();
      const sheet06 = clubhouse?.sheet06Production?.diagnostics?.();
      return clubhouse?.assetsReady?.() === true
        && clubhouse?.deliveryEquipmentReady?.() === true
        && ['active', 'fallback'].includes(sheet06?.lifecycle);
    }, null, { timeout: 60000 });
    await settle(12);
    return page.evaluate(() => {
      const clubhouse = window.__fw.scene3d.clubhouse();
      return {
        merchandise: clubhouse.assetsReady(),
        deliveryEquipment: clubhouse.deliveryEquipmentReady(),
        sheet06Production: clubhouse.sheet06Production.diagnostics()?.lifecycle || null,
      };
    });
  };

  const screenshot = async (name) => {
    const path = `${outDir}/${name}.png`;
    await page.screenshot({ path });
    return path;
  };

  const sampleFrameTimes = async (durationMs) => page.evaluate((duration) => new Promise((resolve) => {
    const renderer = window.__fw.scene3d.renderer;
    const info = renderer.info;
    const priorAutoReset = info.autoReset;
    const deltas = [];
    const ui = {
      records: 0,
      attributes: 0,
      childList: 0,
      characterData: 0,
      addedNodes: 0,
      removedNodes: 0,
    };
    const editorRoot = document.querySelector('.ced-root');
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        ui.records += 1;
        ui[record.type] += 1;
        ui.addedNodes += record.addedNodes?.length || 0;
        ui.removedNodes += record.removedNodes?.length || 0;
      }
    });
    if (editorRoot) observer.observe(editorRoot, {
      subtree: true,
      attributes: true,
      childList: true,
      characterData: true,
    });
    info.autoReset = false;
    info.reset();
    let last = performance.now();
    const started = last;
    const tick = (now) => {
      const delta = now - last;
      last = now;
      if (delta > 0) deltas.push(delta);
      if (now - started < duration) {
        requestAnimationFrame(tick);
        return;
      }
      observer.disconnect();
      const renderTotals = {
        drawCalls: info.render.calls,
        triangles: info.render.triangles,
        points: info.render.points,
        lines: info.render.lines,
      };
      info.reset();
      info.autoReset = priorAutoReset;
      const ordered = deltas.slice().sort((a, b) => a - b);
      const totalMs = deltas.reduce((sum, value) => sum + value, 0);
      const averageMs = totalMs / Math.max(1, deltas.length);
      const slowCount = Math.max(1, Math.ceil(ordered.length * 0.01));
      const slowest = ordered.slice(-slowCount);
      const slowestMeanMs = slowest.reduce((sum, value) => sum + value, 0)
        / Math.max(1, slowest.length);
      const percentile = (fraction) => ordered[
        Math.min(ordered.length - 1, Math.max(0, Math.ceil(ordered.length * fraction) - 1))
      ] || 0;
      resolve({
        frames: deltas.length,
        durationMs: +(last - started).toFixed(2),
        averageFps: averageMs > 0 ? +(1000 / averageMs).toFixed(2) : 0,
        averageFrameMs: +averageMs.toFixed(3),
        onePercentLowFps: slowestMeanMs > 0 ? +(1000 / slowestMeanMs).toFixed(2) : 0,
        slowestOnePercentFrameCount: slowCount,
        slowestOnePercentMeanMs: +slowestMeanMs.toFixed(3),
        p95FrameMs: +percentile(0.95).toFixed(3),
        p99FrameMs: +percentile(0.99).toFixed(3),
        worstFrameMs: +(ordered.at(-1) || 0).toFixed(3),
        drawCallsTotal: renderTotals.drawCalls,
        drawCallsPerFrame: +(renderTotals.drawCalls / Math.max(1, deltas.length)).toFixed(2),
        trianglesTotal: renderTotals.triangles,
        trianglesPerFrame: Math.round(renderTotals.triangles / Math.max(1, deltas.length)),
        pointsPerFrame: +(renderTotals.points / Math.max(1, deltas.length)).toFixed(2),
        linesPerFrame: +(renderTotals.lines / Math.max(1, deltas.length)).toFixed(2),
        jsHeapUsedBytes: performance.memory?.usedJSHeapSize ?? null,
        uiMutations: {
          rootFound: !!editorRoot,
          durationMs: +(last - started).toFixed(2),
          recordsPerSecond: +(ui.records / Math.max(0.001, (last - started) / 1000)).toFixed(3),
          ...ui,
        },
        rawFrameDeltasMs: deltas.map((value) => +value.toFixed(3)),
      });
    };
    requestAnimationFrame(tick);
  }), durationMs);

  const summarizeSamples = (samples) => {
    const deltas = samples.flatMap((sample) => sample.rawFrameDeltasMs);
    const ordered = deltas.slice().sort((a, b) => a - b);
    const totalMs = deltas.reduce((sum, value) => sum + value, 0);
    const averageMs = totalMs / Math.max(1, deltas.length);
    const slowCount = Math.max(1, Math.ceil(ordered.length * 0.01));
    const slowest = ordered.slice(-slowCount);
    const slowestMeanMs = slowest.reduce((sum, value) => sum + value, 0)
      / Math.max(1, slowest.length);
    const drawCallsTotal = samples.reduce((sum, sample) => sum + sample.drawCallsTotal, 0);
    const trianglesTotal = samples.reduce((sum, sample) => sum + sample.trianglesTotal, 0);
    const uiRecords = samples.reduce((sum, sample) => sum + sample.uiMutations.records, 0);
    const measuredDurationMs = samples.reduce((sum, sample) => sum + sample.durationMs, 0);
    return {
      sampleCount: samples.length,
      sampleDurationMs: SAMPLE_DURATION_MS,
      frames: deltas.length,
      durationMs: +measuredDurationMs.toFixed(2),
      averageFps: averageMs > 0 ? +(1000 / averageMs).toFixed(2) : 0,
      averageFrameMs: +averageMs.toFixed(3),
      onePercentLowFps: slowestMeanMs > 0 ? +(1000 / slowestMeanMs).toFixed(2) : 0,
      slowestOnePercentFrameCount: slowCount,
      slowestOnePercentMeanMs: +slowestMeanMs.toFixed(3),
      p95FrameMs: +(ordered[Math.max(0, Math.ceil(ordered.length * 0.95) - 1)] || 0).toFixed(3),
      p99FrameMs: +(ordered[Math.max(0, Math.ceil(ordered.length * 0.99) - 1)] || 0).toFixed(3),
      worstFrameMs: +(ordered.at(-1) || 0).toFixed(3),
      drawCallsPerFrame: +(drawCallsTotal / Math.max(1, deltas.length)).toFixed(2),
      trianglesPerFrame: Math.round(trianglesTotal / Math.max(1, deltas.length)),
      uiMutationRecords: uiRecords,
      uiMutationRecordsPerSecond: +(uiRecords / Math.max(0.001, measuredDurationMs / 1000)).toFixed(3),
      samples,
    };
  };

  const sceneCensus = async () => page.evaluate(() => {
    const scene3d = window.__fw.scene3d;
    const renderer = scene3d.renderer;
    const materials = new Set();
    const textures = new Set();
    let sceneNodes = 0;
    let meshes = 0;
    let instancedMeshes = 0;
    let renderedInstances = 0;
    let visibleMeshes = 0;
    let textureBytesEstimate = 0;
    const collectMaterial = (material) => {
      if (!material || materials.has(material)) return;
      materials.add(material);
      for (const value of Object.values(material)) {
        if (value?.isTexture) textures.add(value);
      }
      if (material.uniforms) {
        for (const uniform of Object.values(material.uniforms)) {
          if (uniform?.value?.isTexture) textures.add(uniform.value);
        }
      }
    };
    scene3d.scene.traverse((object) => {
      sceneNodes += 1;
      if (!object.isMesh) return;
      meshes += 1;
      if (object.visible) visibleMeshes += 1;
      if (object.isInstancedMesh) {
        instancedMeshes += 1;
        renderedInstances += object.count || 0;
      }
      const list = Array.isArray(object.material) ? object.material : [object.material];
      list.forEach(collectMaterial);
    });
    for (const texture of textures) {
      const source = texture.image || texture.source?.data;
      const width = source?.videoWidth || source?.naturalWidth || source?.width || 0;
      const height = source?.videoHeight || source?.naturalHeight || source?.height || 0;
      const layers = source?.depth || 1;
      if (width && height) {
        textureBytesEstimate += width * height * layers * 4
          * (texture.generateMipmaps === false ? 1 : 4 / 3);
      }
    }
    return {
      sceneNodes,
      meshes,
      visibleMeshes,
      instancedMeshes,
      renderedInstances,
      materialCount: materials.size,
      textureCountScene: textures.size,
      textureCountRenderer: renderer.info.memory.textures,
      textureMemoryEstimateBytes: Math.round(textureBytesEstimate),
      textureMemoryEstimateMiB: +(textureBytesEstimate / 1024 / 1024).toFixed(2),
      textureMemoryEstimateMethod: 'Scene-reachable source dimensions * RGBA8 bytes * layer count * declared mip-chain factor; estimate, not measured GPU allocation.',
      geometryCount: renderer.info.memory.geometries,
      programCount: renderer.info.programs?.length ?? null,
      jsHeapUsedBytes: performance.memory?.usedJSHeapSize ?? null,
      jsHeapTotalBytes: performance.memory?.totalJSHeapSize ?? null,
      shadowBakes: scene3d.post?.stats?.().shadowBakes ?? null,
    };
  });

  const sceneInventory = async () => page.evaluate(() => {
    const scene = window.__fw.scene3d.scene;
    const paths = new WeakMap();
    const multiset = new Map();
    let totalNodes = 0;
    let meshNodes = 0;
    let instancedMeshNodes = 0;

    const label = (value, fallback) => {
      const text = String(value || '').trim();
      return text || fallback;
    };
    const describeMaterial = (material) => ({
      name: label(material?.name, '(unnamed-material)'),
      type: label(material?.type || material?.constructor?.name, '(unknown-material-type)'),
    });

    scene.traverse((object) => {
      totalNodes += 1;
      if (object.isMesh) meshNodes += 1;
      if (object.isInstancedMesh) instancedMeshNodes += 1;

      const name = label(object.name, '(unnamed)');
      const type = label(object.type || object.constructor?.name, '(unknown-object-type)');
      const parentPath = object.parent
        ? (paths.get(object.parent) || '(unresolved-parent)')
        : '(scene-root)';
      const objectPath = object.parent ? `${parentPath}/${type}:${name}` : `${type}:${name}`;
      paths.set(object, objectPath);

      const geometry = object.geometry ? {
        name: label(object.geometry.name, '(unnamed-geometry)'),
        type: label(object.geometry.type || object.geometry.constructor?.name, '(unknown-geometry-type)'),
      } : null;
      const materials = (Array.isArray(object.material) ? object.material : [object.material])
        .filter(Boolean)
        .map(describeMaterial);
      const descriptor = {
        parentPath,
        name,
        type,
        isMesh: object.isMesh === true,
        isInstancedMesh: object.isInstancedMesh === true,
        geometry,
        materials,
      };
      const signature = JSON.stringify(descriptor);
      const entry = multiset.get(signature);
      if (entry) entry.count += 1;
      else multiset.set(signature, { signature, ...descriptor, count: 1 });
    });

    const entries = [...multiset.values()].sort((a, b) => (
      a.parentPath.localeCompare(b.parentPath)
      || a.type.localeCompare(b.type)
      || a.name.localeCompare(b.name)
      || a.signature.localeCompare(b.signature)
    ));
    return {
      capturedAt: new Date().toISOString(),
      totalNodes,
      meshNodes,
      instancedMeshNodes,
      uniqueSignatures: entries.length,
      entries,
    };
  });

  const diffSceneInventories = (before, after) => {
    const beforeEntries = new Map((before?.entries || []).map((entry) => [entry.signature, entry]));
    const afterEntries = new Map((after?.entries || []).map((entry) => [entry.signature, entry]));
    const signatures = new Set([...beforeEntries.keys(), ...afterEntries.keys()]);
    const entries = [];
    for (const signature of signatures) {
      const previous = beforeEntries.get(signature);
      const current = afterEntries.get(signature);
      const beforeCount = previous?.count || 0;
      const afterCount = current?.count || 0;
      if (beforeCount === afterCount) continue;
      const descriptor = current || previous;
      entries.push({
        signature,
        parentPath: descriptor.parentPath,
        name: descriptor.name,
        type: descriptor.type,
        isMesh: descriptor.isMesh,
        isInstancedMesh: descriptor.isInstancedMesh,
        geometry: descriptor.geometry,
        materials: descriptor.materials,
        beforeCount,
        afterCount,
        delta: afterCount - beforeCount,
      });
    }
    entries.sort((a, b) => (
      b.delta - a.delta
      || a.parentPath.localeCompare(b.parentPath)
      || a.type.localeCompare(b.type)
      || a.name.localeCompare(b.name)
    ));

    const parentTotals = (inventory) => {
      const totals = new Map();
      for (const entry of inventory?.entries || []) {
        totals.set(entry.parentPath, (totals.get(entry.parentPath) || 0) + entry.count);
      }
      return totals;
    };
    const beforeParents = parentTotals(before);
    const afterParents = parentTotals(after);
    const parentPaths = new Set([...beforeParents.keys(), ...afterParents.keys()]);
    const parentPathChanges = [...parentPaths].map((parentPath) => {
      const beforeCount = beforeParents.get(parentPath) || 0;
      const afterCount = afterParents.get(parentPath) || 0;
      return { parentPath, beforeCount, afterCount, delta: afterCount - beforeCount };
    }).filter((entry) => entry.delta !== 0).sort((a, b) => (
      b.delta - a.delta || a.parentPath.localeCompare(b.parentPath)
    ));

    const summary = (inventory) => ({
      capturedAt: inventory?.capturedAt || null,
      totalNodes: inventory?.totalNodes ?? null,
      meshNodes: inventory?.meshNodes ?? null,
      instancedMeshNodes: inventory?.instancedMeshNodes ?? null,
      uniqueSignatures: inventory?.uniqueSignatures ?? null,
    });
    const addedNodeCount = entries.reduce((sum, entry) => sum + Math.max(0, entry.delta), 0);
    const removedNodeCount = entries.reduce((sum, entry) => sum + Math.max(0, -entry.delta), 0);
    return {
      format: 'Object3D structural-descriptor multiset; entries retain exact name, type, parent path, geometry, material, before/after count, and net delta.',
      before: summary(before),
      after: summary(after),
      addedNodeCount,
      removedNodeCount,
      netNodeDelta: addedNodeCount - removedNodeCount,
      changedSignatureCount: entries.length,
      entries,
      parentPathChanges,
    };
  };

  const waitForSceneStable = async ({
    timeoutMs = 30000,
    intervalMs = 250,
    stableSamples = 8,
  } = {}) => {
    const finiteNonNegative = (value, fallback) => {
      const numeric = Number(value);
      return Number.isFinite(numeric) ? Math.max(0, numeric) : fallback;
    };
    const boundedTimeoutMs = finiteNonNegative(timeoutMs, 30000);
    const boundedIntervalMs = finiteNonNegative(intervalMs, 250);
    const numericStableSamples = Number(stableSamples);
    const requiredStableSamples = Number.isFinite(numericStableSamples)
      ? Math.max(1, Math.floor(numericStableSamples))
      : 8;
    const startedAt = Date.now();
    const deadline = startedAt + boundedTimeoutMs;
    let previousSignature = null;
    let consecutive = 0;
    let samples = 0;
    let latest = null;
    while (Date.now() <= deadline) {
      latest = await sceneCensus();
      samples += 1;
      const signature = JSON.stringify([
        latest.sceneNodes,
        latest.meshes,
        latest.visibleMeshes,
        latest.instancedMeshes,
        latest.renderedInstances,
        latest.materialCount,
        latest.textureCountScene,
        latest.textureCountRenderer,
        latest.geometryCount,
        latest.programCount,
      ]);
      consecutive = signature === previousSignature ? consecutive + 1 : 1;
      previousSignature = signature;
      if (consecutive >= requiredStableSamples) {
        return {
          pass: true,
          durationMs: Date.now() - startedAt,
          timeoutMs: boundedTimeoutMs,
          intervalMs: boundedIntervalMs,
          requiredStableSamples,
          samples,
          consecutive,
          census: latest,
        };
      }
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) break;
      await page.waitForTimeout(Math.min(boundedIntervalMs, remainingMs));
    }
    return {
      pass: false,
      durationMs: Date.now() - startedAt,
      timeoutMs: boundedTimeoutMs,
      intervalMs: boundedIntervalMs,
      requiredStableSamples,
      samples,
      consecutive,
      census: latest,
    };
  };

  let cdp = null;
  const browserCensus = async ({ collectGarbage = false } = {}) => {
    if (collectGarbage) await cdp.send('HeapProfiler.collectGarbage');
    const [dom, response] = await Promise.all([
      cdp.send('Memory.getDOMCounters'),
      cdp.send('Performance.getMetrics'),
    ]);
    const metrics = Object.fromEntries((response.metrics || []).map((entry) => [entry.name, entry.value]));
    return {
      garbageCollectedImmediatelyBefore: collectGarbage,
      jsHeapUsedBytes: metrics.JSHeapUsedSize ?? null,
      jsHeapTotalBytes: metrics.JSHeapTotalSize ?? null,
      documents: dom.documents ?? metrics.Documents ?? null,
      domNodes: dom.nodes ?? metrics.Nodes ?? null,
      jsEventListeners: dom.jsEventListeners ?? metrics.JSEventListeners ?? null,
      layoutCount: metrics.LayoutCount ?? null,
      recalcStyleCount: metrics.RecalcStyleCount ?? null,
      layoutDurationSeconds: metrics.LayoutDuration ?? null,
      recalcStyleDurationSeconds: metrics.RecalcStyleDuration ?? null,
      scriptDurationSeconds: metrics.ScriptDuration ?? null,
      taskDurationSeconds: metrics.TaskDuration ?? null,
    };
  };

  const listenerCensus = async () => {
    const targets = {
      window: 'window',
      document: 'document',
      html: 'document.documentElement',
      canvas: 'window.__fw?.scene3d?.renderer?.domElement',
      editor: 'document.querySelector(".ced-root")',
      cameraSelect: 'document.querySelector(".ced-camera")',
    };
    const byTarget = {};
    const byType = {};
    let sampledTotal = 0;
    for (const [label, expression] of Object.entries(targets)) {
      const evaluated = await cdp.send('Runtime.evaluate', {
        expression,
        returnByValue: false,
        objectGroup: 'course-green-camera-listeners',
      });
      const objectId = evaluated.result?.objectId;
      if (!objectId) {
        byTarget[label] = 0;
        continue;
      }
      const response = await cdp.send('DOMDebugger.getEventListeners', { objectId });
      const listeners = response.listeners || [];
      byTarget[label] = listeners.length;
      sampledTotal += listeners.length;
      for (const listener of listeners) {
        byType[listener.type] = (byType[listener.type] || 0) + 1;
      }
    }
    const fullDocument = await cdp.send('Memory.getDOMCounters');
    return {
      fullDocument: {
        documents: fullDocument.documents,
        domNodes: fullDocument.nodes,
        jsEventListeners: fullDocument.jsEventListeners,
      },
      sampledTargets: { total: sampledTotal, byTarget, byType },
    };
  };

  const startUiMutationProbe = async (label) => page.evaluate((probeLabel) => {
    window.__courseGreenQaMutationProbe?.observer?.disconnect();
    const root = document.querySelector('.ced-root');
    const startedAt = performance.now();
    const counts = {
      records: 0,
      attributes: 0,
      childList: 0,
      characterData: 0,
      addedNodes: 0,
      removedNodes: 0,
    };
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        counts.records += 1;
        counts[record.type] += 1;
        counts.addedNodes += record.addedNodes?.length || 0;
        counts.removedNodes += record.removedNodes?.length || 0;
      }
    });
    if (root) observer.observe(root, {
      subtree: true,
      attributes: true,
      childList: true,
      characterData: true,
    });
    window.__courseGreenQaMutationProbe = {
      label: probeLabel,
      rootFound: !!root,
      startedAt,
      counts,
      observer,
    };
  }, label);

  const stopUiMutationProbe = async () => page.evaluate(() => {
    const probe = window.__courseGreenQaMutationProbe;
    if (!probe) return null;
    probe.observer.disconnect();
    const durationMs = performance.now() - probe.startedAt;
    const result = {
      label: probe.label,
      rootFound: probe.rootFound,
      durationMs: +durationMs.toFixed(2),
      recordsPerSecond: +(probe.counts.records / Math.max(0.001, durationMs / 1000)).toFixed(3),
      ...probe.counts,
    };
    delete window.__courseGreenQaMutationProbe;
    return result;
  });

  const selectHoleThroughUi = async (index) => {
    const chip = page.locator('.ced-holechip');
    await chip.waitFor({ state: 'visible' });
    await chip.click();
    const cards = page.locator('.ced-holecard:not(.add)');
    if (await cards.count() <= index) throw new Error(`Hole card ${index + 1} is not available.`);
    await cards.nth(index).click();
    await page.getByRole('button', { name: 'Frame it', exact: true }).click();
    await page.waitForFunction((number) => {
      const element = document.querySelector('.ced-holechip');
      return element?.textContent?.includes(`Hole ${number}`);
    }, index + 1);
    await settle(8);
  };

  const selectGreenThroughUi = async () => {
    const cameraSelect = page.locator('.ced-camera');
    await cameraSelect.waitFor({ state: 'visible' });
    await cameraSelect.selectOption('frame-hole');
    await settle(4);
    await cameraSelect.selectOption('green');
    await page.waitForFunction(() => document.querySelector('.ced-camera')?.value === 'green');
    await page.waitForTimeout(WARMUP_MS);
    await settle(12);
  };

  const probeComposition = async (expectedT) => page.evaluate(async ({ expectedT: routeT, epsilon }) => {
    const {
      COURSE_CAMERA_MODES,
      courseCameraPose,
      courseCameraRoute,
      sampleCourseCameraRoute,
    } = await import(new URL('src/sim/courseCamera.js', document.baseURI).href);
    const app = window.__fw;
    const scene3d = app.scene3d;
    const course = app.state.course;
    const hole = course.holes[6];
    const vecHole = course.vec?.holes?.find((entry) => entry.id === hole?.vecId) || null;
    if (!hole || !vecHole) throw new Error('The deterministic fixture does not contain authored Hole 7.');
    const options = {
      property: course,
      vecHole,
      heightAt: scene3d.heightAt,
      aspect: scene3d.camera.aspect,
      verticalFov: scene3d.camera.fov,
    };
    const pose = courseCameraPose(hole, COURSE_CAMERA_MODES.GREEN, options);
    const safe = pose.greenSafe || { x: 0.80, y: 0.74 };
    const solverEnvelope = pose.greenEnvelope;
    const solverFits = !!solverEnvelope
      && solverEnvelope.minDepth > 1
      && solverEnvelope.minX >= -safe.x - epsilon
      && solverEnvelope.maxX <= safe.x + epsilon
      && solverEnvelope.minY >= -safe.y - epsilon
      && solverEnvelope.maxY <= safe.y + epsilon;

    const rig = scene3d.rig;
    const angleDelta = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
    const rigDelta = {
      targetX: Math.abs(rig.target.x - pose.target.x),
      targetY: Math.abs(rig.target.y - pose.target.y),
      targetZ: Math.abs(rig.target.z - pose.target.z),
      yaw: angleDelta(rig.yaw, pose.yaw),
      pitch: Math.abs(rig.pitch - pose.pitch),
      dist: Math.abs(rig.dist - pose.dist),
    };
    const liveRigMatchesPose = Object.values(rigDelta).every((value) => value <= 0.001);

    const route = courseCameraRoute(hole, { property: course, vecHole });
    const routeInfo = sampleCourseCameraRoute(route, 0);
    const routeLength = Math.max(1e-6, routeInfo.length || 0);
    const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
    const tangentAt = (t, windowYd = 18) => {
      const dt = clamp(windowYd / routeLength, 0.002, 0.18);
      const a = sampleCourseCameraRoute(route, clamp(t - dt, 0, 1));
      const b = sampleCourseCameraRoute(route, clamp(t + dt, 0, 1));
      let x = b.x - a.x;
      let z = b.z - a.z;
      let length = Math.hypot(x, z);
      if (length <= 1e-6) {
        const point = sampleCourseCameraRoute(route, t);
        x = point.tx;
        z = point.tz;
        length = Math.hypot(x, z);
      }
      return length > 1e-6 ? { x: x / length, z: z / length } : { x: 0, z: 1 };
    };
    const points = [];
    const addWorldPoint = (label, point) => {
      points.push({
        label,
        x: point.x,
        y: scene3d.heightAt(point.x, point.z),
        z: point.z,
      });
    };
    for (let index = 0; index <= 8; index += 1) {
      const t = 0.86 + (1 - 0.86) * (index / 8);
      const center = sampleCourseCameraRoute(route, t);
      const tangent = tangentAt(t, 18);
      addWorldPoint(`approach-${index}-center`, center);
      addWorldPoint(`approach-${index}-left`, {
        x: center.x - tangent.z * 26,
        z: center.z + tangent.x * 26,
      });
      addWorldPoint(`approach-${index}-right`, {
        x: center.x + tangent.z * 26,
        z: center.z - tangent.x * 26,
      });
    }
    const toWorld = (point) => ({ x: scene3d.worldX(point.x), z: scene3d.worldZ(point.y) });
    for (const [index, point] of (vecHole.green?.pts || []).entries()) {
      addWorldPoint(`green-${index}`, toWorld(point));
    }
    const greenCenter = sampleCourseCameraRoute(route, 1);
    for (const [bunkerIndex, bunker] of (vecHole.bunkers || []).entries()) {
      const bunkerPoints = (bunker.pts || []).map(toWorld);
      if (!bunkerPoints.some((point) => (
        Math.hypot(point.x - greenCenter.x, point.z - greenCenter.z) <= 80
      ))) continue;
      for (const [pointIndex, point] of bunkerPoints.entries()) {
        addWorldPoint(`bunker-${bunkerIndex}-${pointIndex}`, point);
      }
    }

    const camera = scene3d.camera;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    const projected = points.map((point) => {
      const ndc = camera.position.clone().set(point.x, point.y, point.z).project(camera);
      return {
        label: point.label,
        x: +ndc.x.toFixed(6),
        y: +ndc.y.toFixed(6),
        z: +ndc.z.toFixed(6),
      };
    });
    const offenders = projected.filter((point) => (
      point.z < -1 - epsilon
      || point.z > 1 + epsilon
      || Math.abs(point.x) > safe.x + epsilon
      || Math.abs(point.y) > safe.y + epsilon
    ));
    const liveEnvelope = projected.reduce((envelope, point) => ({
      minX: Math.min(envelope.minX, point.x),
      maxX: Math.max(envelope.maxX, point.x),
      minY: Math.min(envelope.minY, point.y),
      maxY: Math.max(envelope.maxY, point.y),
      minZ: Math.min(envelope.minZ, point.z),
      maxZ: Math.max(envelope.maxZ, point.z),
    }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity });
    const canvasRect = scene3d.renderer.domElement.getBoundingClientRect();
    const safeBox = {
      left: canvasRect.left + canvasRect.width * (1 - safe.x) / 2,
      top: canvasRect.top + canvasRect.height * (1 - safe.y) / 2,
      width: canvasRect.width * safe.x,
      height: canvasRect.height * safe.y,
    };
    const routeTMatchesExpected = Math.abs(pose.routeT - routeT) <= 1e-9;
    return {
      selectedHole: {
        index: 6,
        number: 7,
        id: hole.id,
        name: hole.name,
        chipText: document.querySelector('.ced-holechip')?.textContent?.trim() || '',
      },
      selectedCameraValue: document.querySelector('.ced-camera')?.value || null,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio,
        cameraAspect: camera.aspect,
        verticalFov: camera.fov,
      },
      pose: {
        routeT: pose.routeT,
        pitch: pose.pitch,
        dist: pose.dist,
        target: pose.target,
        yaw: pose.yaw,
      },
      liveRig: {
        target: { x: rig.target.x, y: rig.target.y, z: rig.target.z },
        yaw: rig.yaw,
        pitch: rig.pitch,
        dist: rig.dist,
      },
      rigDelta,
      safe,
      safeBox,
      solver: {
        greenClipped: pose.greenClipped,
        envelope: solverEnvelope,
        fits: solverFits,
      },
      liveGeometry: {
        pointCount: projected.length,
        envelope: liveEnvelope,
        fits: projected.length > 0 && offenders.length === 0,
        offenders,
      },
      assertions: {
        selectedHole7: document.querySelector('.ced-holechip')?.textContent?.includes('Hole 7') === true,
        selectedGreenView: document.querySelector('.ced-camera')?.value === 'green',
        routeTMatchesExpected,
        liveRigMatchesPose,
        solverFits,
        liveGeometryFits: projected.length > 0 && offenders.length === 0,
      },
    };
  }, { expectedT, epsilon: SAFE_EPSILON });

  const captureSafeOverlay = async (composition, name) => {
    await page.evaluate(({ box, safe }) => {
      document.getElementById('course-green-camera-safe-box')?.remove();
      const overlay = document.createElement('div');
      overlay.id = 'course-green-camera-safe-box';
      Object.assign(overlay.style, {
        position: 'fixed',
        left: `${box.left}px`,
        top: `${box.top}px`,
        width: `${box.width}px`,
        height: `${box.height}px`,
        boxSizing: 'border-box',
        border: '3px solid #f4bf4f',
        boxShadow: '0 0 0 1px rgba(20, 38, 29, 0.95), inset 0 0 0 1px rgba(255,255,255,0.5)',
        pointerEvents: 'none',
        zIndex: '2147483647',
      });
      const label = document.createElement('span');
      label.textContent = `Camera safe area |x| <= ${safe.x.toFixed(2)}, |y| <= ${safe.y.toFixed(2)}`;
      Object.assign(label.style, {
        position: 'absolute',
        left: '6px',
        top: '6px',
        padding: '3px 6px',
        color: '#fff8de',
        background: 'rgba(20, 38, 29, 0.88)',
        font: '12px/1.2 system-ui, sans-serif',
      });
      overlay.append(label);
      document.body.append(overlay);
    }, { box: composition.safeBox, safe: composition.safe });
    const path = await screenshot(name);
    await page.evaluate(() => document.getElementById('course-green-camera-safe-box')?.remove());
    return path;
  };

  const captureAspect = async (viewport) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await settle(8);
    await selectGreenThroughUi();
    const assets = await waitForAssets();
    await settle(12);
    const sceneStability = await waitForSceneStable({ stableSamples: 4, timeoutMs: 15000 });
    if (!sceneStability.pass) throw new Error(`Scene resources did not settle at ${viewport.key}.`);
    const composition = await probeComposition(expectedRouteT);
    const rawScreenshot = await screenshot(`hole07_green_${viewport.key}_raw`);
    const safeScreenshot = await captureSafeOverlay(
      composition,
      `hole07_green_${viewport.key}_safe`,
    );
    const samples = [];
    for (let index = 0; index < SAMPLE_COUNT; index += 1) {
      await selectGreenThroughUi();
      samples.push(await sampleFrameTimes(SAMPLE_DURATION_MS));
    }
    const finalComposition = await probeComposition(expectedRouteT);
    return {
      viewport,
      assets,
      sceneStability,
      screenshots: { raw: rawScreenshot, safeOverlay: safeScreenshot },
      composition,
      finalComposition,
      performance: summarizeSamples(samples),
      resources: await sceneCensus(),
    };
  };

  const resourceDelta = (before, after) => {
    const result = {};
    for (const key of [
      'sceneNodes', 'meshes', 'visibleMeshes', 'instancedMeshes', 'renderedInstances',
      'materialCount', 'textureCountScene', 'textureCountRenderer',
      'textureMemoryEstimateBytes', 'geometryCount', 'programCount',
      'jsHeapUsedBytes', 'jsHeapTotalBytes', 'shadowBakes',
    ]) {
      const a = before?.[key];
      const b = after?.[key];
      result[key] = Number.isFinite(a) && Number.isFinite(b) ? b - a : null;
    }
    return result;
  };

  const percentDelta = (baseline, candidate) => (
    Number.isFinite(baseline) && Number.isFinite(candidate) && baseline !== 0
      ? +(((candidate - baseline) / Math.abs(baseline)) * 100).toFixed(3)
      : null
  );

  const buildBaselineComparison = async (candidateViews, candidateEnvironment, stability) => {
    if (isBaseline) return { available: false, required: false, reason: 'Baseline run.' };
    let baseline;
    try {
      baseline = JSON.parse(await readFile(baselineResultPath, 'utf8'));
    } catch (error) {
      return {
        available: false,
        required: true,
        path: baselineResultPath,
        pass: false,
        reason: `Could not read baseline result: ${error.message}`,
      };
    }
    const qualification = {
      schemaVersion: baseline.schemaVersion === SCHEMA_VERSION,
      baselineMode: baseline.mode === 'baseline-094',
      viewportKeys: JSON.stringify(Object.keys(baseline.views || {}))
        === JSON.stringify(VIEWPORTS.map((entry) => entry.key)),
      sampleCount: baseline.protocol?.sampleCount === SAMPLE_COUNT,
      sampleDurationMs: baseline.protocol?.sampleDurationMs === SAMPLE_DURATION_MS,
      devicePixelRatio: baseline.environment?.devicePixelRatio === candidateEnvironment.devicePixelRatio,
      userAgent: baseline.environment?.userAgent === candidateEnvironment.userAgent,
      webglRenderer: baseline.environment?.webglRenderer === candidateEnvironment.webglRenderer,
    };
    const qualified = Object.values(qualification).every(Boolean);
    const rows = [];
    const addRow = (viewportKey, metric, baselineValue, candidateValue, direction, tolerancePercent) => {
      const deltaPercent = percentDelta(baselineValue, candidateValue);
      const pass = deltaPercent != null && (
        direction === 'higher-is-better'
          ? deltaPercent >= -tolerancePercent
          : deltaPercent <= tolerancePercent
      );
      rows.push({
        viewport: viewportKey,
        metric,
        unit: metric.toLowerCase().includes('fps') ? 'fps'
          : (metric.toLowerCase().includes('frame') ? 'ms' : 'per-frame'),
        baseline: baselineValue,
        candidate: candidateValue,
        absoluteDelta: Number.isFinite(baselineValue) && Number.isFinite(candidateValue)
          ? +(candidateValue - baselineValue).toFixed(3) : null,
        deltaPercent,
        direction,
        tolerancePercent,
        pass,
      });
    };
    for (const viewport of VIEWPORTS) {
      const previous = baseline.views?.[viewport.key]?.performance;
      const current = candidateViews?.[viewport.key]?.performance;
      if (!previous || !current) continue;
      addRow(viewport.key, 'averageFps', previous.averageFps, current.averageFps, 'higher-is-better', 5);
      addRow(viewport.key, 'onePercentLowFps', previous.onePercentLowFps, current.onePercentLowFps, 'higher-is-better', 5);
      addRow(viewport.key, 'p99FrameMs', previous.p99FrameMs, current.p99FrameMs, 'lower-is-better', 10);
      addRow(viewport.key, 'worstFrameMs', previous.worstFrameMs, current.worstFrameMs, 'lower-is-better', 10);
      addRow(viewport.key, 'drawCallsPerFrame', previous.drawCallsPerFrame, current.drawCallsPerFrame, 'lower-is-better', 5);
      addRow(viewport.key, 'trianglesPerFrame', previous.trianglesPerFrame, current.trianglesPerFrame, 'lower-is-better', 5);
    }
    const baselineAfter = baseline.stability?.resourcesAfter;
    const resourceRows = [
      'materialCount',
      'textureCountScene',
      'textureCountRenderer',
      'geometryCount',
      'programCount',
    ].map((metric) => {
      const baselineValue = baselineAfter?.[metric];
      const candidateValue = stability.resourcesAfter?.[metric];
      return {
        metric,
        baseline: baselineValue,
        candidate: candidateValue,
        absoluteDelta: Number.isFinite(baselineValue) && Number.isFinite(candidateValue)
          ? candidateValue - baselineValue : null,
        pass: Number.isFinite(baselineValue) && Number.isFinite(candidateValue)
          ? candidateValue === baselineValue : false,
      };
    });
    return {
      available: true,
      required: true,
      path: baselineResultPath,
      qualification,
      qualified,
      tolerances: {
        averageAndOnePercentLowFpsRegressionPercent: 5,
        p99AndWorstFrameRegressionPercent: 10,
        drawCallsAndTrianglesRegressionPercent: 5,
        resourceCounts: 'exact after identical warm-up',
      },
      rows,
      resourceRows,
      pass: qualified && rows.length === VIEWPORTS.length * 6
        && rows.every((row) => row.pass)
        && resourceRows.every((row) => row.pass),
    };
  };

  // The runner's --bootstrap navigation establishes the save fixture. This
  // deliberate reload is the measured document and, for the baseline only, is
  // where the guarded response substitution is applied.
  await page.setViewportSize({ width: 1600, height: 900 });
  qaDocumentCommitted = false;
  qaDocumentRequests = new WeakSet();
  await page.goto('http://localhost:8457/', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(() => document.readyState === 'complete');
  if (isBaseline && (!baselineOverride.applied || baselineOverride.replacements !== 1)) {
    throw new Error(baselineOverride.guardError || 'Synthetic 0.94 baseline override was not applied.');
  }
  const continueButton = page.getByRole('button', { name: 'Continue', exact: true });
  await continueButton.waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForFunction(() => {
    const button = [...document.querySelectorAll('button')]
      .find((entry) => entry.textContent.trim() === 'Continue');
    return button && !button.disabled;
  });
  await continueButton.click();
  await page.waitForFunction(() => (
    window.__fw?.state?.course?.vec
      && window.__fw?.scene3d?.renderer
      && window.__fw?.editorUi?.()
  ), null, { timeout: 90000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || getComputedStyle(veil).opacity === '0';
  }, null, { timeout: 90000 });
  await page.evaluate(() => {
    const app = window.__fw;
    app.speedIdx = 0;
    app.state.weather.locked = true;
    app.state.weather.today = {
      tempHiF: 74,
      tempLoF: 55,
      rainIn: 0,
      humidity: 0.4,
      windMph: 6,
    };
    app.scene3d.setGolfersFrozen?.(true);
    app.scene3d.clearGolfers?.();
    const clubhouse = app.scene3d.clubhouse?.();
    clubhouse?.setOrganicWalkins?.(false);
    clubhouse?.clearWalkins?.();
  });
  const initialAssetBarrier = await waitForAssets();
  const initialClubhouseAssets = await waitForClubhouseAssets();
  const customersBefore = await page.evaluate(() => {
    const customers = window.__fw?.scene3d?.clubhouse?.()?.customers;
    const collection = typeof customers === 'function' ? customers() : customers;
    return Array.isArray(collection) ? collection.length : null;
  });
  if (customersBefore !== 0) {
    throw new Error(`Camera QA customer isolation failed before measurement: ${customersBefore}.`);
  }
  const golfersBefore = await page.evaluate(() => (
    window.__fw?.scene3d?.golferCount?.() ?? null
  ));
  if (golfersBefore !== 0) {
    throw new Error(`Camera QA golfer isolation failed before measurement: ${golfersBefore}.`);
  }

  // Normal player path: J opens the editor; visible hole cards and top-bar select
  // establish Hole 7 Green View. No scene camera setter is used by the harness.
  await page.keyboard.press('j');
  await page.waitForFunction(() => window.__fw.editorUi().isActive());
  await page.locator('.ced-root').waitFor({ state: 'visible' });
  await settle(16);
  await selectHoleThroughUi(6);
  await selectGreenThroughUi();
  await waitForAssets();
  await settle(12);
  const initialSceneStability = await waitForSceneStable();
  if (!initialSceneStability.pass) {
    throw new Error('Scene resources did not reach a stable warmed census before measurement.');
  }

  cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  await cdp.send('HeapProfiler.enable');
  const environment = await page.evaluate(() => {
    const canvas = window.__fw.scene3d.renderer.domElement;
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    const extension = gl?.getExtension('WEBGL_debug_renderer_info');
    return {
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      hardwareConcurrency: navigator.hardwareConcurrency,
      deviceMemoryGiB: navigator.deviceMemory ?? null,
      devicePixelRatio: window.devicePixelRatio,
      webglVendor: extension ? gl.getParameter(extension.UNMASKED_VENDOR_WEBGL) : null,
      webglRenderer: extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : null,
    };
  });
  const browserBefore = await browserCensus({ collectGarbage: true });
  const listenersBefore = await listenerCensus();
  const resourcesBefore = await sceneCensus();
  const sceneInventoryBefore = await sceneInventory();

  const views = {};
  for (const viewport of VIEWPORTS) {
    views[viewport.key] = await captureAspect(viewport);
  }

  // Repeat the exact visible preset interaction after both measured views. This
  // is outside the idle timing windows and exists to expose listener, retained
  // heap, resource-residency, and UI-update growth.
  await page.setViewportSize({ width: 1600, height: 900 });
  await settle(8);
  await startUiMutationProbe('ten-visible-frame-green-cycles');
  for (let cycle = 0; cycle < VISIBLE_SELECT_CYCLES; cycle += 1) {
    await page.locator('.ced-camera').selectOption('frame-hole');
    await settle(2);
    await page.locator('.ced-camera').selectOption('green');
    await page.waitForFunction(() => document.querySelector('.ced-camera')?.value === 'green');
    await settle(2);
  }
  const cycleUiMutations = await stopUiMutationProbe();
  await page.waitForTimeout(WARMUP_MS);
  await waitForAssets();
  await settle(12);
  const finalSceneStability = await waitForSceneStable();
  if (!finalSceneStability.pass) {
    throw new Error('Scene resources did not settle after repeated visible camera selection.');
  }
  const finalComposition = await probeComposition(expectedRouteT);
  const resourcesAfter = await sceneCensus();
  const customersAfter = await page.evaluate(() => {
    const customers = window.__fw?.scene3d?.clubhouse?.()?.customers;
    const collection = typeof customers === 'function' ? customers() : customers;
    return Array.isArray(collection) ? collection.length : null;
  });
  const golfersAfter = await page.evaluate(() => (
    window.__fw?.scene3d?.golferCount?.() ?? null
  ));
  const sceneInventoryAfter = await sceneInventory();
  const browserAfter = await browserCensus({ collectGarbage: true });
  const listenersAfter = await listenerCensus();
  await cdp.send('Runtime.releaseObjectGroup', { objectGroup: 'course-green-camera-listeners' });

  const stability = {
    visibleSelectCycles: VISIBLE_SELECT_CYCLES,
    cycleUiMutations,
    initialSceneStability,
    finalSceneStability,
    resourcesBefore,
    resourcesAfter,
    resourceDelta: resourceDelta(resourcesBefore, resourcesAfter),
    sceneInventoryDiff: diffSceneInventories(sceneInventoryBefore, sceneInventoryAfter),
    browserBefore,
    browserAfter,
    forcedGcHeapDeltaBytes: Number.isFinite(browserBefore.jsHeapUsedBytes)
      && Number.isFinite(browserAfter.jsHeapUsedBytes)
      ? browserAfter.jsHeapUsedBytes - browserBefore.jsHeapUsedBytes : null,
    listenersBefore,
    listenersAfter,
    fullDocumentListenerDelta: listenersAfter.fullDocument.jsEventListeners
      - listenersBefore.fullDocument.jsEventListeners,
    sampledTargetListenerDelta: listenersAfter.sampledTargets.total
      - listenersBefore.sampledTargets.total,
    customerIsolation: {
      organicWalkinsDisabled: true,
      customersBefore,
      customersAfter,
      pass: customersBefore === 0 && customersAfter === 0,
    },
    golferIsolation: {
      frozen: true,
      golfersBefore,
      golfersAfter,
      pass: golfersBefore === 0 && golfersAfter === 0,
    },
  };
  const comparison = await buildBaselineComparison(views, environment, stability);
  const allCompositions = [
    ...Object.values(views).flatMap((entry) => [entry.composition, entry.finalComposition]),
    finalComposition,
  ];
  const operationalCompositionPass = allCompositions.every((entry) => (
    entry.assertions.selectedHole7
      && entry.assertions.selectedGreenView
      && entry.assertions.routeTMatchesExpected
      && entry.assertions.liveRigMatchesPose
  ));
  const candidateSafeAreaPass = allCompositions.every((entry) => (
    entry.assertions.solverFits
      && entry.assertions.liveGeometryFits
      && entry.solver.greenClipped === false
  ));
  const baselineRegressionReproduced = isBaseline
    && views['4x3'].composition.solver.greenClipped === true
    && (!views['4x3'].composition.solver.fits
      || !views['4x3'].composition.liveGeometry.fits);
  const diagnosticsPass = diagnostics.console.length === 0
    && diagnostics.pageErrors.length === 0
    && diagnostics.failedRequests.length === 0;
  const performanceComplete = Object.values(views).every((entry) => (
    entry.performance.sampleCount === SAMPLE_COUNT
      && entry.performance.samples.every((sample) => sample.frames > 0
        && sample.rawFrameDeltasMs.length === sample.frames)
  ));
  const retainedHeapPass = Number.isFinite(stability.forcedGcHeapDeltaBytes)
    && stability.forcedGcHeapDeltaBytes <= 4 * 1024 * 1024;
  const listenerStabilityPass = stability.fullDocumentListenerDelta <= 0
    && stability.sampledTargetListenerDelta <= 0;
  const customerIsolationPass = stability.customerIsolation.pass;
  const golferIsolationPass = stability.golferIsolation.pass;
  const resourceStabilityPass = [
    'sceneNodes',
    'meshes',
    'materialCount',
    'textureCountScene',
    'textureCountRenderer',
    'geometryCount',
    'programCount',
  ].every((key) => Number.isFinite(stability.resourceDelta[key])
    && stability.resourceDelta[key] <= 0);
  const baselineReferencePass = isBaseline
    && operationalCompositionPass
    && candidateSafeAreaPass;
  const acceptance = {
    diagnosticsPass,
    baselineOverridePass: !isBaseline || (
      baselineOverride.applied
        && baselineOverride.replacements === 1
        && baselineOverride.handlerCalls === 1
        && !baselineOverride.guardError
    ),
    operationalCompositionPass,
    candidateSafeAreaPass,
    baselineReferencePass,
    baselineRegressionReproduced,
    performanceComplete,
    retainedHeapPass,
    listenerStabilityPass,
    customerIsolationPass,
    golferIsolationPass,
    resourceStabilityPass,
    performanceComparisonPass: isBaseline ? null : comparison.pass === true,
  };
  const ok = diagnosticsPass
    && acceptance.baselineOverridePass
    && operationalCompositionPass
    && performanceComplete
    && retainedHeapPass
    && listenerStabilityPass
    && customerIsolationPass
    && golferIsolationPass
    && resourceStabilityPass
    && (isBaseline
      ? baselineReferencePass
      : candidateSafeAreaPass && comparison.pass === true);

  return {
    schemaVersion: SCHEMA_VERSION,
    ok,
    generatedAt: new Date().toISOString(),
    mode,
    phase,
    launch: 'HEADED=1 node tools/qa/run-playwright.cjs tools/qa/course-green-camera-qa.js --bootstrap',
    fixture: 'runner --bootstrap; relaxed empire seed 424242; first property; fixed dry midday weather; simulation speed 0; golfers frozen and cleared; organic walk-ins disabled and cleared',
    source: {
      candidateUsesUnmodifiedApplicationSource: !isBaseline,
      expectedGreenTargetT: expectedRouteT,
      baselineOverride,
    },
    readiness: {
      initialAssetBarrier,
      initialClubhouseAssets,
      initialSceneStability,
    },
    protocol: {
      normalControlRoute: [
        'keyboard J',
        'visible Hole chip',
        'visible seventh Hole card',
        'visible Frame it button',
        'visible camera select: Frame Hole then Green View',
      ],
      viewports: VIEWPORTS,
      deviceScaleFactor: 1,
      sampleCount: SAMPLE_COUNT,
      sampleDurationMs: SAMPLE_DURATION_MS,
      warmupMs: WARMUP_MS,
      visibleSelectCycles: VISIBLE_SELECT_CYCLES,
      rendererMeasurement: 'renderer.info.autoReset=false during each bounded sample; every EffectComposer pass accumulates and totals are divided by observed display frames',
      onePercentLowDefinition: '1000 / arithmetic mean of slowest ceil(frameCount * 0.01) raw requestAnimationFrame deltas',
      safeArea: { ndcX: 0.80, ndcY: 0.74 },
      proposedRegressionTolerances: {
        averageAndOnePercentLowFpsPercent: 5,
        p99AndWorstFramePercent: 10,
        drawCallsAndTrianglesPercent: 5,
        retainedForcedGcHeapMiB: 4,
        eventListenerGrowth: 0,
      },
    },
    initialAssetBarrier,
    environment,
    views,
    finalComposition,
    stability,
    comparison,
    acceptance,
    artifacts: {
      root: outDir,
      results: process.env.QA_RESULT_PATH || null,
      videoDirectory: process.env.VIDEO_DIR || null,
      screenshots: Object.fromEntries(Object.entries(views).map(([key, entry]) => [key, entry.screenshots])),
    },
    diagnostics,
  };
}
