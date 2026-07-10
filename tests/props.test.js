// COURSE PROPS — storm litter to clear and the broken tee sign to restore.
// Additive state (state.props): seeded litter piles on playable turf, cleared
// once each (wiping the wear under them), and a one-time paid sign repair that
// drives the broken→restored swap in the scene.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, serialize, deserialize } from '../src/sim/state.js';
import { ZONE, TURF_ZONES } from '../src/sim/constants.js';
import { clearLitter, fixTeeSign, ensureCourseProps } from '../src/sim/props.js';

test('a fresh course spawns litter piles on real playable ground, deterministically', () => {
  const a = newGame('relaxed', 42);
  assert.ok(a.props, 'props state exists');
  assert.ok(a.props.litter.length >= 3, `${a.props.litter.length} piles to clear`);
  for (const p of a.props.litter) {
    const zone = a.course.zones[p.cy * a.course.w + p.cx];
    assert.ok(TURF_ZONES.has(zone) && zone !== ZONE.GREEN, 'litter lands on fairway/rough/tee, never a green');
    assert.equal(p.cleared, false);
  }
  const b = newGame('relaxed', 42);
  assert.deepEqual(a.props.litter, b.props.litter, 'same seed, same piles');
});

test('clearing a pile works once and wipes the wear under it', () => {
  const state = newGame('relaxed', 42);
  const p = state.props.litter[0];
  const i = p.cy * state.course.w + p.cx;
  state.turf.wear[i] = 50;
  assert.ok(clearLitter(state, 0).ok);
  assert.equal(p.cleared, true);
  assert.ok(state.turf.wear[i] < 50, 'the ground under the pile recovers');
  assert.equal(clearLitter(state, 0).ok, false, 'a pile clears once');
});

test('the tee sign repair costs real money, once', () => {
  const state = newGame('relaxed', 42);
  assert.equal(state.props.teeSignFixed, false, 'starts broken');
  const cash = state.cash;
  state.cash = 20;
  assert.equal(fixTeeSign(state).ok, false, 'no repair you cannot afford');
  state.cash = cash;
  const res = fixTeeSign(state);
  assert.ok(res.ok);
  assert.equal(state.props.teeSignFixed, true);
  assert.ok(state.cash < cash, 'materials were paid for');
  assert.equal(fixTeeSign(state).ok, false, 'cannot pay twice');
});

test('props persist and old saves migrate to the rundown state', () => {
  const state = newGame('relaxed', 42);
  clearLitter(state, 1);
  fixTeeSign(state);
  const loaded = deserialize(serialize(state));
  assert.equal(loaded.props.litter[1].cleared, true);
  assert.equal(loaded.props.teeSignFixed, true);

  const raw = JSON.parse(serialize(state));
  delete raw.props;
  const migrated = deserialize(JSON.stringify(raw));
  assert.ok(migrated.props, 'old saves gain props state');
  assert.equal(migrated.props.teeSignFixed, false, 'every property is a fixer-upper');
});
