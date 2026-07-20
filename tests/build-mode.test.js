// The player decides where the shop goes.
//
// FIXTURES is the *default* floor plan; this is what the player did to it. They can pick a unit
// up, turn it, put it somewhere else, or take it off the floor entirely — and the game has to
// refuse the placements that would wreck the shop rather than let them wall themselves in.
//
// The brief's rules, each one a test below: no overlaps, doors stay clear, the checkout stays
// workable, customers can still reach the things they came to buy, and the player can never be
// sealed in. Every rule is pure arithmetic over the floor plan, so build mode cannot ship a
// layout that the 3D scene then has to apologise for.

import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame } from '../src/sim/state.js';
import {
  FIXTURES, INTERIOR, COUNTER, DOOR_CLEARWAY, fixtureRect, fixtureBrowsePoint,
} from '../src/data/shopLayout.js';
import {
  ensureLayout, placedFixtures, fixtureById, validatePlacement, commitPlacement,
  storeFixture, storedFixtures, restoreFixture, routesIntact, GRID,
} from '../src/sim/layout.js';

const fresh = () => {
  const st = newGame('relaxed', 6);
  st.shop.progression.tier = 'luxury';
  ensureLayout(st);
  return st;
};

test('an untouched shop is exactly the designed floor plan', () => {
  const st = fresh();
  const placed = placedFixtures(st);
  assert.equal(placed.length, FIXTURES.length);
  for (const f of placed) {
    const orig = FIXTURES.find((o) => o.id === f.id);
    assert.equal(f.x, orig.x);
    assert.equal(f.z, orig.z);
  }
  assert.equal(routesIntact(st), true, 'and it is, of course, a shop you can walk around');
});

test('the default plan validates: every fixture is legal where it already is', () => {
  const st = fresh();
  for (const f of FIXTURES) {
    const r = validatePlacement(st, f.id, f.x, f.z, f.ry || 0);
    assert.equal(r.ok, true, `${f.id} is legal where the designer put it: ${r.reasons.join(', ')}`);
  }
});

test('a fixture may not be placed inside another one', () => {
  const st = fresh();
  const a = FIXTURES[0];
  const b = FIXTURES.find((f) => f.id !== a.id && f.kind !== a.kind);
  const r = validatePlacement(st, a.id, b.x, b.z, b.ry || 0);
  assert.equal(r.ok, false);
  assert.ok(r.reasons.some((x) => /overlap/i.test(x)), `says why: ${r.reasons.join(', ')}`);
});

test('a fixture may not be pushed through a wall', () => {
  const st = fresh();
  const f = FIXTURES[0];
  const r = validatePlacement(st, f.id, INTERIOR.w / 2 + 1, 0, 0);
  assert.equal(r.ok, false);
  assert.ok(r.reasons.some((x) => /wall|inside/i.test(x)), `says why: ${r.reasons.join(', ')}`);
});

test('a fixture may not be parked in the doorway', () => {
  const st = fresh();
  const f = FIXTURES.find((x) => x.kind === 'table') || FIXTURES[0];
  const cx = (DOOR_CLEARWAY.minX + DOOR_CLEARWAY.maxX) / 2;
  const cz = (DOOR_CLEARWAY.minZ + DOOR_CLEARWAY.maxZ) / 2;
  const r = validatePlacement(st, f.id, cx, cz, 0);
  assert.equal(r.ok, false);
  assert.ok(r.reasons.some((x) => /door/i.test(x)), `says why: ${r.reasons.join(', ')}`);
});

test('a fixture may not be dropped in the till workspace', () => {
  const st = fresh();
  const f = FIXTURES.find((x) => x.kind === 'hatstand') || FIXTURES[0];
  const r = validatePlacement(st, f.id, COUNTER.staffStand.x, COUNTER.staffStand.z, 0);
  assert.equal(r.ok, false);
  assert.ok(r.reasons.some((x) => /checkout|till|counter/i.test(x)), `says why: ${r.reasons.join(', ')}`);
});

test('a moved fixture is rejected when its authored local-front browse target leaves the shop', () => {
  const st = fresh();
  const feature = FIXTURES.find((fixture) => fixture.id === 'feature');
  const candidate = { ...feature, x: 4, z: -5.5, ry: Math.PI };
  const target = fixtureBrowsePoint(candidate);
  assert.ok(target.z < -INTERIOR.d / 2, 'the runtime local +Z browse pose is beyond the north wall');

  const result = validatePlacement(st, candidate.id, candidate.x, candidate.z, candidate.ry);
  assert.equal(result.ok, false);
  assert.ok(
    result.reasons.some((reason) => /customers could not get around/i.test(reason)),
    `the authored customer target is part of candidate routing: ${result.reasons.join(', ')}`,
  );
});

