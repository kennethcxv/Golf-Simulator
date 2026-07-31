async (page) => {
  // Repeatable Course-2 modern public clubhouse acceptance pass. Fixed camera
  // fixtures keep comparisons honest; the entrance proof uses normal controls.
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const variant = process.env.MODERN_CLUBHOUSE_VARIANT || 'modern-public';
  const iteration = process.env.MODERN_CLUBHOUSE_QA_ITERATION || 'iteration-01';
  const repo = process.env.QA_REPO_ROOT || process.cwd();
  const out = path.join(repo, 'qa', 'clubhouse-modern', iteration);
  fs.mkdirSync(out, { recursive: true });

  const diagnostics = {
    consoleErrors: [],
    consoleWarnings: [],
    pageErrors: [],
    requestFailures: [],
  };
  page.on('console', (message) => {
    if (message.type() === 'error') diagnostics.consoleErrors.push(message.text());
    if (message.type() === 'warning') diagnostics.consoleWarnings.push(message.text());
  });
  page.on('pageerror', (error) => diagnostics.pageErrors.push(error.message));
  page.on('requestfailed', (request) => diagnostics.requestFailures.push({
    url: request.url(),
    error: request.failure()?.errorText || 'unknown',
  }));

  await page.addInitScript(() => {
    const add = EventTarget.prototype.addEventListener;
    const remove = EventTarget.prototype.removeEventListener;
    const live = Object.create(null);
    const keyFor = (target, type) => `${target === window ? 'window' : 'document'}:${type}`;
    EventTarget.prototype.addEventListener = function trackedAdd(type, listener, options) {
      if (this === window || this === document) {
        const key = keyFor(this, type);
        live[key] = (live[key] || 0) + 1;
      }
      return add.call(this, type, listener, options);
    };
    EventTarget.prototype.removeEventListener = function trackedRemove(type, listener, options) {
      if (this === window || this === document) {
        const key = keyFor(this, type);
        live[key] = (live[key] || 0) - 1;
      }
      return remove.call(this, type, listener, options);
    };
    window.__modernClubhouseListeners = live;
  });

  const base = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const url = new URL(base);
  url.searchParams.set('clubhouse', variant);
  await page.goto(url.toString());
  await page.setViewportSize({ width: 1600, height: 900 });
  await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || getComputedStyle(veil).display === 'none' || Number(getComputedStyle(veil).opacity) <= 0.01;
  }, null, { timeout: 90000 });
  if (variant === 'modern-public') {
    await page.waitForFunction(() => {
      const api = window.__fw?.scene3d?.clubhouse?.()?.modernClubhouse;
      return Boolean(api) && api.diagnostics().lifecycle !== 'loading';
    }, null, { timeout: 120000 });
  }
  await page.waitForTimeout(1800);

  await page.evaluate(() => {
    const state = window.__fw.state;
    const clubhouse = window.__fw.scene3d.clubhouse();
    // Keep architectural comparisons deterministic. Pending starter deliveries
    // are exercised by their own gameplay QA and otherwise park vans directly
    // across the loading-bay and facade shots while these fixed cameras run.
    state.shop.orders.length = 0;
    if (state.notifications?.items) state.notifications.items.length = 0;
    clubhouse.setOrganicWalkins(false);
    clubhouse.clearWalkins();
    // The architectural review fixture proves the clean authored materials.
    // Wash progress is changed only in this throwaway browser context and all
    // normal restoration/save behavior remains exercised by its own tests.
    for (const surface of Object.values(state.shop?.reno?.wash || {})) {
      if (Array.isArray(surface?.grime)) surface.grime.fill(0);
      if (Array.isArray(surface?.soap)) surface.soap.fill(0);
    }
    clubhouse.repaintWash?.();
    state.clock.minutes = Math.floor(state.clock.minutes / 1440) * 1440 + 14 * 60;
    state.weather = {
      ...state.weather,
      today: {
        ...(state.weather?.today || {}),
        tempHiF: 72,
        tempLoF: 54,
        rainIn: 0,
        humidity: 0.38,
        windMph: 4,
      },
    };
    window.__fw.scene3d.applyTimeWeather(14 * 60, state.weather);
  });
  await page.waitForTimeout(250);
  await page.evaluate(() => {
    for (const button of document.querySelectorAll('.notification-dismiss')) button.click();
  });
  await page.waitForTimeout(250);

  const pose = async (shot) => {
    await page.evaluate(({ x, z, tx, tz, pitch = 0 }) => {
      const walk = window.__fw.scene3d.walk;
      walk.clearKeys();
      walk.state.x = x;
      walk.state.z = z;
      const dx = tx - x;
      const dz = tz - z;
      const length = Math.hypot(dx, dz) || 1;
      walk.state.yaw = Math.atan2(-dx / length, -dz / length);
      walk.state.pitch = pitch;
    }, shot);
    await page.waitForTimeout(700);
  };

  const center = await page.evaluate(() => {
    const group = window.__fw.scene3d.clubhouse().group;
    return { x: group.position.x, z: group.position.z };
  });
  const worldShot = ({ x, z, tx, tz, ...rest }) => ({
    x: center.x + x,
    z: center.z + z,
    tx: center.x + tx,
    tz: center.z + tz,
    ...rest,
  });

  const shots = [
    { id: '01-front-arrival', x: 0, z: 27, tx: -0.8, tz: 0, pitch: 0.045 },
    { id: '02-front-west-three-quarter', x: -22, z: 22, tx: 0, tz: 0, pitch: 0.035 },
    { id: '03-parking-and-arrival', x: 0, z: 48, tx: 0, tz: 8, pitch: 0.10 },
    { id: '04-east-loading-entrance', x: 23, z: 13, tx: 10.5, tz: -0.2, pitch: 0.055 },
    { id: '05-rear-course-patio', x: -4.2, z: -19, tx: -4.2, tz: -9.8, pitch: 0.16 },
    { id: '06-cart-barn', x: 26.8, z: 7.0, tx: 26.8, tz: -4.2, pitch: 0.045 },
    { id: '07-empty-customizable-interior', x: -2.4, z: 3.2, tx: 2.8, tz: -3.5, pitch: -0.10, hideLegacyInterior: true },
    { id: '08-service-room-plan', x: 3.4, z: 5.2, tx: 8.0, tz: -0.7, pitch: -0.06, hideLegacyInterior: true },
  ].map(worldShot);
  for (const shot of shots) {
    await pose(shot);
    if (shot.hideLegacyInterior) {
      await page.evaluate(() => {
        const interior = window.__fw.scene3d.clubhouse().interior;
        interior.userData.visualQaForceHidden = true;
        interior.visible = false;
      });
      await page.waitForTimeout(250);
    }
    await page.screenshot({ path: path.join(out, `${shot.id}.png`) });
    if (shot.hideLegacyInterior) {
      await page.evaluate(() => {
        const clubhouse = window.__fw.scene3d.clubhouse();
        clubhouse.interior.userData.visualQaForceHidden = false;
        clubhouse.syncCameraVisibility();
      });
    }
  }

  const sampleFrames = async (cameraShot, durationMs = 2600) => {
    await pose(cameraShot);
    return page.evaluate((sampleMs) => new Promise((resolve) => {
      const durations = [];
      let start = null;
      let previous = null;
      const tick = (time) => {
        if (start === null) {
          start = time;
          previous = time;
        } else {
          durations.push(time - previous);
          previous = time;
        }
        if (time - start < sampleMs) requestAnimationFrame(tick);
        else {
          const sorted = durations.slice().sort((a, b) => a - b);
          const meanMs = durations.reduce((sum, value) => sum + value, 0) / Math.max(1, durations.length);
          const percentile = (fraction) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] || 0;
          const renderer = window.__fw.scene3d.renderer;
          resolve({
            frames: durations.length,
            meanFrameMs: meanMs,
            averageFps: meanMs > 0 ? 1000 / meanMs : 0,
            onePercentLowFps: percentile(0.99) > 0 ? 1000 / percentile(0.99) : 0,
            worstFrameMs: sorted.at(-1) || 0,
            p95FrameMs: percentile(0.95),
            render: { ...renderer.info.render },
            memory: { ...renderer.info.memory },
          });
        }
      };
      requestAnimationFrame(tick);
    }), durationMs);
  };

  const frameSamples = [];
  for (let index = 0; index < 3; index++) {
    frameSamples.push(await sampleFrames(shots[0]));
  }

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('HeapProfiler.enable');
  await cdp.send('Performance.enable');
  const resourceCheckpoint = async (label) => {
    await cdp.send('HeapProfiler.collectGarbage');
    await page.waitForTimeout(100);
    const [dom, heap, browserMetrics, game] = await Promise.all([
      cdp.send('Memory.getDOMCounters'),
      cdp.send('Runtime.getHeapUsage'),
      cdp.send('Performance.getMetrics'),
      page.evaluate(() => ({
        listeners: { ...(window.__modernClubhouseListeners || {}) },
        rendererMemory: { ...window.__fw.scene3d.renderer.info.memory },
      })),
    ]);
    const metricMap = Object.fromEntries(browserMetrics.metrics.map(({ name, value }) => [name, value]));
    return {
      label,
      dom,
      heap,
      cdpJsHeapBytes: metricMap.JSHeapUsedSize ?? null,
      ...game,
    };
  };
  const startRouteSample = async () => page.evaluate(() => {
    const root = document.querySelector('#ui') || document.body;
    const sample = {
      frames: [], calls: [], triangles: [], last: performance.now(),
      mutationRecords: 0, startedAt: performance.now(), raf: 0,
    };
    const observer = new MutationObserver((records) => { sample.mutationRecords += records.length; });
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
    window.__modernClubhouseRouteSample = sample;
  });
  const stopRouteSample = async () => page.evaluate(() => {
    const sample = window.__modernClubhouseRouteSample;
    cancelAnimationFrame(sample.raf);
    sample.observer.disconnect();
    const frames = sample.frames.slice(2).filter((value) => value > 0 && value < 1000);
    const sorted = frames.slice().sort((a, b) => a - b);
    const mean = (values) => values.length
      ? values.reduce((sum, value) => sum + value, 0) / values.length
      : 0;
    const worstCount = Math.max(1, Math.ceil(sorted.length * 0.01));
    const worstOnePercent = sorted.slice(-worstCount);
    const meanFrameMs = mean(frames);
    const elapsedMs = performance.now() - sample.startedAt;
    delete window.__modernClubhouseRouteSample;
    return {
      elapsedMs,
      frames: frames.length,
      averageFps: meanFrameMs > 0 ? 1000 / meanFrameMs : 0,
      onePercentLowFps: worstOnePercent.length ? 1000 / mean(worstOnePercent) : 0,
      worstFrameMs: sorted.at(-1) || 0,
      drawCallsAverage: mean(sample.calls),
      trianglesAverage: mean(sample.triangles),
      uiMutationRecords: sample.mutationRecords,
      uiMutationRecordsPerSecond: sample.mutationRecords / Math.max(0.001, elapsedMs / 1000),
    };
  });

  let interaction = { skipped: true, reason: 'legacy comparison variant' };
  let stability = { skipped: true, reason: 'legacy comparison variant' };
  if (variant === 'modern-public') {
    // Start within the established interaction radius, take a normal-control
    // step to the threshold, then use the established E action.
    await page.evaluate(() => {
      const clubhouse = window.__fw.scene3d.clubhouse();
      clubhouse.setOrganicWalkins(false);
      clubhouse.clearWalkins();
    });
    await pose(worldShot({ x: -0.8, z: 8.75, tx: -0.8, tz: 7.1, pitch: -0.025 }));
    await page.waitForFunction(() => (
      window.__fw.scene3d.walk.getFocusLabel()?.includes('Shop door')
    ), null, { timeout: 2500 }).catch(() => {});
    const playerBefore = await page.evaluate(() => ({
      x: window.__fw.scene3d.walk.state.x,
      z: window.__fw.scene3d.walk.state.z,
      focus: window.__fw.scene3d.walk.getFocusLabel(),
    }));
    const doorBefore = await page.evaluate(() => {
      const root = window.__fw.scene3d.clubhouse().modernClubhouse.roots().building;
      return {
        left: root?.getObjectByName('PIVOT_MainEntranceLeft')?.rotation.y ?? null,
        right: root?.getObjectByName('PIVOT_MainEntranceRight')?.rotation.y ?? null,
      };
    });
    const stabilityBefore = await resourceCheckpoint('before-normal-controls-and-door-stress');
    await startRouteSample();
    await page.mouse.click(800, 450);
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(120);
    await page.keyboard.up('KeyW');
    await page.waitForFunction(() => (
      window.__fw.scene3d.walk.getFocusLabel()?.includes('Shop door')
    ), null, { timeout: 2500 }).catch(() => {});
    const playerAtDoor = await page.evaluate(() => ({
      x: window.__fw.scene3d.walk.state.x,
      z: window.__fw.scene3d.walk.state.z,
      focus: window.__fw.scene3d.walk.getFocusLabel(),
    }));
    await page.keyboard.press('KeyE');
    await page.waitForTimeout(1000);
    const doorAfter = await page.evaluate(() => {
      const root = window.__fw.scene3d.clubhouse().modernClubhouse.roots().building;
      return {
        left: root?.getObjectByName('PIVOT_MainEntranceLeft')?.rotation.y ?? null,
        right: root?.getObjectByName('PIVOT_MainEntranceRight')?.rotation.y ?? null,
      };
    });
    await page.screenshot({ path: path.join(out, '09-normal-controls-main-door.png') });
    await page.waitForTimeout(1400);
    const routePerformance = await stopRouteSample();
    const doorOpened = Number.isFinite(doorAfter.left)
      && Number.isFinite(doorBefore.left)
      && Math.abs(doorAfter.left - doorBefore.left) > 0.05;
    interaction = {
      doorBefore, doorAfter, doorOpened, playerBefore, playerAtDoor,
      performance: routePerformance,
      skipped: false,
    };
    const stressActivations = 20;
    for (let index = 0; index < stressActivations; index++) {
      await page.keyboard.press('KeyE');
      await page.waitForTimeout(60);
    }
    await page.waitForTimeout(1600);
    const stabilityAfter = await resourceCheckpoint('after-20-additional-door-activations');
    const listenerTotal = (snapshot) => Object.values(snapshot.listeners)
      .reduce((sum, count) => sum + count, 0);
    stability = {
      skipped: false,
      stressActivations,
      before: stabilityBefore,
      after: stabilityAfter,
      delta: {
        trackedListeners: listenerTotal(stabilityAfter) - listenerTotal(stabilityBefore),
        domNodes: stabilityAfter.dom.nodes - stabilityBefore.dom.nodes,
        jsEventListeners: stabilityAfter.dom.jsEventListeners - stabilityBefore.dom.jsEventListeners,
        cdpJsHeapBytes: stabilityAfter.cdpJsHeapBytes - stabilityBefore.cdpJsHeapBytes,
        rendererGeometries: stabilityAfter.rendererMemory.geometries - stabilityBefore.rendererMemory.geometries,
        rendererTextures: stabilityAfter.rendererMemory.textures - stabilityBefore.rendererMemory.textures,
      },
    };
  }

  await cdp.send('HeapProfiler.collectGarbage');
  const [dom, heap, browserMetrics, model] = await Promise.all([
    cdp.send('Memory.getDOMCounters'),
    cdp.send('Runtime.getHeapUsage'),
    cdp.send('Performance.getMetrics'),
    page.evaluate((selectedVariant) => {
      const ch = window.__fw.scene3d.clubhouse();
      const roots = selectedVariant === 'modern-public'
        ? Object.values(ch.modernClubhouse.roots())
        : [ch.group, ch.interior].filter(Boolean);
      const renderer = window.__fw.scene3d.renderer;
      const families = Object.create(null);
      const materials = new Set();
      const geometries = new Set();
      let meshes = 0;
      let triangles = 0;
      let visibleCollisionMeshes = 0;
      for (const root of roots) root?.traverse((node) => {
        const family = node.userData?.module_family;
        if (family) families[family] = (families[family] || 0) + 1;
        if (!node.isMesh) return;
        meshes += 1;
        if ((node.name.startsWith('COL_') || node.userData?.collision_proxy === true) && node.visible) {
          visibleCollisionMeshes += 1;
        }
        if (node.geometry) {
          geometries.add(node.geometry.uuid);
          const count = node.geometry.index?.count || node.geometry.attributes?.position?.count || 0;
          triangles += count / 3;
        }
        for (const material of (Array.isArray(node.material) ? node.material : [node.material])) {
          if (material) materials.add(material.uuid);
        }
      });
      const building = selectedVariant === 'modern-public'
        ? ch.modernClubhouse.roots().building
        : null;
      const site = selectedVariant === 'modern-public'
        ? ch.modernClubhouse.roots().site
        : null;
      const requiredNames = [
        'MODERN_PUBLIC_CLUBHOUSE_BUILDING', 'LOD0_ARCHITECTURE', 'LOD0_MODULE_WallSystem',
        'LOD0_MODULE_WindowSystem', 'LOD0_MODULE_MainEntrancePorch', 'LOD0_MODULE_ServiceRoomPlan',
        'LOD0_MODULE_LoadingEntrance', 'PIVOT_MainEntranceLeft',
        'PIVOT_MainEntranceRight', 'PIVOT_RearServiceDoor',
        'MODERN_PUBLIC_CLUBHOUSE_SITE', 'LOD0_MODULE_ParkingLot_52Space',
        'LOD0_MODULE_OutdoorPatio', 'LOD0_MODULE_CartBarn',
        'SOCKET_ExpansionWest', 'SOCKET_ParkingExpansionSouth', 'SOCKET_IrrigationUtility',
      ];
      const rootFor = (name) => building?.getObjectByName(name) || site?.getObjectByName(name);
      return {
        variant: selectedVariant,
        diagnostics: selectedVariant === 'modern-public'
          ? ch.modernClubhouse.diagnostics()
          : { lifecycle: 'legacy' },
        meshes,
        triangles: Math.round(triangles),
        uniqueGeometries: geometries.size,
        uniqueMaterials: materials.size,
        rendererMemory: { ...renderer.info.memory },
        moduleFamilies: families,
        visibleCollisionMeshes,
        requiredNodes: Object.fromEntries(requiredNames.map((name) => [name, Boolean(rootFor(name))])),
        listeners: { ...(window.__modernClubhouseListeners || {}) },
        browserHeapBytes: performance.memory?.usedJSHeapSize ?? null,
      };
    }, variant),
  ]);
  const browserMetricMap = Object.fromEntries(browserMetrics.metrics.map(({ name, value }) => [name, value]));
  const requiredNodesPresent = variant !== 'modern-public' || Object.values(model.requiredNodes).every(Boolean);
  const ignoredLoadedModelAborts = diagnostics.requestFailures.filter((failure) => (
    failure.url.includes('modern_public_clubhouse')
      && failure.error === 'net::ERR_ABORTED'
      && model.diagnostics.lifecycle === 'active'
      && model.diagnostics.buildingLoaded === true
      && model.diagnostics.siteLoaded === true
  ));
  const modelFailures = diagnostics.requestFailures.filter((failure) => (
    failure.url.includes('modern_public_clubhouse')
      && !ignoredLoadedModelAborts.includes(failure)
  ));
  const averages = {
    averageFps: frameSamples.reduce((sum, sample) => sum + sample.averageFps, 0) / frameSamples.length,
    onePercentLowFps: frameSamples.reduce((sum, sample) => sum + sample.onePercentLowFps, 0) / frameSamples.length,
    worstFrameMs: Math.max(...frameSamples.map((sample) => sample.worstFrameMs)),
    drawCalls: frameSamples.reduce((sum, sample) => sum + sample.render.calls, 0) / frameSamples.length,
    trianglesDrawn: frameSamples.reduce((sum, sample) => sum + sample.render.triangles, 0) / frameSamples.length,
  };

  return {
    ok: (variant !== 'modern-public' || model.diagnostics.lifecycle === 'active')
      && requiredNodesPresent
      && (variant !== 'modern-public' || model.visibleCollisionMeshes === 0)
      && (interaction.skipped || interaction.doorOpened)
      && (stability.skipped || (
        stability.delta.trackedListeners <= 0
        && stability.delta.jsEventListeners <= 0
        && stability.delta.rendererGeometries <= 0
        && stability.delta.rendererTextures <= 0
        && stability.delta.cdpJsHeapBytes <= 8 * 1024 * 1024
      ))
      && diagnostics.pageErrors.length === 0
      && diagnostics.consoleErrors.length === 0
      && modelFailures.length === 0,
    variant,
    iteration,
    protocol: {
      viewport: '1600x900@1',
      fixedTime: '2:00 PM',
      fixedWeather: '72F/54F, dry, 38% humidity, 4 mph wind',
      frameSamples: '3 x 2.6 seconds at fixed front-arrival camera',
      normalControls: variant === 'modern-public' ? 'fixed in-range porch start; W 0.12s; E; wait 1s' : 'not applicable',
      clubhouseCenter: center,
    },
    screenshots: shots.map((shot) => path.join(out, `${shot.id}.png`))
      .concat(variant === 'modern-public' ? path.join(out, '09-normal-controls-main-door.png') : []),
    interaction,
    stability,
    performance: { samples: frameSamples, averages },
    model,
    resources: {
      dom,
      heap,
      cdpJsHeapBytes: browserMetricMap.JSHeapUsedSize ?? null,
      nodes: browserMetricMap.Nodes ?? null,
      documents: browserMetricMap.Documents ?? null,
    },
    diagnostics: { ...diagnostics, ignoredLoadedModelAborts },
  };
}
