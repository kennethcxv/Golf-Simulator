// FAIRWAY STATE — persistence facade.
// Electron: JSON files in the OS user-data dir via the preload bridge.
// Plain browser (dev/QA): localStorage fallback, same API.

const native = typeof window !== 'undefined' ? window.fairwayNative : null;
const PREFIX = 'fairwaystate:';

export async function saveData(key, obj) {
  if (native) return native.save(key, obj);
  localStorage.setItem(PREFIX + key, JSON.stringify(obj));
  return true;
}

export async function loadData(key) {
  if (native) return native.load(key);
  const raw = localStorage.getItem(PREFIX + key);
  return raw ? JSON.parse(raw) : null;
}

export async function deleteData(key) {
  if (native) return native.del(key);
  localStorage.removeItem(PREFIX + key);
  return true;
}

export async function listData() {
  if (native) return native.list();
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(PREFIX)) keys.push(k.slice(PREFIX.length));
  }
  return keys;
}
