// TEE-TIME RESERVATIONS — an additive booking calendar layered over golfer
// arrivals. It never modifies rounds.js or golfers.js: bookings are their own
// records, payment is collected at the shop counter check-in, and the daily
// tick only expires stale bookings. Tests drive the data model first.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newGame, serialize, deserialize, update, hourlyTick,
} from '../src/sim/state.js';
import { calendarOf } from '../src/sim/time.js';
import { MINUTES_PER_DAY } from '../src/sim/constants.js';
import {
  TEE_SHEET, slotTimes, daySheet, bookSlot, cancelReservation,
  dueForCheckIn, checkInReservation, reservationsDailyTick,
  beginReservationPayment, completeReservationPayment, confirmReservation,
  markReservationArrived, bookReservation, bankReservationDeposit,
  processReservationTimeline, slotByMinute, markReservationNoShow,
  chargeNoShowFee, handleNoShow,
} from '../src/sim/reservations.js';

const today = (state) => calendarOf(state.clock.minutes).dayAbs;

test('the tee sheet is a real grid: half-hour slots through the playing day', () => {
  const times = slotTimes();
  assert.ok(times.length >= 16, `a full day of slots (${times.length})`);
  assert.equal(times[0], TEE_SHEET.openMin, 'first slot at opening');
  for (let i = 1; i < times.length; i++) {
    assert.equal(times[i] - times[i - 1], TEE_SHEET.stepMin, 'evenly spaced');
  }
  const state = newGame('relaxed', 42);
  const sheet = daySheet(state, today(state) + 1);
  assert.equal(sheet.length, times.length, 'one row per slot');
  assert.ok(sheet.every((s) => s.res === null), 'a fresh day is wide open');
});

test('a full party marks a slot unavailable; capacity prevents overbooking', () => {
  const state = newGame('relaxed', 42);
  const day = today(state) + 1;
  const res = bookSlot(state, day, 480, { holder: 'Ray Falk', partySize: 4 });
  assert.ok(res.ok, 'an open 8:00 books cleanly');
  assert.equal(res.res.feePerPlayer, state.club.greenFee, 'fee snapshots the per-player green fee at booking');
  assert.equal(res.res.fee, state.club.greenFee * 4, 'the party total reflects all four players');

  const sheet = daySheet(state, day);
  const slot = sheet.find((s) => s.minute === 480);
  assert.equal(slot.res.name, 'Ray Falk', 'the calendar shows who holds the slot');

  const again = bookSlot(state, day, 480, 'Second Golfer');
  assert.equal(again.ok, false, 'the same slot cannot be booked twice');
  assert.match(again.reason, /remain|taken/i);
});

test('bookings validate the day and the minute', () => {
  const state = newGame('relaxed', 42);
  const day = today(state);
  assert.equal(bookSlot(state, day - 1, 480, 'X').ok, false, 'yesterday is gone');
  assert.equal(bookSlot(state, day + TEE_SHEET.horizonDays + 5, 480, 'X').ok, false, 'beyond the horizon');
  assert.equal(bookSlot(state, day + 1, 473, 'X').ok, false, 'not a real slot time');
  assert.equal(bookSlot(state, day + 1, 480, '').ok, false, 'a booking needs a name');
});

test('the calendar distinguishes booked and open across a day', () => {
  const state = newGame('relaxed', 42);
  const day = today(state) + 2;
  bookSlot(state, day, 450, 'A');
  bookSlot(state, day, 600, 'B');
  const sheet = daySheet(state, day);
  assert.equal(sheet.filter((s) => s.res).length, 2, 'two booked');
  assert.equal(sheet.filter((s) => !s.res).length, sheet.length - 2, 'the rest open');
});

test('a booked golfer pays and checks in through explicit exact-once steps', () => {
  const state = newGame('relaxed', 42);
  const day = today(state) + 1;
  const { res } = bookSlot(state, day, 480, 'Ray Falk');
  state.club.greenFee = 99; // fee hikes after booking do not reprice the slot

  assert.equal(dueForCheckIn(state).length, 0, 'nothing due the day before');
  update(state, MINUTES_PER_DAY); // roll into the booked day (also runs daily ticks)
  // D2: check-in is windowed; walk to 07:15, inside the 08:00 slot's hour
  state.clock.minutes = day * 1440 + 7 * 60 + 15;
  markReservationArrived(state, res.id);
  const due = dueForCheckIn(state);
  assert.equal(due.length, 1, 'the 8:00 booking is due at the counter');

  const cashBefore = state.cash;
  confirmReservation(state, res.id);
  assert.equal(checkInReservation(state, res.id).ok, false, 'required payment blocks check-in');
  const started = beginReservationPayment(state, res.id, 'card');
  const paid = completeReservationPayment(state, res.id, { transactionId: started.transactionId });
  assert.ok(paid.ok, 'card payment succeeds');
  const pay = checkInReservation(state, due[0].id);
  assert.ok(pay.ok, 'check-in succeeds after payment');
  assert.equal(pay.fee, 32, 'the fee is the one from booking day');
  assert.equal(state.cash, cashBefore + 32, 'payment landed in the wallet');
  assert.equal(state.ledger.today.revenue.bookingBalances, 32, 'booked as a reservation balance');

  assert.equal(completeReservationPayment(state, res.id, { transactionId: started.transactionId }).idempotent, true, 'payment replay is harmless');
  assert.equal(checkInReservation(state, due[0].id).ok, false, 'no repeated check-in');
  assert.equal(dueForCheckIn(state).length, 0, 'checked-in golfers leave the due list');
});

