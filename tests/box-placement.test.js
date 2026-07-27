// A set-down box is a real object in the room, not a decal.
//
// putDownBox() used to write {x,z} unchecked, so a carried carton could be dropped into a
// wall, onto a shelf, or in the middle of a doorway — and because rebuildBoxes() never gave
// it a collider, once there it blocked nothing: the player and the customers walked straight
// through it. This is the arithmetic that refuses the bad spot and snaps the drop to a good
// one, the same way build mode refuses a bad fixture. Pure over the floor plan, so it runs
// headless.

import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame } from '../src/sim/state.js';
import { ensureDeliveries } from '../src/sim/deliveries.js';
import { INTERIOR, FIXTURES, DOOR_CLEARWAY, fixtureRect } from '../src/data/shopLayout.js';
import { boxDropLegal, legalBoxDrop, boxFootprint } from '../src/sim/layout.js';

const fresh = () => {
  const st = newGame('relaxed', 6);
  ensureDeliveries(st);
  return st;
};
// a plain carried carton — the thing the player is about to set down
const carton = () => ({ id: 1, skuId: 'tees1', box: 'carton', qty: 12, cap: 12, loc: 'carried' });
const putWorldBox = (st, o) => { st.shop.deliveries.boxes.push({ box: 'carton', loc: 'world', ...o }); };

test('a box footprint is an AABB that turns with the box', () => {
  const b = { box: 'clubbox' }; // a long, thin club box: 1.32 x 0.30
  const flat = boxFootprint(b, 0, 0, 0);
  const turned = boxFootprint(b, 0, 0, Math.PI / 2);
  const wFlat = flat.maxX - flat.minX;
  const wTurned = turned.maxX - turned.minX;
  assert.ok(wFlat > 1.2, 'lies long along x when unrotated');
  assert.ok(wTurned < 0.5, 'and short along x when turned side-on');
});

test('a box set down in open floor is legal', () => {
  const st = fresh();
  const r = boxDropLegal(st, carton(), 0, 2.0, 0); // mid sales floor, clear of everything
  assert.equal(r.ok, true, `expected legal: ${r.reasons.join(', ')}`);
});

test('a box may not be set down inside a wall', () => {
  const st = fresh();
  const r = boxDropLegal(st, carton(), 0, -INTERIOR.d / 2 - 0.3, 0); // past the north wall
  assert.equal(r.ok, false);
  assert.ok(r.reasons.some((x) => /wall/i.test(x)), `says why: ${r.reasons.join(', ')}`);
});

test('a box may not be set down on a fixture', () => {
  const st = fresh();
  const shelf = FIXTURES.find((f) => f.id === 'shelf_balls');
  const r = boxDropLegal(st, carton(), shelf.x, shelf.z, 0);
  assert.equal(r.ok, false);
  assert.ok(r.reasons.some((x) => /on top of/i.test(x)), `says why: ${r.reasons.join(', ')}`);
});

test('a box may not be set down in the doorway', () => {
  const st = fresh();
  const cx = (DOOR_CLEARWAY.minX + DOOR_CLEARWAY.maxX) / 2;
  const cz = (DOOR_CLEARWAY.minZ + DOOR_CLEARWAY.maxZ) / 2;
  const r = boxDropLegal(st, carton(), cx, cz, 0);
  assert.equal(r.ok, false);
  assert.ok(r.reasons.some((x) => /door/i.test(x)), `says why: ${r.reasons.join(', ')}`);
});

test('a box may not be stacked through another box', () => {
  const st = fresh();
  putWorldBox(st, { id: 2, x: 0, z: 2.0 });
  const r = boxDropLegal(st, carton(), 0, 2.0, 0); // right on top of box 2
  assert.equal(r.ok, false);
  assert.ok(r.reasons.some((x) => /box/i.test(x)), `says why: ${r.reasons.join(', ')}`);
});

test('a box does not collide with itself when nudged', () => {
  const st = fresh();
  putWorldBox(st, { id: 1, x: 0, z: 2.0 }); // same id as the carried carton
  const r = boxDropLegal(st, { id: 1, box: 'carton', loc: 'world' }, 0, 2.0, 0);
  assert.equal(r.ok, true, `a box may sit where it already is: ${r.reasons.join(', ')}`);
});

test('legalBoxDrop returns the requested spot when it is already legal', () => {
  const st = fresh();
  const spot = legalBoxDrop(st, carton(), 0, 2.0, 0.3);
  assert.deepEqual({ x: spot.x, z: spot.z, ry: spot.ry }, { x: 0, z: 2.0, ry: 0.3 });
});

test('legalBoxDrop snaps an illegal spot to a nearby legal one', () => {
  const st = fresh();
  const shelf = FIXTURES.find((f) => f.id === 'shelf_balls');
  const spot = legalBoxDrop(st, carton(), shelf.x, shelf.z, 0); // dropped on the ball wall
  assert.ok(spot, 'it finds somewhere');
  // and the somewhere it found is genuinely legal
  assert.equal(boxDropLegal(st, carton(), spot.x, spot.z, spot.ry).ok, true, 'the snapped spot is legal');
  // and close to where they aimed
  assert.ok(Math.hypot(spot.x - shelf.x, spot.z - shelf.z) < 3.0, 'and near where they meant');
});