test('a legal move sticks, and moves the fixture', () => {
  const st = fresh();
  const f = FIXTURES.find((x) => x.kind === 'hatstand');

  // find somewhere the game itself says is legal, rather than guessing at a gap in the plan
  let spot = null;
  for (let x = -7; x <= 4 && !spot; x += 0.5) {
    for (let z = -4; z <= 4; z += 0.5) {
      if (validatePlacement(st, f.id, x, z, 0).ok) { spot = { x, z }; break; }
    }
  }
  assert.ok(spot, 'there is somewhere on the floor a hat stand may legally go');

  const r = validatePlacement(st, f.id, spot.x, spot.z, 0);
  assert.equal(r.ok, true, `expected legal: ${r.reasons.join(', ')}`);
  commitPlacement(st, f.id, spot.x, spot.z, 0);

  const now = fixtureById(st, f.id);
  assert.equal(now.x, spot.x);
  assert.equal(now.z, spot.z);
  assert.equal(routesIntact(st), true, 'and the shop still works');

  // and it survives a save
  const loaded = JSON.parse(JSON.stringify(st));
  ensureLayout(loaded);
  const after = fixtureById(loaded, f.id);
  assert.equal(after.x, spot.x);
  assert.equal(after.z, spot.z);
});

test('rotating a fixture rotates its footprint', () => {
  const st = fresh();
  const f = FIXTURES.find((x) => x.kind === 'shelf');
  const flat = fixtureRect({ ...f, ry: 0 });
  const turned = fixtureRect({ ...f, ry: Math.PI / 2 });
  const wFlat = flat.maxX - flat.minX;
  const wTurned = turned.maxX - turned.minX;
  assert.ok(Math.abs(wFlat - wTurned) > 1.0, 'a shelf turned side-on is a different shape');
});

test('you cannot wall the customers off from the till', () => {
  const st = fresh();
  // try to seal the aisle to the counter with a long shelf laid across it
  const f = FIXTURES.find((x) => x.kind === 'shelf');
  const blockade = { x: COUNTER.x - 2.6, z: COUNTER.z - 1.6, ry: 0 };
  const r = validatePlacement(st, f.id, blockade.x, blockade.z, blockade.ry);
  // it might be rejected for overlap OR for routing — either way it must not be allowed to
  // silently pass and leave a shop nobody can shop in
  if (r.ok) {
    commitPlacement(st, f.id, blockade.x, blockade.z, blockade.ry);
    assert.equal(routesIntact(st), true, 'if it was legal, the shop must still be walkable');
  }
});

test('the router actually notices a shop it cannot walk through', () => {
  const st = fresh();
  // brute force: wall the entrance off with a row of fixtures placed straight into the layout,
  // bypassing validation, and confirm routesIntact() catches it
  const wall = [];
  for (let x = -INTERIOR.w / 2 + 1; x < INTERIOR.w / 2 - 1; x += 1.5) {
    wall.push({ id: `blockade_${x.toFixed(1)}`, kind: 'shelf', x, z: 5.0, ry: 0, skus: [], title: 'x', zone: 'sales' });
  }
  st.shop.layout.extra = wall; // a solid line across the shop, south of everything
  assert.equal(routesIntact(st), false, 'a shop sealed off from its own door is not intact');
});

test('a fixture can be taken off the floor and put back', () => {
  const st = fresh();
  const f = FIXTURES.find((x) => x.kind === 'table');
  storeFixture(st, f.id);
  assert.equal(placedFixtures(st).find((p) => p.id === f.id), undefined, 'it is off the floor');
  assert.ok(storedFixtures(st).includes(f.id), 'and in the back');
  assert.equal(routesIntact(st), true, 'removing something never breaks routing');

  restoreFixture(st, f.id);
  assert.ok(placedFixtures(st).find((p) => p.id === f.id), 'and back it comes');
  assert.equal(storedFixtures(st).length, 0);
});

test('the placement grid is fine enough to be useful and coarse enough to snap', () => {
  assert.ok(GRID >= 0.1 && GRID <= 0.5, `${GRID} yd`);
});