test('a booking with no snapshotted fee settles at zero, never NaN', () => {
  // `balanceDue ?? fee` does not skip NaN, and round2(undefined) IS NaN — one
  // such check-in used to poison greenFees, then close-of-books, then cash.
  const state = newGame('relaxed', 42);
  const day = today(state) + 1;
  const { res } = bookSlot(state, day, 480, 'Fee Less');
  delete res.fee;
  res.balanceDue = NaN;
  res.arrivalStatus = 'arrived';
  update(state, MINUTES_PER_DAY);
  const cashBefore = state.cash;
  const pay = checkInReservation(state, res.id);
  assert.ok(pay.ok, 'the check-in itself still completes');
  assert.equal(pay.fee, 0, 'nothing to collect settles at zero');
  assert.equal(state.cash, cashBefore, 'the wallet is untouched');
  assert.ok(Number.isFinite(state.cash), 'and remains a number');
  assert.ok(
    Number.isFinite(state.ledger.today.revenue.greenFees),
    'the green-fee line stays finite',
  );
});

test('unclaimed bookings expire as no-shows and can no longer pay', () => {
  const state = newGame('relaxed', 42);
  const day = today(state) + 1;
  const { res } = bookSlot(state, day, 480, 'Ghost');
  reservationsDailyTick(state, day + 1); // the booked day has fully passed
  assert.equal(res.status, 'noShow', 'the sheet marks the no-show');
  assert.equal(checkInReservation(state, res.id).ok, false, 'a no-show cannot check in');
});

test('cancelling frees the slot', () => {
  const state = newGame('relaxed', 42);
  const day = today(state) + 1;
  const { res } = bookSlot(state, day, 480, 'Changed Mind');
  assert.ok(cancelReservation(state, res.id).ok);
  assert.ok(bookSlot(state, day, 480, 'New Golfer').ok, 'the 8:00 is bookable again');
});

test('reservations persist through save/load and old saves migrate cleanly', () => {
  const state = newGame('relaxed', 42);
  bookSlot(state, today(state) + 1, 510, 'Saved Golfer');
  const beforeLoad = structuredClone(state.reservations.booked[0]);
  assert.ok(beforeLoad.groupMembers.every((member) => member.name === member.fullName),
    'new reservation group members start in the canonical persisted shape');
  const loaded = deserialize(serialize(state));
  assert.equal(loaded.reservations.booked.length, 1, 'bookings survive the round-trip');
  assert.equal(loaded.reservations.booked[0].name, 'Saved Golfer');
  assert.deepEqual(loaded.reservations.booked[0], beforeLoad,
    'the first load does not normalize freshly-created reservation fields');

  const raw = JSON.parse(serialize(state));
  delete raw.reservations;
  const migrated = deserialize(JSON.stringify(raw));
  assert.ok(migrated.reservations, 'pre-reservation saves gain an empty book');
  assert.ok(bookSlot(migrated, today(migrated) + 1, 480, 'First booking').ok);
});

test('loaded truthy card labels cannot authorize automatic or manual no-show charges', () => {
  const loadedMalformedReservation = (seed, holder) => {
    const state = newGame('relaxed', seed);
    state.pendingMorning = false;
    state.reservations.config.autoBookings = false;
    state.reservations.policy.noShowFee = 15;
    const reservation = bookSlot(state, today(state), 450, {
      holder,
      partySize: 1,
      intendedOutcome: 'no-show',
    }).res;
    reservation.payment.cardOnFile = 'false';
    assert.equal(reservation._compatSynced, true);

    const loaded = deserialize(serialize(state));
    const restored = loaded.reservations.booked.find((entry) => entry.id === reservation.id);
    assert.equal(restored._compatSynced, true, 'the compatibility fast path survives reload');
    assert.equal(restored.payment.cardOnFile, 'false',
      'the hostile truthy label reaches charge authorization without migration');
    const graceEnd = restored.dayAbs * MINUTES_PER_DAY
      + restored.minute + loaded.reservations.config.gracePeriodMin;
    return { loaded, restored, graceEnd };
  };

  const automatic = loadedMalformedReservation(4214, 'Loaded Automatic No Show');
  const automaticCash = automatic.loaded.cash;
  const automaticLedgerRows = automatic.loaded.ledger.entries.length;
  automatic.loaded.clock.minutes = Math.ceil(automatic.graceEnd / 60) * 60;
  const automaticHour = Math.floor(calendarOf(automatic.loaded.clock.minutes).minuteOfDay / 60);
  hourlyTick(automatic.loaded, automaticHour);
  assert.equal(automatic.restored.status, 'noShow');
  assert.equal(automatic.restored.noShow.feeApplied, 0,
    'the hourly golf-operations path cannot coerce a saved label into authority');
  assert.equal(automatic.loaded.cash, automaticCash);
  assert.equal(automatic.loaded.ledger.entries.length, automaticLedgerRows);
  assert.equal(automatic.loaded.reservations.financeEntries.some(
    (entry) => entry.id === `golf-finance:${automatic.restored.id}:no-show-charge`,
  ), false);

  for (const [label, seed, options] of [
    ['front-desk default', 4215, {}],
    ['truthy action label', 4216, { authorized: 'confirmed' }],
  ]) {
    const manual = loadedMalformedReservation(seed, `Loaded Manual ${label}`);
    manual.loaded.clock.minutes = manual.graceEnd;
    const cashBefore = manual.loaded.cash;
    const ledgerRowsBefore = manual.loaded.ledger.entries.length;
    const result = handleNoShow(manual.loaded, manual.restored.id, options);
    assert.equal(result.ok, true, label);
    assert.equal(result.feeApplied, 0, `${label} cannot authorize a charge`);
    assert.equal(manual.loaded.cash, cashBefore, label);
    assert.equal(manual.loaded.ledger.entries.length, ledgerRowsBefore, label);
    assert.equal(manual.loaded.reservations.financeEntries.some(
      (entry) => entry.id === `golf-finance:${manual.restored.id}:no-show-charge`,
    ), false, label);
  }
});

