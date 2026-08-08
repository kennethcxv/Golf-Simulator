// STANDING INVARIANT 8 — EVERY PLAYER-FACING STRING GOES THROUGH t().
//
// The gate carried this as NO CHECK with the note "partially covered by the i18n
// coverage test; no check that a NEW literal is caught". Both halves of that
// note are true, and the gap is bigger than it sounds.
//
// `tests/i18n.test.js` pins the MACHINERY - locales are real, a missing line
// falls through to English, placeholders substitute after lookup. It never looks
// at a call site. And `toast()` does not translate: it hands the message
// straight to notify(). So a raw string at a toast call reaches the player in
// English on every locale.
//
// Started at 155. Nine build-mode strings are now wrapped, so 146.
//
// Wrapping them needed the full-coverage assertion in i18n.test.js relaxed
// first: it asserted fraction === 1 for every locale, which made adding one
// English key a breaking change for nine languages at once - so making a string
// TRANSLATABLE required translating it nine ways in the same commit, and the
// result was that none of them ever got wrapped. Now English is the key set and
// the other locales report their true fraction.
//
// Started at 155: 146, 119, 94, 90, 85, 83, 78, 72, 68, 63, 57, 54, now 45.
// 45 became 50 when `shop.log.unshift` joined the sink list - not a regression,
// a correction: those five were always raw and the scanner could not see them.
// Measured when this was written: 50 raw literals at player-facing sinks,
// 0 wrapped in t(). Translating those is a real piece of work and not one to
// start at the end of a session.
//
// So this is a RATCHET, not a fix. It freezes the count and fails when it GROWS,
// which is exactly what the gate's note asked for: a check that catches a NEW
// literal. The number is allowed to fall freely - every one that gets wrapped
// makes the ceiling stricter on the next person - and the test says so when it
// drops, so the baseline can be lowered deliberately rather than drifting.
//
// NEGATIVE CONTROL: the scanner must actually find the sinks it claims to. A
// count of zero would pass the ceiling while proving nothing, so a floor is
// asserted too.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Sinks whose first argument is read by the player as prose.
// SINKS, and the list is the thing most likely to be incomplete.
//
// It started as toast|announce|setPrompt|setHint and MISSED `shop.log.unshift`
// entirely - the activity feed the player reads on the laptop. Five strings hid
// behind that gap for the whole session, and every "N remaining" figure I
// reported was an undercount. A ratchet is only as honest as its sink list, and
// a sink nobody thought of is invisible in exactly the way a broken regex is.
const SINK = /(toast|announce|setPrompt|setHint)\s*\(\s*(['"`])|log\.unshift\(\s*(['"`])/g;
const WRAPPED = /\b(toast|announce|setPrompt|setHint)\s*\(\s*t\(/g;

// The measured state on the day this was written. Lower it when you wrap some.
const BASELINE = 50;

function jsFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...jsFiles(p));
    else if (entry.name.endsWith('.js')) out.push(p);
  }
  return out;
}

const src = path.resolve(new URL('../src', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));

function scan() {
  let raw = 0;
  let wrapped = 0;
  const byFile = [];
  for (const file of jsFiles(src)) {
    const text = fs.readFileSync(file, 'utf8');
    const r = (text.match(new RegExp(SINK.source, 'g')) || []).length;
    const w = (text.match(new RegExp(WRAPPED.source, 'g')) || []).length;
    raw += r;
    wrapped += w;
    if (r) byFile.push({ file: path.relative(src, file), raw: r });
  }
  byFile.sort((a, b) => b.raw - a.raw);
  return { raw, wrapped, byFile };
}

test('the scanner finds the player-facing sinks at all (control)', () => {
  const { raw } = scan();
  // A scanner that matched nothing would sail under any ceiling while proving
  // nothing whatsoever. The floor is what stops a broken regex reading as clean.
  // THE FLOOR MOVES DOWN WITH THE WORK, DELIBERATELY.
  //
  // It started at 50, chosen when 155 strings were raw, to catch a regex that
  // had stopped matching. Real wrapping has now taken the true count below that,
  // so the floor had to come down or it would fail on success. It is still far
  // above zero, which is the case it actually guards: a broken pattern reports
  // 0 and would sail under any ceiling while proving nothing.
  assert.ok(raw > 15,
    `the scanner should find the known sinks, found ${raw} - the pattern is probably broken`);
});

test('no NEW player-facing string bypasses t()', () => {
  const { raw, byFile } = scan();
  const worst = byFile.slice(0, 5).map((f) => `${f.file}:${f.raw}`).join(', ');
  assert.ok(raw <= BASELINE,
    `player-facing strings bypassing t() rose from ${BASELINE} to ${raw}. `
    + `A string handed to toast() reaches the player in English on every locale. `
    + `Worst files: ${worst}`);
});

test('the baseline is lowered deliberately, not left to drift', () => {
  const { raw } = scan();
  // When somebody wraps a batch, this fires and asks them to bank the win by
  // moving BASELINE down. Without it the ceiling stays loose for ever and the
  // ratchet only ever works in one direction by accident.
  assert.ok(raw >= BASELINE - 10,
    `${BASELINE - raw} strings have been wrapped since the baseline was set. `
    + `Lower BASELINE in this file to ${raw} so the gain cannot be given back.`);
});
