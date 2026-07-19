// SAVE VALIDATION PRIMITIVES
//
// Persistence is a trust boundary. Browser localStorage, hand-edited fixtures,
// interrupted native writes, and older builds can all hand the simulation data
// that is JSON-shaped without being safe to execute. These helpers deliberately
// know nothing about golf or checkout; feature-specific repair remains with the
// module that owns that state.

const UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const MAX_REPORT_ENTRIES = 500;
const MAX_ARRAY_ITEMS = 300_000;
const MAX_OBJECT_KEYS = 10_000;

export class SaveDataError extends Error {
  constructor(message, { code = 'SAVE_DATA_ERROR', path = '$', cause = null } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'SaveDataError';
    this.code = code;
    this.path = path;
  }
}

export class SaveCompatibilityError extends SaveDataError {
  constructor(message, options = {}) {
    super(message, { ...options, code: options.code || 'SAVE_VERSION_UNSUPPORTED' });
    this.name = 'SaveCompatibilityError';
  }
}

export function isRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function cloneSafeValue(value, depth, seen) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'bigint') return Number(value);
  if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
    return cloneSafeValue(Array.from(value), depth, seen);
  }
  if (depth > 80 || !value || typeof value !== 'object') return undefined;
  if (seen.has(value)) return undefined;
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      const out = [];
      const length = Math.min(value.length, MAX_ARRAY_ITEMS);
      for (let index = 0; index < length; index += 1) {
        const cloned = cloneSafeValue(value[index], depth + 1, seen);
        out.push(cloned === undefined ? null : cloned);
      }
      return out;
    }
    if (!isRecord(value)) return undefined;
    // Persisted feature records are ordinary JSON objects. Keep that shape so
    // strict equality, object spreads, and feature-owned prototype checks see
    // exactly what JSON.parse would have produced. Unsafe keys are still
    // skipped below before assignment.
    const out = {};
    const keys = Object.keys(value).slice(0, MAX_OBJECT_KEYS);
    for (const key of keys) {
      if (UNSAFE_KEYS.has(key)) continue;
      let child;
      try {
        child = value[key];
      } catch {
        continue;
      }
      const cloned = cloneSafeValue(child, depth + 1, seen);
      if (cloned !== undefined) out[key] = cloned;
    }
    return out;
  } finally {
    seen.delete(value);
  }
}

export function cloneSaveValue(value, fallback = null) {
  const cloned = cloneSafeValue(value, 0, new WeakSet());
  return cloned === undefined ? fallback : cloned;
}

export function parseSaveInput(input, { kind = 'save' } = {}) {
  let parsed = input;
  if (typeof input === 'string') {
    try {
      parsed = JSON.parse(input);
    } catch (cause) {
      throw new SaveDataError(`The ${kind} is not valid JSON.`, {
        code: 'SAVE_PARSE_ERROR',
        cause,
      });
    }
  }
  const cloned = cloneSaveValue(parsed, undefined);
  if (!isRecord(cloned)) {
    throw new SaveDataError(`The ${kind} root must be an object.`, {
      code: 'SAVE_ROOT_INVALID',
    });
  }
  return cloned;
}

export function createSaveReport(kind, persistedVersion, currentVersion) {
  return {
    kind,
    persistedVersion,
    currentVersion,
    migrations: [],
    repairs: [],
    warnings: [],
    recovered: false,
    _seen: new Set(),
  };
}

function addReportEntry(report, bucket, path, message) {
  if (!report || !report[bucket] || report[bucket].length >= MAX_REPORT_ENTRIES) return;
  const key = `${bucket}|${path}|${message}`;
  if (report._seen?.has(key)) return;
  report._seen?.add(key);
  report[bucket].push({ path, message });
  if (bucket === 'repairs') report.recovered = true;
}

export function noteRepair(report, path, message) {
  addReportEntry(report, 'repairs', path, message);
}

export function noteWarning(report, path, message) {
  addReportEntry(report, 'warnings', path, message);
}

export function noteMigration(report, version, name) {
  if (!report || report.migrations.some((entry) => entry.version === version)) return;
  report.migrations.push({ version, name });
}

