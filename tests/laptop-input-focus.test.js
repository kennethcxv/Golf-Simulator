// EVERY FIELD IN THE LAPTOP TAKES A WHOLE WORD.
//
// Reported 2026-07-30: "the pro shop product search only accepts one character. Typing in the
// product search under Pro Shop loses focus after every keystroke, so I can only enter one
// letter at a time." And: "find every input in the laptop with this problem, not just this one."
//
// The cause is one line: paint() is `paintTarget.replaceChildren(...)`, so a render rebuilds
// the entire page subtree. Detaching an element blurs it, and a field whose oninput calls
// render() therefore deletes itself mid-keystroke — character two arrives with nothing focused
// and the browser drops it. Nothing in any handler is wrong; the second character never
// reaches one.
//
// So this file models the ONE browser behaviour that matters and would otherwise be assumed
// away: replaceChildren blurs what it detaches, and a keystroke goes to document.activeElement
// or nowhere. Then it types "abcde" into every text field on every page — with a render fired
// between keystrokes, which is what the 1 Hz refreshLive clock does whether anyone is typing or
// not — and asserts the whole word arrives.
import test from 'node:test';
import assert from 'node:assert/strict';

// --- a DOM with focus in it -----------------------------------------------------------------
let doc = null;

function detach(node) {
  if (!node || node.nodeType !== 1) return;
  // THE BROWSER RULE THIS FILE EXISTS FOR: removing an element from the document blurs it,
  // and blurs anything inside it. Re-inserting the same element a microsecond later does not
  // give the focus back.
  if (doc.activeElement && node.contains(doc.activeElement)) doc.activeElement = doc.body;
  node.parentNode = null;
}

class MiniNode {
  constructor(tag) {
    this.tagName = tag;
    this.nodeType = 1;
    this.children = [];
    this.attrs = {};
    this.className = '';
    this._text = '';
    this.parentNode = null;
    this.value = '';
    this.checked = false;
    this.disabled = false;
    this.selectionStart = 0;
    this.selectionEnd = 0;
    this.scrollTop = 0;
    this.scrolledIntoView = 0;
    this.style = { display: '', setProperty: () => {} };
    const self = this;
    this.classList = {
      add: (c) => { const s = self._set(); s.add(c); self.className = [...s].join(' '); },
      remove: (c) => { const s = self._set(); s.delete(c); self.className = [...s].join(' '); },
      toggle: (c, on) => {
        const s = self._set();
        const want = on === undefined ? !s.has(c) : !!on;
        if (want) s.add(c); else s.delete(c);
        self.className = [...s].join(' ');
      },
      contains: (c) => self._set().has(c),
    };
  }

  _set() { return new Set(String(this.className).split(/\s+/).filter(Boolean)); }

  setAttribute(k, v) {
    this.attrs[k] = String(v);
    if (k === 'class') this.className = String(v);
    if (k === 'value') this.value = String(v);
    if (k === 'disabled') this.disabled = true;
  }

  getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener(type, fn) { (this._listeners ||= {})[type] ||= []; this._listeners[type].push(fn); }
  removeEventListener() {}
  scrollIntoView() { this.scrolledIntoView += 1; }
  focus() { doc.activeElement = this; }
  blur() { if (doc.activeElement === this) doc.activeElement = doc.body; }
  setSelectionRange(a, b) { this.selectionStart = a; this.selectionEnd = b; }

  fire(type, extra = {}) {
    const event = { target: this, stopPropagation() {}, preventDefault() {}, ...extra };
    for (const fn of (this._listeners && this._listeners[type]) || []) fn(event);
  }

  click() { this.fire('click'); }

  append(...kids) {
    for (const k of kids) {
      const node = k && k.nodeType ? k : { nodeType: 3, text: String(k) };
      if (node.nodeType === 1) {
        // Appending an element that already has a parent MOVES it: the browser runs the
        // removal steps on the old parent first, and removal blurs. A page function that
        // reuses a field element therefore blurs it while BUILDING the new tree, before
        // anything is swapped in — which is why the focus has to be captured before the
        // page function runs, not when the subtree is replaced.
        if (node.parentNode && node.parentNode !== this) {
          node.parentNode.children = node.parentNode.children.filter((c) => c !== node);
        }
        detach(node);
        node.parentNode = this;
      }
      this.children.push(node);
    }
  }