test('reservation payment refuses unsafe cash and frozen projections without any mutation', () => {
  for (const failure of ['unsafe-cash', 'frozen-payment']) {
    const state = newGame('relaxed', `reservation-payment-${failure}`);
    const reservation = bookSlot(state, today(state) + 1, 480, {
      holder: `Atomic ${failure}`,
      partySize: 1,
    }).res;
    const started = beginReservationPayment(state, reservation.id, 'card', {
      transactionId: `atomic-${failure}`,
    });
    assert.equal(started.ok, true, started.reason);
    if (failure === 'unsafe-cash') {
      state.cash = Number.MAX_SAFE_INTEGER / 100;
    } else {
      reservation.payment = Object.freeze({ ...reservation.payment });
    }
    const before = structuredClone(state);

    let refused;
    assert.doesNotThrow(() => {
      refused = completeReservationPayment(state, reservation.id, {
        transactionId: started.transactionId,
      });
    });
    assert.equal(refused.ok, false, failure);
    assert.equal(
      refused.reason,
      failure === 'unsafe-cash'
        ? 'The club books are unavailable right now. Try again.'
        : 'Checkout records are unavailable right now. Try again.',
      failure,
    );
    assert.match(refused.diagnostic, failure === 'unsafe-cash'
      ? /ledger cash projection.*safe currency bounds/i
      : /reservation payment authority.*not writable/i, failure);
    assert.deepEqual(state, before, `${failure} cannot consume counters, bank cash, or project payment`);
  }
});

test('reservation payment replays a durable ledger-only settlement exactly once', () => {
  const state = newGame('relaxed', 4201);
  const reservation = bookSlot(state, today(state) + 1, 510, {
    holder: 'Durable Ledger Golfer',
    partySize: 1,
  }).res;
  const started = beginReservationPayment(state, reservation.id, 'card', {
    transactionId: 'durable-reservation-payment',
  });
  const pending = structuredClone(reservation.payment.pending);
  const first = completeReservationPayment(state, reservation.id, {
    transactionId: started.transactionId,
  });
  assert.equal(first.ok, true, first.reason);
  const cashAfterFirst = state.cash;
  const ledgerRowsAfterFirst = state.ledger.entries.length;
  const receiptSequenceAfterFirst = state.reservations.nextReceiptSeq;
  const financeSequenceAfterFirst = state.reservations.nextFinanceSeq;

  state.reservations.financeEntries = state.reservations.financeEntries.filter(
    (entry) => entry.transactionId !== started.transactionId,
  );
  state.reservations.processedTransactionIds = state.reservations.processedTransactionIds.filter(
    (entry) => entry !== started.transactionId,
  );
  state.reservations.events = state.reservations.events.filter(
    (entry) => !(entry.type === 'payment-completed'
      && entry.reservationId === reservation.id
      && entry.key.endsWith(`:${started.transactionId}`)),
  );
  state.reservations.eventKeys = state.reservations.events.map((entry) => entry.key);
  reservation.payment.amountPaid = 0;
  reservation.payment.depositPaid = 0;
  reservation.payment.amountDue = reservation.payment.total;
  reservation.payment.status = 'unpaid';
  reservation.payment.method = null;
  reservation.payment.payments = [];
  reservation.payment.receipts = [];
  reservation.payment.pending = pending;

  const replay = completeReservationPayment(state, reservation.id, {
    transactionId: started.transactionId,
  });
  assert.equal(replay.ok, true, replay.reason);
  assert.equal(replay.recovered, true);
  assert.equal(state.cash, cashAfterFirst, 'the durable ledger row cannot bank cash twice');
  assert.equal(state.ledger.entries.length, ledgerRowsAfterFirst);
  assert.equal(state.reservations.nextReceiptSeq, receiptSequenceAfterFirst,
    'recovery reuses the durable receipt identity');
  assert.equal(state.reservations.nextFinanceSeq, financeSequenceAfterFirst + 1,
    'recovery publishes one new finance tail without recycling its consumed sequence');
  assert.equal(state.reservations.financeEntries.filter(
    (entry) => entry.transactionId === started.transactionId,
  ).length, 1);
  assert.equal(reservation.payment.receipts.length, 1);
  assert.equal(reservation.payment.status, 'paid');
});

