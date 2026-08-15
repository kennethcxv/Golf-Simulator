// SALES TAX IS NOT THE PLAYER'S MONEY.
//
// Reported 2026-07-29: "The tax is not the player's money — it accrues as a liability and is
// remitted, visible in Finances."
//
// So it does not go through addRevenue. A register sale posts TWO things: the goods, as
// pro-shop revenue, and the tax, as cash collected on the state's behalf with profitImpact 0
// and no revenue aggregate. Cash on hand goes up by the whole ticket — the customer really did
// hand over $25.44 — but the day's revenue line, and therefore the profit the player is
// judged on, only ever sees the $24.00.
//
// Remittance runs on the property's own 7-day cycle. Real filing is monthly or quarterly, but
// the game's season is 24 days and a bill the player meets four times a season teaches the
// lesson; a bill they meet once does not. It is a profit-neutral expense: the money was never
// income, so paying it out is not a loss.
//
// THE SECOND REASON THIS EXISTS, in the reporter's words: "I have never once had to give
// change under a dollar. Sales tax is what produces odd totals — $24.00 becomes $25.44 and now
// cash handling actually means something."

import { postLedgerEntry, preflightLedgerEntry } from './economy.js';
import { ensureProperty, CYCLE_DAYS } from './property.js';
import { formatTaxRate, jurisdictionForProperty, salesTaxRateOf } from '../data/salesTax.js';

export const SALES_TAX_LINE = 'salesTaxCollected';
export const SALES_TAX_REMIT_LINE = 'salesTaxRemitted';
export const SALES_TAX_CYCLE_DAYS = CYCLE_DAYS;
export const SALES_TAX_MAX_AMOUNT = 1_000_000_000_000;
// state.clock.minutes is bounded to Number.MAX_SAFE_INTEGER on load. No tax day
// beyond its greatest representable calendar day can ever become due.
const SALES_TAX_MAX_STATE_DAY = Math.floor(Number.MAX_SAFE_INTEGER / 1440);
export const SALES_TAX_MAX_DAY = SALES_TAX_MAX_STATE_DAY + SALES_TAX_CYCLE_DAYS;

const SALES_TAX_MAX_CENTS = SALES_TAX_MAX_AMOUNT * 100;
const AMOUNT_FIELDS = Object.freeze([
  'collected', 'remitted', 'owed', 'lastRemitAmount', 'taxableSales',
]);

function canonicalAmount(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  const bounded = Math.min(SALES_TAX_MAX_AMOUNT, Math.max(0, value));
  return Math.round(bounded * 100) / 100;
}

const r2 = (value) => canonicalAmount(Number(value));

function dayOfState(state) {
  const minutes = Number(state?.clock?.minutes);
  if (!Number.isFinite(minutes) || minutes <= 0) return 0;
  return Math.min(SALES_TAX_MAX_STATE_DAY, Math.max(0, Math.floor(minutes / 1440)));
}

function validStateDay(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= SALES_TAX_MAX_STATE_DAY;
}

function validScheduledDay(value) {
  return Number.isSafeInteger(value)
    && value >= SALES_TAX_CYCLE_DAYS
    && value <= SALES_TAX_MAX_DAY
    && value % SALES_TAX_CYCLE_DAYS === 0;
}

function firstCycleAfter(dayAbs) {
  const day = validStateDay(dayAbs) ? dayAbs : 0;
  if (day < SALES_TAX_CYCLE_DAYS) return SALES_TAX_CYCLE_DAYS;
  const candidate = (Math.floor(day / SALES_TAX_CYCLE_DAYS) + 1) * SALES_TAX_CYCLE_DAYS;
  return Number.isSafeInteger(candidate) && candidate <= SALES_TAX_MAX_DAY
    ? candidate
    : SALES_TAX_MAX_DAY;
}

function remitDayAfter(scheduledDay, dayAbs) {
  if (scheduledDay > dayAbs) return scheduledDay;
  const cycles = Math.floor((dayAbs - scheduledDay) / SALES_TAX_CYCLE_DAYS) + 1;
  const candidate = scheduledDay + cycles * SALES_TAX_CYCLE_DAYS;
  if (Number.isSafeInteger(candidate)
      && candidate > dayAbs
      && candidate <= SALES_TAX_MAX_DAY) return candidate;
  return firstCycleAfter(dayAbs);
}

