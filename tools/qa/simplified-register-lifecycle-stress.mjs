import fs from 'node:fs';
import path from 'node:path';

const BASE_URL = process.env.QA_BASE_URL || 'http://localhost:8457/';
const DEFAULT_VIEWPORT = Object.freeze({ width: 1600, height: 900 });
const DEFAULT_CYCLES = 20;
const PROFILE_COUNTS = Object.freeze({
  master: Object.freeze({
    enterExits: 100,
    cardTransactions: 100,
    cashTransactions: 100,
    preAuthCancellations: 50,
    declineRecoveries: 50,
    drawerOpenCloses: 100,
    customerSpawnRemovalsMinimum: 100,
  }),
  smoke: Object.freeze({
    enterExits: 2,
    cardTransactions: 2,
    cashTransactions: 2,
    preAuthCancellations: 1,
    declineRecoveries: 1,
    drawerOpenCloses: 2,
    customerSpawnRemovalsMinimum: 2,
  }),
});
const COUNT_OPTIONS = Object.freeze([
  ['enterExits', 'REGISTER_QA_ENTER_EXITS'],
  ['cardTransactions', 'REGISTER_QA_CARD_TRANSACTIONS'],
  ['cashTransactions', 'REGISTER_QA_CASH_TRANSACTIONS'],
  ['preAuthCancellations', 'REGISTER_QA_PREAUTH_CANCELLATIONS'],
  ['declineRecoveries', 'REGISTER_QA_DECLINE_RECOVERIES'],
  ['drawerOpenCloses', 'REGISTER_QA_DRAWER_OPEN_CLOSES'],
  ['customerSpawnRemovalsMinimum', 'REGISTER_QA_CUSTOMER_LIFECYCLES'],
]);
const SKUS = Object.freeze(['tees1', 'marker1', 'glove1']);
let VIEWPORT = { ...DEFAULT_VIEWPORT };

function assert(value, message) {
  if (!value) throw new Error(message);
}

function shouldSampleIteration(iteration, total) {
  if (total <= 0) return false;
  const interval = Math.max(1, Math.ceil(total / 20));
  return iteration === 1 || iteration === total || iteration % interval === 0;
}

export function shouldSampleFrontDeskIteration(iteration, total) {
  if (!Number.isInteger(iteration) || !Number.isInteger(total)
      || iteration < 1 || iteration > total) return false;
  const denseTailStart = Math.max(1, total - 19);
  return iteration >= denseTailStart || shouldSampleIteration(iteration, total);
}

function configureViewport(value) {
  const raw = String(value || '').trim().toLowerCase().replace('\u00d7', 'x');
  if (!raw) {
    VIEWPORT = { ...DEFAULT_VIEWPORT };
    return `${VIEWPORT.width}x${VIEWPORT.height}`;
  }
  const match = /^(\d{3,5})x(\d{3,5})$/.exec(raw);
  if (!match) throw new Error(`Invalid lifecycle viewport "${value}". Use WIDTHxHEIGHT.`);
  VIEWPORT = { width: Number(match[1]), height: Number(match[2]) };
  assert(VIEWPORT.width >= 640 && VIEWPORT.height >= 360,
    `Lifecycle viewport ${raw} is too small for the checkout route.`);
  return `${VIEWPORT.width}x${VIEWPORT.height}`;
}

function configureCycles(value) {
  const parsed = Number(value);
  const cycles = Number.isFinite(parsed) ? Math.floor(parsed) : DEFAULT_CYCLES;
  assert(Number.isInteger(cycles) && cycles >= 2,
    `REGISTER_QA_CYCLES must be an integer of at least 2, got ${value}.`);
  return cycles;
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '');
}

function configureCount(name, value, fallback) {
  const raw = firstDefined(value, fallback);
  const parsed = Number(raw);
  assert(Number.isFinite(parsed) && Number.isInteger(parsed) && parsed >= 0,
    `${name} must be a non-negative integer, got ${raw}.`);
  return parsed;
}

export function resolveLifecycleConfig(options = {}, env = process.env) {
  const requestedProfile = String(firstDefined(options.profile, env.REGISTER_QA_PROFILE) || '')
    .trim().toLowerCase();
  assert(!requestedProfile || ['master', 'smoke', 'legacy'].includes(requestedProfile),
    `REGISTER_QA_PROFILE must be master, smoke, or legacy; got ${requestedProfile}.`);
  const legacyCycleValue = firstDefined(options.cycles, env.REGISTER_QA_CYCLES);
  const hasIndividualOverride = COUNT_OPTIONS.some(([key, envName]) => (
    firstDefined(options.counts?.[key], options[key], env[envName]) !== undefined
  ));
  const useLegacy = requestedProfile === 'legacy'
    || (!requestedProfile && legacyCycleValue !== undefined && !hasIndividualOverride);

  if (useLegacy) {
    const cycles = configureCycles(legacyCycleValue);
    const cardTransactions = Math.ceil(cycles / 2);
    const cashTransactions = Math.floor(cycles / 2);
    return {
      profile: 'legacy',
      legacyCycles: cycles,
      totalSales: cycles,
      counts: {
        enterExits: 0,
        cardTransactions,
        cashTransactions,
        preAuthCancellations: 0,
        declineRecoveries: 0,
        drawerOpenCloses: cashTransactions,
        customerSpawnRemovalsMinimum: cycles,
      },
    };
  }

  const profile = requestedProfile || 'master';
  const base = PROFILE_COUNTS[profile];
  assert(base, `Lifecycle profile ${profile} does not define cardinalities.`);
  const counts = {};
  for (const [key, envName] of COUNT_OPTIONS) {
    counts[key] = configureCount(envName,
      firstDefined(options.counts?.[key], options[key], env[envName]), base[key]);
  }
  const totalSales = counts.cardTransactions + counts.cashTransactions;
  assert(totalSales >= 2,
    `Lifecycle stress needs at least two completed transactions, got ${totalSales}.`);
  assert(counts.preAuthCancellations <= counts.cardTransactions,
    `Pre-authorization cancellations (${counts.preAuthCancellations}) cannot exceed card transactions (${counts.cardTransactions}).`);
  assert(counts.declineRecoveries <= counts.cardTransactions,
    `Decline recoveries (${counts.declineRecoveries}) cannot exceed card transactions (${counts.cardTransactions}).`);
  assert(counts.drawerOpenCloses === counts.cashTransactions,
    `Every normal-control cash transaction opens and closes the drawer once; drawerOpenCloses (${counts.drawerOpenCloses}) must equal cashTransactions (${counts.cashTransactions}).`);
  assert(counts.customerSpawnRemovalsMinimum <= totalSales,
    `Customer lifecycle minimum (${counts.customerSpawnRemovalsMinimum}) exceeds the ${totalSales} transaction customers this profile creates.`);
  return { profile, legacyCycles: null, totalSales, counts };
}

function buildSalesPlan(counts) {
  const plan = [];
  let cardRemaining = counts.cardTransactions;
  let cashRemaining = counts.cashTransactions;
  let cardOrdinal = 0;
  let cashOrdinal = 0;
  let preferred = 'card';
  while (cardRemaining > 0 || cashRemaining > 0) {
    const method = preferred === 'card'
      ? (cardRemaining > 0 ? 'card' : 'cash')
      : (cashRemaining > 0 ? 'cash' : 'card');
    if (method === 'card') {
      cardRemaining -= 1;
      cardOrdinal += 1;
      plan.push({
        method,
        methodOrdinal: cardOrdinal,
        cancelBeforeAuthorization: cardOrdinal <= counts.preAuthCancellations,
        declineThenRecover: cardOrdinal <= counts.declineRecoveries,
      });
    } else {
      cashRemaining -= 1;
      cashOrdinal += 1;
      plan.push({ method, methodOrdinal: cashOrdinal });
    }
    preferred = method === 'card' ? 'cash' : 'card';
  }
  return plan.map((entry, index) => ({ ...entry, cycle: index + 1 }));
}

function createObservedCounts() {
  return {
    frontDeskEntries: 0,
    frontDeskExits: 0,
    cardTransactions: 0,
    cashTransactions: 0,
    preAuthCancellations: 0,
    declineRecoveries: 0,
    drawerOpens: 0,
    drawerCloses: 0,
    customerSpawns: 0,
    customerRemovals: 0,
  };
}

export function buildCardinalityReport(requested, observed) {
  const exact = (requestedCount, completed, details = {}) => ({
    comparison: 'exact',
    requested: requestedCount,
    completed,
    ok: completed === requestedCount,
    ...details,
  });
  const atLeast = (requestedMinimum, completed, details = {}) => ({
    comparison: 'at-least',
    requestedMinimum,
    completed,
    ok: completed >= requestedMinimum,
    ...details,
  });
  const frontDesk = exact(requested.enterExits,
    Math.min(observed.frontDeskEntries, observed.frontDeskExits), {
        observedEntries: observed.frontDeskEntries,
        observedExits: observed.frontDeskExits,
      });
  frontDesk.ok = observed.frontDeskEntries === requested.enterExits
    && observed.frontDeskExits === requested.enterExits;
  const drawer = exact(requested.drawerOpenCloses,
    Math.min(observed.drawerOpens, observed.drawerCloses), {
      observedOpens: observed.drawerOpens,
      observedCloses: observed.drawerCloses,
    });
  drawer.ok = observed.drawerOpens === requested.drawerOpenCloses
    && observed.drawerCloses === requested.drawerOpenCloses;
  const customers = atLeast(requested.customerSpawnRemovalsMinimum,
    Math.min(observed.customerSpawns, observed.customerRemovals), {
      observedSpawns: observed.customerSpawns,
      observedRemovals: observed.customerRemovals,
      rationale: 'Each completed sale owns one fresh customer, so the full 100-card + 100-cash master workload honestly observes 200 pairs while gating the brief minimum of 100.',
    });
  customers.ok = observed.customerSpawns >= requested.customerSpawnRemovalsMinimum
    && observed.customerRemovals >= requested.customerSpawnRemovalsMinimum;
  return {
    frontDeskEnterExits: frontDesk,
    cardTransactions: exact(requested.cardTransactions, observed.cardTransactions),
    cashTransactions: exact(requested.cashTransactions, observed.cashTransactions),
    preAuthorizationXCancellations: exact(requested.preAuthCancellations,
      observed.preAuthCancellations),
    declinesWithRecovery: exact(requested.declineRecoveries, observed.declineRecoveries),
    drawerOpenCloses: drawer,
    customerSpawnsRemovals: customers,
  };
}