test('receipt-tail recovery never double-applies a linked partial deposit', () => {
  const state = newGame('relaxed', 4205);
  const reservation = bookSlot(state, today(state) + 1, 540, {
    holder: 'Linked Deposit Recovery',
    partySize: 1,
    totalAmount: 100,
  }).res;
  const started = beginReservationPayment(state, reservation.id, 'card', {
    transactionId: 'linked-partial-deposit',
    kind: 'deposit',
    amount: 25,
  });
  const pending = structuredClone(reservation.payment.pending);
  const completed = completeReservationPayment(state, reservation.id, {
    transactionId: started.transactionId,
  });
  assert.equal(completed.ok, true, completed.reason);
  const cashAfterFirst = state.cash;
  const ledgerRowsAfterFirst = state.ledger.entries.length;
  const financeRowsAfterFirst = state.reservations.financeEntries.length;
  assert.deepEqual(reservation.payment.payments, [`golf-finance:${started.transactionId}`]);
  assert.equal(reservation.payment.amountPaid, 25);
  assert.equal(reservation.payment.amountDue, 75);

  reservation.payment.receipts = [];
  reservation.payment.pending = pending;
  const replay = completeReservationPayment(state, reservation.id, {
    transactionId: started.transactionId,
  });
  assert.equal(replay.ok, true, replay.reason);
  assert.equal(replay.recovered, true);
  assert.equal(reservation.payment.amountPaid, 25, 'the surviving payment link owns the applied amount');
  assert.equal(reservation.payment.depositPaid, 25);
  assert.equal(reservation.payment.amountDue, 75);
  assert.equal(reservation.payment.payments.length, 1);
  assert.equal(reservation.payment.receipts.length, 1);
  assert.equal(state.cash, cashAfterFirst);
  assert.equal(state.ledger.entries.length, ledgerRowsAfterFirst);
  assert.equal(state.reservations.financeEntries.length, financeRowsAfterFirst);

  reservation.payment.receipts = [];
  reservation.payment.pending = pending;
  reservation.payment.amountPaid = 0;
  reservation.payment.depositPaid = 0;
  reservation.payment.amountDue = 100;
  reservation.payment.status = 'unpaid';
  reservation.payment.method = null;
  const contradictoryBefore = structuredClone(state);
  const contradictory = completeReservationPayment(state, reservation.id, {
    transactionId: started.transactionId,
  });
  assert.equal(contradictory.ok, false);
  assert.match(contradictory.diagnostic, /linked reservation payment.*contradictory projection/i);
  assert.deepEqual(state, contradictoryBefore, 'contradictory linked authority fails without mutation');
});

test('reservation transaction ids bind one reservation, amount, method, kind, and receipt', () => {
  for (const mismatch of ['reservation', 'amount', 'method', 'kind', 'receipt']) {
    const state = newGame('relaxed', `reservation-authority-${mismatch}`);
    const reservation = bookSlot(state, today(state) + 1, 540, {
      holder: `Authority ${mismatch}`,
      partySize: 1,
    }).res;
    const started = beginReservationPayment(state, reservation.id, 'card', {
      transactionId: `authority-${mismatch}`,
    });
    const completed = completeReservationPayment(state, reservation.id, {
      transactionId: started.transactionId,
    });
    assert.equal(completed.ok, true, completed.reason);
    const [entry] = state.reservations.financeEntries.filter(
      (row) => row.transactionId === started.transactionId,
    );
    if (mismatch === 'reservation') entry.reservationId += 1000;
    if (mismatch === 'amount') entry.amount += 1;
    if (mismatch === 'method') entry.method = 'cash';
    if (mismatch === 'kind') entry.kind = 'deposit';
    if (mismatch === 'receipt') entry.receiptId = `${entry.receiptId}-forged`;
    const before = structuredClone(state);

    const replay = completeReservationPayment(state, reservation.id, {
      transactionId: started.transactionId,
    });
    assert.equal(replay.ok, false, mismatch);
    if (mismatch === 'method') {
      assert.equal(replay.reason, 'That ledger key belongs to a different posting.', mismatch);
      assert.match(replay.diagnostic, /exact ledger provenance/i, mismatch);
    } else {
      assert.equal(replay.reason, 'Checkout records are unavailable right now. Try again.', mismatch);
      assert.match(replay.diagnostic, /different reservation payment|provenance|receipt/i, mismatch);
    }
    assert.deepEqual(state, before, `${mismatch} mismatch fails without mutation`);
  }
});

