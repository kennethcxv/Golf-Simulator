import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ZONE, MINUTES_PER_DAY } from '../src/sim/constants.js';
import { newGame, update } from '../src/sim/state.js';
import {
  DISEASE, sectionTurfSummary, sectionStatus, diagnoseSection, treatSection,
  aerateSection, conditionRating, greenSpeedOf, diseasePressure,
} from '../src/sim/turf.js';

function freshState(mode = 'realistic', seed = 42) {
  return newGame(mode, seed);
}

function lockWeather(state, today, droughtDays = 0) {
  state.weather.locked = true;
  state.weather.today = { windMph: 5, ...today };
  state.weather.droughtDays = droughtDays;
}

function greenSections(state) {
  return state.sections.filter((s) => s.zone === ZONE.GREEN && s.holeId != null);
}

function avgHealthOf(state, section) {
  return sectionTurfSummary(state, section).health;
}

function unlock(state, id) {
  state.progression.unlocks[id] = 0;
}

function coverZone(state, zone) {
  for (let i = 0; i < state.course.zones.length; i++) {
    if (state.course.zones[i] === zone) {
      state.course.irrigationHeads.push({ x: i % state.course.w, y: Math.floor(i / state.course.w) });
    }
  }
}

const HOT_DRY = { tempHiF: 93, tempLoF: 70, rainIn: 0, humidity: 0.35 };
const MILD_HUMID = { tempHiF: 78, tempLoF: 66, rainIn: 0, humidity: 0.85 };

test('newGame initializes turf: a scruffy but alive fixer-upper', () => {
  const st = freshState();
  assert.ok(st.turf, 'turf state exists');
  assert.ok(st.maintenance, 'maintenance policies exist');
  const greens = greenSections(st);
  assert.equal(greens.length, 9);
  const healths = greens.map((g) => avgHealthOf(st, g));
  for (const h of healths) assert.ok(h > 20 && h < 85, `green health ${h}`);
  // the fixer-upper opens with real disease on some greens
  const diseased = greens.filter((g) => sectionTurfSummary(st, g).disease);
  assert.ok(diseased.length >= 2, `expected >=2 diseased greens, got ${diseased.length}`);
  // rough starts overgrown
  const rough = st.sections.find((s) => s.zone === ZONE.ROUGH && s.size > 50);
  assert.ok(sectionTurfSummary(st, rough).heightMm > 55, 'rough starts overgrown');
});

test('turf init is deterministic per seed', () => {
  const a = freshState('realistic', 777);
  const b = freshState('realistic', 777);
  assert.deepEqual(Array.from(a.turf.health), Array.from(b.turf.health));
  assert.deepEqual(Array.from(a.turf.disType), Array.from(b.turf.disType));
});

test('BRIEF CASE: unwatered turf in drought conditions degrades', () => {
  const st = freshState();
  lockWeather(st, HOT_DRY, 6);
  // shut off all irrigation
  for (const key of Object.keys(st.maintenance.policies)) {
    st.maintenance.policies[key].irrigation = 'off';
  }
  const green = greenSections(st).find((g) => !sectionTurfSummary(st, g).disease);
  const before = sectionTurfSummary(st, green);
  update(st, 5 * MINUTES_PER_DAY);
  const after = sectionTurfSummary(st, green);
  assert.ok(after.moisture < before.moisture - 15, `moisture ${before.moisture} → ${after.moisture}`);
  assert.ok(after.health < before.health - 8, `health ${before.health} → ${after.health} should drop in drought`);
});

test('standard irrigation holds moisture and health through the same drought', () => {
  const st = freshState();
  lockWeather(st, HOT_DRY, 6);
  unlock(st, 'smartIrrigation');
  coverZone(st, ZONE.GREEN);
  st.maintenance.policies.green.irrigation = 'standard';
  const green = greenSections(st).find((g) => !sectionTurfSummary(st, g).disease);
  const before = sectionTurfSummary(st, green);
  update(st, 5 * MINUTES_PER_DAY);
  const after = sectionTurfSummary(st, green);
  assert.ok(after.health > before.health - 4, `irrigated green health ${before.health} → ${after.health}`);
  assert.ok(after.moisture > 25, `moisture stayed workable: ${after.moisture}`);
});

