// GOAL 34 — THE CAP TAKES THE PANEL FROM THE OS, AND GUARDS THE SKIP.
//
// The defect these cover, measured 2026-08-16 on the owner's machine: the cap
// was inert at every setting. everyNVsyncs was 1 and skippedTicks 0 at 60, at
// 144 and uncapped, because the module inferred the display's refresh from rAF
// gaps and on a GPU-bound frame that is the GAME's rate. Electron's screen API
// reported 240 Hz for the same display the module was calling 58.5.
//
// EVERY TEST HERE WAS WATCHED FAIL ON THE PREDECESSOR. `legacyEveryN` is that
// predecessor's arithmetic — median rAF gap, no OS input, no guard — run over
// the identical stream, so each assertion has the old answer beside it rather
// than only the new one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFrameCap } from '../src/core/frameCap.js';

function vsyncStream(hz, seconds, from = 0) {
  const step = 1000 / hz;
  const out = [];
  for (let t = 0; t < seconds * 1000; t += step) out.push(from + t);
  return out;
}

// What the shipped module would have concluded: the panel IS the tick median.
function legacyEveryN(capFps, tickHz) {
  if (capFps <= 0) return 1;
  return Math.max(1, Math.round((1000 / capFps) / (1000 / tickHz)));
}

test('a 240 Hz panel with a 240 Hz tick stream: cap 60 skips three ticks in four', () => {
  const fc = createFrameCap();
  fc.setPanelHz(240);
  fc.setCap(60);
  const drawnAt = [];
  for (const ts of vsyncStream(240, 3)) if (fc.shouldRender(ts)) drawnAt.push(ts);
  const d = fc.diagnostics();
  assert.equal(d.everyNVsyncs, 4, `the owner's acceptance: every fourth vsync, got ${d.everyNVsyncs}`);
  assert.ok(d.skippedTicks > 0, `and it must actually decline ticks, got ${d.skippedTicks}`);
  assert.equal(d.panelHz, 240);
  assert.equal(d.panelSource, 'os');
  // Steady state, not the whole run: skipping starts off and switches on once
  // the headroom is proven, so the opening moments legitimately run at the
  // panel rate. That transient is bounded below rather than averaged away.
  const steady = drawnAt.filter((t) => t >= 1000);
  const fps = (steady.length - 1) / ((steady[steady.length - 1] - steady[0]) / 1000);
  assert.ok(Math.abs(fps - 60) < 1, `expected ~60 presented frames a second, got ${fps.toFixed(1)}`);
  const proving = drawnAt.filter((t) => t < 1000).length;
  assert.ok(proving < 90, `the unproven opening must be brief, saw ${proving} frames in the first second`);
});

test('cap 240 on a 240 Hz panel is every vsync and declines nothing', () => {
  const fc = createFrameCap();
  fc.setPanelHz(240);
  fc.setCap(240);
  for (const ts of vsyncStream(240, 2)) fc.shouldRender(ts);
  const d = fc.diagnostics();
  assert.equal(d.everyNVsyncs, 1, 'the other half of the acceptance');
  assert.equal(d.skippedTicks, 0);
});

test('the OS number is what makes that possible — the tick median alone says 1', () => {
  // THE CONTROL, and the whole reason the OS call was added. A GPU-bound game
  // on a 240 Hz panel ticks at its own ~62 Hz. The predecessor read that as the
  // panel and concluded "every vsync" for a cap of 60, which is why nothing
  // moved at any setting.
  assert.equal(legacyEveryN(60, 62), 1, 'control: the shipped module concluded 1 here');

  const blind = createFrameCap();
  blind.setCap(60);
  for (const ts of vsyncStream(62, 3)) blind.shouldRender(ts);
  assert.equal(blind.diagnostics().everyNVsyncs, 1, 'with no OS input it still concludes 1');
  assert.equal(blind.diagnostics().panelSource, 'rAF-median');
  assert.equal(blind.diagnostics().skippedTicks, 0, 'and declines nothing — the inert cap');
});

test('THE GUARD: a work-bound game is never made slower by its own cap', () => {
  // The trap in trusting the OS grid. The panel really is 240 Hz, but a frame
  // costs 25 ms so ticks arrive at 40 Hz. Skipping three in four would present
  // 10 fps — the cap would be the defect. It must decline to skip instead.
  const fc = createFrameCap();
  fc.setPanelHz(240);
  fc.setCap(60);
  let drawn = 0;
  for (const ts of vsyncStream(40, 4)) if (fc.shouldRender(ts)) drawn += 1;
  const d = fc.diagnostics();
  assert.equal(d.workBound, true, 'it must notice it cannot hold the cadence');
  assert.equal(d.everyNVsyncs, 1, 'and stop skipping');
  assert.ok(drawn / 4 > 35, `the player must keep their frames, got ${drawn / 4} fps`);
});

test('and it comes back when the headroom does', () => {
  const fc = createFrameCap();
  fc.setPanelHz(240);
  fc.setCap(60);
  for (const ts of vsyncStream(40, 4)) fc.shouldRender(ts);
  assert.equal(fc.diagnostics().workBound, true, 'staged: work-bound first');

  // the load lifts — the frame now costs 6 ms and ticks arrive on the vsync grid
  for (const ts of vsyncStream(240, 4, 100000)) fc.shouldRender(ts);
  const d = fc.diagnostics();
  assert.equal(d.workBound, false, 'the guard must release, not latch for the session');
  assert.equal(d.everyNVsyncs, 4);
});

test('a cap the panel cannot divide is not mistaken for a struggling machine', () => {
  // 144 on 240 Hz rounds to every second vsync = 120 fps. The presented interval
  // is 8.33 ms against a requested 6.94, which is longer ON PURPOSE. A guard
  // comparing against the raw setting would call that a failure and switch
  // itself off; it must compare against the cadence the cap actually asked for.
  const fc = createFrameCap();
  fc.setPanelHz(240);
  fc.setCap(144);
  for (const ts of vsyncStream(240, 3)) fc.shouldRender(ts);
  const d = fc.diagnostics();
  assert.equal(d.everyNVsyncs, 2);
  assert.equal(d.workBound, false, '120 fps on a 240 Hz panel is the correct answer, not a shortfall');
  assert.equal(d.effectiveFps, 120);
});

test('unplugging the fast monitor re-solves the cap', () => {
  const fc = createFrameCap();
  fc.setPanelHz(240);
  fc.setCap(60);
  for (const ts of vsyncStream(240, 2)) fc.shouldRender(ts);
  assert.equal(fc.diagnostics().everyNVsyncs, 4);

  fc.setPanelHz(60); // the window is dragged to the 60 Hz laptop panel
  for (const ts of vsyncStream(60, 2, 50000)) fc.shouldRender(ts);
  const d = fc.diagnostics();
  assert.equal(d.everyNVsyncs, 1, 'every vsync on a 60 Hz panel');
  assert.equal(d.panelHz, 60);
});

test('setPanelHz(0) hands the panel back to the rAF median', () => {
  // A browser build has no screen API; it must keep working exactly as before.
  const fc = createFrameCap();
  fc.setPanelHz(240);
  fc.setCap(60);
  for (const ts of vsyncStream(240, 2)) fc.shouldRender(ts);
  assert.equal(fc.diagnostics().panelSource, 'os');
  fc.setPanelHz(0);
  for (const ts of vsyncStream(240, 2, 50000)) fc.shouldRender(ts);
  assert.equal(fc.diagnostics().panelSource, 'rAF-median');
  assert.equal(fc.diagnostics().everyNVsyncs, 4, 'and on a stream that IS the panel, it agrees');
});