test('ambiguous and cross-reservation transaction ids fail closed', () => {
  const state = newGame('relaxed', 4202);
  const day = today(state) + 1;
  const first = bookSlot(state, day, 570, { holder: 'First Authority', partySize: 1 }).res;
  const second = bookSlot(state, day, 600, { holder: 'Second Authority', partySize: 1 }).res;
  const started = beginReservationPayment(state, first.id, 'card', {
    transactionId: 'one-reservation-only',
  });
  assert.equal(completeReservationPayment(state, first.id, {
    transactionId: started.transactionId,
  }).ok, true);

  const beforeCrossReservation = structuredClone(state);
  const crossBegin = beginReservationPayment(state, second.id, 'card', {
    transactionId: started.transactionId,
  });
  assert.equal(crossBegin.ok, false);
  assert.equal(crossBegin.reason, 'Checkout records are unavailable right now. Try again.');
  assert.match(crossBegin.diagnostic, /different reservation payment|bound/i);
  assert.deepEqual(state, beforeCrossReservation);

  const existing = state.reservations.financeEntries.find(
    (entry) => entry.transactionId === started.transactionId,
  );
  state.reservations.financeEntries.push(structuredClone(existing));
  const beforeAmbiguousReplay = structuredClone(state);
  const ambiguous = completeReservationPayment(state, first.id, {
    transactionId: started.transactionId,
  });
  assert.equal(ambiguous.ok, false);
  assert.equal(ambiguous.reason, 'Checkout records are unavailable right now. Try again.');
  assert.match(ambiguous.diagnostic, /transaction id is ambiguous/i);
  assert.deepEqual(state, beforeAmbiguousReplay);
});

test('one pending reservation owns a transaction id before any finance row exists', () => {
  const state = newGame('relaxed', 4206);
  const day = today(state) + 1;
  const first = bookSlot(state, day, 600, { holder: 'Pending Owner', partySize: 1 }).res;
  const second = bookSlot(state, day, 630, { holder: 'Pending Intruder', partySize: 1 }).res;
  const started = beginReservationPayment(state, first.id, 'card', {
    transactionId: 'one-pending-owner',
  });
  assert.equal(started.ok, true, started.reason);
  const before = structuredClone(state);

  const collision = beginReservationPayment(state, second.id, 'card', {
    transactionId: started.transactionId,
  });
  assert.equal(collision.ok, false);
  assert.match(collision.diagnostic, /already bound.*pending payment/i);
  assert.deepEqual(state, before, 'a cross-reservation pending id collision mutates no authority');
});

test('a deferred deposit is superseded when another payment settles the full fee', () => {
  const state = newGame('relaxed', 4207);
  state.reservations.config.autoBookings = false;
  state.clock.minutes = MINUTES_PER_DAY;
  const reservation = bookReservation(state, {
    dayAbs: today(state) + 1,
    minute: 660,
    name: 'Deferred Then Paid',
    partySize: 1,
    totalFee: 80,
    deposit: 20,
  }).res;
  assert.equal(reservation.depositStatus, 'pending');
  const started = beginReservationPayment(state, reservation.id, 'card', {
    transactionId: 'full-before-deferred-deposit',
  });
  assert.equal(completeReservationPayment(state, reservation.id, {
    transactionId: started.transactionId,
  }).ok, true);
  const banked = {
    cash: state.cash,
    revenue: state.ledger.today.revenue.greenFees,
    ledgerRows: state.ledger.entries.length,
    financeRows: state.reservations.financeEntries.length,
    tickets: state.shop.transactionHistory.length,
  };

  const processed = processReservationTimeline(state, { at: MINUTES_PER_DAY + 1 });
  assert.equal(processed.deposits.length, 0);
  assert.equal(reservation.depositStatus, 'none');
  assert.equal(reservation.depositRequested, 0);
  assert.equal(reservation.payment.amountPaid, 80);
  assert.equal(reservation.payment.amountDue, 0);
  assert.deepEqual({
    cash: state.cash,
    revenue: state.ledger.today.revenue.greenFees,
    ledgerRows: state.ledger.entries.length,
    financeRows: state.reservations.financeEntries.length,
    tickets: state.shop.transactionHistory.length,
  }, banked, 'the deferred request cannot bank beyond the fully settled fee');
});

test('a frozen tee-sheet slot rejects booking before counters or records publish', () => {
  const state = newGame('relaxed', 4208);
  const day = today(state) + 1;
  const slot = slotByMinute(state, day, 690);
  Object.freeze(slot.reservationIds);
  const before = structuredClone(state);

  let refused;
  assert.doesNotThrow(() => {
    refused = bookSlot(state, day, 690, { holder: 'Frozen Slot Golfer', partySize: 1 });
  });
  assert.equal(refused.ok, false);
  assert.match(refused.diagnostic, /schedule authority.*not writable/i);
  assert.deepEqual(state, before, 'the booking, party/id counters, event, and slot remain unchanged');
});

