// The laptop's table and chart arithmetic — pure functions, tested as such.
import test from 'node:test';
import assert from 'node:assert/strict';

// applyTableQuery/scalePoints/donutSegments are pure; the DOM builders in the same module
// are exercised by laptop-pages.test.js under its DOM stand-in.
globalThis.document = globalThis.document || {
  createElement: () => ({ nodeType: 1, children: [], style: {}, classList: { toggle() {} }, append() {}, appendChild() {}, addEventListener() {}, setAttribute() {}, replaceChildren() {} }),
  createElementNS: () => ({ nodeType: 1, appendChild() {}, setAttribute() {}, addEventListener() {} }),
  createTextNode: (s) => ({ nodeType: 3, text: String(s) }),
};
const { applyTableQuery, scalePoints, donutSegments, shortMoney, pathOf } = await import('../src/ui/laptopWidgets.js');

const ROWS = [
  { name: 'Range Balls', cat: 'balls', stock: 4, price: 12 },
  { name: 'Tour Glove', cat: 'accessories', stock: 0, price: 19 },
  { name: 'Club Polo', cat: 'apparel', stock: 9, price: 45 },
  { name: 'Sunday Bag', cat: 'bags', stock: 2, price: 120 },
  { name: 'range tees', cat: 'accessories', stock: 30, price: 4 },
];

test('search is case-insensitive and clears cleanly', () => {
  const q1 = applyTableQuery(ROWS, { search: 'RANGE', searchIn: (r) => [r.name] });
  assert.deepEqual(q1.rows.map((r) => r.name), ['Range Balls', 'range tees']);
  const q2 = applyTableQuery(ROWS, { search: '', searchIn: (r) => [r.name] });
  assert.equal(q2.total, ROWS.length);
  const q3 = applyTableQuery(ROWS, { search: 'zzz', searchIn: (r) => [r.name] });
  assert.equal(q3.total, 0);
});

test('filters combine, sort orders numerically both ways and stays stable', () => {
  const q = applyTableQuery(ROWS, {
    filters: [(r) => r.cat === 'accessories'],
    sortVal: (r) => r.price,
    sortDir: -1,
  });
  assert.deepEqual(q.rows.map((r) => r.name), ['Tour Glove', 'range tees']);
  const tied = [{ n: 'a', v: 1 }, { n: 'b', v: 1 }, { n: 'c', v: 1 }];
  const qt = applyTableQuery(tied, { sortVal: (r) => r.v, sortDir: 1 });
  assert.deepEqual(qt.rows.map((r) => r.n), ['a', 'b', 'c']); // original order preserved on ties
});

test('string sort uses locale order; non-finite numbers sink instead of poisoning', () => {
  const q = applyTableQuery(ROWS, { sortVal: (r) => r.name, sortDir: 1 });
  assert.equal(q.rows[0].name, 'Club Polo');
  const dirty = [{ v: 5 }, { v: NaN }, { v: 2 }];
  const qd = applyTableQuery(dirty, { sortVal: (r) => r.v, sortDir: 1 });
  assert.deepEqual(qd.rows.map((r) => r.v)[0], NaN); // NaN treated as -Infinity, sorts first ascending
});

test('pagination clamps out-of-range pages and preserves totals', () => {
  const many = Array.from({ length: 25 }, (_, i) => ({ i }));
  const q = applyTableQuery(many, { page: 99, pageSize: 10 });
  assert.equal(q.pages, 3);
  assert.equal(q.page, 2);
  assert.equal(q.rows.length, 5);
  assert.equal(q.total, 25);
});

test('scalePoints maps a series into the box and never emits NaN', () => {
  const pts = scalePoints([0, 5, 10, NaN], { w: 100, h: 50, padX: 0, padY: 0 });
  assert.equal(pts.length, 4);
  for (const p of pts) {
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
    assert.ok(p.y >= 0 && p.y <= 50);
  }
  assert.ok(pts[2].y < pts[0].y); // bigger value sits higher
  assert.ok(pathOf(pts).startsWith('M'));
});

test('donut segments carry the value shares and skip empty slices', () => {
  const segs = donutSegments([
    { label: 'a', value: 75 }, { label: 'b', value: 25 }, { label: 'c', value: 0 },
  ], { cx: 50, cy: 50, r: 40 });
  assert.equal(segs.length, 2);
  assert.ok(Math.abs(segs[0].frac - 0.75) < 1e-9);
  assert.ok(segs.every((s) => s.d.startsWith('M') && s.d.includes('A')));
  assert.deepEqual(donutSegments([{ label: 'x', value: 0 }], { cx: 0, cy: 0, r: 10 }), []);
});

test('shortMoney compresses honestly at every magnitude', () => {
  assert.equal(shortMoney(0), '$0');
  assert.equal(shortMoney(842), '$842');
  assert.equal(shortMoney(1250), '$1.3k');
  assert.equal(shortMoney(48750), '$49k');
  assert.equal(shortMoney(2400000), '$2.4m');
  assert.equal(shortMoney(-1250), '-$1.3k');
});
