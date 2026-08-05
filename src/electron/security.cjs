'use strict';

const path = require('node:path');
const { pathToFileURL } = require('node:url');

// Scene-scoped test slices (e.g. ?scene=shed) divert every save to a prefixed
// key so a player's real records are untouchable from inside them. The bridge
// accepts exactly the base keys and their scoped variants — nothing else.
const SCENE_SCOPES = ['shed'];
const BASE_SAVE_KEYS = [
  'autosave', 'autosave-meta',
  // H2's rotated generation. First landed WITHOUT this entry: fw:save threw
  // "Unsupported save key", the renderer's rotation guard swallowed it, and
  // the rotation silently never happened — caught only because the verify
  // driver checks for the file on disk rather than trusting the code path.
  'autosave-prev',
  'slot1', 'slot2', 'slot3',
  'slot1-meta', 'slot2-meta', 'slot3-meta',
];
const SAVE_KEYS = new Set([
  ...BASE_SAVE_KEYS,
  ...SCENE_SCOPES.flatMap((scope) => BASE_SAVE_KEYS.map((key) => `${scope}-${key}`)),
]);
const MAX_SAVE_BYTES = 16 * 1024 * 1024;

function trustedRendererUrl(appRoot) {
  return pathToFileURL(path.join(appRoot, 'index.html')).href;
}

// Same document, any query/hash: the renderer navigates its own index.html
// with scene params (?scene=shed). Anything else — other files, protocols,
// hosts — stays untrusted.
function isTrustedRendererUrl(url, expectedUrl) {
  if (typeof url !== 'string' || !url) return false;
  let target;
  let trusted;
  try {
    target = new URL(url);
    trusted = new URL(expectedUrl);
  } catch {
    return false;
  }
  return target.protocol === trusted.protocol
    && target.host === trusted.host
    && target.pathname === trusted.pathname;
}

function isTrustedIpcEvent(event, expectedUrl) {
  const frame = event?.senderFrame;
  return !!frame && isTrustedRendererUrl(frame.url, expectedUrl) && (!frame.top || frame.top === frame);
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
  isTrustedRendererUrl,
  serializeSave,
  trustedRendererUrl,
  validateSaveKey,
};
