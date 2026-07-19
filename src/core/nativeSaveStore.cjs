'use strict';

// Native persistence is kept outside main.cjs so its crash behavior can be
// exercised without launching Electron. A completed save is always valid JSON
// at the primary path; the previous valid primary is retained as a backup.

const fs = require('fs');
const path = require('path');

const fsp = fs.promises;

function safeKey(key) {
  const safe = String(key).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
  if (!safe) throw new TypeError('A save key must contain at least one usable character.');
  return safe;
}

function errorInfo(error) {
  if (!error) return null;
  return {
    name: error.name || 'Error',
    code: error.code || 'SAVE_IO_ERROR',
    message: error.message || String(error),
  };
}

function parseStoredRecord(raw) {
  const value = JSON.parse(raw);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    const error = new TypeError('Save data root must be an object.');
    error.code = 'SAVE_ROOT_INVALID';
    throw error;
  }
  return value;
}

function createNativeSaveStore({ dir }) {
  if (!dir || typeof dir !== 'string') throw new TypeError('A native save directory is required.');
  let nonce = 0;
  const queues = new Map();

  const pathsFor = (key) => {
    const base = path.join(dir, `${safeKey(key)}.json`);
    return { primary: base, backup: `${base}.bak` };
  };

  async function ensureDir() {
    await fsp.mkdir(dir, { recursive: true });
  }

  async function readCandidate(file) {
    try {
      const raw = await fsp.readFile(file, 'utf8');
      return { ok: true, missing: false, raw, value: parseStoredRecord(raw), error: null };
    } catch (error) {
      return {
        ok: false,
        missing: error?.code === 'ENOENT',
        raw: null,
        value: null,
        error: errorInfo(error),
      };
    }
  }

  function tempFor(target) {
    nonce += 1;
    return `${target}.${process.pid}.${Date.now()}.${nonce}.tmp`;
  }

  async function writeSynced(file, text) {
    const handle = await fsp.open(file, 'wx');
    try {
      await handle.writeFile(text, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  async function replaceFile(temp, target) {
    try {
      await fsp.rename(temp, target);
      return;
    } catch (error) {
      if (!['EEXIST', 'EPERM', 'EACCES'].includes(error?.code)) throw error;
    }

    // Some Windows filesystems do not replace an existing destination with
    // rename(). Keep a short-lived retired primary so a failed second rename
    // can roll back immediately; the durable .bak remains the crash fallback.
    const retired = `${target}.replace-old`;
    await fsp.rm(retired, { force: true });
    await fsp.rename(target, retired);
    try {
      await fsp.rename(temp, target);
    } catch (error) {
      try { await fsp.rename(retired, target); } catch {}
      throw error;
    }
    await fsp.rm(retired, { force: true });
  }

  async function writeAtomic(target, text) {
    const temp = tempFor(target);
    try {
      await writeSynced(temp, text);
      await replaceFile(temp, target);
    } finally {
      await fsp.rm(temp, { force: true });
    }
  }

  function withKeyLock(key, task) {
    const lockKey = safeKey(key);
    const previous = queues.get(lockKey) || Promise.resolve();
    const current = previous.catch(() => {}).then(task);
    queues.set(lockKey, current);
    return current.finally(() => {
      if (queues.get(lockKey) === current) queues.delete(lockKey);
    });
  }

  async function saveUnlocked(key, value) {
    const text = JSON.stringify(value);
    if (text === undefined) throw new TypeError('Save data must be JSON-serializable.');
    // Verify the exact bytes before they can displace a known-good primary.
    parseStoredRecord(text);
    await ensureDir();
    const files = pathsFor(key);
    const current = await readCandidate(files.primary);
    if (current.ok) await writeAtomic(files.backup, current.raw);
    await writeAtomic(files.primary, text);
    return true;
  }

  function save(key, value) {
    return withKeyLock(key, () => saveUnlocked(key, value));
  }

  async function loadStatusUnlocked(key, { repair = true } = {}) {
    await ensureDir();
    const files = pathsFor(key);
    const primary = await readCandidate(files.primary);
    if (primary.ok) {
      return {
        value: primary.value,
        source: 'primary',
        recovered: false,
        repairedPrimary: false,
        missing: false,
        primaryError: null,
        backupError: null,
      };
    }

    const backup = await readCandidate(files.backup);
    if (backup.ok) {
      let repairedPrimary = false;
      if (repair) {
        try {
          await writeAtomic(files.primary, backup.raw);
          repairedPrimary = true;
        } catch {}
      }
      return {
        value: backup.value,
        source: 'backup',
        recovered: true,
        repairedPrimary,
        missing: false,
        primaryError: primary.error,
        backupError: null,
      };
    }

    return {
      value: null,
      source: 'none',
      recovered: false,
      repairedPrimary: false,
      missing: primary.missing && backup.missing,
      primaryError: primary.missing ? null : primary.error,
      backupError: backup.missing ? null : backup.error,
    };
  }

  function loadStatus(key, options) {
    return withKeyLock(key, () => loadStatusUnlocked(key, options));
  }

  async function load(key) {
    return (await loadStatus(key)).value;
  }

  async function deleteUnlocked(key) {
    await ensureDir();
    const files = pathsFor(key);
    await Promise.all([
      fsp.rm(files.primary, { force: true }),
      fsp.rm(files.backup, { force: true }),
      fsp.rm(`${files.primary}.replace-old`, { force: true }),
      fsp.rm(`${files.backup}.replace-old`, { force: true }),
    ]);
    return true;
  }

  function del(key) {
    return withKeyLock(key, () => deleteUnlocked(key));
  }

  async function list() {
    await ensureDir();
    const files = await fsp.readdir(dir);
    const keys = new Set();
    for (const file of files) {
      if (file.endsWith('.json')) keys.add(file.slice(0, -5));
      else if (file.endsWith('.json.bak')) keys.add(file.slice(0, -9));
    }
    return [...keys].sort();
  }

  return Object.freeze({ save, load, loadStatus, del, list, pathsFor });
}

module.exports = { createNativeSaveStore, safeKey };
