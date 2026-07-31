async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const pass = process.env.RESORT_QA_PASS || 'iteration-1';
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const repoRoot = process.env.QA_REPO_ROOT || process.cwd();
  const out = path.join(repoRoot, 'qa', 'clubhouse_resort', pass);
  const manifest = JSON.parse(fs.readFileSync(
    path.join(repoRoot, 'qa', 'clubhouse_resort', 'blender', 'clubhouse_resort_4000_manifest.json'),
    'utf8',
  ));
  fs.mkdirSync(out, { recursive: true });

  const browserDiagnostics = [];
  const successfulResponses = new Set();
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      browserDiagnostics.push({ kind: `console:${message.type()}`, message: message.text() });
    }
  });
  page.on('pageerror', (error) => {
    browserDiagnostics.push({ kind: 'pageerror', message: error.message });
  });
  page.on('requestfailed', (request) => {
    browserDiagnostics.push({
      kind: 'requestfailed',
      message: `${request.url()} (${request.failure()?.errorText || 'unknown'})`,
    });
  });
  page.on('response', (response) => {
    if (response.ok()) successfulResponses.add(response.url());
  });

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('golfempire:autosave'));
    const holding = raw.holdings.find((entry) => entry.property.id === raw.activeId) || raw.holdings[0];
    holding.property.tierId = 'resortStyle';
    holding.state.property.tierId = 'resortStyle';
    holding.state.tutorial.complete = true;
    holding.state.tutorial.hidden = true;
    const reno = holding.state.shop.reno;
    reno.grime?.fill(0);
    reno.windows?.fill(0);
    reno.clutter?.forEach((pile) => { pile.cleared = true; });
    if (reno.exterior) {
      reno.exterior.weeds?.fill(0);
      reno.exterior.siding?.fill(0);
      reno.exterior.gutter = 0;
      reno.exterior.cobwebs = 0;
      reno.exterior.light = 0;
    }
    localStorage.setItem('golfempire:autosave', JSON.stringify(raw));
  });
  await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
  await page.waitForFunction(() => {
    const clubhouse = window.__fw?.scene3d?.clubhouse?.();
    return clubhouse?.resortClubhouse?.diagnostics?.().status === 'ready';
  }, null, { timeout: 90000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
  }, null, { timeout: 90000 });
  await page.waitForTimeout(1600);

  const fixture = await page.evaluate(async () => {
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    clubhouse.setOrganicWalkins?.(false);
    clubhouse.clearWalkins?.();
    if (Array.isArray(app.state.shop?.orders)) app.state.shop.orders.length = 0;
    app.state.weather.locked = true;
    app.state.weather.today = {
      tempHiF: 72,
      tempLoF: 54,
      rainIn: 0,
      humidity: 0.38,
      windMph: 4,
    };
    const day = Math.floor(app.state.clock.minutes / 1440) * 1440;
    app.state.clock.minutes = day + 15 * 60;
    app.scene3d.applyTimeWeather(15 * 60, app.state.weather);
    const ui = await import('/src/ui/ui.js');
    ui.clearNotifications();
    await new Promise((resolve) => setTimeout(resolve, 250));
    document.querySelectorAll('.notification-center, .toast').forEach((node) => {
      node.style.visibility = 'hidden';
    });
    document.querySelectorAll('.shop-prompt, .shop-lockhint, .shop-cond').forEach((node) => {
      node.style.visibility = 'hidden';
    });

    const root = clubhouse.resortClubhouse.root();
    const names = [];
    let visibleCollisionProxyCount = 0;
    let runtimeMeshCount = 0;
    root?.traverse((node) => {
      if (node.name) names.push(node.name);
      if (node.isMesh) runtimeMeshCount += 1;
      const collision = /^(?:COL(?:_|$)|.*Collision(?:_|$))/i.test(node.name || '')
        || node.userData?.collision_proxy === true
        || node.userData?.collisionProxy === true;
      if (collision && node.visible) visibleCollisionProxyCount += 1;
    });
    const requiredNodes = [
      'PIVOT_DoorLeft',
      'PIVOT_DoorRight',
      'SOCKET_MainEntrance',
      'SOCKET_BagDrop',
      'SOCKET_CartStaging',
      'SOCKET_Patio',
    ];
    return {
      center: { x: clubhouse.group.position.x, z: clubhouse.group.position.z },
      diagnostics: clubhouse.resortClubhouse.diagnostics(),
      clubhouseKeys: Object.keys(clubhouse).sort(),
      assetAudit: {
        runtimeMeshCount,
        visibleCollisionProxyCount,
        requiredNodes: Object.fromEntries(requiredNodes.map((name) => [name, names.includes(name)])),
        separatePlayerDecorationAuthority: Boolean(clubhouse.interior?.parent),
      },
      deterministicWeather: { ...app.state.weather.today },
    };
  });

  const pose = async (shot) => {
    await page.evaluate(({ shot: camera, center }) => {
      const app = window.__fw;
      const walk = app.scene3d.walk;
      walk.clearKeys();
      walk.state.x = center.x + camera.at[0];
      walk.state.z = center.z + camera.at[1];
      const dx = camera.to[0] - camera.at[0];
      const dz = camera.to[1] - camera.at[1];
      const length = Math.hypot(dx, dz) || 1;
      walk.state.yaw = Math.atan2(-dx / length, -dz / length);
      walk.state.pitch = camera.pitch;
      app.scene3d.applyTimeWeather(15 * 60, app.state.weather);
    }, { shot, center: fixture.center });
    // The first-person camera copies the walk state on the next render frame.
    // Synchronize distance-gated interior content only after that copy, so QA
    // teleports measure the camera actually being captured rather than the
    // camera from the preceding shot.
    await page.waitForTimeout(120);
    await page.evaluate(() => window.__fw.scene3d.clubhouse().syncCameraVisibility());
    await page.waitForTimeout(600);
    return page.evaluate((requested) => {
      const scene3d = window.__fw.scene3d;
      const walk = scene3d.walk;
      const clubhouse = scene3d.clubhouse();
      return {
        requested,
        actual: { x: walk.state.x, z: walk.state.z, yaw: walk.state.yaw, pitch: walk.state.pitch },
        renderState: {
          cameraPosition: {
            x: scene3d.camera.position.x,
            y: scene3d.camera.position.y,
            z: scene3d.camera.position.z,
          },
          legacyInteriorVisible: clubhouse.interior.visible,
          resortEnabled: clubhouse.resortClubhouse.diagnostics().enabled,
        },
        positionError: Math.hypot(
          walk.state.x - requested.x,
          walk.state.z - requested.z,
        ),
      };
    }, { x: fixture.center.x + shot.at[0], z: fixture.center.z + shot.at[1] });
  };

  const shots = [
    { id: '01-front-hero', at: [-20, 32], to: [0, 5.5], pitch: 0.03 },
    { id: '02-luxury-entrance', at: [-1, 21], to: [-0.8, 7.2], pitch: 0.01 },
    { id: '03-fountain-landscape', at: [-14, 23], to: [-5.8, 13.8], pitch: -0.02 },
    { id: '04-bag-drop', at: [18, 25], to: [8.7, 13], pitch: 0.01 },
    { id: '05-cart-staging', at: [29, 22], to: [16, 10], pitch: 0.02 },
    { id: '06-west-architecture', at: [-25, 4], to: [-8, 0], pitch: 0.03 },
    { id: '07-rear-patio', at: [-18, -28], to: [0, -8], pitch: 0.01 },
    { id: '08-rear-water-seating', at: [10, -24], to: [1, -10], pitch: -0.01 },
    { id: '09-empty-shell-sightline', at: [-0.8, 5.4], to: [-1, -5], pitch: 0 },
  ];
  const cameraEvidence = [];
  for (const shot of shots) {
    const evidence = await pose(shot);
    if (shot.id === '09-empty-shell-sightline') {
      await page.evaluate(() => {
        const interior = window.__fw.scene3d.clubhouse().interior;
        interior.userData.visualQaForceHidden = true;
        interior.visible = false;
      });
      await page.waitForTimeout(120);
    }
    await page.screenshot({ path: path.join(out, `${shot.id}.png`) });
    cameraEvidence.push({ id: shot.id, ...evidence });
  }

  await page.evaluate(() => {
    const clubhouse = window.__fw.scene3d.clubhouse();
    clubhouse.interior.userData.visualQaForceHidden = false;
    clubhouse.syncCameraVisibility();
    for (const selector of ['.shop-prompt', '.shop-lockhint', '.shop-cond']) {
      const element = document.querySelector(selector);
      if (element) element.style.visibility = '';
    }
  });

  const captureBrowserMetrics = async (collectGarbage = false) => {
    const session = await page.context().newCDPSession(page);
    if (collectGarbage) await session.send('HeapProfiler.collectGarbage');
    await session.send('Performance.enable');
    const snapshot = await session.send('Performance.getMetrics');
    await session.detach();
    const metrics = Object.fromEntries(snapshot.metrics.map((metric) => [metric.name, metric.value]));
    return {
      jsHeapUsedBytes: metrics.JSHeapUsedSize ?? null,
      jsHeapTotalBytes: metrics.JSHeapTotalSize ?? null,
      eventListeners: metrics.JSEventListeners ?? null,
      nodes: metrics.Nodes ?? null,
      documents: metrics.Documents ?? null,
    };
  };

  const summarizeFrames = (sample, scenario) => {
    const frameTimes = sample.frames.filter((value) => value > 0);
    const slowest = [...frameTimes].sort((a, b) => b - a);
    const onePercentCount = Math.max(1, Math.ceil(slowest.length * 0.01));
    const onePercentFrame = slowest.slice(0, onePercentCount)
      .reduce((sum, value) => sum + value, 0) / onePercentCount;
    const totalFrameTime = frameTimes.reduce((sum, value) => sum + value, 0);
    return {
      scenario,
      durationMs: sample.durationMs,
      frameCount: frameTimes.length,
      averageFps: frameTimes.length * 1000 / totalFrameTime,
      onePercentLowFps: 1000 / onePercentFrame,
      worstFrameMs: slowest[0] || null,
      uiMutationCount: sample.uiMutations,
      uiMutationsPerSecond: sample.uiMutations / (sample.durationMs / 1000),
    };
  };

  // Acceptance route: use the shipped keyboard input path to approach the
  // authored door, interact with E, and cross its colliders with W.
  await page.evaluate(() => {
    const target = document.querySelector('.hud') || document.querySelector('#ui');
    const probe = {
      start: performance.now(),
      prior: performance.now(),
      frames: [],
      uiMutations: 0,
      stopped: false,
      observer: null,
    };
    probe.observer = new MutationObserver((records) => { probe.uiMutations += records.length; });
    if (target) probe.observer.observe(target, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    });
    const tick = (now) => {
      probe.frames.push(now - probe.prior);
      probe.prior = now;
      if (!probe.stopped) requestAnimationFrame(tick);
    };
    window.__resortRoutePerformanceProbe = probe;
    requestAnimationFrame(tick);
  });
  await page.locator('canvas').first().click({ position: { x: 800, y: 450 } });
  await page.evaluate((center) => {
    const walk = window.__fw.scene3d.walk;
    walk.clearKeys();
    walk.state.x = center.x - 0.8;
    walk.state.z = center.z + 11.1;
    walk.state.yaw = 0;
    walk.state.pitch = 0;
  }, fixture.center);
  const normalStart = await page.evaluate(() => ({
    x: window.__fw.scene3d.walk.state.x,
    z: window.__fw.scene3d.walk.state.z,
  }));
  await page.keyboard.down('w');
  await page.waitForTimeout(650);
  await page.keyboard.up('w');
  const approachEnd = await page.evaluate(() => ({
    x: window.__fw.scene3d.walk.state.x,
    z: window.__fw.scene3d.walk.state.z,
  }));
  await page.keyboard.press('e');
  await page.waitForTimeout(700);
  const doorAfterInteract = await page.evaluate(() => {
    const root = window.__fw.scene3d.clubhouse().resortClubhouse.root();
    return {
      leftY: root.getObjectByName('PIVOT_DoorLeft')?.rotation.y ?? null,
      rightY: root.getObjectByName('PIVOT_DoorRight')?.rotation.y ?? null,
    };
  });
  await page.keyboard.down('w');
  await page.waitForTimeout(1450);
  await page.keyboard.up('w');
  await page.waitForTimeout(350);
  const normalEnd = await page.evaluate(() => ({
    x: window.__fw.scene3d.walk.state.x,
    z: window.__fw.scene3d.walk.state.z,
  }));
  await page.screenshot({ path: path.join(out, '10-normal-controls-after-entry.png') });
  const normalRouteSample = await page.evaluate(() => new Promise((resolve) => {
    const probe = window.__resortRoutePerformanceProbe;
    requestAnimationFrame((now) => {
      probe.stopped = true;
      probe.observer?.disconnect();
      resolve({
        frames: probe.frames.slice(1),
        uiMutations: probe.uiMutations,
        durationMs: now - probe.start,
      });
      delete window.__resortRoutePerformanceProbe;
    });
  }));
  const normalRoutePerformance = summarizeFrames(
    normalRouteSample,
    'normal-controls-approach-open-cross-1600x900',
  );

  // Repeatedly exercise the shipped interaction binding while standing inside
  // the entry. Two garbage-collected batches distinguish retained growth from
  // transient allocations, while an even count restores the final open state.
  const interactionBaseline = await captureBrowserMetrics(true);
  for (let index = 0; index < 12; index += 1) {
    await page.keyboard.press('e');
    await page.waitForTimeout(100);
  }
  await page.waitForTimeout(250);
  const interactionAfterFirstBatch = await captureBrowserMetrics(true);
  for (let index = 0; index < 12; index += 1) {
    await page.keyboard.press('e');
    await page.waitForTimeout(100);
  }
  await page.waitForTimeout(250);
  const interactionAfterSecondBatch = await captureBrowserMetrics(true);
  const repeatedInteractions = {
    action: 'toggle resort entry with shipped E binding',
    count: 24,
    batchSize: 12,
    before: interactionBaseline,
    afterFirstBatch: interactionAfterFirstBatch,
    afterSecondBatch: interactionAfterSecondBatch,
    eventListenerGrowth: Number.isFinite(interactionBaseline.eventListeners)
      && Number.isFinite(interactionAfterSecondBatch.eventListeners)
      ? interactionAfterSecondBatch.eventListeners - interactionBaseline.eventListeners
      : null,
    firstBatchHeapGrowthBytes: Number.isFinite(interactionBaseline.jsHeapUsedBytes)
      && Number.isFinite(interactionAfterFirstBatch.jsHeapUsedBytes)
      ? interactionAfterFirstBatch.jsHeapUsedBytes - interactionBaseline.jsHeapUsedBytes
      : null,
    secondBatchHeapGrowthBytes: Number.isFinite(interactionAfterFirstBatch.jsHeapUsedBytes)
      && Number.isFinite(interactionAfterSecondBatch.jsHeapUsedBytes)
      ? interactionAfterSecondBatch.jsHeapUsedBytes - interactionAfterFirstBatch.jsHeapUsedBytes
      : null,
  };

  const performanceCamera = { id: 'performance-fixed-front', at: [-20, 32], to: [0, 5.5], pitch: 0.03 };
  const performanceCameraEvidence = await pose(performanceCamera);
  const frameSample = await page.evaluate(async () => {
    const target = document.querySelector('.hud') || document.querySelector('#ui');
    let uiMutations = 0;
    const observer = new MutationObserver((records) => { uiMutations += records.length; });
    if (target) observer.observe(target, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    });
    const frames = [];
    let prior = performance.now();
    const start = prior;
    await new Promise((resolve) => {
      function tick(now) {
        frames.push(now - prior);
        prior = now;
        if (now - start >= 4000) resolve();
        else requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    });
    observer.disconnect();
    return { frames: frames.slice(1), uiMutations, durationMs: performance.now() - start };
  });

  const rendererMetrics = await page.evaluate(() => new Promise((resolve) => {
    const app = window.__fw;
    const output = app.scene3d.renderer;
    output.info.autoReset = false;
    output.info.reset();
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const materials = new Set();
      const textures = new Set();
      let sceneNodes = 0;
      let visibleMeshes = 0;
      let sceneTriangles = 0;
      app.scene3d.scene.traverseVisible((object) => {
        sceneNodes += 1;
        if (!object.isMesh || !object.geometry) return;
        visibleMeshes += 1;
        const triangles = object.geometry.index
          ? object.geometry.index.count / 3
          : (object.geometry.getAttribute('position')?.count || 0) / 3;
        sceneTriangles += triangles * (object.isInstancedMesh ? object.count : 1);
        for (const material of (Array.isArray(object.material) ? object.material : [object.material])) {
          if (!material) continue;
          materials.add(material.uuid);
          for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap']) {
            if (material[key]) textures.add(material[key].uuid);
          }
        }
      });
      const result = {
        drawCalls: output.info.render.calls,
        renderedTriangles: output.info.render.triangles,
        sceneNodes,
        visibleMeshes,
        sceneTriangles: Math.round(sceneTriangles),
        materialCount: materials.size,
        textureCount: textures.size,
        textureMemoryBytes: null,
        textureMemoryReason: 'Three.js exposes texture counts but not allocated GPU texture bytes.',
        geometriesInMemory: output.info.memory.geometries,
        texturesInMemory: output.info.memory.textures,
      };
      output.info.autoReset = true;
      resolve(result);
    }));
  }));

  const frameTimes = frameSample.frames.filter((value) => value > 0);
  const slowest = [...frameTimes].sort((a, b) => b - a);
  const onePercentCount = Math.max(1, Math.ceil(slowest.length * 0.01));
  const onePercentFrame = slowest.slice(0, onePercentCount)
    .reduce((sum, value) => sum + value, 0) / onePercentCount;
  const totalFrameTime = frameTimes.reduce((sum, value) => sum + value, 0);
  const performance = {
    scenario: 'fixed-front-hero-clear-weather-1600x900-4s',
    camera: performanceCameraEvidence,
    durationMs: frameSample.durationMs,
    frameCount: frameTimes.length,
    averageFps: frameTimes.length * 1000 / totalFrameTime,
    onePercentLowFps: 1000 / onePercentFrame,
    worstFrameMs: slowest[0] || null,
    uiMutationCount: frameSample.uiMutations,
    uiMutationsPerSecond: frameSample.uiMutations / (frameSample.durationMs / 1000),
    renderer: rendererMetrics,
    browser: await captureBrowserMetrics(),
  };

  const benignAborts = browserDiagnostics.filter((entry) => {
    if (entry.kind !== 'requestfailed' || !entry.message.includes('(net::ERR_ABORTED)')) return false;
    const url = entry.message.slice(0, entry.message.lastIndexOf(' ('));
    return fixture.diagnostics.status === 'ready'
      && url.endsWith('/vendor/models/clubhouse/clubhouse_resort_4000.glb')
      && successfulResponses.has(url);
  });
  const errors = browserDiagnostics.filter((entry) => entry.kind !== 'console:warning'
    && !benignAborts.includes(entry));
  const warnings = browserDiagnostics.filter((entry) => entry.kind === 'console:warning');
  const requiredNodesPresent = Object.values(fixture.assetAudit.requiredNodes).every(Boolean);
  const normalControlsPassed = normalEnd.z < normalStart.z - 1
    && normalEnd.z < fixture.center.z + 7.2;
  const result = {
    ok: fixture.diagnostics.status === 'ready'
      && fixture.diagnostics.pivotCount === 2
      && fixture.diagnostics.colliderCount === 29
      && fixture.diagnostics.runtimeBatch?.offlineOptimized === true
      // The warm motor-court aggregate is a deliberate 24th static material
      // batch; with 16 preserved interactive meshes, 40 is the valid ceiling.
      && fixture.diagnostics.runtimeBatch?.batchedDrawCalls <= 40
      && fixture.assetAudit.visibleCollisionProxyCount === 0
      && requiredNodesPresent
      && normalControlsPassed
      && errors.length === 0,
    pass,
    baseUrl,
    out,
    manifest,
    fixture,
    cameraEvidence,
    normalControls: {
      start: normalStart,
      approachEnd,
      doorAfterInteract,
      end: normalEnd,
      forwardDistance: normalStart.z - normalEnd.z,
      passed: normalControlsPassed,
    },
    normalRoutePerformance,
    repeatedInteractions,
    browserDiagnostics: { errors, warnings, benignAborts },
    performance,
  };
  fs.writeFileSync(path.join(out, 'browser-diagnostics.json'), `${JSON.stringify(result.browserDiagnostics, null, 2)}\n`);
  fs.writeFileSync(path.join(out, 'performance.json'), `${JSON.stringify(performance, null, 2)}\n`);
  fs.writeFileSync(path.join(out, 'performance-route.json'), `${JSON.stringify(normalRoutePerformance, null, 2)}\n`);
  fs.writeFileSync(path.join(out, 'interaction-leak.json'), `${JSON.stringify(repeatedInteractions, null, 2)}\n`);
  fs.writeFileSync(path.join(out, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}
