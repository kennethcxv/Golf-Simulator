// GOLF EMPIRE — authoritative business ledger.
//
// Existing systems still call addRevenue/addExpense/spend. Those functions now
// append immutable entries and maintain the old aggregate cash lines as a
// compatibility view. UI state never creates money. A gameplay command may pass
// an idempotencyKey; replaying that command then returns the original entry and
// moves neither cash nor profit a second time.

export const LEDGER_VERSION = 2;
export const LEDGER_HISTORY_DAYS = 60;

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
  costOfGoods: 'Cost of goods sold',
};

const CAPITAL_LINES = new Set(['works', 'rentalFleet', 'equipment']);
const INVENTORY_LINES = new Set(['shopOrders', 'deliveryCosts']);
const COGS_LINES = new Set(['costOfGoods']);

export function emptyLines() {
  return {
    revenue: {
      greenFees: 0, walkIns: 0, teeTimeBookings: 0, dues: 0, guestPasses: 0,
      outings: 0, range: 0, restaurant: 0, lessons: 0, shopSales: 0,
      rentals: 0, fittings: 0, reciprocal: 0, events: 0, noShowFees: 0,
      cancellationFees: 0, otherRevenue: 0,
    },
    expense: {
      wagesStaff: 0, wagesDayLabor: 0, water: 0, fertilizer: 0, chemicals: 0,
      upkeep: 0, utilities: 0, works: 0, severance: 0, training: 0,
      shopOrders: 0, deliveryCosts: 0, rentalFleet: 0, equipment: 0,
      cleaningSupplies: 0, propertyExpenses: 0, events: 0, rent: 0,
      checkoutShortage: 0,
    },
  };
}

const r2 = (value) => Math.round((Number(value) || 0) * 100) / 100;
const dayOf = (state) => Math.floor((state.clock?.minutes || 0) / 1440);
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
  return state.property?.id || state.propertyId || `club-${safe(state.seed ?? state.clubName ?? 'unknown')}`;
}

function accountingClass(direction, lineKey, meta) {
  if (meta.accountingClass) return meta.accountingClass;
  if (direction === 'revenue') return 'revenue';
  if (COGS_LINES.has(lineKey)) return 'cogs';
  if (CAPITAL_LINES.has(lineKey)) return 'capital';
  if (INVENTORY_LINES.has(lineKey)) return 'inventory';
  return 'operating';
}

export function initLedger(state) {
  state.ledger = {
    version: LEDGER_VERSION,
    today: emptyLines(),
    yesterday: null,
    history: [],
    entries: [],
    outcomes: [],
    dailySummaries: [],
    processedIds: {},
    processedOutcomeIds: {},
    nextSequence: 1,
    postingDay: null,
  };
}

export function ensureLedger(state) {
  if (!state.ledger) initLedger(state);
  const ledger = state.ledger;
  ledger.version = LEDGER_VERSION;
  ledger.today ||= emptyLines();
  ledger.today.revenue ||= {};
  ledger.today.expense ||= {};
  for (const [key, value] of Object.entries(emptyLines().revenue)) {
    if (!Number.isFinite(ledger.today.revenue[key])) ledger.today.revenue[key] = value;
  }
  for (const [key, value] of Object.entries(emptyLines().expense)) {
    if (!Number.isFinite(ledger.today.expense[key])) ledger.today.expense[key] = value;
  }
  ledger.history ||= [];
  ledger.entries ||= [];
  ledger.outcomes ||= [];
  ledger.dailySummaries ||= [];
  ledger.processedIds ||= {};
  ledger.processedOutcomeIds ||= {};
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
  if (!Number.isInteger(ledger.nextSequence) || ledger.nextSequence < 1) ledger.nextSequence = ledger.entries.length + 1;
  if (ledger.postingDay === undefined) ledger.postingDay = null;
  return ledger;
}

