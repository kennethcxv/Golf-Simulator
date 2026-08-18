// "I DO A PURCHASE FOR 1 PERSON AND FOR SOME REASON EVERYONE IN LINE LEAVES."
//
// The old fuse was one clock — seconds since this customer's route turned for
// the counter — with no credit for anything. Five shoppers who arrive together
// therefore expire together, and the ONLY thing holding them is their queue
// index: positions 0 and 1 are unconditional, everyone behind is not. Complete
// a sale, the head is spliced out, every index drops by one, and the customer
// newly exposed at position 2 is carrying a fuse that burned through minutes
// ago. They walk. The array shifts again. The next walks.
//
// That clock runs at decisionDt — four times the wall — so PATIENCE_FULL's ten
// authored minutes are two and a half real ones. About one unhurried
// transaction. The player is punished precisely for doing the job.
//
// These tests replay that line rather than asserting a threshold: a queue is
// stepped frame by frame, a sale completes, and the question asked is the
// owner's one — how many people are left standing there afterwards.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  stepPreServiceWait, queueGiveUp, QUEUE_TOTAL_WAIT_MULTIPLIER,
  QUEUE_NEVER_ABANDON_DEPTH,
} from '../src/sim/customerSimulation.js';

const PATIENCE_FULL = 600; // as authored in clubhouse.js
const DECISION_RATE = 4; // decisionDt = dt * simSpeed, and simSpeed is 4
const FRAME = 1 / 60;

// A line of `n` people, all of whom joined at the same moment, stepped in real
// seconds. `serveAfterSec` is when the player FINISHES the head's sale; the
// till is modelled as working for the `serviceSec` before each completion,
// because that is what a transaction is — not an instant.
function runLine(n, {
  seconds, serveAfterSec, servicePeriodSec = null, serviceSec = 30,
}) {
  const line = Array.from({ length: n }, (_, i) => ({
    id: i, clocks: { wait: 0, total: 0, index: null }, gone: false, goneAt: null,
  }));
  let nextServeAt = serveAfterSec;
  for (let t = 0; t < seconds; t += FRAME) {
    const waiting = line.filter((p) => !p.gone);
    if (nextServeAt !== null && t >= nextServeAt && waiting.length) {
      waiting[0].gone = true; // served and away — this is a SALE, not a walk-out
      waiting[0].served = true;
      waiting[0].goneAt = t;
      nextServeAt = servicePeriodSec === null ? null : t + servicePeriodSec;
    }
    const serving = nextServeAt !== null && t >= nextServeAt - serviceSec;
    const live = line.filter((p) => !p.gone);
    for (const [index, person] of live.entries()) {
      person.clocks = stepPreServiceWait(person.clocks, FRAME * DECISION_RATE, index, {
        serving: serving && index > 0,
      });
      if (queueGiveUp(person.clocks, index, PATIENCE_FULL)) {
        person.gone = true;
        person.walkedOut = true;
        person.goneAt = t;
      }
    }
  }
  return {
    line,
    walkedOut: line.filter((p) => p.walkedOut),
    served: line.filter((p) => p.served),
    stillWaiting: line.filter((p) => !p.gone),
  };
}

// THE NEGATIVE CONTROL, AND IT IS THE BUG REPORT.
//
// The same five people, the same single sale, stepped by the rule this commit
// replaced: one clock, no credit for the line moving, no hold while the till is
// working. If this ever stops emptying the shop, the harness has drifted and
// every test below it is measuring nothing.
function runLineOldRule(n, { seconds, serveAfterSec }) {
  const line = Array.from({ length: n }, (_, i) => ({ id: i, wait: 0, gone: false }));
  let served = false;
  for (let t = 0; t < seconds; t += FRAME) {
    const waiting = line.filter((p) => !p.gone);
    if (!served && t >= serveAfterSec && waiting.length) {
      waiting[0].gone = true;
      waiting[0].served = true;
      served = true;
    }
    const live = line.filter((p) => !p.gone);
    for (const [index, person] of live.entries()) {
      person.wait += FRAME * DECISION_RATE;
      if (person.wait > PATIENCE_FULL && index >= QUEUE_NEVER_ABANDON_DEPTH) {
        person.gone = true;
        person.walkedOut = true;
        person.goneAt = t;
      }
    }
  }
  return { walkedOut: line.filter((p) => p.walkedOut), stillWaiting: line.filter((p) => !p.gone) };
}

test('CONTROL: under the old rule, one sale did empty the line', () => {
  const out = runLineOldRule(5, { seconds: 200, serveAfterSec: 150 });
  assert.equal(out.walkedOut.length, 3,
    'the control has to reproduce the report, or nothing below it means anything');
  assert.equal(out.stillWaiting.length, 1, 'one person left in a shop that had five');
  // and they go in a cascade, each one exposed by the shift the last one caused
  const times = out.walkedOut.map((p) => +p.goneAt.toFixed(1));
  assert.ok(times[times.length - 1] - times[0] < 1,
    `the whole line went inside a second: ${JSON.stringify(times)}`);
});