/**
 * Canonicalize the persisted tax authority without touching cash or the ledger.
 * Unknown nested fields are deliberately left in place for forward compatibility.
 */
export function normalizeSalesTax(
  state,
  { dayAbs = dayOfState(state), constrainToDay = false } = {},
) {
  if (!state) return { tax: null, repairs: [] };
  const property = ensureProperty(state);
  if (!property.taxJurisdiction) property.taxJurisdiction = jurisdictionForProperty(property).code;

  const repairs = [];
  const note = (field, message) => {
    const prior = repairs.find((repair) => repair.field === field);
    if (!prior) repairs.push({ field, message });
    else if (!prior.message.includes(message)) prior.message += `; ${message}`;
  };
  if (!state.salesTax || typeof state.salesTax !== 'object' || Array.isArray(state.salesTax)) {
    state.salesTax = {};
  }
  const t = state.salesTax;
  for (const field of AMOUNT_FIELDS) {
    const normalized = canonicalAmount(t[field]);
    if (!Object.is(normalized, t[field])) {
      note(field, 'invalid, negative, out-of-range, or fractional-cent amount normalized');
    }
    t[field] = normalized;
  }

  // Never increase the payable amount while healing. Persisted collections and
  // remittances bound it, but a damaged cumulative counter must not turn a
  // smaller (or invalid) persisted liability into a larger cash withdrawal.
  const remitted = Math.min(t.remitted, t.collected);
  if (!Object.is(remitted, t.remitted)) {
    note('remitted', 'cumulative remittance cannot exceed cumulative collections');
  }
  t.remitted = remitted;
  const owed = Math.min(t.owed, canonicalAmount(t.collected - t.remitted));
  if (!Object.is(owed, t.owed)) {
    note('owed', 'liability reduced to the supported collections less remittances');
  }
  t.owed = owed;
  const collected = canonicalAmount(t.remitted + t.owed);
  if (!Object.is(collected, t.collected)) {
    note('collected', 'cumulative collections reconciled to remittances plus open liability');
  }
  t.collected = collected;
  if (t.owed === 0 && t.taxableSales !== 0) {
    t.taxableSales = 0;
    note('taxableSales', 'open taxable-sales basis cleared with zero liability');
  }

  const currentDay = validStateDay(dayAbs) ? dayAbs : dayOfState(state);
  let lastRemitDay = t.lastRemitDay === -1 || validStateDay(t.lastRemitDay)
    ? t.lastRemitDay
    : -1;
  if (constrainToDay && lastRemitDay > currentDay) lastRemitDay = -1;
  if (!Object.is(lastRemitDay, t.lastRemitDay)) {
    note('lastRemitDay', 'invalid, out-of-range, or future last-remittance day normalized');
  }
  t.lastRemitDay = lastRemitDay;

  let lastRemitAmount = Math.min(t.lastRemitAmount, t.remitted);
  if (t.lastRemitDay < 0 || t.remitted === 0) lastRemitAmount = 0;
  if (!Object.is(lastRemitAmount, t.lastRemitAmount)) {
    note('lastRemitAmount', 'last remittance cannot exceed cumulative remittances or lack a date');
  }
  t.lastRemitAmount = lastRemitAmount;
  if (t.lastRemitDay >= 0 && t.lastRemitAmount === 0) {
    t.lastRemitDay = -1;
    note('lastRemitDay', 'zero last-remittance amount cannot carry a remittance date');
  }

  const nextForCurrentDay = firstCycleAfter(currentDay);
  let nextRemitDay = validScheduledDay(t.nextRemitDay)
    ? t.nextRemitDay
    : nextForCurrentDay;
  if (constrainToDay && nextRemitDay > nextForCurrentDay) nextRemitDay = nextForCurrentDay;
  if (t.lastRemitDay >= 0 && nextRemitDay <= t.lastRemitDay) {
    nextRemitDay = nextForCurrentDay;
  }
  if (constrainToDay && t.owed === 0 && nextRemitDay <= currentDay) {
    nextRemitDay = nextForCurrentDay;
  }
  if (!Object.is(nextRemitDay, t.nextRemitDay)) {
    note('nextRemitDay', 'invalid, misaligned, stale, or implausibly future schedule normalized');
  }
  t.nextRemitDay = nextRemitDay;
  return { tax: t, repairs };
}

