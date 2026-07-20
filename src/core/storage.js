// Persistence facade with player-safe inspection and backup recovery.
// Electron stores files in userData through the preload bridge; browser QA uses
// localStorage with the same result contract.

const native = typeof window !== 'undefined' ? window.fairwayNative : null;
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

function unsupportedVersion(data, limits = {}) {
  if (!data || typeof data !== 'object') return false;
  if (Number.isFinite(limits.empireVersion) && Number(data.empireVersion) > limits.empireVersion) return true;
  if (!data.empireVersion && Number.isFinite(limits.saveVersion) && Number(data.version) > limits.saveVersion) return true;
  return false;
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

export async function inspectData(key, limits = {}) {
  const result = await loadDataWithStatus(key, { repair: false });
  const data = result.value;
  if (data == null) {
    if (result.missing) return { status: 'missing', data: null };
    return {
      status: 'corrupt',
      data: null,
      error: result.primaryError?.message || result.backupError?.message || 'This save could not be read.',
    };
  }
  if (unsupportedVersion(data, limits)) {
    return { status: 'unsupported', data: null, version: data.empireVersion || data.version };
  }
  return {
    status: result.recovered ? 'recovered' : 'ok',
    data,
    error: result.recovered ? 'The latest save was damaged; the previous backup is available.' : null,
  };
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

export function summarizeSave(data, metadata = null) {
  if (!data || typeof data !== 'object') return null;
  const active = data.empireVersion
    ? (data.holdings || []).find((holding) => holding.property?.id === data.activeId) || data.holdings?.[0]
    : null;
  const state = active?.state || (!data.empireVersion ? data : null);
  const minutes = Number(state?.clock?.minutes ?? data.clockMinutes ?? 0);
  const minuteOfDay = ((Math.floor(minutes) % 1440) + 1440) % 1440;
  const hour = Math.floor(minuteOfDay / 60);
  const clock = `${((hour + 11) % 12) + 1}:${String(minuteOfDay % 60).padStart(2, '0')} ${hour >= 12 ? 'PM' : 'AM'}`;
  const day = Math.floor(minutes / 1440) + 1;
  return {
    clubName: state?.clubName || active?.property?.name || 'Unclaimed property',
    propertyName: active?.property?.name || state?.clubName || 'Property market',
    mode: data.mode || state?.mode || 'relaxed',
    cash: Number(data.cash ?? state?.cash ?? 0),
    day,
    clock,
    savedAt: Number(metadata?.savedAt || 0) || null,
    condition: metadata?.cond ?? state?.shop?.reno?.condition ?? null,
  };
}

export function summarizeSave(data, metadata = null) {
  if (!data || typeof data !== 'object') return null;
  const active = data.empireVersion
    ? (data.holdings || []).find((holding) => holding.property?.id === data.activeId) || data.holdings?.[0]
    : null;
  const state = active?.state || (!data.empireVersion ? data : null);
  const minutes = Number(state?.clock?.minutes ?? data.clockMinutes ?? 0);
  const minuteOfDay = ((Math.floor(minutes) % 1440) + 1440) % 1440;
  const hour = Math.floor(minuteOfDay / 60);
  const clock = `${((hour + 11) % 12) + 1}:${String(minuteOfDay % 60).padStart(2, '0')} ${hour >= 12 ? 'PM' : 'AM'}`;
  const day = Math.floor(minutes / 1440) + 1;
  return {
    clubName: state?.clubName || active?.property?.name || 'Unclaimed property',
    propertyName: active?.property?.name || state?.clubName || 'Property market',
    mode: data.mode || state?.mode || 'relaxed',
    cash: Number(data.cash ?? state?.cash ?? 0),
    day,
    clock,
    savedAt: Number(metadata?.savedAt || 0) || null,
    condition: metadata?.cond ?? state?.shop?.reno?.condition ?? null,
  };
}

export function summarizeSave(data, metadata = null) {
  if (!data || typeof data !== 'object') return null;
  const active = data.empireVersion
    ? (data.holdings || []).find((holding) => holding.property?.id === data.activeId) || data.holdings?.[0]
    : null;
  const state = active?.state || (!data.empireVersion ? data : null);
  const minutes = Number(state?.clock?.minutes ?? data.clockMinutes ?? 0);
  const minuteOfDay = ((Math.floor(minutes) % 1440) + 1440) % 1440;
  const hour = Math.floor(minuteOfDay / 60);
  const clock = `${((hour + 11) % 12) + 1}:${String(minuteOfDay % 60).padStart(2, '0')} ${hour >= 12 ? 'PM' : 'AM'}`;
  const day = Math.floor(minutes / 1440) + 1;
  return {
    clubName: state?.clubName || active?.property?.name || 'Unclaimed property',
    propertyName: active?.property?.name || state?.clubName || 'Property market',
    mode: data.mode || state?.mode || 'relaxed',
    cash: Number(data.cash ?? state?.cash ?? 0),
    day,
    clock,
    savedAt: Number(metadata?.savedAt || 0) || null,
    condition: metadata?.cond ?? state?.shop?.reno?.condition ?? null,
  };
}
