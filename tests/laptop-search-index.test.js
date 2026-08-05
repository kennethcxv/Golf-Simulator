// THE LAPTOP SEARCH INDEXES THE WHOLE LAPTOP, AND A RESULT IS A LOCATION.
//
// Reported 2026-07-29: "What shipped only searches orderable products. I want it to search
// everything inside the laptop… Results show the PAGE PATH the thing lives on… Selecting a
// result NAVIGATES to that page and section, with the match highlighted or scrolled to."
//
// The index is built inside makeLaptop because it reads live state, so this file stands up a
// DOM big enough for the shell — including querySelectorAll/closest/scrollIntoView, which the
// reveal needs and the older laptop-pages harness does not provide — and then drives the real
// component: type, read the rows, click one, and check where it landed.
//
// The negative control is the last test: a target whose anchor text is NOT on the destination
// page must report found:false. Without it, "navigated and highlighted" and "navigated and
// silently highlighted nothing" would be the same green.
import test from 'node:test';
import assert from 'node:assert/strict';

// --- a DOM with enough of a tree to answer querySelectorAll and closest ---------------------
class MiniNode {
  constructor(tag) {
    this.tagName = tag;
    this.nodeType = 1;
    this.children = [];
    this.attrs = {};
    this.className = '';
    this._text = '';
    this.parentNode = null;
    this.scrollTop = 0;
    this.scrolledIntoView = 0;
    this.style = { setProperty: () => {} };
    const self = this;
    this.classList = {
      add: (cls) => { const s = self._set(); s.add(cls); self.className = [...s].join(' '); },
      remove: (cls) => { const s = self._set(); s.delete(cls); self.className = [...s].join(' '); },
      toggle: (cls, on) => {
        const s = self._set();
        const want = on === undefined ? !s.has(cls) : !!on;
        if (want) s.add(cls); else s.delete(cls);
        self.className = [...s].join(' ');
      },
      contains: (cls) => self._set().has(cls),
    };
  }

  _set() { return new Set(String(this.className).split(/\s+/).filter(Boolean)); }

  setAttribute(k, v) {
    this.attrs[k] = String(v);
    if (k === 'class') this.className = String(v);
  }

  getAttribute(k) { return this.attrs[k]; }
  addEventListener(type, fn) { (this._listeners ||= {})[type] ||= []; this._listeners[type].push(fn); }
  removeEventListener() {}
  click() { for (const fn of (this._listeners && this._listeners.click) || []) fn({ target: this, stopPropagation() {} }); }
  scrollIntoView() { this.scrolledIntoView += 1; }

  append(...kids) {
    for (const k of kids) {
      const node = k && k.nodeType ? k : { nodeType: 3, text: String(k) };
      if (node.nodeType === 1) node.parentNode = this;
      this.children.push(node);
    }
  }

  appendChild(k) { this.append(k); return k; }
  replaceChildren(...kids) { this.children = []; this.append(...kids); }
  remove() {}

  get textContent() {
    if (this._text) return this._text;
    return this.children.map((c) => (c.nodeType === 3 ? c.text : c.textContent)).join('');
  }

  set textContent(v) { this._text = String(v); this.children = []; }

  matches(selector) {
    for (const one of String(selector).split(',').map((s) => s.trim()).filter(Boolean)) {
      if (one.startsWith('.')) { if (this.classList.contains(one.slice(1))) return true; }
      else if (this.tagName === one) return true;
    }
    return false;
  }

  closest(selector) {
    let node = this;
    while (node) {
      if (node.nodeType === 1 && node.matches(selector)) return node;
      node = node.parentNode;
    }
    return null;
  }

  querySelectorAll(selector) {
    const out = [];
    const visit = (node) => {
      for (const child of node.children || []) {
        if (child.nodeType !== 1) continue;
        if (child.matches(selector)) out.push(child);
        visit(child);
      }
    };
    visit(this);
    return out;
  }
}

const uiRoot = new MiniNode('div');
globalThis.document = {
  createElement: (t) => new MiniNode(t),
  createElementNS: (ns, t) => new MiniNode(t),
  createTextNode: (s) => ({ nodeType: 3, text: String(s) }),
  getElementById: () => uiRoot,
  body: uiRoot,
};

