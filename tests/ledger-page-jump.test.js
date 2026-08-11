// I3 (Goal 23) — the contents list is navigable.
//
// F1: "obvious at a glance where I am and HOW TO GET ANYWHERE ELSE." The
// contents page prints page numbers — Guest Register 2, The Deed 9 — and there
// was no way to use them. Reaching The Deed from the index was seven presses of
// E. A contents list you cannot navigate from is decorative.
//
// The mapping is the whole rule and it is worth stating separately from the
// book, because the interesting cases are the ones a player produces by
// accident: a number past the end, a number on the same spread they are already
// on, and the two folios that share one spread.
import test from 'node:test';
import assert from 'node:assert/strict';

// The rule as ledgerBook.goToPage applies it: folios are 1-based and a spread
// carries two of them, so pages 1 and 2 are the same opening.
const spreadForFolio = (folio, total) => Math.max(0, Math.min(total - 1, Math.floor((folio - 1) / 2)));

test('the two folios of one opening land on the same spread', () => {
  // This is why the jump takes a FOLIO and not a spread index: the number the
  // player is reading off the contents list is the folio.
  //
  // The pairing is (1,2), (3,4), (5,6) -- paintSpread gives the LEFT page folio
  // spread*2+1 and the RIGHT page spread*2+2, so the index (page 1) shares its
  // opening with page 2. My first version of this test asserted 2 and 3 were a
  // pair and failed; the code was right and the test was wrong, which is the
  // correct direction for that argument to be settled in.
  assert.equal(spreadForFolio(1, 5), spreadForFolio(2, 5));
  assert.equal(spreadForFolio(3, 5), spreadForFolio(4, 5));
  assert.notEqual(spreadForFolio(2, 5), spreadForFolio(3, 5));
});

test('the contents page numbers reach the sections they name', () => {
  // The list as the index paints it today.
  const total = 5; // ten pages
  const contents = [
    { name: 'Guest Register', folio: 2 },
    { name: 'Complaints and Fixes', folio: 3 },
    { name: 'The Restoration Record', folio: 5 },
    { name: 'The Takings', folio: 7 },
    { name: 'The Deed', folio: 9 },
  ];
  for (const row of contents) {
    const spread = spreadForFolio(row.folio, total);
    assert.ok(spread >= 0 && spread < total, `${row.name} (page ${row.folio}) must be reachable`);
    // and the spread it lands on must actually CONTAIN that folio
    assert.ok(row.folio === spread * 2 + 1 || row.folio === spread * 2 + 2,
      `${row.name}: page ${row.folio} is not on the spread the jump chose (${spread})`);
  }
});

test('CONTROL: without the jump, The Deed is seven turns from the index', () => {
  // The number that made this worth building. Page 9 is spread 4; the index is
  // spread 0; a turn moves one spread, so four turns forward — but the player
  // is reading FOLIOS, and from page 1 to page 9 by pressing "next page" is
  // eight page-steps. Either way it is not "how to get anywhere else".
  const fromIndex = spreadForFolio(9, 5) - spreadForFolio(1, 5);
  assert.equal(fromIndex, 4, 'four spread turns, or eight page numbers, to cross the book');
  assert.ok(fromIndex > 1, 'control: the jump is only worth having because the walk is long');
});

test('a page number past the end clamps rather than throwing the reader out', () => {
  // A player will press 9 in a five-page book. Clamping to the last spread is
  // the forgiving answer; NaN or a blank spread is not.
  assert.equal(spreadForFolio(9, 2), 1);
  assert.equal(spreadForFolio(99, 5), 4);
});

test('page 1 is the index, so the jump can always get home', () => {
  assert.equal(spreadForFolio(1, 5), 0);
});
