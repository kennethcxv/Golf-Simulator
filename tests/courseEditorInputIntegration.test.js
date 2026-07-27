import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const editorSource = readFileSync(
  new URL('../src/ui/courseEditor.js', import.meta.url),
  'utf8',
);

function sourceBetween(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0, `found source boundary: ${start}`);
  assert.ok(endIndex > startIndex, `found source boundary: ${end}`);
  return source.slice(startIndex, endIndex);
}

test('object pointer drag previews live and commits once on pointer-up', () => {
  const pointerDown = sourceBetween(editorSource, 'function onPointerDown(e)', 'function nearestHoleTo');
  const pointerMove = sourceBetween(editorSource, 'function onPointerMove(e)', 'function updateHoverVisuals');
  const pointerUp = sourceBetween(editorSource, 'function onPointerUp(e)', 'function finishDrawing');

  assert.match(pointerDown,
    /kind:\s*'object',[\s\S]*gesture:\s*beginObjectGesture\(state\(\), obj\.id, 'Move object'\)/);
  assert.match(pointerMove,
    /draggingObj\?\.kind === 'object'[\s\S]*previewObjectGesture\(state\(\), draggingObj\.gesture/);
  assert.doesNotMatch(pointerMove, /\bmoveObject\(/,
    'pointer movement must not create history entries');
  assert.match(pointerUp,
    /draggingObj\?\.kind === 'object'[\s\S]*endObjectGesture\(state\(\), session, draggingObj\.gesture\)/);
});

test('object rotate and scale sliders share one gesture lifecycle per interaction', () => {
  const slider = sourceBetween(editorSource, 'function slider(', 'function beginObjectControlGesture');
  const selectPanel = sourceBetween(editorSource, 'function renderToolPanel()', "case 'terrain': {");

  assert.match(slider, /gesture\?\.onstart\?\.\(\)/,
    'keyboard-originated input lazily opens a gesture');
  assert.match(slider, /onpointerdown:\s*\(\) => gesture\?\.onstart\?\.\(\)/);
  for (const endEvent of ['onpointerup', 'onpointercancel', 'onchange', 'onblur']) {
    assert.match(slider, new RegExp(`${endEvent}:\\s*finishGesture`));
  }
  assert.match(selectPanel,
    /previewSelectedObject\(\{ rot:[^}]+\}, 'Rotate object'\)[\s\S]*onstart:[\s\S]*beginObjectControlGesture\('Rotate object'\)[\s\S]*onend:\s*commitObjectControlGesture/);
  assert.match(selectPanel,
    /previewSelectedObject\(\{ scale:[^}]+\}, 'Scale object'\)[\s\S]*onstart:[\s\S]*beginObjectControlGesture\('Scale object'\)[\s\S]*onend:\s*commitObjectControlGesture/);
  assert.doesNotMatch(selectPanel, /\bmoveObject\(/,
    'slider input must not create history entries');
});

test('feature tools drive faithful previews and clear them across editor modes', () => {
  const hover = sourceBetween(editorSource, 'function updateHoverVisuals', 'function onPointerUp');
  for (const feature of ['tee', 'green', 'bunker', 'water']) {
    assert.match(hover, new RegExp(`feature:\\s*'${feature}'`), `${feature} has a shaped preview`);
  }
  assert.match(hover, /tool === 'green' && opt\.green\.mode === 'draw' && !opt\.green\.pin/,
    'pin placement does not leave a green footprint ghost');
  assert.match(hover, /tool === 'water' && opt\.water\.mode === 'draw' && opt\.water\.shape !== 'stream'/,
    'stream drawing does not invoke the pond/lake geometry builder');
  assert.match(hover, /aimWorld:[\s\S]*authoredWorldX\(sc, aimCell\.x\)[\s\S]*authoredWorldZ\(sc, aimCell\.y\)/,
    'tee preview carries the same pin-relative aim as placement');

  const setToolSource = sourceBetween(editorSource, 'function setTool(key)', 'function setSelected');
  const playtestSource = sourceBetween(editorSource, 'function enterPlaytest', 'function aimArcPoints');
  const hideSource = sourceBetween(editorSource, 'function hide()', 'const pdHandler');
  for (const source of [setToolSource, playtestSource, hideSource]) {
    assert.match(source, /setEditorFeaturePreview\?\.\(null\)/,
      'mode transition clears the shaped preview');
  }
});

test('terrain falloff and shaped-feature rotation are deterministic from preview to commit', () => {
  const pointerDown = sourceBetween(editorSource, 'function onPointerDown(e)', 'function nearestHoleTo');
  const terrain = sourceBetween(editorSource, 'function applyTerrainAt', 'function applyPaintAt');

  assert.match(terrain, /falloff:\s*opt\.terrain\.falloff/);
  assert.match(pointerDown, /angle:\s*\(opt\.bunker\.rot \* Math\.PI\) \/ 180/);
  assert.match(pointerDown, /angle:\s*\(opt\.water\.rot \* Math\.PI\) \/ 180/);
  assert.doesNotMatch(pointerDown, /angle:\s*Math\.random\(\) \* Math\.PI/,
    'click-time random rotation must not disagree with the stationary preview');
});

test('visual-only hover previews coalesce high-rate pointer input to animation frames', () => {
  const pointerMove = sourceBetween(editorSource, 'function onPointerMove(e)', 'function refreshHoverPreview');
  const scheduler = sourceBetween(editorSource, 'function scheduleHoverPreview', 'function cancelHoverPreview');

  assert.match(pointerMove, /scheduleHoverPreview\(g\)/);
  assert.match(scheduler, /if \(hoverPreviewFrame !== null\) return/);
  assert.match(scheduler, /hoverPreviewFrame = requestAnimationFrame/);
  assert.doesNotMatch(scheduler, /sculptAt|paintAt|previewObjectGesture/,
    'stroke and drag simulation remain on the unthrottled input path');
});
