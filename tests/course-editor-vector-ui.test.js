import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  editorFeatureRef,
  editorFeatureRefEqual,
  editorFeatureByRef,
  nearestEditorVectorFeature,
  nearestEditorPolylineFeature,
  nearestEditorControlPoint,
  movedEditorControlPoints,
  editorStreamRibbon,
  editorGreenContourPreset,
} from '../src/ui/courseEditor.js';

const editorSource = readFileSync(new URL('../src/ui/courseEditor.js', import.meta.url), 'utf8');

function sourceBetween(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0, `found source boundary: ${start}`);
  assert.ok(endIndex > startIndex, `found source boundary: ${end}`);
  return source.slice(startIndex, endIndex);
}

test('feature references retain ids and safely address id-less records', () => {
  const features = [{ pts: [] }, { id: 41, pts: [] }];
  assert.deepEqual(editorFeatureRef(features[0], 0), { index: 0 });
  assert.deepEqual(editorFeatureRef(features[1], 1), { id: 41 });
  assert.ok(editorFeatureRefEqual({ index: 0 }, { index: 0 }));
  assert.ok(editorFeatureRefEqual({ id: 41 }, { id: 41 }));
  assert.equal(editorFeatureByRef(features, { index: 0 }).feature, features[0]);
  assert.equal(editorFeatureByRef(features, { id: 41 }).feature, features[1]);
  assert.equal(editorFeatureByRef(features, { id: 99 }), null);
});

test('ground selection measures every closed feature and open stream', () => {
  const polygons = [
    { id: 1, pts: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }] },
    { id: 2, pts: [{ x: 8, y: 8 }, { x: 12, y: 8 }, { x: 12, y: 12 }, { x: 8, y: 12 }] },
  ];
  assert.equal(nearestEditorVectorFeature(polygons, 10, 10, 3).feature.id, 2);

  const streams = [
    { id: 3, pts: [{ x: 0, y: 0 }, { x: 0, y: 3 }] },
    { id: 4, pts: [{ x: 8, y: 8 }, { x: 12, y: 8 }] },
  ];
  assert.equal(nearestEditorPolylineFeature(streams, 10, 8.2, 2).feature.id, 4);
  assert.equal(nearestEditorPolylineFeature(streams, 6, 4, 1), null,
    'open streams do not gain a false last-to-first closing edge');
});

test('control-point previews clone input and stream ribbons preserve centerline ownership', () => {
  const points = [{ x: 1, y: 1 }, { x: 5, y: 1 }, { x: 8, y: 3 }];
  assert.equal(nearestEditorControlPoint(points, 4.9, 1.1, 1).index, 1);
  const moved = movedEditorControlPoints(points, 1, { x: 6, y: 2 });
  assert.deepEqual(points[1], { x: 5, y: 1 }, 'preview movement never mutates authored points');
  assert.deepEqual(moved[1], { x: 6, y: 2 });
  assert.notEqual(moved[0], points[0]);

  const ribbon = editorStreamRibbon(points, 8, 8);
  assert.equal(ribbon.length, points.length * 2);
  assert.equal(Math.hypot(ribbon[0].x - ribbon.at(-1).x, ribbon[0].y - ribbon.at(-1).y), 1);
});

test('green contour presets expose honest none, roll, and saddle data', () => {
  const green = {
    cx: 5,
    cy: 5,
    tiltA: 0,
    pts: [{ x: 3, y: 3 }, { x: 7, y: 3 }, { x: 7, y: 7 }, { x: 3, y: 7 }],
  };
  assert.equal(editorGreenContourPreset(green, 'none'), null);
  assert.equal(editorGreenContourPreset(green, 'soft-roll').length, 1);
  const saddle = editorGreenContourPreset(green, 'saddle');
  assert.equal(saddle.length, 2);
  assert.ok(saddle.some((contour) => contour.h > 0));
  assert.ok(saddle.some((contour) => contour.h < 0));
});

