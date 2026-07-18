async (page) => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const crypto = await import('node:crypto');
  const { pathToFileURL } = await import('node:url');
  const {
    CASHIER_BUILD_SNAPSHOT_SCHEMA_VERSION,
    captureCashierBuildSnapshot,
    compareCashierBuildSnapshots,
  } = await import(pathToFileURL(
    path.resolve('tools/qa/cashier-build-snapshot.mjs'),
  ).href);

  const productionBuildBefore = captureCashierBuildSnapshot();
  const sha256Pattern = /^[a-f0-9]{64}$/;
  const compareHashMaps = (expected, current) => {
    const expectedMap = expected && typeof expected === 'object' && !Array.isArray(expected)
      ? expected : {};
    const currentMap = current && typeof current === 'object' && !Array.isArray(current)
      ? current : {};
    const changedFiles = [];
    for (const file of [...new Set([
      ...Object.keys(expectedMap),
      ...Object.keys(currentMap),
    ])].sort()) {
      if (expectedMap[file] === currentMap[file]) continue;
      changedFiles.push({
        path: file,
        change: !(file in expectedMap) ? 'added'
          : !(file in currentMap) ? 'removed' : 'modified',
        expectedSha256: expectedMap[file] || null,
        currentSha256: currentMap[file] || null,
      });
    }
    return { unchanged: changedFiles.length === 0, changedFiles };
  };

  const rawPath = path.resolve(
    process.env.REGISTER_PERF_RESULT
      || 'qa/cashier_master_final/performance/final/simplified-register-performance.json',
  );
  if (!fs.existsSync(rawPath)) throw new Error(`Performance JSON does not exist: ${rawPath}`);
  const rawBytes = fs.readFileSync(rawPath);
  const result = JSON.parse(rawBytes.toString('utf8'));
  if (!result?.scenes?.activeMonitor || !result?.gates || !result?.protocol) {
    throw new Error('Performance JSON is missing the active-monitor, protocol, or gate envelope.');
  }
  if (result.protocol.profile !== 'master') {
    throw new Error(`Capture #38 requires an authoritative master profile; got ${result.protocol.profile}.`);
  }
  if (result.schemaValidation?.valid !== true) {
    throw new Error('Capture #38 requires a schema-valid authoritative performance result.');
  }
  if (result.ok !== true || result.gates.pass !== true
      || Object.values(result.gates.details || {}).some((entry) => entry?.pass !== true)) {
    throw new Error('Capture #38 requires an authoritative master PASS with every gate passing.');
  }
  const authoritativeBuild = result.productionBuildSnapshot;
  const authoritativeHashes = result.productionBuildHashes;
  const authoritativeHashEntries = authoritativeHashes
    && typeof authoritativeHashes === 'object' && !Array.isArray(authoritativeHashes)
    ? Object.entries(authoritativeHashes) : [];
  if (!authoritativeBuild
      || authoritativeBuild.schemaVersion !== CASHIER_BUILD_SNAPSHOT_SCHEMA_VERSION
      || authoritativeBuild.algorithm !== 'sha256'
      || authoritativeBuild.unchanged !== true
      || !Array.isArray(authoritativeBuild.changedFiles)
      || authoritativeBuild.changedFiles.length !== 0
      || authoritativeBuild.beforeAggregateHash !== authoritativeBuild.afterAggregateHash
      || authoritativeBuild.beforeFileCount !== authoritativeBuild.afterFileCount
      || authoritativeBuild.beforeFileCount !== authoritativeHashEntries.length
      || authoritativeHashEntries.length === 0
      || authoritativeHashEntries.some(([file, hash]) => !file || !sha256Pattern.test(hash || ''))
      || result.gates.details?.productionBuildUnchanged?.pass !== true) {
    throw new Error(
      `Capture #38 requires a complete unchanged cashier production snapshot v${CASHIER_BUILD_SNAPSHOT_SCHEMA_VERSION}.`,
    );
  }
  const initialAuthoritativeComparison = compareHashMaps(
    authoritativeHashes,
    productionBuildBefore.productionBuildHashes,
  );
  if (!initialAuthoritativeComparison.unchanged
      || productionBuildBefore.aggregateHash !== authoritativeBuild.afterAggregateHash
      || productionBuildBefore.fileCount !== authoritativeBuild.afterFileCount) {
    throw new Error(`Capture #38 current production build does not match the master run: ${
      initialAuthoritativeComparison.changedFiles
        .map((entry) => `${entry.change}:${entry.path}`).join(', ') || 'aggregate mismatch'
    }.`);
  }

  const outputPath = path.resolve(
    process.env.REGISTER_PERF_OVERLAY_OUT
      || path.join(path.dirname(rawPath), 'performance-overlay.png'),
  );
  const provenancePath = path.resolve(
    process.env.REGISTER_PERF_OVERLAY_PROVENANCE
      || path.join(path.dirname(outputPath), 'performance-overlay-provenance.json'),
  );
  const backgroundPath = path.resolve(path.dirname(rawPath), result.scenes.activeMonitor.screenshot);
  if (!fs.existsSync(backgroundPath)) {
    throw new Error(`Measured active-register screenshot does not exist: ${backgroundPath}`);
  }
  const backgroundBytes = fs.readFileSync(backgroundPath);

  const finite = (value) => (
    value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value)
  );
  const active = result.scenes.activeMonitor;
  const dynamicEntries = Object.entries(result.dynamicPhases || {})
    .filter(([, phase]) => finite(phase?.aggregate?.p99FrameMs) != null);
  const worstDynamic = dynamicEntries.sort(
    ([, left], [, right]) => right.aggregate.p99FrameMs - left.aggregate.p99FrameMs,
  )[0] || [null, null];
  const dynamicWindows = Object.values(result.dynamicWindows || {});
  const longTaskCount = dynamicWindows.reduce(
    (sum, window) => sum + (finite(window?.longTasks?.count) || 0),
    0,
  );
  const longTaskDurationMs = dynamicWindows.reduce(
    (sum, window) => sum + (finite(window?.longTasks?.totalDurationMs) || 0),
    0,
  );
  const gateEntries = Object.entries(result.gates.details || {});
  const failedGates = gateEntries.filter(([, gate]) => !gate.pass).map(([name]) => name);
  const gateGroup = (names) => {
    const entries = names
      .filter((name) => result.gates.details?.[name])
      .map((name) => ({ name, ...result.gates.details[name] }));
    return {
      status: entries.length === 0 ? 'MISSING' : entries.every((entry) => entry.pass) ? 'PASS' : 'FAIL',
      passed: entries.filter((entry) => entry.pass).length,
      total: entries.length,
      entries,
    };
  };
  const repeat = result.transactionStability?.repeatSaleDelta || {};
  const reentry = result.reentryLeak?.delta || {};
  const live = active.liveSceneResources || {};
  const baseline = result.storedBaselineComparison || {};
  const baselineRows = Array.isArray(baseline.rows) ? baseline.rows : [];
  for (const requiredMetric of ['avgFps', 'p99FrameMs', 'worstFrameMs', 'drawCalls']) {
    if (!baselineRows.some((entry) => entry.scene === 'activeMonitor' && entry.metric === requiredMetric)) {
      throw new Error(`Capture #38 requires active-monitor stored before/current metric ${requiredMetric}.`);
    }
  }
  const baselineMetric = (metric) => {
    const row = baselineRows.find((entry) => entry.scene === 'activeMonitor' && entry.metric === metric);
    return row ? {
      before: finite(row.before),
      current: finite(row.after),
      absolute: finite(row.absolute),
      percent: finite(row.percent),
      pass: row.pass,
      diagnosticOnly: !!row.diagnosticOnly,
      units: row.units,
    } : null;
  };
  const baselineStatus = !baseline.available
    ? 'MISSING'
    : !baseline.qualified
      ? 'UNJUDGED'
      : baseline.pass ? 'PASS' : 'FAIL';
  const sourceHashes = Object.fromEntries((result.build?.measuredFiles || [])
    .filter((entry) => entry?.path && entry?.sha256)
    .map((entry) => [entry.path, entry.sha256]));
  const model = {
    verdict: result.gates.pass ? 'PASS' : 'FAIL',
    generatedAt: result.generatedAt,
    schemaVersion: result.schemaVersion,
    profile: result.protocol.profile,
    viewport: `${result.protocol.viewport.width}x${result.protocol.viewport.height}`,
    buildHead: result.build?.head || 'unavailable',
    sourceHashes,
    baseline: {
      status: baselineStatus,
      available: !!baseline.available,
      qualified: !!baseline.qualified,
      reason: baseline.reason || null,
      beforeGeneratedAt: baseline.baselineGeneratedAt || null,
      currentGeneratedAt: baseline.currentGeneratedAt || result.generatedAt,
      provenance: baseline.provenance || null,
      avgFps: baselineMetric('avgFps'),
      p99FrameMs: baselineMetric('p99FrameMs'),
      worstFrameMs: baselineMetric('worstFrameMs'),
      drawCalls: baselineMetric('drawCalls'),
      renderedTriangles: baselineMetric('renderedTriangles'),
      visibleTextures: baselineMetric('visibleTextures'),
      postGcHeapMiB: baselineMetric('postGcHeapMiB'),
    },
    active: {
      avgFps: finite(active.aggregate.avgFps),
      onePercentLowFps: finite(active.aggregate.onePercentLowFps),
      p95FrameMs: finite(active.aggregate.p95FrameMs),
      p99FrameMs: finite(active.aggregate.p99FrameMs),
      worstFrameMs: finite(active.aggregate.worstFrameMs),
      calls: finite(active.render.drawCalls),
      triangles: finite(active.render.renderedTriangles),
      visibleGeometries: finite(active.render.uniqueVisibleGeometries),
      visibleMaterials: finite(active.render.uniqueVisibleMaterials),
      visibleTextures: finite(active.render.uniqueVisibleTextures),
      estimatedVisibleTextureMiB: finite(active.render.estimatedVisibleTextureMiB),
      rendererGeometries: finite(live.rendererMemory?.geometries),
      rendererTextures: finite(live.rendererMemory?.textures),
      postGcHeapMiB: finite(active.heap?.jsHeapUsedMiB),
    },
    worstDynamic: worstDynamic[1] ? {
      key: worstDynamic[0],
      label: worstDynamic[1].label,
      avgFps: finite(worstDynamic[1].aggregate.avgFps),
      p95FrameMs: finite(worstDynamic[1].aggregate.p95FrameMs),
      p99FrameMs: finite(worstDynamic[1].aggregate.p99FrameMs),
      worstFrameMs: finite(worstDynamic[1].aggregate.worstFrameMs),
    } : null,
    longTasks: {
      count: longTaskCount,
      totalDurationMs: Number(longTaskDurationMs.toFixed(3)),
      sourceWindows: dynamicWindows.length,
    },
    repeatSale: {
      postGcHeapMiB: finite(repeat.postGcHeapMiB),
      listeners: finite(repeat.listeners),
      domElements: finite(repeat.domElements),
      liveResources: [repeat.liveGeometries, repeat.liveMaterials, repeat.liveTextures]
        .map(finite),
      rendererResources: [repeat.rendererGeometries, repeat.rendererTextures]
        .map(finite),
    },
    reentry: {
      cycles: finite(result.protocol.reentryCycles),
      heapMiB: finite(reentry.heapMiB),
      listeners: finite(reentry.listeners),
      domElements: finite(reentry.domElements),
      liveResources: [reentry.liveGeometries, reentry.liveMaterials, reentry.liveTextures]
        .map(finite),
      rendererResources: [reentry.rendererGeometries, reentry.rendererTextures]
        .map(finite),
    },
    gates: {
      passed: gateEntries.length - failedGates.length,
      total: gateEntries.length,
      failed: failedGates,
      frameTails: gateGroup([
        'everyWorkspaceAverageFps', 'everyWorkspaceWorstFrame',
        'dynamic_dynamicAverageFps', 'dynamic_dynamicP99Frame', 'dynamic_dynamicWorstFrame',
      ]),
      gpuResources: gateGroup([
        'reentryRendererMemory', 'reentryLiveResources',
        'dynamic_transactionRendererResidency', 'dynamic_transactionLiveResources',
        'dynamic_storedBaseline',
      ]),
      reentry: gateGroup([
        'reentryHeap', 'reentryListeners', 'reentryDom',
        'reentryLiveResources', 'reentryRendererMemory',
      ]),
      repeatSale: gateGroup([
        'dynamic_transactionPostGcHeap', 'dynamic_transactionResetState',
        'dynamic_transactionListeners', 'dynamic_transactionDom',
        'dynamic_transactionSceneNodes', 'dynamic_transactionLiveResources',
        'dynamic_transactionRendererResidency',
      ]),
    },
    gpuQualification: 'No direct GPU timer in the authoritative master protocol; draw calls, triangles, visible resources, estimated texture size, and renderer residency are measured GPU-work proxies.',
  };

  const viewport = {
    width: Number(result.protocol.viewport.width) || 1600,
    height: Number(result.protocol.viewport.height) || 900,
  };
  await page.setViewportSize(viewport);
  await page.setContent('<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>');
  await page.evaluate(({ overlay, backgroundData }) => {
    const value = (number, suffix = '') => number == null ? 'n/a' : `${number}${suffix}`;
    const integer = (number) => number == null ? 'n/a' : Math.round(number).toLocaleString('en-US');
    const pair = (metric, suffix = '') => metric
      ? `${value(metric.before)} -> ${value(metric.current)}${suffix}`
      : 'n/a';
    const gateStatus = (group) => `${group.status} (${group.passed}/${group.total})`;
    const shortHash = (hash) => hash ? hash.slice(0, 10) : 'unavailable';
    const row = (label, content) => {
      const element = document.createElement('div');
      element.className = 'metric-row';
      const name = document.createElement('span');
      name.textContent = label;
      const metric = document.createElement('strong');
      metric.textContent = content;
      element.append(name, metric);
      return element;
    };
    const heading = (content) => {
      const element = document.createElement('h2');
      element.textContent = content;
      return element;
    };

    document.documentElement.style.cssText = 'width:100%;height:100%;background:#101713;';
    document.body.style.cssText = [
      'width:100%', 'height:100%', 'margin:0', 'overflow:hidden',
      `background-image:linear-gradient(90deg,rgba(7,12,9,.22),rgba(7,12,9,.04)),url(${backgroundData})`,
      'background-size:cover', 'background-position:center',
      'font-family:Inter,Segoe UI,Arial,sans-serif', 'color:#f5f0df',
    ].join(';');

    const panel = document.createElement('section');
    panel.id = 'qa-performance-overlay';
    panel.dataset.qaOnly = 'true';
    panel.style.cssText = [
      'position:absolute', 'left:32px', 'top:28px', 'width:min(620px,calc(100vw - 64px))',
      'box-sizing:border-box', 'padding:24px 26px 20px',
      'background:linear-gradient(160deg,rgba(20,45,34,.96),rgba(16,25,21,.94))',
      'border:1px solid rgba(210,181,105,.64)', 'border-radius:16px',
      'box-shadow:0 22px 70px rgba(0,0,0,.55)', 'backdrop-filter:blur(8px)',
    ].join(';');
    const titleRow = document.createElement('div');
    titleRow.style.cssText = 'display:flex;align-items:flex-start;justify-content:space-between;gap:18px;';
    const titles = document.createElement('div');
    const eyebrow = document.createElement('div');
    eyebrow.textContent = 'QA-ONLY | MEASURED CURRENT SOURCE';
    eyebrow.style.cssText = 'font-size:11px;letter-spacing:.16em;color:#c9b77c;font-weight:700;';
    const title = document.createElement('h1');
    title.textContent = 'Checkout performance';
    title.style.cssText = 'margin:5px 0 0;font-size:28px;line-height:1.05;font-weight:720;';
    const meta = document.createElement('div');
    meta.textContent = `${overlay.profile} | ${overlay.viewport} | schema v${overlay.schemaVersion}`;
    meta.style.cssText = 'margin-top:7px;color:#b7c8bd;font-size:12px;';
    titles.append(eyebrow, title, meta);
    const verdict = document.createElement('div');
    verdict.textContent = overlay.verdict;
    verdict.style.cssText = [
      'padding:9px 13px', 'border-radius:999px', 'font-weight:800', 'letter-spacing:.08em',
      overlay.verdict === 'PASS'
        ? 'background:#b8cf88;color:#132018;border:1px solid #d9e7b5'
        : 'background:#d98772;color:#27100b;border:1px solid #f0b2a3',
    ].join(';');
    titleRow.append(titles, verdict);
    panel.append(titleRow);

    const style = document.createElement('style');
    style.textContent = `
      #qa-performance-overlay h2 { margin:17px 0 8px; padding-top:12px; border-top:1px solid rgba(219,205,164,.18); color:#d8c58b; font-size:12px; letter-spacing:.12em; text-transform:uppercase; }
      #qa-performance-overlay .metrics { display:grid; grid-template-columns:1fr 1fr; column-gap:24px; }
      #qa-performance-overlay .metric-row { display:flex; justify-content:space-between; gap:12px; padding:4px 0; font-size:13px; color:#b9c7be; }
      #qa-performance-overlay .metric-row strong { color:#f5f0df; font-variant-numeric:tabular-nums; font-weight:650; text-align:right; }
    `;
    document.head.append(style);

    panel.append(heading(`Stored before -> current | ${overlay.baseline.status}`));
    const baselineGrid = document.createElement('div');
    baselineGrid.className = 'metrics';
    baselineGrid.append(
      row('Average FPS', pair(overlay.baseline.avgFps, ' FPS')),
      row('p99 frame', pair(overlay.baseline.p99FrameMs, ' ms')),
      row('Worst frame', pair(overlay.baseline.worstFrameMs, ' ms')),
      row('Draw calls', pair(overlay.baseline.drawCalls)),
    );
    panel.append(baselineGrid);

    panel.append(heading('Current active register monitor'));
    const activeGrid = document.createElement('div');
    activeGrid.className = 'metrics';
    activeGrid.append(
      row('Average / 1% low', `${value(overlay.active.avgFps)} / ${value(overlay.active.onePercentLowFps)} FPS`),
      row('p95 / p99', `${value(overlay.active.p95FrameMs)} / ${value(overlay.active.p99FrameMs)} ms`),
      row('Worst frame', value(overlay.active.worstFrameMs, ' ms')),
      row('Calls / triangles', `${integer(overlay.active.calls)} / ${integer(overlay.active.triangles)}`),
      row('Visible G / M / T', `${value(overlay.active.visibleGeometries)} / ${value(overlay.active.visibleMaterials)} / ${value(overlay.active.visibleTextures)}`),
      row('Renderer G / T', `${value(overlay.active.rendererGeometries)} / ${value(overlay.active.rendererTextures)}`),
      row('Visible texture estimate', value(overlay.active.estimatedVisibleTextureMiB, ' MiB')),
      row('Post-GC JS heap', value(overlay.active.postGcHeapMiB, ' MiB')),
      row('Long tasks', `${overlay.longTasks.count} (${value(overlay.longTasks.totalDurationMs, ' ms')})`),
      row('Direct GPU timer', 'not exposed; proxies shown'),
    );
    panel.append(activeGrid);

    if (overlay.worstDynamic) {
      panel.append(heading(`Worst dynamic p99 | ${overlay.worstDynamic.key}`));
      const dynamicGrid = document.createElement('div');
      dynamicGrid.className = 'metrics';
      dynamicGrid.append(
        row('Average FPS', value(overlay.worstDynamic.avgFps)),
        row('p95 / p99', `${value(overlay.worstDynamic.p95FrameMs)} / ${value(overlay.worstDynamic.p99FrameMs)} ms`),
        row('Worst frame', value(overlay.worstDynamic.worstFrameMs, ' ms')),
        row('Measured windows', String(overlay.longTasks.sourceWindows)),
      );
      panel.append(dynamicGrid);
    }

    panel.append(heading('Re-entry and repeat-sale stability'));
    const stabilityGrid = document.createElement('div');
    stabilityGrid.className = 'metrics';
    stabilityGrid.append(
      row(`Re-entry heap d (${value(overlay.reentry.cycles)}x)`, value(overlay.reentry.heapMiB, ' MiB')),
      row('Re-entry listener / DOM d', `${value(overlay.reentry.listeners)} / ${value(overlay.reentry.domElements)}`),
      row('Repeat-sale heap d', value(overlay.repeatSale.postGcHeapMiB, ' MiB')),
      row('Repeat listener / DOM d', `${value(overlay.repeatSale.listeners)} / ${value(overlay.repeatSale.domElements)}`),
      row('Repeat live G / M / T d', overlay.repeatSale.liveResources.map((entry) => value(entry)).join(' / ')),
      row('Repeat renderer G / T d', overlay.repeatSale.rendererResources.map((entry) => value(entry)).join(' / ')),
    );
    panel.append(stabilityGrid);

    panel.append(heading('Gate groups'));
    const gateGrid = document.createElement('div');
    gateGrid.className = 'metrics';
    gateGrid.append(
      row('Frame tails', gateStatus(overlay.gates.frameTails)),
      row('GPU/resource proxies', gateStatus(overlay.gates.gpuResources)),
      row('Re-entry', gateStatus(overlay.gates.reentry)),
      row('Repeat sale', gateStatus(overlay.gates.repeatSale)),
    );
    panel.append(gateGrid);

    const footer = document.createElement('div');
    const modeHash = overlay.sourceHashes['src/render3d/clubhouse/simplifiedRegisterMode.js'];
    const driverHash = overlay.sourceHashes['tools/qa/simplified-register-performance.mjs'];
    const failures = overlay.gates.failed.length
      ? ` | failed: ${overlay.gates.failed.slice(0, 3).join(', ')}`
      : '';
    footer.textContent = `${overlay.gates.passed}/${overlay.gates.total} gates passed${failures} | mode ${shortHash(modeHash)} | driver ${shortHash(driverHash)} | raw JSON is authoritative | ${overlay.generatedAt}`;
    footer.style.cssText = 'margin-top:17px;padding-top:12px;border-top:1px solid rgba(219,205,164,.18);font-size:11px;color:#95a79c;';
    panel.append(footer);
    document.body.append(panel);
  }, {
    overlay: model,
    backgroundData: `data:image/png;base64,${backgroundBytes.toString('base64')}`,
  });

  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.waitForTimeout(150);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  await page.screenshot({ path: outputPath });

  const productionBuildAfter = captureCashierBuildSnapshot({ allowMissing: true });
  const overlayBuildComparison = compareCashierBuildSnapshots(
    productionBuildBefore,
    productionBuildAfter,
  );
  const finalAuthoritativeComparison = compareHashMaps(
    authoritativeHashes,
    productionBuildAfter.productionBuildHashes,
  );
  if (!overlayBuildComparison.unchanged || !finalAuthoritativeComparison.unchanged
      || productionBuildAfter.aggregateHash !== authoritativeBuild.afterAggregateHash
      || productionBuildAfter.fileCount !== authoritativeBuild.afterFileCount) {
    const changes = [
      ...overlayBuildComparison.changedFiles,
      ...finalAuthoritativeComparison.changedFiles,
    ];
    throw new Error(`Capture #38 production build changed during overlay generation: ${
      [...new Map(changes.map((entry) => [entry.path, entry])).values()]
        .map((entry) => `${entry.change}:${entry.path}`).join(', ') || 'aggregate mismatch'
    }.`);
  }

  const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
  const overlayToolPath = path.resolve('tools/qa/simplified-register-performance-overlay.js');
  const overlayToolBytes = fs.readFileSync(overlayToolPath);
  const outputBytes = fs.readFileSync(outputPath);
  const provenance = {
    kind: 'temporary QA-only performance overlay; no production UI was added',
    generatedAt: new Date().toISOString(),
    authority: 'The performance JSON is authoritative. The PNG is a presentation of selected JSON fields over the gameplay screenshot captured by that same run.',
    authoritativeMetrics: {
      path: rawPath,
      sha256: sha256(rawBytes),
      measuredAt: result.generatedAt,
      build: result.build,
      jsonPaths: {
        activeFrames: 'scenes.activeMonitor.aggregate',
        activeRender: 'scenes.activeMonitor.render',
        activeResources: 'scenes.activeMonitor.liveSceneResources',
        activeHeap: 'scenes.activeMonitor.heap',
        storedBeforeCurrent: 'storedBaselineComparison.rows[scene=activeMonitor]',
        dynamicFrames: 'dynamicPhases.*.aggregate',
        longTasks: 'dynamicWindows.*.longTasks',
        reentry: 'reentryLeak.delta',
        repeatSale: 'transactionStability.repeatSaleDelta',
        sourceHashes: 'build.measuredFiles',
        productionBuildHashes: 'productionBuildHashes',
        productionBuildSnapshot: 'productionBuildSnapshot',
        verdict: 'gates',
      },
    },
    gates: {
      authoritativeMasterPass: true,
      authoritativeProductionBuildUnchanged: true,
      currentProductionBuildMatches: true,
      overlayProductionBuildUnchanged: true,
    },
    productionBuildHashes: { ...productionBuildBefore.productionBuildHashes },
    productionBuildSnapshot: {
      schemaVersion: productionBuildBefore.schemaVersion,
      algorithm: productionBuildBefore.algorithm,
      beforeCapturedAt: productionBuildBefore.capturedAt,
      afterCapturedAt: productionBuildAfter.capturedAt,
      authoritativeBeforeCapturedAt: authoritativeBuild.beforeCapturedAt,
      authoritativeAfterCapturedAt: authoritativeBuild.afterCapturedAt,
      authoritativeAggregateHash: authoritativeBuild.afterAggregateHash,
      authoritativeFileCount: authoritativeBuild.afterFileCount,
      currentMatchesAuthoritative: true,
      ...overlayBuildComparison,
    },
    storedBaseline: {
      status: model.baseline.status,
      qualified: model.baseline.qualified,
      generatedAt: model.baseline.beforeGeneratedAt,
      provenance: model.baseline.provenance,
    },
    gameplayBackground: {
      path: backgroundPath,
      sha256: sha256(backgroundBytes),
      source: 'active-register screenshot captured inside the same authoritative performance run',
    },
    overlayTool: {
      path: overlayToolPath,
      sha256: sha256(overlayToolBytes),
    },
    output: {
      path: outputPath,
      sha256: sha256(outputBytes),
      viewport,
    },
    gpuQualification: model.gpuQualification,
    allGateDetails: result.gates.details,
    overlayModel: model,
  };
  fs.writeFileSync(provenancePath, `${JSON.stringify(provenance, null, 2)}\n`);
  return { ok: true, output: outputPath, provenance: provenancePath, model };
}
