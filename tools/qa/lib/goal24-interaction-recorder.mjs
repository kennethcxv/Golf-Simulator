// Goal 24's allocation-bounded interaction recorder.
//
// The acceptance stream has only two clocks:
//   * display cadence: one temporary requestAnimationFrame chain;
//   * game cadence: calls to the shipping scene3d.render loop.
//
// A capped game receives display rAF callbacks without drawing a game frame, so
// those streams are deliberately separate. The recorder is inert between
// windows: it has no rAF, listeners, observers, scene traversal, or render
// wrapper while inactive. Buffers are allocated before the timed start and
// converted to JSON only after the timed end. Resource census, tracing, pixels,
// video, and mutation observation belong to separate non-grading legs.

// Start-to-controllable is the one transition that begins before scene3d
// exists. This short-lived sampler arms its display clock at the menu, then
// attaches to the shipping render method on the first rAF where that method
// exists. It is separate from normal interaction windows so nobody can claim
// the game renderer was measurable before it was constructed.
export async function installGoal24StartTransitionRecorder(page, {
  maxDurationMs = 300_000,
  traceId = 'start-game-1',
  traceScenario = 'startGame',
} = {}) {
  return page.evaluate(({ requestedDurationMs, requestedTraceId, requestedTraceScenario }) => {
    if (globalThis.__goal24StartTransitionRecorder) {
      throw new Error('Goal 24 start-transition recorder is already installed.');
    }
    const duration = Math.max(10_000, Math.min(600_000, Number(requestedDurationMs) || 300_000));
    const traceId = String(requestedTraceId || '').trim();
    const traceScenario = String(requestedTraceScenario || '').trim();
    if (!traceId || !traceScenario) {
      throw new Error('Goal 24 start-transition trace identity is required.');
    }
    const traceMark = (phase, label = '') => performance.mark([
      'goal24.interaction',
      encodeURIComponent(traceId),
      encodeURIComponent(traceScenario),
      phase,
      encodeURIComponent(label),
    ].join('|'));
    const capacity = Math.ceil(duration / 1000 * 360) + 64;
    const display = new Float64Array(capacity);
    const displayStartAtMs = new Float64Array(capacity);
    const displayEndAtMs = new Float64Array(capacity);
    const render = new Float64Array(capacity);
    const renderStartAtMs = new Float64Array(capacity);
    const renderEndAtMs = new Float64Array(capacity);
    let displayCount = 0;
    let renderCount = 0;
    let displayDropped = 0;
    let renderDropped = 0;
    let lastDisplayMs = null;
    let lastRenderMs = null;
    let firstDisplayBoundaryMs = null;
    let lastDisplayBoundaryMs = null;
    let firstRenderBoundaryMs = null;
    let lastRenderBoundaryMs = null;
    let rafId = 0;
    let renderTarget = null;
    let originalRender = null;
    let patchedRender = null;
    let stopped = false;
    const inputEvents = [];
    const driverInputRequests = [];
    const waiters = [];
    const displayBoundaryWaiters = [];
    const installedAtMs = performance.now();
    const installedAtEpochMs = performance.timeOrigin + installedAtMs;
    let measurementStartedAtMs = installedAtMs;
    let measurementStartedAtEpochMs = installedAtEpochMs;
    let renderInstrumentationAttachedAtMs = null;
    let menuControlConsumedAtMs = null;
    let candidateControllableRenderAtMs = null;
    let candidateControllableRenderEpochMs = null;
    let candidateControllableDisplayBoundaryAtMs = null;
    let candidateControllableDisplayBoundaryEpochMs = null;
    let candidateControllableRendererFrame = null;
    let movementProbe = null;
    let movementProbeConfirmedAtMs = null;
    let confirmedControllableRenderAtMs = null;
    let confirmedControllableRenderEpochMs = null;
    let confirmedControllableDisplayBoundaryAtMs = null;
    let confirmedControllableDisplayBoundaryEpochMs = null;
    let confirmedControllableRendererFrame = null;
    let confirmedControllableCadenceSnapshot = null;
    let measurementPriorDisplayBoundaryMs = null;
    let measurementPriorRenderBoundaryMs = null;
    let playerInteriorObserved = false;
    let firstPlayerInteriorAtMs = null;
    let playerInteriorSampleCount = 0;
    let playerExteriorSampleCount = 0;
    let playerInteriorTransitionCount = 0;
    let lastPlayerInside = null;
    let hiddenPrewarmInteriorSampleCount = 0;
    let inactiveInteriorSampleCount = 0;
    const confirmationWaiters = [];

    const append = (buffer, count, value) => {
      if (count < buffer.length) {
        buffer[count] = value;
        return count + 1;
      }
      return count;
    };
    const elementEvidence = (target) => target instanceof Element ? {
      tag: target.tagName.toLowerCase(),
      id: target.id || null,
      classes: [...target.classList].slice(0, 6),
      role: target.getAttribute('role'),
      ariaLabel: target.getAttribute('aria-label'),
      text: String(target.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 100),
    } : null;
    const targetEvidence = (target) => {
      const eventTarget = elementEvidence(target);
      if (!eventTarget || !(target instanceof Element)) return eventTarget;
      const control = target.closest('button,[role="button"]');
      if (!control || control === target) return eventTarget;
      return {
        ...elementEvidence(control),
        eventTarget,
        resolution: 'closest-interactive-control-from-native-event-target',
      };
    };
    const recordInput = (event) => {
      const atMs = performance.now();
      const evidence = {
        type: event.type,
        eventTimestampMs: Number.isFinite(event.timeStamp) ? event.timeStamp : null,
        observedAtMs: atMs,
        atMs,
        atEpochMs: performance.timeOrigin + atMs,
        clientX: Number.isFinite(event.clientX) ? event.clientX : null,
        clientY: Number.isFinite(event.clientY) ? event.clientY : null,
        button: Number.isFinite(event.button) ? event.button : null,
        key: typeof event.key === 'string' ? event.key : null,
        code: typeof event.code === 'string' ? event.code : null,
        isTrusted: !!event.isTrusted,
        target: targetEvidence(event.target),
      };
      inputEvents.push(evidence);
      if (event.type === 'click' && event.isTrusted
        && /new game|continue/i.test(evidence.target?.text || '')
        && measurementStartedAtMs === installedAtMs) {
        // Reset in the capturing listener before the shipping click handler.
        // Menu-idle cadence therefore cannot dilute start-to-controllable.
        const priorDisplayBoundaryMs = lastDisplayMs;
        const priorRenderBoundaryMs = lastRenderMs;
        displayCount = 0;
        renderCount = 0;
        displayDropped = 0;
        renderDropped = 0;
        // Preserve the immediately preceding real display boundary so the
        // first accepted interval straddles the trusted click. Synchronous
        // post-click work therefore cannot disappear before the first rAF.
        lastDisplayMs = priorDisplayBoundaryMs;
        lastRenderMs = null;
        measurementPriorDisplayBoundaryMs = priorDisplayBoundaryMs;
        measurementPriorRenderBoundaryMs = priorRenderBoundaryMs;
        firstDisplayBoundaryMs = null;
        lastDisplayBoundaryMs = null;
        firstRenderBoundaryMs = null;
        lastRenderBoundaryMs = null;
        measurementStartedAtMs = atMs;
        measurementStartedAtEpochMs = performance.timeOrigin + atMs;
        // Trace from the exact trusted-click capture boundary. Scene creation,
        // nav-grid construction, shader work, and asset upload all occur after
        // this mark and before the independently confirmed controllable end.
        traceMark('start');
      }
    };
    const inputTypes = ['pointerdown', 'pointerup', 'click', 'keydown', 'keyup'];
    for (const type of inputTypes) addEventListener(type, recordInput, true);

    const veilIsDrawn = () => {
      const veil = document.querySelector('.load-veil');
      if (!veil) return false;
      const style = getComputedStyle(veil);
      return style.display !== 'none' && style.visibility !== 'hidden'
        && Number(style.opacity) > 0.05;
    };
    const resolveWaiters = () => {
      if (candidateControllableDisplayBoundaryAtMs == null) return;
      for (const waiter of waiters.splice(0)) {
        clearTimeout(waiter.timer);
        waiter.resolve({
          ok: true,
          candidateControllableRenderAtMs,
          candidateControllableRenderEpochMs,
          candidateControllableDisplayBoundaryAtMs,
          candidateControllableDisplayBoundaryEpochMs,
          candidateControllableRendererFrame,
          renderInstrumentationAttachedAtMs,
        });
      }
    };
    const resolveConfirmationWaiters = () => {
      if (confirmedControllableDisplayBoundaryAtMs == null) return;
      for (const waiter of confirmationWaiters.splice(0)) {
        clearTimeout(waiter.timer);
        waiter.resolve({
          ok: true,
          movementProbeConfirmedAtMs,
          confirmedControllableRenderAtMs,
          confirmedControllableRenderEpochMs,
          confirmedControllableDisplayBoundaryAtMs,
          confirmedControllableDisplayBoundaryEpochMs,
          confirmedControllableRendererFrame,
        });
      }
    };
    const ensureRenderPatch = () => {
      if (renderTarget) return true;
      const target = globalThis.__fw?.scene3d;
      if (!target || typeof target.render !== 'function') return false;
      originalRender = target.render;
      patchedRender = function goal24StartMeasuredRender(...args) {
        const startedAtMs = performance.now();
        if (!stopped) {
          const fw = globalThis.__fw;
          const walk = fw?.scene3d?.walk;
          const clubhouse = fw?.scene3d?.clubhouse?.();
          if (walk?.state && typeof clubhouse?.isInside === 'function') {
            const inside = !!clubhouse.isInside(walk.state.x, walk.state.z, 0.35);
            const veilDrawn = veilIsDrawn();
            const playerControllable = walk.isActive?.() === true && !veilDrawn;
            if (inside && veilDrawn) hiddenPrewarmInteriorSampleCount += 1;
            else if (inside && !playerControllable) inactiveInteriorSampleCount += 1;
            if (playerControllable && inside) {
              playerInteriorSampleCount += 1;
              playerInteriorObserved = true;
              if (firstPlayerInteriorAtMs == null) firstPlayerInteriorAtMs = startedAtMs;
            } else if (playerControllable) {
              playerExteriorSampleCount += 1;
            }
            if (playerControllable && lastPlayerInside != null && inside !== lastPlayerInside) {
              playerInteriorTransitionCount += 1;
            }
            if (playerControllable) lastPlayerInside = inside;
          }
          if (firstRenderBoundaryMs == null) firstRenderBoundaryMs = startedAtMs;
          lastRenderBoundaryMs = startedAtMs;
          if (lastRenderMs != null) {
            const index = renderCount;
            const next = append(render, renderCount, startedAtMs - lastRenderMs);
            if (next === renderCount) renderDropped += 1;
            else {
              renderStartAtMs[index] = lastRenderMs;
              renderEndAtMs[index] = startedAtMs;
            }
            renderCount = next;
          }
          lastRenderMs = startedAtMs;
        }
        const result = originalRender.apply(this, args);
        if (!stopped && candidateControllableRenderAtMs == null
          && globalThis.__fw?.scene3d?.walk?.isActive?.() && !veilIsDrawn()) {
          candidateControllableRenderAtMs = startedAtMs;
          candidateControllableRenderEpochMs = performance.timeOrigin + startedAtMs;
          candidateControllableRendererFrame = target.renderer?.info?.render?.frame ?? null;
        }
        if (!stopped && movementProbeConfirmedAtMs != null
          && confirmedControllableRenderAtMs == null
          && startedAtMs >= movementProbeConfirmedAtMs
          && globalThis.__fw?.scene3d?.walk?.isActive?.() && !veilIsDrawn()) {
          confirmedControllableRenderAtMs = startedAtMs;
          confirmedControllableRenderEpochMs = performance.timeOrigin + startedAtMs;
          confirmedControllableRendererFrame = target.renderer?.info?.render?.frame ?? null;
        }
        return result;
      };
      renderTarget = target;
      target.render = patchedRender;
      renderInstrumentationAttachedAtMs = performance.now();
      return true;
    };
    const detach = () => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = 0;
      if (renderTarget && originalRender && renderTarget.render === patchedRender) {
        renderTarget.render = originalRender;
      }
      renderTarget = null;
      originalRender = null;
      patchedRender = null;
      for (const type of inputTypes) removeEventListener(type, recordInput, true);
    };
    const tick = (timestamp) => {
      if (stopped) return;
      // A queued rAF callback can execute after the trusted click while still
      // carrying a pre-click frame timestamp. It is not a post-input display
      // boundary. Preserve the older boundary and let the next real timestamp
      // form the interval that honestly straddles the click.
      const stalePreMeasurementTimestamp = measurementStartedAtMs !== installedAtMs
        && timestamp < measurementStartedAtMs;
      if (!stalePreMeasurementTimestamp) {
        if (firstDisplayBoundaryMs == null) firstDisplayBoundaryMs = timestamp;
        lastDisplayBoundaryMs = timestamp;
        if (lastDisplayMs != null) {
          const index = displayCount;
          const next = append(display, displayCount, timestamp - lastDisplayMs);
          if (next === displayCount) displayDropped += 1;
          else {
            displayStartAtMs[index] = lastDisplayMs;
            displayEndAtMs[index] = timestamp;
          }
          displayCount = next;
        }
        lastDisplayMs = timestamp;
        for (const waiter of displayBoundaryWaiters.splice(0)) {
          clearTimeout(waiter.timer);
          waiter.resolve({ ok: true, atMs: lastDisplayMs });
        }
      }
      ensureRenderPatch();
      if (menuControlConsumedAtMs == null
        && inputEvents.some((event) => event.type === 'click' && event.isTrusted
          && /new game|continue/i.test(event.target?.text || ''))
        && [...document.querySelectorAll('.difficulty-card')].some((element) => {
          const box = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return box.width > 10 && box.height > 10 && style.display !== 'none'
            && style.visibility !== 'hidden' && Number(style.opacity) > 0.05;
        })) {
        menuControlConsumedAtMs = performance.now();
      }
      if (candidateControllableRenderAtMs != null && candidateControllableDisplayBoundaryAtMs == null
        && timestamp >= candidateControllableRenderAtMs) {
        // requestAnimationFrame is a post-render display boundary, not proof
        // that the compositor presented a pixel. Preserve that exact claim.
        candidateControllableDisplayBoundaryAtMs = timestamp;
        candidateControllableDisplayBoundaryEpochMs = performance.timeOrigin + timestamp;
        resolveWaiters();
      }
      if (confirmedControllableRenderAtMs != null
        && confirmedControllableDisplayBoundaryAtMs == null
        && timestamp >= confirmedControllableRenderAtMs) {
        confirmedControllableDisplayBoundaryAtMs = timestamp;
        confirmedControllableDisplayBoundaryEpochMs = performance.timeOrigin + timestamp;
        confirmedControllableCadenceSnapshot = {
          displayCount,
          renderCount,
          displayDropped,
          renderDropped,
          firstDisplayBoundaryMs,
          lastDisplayBoundaryMs,
          firstRenderBoundaryMs,
          lastRenderBoundaryMs,
        };
        traceMark('marker', 'post-outcome-render-boundary');
        resolveConfirmationWaiters();
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);

    const api = {
      schemaVersion: 1,
      ready() {
        return {
          installedAtMs,
          installedAtEpochMs,
          measurementStartedAtMs,
          measurementStartedAtEpochMs,
          displayInstrumentationReady: !!rafId,
          renderInstrumentationPolicy: 'attach-on-first-rAF-after-scene3d.render-exists',
          capacity,
        };
      },
      waitForControllable(timeoutMs = duration) {
        if (candidateControllableDisplayBoundaryAtMs != null) {
          return Promise.resolve({
            ok: true,
            candidateControllableRenderAtMs,
            candidateControllableRenderEpochMs,
            candidateControllableDisplayBoundaryAtMs,
            candidateControllableDisplayBoundaryEpochMs,
            candidateControllableRendererFrame,
            renderInstrumentationAttachedAtMs,
          });
        }
        const timeout = Math.max(1000, Math.min(duration, Number(timeoutMs) || duration));
        return new Promise((resolve) => {
          const waiter = { resolve, timer: 0 };
          waiter.timer = setTimeout(() => {
            const index = waiters.indexOf(waiter);
            if (index >= 0) waiters.splice(index, 1);
            resolve({
              ok: false,
              reason: 'timeout',
              candidateControllableRenderAtMs,
              candidateControllableDisplayBoundaryAtMs,
              renderInstrumentationAttachedAtMs,
            });
          }, timeout);
          waiters.push(waiter);
        });
      },
      waitForDisplayBoundary(timeoutMs = 5000) {
        if (Number.isFinite(lastDisplayMs)) {
          return Promise.resolve({ ok: true, atMs: lastDisplayMs });
        }
        const timeout = Math.max(100, Math.min(duration, Number(timeoutMs) || 5000));
        return new Promise((resolve) => {
          const waiter = { resolve, timer: null };
          waiter.timer = setTimeout(() => {
            const index = displayBoundaryWaiters.indexOf(waiter);
            if (index >= 0) displayBoundaryWaiters.splice(index, 1);
            resolve({ ok: false, reason: 'timeout' });
          }, timeout);
          displayBoundaryWaiters.push(waiter);
        });
      },
      recordDriverInputRequest(request) {
        const atMs = performance.now();
        const entry = {
          atMs,
          atEpochMs: performance.timeOrigin + atMs,
          ...JSON.parse(JSON.stringify(request || {})),
        };
        driverInputRequests.push(entry);
        return JSON.parse(JSON.stringify(entry));
      },
      confirmMovementProbe(proof, timeoutMs = 10_000) {
        if (movementProbeConfirmedAtMs != null) {
          throw new Error('Goal 24 movement probe was already confirmed.');
        }
        const candidate = JSON.parse(JSON.stringify(proof || {}));
        const key = String(candidate.key || '').toLowerCase();
        const displacement = Number(candidate.displacement);
        const consumedAtMs = Number(candidate.consumed?.atMs);
        const observedAtMs = Number(candidate.observedAtMs);
        const request = [...driverInputRequests].reverse().find((entry) => (
          entry.kind === 'keyboard'
          && String(entry.control || '').toLowerCase() === key
          && entry.detail?.action === 'down'
          && entry.detail?.phase === 'movement-probe'
        ));
        const delivery = inputEvents.find((entry) => (
          entry.type === 'keydown'
          && entry.isTrusted === true
          && String(entry.key || '').toLowerCase() === key
          && Number.isFinite(request?.atMs)
          && entry.atMs >= request.atMs
        ));
        if (!key || !Number.isFinite(displacement) || displacement <= 0.02) {
          throw new Error('Movement probe requires measured displacement above 0.02 world units.');
        }
        if (!request || !delivery) {
          throw new Error('Movement probe lacks ordered driver request and trusted key delivery.');
        }
        if (!Number.isFinite(consumedAtMs) || consumedAtMs < delivery.atMs
          || !candidate.consumed?.signal) {
          throw new Error('Movement probe lacks ordered production key-consumption evidence.');
        }
        if (!Number.isFinite(observedAtMs) || observedAtMs < consumedAtMs) {
          throw new Error('Movement displacement observation is not ordered after production consumption.');
        }
        movementProbeConfirmedAtMs = performance.now();
        movementProbe = {
          ...candidate,
          key,
          displacement,
          observedAtMs,
          confirmationRequestedAtMs: movementProbeConfirmedAtMs,
          request: JSON.parse(JSON.stringify(request)),
          delivery: JSON.parse(JSON.stringify(delivery)),
        };
        const timeout = Math.max(1000, Math.min(duration, Number(timeoutMs) || 10_000));
        return new Promise((resolve) => {
          const waiter = { resolve, timer: 0 };
          waiter.timer = setTimeout(() => {
            const index = confirmationWaiters.indexOf(waiter);
            if (index >= 0) confirmationWaiters.splice(index, 1);
            resolve({
              ok: false,
              reason: 'timeout-after-movement-confirmation',
              movementProbeConfirmedAtMs,
              confirmedControllableRenderAtMs,
              confirmedControllableDisplayBoundaryAtMs,
            });
          }, timeout);
          confirmationWaiters.push(waiter);
        });
      },
      stop() {
        if (stopped) throw new Error('Goal 24 start-transition recorder already stopped.');
        if (!movementProbe || confirmedControllableCadenceSnapshot == null
          || confirmedControllableDisplayBoundaryAtMs == null) {
          throw new Error('Goal 24 start transition cannot stop before a confirmed movement probe and subsequent render/display boundary.');
        }
        stopped = true;
        const stoppedAtMs = performance.now();
        traceMark('end');
        const measurementEndedAtMs = confirmedControllableDisplayBoundaryAtMs;
        const cadence = confirmedControllableCadenceSnapshot ?? {
          displayCount,
          renderCount,
          displayDropped,
          renderDropped,
          firstDisplayBoundaryMs,
          lastDisplayBoundaryMs,
          firstRenderBoundaryMs,
          lastRenderBoundaryMs,
        };
        detach();
        for (const waiter of waiters.splice(0)) {
          clearTimeout(waiter.timer);
          waiter.resolve({ ok: false, reason: 'stopped' });
        }
        for (const waiter of displayBoundaryWaiters.splice(0)) {
          clearTimeout(waiter.timer);
          waiter.resolve({ ok: false, reason: 'stopped' });
        }
        delete globalThis.__goal24StartTransitionRecorder;
        return {
          installedAtMs,
          installedAtEpochMs,
          stoppedAtMs,
          stoppedAtEpochMs: performance.timeOrigin + stoppedAtMs,
          measurementEndedAtMs,
          measurementEndedAtEpochMs: performance.timeOrigin + measurementEndedAtMs,
          postMeasurementDurationMs: stoppedAtMs - measurementEndedAtMs,
          renderInstrumentationAttachedAtMs,
          menuControlConsumedAtMs,
          menuControlConsumedAtEpochMs: menuControlConsumedAtMs == null
            ? null : performance.timeOrigin + menuControlConsumedAtMs,
          candidateControllableRenderAtMs,
          candidateControllableRenderEpochMs,
          candidateControllableDisplayBoundaryAtMs,
          candidateControllableDisplayBoundaryEpochMs,
          candidateControllableRendererFrame,
          firstControllableRenderAtMs: confirmedControllableRenderAtMs,
          firstControllableRenderEpochMs: confirmedControllableRenderEpochMs,
          firstControllableDisplayBoundaryAtMs: confirmedControllableDisplayBoundaryAtMs,
          firstControllableDisplayBoundaryEpochMs: confirmedControllableDisplayBoundaryEpochMs,
          firstControllableRendererFrame: confirmedControllableRendererFrame,
          movementProbeConfirmedAtMs,
          movementProbe,
          playerInteriorHistory: {
            observationSource: 'controllable veil-clear shipping-scene3d-render-boundary and clubhouse.isInside',
            playerInteriorObserved,
            firstPlayerInteriorAtMs,
            playerInteriorSampleCount,
            playerExteriorSampleCount,
            playerInteriorTransitionCount,
            lastPlayerInside,
            hiddenPrewarmInteriorSampleCount,
            inactiveInteriorSampleCount,
            hiddenOrInactiveSamplesExcludedFromPlayerCrossingProof: true,
          },
          displayFrameIntervalsMs: Array.from(display.subarray(0, cadence.displayCount)),
          displayCadenceIntervals: Array.from({ length: cadence.displayCount }, (_, index) => ({
            startAtMs: displayStartAtMs[index],
            endAtMs: displayEndAtMs[index],
            durationMs: display[index],
          })),
          renderFrameIntervalsMs: Array.from(render.subarray(0, cadence.renderCount)),
          renderCadenceIntervals: Array.from({ length: cadence.renderCount }, (_, index) => ({
            startAtMs: renderStartAtMs[index],
            endAtMs: renderEndAtMs[index],
            durationMs: render[index],
          })),
          droppedSamples: { display: cadence.displayDropped, render: cadence.renderDropped },
          sampleCoverage: {
            complete: cadence.displayDropped === 0 && cadence.renderDropped === 0,
            windowDurationMs: measurementEndedAtMs - measurementStartedAtMs,
            droppedDisplaySamples: cadence.displayDropped,
            droppedRenderSamples: cadence.renderDropped,
            droppedSubmissionSamples: 0,
            displayFirstBoundaryOffsetMs: cadence.firstDisplayBoundaryMs == null
              ? null : cadence.firstDisplayBoundaryMs - measurementStartedAtMs,
            displayLastBoundaryBeforeEndMs: cadence.lastDisplayBoundaryMs == null
              ? null : measurementEndedAtMs - cadence.lastDisplayBoundaryMs,
            renderFirstBoundaryOffsetMs: cadence.firstRenderBoundaryMs == null
              ? null : cadence.firstRenderBoundaryMs - measurementStartedAtMs,
            renderLastBoundaryBeforeEndMs: cadence.lastRenderBoundaryMs == null
              ? null : measurementEndedAtMs - cadence.lastRenderBoundaryMs,
            measurementPriorDisplayBoundaryMs,
            measurementPriorRenderBoundaryMs,
          },
          inputEvents: JSON.parse(JSON.stringify(inputEvents.filter((event) => event.atMs <= measurementEndedAtMs))),
          driverInputRequests: JSON.parse(JSON.stringify(
            driverInputRequests.filter((entry) => entry.atMs <= measurementEndedAtMs),
          )),
          cleanlyDetached: true,
          traceIdentity: { id: traceId, scenario: traceScenario },
        };
      },
    };
    globalThis.__goal24StartTransitionRecorder = api;
    return api.ready();
  }, {
    requestedDurationMs: maxDurationMs,
    requestedTraceId: traceId,
    requestedTraceScenario: traceScenario,
  });
}