test('chronic overwatering in cool wet weather hurts turf', () => {
  const st = freshState();
  lockWeather(st, { tempHiF: 64, tempLoF: 50, rainIn: 0.5, humidity: 0.8 });
  st.maintenance.policies.fairway.irrigation = 'heavy';
  st.maintenance.policies.fairway.schedule = 'both';
  const fw = st.sections.find((s) => s.zone === ZONE.FAIRWAY && s.size > 20);
  const before = sectionTurfSummary(st, fw);
  update(st, 6 * MINUTES_PER_DAY);
  const after = sectionTurfSummary(st, fw);
  assert.ok(after.moisture > 80, `waterlogged: ${after.moisture}`);
  assert.ok(after.health < before.health, `health ${before.health} → ${after.health} under waterlogging`);
});

test('BRIEF CASE: correct fertilization within tolerance improves health', () => {
  const st = freshState();
  lockWeather(st, { tempHiF: 72, tempLoF: 55, rainIn: 0.15, humidity: 0.55 });
  unlock(st, 'sprayRig');
  st.maintenance.crewUnits = 1;
  const green = greenSections(st).find((g) => !sectionTurfSummary(st, g).disease);
  // run it lean first so nutrients are depleted
  st.maintenance.policies.green.fertilizer = 'none';
  update(st, 6 * MINUTES_PER_DAY);
  const starved = sectionTurfSummary(st, green);
  // now feed properly
  st.maintenance.policies.green.fertilizer = 'standard';
  update(st, 8 * MINUTES_PER_DAY);
  const fed = sectionTurfSummary(st, green);
  assert.ok(fed.nutrients > starved.nutrients + 8, `nutrients ${starved.nutrients} → ${fed.nutrients}`);
  assert.ok(fed.health >= starved.health + 3, `health ${starved.health} → ${fed.health} after proper feeding`);
});

test('mowing on schedule holds height; an overwhelmed crew skips low-priority zones', () => {
  const st = freshState();
  lockWeather(st, { tempHiF: 75, tempLoF: 58, rainIn: 0, humidity: 0.5 });
  st.maintenance.crewUnits = 1; // just you
  update(st, 1 * MINUTES_PER_DAY + 6 * 60); // through one 5am maintenance pass
  const green = greenSections(st)[0];
  const gsum = sectionTurfSummary(st, green);
  assert.ok(gsum.heightMm <= st.maintenance.policies.green.mowHeightMm + 0.6,
    `green mowed to ~${st.maintenance.policies.green.mowHeightMm}mm, got ${gsum.heightMm}`);
  const report = st.maintenance.lastReport;
  assert.ok(report, 'daily maintenance report exists');
  assert.ok(report.skipped.some((s) => s.zone === 'rough'),
    `rough should be skipped by a 1-person crew: ${JSON.stringify(report.skipped)}`);
  // rough stays overgrown as a result
  const rough = st.sections.find((s) => s.zone === ZONE.ROUGH && s.size > 50);
  assert.ok(sectionTurfSummary(st, rough).heightMm > 50, 'rough still shaggy');
});

test('a bigger crew catches up on the rough', () => {
  const st = freshState();
  lockWeather(st, { tempHiF: 75, tempLoF: 58, rainIn: 0, humidity: 0.5 });
  st.maintenance.crewUnits = 4;
  update(st, 2 * MINUTES_PER_DAY);
  const rough = st.sections.find((s) => s.zone === ZONE.ROUGH && s.size > 50);
  const sum = sectionTurfSummary(st, rough);
  assert.ok(sum.heightMm <= st.maintenance.policies.rough.mowHeightMm + 5,
    `rough mowed toward ${st.maintenance.policies.rough.mowHeightMm}mm, got ${sum.heightMm}`);
});

