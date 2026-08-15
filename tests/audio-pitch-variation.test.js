import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// F2 (Goal 17) — REPEATS MUST NOT GRATE.
//
// Audited: of 92 voices in core/audio.js, only 20 varied their pitch. The other
// 72 played the identical note every time - footsteps, box handling, product
// sounds, shelf stocking, all of which repeat constantly. F2 names that exact
// condition: "pitch-varied so repeats do not grate."
//
// The fix is one wrapper on ctx.createOscillator rather than 72 edits, so this
// pins the wrapper. A behavioural check would need a real AudioContext; what
// matters structurally is that the wrapper exists, is applied once, and uses
// DETUNE rather than frequency - because a voice that ramps its frequency must
// keep its whole ramp, with the offset riding on top.

const audio = fs.readFileSync(new URL('../src/core/audio.js', import.meta.url), 'utf8');

test('every oscillator is detuned from one place', () => {
  assert.match(audio, /ctx\.createOscillator = \(\) => \{/, 'createOscillator is wrapped');
  assert.match(audio, /osc\.detune\.value = \(Math\.random\(\) \* 2 - 1\)/,
    'the wrapper randomises DETUNE, so a frequency ramp survives intact');
});

test('the wrapper is applied once, not once per init', () => {
  // init() can run more than once across a session; double-wrapping would stack
  // detunes and drift the whole game sharp or flat.
  assert.match(audio, /!ctx\.__fwDetuned/, 'guarded against re-wrapping');
  assert.match(audio, /ctx\.__fwDetuned = true/, 'and the guard is set');
});

test('the spread stays under the threshold where a note reads as wrong', () => {
  const m = /\* 2 - 1\) \* (\d+(?:\.\d+)?);/.exec(audio);
  assert.ok(m, 'the cent spread is findable');
  const cents = Number(m[1]);
  assert.ok(cents > 0, 'there is some variation at all');
  // a quarter-tone is 50 cents and reads as out of tune; chimes and musical
  // cues have to survive this
  assert.ok(cents <= 25, `spread is ${cents} cents, which must stay well under a quarter-tone`);
});
