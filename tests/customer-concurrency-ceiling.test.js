import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// G9 (Goal 17) — THE CROWD CEILING MUST NOT COLLAPSE BACK TO A STARTER STUB.
//
// "Multiple customers at once, scaled by how the course is doing. The formula
// exists; the starter tier's cap of 2 hides it."
//
// The caps were raised in the previous session to 5 / 8 / 10 / 12. That is the
// thing worth pinning, because a cap of 2 does not look like a bug in a diff -
// it looks like a conservative default, and it silently hides a formula that
// works.

const src = fs.readFileSync(new URL('../src/sim/shopProgression.js', import.meta.url), 'utf8');

const caps = [...src.matchAll(/customerCapacity: (\d+)/g)].map((m) => Number(m[1]));

test('every shop tier declares a customer capacity', () => {
  assert.ok(caps.length >= 4, `found ${caps.length} tier capacities, expected at least four`);
});

test('the starter tier can show a crowd, not a pair', () => {
  // 2 was the reported value and it hid the scaling formula entirely.
  assert.ok(caps[0] >= 5,
    `the starter cap is ${caps[0]}; below 5 the standing formula cannot be seen at all`);
});

test('the ceiling rises with the tier and never goes backwards', () => {
  for (let i = 1; i < caps.length; i += 1) {
    assert.ok(caps[i] >= caps[i - 1],
      `tier ${i} caps at ${caps[i]}, below tier ${i - 1}'s ${caps[i - 1]}`);
  }
  assert.ok(caps[caps.length - 1] >= 10,
    `the top tier caps at ${caps[caps.length - 1]}, which should read as a busy shop`);
});
