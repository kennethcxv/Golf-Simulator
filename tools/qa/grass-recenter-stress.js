// Near-camera grass recenter stress and exact-output browser QA.
//
// Run with the normal server already active. The phase name is also the
// before/after capture hook, so identical commands can retain separate evidence:
//   $env:GRASS_QA_PHASE='after'
//   $env:GRASS_QA_EVENTS='120'
//   $env:QA_RESULT_PATH='qa/steam-performance-master-pass/grass-recenter-stress/after/result.json'
//   node tools/qa/run-playwright.cjs tools/qa/grass-recenter-stress.js --bootstrap
//
// --bootstrap is the documented deterministic save fixture. Direct position
// writes below only establish and restore a repeatable camera fixture; the
// measured stress route itself uses the player's real movement keys.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = path.resolve(process.env.QA_REPO_ROOT || process.cwd());
  const safePhase = String(process.env.GRASS_QA_PHASE || 'current')
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/^-+|-+$/g, '') || 'current';
  const requestedEvents = Number.parseInt(process.env.GRASS_QA_EVENTS || '120', 10);
  const targetEvents = Math.max(100, Number.isFinite(requestedEvents) ? requestedEvents : 120);
  const out = path.join(
    repo,
    'qa',
    'steam-performance-master-pass',
    'grass-recenter-stress',
    safePhase,
  );
  fs.mkdirSync(out, { recursive: true });
  const relative = (file) => path.relative(repo, file).replace(/\\/g, '/');

  const diagnostics = {
    consoleErrors: [],
    consoleWarnings: [],
    pageErrors: [],
    requestFailures: [],
    httpErrors: [],
    functionalFailures: [],
  };
  let phase = 'setup';
  page.on('console', (message) => {
    const entry = { phase, text: message.text() };
    if (message.type() === 'error') diagnostics.consoleErrors.push(entry);
    if (message.type() === 'warning') diagnostics.consoleWarnings.push(entry);
  });
  page.on('pageerror', (error) => diagnostics.pageErrors.push({ phase, message: error.message }));
  page.on('requestfailed', (request) => diagnostics.requestFailures.push({
    phase,
    url: request.url(),
    errorText: request.failure()?.errorText || 'unknown',
  }));
  page.on('response', (response) => {
    if (response.status() < 400) return;
    diagnostics.httpErrors.push({
      phase,
      url: response.url(),
      status: response.status(),
      statusText: response.statusText(),
    });
  });

  const result = {
    ok: false,
    protocol: {
      phase: safePhase,
      launch: [
        `$env:GRASS_QA_PHASE='${safePhase}'`,
        `$env:GRASS_QA_EVENTS='${targetEvents}'`,
        `$env:QA_RESULT_PATH='qa/steam-performance-master-pass/grass-recenter-stress/${safePhase}/result.json'`,
        'node tools/qa/run-playwright.cjs tools/qa/grass-recenter-stress.js --bootstrap',
      ].join('; '),
      fixture: 'relaxed empire seed 424242, first property, fixed dry weather, paused simulation',
      viewport: { width: 1600, height: 900, deviceScaleFactor: 1 },
      measuredRoute: 'normal W + Shift + ArrowLeft circular sprint; stop only after live grass buffer versions prove the target recenter count',
      resourceWarmup: 'one four-second normal-control loop over the identical route before resource and exact-output baselines',
      targetRecenterEvents: targetEvents,
      minimumRequiredRecenterEvents: 100,
      stressTimeoutMs: 90000,
      performanceGate: {
        forcedGcHeapGrowthBytes: 32 * 1024 * 1024,
        listenerGrowth: 0,
        rendererResourceGrowth: 0,
        rationale: 'A fixed already-warm scene should retain resources and listeners; 32 MiB permits Chromium heap noise while rejecting unbounded stress growth.',
      },
      metricSources: {
        frames: 'requestAnimationFrame deltas during only the normal-control stress route',
        recenterEvents: 'CourseGrassSward instanceMatrix.version delta; paired against instanceColor.version',
        renderer: 'THREE.WebGLRenderer.info reset and sampled once per display frame with its prior autoReset restored afterward',
        textureMemory: 'unique scene texture dimensions * RGBA8 * 4/3 mip estimate; renderer.info.memory.texture count is also retained',
        heap: 'CDP Runtime.getHeapUsage and Performance metrics after HeapProfiler.collectGarbage',
        listeners: 'CDP Memory.getDOMCounters.jsEventListeners plus Performance.JSEventListeners',
        ui: 'MutationObserver records beneath #ui during the measured route',
      },
    },
    screenshots: {},
    fixture: null,
    exact: null,
    stress: null,
    resources: null,
    browser: null,
    cleanup: null,
    checks: [],
    diagnostics,
  };

  const settle = async (frames = 8) => page.evaluate((count) => new Promise((resolve) => {
    let remaining = count;
    const tick = () => {
      remaining -= 1;
      if (remaining <= 0) resolve();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }), frames);

  const screenshot = async (name) => {
    const file = path.join(out, `${name}.png`);
    await page.screenshot({ path: file });
    result.screenshots[name] = relative(file);
    return result.screenshots[name];
  };

  const sceneCensus = async () => page.evaluate(() => {
    const app = window.__fw;
    const scene3d = app.scene3d;
    const renderer = scene3d.renderer;
    const allMaterials = new Set();
    const visibleMaterials = new Set();
    const allTextures = new Set();
    const visibleTextures = new Set();
    let nodes = 0;
    let meshes = 0;
    let visibleMeshes = 0;
    const effectivelyVisible = (object) => {
      for (let node = object; node; node = node.parent) if (!node.visible) return false;
      return object.layers.test(scene3d.camera.layers);
    };
    const addTexture = (texture, visible) => {
      if (!texture?.isTexture) return;
      allTextures.add(texture);
      if (visible) visibleTextures.add(texture);
    };
    scene3d.scene.traverse((object) => {
      nodes += 1;
      if (!(object.isMesh || object.isPoints || object.isLine)) return;
      meshes += 1;
      const visible = effectivelyVisible(object);
      if (visible) visibleMeshes += 1;
      for (const material of (Array.isArray(object.material) ? object.material : [object.material])) {
        if (!material) continue;
        allMaterials.add(material);
        if (visible) visibleMaterials.add(material);
        for (const value of Object.values(material)) addTexture(value, visible);
        for (const uniform of Object.values(material.uniforms || {})) {
          const value = uniform?.value;
          if (Array.isArray(value)) value.forEach((entry) => addTexture(entry, visible));
          else addTexture(value, visible);
        }
      }
    });
    const textureBytes = (textures) => {
      let bytes = 0;
      let dimensioned = 0;
      for (const texture of textures) {
        const stack = [texture.image || texture.source?.data];
        let textureHasDimensions = false;
        while (stack.length) {
          const image = stack.pop();
          if (Array.isArray(image)) { stack.push(...image); continue; }
          const width = Number(image?.width || image?.videoWidth || image?.naturalWidth || image?.data?.width || 0);
          const height = Number(image?.height || image?.videoHeight || image?.naturalHeight || image?.data?.height || 0);
          if (width > 0 && height > 0) {
            bytes += Math.round(width * height * 4 * (4 / 3));
            textureHasDimensions = true;
          }
        }
        if (textureHasDimensions) dimensioned += 1;
      }
      return { estimatedRgbaMipBytes: bytes, dimensionedTextures: dimensioned };
    };
    const grassMeshes = [];
    scene3d.scene.traverse((object) => {
      if (object.userData?.courseGrass) grassMeshes.push(object);
    });
    const grass = grassMeshes[0] || null;
    return {
      sceneUuid: scene3d.scene.uuid,
      nodes,
      meshes,
      visibleMeshes,
      materials: allMaterials.size,
      visibleMaterials: visibleMaterials.size,
      textures: allTextures.size,
      visibleTextures: visibleTextures.size,
      textureMemoryAll: textureBytes(allTextures),
      textureMemoryVisible: textureBytes(visibleTextures),
      rendererMemory: { ...renderer.info.memory },
      rendererPrograms: renderer.info.programs?.length ?? null,
      pageHeapBytes: performance.memory?.usedJSHeapSize ?? null,
      domElements: document.querySelectorAll('*').length,
      grass: grass ? {
        taggedMeshCount: grassMeshes.length,
        uuid: grass.uuid,
        geometryUuid: grass.geometry?.uuid || null,
        materialUuid: grass.material?.uuid || null,
        matrixAttributeUuid: grass.instanceMatrix?.uuid || null,
        colorAttributeUuid: grass.instanceColor?.uuid || null,
        count: grass.count,
        visible: grass.visible,
        matrixVersion: grass.instanceMatrix?.version ?? null,
        colorVersion: grass.instanceColor?.version ?? null,
      } : null,
    };
  });

  const signature = async (operation, key) => page.evaluate(({ operation: op, key: storeKey }) => {
    const meshes = [];
    window.__fw.scene3d.scene.traverse((object) => {
      if (object.userData?.courseGrass) meshes.push(object);
    });
    const mesh = meshes[0];
    if (!mesh) return { error: 'CourseGrassSward is absent', taggedMeshCount: meshes.length };
    window.__grassQaExact ||= {};
    const count = mesh.count;
    const matrix = mesh.instanceMatrix.array.slice(0, count * 16);
    const color = mesh.instanceColor.array.slice(0, count * 3);
    const hash = (typed) => {
      const words = new Uint32Array(typed.buffer, typed.byteOffset, typed.byteLength / 4);
      let a = 2166136261 >>> 0;
      let b = 0x9e3779b9 >>> 0;
      for (let index = 0; index < words.length; index += 1) {
        const word = words[index] >>> 0;
        a = Math.imul(a ^ word, 16777619) >>> 0;
        b = (Math.imul(b ^ (word + index), 2246822519) + 3266489917) >>> 0;
      }
      return `${a.toString(16).padStart(8, '0')}:${b.toString(16).padStart(8, '0')}`;
    };
    const descriptor = {
      taggedMeshCount: meshes.length,
      meshUuid: mesh.uuid,
      name: mesh.name,
      isInstancedMesh: mesh.isInstancedMesh === true,
      geometryUuid: mesh.geometry?.uuid || null,
      materialUuid: mesh.material?.uuid || null,
      matrixAttributeUuid: mesh.instanceMatrix?.uuid || null,
      colorAttributeUuid: mesh.instanceColor?.uuid || null,
      capacity: mesh.instanceMatrix.array.length / 16,
      colorCapacity: mesh.instanceColor.array.length / 3,
      count,
      visible: mesh.visible,
      frustumCulled: mesh.frustumCulled,
      castShadow: mesh.castShadow,
      receiveShadow: mesh.receiveShadow,
      matrixUsage: mesh.instanceMatrix.usage,
      colorUsage: mesh.instanceColor.usage,
      matrixVersion: mesh.instanceMatrix.version,
      colorVersion: mesh.instanceColor.version,
      matrixHash: hash(matrix),
      colorHash: hash(color),
    };
    if (op === 'store') {
      window.__grassQaExact[storeKey] = { descriptor, matrix, color };
      return descriptor;
    }
    const before = window.__grassQaExact[storeKey];
    if (!before) return { error: `No stored grass signature ${storeKey}`, descriptor };
    const compare = (a, b) => {
      if (a.length !== b.length) return { exact: false, firstMismatch: -1, beforeLength: a.length, afterLength: b.length };
      for (let index = 0; index < a.length; index += 1) {
        if (!Object.is(a[index], b[index])) {
          return { exact: false, firstMismatch: index, before: a[index], after: b[index], length: a.length };
        }
      }
      return { exact: true, firstMismatch: null, length: a.length };
    };
    const stableFields = [
      'taggedMeshCount', 'meshUuid', 'name', 'isInstancedMesh', 'geometryUuid',
      'materialUuid', 'matrixAttributeUuid', 'colorAttributeUuid', 'capacity',
      'colorCapacity', 'count', 'visible', 'frustumCulled', 'castShadow',
      'receiveShadow', 'matrixUsage', 'colorUsage', 'matrixHash', 'colorHash',
    ];
    const descriptorMismatches = stableFields
      .filter((field) => !Object.is(before.descriptor[field], descriptor[field]))
      .map((field) => ({ field, before: before.descriptor[field], after: descriptor[field] }));
    return {
      descriptor,
      descriptorMismatches,
      matrix: compare(before.matrix, matrix),
      color: compare(before.color, color),
      exact: descriptorMismatches.length === 0
        && compare(before.matrix, matrix).exact
        && compare(before.color, color).exact,
    };
  }, { operation, key });

  const browserCensus = async (cdp) => {
    await cdp.send('HeapProfiler.collectGarbage');
    await settle(4);
    const [dom, perf, heap] = await Promise.all([
      cdp.send('Memory.getDOMCounters'),
      cdp.send('Performance.getMetrics'),
      cdp.send('Runtime.getHeapUsage'),
    ]);
    const metrics = Object.fromEntries(perf.metrics.map((entry) => [entry.name, entry.value]));
    return {
      runtimeHeapUsedBytes: heap.usedSize,
      runtimeHeapTotalBytes: heap.totalSize,
      performanceHeapUsedBytes: metrics.JSHeapUsedSize ?? null,
      performanceEventListeners: metrics.JSEventListeners ?? null,
      domNodes: dom.nodes,
      documents: dom.documents,
      jsEventListeners: dom.jsEventListeners,
    };
  };

  const installStressMonitor = async () => page.evaluate(() => {
    const app = window.__fw;
    const renderer = app.scene3d.renderer;
    const meshes = [];
    app.scene3d.scene.traverse((object) => {
      if (object.userData?.courseGrass) meshes.push(object);
    });
    if (meshes.length !== 1) throw new Error(`Expected one grass mesh, found ${meshes.length}.`);
    const mesh = meshes[0];
    const percentile = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] || 0;
    const mean = (values) => values.length
      ? values.reduce((sum, value) => sum + value, 0) / values.length
      : 0;
    const state = {
      running: true,
      startedAt: performance.now(),
      lastAt: null,
      frameTimesMs: [],
      drawCalls: [],
      triangles: [],
      uiMutationRecords: 0,
      uiMutationByType: {},
      startMatrixVersion: mesh.instanceMatrix.version,
      startColorVersion: mesh.instanceColor.version,
      lastMatrixVersion: mesh.instanceMatrix.version,
      lastColorVersion: mesh.instanceColor.version,
      recenterTimeline: [],
      invariantViolations: [],
      minCount: mesh.count,
      maxCount: mesh.count,
      priorAutoReset: renderer.info.autoReset,
      raf: 0,
    };
    const observer = new MutationObserver((records) => {
      state.uiMutationRecords += records.length;
      for (const record of records) {
        state.uiMutationByType[record.type] = (state.uiMutationByType[record.type] || 0) + 1;
      }
    });
    const ui = document.getElementById('ui');
    if (ui) observer.observe(ui, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
    renderer.info.autoReset = false;
    renderer.info.reset();
    const tick = (now) => {
      if (!state.running) return;
      if (state.lastAt != null) state.frameTimesMs.push(now - state.lastAt);
      state.lastAt = now;
      state.drawCalls.push(renderer.info.render.calls || 0);
      state.triangles.push(renderer.info.render.triangles || 0);
      renderer.info.reset();
      const matrixVersion = mesh.instanceMatrix.version;
      const colorVersion = mesh.instanceColor.version;
      if (matrixVersion !== state.lastMatrixVersion || colorVersion !== state.lastColorVersion) {
        const matrixStep = matrixVersion - state.lastMatrixVersion;
        const colorStep = colorVersion - state.lastColorVersion;
        const capacity = mesh.instanceMatrix.array.length / 16;
        const colorCapacity = mesh.instanceColor.array.length / 3;
        const valid = matrixStep === colorStep
          && matrixStep > 0
          && mesh.count >= 0
          && mesh.count <= capacity
          && capacity === colorCapacity
          && mesh.visible === (mesh.count > 0);
        const event = {
          atMs: +(now - state.startedAt).toFixed(3),
          matrixVersion,
          colorVersion,
          matrixStep,
          colorStep,
          count: mesh.count,
          visible: mesh.visible,
          capacity,
          colorCapacity,
          valid,
        };
        state.recenterTimeline.push(event);
        if (!valid) state.invariantViolations.push(event);
        state.lastMatrixVersion = matrixVersion;
        state.lastColorVersion = colorVersion;
        state.minCount = Math.min(state.minCount, mesh.count);
        state.maxCount = Math.max(state.maxCount, mesh.count);
      }
      state.raf = requestAnimationFrame(tick);
    };
    state.raf = requestAnimationFrame(tick);
    const finish = () => {
      if (!state.running) return state.finished;
      state.running = false;
      cancelAnimationFrame(state.raf);
      observer.disconnect();
      renderer.info.reset();
      renderer.info.autoReset = state.priorAutoReset;
      const frames = state.frameTimesMs.slice(3).filter((value) => value > 0);
      const sorted = frames.slice().sort((a, b) => a - b);
      const slowCount = Math.max(1, Math.ceil(sorted.length * 0.01));
      const elapsedMs = performance.now() - state.startedAt;
      const matrixVersionDelta = mesh.instanceMatrix.version - state.startMatrixVersion;
      const colorVersionDelta = mesh.instanceColor.version - state.startColorVersion;
      state.finished = {
        elapsedMs: +elapsedMs.toFixed(3),
        recenterEvents: matrixVersionDelta,
        matrixVersionDelta,
        colorVersionDelta,
        recenterTimeline: state.recenterTimeline,
        invariantViolations: state.invariantViolations,
        grassCount: { min: state.minCount, max: state.maxCount, final: mesh.count },
        frame: {
          count: frames.length,
          averageFps: mean(frames) ? +(1000 / mean(frames)).toFixed(2) : null,
          onePercentLowFps: mean(sorted.slice(-slowCount))
            ? +(1000 / mean(sorted.slice(-slowCount))).toFixed(2)
            : null,
          averageMs: +mean(frames).toFixed(3),
          p50Ms: +percentile(sorted, 0.50).toFixed(3),
          p95Ms: +percentile(sorted, 0.95).toFixed(3),
          p99Ms: +percentile(sorted, 0.99).toFixed(3),
          worstMs: +(sorted.at(-1) || 0).toFixed(3),
          over33ms: frames.filter((value) => value > 33.333).length,
          over50ms: frames.filter((value) => value > 50).length,
          over100ms: frames.filter((value) => value > 100).length,
          rawFrameTimesMs: frames.map((value) => +value.toFixed(3)),
        },
        renderer: {
          drawCallsAverage: +mean(state.drawCalls).toFixed(2),
          drawCallsMax: Math.max(0, ...state.drawCalls),
          trianglesAverage: +mean(state.triangles).toFixed(2),
          trianglesMax: Math.max(0, ...state.triangles),
        },
        ui: {
          mutationRecords: state.uiMutationRecords,
          mutationRecordsPerSecond: elapsedMs > 0
            ? +(state.uiMutationRecords / (elapsedMs / 1000)).toFixed(3)
            : 0,
          byType: state.uiMutationByType,
        },
      };
      return state.finished;
    };
    window.__grassQaRuntime = {
      status: () => ({
        running: state.running,
        matrixVersionDelta: mesh.instanceMatrix.version - state.startMatrixVersion,
        colorVersionDelta: mesh.instanceColor.version - state.startColorVersion,
      }),
      stop: finish,
      abort: finish,
    };
    return window.__grassQaRuntime.status();
  });

  let original = null;
  let cdp = null;
  let browserBefore = null;
  let resourcesBefore = null;
  let routeFinished = false;
  try {
    phase = 'navigate';
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto('http://localhost:8457/');
    await page.waitForFunction(() => document.readyState === 'complete');
    const continueButton = page.getByRole('button', { name: 'Continue', exact: true });
    await continueButton.waitFor({ state: 'visible' });
    await page.waitForFunction(() => {
      const button = [...document.querySelectorAll('button')]
        .find((item) => item.textContent.trim() === 'Continue');
      return button && !button.disabled;
    });
    await continueButton.click();
    await page.waitForFunction(() => (
      window.__fw?.screen === 'game'
      && window.__fw?.state?.course?.vec
      && window.__fw?.scene3d?.walk?.isActive?.()
      && window.__fw?.prewarming !== true
    ), null, { timeout: 90000 });
    await page.waitForFunction(() => {
      const veil = document.querySelector('.load-veil');
      if (!veil) return true;
      const style = getComputedStyle(veil);
      return style.display === 'none' || Number.parseFloat(style.opacity || '1') <= 0.01;
    }, null, { timeout: 90000 });
    await page.evaluate(async () => {
      const barrier = window.__fw.scene3d.assetBarrier?.(15000);
      if (barrier && !barrier.idle) await barrier.promise;
    });
    // The course barrier does not own clubhouse merchandise/delivery GLBs. Let
    // those production loaders finish before taking a resource-growth baseline;
    // otherwise their legitimate late attachment is misreported as grass churn.
    await page.waitForFunction(() => {
      const clubhouse = window.__fw?.scene3d?.clubhouse?.();
      return !!clubhouse
        && clubhouse.assetsReady?.() === true
        && clubhouse.deliveryEquipmentReady?.() === true;
    }, null, { timeout: 90000 });
    await page.evaluate(async () => {
      const renderer = window.__fw.scene3d.renderer;
      let previous = '';
      let stableSamples = 0;
      const started = performance.now();
      while (performance.now() - started < 15000) {
        let nodes = 0;
        let meshes = 0;
        window.__fw.scene3d.scene.traverse((object) => {
          nodes += 1;
          if (object.isMesh) meshes += 1;
        });
        const current = `${nodes}:${meshes}:${renderer.info.memory.geometries}:${renderer.info.memory.textures}`;
        stableSamples = current === previous ? stableSamples + 1 : 0;
        previous = current;
        if (stableSamples >= 10) return;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error('Scene resources did not stabilize before grass stress baseline.');
    });
    await settle(24);

    phase = 'fixed-fixture';
    original = await page.evaluate(() => {
      const app = window.__fw;
      return {
        walk: {
          x: app.scene3d.walk.state.x,
          z: app.scene3d.walk.state.z,
          yaw: app.scene3d.walk.state.yaw,
          pitch: app.scene3d.walk.state.pitch,
        },
        speedIdx: app.speedIdx,
        weather: JSON.parse(JSON.stringify(app.state.weather)),
        reservations: JSON.parse(JSON.stringify(app.state.reservations || null)),
      };
    });
    // Clubhouse customers advance on wall-clock time even while the simulation
    // clock is paused. Silence random walk-ins and due reservation arrivals so
    // this gate measures only grass recentering, then restore both sources.
    await page.evaluate(() => {
      const app = window.__fw;
      const clubhouse = app.scene3d.clubhouse();
      clubhouse.setOrganicWalkins?.(false);
      clubhouse.clearWalkins?.();
      if (app.state.reservations?.booked) app.state.reservations.booked = [];
      app.scene3d.setGolfersFrozen?.(true);
    });
    result.fixture = await page.evaluate(async () => {
      const { ZONE } = await import('/src/sim/constants.js');
      const app = window.__fw;
      const scene3d = app.scene3d;
      const walkApi = scene3d.walk;
      const walk = walkApi.state;
      const grassy = new Set([
        ZONE.OUT, ZONE.ROUGH, ZONE.FAIRWAY, ZONE.TEE,
        ZONE.FRINGE, ZONE.HEAVY, ZONE.BED, ZONE.SEMI,
      ]);
      const routeRadius = (walk.speed * walk.runMult) / 1.9;
      const clearRoute = (candidate) => {
        for (let index = 0; index < 48; index += 1) {
          const angle = (index / 48) * Math.PI * 2;
          const x = candidate.x + routeRadius * (Math.cos(angle) - 1);
          const z = candidate.z - routeRadius * Math.sin(angle);
          if (!scene3d.inBoundsWorld(x, z)
            || !walkApi.isFree(x, z, walk.radius + 0.12)
            || !grassy.has(scene3d.zoneAtWorld(x, z))) return false;
        }
        return true;
      };
      const base = { x: walk.x, z: walk.z };
      let fixture = null;
      for (let ring = 0; ring <= 45 && !fixture; ring += 1) {
        const radius = ring * 5;
        for (let spoke = 0; spoke < 32; spoke += 1) {
          const angle = (spoke / 32) * Math.PI * 2;
          const candidate = {
            x: base.x + Math.cos(angle) * radius,
            z: base.z + Math.sin(angle) * radius,
          };
          if (clearRoute(candidate)) { fixture = candidate; break; }
        }
      }
      if (!fixture) throw new Error('Could not find a collision-free grassy circular sprint fixture.');
      walkApi.clearKeys();
      walk.x = fixture.x;
      walk.z = fixture.z;
      walk.yaw = 0;
      walk.pitch = -0.12;
      app.speedIdx = 0;
      app.state.weather.locked = true;
      app.state.weather.today = {
        tempHiF: 74,
        tempLoF: 55,
        rainIn: 0,
        humidity: 0.4,
        windMph: 6,
      };
      return {
        x: fixture.x,
        z: fixture.z,
        yaw: 0,
        pitch: -0.12,
        routeRadius: +routeRadius.toFixed(6),
        routeDiameter: +(routeRadius * 2).toFixed(6),
        searchOrigin: base,
      };
    });
    await page.waitForFunction(() => {
      const meshes = [];
      window.__fw.scene3d.scene.traverse((object) => {
        if (object.userData?.courseGrass) meshes.push(object);
      });
      return meshes.length === 1 && meshes[0].visible && meshes[0].count > 0;
    }, null, { timeout: 15000 });
    // Rendering resources are created lazily the first time an already-present
    // object enters the frustum. Warm the exact circular route once through
    // normal controls before the resource baseline so that later renderer.info
    // growth represents retention/churn, not first-use residency.
    phase = 'resource-warmup-route';
    await page.keyboard.down('w');
    await page.keyboard.down('Shift');
    await page.keyboard.down('ArrowLeft');
    await page.waitForTimeout(4000);
    await page.keyboard.up('ArrowLeft');
    await page.keyboard.up('Shift');
    await page.keyboard.up('w');
    await page.evaluate((fixture) => {
      const app = window.__fw;
      const walkApi = app.scene3d.walk;
      walkApi.clearKeys();
      walkApi.state.x = fixture.x;
      walkApi.state.z = fixture.z;
      walkApi.state.yaw = fixture.yaw;
      walkApi.state.pitch = fixture.pitch;
    }, result.fixture);
    await settle(24);

    cdp = await page.context().newCDPSession(page);
    await Promise.all([
      cdp.send('Performance.enable'),
      cdp.send('HeapProfiler.enable'),
    ]);
    browserBefore = await browserCensus(cdp);
    resourcesBefore = await sceneCensus();
    const exactBefore = await signature('store', 'fixed-fixture');
    result.exact = { before: exactBefore, after: null };
    await screenshot('01-fixed-before');

    phase = 'normal-control-stress';
    await installStressMonitor();
    await page.keyboard.down('w');
    await page.keyboard.down('Shift');
    await page.keyboard.down('ArrowLeft');
    await page.waitForFunction((minimum) => (
      (window.__grassQaRuntime?.status?.().matrixVersionDelta || 0) >= minimum
    ), targetEvents, { timeout: 90000 });
    await page.keyboard.up('ArrowLeft');
    await page.keyboard.up('Shift');
    await page.keyboard.up('w');
    result.stress = await page.evaluate(() => window.__grassQaRuntime.stop());
    routeFinished = true;
    await settle(8);
    await screenshot('02-normal-route-end');

    phase = 'fixed-after';
    // Use two known-clear points from the circular fixture so the final exact
    // pose necessarily crosses the 1.5 yd recenter threshold. These writes are
    // outside the measured route and exist only for deterministic A/B evidence.
    await page.evaluate(async (fixture) => {
      const app = window.__fw;
      const walk = app.scene3d.walk.state;
      const grass = (() => {
        let found = null;
        app.scene3d.scene.traverse((object) => {
          if (object.userData?.courseGrass) found = object;
        });
        return found;
      })();
      const waitVersion = (before) => new Promise((resolve, reject) => {
        const started = performance.now();
        const tick = () => {
          if (grass.instanceMatrix.version > before) resolve();
          else if (performance.now() - started > 10000) reject(new Error('Grass did not recenter at fixed checkpoint.'));
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      const far = { x: fixture.x - fixture.routeDiameter, z: fixture.z };
      const currentToFar = Math.hypot(walk.x - far.x, walk.z - far.z);
      const first = currentToFar > 3 ? far : { x: fixture.x, z: fixture.z };
      let version = grass.instanceMatrix.version;
      walk.x = first.x;
      walk.z = first.z;
      walk.yaw = fixture.yaw;
      walk.pitch = fixture.pitch;
      await waitVersion(version);
      if (first.x === fixture.x && first.z === fixture.z) {
        version = grass.instanceMatrix.version;
        walk.x = far.x;
        walk.z = far.z;
        await waitVersion(version);
      }
      version = grass.instanceMatrix.version;
      walk.x = fixture.x;
      walk.z = fixture.z;
      walk.yaw = fixture.yaw;
      walk.pitch = fixture.pitch;
      await waitVersion(version);
    }, result.fixture);
    await settle(16);
    result.exact.after = await signature('compare', 'fixed-fixture');
    await screenshot('03-fixed-after');

    const resourcesAfter = await sceneCensus();
    const browserAfter = await browserCensus(cdp);
    result.resources = {
      before: resourcesBefore,
      after: resourcesAfter,
      delta: {
        nodes: resourcesAfter.nodes - resourcesBefore.nodes,
        meshes: resourcesAfter.meshes - resourcesBefore.meshes,
        visibleMeshes: resourcesAfter.visibleMeshes - resourcesBefore.visibleMeshes,
        materials: resourcesAfter.materials - resourcesBefore.materials,
        textures: resourcesAfter.textures - resourcesBefore.textures,
        rendererGeometries: resourcesAfter.rendererMemory.geometries - resourcesBefore.rendererMemory.geometries,
        rendererTextures: resourcesAfter.rendererMemory.textures - resourcesBefore.rendererMemory.textures,
        rendererPrograms: resourcesAfter.rendererPrograms - resourcesBefore.rendererPrograms,
        pageHeapBytes: resourcesAfter.pageHeapBytes == null || resourcesBefore.pageHeapBytes == null
          ? null
          : resourcesAfter.pageHeapBytes - resourcesBefore.pageHeapBytes,
        domElements: resourcesAfter.domElements - resourcesBefore.domElements,
      },
    };
    result.browser = {
      before: browserBefore,
      after: browserAfter,
      delta: {
        runtimeHeapUsedBytes: browserAfter.runtimeHeapUsedBytes - browserBefore.runtimeHeapUsedBytes,
        performanceHeapUsedBytes: browserAfter.performanceHeapUsedBytes == null
          || browserBefore.performanceHeapUsedBytes == null
          ? null
          : browserAfter.performanceHeapUsedBytes - browserBefore.performanceHeapUsedBytes,
        performanceEventListeners: browserAfter.performanceEventListeners == null
          || browserBefore.performanceEventListeners == null
          ? null
          : browserAfter.performanceEventListeners - browserBefore.performanceEventListeners,
        domNodes: browserAfter.domNodes - browserBefore.domNodes,
        documents: browserAfter.documents - browserBefore.documents,
        jsEventListeners: browserAfter.jsEventListeners - browserBefore.jsEventListeners,
      },
    };
  } catch (error) {
    diagnostics.functionalFailures.push({
      phase,
      message: error?.message || String(error),
      stack: error?.stack || null,
    });
    await screenshot('blocker').catch(() => {});
  } finally {
    for (const key of ['w', 'a', 's', 'd', 'Shift', 'ArrowLeft', 'ArrowRight']) {
      await page.keyboard.up(key).catch(() => {});
    }
    if (!routeFinished) {
      const partial = await page.evaluate(() => window.__grassQaRuntime?.abort?.() || null).catch(() => null);
      if (partial && !result.stress) result.stress = partial;
    }
    if (original) {
      result.cleanup = await page.evaluate(({ original: saved }) => {
        const app = window.__fw;
        const walkApi = app.scene3d.walk;
        walkApi.clearKeys();
        Object.assign(walkApi.state, saved.walk);
        app.speedIdx = saved.speedIdx;
        for (const key of Object.keys(app.state.weather)) delete app.state.weather[key];
        Object.assign(app.state.weather, saved.weather);
        if (saved.reservations === null) delete app.state.reservations;
        else app.state.reservations = JSON.parse(JSON.stringify(saved.reservations));
        app.scene3d.clubhouse()?.setOrganicWalkins?.(true);
        app.scene3d.setGolfersFrozen?.(false);
        delete window.__grassQaExact;
        delete window.__grassQaRuntime;
        return {
          walkRestoredExactly: Object.entries(saved.walk)
            .every(([key, value]) => Object.is(walkApi.state[key], value)),
          speedRestoredExactly: Object.is(app.speedIdx, saved.speedIdx),
          weatherRestoredExactly: JSON.stringify(app.state.weather) === JSON.stringify(saved.weather),
          reservationsRestoredExactly: JSON.stringify(app.state.reservations || null)
            === JSON.stringify(saved.reservations),
          golferSpawningRestored: true,
          keysCleared: true,
          monitorRemoved: !window.__grassQaRuntime,
          exactSnapshotRemoved: !window.__grassQaExact,
        };
      }, { original }).catch((error) => ({ error: error.message }));
      await settle(3).catch(() => {});
    }
  }

  const knownShaderWarning = /THREE\.WebGLProgram: Program Info Log:.*warning X4000: use of potentially uninitialized variable/s;
  const unexpectedWarnings = diagnostics.consoleWarnings
    .filter((entry) => !knownShaderWarning.test(entry.text));
  const unexpectedRequestFailures = diagnostics.requestFailures
    .filter((entry) => entry.errorText !== 'net::ERR_ABORTED');
  const addCheck = (id, ok, actual, expected) => result.checks.push({ id, ok: !!ok, actual, expected });
  const beforeExact = result.exact?.before;
  const afterExact = result.exact?.after;
  addCheck('functional-route', diagnostics.functionalFailures.length === 0,
    diagnostics.functionalFailures, []);
  addCheck('normal-gameplay-walk-mode', !!result.fixture,
    result.fixture, 'fixed fixture reached from the live walk scene');
  addCheck('at-least-100-recenter-events', (result.stress?.recenterEvents || 0) >= 100,
    result.stress?.recenterEvents ?? null, '>= 100 live matrix-version increments');
  addCheck('requested-recenter-events', (result.stress?.recenterEvents || 0) >= targetEvents,
    result.stress?.recenterEvents ?? null, `>= ${targetEvents}`);
  addCheck('matrix-color-version-pairing', result.stress?.matrixVersionDelta === result.stress?.colorVersionDelta,
    {
      matrix: result.stress?.matrixVersionDelta ?? null,
      color: result.stress?.colorVersionDelta ?? null,
    }, 'exactly equal');
  addCheck('every-observed-recenter-invariant', result.stress?.invariantViolations?.length === 0,
    result.stress?.invariantViolations || null, []);
  addCheck('single-bounded-dynamic-grass-mesh', !!beforeExact
    && beforeExact.taggedMeshCount === 1
    && beforeExact.name === 'CourseGrassSward'
    && beforeExact.isInstancedMesh
    && beforeExact.capacity === 12000
    && beforeExact.colorCapacity === 12000
    && beforeExact.matrixUsage === 35048
    && beforeExact.colorUsage === 35048
    && beforeExact.frustumCulled === false
    && beforeExact.castShadow === false
    && beforeExact.receiveShadow === false,
  beforeExact || null, 'one 12,000-capacity DynamicDrawUsage grass mesh with the production render flags');
  addCheck('exact-fixed-pose-output', afterExact?.exact === true,
    afterExact || null, 'bit-for-bit matrix/color prefixes plus stable mesh/resource identities');
  addCheck('grass-remained-populated', (result.stress?.grassCount?.min || 0) > 0,
    result.stress?.grassCount || null, 'count remains > 0 throughout the grassy route');
  addCheck('renderer-resource-growth', !!result.resources
    && result.resources.delta.rendererGeometries === 0
    && result.resources.delta.rendererTextures === 0
    && result.resources.delta.rendererPrograms === 0,
  result.resources?.delta || null, '0 geometries, 0 textures, 0 programs');
  addCheck('listener-growth', !!result.browser
    && result.browser.delta.jsEventListeners <= 0
    && (result.browser.delta.performanceEventListeners == null
      || result.browser.delta.performanceEventListeners <= 0),
  result.browser?.delta || null, '<= 0 active listener growth');
  addCheck('forced-gc-heap-growth', !!result.browser
    && result.browser.delta.runtimeHeapUsedBytes <= result.protocol.performanceGate.forcedGcHeapGrowthBytes,
  result.browser?.delta.runtimeHeapUsedBytes ?? null,
  `<= ${result.protocol.performanceGate.forcedGcHeapGrowthBytes} bytes`);
  addCheck('console-errors', diagnostics.consoleErrors.length === 0,
    diagnostics.consoleErrors, []);
  addCheck('unexpected-console-warnings', unexpectedWarnings.length === 0,
    unexpectedWarnings, []);
  addCheck('page-errors', diagnostics.pageErrors.length === 0,
    diagnostics.pageErrors, []);
  addCheck('http-errors', diagnostics.httpErrors.length === 0,
    diagnostics.httpErrors, []);
  addCheck('unexpected-request-failures', unexpectedRequestFailures.length === 0,
    unexpectedRequestFailures, []);
  addCheck('cleanup-restored', !!result.cleanup
    && result.cleanup.walkRestoredExactly
    && result.cleanup.speedRestoredExactly
    && result.cleanup.weatherRestoredExactly
    && result.cleanup.reservationsRestoredExactly
    && result.cleanup.golferSpawningRestored
    && result.cleanup.keysCleared
    && result.cleanup.monitorRemoved
    && result.cleanup.exactSnapshotRemoved,
  result.cleanup, 'walk/weather/speed restored, keys cleared, QA globals removed');
  result.diagnostics.knownWarnings = diagnostics.consoleWarnings
    .filter((entry) => knownShaderWarning.test(entry.text));
  result.diagnostics.unexpectedWarnings = unexpectedWarnings;
  result.diagnostics.unexpectedRequestFailures = unexpectedRequestFailures;
  result.ok = result.checks.every((check) => check.ok);
  return result;
}
