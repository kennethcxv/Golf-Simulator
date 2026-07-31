// Course Editor stroke performance probe.
//
// Measures the thing a player actually feels: dragging the terrain brush. Two
// independent views, because one alone is misleading.
//
//   1. Synthetic — time refreshGround() directly, the call every stroke tick
//      makes. Decomposed so the terrain-mesh share and the visual-field share
//      are separable rather than one opaque number.
//   2. Real — drive an actual pointer drag through the editor's own handlers
//      and record raw frame deltas. This is the honest user-facing figure; the
//      synthetic number cannot see throttling or renderer stalls.
//
// Run:
//   QA_BASE_URL='http://localhost:8467/' COURSE_QA_PHASE='stroke_before' \
//   node tools/qa/run-playwright.cjs tools/qa/course-editor-stroke-perf.js --bootstrap
async (page) => {
  const phase = process.env.COURSE_QA_PHASE || 'stroke_baseline';
  const outDir = `qa/course_master_final/${phase}`;
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const diagnostics = { console: [], pageErrors: [] };

  // Install before the QA navigation so Three's first context uses these
  // wrappers. They measure the synchronous browser/driver submission cost and
  // the actual sub-ranges requested by the runtime; no source-text inference.
  await page.addInitScript(() => {
    const makeCounter = () => ({ calls: 0, bytes: 0, totalMs: 0, maxMs: 0 });
    const probe = {
      bufferSubData: makeCounter(),
      texSubImage2D: makeCounter(),
      reset() {
        this.bufferSubData = makeCounter();
        this.texSubImage2D = makeCounter();
      },
    };
    window.__courseGpuProbe = probe;

    const wrap = (prototype, method, measureBytes) => {
      if (!prototype || prototype[`__courseWrapped_${method}`]) return;
      const original = prototype[method];
      if (typeof original !== 'function') return;
      Object.defineProperty(prototype, `__courseWrapped_${method}`, { value: true });
      prototype[method] = function measuredGpuSubmission(...args) {
        const started = performance.now();
        try {
          return Reflect.apply(original, this, args);
        } finally {
          const elapsed = performance.now() - started;
          const counter = window.__courseGpuProbe?.[method];
          if (counter) {
            counter.calls += 1;
            counter.bytes += Math.max(0, Number(measureBytes.call(this, args)) || 0);
            counter.totalMs += elapsed;
            counter.maxMs = Math.max(counter.maxMs, elapsed);
          }
        }
      };
    };

    const bufferBytes = (args) => {
      const data = args[2];
      if (!ArrayBuffer.isView(data)) return data?.byteLength || 0;
      const bytesPerElement = data.BYTES_PER_ELEMENT || 1;
      const sourceOffset = Number(args[3]) || 0;
      const elementLength = Number.isFinite(args[4])
        ? Number(args[4])
        : Math.max(0, data.length - sourceOffset);
      return elementLength * bytesPerElement;
    };
    const textureBytes = function textureBytes(args) {
      if (args.length < 9) return 0;
      const width = Number(args[4]) || 0;
      const height = Number(args[5]) || 0;
      const format = args[6];
      const type = args[7];
      const components = format === this.RGBA ? 4
        : format === this.RGB ? 3
          : format === this.RG ? 2 : 1;
      const bytesPerComponent = type === this.FLOAT || type === this.UNSIGNED_INT || type === this.INT ? 4
        : type === this.HALF_FLOAT || type === this.UNSIGNED_SHORT || type === this.SHORT ? 2 : 1;
      return width * height * components * bytesPerComponent;
    };
    for (const prototype of [
      globalThis.WebGLRenderingContext?.prototype,
      globalThis.WebGL2RenderingContext?.prototype,
    ]) {
      wrap(prototype, 'bufferSubData', bufferBytes);
      wrap(prototype, 'texSubImage2D', textureBytes);
    }
  });

  page.on('console', (m) => {
    if (m.type() === 'error') diagnostics.console.push(m.text());
  });
  page.on('pageerror', (e) => diagnostics.pageErrors.push(e.message));

  await page.goto(baseUrl);
  await page.waitForFunction(() => document.readyState === 'complete');
  const cont = page.getByRole('button', { name: 'Continue', exact: true });
  await cont.waitFor({ state: 'visible' });
  await page.waitForFunction(() => {
    const b = [...document.querySelectorAll('button')].find((i) => i.textContent.trim() === 'Continue');
    return b && !b.disabled;
  });
  await cont.click();
  await page.waitForFunction(
    () => window.__fw?.state?.course?.vec && window.__fw?.scene3d && window.__fw?.editorUi?.(),
    null, { timeout: 90000 },
  );
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 90000 });

  await page.evaluate(() => {
    const w = window.__fw.state.weather;
    w.locked = true;
    w.today = { tempHiF: 74, tempLoF: 55, rainIn: 0, humidity: 0.4, windMph: 6 };
  });

  await page.keyboard.press('j');
  await page.waitForFunction(() => window.__fw.editorUi().isActive());
  await page.locator('.ced-root').waitFor({ state: 'visible' });
  await page.evaluate(() => new Promise((r) => {
    let n = 20;
    const t = () => (--n <= 0 ? r() : requestAnimationFrame(t));
    requestAnimationFrame(t);
  }));

  // ---- 1. synthetic: the exact call a stroke tick makes -------------------
  const synthetic = await page.evaluate(async () => {
    const scene = window.__fw.scene3d;
    const st = window.__fw.state;
    const stats = (samples) => {
      const o = samples.slice().sort((a, b) => a - b);
      return {
        runs: o.length,
        medianMs: +o[Math.floor(o.length / 2)].toFixed(3),
        meanMs: +(samples.reduce((a, b) => a + b, 0) / samples.length).toFixed(3),
        minMs: +o[0].toFixed(3),
        maxMs: +o[o.length - 1].toFixed(3),
      };
    };
    const time = (fn, runs = 12) => {
      fn(); // warm: first call pays lazy relief/geometry allocation
      const out = [];
      for (let i = 0; i < runs; i++) {
        const t0 = performance.now();
        fn();
        out.push(performance.now() - t0);
      }
      return stats(out);
    };

    // A brush stroke is ~2 cells across. This is the dirty area that SHOULD
    // matter; everything above it is waste.
    const centre = { x: 60, y: 40 };
    const rect = { x0: centre.x - 3, y0: centre.y - 3, x1: centre.x + 3, y1: centre.y + 3 };

    const visual = await import('/src/render3d/visualField.js');
    const probeField = visual.makeVisualField(st.course);
    const probeDistance = visual.makeSurfaceDistanceField(probeField);

    return {
      // full-course rebuild: the cost a stamp used to pay unconditionally
      fullRebuildCall: time(() => scene.refreshGround(st, {})),
      // the live terrain tick after scoping (what the drag does now)
      liveTerrainTick: time(() => scene.refreshGround(st, { zones: false, terrainRect: rect })),
      // paint's live tick
      paintTick: time(() => scene.updateZoneField(st, rect, { padding: 2 }), 8),
      visualFieldRegion: time(() => visual.updateVisualFieldRegion(
        st.course, probeField, rect.x0, rect.y0, rect.x1, rect.y1, 2,
      ), 8),
      surfaceDistanceRegion: time(() => visual.updateSurfaceDistanceFieldRegion(
        st.course, probeField, probeDistance, rect.x0, rect.y0, rect.x1, rect.y1, 2,
      ), 8),
      turfPackFull: time(() => scene.updateTurf(st), 8),
      waterRebuild: time(() => scene.rebuildWater(), 4),
      pathRebuild: time(() => scene.rebuildPaths(), 4),
      objectRebuild: time(() => scene.rebuildObjects(), 4),
      floraRebuild: time(() => scene.rebuildTrees(), 4),
      // stamp tools (green/bunker/water/tee): relief invalidation forces a full
      // terrain rebuild today, even though the feature is local
      stampCall: time(() => scene.refreshGround(st, {
        relief: true, holes: true, zoneRect: rect,
      }), 6),
      // the same stamp with the mesh rebuild scoped to the feature
      stampCallScoped: time(() => scene.refreshGround(st, {
        relief: true, holes: true, zoneRect: rect, terrainRect: rect,
      }), 6),
      // what undo/redo/discard costs today: everything, unscoped
      undoRefresh: time(() => scene.refreshGround(st, {
        water: true, objects: true, paths: true, holes: true, flow: true, relief: true,
      }), 4),
      // the same without rebuilding every tree and object
      undoRefreshNoObjects: time(() => scene.refreshGround(st, {
        water: true, objects: false, paths: true, holes: true, flow: true, relief: true,
      }), 4),
      // and with the surface field scoped as well
      undoRefreshScoped: time(() => scene.refreshGround(st, {
        water: true, objects: false, paths: true, holes: true, flow: true, relief: true,
        zoneRect: rect, terrainRect: rect,
      }), 4),
    };
  });

  // ---- 2. real: drag the terrain brush through the editor's own handlers --
  await page.evaluate(() => {
    const ui = window.__fw.editorUi();
    if (ui.qa?.selectTool) ui.qa.selectTool('terrain');
  });
  const terrainBtn = page.locator('.ced-tool', { hasText: 'Terrain' }).first();
  if (await terrainBtn.count()) await terrainBtn.click().catch(() => {});
  await page.evaluate(() => new Promise((r) => {
    let n = 10;
    const t = () => (--n <= 0 ? r() : requestAnimationFrame(t));
    requestAnimationFrame(t);
  }));

  const canvas = page.locator('canvas').first();
  const box = await canvas.boundingBox();
  const cx = box.x + box.width * 0.55;
  const cy = box.y + box.height * 0.55;
  const elevationFingerprint = () => page.evaluate(() => {
    const elevation = window.__fw.state.course.elevation;
    const bytes = new Uint8Array(elevation.buffer, elevation.byteOffset, elevation.byteLength);
    let hash = 2166136261;
    for (let index = 0; index < bytes.length; index += 1) hash = Math.imul(hash ^ bytes[index], 16777619);
    return { length: elevation.length, hash: hash >>> 0 };
  });
  const terrainDataBefore = await elevationFingerprint();

  await page.evaluate(() => {
    window.__courseGpuProbe?.reset?.();
    window.__fw.scene3d.resetEditorPerformanceStats?.();
    const canvas = document.querySelector('canvas');
    window.__strokeProbe = {
      deltas: [], inputToFrameMs: [], running: true, last: performance.now(),
    };
    const onPointerMove = () => {
      const probe = window.__strokeProbe;
      if (!probe?.running) return;
      const inputAt = performance.now();
      requestAnimationFrame(() => {
        if (probe.running) probe.inputToFrameMs.push(performance.now() - inputAt);
      });
    };
    window.__strokeProbe.onPointerMove = onPointerMove;
    canvas?.addEventListener('pointermove', onPointerMove, { capture: true });
    const tick = (now) => {
      const p = window.__strokeProbe;
      if (!p.running) return;
      const d = now - p.last;
      p.last = now;
      if (d > 0) p.deltas.push(d);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 0; i < 24; i++) {
    await page.mouse.move(cx + i * 4, cy + Math.sin(i / 3) * 20);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  await page.evaluate(() => new Promise((r) => {
    let n = 10;
    const t = () => (--n <= 0 ? r() : requestAnimationFrame(t));
    requestAnimationFrame(t);
  }));

  const drag = await page.evaluate(() => {
    const p = window.__strokeProbe;
    p.running = false;
    document.querySelector('canvas')?.removeEventListener('pointermove', p.onPointerMove, { capture: true });
    const d = p.deltas;
    const o = d.slice().sort((a, b) => a - b);
    const mean = d.reduce((a, b) => a + b, 0) / Math.max(1, d.length);
    const slowCount = Math.max(1, Math.ceil(o.length * 0.01));
    const slowMean = o.slice(-slowCount).reduce((a, b) => a + b, 0) / slowCount;
    const input = p.inputToFrameMs.slice().sort((a, b) => a - b);
    const inputMean = p.inputToFrameMs.reduce((sum, value) => sum + value, 0) / Math.max(1, p.inputToFrameMs.length);
    return {
      frames: d.length,
      averageFps: +(1000 / mean).toFixed(2),
      averageFrameMs: +mean.toFixed(3),
      onePercentLowFps: +(1000 / Math.max(0.001, slowMean)).toFixed(2),
      medianFrameMs: +o[Math.floor(o.length / 2)].toFixed(3),
      worstFrameMs: +o[o.length - 1].toFixed(3),
      framesOver33ms: d.filter((x) => x > 33).length,
      framesOver100ms: d.filter((x) => x > 100).length,
      inputToFrame: {
        samples: input.length,
        meanMs: +inputMean.toFixed(3),
        medianMs: +(input[Math.floor(input.length / 2)] || 0).toFixed(3),
        p99Ms: +(input[Math.min(input.length - 1, Math.floor(input.length * 0.99))] || 0).toFixed(3),
        maxMs: +(input.at(-1) || 0).toFixed(3),
      },
      rawFrameDeltasMs: d.map((x) => +x.toFixed(2)),
    };
  });
  const terrainDataAfter = await elevationFingerprint();

  const terrainGpu = await page.evaluate(() => {
    const probe = window.__courseGpuProbe;
    return probe ? JSON.parse(JSON.stringify({
      bufferSubData: probe.bufferSubData,
      texSubImage2D: probe.texSubImage2D,
    })) : null;
  });
  const terrainRuntimeCosts = await page.evaluate(
    () => window.__fw.scene3d.editorPerformanceSnapshot?.() || null,
  );

  await page.screenshot({ path: `${outDir}/terrain_stroke.png` });

  // ---- 3. correctness: a SCOPED undo must leave no stale geometry ---------
  // The whole scoped-refresh approach fails silently if a rect is too small:
  // the data rolls back but the mesh keeps the old land outside the window.
  // Compare the mesh after scoped undo and redo against forced full rebuilds.
  // Both actions go through the real toolbar controls, not test hooks.
  const compareTerrainMeshToFull = (phaseLabel) => page.evaluate(async (label) => {
    const scene = window.__fw.scene3d;
    const st = window.__fw.state;
    let terrain = null;
    scene.scene.traverse((object) => {
      if (!terrain && object.isMesh && object.geometry?.attributes?.position?.count > 100000) terrain = object;
    });
    if (!terrain) return { phase: label, skipped: 'terrain mesh not found' };
    const snapshot = () => Float32Array.from(terrain.geometry.attributes.position.array);
    const afterScopedRefresh = snapshot();
    scene.refreshGround(st, {
      water: true, objects: true, paths: true, holes: true, flow: true, relief: true,
    });
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const afterFullRebuild = snapshot();
    let maxDelta = 0;
    let differing = 0;
    for (let index = 0; index < afterFullRebuild.length; index += 1) {
      const delta = Math.abs(afterScopedRefresh[index] - afterFullRebuild[index]);
      if (delta > 1e-4) differing += 1;
      if (delta > maxDelta) maxDelta = delta;
    }
    return {
      phase: label,
      vertexComponents: afterFullRebuild.length,
      differingComponents: differing,
      maxDeltaYd: +maxDelta.toFixed(6),
    };
  }, phaseLabel);
  const settleHistory = () => page.evaluate(() => new Promise((resolve) => {
    let frames = 6;
    const tick = () => (--frames <= 0 ? resolve() : requestAnimationFrame(tick));
    requestAnimationFrame(tick);
  }));

  const undoBtn = page.locator('.ced-top button', { hasText: 'Undo' }).first();
  const undoClicked = await undoBtn.count() > 0;
  const undoStarted = Date.now();
  if (undoClicked) await undoBtn.click({ force: true }).catch(() => {});
  await settleHistory();
  const undoDurationMs = Date.now() - undoStarted;
  const terrainDataAfterUndo = await elevationFingerprint();
  const undoIntegrity = undoClicked
    ? await compareTerrainMeshToFull('undo')
    : { phase: 'undo', skipped: 'undo control not found' };

  const redoBtn = page.locator('.ced-top button', { hasText: 'Redo' }).first();
  const redoClicked = await redoBtn.count() > 0;
  const redoStarted = Date.now();
  if (redoClicked) await redoBtn.click({ force: true }).catch(() => {});
  await settleHistory();
  const redoDurationMs = Date.now() - redoStarted;
  const terrainDataAfterRedo = await elevationFingerprint();
  const redoIntegrity = redoClicked
    ? await compareTerrainMeshToFull('redo')
    : { phase: 'redo', skipped: 'redo control not found' };
  const terrainDataIntegrity = {
    changedByStroke: terrainDataAfter.hash !== terrainDataBefore.hash,
    undoRestoredExact: terrainDataAfterUndo.length === terrainDataBefore.length
      && terrainDataAfterUndo.hash === terrainDataBefore.hash,
    redoRestoredExact: terrainDataAfterRedo.length === terrainDataAfter.length
      && terrainDataAfterRedo.hash === terrainDataAfter.hash,
    before: terrainDataBefore,
    after: terrainDataAfter,
    afterUndo: terrainDataAfterUndo,
    afterRedo: terrainDataAfterRedo,
  };
  const historyTimings = { undoDurationMs, redoDurationMs };

  // ---- 4. real paint drag + input-to-next-frame latency -------------------
  await page.evaluate(() => {
    const ui = window.__fw.editorUi();
    if (ui.qa?.setTool) ui.qa.setTool('paint');
    else if (ui.qa?.selectTool) ui.qa.selectTool('paint');
  });
  const paintBtn = page.locator('.ced-tool', { hasText: 'Paint' }).first();
  if (await paintBtn.count()) await paintBtn.click().catch(() => {});
  await page.evaluate(() => new Promise((resolve) => {
    let frames = 10;
    const tick = () => (--frames <= 0 ? resolve() : requestAnimationFrame(tick));
    requestAnimationFrame(tick);
  }));

  await page.evaluate(() => {
    window.__courseGpuProbe?.reset?.();
    window.__fw.scene3d.resetEditorPerformanceStats?.();
    const canvas = document.querySelector('canvas');
    const probe = {
      deltas: [], inputToFrameMs: [], running: true, last: performance.now(),
    };
    window.__paintStrokeProbe = probe;
    const onPointerMove = () => {
      if (!probe.running) return;
      const inputAt = performance.now();
      requestAnimationFrame(() => {
        if (probe.running) probe.inputToFrameMs.push(performance.now() - inputAt);
      });
    };
    probe.onPointerMove = onPointerMove;
    canvas?.addEventListener('pointermove', onPointerMove, { capture: true });
    const tick = (now) => {
      if (!probe.running) return;
      const delta = now - probe.last;
      probe.last = now;
      if (delta > 0) probe.deltas.push(delta);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  await page.mouse.move(cx - 40, cy + 44);
  await page.mouse.down();
  for (let i = 0; i < 24; i++) {
    await page.mouse.move(cx - 40 + i * 4, cy + 44 + Math.cos(i / 3) * 18);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  await page.evaluate(() => new Promise((resolve) => {
    let frames = 10;
    const tick = () => (--frames <= 0 ? resolve() : requestAnimationFrame(tick));
    requestAnimationFrame(tick);
  }));

  const paintDrag = await page.evaluate(() => {
    const probe = window.__paintStrokeProbe;
    probe.running = false;
    document.querySelector('canvas')?.removeEventListener('pointermove', probe.onPointerMove, { capture: true });
    const summarize = (samples) => {
      const ordered = samples.slice().sort((a, b) => a - b);
      const mean = samples.reduce((sum, value) => sum + value, 0) / Math.max(1, samples.length);
      const slowCount = Math.max(1, Math.ceil(ordered.length * 0.01));
      const slowMean = ordered.slice(-slowCount).reduce((sum, value) => sum + value, 0) / slowCount;
      return {
        samples: samples.length,
        meanMs: +mean.toFixed(3),
        medianMs: +(ordered[Math.floor(ordered.length / 2)] || 0).toFixed(3),
        p99Ms: +(ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * 0.99))] || 0).toFixed(3),
        maxMs: +(ordered[ordered.length - 1] || 0).toFixed(3),
        onePercentLowFps: +(1000 / Math.max(0.001, slowMean)).toFixed(2),
      };
    };
    const frame = summarize(probe.deltas);
    return {
      frames: frame.samples,
      averageFps: +(1000 / Math.max(0.001, frame.meanMs)).toFixed(2),
      averageFrameMs: frame.meanMs,
      onePercentLowFps: frame.onePercentLowFps,
      medianFrameMs: frame.medianMs,
      worstFrameMs: frame.maxMs,
      framesOver33ms: probe.deltas.filter((value) => value > 33).length,
      framesOver100ms: probe.deltas.filter((value) => value > 100).length,
      inputToFrame: summarize(probe.inputToFrameMs),
      rawFrameDeltasMs: probe.deltas.map((value) => +value.toFixed(2)),
    };
  });
  const paintGpu = await page.evaluate(() => {
    const probe = window.__courseGpuProbe;
    return probe ? JSON.parse(JSON.stringify({
      bufferSubData: probe.bufferSubData,
      texSubImage2D: probe.texSubImage2D,
    })) : null;
  });
  const paintRuntimeCosts = await page.evaluate(
    () => window.__fw.scene3d.editorPerformanceSnapshot?.() || null,
  );
  await page.screenshot({ path: `${outDir}/paint_stroke.png` });

  return {
    ok: diagnostics.console.length === 0
      && diagnostics.pageErrors.length === 0
      && drag.framesOver100ms === 0
      && paintDrag.framesOver100ms === 0
      && drag.inputToFrame.samples > 0
      && paintDrag.inputToFrame.samples > 0
      && !undoIntegrity.skipped
      && undoIntegrity.differingComponents === 0
      && !redoIntegrity.skipped
      && redoIntegrity.differingComponents === 0
      && terrainDataIntegrity.changedByStroke
      && terrainDataIntegrity.undoRestoredExact
      && terrainDataIntegrity.redoRestoredExact,
    phase,
    synthetic,
    drag,
    terrainGpu,
    terrainRuntimeCosts,
    paintDrag,
    paintGpu,
    paintRuntimeCosts,
    undoIntegrity,
    redoIntegrity,
    terrainDataIntegrity,
    historyTimings,
    diagnostics,
  };
}
