import { createHash } from 'node:crypto';

import { BELT_ORDER, CLEANING_TOOLS } from '../../../src/data/cleaningTools.js';

export const GOAL24_TOOL_MANIFEST_SCHEMA = 'golf-flipper/goal24-supported-tool-manifest/v1';
export const GOAL24_TOOL_MANIFEST_SOURCE = 'src/data/cleaningTools.js#BELT_ORDER';
export const GOAL24_TOOL_MANIFEST_EXCLUSION_POLICY =
  'exclude-null-washer-and-tools-marked-external';
export const GOAL24_TOOL_MANIFEST_HASH_ALGORITHM =
  'sha256(JSON.stringify(supportedToolIds))';

const deepFreeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
};

// This literal is deliberately independent of the driver and shipping registry.
// A production BELT_ORDER change must be reviewed and repinned here; it cannot
// silently shrink both the measured environment and its first-use events.
export const GOAL24_SUPPORTED_TOOL_IDS = Object.freeze([
  'vacuum',
  'mop',
  'broom',
  'dustpan',
  'spray',
  'cloth',
  'sponge',
  'trashbag',
]);

// This is the exact production indoor F-belt cycle. Hands-free is a real belt
// stop, not a QA staging state; the indoor shipping registry excludes washer
// and every external tool before the cycle is pinned here.
export const GOAL24_WARM_TOOL_CYCLE_IDS = Object.freeze([
  'empty-hands',
  ...GOAL24_SUPPORTED_TOOL_IDS,
]);

export function hashGoal24SupportedToolIds(toolIds) {
  if (!Array.isArray(toolIds) || toolIds.length === 0 || toolIds.some((toolId) => (
    typeof toolId !== 'string' || toolId.length === 0
  ))) {
    throw new TypeError('Goal 24 supported tool IDs must be a non-empty-string array.');
  }
  return createHash('sha256').update(JSON.stringify(toolIds), 'utf8').digest('hex');
}

export const GOAL24_SUPPORTED_TOOL_MANIFEST = deepFreeze({
  schema: GOAL24_TOOL_MANIFEST_SCHEMA,
  source: GOAL24_TOOL_MANIFEST_SOURCE,
  exclusionPolicy: GOAL24_TOOL_MANIFEST_EXCLUSION_POLICY,
  supportedToolIds: [...GOAL24_SUPPORTED_TOOL_IDS],
  supportedToolCount: 8,
  hashAlgorithm: GOAL24_TOOL_MANIFEST_HASH_ALGORITHM,
  orderedToolIdsSha256: '8e4fb2b6e13de72d24fcb0053c34d9d39b0400c0f47459ea25e1fd07627e6e4c',
});

// Short alias for callers that treat the manifest as the primary contract.
export const GOAL24_TOOL_MANIFEST = GOAL24_SUPPORTED_TOOL_MANIFEST;

export function deriveGoal24SupportedToolIds({
  beltOrder = BELT_ORDER,
  cleaningTools = CLEANING_TOOLS,
} = {}) {
  if (!Array.isArray(beltOrder)) {
    throw new TypeError('Production BELT_ORDER must be an array.');
  }
  if (!cleaningTools || typeof cleaningTools !== 'object' || Array.isArray(cleaningTools)) {
    throw new TypeError('Production CLEANING_TOOLS must be an object registry.');
  }
  const seen = new Set();
  const supportedToolIds = [];
  for (const toolId of beltOrder) {
    if (toolId == null) continue;
    if (typeof toolId !== 'string' || toolId.length === 0) {
      throw new TypeError('Production BELT_ORDER entries must be null or non-empty strings.');
    }
    if (seen.has(toolId)) {
      throw new TypeError(`Production BELT_ORDER contains duplicate tool ID ${toolId}.`);
    }
    seen.add(toolId);
    const definition = cleaningTools[toolId];
    if (!definition || typeof definition !== 'object') {
      throw new TypeError(`Production BELT_ORDER references unregistered tool ID ${toolId}.`);
    }
    if (toolId === 'washer' || definition.external === true) continue;
    supportedToolIds.push(toolId);
  }
  if (supportedToolIds.length === 0) {
    throw new TypeError('Production BELT_ORDER produced no supported indoor shipping tools.');
  }
  return supportedToolIds;
}