export function ensureSalesTax(state) {
  return normalizeSalesTax(state).tax;
}

function exactPositiveCents(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || !(value > 0)) return 0;
  const cents = Math.round(value * 100);
  if (!Number.isSafeInteger(cents) || cents > SALES_TAX_MAX_CENTS) return 0;
  return cents / 100 === value ? cents : 0;
}

function taxEvidence(entry, processedIds) {
  const lineKey = entry?.lineKey;
  if (lineKey !== SALES_TAX_LINE && lineKey !== SALES_TAX_REMIT_LINE) return null;
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return { diagnostic: 'tax row is not a record' };
  }
  const remittance = lineKey === SALES_TAX_REMIT_LINE;
  const cents = exactPositiveCents(entry.amount);
  const expectedDirection = remittance ? 'expense' : 'revenue';
  const expectedCashImpact = remittance ? -(cents / 100) : cents / 100;
  const id = typeof entry.id === 'string' && entry.id ? entry.id : null;
  const idempotencyKey = typeof entry.idempotencyKey === 'string' && entry.idempotencyKey
    ? entry.idempotencyKey
    : null;
  const expectedId = id && idempotencyKey && typeof entry.propertyId === 'string'
    ? `le:${entry.propertyId}:${idempotencyKey}`
    : null;
  if (!cents
      || entry.category !== lineKey
      || entry.direction !== expectedDirection
      || entry.accountingClass !== 'liability'
      || entry.profitImpact !== 0
      || !Object.is(entry.cashImpact, expectedCashImpact)
      || !validStateDay(entry.day)
      || typeof entry.propertyId !== 'string'
      || !entry.propertyId
      || typeof entry.source !== 'string'
      || !entry.source
      || (remittance && entry.source !== 'salesTax')) {
    return { diagnostic: 'tax row does not match the canonical liability posting shape' };
  }
  if (!id || !idempotencyKey || id !== expectedId || processedIds?.[idempotencyKey] !== id) {
    return { diagnostic: 'tax row lacks a matching durable idempotency checkpoint' };
  }
  return {
    cents,
    id,
    idempotencyKey,
    remittance,
    fingerprint: JSON.stringify([
      lineKey,
      cents,
      entry.day,
      entry.propertyId,
      entry.source,
    ]),
  };
}

/**
 * Recover the v13 liability from immutable ledger evidence. This migration never
 * posts an entry and never moves cash; it only rebuilds the authority v13 failed
 * to include in its snapshot.
 */
