import fs from 'node:fs';
import path from 'node:path';
import { newGame, serialize } from '../../../src/sim/state.js';
import { pickFromShelf } from '../../../src/sim/checkout.js';
import {
  acceptCash, bagItem, changeDue, completeSale, createTx, depositTendered,
  handOverChange, handOverGoods, makeChange, newDrawer, openDrawer, packReceipt,
  printReceipt, requestPayment, scanItem, takeFromDrawer, takeReceipt,
} from '../../../src/sim/register.js';

const outDir = process.argv[2];
fs.mkdirSync(outDir, { recursive: true });

const state = newGame('relaxed', 24131);
const item = { uid: 'ctrl-unit', skuId: 'balls1', name: 'Practice Balls', price: 15 };
pickFromShelf(state, item.skuId, item.uid);
state.shop.drawer = newDrawer();
const tx = createTx({ items: [item], mode: 'relaxed', prefer: 'cash', rng: () => 0.9 });
scanItem(tx, item.uid); requestPayment(tx); tx.tendered = makeChange(20); acceptCash(tx); openDrawer(tx);
depositTendered(tx, state.shop.drawer);
for (const [d, c] of Object.entries(makeChange(changeDue(tx)))) {
  for (let i = 0; i < c; i += 1) takeFromDrawer(tx, state.shop.drawer, Number(d));
}
handOverChange(tx, state.shop.drawer); printReceipt(tx); takeReceipt(tx);
packReceipt(tx); bagItem(tx, item.uid); handOverGoods(tx);

const save = JSON.parse(serialize(state));
try {
  completeSale(state, tx, 'Control', { qaFaultAfterCoreCommit: () => { throw new Error('x'); } });
} catch { /* the partial commit is the point */ }
save.cash = state.cash;
save.ledger = JSON.parse(JSON.stringify(state.ledger));
delete save.ledger.processedIds[`checkout:${tx.id}:sale`];
save.shop.pendingCheckouts = 'lost-checkout-journal';
fs.writeFileSync(path.join(outDir, 'control-latched.json'), JSON.stringify(save));
console.log('wrote control-latched.json');
