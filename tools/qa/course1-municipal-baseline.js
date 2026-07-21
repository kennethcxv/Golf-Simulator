async (page) => {
  // COURSE 1 FAILING-MUNICIPAL BASELINE
  //
  // This is the immutable before-change route for the municipal clubhouse and
  // its immediate property. Camera injection establishes repeatable visual and
  // performance fixtures only. The entrance route itself uses the same canvas,
  // keyboard, collision, and door interaction path as a player.
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = process.cwd();
  const pass = process.env.COURSE1_QA_PASS || 'baseline';
  const out = process.env.COURSE1_QA_OUT
    ? path.resolve(process.env.COURSE1_QA_OUT)
    : path.join(repo, 'qa', 'course1_municipal', pass);
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  fs.mkdirSync(out, { recursive: true });

  const viewport = { width: 1600, height: 900 };
  const diagnostics = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      diagnostics.push({ kind: `console:${message.type()}`, message: message.text() });
    }
  });
  page.on('pageerror', (error) => diagnostics.push({ kind: 'pageerror', message: error.message }));
  page.on('requestfailed', (request) => {
    const reason = request.failure()?.errorText || 'unknown';
    diagnostics.push({
      kind: /ERR_ABORTED/i.test(reason) ? 'requestaborted' : 'requestfailed',
      message: `${request.url()} (${reason})`,
    });
  });
  page.on('response', (response) => {
    if (response.status() >= 400) {
      diagnostics.push({
        kind: 'http-response',
        message: `${response.status()} ${response.request().method()} ${response.url()}`,
      });
    }
  });

  await page.setViewportSize(viewport);
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.getByText('Continue', { exact: true }).click();
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
  }, null, { timeout: 90000 });
  await page.waitForFunction(async () => {
    const clubhouse = window.__fw?.scene3d?.clubhouse?.();
    if (!clubhouse) return false;
    if (clubhouse.assetsReady && !clubhouse.assetsReady()) return false;
    const production = typeof clubhouse.sheet06Production === 'function'
      ? clubhouse.sheet06Production()
      : clubhouse.sheet06Production;
    if (!production) return true;
    try { await production.ready; } catch { return false; }
    return production.diagnostics?.().activationStatus === 'active';
  }, null, { timeout: 90000 });
  await page.waitForFunction(async () => {
    const municipal = window.__fw?.scene3d?.clubhouse?.()?.course1Municipal;
    if (!municipal) return false;
    try { await municipal.ready; } catch { return false; }
    return municipal.diagnostics?.().ready === true;
  }, null, { timeout: 90000 });

  const fixture = await page.evaluate(() => {
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    const walk = app.scene3d.walk;
    app.speedIdx = 0;
    walk.clearKeys?.();
    walk.setTool?.(null);
    walk.setSpraying?.(false);
    walk.setSoaping?.(false);
    clubhouse.setOrganicWalkins?.(false);
    clubhouse.clearWalkins?.();
    const day = Math.floor(app.state.clock.minutes / 1440) * 1440;
    app.state.clock.minutes = day + 14 * 60;
    app.state.weather.today = {
      tempHiF: 72,
      tempLoF: 54,
      rainIn: 0,
      humidity: 0.48,
      windMph: 5,
    };
    app.state.weather.locked = true;
    app.scene3d.applyTimeWeather?.(14 * 60, app.state.weather);
    return {
      description: 'Willow Creek / Course 1, 2 PM, clear locked weather, organic customers disabled',
      interiorOrigin: clubhouse.interior.position.toArray(),
      shopLayoutFurnitureCount: (app.state.shop?.layout || []).length,
      exteriorState: JSON.parse(JSON.stringify(app.state.shop?.reno?.exterior || null)),
      municipal: clubhouse.course1Municipal?.diagnostics?.() || null,
    };
  });
  await page.waitForTimeout(1200);

  const cameras = [
    { id: '01-front-player-approach', x: -1.0, z: 18.0, tx: -1.0, tz: 5.6, pitch: 0.04 },
    { id: '02-front-west-oblique', x: -15.2, z: 14.2, tx: -1.2, tz: 2.0, pitch: 0.05 },
    { id: '03-east-service-side', x: 18.5, z: 4.0, tx: 7.5, tz: -0.4, pitch: 0.04 },
    { id: '04-rear-service-yard', x: 5.0, z: -18.0, tx: 3.0, tz: -5.4, pitch: 0.04 },
    { id: '05-main-room-from-entry', x: -0.8, z: 4.35, tx: -2.0, tz: -3.2, pitch: 0.03 },
    { id: '06-main-room-return-view', x: -4.8, z: -4.0, tx: -1.0, tz: 5.8, pitch: 0.02 },
    { id: '07-service-wing', x: 1.8, z: 2.8, tx: 5.2, tz: -1.8, pitch: 0.02 },
  ];

  async function pose(shot) {
    await page.evaluate((camera) => {
      const app = window.__fw;
      const walk = app.scene3d.walk;
      const origin = app.scene3d.clubhouse().interior.position;
      walk.clearKeys?.();
      walk.state.x = origin.x + camera.x;
      walk.state.z = origin.z + camera.z;
      const dx = origin.x + camera.tx - walk.state.x;
      const dz = origin.z + camera.tz - walk.state.z;
      const distance = Math.hypot(dx, dz) || 1;
      walk.state.yaw = Math.atan2(-dx / distance, -dz / distance);
      walk.state.pitch = camera.pitch;
      const day = Math.floor(app.state.clock.minutes / 1440) * 1440;
      app.state.clock.minutes = day + 14 * 60;
      app.scene3d.applyTimeWeather?.(14 * 60, app.state.weather);
    }, shot);
    await page.waitForTimeout(650);
  }

  const captures = [];
  for (const camera of cameras) {
    await pose(camera);
    const file = path.join(out, `${camera.id}.png`);
    await page.screenshot({ path: file });
    captures.push(file);
  }

  async function browserMetrics() {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Performance.enable');
    const result = await cdp.send('Performance.getMetrics');
    await cdp.detach();
    const values = Object.fromEntries(result.metrics.map((metric) => [metric.name, metric.value]));
    return {
      jsHeapUsedBytes: values.JSHeapUsedSize ?? null,
      jsHeapTotalBytes: values.JSHeapTotalSize ?? null,
      eventListeners: values.JSEventListeners ?? null,
      nodes: values.Nodes ?? null,
      documents: values.Documents ?? null,
    };
  }

  async function rendererMetrics() {
    return page.evaluate(() => new Promise((resolve) => {
      const s3 = window.__fw.scene3d;
      const output = s3.renderer;
      output.info.autoReset = false;
      output.info.reset();
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const materials = new Set();
        const textures = new Set();
        let nodes = 0;
        let visibleMeshes = 0;
        let sceneTriangles = 0;
        s3.scene.traverse((object) => {
          nodes += 1;
          if (!object.isMesh || !object.visible) return;
          visibleMeshes += 1;
          const triangles = object.geometry?.index
            ? object.geometry.index.count / 3
            : (object.geometry?.attributes?.position?.count || 0) / 3;
          sceneTriangles += triangles * (object.isInstancedMesh ? object.count : 1);
          for (const material of (Array.isArray(object.material) ? object.material : [object.material])) {
            if (!material) continue;
            materials.add(material.uuid);
            for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap']) {
              if (material[key]) textures.add(material[key].uuid);
            }
          }
        });
        const metrics = {
          drawCalls: output.info.render.calls,
          renderedTriangles: output.info.render.triangles,
          sceneTriangles: Math.round(sceneTriangles),
          sceneNodes: nodes,
          visibleMeshes,
          materialCount: materials.size,
          textureCount: textures.size,
          textureMemoryBytes: null,
          textureMemoryReason: 'Three.js exposes resident texture count but not allocated GPU byte size.',
          geometriesInMemory: output.info.memory.geometries,
          texturesInMemory: output.info.memory.textures,
        };
        output.info.autoReset = true;
        resolve(metrics);
      }));
    }));
  }

  async function sampleFrames(durationMs, action = null) {
    let actionError = null;
    const pending = page.evaluate(async (duration) => {
      const hud = document.querySelector('.hud') || document.querySelector('#ui');
      let uiMutations = 0;
      const observer = new MutationObserver((records) => { uiMutations += records.length; });
      if (hud) observer.observe(hud, { subtree: true, childList: true, characterData: true, attributes: true });
      const frames = [];
      let prior = performance.now();
      const start = prior;
      await new Promise((resolve) => {
        function tick(now) {
          frames.push(now - prior);
          prior = now;
          if (now - start >= duration) resolve();
          else requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
      });
      observer.disconnect();
      return { frames: frames.slice(1), uiMutations, durationMs: performance.now() - start };
    }, durationMs);
    if (action) {
      try { await action(); } catch (error) { actionError = error.message; }
    }
    const sample = await pending;
    const frameTimes = sample.frames.filter((value) => Number.isFinite(value) && value > 0);
    const slowest = [...frameTimes].sort((a, b) => b - a);
    const onePercentCount = Math.max(1, Math.ceil(slowest.length * 0.01));
    const onePercentFrame = slowest.slice(0, onePercentCount)
      .reduce((sum, value) => sum + value, 0) / onePercentCount;
    const duration = frameTimes.reduce((sum, value) => sum + value, 0);
    return {
      rawFrameTimesMs: frameTimes,
      frameCount: frameTimes.length,
      averageFps: frameTimes.length * 1000 / duration,
      onePercentLowFps: 1000 / onePercentFrame,
      worstFrameMs: slowest[0] || null,
      uiMutationCount: sample.uiMutations,
      uiMutationsPerSecond: sample.uiMutations / (sample.durationMs / 1000),
      durationMs: sample.durationMs,
      actionError,
    };
  }

  await pose(cameras[0]);
  await page.waitForTimeout(1000);
  const idleSamples = [];
  for (let index = 0; index < 3; index += 1) idleSamples.push(await sampleFrames(2500));
  const renderer = await rendererMetrics();
  const browserBeforeRoute = await browserMetrics();

  const routeStartShot = { x: -1.0, z: 10.2, tx: -1.0, tz: 6.2, pitch: 0.01 };
  await pose(routeStartShot);
  await page.locator('#game').click({ position: { x: 800, y: 450 }, force: true });
  await page.waitForTimeout(200);
  const routeStart = await page.evaluate(() => ({ ...window.__fw.scene3d.walk.state }));
  const routePerformance = await sampleFrames(5000, async () => {
    await page.keyboard.down('w');
    await page.waitForTimeout(1050);
    await page.keyboard.up('w');
    await page.keyboard.press('e');
    await page.waitForTimeout(300);
    await page.keyboard.down('w');
    await page.waitForTimeout(1850);
    await page.keyboard.up('w');
  });
  const routeEnd = await page.evaluate(() => ({
    walk: { ...window.__fw.scene3d.walk.state },
    door: JSON.parse(JSON.stringify(window.__fw.state.shop?.reno?.architecture?.doors?.main || null)),
  }));
  const routeCapture = path.join(out, '08-normal-control-entrance-result.png');
  await page.screenshot({ path: routeCapture });
  captures.push(routeCapture);
  const browserAfterRoute = await browserMetrics();
  const routeDistance = Math.hypot(routeEnd.walk.x - routeStart.x, routeEnd.walk.z - routeStart.z);

  const blockingDiagnostics = diagnostics.filter((entry) => ![
    'console:warning',
    'requestaborted',
  ].includes(entry.kind));
  const report = {
    ok: blockingDiagnostics.length === 0 && routeDistance > 2.5 && !routePerformance.actionError,
    capturedAt: new Date().toISOString(),
    launch: `QA_BASE_URL=${baseUrl} COURSE1_QA_PASS=${pass} node tools/qa/run-playwright.cjs tools/qa/course1-municipal-baseline.js --bootstrap`,
    methodology: {
      viewport,
      deviceScaleFactor: 1,
      buildMode: 'browser dev server, production Three.js scene',
      fixedConditions: fixture.description,
      cameraEstablishment: 'documented deterministic fixture; gameplay acceptance is the separate normal-control entrance route',
      warmup: 'asset readiness plus 1.2 seconds, then 1 second at the exterior performance camera',
      frameSampling: 'three consecutive 2.5-second idle samples and one five-second normal-control entrance sample',
      interactionControls: 'canvas click, W, E, W',
      textureMemory: renderer.textureMemoryReason,
    },
    fixture,
    cameras,
    captures,
    normalControlRoute: { routeStart, routeEnd, routeDistance },
    performance: {
      idleExteriorSamples: idleSamples,
      entranceRoute: routePerformance,
      renderer,
      browserBeforeRoute,
      browserAfterRoute,
      listenerGrowth: Number.isFinite(browserBeforeRoute.eventListeners) && Number.isFinite(browserAfterRoute.eventListeners)
        ? browserAfterRoute.eventListeners - browserBeforeRoute.eventListeners
        : null,
      heapGrowthBytes: Number.isFinite(browserBeforeRoute.jsHeapUsedBytes) && Number.isFinite(browserAfterRoute.jsHeapUsedBytes)
        ? browserAfterRoute.jsHeapUsedBytes - browserBeforeRoute.jsHeapUsedBytes
        : null,
    },
    diagnostics,
    blockingDiagnostics,
  };
  fs.writeFileSync(path.join(out, 'baseline-result.json'), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}
