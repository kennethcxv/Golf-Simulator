// EVERY KEY THE GAME ACTS ON IN WALK MODE MUST BE SWALLOWED WHILE POINTER-LOCKED.
//
// Measured 2026-07-29 (Designs/ProShop/Greybox/data/six-key-cases-chromium.json): X — the
// secondary-interact verb, the key that opens a delivery box — reached the walk listener
// with preventDefault never called, while D and W were swallowed correctly. A key the game
// consumes and the page also releases to the browser is a key doing two things at once,
// which is how "X opens the Windows Quick Link menu" ends up in a bug report about boxes.
//
// The set was the movement half of the rule only. These tests pin the whole rule, and pin
// the three exclusions that are deliberate.
// N2/F2 ported this pin: the consumed set is no longer one static array but
// WALK_CONSUMED_LITERALS plus every key the LIVE binding table claims
// (walkConsumesKey). The rule it protects is unchanged - a key the game acts
// on in walk mode is a key the page swallows - and now it must hold for
// whatever the player rebinds to, not only the shipped letters.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BINDABLE_ACTIONS, DEFAULT_BINDINGS, isBindableKey } from '../src/core/keyBindings.js';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const courseScene = read('../src/render3d/courseScene.js');
const mainJs = read('../src/main.js');

// The literal half, parsed from source; the dynamic half is DEFAULT_BINDINGS,
// imported from the same module the runtime resolves through.
const literalKeys = (() => {
  const match = courseScene.match(/const WALK_CONSUMED_LITERALS = new Set\(\[([\s\S]*?)\]\);/);
  assert.ok(match, 'WALK_CONSUMED_LITERALS not found in courseScene.js');
  return new Set([...match[1].matchAll(/'((?:[^'\\]|\\.)*)'/g)].map((m) => m[1].replace(/\\'/g, "'")));
})();
const consumedByDefault = new Set([
  ...literalKeys,
  ...BINDABLE_ACTIONS.map((action) => DEFAULT_BINDINGS[action.id]),
]);

test('every key of the pre-rebinding contract is still consumed on defaults', () => {
  for (const key of ['w', 'a', 's', 'd', 'shift', ' ', 'tab',
    'arrowup', 'arrowdown', 'arrowleft', 'arrowright',
    'e', 'q', 'r', 'f', 'x', 'b', 'j', 'l', 'i', 'g', 'c', 'm', 'v', 'z']) {
    const canonical = key === ' ' ? ' ' : key;
    assert.ok(
      consumedByDefault.has(canonical) || literalKeys.has(canonical),
      `${JSON.stringify(key)} must be swallowed while pointer-locked`,
    );
  }
});

test('the consumed set follows the LIVE bindings, not the shipped letters', () => {
  // walkConsumesKey must consult the binding table per press, so a verb
  // rebound to any key drags the swallow with it.
  assert.match(courseScene, /function walkConsumesKey\(key\)/);
  assert.match(courseScene, /walkHooks\.bindings \? walkHooks\.bindings\(\) : DEFAULT_BINDINGS/);
  assert.match(courseScene, /for \(const action of BINDABLE_ACTIONS\)/);
});

test('literal mode keys main.js still binds raw are in the literal set', () => {
  // b (build), i (maintenance), g/c/m (panels) stay un-rebindable and must
  // remain claimed by the page.
  for (const key of ['b', 'i', 'g', 'c', 'm']) {
    assert.ok(literalKeys.has(key), `${key} is a literal walk verb and must be swallowed`);
  }
});

test('Escape and the F-keys are deliberately NOT consumed and NOT bindable', () => {
  // The player must always be able to break out, and Escape is what releases the lock.
  for (const key of ['escape', 'f11', 'f12']) {
    assert.equal(literalKeys.has(key), false, `${key} must stay available as an escape hatch`);
    assert.equal(isBindableKey(key), false, `${key} must be refused by the binding table`);
  }
  assert.equal(literalKeys.has('f1'), false);
  assert.equal(literalKeys.has('f5'), false);
});

