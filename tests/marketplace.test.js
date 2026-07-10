import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HOLE_STATUS } from '../src/sim/constants.js';
import { courseDesignRating, validateHole, holeDistanceYd } from '../src/sim/course.js';
import { generateMarketplace, buildPropertyCourse, appraiseStats, dumpMarketplace } from '../src/sim/marketplace.js';

test('generateMarketplace produces a full roster of valid property records', () => {
  const props = generateMarketplace(4242);
  assert.ok(props.length >= 6 && props.length <= 10, `roster of ${props.length}`);
  const ids = new Set();
  const names = new Set();
  for (const p of props) {
    assert.ok(typeof p.id === 'string' && p.id.length > 0, 'id');
    assert.ok(typeof p.name === 'string' && p.name.length > 3, 'name');
    assert.ok(typeof p.blurb === 'string' && p.blurb.length > 20, 'flavor text');
    assert.ok(p.size === 9 || p.size === 18, `size 9 or 18, got ${p.size}`);
    assert.ok(p.design > 0 && p.design <= 100, `design ${p.design}`);
    assert.ok(p.condition > 0 && p.condition < 100, `condition ${p.condition}`);
    assert.ok(p.askingPrice > 5000, `asking price ${p.askingPrice}`);
    assert.ok(p.trueValue > 5000, `true value ${p.trueValue}`);
    assert.equal(p.askingPrice % 500, 0, 'asking prices list in clean $500 steps');
    assert.ok(Number.isInteger(p.seed), 'per-property build seed');
    ids.add(p.id);
    names.add(p.name);
  }
  assert.equal(ids.size, props.length, 'ids unique');
  assert.equal(names.size, props.length, 'names unique');
});

test('no two starting properties are identical', () => {
  const props = generateMarketplace(4242);
  const tuples = new Set(props.map((p) => `${p.size}|${Math.round(p.design)}|${Math.round(p.condition)}|${p.askingPrice}`));
  assert.equal(tuples.size, props.length, 'every property differs in its headline stats');
});

test('the roster spans genuinely different archetypes, not one scaled template', () => {
  const props = generateMarketplace(4242);
  assert.ok(props.some((p) => p.design >= 72 && p.condition <= 45), 'a good-bones / neglected-turf property exists');
  assert.ok(props.some((p) => p.condition >= 65 && p.design <= 66), 'a well-kept / modest-layout property exists');
  assert.ok(props.some((p) => p.size === 18), 'a sprawling 18-hole property exists');
  assert.ok(props.filter((p) => p.size === 9).length >= 4, 'several 9-hole properties exist');
  const designs = props.map((p) => p.design);
  const conditions = props.map((p) => p.condition);
  assert.ok(Math.max(...designs) - Math.min(...designs) >= 18, 'design ratings genuinely spread');
  assert.ok(Math.max(...conditions) - Math.min(...conditions) >= 25, 'condition ratings genuinely spread');
});

test('asking prices and true values are independently computed and do not always match', () => {
  const props = generateMarketplace(4242);
  for (const p of props) {
    assert.ok(Number.isFinite(p.askingPrice) && Number.isFinite(p.trueValue));
  }
  assert.ok(props.some((p) => p.askingPrice < p.trueValue * 0.92), 'at least one underpriced bargain rewards good appraisal');
  assert.ok(props.some((p) => p.askingPrice > p.trueValue * 1.08), 'at least one overpriced trap punishes bad appraisal');
  const differing = props.filter((p) => Math.abs(p.askingPrice - p.trueValue) > p.trueValue * 0.02);
  assert.ok(differing.length >= props.length / 2, 'ask and true value routinely diverge');
});

test('marketplace generation is deterministic per seed and varies across seeds', () => {
  assert.deepEqual(generateMarketplace(7), generateMarketplace(7));
  const a = generateMarketplace(7);
  const b = generateMarketplace(8);
  assert.notDeepEqual(a, b, 'different seeds shuffle the market');
});

