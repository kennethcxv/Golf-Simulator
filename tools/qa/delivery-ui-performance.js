async (page) => {
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:18679/';
  const variant = process.env.DELIVERY_PERF_VARIANT || 'candidate';
  const baselineCommit = process.env.DELIVERY_PERF_BASELINE_COMMIT || '';
  const sampleCount = Math.max(3, Number(process.env.DELIVERY_PERF_SAMPLES || 3));
  const sampleMs = Math.max(4000, Number(process.env.DELIVERY_PERF_SAMPLE_MS || 6000));
  const diagnostics = [];
  page.on('pageerror', (error) => diagnostics.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') diagnostics.push(`console: ${message.text()}`);
  });
  page.on('requestfailed', (request) => {
    const failure = request.failure()?.errorText || 'unknown';
    if (!/ERR_ABORTED/i.test(failure)) diagnostics.push(`requestfailed: ${request.url()} (${failure})`);
  });

  // A matched pre-change run reuses the exact same server, assets, browser, and
  // machine. Only the handful of production text modules changed by this phase
  // are fulfilled from the requested Git commit, avoiding a 1.7 GB asset copy
  // whose bytes would be identical anyway.
  if (baselineCommit) {
    const childProcess = process.getBuiltinModule('node:child_process');
    const repo = process.env.QA_REPO_ROOT || process.cwd();
    const overrides = [
      'src/main.js',
      'src/sim/shop.js',
      'src/ui/laptop.js',
      'src/ui/ui.js',
      'src/styles.css',
    ];
    for (const file of overrides) {
      const body = childProcess.execFileSync('git', ['show', `${baselineCommit}:${file}`], {
        cwd: repo,
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024,
      });
      await page.route(`**/${file}`, (route) => route.fulfill({
        status: 200,
        contentType: file.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8',
        body,
      }));
    }
  }

  await page.addInitScript(() => {
    const rawAdd = EventTarget.prototype.addEventListener;
    const rawRemove = EventTarget.prototype.removeEventListener;
    const listeners = {};
    const keyFor = (target, type) => `${target === window ? 'window' : target === document ? 'document' : 'other'}:${type}`;
    EventTarget.prototype.addEventListener = function trackedAdd(type, listener, options) {
      if (this === window || this === document) {
        const key = keyFor(this, type);
        listeners[key] = (listeners[key] || 0) + 1;
      }
      return rawAdd.call(this, type, listener, options);
    };
    EventTarget.prototype.removeEventListener = function trackedRemove(type, listener, options) {
      if (this === window || this === document) {
        const key = keyFor(this, type);
        listeners[key] = (listeners[key] || 0) - 1;
      }
      return rawRemove.call(this, type, listener, options);
    };
    window.__deliveryPerfListeners = listeners;
  });

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  await cdp.send('HeapProfiler.enable');
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.getByText('Continue', { exact: true }).click();
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || veil.style.display === 'none' || Number.parseFloat(getComputedStyle(veil).opacity || '1') <= 0.01;
  }, null, { timeout: 90000 });
  await page.waitForTimeout(1500);

  await page.evaluate(() => {
    const app = window.__fw;
    app.speedIdx = 0;
    app.state.cash = 5000;
    app.empire.cash = 5000;
    app.state.shop.unlockedTier = 3;
    app.state.shop.progression.tier = 'luxury';
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
  await page.locator('.lt-tabs-big .lt-tab').filter({ hasText: /^Order$/ }).click();
  const product = page.locator('.lt-product').filter({ has: page.locator('.lt-prodname').filter({ hasText: /^Club polo$/ }) });
  await product.locator('.lt-qbtn').filter({ hasText: /^\+$/ }).click();
  await page.locator('.lt-ordersummary .lt-primary').filter({ hasText: /^Place Order$/ }).click();
  await page.locator('.lt-confirm .lt-primary').filter({ hasText: /^Place the order$/ }).click();
  await page.waitForFunction(() => document.querySelector('.lt-tabs-big .lt-tab.on')?.textContent?.trim() === 'Deliveries');
  await page.waitForTimeout(1500);

  await page.evaluate(() => {
    const perf = { mutationRecords: 0, addedNodes: 0, removedNodes: 0 };
    const observer = new MutationObserver((records) => {
      perf.mutationRecords += records.length;
      for (const record of records) {
        perf.addedNodes += record.addedNodes?.length || 0;
        perf.removedNodes += record.removedNodes?.length || 0;
      }
    });
    observer.observe(document.getElementById('ui'), { subtree: true, childList: true, attributes: true, characterData: true });
    window.__deliveryPerfMutation = perf;
    window.__deliveryPerfObserver = observer;
  });

  const summarize = (frames) => {
    const sorted = [...frames].sort((a, b) => a - b);
    const total = frames.reduce((sum, value) => sum + value, 0);
    const slow = [...frames].sort((a, b) => b - a).slice(0, Math.max(1, Math.ceil(frames.length * 0.01)));
    const slowMean = slow.reduce((sum, value) => sum + value, 0) / slow.length;
    return {
      frames: frames.length,
      avgFps: Number((frames.length * 1000 / total).toFixed(2)),
      onePercentLowFps: Number((1000 / slowMean).toFixed(2)),
      avgFrameMs: Number((total / frames.length).toFixed(3)),
      p95FrameMs: Number(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))].toFixed(3)),
      worstFrameMs: Number(Math.max(...frames).toFixed(3)),
      framesOver33Ms: frames.filter((value) => value > 33.333).length,
    };
  };
  const samples = [];
  for (let index = 0; index < sampleCount; index++) {
    await page.evaluate(() => {
      const perf = window.__deliveryPerfMutation;
      perf.mutationRecords = 0;
      perf.addedNodes = 0;
      perf.removedNodes = 0;
      window.__deliveryPerfFrames = [];
      window.__deliveryPerfSampling = true;
      let previous = performance.now();
      const loop = (now) => {
        if (!window.__deliveryPerfSampling) return;
        window.__deliveryPerfFrames.push(now - previous);
        previous = now;
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    });
    await page.waitForTimeout(sampleMs);
    const raw = await page.evaluate(() => {
      window.__deliveryPerfSampling = false;
      const renderer = window.__fw.scene3d.renderer.info;
      return {
        frames: window.__deliveryPerfFrames.slice(5),
        mutation: structuredClone(window.__deliveryPerfMutation),
        renderer: {
          drawCalls: renderer.render.calls,
          triangles: renderer.render.triangles,
          geometries: renderer.memory.geometries,
          textures: renderer.memory.textures,
          programs: renderer.programs?.length ?? null,
        },
      };
    });
    samples.push({
      ...summarize(raw.frames),
      uiMutationRecordsPerSecond: Number((raw.mutation.mutationRecords / (sampleMs / 1000)).toFixed(3)),
      uiAddedNodesPerSecond: Number((raw.mutation.addedNodes / (sampleMs / 1000)).toFixed(3)),
      uiRemovedNodesPerSecond: Number((raw.mutation.removedNodes / (sampleMs / 1000)).toFixed(3)),
      renderer: raw.renderer,
    });
  }

  await cdp.send('HeapProfiler.collectGarbage');
  await page.waitForTimeout(300);
  const metrics = await cdp.send('Performance.getMetrics');
  const byName = Object.fromEntries(metrics.metrics.map((entry) => [entry.name, entry.value]));
  const final = await page.evaluate(() => ({
    domNodes: document.getElementsByTagName('*').length,
    listenerBalance: structuredClone(window.__deliveryPerfListeners || {}),
    orderCount: window.__fw.state.shop.orders.length,
    deliveryRows: document.querySelectorAll('.lt-order').length,
    hasTracking: !!document.querySelector('.lt-delivery-track'),
    horizontalOverflow: document.querySelector('.lt-frame').scrollWidth - document.querySelector('.lt-frame').clientWidth,
  }));
  const median = (key) => {
    const values = samples.map((sample) => sample[key]).sort((a, b) => a - b);
    return values[Math.floor(values.length / 2)];
  };
  return {
    ok: diagnostics.length === 0 && final.orderCount === 1 && final.horizontalOverflow <= 1,
    variant,
    protocol: { baseUrl, baselineCommit: baselineCommit || null, viewport: '1600x900', sampleCount, sampleMs, state: 'paused Shop > Deliveries with one Club polo order' },
    summary: {
      avgFps: median('avgFps'),
      onePercentLowFps: median('onePercentLowFps'),
      worstFrameMs: median('worstFrameMs'),
      uiMutationRecordsPerSecond: median('uiMutationRecordsPerSecond'),
      uiAddedNodesPerSecond: median('uiAddedNodesPerSecond'),
      uiRemovedNodesPerSecond: median('uiRemovedNodesPerSecond'),
      jsHeapUsedBytes: byName.JSHeapUsedSize ?? null,
      jsEventListeners: byName.JSEventListeners ?? null,
      domNodes: byName.Nodes ?? final.domNodes,
      renderer: samples.at(-1).renderer,
    },
    samples,
    final,
    diagnostics,
  };
}
