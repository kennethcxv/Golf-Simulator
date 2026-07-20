import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  MAX_SAVE_BYTES,
  isTrustedIpcEvent,
  serializeSave,
  trustedRendererUrl,
  validateSaveKey,
} = require('../src/electron/security.cjs');

test('Electron IPC accepts only the top-level packaged index frame', () => {
  const trusted = trustedRendererUrl('C:/Games/Golf Empire');
  const frame = { url: trusted };
  frame.top = frame;
  assert.equal(isTrustedIpcEvent({ senderFrame: frame }, trusted), true);
  assert.equal(isTrustedIpcEvent({ senderFrame: { url: 'https://example.com/' } }, trusted), false);
  assert.equal(isTrustedIpcEvent({ senderFrame: { url: trusted, top: {} } }, trusted), false);
});

test('native persistence exposes only the game save slots', () => {
  for (const key of ['autosave', 'slot1', 'slot2', 'slot3', 'slot1-meta', 'slot2-meta', 'slot3-meta']) {
    assert.equal(validateSaveKey(key), key);
  }
  assert.throws(() => validateSaveKey('../../outside'), /Unsupported save key/);
  assert.throws(() => validateSaveKey('custom'), /Unsupported save key/);
});

test('native persistence rejects oversized renderer payloads', () => {
  assert.equal(serializeSave({ cash: 12 }), '{"cash":12}');
  assert.throws(() => serializeSave('x'.repeat(MAX_SAVE_BYTES + 1)), /16 MiB/);
});
