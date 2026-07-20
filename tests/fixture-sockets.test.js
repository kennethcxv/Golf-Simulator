// Authored interaction sockets keep people in aisles, out of millwork, and
// facing actual products. They are part of the floor plan and follow build-mode
// transforms exactly like the fixture collider does.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FIXTURES, INTERIOR, fixtureRect, fixtureSockets,
} from '../src/data/shopLayout.js';

const inside = (p, r) => p.x > r.minX && p.x < r.maxX && p.z > r.minZ && p.z < r.maxZ;

test('every retail fixture authors browse and stocking positions outside its collider', () => {
  for (const f of FIXTURES.filter((x) => x.skus.length)) {
    const rect = fixtureRect(f);
    const browse = fixtureSockets(f, 'browse');
    const stock = fixtureSockets(f, 'stock');
    assert.ok(browse.length >= 1, `${f.id} has a browse socket`);
    assert.ok(stock.length >= 1, `${f.id} has a stock socket`);
    for (const p of [...browse, ...stock]) {
      assert.ok(!inside(p, rect), `${p.key} stands outside ${f.id}'s collider`);
      assert.ok(Math.abs(p.x) <= INTERIOR.w / 2 - 0.3, `${p.key} leaves body room at the x wall`);
      assert.ok(Math.abs(p.z) <= INTERIOR.d / 2 - 0.3, `${p.key} leaves body room at the z wall`);
    }
  }
});

test('socket keys are unique and can be reserved without shoppers stacking', () => {
  const keys = FIXTURES.flatMap((f) => fixtureSockets(f, 'browse').map((p) => p.key));
  assert.equal(new Set(keys).size, keys.length);
});

test('moving and rotating a fixture carries its sockets with it', () => {
  const original = FIXTURES.find((f) => f.id === 'shelf_balls');
  const moved = { ...original, x: 2.5, z: -1.5, ry: Math.PI / 2 };
  const local = original.browse[0];
  const world = fixtureSockets(moved, 'browse')[0];
  assert.ok(Math.abs(world.x - (moved.x + local.z)) < 1e-9);
  assert.ok(Math.abs(world.z - (moved.z - local.x)) < 1e-9);
});