export function waitForGoal24StartControllable(page, timeoutMs = 300_000) {
  return page.evaluate(
    (timeout) => globalThis.__goal24StartTransitionRecorder.waitForControllable(timeout),
    timeoutMs,
  );
}

export function waitForGoal24StartDisplayBoundary(page, timeoutMs = 5000) {
  return page.evaluate(
    (timeout) => globalThis.__goal24StartTransitionRecorder.waitForDisplayBoundary(timeout),
    timeoutMs,
  );
}

export function recordGoal24StartDriverInputRequest(page, request) {
  return page.evaluate(
    (value) => globalThis.__goal24StartTransitionRecorder.recordDriverInputRequest(value),
    request,
  );
}

export function confirmGoal24StartMovementProbe(page, proof, timeoutMs = 10_000) {
  return page.evaluate(
    ({ value, timeout }) => globalThis.__goal24StartTransitionRecorder
      .confirmMovementProbe(value, timeout),
    { value: proof, timeout: timeoutMs },
  );
}

export function stopGoal24StartTransitionRecorder(page) {
  return page.evaluate(() => globalThis.__goal24StartTransitionRecorder.stop());
}

export async function installGoal24InteractionRecorder(page) {
  return page.evaluate(() => {
    if (globalThis.__goal24InteractionRecorder?.schemaVersion === 4) {
      return { installed: true, reused: true };
    }
    globalThis.__goal24InteractionRecorder?.uninstall?.();

    const state = {
      schemaVersion: 4,
      active: null,
      renderTarget: null,
      originalRender: null,
      patchedRender: null,
      rafId: 0,
      inputListenersAttached: false,
      busyStallAlignment: null,
    };

    const cloneJson = (value) => {
      try { return JSON.parse(JSON.stringify(value)); } catch { return null; }
    };
    const finite = (value) => Number.isFinite(value) ? value : null;
    const append = (active, name, value) => {
      const countName = `${name}Count`;
      const droppedName = `${name}Dropped`;
      const index = active[countName];
      if (index < active[name].length) {
        active[name][index] = value;
        active[countName] = index + 1;
      } else {
        active[droppedName] += 1;
      }
    };
    const appendInterval = (active, name, startAtMs, endAtMs) => {
      const index = active[`${name}Count`];
      append(active, name, endAtMs - startAtMs);
      if (active[`${name}Count`] === index + 1) {
        active[`${name}StartAtMs`][index] = startAtMs;
        active[`${name}EndAtMs`][index] = endAtMs;
      }
    };
    const cadenceSnapshot = (active, atMs) => ({
      atMs,
      displayCount: active.displayFrameIntervalsMsCount,
      renderCount: active.renderFrameIntervalsMsCount,
      submissionCount: active.renderSubmissionWallMsCount,
      displayDropped: active.displayFrameIntervalsMsDropped,
      renderDropped: active.renderFrameIntervalsMsDropped,
      submissionDropped: active.renderSubmissionWallMsDropped,
      renderStarts: active.renderStarts,
      renderFrameEvidenceCount: active.renderFrameEvidence.length,
      firstDisplayBoundaryMs: active.firstDisplayBoundaryMs,
      lastDisplayBoundaryMs: active.lastDisplayBoundaryMs,
      firstRenderBoundaryMs: active.firstRenderBoundaryMs,
      lastRenderBoundaryMs: active.lastRenderBoundaryMs,
    });
    const restartAtBoundary = (active, label) => {
      if (active.renderWaiters.length) {
        throw new Error('Cannot restart an interaction window with pending render waiters.');
      }
      if (!Number.isFinite(active.lastDisplayRafMs)
        || !Number.isFinite(active.lastRenderStartMs)) {
        throw new Error('Interaction measurement requires established display and production-render boundaries.');
      }
      const priorDisplayBoundaryMs = active.lastDisplayRafMs;
      const priorRenderBoundaryMs = active.lastRenderStartMs;
      active.displayFrameIntervalsMsCount = 0;
      active.displayFrameIntervalsMsDropped = 0;
      active.renderFrameIntervalsMsCount = 0;
      active.renderFrameIntervalsMsDropped = 0;
      active.renderSubmissionWallMsCount = 0;
      active.renderSubmissionWallMsDropped = 0;
      active.renderStarts = 0;
      active.renderFrameEvidence.length = 0;
      active.measurementGeneration += 1;
      // Preserve the immediately preceding real boundaries. The first measured
      // intervals must straddle the start marker so synchronous input work
      // before the first post-input frame cannot disappear from cadence.
      active.lastDisplayRafMs = priorDisplayBoundaryMs;
      active.lastRenderStartMs = priorRenderBoundaryMs;
      active.measurementPriorDisplayBoundaryMs = priorDisplayBoundaryMs;
      active.measurementPriorRenderBoundaryMs = priorRenderBoundaryMs;
      active.firstDisplayBoundaryMs = null;
      active.lastDisplayBoundaryMs = null;
      active.firstRenderBoundaryMs = null;
      active.lastRenderBoundaryMs = null;
      active.inputEvents.length = 0;
      active.driverInputRequests.length = 0;
      active.discriminator = null;
      active.startedAtMs = performance.now();
      active.markers = [{
        label: String(label),
        atMs: active.startedAtMs,
        detail: {
          priorDisplayBoundaryMs,
          priorRenderBoundaryMs,
        },
        cadenceSnapshot: cadenceSnapshot(active, active.startedAtMs),
      }];
      performance.mark([
        'goal24.interaction',
        encodeURIComponent(active.id),
        encodeURIComponent(active.scenario),
        'start',
        '',
      ].join('|'));
      return {
        label: String(label),
        atMs: active.startedAtMs,
        priorDisplayBoundaryMs,
        priorRenderBoundaryMs,
      };
    };
    const runBusyStall = (active, durationMs) => {
      const duration = Math.max(0, Math.min(500, Number(durationMs) || 0));
      const started = performance.now();
      active.markers.push({
        label: 'busy-stall-begin',
        atMs: started,
        detail: { requestedMs: duration },
        cadenceSnapshot: cadenceSnapshot(active, started),
      });
      while (performance.now() - started < duration) { /* perceptive negative control */ }
      const ended = performance.now();
      active.markers.push({
        label: 'busy-stall-end',
        atMs: ended,
        detail: { elapsedMs: ended - started },
        cadenceSnapshot: cadenceSnapshot(active, ended),
      });
      return { startedAtMs: started, endedAtMs: ended, elapsedMs: ended - started };
    };
    const inputTarget = (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return null;
      return {
        tag: target.tagName.toLowerCase(),
        id: target.id || null,
        classes: [...target.classList].slice(0, 6),
        role: target.getAttribute('role'),
        ariaLabel: target.getAttribute('aria-label'),
        dataQa: target.getAttribute('data-qa'),
      };
    };
    const recordInput = (event) => {
      const active = state.active;
      if (!active || active.endedAtMs != null) return;
      const observedAtMs = performance.now();
      active.inputEvents.push({
        atMs: observedAtMs,
        observedAtMs,
        eventTimestampMs: Number.isFinite(event.timeStamp) ? event.timeStamp : null,
        type: event.type,
        key: typeof event.key === 'string' ? event.key : null,
        code: typeof event.code === 'string' ? event.code : null,
        button: Number.isFinite(event.button) ? event.button : null,
        clientX: Number.isFinite(event.clientX) ? event.clientX : null,
        clientY: Number.isFinite(event.clientY) ? event.clientY : null,
        deltaY: Number.isFinite(event.deltaY) ? event.deltaY : null,
        repeat: !!event.repeat,
        modifiers: {
          alt: !!event.altKey,
          ctrl: !!event.ctrlKey,
          meta: !!event.metaKey,
          shift: !!event.shiftKey,
        },
        target: inputTarget(event),
        isTrusted: !!event.isTrusted,
      });
    };
    const inputTypes = ['keydown', 'keyup', 'pointerdown', 'pointerup', 'click', 'wheel'];
    const attachInputListeners = () => {
      if (state.inputListenersAttached) return;
      for (const type of inputTypes) addEventListener(type, recordInput, true);
      state.inputListenersAttached = true;
    };
    const detachInputListeners = () => {
      if (!state.inputListenersAttached) return;
      for (const type of inputTypes) removeEventListener(type, recordInput, true);
      state.inputListenersAttached = false;
    };

    const settleRenderWaiters = (active) => {
      if (!active.renderWaiters.length) return;
      for (let index = active.renderWaiters.length - 1; index >= 0; index -= 1) {
        const waiter = active.renderWaiters[index];
        if (active.renderStarts < waiter.target) continue;
        active.renderWaiters.splice(index, 1);
        clearTimeout(waiter.timer);
        waiter.resolve({
          ok: true,
          target: waiter.target,
          renderStarts: active.renderStarts,
          waitedMs: performance.now() - waiter.startedAtMs,
        });
      }
    };
    const attachRenderPatch = () => {
      const target = globalThis.__fw?.scene3d;
      if (!target || typeof target.render !== 'function') return false;
      if (state.renderTarget || state.patchedRender) return false;
      const original = target.render;
      const patched = function goal24MeasuredRender(...args) {
        const startedAtMs = performance.now();
        const active = state.active;
        const measurementGeneration = active?.measurementGeneration ?? null;
        const renderer = target.renderer;
        const beforePostStats = (() => {
          try { return target.post?.stats?.() || null; } catch { return null; }
        })();
        const rendererFrameBefore = Number(renderer?.info?.render?.frame);
        const shadowBakesBefore = Number(beforePostStats?.shadowBakes);
        const composedRendersBefore = Number(beforePostStats?.composedRenders);
        if (active && active.endedAtMs == null) {
          if (active.firstRenderBoundaryMs == null) active.firstRenderBoundaryMs = startedAtMs;
          active.lastRenderBoundaryMs = startedAtMs;
          if (active.lastRenderStartMs != null) {
            appendInterval(active, 'renderFrameIntervalsMs', active.lastRenderStartMs, startedAtMs);
          }
          active.lastRenderStartMs = startedAtMs;
          active.renderStarts += 1;
        }
        try {
          return original.apply(this, args);
        } finally {
          if (active && state.active === active && active.endedAtMs == null
            && active.measurementGeneration === measurementGeneration) {
            const endedAtMs = performance.now();
            append(active, 'renderSubmissionWallMs', endedAtMs - startedAtMs);
            const afterPostStats = (() => {
              try { return target.post?.stats?.() || null; } catch { return null; }
            })();
            const shadowBakesAfter = Number(afterPostStats?.shadowBakes);
            const composedRendersAfter = Number(afterPostStats?.composedRenders);
            const shadowComparable = Number.isInteger(shadowBakesBefore)
              && Number.isInteger(shadowBakesAfter)
              && shadowBakesAfter >= shadowBakesBefore;
            const shadowBakeDelta = shadowComparable
              ? shadowBakesAfter - shadowBakesBefore : null;
            const composedComparable = Number.isInteger(composedRendersBefore)
              && Number.isInteger(composedRendersAfter)
              && composedRendersAfter >= composedRendersBefore;
            const composedRenderDelta = composedComparable
              ? composedRendersAfter - composedRendersBefore : null;
            active.renderFrameEvidence.push({
              ordinal: active.renderFrameEvidence.length + 1,
              productionRenderStartedAtMs: startedAtMs,
              productionRenderEndedAtMs: endedAtMs,
              rendererFrameBefore: Number.isInteger(rendererFrameBefore)
                ? rendererFrameBefore : null,
              rendererFrameAfter: Number.isInteger(Number(renderer?.info?.render?.frame))
                ? Number(renderer.info.render.frame) : null,
              calls: Number.isInteger(Number(renderer?.info?.render?.calls))
                ? Number(renderer.info.render.calls) : null,
              triangles: Number.isInteger(Number(renderer?.info?.render?.triangles))
                ? Number(renderer.info.render.triangles) : null,
              rendererInfoAutoReset: renderer?.info?.autoReset === true,
              shadowBakesBefore: shadowComparable ? shadowBakesBefore : null,
              shadowBakesAfter: shadowComparable ? shadowBakesAfter : null,
              shadowBakeDelta,
              composedRendersBefore: composedComparable ? composedRendersBefore : null,
              composedRendersAfter: composedComparable ? composedRendersAfter : null,
              composedRenderDelta,
              frameClass: shadowBakeDelta == null
                ? 'unclassified' : shadowBakeDelta > 0 ? 'shadow-bake' : 'non-shadow',
              boundarySource: 'shipping-scene3d.render-wrapper',
              counterSource: 'THREE.WebGLRenderer.info.render-after-shipping-composed-frame',
              shadowClassificationSource: 'scene3d.post.stats().shadowBakes',
              composedRenderSource: 'scene3d.post.stats().composedRenders',
            });
            settleRenderWaiters(active);
          }
        }
      };
      state.renderTarget = target;
      state.originalRender = original;
      state.patchedRender = patched;
      target.render = patched;
      return true;
    };
    const detachRenderPatch = () => {
      if (state.renderTarget && state.originalRender
        && state.renderTarget.render === state.patchedRender) {
        state.renderTarget.render = state.originalRender;
      }
      state.renderTarget = null;
      state.originalRender = null;
      state.patchedRender = null;
    };
    const rejectBusyStallRequest = (pending, error) => {
      if (!pending) return false;
      if (state.busyStallAlignment === pending) state.busyStallAlignment = null;
      clearTimeout(pending.timer);
      if (pending.nextRafTimer) clearTimeout(pending.nextRafTimer);
      pending.reject(error instanceof Error ? error : new Error(String(error)));
      return true;
    };
    const rejectBusyStallAlignment = (active, reason) => {
      const pending = state.busyStallAlignment;
      if (!pending || (active && pending.active !== active)) return false;
      return rejectBusyStallRequest(
        pending,
        new Error(`Busy-stall display alignment aborted: ${reason}.`),
      );
    };
    const scheduleDisplayClock = () => {
      const tick = (timestamp) => {
        const tickObservedAtMs = performance.now();
        const active = state.active;
        if (!active || active.endedAtMs != null) {
          state.rafId = 0;
          rejectBusyStallAlignment(null, 'display-clock-inactive');
          return;
        }
        const pending = state.busyStallAlignment;
        if (pending?.active === active
          && pending.stage === 'awaiting-post-stall-display'
          && timestamp < pending.busyStall.endedAtMs) {
          const requestedAtMs = pending.acceptedPostStallRafRequestedAtMs;
          const priorDisplayBoundaryMs = pending.boundary.priorDisplayBoundaryMs;
          const validStaleProbe = pending.stalePostStallRafCallbacks.length === 0
            && Number.isFinite(timestamp)
            && Number.isFinite(requestedAtMs)
            && priorDisplayBoundaryMs < timestamp
            && pending.busyStall.startedAtMs < timestamp
            && timestamp < pending.busyStall.endedAtMs
            && requestedAtMs <= tickObservedAtMs
            && pending.busyStall.endedAtMs <= tickObservedAtMs;
          if (!validStaleProbe) {
            state.rafId = 0;
            rejectBusyStallRequest(
              pending,
              new Error('Busy-stall display alignment received an invalid or repeated stale rAF timestamp.'),
            );
            return;
          }
          pending.stalePostStallRafCallbacks.push({
            requestedAtMs,
            timestampMs: timestamp,
            observedAtMs: tickObservedAtMs,
          });
          try {
            state.rafId = requestAnimationFrame(tick);
            pending.postStallRafRequestCount += 1;
            pending.acceptedPostStallRafRequestedAtMs = performance.now();
          } catch (error) {
            state.rafId = 0;
            rejectBusyStallRequest(pending, error);
          }
          return;
        }
        if (active.lastDisplayRafMs != null) {
          appendInterval(active, 'displayFrameIntervalsMs', active.lastDisplayRafMs, timestamp);
        }
        if (active.firstDisplayBoundaryMs == null) active.firstDisplayBoundaryMs = timestamp;
        active.lastDisplayBoundaryMs = timestamp;
        active.lastDisplayRafMs = timestamp;

        // Consume the perceptive control from inside this recorder-owned rAF.
        // The next rAF is requested from a new task after the synchronous
        // stall. Chromium may still deliver one rendering opportunity whose
        // nominal timestamp falls inside the blocked interval; that callback
        // is retained as a bounded stale probe above, and only the first real
        // post-stall boundary resumes the measured cadence.
        let startedAlignment = null;
        let completedAlignment = null;
        if (pending && pending.active === active) {
          if (pending.stage === 'queued') {
            try {
              pending.boundary = restartAtBoundary(active, pending.label);
              pending.busyStall = runBusyStall(active, pending.durationMs);
              pending.displayTickTimestampMs = timestamp;
              pending.displayTickObservedAtMs = tickObservedAtMs;
              pending.stage = 'awaiting-post-stall-raf-request';
              startedAlignment = pending;
            } catch (error) {
              rejectBusyStallRequest(pending, error);
            }
          } else if (pending.stage === 'awaiting-post-stall-display') {
            const intervalIndex = active.displayFrameIntervalsMsCount - 1;
            const postStallDisplayInterval = intervalIndex >= 0 ? {
              startAtMs: active.displayFrameIntervalsMsStartAtMs[intervalIndex],
              endAtMs: active.displayFrameIntervalsMsEndAtMs[intervalIndex],
              durationMs: active.displayFrameIntervalsMs[intervalIndex],
            } : null;
            completedAlignment = {
              pending,
              postStallDisplayTickTimestampMs: timestamp,
              postStallDisplayTickObservedAtMs: tickObservedAtMs,
              postStallDisplayInterval,
            };
          } else {
            rejectBusyStallRequest(
              pending,
              new Error(`Unknown busy-stall display alignment stage: ${pending.stage}.`),
            );
          }
        }

        if (startedAlignment) {
          state.rafId = 0;
          try {
            startedAlignment.nextRafTimer = setTimeout(() => {
              startedAlignment.nextRafTimer = 0;
              if (state.busyStallAlignment !== startedAlignment
                || state.active !== active || active.endedAtMs != null) {
                rejectBusyStallRequest(
                  startedAlignment,
                  new Error('Busy-stall display alignment lost its active window before the post-stall rAF request.'),
                );
                return;
              }
              startedAlignment.postStallRequestTaskObservedAtMs = performance.now();
              startedAlignment.stage = 'awaiting-post-stall-display';
              try {
                state.rafId = requestAnimationFrame(tick);
                startedAlignment.nextDisplayRafRequestedAtMs = performance.now();
                startedAlignment.acceptedPostStallRafRequestedAtMs
                  = startedAlignment.nextDisplayRafRequestedAtMs;
                startedAlignment.postStallRafRequestCount = 1;
              } catch (error) {
                state.rafId = 0;
                rejectBusyStallRequest(startedAlignment, error);
              }
            }, 0);
          } catch (error) {
            rejectBusyStallRequest(startedAlignment, error);
          }
          return;
        }

        try {
          state.rafId = requestAnimationFrame(tick);
        } catch (error) {
          state.rafId = 0;
          if (state.busyStallAlignment?.active === active) {
            rejectBusyStallRequest(state.busyStallAlignment, error);
            return;
          }
          throw error;
        }

        if (completedAlignment) {
          const {
            pending: request,
            postStallDisplayTickTimestampMs,
            postStallDisplayTickObservedAtMs,
            postStallDisplayInterval,
          } = completedAlignment;
          const { boundary, busyStall } = request;
          const staleProbe = request.stalePostStallRafCallbacks[0] ?? null;
          const phaseAligned = boundary.priorDisplayBoundaryMs
              === request.displayTickTimestampMs
            && request.requestQueuedAtMs <= request.displayTickObservedAtMs
            && request.displayTickObservedAtMs <= boundary.atMs
            && boundary.atMs <= busyStall.startedAtMs
            && busyStall.endedAtMs <= request.postStallRequestTaskObservedAtMs
            && request.postStallRequestTaskObservedAtMs
              <= request.nextDisplayRafRequestedAtMs
            && request.nextDisplayRafRequestedAtMs
              <= request.acceptedPostStallRafRequestedAtMs
            && request.acceptedPostStallRafRequestedAtMs
              <= postStallDisplayTickObservedAtMs
            // Chromium's rAF timestamp is the frame's nominal deadline, not
            // the JavaScript callback-delivery time. After a stale callback,
            // the accepted rAF can therefore be requested just after that
            // deadline and still be delivered afterward. The observed time
            // above is the authority for request-before-delivery ordering.
            && postStallDisplayTickTimestampMs
              <= postStallDisplayTickObservedAtMs
            && request.stalePostStallRafCallbacks.length <= 1
            && request.postStallRafRequestCount
              === request.stalePostStallRafCallbacks.length + 1
            && request.stalePostStallRafCallbacks.every((entry) => (
              request.nextDisplayRafRequestedAtMs === entry.requestedAtMs
              && boundary.priorDisplayBoundaryMs < entry.timestampMs
              && busyStall.startedAtMs < entry.timestampMs
              && entry.timestampMs < busyStall.endedAtMs
              && entry.requestedAtMs <= entry.observedAtMs
              && busyStall.endedAtMs <= entry.observedAtMs
            ))
            && (staleProbe
              ? (staleProbe.observedAtMs
                <= request.acceptedPostStallRafRequestedAtMs
                && staleProbe.timestampMs < postStallDisplayTickTimestampMs)
              : request.nextDisplayRafRequestedAtMs
                === request.acceptedPostStallRafRequestedAtMs)
            && busyStall.endedAtMs <= postStallDisplayTickTimestampMs
            && postStallDisplayInterval?.startAtMs === boundary.priorDisplayBoundaryMs
            && postStallDisplayInterval?.endAtMs === postStallDisplayTickTimestampMs
            && postStallDisplayInterval.startAtMs <= busyStall.startedAtMs
            && postStallDisplayInterval.endAtMs >= busyStall.endedAtMs;
          if (state.busyStallAlignment === request) state.busyStallAlignment = null;
          clearTimeout(request.timer);
          request.resolve({
            boundary,
            busyStall,
            alignment: {
              source: 'recorder-display-raf-task-hop-two-boundary-phase-alignment',
              requestQueuedAtMs: request.requestQueuedAtMs,
              displayTickTimestampMs: request.displayTickTimestampMs,
              displayTickObservedAtMs: request.displayTickObservedAtMs,
              postStallRequestTaskObservedAtMs: request.postStallRequestTaskObservedAtMs,
              nextDisplayRafRequestedAtMs: request.nextDisplayRafRequestedAtMs,
              acceptedPostStallRafRequestedAtMs:
                request.acceptedPostStallRafRequestedAtMs,
              postStallRafRequestCount: request.postStallRafRequestCount,
              stalePostStallRafCallbacks: cloneJson(request.stalePostStallRafCallbacks),
              postStallDisplayTickTimestampMs,
              postStallDisplayTickObservedAtMs,
              postStallDisplayInterval,
              phaseAligned,
            },
          });
        }
      };
      state.rafId = requestAnimationFrame(tick);
    };
    const stopActiveInstrumentation = (active, waiterReason = 'window-ended') => {
      if (state.rafId) cancelAnimationFrame(state.rafId);
      state.rafId = 0;
      rejectBusyStallAlignment(active, waiterReason);
      detachInputListeners();
      detachRenderPatch();
      for (const waiter of active.renderWaiters.splice(0)) {
        clearTimeout(waiter.timer);
        waiter.resolve({
          ok: false,
          reason: waiterReason,
          target: waiter.target,
          renderStarts: active.renderStarts,
          waitedMs: performance.now() - waiter.startedAtMs,
        });
      }
    };
    const basicEnvironment = () => {
      const fw = globalThis.__fw;
      const renderer = fw?.scene3d?.renderer;
      const gl = renderer?.getContext?.();
      let gpu = null;
      let vendor = null;
      let timerQueryAvailable = false;
      if (gl) {
        const debug = gl.getExtension('WEBGL_debug_renderer_info');
        gpu = debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : 'masked';
        vendor = debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : 'masked';
        timerQueryAvailable = !!(
          gl.getExtension('EXT_disjoint_timer_query_webgl2')
          || gl.getExtension('EXT_disjoint_timer_query')
        );
      }
      return {
        timeOriginEpochMs: performance.timeOrigin,
        nowMs: performance.now(),
        devicePixelRatio,
        viewportCss: { width: innerWidth, height: innerHeight },
        canvasPixels: renderer?.domElement
          ? { width: renderer.domElement.width, height: renderer.domElement.height }
          : null,
        gpu,
        vendor,
        timerQueryAvailable,
        quality: cloneJson(fw?.preferences?.values?.display || null),
        fpsCap: fw?.preferences?.values?.display?.fpsCap ?? null,
        audio: cloneJson(fw?.audio?.debugStats?.() || null),
        rendererLastFrame: renderer?.info ? {
          calls: finite(renderer.info.render?.calls),
          triangles: finite(renderer.info.render?.triangles),
          geometries: finite(renderer.info.memory?.geometries),
          textures: finite(renderer.info.memory?.textures),
          programs: Array.isArray(renderer.info.programs) ? renderer.info.programs.length : null,
        } : null,
      };
    };

    const api = {
      schemaVersion: 4,
      begin(descriptor) {
        if (state.active) throw new Error(`Interaction window already active: ${state.active.id}`);
        const id = String(descriptor?.id || '').trim();
        if (!id) throw new Error('Interaction window requires an id.');
        const maxDurationMs = Math.max(250, Math.min(180_000, Number(descriptor?.maxDurationMs) || 15_000));
        const maxSampleHz = Math.max(60, Math.min(500, Number(descriptor?.maxSampleHz) || 360));
        const capacity = Math.ceil(maxDurationMs / 1000 * maxSampleHz) + 32;
        const active = {
          id,
          scenario: String(descriptor?.scenario || id),
          repetition: Number(descriptor?.repetition || 1),
          thermalState: descriptor?.thermalState === 'cold' ? 'cold' : 'warm',
          instrumentationMode: String(descriptor?.instrumentationMode || 'low-overhead'),
          maxDurationMs,
          maxSampleHz,
          displayFrameIntervalsMs: new Float64Array(capacity),
          displayFrameIntervalsMsStartAtMs: new Float64Array(capacity),
          displayFrameIntervalsMsEndAtMs: new Float64Array(capacity),
          displayFrameIntervalsMsCount: 0,
          displayFrameIntervalsMsDropped: 0,
          renderFrameIntervalsMs: new Float64Array(capacity),
          renderFrameIntervalsMsStartAtMs: new Float64Array(capacity),
          renderFrameIntervalsMsEndAtMs: new Float64Array(capacity),
          renderFrameIntervalsMsCount: 0,
          renderFrameIntervalsMsDropped: 0,
          renderSubmissionWallMs: new Float64Array(capacity),
          renderSubmissionWallMsCount: 0,
          renderSubmissionWallMsDropped: 0,
          renderStarts: 0,
          renderFrameEvidence: [],
          measurementGeneration: 0,
          renderWaiters: [],
          lastDisplayRafMs: null,
          lastRenderStartMs: null,
          firstDisplayBoundaryMs: null,
          lastDisplayBoundaryMs: null,
          firstRenderBoundaryMs: null,
          lastRenderBoundaryMs: null,
          measurementPriorDisplayBoundaryMs: null,
          measurementPriorRenderBoundaryMs: null,
          markers: [],
          inputEvents: [],
          driverInputRequests: [],
          discriminator: null,
          endedAtMs: null,
        };
        if (!attachRenderPatch()) throw new Error('Shipping scene3d.render is unavailable or already patched.');
        attachInputListeners();
        active.startedAtMs = performance.now();
        active.markers.push({ label: 'window-start', atMs: active.startedAtMs, detail: null });
        state.active = active;
        scheduleDisplayClock();
        return { id, startedAtMs: active.startedAtMs, capacity, renderPatchAttached: true };
      },
      restartAtMeasurementBoundary(label = 'measurement-armed') {
        const active = state.active;
        if (!active) throw new Error('No active interaction window.');
        if (state.busyStallAlignment) {
          throw new Error('Cannot restart while busy-stall display alignment is pending.');
        }
        return restartAtBoundary(active, label);
      },
      restartWithBusyStall(
        label = 'measurement-armed-before-immediate-stall',
        durationMs = 80,
        alignmentTimeoutMs = 5000,
      ) {
        const active = state.active;
        if (!active) throw new Error('No active interaction window.');
        if (state.busyStallAlignment) {
          throw new Error('Busy-stall display alignment is already pending.');
        }
        return new Promise((resolve, reject) => {
          const request = {
            active,
            label: String(label),
            durationMs,
            alignmentTimeoutMs: Math.max(
              25,
              Math.min(10_000, Number(alignmentTimeoutMs) || 5000),
            ),
            requestQueuedAtMs: performance.now(),
            stage: 'queued',
            nextRafTimer: 0,
            postStallRafRequestCount: 0,
            stalePostStallRafCallbacks: [],
            resolve,
            reject,
            timer: 0,
          };
          state.busyStallAlignment = request;
          request.timer = setTimeout(() => {
            if (state.busyStallAlignment !== request) return;
            state.busyStallAlignment = null;
            reject(new Error('Busy-stall display alignment timed out before alignment completed.'));
          }, request.alignmentTimeoutMs);
        });
      },
      mark(label, detail = null) {
        const active = state.active;
        if (!active) throw new Error('No active interaction window.');
        const atMs = performance.now();
        const marker = {
          label: String(label),
          atMs,
          detail: cloneJson(detail),
          cadenceSnapshot: cadenceSnapshot(active, atMs),
        };
        active.markers.push(marker);
        performance.mark([
          'goal24.interaction',
          encodeURIComponent(active.id),
          encodeURIComponent(active.scenario),
          'marker',
          encodeURIComponent(marker.label),
        ].join('|'));
        return cloneJson(marker);
      },
      recordDriverInputRequest(request) {
        const active = state.active;
        if (!active) throw new Error('No active interaction window.');
        const atMs = performance.now();
        const entry = { atMs, ...cloneJson(request) };
        active.driverInputRequests.push(entry);
        return cloneJson(entry);
      },
      setDiscriminator(discriminator) {
        const active = state.active;
        if (!active) throw new Error('No active interaction window.');
        active.discriminator = cloneJson(discriminator);
        return active.discriminator;
      },
      awaitRenders(minAdditional = 2, timeoutMs = 2000) {
        const active = state.active;
        if (!active) throw new Error('No active interaction window.');
        const additional = Math.max(1, Math.min(30, Number(minAdditional) || 2));
        const timeout = Math.max(100, Math.min(10_000, Number(timeoutMs) || 2000));
        const target = active.renderStarts + additional;
        return new Promise((resolve) => {
          const waiter = {
            target,
            resolve,
            startedAtMs: performance.now(),
            timer: 0,
          };
          waiter.timer = setTimeout(() => {
            const index = active.renderWaiters.indexOf(waiter);
            if (index >= 0) active.renderWaiters.splice(index, 1);
            resolve({
              ok: false,
              reason: 'timeout',
              target,
              renderStarts: active.renderStarts,
              waitedMs: performance.now() - waiter.startedAtMs,
            });
          }, timeout);
          active.renderWaiters.push(waiter);
        });
      },
      end(discriminator = null) {
        const active = state.active;
        if (!active) throw new Error('No active interaction window.');
        const recordingStoppedAtMs = performance.now();
        if (discriminator != null) active.discriminator = cloneJson(discriminator);
        const requestedMeasurementEndAtMs = active.discriminator?.contractOutcomeMarkerAtMs;
        const measurementMarker = Number.isFinite(requestedMeasurementEndAtMs)
          ? active.markers.find((marker) => (
            marker.label === 'post-outcome-render-boundary'
            && marker.atMs === requestedMeasurementEndAtMs
          ))
          : null;
        if (Number.isFinite(requestedMeasurementEndAtMs) && !measurementMarker?.cadenceSnapshot) {
          throw new Error('Contract outcome marker is not an exact recorder-owned cadence snapshot.');
        }
        const endedAtMs = measurementMarker?.atMs ?? recordingStoppedAtMs;
        const endSnapshot = measurementMarker?.cadenceSnapshot
          ?? cadenceSnapshot(active, recordingStoppedAtMs);
        active.endedAtMs = recordingStoppedAtMs;
        active.markers.push({
          label: 'window-end',
          atMs: recordingStoppedAtMs,
          detail: null,
          cadenceSnapshot: cadenceSnapshot(active, recordingStoppedAtMs),
        });
        performance.mark([
          'goal24.interaction',
          encodeURIComponent(active.id),
          encodeURIComponent(active.scenario),
          'end',
          '',
        ].join('|'));
        state.active = null;
        stopActiveInstrumentation(active);
        const intervalEvidence = (name, count) => Array.from({ length: count }, (_, index) => ({
          startAtMs: active[`${name}StartAtMs`][index],
          endAtMs: active[`${name}EndAtMs`][index],
          durationMs: active[name][index],
        }));
        return {
          id: active.id,
          scenario: active.scenario,
          repetition: active.repetition,
          thermalState: active.thermalState,
          instrumentationMode: active.instrumentationMode,
          startedAtMs: active.startedAtMs,
          endedAtMs,
          recordingStoppedAtMs,
          postMeasurementDurationMs: recordingStoppedAtMs - endedAtMs,
          durationMs: endedAtMs - active.startedAtMs,
          displayFrameIntervalsMs: Array.from(active.displayFrameIntervalsMs.subarray(0, endSnapshot.displayCount)),
          displayCadenceIntervals: intervalEvidence('displayFrameIntervalsMs', endSnapshot.displayCount),
          renderFrameIntervalsMs: Array.from(active.renderFrameIntervalsMs.subarray(0, endSnapshot.renderCount)),
          renderCadenceIntervals: intervalEvidence('renderFrameIntervalsMs', endSnapshot.renderCount),
          renderSubmissionWallMs: Array.from(active.renderSubmissionWallMs.subarray(0, endSnapshot.submissionCount)),
          renderFrameEvidence: cloneJson(active.renderFrameEvidence.slice(0, endSnapshot.renderFrameEvidenceCount)),
          renderStarts: endSnapshot.renderStarts,
          droppedSamples: {
            display: endSnapshot.displayDropped,
            render: endSnapshot.renderDropped,
            submission: endSnapshot.submissionDropped,
          },
          sampleCoverage: {
            complete: endSnapshot.displayDropped === 0
              && endSnapshot.renderDropped === 0
              && endSnapshot.submissionDropped === 0,
            windowDurationMs: endedAtMs - active.startedAtMs,
            droppedDisplaySamples: endSnapshot.displayDropped,
            droppedRenderSamples: endSnapshot.renderDropped,
            droppedSubmissionSamples: endSnapshot.submissionDropped,
            rendererFrameEvidenceSamples: endSnapshot.renderFrameEvidenceCount,
            displayFirstBoundaryOffsetMs: endSnapshot.firstDisplayBoundaryMs == null
              ? null : endSnapshot.firstDisplayBoundaryMs - active.startedAtMs,
            displayLastBoundaryBeforeEndMs: endSnapshot.lastDisplayBoundaryMs == null
              ? null : endedAtMs - endSnapshot.lastDisplayBoundaryMs,
            renderFirstBoundaryOffsetMs: endSnapshot.firstRenderBoundaryMs == null
              ? null : endSnapshot.firstRenderBoundaryMs - active.startedAtMs,
            renderLastBoundaryBeforeEndMs: endSnapshot.lastRenderBoundaryMs == null
              ? null : endedAtMs - endSnapshot.lastRenderBoundaryMs,
            measurementPriorDisplayBoundaryMs: active.measurementPriorDisplayBoundaryMs,
            measurementPriorRenderBoundaryMs: active.measurementPriorRenderBoundaryMs,
          },
          markers: cloneJson(active.markers.filter((marker) => marker.atMs <= endedAtMs)),
          postMeasurementMarkers: cloneJson(active.markers.filter((marker) => marker.atMs > endedAtMs)),
          inputEvents: cloneJson(active.inputEvents.filter((event) => event.atMs <= endedAtMs)),
          driverInputRequests: cloneJson(active.driverInputRequests.filter((entry) => entry.atMs <= endedAtMs)),
          discriminator: cloneJson(active.discriminator),
        };
      },
      busyStall(durationMs) {
        if (!state.active) throw new Error('Busy-stall control requires an active interaction window.');
        if (state.busyStallAlignment) {
          throw new Error('Cannot run an unaligned busy stall while display alignment is pending.');
        }
        return runBusyStall(state.active, durationMs);
      },
      environment: basicEnvironment,
      diagnostics() {
        return {
          schemaVersion: state.schemaVersion,
          active: !!state.active,
          activeId: state.active?.id ?? null,
          activeScenario: state.active?.scenario ?? null,
          renderPatched: !!state.patchedRender,
          displayRafScheduled: !!state.rafId,
          inputListenersAttached: state.inputListenersAttached,
          busyStallAlignmentPending: !!state.busyStallAlignment,
          retainedCompletedWindows: 0,
        };
      },
      uninstall() {
        const active = state.active;
        if (active) {
          active.endedAtMs = performance.now();
          state.active = null;
          stopActiveInstrumentation(active, 'recorder-uninstalled');
        } else {
          if (state.rafId) cancelAnimationFrame(state.rafId);
          state.rafId = 0;
          rejectBusyStallAlignment(null, 'recorder-uninstalled');
          detachInputListeners();
          detachRenderPatch();
        }
        delete globalThis.__goal24InteractionRecorder;
        return { uninstalled: true, activeWindowAborted: !!active };
      },
    };
    globalThis.__goal24InteractionRecorder = api;
    return { installed: true, reused: false };
  });
}

