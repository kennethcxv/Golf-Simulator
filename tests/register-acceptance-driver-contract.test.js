import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync('tools/qa/register-acceptance-driver.mjs', 'utf8');

function section(startText, endText) {
  const start = source.indexOf(startText);
  const end = source.indexOf(endText, start + startText.length);
  assert.ok(start >= 0, `missing section start: ${startText}`);
  assert.ok(end > start, `missing section end after ${startText}: ${endText}`);
  return source.slice(start, end);
}

test('strict checkout scans each product with one click and observes the authored bag flight', () => {
  const scanRoute = section(
    "currentStep = 'one-click scan and stage three physical products'",
    "currentStep = 'total sale with T'",
  );

  assert.match(scanRoute, /await page\.mouse\.click\(from\.x, from\.y\)/);
  assert.match(scanRoute, /register\.scanPresentation\(\)/);
  assert.match(scanRoute, /presentation\.phase === 'scan-hold'/);
  assert.match(scanRoute, /presentation\.lastRead\?\.uid === id/);
  assert.match(scanRoute, /presentation\.lastRead\.ok/);
  assert.match(scanRoute, /state === 'WaitingForScan'/);
  assert.match(scanRoute, /state === 'AllProductsScanned'/);
  assert.match(scanRoute, /item\.scanned && item\.staged/);

  assert.doesNotMatch(scanRoute, /page\.mouse\.(?:down|up|wheel)\(/);
  assert.doesNotMatch(scanRoute, /interpolateMouse\(/);
  assert.doesNotMatch(scanRoute, /scanAlignment\(/);
  assert.doesNotMatch(scanRoute, /scannedStaging|stageTargets|staging-/);
});

test('strict card checkout proves deterministic approval through the physical keypad', () => {
  const cardRoute = section("    if (mode === 'card') {", "    } else {");

  // Presentation and chip insertion are the automatic production beat; the
  // cashier's deliberate physical work is the exact total on the terminal
  // keypad. Production's decline chance is zero: a worst-case rng()=0 must
  // still approve, and the recorded trace proves the probabilistic path ran.
  assert.match(cardRoute, /insertion\?\.automatic && insertion\.u >= 0\.999/);
  assert.match(cardRoute, /cardKeyScreenPoint/);
  assert.match(cardRoute, /`digit:\$\{digit\}`/);
  assert.match(cardRoute, /clickTerminalKey\('confirm'\)/);
  assert.match(cardRoute, /did not enter the exact total/);
  assert.match(cardRoute, /const values = \[0\]/);
  assert.match(cardRoute, /tx\.__qaStrictCardRngTrace\.push\(value\)/);
  assert.match(cardRoute, /await keyExactTotalAndConfirm\(1\)/);
  assert.match(cardRoute, /await waitStage\('receipt'/);
  assert.match(cardRoute, /approved\.cardAttempts === 1/);
  assert.match(cardRoute, /approved\.cardsTried === 1/);
  assert.match(cardRoute, /JSON\.stringify\(approved\.rngTrace\) === JSON\.stringify\(\[0\]\)/);

  assert.doesNotMatch(cardRoute, /runCard\([^\n]*force/);
  assert.doesNotMatch(cardRoute, /swipeAt\(|CardSwipeReady|performPhysicalSwipe/);
  assert.doesNotMatch(cardRoute, /while \(attempts\+\+ < 5\)/);
});

test('strict checkout proves the authored self-delivery of receipt and bag', () => {
  const deliveryRoute = section(
    "currentStep = 'receipt prints from the physical printer'",
    "currentStep = 'transaction banks exactly once'",
  );

  // After payment the order delivers itself. The strict proof is the recorded
  // phase trace plus physical packing/handoff facts — never a QA mouse drag
  // standing in for the cashier.
  assert.match(deliveryRoute, /'receipt-print'/);
  assert.match(deliveryRoute, /\['bag-deliver', 'bag-customer-hold'\]/);
  assert.match(deliveryRoute, /deliveryProof\.packed\.receiptPacked/);
  assert.match(deliveryRoute, /allItemsBagged/);
  assert.match(deliveryRoute, /bagAcceptedByCustomer/);
  assert.match(deliveryRoute, /bagDistanceToPalm < 0\.04/);
  assert.match(deliveryRoute, /authored delivery skipped a physical phase/);

  assert.doesNotMatch(deliveryRoute, /interpolateMouse\(/);
  assert.doesNotMatch(deliveryRoute, /page\.mouse\.(?:down|up|click)\(/);

  // The observer only records; it must be armed before both payment commits.
  assert.match(source, /const armDeliveryTrace = \(\) => page\.evaluate/);
  assert.ok(source.split('await armDeliveryTrace();').length === 3,
    'armDeliveryTrace must be armed exactly once per payment branch');

  // The stale manual receipt-drag contract must stay dead.
  assert.doesNotMatch(source, /drag receipt into bag/);
  assert.doesNotMatch(source, /drag filled bag handles to customer/);
});

test('strict acceptance keeps its wrapper API and pass/blocker result envelopes', () => {
  assert.match(source,
    /export async function runRegisterAcceptance\(page, mode, \{ baseUrl = BASE_URL \} = \{\}\)/);
  assert.match(source, /fs\.writeFileSync\(path\.join\(out, 'latest-result\.json'\)/);
  assert.match(source, /return saveResult\(\{\s*ok: true,\s*mode,/);
  assert.match(source, /return saveResult\(\{\s*ok: false,\s*mode,/);
  assert.match(source, /blocker: \{ step: currentStep, message: error\.message, state: blocked, screenPoints \}/);
});
