// THE LAPTOP SEARCH FINDS THINGS THE GAME CALLS BY MORE THAN ONE NAME.
//
// The requirement that produced this file: "the clubhouse kit should be findable
// by typing 'kit'". It is called "Clubhouse repair components" in the catalogue
// and "clubhouse kit" in the prompt over a broken ceiling fitting. Two names for
// one object is a naming bug; the search should not have to guess its way around
// it, so the catalogue entry carries the words the game actually says out loud.

import test from 'node:test';
import assert from 'node:assert/strict';
import { rankSearchEntries, scoreSearchEntry, SEARCH_SCORE } from '../src/ui/laptopSearch.js';
import { SHOP_CATALOG } from '../src/data/shopItems.js';

const catalogEntries = SHOP_CATALOG.map((sku) => ({
  kind: 'Product',
  label: sku.name,
  detail: sku.cat,
  keywords: [sku.id, sku.cat, ...(sku.keywords || [])],
}));

test('typing "kit" finds the clubhouse kit, under the name the game says out loud', () => {
  const hits = rankSearchEntries(catalogEntries, 'kit');
  const labels = hits.map((h) => h.label);
  assert.ok(labels.includes('Clubhouse repair components'),
    'the item the ceiling prompt calls "the clubhouse kit" must be reachable by that word');
  // …and it must be at the TOP, not buried under the three items that happen to
  // have "kit" in their catalogue names. An exact keyword beats a substring.
  assert.equal(hits[0].label, 'Clubhouse repair components');
});

test('an exact keyword outranks a name that merely contains the word', () => {
  const entries = [
    { label: 'Commercial shelving kit', keywords: ['shelfkit1'] },
    { label: 'Clubhouse repair components', keywords: ['repairkit1', 'kit', 'clubhouse kit'] },
  ];
  const hits = rankSearchEntries(entries, 'kit');
  assert.equal(hits[0].label, 'Clubhouse repair components');
  assert.equal(hits[0].score, SEARCH_SCORE.EXACT_KEYWORD);
  // "Commercial shelving kit" ends in the word — a prefix of a WORD, which now has its own
  // tier below both exact kinds and above a mid-word substring.
  assert.equal(hits[1].score, SEARCH_SCORE.LABEL_WORD_PREFIX);
  assert.ok(hits[0].score > hits[1].score, 'an exact keyword must still win');
});

test('the ranking is total and stable - the same query never reshuffles', () => {
  // A result list that reorders between keystrokes cannot be clicked.
  const entries = [
    { label: 'Vinyl flooring', keywords: [] },
    { label: 'Vinyl walls', keywords: [] },
    { label: 'Vinyl ceilings', keywords: [] },
  ];
  const a = rankSearchEntries(entries, 'vinyl').map((h) => h.label);
  const b = rankSearchEntries([...entries].reverse(), 'vinyl').map((h) => h.label);
  assert.deepEqual(a, b, 'input order must not decide output order');
  assert.deepEqual(a, ['Vinyl ceilings', 'Vinyl flooring', 'Vinyl walls']);
});

test('an empty query returns nothing rather than everything', () => {
  assert.deepEqual(rankSearchEntries(catalogEntries, ''), []);
  assert.deepEqual(rankSearchEntries(catalogEntries, '   '), []);
  assert.deepEqual(rankSearchEntries(null, 'kit'), []);
});

test('search is case- and whitespace-insensitive', () => {
  assert.equal(rankSearchEntries(catalogEntries, '  KIT ')[0].label, 'Clubhouse repair components');
});

// The tier-by-tier scoring table lives in tests/laptop-search-index.test.js, alongside the
// assertion that the tiers are strictly descending. It was here first; it moved when the
// ranking grew word-prefix tiers, because two copies of a score table disagree on the next
// change and only one of them is read.

test('every product in the catalogue is reachable by its own name', () => {
  // A search that cannot find an item the player can see in the shop is worse
  // than no search: it tells them the item does not exist.
  for (const sku of SHOP_CATALOG) {
    const hits = rankSearchEntries(catalogEntries, sku.name);
    assert.ok(hits.some((h) => h.label === sku.name), `"${sku.name}" is unreachable by its own name`);
  }
});
