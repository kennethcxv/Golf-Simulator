import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Browser production resolves Three.js through index.html's import map; the
// repository intentionally has no installed node_modules in this QA checkout.
// Evaluate the actual data-only export slice so this focused gate stays free of
// WebGL/DOM mocks while still exercising the exact production implementation.
const source = fs.readFileSync(new URL('../src/render3d/courseScene.js', import.meta.url), 'utf8');
const sliceStart = source.indexOf('export const HELD_TOOL_ASSET_MANIFEST');
const sliceEnd = source.indexOf('export function makeCourseScene');
assert.ok(sliceStart >= 0 && sliceEnd > sliceStart, 'held-tool registry export slice is present');
const registrySource = source.slice(sliceStart, sliceEnd)
  .replace('export const HELD_TOOL_ASSET_MANIFEST', 'const HELD_TOOL_ASSET_MANIFEST')
  .replace('export function createHeldToolAssetRegistry', 'function createHeldToolAssetRegistry');
const {
  HELD_TOOL_ASSET_MANIFEST,
  createHeldToolAssetRegistry,
} = Function(`${registrySource}\nreturn { HELD_TOOL_ASSET_MANIFEST, createHeldToolAssetRegistry };`)();

test('held course-tool manifest contains only the measured deferred assets', () => {
  assert.deepEqual(
    Object.fromEntries(Object.entries(HELD_TOOL_ASSET_MANIFEST).map(([tool, assets]) => [
      tool,
      assets.map((asset) => asset.url),
    ])),
    {
      hose: ['vendor/models/hose_nozzle.glb'],
      divot: ['vendor/models/hand_fork.glb', 'vendor/models/bucket_soil.glb'],
      rake: ['vendor/models/rake.glb'],
    },
  );
});

// THE BOUNDARY MOVED, AND THE CONTRACT MOVED WITH IT -- deliberately, and no
// looser than before. Held I/O used to start only at equip, which meant the
// first press of `hose` outdoors fetched and parsed its GLB in the player's
// hands: measured at 1,459.5 ms with ZERO programs minted
// (tools/qa/outdoor-program-identity.js), and 4,603 ms at the door
// (tools/qa/door-crossing-stall.js). Stepping outside is the same actual-use
// boundary one step earlier and buys the walk to the first press.
//
// So this now pins TWO call sites by name and place rather than counting one.
// A third would still fail, an eager loader would still fail, and the
// stepped-outside path is required to carry its is-the-player-outdoors guard --
// without that assertion this test would pass on an unconditional boot prefetch,
// which is the exact regression the original was written to prevent.
test('course scene starts held I/O only from the equip and stepped-outside boundaries', () => {
  assert.equal(
    [...source.matchAll(/heldAssetRegistry\.ensure\(/g)].length,
    2,
    'exactly two production ensure calls: equip, and stepping outside — a third is a hidden prefetch path',
  );
  const equipStart = source.indexOf('function walkSetTool(tool)');
  const equipEnd = source.indexOf('function walkSetSpraying', equipStart);
  assert.ok(equipStart >= 0 && equipEnd > equipStart);
  assert.match(source.slice(equipStart, equipEnd), /heldAssetRegistry\.ensure\(tool, 'equip'\)/);

  const preStart = source.indexOf('function prefetchOutdoorHeldTools()');
  const preEnd = source.indexOf('function walkUpdate(', preStart);
  assert.ok(preStart >= 0 && preEnd > preStart, 'the stepped-outside prefetch must exist and be findable');
  const pre = source.slice(preStart, preEnd);
  assert.match(pre, /heldAssetRegistry\.ensure\(tool, 'stepped-outside'\)/);
  // The guard is the whole contract: it must refuse while the player is INSIDE,
  // so a session that never goes out still pays nothing.
  assert.match(pre, /clubhouseApi\.isInside\(walk\.x, walk\.z\)/,
    'the prefetch must be gated on the player actually being outdoors');
  assert.match(pre, /if \(outdoorToolsPrefetched/, 'the prefetch must run at most once');
  for (const assets of Object.values(HELD_TOOL_ASSET_MANIFEST)) {
    for (const asset of assets) {
      assert.equal(
        source.split(asset.url).length - 1,
        1,
        `${asset.url} appears only in the deferred manifest, never an eager loader call`,
      );
    }
  }
});

test('held assets stay idle until first equip and duplicate equips share one request', async () => {
  const calls = [];
  let finish;
  let clock = 100;
  const registry = createHeldToolAssetRegistry({
    now: () => clock,
    loadTool: (tool, assets) => {
      calls.push({ tool, assets });
      return new Promise((resolve) => { finish = resolve; });
    },
  });

  assert.equal(calls.length, 0, 'constructing the registry must not start boot-time I/O');
  assert.deepEqual(
    Object.fromEntries(Object.entries(registry.diagnostics()).map(([tool, record]) => [tool, record.status])),
    { hose: 'idle', divot: 'idle', rake: 'idle' },
  );

  const first = registry.ensure('hose', 'equip');
  const duplicate = registry.ensure('hose', 'equip');
  assert.strictEqual(first, duplicate);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].tool, 'hose');
  assert.equal(calls[0].assets.length, 1);
  assert.equal(registry.diagnostics().hose.status, 'loading');
  assert.equal(registry.diagnostics().hose.ensureCalls, 2);

  clock = 124.5;
  finish({
    readyAssets: 1,
    failedAssets: 0,
    assetResults: [{ id: 'hose_nozzle', status: 'ready' }],
  });
  await first;
  assert.deepEqual(registry.diagnostics().hose, {
    status: 'ready',
    assetCount: 1,
    urls: ['vendor/models/hose_nozzle.glb'],
    ensureCalls: 2,
    reason: 'equip',
    requestedAt: 100,
    settledAt: 124.5,
    latencyMs: 24.5,
    readyAssets: 1,
    failedAssets: 0,
    assetResults: [{ id: 'hose_nozzle', status: 'ready' }],
    error: null,
  });
  assert.equal(registry.diagnostics().divot.status, 'idle');
  assert.equal(registry.diagnostics().rake.status, 'idle');
});

