import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// H1 (Goal 17) — THE TRUNK RIDES ONE VERTICAL LAW.
//
// The reported defect was a torso that pumped and detached while walking. Goal
// 16 found the cause and fixed it: FOUR vertical laws met at the waist - shirt
// at 1.0x bob, stomach at 0.7x, belt and buckle at none, hips at none - so at
// stride the hem slid against a static belt at 2.8 Hz and the trunk read as
// coming apart.
//
// The fix is one law, and its failure mode is that somebody later adds a piece
// to the waist and forgets it, or gives it a fraction of the bob. That is what
// this pins. It is a cheap check for a defect that cost a session to diagnose.
//
// The geometry was checked separately and holds: the shirt hem sits at chest-
// local y -0.061 and the chest pivots at its own origin, so at the deepest lean
// in the animation set (0.24 rad, the bunker swing) the REAR hem rises to world
// y 1.0433 against a pelvis top of 1.0700 - still buried 26.7 mm. At a walk's
// 0.04 rad it is buried 55.5 mm. The trunk cannot open a seam by leaning.

const src = fs.readFileSync(new URL('../src/render3d/characterAsset.js', import.meta.url), 'utf8');

// The per-frame block where the trunk's vertical positions are written. Anchored
// on the chest line and run to the end of the function, so a piece added after
// the belt is inside the window rather than beyond an arbitrary character count.
const block = (() => {
  const at = src.indexOf('chest.position.y = 1.07 + bob;');
  if (at < 0) return null;
  const end = src.indexOf('\n  };', at);
  return end < 0 ? src.slice(at) : src.slice(at, end);
})();

test('the trunk bob block is findable', () => {
  assert.ok(block, 'the one-law block is where the trunk heights are written');
  assert.ok(block.length > 80, 'and it contains more than the chest line alone');
});

test('every trunk piece rides the same bob', () => {
  // the pieces that meet at the waist and must not drift against each other
  for (const piece of ['chest', 'pelvis', 'belt', 'buckle', 'buckleTongue']) {
    const re = new RegExp(`${piece}\\.position\\.y = [\\d.]+ \\+ bob;`);
    assert.match(block, re, `${piece} rides the shared bob`);
  }
});

test('no trunk piece takes a fraction of the bob', () => {
  // "stomach at 0.7x" is the exact shape of the original defect.
  assert.doesNotMatch(block, /position\.y = [\d.]+ \+ [\d.]+ \s*\*\s*bob/,
    'no piece scales the bob');
});

test('no trunk piece opts out by being written without bob', () => {
  // A line in this block that sets a height and does NOT add bob is a piece
  // that will slide against the ones that do - which is the defect.
  const heightLines = [...block.matchAll(/^\s*(\w+)\.position\.y = ([^;]+);/gm)];
  assert.ok(heightLines.length >= 5, 'the block sets several trunk heights');
  for (const [, piece, expr] of heightLines) {
    assert.match(expr, /\bbob\b/, `${piece} must ride the bob, not sit still while the others move`);
  }
});
