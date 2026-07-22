// A review is a reading of a day that actually happened.
//
// The brief is blunt: "Do not generate random reviews disconnected from simulation data" and
// "Reviews must clearly explain cause". So every clause a reviewer can utter is bound to a factor
// with a predicate over real state, exactly the way data/thoughts.js already binds golfer thoughts
// — no praise for a spotless shop while the shop is filthy, and no complaint about the queue on a
// day nobody queued.
//
// These tests are mostly about what a review is NOT allowed to say.

import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame } from '../src/sim/state.js';
import { shopCondition } from '../src/sim/shop.js';
import {
  REVIEW_FACTORS, readFactors, reviewFor, reviewForCompletedRound, postReview, reviewSummary, explainVisitors,
} from '../src/sim/reviews.js';

const visit = (over = {}) => ({ waitedSec: 0, queueLen: 0, bought: true, foundWhatTheyWanted: true, played: true, ...over });

test('every factor reads real state and stays in range', () => {
  const st = newGame('relaxed', 8);
  const fs = readFactors(st, visit({ waitedSec: 30, queueLen: 2 }));
  assert.ok(fs.length >= 6, `a real experience has several parts (${fs.length})`);
  for (const f of fs) {
    assert.ok(f.score >= 0 && f.score <= 1, `${f.id} score in range (${f.score})`);
    assert.ok(f.label && f.label.length > 2, `${f.id} has a human name`);
  }
  const ids = new Set(fs.map((f) => f.id));
  for (const want of ['shopClean', 'exterior', 'courseCondition', 'stock', 'prices', 'coursePrice', 'waitTime', 'queue']) {
    assert.ok(ids.has(want), `the brief's factor "${want}" is read`);
  }
});

test('a factor that did not happen to you is not scored at all', () => {
  const st = newGame('relaxed', 8);
  // walked straight to the till, and never set foot on the course
  const ids = readFactors(st, visit({ waitedSec: 0, queueLen: 0, played: false })).map((f) => f.id);
  assert.ok(!ids.includes('waitTime'), 'no wait, no opinion about waiting');
  assert.ok(!ids.includes('queue'), 'no queue, no opinion about the queue');
  assert.ok(!ids.includes('courseCondition'), 'did not play, cannot rate the greens');
  assert.ok(ids.includes('shopClean'), 'but they certainly saw the shop');
});

test('a filthy shop is never praised for being clean', () => {
  const st = newGame('relaxed', 8); // a fixer-upper: the shop starts filthy
  assert.ok(shopCondition(st) < 40, `the shop really is filthy (${shopCondition(st)})`);
  for (let i = 0; i < 40; i++) {
    const r = reviewFor(st, visit(), i);
    assert.ok(!/clean|spotless|smart|immaculate/i.test(r.text) || /not |n't /i.test(r.text),
      `no false praise: "${r.text}"`);
  }
});

test('a spotless, well-stocked shop is never called grimy', () => {
  const st = newGame('relaxed', 8);
  st.shop.reno.grime = st.shop.reno.grime.map(() => 0);
  st.shop.reno.windows = st.shop.reno.windows.map(() => 0);
  for (const id of Object.keys(st.shop.inventory)) st.shop.inventory[id].shelf = 8;
  for (let i = 0; i < 40; i++) {
    const r = reviewFor(st, visit(), i);
    assert.ok(!/pro shop was grimy|bare|could not find/i.test(r.text), `no invented filth: "${r.text}"`);
  }
  // ...but the exterior is STILL filthy, and they are quite right to say so
  const texts = Array.from({ length: 40 }, (_, i) => reviewFor(st, visit(), i).text);
  assert.ok(texts.some((t) => /outside|siding|weeds/i.test(t)),
    'the yard has not been touched, and someone notices');
});

test('nobody complains about a queue they never stood in', () => {
  const st = newGame('relaxed', 8);
  for (let i = 0; i < 40; i++) {
    const r = reviewFor(st, visit({ waitedSec: 0, queueLen: 0 }), i);
    assert.ok(!/wait|queue|line|took too long/i.test(r.text), `no invented queue: "${r.text}"`);
  }
});

test('a long wait at the register does get mentioned', () => {
  const st = newGame('relaxed', 8);
  const texts = [];
  for (let i = 0; i < 25; i++) texts.push(reviewFor(st, visit({ waitedSec: 240, queueLen: 4 }), i).text);
  assert.ok(texts.some((t) => /wait|queue|line|long/i.test(t)),
    `somebody says so: ${texts.slice(0, 3).join(' | ')}`);
});

test('a review names its cause — praise, complaint, or both', () => {
  const st = newGame('relaxed', 8);
  for (let i = 0; i < 20; i++) {
    const r = reviewFor(st, visit(), i);
    assert.ok(r.text.length > 12, `it says something: "${r.text}"`);
    assert.ok(r.stars >= 1 && r.stars <= 5, `stars in range (${r.stars})`);
    assert.ok(r.factors.length > 0, 'and it can show its working');
    // the text must be traceable to a factor it actually read
    const cited = r.cited.map((c) => c.id);
    assert.ok(cited.length > 0, 'at least one factor is cited');
    for (const id of cited) {
      assert.ok(REVIEW_FACTORS.some((f) => f.id === id), `${id} is a real factor`);
    }
  }
});

