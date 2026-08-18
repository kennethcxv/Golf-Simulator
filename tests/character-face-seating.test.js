import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { makeCharacter } from '../src/render3d/characterAsset.js';

// H2 (Goal 17) — FACIAL FEATURES MUST BE BURIED IN THE SKIN THAT IS DRAWN,
// NOT THE SKIN THAT IS SPECIFIED.
//
// The brow was already inside the skull's NOMINAL 0.155 radius - on paper it
// was seated. But a UV SphereGeometry is a polygon in both axes, and between
// its vertices the drawn surface pulls in by cos(pi/w) * cos(pi/h). At 20 x 14
// the skin that actually rendered sat at 0.1521 while the brow's inner face was
// at 0.1523: proud by 0.2 mm, on the facets, which is exactly "from the side
// they sit off the skin with a visible gap".
//
// D6 (2026-08-18) — THIS FILE USED TO READ THE SOURCE WITH A REGEX, and that is
// how it kept passing a face the owner could see was broken. It matched
// `const brow = box(...)` and computed one number from it: the distance from
// the skull centre to the middle of that box's inner face. A box is not a
// point, and the middle of its inner face is the one place on it that WAS
// seated — the corners, 16 mm out, were never in the arithmetic. It also meant
// the check was pinned to a spelling: rewriting the brow as segments made it
// throw rather than fail, which is worse.
//
// It now BUILDS A CHARACTER and measures the geometry. The drawn-surface
// insight above is the part worth keeping, and it is what the seating is
// measured against.
const character = makeCharacter({});
const root = character.root || character;
root.updateMatrixWorld(true);

let skull = null;
const features = [];
root.traverse((o) => {
  if (o.userData?.skull) skull = o;
  if (o.userData?.faceFeature) features.push(o);
});

test('the skull and its features are findable in the built character', () => {
  assert.ok(skull, 'skull sphere found, declaring its own radius and segments');
  assert.ok(features.length >= 11,
    `only ${features.length} face features found — the check is measuring nothing`);
});

test('the skull publishes the radius it DRAWS, and it is smaller than the nominal', () => {
  const { r, drawnR, wSeg, hSeg } = skull.userData.skull;
  const expected = r * Math.cos(Math.PI / wSeg) * Math.cos(Math.PI / hSeg);
  assert.ok(Math.abs(drawnR - expected) < 1e-9,
    'the published drawn radius must be the faceting of the sphere actually built');
  assert.ok(drawnR < r);
});

test('every feature is buried in the DRAWN skin, at its WORST corner', () => {
  const { drawnR, centreY } = skull.userData.skull;
  const centre = new THREE.Vector3(0, centreY, 0);
  const proud = [];
  for (const mesh of features) {
    const { w, h, d } = mesh.userData.faceFeature;
    mesh.updateMatrix();
    for (const sx of [-0.5, 0.5]) {
      for (const sy of [-0.5, 0.5]) {
        const p = new THREE.Vector3(sx * w, sy * h, -0.5 * d).applyMatrix4(mesh.matrix);
        const gap = (p.distanceTo(centre) - drawnR) * 1000;
        if (gap > 0) proud.push(`${mesh.name} +${gap.toFixed(1)}mm`);
      }
    }
  }
  assert.deepEqual(proud, [],
    'a corner outside the drawn skin is daylight under a feature, seen from the side');
});

test('the skull is round enough that nominal and drawn barely differ', () => {
  // the guard against "fix it by burying the feature deeper", which would sink
  // the brow into the face at the vertices instead of floating at the facets
  const { r, wSeg } = skull.userData.skull;
  const shortfall = r - r * Math.cos(Math.PI / wSeg);
  assert.ok(shortfall < 0.0015,
    `the skull's facets pull in by ${(shortfall * 1000).toFixed(2)} mm, which must stay under 1.5 mm`);
});

test('and they are buried by a real margin, not by a rounding error', () => {
  // A corner at -0.05 mm is inside on paper and outside the moment anything
  // moves. A third of a millimetre is the smallest margin worth calling seated.
  const { drawnR, centreY } = skull.userData.skull;
  const centre = new THREE.Vector3(0, centreY, 0);
  const marginal = [];
  for (const mesh of features) {
    const { w, h, d } = mesh.userData.faceFeature;
    mesh.updateMatrix();
    for (const sx of [-0.5, 0.5]) {
      for (const sy of [-0.5, 0.5]) {
        const p = new THREE.Vector3(sx * w, sy * h, -0.5 * d).applyMatrix4(mesh.matrix);
        const gap = (p.distanceTo(centre) - drawnR) * 1000;
        if (gap > -0.3) marginal.push(`${mesh.name} ${gap.toFixed(2)}mm`);
      }
    }
  }
  assert.deepEqual(marginal, []);
});

test('CONTROL: the slab this replaced fails the same measurement', () => {
  // The exact geometry that shipped before D6: one 52 mm brow box centred at
  // x 0.0581, y 0.114, z 0.139, depth 0.014, against the same sphere. If this
  // ever passes, the measurement has stopped measuring the thing.
  const { drawnR, centreY } = skull.userData.skull;
  const centre = new THREE.Vector3(0, centreY, 0);
  let worst = -Infinity;
  for (const sx of [-0.026, 0.026]) {
    for (const sy of [-0.006, 0.006]) {
      const p = new THREE.Vector3(0.0581 + sx, 0.114 + sy, 0.139 - 0.007);
      worst = Math.max(worst, (p.distanceTo(centre) - drawnR) * 1000);
    }
  }
  assert.ok(worst > 10,
    `the old brow slab must measure as floating; it measured ${worst.toFixed(1)} mm`);
});

test('CONTROL: the check reports a floating feature when there is one', () => {
  // Move one brow segment 5 mm out along its own radial and the measurement
  // above must catch it. A check that cannot fail is measuring nothing.
  const { drawnR, centreY } = skull.userData.skull;
  const centre = new THREE.Vector3(0, centreY, 0);
  const victim = features.find((f) => f.name === 'faceFeature:brow');
  const before = victim.position.clone();
  const out = victim.position.clone().sub(centre).normalize().multiplyScalar(0.005);
  victim.position.add(out);
  victim.updateMatrix();
  const { w, h, d } = victim.userData.faceFeature;
  let worst = -Infinity;
  for (const sx of [-0.5, 0.5]) {
    for (const sy of [-0.5, 0.5]) {
      const p = new THREE.Vector3(sx * w, sy * h, -0.5 * d).applyMatrix4(victim.matrix);
      worst = Math.max(worst, (p.distanceTo(centre) - drawnR) * 1000);
    }
  }
  victim.position.copy(before);
  victim.updateMatrix();
  assert.ok(worst > 3, `a 5 mm lift must read as proud; it read ${worst.toFixed(2)} mm`);
});
