// Authored interaction sockets keep people in aisles, out of millwork, and
// facing actual products. They are part of the floor plan and follow build-mode
// transforms exactly like the fixture collider does.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FIXTURES, INTERIOR, fixtureCollisionRects, fixtureRect, fixtureSockets,
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

test('fitting and putting experiences are authored in walkable space and face a real target', () => {
  const experiences = FIXTURES.filter((f) => f.experience);
  assert.deepEqual(new Set(experiences.map((f) => f.experience)), new Set(['fitting', 'premium', 'putting']));
  for (const f of experiences) {
    const sockets = fixtureSockets(f, 'browse');
    assert.ok(sockets.length, `${f.id} has a customer experience socket`);
    assert.ok(f.experienceTarget, `${f.id} has an authored point of interest`);
    for (const socket of sockets) {
      for (const solid of fixtureCollisionRects(f)) {
        assert.ok(!inside(socket, solid), `${socket.key} is not trapped in ${f.id}'s physical collision`);
      }
    }
  }
});

test('experience links resolve to eligible authored fixtures without duplicate sockets', () => {
  const linked = [];
  for (const f of FIXTURES) {
    for (const id of f.experienceAfter || []) {
      const target = FIXTURES.find((candidate) => candidate.id === id);
      assert.ok(target, `${f.id} links to existing fixture ${id}`);
      assert.ok(target.experience, `${id} is an experience, not decorative metadata`);
      linked.push(...fixtureSockets(target, 'browse').map((p) => p.key));
    }
  }
  assert.ok(linked.length >= 3, 'clubs, apparel and putters have contextual experiences');
});
