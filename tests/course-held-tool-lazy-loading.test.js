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

test('course scene starts held I/O only from the equip boundary', () => {
  assert.equal(
    [...source.matchAll(/heldAssetRegistry\.ensure\(/g)].length,
    1,
    'one production ensure call prevents hidden prefetch paths from creeping back in',
  );
  const equipStart = source.indexOf('function walkSetTool(tool)');
  const equipEnd = source.indexOf('function walkSetSpraying', equipStart);
  assert.ok(equipStart >= 0 && equipEnd > equipStart);
  assert.match(source.slice(equipStart, equipEnd), /heldAssetRegistry\.ensure\(tool, 'equip'\)/);
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
