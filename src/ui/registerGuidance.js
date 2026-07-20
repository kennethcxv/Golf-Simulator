// Player-facing checkout guidance, kept pure so every transaction stage can be
// checked without a browser. The 3D register remains the source of interaction;
// this module translates its live state into one concise, relevant instruction.

import {
  allBagged, changeDue, handTotal, stackTotal, totalOf, unscannedCount,
} from '../sim/register.js';

export const REGISTER_PROGRESS = ['Scan', 'Pay', 'Receipt', 'Bag', 'Handoff'];

const mouse = (label) => ({ key: 'Mouse', label });
const key = (keyName, label) => ({ key: keyName, label });

export function registerGuidance(tx, {
  customerName = 'Customer',
  swipeFeedback = '',
  receiptReady = null,
  handoffPending = false,
} = {}) {
  if (!tx) return null;
  const scanned = tx.items.length - unscannedCount(tx);
  const total = `$${totalOf(tx).toFixed(2)}`;
  const base = {
    customer: customerName,
    total,
    progress: 0,
    tone: 'normal',
    title: 'Scan the order',
    detail: `Drag each item across the glass. A beep confirms it (${scanned}/${tx.items.length}).`,
    controls: [mouse('Drag items')],
  };

  if (tx.stage === 'scanning') {
    if (unscannedCount(tx) === 0) {
      base.title = 'Order ready to total';
      base.detail = `${tx.items.length} items scanned. Confirm the amount on the POS.`;
      base.tone = 'ready';
      base.controls = [key('T', 'Total order')];
    }
  } else if (tx.stage === 'payment') {
    base.progress = 1;
    base.title = 'Choose payment';
    base.detail = 'Ask how the customer would like to pay.';
    base.controls = [mouse('Choose method')];
  } else if (tx.stage === 'card-present') {
    base.progress = 1;
    base.title = 'Customer has a card ready';
    base.detail = 'Select the card reader to receive the card.';
    base.controls = [mouse('Select reader')];
  } else if (tx.stage === 'card-ready') {
    base.progress = 1;
    base.title = swipeFeedback || 'Swipe the card';
    base.detail = swipeFeedback
      ? 'Return to the top, then pull the card all the way down at a steady pace.'
      : 'Hold the visible card and pull it from the top of the reader to the bottom.';
    base.tone = swipeFeedback ? 'warn' : 'ready';
    base.controls = [mouse('Drag card down')];
  } else if (tx.stage === 'card-busy') {
    base.progress = 1;
    base.title = 'Authorising payment';
    base.detail = 'The terminal is contacting the bank.';
    base.tone = 'busy';
    base.controls = [];
  } else if (tx.stage === 'card-declined') {
    base.progress = 1;
    base.title = tx.cardResult === 'timeout' ? 'Terminal timed out' : 'Card declined';
    base.detail = 'Select the reader when the customer has another card.';
    base.tone = 'warn';
    base.controls = [mouse('Try another card')];
  } else if (tx.stage === 'cash-tender') {
    base.progress = 1;
    base.title = `Take ${stackTotal(tx.tendered || {}).toFixed(2) === '0.00' ? 'the cash' : `$${stackTotal(tx.tendered || {}).toFixed(2)}`}`;
    base.detail = 'Select the notes the customer placed on the counter.';
    base.controls = [mouse('Take tender')];
  } else if (tx.stage === 'cash-drawer') {
    base.progress = 1;
    const due = changeDue(tx);
    const held = handTotal(tx);
    if (!tx.drawerOpen) {
      base.title = 'Open the cash drawer';
      base.detail = 'The tender is in hand and the till is ready.';
      base.controls = [key('D', 'Open drawer')];
    } else if (!tx.deposited) {
      base.title = 'Put the tender in the till';
      base.detail = 'Drag each customer note into the open drawer.';
      base.controls = [mouse('Deposit cash')];
    } else if (due <= 0) {
      base.title = 'Exact cash received';
      base.detail = 'Close the drawer to finish payment.';
      base.tone = 'ready';
      base.controls = [key('D', 'Close drawer')];
    } else if (held + 0.001 < due) {
      base.title = `Count $${due.toFixed(2)} change`;
      base.detail = `Select the requested denominations from the till · holding $${held.toFixed(2)}.`;
      base.controls = [mouse('Select change')];
    } else {
      base.title = `Hand back $${due.toFixed(2)}`;
      base.detail = 'The count is correct. Select the customer’s open hand.';
      base.tone = 'ready';
      base.controls = [mouse('Hand over change')];
    }
  } else if (tx.stage === 'receipt') {
    const paperReady = receiptReady == null ? tx.receiptPrinted : receiptReady;
    base.progress = 2;
    base.title = paperReady ? 'Take the receipt' : 'Printing receipt';
    base.detail = paperReady
      ? 'Select the paper at the printer before bagging.'
      : 'The sale is paid. Wait for the printer to finish.';
    base.tone = paperReady ? 'ready' : 'busy';
    base.controls = paperReady ? [mouse('Take receipt')] : [];
  } else if (tx.stage === 'bagging') {
    const bagged = tx.items.filter((item) => item.bagged).length;
    base.progress = allBagged(tx) ? 4 : 3;
    base.title = allBagged(tx) ? 'Hand over the order' : `Bag the goods · ${bagged}/${tx.items.length}`;
    base.detail = allBagged(tx)
      ? 'Everything is packed. Select the customer’s open hand.'
      : 'Drag each scanned item into the open carrier.';
    base.tone = allBagged(tx) ? 'ready' : 'normal';
    base.controls = [mouse(allBagged(tx) ? 'Hand over bag' : 'Bag items')];
  } else if (tx.stage === 'done') {
    base.progress = 4;
    base.title = handoffPending ? 'Handing over the order' : 'Order complete';
    base.detail = handoffPending
      ? 'The packed carrier is moving into the customer’s hand.'
      : 'The customer has their purchase.';
    base.tone = handoffPending ? 'busy' : 'ready';
    base.controls = [];
  }

  base.controls.push(key('Esc', 'Step back'));
  return base;
}
