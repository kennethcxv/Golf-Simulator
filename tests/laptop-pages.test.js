// EVERY PAGE OF GOLF SIMULATOR, DRAWN HEADLESS.
//
// makeLaptop is DOM code, but its pages are pure functions of the sim state — so a sixty-line
// stand-in for the handful of DOM calls they make is enough to draw every page and tab
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
  addEventListener(type, fn) { (this._listeners ||= {})[type] ||= []; this._listeners[type].push(fn); }
  removeEventListener() {}
  click() { for (const fn of (this._listeners && this._listeners.click) || []) fn({ target: this }); }
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

const { newGame, update, serialize, deserialize } = await import('../src/sim/state.js');
const { makeLaptop } = await import('../src/ui/laptop.js');
const { placeOrder } = await import('../src/sim/shop.js');
const { bookSlot, daySheet } = await import('../src/sim/reservations.js');
const { refreshMarketIfDue, hireStaff } = await import('../src/sim/staff.js');
const { calendarOf } = await import('../src/sim/time.js');
const { notify } = await import('../src/sim/notifications.js');
const { postReview } = await import('../src/sim/reviews.js');
const { clubRatings, amenityScore, fairGreenFee } = await import('../src/sim/club.js');
const { formatMoney } = await import('../src/core/utils.js');

// THE WHOLE SIDEBAR: seven pages, nothing else. Retired desk ids stay routable
// through PAGE_ALIAS — tested separately below.
const PAGE_IDS = [
  'home', 'reservations', 'shop', 'course', 'upgrades', 'finances', 'settings',
];
// every retired desk id and the (page, tab) it must land on
const ALIASES = {
  inventory: ['shop'], supplier: ['shop'], pricing: ['shop'], orders: ['shop'], deliveries: ['shop'],
  maintenance: ['course'], reno: ['course'],
  employees: ['upgrades'], rentals: ['upgrades'], events: ['upgrades'],
  analytics: ['finances'],
  reviews: ['finances'], marketing: ['finances'], notifications: ['home'], help: ['home'],
  customers: ['reservations'], memberships: ['finances'],
};

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

function checkboxForLabel(root, label) {
  let match = null;
  walk(root, (node) => {
    if (match || node.tagName !== 'label' || !node.textContent.includes(label)) return;
    walk(node, (child) => {
      if (!match && child.tagName === 'input' && child.attrs.type === 'checkbox') match = child;
    });
  });
  return match;
}

function firstNode(root, predicate) {
  let match = null;
  walk(root, (node) => { if (!match && predicate(node)) match = node; });
  return match;
}

function openLaptop(state) {
  const app = { state, audio: null, scene3d: null, empire: null };
  const lap = makeLaptop(app, { close: () => {}, openCourseEditor: () => {} });
  lap.open('home');
  return lap;
}

test('the physical laptop is the player-facing route to property acquisitions', () => {
  const st = newGame('relaxed', 70);
  let opened = 0;
  const app = {
    state: st,
    audio: null,
    scene3d: null,
    empire: { holdings: [{ property: { id: 'willow-creek' } }], market: [{ id: 'bent-pines' }, { id: 'flatiron-meadows' }] },
  };
  const lap = makeLaptop(app, {
    close: () => {},
    openCourseEditor: () => {},
    openPropertyMarket: () => { opened += 1; },
  });
  lap.open('home');
  assert.match(lap.root.textContent, /Acquisitions are handled from this front-desk laptop/);
  const browse = firstNode(lap.root, (node) => node.tagName === 'button' && node.textContent === 'Browse Properties');
  assert.ok(browse, 'Home exposes the property market');
  browse.click();
  assert.equal(opened, 1, 'the laptop delegates to the property market exactly once');
  lap.close();
});

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

