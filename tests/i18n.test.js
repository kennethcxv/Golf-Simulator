import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_LOCALE, LOCALES, coverage, englishKeys, isLocale, locale, onLocaleChange, setLocale, t,
} from '../src/core/i18n.js';
import { normalizePreferences } from '../src/core/preferences.js';
import fs from 'node:fs';

// Q3 — the language layer. These pin the rules that keep a partly-translated
// build playable rather than broken: English is the key set, everything else
// is an overlay, and a missing line falls through instead of showing a key.

test('every advertised locale is real and English is the default', () => {
  assert.equal(DEFAULT_LOCALE, 'en');
  for (const entry of LOCALES) {
    // A locale must be REGISTERED even when its table is empty: isLocale gates
    // what a saved preference may hold, so an unregistered id is rewritten to
    // English on load and the player's choice does not stick.
    assert.ok(isLocale(entry.id), `${entry.id} has no table`);
    assert.ok(entry.endonym.length > 0, `${entry.id} has no name in its own language`);
  }
});

test('E3: the ten Steam languages are offered, and each says how translated it is', () => {
  // The top ten on Steam by share of users. Listing them is the deliverable;
  // pretending they are translated would not be.
  const ids = LOCALES.map((entry) => entry.id);
  for (const id of ['en', 'zh-Hans', 'ru', 'es', 'pt-BR', 'de', 'ja', 'ko', 'fr', 'tr']) {
    assert.ok(ids.includes(id), `${id} is offered`);
  }
  assert.equal(LOCALES.length, 10);
  assert.equal(coverage('en').fraction, 1);
  // D2 (Full_Goal_16) asserted fraction === 1 for every locale. RELAXED HERE,
  // deliberately, and this is the reading that CHANGES the game rather than
  // preserving it.
  //
  // That assertion made adding an English key a breaking change for nine other
  // languages at once, so wrapping a raw string in t() required translating it
  // nine ways in the same commit. The effect was that 155 player-facing strings
  // stayed RAW - reaching every player in English on every locale - because
  // making them translatable at all was gated behind translating them.
  // A rule meant to keep the build honest was keeping strings untranslatable.
  //
  // This test's own title is the standard: each locale "says HOW TRANSLATED IT
  // IS". That is a claim about honest REPORTING, not about completeness, and
  // the i18n layer already ships the behaviour - a missing line falls through
  // to English rather than showing a key.
  //
  // So: English must be complete, because it is the key set. Every other locale
  // must report its true fraction against that key set, and must not regress
  // below what it has now without somebody choosing to.
  assert.equal(coverage('en').fraction, 1, 'English is the key set and is complete by definition');
  for (const id of ids) {
    const c = coverage(id);
    assert.equal(c.total, englishKeys().length, 'coverage is measured against the real key set');
    assert.ok(c.fraction >= 0 && c.fraction <= 1, `${id} reports a real fraction`);
    assert.ok(Number.isFinite(c.fraction), `${id} reports a number, not a guess`);
  }
});

test('a translated locale draws its own words, never a key and no longer English', () => {
  // D2: ja carries a real table now. The fallback contract (missing lines
  // draw English, never a raw key) is pinned separately below on `missing`.
  setLocale('ja');
  const drawn = t('settings.language.title');
  assert.ok(drawn && !drawn.includes('settings.'), `fell through to a key: ${drawn}`);
  setLocale('en');
  assert.notEqual(t('settings.language.title'), drawn, 'ja no longer mirrors English');
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
  // E3 widened LOCALES to the ten biggest on Steam and seven of them have no
  // table yet. The rule this test protects is not "everything is translated" —
  // it is "coverage never lies". So a locale is either substantially done or
  // reported as ZERO; the failure this guards against is a half-finished table
  // that reads as available and leaves the player on a screen of mixed
  // languages.
  for (const entry of LOCALES) {
    const c = coverage(entry.id);
    assert.equal(c.total, englishKeys().length);
    assert.ok(c.done <= c.total);
    assert.ok(
      c.fraction === 0 || c.fraction > 0.5,
      `${entry.id} is stranded half-translated at ${c.done}/${c.total}`,
    );
  }
  assert.equal(coverage('en').fraction, 1);
});

test('no locale carries more untranslated keys than the baseline records', () => {
  // G (Goal 21) — THE RATCHET, and the reason it exists.
  //
  // The check above says coverage never LIES. It does not say coverage never
  // SLIPS, and for four sessions nothing did. The check that ran each time
  // counted keys ADDED to all ten tables and never once looked at the
  // denominator, so "translations done" was true on every run while nine
  // locales sat at 168/282 and a Spanish player read a third of the game in
  // English. Counting the numerator is not the same question as counting the
  // fraction, and only the fraction is what the player experiences.
  //
  // Strict fraction === 1 was tried in Goal 16 and removed for a real reason
  // (see the long note above): it made adding one English key a breaking
  // change for nine languages at once, so 155 strings stayed raw rather than
  // translatable. This is the third position, and it is the lint ratchet's
  // contract: the number may fall freely and may never rise on its own.
  // Adding an untranslated English key fails here, loudly, naming the locale —
  // and the author may still bump the baseline, deliberately, in a diff a
  // human reads. Drift is allowed. SILENT drift is not.
  const baseline = JSON.parse(fs.readFileSync('tools/i18n-baseline.json', 'utf8')).missing;
  const worse = [];
  for (const entry of LOCALES) {
    const c = coverage(entry.id);
    const missing = c.total - c.done;
    const allowed = baseline[entry.id];
    assert.equal(typeof allowed, 'number', `${entry.id} is offered but has no baseline`);
    if (missing > allowed) worse.push(`${entry.id} ${missing} missing, baseline allows ${allowed}`);
  }
  assert.deepEqual(worse, [], `untranslated keys grew:\n  ${worse.join('\n  ')}`);
});

test('the baseline covers every locale offered, and no locale it does not offer', () => {
  // A baseline entry for a locale nobody can select certifies nothing, and a
  // selectable locale with no entry walks straight past the ratchet. Both are
  // the "zero call sites" shape: a rule that exists and governs nothing.
  const baseline = JSON.parse(fs.readFileSync('tools/i18n-baseline.json', 'utf8')).missing;
  assert.deepEqual(
    Object.keys(baseline).sort(),
    LOCALES.map((entry) => entry.id).sort(),
  );
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
