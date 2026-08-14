// P0 (Goal 25 round 2) — IS THE LATCH SET ONCE, OR EVERY BOOT?
//
// The owner's exact question. His own saves load clean (p0-owner-save-latch.mjs
// measured that on the real files), but the question still needs a real answer,
// and answering it needs a save that IS latched -- otherwise this probe is
// nine greens about a condition that never occurred, which is the shape of most
// of the probe lies on this project's ledger.
//
// So each arm below deliberately builds a tripped save, and then does the thing
// the manager's key is supposed to make possible:
//
//     load -> latch set?  ->  RELEASE  ->  save  ->  load again -> latch back?
//
// If the latch returns, the key is useless and the repair path is the bug.
//
// The two trip sites are NOT the same shape and that is the whole answer:
//   * malformed WAL   -- reads shop.pendingCheckouts, which the release rewrites
//   * incoherent WAL  -- reads the LEDGER and the held-inventory authority,
//                        which the release does not touch at all
import { newGame, serialize, deserializeWithReport } from '../../../src/sim/state.js';
import { pickFromShelf } from '../../../src/sim/checkout.js';
import {
  acceptCash, bagItem, changeDue, completeSale, createTx, depositTendered,
  handOverChange, handOverGoods, makeChange, newDrawer, openDrawer, packReceipt,
  printReceipt, requestPayment, scanItem, takeFromDrawer, takeReceipt,
} from '../../../src/sim/register.js';
import {
  checkoutWalIsQuarantined, releaseCheckoutWalQuarantine,
} from '../../../src/sim/checkoutSettlement.js';

function paidCashTicket(state, item) {
  state.shop.drawer = newDrawer();
  const tx = createTx({ items: [item], mode: 'relaxed', prefer: 'cash', rng: () => 0.9 });
  scanItem(tx, item.uid);
  requestPayment(tx);
  tx.tendered = makeChange(20);
  acceptCash(tx);
  openDrawer(tx);
  depositTendered(tx, state.shop.drawer);
  for (const [denom, count] of Object.entries(makeChange(changeDue(tx)))) {
    for (let i = 0; i < count; i += 1) takeFromDrawer(tx, state.shop.drawer, Number(denom));
  }
  handOverChange(tx, state.shop.drawer);
  printReceipt(tx);
  takeReceipt(tx);
  packReceipt(tx);
  bagItem(tx, item.uid);
  handOverGoods(tx);
  return tx;
}

// A torn image: money and ledger reached disk, the WAL did not. This is the
// recipe tests/checkout-settlement-recovery.test.js uses for the same purpose.
function tornSave(label, mutate) {
  const state = newGame('relaxed', 24131);
  const item = {
    uid: `relatch-${label}-unit`, skuId: 'balls1', name: 'Practice Balls', price: 15,
  };
  pickFromShelf(state, item.skuId, item.uid);
  const tx = paidCashTicket(state, item);
  const save = JSON.parse(serialize(state));
  try {
    completeSale(state, tx, 'Relatch Golfer', {
      qaFaultAfterCoreCommit: () => { throw new Error('capture partial bank posting'); },
    });
  } catch { /* the partial commit is the point */ }
  const saleKey = `checkout:${tx.id}:sale`;
  save.cash = state.cash;
  save.ledger = JSON.parse(JSON.stringify(state.ledger));
  delete save.ledger.processedIds[saleKey];
  mutate(save, tx);
  return save;
}

function runArm(label, save) {
  const { state: boot1 } = deserializeWithReport(JSON.stringify(save));
  const latched1 = checkoutWalIsQuarantined(boot1);
  const reason1 = boot1.shop.pendingCheckoutsQuarantine?.reason ?? null;
  if (!latched1) {
    return { label, latchedOnFirstBoot: false, note: 'arm did not trip — nothing to test' };
  }
  const release = releaseCheckoutWalQuarantine(boot1, { acknowledgedBy: 'relatch-probe' });
  const clearedInMemory = !checkoutWalIsQuarantined(boot1);
  const saved = serialize(boot1);
  const { state: boot2 } = deserializeWithReport(saved);
  const latched2 = checkoutWalIsQuarantined(boot2);
  return {
    label,
    latchedOnFirstBoot: latched1,
    reasonOnFirstBoot: reason1,
    released: release.released,
    clearedInMemory,
    RE_LATCHED_ON_NEXT_BOOT: latched2,
    reasonOnSecondBoot: boot2.shop.pendingCheckoutsQuarantine?.reason ?? null,
    verdict: latched2
      ? 'EVERY BOOT — the key is useless against this trip site'
      : 'ONCE — the release survives a save/load round trip',
  };
}

const arms = [
  // Site 1: shop.pendingCheckouts itself is not a record. The release rewrites
  // that exact field, so the next load sees a clean {} instead.
  runArm('malformed-wal', tornSave('malformed', (save) => {
    save.shop.pendingCheckouts = 'lost-checkout-journal';
  })),
  // Site 2: the WAL field is absent while the ledger still carries the orphan
  // bank row. classifyCheckoutJournalCoherence reads the LEDGER, not the WAL.
  runArm('missing-wal-with-orphan-ledger-row', tornSave('missing', (save, tx) => {
    delete save.shop.pendingCheckouts;
    const outcomeKey = `checkout:${tx.id}:completed`;
    save.ledger.outcomes.push({ id: `orphan-outcome:${tx.id}`, idempotencyKey: outcomeKey });
    delete save.ledger.processedOutcomeIds[outcomeKey];
  })),
  // Site 3: WAL present and well-formed, but the settlement receipts disagree
  // with it -- again evidence the release does not rewrite.
  runArm('incoherent-receipts', tornSave('incoherent', (save, tx) => {
    save.shop.pendingCheckouts = {};
    save.shop.checkoutSettlementReceipts = {
      [`checkout:${tx.id}`]: { version: 1, settlementId: `checkout:${tx.id}` },
    };
    save.shop.checkoutSettlementReceiptKeys = [`checkout:${tx.id}`];
  })),
];

console.log(JSON.stringify({
  question: 'Is the WAL quarantine set once, or re-set on every boot?',
  arms,
  answer: arms.some((a) => a.RE_LATCHED_ON_NEXT_BOOT)
    ? 'IT DEPENDS ON THE TRIP SITE — at least one re-latches every boot'
    : 'SET ONCE — no tested trip site re-latches after a release',
}, null, 2));
