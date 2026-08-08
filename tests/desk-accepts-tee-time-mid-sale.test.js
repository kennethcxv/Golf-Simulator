// G13 — THE COUNTER MUST LET THE TEE TIME ONTO THE SALE.
//
// The sim layer can carry a green fee on a merchandise ticket, and eleven checks
// prove the money splits correctly when it does. None of that reaches the player
// if the desk refuses to let them ask.
//
// It refused in THREE places, and finding only the first would have been the
// half-fix this goal has already caught five times:
//
//   1. `beginReservationPayment`   - `if (!reservation || tx) return false`
//   2. `select-reservation:`       - "Finish the active transaction first"
//   3. `select-walkin-slot:`       - `if (tx) return false`
//
// Two and three are the ones that bite, because the player must SELECT a
// reservation before check-in can be pressed. Fixing only the first leaves the
// merge unreachable from the counter while every unit test passes.
//
// These gates live inside a closure over live 3D state, so this reads the source
// the way the trunk-bob check does. That is a weaker instrument than driving the
// desk, and the report records the live path as UNCONFIRMED. What it does buy is
// the exact regression: someone restoring a bare `if (tx)` here would reclose the
// door silently.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(
  new URL('../src/render3d/clubhouse/simplifiedRegisterMode.js', import.meta.url),
  'utf8',
);

// The block handling one monitor action, from its `if (action...)` to the next.
function actionBlock(name) {
  const at = src.indexOf(name);
  if (at < 0) return null;
  const next = src.indexOf("    if (action", at + name.length);
  return next < 0 ? src.slice(at, at + 1200) : src.slice(at, next);
}

test('selecting a reservation is not refused while items are still being scanned', () => {
  const block = actionBlock("action.startsWith('select-reservation:')");
  assert.ok(block, 'the select-reservation action is still handled here');
  // A bare `if (tx)` is the defect: it refuses the exact moment the player is
  // trying to use. The gate must ask what STAGE the ticket is at.
  assert.doesNotMatch(block, /if \(tx\) \{/,
    'a bare tx check would refuse a ticket that can still take the fee');
  assert.match(block, /tx\.stage !== 'scanning'/,
    'the refusal is scoped to a ticket that has already started payment');
});

test('booking a walk-in slot is not refused while items are still being scanned', () => {
  const block = actionBlock("action.startsWith('select-walkin-slot:')");
  assert.ok(block, 'the select-walkin-slot action is still handled here');
  assert.doesNotMatch(block, /if \(tx\) return false;/,
    'a bare tx check would refuse a walk-in booked mid-sale');
  assert.match(block, /tx\.stage !== 'scanning'/,
    'the refusal is scoped to a ticket that has already started payment');
});

test('the check-in entry point attaches to an open ticket instead of bailing', () => {
  const at = src.indexOf('function beginReservationPayment(');
  assert.ok(at > 0, 'the check-in entry point is still here');
  const block = src.slice(at, at + 1600);
  assert.doesNotMatch(block, /if \(!reservation \|\| tx\) return false;/,
    'the old refusal is gone');
  assert.match(block, /attachGreenFeeToTx\(/,
    'an open ticket takes the fee onto itself');
});

test('the desk decides what to finalize from what the ticket carries', () => {
  // `transactionKind` remembers only the first thing that happened at the desk.
  // A visit that began as a shirt and picked up a tee time is still a check-in,
  // and routing on the opening move would bank it as an anonymous sale and leave
  // the round showing open on the sheet.
  const at = src.indexOf('function finalizeTransaction(');
  assert.ok(at > 0, 'the finalize handler is still here');
  const block = src.slice(at, at + 2200);
  assert.doesNotMatch(block, /if \(transactionKind === 'reservation'\) \{\s*result =/,
    'the branch must not be decided by how the ticket started');
  assert.match(block, /tx\.servicePayment[\s\S]{0,80}reservationId/,
    'it asks the ticket what booking it carries');
});
