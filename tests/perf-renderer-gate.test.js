import assert from 'node:assert/strict';
import test from 'node:test';

import { gateRenderer } from '../tools/qa/perf-renderer-gate.mjs';

const pageWithGpu = (gpu) => ({ evaluate: async () => gpu });
const hardwareFeatures = { gpu_compositing: 'enabled', webgl: 'enabled', webgl2: 'enabled' };

test('renderer gate fails closed for missing, masked, and software WebGL identities', async () => {
  for (const gpu of ['', 'no-context', 'masked', 'unknown', 'SwiftShader Device']) {
    await assert.rejects(
      gateRenderer(pageWithGpu(gpu), {
        electronGpuFeatureStatus: hardwareFeatures,
        requireElectronStatus: true,
      }),
      /performance run refused/,
    );
  }
});

test('renderer gate requires independent Electron compositor and WebGL hardware status', async () => {
  await assert.rejects(
    gateRenderer(pageWithGpu('NVIDIA GeForce RTX'), { requireElectronStatus: true }),
    /Electron GPU feature status is unavailable/,
  );
  await assert.rejects(
    gateRenderer(pageWithGpu('NVIDIA GeForce RTX'), {
      requireElectronStatus: true,
      electronGpuFeatureStatus: { ...hardwareFeatures, gpu_compositing: 'disabled_software' },
    }),
    /gpu_compositing=disabled_software/,
  );
});

test('renderer gate records both positively identified WebGL and Electron evidence', async () => {
  const result = await gateRenderer(pageWithGpu('NVIDIA GeForce RTX 5090'), {
    requireElectronStatus: true,
    electronGpuFeatureStatus: hardwareFeatures,
  });
  assert.equal(result.software, false);
  assert.equal(result.positivelyIdentified, true);
  assert.equal(result.electronHardwareFeaturesProven, true);
  assert.deepEqual(result.electronGpuFeatureStatus, hardwareFeatures);
});
