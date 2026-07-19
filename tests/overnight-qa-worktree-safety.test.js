import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const WORKTREE_SAFE_BROWSER_DRIVERS = Object.freeze([
  'tools/qa/boot-probe.js',
  'tools/qa/cleaning-tools-acceptance.js',
  'tools/qa/course-editor-production-qa.js',
  'tools/qa/course-shader-boot.js',
  'tools/qa/perf-probe.js',
  'tools/qa/pressure-washer-acceptance.js',
  'tools/qa/probe-save-reload.js',
  'tools/qa/register-acceptance-driver.mjs',
  'tools/qa/runtime-asset-residency.js',
]);

const sourceOf = (file) => fs.readFileSync(file, 'utf8');

test('integration-critical browser drivers honor the isolated server URL', () => {
  for (const file of WORKTREE_SAFE_BROWSER_DRIVERS) {
    const source = sourceOf(file);
    assert.match(source, /process\.env\.QA_BASE_URL/u, `${file} ignores QA_BASE_URL`);
    const hardcodedNavigations = [...source.matchAll(
      /page\.goto\(\s*['"]http:\/\/localhost:8457\//gu,
    )];
    assert.equal(hardcodedNavigations.length, 0,
      `${file} can silently navigate to another worktree's port 8457 server`);
  }
});

test('integration-critical evidence drivers never write to the original repository path', () => {
  for (const file of WORKTREE_SAFE_BROWSER_DRIVERS) {
    assert.doesNotMatch(
      sourceOf(file),
      /C:\/Users\/Kenneth\/Documents\/GitHub\/Golf-Flipper(?:\/|['"])/u,
      `${file} writes outside the active worktree`,
    );
  }
});

test('strict checkout acceptance derives its cashier stand from the live clubhouse transform', () => {
  const source = sourceOf('tools/qa/register-acceptance-driver.mjs');
  assert.match(source, /const\s+offset\s*=\s*app\.scene3d\.clubhouse\(\)\.interior\.position/u);
  assert.match(source, /walk\.x\s*=\s*offset\.x\s*\+\s*2\.80/u);
  assert.match(source, /walk\.z\s*=\s*offset\.z\s*\+\s*5\.35/u);
  assert.doesNotMatch(source, /walk\.x\s*=\s*2\.80\s*-\s*8/u);
  assert.doesNotMatch(source, /walk\.z\s*=\s*5\.35\s*\+\s*228/u);
});
