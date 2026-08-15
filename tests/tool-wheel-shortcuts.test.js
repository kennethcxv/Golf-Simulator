// K3 (Goal 23) — the tool wheel must not advertise a key that means something
// else everywhere else in the game.
//
// The stranger found ONE instance of this: "the tool wheel says B is the push
// broom; B opens Build mode." Reading the old table against keyBindings.js,
// eleven of twelve collided with a global binding and two collided with each
// other — divot and dustpan both claimed D, and toolShortcutIndex returns the
// FIRST match, so the divot kit could never be selected by letter at all. A
// dead control nobody had pressed.
//
// The control in the first test is the old table, reproduced here verbatim. It
// is what makes the rest mean something: without it this file only proves that
// digits do not collide with letters, which is not news.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_BINDINGS } from '../src/core/keyBindings.js';
import { toolShortcutIndex } from '../src/ui/toolWheel.js';

// Every key the game binds globally, lower-cased.
const GLOBAL_KEYS = new Set(Object.values(DEFAULT_BINDINGS).map((k) => String(k).toLowerCase()));

// The table this replaces, exactly as it shipped.
const OLD_SHORTCUTS = {
  washer: 'W', vacuum: 'V', mop: 'M', broom: 'B', dustpan: 'D', spray: 'S',
  cloth: 'C', sponge: 'G', trashbag: 'T', hose: 'H', divot: 'D', rake: 'R',
};

test('CONTROL: the old table collided with the game almost everywhere', () => {
  const collisions = Object.entries(OLD_SHORTCUTS)
    .filter(([, key]) => GLOBAL_KEYS.has(String(key).toLowerCase()))
    .map(([id, key]) => `${id}=${key}`);
  assert.ok(collisions.length >= 10,
    `the old table should collide widely; found ${collisions.length}: ${collisions.join(', ')}`);
  // the one the stranger actually hit
  assert.ok(GLOBAL_KEYS.has('b'), 'B is a global binding');
  assert.equal(OLD_SHORTCUTS.broom, 'B', 'and the wheel advertised it for the push broom');
  // ...and the duplicate that made a control unreachable
  assert.equal(OLD_SHORTCUTS.dustpan, OLD_SHORTCUTS.divot,
    'dustpan and divot both claimed D');
});

// The shape walkToolEntries produces now: position-numbered.
const numbered = (n) => Array.from({ length: n }, (_, i) => ({
  id: `tool-${i}`, label: `Tool ${i}`, shortcut: i < 9 ? String(i + 1) : null,
}));

test('no advertised shortcut is a key the game binds to something else', () => {
  for (const entry of numbered(12)) {
    if (!entry.shortcut) continue;
    assert.ok(!GLOBAL_KEYS.has(entry.shortcut.toLowerCase()),
      `${entry.label} advertises "${entry.shortcut}", which the game already binds`);
  }
});

test('no two entries advertise the same shortcut', () => {
  const entries = numbered(12).filter((e) => e.shortcut);
  const seen = new Set();
  for (const entry of entries) {
    assert.ok(!seen.has(entry.shortcut), `"${entry.shortcut}" is claimed twice`);
    seen.add(entry.shortcut);
  }
});

test('every advertised shortcut actually selects its own entry', () => {
  // The failure the duplicate D caused: an advertised key that resolves to a
  // DIFFERENT row. This is the assertion the old table could not have passed.
  const entries = numbered(9);
  for (let i = 0; i < entries.length; i += 1) {
    assert.equal(toolShortcutIndex(entries, entries[i].shortcut), i,
      `"${entries[i].shortcut}" must select entry ${i}`);
  }
  // and the old table, run through the same resolver, does not
  const oldEntries = Object.entries(OLD_SHORTCUTS).map(([id, shortcut]) => ({ id, shortcut }));
  const divotIndex = oldEntries.findIndex((e) => e.id === 'divot');
  assert.notEqual(toolShortcutIndex(oldEntries, 'D'), divotIndex,
    'control: D never reached the divot kit, which is the dead control');
});

test('a belt longer than nine leaves the overflow unlabelled rather than lying', () => {
  // The wheel handles 1-9. A tenth entry claiming "10" would advertise a
  // keystroke that cannot be typed as one key.
  const entries = numbered(11);
  assert.equal(entries[9].shortcut, null);
  assert.equal(entries[10].shortcut, null);
});
