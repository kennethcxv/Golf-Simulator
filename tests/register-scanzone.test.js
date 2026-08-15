// THE SCAN ZONE — and why a naive "is the barcode inside the box?" check is a bug.
//
// The player drags an item across the scanner with a mouse. A mouse moves in jumps:
// at 60 fps a fast flick can carry the barcode 30 cm between one frame and the next,
// straight over a 24 cm scan volume and out the far side without ever being sampled
// INSIDE it. The item would land in the bag unscanned, the player would swear they
// scanned it, and the register would refuse payment. That is a rage-quit bug.
//
// So the test is SWEPT: the segment the barcode travelled this frame against the box.

import test from 'node:test';
import assert from 'node:assert/strict';
import { segmentHitsBox } from '../src/sim/register.js';
import { REGISTER } from '../src/data/shopLayout.js';

const box = { minX: 0, maxX: 1, minZ: 0, maxZ: 1, minY: 0, maxY: 1 };
const p = (x, y, z) => ({ x, y, z });

test('a segment that ends inside the box hits it', () => {
  assert.equal(segmentHitsBox(p(-1, 0.5, 0.5), p(0.5, 0.5, 0.5), box), true);
});

test('a segment that starts inside the box hits it', () => {
  assert.equal(segmentHitsBox(p(0.5, 0.5, 0.5), p(3, 0.5, 0.5), box), true);
});

test('a segment entirely inside the box hits it', () => {
  assert.equal(segmentHitsBox(p(0.4, 0.5, 0.5), p(0.6, 0.5, 0.5), box), true);
});

test('THE TUNNELLING CASE: a segment that leaps clean over the box still hits it', () => {
  // both endpoints are outside, on opposite sides. A point-in-box check would MISS
  // this — and this is exactly what a fast mouse flick looks like.
  assert.equal(segmentHitsBox(p(-2, 0.5, 0.5), p(3, 0.5, 0.5), box), true);
  // diagonally, too
  assert.equal(segmentHitsBox(p(-1, -1, -1), p(2, 2, 2), box), true);
});

test('a segment that passes beside the box does not hit it', () => {
  assert.equal(segmentHitsBox(p(-2, 0.5, 2.5), p(3, 0.5, 2.5), box), false);
  assert.equal(segmentHitsBox(p(-2, 5, 0.5), p(3, 5, 0.5), box), false);
});

test('a segment that stops short of the box does not hit it', () => {
  assert.equal(segmentHitsBox(p(-2, 0.5, 0.5), p(-0.1, 0.5, 0.5), box), false);
});

test('a zero-length segment is just a point test', () => {
  assert.equal(segmentHitsBox(p(0.5, 0.5, 0.5), p(0.5, 0.5, 0.5), box), true);
  assert.equal(segmentHitsBox(p(9, 9, 9), p(9, 9, 9), box), false);
});

test('a barcode flicked across the real scan volume at mouse speed registers', () => {
  const s = REGISTER.scan;
  const midZ = (s.minZ + s.maxZ) / 2;
  const midY = (s.minY + s.maxY) / 2;
  // 0.9 yd of travel in one frame — a hard flick. It leaps the whole 0.56 yd volume.
  const from = p(s.minX - 0.35, midY, midZ);
  const to = p(s.maxX + 0.35, midY, midZ);
  assert.ok(to.x - from.x > (s.maxX - s.minX), 'the flick really does overshoot the volume');
  assert.equal(segmentHitsBox(from, to, s), true, 'and it still scans');
});

test('carrying an item along the customer side of the counter does NOT scan it', () => {
  const s = REGISTER.scan;
  const midY = (s.minY + s.maxY) / 2;
  // sliding it along the front edge, well south of the scanner
  const z = REGISTER.staging.minZ;
  assert.equal(segmentHitsBox(p(1.5, midY, z), p(4.4, midY, z), s), false);
});

test('lifting an item high over the scanner clears it - the volume has a ceiling', () => {
  const s = REGISTER.scan;
  const midZ = (s.minZ + s.maxZ) / 2;
  const high = s.maxY + 0.2;
  assert.equal(segmentHitsBox(p(2.0, high, midZ), p(3.4, high, midZ), s), false);
});
