import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  addToPan,
  disposeTiedBag,
  emptyPanIntoBag,
  ensureCleaningToolState,
  tieBag,
} from '../src/sim/cleaningToolState.js';

// The cleaning-bay disposal point once wrote the legacy reno.pan/reno.bag
// mirrors directly. ensureCleaningToolState rewrites those mirrors from the
// structured authority every sync, so the E press showed its toast while the
// pan visibly refused to empty — ten times in a row in the starter-loop run
// that exposed it. The renderer must route through the authority verbs.

test('the disposal prop routes through the structured cleaning authority', () => {
  const source = readFileSync('src/render3d/clubhouse.js', 'utf8');
  const start = source.indexOf('function emptyDustpanIntoBag()');
  const end = source.indexOf('function customerPick', start);
  const section = source.slice(start, end > start ? end : start + 2400);

  assert.match(section, /emptyPanIntoBag\(state\)/);
  assert.match(section, /tieBag\(state\)/);
  assert.match(section, /disposeTiedBag\(state\)/);
  assert.doesNotMatch(section, /state\.shop\.reno\.pan\s*=/,
    'the disposal verbs must not write the legacy pan mirror directly');
  assert.doesNotMatch(section, /state\.shop\.reno\.bag\s*=/,
    'the disposal verbs must not write the legacy bag mirror directly');
});

test('the authority round trip empties a loaded pan and disposes the tied bag', () => {
  const state = { shop: { reno: { pan: 0, bag: 0 } } };
  ensureCleaningToolState(state);
  addToPan(state, 1.2);
  assert.equal(state.shop.reno.pan, 1.2, 'mirror follows the authority load');

  const emptied = emptyPanIntoBag(state);
  assert.equal(emptied.moved, 1.2);
  assert.equal(state.shop.reno.pan, 0);
  assert.equal(state.shop.reno.bag, 1.2);

  // A second empty on an empty pan moves nothing — the ×10 toast bug shape.
  assert.equal(emptyPanIntoBag(state).moved, 0);

  assert.equal(tieBag(state).ok, true);
  const disposed = disposeTiedBag(state);
  assert.equal(disposed.ok, true);
  assert.equal(disposed.disposed, 1.2);
  assert.equal(state.shop.reno.bag, 0);

  // Disposal without a tied bag refuses rather than silently zeroing.
  assert.equal(disposeTiedBag(state).ok, false);
});