test('the fuse is 2.5 real minutes, not ten — this is why it bites in one sale', () => {
  let clocks = { wait: 0, total: 0, index: null };
  let seconds = 0;
  while (!queueGiveUp(clocks, 4, PATIENCE_FULL) && seconds < 1200) {
    clocks = stepPreServiceWait(clocks, FRAME * DECISION_RATE, 4); // never advances
    seconds += FRAME;
  }
  assert.ok(seconds > 140 && seconds < 160,
    `a stalled queuer gives up after ${seconds.toFixed(0)} real seconds`);
});

test('ONE SALE MUST NOT EMPTY THE SHOP', () => {
  // Five people, all arrived together, one sale completed at 150 s — the moment
  // the old single clock expires for everybody at once.
  const out = runLine(5, { seconds: 200, serveAfterSec: 150 });
  assert.equal(out.served.length, 1, 'exactly one purchase was completed');
  assert.deepEqual(out.walkedOut.map((p) => p.id), [],
    `${out.walkedOut.length} customers walked out on the back of one sale`);
  assert.equal(out.stillWaiting.length, 4, 'the other four are still in the line');
});

test('a shop that serves steadily keeps its queue', () => {
  const out = runLine(6, { seconds: 700, serveAfterSec: 100, servicePeriodSec: 100 });
  assert.equal(out.walkedOut.length, 0);
  assert.equal(out.served.length, 6, 'everyone got served');
});

test('a shop that serves NOBODY still loses the line — the pressure survives', () => {
  // nobody is ever served, so the till is never working either
  const out = runLine(5, { seconds: 260, serveAfterSec: null, serviceSec: 0 });
  // positions 0 and 1 are unconditional, so exactly the rest go
  assert.equal(out.walkedOut.length, 5 - QUEUE_NEVER_ABANDON_DEPTH);
  assert.equal(out.stillWaiting.length, QUEUE_NEVER_ABANDON_DEPTH);
  assert.ok(out.walkedOut.every((p) => p.goneAt > 140),
    'and they go on the authored fuse, not instantly');
});

test('a line that crawls for ever still drains, on the long fuse', () => {
  // one sale every 140 s: each advance resets `wait`, so only `total` can end it
  const out = runLine(6, { seconds: 1000, serveAfterSec: 140, servicePeriodSec: 140 });
  assert.ok(out.walkedOut.length > 0,
    '"the line is technically moving" is not the same as patience');
  assert.ok(out.walkedOut.every((p) => p.clocks.total > PATIENCE_FULL * QUEUE_TOTAL_WAIT_MULTIPLIER),
    'and only on the total-time fuse, never the advance one');
});

test('an advance resets the wait clock and only the wait clock', () => {
  let clocks = { wait: 0, total: 0, index: 3 };
  for (let i = 0; i < 600; i += 1) clocks = stepPreServiceWait(clocks, 0.5, 3);
  assert.ok(clocks.wait > 200 && clocks.total > 200);
  const before = clocks.total;
  clocks = stepPreServiceWait(clocks, 0.5, 2); // the line moved
  assert.equal(clocks.wait, 0, 'the line moved, so the give-up clock goes back');
  assert.ok(clocks.total > before, 'but the time they have actually stood there does not');
  assert.equal(clocks.advanced, true);
});

test('falling back in the line is not punished, and is not credited either', () => {
  let clocks = { wait: 90, total: 90, index: 2 };
  clocks = stepPreServiceWait(clocks, 1, 4); // somebody was inserted ahead
  assert.equal(clocks.advanced, false);
  assert.equal(clocks.wait, 91, 'no reset — the line did not move for them');
  assert.equal(clocks.index, 4);
});

test('the first frame in the line never counts as an advance', () => {
  const first = stepPreServiceWait(undefined, 1, 0);
  assert.equal(first.advanced, false);
  assert.equal(first.wait, 1);
  assert.equal(first.index, 0);
});

test('someone not in the line at all still runs a fuse', () => {
  // walking to the counter, not yet queued: index -1. They must still be able
  // to give up, or an unreachable counter pins them for ever.
  let clocks = { wait: 0, total: 0, index: null };
  for (let i = 0; i < 700; i += 1) clocks = stepPreServiceWait(clocks, 1, -1);
  assert.equal(clocks.index, null);
  assert.equal(queueGiveUp(clocks, -1, PATIENCE_FULL), true);
});

test('bad input cannot manufacture a give-up', () => {
  for (const bad of [null, undefined, {}, { wait: NaN, total: NaN }]) {
    assert.equal(queueGiveUp(bad, 4, PATIENCE_FULL), false);
  }
  assert.equal(queueGiveUp({ wait: 1e9, total: 1e9 }, 4, 0), false, 'no fuse, no give-up');
  const stepped = stepPreServiceWait({ wait: 5, total: 5, index: 2 }, NaN, 1);
  assert.equal(stepped.wait, 0, 'a NaN dt must not poison the clock');
  assert.equal(stepped.total, 5);
});
