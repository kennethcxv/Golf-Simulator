import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  buildCardinalityReport,
  buildLongSessionResourceOverlayModel,
  compactLifecycleResourceDetails,
  renderLongSessionResourceOverlayHtml,
  renderLifecycleMarkdown,
  resolveLifecycleConfig,
} from '../tools/qa/simplified-register-lifecycle-stress.mjs';

test('lifecycle runner brackets the exact browser route with immutable build snapshots', () => {
  const source = fs.readFileSync(
    new URL('../tools/qa/simplified-register-lifecycle-stress.js', import.meta.url),
    'utf8',
  );
  const before = source.indexOf('writeCashierBuildSnapshotFile({ outputPath: buildBefore })');
  const route = source.indexOf('runSimplifiedRegisterLifecycleStress(page');
  const after = source.indexOf('writeCashierBuildSnapshotFile({ outputPath: buildAfter })');

  assert.ok(before >= 0 && route > before && after > route,
    'build-before must precede the browser route and build-after must follow it');
  assert.match(source, /finally \{/,
    'the after snapshot must survive a browser-route failure');
  assert.match(source, /Lifecycle evidence root must be fresh; refusing to overwrite/,
    'authoritative evidence must never silently replace an earlier run');
  assert.match(source, /process\.env\.QA_RESULT_PATH = runnerResult/,
    'the byte-identical runner result must be written into the bracketed root');
});

test('browser resource instrumentation is memory-neutral while preserving exact counters', () => {
  const source = fs.readFileSync(
    new URL('../tools/qa/simplified-register-lifecycle-stress.mjs', import.meta.url),
    'utf8',
  );

  assert.match(source, /observed: new WeakSet\(\)/);
  assert.match(source, /disposed: new WeakSet\(\)/);
  assert.match(source, /cycleSeen: new WeakSet\(\)/);
  assert.match(source, /state\.cycleResourceCount \+= 1/);
  assert.match(source, /delete state\.entries\[this\.uuid\]/,
    'disposed resource metadata must not be retained strongly for the entire session');
  assert.match(source, /if \(probe\.phaseMarks\.length > 512\) probe\.phaseMarks\.splice\(256, 1\)/,
    'phase evidence must retain deterministic first/last windows instead of every raw mark');
  assert.match(source, /Weak identity sets plus exact counters/);
  assert.doesNotMatch(source, /disposalEvents: \{ geometry: \[\], material: \[\], texture: \[\] \}/,
    'the browser probe must not rebuild an unbounded global disposal-event ledger');
});

test('resource evidence stays bounded without weakening exact aggregate counts', () => {
  const makeResource = (index, disposeCalls = 1) => ({
    uuid: `resource-${index}`,
    resourceKind: 'geometry',
    type: 'BufferGeometry',
    resourceNames: [`resource-${index}`],
    names: [`object-${index}`],
    kinds: ['customer'],
    from: ['lifecycle'],
    ancestry: ['customer < clubhouse'],
    iterations: Array.from({ length: 20 }, (_, iteration) => `sale:${iteration}`),
    cycles: Array.from({ length: 20 }, (_, iteration) => `sale:${iteration}`),
    firstSeen: { scenario: 'sale', iteration: index + 1, phase: 'customer-ready' },
    lastSeen: { scenario: 'sale', iteration: index + 1, phase: 'complete' },
    disposeCalls,
    disposeEvents: Array.from({ length: 12 }, (_, event) => ({
      uuid: `resource-${index}`,
      resourceKind: 'geometry',
      type: 'BufferGeometry',
      scenario: 'sale',
      iteration: index + 1,
      phase: `dispose-${event}`,
    })),
    liveAtEnd: false,
  });
  const cycleResources = Array.from({ length: 30 }, (_, index) => makeResource(index));
  cycleResources[17] = makeResource(17, 0);
  const disposalEvents = cycleResources.flatMap((resource) => resource.disposeEvents);
  const changeItems = Array.from({ length: 18 }, (_, index) => ({ uuid: `change-${index}` }));
  const phaseMarks = Array.from({ length: 14 }, (_, index) => ({
    scenario: 'sale',
    iteration: index,
    phase: 'complete',
    changes: Object.fromEntries(['geometry', 'material', 'texture'].map((kind) => [kind, {
      liveCount: 10,
      added: changeItems,
      removed: changeItems,
      disposalEventCount: disposalEvents.length,
    }])),
  }));
  const details = {
    phaseMarkCount: 14,
    phaseMarks,
    resources: Object.fromEntries(['geometry', 'material', 'texture'].map((kind) => [kind, {
      observedCount: 42,
      liveAtEndCount: 12,
      disposedCount: 29,
      disposeCallCount: disposalEvents.length,
      disposalEventCount: disposalEvents.length,
      cycleResourceCount: cycleResources.length,
      ephemeralUndisposedCount: 1,
      ephemeralUndisposedGroups: [{
        signature: `${kind}-leak`,
        count: 1,
        uuids: ['resource-17'],
        iterations: ['sale:17'],
        firstSeenPhases: ['customer-ready'],
      }],
      cycleResources,
      disposalEvents,
    }])),
    animationMixers: { count: 0, updateCalls: 0 },
  };

  const compacted = compactLifecycleResourceDetails(details, {
    phaseMarks: 4,
    phaseChangeItems: 3,
    cycleResourcesPerKind: 6,
    disposalEventsPerKind: 5,
    resourceIterations: 4,
    resourceDisposalEvents: 2,
  });

  assert.equal(compacted.phaseMarkCount, 14);
  assert.equal(compacted.phaseMarks.length, 4);
  assert.equal(compacted.compaction.phaseMarks.omittedCount, 10);
  assert.equal(compacted.resources.geometry.observedCount, 42);
  assert.equal(compacted.resources.geometry.cycleResourceCount, 30);
  assert.equal(compacted.resources.geometry.disposalEventCount, 360);
  assert.equal(compacted.resources.geometry.cycleResources.length, 6);
  assert.ok(compacted.resources.geometry.cycleResources.some((entry) => entry.uuid === 'resource-17'),
    'the undisposed resource should be prioritized in the bounded sample');
  assert.equal(compacted.resources.geometry.disposalEvents.length, 5);
  assert.equal(compacted.resources.geometry.cycleResources[0].iterations.length <= 4, true);
  assert.equal(compacted.phaseMarks[0].changes.geometry.added.length, 3);
  assert.equal(compacted.phaseMarks[0].changes.geometry.addedCount, 18);
  assert.doesNotThrow(() => JSON.stringify(compacted));
});

function makeMasterOverlayResult() {
  const requested = resolveLifecycleConfig({}, {}).counts;
  const observed = {
    frontDeskEntries: 100,
    frontDeskExits: 100,
    cardTransactions: 100,
    cashTransactions: 100,
    preAuthCancellations: 50,
    declineRecoveries: 50,
    drawerOpens: 100,
    drawerCloses: 100,
    customerSpawns: 200,
    customerRemovals: 200,
  };
  const summary = (last, delta, range) => ({ last, delta, range });
  return {
    ok: true,
    protocol: {
      profile: 'master',
      viewport: '1600x900',
      requestedCycles: 200,
      completedCycles: 200,
      stableWindow: { firstCycle: 161, lastCycle: 200, sampleCount: 40 },
    },
    cardinality: buildCardinalityReport(requested, observed),
    fixture: { units: 40 },
    cycles: Array.from({ length: 200 }, (_, index) => ({ cycle: index + 1 })),
    finalSample: {
      scene: { nodes: 1480, geometries: 310, materials: 72, textures: 58 },
      renderer: { memory: { geometries: 315, textures: 61 } },
      listeners: { net: 12 },
      animationMixers: { count: 0 },
      timers: { activeTimeouts: 2, activeIntervals: 1, activeAnimationFrames: 1 },
      dom: { liveNodes: 180, nodes: 195, detachedNodesEstimate: 2, jsEventListeners: 44 },
      heap: { runtimeUsedBytes: 125829120 },
      audio: { openContexts: 1, activeSources: 0 },
      state: { units: 240, held: 0 },
    },
    gates: {
      stabilityEnforced: true,
      checks: [
        { id: 'scene.nodes-range', ok: true },
        { id: 'forced-gc-heap-growth', ok: true },
        { id: 'completed-cycle-count', ok: true },
      ],
      summaries: {
        'scene.nodes': summary(1480, 0, 2),
        'scene.geometries': summary(310, 0, 0),
        'scene.materials': summary(72, 0, 0),
        'scene.textures': summary(58, 0, 0),
        'renderer.memory.geometries': summary(315, 0, 0),
        'renderer.memory.textures': summary(61, 0, 0),
        'listeners.net': summary(12, 0, 0),
        'dom.jsEventListeners': summary(44, 0, 1),
        'dom.liveNodes': summary(180, 0, 1),
        'dom.nodes': summary(195, 1, 2),
        'dom.detachedNodesEstimate': summary(2, 0, 0),
      },
      runtimeSummaries: {
        'animationMixers.count': summary(0, 0, 0),
        'timers.activeTimeouts': summary(2, 0, 1),
        'timers.activeIntervals': summary(1, 0, 0),
        'timers.activeAnimationFrames': summary(1, 0, 0),
        'audio.openContexts': summary(1, 0, 0),
        'audio.activeSources': summary(0, 0, 0),
      },
      heap: { growthBytes: 1572864, slopeBytesPerCycle: 1024 },
    },
    evidence: {
      json: 'lifecycle-result.json',
      resourceDetails: 'lifecycle-resource-details.json',
      screenshot: 'lifecycle-metrics.png',
    },
  };
}

test('lifecycle stress defaults to the complete master cardinalities', () => {
  const config = resolveLifecycleConfig({}, {});
  assert.equal(config.profile, 'master');
  assert.equal(config.totalSales, 200);
  assert.deepEqual(config.counts, {
    enterExits: 100,
    cardTransactions: 100,
    cashTransactions: 100,
    preAuthCancellations: 50,
    declineRecoveries: 50,
    drawerOpenCloses: 100,
    customerSpawnRemovalsMinimum: 100,
  });
});

test('smoke profile keeps every lifecycle branch while using low counts', () => {
  const config = resolveLifecycleConfig({ profile: 'smoke' }, {});
  assert.equal(config.profile, 'smoke');
  assert.equal(config.totalSales, 4);
  assert.deepEqual(config.counts, {
    enterExits: 2,
    cardTransactions: 2,
    cashTransactions: 2,
    preAuthCancellations: 1,
    declineRecoveries: 1,
    drawerOpenCloses: 2,
    customerSpawnRemovalsMinimum: 2,
  });
});

test('legacy cycle override remains alternating and no longer has a 40-cycle cap', () => {
  const config = resolveLifecycleConfig({ cycles: 201 }, {});
  assert.equal(config.profile, 'legacy');
  assert.equal(config.legacyCycles, 201);
  assert.equal(config.totalSales, 201);
  assert.equal(config.counts.cardTransactions, 101);
  assert.equal(config.counts.cashTransactions, 100);
  assert.equal(config.counts.drawerOpenCloses, 100);
  assert.equal(config.counts.preAuthCancellations, 0);
  assert.equal(config.counts.declineRecoveries, 0);
});

test('individual lifecycle counts are configurable and enforce physical invariants', () => {
  const config = resolveLifecycleConfig({
    counts: {
      enterExits: 3,
      cardTransactions: 3,
      cashTransactions: 2,
      preAuthCancellations: 2,
      declineRecoveries: 1,
      drawerOpenCloses: 2,
      customerSpawnRemovalsMinimum: 4,
    },
  }, {});
  assert.equal(config.totalSales, 5);
  assert.throws(() => resolveLifecycleConfig({
    profile: 'smoke',
    drawerOpenCloses: 1,
  }, {}), /must equal cashTransactions/);
  assert.throws(() => resolveLifecycleConfig({
    profile: 'smoke',
    preAuthCancellations: 3,
  }, {}), /cannot exceed card transactions/);
});

test('cardinality report is exact except for the honest customer minimum', () => {
  const requested = resolveLifecycleConfig({}, {}).counts;
  const observed = {
    frontDeskEntries: 100,
    frontDeskExits: 100,
    cardTransactions: 100,
    cashTransactions: 100,
    preAuthCancellations: 50,
    declineRecoveries: 50,
    drawerOpens: 100,
    drawerCloses: 100,
    customerSpawns: 200,
    customerRemovals: 200,
  };
  const report = buildCardinalityReport(requested, observed);
  assert.ok(Object.values(report).every((entry) => entry.ok));
  assert.equal(report.customerSpawnsRemovals.comparison, 'at-least');
  assert.equal(report.customerSpawnsRemovals.requestedMinimum, 100);
  assert.equal(report.customerSpawnsRemovals.completed, 200);
  assert.equal(report.cardTransactions.comparison, 'exact');

  const mismatched = buildCardinalityReport(requested, { ...observed, drawerOpens: 101 });
  assert.equal(mismatched.drawerOpenCloses.ok, false,
    'an extra drawer opening must not be hidden by the completed-pair minimum');
});

test('Markdown evidence includes cardinalities and explicit zero AnimationMixer count', () => {
  const requested = resolveLifecycleConfig({ profile: 'smoke' }, {}).counts;
  const observed = {
    frontDeskEntries: 2,
    frontDeskExits: 2,
    cardTransactions: 2,
    cashTransactions: 2,
    preAuthCancellations: 1,
    declineRecoveries: 1,
    drawerOpens: 2,
    drawerCloses: 2,
    customerSpawns: 4,
    customerRemovals: 4,
  };
  const markdown = renderLifecycleMarkdown({
    ok: true,
    protocol: {
      profile: 'smoke',
      viewport: '1600x900',
      requestedCycles: 4,
      completedCycles: 4,
    },
    cardinality: buildCardinalityReport(requested, observed),
    timings: { run: { elapsedMs: 1000 }, scenarios: {} },
    resourceLifecycle: {
      resources: {
        geometry: {},
        material: {},
        texture: {},
      },
      animationMixers: { count: 0, updateCalls: 0 },
    },
    diagnostics: {},
  });
  assert.match(markdown, /preAuthorizationXCancellations/);
  assert.match(markdown, /customerSpawnsRemovals \| at-least \| 2 \| 4/);
  assert.match(markdown, /AnimationMixer count: \*\*0\*\*/);
});

test('Capture #39 model preserves exact operations, final resources, and stable deltas', () => {
  const model = buildLongSessionResourceOverlayModel(makeMasterOverlayResult());
  const operation = (id) => model.exactOperations.find((entry) => entry.id === id);

  assert.equal(model.captureNumber, 39);
  assert.equal(model.result, 'PASS');
  assert.deepEqual(operation('completedSales'), {
    id: 'completedSales',
    label: 'Completed sales',
    comparison: 'exact',
    requested: 200,
    completed: 200,
    observedEntries: null,
    observedExits: null,
    observedOpens: null,
    observedCloses: null,
    observedSpawns: null,
    observedRemovals: null,
    ok: true,
  });
  assert.equal(operation('frontDeskEnterExits').observedEntries, 100);
  assert.equal(operation('frontDeskEnterExits').observedExits, 100);
  assert.equal(operation('customerSpawnsRemovals').requested, 100);
  assert.equal(operation('customerSpawnsRemovals').completed, 200);
  assert.equal(operation('customerSpawnsRemovals').observedSpawns, 200);
  assert.equal(operation('customerSpawnsRemovals').observedRemovals, 200);
  assert.deepEqual(model.resources.sceneNodes, {
    path: 'scene.nodes', final: 1480, stableDelta: 0, stableRange: 2,
  });
  assert.equal(model.resources.geometries.renderer.final, 315);
  assert.equal(model.resources.materials.final, 72);
  assert.equal(model.resources.textures.renderer.final, 61);
  assert.equal(model.resources.listeners.cdp.stableRange, 1);
  assert.equal(model.resources.mixers.final, 0);
  assert.equal(model.resources.timers.animationFrames.final, 1);
  assert.equal(model.resources.dom.detachedEstimate.final, 2);
  assert.equal(model.resources.heap.finalBytes, 125829120);
  assert.equal(model.resources.heap.stableDeltaBytes, 1572864);
  assert.equal(model.exactOnce.units, 200);
  assert.equal(model.exactOnce.tickets, 200);
  assert.deepEqual(model.gates, {
    passed: 3, total: 3, failed: 0, stabilityEnforced: true,
  });
  assert.equal(model.provenance.kind, 'qa-only DOM overlay');
  assert.equal(model.provenance.rawJsonAuthoritative, true);
  assert.equal(model.provenance.gameplaySourceModified, false);
  assert.equal(model.provenance.authoritativeRawJson, 'lifecycle-result.json');
});

test('Capture #39 overlay visibly labels every required count and its QA provenance', () => {
  const model = buildLongSessionResourceOverlayModel(makeMasterOverlayResult());
  const html = renderLongSessionResourceOverlayHtml(model);

  for (const label of [
    'Capture #39',
    'PASS',
    'Completed sales',
    'Desk enter / exit',
    'Customer spawn / removal',
    'Scene nodes',
    'Geometries scene / GPU',
    'Materials',
    'Textures scene / GPU',
    'Listeners net / CDP',
    'AnimationMixers',
    'Timers timeout / interval / rAF',
    'DOM live / CDP / detached',
    'Forced-GC heap',
    'Final count | stable delta | stable range',
    'qa-only DOM overlay',
    'lifecycle-result.json is authoritative',
    'gameplay source unchanged',
  ]) {
    assert.ok(html.includes(label), `overlay should visibly include "${label}"`);
  }
  assert.match(html, /200 \/ 200/);
  assert.match(html, /target &gt;= 100/);
  assert.match(html, /120\.00 MiB \| delta \+1\.50 MiB/);
});

test('Markdown records Capture #39 screenshot and raw-authority provenance', () => {
  const result = makeMasterOverlayResult();
  const model = buildLongSessionResourceOverlayModel(result);
  result.evidence.longSessionResourceCounts = {
    requirement: 'long-session resource counts',
    status: 'captured',
    screenshot: result.evidence.screenshot,
    authoritativeRawJson: result.evidence.json,
    authoritativeResourceDetails: result.evidence.resourceDetails,
    provenance: model.provenance,
  };
  const markdown = renderLifecycleMarkdown(result);

  assert.match(markdown, /## Capture #39 provenance/);
  assert.match(markdown, /Capture status: \*\*captured\*\*/);
  assert.match(markdown, /Overlay: `qa-only DOM overlay`/);
  assert.match(markdown, /Authoritative raw JSON: `lifecycle-result\.json`/);
  assert.match(markdown, /Gameplay source modified by overlay: \*\*no\*\*/);
});
