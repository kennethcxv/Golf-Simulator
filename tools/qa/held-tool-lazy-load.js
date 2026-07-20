// Normal-control validation and first-equip timing for deferred course tools.
// Run only in an isolated browser window:
//   $env:HEADED='1'
//   $env:QA_RESULT_PATH='qa/steam-performance-master-pass/assets/held-tool-lazy-load/report.json'
//   node tools/qa/run-playwright.cjs tools/qa/held-tool-lazy-load.js --bootstrap
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = 'C:/Users/Kenneth/Documents/GitHub/Golf-Flipper';
  const outDir = path.join(repo, 'qa', 'steam-performance-master-pass', 'assets', 'held-tool-lazy-load');
  fs.mkdirSync(outDir, { recursive: true });

  const targetPaths = [
    'vendor/models/hose_nozzle.glb',
    'vendor/models/hand_fork.glb',
    'vendor/models/bucket_soil.glb',
    'vendor/models/rake.glb',
  ];

  const warnings = [];
  const errors = [];
  const failedRequests = [];
  const targetRequestLog = [];
  page.on('console', (message) => {
    if (message.type() === 'warning') warnings.push(message.text());
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(`PAGEERROR: ${error.message}`));
  page.on('request', (request) => {
    const requestPath = new URL(request.url()).pathname.replace(/^\//, '');
    if (targetPaths.includes(requestPath)) targetRequestLog.push(requestPath);
  });
  page.on('requestfailed', (request) => failedRequests.push({
    url: request.url(),
    error: request.failure()?.errorText || 'unknown',
  }));

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
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
      jsHeapUsedMiB: metrics.JSHeapUsedSize == null
        ? null : +(metrics.JSHeapUsedSize / 1048576).toFixed(3),
      jsHeapTotalMiB: metrics.JSHeapTotalSize == null
        ? null : +(metrics.JSHeapTotalSize / 1048576).toFixed(3),
    };
  };

  const pageSnapshot = () => page.evaluate((targets) => {
    const app = window.__fw;
    const resources = performance.getEntriesByType('resource')
      .filter((entry) => targets.some((target) => entry.name.endsWith(target)))
      .map((entry) => ({
        path: new URL(entry.name).pathname.replace(/^\//, ''),
        durationMs: +entry.duration.toFixed(3),
        transferBytes: entry.transferSize,
        decodedBodyBytes: entry.decodedBodySize,
      }));
    const visibleNames = [];
    app.scene3d.camera.traverse((object) => {
      if (!/HeldTool(?:LoadingFallback|Authored):/.test(object.name || '')) return;
      let effectiveVisible = true;
      for (let current = object; current; current = current.parent) effectiveVisible &&= current.visible;
      visibleNames.push({ name: object.name, effectiveVisible });
    });
    return {
      tool: app.scene3d.walk.getTool(),
      spraying: app.scene3d.walk.isSpraying(),
      diagnostics: app.scene3d.walk.heldAssetDiagnostics(),
      targetResources: resources,
      visibleNames,
      renderer: {
        geometries: app.scene3d.renderer.info.memory.geometries,
        textures: app.scene3d.renderer.info.memory.textures,
        programs: app.scene3d.renderer.info.programs?.length ?? null,
      },
    };
  }, targetPaths);

  const startFrameProbe = () => page.evaluate(() => {
    const probe = { active: true, frames: [], last: performance.now() };
    window.__heldToolFrameProbe = probe;
    const tick = (now) => {
      if (!probe.active) return;
      probe.frames.push({ at: now, deltaMs: now - probe.last });
      probe.last = now;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const stopFrameProbe = () => page.evaluate(() => {
    const probe = window.__heldToolFrameProbe;
    if (!probe) return [];
    probe.active = false;
    return probe.frames.slice();
  });
  const summarizeFrames = (records) => {
    const values = records.map((record) => record.deltaMs)
      .filter((value) => Number.isFinite(value) && value >= 0).slice(3);
    const sorted = [...values].sort((a, b) => a - b);
    const totalMs = values.reduce((sum, value) => sum + value, 0);
    const slowCount = Math.max(1, Math.ceil(sorted.length * 0.01));
    const slowMean = sorted.slice(-slowCount).reduce((sum, value) => sum + value, 0) / slowCount;
    return {
      frames: values.length,
      durationMs: +totalMs.toFixed(3),
      avgFps: +(values.length * 1000 / Math.max(1, totalMs)).toFixed(2),
      onePercentLowFps: +(1000 / Math.max(0.001, slowMean)).toFixed(2),
      worstFrameMs: +(sorted.at(-1) || 0).toFixed(3),
      framesOver33ms: values.filter((value) => value > 33.333).length,
      framesOver50ms: values.filter((value) => value > 50).length,
      framesOver100ms: values.filter((value) => value > 100).length,
    };
  };

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('http://localhost:8457/', { waitUntil: 'domcontentloaded' });
  await page.getByText('Continue', { exact: true }).click();
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.heldAssetDiagnostics, null, { timeout: 90000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
  }, null, { timeout: 90000 });
  await page.evaluate(async () => {
    const barrier = window.__fw.scene3d.assetBarrier?.(30000);
    if (barrier?.promise) await barrier.promise;
    window.__fw.speedIdx = 0;
    window.__fw.scene3d.walk.clearKeys?.();
  });
  await page.waitForTimeout(1500);

  const boot = await pageSnapshot();
  const countersBefore = await browserCounters();
  await page.screenshot({ path: path.join(outDir, '00-ordinary-boot.png') });
  await startFrameProbe();

  const transitions = [];
  const pressF = async (expectedTool, lazyTool = null) => {
    const wallStarted = Date.now();
    await page.keyboard.press('f');
    await page.waitForFunction((expected) => window.__fw.scene3d.walk.getTool() === expected,
      expectedTool, { timeout: 5000 });
    const immediate = await pageSnapshot();
    if (lazyTool && immediate.visibleNames.some((entry) => (
      entry.effectiveVisible && entry.name.startsWith('HeldToolLoadingFallback:')
    ))) {
      await page.screenshot({ path: path.join(outDir, `${transitions.length + 1}-${lazyTool}-fallback.png`) });
    }
    if (lazyTool) {
      await page.waitForFunction((tool) => {
        const status = window.__fw.scene3d.walk.heldAssetDiagnostics()[tool]?.status;
        return status && status !== 'idle' && status !== 'loading';
      }, lazyTool, { timeout: 30000 });
      await page.evaluate(async () => {
        const barrier = window.__fw.scene3d.assetBarrier?.(30000);
        if (barrier?.promise) await barrier.promise;
      });
    }
    await page.waitForTimeout(180);
    const settled = await pageSnapshot();

    let normalUse = null;
    if (expectedTool) {
      await page.mouse.move(800, 450);
      await page.mouse.down({ button: 'left' });
      await page.waitForTimeout(120);
      normalUse = await page.evaluate(() => ({
        tool: window.__fw.scene3d.walk.getTool(),
        sprayingWhileHeld: window.__fw.scene3d.walk.isSpraying(),
      }));
      await page.mouse.up({ button: 'left' });
      await page.waitForFunction(() => !window.__fw.scene3d.walk.isSpraying());
    }

    transitions.push({
      expectedTool,
      input: 'normal keyboard F; normal left pointer hold when equipped',
      wallElapsedMs: Date.now() - wallStarted,
      immediate,
      settled,
      normalUse,
    });
    if (expectedTool) await page.screenshot({ path: path.join(outDir, `${transitions.length}-${expectedTool}.png`) });
  };

  // Outdoor belt order is hands -> washer -> hose -> divot -> rake -> hands.
  await pressF('washer');
  await pressF('hose', 'hose');
  await pressF('divot', 'divot');
  await pressF('rake', 'rake');
  await pressF(null);

  const routeFrames = summarizeFrames(await stopFrameProbe());
  const final = await pageSnapshot();
  const countersAfter = await browserCounters();
  const exactRequests = Object.fromEntries(targetPaths.map((target) => [
    target,
    targetRequestLog.filter((entry) => entry === target).length,
  ]));
  const lazyDiagnostics = final.diagnostics;
  const allReady = ['hose', 'divot', 'rake'].every((tool) => lazyDiagnostics[tool].status === 'ready');
  const ordinaryBootDeferred = boot.targetResources.length === 0
    && ['hose', 'divot', 'rake'].every((tool) => boot.diagnostics[tool].status === 'idle');
  const normalUsePassed = transitions.filter((entry) => entry.expectedTool)
    .every((entry) => entry.normalUse?.tool === entry.expectedTool && entry.normalUse.sprayingWhileHeld);
  const benignWarnings = warnings.filter((warning) => (
    /THREE\.WebGLProgram: Program Info Log/i.test(warning)
      && /dyn_index_vec4_float4_int/i.test(warning)
  ));
  const nonBenignWarnings = warnings.filter((warning) => !benignWarnings.includes(warning));

  const report = {
    capturedAt: new Date().toISOString(),
    protocol: {
      launch: 'Playwright Chrome via tools/qa/run-playwright.cjs --bootstrap',
      viewport: '1600x900',
      deviceScaleFactor: 1,
      fixture: 'deterministic willow-creek Continue boot, tutorial hidden, normal outdoor spawn',
      warmupMs: 1500,
      route: 'normal F belt cycle: washer, hose, divot, rake, hands; normal left pointer hold per tool',
      instrumentation: 'courseScene heldAssetDiagnostics uses performance.now around GLTF request through adoption; Playwright page request events confirm request count',
    },
    boot,
    transitions,
    final,
    routeFrames,
    browser: {
      before: countersBefore,
      after: countersAfter,
      deltas: {
        jsEventListeners: countersAfter.jsEventListeners - countersBefore.jsEventListeners,
        jsHeapUsedMiB: countersAfter.jsHeapUsedMiB == null || countersBefore.jsHeapUsedMiB == null
          ? null : +(countersAfter.jsHeapUsedMiB - countersBefore.jsHeapUsedMiB).toFixed(3),
      },
    },
    exactRequests,
    targetRequestLog,
    resourceTimingCoverage: final.targetResources.length
      ? 'reported by Chrome Resource Timing'
      : 'Chrome omitted GLTFLoader requests from Resource Timing; Playwright page request events are the request-count source',
    diagnostics: { warnings, benignWarnings, nonBenignWarnings, errors, failedRequests },
    checks: {
      ordinaryBootDeferred,
      allAuthoredAssetsReady: allReady,
      exactOneRequestPerAsset: Object.values(exactRequests).every((count) => count === 1),
      normalEquipAndUsePassed: normalUsePassed,
      endedHandsFree: final.tool === null && !final.spraying,
      noListenerGrowth: countersAfter.jsEventListeners <= countersBefore.jsEventListeners,
      noConsoleOrPageErrors: errors.length === 0,
      noNonBenignWarnings: nonBenignWarnings.length === 0,
      noTargetRequestFailures: failedRequests.every((entry) => (
        !targetPaths.some((target) => entry.url.endsWith(target))
      )),
    },
  };
  fs.writeFileSync(path.join(outDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  return {
    ok: Object.values(report.checks).every(Boolean),
    outDir,
    ...report,
  };
}