test('modern deposits reject unsafe or unconserved payment projections before banking', () => {
  for (const corruption of ['unsafe-paid', 'overpaid', 'wrong-due']) {
    const state = newGame('relaxed', `modern-deposit-${corruption}`);
    const reservation = bookReservation(state, {
      dayAbs: today(state) + 1,
      minute: 720,
      name: `Unsafe Deposit ${corruption}`,
      partySize: 1,
      totalFee: 100,
      deposit: 25,
      bankDeposit: false,
    }).res;
    if (corruption === 'unsafe-paid') reservation.payment.amountPaid = 1e300;
    if (corruption === 'overpaid') {
      reservation.payment.amountPaid = 150;
      reservation.payment.amountDue = 0;
      reservation.payment.status = 'paid';
    }
    if (corruption === 'wrong-due') reservation.payment.amountDue = 75;
    const before = structuredClone(state);

    const refused = bankReservationDeposit(state, reservation.id);
    assert.equal(refused.ok, false, corruption);
    assert.match(refused.diagnostic, /safe conserved bounds|canonically conserved/i, corruption);
    assert.deepEqual(state, before, `${corruption} cannot move cash, ledger, ticket, or reservation state`);
  }
});

test('unsafe reservation fee quotes reject before booking publication', () => {
  for (const [label, totalAmount] of [
    ['overflow', 1e300],
    ['negative', -10],
    ['not-a-number', Number.NaN],
  ]) {
    const state = newGame('relaxed', `unsafe-booking-fee-${label}`);
    const day = today(state) + 1;
    slotByMinute(state, day, 750);
    const before = structuredClone(state);

    const refused = bookSlot(state, day, 750, {
      holder: `Unsafe Quote ${label}`,
      partySize: 1,
      totalAmount,
    });
    assert.equal(refused.ok, false, label);
    assert.match(refused.diagnostic, /fee quote.*safe currency bounds/i, label);
    assert.deepEqual(state, before, `${label} cannot publish a booking, party, event, or counter`);
  }
});

test('modern no-show marking validates writable safe authority before mutation', () => {
  for (const failure of ['unsafe-fee', 'frozen-record']) {
    const state = newGame('relaxed', `unsafe-no-show-${failure}`);
    const reservation = bookReservation(state, {
      dayAbs: today(state) + 1,
      minute: 780,
      name: `No Show ${failure}`,
      partySize: 1,
      totalFee: 100,
      noShowFee: 20,
      bankDeposit: false,
    }).res;
    if (failure === 'frozen-record') Object.freeze(reservation.noShow);
    const before = structuredClone(state);

    let refused;
    assert.doesNotThrow(() => {
      refused = markReservationNoShow(state, reservation.id, {
        at: reservation.teeTimeAbs + 30,
        ...(failure === 'unsafe-fee' ? { feeAmount: Infinity } : {}),
      });
    });
    assert.equal(refused.ok, false, failure);
    assert.match(refused.diagnostic, failure === 'unsafe-fee'
      ? /no-show authority.*safe bounds/i
      : /no-show projection.*not writable/i, failure);
    assert.deepEqual(state, before, `${failure} cannot partially publish no-show state`);
  }
});

test('a positive no-show fee cannot be forged into a waived payment outcome', () => {
  const state = newGame('relaxed', 4209);
  const reservation = bookReservation(state, {
    dayAbs: today(state) + 1,
    minute: 810,
    name: 'Forged Waiver Golfer',
    partySize: 1,
    totalFee: 100,
    noShowFee: 20,
    bankDeposit: false,
  }).res;
  assert.equal(markReservationNoShow(state, reservation.id, {
    at: reservation.teeTimeAbs + 30,
  }).ok, true);
  reservation.noShowFeeStatus = 'waived';
  const before = structuredClone(state);

  const refused = chargeNoShowFee(state, reservation.id);
  assert.equal(refused.ok, false);
  assert.match(refused.diagnostic, /waived no-show fee.*conflicting.*provenance/i);
  assert.deepEqual(state, before, 'a forged waiver moves no cash and publishes no ticket');
});

test('an immediate deposit-bank failure leaves one visible retryable booking', () => {
  const state = newGame('relaxed', 4210);
  state.reservations.config.autoBookings = false;
  const safeCash = state.cash;
  state.cash = Number.MAX_SAFE_INTEGER / 100;
  const ledgerRowsBefore = state.ledger.entries.length;
  const result = bookReservation(state, {
    dayAbs: today(state) + 1,
    minute: 840,
    name: 'Retryable Deposit Golfer',
    partySize: 1,
    totalFee: 100,
    deposit: 25,
  });

  assert.equal(result.ok, true, 'the published booking remains the authoritative result');
  assert.equal(result.depositResult.ok, false);
  assert.equal(result.depositPending, true);
  assert.equal(state.reservations.booked.filter((entry) => entry.id === result.res.id).length, 1);
  assert.equal(result.res.depositStatus, 'pending');
  assert.equal(state.shop.transactionHistory.length, 0);
  assert.equal(state.ledger.entries.length, ledgerRowsBefore);

  state.cash = safeCash;
  const processed = processReservationTimeline(state, { at: state.clock.minutes + 1 });
  assert.deepEqual(processed.deposits.map((entry) => entry.id), [result.res.id]);
  assert.equal(result.res.depositStatus, 'paid');
  assert.equal(state.cash, safeCash + 25);
  assert.equal(state.shop.transactionHistory.length, 1);
});

