import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const DRIVER_URL = new URL(
  '../tools/qa/simplified-register-recovery-accessibility.mjs',
  import.meta.url,
);
const source = fs.readFileSync(DRIVER_URL, 'utf8');

test('recovery accessibility projection compares coherent pad and visible-product world bounds', async () => {
  const driver = await import(DRIVER_URL);
  assert.equal(typeof driver.runRecoveryAccessibilityAudit, 'function');
  assert.equal(typeof driver.resolveRecoveryAccessibilityOutput, 'function');
  assert.equal(typeof driver.resolveRecoveryAccessibilityLaunchConfig, 'function');

  assert.match(source, /interior\.updateWorldMatrix\(true, true\)/);
  assert.match(source, /camera\.updateWorldMatrix\(true, false\)/);
  assert.match(source, /object\.name === 'ItemClickPad'/);
  assert.match(source, /material && material\.visible !== false/);
  assert.match(source, /geometry\.boundingBox\.clone\(\)\.applyMatrix4\(object\.matrixWorld\)/);
  assert.match(source, /itemClickPad: itemClickPadDiagnostic/);
  assert.match(source, /visibleProduct: visibleProductDiagnostic/);
  assert.match(source, /padToVisibleCenterDistance:/);
});

test('recovery accessibility output can be isolated without removing prior evidence', async () => {
  const {
    resolveRecoveryAccessibilityLaunchConfig,
    resolveRecoveryAccessibilityOutput,
  } = await import(DRIVER_URL);
  assert.equal(
    resolveRecoveryAccessibilityOutput({ REGISTER_RECOVERY_ACCESSIBILITY_ROOT: 'qa/fresh-recovery' }),
    path.resolve('qa/fresh-recovery'),
  );
  assert.match(source, /REGISTER_RECOVERY_ACCESSIBILITY_ROOT/);

  const config = resolveRecoveryAccessibilityLaunchConfig({
    REGISTER_RECOVERY_ACCESSIBILITY_ROOT: "qa/O'Brien/recovery",
    VIDEO_DIR: 'qa/fresh-recovery/video',
    QA_BASE_URL: 'http://127.0.0.1:8457/',
    HEADED: '1',
  });
  assert.equal(config.videoDirectory, path.resolve('qa/fresh-recovery/video'));
  assert.equal(config.browserMode, 'headed');
  assert.match(config.command, /O''Brien/);
  assert.match(config.command, /\$env:VIDEO_DIR=/);
  assert.match(config.command, /\$env:QA_BASE_URL='http:\/\/127\.0\.0\.1:8457\/'/);
  const noVideo = resolveRecoveryAccessibilityLaunchConfig({});
  assert.equal(noVideo.videoDirectory, null);
  assert.doesNotMatch(noVideo.command, /VIDEO_DIR/);
});

test('recovery accessibility projection keeps the exact fixed-camera NDC gate', () => {
  assert.match(source, /ndc\.z >= -1 && ndc\.z <= 1/);
  assert.match(source, /Math\.abs\(ndc\.x\) <= 1 && Math\.abs\(ndc\.y\) <= 1/);
  assert.match(source, /assert\(point\?\.inView,/);
});

test('recovery accessibility evidence is finalized against one schema-v2 build bracket', () => {
  assert.match(source, /from '\.\/cashier-build-snapshot\.mjs';/);
  assert.match(source, /const productionBuildBefore = captureCashierBuildSnapshot\(\);/);
  assert.equal((source.match(/const productionBuildBefore = captureCashierBuildSnapshot\(\);/g) || []).length, 1);
  assert.equal((source.match(/finalizeCashierQaResult\(\{/g) || []).length, 2,
    'success and blocker results must both be finalized');
  assert.equal((source.match(/beforeSnapshot: productionBuildBefore/g) || []).length, 2);
  assert.match(source, /evidencePngs: evidence,/);
  assert.match(source, /evidencePngs: blockerEvidence,/);
  assert.equal((source.match(/evidenceRoot: out,/g) || []).length, 2);
  assert.match(source, /screenshot: blockerCaptured \? blocker : null/);
});

test('recovery exact-40 candidate frames remain in the finalized evidence inventory', () => {
  for (const label of [
    'paused-with-unbanked-checkout',
    'normal-card-decline-switch-choice',
    'automatic-exact-change-handoff-receipt',
    'automatic-exact-count-waits-for-done',
  ]) {
    assert.match(source, new RegExp(`await shot\\('${label}'\\)`), label);
  }
});
