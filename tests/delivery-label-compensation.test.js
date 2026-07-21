import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import {
  deliveryBoxModelScale,
  deliveryLabelCanvasCompensation,
  deliveryLabelScaleCompensation,
  deliveryLabelSurfaceAspect,
  deliveryLabelTextureTransform,
} from '../src/render3d/clubhouse/deliveryBoxVisual.js';

const GENERIC_FAMILIES = [
  'carton', 'ballcase', 'merchbox', 'shoebox', 'bagcarton', 'fixture', 'crate',
  'provisions', 'umbrella', 'ironset',
];

test('rear-label shipping families retain an undistorted authored label scale', () => {
  for (const kind of GENERIC_FAMILIES) {
    const outer = deliveryBoxModelScale(kind);
    const label = deliveryLabelScaleCompensation(kind);
    assert.ok(outer && label, `${kind} exposes outer and label scales`);
    assert.equal(label[0], 1, `${kind} keeps its authored horizontal label size`);
    assert.equal(label[2], 1, `${kind} keeps its authored label depth`);
    assert.ok(Math.abs(outer[0] * label[0] - outer[1] * label[1]) <= 1e-12,
      `${kind} applies one uniform world scale to the label plane`);
  }
});

test('unscaled hero cases keep identity label scale and unknown kinds stay explicit', () => {
  assert.deepEqual(deliveryLabelScaleCompensation('apparel'), [1, 1, 1]);
  assert.deepEqual(deliveryLabelScaleCompensation('clubbox'), [1, 1, 1]);
  assert.equal(deliveryLabelScaleCompensation('future-unmapped-box'), null);
});

test('rear-mounted library labels mirror canvas U while front-mounted hero labels do not', () => {
  for (const kind of GENERIC_FAMILIES) {
    assert.deepEqual(deliveryLabelTextureTransform(kind), { repeatX: -1, offsetX: 1 },
      `${kind} compensates its authored +Y rear-label view`);
  }
  assert.deepEqual(deliveryLabelTextureTransform('apparel'), { repeatX: 1, offsetX: 0 });
  assert.deepEqual(deliveryLabelTextureTransform('clubbox'), { repeatX: 1, offsetX: 0 });
  assert.equal(deliveryLabelTextureTransform('future-unmapped-box'), null);
});

test('dynamic label canvas pre-compensates every authored surface aspect without changing its mesh', () => {
  for (const aspect of [1.6, 1.72941, 1.88927, 2.98485]) {
    const layout = deliveryLabelCanvasCompensation(aspect);
    assert.ok(Math.abs(layout.logicalWidth - 320 * aspect) <= 1e-9);
    assert.ok(Math.abs(layout.canvasScaleX * aspect / 1.6 - 1) <= 1e-9,
      `${aspect}: physical X stretch is exactly cancelled by canvas X compression`);
  }
  const label = new THREE.Mesh(new THREE.PlaneGeometry(0.1764, 0.102));
  label.updateMatrixWorld(true);
  assert.ok(Math.abs(deliveryLabelSurfaceAspect(label) - 0.1764 / 0.102) <= 1e-6);
  assert.deepEqual(label.scale.toArray(), [1, 1, 1], 'aspect compensation never distorts authored geometry');
});