test('fixing the thing people complained about raises the score', () => {
  const st = newGame('relaxed', 8);
  const before = [];
  for (let i = 0; i < 30; i++) before.push(reviewFor(st, visit(), i).stars);

  // do the work: clean the shop, stock the shelves
  st.shop.reno.grime = st.shop.reno.grime.map(() => 0);
  st.shop.reno.windows = st.shop.reno.windows.map(() => 0);
  for (const id of Object.keys(st.shop.inventory)) st.shop.inventory[id].shelf = 8;

  const after = [];
  for (let i = 0; i < 30; i++) after.push(reviewFor(st, visit(), i).stars);
  const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  assert.ok(avg(after) > avg(before) + 0.4,
    `the work shows: ${avg(before).toFixed(2)} -> ${avg(after).toFixed(2)} stars`);
});

test('the same day and the same reviewer read the same — reviews are not dice', () => {
  const st = newGame('relaxed', 8);
  const a = reviewFor(st, visit(), 7);
  const b = reviewFor(st, visit(), 7);
  assert.equal(a.text, b.text);
  assert.equal(a.stars, b.stars);
});

test('reviews accumulate, and the summary explains what is dragging you down', () => {
  const st = newGame('relaxed', 8);
  for (let i = 0; i < 12; i++) postReview(st, reviewFor(st, visit(), i));
  const s = reviewSummary(st);
  assert.equal(s.count, 12);
  assert.ok(s.average >= 1 && s.average <= 5);
  assert.ok(s.worst, 'it names the biggest problem');
  assert.ok(s.worst.label && s.worst.score < 0.5, `the worst factor is genuinely bad: ${JSON.stringify(s.worst)}`);
  assert.ok(s.byFactor.length >= 6, 'and shows every factor, for the trends panel');
});

test('reviews are capped so a long game does not grow without bound', () => {
  const st = newGame('relaxed', 8);
  for (let i = 0; i < 300; i++) postReview(st, reviewFor(st, visit(), i));
  assert.ok(st.club.reviews.length <= 60, `kept bounded (${st.club.reviews.length})`);
});

test('analytics says WHY the visitors moved, not just that they did', () => {
  const st = newGame('relaxed', 8);
  const e = explainVisitors(st, { today: 18, yesterday: 30, rainedToday: true });
  assert.ok(/%/.test(e), `it quantifies: "${e}"`);
  assert.ok(/rain/i.test(e), `it names the cause: "${e}"`);

  const flat = explainVisitors(st, { today: 30, yesterday: 30, rainedToday: false });
  assert.ok(flat.length > 0, 'a steady day still gets a sentence');
});

test('completed-round reviews only cite conditions that party actually experienced', () => {
  const state = newGame('relaxed', 8801);
  const round = {
    id: 'round-truth', golferId: 8, golferName: 'Truth Tester', score: 44, par: 36,
    durationMinutes: 155, waitingMinutes: 0, conditionRating: 82,
    practiceKind: 'putting', cartRequested: true, transport: 'walk',
    cartCondition: null, cartUnavailable: true, marshalVisits: 0,
    checkInMinutes: 2, startDelayMinutes: 1,
    greenQuality: 91, bunkerQuality: 76, roughDifficulty: 25,
    designRating: 86, sceneryRating: 84, valueRating: 80, serviceRating: 88,
  };
  const review = reviewForCompletedRound(state, round, 4);
  const ids = new Set(review.factors.map((factor) => factor.id));
  assert.ok(ids.has('roundCartAvailability'));
  assert.ok(!ids.has('roundCart'), 'an unavailable cart cannot also receive a condition score');
  assert.ok(!ids.has('roundWait'), 'zero waiting produces no wait opinion');
  for (const id of ['roundGreens', 'roundBunkers', 'roundRough', 'roundDesign', 'roundScenery', 'roundValue', 'roundService']) {
    assert.ok(ids.has(id), `${id} is based on supplied round evidence`);
  }
  assert.ok(review.cited.every((factor) => ids.has(factor.id)));
});

test('poor real pace and turf cannot produce praise for either factor', () => {
  const state = newGame('relaxed', 8802);
  const round = {
    id: 'round-poor', golferId: 9, golferName: 'Delayed Player', score: 55, par: 36,
    durationMinutes: 240, waitingMinutes: 32, conditionRating: 28,
    cartRequested: false, transport: 'walk', marshalVisits: 0,
    checkInMinutes: 11, startDelayMinutes: 24,
    greenQuality: 22, bunkerQuality: 30, roughDifficulty: 94,
    designRating: 45, sceneryRating: 38, valueRating: 26, serviceRating: 30,
  };
  for (let seed = 0; seed < 30; seed++) {
    const review = reviewForCompletedRound(state, round, seed);
    assert.ok(!/smooth|on time|moved along|fair for the day|cared for/i.test(review.text), review.text);
  }
});
