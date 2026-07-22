import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { createCourse1MunicipalEnvironment } from '../src/render3d/course1MunicipalEnvironment.js';

test('municipal environment preserves explicitly leased restoration interactions and visuals', async () => {
  const group = new THREE.Group();
  const interior = new THREE.Group();
  group.add(interior);
  const keptVisual = new THREE.Group();
  keptVisual.userData.preserveInMunicipal = true;
  const removedVisual = new THREE.Group();
  interior.add(keptVisual, removedVisual);

  const keptProp = { id: 'cleaning-bay', preserveInMunicipal: true };
  const removedProp = { id: 'legacy-display-prompt' };
  const registeredProps = [keptProp, removedProp];
  const keptCollider = { id: 'restoration-clutter', preserveInMunicipal: true };
  const removedCollider = { id: 'legacy-shop-envelope' };
  const registeredColliders = [keptCollider, removedCollider];
  const removeFrom = (list) => (entry) => {
    const index = list.indexOf(entry);
    if (index >= 0) list.splice(index, 1);
  };
  const loader = {
    load(_url, onLoad) { onLoad({ scene: new THREE.Group() }); },
  };

  const environment = createCourse1MunicipalEnvironment({
    group,
    interior,
    shell: { productionVisualFallbacks: {} },
    addCollider: (entry) => registeredColliders.push(entry),
    removeCollider: removeFrom(registeredColliders),
    addProp: (entry) => registeredProps.push(entry),
    removeProp: removeFrom(registeredProps),
    registeredColliders,
    registeredProps,
    loader,
  });
  await environment.ready;
  environment.update(1 / 60);

  assert.ok(registeredProps.includes(keptProp));
  assert.ok(!registeredProps.includes(removedProp));
  assert.ok(registeredColliders.includes(keptCollider));
  assert.ok(!registeredColliders.includes(removedCollider));
  assert.equal(interior.visible, true);
  assert.equal(keptVisual.visible, true);
  assert.equal(removedVisual.visible, false);

  environment.dispose();
});
