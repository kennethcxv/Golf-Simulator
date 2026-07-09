import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ZONE, HOLE_STATUS, GRID_W, GRID_H } from '../src/sim/constants.js';
import { validateHole, holePar, labelSections } from '../src/sim/course.js';
import { makeRng } from '../src/core/utils.js';
import { buildStartingCourse } from '../src/sim/startingCourse.js';

test('starting course has 9 valid, open holes with a sane par mix', () => {
  const course = buildStartingCourse(makeRng(42));
  assert.equal(course.holes.length, 9);
  for (const h of course.holes) {
    const v = validateHole(course, h);
    assert.equal(v.valid, true, `hole ${h.id}: ${v.reasons.join(' ')}`);
    assert.equal(h.status, HOLE_STATUS.OPEN);
    assert.ok(h.tee.x >= 0 && h.tee.x < GRID_W && h.tee.y >= 0 && h.tee.y < GRID_H);
    assert.ok(h.pin.x >= 0 && h.pin.x < GRID_W && h.pin.y >= 0 && h.pin.y < GRID_H);
  }
  const parSum = course.holes.reduce((a, h) => a + holePar(h), 0);
  assert.ok(parSum >= 33 && parSum <= 38, `par sum ${parSum}`);
  const pars = new Set(course.holes.map((h) => holePar(h)));
  assert.ok(pars.has(3) && pars.has(4) && pars.has(5), 'wants par 3s, 4s and a 5');
});

test('starting course has named greens for all nine holes', () => {
  const course = buildStartingCourse(makeRng(42));
  const sections = labelSections(course);
  for (let n = 1; n <= 9; n++) {
    assert.ok(sections.some((s) => s.name === `Green ${n}`), `missing Green ${n}`);
  }
});

test('starting course has hazards, rough, and a clubhouse', () => {
  const course = buildStartingCourse(makeRng(42));
  const sections = labelSections(course);
  const bunkers = sections.filter((s) => s.zone === ZONE.BUNKER);
  assert.ok(bunkers.length >= 4, `only ${bunkers.length} bunkers`);
  let waterCells = 0;
  let roughCells = 0;
  for (const z of course.zones) {
    if (z === ZONE.WATER) waterCells++;
    if (z === ZONE.ROUGH) roughCells++;
  }
  assert.ok(waterCells >= 15, `only ${waterCells} water cells`);
  assert.ok(roughCells > 500, `only ${roughCells} rough cells`);
  assert.ok(course.structures.some((s) => s.type === 'clubhouse'));
});

test('starting course is deterministic per seed', () => {
  const a = buildStartingCourse(makeRng(7));
  const b = buildStartingCourse(makeRng(7));
  assert.deepEqual(Array.from(a.zones), Array.from(b.zones));
  assert.deepEqual(Array.from(a.elevation), Array.from(b.elevation));
});

test('starting course has gentle but real land movement', () => {
  const course = buildStartingCourse(makeRng(42));
  let min = Infinity;
  let max = -Infinity;
  for (const e of course.elevation) {
    if (e < min) min = e;
    if (e > max) max = e;
  }
  assert.ok(max - min >= 4, `elevation range ${max - min} ft too flat`);
  assert.ok(max - min <= 40, `elevation range ${max - min} ft absurd`);
});
