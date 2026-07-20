import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/ui/courseEditor.js', import.meta.url), 'utf8');

function sourceBetween(text, start, end) {
  const startIndex = text.indexOf(start);
  const endIndex = text.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0, `found source boundary: ${start}`);
  assert.ok(endIndex > startIndex, `found source boundary: ${end}`);
  return text.slice(startIndex, endIndex);
}

test('paths expose stable Draw/Edit selection and exact production metadata controls', () => {
  const panel = sourceBetween(source, "case 'paths': {", "case 'measure': {");
  assert.match(panel, /\['draw', 'Draw'\], \['edit', 'Edit'\]/);
  assert.match(panel, /path\.id === selectedPathId/);
  assert.match(panel, /setPathSelection\(path\.id\)/);
  assert.match(panel, /commitSlider\('Width'[\s\S]*commitSelectedPathEdit\(\{ width:/);
  assert.match(panel, /materialSelect\(path\.material[\s\S]*commitSelectedPathEdit\(\{ material:/);
  for (const label of ['Bridge', 'Deck material', 'Railings', 'Minimum clearance', 'Support spacing']) {
    assert.match(panel, new RegExp(`text: '${label}'|\\('${label}'`));
  }
  assert.match(panel, /bridge:\s*event\.target\.checked \? \{ \.\.\.bridge, enabled: true \} : null/);
  assert.match(panel, /bridge:\s*\{ deckMaterial: value \}/);
  assert.match(panel, /bridge:\s*\{ railings: event\.target\.checked \}/);
  assert.match(panel, /bridge:\s*\{ clearanceFt: value \/ 10 \}/);
  assert.match(panel, /bridge:\s*\{ supportSpacingYd: value \}/);
});

test('path creation persists authored bridge metadata and deletion clears stable selection', () => {
  const bridgeOptions = sourceBetween(source, 'function authoredBridgeFromOptions', 'function pathPreview');
  for (const field of ['enabled', 'deckMaterial', 'railings', 'clearanceFt', 'supportSpacingYd']) {
    assert.match(bridgeOptions, new RegExp(`${field}:`));
  }
  const finish = sourceBetween(source, 'function finishDrawing()', 'function drawMeasurePreview');
  assert.match(finish, /addPath\([\s\S]*bridge:\s*authoredBridgeFromOptions\(\)/);
  assert.match(finish, /refreshEditedPath\(\[\], drawingPath\)/);
  assert.match(finish, /toast\(res\.reason \|\| 'The path needs a valid open route\.'/);

  const panel = sourceBetween(source, "case 'paths': {", "case 'measure': {");
  assert.match(panel, /removePath\(state\(\), session, path\.id\)/);
  assert.match(panel, /clearPathSelection\(\)/);
  assert.match(panel, /refreshEditedPath\(beforePts, \[\]\)/);
});

test('retained path preview is an open centerline with visible control crosses', () => {
  const preview = sourceBetween(source, 'function pathPreview', 'function refreshEditedPath');
  assert.match(preview, /outline:\s*\{ closed: false, points: world \}/);
  assert.match(preview, /fill:\s*\{ points: \[\] \}/);
  assert.match(preview, /kind:\s*'control-cross'/);
  assert.match(preview, /setEditorFeaturePreview\?\.\(pathPreview/);
  const hover = sourceBetween(source, 'function updateHoverVisuals', 'function onPointerUp');
  assert.match(hover, /refreshSelectedBoundaryPreview\(\) \|\| refreshSelectedPathPreview\(\)/);
});

test('path picking is spatial and pointer movement only updates cloned preview points', () => {
  const picking = sourceBetween(source, 'function nearestPathControlPoint', 'function onPointerDown');
  assert.match(picking, /for \(const path of paths\)/);
  assert.match(picking, /nearestEditorControlPoint\(path\.pts/);
  assert.match(picking, /nearestEditorPolylineFeature\(paths/);
  assert.match(picking, /originalPts,[\s\S]*previewPts:/);

  const pointerMove = sourceBetween(source, 'function onPointerMove(e)', 'function refreshHoverPreview');
  const pathMove = sourceBetween(pointerMove, 'if (pathDrag && (e.buttons & 1))', 'if (featureDrag && (e.buttons & 1))');
  assert.match(pathMove, /movedEditorControlPoints\(pathDrag\.originalPts/);
  assert.doesNotMatch(pathMove, /editPath\(/);
  assert.doesNotMatch(pathMove, /\.pts\s*\[/);

  const pointerUp = sourceBetween(source, 'function onPointerUp(e)', 'function finishDrawing');
  const pathUp = sourceBetween(pointerUp, 'if (pathDrag)', 'if (featureDrag)');
  assert.match(pathUp, /commitSelectedPathEdit\(\{ pts: drag\.previewPts \}/);
  assert.equal((pathUp.match(/commitSelectedPathEdit\(/g) || []).length, 1);
  const commit = sourceBetween(source, 'function commitSelectedPathEdit', '// ---------------------------------------------------------------- DOM');
  assert.equal((commit.match(/editPath\(/g) || []).length, 1,
    'the release commit helper calls editPath exactly once');
});

test('path selection is cleared across tool, undo, redo, discard, delete, and hide flows', () => {
  const setTool = sourceBetween(source, 'function setTool(key)', 'function setSelected');
  assert.match(setTool, /clearPathSelection\(\)/);
  const history = sourceBetween(source, 'function doDiscard()', 'function refreshObjects');
  assert.match(history, /discardSession\([\s\S]*clearPathSelection\(\)/);
  assert.match(history, /function doUndo\([\s\S]*clearPathSelection\(\)/);
  assert.match(history, /function doRedo\([\s\S]*clearPathSelection\(\)/);
  const hide = sourceBetween(source, 'function hide()', 'const pdHandler');
  assert.match(hide, /clearPathSelection\(\)/);
});

test('object placement ghosts use the same collision radius and refresh when catalog choice changes', () => {
  assert.match(source, /import \{ snapCoursePoint, objectCollisionRadiusYd \}/);
  const objectPanel = sourceBetween(source, "case 'objects': {", "case 'paths': {");
  assert.match(objectPanel, /opt\.objects\.cat = k[\s\S]*renderToolPanel\(\)[\s\S]*refreshHoverPreview\(\)/);
  assert.match(objectPanel, /opt\.objects\.type = o\.type[\s\S]*refreshHoverPreview\(\)/);
  const hover = sourceBetween(source, 'function updateHoverVisuals', 'function onPointerUp');
  assert.match(hover, /collisionRadiusYd:\s*objectCollisionRadiusYd\(opt\.objects\.type, opt\.objects\.scale\)/);

  const selectPanel = sourceBetween(source, 'function renderToolPanel()', "case 'terrain': {");
  assert.match(selectPanel, /duplicateObject\([\s\S]*else toast\(res\.reason/);

  const objectGestures = sourceBetween(source, 'function beginObjectControlGesture', 'function segButtons');
  assert.match(objectGestures, /objectControlError = res\.reason/);
  assert.match(objectGestures, /endObjectGesture\(state\(\), session, gesture\)[\s\S]*toast\(previewError, 'warn'\)/);
  assert.match(objectGestures, /queueMicrotask\([\s\S]*renderToolPanel\(\)/,
    'invalid slider feedback restores the honest value only after the gesture is closed');
});

test('object placement and movement retain the shared snapped coordinate contract', () => {
  const placement = sourceBetween(source, 'function objectPlacementPoint', 'function liveRefreshThrottled');
  assert.match(placement, /snapCoursePoint\(g\.fx, g\.fy/);
  const pointerDown = sourceBetween(source, 'function onPointerDown(e)', 'function nearestHoleTo');
  assert.match(pointerDown, /const target = objectPlacementPoint\(g\)[\s\S]*addObject\([\s\S]*target\.x, target\.y/);
  const pointerMove = sourceBetween(source, 'function onPointerMove(e)', 'function refreshHoverPreview');
  assert.match(pointerMove, /const target = objectPlacementPoint\(g\)[\s\S]*previewObjectGesture\([\s\S]*x: target\.x, y: target\.y/);
  assert.match(source, /objects:\s*c\.objects/,
    'save/export continues to serialize the snapped object coordinates');
});

test('playtest samples bridge-aware height and zone with legacy scene fallbacks', () => {
  const playtest = sourceBetween(source, 'function enterPlaytest', 'function exitPlaytest');
  assert.match(playtest, /heightAt:\s*\(x, z\) => sc\.playHeightAt\?\.\(x, z\) \?\? sc\.heightAt\(x, z\)/);
  assert.match(playtest, /zoneAt:\s*\(x, z\) => sc\.playZoneAtWorld\?\.\(x, z\) \?\? sc\.zoneAtWorld\(x, z\)/);
});

test('vector authoring removes the historical half-cell preview and commit offset', () => {
  const mapping = sourceBetween(source, 'function authoringPoint', 'function yd2cells');
  assert.match(mapping, /state\(\)\.course\.vec \? 0\.5 : 0/);
  assert.match(mapping, /sc\.vectorWorldX\(x\)/);
  assert.match(mapping, /sc\.vectorWorldZ\(y\)/);

  const pointerDown = sourceBetween(source, 'function onPointerDown(e)', 'function nearestHoleTo');
  assert.match(pointerDown, /stampGreen\(state\(\), session, point\.x, point\.y/);
  assert.match(pointerDown, /stampBunker\(state\(\), session, point\.x, point\.y/);
  assert.match(pointerDown, /stampWater\(state\(\), session, point\.x, point\.y/);
  assert.match(pointerDown, /drawingPath\.push\(authoringPoint\(g\)\)/);
  assert.match(pointerDown, /setPinPosition\(state\(\), session, hole\.id, opt\.green\.pin, g\.x, g\.y\)/,
    'integer pin markers retain cell-centre coordinates');

  const preview = sourceBetween(source, 'function boundaryPreview', 'function previewBoundaryValid');
  assert.match(preview, /authoredWorldX\(sc, point\.x\)/);
  assert.match(preview, /authoredWorldZ\(sc, point\.y\)/);
});
