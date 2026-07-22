import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const registerSource = fs.readFileSync(
  new URL('../src/render3d/clubhouse/simplifiedRegisterMode.js', import.meta.url),
  'utf8',
);
const monitorSource = fs.readFileSync(
  new URL('../src/render3d/clubhouse/frontDeskMonitorUi.js', import.meta.url),
  'utf8',
);
const clubhouseSource = fs.readFileSync(
  new URL('../src/render3d/clubhouse.js', import.meta.url),
  'utf8',
);

function functionBody(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} exists`);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}' && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`${name} has an unterminated body`);
}

test('the customer choice is automatic, persistent, and never exposed as manual payment buttons', () => {
  assert.match(registerSource, /paymentAutoTimer\s*=\s*1\.35/);
  assert.match(registerSource, /choosePayment\(preferredPayment\(\)\)/);
  assert.match(registerSource, /customerChoice:\s*paymentChoiceVisible\(\)/);
  assert.match(monitorSource, /CUSTOMER CHOSE \$\{choice\}/);
  assert.doesNotMatch(registerSource, /['"]pay-(?:card|cash)['"]|reservation-pay-(?:card|cash)/);
});

test('walk-in slot selection is capacity revalidated and always offers a visible rejection action', () => {
  assert.match(registerSource, /id:\s*['"]reject-walkin['"]/);
  assert.match(registerSource, /bridge\.bookWalkIn\(customerId, dayAbs, minute\)/);
  assert.match(registerSource, /bridge\.rejectWalkIn\(walkIn\.customerId\)/);
  assert.match(clubhouseSource, /selectWalkInSlot\(state,/);
});

test('Escape unwinds physical workspace, selection, tab, and only then leaves the monitor', () => {
  const onKey = functionBody(registerSource, 'onKey');
  const workspace = onKey.indexOf("workspace !== 'monitor'");
  const walkIn = onKey.indexOf('selectedWalkInCustomerId != null');
  const reservation = onKey.indexOf('selectedReservationId != null');
  const tab = onKey.indexOf("activeTab !== 'home'");
  const leave = onKey.lastIndexOf('leave()');
  assert.ok(workspace < walkIn && walkIn < reservation && reservation < tab && tab < leave);
  assert.doesNotMatch(onKey, /abandon\s*\(/);
});

test('an order arriving at an already-open till arms the cashier-entry transition', () => {
  const begin = functionBody(registerSource, 'begin');
  const entry = functionBody(registerSource, 'beginCashierEntry');
  assert.match(entry, /checkoutFlowState\(\) !== 'WaitingForCashier'/);
  assert.match(entry, /flowTo\('EnteringCashierMode', event\)/);
  assert.match(entry, /enterTimer\s*=\s*0\.30/);
  assert.match(begin,
    /if \(active\) beginCashierEntry\('active-cashier-accepted-next-queued-customer'\)/);
  assert.ok(
    begin.indexOf('beginCashierEntry(') < begin.indexOf('drawScreen()'),
    'the physical flow advances before the newly-arrived order is first redrawn',
  );
});

test('early reservation guests wait against game time and introduce their full name at the desk', () => {
  assert.match(clubhouseSource, /state\.clock\.minutes\s*<\s*c\.loungeUntil/);
  assert.match(clubhouseSource, /I have a reservation under \$\{c\.fullName\}/);
  assert.match(clubhouseSource, /do you have anything open for \$\{c\.partySize \|\| 1\}/);
});
