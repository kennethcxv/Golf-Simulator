import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  MAX_SAVE_BYTES,
  isTrustedIpcEvent,
  isTrustedRendererUrl,
  serializeSave,
  trustedRendererUrl,
  validateSaveKey,
} = require('../src/electron/security.cjs');

test('Electron IPC accepts only the top-level packaged index frame', () => {
  const trusted = trustedRendererUrl('C:/Games/Golf Empire');
  const frame = { url: trusted };
  frame.top = frame;
  assert.equal(isTrustedIpcEvent({ senderFrame: frame }, trusted), true);
  // A scene-scoped query on the SAME document stays trusted — ?scene=shed
  // saves flow through this exact gate.
  assert.equal(isTrustedIpcEvent({ senderFrame: { url: `${trusted}?scene=shed` } }, trusted), true);
  assert.equal(isTrustedIpcEvent({ senderFrame: { url: 'https://example.com/' } }, trusted), false);
  assert.equal(isTrustedIpcEvent({ senderFrame: { url: trusted, top: {} } }, trusted), false);
});

test('renderer-url trust is query-insensitive but path/protocol strict', () => {
  const trusted = trustedRendererUrl('C:/Games/Golf Empire');
  assert.equal(isTrustedRendererUrl(trusted, trusted), true);
  assert.equal(isTrustedRendererUrl(`${trusted}?scene=shed`, trusted), true);
  assert.equal(isTrustedRendererUrl(`${trusted}#frag`, trusted), true);
  assert.equal(isTrustedRendererUrl(trusted.replace('index.html', 'other.html'), trusted), false);
  assert.equal(isTrustedRendererUrl('https://example.com/index.html', trusted), false);
  assert.equal(isTrustedRendererUrl('not a url', trusted), false);
  assert.equal(isTrustedRendererUrl('', trusted), false);
});

test('native persistence exposes only the game save slots and their metadata records', () => {
  for (const key of [
    'autosave', 'autosave-meta',
    'slot1', 'slot2', 'slot3',
    'slot1-meta', 'slot2-meta', 'slot3-meta',
  ]) {
    assert.equal(validateSaveKey(key), key);
    // Scene-scoped variants divert test-scene saves away from player records.
    assert.equal(validateSaveKey(`shed-${key}`), `shed-${key}`);
  }
  assert.throws(() => validateSaveKey('../../outside'), /Unsupported save key/);
  assert.throws(() => validateSaveKey('custom'), /Unsupported save key/);
  assert.throws(() => validateSaveKey('lab-autosave'), /Unsupported save key/);
});

test('native persistence rejects oversized renderer payloads', () => {
  assert.equal(serializeSave({ cash: 12 }), '{"cash":12}');
  assert.throws(() => serializeSave('x'.repeat(MAX_SAVE_BYTES + 1)), /16 MiB/);
});

test('Electron main process registers one secured handler per native bridge channel', async () => {
  const source = await fs.readFile(new URL('../main.cjs', import.meta.url), 'utf8');
  assert.match(source, /require\('\.\/src\/electron\/security\.cjs'\)/);
  assert.ok(
    source.indexOf('trustedRendererUrl,') < source.indexOf('trustedRendererUrl(__dirname)'),
    'trustedRendererUrl must be imported before startup computes the trusted page URL',
  );
  for (const channel of [
    'fw:save', 'fw:load', 'fw:load-status', 'fw:load-record', 'fw:delete', 'fw:list',
    'fw:display-info', 'fw:set-window-mode', 'fw:set-resolution', 'fw:quit',
  ]) {
    const registrations = source.split(`ipcMain.handle('${channel}'`).length - 1;
    assert.equal(registrations, 1, `${channel} must be registered exactly once`);
  }
  assert.doesNotMatch(source, /function keyToBackupFile/);
});
