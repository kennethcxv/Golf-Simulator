// THE CLUB ROSTER — what the ledger book on the front desk shows.
//
// Task #127's ruling (2026-08-04): the ledger IS the roster book from
// Designs/NamedGolfers/SLICE_BRIEF.md, and the spec's load-bearing rule
// applies — "the ledger and the wall are LENSES on progress the player
// earned". So this module owns NO state of its own. The customer identity
// directory already persists every golfer's visit history (and heals it on
// load); the roster is a read of it: everyone who has completed a check-in
// for a round, in the order they first came through the door.
//
// The book records only what the game genuinely tracks today: the signature
// (the golfer's name), the first visit, rounds played, and the last visit.
// The spec's remaining columns (best round, the fix that won them over)
// arrive with the named-golfers slice that tracks them; painting empty
// promises into the book would be recording things that never happened.
// An empty roster is a legitimate day-one state: blank pages.

import { ensureCustomerDirectory } from './customerIdentity.js';
import { dateKey } from './reservations.js';

/**
 * Every golfer with at least one completed round check-in, oldest first.
 * @returns {Array<{customerId, name, firstVisitDayAbs, lastVisitDayAbs, visits, spend}>}
 */
export function rosterEntries(state) {
  const directory = ensureCustomerDirectory(state);
  return directory.customers
    .filter((customer) => (customer.visitHistory?.completedCheckIns || 0) > 0)
    .map((customer) => ({
      customerId: customer.customerId,
      name: customer.fullName,
      firstVisitDayAbs: customer.visitHistory.firstVisitDayAbs ?? customer.visitHistory.lastVisitDayAbs ?? null,
      lastVisitDayAbs: customer.visitHistory.lastVisitDayAbs ?? null,
      visits: customer.visitHistory.completedCheckIns,
      spend: customer.visitHistory.lifetimeSpend || 0,
    }))
    .sort((a, b) => (
      (a.firstVisitDayAbs ?? Infinity) - (b.firstVisitDayAbs ?? Infinity)
      || a.name.localeCompare(b.name)
    ));
}

/** The book's own date column format, from the reservation calendar. */
export function rosterDateLabel(dayAbs) {
  return Number.isFinite(dayAbs) ? dateKey(dayAbs) : '';
}
