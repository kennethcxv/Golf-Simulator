async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = path.resolve(process.env.QA_REPO_ROOT || process.cwd());
  const out = path.join(repo, 'qa', 'property-expansion-world-overhaul', 'delivery-tracking', 'performance-final');
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:18679/';
  fs.mkdirSync(out, { recursive: true });

  const diagnostics = [];
  page.on('pageerror', (error) => diagnostics.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') diagnostics.push(`console: ${message.text()}`);
  });
  page.on('requestfailed', (request) => {
    const failure = request.failure()?.errorText || 'unknown';
    if (!/ERR_ABORTED/i.test(failure)) diagnostics.push(`requestfailed: ${request.url()} (${failure})`);
  });

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.getByText('Continue', { exact: true }).click();
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || veil.style.display === 'none' || parseFloat(getComputedStyle(veil).opacity) < 0.02;
  }, null, { timeout: 90000 });
  await page.waitForTimeout(1200);

  await page.evaluate(async () => {
    const app = window.__fw;
    const shop = await import('/src/sim/shop.js');
    app.speedIdx = 0;
    app.state.cash = 50000;
    app.empire.cash = 50000;
    app.state.shop.unlockedTier = 3;
    app.state.shop.progression.tier = 'luxury';
    if (!app.state.shop.orders.length) shop.placeOrder(app.state, 'polo1', 1);
    const origin = app.scene3d.clubhouse().interior.position;
    const walk = app.scene3d.walk.state;
    walk.x = origin.x + 8.45;
    walk.z = origin.z + 4.5;
    walk.yaw = -Math.PI / 2;
    walk.pitch = -0.05;
    app.scene3d.walk.clearKeys?.();
  });

  const canvas = page.locator('canvas').first();
  await canvas.click({ position: { x: 800, y: 450 } });
  await page.waitForFunction(() => /Laptop.*\[E\]/i.test(document.querySelector('.shop-prompt')?.textContent || ''));
  await page.keyboard.press('e');
  await page.waitForFunction(() => window.__fw.laptopOpen === true);
  await page.locator('.lt-navbtn').filter({ hasText: /^Shop$/ }).click();

  const cdp = await page.context().newCDPSession(page);
  const listenerCount = async (group) => {
    const evaluated = await cdp.send('Runtime.evaluate', { expression: 'window', objectGroup: group });
    const listeners = await cdp.send('DOMDebugger.getEventListeners', { objectId: evaluated.result.objectId });
    await cdp.send('Runtime.releaseObjectGroup', { objectGroup: group });
    return listeners.listeners.length;
  };

  const sample = async (name, seconds = 4) => page.evaluate(({ name, seconds }) => new Promise((resolve) => {
    const renderer = window.__fw.scene3d.renderer;
    const content = document.querySelector('.lt-content');
    const frames = [];
    let prior = performance.now();
    let mutationCallbacks = 0;
    const observer = new MutationObserver(() => { mutationCallbacks += 1; });
    observer.observe(content, { childList: true, subtree: true, characterData: true, attributes: true });
    const started = performance.now();
    function tick(now) {
      frames.push(now - prior);
      prior = now;
      if (now - started < seconds * 1000) {
        requestAnimationFrame(tick);
        return;
      }
      observer.disconnect();
      const sorted = [...frames].sort((a, b) => a - b);
      const averageMs = frames.reduce((sum, value) => sum + value, 0) / Math.max(1, frames.length);
      const p99 = sorted[Math.max(0, Math.floor(sorted.length * 0.99) - 1)] || 0;
      resolve({
        name,
        durationMs: now - started,
        frames: frames.length,
        averageFps: 1000 / averageMs,
        onePercentLowFps: p99 > 0 ? 1000 / p99 : 0,
        worstFrameMs: Math.max(...frames),
        mutationCallbacks,
        mutationCallbacksPerSecond: mutationCallbacks / ((now - started) / 1000),
        jsHeapBytes: performance.memory?.usedJSHeapSize ?? null,
        geometries: renderer.info.memory.geometries,
        textures: renderer.info.memory.textures,
      });
    }
    requestAnimationFrame(tick);
  }), { name, seconds });

  const stockTab = page.locator('.lt-tabs-big .lt-tab').filter({ hasText: /^Stock$/ });
  const deliveryTab = page.locator('.lt-tabs-big .lt-tab').filter({ hasText: /^Deliveries$/ });
  const stockSamples = [];
  const deliverySamples = [];
  for (let run = 0; run < 3; run++) {
    await stockTab.click();
    await page.waitForTimeout(250);
    stockSamples.push(await sample(`stock-${run + 1}`));
    await deliveryTab.click();
    await page.waitForTimeout(250);
    deliverySamples.push(await sample(`deliveries-${run + 1}`));
  }
  await page.screenshot({ path: path.join(out, '01-live-delivery-performance.png') });

  await cdp.send('HeapProfiler.enable');
  await cdp.send('HeapProfiler.collectGarbage');
  const before = {
    listeners: await listenerCount('delivery-performance-before'),
    dom: await cdp.send('Memory.getDOMCounters'),
    heap: await page.evaluate(() => performance.memory?.usedJSHeapSize ?? null),
  };
  const cycleFailures = [];
  for (let cycle = 0; cycle < 12; cycle++) {
    await page.keyboard.press('Escape');
    const closed = await page.waitForFunction(() => window.__fw.laptopOpen === false, null, { timeout: 8000 })
      .then(() => true).catch(() => false);
    if (!closed) { cycleFailures.push(`cycle ${cycle + 1}: failed to close`); break; }
    const ready = await page.waitForFunction(() => /Laptop.*\[E\]/i.test(document.querySelector('.shop-prompt')?.textContent || ''), null, { timeout: 10000 })
      .then(() => true).catch(() => false);
    if (!ready) { cycleFailures.push(`cycle ${cycle + 1}: prompt did not return`); break; }
    await page.keyboard.press('e');
    const opened = await page.waitForFunction(() => window.__fw.laptopOpen === true, null, { timeout: 8000 })
      .then(() => true).catch(() => false);
    if (!opened) { cycleFailures.push(`cycle ${cycle + 1}: failed to reopen`); break; }
  }
  await page.locator('.lt-navbtn').filter({ hasText: /^Shop$/ }).click();
  await page.locator('.lt-tabs-big .lt-tab').filter({ hasText: /^Deliveries$/ }).click();
  await page.waitForTimeout(1500);
  await cdp.send('HeapProfiler.collectGarbage');
  const after = {
    listeners: await listenerCount('delivery-performance-after'),
    dom: await cdp.send('Memory.getDOMCounters'),
    heap: await page.evaluate(() => performance.memory?.usedJSHeapSize ?? null),
    laptopRoots: await page.locator('.laptop-screen').count(),
    laptopFrames: await page.locator('.lt-frame').count(),
  };
  await cdp.detach();
  await page.screenshot({ path: path.join(out, '02-after-12-laptop-cycles.png') });

  const median = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  };
  const summary = {
    stockAverageFps: median(stockSamples.map((entry) => entry.averageFps)),
    deliveryAverageFps: median(deliverySamples.map((entry) => entry.averageFps)),
    stockOnePercentLowFps: median(stockSamples.map((entry) => entry.onePercentLowFps)),
    deliveryOnePercentLowFps: median(deliverySamples.map((entry) => entry.onePercentLowFps)),
    deliveryMutationCallbacksPerSecond: median(deliverySamples.map((entry) => entry.mutationCallbacksPerSecond)),
    stockMutationCallbacksPerSecond: median(stockSamples.map((entry) => entry.mutationCallbacksPerSecond)),
    listenerGrowth: after.listeners - before.listeners,
    nodeGrowth: after.dom.nodes - before.dom.nodes,
    documentGrowth: after.dom.documents - before.dom.documents,
    jsEventListenerGrowth: after.dom.jsEventListeners - before.dom.jsEventListeners,
    heapGrowthBytes: before.heap == null || after.heap == null ? null : after.heap - before.heap,
  };
  const assertions = {
    deliveryPageRetainsAtLeast85PercentAverageFps: summary.deliveryAverageFps >= summary.stockAverageFps * 0.85,
    deliveryPageAverageFpsAtLeast30: summary.deliveryAverageFps >= 30,
    deliveryRefreshBoundedNearOneHz: summary.deliveryMutationCallbacksPerSecond <= 1.5,
    noWindowListenerGrowth: summary.listenerGrowth <= 0,
    noDomEventListenerGrowth: summary.jsEventListenerGrowth <= 0,
    noDocumentGrowth: summary.documentGrowth <= 0,
    oneLaptopRootAndFrame: after.laptopRoots === 1 && after.laptopFrames === 1,
    heapGrowthWithin32MiB: summary.heapGrowthBytes == null || summary.heapGrowthBytes <= 32 * 1024 * 1024,
    allTwelveCyclesCompleted: cycleFailures.length === 0,
    noConsolePageOrRequestErrors: diagnostics.length === 0,
  };
  const result = {
    ok: Object.values(assertions).every(Boolean),
    assertions,
    stockSamples,
    deliverySamples,
    before,
    after,
    summary,
    cycleFailures,
    diagnostics,
  };
  fs.writeFileSync(path.join(out, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}
