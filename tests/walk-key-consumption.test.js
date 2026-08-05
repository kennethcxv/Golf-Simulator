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
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const courseScene = read('../src/render3d/courseScene.js');
const mainJs = read('../src/main.js');

// The literal set, parsed from source. courseScene is a single 11k-line closure with no
// export for this, and reading the array is honest: it is the same text the runtime uses.
const consumedKeys = (() => {
  const match = courseScene.match(/const WALK_CONSUMED_KEYS = new Set\(\[([\s\S]*?)\]\);/);
  assert.ok(match, 'WALK_CONSUMED_KEYS not found in courseScene.js');
  return new Set([...match[1].matchAll(/'((?:[^'\\]|\\.)*)'/g)].map((m) => m[1].replace(/\\'/g, "'")));
})();

test('the movement keys are consumed', () => {
  for (const key of ['w', 'a', 's', 'd', 'shift', ' ', 'tab']) {
    assert.ok(consumedKeys.has(key), `${JSON.stringify(key)} must be swallowed while pointer-locked`);
  }
  for (const key of ['arrowup', 'arrowdown', 'arrowleft', 'arrowright']) {
    assert.ok(consumedKeys.has(key), `${key} must be swallowed while pointer-locked`);
  }
});

test('X is consumed - the reported bug', () => {
  // Win+X opens the Windows Quick Link menu, Ctrl+X cuts. Neither belongs to a player
  // opening a box. preventDefault cannot stop the OS-level chord, but leaving the key
  // unclaimed by the page is a defect in its own right.
  assert.ok(consumedKeys.has('x'), 'X is the secondary-interact verb and must be swallowed');
});

test('every single-letter verb main.js binds in the walk branch is consumed', () => {
  // The rule, stated as a test rather than as a comment: if the game acts on a key while
  // the player is in the world, the page claims it. Derived from main.js's own switch so a
  // new verb added there without adding it here is caught.
  const walkBranch = mainJs.slice(
    mainJs.indexOf('// first-person course: E is the interaction verb'),
    mainJs.indexOf('// --- main loop ---'),
  );
  assert.ok(walkBranch.length > 500, 'could not locate the walk-mode key switch in main.js');
  const verbs = new Set(
    [...walkBranch.matchAll(/case '([a-z])': case '[A-Z]':/g)].map((m) => m[1]),
  );
  assert.ok(verbs.size >= 8, `expected the walk switch to bind several letters, found ${verbs.size}`);
  const unclaimed = [...verbs].filter((key) => !consumedKeys.has(key)).sort();
  assert.deepEqual(
    unclaimed, [],
    `main.js acts on these in walk mode but the page never claims them: ${unclaimed.join(', ')}`,
  );
});

test('Escape and the F-keys are deliberately NOT consumed', () => {
  // The player must always be able to break out, and Escape is what releases the lock.
  for (const key of ['escape', 'f1', 'f5', 'f11', 'f12']) {
    assert.equal(consumedKeys.has(key), false, `${key} must stay available as an escape hatch`);
  }
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
  const preventAt = downHandler.indexOf('WALK_CONSUMED_KEYS.has(key)) e.preventDefault()');
  assert.ok(filterAt > 0, 'the text-entry filter is missing from walkKeyDown');
  assert.ok(preventAt > 0, 'the preventDefault gate is missing from walkKeyDown');
  assert.ok(filterAt < preventAt, 'the text-entry filter must run BEFORE the swallow');
  assert.match(
    downHandler,
    /document\.pointerLockElement === canvas && WALK_CONSUMED_KEYS\.has\(key\)\) e\.preventDefault\(\)/,
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
    courseScene.indexOf("if (walkHeld.has('w')) mz -= 1;"),
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
  assert.match(mainJs, /if \(devSessionActive\(\)\) \{\s*\n\s*import\('\.\/debug\/inputProbe\.js'\)/);
});
