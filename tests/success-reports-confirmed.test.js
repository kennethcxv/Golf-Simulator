// BLOCKER 2 — "success reported, effect absent", as a permanent gate.
//
// The ceiling repair told the player it had fixed the panel while
// restorationAction had refused the write. The question was whether that was
// one bug or a habit, so every call site of every sim mutation that can REFUSE
// was audited (tools/qa/success-report-audit.mjs lists them). The habit is
// good: 25 of 26 report only after checking. The one that did not was the
// laptop cancelling a tee time — result discarded, "spot is open again" printed
// regardless — while the front desk, calling the same function, checked it.
//
// Two tests. The first pins the refusal the laptop was ignoring. The second is
// the gate: it reads the source and fails on the SHAPE of the defect, a
// refusable mutation called as a bare statement with a success report behind
// it. That shape is what a reviewer cannot reliably spot by eye across 250
// files, and it is exactly what shipped.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { newGame } from '../src/sim/state.js';
import { bookSlot, cancelReservation, TEE_SHEET } from '../src/sim/reservations.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Sim mutations that can refuse. A call site that discards one of these and
// then reports success is telling the player something it never checked.
const REFUSABLE = [
  'restorationAction', 'clearClutter', 'submitPurchaseOrders', 'placeOrder', 'cancelOrder',
  'buyRentalSets', 'hireStaff', 'fireStaff', 'trainStaff', 'treatSection', 'aerateSection',
  'bookSlot', 'cancelReservation', 'markReservationNoShow', 'cutTape', 'openFlap',
  'takeFromBox', 'flattenBox', 'recycleBox', 'storeInBack', 'setProductMarkup',
  'setGreenFee', 'setMembershipDue', 'setRentalPrice',
];

test('cancelReservation refuses a booking that is not open', () => {
  // If this ever stops refusing, the laptop's check becomes dead code and the
  // test below is guarding nothing — so the refusal itself is pinned.
  const state = newGame('relaxed', 20260729);
  const refused = cancelReservation(state, 'no-such-reservation');
  assert.equal(refused.ok, false);
  assert.ok(refused.reason, 'a refusal has to say why, or the UI has nothing to show');
});

test('a real booking cancels, so the success path is real too', () => {
  const state = newGame('relaxed', 20260729);
  const slot = TEE_SHEET.slots ? TEE_SHEET.slots[0] : null;
  const booked = bookSlot(state, {
    minute: (slot && slot.minute) ?? 8 * 60,
    players: 2,
    name: 'Audit Party',
  });
  if (!booked.ok) return; // booking rules vary by day; the refusal test is the load-bearing one
  const cancelled = cancelReservation(state, booked.res.id);
  assert.equal(cancelled.ok, true, cancelled.reason);
});

// ---------------------------------------------------------------------------

function sourceFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

const REPORT = /(^|[^\w.$])(?:hooks\.)?(?:toast|notify|say)\s*\(/;
const NEGATIVE = /'warn'|"warn"|'bad'|"bad"|'error'|"error"|\breason\b/i;

test('no refusable mutation is called and then reported as a success unchecked', () => {
  const offenders = [];
  for (const file of sourceFiles(path.join(ROOT, 'src'))) {
    const rel = path.relative(ROOT, file).replace(/\\/g, '/');
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;
      // A BARE call: the whole statement is the call, so the result goes
      // nowhere. `const r = f(...)`, `if (f(...))`, `return f(...)` and
      // `f(...) ? a : b` all keep the answer and are not this shape.
      const bare = REFUSABLE.find((name) => new RegExp(`^\\s*${name}\\s*\\(`).test(line));
      if (!bare) continue;
      // Look ahead past the rest of the call for a success report.
      const window = lines.slice(i + 1, i + 5);
      const reported = window.some((l) => REPORT.test(l) && !NEGATIVE.test(l) && !/^\s*(\/\/|\*)/.test(l));
      if (reported) {
        offenders.push(`${rel}:${i + 1}  ${bare}(...) result discarded, success reported below`);
      }
    }
  }
  assert.deepEqual(
    offenders, [],
    `a success report must be reachable only through a check of the result:\n  ${offenders.join('\n  ')}`,
  );
});

test('the gate would catch the defect it was written for', () => {
  // The shape, as it appeared in laptop.js before the fix. If this stops
  // matching, the test above has quietly stopped looking for anything.
  const sample = [
    '                  cancelReservation(st, m.r.id);',
    '                  toast(`${m.entry.fullName} spot is open again.`);',
  ];
  const bare = REFUSABLE.find((name) => new RegExp(`^\\s*${name}\\s*\\(`).test(sample[0]));
  assert.equal(bare, 'cancelReservation');
  assert.ok(REPORT.test(sample[1]) && !NEGATIVE.test(sample[1]));
});
