async (page) => {
  // Matched performance/visual capture for the premium modular clubhouse project.
  // The fixture pins only the save, clock, weather, and starting camera. Movement
  // through the measured route uses the same keyboard and mouse events as a player.
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const phase = process.env.PREMIUM_CLUBHOUSE_QA_PHASE || 'baseline';
  const tier = process.env.PREMIUM_CLUBHOUSE_QA_TIER || 'municipal';
  const out = process.env.QA_OUT_DIR || path.join(
    process.env.QA_REPO_ROOT || process.cwd(), 'qa', 'premium-clubhouse', phase,
  );
  fs.mkdirSync(out, { recursive: true });

  const diagnostics = {
    consoleErrors: [],
    consoleWarnings: [],
    pageErrors: [],
    requestFailures: [],
  };
  page.on('console', (message) => {
    const entry = message.text();
    if (message.type() === 'error') diagnostics.consoleErrors.push(entry);
    if (message.type() === 'warning') diagnostics.consoleWarnings.push(entry);
  });
  page.on('pageerror', (error) => diagnostics.pageErrors.push(error.message));
  page.on('requestfailed', (request) => diagnostics.requestFailures.push({
    url: request.url(),
    error: request.failure()?.errorText || 'unknown',
  }));

  await page.addInitScript(() => {
    const add = EventTarget.prototype.addEventListener;
    const remove = EventTarget.prototype.removeEventListener;
    const counts = {};
    const keyFor = (target, type) => `${target === window ? 'window' : 'document'}:${type}`;
    EventTarget.prototype.addEventListener = function clubhouseTrackedAdd(type, listener, options) {
      if (this === window || this === document) {
        const key = keyFor(this, type);
        counts[key] = (counts[key] || 0) + 1;
      }
      return add.call(this, type, listener, options);
    };
    EventTarget.prototype.removeEventListener = function clubhouseTrackedRemove(type, listener, options) {
      if (this === window || this === document) {
        const key = keyFor(this, type);
        counts[key] = (counts[key] || 0) - 1;
      }
      return remove.call(this, type, listener, options);
    };
    window.__premiumClubhouseListenerCounts = counts;
  });

  await page.goto(baseUrl);
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.evaluate((requestedTier) => {
    const raw = JSON.parse(localStorage.getItem('golfempire:autosave'));
    const holding = raw.holdings.find((entry) => entry.property.id === raw.activeId) || raw.holdings[0];
    holding.property.tierId = requestedTier;
    holding.state.property.tierId = requestedTier;
    holding.state.tutorial.complete = true;
    holding.state.tutorial.hidden = true;
    if (holding.state.campaign) holding.state.campaign.businessOpen = false;
    localStorage.setItem('golfempire:autosave', JSON.stringify(raw));
  }, tier);
  await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
  // HARNESS_TRUST rule 5: reports absolute variant frame cost, so a CPU rasterizer's frame
  // numbers are not evidence about the live game. Refuse them.
  const { gateRenderer } = await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/perf-renderer-gate.mjs`);
  const rendererGate = await gateRenderer(page);
  if (tier === 'premiumPrivate') {
    await page.waitForFunction(() => (
      window.__fw?.scene3d?.clubhouse?.()?.premiumCountryClub?.diagnostics?.().status === 'ready'
    ), null, { timeout: 90000 });
  }
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    if (!veil) return true;
    const style = getComputedStyle(veil);
    return style.display === 'none' || Number(style.opacity || 1) <= 0.01;
  }, null, { timeout: 90000 });
  await page.waitForTimeout(2000);
  await page.evaluate(async () => {
    const ui = await import(new URL('src/ui/ui.js', document.baseURI).href);
    ui.clearNotifications();
    ui.clearToasts();
    const notifications = document.querySelector('.notification-center');
    if (notifications) notifications.style.display = 'none';
  });

  const clubhouseCenter = await page.evaluate(() => {
    const group = window.__fw.scene3d.clubhouse().group;
    return { x: group.position.x, z: group.position.z };
  });

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('HeapProfiler.enable');
  await cdp.send('Performance.enable');

  const setPose = async ({ x, z, targetX, targetZ, pitch = 0 }) => {
    await page.evaluate((pose) => {
      const app = window.__fw;
      app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440 + 20 * 60;
      app.state.weather = {
        ...app.state.weather,
        today: {
          ...app.state.weather?.today,
          tempHiF: 70,
          tempLoF: 52,
          rainIn: 0,
          humidity: 0.42,
          windMph: 4,
        },
      };
      app.scene3d.applyTimeWeather(20 * 60, app.state.weather);
      const walk = app.scene3d.walk;
      walk.clearKeys();
      walk.state.x = pose.x;
      walk.state.z = pose.z;
      const dx = pose.targetX - pose.x;
      const dz = pose.targetZ - pose.z;
      const length = Math.hypot(dx, dz) || 1;
      walk.state.yaw = Math.atan2(-dx / length, -dz / length);
      walk.state.pitch = pose.pitch;
    }, { x, z, targetX, targetZ, pitch });
    await page.waitForTimeout(500);
  };

  const startSampler = async (label) => page.evaluate((sampleLabel) => {
    const root = document.querySelector('#ui') || document.body;
    const sample = {
      label: sampleLabel,
      startedAt: performance.now(),
      frames: [],
      calls: [],
      triangles: [],
      uiMutationRecords: 0,
      raf: 0,
      last: performance.now(),
    };
    const observer = new MutationObserver((records) => { sample.uiMutationRecords += records.length; });
    observer.observe(root, { subtree: true, childList: true, attributes: true, characterData: true });
    sample.observer = observer;
    const renderer = window.__fw.scene3d.renderer;
    const tick = (now) => {
      sample.frames.push(now - sample.last);
      sample.last = now;
      sample.calls.push(renderer.info.render.calls || 0);
      sample.triangles.push(renderer.info.render.triangles || 0);
      sample.raf = requestAnimationFrame(tick);
    };
    sample.raf = requestAnimationFrame(tick);
    window.__premiumClubhouseSample = sample;
  }, label);

  const stopSampler = async () => page.evaluate(() => {
    const sample = window.__premiumClubhouseSample;
    cancelAnimationFrame(sample.raf);
    sample.observer.disconnect();
    const deltas = sample.frames.slice(2).filter((value) => value > 0 && value < 1000);
    const sorted = [...deltas].sort((a, b) => a - b);
    const worstCount = Math.max(1, Math.ceil(sorted.length * 0.01));
    const worstOnePercent = sorted.slice(-worstCount);
    const mean = (values) => values.length
      ? values.reduce((sum, value) => sum + value, 0) / values.length
      : null;
    const p = (fraction) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? null;
    const averageMs = mean(deltas);
    const elapsedMs = performance.now() - sample.startedAt;
    delete window.__premiumClubhouseSample;
    return {
      label: sample.label,
      elapsedMs,
      frame: {
        count: deltas.length,
        averageFps: averageMs ? 1000 / averageMs : null,
        onePercentLowFps: worstOnePercent.length ? 1000 / mean(worstOnePercent) : null,
        averageMs,
        p95Ms: p(0.95),
        p99Ms: p(0.99),
        worstMs: sorted.at(-1) ?? null,
      },
      renderer: {
        drawCallsAverage: mean(sample.calls),
        drawCallsMax: Math.max(0, ...sample.calls),
        trianglesAverage: mean(sample.triangles),
        trianglesMax: Math.max(0, ...sample.triangles),
      },
      ui: {
        mutationRecords: sample.uiMutationRecords,
        mutationRecordsPerSecond: sample.uiMutationRecords / Math.max(0.001, elapsedMs / 1000),
      },
    };
  });

  const resourceSnapshot = async (label) => {
    await cdp.send('HeapProfiler.collectGarbage');
    await page.waitForTimeout(100);
    await cdp.send('HeapProfiler.collectGarbage');
    const [dom, performanceMetrics, runtimeHeap, game] = await Promise.all([
      cdp.send('Memory.getDOMCounters'),
      cdp.send('Performance.getMetrics'),
      cdp.send('Runtime.getHeapUsage'),
      page.evaluate(() => {
        const scene3d = window.__fw.scene3d;
        const materials = new Set();
        const textures = new Set();
        const geometries = new Set();
        let meshes = 0;
        let sceneTriangles = 0;
        scene3d.scene.traverse((node) => {
          if (!node.isMesh) return;
          meshes += 1;
          if (node.geometry) {
            geometries.add(node.geometry.uuid);
            const count = node.geometry.index?.count
              || node.geometry.attributes?.position?.count
              || 0;
            sceneTriangles += (count / 3) * (node.isInstancedMesh ? node.count : 1);
          }
          for (const material of (Array.isArray(node.material) ? node.material : [node.material])) {
            if (!material) continue;
            materials.add(material.uuid);
            for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap']) {
              if (material[key]) textures.add(material[key].uuid);
            }
          }
        });
        const counts = { ...(window.__premiumClubhouseListenerCounts || {}) };
        return {
          meshes,
          sceneTriangles: Math.round(sceneTriangles),
          uniqueGeometries: geometries.size,
          uniqueMaterials: materials.size,
          uniqueTextures: textures.size,
          rendererMemory: { ...scene3d.renderer.info.memory },
          listeners: {
            net: Object.values(counts).reduce((sum, value) => sum + value, 0),
            byType: counts,
          },
          browserHeapBytes: performance.memory?.usedJSHeapSize ?? null,
          clubhouse: scene3d.clubhouse().premiumCountryClub?.diagnostics?.() || null,
        };
      }),
    ]);
    const metricMap = Object.fromEntries(performanceMetrics.metrics.map((metric) => [metric.name, metric.value]));
    return {
      label,
      ...game,
      dom,
      cdpHeapBytes: metricMap.JSHeapUsedSize ?? null,
      runtimeHeap,
    };
  };

  const exteriorPose = {
    x: clubhouseCenter.x,
    z: clubhouseCenter.z + 57,
    targetX: clubhouseCenter.x,
    targetZ: clubhouseCenter.z + 7,
    pitch: 0.055,
  };
  await setPose(exteriorPose);
  await page.screenshot({ path: `${out}/fixed-exterior.png` });
  const beforeResources = await resourceSnapshot('before-route');

  await startSampler('fixed-exterior-idle');
  await page.waitForTimeout(5000);
  const idle = await stopSampler();

  // Start farther down the approach, then use normal controls to walk and turn
  // through the clubhouse view. A fixed fixture pose is permitted by the QA
  // protocol; all measured locomotion itself stays on keyboard/mouse input.
  await setPose({
    x: clubhouseCenter.x,
    z: clubhouseCenter.z + 64,
    targetX: clubhouseCenter.x,
    targetZ: clubhouseCenter.z + 7,
    pitch: 0.035,
  });
  await page.mouse.click(800, 450);
  await startSampler('normal-controls-approach-route');
  await page.keyboard.down('Shift');
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(2400);
  await page.keyboard.up('KeyW');
  await page.keyboard.up('Shift');
  await page.keyboard.down('ArrowLeft');
  await page.waitForTimeout(650);
  await page.keyboard.up('ArrowLeft');
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(2100);
  await page.keyboard.up('KeyW');
  const route = await stopSampler();
  await page.screenshot({ path: `${out}/normal-controls-route-end.png` });
  const afterResources = await resourceSnapshot('after-route');

  const environment = await page.evaluate(() => ({
    userAgent: navigator.userAgent,
    viewport: { width: innerWidth, height: innerHeight },
    devicePixelRatio,
    gpu: (() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      const ext = gl?.getExtension('WEBGL_debug_renderer_info');
      return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null;
    })(),
  }));

  return {
    ok: diagnostics.consoleErrors.length === 0 && diagnostics.pageErrors.length === 0,
    phase,
    tier,
    protocol: {
      launch: 'node tools/qa/run-playwright.cjs tools/qa/premium-clubhouse-performance.js --bootstrap',
      viewport: '1600x900@1',
      fixedTime: '8:00 PM',
      fixedWeather: '70F/52F, dry, 42% humidity, 4 mph wind',
      idleSampleMs: 5000,
      route: 'fixed approach pose; Shift+W 2.4s; ArrowLeft 0.65s; W 2.1s',
    },
    environment,
    samples: [idle, route],
    resources: { before: beforeResources, after: afterResources },
    diagnostics,
    screenshots: [`${out}/fixed-exterior.png`, `${out}/normal-controls-route-end.png`],
  };
}
