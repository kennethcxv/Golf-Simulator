async (page) => {
  const probeStartedAt = Date.now();
  const numberEnv = (name, fallback, { integer = false, min = 0 } = {}) => {
    const parsed = Number(process.env[name]);
    const value = Number.isFinite(parsed) ? parsed : fallback;
    return Math.max(min, integer ? Math.floor(value) : value);
  };
  const cycleCount = numberEnv('RELOAD_CYCLES', 6, { integer: true, min: 1 });
  const delayedGlbMs = numberEnv('RELOAD_DELAY_GLB_MS', 0, { integer: true });
  const delayedRequestLimit = numberEnv('RELOAD_DELAY_REQUESTS', delayedGlbMs > 0 ? 1 : 0, {
    integer: true,
  });
  const delayedGlb = process.env.RELOAD_DELAY_GLB || 'vendor/models/clubhouse/delivery_van.glb';
  const delayedRoute = delayedGlb.includes('*')
    ? delayedGlb
    : `**/${delayedGlb.replace(/^\/+/, '')}`;
  const captureContextClose = process.env.RELOAD_CAPTURE_CONTEXT_CLOSE !== '0';
  const waitTimeoutMs = numberEnv(
    'RELOAD_WAIT_TIMEOUT_MS',
    Math.max(90000, delayedGlbMs + 70000),
    { integer: true, min: 10000 },
  );
  const thresholds = {
    maxForcedGcHeapGrowthBytes: numberEnv('RELOAD_MAX_HEAP_MB', 96) * 1024 * 1024,
    maxActiveAbortedRequestsPerLoad: numberEnv('RELOAD_MAX_ACTIVE_ABORTS_PER_LOAD', 24, {
      integer: true,
    }),
    maxActiveAbortGrowthOverInitial: numberEnv('RELOAD_MAX_ACTIVE_ABORT_GROWTH', 4, {
      integer: true,
    }),
    maxTrackedListenerGrowth: numberEnv('RELOAD_MAX_TRACKED_LISTENERS', 0),
    maxSceneNodeGrowth: numberEnv('RELOAD_MAX_SCENE_NODES', 256),
    maxRendererGeometryGrowth: numberEnv('RELOAD_MAX_RENDERER_GEOMETRIES', 64),
    maxRendererTextureGrowth: numberEnv('RELOAD_MAX_RENDERER_TEXTURES', 16),
    maxOffDocumentDomNodeGrowth: numberEnv(
      'RELOAD_MAX_OFF_DOCUMENT_DOM_NODES',
      numberEnv(
        'RELOAD_MAX_DETACHED_DOM_NODES',
        numberEnv('RELOAD_MAX_DOM_NODES', 64),
      ),
    ),
    maxLiveDomNodeGrowth: numberEnv('RELOAD_MAX_LIVE_DOM_NODES', 8),
    maxDocumentGrowth: numberEnv('RELOAD_MAX_DOCUMENTS', 0),
    maxJsEventListenerGrowth: numberEnv('RELOAD_MAX_JS_LISTENERS', 32),
    maxBitmapBalanceGrowth: numberEnv('RELOAD_MAX_BITMAP_BALANCE', 16),
    maxLiveBlobUrls: numberEnv('RELOAD_MAX_LIVE_BLOBS', 0),
    maxReloadMs: numberEnv('RELOAD_MAX_MS', Math.max(90000, delayedGlbMs + 60000), {
      integer: true,
      min: 10000,
    }),
  };
  const protocol = {
    cycles: cycleCount,
    route: 'normal Escape > Office > Exit to main menu > Continue',
    viewport: { width: 1600, height: 900, deviceScaleFactor: 1 },
    forcedGcBeforeEachSample: true,
    prewarmAssetWaitMs: 8000,
    checkoutCashPrewarmWaitMs: 12000,
    pendingAssetPrewarmBudgetMs: 20000,
    delayedLoad: delayedGlbMs > 0
      ? {
        route: delayedRoute,
        delayMs: delayedGlbMs,
        requestLimit: delayedRequestLimit,
        armBeforeMeasuredCycles: true,
      }
      : null,
    contextCloseCaptureRequested: captureContextClose,
    contextCloseCaptured: false,
  };

  let phase = 'setup';
  const phaseLog = [{ phase, atMs: 0 }];
  const setPhase = (next) => {
    phase = next;
    phaseLog.push({ phase, atMs: Date.now() - probeStartedAt });
  };
  const diagnostics = {
    consoleErrors: [],
    consoleWarnings: [],
    pageErrors: [],
    contextCloseConsoleErrors: [],
    contextClosePageErrors: [],
    httpErrors: [],
    requestFailures: { activeRoute: [], contextClose: [] },
    routeErrors: [],
  };
  const diagnosticEntry = (message) => ({
    phase,
    atMs: Date.now() - probeStartedAt,
    message,
  });
  page.on('console', (message) => {
    const entry = diagnosticEntry(message.text());
    if (message.type() === 'error') {
      (phase === 'context-close'
        ? diagnostics.contextCloseConsoleErrors
        : diagnostics.consoleErrors).push(entry);
    } else if (message.type() === 'warning') {
      diagnostics.consoleWarnings.push(entry);
    }
  });
  page.on('pageerror', (error) => {
    const entry = diagnosticEntry(error.message);
    (phase === 'context-close'
      ? diagnostics.contextClosePageErrors
      : diagnostics.pageErrors).push(entry);
  });
  page.on('response', (response) => {
    if (response.status() < 400) return;
    diagnostics.httpErrors.push({
      phase,
      atMs: Date.now() - probeStartedAt,
      url: response.url(),
      status: response.status(),
      statusText: response.statusText(),
    });
  });

  const delayedRequests = [];
  const delayedRequestByRequest = new Map();
  let delayedRouteMatches = 0;
  let remainingDelaySlots = delayedRequestLimit;
  let routeDelayHandlers = 0;
  const delayedInFlight = () => delayedRequests.filter(
    (request) => request.finishedAtMs == null && request.failedAtMs == null,
  );
  page.on('requestfinished', (request) => {
    const delayed = delayedRequestByRequest.get(request);
    if (delayed) {
      delayed.finishedAtMs = Date.now() - probeStartedAt;
      delayed.outcome = 'finished';
    }
  });
  page.on('requestfailed', (request) => {
    const failure = {
      phase,
      atMs: Date.now() - probeStartedAt,
      url: request.url(),
      method: request.method(),
      resourceType: request.resourceType(),
      errorText: request.failure()?.errorText || 'unknown',
    };
    const isContextClose = phase === 'context-close' || page.isClosed();
    diagnostics.requestFailures[isContextClose ? 'contextClose' : 'activeRoute'].push(failure);
    const delayed = delayedRequestByRequest.get(request);
    if (delayed) {
      delayed.failedAtMs = failure.atMs;
      delayed.outcome = isContextClose ? 'context-close' : 'failed';
      delayed.failure = failure.errorText;
    }
  });

  let delayedRouteInstalled = false;
  const installDelayedRoute = async () => {
    if (delayedGlbMs <= 0 || delayedRouteInstalled) return;
    delayedRouteInstalled = true;
    await page.route(delayedRoute, async (route) => {
      delayedRouteMatches += 1;
      if (remainingDelaySlots <= 0) {
        await route.continue();
        return;
      }
      remainingDelaySlots -= 1;
      routeDelayHandlers += 1;
      const request = route.request();
      const delayed = {
        index: delayedRequests.length + 1,
        url: request.url(),
        phaseAtStart: phase,
        startedAtMs: Date.now() - probeStartedAt,
        delayMs: delayedGlbMs,
        continuedAtMs: null,
        finishedAtMs: null,
        failedAtMs: null,
        outcome: 'delaying',
      };
      delayedRequests.push(delayed);
      delayedRequestByRequest.set(request, delayed);
      try {
        await new Promise((resolve) => setTimeout(resolve, delayedGlbMs));
        delayed.continuedAtMs = Date.now() - probeStartedAt;
        delayed.outcome = 'continued';
        await route.continue();
      } catch (error) {
        delayed.failedAtMs = Date.now() - probeStartedAt;
        delayed.outcome = phase === 'context-close' ? 'context-close' : 'route-error';
        delayed.failure = error?.message || String(error);
        diagnostics.routeErrors.push({
          phase,
          atMs: delayed.failedAtMs,
          url: delayed.url,
          message: delayed.failure,
        });
      } finally {
        routeDelayHandlers -= 1;
      }
    });
  };

  try {
    await page.setViewportSize({ width: 1600, height: 900 });

    const waitForVeilSettled = async () => {
      await page.waitForFunction(() => {
        const veil = document.querySelector('.load-veil');
        if (!veil) return true;
        return Number.parseFloat(getComputedStyle(veil).opacity || '1') <= 0.01;
      }, null, { timeout: waitTimeoutMs });
      await page.waitForFunction(() => {
        const veil = document.querySelector('.load-veil');
        return !veil || getComputedStyle(veil).display === 'none';
      }, null, { timeout: 5000 });
    };

    setPhase('bootstrap-menu');
    await page.goto('http://localhost:8457/', { waitUntil: 'domcontentloaded', timeout: waitTimeoutMs });
    await page.waitForTimeout(500);
    await page.getByText('Continue', { exact: true }).waitFor({ timeout: 20000 });
    setPhase('initial-game-load');
    await page.getByText('Continue', { exact: true }).click();
    await page.waitForFunction(
      () => window.__fw?.scene3d?.clubhouse?.(),
      null,
      { timeout: waitTimeoutMs },
    );
    await waitForVeilSettled();
    await page.waitForTimeout(delayedGlbMs > 0 ? 100 : 1000);

    const cdp = await page.context().newCDPSession(page);
    await cdp.send('HeapProfiler.enable');
    await cdp.send('Performance.enable');
    await page.evaluate(() => {
      const originalAdd = EventTarget.prototype.addEventListener;
      const originalRemove = EventTarget.prototype.removeEventListener;
      const counts = {};
      const tracked = new Set(['keydown', 'keyup', 'blur', 'mousemove', 'pointerlockchange']);
      const label = (target, type) => `${target === window ? 'window' : target === document ? 'document' : 'other'}:${type}`;
      EventTarget.prototype.addEventListener = function trackedAdd(type, listener, options) {
        if ((this === window || this === document) && tracked.has(type)) {
          counts[label(this, type)] = (counts[label(this, type)] || 0) + 1;
        }
        return originalAdd.call(this, type, listener, options);
      };
      EventTarget.prototype.removeEventListener = function trackedRemove(type, listener, options) {
        if ((this === window || this === document) && tracked.has(type)) {
          counts[label(this, type)] = (counts[label(this, type)] || 0) - 1;
        }
        return originalRemove.call(this, type, listener, options);
      };

      const imageBitmaps = { created: 0, closed: 0 };
      const originalCreateImageBitmap = window.createImageBitmap?.bind(window);
      if (originalCreateImageBitmap) {
        window.createImageBitmap = async (...args) => {
          const bitmap = await originalCreateImageBitmap(...args);
          imageBitmaps.created += 1;
          return bitmap;
        };
      }
      const originalBitmapClose = window.ImageBitmap?.prototype?.close;
      if (originalBitmapClose) {
        window.ImageBitmap.prototype.close = function trackedBitmapClose() {
          imageBitmaps.closed += 1;
          return originalBitmapClose.call(this);
        };
      }

      const blobUrls = { created: 0, revoked: 0, live: new Set() };
      const originalCreateObjectURL = URL.createObjectURL.bind(URL);
      const originalRevokeObjectURL = URL.revokeObjectURL.bind(URL);
      URL.createObjectURL = (...args) => {
        const url = originalCreateObjectURL(...args);
        blobUrls.created += 1;
        blobUrls.live.add(url);
        return url;
      };
      URL.revokeObjectURL = (url) => {
        blobUrls.revoked += 1;
        blobUrls.live.delete(url);
        return originalRevokeObjectURL(url);
      };

      const veilState = () => {
        const app = window.__fw;
        const veil = document.querySelector('.load-veil');
        const style = veil ? getComputedStyle(veil) : null;
        const opacity = style ? Number.parseFloat(style.opacity || '1') : 0;
        const display = style?.display || 'none';
        const visible = !!veil && display !== 'none' && opacity > 0.01;
        return {
          atMs: performance.now(),
          screen: app?.screen || null,
          prewarming: app?.prewarming === true,
          sceneId: app?.scene3d?.scene?.uuid || null,
          display,
          opacity,
          visible,
          hidden: !veil || display === 'none' || opacity <= 0.01,
          title: veil?.querySelector('.load-veil-title')?.textContent || '',
          step: veil?.querySelector('.load-veil-step')?.textContent || '',
        };
      };
      const veilProbe = {
        active: null,
        interval: null,
        observer: null,
        frameRequest: null,
        capture(reason) {
          if (!this.active) return;
          const state = veilState();
          if (state.visible) this.active.visibleObserved = true;
          if (state.visible && state.title === this.active.expectedTitle) {
            this.active.expectedTitleObserved = true;
            if (state.sceneId && !this.active.expectedTitleSceneIds.includes(state.sceneId)) {
              this.active.expectedTitleSceneIds.push(state.sceneId);
            }
          }
          if (state.visible && (
            state.title === 'Finishing the previous course load'
            || state.step === 'Finishing the previous course load'
          )) {
            this.active.finishingTitleObserved = true;
          }
          if (state.prewarming && state.hidden && this.active.hiddenWhilePrewarming.length < 10) {
            this.active.hiddenWhilePrewarming.push({ reason, ...state });
          }
          const signature = [
            state.screen,
            state.prewarming,
            state.sceneId,
            state.display,
            state.opacity.toFixed(2),
            state.title,
            state.step,
          ].join('|');
          if (signature !== this.active.lastSignature && this.active.transitions.length < 120) {
            this.active.lastSignature = signature;
            this.active.transitions.push({ reason, ...state });
          }
        },
        start(cycle, expectedTitle) {
          this.stop();
          this.active = {
            cycle,
            expectedTitle,
            visibleObserved: false,
            expectedTitleObserved: false,
            expectedTitleSceneIds: [],
            finishingTitleObserved: false,
            hiddenWhilePrewarming: [],
            transitions: [],
            frames: [],
            continueAtMs: null,
            lastSignature: null,
          };
          this.observer = new MutationObserver(() => this.capture('mutation'));
          this.observer.observe(document.documentElement, {
            subtree: true,
            childList: true,
            attributes: true,
            attributeFilter: ['style'],
            characterData: true,
          });
          this.interval = setInterval(() => this.capture('poll'), 25);
          const captureFrame = () => {
            if (!this.active) return;
            const state = veilState();
            if (this.active.frames.length < 240) this.active.frames.push(state);
            this.capture('frame');
            this.frameRequest = requestAnimationFrame(captureFrame);
          };
          this.frameRequest = requestAnimationFrame(captureFrame);
          this.capture('start');
        },
        markContinue() {
          if (!this.active) return;
          this.active.continueAtMs = performance.now();
          this.capture('continue-click');
        },
        stop() {
          if (!this.active) return null;
          this.capture('stop');
          if (this.interval !== null) clearInterval(this.interval);
          if (this.frameRequest !== null) cancelAnimationFrame(this.frameRequest);
          if (this.observer) this.observer.disconnect();
          this.interval = null;
          this.frameRequest = null;
          this.observer = null;
          const postContinueFrames = this.active.frames.filter(
            (frame) => this.active.continueAtMs !== null && frame.atMs >= this.active.continueAtMs,
          );
          const result = {
            cycle: this.active.cycle,
            expectedTitle: this.active.expectedTitle,
            visibleObserved: this.active.visibleObserved,
            expectedTitleObserved: this.active.expectedTitleObserved,
            expectedTitleSceneIds: this.active.expectedTitleSceneIds,
            finishingTitleObserved: this.active.finishingTitleObserved,
            hiddenWhilePrewarming: this.active.hiddenWhilePrewarming,
            transitions: this.active.transitions,
            continueAtMs: this.active.continueAtMs,
            postContinueFrames,
            paintedBeforeReconstructionFrames: postContinueFrames.filter(
              (frame) => frame.visible
                && frame.prewarming
                && frame.screen === 'menu'
                && frame.sceneId === null,
            ),
            finalState: veilState(),
          };
          this.active = null;
          return result;
        },
      };
      window.__reloadLifecycleProbe = { counts, imageBitmaps, blobUrls, veilProbe };
    });

    async function snapshot(cycle, loadMs = null) {
      // Normalize Chromium's transient last-input target before counting detached DOM.
      // Both baseline and reload samples then retain the same long-lived canvas path.
      await page.mouse.move(800, 450);
      await page.waitForTimeout(50);
      await cdp.send('HeapProfiler.collectGarbage');
      await page.waitForTimeout(50);
      await cdp.send('HeapProfiler.collectGarbage');
      const domCounters = await cdp.send('Memory.getDOMCounters');
      const performanceMetrics = await cdp.send('Performance.getMetrics');
      const runtimeHeap = await cdp.send('Runtime.getHeapUsage');
      const metrics = Object.fromEntries(
        performanceMetrics.metrics.map((entry) => [entry.name, entry.value]),
      );
      const game = await page.evaluate(({ cycle: sampleCycle, loadMs: sampleLoadMs }) => {
        const app = window.__fw;
        if (!app?.scene3d?.scene || !app.scene3d.renderer) {
          throw new Error('Lifecycle snapshot requires an active 3D scene.');
        }
        let sceneNodes = 0;
        app.scene3d.scene.traverse(() => { sceneNodes += 1; });
        let liveDomNodes = 1;
        const domWalker = document.createTreeWalker(document, NodeFilter.SHOW_ALL);
        while (domWalker.nextNode()) liveDomNodes += 1;
        const probe = window.__reloadLifecycleProbe;
        const counts = { ...probe.counts };
        const imageBitmaps = { ...probe.imageBitmaps };
        const blobUrls = probe.blobUrls;
        return {
          cycle: sampleCycle,
          loadMs: sampleLoadMs,
          sceneId: app.scene3d.scene.uuid,
          screen: app.screen,
          prewarming: app.prewarming === true,
          liveDomNodes,
          heapBytes: performance.memory ? performance.memory.usedJSHeapSize : null,
          listenerNet: Object.values(counts).reduce((sum, value) => sum + value, 0),
          listenerNetByType: counts,
          imageBitmaps,
          blobUrls: {
            created: blobUrls.created,
            revoked: blobUrls.revoked,
            live: blobUrls.live.size,
          },
          sceneNodes,
          rendererMemory: { ...app.scene3d.renderer.info.memory },
          programs: app.scene3d.renderer.info.programs?.length ?? null,
        };
      }, { cycle, loadMs });
      return {
        ...game,
        domCounters,
        // Memory.getDOMCounters includes intentional off-document CanvasTexture
        // backing canvases. This subtraction is useful for warm-to-warm growth,
        // but it is not a literal enumeration of detached/leaked DOM nodes.
        offDocumentDomNodes: Math.max(0, domCounters.nodes - game.liveDomNodes),
        // Compatibility alias for older artifacts and analysis scripts.
        detachedDomNodes: Math.max(0, domCounters.nodes - game.liveDomNodes),
        cdpJsHeapUsedBytes: metrics.JSHeapUsedSize ?? null,
        cdpJsHeapTotalBytes: metrics.JSHeapTotalSize ?? null,
        runtimeHeap,
      };
    }

    setPhase('lifecycle-ui-warmup');
    await page.keyboard.press('Escape');
    await page.getByText('Office', { exact: true }).waitFor({ timeout: 10000 });
    await page.getByText('Office', { exact: true }).click();
    await page.getByText('Exit to main menu (autosaves)', { exact: true }).waitFor({ timeout: 10000 });
    await page.keyboard.press('Escape');
    await page.locator('.pause-veil-ui').waitFor({ state: 'detached', timeout: 10000 });
    await page.mouse.move(2, 2);
    await page.waitForTimeout(100);
    setPhase('cold-snapshot');
    const coldSample = await snapshot('cold');
    const samples = [];
    const lifecycle = [];
    const runTransition = async ({ id, role, cycle = null, takeSnapshot = false }) => {
      const beforeExit = await page.evaluate(() => ({
        clubName: window.__fw?.state?.clubName || '',
        sceneId: window.__fw?.scene3d?.scene?.uuid || null,
      }));
      setPhase(`${id}-exit`);
      await page.keyboard.press('Escape');
      await page.getByText('Office', { exact: true }).waitFor({ timeout: 10000 });
      await page.getByText('Office', { exact: true }).click();
      await page.getByText('Exit to main menu (autosaves)', { exact: true }).click();
      await page.getByText('Continue', { exact: true }).waitFor({ timeout: 20000 });
      const menu = await page.evaluate(() => {
        const app = window.__fw;
        const veil = document.querySelector('.load-veil');
        const style = veil ? getComputedStyle(veil) : null;
        return {
          screen: app?.screen || null,
          sceneNull: app?.scene3d === null,
          stateNull: app?.state === null,
          prewarming: app?.prewarming === true,
          veil: {
            display: style?.display || 'none',
            opacity: style ? Number.parseFloat(style.opacity || '1') : 0,
            title: veil?.querySelector('.load-veil-title')?.textContent || '',
          },
        };
      });
      menu.atMs = Date.now() - probeStartedAt;
      menu.delayedRequestsInFlight = delayedInFlight().length;
      menu.routeDelayHandlers = routeDelayHandlers;

      const expectedTitle = `Arriving at ${beforeExit.clubName}`;
      await page.evaluate(({ transitionId, expectedTitle: title }) => {
        window.__reloadLifecycleProbe.veilProbe.start(transitionId, title);
        const button = [...document.querySelectorAll('button')]
          .find((item) => item.textContent.trim() === 'Continue');
        button?.addEventListener(
          'click',
          () => window.__reloadLifecycleProbe.veilProbe.markContinue(),
          { capture: true, once: true },
        );
      }, { transitionId: id, expectedTitle });
      setPhase(`${id}-continue`);
      const reloadStartedAt = Date.now();
      const delayedRequestsInFlightAtContinue = delayedInFlight().length;
      await page.getByText('Continue', { exact: true }).click();
      await page.waitForFunction((oldSceneId) => {
        const app = window.__fw;
        return app?.screen === 'game'
          && !!app.scene3d?.scene?.uuid
          && app.scene3d.scene.uuid !== oldSceneId;
      }, beforeExit.sceneId, { timeout: waitTimeoutMs });
      const sceneAtStart = await page.evaluate(() => {
        const app = window.__fw;
        const veil = document.querySelector('.load-veil');
        const style = veil ? getComputedStyle(veil) : null;
        const opacity = style ? Number.parseFloat(style.opacity || '1') : 0;
        return {
          sceneId: app?.scene3d?.scene?.uuid || null,
          screen: app?.screen || null,
          prewarming: app?.prewarming === true,
          veilVisible: !!veil && style.display !== 'none' && opacity > 0.01,
          veilTitle: veil?.querySelector('.load-veil-title')?.textContent || '',
        };
      });
      await page.waitForFunction(
        () => window.__fw?.screen === 'game' && window.__fw?.prewarming === false,
        null,
        { timeout: waitTimeoutMs },
      );
      await waitForVeilSettled();
      const veil = await page.evaluate(() => window.__reloadLifecycleProbe.veilProbe.stop());
      const loadMs = Date.now() - reloadStartedAt;
      const sceneId = await page.evaluate(() => window.__fw?.scene3d?.scene?.uuid || null);
      const record = {
        id,
        role,
        cycle,
        beforeExit,
        menu,
        reloadStartedAtMs: reloadStartedAt - probeStartedAt,
        delayedRequestsInFlightAtContinue,
        delayedRequestsInFlightAfterLoad: delayedInFlight().length,
        sceneAtStart,
        sceneId,
        loadMs,
        veil,
      };
      lifecycle.push(record);
      if (takeSnapshot) {
        await page.waitForTimeout(250);
        const measured = await snapshot(cycle, loadMs);
        samples.push(measured);
        record.sceneId = measured.sceneId;
      }
      return record;
    };

    // Populate the browser's one-time off-document CanvasTexture/native-wrapper
    // state before the measured baseline. Historical cold-to-first-reload runs
    // plateau immediately; measured cycles must compare equivalent warm phases.
    protocol.warmupTransitionId = 'warmup';
    await runTransition({ id: 'warmup', role: 'warmup' });
    await page.waitForTimeout(250);
    setPhase('baseline-snapshot');
    samples.push(await snapshot(0));

    if (delayedGlbMs > 0) {
      await installDelayedRoute();
      protocol.delayedLoad.armTransitionId = 'delayed-arm';
      await runTransition({ id: 'delayed-arm', role: 'delay-arm' });
    }
    for (let cycle = 1; cycle <= cycleCount; cycle += 1) {
      await runTransition({
        id: `cycle-${cycle}`,
        role: 'measured',
        cycle,
        takeSnapshot: true,
      });
    }

    setPhase('probe-settle');
    const delayedSettleDeadline = Date.now() + Math.max(10000, delayedGlbMs + 5000);
    while ((routeDelayHandlers > 0 || delayedInFlight().length > 0) && Date.now() < delayedSettleDeadline) {
      await page.waitForTimeout(100);
    }

    const first = samples[0];
    const last = samples[samples.length - 1];
    const subtract = (a, b) => (a == null || b == null ? null : a - b);
    const delta = {
      heapBytes: subtract(last.heapBytes, first.heapBytes),
      cdpJsHeapUsedBytes: subtract(last.cdpJsHeapUsedBytes, first.cdpJsHeapUsedBytes),
      runtimeHeapUsedBytes: subtract(last.runtimeHeap?.usedSize, first.runtimeHeap?.usedSize),
      listenerNet: last.listenerNet - first.listenerNet,
      sceneNodes: last.sceneNodes - first.sceneNodes,
      rendererGeometries: last.rendererMemory.geometries - first.rendererMemory.geometries,
      rendererTextures: last.rendererMemory.textures - first.rendererMemory.textures,
      domNodes: last.domCounters.nodes - first.domCounters.nodes,
      offDocumentDomNodes: last.offDocumentDomNodes - first.offDocumentDomNodes,
      detachedDomNodes: last.detachedDomNodes - first.detachedDomNodes,
      liveDomNodes: last.liveDomNodes - first.liveDomNodes,
      documents: last.domCounters.documents - first.domCounters.documents,
      jsEventListeners: last.domCounters.jsEventListeners - first.domCounters.jsEventListeners,
      imageBitmapsCreated: last.imageBitmaps.created - first.imageBitmaps.created,
      imageBitmapsClosed: last.imageBitmaps.closed - first.imageBitmaps.closed,
      imageBitmapBalance: (last.imageBitmaps.created - last.imageBitmaps.closed)
        - (first.imageBitmaps.created - first.imageBitmaps.closed),
      liveBlobUrls: last.blobUrls.live - first.blobUrls.live,
    };
    const coldToWarmDelta = {
      domNodes: first.domCounters.nodes - coldSample.domCounters.nodes,
      offDocumentDomNodes: first.offDocumentDomNodes - coldSample.offDocumentDomNodes,
      liveDomNodes: first.liveDomNodes - coldSample.liveDomNodes,
      documents: first.domCounters.documents - coldSample.domCounters.documents,
      jsEventListeners: first.domCounters.jsEventListeners - coldSample.domCounters.jsEventListeners,
      imageBitmapBalance: (first.imageBitmaps.created - first.imageBitmaps.closed)
        - (coldSample.imageBitmaps.created - coldSample.imageBitmaps.closed),
    };

    const checks = [];
    const check = (id, ok, actual, expected) => checks.push({ id, ok: !!ok, actual, expected });
    const activeFailures = diagnostics.requestFailures.activeRoute;
    const activeAborts = activeFailures.filter((failure) => failure.errorText === 'net::ERR_ABORTED');
    const unexpectedActiveFailures = activeFailures.filter(
      (failure) => failure.errorText !== 'net::ERR_ABORTED',
    );
    const activeAbortCountsByPhase = activeAborts.reduce((counts, failure) => {
      counts[failure.phase] = (counts[failure.phase] || 0) + 1;
      return counts;
    }, {});
    const activeAbortReferencePhase = delayedGlbMs > 0
      ? 'delayed-arm-continue'
      : 'initial-game-load';
    const activeAbortReferenceCount = activeAbortCountsByPhase[activeAbortReferencePhase] || 0;
    const reloadActiveAbortCounts = Object.entries(activeAbortCountsByPhase)
      .filter(([loadPhase]) => loadPhase !== 'initial-game-load'
        && loadPhase !== activeAbortReferencePhase)
      .map(([loadPhase, count]) => ({ phase: loadPhase, count }));
    const activeAbortsOutsideLoad = activeAborts.filter(
      (failure) => failure.phase !== 'initial-game-load' && !failure.phase.endsWith('-continue'),
    );
    diagnostics.requestFailures.activeRouteSummary = {
      total: activeFailures.length,
      aborted: activeAborts.length,
      unexpected: unexpectedActiveFailures.length,
      abortedByPhase: activeAbortCountsByPhase,
      referencePhase: activeAbortReferencePhase,
      referenceAborted: activeAbortReferenceCount,
    };
    check('sample-count', samples.length === cycleCount + 1, samples.length, cycleCount + 1);
    check('console-errors', diagnostics.consoleErrors.length === 0, diagnostics.consoleErrors.length, 0);
    check('page-errors', diagnostics.pageErrors.length === 0, diagnostics.pageErrors.length, 0);
    check('http-errors', diagnostics.httpErrors.length === 0, diagnostics.httpErrors, []);
    check(
      'unexpected-active-route-request-failures',
      unexpectedActiveFailures.length === 0,
      unexpectedActiveFailures,
      [],
    );
    check(
      'active-aborts-occur-only-during-load',
      activeAbortsOutsideLoad.length === 0,
      activeAbortsOutsideLoad,
      [],
    );
    check(
      'active-aborts-per-load',
      Object.values(activeAbortCountsByPhase).every(
        (count) => count <= thresholds.maxActiveAbortedRequestsPerLoad,
      ),
      activeAbortCountsByPhase,
      `each <= ${thresholds.maxActiveAbortedRequestsPerLoad}`,
    );
    check(
      'active-abort-growth-over-reference-load',
      reloadActiveAbortCounts.every(
        ({ count }) => count <= activeAbortReferenceCount + thresholds.maxActiveAbortGrowthOverInitial,
      ),
      reloadActiveAbortCounts,
      `each <= ${activeAbortReferencePhase} ${activeAbortReferenceCount} + ${thresholds.maxActiveAbortGrowthOverInitial}`,
    );
    check('route-handler-errors', diagnostics.routeErrors.length === 0, diagnostics.routeErrors.length, 0);
    check(
      'forced-gc-heap-growth',
      delta.runtimeHeapUsedBytes != null
        && delta.runtimeHeapUsedBytes <= thresholds.maxForcedGcHeapGrowthBytes,
      delta.runtimeHeapUsedBytes,
      `<= ${thresholds.maxForcedGcHeapGrowthBytes}`,
    );
    check(
      'tracked-listener-growth',
      delta.listenerNet <= thresholds.maxTrackedListenerGrowth,
      delta.listenerNet,
      `<= ${thresholds.maxTrackedListenerGrowth}`,
    );
    check(
      'scene-node-growth',
      delta.sceneNodes <= thresholds.maxSceneNodeGrowth,
      delta.sceneNodes,
      `<= ${thresholds.maxSceneNodeGrowth}`,
    );
    check(
      'renderer-geometry-growth',
      delta.rendererGeometries <= thresholds.maxRendererGeometryGrowth,
      delta.rendererGeometries,
      `<= ${thresholds.maxRendererGeometryGrowth}`,
    );
    check(
      'renderer-texture-growth',
      delta.rendererTextures <= thresholds.maxRendererTextureGrowth,
      delta.rendererTextures,
      `<= ${thresholds.maxRendererTextureGrowth}`,
    );
    check(
      'off-document-dom-node-growth',
      delta.offDocumentDomNodes <= thresholds.maxOffDocumentDomNodeGrowth,
      delta.offDocumentDomNodes,
      `<= ${thresholds.maxOffDocumentDomNodeGrowth}`,
    );
    check(
      'live-dom-node-growth',
      delta.liveDomNodes <= thresholds.maxLiveDomNodeGrowth,
      delta.liveDomNodes,
      `<= ${thresholds.maxLiveDomNodeGrowth}`,
    );
    check(
      'document-growth',
      delta.documents <= thresholds.maxDocumentGrowth,
      delta.documents,
      `<= ${thresholds.maxDocumentGrowth}`,
    );
    check(
      'js-event-listener-growth',
      delta.jsEventListeners <= thresholds.maxJsEventListenerGrowth,
      delta.jsEventListeners,
      `<= ${thresholds.maxJsEventListenerGrowth}`,
    );
    check(
      'image-bitmap-balance-growth',
      delta.imageBitmapBalance <= thresholds.maxBitmapBalanceGrowth,
      delta.imageBitmapBalance,
      `<= ${thresholds.maxBitmapBalanceGrowth}`,
    );
    check(
      'live-blob-urls',
      last.blobUrls.live <= thresholds.maxLiveBlobUrls,
      last.blobUrls.live,
      `<= ${thresholds.maxLiveBlobUrls}`,
    );
    check(
      'reload-duration',
      lifecycle.every((cycle) => cycle.loadMs <= thresholds.maxReloadMs),
      lifecycle.map((cycle) => cycle.loadMs),
      `each <= ${thresholds.maxReloadMs}`,
    );

    for (const cycle of lifecycle) {
      check(
        `${cycle.id}-menu-scene-null`,
        cycle.menu.screen === 'menu'
          && cycle.menu.sceneNull
          && cycle.menu.stateNull
          && !cycle.menu.prewarming,
        cycle.menu,
        { screen: 'menu', sceneNull: true, stateNull: true, prewarming: false },
      );
      check(
        `${cycle.id}-veil-at-scene-start`,
        cycle.sceneAtStart.screen === 'game'
          && cycle.sceneAtStart.prewarming
          && cycle.sceneAtStart.veilVisible
          && cycle.sceneAtStart.veilTitle === cycle.veil.expectedTitle,
        cycle.sceneAtStart,
        {
          screen: 'game',
          prewarming: true,
          veilVisible: true,
          veilTitle: cycle.veil.expectedTitle,
        },
      );
      check(
        `${cycle.id}-veil-generation`,
        cycle.veil.visibleObserved
          && cycle.veil.expectedTitleObserved
          && cycle.veil.expectedTitleSceneIds.includes(cycle.sceneId)
          && cycle.veil.hiddenWhilePrewarming.length === 0
          && cycle.veil.finalState.hidden
          && !cycle.veil.finalState.prewarming,
        {
          visibleObserved: cycle.veil.visibleObserved,
          expectedTitleObserved: cycle.veil.expectedTitleObserved,
          expectedTitleSceneIds: cycle.veil.expectedTitleSceneIds,
          finalSceneId: cycle.sceneId,
          hiddenWhilePrewarming: cycle.veil.hiddenWhilePrewarming,
          finalState: cycle.veil.finalState,
        },
        'current generation stays visible through prewarm and hides only after it finishes',
      );
      check(
        `${cycle.id}-veil-painted-before-reconstruction`,
        cycle.veil.paintedBeforeReconstructionFrames.length > 0,
        cycle.veil.paintedBeforeReconstructionFrames,
        'at least one post-click animation frame with an opaque veil before the new scene exists',
      );
      if (cycle.menu.delayedRequestsInFlight > 0) {
        check(
          `${cycle.id}-barrier-veil`,
          cycle.veil.finishingTitleObserved,
          cycle.veil.finishingTitleObserved,
          true,
        );
      }
    }

    if (delayedGlbMs > 0) {
      const armTransition = lifecycle.find((cycle) => cycle.role === 'delay-arm');
      const overlapCycles = lifecycle
        .filter((cycle) => cycle.menu.delayedRequestsInFlight > 0)
        .map((cycle) => cycle.id);
      check(
        'delayed-load-exceeds-combined-prewarm-budget',
        delayedGlbMs > protocol.pendingAssetPrewarmBudgetMs,
        delayedGlbMs,
        `> ${protocol.pendingAssetPrewarmBudgetMs}`,
      );
      check('delayed-route-matched', delayedRequests.length > 0, delayedRequests.length, '>= 1');
      check(
        'delayed-arm-still-in-flight-after-prewarm',
        (armTransition?.delayedRequestsInFlightAfterLoad || 0) > 0,
        armTransition?.delayedRequestsInFlightAfterLoad ?? null,
        '> 0',
      );
      check('delayed-load-overlapped-menu', overlapCycles.length > 0, overlapCycles, 'at least one cycle');
      check(
        'delayed-loads-settled',
        routeDelayHandlers === 0 && delayedInFlight().length === 0,
        { routeDelayHandlers, delayedInFlight: delayedInFlight().length },
        { routeDelayHandlers: 0, delayedInFlight: 0 },
      );
    }

    const reasons = checks
      .filter((entry) => !entry.ok)
      .map((entry) => `${entry.id}: expected ${JSON.stringify(entry.expected)}, got ${JSON.stringify(entry.actual)}`);
    const result = {
      ok: reasons.length === 0,
      reasons,
      blocker: reasons.length ? { message: reasons.join('; ') } : null,
      protocol,
      thresholds,
      checks,
      coldSample,
      coldToWarmDelta,
      samples,
      lifecycle,
      delta,
      delayedLoad: {
        routeMatches: delayedRouteMatches,
        delayedRequests,
        pendingAtEnd: delayedInFlight().length,
        routeDelayHandlersAtEnd: routeDelayHandlers,
      },
      diagnostics,
      phaseLog,
      errors: [
        ...diagnostics.consoleErrors.map((entry) => `CONSOLE: ${entry.message}`),
        ...diagnostics.pageErrors.map((entry) => `PAGEERROR: ${entry.message}`),
        ...unexpectedActiveFailures.map(
          (entry) => `REQUESTFAILED: ${entry.url} (${entry.errorText})`,
        ),
      ],
    };

    if (captureContextClose) {
      setPhase('context-close');
      try {
        await page.close({ runBeforeUnload: false });
        protocol.contextCloseCaptured = true;
      } catch (error) {
        protocol.contextCloseCaptureError = error?.message || String(error);
      }
    } else {
      setPhase('probe-complete');
    }
    return result;
  } catch (error) {
    setPhase('probe-failed');
    const message = error?.stack || error?.message || String(error);
    return {
      ok: false,
      reasons: [`probe-exception: ${message}`],
      blocker: { message },
      protocol,
      thresholds,
      checks: [],
      samples: [],
      lifecycle: [],
      delayedLoad: {
        routeMatches: delayedRouteMatches,
        delayedRequests,
        pendingAtFailure: delayedInFlight().length,
        routeDelayHandlersAtFailure: routeDelayHandlers,
      },
      diagnostics,
      phaseLog,
      errors: [message],
    };
  }
}
