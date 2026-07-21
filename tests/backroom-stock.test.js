import test from 'node:test';
import assert from 'node:assert/strict';
import {
  allocateBackroomCases, backroomCaseCapacity, backroomCaseSlots,
} from '../src/render3d/backroomStock.js';

const racks = [
  { id: 'north', kind: 'backshelf' },
  { id: 'door', kind: 'backshelf', short: true },
  { id: 'east', kind: 'backshelf' },
];

test('backroom cases are shared across racks instead of duplicated on each one', () => {
  const counts = allocateBackroomCases(racks, 150);
  assert.equal([...counts.values()].reduce((sum, count) => sum + count, 0), 25);
  assert.deepEqual([...counts.values()], [9, 8, 8]);
  for (const rack of racks) {
    assert.ok(counts.get(rack.id) <= backroomCaseCapacity(rack));
  }
});

test('short-rack cartons stay within its posts and rest on shelf boards', () => {
  const short = racks[1];
  const slots = backroomCaseSlots(short, 99);
  assert.equal(slots.length, 8, 'the short rack exposes only eight safe case slots');
  for (const slot of slots) {
    assert.ok(Math.abs(slot.x) + 0.25 < 0.85, `carton at x=${slot.x} stays inside the 1.7 yd rack`);
    assert.ok(slot.y - 0.18 >= 0.185, 'carton bottom rests on a shelf board');
    assert.ok(slot.y + 0.18 < 2.06, 'carton top remains below the top board');
  }
});
