// PLAYTEST 5, ITEM 3 — THE THIRD REPORT. "My body is still solid."
//
// The owner's lead, and it was right: `playerBlocksCustomers` reads
// `app.deskScreenOpen`, and that identifier appeared in exactly ONE place in
// the whole of src/ — the read itself. It is never declared, never assigned,
// never initialised. `app.deskScreenOpen === true` is therefore false forever,
// the desk screen never phased the player out, and the desk screen is where he
// does walk-in tee times.
//
// This is FOUND_FALSE shape 2 — zero call sites — applied to a variable rather
// than a function, and no test could catch it because every test that exercised
// the predicate simply agreed with it.
//
// So this file does not exercise the predicate. It reads the predicate's SOURCE,
// extracts every `app.<flag>` it consults, and requires each one to be ASSIGNED
// somewhere in src/. A flag that is only ever read is a flag that is always
// undefined, and a predicate consulting one is asking a question nobody answers.
//
// It also pins the two accessors the ledger half depends on, because
// `isCarried()`/`isOpen()` are real methods that answer the WRONG question: the
// book raised to the face and still SHUT — the first press, and exactly what
// "reading the ledger" looks like — is neither carried nor open. `isInHand()`
// is the one whose own comment says it is "in your hands at all, shut or not".
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = new URL('../src/', import.meta.url);
const clubhouseSource = readFileSync(new URL('render3d/clubhouse.js', SRC), 'utf8');

function allSourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...allSourceFiles(full));
    else if (entry.endsWith('.js')) out.push(full);
  }
  return out;
}

const everySource = allSourceFiles(new URL('.', SRC).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
  .map((file) => ({ file, text: readFileSync(file, 'utf8') }));

// COMMENTS ARE NOT CODE, and a source-scanning test that forgets it grades
// prose. The first version of this file failed the moment the fix's own comment
// explained what app.deskScreenOpen used to be: the scan found the identifier
// in the explanation of its removal. Two tests in this repo have now been
// tripped by a comment in one session, which is enough to make stripping them
// the default for anything that reads source and asks what it DOES.
function withoutComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function predicateBody() {
  const start = clubhouseSource.indexOf('function playerBlocksCustomers()');
  assert.ok(start >= 0, 'playerBlocksCustomers must exist');
  const end = clubhouseSource.indexOf('\n  }', start);
  assert.ok(end > start, 'playerBlocksCustomers must have a body');
  return withoutComments(clubhouseSource.slice(start, end));
}

test('every app flag playerBlocksCustomers reads is actually written in src/', () => {
  const body = predicateBody();
  const flags = [...new Set([...body.matchAll(/\bapp\.([A-Za-z_$][\w$]*)\b/g)].map((m) => m[1]))];
  assert.ok(flags.length > 0, 'the predicate consults at least one app flag');

  const unwritten = [];
  for (const flag of flags) {
    // An assignment (`app.x = `, `x: false` in the app literal) anywhere in src/.
    const assigned = new RegExp(`(?:\\bapp\\.${flag}\\s*=[^=]|^\\s*${flag}\\s*:\\s*(?:true|false|null))`, 'm');
    const writer = everySource.find(({ text }) => assigned.test(text));
    if (!writer) unwritten.push(flag);
  }

  assert.deepEqual(unwritten, [],
    `playerBlocksCustomers reads app flags that nothing in src/ ever assigns, so they are `
    + `permanently undefined and the branch they guard can never be taken: ${unwritten.join(', ')}`);
});

test('the predicate consults the flag the desk screen actually sets', () => {
  const body = predicateBody();
  // enterFrontDesk sets app.frontDeskOpen; exitFrontDesk clears it. That is the
  // desk screen, and it is where walk-in tee times are given.
  assert.match(body, /app\.frontDeskOpen === true/,
    'the desk screen must phase the player out through the flag main.js writes');
  assert.doesNotMatch(body, /deskScreenOpen/,
    'app.deskScreenOpen is written nowhere in src/ — reading it is a dead branch');
});

test('the predicate covers the ledger raised to the face but still shut', () => {
  const body = predicateBody();
  // "I am still being walked into while reading the ledger." enterLedger gates
  // app.ledgerOpen on book.isInHand(), and main.js's own comment records that
  // "the FIRST press only brings the book up, SHUT" — a state in which
  // isCarried() and isOpen() are both false.
  assert.match(body, /isInHand/,
    'reading the ledger means the book is IN HAND; isOpen() misses the shut first press');
  assert.match(body, /app\.ledgerOpen === true/,
    'the app-level ledger flag is the one main.js writes when the book comes up');
});

test('the ledger accessors the predicate calls exist on the book it is handed', () => {
  const book = readFileSync(new URL('render3d/clubhouse/ledgerBook.js', SRC), 'utf8');
  for (const accessor of ['isOpen', 'isCarried', 'isInHand']) {
    assert.match(book, new RegExp(`\\b${accessor}[,:]`),
      `ledgerBook must export ${accessor} — the predicate's try/catch would otherwise `
      + 'swallow the TypeError and fall through to BLOCKING the customer');
  }
});
