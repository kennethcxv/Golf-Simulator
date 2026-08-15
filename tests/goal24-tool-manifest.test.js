import assert from 'node:assert/strict';
import test from 'node:test';

import {
  GOAL24_PRODUCTION_TOOL_MANIFEST,
  GOAL24_SUPPORTED_TOOL_IDS,
  GOAL24_SUPPORTED_TOOL_MANIFEST,
  assertGoal24ProductionToolManifest,
  createGoal24ToolManifest,
  deriveGoal24SupportedToolIds,
  goal24ToolChainFailures,
  goal24ToolEvidenceFailures,
  goal24ToolManifestFailures,
  hashGoal24SupportedToolIds,
} from '../tools/qa/lib/goal24-tool-manifest.mjs';
import {
  buildRunPlan,
  goal24InteractionEnvironmentPin,
} from '../tools/qa/goal24-interaction-performance.mjs';

const clone = (value) => structuredClone(value);

function firstUseEvents({ ids = GOAL24_SUPPORTED_TOOL_IDS, sequenceBase = 17 } = {}) {
  return ids.map((toolId, index) => ({
    discriminator: {
      toolId,
      supportedToolIds: [...ids],
      fromTool: index === 0 ? 'empty-hands' : ids[index - 1],
      toTool: toolId,
      productionEquipSequenceBase: sequenceBase,
      productionEquipSequence: sequenceBase + index + 1,
    },
  }));
}

test('independent Goal 24 pin matches the complete shipping indoor belt order and hash', () => {
  assert.deepEqual(GOAL24_SUPPORTED_TOOL_IDS, [
    'vacuum', 'mop', 'broom', 'dustpan', 'spray', 'cloth', 'sponge', 'trashbag',
  ]);
  assert.equal(GOAL24_SUPPORTED_TOOL_MANIFEST.supportedToolCount, 8);
  assert.equal(
    GOAL24_SUPPORTED_TOOL_MANIFEST.orderedToolIdsSha256,
    hashGoal24SupportedToolIds(GOAL24_SUPPORTED_TOOL_IDS),
  );
  assert.deepEqual(GOAL24_PRODUCTION_TOOL_MANIFEST, GOAL24_SUPPORTED_TOOL_MANIFEST);
  assert.deepEqual(assertGoal24ProductionToolManifest(), GOAL24_SUPPORTED_TOOL_MANIFEST);
  assert.equal(Object.isFrozen(GOAL24_SUPPORTED_TOOL_MANIFEST), true);
  assert.equal(Object.isFrozen(GOAL24_SUPPORTED_TOOL_MANIFEST.supportedToolIds), true);
});

test('production derivation excludes washer and all external tools without hiding registry errors', () => {
  const beltOrder = [null, 'washer', 'vacuum', 'patio-only', 'mop'];
  const cleaningTools = {
    washer: { external: false },
    vacuum: { external: false },
    'patio-only': { external: true },
    mop: { external: false },
  };
  assert.deepEqual(
    deriveGoal24SupportedToolIds({ beltOrder, cleaningTools }),
    ['vacuum', 'mop'],
  );
  assert.throws(
    () => deriveGoal24SupportedToolIds({
      beltOrder: [null, 'vacuum', 'vacuum'], cleaningTools,
    }),
    /duplicate tool ID vacuum/,
  );
  assert.throws(
    () => deriveGoal24SupportedToolIds({
      beltOrder: [null, 'missing'], cleaningTools,
    }),
    /unregistered tool ID missing/,
  );
});

test('manifest validation rejects coordinated shrink, reorder, and forged hashes', () => {
  const shrunkIds = GOAL24_SUPPORTED_TOOL_IDS.slice(0, -1);
  const shrunk = createGoal24ToolManifest(shrunkIds);
  assert.match(
    goal24ToolManifestFailures(shrunk).join('\n'),
    /supportedToolIds set\/order differs from the independent shipping pin/,
  );

  const reorderedIds = [...GOAL24_SUPPORTED_TOOL_IDS];
  [reorderedIds[0], reorderedIds[1]] = [reorderedIds[1], reorderedIds[0]];
  const reordered = createGoal24ToolManifest(reorderedIds);
  assert.match(
    goal24ToolManifestFailures(reordered).join('\n'),
    /supportedToolIds set\/order differs from the independent shipping pin/,
  );

  const forged = clone(GOAL24_SUPPORTED_TOOL_MANIFEST);
  forged.orderedToolIdsSha256 = '0'.repeat(64);
  assert.match(
    goal24ToolManifestFailures(forged).join('\n'),
    /orderedToolIdsSha256 does not seal/,
  );
});

