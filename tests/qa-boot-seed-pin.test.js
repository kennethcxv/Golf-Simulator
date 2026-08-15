import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { installPinnedNewGameSeed } from '../tools/qa/lib/qa-boot.mjs';

function targetWithRandom(value = 0.731) {
  const calls = [];
  const original = function originalRandom(...args) {
    calls.push({ receiver: this, args });
    return value;
  };
  return {
    calls,
    original,
    target: { Math: { random: original } },
  };
}

test('seed gate delegates unrelated randomness then restores inside the exact onNewGame draw', () => {
  const fixture = targetWithRandom();
  let stack = 'Error\n    at modalTitle (file:///C:/game/src/ui/ui.js:304:22)';
  const evidence = installPinnedNewGameSeed({
    seed: 0.4242,
    target: fixture.target,
    captureStack: () => stack,
  });

  assert.equal(fixture.target.Math.random('modal'), 0.731);
  assert.equal(evidence.delegatedCalls, 1);
  assert.equal(evidence.consumed, false);
  assert.equal(evidence.armed, true);

  stack = 'Error\n    at Object.onNewGame (file:///C:/game/src/main.js:4154:48)';
  assert.equal(fixture.target.Math.random(), 0.4242);
  assert.equal(evidence.consumed, true);
  assert.equal(evidence.restored, true);
  assert.equal(evidence.armed, false);
  assert.equal(evidence.restoreReason, 'seed-consumed');
  assert.match(evidence.matchedFrame, /Object\.onNewGame/);
  assert.equal(fixture.target.Math.random, fixture.original);
  assert.equal('__qaRestoreRandom' in fixture.target, false);

  assert.equal(fixture.target.Math.random('runtime'), 0.731);
  assert.equal(fixture.calls.length, 2);
  assert.deepEqual(fixture.calls.map((entry) => entry.args), [['modal'], ['runtime']]);
});

test('seed gate requires the onNewGame function and src/main.js on the same frame', () => {
  const fixture = targetWithRandom(0.25);
  let stack = 'Error\n    at Object.onNewGame (file:///C:/game/src/ui/ui.js:10:2)';
  const evidence = installPinnedNewGameSeed({
    seed: 0.5,
    target: fixture.target,
    captureStack: () => stack,
  });

  assert.equal(fixture.target.Math.random(), 0.25);
  stack = 'Error\n    at boot (file:///C:/game/src/main.js:4154:48)';
  assert.equal(fixture.target.Math.random(), 0.25);
  stack = 'Error\n    at onNewGame (C:\\game\\src\\main.js:4154:48)';
  assert.equal(fixture.target.Math.random(), 0.5);
  assert.equal(evidence.delegatedCalls, 2);
  assert.equal(evidence.restored, true);
});

test('manual cleanup restores an unmatched gate and records why', () => {
  const fixture = targetWithRandom();
  const evidence = installPinnedNewGameSeed({
    seed: 0.1,
    target: fixture.target,
    captureStack: () => 'Error\n    at audioVariation (file:///C:/game/src/audio.js:4:2)',
  });

  assert.equal(fixture.target.__qaRestoreRandom(), true);
  assert.equal(fixture.target.Math.random, fixture.original);
  assert.equal(evidence.consumed, false);
  assert.equal(evidence.restored, true);
  assert.equal(evidence.restoreReason, 'manual-cleanup');
});

test('seed gate rejects invalid values and a nested live installation', () => {
  for (const seed of [Number.NaN, Number.POSITIVE_INFINITY, -0.01, 1]) {
    assert.throws(() => installPinnedNewGameSeed({
      seed,
      target: targetWithRandom().target,
    }), /finite number in \[0, 1\)/);
  }

  const fixture = targetWithRandom();
  installPinnedNewGameSeed({ seed: 0.2, target: fixture.target });
  assert.throws(
    () => installPinnedNewGameSeed({ seed: 0.3, target: fixture.target }),
    /already armed/,
  );
  fixture.target.__qaRestoreRandom();
});

test('installer remains self-contained when serialized like Playwright page.evaluate', () => {
  const reconstructed = Function(`"use strict"; return (${installPinnedNewGameSeed.toString()});`)();
  const fixture = targetWithRandom();
  const evidence = reconstructed({
    seed: 0.333,
    target: fixture.target,
    captureStack: () => 'Error\n    at onNewGame (https://game.test/src/main.js:4154:48)',
  });
  assert.equal(fixture.target.Math.random(), 0.333);
  assert.equal(evidence.restored, true);
});

test('menu boot arms after New Game UI and validates restoration with failure cleanup', () => {
  const source = fs.readFileSync('tools/qa/lib/qa-boot.mjs', 'utf8');
  const newGameClick = source.indexOf("getByRole('button', { name: /New game/i }).click()");
  const install = source.indexOf('page.evaluate(installPinnedNewGameSeed');
  const difficultyClick = source.indexOf("page.locator('.difficulty-card')");
  assert.ok(newGameClick >= 0 && newGameClick < install);
  assert.ok(install < difficultyClick);
  assert.match(source, /result\?\.consumed && result\?\.restored/);
  assert.match(source, /catch \(error\)[\s\S]*window\.__qaRestoreRandom\?\.\(\)/);
});

test('production onNewGame keeps the pinned seed draw as its first random call', () => {
  const source = fs.readFileSync('src/main.js', 'utf8');
  const match = source.match(
    /async onNewGame\(mode\) \{([\s\S]*?)\r?\n\s*\},\r?\n\s*async onContinue/,
  );
  assert.ok(match, 'production onNewGame body must remain discoverable');
  const randomCalls = [...match[1].matchAll(/Math\.random\s*\(/g)];
  assert.equal(randomCalls.length, 1, 'onNewGame must have one deterministic seed draw');
  const seedAssignment = match[1].indexOf('app.empire = newStarterEmpire');
  assert.ok(seedAssignment >= 0 && randomCalls[0].index > seedAssignment);
});
