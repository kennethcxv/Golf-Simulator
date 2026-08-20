// A BOOT MUST NOT COST ONE SECOND PER YIELD BECAUSE THE COMPOSITOR IS ASLEEP.
//
// prewarm() advances by awaiting a tick between phases. When that tick is a
// bare requestAnimationFrame and the window is occluded (or the display has
// gone to sleep), Chromium produces frames at about 1 Hz -- measured, on one
// stamped boot: rAF median 1003.7 ms while setTimeout ran at 4.0 ms and a
// MessageChannel at 0.0. The work did not grow; the yields did.
//
// The negative control is the first test: a tick built on rAF ALONE, against a
// compositor that never produces a frame, must never resolve. That is the
// unfixed shape, and it is what makes the second test mean something.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createVeilTick } from '../src/core/veilFrame.js';

// A compositor that has stopped. Nothing else about the page is broken: timers
// still run, which is precisely the condition the probe measured.
const deadCompositor = () => ({
  raf: () => 1,
  cancelRaf: () => {},
});

const settledWithin = async (promise, ms) => {
  const marker = Symbol('pending');
  const result = await Promise.race([
    promise,
    new Promise((r) => { setTimeout(() => r(marker), ms); }),
  ]);
  return result === marker ? null : result;
};

test('CONTROL: a bare requestAnimationFrame yield never resolves on a stopped compositor', async () => {
  const bareRafTick = () => new Promise((resolve) => { deadCompositor().raf(resolve); });
  const outcome = await settledWithin(bareRafTick(), 120);
  assert.equal(
    outcome,
    null,
    'the control must hang — if a bare rAF yield resolves here, this file is not testing the defect',
  );
});

test('the veil tick falls through to the timer when no frame ever arrives', async () => {
  const tick = createVeilTick({ ...deadCompositor(), probeMs: 8, fastMs: 2 });
  const outcome = await settledWithin(tick(), 400);
  assert.equal(outcome, 'timer', 'the yield must complete on the timer rather than wait for a frame');
});

test('it waits patiently at first, then gives up quickly — and a frame clears the verdict', async () => {
  // The whole point of the two-speed design: a healthy compositor is never
  // second-guessed, and a genuinely absent one is only diagnosed after
  // `patience` consecutive misses.
  const waits = [];
  const tick = createVeilTick({
    raf: () => 1,
    cancelRaf: () => {},
    setTimer: (cb, ms) => { waits.push(ms); return setTimeout(cb, 0); },
    clearTimer: (id) => clearTimeout(id),
    probeMs: 250,
    fastMs: 16,
    patience: 3,
  });
  await tick(); await tick(); await tick(); await tick(); await tick();
  assert.deepEqual(
    waits,
    [250, 250, 250, 16, 16],
    'the first three yields wait the full probe before the compositor is written off',
  );

  const mixed = [];
  let frameNext = false;
  const recovering = createVeilTick({
    raf: (cb) => { if (frameNext) setTimeout(cb, 0); return 2; },
    cancelRaf: () => {},
    setTimer: (cb, ms) => { mixed.push(ms); return setTimeout(cb, frameNext ? 50 : 0); },
    clearTimer: (id) => clearTimeout(id),
    probeMs: 250,
    fastMs: 16,
    patience: 3,
  });
  await recovering(); await recovering(); await recovering(); await recovering();
  frameNext = true;
  assert.equal(await recovering(), 'frame', 'a real frame still wins once the compositor comes back');
  frameNext = false;
  await recovering();
  assert.equal(
    mixed[mixed.length - 1],
    250,
    'and having seen a frame, the next yield is patient again rather than assuming the worst',
  );
});

test('a healthy compositor still wins, so a normal boot is unchanged', async () => {
  // The frame arrives promptly, as it does on the owner's 240 Hz panel; the
  // timer is set far enough out that a real frame must be what resolved it.
  const tick = createVeilTick({
    raf: (cb) => { setTimeout(cb, 1); return 7; },
    cancelRaf: () => {},
    probeMs: 5000,
  });
  const outcome = await settledWithin(tick(), 400);
  assert.equal(outcome, 'frame', 'a real frame must still drive the boot when the compositor is producing them');
});

test('the losing side is released, so yields do not accumulate callbacks', async () => {
  let cancelledFrames = 0;
  let clearedTimers = 0;
  const starved = createVeilTick({
    raf: () => 11,
    cancelRaf: () => { cancelledFrames += 1; },
    clearTimer: () => { clearedTimers += 1; },
    probeMs: 4,
  });
  await starved();
  assert.equal(cancelledFrames, 1, 'the pending frame request is cancelled when the timer wins');

  const healthy = createVeilTick({
    raf: (cb) => { setTimeout(cb, 1); return 12; },
    cancelRaf: () => { cancelledFrames += 1; },
    clearTimer: () => { clearedTimers += 1; },
    probeMs: 5000,
  });
  await healthy();
  assert.equal(clearedTimers, 1, 'the fallback timer is cleared when the frame wins');
});