test('first-use tool evidence is one contiguous shipping chain from captured empty hands', () => {
  const valid = firstUseEvents();
  assert.deepEqual(goal24ToolChainFailures(valid), []);

  const badStart = clone(valid);
  badStart[0].discriminator.fromTool = 'trashbag';
  assert.match(goal24ToolChainFailures(badStart).join('\n'), /fromTool must equal empty-hands/);

  const brokenLink = clone(valid);
  brokenLink[4].discriminator.fromTool = 'vacuum';
  assert.match(
    goal24ToolChainFailures(brokenLink).join('\n'),
    /fromTool must equal the previous first-use event toTool/,
  );

  const skippedProductionEdge = clone(valid);
  skippedProductionEdge[5].discriminator.productionEquipSequence += 1;
  assert.match(
    goal24ToolChainFailures(skippedProductionEdge).join('\n'),
    /productionEquipSequence must be contiguous from the captured initial base/,
  );

  const changedBase = clone(valid);
  changedBase[3].discriminator.productionEquipSequenceBase += 1;
  assert.match(
    goal24ToolChainFailures(changedBase).join('\n'),
    /productionEquipSequenceBase must remain constant/,
  );
});

test('shrinking driver environment and events together cannot redefine expected coverage', () => {
  const validEnvironment = {
    toolManifest: clone(GOAL24_SUPPORTED_TOOL_MANIFEST),
    profile: { supportedToolIds: [...GOAL24_SUPPORTED_TOOL_IDS] },
  };
  assert.deepEqual(goal24ToolEvidenceFailures(validEnvironment, firstUseEvents()), []);

  const shrunkIds = GOAL24_SUPPORTED_TOOL_IDS.slice(0, -1);
  const coordinatedShrink = {
    toolManifest: createGoal24ToolManifest(shrunkIds),
    profile: { supportedToolIds: [...shrunkIds] },
  };
  const failures = goal24ToolEvidenceFailures(
    coordinatedShrink,
    firstUseEvents({ ids: shrunkIds }),
  ).join('\n');
  assert.match(failures, /environment\.toolManifest .*independent pin/);
  assert.match(failures, /environment\.profile\.supportedToolIds must exactly match/);
  assert.match(failures, /exactly one first-use event for every supported tool ID/);
});

test('orchestrator owns the expected manifest and environment comparison pin includes it', () => {
  const plan = buildRunPlan({
    suite: 'smoke', phase: 'baseline', sessionId: 'tool-manifest-unit',
  });
  assert.deepEqual(plan.pinned.toolManifest, GOAL24_SUPPORTED_TOOL_MANIFEST);
  assert.ok(plan.runs.every((run) => (
    JSON.stringify(JSON.parse(run.env.GOAL24_PERF_TOOL_MANIFEST))
      === JSON.stringify(GOAL24_SUPPORTED_TOOL_MANIFEST)
  )));

  const report = {
    environment: {
      toolManifest: clone(GOAL24_SUPPORTED_TOOL_MANIFEST),
      renderer: { name: 'renderer' },
      gpu: { renderer: 'gpu' },
      window: { innerWidth: 1920 },
      devicePixelRatio: 1,
      quality: { preset: 'high' },
      profile: {
        name: 'goal24',
        saveFixture: 'fixture',
        cameraRoute: 'route',
        userDataPolicy: 'isolated',
        coldRunProfileRoot: 'profiles',
        shaderCachePolicy: 'retained',
        gpuCachePolicy: 'fresh',
        seed: 424242,
        supportedToolIds: [...GOAL24_SUPPORTED_TOOL_IDS],
      },
    },
  };
  const baselinePin = goal24InteractionEnvironmentPin(report);
  const shrunk = clone(report);
  shrunk.environment.toolManifest = createGoal24ToolManifest(
    GOAL24_SUPPORTED_TOOL_IDS.slice(0, -1),
  );
  assert.notDeepEqual(goal24InteractionEnvironmentPin(shrunk), baselinePin);
});