const { newGame } = await import('../src/sim/state.js');
const { makeLaptop } = await import('../src/ui/laptop.js');
const { hireStaff, refreshMarketIfDue } = await import('../src/sim/staff.js');
const { bookSlot } = await import('../src/sim/reservations.js');
const { calendarOf } = await import('../src/sim/time.js');
const { placeOrder } = await import('../src/sim/shop.js');
const {
  LAPTOP_SECTIONS, SEARCH_GROUPS, SEARCH_SCORE, formatPagePath, navEntries,
  rankSearchEntries, scoreSearchEntry, searchGroups, tabsOf,
} = await import('../src/ui/laptopSearch.js');

function walk(node, fn) {
  fn(node);
  for (const child of node.children || []) if (child.nodeType === 1) walk(child, fn);
}

function collect(root, className) {
  const out = [];
  walk(root, (node) => { if (node.classList.contains(className)) out.push(node); });
  return out;
}

/** A club with staff, bookings, an order on the road — so the index has something in it. */
function livedInClub() {
  const st = newGame('relaxed', 909);
  const cal = calendarOf(st.clock.minutes);
  refreshMarketIfDue(st, cal.dayAbs);
  if (st.staff.market.length) hireStaff(st, st.staff.market[0].id);
  bookSlot(st, cal.dayAbs, 8 * 60, { name: 'Marguerite Alcazar', fullName: 'Marguerite Alcazar', partySize: 2 });
  placeOrder(st, 'balls1', 4);
  return st;
}

function openLaptop(state) {
  const app = { state, audio: null, scene3d: null, empire: null };
  const lap = makeLaptop(app, { close: () => {}, openCourseEditor: () => {} });
  lap.open('home');
  return lap;
}

function typeQuery(lap, text) {
  // The real field, the real listener — not a private setter. The brief asked for "live
  // results as you type, no submit", and that is an assertion about the input event.
  const field = firstNode(lap.root, (n) => n.tagName === 'input' && n.classList.contains('lt-search'));
  assert.ok(field, 'the search field must exist to be typed into');
  field.value = text;
  for (const fn of (field._listeners && field._listeners.input) || []) fn({ target: field });
  return field;
}

function firstNode(root, predicate) {
  let match = null;
  walk(root, (node) => { if (!match && predicate(node)) match = node; });
  return match;
}

// --- the page map ---------------------------------------------------------------------------

test('the sidebar and every tab bar are built from one page map', () => {
  // Two hand-maintained copies of these labels is how a result comes to name a page by a
  // label the destination no longer uses.
  const nav = navEntries();
  assert.deepEqual(nav.map((n) => n.id),
    ['home', 'reservations', 'shop', 'course', 'upgrades', 'finances', 'settings']);
  assert.equal(nav.length, LAPTOP_SECTIONS.length);
  assert.deepEqual(tabsOf('shop').map((t) => t[0]), ['stock', 'order', 'cart', 'prices', 'deliveries']);
  assert.deepEqual(tabsOf('home'), []);
  assert.equal(formatPagePath('shop', 'order'), 'Pro Shop › Orders & Suppliers');
  assert.equal(formatPagePath('finances', 'finances'), 'Business › Finances');
  assert.equal(formatPagePath('home'), 'Home');
  // An unknown tab must not invent a crumb.
  assert.equal(formatPagePath('shop', 'nope'), 'Pro Shop');
});

test('the tab bar the shop draws carries the labels the page map holds', () => {
  const lap = openLaptop(livedInClub());
  lap.go('shop');
  const labels = collect(lap.root, 'lt-tab').map((n) => n.textContent);
  for (const [, label] of tabsOf('shop')) {
    // Cart is badged with its count when full; on a fresh session it is bare.
    assert.ok(labels.some((l) => l.startsWith(label)), `the shop tab bar is missing "${label}"`);
  }
});

// --- what is indexed -----------------------------------------------------------------------

