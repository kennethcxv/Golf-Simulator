import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  SHEET06_ASSEMBLY_ASSETS,
  SHEET06_FLOOR_VARIANT_BY_FINISH,
  SHEET06_PRODUCTION_MOUNTS,
  SHEET06_STATE_LIFECYCLE_CYCLES,
  SHEET06_TEMPLATE_ASSETS,
  evaluateSheet06StateLifecycle,
  sheet06LifecycleTarget,
} from '../tools/qa/sheet06-state-lifecycle-contract.mjs';
import {
  ensureClubhouseArchitecture,
  setMainDoorState,
  updateArchitectureComponent,
} from '../src/sim/clubhouseRestoration.js';
import { deserialize, newGame, serialize } from '../src/sim/state.js';

const listenerCensus = Object.freeze({
  available: true,
  total: 7,
  byTargetAndType: Object.freeze({
    'document:pointerlockchange:bubble:active:persistent': 1,
    'game:click:bubble:active:persistent': 1,
    'window:keydown:bubble:active:persistent': 3,
    'window:keyup:bubble:active:persistent': 2,
  }),
  errors: Object.freeze([]),
});

function architectureFor(target) {
  return {
    version: 1,
    components: {
      shell: { restored: false, finish: 'warm-cream' },
      porch: { restored: false, finish: 'natural-oak' },
      windows: { ...target.components.windows },
      panels: { ...target.components.panels },
      trim: { restored: false, finish: 'warm-cream' },
      ceiling: { ...target.components.ceiling },
      floor: { ...target.components.floor },
    },
    doors: { main: { left: target.door, right: target.door } },
  };
}

function productionFor(target) {
  return {
    activationStatus: 'active',
    activationError: null,
    actualSharedGameIntegrated: true,
    loadedAssetCount: 10,
    assembledKitCount: 6,
    glbCollisionObjectsActivated: 0,
    hiddenFallbackCount: 7,
    navigation: {
      active: true,
      runtimeNavigationAuthority: 'ANALYTIC_LAYOUT',
      glbNavigationAuthority: 'NONE',
      glbCollisionObjectsActivated: 0,
      railColliderCount: 2,
    },
    door: {
      authoredBound: true,
      authoredPivotCount: 2,
      proceduralFallbackVisible: false,
      leafCount: 2,
      colliderCount: 2,
      leftState: target.door,
      rightState: target.door,
    },
    assembly: {
      floor: {
        selectedVariant: SHEET06_FLOOR_VARIANT_BY_FINISH[target.components.floor.finish],
      },
      kits: SHEET06_ASSEMBLY_ASSETS.map((assetNumber) => ({
        assetNumber,
        status: 'assembled',
        instanceCount: assetNumber === 56 ? 65 : 5,
      })),
    },
  };
}

function rootsFor(sheet06NodeCount = 347) {
  return {
    templateRootCount: 10,
    assemblyRootCount: 6,
    uniqueTemplateUuidCount: 10,
    uniqueAssemblyUuidCount: 6,
    templateSceneOccurrences: SHEET06_TEMPLATE_ASSETS.map((assetNumber) => ({
      assetNumber,
      uuid: `template-${assetNumber}`,
      occurrences: 1,
    })),
    assemblySceneOccurrences: SHEET06_ASSEMBLY_ASSETS.map((assetNumber) => ({
      assetNumber,
      uuid: `assembly-${assetNumber}`,
      occurrences: 1,
    })),
    mountNameCounts: Object.fromEntries(SHEET06_PRODUCTION_MOUNTS.map((name) => [name, 1])),
    assemblyNameCounts: Object.fromEntries(SHEET06_ASSEMBLY_ASSETS.map(
      (assetNumber) => [`SHEET06_ASSET_${assetNumber}_PRODUCTION_ASSEMBLY`, 1],
    )),
    sheet06NodeCount,
    sceneNodeCount: 4196,
  };
}

function snapshotFor(target) {
  const panelsRestored = target.components.panels.restored;
  return {
    architecture: architectureFor(target),
    production: productionFor(target),
    roots: rootsFor(),
    forwarding: {
      windows: {
        ...target.components.windows,
        brokenStates: [
          !target.components.windows.restored,
          !target.components.windows.restored,
          !target.components.windows.restored,
          !target.components.windows.restored,
        ],
      },
      panels: {
        ...target.components.panels,
        instanceCount: 65,
        damageOverlays: {
          objectCount: 2,
          visibleObjectCount: panelsRestored ? 0 : 2,
        },
      },
      ceiling: { ...target.components.ceiling },
      floor: {
        ...target.components.floor,
        selectedVariant: SHEET06_FLOOR_VARIANT_BY_FINISH[target.components.floor.finish],
        damageVisible: !target.components.floor.restored,
        damageSiteCount: 5,
        visibleVariantCounts: [1, 1, 1, 1, 1],
      },
    },
    listeners: listenerCensus,
  };
}