export function createGoal24ToolManifest(supportedToolIds) {
  const ids = [...supportedToolIds];
  return {
    schema: GOAL24_TOOL_MANIFEST_SCHEMA,
    source: GOAL24_TOOL_MANIFEST_SOURCE,
    exclusionPolicy: GOAL24_TOOL_MANIFEST_EXCLUSION_POLICY,
    supportedToolIds: ids,
    supportedToolCount: ids.length,
    hashAlgorithm: GOAL24_TOOL_MANIFEST_HASH_ALGORITHM,
    orderedToolIdsSha256: hashGoal24SupportedToolIds(ids),
  };
}

export function goal24ToolManifestFailures(
  candidate,
  expected = GOAL24_SUPPORTED_TOOL_MANIFEST,
) {
  const failures = [];
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return ['must be an object'];
  }
  const expectedKeys = Object.keys(expected).sort();
  const actualKeys = Object.keys(candidate).sort();
  if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
    failures.push(`keys must be exactly ${expectedKeys.join(', ')}`);
  }
  for (const key of [
    'schema', 'source', 'exclusionPolicy', 'supportedToolCount',
    'hashAlgorithm', 'orderedToolIdsSha256',
  ]) {
    if (candidate[key] !== expected[key]) failures.push(`${key} differs from the independent pin`);
  }
  if (JSON.stringify(candidate.supportedToolIds)
    !== JSON.stringify(expected.supportedToolIds)) {
    failures.push('supportedToolIds set/order differs from the independent shipping pin');
  }
  if (Array.isArray(candidate.supportedToolIds)) {
    let computedHash = null;
    try {
      computedHash = hashGoal24SupportedToolIds(candidate.supportedToolIds);
    } catch (error) {
      failures.push(`supportedToolIds cannot be hashed: ${error.message}`);
    }
    if (computedHash !== candidate.orderedToolIdsSha256) {
      failures.push('orderedToolIdsSha256 does not seal the reported supportedToolIds order');
    }
  }
  return failures;
}

export function assertGoal24ToolManifest(
  candidate,
  expected = GOAL24_SUPPORTED_TOOL_MANIFEST,
) {
  const failures = goal24ToolManifestFailures(candidate, expected);
  if (failures.length > 0) {
    throw new Error(`Goal 24 supported tool manifest mismatch: ${failures.join('; ')}`);
  }
  return candidate;
}

export function assertGoal24ProductionToolManifest(options = {}) {
  const production = createGoal24ToolManifest(deriveGoal24SupportedToolIds(options));
  assertGoal24ToolManifest(production);
  return production;
}

const discriminatorFor = (event) => event?.discriminator ?? event;

export function goal24ToolChainFailures(
  events,
  { expectedToolIds = GOAL24_SUPPORTED_TOOL_IDS } = {},
) {
  const failures = [];
  if (!Array.isArray(events)) return ['toolFirstUseByTool events must be an array'];
  const discriminators = events.map(discriminatorFor);
  const firstUseIds = discriminators.map((discriminator) => discriminator?.toolId);
  if (JSON.stringify(firstUseIds) !== JSON.stringify(expectedToolIds)) {
    failures.push(
      'toolFirstUseByTool must contain exactly one first-use event for every supported tool ID in declared order',
    );
  }
  const sequenceBase = discriminators[0]?.productionEquipSequenceBase;
  if (!Number.isInteger(sequenceBase) || sequenceBase < 0) {
    failures.push(
      'toolFirstUseByTool must capture a non-negative initial production equip sequence base',
    );
  }
  discriminators.forEach((discriminator, index) => {
    const label = `toolFirstUseByTool: event ${index + 1}`;
    if (JSON.stringify(discriminator?.supportedToolIds)
      !== JSON.stringify(expectedToolIds)) {
      failures.push(`${label} supportedToolIds must exactly match the independent shipping tool set/order`);
    }
    if (discriminator?.toTool !== expectedToolIds[index]
      || discriminator?.toolId !== expectedToolIds[index]) {
      failures.push(`${label} toTool/toolId must match the independently pinned shipping order`);
    }
    const expectedFromTool = index === 0
      ? 'empty-hands'
      : discriminators[index - 1]?.toTool;
    if (discriminator?.fromTool !== expectedFromTool) {
      failures.push(`${label} fromTool must equal ${index === 0
        ? 'empty-hands'
        : 'the previous first-use event toTool'}`);
    }
    if (discriminator?.productionEquipSequenceBase !== sequenceBase) {
      failures.push(`${label} productionEquipSequenceBase must remain constant`);
    }
    if (Number.isInteger(sequenceBase)
      && discriminator?.productionEquipSequence !== sequenceBase + index + 1) {
      failures.push(
        `${label} productionEquipSequence must be contiguous from the captured initial base`,
      );
    }
  });
  return failures;
}

