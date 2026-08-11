// H1 (Goal 20) — the main menu makes a sound when you press something.
//
// The fault was absolute rather than subtle: src/screens/menu.js contained no
// audio reference of any kind, so every press on New Game, Load, Settings and
// Quit was silent. A silent button reads as a broken one, which is what both
// the owner and the stranger verifier reported independently.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const menu = fs.readFileSync(new URL('../src/screens/menu.js', import.meta.url), 'utf8');
const main = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');

test('the menu is given a voice, and main.js hands it one', () => {
  assert.match(menu, /handlers\.audio/, 'the menu must accept an audio module');
  assert.match(main, /menu = makeMenu\(\{\s*\n\s*audio,/,
    'main.js must pass audio into makeMenu, or the menu has nothing to speak with');
});

test('every button speaks, including the ones inside the menu dialogs', () => {
  // A delegated listener rather than a sound bolted onto each onclick: the new
  // game, load, credits and delete-confirmation dialogs build their own
  // buttons, and a per-site approach would have missed all of them.
  assert.match(menu, /addEventListener\('pointerdown', pressSound, true\)/);
  assert.match(menu, /event\.target\?\.closest\?\.\('button'\)/);
  assert.match(menu, /audio\?\.uiTick\?\.\(\)/);
});

test('the first press can create the audio context', () => {
  // A Web Audio context may only be created from a user gesture. The first
  // press on the menu IS the first gesture of the session, so without this the
  // one click that should make the first sound is the only one that cannot.
  assert.match(menu, /audio\?\.init\?\.\(\)/,
    'the press handler must be able to wake the audio context');
});

test('the listeners do not outlive the menu', () => {
  // The press listener is on `document`, so a menu that forgot to detach it
  // would tick over every click in the game world for the rest of the session.
  const setVisible = menu.slice(menu.indexOf('function setVisible('));
  assert.match(setVisible, /removeEventListener\('pointerdown', pressSound, true\)/);
  assert.ok(
    setVisible.indexOf('removeEventListener') < setVisible.indexOf("addEventListener('pointerdown'"),
    'the detach must come before the attach, or showing twice leaves two listeners',
  );
});