test('the index covers every kind the brief listed, not just orderable products', () => {
  const lap = openLaptop(livedInClub());
  const kinds = lap.searchIndexKinds();
  // The brief: "products, upgrades, amenities, materials, staff, bookings, orders and
  // deliveries, finance lines, course sections, property upgrades, settings, and the pages
  // themselves." Each of those has to be a populated bucket, not a declared one.
  for (const kind of ['Page', 'Product', 'Upgrade', 'Amenity', 'Material', 'Equipment',
    'Staff', 'Candidate', 'Booking', 'Order', 'Ledger', 'Property', 'Hole', 'Turf', 'Setting']) {
    assert.ok((kinds[kind] || 0) > 0, `nothing in the index is a ${kind}`);
  }
  // Pages AND their tabs — 7 pages plus 19 tabs.
  const tabCount = LAPTOP_SECTIONS.reduce((sum, s) => sum + s.tabs.length, 0);
  assert.equal(kinds.Page, LAPTOP_SECTIONS.length + tabCount);
  assert.ok(lap.searchIndexSize() > 250, `the whole laptop should be more than ${lap.searchIndexSize()} entries`);
});

test('every group with a chip has entries, and every kind belongs to a group', () => {
  const lap = openLaptop(livedInClub());
  const kinds = lap.searchIndexKinds();
  const grouped = new Set(SEARCH_GROUPS.flatMap((g) => g.kinds));
  for (const kind of Object.keys(kinds)) {
    assert.ok(grouped.has(kind), `${kind} is indexed but belongs to no filter group`);
  }
});

// --- ranking --------------------------------------------------------------------------------

test('exact and prefix matches outrank substring matches, in that order', () => {
  const e = { label: 'Range balls', detail: 'a bucket of practice balls', keywords: ['balls1'] };
  assert.equal(scoreSearchEntry(e, 'range balls'), SEARCH_SCORE.EXACT_LABEL);
  assert.equal(scoreSearchEntry(e, 'balls1'), SEARCH_SCORE.EXACT_KEYWORD);
  assert.equal(scoreSearchEntry(e, 'range'), SEARCH_SCORE.LABEL_PREFIX);
  assert.equal(scoreSearchEntry(e, 'ball'), SEARCH_SCORE.KEYWORD_PREFIX);
  // A prefix of a WORD inside the label, with no keyword to reach it by. 'balls' against this
  // same entry scores KEYWORD_PREFIX instead, because 'balls1' starts with it — the keyword
  // route is genuinely the stronger evidence and is checked first.
  assert.equal(scoreSearchEntry(e, 'balls'), SEARCH_SCORE.KEYWORD_PREFIX);
  assert.equal(scoreSearchEntry({ label: 'Range balls', keywords: [] }, 'balls'), SEARCH_SCORE.LABEL_WORD_PREFIX);
  assert.equal(scoreSearchEntry({ label: 'Shortballs', keywords: [] }, 'balls'), SEARCH_SCORE.LABEL_SUBSTRING);
  assert.equal(scoreSearchEntry(e, 'lls1'), SEARCH_SCORE.KEYWORD_SUBSTRING);
  assert.equal(scoreSearchEntry(e, 'practice'), SEARCH_SCORE.DETAIL_SUBSTRING);
  assert.equal(scoreSearchEntry(e, 'nothing here'), 0);
  // The tiers must be strictly descending, or "outranks" is not a property of the numbers.
  const order = ['EXACT_LABEL', 'EXACT_KEYWORD', 'LABEL_PREFIX', 'KEYWORD_PREFIX',
    'LABEL_WORD_PREFIX', 'LABEL_SUBSTRING', 'KEYWORD_SUBSTRING', 'DETAIL_SUBSTRING'];
  for (let i = 1; i < order.length; i++) {
    assert.ok(SEARCH_SCORE[order[i - 1]] > SEARCH_SCORE[order[i]],
      `${order[i - 1]} must outrank ${order[i]}`);
  }
});

