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
const scoringSource = source.slice(sliceStart, sliceEnd)
  .replace('export function walkPropFocusScore3d', 'function walkPropFocusScore3d')
  .replace('export function walkPropRetainsFocus', 'function walkPropRetainsFocus')
  .replace('export function walkFocusPromptLabel', 'function walkFocusPromptLabel')
  .replace('export function projectedToolDragDelta', 'function projectedToolDragDelta');
const {
  walkPropFocusScore3d,
  walkPropRetainsFocus,
  walkFocusPromptLabel,
  projectedToolDragDelta,
} = Function(
  `${scoringSource}\nreturn { walkPropFocusScore3d, walkPropRetainsFocus, walkFocusPromptLabel, projectedToolDragDelta };`,
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

test('sealed-carton prompt gives one cutter instruction while preserving reposition', () => {
  const sealed = walkFocusPromptLabel(
    'Accessory case · 8 inside — [LMB] drag along tape · [E] hold alternative',
    'boxcutter',
    null,
    'reposition closed carton',
  );
  assert.equal(
    sealed,
    'Accessory case · 8 inside — tap [E] once to equip the box cutter'
      + ' · [X] reposition closed carton',
  );
  assert.doesNotMatch(sealed, /hold \[E\]/i);

  const partial = walkFocusPromptLabel(
    'Accessory — [LMB] drag along tape · [E] hold alternative',
    'boxcutter',
    null,
  );
  assert.equal(partial, 'Accessory — tap [E] once to equip the box cutter');

  assert.equal(
    walkFocusPromptLabel(
      'Accessory case · 8 inside — [LMB] drag along tape · [E] hold alternative',
      'boxcutter',
      'boxcutter',
      'reposition closed carton',
    ),
    'Accessory case · 8 inside — [LMB] drag along tape · [E] hold alternative'
      + ' · [X] reposition closed carton',
    'once equipped, the focus exposes drag-first cutting and the hold fallback',
  );
});

test('pointer-lock cutter progress follows only the projected forward tape direction', () => {
  assert.equal(projectedToolDragDelta(10, 20, 110, 20, 50, 0), 0.5);
  assert.equal(projectedToolDragDelta(10, 20, 110, 20, -50, 0), 0, 'backtracking does not cut');
  assert.equal(projectedToolDragDelta(10, 20, 110, 20, 0, 50), 0, 'cross-track motion does not cut');
  assert.equal(projectedToolDragDelta(0, 100, 0, 0, 0, -25), 0.25, 'screen Y orientation is respected');
  assert.equal(projectedToolDragDelta(0, 0, 0, 0, 50, 0), 0, 'degenerate projections are inert');
  assert.equal(projectedToolDragDelta(0, 0, 100, 0, Number.NaN, 0), 0, 'invalid mouse deltas are inert');
});
