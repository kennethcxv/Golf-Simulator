import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const courseSource = fs.readFileSync(new URL('../src/render3d/courseScene.js', import.meta.url), 'utf8');
const clubhouseSource = fs.readFileSync(new URL('../src/render3d/clubhouse.js', import.meta.url), 'utf8');

test('mouse drag is the primary cutter path and consumes pointer-look while cutting', () => {
  assert.match(courseSource, /dragBoxCutterAlongFocusedPath\(e\.movementX, e\.movementY\)\) return/);
  assert.match(courseSource, /walkSpraying \|\| walkTool !== 'boxcutter'/);
  assert.match(courseSource, /projectedToolDragDelta\(/);
  assert.match(courseSource, /prop\.drag\(Math\.min\(remaining, span \* segmentFraction, 0\.12\)\)/);
});

test('authored path exposes weighted segments and the simulation shares drag and hold progress', () => {
  assert.match(clubhouseSource, /view\.toolPathAtProgress\(b\.tape\)/);
  assert.doesNotMatch(clubhouseSource, /startLocal = \{ x: 0, z: -dim\.d \* 0\.42 \}/);
  assert.match(clubhouseSource, /drag: \(amount\) => advanceCut\(amount\)/);
  assert.match(clubhouseSource, /hold: \(dt\) => advanceCut\(dt \* 0\.5\)/);
  assert.match(clubhouseSource, /\[LMB\] drag along tape · \[E\] hold alternative/);
});

test('the live tape guide is one reusable scene object rather than per-frame geometry', () => {
  assert.equal((courseSource.match(/new THREE\.Line\(/g) || []).length >= 1, true);
  assert.match(courseSource, /cutterGuideGeometry\.attributes\.position\.needsUpdate = true/);
  assert.match(courseSource, /cutterGuideRibbon\.name = 'BoxCutterActiveTapeRibbon'/);
  assert.match(courseSource, /cutterGuideRibbon\.scale\.set\(0\.012, 0\.0025/);
  const updateStart = courseSource.indexOf('function updateBoxCutterPose');
  const updateEnd = courseSource.indexOf('function walkKeyDown', updateStart);
  assert.ok(updateStart >= 0 && updateEnd > updateStart);
  assert.doesNotMatch(courseSource.slice(updateStart, updateEnd), /new THREE\.Line\(/);
  assert.doesNotMatch(courseSource.slice(updateStart, updateEnd), /new THREE\.BoxGeometry\(/);
});