test('the swallow runs only while pointer-locked, and only after the text-entry filter', () => {
  // Both orderings matter. Gated on the lock, because a player in a menu still needs
  // browser shortcuts; after isTextEntryTarget, because otherwise claiming 'c' and 'v'
  // would break copy and paste in the laptop search box and the save-name field.
  const downHandler = courseScene.slice(
    courseScene.indexOf('function walkKeyDown(e) {'),
    courseScene.indexOf('function walkKeyUp(e) {'),
  );
  const filterAt = downHandler.indexOf('isTextEntryTarget(e.target)');
  const preventAt = downHandler.indexOf('walkConsumesKey(key)) e.preventDefault()');
  assert.ok(filterAt > 0, 'the text-entry filter is missing from walkKeyDown');
  assert.ok(preventAt > 0, 'the preventDefault gate is missing from walkKeyDown');
  assert.ok(filterAt < preventAt, 'the text-entry filter must run BEFORE the swallow');
  assert.match(
    downHandler,
    /document\.pointerLockElement === canvas && walkConsumesKey\(key\)\) e\.preventDefault\(\)/,
  );
});

// --- the movement-intent instrument ------------------------------------------------

test('the movement block reports its intent, so a probe can tell three cases apart', () => {
  // Position delta reads identically for "the key never arrived" and "the key arrived and a
  // collider was in the way". The counter sits inside the movement block, before collision
  // has an opinion, and is the only observation point outside code cannot reach.
  assert.match(courseScene, /if \(walkMoveIntent\.recording\) \{/);
  assert.match(courseScene, /walkMoveIntent\.movingFrames \+= 1;/);
  assert.match(courseScene, /moveIntent: \{\s*\n\s*begin\(\) \{/);
  // Off unless a driver asks. A diagnostic that always counts is a diagnostic on the frame
  // path.
  assert.match(courseScene, /const walkMoveIntent = \{\s*\n\s*recording: false,/);
  // And it must be recorded from the pre-collision intent, not from the post-move position.
  const block = courseScene.slice(
    courseScene.indexOf("if (heldAction('moveForward')) mz -= 1;"),
    courseScene.indexOf('walkRecover(dtMs, px0, pz0);'),
  );
  const intentAt = block.indexOf('walkMoveIntent.recording');
  const moveAt = block.indexOf('walkTryMove(');
  assert.ok(intentAt > 0 && moveAt > 0);
  assert.ok(intentAt < moveAt, 'intent must be recorded before walkTryMove can be blocked');
});

// --- the shared probe --------------------------------------------------------------

test('the six cases are shared, so the browser and Electron drivers measure one thing', () => {
  // Two copies of an instrument are two instruments, and the whole point of the pair of
  // drivers is a browser-versus-desktop comparison.
  const probe = read('../src/debug/inputProbe.js');
  assert.match(probe, /export const SIX_KEY_CASES/);
  for (const label of ['D alone', 'Shift+D', 'W alone', 'Shift+W', 'X alone', 'Shift+X']) {
    assert.ok(probe.includes(`'${label}'`), `${label} is missing from SIX_KEY_CASES`);
  }
  // Nothing in the probe may dispatch a key: a page-made KeyboardEvent has no OS keyboard
  // behind it and cannot be eaten by a shell accelerator, which is the failure mode that
  // let two earlier D-key harnesses pass a broken D.
  assert.doesNotMatch(probe, /new KeyboardEvent|dispatchEvent/);
  // The held set must be sampled while the key is down; reading it after keyup reports
  // every correct press as "never recorded".
  assert.match(probe, /function sample\(\)/);
  assert.match(probe, /heldDuringPress/);
  for (const driver of ['../tools/qa/walk-six-key-cases.js', '../tools/qa/electron-six-key-cases.mjs']) {
    const text = read(driver);
    assert.match(text, /inputProbe\.sample\(\)/, `${driver} must sample while the key is held`);
    assert.match(text, /e\.code === r\.expectedCode/, `${driver} must select the keydown by code`);
  }
});

test('the probe is a development surface and is never loaded otherwise', () => {
  // The import is base-anchored (Goal 28 P1: bundle-safe dynamic import) but
  // the contract is unchanged: inputProbe is imported in exactly one place,
  // dynamically, directly inside the devSessionActive() gate.
  assert.match(
    mainJs,
    /if \(devSessionActive\(\)\) \{\s*\n\s*import\([^)]*['"]src\/debug\/inputProbe\.js['"][^)]*\)/,
  );
  const importSites = mainJs.match(/inputProbe\.js/g) || [];
  assert.equal(importSites.length, 1, 'inputProbe.js must be referenced from exactly one import site');
});
