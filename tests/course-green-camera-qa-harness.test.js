import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const HARNESS_URL = new URL('../tools/qa/course-green-camera-qa.js', import.meta.url);
const source = fs.readFileSync(HARNESS_URL, 'utf8');
const courseSceneSource = fs.readFileSync(
  new URL('../src/render3d/courseScene.js', import.meta.url),
  'utf8',
);

test('focused Hole-7 Green camera QA file has the runner-compatible function shape', () => {
  const run = Function(`"use strict"; return (${source});`)();
  assert.equal(typeof run, 'function');
  assert.match(source, /schemaVersion:\s*SCHEMA_VERSION/);
  assert.match(source, /mode,\s*phase,/);
  assert.match(source, /views,\s*finalComposition,\s*stability,\s*comparison,/);
  assert.match(source, /artifacts:\s*\{/);
});

test('synthetic 0.94 baseline is guarded and candidate source stays unmodified', () => {
  assert.match(source, /COURSE_GREEN_QA_MODE/);
  assert.match(source, /\['baseline-094',\s*'baseline-094'\]/);
  assert.match(source, /\['candidate-093',\s*'candidate-093'\]/);
  assert.match(source, /if \(isBaseline\) \{\s*await page\.route\('\*\*\/src\/sim\/courseCamera\.js'/s);
  assert.match(source, /const replacements = source\.split\(BASELINE_SOURCE\)\.length - 1/);
  assert.match(source, /if \(replacements !== 1\)/);
  assert.match(source, /finite\(options\.greenTargetT, 0\.93\)/);
  assert.match(source, /finite\(options\.greenTargetT, 0\.94\)/);
  assert.match(source, /candidateUsesUnmodifiedApplicationSource:\s*!isBaseline/);
});

test('normal-control matrix covers Hole 7 Green View at 4:3 and 16:9', () => {
  assert.match(source, /Object\.freeze\(\{ key: '4x3', width: 1200, height: 900, aspect: 4 \/ 3 \}\)/);
  assert.match(source, /Object\.freeze\(\{ key: '16x9', width: 1600, height: 900, aspect: 16 \/ 9 \}\)/);
  assert.match(source, /page\.keyboard\.press\('j'\)/);
  assert.match(source, /selectHoleThroughUi\(6\)/);
  assert.match(source, /\.ced-holecard:not\(\.add\)/);
  assert.match(source, /name: 'Frame it', exact: true/);
  assert.match(source, /cameraSelect\.selectOption\('frame-hole'\)/);
  assert.match(source, /cameraSelect\.selectOption\('green'\)/);
  assert.match(source, /VISIBLE_SELECT_CYCLES = 10/);
  assert.doesNotMatch(source, /\.frameHole\s*\(/, 'acceptance flow must not invoke a scene camera shortcut');
  assert.doesNotMatch(source, /\.rig\.orbit\s*\(/, 'acceptance flow must not drive the rig directly');
  assert.doesNotMatch(source, /rig\.target\.set\s*\(/, 'acceptance flow must not write a direct pose');
});

test('safe-area and performance evidence is complete and retained in raw form', () => {
  assert.match(source, /SAMPLE_COUNT = 3/);
  assert.match(source, /SAMPLE_DURATION_MS = 2500/);
  assert.match(source, /greenClipped/);
  assert.match(source, /liveRigMatchesPose/);
  assert.match(source, /liveGeometryFits/);
  assert.match(source, /safeArea:\s*\{ ndcX: 0\.80, ndcY: 0\.74 \}/);
  assert.match(source, /hole07_green_\$\{viewport\.key\}_raw/);
  assert.match(source, /hole07_green_\$\{viewport\.key\}_safe/);
  for (const requiredMetric of [
    'averageFps',
    'onePercentLowFps',
    'worstFrameMs',
    'drawCallsPerFrame',
    'trianglesPerFrame',
    'materialCount',
    'textureMemoryEstimateBytes',
    'jsHeapUsedBytes',
    'jsEventListeners',
    'uiMutationRecordsPerSecond',
    'rawFrameDeltasMs',
  ]) {
    assert.match(source, new RegExp(requiredMetric), `records ${requiredMetric}`);
  }
  assert.match(source, /fullDocumentListenerDelta/);
  assert.match(source, /sampledTargetListenerDelta/);
  assert.match(source, /COURSE_GREEN_QA_BASELINE_RESULT/);
  assert.match(source, /proposedRegressionTolerances/);
  assert.match(source, /clubhouse\?\.assetsReady\?\.\(\) === true/);
  assert.match(source, /deliveryEquipmentReady\?\.\(\) === true/);
  assert.match(source, /\['active', 'fallback'\]\.includes\(sheet06\?\.lifecycle\)/);
  assert.match(source, /waitForSceneStable/);
  assert.match(source, /resourceStabilityPass/);
  assert.match(source, /baselineReferencePass/);
});

test('scene-stability polling is deadline bounded and does not re-enter the asset barrier', () => {
  const start = source.indexOf('const waitForSceneStable = async');
  const end = source.indexOf('\n  let cdp = null;', start);
  assert.ok(start >= 0 && end > start, 'finds the complete scene-stability helper');
  const helper = source.slice(start, end);
  assert.match(helper, /Number\.isFinite\(numeric\)/);
  assert.match(helper, /const deadline = startedAt \+ boundedTimeoutMs/);
  assert.match(helper, /const remainingMs = deadline - Date\.now\(\)/);
  assert.match(helper, /Math\.min\(boundedIntervalMs, remainingMs\)/);
  assert.doesNotMatch(helper, /waitForAssets/, 'asset readiness is handled once by callers');
  assert.match(source, /const initialAssetBarrier = await waitForAssets\(\)/);
  assert.match(source, /const assets = await waitForAssets\(\)/);
});

test('resource stability includes a detailed structural scene-inventory multiset diff', () => {
  assert.match(source, /const sceneInventory = async \(\) => page\.evaluate/);
  assert.match(source, /const diffSceneInventories = \(before, after\) =>/);
  assert.match(source, /parentPath,/);
  assert.match(source, /name,/);
  assert.match(source, /type,/);
  assert.match(source, /geometry,/);
  assert.match(source, /materials,/);
  assert.match(source, /beforeCount,/);
  assert.match(source, /afterCount,/);
  assert.match(source, /addedNodeCount,/);
  assert.match(source, /removedNodeCount,/);
  assert.match(source, /parentPathChanges,/);
  assert.match(source, /sceneInventoryDiff:\s*diffSceneInventories\(sceneInventoryBefore, sceneInventoryAfter\)/);
});

test('camera resource accounting isolates wall-clock clubhouse shoppers', () => {
  assert.match(source, /clubhouse\?\.setOrganicWalkins\?\.\(false\)/);
  assert.match(source, /clubhouse\?\.clearWalkins\?\.\(\)/);
  assert.match(source, /typeof customers === 'function' \? customers\(\) : customers/);
  assert.match(source, /customersBefore !== 0/);
  assert.match(source, /customersBefore === 0 && customersAfter === 0/);
  assert.match(source, /customerIsolationPass/);
});

test('camera resource accounting freezes and clears startup golfers', () => {
  assert.match(source, /app\.scene3d\.setGolfersFrozen\?\.\(true\)/);
  assert.match(source, /app\.scene3d\.clearGolfers\?\.\(\)/);
  assert.match(source, /golfersBefore !== 0/);
  assert.match(source, /golfersBefore === 0 && golfersAfter === 0/);
  assert.match(source, /golferIsolationPass/);
  assert.match(courseSceneSource, /clearGolfers:\s*\(\) => \{[\s\S]*while \(golfers\.length\)[\s\S]*removeGolfer\(golfers\.length - 1\)/);
  assert.match(courseSceneSource, /golferCount:\s*\(\) => golfers\.length/);
});