export function validateGoal24BusyStallPhaseAlignment(immediateControl) {
  const finite = (value) => Number.isFinite(value);
  const boundary = immediateControl?.boundary;
  const busyStall = immediateControl?.busyStall;
  const alignment = immediateControl?.alignment;
  const interval = alignment?.postStallDisplayInterval;
  const stale = alignment?.stalePostStallRafCallbacks;
  if (alignment?.phaseAligned !== true
    || alignment.source
      !== 'recorder-display-raf-task-hop-two-boundary-phase-alignment'
    || !finite(boundary?.priorDisplayBoundaryMs)
    || !finite(boundary?.priorRenderBoundaryMs)
    || !finite(boundary?.atMs)
    || !finite(busyStall?.startedAtMs)
    || !finite(busyStall?.endedAtMs)
    || busyStall.endedAtMs < busyStall.startedAtMs
    || !finite(alignment.requestQueuedAtMs)
    || !finite(alignment.displayTickTimestampMs)
    || !finite(alignment.displayTickObservedAtMs)
    || !finite(alignment.postStallRequestTaskObservedAtMs)
    || !finite(alignment.nextDisplayRafRequestedAtMs)
    || !finite(alignment.acceptedPostStallRafRequestedAtMs)
    || !finite(alignment.postStallDisplayTickTimestampMs)
    || !finite(alignment.postStallDisplayTickObservedAtMs)
    || !Number.isInteger(alignment.postStallRafRequestCount)
    || !Array.isArray(stale)
    || stale.length > 1
    || alignment.postStallRafRequestCount !== stale.length + 1
    || alignment.displayTickTimestampMs !== boundary.priorDisplayBoundaryMs
    || alignment.requestQueuedAtMs > alignment.displayTickObservedAtMs
    || alignment.displayTickObservedAtMs > boundary.atMs
    || boundary.atMs > busyStall.startedAtMs
    || busyStall.endedAtMs > alignment.postStallRequestTaskObservedAtMs
    || alignment.postStallRequestTaskObservedAtMs > alignment.nextDisplayRafRequestedAtMs
    || alignment.nextDisplayRafRequestedAtMs
      > alignment.acceptedPostStallRafRequestedAtMs
    || alignment.acceptedPostStallRafRequestedAtMs
      > alignment.postStallDisplayTickObservedAtMs
    || alignment.postStallDisplayTickTimestampMs
      > alignment.postStallDisplayTickObservedAtMs
    || busyStall.endedAtMs > alignment.postStallDisplayTickTimestampMs
    || !finite(interval?.startAtMs)
    || !finite(interval?.endAtMs)
    || !finite(interval?.durationMs)
    || interval.startAtMs !== boundary.priorDisplayBoundaryMs
    || interval.endAtMs !== alignment.postStallDisplayTickTimestampMs
    || Math.abs((interval.endAtMs - interval.startAtMs) - interval.durationMs) > 0.5
    || interval.startAtMs > busyStall.startedAtMs
    || interval.endAtMs < busyStall.endedAtMs) {
    return false;
  }
  if (stale.length === 0) {
    return alignment.nextDisplayRafRequestedAtMs
      === alignment.acceptedPostStallRafRequestedAtMs;
  }
  const probe = stale[0];
  return finite(probe?.requestedAtMs)
    && finite(probe?.timestampMs)
    && finite(probe?.observedAtMs)
    && probe.requestedAtMs === alignment.nextDisplayRafRequestedAtMs
    && boundary.priorDisplayBoundaryMs < probe.timestampMs
    && busyStall.startedAtMs < probe.timestampMs
    && probe.timestampMs < busyStall.endedAtMs
    && probe.requestedAtMs <= probe.observedAtMs
    && busyStall.endedAtMs <= probe.observedAtMs
    && probe.observedAtMs <= alignment.acceptedPostStallRafRequestedAtMs
    && probe.timestampMs < alignment.postStallDisplayTickTimestampMs;
}