test('a two-word query needs every word, and the literal alias still wins', () => {
  const kit = { label: 'Clubhouse repair components', keywords: ['repairkit1', 'kit', 'clubhouse kit'] };
  const other = { label: 'Clubhouse cleaning kit', keywords: [] };
  const neither = { label: 'Clubhouse bench', keywords: [] };
  const hits = rankSearchEntries([neither, other, kit], 'clubhouse kit');
  assert.deepEqual(hits.map((h) => h.label), ['Clubhouse repair components', 'Clubhouse cleaning kit']);
  assert.equal(hits[0].score, SEARCH_SCORE.EXACT_KEYWORD);
  // 'Clubhouse bench' matches one word of two and must not come back at all.
  assert.ok(!hits.some((h) => h.label === 'Clubhouse bench'));
});

test('the filter chips are the groups the index actually populated', () => {
  const lap = openLaptop(livedInClub());
  const chips = searchGroups(
    Object.entries(lap.searchIndexKinds()).flatMap(([kind, n]) => Array.from({ length: n }, () => ({ kind, label: 'x' }))),
  );
  assert.equal(chips[0].id, 'all');
  assert.ok(chips.length > 1, 'a populated index must offer at least one group chip');
  for (const chip of chips.slice(1)) assert.ok(chip.count > 0, `${chip.id} claims ${chip.count}`);
  // An empty index offers nothing but All at zero — no chips for buckets that do not exist.
  assert.deepEqual(searchGroups([]), [{ id: 'all', label: 'All', count: 0 }]);
});

// --- live results, page paths, and the jump ------------------------------------------------

test('typing produces results with no submit, and every row names its page', () => {
  const lap = openLaptop(livedInClub());
  typeQuery(lap, 'deliveries');
  const rows = collect(lap.root, 'lt-hit');
  assert.ok(rows.length > 0, 'typing alone must produce results');
  for (const row of rows) {
    const path = row.querySelectorAll('.lt-hitpath')[0];
    assert.ok(path, 'every result row carries a page path');
    assert.ok(path.textContent.trim().length > 0, 'the path must not be empty');
  }
  const crumbs = rows[0].querySelectorAll('.lt-hitcrumb').map((n) => n.textContent);
  assert.equal(crumbs[0], 'Pro Shop', `the top hit for "deliveries" should live in the Pro Shop, not ${crumbs}`);
});

test('typing "kit" surfaces the clubhouse repair kit FIRST, named in full, as a location', () => {
  // Round 2, 2026-07-30: "typing kit does not surface the clubhouse repair kit." It did —
  // ranked first — but the chip rail ellipsized the label, so from the chair it did not
  // exist. tests/laptop-search.test.js pins the ranking on a synthetic catalogue mapping;
  // this drives the REAL component end to end: the live index must carry the SKU's alias
  // keywords (shopItems.js) and the first rendered row must be the kit, path and all.
  const lap = openLaptop(livedInClub());
  typeQuery(lap, 'kit');
  const rows = collect(lap.root, 'lt-hit');
  assert.ok(rows.length > 0, 'typing "kit" must produce results');
  const first = rows[0];
  assert.equal(first.querySelectorAll('.lt-hitname')[0]?.textContent, 'Clubhouse repair components',
    'the item the ceiling prompt calls "the clubhouse kit" must be the FIRST row');
  const crumbs = first.querySelectorAll('.lt-hitcrumb').map((n) => n.textContent);
  assert.equal(crumbs[0], 'Pro Shop', `the kit's row must lead with where it lives, not ${crumbs}`);
  assert.ok(crumbs.length >= 2, 'the path names the tab as well as the page');
});

