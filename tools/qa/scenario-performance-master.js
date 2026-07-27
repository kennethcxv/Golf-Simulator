async (page) => {
  // STEAM PERFORMANCE MASTER PASS: remaining normal-player scenarios.
  //
  // Run (headed GPU strongly recommended):
  //   $env:HEADED='1'
  //   $env:QA_RESULT_PATH='qa/steam-performance-master-pass/scenario-performance.json'
  //   node tools/qa/run-playwright.cjs tools/qa/scenario-performance-master.js --bootstrap
  //
  // Deterministic fixture setup is limited to prerequisites and camera placement:
  // repaired tractor, fixed weather/time, stocked test SKU, a due delivery, and known
  // player poses. Every feature transition itself uses the same keyboard, mouse, laptop,
  // pause-menu, save/load, and menu controls available to a player.

  const startedAt = Date.now();
  const numberEnv = (name, fallback, min = 0) => {
    const parsed = Number(process.env[name]);
    return Number.isFinite(parsed) ? Math.max(min, Math.floor(parsed)) : fallback;
  };
  const laptopCycles = numberEnv('SCENARIO_LAPTOP_CYCLES', 4, 1);
  const editorCycles = numberEnv('SCENARIO_EDITOR_CYCLES', 2, 1);
  const menuCycles = numberEnv('SCENARIO_MENU_CYCLES', 2, 1);
  const customerCycles = numberEnv('SCENARIO_CUSTOMER_CYCLES', 2, 1);
  const startAtDelivery = process.env.SCENARIO_START === 'delivery';
  const captureScreens = process.env.SCENARIO_CAPTURE === '1';
  const profileNames = new Set(String(process.env.SCENARIO_PROFILE || '')
    .split(',').map((name) => name.trim()).filter(Boolean));
  const shouldProfile = (name) => profileNames.has('all') || profileNames.has(name);
  const result = {
    ok: false,
    protocol: {
      launch: 'HEADED=1 node tools/qa/run-playwright.cjs tools/qa/scenario-performance-master.js --bootstrap',
      viewport: { width: 1600, height: 900 },
      deviceScaleFactor: 1,
      fixtureSeed: 424242,
      fixedWeather: { highF: 74, lowF: 55, rainIn: 0, humidity: 0.4, windMph: 6 },
      fixedTime: '10:00 AM except the due-delivery and shop-closing customer fixtures',
      loops: { laptopCycles, editorCycles, menuCycles, customerCycles },
      startAt: startAtDelivery ? 'delivery' : 'laptop',
      controls: {
        laptop: 'E / Escape and visible laptop navigation buttons',
        editor: 'J, visible Playtest/Exit buttons, right-mouse orbit, left-mouse shot, Escape',
        walking: 'W + Shift + ArrowLeft/ArrowRight',
        driving: 'E to mount/dismount, W + A/D to steer',
        delivery: 'time speed key 3, E hold/tap for cutter, flaps, take, and stocking',
        saveLoad: 'Escape pause menu, Save game/Load game, Slot 1 controls',
        menu: 'Escape, Office, Exit to main menu, Continue',
        customers: 'documented debug spawn fixture, normal locomotion, speed 3 through closing time',
      },
      metrics: {
        frame: 'requestAnimationFrame deltas; 1% low is reciprocal of mean worst 1% frame time',
        renderer: 'THREE.WebGLRenderer.info sampled once per animation frame',
        materials: 'unique scene-reachable material UUID count',
        textureMemory: 'scene-reachable image width x height x 4 bytes x 4/3 mip estimate; renderer texture count is also retained',
        heap: 'performance.memory plus CDP Runtime/Performance heap readings after two forced collections',
        listeners: 'window/document addEventListener minus removeEventListener calls by type plus CDP DOM counters',
        uiUpdates: 'MutationObserver record count and records/second for #ui, categorized by feature root',
      },
    },
    environment: {},
    fixture: {},
    scenarios: [],
    lifecycle: [],
    checks: [],
    diagnostics: {
      consoleErrors: [],
      consoleWarnings: [],
      pageErrors: [],
      requestFailures: [],
      functionalFailures: [],
    },
  };

  let phase = 'init';
  const phaseLog = [];
  const setPhase = (next) => {
    phase = next;
    phaseLog.push({ phase, atMs: Date.now() - startedAt });
  };
  page.on('console', (message) => {
    const entry = { phase, text: message.text(), atMs: Date.now() - startedAt };
    if (message.type() === 'error') result.diagnostics.consoleErrors.push(entry);
    else if (message.type() === 'warning') result.diagnostics.consoleWarnings.push(entry);
  });
  page.on('pageerror', (error) => result.diagnostics.pageErrors.push({
    phase, text: error.message, atMs: Date.now() - startedAt,
  }));
  page.on('requestfailed', (request) => result.diagnostics.requestFailures.push({
    phase,
    url: request.url(),
    resourceType: request.resourceType(),
    errorText: request.failure()?.errorText || 'unknown',
    atMs: Date.now() - startedAt,
  }));

  // Install before navigation so the initial application listeners are represented too.
  await page.addInitScript(() => {
    const rawAdd = EventTarget.prototype.addEventListener;
    const rawRemove = EventTarget.prototype.removeEventListener;
    const counts = {};
    const label = (target, type) => `${target === window ? 'window' : 'document'}:${type}`;
    EventTarget.prototype.addEventListener = function scenarioTrackedAdd(type, listener, options) {
      if (this === window || this === document) {
        const key = label(this, type);
        counts[key] = (counts[key] || 0) + 1;
      }
      return rawAdd.call(this, type, listener, options);
    };
    EventTarget.prototype.removeEventListener = function scenarioTrackedRemove(type, listener, options) {
      if (this === window || this === document) {
        const key = label(this, type);
        counts[key] = (counts[key] || 0) - 1;
      }
      return rawRemove.call(this, type, listener, options);
    };
    window.__scenarioInitProbe = { counts };
  });

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('HeapProfiler.enable');
  await cdp.send('Performance.enable');
  if (profileNames.size) await cdp.send('Profiler.enable');

  const waitForVeil = async (timeout = 90000) => {
    await page.waitForFunction(() => {
      const veil = document.querySelector('.load-veil');
      if (!veil) return true;
      const style = getComputedStyle(veil);
      return style.display === 'none' || Number.parseFloat(style.opacity || '1') <= 0.01;
    }, null, { timeout });
    await page.waitForFunction(() => window.__fw?.prewarming !== true, null, { timeout });
  };
  const waitForGame = async (oldSceneId = null, timeout = 90000) => {
    await page.waitForFunction((oldId) => {
      const app = window.__fw;
      return app?.screen === 'game'
        && !!app.scene3d?.scene?.uuid
        && (!oldId || app.scene3d.scene.uuid !== oldId);
    }, oldSceneId, { timeout });
    await waitForVeil(timeout);
    await page.waitForTimeout(500);
  };
  const screen = async (name) => {
    if (!captureScreens) return null;
    const path = `qa/steam-performance-master-pass/scenario-${name}.png`;
    await page.screenshot({ path });
    return path;
  };

  const digestProfile = (profile) => {
    const nodes = new Map((profile?.nodes || []).map((node) => [node.id, node]));
    const totals = new Map();
    const samples = profile?.samples || [];
    const deltas = profile?.timeDeltas || [];
    for (let index = 0; index < samples.length; index += 1) {
      totals.set(samples[index], (totals.get(samples[index]) || 0) + (deltas[index] || 0));
    }
    return [...totals.entries()].map(([id, microseconds]) => {
      const frame = nodes.get(id)?.callFrame || {};
      return {
        selfMs: +(microseconds / 1000).toFixed(2),
        function: frame.functionName || '(anonymous)',
        source: String(frame.url || '').split('/').slice(-2).join('/'),
        line: Number.isFinite(frame.lineNumber) ? frame.lineNumber + 1 : null,
      };
    }).sort((a, b) => b.selfMs - a.selfMs).slice(0, 15);
  };

  const lifecycleSnapshot = async (name) => {
    await page.mouse.move(4, 4);
    await cdp.send('HeapProfiler.collectGarbage');
    await page.waitForTimeout(75);
    await cdp.send('HeapProfiler.collectGarbage');
    const [dom, perf, runtimeHeap] = await Promise.all([
      cdp.send('Memory.getDOMCounters'),
      cdp.send('Performance.getMetrics'),
      cdp.send('Runtime.getHeapUsage'),
    ]);
    const perfMap = Object.fromEntries(perf.metrics.map((metric) => [metric.name, metric.value]));
    const game = await page.evaluate(() => {
      const resources = window.__scenarioRuntime?.resources?.() || null;
      const counts = { ...(window.__scenarioInitProbe?.counts || {}) };
      return {
        sceneId: window.__fw?.scene3d?.scene?.uuid || null,
        screen: window.__fw?.screen || null,
        courseMode: window.__fw?.courseMode || null,
        resources,
        listeners: {
          net: Object.values(counts).reduce((sum, value) => sum + value, 0),
          byType: counts,
        },
        heapBytes: performance.memory?.usedJSHeapSize ?? null,
      };
    });
    const snapshot = {
      name,
      atMs: Date.now() - startedAt,
      ...game,
      dom,
      cdpHeapUsedBytes: perfMap.JSHeapUsedSize ?? null,
      cdpHeapTotalBytes: perfMap.JSHeapTotalSize ?? null,
      runtimeHeap,
    };
    result.lifecycle.push(snapshot);
    return snapshot;
  };

  const measure = async (name, { minimumMs = 5000, action = null } = {}) => {
    setPhase(name);
    await page.evaluate((label) => window.__scenarioRuntime.start(label), name);
    const profiled = shouldProfile(name);
    if (profiled) await cdp.send('Profiler.start');
    const sampleStarted = Date.now();
    let actionError = null;
    let profile = null;
    try {
      if (action) await action();
      const remaining = minimumMs - (Date.now() - sampleStarted);
      if (remaining > 0) await page.waitForTimeout(remaining);
    } catch (error) {
      actionError = error;
    } finally {
      if (profiled) {
        const stopped = await cdp.send('Profiler.stop').catch(() => null);
        profile = stopped?.profile || null;
      }
    }
    const stats = await page.evaluate(() => window.__scenarioRuntime.stop());
    const record = {
      name,
      elapsedMs: Date.now() - sampleStarted,
      ...stats,
      topCpuSelf: profile ? digestProfile(profile) : null,
    };
    result.scenarios.push(record);
    if (actionError) throw actionError;
    return record;
  };

  const openPause = async () => {
    const pause = page.locator('.pause-veil-ui');
    if (await pause.isVisible().catch(() => false)) return;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await page.keyboard.press('Escape');
      if (await pause.waitFor({ state: 'visible', timeout: 1800 }).then(() => true).catch(() => false)) return;
    }
    throw new Error('Pause menu did not open through Escape.');
  };
  const pauseNav = async (label) => {
    await page.getByRole('button', { name: label, exact: true }).click();
    await page.waitForTimeout(100);
  };
  const aimAtPoint = async (point, { distance = 1.42, approach = [0, 1] } = {}) => {
    const magnitude = Math.hypot(approach[0], approach[1]) || 1;
    const position = {
      x: point.x + (approach[0] / magnitude) * distance,
      z: point.z + (approach[1] / magnitude) * distance,
    };
    await page.evaluate(({ target, cameraXZ }) => {
      const app = window.__fw;
      const walk = app.scene3d.walk;
      walk.clearKeys?.();
      walk.state.x = cameraXZ.x;
      walk.state.z = cameraXZ.z;
      const dx = target.x - cameraXZ.x;
      const dz = target.z - cameraXZ.z;
      walk.state.yaw = Math.atan2(-dx, -dz);
      walk.state.pitch = -0.35;
    }, { target: point, cameraXZ: position });
    await page.waitForTimeout(180);
    await page.evaluate((target) => {
      const app = window.__fw;
      const walk = app.scene3d.walk;
      const camera = app.scene3d.camera;
      const dx = target.x - walk.state.x;
      const dz = target.z - walk.state.z;
      walk.state.yaw = Math.atan2(-dx, -dz);
      walk.state.pitch = Math.max(-1.30, Math.min(1.30,
        Math.atan2(target.y - camera.position.y, Math.hypot(dx, dz))));
    }, point);
    await page.waitForTimeout(360);
  };
  const setOrganicWalkins = () => page.evaluate(() => {
    const clubhouse = window.__fw?.scene3d?.clubhouse?.();
    clubhouse?.setOrganicWalkins?.(false);
  });
  const stateFingerprint = () => page.evaluate(async () => {
    const deliveries = await import('/src/sim/deliveries.js');
    const st = window.__fw.state;
    const balls = st.shop.inventory.balls1;
    return {
      cash: st.cash,
      ballsShelf: balls.shelf,
      ballsBack: balls.back,
      ballsInBoxes: deliveries.boxesOf(st).filter((box) => box.skuId === 'balls1')
        .reduce((sum, box) => sum + box.qty, 0),
      boxCount: deliveries.boxesOf(st).length,
      tractorRepaired: st.tractor?.repaired === true,
    };
  });

  let laptopAudit = null;
  let editorAudit = null;
  let walkAudit = null;
  let driveAudit = null;
  let deliveryAudit = null;
  let saveAudit = null;
  let menuAudit = null;
  let customerAudit = null;

  try {
    setPhase('menu-fixture');
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto('http://localhost:8457/', { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.getByText('Continue', { exact: true }).waitFor({ timeout: 20000 });
    result.fixture = await page.evaluate(async (weather) => {
      const empireModule = await import('/src/sim/empire.js');
      const raw = localStorage.getItem('golfempire:autosave');
      if (!raw) throw new Error('The scenario fixture requires the bootstrapped autosave.');
      const empire = empireModule.deserializeEmpire(JSON.parse(raw));
      const st = empireModule.activeState(empire);
      if (!st) throw new Error('The scenario fixture requires an owned active property.');
      st.tutorial.complete = true;
      st.tutorial.hidden = true;
      st.cash = 10_000_000;
      empire.cash = st.cash;
      st.shop.unlockedTier = 3;
      st.shop.inventory.balls1.shelf = Math.max(18, st.shop.inventory.balls1.shelf || 0);
      st.shop.salesYesterday.units = Math.max(8, st.shop.salesYesterday.units || 0);
      st.tractor.repaired = true;
      for (const key of Object.keys(st.tractor.steps)) st.tractor.steps[key] = true;
      st.weather.locked = true;
      st.weather.today = {
        tempHiF: weather.highF,
        tempLoF: weather.lowF,
        rainIn: weather.rainIn,
        humidity: weather.humidity,
        windMph: weather.windMph,
      };
      st.clock.minutes = Math.floor(st.clock.minutes / 1440) * 1440 + 10 * 60;
      empire.clockMinutes = st.clock.minutes;
      localStorage.setItem(
        'golfempire:autosave',
        JSON.stringify(empireModule.empireSnapshot(empire)),
      );
      return {
        clubName: st.clubName,
        seed: st.seed,
        tractorRepaired: st.tractor.repaired,
        ballsShelf: st.shop.inventory.balls1.shelf,
        cash: st.cash,
        clockMinutes: st.clock.minutes,
      };
    }, result.protocol.fixedWeather);

    setPhase('initial-load');
    await page.getByText('Continue', { exact: true }).click();
    await waitForGame();
    await page.waitForTimeout(2000);
    await setOrganicWalkins();
    await page.evaluate(() => { window.__fw.speedIdx = 0; });

    await page.evaluate(() => {
      const percentile = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] || 0;
      const imageDimensions = (image) => {
        if (!image) return [];
        if (Array.isArray(image)) return image.flatMap(imageDimensions);
        const width = Number(image.width || image.videoWidth || image.naturalWidth || image.data?.width || 0);
        const height = Number(image.height || image.videoHeight || image.naturalHeight || image.data?.height || 0);
        return width > 0 && height > 0 ? [{ width, height }] : [];
      };
      const textureEstimate = (texture) => {
        const dimensions = imageDimensions(texture?.image || texture?.source?.data);
        return dimensions.reduce((sum, dim) => sum + Math.round(dim.width * dim.height * 4 * (4 / 3)), 0);
      };
      const resources = () => {
        const app = window.__fw;
        const scene = app?.scene3d?.scene;
        const renderer = app?.scene3d?.renderer;
        const geometries = new Set();
        const materials = new Set();
        const textures = new Set();
        let nodes = 0;
        let meshes = 0;
        if (scene) scene.traverse((object) => {
          nodes += 1;
          if (object.isMesh || object.isPoints || object.isLine) meshes += 1;
          if (object.geometry?.uuid) geometries.add(object.geometry.uuid);
          const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
          for (const material of objectMaterials) {
            if (!material?.uuid) continue;
            materials.add(material.uuid);
            for (const value of Object.values(material)) {
              if (value?.isTexture && value.uuid) textures.add(value);
            }
            for (const uniform of Object.values(material.uniforms || {})) {
              const value = uniform?.value;
              if (value?.isTexture && value.uuid) textures.add(value);
              if (Array.isArray(value)) {
                for (const entry of value) if (entry?.isTexture && entry.uuid) textures.add(entry);
              }
            }
          }
        });
        let textureBytes = 0;
        let dimensionedTextures = 0;
        for (const texture of textures) {
          const bytes = textureEstimate(texture);
          if (bytes > 0) dimensionedTextures += 1;
          textureBytes += bytes;
        }
        let liveDomNodes = 1;
        const walker = document.createTreeWalker(document, NodeFilter.SHOW_ALL);
        while (walker.nextNode()) liveDomNodes += 1;
        return {
          nodes,
          meshes,
          sceneGeometries: geometries.size,
          sceneMaterials: materials.size,
          sceneTextures: textures.size,
          dimensionedTextures,
          sceneTextureEstimatedBytes: textureBytes,
          rendererMemory: renderer ? { ...renderer.info.memory } : null,
          rendererPrograms: renderer?.info?.programs?.length ?? null,
          liveDomNodes,
        };
      };
      let active = null;
      const categorize = (target) => {
        const element = target?.nodeType === 1 ? target : target?.parentElement;
        if (!element?.closest) return 'other';
        if (element.closest('.laptop-screen')) return 'laptop';
        if (element.closest('.ced-root')) return 'editor';
        if (element.closest('.pause-veil-ui')) return 'pause';
        if (element.closest('.shop-prompt')) return 'prompt';
        if (element.closest('.hud-min')) return 'hud';
        return 'other';
      };
      window.__scenarioRuntime = {
        resources,
        start(label) {
          if (active) throw new Error(`Scenario sample ${active.label} is already active.`);
          const mutationByFeature = {};
          const ui = document.getElementById('ui');
          const observer = new MutationObserver((records) => {
            for (const record of records) {
              const key = categorize(record.target);
              mutationByFeature[key] = (mutationByFeature[key] || 0) + 1;
            }
          });
          if (ui) observer.observe(ui, {
            subtree: true,
            childList: true,
            attributes: true,
            characterData: true,
          });
          active = {
            label,
            started: performance.now(),
            last: null,
            deltas: [],
            drawCalls: [],
            triangles: [],
            mutationByFeature,
            observer,
            sceneId: null,
            lastWalk: null,
            walkDistance: 0,
            cartMountedFrames: 0,
            renderer: window.__fw?.scene3d?.renderer || null,
            running: true,
          };
          if (active.renderer?.info) {
            active.renderer.info.autoReset = false;
            active.renderer.info.reset();
          }
          const tick = (time) => {
            const sample = active;
            if (!sample || !sample.running || sample.label !== label) return;
            if (sample.last != null) sample.deltas.push(time - sample.last);
            sample.last = time;
            const renderer = window.__fw?.scene3d?.renderer || null;
            if (renderer !== sample.renderer) {
              if (sample.renderer?.info) sample.renderer.info.autoReset = true;
              sample.renderer = renderer;
              if (renderer?.info) {
                renderer.info.autoReset = false;
                renderer.info.reset();
              }
            } else if (renderer?.info?.render) {
              const render = renderer.info.render;
              sample.drawCalls.push(render.calls || 0);
              sample.triangles.push(render.triangles || 0);
              renderer.info.reset();
            }
            const sceneId = window.__fw?.scene3d?.scene?.uuid || null;
            const walk = window.__fw?.scene3d?.walk?.state;
            if (sample.sceneId !== sceneId) {
              sample.sceneId = sceneId;
              sample.lastWalk = null;
            }
            if (walk) {
              if (sample.lastWalk) {
                sample.walkDistance += Math.hypot(
                  walk.x - sample.lastWalk.x,
                  walk.z - sample.lastWalk.z,
                );
              }
              sample.lastWalk = { x: walk.x, z: walk.z };
              if (window.__fw.scene3d.walk.cart?.mounted) sample.cartMountedFrames += 1;
            }
            requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        },
        stop() {
          if (!active) throw new Error('No scenario sample is active.');
          const sample = active;
          sample.running = false;
          sample.observer.disconnect();
          if (sample.renderer?.info) {
            sample.renderer.info.reset();
            sample.renderer.info.autoReset = true;
          }
          active = null;
          const deltas = sample.deltas.slice(3).filter((delta) => delta > 0).sort((a, b) => a - b);
          const elapsedMs = performance.now() - sample.started;
          const mean = (values) => values.length
            ? values.reduce((sum, value) => sum + value, 0) / values.length
            : 0;
          const worstCount = Math.max(1, Math.ceil(deltas.length * 0.01));
          const worstOnePercent = deltas.slice(-worstCount);
          const mutationRecords = Object.values(sample.mutationByFeature)
            .reduce((sum, value) => sum + value, 0);
          return {
            frame: {
              frames: deltas.length,
              avgFps: mean(deltas) ? +(1000 / mean(deltas)).toFixed(2) : null,
              low1Fps: mean(worstOnePercent) ? +(1000 / mean(worstOnePercent)).toFixed(2) : null,
              avgMs: +mean(deltas).toFixed(3),
              p50Ms: +percentile(deltas, 0.50).toFixed(3),
              p95Ms: +percentile(deltas, 0.95).toFixed(3),
              p99Ms: +percentile(deltas, 0.99).toFixed(3),
              worstMs: +(deltas[deltas.length - 1] || 0).toFixed(3),
              over33ms: deltas.filter((delta) => delta > 33.333).length,
              over50ms: deltas.filter((delta) => delta > 50).length,
              over100ms: deltas.filter((delta) => delta > 100).length,
            },
            renderer: {
              drawCallsAverage: +mean(sample.drawCalls).toFixed(2),
              drawCallsMax: Math.max(0, ...sample.drawCalls),
              trianglesAverage: +mean(sample.triangles).toFixed(2),
              trianglesMax: Math.max(0, ...sample.triangles),
            },
            ui: {
              mutationRecords,
              mutationRecordsPerSecond: elapsedMs > 0 ? +(mutationRecords / (elapsedMs / 1000)).toFixed(2) : 0,
              byFeature: sample.mutationByFeature,
            },
            gameplay: {
              walkDistance: +sample.walkDistance.toFixed(3),
              cartMountedFrameRatio: deltas.length
                ? +(sample.cartMountedFrames / deltas.length).toFixed(3)
                : 0,
            },
            resources: resources(),
            heapBytes: performance.memory?.usedJSHeapSize ?? null,
            listeners: {
              net: Object.values(window.__scenarioInitProbe?.counts || {})
                .reduce((sum, value) => sum + value, 0),
              byType: { ...(window.__scenarioInitProbe?.counts || {}) },
            },
          };
        },
      };
    });

    result.environment = await page.evaluate(() => {
      const renderer = window.__fw.scene3d.renderer;
      const gl = renderer.getContext();
      const debug = gl.getExtension('WEBGL_debug_renderer_info');
      return {
        userAgent: navigator.userAgent,
        viewport: { width: innerWidth, height: innerHeight },
        devicePixelRatio: devicePixelRatio,
        rendererPixelRatio: renderer.getPixelRatio(),
        gpu: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : 'masked',
      };
    });
    await lifecycleSnapshot('baseline-warm-game');

    if (!startAtDelivery) {
    // Laptop open/close: normal E and Escape, with one active UI navigation sample.
    setPhase('laptop-position-fixture');
    await page.evaluate(() => {
      const app = window.__fw;
      const origin = app.scene3d.clubhouse().interior.position;
      const walk = app.scene3d.walk.state;
      walk.x = origin.x + 8.45;
      walk.z = origin.z + 4.5;
      walk.yaw = -Math.PI / 2;
      walk.pitch = -0.05;
    });
    await page.waitForFunction(() => /laptop/i.test(document.querySelector('.shop-prompt')?.textContent || ''), null, { timeout: 10000 });
    await measure('laptop-open-transition', {
      minimumMs: 2600,
      action: async () => {
        await page.keyboard.press('e');
        await page.waitForFunction(() => window.__fw.laptopOpen === true, null, { timeout: 8000 });
        await page.locator('.lt-frame').waitFor({ state: 'visible', timeout: 15000 });
      },
    });
    await measure('laptop-active-ui', {
      minimumMs: 5000,
      action: async () => {
        await page.waitForTimeout(800);
        const inventory = page.locator('.lt-navbtn').filter({ hasText: 'Inventory' }).first();
        if (await inventory.count()) await inventory.click();
        await page.waitForTimeout(1200);
        const dashboard = page.locator('.lt-navbtn').filter({ hasText: 'Dashboard' }).first();
        if (await dashboard.count()) await dashboard.click();
      },
    });
    await screen('laptop-active');
    await measure('laptop-close-transition', {
      minimumMs: 1500,
      action: async () => {
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => window.__fw.laptopOpen === false, null, { timeout: 8000 });
      },
    });
    for (let cycle = 2; cycle <= laptopCycles; cycle += 1) {
      await page.waitForFunction(() => /laptop/i.test(document.querySelector('.shop-prompt')?.textContent || ''), null, { timeout: 10000 });
      await page.keyboard.press('e');
      await page.waitForFunction(() => window.__fw.laptopOpen && document.querySelector('.lt-frame'), null, { timeout: 15000 });
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => window.__fw.laptopOpen === false, null, { timeout: 8000 });
    }
    laptopAudit = await page.evaluate((cycles) => ({
      cycles,
      roots: document.querySelectorAll('.laptop-screen').length,
      visibleRoots: [...document.querySelectorAll('.laptop-screen')]
        .filter((root) => getComputedStyle(root).display !== 'none').length,
      laptopOpen: window.__fw.laptopOpen,
      focused: window.__fw.scene3d.walk.isFocused(),
      lens: { fov: window.__fw.scene3d.camera.fov, near: window.__fw.scene3d.camera.near },
    }), laptopCycles);
    await lifecycleSnapshot('after-laptop-cycles');

    // Course editor: J, fixed overview, real right-drag orbit, normal Playtest shot, Exit.
    await measure('editor-enter-transition', {
      minimumMs: 1800,
      action: async () => {
        await page.keyboard.press('j');
        await page.waitForFunction(() => window.__fw.editorUi().isActive(), null, { timeout: 12000 });
      },
    });
    await measure('editor-overview-static', { minimumMs: 5000 });
    const canvasBounds = await page.locator('#game').boundingBox();
    if (!canvasBounds) throw new Error('Game canvas has no bounds for editor orbit.');
    await measure('editor-right-drag-orbit', {
      minimumMs: 6000,
      action: async () => {
        const cx = canvasBounds.x + canvasBounds.width * 0.64;
        const cy = canvasBounds.y + canvasBounds.height * 0.56;
        await page.mouse.move(cx, cy);
        await page.mouse.down({ button: 'right' });
        for (let step = 0; step < 36; step += 1) {
          const x = cx + Math.sin((step / 36) * Math.PI * 4) * 190;
          const y = cy + Math.cos((step / 36) * Math.PI * 2) * 70;
          await page.mouse.move(x, y, { steps: 2 });
          await page.waitForTimeout(75);
        }
        await page.mouse.up({ button: 'right' });
      },
    });
    await measure('editor-playtest-shot', {
      minimumMs: 6500,
      action: async () => {
        await page.getByRole('button', { name: 'Playtest', exact: true }).click();
        await page.waitForFunction(() => window.__fw.editorUi().isPlaytesting(), null, { timeout: 10000 });
        await page.mouse.move(canvasBounds.x + canvasBounds.width * 0.5, canvasBounds.y + canvasBounds.height * 0.52);
        await page.mouse.down({ button: 'left' });
        await page.waitForTimeout(780);
        await page.mouse.up({ button: 'left' });
        await page.waitForTimeout(2600);
      },
    });
    await screen('editor-playtest');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !window.__fw.editorUi().isPlaytesting(), null, { timeout: 10000 });
    await page.getByRole('button', { name: 'Exit', exact: true }).click();
    await page.waitForFunction(() => !window.__fw.editorUi().isActive() && window.__fw.courseMode === 'walk', null, { timeout: 30000 });
    for (let cycle = 2; cycle <= editorCycles; cycle += 1) {
      await page.keyboard.press('j');
      await page.waitForFunction(() => window.__fw.editorUi().isActive(), null, { timeout: 12000 });
      await page.getByRole('button', { name: 'Exit', exact: true }).click();
      await page.waitForFunction(() => !window.__fw.editorUi().isActive(), null, { timeout: 30000 });
    }
    editorAudit = await page.evaluate((cycles) => ({
      cycles,
      active: window.__fw.editorUi().isActive(),
      playtesting: window.__fw.editorUi().isPlaytesting(),
      courseMode: window.__fw.courseMode,
      editorRoots: document.querySelectorAll('.ced-root').length,
    }), editorCycles);
    await lifecycleSnapshot('after-editor-cycles');

    // Find a broad collision-free fixture area, then drive the normal movement keys.
    const openArea = await page.evaluate(() => {
      const walkApi = window.__fw.scene3d.walk;
      const base = walkApi.state;
      const clear = (x, z, radius) => walkApi.isFree(x, z, radius);
      for (let ring = 0; ring <= 30; ring += 1) {
        const radius = ring * 5;
        for (let spoke = 0; spoke < 24; spoke += 1) {
          const angle = (spoke / 24) * Math.PI * 2;
          const x = base.x + Math.cos(angle) * radius;
          const z = base.z + Math.sin(angle) * radius;
          if (!clear(x, z, 1.3)) continue;
          let broad = true;
          for (let i = 0; i < 12; i += 1) {
            const a = (i / 12) * Math.PI * 2;
            if (!clear(x + Math.cos(a) * 8, z + Math.sin(a) * 8, 1.3)) { broad = false; break; }
          }
          if (broad) {
            base.x = x;
            base.z = z;
            base.yaw = 0;
            base.pitch = -0.04;
            return { x, z };
          }
        }
      }
      throw new Error('Could not find a broad collision-free movement fixture.');
    });
    const walkStart = await page.evaluate(() => ({
      x: window.__fw.scene3d.walk.state.x,
      z: window.__fw.scene3d.walk.state.z,
    }));
    const walkMeasurement = await measure('walk-sprint-fast-turn', {
      minimumMs: 8500,
      action: async () => {
        await page.keyboard.down('w');
        await page.keyboard.down('Shift');
        await page.keyboard.down('ArrowLeft');
        await page.waitForTimeout(4000);
        await page.keyboard.up('ArrowLeft');
        await page.keyboard.down('ArrowRight');
        await page.waitForTimeout(4000);
        await page.keyboard.up('ArrowRight');
        await page.keyboard.up('Shift');
        await page.keyboard.up('w');
      },
    });
    const walkEnd = await page.evaluate(() => ({
      x: window.__fw.scene3d.walk.state.x,
      z: window.__fw.scene3d.walk.state.z,
    }));
    walkAudit = {
      fixture: openArea,
      start: walkStart,
      end: walkEnd,
      displacement: +Math.hypot(walkEnd.x - walkStart.x, walkEnd.z - walkStart.z).toFixed(3),
      pathDistance: walkMeasurement.gameplay.walkDistance,
    };

    const cartFixture = await page.evaluate(({ x, z }) => {
      const walkApi = window.__fw.scene3d.walk;
      const walk = walkApi.state;
      walk.x = x;
      walk.z = z + 2.6;
      walk.yaw = 0;
      walk.pitch = -0.05;
      walkApi.placeCart(x, z, 0);
      return { player: { x: walk.x, z: walk.z }, cart: { x, z } };
    }, openArea);
    await page.waitForFunction(() => /take the wheel/i.test(window.__fw.scene3d.walk.getFocusLabel() || ''), null, { timeout: 10000 });
    await page.keyboard.press('e');
    await page.waitForFunction(() => window.__fw.scene3d.walk.cart.mounted, null, { timeout: 5000 });
    const driveStart = await page.evaluate(() => ({
      x: window.__fw.scene3d.walk.state.x,
      z: window.__fw.scene3d.walk.state.z,
    }));
    const driveMeasurement = await measure('tractor-driving-turns', {
      minimumMs: 9000,
      action: async () => {
        await page.keyboard.down('w');
        await page.keyboard.down('a');
        await page.waitForTimeout(4200);
        await page.keyboard.up('a');
        await page.keyboard.down('d');
        await page.waitForTimeout(4200);
        await page.keyboard.up('d');
        await page.keyboard.up('w');
      },
    });
    const driveEnd = await page.evaluate(() => ({
      x: window.__fw.scene3d.walk.state.x,
      z: window.__fw.scene3d.walk.state.z,
    }));
    await page.keyboard.press('e');
    await page.waitForFunction(() => !window.__fw.scene3d.walk.cart.mounted, null, { timeout: 5000 });
    driveAudit = {
      fixture: cartFixture,
      start: driveStart,
      end: driveEnd,
      displacement: +Math.hypot(driveEnd.x - driveStart.x, driveEnd.z - driveStart.z).toFixed(3),
      pathDistance: driveMeasurement.gameplay.walkDistance,
    };
    await screen('driving');
    }

    // Due delivery: create one legitimate paid order, stage its clock one minute before
    // arrival, then let normal speed controls and the live game loop receive it.
    const dueOrder = await page.evaluate(async () => {
      const shop = await import('/src/sim/shop.js');
      const deliveries = await import('/src/sim/deliveries.js');
      const app = window.__fw;
      const st = app.state;
      app.speedIdx = 0;
      let carryValue = st.shop.carry || null;
      window.__scenarioCarryTransitions = [];
      Object.defineProperty(st.shop, 'carry', {
        configurable: true,
        enumerable: true,
        get: () => carryValue,
        set: (next) => {
          window.__scenarioCarryTransitions.push({
            at: performance.now(),
            from: carryValue ? { ...carryValue } : null,
            to: next ? { ...next } : null,
            stack: new Error('carry transition').stack,
          });
          carryValue = next;
        },
      });
      st.shop.carry = null;
      st.shop.inventory.balls1.shelf = 0;
      st.shop.inventory.balls1.back = 0;
      st.shop.deliveries.boxes = [];
      st.shop.orders = [];
      app.scene3d.clubhouse().rebuildBoxes();
      const placed = shop.placeOrder(st, 'balls1', 12);
      if (!placed.ok) throw new Error(`Could not create due delivery: ${placed.reason}`);
      const order = st.shop.orders[st.shop.orders.length - 1];
      st.clock.minutes = order.deliveryMin - 1;
      app.empire.clockMinutes = st.clock.minutes;
      return {
        orderId: order.id,
        deliveryMin: order.deliveryMin,
        boxesBefore: deliveries.boxesOf(st).length,
        expectedBoxes: placed.boxes,
      };
    });
    await measure('delivery-receiving-arrival', {
      minimumMs: 9000,
      action: async () => {
        await page.keyboard.press('3');
        await page.waitForFunction(
          () => window.__fw.state.shop.deliveries.boxes.some((box) => box.skuId === 'balls1'),
          null,
          { timeout: 15000 },
        );
        await page.waitForTimeout(3500);
        await page.keyboard.press(' ');
      },
    });
    const receiving = await page.evaluate(async () => {
      const deliveries = await import('/src/sim/deliveries.js');
      const st = window.__fw.state;
      const box = deliveries.boxesOf(st).find((entry) => entry.skuId === 'balls1');
      if (!box) throw new Error('The due balls delivery did not create a physical box.');
      if (deliveries.carriedBox(st)) deliveries.putDownBox(st, box.id, { x: 7.4, z: -5.2, ry: 0 });
      else {
        const picked = deliveries.pickUpBox(st, box.id);
        if (!picked.ok) throw new Error(`Could not pick up delivery fixture box: ${picked.reason}`);
        const placed = deliveries.putDownBox(st, box.id, { x: 7.4, z: -5.2, ry: 0 });
        if (!placed.ok) throw new Error(`Could not place delivery fixture box: ${placed.reason}`);
      }
      window.__fw.scene3d.clubhouse().rebuildBoxes();
      return { id: box.id, qty: box.qty, loc: box.loc };
    });
    await page.waitForFunction((id) => !!(
      window.__fw?.scene3d?.scene?.getObjectByName(`DeliveryBox_${id}`)
      || window.__fw?.scene3d?.scene?.getObjectByName(`DeliveryBoxFallback_${id}`)
    ), receiving.id, { timeout: 30000 });
    const receivingPoint = await page.evaluate(async (id) => {
      const boxes = await import('/src/data/boxes.js');
      const app = window.__fw;
      const box = app.state.shop.deliveries.boxes.find((entry) => entry.id === id);
      const root = app.scene3d.scene.getObjectByName(`DeliveryBox_${id}`)
        || app.scene3d.scene.getObjectByName(`DeliveryBoxFallback_${id}`);
      if (!box || !root) throw new Error(`Missing receiving carton ${id}.`);
      root.updateWorldMatrix(true, true);
      const world = root.getWorldPosition(root.position.clone());
      return { x: world.x, y: world.y + boxes.boxDims(box.box).h / 2, z: world.z };
    }, receiving.id);
    await aimAtPoint(receivingPoint);
    await page.waitForFunction(() => /case|carton|box/i.test(window.__fw.scene3d.walk.getFocusLabel() || ''), null, { timeout: 10000 });
    await measure('delivery-box-opening', {
      minimumMs: 7000,
      action: async () => {
        // First tap equips the sealed carton's contextual cutter. The deliberate
        // hold begins only after that key has been released once.
        await page.keyboard.press('e');
        await page.waitForFunction(
          () => window.__fw.scene3d.walk.getTool() === 'boxcutter',
          null,
          { timeout: 3000 },
        );
        await page.keyboard.down('e');
        await page.waitForTimeout(2300);
        await page.keyboard.up('e');
        await page.waitForFunction(() => {
          const box = window.__fw.state.shop.deliveries.boxes
            .find((entry) => entry.skuId === 'balls1');
          return !!box && box.tape >= 1;
        }, null, { timeout: 5000 });
        await page.keyboard.press('e');
        await page.waitForTimeout(1700);
        await page.waitForFunction(() => {
          const box = window.__fw.state.shop.deliveries.boxes
            .find((entry) => entry.skuId === 'balls1');
          return !!box && Array.isArray(box.flaps)
            && box.flaps.length > 0 && box.flaps.every((progress) => progress >= 1);
        }, null, { timeout: 5000 });
        // The authored flaps swing through the old crosshair during the open
        // animation. Reacquire the carton just as a player would after that
        // visible motion, and prove the live prompt owns the next E press.
        await aimAtPoint(receivingPoint);
        await page.waitForFunction(
          () => /take an armful/i.test(window.__fw.scene3d.walk.getFocusLabel() || ''),
          null,
          { timeout: 5000 },
        );
        await page.keyboard.press('e');
        await page.waitForFunction(
          () => window.__fw.state.shop.carry?.skuId === 'balls1',
          null,
          { timeout: 5000 },
        );
      },
    });
    const goodsBeforeShelf = await page.evaluate(async () => {
      const stocking = await import('/src/sim/stocking.js');
      return stocking.carriedGoods(window.__fw.state);
    });
    if (!goodsBeforeShelf) {
      const transitions = await page.evaluate(() => window.__scenarioCarryTransitions || []);
      throw new Error(`Delivery goods vanished before shelf travel: ${JSON.stringify(transitions)}`);
    }
    await screen('delivery-open-box');
    const shelfBefore = await page.evaluate(() => window.__fw.state.shop.inventory.balls1.shelf);
    const ballWallPoint = await page.evaluate(() => {
      const app = window.__fw;
      const origin = app.scene3d.clubhouse().interior.position;
      return { x: origin.x - 6.9, y: origin.y + 1.1, z: origin.z - 6.15 };
    });
    await aimAtPoint(ballWallPoint, { distance: 1.35, approach: [0, 1] });
    await page.waitForFunction(
      () => /ball wall.*hold.*stock/i.test(window.__fw.scene3d.walk.getFocusLabel() || ''),
      null,
      { timeout: 10000 },
    );
    await measure('delivery-shelf-stocking', {
      minimumMs: 3500,
      action: async () => {
        await page.keyboard.down('e');
        await page.waitForTimeout(1200);
        await page.keyboard.up('e');
        await page.waitForFunction((before) => window.__fw.state.shop.inventory.balls1.shelf > before, shelfBefore, { timeout: 5000 });
      },
    });
    const deliveryAfter = await page.evaluate(async () => {
      const deliveries = await import('/src/sim/deliveries.js');
      const stocking = await import('/src/sim/stocking.js');
      const st = window.__fw.state;
      const box = deliveries.boxesOf(st).find((entry) => entry.skuId === 'balls1');
      return {
        ballsShelf: st.shop.inventory.balls1.shelf,
        ballsBack: st.shop.inventory.balls1.back,
        carriedGoods: stocking.carriedGoods(st),
        box: box ? { qty: box.qty, tape: box.tape, flaps: box.flaps, loc: box.loc } : null,
      };
    });
    deliveryAudit = { dueOrder, receiving, goodsBeforeShelf, shelfBefore, after: deliveryAfter };
    await lifecycleSnapshot('after-movement-delivery');

    // Save and reload through the visible pause menu. The load sample spans scene teardown,
    // reconstruction, shader prewarm, and veil release so stalls remain in the frame record.
    const savedFingerprint = await stateFingerprint();
    await openPause();
    await pauseNav('Save game');
    await page.getByRole('button', { name: 'Save here', exact: true }).first().click();
    await page.waitForFunction(() => localStorage.getItem('golfempire:slot1') !== null, null, { timeout: 5000 });
    await pauseNav('Resume');
    await openPause();
    await pauseNav('Load game');
    const oldLoadScene = await page.evaluate(() => window.__fw.scene3d.scene.uuid);
    await measure('save-slot-load-transition', {
      minimumMs: 0,
      action: async () => {
        const load = page.getByRole('button', { name: 'Load', exact: true }).first();
        await load.waitFor({ state: 'visible', timeout: 5000 });
        await page.waitForFunction(() => {
          const button = [...document.querySelectorAll('.slot-act')].find((entry) => entry.textContent.trim() === 'Load');
          return !!button && !button.disabled;
        }, null, { timeout: 5000 });
        await load.click();
        await waitForGame(oldLoadScene, 90000);
        await page.waitForTimeout(1200);
      },
    });
    await setOrganicWalkins();
    await page.evaluate(() => { window.__fw.speedIdx = 0; });
    const loadedFingerprint = await stateFingerprint();
    saveAudit = {
      savedFingerprint,
      loadedFingerprint,
      exact: JSON.stringify(savedFingerprint) === JSON.stringify(loadedFingerprint),
    };
    await lifecycleSnapshot('after-slot-load');

    // Normal pause-menu return to menu and Continue re-entry, repeated on a warm cache.
    const menuRecords = [];
    for (let cycle = 1; cycle <= menuCycles; cycle += 1) {
      await openPause();
      await pauseNav('Office');
      const oldScene = await page.evaluate(() => window.__fw.scene3d.scene.uuid);
      const scenarioName = `menu-return-reentry-${cycle}`;
      const measurement = await measure(scenarioName, {
        minimumMs: 0,
        action: async () => {
          await page.getByRole('button', { name: 'Exit to main menu (autosaves)', exact: true }).click();
          await page.getByText('Continue', { exact: true }).waitFor({ timeout: 20000 });
          const menuState = await page.evaluate(() => ({
            screen: window.__fw.screen,
            sceneNull: window.__fw.scene3d === null,
            stateNull: window.__fw.state === null,
          }));
          await page.getByText('Continue', { exact: true }).click();
          await waitForGame(oldScene, 90000);
          await page.waitForTimeout(1000);
          menuRecords.push({ cycle, menuState, newScene: await page.evaluate(() => window.__fw.scene3d.scene.uuid) });
        },
      });
      menuRecords[menuRecords.length - 1].loadElapsedMs = measurement.elapsedMs;
      await setOrganicWalkins();
      await page.evaluate(() => { window.__fw.speedIdx = 0; });
    }
    menuAudit = { cycles: menuCycles, records: menuRecords };
    await lifecycleSnapshot('after-menu-reentries');

    // Customer creation and disposal use the documented deterministic spawn hook only for
    // timing. They still walk through the real door, animate, route, react to normal closing
    // time, return any held stock, and leave through removeCustomer.
    const customerRecords = [];
    for (let cycle = 1; cycle <= customerCycles; cycle += 1) {
      await page.evaluate(() => {
        const app = window.__fw;
        const clubhouse = app.scene3d.clubhouse();
        clubhouse.clearWalkins();
        clubhouse.setOrganicWalkins(false);
        const day = Math.floor(app.state.clock.minutes / 1440);
        app.state.clock.minutes = day * 1440 + 10 * 60;
        app.empire.clockMinutes = app.state.clock.minutes;
        app.speedIdx = 0;
        clubhouse.debugSpawn(false);
      });
      const enterName = `customer-enter-${cycle}`;
      const enterMeasurement = await measure(enterName, {
        minimumMs: 8000,
        action: async () => {
          await page.waitForFunction(() => {
            const customers = window.__fw.scene3d.clubhouse().customers;
            return Array.isArray(customers) && customers.some((customer) => customer.entered);
          }, null, { timeout: 30000 });
          await page.waitForTimeout(1000);
        },
      });
      if (cycle === 1) await screen('customer-entered');
      const beforeLeave = await page.evaluate(() => window.__fw.scene3d.clubhouse().customers.map((customer) => ({
        id: customer.customerId,
        entered: customer.entered,
        phase: customer.checkoutPhase,
        cartSize: customer.cart.length,
      })));
      const leaveName = `customer-leave-${cycle}`;
      const leaveMeasurement = await measure(leaveName, {
        minimumMs: 0,
        action: async () => {
          await page.evaluate(() => {
            const app = window.__fw;
            const day = Math.floor(app.state.clock.minutes / 1440);
            app.state.clock.minutes = day * 1440 + 19 * 60 + 59;
            app.empire.clockMinutes = app.state.clock.minutes;
          });
          await page.keyboard.press('3');
          await page.waitForFunction(() => window.__fw.scene3d.clubhouse().customers.length === 0, null, { timeout: 45000 });
          await page.keyboard.press(' ');
          await page.waitForTimeout(800);
        },
      });
      customerRecords.push({
        cycle,
        beforeLeave,
        enterElapsedMs: enterMeasurement.elapsedMs,
        leaveElapsedMs: leaveMeasurement.elapsedMs,
        remaining: await page.evaluate(() => window.__fw.scene3d.clubhouse().customers.length),
      });
    }
    customerAudit = { cycles: customerCycles, records: customerRecords };
    await lifecycleSnapshot('after-customer-cycles');
  } catch (error) {
    result.diagnostics.functionalFailures.push({
      phase,
      message: error?.message || String(error),
      stack: error?.stack || null,
    });
  } finally {
    for (const key of ['w', 'a', 'd', 'Shift', 'ArrowLeft', 'ArrowRight', 'e']) {
      await page.keyboard.up(key).catch(() => {});
    }
  }
  result.diagnostics.carryTransitions = await page.evaluate(
    () => window.__scenarioCarryTransitions || [],
  ).catch(() => []);

  result.audits = {
    laptop: laptopAudit,
    editor: editorAudit,
    walking: walkAudit,
    driving: driveAudit,
    delivery: deliveryAudit,
    saveLoad: saveAudit,
    menu: menuAudit,
    customers: customerAudit,
  };
  const firstLifecycle = result.lifecycle[0] || null;
  const lastLifecycle = result.lifecycle[result.lifecycle.length - 1] || null;
  const subtract = (after, before) => (after == null || before == null ? null : after - before);
  result.lifecycleDelta = firstLifecycle && lastLifecycle ? {
    performanceHeapBytes: subtract(lastLifecycle.heapBytes, firstLifecycle.heapBytes),
    cdpHeapBytes: subtract(lastLifecycle.cdpHeapUsedBytes, firstLifecycle.cdpHeapUsedBytes),
    runtimeHeapBytes: subtract(lastLifecycle.runtimeHeap?.usedSize, firstLifecycle.runtimeHeap?.usedSize),
    trackedListenerNet: subtract(lastLifecycle.listeners?.net, firstLifecycle.listeners?.net),
    domNodes: subtract(lastLifecycle.dom?.nodes, firstLifecycle.dom?.nodes),
    jsEventListeners: subtract(lastLifecycle.dom?.jsEventListeners, firstLifecycle.dom?.jsEventListeners),
    liveDomNodes: subtract(lastLifecycle.resources?.liveDomNodes, firstLifecycle.resources?.liveDomNodes),
    sceneNodes: subtract(lastLifecycle.resources?.nodes, firstLifecycle.resources?.nodes),
    rendererGeometries: subtract(
      lastLifecycle.resources?.rendererMemory?.geometries,
      firstLifecycle.resources?.rendererMemory?.geometries,
    ),
    rendererTextures: subtract(
      lastLifecycle.resources?.rendererMemory?.textures,
      firstLifecycle.resources?.rendererMemory?.textures,
    ),
  } : null;

  const addCheck = (id, ok, actual, expected) => result.checks.push({ id, ok: !!ok, actual, expected });
  const unexpectedFailures = result.diagnostics.requestFailures.filter((failure) => failure.errorText !== 'net::ERR_ABORTED');
  addCheck('functional-route', result.diagnostics.functionalFailures.length === 0,
    result.diagnostics.functionalFailures, 'no functional failures');
  addCheck('console-errors', result.diagnostics.consoleErrors.length === 0,
    result.diagnostics.consoleErrors.length, 0);
  addCheck('page-errors', result.diagnostics.pageErrors.length === 0,
    result.diagnostics.pageErrors.length, 0);
  addCheck('unexpected-request-failures', unexpectedFailures.length === 0,
    unexpectedFailures, []);
  addCheck('laptop-single-root', startAtDelivery
    || (laptopAudit?.roots === 1 && laptopAudit?.visibleRoots === 0),
    startAtDelivery ? 'skipped' : laptopAudit, 'one hidden root after every cycle');
  addCheck('laptop-restored-walk-lens', startAtDelivery
    || (laptopAudit?.lens?.fov === 66 && laptopAudit?.lens?.near === 0.15),
    startAtDelivery ? 'skipped' : laptopAudit?.lens, { fov: 66, near: 0.15 });
  addCheck('editor-clean-exit', startAtDelivery || (editorAudit?.active === false
    && editorAudit?.playtesting === false && editorAudit?.courseMode === 'walk'),
    startAtDelivery ? 'skipped' : editorAudit, 'inactive editor, walk mode');
  addCheck('walking-moved', startAtDelivery || (walkAudit?.pathDistance || 0) > 5,
    startAtDelivery ? 'skipped' : walkAudit?.pathDistance, '> 5 yd traveled through normal movement controls');
  addCheck('tractor-moved', startAtDelivery || (driveAudit?.pathDistance || 0) > 15,
    startAtDelivery ? 'skipped' : driveAudit?.pathDistance, '> 15 yd traveled through normal driving controls');
  addCheck('delivery-stocked', (deliveryAudit?.after?.ballsShelf || 0) > (deliveryAudit?.shelfBefore ?? Infinity),
    deliveryAudit, 'shelf increases through normal hold-E stocking');
  addCheck('delivery-hands-clear', !deliveryAudit?.after?.carriedGoods,
    deliveryAudit?.after?.carriedGoods || null, null);
  addCheck('slot-save-load-exact', saveAudit?.exact === true,
    saveAudit, 'delivery/inventory/cash/tractor fingerprint exactly restored');
  addCheck('menu-reentry-cycles', menuAudit?.records?.length === menuCycles
    && menuAudit.records.every((entry) => entry.menuState.sceneNull && entry.menuState.stateNull && entry.newScene),
    menuAudit, `${menuCycles} clean menu -> Continue transitions`);
  addCheck('customer-spawn-leave-cycles', customerAudit?.records?.length === customerCycles
    && customerAudit.records.every((entry) => entry.beforeLeave.some((customer) => customer.entered) && entry.remaining === 0),
    customerAudit, `${customerCycles} entered customers removed through the live route`);
  if (result.lifecycleDelta) {
    addCheck('tracked-listener-growth', result.lifecycleDelta.trackedListenerNet <= 0,
      result.lifecycleDelta.trackedListenerNet, '<= 0');
    addCheck('forced-gc-heap-growth', result.lifecycleDelta.runtimeHeapBytes == null
      || result.lifecycleDelta.runtimeHeapBytes <= 128 * 1024 * 1024,
    result.lifecycleDelta.runtimeHeapBytes, '<= 128 MiB across all feature and scene cycles');
  }

  result.diagnostics.requestFailureSummary = {
    total: result.diagnostics.requestFailures.length,
    aborted: result.diagnostics.requestFailures.filter((failure) => failure.errorText === 'net::ERR_ABORTED').length,
    unexpected: unexpectedFailures.length,
    byPhase: result.diagnostics.requestFailures.reduce((summary, failure) => {
      summary[failure.phase] = (summary[failure.phase] || 0) + 1;
      return summary;
    }, {}),
  };
  result.phaseLog = phaseLog;
  result.elapsedMs = Date.now() - startedAt;
  result.ok = result.checks.every((check) => check.ok);
  return result;
}