export function reconstructSalesTaxFromLedger(
  state,
  { dayAbs = dayOfState(state), onIgnoredEvidence = null } = {},
) {
  let collectedCents = 0;
  let remittedCents = 0;
  let lastRemitAmount = 0;
  let lastRemitDay = -1;
  let lastRemitIndex = -1;
  const entries = Array.isArray(state?.ledger?.entries) ? state.ledger.entries : [];
  const processedIds = state?.ledger?.processedIds;
  const ignored = (index, reason) => {
    if (typeof onIgnoredEvidence === 'function') onIgnoredEvidence({ index, reason });
  };
  const evidenceGroups = new Map();
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const evidence = taxEvidence(entry, processedIds);
    if (!evidence) continue;
    if (evidence.diagnostic) {
      ignored(index, evidence.diagnostic);
      continue;
    }
    const candidates = evidenceGroups.get(evidence.id) || [];
    candidates.push({ ...evidence, entry, index });
    evidenceGroups.set(evidence.id, candidates);
  }

  const accepted = [];
  for (const candidates of evidenceGroups.values()) {
    const fingerprints = new Set(candidates.map((candidate) => candidate.fingerprint));
    if (fingerprints.size > 1) {
      for (const candidate of candidates) {
        ignored(candidate.index, 'conflicting duplicate durable tax-row identity ignored');
      }
      continue;
    }
    accepted.push(candidates[0]);
    for (const duplicate of candidates.slice(1)) {
      ignored(duplicate.index, 'duplicate durable tax-row identity ignored');
    }
  }
  accepted.sort((left, right) => left.index - right.index);

  for (const evidence of accepted) {
    if (!evidence.remittance) {
      if (collectedCents > SALES_TAX_MAX_CENTS - evidence.cents) {
        ignored(evidence.index, 'cumulative collected-tax evidence exceeds the supported bound');
        continue;
      }
      collectedCents += evidence.cents;
      continue;
    }
    if (remittedCents > SALES_TAX_MAX_CENTS - evidence.cents) {
      ignored(evidence.index, 'cumulative remitted-tax evidence exceeds the supported bound');
      continue;
    }
    remittedCents += evidence.cents;
    const entryDay = evidence.entry.day;
    if (entryDay > lastRemitDay
        || (entryDay === lastRemitDay && evidence.index > lastRemitIndex)) {
      lastRemitDay = entryDay;
      lastRemitAmount = evidence.cents / 100;
      lastRemitIndex = evidence.index;
    }
  }

  remittedCents = Math.min(remittedCents, collectedCents);
  const owedCents = collectedCents - remittedCents;
  const currentDay = validStateDay(dayAbs) ? dayAbs : dayOfState(state);
  let nextRemitDay = lastRemitDay >= 0
    ? Math.min(SALES_TAX_MAX_DAY, lastRemitDay + SALES_TAX_CYCLE_DAYS)
    : SALES_TAX_CYCLE_DAYS;
  // With no outstanding liability, a stale legacy schedule need not fire on
  // the first tick after load. An overdue liability deliberately remains due.
  if (owedCents === 0 && nextRemitDay <= currentDay) {
    nextRemitDay = remitDayAfter(nextRemitDay, currentDay);
  }

  state.salesTax = {
    collected: collectedCents / 100,
    remitted: remittedCents / 100,
    owed: owedCents / 100,
    nextRemitDay,
    lastRemitAmount,
    lastRemitDay,
    // v13 did not persist a taxable-sales basis in any durable ledger field.
    taxableSales: 0,
  };
  return normalizeSalesTax(state, { dayAbs: currentDay, constrainToDay: true }).tax;
}

/** {code, state, locality, stateRate, localRate} for the property the player owns. */
export function taxJurisdictionOf(state) {
  return jurisdictionForProperty(ensureProperty(state));
}

/** The rate the register adds to a customer's basket. 0 in Oregon and Montana. */
export function salesTaxRate(state) {
  return salesTaxRateOf(taxJurisdictionOf(state).code);
}

/** 'North Carolina · 7%' — what the register screen and the receipt say. */
export function taxJurisdictionLabel(state) {
  const j = taxJurisdictionOf(state);
  return `${j.state} · ${formatTaxRate(salesTaxRateOf(j.code))}`;
}

/**
 * Tax on an amount, to the cent. Computed on the CENT-EXACT base rather than the float, the
 * way a register does: 24.00 → 2400 cents → ×0.07 → 168 → $1.68. Going through the float
 * first lets a value like 0.07 * 24.005 decide a rounding boundary that the printed subtotal
 * does not contain.
 */
export function salesTaxOn(amount, rate) {
  const base = Number(amount) || 0;
  const r = Number(rate) || 0;
  if (!(base > 0) || !(r > 0)) return 0;
  const baseCents = Math.round(base * 100);
  return Math.round(baseCents * r) / 100;
}

export function salesTaxOwed(state) {
  return r2(ensureSalesTax(state)?.owed || 0);
}

/**
 * Book tax collected at the till. Cash in, profit unchanged, liability up.
 * Idempotent on `idempotencyKey`, like every other ledger posting.
 */
