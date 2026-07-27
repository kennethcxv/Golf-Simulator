import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  BOX_PLACEMENT_GHOST_BAD,
  BOX_PLACEMENT_GHOST_OK,
  BOX_PLACEMENT_CUE_BAD,
  BOX_PLACEMENT_CUE_OK,
  createBoxPlacementMode,
} from '../src/render3d/clubhouse/boxPlacementMode.js';

test('carried-box placement retains the closest surface, rotates, and commits its exact legal target', () => {
  const parent = new THREE.Group();
  const surfaces = [
    { id: 'shelf:near', distance: 1, point: { x: 1, y: 0.8, z: 3 } },
    { id: 'floor:far', distance: 2, point: { x: 1, y: 0, z: 4 } },
  ];
  const previewed = [];
  const committed = [];
  let nearIsLegal = false;
  let lastLegalTarget = null;

  const mode = createBoxPlacementMode({
    parent,
    enumerateSurfaces: () => surfaces,
    raycastSurface: (surface) => ({
      distance: surface.distance,
      point: surface.point,
    }),
    previewPlacement: ({ surface, hit, rotationY }) => {
      previewed.push(surface.id);
      const target = {
        loc: 'world',
        surfaceId: surface.id,
        x: hit.point.x,
        y: hit.point.y,
        z: hit.point.z,
        ry: rotationY,
      };
      if (surface.id === 'shelf:near' && !nearIsLegal) {
        return { ok: false, target, reason: 'Shelf position is occupied.' };
      }
      lastLegalTarget = target;
      return { ok: true, target };
    },
    commitPlacement: (target) => {
      committed.push(target);
      return { ok: true, boxId: 41 };
    },
  });

  assert.equal(mode.begin({
    box: { id: 41, box: 'clubbox' },
    dimensions: { w: 1.25, h: 0.18, d: 0.18 },
  }), true);

  const envelope = parent.getObjectByName('BoxPlacementEnvelope');
  const footprint = parent.getObjectByName('BoxPlacementFootprint');
  const facingCue = parent.getObjectByName('BoxPlacementFacingCue');
  assert.ok(envelope?.isMesh && footprint?.isLineSegments && facingCue?.isLineSegments);
  assert.equal(footprint.geometry.getAttribute('position').count, 14,
    'one reusable footprint geometry includes four boundary edges and a forward arrow');
  assert.equal(facingCue.geometry.getAttribute('position').count, 8,
    'one reusable facing cue includes a top seam and front handling arrow');
  assert.deepEqual(envelope.scale.toArray(), [1.25, 0.18, 0.18]);
  assert.equal(envelope.position.y, 0.09, 'the exact envelope rests on the target plane');
  assert.deepEqual(footprint.scale.toArray(), [1.25, 1, 0.18]);
  assert.deepEqual(facingCue.scale.toArray(), [1.25, 0.18, 0.18]);
  assert.equal(facingCue.material.color.getHex(), BOX_PLACEMENT_CUE_OK);
  assert.equal(envelope.material.transparent, true);
  assert.equal(envelope.material.depthWrite, false);

  const geometryRefs = [envelope.geometry, footprint.geometry, facingCue.geometry];
  const materialRefs = [envelope.material, footprint.material, facingCue.material];
  const disposals = { geometry: 0, material: 0 };
  geometryRefs.forEach((resource) => resource.addEventListener('dispose', () => {
    disposals.geometry += 1;
  }));
  materialRefs.forEach((resource) => resource.addEventListener('dispose', () => {
    disposals.material += 1;
  }));

  assert.equal(mode.update({ pointer: 'crosshair' }), true);
  assert.deepEqual(previewed, ['shelf:near'],
    'validation stops at the closest hit instead of falling through to the legal floor');
  let diagnostics = mode.diagnostics();
  assert.equal(diagnostics.surfaceId, 'shelf:near');
  assert.equal(diagnostics.hitDistance, 1);
  assert.equal(diagnostics.legal, false);
  assert.equal(diagnostics.visible, true, 'the illegal closest hit remains visible');
  assert.equal(diagnostics.colour, BOX_PLACEMENT_GHOST_BAD);
  assert.equal(facingCue.material.color.getHex(), BOX_PLACEMENT_CUE_BAD);
  assert.deepEqual(mode.root.position.toArray(), [1, 0.8, 3]);
  assert.equal(mode.commit(), false, 'an illegal preview cannot call the commit callback');
  assert.equal(committed.length, 0);

  nearIsLegal = true;
  assert.equal(mode.update({ pointer: 'crosshair' }), true);
  diagnostics = mode.diagnostics();
  assert.equal(diagnostics.legal, true);
  assert.equal(diagnostics.colour, BOX_PLACEMENT_GHOST_OK);
  assert.equal(facingCue.material.color.getHex(), BOX_PLACEMENT_CUE_OK);

  assert.equal(mode.rotate(), true);
  diagnostics = mode.diagnostics();
  assert.equal(diagnostics.quarterTurns, 1);
  assert.ok(Math.abs(diagnostics.rotationY - Math.PI / 2) < 1e-12);
  assert.ok(Math.abs(mode.root.rotation.y - Math.PI / 2) < 1e-12);
  assert.strictEqual(diagnostics.target, lastLegalTarget,
    'rotation revalidates and retains the new exact target');

  // A long preview run mutates only the preallocated resources.
  for (let frame = 0; frame < 80; frame += 1) mode.update({ frame });
  assert.strictEqual(envelope.geometry, geometryRefs[0]);
  assert.strictEqual(footprint.geometry, geometryRefs[1]);
  assert.strictEqual(facingCue.geometry, geometryRefs[2]);
  assert.strictEqual(envelope.material, materialRefs[0]);
  assert.strictEqual(footprint.material, materialRefs[1]);
  assert.strictEqual(facingCue.material, materialRefs[2]);
  assert.deepEqual(mode.diagnostics().allocations, { geometries: 3, materials: 3 });

  const exactTarget = mode.diagnostics().target;
  assert.deepEqual(mode.commit(), { ok: true, boxId: 41 });
  assert.strictEqual(committed[0], exactTarget,
    'the commit callback receives the preview target object unchanged');
  assert.equal(mode.isActive(), false);
  assert.equal(mode.root.visible, false);

  const firstDispose = mode.dispose();
  assert.deepEqual(firstDispose, { geometries: 3, materials: 3, alreadyDisposed: false });
  assert.equal(parent.getObjectByName('BoxPlacementGhost'), undefined);
  assert.deepEqual(disposals, { geometry: 3, material: 3 });
  assert.deepEqual(mode.dispose(), { geometries: 3, materials: 3, alreadyDisposed: true });
  assert.deepEqual(disposals, { geometry: 3, material: 3 }, 'dispose is idempotent');
});

test('a legal preview without an exact target remains red and cannot commit', () => {
  const parent = new THREE.Group();
  let commits = 0;
  const mode = createBoxPlacementMode({
    parent,
    enumerateSurfaces: () => [{ id: 'floor' }],
    raycastSurface: () => ({ distance: 1, point: { x: 0, y: 0, z: 2 } }),
    previewPlacement: () => ({ ok: true, pose: { x: 0, y: 0, z: 2, ry: 0 } }),
    commitPlacement: () => { commits += 1; },
  });
  mode.begin({ box: { id: 9 }, dimensions: { w: 0.42, h: 0.30, d: 0.36 } });
  mode.update();
  assert.equal(mode.diagnostics().legal, false);
  assert.equal(mode.diagnostics().colour, BOX_PLACEMENT_GHOST_BAD);
  assert.equal(mode.commit(), false);
  assert.equal(commits, 0);
  mode.dispose();
});
