import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const DRIVER_URL = new URL(
  '../tools/qa/electron-b5-laptop-clear-counter.js',
  import.meta.url,
);
const source = fs.readFileSync(DRIVER_URL, 'utf8');

test('B5 verifier reaches recovery through trusted gameplay and physical laptop UI', () => {
  assert.match(source, /page\.keyboard\.press\('e'\)/);
  assert.match(source, /page\.keyboard\.press\('Escape'\)/);
  assert.match(source, /\.lt-navbtn/);
  assert.match(source, /button\.lt-tab/);
  assert.match(source, /Voids the open ticket/);
  assert.match(source, /\.lt-confirm/);
  assert.match(source, /event\.isTrusted/);
  assert.match(source, /realSettingsCheckoutAndConfirmationButtonsClicked/);

  assert.doesNotMatch(source, /\.dismissCounterCustomer\s*\(/,
    'The verifier must not call the clubhouse recovery verb directly.');
  assert.doesNotMatch(source, /\.clearCounterCustomer\s*\(/,
    'The verifier must not call the laptop callback directly.');
  assert.doesNotMatch(source, /dispatchEvent\s*\(/,
    'The verifier must not synthesize DOM events in page JavaScript.');
  assert.doesNotMatch(source, /\.evaluate\([^)]*\.click\s*\(/s,
    'The verifier must not invoke DOM click() from page JavaScript.');
});

test('B5 verifier stages a partial live sale and proves the retained ticket is voided', () => {
  assert.match(source, /sendToCounter\(ids, 'card'\)/);
  assert.match(source, /register\.itemMesh\(wantedUid\)/);
  assert.match(source, /stableProjectedItemPoint/);
  assert.doesNotMatch(source, /tx\.items\.every\(\(item\) => item\.placed\)/,
    'transaction items intentionally do not carry the customer placement flag');
  assert.match(source, /customer\.cart\.every\(\(item\) => item\.placed === true && item\.placedAt\)/);
  assert.match(source, /item\?\.scanned === true && item\?\.staged === true/);
  assert.match(source, /window\.__goal24B5TicketReference =/);
  assert.match(source, /result\.voidedTicket\?\.stage === 'voided'/);
  assert.match(source, /result\.voidedTicket\?\.banked !== true/);
  assert.match(source, /referencedTicketWasVoidedNotBanked/);
  assert.match(source, /window\.__goal24B5JsonSafeDigest\(tx\)/);
  assert.match(source, /transactionItemUids\(result\.partialTicket\)/);
});

test('B5 verifier digests the complete durable transaction instead of a selected projection', () => {
  assert.match(source, /window\.__goal24B5JsonSafeDigest = \(value\) =>/);
  assert.match(source, /typeof entry === 'function'/);
  assert.match(source, /typeof entry === 'bigint'/);
  assert.match(source, /!Number\.isFinite\(entry\)/);
  assert.match(source, /tx: tx \? durable\(tx\) : null/);
  assert.match(source, /same\(result\.afterEscape\.register\.tx, result\.partialTicket\.register\.tx\)/);
  assert.match(source, /same\(result\.laptopBeforeClear\.register\.tx, result\.partialTicket\.register\.tx\)/);
  assert.doesNotMatch(source, /tx: tx \? \{[\s\S]{0,500}itemUids:/,
    'The snapshot must not regress to a selected transaction-field projection.');
});

test('B5 verifier gates complete stock and lifecycle allocation rollback', () => {
  assert.match(source, /completeInventoryHeldAndLifecycleAllocationRestored/);
  assert.match(source, /Object\.entries\(shop\.inventory \|\| \{\}\)/);
  assert.match(source, /same\(result\.afterClear\.inventory, result\.baseline\.inventory\)/);
  assert.match(source, /same\(result\.afterClear\.held, result\.baseline\.held\)/);
  assert.match(source, /inventoryPosition/);
  assert.match(source, /\.\.\.Object\.keys\(shop\.inventory \|\| \{\}\)/);
  assert.match(source, /lots: durable\(\[\.\.\.\(lifecycle\?\.lots \|\| \[\]\)\]/);
  assert.match(source, /heldAllocations: Object\.fromEntries\(Object\.entries\(lifecycle\?\.heldAllocations \|\| \{\}\)/);
  assert.match(source, /carry: durable\(shop\.carry \|\| null\)/);
  assert.match(source, /deliveries: durable\(shop\.deliveries \|\| null\)/);
  assert.match(source, /activeOrders: durable/);
  assert.match(source, /same\(result\.afterClear\.lifecycleAllocation, result\.baseline\.lifecycleAllocation\)/);
  assert.match(source, /noHistoryOrBankDelta/);
  assert.match(source, /ticketAndCustomerReleased/);
  for (const authority of [
    'cash',
    'drawer',
    'history',
    'nextTransactionNo',
    'salesLive',
    'ledgerToday',
  ]) {
    assert.match(source, new RegExp(`${authority}: result\\.baseline\\.${authority}`));
    assert.match(source, new RegExp(`${authority}: result\\.afterClear\\.${authority}`));
  }
  assert.match(source, /noPageErrors/);
  assert.match(source, /noConsoleErrors/);
  assert.match(source, /noFailedRequests/);
  assert.match(source, /noHttpErrors/);
  assert.match(source, /firstDoorAndSheet06Ready/);
  assert.match(source, /Object\.values\(result\.checks\)\.every\(Boolean\)/);
});

test('B5 verifier proves Escape and laptop focus preserve the exact retained owner', () => {
  assert.match(source, /same\(result\.afterEscape\.register\.tx, result\.partialTicket\.register\.tx\)/);
  assert.match(source, /same\(result\.afterEscape\.inventory, result\.partialTicket\.inventory\)/);
  assert.match(source, /same\(result\.afterEscape\.held, result\.partialTicket\.held\)/);
  assert.match(source, /same\(result\.afterEscape\.lifecycleAllocation, result\.partialTicket\.lifecycleAllocation\)/);
  assert.match(source, /getFocusLabel/);
  assert.match(source, /\/laptop\/i\.test\(result\.laptopFocusBeforeOpen\)/);
  assert.match(source, /result\.laptopBeforeClear\.register\.customerId === staged\.customerId/);
});

test('B5 verifier writes isolated screenshots and a machine-readable artifact', () => {
  assert.match(source, /schemaVersion: 2/);
  assert.match(source, /GOAL24_B5_OUT/);
  assert.match(source, /half-scanned-wedged-ticket/);
  assert.match(source, /safely-left-register-ticket-preserved/);
  assert.match(source, /laptop-checkout-clear-control/);
  assert.match(source, /laptop-clear-counter-confirmation/);
  assert.match(source, /laptop-counter-cleared/);
  assert.match(source, /b5-laptop-clear-counter\.json/);
});
