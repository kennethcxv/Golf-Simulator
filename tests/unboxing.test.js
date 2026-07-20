// "NO PART OF THIS LOOP SHOULD BE REPLACED BY ONE E PRESS."
//
// It was three E presses, end to end. One cut the tape (`cut = true`). One emptied the box and
// TELEPORTED its contents into the backroom (`inv.back += taken`). One stood at a fixture and
// dumped the entire backroom onto the shelf. There was no tape to cut through, no flap to open,
// nothing to see inside the carton, and — the real hole — nothing was ever CARRIED between the box
// and the shelf. Steps 7 through 12 of the brief's sixteen did not exist.
//
// They exist now:
//
//   cut the tape (progressive)  ->  open one flap  ->  open the other  ->  take an armful into
//   YOUR HANDS  ->  walk it to a fixture  ->  hold to stock it, one at a time, until the shelf is
//   full  ->  keep whatever would not fit  ->  flatten the empty  ->  carry it to the bin  ->
//   recycle it.
//
// The load-bearing invariant underneath all of it: a unit exists in exactly one place. In the box,
// in your hands, in the backroom, or on the shelf. Every verb below moves it from one to another
// and no verb creates or destroys one.

import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame } from '../src/sim/state.js';
import { skuById } from '../src/data/shopItems.js';
import { capacityOf } from '../src/data/fixtureSlots.js';
import {
  boxesOf, arriveOrder, pickUpBox, putDownBox, carriedBox,
  cutTape, openFlap, takeFromBox, flattenBox, recycleBox,
  tapeUncut, tapePartlyCut, tapeCut, flapsClosed, flapsOpen,
  isFull, isPartial, isEmpty, boxState,
} from '../src/sim/deliveries.js';
import {
  carriedGoods, armfulOf, stockFixture, storeInBack, takeFromBack,
  homeOf, carrySpeedFactor,
} from '../src/sim/stocking.js';

// The fixer-upper opens with a sad little spread already on the shelves (10 dozen range rocks, 14
// tee bags, 4 gloves, 5 caps). Every test here is about MOVEMENT, so start from a bare shop and
// count only what we put in it.
function bareShop(seed = 7) {
  const st = newGame('relaxed', seed);
  for (const inv of Object.values(st.shop.inventory)) { inv.shelf = 0; inv.back = 0; }
  return st;
}

function landed(skuId = 'balls2', qty = 12) {
  const st = bareShop();
  arriveOrder(st, { id: 1, skuId, qty });
  return st;
}

// every unit of a line, wherever it is
function unitsOf(st, skuId) {
  const inv = st.shop.inventory[skuId] || { shelf: 0, back: 0 };
  const inBoxes = boxesOf(st).filter((b) => b.skuId === skuId).reduce((n, b) => n + (b.qty || 0), 0);
  const c = carriedGoods(st);
  const inHand = c && c.skuId === skuId ? c.qty : 0;
  return inv.shelf + inv.back + inBoxes + inHand;
}

// --- opening a box ---------------------------------------------------------------------------

test('the box arrives sealed: taped, flaps shut, full, and it will not give you anything', () => {
  const st = landed();
  const b = boxesOf(st)[0];
  assert.ok(tapeUncut(b));
  assert.ok(flapsClosed(b));
  assert.ok(isFull(b));
  assert.equal(boxState(b), 'delivered');
  assert.equal(takeFromBox(st, b.id).ok, false, 'a sealed box gives you nothing');
  assert.equal(openFlap(st, b.id).ok, false, 'and the flaps will not lift through the tape');
});

test('cutting the tape is a cut, not a switch — half-cut is a real state you can save', () => {
  const st = landed();
  const b = boxesOf(st)[0];

  const a = cutTape(st, b.id, 0.3);
  assert.ok(a.ok);
  assert.ok(tapePartlyCut(b), 'the blade is part way down the seam');
  assert.equal(boxState(b), 'tape partially cut');
  assert.equal(a.seam, 'centre', 'the centre seam goes first');
  assert.equal(openFlap(st, b.id).ok, false, 'and it is still shut');

  const mid = JSON.parse(JSON.stringify(st));   // a half-cut box survives a save
  assert.ok(tapePartlyCut(boxesOf(mid)[0]));

  cutTape(st, b.id, 0.4);
  assert.equal(cutTape(st, b.id, 0.1).seam, 'side', 'then the side tapes');
  const done = cutTape(st, b.id, 1);
  assert.ok(done.done);
  assert.ok(tapeCut(b));
  assert.equal(cutTape(st, b.id, 1).ok, false, 'and the tape only cuts once');
});

