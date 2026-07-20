import test from 'node:test';
import assert from 'node:assert/strict';

import { BOX_KINDS } from '../src/data/boxes.js';
import {
  DELIVERY_BOX_CARRY_PROFILE_BY_KIND,
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
