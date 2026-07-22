import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../main.cjs', import.meta.url), 'utf8');

test('Electron bootstrap owns one trusted handler for every native channel', () => {
  assert.match(source, /require\('\.\/src\/electron\/security\.cjs'\)/);
  assert.match(source, /const TRUSTED_RENDERER_URL = trustedRendererUrl\(__dirname\)/);
  assert.match(source, /assertTrustedIpcEvent\(event, TRUSTED_RENDERER_URL\)/);
  assert.doesNotMatch(source, /ipcMain\.handle\('fw:/,
    'native channels must use the common trusted-renderer wrapper');

  const channels = [
    'save', 'load', 'load-status', 'load-record', 'delete', 'list',
    'display-info', 'set-window-mode', 'set-resolution', 'quit',
  ];
  for (const channel of channels) {
    const matches = source.match(new RegExp(`handleTrusted\\('fw:${channel.replace('-', '\\-')}'`, 'g')) || [];
    assert.equal(matches.length, 1, `fw:${channel} must be registered exactly once`);
  }
});

test('Electron persistence keeps one crash-safe store and renderer payload guard', () => {
  assert.match(source, /createNativeSaveStore/);
  assert.match(source, /serializeSave\(value\)/);
  assert.match(source, /validateSaveKey\(key\)/);
  assert.doesNotMatch(source, /function keyToBackupFile|function loadRecord/,
    'legacy file persistence cannot remain registered beside the native store');
});
