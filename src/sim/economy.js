// GOLF EMPIRE — authoritative business ledger.
//
// Existing systems still call addRevenue/addExpense/spend. Those functions now
// append immutable entries and maintain the old aggregate cash lines as a
// compatibility view. UI state never creates money. A gameplay command may pass
// an idempotencyKey; replaying that command then returns the original entry and
// moves neither cash nor profit a second time.

import { t } from '../core/i18n.js';

export const LEDGER_VERSION = 2;
export const LEDGER_HISTORY_DAYS = 60;
export const TX_LOG_CAP = 80;

export const LEDGER_LABELS = {
  greenFees: 'Green fees',
  walkIns: 'Walk-in green fees',
  teeTimeBookings: 'Tee-time bookings',
  dues: 'Membership dues',
  guestPasses: 'Guest passes',
  outings: 'Corporate outings',
  range: 'Practice range',
  restaurant: 'Grill room',
  lessons: 'Lessons',
  shopSales: 'Pro-shop sales',
  rentals: 'Club rentals',
  fittings: 'Club fittings',
  reciprocal: 'Reciprocal guests',
  events: 'Events',
  noShowFees: 'No-show fees',
  cancellationFees: 'Cancellation fees',
  bookingRevenue: 'Prepaid green fees',
  bookingDeposits: 'Green-fee deposits',
  bookingBalances: 'Green-fee balances',
  walkInRevenue: 'Walk-in green fees',
  otherRevenue: 'Other revenue',
  wagesStaff: 'Staff wages',
  wagesDayLabor: 'Day labour',
  water: 'Water',
  fertilizer: 'Fertiliser',
  chemicals: 'Chemicals',
  upkeep: 'Maintenance supplies',
  utilities: 'Utilities',
  works: 'Restoration works',
  severance: 'Severance',
  training: 'Training',
  shopOrders: 'Merchandise orders',
  deliveryCosts: 'Delivery costs',
  rentalFleet: 'Rental equipment',
  equipment: 'Equipment',
  cleaningSupplies: 'Cleaning supplies',
  propertyExpenses: 'Property expenses',
  rent: 'Property holding cost',
  checkoutShortage: 'Checkout shortage',
  bookingRefunds: 'Booking refunds',
  costOfGoods: 'Cost of goods sold',
  // Held for the state, not earned. Both post with profitImpact 0 and no revenue/expense
  // aggregate, so they move CASH without ever touching the day's profit — see sim/salesTax.js.
  salesTaxCollected: 'Sales tax collected',
  salesTaxRemitted: 'Sales tax remitted',
};

const CAPITAL_LINES = new Set(['works', 'rentalFleet', 'equipment']);
const INVENTORY_LINES = new Set(['shopOrders', 'deliveryCosts']);
const COGS_LINES = new Set(['costOfGoods']);

export function emptyLines() {
  return {
    revenue: {
      greenFees: 0, walkIns: 0, teeTimeBookings: 0, dues: 0, guestPasses: 0,
      outings: 0, range: 0, restaurant: 0, lessons: 0, shopSales: 0,
      assetSales: 0, rentals: 0, fittings: 0, reciprocal: 0, events: 0,
      noShowFees: 0, cancellationFees: 0, otherRevenue: 0, bookingRevenue: 0,
      bookingDeposits: 0, bookingBalances: 0, walkInRevenue: 0,
    },
    expense: {
      wagesStaff: 0, wagesDayLabor: 0, water: 0, fertilizer: 0, chemicals: 0,
      upkeep: 0, utilities: 0, works: 0, severance: 0, training: 0,
      shopOrders: 0, deliveryCosts: 0, rentalFleet: 0, equipment: 0,
      cleaningSupplies: 0, propertyExpenses: 0, events: 0, rent: 0,
      checkoutShortage: 0, cashOverShort: 0, bookingRefunds: 0, propertyServices: 0,
    },
  };
}

export function initLedger(state) {
  state.ledger = {
    version: LEDGER_VERSION,
    today: emptyLines(),
    yesterday: null,
    history: [],
    txLog: [],
    entries: [],
    outcomes: [],
    dailySummaries: [],
    processedIds: {},
    processedOutcomeIds: {},
    nextSequence: 1,
    postingDay: null,
  };
}

const r2 = (value) => Math.round((Number(value) || 0) * 100) / 100;
const safeCentValue = (value) => typeof value === 'number'
  && Number.isFinite(value)
  && r2(value) === value
  && Number.isSafeInteger(Math.round(value * 100));
const dayOf = (state) => Math.floor((state.clock?.minutes || 0) / 1440);

