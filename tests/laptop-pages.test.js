// EVERY PAGE OF GOLF SIMULATOR, DRAWN HEADLESS.
//
// makeLaptop is DOM code, but its pages are pure functions of the sim state — so a sixty-line
// stand-in for the handful of DOM calls they make is enough to draw all twenty-four pages
// against a real newGame() state and a lived-in one. What this catches: a page that throws on
// a virgin club (the shell would show its error card), a nav id with no page behind it, and
// any page that forgets its empty states. The projection/geometry side has its own tests.
import test from 'node:test';
import assert from 'node:assert/strict';

// --- the minimal DOM the laptop actually touches -------------------------------------------
class MiniNode {
  constructor(tag) {
    this.tagName = tag;
    this.nodeType = 1;
    this.children = [];
    this.attrs = {};
    this.className = '';
    this._text = '';
    this.style = { setProperty: () => {} };
    this.scrollTop = 0;
    const self = this;
    this.classList = {
      toggle: (cls, on) => {
        const set = new Set(self.className.split(/\s+/).filter(Boolean));
        const want = on === undefined ? !set.has(cls) : !!on;
        if (want) set.add(cls); else set.delete(cls);
        self.className = [...set].join(' ');
      },
      contains: (cls) => self.className.split(/\s+/).includes(cls),
    };
  }

  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k]; }
  addEventListener() {}
  removeEventListener() {}
  append(...kids) { for (const k of kids) this.children.push(k && k.nodeType ? k : { nodeType: 3, text: String(k) }); }
  appendChild(k) { this.children.push(k); return k; }
  replaceChildren(...kids) { this.children = []; this.append(...kids); }
  remove() {}
  get textContent() {
    if (this._text) return this._text;
    return this.children.map((c) => (c.nodeType === 3 ? c.text : c.textContent)).join('');
  }
  set textContent(v) { this._text = String(v); this.children = []; }
}
const uiRoot = new MiniNode('div');
globalThis.document = {
  createElement: (t) => new MiniNode(t),
  createElementNS: (ns, t) => new MiniNode(t),
  createTextNode: (s) => ({ nodeType: 3, text: String(s) }),
  getElementById: () => uiRoot,
  body: uiRoot,
};

const { newGame, update } = await import('../src/sim/state.js');
const { makeLaptop } = await import('../src/ui/laptop.js');
const { placeOrder } = await import('../src/sim/shop.js');
const { bookSlot, daySheet } = await import('../src/sim/reservations.js');
const { refreshMarketIfDue, hireStaff } = await import('../src/sim/staff.js');
const { calendarOf } = await import('../src/sim/time.js');
const { notify } = await import('../src/sim/notifications.js');
const { postReview } = await import('../src/sim/reviews.js');

const PAGE_IDS = [
  'home', 'reservations', 'customers', 'memberships', 'rentals',
  'shop', 'inventory', 'supplier', 'orders', 'deliveries', 'pricing',
  'finances', 'employees', 'reviews', 'marketing',
  'course', 'maintenance', 'upgrades', 'events', 'reno',
  'analytics', 'notifications', 'settings', 'help',
];

function walk(node, fn) {
  fn(node);
  for (const c of node.children || []) if (c.nodeType === 1) walk(c, fn);
}
function crashCard(root) {
  let found = null;
  walk(root, (n) => {
    if (String(n.className).includes('lt-err') && /could not be drawn|no application called/.test(n.textContent)) {
      found = n.textContent;
    }
  });
  return found;
}

function openLaptop(state) {
  const app = { state, audio: null, scene3d: null, empire: null };
  const lap = makeLaptop(app, { close: () => {}, openCourseEditor: () => {} });
  lap.open('home');
  return lap;
}

test('every sidebar destination draws on a brand-new club without throwing', () => {
  const st = newGame('relaxed', 71);
  const lap = openLaptop(st);
  for (const id of PAGE_IDS) {
    lap.go(id);
    assert.equal(lap.pageId(), id, `navigated to ${id}`);
    const crash = crashCard(lap.root);
    assert.equal(crash, null, `page "${id}" drew an error card: ${crash}`);
  }
  lap.close();
});

test('every page also draws on a lived-in club — orders, bookings, staff, reviews, days', () => {
  const st = newGame('relaxed', 72);
  st.cash = 60000;
  st.shop.unlockedTier = 3;
  placeOrder(st, 'balls1', 12);
  const cal = calendarOf(st.clock.minutes);
  const free = daySheet(st, cal.dayAbs).filter((s) => !s.res).slice(0, 2);
  for (const s of free) bookSlot(st, cal.dayAbs, s.minute, `Guest ${s.minute}`);
  refreshMarketIfDue(st, cal.dayAbs);
  if (st.staff.market[0]) hireStaff(st, st.staff.market[0].id);
  postReview(st, { stars: 2, text: 'The register queue was brutal.', day: cal.dayAbs, cited: [{ id: 'waitTime' }] });
  notify(st, { kind: 'money', text: 'Rent is due soon.' });
  update(st, 1440 * 3); // three lived days: ledger history, accruals, deliveries
  const lap = openLaptop(st);
  for (const id of PAGE_IDS) {
    lap.go(id);
    const crash = crashCard(lap.root);
    assert.equal(crash, null, `page "${id}" drew an error card: ${crash}`);
  }
  lap.close();
});

test('an unknown page id lands on the shell error state, not a throw', () => {
  const st = newGame('relaxed', 73);
  const lap = openLaptop(st);
  lap.go('no-such-desk');
  const crash = crashCard(lap.root);
  assert.ok(crash && /no application called/.test(crash));
  lap.close();
});

test('back() walks the history it came from', () => {
  const st = newGame('relaxed', 74);
  const lap = openLaptop(st);
  lap.go('finances');
  lap.go('inventory');
  lap.back();
  assert.equal(lap.pageId(), 'finances');
  lap.back();
  assert.equal(lap.pageId(), 'home');
  lap.close();
});