  appendChild(k) { this.append(k); return k; }

  replaceChildren(...kids) {
    for (const child of this.children) detach(child);
    this.children = [];
    this.append(...kids);
  }

  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((c) => c !== this); detach(this); }

  contains(node) {
    let n = node;
    while (n) { if (n === this) return true; n = n.parentNode; }
    return false;
  }

  get textContent() {
    if (this._text) return this._text;
    return this.children.map((c) => (c.nodeType === 3 ? c.text : c.textContent)).join('');
  }

  set textContent(v) { this._text = String(v); this.children = []; }

  matches(selector) {
    for (const one of String(selector).split(',').map((s) => s.trim()).filter(Boolean)) {
      const attr = one.match(/^\[([^=\]]+)="([^"]*)"\]$/);
      if (attr) { if (this.getAttribute(attr[1]) === attr[2]) return true; }
      else if (one.startsWith('.')) { if (this.classList.contains(one.slice(1))) return true; }
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

  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

const uiRoot = new MiniNode('div');
doc = {
  createElement: (t) => new MiniNode(t),
  createElementNS: (ns, t) => new MiniNode(t),
  createTextNode: (s) => ({ nodeType: 3, text: String(s) }),
  getElementById: () => uiRoot,
  body: uiRoot,
  activeElement: uiRoot,
};
globalThis.document = doc;

const { newGame } = await import('../src/sim/state.js');
const { makeLaptop } = await import('../src/ui/laptop.js');
const { hireStaff, refreshMarketIfDue } = await import('../src/sim/staff.js');
const { calendarOf } = await import('../src/sim/time.js');
const { placeOrder } = await import('../src/sim/shop.js');
const { LAPTOP_SECTIONS, tabsOf } = await import('../src/ui/laptopSearch.js');

// --- the instrument -------------------------------------------------------------------------

function walk(node, fn) {
  fn(node);
  for (const child of node.children || []) if (child.nodeType === 1) walk(child, fn);
}

function allNodes(root, predicate) {
  const out = [];
  walk(root, (n) => { if (predicate(n)) out.push(n); });
  return out;
}

const TEXTY = new Set(['text', 'search', undefined]);
const textFields = (root) => allNodes(root, (n) => n.tagName === 'input' && TEXTY.has(n.attrs.type) && n.attrs.type !== 'checkbox');
const everyField = (root) => allNodes(root, (n) => n.tagName === 'input');

/**
 * Type, the way a keyboard types: one character at a time into whatever holds focus.
 *
 * If a render detached the field, document.activeElement is the body and the character has
 * nowhere to go — it is DROPPED, exactly as the browser drops it. That is the whole bug, and
 * a test that assigns the finished string to `input.value` cannot see it.
 *
 * `between` runs after each keystroke: the laptop's own 1 Hz clock re-renders pages while a
 * player types, so surviving your own keystroke is not enough — a field has to survive a
 * render nobody asked for.
 */
function typeWord(field, word, between = null) {
  field.focus();
  let delivered = '';
  for (const ch of word) {
    const active = doc.activeElement;
    if (!active || active.tagName !== 'input') continue; // the keystroke fell on the floor
    active.value = `${active.value}${ch}`;
    active.selectionStart = active.value.length;
    active.selectionEnd = active.value.length;
    delivered += ch;
    active.fire('input');
    if (between) between();
  }
  return delivered;
}

function livedInClub() {
  const st = newGame('relaxed', 909);
  const cal = calendarOf(st.clock.minutes);
  refreshMarketIfDue(st, cal.dayAbs);
  if (st.staff.market.length) hireStaff(st, st.staff.market[0].id);
  placeOrder(st, 'balls1', 4);
  return st;
}

function openLaptop(state = livedInClub()) {
  doc.activeElement = uiRoot;
  const app = { state, audio: null, scene3d: null, empire: null };
  const lap = makeLaptop(app, { close: () => {}, openCourseEditor: () => {} });
  uiRoot.replaceChildren(lap.root); // a real document, so contains()/blur mean something
  lap.open('home');
  return lap;
}

/** Put a field back the way it was found, state and all, so the next stop starts clean. */
function clearField(field, was) {
  field.value = was;
  field.fire('input');
  doc.activeElement = uiRoot;
}

/** Click the tab whose label the page map declares — the player's route to a tab. */
function openTab(lap, page, label) {
  lap.go(page);
  const tab = allNodes(lap.root, (n) => n.classList.contains('lt-tab') && n.textContent.startsWith(label))[0];
  if (tab) tab.click();
  return !!tab;
}

/** Every text field the laptop can put on screen, with the route to reach it. */
function visitEveryTextField(lap, visit) {
  let seen = 0;
  const sweep = (where) => {
    for (const field of textFields(lap.root)) {
      const key = field.getAttribute('data-lt-field');
      seen += 1;
      visit(field, key, where);
    }
  };
  for (const section of LAPTOP_SECTIONS) {
    const tabs = tabsOf(section.page);
    if (!tabs.length) { lap.go(section.page); sweep(section.label); continue; }
    for (const [, label] of tabs) {
      openTab(lap, section.page, label);
      sweep(`${section.label} › ${label}`);
    }
  }
  return seen;
}

// --- the bug, and the fix --------------------------------------------------------------------

test('the harness drops a keystroke when the field is detached - the bug is reachable', () => {
  // A control for the instrument. If typing into a detached field still "worked", every
  // assertion below would be green against the broken code too.
  const host = new MiniNode('div');
  uiRoot.replaceChildren(host);
  const victim = new MiniNode('input');
  victim.attrs.type = 'text';
  victim.addEventListener('input', () => { host.replaceChildren(new MiniNode('input')); });
  host.replaceChildren(victim);
  assert.equal(typeWord(victim, 'abcde'), 'a', 'the first character lands, the rest have nowhere to go');
  assert.equal(victim.value, 'a');
  uiRoot.replaceChildren();
});

test('the Pro Shop product search takes a whole word', () => {
  // The reported bug, at the reported place. Its oninput calls render(), which replaces the
  // whole page — so before the fix this field held "a" and nothing else.
  const lap = openLaptop();
  assert.ok(openTab(lap, 'shop', 'Inventory'), 'the Inventory tab must be reachable');
  const field = lap.root.querySelector('[data-lt-field="shop-stock-search"]');
  assert.ok(field, 'the product search must be on the Inventory tab');
  assert.equal(typeWord(field, 'glove'), 'glove', 'every keystroke must find a focused field');
  const live = lap.root.querySelector('[data-lt-field="shop-stock-search"]');
  assert.equal(live.value, 'glove', 'the field holds the whole word, not its first letter');
  assert.equal(doc.activeElement, live, 'and the caret is still in it');
  assert.equal(live.selectionStart, 5, 'the caret sits after what was typed, not at the start');
});

test('the ordering grid search takes a whole word too', () => {
  const lap = openLaptop();
  assert.ok(openTab(lap, 'shop', 'Orders & Suppliers'), 'the ordering tab must be reachable');
  const field = lap.root.querySelector('[data-lt-field="shop-order-search"]');
  assert.ok(field, 'the browse grid has its own product search');
  assert.equal(typeWord(field, 'towel'), 'towel');
  assert.equal(lap.root.querySelector('[data-lt-field="shop-order-search"]').value, 'towel');
});

test('the toolbar search takes a whole word, and keeps it across the pages it draws', () => {
  const lap = openLaptop();
  const field = lap.root.querySelector('[data-lt-field="laptop-search"]');
  assert.ok(field, 'the toolbar search must exist');
  assert.equal(typeWord(field, 'kit'), 'kit');
  assert.equal(field.value, 'kit');
  assert.ok(lap.root.querySelectorAll('.lt-hit').length > 0, 'and the results are live as it goes');
});

test('EVERY text field in the laptop takes a whole word, through a render it did not ask for', () => {
  // The sweep the report asked for: "find every input in the laptop with this problem, not
  // just this one." Every page, every tab, every text field — and a render fired after each
  // keystroke, because refreshLive() redraws Home, Orders and Deliveries once a second
  // regardless of what the player is doing.
  const lap = openLaptop();
  const visited = [];
  const failures = [];
  const seen = visitEveryTextField(lap, (field, key, where) => {
    if (!key) { failures.push(`${where}: a text field with no focus key - paint() cannot restore it`); return; }
    if (visited.includes(key)) return;
    visited.push(key);
    const before = field.value;
    const delivered = typeWord(field, 'abcde', () => lap.render());
    const live = lap.root.querySelector(`[data-lt-field="${key}"]`);
    if (delivered !== 'abcde') failures.push(`${where} (${key}): only ${JSON.stringify(delivered)} was delivered`);
    else if (!live) failures.push(`${where} (${key}): the field is gone after typing`);
    else if (live.value !== `${before}abcde`) failures.push(`${where} (${key}): holds ${JSON.stringify(live.value)}`);
    else if (doc.activeElement !== live) failures.push(`${where} (${key}): lost the caret`);
    // The toolbar field is on EVERY page, and a live query replaces the page it is typed on —
    // so leaving "abcde" in it would hide every page-level field from the rest of the sweep.
    if (live) clearField(live, before);
  });
  assert.deepEqual(failures, []);
  assert.ok(seen > 0, 'the sweep must actually find fields, or it proves nothing');
  // …and it must have found the ones we know about, or a future refactor could empty the
  // sweep and leave this test green over nothing.
  for (const key of ['laptop-search', 'shop-stock-search', 'shop-order-search', 'settings-clubname']) {
    assert.ok(visited.includes(key), `the sweep never reached ${key} - it visited ${visited.join(', ')}`);
  }
});

test('every input the laptop draws carries a focus key, sliders and switches included', () => {
  // paint() restores focus by key. A field with no key is a field that silently loses focus
  // the next time anything re-renders, so "has a key" is the contract, not an optimisation.
  const lap = openLaptop();
  const missing = new Set();
  for (const section of LAPTOP_SECTIONS) {
    const tabs = tabsOf(section.page);
    const stops = tabs.length ? tabs.map(([, label]) => label) : [null];
    for (const label of stops) {
      if (label) openTab(lap, section.page, label); else lap.go(section.page);
      for (const input of everyField(lap.root)) {
        if (!input.getAttribute('data-lt-field')) {
          missing.add(`${section.label}${label ? ` › ${label}` : ''}: <input type=${input.attrs.type}>`);
        }
      }
    }
  }
  assert.deepEqual([...missing], []);
});

test('a slider keeps the caret when a background render lands on it', () => {
  const lap = openLaptop();
  openTab(lap, 'shop', 'Pricing');
  const fee = lap.root.querySelector('[data-lt-field="prices-greenfee"]');
  assert.ok(fee, 'the green fee slider must be on the Pricing tab');
  fee.focus();
  lap.render();
  const live = lap.root.querySelector('[data-lt-field="prices-greenfee"]');
  assert.ok(live, 'the slider survives the render');
  assert.equal(doc.activeElement, live, 'a render must not steal the focus off a control mid-drag');
});

test('a field nobody is typing into follows the state; one being typed into is left alone', () => {
  // keepField hands the SAME element back on every render, so it has to be re-synced from
  // state when the state moves underneath it — and must NEVER be re-synced while the player
  // is in it, or "typing loses a character" comes back wearing different clothes.
  const st = livedInClub();
  const lap = openLaptop(st);
  openTab(lap, 'settings', 'General');
  const name = lap.root.querySelector('[data-lt-field="settings-clubname"]');
  assert.ok(name, 'the club name field must be on the General tab');
  assert.equal(name.value, st.clubName, 'it opens holding the club\'s real name');

  doc.activeElement = uiRoot;
  st.clubName = 'Fox Run';
  lap.render();
  assert.equal(lap.root.querySelector('[data-lt-field="settings-clubname"]').value, 'Fox Run',
    'a field nobody is in re-reads the state');

  const typed = typeWord(name, ' South', () => lap.render());
  assert.equal(typed, ' South', 'every keystroke lands');
  assert.equal(lap.root.querySelector('[data-lt-field="settings-clubname"]').value, 'Fox Run South',
    'and the renders those keystrokes caused did not reset it to the stored name');
});
