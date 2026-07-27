import test from 'node:test';
import assert from 'node:assert/strict';

import { BOX_KINDS } from '../src/data/boxes.js';
import { BACKDOOR_CLEARWAY, INTERIOR, STOCKROOM } from '../src/data/shopLayout.js';
import {
  DELIVERY_BOX_CARRY_PROFILE_BY_KIND,
  deliveryBoxCarryCollisionRadius,
  deliveryBoxCarryProfile,
} from '../src/render3d/clubhouse/deliveryCarryProfile.js';

test('every production box family has an intentional first-person carry profile', () => {
  assert.deepEqual(
    new Set(Object.keys(DELIVERY_BOX_CARRY_PROFILE_BY_KIND)),
    new Set(Object.keys(BOX_KINDS)),
  );

  const expected = new Map([
    ['carton', 'small-chest'],
    ['ballcase', 'small-chest'],
    ['shoebox', 'small-chest'],
    ['merchbox', 'medium-two-hand'],
    ['apparel', 'medium-two-hand'],
    ['fixture', 'medium-two-hand'],
    ['bagcarton', 'tall-bulky'],
    ['crate', 'freight-low-far'],
    ['clubbox', 'long-two-hand-diagonal'],
    ['provisions', 'small-chest'],
    ['umbrella', 'long-two-hand-diagonal'],
    ['ironset', 'long-two-hand-diagonal'],
  ]);

  for (const kind of Object.keys(BOX_KINDS)) {
    assert.equal(deliveryBoxCarryProfile(kind).id, expected.get(kind), kind);
  }
});

test('tall and freight cartons move progressively farther from the near plane', () => {
  const small = deliveryBoxCarryProfile('carton');
  const medium = deliveryBoxCarryProfile('apparel');
  const tall = deliveryBoxCarryProfile('bagcarton');
  const freight = deliveryBoxCarryProfile('crate');

  assert.ok(-medium.position[2] > -small.position[2]);
  assert.ok(-tall.position[2] > -medium.position[2]);
  assert.ok(-freight.position[2] > -tall.position[2]);

  for (const kind of Object.keys(BOX_KINDS)) {
    const profile = deliveryBoxCarryProfile(kind);
    const { h, d, w } = profile.dimensions;
    const frontFaceDistance = -profile.position[2] - d * 0.5;
    assert.ok(frontFaceDistance >= 1.10, `${kind} front face clears the near camera by ${frontFaceDistance}`);
    assert.ok(h / frontFaceDistance <= 0.70, `${kind} vertical camera envelope remains bounded`);
    assert.ok(profile.hands.supportX <= w * 0.5 + 0.02, `${kind} hands stay on or inboard of the package sides`);
  }
});

test('the accepted long club pose and asymmetric two-hand support remain exact', () => {
  const profile = deliveryBoxCarryProfile({ box: 'clubbox', flat: false });
  assert.deepEqual(profile.position, [0, -0.58, -1.30]);
  assert.deepEqual(profile.rotation, [0.02, 0.78, -0.16]);
  assert.equal(profile.hands.supportX, 1.25 * 0.19);
  assert.equal(profile.hands.y, -0.49);
  assert.equal(profile.hands.ySkew, -0.050);
  assert.equal(profile.hands.z, -1.30);
  assert.equal(profile.hands.zSkew, -0.24);
});

test('carry collision follows each visible package yaw and keeps freight usable at receiving', () => {
  const clubRadius = deliveryBoxCarryCollisionRadius('clubbox');
  const crateRadius = deliveryBoxCarryCollisionRadius('crate');

  assert.ok(Math.abs(clubRadius - 0.53) < 0.005,
    `the accepted diagonal club-case envelope remains about 0.53 m, got ${clubRadius}`);
  assert.ok(crateRadius < 0.66,
    `the visible low freight pose must clear the 1.32 m service opening, got ${crateRadius}`);
  assert.ok(Math.abs(crateRadius - 0.63) < 1e-12,
    'the square freight carry pose includes its five-millimetre handling skin');
  assert.ok(crateRadius > BOX_KINDS.crate.w / 2,
    'the collision envelope still protects the crate corners and handling clearance');

  const handTruckHalfX = (
    Math.abs(Math.cos(0.6)) * 0.50 + Math.abs(Math.sin(0.6)) * 0.45
  ) / 2;
  const handTruckHalfZ = (
    Math.abs(Math.sin(0.6)) * 0.50 + Math.abs(Math.cos(0.6)) * 0.45
  ) / 2;
  const handTruckEastEdge = STOCKROOM.handTruck.x + handTruckHalfX;
  const handTruckWestEdge = STOCKROOM.handTruck.x - handTruckHalfX;
  const handTruckNorthEdge = STOCKROOM.handTruck.z - handTruckHalfZ;
  const handTruckSouthEdge = STOCKROOM.handTruck.z + handTruckHalfZ;
  const overlapsReceiving = handTruckEastEdge > BACKDOOR_CLEARWAY.minX
    && handTruckWestEdge < BACKDOOR_CLEARWAY.maxX
    && handTruckSouthEdge > BACKDOOR_CLEARWAY.minZ
    && handTruckNorthEdge < BACKDOOR_CLEARWAY.maxZ;
  assert.equal(overlapsReceiving, false,
    'the compact parked hand truck stays outside the receiving clearway');
  assert.ok(INTERIOR.d / 2 - handTruckSouthEdge > crateRadius * 2,
    'the hand-truck/stock-door approach remains wider than carried freight');
});

test('flattened packages keep their established compact presentation', () => {
  assert.deepEqual(
    deliveryBoxCarryProfile({ box: 'carton', flat: true }).position,
    [0, -0.34, -1.18],
  );
  assert.deepEqual(
    deliveryBoxCarryProfile({ box: 'clubbox', flat: true }).position,
    [0, -0.28, -1.28],
  );
});
