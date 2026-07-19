import { test } from 'node:test';
import assert from 'node:assert/strict';

class MemoryStorage {
  #values = new Map();

  get length() { return this.#values.size; }

  key(index) { return [...this.#values.keys()][index] ?? null; }

  getItem(key) { return this.#values.has(String(key)) ? this.#values.get(String(key)) : null; }

  setItem(key, value) { this.#values.set(String(key), String(value)); }

  removeItem(key) { this.#values.delete(String(key)); }
}

test('browser storage backs up, recovers, repairs, lists, and deletes one logical slot', async () => {
  const priorWindow = globalThis.window;
  const priorStorage = globalThis.localStorage;
  const storage = new MemoryStorage();
  globalThis.window = {};
  globalThis.localStorage = storage;
  try {
    const api = await import(`../src/core/storage.js?recovery=${Date.now()}`);
    await api.saveData('autosave', { generation: 1 });
    await api.saveData('autosave', { generation: 2 });
    storage.setItem('golfempire:autosave', '{broken');

    const status = await api.loadDataWithStatus('autosave');
    assert.equal(status.source, 'backup');
    assert.equal(status.recovered, true);
    assert.equal(status.repairedPrimary, true);
    assert.deepEqual(status.value, { generation: 1 });
    assert.deepEqual(await api.loadData('autosave'), { generation: 1 });
    assert.deepEqual(await api.listData(), ['autosave']);

    storage.removeItem('golfempire:autosave');
    assert.deepEqual(await api.listData(), ['autosave'], 'a backup-only slot remains discoverable');

    await api.deleteData('autosave');
    assert.equal(storage.getItem('golfempire:autosave'), null);
    assert.equal(storage.getItem('golfempire-backup:autosave'), null);
  } finally {
    if (priorWindow === undefined) delete globalThis.window;
    else globalThis.window = priorWindow;
    if (priorStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = priorStorage;
  }
});
