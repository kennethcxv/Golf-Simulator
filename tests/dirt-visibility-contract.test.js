// The contracts the dirt-visibility work depends on.
//
// The reveal itself is renderer-side (an InstancedMesh drawn with depthTest
// off) and is proved by tools/qa/dirt-visibility.js against a real browser.
// What IS testable headlessly is the data those systems key off — and every
// one of these was load-bearing for a bug in this round.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CLEANING_TOOLS, DIRT } from '../src/data/cleaningTools.js';
import { seedDebris, debrisState, totalDebris } from '../src/sim/cleaningDebris.js';

function freshState() {
  return { shop: { reno: { debris: [] } } };
}

test('the reticle gate: a debris tool declares DIRT.DEBRIS and a working reach', () => {
  // courseScene only offers the "sweep it" reticle for tools whose dirt list
  // includes DEBRIS, and it solves the crosshair-to-floor distance against the
  // tool's own reach. Both have to exist or the prompt silently never appears.
  const broom = CLEANING_TOOLS.broom;
  assert.ok(broom, 'the broom is still in the registry');
  assert.ok(Array.isArray(broom.dirt) && broom.dirt.includes(DIRT.DEBRIS),
    'the broom handles debris');
  assert.ok(broom.reach > 0.5, `the broom has a usable reach (${broom.reach})`);
  assert.ok(broom.radius > 0, 'the broom has a contact radius the prompt can use');
});

test('the dustpan also reads as a debris tool, so the prompt survives a swap', () => {
  const pan = CLEANING_TOOLS.dustpan;
  assert.ok(Array.isArray(pan.dirt) && pan.dirt.includes(DIRT.DEBRIS));
});

test('debris carries the position and amount the markers are placed from', () => {
  const state = freshState();
  seedDebris(state, 12, 8, 6, 4242);
  const list = debrisState(state);
  assert.ok(list.length > 0, 'seeding produced clusters');
  for (const d of list) {
    assert.ok(Number.isFinite(d.x) && Number.isFinite(d.z),
      'every cluster has a finite position for its marker');
    assert.ok(d.a > 0, 'and an amount, which sizes the marker');
  }
  assert.ok(totalDebris(state) > 0, 'the room reports outstanding debris');
});

test('an emptied room offers nothing to reveal', () => {
  // The lower-left affordance is gated on remaining clusters, so "nothing left"
  // has to be observable rather than inferred from the condition number.
  const state = freshState();
  assert.equal(debrisState(state).length, 0);
  assert.equal(totalDebris(state), 0);
});