test('divot assets settle independently and retain fallback status for a failed component', async () => {
  let requestedAssets = null;
  const registry = createHeldToolAssetRegistry({
    now: () => 50,
    loadTool: async (_tool, assets) => {
      requestedAssets = assets;
      return {
        readyAssets: 1,
        failedAssets: 1,
        assetResults: [
          { id: 'hand_fork', status: 'ready' },
          { id: 'bucket_soil', status: 'fallback' },
        ],
      };
    },
  });

  await registry.ensure('divot');
  assert.deepEqual(requestedAssets.map((asset) => asset.id), ['hand_fork', 'bucket_soil']);
  assert.equal(registry.diagnostics().divot.status, 'partial');
  assert.equal(registry.diagnostics().divot.readyAssets, 1);
  assert.equal(registry.diagnostics().divot.failedAssets, 1);
});

test('disposed late loads and synchronous loader failures settle without retry churn', async () => {
  let disposedCalls = 0;
  const disposed = createHeldToolAssetRegistry({
    loadTool: async () => {
      disposedCalls += 1;
      return { disposed: true, readyAssets: 0, failedAssets: 0 };
    },
  });
  await disposed.ensure('rake');
  await disposed.ensure('rake');
  assert.equal(disposedCalls, 1);
  assert.equal(disposed.diagnostics().rake.status, 'disposed');

  let failureCalls = 0;
  const failed = createHeldToolAssetRegistry({
    loadTool: () => {
      failureCalls += 1;
      throw new Error('offline');
    },
  });
  await failed.ensure('hose');
  await failed.ensure('hose');
  assert.equal(failureCalls, 1);
  assert.equal(failed.diagnostics().hose.status, 'fallback');
  assert.equal(failed.diagnostics().hose.failedAssets, 1);
  assert.match(failed.diagnostics().hose.error, /offline/);

  assert.equal(await failed.ensure('not-a-tool'), null);
  assert.equal(failureCalls, 1);
});