test('every listed property builds a real, playable course matching its record', () => {
  const props = generateMarketplace(4242);
  const zoneChecksums = new Map();
  for (const p of props) {
    const course = buildPropertyCourse(p);
    assert.equal(course.holes.length, p.size, `${p.name}: ${course.holes.length}/${p.size} holes`);
    for (const hole of course.holes) {
      const v = validateHole(course, hole);
      assert.ok(v.valid, `${p.name} hole ${hole.id}: ${v.reasons.join(' ')}`);
      assert.equal(hole.status, HOLE_STATUS.OPEN);
    }
    const design = courseDesignRating(course);
    assert.ok(Math.abs(design - p.design) < 0.5, `${p.name}: listed design ${p.design} vs built ${design}`);
    const yd = course.holes.reduce((a, h) => a + holeDistanceYd(h), 0);
    if (p.size === 9) assert.ok(yd >= 1500 && yd <= 3800, `${p.name}: 9-hole yardage ${Math.round(yd)}`);
    else assert.ok(yd >= 3800 && yd <= 7400, `${p.name}: 18-hole yardage ${Math.round(yd)}`);
    let fairway = 0;
    for (const z of course.zones) if (z === 2) fairway++;
    assert.ok(fairway > 150 * (p.size / 9), `${p.name}: only ${fairway} fairway cells`);
    assert.ok(course.structures.length >= 1, `${p.name}: clubhouse structure exists`);
    const checksum = course.zones.reduce((a, z, i) => (a + z * (i + 1)) % 2147483647, 0);
    for (const [otherName, other] of zoneChecksums) {
      assert.notEqual(checksum, other, `${p.name} and ${otherName} share an identical layout`);
    }
    zoneChecksums.set(p.name, checksum);
  }
});

test('building a property course twice from its record is deterministic', () => {
  const props = generateMarketplace(99);
  const p = props.find((x) => x.size === 18) || props[0];
  const a = buildPropertyCourse(p);
  const b = buildPropertyCourse(p);
  assert.deepEqual(Array.from(a.zones), Array.from(b.zones));
  assert.deepEqual(a.holes.map((h) => ({ tee: h.tee, pin: h.pin })), b.holes.map((h) => ({ tee: h.tee, pin: h.pin })));
});

test('appraiseStats rewards condition, design, membership, reputation, income, and acreage', () => {
  const base = { size: 9, design: 60, condition: 50, members: 15, reputation: 35, monthlyNet: 0 };
  const v = appraiseStats(base);
  assert.ok(v > 10000, `base value ${v}`);
  assert.ok(appraiseStats({ ...base, condition: 80 }) > v, 'condition raises value');
  assert.ok(appraiseStats({ ...base, design: 85 }) > v, 'design raises value');
  assert.ok(appraiseStats({ ...base, members: 35 }) > v, 'membership raises value');
  assert.ok(appraiseStats({ ...base, reputation: 65 }) > v, 'reputation raises value');
  assert.ok(appraiseStats({ ...base, monthlyNet: 6000 }) > v, 'trailing income raises value');
  assert.ok(appraiseStats({ ...base, monthlyNet: -6000 }) < v, 'trailing losses drag value');
  assert.ok(appraiseStats({ ...base, size: 18 }) > v * 1.4, '18 holes are worth much more than 9');
  const wreck = appraiseStats({ size: 9, design: 10, condition: 10, members: 0, reputation: 0, monthlyNet: -30000 });
  assert.ok(wreck > 0, `even a wreck has land value: ${wreck}`);
  assert.ok(wreck < v, 'but far less than a working club');
});

test('dumpMarketplace renders a readable table of the whole roster', () => {
  const props = generateMarketplace(4242);
  const dump = dumpMarketplace(props);
  assert.ok(typeof dump === 'string');
  for (const p of props) {
    assert.ok(dump.includes(p.name), `dump mentions ${p.name}`);
  }
  assert.ok(dump.includes('ask'), 'dump shows asking prices');
});