export function ensureLedger(state) {
  if (!state.ledger) initLedger(state);
  const ledger = state.ledger;
  ledger.version = LEDGER_VERSION;
  ledger.today ||= emptyLines();
  ledger.today.revenue ||= {};
  ledger.today.expense ||= {};
  ledger.history ||= [];
  ledger.txLog = Array.isArray(ledger.txLog)
    ? ledger.txLog
      .filter((entry) => entry && typeof entry === 'object' && typeof entry.key === 'string')
      .slice(0, TX_LOG_CAP)
      .map((entry) => ({
        m: Number.isFinite(entry.m) ? Math.floor(entry.m) : 0,
        kind: ['rev', 'exp', 'refund'].includes(entry.kind) ? entry.kind : 'exp',
        key: entry.key,
        amt: Number.isFinite(entry.amt) ? r2(entry.amt) : 0,
        bal: Number.isFinite(entry.bal) ? r2(entry.bal) : 0,
      }))
    : [];
  ledger.entries ||= [];
  ledger.outcomes ||= [];
  ledger.dailySummaries ||= [];
  ledger.processedIds ||= {};
  ledger.processedOutcomeIds ||= {};
  const pendingCheckouts = state?.shop?.pendingCheckouts;
  const checkoutJournalQuarantined = state?.shop?.pendingCheckoutsQuarantine?.active === true;
  const checkoutJournalKnownEmpty = !checkoutJournalQuarantined && (pendingCheckouts == null
    || (isRecord(pendingCheckouts) && Object.keys(pendingCheckouts).length === 0));
  // Legacy saves predate the checkpoint maps, so rows may normally seed them.
  // A pending checkout is different: its strict recovery gate must see an
  // orphan row as an incomplete/corrupt authority. Healing that orphan here
  // would let recovery skip the money posting while still selling the stock.
  if (checkoutJournalKnownEmpty) {
    for (const entry of ledger.entries) {
      if (entry?.idempotencyKey && entry?.id && !ledger.processedIds[entry.idempotencyKey]) {
        ledger.processedIds[entry.idempotencyKey] = entry.id;
      }
    }
    for (const outcome of ledger.outcomes) {
      if (outcome?.idempotencyKey && outcome?.id && !ledger.processedOutcomeIds[outcome.idempotencyKey]) {
        ledger.processedOutcomeIds[outcome.idempotencyKey] = outcome.id;
      }
    }
  }
  if (!Number.isInteger(ledger.nextSequence) || ledger.nextSequence < 1) {
    ledger.nextSequence = ledger.entries.length + 1;
  }
  if (ledger.postingDay === undefined) ledger.postingDay = null;
  return ledger;
}

export function beginLedgerClose(state, dayAbs) {
  ensureLedger(state).postingDay = dayAbs;
}

// THE TRANSACTION LOG. Every movement addRevenue/addExpense/unbill lets through is also
// filed as one event row: minute, direction, ledger line, amount, and the balance the till
// held after the movement. Because it is written HERE — at the single chokepoint — the log
// can never disagree with the lines above it. Bounded so the save stays small; the daily
// history remains the long-term record.
function logTx(state, kind, key, amt) {
  const led = state.ledger;
  if (!led) return;
  if (!Array.isArray(led.txLog)) led.txLog = [];
  led.txLog.unshift({
    m: state.clock && Number.isFinite(state.clock.minutes) ? Math.floor(state.clock.minutes) : 0,
    kind, // 'rev' | 'exp' | 'refund'
    key,
    amt: r2(amt),
    bal: r2(state.cash),
  });
  if (led.txLog.length > TX_LOG_CAP) led.txLog.length = TX_LOG_CAP;
}

