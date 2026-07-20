// Persistence facade with player-safe inspection and backup recovery.
// Electron stores files in userData through the preload bridge; browser QA uses
// localStorage with the same result contract.

const native = typeof window !== 'undefined' ? window.fairwayNative : null;
const PREFIX = 'golfempire:';
const BACKUP_SUFFIX = '.backup';

function unsupportedVersion(data, limits = {}) {
  if (!data || typeof data !== 'object') return false;
  if (Number.isFinite(limits.empireVersion) && Number(data.empireVersion) > limits.empireVersion) return true;
  if (!data.empireVersion && Number.isFinite(limits.saveVersion) && Number(data.version) > limits.saveVersion) return true;
  return false;
}

function parseRecord(raw, backupRaw, limits) {
  if (raw == null) return { status: 'missing', data: null };
  try {
    const data = JSON.parse(raw);
    if (unsupportedVersion(data, limits)) return { status: 'unsupported', data: null, version: data.empireVersion || data.version };
    return { status: 'ok', data };
  } catch (error) {
    if (backupRaw != null) {
      try {
        const data = JSON.parse(backupRaw);
        if (unsupportedVersion(data, limits)) return { status: 'unsupported', data: null, version: data.empireVersion || data.version };
        return { status: 'recovered', data, error: 'The latest save was damaged; the previous backup is available.' };
      } catch { /* both copies are damaged */ }
    }
    return { status: 'corrupt', data: null, error: 'This save could not be read.' };
  }
}

export async function saveData(key, obj) {
  if (native) return native.save(key, obj);
  const storageKey = PREFIX + key;
  const json = JSON.stringify(obj);
  const previous = localStorage.getItem(storageKey);
  if (previous != null) localStorage.setItem(storageKey + BACKUP_SUFFIX, previous);
  localStorage.setItem(storageKey, json);
  return true;
}

export async function inspectData(key, limits = {}) {
  if (native?.loadRecord) {
    const record = await native.loadRecord(key);
    if (record.status === 'ok' || record.status === 'recovered') {
      if (unsupportedVersion(record.data, limits)) {
        return { status: 'unsupported', data: null, version: record.data.empireVersion || record.data.version };
      }
    }
    return record;
  }
  const storageKey = PREFIX + key;
  return parseRecord(
    localStorage.getItem(storageKey),
    localStorage.getItem(storageKey + BACKUP_SUFFIX),
    limits,
  );
}

export async function loadData(key) {
  const result = await inspectData(key);
  return result.status === 'ok' || result.status === 'recovered' ? result.data : null;
}

export async function deleteData(key) {
  if (native) return native.del(key);
  const storageKey = PREFIX + key;
  localStorage.removeItem(storageKey);
  localStorage.removeItem(storageKey + BACKUP_SUFFIX);
  return true;
}

export async function listData() {
  if (native) return native.list();
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(PREFIX) && !key.endsWith(BACKUP_SUFFIX)) keys.push(key.slice(PREFIX.length));
  }
  return keys;
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
