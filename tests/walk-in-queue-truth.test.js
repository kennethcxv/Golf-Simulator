// A (Goal 21) — the check-in screen shows the person AT THE DESK and nobody
// else, and the front of the line never walks out.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  walkInQueueStatus, walkInShowsAsk, WALK_IN_QUEUE_STATUS,
} from '../src/render3d/clubhouse/simplifiedRegisterMode.js';
import {
  queuePositionMayAbandon, QUEUE_NEVER_ABANDON_DEPTH,
} from '../src/sim/customerSimulation.js';

const person = (over = {}) => ({
  customerId: 'c1', queueIndex: -1, atSlot: false, requestedTeeMinute: 8 * 60, ...over,
});

// ---- A1: "IN QUEUE" is deleted -------------------------------------------

test('A1: only the person at the desk is on the screen', () => {
  // Three sessions were spent making the IN QUEUE badge tell the truth. The
  // answer is that it should not exist: everybody behind the front of the line
  // has not asked for anything yet, and a row for someone who has not spoken is
  // a row the player can plan against before the conversation happens.
  assert.equal(walkInQueueStatus(person({ queueIndex: 0, atSlot: true })),
    WALK_IN_QUEUE_STATUS.atDesk);
  assert.equal(walkInQueueStatus(person({ queueIndex: 0, atSlot: false })), null,
    'first in line but still walking up is not at the desk');
  assert.equal(walkInQueueStatus(person({ queueIndex: 1, atSlot: true })), null,
    'second in line must not appear at all');
  assert.equal(walkInQueueStatus(person({ queueIndex: 4, atSlot: true })), null);
  assert.equal(walkInQueueStatus(person({ queueIndex: -1, atSlot: false })), null);
  assert.equal(walkInQueueStatus(null), null);
});

test('A1: the badge itself is gone, not merely unused', () => {
  // A constant left lying about is how a deleted concept comes back.
  assert.deepEqual(Object.values(WALK_IN_QUEUE_STATUS), ['AT DESK']);
  assert.equal(WALK_IN_QUEUE_STATUS.inQueue, undefined);
  assert.equal(WALK_IN_QUEUE_STATUS.walkingUp, undefined);
});

test('the asked time still only shows for the person asking', () => {
  assert.equal(walkInShowsAsk(person({ queueIndex: 0, atSlot: true })), true);
  assert.equal(walkInShowsAsk(person({ queueIndex: 1, atSlot: true })), false);
  assert.equal(walkInShowsAsk(person({ queueIndex: 0, atSlot: false })), false);
  assert.equal(
    walkInShowsAsk(person({ queueIndex: 0, atSlot: true, requestedTeeMinute: null })),
    false,
  );
});

// ---- A2: the front of the line never leaves ------------------------------

test('A2: positions one and two never abandon, however long it takes', () => {
  // The owner's worst bug: a customer waits through the person ahead, reaches
  // the front, and walks out before they can be served. Whatever that modelled,
  // what the player experiences is being punished for doing the job right.
  assert.equal(queuePositionMayAbandon(0), false, 'the person being served must never leave');
  assert.equal(queuePositionMayAbandon(1), false, 'nor the one next in line');
});

test('A2: from third place back, patience is real', () => {
  // That is where the pressure the game wants actually lives: felt by the
  // people you have not started on, not by the one you are halfway through.
  assert.equal(queuePositionMayAbandon(2), true);
  assert.equal(queuePositionMayAbandon(5), true);
  assert.equal(QUEUE_NEVER_ABANDON_DEPTH, 2);
});

test('A2: somebody not in the line at all is unaffected by the rule', () => {
  // Browsers, people who could not join a full line, anyone mid-checkout: the
  // rule is about queue position and must not silently pin everyone in place.
  assert.equal(queuePositionMayAbandon(-1), true);
  assert.equal(queuePositionMayAbandon(NaN), true);
  assert.equal(queuePositionMayAbandon(undefined), true);
  assert.equal(queuePositionMayAbandon(null), true);
});
