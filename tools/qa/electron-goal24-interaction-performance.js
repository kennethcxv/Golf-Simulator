// Goal 24 — one reusable, real-Electron interaction performance driver.
//
// Primary (low-overhead) run:
//   node tools/qa/run-electron.cjs tools/qa/electron-goal24-interaction-performance.js \
//     --clubhouse=pine-hills-v2
//
// Useful scoped legs:
//   GOAL24_PERF_SCENARIOS=door,negative-control ...
//   GOAL24_PERF_SCENARIOS=ledger,ledger-stress ...
//   GOAL24_PERF_SCENARIOS=tool,tool-stress ...
//
// The function returns only a concise result. Raw frame arrays, renderer-clock
// markers, trusted input events, and resource checkpoints are written to the
// run JSON so runner stdout does not become the performance bottleneck.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const { randomUUID } = process.getBuiltinModule('node:crypto');
  const { performance: nodePerformance } = process.getBuiltinModule('node:perf_hooks');
  const { pathToFileURL } = process.getBuiltinModule('node:url');

  const repo = process.cwd();
  const recorder = await import(pathToFileURL(path.join(
    repo, 'tools', 'qa', 'lib', 'goal24-interaction-recorder.mjs',
  )).href);
  const resourceDiagnosticsModule = await import(pathToFileURL(path.join(
    repo, 'tools', 'qa', 'lib', 'goal24-resource-diagnostics.mjs',
  )).href);
  const gpuFrameTimingModule = await import(pathToFileURL(path.join(
    repo, 'tools', 'qa', 'lib', 'goal24-gpu-frame-timing.mjs',
  )).href);
  const doorEvidenceModule = await import(pathToFileURL(path.join(
    repo, 'tools', 'qa', 'lib', 'goal24-door-evidence.mjs',
  )).href);
  const programOwnershipModule = await import(pathToFileURL(path.join(
    repo, 'tools', 'qa', 'lib', 'goal24-program-ownership.mjs',
  )).href);
  const programOwnershipProbeSource =
    programOwnershipModule.goal24ProgramOwnershipProbeFactorySource();
  const doorDetailClearanceYards = Number(
    doorEvidenceModule.GOAL24_DOOR_DETAIL_CLEARANCE_YARDS ?? 1.5,
  );
  if (!Number.isFinite(doorDetailClearanceYards) || doorDetailClearanceYards <= 0) {
    throw new Error('Goal 24 door detail-clearance contract is unavailable.');
  }
  const visualEvidenceModule = await import(pathToFileURL(path.join(
    repo, 'tools', 'qa', 'lib', 'goal24-visual-evidence.mjs',
  )).href);
  const boot = await import(pathToFileURL(path.join(repo, 'tools', 'qa', 'lib', 'qa-boot.mjs')).href);
  const { gateRenderer } = await import(pathToFileURL(path.join(
    repo, 'tools', 'qa', 'perf-renderer-gate.mjs',
  )).href);
  const contractModule = await import(pathToFileURL(path.join(
    repo, 'tools', 'qa', 'locked-performance-contract.mjs',
  )).href);
  const toolManifestModule = await import(pathToFileURL(path.join(
    repo, 'tools', 'qa', 'lib', 'goal24-tool-manifest.mjs',
  )).href);
  const cleaningToolsModule = await import(pathToFileURL(path.join(
    repo, 'src', 'data', 'cleaningTools.js',
  )).href);
  const productionToolManifest = toolManifestModule.assertGoal24ProductionToolManifest({
    beltOrder: cleaningToolsModule.BELT_ORDER,
    cleaningTools: cleaningToolsModule.CLEANING_TOOLS,
  });
  let expectedToolManifest = toolManifestModule.GOAL24_SUPPORTED_TOOL_MANIFEST;
  if (process.env.GOAL24_PERF_TOOL_MANIFEST) {
    try {
      expectedToolManifest = JSON.parse(process.env.GOAL24_PERF_TOOL_MANIFEST);
    } catch (error) {
      throw new Error(`GOAL24_PERF_TOOL_MANIFEST is not valid JSON: ${error.message}`, {
        cause: error,
      });
    }
  }
  toolManifestModule.assertGoal24ToolManifest(expectedToolManifest);
  toolManifestModule.assertGoal24ToolManifest(productionToolManifest, expectedToolManifest);
  const supportedToolIds = [...expectedToolManifest.supportedToolIds];
  const lockedProtocol = contractModule.LOCKED_INTERACTION_PERFORMANCE_PROTOCOL;
  const contractSpecById = new Map(lockedProtocol.scenarios.map((spec) => [spec.id, spec]));
  const coldToolFirstUseBudgetMs = Number(
    lockedProtocol.thresholds?.maximumColdInteractionDurationMs?.toolFirstUseByTool,
  );
  if (!Number.isFinite(coldToolFirstUseBudgetMs) || coldToolFirstUseBudgetMs <= 0) {
    throw new Error('Locked cold tool-first-use duration budget is unavailable.');
  }
  // Let the locked six-second response gate judge a slow cold presentation.
  // A five-second observer timeout used to abort before the contract could
  // record and reject a validly observed 5-6 second regression.
  const toolPresentationObservationTimeoutMs = Math.max(
    12_000,
    coldToolFirstUseBudgetMs * 2,
  );
  const warmLedgerPageTurnBudgetMs = Number(
    lockedProtocol.thresholds?.maximumWarmInteractionDurationMs?.ledgerPageTurns10,
  );
  if (!Number.isFinite(warmLedgerPageTurnBudgetMs) || warmLedgerPageTurnBudgetMs <= 0) {
    throw new Error('Locked warm ledger-page-turn duration budget is unavailable.');
  }
  // The page-turn handler synchronously paints and uploads the next spread
  // before exposing its production turn state. A regression can therefore
  // block the renderer beyond the response budget before the observer gets a
  // polling opportunity. Keep the observer horizon well outside the locked
  // 1.5-second acceptance gate so the raw cadence records and rejects the
  // regression instead of the harness timing out first.
  const ledgerPageTurnObservationTimeoutMs = Math.max(
    12_000,
    warmLedgerPageTurnBudgetMs * 8,
  );

  const safe = (value) => String(value || '').replace(/[^a-z0-9._-]+/gi, '-').replace(/^-|-$/g, '');
  const runId = safe(process.env.GOAL24_PERF_RUN_ID
    || `${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}`);
  const sessionId = safe(process.env.GOAL24_PERF_SESSION_ID || '');
  const outRoot = path.resolve(process.env.GOAL24_PERF_OUT
    || path.join(repo, 'qa', 'goal24', 'performance', 'interaction'));
  const runDir = path.join(outRoot, runId);
  fs.mkdirSync(runDir, { recursive: true });

  const requested = new Set(String(process.env.GOAL24_PERF_SCENARIOS || 'all')
    .split(',').map((value) => value.trim().toLowerCase()).filter(Boolean));
  const wants = (...names) => requested.has('all') || names.some((name) => requested.has(name));
  const partial = !requested.has('all');
  const negativeControlStallMs = process.env.GOAL24_PERF_DISABLE_STALL_CONTROL === '1' ? 0 : 80;
  const gpuFrameTimingRequested = process.env.GOAL24_PERF_GPU_FRAME_TIMING === '1';
  const overlayRequested = process.env.GOAL24_PERF_OVERLAY === '1';
  const videoEvidenceNonce = randomUUID();
  const seed = Number(process.env.GOAL24_PERF_SEED || 424242);
  if (!Number.isInteger(seed) || seed < 0 || seed >= 0x80000000) {
    throw new Error('GOAL24_PERF_SEED must be an integer from 0 through 2147483647.');
  }
  let instrumentationMode = null;
  const report = {
    schema: 'golf-flipper-goal24-interaction-performance-raw-v1',
    capturedAtUtc: new Date().toISOString(),
    runId,
    requestedScenarios: [...requested],
    partial,
    instrumentationMode: null,
    seed,
    diagnostics: { pageErrors: [], consoleErrors: [], consoleWarnings: [] },
    controls: {},
    runner: null,
    environment: null,
    scenarios: {},
    evidence: {},
  };
  report.evidence.videoIdentity = {
    sessionId: sessionId || null,
    runId,
    videoNonce: videoEvidenceNonce,
    runnerLaunchId: null,
  };
  page.on('pageerror', (error) => report.diagnostics.pageErrors.push(String(error?.message || error)));
  page.on('console', (message) => {
    if (message.type() === 'error') report.diagnostics.consoleErrors.push(message.text());
    if (message.type() === 'warning') report.diagnostics.consoleWarnings.push(message.text());
  });

  const percentile = (sorted, fraction) => sorted.length
    ? sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))]
    : null;
  const stats = (values) => {
    const finite = (values || []).filter(Number.isFinite);
    const sorted = [...finite].sort((a, b) => a - b);
    const mean = finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : null;
    const slowCount = Math.max(1, Math.ceil(finite.length * 0.01));
    const descending = [...finite].sort((a, b) => b - a);
    const slowMean = finite.length
      ? descending.slice(0, slowCount).reduce((sum, value) => sum + value, 0) / slowCount
      : null;
    const round = (value) => Number.isFinite(value) ? +value.toFixed(3) : null;
    return {
      samples: finite.length,
      meanMs: round(mean),
      medianMs: round(percentile(sorted, 0.5)),
      p95Ms: round(percentile(sorted, 0.95)),
      p99Ms: round(percentile(sorted, 0.99)),
      worstMs: sorted.length ? round(sorted[sorted.length - 1]) : null,
      over33: finite.filter((value) => value > 33).length,
      over50: finite.filter((value) => value > 50).length,
      averageFps: mean > 0 ? round(1000 / mean) : null,
      onePercentLowFps: slowMean > 0 ? round(1000 / slowMean) : null,
    };
  };
  const enrichWindow = (window) => ({
    ...window,
    metrics: {
      displayRaf: stats(window.displayFrameIntervalsMs),
      actualRender: stats(window.renderFrameIntervalsMs),
      renderSubmissionWall: stats(window.renderSubmissionWallMs),
    },
  });
  const addWindow = (scenario, window) => {
    if (!report.scenarios[scenario]) report.scenarios[scenario] = { events: [] };
    const enriched = enrichWindow(window);
    report.scenarios[scenario].events.push(enriched);
    return enriched;
  };
  let activeGpuFrameTiming = false;
  const overlayFrameScenarios = new Set();
  const captureClosedVisualEvidence = async (scenario, event, eventIndex) => {
    if (!overlayRequested || overlayFrameScenarios.has(scenario)) return null;
    if (!sessionId || typeof runnerLaunchId !== 'string' || !runnerLaunchId) {
      throw new Error('Closed visual evidence requires session and runner launch identities.');
    }
    const source = {
      sessionId,
      runId,
      launchId: runnerLaunchId,
      videoNonce: videoEvidenceNonce,
      scenario,
      eventIndex,
      interactionId: event.id,
    };
    const payload = visualEvidenceModule.goal24VisualEvidencePayload(event, source);
    const definition = visualEvidenceModule.goal24VisualMarkerDefinition(payload);
    const shown = await page.evaluate(({ marker, evidencePayload }) => {
      if (globalThis.__goal24ClosedEvidencePanel) {
        throw new Error('A closed visual-evidence panel is already present.');
      }
      const recorderState = globalThis.__goal24InteractionRecorder?.diagnostics?.() ?? null;
      if (recorderState?.active) {
        throw new Error('Closed visual evidence cannot be shown while the recorder is active.');
      }
      const panel = document.createElement('aside');
      panel.id = 'goal24-closed-evidence-panel';
      panel.setAttribute('aria-label', 'Goal 24 closed interaction video evidence');
      Object.assign(panel.style, {
        position: 'fixed', left: '20px', top: '20px', zIndex: '2147483647',
        display: 'flex', gap: '14px', alignItems: 'flex-start',
        width: '590px', minHeight: '236px', boxSizing: 'border-box',
        padding: '16px', border: '2px solid #d8aa49', borderRadius: '8px',
        background: '#121c17', color: '#f5edda', opacity: '1',
        font: '14px/1.35 ui-monospace, SFMono-Regular, Consolas, monospace',
        pointerEvents: 'none', boxShadow: '0 5px 24px rgba(0,0,0,0.72)',
      });
      const canvas = document.createElement('canvas');
      canvas.id = 'goal24-closed-evidence-marker';
      canvas.width = 200;
      canvas.height = 200;
      Object.assign(canvas.style, {
        width: '200px', height: '200px', flex: '0 0 200px',
        imageRendering: 'pixelated', background: '#121c17',
      });
      const context = canvas.getContext('2d', { alpha: false });
      context.imageSmoothingEnabled = false;
      const moduleSize = canvas.width / marker.gridSize;
      for (let y = 0; y < marker.gridSize; y += 1) {
        for (let x = 0; x < marker.gridSize; x += 1) {
          const color = marker.cells[y * marker.gridSize + x];
          context.fillStyle = `rgb(${color[0]},${color[1]},${color[2]})`;
          context.fillRect(x * moduleSize, y * moduleSize, moduleSize, moduleSize);
        }
      }
      const text = document.createElement('pre');
      text.id = 'goal24-closed-evidence-text';
      Object.assign(text.style, {
        margin: '0', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', flex: '1 1 auto',
      });
      text.textContent = [
        'GOAL 24 — CLOSED EVENT VIDEO PROOF (NOT GRADED)',
        `scenario: ${evidencePayload.source.scenario}`,
        `interaction: ${evidencePayload.source.interactionId}`,
        `state/repetition: ${evidencePayload.thermalState}/${evidencePayload.repetition}`,
        `duration: ${evidencePayload.durationMs.toFixed(3)} ms`,
        `display p95/worst: ${evidencePayload.metrics.displayRaf.p95Ms}/${evidencePayload.metrics.displayRaf.worstMs} ms`,
        `render p95/worst: ${evidencePayload.metrics.actualRender.p95Ms}/${evidencePayload.metrics.actualRender.worstMs} ms`,
        `submission p95/worst: ${evidencePayload.metrics.renderSubmissionWall.p95Ms}/${evidencePayload.metrics.renderSubmissionWall.worstMs} ms`,
        `peak non-shadow draw/tri: ${evidencePayload.renderer.peakNonShadowDrawCalls}/${evidencePayload.renderer.peakNonShadowRenderedTriangles}`,
        `digest: ${marker.digest}`,
      ].join('\n');
      panel.append(canvas, text);
      document.body.append(panel);
      const shownAtMs = performance.now();
      let presentedRafCount = 0;
      let rafId = 0;
      const countFrame = () => {
        presentedRafCount += 1;
        rafId = requestAnimationFrame(countFrame);
      };
      rafId = requestAnimationFrame(countFrame);
      const rectangle = (element) => {
        const rect = element.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      };
      const rolling = document.getElementById('goal24-performance-overlay');
      globalThis.__goal24ClosedEvidencePanel = {
        panel,
        canvas,
        shownAtMs,
        get presentedRafCount() { return presentedRafCount; },
        snapshot() {
          return {
            shownAtMs,
            sampledAtMs: performance.now(),
            presentedRafCount,
            panelRect: rectangle(panel),
            markerRect: rectangle(canvas),
            rollingOverlayRect: rolling ? rectangle(rolling) : null,
            viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
            markerDigest: marker.digest,
            text: text.textContent,
            recorderActive: recorderState?.active === true,
          };
        },
        remove() {
          cancelAnimationFrame(rafId);
          const before = this.snapshot();
          panel.remove();
          delete globalThis.__goal24ClosedEvidencePanel;
          return { ...before, hiddenAtMs: performance.now(), removed: true };
        },
      };
      return globalThis.__goal24ClosedEvidencePanel.snapshot();
    }, { marker: definition, evidencePayload: payload });
    await page.waitForFunction(() => (
      globalThis.__goal24ClosedEvidencePanel?.presentedRafCount >= 6
    ), null, { timeout: 3000 });
    const screenshotRequestedAtMs = await page.evaluate(() => performance.now());
    const screenshot = path.join(
      runDir,
      `overlay-${safe(scenario)}-${String(overlayFrameScenarios.size + 1).padStart(2, '0')}.png`,
    );
    await page.screenshot({ path: screenshot, fullPage: false });
    const screenshotCompletedAtMs = await page.evaluate(() => performance.now());
    const minimumHiddenAtMs = shown.shownAtMs + 1200;
    const remainingDwellMs = Math.max(0, minimumHiddenAtMs - screenshotCompletedAtMs);
    if (remainingDwellMs > 0) await page.waitForTimeout(remainingDwellMs);
    await page.waitForFunction(() => (
      globalThis.__goal24ClosedEvidencePanel?.presentedRafCount >= 12
    ), null, { timeout: 3000 });
    const hidden = await page.evaluate(() => globalThis.__goal24ClosedEvidencePanel.remove());
    const frame = {
      schema: 'golf-flipper/goal24-closed-visual-frame/v1',
      scenario,
      interactionId: event.id,
      eventIndex,
      capturePhase: 'after-recorder-detach-closed-event-outside-graded-timing',
      payload,
      digest: definition.digest,
      text: shown.text,
      markerRect: shown.markerRect,
      panelRect: shown.panelRect,
      rollingOverlayRect: shown.rollingOverlayRect,
      viewport: shown.viewport,
      shownAtMs: shown.shownAtMs,
      screenshotRequestedAtMs,
      screenshotCompletedAtMs,
      hiddenAtMs: hidden.hiddenAtMs,
      dwellDurationMs: hidden.hiddenAtMs - shown.shownAtMs,
      presentedRafCount: hidden.presentedRafCount,
      recorderActiveAtShow: shown.recorderActive,
      removed: hidden.removed,
      screenshot,
    };
    report.evidence.overlayFrames ??= [];
    report.evidence.overlayFrames.push(frame);
    overlayFrameScenarios.add(scenario);
    return frame;
  };
  const begin = async (
    id,
    scenario,
    repetition = 1,
    thermalState = 'warm',
    maxDurationMs = 15_000,
  ) => {
    const opened = await recorder.beginInteractionWindow(page, {
      id,
      scenario,
      repetition,
      thermalState,
      instrumentationMode,
      maxDurationMs,
    });
    const overlayObservation = overlayRequested ? await page.evaluate((expectedScenario) => {
      const overlay = globalThis.__goal24PerformanceOverlay;
      const recorderState = globalThis.__goal24InteractionRecorder?.diagnostics?.() ?? null;
      const observation = overlay?.updateNow?.() ?? null;
      const visibleText = document.getElementById('goal24-performance-overlay')?.textContent || '';
      if (observation?.seenInteractionLabels?.includes(expectedScenario) !== true
        || !visibleText.includes(`interaction: ${expectedScenario}`)) {
        throw new Error(`Diagnostic overlay did not synchronously observe ${expectedScenario}: `
          + JSON.stringify({ recorderState, observation, visibleText }));
      }
      return observation;
    }, scenario) : null;
    const armed = await recorder.awaitInteractionRenders(page, 3, 3000);
    if (!armed.ok) throw new Error(`Recorder did not observe production renders for ${id}.`);
    const measurementBoundary = await recorder.restartInteractionMeasurement(
      page,
      'measurement-armed-after-three-production-renders',
    );
    if (activeGpuFrameTiming) {
      await page.evaluate((metadata) => {
        globalThis.__goal24GpuFrameTimingMetadata = metadata;
      }, {
        scenario,
        label: id,
        mode: instrumentationMode,
        qualityPreset: process.env.GOAL24_PERF_QUALITY || null,
      });
    }
    return { ...opened, armed, measurementBoundary, overlayObservation };
  };
  const end = async (scenario, discriminator) => {
    const outcomeMarker = await recorder.markInteraction(page, 'production-outcome-observed', {
      sourceObservedAtMs: discriminator?.outcomeObservedAtMs ?? null,
      productionConsumptionAtMs: discriminator?.productionHandlerConsumed?.atMs ?? null,
    });
    // A healthy doorway route can now finish in only a handful of frames. The
    // door evidence statistic intentionally excludes its first sample and all
    // shadow-bake frames, so two generic tail renders can leave fewer than two
    // eligible samples and reject the *fast* path for being fast. Retain eight
    // exact shipping frames after a door outcome; this does not alter the
    // already-captured route signature, and it leaves enough non-shadow work
    // for the lower-median draw/submit comparison at the 10 Hz shadow cadence.
    const doorwayRenderEvidenceRequired = scenario === 'doorApproach'
      || scenario.startsWith('doorCrossing:');
    const postOutcomeRenderCount = doorwayRenderEvidenceRequired ? 8 : 2;
    const postOutcomeRenders = await recorder.awaitInteractionRenders(
      page,
      postOutcomeRenderCount,
      3000,
    );
    if (!postOutcomeRenders.ok) {
      throw new Error(`Recorder did not observe post-outcome renders for ${scenario}.`);
    }
    const endBoundaryMarker = await recorder.markInteraction(
      page,
      'post-outcome-render-boundary',
      postOutcomeRenders,
    );
    const rawWindow = await recorder.endInteractionWindow(page, {
      ...discriminator,
      productionOutcomeMarkerAtMs: outcomeMarker.atMs,
      contractOutcomeMarkerAtMs: endBoundaryMarker.atMs,
      postOutcomeRenders,
      postOutcomeRenderCount,
    });
    if (activeGpuFrameTiming) {
      await page.evaluate(() => { globalThis.__goal24GpuFrameTimingMetadata = null; });
    }
    const event = addWindow(scenario, rawWindow);
    const eventIndex = report.scenarios[scenario].events.length - 1;
    await captureClosedVisualEvidence(scenario, event, eventIndex);
    return event;
  };
  const mark = (label, detail = null) => recorder.markInteraction(page, label, detail);
  const requestInput = (kind, control, detail = null) => recorder.recordDriverInputRequest(page, {
    kind,
    control,
    source: 'driver-immediately-before-Playwright-input-call',
    detail,
  });
  const sleep = (ms) => page.waitForTimeout(ms);
  const binding = async (action, fallback) => page.evaluate(
    ({ wanted, defaultKey }) => window.__fw?.preferences?.values?.controls?.bindings?.[wanted]
      || defaultKey,
    { wanted: action, defaultKey: fallback },
  );
  const trustedKeyCount = (window, key) => (window.inputEvents || []).filter((event) => (
    event.type === 'keydown' && event.isTrusted && String(event.key).toLowerCase() === String(key).toLowerCase()
  )).length;
  const sampleDisplayCadence = (durationMs) => page.evaluate((duration) => new Promise((resolve) => {
    const capacity = Math.ceil(duration / 1000 * 500) + 32;
    const values = new Float64Array(capacity);
    let count = 0;
    let dropped = 0;
    let last = null;
    const started = performance.now();
    const tick = (timestamp) => {
      if (last != null) {
        if (count < values.length) values[count++] = timestamp - last;
        else dropped += 1;
      }
      last = timestamp;
      if (performance.now() - started < duration) requestAnimationFrame(tick);
      else resolve({
        durationMs: performance.now() - started,
        intervalsMs: Array.from(values.subarray(0, count)),
        dropped,
      });
    };
    requestAnimationFrame(tick);
  }), durationMs);

  const requestedResolution = /^(\d+)x(\d+)$/i.exec(process.env.GOAL24_PERF_RESOLUTION || '1920x1080');
  const viewport = requestedResolution
    ? { width: Number(requestedResolution[1]), height: Number(requestedResolution[2]) }
    : { width: 1920, height: 1080 };

  // The runner does not invoke this driver until the shipping menu is ready.
  // Verify the same player-facing milestone, then use the runner's monotonic
  // process/launch anchors; the page recorder cannot honestly measure time
  // before a renderer context exists.
  await page.waitForFunction(() => {
    const button = [...document.querySelectorAll('button')]
      .find((candidate) => /new game/i.test(candidate.textContent || ''));
    return !!button && !button.disabled && button.getBoundingClientRect().width > 10;
  }, null, { timeout: 120_000 });
  const menuReadyPage = await page.evaluate(() => ({
    epochMs: performance.timeOrigin + performance.now(),
    performanceNowMs: performance.now(),
    newGameEnabled: [...document.querySelectorAll('button')]
      .some((button) => /new game/i.test(button.textContent || '') && !button.disabled),
  }));

  // New runner versions expose an accessor; old runners leave this null so the
  // report cannot silently pretend process-start timing existed.
  try {
    if (page.qaRunner?.snapshot) report.runner = await page.qaRunner.snapshot('goal24-menu-ready');
    else if (page.qaRunner) report.runner = JSON.parse(JSON.stringify(page.qaRunner));
  } catch (error) {
    report.runner = { unavailable: true, error: String(error?.message || error) };
  }
  instrumentationMode = report.runner?.instrumentation?.mode ?? null;
  if (!['low-overhead', 'video', 'cdp-trace', 'cdp-trace+video'].includes(instrumentationMode)) {
    throw new Error('The Electron runner did not provide an authoritative instrumentation mode.');
  }
  report.instrumentationMode = instrumentationMode;
  report.controls.runnerInstrumentationAuthority = true;
  const timingAnchors = report.runner?.timing?.anchors || {};
  const launchAnchor = timingAnchors.electronLaunchRequested || timingAnchors.parentLaunchRequest || null;
  const menuAnchor = timingAnchors.menuReady || null;
  const processInstanceId = String(report.runner?.launch?.electronMainProcessIdentity?.pid
    ?? report.runner?.launch?.electronPid
    ?? report.runner?.readbacks?.beforeDriver?.main?.process?.pid
    ?? `unknown-${process.pid}`);
  const runnerLaunchId = report.runner?.launch?.launchId ?? null;
  report.evidence.videoIdentity.runnerLaunchId = runnerLaunchId;
  const electronMainProcessCreationTimeEpochMs = report.runner?.launch
    ?.electronMainProcessIdentity?.creationTimeEpochMs ?? null;
  report.scenarios.coldLaunch = {
    events: [{
      id: 'cold-launch-1',
      scenario: 'coldLaunch',
      repetition: 1,
      thermalState: 'cold',
      instrumentationMode,
      durationMs: Number.isFinite(launchAnchor?.epochMs) && Number.isFinite(menuAnchor?.epochMs)
        ? menuAnchor.epochMs - launchAnchor.epochMs
        : null,
      markers: [
        { label: 'launch-requested', clock: 'runner-monotonic', atEpochMs: launchAnchor?.epochMs ?? null },
        { label: 'menu-interactive', clock: 'runner-monotonic', atEpochMs: menuAnchor?.epochMs ?? null },
      ],
      discriminator: {
        ...menuReadyPage,
        processInstanceId,
        runnerLaunchId,
        electronMainProcessCreationTimeEpochMs,
        freshProcess: report.runner?.profile?.mode === 'isolated-temporary',
        mainMenuInteractive: menuReadyPage.newGameEnabled === true,
        userDataDirectory: report.runner?.profile?.actualPath ?? report.runner?.profile?.path ?? null,
        userDataProfileId: report.runner?.profile?.profileId ?? null,
        shaderCachePolicy: report.runner?.cachePolicy?.gpuDriverShaderCache ?? null,
        gpuCachePolicy: report.runner?.cachePolicy?.chromiumDiskCache ?? null,
      },
      metrics: null,
    }],
  };

  // Apply the player's actual window API before start-to-playable is timed.
  await page.setViewportSize(viewport);
  const rawWindowSizing = process.env.GOAL24_PERF_MATRIX_RAW_WINDOW === '1';
  report.windowRequest = await page.evaluate(async ({ width, height, fullscreen, rawWindowSizing: rawSizing }) => {
    const native = window.fairwayNative;
    const result = { requested: { width, height, fullscreen }, mode: null, resolution: null };
    if (native?.setWindowMode) {
      result.mode = await native.setWindowMode(fullscreen ? 'fullscreen' : 'windowed')
        .catch((error) => ({ error: String(error?.message || error) }));
    }
    if (!fullscreen && !rawSizing && native?.setResolution) {
      result.resolution = await native.setResolution(width, height)
        .catch((error) => ({ error: String(error?.message || error) }));
    }
    if (!fullscreen && rawSizing) {
      result.resolution = { skipped: true, reason: 'diagnostic raw BrowserWindow sizing preserves 4K windowed mode' };
    }
    return result;
  }, {
    ...viewport,
    fullscreen: process.env.GOAL24_PERF_FULLSCREEN === '1',
    rawWindowSizing,
  });
  await sleep(750);

  const expectedStartTraceIdentity = Object.freeze({
    id: 'start-game-1',
    scenario: 'startGame',
  });
  const startRecorderReady = await recorder.installGoal24StartTransitionRecorder(page, {
    maxDurationMs: 300_000,
    traceId: expectedStartTraceIdentity.id,
    traceScenario: expectedStartTraceIdentity.scenario,
  });
  const menuDisplayBoundaryReady = await recorder.waitForGoal24StartDisplayBoundary(page, 5000);
  if (!menuDisplayBoundaryReady.ok) {
    throw new Error(`Start recorder never observed a real pre-click display boundary: ${JSON.stringify(menuDisplayBoundaryReady)}`);
  }
  const bootMode = await boot.clickThroughMenu(page, {
    forceNew: true,
    pinSeed: seed / 0x80000000,
    mode: 'relaxed',
    onPrimaryControlRequest: (control) => recorder.recordGoal24StartDriverInputRequest(page, {
      kind: 'pointer',
      control,
      source: 'driver-immediately-before-Playwright-primary-menu-click',
      detail: { action: 'click', scenario: 'startToControllable' },
    }),
  });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300_000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
  }, null, { timeout: 300_000 });
  const controllableRender = await recorder.waitForGoal24StartControllable(page, 10_000);
  if (!controllableRender.ok) {
    throw new Error(`Start recorder missed the controllable-state candidate boundary: ${JSON.stringify(controllableRender)}`);
  }
  const expectedMenuControl = bootMode === 'continue' ? 'Continue' : 'New Game';
  const movementBefore = await page.evaluate(() => {
    const walk = window.__fw.scene3d.walk;
    return { atMs: performance.now(), x: walk.state.x, z: walk.state.z };
  });
  const startMoveKey = await binding('moveForward', 'w');
  const movementInputRequest = await recorder.recordGoal24StartDriverInputRequest(page, {
    kind: 'keyboard',
    control: startMoveKey,
    source: 'driver-immediately-before-Playwright-movement-probe-keydown',
    detail: { action: 'down', phase: 'movement-probe', scenario: 'startToControllable' },
  });
  await page.keyboard.down(startMoveKey);
  const movementConsumed = await page.waitForFunction((key) => (
    window.__fw.scene3d.walk.heldKeys?.().includes(String(key).toLowerCase())
  ), startMoveKey, { timeout: 1500 }).then(async () => page.evaluate(() => ({
    atMs: performance.now(), signal: 'shipping-walk-held-key-set', productionHandlerObserved: true,
  }))).catch(() => null);
  await sleep(240);
  await page.keyboard.up(startMoveKey);
  const movementAfter = await page.evaluate(() => {
    const walk = window.__fw.scene3d.walk;
    return { atMs: performance.now(), x: walk.state.x, z: walk.state.z };
  });
  const movementDistance = Math.hypot(
    movementAfter.x - movementBefore.x,
    movementAfter.z - movementBefore.z,
  );
  const movementConfirmation = await recorder.confirmGoal24StartMovementProbe(page, {
    key: startMoveKey,
    requestAtMs: movementInputRequest.atMs,
    consumed: movementConsumed,
    before: movementBefore,
    after: movementAfter,
    displacement: movementDistance,
    observedAtMs: movementAfter.atMs,
  }, 10_000);
  if (!movementConfirmation.ok) {
    throw new Error(`Start recorder missed the post-movement render/display boundary: ${JSON.stringify(movementConfirmation)}`);
  }
  const startSample = await recorder.stopGoal24StartTransitionRecorder(page);
  if (startSample.traceIdentity?.id !== expectedStartTraceIdentity.id
    || startSample.traceIdentity?.scenario !== expectedStartTraceIdentity.scenario) {
    throw new Error(
      `Start recorder returned the wrong trace identity: ${JSON.stringify(startSample.traceIdentity)}`,
    );
  }
  // Compatibility no-op: qa-boot restores inside the exact seed draw, before
  // Three.js allocates runtime UUIDs.
  await page.evaluate(() => window.__qaRestoreRandom?.());
  const startControlInput = startSample.inputEvents.find((event) => (
    event.type === 'click'
    && event.isTrusted
    && event.target?.tag === 'button'
    && String(event.target?.text || '').toLowerCase()
      .includes(String(expectedMenuControl).toLowerCase())
  )) || null;
  const startControlRequest = startSample.driverInputRequests.find((request) => (
    request.kind === 'pointer' && request.control === expectedMenuControl
  )) || null;
  if (!startControlInput || !startControlRequest) {
    throw new Error(
      `Start transition lacks exact trusted ${expectedMenuControl} request/delivery evidence: `
      + JSON.stringify({
        expectedMenuControl,
        bootMode,
        clickInputs: startSample.inputEvents.filter((event) => event.type === 'click'),
        pointerRequests: startSample.driverInputRequests.filter((request) => request.kind === 'pointer'),
      }),
    );
  }
  // Use the exact bridge the locked validator independently reconstructs from
  // the trusted click. Adding large epoch values can quantize sub-millisecond
  // interval endpoints, so endpoint durations are re-derived after bridging.
  const rendererTimeOriginEpochMs = startControlInput.atEpochMs - startControlInput.atMs;
  const controlActivatedAtEpochMs = startControlInput?.atEpochMs ?? null;
  const toEpochCadenceIntervals = (intervals) => (intervals || []).map((entry) => {
    const startAtMs = rendererTimeOriginEpochMs + entry.startAtMs;
    const endAtMs = rendererTimeOriginEpochMs + entry.endAtMs;
    return { startAtMs, endAtMs, durationMs: endAtMs - startAtMs };
  });
  const displayCadenceIntervalsEpoch = toEpochCadenceIntervals(
    startSample.displayCadenceIntervals,
  );
  const renderCadenceIntervalsEpoch = toEpochCadenceIntervals(
    startSample.renderCadenceIntervals.filter((entry) => (
      entry.endAtMs <= startSample.firstControllableRenderAtMs
    )),
  );
  const displayFrameIntervalsEpoch = displayCadenceIntervalsEpoch
    .map(({ durationMs }) => durationMs);
  const renderFrameIntervalsEpoch = renderCadenceIntervalsEpoch
    .map(({ durationMs }) => durationMs);
  const confirmedDisplayEpochMs = rendererTimeOriginEpochMs
    + startSample.firstControllableDisplayBoundaryAtMs;
  const confirmedRenderEpochMs = rendererTimeOriginEpochMs
    + startSample.firstControllableRenderAtMs;
  const menuControlConsumedEpochMs = rendererTimeOriginEpochMs
    + startSample.menuControlConsumedAtMs;
  const startDiscriminator = {
    walkActive: true,
    veilDrawn: false,
    screen: await page.evaluate(() => window.__fw?.screen || null),
    bootMode,
    processInstanceId,
    runnerLaunchId,
    electronMainProcessCreationTimeEpochMs,
    menuControl: expectedMenuControl,
    controlActivated: !!startControlInput,
    gameplayControllable: true,
    movementProbeAccepted: !!movementConsumed && movementDistance > 0.02,
    movementProbe: startSample.movementProbe,
    movementProbeRequestAtMs: movementInputRequest.atMs,
    movementProbeConfirmedAtMs: startSample.movementProbeConfirmedAtMs,
    candidateControllableRenderAtMs: startSample.candidateControllableRenderAtMs,
    candidateControllableDisplayBoundaryAtMs: startSample.candidateControllableDisplayBoundaryAtMs,
    confirmedControllableRenderAtMs: startSample.firstControllableRenderAtMs,
    confirmedControllableDisplayBoundaryAtMs: startSample.firstControllableDisplayBoundaryAtMs,
    instrumentationReadyBeforeControl: Number.isFinite(controlActivatedAtEpochMs)
      && startRecorderReady.installedAtEpochMs <= controlActivatedAtEpochMs,
    firstControllableDisplayBoundaryObserved: Number.isFinite(
      confirmedDisplayEpochMs,
    ),
    firstControllableRenderObserved: Number.isFinite(confirmedRenderEpochMs),
    instrumentationReadyAtMs: startRecorderReady.installedAtEpochMs,
    renderInstrumentationAttachedAtMs: Number.isFinite(startSample.renderInstrumentationAttachedAtMs)
      ? rendererTimeOriginEpochMs + startSample.renderInstrumentationAttachedAtMs : null,
    firstControllableDisplayBoundaryAtMs: confirmedDisplayEpochMs,
    firstControllableRenderAtMs: confirmedRenderEpochMs,
    firstControllableRendererFrame: startSample.firstControllableRendererFrame,
    startInputTrusted: startControlInput?.isTrusted === true,
    menuControlConsumedAtMs: menuControlConsumedEpochMs,
    cleanlyDetached: startSample.cleanlyDetached,
  };
  const startEndedAtEpochMs = confirmedDisplayEpochMs;
  const startSampleCoverageEpoch = {
    ...startSample.sampleCoverage,
    windowDurationMs: startEndedAtEpochMs - controlActivatedAtEpochMs,
    displayFirstBoundaryOffsetMs: displayCadenceIntervalsEpoch.length
      ? displayCadenceIntervalsEpoch[0].endAtMs - controlActivatedAtEpochMs : null,
    displayLastBoundaryBeforeEndMs: displayCadenceIntervalsEpoch.length
      ? startEndedAtEpochMs - displayCadenceIntervalsEpoch.at(-1).endAtMs : null,
    renderFirstBoundaryOffsetMs: renderCadenceIntervalsEpoch.length
      ? renderCadenceIntervalsEpoch[0].startAtMs - controlActivatedAtEpochMs : null,
    renderLastBoundaryBeforeEndMs: renderCadenceIntervalsEpoch.length
      ? startEndedAtEpochMs - renderCadenceIntervalsEpoch.at(-1).endAtMs : null,
    measurementPriorDisplayBoundaryMs: displayCadenceIntervalsEpoch[0]?.startAtMs ?? null,
    measurementPriorRenderBoundaryMs: renderCadenceIntervalsEpoch[0]?.startAtMs ?? null,
  };
  startDiscriminator.renderCadenceMeasurementStartedAtMs =
    startSampleCoverageEpoch.measurementPriorRenderBoundaryMs;
  report.scenarios.startGame = { events: [{
    id: 'start-game-1',
    scenario: 'startGame',
    repetition: 1,
    thermalState: 'cold',
    instrumentationMode,
    startedAtEpochMs: controlActivatedAtEpochMs,
    endedAtEpochMs: startEndedAtEpochMs,
    durationMs: Number.isFinite(controlActivatedAtEpochMs)
      ? startEndedAtEpochMs - controlActivatedAtEpochMs : null,
    markers: [
      { label: 'start-click', clock: 'epoch-bridged-launcher', atEpochMs: controlActivatedAtEpochMs },
      { label: 'first-controllable-render-display-boundary', clock: 'epoch-bridged-launcher', atEpochMs: startEndedAtEpochMs },
    ],
    displayFrameIntervalsMs: displayFrameIntervalsEpoch,
    displayCadenceIntervals: displayCadenceIntervalsEpoch,
    renderFrameIntervalsMs: renderFrameIntervalsEpoch,
    renderCadenceIntervals: renderCadenceIntervalsEpoch,
    sampleCoverage: startSampleCoverageEpoch,
    droppedSamples: startSample.droppedSamples,
    inputEvents: startSample.inputEvents,
    driverInputRequests: startSample.driverInputRequests,
    traceIdentity: { ...startSample.traceIdentity },
    discriminator: startDiscriminator,
    metrics: {
      displayRaf: stats(displayFrameIntervalsEpoch),
      actualRender: stats(renderFrameIntervalsEpoch),
      renderSubmissionWall: stats([]),
    },
  }] };

  await page.bringToFront().catch(() => {});
  await sleep(500);
  const rendererGate = await gateRenderer(page, {
    electronGpuFeatureStatus: report.runner?.readbacks?.beforeDriver?.main?.gpu?.featureStatus,
    requireElectronStatus: true,
  });
  report.controls.hardwareRenderer = !rendererGate.software;
  report.rendererGate = rendererGate;

  // Deterministic fixture only. It normalizes non-spatial state, but deliberately
  // leaves the freshly spawned player, camera, AND clock where shipping boot put
  // them. The clubhouse light list is a shader-program input. Moving the clock
  // from the seeded 06:00 boot to 14:00 before the cold door leg changed the
  // porch/daylight light signature after prewarm and manufactured a QA-only
  // first-door compile. Later scenarios still receive their canonical 14:00
  // fixture, but only after the one cold route has closed.
  report.fixture = await page.evaluate(() => {
    const fw = window.__fw;
    const ch = fw.scene3d.clubhouse();
    const st = fw.scene3d.walk.state;
    fw.speedIdx = 0;
    ch.setOrganicWalkins?.(false);
    ch.clearWalkins?.();
    fw.scene3d.walk.clearKeys?.();
    st.vx = 0;
    st.vz = 0;
    fw.preferences.update({
      display: {
        quality: 'high',
        renderScale: 1,
        ambientOcclusion: true,
        bloom: true,
        shadows: true,
        shadowQuality: 'medium',
        postProcessing: true,
        fpsCap: 60,
      },
    });
    if (fw.state.shop?.inventory?.vac1) fw.state.shop.inventory.vac1.back = Math.max(1, fw.state.shop.inventory.vac1.back || 0);
    return {
      inside: !!ch.isInside(st.x, st.z, 0.35),
      x: st.x,
      z: st.z,
      yaw: st.yaw,
      pitch: st.pitch,
      clockMinute: fw.state.clock.minutes,
      clockMutationDeferredUntilAfterColdDoor: true,
      fpsCap: fw.preferences.values.display.fpsCap,
      cleaningKitOwned: (fw.state.shop?.inventory?.vac1?.back || 0) > 0,
    };
  });

  const position = () => page.evaluate(() => {
    const st = window.__fw.scene3d.walk.state;
    const ch = window.__fw.scene3d.clubhouse();
    return {
      atMs: performance.now(),
      x: st.x,
      z: st.z,
      yaw: st.yaw,
      pitch: st.pitch,
      inside: !!ch.isInside(st.x, st.z, 0.35),
      heldKeys: window.__fw.scene3d.walk.heldKeys?.() || [],
    };
  });
  const hold = async (key, ms, scenario = null) => {
    if (scenario) await requestInput('keyboard', key, { action: 'down', scenario });
    await page.keyboard.down(key);
    try { await sleep(ms); } finally { await page.keyboard.up(key); }
  };
  const stageDoor = (side, distance, mutate = true) => page.evaluate(async ({
    wantedSide, wantedDistance, shouldMutate, detailClearanceYards,
  }) => {
    const fw = window.__fw;
    const ch = fw.scene3d.clubhouse();
    const st = fw.scene3d.walk.state;
    const layout = await import(new URL('src/data/shopLayout.js', document.baseURI).href);
    const halfD = layout.SHELL.d / 2 - layout.SHELL.wallT / 2;
    const ip = ch.interior.position;
    const converted = ch.L2W?.(layout.DOOR_MAIN.x, halfD);
    const doorPoint = converted || { x: ip.x + layout.DOOR_MAIN.x, z: ip.z + halfD };
    const target = {
      x: doorPoint.x,
      z: doorPoint.z,
      detailInterior: {
        centerX: ch.center?.x ?? ip.x,
        centerZ: ch.center?.z ?? ip.z,
        halfWidth: layout.INTERIOR.w / 2,
        halfDepth: layout.INTERIOR.d / 2,
        clearanceYards: detailClearanceYards,
      },
    };
    let nx = target.x - ip.x;
    let nz = target.z - ip.z;
    const length = Math.hypot(nx, nz) || 1;
    nx /= length; nz /= length;
    const candidate = { x: target.x + nx, z: target.z + nz };
    if (ch.isInside(candidate.x, candidate.z, 0.1)) { nx *= -1; nz *= -1; }
    if (shouldMutate) {
      const sign = wantedSide === 'inside' ? -1 : 1;
      st.x = target.x + nx * wantedDistance * sign;
      st.z = target.z + nz * wantedDistance * sign;
      st.yaw = Math.atan2(-(target.x - st.x), -(target.z - st.z));
      st.pitch = -0.05; st.vx = 0; st.vz = 0;
    }
    return {
      side: wantedSide,
      distance: Math.hypot(st.x - target.x, st.z - target.z),
      target,
      normal: { x: nx, z: nz },
      position: { x: st.x, z: st.z },
      pose: { x: st.x, z: st.z, yaw: st.yaw, pitch: st.pitch },
      inside: !!ch.isInside(st.x, st.z, 0.35),
      harnessPoseMutation: shouldMutate,
    };
  }, {
    wantedSide: side,
    wantedDistance: distance,
    shouldMutate: mutate,
    detailClearanceYards: doorDetailClearanceYards,
  });
  const readDoor = (target) => page.evaluate((doorTarget) => {
    const fw = window.__fw;
    const ch = fw.scene3d.clubhouse();
    const st = fw.scene3d.walk.state;
    const doors = ch.doors || [];
    const mainDoors = doors.filter((door) => door.interactionId === 'clubhouse-main-door');
    const focus = fw.scene3d.walk.getFocus?.() || null;
    const camera = fw.scene3d.camera;
    const runtime = ch.assets51to100Runtime?.diagnostics?.() || null;
    const cameraX = camera?.position?.x ?? st.x;
    const cameraZ = camera?.position?.z ?? st.z;
    const detailInterior = doorTarget.detailInterior;
    const detailDx = Math.max(Math.abs(cameraX - detailInterior.centerX) - detailInterior.halfWidth, 0);
    const detailDz = Math.max(Math.abs(cameraZ - detailInterior.centerZ) - detailInterior.halfDepth, 0);
    const rendererInfo = fw.scene3d.renderer?.info || null;
    const capturedAtMs = performance.now();
    return {
      atMs: capturedAtMs,
      position: { x: st.x, z: st.z },
      cameraPose: camera ? {
        x: camera.position.x, y: camera.position.y, z: camera.position.z,
        qx: camera.quaternion.x, qy: camera.quaternion.y,
        qz: camera.quaternion.z, qw: camera.quaternion.w,
        fov: camera.fov, aspect: camera.aspect,
      } : null,
      inside: !!ch.isInside(st.x, st.z, 0.35),
      interiorVisible: ch.interior?.visible === true,
      distance: Math.hypot(st.x - doorTarget.x, st.z - doorTarget.z),
      detailExteriorDistanceYards: Math.hypot(detailDx, detailDz),
      detailWithinClearance: Math.hypot(detailDx, detailDz) < detailInterior.clearanceYards,
      detailRuntime: runtime ? {
        capturedAtMs,
        runtimeCreatedAtMs: runtime.runtimeCreatedAtMs ?? null,
        runtimeReadyAtMs: runtime.runtimeReadyAtMs ?? null,
        staticBatchStartedAtMs: runtime.staticBatchStartedAtMs ?? null,
        staticBatchReadyAtMs: runtime.staticBatchReadyAtMs ?? null,
        staticBatchOutcome: runtime.staticBatchOutcome ?? null,
        detailedVisible: runtime.detailedVisible === true,
        detailVisibilitySequence: runtime.detailVisibilitySequence ?? null,
        lastDetailVisibilityTransition: runtime.lastDetailVisibilityTransition ?? null,
      } : null,
      rendererResources: rendererInfo ? {
        programs: Array.isArray(rendererInfo.programs) ? rendererInfo.programs.length : null,
        geometries: rendererInfo.memory?.geometries ?? null,
        textures: rendererInfo.memory?.textures ?? null,
      } : null,
      focus: String(fw.scene3d.walk.getFocusLabel?.() || ''),
      focusKind: focus?.kind ?? null,
      focusTargetId: focus?.kind === 'prop' ? focus.prop?.id ?? null : null,
      mainEntrance: ch.mainEntranceDiagnostics?.() ?? null,
      mainLeafCount: mainDoors.length,
      angles: mainDoors.map((door) => Number.isFinite(door.angle) ? door.angle : null),
      desired: mainDoors.map((door) => !!door.desiredOpen),
      heldKeys: fw.scene3d.walk.heldKeys?.() || [],
    };
  }, target);
  const driveUntil = async (
    key,
    target,
    predicate,
    maxMs,
    contractScenarioId,
    pollMs = 25,
  ) => {
    const samples = [];
    const started = Date.now();
    await requestInput('keyboard', key, { action: 'down', scenario: contractScenarioId });
    await page.keyboard.down(key);
    try {
      while (Date.now() - started < maxMs) {
        await sleep(pollMs);
        const sample = await readDoor(target);
        samples.push(sample);
        if (predicate(sample)) break;
      }
    } finally {
      await page.keyboard.up(key);
    }
    return samples;
  };
  const waitForDoorDetailState = async (expectedVisible, timeoutMs = 2500) => {
    const handle = await page.waitForFunction((expected) => {
      const runtime = window.__fw?.scene3d?.clubhouse?.()?.assets51to100Runtime;
      const diagnostic = runtime?.diagnostics?.();
      return diagnostic?.detailedVisible === expected ? diagnostic : false;
    }, expectedVisible, { timeout: timeoutMs });
    return handle.jsonValue();
  };
  const rendererProgramCacheKeys = () => page.evaluate(() => (
    (window.__fw?.scene3d?.renderer?.info?.programs || [])
      .map((program) => String(program.cacheKey || ''))
      .filter(Boolean)
  ));
  const captureProgramOwnership = (arrivalKeys, referenceKeys) => page.evaluate(({
    factorySource, arrivals, references,
  }) => {
    const scene3d = window.__fw?.scene3d;
    if (!scene3d?.renderer || !scene3d?.scene) {
      throw new Error('Shipping Three renderer/scene unavailable for program ownership capture.');
    }
    const createProbe = (0, eval)(factorySource);
    return createProbe().capture({
      renderer: scene3d.renderer,
      scene: scene3d.scene,
      arrivalKeys: arrivals,
      referenceKeys: references,
    });
  }, {
    factorySource: programOwnershipProbeSource,
    arrivals: arrivalKeys,
    references: referenceKeys,
  });

  const doorState = {
    target: null,
    coldSequenceComplete: false,
    noInteriorBeforeColdCrossing: startSample.playerInteriorHistory?.playerInteriorObserved === false,
  };
  const detailTransitionDuring = (startObservation, finish) => {
    const startSequence = Number(startObservation.detailRuntime?.detailVisibilitySequence);
    const finishSequence = Number(finish.detailRuntime?.detailVisibilitySequence);
    const transition = finish.detailRuntime?.lastDetailVisibilityTransition || null;
    if (!Number.isInteger(startSequence) || !Number.isInteger(finishSequence)
      || finishSequence !== startSequence + 1
      || transition?.sequence !== finishSequence
      || !Number.isFinite(transition?.atMs)
      || transition.atMs < startObservation.atMs
      || transition.atMs > finish.atMs) return null;
    return { ...transition };
  };
  const doorRouteSignature = (routeKind, start, startObservation, finish, samples) => ({
    schema: doorEvidenceModule.GOAL24_DOOR_ROUTE_SCHEMA,
    routeKind,
    detailClearanceYards: doorDetailClearanceYards,
    startPose: start.pose || {
      x: start.position?.x, z: start.position?.z, yaw: null, pitch: null,
    },
    target: { x: start.target.x, z: start.target.z },
    normal: start.normal,
    startCameraPose: startObservation.cameraPose,
    finishPosition: finish.position,
    finishCameraPose: finish.cameraPose,
    runtimeStart: startObservation.detailRuntime,
    runtimeEnd: finish.detailRuntime,
    pathSamples: samples.map((sample, index) => ({
      ordinal: index + 1,
      atMs: sample.atMs,
      x: sample.position.x,
      z: sample.position.z,
      distanceToDoor: sample.distance,
      detailExteriorDistanceYards: sample.detailExteriorDistanceYards,
      detailWithinClearance: sample.detailWithinClearance,
      detailedVisible: sample.detailRuntime?.detailedVisible ?? null,
      detailVisibilitySequence: sample.detailRuntime?.detailVisibilitySequence ?? null,
      inside: sample.inside,
    })),
  });
  const ensureMainDoorClosedOutsideMeasurement = async () => {
    const interact = await binding('interact', 'e');
    const isSettledClosed = (sample) => (
      sample?.mainEntrance?.leftState === 'closed'
      && sample?.mainEntrance?.rightState === 'closed'
      && Math.abs(sample?.mainEntrance?.leftAngle || 0) < 0.03
      && Math.abs(sample?.mainEntrance?.rightAngle || 0) < 0.03
    );
    const reset = {
      schema: 'golf-flipper/goal24-door-warm-reset/v1',
      measuredWindowActive: false,
      method: 'shipping-main-entrance-focus-and-trusted-interact-key',
      interactKey: interact,
      interactionAttempts: [],
    };

    const farStage = await stageDoor('outside', 6.5);
    reset.before = await readDoor(farStage.target);
    if (!isSettledClosed(reset.before)
      && (reset.before.mainEntrance?.leftState !== 'closed'
        || reset.before.mainEntrance?.rightState !== 'closed')) {
      // Stand just inside the shipping focus radius but outside the 2 yd
      // proximity hold. This keeps setup on the real E-key path without
      // polluting the later recorder-owned approach window.
      const interactionStage = await stageDoor('outside', 2.05);
      await waitForDoorDetailState(false);
      await page.waitForFunction(() => (
        window.__fw.scene3d.walk.getFocus?.()?.prop?.id === 'clubhouse-main-door'
      ), null, { timeout: 3000 });
      reset.interactionStage = interactionStage;

      for (let attempt = 1; attempt <= 2; attempt += 1) {
        const beforeInteraction = await readDoor(interactionStage.target);
        if (beforeInteraction.mainEntrance?.leftState === 'closed'
          && beforeInteraction.mainEntrance?.rightState === 'closed') break;
        const beforeSequence = beforeInteraction.mainEntrance?.interactionSequence;
        await page.keyboard.press(interact);
        const outcome = await page.waitForFunction((sequence) => {
          const diagnostic = window.__fw.scene3d.clubhouse().mainEntranceDiagnostics?.();
          return diagnostic?.interactionSequence > sequence ? diagnostic : false;
        }, beforeSequence, { timeout: 2500 }).then((handle) => handle.jsonValue())
          .catch(() => null);
        reset.interactionAttempts.push({
          attempt,
          before: beforeInteraction.mainEntrance,
          outcome,
        });
        if (outcome?.leftState === 'closed' && outcome?.rightState === 'closed'
          && outcome?.interactionSignal === 'main-entrance-close-applied') break;
      }
    }

    reset.clearStage = await stageDoor('outside', 6.5);
    reset.clearObservation = await readDoor(reset.clearStage.target);
    if (!isSettledClosed(reset.clearObservation)) {
      try {
        await page.waitForFunction(() => {
          const diagnostic = window.__fw.scene3d.clubhouse().mainEntranceDiagnostics?.();
          return diagnostic?.leftState === 'closed'
            && diagnostic?.rightState === 'closed'
            && Math.abs(diagnostic?.leftAngle || 0) < 0.03
            && Math.abs(diagnostic?.rightAngle || 0) < 0.03;
        }, null, { polling: 25, timeout: 7000 });
      } catch (error) {
        reset.after = await readDoor(reset.clearStage.target);
        throw new Error(`Warm main-entrance reset failed outside measurement: ${JSON.stringify(reset)}`, {
          cause: error,
        });
      }
    }
    reset.after = await readDoor(reset.clearStage.target);
    if (!isSettledClosed(reset.after)) {
      throw new Error(`Warm main-entrance reset did not settle closed: ${JSON.stringify(reset)}`);
    }
    return reset;
  };
  const approachDoor = async (repetition, thermalState, stagedStart = null) => {
    const forward = await binding('moveForward', 'w');
    const preMeasurementDoorReset = !stagedStart && thermalState === 'warm'
      ? await ensureMainDoorClosedOutsideMeasurement()
      : null;
    const start = stagedStart || await stageDoor('outside', 6.5);
    doorState.target = start.target;
    if (!stagedStart && thermalState !== 'warm') {
      await sleep(350);
    }
    await begin(`door-approach-${repetition}`, 'doorApproach', repetition, thermalState);
    const startObservation = await readDoor(start.target);
    await mark('approach-start', { ...start, cameraPose: startObservation.cameraPose });
    const drivenSamples = await driveUntil(
      forward, start.target,
      (sample) => sample.distance <= 1.9 || sample.inside,
      5000,
      'doorApproach',
    );
    const samples = [startObservation, ...drivenSamples];
    const finish = samples.at(-1) || await readDoor(start.target);
    await mark('approach-threshold', finish);
    const event = await end('doorApproach', {
      key: forward,
      doorId: 'clubhouse-main-door',
      processInstanceId,
      runnerLaunchId,
      electronMainProcessCreationTimeEpochMs,
      freshProcess: thermalState === 'cold',
      preMeasurementDoorReset,
      startZone: start.inside ? 'inside' : 'outside',
      endZone: finish.inside ? 'inside' : 'outside-approach-marker',
      startDistanceYards: start.distance,
      thresholdCrossed: finish.distance <= 1.9,
      detailClearanceYards: doorDetailClearanceYards,
      detailThresholdStayedOutside: samples.every((sample) => (
        sample.detailExteriorDistanceYards >= doorDetailClearanceYards
        && sample.detailWithinClearance === false
      )),
      startedOutside: start.inside === false,
      endDistance: finish.distance,
      endedOutside: finish.inside === false,
      movedTowardDoor: finish.distance < start.distance - 2,
      routeSignature: doorRouteSignature('approach', start, startObservation, finish, samples),
      productionHandlerConsumed: (() => {
        const sample = samples.find((value) => (
          value.heldKeys?.includes(String(forward).toLowerCase())
        ));
        return sample ? { atMs: sample.atMs, signal: 'shipping-walk-held-key-set' } : null;
      })(),
      outcomeObservedAtMs: finish.atMs,
      samples,
      everySampleOutside: samples.every((sample) => sample.inside === false),
    });
    event.doorwayRenderEvidence = doorEvidenceModule
      .summarizeGoal24DoorwayRenderEvidence(event, `doorApproach/${event.id}`);
    event.discriminator.forwardKeyTrustedCount = trustedKeyCount(event, event.discriminator.key);
    return { start, finish, event };
  };
  const ensureMainDoorOpenOutsideMeasurement = async (interact) => {
    const staged = await stageDoor('outside', 1.9);
    await waitForDoorDetailState(false);
    await page.waitForFunction(() => (
      window.__fw.scene3d.walk.getFocus?.()?.prop?.id === 'clubhouse-main-door'
    ), null, { timeout: 3000 });
    const before = await readDoor(staged.target);
    if (before.mainEntrance?.leftState !== 'open'
      || before.mainEntrance?.rightState !== 'open') {
      await page.keyboard.press(interact);
    }
    await page.waitForFunction(() => {
      const diagnostic = window.__fw.scene3d.clubhouse().mainEntranceDiagnostics?.();
      return diagnostic?.interactionId === 'clubhouse-main-door'
        && diagnostic.leftState === 'open'
        && diagnostic.rightState === 'open'
        && Math.abs(diagnostic.leftAngle || 0) > 0.2
        && Math.abs(diagnostic.rightAngle || 0) > 0.2;
    }, null, { timeout: 5000 });
    return readDoor(staged.target);
  };
  const openDoorFirstTime = async (target) => {
    const interact = await binding('interact', 'e');
    await page.waitForFunction(() => (
      window.__fw.scene3d.walk.getFocus?.()?.prop?.id === 'clubhouse-main-door'
    ), null, { timeout: 3000 });
    await begin('door-open-1', 'doorOpen', 1, 'cold');
    const doorBefore = await readDoor(target);
    if (doorBefore.focusTargetId !== 'clubhouse-main-door'
      || doorBefore.mainLeafCount !== 2
      || doorBefore.desired.some(Boolean)
      || doorBefore.mainEntrance?.interactionId !== 'clubhouse-main-door'
      || doorBefore.mainEntrance?.leftState !== 'closed'
      || doorBefore.mainEntrance?.rightState !== 'closed') {
      throw new Error(`Cold first-open precondition failed inside the armed window: ${JSON.stringify(doorBefore)}`);
    }
    await mark('door-interact-key', {
      key: interact,
      focus: doorBefore.focus,
      focusTargetId: doorBefore.focusTargetId,
      mainEntrance: doorBefore.mainEntrance,
    });
    await requestInput('keyboard', interact, { action: 'down', scenario: 'doorFirstOpen' });
    await page.keyboard.down(interact);
    const interactConsumed = await page.waitForFunction((key) => (
      window.__fw.scene3d.walk.heldKeys?.().includes(String(key).toLowerCase())
    ), interact, { timeout: 1500 }).then(async () => page.evaluate(() => ({
      atMs: performance.now(), signal: 'shipping-walk-held-key-set',
    }))).catch(() => null);
    await page.keyboard.up(interact);
    const desiredChanged = await page.waitForFunction((beforeSequence) => {
      const diagnostic = window.__fw.scene3d.clubhouse().mainEntranceDiagnostics?.();
      return diagnostic?.interactionId === 'clubhouse-main-door'
        && diagnostic.leftState === 'open'
        && diagnostic.rightState === 'open'
        && diagnostic.interactionSequence === beforeSequence + 1
        ? diagnostic : false;
    }, doorBefore.mainEntrance.interactionSequence, { timeout: 2500 }).then((handle) => handle.jsonValue())
      .then((diagnostic) => ({
        atMs: diagnostic.interactionAtMs,
        signal: diagnostic.interactionSignal,
        sequence: diagnostic.interactionSequence,
      })).catch(() => null);
    await page.waitForFunction(({ leftBefore, rightBefore }) => {
      const diagnostic = window.__fw.scene3d.clubhouse().mainEntranceDiagnostics?.();
      return Math.abs((diagnostic?.leftAngle || 0) - leftBefore) > 0.2
        && Math.abs((diagnostic?.rightAngle || 0) - rightBefore) > 0.2;
    }, {
      leftBefore: doorBefore.mainEntrance.leftAngle,
      rightBefore: doorBefore.mainEntrance.rightAngle,
    }, { timeout: 5000 });
    await sleep(500);
    const doorAfter = await readDoor(target);
    const swing = Math.max(0, ...doorAfter.angles.map((angle, index) => (
      Math.abs((angle || 0) - (doorBefore.angles[index] || 0))
    )));
    const event = await end('doorOpen', {
      key: interact,
      doorId: 'clubhouse-main-door',
      processInstanceId,
      freshProcess: true,
      focusTargetDoorId: doorBefore.focusTargetId,
      interactKey: interact,
      desiredState: 'open',
      desiredStateApplied: doorAfter.mainEntrance?.leftState === 'open'
        && doorAfter.mainEntrance?.rightState === 'open',
      opened: swing > 0.2 && doorAfter.mainEntrance?.leftState === 'open'
        && doorAfter.mainEntrance?.rightState === 'open',
      openSwingObserved: swing > 0.2 && doorAfter.angles.every((angle, index) => (
        Math.abs((angle || 0) - (doorBefore.angles[index] || 0)) > 0.2
      )),
      openSwingRadians: swing,
      productionDoorSignal: desiredChanged?.signal ?? null,
      productionDoorSignalAtMs: desiredChanged?.atMs ?? null,
      inputConsumed: interactConsumed,
      productionHandlerConsumed: desiredChanged,
      outcomeObservedAtMs: doorAfter.atMs,
      before: doorBefore,
      after: doorAfter,
    });
    event.discriminator.interactKeyTrustedCount = trustedKeyCount(event, interact);
    return event;
  };
  const crossDoor = async (direction, repetition, thermalState) => {
    const from = direction === 'outside-in' ? 'outside' : 'inside';
    const expectedInside = direction === 'outside-in';
    const expectedDetailedVisible = direction === 'outside-in';
    const forward = await binding('moveForward', 'w');
    const start = await stageDoor(from, 1.9);
    await waitForDoorDetailState(!expectedDetailedVisible);
    const programCacheKeysBefore = await rendererProgramCacheKeys();
    await begin(`door-cross-${direction}-${repetition}`, `doorCrossing:${direction}`, repetition, thermalState);
    const startObservation = await readDoor(start.target);
    await mark('crossing-start', { ...start, cameraPose: startObservation.cameraPose });
    const drivenSamples = await driveUntil(
      forward, start.target,
      (sample) => sample.inside === expectedInside
        && sample.distance >= 1.8,
      3500,
      direction === 'outside-in'
        ? 'doorCrossingOutsideToInside' : 'doorCrossingInsideToOutside',
    );
    // Stop the trusted continuous movement at the same spatial endpoint on
    // every run, then observe (never force) the production 0.5 s visibility
    // poll. Coupling the stop position to that poll made route parity depend on
    // scheduler phase by as much as 1.7 yards.
    await waitForDoorDetailState(expectedDetailedVisible);
    const finish = await readDoor(start.target);
    const samples = [startObservation, ...drivenSamples, finish];
    const detailTransition = detailTransitionDuring(startObservation, finish);
    if (detailTransition) {
      await mark('production-detail-visibility-transition', detailTransition);
    }
    await mark('crossing-complete', finish);
    const coldInbound = direction === 'outside-in' && thermalState === 'cold';
    const event = await end(`doorCrossing:${direction}`, {
      key: forward,
      doorId: 'clubhouse-main-door',
      processInstanceId: direction === 'outside-in' ? processInstanceId : undefined,
      freshProcess: coldInbound,
      direction,
      fromZone: start.inside ? 'inside' : 'outside',
      toZone: finish.inside ? 'inside' : 'outside',
      boundaryCrossed: start.inside !== finish.inside && finish.inside === expectedInside,
      startInside: start.inside,
      endInside: finish.inside,
      expectedInside,
      crossed: start.inside !== finish.inside && finish.inside === expectedInside,
      detailClearanceYards: doorDetailClearanceYards,
      detailVisibilityTransition: detailTransition,
      detailVisibilitySequenceDelta: Number(finish.detailRuntime?.detailVisibilitySequence)
        - Number(startObservation.detailRuntime?.detailVisibilitySequence),
      normalMovement: Math.hypot(
        finish.position.x - start.position.x,
        finish.position.z - start.position.z,
      ) > 1,
      noPriorInteriorThresholdCrossing: coldInbound
        ? doorState.noInteriorBeforeColdCrossing : false,
      interiorVisibilityObserved: direction === 'outside-in'
        ? finish.inside === true
          && finish.detailRuntime?.detailedVisible === true
          && detailTransition?.from === false
          && detailTransition?.to === true
        : undefined,
      productionVisibilityMarker: detailTransition
        ? `assets51to100-detail-visibility-${detailTransition.from}-to-${detailTransition.to}`
        : null,
      productionVisibilityAtMs: detailTransition?.atMs ?? null,
      routeSignature: doorRouteSignature(direction, start, startObservation, finish, samples),
      productionHandlerConsumed: (() => {
        const sample = samples.find((value) => value.heldKeys?.includes(String(forward).toLowerCase()));
        return sample ? { atMs: sample.atMs, signal: 'shipping-walk-held-key-set' } : null;
      })(),
      outcomeObservedAtMs: finish.atMs,
      startPosition: start.position,
      endPosition: finish.position,
      startRuntime: startObservation.detailRuntime,
      endRuntime: finish.detailRuntime,
      rendererResourceDelta: {
        programs: Number(finish.rendererResources?.programs) - Number(startObservation.rendererResources?.programs),
        geometries: Number(finish.rendererResources?.geometries) - Number(startObservation.rendererResources?.geometries),
        textures: Number(finish.rendererResources?.textures) - Number(startObservation.rendererResources?.textures),
      },
      samples,
    });
    const programCacheKeysAfter = await rendererProgramCacheKeys();
    const beforeProgramSet = new Set(programCacheKeysBefore);
    const afterProgramSet = new Set(programCacheKeysAfter);
    const programArrivals = programCacheKeysAfter.filter((key) => !beforeProgramSet.has(key));
    event.discriminator.programCacheEvidence = {
      source: 'THREE.WebGLRenderer.info.programs-cacheKey-before-and-after-closed-route',
      beforeCount: programCacheKeysBefore.length,
      afterCount: programCacheKeysAfter.length,
      arrivals: programArrivals,
      departures: programCacheKeysBefore.filter((key) => !afterProgramSet.has(key)),
      // Post-window, read-only attribution. The probe joins Three's public
      // per-material program Maps back to scene objects and performs no draw,
      // compile, visibility mutation, or measured-window work.
      ownership: programArrivals.length
        ? await captureProgramOwnership(programArrivals, programCacheKeysBefore)
        : null,
    };
    event.doorwayRenderEvidence = doorEvidenceModule
      .summarizeGoal24DoorwayRenderEvidence(event, `doorCrossing:${direction}/${event.id}`);
    event.discriminator.forwardKeyTrustedCount = trustedKeyCount(event, forward);
    return event;
  };

  // This is the only cold door sequence in the process. It runs before any
  // harness-owned interior pose, recorder calibration, or resource census.
  if (overlayRequested && instrumentationMode !== 'video') {
    throw new Error('The performance overlay is permitted only in the separate video leg.');
  }
  report.overlay = overlayRequested
    ? await installPerformanceOverlay()
    : { enabled: false, visible: false, reason: 'not the diagnostic video leg' };
  if (wants('door')) {
    await recorder.installGoal24InteractionRecorder(page);
    await page.mouse.click(Math.round(viewport.width / 2), Math.round(viewport.height / 2));
    const stagedBefore = await stageDoor('outside', 6.5);
    if (stagedBefore.inside || Math.abs(stagedBefore.distance - 6.5) > 0.02) {
      throw new Error(`Deterministic cold exterior door start is invalid: ${JSON.stringify(stagedBefore)}`);
    }
    const firstApproach = await approachDoor(1, 'cold', stagedBefore);
    const approachStayedOutside = firstApproach.event.discriminator.everySampleOutside === true
      && firstApproach.finish.inside === false;
    const approachStayedOutsideDetailGate = firstApproach.event.discriminator
      .detailThresholdStayedOutside === true;
    if (!approachStayedOutside || !approachStayedOutsideDetailGate
      || !firstApproach.event.discriminator.thresholdCrossed) {
      throw new Error(`Cold door approach crossed a production visibility boundary or missed its marker: ${JSON.stringify({
        approachStayedOutside,
        approachStayedOutsideDetailGate,
        discriminator: firstApproach.event.discriminator,
        start: firstApproach.start,
        finish: firstApproach.finish,
      })}`);
    }
    doorState.noInteriorBeforeColdCrossing =
      startSample.playerInteriorHistory?.playerInteriorObserved === false
      && stagedBefore.inside === false
      && approachStayedOutside;
    const firstOpen = await openDoorFirstTime(firstApproach.start.target);
    const openStayedOutside = firstOpen.discriminator?.before?.inside === false
      && firstOpen.discriminator?.after?.inside === false;
    doorState.noInteriorBeforeColdCrossing = doorState.noInteriorBeforeColdCrossing
      && openStayedOutside;
    const firstCrossing = await crossDoor('outside-in', 1, 'cold');
    const firstOpenComplete = firstOpen.discriminator?.focusTargetDoorId === 'clubhouse-main-door'
      && firstOpen.discriminator?.desiredStateApplied === true
      && firstOpen.discriminator?.opened === true
      && firstOpen.discriminator?.openSwingObserved === true
      && firstOpen.discriminator?.productionDoorSignal === 'main-entrance-open-applied';
    doorState.coldSequenceComplete = firstOpenComplete
      && firstCrossing.discriminator.boundaryCrossed === true;
    report.coldDoorSequence = {
      noHarnessInteriorPoseBeforeSequence: true,
      deterministicExteriorStagingBeforeSequence: stagedBefore.harnessPoseMutation === true,
      startRecorderInteriorHistory: startSample.playerInteriorHistory,
      stagedBefore,
      approachStayedOutside,
      approachStayedOutsideDetailGate,
      openStayedOutside,
      noInteriorBeforeColdCrossing: doorState.noInteriorBeforeColdCrossing,
      processInstanceId,
      approach: {
        startedAtMs: firstApproach.event.startedAtMs,
        endedAtMs: firstApproach.event.endedAtMs,
      },
      firstOpen: { startedAtMs: firstOpen.startedAtMs, endedAtMs: firstOpen.endedAtMs },
      firstCrossing: {
        startedAtMs: firstCrossing.startedAtMs,
        endedAtMs: firstCrossing.endedAtMs,
      },
      ordered: firstApproach.event.endedAtMs <= firstOpen.startedAtMs
        && firstOpen.endedAtMs <= firstCrossing.startedAtMs,
      firstOpenComplete,
      complete: doorState.coldSequenceComplete,
    };
    if (!report.coldDoorSequence.ordered || !report.coldDoorSequence.complete
      || doorState.noInteriorBeforeColdCrossing !== true) {
      throw new Error(`Cold door process chain is invalid: ${JSON.stringify(report.coldDoorSequence)}`);
    }
    await recorder.uninstallGoal24InteractionRecorder(page);
  }

  // After the cold sequence, diagnostic/full legs use the canonical interior
  // pose. This cannot prewarm or dilute any cold door measurement above.
  report.fixtureAfterColdDoor = await page.evaluate(() => {
    const fw = window.__fw;
    const ch = fw.scene3d.clubhouse();
    const st = fw.scene3d.walk.state;
    const ip = ch.interior.position;
    const beforeClockMinute = fw.state.clock.minutes;
    const day = Math.floor(beforeClockMinute / 1440) * 1440;
    fw.state.clock.minutes = day + 14 * 60;
    st.x = ip.x; st.z = ip.z; st.yaw = 0; st.pitch = -0.05; st.vx = 0; st.vz = 0;
    return {
      inside: !!ch.isInside(st.x, st.z, 0.35),
      x: st.x,
      z: st.z,
      beforeClockMinute,
      clockMinute: fw.state.clock.minutes,
      clockNormalizedAfterColdDoor: true,
    };
  });
  await sleep(Number(process.env.GOAL24_PERF_SETTLE_MS || 2500));

  // Calibration is diagnostic, never part of the product gate. The exact same
  // temporary rAF sampler runs with the recorder absent, installed/inactive,
  // and active. This catches an "inert" recorder that quietly leaves a loop or
  // wrapper behind, and quantifies active overhead before acceptance samples.
  const calibrationMs = Number(process.env.GOAL24_PERF_CALIBRATION_MS || 1500);
  const absentCalibration = await sampleDisplayCadence(calibrationMs);
  let gpuFrameTimingInstall = {
    requested: gpuFrameTimingRequested,
    installed: false,
    reason: gpuFrameTimingRequested ? 'installation-not-attempted' : 'not-requested-for-this-leg',
  };
  if (gpuFrameTimingRequested) {
    const factorySource = gpuFrameTimingModule.goal24GpuFrameTimingFactorySource();
    gpuFrameTimingInstall = await page.evaluate(({ source }) => {
      if (globalThis.__goal24GpuFrameTiming) {
        throw new Error('Goal 24 GPU frame-timing probe is already installed.');
      }
      const scene3d = globalThis.__fw?.scene3d;
      const renderer = scene3d?.renderer;
      if (!scene3d || typeof scene3d.render !== 'function' || !renderer?.getContext) {
        throw new Error('Shipping scene3d renderer is unavailable for GPU frame timing.');
      }
      const createProbe = (0, eval)(source);
      const probe = createProbe({
        gl: renderer.getContext(),
        autoSchedulePolls: false,
      });
      const detach = probe.wrapRender(scene3d, 'render', ({ nextFrameSequence }) => ({
        ...(globalThis.__goal24GpuFrameTimingMetadata || {}),
        frameIndex: nextFrameSequence,
        rendererFrame: renderer.info?.render?.frame ?? null,
      }));
      globalThis.__goal24GpuFrameTiming = {
        probe,
        detach,
        installedAtMs: performance.now(),
      };
      const initial = probe.snapshot();
      return {
        requested: true,
        installed: true,
        reason: null,
        installedAtMs: globalThis.__goal24GpuFrameTiming.installedAtMs,
        context: initial.context,
        configuration: initial.configuration,
      };
    }, { source: factorySource });
    activeGpuFrameTiming = gpuFrameTimingInstall.installed === true;
  }
  report.gpuFrameTiming = { install: gpuFrameTimingInstall, evidence: null };
  const recorderInstall = await recorder.installGoal24InteractionRecorder(page);
  async function installPerformanceOverlay() {
    return page.evaluate(() => {
      if (globalThis.__goal24PerformanceOverlay) {
        throw new Error('Goal 24 performance overlay is already installed.');
      }
      const element = document.createElement('aside');
      element.id = 'goal24-performance-overlay';
      element.setAttribute('aria-label', 'Goal 24 diagnostic performance overlay');
      Object.assign(element.style, {
        position: 'fixed', top: '12px', right: '12px', zIndex: '2147483647',
        width: '310px', padding: '12px 14px', borderRadius: '8px',
        background: 'rgba(18, 28, 23, 0.92)', color: '#f5edda',
        border: '1px solid rgba(195, 160, 92, 0.9)',
        font: '13px/1.35 ui-monospace, SFMono-Regular, Consolas, monospace',
        whiteSpace: 'pre-wrap', pointerEvents: 'none', boxShadow: '0 4px 20px #0008',
      });
      document.body.append(element);
      const frameIntervals = new Float64Array(240);
      let count = 0;
      let cursor = 0;
      let lastRaf = null;
      let rafId = 0;
      let intervalId = 0;
      let updateCount = 0;
      const seenInteractionLabels = new Set();
      const frame = (timestamp) => {
        if (lastRaf != null) {
          frameIntervals[cursor] = timestamp - lastRaf;
          cursor = (cursor + 1) % frameIntervals.length;
          count = Math.min(frameIntervals.length, count + 1);
        }
        lastRaf = timestamp;
        rafId = requestAnimationFrame(frame);
      };
      const update = () => {
        const values = Array.from(frameIntervals.subarray(0, count)).sort((a, b) => a - b);
        const p95 = values.length ? values[Math.ceil(values.length * 0.95) - 1] : null;
        const recorderState = globalThis.__goal24InteractionRecorder?.diagnostics?.() || null;
        const label = recorderState?.activeScenario || 'between interactions';
        if (recorderState?.activeScenario) seenInteractionLabels.add(recorderState.activeScenario);
        const info = globalThis.__fw?.scene3d?.renderer?.info?.render;
        element.textContent = [
          'GOAL 24 — DIAGNOSTIC VIDEO (NOT GRADED)',
          `interaction: ${label}`,
          `display rAF latest: ${values.length ? values.at(-1).toFixed(2) : 'n/a'} ms`,
          `display rAF p95/rolling: ${p95 == null ? 'n/a' : p95.toFixed(2)} ms`,
          `shipping renderer frame: ${info?.frame ?? 'n/a'}`,
          `shipping draw calls (last frame): ${info?.calls ?? 'n/a'}`,
          'overlay update: 10 Hz; display samples: requestAnimationFrame',
          'render source: THREE.WebGLRenderer.info (read-only)',
        ].join('\n');
        updateCount += 1;
      };
      rafId = requestAnimationFrame(frame);
      intervalId = setInterval(update, 100);
      update();
      globalThis.__goal24PerformanceOverlay = {
        diagnostics() {
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return {
            enabled: true,
            visible: element.isConnected && style.display !== 'none'
              && style.visibility !== 'hidden' && Number(style.opacity) > 0
              && rect.width > 10 && rect.height > 10,
            updateCount,
            updateRateHz: 10,
            displaySamplingSource: 'requestAnimationFrame rolling intervals',
            renderSamplingSource: 'read-only THREE.WebGLRenderer.info.render last-frame counters',
            interactionLabelSource: '__goal24InteractionRecorder.diagnostics.activeScenario',
            seenInteractionLabels: [...seenInteractionLabels],
            elementId: element.id,
          };
        },
        updateNow() {
          update();
          return this.diagnostics();
        },
        uninstall() {
          cancelAnimationFrame(rafId);
          clearInterval(intervalId);
          const diagnostics = this.diagnostics();
          element.remove();
          delete globalThis.__goal24PerformanceOverlay;
          return { ...diagnostics, uninstalled: true };
        },
      };
      return globalThis.__goal24PerformanceOverlay.diagnostics();
    });
  }
  const inactiveBefore = await recorder.readInteractionRecorderDiagnostics(page);
  const inactiveCalibration = await sampleDisplayCadence(calibrationMs);
  await recorder.beginInteractionWindow(page, {
    id: 'recorder-calibration-active',
    scenario: 'recorderCalibration',
    repetition: 1,
    thermalState: 'warm',
    instrumentationMode: 'calibration-not-graded',
    maxDurationMs: calibrationMs + 2000,
  });
  const calibrationArmed = await recorder.awaitInteractionRenders(page, 3, 3000);
  const activeCalibration = await sampleDisplayCadence(calibrationMs);
  const calibrationPost = await recorder.awaitInteractionRenders(page, 2, 3000);
  const activeCalibrationWindow = await recorder.endInteractionWindow(page, {
    calibrationOnly: true,
    calibrationArmed,
    calibrationPost,
  });
  const inactiveAfter = await recorder.readInteractionRecorderDiagnostics(page);
  const calibrationStats = {
    absent: stats(absentCalibration.intervalsMs),
    installedInactive: stats(inactiveCalibration.intervalsMs),
    installedActiveExternal: stats(activeCalibration.intervalsMs),
    installedActiveRecorder: stats(activeCalibrationWindow.displayFrameIntervalsMs),
  };
  const calibrationReferenceP95 = Math.max(
    calibrationStats.absent.p95Ms || 0,
    calibrationStats.installedInactive.p95Ms || 0,
  );
  report.recorderCalibration = {
    method: 'same temporary typed-buffer rAF sampler; absent vs installed-inactive vs installed-active',
    durationMs: calibrationMs,
    install: recorderInstall,
    inactiveBefore,
    inactiveAfter,
    samples: {
      absent: { ...absentCalibration, stats: calibrationStats.absent },
      installedInactive: { ...inactiveCalibration, stats: calibrationStats.installedInactive },
      installedActiveExternal: { ...activeCalibration, stats: calibrationStats.installedActiveExternal },
      installedActiveRecorder: {
        droppedSamples: activeCalibrationWindow.droppedSamples,
        stats: calibrationStats.installedActiveRecorder,
      },
    },
    inactiveIsInert: [inactiveBefore, inactiveAfter].every((value) => (
      value.active === false
      && value.renderPatched === false
      && value.displayRafScheduled === false
      && value.inputListenersAttached === false
      && value.busyStallAlignmentPending === false
      && value.retainedCompletedWindows === 0
    )),
    activeP95OverheadWithinTolerance: Number.isFinite(calibrationStats.installedActiveExternal.p95Ms)
      && calibrationStats.installedActiveExternal.p95Ms
        <= Math.max(calibrationReferenceP95 * 1.25, calibrationReferenceP95 + 2),
  };
  report.environment = await recorder.readInteractionEnvironment(page);
  try {
    if (page.qaRunner?.snapshot) report.runner = await page.qaRunner.snapshot();
  } catch { /* the initial metadata still says unavailable */ }

  const cdp = await page.context().newCDPSession(page).catch(() => null);
  if (!cdp) throw new Error('Goal 24 resource proof requires a CDP session.');
  const resourceDiagnostics = await resourceDiagnosticsModule.createGoal24ResourceDiagnostics(
    page,
    { cdp },
  );
  const memoryCheckpoint = async (label, iteration, elapsedMs) => {
    const recorderState = await recorder.readInteractionRecorderDiagnostics(page);
    if (recorderState.active || recorderState.renderPatched || recorderState.displayRafScheduled) {
      throw new Error(`Resource checkpoint ${label} attempted inside a timed interaction.`);
    }
    const snapshot = await resourceDiagnostics.snapshot({
      label,
      outsideTimedInteraction: true,
      collectGarbage: true,
    });
    return {
      iteration,
      elapsedMs,
      snapshot,
    };
  };
  report.resourceBaseline = await memoryCheckpoint('run-resource-baseline', 0, 0);

  // A deliberate 80 ms renderer-thread stall is the instrument's perceptive
  // control. With GOAL24_PERF_DISABLE_STALL_CONTROL=1 the same code path must
  // fail instead of letting a non-perceptive sampler grade the product.
  if (wants('negative-control', 'control')) {
    await begin('negative-control-1', 'negativeControl', 1, 'warm');
    // Queue the restart and block for the recorder's next display tick. The
    // recorder consumes that tick, stalls, and only then requests another rAF,
    // forcing one real display interval to straddle the entire synchronous hitch.
    const immediateControl = await recorder.restartInteractionMeasurementWithBusyStall(
      page,
      'negative-control-armed-immediately-before-stall',
      negativeControlStallMs,
    );
    const busyStall = immediateControl.busyStall;
    const phaseAlignment = immediateControl.alignment;
    const phaseAlignmentOk = recorder.validateGoal24BusyStallPhaseAlignment(immediateControl);
    const preStallBoundary = {
      ok: Number.isFinite(immediateControl?.boundary?.priorDisplayBoundaryMs)
        && Number.isFinite(immediateControl?.boundary?.priorRenderBoundaryMs)
        && phaseAlignmentOk,
      ...immediateControl.boundary,
    };
    const actualBusyMs = busyStall.elapsedMs;
    const postStallBoundary = await recorder.awaitInteractionRenders(page, 3, 3000);
    const window = await end('negativeControl', { requestedMs: negativeControlStallMs, actualBusyMs });
    const displayWorst = window.metrics.displayRaf.worstMs || 0;
    const renderWorst = window.metrics.actualRender.worstMs || 0;
    const straddlesBusyStall = (entry) => entry.startAtMs <= busyStall.startedAtMs
      && entry.endAtMs >= busyStall.endedAtMs
      && entry.durationMs >= 50;
    const detectedInDisplayCadence = window.displayCadenceIntervals.some(straddlesBusyStall);
    const detectedInProductionRenderCadence = window.renderCadenceIntervals.some(straddlesBusyStall);
    report.controls.negativeControl = {
      requestedMs: negativeControlStallMs,
      actualBusyMs,
      busyStall,
      phaseAlignment,
      phaseAlignmentOk,
      preStallBoundary,
      postStallBoundary,
      observedDisplayWorstMs: displayWorst,
      observedRenderWorstMs: renderWorst,
      detectedInDisplayCadence,
      detectedInProductionRenderCadence,
      detected: negativeControlStallMs === 80
        && actualBusyMs >= negativeControlStallMs * 0.9
        && preStallBoundary.ok
        && postStallBoundary.ok
        && detectedInDisplayCadence
        && detectedInProductionRenderCadence,
    };
  }

  if (wants('idle')) {
    const idleBefore = await position();
    await begin('idle-1', 'idle', 1, 'warm');
    await sleep(5000);
    const idleAfter = await position();
    const idleDisplacementYards = Math.hypot(
      idleAfter.x - idleBefore.x,
      idleAfter.z - idleBefore.z,
    );
    await end('idle', {
      stationary: idleDisplacementYards <= 0.01,
      displacementYards: idleDisplacementYards,
      before: idleBefore,
      after: idleAfter,
    });
  }

  if (wants('walk', 'indoor-walk')) {
    await page.evaluate(() => {
      const fw = window.__fw;
      const ch = fw.scene3d.clubhouse();
      const st = fw.scene3d.walk.state;
      const ip = ch.interior.position;
      fw.scene3d.walk.setTool(null);
      st.x = ip.x; st.z = ip.z; st.yaw = 0; st.pitch = -0.05; st.vx = 0; st.vz = 0;
    });
    const walkMs = Number(process.env.GOAL24_PERF_WALK_MS || 60_000);
    const samples = [await position()];
    const moveKeys = [
      await binding('moveForward', 'w'),
      await binding('moveRight', 'd'),
      await binding('moveBack', 's'),
      await binding('moveLeft', 'a'),
    ];
    await begin('indoor-walk-1', 'indoorWalk', 1, 'warm', walkMs + 10_000);
    const walkStarted = Date.now();
    let leg = 0;
    while (Date.now() - walkStarted < walkMs) {
      await hold(
        moveKeys[leg % moveKeys.length],
        Math.min(1400, walkMs - (Date.now() - walkStarted)),
        'indoorWalk',
      );
      samples.push(await position());
      leg += 1;
    }
    let pathYards = 0;
    for (let index = 1; index < samples.length; index += 1) {
      pathYards += Math.hypot(samples[index].x - samples[index - 1].x, samples[index].z - samples[index - 1].z);
    }
    const distinctPositionChanges = samples.slice(1).filter((sample, index) => (
      Math.hypot(sample.x - samples[index].x, sample.z - samples[index].z) > 0.05
    )).length;
    const indoorWalkWindow = await end('indoorWalk', {
      requestedDurationMs: walkMs,
      pathYards,
      insidePct: samples.length ? 100 * samples.filter((sample) => sample.inside).length / samples.length : 0,
      distinctPositionChanges,
      samples,
    });
    indoorWalkWindow.discriminator.trustedMovementKeydowns = indoorWalkWindow.inputEvents.filter((event) => (
      event.type === 'keydown'
      && event.isTrusted === true
      && moveKeys.some((key) => String(key).toLowerCase() === String(event.key).toLowerCase())
    )).length;
  }

  if (wants('door')) {
    const interact = await binding('interact', 'e');
    await page.mouse.click(Math.round(viewport.width / 2), Math.round(viewport.height / 2));
    for (let repetition = 2; repetition <= 4; repetition += 1) {
      await approachDoor(repetition, 'warm');
    }
    for (let repetition = 1; repetition <= 4; repetition += 1) {
      await ensureMainDoorOpenOutsideMeasurement(interact);
      await crossDoor('outside-in', repetition + 1, 'warm');
      await crossDoor('inside-out', repetition, 'warm');
    }
    report.evidence.doorScreenshot = path.join(runDir, 'door-after-crossings.png');
    await page.screenshot({ path: report.evidence.doorScreenshot });
  }

  const ledgerDiagnostics = () => page.evaluate(() => {
    const fw = window.__fw;
    const book = fw.scene3d.clubhouse().ledgerBook;
    return {
      atMs: performance.now(),
      ledgerOpen: !!fw.ledgerOpen,
      heldKeys: fw.scene3d.walk.heldKeys?.() || [],
      ...book.diagnostics(),
    };
  });
  const stageLedger = () => page.evaluate(async () => {
    const fw = window.__fw;
    const ch = fw.scene3d.clubhouse();
    const walk = fw.scene3d.walk;
    const st = walk.state;
    let local = ch.ledgerBook.position;
    if (typeof local === 'function') local = ch.ledgerBook.position();
    const ip = ch.interior.position;
    const target = { x: ip.x + local.x, z: ip.z + local.z };
    const toCentre = { x: ip.x - target.x, z: ip.z - target.z };
    const length = Math.hypot(toCentre.x, toCentre.z) || 1;
    st.x = target.x + (toCentre.x / length) * 1.3;
    st.z = target.z + (toCentre.z / length) * 1.3;
    const baseYaw = Math.atan2(-(target.x - st.x), -(target.z - st.z));
    const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    for (const pitch of [-0.3, -0.15, 0]) {
      for (let index = 0; index < 10; index += 1) {
        st.yaw = baseYaw + ((index % 2 ? 1 : -1) * Math.ceil(index / 2) * 0.18);
        st.pitch = pitch;
        await pause(80);
        const focus = String(walk.getFocusLabel?.() || '');
        if (/ledger|read/i.test(focus)) return { focused: true, focus, target, position: { x: st.x, z: st.z } };
      }
    }
    return { focused: false, focus: String(walk.getFocusLabel?.() || ''), target };
  });
  const closeLedgerOutsideWindow = async () => {
    if (!await page.evaluate(() => !!window.__fw?.ledgerOpen)) return;
    const key = await binding('ledger', null) || await binding('dirtSense', 'q');
    await page.keyboard.press(key);
    await page.waitForFunction(() => !window.__fw?.ledgerOpen, null, { timeout: 8000 }).catch(() => {});
    await sleep(600);
  };
  const openLedger = async (repetition, thermalState) => {
    await closeLedgerOutsideWindow();
    const staged = await stageLedger();
    const hotkey = await binding('ledger', null);
    const interact = await binding('interact', 'e');
    if (!hotkey || !interact) throw new Error('Locked ledger protocol requires bound ledger and interact controls.');
    const entryKey = hotkey;
    const entryMethod = 'ledger-hotkey';
    const before = await ledgerDiagnostics().catch(() => null);
    await begin(`ledger-open-${repetition}`, 'ledgerOpen', repetition, thermalState);
    await mark('ledger-entry-key', { entryMethod, entryKey, staged });
    const entryRequest = await requestInput('keyboard', entryKey, {
      action: 'down',
      scenario: 'ledgerOpen',
      phase: 'raise-book',
    });
    await page.keyboard.down(entryKey);
    await page.keyboard.up(entryKey);
    await page.waitForFunction(() => !!window.__fw?.ledgerOpen, null, { timeout: 5000 }).catch(() => {});
    const entryConsumedAt = await ledgerDiagnostics().catch(() => null);
    await page.waitForFunction(() => {
      const state = window.__fw?.scene3d?.clubhouse?.()?.ledgerBook?.diagnostics?.()?.state;
      return state === 'held' || state === 'opening' || state === 'open';
    }, null, { timeout: 5000 }).catch(() => {});
    await mark('ledger-held', await ledgerDiagnostics().catch(() => null));
    const beforeSecond = await ledgerDiagnostics().catch(() => null);
    if (beforeSecond?.state === 'open') {
      throw new Error('Ledger cover opened before the required second interact control.');
    }
    const coverOpenRequest = await requestInput('keyboard', interact, {
      action: 'down',
      scenario: 'ledgerOpen',
      phase: 'open-cover',
    });
    await page.keyboard.down(interact);
    await page.keyboard.up(interact);
    const coverOpenConsumed = await page.waitForFunction(() => {
      const state = window.__fw?.scene3d?.clubhouse?.()?.ledgerBook?.diagnostics?.()?.state;
      return state === 'opening' || state === 'open';
    }, null, { timeout: 5000 }).then(async () => page.evaluate(() => ({
      atMs: performance.now(),
      signal: 'shipping-ledger-cover-opening-state',
    }))).catch(() => null);
    await page.waitForFunction(() => (
      window.__fw?.scene3d?.clubhouse?.()?.ledgerBook?.diagnostics?.()?.state === 'open'
    ), null, { timeout: 10_000 }).catch(() => {});
    await sleep(180);
    const after = await ledgerDiagnostics().catch(() => null);
    await mark('ledger-readable', after);
    const window = await end('ledgerOpen', {
      entryMethod,
      entryKey,
      interactKey: interact,
      staged,
      fromState: before?.state || 'closed',
      toState: after?.state || null,
      readable: after?.state === 'open' && after?.pageCount > 0,
      ledgerOwnsInput: after?.state === 'open' && after?.ledgerOpen === true,
      firstOpen: thermalState === 'cold',
      inputConsumed: entryConsumedAt?.ledgerOpen ? {
        atMs: entryConsumedAt.atMs,
        signal: 'shipping-ledger-mode-entered',
      } : null,
      entryModeConsumed: entryConsumedAt?.ledgerOpen ? {
        atMs: entryConsumedAt.atMs,
        signal: 'shipping-ledger-mode-entered',
      } : null,
      entryRequest,
      coverOpenRequest,
      productionHandlerConsumed: coverOpenConsumed,
      outcomeObservedAtMs: after?.atMs ?? null,
      state: after,
    });
    window.discriminator.entryKeyTrustedCount = trustedKeyCount(window, entryKey);
    return window;
  };
  const closeLedger = async (repetition, thermalState) => {
    const hotkey = await binding('ledger', null);
    const closeKey = hotkey || await binding('dirtSense', 'q');
    const before = await ledgerDiagnostics();
    await begin(`ledger-close-${repetition}`, 'ledgerClose', repetition, thermalState);
    await mark('ledger-close-key', { closeKey, before });
    await requestInput('keyboard', closeKey, { action: 'down', scenario: 'ledgerClose' });
    await page.keyboard.down(closeKey);
    await page.keyboard.up(closeKey);
    await page.waitForFunction(() => !window.__fw?.ledgerOpen, null, { timeout: 8000 }).catch(() => {});
    const modeExited = await ledgerDiagnostics().catch(() => null);
    await page.waitForFunction(() => {
      const state = window.__fw?.scene3d?.clubhouse?.()?.ledgerBook?.diagnostics?.()?.state;
      return state === 'closed' || state === 'lowering';
    }, null, { timeout: 8000 }).catch(() => {});
    await sleep(180);
    const after = await ledgerDiagnostics();
    const event = await end('ledgerClose', {
      closeKey,
      fromState: before?.state || null,
      toState: !after.ledgerOpen ? 'walking' : after?.state,
      walkControlRestored: !after.ledgerOpen,
      inputConsumed: modeExited && !modeExited.ledgerOpen ? {
        atMs: modeExited.atMs,
        signal: 'shipping-ledger-mode-exited',
      } : null,
      productionHandlerConsumed: modeExited && !modeExited.ledgerOpen ? {
        atMs: modeExited.atMs,
        signal: 'shipping-ledger-mode-exited',
      } : null,
      outcomeObservedAtMs: after?.atMs ?? null,
      closedMode: !after.ledgerOpen,
      state: after,
    });
    event.discriminator.keyTrustedCount = trustedKeyCount(event, closeKey);
    return event;
  };
  const turnLedger = async (index, scenario = 'ledgerPageTurn', idPrefix = 'ledger-page') => {
    const direction = index % 2 === 0 ? 1 : -1;
    const key = direction > 0 ? 'ArrowRight' : 'ArrowLeft';
    const before = await ledgerDiagnostics();
    await begin(`${idPrefix}-${index + 1}`, scenario, index + 1, 'warm');
    await mark('page-key', { key, direction, spreadBefore: before.spread });
    const contractScenarioId = scenario === 'ledgerPageTurnStress'
      ? 'ledgerTurns50Stress' : 'ledgerPageTurns10';
    await requestInput('keyboard', key, { action: 'down', scenario: contractScenarioId });
    await page.keyboard.down(key);
    await page.keyboard.up(key);
    const turnStarted = await page.waitForFunction((previousSpread) => {
      const diagnostics = window.__fw.scene3d.clubhouse().ledgerBook.diagnostics();
      return diagnostics.turning || diagnostics.spread !== previousSpread;
    }, before.spread, { timeout: ledgerPageTurnObservationTimeoutMs }).then(async () => ({
      observed: true,
      atMs: await page.evaluate(() => performance.now()),
    })).catch(() => ({ observed: false, atMs: null }));
    const turnFinished = await page.waitForFunction((previousSpread) => {
      const diagnostics = window.__fw.scene3d.clubhouse().ledgerBook.diagnostics();
      return !diagnostics.turning && diagnostics.spread !== previousSpread;
    }, before.spread, { timeout: ledgerPageTurnObservationTimeoutMs })
      .then(() => true).catch(() => false);
    const after = await ledgerDiagnostics();
    const event = await end(scenario, {
      key,
      direction,
      fromPage: before.spread,
      toPage: after.spread,
      bookAlreadyOpen: before.state === 'open',
      contentReady: turnStarted && turnFinished && after.state === 'open',
      spreadBefore: before.spread,
      spreadAfter: after.spread,
      turnStarted: turnStarted.observed,
      turnFinished,
      turned: turnStarted.observed && turnFinished && before.spread !== after.spread,
      inputConsumed: turnStarted.observed ? {
        atMs: turnStarted.atMs,
        signal: 'shipping-ledger-capture-handler-started-leaf-turn',
      } : null,
      productionHandlerConsumed: turnStarted.observed ? {
        atMs: turnStarted.atMs,
        signal: 'shipping-ledger-leaf-turn-started',
      } : null,
      outcomeObservedAtMs: after?.atMs ?? null,
      state: after.state,
    });
    event.discriminator.keyTrustedCount = trustedKeyCount(event, key);
    return event;
  };

  if (wants('ledger', 'ledger-stress')) {
    await openLedger(1, 'cold');
    for (let index = 0; index < 10; index += 1) {
      await turnLedger(index);
    }
    if (wants('ledger-stress')) {
      const targetTurns = 50;
      const stressStartedAt = nodePerformance.now();
      const checkpoints = [await memoryCheckpoint('ledger-turn-0', 0, 0)];
      for (let index = 0; index < targetTurns; index += 1) {
        await turnLedger(index, 'ledgerPageTurnStress', 'ledger-stress-page');
        if ((index + 1) % 10 === 0) {
          checkpoints.push(await memoryCheckpoint(
            `ledger-turn-${index + 1}`,
            index + 1,
            nodePerformance.now() - stressStartedAt,
          ));
        }
      }
      report.scenarios.ledgerStress = {
        requestedTurns: targetTurns,
        completedTurns: (report.scenarios.ledgerPageTurnStress?.events || [])
          .filter((event) => event.discriminator?.turned).length,
        checkpoints,
      };
    }
    await closeLedger(1, 'warm');
    await openLedger(2, 'warm');
    await closeLedger(2, 'warm');
    await openLedger(3, 'warm');
    await closeLedger(3, 'warm');
    report.evidence.ledgerScreenshot = path.join(runDir, 'ledger-open.png');
    await openLedger(4, 'warm');
    await page.screenshot({ path: report.evidence.ledgerScreenshot });
    await closeLedgerOutsideWindow();
  }

  const toolDiagnostics = () => page.evaluate(() => {
    const walk = window.__fw.scene3d.walk;
    const equipped = walk.getTool?.() ?? null;
    return {
      atMs: performance.now(),
      equipped,
      heldKeys: walk.heldKeys?.() || [],
      held: walk.heldToolDiagnostics?.() ?? null,
      change: walk.toolChangeDiagnostics?.() ?? null,
      rig: equipped ? walk.toolRigDiagnostics?.(equipped) ?? null : null,
      viewmodels: walk.toolViewmodelDiagnostics?.() ?? null,
      lazyBuildTimings: walk.lazyBuildTimings?.() ?? null,
    };
  });
  if (wants('tool', 'tool-stress')) {
    await closeLedgerOutsideWindow();
    const bareHandsStage = await page.evaluate(() => {
      const fw = window.__fw;
      const ch = fw.scene3d.clubhouse();
      const walk = fw.scene3d.walk;
      const st = fw.scene3d.walk.state;
      const ip = ch.interior.position;
      st.x = ip.x; st.z = ip.z; st.yaw = 0; st.pitch = -0.05;
      if (walk.getTool?.() != null) walk.setTool(null);
      if (fw.state.shop?.inventory?.vac1) fw.state.shop.inventory.vac1.back = Math.max(1, fw.state.shop.inventory.vac1.back || 0);
      return {
        atMs: performance.now(),
        composedRenders: fw.scene3d.post?.stats?.().composedRenders ?? null,
      };
    });
    const bareHandsReady = await page.waitForFunction((stage) => {
      const fw = window.__fw;
      const ch = fw.scene3d.clubhouse();
      const walk = fw.scene3d.walk;
      const st = walk.state;
      const held = walk.heldToolDiagnostics?.() ?? null;
      const viewmodels = walk.toolViewmodelDiagnostics?.() ?? null;
      const book = ch.ledgerBook?.diagnostics?.() ?? null;
      const composedRenders = fw.scene3d.post?.stats?.().composedRenders ?? null;
      const elapsedMs = performance.now() - stage.atMs;
      const ready = elapsedMs >= 180
        && Number.isInteger(stage.composedRenders)
        && Number.isInteger(composedRenders)
        && composedRenders >= stage.composedRenders + 3
        && fw.ledgerOpen === false
        && book?.state === 'closed' && book.open === false && book.carried === false
        && walk.getTool?.() == null
        && held?.heldRootVisible === false
        && held?.visibleHeldGroups?.length === 0
        && held?.animation?.settled === true
        && held?.stationStowedTool == null
        && viewmodels?.equippedTool == null
        && walk.heldKeys?.().length === 0
        && ch.isInside(st.x, st.z, 0.35) === true;
      return ready ? {
        atMs: performance.now(), elapsedMs, composedRenders,
        ledgerOpen: fw.ledgerOpen, book, held, viewmodels,
        equipped: walk.getTool?.() ?? null,
        heldKeys: walk.heldKeys?.() ?? [],
        inside: ch.isInside(st.x, st.z, 0.35),
      } : false;
    }, bareHandsStage, { timeout: 8000 }).then((handle) => handle.jsonValue()).catch(() => null);
    if (!bareHandsReady) {
      throw new Error(`Tool route did not reach a settled closed-ledger bare-hands boundary: ${JSON.stringify({
        bareHandsStage,
        current: await toolDiagnostics(),
        ledger: await ledgerDiagnostics().catch(() => null),
      })}`);
    }
    const toolKey = await binding('toolBelt', 'f');
    const observedTools = new Set();
    const initialToolDiagnostics = await toolDiagnostics();
    const productionEquipSequenceBase = initialToolDiagnostics.change?.sequence ?? 0;
    if (!Number.isInteger(productionEquipSequenceBase) || productionEquipSequenceBase < 0) {
      throw new Error('Tool first-use run could not capture its initial production equip sequence base.');
    }
    const switchTool = async (
      index,
      scenario,
      idPrefix,
      thermalState,
      firstUse,
      expectedToolId = null,
    ) => {
      const before = await toolDiagnostics();
      await begin(`${idPrefix}-${index + 1}`, scenario, index + 1, thermalState);
      await mark('tool-key', { key: toolKey, equippedBefore: before.equipped });
      const contractScenarioId = scenario === 'toolSwitchStress'
        ? 'toolSwitches100Stress'
        : scenario === 'toolFirstUse' ? 'toolFirstUseByTool' : 'toolChanges20';
      await requestInput('keyboard', toolKey, { action: 'down', scenario: contractScenarioId });
      await page.keyboard.down(toolKey);
      await requestInput('keyboard', toolKey, { action: 'up', scenario: contractScenarioId });
      await page.keyboard.up(toolKey);
      const consumed = await page.waitForFunction(({ previousTool, previousSequence }) => {
        const walk = window.__fw.scene3d.walk;
        const change = walk.toolChangeDiagnostics?.();
        return walk.getTool?.() !== previousTool
          && Number.isInteger(change?.sequence)
          && change.sequence > (previousSequence || 0)
          && change.previous === previousTool
          && change.next === walk.getTool?.();
      }, {
        previousTool: before.equipped,
        previousSequence: before.change?.sequence || 0,
      }, { timeout: 3000 }).then(() => toolDiagnostics()).catch(() => null);
      const presentationReady = await page.waitForFunction(() => {
        const walk = window.__fw.scene3d.walk;
        const equipped = walk.getTool?.() ?? null;
        const held = walk.heldToolDiagnostics?.();
        const viewmodels = walk.toolViewmodelDiagnostics?.();
        if (!held || !viewmodels) return false;
        if (equipped == null) {
          return viewmodels.equippedTool == null
            && held.heldRootVisible === false
            && held.visibleHeldGroups?.length === 0
            && held.animation?.settled === true;
        }
        const entry = viewmodels.tools?.[equipped];
        const rig = walk.toolRigDiagnostics?.(equipped);
        return viewmodels.equippedTool === equipped
          && held.heldRootVisible === true
          && held.visibleHeldGroups?.length === 1
          && held.visibleHeldGroups[0] === equipped
          && held.animation?.settled === true
          && (!entry || (entry.equipped === true && entry.equipAction?.settled === true))
          && (!rig || rig.vmActive === true);
      }, null, { timeout: toolPresentationObservationTimeoutMs })
        .then(() => toolDiagnostics()).catch(() => null);
      const after = await toolDiagnostics();
      if (expectedToolId != null && after.equipped !== expectedToolId) {
        throw new Error(`Tool belt selected ${after.equipped || 'empty hands'}; expected ${expectedToolId}.`);
      }
      const firstObservedForTool = after.equipped != null && !observedTools.has(after.equipped);
      if (firstUse && (!firstObservedForTool || presentationReady == null
        || presentationReady.held?.heldRootVisible !== true
        || presentationReady.held?.animation?.settled !== true)) {
        throw new Error(`First-use presentation did not become ready for ${after.equipped || 'empty hands'}: `
          + JSON.stringify({ before, consumed, presentationReady, after }));
      }
      if (after.equipped != null) observedTools.add(after.equipped);
      const event = await end(scenario, {
        key: toolKey,
        fromTool: before.equipped == null ? 'empty-hands' : String(before.equipped),
        toTool: after.equipped == null ? 'empty-hands' : String(after.equipped),
        equippedBefore: before.equipped,
        equippedAfter: after.equipped,
        changed: before.equipped !== after.equipped,
        firstUse,
        firstObservedForTool,
        processInstanceId,
        equipKey: toolKey,
        productionEquipSequence: consumed?.change?.sequence ?? null,
        productionEquipSignal: 'shipping-walk-toolChanged-edge',
        productionEquipAtMs: consumed?.change?.atMs ?? null,
        ...(scenario === 'toolFirstUse' ? {
          toolId: String(after.equipped || ''),
          supportedToolIds: [...supportedToolIds],
          heldToolVisible: presentationReady?.held?.heldRootVisible === true
            && presentationReady.held.visibleHeldGroups?.length === 1
            && presentationReady.held.visibleHeldGroups[0] === after.equipped,
          equipAnimationSettled: presentationReady?.held?.animation?.settled === true,
          productionEquipSequenceBase,
        } : {}),
        viewmodelReady: presentationReady != null,
        inputConsumed: consumed?.change ? {
          atMs: consumed.change.atMs,
          signal: 'shipping-walk-toolChanged-edge',
        } : null,
        productionHandlerConsumed: consumed?.change ? {
          atMs: consumed.change.atMs,
          signal: 'shipping-walk-toolChanged-edge',
        } : null,
        outcomeObservedAtMs: presentationReady?.atMs ?? null,
        presentation: presentationReady,
        authoredViewmodels: after.viewmodels?.authored ?? after.viewmodels?.authoredCount ?? null,
        activeTools: after.viewmodels?.activeTools ?? null,
      });
      event.discriminator.keyTrustedCount = trustedKeyCount(event, toolKey);
      return event;
    };

    for (let index = 0; index < supportedToolIds.length; index += 1) {
      await switchTool(
        index,
        'toolFirstUse',
        'tool-first-use',
        'cold',
        true,
        supportedToolIds[index],
      );
    }

    for (let index = 0; index < 20; index += 1) {
      await switchTool(
        index,
        'toolSwitch',
        'tool-switch',
        'warm',
        false,
      );
    }

    if (wants('tool-stress')) {
      const targetSwitches = 100;
      const stressStartedAt = nodePerformance.now();
      const checkpoints = [await memoryCheckpoint('tool-switch-0', 0, 0)];
      for (let index = 0; index < targetSwitches; index += 1) {
        await switchTool(index, 'toolSwitchStress', 'tool-stress-switch', 'warm', false);
        if ((index + 1) % 20 === 0) {
          checkpoints.push(await memoryCheckpoint(
            `tool-switch-${index + 1}`,
            index + 1,
            nodePerformance.now() - stressStartedAt,
          ));
        }
      }
      report.scenarios.toolStress = {
        requestedSwitches: targetSwitches,
        completedSwitches: (report.scenarios.toolSwitchStress?.events || [])
          .filter((event) => event.discriminator?.changed).length,
        distinctEquippedTools: [...observedTools],
        checkpoints,
        finalDiagnostics: await toolDiagnostics(),
      };
    }
  }

  if (wants('npc', 'nav')) {
    await page.evaluate(() => {
      const ch = window.__fw.scene3d.clubhouse();
      ch.clearWalkins?.();
      // Establish recorder boundaries while organic production is disabled so
      // the first route cannot race through the recorder's arming renders.
      ch.setOrganicWalkins?.(false);
      const state = window.__fw.state;
      state.shop.signOpen = false;
      const day = Math.floor(state.clock.minutes / 1440) * 1440;
      state.clock.minutes = day + 10 * 60;
    });
    await begin('npc-nav-activation-1', 'npcNavActivation', 1, 'cold');
    await page.evaluate(() => {
      delete globalThis.__goal24NpcLifecycleBoundaryObservation;
      globalThis.__goal24NpcLifecycleBoundary = (boundary) => {
        const recorderApi = globalThis.__goal24InteractionRecorder;
        if (!recorderApi?.restartAtMeasurementBoundary) {
          throw new Error('Goal 24 interaction recorder is not armed at the NPC lifecycle edge.');
        }
        const measurementBoundary = recorderApi.restartAtMeasurementBoundary(
          'organic-footfall-window-start',
        );
        globalThis.__goal24NpcLifecycleBoundaryObservation = {
          boundary: JSON.parse(JSON.stringify(boundary)),
          measurementBoundary,
          observedAtMs: performance.now(),
        };
      };
    });
    const before = await page.evaluate(() => ({
      atMs: performance.now(),
      count: window.__fw.scene3d.clubhouse().customers?.().length ?? null,
      customerIds: (window.__fw.scene3d.clubhouse().customers?.() || [])
        .map((customer) => customer.customerId),
      lazyBuildTimings: window.__fw.scene3d.walk.lazyBuildTimings?.() ?? null,
      navPerformance: window.__fw.scene3d.clubhouse().navPerformanceDiagnostics?.() ?? null,
    }));
    const navPerformanceSource =
      'shipping-clubhouse-makeNav-and-navFresh-monotonic-counters';
    const navBefore = before.navPerformance;
    if (navBefore?.schemaVersion !== 1 || navBefore.source !== navPerformanceSource
      || !Number.isFinite(navBefore.navCreateStartedAtMs)
      || !Number.isFinite(navBefore.navCreatedAtMs)
      || !Number.isFinite(navBefore.navCreateDurationMs)
      || navBefore.navCreatedAtMs < navBefore.navCreateStartedAtMs
      || Math.abs(
        (navBefore.navCreatedAtMs - navBefore.navCreateStartedAtMs)
          - navBefore.navCreateDurationMs
      ) > 0.001
      || navBefore.navFreshCallCount !== 0 || navBefore.navRebuildCount !== 0
      || navBefore.builtColliderVersion === navBefore.colliderVersion
      || navBefore.navRebuildTotalDurationMs !== 0
      || navBefore.navRebuildMaximumDurationMs !== 0
      || navBefore.navLastRebuildDurationMs !== null
      || navBefore.navLastRebuildAtMs !== null) {
      throw new Error(
        `NPC first-route window was prewarmed before organic navigation: ${JSON.stringify(navBefore)}`,
      );
    }
    await mark('await-production-organic-customer', before);
    await page.evaluate(() => {
      const ch = window.__fw.scene3d.clubhouse();
      const state = window.__fw.state;
      state.shop.signOpen = true;
      ch.setOrganicWalkins?.(true);
    });
    const lifecycleObserved = await page.waitForFunction((priorIds) => {
      const known = new Set(priorIds);
      return (window.__fw.scene3d.clubhouse().customers?.() || []).some((customer) => (
        customer.spawnSource === 'organic-footfall' && !known.has(customer.customerId)
      ));
    }, before.customerIds, { timeout: 45_000 }).then(async () => page.evaluate((priorIds) => {
      const clubhouse = window.__fw.scene3d.clubhouse();
      const customers = clubhouse.customers?.() || [];
      const known = new Set(priorIds);
      const customer = customers.find((candidate) => (
        candidate.spawnSource === 'organic-footfall' && !known.has(candidate.customerId)
      ));
      return {
        atMs: performance.now(),
        count: customers.length,
        customerId: customer?.customerId ?? null,
        visitorId: customer?.visitorId ?? null,
        spawnSource: customer?.spawnSource ?? null,
        createdAtMs: customer?.createdAtMs ?? null,
        lifecycleBoundaryId: customer?.lifecycleBoundaryId ?? null,
        lifecycleBoundaryAtMs: customer?.lifecycleBoundaryAtMs ?? null,
        boundaryObservation: globalThis.__goal24NpcLifecycleBoundaryObservation
          ? JSON.parse(JSON.stringify(globalThis.__goal24NpcLifecycleBoundaryObservation)) : null,
        signal: 'shipping-organic-footfall-customer-created',
      };
    }, before.customerIds)).catch(() => null);
    const routeObserved = await page.waitForFunction((customerId) => {
      const customer = (window.__fw.scene3d.clubhouse().customers?.() || [])
        .find((candidate) => candidate.customerId === customerId);
      return customer?.routeDiagnostics?.spawnSource === 'organic-footfall'
        && customer.routeDiagnostics.pathNodes > 0;
    }, lifecycleObserved?.customerId, { timeout: 8000 }).then(async () => page.evaluate((customerId) => {
      const clubhouse = window.__fw.scene3d.clubhouse();
      const customer = (clubhouse.customers?.() || [])
        .find((candidate) => candidate.customerId === customerId);
      const navPerformance = clubhouse.navPerformanceDiagnostics?.() ?? null;
      return {
        atMs: performance.now(),
        customerId,
        route: customer?.routeDiagnostics ? { ...customer.routeDiagnostics } : null,
        pathNodes: customer?.path?.length ?? 0,
        navPerformance,
        signal: 'same-organic-customer-route-observed-active',
      };
    }, lifecycleObserved?.customerId)).catch(() => null);
    const after = await page.evaluate(() => {
      const customers = window.__fw.scene3d.clubhouse().customers?.() || [];
      return {
        atMs: performance.now(),
        count: customers.length,
        customers: customers.map((customer) => ({
          customerId: customer.customerId ?? null,
          visitorId: customer.visitorId ?? null,
          spawnSource: customer.spawnSource ?? null,
          createdAtMs: customer.createdAtMs ?? null,
          routeDiagnostics: customer.routeDiagnostics ? { ...customer.routeDiagnostics } : null,
          state: customer.state ?? customer.entity?.state ?? null,
          pathNodes: Array.isArray(customer.path) ? customer.path.length : null,
          position: customer.mesh?.position
            ? { x: customer.mesh.position.x, z: customer.mesh.position.z }
            : null,
        })),
        lazyBuildTimings: window.__fw.scene3d.walk.lazyBuildTimings?.() ?? null,
        navPerformance: window.__fw.scene3d.clubhouse().navPerformanceDiagnostics?.() ?? null,
        performanceMeasures: performance.getEntriesByType('measure').slice(-30).map((entry) => ({
          name: entry.name, startTime: entry.startTime, duration: entry.duration,
        })),
      };
    });
    const npcLifecycleBoundary = lifecycleObserved?.boundaryObservation ?? null;
    if (npcLifecycleBoundary?.boundary?.lifecycleId !== lifecycleObserved?.lifecycleBoundaryId
      || npcLifecycleBoundary.boundary.lifecycleId !== routeObserved?.route?.lifecycleBoundaryId
      || npcLifecycleBoundary.boundary.atMs !== lifecycleObserved?.lifecycleBoundaryAtMs
      || npcLifecycleBoundary.boundary.atMs !== routeObserved?.route?.lifecycleBoundaryAtMs
      || npcLifecycleBoundary.measurementBoundary?.atMs == null) {
      throw new Error(`Organic NPC lifecycle boundary was not exactly bound: ${JSON.stringify({
        npcLifecycleBoundary, lifecycleObserved, routeObserved,
      })}`);
    }
    const navAfter = routeObserved?.route?.navPerformanceAtResolution ?? null;
    const navAtObservation = routeObserved?.navPerformance ?? null;
    const navPerformanceDelta = {
      navFreshCallCount: Number(navAfter?.navFreshCallCount) - Number(navBefore.navFreshCallCount),
      navRebuildCount: Number(navAfter?.navRebuildCount) - Number(navBefore.navRebuildCount),
      navRebuildTotalDurationMs: Number(navAfter?.navRebuildTotalDurationMs)
        - Number(navBefore.navRebuildTotalDurationMs),
    };
    const sceneLoadedAtMs = navBefore.navCreatedAtMs;
    const sceneLoaded = Number.isFinite(sceneLoadedAtMs)
      && sceneLoadedAtMs <= npcLifecycleBoundary.measurementBoundary.atMs;
    if (navAfter?.schemaVersion !== 1 || navAfter.source !== navPerformanceSource
      || !sceneLoaded
      || navAfter.navFreshCallCount !== navBefore.navFreshCallCount + 1
      || navAfter.navRebuildCount !== navBefore.navRebuildCount + 1
      || navAfter.builtColliderVersion !== navAfter.colliderVersion
      || navAfter.colliderVersion !== navBefore.colliderVersion
      || navAfter.navCreateStartedAtMs !== navBefore.navCreateStartedAtMs
      || navAfter.navCreatedAtMs !== navBefore.navCreatedAtMs
      || navAfter.navCreateDurationMs !== navBefore.navCreateDurationMs
      || navAfter.routeRequestId !== routeObserved.route.requestId
      || navAfter.customerId !== routeObserved.customerId
      || navAfter.lifecycleBoundaryId !== routeObserved.route.lifecycleBoundaryId
      || navAfter.capturedAtMs !== routeObserved.route.resolvedAtMs
      || !Number.isFinite(navAfter.navRebuildTotalDurationMs)
      || !Number.isFinite(navAfter.navRebuildMaximumDurationMs)
      || !Number.isFinite(navAfter.navLastRebuildDurationMs)
      || !Number.isFinite(navAfter.navLastRebuildAtMs)
      || navAfter.navLastRebuildAtMs < routeObserved.route.requestedAtMs
      || navAfter.navLastRebuildAtMs > routeObserved.route.resolvedAtMs
      || navPerformanceDelta.navFreshCallCount !== 1
      || navPerformanceDelta.navRebuildCount !== 1
      || !Number.isFinite(navPerformanceDelta.navRebuildTotalDurationMs)
      || navAtObservation?.schemaVersion !== 1
      || navAtObservation?.source !== navPerformanceSource
      || !Number.isFinite(navAtObservation.capturedAtMs)
      || navAtObservation.capturedAtMs < navAfter.capturedAtMs
      || navAtObservation.capturedAtMs > routeObserved.atMs
      || navAtObservation.navFreshCallCount < navAfter.navFreshCallCount
      || navAtObservation.navRebuildCount < navAfter.navRebuildCount) {
      throw new Error(`Organic NPC did not pay exactly one first shipping nav rebuild: ${JSON.stringify({
        navBefore, navAfter, navAtObservation, navPerformanceDelta, routeObserved,
      })}`);
    }
    const lifecycleEvent = await end('npcNavActivation', {
      trigger: 'shipping-organic-footfall-loop',
      beforeCount: before.count,
      afterCount: after.count,
      sceneLoaded,
      sceneLoadedAtMs,
      navCreateDurationMs: navBefore.navCreateDurationMs,
      navPerformanceBefore: navBefore,
      navPerformanceAfter: navAfter,
      navPerformanceAtObservation: navAtObservation,
      navPerformanceDelta,
      customerActivated: lifecycleObserved?.spawnSource === 'organic-footfall',
      customerId: lifecycleObserved?.customerId ?? null,
      routeResolved: routeObserved?.route?.pathNodes > 0,
      routeRequestId: routeObserved?.route?.requestId ?? '',
      lifecycleWindowStartedAtMs: npcLifecycleBoundary.measurementBoundary.atMs,
      lifecycleBoundaryId: npcLifecycleBoundary.boundary.lifecycleId,
      lifecycleBoundaryAtMs: npcLifecycleBoundary.boundary.atMs,
      lifecycleMeasurementBoundary: npcLifecycleBoundary.measurementBoundary,
      routeRequestedAtMs: routeObserved?.route?.requestedAtMs ?? null,
      routeResolvedAtMs: routeObserved?.route?.resolvedAtMs ?? null,
      customerCreated: lifecycleObserved?.spawnSource === 'organic-footfall',
      routeRequested: routeObserved?.route?.pathNodes > 0,
      productionHandlerConsumed: routeObserved?.route ? {
        atMs: routeObserved.route.requestedAtMs,
        signal: 'shipping-navFresh-path-request-for-same-organic-customer',
      } : null,
      outcomeObservedAtMs: routeObserved?.atMs ?? null,
      lifecycleObserved,
      routeObserved,
      after,
    });
    await page.evaluate(() => {
      delete globalThis.__goal24NpcLifecycleBoundary;
      delete globalThis.__goal24NpcLifecycleBoundaryObservation;
    });
    lifecycleEvent.discriminator.directSpawnUsed = false;
  }

      // A cap ladder is homogeneous and separately labelled. It never mixes with
  // interaction windows or their warm thresholds.
  if (wants('cap-ladder')) {
    report.scenarios.capLadder = { events: [] };
    const requestedCaps = String(process.env.GOAL24_PERF_CAPS || '60,120,144,0')
      .split(',').map((value) => Number(value.trim())).filter((value) => Number.isFinite(value) && value >= 0);
    let displayRefreshHz = Number(
      report.runner?.readbacks?.driverSnapshots?.at(-1)?.main?.display?.displayFrequency
      ?? report.runner?.readbacks?.beforeDriver?.main?.display?.displayFrequency ?? 0,
    );
    if (!(displayRefreshHz > 0) && page.electronApp) {
      displayRefreshHz = Number(await page.electronApp.evaluate(({ BrowserWindow, screen }) => {
        const window = BrowserWindow.getAllWindows()[0];
        return window ? screen.getDisplayMatching(window.getBounds()).displayFrequency : null;
      }).catch(() => 0));
    }
    if (!(displayRefreshHz > 0)) {
      throw new Error('Display refresh readback is required for the cap ladder.');
    }
    report.scenarios.capLadder.displayRefreshHz = displayRefreshHz || null;
    report.scenarios.capLadder.skipped = [];
    for (const cap of requestedCaps) {
      if (cap === 120 && displayRefreshHz > 0 && displayRefreshHz < 119) {
        report.scenarios.capLadder.skipped.push({
          cap,
          reason: `display readback ${displayRefreshHz} Hz cannot present 120 fps`,
        });
        continue;
      }
      await page.evaluate((value) => window.__fw.preferences.set('display.fpsCap', value), cap);
      await sleep(500);
      await begin(`cap-${cap || 'uncapped'}`, 'capLadder', report.scenarios.capLadder.events.length + 1, 'warm');
      await sleep(5000);
      await end('capLadder', { requestedCap: cap, appliedCap: await page.evaluate(() => window.__fw.preferences.values.display.fpsCap) });
    }
    await page.evaluate(() => window.__fw.preferences.set('display.fpsCap', 60));
  }

  const contributionInput = {
    doorApproach: { kind: 'keyboard', control: 'move-forward-binding', delivery: 'playwright-keyboard' },
    doorFirstOpen: { kind: 'keyboard', control: 'door-interact-binding', delivery: 'playwright-keyboard' },
    doorCrossingOutsideToInside: { kind: 'keyboard', control: 'move-forward-binding', delivery: 'playwright-keyboard' },
    doorCrossingInsideToOutside: { kind: 'keyboard', control: 'move-forward-binding', delivery: 'playwright-keyboard' },
    ledgerOpen: { kind: 'keyboard', control: 'ledger-entry-binding', delivery: 'playwright-keyboard' },
    ledgerPageTurns10: { kind: 'keyboard', control: 'ledger-page-arrow', delivery: 'playwright-keyboard' },
    ledgerClose: { kind: 'keyboard', control: 'ledger-close-binding', delivery: 'playwright-keyboard' },
    toolChanges20: { kind: 'keyboard', control: 'tool-belt-binding', delivery: 'playwright-keyboard' },
    toolFirstUseByTool: { kind: 'keyboard', control: 'tool-belt-binding', delivery: 'playwright-keyboard' },
    ledgerTurns50Stress: { kind: 'keyboard', control: 'ledger-page-arrow', delivery: 'playwright-keyboard' },
    toolSwitches100Stress: { kind: 'keyboard', control: 'tool-belt-binding', delivery: 'playwright-keyboard' },
  };
  const triggerEventType = (contractId) => (
    contractId === 'toolFirstUseByTool' || contractId === 'toolChanges20'
      || contractId === 'toolSwitches100Stress'
      ? 'keyup' : 'keydown'
  );
  const contributionScenarioSource = {
    doorApproach: 'doorApproach',
    doorFirstOpen: 'doorOpen',
    doorCrossingOutsideToInside: 'doorCrossing:outside-in',
    doorCrossingInsideToOutside: 'doorCrossing:inside-out',
    ledgerOpen: 'ledgerOpen',
    ledgerPageTurns10: 'ledgerPageTurn',
    ledgerClose: 'ledgerClose',
    toolChanges20: 'toolSwitch',
    toolFirstUseByTool: 'toolFirstUse',
    npcNavActivation: 'npcNavActivation',
    ledgerTurns50Stress: 'ledgerPageTurnStress',
    toolSwitches100Stress: 'toolSwitchStress',
  };
  const assertContribution = (condition, message) => {
    if (!condition) throw new Error(`Locked contribution refused: ${message}`);
  };
  const eventTarget = (target) => JSON.stringify(target || { kind: 'non-element-event-target' });
  const measuredCadenceAvailability = (rawEvent, cadenceKey, source) => {
    const endpointsKey = cadenceKey === 'display'
      ? 'displayCadenceIntervals' : 'renderCadenceIntervals';
    const coverageKey = cadenceKey === 'display'
      ? 'measurementPriorDisplayBoundaryMs' : 'measurementPriorRenderBoundaryMs';
    const endpointBoundary = rawEvent?.[endpointsKey]?.[0]?.startAtMs;
    const coverageBoundary = rawEvent?.sampleCoverage?.[coverageKey];
    assertContribution(Number.isFinite(endpointBoundary)
      && Number.isFinite(coverageBoundary)
      && Math.abs(endpointBoundary - coverageBoundary) <= 0.05,
    `${rawEvent?.id || 'raw event'} ${cadenceKey} cadence lacks its exact prior boundary.`);
    return {
      status: 'measured',
      priorBoundaryAtMs: endpointBoundary,
      priorBoundarySource: source,
    };
  };
  const makeOutcome = (
    spec,
    markerEnd,
    signal,
    observationSource = 'driver-observed production state followed by two measured production-render boundaries',
  ) => ({
    signal,
    observationSource,
    observed: true,
    markerName: spec.markerNames[1],
    atMs: markerEnd,
  });
  const adaptRegularEvent = (contractId, rawEvent, sequence, rawEventIndex) => {
    const spec = contractSpecById.get(contractId);
    const descriptor = contributionInput[contractId];
    assertContribution(spec && descriptor, `${contractId} has no locked adapter.`);
    const expectedKey = String(rawEvent.discriminator?.key || '').toLowerCase();
    const expectedEventType = triggerEventType(contractId);
    let inputEvent = (rawEvent.inputEvents || []).find((event) => (
      event.type === expectedEventType
      && event.isTrusted === true
      && (!expectedKey || String(event.key || '').toLowerCase() === expectedKey)
    ));
    const requestedAction = expectedEventType === 'keyup' ? 'up' : 'down';
    let requested = (rawEvent.driverInputRequests || []).find((entry) => (
      entry.kind === descriptor.kind && entry.detail?.action === requestedAction
    ));
    let ledgerOpenSequence = null;
    if (contractId === 'ledgerOpen') {
      const keydowns = (rawEvent.inputEvents || []).filter((event) => (
        event.type === 'keydown' && event.isTrusted === true
      ));
      const requests = (rawEvent.driverInputRequests || []).filter((entry) => (
        entry.kind === 'keyboard' && entry.detail?.action === 'down'
      ));
      const expectedSteps = [
        {
          control: rawEvent.discriminator?.entryKey,
          phase: 'raise-book',
          consumed: rawEvent.discriminator?.entryModeConsumed,
        },
        {
          control: rawEvent.discriminator?.interactKey,
          phase: 'open-cover',
          consumed: rawEvent.discriminator?.productionHandlerConsumed,
        },
      ];
      assertContribution(keydowns.length === 2 && requests.length === 2,
        `${rawEvent.id} must capture exactly two ledger keydown requests and deliveries.`);
      ledgerOpenSequence = expectedSteps.map((expected, index) => {
        const event = keydowns[index];
        const request = requests[index];
        assertContribution(String(event?.key || '').toLowerCase() === String(expected.control || '').toLowerCase(),
          `${rawEvent.id} ledger step ${index + 1} delivered the wrong control.`);
        assertContribution(String(request?.control || '').toLowerCase() === String(expected.control || '').toLowerCase()
          && request?.detail?.phase === expected.phase,
        `${rawEvent.id} ledger step ${index + 1} request is not bound to ${expected.phase}.`);
        assertContribution(Number.isFinite(request?.atMs) && request.atMs <= event?.atMs
          && (index === 0 || request.atMs >= keydowns[index - 1].atMs),
        `${rawEvent.id} ledger step ${index + 1} request/delivery timestamps are not ordered.`);
        assertContribution(Number.isFinite(expected.consumed?.atMs)
          && expected.consumed.atMs >= event.atMs
          && (index === expectedSteps.length - 1 || expected.consumed.atMs <= requests[index + 1]?.atMs),
        `${rawEvent.id} ledger step ${index + 1} lacks independently ordered consumption.`);
        return {
          phase: expected.phase,
          control: expected.control,
          requestedAtMs: request.atMs,
          requestSource: request.source,
          requestKind: request.kind,
          deliveredAtMs: event.atMs,
          consumed: expected.consumed,
          eventType: event.type,
          key: event.key,
          code: event.code,
          target: eventTarget(event.target),
          source: 'capturing-DOM-input-listener',
          isTrusted: true,
          trustBasis: 'browser-isTrusted',
          eventTimestampMs: event.eventTimestampMs,
          observedAtMs: event.observedAtMs,
        };
      });
      inputEvent = keydowns[1];
      requested = requests[0];
    }
    const consumed = rawEvent.discriminator?.productionHandlerConsumed;
    assertContribution(inputEvent, `${rawEvent.id} has no matching trusted captured ${expectedEventType}.`);
    assertContribution(Number.isFinite(requested?.atMs) && requested.atMs <= inputEvent.atMs,
      `${rawEvent.id} has no ordered driver input-request timestamp.`);
    assertContribution(Number.isFinite(consumed?.atMs) && consumed.signal,
      `${rawEvent.id} has no production-handler consumption proof.`);
    assertContribution(Number.isFinite(rawEvent.startedAtMs) && Number.isFinite(rawEvent.endedAtMs)
      && rawEvent.endedAtMs > rawEvent.startedAtMs, `${rawEvent.id} has invalid recorder boundaries.`);
    assertContribution(inputEvent.atMs >= rawEvent.startedAtMs && inputEvent.atMs <= rawEvent.endedAtMs,
      `${rawEvent.id} trusted input falls outside its measured window.`);
    assertContribution(consumed.atMs >= inputEvent.atMs && consumed.atMs <= rawEvent.endedAtMs,
      `${rawEvent.id} production consumption is not ordered after delivery.`);
    assertContribution(Number.isFinite(rawEvent.discriminator?.outcomeObservedAtMs)
      && rawEvent.discriminator.outcomeObservedAtMs >= consumed.atMs
      && rawEvent.discriminator.outcomeObservedAtMs <= rawEvent.endedAtMs,
    `${rawEvent.id} has no ordered production outcome observation.`);
    const discriminator = JSON.parse(JSON.stringify(rawEvent.discriminator));
    if (contractId === 'doorApproach') {
      discriminator.endZone = discriminator.endedOutside ? 'outside' : 'inside';
      discriminator.freshProcess = rawEvent.thermalState === 'cold';
    }
    if (contractId === 'ledgerPageTurns10' || contractId === 'ledgerTurns50Stress') {
      discriminator.direction = discriminator.direction > 0 ? 'right' : 'left';
    }
    const recordId = `${contractId}-input-${sequence}`;
    const endAtMs = rawEvent.discriminator.contractOutcomeMarkerAtMs;
    assertContribution(Number.isFinite(endAtMs) && endAtMs >= rawEvent.discriminator.outcomeObservedAtMs
      && endAtMs <= rawEvent.endedAtMs, `${rawEvent.id} has no ordered driver outcome marker.`);
    const event = {
      scenarioId: contractId,
      sequence,
      temperature: rawEvent.thermalState,
      rawSource: {
        scenario: contributionScenarioSource[contractId], id: rawEvent.id, eventIndex: rawEventIndex,
      },
      input: {
        recordId,
        ...descriptor,
        ...(contractId === 'ledgerOpen' ? { control: 'ledger-raise-and-cover-open-sequence' } : {}),
        evidencePolicy: spec.triggerEvidencePolicy,
        productionPath: true,
        directStateMutation: false,
      },
      markers: {
        start: { name: spec.markerNames[0], clock: spec.markerClock, atMs: rawEvent.startedAtMs },
        end: { name: spec.markerNames[1], clock: spec.markerClock, atMs: endAtMs },
      },
      cadenceAvailability: {
        display: measuredCadenceAvailability(
          rawEvent,
          'display',
          'recorder-preserved immediately preceding display requestAnimationFrame boundary',
        ),
        render: measuredCadenceAvailability(
          rawEvent,
          'render',
          'recorder-preserved immediately preceding shipping scene3d.render boundary',
        ),
      },
      displayFrameIntervalsMs: rawEvent.displayFrameIntervalsMs,
      displayCadenceIntervals: rawEvent.displayCadenceIntervals,
      renderFrameIntervalsMs: rawEvent.renderFrameIntervalsMs,
      renderCadenceIntervals: rawEvent.renderCadenceIntervals,
      sampleCoverage: rawEvent.sampleCoverage,
      discriminator,
      ...(doorEvidenceModule.GOAL24_DOOR_SCENARIOS.includes(contractId) ? {
        doorwayRenderEvidence: rawEvent.doorwayRenderEvidence,
      } : {}),
    };
    const record = {
      recordId,
      scenarioId: contractId,
      eventSequence: sequence,
      rawSource: {
        scenario: contributionScenarioSource[contractId], id: rawEvent.id, eventIndex: rawEventIndex,
      },
      clock: spec.markerClock,
      requestedAtMs: requested.atMs,
      deliveredAtMs: inputEvent.atMs,
      request: {
        atMs: requested.atMs,
        source: requested.source,
        kind: requested.kind,
        actualControl: requested.control,
        action: requested.detail?.action,
        scenarioId: contractId,
        rawScenario: requested.detail?.scenario,
      },
      ...descriptor,
      ...(contractId === 'ledgerOpen' ? { control: 'ledger-raise-and-cover-open-sequence' } : {}),
      evidencePolicy: spec.triggerEvidencePolicy,
      raw: {
        eventType: ledgerOpenSequence ? 'keydown-sequence' : inputEvent.type,
        target: eventTarget(inputEvent.target),
        source: 'capturing-DOM-input-listener',
        isTrusted: true,
        trustBasis: 'browser-isTrusted',
        atMs: inputEvent.atMs,
        eventTimestampMs: inputEvent.eventTimestampMs,
        observedAtMs: inputEvent.observedAtMs,
        code: inputEvent.code,
        key: inputEvent.key,
        ...(ledgerOpenSequence ? { steps: ledgerOpenSequence } : {}),
      },
      consumed: {
        signal: consumed.signal,
        productionHandlerObserved: true,
        atMs: consumed.atMs,
      },
      outcome: makeOutcome(
        spec,
        endAtMs,
        `observed-production-state-then-render-boundaries:${contractId}`,
      ),
    };
    return { event, record };
  };
  const adaptRegularScenario = (contractId) => {
    const rawEvents = report.scenarios[contributionScenarioSource[contractId]]?.events || [];
    const records = [];
    const events = rawEvents.map((rawEvent, index) => {
      const adapted = adaptRegularEvent(contractId, rawEvent, index + 1, index);
      records.push(adapted.record);
      return adapted.event;
    });
    return { scenario: { id: contractId, events }, records };
  };
  const adaptColdLaunch = () => {
    const spec = contractSpecById.get('coldLaunch');
    const rawEvent = report.scenarios.coldLaunch.events[0];
    const startAtMs = rawEvent.markers[0].atEpochMs;
    const endAtMs = rawEvent.markers[1].atEpochMs;
    const consumedAtMs = timingAnchors.electronLaunchResolved?.epochMs;
    assertContribution(Number.isFinite(startAtMs) && Number.isFinite(endAtMs)
      && endAtMs > startAtMs, 'cold launch lacks ordered launcher anchors.');
    assertContribution(Number.isFinite(consumedAtMs) && consumedAtMs >= startAtMs
      && consumedAtMs <= endAtMs, 'cold launch lacks an ordered child-launch resolution anchor.');
    const recordId = 'coldLaunch-input-1';
    const event = {
      sequence: 1,
      scenarioId: 'coldLaunch',
      temperature: 'cold',
      rawSource: { scenario: 'coldLaunch', id: rawEvent.id, eventIndex: 0 },
      input: {
        recordId,
        kind: 'process',
        control: 'electron-launch',
        delivery: 'electron-main-process',
        evidencePolicy: spec.triggerEvidencePolicy,
        productionPath: true,
        directStateMutation: false,
      },
      markers: {
        start: { name: spec.markerNames[0], clock: spec.markerClock, atMs: startAtMs },
        end: { name: spec.markerNames[1], clock: spec.markerClock, atMs: endAtMs },
      },
      cadenceAvailability: {
        display: { status: 'unavailable', reason: 'renderer page context did not exist at launcher request' },
        render: { status: 'unavailable', reason: 'shipping game renderer did not exist at launcher request' },
      },
      displayFrameIntervalsMs: [],
      displayCadenceIntervals: [],
      renderFrameIntervalsMs: [],
      renderCadenceIntervals: [],
      sampleCoverage: {
        complete: true,
        windowDurationMs: endAtMs - startAtMs,
        droppedDisplaySamples: 0,
        droppedRenderSamples: 0,
        droppedSubmissionSamples: 0,
        displayFirstBoundaryOffsetMs: null,
        displayLastBoundaryBeforeEndMs: null,
        renderFirstBoundaryOffsetMs: null,
        renderLastBoundaryBeforeEndMs: null,
      },
      discriminator: rawEvent.discriminator,
    };
    return {
      scenario: { id: 'coldLaunch', events: [event] },
      records: [{
        recordId,
        scenarioId: 'coldLaunch',
        eventSequence: 1,
        rawSource: { scenario: 'coldLaunch', id: rawEvent.id, eventIndex: 0 },
        clock: spec.markerClock,
        requestedAtMs: startAtMs,
        deliveredAtMs: startAtMs,
        kind: 'process',
        control: 'electron-launch',
        delivery: 'electron-main-process',
        evidencePolicy: spec.triggerEvidencePolicy,
        raw: {
          eventType: 'electron-launch-request',
          target: 'electron-main-process',
          source: 'qa-runner-electronLaunchRequested-anchor',
          isTrusted: null,
          trustBasis: 'launcher-process-anchor',
          atMs: startAtMs,
          processInstanceId,
          runnerLaunchId,
          electronMainProcessCreationTimeEpochMs,
        },
        consumed: {
          signal: 'playwright-electron-launch-resolved-with-child-pid',
          productionHandlerObserved: true,
          atMs: consumedAtMs,
        },
        outcome: makeOutcome(
          spec,
          endAtMs,
          'main-menu-enabled-and-save-refresh-settled',
          'runner-observed menu-ready anchor after Electron launch; renderer cadence is unavailable before page context',
        ),
      }],
    };
  };
  const adaptStart = () => {
    const spec = contractSpecById.get('startToControllable');
    const rawEvent = report.scenarios.startGame.events[0];
    const inputEvent = startControlInput;
    const startAtMs = inputEvent?.atEpochMs;
    const endAtMs = startSample.firstControllableDisplayBoundaryEpochMs;
    const consumedAtMs = startSample.menuControlConsumedAtEpochMs;
    assertContribution(rawEvent.traceIdentity?.id === expectedStartTraceIdentity.id
      && rawEvent.traceIdentity?.scenario === expectedStartTraceIdentity.scenario,
    'start transition raw event is not bound to the dedicated trace identity.');
    assertContribution(inputEvent?.isTrusted === true && Number.isFinite(startAtMs),
      'start transition has no trusted captured menu click.');
    assertContribution(Number.isFinite(startControlRequest?.atEpochMs)
      && startControlRequest.atEpochMs <= startAtMs,
    'start transition has no ordered driver click-request timestamp.');
    assertContribution(Number.isFinite(endAtMs) && endAtMs > startAtMs,
      'start transition lacks its controllable display boundary.');
    assertContribution(Number.isFinite(consumedAtMs) && consumedAtMs >= startAtMs
      && consumedAtMs <= endAtMs, 'menu click consumption is not ordered inside start transition.');
    const movement = rawEvent.discriminator?.movementProbe;
    assertContribution(movement?.request?.kind === 'keyboard'
      && movement.request?.detail?.phase === 'movement-probe'
      && movement.delivery?.type === 'keydown'
      && movement.delivery?.isTrusted === true
      && Number.isFinite(movement.consumed?.atMs)
      && movement.consumed.atMs >= movement.delivery.atMs
      && Number.isFinite(movement.displacement) && movement.displacement > 0.02
      && Number.isFinite(movement.observedAtMs)
      && movement.observedAtMs >= movement.consumed.atMs,
    'start transition lacks ordered request/delivery/consumption/displacement evidence.');
    assertContribution(Number.isFinite(rawEvent.discriminator?.confirmedControllableRenderAtMs)
      && rawEvent.discriminator.confirmedControllableRenderAtMs
        >= movement.confirmationRequestedAtMs
      && Number.isFinite(rawEvent.discriminator?.confirmedControllableDisplayBoundaryAtMs)
      && rawEvent.discriminator.confirmedControllableDisplayBoundaryAtMs
        >= rawEvent.discriminator.confirmedControllableRenderAtMs,
    'start transition lacks a shipping render and display boundary after movement observation confirmation.');
    const recordId = 'startToControllable-input-1';
    return {
      scenario: { id: 'startToControllable', events: [{
        scenarioId: 'startToControllable',
        sequence: 1,
        temperature: 'cold',
        rawSource: { scenario: 'startGame', id: rawEvent.id, eventIndex: 0 },
        traceIdentity: { ...rawEvent.traceIdentity },
        input: {
          recordId,
          kind: 'pointer',
          control: 'new-game-control',
          delivery: 'playwright-pointer',
          evidencePolicy: spec.triggerEvidencePolicy,
          productionPath: true,
          directStateMutation: false,
        },
        markers: {
          start: { name: spec.markerNames[0], clock: spec.markerClock, atMs: startAtMs },
          end: { name: spec.markerNames[1], clock: spec.markerClock, atMs: endAtMs },
        },
        cadenceAvailability: {
          display: measuredCadenceAvailability(
            rawEvent,
            'display',
            'dedicated start recorder preserved the menu display boundary preceding the trusted click',
          ),
          render: {
            ...measuredCadenceAvailability(
              rawEvent,
              'render',
              'first observed shipping scene3d.render boundary after render instrumentation attached',
            ),
            measurementStartedAtMs: rawEvent.discriminator.renderCadenceMeasurementStartedAtMs,
            preMeasurementReason: 'shipping scene3d.render did not exist before this timestamp',
          },
        },
        displayFrameIntervalsMs: rawEvent.displayFrameIntervalsMs,
        displayCadenceIntervals: rawEvent.displayCadenceIntervals,
        renderFrameIntervalsMs: rawEvent.renderFrameIntervalsMs,
        renderCadenceIntervals: rawEvent.renderCadenceIntervals,
        sampleCoverage: rawEvent.sampleCoverage,
        discriminator: rawEvent.discriminator,
      }] },
      records: [{
        recordId,
        scenarioId: 'startToControllable',
        eventSequence: 1,
        rawSource: { scenario: 'startGame', id: rawEvent.id, eventIndex: 0 },
        clock: spec.markerClock,
        requestedAtMs: startControlRequest.atEpochMs,
        deliveredAtMs: startAtMs,
        request: {
          atMs: startControlRequest.atEpochMs,
          source: startControlRequest.source,
          kind: startControlRequest.kind,
          actualControl: startControlRequest.control,
          action: startControlRequest.detail?.action,
          scenarioId: 'startToControllable',
          rawScenario: startControlRequest.detail?.scenario,
        },
        kind: 'pointer',
        control: 'new-game-control',
        delivery: 'playwright-pointer',
        evidencePolicy: spec.triggerEvidencePolicy,
        raw: {
          eventType: inputEvent.type,
          target: eventTarget(inputEvent.target),
          source: 'capturing-DOM-input-listener',
          isTrusted: true,
          trustBasis: 'browser-isTrusted',
          atMs: startAtMs,
          eventTimestampMs: inputEvent.eventTimestampMs,
          observedAtMs: startAtMs,
          clientX: inputEvent.clientX,
          clientY: inputEvent.clientY,
          button: inputEvent.button,
          targetElement: inputEvent.target,
          targetControlLabel: expectedMenuControl,
        },
        consumed: {
          signal: 'shipping-menu-control-opened-difficulty-selection',
          productionHandlerObserved: true,
          atMs: consumedAtMs,
        },
        outcome: makeOutcome(
          spec,
          endAtMs,
          'walk-active-and-veil-clear-at-production-render-boundary',
          'dedicated transition recorder observed one controllable shipping render followed by its first display-rAF boundary',
        ),
      }],
    };
  };
  const adaptNpc = () => {
    const spec = contractSpecById.get('npcNavActivation');
    const rawEvent = report.scenarios.npcNavActivation.events[0];
    const startAtMs = rawEvent.startedAtMs;
    const endAtMs = rawEvent.endedAtMs;
    const consumed = rawEvent.discriminator.productionHandlerConsumed;
    const routeObservedAtMs = rawEvent.discriminator.routeObserved?.atMs;
    const navEvidenceFailures = contractModule.goal24NpcNavEvidenceFailures(rawEvent);
    assertContribution(navEvidenceFailures.length === 0,
      `NPC first-route navigation evidence failed: ${navEvidenceFailures.join('; ')}`);
    assertContribution(Number.isFinite(consumed?.atMs) && consumed.atMs >= startAtMs
      && consumed.atMs <= endAtMs, 'NPC lifecycle consumption is not ordered inside its window.');
    assertContribution(Number.isFinite(routeObservedAtMs)
      && routeObservedAtMs >= rawEvent.discriminator.routeResolvedAtMs
      && routeObservedAtMs <= endAtMs,
    'NPC route outcome observation is not bound to the same resolved route inside its window.');
    const recordId = 'npcNavActivation-input-1';
    const discriminator = JSON.parse(JSON.stringify(rawEvent.discriminator));
    return {
      scenario: { id: 'npcNavActivation', events: [{
        scenarioId: 'npcNavActivation',
        sequence: 1,
        temperature: 'cold',
        rawSource: { scenario: 'npcNavActivation', id: rawEvent.id, eventIndex: 0 },
        input: {
          recordId,
          kind: 'lifecycle',
          control: 'first-organic-customer-route',
          delivery: 'production-lifecycle-observer',
          evidencePolicy: spec.triggerEvidencePolicy,
          productionPath: true,
          directStateMutation: false,
        },
        markers: {
          start: { name: spec.markerNames[0], clock: spec.markerClock, atMs: startAtMs },
          end: { name: spec.markerNames[1], clock: spec.markerClock, atMs: endAtMs },
        },
        cadenceAvailability: {
          display: measuredCadenceAvailability(
            rawEvent,
            'display',
            'recorder-preserved display boundary immediately before organic lifecycle work',
          ),
          render: measuredCadenceAvailability(
            rawEvent,
            'render',
            'recorder-preserved shipping render boundary immediately before organic lifecycle work',
          ),
        },
        displayFrameIntervalsMs: rawEvent.displayFrameIntervalsMs,
        displayCadenceIntervals: rawEvent.displayCadenceIntervals,
        renderFrameIntervalsMs: rawEvent.renderFrameIntervalsMs,
        renderCadenceIntervals: rawEvent.renderCadenceIntervals,
        sampleCoverage: rawEvent.sampleCoverage,
        discriminator,
      }] },
      records: [{
        recordId,
        scenarioId: 'npcNavActivation',
        eventSequence: 1,
        rawSource: { scenario: 'npcNavActivation', id: rawEvent.id, eventIndex: 0 },
        clock: spec.markerClock,
        requestedAtMs: startAtMs,
        deliveredAtMs: startAtMs,
        kind: 'lifecycle',
        control: 'first-organic-customer-route',
        delivery: 'production-lifecycle-observer',
        evidencePolicy: spec.triggerEvidencePolicy,
        raw: {
          eventType: 'organic-customer-lifecycle-window-start',
          target: 'clubhouse.customer-lifecycle',
          source: 'production-customer-lifecycle-observer',
          isTrusted: null,
          trustBasis: 'production-lifecycle-observation',
          atMs: startAtMs,
          routeRequestId: discriminator.routeRequestId,
        },
        consumed: {
          signal: consumed.signal,
          productionHandlerObserved: true,
          atMs: consumed.atMs,
        },
        outcome: makeOutcome(
          spec,
          endAtMs,
          'same-organic-customer-route-remained-active-after-render-boundaries',
          'driver observed the exact customer route activation, then two measured production-render boundaries',
        ),
      }],
    };
  };
  const stressResources = (summaryName, expectedIterations) => {
    const checkpoints = report.scenarios[summaryName]?.checkpoints || [];
    assertContribution(checkpoints.length >= lockedProtocol.stress.minimumResourceCheckpoints,
      `${summaryName} lacks resource checkpoints.`);
    assertContribution(checkpoints[0]?.iteration === 0
      && checkpoints.at(-1)?.iteration === expectedIterations,
    `${summaryName} checkpoints do not span the exact stress iteration count.`);
    return {
      rawSource: { scenario: summaryName },
      samples: checkpoints.map((checkpoint) => structuredClone(checkpoint)),
    };
  };

  const endRunnerSnapshot = page.qaRunner?.snapshot
    ? await page.qaRunner.snapshot('goal24-driver-end') : report.runner;
  report.runner = endRunnerSnapshot;
  const readback = endRunnerSnapshot?.readbacks?.driverSnapshots?.at(-1)
    || endRunnerSnapshot?.readbacks?.beforeDriver || {};
  const rendererReadback = readback.renderer || {};
  const mainReadback = readback.main || {};
  const rendererClock = rendererReadback.clock || {};
  const captureStartEpochMs = readback.captureStartedAtEpochMs;
  const captureEndEpochMs = readback.captureCompletedAtEpochMs;
  const rendererSampleEpochMs = rendererClock.sampledAtEpochMs;
  const clockBridgeUncertaintyMs = [captureStartEpochMs, captureEndEpochMs, rendererSampleEpochMs]
    .every(Number.isFinite) && rendererSampleEpochMs >= captureStartEpochMs
      && rendererSampleEpochMs <= captureEndEpochMs
    ? captureEndEpochMs - captureStartEpochMs : null;
  report.contractEnvironment = {
    toolManifest: JSON.parse(JSON.stringify(expectedToolManifest)),
    renderer: {
      name: 'THREE.WebGLRenderer',
      api: rendererReadback.renderer?.webgl?.context || 'WebGL',
      version: rendererReadback.renderer?.webgl?.version || 'unknown-WebGL-version',
      hardwareAccelerated: report.controls.hardwareRenderer === true,
      contextLost: rendererReadback.renderer?.webgl?.contextLost,
    },
    gpu: {
      vendor: rendererReadback.renderer?.webgl?.unmaskedVendor
        || rendererReadback.renderer?.webgl?.vendor || 'unknown-vendor',
      renderer: rendererReadback.renderer?.webgl?.unmaskedRenderer
        || rendererReadback.renderer?.webgl?.renderer || 'unknown-renderer',
      backend: rendererReadback.renderer?.webgl?.context || 'WebGL',
    },
    window: {
      innerWidth: rendererReadback.viewport?.innerWidth,
      innerHeight: rendererReadback.viewport?.innerHeight,
      outerWidth: rendererReadback.viewport?.outerWidth,
      outerHeight: rendererReadback.viewport?.outerHeight,
      mode: mainReadback.window?.fullscreen ? 'fullscreen' : 'windowed',
      focused: mainReadback.window?.focused === true && rendererReadback.documentFocused === true,
      visible: mainReadback.window?.visible === true && rendererReadback.visibilityState === 'visible',
    },
    devicePixelRatio: rendererReadback.viewport?.devicePixelRatio,
    quality: {
      preset: rendererReadback.quality?.quality,
      renderScale: rendererReadback.quality?.renderScale,
      shadows: rendererReadback.quality?.shadows,
      ambientOcclusion: rendererReadback.quality?.ambientOcclusion,
      bloom: rendererReadback.quality?.bloom,
    },
    profile: {
      name: 'goal24-unified-interaction',
      processInstanceId,
      runnerLaunchId,
      electronMainProcessCreationTimeEpochMs,
      userDataProfileId: endRunnerSnapshot?.profile?.profileId,
      electronLaunchRequestedAtEpochMs: endRunnerSnapshot?.timing?.anchors
        ?.electronLaunchRequested?.epochMs,
      saveFixture: process.env.GOAL24_PERF_SAVE_FIXTURE || `relaxed-seed-${seed}`,
      cameraRoute: process.env.GOAL24_PERF_ROUTE
        || 'goal24-indoor-route-v1',
      userDataDirectory: endRunnerSnapshot?.profile?.actualPath || endRunnerSnapshot?.profile?.path,
      userDataPolicy: 'isolated-fresh-per-cold-process',
      coldRunProfileRoot: endRunnerSnapshot?.profile?.generatedUnder,
      shaderCachePolicy: endRunnerSnapshot?.cachePolicy?.gpuDriverShaderCache,
      gpuCachePolicy: endRunnerSnapshot?.cachePolicy?.chromiumDiskCache,
      seed,
      supportedToolIds: [...supportedToolIds],
    },
    instrumentation: {
      mode: instrumentationMode,
      gradeEligible: instrumentationMode === 'low-overhead'
        && endRunnerSnapshot?.instrumentation?.lowOverheadEligible === true,
      displayCadenceSource: 'requestAnimationFrame',
      renderCadenceSource: 'actual-render-callback',
      runtimeClock: 'performance.now',
      launcherClock: 'epoch-bridged-runner-monotonic-clock',
      tracing: endRunnerSnapshot?.instrumentation?.chromiumTrace?.enabled === true,
      overlay: process.env.GOAL24_PERF_OVERLAY === '1',
      video: endRunnerSnapshot?.instrumentation?.video?.enabled === true,
      gcBeforeResourceCheckpoint: true,
      clockBridge: {
        domain: 'unix-epoch-milliseconds',
        source: 'renderer epoch sample bounded by runner capture-start/capture-end wall-clock bracket',
        captureStartedAtEpochMs: captureStartEpochMs,
        rendererSampledAtEpochMs: rendererSampleEpochMs,
        captureCompletedAtEpochMs: captureEndEpochMs,
        maximumUncertaintyMs: clockBridgeUncertaintyMs,
      },
    },
  };

  report.environmentAfter = await recorder.readInteractionEnvironment(page);
  report.resourceFinal = await memoryCheckpoint(
    'run-resource-final',
    1,
    Date.now() - new Date(report.capturedAtUtc).getTime(),
  );
  report.protocolPins = {
    seed,
    clubhouse: 'pine-hills-v2',
    saveFixture: process.env.GOAL24_PERF_SAVE_FIXTURE || `relaxed-seed-${seed}`,
    route: process.env.GOAL24_PERF_ROUTE || 'goal24-indoor-route-v1',
    camera: process.env.GOAL24_PERF_CAMERA || 'goal24-first-person-player-camera-v1',
    toolManifest: JSON.parse(JSON.stringify(expectedToolManifest)),
    resolution: { width: viewport.width, height: viewport.height },
    windowMode: process.env.GOAL24_PERF_FULLSCREEN === '1' ? 'fullscreen' : 'windowed',
    quality: {
      preset: report.contractEnvironment.quality.preset,
      renderScale: report.contractEnvironment.quality.renderScale,
      shadows: report.contractEnvironment.quality.shadows,
      ambientOcclusion: report.contractEnvironment.quality.ambientOcclusion,
      bloom: report.contractEnvironment.quality.bloom,
    },
    cache: {
      shaderCache: process.env.GOAL24_PERF_SHADER_CACHE_POLICY
        || endRunnerSnapshot?.cachePolicy?.gpuDriverShaderCache,
      gpuDriverCache: process.env.GOAL24_PERF_GPU_CACHE_POLICY
        || endRunnerSnapshot?.cachePolicy?.gpuDriverShaderCache,
      userDataPolicy: process.env.GOAL24_PERF_USER_DATA_POLICY
        || 'isolated-fresh-per-cold-process',
    },
  };

  const contributionParts = (builders) => {
    const scenarios = [];
    const inputRecords = [];
    for (const build of builders) {
      const part = build();
      scenarios.push(part.scenario);
      inputRecords.push(...part.records);
    }
    return { scenarios, inputRecords };
  };
  if (instrumentationMode === 'low-overhead') {
    const provenance = {
      sourceRunId: report.runId,
      instrumentationMode: 'low-overhead',
      lowOverheadEligible: endRunnerSnapshot?.instrumentation?.lowOverheadEligible === true,
      hardwareRenderer: report.controls.hardwareRenderer === true,
      recorderCalibrationPass: report.recorderCalibration?.inactiveIsInert === true
        && report.recorderCalibration?.activeP95OverheadWithinTolerance === true,
    };
    const fullContributionReady = [
      'ledgerOpen', 'ledgerPageTurn', 'ledgerClose', 'toolFirstUse', 'toolSwitch',
      'npcNavActivation', 'ledgerPageTurnStress', 'toolSwitchStress',
    ].every((name) => (report.scenarios[name]?.events || []).length > 0);
    const coldContributionReady = (report.scenarios.doorApproach?.events || []).length > 0
      && (report.scenarios.doorOpen?.events || []).length > 0;
    if (fullContributionReady) {
      const parts = contributionParts([
        () => adaptRegularScenario('ledgerOpen'),
        () => adaptRegularScenario('ledgerPageTurns10'),
        () => adaptRegularScenario('ledgerClose'),
        () => adaptRegularScenario('toolFirstUseByTool'),
        () => adaptRegularScenario('toolChanges20'),
        adaptNpc,
        () => adaptRegularScenario('ledgerTurns50Stress'),
        () => adaptRegularScenario('toolSwitches100Stress'),
      ]);
      parts.scenarios.find(({ id }) => id === 'ledgerTurns50Stress').resources =
        stressResources('ledgerStress', 50);
      parts.scenarios.find(({ id }) => id === 'toolSwitches100Stress').resources =
        stressResources('toolStress', 100);
      const controlWindow = report.scenarios.negativeControl?.events?.[0];
      assertContribution(controlWindow, 'full contribution lacks the perceptive negative control.');
      report.contractContribution = {
        provenance,
        environment: report.contractEnvironment,
        resourceBaseline: structuredClone(report.resourceBaseline),
        resourceFinal: structuredClone(report.resourceFinal),
        negativeControl: {
          rawSource: { scenario: 'negativeControl', id: controlWindow.id, eventIndex: 0 },
          kind: lockedProtocol.negativeControl.kind,
          injectedDurationMs: lockedProtocol.negativeControl.injectedDurationMs,
          sameInstrumentation: true,
          busyLoopElapsedMs: controlWindow.discriminator?.actualBusyMs,
          markers: {
            start: {
              name: 'busy-stall-begin',
              clock: 'renderer',
              atMs: report.controls.negativeControl?.busyStall?.startedAtMs,
            },
            end: {
              name: 'busy-stall-end',
              clock: 'renderer',
              atMs: report.controls.negativeControl?.busyStall?.endedAtMs,
            },
          },
          displayFrameIntervalsMs: controlWindow.displayFrameIntervalsMs,
          renderFrameIntervalsMs: controlWindow.renderFrameIntervalsMs,
          displayCadenceIntervals: controlWindow.displayCadenceIntervals,
          renderCadenceIntervals: controlWindow.renderCadenceIntervals,
        },
        ...parts,
      };
    } else if (coldContributionReady) {
      const parts = contributionParts([
        adaptColdLaunch,
        adaptStart,
        () => adaptRegularScenario('doorApproach'),
        () => adaptRegularScenario('doorFirstOpen'),
        () => adaptRegularScenario('doorCrossingOutsideToInside'),
        () => adaptRegularScenario('doorCrossingInsideToOutside'),
      ]);
      report.contractContribution = { provenance, ...parts };
    }
  }
  report.controls.startGameOccurred = report.scenarios.startGame.events[0]?.discriminator?.walkActive === true
    && report.scenarios.startGame.events[0]?.discriminator?.veilDrawn === false;
  report.controls.everyRequestedScenarioDiscriminated = Object.entries(report.scenarios)
    .filter(([key]) => !['coldLaunch', 'ledgerStress', 'toolStress'].includes(key))
    .every(([, scenario]) => (scenario.events || []).every((event) => event.discriminator != null));
  report.controls.noPageErrors = report.diagnostics.pageErrors.length === 0;
  report.controls.noConsoleErrors = report.diagnostics.consoleErrors.length === 0;
  report.controls.instrumentationModeDeclared = [
    'low-overhead', 'video', 'cdp-trace', 'cdp-trace+video',
  ].includes(instrumentationMode);
  report.controls.rendererAndDisplayStreamsPresent = Object.values(report.scenarios)
    .flatMap((scenario) => scenario.events || [])
    .filter((event) => event.metrics && !['coldLaunch', 'startGame'].includes(event.scenario))
    .every((event) => event.metrics.displayRaf.samples > 0 && event.metrics.actualRender.samples > 0);
  const measuredDpr = rendererReadback.viewport?.devicePixelRatio;
  report.controls.physicalViewportMatchesRequest = Number.isFinite(measuredDpr)
    && Math.round(rendererReadback.viewport?.innerWidth * measuredDpr) === viewport.width
    && Math.round(rendererReadback.viewport?.innerHeight * measuredDpr) === viewport.height;
  report.controls.windowModeMatchesRequest = report.contractEnvironment.window.mode
    === report.protocolPins.windowMode;
  report.controls.qualityMatchesPins = JSON.stringify(report.contractEnvironment.quality)
    === JSON.stringify(report.protocolPins.quality);

  const resultPath = path.join(runDir, 'raw.json');
  const summaryPath = path.join(runDir, 'summary.md');
  report.resultPath = resultPath.replaceAll('\\', '/');
  report.summaryPath = summaryPath.replaceAll('\\', '/');

  const rows = [];
  for (const [scenario, value] of Object.entries(report.scenarios)) {
    for (const event of value.events || []) {
      if (!event.metrics) continue;
      rows.push({
        scenario,
        id: event.id,
        thermal: event.thermalState,
        renderP95: event.metrics.actualRender.p95Ms,
        renderWorst: event.metrics.actualRender.worstMs,
        over33: event.metrics.actualRender.over33,
        over50: event.metrics.actualRender.over50,
        displayP95: event.metrics.displayRaf.p95Ms,
      });
    }
  }
  const markdown = [
    `# Goal 24 interaction performance — ${runId}`,
    '',
    `Instrumentation: ${instrumentationMode}`,
    '',
    '| Scenario | Event | State | render p95 ms | render worst ms | >33 | >50 | display p95 ms |',
    '|---|---|---:|---:|---:|---:|---:|---:|',
    ...rows.map((row) => `| ${row.scenario} | ${row.id} | ${row.thermal} | ${row.renderP95 ?? 'n/a'} | ${row.renderWorst ?? 'n/a'} | ${row.over33 ?? 'n/a'} | ${row.over50 ?? 'n/a'} | ${row.displayP95 ?? 'n/a'} |`),
    '',
  ].join('\n');
  let overlayUninstall = null;
  if (overlayRequested) {
    overlayUninstall = await page.evaluate(() => (
      globalThis.__goal24PerformanceOverlay?.uninstall?.() || null
    )).catch((error) => ({
      enabled: true,
      visible: false,
      uninstalled: false,
      error: String(error?.message || error),
    }));
    report.overlay = overlayUninstall;
  }
  report.controls.performanceOverlayActive = overlayRequested
    && overlayUninstall?.enabled === true
    && overlayUninstall?.visible === true
    && overlayUninstall?.uninstalled === true
    && overlayUninstall?.updateCount > 0
    && overlayUninstall?.updateRateHz === 10
    && Array.isArray(overlayUninstall?.seenInteractionLabels)
    && overlayUninstall.seenInteractionLabels.length > 0;
  const recorderUninstall = await recorder.uninstallGoal24InteractionRecorder(page).catch((error) => ({
    uninstalled: false,
    error: String(error?.message || error),
  }));
  const gpuFrameTimingCleanup = await page.evaluate(async () => {
    const owner = globalThis.__goal24GpuFrameTiming;
    if (!owner?.probe) {
      delete globalThis.__goal24GpuFrameTimingMetadata;
      return {
        installed: false, detached: false, flushed: false, disposed: false, evidence: null,
      };
    }
    // Stop producing queries before flushing. Leaving the render wrapper live
    // lets every polling rAF enqueue one more query, so a healthy stream can
    // time out forever with exactly one unresolved tail query and be marked
    // invalid during disposal.
    const detached = owner.detach?.() === true;
    if (!detached) throw new Error('GPU frame-timing render wrapper did not detach before flush.');
    const flushed = await owner.probe.flush({ timeoutMs: 5000 });
    const disposed = owner.probe.dispose();
    delete globalThis.__goal24GpuFrameTimingMetadata;
    delete globalThis.__goal24GpuFrameTiming;
    return {
      installed: true,
      detached,
      flushed: flushed?.gpu?.counters?.pendingQueries === 0,
      flushGpuValidity: flushed?.gpu?.validity ?? null,
      disposed: disposed?.disposed === true,
      evidence: disposed?.evidence ?? null,
    };
  }).catch((error) => ({
    installed: activeGpuFrameTiming,
    detached: false,
    flushed: false,
    disposed: false,
    evidence: null,
    error: String(error?.message || error),
  }));
  report.gpuFrameTiming = {
    install: gpuFrameTimingInstall,
    evidence: gpuFrameTimingCleanup.evidence,
  };
  const resourceDispose = await resourceDiagnostics.dispose().then((disposed) => ({
    disposed,
    error: null,
  })).catch((error) => ({ disposed: false, error: String(error?.message || error) }));
  const cdpDetach = await cdp.detach().then(() => ({ detached: true, error: null }))
    .catch((error) => ({ detached: false, error: String(error?.message || error) }));
  report.cleanup = {
    overlay: overlayUninstall,
    recorder: recorderUninstall,
    gpuFrameTiming: {
      installed: gpuFrameTimingCleanup.installed,
      detached: gpuFrameTimingCleanup.detached,
      flushed: gpuFrameTimingCleanup.flushed,
      flushGpuValidity: gpuFrameTimingCleanup.flushGpuValidity ?? null,
      disposed: gpuFrameTimingCleanup.disposed,
      error: gpuFrameTimingCleanup.error ?? null,
    },
    resourceDispose,
    cdpDetach,
  };
  report.controls.recorderUninstalled = recorderUninstall?.uninstalled === true;
  report.controls.gpuFrameTimingClean = !gpuFrameTimingRequested || (
    gpuFrameTimingInstall.installed === true
    && gpuFrameTimingCleanup.detached === true
    && gpuFrameTimingCleanup.flushed === true
    && gpuFrameTimingCleanup.flushGpuValidity?.valid === true
    && gpuFrameTimingCleanup.disposed === true
    && gpuFrameTimingCleanup.evidence?.lifecycle?.disposed === true
    && gpuFrameTimingCleanup.evidence?.cleanup?.leakFree === true
  );
  report.controls.resourceDiagnosticsDisposed = resourceDispose.disposed === true;
  report.controls.cdpDetached = cdpDetach.detached === true;
  // Teardown can itself surface deferred promise rejections, WebGL errors, or
  // console failures.  Re-evaluate these controls only after every driver-owned
  // observer/session has been disposed so the raw artifact covers the complete
  // driver lifecycle rather than just the measured interaction windows.
  report.controls.noPageErrors = report.diagnostics.pageErrors.length === 0;
  report.controls.noConsoleErrors = report.diagnostics.consoleErrors.length === 0;
  const requiredControls = [
    report.controls.hardwareRenderer,
    report.controls.startGameOccurred,
    report.controls.everyRequestedScenarioDiscriminated,
    report.controls.noPageErrors,
    report.controls.noConsoleErrors,
    report.controls.instrumentationModeDeclared,
    report.controls.runnerInstrumentationAuthority,
    report.controls.rendererAndDisplayStreamsPresent,
    report.controls.physicalViewportMatchesRequest,
    report.controls.windowModeMatchesRequest,
    report.controls.qualityMatchesPins,
    report.controls.recorderUninstalled,
    report.controls.gpuFrameTimingClean,
    report.controls.resourceDiagnosticsDisposed,
    report.controls.cdpDetached,
    report.recorderCalibration?.inactiveIsInert === true,
    instrumentationMode === 'low-overhead'
      ? report.recorderCalibration?.activeP95OverheadWithinTolerance === true
      : true,
    wants('negative-control', 'control') ? report.controls.negativeControl?.detected === true : true,
    overlayRequested ? report.controls.performanceOverlayActive === true : true,
  ];
  const ok = requiredControls.every(Boolean);
  report.requiredControls = requiredControls;
  report.ok = ok;
  report.completedAtUtc = new Date().toISOString();
  fs.writeFileSync(resultPath, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(summaryPath, `${markdown}\n`);
  return {
    ok,
    runId,
    resultPath: report.resultPath,
    summaryPath: report.summaryPath,
    instrumentationMode,
    controls: report.controls,
    scenarioEventCounts: Object.fromEntries(Object.entries(report.scenarios)
      .map(([key, value]) => [key, value.events?.length ?? null])),
  };
}