test('disease pressure functions respond to their real drivers', () => {
  // dollar spot: humid + mild + hungry turf
  const ds1 = diseasePressure(DISEASE.DOLLAR_SPOT, { today: MILD_HUMID, moisture: 50, nutrients: 25 });
  const ds2 = diseasePressure(DISEASE.DOLLAR_SPOT, { today: MILD_HUMID, moisture: 50, nutrients: 70 });
  const ds3 = diseasePressure(DISEASE.DOLLAR_SPOT, { today: HOT_DRY, moisture: 50, nutrients: 25 });
  assert.ok(ds1 > ds2, 'low nutrients raise dollar spot pressure');
  assert.ok(ds1 > ds3, 'humid mild weather beats hot dry air for dollar spot');

  // brown patch: hot nights + humid + waterlogged/overfed
  const bp1 = diseasePressure(DISEASE.BROWN_PATCH, { today: { tempHiF: 90, tempLoF: 74, humidity: 0.85, rainIn: 0 }, moisture: 85, nutrients: 80 });
  const bp2 = diseasePressure(DISEASE.BROWN_PATCH, { today: { tempHiF: 90, tempLoF: 74, humidity: 0.85, rainIn: 0 }, moisture: 45, nutrients: 45 });
  const bp3 = diseasePressure(DISEASE.BROWN_PATCH, { today: { tempHiF: 70, tempLoF: 48, humidity: 0.85, rainIn: 0 }, moisture: 85, nutrients: 80 });
  assert.ok(bp1 > bp2, 'waterlogged overfed turf raises brown patch pressure');
  assert.ok(bp1 > bp3, 'hot nights are the brown patch trigger');
});

test('diagnosis speaks plain language and treatment clears the disease', () => {
  const st = freshState();
  lockWeather(st, { tempHiF: 72, tempLoF: 55, rainIn: 0, humidity: 0.45 });
  const sick = greenSections(st).find((g) => sectionTurfSummary(st, g).disease);
  assert.ok(sick, 'fixer-upper has a sick green');
  const diag = diagnoseSection(st, sick);
  assert.ok(diag && diag.length > 40, 'diagnosis is a real sentence');
  assert.match(diag, /dollar spot|brown patch/i);

  const cashBefore = st.cash;
  const res = treatSection(st, sick);
  assert.equal(res.ok, true);
  assert.ok(st.cash < cashBefore, 'fungicide costs money');

  update(st, 10 * MINUTES_PER_DAY);
  const after = sectionTurfSummary(st, sick);
  assert.equal(after.disease, null, `disease cleared after treatment, sev now ${JSON.stringify(after)}`);
});

test('aeration relieves wear for a fee', () => {
  const st = freshState();
  const tee = st.sections.find((s) => s.zone === ZONE.TEE);
  const before = sectionTurfSummary(st, tee);
  const cashBefore = st.cash;
  const res = aerateSection(st, tee);
  assert.equal(res.ok, true);
  assert.ok(st.cash < cashBefore);
  const after = sectionTurfSummary(st, tee);
  assert.ok(after.wear < before.wear - 15 || after.wear === 0, `wear ${before.wear} → ${after.wear}`);
});

test('green speed reflects height and health, and condition affects play quality', () => {
  const st = freshState();
  const greens = greenSections(st);
  const healthy = greens.reduce((a, b) => (avgHealthOf(st, a) > avgHealthOf(st, b) ? a : b));
  const sick = greens.reduce((a, b) => (avgHealthOf(st, a) < avgHealthOf(st, b) ? a : b));
  const fast = greenSpeedOf(st, healthy);
  const slow = greenSpeedOf(st, sick);
  assert.ok(fast > slow, `healthy green ${fast} rolls faster than sick ${slow}`);
  assert.ok(fast >= 6 && fast <= 14, `stimp in range: ${fast}`);
});