function safe(value) {
  const raw = String(value ?? 'unknown');
  const normalized = raw.replace(/[^a-zA-Z0-9:_-]+/g, '-');
  if (normalized === raw && raw.length <= 160) return raw;
  let hash = 2166136261;
  for (let index = 0; index < raw.length; index += 1) {
    hash ^= raw.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${normalized.slice(0, 148)}-${(hash >>> 0).toString(36)}`;
}

function propertyIdOf(state) {
  return state.property?.id || state.propertyId
    || `club-${safe(state.seed ?? state.clubName ?? 'unknown')}`;
}

function accountingClass(direction, lineKey, meta) {
  if (meta.accountingClass) return meta.accountingClass;
  if (direction === 'revenue') return 'revenue';
  if (COGS_LINES.has(lineKey)) return 'cogs';
  if (CAPITAL_LINES.has(lineKey)) return 'capital';
  if (INVENTORY_LINES.has(lineKey)) return 'inventory';
  return 'operating';
}

function generatedKey(ledger) {
  const key = `generated:${ledger.nextSequence}`;
  ledger.nextSequence += 1;
  return key;
}

function aggregateCashLine(ledger, side, key, amount) {
  if (!side || !key || !Number.isFinite(amount) || amount === 0) return;
  const lines = ledger.today[side];
  lines[key] = r2((lines[key] || 0) + amount);
}

function isRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function canAssignProperty(target, key) {
  if (!target || (typeof target !== 'object' && typeof target !== 'function')) return false;
  const own = Object.getOwnPropertyDescriptor(target, key);
  if (own) {
    return Object.hasOwn(own, 'value') && own.writable === true;
  }
  let prototype = Object.getPrototypeOf(target);
  while (prototype) {
    const inherited = Object.getOwnPropertyDescriptor(prototype, key);
    if (inherited) {
      if (!Object.hasOwn(inherited, 'value')) return false;
      if (inherited.writable !== true) return false;
      break;
    }
    prototype = Object.getPrototypeOf(prototype);
  }
  return Object.isExtensible(target);
}

function canAppend(array) {
  return Array.isArray(array)
    && Object.isExtensible(array)
    && canAssignProperty(array, 'length');
}

function own(target, key) {
  return !!target && Object.prototype.hasOwnProperty.call(target, key);
}

function sameIdentityValue(actual, expected, key) {
  if (key !== 'metadata') return actual === expected;
  try {
    return JSON.stringify(actual || {}) === JSON.stringify(expected);
  } catch {
    return false;
  }
}

function identityConflict(row, preview) {
  return Object.entries(preview).some(([key, value]) => (
    !sameIdentityValue(row?.[key], value, key)
  ));
}

function rowsWithIdentity(rows, key, value) {
  return Array.isArray(rows)
    ? rows.filter((row) => row && row[key] === value)
    : [];
}

function identityOwnershipConflict(rows, checkpointMap, expectedId, idempotencyKey) {
  const idRows = rowsWithIdentity(rows, 'id', expectedId);
  if (idRows.length > 1) return { conflict: true, ambiguous: true };
  if (idRows.length === 1 && idRows[0].idempotencyKey !== idempotencyKey) {
    return { conflict: true, row: idRows[0] };
  }
  const reverseKeys = isRecord(checkpointMap)
    ? Object.entries(checkpointMap)
      .filter(([key, id]) => id === expectedId && key !== idempotencyKey)
      .map(([key]) => key)
    : [];
  if (reverseKeys.length) return { conflict: true, reverseKeys };
  return { conflict: false };
}

function ledgerAuthorityWritable(state, {
  idempotencyKey,
  spec = {},
  direction = 'revenue',
  lineKey = 'otherRevenue',
  amount = 0,
  outcome = false,
} = {}) {
  const label = outcome ? 'outcome authority' : 'ledger authority';
  if (!isRecord(state)) return { ok: false, reason: t('ledger.integrityUnavailable'), diagnostic: `The ${label} is not writable.` };
  const ledger = state.ledger;
  if (ledger == null) {
    if (!canAssignProperty(state, 'ledger')
        || (!outcome && !canAssignProperty(state, 'cash'))) {
      return { ok: false, reason: t('ledger.integrityUnavailable'), diagnostic: `The ${label} is not writable.` };
    }
    return { ok: true };
  }
  if (!isRecord(ledger)
      || !isRecord(ledger.today)
      || !isRecord(ledger.today.revenue)
      || !isRecord(ledger.today.expense)
      || !Array.isArray(ledger.history)
      || !Array.isArray(ledger.txLog)
      || !Array.isArray(ledger.entries)
      || !Array.isArray(ledger.outcomes)
      || !Array.isArray(ledger.dailySummaries)
      || !isRecord(ledger.processedIds)
      || !isRecord(ledger.processedOutcomeIds)
      || !Number.isInteger(ledger.nextSequence)
      || ledger.nextSequence < 1
      || ledger.postingDay === undefined) {
    return { ok: false, reason: t('ledger.integrityUnavailable'), diagnostic: `The ${label} is unavailable or not writable.` };
  }

  // ensureLedger normalizes these two properties on every call, even when the
  // remaining ledger shape is already current.
  if (!canAssignProperty(ledger, 'version') || !canAssignProperty(ledger, 'txLog')) {
    return { ok: false, reason: t('ledger.integrityUnavailable'), diagnostic: `The ${label} is not writable.` };
  }
  for (const entry of ledger.entries) {
    if (entry?.idempotencyKey && entry?.id && !ledger.processedIds[entry.idempotencyKey]
        && !canAssignProperty(ledger.processedIds, entry.idempotencyKey)) {
      return { ok: false, reason: t('ledger.integrityUnavailable'), diagnostic: 'The ledger checkpoint authority is not writable.' };
    }
  }
  for (const recorded of ledger.outcomes) {
    if (recorded?.idempotencyKey && recorded?.id
        && !ledger.processedOutcomeIds[recorded.idempotencyKey]
        && !canAssignProperty(ledger.processedOutcomeIds, recorded.idempotencyKey)) {
      return { ok: false, reason: t('ledger.integrityUnavailable'), diagnostic: 'The outcome checkpoint authority is not writable.' };
    }
  }

  const checkpointMap = outcome ? ledger.processedOutcomeIds : ledger.processedIds;
  const rows = outcome ? ledger.outcomes : ledger.entries;
  if (!canAppend(rows)) return { ok: false, reason: t('ledger.integrityUnavailable'), diagnostic: `The ${label} is not writable.` };
  if (idempotencyKey) {
    if (!canAssignProperty(checkpointMap, idempotencyKey)) {
      return {
        ok: false,
        reason: t('ledger.integrityUnavailable'),
        diagnostic: outcome
          ? 'The outcome checkpoint authority is not writable.'
          : 'The ledger checkpoint authority is not writable.',
      };
    }
  } else if (!Object.isExtensible(checkpointMap)
      || !canAssignProperty(ledger, 'nextSequence')) {
    return { ok: false, reason: t('ledger.integrityUnavailable'), diagnostic: `The ${label} is not writable.` };
  }

  if (outcome) return { ok: true };
  if (!canAssignProperty(state, 'cash')) {
    return { ok: false, reason: t('ledger.integrityUnavailable'), diagnostic: 'The ledger cash authority is not writable.' };
  }
  const cashImpact = r2(spec.cashImpact ?? (
    direction === 'expense' ? -amount : direction === 'reversal' ? amount : amount
  ));
  const currentCash = state.cash == null ? 0 : Number(state.cash);
  const projectedCash = r2(currentCash + cashImpact);
  if (!safeCentValue(currentCash) || !safeCentValue(cashImpact)
      || !Number.isFinite(currentCash + cashImpact) || !safeCentValue(projectedCash)) {
    return { ok: false, reason: t('ledger.integrityUnavailable'), diagnostic: 'The ledger cash projection is outside safe currency bounds.' };
  }
  const aggregate = Object.prototype.hasOwnProperty.call(spec, 'aggregate')
    ? spec.aggregate
    : direction === 'revenue' ? { side: 'revenue', key: lineKey, amount }
      : direction === 'expense' && Number(spec.cashImpact ?? -amount) < 0
        ? { side: 'expense', key: lineKey, amount }
        : null;
  if (aggregate) {
    const lines = ledger.today[aggregate.side];
    if (!isRecord(aggregate)
        || !['revenue', 'expense'].includes(aggregate.side)
        || typeof aggregate.key !== 'string'
        || !aggregate.key
        || typeof aggregate.amount !== 'number'
        || !Number.isFinite(aggregate.amount)
        || !isRecord(lines)
        || !canAssignProperty(lines, aggregate.key)) {
      return { ok: false, reason: t('ledger.integrityUnavailable'), diagnostic: 'The ledger aggregate authority is not writable.' };
    }
    const current = own(lines, aggregate.key) ? lines[aggregate.key] : 0;
    if (typeof current !== 'number'
        || !Number.isFinite(current)
        || !safeCentValue(current)
        || !safeCentValue(aggregate.amount)
        || !Number.isFinite(current + aggregate.amount)
        || !safeCentValue(r2(current + aggregate.amount))) {
      return { ok: false, reason: t('ledger.integrityUnavailable'), diagnostic: 'The ledger aggregate value is invalid.' };
    }
  }
  return { ok: true };
}

// Validate a durable posting without initializing, repairing, or otherwise
// touching the ledger. Multi-authority transactions use this immediately before
// committing stock or a physical drawer, so every required book entry is known
// to be postable first.
export function preflightLedgerEntry(state, spec = {}) {
  let numericAmount;
  try {
    numericAmount = Number(spec.amount);
  } catch {
    return { ok: false, reason: 'Ledger amounts must be finite.' };
  }
  if (!Number.isFinite(numericAmount)) {
    return { ok: false, reason: 'Ledger amounts must be finite.' };
  }
  const amount = r2(Math.abs(numericAmount));
  if (!(amount > 0)) return { ok: false, reason: 'Ledger amounts must be positive.' };

  const direction = spec.direction === 'expense'
    ? 'expense'
    : spec.direction === 'reversal' ? 'reversal' : 'revenue';
  const lineKey = spec.lineKey || spec.category
    || (direction === 'revenue' ? 'otherRevenue' : 'propertyExpenses');
  const klass = accountingClass(direction, lineKey, spec);
  const cashImpact = r2(spec.cashImpact ?? (
    direction === 'expense' ? -amount : direction === 'reversal' ? amount : amount
  ));
  const profitImpact = r2(spec.profitImpact ?? (
    direction === 'revenue' ? amount
      : direction === 'expense' && (klass === 'operating' || klass === 'cogs') ? -amount
        : direction === 'reversal' && klass === 'operating' ? amount
          : 0
  ));
  if (!Number.isFinite(cashImpact) || !Number.isFinite(profitImpact)
      || !safeCentValue(amount) || !safeCentValue(cashImpact)
      || !safeCentValue(profitImpact)) {
    return { ok: false, reason: 'Ledger impacts must be finite.' };
  }

  // Generated keys are intentionally not previewed: reserving one would mutate
  // nextSequence. Atomic callers always provide their stable command key.
  const idempotencyKey = spec.idempotencyKey ? safe(spec.idempotencyKey) : null;
  const preview = {
    direction,
    lineKey,
    category: spec.category || lineKey,
    accountingClass: klass,
    amount,
    cashImpact,
    profitImpact,
    relatedId: spec.relatedId == null ? null : String(spec.relatedId),
  };
  const strictIdentity = spec.strictIdentity === true;
  const ledger = state && state.ledger;
  const propertyId = safe(spec.propertyId || propertyIdOf(state));
  const identityPreview = strictIdentity && idempotencyKey ? {
    ...preview,
    id: spec.entryId || `le:${propertyId}:${idempotencyKey}`,
    idempotencyKey,
    day: Number.isInteger(spec.day) ? spec.day
      : Number.isInteger(ledger?.postingDay) ? ledger.postingDay : dayOf(state),
    timestamp: Number.isFinite(spec.timestamp) ? spec.timestamp
      : Number.isInteger(ledger?.postingDay)
        ? ledger.postingDay * 1440 + 1439
        : Math.round(state?.clock?.minutes || dayOf(state) * 1440),
    description: spec.description || LEDGER_LABELS[lineKey] || lineKey,
    propertyId,
    source: spec.source || 'simulation',
    units: Number.isFinite(spec.units) ? spec.units : null,
    customerCount: Number.isFinite(spec.customerCount) ? spec.customerCount : null,
    metadata: spec.metadata && typeof spec.metadata === 'object' ? { ...spec.metadata } : {},
  } : preview;
  if (!idempotencyKey) {
    const writable = ledgerAuthorityWritable(state, {
      idempotencyKey: null,
      spec,
      direction,
      lineKey,
      amount,
    });
    if (!writable.ok) return writable;
    return { ok: true, duplicate: false, idempotencyKey: null, preview };
  }

  const checkpointMap = isRecord(ledger?.processedIds) ? ledger.processedIds : null;
  const checkpointExists = own(checkpointMap, idempotencyKey);
  const priorId = checkpointExists ? checkpointMap[idempotencyKey] : null;
  const keyRows = rowsWithIdentity(ledger?.entries, 'idempotencyKey', idempotencyKey);
  const expectedId = spec.entryId || `le:${propertyId}:${idempotencyKey}`;
  const ownership = identityOwnershipConflict(
    ledger?.entries,
    checkpointMap,
    expectedId,
    idempotencyKey,
  );
  if (ownership.conflict) {
    return {
      ok: false,
      duplicate: true,
      idempotencyKey,
      entry: ownership.row || null,
      reason: t('ledger.integrityUnavailable'),
      diagnostic: ownership.ambiguous
        ? 'The ledger entry identity is ambiguous.'
        : 'That ledger entry identity belongs to a different idempotency key.',
    };
  }
  if (!checkpointExists) {
    if (keyRows.length > 1) {
      return {
        ok: false,
        duplicate: true,
        idempotencyKey,
        reason: t('ledger.integrityUnavailable'), diagnostic: 'The ledger idempotency key is ambiguous.',
      };
    }
    if (keyRows.length === 1) {
      const [orphan] = keyRows;
      if (typeof orphan.id !== 'string' || !orphan.id) {
        return {
          ok: false,
          duplicate: true,
          idempotencyKey,
          reason: t('ledger.integrityUnavailable'), diagnostic: 'The ledger idempotency checkpoint is incomplete.',
        };
      }
      const idRows = rowsWithIdentity(ledger.entries, 'id', orphan.id);
      if (idRows.length !== 1) {
        return {
          ok: false,
          duplicate: true,
          idempotencyKey,
          reason: t('ledger.integrityUnavailable'), diagnostic: 'The ledger idempotency key is ambiguous.',
        };
      }
      if (identityConflict(orphan, identityPreview)) {
        return {
          ok: false,
          duplicate: true,
          idempotencyKey,
          entry: orphan,
          reason: t('ledger.integrityUnavailable'), diagnostic: 'That ledger key belongs to a different posting.',
        };
      }
      return {
        ok: false,
        duplicate: true,
        orphan: true,
        idempotencyKey,
        entry: orphan,
        preview: identityPreview,
        reason: t('ledger.integrityUnavailable'), diagnostic: 'The ledger idempotency checkpoint is incomplete.',
      };
    }
    const writable = ledgerAuthorityWritable(state, {
      idempotencyKey,
      spec,
      direction,
      lineKey,
      amount,
    });
    if (!writable.ok) return writable;
    return { ok: true, duplicate: false, idempotencyKey, preview };
  }
  if (typeof priorId !== 'string' || !priorId) {
    return {
      ok: false,
      duplicate: true,
      idempotencyKey,
      reason: 'The ledger idempotency checkpoint is incomplete.',
    };
  }
  if (priorId !== expectedId) {
    return {
      ok: false,
      duplicate: true,
      idempotencyKey,
      reason: t('ledger.integrityUnavailable'), diagnostic: 'The ledger idempotency checkpoint is incomplete or points at a different entry identity.',
    };
  }
  const idRows = rowsWithIdentity(ledger?.entries, 'id', priorId);
  if (idRows.length !== 1) {
    return {
      ok: false,
      duplicate: true,
      idempotencyKey,
      reason: t('ledger.integrityUnavailable'),
      diagnostic: idRows.length > 1
        ? 'The ledger idempotency key is ambiguous.'
        : 'The ledger idempotency checkpoint is incomplete.',
    };
  }
  const [entry] = idRows;
  if (keyRows.length !== 1 || keyRows[0] !== entry) {
    return {
      ok: false,
      duplicate: true,
      idempotencyKey,
      entry,
      reason: t('ledger.integrityUnavailable'),
      diagnostic: keyRows.length > 1
        ? 'The ledger idempotency key is ambiguous.'
        : 'That ledger key belongs to a different posting.',
    };
  }
  if (identityConflict(entry, identityPreview)) {
    return {
      ok: false,
      duplicate: true,
      idempotencyKey,
      entry,
      reason: 'That ledger key belongs to a different posting.',
    };
  }
  return { ok: true, duplicate: true, idempotencyKey, entry, preview: identityPreview };
}

export function postLedgerEntry(state, spec = {}) {
  // Direct legacy callers may carry the old aggregate-only ledger shell. Bring
  // that shell to the current ledger shape before validating the posting. Atomic
  // multi-authority callers still invoke preflightLedgerEntry themselves first,
  // so their rejection path remains mutation-free.
  const ledger = ensureLedger(state);
  const preflight = preflightLedgerEntry(state, spec);
  if (!preflight.ok) return preflight;
  if (preflight.duplicate) {
    return { ok: true, duplicate: true, entry: preflight.entry || null };
  }
  const direction = spec.direction === 'expense'
    ? 'expense'
    : spec.direction === 'reversal' ? 'reversal' : 'revenue';
  if (!Number.isFinite(Number(spec.amount))) {
    return { ok: false, reason: 'Ledger amounts must be finite.' };
  }
  const amount = r2(Math.abs(spec.amount));
  if (!(amount > 0)) return { ok: false, reason: 'Ledger amounts must be positive.' };

  const idempotencyKey = safe(spec.idempotencyKey || generatedKey(ledger));
  const priorId = ledger.processedIds[idempotencyKey];
  if (priorId) {
    return {
      ok: true,
      duplicate: true,
      entry: ledger.entries.find((entry) => entry.id === priorId) || null,
    };
  }

  const propertyId = safe(spec.propertyId || propertyIdOf(state));
  const day = Number.isInteger(spec.day)
    ? spec.day
    : Number.isInteger(ledger.postingDay) ? ledger.postingDay : dayOf(state);
  const timestamp = Number.isFinite(spec.timestamp)
    ? spec.timestamp
    : Number.isInteger(ledger.postingDay)
      ? day * 1440 + 1439
      : Math.round(state.clock?.minutes || day * 1440);
  const lineKey = spec.lineKey || spec.category
    || (direction === 'revenue' ? 'otherRevenue' : 'propertyExpenses');
  const klass = accountingClass(direction, lineKey, spec);
  const cashImpact = r2(spec.cashImpact ?? (
    direction === 'expense' ? -amount : direction === 'reversal' ? amount : amount
  ));
  const profitImpact = r2(spec.profitImpact ?? (
    direction === 'revenue' ? amount
      : direction === 'expense' && (klass === 'operating' || klass === 'cogs') ? -amount
        : direction === 'reversal' && klass === 'operating' ? amount
          : 0
  ));
  const entry = {
    id: spec.entryId || `le:${propertyId}:${idempotencyKey}`,
    idempotencyKey,
    timestamp,
    day,
    direction,
    category: spec.category || lineKey,
    lineKey,
    accountingClass: klass,
    description: spec.description || LEDGER_LABELS[lineKey] || lineKey,
    amount,
    cashImpact,
    profitImpact,
    relatedId: spec.relatedId == null ? null : String(spec.relatedId),
    propertyId,
    source: spec.source || 'simulation',
    units: Number.isFinite(spec.units) ? spec.units : null,
    customerCount: Number.isFinite(spec.customerCount) ? spec.customerCount : null,
    metadata: spec.metadata && typeof spec.metadata === 'object' ? { ...spec.metadata } : {},
  };

  const projectedCash = r2((state.cash || 0) + cashImpact);
  if (!safeCentValue(projectedCash)) {
    return { ok: false, reason: t('ledger.integrityUnavailable'), diagnostic: 'The ledger cash projection is outside safe currency bounds.' };
  }

  ledger.entries.push(entry);
  ledger.processedIds[idempotencyKey] = entry.id;
  state.cash = projectedCash;
  logTx(
    state,
    direction === 'revenue' ? 'rev' : direction === 'reversal' ? 'refund' : 'exp',
    lineKey,
    amount,
  );

  const aggregate = Object.prototype.hasOwnProperty.call(spec, 'aggregate')
    ? spec.aggregate
    : direction === 'revenue' ? { side: 'revenue', key: lineKey, amount }
      : direction === 'expense' && cashImpact < 0 ? { side: 'expense', key: lineKey, amount }
        : null;
  if (aggregate) aggregateCashLine(ledger, aggregate.side, aggregate.key, aggregate.amount);
  return { ok: true, duplicate: false, entry };
}

// NaN is the one amount that must never move: `NaN <= 0` is false, so a naive
// guard lets it through, `cash += NaN` poisons the balance, and the corruption
// then survives every close-of-books (this exact chain took a live save down —
// a reservation with no fee posted round2(undefined) into greenFees).
export function addRevenue(state, key, amount, meta = {}) {
  const amt = r2(amount);
  if (!(amt > 0) || !safeCentValue(amt)) return { ok: false, reason: t('ledger.integrityUnavailable'), diagnostic: 'Revenue must be a safe positive currency amount.' };
  if (!state.ledger) {
    const projectedCash = r2((state.cash || 0) + amt);
    if (!safeCentValue(Number(state.cash || 0)) || !safeCentValue(projectedCash)) {
      return { ok: false, reason: t('ledger.integrityUnavailable'), diagnostic: 'The cash projection is outside safe currency bounds.' };
    }
    state.cash = projectedCash;
    return { ok: true, legacy: true };
  }
  return postLedgerEntry(state, {
    ...meta,
    direction: 'revenue',
    lineKey: key,
    category: meta.category || key,
    amount: amt,
  });
}

export function addExpense(state, key, amount, meta = {}) {
  const amt = r2(amount);
  if (!(amt > 0) || !safeCentValue(amt)) return { ok: false, reason: t('ledger.integrityUnavailable'), diagnostic: 'Expense must be a safe positive currency amount.' };
  if (!state.ledger) {
    const projectedCash = r2((state.cash || 0) - amt);
    if (!safeCentValue(Number(state.cash || 0)) || !safeCentValue(projectedCash)) {
      return { ok: false, reason: t('ledger.integrityUnavailable'), diagnostic: 'The cash projection is outside safe currency bounds.' };
    }
    state.cash = projectedCash;
    return { ok: true, legacy: true };
  }
  return postLedgerEntry(state, {
    ...meta,
    direction: 'expense',
    lineKey: key,
    category: meta.category || key,
    amount: amt,
  });
}

export function addCostOfGoods(state, amount, meta = {}) {
  return postLedgerEntry(state, {
    ...meta,
    direction: 'expense',
    lineKey: 'costOfGoods',
    category: meta.category || 'costOfGoods',
    accountingClass: 'cogs',
    cashImpact: 0,
    aggregate: null,
    amount,
  });
}

// UNWIND A BOOKING THAT NEVER HAPPENED.
//
// A cancelled supplier order has to give back money that was already spent. Routing that through
// addRevenue would balance the CASH and lie about the BOOKS: the day would show a purchase and a
// mysterious matching income, and every margin on the Finances page would be wrong.
//
// So reverse the original entry instead. Cash back, expense line back down, no trace — which is
// what "cancelled" means. It is the one place a line may move backwards, and only ever by an
// amount that was genuinely booked to it.
export function unbill(state, key, amount, meta = {}) {
  const amt = r2(amount);
  if (!(amt > 0) || !safeCentValue(amt)) return { ok: false, reason: t('ledger.integrityUnavailable'), diagnostic: 'Refund must be a safe positive currency amount.' };
  if (!state.ledger) {
    const projectedCash = r2((state.cash || 0) + amt);
    if (!safeCentValue(Number(state.cash || 0)) || !safeCentValue(projectedCash)) {
      return { ok: false, reason: t('ledger.integrityUnavailable'), diagnostic: 'The cash projection is outside safe currency bounds.' };
    }
    state.cash = projectedCash;
    return { ok: true, legacy: true };
  }
  return postLedgerEntry(state, {
    ...meta,
    direction: 'reversal',
    lineKey: key,
    category: meta.category || key,
    amount: amt,
    accountingClass: meta.accountingClass || accountingClass('expense', key, meta),
    aggregate: { side: 'expense', key, amount: -amt },
    description: meta.description || `Refund: ${LEDGER_LABELS[key] || key}`,
  });
}

// Spend that works with or without a ledger (some unit tests use bare states),
// so sim modules can bill consistently from anywhere.
export function spend(state, key, amount, meta = {}) {
  return addExpense(state, key, amount, meta);
}

export function totals(lines) {
  let revenue = 0;
  let expense = 0;
  for (const value of Object.values(lines?.revenue || {})) revenue += value;
  for (const value of Object.values(lines?.expense || {})) expense += value;
  return { revenue: r2(revenue), expense: r2(expense), net: r2(revenue - expense) };
}

export function recordOutcome(state, spec = {}) {
  const ledger = ensureLedger(state);
  const idempotencyKey = safe(spec.idempotencyKey || `outcome:${generatedKey(ledger)}`);
  const priorId = ledger.processedOutcomeIds[idempotencyKey];
  if (priorId) {
    return { ok: true, duplicate: true, outcome: ledger.outcomes.find((outcome) => outcome.id === priorId) || null };
  }
  const propertyId = safe(spec.propertyId || propertyIdOf(state));
  const day = Number.isInteger(spec.day)
    ? spec.day
    : Number.isInteger(ledger.postingDay)
      ? ledger.postingDay
      : dayOf(state);
  const outcome = {
    id: spec.id || `out:${propertyId}:${idempotencyKey}`,
    idempotencyKey,
    timestamp: Number.isFinite(spec.timestamp) ? spec.timestamp
      : Number.isInteger(ledger.postingDay) ? day * 1440 + 1439
        : Math.round(state.clock?.minutes || day * 1440),
    day,
    type: spec.type || 'operational',
    count: Number.isFinite(spec.count) ? spec.count : 1,
    amount: r2(spec.amount || 0),
    reason: spec.reason || '',
    relatedId: spec.relatedId == null ? null : String(spec.relatedId),
    propertyId,
    metadata: spec.metadata && typeof spec.metadata === 'object' ? { ...spec.metadata } : {},
  };
  ledger.outcomes.push(outcome);
  ledger.processedOutcomeIds[idempotencyKey] = outcome.id;
  return { ok: true, duplicate: false, outcome };
}

// Pure durable-outcome preview for multi-authority commands. This deliberately
// mirrors recordOutcome's identity fields without initializing or repairing the
// ledger: a torn/mismatched checkpoint must be rejected before stock or cash
// moves, not treated as an already-completed outcome.
export function preflightOutcome(state, spec = {}) {
  if (!spec.idempotencyKey) {
    return { ok: false, reason: t('ledger.integrityUnavailable'), diagnostic: 'Durable outcomes need a stable idempotency key.' };
  }
  const idempotencyKey = safe(spec.idempotencyKey);
  const ledger = state?.ledger;
  const propertyId = safe(spec.propertyId || propertyIdOf(state || {}));
  const preview = {
    id: spec.id || `out:${propertyId}:${idempotencyKey}`,
    idempotencyKey,
    day: Number.isInteger(spec.day) ? spec.day
      : Number.isInteger(ledger?.postingDay) ? ledger.postingDay : dayOf(state),
    timestamp: Number.isFinite(spec.timestamp) ? spec.timestamp
      : Number.isInteger(ledger?.postingDay)
        ? ledger.postingDay * 1440 + 1439
        : Math.round(state?.clock?.minutes || dayOf(state) * 1440),
    propertyId,
    type: spec.type || 'operational',
    count: Number.isFinite(spec.count) ? spec.count : 1,
    amount: r2(spec.amount || 0),
    reason: spec.reason || '',
    relatedId: spec.relatedId == null ? null : String(spec.relatedId),
    metadata: spec.metadata && typeof spec.metadata === 'object' ? { ...spec.metadata } : {},
  };
  const checkpointMap = isRecord(ledger?.processedOutcomeIds)
    ? ledger.processedOutcomeIds
    : null;
  const checkpointExists = own(checkpointMap, idempotencyKey);
  const priorId = checkpointExists ? checkpointMap[idempotencyKey] : null;
  const keyRows = rowsWithIdentity(ledger?.outcomes, 'idempotencyKey', idempotencyKey);
  const ownership = identityOwnershipConflict(
    ledger?.outcomes,
    checkpointMap,
    preview.id,
    idempotencyKey,
  );
  if (ownership.conflict) {
    return {
      ok: false,
      duplicate: true,
      idempotencyKey,
      outcome: ownership.row || null,
      reason: t('ledger.integrityUnavailable'),
      diagnostic: ownership.ambiguous
        ? 'The outcome identity is ambiguous.'
        : 'That outcome identity belongs to a different idempotency key.',
    };
  }
  if (!checkpointExists) {
    if (keyRows.length > 1) {
      return {
        ok: false,
        duplicate: true,
        idempotencyKey,
        reason: t('ledger.integrityUnavailable'), diagnostic: 'The outcome idempotency key is ambiguous.',
      };
    }
    if (keyRows.length === 1) {
      const [orphan] = keyRows;
      if (typeof orphan.id !== 'string' || !orphan.id) {
        return {
          ok: false,
          duplicate: true,
          idempotencyKey,
          reason: t('ledger.integrityUnavailable'), diagnostic: 'The outcome idempotency checkpoint is incomplete.',
        };
      }
      const idRows = rowsWithIdentity(ledger.outcomes, 'id', orphan.id);
      if (idRows.length !== 1) {
        return {
          ok: false,
          duplicate: true,
          idempotencyKey,
          reason: t('ledger.integrityUnavailable'), diagnostic: 'The outcome idempotency key is ambiguous.',
        };
      }
      if (identityConflict(orphan, preview)) {
        return {
          ok: false,
          duplicate: true,
          idempotencyKey,
          outcome: orphan,
          reason: t('ledger.integrityUnavailable'), diagnostic: 'That outcome key belongs to a different event.',
        };
      }
      return {
        ok: false,
        duplicate: true,
        orphan: true,
        idempotencyKey,
        outcome: orphan,
        preview,
        reason: t('ledger.integrityUnavailable'), diagnostic: 'The outcome idempotency checkpoint is incomplete.',
      };
    }
    const writable = ledgerAuthorityWritable(state, {
      idempotencyKey,
      spec,
      outcome: true,
    });
    if (!writable.ok) return writable;
    return { ok: true, duplicate: false, idempotencyKey, preview };
  }
  if (typeof priorId !== 'string' || !priorId) {
    return {
      ok: false,
      duplicate: true,
      idempotencyKey,
      reason: t('ledger.integrityUnavailable'), diagnostic: 'The outcome idempotency checkpoint is incomplete.',
    };
  }
  if (priorId !== preview.id) {
    return {
      ok: false,
      duplicate: true,
      idempotencyKey,
      reason: t('ledger.integrityUnavailable'), diagnostic: 'The outcome idempotency checkpoint is incomplete or points at a different outcome identity.',
    };
  }
  const idRows = rowsWithIdentity(ledger?.outcomes, 'id', priorId);
  if (idRows.length !== 1) {
    return {
      ok: false,
      duplicate: true,
      idempotencyKey,
      reason: t('ledger.integrityUnavailable'),
      diagnostic: idRows.length > 1
        ? 'The outcome idempotency key is ambiguous.'
        : 'The outcome idempotency checkpoint is incomplete.',
    };
  }
  const [outcome] = idRows;
  if (keyRows.length !== 1 || keyRows[0] !== outcome) {
    return {
      ok: false,
      duplicate: true,
      idempotencyKey,
      outcome,
      reason: t('ledger.integrityUnavailable'),
      diagnostic: keyRows.length > 1
        ? 'The outcome idempotency key is ambiguous.'
        : 'That outcome key belongs to a different event.',
    };
  }
  if (identityConflict(outcome, preview)) {
    return {
      ok: false,
      duplicate: true,
      idempotencyKey,
      outcome,
      reason: t('ledger.integrityUnavailable'), diagnostic: 'That outcome key belongs to a different event.',
    };
  }
  return { ok: true, duplicate: true, idempotencyKey, outcome, preview };
}

export function entriesInWindow(state, fromDay, toDay = fromDay) {
  const ledger = ensureLedger(state);
  return ledger.entries.filter((entry) => entry.day >= fromDay && entry.day <= toDay);
}

export function outcomesInWindow(state, fromDay, toDay = fromDay) {
  const ledger = ensureLedger(state);
  return ledger.outcomes.filter((outcome) => outcome.day >= fromDay && outcome.day <= toDay);
}

export function financialSummary(state, fromDay, toDay = fromDay) {
  const entries = entriesInWindow(state, fromDay, toDay);
  const summary = {
    fromDay,
    toDay,
    grossRevenue: 0,
    costOfGoodsSold: 0,
    operatingExpenses: 0,
    netProfit: 0,
    cashChange: 0,
    inventoryPurchases: 0,
    restorationInvestment: 0,
    revenueByCategory: {},
    expenseByCategory: {},
    entryCount: entries.length,
  };
  for (const entry of entries) {
    summary.cashChange += entry.cashImpact || 0;
    summary.netProfit += entry.profitImpact || 0;
    if (entry.accountingClass === 'revenue' && entry.profitImpact > 0) {
      summary.grossRevenue += entry.profitImpact;
      summary.revenueByCategory[entry.category] = (summary.revenueByCategory[entry.category] || 0) + entry.profitImpact;
    } else if (entry.accountingClass === 'cogs') {
      summary.costOfGoodsSold += Math.abs(entry.profitImpact || entry.amount);
      summary.expenseByCategory.costOfGoods = (summary.expenseByCategory.costOfGoods || 0) + Math.abs(entry.profitImpact || entry.amount);
    } else if (entry.accountingClass === 'operating' && entry.profitImpact < 0) {
      summary.operatingExpenses += Math.abs(entry.profitImpact);
      summary.expenseByCategory[entry.category] = (summary.expenseByCategory[entry.category] || 0) + Math.abs(entry.profitImpact);
    } else if (entry.accountingClass === 'inventory' && entry.cashImpact < 0) {
      summary.inventoryPurchases += Math.abs(entry.cashImpact);
    } else if (entry.accountingClass === 'capital' && entry.cashImpact < 0) {
      summary.restorationInvestment += Math.abs(entry.cashImpact);
    }
  }
  for (const key of ['grossRevenue', 'costOfGoodsSold', 'operatingExpenses', 'netProfit', 'cashChange', 'inventoryPurchases', 'restorationInvestment']) {
    summary[key] = r2(summary[key]);
  }
  for (const bucket of [summary.revenueByCategory, summary.expenseByCategory]) {
    for (const key of Object.keys(bucket)) bucket[key] = r2(bucket[key]);
  }
  return summary;
}

function pendingCheckoutLedgerKeys(state) {
  const pending = state?.shop?.pendingCheckouts;
  if (!pending || typeof pending !== 'object' || Array.isArray(pending)) {
    return { entries: new Set(), outcomes: new Set() };
  }
  const entries = new Set();
  const outcomes = new Set();
  for (const plan of Object.values(pending)) {
    for (const posting of Array.isArray(plan?.postings) ? plan.postings : []) {
      const key = posting?.spec?.idempotencyKey;
      if (typeof key === 'string' && key) entries.add(safe(key));
    }
    const outcomeKey = plan?.outcomeSpec?.idempotencyKey;
    if (typeof outcomeKey === 'string' && outcomeKey) outcomes.add(safe(outcomeKey));
  }
  return { entries, outcomes };
}

export function closeBooks(state, dayAbs, indicators = {}) {
  const ledger = ensureLedger(state);
  const cash = totals(ledger.today);
  const financial = financialSummary(state, dayAbs, dayAbs);
  const entry = {
    dayAbs,
    revenue: { ...ledger.today.revenue },
    expense: { ...ledger.today.expense },
    revenueTotal: cash.revenue,
    expenseTotal: cash.expense,
    net: cash.net,
    summary: { ...financial, ...indicators },
  };
  ledger.history.push(entry);
  if (ledger.history.length > LEDGER_HISTORY_DAYS) ledger.history.shift();
  ledger.dailySummaries.push(entry.summary);
  if (ledger.dailySummaries.length > LEDGER_HISTORY_DAYS) ledger.dailySummaries.shift();
  const oldestDay = dayAbs - LEDGER_HISTORY_DAYS + 1;
  const pinned = pendingCheckoutLedgerKeys(state);
  ledger.entries = ledger.entries.filter((item) => (
    item.day >= oldestDay || pinned.entries.has(item.idempotencyKey)
  ));
  ledger.outcomes = ledger.outcomes.filter((item) => (
    item.day >= oldestDay || pinned.outcomes.has(item.idempotencyKey)
  ));
  ledger.yesterday = entry;
  ledger.today = emptyLines();
  ledger.postingDay = null;
  return entry;
}