test('clicking a result GOES there and flashes the row it meant', () => {
  // Round 2 clicked a row to swap a preview panel and needed a second button, "Open →", to
  // actually travel. Round 3, 2026-07-30: "I see search results and a whole Pro Shop
  // dashboard at once" and "there is a stray PRO SHOP › INVENTORY / Open → bar… unclear what
  // it is." The preview and its bar are gone; the row itself is the trip.
  const lap = openLaptop(livedInClub());
  typeQuery(lap, 'Pine Hills cap');
  const rows = collect(lap.root, 'lt-hit');
  const target = rows.find((r) => r.textContent.includes('Pine Hills cap'));
  assert.ok(target, 'the cap must be findable by its own name');
  target.click();
  assert.equal(lap.pageId(), 'shop', 'the row navigates to the Pro Shop by itself');
  const reveal = lap.lastSearchReveal();
  assert.equal(reveal.anchor, 'Pine Hills cap');
  assert.equal(reveal.found, true, `navigated but never found the row: ${JSON.stringify(reveal)}`);
  // …and the real page is what is on screen — the destination's own inventory row.
  assert.ok(collect(lap.root, 'lt-searchhit').length >= 1, 'the landing flash marks the row');
});
test('a settings switch lands on its own tab, at the real checkbox', () => {
  const lap = openLaptop(livedInClub());
  typeQuery(lap, 'exact change');
  const rows = collect(lap.root, 'lt-hit');
  const target = rows.find((r) => r.textContent.includes('Automatic exact change'));
  assert.ok(target, '"exact change" must find the checkout switch');
  const crumbs = target.querySelectorAll('.lt-hitcrumb').map((n) => n.textContent);
  assert.deepEqual(crumbs, ['Settings', 'Checkout']);
  target.click();
  assert.equal(lap.pageId(), 'settings');
  assert.equal(lap.lastSearchReveal().found, true);
  // The REAL row: a label wrapping an actual checkbox input, not a description of one.
  let realRow = false;
  walk(lap.root, (node) => {
    if (node.tagName === 'label' && node.textContent.includes('Automatic exact change')) {
      walk(node, (child) => {
        if (child.tagName === 'input' && child.attrs.type === 'checkbox') realRow = true;
      });
    }
  });
  assert.ok(realRow, 'the destination carries the actual switch, checkbox and all');
});
// --- how the results READ (round 3, 2026-07-30) ----------------------------------------------
//
// Five complaints came off one screenshot of a search for "kit" — four correct results,
// presented unusably. Each one is a test.

test('the ITEM NAME is the row\'s first line and the page path sits under it', () => {
  // "Each row shows the page path in small blue caps and the item name below it in larger
  // text. INVERT that: the ITEM NAME is what I am searching for." Round 2 had deliberately
  // made the path the lead line. This is the reversal, pinned so it cannot drift back.
  const lap = openLaptop(livedInClub());
  typeQuery(lap, 'kit');
  const rows = collect(lap.root, 'lt-hit');
  assert.ok(rows.length > 0);
  for (const row of rows) {
    const body = row.querySelectorAll('.lt-hitbody')[0];
    assert.ok(body, 'each row has a body');
    const lines = body.children.filter((c) => c.nodeType === 1);
    assert.ok(lines[0].classList.contains('lt-hitname'),
      'the name must be the first line in the row, not the second');
    assert.ok(lines[1].classList.contains('lt-hitpath'),
      'and the page path is the context line under it');
  }
});

test('a query whose results are all one kind draws no filter chips', () => {
  // "The filter chips read 'All 4' and 'Catalogue 4'. Two chips for the same four results is
  // not a filter." searchGroups always leads with All, so one populated group means two chips
  // that select identical rows.
  const lap = openLaptop(livedInClub());
  typeQuery(lap, 'kit');
  assert.equal(collect(lap.root, 'lt-hit').length, 4, 'the reported query still returns its four hits');
  assert.equal(collect(lap.root, 'lt-hitfilters').length, 0,
    'four results of one kind must not be offered a filter that cannot split them');

  // …and a query that genuinely spans groups still gets its strip.
  typeQuery(lap, 'course');
  assert.equal(collect(lap.root, 'lt-hitfilters').length, 1, 'a query across groups keeps its chips');
  assert.ok(collect(lap.root, 'lt-tab').length >= 3, 'All plus two real groups is a real filter');
});

test('the kind mark and the kind tag appear only when the results differ in kind', () => {
  // "Every row has an identical grey icon and an identical PRODUCT tag on the right. Both are
  // noise if everything is a product."
  const lap = openLaptop(livedInClub());
  typeQuery(lap, 'kit');
  assert.equal(collect(lap.root, 'lt-hitkind').length, 0, 'one kind, so the tag says nothing');
  assert.equal(collect(lap.root, 'lt-hitmark').length, 0, 'one kind, so the glyph says nothing');

  typeQuery(lap, 'course');
  const rows = collect(lap.root, 'lt-hit');
  assert.ok(rows.length > 1);
  assert.equal(collect(lap.root, 'lt-hitkind').length, rows.length, 'mixed kinds: every row is labelled');
  assert.equal(collect(lap.root, 'lt-hitmark').length, rows.length);
  assert.ok(new Set(collect(lap.root, 'lt-hitkind').map((n) => n.textContent)).size >= 2,
    'and the labels actually differ, or they would be noise again');
});

