import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  allocateCustomerIdentity,
  recordCustomerVisit,
} from '../src/sim/customerIdentity.js';
import { rosterEntries, rosterDateLabel } from '../src/sim/clubRoster.js';

// L3 — the ledger book is a LENS on the identity directory (task #127's
// ruling and the NamedGolfers spec's load-bearing rule). These tests pin the
// lens: it owns no state, shows only golfers with a completed check-in, sets
// the first visit once, and an empty roster is a legitimate blank book.

const freshState = () => ({ seed: 'roster-test-1', clock: { minutes: 0 } });

test('a fresh directory yields a blank roster - blank pages are legitimate', () => {
  const state = freshState();
  assert.deepEqual(rosterEntries(state), []);
});

test('shoppers do not sign the ledger; checked-in golfers do', () => {
  const state = freshState();
  const shopper = allocateCustomerIdentity(state, { sourceId: 'walkin:1' });
  recordCustomerVisit(state, shopper.customerId, { dayAbs: 3, purpose: 'retail', outcome: 'purchase' });
  assert.deepEqual(rosterEntries(state), [], 'a purchase alone never signs the book');

  const golfer = allocateCustomerIdentity(state, { sourceId: 'reservation:9' });
  recordCustomerVisit(state, golfer.customerId, {
    dayAbs: 4, purpose: 'tee-time', outcome: 'check-in', paymentMethod: 'card', amount: 32,
  });
  const entries = rosterEntries(state);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].customerId, golfer.customerId);
  assert.equal(entries[0].name, golfer.fullName);
  assert.equal(entries[0].visits, 1);
  assert.equal(entries[0].firstVisitDayAbs, 4);
  assert.equal(entries[0].lastVisitDayAbs, 4);
});

test('the first visit is written once; later rounds move only the last visit', () => {
  const state = freshState();
  const golfer = allocateCustomerIdentity(state, { sourceId: 'reservation:2' });
  recordCustomerVisit(state, golfer.customerId, { dayAbs: 10, outcome: 'check-in' });
  recordCustomerVisit(state, golfer.customerId, { dayAbs: 15, outcome: 'check-in' });
  recordCustomerVisit(state, golfer.customerId, { dayAbs: 22, outcome: 'check-in' });
  const [entry] = rosterEntries(state);
  assert.equal(entry.firstVisitDayAbs, 10, 'first visit never rewritten');
  assert.equal(entry.lastVisitDayAbs, 22);
  assert.equal(entry.visits, 3);
});

test('the roster reads oldest signature first', () => {
  const state = freshState();
  const late = allocateCustomerIdentity(state, { sourceId: 'reservation:late' });
  const early = allocateCustomerIdentity(state, { sourceId: 'reservation:early' });
  recordCustomerVisit(state, late.customerId, { dayAbs: 30, outcome: 'check-in' });
  recordCustomerVisit(state, early.customerId, { dayAbs: 5, outcome: 'check-in' });
  const entries = rosterEntries(state);
  assert.equal(entries[0].customerId, early.customerId);
  assert.equal(entries[1].customerId, late.customerId);
});

test('a legacy history without firstVisitDayAbs heals and backfills from lastVisit', () => {
  const state = freshState();
  const golfer = allocateCustomerIdentity(state, { sourceId: 'reservation:legacy' });
  // simulate a pre-L3 save: the field is absent entirely
  delete golfer.visitHistory.firstVisitDayAbs;
  golfer.visitHistory.completedCheckIns = 2;
  golfer.visitHistory.lastVisitDayAbs = 12;
  const [entry] = rosterEntries(state);
  assert.equal(entry.firstVisitDayAbs, 12, 'lens backfills first-visit from the only date it has');
  assert.equal(entry.visits, 2);
});

test('date labels use the reservation calendar format', () => {
  assert.match(rosterDateLabel(0), /^Y\d+-.+-D\d+$/);
  assert.equal(rosterDateLabel(null), '');
});
