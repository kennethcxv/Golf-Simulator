// D1 (Goal 20) — "IN QUEUE" means standing in the line, and the time they want
// is something you hear when they are in front of you.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  walkInQueueStatus, walkInShowsAsk, WALK_IN_QUEUE_STATUS,
} from '../src/render3d/clubhouse/simplifiedRegisterMode.js';

const person = (over = {}) => ({
  customerId: 'c1', queueIndex: -1, atSlot: false, requestedTeeMinute: 8 * 60, ...over,
});

test('someone who is not in the line is not on the list', () => {
  // The regression this replaces: walkIns() hands over every open walk-in in
  // the building, so a golfer who came in ten minutes ago and is browsing the
  // shelves sat on the check-in list reading WALKING UP for as long as they
  // shopped. A null status is how the list drops them.
  assert.equal(walkInQueueStatus(person({ queueIndex: -1, atSlot: false })), null);
  assert.equal(walkInQueueStatus(person({ queueIndex: -1, atSlot: true })), null,
    'standing near the counter is not the same as being in the queue');
  assert.equal(walkInQueueStatus(null), null);
  assert.equal(walkInQueueStatus(undefined), null);
});

test('IN QUEUE requires being physically at your place in the line', () => {
  // queued but still crossing the room
  assert.equal(walkInQueueStatus(person({ queueIndex: 2, atSlot: false })),
    WALK_IN_QUEUE_STATUS.walkingUp);
  // queued and standing in it
  assert.equal(walkInQueueStatus(person({ queueIndex: 2, atSlot: true })),
    WALK_IN_QUEUE_STATUS.inQueue);
  // first in line, but not yet arrived at the desk
  assert.equal(walkInQueueStatus(person({ queueIndex: 0, atSlot: false })),
    WALK_IN_QUEUE_STATUS.walkingUp);
  // first in line and there
  assert.equal(walkInQueueStatus(person({ queueIndex: 0, atSlot: true })),
    WALK_IN_QUEUE_STATUS.atDesk);
});

test('the time they want is only visible when they are at the desk asking', () => {
  assert.equal(walkInShowsAsk(person({ queueIndex: 0, atSlot: true })), true);
  assert.equal(walkInShowsAsk(person({ queueIndex: 1, atSlot: true })), false,
    'a person in the line has not asked yet');
  assert.equal(walkInShowsAsk(person({ queueIndex: 0, atSlot: false })), false);
  assert.equal(walkInShowsAsk(person({ queueIndex: -1, atSlot: false })), false);
  // and somebody at the desk with nothing in mind shows no time either
  assert.equal(
    walkInShowsAsk(person({ queueIndex: 0, atSlot: true, requestedTeeMinute: null })),
    false,
  );
});
