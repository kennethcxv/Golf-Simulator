// H1 (2026-08-05) — pressing `i` crashed the game with
//   ReferenceError: setMaintenanceVisible is not defined   (main.js:2296)
// because the identifier was called in the walk-mode key switch and defined
// nowhere: the panel factory was imported, the wiring that created it was lost.
//
// This test pins that fault CLASS, not just that one name: every bare
// identifier invoked inside main.js's keydown handlers must resolve to a
// module-scope definition or an import. The Electron sweep
// (tools/qa/keyboard-sweep.js) is the behavioural evidence; this is the cheap
// net that runs in every suite. The checker lives in
// tools/audit/key-handler-contract.mjs so the negative control can run it
// against the pre-fix source from the command line.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { undefinedCallees } from '../tools/audit/key-handler-contract.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(path.join(repo, 'src', 'main.js'), 'utf8');

test('the checker itself catches an undefined callee (self-test)', () => {
  const bad = `
    import { real } from './x.js';
    function known() {}
    window.addEventListener('keydown', (e) => {
      switch (e.key) {
        case 'i': setMaintenanceVisible(!panel?.isVisible()); break;
        case 'k': known(); real(); break;
      }
    });
  `;
  const { missing } = undefinedCallees(bad);
  assert.deepEqual(missing, ['setMaintenanceVisible'],
    'the self-test source calls exactly one undefined identifier and the checker must find it');
});

test('every bare call in main.js keydown handlers resolves to a definition or import', () => {
  const { missing, handlerCount } = undefinedCallees(source);
  assert.ok(handlerCount >= 1, `expected at least one keydown handler in main.js, found ${handlerCount}`);
  assert.deepEqual(missing, [],
    `keydown handlers call identifiers main.js never defines: ${missing.join(', ')} - `
    + 'this is the H1 fault class (a key that throws a live ReferenceError into the fault veil)');
});
