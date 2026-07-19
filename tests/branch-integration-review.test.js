import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyChangedPath,
  requiredGatesForChanges,
} from '../tools/qa/compare-integration-branch.mjs';

test('branch classifier identifies production risk domains without tagging QA-only files as runtime', () => {
  assert.deepEqual(classifyChangedPath('src/sim/save.js'), ['runtime', 'save']);
  assert.deepEqual(classifyChangedPath('src/world/registerCheckout.js'), ['checkout', 'runtime']);
  assert.deepEqual(classifyChangedPath('vendor/models/register.glb'), ['asset', 'checkout']);
  assert.deepEqual(classifyChangedPath('tools/qa/register-acceptance-driver.mjs'), ['checkout', 'qa']);
  assert.deepEqual(classifyChangedPath('docs/overnight/integration-gates.md'), ['docs']);
});
test('branch gate selection expands only for affected production domains', () => {
  const gates = requiredGatesForChanges([
    { path: 'src/world/cleaning.js', tags: classifyChangedPath('src/world/cleaning.js') },
    { path: 'vendor/models/counter.glb', tags: classifyChangedPath('vendor/models/counter.glb') },
  ]);
  for (const required of [
    'asset-manifests', 'boot', 'branch-isolation', 'cleaning-runtime', 'console',
    'full-tests', 'glb-clean-reimport', 'performance', 'resolution-fov',
    'runtime-paths', 'save-reload',
  ]) assert.ok(gates.includes(required), `missing ${required}`);
  assert.equal(gates.includes('checkout-card'), false);
});