function validCycles() {
  return Array.from({ length: SHEET06_STATE_LIFECYCLE_CYCLES }, (_, cycleIndex) => {
    const target = sheet06LifecycleTarget(cycleIndex);
    return {
      cycleIndex,
      target,
      control: cycleIndex < 2
        ? {
          mode: 'normal-keyboard-e',
          ok: true,
          persistedDoorState: { left: target.door, right: target.door },
        }
        : { mode: 'documented-state-fixture', ok: true },
      autosaveArchitecture: architectureFor(target),
      beforeSave: snapshotFor(target),
      afterReload: snapshotFor(target),
    };
  });
}

test('Sheet-6 lifecycle contract accepts ten exact save/reload cycles with stable roots and listeners', () => {
  const report = evaluateSheet06StateLifecycle({ cycles: validCycles() });
  assert.equal(report.ok, true, JSON.stringify(report.failedChecks, null, 2));
  assert.equal(report.observedCycles, 10);
  assert.deepEqual(report.summary.sheet06NodeCounts, Array(10).fill(347));
  assert.equal(report.summary.openCycles, 5);
  assert.equal(report.summary.closedCycles, 5);
});

test('Sheet-6 lifecycle contract rejects duplicate roots, collision drift, visible fallbacks, and growth', () => {
  const cycles = structuredClone(validCycles());
  cycles[4].afterReload.roots.assemblySceneOccurrences[0].occurrences = 2;
  cycles[5].afterReload.production.glbCollisionObjectsActivated = 1;
  cycles[5].afterReload.production.navigation.railColliderCount = 1;
  cycles[6].afterReload.production.hiddenFallbackCount = 6;
  cycles[7].afterReload.roots.sheet06NodeCount += 1;
  cycles[8].afterReload.listeners = structuredClone(cycles[8].afterReload.listeners);
  cycles[8].afterReload.listeners.byTargetAndType['window:resize:bubble:active:persistent'] = 1;
  cycles[9].afterReload.forwarding.floor.damageSiteCount = 6;

  const report = evaluateSheet06StateLifecycle({ cycles });
  assert.equal(report.ok, false);
  const failed = new Set(report.failedChecks.map((check) => check.id));
  assert.ok(failed.has('cycle-5:after-reload:unique-attached-roots'));
  assert.ok(failed.has('cycle-6:after-reload:collision-authority'));
  assert.ok(failed.has('cycle-7:after-reload:fallbacks-hidden'));
  assert.ok(failed.has('no-sheet06-node-growth-across-reloads'));
  assert.ok(failed.has('no-listener-growth-across-reloads'));
  assert.ok(failed.has('cycle-10:after-reload:sparse-floor-damage-toggle'));
});

test('all ten architecture and two-leaf door targets survive the real state serializer', () => {
  let state = newGame('relaxed', 605106);
  for (let cycleIndex = 0; cycleIndex < SHEET06_STATE_LIFECYCLE_CYCLES; cycleIndex += 1) {
    const target = sheet06LifecycleTarget(cycleIndex);
    for (const [component, value] of Object.entries(target.components)) {
      const result = updateArchitectureComponent(state, component, value);
      assert.equal(result.ok, true, `${component} mutation failed in cycle ${cycleIndex + 1}`);
    }
    assert.equal(setMainDoorState(state, target.door).ok, true);
    state = deserialize(serialize(state));
    const architecture = ensureClubhouseArchitecture(state);
    for (const [component, value] of Object.entries(target.components)) {
      assert.deepEqual(architecture.components[component], value);
    }
    assert.deepEqual(
      architecture.doors.main,
      { left: target.door, right: target.door },
      `two-leaf state survives cycle ${cycleIndex + 1}`,
    );
  }
});

test('browser driver is pinned to the game autosave, Continue, normal E, and CDP listener census', () => {
  const source = readFileSync(
    new URL('../tools/qa/sheet06-state-lifecycle-qa.js', import.meta.url),
    'utf8',
  );
  assert.match(source, /app\.autosave\(\)/);
  assert.match(source, /golfempire:autosave/);
  assert.match(source, /getByText\('Continue'/);
  assert.match(source, /page\.keyboard\.press\('e'\)/);
  assert.match(source, /DOMDebugger\.getEventListeners/);
  assert.match(source, /page\.reload/);
});

test('cycle target rejects unsafe indices', () => {
  assert.throws(() => sheet06LifecycleTarget(-1), /non-negative integer/);
  assert.throws(() => sheet06LifecycleTarget(1.5), /non-negative integer/);
});
