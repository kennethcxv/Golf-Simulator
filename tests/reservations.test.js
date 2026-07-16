// TEE-TIME RESERVATIONS — an additive booking calendar layered over golfer
// arrivals. It never modifies rounds.js or golfers.js: bookings are their own
// records, payment is collected at the shop counter check-in, and the daily
// tick only expires stale bookings. Tests drive the data model first.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, serialize, deserialize, update } from '../src/sim/state.js';
import { calendarOf } from '../src/sim/time.js';
import { MINUTES_PER_DAY } from '../src/sim/constants.js';
import {
  TEE_SHEET, slotTimes, daySheet, bookSlot, cancelReservation,
  dueForCheckIn, checkInReservation, reservationsDailyTick, ensureReservations,
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

test('booking a slot marks it unavailable; double-booking the same slot is refused', () => {
  const state = newGame('relaxed', 42);
  const day = today(state) + 1;
  const res = bookSlot(state, day, 480, 'Ray Falk');
  assert.ok(res.ok, 'an open 8:00 books cleanly');
  assert.equal(res.res.fee, state.club.greenFee, 'fee snapshots the green fee at booking');

  const sheet = daySheet(state, day);
  const slot = sheet.find((s) => s.minute === 480);
  assert.equal(slot.res.name, 'Ray Falk', 'the calendar shows who holds the slot');

  const again = bookSlot(state, day, 480, 'Second Golfer');
  assert.equal(again.ok, false, 'the same slot cannot be booked twice');
  assert.match(again.reason, /taken/i);
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

test('a booked golfer checks in at the counter and pays the snapshotted fee once', () => {
  const state = newGame('relaxed', 42);
  const day = today(state) + 1;
  const { res } = bookSlot(state, day, 480, 'Ray Falk');
  state.club.greenFee = 99; // fee hikes after booking do not reprice the slot

  assert.equal(dueForCheckIn(state).length, 0, 'nothing due the day before');
  update(state, MINUTES_PER_DAY); // roll into the booked day (also runs daily ticks)
  // walk the clock to just before the slot
  const cal = calendarOf(state.clock.minutes);
  update(state, 480 - 45 - cal.minuteOfDay);
  const due = dueForCheckIn(state);
  assert.equal(due.length, 1, 'the 8:00 booking is due at the counter');

  const cashBefore = state.cash;
  const fees = state.ledger.today.revenue.greenFees;
  const pay = checkInReservation(state, due[0].id);
  assert.ok(pay.ok, 'check-in succeeds');
  assert.equal(pay.fee, 32, 'the fee is the one from booking day');
  assert.equal(state.cash, cashBefore + 32, 'payment landed in the wallet');
  assert.equal(state.ledger.today.revenue.greenFees, fees + 32, 'booked as green fees');

  assert.equal(checkInReservation(state, due[0].id).ok, false, 'no double-charging');
  assert.equal(dueForCheckIn(state).length, 0, 'checked-in golfers leave the due list');
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
