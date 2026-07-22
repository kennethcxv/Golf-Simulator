// THE RENT — the bill that does not care what kind of week you had.
//
// The books charged wages, utilities and upkeep, but nothing at all for the property itself, which
// is the largest fixed cost a business like this really has. Without it there is no floor under
// any of the player's decisions: you can sit on a broken course indefinitely and never feel it,
// and "should I spend this on stock or on the greens" has no teeth.
//
// So the place costs money to hold, every week, sized off what it is worth. It is announced two
// days out so it is never a surprise, it comes out of the till on the day, and if it doesn't get
// paid it does not quietly evaporate — it sits there and grows.

import { spend } from './economy.js';
import { notify } from './notifications.js';

export const RENT_RATE = 0.011; // of valuation, per week
export const CYCLE_DAYS = 7;
export const WARN_DAYS = 2;
const INTEREST = 0.06; // on arrears, per missed cycle
const SEVERE_AFTER = 4; // missed cycles before the game starts using the word "foreclosure"

export function ensureProperty(state) {
  if (!state.property) state.property = {};
  const p = state.property;
  if (!p.id) p.id = `club-${state.seed ?? 'legacy'}`;
  if (!p.tierId) p.tierId = 'neglectedPublic';
  if (typeof p.acquisitionCost !== 'number') p.acquisitionCost = 0;
  if (typeof p.loanBalance !== 'number') p.loanBalance = 0;
  if (!Number.isInteger(p.nextCommandId) || p.nextCommandId < 1) p.nextCommandId = 1;
  if (typeof p.nextDueDay !== 'number') p.nextDueDay = CYCLE_DAYS;
  if (typeof p.arrears !== 'number') p.arrears = 0;
  if (typeof p.missedTotal !== 'number') p.missedTotal = 0;
  if (typeof p.warnedFor !== 'number') p.warnedFor = -1;
  if (typeof p.paidTotal !== 'number') p.paidTotal = 0;
  return p;
}

export function nextPropertyCommandId(state, kind = 'command') {
  const property = ensureProperty(state);
  return `${property.id}:${kind}:${property.nextCommandId++}`;
}

export const propertyState = (state) => ensureProperty(state);
export const arrearsOf = (state) => Math.round(ensureProperty(state).arrears);

// what the place is worth: the club's valuation if it has one, else a sane floor
function valuation(state) {
  const v = state.club && state.club.valuation;
  return v && v > 0 ? v : 40000;
}

export function weeklyCharge(state) {
  return Math.round(valuation(state) * RENT_RATE);
}

// Call once per day rollover. Returns what happened, so the UI can say it out loud.
export function tickProperty(state, dayAbs) {
  const p = ensureProperty(state);
  const due = weeklyCharge(state);
  const out = {
    due, charged: false, paid: false, missed: false,
    warning: null, severe: false, message: null,
    missedTotal: p.missedTotal, arrears: Math.round(p.arrears),
  };

  // the heads-up, once per bill
  const warnDay = p.nextDueDay - WARN_DAYS;
  if (dayAbs === warnDay && p.warnedFor !== p.nextDueDay) {
    p.warnedFor = p.nextDueDay;
    const owed = Math.round(p.arrears);
    out.warning = owed > 0
      ? `Property bill of $${due} due in ${WARN_DAYS} days — plus $${owed} you already owe.`
      : `Property bill of $${due} due in ${WARN_DAYS} days.`;
    out.message = out.warning;
    notify(state, { kind: 'money', text: out.warning, dedupeKey: `rentwarn:${p.nextDueDay}` });
    return out;
  }

  if (dayAbs < p.nextDueDay) return out;

  // it's due
  out.charged = true;
  p.nextDueDay = dayAbs + CYCLE_DAYS;
  const owed = due + p.arrears;

  if (state.cash >= owed) {
    spend(state, 'rent', owed, {
      idempotencyKey: `property:${p.id}:holding-cost:${dayAbs}`,
      relatedId: p.id,
      description: `Property holding cost â€” day ${dayAbs}`,
      source: 'property',
    }); // addExpense already takes the cash; spend works ledger-or-not
    p.arrears = 0;
    p.paidTotal += owed;
    out.paid = true;
    out.arrears = 0;
    out.message = p.missedTotal > 0
      ? `Property bill settled — $${Math.round(owed)}, including the back rent.`
      : `Property bill paid — $${due}.`;
    return out;
  }

  // Can't pay: it does not go away, it grows. Interest bites what you were ALREADY carrying —
  // this week's bill is simply this week's bill until you fail to pay that too.
  p.missedTotal += 1;
  const carried = p.arrears * (1 + INTEREST);
  p.arrears = Math.round((carried + due) * 100) / 100;
  out.missed = true;
  out.missedTotal = p.missedTotal;
  out.arrears = Math.round(p.arrears);
  out.severe = p.missedTotal >= SEVERE_AFTER;
  out.message = out.severe
    ? `You are ${p.missedTotal} weeks behind on the property. $${out.arrears} in arrears — the bank is asking questions.`
    : `Could not cover the property bill. $${out.arrears} now owed, and it is accruing interest.`;
  notify(state, { kind: 'money', text: out.message, dedupeKey: `rentmiss:${dayAbs}` });
  return out;
}

// a one-line status for the Finances page
export function propertyLine(state, dayAbs) {
  const p = ensureProperty(state);
  const due = weeklyCharge(state);
  const inDays = Math.max(0, p.nextDueDay - dayAbs);
  const owed = Math.round(p.arrears);
  if (owed > 0) return `$${due}/week · $${owed} in arrears · next bill in ${inDays} day${inDays === 1 ? '' : 's'}`;
  return `$${due}/week · next bill in ${inDays} day${inDays === 1 ? '' : 's'}`;
}