export function beginLedgerClose(state, dayAbs) {
  ensureLedger(state).postingDay = dayAbs;
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

export function postLedgerEntry(state, spec = {}) {
  const ledger = ensureLedger(state);
  const direction = spec.direction === 'expense' ? 'expense' : spec.direction === 'reversal' ? 'reversal' : 'revenue';
  const amount = r2(Math.abs(spec.amount));
  if (!(amount > 0)) return { ok: false, reason: 'Ledger amounts must be positive.' };

  const idempotencyKey = safe(spec.idempotencyKey || generatedKey(ledger));
  const priorId = ledger.processedIds[idempotencyKey];
  if (priorId) {
    return { ok: true, duplicate: true, entry: ledger.entries.find((entry) => entry.id === priorId) || null };
  }

  const propertyId = safe(spec.propertyId || propertyIdOf(state));
  const day = Number.isInteger(spec.day) ? spec.day
    : Number.isInteger(ledger.postingDay) ? ledger.postingDay
      : dayOf(state);
  const timestamp = Number.isFinite(spec.timestamp)
    ? spec.timestamp
    : Number.isInteger(ledger.postingDay) ? day * 1440 + 1439
      : Math.round(state.clock?.minutes || day * 1440);
  const lineKey = spec.lineKey || spec.category || (direction === 'revenue' ? 'otherRevenue' : 'propertyExpenses');
  const klass = accountingClass(direction, lineKey, spec);
  const cashImpact = r2(spec.cashImpact ?? (direction === 'expense' ? -amount : direction === 'reversal' ? amount : amount));
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

  ledger.entries.push(entry);
  ledger.processedIds[idempotencyKey] = entry.id;
  state.cash = r2((state.cash || 0) + cashImpact);

  const aggregate = spec.aggregate || (
    direction === 'revenue' ? { side: 'revenue', key: lineKey, amount }
      : direction === 'expense' && cashImpact < 0 ? { side: 'expense', key: lineKey, amount }
        : null
  );
  if (aggregate) aggregateCashLine(ledger, aggregate.side, aggregate.key, aggregate.amount);
  return { ok: true, duplicate: false, entry };
}

export function addRevenue(state, key, amount, meta = {}) {
  const amt = r2(amount);
  if (!(amt > 0)) return { ok: false, reason: 'Revenue must be positive.' };
  if (!state.ledger) {
    state.cash = r2((state.cash || 0) + amt);
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
  if (!(amt > 0)) return { ok: false, reason: 'Expense must be positive.' };
  if (!state.ledger) {
    state.cash = r2((state.cash || 0) - amt);
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

// Append a visible reversal rather than erasing history. The old cash-line view
// still nets the original expense down so legacy reconciliation remains exact.
export function unbill(state, key, amount, meta = {}) {
  const amt = r2(amount);
  if (!(amt > 0)) return { ok: false, reason: 'Refund must be positive.' };
  if (!state.ledger) {
    state.cash = r2((state.cash || 0) + amt);
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

export function spend(state, key, amount, meta = {}) {
  return state.ledger ? addExpense(state, key, amount, meta) : addExpense(state, key, amount, meta);
}

export function recordOutcome(state, spec = {}) {
  const ledger = ensureLedger(state);
  const idempotencyKey = safe(spec.idempotencyKey || `outcome:${generatedKey(ledger)}`);
  const priorId = ledger.processedOutcomeIds[idempotencyKey];
  if (priorId) {
    return { ok: true, duplicate: true, outcome: ledger.outcomes.find((outcome) => outcome.id === priorId) || null };
  }
  const propertyId = safe(spec.propertyId || propertyIdOf(state));
  const day = Number.isInteger(spec.day) ? spec.day
    : Number.isInteger(ledger.postingDay) ? ledger.postingDay
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

export function totals(lines) {
  let revenue = 0;
  let expense = 0;
  for (const value of Object.values(lines?.revenue || {})) revenue += value;
  for (const value of Object.values(lines?.expense || {})) expense += value;
  return { revenue: r2(revenue), expense: r2(expense), net: r2(revenue - expense) };
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
  ledger.entries = ledger.entries.filter((item) => item.day >= oldestDay);
  ledger.outcomes = ledger.outcomes.filter((item) => item.day >= oldestDay);
  ledger.yesterday = entry;
  ledger.today = emptyLines();
  ledger.postingDay = null;
  return entry;
}
