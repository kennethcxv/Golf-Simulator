import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { createScopedBooleanOverride } from '../src/render3d/clubhouse/scopedBooleanOverride.js';

test('card-scoped override restores the exact enabled setting after a workspace transition', () => {
  let enabled = true;
  const writes = [];
  const scope = createScopedBooleanOverride({
    read: () => enabled,
    write: (value) => { enabled = value; writes.push(value); },
  });

  assert.equal(scope.setActive(true), true);
  assert.equal(enabled, false);
  assert.deepEqual(scope.state(), { available: true, held: true, priorValue: true });
  assert.equal(scope.setActive(false), true);
  assert.equal(enabled, true);
  assert.deepEqual(writes, [false, true]);
});

test('an AO-off player setting stays off through card entry, leave, and repeated teardown', () => {
  let enabled = false;
  const scope = createScopedBooleanOverride({
    read: () => enabled,
    write: (value) => { enabled = value; },
  });

  scope.setActive(true);
  assert.equal(enabled, false);
  assert.equal(scope.restore(), true);
  assert.equal(enabled, false, 'the captured player setting is restored, not forced on');
  assert.equal(scope.restore(), false, 'teardown restoration is idempotent');
  assert.equal(enabled, false);
});

test('the card scope reasserts its override and captures a fresh setting each entry', () => {
  let enabled = true;
  const scope = createScopedBooleanOverride({
    read: () => enabled,
    write: (value) => { enabled = value; },
  });

  scope.setActive(true);
  enabled = true; // model a settings refresh while the card workspace is open
  scope.setActive(true);
  assert.equal(enabled, false);
  scope.restore();
  assert.equal(enabled, true);

  enabled = false;
  scope.setActive(true);
  scope.restore();
  assert.equal(enabled, false, 'the second entry restores its own newly captured setting');
});

test('renderer-less clubhouse adapters remain a safe no-op', () => {
  const scope = createScopedBooleanOverride();
  assert.equal(scope.setActive(true), false);
  assert.equal(scope.restore(), false);
  assert.deepEqual(scope.state(), { available: false, held: false, priorValue: undefined });
});

test('register transitions and clubhouse teardown are wired to the scoped GTAO lifecycle', () => {
  const registerSource = fs.readFileSync(
    new URL('../src/render3d/clubhouse/simplifiedRegisterMode.js', import.meta.url),
    'utf8',
  );
  const clubhouseSource = fs.readFileSync(
    new URL('../src/render3d/clubhouse.js', import.meta.url),
    'utf8',
  );
  const courseSource = fs.readFileSync(
    new URL('../src/render3d/courseScene.js', import.meta.url),
    'utf8',
  );

  assert.match(registerSource, /cardGtaoOverride\.setActive\(active && next === 'card'\)/);
  assert.match(registerSource, /function leave\([^]*?cardGtaoOverride\.restore\(\)/);
  assert.match(registerSource, /function setWorkspace\(next\)\s*\{\s*assignWorkspace\(next\)/);
  assert.match(registerSource, /if \(active && workspace === 'card'\) cardGtaoOverride\.setActive\(true\)/);
  assert.match(clubhouseSource, /register\.leave\(\{ restorePointer: false \}\)/);
  assert.match(courseSource, /getGtaoEnabled:\s*\(\) => gtao\.enabled/);
  assert.match(courseSource, /setGtaoEnabled:\s*\(enabled\) => \{ gtao\.enabled = enabled; \}/);
});
