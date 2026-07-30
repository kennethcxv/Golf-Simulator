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

const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;

export const SALES_TAX_LINE = 'salesTaxCollected';
export const SALES_TAX_REMIT_LINE = 'salesTaxRemitted';
export const SALES_TAX_CYCLE_DAYS = CYCLE_DAYS;

export function ensureSalesTax(state) {
  if (!state) return null;
  const property = ensureProperty(state);
  // The jurisdiction is stamped onto the property record the first time it is asked for, so a
  // save carries it and a later table edit cannot silently re-tax an owned course.
  if (!property.taxJurisdiction) property.taxJurisdiction = jurisdictionForProperty(property).code;
  if (!state.salesTax || typeof state.salesTax !== 'object') state.salesTax = {};
  const t = state.salesTax;
  if (typeof t.collected !== 'number' || !Number.isFinite(t.collected)) t.collected = 0;
  if (typeof t.remitted !== 'number' || !Number.isFinite(t.remitted)) t.remitted = 0;
  if (typeof t.owed !== 'number' || !Number.isFinite(t.owed)) t.owed = 0;
  if (!Number.isInteger(t.nextRemitDay)) t.nextRemitDay = SALES_TAX_CYCLE_DAYS;
  if (typeof t.lastRemitAmount !== 'number') t.lastRemitAmount = 0;
  if (!Number.isInteger(t.lastRemitDay)) t.lastRemitDay = -1;
  if (typeof t.taxableSales !== 'number' || !Number.isFinite(t.taxableSales)) t.taxableSales = 0;
  return t;
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
  const posted = postLedgerEntry(state, {
    idempotencyKey: meta.idempotencyKey || `salestax:remit:${dayAbs}`,
    direction: 'expense',
    lineKey: SALES_TAX_REMIT_LINE,
    category: SALES_TAX_REMIT_LINE,
    accountingClass: 'liability',
    profitImpact: 0,           // paying out money that was never income is not a loss
    aggregate: null,
    amount: owed,
    day: Number.isInteger(dayAbs) ? dayAbs : undefined,
    description: `Sales tax remitted — ${j.state}`,
    source: 'salesTax',
  });
  if (!posted.ok) return posted;
  if (posted.duplicate) return { ok: true, amount: 0, duplicate: true };
  t.owed = r2(t.owed - owed);
  t.remitted = r2(t.remitted + owed);
  t.lastRemitAmount = owed;
  t.lastRemitDay = Number.isInteger(dayAbs) ? dayAbs : -1;
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
  if (!Number.isInteger(dayAbs)) return { remitted: false, amount: 0 };
  if (dayAbs < t.nextRemitDay) {
    return { remitted: false, amount: 0, owed: t.owed, dueInDays: t.nextRemitDay - dayAbs };
  }
  const result = remitSalesTax(state, dayAbs);
  // Advance past today even when nothing was owed, or a zero-tax property would try every day.
  while (t.nextRemitDay <= dayAbs) t.nextRemitDay += SALES_TAX_CYCLE_DAYS;
  return {
    remitted: !!result.ok && result.amount > 0,
    amount: result.ok ? result.amount : 0,
    owed: t.owed,
    jurisdiction: taxJurisdictionOf(state),
    dueInDays: t.nextRemitDay - dayAbs,
  };
}