test('ordinary check-in rejects forged paid projections before refresh or course mutation', () => {
  for (const corruption of ['stale-due', 'missing-journal']) {
    let state = newGame('relaxed', `forged-check-in-${corruption}`);
    state.clock.minutes = 7 * 60 + 10;
    const reservation = bookSlot(state, today(state), 480, {
      holder: `Forged Check In ${corruption}`,
      partySize: 1,
      totalAmount: 100,
    }).res;
    assert.equal(markReservationArrived(state, reservation.id).ok, true);
    assert.equal(confirmReservation(state, reservation.id).ok, true);
    reservation.payment.amountPaid = reservation.payment.total;
    if (corruption === 'missing-journal') {
      reservation.payment.amountDue = 0;
      reservation.payment.status = 'paid';
      reservation.payment.method = 'card';
      state = deserialize(serialize(state));
    }
    const saved = state.reservations.booked.find((entry) => entry.id === reservation.id);
    const cashBefore = state.cash;
    const ledgerRowsBefore = state.ledger.entries.length;
    const before = structuredClone(state);

    const refused = checkInReservation(state, saved.id, { atMinute: state.clock.minutes });
    assert.equal(refused.ok, false, corruption);
    assert.match(refused.diagnostic, corruption === 'stale-due'
      ? /safe conserved bounds/i
      : /durable payment authority/i, corruption);
    assert.equal(state.cash, cashBefore, `${corruption} cannot move cash`);
    assert.equal(state.ledger.entries.length, ledgerRowsBefore,
      `${corruption} cannot publish a ledger row`);
    assert.deepEqual(state, before,
      `${corruption} cannot refresh payment fields or grant course access`);
  }
});

test('legacy cancellation and no-show require the exact finance row and ledger provenance', () => {
  for (const corruption of ['different-operation', 'missing-ledger']) {
    const state = newGame('relaxed', `cancel-authority-${corruption}`);
    const reservation = bookSlot(state, today(state) + 2, 900, {
      holder: `Cancellation Authority ${corruption}`,
      partySize: 1,
      totalAmount: 100,
    }).res;
    const started = beginReservationPayment(state, reservation.id, 'card', {
      transactionId: `cancel-authority-payment-${corruption}`,
    });
    assert.equal(completeReservationPayment(state, reservation.id, {
      transactionId: started.transactionId,
    }).ok, true);
    const stableId = `golf-finance:${reservation.id}:cancellation-refund`;
    if (corruption === 'different-operation') {
      state.reservations.financeEntries.push({
        id: stableId,
        reservationId: `other-${reservation.id}`,
        category: 'noShowFees',
        kind: 'no-show-fee-charge',
        amount: 1,
        cashDelta: 1,
      });
    } else {
      const projected = structuredClone(state);
      assert.equal(cancelReservation(projected, reservation.id).ok, true);
      state.reservations.financeEntries.push(structuredClone(
        projected.reservations.financeEntries.find((entry) => entry.id === stableId),
      ));
    }
    const cashBefore = state.cash;
    const ledgerRowsBefore = state.ledger.entries.length;
    const before = structuredClone(state);

    const refused = cancelReservation(state, reservation.id);
    assert.equal(refused.ok, false, corruption);
    assert.match(refused.diagnostic, corruption === 'different-operation'
      ? /different operation/i
      : /ledger provenance|different posting/i, corruption);
    assert.equal(state.cash, cashBefore, `${corruption} cannot refund cash`);
    assert.equal(state.ledger.entries.length, ledgerRowsBefore,
      `${corruption} cannot publish a refund ledger row`);
    assert.deepEqual(state, before,
      `${corruption} cannot cancel the booking or attach the forged finance id`);
  }

  for (const corruption of ['different-operation', 'missing-ledger']) {
    const state = newGame('relaxed', `no-show-authority-${corruption}`);
    const reservation = bookSlot(state, today(state) + 1, 930, {
      holder: `No Show Authority ${corruption}`,
      partySize: 1,
      totalAmount: 100,
    }).res;
    const atMinute = reservation.dayAbs * MINUTES_PER_DAY + reservation.minute + 20;
    const stableId = `golf-finance:${reservation.id}:no-show-charge`;
    const transactionId = `golf-no-show-${reservation.id}`;
    if (corruption === 'different-operation') {
      state.reservations.financeEntries.push({
        id: stableId,
        reservationId: `other-${reservation.id}`,
        category: 'bookingRefunds',
        kind: 'refund',
        amount: 100,
        cashDelta: -100,
      });
    } else {
      const projected = structuredClone(state);
      assert.equal(handleNoShow(projected, reservation.id, {
        force: true,
        authorized: true,
        fee: 15,
        atMinute,
      }).ok, true);
      state.reservations.financeEntries.push(structuredClone(
        projected.reservations.financeEntries.find((entry) => entry.id === stableId),
      ));
      state.reservations.processedTransactionIds.push(transactionId);
    }
    const cashBefore = state.cash;
    const ledgerRowsBefore = state.ledger.entries.length;
    const before = structuredClone(state);

    const refused = handleNoShow(state, reservation.id, {
      force: true,
      authorized: true,
      fee: 15,
      atMinute,
    });
    assert.equal(refused.ok, false, corruption);
    assert.match(refused.diagnostic, corruption === 'different-operation'
      ? /different operation/i
      : /ledger provenance|different posting/i, corruption);
    assert.equal(state.cash, cashBefore, `${corruption} cannot charge cash`);
    assert.equal(state.ledger.entries.length, ledgerRowsBefore,
      `${corruption} cannot publish a no-show ledger row`);
    assert.deepEqual(state, before,
      `${corruption} cannot mark a no-show or attach the forged finance id`);
  }
});