test('you cannot cut a box you are holding — you need both hands', () => {
  const st = landed();
  const b = boxesOf(st)[0];
  pickUpBox(st, b.id);
  assert.equal(cutTape(st, b.id, 1).ok, false);
  assert.match(cutTape(st, b.id, 1).reason, /down|hands/i);
  putDownBox(st, b.id, { x: 7.2, z: -5.3, ry: 0 });
  assert.ok(cutTape(st, b.id, 1).ok);
});

test('the flaps open one at a time, and only once the tape is gone', () => {
  const st = landed();
  const b = boxesOf(st)[0];
  cutTape(st, b.id, 1);
  assert.ok(flapsClosed(b));
  assert.equal(boxState(b), 'flaps closed');
  assert.equal(takeFromBox(st, b.id).ok, false, 'still nothing out of a shut box');

  const one = openFlap(st, b.id);
  assert.ok(one.ok);
  assert.equal(one.flap, 0);
  assert.equal(one.done, false, 'one flap is not open');
  assert.ok(!flapsOpen(b));
  assert.equal(takeFromBox(st, b.id).ok, false, 'and one flap is not enough to reach in');

  const two = openFlap(st, b.id);
  assert.ok(two.ok);
  assert.equal(two.flap, 1);
  assert.ok(two.done);
  assert.ok(flapsOpen(b));
  assert.equal(openFlap(st, b.id).ok, false, 'there are only two');
});

// --- the contents come out into your hands ----------------------------------------------------

test('contents come out into YOUR HANDS — they do not teleport into the backroom', () => {
  const st = landed('balls2', 12);
  const b = boxesOf(st)[0];
  const before = unitsOf(st, 'balls2');
  cutTape(st, b.id, 1); openFlap(st, b.id); openFlap(st, b.id);

  const t = takeFromBox(st, b.id);
  assert.ok(t.ok);
  assert.equal(st.shop.inventory.balls2.back, 0, 'the backroom did not magically gain anything');
  const hands = carriedGoods(st);
  assert.ok(hands, 'you are holding them');
  assert.equal(hands.skuId, 'balls2');
  assert.equal(hands.qty, armfulOf(skuById('balls2')), 'as many as fit in two arms');
  assert.equal(b.qty, 12 - hands.qty, 'and the box is that much lighter');
  assert.ok(isPartial(b), 'a part-emptied box is a partial box');
  assert.equal(boxState(b), 'partial contents');
  assert.equal(unitsOf(st, 'balls2'), before, 'no unit was created or destroyed');
});

test('an armful is an armful: a big case takes more than one trip', () => {
  const st = landed('balls2', 12);
  const b = boxesOf(st)[0];
  cutTape(st, b.id, 1); openFlap(st, b.id); openFlap(st, b.id);
  const arm = armfulOf(skuById('balls2'));
  assert.ok(arm < 12, 'twelve dozen boxes is not one armful');

  takeFromBox(st, b.id);
  assert.equal(takeFromBox(st, b.id).ok, false, 'your arms are already full');
  storeInBack(st);                                  // put them down in the back
  assert.equal(carriedGoods(st), null);
  assert.equal(st.shop.inventory.balls2.back, arm);

  takeFromBox(st, b.id);                            // go back for the rest
  storeInBack(st);
  assert.equal(b.qty, Math.max(0, 12 - arm * 2));
});