test('the results REPLACE the page - no second page underneath, no stray bar', () => {
  // "The results list appears ABOVE the full underlying page, which is still rendered below
  // it. I see search results and a whole Pro Shop dashboard at once," and "there is a stray
  // 'PRO SHOP › INVENTORY / Open →' bar between the results and the page content."
  const lap = openLaptop(livedInClub());
  lap.go('shop');
  assert.ok(collect(lap.root, 'lt-h1').length >= 1, 'the shop draws a page heading');
  typeQuery(lap, 'kit');
  const headings = collect(lap.root, 'lt-h1').map((n) => n.textContent);
  assert.equal(headings.length, 1, `two page headings means two pages on screen: ${headings}`);
  assert.match(headings[0], /^Search - /, 'and the one heading is the search');
  assert.equal(collect(lap.root, 'lt-searchpreview').length, 0, 'no page is previewed under the list');
  assert.equal(collect(lap.root, 'lt-previewbar').length, 0, 'and the bar that labelled it is gone');
  assert.equal(collect(lap.root, 'lt-hitopen').length, 0, 'the second "Open →" button is gone with it');
  // Clearing the field puts the page back exactly as it was.
  const field = firstNode(lap.root, (n) => n.tagName === 'input' && n.classList.contains('lt-search'));
  field.value = '';
  for (const fn of field._listeners.input) fn({ target: field });
  assert.equal(collect(lap.root, 'lt-hit').length, 0, 'no results linger');
  assert.equal(lap.pageId(), 'shop', 'and the page underneath is the one that was there');
});

test('the arrow keys walk the results and Enter opens the highlighted one', () => {
  // The list owns the screen now, so it has to be reachable without the mouse.
  const lap = openLaptop(livedInClub());
  const field = typeQuery(lap, 'kit');
  const press = (key) => { for (const fn of field._listeners.keydown) fn({ key, target: field, stopPropagation() {}, preventDefault() {} }); };
  const marked = () => collect(lap.root, 'lt-hit').findIndex((r) => r.classList.contains('on'));
  assert.equal(marked(), 0, 'the first result starts highlighted');
  press('ArrowDown');
  assert.equal(marked(), 1);
  press('ArrowUp');
  assert.equal(marked(), 0);
  press('Enter');
  assert.equal(lap.pageId(), 'shop', 'Enter travels to the highlighted result');
  assert.equal(lap.lastSearchReveal().anchor, 'Clubhouse repair components');
});

test('NEGATIVE CONTROL - an anchor that is not on the destination reports found:false', () => {
  // The instrument has to be able to say no. If revealAnchor claimed a hit for anything, all
  // three tests above would pass with the highlight wired to nothing at all.
  //
  // openSearchResult is the same function a result row calls, so this drives the real path —
  // only the anchor is text the laptop never prints.
  const lap = openLaptop(livedInClub());

  lap.openSearchResult({ target: { page: 'settings', tab: 'general', anchor: 'Automatic exact change' } });
  assert.equal(lap.lastSearchReveal().found, false,
    'that switch is on the Checkout tab, so General must NOT claim to have found it');

  lap.openSearchResult({ target: { page: 'settings', tab: 'checkout', anchor: 'Automatic exact change' } });
  assert.equal(lap.lastSearchReveal().found, true, 'the same anchor on the right tab is found');

  lap.openSearchResult({ target: { page: 'settings', tab: 'checkout', anchor: 'Xylophone repair schedule' } });
  const miss = lap.lastSearchReveal();
  assert.equal(miss.found, false);
  assert.equal(miss.selector, null);
  assert.equal(collect(lap.root, 'lt-searchhit').length, 0, 'a miss must leave nothing marked');
});
