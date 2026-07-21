import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sceneSource = readFileSync(
  new URL('../src/render3d/courseScene.js', import.meta.url),
  'utf8',
);
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

test('scene resize refits the active camera preset after updating projection aspect', () => {
  const resize = sourceBetween(sceneSource, 'function resize()', 'function setViewMode');
  const aspectUpdate = resize.indexOf('camera.aspect = wpx / hpx');
  const activeRead = resize.indexOf('const active = activeCourseCamera');

  assert.ok(aspectUpdate >= 0 && aspectUpdate < activeRead,
    'the new aspect is installed before the selected preset is recomputed');
  assert.match(resize, /active\?\.kind === 'overview'\) frameCourse\(\)/);
  assert.match(resize, /active\?\.kind === 'hole'\) frameHole\(active\.hole, active\.mode\)/);
  assert.match(resize, /active\?\.kind === 'flyover'\) flyoverHole\(active\.hole, active\.progress\)/);
});

test('leaving the editor restores normal rig limits before reframing the property', () => {
  const hide = sourceBetween(editorSource, 'function hide()', 'const pdHandler');
  const applyPose = sourceBetween(sceneSource, 'function applyCourseCameraPose', 'function frameCourse');
  const reframe = hide.indexOf('scene().frameCourse()');

  for (const limit of ['maxDist', 'maxPitch', 'minDist', 'minPitch']) {
    const restore = hide.indexOf(`rig.${limit} = camLimits.${limit}`);
    assert.ok(restore >= 0 && restore < reframe,
      `${limit} is restored before the overview pose is applied`);
  }
  assert.match(sceneSource, /maxOverviewDist:\s*rig\.maxDist/,
    'the restored maximum distance constrains the new overview pose');
  assert.match(applyPose, /rig\.pitch = clamp\(pose\.pitch, rig\.minPitch, rig\.maxPitch\)/);
  assert.match(applyPose, /rig\.dist = clamp\(pose\.dist, rig\.minDist, rig\.maxDist\)/);
  assert.match(applyPose, /rig\.clampTarget\(\)/);
});

test('editor selector exposes flyover progress and restores its captured preset', () => {
  const flyover = sourceBetween(editorSource, 'let flyover = null', '// ------------------------------------------------------------ playtest');

  assert.match(editorSource, /ui\.flyoverOpt\.disabled = true/);
  assert.match(editorSource, /ui\.flyoverOpt\.hidden = true/);
  assert.match(flyover, /beginCourseCameraFlyover\(hole, restoreView\)/);
  assert.match(flyover, /ui\.cameraSel\.value = FLYOVER_CAMERA_VIEW/);
  assert.match(flyover, /courseCameraFlyoverLabel\(flyover\)/);
  assert.match(flyover, /setCameraView\(restoreView, hole\)/,
    'natural, click, and Escape stops all restore the captured camera view');
});