test('you cannot carry a box and an armful at the same time, or two different lines at once', () => {
  const st = bareShop();
  arriveOrder(st, { id: 1, skuId: 'balls2', qty: 12 });
  arriveOrder(st, { id: 2, skuId: 'glove1', qty: 8 });
  const [ballBox, gloveBox] = boxesOf(st);
  for (const b of [ballBox, gloveBox]) {
    cutTape(st, b.id, 1); openFlap(st, b.id); openFlap(st, b.id);
  }
  takeFromBox(st, ballBox.id);
  assert.equal(pickUpBox(st, gloveBox.id).ok, false, 'not with your arms full of golf balls');
  assert.equal(takeFromBox(st, gloveBox.id).ok, false, 'and not a mixed armful');
  storeInBack(st);
  assert.ok(pickUpBox(st, gloveBox.id).ok, 'hands free, box up');
  assert.equal(takeFromBox(st, ballBox.id).ok, false, 'and not while holding a box');
});

test('an empty box stays in the world as an empty box — it does not vanish when you take the last one', () => {
  const st = landed('glove1', 8);
  const b = boxesOf(st)[0];
  cutTape(st, b.id, 1); openFlap(st, b.id); openFlap(st, b.id);
  let guard = 20;
  while (b.qty > 0 && guard-- > 0) {
    takeFromBox(st, b.id);
    storeInBack(st);
  }
  assert.equal(b.qty, 0);
  assert.ok(isEmpty(b));
  assert.equal(boxState(b), 'empty');
  assert.equal(boxesOf(st).length, 1, 'the carton is still standing there');
  assert.equal(st.shop.inventory.glove1.back, 8, 'and every glove is accounted for');
});

// --- stocking a fixture ------------------------------------------------------------------------

test('a fixture takes what belongs on it, and tells you where the rest goes', () => {
  const st = landed('cap1', 8);
  const b = boxesOf(st)[0];
  cutTape(st, b.id, 1); openFlap(st, b.id); openFlap(st, b.id);
  takeFromBox(st, b.id);

  const wrong = stockFixture(st, 'shelf_balls');
  assert.equal(wrong.ok, false, 'caps do not go on the ball wall');
  assert.ok(wrong.invalid);
  assert.match(wrong.reason, /club headwear/i, 'and it says where they DO go');
  assert.equal(st.shop.inventory.cap1.shelf, 0, 'nothing moved');
  assert.equal(carriedGoods(st).qty, armfulOf(skuById('cap1')), 'you are still holding them all');

  const right = stockFixture(st, 'hatstand', 99);
  assert.ok(right.ok);
  assert.equal(right.moved, Math.min(armfulOf(skuById('cap1')), capacityOf('cap1')));
  assert.equal(st.shop.inventory.cap1.shelf, right.moved);
  assert.equal(carriedGoods(st).qty, armfulOf(skuById('cap1')) - right.moved,
    'the authored four-cap facing leaves the overflow in your hands');
  assert.equal(homeOf('cap1').id, 'hatstand');
});

test('every line for sale has exactly one fixture that accepts it — no orphans, no ambiguity', () => {
  // "Enforce: hats on hat fixtures, shirts on apparel fixtures, balls on ball shelves, clubs on
  // club racks, bags on bag stands, shoes on shoe displays, accessories on compatible small-product
  // fixtures." Every one of those is a row in FIXTURES[].skus, and this is the proof.
  const st = bareShop();
  for (const id of ['cap1', 'polo1', 'balls3', 'driver1', 'bag1', 'shoe1', 'tees1', 'range2']) {
    const home = homeOf(id);
    assert.ok(home, `${id} has somewhere to go`);
    st.shop.carry = { skuId: id, qty: 1 };
    assert.ok(stockFixture(st, home.id, 1).ok, `${id} is accepted by ${home.id}`);
    // and refused everywhere else
    st.shop.carry = { skuId: id, qty: 1 };
    const elsewhere = ['shelf_balls', 'hatstand', 'rack_drivers', 'bagstand', 'shoerack', 'table_polos']
      .filter((fid) => fid !== home.id);
    for (const fid of elsewhere) {
      const r = stockFixture(st, fid, 1);
      assert.equal(r.ok, false, `${id} must not go on ${fid}`);
      assert.ok(r.invalid, `${id} on ${fid} is an INVALID placement, not merely a full one`);
    }
    st.shop.carry = null;
  }
});