test('normal controls expose feature CRUD, selected-hole stamping, and streams', () => {
  const pointerDown = sourceBetween(editorSource, 'function onPointerDown(e)', 'function nearestHoleTo');
  const greenDown = sourceBetween(pointerDown, "case 'green': {", "case 'bunker': {");
  const bunkerDown = sourceBetween(pointerDown, "case 'bunker': {", "case 'water': {");
  assert.match(greenDown, /stampGreen\([\s\S]*holeId:\s*hole\.id/);
  assert.match(bunkerDown, /stampBunker\([\s\S]*holeId:\s*hole\.id/);

  const greenPanel = sourceBetween(editorSource, "case 'green': {", "case 'bunker': {");
  const bunkerPanel = sourceBetween(editorSource, "case 'bunker': {", "case 'water': {");
  const waterPanel = sourceBetween(editorSource, "case 'water': {", "case 'objects': {");
  for (const panel of [greenPanel, bunkerPanel, waterPanel]) {
    assert.match(panel, /\['draw', 'Draw'\], \['edit', 'Edit'\]/);
  }
  for (const label of ['Fringe', 'Apron', 'Raise', 'Tilt', 'Tilt direction', 'Contour preset']) {
    assert.match(greenPanel, new RegExp(`['\"]${label}['\"]`));
  }
  assert.match(greenPanel, /\['A', 'A'\][\s\S]*\['B', 'B'\][\s\S]*\['C', 'C'\]/);
  assert.match(bunkerPanel, /'Depth'[\s\S]*'Lip'[\s\S]*'Delete bunker'/);
  assert.doesNotMatch(bunkerPanel, /sand material|sand selector/i);
  assert.match(waterPanel, /course\.vec\?\.streams/);
  assert.match(waterPanel, /opt\.water\.shape = k[\s\S]*renderToolPanel\(\)[\s\S]*refreshHoverPreview\(\)/,
    'switching pond/lake/stream must immediately replace the shape-specific controls');
  assert.match(waterPanel, /'Width'[\s\S]*editVectorStream|commitSelectedFeatureEdit\('water', \{ width:/);
  assert.match(waterPanel, /'Delete stream'/);
  assert.doesNotMatch(waterPanel, /shoreline.*(?:style|softness|widthYd)/i);
});

test('boundary drag is retained, local on move, and commits through one release path', () => {
  const preview = sourceBetween(editorSource, 'function boundaryPreview', 'function pointsZoneRect');
  assert.match(preview, /outline:\s*\{ closed: true, points: world \}/);
  assert.match(preview, /fill:\s*\{ points: world \}/);
  assert.match(preview, /guides/);
  assert.match(preview, /kind:\s*'control-cross'/);
  assert.match(preview, /setEditorFeaturePreview\?\.\(boundaryPreview/);

  const pointerMove = sourceBetween(editorSource, 'function onPointerMove(e)', 'function refreshHoverPreview');
  const featureMove = sourceBetween(pointerMove, 'if (featureDrag && (e.buttons & 1))', "if (stroke && tool === 'terrain'");
  assert.match(featureMove, /movedEditorControlPoints\(featureDrag\.originalPts/);
  assert.doesNotMatch(featureMove, /editVector(?:Green|Bunker|Water|Stream)\(/);
  assert.doesNotMatch(featureMove, /feature\.pts\s*\[/);

  const pointerUp = sourceBetween(editorSource, 'function onPointerUp(e)', 'function finishDrawing');
  const featureUp = sourceBetween(pointerUp, 'if (featureDrag)', "if (stroke && tool === 'terrain'");
  assert.match(featureUp, /commitSelectedFeatureEdit\(drag\.kind, \{ pts: drag\.previewPts \}/);
  assert.equal((featureUp.match(/commitSelectedFeatureEdit\(/g) || []).length, 1);

  const commit = sourceBetween(editorSource, 'function commitSelectedFeatureEdit', '// ---------------------------------------------------------------- DOM');
  for (const api of ['editVectorGreen', 'editVectorBunker', 'editVectorWater', 'editVectorStream']) {
    assert.match(commit, new RegExp(`${api}\\(`));
  }
});

test('undo, redo, discard, delete, and tool switches clear stale feature refs', () => {
  const setTool = sourceBetween(editorSource, 'function setTool(key)', 'function setSelected');
  assert.match(setTool, /clearFeatureSelections\(\)/);
  const discard = sourceBetween(editorSource, 'async function discardPendingWork()', 'function doDiscard()');
  assert.match(discard, /discardSession\([\s\S]*clearFeatureSelections\(\)/);
  const applyFlow = sourceBetween(editorSource, 'function doDiscard()', 'function refreshObjects');
  assert.match(applyFlow, /discardPendingWork\(\)/);
  assert.match(applyFlow, /function doUndo\([\s\S]*clearFeatureSelections\(\)/);
  assert.match(applyFlow, /function doRedo\([\s\S]*clearFeatureSelections\(\)/);
  const remove = sourceBetween(editorSource, 'function removeSelectedVectorFeature', 'function renderToolPanel');
  assert.match(remove, /clearFeatureSelections\(kind\)/);
  assert.match(remove, /deleteVectorStream/);
});
