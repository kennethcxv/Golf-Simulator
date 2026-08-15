// The notification feed: written by the sim at real moments, deduped, bounded, persisted.
import test from 'node:test';
import assert from 'node:assert/strict';

import { newGame, snapshot, deserialize } from '../src/sim/state.js';
import {
  notify, unreadCount, markRead, markAllRead, dismissNotification,
  ensureNotifications, NOTIF_CAP,
} from '../src/sim/notifications.js';
import { placeOrder, tickDeliveries } from '../src/sim/shop.js';
import { FALLBACK_CAPACITY, PAD_CAPACITY, arriveOrder } from '../src/sim/deliveries.js';
import { postReview } from '../src/sim/reviews.js';

test('notify files an item, unread until read', () => {
  const st = newGame('relaxed', 41);
  const item = notify(st, { kind: 'stock', text: 'Sold out: Range Balls.' });
  assert.ok(item);
  assert.equal(unreadCount(st), 1);
  assert.equal(st.notifications.items[0].text, 'Sold out: Range Balls.');
  assert.equal(st.notifications.items[0].page, 'inventory'); // kind default
  markRead(st, item.id);
  assert.equal(unreadCount(st), 0);
});

test('a dedupe key files a fact once, however often it recurs', () => {
  const st = newGame('relaxed', 42);
  assert.ok(notify(st, { kind: 'stock', text: 'Sold out: X', dedupeKey: 'sellout:x:3' }));
  assert.equal(notify(st, { kind: 'stock', text: 'Sold out: X', dedupeKey: 'sellout:x:3' }), null);
  assert.equal(st.notifications.items.length, 1);
});

test('the feed is bounded at NOTIF_CAP - newest wins', () => {
  const st = newGame('relaxed', 43);
  for (let i = 0; i < NOTIF_CAP + 15; i++) notify(st, { text: `event ${i}` });
  assert.equal(st.notifications.items.length, NOTIF_CAP);
  assert.equal(st.notifications.items[0].text, `event ${NOTIF_CAP + 14}`);
});

test('mark all read and dismiss both do what they say', () => {
  const st = newGame('relaxed', 44);
  notify(st, { text: 'one' });
  const two = notify(st, { text: 'two' });
  markAllRead(st);
  assert.equal(unreadCount(st), 0);
  assert.equal(dismissNotification(st, two.id), true);
  assert.equal(st.notifications.items.length, 1);
  assert.equal(dismissNotification(st, 9999), false);
});

test('unread notifications survive snapshot → deserialize; ids keep advancing', () => {
  const st = newGame('relaxed', 45);
  notify(st, { kind: 'money', text: 'Rent is due.' });
  notify(st, { kind: 'review', text: 'New review: 2★.' });
  markRead(st, st.notifications.items[1].id);
  const loaded = deserialize(JSON.stringify(snapshot(st)));
  assert.equal(loaded.notifications.items.length, 2);
  assert.equal(unreadCount(loaded), 1);
  const next = notify(loaded, { text: 'after reload' });
  assert.ok(next.id > loaded.notifications.items[1].id);
});

test('a damaged feed heals instead of crashing the laptop', () => {
  const st = newGame('relaxed', 46);
  st.notifications = { items: [null, { id: 'x' }, { id: 7, kind: 'nope', text: 'ok row', minute: NaN }], nextId: 'bad' };
  const n = ensureNotifications(st);
  assert.equal(n.items.length, 1);
  assert.equal(n.items[0].kind, 'system'); // unknown kind heals to system
  assert.equal(n.items[0].minute, 0);
  assert.ok(Number.isFinite(n.nextId) && n.nextId > 7);
});

test('a delivered order files exactly one delivery notification', () => {
  const st = newGame('relaxed', 47);
  st.cash = 50000;
  const res = placeOrder(st, 'balls1', 12);
  assert.ok(res.ok);
  const order = st.shop.orders[0];
  arriveOrder(st, order);
  const deliveryNotes = st.notifications.items.filter((i) => i.kind === 'delivery');
  assert.equal(deliveryNotes.length, 1);
  arriveOrder(st, order); // same order again must not double-file (dedupe by order id)
  assert.equal(st.notifications.items.filter((i) => i.kind === 'delivery').length, 1);
});

test('a posted review files one heads-up per day, not one per review', () => {
  const st = newGame('relaxed', 48);
  postReview(st, { stars: 2, text: 'Slow service.', day: 3, cited: [] });
  postReview(st, { stars: 5, text: 'Lovely greens.', day: 3, cited: [] });
  assert.equal(st.notifications.items.filter((i) => i.kind === 'review').length, 1);
  postReview(st, { stars: 4, text: 'Nice pro shop.', day: 4, cited: [] });
  assert.equal(st.notifications.items.filter((i) => i.kind === 'review').length, 2);
});

test('a blocked van tells the office once per episode', () => {
  const st = newGame('relaxed', 49);
  st.cash = 80000;
  // Fill both authored receiving zones so the next van has no safe unloading
  // position. The service wing now provides a twelve-carton fallback beyond
  // the nine pallet positions.
  placeOrder(st, 'balls1', 6);
  const order = st.shop.orders[0];
  st.shop.deliveries = st.shop.deliveries || {};
  arriveOrder(st, { ...order, id: 900, manifest: order.manifest });
  const d = st.shop.deliveries;
  while (d.boxes.filter((box) => box.loc === 'pad').length < PAD_CAPACITY) {
    const receivingSlot = d.boxes.filter((box) => box.loc === 'pad').length;
    d.boxes.push({ ...d.boxes[0], id: d.nextBoxId++, loc: 'pad', receivingSlot });
  }
  while (d.boxes.filter((box) => box.loc === 'receiving-fallback').length < FALLBACK_CAPACITY) {
    const receivingSlot = d.boxes.filter((box) => box.loc === 'receiving-fallback').length;
    d.boxes.push({
      ...d.boxes[0], id: d.nextBoxId++, loc: 'receiving-fallback', receivingSlot,
    });
  }
  // force the real order due now, with a manifest bigger than the free pad space
  order.deliveryMin = st.clock.minutes;
  order.window = { open: st.clock.minutes - 10, close: st.clock.minutes + 10 };
  order.arrivesDay = Math.floor(st.clock.minutes / 1440);
  const before = st.notifications.items.filter((i) => /could not unload/.test(i.text)).length;
  tickDeliveries(st, st.clock.minutes);
  tickDeliveries(st, st.clock.minutes + 1); // second tick of the same episode: no repeat
  const after = st.notifications.items.filter((i) => /could not unload/.test(i.text)).length;
  assert.equal(after - before, 1);
});
