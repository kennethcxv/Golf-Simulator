import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  checkoutTexturePrewarmPlan,
} from '../src/render3d/clubhouse/simplifiedRegisterMode.js';

const modeSource = readFileSync(
  new URL('../src/render3d/clubhouse/simplifiedRegisterMode.js', import.meta.url),
  'utf8',
);

test('checkout texture prewarm prioritizes existing product textures and deduplicates by identity', () => {
  const itemAlbedo = { isTexture: true, name: 'item-albedo' };
  const sharedNormal = { isTexture: true, name: 'shared-normal' };
  const coinAlbedo = { isTexture: true, name: 'coin-albedo' };
  const invalid = { isTexture: false, name: 'not-a-texture' };

  const itemTextures = [itemAlbedo, sharedNormal, itemAlbedo, invalid, null];
  const coinTextures = [sharedNormal, coinAlbedo, coinAlbedo, undefined];
  const plan = checkoutTexturePrewarmPlan({ itemTextures, coinTextures });

  assert.deepEqual(plan.map(({ kind, texture }) => [kind, texture.name]), [
    ['item', 'item-albedo'],
    ['item', 'shared-normal'],
    ['coin', 'coin-albedo'],
  ]);
  assert.strictEqual(plan[0].texture, itemAlbedo);
  assert.strictEqual(plan[1].texture, sharedNormal);
  assert.strictEqual(plan[2].texture, coinAlbedo);
  assert.equal(itemTextures.length, 5, 'planning must not consume the caller collection');
  assert.equal(coinTextures.length, 4, 'planning must not consume the caller collection');
});

test('checkout texture prewarm accepts the Sets collected from live scene meshes', () => {
  const itemTexture = { isTexture: true };
  const coinTexture = { isTexture: true };
  const plan = checkoutTexturePrewarmPlan({
    itemTextures: new Set([itemTexture]),
    coinTextures: new Set([coinTexture, itemTexture]),
  });

  assert.deepEqual(plan, [
    { kind: 'item', texture: itemTexture },
    { kind: 'coin', texture: coinTexture },
  ]);
});

test('live scheduler uploads one existing texture per animation frame and cancels before disposal', () => {
  const scheduleStart = modeSource.indexOf('  function scheduleCheckoutTexturePrewarm() {');
  const scheduleEnd = modeSource.indexOf('\n  function layoutGoods()', scheduleStart);
  assert.ok(scheduleStart >= 0 && scheduleEnd > scheduleStart, 'prewarm scheduler must exist');
  const schedule = modeSource.slice(scheduleStart, scheduleEnd);

  assert.match(schedule, /checkoutTexturePrewarmPlan\(\{ itemTextures, coinTextures \}\)/);
  assert.match(schedule, /const warmNext = \(\) => \{/);
  assert.match(schedule, /token !== drawerPrewarmToken \|\| !tx/);
  assert.equal(schedule.match(/pending\.shift\(\)/g)?.length, 1);
  assert.equal(schedule.match(/renderer\.initTexture\(entry\.texture\)/g)?.length, 1);
  assert.match(schedule, /if \(pending\.length\) requestAnimationFrame\(warmNext\)/);
  assert.doesNotMatch(schedule, /\.clone\(/, 'prewarm must not clone models, materials, or textures');

  const clearStart = modeSource.indexOf('  function clearPhysicalTransaction(');
  const clearEnd = modeSource.indexOf('\n  function begin', clearStart);
  assert.ok(clearStart >= 0 && clearEnd > clearStart, 'transaction teardown must exist');
  const clear = modeSource.slice(clearStart, clearEnd);
  assert.ok(
    clear.indexOf('drawerPrewarmToken += 1') < clear.indexOf('itemResources.dispose(mesh)'),
    'teardown must invalidate queued frames before disposing item-owned resources',
  );
  assert.match(modeSource, /drawerPrewarmStatus: \(\) => \(\{ \.\.\.drawerPrewarm \}\)/);
});
