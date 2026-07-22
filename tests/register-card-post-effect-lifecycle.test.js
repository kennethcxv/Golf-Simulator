import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { createScopedBooleanOverride } from '../src/render3d/clubhouse/scopedBooleanOverride.js';

test('active-register entry disables GTAO and exit restores the exact enabled setting', () => {
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

test('an AO-off player setting stays off through register entry, recovery, and disposal', () => {
  let enabled = false;
  const scope = createScopedBooleanOverride({
    read: () => enabled,
    write: (value) => { enabled = value; },
  });

  scope.setActive(true);
  assert.equal(enabled, false);
  assert.equal(scope.restore(), true);
  assert.equal(enabled, false, 'the captured player setting is restored, not forced on');
  assert.equal(scope.restore(), false, 'recovery followed by disposal is idempotent');
  assert.equal(enabled, false);
});

test('the active-register scope reasserts through state transitions and captures each entry', () => {
  let enabled = true;
  const scope = createScopedBooleanOverride({
    read: () => enabled,
    write: (value) => { enabled = value; },
  });

  scope.setActive(true);
  for (const workspace of ['monitor', 'scan', 'card', 'cash', 'monitor']) {
    assert.equal(scope.state().held, true, `${workspace} keeps the entry scope held`);
    assert.equal(enabled, false, `${workspace} keeps GTAO bypassed`);
  }
  enabled = true; // model a renderer/settings refresh while the register is open
  scope.setActive(true); // the active update reasserts without recapturing
  assert.equal(enabled, false, 'active update reasserts the bypass');
  scope.restore();
  assert.equal(enabled, true);

  enabled = false;
  scope.setActive(true);
  scope.restore();
  assert.equal(enabled, false, 'the second entry restores its own newly captured setting');
});

test('a failed entry restores the captured setting before propagating the error', () => {
  let enabled = true;
  const scope = createScopedBooleanOverride({
    read: () => enabled,
    write: (value) => { enabled = value; },
  });
  let entered = false;

  assert.throws(() => {
    try {
      scope.setActive(true);
      assert.equal(enabled, false);
      throw new Error('synthetic entry failure');
    } finally {
      if (!entered) scope.restore();
    }
  }, /synthetic entry failure/);
  assert.equal(enabled, true);
  assert.deepEqual(scope.state(), { available: true, held: false, priorValue: undefined });
});

test('repeated active-register cycles capture and restore independently', () => {
  let enabled = true;
  const writes = [];
  const scope = createScopedBooleanOverride({
    read: () => enabled,
    write: (value) => { enabled = value; writes.push(value); },
  });

  for (const prior of [true, false, true]) {
    enabled = prior;
    assert.equal(scope.setActive(true), true);
    assert.equal(enabled, false);
    assert.equal(scope.restore(), true);
    assert.equal(enabled, prior);
  }
  assert.deepEqual(writes, [false, true, false, false, false, true]);
});

test('renderer-less clubhouse adapters remain a safe no-op', () => {
  const scope = createScopedBooleanOverride();
  assert.equal(scope.setActive(true), false);
  assert.equal(scope.restore(), false);
  assert.deepEqual(scope.state(), { available: false, held: false, priorValue: undefined });
});

test('register entry, transitions, recovery, and disposal share one GTAO lifecycle', () => {
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

  const assignWorkspaceSource = registerSource.slice(
    registerSource.indexOf('function assignWorkspace'),
    registerSource.indexOf('let selectedReservationId'),
  );
  const enterSource = registerSource.slice(
    registerSource.indexOf('function enter()'),
    registerSource.indexOf('function leave('),
  );
  const leaveSource = registerSource.slice(
    registerSource.indexOf('function leave('),
    registerSource.indexOf('function recoverInput('),
  );
  const updateSource = registerSource.slice(
    registerSource.indexOf('function update(dt)'),
    registerSource.indexOf('function hint()'),
  );

  assert.match(enterSource, /active = true;[^]*activeRegisterGtaoOverride\.setActive\(true\)/);
  assert.match(
    enterSource,
    /finally\s*\{\s*if \(!entered\)\s*\{\s*active = false;\s*activeRegisterGtaoOverride\.restore\(\)/,
  );
  assert.match(leaveSource, /activeRegisterGtaoOverride\.restore\(\)[^]*if \(!active\)/);
  assert.match(registerSource, /function setWorkspace\(next\)\s*\{\s*assignWorkspace\(next\)/);
  assert.doesNotMatch(assignWorkspaceSource, /GtaoOverride|postEffects/);
  assert.match(updateSource, /if \(active\) activeRegisterGtaoOverride\.setActive\(true\)/);
  assert.doesNotMatch(updateSource, /workspace === 'card'[^]*GtaoOverride/);
  assert.doesNotMatch(registerSource, /cardGtaoOverride/);
  assert.match(
    registerSource,
    /if \(resumeState === 'WaitingForCashier'\)\s*\{\s*leave\(\{ restorePointer: false \}\)/,
  );
  assert.match(clubhouseSource, /register\.leave\(\{ restorePointer: false \}\)/);
  assert.match(courseSource, /getGtaoEnabled:\s*\(\) => gtao\.enabled/);
  assert.match(courseSource, /setGtaoEnabled:\s*\(enabled\) => \{ gtao\.enabled = enabled; \}/);
});
