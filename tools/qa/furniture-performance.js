async (page) => {
  // The repository Playwright MCP evaluates this function in a sandbox where
  // Node's `process` global is intentionally unavailable. Environment values
  // remain supported for CLI runners, while MCP callers can set the equivalent
  // globalThis overrides in a preceding run-code call.
  const qaEnv = typeof process !== 'undefined' ? process.env : {};
  const qaBaseUrl = globalThis.__QA_BASE_URL || qaEnv.QA_BASE_URL || 'http://localhost:8491/';
  const qaLabel = globalThis.__QA_LABEL || qaEnv.QA_LABEL || 'performance-run';
  const qaScreenshotPath = globalThis.__QA_SCREENSHOT_PATH || qaEnv.QA_SCREENSHOT_PATH;
  const diagnostics = [];
  page.on('console', (message) => {
    if (['error', 'warning'].includes(message.type())) diagnostics.push(`console:${message.type()}: ${message.text()}`);
  });
  page.on('pageerror', (error) => diagnostics.push(`pageerror: ${error.message}`));

  await page.addInitScript(() => {
    // Every endpoint receives the same untouched Willow Creek fixture. This
    // prevents prior visual-QA saves from loading extra catalog models into
    // only one side of the comparison.
    localStorage.clear();
    sessionStorage.clear();
    const originalAdd = EventTarget.prototype.addEventListener;
    const originalRemove = EventTarget.prototype.removeEventListener;
    const registry = new WeakMap();
    const counts = { active: 0, adds: 0, removes: 0, byType: {} };
    const captureOf = (options) => typeof options === 'boolean' ? options : Boolean(options?.capture);
    EventTarget.prototype.addEventListener = function addEventListener(type, listener, options) {
      if (listener) {
        let byType = registry.get(this);
        if (!byType) { byType = new Map(); registry.set(this, byType); }
        let byListener = byType.get(type);
        if (!byListener) { byListener = new Map(); byType.set(type, byListener); }
        let captures = byListener.get(listener);
        if (!captures) { captures = new Set(); byListener.set(listener, captures); }
        const capture = captureOf(options);
        if (!captures.has(capture)) {
          captures.add(capture);
          counts.active += 1;
          counts.adds += 1;
          counts.byType[type] = (counts.byType[type] || 0) + 1;
        }
      }
      return originalAdd.call(this, type, listener, options);
    };
    EventTarget.prototype.removeEventListener = function removeEventListener(type, listener, options) {
      const capture = captureOf(options);
      const captures = registry.get(this)?.get(type)?.get(listener);
      if (captures?.delete(capture)) {
        counts.active -= 1;
        counts.removes += 1;
        counts.byType[type] = Math.max(0, (counts.byType[type] || 0) - 1);
      }
      return originalRemove.call(this, type, listener, options);
    };
    window.__qaListenerSnapshot = () => JSON.parse(JSON.stringify(counts));
  });

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(qaBaseUrl, { waitUntil: 'domcontentloaded' });
  const continueButton = page.getByText('Continue', { exact: true });
  if (await continueButton.isEnabled().catch(() => false)) {
    await continueButton.click();
  } else {
    await page.getByText(/New Empire.*Relaxed/i).click();
    await page.waitForFunction(() => [...document.querySelectorAll('button')]
      .some((button) => button.textContent.trim() === 'Buy' && !button.disabled), null, { timeout: 30000 });
    const firstAffordableProperty = page.locator('button:not([disabled])')
      .filter({ hasText: /^Buy$/ }).first();
    await firstAffordableProperty.click();
  }
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
  }, null, { timeout: 90000 });
  await page.evaluate(async () => {
    const ready = window.__fw.scene3d.clubhouse().sheet06ProductionReady?.();
    if (ready?.then) await ready;
  });
  await page.waitForFunction(() => {
    const diagnostics = window.__fw.scene3d.clubhouse().furnitureDiagnostics?.().visuals;
    return !diagnostics || (diagnostics.expectedPlacedModels === diagnostics.renderedModels
      && diagnostics.failures.length === 0);
  }, null, { timeout: 90000 });

  const fixture = await page.evaluate(() => {
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    app.speedIdx = 0;
    clubhouse.setOrganicWalkins?.(false);
    clubhouse.clearWalkins?.();
    const day = Math.floor(app.state.clock.minutes / 1440) * 1440;
    app.state.clock.minutes = day + 14 * 60;
    app.scene3d.applyTimeWeather?.(14 * 60, app.state.weather);
    const origin = clubhouse.interior.position;
    const walk = app.scene3d.walk.state;
    walk.x = origin.x - 0.6;
    walk.z = origin.z + 4.7;
    walk.yaw = 0;
    walk.pitch = -0.08;
    return { clock: '2:00 PM frozen', camera: { x: walk.x, z: walk.z, yaw: 0, pitch: -0.08 } };
  });
  await page.waitForTimeout(6000);

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('HeapProfiler.enable');
  const collect = () => cdp.send('HeapProfiler.collectGarbage').catch(() => {});
  await collect();

  const sampleFrames = async (samples = 3, frameCount = 300) => page.evaluate(async ({ samples, frameCount }) => {
    const runs = [];
    for (let run = 0; run < samples; run += 1) {
      const deltas = await new Promise((resolve) => {
        const values = [];
        let previous = null;
        const frame = (time) => {
          if (previous !== null) values.push(time - previous);
          previous = time;
          if (values.length >= frameCount) resolve(values);
          else requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      });
      runs.push(deltas);
    }
    const deltas = runs.flat().sort((a, b) => a - b);
    const average = deltas.reduce((sum, value) => sum + value, 0) / deltas.length;
    const worstCount = Math.max(1, Math.ceil(deltas.length * 0.01));
    const worstAverage = deltas.slice(-worstCount).reduce((sum, value) => sum + value, 0) / worstCount;
    const percentile = (ratio) => deltas[Math.min(deltas.length - 1, Math.ceil(deltas.length * ratio) - 1)];
    return {
      samples,
      framesPerSample: frameCount,
      frames: deltas.length,
      averageFps: 1000 / average,
      low1Fps: 1000 / worstAverage,
      averageMs: average,
      worstMs: deltas.at(-1),
      p95Ms: percentile(0.95),
      p99Ms: percentile(0.99),
      raw: runs,
    };
  }, { samples, frameCount });

  const resourceSnapshot = () => page.evaluate(async () => {
    const app = window.__fw;
    const renderer = app.scene3d.renderer;
    const scene = app.scene3d.scene;
    const materials = new Set();
    const textures = new Set();
    let visibleMeshes = 0;
    let sceneTriangles = 0;
    scene.traverse((node) => {
      if (!node?.isMesh || !node.geometry) return;
      if (node.visible) visibleMeshes += 1;
      const geometry = node.geometry;
      const triangles = geometry.index ? geometry.index.count / 3 : (geometry.attributes.position?.count || 0) / 3;
      sceneTriangles += triangles * (node.isInstancedMesh ? node.count : 1);
      for (const material of (Array.isArray(node.material) ? node.material : [node.material])) {
        if (!material) continue;
        materials.add(material);
        for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
      }
    });
    let estimatedTextureBytes = 0;
    for (const texture of textures) {
      const image = texture.image;
      const width = image?.width || image?.videoWidth || 0;
      const height = image?.height || image?.videoHeight || 0;
      const faces = Array.isArray(image) ? Math.max(1, image.length) : 1;
      estimatedTextureBytes += width * height * 4 * faces * (4 / 3);
    }
    const previousAutoReset = renderer.info.autoReset;
    renderer.info.autoReset = false;
    renderer.info.reset();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const render = { ...renderer.info.render };
    renderer.info.autoReset = previousAutoReset;
    renderer.info.reset();
    return {
      drawCallsTwoFrames: render.calls,
      renderedTrianglesTwoFrames: render.triangles,
      renderedLinesTwoFrames: render.lines,
      visibleMeshes,
      sceneTriangles,
      materialCount: materials.size,
      sceneTextureCount: textures.size,
      rendererTextureCount: renderer.info.memory.textures,
      estimatedRgbaMipBytes: Math.round(estimatedTextureBytes),
      rendererGeometries: renderer.info.memory.geometries,
    };
  });

  const listenerBefore = await page.evaluate(() => window.__qaListenerSnapshot());
  const heapBefore = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? null);
  const idleFrames = await sampleFrames();
  const idleResources = await resourceSnapshot();
  if (qaScreenshotPath) {
    await page.screenshot({ path: qaScreenshotPath });
  }

  await page.keyboard.press('b');
  await page.keyboard.press('i');
  const drawer = page.locator('.build-drawer');
  const panelAvailable = await drawer.isVisible().catch(() => false);
  if (panelAvailable) {
    await page.waitForFunction(() => {
      const images = [...document.querySelectorAll('.build-catalog-card img')];
      return images.length === 0 || images.every((image) => image.complete && image.naturalWidth > 0);
    });
  }
  const panelState = await page.evaluate(() => ({
    visible: Boolean(document.querySelector('.build-drawer') && getComputedStyle(document.querySelector('.build-drawer')).display !== 'none'),
    catalogCards: document.querySelectorAll('.build-catalog-card').length,
    thumbnails: document.querySelectorAll('.build-catalog-card img').length,
  }));
  await page.waitForTimeout(500);
  const panelFrames = await sampleFrames();
  const panelResources = await resourceSnapshot();

  await collect();
  const listenerPanelBefore = await page.evaluate(() => window.__qaListenerSnapshot());
  const heapPanelBefore = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? null);

  const mutationProbe = await page.evaluate(async () => {
    const target = document.querySelector('.build-drawer') || document.getElementById('ui');
    let mutations = 0;
    const observer = new MutationObserver((records) => { mutations += records.length; });
    observer.observe(target, { subtree: true, childList: true, attributes: true, characterData: true });
    const started = performance.now();
    await new Promise((resolve) => setTimeout(resolve, 5000));
    const seconds = (performance.now() - started) / 1000;
    observer.disconnect();
    return { mutations, seconds, perSecond: mutations / seconds };
  });

  for (let index = 0; index < 30; index += 1) {
    await page.keyboard.press('i');
    await page.waitForTimeout(25);
    await page.keyboard.press('i');
    await page.waitForTimeout(25);
  }
  await page.waitForTimeout(250);
  await collect();
  const listenerAfter = await page.evaluate(() => window.__qaListenerSnapshot());
  const heapAfter = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? null);
  const allowedDiagnostic = (entry) => entry.startsWith('console:warning: THREE.WebGLProgram:');
  return {
    ok: diagnostics.every(allowedDiagnostic) && listenerAfter.active === listenerPanelBefore.active,
    label: qaLabel,
    methodology: {
      browser: 'Google Chrome via repository Playwright runner',
      viewport: '1600x900',
      deviceScaleFactor: 1,
      warmupSeconds: 6,
      frameSamples: '3 x 300 requestAnimationFrame deltas per scenario',
      fixture: 'Willow Creek bootstrap; fixed clubhouse camera; 2 PM; clock and walk-ins paused',
      interactionLoop: '30 normal I-key close/open pairs',
      textureEstimate: 'unique scene texture source width x height x 4 RGBA bytes x 4/3 mip factor',
    },
    fixture,
    panelState,
    idle: { frames: idleFrames, resources: idleResources },
    panelOpen: { frames: panelFrames, resources: panelResources },
    heap: {
      beforeBytes: heapBefore,
      panelBeforeBytes: heapPanelBefore,
      afterBytes: heapAfter,
      bootToAfterDeltaBytes: heapAfter == null || heapBefore == null ? null : heapAfter - heapBefore,
      toggleLoopDeltaBytes: heapAfter == null || heapPanelBefore == null ? null : heapAfter - heapPanelBefore,
    },
    listeners: {
      before: listenerBefore,
      panelBefore: listenerPanelBefore,
      after: listenerAfter,
      bootToAfterActiveDelta: listenerAfter.active - listenerBefore.active,
      toggleLoopActiveDelta: listenerAfter.active - listenerPanelBefore.active,
    },
    uiMutations: mutationProbe,
    diagnostics,
  };
}
