async (page) => {
  // Focused Object3D matrix-update audit. Run through tools/qa/run-playwright.cjs
  // with --bootstrap and HEADED=1 so the FPS sample uses the real GPU. The game
  // is entered through the player-facing Continue button and movement is driven
  // only through the normal keyboard controls. Direct state access below only
  // pins clock/weather so both boots measure the same world conditions.
  const warnings = [];
  const errors = [];
  page.on('console', (message) => {
    const text = message.text().slice(0, 500);
    if (message.type() === 'warning') warnings.push(text);
    if (message.type() === 'error') errors.push(text);
  });
  page.on('pageerror', (error) => errors.push(`PAGEERROR: ${error.message}`));

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');

  const summarizeFrames = (values) => {
    const frames = values.filter((value) => Number.isFinite(value) && value >= 0).slice(5);
    const sorted = [...frames].sort((a, b) => a - b);
    const totalMs = frames.reduce((sum, value) => sum + value, 0);
    const meanMs = totalMs / Math.max(1, frames.length);
    const slowMean = (fraction) => {
      const count = Math.max(1, Math.ceil(sorted.length * fraction));
      return sorted.slice(-count).reduce((sum, value) => sum + value, 0) / count;
    };
    const variance = frames.reduce((sum, value) => sum + ((value - meanMs) ** 2), 0)
      / Math.max(1, frames.length);
    const percentile = (fraction) => sorted[Math.min(
      sorted.length - 1,
      Math.max(0, Math.floor((sorted.length - 1) * fraction)),
    )];
    return {
      frames: frames.length,
      durationMs: +totalMs.toFixed(3),
      avgFps: +(frames.length * 1000 / Math.max(1, totalMs)).toFixed(2),
      onePercentLowFps: +(1000 / slowMean(0.01)).toFixed(2),
      pointOnePercentLowFps: +(1000 / slowMean(0.001)).toFixed(2),
      avgFrameMs: +meanMs.toFixed(3),
      p95FrameMs: +percentile(0.95).toFixed(3),
      p99FrameMs: +percentile(0.99).toFixed(3),
      worstFrameMs: +(sorted[sorted.length - 1] || 0).toFixed(3),
      frameVarianceMs2: +variance.toFixed(3),
      frameStdDevMs: +Math.sqrt(variance).toFixed(3),
    };
  };

  async function enterGame() {
    await page.goto('http://localhost:8457/');
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.waitForTimeout(1000);
    await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`)).clickThroughMenu(page);
    await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
    await page.waitForFunction(() => {
      const veil = document.querySelector('.load-veil');
      return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
    }, null, { timeout: 90000 });
    await page.evaluate(async () => {
      const barrier = window.__fw.scene3d.assetBarrier?.(30000);
      if (barrier?.promise) await barrier.promise;
    });
    await page.waitForFunction(() => {
      const clubhouse = window.__fw?.scene3d?.clubhouse?.();
      return !clubhouse?.assetsReady || clubhouse.assetsReady();
    }, null, { timeout: 90000 });
    await page.evaluate(() => {
      const app = window.__fw;
      app.speedIdx = 0;
      app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440 + 14 * 60;
      app.state.weather.locked = true;
      app.state.weather.today = {
        tempHiF: 72, tempLoF: 54, rainIn: 0, humidity: 0.48, windMph: 5,
      };
      app.scene3d.applyTimeWeather?.(14 * 60, app.state.weather);
      app.scene3d.walk.clearKeys?.();
    });
    await page.waitForTimeout(2500);
  }

  async function startFrameSample() {
    await page.evaluate(() => {
      const sample = { active: true, deltas: [], last: performance.now() };
      window.__matrixFrameSample = sample;
      const tick = (now) => {
        if (!sample.active) return;
        sample.deltas.push(now - sample.last);
        sample.last = now;
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }

  async function stopFrameSample() {
    return page.evaluate(() => {
      const sample = window.__matrixFrameSample;
      if (!sample) return [];
      sample.active = false;
      return sample.deltas.slice();
    });
  }

  async function runNormalControlRoute() {
    // Default spawn faces the open course. These three deterministic legs exercise
    // running, forward motion, fallback camera steering, and diagonal movement.
    // They deliberately avoid E/Tab so checkout, doors, tools, and mode ownership
    // remain untouched.
    const held = new Set();
    const down = async (key) => { await page.keyboard.down(key); held.add(key); };
    const up = async (key) => { await page.keyboard.up(key); held.delete(key); };
    try {
      await page.locator('#game').click({ position: { x: 800, y: 450 } }).catch(() => {});
      await down('Shift');
      await down('w');
      await down('ArrowRight');
      await page.waitForTimeout(1800);
      await up('ArrowRight');
      await up('Shift');
      await down('ArrowLeft');
      await page.waitForTimeout(1800);
      await up('ArrowLeft');
      await down('d');
      await page.waitForTimeout(1800);
      await up('d');
      await up('w');
    } finally {
      for (const key of [...held]) await page.keyboard.up(key).catch(() => {});
      await page.evaluate(() => window.__fw?.scene3d?.walk?.clearKeys?.());
    }
  }

  const browserCounters = async () => {
    const [dom, perf] = await Promise.all([
      cdp.send('Memory.getDOMCounters'),
      cdp.send('Performance.getMetrics'),
    ]);
    const metrics = Object.fromEntries(perf.metrics.map(({ name, value }) => [name, value]));
    return {
      documents: dom.documents,
      domNodes: dom.nodes,
      jsEventListeners: dom.jsEventListeners,
      jsHeapUsedMB: metrics.JSHeapUsedSize == null
        ? null : +(metrics.JSHeapUsedSize / 1048576).toFixed(3),
      jsHeapTotalMB: metrics.JSHeapTotalSize == null
        ? null : +(metrics.JSHeapTotalSize / 1048576).toFixed(3),
    };
  };

  const renderSnapshot = () => page.evaluate(() => new Promise((resolve) => {
    const { renderer, scene } = window.__fw.scene3d;
    renderer.info.autoReset = false;
    renderer.info.reset();
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const render = { ...renderer.info.render };
        renderer.info.autoReset = true;
        resolve({
          source: 'THREE.WebGLRenderer.info accumulated across one complete composed frame',
          drawCalls: render.calls,
          triangles: render.triangles,
          lines: render.lines,
          points: render.points,
          rendererGeometries: renderer.info.memory.geometries,
          rendererTextures: renderer.info.memory.textures,
          programs: renderer.info.programs?.length ?? null,
          sceneChildren: scene.children.length,
        });
      });
    });
  }));

  const matrixFlagMicrobenchmark = () => page.evaluate(() => {
    const { scene } = window.__fw.scene3d;
    const shell = window.__fw.scene3d.clubhouse().group;
    const sceneAuto = scene.matrixAutoUpdate;
    const shellFlags = [];
    shell.traverse((object) => shellFlags.push({ object, matrixAutoUpdate: object.matrixAutoUpdate }));
    const iterations = 300;
    const samples = [];
    const setMode = (mode) => {
      const legacy = mode === 'legacy-auto-update';
      scene.matrixAutoUpdate = legacy ? true : sceneAuto;
      for (const entry of shellFlags) {
        entry.object.matrixAutoUpdate = legacy ? true : entry.matrixAutoUpdate;
      }
      scene.updateMatrixWorld(true);
    };
    const measure = (mode) => {
      setMode(mode);
      for (let index = 0; index < 20; index += 1) scene.updateMatrixWorld();
      const started = performance.now();
      for (let index = 0; index < iterations; index += 1) scene.updateMatrixWorld();
      const elapsedMs = performance.now() - started;
      samples.push({ mode, iterations, elapsedMs, msPerSceneUpdate: elapsedMs / iterations });
    };
    // Balanced order limits temperature/JIT drift from favoring either mode.
    for (const mode of [
      'legacy-auto-update', 'optimized-static-shell',
      'optimized-static-shell', 'legacy-auto-update',
      'legacy-auto-update', 'optimized-static-shell',
      'optimized-static-shell', 'legacy-auto-update',
    ]) measure(mode);
    setMode('optimized-static-shell');

    const summarize = (mode) => {
      const values = samples.filter((sample) => sample.mode === mode)
        .map((sample) => sample.msPerSceneUpdate).sort((a, b) => a - b);
      const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
      const median = (values[1] + values[2]) / 2;
      return {
        samples: values.length,
        iterationsPerSample: iterations,
        meanMsPerSceneUpdate: +mean.toFixed(4),
        medianMsPerSceneUpdate: +median.toFixed(4),
        minMsPerSceneUpdate: +values[0].toFixed(4),
        maxMsPerSceneUpdate: +values[values.length - 1].toFixed(4),
        rawMsPerSceneUpdate: values.map((value) => +value.toFixed(5)),
      };
    };
    const legacy = summarize('legacy-auto-update');
    const optimized = summarize('optimized-static-shell');
    return {
      source: 'synchronous scene.updateMatrixWorld microbenchmark in the loaded production scene',
      scope: 'toggles only the scene root and clubhouse-shell flags changed by this pass; dynamic door subtrees retain their production flags in optimized mode',
      sampleOrder: samples.map((sample) => sample.mode),
      legacy,
      optimized,
      medianSavedMsPerSceneUpdate: +(legacy.medianMsPerSceneUpdate - optimized.medianMsPerSceneUpdate).toFixed(4),
      medianReductionPercent: +((1 - optimized.medianMsPerSceneUpdate / legacy.medianMsPerSceneUpdate) * 100).toFixed(2),
    };
  });

  const sceneCensus = () => page.evaluate(() => {
    const app = window.__fw;
    const { scene, camera } = app.scene3d;
    const clubhouse = app.scene3d.clubhouse();
    const customerMesh = clubhouse.customers?.[0]?.mesh || null;
    let customerRoot = customerMesh;
    while (customerRoot?.parent && customerRoot.parent !== scene) customerRoot = customerRoot.parent;

    const knownRoles = new Map([
      [clubhouse.group, 'clubhouse-shell'],
      [clubhouse.interior, 'clubhouse-interior'],
      [camera, 'camera-held-tools'],
    ]);
    if (customerRoot?.parent === scene) knownRoles.set(customerRoot, 'clubhouse-customers');

    const labelCounts = new Map();
    const labelFor = (object, index, prefix = '') => {
      let base = knownRoles.get(object) || object.name || `${object.type || 'Object3D'}-${index}`;
      base = `${prefix}${base}`;
      const seen = labelCounts.get(base) || 0;
      labelCounts.set(base, seen + 1);
      return seen ? `${base}#${seen + 1}` : base;
    };
    const dynamicPattern = /door|customer|cashier|register|scanner|drawer|monitor|terminal|receipt|bag|carry|held|hand|golf|water|rain|mote|jet|mist|deliverybox|equipment|van|pallet|cart|laptop|lid|wash|ghost|aim|ball|flag|cloud/i;
    const count = (root, label) => {
      let nodes = 0;
      let matrixAutoUpdate = 0;
      let matrixWorldNeedsUpdate = 0;
      let meshes = 0;
      let instancedMeshes = 0;
      let visibleNodes = 0;
      const materials = new Set();
      const geometries = new Set();
      const riskNames = [];
      root.traverse((object) => {
        nodes += 1;
        if (object.matrixAutoUpdate) matrixAutoUpdate += 1;
        if (object.matrixWorldNeedsUpdate) matrixWorldNeedsUpdate += 1;
        if (object.visible) visibleNodes += 1;
        if (object.isInstancedMesh) instancedMeshes += 1;
        if (object.isMesh) meshes += 1;
        if (object.geometry?.uuid) geometries.add(object.geometry.uuid);
        const list = object.material
          ? (Array.isArray(object.material) ? object.material : [object.material]) : [];
        for (const material of list) if (material?.uuid) materials.add(material.uuid);
        if (object.name && dynamicPattern.test(object.name) && riskNames.length < 12) {
          riskNames.push(object.name);
        }
      });
      return {
        label,
        uuid: root.uuid,
        type: root.type,
        nodes,
        matrixAutoUpdate,
        frozenMatrices: nodes - matrixAutoUpdate,
        autoUpdatePercent: +(matrixAutoUpdate * 100 / Math.max(1, nodes)).toFixed(2),
        matrixWorldNeedsUpdate,
        meshes,
        instancedMeshes,
        visibleNodes,
        geometries: geometries.size,
        materials: materials.size,
        dynamicRiskNames: [...new Set(riskNames)],
        candidateClass: riskNames.length
          ? 'mixed-or-dynamic-do-not-freeze-wholesale'
          : (matrixAutoUpdate === 0 ? 'already-frozen' : 'inspect-before-freezing'),
      };
    };

    const topLevel = scene.children.map((child, index) => count(child, labelFor(child, index)));
    const topLabelByUuid = new Map(topLevel.map((entry) => [entry.uuid, entry.label]));
    const largestBranches = [];
    scene.children.forEach((root, rootIndex) => {
      const parentLabel = topLabelByUuid.get(root.uuid) || labelFor(root, rootIndex);
      root.children.forEach((child, childIndex) => {
        const childName = child.name || `${child.type || 'Object3D'}-${childIndex}`;
        largestBranches.push(count(child, `${parentLabel}/${childName}`));
      });
    });
    largestBranches.sort((a, b) => b.matrixAutoUpdate - a.matrixAutoUpdate || b.nodes - a.nodes);

    const total = count(scene, 'scene-total');
    return {
      total,
      topLevel: topLevel.sort((a, b) => b.matrixAutoUpdate - a.matrixAutoUpdate || b.nodes - a.nodes),
      largestImmediateBranches: largestBranches.slice(0, 50),
      unsafeFreezePolicy: [
        'doors', 'customers', 'register and checkout workspaces', 'held tools and carried goods',
        'golfers', 'water animation', 'rain/motes/cloud animation', 'delivery equipment and boxes',
      ],
    };
  });

  async function installMatrixProbe() {
    await page.evaluate(async () => {
      const THREE = await import('three');
      const app = window.__fw;
      const { scene, camera } = app.scene3d;
      const clubhouse = app.scene3d.clubhouse();
      const Object3D = THREE.Object3D;
      const original = Object3D.prototype.updateMatrixWorld;
      const rootKeys = new WeakMap();
      const roots = new Map();
      const labelCounts = new Map();
      const customerMesh = clubhouse.customers?.[0]?.mesh || null;
      let customerRoot = customerMesh;
      while (customerRoot?.parent && customerRoot.parent !== scene) customerRoot = customerRoot.parent;
      const knownRoles = new Map([
        [clubhouse.group, 'clubhouse-shell'],
        [clubhouse.interior, 'clubhouse-interior'],
        [camera, 'camera-held-tools'],
      ]);
      if (customerRoot?.parent === scene) knownRoles.set(customerRoot, 'clubhouse-customers');
      const labelFor = (object, index) => {
        const base = knownRoles.get(object) || object.name || `${object.type || 'Object3D'}-${index}`;
        const seen = labelCounts.get(base) || 0;
        labelCounts.set(base, seen + 1);
        return seen ? `${base}#${seen + 1}` : base;
      };
      const makeBucket = (label) => ({
        label,
        calls: 0,
        autoUpdateCalls: 0,
        forcedCalls: 0,
        exclusiveMs: 0,
        topLevelEntryCalls: 0,
        topLevelInclusiveMs: 0,
        maxCallMs: 0,
      });
      scene.children.forEach((root, index) => {
        const label = labelFor(root, index);
        roots.set(root, label);
        root.traverse((object) => rootKeys.set(object, label));
      });
      rootKeys.set(scene, 'scene-root');
      const buckets = new Map([['scene-root', makeBucket('scene-root')]]);
      for (const label of roots.values()) buckets.set(label, makeBucket(label));
      buckets.set('detached-or-late-object', makeBucket('detached-or-late-object'));

      const stack = [];
      const probe = {
        active: false,
        original,
        roots,
        rootKeys,
        buckets,
        startedAt: null,
        endedAt: null,
        timerReadOverheadMs: null,
      };
      Object3D.prototype.updateMatrixWorld = function matrixQaUpdateMatrixWorld(force) {
        if (!probe.active) return original.call(this, force);
        const label = rootKeys.get(this) || 'detached-or-late-object';
        const bucket = buckets.get(label) || buckets.get('detached-or-late-object');
        const parentFrame = stack[stack.length - 1] || null;
        const frame = { childMs: 0 };
        const started = performance.now();
        stack.push(frame);
        try {
          return original.call(this, force);
        } finally {
          const elapsed = performance.now() - started;
          stack.pop();
          const exclusive = Math.max(0, elapsed - frame.childMs);
          bucket.calls += 1;
          if (this.matrixAutoUpdate) bucket.autoUpdateCalls += 1;
          if (force === true) bucket.forcedCalls += 1;
          bucket.exclusiveMs += exclusive;
          bucket.maxCallMs = Math.max(bucket.maxCallMs, elapsed);
          if (roots.has(this) || this === scene) {
            bucket.topLevelEntryCalls += 1;
            bucket.topLevelInclusiveMs += elapsed;
          }
          if (parentFrame) parentFrame.childMs += elapsed;
        }
      };

      const timerReads = 100000;
      const timerStarted = performance.now();
      for (let index = 0; index < timerReads; index += 1) performance.now();
      probe.timerReadOverheadMs = (performance.now() - timerStarted) / (timerReads + 1);
      window.__matrixUpdateProbe = probe;
    });
  }

  async function startMatrixProbe() {
    await page.evaluate(() => {
      const probe = window.__matrixUpdateProbe;
      probe.startedAt = performance.now();
      probe.active = true;
    });
  }

  async function stopMatrixProbe() {
    return page.evaluate(async () => {
      const THREE = await import('three');
      const probe = window.__matrixUpdateProbe;
      probe.active = false;
      probe.endedAt = performance.now();
      THREE.Object3D.prototype.updateMatrixWorld = probe.original;
      const scenePasses = probe.buckets.get('scene-root')?.topLevelEntryCalls || 0;
      const rawRows = [...probe.buckets.values()];
      const totalExclusiveMs = rawRows.reduce((sum, bucket) => sum + bucket.exclusiveMs, 0);
      const rows = rawRows.map((bucket) => ({
        ...bucket,
        exclusiveMs: +bucket.exclusiveMs.toFixed(3),
        topLevelInclusiveMs: +bucket.topLevelInclusiveMs.toFixed(3),
        maxCallMs: +bucket.maxCallMs.toFixed(3),
        callsPerScenePass: +(bucket.calls / Math.max(1, scenePasses)).toFixed(3),
        autoUpdateCallsPerScenePass: +(bucket.autoUpdateCalls / Math.max(1, scenePasses)).toFixed(3),
        exclusiveMsPerScenePass: +(bucket.exclusiveMs / Math.max(1, scenePasses)).toFixed(5),
        exclusiveTimeSharePercent: +(bucket.exclusiveMs * 100 / Math.max(0.00001, totalExclusiveMs)).toFixed(2),
      })).sort((a, b) => b.exclusiveMs - a.exclusiveMs || b.calls - a.calls);
      const totals = rows.reduce((acc, row) => ({
        calls: acc.calls + row.calls,
        autoUpdateCalls: acc.autoUpdateCalls + row.autoUpdateCalls,
        forcedCalls: acc.forcedCalls + row.forcedCalls,
        exclusiveMs: acc.exclusiveMs + row.exclusiveMs,
      }), { calls: 0, autoUpdateCalls: 0, forcedCalls: 0, exclusiveMs: 0 });
      totals.exclusiveMs = +totals.exclusiveMs.toFixed(3);
      return {
        source: 'temporary wrapper around the shared THREE.Object3D.prototype.updateMatrixWorld',
        timingMethod: 'performance.now around every recursive call; exclusive time subtracts wrapped child durations',
        caution: 'instrumentation adds two or more high-resolution timer reads per call; use subtree shares and call counts for attribution, not this run as production FPS',
        sampleMs: +(probe.endedAt - probe.startedAt).toFixed(3),
        estimatedTimerReadOverheadMs: +probe.timerReadOverheadMs.toFixed(7),
        scenePasses,
        scenePassesPerAnimationFrame: null,
        totals,
        subtrees: rows,
      };
    });
  }

  async function exerciseDoorThroughNormalInput() {
    const candidates = await page.evaluate(() => window.__fw.scene3d.clubhouse().doors.map((door, index) => ({
      index,
      name: door.name,
      along: door.along,
      x: door.world.x,
      z: door.world.z,
      open: door.open,
    })).sort((a, b) => Number(a.open) - Number(b.open)));
    let chosen = null;
    let focus = null;
    for (const door of candidates) {
      for (const side of [1, -1]) {
        await page.evaluate(({ target, sideSign }) => {
          const walk = window.__fw.scene3d.walk.state;
          if (target.along === 'x') {
            walk.x = target.x;
            walk.z = target.z + sideSign * 1.15;
            walk.yaw = sideSign > 0 ? 0 : Math.PI;
          } else {
            walk.x = target.x + sideSign * 1.15;
            walk.z = target.z;
            walk.yaw = sideSign > 0 ? Math.PI / 2 : -Math.PI / 2;
          }
          walk.pitch = 0;
          window.__fw.scene3d.walk.clearKeys?.();
        }, { target: door, sideSign: side });
        await page.waitForTimeout(300);
        focus = await page.evaluate(() => window.__fw.scene3d.walk.getFocusLabel?.() || null);
        if (focus && /door/i.test(focus)) {
          chosen = door;
          break;
        }
      }
      if (chosen) break;
    }
    if (!chosen) return { ok: false, reason: 'No door acquired normal walk focus', lastFocus: focus };
    const before = await page.evaluate((index) => {
      const door = window.__fw.scene3d.clubhouse().doors[index];
      return { open: door.open, angle: door.angle, hingeRotationY: door.hinge.rotation.y };
    }, chosen.index);
    await page.keyboard.press('e');
    await page.waitForTimeout(1100);
    const after = await page.evaluate((index) => {
      const door = window.__fw.scene3d.clubhouse().doors[index];
      return { open: door.open, angle: door.angle, hingeRotationY: door.hinge.rotation.y };
    }, chosen.index);
    return {
      ok: before.open !== after.open && Math.abs(after.hingeRotationY - before.hingeRotationY) > 0.1,
      input: 'normal keyboard E from normal walk focus',
      door: chosen.name,
      focus,
      before,
      after,
    };
  }

  // Production frame-time sample: no Object3D wrapper or profiler is active.
  await enterGame();
  const firstBootCounters = await browserCounters();
  await startFrameSample();
  await runNormalControlRoute();
  const productionFrames = summarizeFrames(await stopFrameSample());
  const productionRender = await renderSnapshot();
  const matrixFlagAB = await matrixFlagMicrobenchmark();

  // A clean second boot restores the exact default spawn, then repeats the same
  // normal-control route with recursive-call attribution active.
  await enterGame();
  const census = await sceneCensus();
  const secondBootCounters = await browserCounters();
  const instrumentedRender = await renderSnapshot();
  await installMatrixProbe();
  await startFrameSample();
  await startMatrixProbe();
  await runNormalControlRoute();
  const matrixHotpath = await stopMatrixProbe();
  const instrumentedFrames = summarizeFrames(await stopFrameSample());
  matrixHotpath.scenePassesPerAnimationFrame = +(matrixHotpath.scenePasses
    / Math.max(1, instrumentedFrames.frames)).toFixed(3);
  const doorFunctional = await exerciseDoorThroughNormalInput();
  const afterCounters = await browserCounters();

  const matrixAuto = census.total.matrixAutoUpdate;
  const totalNodes = census.total.nodes;
  return {
    ok: errors.length === 0 && doorFunctional.ok,
    protocol: {
      browser: 'Playwright Chrome',
      viewport: '1600x900',
      deviceScaleFactor: 1,
      fixture: 'run-playwright --bootstrap, willow-creek seed 424242, tutorial hidden',
      world: 'clock paused at 14:00; fixed dry 72F weather; assets idle before warm-up',
      warmupMsPerBoot: 2500,
      route: 'Continue, then Shift+W+ArrowRight 1.8s; W+ArrowLeft 1.8s; W+D 1.8s',
      routeInput: 'normal player-facing button and keyboard controls',
      productionSample: 'first clean boot, no matrix instrumentation',
      attributionSample: 'second clean boot, temporary Object3D.updateMatrixWorld wrapper',
    },
    production: {
      frames: productionFrames,
      render: productionRender,
      browser: firstBootCounters,
    },
    sceneCensus: census,
    matrixFlagAB,
    matrixHotpath,
    doorFunctional,
    instrumentationImpact: {
      frames: instrumentedFrames,
      render: instrumentedRender,
      browserBefore: secondBootCounters,
      browserAfter: afterCounters,
    },
    headline: {
      totalSceneNodes: totalNodes,
      matrixAutoUpdateNodes: matrixAuto,
      matrixAutoUpdatePercent: +(matrixAuto * 100 / Math.max(1, totalNodes)).toFixed(2),
      alreadyFrozenNodes: totalNodes - matrixAuto,
      updateMatrixWorldCallsOnInstrumentedRoute: matrixHotpath.totals.calls,
      updateMatrixWorldExclusiveInstrumentedMs: matrixHotpath.totals.exclusiveMs,
    },
    measurementCoverage: {
      measured: [
        'average FPS', '1% low FPS', '0.1% low FPS', 'frame-time distribution and variance',
        'draw calls', 'triangles', 'geometry count', 'texture object count', 'program count',
        'material count', 'JavaScript heap', 'active event-listener count',
        'per-top-level subtree node and matrixAutoUpdate counts',
        'updateMatrixWorld recursive calls and instrumented exclusive time',
      ],
      unavailable: [
        'texture byte residency (WebGLRenderer exposes object count, not allocation bytes)',
        'UI update frequency (no relevant UI panel changes during the walking route)',
      ],
    },
    diagnostics: {
      warningCount: warnings.length,
      errorCount: errors.length,
      warnings: warnings.slice(0, 40),
      errors,
    },
  };
}
