'use strict';

const path = require('node:path');
const { pathToFileURL } = require('node:url');

const SAVE_KEYS = new Set([
  'autosave', 'autosave-meta',
  'slot1', 'slot2', 'slot3',
  'slot1-meta', 'slot2-meta', 'slot3-meta',
]);
const MAX_SAVE_BYTES = 16 * 1024 * 1024;

function trustedRendererUrl(appRoot) {
  return pathToFileURL(path.join(appRoot, 'index.html')).href;
}

function isTrustedIpcEvent(event, expectedUrl) {
  const frame = event?.senderFrame;
  return !!frame && frame.url === expectedUrl && (!frame.top || frame.top === frame);
}

function assertTrustedIpcEvent(event, expectedUrl) {
  if (!isTrustedIpcEvent(event, expectedUrl)) throw new Error('Blocked IPC from an untrusted renderer');
}

function validateSaveKey(key) {
  const value = String(key);
  if (!SAVE_KEYS.has(value)) throw new Error(`Unsupported save key: ${value}`);
  return value;
}

function serializeSave(value) {
  const json = JSON.stringify(value);
  if (Buffer.byteLength(json, 'utf8') > MAX_SAVE_BYTES) throw new Error('Save exceeds the 16 MiB safety limit');
  return json;
}

module.exports = {
  MAX_SAVE_BYTES,
  SAVE_KEYS,
  assertTrustedIpcEvent,
  isTrustedIpcEvent,
  serializeSave,
  trustedRendererUrl,
  validateSaveKey,
};
