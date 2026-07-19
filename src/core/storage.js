// FAIRWAY STATE — persistence facade.
// Electron: JSON files in the OS user-data dir via the preload bridge.
// Plain browser (dev/QA): localStorage fallback, same API.

const native = typeof window !== 'undefined' ? window.fairwayNative : null;
// distinct prefix so browser-QA localStorage never collides with FAIRWAY STATE's
const PREFIX = 'golfempire:';
const BACKUP_PREFIX = 'golfempire-backup:';

function errorInfo(error) {
  if (!error) return null;
  return {
    name: error.name || 'Error',
    code: error.code || 'SAVE_DATA_ERROR',
    message: error.message || String(error),
  };
}

function encoded(value) {
  const text = JSON.stringify(value);
  if (text === undefined) throw new TypeError('Save data must be JSON-serializable.');
  parsedRecord(text);
  return text;
}

function parsedRecord(text) {
  const value = JSON.parse(text);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    const error = new TypeError('Save data root must be an object.');
    error.code = 'SAVE_ROOT_INVALID';
    throw error;
  }
  return value;
}

export async function saveData(key, obj) {
  if (native) return native.save(key, obj);
  const primaryKey = PREFIX + key;
  const backupKey = BACKUP_PREFIX + key;
  const text = encoded(obj);
  const current = localStorage.getItem(primaryKey);
  if (current !== null) {
    try {
      parsedRecord(current);
      localStorage.setItem(backupKey, current);
    } catch {
      // Never replace a known-good backup with a corrupt primary.
    }
  }
  localStorage.setItem(primaryKey, text);
  return true;
}

export async function loadDataWithStatus(key, { repair = true } = {}) {
  if (native?.loadStatus) return native.loadStatus(key, { repair });
  if (native) {
    try {
      const value = await native.load(key);
      return {
        value,
        source: value == null ? 'none' : 'primary',
        recovered: false,
        repairedPrimary: false,
        missing: value == null,
        primaryError: null,
        backupError: null,
      };
    } catch (error) {
      return {
        value: null,
        source: 'none',
        recovered: false,
        repairedPrimary: false,
        missing: false,
        primaryError: errorInfo(error),
        backupError: null,
      };
    }
  }

  const primaryKey = PREFIX + key;
  const backupKey = BACKUP_PREFIX + key;
  const raw = localStorage.getItem(primaryKey);
  let primaryError = null;
  if (raw !== null) {
    try {
      return {
        value: parsedRecord(raw),
        source: 'primary',
        recovered: false,
        repairedPrimary: false,
        missing: false,
        primaryError: null,
        backupError: null,
      };
    } catch (error) {
      primaryError = errorInfo(error);
    }
  }

  const backup = localStorage.getItem(backupKey);
  if (backup !== null) {
    try {
      const value = parsedRecord(backup);
      let repairedPrimary = false;
      if (repair) {
        try {
          localStorage.setItem(primaryKey, backup);
          repairedPrimary = true;
        } catch {}
      }
      return {
        value,
        source: 'backup',
        recovered: true,
        repairedPrimary,
        missing: false,
        primaryError,
        backupError: null,
      };
    } catch (error) {
      return {
        value: null,
        source: 'none',
        recovered: false,
        repairedPrimary: false,
        missing: false,
        primaryError,
        backupError: errorInfo(error),
      };
    }
  }

  return {
    value: null,
    source: 'none',
    recovered: false,
    repairedPrimary: false,
    missing: raw === null,
    primaryError,
    backupError: null,
  };
}

export async function loadData(key) {
  return (await loadDataWithStatus(key)).value;
}

export async function deleteData(key) {
  if (native) return native.del(key);
  localStorage.removeItem(PREFIX + key);
  localStorage.removeItem(BACKUP_PREFIX + key);
  return true;
}

export async function listData() {
  if (native) return native.list();
  const keys = new Set();
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k?.startsWith(PREFIX)) keys.add(k.slice(PREFIX.length));
    else if (k?.startsWith(BACKUP_PREFIX)) keys.add(k.slice(BACKUP_PREFIX.length));
  }
  return [...keys].sort();
}