test('legacy terminal flows reject frozen projections before moving money', () => {
  {
    const state = newGame('relaxed', 4211);
    const reservation = bookReservation(state, {
      dayAbs: today(state) + 1,
      minute: 870,
      name: 'Frozen Direct Check In',
      partySize: 1,
      totalFee: 100,
      bankDeposit: false,
    }).res;
    reservation.payment = Object.freeze({ ...reservation.payment });
    const before = structuredClone(state);
    let refused;
    assert.doesNotThrow(() => {
      refused = checkInReservation(state, reservation.id);
    });
    assert.equal(refused.ok, false);
    assert.match(refused.diagnostic, /payment authority.*not writable/i);
    assert.deepEqual(state, before, 'direct check-in cannot bank before a frozen projection throws');
  }

  {
    const state = newGame('relaxed', 4212);
    const reservation = bookSlot(state, today(state) + 2, 900, {
      holder: 'Frozen Cancellation',
      partySize: 1,
      totalAmount: 100,
    }).res;
    const started = beginReservationPayment(state, reservation.id, 'card', {
      transactionId: 'frozen-cancellation-payment',
    });
    assert.equal(completeReservationPayment(state, reservation.id, {
      transactionId: started.transactionId,
    }).ok, true);
    Object.defineProperty(reservation, 'status', {
      value: reservation.status,
      writable: false,
      enumerable: true,
      configurable: true,
    });
    const before = structuredClone(state);
    let refused;
    assert.doesNotThrow(() => {
      refused = cancelReservation(state, reservation.id);
    });
    assert.equal(refused.ok, false);
    assert.match(refused.diagnostic, /payment projection.*not writable/i);
    assert.deepEqual(state, before, 'cancellation cannot refund before a frozen projection throws');
  }

  {
    const state = newGame('relaxed', 4213);
    const reservation = bookSlot(state, today(state) + 1, 930, {
      holder: 'Frozen Legacy No Show',
      partySize: 1,
      totalAmount: 100,
    }).res;
    reservation.payment.cardOnFile = true;
    Object.defineProperty(reservation, 'status', {
      value: reservation.status,
      writable: false,
      enumerable: true,
      configurable: true,
    });
    const before = structuredClone(state);
    let refused;
    assert.doesNotThrow(() => {
      refused = handleNoShow(state, reservation.id, {
        force: true,
        authorized: true,
        atMinute: reservation.dayAbs * MINUTES_PER_DAY + reservation.minute + 20,
      });
    });
    assert.equal(refused.ok, false);
    assert.match(refused.diagnostic, /payment projection.*not writable/i);
    assert.deepEqual(state, before, 'no-show cannot charge before a frozen projection throws');
  }
});

test('booking rejects unsafe or reused next ids before publishing any booking authority', () => {
  const unsafeState = newGame('relaxed', 4203);
  unsafeState.reservations.nextId = Number.MAX_SAFE_INTEGER;
  const unsafeBefore = structuredClone(unsafeState);
  const unsafe = bookSlot(unsafeState, today(unsafeState) + 1, 630, {
    holder: 'Unsafe Id Golfer',
    partySize: 1,
  });
  assert.equal(unsafe.ok, false);
  assert.equal(unsafe.reason, 'Customer history is unavailable right now. Try again.');
  assert.match(unsafe.diagnostic, /id.*safe|safe.*id/i);
  assert.deepEqual(unsafeState, unsafeBefore,
    'bookSlot cannot consume a party id or publish schedule/event/customer state');

  const reusedState = newGame('relaxed', 4204);
  const existing = bookSlot(reusedState, today(reusedState) + 1, 660, {
    holder: 'Existing Id Golfer',
    partySize: 1,
  }).res;
  reusedState.reservations.nextId = existing.id;
  const reusedBefore = structuredClone(reusedState);
  const reused = bookReservation(reusedState, {
    dayAbs: today(reusedState) + 1,
    minute: 690,
    name: 'Reused Id Golfer',
    partySize: 1,
  });
  assert.equal(reused.ok, false);
  assert.equal(reused.reason, 'Customer history is unavailable right now. Try again.');
  assert.match(reused.diagnostic, /id.*already in use/i);
  assert.deepEqual(reusedState, reusedBefore,
    'bookReservation rejects before allocating a customer or mutating the sheet');
});
