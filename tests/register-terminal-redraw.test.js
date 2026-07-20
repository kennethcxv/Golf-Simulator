import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(
  new URL('../src/render3d/clubhouse/simplifiedRegisterMode.js', import.meta.url),
  'utf8',
);
const helperSource = source.match(
  /export const TERMINAL_BUSY_DOT_HZ = 3;[^]*?export function advanceTerminalBusyDots\([^]*?\n\}/,
)?.[0];
assert.ok(helperSource, 'terminal busy-animation helpers must remain available to focused tests');
const {
  TERMINAL_BUSY_DOT_HZ,
  advanceTerminalBusyDots,
  terminalBusyDotPhase,
} = vm.runInNewContext(
  `${helperSource.replaceAll('export ', '')}\n({ TERMINAL_BUSY_DOT_HZ, advanceTerminalBusyDots, terminalBusyDotPhase });`,
);

test('terminal processing dots advance at three visible phases per second', () => {
  assert.equal(TERMINAL_BUSY_DOT_HZ, 3);
  assert.equal(terminalBusyDotPhase(0), 0);
  assert.equal(terminalBusyDotPhase(0.332), 0);
  assert.equal(terminalBusyDotPhase(1 / 3), 1);
  assert.equal(terminalBusyDotPhase(2 / 3), 2);
  assert.equal(terminalBusyDotPhase(1), 0);
  assert.equal(terminalBusyDotPhase(-1), 0);
  assert.equal(terminalBusyDotPhase(Number.NaN), 0);
});

test('a 1.15-second card authorization repaints on dot boundaries, not every rAF', () => {
  const dt = 1 / 60;
  let elapsed = 0;
  let phaseChanges = 0;
  let frames = 0;
  while (elapsed < 1.15) {
    const next = advanceTerminalBusyDots(elapsed, Math.min(dt, 1.15 - elapsed));
    elapsed = next.elapsed;
    if (next.changed) phaseChanges += 1;
    frames += 1;
  }

  assert.equal(frames, 69, 'the reference authorization spans 69 simulated 60 Hz frames');
  assert.equal(phaseChanges, 3, 'only the .333, .667, and 1.000 second dot boundaries repaint');
  assert.equal(1 + phaseChanges, 4, 'including the immediate PROCESSING paint, only four uploads are needed');
});

test('terminal renderer caches output and the busy update invalidates only on phase changes', () => {
  assert.match(source, /const termContext = termCanvas\.getContext\('2d'\)/);
  assert.match(source, /const termGlow = termContext\.createLinearGradient/);
  assert.match(source, /if \(signature === termRenderSignature\) return false/);
  assert.match(source, /const dots = advanceTerminalBusyDots\(termDotsTimer, dt\);[^]*?if \(dots\.changed\) drawTerm\(\)/);
  assert.doesNotMatch(source, /termDotsTimer \+= dt;\s*drawTerm\(\)/);
  assert.match(source, /cardProcessingTimer = CARD_TIME;\s*termDotsTimer = 0;/);
});
