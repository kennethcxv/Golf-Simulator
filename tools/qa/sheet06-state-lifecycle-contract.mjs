export const SHEET06_STATE_LIFECYCLE_SCHEMA_VERSION = 1;
export const SHEET06_STATE_LIFECYCLE_CYCLES = 10;

export const SHEET06_TEMPLATE_ASSETS = Object.freeze([
  51, 52, 53, 54, 55, 56, 57, 58, 59, 60,
]);

export const SHEET06_ASSEMBLY_ASSETS = Object.freeze([55, 56, 57, 58, 59, 60]);

export const SHEET06_PRODUCTION_MOUNTS = Object.freeze([
  'SHEET06_PRODUCTION_EXTERIOR_STAGING',
  'SHEET06_PRODUCTION_INTERIOR_STAGING',
  'SHEET06_PRODUCTION_EXTERIOR_LIVE',
  'SHEET06_PRODUCTION_INTERIOR_LIVE',
]);

export const SHEET06_FLOOR_VARIANT_BY_FINISH = Object.freeze({
  'natural-oak': 'oak',
  'medium-walnut': 'walnut',
  'muted-sage-carpet': 'sage_carpet',
  'warm-cream-tile': 'cream_tile',
});

const WINDOWS_FINISHES = Object.freeze(['deep-golf-green', 'warm-charcoal']);
const PANELS_FINISHES = Object.freeze(['muted-sage', 'medium-walnut', 'warm-cream']);
const CEILING_FINISHES = Object.freeze(['warm-cream', 'natural-oak']);
const FLOOR_FINISHES = Object.freeze([
  'natural-oak',
  'medium-walnut',
  'muted-sage-carpet',
  'warm-cream-tile',
]);

function immutable(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) immutable(child);
  return Object.freeze(value);
}

