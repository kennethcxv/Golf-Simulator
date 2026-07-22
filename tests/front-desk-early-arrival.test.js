// The 1:30-and-invisible bug: a guest with a live booking walks in ahead of their planned
// arrival, stands at the desk, and the computer's check-in list doesn't show them —
// dueForCheckIn gates on plannedArrival/arrivalStatus and cannot see physical presence.
// deskReservationList is the desk's actual truth: due by the book ∪ physically present.
import test from 'node:test';
import assert from 'node:assert/strict';

import { newGame } from '../src/sim/state.js';
import {
  bookSlot, dueForCheckIn, deskReservationList,
} from '../src/sim/reservations.js';
import { calendarOf } from '../src/sim/time.js';

function bookAt(state, minuteOfDay, name) {
  const cal = calendarOf(state.clock.minutes);
  const res = bookSlot(state, cal.dayAbs, minuteOfDay, name);
  assert.ok(res.ok, `booking at ${minuteOfDay} should succeed`);
  return res.res;
}

test('a guest who arrives early is on the desk list while dueForCheckIn still hides them', () => {
  const st = newGame('relaxed', 91);
  const dayStart = Math.floor(st.clock.minutes / 1440) * 1440;
  const r = bookAt(st, 13 * 60 + 30, 'Early Bird'); // the 1:30 PM tee time
  // 12:30 PM — ahead of plannedArrival (manual bookings carry a 45-minute lead → 12:45),
  // guest not yet marked arrived, but standing at the desk all the same
  st.clock.minutes = dayStart + 12 * 60 + 30;
  assert.equal(r.status, 'booked');
  assert.ok(st.clock.minutes < r.plannedArrival, 'repro requires being ahead of plannedArrival');
  assert.ok(!dueForCheckIn(st).some((x) => x.id === r.id), 'the old filter hides the early guest');
  const desk = deskReservationList(st, [r.id]);
  assert.ok(desk.some((x) => x.id === r.id), 'physical presence must put them on the desk');
});

test('without presence the desk list matches dueForCheckIn exactly', () => {
  const st = newGame('relaxed', 92);
  const dayStart = Math.floor(st.clock.minutes / 1440) * 1440;
  const r = bookAt(st, 9 * 60, 'On Time');
  st.clock.minutes = dayStart + 9 * 60; // at the tee time — due by the book
  const due = dueForCheckIn(st);
  assert.ok(due.some((x) => x.id === r.id));
  assert.deepEqual(
    deskReservationList(st, []).map((x) => x.id),
    due.slice().sort((a, b) => a.minute - b.minute || a.id - b.id).map((x) => x.id),
  );
});

test('presence never duplicates an already-due row, and stale ids are ignored', () => {
  const st = newGame('relaxed', 93);
  const dayStart = Math.floor(st.clock.minutes / 1440) * 1440;
  const r = bookAt(st, 10 * 60, 'Twice Nowhere');
  st.clock.minutes = dayStart + 10 * 60;
  const desk = deskReservationList(st, [r.id, r.id, 999999]);
  assert.equal(desk.filter((x) => x.id === r.id).length, 1);
});

test('a pre-rolled no-show who shows up anyway gets listed — reality outranks the roll', () => {
  const st = newGame('relaxed', 94);
  const dayStart = Math.floor(st.clock.minutes / 1440) * 1440;
  const r = bookAt(st, 11 * 60, 'Contrarian');
  r.willNoShow = true;
  st.clock.minutes = dayStart + 11 * 60;
  assert.ok(!dueForCheckIn(st).some((x) => x.id === r.id), 'the roll hides them by default');
  assert.ok(deskReservationList(st, [r.id]).some((x) => x.id === r.id));
});

test('a cancelled or played booking never rides in on presence', () => {
  const st = newGame('relaxed', 95);
  const dayStart = Math.floor(st.clock.minutes / 1440) * 1440;
  const r = bookAt(st, 12 * 60, 'Ghost');
  r.status = 'cancelled';
  st.clock.minutes = dayStart + 12 * 60;
  assert.ok(!deskReservationList(st, [r.id]).some((x) => x.id === r.id));
});
