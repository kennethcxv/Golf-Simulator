import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Browser production resolves Three through the import map, while this QA
// checkout intentionally need not install node_modules. Evaluate the exact
// dependency-free production scoring slice rather than mocking the scene.
const source = fs.readFileSync(new URL('../src/render3d/courseScene.js', import.meta.url), 'utf8');
const sliceStart = source.indexOf('const WALK_FOCUS_MIN_FACING');
const sliceEnd = source.indexOf('// --- asset-idle tracking', sliceStart);
assert.ok(sliceStart >= 0 && sliceEnd > sliceStart, '3D walk-focus scoring slice is present');
// Strip EVERY export keyword in the slice, not three named ones. The named list
// was a tripwire: adding an `export const` inside this range made the whole file
// die with "Unexpected token 'export'" from inside a Function() constructor, and
// the stack points at the test rather than at the line that caused it. A slice
// evaluated as a function body cannot carry an export in any case, so removing
// them all is required for this technique to work rather than a way of hiding
// anything. (Recorded in Designs/ProShop/HARNESS_DEBT.md.)
const scoringSource = source.slice(sliceStart, sliceEnd).replace(/^export /gm, '');
const {
  walkPropFocusScore3d,
  walkPropRetainsFocus,
  walkFocusPromptLabel,
} = Function(
  `${scoringSource}\nreturn { walkPropFocusScore3d, walkPropRetainsFocus, walkFocusPromptLabel };`,
)();

const CAMERA = Object.freeze({ x: 0, y: 1.70, z: 0 });

function directionTo(point) {
  const x = point.x - CAMERA.x;
  const y = point.y - CAMERA.y;
  const z = point.z - CAMERA.z;
  const length = Math.hypot(x, y, z);
  return { x: x / length, y: y / length, z: z / length };
}

function score(point, aim, bias = 0) {
  const x = point.x - CAMERA.x;
  const y = point.y - CAMERA.y;
  const z = point.z - CAMERA.z;
  const spatial = Math.hypot(x, y, z);
  const direction = directionTo(aim);
  const facing = (x / spatial) * direction.x
    + (y / spatial) * direction.y
    + (z / spatial) * direction.z;
  return walkPropFocusScore3d(spatial, facing, bias);
}

test('loaded hand-truck carton and authored handle remain independently focusable', () => {
  // Representative player-relative points from Ref42: LOAD_ORIGIN is nearly
  // co-located with INTERACTION_TARGET in XZ, but the handle is about 0.5 m
  // above the centre of a medium carton.
  const handle = { x: 0, y: 0.72, z: -1.50 };
  const carton = { x: 0, y: 0.23, z: -1.57 };
  const equipmentCartonBias = 0.08;

  assert.ok(
    score(handle, handle) < score(carton, handle, equipmentCartonBias),
    'aiming at the handle must select the hand-truck tilt control',
  );
  assert.ok(
    score(carton, carton, equipmentCartonBias) < score(handle, carton),
    'aiming at the carton must select its X reposition action',
  );
});

test('3D focus scoring rejects props outside the interaction cone', () => {
  assert.equal(walkPropFocusScore3d(1.5, 0.3, 0), Infinity);
  assert.ok(Number.isFinite(walkPropFocusScore3d(1.5, 0.31, 0)));
});

test('an active articulated prop retains focus only inside its authored reach', () => {
  const prop = { r: 2.2, retainFocus: () => true };
  assert.equal(walkPropRetainsFocus(prop, 2.2), true);
  assert.equal(walkPropRetainsFocus(prop, 2.2001), false);
  assert.equal(walkPropRetainsFocus({ ...prop, retainFocus: false }, 1), false);
  assert.equal(walkPropRetainsFocus({ ...prop, retainFocus: () => { throw new Error('disposed'); } }, 1), false);
});

// The cutter-prompt rewrite test and projectedToolDragDelta retired 2026-07-30
// with the box cutter itself — cartons tear on a press, so no prompt is ever
// rewritten toward an equip and no pointer-lock drag maps to cut progress.
test('the prompt composer passes labels through unchanged, whatever tool is in hand', () => {
  assert.equal(
    walkFocusPromptLabel(
      'Accessory case · 8 inside - press [E] to tear the tape',
      'shelf-feeder',
      null,
      'reposition closed carton',
    ),
    'Accessory case · 8 inside - press [E] to tear the tape'
      + ' · [X] reposition closed carton',
    'a requested-but-unequipped contextual tool must not rewrite the label',
  );
  assert.equal(walkFocusPromptLabel('Accessory', null, null), 'Accessory');
  assert.equal(walkFocusPromptLabel(null, null, null), '');
});