test('overall condition rating moves with care vs neglect', () => {
  const neglect = freshState('realistic', 1010);
  const care = freshState('realistic', 1010);
  lockWeather(neglect, HOT_DRY, 4);
  lockWeather(care, HOT_DRY, 4);
  for (const key of Object.keys(neglect.maintenance.policies)) {
    neglect.maintenance.policies[key].irrigation = 'off';
    neglect.maintenance.policies[key].fertilizer = 'none';
  }
  neglect.maintenance.crewUnits = 0;
  care.maintenance.crewUnits = 3;
  unlock(care, 'smartIrrigation');
  coverZone(care, ZONE.GREEN);
  coverZone(care, ZONE.FAIRWAY);
  care.maintenance.policies.green.irrigation = 'standard';
  care.maintenance.policies.fairway.irrigation = 'light';
  const r0n = conditionRating(neglect);
  update(neglect, 7 * MINUTES_PER_DAY);
  update(care, 7 * MINUTES_PER_DAY);
  const rn = conditionRating(neglect);
  const rc = conditionRating(care);
  assert.ok(rn < r0n, `neglected condition falls: ${r0n} → ${rn}`);
  assert.ok(rc > rn + 5, `cared-for course (${rc}) clearly beats neglected (${rn})`);
});

test('status legibility: one word per section, sensible bands', () => {
  const st = freshState();
  const green = greenSections(st)[0];
  const status = sectionStatus(st, green);
  assert.ok(['Healthy', 'Stressed', 'Declining'].includes(status));
  // force perfection on one section and check it reads Healthy
  for (const i of green.cells) {
    st.turf.health[i] = 90;
    st.turf.moisture[i] = 55;
    st.turf.nutrients[i] = 60;
    st.turf.disType[i] = 0;
    st.turf.disSev[i] = 0;
  }
  assert.equal(sectionStatus(st, green), 'Healthy');
  for (const i of green.cells) st.turf.health[i] = 30;
  assert.equal(sectionStatus(st, green), 'Declining');
});

test('daily maintenance costs money (wages, water, fertilizer) through the books', () => {
  const st = freshState();
  lockWeather(st, { tempHiF: 75, tempLoF: 58, rainIn: 0, humidity: 0.5 });
  st.maintenance.crewUnits = 1;
  unlock(st, 'smartIrrigation');
  coverZone(st, ZONE.GREEN);
  st.maintenance.policies.green.irrigation = 'standard';
  update(st, MINUTES_PER_DAY + 6 * 60);
  const report = st.maintenance.lastReport;
  assert.ok(report.costs.wages > 0);
  const y = st.ledger.yesterday;
  assert.ok(y, 'books closed at midnight');
  assert.ok(y.expense.wagesDayLabor > 50, `day-labor wages billed: ${JSON.stringify(y.expense)}`);
  assert.ok(y.expense.water > 0, 'irrigation water billed');
});

test('turf state survives save/load byte-for-byte', async () => {
  const { serialize, deserialize } = await import('../src/sim/state.js');
  const st = freshState();
  update(st, 2 * MINUTES_PER_DAY);
  const back = deserialize(serialize(st));
  const a = back.turf.health;
  const b = st.turf.health;
  assert.equal(a.length, b.length);
  for (let i = 0; i < a.length; i++) {
    assert.ok(Math.abs(a[i] - b[i]) <= 0.06, `health[${i}] ${a[i]} vs ${b[i]}`);
  }
  assert.deepEqual(Array.from(back.turf.disType), Array.from(st.turf.disType));
  assert.equal(back.weather.today.tempHiF, st.weather.today.tempHiF);
  assert.deepEqual(back.maintenance.policies, st.maintenance.policies);
});
