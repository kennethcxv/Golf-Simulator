import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ZONE, GRID_W, GRID_H, CELL_YD, HOLE_STATUS } from '../src/sim/constants.js';
import {
  makeCourse, inBounds, getZone, setZone, getElev, setElev,
  addHole, holeDistanceYd, parForDistance, validateHole,
  labelSections, courseDesignRating,
} from '../src/sim/course.js';

function paintRect(course, x0, y0, x1, y1, zone) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) setZone(course, x, y, zone);
}

test('makeCourse builds an empty out-of-play grid', () => {
  const c = makeCourse();
  assert.equal(c.w, GRID_W);
  assert.equal(c.h, GRID_H);
  assert.equal(getZone(c, 0, 0), ZONE.OUT);
  assert.equal(getZone(c, GRID_W - 1, GRID_H - 1), ZONE.OUT);
  assert.equal(getElev(c, 5, 5), 0);
  assert.deepEqual(c.holes, []);
});

test('zone and elevation set/get round-trip; out of bounds is safe', () => {
  const c = makeCourse();
  setZone(c, 3, 4, ZONE.FAIRWAY);
  assert.equal(getZone(c, 3, 4), ZONE.FAIRWAY);
  setElev(c, 3, 4, 7.5);
  assert.ok(Math.abs(getElev(c, 3, 4) - 7.5) < 1e-6);
  assert.equal(inBounds(c, -1, 0), false);
  assert.equal(inBounds(c, 0, c.h), false);
  assert.equal(getZone(c, -5, -5), ZONE.OUT); // safe default, no throw
});

test('parForDistance follows real par bands', () => {
  assert.equal(parForDistance(120), 3);
  assert.equal(parForDistance(250), 3);
  assert.equal(parForDistance(251), 4);
  assert.equal(parForDistance(470), 4);
  assert.equal(parForDistance(471), 5);
});

test('holeDistanceYd converts cell distance to yards', () => {
  const c = makeCourse();
  const h = addHole(c);
  h.tee = { x: 10, y: 10 };
  h.pin = { x: 10, y: 40 };
  assert.equal(holeDistanceYd(h), 30 * CELL_YD); // 240 yd
});

test('validateHole catches missing tee, wrong zones, and bad distance', () => {
  const c = makeCourse();
  const h = addHole(c);
  assert.equal(validateHole(c, h).valid, false); // nothing placed

  // proper tee pad and green
  paintRect(c, 9, 9, 11, 11, ZONE.TEE);
  paintRect(c, 8, 38, 12, 42, ZONE.GREEN);
  h.tee = { x: 10, y: 10 };
  h.pin = { x: 10, y: 40 };
  const ok = validateHole(c, h);
  assert.equal(ok.valid, true, JSON.stringify(ok.reasons));

  // pin sitting on fairway instead of green → invalid
  const h2 = addHole(c);
  h2.tee = { x: 10, y: 10 };
  h2.pin = { x: 30, y: 40 };
  paintRect(c, 29, 39, 31, 41, ZONE.FAIRWAY);
  assert.equal(validateHole(c, h2).valid, false);

  // absurdly short hole → invalid
  const h3 = addHole(c);
  paintRect(c, 14, 9, 15, 10, ZONE.GREEN);
  h3.tee = { x: 10, y: 10 };
  h3.pin = { x: 14, y: 9 }; // ~4-5 cells ≈ 35 yd < 60 yd minimum
  assert.equal(validateHole(c, h3).valid, false);
});

test('labelSections finds contiguous blobs with 4-connectivity', () => {
  const c = makeCourse();
  paintRect(c, 2, 2, 5, 5, ZONE.FAIRWAY);
  paintRect(c, 20, 20, 24, 22, ZONE.FAIRWAY);
  // diagonal-only touch must NOT merge: cell at (6,6) touches (5,5) only diagonally
  setZone(c, 6, 6, ZONE.FAIRWAY);
  const sections = labelSections(c);
  const fairways = sections.filter((s) => s.zone === ZONE.FAIRWAY);
  assert.equal(fairways.length, 3);
  const sizes = fairways.map((s) => s.size).sort((a, b) => a - b);
  assert.deepEqual(sizes, [1, 15, 16]);
});

test('sections associate to holes and greens take their hole number', () => {
  const c = makeCourse();
  paintRect(c, 9, 9, 10, 10, ZONE.TEE);
  paintRect(c, 9, 12, 11, 36, ZONE.FAIRWAY);
  paintRect(c, 8, 38, 12, 42, ZONE.GREEN);
  const h = addHole(c);
  h.tee = { x: 10, y: 10 };
  h.pin = { x: 10, y: 40 };
  h.status = HOLE_STATUS.OPEN;

  const sections = labelSections(c);
  const green = sections.find((s) => s.zone === ZONE.GREEN);
  assert.equal(green.holeId, h.id);
  assert.equal(green.name, 'Green 1');
  const fw = sections.find((s) => s.zone === ZONE.FAIRWAY);
  assert.equal(fw.holeId, h.id);
  assert.match(fw.name, /Fairway 1/);
  const tee = sections.find((s) => s.zone === ZONE.TEE);
  assert.equal(tee.name, 'Tee 1');
});

test('far-away blobs associate to no hole', () => {
  const c = makeCourse();
  paintRect(c, 9, 9, 10, 10, ZONE.TEE);
  paintRect(c, 8, 38, 12, 42, ZONE.GREEN);
  const h = addHole(c);
  h.tee = { x: 10, y: 10 };
  h.pin = { x: 10, y: 40 };
  paintRect(c, 100, 70, 104, 74, ZONE.BUNKER); // nowhere near hole 1
  const sections = labelSections(c);
  const bunker = sections.find((s) => s.zone === ZONE.BUNKER);
  assert.equal(bunker.holeId, null);
});

test('courseDesignRating is 0 empty, grows with real holes, stays within 0..100', () => {
  const c = makeCourse();
  assert.equal(courseDesignRating(c), 0);

  // one complete open hole
  paintRect(c, 9, 9, 10, 10, ZONE.TEE);
  paintRect(c, 9, 12, 11, 36, ZONE.FAIRWAY);
  paintRect(c, 8, 38, 12, 42, ZONE.GREEN);
  const h1 = addHole(c);
  h1.tee = { x: 10, y: 10 };
  h1.pin = { x: 10, y: 40 };
  h1.status = HOLE_STATUS.OPEN;
  const r1 = courseDesignRating(c);
  assert.ok(r1 > 0, `expected >0, got ${r1}`);

  // second open hole increases rating
  paintRect(c, 29, 9, 30, 10, ZONE.TEE);
  paintRect(c, 29, 12, 31, 36, ZONE.FAIRWAY);
  paintRect(c, 28, 38, 32, 42, ZONE.GREEN);
  const h2 = addHole(c);
  h2.tee = { x: 30, y: 10 };
  h2.pin = { x: 30, y: 40 };
  h2.status = HOLE_STATUS.OPEN;
  const r2 = courseDesignRating(c);
  assert.ok(r2 > r1, `expected ${r2} > ${r1}`);
  assert.ok(r2 <= 100);

  // a hole under renovation contributes less than an open one
  h2.status = HOLE_STATUS.RENOVATION;
  const r3 = courseDesignRating(c);
  assert.ok(r3 < r2, `renovation should reduce rating: ${r3} vs ${r2}`);
});
