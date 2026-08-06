import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_LOCALE, LOCALES, coverage, englishKeys, isLocale, locale, onLocaleChange, setLocale, t,
} from '../src/core/i18n.js';
import { normalizePreferences } from '../src/core/preferences.js';

// Q3 — the language layer. These pin the rules that keep a partly-translated
// build playable rather than broken: English is the key set, everything else
// is an overlay, and a missing line falls through instead of showing a key.

test('every advertised locale is real and English is the default', () => {
  assert.equal(DEFAULT_LOCALE, 'en');
  for (const entry of LOCALES) {
    assert.ok(isLocale(entry.id), `${entry.id} has no table`);
    assert.ok(entry.endonym.length > 0, `${entry.id} has no name in its own language`);
  }
});

test('switching locale changes what a line reads', () => {
  setLocale('en');
  const english = t('settings.language.title');
  setLocale('es');
  assert.notEqual(t('settings.language.title'), english);
  setLocale('fr');
  assert.notEqual(t('settings.language.title'), english);
  setLocale('en');
  assert.equal(t('settings.language.title'), english);
});

test('a missing line falls through to English, never to a raw key', () => {
  setLocale('es');
  // a key no overlay defines still has to read as words
  assert.equal(t('common.save'), 'Guardar');
  const onlyEnglish = englishKeys()[0];
  assert.ok(t(onlyEnglish).length > 0);
  assert.notEqual(t(onlyEnglish), onlyEnglish);
  setLocale('en');
});

test('an unknown key returns the key rather than empty text', () => {
  assert.equal(t('no.such.line'), 'no.such.line');
});

test('placeholders are substituted after lookup, so word order can differ', () => {
  setLocale('en');
  const en = t('settings.language.coverage', { done: 3, total: 9 });
  assert.match(en, /3/);
  assert.match(en, /9/);
  setLocale('fr');
  const fr = t('settings.language.coverage', { done: 3, total: 9 });
  assert.match(fr, /3/);
  assert.match(fr, /9/);
  assert.notEqual(fr, en);
  setLocale('en');
});

test('an unfilled placeholder is left visible rather than blanked', () => {
  setLocale('en');
  assert.match(t('settings.language.coverage', { done: 3 }), /\{total\}/);
});

test('coverage is reported honestly per locale', () => {
  for (const entry of LOCALES) {
    const c = coverage(entry.id);
    assert.equal(c.total, englishKeys().length);
    assert.ok(c.done <= c.total);
    assert.ok(c.fraction > 0.5, `${entry.id} covers only ${c.done}/${c.total}`);
  }
  assert.equal(coverage('en').fraction, 1);
});

test('locale change notifies listeners exactly once, and a bad listener cannot strand the rest', () => {
  setLocale('en');
  const seen = [];
  const offBad = onLocaleChange(() => { throw new Error('boom'); });
  const offGood = onLocaleChange((id) => seen.push(id));
  setLocale('fr');
  setLocale('fr'); // no change, no second call
  assert.deepEqual(seen, ['fr']);
  offBad();
  offGood();
  setLocale('en');
});

test('preferences carry the locale and reject an unknown one', () => {
  assert.equal(normalizePreferences({}).locale, 'en');
  assert.equal(normalizePreferences({ locale: 'fr' }).locale, 'fr');
  assert.equal(normalizePreferences({ locale: 'klingon' }).locale, 'en');
  assert.equal(normalizePreferences({ locale: 42 }).locale, 'en');
  setLocale('en');
});

test('locale() reports what is actually in force', () => {
  setLocale('es');
  assert.equal(locale(), 'es');
  setLocale('en');
  assert.equal(locale(), 'en');
});
