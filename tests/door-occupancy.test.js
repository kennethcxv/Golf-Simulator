// "Never close through an actor."
//
// The door held itself open while the player lingered *near* it, but nothing consulted the
// doorway before actually shutting: a customer standing still in the opening (too slow to count
// as "heading through", too far to count as "in it"), a box set down in the threshold, or the
// player mid-stride all got the slab swung through them. Filmed: the player walking into the
// stockroom door was stopped dead at the threshold as it closed across their path.
//
// A door may only close through empty air. This is the predicate that decides that.

import test from 'node:test';
import assert from 'node:assert/strict';
import { sweptBy, SWING } from '../src/data/doorMath.js';

// a door on an x-running wall, hinge at local (0,0), open 1.92 rad, slab 1.1 long
const door = { along: 'x', lx: 0, lz: 0, slabW: 1.1, angle: SWING };

test('an actor standing in the open doorway is in the slab’s path', () => {
  // the closed slab lies along +x from the hinge; someone standing there blocks it
  assert.equal(sweptBy(door, 0.55, 0, 0.34), true);
});

test('an actor standing where the slab currently rests is in its path', () => {
  // at angle 1.92 the slab points mostly -z from the hinge
  const tipX = 0 + Math.cos(SWING) * 1.1;
  const tipZ = 0 - Math.sin(SWING) * 1.1;
  assert.equal(sweptBy(door, tipX * 0.6, tipZ * 0.6, 0.34), true);
});

test('an actor well clear of the swing is not in its path', () => {
  assert.equal(sweptBy(door, 4, 4, 0.34), false, 'across the room');
  assert.equal(sweptBy(door, 0, 3, 0.34), false, 'behind the door, out of the arc');
});

test('an actor just outside the slab’s reach is not in its path', () => {
  assert.equal(sweptBy(door, 1.1 + 0.34 + 0.2, 0, 0.34), false);
});

test('a bigger actor is caught sooner (the radius is respected)', () => {
  const justOut = 1.1 + 0.30;
  assert.equal(sweptBy(door, justOut, 0, 0.15), false, 'a small box clears it');
  assert.equal(sweptBy(door, justOut, 0, 0.6), true, 'a wide one does not');
});

test('a closed door sweeps nothing (it has nowhere to go)', () => {
  const shut = { ...door, angle: 0 };
  assert.equal(sweptBy(shut, 0.55, 0, 0.34), false, 'already shut: closing again moves no slab');
});

test('the mirrored swing direction works the same way', () => {
  const other = { along: 'x', lx: 0, lz: 0, slabW: 1.1, angle: -SWING };
  const tipX = Math.cos(-SWING) * 1.1;
  const tipZ = -Math.sin(-SWING) * 1.1;
  assert.equal(sweptBy(other, tipX * 0.6, tipZ * 0.6, 0.34), true);
  assert.equal(sweptBy(other, 0.55, 0, 0.34), true, 'the doorway itself still counts');
});

test('a door on a z-running wall uses the same rule', () => {
  const zDoor = { along: 'z', lx: 0, lz: 0, slabW: 1.1, angle: SWING };
  assert.equal(sweptBy(zDoor, 0, 0.55, 0.34), true, 'standing in the opening');
  assert.equal(sweptBy(zDoor, 4, 4, 0.34), false, 'across the room');
});
