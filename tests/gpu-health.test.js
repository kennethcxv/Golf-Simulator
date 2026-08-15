// GPU HEALTH — a driver-level failure must be NAMED, not felt as lag.
//
// The owner played a whole session at "literally 3 fps" and every in-repo check
// said healthy, because the failed thing was his session's GPU process and
// nothing in the game watched for it. These pin the two observable forms:
// a context that boots in software, and a context lost mid-session.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isSoftwareRendererString, readGpuInfo, watchGpuHealth,
} from '../src/core/gpuHealth.js';

test('the software fallbacks are recognised, by every name Chromium uses', () => {
  for (const name of [
    'Google SwiftShader',
    'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)',
    'llvmpipe (LLVM 15.0.7, 256 bits)',
    'softpipe',
    'Microsoft Basic Render Driver',
    'Software Rasterizer',
  ]) {
    assert.equal(isSoftwareRendererString(name), true, name);
  }
});

test('control: real hardware strings are never called software', () => {
  for (const name of [
    // the owner's actual adapter, verbatim from the harness
    'ANGLE (NVIDIA, NVIDIA GeForce RTX 5080 (0x00002C02) Direct3D11 vs_5_0 ps_5_0, D3D11)',
    'ANGLE (AMD, AMD Radeon RX 7900 XTX Direct3D11 vs_5_0 ps_5_0, D3D11)',
    'ANGLE (Intel, Intel(R) UHD Graphics 770 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    'Apple M3 Max',
  ]) {
    assert.equal(isSoftwareRendererString(name), false, name);
  }
  assert.equal(isSoftwareRendererString(null), false);
  assert.equal(isSoftwareRendererString(''), false);
});

function fakeGl(renderer) {
  return {
    getExtension: () => ({ UNMASKED_RENDERER_WEBGL: 0x9246 }),
    getParameter: () => renderer,
    isContextLost: () => false,
  };
}

function fakeCanvas() {
  const listeners = new Map();
  return {
    addEventListener: (type, fn) => listeners.set(type, fn),
    removeEventListener: (type) => listeners.delete(type),
    fire: (type) => listeners.get(type)?.({ preventDefault: () => {} }),
    has: (type) => listeners.has(type),
  };
}

test('booting in software reports and notifies exactly once', () => {
  const reports = [];
  const notices = [];
  const canvas = fakeCanvas();
  watchGpuHealth({
    canvas,
    gl: fakeGl('Google SwiftShader'),
    report: (origin) => reports.push(origin),
    notify: (kind) => notices.push(kind),
  });
  assert.deepEqual(reports, ['gpu.software-rendering']);
  assert.deepEqual(notices, ['software']);
});

test('a lost context reports and notifies; a restore is logged quietly', () => {
  const reports = [];
  const notices = [];
  const canvas = fakeCanvas();
  watchGpuHealth({
    canvas,
    gl: fakeGl('ANGLE (NVIDIA, NVIDIA GeForce RTX 5080 Direct3D11, D3D11)'),
    report: (origin) => reports.push(origin),
    notify: (kind) => notices.push(kind),
  });
  assert.deepEqual(reports, [], 'a healthy boot must be silent');
  canvas.fire('webglcontextlost');
  canvas.fire('webglcontextlost'); // a flapping driver must not spam
  assert.deepEqual(reports, ['gpu.context-lost']);
  assert.deepEqual(notices, ['context-lost']);
  canvas.fire('webglcontextrestored');
  assert.deepEqual(reports, ['gpu.context-lost', 'gpu.context-restored']);
  assert.deepEqual(notices, ['context-lost'], 'a restore is not a player-facing event');
});

test('dispose detaches both listeners', () => {
  const canvas = fakeCanvas();
  const dispose = watchGpuHealth({ canvas, gl: fakeGl('hw'), report: () => {}, notify: () => {} });
  assert.equal(canvas.has('webglcontextlost'), true);
  dispose();
  assert.equal(canvas.has('webglcontextlost'), false);
  assert.equal(canvas.has('webglcontextrestored'), false);
});
