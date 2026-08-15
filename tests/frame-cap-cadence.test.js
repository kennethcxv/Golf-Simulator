// A1 (Goal 23) — the frame cap must PACE, not just average.
//
// The control in every test here is the SHIPPED PREDECESSOR: the wall-clock
// gate `ts - lastRender < interval - 1.2`, run over the identical vsync stream.
// That gate is what produced 97.1 fps at 0.2% on-cadence on a 181.8 Hz panel,
// and reproducing its sawtooth here is what makes the new numbers mean
// something. A test that only shows the new code passing cannot tell a fix
// from a coincidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFrameCap } from '../src/core/frameCap.js';

// A display presents on a fixed grid. Nothing can arrive between vsyncs.
function vsyncStream(hz, seconds) {
  const step = 1000 / hz;
  const out = [];
  for (let t = 0; t < seconds * 1000; t += step) out.push(t);
  return out;
}

// The gate this replaces, verbatim in behaviour (src/main.js before Goal 23).
function legacyGate(capFps) {
  const interval = capFps > 0 ? 1000 / capFps : 0;
  let last = 0;
  return (ts) => {
    if (interval <= 0) return true;
    if (ts - last < interval - 1.2) return false;
    last = Math.max(last + interval, ts - interval);
    return true;
  };
}

// `skip` drops the warm-up. The cap draws every tick until it has measured the
// panel — deliberately, so it can never wedge a display it has not seen yet —
// and steady state is what the player spends the session in.
function run(decide, ticks, skip = 24) {
  const all = [];
  for (const ts of ticks) if (decide(ts)) all.push(ts);
  const drawn = all.slice(skip);
  const gaps = [];
  for (let i = 1; i < drawn.length; i += 1) gaps.push(drawn[i] - drawn[i - 1]);
  const seconds = (drawn[drawn.length - 1] - drawn[0]) / 1000;
  const sorted = gaps.slice().sort((a, b) => a - b);
  return {
    fps: +(drawn.length / seconds).toFixed(1),
    gaps,
    distinctGaps: new Set(gaps.map((g) => +g.toFixed(3))).size,
    medianGap: sorted[sorted.length >> 1],
    onCadencePct: (target) => +(100 * gaps.filter((g) => Math.abs(g - target) <= target * 0.2).length / gaps.length).toFixed(1),
  };
}

const newCap = (capFps) => {
  const fc = createFrameCap();
  fc.setCap(capFps);
  return (ts) => fc.shouldRender(ts);
};

test('120 on a 181.8 Hz panel: the old gate sawtooths, the new one is dead even', () => {
  const ticks = vsyncStream(181.8, 8);

  // CONTROL — the shipped behaviour, which is what the owner has been playing.
  const old = run(legacyGate(120), ticks);
  assert.ok(old.onCadencePct(1000 / 120) < 10,
    `control: the old gate should MISS its own cadence, got ${old.onCadencePct(1000 / 120)}%`);
  assert.ok(old.distinctGaps > 1,
    'control: the old gate should produce more than one frame length (the sawtooth)');

  // 120 is not reachable on this panel. 90.9 is, and it is reachable EXACTLY.
  const fresh = run(newCap(120), ticks);
  assert.equal(fresh.distinctGaps, 1, `every frame must be the same length, saw ${fresh.distinctGaps}`);
  assert.ok(Math.abs(fresh.fps - 90.9) < 1.5, `expected ~90.9 fps, got ${fresh.fps}`);
  assert.equal(fresh.onCadencePct(fresh.medianGap), 100);
});

test('60 on a 181.8 Hz panel is exactly every third vsync', () => {
  const ticks = vsyncStream(181.8, 8);
  const r = run(newCap(60), ticks);
  assert.equal(r.distinctGaps, 1, 'a cap that divides the refresh must be perfectly even');
  assert.ok(Math.abs(r.fps - 60.6) < 1.0, `expected ~60.6 fps, got ${r.fps}`);
});

test('60 on a 60 Hz panel draws every vsync and skips nothing', () => {
  const ticks = vsyncStream(60, 6);
  const r = run(newCap(60), ticks);
  assert.ok(Math.abs(r.fps - 60) < 1.0, `expected ~60 fps, got ${r.fps}`);
  assert.equal(r.distinctGaps, 1);
});

test('a cap above what the panel can present hands back every frame, not a stutter', () => {
  // 144 on 181.8 Hz: round(6.94 / 5.5) = 1. Asking for more than the panel can
  // show and being given 90.9 would be a bigger lie than being given 181.8.
  const ticks = vsyncStream(181.8, 6);
  const r = run(newCap(144), ticks);
  assert.ok(Math.abs(r.fps - 181.8) < 2, `expected the panel rate, got ${r.fps}`);
  assert.equal(r.distinctGaps, 1);
});

test('uncapped is every vsync', () => {
  const ticks = vsyncStream(181.8, 4);
  const r = run(newCap(0), ticks);
  assert.ok(Math.abs(r.fps - 181.8) < 2, `expected the panel rate, got ${r.fps}`);
});

test('the panel is measured, so moving to a different display re-solves the cap', () => {
  const fc = createFrameCap();
  fc.setCap(60);
  for (const ts of vsyncStream(181.8, 2)) fc.shouldRender(ts);
  assert.equal(fc.diagnostics().everyNVsyncs, 3, 'every third vsync on a 181.8 Hz panel');

  // the laptop is unplugged from the fast monitor: 60 Hz from here on
  const slow = createFrameCap();
  slow.setCap(60);
  for (const ts of vsyncStream(60, 2)) slow.shouldRender(ts);
  assert.equal(slow.diagnostics().everyNVsyncs, 1, 'every vsync on a 60 Hz panel');
  assert.equal(slow.diagnostics().panelHz, 60);
});

test('before the panel is known the cap draws rather than blocking', () => {
  // A gate that guessed wrong on tick one could hold the first frame back for
  // as long as it took to measure, and the first frame is the loading screen.
  const fc = createFrameCap();
  fc.setCap(60);
  assert.equal(fc.shouldRender(0), true);
  assert.equal(fc.shouldRender(5.5), true);
  assert.equal(fc.diagnostics().panelIntervalMs, null, 'and it admits it does not know yet');
});

test('a long stall does not redefine the panel', () => {
  // Alt-tab, a GC pause, a shader compile: one 900 ms gap must not convince the
  // cap that this is a 1 Hz display and let every frame through forever after.
  const fc = createFrameCap();
  fc.setCap(60);
  const ticks = vsyncStream(181.8, 2);
  for (const ts of ticks) fc.shouldRender(ts);
  const before = fc.diagnostics().everyNVsyncs;
  fc.shouldRender(ticks[ticks.length - 1] + 900);
  for (const ts of vsyncStream(181.8, 1)) fc.shouldRender(ts + 5000);
  assert.equal(fc.diagnostics().everyNVsyncs, before, 'the stall must not move the panel estimate');
});