export function finishSaveReport(report) {
  const { _seen, ...publicReport } = report;
  void _seen;
  publicReport.repairs = Object.freeze(publicReport.repairs.map(Object.freeze));
  publicReport.warnings = Object.freeze(publicReport.warnings.map(Object.freeze));
  publicReport.migrations = Object.freeze(publicReport.migrations.map(Object.freeze));
  return Object.freeze(publicReport);
}

export function finiteNumber(value, fallback, {
  integer = false,
  min = -Number.MAX_VALUE,
  max = Number.MAX_VALUE,
} = {}) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  const normalized = integer ? Math.trunc(number) : number;
  return Math.min(max, Math.max(min, normalized));
}

export function mergeSaveDefaults(defaultValue, sourceValue, report, path = '$') {
  if (ArrayBuffer.isView(defaultValue) && !(defaultValue instanceof DataView)) {
    if (!Array.isArray(sourceValue) && !ArrayBuffer.isView(sourceValue)) {
      noteRepair(report, path, 'missing or invalid typed array defaulted');
      return defaultValue.slice();
    }
    return sourceValue;
  }
  if (Array.isArray(defaultValue)) {
    if (!Array.isArray(sourceValue)) {
      noteRepair(report, path, 'missing or invalid array defaulted');
      return cloneSaveValue(defaultValue, []);
    }
    return cloneSaveValue(sourceValue, []);
  }
  if (isRecord(defaultValue)) {
    const source = isRecord(sourceValue) ? sourceValue : {};
    if (!isRecord(sourceValue)) noteRepair(report, path, 'missing or invalid object defaulted');
    const out = {};
    for (const [key, childDefault] of Object.entries(defaultValue)) {
      out[key] = mergeSaveDefaults(childDefault, source[key], report, `${path}.${key}`);
    }
    for (const [key, child] of Object.entries(source)) {
      if (UNSAFE_KEYS.has(key) || Object.hasOwn(out, key)) continue;
      const cloned = cloneSaveValue(child, undefined);
      if (cloned === undefined) {
        noteRepair(report, `${path}.${key}`, 'unsupported value removed');
      } else {
        out[key] = cloned;
      }
    }
    return out;
  }
  if (defaultValue === null) {
    if (sourceValue === undefined) return null;
    const cloned = cloneSaveValue(sourceValue, undefined);
    if (cloned === undefined) {
      noteRepair(report, path, 'unsupported value replaced with null');
      return null;
    }
    return cloned;
  }
  if (typeof defaultValue === 'number') {
    if (!Number.isFinite(sourceValue)) {
      noteRepair(report, path, 'missing or non-finite number defaulted');
      return defaultValue;
    }
    return sourceValue;
  }
  if (typeof defaultValue === 'boolean') {
    if (typeof sourceValue !== 'boolean') {
      noteRepair(report, path, 'missing or invalid boolean defaulted');
      return defaultValue;
    }
    return sourceValue;
  }
  if (typeof defaultValue === 'string') {
    if (typeof sourceValue !== 'string') {
      noteRepair(report, path, 'missing or invalid string defaulted');
      return defaultValue;
    }
    return sourceValue;
  }
  return cloneSaveValue(sourceValue, cloneSaveValue(defaultValue));
}

export function recordsOnly(value, report, path, { max = 100_000 } = {}) {
  if (!Array.isArray(value)) {
    noteRepair(report, path, 'missing or invalid record array defaulted');
    return [];
  }
  const records = [];
  let removed = 0;
  for (const entry of value.slice(0, max)) {
    if (!isRecord(entry)) {
      removed += 1;
      continue;
    }
    records.push(entry);
  }
  removed += Math.max(0, value.length - max);
  if (removed) noteRepair(report, path, `${removed} malformed or excess record(s) removed`);
  return records;
}

export function dedupeRecords(records, keyOf, report, path, {
  keep = 'first',
  allowNull = false,
} = {}) {
  const out = [];
  const indexByKey = new Map();
  let removed = 0;
  for (const record of records) {
    const key = keyOf(record);
    if ((key === null || key === undefined || key === '') && !allowNull) {
      removed += 1;
      continue;
    }
    if (!indexByKey.has(key)) {
      indexByKey.set(key, out.length);
      out.push(record);
      continue;
    }
    removed += 1;
    if (keep === 'last') out[indexByKey.get(key)] = record;
  }
  if (removed) noteRepair(report, path, `${removed} duplicate or identity-less record(s) removed`);
  return out;
}
