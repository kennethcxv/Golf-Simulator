// B3 (Goal 23) — the queue does not walk into the person paying.
//
// Reported fixed twice. The control in every test here is the SHIPPED
// PREDECESSOR: target the array index directly, the instant the served customer
// is spliced out. Running both rules over the same departure and asserting the
// old one collides is what makes the new one mean something — a test that only
// shows the fix passing cannot tell a fix from a coincidence, and this item has
// already survived two of those.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  queueAdvanceSlot, queueSlotIsClear, QUEUE_ADVANCE_CLEARANCE,
} from '../src/sim/customerSimulation.js';

// The real line: a base point and a fixed step, as shopLayout builds it.
const SLOT = (i) => ({ x: -0.8 + 0.0 * i, z: 2.2 + 1.15 * i });

test('a slot with a body standing in it is not clear', () => {
  const occupied = SLOT(0);
  assert.equal(queueSlotIsClear(occupied, [{ x: occupied.x, z: occupied.z }]), false);
  // and one step of the line away IS clear
  assert.equal(queueSlotIsClear(occupied, [SLOT(1)]), true);
});

test('clearance is wider than a collision radius, because closing counts', () => {
  // The steering code treats 0.6 as customer-on-customer contact. A follower who
  // sets off at 0.61 is still walking at someone who has barely turned round,
  // and from behind the counter that IS walking into their back.
  const slot = SLOT(0);
  assert.ok(QUEUE_ADVANCE_CLEARANCE > 0.6);
  assert.equal(queueSlotIsClear(slot, [{ x: slot.x, z: slot.z + 0.61 }]), false);
  assert.equal(queueSlotIsClear(slot, [{ x: slot.x, z: slot.z + 1.2 }]), true);
});

test('THE BUG: the old rule sends the follower into the leaver, the new one does not', () => {
  // The served customer has just been spliced out of the array and is standing
  // still at slot 0 for a beat before they turn for the door — the "pauses for a
  // second or two" in the report. The follower's array index is now 0.
  const leaver = { ...SLOT(0) };
  const followerHeld = 1;
  const wantedIndex = 0;

  // CONTROL — the shipped rule: take the array index, immediately.
  const oldTarget = SLOT(wantedIndex);
  const oldGap = Math.hypot(oldTarget.x - leaver.x, oldTarget.z - leaver.z);
  assert.ok(oldGap < 0.6,
    `control: the old rule aims the follower at the leaver's own spot (gap ${oldGap.toFixed(2)})`);

  // THE RULE — ask the floor.
  const bodies = [leaver];
  const newSlot = queueAdvanceSlot(followerHeld, wantedIndex, (i) => queueSlotIsClear(SLOT(i), bodies));
  assert.equal(newSlot, 1, 'the follower holds their slot while the leaver is still standing there');
  const newTarget = SLOT(newSlot);
  const newGap = Math.hypot(newTarget.x - leaver.x, newTarget.z - leaver.z);
  assert.ok(newGap > QUEUE_ADVANCE_CLEARANCE,
    `and their target stays clear of the leaver (gap ${newGap.toFixed(2)})`);
});

test('and they DO move up once the leaver has actually gone', () => {
  const followerHeld = 1;
  // the leaver has walked off toward the door
  const bodies = [{ x: -0.8, z: -3.5 }];
  const slot = queueAdvanceSlot(followerHeld, 0, (i) => queueSlotIsClear(SLOT(i), bodies));
  assert.equal(slot, 0, 'cleared means cleared: the line moves up');
});

test('a three-deep line advances one step at a time, not all at once', () => {
  // Everyone lunging forward on the same frame is the pile-up this replaces.
  // Third place may only reach slot 1 after second place has vacated it.
  // The served customer is OUT of the array and standing at slot 0 as `leaver`;
  // b and c are what is left of the line and their array indices are now 0 and 1.
  const positions = { b: 1, c: 2 }; // held slots
  const leaver = { ...SLOT(0) };
  const bodyOf = (held) => SLOT(held);
  const step = () => {
    const bodies = {
      b: [leaver, bodyOf(positions.c)],
      c: [leaver, bodyOf(positions.b)],
    };
    const wantedBy = { b: 0, c: 1 };
    const next = {};
    for (const who of ['b', 'c']) {
      next[who] = queueAdvanceSlot(positions[who], wantedBy[who], (i) => queueSlotIsClear(SLOT(i), bodies[who]));
    }
    Object.assign(positions, next);
  };

  step();
  assert.equal(positions.b, 1, 'b cannot take slot 0 while the leaver stands in it');
  assert.equal(positions.c, 2, 'and c cannot take slot 1 while b is still in it');

  // the leaver walks away
  leaver.z = -4;
  step();
  assert.equal(positions.b, 0, 'now b moves up');
  assert.equal(positions.c, 2, 'and c still waits, because b has only just left slot 1');
  step();
  assert.equal(positions.c, 1, 'c follows on the next step, one at a time');
});

test('falling back is always allowed', () => {
  // Someone rejoining ahead, or the line growing, must never be blocked by a
  // clearance test — a customer stuck unable to take a FURTHER slot would stand
  // in the aisle for ever.
  const slot = queueAdvanceSlot(0, 2, () => false);
  assert.equal(slot, 2, 'moving back needs no permission');
});

test('a customer with no held slot takes the one the line gives them', () => {
  assert.equal(queueAdvanceSlot(null, 3, () => false), 3);
  assert.equal(queueAdvanceSlot(undefined, 0, () => false), 0);
});