export function sheet06LifecycleTarget(cycleIndex) {
  if (!Number.isInteger(cycleIndex) || cycleIndex < 0) {
    throw new TypeError('Sheet-6 lifecycle cycleIndex must be a non-negative integer.');
  }
  const open = cycleIndex % 2 === 0;
  return immutable({
    cycleIndex,
    door: open ? 'open' : 'closed',
    components: {
      windows: {
        restored: cycleIndex % 2 === 0,
        finish: WINDOWS_FINISHES[cycleIndex % WINDOWS_FINISHES.length],
      },
      panels: {
        restored: cycleIndex % 3 === 1,
        finish: PANELS_FINISHES[cycleIndex % PANELS_FINISHES.length],
      },
      ceiling: {
        restored: cycleIndex % 2 === 0,
        finish: CEILING_FINISHES[cycleIndex % CEILING_FINISHES.length],
      },
      floor: {
        restored: cycleIndex % 2 === 1,
        finish: FLOOR_FINISHES[cycleIndex % FLOOR_FINISHES.length],
      },
    },
  });
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function targetArchitecture(target) {
  return {
    components: target.components,
    doors: { main: { left: target.door, right: target.door } },
  };
}

function architectureProjection(architecture) {
  if (!architecture) return null;
  return {
    components: {
      windows: architecture.components?.windows,
      panels: architecture.components?.panels,
      ceiling: architecture.components?.ceiling,
      floor: architecture.components?.floor,
    },
    doors: {
      main: {
        left: architecture.doors?.main?.left,
        right: architecture.doors?.main?.right,
      },
    },
  };
}

function countsAreOne(values, expectedKeys) {
  return expectedKeys.every((key) => Number(values?.[key]) === 1);
}

function sortedListenerSignature(listenerCensus) {
  if (listenerCensus?.available !== true) return null;
  return JSON.stringify(Object.entries(listenerCensus.byTargetAndType || {})
    .sort(([left], [right]) => left.localeCompare(right)));
}

function addCheck(checks, id, ok, actual, expected = undefined) {
  checks.push({ id, ok: Boolean(ok), actual, ...(expected === undefined ? {} : { expected }) });
}

function validateSnapshot(checks, snapshot, target, prefix) {
  const expectedArchitecture = targetArchitecture(target);
  const architecture = architectureProjection(snapshot?.architecture);
  addCheck(
    checks,
    `${prefix}:architecture-forwarded`,
    sameJson(architecture, expectedArchitecture),
    architecture,
    expectedArchitecture,
  );

  const production = snapshot?.production;
  addCheck(
    checks,
    `${prefix}:production-active`,
    production?.activationStatus === 'active' && production?.actualSharedGameIntegrated === true,
    {
      activationStatus: production?.activationStatus,
      actualSharedGameIntegrated: production?.actualSharedGameIntegrated,
      activationError: production?.activationError ?? null,
    },
    { activationStatus: 'active', actualSharedGameIntegrated: true, activationError: null },
  );
  addCheck(
    checks,
    `${prefix}:asset-and-kit-counts`,
    production?.loadedAssetCount === SHEET06_TEMPLATE_ASSETS.length
      && production?.assembledKitCount === SHEET06_ASSEMBLY_ASSETS.length,
    {
      loadedAssetCount: production?.loadedAssetCount,
      assembledKitCount: production?.assembledKitCount,
    },
    { loadedAssetCount: 10, assembledKitCount: 6 },
  );
  addCheck(
    checks,
    `${prefix}:fallbacks-hidden`,
    production?.hiddenFallbackCount === 7
      && production?.door?.proceduralFallbackVisible === false,
    {
      hiddenFallbackCount: production?.hiddenFallbackCount,
      proceduralDoorFallbackVisible: production?.door?.proceduralFallbackVisible,
    },
    { hiddenFallbackCount: 7, proceduralDoorFallbackVisible: false },
  );
  addCheck(
    checks,
    `${prefix}:collision-authority`,
    production?.glbCollisionObjectsActivated === 0
      && production?.door?.colliderCount === 2
      && production?.door?.leafCount === 2
      && production?.door?.authoredPivotCount === 2
      && production?.door?.authoredBound === true
      && production?.navigation?.active === true
      && production?.navigation?.runtimeNavigationAuthority === 'ANALYTIC_LAYOUT'
      && production?.navigation?.glbNavigationAuthority === 'NONE'
      && production?.navigation?.glbCollisionObjectsActivated === 0
      && production?.navigation?.railColliderCount === 2,
    {
      glbCollisionObjectsActivated: production?.glbCollisionObjectsActivated,
      colliderCount: production?.door?.colliderCount,
      leafCount: production?.door?.leafCount,
      authoredPivotCount: production?.door?.authoredPivotCount,
      authoredBound: production?.door?.authoredBound,
      navigation: production?.navigation,
    },
    {
      glbCollisionObjectsActivated: 0,
      colliderCount: 2,
      leafCount: 2,
      authoredPivotCount: 2,
      authoredBound: true,
      navigation: {
        active: true,
        runtimeNavigationAuthority: 'ANALYTIC_LAYOUT',
        glbNavigationAuthority: 'NONE',
        glbCollisionObjectsActivated: 0,
        railColliderCount: 2,
      },
    },
  );
  addCheck(
    checks,
    `${prefix}:door-state-forwarded`,
    production?.door?.leftState === target.door && production?.door?.rightState === target.door,
    { left: production?.door?.leftState, right: production?.door?.rightState },
    { left: target.door, right: target.door },
  );

  const roots = snapshot?.roots;
  addCheck(
    checks,
    `${prefix}:unique-attached-roots`,
    roots?.templateRootCount === 10
      && roots?.assemblyRootCount === 6
      && roots?.uniqueTemplateUuidCount === 10
      && roots?.uniqueAssemblyUuidCount === 6
      && (roots?.templateSceneOccurrences || []).every((entry) => entry.occurrences === 1)
      && (roots?.assemblySceneOccurrences || []).every((entry) => entry.occurrences === 1),
    roots,
  );
  addCheck(
    checks,
    `${prefix}:one-production-mount-each`,
    countsAreOne(roots?.mountNameCounts, SHEET06_PRODUCTION_MOUNTS),
    roots?.mountNameCounts,
    Object.fromEntries(SHEET06_PRODUCTION_MOUNTS.map((name) => [name, 1])),
  );
  addCheck(
    checks,
    `${prefix}:one-assembly-root-each`,
    SHEET06_ASSEMBLY_ASSETS.every(
      (number) => Number(roots?.assemblyNameCounts?.[`SHEET06_ASSET_${number}_PRODUCTION_ASSEMBLY`]) === 1,
    ),
    roots?.assemblyNameCounts,
  );

  const forwarding = snapshot?.forwarding;
  for (const component of ['windows', 'panels', 'ceiling', 'floor']) {
    addCheck(
      checks,
      `${prefix}:${component}-restored-finish`,
      forwarding?.[component]?.restored === target.components[component].restored
        && forwarding?.[component]?.finish === target.components[component].finish,
      forwarding?.[component],
      target.components[component],
    );
  }
  addCheck(
    checks,
    `${prefix}:window-repair-metadata`,
    Array.isArray(forwarding?.windows?.brokenStates)
      && forwarding.windows.brokenStates.length > 0
      && forwarding.windows.brokenStates.every(
        (broken) => broken === !target.components.windows.restored,
      ),
    forwarding?.windows?.brokenStates,
  );
  const panelDamage = forwarding?.panels?.damageOverlays;
  addCheck(
    checks,
    `${prefix}:panel-damage-toggle`,
    Number(panelDamage?.objectCount) > 0
      && Number(panelDamage?.objectCount) < Number(forwarding?.panels?.instanceCount)
      && Number(panelDamage?.visibleObjectCount) === (
        target.components.panels.restored ? 0 : Number(panelDamage?.objectCount)
      ),
    panelDamage,
  );
  addCheck(
    checks,
    `${prefix}:floor-finish-resource`,
    forwarding?.floor?.selectedVariant
      === SHEET06_FLOOR_VARIANT_BY_FINISH[target.components.floor.finish],
    forwarding?.floor?.selectedVariant,
    SHEET06_FLOOR_VARIANT_BY_FINISH[target.components.floor.finish],
  );
  addCheck(
    checks,
    `${prefix}:sparse-floor-damage-toggle`,
    forwarding?.floor?.damageSiteCount === 5
      && forwarding?.floor?.damageVisible === !target.components.floor.restored
      && Array.isArray(forwarding?.floor?.visibleVariantCounts)
      && forwarding.floor.visibleVariantCounts.length === 5
      && forwarding.floor.visibleVariantCounts.every((count) => count === 1),
    {
      damageSiteCount: forwarding?.floor?.damageSiteCount,
      damageVisible: forwarding?.floor?.damageVisible,
      visibleVariantCounts: forwarding?.floor?.visibleVariantCounts,
    },
    {
      damageSiteCount: 5,
      damageVisible: !target.components.floor.restored,
      visibleVariantCounts: [1, 1, 1, 1, 1],
    },
  );
  addCheck(
    checks,
    `${prefix}:listener-census-available`,
    snapshot?.listeners?.available === true,
    snapshot?.listeners,
  );
}

export function evaluateSheet06StateLifecycle({
  cycles,
  browserDiagnostics = [],
  requiredCycles = SHEET06_STATE_LIFECYCLE_CYCLES,
} = {}) {
  const records = Array.isArray(cycles) ? cycles : [];
  const checks = [];
  addCheck(checks, 'cycle-count', records.length >= requiredCycles, records.length, requiredCycles);

  records.forEach((record, index) => {
    const target = sheet06LifecycleTarget(index);
    addCheck(
      checks,
      `cycle-${index + 1}:declared-target`,
      record?.cycleIndex === index && sameJson(record?.target, target),
      { cycleIndex: record?.cycleIndex, target: record?.target },
      { cycleIndex: index, target },
    );
    if (index < 2) {
      addCheck(
        checks,
        `cycle-${index + 1}:normal-e-control`,
        record?.control?.mode === 'normal-keyboard-e'
          && record?.control?.ok === true
          && record?.control?.persistedDoorState?.left === target.door
          && record?.control?.persistedDoorState?.right === target.door,
        record?.control,
      );
    }
    addCheck(
      checks,
      `cycle-${index + 1}:autosave-payload`,
      sameJson(architectureProjection(record?.autosaveArchitecture), targetArchitecture(target)),
      architectureProjection(record?.autosaveArchitecture),
      targetArchitecture(target),
    );
    validateSnapshot(checks, record?.beforeSave, target, `cycle-${index + 1}:before-save`);
    validateSnapshot(checks, record?.afterReload, target, `cycle-${index + 1}:after-reload`);
  });

  const afterReload = records.map((record) => record?.afterReload).filter(Boolean);
  const sheet06NodeCounts = afterReload.map((snapshot) => snapshot?.roots?.sheet06NodeCount);
  addCheck(
    checks,
    'no-sheet06-node-growth-across-reloads',
    sheet06NodeCounts.length >= requiredCycles
      && sheet06NodeCounts.every(Number.isFinite)
      && new Set(sheet06NodeCounts).size === 1,
    sheet06NodeCounts,
  );
  const listenerSignatures = afterReload.map((snapshot) => sortedListenerSignature(snapshot?.listeners));
  addCheck(
    checks,
    'no-listener-growth-across-reloads',
    listenerSignatures.length >= requiredCycles
      && listenerSignatures.every(Boolean)
      && new Set(listenerSignatures).size === 1,
    afterReload.map((snapshot) => snapshot?.listeners),
  );
  const sceneNodeCounts = afterReload.map((snapshot) => snapshot?.roots?.sceneNodeCount);
  addCheck(
    checks,
    'global-scene-node-census-recorded',
    sceneNodeCounts.length >= requiredCycles && sceneNodeCounts.every(Number.isFinite),
    sceneNodeCounts,
  );
  addCheck(
    checks,
    'open-and-closed-reload-covered',
    records.some((record) => record?.target?.door === 'open')
      && records.some((record) => record?.target?.door === 'closed'),
    records.map((record) => record?.target?.door),
  );
  addCheck(
    checks,
    'blocking-browser-diagnostics',
    browserDiagnostics.length === 0,
    browserDiagnostics,
    [],
  );

  const failedChecks = checks.filter((check) => !check.ok);
  return immutable({
    schemaVersion: SHEET06_STATE_LIFECYCLE_SCHEMA_VERSION,
    ok: failedChecks.length === 0,
    requiredCycles,
    observedCycles: records.length,
    checks,
    failedChecks,
    summary: {
      sheet06NodeCounts,
      sceneNodeCounts,
      listenerTotals: afterReload.map((snapshot) => snapshot?.listeners?.total ?? null),
      openCycles: records.filter((record) => record?.target?.door === 'open').length,
      closedCycles: records.filter((record) => record?.target?.door === 'closed').length,
    },
  });
}

export default evaluateSheet06StateLifecycle;