test('every page also draws on a lived-in club - orders, bookings, staff, reviews, days', () => {
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

test('every retired desk id forwards to the page that absorbed it', () => {
  const st = newGame('relaxed', 75);
  const lap = openLaptop(st);
  for (const [oldId, [target]] of Object.entries(ALIASES)) {
    lap.go('home', { replace: true });
    lap.go(oldId);
    assert.equal(lap.pageId(), target, `"${oldId}" should land on "${target}"`);
    const crash = crashCard(lap.root);
    assert.equal(crash, null, `alias "${oldId}" drew an error card: ${crash}`);
  }
  lap.close();
});

test('the tabbed pages draw every tab without throwing', () => {
  const st = newGame('relaxed', 76);
  st.cash = 60000;
  placeOrder(st, 'balls1', 12);
  update(st, 1440);
  const lap = openLaptop(st);
  const clickTab = (label) => {
    let btn = null;
    walk(lap.root, (n) => {
      if (!btn && n.tagName === 'button' && String(n.className).includes('lt-tab') && n.textContent === label) btn = n;
    });
    assert.ok(btn, `tab "${label}" exists`);
    btn.click();
  };
  const drive = (pageId, tabs) => {
    lap.go(pageId);
    for (const tab of tabs) {
      clickTab(tab);
      const crash = crashCard(lap.root);
      assert.equal(crash, null, `${pageId}:${tab} drew an error card: ${crash}`);
    }
  };
  drive('shop', ['Inventory', 'Orders & Suppliers', 'Pricing', 'Deliveries']);
  drive('course', ['Overview', 'Tasks', 'Holes']);
  drive('upgrades', ['Course', 'Renovations', 'Staff', 'Equipment']);
  drive('finances', ['Finances', 'Reviews', 'Memberships', 'Marketing']);
  drive('settings', ['General', 'Checkout']);
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

test('checkout accessibility settings are player-facing and write persisted ui preferences', () => {
  const st = newGame('relaxed', 77);
  const lap = openLaptop(st);
  lap.go('settings');
  let checkoutTab = null;
  walk(lap.root, (node) => {
    if (!checkoutTab && node.tagName === 'button' && node.textContent === 'Checkout') checkoutTab = node;
  });
  assert.ok(checkoutTab, 'Checkout settings tab is visible');
  checkoutTab.click();
  const choices = [
    ['Larger POS text and targets', 'largeTextAndTargets', true],
    ['Reduced checkout camera motion', 'reducedCameraMotion', true],
    ['Faster checkout animations', 'fasterAnimations', true],
    ['Automatic exact change', 'automaticExactChange', true],
    ['Confirm cash purchases', 'confirmCashPurchase', false],
  ];
  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (callback) => { callback(); return 0; };
  try {
    for (const [label, key, checked] of choices) {
      const input = checkboxForLabel(lap.root, label);
      assert.ok(input, `setting "${label}" is visible`);
      const listener = input._listeners?.change?.[0];
      assert.equal(typeof listener, 'function', `setting "${label}" is wired`);
      listener({ target: { checked } });
      assert.equal(st.uiPrefs.checkout[key], checked);
    }
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }
  lap.close();
});

test('business tabs expose live reviews, memberships, marketing, utilities, and persist their real controls', () => {
  const st = newGame('relaxed', 78);
  const cal = calendarOf(st.clock.minutes);
  postReview(st, {
    stars: 2,
    text: 'The shelves were bare.',
    day: cal.dayAbs,
    cited: [{ id: 'stock' }],
  });
  const lap = openLaptop(st);

  lap.go('reviews');
  assert.equal(lap.pageId(), 'finances');
  assert.match(lap.root.textContent, /What guests experience right now/);
  assert.match(lap.root.textContent, /The shelves were bare/);

  lap.go('memberships');
  assert.match(lap.root.textContent, /Fairway Card/);
  assert.match(lap.root.textContent, /Member Roll/);
  const duesSlider = firstNode(lap.root, (node) => node.tagName === 'input' && node.attrs.type === 'range');
  assert.ok(duesSlider, 'membership dues slider is visible');
  const nextDues = Number(st.club.dues.weekday) + 25;
  duesSlider._listeners.input[0]({ target: { value: String(nextDues) } });
  assert.equal(st.club.dues.weekday, nextDues, 'the visible slider writes the membership model');

  lap.go('marketing');
  assert.match(lap.root.textContent, /Why demand moved/);
  assert.match(lap.root.textContent, /15% shopper-attention nudge/);
  const featureButton = firstNode(lap.root, (node) => node.tagName === 'button' && node.textContent === 'Golf balls');
  assert.ok(featureButton, 'a real merchandise feature control is visible');
  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (callback) => { callback(); return 0; };
  try {
    featureButton.click();
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }
  assert.equal(st.shop.featureCategory, 'balls');

  lap.go('analytics');
  assert.match(lap.root.textContent, /Daily Commitments/);
  assert.match(lap.root.textContent, /Utilities\$45/);

  const loaded = deserialize(serialize(st));
  assert.equal(loaded.club.dues.weekday, nextDues, 'membership pricing survives save/load');
  assert.equal(loaded.shop.featureCategory, 'balls', 'the marketing feature survives save/load');
  lap.close();
});

test('pro-shop supplier identity and complete booking verification are visible', () => {
  const st = newGame('relaxed', 79);
  const cal = calendarOf(st.clock.minutes);
  const booked = bookSlot(st, cal.dayAbs, 600, {
    name: 'Morgan Fairway',
    partySize: 3,
    holes: 9,
    transport: 'cart',
    rentalRequirements: ['clubs'],
    paymentPreference: 'cash',
  });
  assert.equal(booked.ok, true);
  const lap = openLaptop(st);

  lap.go('supplier');
  assert.match(lap.root.textContent, /Fairway Supply Co\./);
  assert.match(lap.root.textContent, /Ironwood Golf/);
  assert.match(lap.root.textContent, /Sunday Round Apparel/);

  lap.go('reservations');
  const viewButton = firstNode(lap.root, (node) => node.tagName === 'button' && node.textContent === 'View');
  assert.ok(viewButton, 'booking detail is reachable');
  viewButton.click();
  assert.match(lap.root.textContent, /Round9 holes · cart/);
  assert.match(lap.root.textContent, /Rentalsclubs/);
  assert.match(lap.root.textContent, /Payment preferenceCash/);
  lap.close();
});

test('opening-day management headlines distinguish history, sentiment, and shelf risk', () => {
  const st = newGame('relaxed', 80);
  const lap = openLaptop(st);

  assert.match(lap.root.textContent, /Bookings/);
  assert.match(lap.root.textContent, /Pro Shop/);

  lap.go('memberships');
  assert.match(lap.root.textContent, /0 joined in the last 7 days/);

  lap.go('marketing');
  assert.match(lap.root.textContent, /Guest sentimentNo reviews yetNo signal/);

  lap.go('shop');
  assert.match(lap.root.textContent, /Shelf Risks/);
  assert.match(lap.root.textContent, /Fully out/);

  lap.go('reservations');
  assert.match(lap.root.textContent, /Groups on Sheet/);
  assert.match(lap.root.textContent, /Front-desk flow/);
  assert.match(lap.root.textContent, /physical desk monitor/);

  lap.go('deliveries');
  assert.match(lap.root.textContent, /Receiving Pad/);
  assert.match(lap.root.textContent, /OrderChoose products and suppliers/);
  assert.match(lap.root.textContent, /StockCarry, cut, unpack, and shelve/);

  st.club.amenities.range = 3;
  st.club.amenities.restaurant = 3;
  st.club.amenities.instruction = 2;
  lap.go('pricing');
  const fair = fairGreenFee(clubRatings(st).overall, amenityScore(st));
  assert.match(lap.root.textContent, new RegExp(`fair fee for this course is about \\${formatMoney(fair)}`));
  assert.match(lap.root.textContent, /× demand/);
  assert.match(lap.root.textContent, /% \/ \$[\d,]+ sample/);

  lap.go('maintenance');
  assert.match(lap.root.textContent, /Turf Issues/);
  assert.match(lap.root.textContent, /Priority Jobs/);
  assert.match(lap.root.textContent, /Priority Cost/);
  assert.doesNotMatch(lap.root.textContent, /Pond —|(?:Fairway|Greenside) bunker[^—]*— (?:Stressed|Declining)/i);
  assert.match(lap.root.textContent, /Increase water|Feed at dawn|Mow at dawn|Aerate|Rest \/ monitor/);

  lap.go('employees');
  assert.match(lap.root.textContent, /Role Coverage/);
  assert.match(lap.root.textContent, /Course Crew/);
  lap.close();
});

// BLOCKER 3 — "the shop page could not be drawn: Cannot read properties of
// undefined (reading 'cat')", reported while ordering, with the order itself
// reported as received.
//
// The seed is in planOrder: a shipment carrying more than one line names no
// single product, so it stores `skuId: null`. That is the NORMAL shape of
// ordering several things at once. Every consumer that did `skuById(o.skuId)`
// then got undefined and read `.cat`/`.name` straight off it, and the whole
// page went down — after the order had already committed, which is why the
// notification said "orders received" while the screen showed a crash.
test('a multi-line order draws - its skuId is null by design, not by accident', async () => {
  const { submitPurchaseOrders } = await import('../src/sim/inventoryLifecycle.js');
  const st = newGame('relaxed', 71);
  st.cash = 5000;

  const res = submitPurchaseOrders(st, {
    lines: [
      { skuId: 'balls1', quantity: 2 },
      { skuId: 'chips1', quantity: 2 },
      { skuId: 'towel1', quantity: 1 },
    ],
  });
  assert.equal(res.ok, true, res.reason || '');

  const order = st.shop.orders[st.shop.orders.length - 1];
  // Pin the shape that caused it, so a future "fix" upstream is a deliberate
  // decision rather than a silent change under the page code.
  assert.equal(order.skuId, null, 'a mixed shipment names no single sku');
  assert.equal(order.lines.length, 3);

  const lap = openLaptop(st);
  lap.go('shop');
  assert.equal(crashCard(lap.root), null, 'the shop page must draw with a mixed order pending');
  lap.go('deliveries');
  assert.equal(crashCard(lap.root), null, 'the deliveries tab hosts the order rows - it must draw too');
  // and it must actually SAY something useful about the shipment
  assert.match(lap.root.textContent, /3 items × 5 units/);
  lap.close();
});

test('a single-line order still names its product', () => {
  const st = newGame('relaxed', 72);
  st.cash = 5000;
  assert.equal(placeOrder(st, 'balls1', 3).ok, true);
  const lap = openLaptop(st);
  lap.go('deliveries');
  assert.equal(crashCard(lap.root), null);
  assert.doesNotMatch(lap.root.textContent, /items × \d+ units/, 'a one-product order is named, not summarised');
  lap.close();
});
