// Master course rebuild QA harness.
//
// Run from the repository root with the normal browser server already active:
//   $env:COURSE_QA_PHASE='baseline'
//   $env:QA_RESULT_PATH='qa/course_master_final/baseline/results.json'
//   $env:VIDEO_DIR='qa/course_master_final/baseline/video'
//   $env:HEADED='1'
//   node tools/qa/run-playwright.cjs tools/qa/course-master-final.js --bootstrap
//
// The runner's --bootstrap flag creates the documented deterministic save fixture.
// From there this driver enters and operates the Course Editor through its visible
// controls. Player-facing presets and flyover are exercised through their visible
// UI; direct poses remain only as stable ground-comparison cameras.
async (page) => {
  const phase = process.env.COURSE_QA_PHASE || 'baseline';
  const outDir = `qa/course_master_final/${phase}`;
  // The runner already honours QA_BASE_URL; this script used to hardcode 8457,
  // so a run launched against another port silently drove the default tree
  // instead — which matters when a worktree is under test on its own server.
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const diagnostics = {
    console: [],
    benignConsole: [],
    pageErrors: [],
    failedRequests: [],
    ignoredPreProbeRequestFailures: [],
  };
  const cameraDefinitions = {};
  let qaDocumentCommitted = false;
  let qaDocumentRequests = new WeakSet();

  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      const record = `${message.type()}: ${message.text()}`;
      // Chrome/ANGLE's D3D compiler emits this advisory for Three's generated
      // dynamic-index helper even though the program links and renders normally.
      // Keep it visible in evidence without treating it as an application defect.
      if (/THREE\.WebGLProgram: Program Info Log/i.test(record)
        && /dyn_index_vec4_float4_int/i.test(record)) diagnostics.benignConsole.push(record);
      else diagnostics.console.push(record);
    }
  });
  page.on('pageerror', (error) => diagnostics.pageErrors.push(error.message));
  page.on('request', (request) => {
    if (qaDocumentCommitted) qaDocumentRequests.add(request);
  });
  page.on('requestfailed', (request) => {
    const record = {
      url: request.url(),
      error: request.failure()?.errorText || 'unknown',
    };
    if (qaDocumentRequests.has(request)) diagnostics.failedRequests.push(record);
    else diagnostics.ignoredPreProbeRequestFailures.push(record);
  });
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame() && frame.url().startsWith(baseUrl)) {
      qaDocumentCommitted = true;
    }
  });

  const shot = async (name) => {
    const path = `${outDir}/${name}.png`;
    await page.screenshot({ path });
    return path;
  };

  const waitForSettledRender = async (frames = 8) => {
    await page.evaluate((count) => new Promise((resolve) => {
      let left = count;
      const tick = () => {
        left -= 1;
        if (left <= 0) resolve();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }), frames);
  };

  const readCamera = async () => page.evaluate(() => {
    const s = window.__fw.scene3d;
    const c = s.camera;
    const r = s.rig;
    return {
      camera: {
        x: +c.position.x.toFixed(3),
        y: +c.position.y.toFixed(3),
        z: +c.position.z.toFixed(3),
        fov: c.fov,
      },
      rig: {
        target: {
          x: +r.target.x.toFixed(3),
          y: +r.target.y.toFixed(3),
          z: +r.target.z.toFixed(3),
        },
        yaw: +r.yaw.toFixed(6),
        pitch: +r.pitch.toFixed(6),
        dist: +r.dist.toFixed(3),
      },
    };
  });

  const sampleFrameTimes = async (durationMs) => page.evaluate((duration) => new Promise((resolve) => {
    const renderer = window.__fw.scene3d.renderer;
    const info = renderer.info;
    const priorAutoReset = info.autoReset;
    const deltas = [];
    let last = performance.now();
    const start = last;
    // EffectComposer invokes renderer.render several times per display frame. Three's
    // default autoReset therefore leaves only the final full-screen pass in
    // renderer.info. Accumulate every pass for this bounded interval, then restore
    // the engine default before returning.
    info.autoReset = false;
    info.reset();
    const tick = (now) => {
      const delta = now - last;
      last = now;
      if (delta > 0) deltas.push(delta);
      if (now - start < duration) {
        requestAnimationFrame(tick);
        return;
      }
      const ordered = deltas.slice().sort((a, b) => a - b);
      const sum = deltas.reduce((total, value) => total + value, 0);
      const avgMs = sum / Math.max(1, deltas.length);
      const slowCount = Math.max(1, Math.ceil(ordered.length * 0.01));
      const slowest = ordered.slice(-slowCount);
      const slowestMeanMs = slowest.reduce((total, value) => total + value, 0) / slowest.length;
      const p99Ms = ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * 0.99) - 1)] || 0;
      const worstMs = ordered[ordered.length - 1] || 0;
      const renderTotals = {
        drawCalls: info.render.calls,
        triangles: info.render.triangles,
        points: info.render.points,
        lines: info.render.lines,
      };
      info.reset();
      info.autoReset = priorAutoReset;
      resolve({
        frames: deltas.length,
        durationMs: +(last - start).toFixed(2),
        averageFps: +(1000 / avgMs).toFixed(2),
        averageFrameMs: +avgMs.toFixed(3),
        onePercentLowFps: +(1000 / Math.max(0.001, slowestMeanMs)).toFixed(2),
        slowestOnePercentFrameCount: slowCount,
        slowestOnePercentMeanMs: +slowestMeanMs.toFixed(3),
        p99FrameMs: +p99Ms.toFixed(3),
        worstFrameMs: +worstMs.toFixed(3),
        drawCallsTotal: renderTotals.drawCalls,
        drawCallsPerFrame: +(renderTotals.drawCalls / Math.max(1, deltas.length)).toFixed(2),
        trianglesTotal: renderTotals.triangles,
        trianglesPerFrame: Math.round(renderTotals.triangles / Math.max(1, deltas.length)),
        pointsPerFrame: +(renderTotals.points / Math.max(1, deltas.length)).toFixed(2),
        linesPerFrame: +(renderTotals.lines / Math.max(1, deltas.length)).toFixed(2),
        rawFrameDeltasMs: deltas.map((value) => +value.toFixed(3)),
      });
    };
    requestAnimationFrame(tick);
  }), durationMs);

  const summarizeSamples = (samples) => {
    const deltas = samples.flatMap((sample) => sample.rawFrameDeltasMs);
    const ordered = deltas.slice().sort((a, b) => a - b);
    const sum = deltas.reduce((total, value) => total + value, 0);
    const averageFrameMs = sum / Math.max(1, deltas.length);
    const slowCount = Math.max(1, Math.ceil(ordered.length * 0.01));
    const slowest = ordered.slice(-slowCount);
    const slowestMeanMs = slowest.reduce((total, value) => total + value, 0) / slowest.length;
    const calls = samples.reduce((total, sample) => total + sample.drawCallsTotal, 0);
    const triangles = samples.reduce((total, sample) => total + sample.trianglesTotal, 0);
    const uiMutationRecords = samples.reduce((total, sample) => total + (sample.uiMutations?.records || 0), 0);
    const uiMutationDurationMs = samples.reduce((total, sample) => total + (sample.uiMutations?.durationMs || 0), 0);
    return {
      sampleCount: samples.length,
      frames: deltas.length,
      durationMs: +samples.reduce((total, sample) => total + sample.durationMs, 0).toFixed(2),
      averageFps: +(1000 / averageFrameMs).toFixed(2),
      averageFrameMs: +averageFrameMs.toFixed(3),
      onePercentLowFps: +(1000 / Math.max(0.001, slowestMeanMs)).toFixed(2),
      slowestOnePercentFrameCount: slowCount,
      slowestOnePercentMeanMs: +slowestMeanMs.toFixed(3),
      worstFrameMs: +(ordered[ordered.length - 1] || 0).toFixed(3),
      drawCallsPerFrame: +(calls / Math.max(1, deltas.length)).toFixed(2),
      trianglesPerFrame: Math.round(triangles / Math.max(1, deltas.length)),
      uiMutationRecords,
      uiMutationRecordsPerSecond: +(uiMutationRecords / Math.max(0.001, uiMutationDurationMs / 1000)).toFixed(3),
      samples,
    };
  };

  const sceneCensus = async () => page.evaluate(() => {
    const s = window.__fw.scene3d;
    const renderer = s.renderer;
    const materials = new Set();
    const textures = new Set();
    let sceneNodes = 0;
    let meshes = 0;
    let instancedMeshes = 0;
    let renderedInstances = 0;
    let shadowCasters = 0;
    let textureBytesEstimate = 0;

    const addMaterial = (material) => {
      if (!material || materials.has(material)) return;
      materials.add(material);
      for (const value of Object.values(material)) {
        if (value && value.isTexture) textures.add(value);
      }
      if (material.uniforms) {
        for (const uniform of Object.values(material.uniforms)) {
          const value = uniform?.value;
          if (value && value.isTexture) textures.add(value);
        }
      }
    };

    s.scene.traverse((object) => {
      sceneNodes += 1;
      if (!object.isMesh) return;
      meshes += 1;
      if (object.isInstancedMesh) {
        instancedMeshes += 1;
        renderedInstances += object.count || 0;
      }
      if (object.castShadow && object.visible) shadowCasters += 1;
      const list = Array.isArray(object.material) ? object.material : [object.material];
      list.forEach(addMaterial);
    });

    for (const texture of textures) {
      const source = texture.image || texture.source?.data;
      const width = source?.videoWidth || source?.naturalWidth || source?.width || 0;
      const height = source?.videoHeight || source?.naturalHeight || source?.height || 0;
      const layers = source?.depth || 1;
      if (width && height) {
        // RGBA8 with a full mip chain. Compressed/source-specific formats are
        // intentionally reported as an estimate rather than invented precision.
        textureBytesEstimate += width * height * layers * 4 * (texture.generateMipmaps === false ? 1 : 4 / 3);
      }
    }

    return {
      rendererInfoLastPass: {
        // EffectComposer leaves only its final pass here. Authoritative composed
        // draw/triangle counts are captured by sampleFrameTimes above.
        drawCalls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
        points: renderer.info.render.points,
        lines: renderer.info.render.lines,
      },
      sceneNodes,
      meshes,
      instancedMeshes,
      renderedInstances,
      shadowCasters,
      materialCount: materials.size,
      textureCountScene: textures.size,
      textureCountRenderer: renderer.info.memory.textures,
      textureMemoryEstimateBytes: Math.round(textureBytesEstimate),
      textureMemoryEstimateMiB: +(textureBytesEstimate / 1024 / 1024).toFixed(2),
      textureMemoryEstimateMethod: 'Scene-reachable source dimensions * 4 RGBA8 bytes * layer count * declared mip-chain factor; not measured GPU allocation.',
      geometryCount: renderer.info.memory.geometries,
      programCount: renderer.info.programs?.length ?? null,
      jsHeapUsedBytes: performance.memory?.usedJSHeapSize ?? null,
      jsHeapTotalBytes: performance.memory?.totalJSHeapSize ?? null,
      shadowBakes: s.post?.stats?.().shadowBakes ?? null,
    };
  });

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  await cdp.send('HeapProfiler.enable');

  const browserCensus = async ({ collectGarbage = false } = {}) => {
    if (collectGarbage) await cdp.send('HeapProfiler.collectGarbage');
    const [dom, performanceMetrics] = await Promise.all([
      cdp.send('Memory.getDOMCounters'),
      cdp.send('Performance.getMetrics'),
    ]);
    const metrics = Object.fromEntries((performanceMetrics.metrics || []).map((entry) => [entry.name, entry.value]));
    return {
      garbageCollectedImmediatelyBefore: collectGarbage,
      timestamp: metrics.Timestamp ?? null,
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

  const startUiMutationProbe = async (label) => page.evaluate((probeLabel) => {
    window.__courseQaUiMutationProbe?.observer?.disconnect();
    const root = document.querySelector('.ced-root');
    const startedAt = performance.now();
    const counts = {
      records: 0,
      attributes: 0,
      childList: 0,
      characterData: 0,
      addedNodes: 0,
      removedNodes: 0,
      editorRecords: 0,
      playtestRecords: 0,
    };
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        counts.records += 1;
        counts[record.type] += 1;
        counts.addedNodes += record.addedNodes?.length || 0;
        counts.removedNodes += record.removedNodes?.length || 0;
        const element = record.target.nodeType === Node.ELEMENT_NODE
          ? record.target
          : record.target.parentElement;
        if (element?.closest?.('.ced-pt, .ced-pt-map, .ced-pt-chip, .ced-pt-club, .ced-pt-power')) counts.playtestRecords += 1;
        else counts.editorRecords += 1;
      }
    });
    if (root) observer.observe(root, {
      subtree: true,
      attributes: true,
      childList: true,
      characterData: true,
    });
    window.__courseQaUiMutationProbe = { label: probeLabel, rootFound: !!root, startedAt, counts, observer };
    return { label: probeLabel, rootFound: !!root, startedAt };
  }, label);

  const stopUiMutationProbe = async () => page.evaluate(() => {
    const probe = window.__courseQaUiMutationProbe;
    if (!probe) return null;
    probe.observer.disconnect();
    const durationMs = performance.now() - probe.startedAt;
    const result = {
      label: probe.label,
      rootFound: probe.rootFound,
      durationMs: +durationMs.toFixed(2),
      ...probe.counts,
      recordsPerSecond: +(probe.counts.records / Math.max(0.001, durationMs / 1000)).toFixed(3),
    };
    delete window.__courseQaUiMutationProbe;
    return result;
  });

  const listenerCensus = async () => {
    const targets = {
      window: 'window',
      document: 'document',
      html: 'document.documentElement',
      canvas: 'document.querySelector("canvas")',
      editor: 'document.querySelector(".ced-root")',
    };
    const byTarget = {};
    const byType = {};
    let total = 0;
    for (const [label, expression] of Object.entries(targets)) {
      const evaluated = await cdp.send('Runtime.evaluate', {
        expression,
        returnByValue: false,
        objectGroup: 'course-master-listeners',
      });
      const objectId = evaluated.result?.objectId;
      if (!objectId) {
        byTarget[label] = 0;
        continue;
      }
      const response = await cdp.send('DOMDebugger.getEventListeners', { objectId });
      const listeners = response.listeners || [];
      byTarget[label] = listeners.length;
      total += listeners.length;
      for (const listener of listeners) byType[listener.type] = (byType[listener.type] || 0) + 1;
    }
    const fullDocument = await cdp.send('Memory.getDOMCounters');
    return {
      fullDocument: {
        documents: fullDocument.documents,
        domNodes: fullDocument.nodes,
        jsEventListeners: fullDocument.jsEventListeners,
      },
      sampledTargets: { total, byTarget, byType },
    };
  };

  const selectHoleThroughUi = async (index) => {
    await page.locator('.ced-holechip').click();
    await page.locator('.ced-holecard').nth(index).click();
    await page.getByRole('button', { name: 'Frame it', exact: true }).click();
    await page.waitForFunction((number) => {
      const chip = document.querySelector('.ced-holechip');
      return chip && chip.textContent.includes(`Hole ${number}`);
    }, index + 1);
    await waitForSettledRender(5);
  };

  const poseHoleGround = async (fromT, toT, options = {}) => page.evaluate(({ fromT: a, toT: b, options: opts }) => {
    const app = window.__fw;
    const s = app.scene3d;
    const hole = app.state.course.holes.find((item) => item.id === app.editorUi().qa.playtest()?.holeId)
      || app.state.course.holes.find((item) => {
        const chip = document.querySelector('.ced-holechip');
        const number = app.state.course.holes.indexOf(item) + 1;
        return chip?.textContent.includes(`Hole ${number}`);
      })
      || app.state.course.holes[0];
    const route = [hole.tee, ...(hole.wp || []), hole.pin].filter(Boolean);
    const cumulative = [0];
    for (let i = 1; i < route.length; i += 1) {
      cumulative.push(cumulative[i - 1] + Math.hypot(route[i].x - route[i - 1].x, route[i].y - route[i - 1].y));
    }
    const total = cumulative[cumulative.length - 1] || 1;
    const sample = (t) => {
      const distance = Math.max(0, Math.min(1, t)) * total;
      let segment = 0;
      while (segment < cumulative.length - 2 && cumulative[segment + 1] < distance) segment += 1;
      const span = Math.max(1e-6, cumulative[segment + 1] - cumulative[segment]);
      const local = (distance - cumulative[segment]) / span;
      return {
        x: route[segment].x + (route[segment + 1].x - route[segment].x) * local,
        y: route[segment].y + (route[segment + 1].y - route[segment].y) * local,
      };
    };
    const from = sample(a);
    const toward = sample(b);
    const fx = s.worldX(from.x);
    const fz = s.worldZ(from.y);
    const tx = s.worldX(toward.x);
    const tz = s.worldZ(toward.y);
    const length = Math.hypot(tx - fx, tz - fz) || 1;
    const dx = (tx - fx) / length;
    const dz = (tz - fz) / length;
    const back = opts.backYd ?? 5;
    const lateral = opts.lateralYd ?? 0;
    const eyeX = fx - dx * back - dz * lateral;
    const eyeZ = fz - dz * back + dx * lateral;
    const targetX = tx;
    const targetZ = tz;
    const eyeHeight = opts.eyeHeightYd ?? 1.85;
    const targetHeight = opts.targetHeightYd ?? 1.0;
    s.camera.position.set(eyeX, s.heightAt(eyeX, eyeZ) + eyeHeight, eyeZ);
    s.camera.lookAt(targetX, s.heightAt(targetX, targetZ) + targetHeight, targetZ);
    s.camera.updateMatrixWorld(true);
    return {
      holeId: hole.id,
      fromT: a,
      toT: b,
      eye: { x: eyeX, y: s.camera.position.y, z: eyeZ },
      target: { x: targetX, y: s.heightAt(targetX, targetZ) + targetHeight, z: targetZ },
      options: opts,
    };
  }, { fromT, toT, options });

  const poseHoleOneBunker = async () => page.evaluate(() => {
    const app = window.__fw;
    const s = app.scene3d;
    const chip = document.querySelector('.ced-holechip');
    const selectedIndex = Math.max(0, app.state.course.holes.findIndex((item, index) => (
      chip?.textContent.includes(`Hole ${index + 1}`)
    )));
    const hole = app.state.course.vec.holes[selectedIndex] || app.state.course.vec.holes[0];
    // H1's larger left greenside bunker shows the rolled lip, sand rake, and
    // turf transition while retaining the green complex as spatial context.
    const bunkerIndex = Math.min(1, Math.max(0, hole.bunkers.length - 1));
    const bunker = hole.bunkers[bunkerIndex];
    const center = bunker.pts.reduce((sum, point) => ({
      x: sum.x + point.x / bunker.pts.length,
      y: sum.y + point.y / bunker.pts.length,
    }), { x: 0, y: 0 });
    const route = hole.line || [];
    const approach = route[Math.max(0, route.length - 2)] || route[0] || center;
    const green = hole.green || route[route.length - 1] || center;
    const length = Math.hypot(green.cx - approach.x, green.cy - approach.y) || 1;
    const dx = (green.cx - approach.x) / length;
    const dz = (green.cy - approach.y) / length;
    const eyeX = s.worldX(center.x - dx * 1.75);
    const eyeZ = s.worldZ(center.y - dz * 1.75);
    const targetX = s.worldX(center.x + dx * 0.18);
    const targetZ = s.worldZ(center.y + dz * 0.18);
    s.camera.position.set(eyeX, s.heightAt(eyeX, eyeZ) + 1.15, eyeZ);
    s.camera.lookAt(targetX, s.heightAt(targetX, targetZ) + 0.15, targetZ);
    s.camera.updateMatrixWorld(true);
    return {
      holeId: hole.id,
      bunkerIndex,
      eye: { x: eyeX, y: s.camera.position.y, z: eyeZ },
      target: { x: targetX, y: s.heightAt(targetX, targetZ) + 0.15, z: targetZ },
    };
  });

  const runSampleSet = async ({
    label,
    count = 3,
    durationMs = 2500,
    beforeEach,
    during,
    afterEach,
  }) => {
    const samples = [];
    for (let index = 0; index < count; index += 1) {
      if (beforeEach) await beforeEach(index);
      await waitForSettledRender(8);
      await startUiMutationProbe(`${label}-${index + 1}`);
      const samplePromise = sampleFrameTimes(durationMs);
      if (during) await during(durationMs, index);
      const sample = await samplePromise;
      sample.uiMutations = await stopUiMutationProbe();
      samples.push(sample);
      if (afterEach) await afterEach(index);
    }
    return summarizeSamples(samples);
  };

  const orbitEditorThroughNormalInput = async (durationMs) => {
    const box = await page.locator('canvas').first().boundingBox();
    if (!box) throw new Error('Course canvas is not available for the editor-orbit performance route.');
    const centerX = box.x + box.width * 0.55;
    const centerY = box.y + box.height * 0.54;
    await page.mouse.move(centerX, centerY);
    await page.mouse.down({ button: 'right' });
    const steps = 32;
    const stepDelay = Math.max(20, Math.floor((durationMs * 0.82) / steps));
    for (let step = 1; step <= steps; step += 1) {
      const angle = (step / steps) * Math.PI * 2;
      await page.mouse.move(
        centerX + Math.sin(angle) * 92,
        centerY + Math.sin(angle * 2) * 34,
      );
      await page.waitForTimeout(stepDelay);
    }
    await page.mouse.up({ button: 'right' });
  };

  const strikeThroughNormalInput = async (durationMs) => {
    const box = await page.locator('canvas').first().boundingBox();
    if (!box) throw new Error('Course canvas is not available for the playtest-shot performance route.');
    const x = box.x + box.width * 0.52;
    const y = box.y + box.height * 0.58;
    await page.mouse.move(x, y);
    await page.mouse.down({ button: 'left' });
    await page.waitForTimeout(780);
    await page.mouse.up({ button: 'left' });
    await page.waitForTimeout(Math.max(0, durationMs - 980));
  };

  await page.setViewportSize({ width: 1600, height: 900 });
  // The runner's bootstrap page may still be cancelling asset requests when this
  // deliberate fixture reload begins. Only the newly committed QA document is in
  // scope for failed-request acceptance diagnostics.
  qaDocumentCommitted = false;
  qaDocumentRequests = new WeakSet();
  await page.goto(baseUrl);
  await page.waitForFunction(() => document.readyState === 'complete');
  const continueButton = page.getByRole('button', { name: 'Continue', exact: true });
  await continueButton.waitFor({ state: 'visible' });
  await page.waitForFunction(() => {
    const button = [...document.querySelectorAll('button')].find((item) => item.textContent.trim() === 'Continue');
    return button && !button.disabled;
  });
  await continueButton.click();
  await page.waitForFunction(() => window.__fw?.state?.course?.vec && window.__fw?.scene3d && window.__fw?.editorUi?.(), null, { timeout: 90000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || getComputedStyle(veil).opacity === '0';
  }, null, { timeout: 90000 });

  // Documented deterministic visual fixture: weather is fixed while all player
  // navigation and editor operation continue through real controls.
  await page.evaluate(() => {
    const weather = window.__fw.state.weather;
    weather.locked = true;
    weather.today = { tempHiF: 74, tempLoF: 55, rainIn: 0, humidity: 0.4, windMph: 6 };
  });

  await page.keyboard.press('j');
  await page.waitForFunction(() => window.__fw.editorUi().isActive());
  await page.locator('.ced-root').waitFor({ state: 'visible' });
  await waitForSettledRender(16);

  const browserBeforeInteractions = await browserCensus({ collectGarbage: true });
  const listenersBefore = await listenerCensus();
  await waitForSettledRender(4);
  const initialCensus = await sceneCensus();

  cameraDefinitions.hole01Default = await readCamera();
  await shot('before_01_hole_01_default');

  await page.keyboard.press('Home');
  await waitForSettledRender(8);
  cameraDefinitions.courseOverview = await readCamera();
  await shot('before_02_course_overview');

  await page.keyboard.press('f');
  await waitForSettledRender(8);
  cameraDefinitions.hole01Frame = await readCamera();
  await shot('before_03_hole_01_aerial');

  const holeEvidence = [];
  for (let index = 0; index < 9; index += 1) {
    await selectHoleThroughUi(index);
    const number = String(index + 1).padStart(2, '0');
    const aerial = await shot(`holes/hole_${number}_aerial`);
    const aerialCamera = await readCamera();

    await page.getByRole('button', { name: 'Playtest', exact: true }).click();
    await page.waitForFunction(() => window.__fw.editorUi().isPlaytesting());
    await waitForSettledRender(10);
    const tee = await shot(`ground_level/hole_${number}_tee_playtest`);
    const teeCamera = await readCamera();
    await page.getByRole('button', { name: /Editor$/ }).click();
    await page.waitForFunction(() => !window.__fw.editorUi().isPlaytesting());
    holeEvidence.push({ hole: index + 1, aerial, tee, aerialCamera, teeCamera });
  }

  await selectHoleThroughUi(0);

  // Exercise every player-facing camera preset through the new top-bar control.
  // These are acceptance views; the fixed cameras below remain comparison views.
  const cameraPresetEvidence = [];
  for (const [mode, name] of [
    ['tee', 'tee'],
    ['fairway', 'fairway'],
    ['approach', 'approach'],
    ['green', 'green'],
    ['ground-preview', 'ground_preview'],
  ]) {
    await page.locator('.ced-camera').selectOption(mode);
    await waitForSettledRender(10);
    cameraPresetEvidence.push({
      mode,
      screenshot: await shot(`camera_presets/hole_01_${name}`),
      camera: await readCamera(),
    });
  }
  await page.locator('.ced-camera').selectOption('frame-hole');
  await waitForSettledRender(8);

  // Start and stop the route-aware flyover through the hole-selection modal.
  await page.locator('.ced-holechip').click();
  await page.locator('.ced-modal').getByRole('button', { name: 'Flyover', exact: true }).click();
  await page.waitForTimeout(3500);
  await waitForSettledRender(6);
  const flyoverEvidence = {
    screenshot: await shot('camera_presets/hole_01_flyover_mid'),
    camera: await readCamera(),
  };
  await page.keyboard.press('Escape');
  await waitForSettledRender(8);

  const fixedViews = [
    ['before_04_hole_01_tee', 0.00, 0.13, { backYd: 7, eyeHeightYd: 1.8 }],
    ['before_05_hole_01_fairway', 0.38, 0.61, { backYd: 3, eyeHeightYd: 1.7 }],
    ['before_06_hole_01_approach', 0.70, 0.94, { backYd: 3, eyeHeightYd: 1.65 }],
    ['before_07_hole_01_green', 0.86, 1.00, { backYd: 2, eyeHeightYd: 1.55 }],
    ['before_08_hole_01_grass_close', 0.24, 0.29, { backYd: 1, eyeHeightYd: 0.72, targetHeightYd: 0.38, lateralYd: 4 }],
  ];
  for (const [name, fromT, toT, options] of fixedViews) {
    cameraDefinitions[name] = await poseHoleGround(fromT, toT, options);
    await waitForSettledRender(10);
    await shot(name);
  }
  cameraDefinitions.hole01BunkerClose = await poseHoleOneBunker();
  await waitForSettledRender(10);
  await shot('bunkers/hole_01_greenside_close');

  // Three identical samples per scenario retain raw frame deltas and accumulate
  // every EffectComposer pass. The overview is the highest-instance idle view;
  // orbit and shot routes use the real mouse controls.
  const courseOverviewIdle = await runSampleSet({
    label: 'course-overview-idle',
    count: 3,
    durationMs: 2500,
    beforeEach: async () => {
      await page.keyboard.press('Home');
      // frameCourse eases for roughly one second. This scenario is explicitly the
      // fixed-camera idle case, so camera movement and repeated shadow rebakes must
      // finish before the measured interval starts.
      await page.waitForTimeout(1300);
      await waitForSettledRender(12);
    },
  });
  const overviewCensus = await sceneCensus();

  const hole1EditorOrbit = await runSampleSet({
    label: 'hole-1-editor-orbit',
    count: 3,
    durationMs: 2500,
    beforeEach: async () => {
      await page.keyboard.press('f');
      await waitForSettledRender(8);
    },
    during: async (durationMs) => orbitEditorThroughNormalInput(durationMs),
  });
  const editorCensus = await sceneCensus();

  let playtestCensus = null;
  const hole1PlaytestShot = await runSampleSet({
    label: 'hole-1-playtest-shot',
    count: 3,
    durationMs: 3000,
    beforeEach: async () => {
      await page.getByRole('button', { name: 'Playtest', exact: true }).click();
      await page.waitForFunction(() => window.__fw.editorUi().isPlaytesting());
      await waitForSettledRender(10);
    },
    during: async (durationMs) => strikeThroughNormalInput(durationMs),
    afterEach: async (index) => {
      if (index === 0) await shot('before_09_hole_01_playtest');
      if (index === 2) playtestCensus = await sceneCensus();
      await page.getByRole('button', { name: /Editor$/ }).click();
      await page.waitForFunction(() => !window.__fw.editorUi().isPlaytesting());
    },
  });

  const browserAfterInteractions = await browserCensus({ collectGarbage: true });
  const listenersAfter = await listenerCensus();
  await cdp.send('Runtime.releaseObjectGroup', { objectGroup: 'course-master-listeners' });

  return {
    ok: diagnostics.console.length === 0
      && diagnostics.pageErrors.length === 0
      && diagnostics.failedRequests.length === 0,
    phase,
    launch: 'HEADED=1 node tools/qa/run-playwright.cjs tools/qa/course-master-final.js --bootstrap',
    fixture: 'runner --bootstrap, relaxed empire seed 424242, first property, fixed dry midday weather',
    viewport: { width: 1600, height: 900, deviceScaleFactor: 1 },
    browser: await page.evaluate(() => navigator.userAgent),
    cameraDefinitions,
    holeEvidence,
    cameraPresetEvidence,
    flyoverEvidence,
    performance: {
      protocol: {
        samplesPerScenario: 3,
        rawFrameDeltasRetained: true,
        rendererMeasurement: 'renderer.info.autoReset=false during each interval; counters manually reset once, so every EffectComposer pass accumulates; totals divided by observed display frames.',
        onePercentLowDefinition: '1000 / arithmetic mean of the slowest ceil(frameCount * 0.01) raw frame deltas.',
        scenarios: {
          courseOverviewIdle: 'Fixed Home-key course overview, idle, highest expected on-screen course instance count, 2.5 s per sample.',
          hole1EditorOrbit: 'Hole 1 framed before each sample, repeatable right-mouse orbit through normal editor input, 2.5 s per sample.',
          hole1PlaytestShot: 'Fresh Hole 1 playtest before each sample, 780 ms normal left-mouse power charge and shot, 3.0 s per sample.',
        },
      },
      courseOverviewIdle,
      hole1EditorOrbit,
      hole1PlaytestShot,
      initialCensus,
      overviewCensus,
      editorCensus,
      playtestCensus,
      browserBeforeInteractions,
      browserAfterInteractions,
      forcedGcHeapDeltaBytes: browserAfterInteractions.jsHeapUsedBytes == null || browserBeforeInteractions.jsHeapUsedBytes == null
        ? null
        : browserAfterInteractions.jsHeapUsedBytes - browserBeforeInteractions.jsHeapUsedBytes,
      listenersBefore,
      listenersAfter,
      fullDocumentListenerDelta: listenersAfter.fullDocument.jsEventListeners - listenersBefore.fullDocument.jsEventListeners,
      sampledTargetListenerDelta: listenersAfter.sampledTargets.total - listenersBefore.sampledTargets.total,
      textureMemoryNote: 'Estimate only: scene-reachable source dimensions modeled as uncompressed RGBA8 with declared mip settings. This is not a measurement of actual GPU allocation; renderer exposes texture counts, not allocated bytes.',
    },
    diagnostics,
  };
}
