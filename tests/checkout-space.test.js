// You have to be able to stand behind your own till.
//
// Measured in the running game: the counter's back face sits at z 5.2 and the back counter's front
// face at z 5.75 — a 0.55 yd slot. A person is 0.68 yd across. The player could not fit behind the
// register at all, which is why "there is insufficient room behind the checkout counter" and "the
// player can have difficulty entering the staff side".
//
// A till is a workspace: you stand at it, you turn, you pull the drawer open, you bag. That needs
// real room, and the room has to survive anyone editing the floor plan.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COUNTER, FIXTURES, INTERIOR, PLAYER_DIAM, STAFF_CORRIDOR_MIN, queueSlot,
} from '../src/data/shopLayout.js';

const backcounter = FIXTURES.find((f) => f.kind === 'backcounter');
const BACKCOUNTER_DEPTH = 0.56; // the cabinet top, which is the widest part of it

const counterBack = COUNTER.z + COUNTER.depth / 2;
const backcounterFront = backcounter.z - BACKCOUNTER_DEPTH / 2;

test('a person is wider than nothing — the constants are honest', () => {
  assert.ok(PLAYER_DIAM > 0.6 && PLAYER_DIAM < 0.8, 'a human, in yards');
  assert.ok(STAFF_CORRIDOR_MIN > PLAYER_DIAM, 'a corridor you can only just squeeze through is not a workspace');
});

test('the staff side of the counter is wide enough to work in', () => {
  const corridor = backcounterFront - counterBack;
  assert.ok(
    corridor >= STAFF_CORRIDOR_MIN,
    `the till workspace is ${corridor.toFixed(2)} yd; a person is ${PLAYER_DIAM} yd and needs ${STAFF_CORRIDOR_MIN}`,
  );
});

test('the staff corridor has a way in from the sales floor', () => {
  // its west end must not be walled off: the counter's west end is the doorway into the staff side
  const counterWest = COUNTER.x - COUNTER.len / 2;
  const backcounterWest = backcounter.x - 3.3 / 2; // cabinet top is 3.3 wide
  const mouth = Math.min(counterWest, backcounterWest);
  assert.ok(mouth > -INTERIOR.w / 2 + 1.0, 'there is floor to the west of the counter to walk in from');
});

test('the back counter stays off the south wall', () => {
  const wallInner = INTERIOR.d / 2;
  assert.ok(
    backcounter.z + BACKCOUNTER_DEPTH / 2 < wallInner - 0.05,
    'the cabinets do not clip through the building',
  );
});

test('customers queue clear of the counter, not pressed against it', () => {
  const front = COUNTER.z - COUNTER.depth / 2; // the shopper's side
  const slot0 = queueSlot(0);
  const gap = front - slot0.z;
  assert.ok(gap > 0.45, `the first in line stands ${gap.toFixed(2)} yd off the counter, not inside it`);
  assert.ok(gap < 2.2, 'but still close enough to be served');
});

test('the queue falls back into the room, away from the counter', () => {
  const a = queueSlot(0);
  const b = queueSlot(3);
  assert.ok(b.z < a.z, 'the line runs back into the shop');
  assert.ok(Math.hypot(b.x - a.x, b.z - a.z) > 1.5, 'and it is a line, not a huddle');
});