function round2(value) {
  return Math.round(Number(value) * 100) / 100;
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function overlayMetric(finalSample, summaries, pathSpec) {
  const summary = summaries?.[pathSpec] || null;
  return {
    path: pathSpec,
    final: finiteNumber(getMetric(finalSample, pathSpec)),
    stableDelta: finiteNumber(summary?.delta),
    stableRange: finiteNumber(summary?.range),
  };
}

function overlayOperation(id, label, counter) {
  const comparison = counter?.comparison || 'exact';
  return {
    id,
    label,
    comparison,
    requested: finiteNumber(comparison === 'at-least'
      ? counter?.requestedMinimum
      : counter?.requested),
    completed: finiteNumber(counter?.completed),
    observedEntries: finiteNumber(counter?.observedEntries),
    observedExits: finiteNumber(counter?.observedExits),
    observedOpens: finiteNumber(counter?.observedOpens),
    observedCloses: finiteNumber(counter?.observedCloses),
    observedSpawns: finiteNumber(counter?.observedSpawns),
    observedRemovals: finiteNumber(counter?.observedRemovals),
    ok: !!counter?.ok,
  };
}

export function buildLongSessionResourceOverlayModel(result) {
  const finalSample = result?.finalSample || result?.lastSample || {};
  const summaries = result?.gates?.summaries || {};
  const runtimeSummaries = result?.gates?.runtimeSummaries || {};
  const cardinality = result?.cardinality || {};
  const checks = Array.isArray(result?.gates?.checks) ? result.gates.checks : [];
  const failedChecks = checks.filter((entry) => !entry.ok);
  const stableWindow = result?.protocol?.stableWindow || {};
  const requestedCycles = finiteNumber(result?.protocol?.requestedCycles);
  const completedCycles = finiteNumber(result?.protocol?.completedCycles
    ?? result?.cycles?.length);
  const salesCounter = {
    comparison: 'exact',
    requested: requestedCycles,
    completed: completedCycles,
    ok: requestedCycles !== null && completedCycles === requestedCycles,
  };

  return {
    schemaVersion: 1,
    captureNumber: 39,
    title: 'Long-session resource counts',
    ok: !!result?.ok,
    result: result?.ok ? 'PASS' : 'FAIL',
    profile: result?.protocol?.profile || 'unknown',
    viewport: result?.protocol?.viewport || 'unknown',
    stableWindow: {
      firstCycle: finiteNumber(stableWindow.firstCycle),
      lastCycle: finiteNumber(stableWindow.lastCycle),
      sampleCount: finiteNumber(stableWindow.sampleCount),
    },
    exactOperations: [
      overlayOperation('completedSales', 'Completed sales', salesCounter),
      overlayOperation('cardTransactions', 'Card sales', cardinality.cardTransactions),
      overlayOperation('cashTransactions', 'Cash sales', cardinality.cashTransactions),
      overlayOperation('frontDeskEnterExits', 'Desk enter / exit',
        cardinality.frontDeskEnterExits),
      overlayOperation('preAuthorizationXCancellations', 'Pre-auth X cancellations',
        cardinality.preAuthorizationXCancellations),
      overlayOperation('declinesWithRecovery', 'Decline recoveries',
        cardinality.declinesWithRecovery),
      overlayOperation('drawerOpenCloses', 'Drawer open / close',
        cardinality.drawerOpenCloses),
      overlayOperation('customerSpawnsRemovals', 'Customer spawn / removal',
        cardinality.customerSpawnsRemovals),
    ],
    exactOnce: {
      units: finiteNumber(finalSample?.state?.units) !== null
        && finiteNumber(result?.fixture?.units) !== null
        ? Number(finalSample.state.units) - Number(result.fixture.units)
        : null,
      tickets: finiteNumber(result?.cycles?.length),
      heldInventoryFinal: finiteNumber(finalSample?.state?.held),
    },
    resources: {
      sceneNodes: overlayMetric(finalSample, summaries, 'scene.nodes'),
      geometries: {
        scene: overlayMetric(finalSample, summaries, 'scene.geometries'),
        renderer: overlayMetric(finalSample, summaries, 'renderer.memory.geometries'),
      },
      materials: overlayMetric(finalSample, summaries, 'scene.materials'),
      textures: {
        scene: overlayMetric(finalSample, summaries, 'scene.textures'),
        renderer: overlayMetric(finalSample, summaries, 'renderer.memory.textures'),
      },
      listeners: {
        net: overlayMetric(finalSample, summaries, 'listeners.net'),
        cdp: overlayMetric(finalSample, summaries, 'dom.jsEventListeners'),
      },
      mixers: overlayMetric(finalSample, runtimeSummaries, 'animationMixers.count'),
      timers: {
        timeouts: overlayMetric(finalSample, runtimeSummaries, 'timers.activeTimeouts'),
        intervals: overlayMetric(finalSample, runtimeSummaries, 'timers.activeIntervals'),
        animationFrames: overlayMetric(finalSample, runtimeSummaries,
          'timers.activeAnimationFrames'),
      },
      dom: {
        live: overlayMetric(finalSample, summaries, 'dom.liveNodes'),
        cdp: overlayMetric(finalSample, summaries, 'dom.nodes'),
        detachedEstimate: overlayMetric(finalSample, summaries, 'dom.detachedNodesEstimate'),
      },
      heap: {
        finalBytes: finiteNumber(finalSample?.heap?.runtimeUsedBytes),
        stableDeltaBytes: finiteNumber(result?.gates?.heap?.growthBytes),
        slopeBytesPerCycle: finiteNumber(result?.gates?.heap?.slopeBytesPerCycle),
      },
      audio: {
        contexts: overlayMetric(finalSample, runtimeSummaries, 'audio.openContexts'),
        activeSources: overlayMetric(finalSample, runtimeSummaries, 'audio.activeSources'),
      },
    },
    gates: {
      passed: checks.length - failedChecks.length,
      total: checks.length,
      failed: failedChecks.length,
      stabilityEnforced: result?.gates?.stabilityEnforced !== false,
    },
    provenance: {
      kind: 'qa-only DOM overlay',
      injectedBy: 'tools/qa/simplified-register-lifecycle-stress.mjs',
      overlayElementId: 'register-lifecycle-metrics',
      presentationOnly: true,
      gameplaySourceModified: false,
      rawJsonAuthoritative: true,
      authoritativeRawJson: path.basename(result?.evidence?.json || 'lifecycle-result.json'),
      authoritativeResourceDetails: path.basename(
        result?.evidence?.resourceDetails || 'lifecycle-resource-details.json',
      ),
    },
  };
}

function escapeOverlayHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function overlayInteger(value) {
  const number = finiteNumber(value);
  return number === null ? 'n/a' : Math.round(number).toLocaleString('en-US');
}

function overlaySigned(value, formatter = overlayInteger) {
  const number = finiteNumber(value);
  if (number === null) return 'n/a';
  return `${number > 0 ? '+' : ''}${formatter(number)}`;
}

function overlayMiB(value) {
  const number = finiteNumber(value);
  return number === null ? 'n/a' : `${(number / (1024 * 1024)).toFixed(2)} MiB`;
}

function overlayMetricText(metric, formatter = overlayInteger) {
  return `${formatter(metric?.final)} | delta ${overlaySigned(metric?.stableDelta, formatter)} | range ${formatter(metric?.stableRange)}`;
}

function overlayOperationText(operation) {
  const target = operation.comparison === 'at-least'
    ? `target >= ${overlayInteger(operation.requested)}`
    : `target ${overlayInteger(operation.requested)}`;
  if (operation.observedEntries !== null || operation.observedExits !== null) {
    return `${overlayInteger(operation.observedEntries)} / ${overlayInteger(operation.observedExits)} | ${target}`;
  }
  if (operation.observedOpens !== null || operation.observedCloses !== null) {
    return `${overlayInteger(operation.observedOpens)} / ${overlayInteger(operation.observedCloses)} | ${target}`;
  }
  if (operation.observedSpawns !== null || operation.observedRemovals !== null) {
    return `${overlayInteger(operation.observedSpawns)} / ${overlayInteger(operation.observedRemovals)} | ${target}`;
  }
  return `${overlayInteger(operation.completed)} / ${overlayInteger(operation.requested)}`;
}

export function renderLongSessionResourceOverlayHtml(model) {
  const row = (label, value, ok = null) => {
    const color = ok === false ? '#ff9b8f' : '#d9bd78';
    return `<div style="display:grid;grid-template-columns:minmax(128px,.9fr) minmax(0,1.45fr);gap:10px;border-top:1px solid rgba(244,237,219,.14);padding:4px 0"><span>${escapeOverlayHtml(label)}</span><strong style="color:${color};text-align:right;white-space:nowrap">${escapeOverlayHtml(value)}</strong></div>`;
  };
  const operationRows = model.exactOperations
    .map((operation) => row(operation.label, overlayOperationText(operation), operation.ok))
    .join('');
  const resources = model.resources;
  const resourceRows = [
    row('Scene nodes', overlayMetricText(resources.sceneNodes)),
    row('Geometries scene / GPU', `${overlayMetricText(resources.geometries.scene)} || ${overlayMetricText(resources.geometries.renderer)}`),
    row('Materials', overlayMetricText(resources.materials)),
    row('Textures scene / GPU', `${overlayMetricText(resources.textures.scene)} || ${overlayMetricText(resources.textures.renderer)}`),
    row('Listeners net / CDP', `${overlayMetricText(resources.listeners.net)} || ${overlayMetricText(resources.listeners.cdp)}`),
    row('AnimationMixers', overlayMetricText(resources.mixers)),
    row('Timers timeout / interval / rAF', [
      overlayMetricText(resources.timers.timeouts),
      overlayMetricText(resources.timers.intervals),
      overlayMetricText(resources.timers.animationFrames),
    ].join(' || ')),
    row('DOM live / CDP / detached', [
      overlayMetricText(resources.dom.live),
      overlayMetricText(resources.dom.cdp),
      overlayMetricText(resources.dom.detachedEstimate),
    ].join(' || ')),
    row('Forced-GC heap', `${overlayMiB(resources.heap.finalBytes)} | delta ${overlaySigned(resources.heap.stableDeltaBytes, overlayMiB)} | slope ${overlaySigned(resources.heap.slopeBytesPerCycle, overlayMiB)}/cycle`),
    row('Audio contexts / sources', `${overlayMetricText(resources.audio.contexts)} || ${overlayMetricText(resources.audio.activeSources)}`),
  ].join('');
  const stable = model.stableWindow;
  const gateValue = `${model.gates.passed} / ${model.gates.total} passed`;
  return `
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:18px;margin-bottom:8px">
      <div>
        <div style="font:800 22px/1.05 Georgia,serif;color:#fff">Capture #39 | ${escapeOverlayHtml(model.title)}</div>
        <div style="color:#a9c5ae;margin-top:4px">${escapeOverlayHtml(model.profile)} | ${escapeOverlayHtml(model.viewport)} | stable cycles ${escapeOverlayHtml(overlayInteger(stable.firstCycle))}-${escapeOverlayHtml(overlayInteger(stable.lastCycle))} (${escapeOverlayHtml(overlayInteger(stable.sampleCount))} samples)</div>
      </div>
      <div style="border:1px solid ${model.ok ? '#79c88a' : '#ff9b8f'};border-radius:999px;padding:5px 12px;color:${model.ok ? '#a9e5b5' : '#ffb2a9'};font-weight:800">${escapeOverlayHtml(model.result)}</div>
    </div>
    <div style="display:grid;grid-template-columns:minmax(275px,.85fr) minmax(470px,1.45fr);gap:14px">
      <div>
        <div style="color:#fff;font-weight:800;margin-bottom:3px">Exact completed operations</div>
        ${operationRows}
        ${row('Exact-once units / tickets', `${overlayInteger(model.exactOnce.units)} / ${overlayInteger(model.exactOnce.tickets)}`)}
        ${row('Held inventory final', overlayInteger(model.exactOnce.heldInventoryFinal), model.exactOnce.heldInventoryFinal === 0)}
        ${row('All gates', gateValue, model.gates.failed === 0)}
      </div>
      <div>
        <div style="color:#fff;font-weight:800;margin-bottom:3px">Final count | stable delta | stable range</div>
        ${resourceRows}
      </div>
    </div>
    <div style="margin-top:8px;padding-top:7px;border-top:1px solid rgba(244,237,219,.22);color:#a9c5ae;font-size:11px">
      ${escapeOverlayHtml(model.provenance.kind)} | ${escapeOverlayHtml(model.provenance.authoritativeRawJson)} is authoritative | resource detail: ${escapeOverlayHtml(model.provenance.authoritativeResourceDetails)} | gameplay source unchanged
    </div>
  `;
}

async function installEarlyLifecycleProbe(page) {
  await page.addInitScript(() => {
    if (window.__registerEarlyLifecycleProbe) return;
    const timerStats = {
      timeoutsScheduled: 0,
      timeoutsFired: 0,
      timeoutsCleared: 0,
      intervalsScheduled: 0,
      intervalTicks: 0,
      intervalsCleared: 0,
      animationFramesScheduled: 0,
      animationFramesFired: 0,
      animationFramesCancelled: 0,
    };
    const activeTimeouts = new Set();
    const activeIntervals = new Set();
    const activeAnimationFrames = new Set();
    const originalSetTimeout = window.setTimeout.bind(window);
    const originalClearTimeout = window.clearTimeout.bind(window);
    const originalSetInterval = window.setInterval.bind(window);
    const originalClearInterval = window.clearInterval.bind(window);
    const originalRequestAnimationFrame = window.requestAnimationFrame.bind(window);
    const originalCancelAnimationFrame = window.cancelAnimationFrame.bind(window);
    const originalAddEventListener = EventTarget.prototype.addEventListener;

    window.setTimeout = (handler, delay, ...args) => {
      let id = null;
      const wrapped = (...callbackArgs) => {
        activeTimeouts.delete(id);
        timerStats.timeoutsFired += 1;
        if (typeof handler === 'function') return handler.apply(window, callbackArgs);
        return undefined;
      };
      id = originalSetTimeout(wrapped, delay, ...args);
      activeTimeouts.add(id);
      timerStats.timeoutsScheduled += 1;
      return id;
    };
    window.clearTimeout = (id) => {
      if (activeTimeouts.delete(id)) timerStats.timeoutsCleared += 1;
      return originalClearTimeout(id);
    };
    window.setInterval = (handler, delay, ...args) => {
      let id = null;
      const wrapped = (...callbackArgs) => {
        timerStats.intervalTicks += 1;
        if (typeof handler === 'function') return handler.apply(window, callbackArgs);
        return undefined;
      };
      id = originalSetInterval(wrapped, delay, ...args);
      activeIntervals.add(id);
      timerStats.intervalsScheduled += 1;
      return id;
    };
    window.clearInterval = (id) => {
      if (activeIntervals.delete(id)) timerStats.intervalsCleared += 1;
      return originalClearInterval(id);
    };
    window.requestAnimationFrame = (callback) => {
      let id = null;
      const wrapped = (timestamp) => {
        activeAnimationFrames.delete(id);
        timerStats.animationFramesFired += 1;
        return callback(timestamp);
      };
      id = originalRequestAnimationFrame(wrapped);
      activeAnimationFrames.add(id);
      timerStats.animationFramesScheduled += 1;
      return id;
    };
    window.cancelAnimationFrame = (id) => {
      if (activeAnimationFrames.delete(id)) timerStats.animationFramesCancelled += 1;
      return originalCancelAnimationFrame(id);
    };

    const audio = {
      available: false,
      contextsCreated: 0,
      contextsClosed: 0,
      sourcesCreated: 0,
      sourcesStarted: 0,
      sourcesStopped: 0,
      sourcesEnded: 0,
      activeSources: 0,
      createdByType: Object.create(null),
    };
    const contexts = [];
    const instrumentSource = (source, type) => {
      if (!source || source.__registerLifecycleInstrumented) return source;
      Object.defineProperty(source, '__registerLifecycleInstrumented', { value: true });
      audio.sourcesCreated += 1;
      audio.createdByType[type] = (audio.createdByType[type] || 0) + 1;
      let active = false;
      const originalStart = source.start?.bind(source);
      const originalStop = source.stop?.bind(source);
      if (originalStart) {
        source.start = (...args) => {
          if (!active) {
            active = true;
            audio.activeSources += 1;
            audio.sourcesStarted += 1;
          }
          return originalStart(...args);
        };
      }
      if (originalStop) {
        source.stop = (...args) => {
          audio.sourcesStopped += 1;
          return originalStop(...args);
        };
      }
      originalAddEventListener.call(source, 'ended', () => {
        audio.sourcesEnded += 1;
        if (active) {
          active = false;
          audio.activeSources = Math.max(0, audio.activeSources - 1);
        }
      }, { once: true });
      return source;
    };
    const instrumentContext = (context) => {
      audio.contextsCreated += 1;
      contexts.push(context);
      for (const factory of ['createBufferSource', 'createOscillator', 'createConstantSource']) {
        if (typeof context[factory] !== 'function') continue;
        const original = context[factory].bind(context);
        context[factory] = (...args) => instrumentSource(original(...args), factory);
      }
      if (typeof context.close === 'function') {
        const originalClose = context.close.bind(context);
        context.close = (...args) => {
          audio.contextsClosed += 1;
          return originalClose(...args);
        };
      }
      return context;
    };
    const wrapAudioContext = (key) => {
      const Original = window[key];
      if (typeof Original !== 'function') return;
      audio.available = true;
      function LifecycleAudioContext(...args) {
        return instrumentContext(Reflect.construct(Original, args, Original));
      }
      LifecycleAudioContext.prototype = Original.prototype;
      Object.setPrototypeOf(LifecycleAudioContext, Original);
      window[key] = LifecycleAudioContext;
    };
    wrapAudioContext('AudioContext');
    if (window.webkitAudioContext !== window.AudioContext) wrapAudioContext('webkitAudioContext');

    window.__registerEarlyLifecycleProbe = {
      installedAtMs: performance.now(),
      read() {
        return {
          timers: {
            ...timerStats,
            activeTimeouts: activeTimeouts.size,
            activeIntervals: activeIntervals.size,
            activeAnimationFrames: activeAnimationFrames.size,
            scope: 'window timer/rAF calls observed from document initialization',
          },
          audio: {
            ...audio,
            createdByType: { ...audio.createdByType },
            contextStates: contexts.map((context) => context.state || 'unknown'),
            openContexts: contexts.filter((context) => context.state !== 'closed').length,
            activeSourcesMeasurement: 'started AudioScheduledSourceNodes minus observed ended events',
          },
        };
      },
    };
  });
}

async function boot(page) {
  await page.setViewportSize(VIEWPORT);
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const { clickThroughMenu } = await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`);
  await clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 50000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    if (!veil) return true;
    const style = getComputedStyle(veil);
    return style.display === 'none' || Number.parseFloat(style.opacity || '1') <= 0.01;
  }, null, { timeout: 50000 });
  await page.waitForTimeout(1200);
  await page.mouse.click(VIEWPORT.width / 2, VIEWPORT.height / 2);
  await page.waitForTimeout(150);
}

async function setupFixture(page, cycles) {
  return page.evaluate(async ({ skuIds, count }) => {
    const app = window.__fw;
    const { REGISTER } = await import(new URL('src/data/shopLayout.js', document.baseURI).href);
    const clubhouse = app.scene3d.clubhouse();
    clubhouse.setOrganicWalkins(false);
    clubhouse.clearWalkins();
    for (const skuId of skuIds) {
      const inventory = app.state.shop.inventory[skuId];
      inventory.shelf = Math.max(inventory.shelf, count + 12);
    }
    app.state.shop.markup.accessories = 1.15;
    app.state.shop.markup.apparel = 1.15;
    app.speedIdx = 0;
    app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440 + 14 * 60;
    app.state.weather.today = {
      tempHiF: 72,
      tempLoF: 54,
      rainIn: 0,
      humidity: 0.48,
      windMph: 5,
    };
    app.scene3d.applyTimeWeather(14 * 60, app.state.weather);
    clubhouse.rebuildStock();
    const walk = app.scene3d.walk.state;
    const offset = clubhouse.interior.position;
    walk.x = REGISTER.stand.x + offset.x;
    walk.z = REGISTER.stand.z + offset.z;
    const dx = REGISTER.monitor.x - REGISTER.stand.x;
    const dz = REGISTER.monitor.z - REGISTER.stand.z;
    const horizontal = Math.hypot(dx, dz) || 0.001;
    walk.yaw = Math.atan2(-dx / horizontal, -dz / horizontal);
    walk.pitch = Math.atan2(1.185 - 1.62, horizontal);
    const shop = app.state.shop;
    return {
      units: shop.salesLive?.units || 0,
      revenue: shop.salesLive?.revenue || 0,
      history: (shop.transactionHistory || []).length,
      held: (shop.held || []).length,
      cash: app.state.cash,
      nextTransactionNo: Number(shop.nextTransactionNo || 1),
      shelf: Object.fromEntries(skuIds.map((skuId) => [skuId, shop.inventory[skuId].shelf])),
    };
  }, { skuIds: SKUS, count: cycles });
}

async function warmPostFixtureRendererResidency(page) {
  await enterFrontDesk(page);
  const warmup = await page.evaluate(async () => {
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    const register = clubhouse.register;
    const customerList = () => (typeof clubhouse.customers === 'function'
      ? clubhouse.customers()
      : clubhouse.customers || []);
    const read = () => ({
      rendererGeometries: app.scene3d.renderer.info.memory.geometries,
      rendererTextures: app.scene3d.renderer.info.memory.textures,
      registerActive: register.isActive(),
      transactionNumber: register.getTx?.()?.number ?? null,
      customerCount: customerList().length,
      queueCount: clubhouse.checkoutQueue?.().length ?? 0,
    });
    const before = read();
    if (typeof app.scene3d.prewarm !== 'function') {
      throw new Error('Post-fixture renderer prewarm is unavailable.');
    }
    const completed = await app.scene3d.prewarm();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return {
      kind: 'qa-only post-fixture renderer residency prewarm',
      completed,
      before,
      after: read(),
      measurementBoundary: 'One pre-measurement E/prewarm/Escape pair occurs before lifecycle baselines and is excluded from the exact measured operation counters.',
    };
  });
  assert(warmup.completed !== false, 'Post-fixture renderer prewarm did not complete.');
  assert(warmup.before.registerActive && warmup.after.registerActive,
    'Post-fixture renderer prewarm did not preserve the active front desk.');
  assert(warmup.before.transactionNumber == null && warmup.after.transactionNumber == null
      && warmup.before.customerCount === 0 && warmup.after.customerCount === 0
      && warmup.before.queueCount === 0 && warmup.after.queueCount === 0,
  'Post-fixture renderer prewarm crossed a transaction/customer lifecycle boundary.');
  await leaveFrontDesk(page);
  warmup.afterExit = await page.evaluate(() => {
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    const register = clubhouse.register;
    const customers = typeof clubhouse.customers === 'function'
      ? clubhouse.customers()
      : clubhouse.customers || [];
    return {
      registerActive: register.isActive(),
      transactionNumber: register.getTx?.()?.number ?? null,
      customerCount: customers.length,
      queueCount: clubhouse.checkoutQueue?.().length ?? 0,
      rendererGeometries: app.scene3d.renderer.info.memory.geometries,
      rendererTextures: app.scene3d.renderer.info.memory.textures,
    };
  });
  assert(!warmup.afterExit.registerActive && warmup.afterExit.transactionNumber == null
      && warmup.afterExit.customerCount === 0 && warmup.afterExit.queueCount === 0,
  'Post-fixture renderer prewarm did not restore the empty inactive boundary.');
  return warmup;
}

async function installListenerProbe(page) {
  await page.evaluate(() => {
    if (window.__registerLifecycleProbe) return;
    const originalAdd = EventTarget.prototype.addEventListener;
    const originalRemove = EventTarget.prototype.removeEventListener;
    const counters = Object.create(null);
    const targetName = (target) => {
      if (target === window) return 'window';
      if (target === document) return 'document';
      if (target === document.querySelector('canvas')) return 'game-canvas';
      if (target instanceof Element) return target.tagName.toLowerCase();
      return target?.constructor?.name || 'other';
    };
    const bump = (target, type, delta) => {
      const key = `${targetName(target)}:${String(type)}`;
      counters[key] = (counters[key] || 0) + delta;
    };
    EventTarget.prototype.addEventListener = function registerLifecycleAdd(type, listener, options) {
      bump(this, type, 1);
      return originalAdd.call(this, type, listener, options);
    };
    EventTarget.prototype.removeEventListener = function registerLifecycleRemove(type, listener, options) {
      bump(this, type, -1);
      return originalRemove.call(this, type, listener, options);
    };
    window.__registerLifecycleProbe = {
      counters,
      installedAtMs: performance.now(),
    };
  });
}

async function installResourceLifecycleProbe(page) {
  await page.evaluate(async () => {
    if (window.__registerResourceLifecycleProbe) return;
    const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
    const resourceKinds = ['geometry', 'material', 'texture'];
    const createSampler = (limit) => ({
      limit,
      count: 0,
      head: [],
      tail: [],
      tailIndex: 0,
    });
    const pushSample = (sampler, value) => {
      sampler.count += 1;
      const headLimit = Math.ceil(sampler.limit / 2);
      const tailLimit = Math.floor(sampler.limit / 2);
      if (sampler.head.length < headLimit) {
        sampler.head.push(value);
        return;
      }
      if (sampler.tail.length < tailLimit) {
        sampler.tail.push(value);
        return;
      }
      if (tailLimit > 0) {
        sampler.tail[sampler.tailIndex] = value;
        sampler.tailIndex = (sampler.tailIndex + 1) % tailLimit;
      }
    };
    const sampleValues = (sampler) => {
      if (!sampler) return [];
      if (!sampler.tail.length || sampler.count <= sampler.limit || sampler.tailIndex === 0) {
        return [...sampler.head, ...sampler.tail];
      }
      return [
        ...sampler.head,
        ...sampler.tail.slice(sampler.tailIndex),
        ...sampler.tail.slice(0, sampler.tailIndex),
      ];
    };
    const addLimited = (array, value, limit = 24) => {
      if (value != null && value !== '' && !array.includes(value) && array.length < limit) {
        array.push(value);
      }
    };
    const probe = {
      current: { scenario: 'setup', iteration: 0, phase: 'probe-install' },
      resources: {
        geometry: Object.create(null),
        material: Object.create(null),
        texture: Object.create(null),
      },
      resourceStates: {
        geometry: new WeakMap(),
        material: new WeakMap(),
        texture: new WeakMap(),
      },
      counters: Object.fromEntries(resourceKinds.map((kind) => [kind, {
        observedCount: 0,
        disposedCount: 0,
        disposeCallCount: 0,
        disposalEventCount: 0,
        cycleResourceCount: 0,
      }])),
      cycleResourceSamples: Object.fromEntries(
        resourceKinds.map((kind) => [kind, createSampler(2000)]),
      ),
      disposalEventSamples: Object.fromEntries(
        resourceKinds.map((kind) => [kind, createSampler(2000)]),
      ),
      ephemeralUndisposed: Object.fromEntries(resourceKinds.map((kind) => [kind, {
        count: 0,
        groups: new Map(),
      }])),
      phaseMarks: [],
      lastLive: {
        geometry: new Set(),
        material: new Set(),
        texture: new Set(),
      },
      animationMixers: new WeakSet(),
      animationMixerCount: 0,
      animationMixerUpdateCalls: 0,
    };
    probe.addLimited = addLimited;
    probe.pushSample = pushSample;
    probe.sampleValues = sampleValues;
    probe.ensureState = (kind, resource) => {
      let state = probe.resourceStates[kind].get(resource);
      if (state) return state;
      const firstSeen = {
        scenario: probe.current.scenario,
        iteration: probe.current.iteration,
        phase: probe.current.phase,
      };
      const cycleObserved = Number(probe.current.iteration) > 0;
      state = {
        observed: true,
        disposed: false,
        disposeCalls: 0,
        disposalEventCount: 0,
        cycleObserved,
        cycleSampled: false,
        firstSeen,
        iterationCount: 0,
        lastIterationKey: null,
        iterationSample: null,
        ephemeralCounted: false,
        ephemeralSignature: null,
      };
      probe.resourceStates[kind].set(resource, state);
      probe.counters[kind].observedCount += 1;
      if (cycleObserved) probe.counters[kind].cycleResourceCount += 1;
      return state;
    };
    probe.recordIteration = (state) => {
      if (!state.cycleObserved) return;
      const iterationKey = `${probe.current.scenario}:${probe.current.iteration}`;
      if (state.lastIterationKey === iterationKey) return;
      state.lastIterationKey = iterationKey;
      state.iterationCount += 1;
      if (!state.iterationSample) state.iterationSample = createSampler(24);
      pushSample(state.iterationSample, iterationKey);
    };
    probe.recordCycleResource = (kind, state) => {
      if (Number(probe.current.iteration) <= 0 || state.cycleObserved) return;
      state.cycleObserved = true;
      probe.counters[kind].cycleResourceCount += 1;
    };
    probe.newEntry = (resource, kind, state) => ({
      resource,
      state,
      uuid: resource.uuid,
      resourceKind: kind,
      type: resource.type || resource.constructor?.name || kind,
      resourceNames: resource.name ? [resource.name] : [],
      names: [],
      kinds: [],
      from: [],
      ancestry: [],
      firstSeen: state.firstSeen,
      lastSeen: null,
      disposeEvents: createSampler(12),
    });
    probe.ensureEntry = (kind, resource, state) => {
      const entries = probe.resources[kind];
      let entry = entries[resource.uuid];
      if (!entry || entry.resource !== resource) {
        entry = probe.newEntry(resource, kind, state);
        entries[resource.uuid] = entry;
      }
      return entry;
    };
    probe.focusedEntry = (entry, liveAtEnd = false) => ({
      uuid: entry.uuid,
      resourceKind: entry.resourceKind,
      type: entry.type,
      resourceNames: entry.resourceNames.slice(0, 8),
      names: entry.names.slice(0, 8),
      kinds: entry.kinds.slice(0, 8),
      from: entry.from.slice(0, 8),
      ancestry: entry.ancestry.slice(0, 8),
      firstSeen: entry.firstSeen,
      lastSeen: entry.lastSeen,
      liveAtEnd,
      cycleObserved: entry.state.cycleObserved,
      iterationCount: entry.state.iterationCount,
      iterations: sampleValues(entry.state.iterationSample),
      cycles: sampleValues(entry.state.iterationSample),
      disposeCalls: entry.state.disposeCalls,
      disposeEventCount: entry.state.disposalEventCount,
      disposeEvents: sampleValues(entry.disposeEvents),
    });
    probe.clearEphemeral = (kind, state, uuid) => {
      if (!state.ephemeralCounted) return;
      const ephemeral = probe.ephemeralUndisposed[kind];
      ephemeral.count = Math.max(0, ephemeral.count - 1);
      const group = ephemeral.groups.get(state.ephemeralSignature);
      if (group) {
        group.count = Math.max(0, group.count - 1);
        group.uuids = group.uuids.filter((entryUuid) => entryUuid !== uuid);
        if (group.count === 0) ephemeral.groups.delete(state.ephemeralSignature);
      }
      state.ephemeralCounted = false;
      state.ephemeralSignature = null;
    };
    probe.markEphemeral = (kind, entry) => {
      const state = entry.state;
      if (!state.cycleObserved || state.disposed || state.ephemeralCounted) return;
      const iterations = sampleValues(state.iterationSample);
      const signature = [
        entry.type,
        entry.resourceNames.join('|') || '(unnamed-resource)',
        entry.names.join('|') || '(unnamed-object)',
        entry.kinds.join('|') || '(no-kind)',
        entry.from.join('|') || '(no-from)',
        entry.ancestry[0] || '(no-ancestry)',
      ].join(' :: ');
      const ephemeral = probe.ephemeralUndisposed[kind];
      const group = ephemeral.groups.get(signature) || {
        signature,
        count: 0,
        uuids: [],
        iterations: [],
        firstSeenPhases: [],
      };
      group.count += 1;
      addLimited(group.uuids, entry.uuid, 64);
      for (const iteration of iterations) addLimited(group.iterations, iteration, 64);
      addLimited(group.firstSeenPhases, entry.firstSeen?.phase, 24);
      ephemeral.groups.set(signature, group);
      ephemeral.count += 1;
      state.ephemeralCounted = true;
      state.ephemeralSignature = signature;
    };
    probe.finalizeEntry = (kind, entry, liveAtEnd, sampleLive = false) => {
      const state = entry.state;
      if (liveAtEnd) probe.clearEphemeral(kind, state, entry.uuid);
      else probe.markEphemeral(kind, entry);
      if (state.cycleObserved && !state.cycleSampled && (!liveAtEnd || sampleLive)) {
        pushSample(probe.cycleResourceSamples[kind], probe.focusedEntry(entry, liveAtEnd));
        state.cycleSampled = true;
      }
    };
    const instrumentDispose = (kind, prototype) => {
      const originalDispose = prototype?.dispose;
      if (typeof originalDispose !== 'function') return;
      prototype.dispose = function registerLifecycleResourceDispose() {
        const state = probe.ensureState(kind, this);
        const entry = probe.ensureEntry(kind, this, state);
        probe.clearEphemeral(kind, state, entry.uuid);
        probe.recordCycleResource(kind, state);
        probe.recordIteration(state);
        state.disposeCalls += 1;
        state.disposalEventCount += 1;
        probe.counters[kind].disposeCallCount += 1;
        probe.counters[kind].disposalEventCount += 1;
        if (!state.disposed) {
          state.disposed = true;
          probe.counters[kind].disposedCount += 1;
        }
        const event = {
          uuid: this.uuid,
          resourceKind: kind,
          type: entry.type,
          scenario: probe.current.scenario,
          iteration: probe.current.iteration,
          cycle: probe.current.iteration,
          phase: probe.current.phase,
          names: [...entry.names],
          kinds: [...entry.kinds],
          from: [...entry.from],
        };
        pushSample(entry.disposeEvents, event);
        pushSample(probe.disposalEventSamples[kind], event);
        return originalDispose.call(this);
      };
    };
    instrumentDispose('geometry', THREE.BufferGeometry.prototype);
    instrumentDispose('material', THREE.Material.prototype);
    instrumentDispose('texture', THREE.Texture.prototype);
    const observeMixer = function observeAnimationMixer(...args) {
      if (!probe.animationMixers.has(this)) {
        probe.animationMixers.add(this);
        probe.animationMixerCount += 1;
      }
      return args;
    };
    const originalMixerUpdate = THREE.AnimationMixer.prototype.update;
    THREE.AnimationMixer.prototype.update = function registerLifecycleMixerUpdate(...args) {
      observeMixer.call(this);
      probe.animationMixerUpdateCalls += 1;
      return originalMixerUpdate.apply(this, args);
    };
    const originalClipAction = THREE.AnimationMixer.prototype.clipAction;
    THREE.AnimationMixer.prototype.clipAction = function registerLifecycleMixerClipAction(...args) {
      observeMixer.call(this);
      return originalClipAction.apply(this, args);
    };
    window.__registerResourceLifecycleProbe = probe;
  });
}

async function markResourcePhase(page, iteration, phase, scenario = 'sale') {
  return page.evaluate(({ iterationNumber, phaseName, scenarioName }) => {
    const app = window.__fw;
    const scene = app.scene3d.scene;
    const probe = window.__registerResourceLifecycleProbe;
    if (!probe) throw new Error('Resource lifecycle probe is not installed.');
    probe.current = {
      scenario: scenarioName,
      iteration: iterationNumber,
      phase: phaseName,
    };
    const live = {
      geometry: new Set(),
      material: new Set(),
      texture: new Set(),
    };
    const observe = (kind, resource, object) => {
      if (!resource?.uuid) return;
      live[kind].add(resource.uuid);
      const state = probe.ensureState(kind, resource);
      const entry = probe.ensureEntry(kind, resource, state);
      probe.clearEphemeral(kind, state, resource.uuid);
      probe.recordIteration(state);
      entry.lastSeen = { scenario: scenarioName, iteration: iterationNumber, phase: phaseName };
      probe.addLimited(entry.resourceNames, resource.name || null, 24);
      probe.addLimited(entry.names, object.name || '(unnamed)', 24);
      probe.addLimited(entry.kinds, object.userData?.kind || null, 24);
      probe.addLimited(entry.from, object.userData?.from || null, 24);
      const ancestry = [];
      let cursor = object;
      for (let depth = 0; cursor && depth < 5; depth += 1, cursor = cursor.parent) {
        if (cursor.name) ancestry.push(cursor.name);
      }
      probe.addLimited(entry.ancestry, ancestry.join(' < '), 24);
    };
    scene.traverse((object) => {
      observe('geometry', object.geometry, object);
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (!material) continue;
        observe('material', material, object);
        for (const value of Object.values(material)) {
          if (value?.isTexture) observe('texture', value, object);
        }
        for (const uniform of Object.values(material.uniforms || {})) {
          if (uniform?.value?.isTexture) observe('texture', uniform.value, object);
        }
      }
    });
    const focused = (kind, uuid) => {
      const entry = probe.resources[kind][uuid];
      return entry ? probe.focusedEntry(entry, live[kind].has(uuid)) : {
        uuid,
        resourceKind: kind,
        type: null,
        resourceNames: [],
        names: [],
        kinds: [],
        from: [],
        ancestry: [],
        disposeCalls: 0,
      };
    };
    const sampledUuids = (uuids, limit = 12) => {
      if (uuids.length <= limit) return uuids;
      const head = Math.ceil(limit / 2);
      const tail = Math.floor(limit / 2);
      return [...uuids.slice(0, head), ...uuids.slice(-tail)];
    };
    const changes = {};
    for (const kind of ['geometry', 'material', 'texture']) {
      const initializingBaseline = probe.lastLive[kind].size === 0 && iterationNumber === 0;
      const added = initializingBaseline
        ? []
        : [...live[kind]].filter((uuid) => !probe.lastLive[kind].has(uuid));
      const removed = [...probe.lastLive[kind]].filter((uuid) => !live[kind].has(uuid));
      changes[kind] = {
        liveCount: live[kind].size,
        addedCount: added.length,
        removedCount: removed.length,
        added: sampledUuids(added).map((uuid) => focused(kind, uuid)),
        removed: sampledUuids(removed).map((uuid) => focused(kind, uuid)),
        disposalEventCount: probe.counters[kind].disposalEventCount,
      };
      for (const entry of Object.values(probe.resources[kind])) {
        const isLive = live[kind].has(entry.uuid);
        probe.finalizeEntry(kind, entry, isLive);
        if (!isLive) delete probe.resources[kind][entry.uuid];
      }
      probe.lastLive[kind] = live[kind];
    }
    const mark = {
      scenario: scenarioName,
      iteration: iterationNumber,
      cycle: iterationNumber,
      phase: phaseName,
      rendererGeometries: app.scene3d.renderer.info.memory.geometries,
      rendererTextures: app.scene3d.renderer.info.memory.textures,
      liveGeometryCount: live.geometry.size,
      liveMaterialCount: live.material.size,
      liveTextureCount: live.texture.size,
      changes,
      added: changes.geometry.added,
      removed: changes.geometry.removed,
      addedCount: changes.geometry.addedCount,
      removedCount: changes.geometry.removedCount,
      disposalEventCount: probe.counters.geometry.disposalEventCount,
      animationMixerCount: probe.animationMixerCount,
    };
    probe.phaseMarks.push(mark);
    return mark;
  }, { iterationNumber: iteration, phaseName: phase, scenarioName: scenario });
}

async function readResourceLifecycleProbe(page) {
  return page.evaluate(() => {
    const probe = window.__registerResourceLifecycleProbe;
    if (!probe) return null;
    // The live probe keeps exact counters in weak per-resource state and only
    // retains bounded forensic samples. Reading it must not resurrect the full
    // resource history or keep disposed Three.js objects alive.
    const sampled = (values, limit) => {
      const source = Array.isArray(values) ? values : [];
      if (source.length <= limit) return [...source];
      const head = Math.ceil(limit / 2);
      const tail = Math.floor(limit / 2);
      return [...source.slice(0, head), ...source.slice(-tail)];
    };
    const resources = {};
    for (const kind of ['geometry', 'material', 'texture']) {
      for (const entry of Object.values(probe.resources[kind])) {
        const liveAtEnd = probe.lastLive[kind].has(entry.uuid);
        probe.finalizeEntry(kind, entry, liveAtEnd, true);
        if (!liveAtEnd) delete probe.resources[kind][entry.uuid];
      }
      const counters = probe.counters[kind];
      const ephemeral = probe.ephemeralUndisposed[kind];
      const cycleResources = probe.sampleValues(probe.cycleResourceSamples[kind]);
      const disposalEvents = probe.sampleValues(probe.disposalEventSamples[kind]);
      resources[kind] = {
        observedCount: counters.observedCount,
        liveAtEndCount: probe.lastLive[kind].size,
        disposedCount: counters.disposedCount,
        disposeCallCount: counters.disposeCallCount,
        disposalEventCount: counters.disposalEventCount,
        ephemeralUndisposedCount: ephemeral.count,
        ephemeralUndisposedGroupCount: ephemeral.groups.size,
        ephemeralUndisposedGroups: [...ephemeral.groups.values()]
          .sort((left, right) => right.count - left.count).slice(0, 500),
        cycleResourceCount: counters.cycleResourceCount,
        cycleResources,
        disposalEvents,
      };
    }
    return {
      evidenceSampling: {
        bounded: true,
        phaseChangeResourcesPerKind: 12,
        iterationsPerResource: 24,
        disposeEventsPerResource: 12,
        cycleResourcesPerKind: 2000,
        disposalEventsPerKind: 2000,
        ephemeralUndisposedGroupsPerKind: 500,
        selection: 'streamed equal head/tail samples; weak resource state keeps aggregate counts exact',
      },
      phaseMarkCount: probe.phaseMarks.length,
      phaseMarks: [...probe.phaseMarks],
      resources,
      animationMixers: {
        count: probe.animationMixerCount,
        updateCalls: probe.animationMixerUpdateCalls,
        measurement: 'unique AnimationMixer instances observed through clipAction/update after probe installation; explicit 0 means none were observed',
      },
      disposalEvents: resources.geometry.disposalEvents,
      geometryCount: resources.geometry.observedCount,
      disposedGeometryCount: resources.geometry.disposedCount,
      ephemeralUndisposedCount: resources.geometry.ephemeralUndisposedCount,
      ephemeralUndisposedGroups: resources.geometry.ephemeralUndisposedGroups,
      cycleGeometryCount: resources.geometry.cycleResourceCount,
      cycleGeometries: sampled(resources.geometry.cycleResources, 200),
    };
  });
}

async function waitCamera(page, workspace, timeout = 12000) {
  await page.evaluate(() => { window.__registerLifecycleCameraProbe = null; });
  await page.waitForFunction((wanted) => {
    const app = window.__fw;
    const register = app.scene3d.clubhouse().register;
    if (register.workspace() !== wanted) return false;
    const camera = app.scene3d.camera;
    const next = {
      x: camera.position.x,
      y: camera.position.y,
      z: camera.position.z,
      qx: camera.quaternion.x,
      qy: camera.quaternion.y,
      qz: camera.quaternion.z,
      qw: camera.quaternion.w,
      fov: camera.fov,
    };
    const prior = window.__registerLifecycleCameraProbe;
    if (!prior) {
      window.__registerLifecycleCameraProbe = { ...next, stable: 0 };
      return false;
    }
    const delta = Math.max(
      Math.abs(next.x - prior.x), Math.abs(next.y - prior.y), Math.abs(next.z - prior.z),
      Math.abs(next.qx - prior.qx), Math.abs(next.qy - prior.qy),
      Math.abs(next.qz - prior.qz), Math.abs(next.qw - prior.qw),
      Math.abs(next.fov - prior.fov),
    );
    const stable = delta < 0.0008 ? prior.stable + 1 : 0;
    window.__registerLifecycleCameraProbe = { ...next, stable };
    return stable >= 4;
  }, workspace, { timeout, polling: 80 });
}

async function enterFrontDesk(page) {
  const alreadyActive = await page.evaluate(() => window.__fw.scene3d.clubhouse().register.isActive());
  if (!alreadyActive) await page.keyboard.press('e');
  await page.waitForFunction(() => window.__fw.scene3d.clubhouse().register.isActive(), null,
    { timeout: 8000 });
  await waitCamera(page, 'monitor');
}

async function leaveFrontDesk(page) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (!await page.evaluate(() => window.__fw.scene3d.clubhouse().register.isActive())) return;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(180);
  }
  assert(!await page.evaluate(() => window.__fw.scene3d.clubhouse().register.isActive()),
    'Escape did not release the reset front desk within five normal inputs.');
}

async function projectObject(page, predicate) {
  return page.evaluate(async (query) => {
    const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    let found = null;
    clubhouse.interior.traverse((object) => {
      if (found || !object.visible || !object.userData) return;
      if (query.kind && object.userData.kind !== query.kind) return;
      if (query.uid && object.userData.uid !== query.uid) return;
      found = object;
    });
    if (!found) return null;
    const bounds = new THREE.Box3().setFromObject(found);
    const world = bounds.isEmpty()
      ? found.getWorldPosition(new THREE.Vector3())
      : bounds.getCenter(new THREE.Vector3());
    world.project(app.scene3d.camera);
    const rect = document.querySelector('canvas').getBoundingClientRect();
    return {
      x: rect.left + ((world.x + 1) / 2) * rect.width,
      y: rect.top + ((-world.y + 1) / 2) * rect.height,
      inView: world.z >= -1 && world.z <= 1 && Math.abs(world.x) <= 1 && Math.abs(world.y) <= 1,
    };
  }, predicate);
}

async function clickMonitorAction(page, action, workspace) {
  await page.waitForFunction(([id, wanted]) => {
    const register = window.__fw.scene3d.clubhouse().register;
    const point = register.monitorScreenPoint(id);
    return register.workspace() === wanted && point?.inView;
  }, [action, workspace], { timeout: 10000 });
  const point = await page.evaluate((id) => (
    window.__fw.scene3d.clubhouse().register.monitorScreenPoint(id)
  ), action);
  assert(point?.inView, `Monitor action ${action} is outside the ${workspace} camera.`);
  await page.mouse.click(point.x, point.y);
  await page.waitForTimeout(160);
}

async function spawnCycleCustomer(page, cycle, method, skuId) {
  return page.evaluate(({ cycleNumber, paymentMethod, productSku }) => {
    const clubhouse = window.__fw.scene3d.clubhouse();
    const customerList = () => (typeof clubhouse.customers === 'function'
      ? clubhouse.customers()
      : clubhouse.customers);
    const prior = new Set(customerList().map((customer) => customer.customerId));
    const name = clubhouse.sendToCounter([productSku], paymentMethod);
    if (!name) throw new Error(`sendToCounter could not seed ${productSku} for cycle ${cycleNumber}.`);
    const customer = customerList().find((entry) => !prior.has(entry.customerId));
    if (!customer) throw new Error(`Cycle ${cycleNumber} customer identity was not observable.`);
    customer.__registerLifecycleCycle = cycleNumber;
    return {
      customerId: customer.customerId,
      fullName: customer.fullName || customer.name,
      method: paymentMethod,
      skuId: productSku,
    };
  }, { cycleNumber: cycle, paymentMethod: method, productSku: skuId });
}

async function waitForCycleTransaction(page, fixture) {
  await page.waitForFunction((cycle) => {
    const register = window.__fw.scene3d.clubhouse().register;
    const owner = register.getCustomer();
    const tx = register.getTx();
    return register.isActive() && owner?.__registerLifecycleCycle === cycle
      && tx?.items?.length === 1 && tx.stage === 'scanning';
  }, fixture.cycle, { timeout: 18000 });
  return page.evaluate(({ cycle, method }) => {
    const register = window.__fw.scene3d.clubhouse().register;
    const owner = register.getCustomer();
    const tx = register.getTx();
    if (owner?.__registerLifecycleCycle !== cycle) {
      throw new Error(`Cycle ${cycle} does not own the active transaction.`);
    }
    if (method === 'cash') {
      tx.items[0].price = 5;
      tx.items[0].priceCents = 500;
    }
    return {
      number: tx.number,
      uid: tx.items[0].uid,
      startingStage: tx.stage,
      prefer: tx.prefer,
    };
  }, { cycle: fixture.cycle, method: fixture.method });
}

async function scanSingleProduct(page, uid) {
  await waitCamera(page, 'scan');
  let product = await projectObject(page, { kind: 'item', uid });
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await page.waitForTimeout(120);
    const next = await projectObject(page, { kind: 'item', uid });
    if (next && product && Math.abs(next.x - product.x) < 1.5 && Math.abs(next.y - product.y) < 1.5) {
      product = next;
      break;
    }
    product = next;
  }
  assert(product?.inView, `Product ${uid} is outside the scan camera.`);
  await page.mouse.click(product.x, product.y);
  await page.waitForFunction((itemUid) => {
    const item = window.__fw.scene3d.clubhouse().register.getTx()?.items
      .find((entry) => entry.uid === itemUid);
    return item?.scanned && item?.staged;
  }, uid, { timeout: 9000 });
}

async function waitForCardReady(page) {
  await page.waitForFunction(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return tx?.stage === 'card-ready';
  }, null, { timeout: 10000 });
  await waitCamera(page, 'card');
}

async function cancelPreAuthorizationWithX(page) {
  // The X is a pre-authorization exit in both card-ready and card-entry. Use the
  // inserted, exact-total reader view so the physical X is guaranteed to be in
  // the player's close camera even when the customer-handoff framing places the
  // seated terminal just outside a narrow viewport.
  const prefill = await insertCardToAmountEntry(page);
  await waitCamera(page, 'card');
  const before = await page.evaluate(() => {
    const register = window.__fw.scene3d.clubhouse().register;
    const tx = register.getTx();
    return {
      number: tx?.number,
      stage: tx?.stage,
      cardAttempts: tx?.cardAttempts,
      itemUids: tx?.items?.map((item) => item.uid) || [],
      x: register.cardXScreenPoint(),
    };
  });
  assert(before.x?.visible && before.x?.inView,
    `The pre-authorization X is not visible from the player camera: ${JSON.stringify(before.x)}.`);
  assert(before.stage === 'card-entry' && Number(before.cardAttempts || 0) === 0,
    `The X cancellation was not captured before authorization: ${JSON.stringify(before)}.`);
  await page.mouse.click(before.x.x, before.x.y);
  await page.waitForFunction((transactionNumber) => {
    const register = window.__fw.scene3d.clubhouse().register;
    const tx = register.getTx();
    return register.workspace() === 'monitor'
      && tx?.number === transactionNumber
      && tx.stage === 'scanning'
      && tx.items.every((item) => item.scanned && item.staged);
  }, before.number, { timeout: 5000 });
  const cancelled = await page.evaluate(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return {
      number: tx?.number,
      stage: tx?.stage,
      method: tx?.method,
      itemUids: tx?.items?.map((item) => item.uid) || [],
    };
  });
  assert(cancelled.number === before.number
      && cancelled.stage === 'scanning'
      && cancelled.method === null
      && JSON.stringify(cancelled.itemUids) === JSON.stringify(before.itemUids),
  `Pre-authorization X did not preserve the transaction basket: ${JSON.stringify({ before, cancelled })}.`);
  await waitForCardReady(page);
  return { before, cancelled, prefill, represented: true };
}

async function insertCardToAmountEntry(page) {
  await waitForCardReady(page);
  const card = await page.evaluate(() => (
    window.__fw.scene3d.clubhouse().register.presentedCardScreenPoint()
  ));
  assert(card?.inView, 'The customer-held card is outside the fixed-reader camera.');
  await page.mouse.click(card.x, card.y);
  await page.waitForFunction(() => (
    window.__fw.scene3d.clubhouse().register.getTx()?.stage === 'card-entry'
  ), null, { timeout: 5000 });
  const prefill = await page.evaluate(async () => {
    const sim = await import(new URL('src/sim/register.js', document.baseURI).href);
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return {
      totalCents: Math.round(sim.totalOf(tx) * 100),
      enteredCents: Number(tx.cardEntryCents),
      digits: String(tx.cardEntryDigits || ''),
    };
  });
  assert(prefill.enteredCents === prefill.totalCents
      && prefill.digits === String(prefill.totalCents),
  `Card total was not prefilled exactly: ${JSON.stringify(prefill)}.`);
  return prefill;
}

async function insertAndConfirmCard(page) {
  const prefill = await insertCardToAmountEntry(page);
  const confirm = await page.evaluate(() => (
    window.__fw.scene3d.clubhouse().register.cardKeyScreenPoint('OK')
  ));
  assert(confirm?.inView, 'The fixed reader Confirm key is outside the player camera.');
  await page.mouse.click(confirm.x, confirm.y);
  await page.waitForFunction(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return tx && ['card-busy', 'card-declined', 'receipt'].includes(tx.stage);
  }, null, { timeout: 5000 });
  return { prefill };
}

async function completeCard(page, {
  cancelBeforeAuthorization = false,
  declineThenRecover = false,
  onPhase = async () => {},
} = {}) {
  const cancellation = cancelBeforeAuthorization
    ? await cancelPreAuthorizationWithX(page)
    : null;
  if (cancellation) await onPhase('pre-authorization-x-cancelled');
  await page.evaluate((declineFirst) => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    const values = declineFirst ? [0, 0.99] : [0.99];
    tx.__registerLifecycleCardRngTrace = [];
    tx.rng = () => {
      const value = values.length ? values.shift() : 0.99;
      tx.__registerLifecycleCardRngTrace.push(value);
      return value;
    };
  }, declineThenRecover);

  const attempts = [await insertAndConfirmCard(page)];
  let declined = null;
  if (declineThenRecover) {
    await page.waitForFunction(() => {
      const tx = window.__fw.scene3d.clubhouse().register.getTx();
      return tx?.stage === 'card-declined'
        && tx.cardResult === 'declined'
        && tx.cardAttempts === 1;
    }, null, { timeout: 10000 });
    declined = await page.evaluate(() => {
      const tx = window.__fw.scene3d.clubhouse().register.getTx();
      return {
        stage: tx?.stage,
        flow: tx?.checkoutFlow?.state,
        result: tx?.cardResult,
        attempts: tx?.cardAttempts,
        cardsTried: tx?.cardsTried,
        rngTrace: [...(tx?.__registerLifecycleCardRngTrace || [])],
      };
    });
    assert(declined.attempts === 1 && declined.cardsTried === 1
        && JSON.stringify(declined.rngTrace) === JSON.stringify([0]),
    `The first normal authorization did not decline exactly once: ${JSON.stringify(declined)}.`);
    await onPhase('card-declined-before-recovery');
    await waitCamera(page, 'monitor');
    await clickMonitorAction(page, 'retry-card', 'monitor');
    attempts.push(await insertAndConfirmCard(page));
  }

  const expectedAttempts = declineThenRecover ? 2 : 1;
  await page.waitForFunction((attemptCount) => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return tx?.stage === 'receipt' && tx.cardResult === 'approved'
      && tx.cardAttempts === attemptCount;
  }, expectedAttempts, { timeout: 10000 });
  const approved = await page.evaluate(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return {
      result: tx?.cardResult,
      attempts: tx?.cardAttempts,
      cardsTried: tx?.cardsTried,
      rngTrace: [...(tx?.__registerLifecycleCardRngTrace || [])],
    };
  });
  const expectedTrace = declineThenRecover ? [0, 0.99] : [0.99];
  assert(JSON.stringify(approved.rngTrace) === JSON.stringify(expectedTrace),
    `Normal card authorization consumed the wrong RNG sequence: ${JSON.stringify(approved)}.`);
  assert(!declineThenRecover || approved.cardsTried === 2,
    `Declined-card recovery did not use a replacement card: ${JSON.stringify(approved)}.`);
  await onPhase(declineThenRecover ? 'card-decline-recovered' : 'card-approved');
  return {
    cancellation,
    declined,
    approved,
    attempts,
    cancellationCompleted: !!cancellation,
    declineRecoveryCompleted: !!declined && approved.result === 'approved',
  };
}

async function completeCash(page) {
  await page.waitForFunction(() => (
    window.__fw.scene3d.clubhouse().register.getTx()?.stage === 'cash-tender'
  ), null, { timeout: 10000 });
  const tender = await page.evaluate(async () => {
    const sim = await import(new URL('src/sim/register.js', document.baseURI).href);
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return {
      total: sim.cashTotalOf(tx),
      tendered: sim.stackTotal(tx.tendered),
      change: sim.changeDue(tx),
    };
  });
  assert(tender.total === 5 && tender.tendered === 5 && tender.change === 0,
    `Cycle exact-cash fixture is invalid: ${JSON.stringify(tender)}.`);
  const handful = await page.evaluate(() => (
    window.__fw.scene3d.clubhouse().register.presentedCashScreenPoint()
  ));
  assert(handful?.inView, 'The customer-held cash is outside the player camera.');
  await page.mouse.click(handful.x, handful.y);
  await page.waitForFunction(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return tx?.stage === 'cash-drawer' && tx.drawerOpen && tx.deposited;
  }, null, { timeout: 10000 });
  await waitCamera(page, 'cash');
  const change = await page.evaluate(async () => {
    const sim = await import(new URL('src/sim/register.js', document.baseURI).href);
    return sim.changeGivingState(window.__fw.scene3d.clubhouse().register.getTx());
  });
  assert(change.state === 'exact' && change.requiredCents === 0 && change.givingCents === 0,
    `Zero change was not exact: ${JSON.stringify(change)}.`);
  await clickMonitorAction(page, 'confirm-change', 'cash');
  await page.waitForFunction(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return tx && ['receipt', 'bagging', 'done'].includes(tx.stage)
      && !tx.drawerOpen && tx.changeGiven === 0;
  }, null, { timeout: 8000 });
  return { tender, change, drawerOpened: true, drawerClosed: true };
}

async function forceGarbageCollection(cdp) {
  await cdp.send('HeapProfiler.collectGarbage').catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 40));
  await cdp.send('HeapProfiler.collectGarbage').catch(() => {});
}

async function snapshot(page, cdp, {
  cycle,
  phase,
  scenario = 'sale',
  forceGc = true,
} = {}) {
  if (forceGc) {
    // Register mode maps pointer position to a bounded first-person head lean.
    // Normalize to the exact viewport centre before every cleanup sample; a
    // corner move slowly reveals previously frustum-culled shop geometry and
    // makes finite GPU realization look like a transaction leak.
    await page.mouse.move(VIEWPORT.width / 2, VIEWPORT.height / 2);
    const workspace = await page.evaluate(() => (
      window.__fw.scene3d.clubhouse().register.workspace()
    ));
    await waitCamera(page, workspace, 8000);
    await forceGarbageCollection(cdp);
    await page.waitForTimeout(60);
  }
  const [domCounters, runtimeHeap, performanceMetrics] = await Promise.all([
    cdp.send('Memory.getDOMCounters'),
    cdp.send('Runtime.getHeapUsage'),
    cdp.send('Performance.getMetrics'),
  ]);
  const cdpMetrics = Object.fromEntries(
    performanceMetrics.metrics.map((entry) => [entry.name, entry.value]),
  );
  const game = await page.evaluate(({ cycleNumber, samplePhase, sampleScenario }) => {
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    const scene = app.scene3d.scene;
    const registerRoot = clubhouse.interior.getObjectByName('SimplifiedFrontDeskRegister');
    const resourceSets = (root) => {
      const geometries = new Set();
      const materials = new Set();
      const textures = new Set();
      let nodes = 0;
      let meshes = 0;
      if (!root) return { nodes, meshes, geometries: 0, materials: 0, textures: 0 };
      root.traverse((object) => {
        nodes += 1;
        if (object.isMesh) meshes += 1;
        if (object.geometry?.uuid) geometries.add(object.geometry.uuid);
        const entries = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of entries) {
          if (!material) continue;
          if (material.uuid) materials.add(material.uuid);
          for (const value of Object.values(material)) {
            if (value?.isTexture && value.uuid) textures.add(value.uuid);
          }
          for (const uniform of Object.values(material.uniforms || {})) {
            const value = uniform?.value;
            if (value?.isTexture && value.uuid) textures.add(value.uuid);
          }
        }
      });
      return {
        nodes,
        meshes,
        geometries: geometries.size,
        materials: materials.size,
        textures: textures.size,
      };
    };
    const namedCounts = {
      printedReceipts: 0,
      frontDeskBags: 0,
      visibleBagContents: 0,
      customerOwnedObjects: 0,
      customerReceiptObjects: 0,
      registerItems: 0,
      registerMoney: 0,
      registerCards: 0,
    };
    scene.traverse((object) => {
      if (object.name === 'PrintedReceipt') namedCounts.printedReceipts += 1;
      if (object.name === 'FrontDeskShoppingBag') namedCounts.frontDeskBags += 1;
      if (object.userData?.checkoutVisualState === 'visible-in-bag') {
        namedCounts.visibleBagContents += 1;
      }
      if (object.userData?.checkoutOwner === 'customer') {
        namedCounts.customerOwnedObjects += 1;
        if (/receipt/i.test(object.name || '')) namedCounts.customerReceiptObjects += 1;
      }
    });
    if (registerRoot) {
      registerRoot.traverse((object) => {
        if (object.userData?.kind === 'item') namedCounts.registerItems += 1;
        if (object.userData?.kind === 'money') namedCounts.registerMoney += 1;
        if (object.userData?.kind === 'payment-card') namedCounts.registerCards += 1;
      });
    }
    let liveDomNodes = 1;
    const walker = document.createTreeWalker(document, NodeFilter.SHOW_ALL);
    while (walker.nextNode()) liveDomNodes += 1;
    const listeners = { ...(window.__registerLifecycleProbe?.counters || {}) };
    const listenerNet = Object.values(listeners).reduce((sum, value) => sum + value, 0);
    const customers = typeof clubhouse.customers === 'function'
      ? clubhouse.customers()
      : clubhouse.customers;
    const shop = app.state.shop;
    const renderer = app.scene3d.renderer;
    const tx = clubhouse.register.getTx();
    const earlyRuntime = window.__registerEarlyLifecycleProbe?.read?.() || {
      timers: {
        activeTimeouts: null,
        activeIntervals: null,
        activeAnimationFrames: null,
        unavailable: true,
      },
      audio: {
        available: false,
        contextsCreated: 0,
        openContexts: 0,
        sourcesCreated: 0,
        activeSources: 0,
      },
    };
    const resourceProbe = window.__registerResourceLifecycleProbe;
    return {
      scenario: sampleScenario,
      cycle: cycleNumber,
      phase: samplePhase,
      atMs: Math.round(performance.now()),
      state: {
        active: clubhouse.register.isActive(),
        workspace: clubhouse.register.workspace(),
        txNumber: tx?.number || null,
        txStage: tx?.stage || null,
        txMethod: tx?.method || null,
        txCheckoutFlowState: tx?.checkoutFlow?.state || null,
        deliveryPhase: clubhouse.register.deliveryPhase(),
        ownerCustomerId: clubhouse.register.getCustomer()?.customerId || null,
        queue: clubhouse.checkoutQueue().length,
        customers: customers.length,
        customerTransactions: customers.filter((customer) => customer.tx).length,
        customerBags: customers.filter((customer) => customer.bagMesh).length,
        customerReceipts: customers.filter((customer) => customer.bagMesh
          && customer.bagMesh.getObjectByName?.('Receipt_Strip')).length,
        units: shop.salesLive?.units || 0,
        revenue: shop.salesLive?.revenue || 0,
        history: (shop.transactionHistory || []).length,
        nextTransactionNo: Number(shop.nextTransactionNo || 1),
        held: (shop.held || []).length,
        cash: app.state.cash,
      },
      scene: resourceSets(scene),
      clubhouse: resourceSets(clubhouse.interior),
      register: resourceSets(registerRoot),
      props: namedCounts,
      renderer: {
        memory: { ...renderer.info.memory },
        render: { ...renderer.info.render },
        programs: renderer.info.programs?.length ?? null,
      },
      dom: {
        liveNodes: liveDomNodes,
        bodyElements: document.body.getElementsByTagName('*').length,
      },
      listeners: { net: listenerNet, byTargetAndType: listeners },
      timers: earlyRuntime.timers,
      audio: earlyRuntime.audio,
      animationMixers: {
        count: resourceProbe?.animationMixerCount ?? 0,
        updateCalls: resourceProbe?.animationMixerUpdateCalls || 0,
        measurement: 'unique AnimationMixer instances observed through clipAction/update after the resource probe was installed',
      },
      pageHeapBytes: performance.memory?.usedJSHeapSize ?? null,
    };
  }, { cycleNumber: cycle, samplePhase: phase, sampleScenario: scenario });
  return {
    ...game,
    dom: {
      ...game.dom,
      documents: domCounters.documents,
      nodes: domCounters.nodes,
      jsEventListeners: domCounters.jsEventListeners,
      detachedNodesEstimate: Math.max(0, domCounters.nodes - game.dom.liveNodes),
    },
    heap: {
      pageUsedBytes: game.pageHeapBytes,
      runtimeUsedBytes: runtimeHeap.usedSize,
      runtimeTotalBytes: runtimeHeap.totalSize,
      cdpJsHeapUsedBytes: cdpMetrics.JSHeapUsedSize ?? null,
      cdpJsHeapTotalBytes: cdpMetrics.JSHeapTotalSize ?? null,
    },
    cdpPerformance: {
      taskDurationSeconds: cdpMetrics.TaskDuration ?? null,
      scriptDurationSeconds: cdpMetrics.ScriptDuration ?? null,
      layoutDurationSeconds: cdpMetrics.LayoutDuration ?? null,
      recalcStyleDurationSeconds: cdpMetrics.RecalcStyleDuration ?? null,
    },
  };
}

function getMetric(sample, pathSpec) {
  return pathSpec.split('.').reduce((value, key) => value?.[key], sample);
}

function metricSummary(samples, pathSpec) {
  const values = samples.map((sample) => Number(getMetric(sample, pathSpec)));
  const deltas = values.slice(1).map((value, index) => value - values[index]);
  const strictIncreases = deltas.filter((delta) => delta > 0).length;
  const monotonicLeak = deltas.length >= 3
    && deltas.every((delta) => delta >= 0)
    && strictIncreases >= Math.ceil(deltas.length / 3)
    && values[values.length - 1] > values[0];
  return {
    path: pathSpec,
    first: values[0],
    last: values[values.length - 1],
    min: Math.min(...values),
    max: Math.max(...values),
    range: Math.max(...values) - Math.min(...values),
    delta: values[values.length - 1] - values[0],
    strictIncreases,
    monotonicLeak,
    values,
  };
}

function linearSlope(values) {
  const count = values.length;
  const meanX = (count - 1) / 2;
  const meanY = values.reduce((sum, value) => sum + value, 0) / count;
  let numerator = 0;
  let denominator = 0;
  values.forEach((value, index) => {
    numerator += (index - meanX) * (value - meanY);
    denominator += (index - meanX) ** 2;
  });
  return denominator ? numerator / denominator : 0;
}

function selectTrailingStableWindow(samples) {
  const minimumSamples = samples.length >= 12 ? 5 : 3;
  const criteria = [
    ['scene.nodes', 4],
    ['clubhouse.nodes', 4],
    ['register.nodes', 4],
    ['scene.geometries', 2],
    ['scene.materials', 2],
    ['scene.textures', 2],
    ['renderer.memory.geometries', 2],
    ['renderer.memory.textures', 2],
    ['dom.liveNodes', 4],
    ['dom.nodes', 12],
    ['dom.detachedNodesEstimate', 12],
    ['dom.jsEventListeners', 2],
    ['listeners.net', 0],
  ];
  const lastPossibleStart = Math.max(0, samples.length - minimumSamples);
  for (let start = 0; start <= lastPossibleStart; start += 1) {
    const candidate = samples.slice(start);
    const summaries = criteria.map(([metric]) => metricSummary(candidate, metric));
    const stable = summaries.every((summary, index) => (
      summary.range <= criteria[index][1] && !summary.monotonicLeak
    ));
    if (stable) {
      return {
        samples: candidate,
        startIndex: start,
        minimumSamples,
        selectionCriteria: Object.fromEntries(criteria),
      };
    }
  }
  return {
    samples: samples.slice(lastPossibleStart),
    startIndex: lastPossibleStart,
    minimumSamples,
    selectionCriteria: Object.fromEntries(criteria),
  };
}

function durationSummary(values) {
  const finite = values.map(Number).filter(Number.isFinite).sort((left, right) => left - right);
  if (!finite.length) return { count: 0, totalMs: 0, averageMs: null, p95Ms: null, maxMs: null };
  const totalMs = finite.reduce((sum, value) => sum + value, 0);
  return {
    count: finite.length,
    totalMs: round2(totalMs),
    averageMs: round2(totalMs / finite.length),
    p95Ms: round2(finite[Math.min(finite.length - 1, Math.ceil(finite.length * 0.95) - 1)]),
    maxMs: round2(finite[finite.length - 1]),
  };
}

function summarizeResourceLifecycle(details) {
  if (!details) return null;
  const resources = {};
  for (const kind of ['geometry', 'material', 'texture']) {
    const entry = details.resources?.[kind];
    resources[kind] = entry ? {
      observedCount: entry.observedCount,
      liveAtEndCount: entry.liveAtEndCount,
      disposedCount: entry.disposedCount,
      disposeCallCount: entry.disposeCallCount,
      disposalEventCount: entry.disposalEventCount,
      cycleResourceCount: entry.cycleResourceCount ?? entry.cycleResources?.length ?? 0,
      ephemeralUndisposedCount: entry.ephemeralUndisposedCount,
      topEphemeralUndisposedGroups: (entry.ephemeralUndisposedGroups || []).slice(0, 12),
    } : {
      observedCount: 0,
      liveAtEndCount: 0,
      disposedCount: 0,
      disposeCallCount: 0,
      disposalEventCount: 0,
      cycleResourceCount: 0,
      ephemeralUndisposedCount: 0,
      topEphemeralUndisposedGroups: [],
    };
  }
  return {
    phaseMarkCount: details.phaseMarks?.length || 0,
    resources,
    animationMixers: details.animationMixers || {
      count: 0,
      updateCalls: 0,
      measurement: 'resource probe unavailable; no AnimationMixer was observed',
    },
  };
}

function buildGates({
  baseline,
  stableSamples,
  transientSamples,
  finalSample,
  cycles,
  fixture,
  tickets,
  diagnostics,
  cardinality,
  salesPlan,
  resourceLifecycle,
  frontDeskLifecycle,
  enforceStability = true,
}) {
  const tolerances = {
    sceneNodesRange: 4,
    clubhouseNodesRange: 4,
    registerNodesRange: 4,
    uniqueResourceRange: 2,
    rendererMemoryRange: 2,
    liveDomNodeRange: 4,
    cdpDomNodeRange: 12,
    listenerNetRange: 0,
    jsListenerRange: 2,
    maxHeapGrowthBytes: Math.max(8 * 1024 * 1024, cycles * 512 * 1024),
    maxHeapSlopeBytesPerCycle: 512 * 1024,
  };
  const paths = [
    'scene.nodes',
    'clubhouse.nodes',
    'register.nodes',
    'scene.geometries',
    'scene.materials',
    'scene.textures',
    'renderer.memory.geometries',
    'renderer.memory.textures',
    'dom.liveNodes',
    'dom.nodes',
    'dom.detachedNodesEstimate',
    'dom.jsEventListeners',
    'listeners.net',
  ];
  const summaries = Object.fromEntries(paths.map((metric) => [metric, metricSummary(stableSamples, metric)]));
  const runtimePaths = [
    'timers.activeTimeouts',
    'timers.activeIntervals',
    'timers.activeAnimationFrames',
    'animationMixers.count',
    'audio.openContexts',
    'audio.activeSources',
  ];
  const runtimeSummaries = Object.fromEntries(runtimePaths.map((metric) => (
    [metric, metricSummary(stableSamples, metric)]
  )));
  const heapValues = stableSamples.map((sample) => sample.heap.runtimeUsedBytes);
  const heap = {
    first: heapValues[0],
    last: heapValues[heapValues.length - 1],
    growthBytes: heapValues[heapValues.length - 1] - heapValues[0],
    slopeBytesPerCycle: linearSlope(heapValues),
    values: heapValues,
  };
  const checks = [];
  const check = (id, ok, actual, expected) => checks.push({ id, ok: !!ok, actual, expected });
  const stabilityCheck = (id, observedOk, actual, expected) => checks.push({
    id,
    ok: enforceStability ? !!observedOk : true,
    observedOk: !!observedOk,
    enforced: enforceStability,
    actual,
    expected,
  });
  const rangeCheck = (metric, limit) => {
    const summary = summaries[metric];
    stabilityCheck(`${metric}-stable-range`, summary.range <= limit, summary.range, `<= ${limit}`);
    stabilityCheck(`${metric}-not-monotonic-leak`, !summary.monotonicLeak,
      summary, 'no repeated strict monotonic growth');
  };
  rangeCheck('scene.nodes', tolerances.sceneNodesRange);
  rangeCheck('clubhouse.nodes', tolerances.clubhouseNodesRange);
  rangeCheck('register.nodes', tolerances.registerNodesRange);
  rangeCheck('scene.geometries', tolerances.uniqueResourceRange);
  rangeCheck('scene.materials', tolerances.uniqueResourceRange);
  rangeCheck('scene.textures', tolerances.uniqueResourceRange);
  rangeCheck('renderer.memory.geometries', tolerances.rendererMemoryRange);
  rangeCheck('renderer.memory.textures', tolerances.rendererMemoryRange);
  rangeCheck('dom.liveNodes', tolerances.liveDomNodeRange);
  rangeCheck('dom.nodes', tolerances.cdpDomNodeRange);
  rangeCheck('dom.detachedNodesEstimate', tolerances.cdpDomNodeRange);
  rangeCheck('dom.jsEventListeners', tolerances.jsListenerRange);
  rangeCheck('listeners.net', tolerances.listenerNetRange);
  for (const metric of runtimePaths) {
    stabilityCheck(`${metric}-not-monotonic-leak`, !runtimeSummaries[metric].monotonicLeak,
      runtimeSummaries[metric], 'no repeated strict monotonic growth in active instances');
  }
  if (frontDeskLifecycle?.sampleCount >= 2) {
    const frontDeskLimits = {
      'scene.nodes': tolerances.sceneNodesRange,
      'scene.geometries': tolerances.uniqueResourceRange,
      'scene.materials': tolerances.uniqueResourceRange,
      'scene.textures': tolerances.uniqueResourceRange,
      'renderer.memory.geometries': tolerances.rendererMemoryRange,
      'renderer.memory.textures': tolerances.rendererMemoryRange,
      'dom.liveNodes': tolerances.liveDomNodeRange,
      'dom.nodes': tolerances.cdpDomNodeRange,
      'dom.detachedNodesEstimate': tolerances.cdpDomNodeRange,
      'dom.jsEventListeners': tolerances.jsListenerRange,
      'listeners.net': tolerances.listenerNetRange,
    };
    for (const [metric, limit] of Object.entries(frontDeskLimits)) {
      const summary = frontDeskLifecycle.summaries[metric];
      stabilityCheck(`front-desk.${metric}-stable-range`, summary.range <= limit,
        summary.range, `<= ${limit}`);
      stabilityCheck(`front-desk.${metric}-not-monotonic-leak`, !summary.monotonicLeak,
        summary, 'no repeated strict monotonic growth after front-desk exit');
    }
    for (const metric of runtimePaths) {
      const summary = frontDeskLifecycle.summaries[metric];
      stabilityCheck(`front-desk.${metric}-not-monotonic-leak`, !summary.monotonicLeak,
        summary, 'no repeated strict monotonic growth in active instances after front-desk exit');
    }
    stabilityCheck('front-desk.forced-gc-heap-growth',
      frontDeskLifecycle.heap.growthBytes <= 8 * 1024 * 1024,
      frontDeskLifecycle.heap.growthBytes, `<= ${8 * 1024 * 1024}`);
    stabilityCheck('front-desk.forced-gc-heap-slope',
      frontDeskLifecycle.heap.slopeBytesPerIteration <= tolerances.maxHeapSlopeBytesPerCycle,
      frontDeskLifecycle.heap.slopeBytesPerIteration,
      `<= ${tolerances.maxHeapSlopeBytesPerCycle} bytes/front-desk iteration`);
  }
  stabilityCheck('forced-gc-heap-growth', heap.growthBytes <= tolerances.maxHeapGrowthBytes,
    heap.growthBytes, `<= ${tolerances.maxHeapGrowthBytes}`);
  stabilityCheck('forced-gc-heap-slope', heap.slopeBytesPerCycle <= tolerances.maxHeapSlopeBytesPerCycle,
    heap.slopeBytesPerCycle, `<= ${tolerances.maxHeapSlopeBytesPerCycle} bytes/cycle`);
  check('completed-cycle-count', tickets.length === cycles, tickets.length, cycles);
  for (const [name, counter] of Object.entries(cardinality)) {
    check(`cardinality-${name}`, counter.ok, counter,
      counter.comparison === 'exact'
        ? { comparison: 'exact', requested: counter.requested }
        : { comparison: 'at-least', requestedMinimum: counter.requestedMinimum });
  }
  check('units-exact-once', finalSample.state.units === fixture.units + cycles,
    finalSample.state.units - fixture.units, cycles);
  const expectedHistory = Math.min(100, fixture.history + cycles);
  check('bounded-history-exact', finalSample.state.history === expectedHistory,
    finalSample.state.history, expectedHistory);
  check('next-transaction-number-exact-once',
    finalSample.state.nextTransactionNo === fixture.nextTransactionNo + cycles,
    finalSample.state.nextTransactionNo, fixture.nextTransactionNo + cycles);
  check('held-reset', finalSample.state.held === fixture.held, finalSample.state.held, fixture.held);
  check('ticket-number-unique', new Set(tickets.map((ticket) => ticket.number)).size === cycles,
    tickets.map((ticket) => ticket.number), 'one unique transaction number per cycle');
  check('ticket-method-plan', tickets.every((ticket, index) => (
    ticket.method === salesPlan[index]?.method
  )), tickets.map((ticket) => ticket.method), salesPlan.map((entry) => entry.method));
  check('receipt-observed-every-cycle', transientSamples.length === cycles
      && transientSamples.every((sample) => sample.props.printedReceipts === 1
        && sample.props.visibleBagContents === 1
        && ['receipt-print', 'receipt-ready', 'receipt-deliver'].includes(sample.state.deliveryPhase)),
  transientSamples.map((sample) => ({
    cycle: sample.cycle,
    deliveryPhase: sample.state.deliveryPhase,
    printedReceipts: sample.props.printedReceipts,
    visibleBagContents: sample.props.visibleBagContents,
  })), 'one live printed receipt and one bagged product during every handoff');
  check('post-cycle-no-live-transaction-props', stableSamples.every((sample) => (
    sample.props.printedReceipts === 0
      && sample.props.visibleBagContents === 0
      && sample.props.registerItems === 0
      && sample.props.registerCards === 0
      && sample.state.txNumber === null
      && sample.state.ownerCustomerId === null
      && sample.state.customers === 0
      && sample.state.customerTransactions === 0
      && sample.state.customerBags === 0
  )), stableSamples.map((sample) => ({
    cycle: sample.cycle,
    props: sample.props,
    customers: sample.state.customers,
    txNumber: sample.state.txNumber,
    owner: sample.state.ownerCustomerId,
  })), 'zero transient transaction/receipt/bag/customer objects after physical exit');
  check('console-errors', diagnostics.consoleErrors.length === 0,
    diagnostics.consoleErrors, []);
  check('page-errors', diagnostics.pageErrors.length === 0, diagnostics.pageErrors, []);
  check('non-aborted-request-failures', diagnostics.nonAbortedFailedRequests.length === 0,
    diagnostics.nonAbortedFailedRequests, []);
  // A completed retail handoff intentionally transfers the exact authored bag
  // to the departing customer, so an idle till can legitimately contain zero
  // counter bags. Judge the register root itself instead of using that transient
  // prop as a proxy for whether the front-desk installation survived the run.
  check('front-desk-register-retained', baseline.register.nodes > 0
      && finalSample.register.nodes > 0,
  { baseline: baseline.register.nodes, final: finalSample.register.nodes },
  'positive register-root node counts before and after the lifecycle run');
  const animationMixerCount = resourceLifecycle?.animationMixers?.count ?? 0;
  check('animation-mixer-count-reported', Number.isInteger(animationMixerCount)
      && animationMixerCount >= 0,
  animationMixerCount, 'a non-negative integer, with explicit 0 when none are observed');
  return {
    ok: checks.every((entry) => entry.ok),
    tolerances,
    stabilityEnforced: enforceStability,
    checks,
    summaries,
    runtimeSummaries,
    heap,
  };
}

function buildSampleWindowReport(samples) {
  if (!samples?.length) return {
    sampleCount: 0,
    firstIteration: null,
    lastIteration: null,
    summaries: {},
    heap: null,
  };
  const paths = [
    'scene.nodes',
    'scene.geometries',
    'scene.materials',
    'scene.textures',
    'renderer.memory.geometries',
    'renderer.memory.textures',
    'dom.liveNodes',
    'dom.nodes',
    'dom.detachedNodesEstimate',
    'dom.jsEventListeners',
    'listeners.net',
    'timers.activeTimeouts',
    'timers.activeIntervals',
    'timers.activeAnimationFrames',
    'animationMixers.count',
    'audio.openContexts',
    'audio.activeSources',
  ];
  const heapValues = samples.map((sample) => sample.heap.runtimeUsedBytes);
  const iterationSpan = Math.max(1, Number(samples.at(-1).cycle) - Number(samples[0].cycle));
  const heapGrowthBytes = heapValues.at(-1) - heapValues[0];
  return {
    sampleCount: samples.length,
    firstIteration: samples[0].cycle,
    lastIteration: samples.at(-1).cycle,
    summaries: Object.fromEntries(paths.map((metric) => [metric, metricSummary(samples, metric)])),
    heap: {
      first: heapValues[0],
      last: heapValues.at(-1),
      growthBytes: heapGrowthBytes,
      slopeBytesPerSample: linearSlope(heapValues),
      slopeBytesPerIteration: heapGrowthBytes / iterationSpan,
      iterationSpan,
      values: heapValues,
    },
  };
}

function buildFrontDeskLifecycleReport(samples) {
  if (!samples?.length) return {
    ...buildSampleWindowReport([]),
    capturedSampleCount: 0,
    stableWindow: null,
  };
  const selection = samples.length >= 2 ? selectTrailingStableWindow(samples) : {
    samples,
    startIndex: 0,
    minimumSamples: samples.length,
    selectionCriteria: {},
  };
  return {
    ...buildSampleWindowReport(selection.samples),
    capturedSampleCount: samples.length,
    stableWindow: {
      firstIteration: selection.samples[0]?.cycle ?? null,
      lastIteration: selection.samples.at(-1)?.cycle ?? null,
      sampleCount: selection.samples.length,
      minimumSamples: selection.minimumSamples,
      selectionCriteria: selection.selectionCriteria,
      rationale: 'Trailing post-exit samples exclude finite first-entry lazy realization while retaining every later captured point.',
    },
  };
}

function markdownValue(value) {
  if (value === null || value === undefined) return 'unavailable';
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : String(round2(value));
  return String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
}

export function renderLifecycleMarkdown(result) {
  const lines = [
    '# Simplified register lifecycle stress',
    '',
    `- Result: **${result.ok ? 'PASS' : 'FAIL'}**`,
    `- Profile: \`${result.protocol?.profile || 'unknown'}\``,
    `- Viewport: \`${result.protocol?.viewport || 'unknown'}\``,
    `- Requested/completed sales: ${result.protocol?.requestedCycles ?? 0} / ${result.protocol?.completedCycles ?? 0}`,
    `- Elapsed: ${markdownValue(result.timings?.run?.elapsedMs)} ms`,
    '',
    '## Lifecycle cardinalities',
    '',
    '| Lifecycle | Rule | Requested | Completed / observed | Result |',
    '|---|---:|---:|---:|---:|',
  ];
  for (const [name, counter] of Object.entries(result.cardinality || {})) {
    const requested = counter.comparison === 'exact' ? counter.requested : counter.requestedMinimum;
    const observed = [
      counter.completed,
      counter.observedEntries != null ? `entries ${counter.observedEntries}` : null,
      counter.observedExits != null ? `exits ${counter.observedExits}` : null,
      counter.observedOpens != null ? `opens ${counter.observedOpens}` : null,
      counter.observedCloses != null ? `closes ${counter.observedCloses}` : null,
      counter.observedSpawns != null ? `spawns ${counter.observedSpawns}` : null,
      counter.observedRemovals != null ? `removals ${counter.observedRemovals}` : null,
    ].filter((value) => value !== null).join('; ');
    lines.push(`| ${name} | ${counter.comparison} | ${requested} | ${observed} | ${counter.ok ? 'PASS' : 'FAIL'} |`);
  }

  const final = result.finalSample || result.lastSample || null;
  const baseline = result.baseline || result.outsideBaseline || null;
  lines.push(
    '',
    '## Runtime lifecycle counters',
    '',
    '| Metric | Baseline | Final | Delta |',
    '|---|---:|---:|---:|',
  );
  const runtimeRows = [
    ['Window active timeouts', 'timers.activeTimeouts'],
    ['Window active intervals', 'timers.activeIntervals'],
    ['Window active animation frames', 'timers.activeAnimationFrames'],
    ['AnimationMixer instances', 'animationMixers.count'],
    ['AudioContext open', 'audio.openContexts'],
    ['Audio sources created', 'audio.sourcesCreated'],
    ['Audio sources active', 'audio.activeSources'],
    ['Live DOM nodes', 'dom.liveNodes'],
    ['CDP DOM nodes', 'dom.nodes'],
    ['Detached DOM node estimate', 'dom.detachedNodesEstimate'],
    ['CDP JS event listeners', 'dom.jsEventListeners'],
    ['Listener probe net', 'listeners.net'],
    ['Forced-GC heap bytes', 'heap.runtimeUsedBytes'],
  ];
  for (const [label, metric] of runtimeRows) {
    const first = baseline ? getMetric(baseline, metric) : null;
    const last = final ? getMetric(final, metric) : null;
    const delta = first !== null && first !== undefined && last !== null && last !== undefined
      && Number.isFinite(Number(first)) && Number.isFinite(Number(last))
      ? Number(last) - Number(first)
      : null;
    lines.push(`| ${label} | ${markdownValue(first)} | ${markdownValue(last)} | ${markdownValue(delta)} |`);
  }

  lines.push(
    '',
    '## Disposal instrumentation',
    '',
    '| Resource | Observed | Cycle resources | Disposed | Dispose calls | Ephemeral undisposed |',
    '|---|---:|---:|---:|---:|---:|',
  );
  for (const kind of ['geometry', 'material', 'texture']) {
    const entry = result.resourceLifecycle?.resources?.[kind] || {};
    lines.push(`| ${kind} | ${markdownValue(entry.observedCount)} | ${markdownValue(entry.cycleResourceCount)} | ${markdownValue(entry.disposedCount)} | ${markdownValue(entry.disposeCallCount)} | ${markdownValue(entry.ephemeralUndisposedCount)} |`);
  }
  const mixer = result.resourceLifecycle?.animationMixers || { count: 0, updateCalls: 0 };
  lines.push(
    '',
    `AnimationMixer count: **${markdownValue(mixer.count)}**; observed update calls: ${markdownValue(mixer.updateCalls)}.`,
    '',
    '## Timing',
    '',
    '| Scenario | Count | Average ms | P95 ms | Max ms |',
    '|---|---:|---:|---:|---:|',
  );
  for (const [name, timing] of Object.entries(result.timings?.scenarios || {})) {
    lines.push(`| ${name} | ${markdownValue(timing.count)} | ${markdownValue(timing.averageMs)} | ${markdownValue(timing.p95Ms)} | ${markdownValue(timing.maxMs)} |`);
  }
  const failedChecks = result.gates?.checks?.filter((entry) => !entry.ok) || [];
  const informationalStabilityMisses = result.gates?.checks?.filter((entry) => (
    entry.enforced === false && entry.observedOk === false
  )) || [];
  lines.push(
    '',
    '## Diagnostics and gates',
    '',
    `- Console errors: ${result.diagnostics?.consoleErrors?.length || 0}`,
    `- Page errors: ${result.diagnostics?.pageErrors?.length || 0}`,
    `- Non-aborted request failures: ${result.diagnostics?.nonAbortedFailedRequests?.length || 0}`,
    `- Failed gates: ${failedChecks.length}`,
    `- Smoke-only informational stability misses: ${informationalStabilityMisses.length}`,
  );
  for (const check of failedChecks) {
    lines.push(`  - \`${check.id}\`: expected ${markdownValue(JSON.stringify(check.expected))}; got ${markdownValue(JSON.stringify(check.actual))}`);
  }
  for (const check of informationalStabilityMisses) {
    lines.push(`  - informational \`${check.id}\`: expected ${markdownValue(JSON.stringify(check.expected))}; observed ${markdownValue(JSON.stringify(check.actual))}`);
  }
  const capture39 = result.evidence?.longSessionResourceCounts;
  if (capture39) {
    lines.push(
      '',
      '## Capture #39 provenance',
      '',
      `- Requirement: ${markdownValue(capture39.requirement)}`,
      `- Capture status: **${markdownValue(capture39.status)}**`,
      `- Screenshot: \`${markdownValue(capture39.screenshot)}\``,
      `- Overlay: \`${markdownValue(capture39.provenance?.kind)}\` (`
        + `\`${markdownValue(capture39.provenance?.overlayElementId)}\`)`,
      `- Authoritative raw JSON: \`${markdownValue(capture39.authoritativeRawJson)}\``,
      `- Authoritative resource details: \`${markdownValue(capture39.authoritativeResourceDetails)}\``,
      `- Gameplay source modified by overlay: **${capture39.provenance?.gameplaySourceModified ? 'yes' : 'no'}**`,
    );
  }
  if (result.blocker) lines.push('', `Blocker: ${markdownValue(result.blocker.message)}`);
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function writeLifecycleEvidence(result, resourceDetails = null) {
  if (result.evidence?.resourceDetails) {
    const resourceArtifact = resourceDetails || {
      available: false,
      blocker: result.blocker || { message: 'Resource probe was unavailable.' },
    };
    fs.writeFileSync(result.evidence.resourceDetails, `${JSON.stringify(resourceArtifact, null, 2)}\n`);
  }
  fs.writeFileSync(result.evidence.json, `${JSON.stringify(result, null, 2)}\n`);
  fs.writeFileSync(result.evidence.markdown, renderLifecycleMarkdown(result));
}

async function addMetricsOverlay(page, model) {
  const html = renderLongSessionResourceOverlayHtml(model);
  await page.evaluate(({ overlayHtml, provenance }) => {
    document.getElementById('register-lifecycle-metrics')?.remove();
    const panel = document.createElement('div');
    panel.id = provenance.overlayElementId;
    panel.setAttribute('role', 'status');
    panel.setAttribute('aria-label', 'Capture 39 long-session resource counts');
    panel.dataset.qaOnly = 'true';
    panel.dataset.rawJsonAuthoritative = String(provenance.rawJsonAuthoritative);
    panel.dataset.gameplaySourceModified = String(provenance.gameplaySourceModified);
    panel.style.cssText = [
      'position:fixed', 'left:50%', 'top:18px', 'transform:translateX(-50%)',
      'z-index:2147483647', 'box-sizing:border-box',
      'width:calc(100vw - 36px)', 'max-width:1540px', 'max-height:calc(100vh - 36px)',
      'overflow:hidden', 'padding:14px 18px', 'border:2px solid #b9974e',
      'border-radius:12px', 'background:rgba(17,32,25,.94)', 'color:#f4eddb',
      'font:600 12px/1.25 Segoe UI,Arial,sans-serif',
      'box-shadow:0 18px 48px rgba(0,0,0,.42)',
    ].join(';');
    panel.innerHTML = overlayHtml;
    document.body.appendChild(panel);
  }, { overlayHtml: html, provenance: model.provenance });
}

export async function runSimplifiedRegisterLifecycleStress(page, options = {}) {
  const viewport = configureViewport(options.viewport
    || process.env.REGISTER_QA_VIEWPORT
    || process.env.QA_VIEWPORT);
  const config = resolveLifecycleConfig(options);
  const cycles = config.totalSales;
  const requestedCounts = config.counts;
  const salesPlan = buildSalesPlan(requestedCounts);
  const root = path.resolve(options.root || process.env.REGISTER_QA_ROOT
    || 'qa/cashier_master_final/lifecycle/browser');
  fs.mkdirSync(root, { recursive: true });
  const evidencePaths = {
    json: path.join(root, 'lifecycle-result.json'),
    markdown: path.join(root, 'lifecycle-summary.md'),
    resourceDetails: path.join(root, 'lifecycle-resource-details.json'),
    screenshot: path.join(root, 'lifecycle-metrics.png'),
  };

  const diagnostics = {
    consoleErrors: [],
    consoleWarnings: [],
    pageErrors: [],
    failedRequests: [],
    nonAbortedFailedRequests: [],
  };
  page.on('console', (message) => {
    if (message.type() === 'error') diagnostics.consoleErrors.push(message.text());
    if (message.type() === 'warning') diagnostics.consoleWarnings.push(message.text());
  });
  page.on('pageerror', (error) => diagnostics.pageErrors.push(String(error?.stack || error)));
  page.on('requestfailed', (request) => diagnostics.failedRequests.push({
    url: request.url(),
    error: request.failure()?.errorText || 'request failed',
  }));

  let cdp = null;
  let fixture = null;
  let outsideBaseline = null;
  let baseline = null;
  const cyclesRun = [];
  const postCycleSamples = [];
  const transientSamples = [];
  const frontDeskModeSamples = [];
  const frontDeskCycles = [];
  const tickets = [];
  const observedCounts = createObservedCounts();
  let resourceDetails = null;
  let resourceLifecycle = null;
  let lastSample = null;
  let currentScenario = 'boot';
  let currentCycle = 0;
  const runStartedAt = Date.now();
  const buildTimings = () => ({
    run: {
      startedAt: new Date(runStartedAt).toISOString(),
      finishedAt: new Date().toISOString(),
      elapsedMs: Date.now() - runStartedAt,
    },
    scenarios: {
      frontDeskEnterExit: durationSummary(frontDeskCycles.map((entry) => entry.durationMs)),
      allTransactions: durationSummary(cyclesRun.map((entry) => entry.durationMs)),
      cardTransactions: durationSummary(cyclesRun
        .filter((entry) => entry.method === 'card').map((entry) => entry.durationMs)),
      cashTransactions: durationSummary(cyclesRun
        .filter((entry) => entry.method === 'cash').map((entry) => entry.durationMs)),
    },
  });
  const protocolBase = () => ({
    profile: config.profile,
    viewport,
    deviceScaleFactor: 1,
    requestedCycles: cycles,
    completedCycles: cyclesRun.length,
    requestedCounts,
    observedCounts: { ...observedCounts },
    legacyCycles: config.legacyCycles,
    configuration: {
      profile: 'REGISTER_QA_PROFILE=master|smoke|legacy (master is the no-option default)',
      legacy: 'REGISTER_QA_CYCLES=N preserves the prior alternating-sale interface and has no 40-cycle cap',
      individualCountEnvironmentVariables: Object.fromEntries(COUNT_OPTIONS),
    },
    route: 'Fixture code only seeds deterministic customer inventory/payment preference and authorization RNG; front-desk E/Escape, product click, reader X, presented-card click, physical Confirm, retry-card monitor click, customer cash click, and change confirmation all use Playwright keyboard/mouse input.',
    schedule: 'Card and cash sales alternate while both remain; configured X cancellations and genuine decline/replacement-card recoveries are embedded in completed card sales.',
    cleanupBoundary: 'Each transaction clears and its paid customer reaches the physical exit/despawn before the post-cycle sample and next customer spawn.',
    customerCardinality: 'The customer lifecycle is an explicit minimum gate: 100 card + 100 cash sales necessarily create/remove 200 distinct one-sale customers.',
    rendererResidencyBoundary: 'After fixture stock rebuild, one QA-only pre-measurement E/prewarm/Escape pair realizes the rebuilt scene before baselines. Exact operation counters cover only the following measured workload.',
    stabilityGate: config.profile === 'smoke'
      ? 'Smoke runs report every resource/runtime metric and observed stability outcome, but do not enforce long-session range/heap gates before the card/cash lazy warm-up can converge.'
      : 'Long-session scene/resource/DOM/listener/timer/audio/heap stability gates are enforced.',
    metrics: {
      rendererMemory: 'THREE.WebGLRenderer.info.memory',
      uniqueResources: 'weak per-object lifecycle identity counters for exact observed totals plus UUID sets from current live-scene traversal',
      disposal: 'BufferGeometry, Material, and Texture dispose calls intercepted after boot; exact aggregate counts and bounded head/tail event samples are in the separate resource artifact',
      animationMixers: 'unique AnimationMixer instances observed through AnimationMixer.clipAction/update; 0 is emitted explicitly when none are observed',
      timers: 'setTimeout/setInterval/requestAnimationFrame scheduled, fired/cleared, and active counts instrumented from document initialization',
      audio: 'AudioContext construction plus AudioScheduledSourceNode create/start/stop/ended counts instrumented from document initialization where WebAudio is available',
      heap: 'CDP Runtime.getHeapUsage after two HeapProfiler.collectGarbage calls',
      domAndListeners: 'CDP Memory.getDOMCounters plus an EventTarget add/remove net probe installed before front-desk lifecycle work',
    },
  });
  try {
    await installEarlyLifecycleProbe(page);
    await boot(page);
    cdp = await page.context().newCDPSession(page);
    await cdp.send('HeapProfiler.enable');
    await cdp.send('Performance.enable');
    await installListenerProbe(page);
    await installResourceLifecycleProbe(page);
    fixture = await setupFixture(page, cycles);
    currentScenario = 'post-fixture-renderer-warmup';
    fixture.rendererResidencyWarmup = await warmPostFixtureRendererResidency(page);

    currentScenario = 'front-desk-enter-exit';
    outsideBaseline = await snapshot(page, cdp, {
      cycle: 0,
      scenario: currentScenario,
      phase: 'inactive-outside-baseline',
    });
    lastSample = outsideBaseline;
    await markResourcePhase(page, 0, 'inactive-outside-baseline', currentScenario);
    for (let iteration = 1; iteration <= requestedCounts.enterExits; iteration += 1) {
      currentCycle = iteration;
      const startedAt = Date.now();
      await enterFrontDesk(page);
      observedCounts.frontDeskEntries += 1;
      await markResourcePhase(page, iteration, 'active-after-normal-e', currentScenario);
      await leaveFrontDesk(page);
      observedCounts.frontDeskExits += 1;
      await markResourcePhase(page, iteration, 'inactive-after-normal-escape', currentScenario);
      const record = {
        iteration,
        entered: true,
        exited: true,
        durationMs: Date.now() - startedAt,
        sampleIndex: null,
      };
      if (shouldSampleFrontDeskIteration(iteration, requestedCounts.enterExits)) {
        lastSample = await snapshot(page, cdp, {
          cycle: iteration,
          scenario: currentScenario,
          phase: 'post-enter-exit-pair',
        });
        frontDeskModeSamples.push(lastSample);
        record.sampleIndex = frontDeskModeSamples.length - 1;
      }
      frontDeskCycles.push(record);
    }

    currentScenario = 'completed-sales';
    await enterFrontDesk(page);
    baseline = await snapshot(page, cdp, {
      cycle: 0,
      scenario: currentScenario,
      phase: 'active-empty-baseline',
    });
    lastSample = baseline;
    await markResourcePhase(page, 0, 'active-empty-baseline', currentScenario);

    const usage = Object.fromEntries(SKUS.map((skuId) => [skuId, 0]));
    for (const planned of salesPlan) {
      const { cycle, method } = planned;
      currentCycle = cycle;
      const cycleStartedAt = Date.now();
      const skuId = SKUS[(cycle - 1) % SKUS.length];
      await markResourcePhase(page, cycle, 'pre-customer-spawn', currentScenario);
      const fixtureCustomer = await spawnCycleCustomer(page, cycle, method, skuId);
      observedCounts.customerSpawns += 1;
      fixtureCustomer.cycle = cycle;
      const tx = await waitForCycleTransaction(page, fixtureCustomer);
      await page.waitForTimeout(120);
      await markResourcePhase(page, cycle, 'transaction-ready-before-product-click', currentScenario);
      usage[skuId] += 1;
      await scanSingleProduct(page, tx.uid);
      const payment = method === 'card'
        ? await completeCard(page, {
          cancelBeforeAuthorization: planned.cancelBeforeAuthorization,
          declineThenRecover: planned.declineThenRecover,
          onPhase: (phase) => markResourcePhase(page, cycle, phase, currentScenario),
        })
        : await completeCash(page);
      if (payment.cancellationCompleted) observedCounts.preAuthCancellations += 1;
      if (payment.declineRecoveryCompleted) observedCounts.declineRecoveries += 1;
      if (payment.drawerOpened) observedCounts.drawerOpens += 1;
      if (payment.drawerClosed) observedCounts.drawerCloses += 1;

      await page.waitForFunction(() => {
        const register = window.__fw.scene3d.clubhouse().register;
        return ['receipt-print', 'receipt-ready', 'receipt-deliver']
          .includes(register.deliveryPhase());
      }, null, { timeout: 5000, polling: 25 });
      transientSamples.push(await snapshot(page, cdp, {
        cycle,
        scenario: currentScenario,
        phase: 'receipt-and-handoff-live',
        forceGc: false,
      }));
      await markResourcePhase(page, cycle, 'receipt-and-bag-live', currentScenario);
      await page.waitForFunction(() => !window.__fw.scene3d.clubhouse().register.getTx(), null,
        { timeout: 16000 });
      await page.waitForTimeout(120);
      await markResourcePhase(page, cycle, 'transaction-cleared-customer-holds-purchase', currentScenario);
      await page.waitForFunction((customerId) => (
        !(typeof window.__fw.scene3d.clubhouse().customers === 'function'
          ? window.__fw.scene3d.clubhouse().customers()
          : window.__fw.scene3d.clubhouse().customers)
          .some((customer) => customer.customerId === customerId)
      ), fixtureCustomer.customerId, { timeout: 22000 });
      observedCounts.customerRemovals += 1;
      await page.waitForTimeout(260);

      const post = await snapshot(page, cdp, {
        cycle,
        scenario: currentScenario,
        phase: 'post-customer-exit',
      });
      lastSample = post;
      await markResourcePhase(page, cycle, 'post-customer-exit', currentScenario);
      postCycleSamples.push(post);
      const ticket = await page.evaluate((transactionNumber) => {
        const shop = window.__fw.state.shop;
        const found = (shop.transactionHistory || [])
          .find((entry) => Number(entry.number) === Number(transactionNumber));
        return found ? structuredClone(found) : null;
      }, tx.number);
      assert(ticket, `Cycle ${cycle} did not create transaction ticket ${tx.number}.`);
      assert(ticket.method === method && ticket.items?.length === 1,
        `Cycle ${cycle} ticket is not one ${method} item: ${JSON.stringify(ticket)}.`);
      assert(post.state.units === fixture.units + cycle,
        `Cycle ${cycle} banked ${post.state.units - fixture.units} units instead of ${cycle}.`);
      const expectedHistory = Math.min(100, fixture.history + cycle);
      assert(post.state.history === expectedHistory,
        `Cycle ${cycle} retained ${post.state.history} bounded tickets instead of ${expectedHistory}.`);
      assert(post.state.nextTransactionNo === fixture.nextTransactionNo + cycle,
        `Cycle ${cycle} advanced nextTransactionNo to ${post.state.nextTransactionNo} instead of ${fixture.nextTransactionNo + cycle}.`);
      assert(post.state.held === fixture.held,
        `Cycle ${cycle} held inventory did not reset (${fixture.held} -> ${post.state.held}).`);
      assert(post.state.customers === 0 && post.state.txNumber === null
          && post.state.ownerCustomerId === null,
      `Cycle ${cycle} did not release its customer/transaction boundary.`);
      tickets.push(ticket);
      if (method === 'card') observedCounts.cardTransactions += 1;
      else observedCounts.cashTransactions += 1;
      cyclesRun.push({
        ...planned,
        skuId,
        customer: fixtureCustomer,
        transaction: tx,
        payment,
        ticket: {
          number: ticket.number,
          method: ticket.method,
          total: ticket.total,
          itemCount: ticket.items.length,
        },
        observed: {
          customerSpawned: true,
          customerRemoved: true,
          preAuthorizationXCancelled: !!payment.cancellationCompleted,
          declineRecovered: !!payment.declineRecoveryCompleted,
          drawerOpened: !!payment.drawerOpened,
          drawerClosed: !!payment.drawerClosed,
        },
        durationMs: Date.now() - cycleStartedAt,
        transientSampleIndex: transientSamples.length - 1,
        postCycleSampleIndex: postCycleSamples.length - 1,
      });
    }

    for (const skuId of SKUS) {
      const shelf = await page.evaluate((id) => window.__fw.state.shop.inventory[id].shelf, skuId);
      assert(shelf === fixture.shelf[skuId] - usage[skuId],
        `${skuId} shelf stock changed ${fixture.shelf[skuId] - shelf} times; expected ${usage[skuId]}.`);
    }
    const finalSample = postCycleSamples[postCycleSamples.length - 1];
    resourceDetails = await readResourceLifecycleProbe(page);
    resourceLifecycle = summarizeResourceLifecycle(resourceDetails);
    diagnostics.nonAbortedFailedRequests = diagnostics.failedRequests.filter((failure) => (
      !/ERR_ABORTED|NS_BINDING_ABORTED/i.test(failure.error)
    ));
    const stableSelection = selectTrailingStableWindow(postCycleSamples);
    const stableSamples = stableSelection.samples;
    assert(stableSamples.length >= 2, 'Lifecycle run did not produce a two-sample stable window.');
    const cardinality = buildCardinalityReport(requestedCounts, observedCounts);
    const frontDeskLifecycle = buildFrontDeskLifecycleReport(frontDeskModeSamples);
    const gates = buildGates({
      baseline,
      stableSamples,
      transientSamples,
      finalSample,
      cycles,
      fixture,
      tickets,
      diagnostics,
      cardinality,
      salesPlan,
      resourceLifecycle,
      frontDeskLifecycle,
      enforceStability: config.profile !== 'smoke',
    });
    const timings = buildTimings();
    const result = {
      ok: gates.ok,
      blocker: gates.ok ? null : {
        message: gates.checks.filter((entry) => !entry.ok)
          .map((entry) => `${entry.id}: expected ${JSON.stringify(entry.expected)}, got ${JSON.stringify(entry.actual)}`)
          .join('; '),
      },
      protocol: {
        ...protocolBase(),
        baseline: 'front desk active with no transaction, no customer, and organic walk-ins disabled',
        stableWindow: {
          firstCycle: stableSamples[0].cycle,
          lastCycle: stableSamples[stableSamples.length - 1].cycle,
          sampleCount: stableSamples.length,
          minimumSamples: stableSelection.minimumSamples,
          selectionCriteria: stableSelection.selectionCriteria,
          rationale: 'earliest trailing window whose live scene, register, renderer-memory, DOM, and listener ranges meet the declared cleanup tolerances; this excludes finite lazy customer/product realization and authored drawer-stack saturation without ignoring later growth',
        },
      },
      cardinality,
      observedCounts: { ...observedCounts },
      fixture,
      outsideBaseline,
      baseline,
      frontDeskCycles,
      frontDeskModeSamples,
      frontDeskLifecycle,
      cycles: cyclesRun,
      transientSamples,
      postCycleSamples,
      finalSample,
      gates,
      resourceLifecycle,
      timings,
      diagnostics,
      evidence: evidencePaths,
    };
    const overlayModel = buildLongSessionResourceOverlayModel(result);
    result.evidence.longSessionResourceCounts = {
      captureNumber: 39,
      requirement: 'long-session resource counts',
      status: 'pending screenshot capture',
      screenshot: result.evidence.screenshot,
      authoritativeRawJson: result.evidence.json,
      authoritativeResourceDetails: result.evidence.resourceDetails,
      overlayModel,
      provenance: overlayModel.provenance,
    };
    writeLifecycleEvidence(result, resourceDetails);
    await addMetricsOverlay(page, overlayModel);
    await page.screenshot({ path: result.evidence.screenshot });
    result.evidence.longSessionResourceCounts.status = 'captured';
    result.evidence.longSessionResourceCounts.capturedAt = new Date().toISOString();
    writeLifecycleEvidence(result, resourceDetails);
    await leaveFrontDesk(page);
    return result;
  } catch (error) {
    diagnostics.nonAbortedFailedRequests = diagnostics.failedRequests.filter((failure) => (
      !/ERR_ABORTED|NS_BINDING_ABORTED/i.test(failure.error)
    ));
    if (cdp) {
      lastSample = await snapshot(page, cdp, {
        cycle: currentCycle,
        scenario: currentScenario,
        phase: 'failure-last-observable-state',
        forceGc: false,
      }).catch(() => lastSample);
    }
    resourceDetails = resourceDetails || await readResourceLifecycleProbe(page).catch(() => null);
    resourceLifecycle = resourceLifecycle || summarizeResourceLifecycle(resourceDetails);
    const failureScreenshot = path.join(root, 'lifecycle-failure.png');
    await page.screenshot({ path: failureScreenshot }).catch(() => {});
    const cardinality = buildCardinalityReport(requestedCounts, observedCounts);
    const frontDeskLifecycle = buildFrontDeskLifecycleReport(frontDeskModeSamples);
    const result = {
      ok: false,
      blocker: {
        cycle: currentCycle,
        scenario: currentScenario,
        message: error?.message || String(error),
        stack: error?.stack || null,
      },
      protocol: protocolBase(),
      cardinality,
      observedCounts: { ...observedCounts },
      fixture,
      outsideBaseline,
      baseline,
      frontDeskCycles,
      frontDeskModeSamples,
      frontDeskLifecycle,
      cycles: cyclesRun,
      transientSamples,
      postCycleSamples,
      finalSample: lastSample,
      gates: null,
      resourceLifecycle,
      timings: buildTimings(),
      diagnostics,
      evidence: {
        ...evidencePaths,
        screenshot: failureScreenshot,
      },
    };
    writeLifecycleEvidence(result, resourceDetails);
    return result;
  }
}
