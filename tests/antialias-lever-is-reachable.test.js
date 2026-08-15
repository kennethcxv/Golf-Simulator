// THE MOST EXPENSIVE ATTRIBUTE IN THE RENDERER MUST NOT BE A LITERAL.
//
// `composerTarget` is built with `samples: 4` — 4x MSAA on a HalfFloatType
// target. Measured three times with EXT_disjoint_timer_query_webgl2, indoors,
// against a 0.00-0.04 ms drift control: dropping it to 0 saves **1.26, 1.28 and
// 1.26 ms** and takes frames over the 8.33 ms refresh interval from 100% to
// ~28%. That is 14% of the entire GPU frame, in one constructor argument.
//
// For the whole of this session it was reachable only by a QA driver reaching
// into `composer.renderTarget1` — which means no settings row, no quality
// preset and no future measurement could touch it without repeating that trick.
//
// The default is deliberately UNCHANGED at 4x: dropping it trades a stutter for
// aliased edges on every surface, and that is a taste decision rather than a bug
// fix. What this pins is that the lever stays addressable, and that reading it
// back is possible — because a setter whose effect cannot be verified is how a
// silent no-op gets recorded as "this is not where the time is".
//
// WATCHED FAILING: with `setAntialiasSamples` and `antialiasSamples` removed
// from courseScene's returned API, assertions 1 and 2 fail.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../src/render3d/courseScene.js', import.meta.url), 'utf8');
// Comments explain the fix and name the functions, so a scan that does not strip
// them matches its own explanation and can never fail.
const code = src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

test('the antialias sample count is settable at runtime', () => {
  assert.match(code, /function setAntialiasSamples\s*\(/,
    'courseScene must define setAntialiasSamples');
  assert.match(code, /^\s*setAntialiasSamples,\s*$/m,
    'setAntialiasSamples must be on the returned API, or nothing outside this '
    + 'module can reach the single most expensive attribute in the renderer');
});

test('and readable, so a caller can prove the write landed', () => {
  assert.match(code, /function antialiasSamples\s*\(/,
    'courseScene must define antialiasSamples');
  assert.match(code, /^\s*antialiasSamples,\s*$/m,
    'antialiasSamples must be on the returned API');
});

test('both composer ping-pong targets are updated, not just the template', () => {
  // `composerTarget` is the template the EffectComposer clones; writing only to
  // it changes nothing that draws. The live targets are renderTarget1 and 2 and
  // both must be disposed so the GL object is rebuilt at the new sample count.
  const body = code.slice(code.indexOf('function setAntialiasSamples'));
  const end = body.indexOf('\n  function ', 1);
  const fn = end > 0 ? body.slice(0, end) : body.slice(0, 2000);
  assert.match(fn, /renderTarget1/, 'setAntialiasSamples must update renderTarget1');
  assert.match(fn, /renderTarget2/, 'setAntialiasSamples must update renderTarget2');
  assert.match(fn, /\.dispose\(\)/,
    'the targets must be disposed, or the GL object keeps the old sample count');
});

test('the shipped default is still 4x', () => {
  // The measurement says 0 is faster. Shipping 0 is a different decision and
  // this test is the tripwire if it ever happens by accident rather than on
  // purpose — the visual cost lands on every edge in the game.
  assert.match(code, /samples:\s*4/,
    'the composer target no longer requests 4x MSAA; if that was deliberate it '
    + 'is a visual change to every surface and this test should be updated with '
    + 'the reasoning, not deleted');
});
