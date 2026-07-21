import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, snapshot } from '../src/sim/state.js';
import {
  CLEANING_CAPACITY, ensureCleaningToolState, addToPan, addToBag, emptyPanIntoBag,
  tieBag, disposeTiedBag, serviceMop, changeBucketWater, consumeMopCharge,
} from '../src/sim/cleaningToolState.js';
import { debrisState, ensureDebris, collectAt } from '../src/sim/cleaningDebris.js';

const reload = (state) => JSON.parse(JSON.stringify(snapshot(state)));

test('legacy numeric pan and bag loads migrate without loss', () => {
  const state = newGame('relaxed', 91);
  delete state.shop.reno.cleaning;
  state.shop.reno.pan = 0.7;
  state.shop.reno.bag = 2.4;
  const c = ensureCleaningToolState(state);
  assert.equal(c.pan.load, 0.7);
  assert.equal(c.bag.load, 2.4);
  assert.equal(state.shop.reno.pan, 0.7);
  assert.equal(state.shop.reno.bag, 2.4);
});

test('dustpan capacity leaves excess debris on the floor', () => {
  const state = newGame('relaxed', 92);
  ensureDebris(state);
  debrisState(state).length = 0;
  debrisState(state).push({ x: 0, z: 0, a: 2.5 });
  const room = CLEANING_CAPACITY.pan;
  const got = collectAt(state, 0, 0, 0.7, room);
  const stored = addToPan(state, got);
  assert.equal(stored.accepted, CLEANING_CAPACITY.pan);
  assert.equal(debrisState(state).length, 1);
  assert.equal(debrisState(state)[0].a, 0.7);
});

test('pan-to-bag transfer conserves material when the bag fills', () => {
  const state = newGame('relaxed', 93);
  const c = ensureCleaningToolState(state);
  c.pan.load = 1.8;
  c.bag.load = 7.0;
  const result = emptyPanIntoBag(state);
  assert.equal(result.moved, 0.5);
  assert.equal(result.left, 1.3);
  assert.equal(c.bag.load, 7.5);
  assert.equal(c.pan.load + c.bag.load, 8.8);
});

test('a bag must contain waste and be tied before disposal', () => {
  const state = newGame('relaxed', 94);
  assert.equal(tieBag(state).reason, 'bag-empty');
  addToBag(state, 1.25);
  assert.equal(disposeTiedBag(state).reason, 'not-tied');
  assert.equal(tieBag(state).ok, true);
  const result = disposeTiedBag(state);
  assert.equal(result.disposed, 1.25);
  const c = ensureCleaningToolState(state);
  assert.equal(c.bag.load, 0);
  assert.equal(c.bag.disposed, 1);
  assert.equal(c.bag.disposedLoad, 1.25);
});

test('mop cannot work dry, is serviced in one action, and bucket can be refreshed', () => {
  const state = newGame('relaxed', 95);
  assert.equal(consumeMopCharge(state, 1).dry, true);
  const service = serviceMop(state);
  assert.equal(service.ok, true);
  assert.ok(service.charge >= 20, 'one wring should support a useful cleaning run');
  assert.equal(consumeMopCharge(state, 1).used, 1);
  const c = ensureCleaningToolState(state);
  c.bucket.level = 0;
  c.bucket.water = 'empty';
  assert.equal(serviceMop(state).reason, 'bucket-empty');
  assert.equal(changeBucketWater(state).ok, true);
  assert.equal(c.bucket.water, 'clean');
  assert.equal(c.bucket.level, 1);
});

test('mid-task lifecycle survives save and healer round trips', () => {
  const state = newGame('relaxed', 96);
  addToPan(state, 0.65);
  addToBag(state, 2.1);
  serviceMop(state);
  consumeMopCharge(state, 3.25);
  const before = structuredClone(ensureCleaningToolState(state));
  const back = reload(state);
  const after = ensureCleaningToolState(back);
  assert.deepEqual(after, before);
  assert.equal(back.shop.reno.pan, after.pan.load);
  assert.equal(back.shop.reno.bag, after.bag.load);
});

test('healer clamps corrupt loads and repairs partial objects', () => {
  const state = { shop: { reno: { pan: -5, bag: 999, cleaning: {
    pan: { load: NaN }, bag: { load: Infinity, tied: 'yes' },
    mop: { charge: 999 }, bucket: { level: -1, soil: 9 },
  } } } };
  const c = ensureCleaningToolState(state);
  assert.equal(c.pan.load, 0);
  assert.equal(c.bag.load, CLEANING_CAPACITY.bag);
  assert.equal(c.mop.charge, CLEANING_CAPACITY.mopCharge);
  assert.equal(c.bucket.level, 0);
  assert.equal(c.bucket.water, 'empty');
});
