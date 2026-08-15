// X2 (Goal 21) — a tap on a tool does something.
//
// The stranger verifier tapped the pressure washer five times on the porch,
// which is the game's own critical path, and got nothing: no water, no sound,
// no number moving. Goal 20 added a hint — which fires, and which they quoted
// back verbatim — and a hint is still an apology for a dead control.
//
// A real trigger answers a short pull with a short burst. These are source
// assertions because the spray path lives inside main.js's pointer handlers,
// which need a canvas, a walk rig and a live scene; the live proof is a driver.
// What CAN be pinned here is the thing that regressed: that a tap reaches the
// same spray path a hold uses, rather than a cosmetic stand-in.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const main = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const handler = main.slice(
  main.indexOf("window.addEventListener('pointerup'"),
  main.indexOf("canvas.addEventListener('pointerup'"),
);

test('a tap sprays through the real path, not a cosmetic puff', () => {
  assert.ok(handler.length > 200, 'found the pointerup handler');
  assert.match(handler, /setSpraying\(true\)/,
    'a tap must reach the same spray the hold uses, or the jet and the cleaning are fake');
  assert.match(handler, /setToolLoop\(tool\)/, 'and it must make the tool sound');
});

test('the burst stops itself, and cannot stack', () => {
  // A tap that leaves the tool running is a stuck trigger, and a player who
  // taps five times fast must not end up with five overlapping timers.
  assert.match(handler, /if \(tapBurstTimer\) clearTimeout\(tapBurstTimer\)/);
  assert.match(handler, /tapBurstTimer = setTimeout\(/);
  assert.match(handler, /stopToolUse\(\)/);
});

test('the burst is a squeeze, not a stuck button', () => {
  const ms = Number((main.match(/const TAP_BURST_MS = (\d+);/) || [])[1]);
  assert.ok(Number.isFinite(ms), 'TAP_BURST_MS must be a named constant');
  assert.ok(ms >= 120 && ms <= 500,
    `${ms} ms is not a squeeze: under ~120 ms nothing is visible, over ~500 ms it reads as a stuck button`);
});

test('the hint still teaches the better gesture, and still only once', () => {
  // The burst makes the tool honest; the hint is what stops a player tapping
  // for ever when holding is what they want.
  assert.match(handler, /tappedToolsHinted\.has\(tool\)/);
  assert.match(handler, /tappedToolsHinted\.add\(tool\)/);
  assert.match(handler, /t\('hud\.holdToUseTool'\)/);
});

test('a tap only bursts in hold mode', () => {
  // Toggle mode already treats a click as start/stop; bursting there would cut
  // off the very activation the player just asked for.
  assert.match(handler, /toolActivation === 'hold'/);
});
