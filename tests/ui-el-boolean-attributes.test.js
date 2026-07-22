import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// el() builds real DOM nodes, so give it just enough of one to observe attributes.
function stubDocument() {
  globalThis.document = {
    createElement(tag) {
      return {
        tagName: tag.toUpperCase(),
        className: '',
        textContent: '',
        attrs: new Map(),
        listeners: [],
        setAttribute(k, v) { this.attrs.set(k, String(v)); },
        removeAttribute(k) { this.attrs.delete(k); },
        getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; },
        hasAttribute(k) { return this.attrs.has(k); },
        addEventListener(type, fn) { this.listeners.push([type, fn]); },
        append() {},
      };
    },
  };
}

stubDocument();
const { el } = await import('../src/ui/ui.js');

// A boolean HTML attribute is present-or-absent. setAttribute('disabled', false)
// yields disabled="false", which the browser still treats as disabled — that bug
// left the Course Editor's active pin button permanently unclickable.
test('boolean false removes the attribute rather than writing "false"', () => {
  const node = el('button', { text: 'Play B', disabled: false });
  assert.equal(node.hasAttribute('disabled'), false);
  assert.equal(node.getAttribute('disabled'), null);
});

test('boolean true writes a present, empty-valued attribute', () => {
  const node = el('button', { text: 'Play B', disabled: true });
  assert.equal(node.hasAttribute('disabled'), true);
  assert.equal(node.getAttribute('disabled'), '');
});

test('the established string/undefined idiom is unchanged', () => {
  assert.equal(el('button', { disabled: 'disabled' }).getAttribute('disabled'), 'disabled');
  assert.equal(el('button', { disabled: undefined }).hasAttribute('disabled'), false);
  assert.equal(el('button', { disabled: null }).hasAttribute('disabled'), false);
  assert.equal(el('option', { disabled: '' }).getAttribute('disabled'), '');
});

test('non-boolean attributes, class, text and handlers still round-trip', () => {
  let fired = 0;
  const node = el('input', { class: 'ced-row', text: 'hi', value: 0, onclick: () => { fired += 1; } });
  assert.equal(node.className, 'ced-row');
  assert.equal(node.textContent, 'hi');
  assert.equal(node.getAttribute('value'), '0', 'falsy non-boolean values are preserved');
  assert.equal(node.listeners.length, 1);
  node.listeners[0][1]();
  assert.equal(fired, 1);
});

// Guard the call site that actually shipped the defect.
test('course editor pin buttons never pass a raw boolean to el()', () => {
  const source = readFileSync(new URL('../src/ui/courseEditor.js', import.meta.url), 'utf8');
  assert.ok(
    !/disabled:\s*!/.test(source),
    'a negated boolean passed as `disabled` re-introduces the stuck-disabled pin button',
  );
});
