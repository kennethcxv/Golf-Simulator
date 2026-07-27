import assert from 'node:assert/strict';
import test from 'node:test';

import { createGateDefinitions } from '../tools/qa/run-integration-gates.mjs';

test('integration registry covers every requested overnight gate', () => {
  const gates = createGateDefinitions({ outputRoot: 'qa/test-gates', baseRef: 'base-sha' });
  const ids = new Set(gates.map((gate) => gate.id));
  for (const required of [
    'boot', 'console', 'shaders', 'editor-tools', 'editor-performance',
    'checkout-card', 'checkout-cash', 'assets-1-50', 'assets-51-100',
    'glb-clean-reimport', 'runtime-paths', 'cleaning-sockets', 'cleaning-occlusion',
    'cleaning-wetness', 'cleaning-debris', 'cleaning-runtime', 'save-reload',
    'resource-stabilization', 'resolution-fov', 'full-tests', 'branch-isolation',
    'performance-comparison',
  ]) assert.ok(ids.has(required), `missing integration gate ${required}`);
  assert.equal(ids.size, gates.length, 'gate IDs must be unique');
});

test('performance comparison requires an explicit immutable baseline report', () => {
  const blocked = createGateDefinitions({ outputRoot: 'qa/test-gates', baseRef: 'base-sha' })
    .find((gate) => gate.id === 'performance-comparison');
  assert.match(blocked.configurationError, /--performance-baseline/);
  const configured = createGateDefinitions({
    outputRoot: 'qa/test-gates',
    baseRef: 'base-sha',
    performanceBaseline: 'qa/base/result.json',
  }).find((gate) => gate.id === 'performance-comparison');
  assert.equal(configured.configurationError, null);
  assert.match(configured.steps[0].args.join(' '), /compare-performance-runs\.mjs/);
});

test('checkout gates use the strict physical acceptance drivers', () => {
  const gates = createGateDefinitions({ outputRoot: 'qa/test-gates', baseRef: 'base-sha' });
  const commandText = (id) => gates.find((gate) => gate.id === id).steps
    .flatMap((step) => step.args).join(' ');
  assert.match(commandText('checkout-card'), /register-acceptance-card\.js/);
  assert.match(commandText('checkout-cash'), /register-acceptance-cash\.js/);
  assert.doesNotMatch(commandText('checkout-card'), /simplified-register/);
  assert.doesNotMatch(commandText('checkout-cash'), /simplified-register/);
});

test('branch isolation fails configuration when no immutable base is supplied', () => {
  const gates = createGateDefinitions({ outputRoot: 'qa/test-gates' });
  const branch = gates.find((gate) => gate.id === 'branch-isolation');
  assert.match(branch.configurationError, /--base/);
  assert.deepEqual(branch.steps, []);
});

test('Blender gate resolves an executable or an explicit PATH fallback', () => {
  const gates = createGateDefinitions({ outputRoot: 'qa/test-gates', baseRef: 'base-sha' });
  const command = gates.find((gate) => gate.id === 'glb-clean-reimport').steps[0].command;
  assert.match(command.replaceAll('\\', '/'), /(?:\/blender\.exe|^blender)$/i);
});