export function beginInteractionWindow(page, descriptor) {
  return page.evaluate(
    (value) => globalThis.__goal24InteractionRecorder.begin(value),
    descriptor,
  );
}

export function markInteraction(page, label, detail = null) {
  return page.evaluate(
    ({ nextLabel, nextDetail }) => globalThis.__goal24InteractionRecorder.mark(nextLabel, nextDetail),
    { nextLabel: label, nextDetail: detail },
  );
}

export function recordDriverInputRequest(page, request) {
  return page.evaluate(
    (value) => globalThis.__goal24InteractionRecorder.recordDriverInputRequest(value),
    request,
  );
}

export function restartInteractionMeasurement(page, label = 'measurement-armed') {
  return page.evaluate(
    (nextLabel) => globalThis.__goal24InteractionRecorder.restartAtMeasurementBoundary(nextLabel),
    label,
  );
}

export function restartInteractionMeasurementWithBusyStall(
  page,
  label = 'measurement-armed-before-immediate-stall',
  durationMs = 80,
) {
  return page.evaluate(
    ({ nextLabel, duration }) => (
      globalThis.__goal24InteractionRecorder.restartWithBusyStall(nextLabel, duration)
    ),
    { nextLabel: label, duration: durationMs },
  );
}

export function awaitInteractionRenders(page, minAdditional = 2, timeoutMs = 2000) {
  return page.evaluate(
    ({ count, timeout }) => globalThis.__goal24InteractionRecorder.awaitRenders(count, timeout),
    { count: minAdditional, timeout: timeoutMs },
  );
}

export function endInteractionWindow(page, discriminator = null) {
  return page.evaluate(
    (value) => globalThis.__goal24InteractionRecorder.end(value),
    discriminator,
  );
}

export function injectBusyStall(page, durationMs) {
  return page.evaluate(
    (value) => globalThis.__goal24InteractionRecorder.busyStall(value),
    durationMs,
  );
}

export function readInteractionEnvironment(page) {
  return page.evaluate(() => globalThis.__goal24InteractionRecorder.environment());
}

export function readInteractionRecorderDiagnostics(page) {
  return page.evaluate(() => globalThis.__goal24InteractionRecorder.diagnostics());
}

export function uninstallGoal24InteractionRecorder(page) {
  return page.evaluate(() => globalThis.__goal24InteractionRecorder?.uninstall?.() ?? {
    uninstalled: true,
    alreadyAbsent: true,
  });
}