export function accrueSalesTax(state, amount, meta = {}) {
  const amt = r2(amount);
  const t = ensureSalesTax(state);
  if (!t) return { ok: false, reason: 'No state to accrue against.' };
  if (!(amt > 0)) return { ok: true, skipped: true, amount: 0 };
  const posted = postLedgerEntry(state, {
    ...meta,
    direction: 'revenue',      // cash comes IN…
    lineKey: SALES_TAX_LINE,
    category: SALES_TAX_LINE,
    accountingClass: 'liability',
    profitImpact: 0,           // …but none of it is profit…
    aggregate: null,           // …and it is not on the revenue line either.
    amount: amt,
  });
  if (!posted.ok) return posted;
  if (posted.duplicate) return { ok: true, duplicate: true, amount: 0 };
  t.collected = r2(t.collected + amt);
  t.owed = r2(t.owed + amt);
  if (Number.isFinite(Number(meta.taxableSales))) {
    t.taxableSales = r2(t.taxableSales + Number(meta.taxableSales));
  }
  return { ok: true, amount: amt, owed: t.owed, entry: posted.entry };
}

/** Preflight for a caller that must know the accrual will post before it commits stock. */
export function preflightSalesTaxAccrual(state, amount, meta = {}) {
  const amt = r2(amount);
  if (!(amt > 0)) return { ok: true, skipped: true };
  return preflightLedgerEntry(state, {
    ...meta,
    direction: 'revenue',
    lineKey: SALES_TAX_LINE,
    category: SALES_TAX_LINE,
    accountingClass: 'liability',
    profitImpact: 0,
    aggregate: null,
    amount: amt,
  });
}

/**
 * Pay the state what has been collected. Profit-neutral: the money was never income.
 * Returns {ok, amount} — amount 0 when there was nothing owed.
 */
export function remitSalesTax(state, dayAbs, meta = {}) {
  const t = ensureSalesTax(state);
  if (!t) return { ok: false, reason: 'No state to remit from.' };
  const owed = r2(t.owed);
  if (!(owed > 0)) return { ok: true, amount: 0, skipped: true };
  const j = taxJurisdictionOf(state);
  const remitDay = validStateDay(dayAbs) ? dayAbs : -1;
  const posted = postLedgerEntry(state, {
    idempotencyKey: meta.idempotencyKey || `salestax:remit:${dayAbs}`,
    direction: 'expense',
    lineKey: SALES_TAX_REMIT_LINE,
    category: SALES_TAX_REMIT_LINE,
    accountingClass: 'liability',
    profitImpact: 0,           // paying out money that was never income is not a loss
    aggregate: null,
    amount: owed,
    day: remitDay >= 0 ? remitDay : undefined,
    description: `Sales tax remitted - ${j.state}`,
    source: 'salesTax',
  });
  if (!posted.ok) return posted;
  if (posted.duplicate) return { ok: true, amount: 0, duplicate: true };
  t.owed = r2(t.owed - owed);
  t.remitted = r2(t.remitted + owed);
  t.lastRemitAmount = owed;
  t.lastRemitDay = remitDay;
  t.taxableSales = 0;
  return { ok: true, amount: owed, jurisdiction: j };
}

/**
 * Once per day rollover, next to tickProperty. Remits on the cycle and reports what happened
 * so the UI can say it out loud.
 */
export function tickSalesTax(state, dayAbs) {
  const t = ensureSalesTax(state);
  if (!t) return { remitted: false, amount: 0 };
  if (!validStateDay(dayAbs)) return { remitted: false, amount: 0 };
  if (dayAbs < t.nextRemitDay) {
    return { remitted: false, amount: 0, owed: t.owed, dueInDays: t.nextRemitDay - dayAbs };
  }
  const result = remitSalesTax(state, dayAbs);
  // Advance in O(1), even when a damaged save supplied an extreme stale day.
  // Zero-tax properties still advance so they do not retry every day.
  t.nextRemitDay = remitDayAfter(t.nextRemitDay, dayAbs);
  return {
    remitted: !!result.ok && result.amount > 0,
    amount: result.ok ? result.amount : 0,
    owed: t.owed,
    jurisdiction: taxJurisdictionOf(state),
    dueInDays: t.nextRemitDay - dayAbs,
  };
}
