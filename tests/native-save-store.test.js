import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createNativeSaveStore } = require('../src/core/nativeSaveStore.cjs');

async function withStore(run) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'golf-flipper-save-'));
  try {
    await run(createNativeSaveStore({ dir }), dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test('native saves retain the previous valid primary and recover a corrupt current file', async () => {
  await withStore(async (store) => {
    await store.save('autosave', { generation: 1, held: ['unit-1'] });
    await store.save('autosave', { generation: 2, held: ['unit-2'] });
    const files = store.pathsFor('autosave');
    await fs.writeFile(files.primary, '{"generation":', 'utf8');

    const recovered = await store.loadStatus('autosave');
    assert.equal(recovered.source, 'backup');
    assert.equal(recovered.recovered, true);
    assert.equal(recovered.repairedPrimary, true);
    assert.deepEqual(recovered.value, { generation: 1, held: ['unit-1'] });
    assert.deepEqual(JSON.parse(await fs.readFile(files.primary, 'utf8')), recovered.value);
  });
});

test('an interrupted replacement with no primary resumes from backup', async () => {
  await withStore(async (store) => {
    await store.save('slot-1', { generation: 1 });
    await store.save('slot-1', { generation: 2 });
    const files = store.pathsFor('slot-1');
    await fs.rm(files.primary);
    assert.deepEqual(await store.list(), ['slot-1'], 'a backup-only slot remains discoverable');
    const recovered = await store.loadStatus('slot-1');
    assert.deepEqual(recovered.value, { generation: 1 });
    assert.equal(recovered.source, 'backup');
    assert.equal(recovered.repairedPrimary, true);
  });
});

test('fifty serialized save/reload cycles remain valid and internal files stay hidden', async () => {
  await withStore(async (store) => {
    for (let generation = 1; generation <= 50; generation += 1) {
      await store.save('autosave', { generation, payload: `cycle-${generation}` });
      assert.deepEqual(await store.load('autosave'), {
        generation,
        payload: `cycle-${generation}`,
      });
    }
    assert.deepEqual(await store.list(), ['autosave']);
  });
});

test('failed serialization and corrupt saves without backup do not masquerade as missing data', async () => {
  await withStore(async (store) => {
    await assert.rejects(store.save('bad', undefined), /JSON-serializable/);
    const files = store.pathsFor('bad');
    await fs.mkdir(path.dirname(files.primary), { recursive: true });
    await fs.writeFile(files.primary, 'not-json', 'utf8');
    const status = await store.loadStatus('bad');
    assert.equal(status.value, null);
    assert.equal(status.missing, false);
    assert.equal(status.primaryError.code, 'SAVE_IO_ERROR');
  });
});

test('overlapping writes are serialized per slot and always leave parseable JSON', async () => {
  await withStore(async (store) => {
    await Promise.all(Array.from({ length: 20 }, (_, index) => (
      store.save('autosave', { generation: index + 1 })
    )));
    assert.deepEqual(await store.load('autosave'), { generation: 20 });
    const backup = JSON.parse(await fs.readFile(store.pathsFor('autosave').backup, 'utf8'));
    assert.deepEqual(backup, { generation: 19 });
  });
});

test('loads share the slot lock so they never observe a replacement gap', async () => {
  await withStore(async (store) => {
    const operations = [];
    for (let generation = 1; generation <= 20; generation += 1) {
      operations.push(store.save('autosave', { generation }));
      operations.push(store.load('autosave').then((value) => {
        assert.deepEqual(value, { generation });
      }));
    }
    await Promise.all(operations);
    assert.deepEqual(await store.load('autosave'), { generation: 20 });
  });
});