test('stocking stops when the shelf is full and RETAINS the leftovers in your hands', () => {
  // The real situation: the ball wall holds 15 and there are already 12 on it. You walk up with an
  // armful of six. Three go on. THREE STAY IN YOUR ARMS — they are not deleted, and they are not
  // silently teleported into the backroom either.
  const st = bareShop();
  const cap = 15;
  st.shop.inventory.balls1.shelf = cap - 3;
  st.shop.inventory.balls1.back = 6;

  takeFromBack(st, 'balls1', 6);
  const held = carriedGoods(st).qty;
  assert.equal(held, 6, 'an armful of six');

  const res = stockFixture(st, 'shelf_balls', 99);
  assert.ok(res.ok);
  assert.equal(res.moved, 3, 'only three would fit');
  assert.ok(res.full, 'and it said the wall is full now');
  assert.equal(st.shop.inventory.balls1.shelf, cap);
  assert.equal(carriedGoods(st).qty, held - 3, 'the rest is still in your arms');

  const again = stockFixture(st, 'shelf_balls', 1);
  assert.equal(again.ok, false, 'a full wall takes no more');
  assert.ok(again.full);
  assert.equal(carriedGoods(st).qty, 3, 'and you are still holding them');

  storeInBack(st);                                  // so take them back to the stockroom
  assert.equal(st.shop.inventory.balls1.back, 3);
  assert.equal(carriedGoods(st), null);
});

test('one at a time or a whole armful — hold-to-stock puts them on the shelf one by one', () => {
  const st = bareShop();
  st.shop.inventory.balls1.back = 10;
  takeFromBack(st, 'balls1', 6);

  const one = stockFixture(st, 'shelf_balls', 1);
  assert.equal(one.moved, 1, 'one press, one box');
  assert.equal(st.shop.inventory.balls1.shelf, 1);

  const rest = stockFixture(st, 'shelf_balls', 99);
  assert.equal(rest.moved, 5, 'and the rest go on when you hold it');
  assert.equal(st.shop.inventory.balls1.shelf, 6);
  assert.equal(carriedGoods(st), null, 'hands empty');
});

// --- the cardboard ------------------------------------------------------------------------------

test('flatten only when empty; recycle only when flat; and a flattened box is still a box', () => {
  const st = landed('tees1', 12);
  const b = boxesOf(st)[0];
  assert.equal(flattenBox(st, b.id).ok, false, 'you cannot flatten a full carton');

  cutTape(st, b.id, 1); openFlap(st, b.id); openFlap(st, b.id);
  let guard = 20;
  while (b.qty > 0 && guard-- > 0) { takeFromBox(st, b.id); storeInBack(st); }
  assert.ok(isEmpty(b));

  assert.equal(recycleBox(st, b.id).ok, false, 'and you cannot bin one that is not flat');
  assert.ok(flattenBox(st, b.id).ok);
  assert.equal(b.flat, true);
  assert.equal(boxState(b), 'flattened');
  assert.equal(boxesOf(st).length, 1, 'a flattened box is still in the room — it did not evaporate');

  // and you can carry the flat one to the bin
  assert.ok(pickUpBox(st, b.id).ok);
  assert.equal(carriedBox(st).id, b.id);
  putDownBox(st, b.id, { x: 9.85, z: 1.3, ry: 0 });

  assert.ok(recycleBox(st, b.id).ok);
  assert.equal(boxesOf(st).length, 0, 'now it is gone');
  assert.equal(st.shop.deliveries.recycled, 1, 'and counted');
  assert.equal(recycleBox(st, b.id).ok, false, 'once');
});

// --- old saves -----------------------------------------------------------------------------------