export function goal24WarmedToolCycleFailures(
  events,
  {
    expectedToolIds = GOAL24_SUPPORTED_TOOL_IDS,
    initialTool = expectedToolIds.at(-1),
    initialProductionEquipSequence,
  } = {},
) {
  const failures = [];
  if (!Array.isArray(events)) return ['warmed tool-cycle events must be an array'];
  const cycle = ['empty-hands', ...expectedToolIds];
  if (cycle.length < 2 || new Set(cycle).size !== cycle.length) {
    return ['warmed tool-cycle pin must contain unique empty-hands and supported-tool stops'];
  }
  if (!cycle.includes(initialTool)) {
    return ['warmed tool-cycle initial tool must be a canonical production cycle stop'];
  }
  if (!Number.isInteger(initialProductionEquipSequence)
    || initialProductionEquipSequence < 0) {
    failures.push('warmed tool cycle requires the final first-use production equip sequence');
  }
  let expectedFromTool = initialTool;
  events.forEach((event, index) => {
    const discriminator = discriminatorFor(event);
    const label = `${event?.scenarioId || 'warmed tool cycle'}: event ${index + 1}`;
    const fromIndex = cycle.indexOf(expectedFromTool);
    const expectedToTool = cycle[(fromIndex + 1) % cycle.length];
    if (discriminator?.fromTool !== expectedFromTool
      || discriminator?.toTool !== expectedToTool) {
      failures.push(
        `${label} must continue the canonical production cycle ${expectedFromTool} -> ${expectedToTool}`,
      );
    }
    if (Number.isInteger(initialProductionEquipSequence)
      && discriminator?.productionEquipSequence
        !== initialProductionEquipSequence + index + 1) {
      failures.push(
        `${label} productionEquipSequence must be contiguous after the first-use chain`,
      );
    }
    if (discriminator?.productionEquipSignal !== 'shipping-walk-toolChanged-edge') {
      failures.push(`${label} must carry the shipping walk toolChanged production edge`);
    }
    expectedFromTool = expectedToTool;
  });
  return failures;
}

export function goal24ToolEvidenceFailures(environment, firstUseEvents) {
  const failures = goal24ToolManifestFailures(environment?.toolManifest)
    .map((failure) => `environment.toolManifest ${failure}`);
  if (JSON.stringify(environment?.profile?.supportedToolIds)
    !== JSON.stringify(GOAL24_SUPPORTED_TOOL_IDS)) {
    failures.push(
      'environment.profile.supportedToolIds must exactly match the independently pinned shipping tool set/order',
    );
  }
  failures.push(...goal24ToolChainFailures(firstUseEvents));
  return failures;
}

// Importing the manifest is itself a production drift gate. The literal pin and
// hash above remain the authority; the live registry only proves shipping still
// agrees with that reviewed contract.
export const GOAL24_PRODUCTION_TOOL_MANIFEST = deepFreeze(
  assertGoal24ProductionToolManifest(),
);
