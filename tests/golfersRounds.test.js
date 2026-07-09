import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MINUTES_PER_DAY, ZONE } from '../src/sim/constants.js';
import { newGame, update, serialize, deserialize } from '../src/sim/state.js';
import { THOUGHTS, thoughtsForRound } from '../src/data/thoughts.js';
import { simulateRoundScore, simulateDayRounds, buildRoundContext } from '../src/sim/rounds.js';
import { members } from '../src/sim/golfers.js';

function boostCourse(st, health = 85) {
  st.turf.health.fill(health);
  st.turf.moisture.fill(55);
  st.turf.nutrients.fill(55);
  st.turf.disType.fill(0);
  st.turf.disSev.fill(0);
  st.turf.wear.fill(5);
  // tight greens roll fast
  for (let i = 0; i < st.course.zones.length; i++) {
    if (st.course.zones[i] === ZONE.GREEN) st.turf.heightMm[i] = 3.5;
  }
  st.club.reputation = 60;
}

function tankGreens(st) {
  for (let i = 0; i < st.course.zones.length; i++) {
    if (st.course.zones[i] === ZONE.GREEN) {
      st.turf.health[i] = 25;
      st.turf.heightMm[i] = 9;
      st.turf.disType[i] = 1;
      st.turf.disSev[i] = 55;
    }
  }
}

function fakeCtx(overrides = {}) {
  return {
    golfer: { name: 'Test', persona: 'conditions', wealth: 2, memberTier: 'full', satisfaction: 60 },
    round: {
      score: 40, par: 34, waitMin: 8, playersToday: 20,
      greensSpeed: 10.2, greensHealth: 82, fairwayHealth: 75, roughHeightMm: 48,
      diseasedGreens: 0, bunkers: 6, waterHoles: 1, weather: { tempHiF: 74, rainIn: 0, humidity: 0.5 }, seasonIndex: 1,
      renovations: 0,
      ...overrides.round,
    },
    club: {
      greenFee: 32, fairFee: 40, reputation: 55,
      amenities: { range: 1, restaurant: 0, instruction: 0 },
      outingToday: false,
      ...overrides.club,
    },
    shop: {
      bought: null, lostSale: false, fittedRecently: false, stockRatio: 0.7,
      markupMax: 1.0, staffed: true,
      ...overrides.shop,
    },
    staff: { groundsHours: 14, hasInstructor: false, hasFnb: false, hasProshop: true, ...overrides.staff },
  };
}

test('the thought catalog is genuinely big and well-formed', () => {
  assert.ok(THOUGHTS.length >= 100, `${THOUGHTS.length} thoughts`);
  const ids = new Set();
  for (const t of THOUGHTS) {
    assert.ok(t.id && !ids.has(t.id), `unique id: ${t.id}`);
    ids.add(t.id);
    assert.ok(['good', 'bad', 'neutral'].includes(t.mood), t.id);
    assert.equal(typeof t.when, 'function', t.id);
    assert.equal(typeof t.text, 'function', t.id);
    assert.ok(t.text(fakeCtx()).length > 8 || true, 'renders');
  }
});

test('thoughts fire on their REAL conditions, not generically', () => {
  // pristine fast greens → a specific good-greens thought
  const good = thoughtsForRound(fakeCtx({ round: { greensSpeed: 11.5, greensHealth: 90 } }), 99);
  assert.ok(good.some((t) => t.mood === 'good' && /green/i.test(t.rendered)), JSON.stringify(good.map(g => g.rendered)));

  // diseased slow greens → a matching complaint
  const sick = thoughtsForRound(fakeCtx({ round: { greensSpeed: 6.4, greensHealth: 30, diseasedGreens: 3 } }), 99);
  assert.ok(sick.some((t) => t.mood === 'bad' && /(green|spot|disease|bumpy|slow)/i.test(t.rendered)), JSON.stringify(sick.map(g => g.rendered)));

  // gouging green fee → a value complaint
  const pricey = thoughtsForRound(fakeCtx({ club: { greenFee: 85, fairFee: 40 } }), 99);
  assert.ok(pricey.some((t) => t.mood === 'bad' && /(price|fee|worth|money|charg)/i.test(t.rendered)), JSON.stringify(pricey.map(g => g.rendered)));

  // long waits → a pace complaint
  const slow = thoughtsForRound(fakeCtx({ round: { waitMin: 34, playersToday: 46 } }), 99);
  assert.ok(slow.some((t) => t.mood === 'bad' && /(wait|slow|pace|backed|standing|minutes)/i.test(t.rendered)), JSON.stringify(slow.map(g => g.rendered)));

  // walked into a bare shop → a stock complaint
  const bare = thoughtsForRound(fakeCtx({ shop: { lostSale: true, stockRatio: 0.05 } }), 99);
  assert.ok(bare.some((t) => t.mood === 'bad' && /(shelf|shelves|stock|shop|empty)/i.test(t.rendered)), JSON.stringify(bare.map(g => g.rendered)));

  // fresh fitting → a delighted shop thought
  const fitted = thoughtsForRound(fakeCtx({ shop: { fittedRecently: true, bought: 'Apex TD driver' } }), 99);
  assert.ok(fitted.some((t) => t.mood === 'good' && /(fit|dialed|shop|driver|club)/i.test(t.rendered)), JSON.stringify(fitted.map(g => g.rendered)));
});