test('a box from a save written before the tape existed does not seal itself back up', () => {
  // Saves carry `{cut: true, empty: true}` and no tape, no flaps, no cap. Read that raw and
  // tapeCut() sees `b.tape || 0` -> 0: a box the player had already opened would demand to be cut
  // again, and half its contents would be sitting in a backroom it claimed to be sealed against.
  const st = bareShop();
  st.shop.deliveries = {
    boxes: [
      { id: 1, skuId: 'balls2', orderId: 1, qty: 6, loc: 'stock', box: 'ballcase', cut: true },
      { id: 2, skuId: 'tees1', orderId: 1, qty: 12, loc: 'pad', box: 'carton' },
    ],
    nextBoxId: 3,
    trash: 0,
  };

  const boxes = boxesOf(st);   // ensureDeliveries migrates on the way through
  assert.ok(tapeCut(boxes[0]), 'the one they had opened is still open');
  assert.ok(flapsOpen(boxes[0]));
  assert.ok(tapeUncut(boxes[1]), 'and the one they had not is still sealed');
  assert.ok(flapsClosed(boxes[1]));
  for (const b of boxes) {
    assert.equal(typeof b.cap, 'number', 'every box knows what it shipped with');
    assert.equal(typeof b.lb, 'number', 'and what it weighs');
    assert.equal(b.flat, false);
  }
  // and it can be finished off without re-cutting
  const t = takeFromBox(st, 1);
  assert.ok(t.ok, 'you can reach straight into the one that was already open');
});

// --- weight -------------------------------------------------------------------------------------

test('a heavy box slows you down, and a flattened one does not', () => {
  const st = bareShop();
  arriveOrder(st, { id: 1, skuId: 'lounge1', qty: 1 });   // a 124 lb furniture crate
  arriveOrder(st, { id: 2, skuId: 'tees1', qty: 4 });     // a carton of tee bags
  const [crate, carton] = boxesOf(st);

  assert.equal(carrySpeedFactor(st), 1, 'empty-handed you walk at your own pace');

  pickUpBox(st, crate.id);
  const heavy = carrySpeedFactor(st);
  assert.ok(heavy < 0.6, `the lounge suite is a genuine burden (${heavy.toFixed(2)})`);
  putDownBox(st, crate.id, { x: 7, z: -5, ry: 0 });

  pickUpBox(st, carton.id);
  const light = carrySpeedFactor(st);
  assert.ok(light > heavy, 'a box of tees is not');
  assert.ok(light > 0.9, `and barely slows you at all (${light.toFixed(2)})`);
});

// --- the whole loop, conserved ---------------------------------------------------------------

test('THE LOOP: pad -> stockroom -> cut -> flaps -> hands -> shelf, and not one ball goes missing', () => {
  const st = landed('balls1', 24);
  const total = unitsOf(st, 'balls1');
  assert.equal(total, 24);

  for (const b of [...boxesOf(st)]) {
    assert.equal(b.loc, 'pad');
    pickUpBox(st, b.id);
    assert.equal(unitsOf(st, 'balls1'), total, 'carrying a box does not change the count');
    putDownBox(st, b.id, { x: 7.2, z: -5.3, ry: 0 });   // into the stockroom
    assert.equal(b.loc, 'world');

    cutTape(st, b.id, 0.5);
    assert.equal(unitsOf(st, 'balls1'), total);
    cutTape(st, b.id, 0.5);
    openFlap(st, b.id);
    openFlap(st, b.id);

    let guard = 30;
    while (b.qty > 0 && guard-- > 0) {
      takeFromBox(st, b.id);
      assert.equal(unitsOf(st, 'balls1'), total, 'nothing lost between the box and your arms');
      const res = stockFixture(st, 'shelf_balls', 99);
      if (!res.ok || carriedGoods(st)) storeInBack(st);   // shelf full -> the rest goes to the back
      assert.equal(unitsOf(st, 'balls1'), total, 'nothing lost between your arms and the shelf');
    }
    flattenBox(st, b.id);
    recycleBox(st, b.id);
    assert.equal(unitsOf(st, 'balls1'), total, 'and none of it went out with the cardboard');
  }

  assert.equal(boxesOf(st).length, 0, 'all the cardboard is recycled');
  assert.equal(carriedGoods(st), null, 'your hands are empty');
  const inv = st.shop.inventory.balls1;
  assert.equal(inv.shelf + inv.back, 24, 'and all 24 dozen are on the shelf or in the back');
  assert.ok(inv.shelf > 0, 'with some of them actually out where people can buy them');
});