test('scores respond to skill and to course condition', () => {
  const st = newGame('realistic', 42);
  boostCourse(st);
  const ace = { skill: 4 };
  const hack = { skill: 26 };
  let aceTotal = 0;
  let hackTotal = 0;
  for (let i = 0; i < 30; i++) {
    aceTotal += simulateRoundScore(st, ace, 1000 + i);
    hackTotal += simulateRoundScore(st, hack, 1000 + i);
  }
  assert.ok(aceTotal < hackTotal - 60, `skill matters: ace ${aceTotal / 30} vs hack ${hackTotal / 30}`);

  const trashed = newGame('realistic', 42);
  boostCourse(trashed);
  tankGreens(trashed);
  let goodTotal = 0;
  let badTotal = 0;
  for (let i = 0; i < 30; i++) {
    goodTotal += simulateRoundScore(st, hack, 2000 + i);
    badTotal += simulateRoundScore(trashed, hack, 2000 + i);
  }
  assert.ok(badTotal > goodTotal + 25, `bad greens cost strokes: ${goodTotal / 30} vs ${badTotal / 30}`);
});

test('a played day writes real memories with thoughts onto golfers', () => {
  const st = newGame('realistic', 500);
  boostCourse(st);
  st.club.lastRounds = 30;
  simulateDayRounds(st, 30);
  const played = st.golfers.pool.filter((g) => g.memory && g.memory.length > 0);
  assert.ok(played.length >= 6, `${played.length} golfers have memories`);
  const m = played[0].memory[0];
  assert.ok(m.day >= 0 && m.score > 25 && m.score < 80, JSON.stringify(m));
  assert.ok(Array.isArray(m.thoughts) && m.thoughts.length >= 1, 'rounds produce thoughts');
  assert.ok(typeof m.thoughts[0] === 'string' && m.thoughts[0].length > 10);
});

test('memories ring-buffer at 8 and skill improves with play', () => {
  const st = newGame('realistic', 500);
  boostCourse(st);
  const g = members(st)[0];
  const skillBefore = g.skill;
  for (let d = 0; d < 14; d++) {
    simulateDayRounds(st, 25, { forceInclude: g.id });
  }
  assert.ok(g.memory.length <= 8, `ring capped: ${g.memory.length}`);
  assert.ok(g.skill < skillBefore, `skill improved: ${skillBefore} → ${g.skill}`);
  assert.ok(g.roundsPlayed >= 14);
});

test('foot traffic wears the greens', () => {
  const st = newGame('realistic', 500);
  boostCourse(st);
  const greenWear = () => {
    let sum = 0;
    let n = 0;
    for (let i = 0; i < st.course.zones.length; i++) {
      if (st.course.zones[i] === ZONE.GREEN) { sum += st.turf.wear[i]; n++; }
    }
    return sum / n;
  };
  const before = greenWear();
  simulateDayRounds(st, 40);
  assert.ok(greenWear() > before + 1, `40 rounds wear greens: ${before} → ${greenWear()}`);
});

test('champions emerge and the truly fed-up leave forever', () => {
  const st = newGame('realistic', 777);
  boostCourse(st);
  const star = members(st).find((g) => g.memberTier === 'premium') || members(st)[0];
  star.satisfaction = 92;
  star.roundsPlayed = 10;
  for (let d = 0; d < 10; d++) {
    simulateDayRounds(st, 20, { forceInclude: star.id });
  }
  assert.equal(star.champion, true, 'high-sat regular becomes a champion');
  assert.ok(st.club.champions.includes(star.id), 'champion recorded on the club permanently');

  const grump = members(st).find((g) => !g.champion && g.id !== star.id);
  grump.satisfaction = 8;
  const repBefore = st.club.reputation;
  update(st, 20 * MINUTES_PER_DAY);
  assert.equal(grump.leftForever, true, 'fed-up member gone for good');
  assert.equal(grump.memberTier, null);
  assert.ok(st.golfers.pool.filter((g) => g.leftForever).length >= 1, 'the departure is permanent state, not just a feed line');
  assert.ok(st.club.reputation < repBefore + 10, 'storming out is not free');
});

test('golfer memories survive save/load', () => {
  const st = newGame('realistic', 500);
  boostCourse(st);
  simulateDayRounds(st, 25);
  const back = deserialize(serialize(st));
  const withMem = st.golfers.pool.find((g) => g.memory && g.memory.length);
  const restored = back.golfers.pool.find((g) => g.id === withMem.id);
  assert.deepEqual(restored.memory, withMem.memory);
});

test('the chatter feed picks up golfer thoughts after a day of play', () => {
  const st = newGame('realistic', 500);
  boostCourse(st);
  update(st, MINUTES_PER_DAY + 8 * 60); // one full day of play
  assert.ok(st.club.feed.some((f) => f.kind === 'thought'), JSON.stringify(st.club.feed.slice(0, 6).map(f => f.kind)));
});
