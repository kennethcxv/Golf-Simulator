// You have to be able to stand behind your own till.
//
// Measured in the running game: the counter's back face sits at z 5.2 and the back counter's front
// face at z 5.75 — a 0.55 yd slot. A person is 0.68 yd across. The player could not fit behind the
// register at all, which is why "there is insufficient room behind the checkout counter" and "the
// player can have difficulty entering the staff side".
//
// A till is a workspace: you stand at it, you turn, you pull the drawer open, you bag. That needs
// real room, and the room has to survive anyone editing the floor plan.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COUNTER, FIXTURES, INTERIOR, PLAYER_DIAM, STAFF_CORRIDOR_MIN, queueSlot,
  REGISTER, COUNTER_TOP, FRONT_DESK_COLLIDERS, FRONT_DESK_FRAME,
  fixtureRect, frontDeskLocalPoint, inRect,
} from '../src/data/shopLayout.js';

const backcounter = FIXTURES.find((f) => f.kind === 'backcounter');
const BACKCOUNTER_DEPTH = 0.56; // the cabinet top, which is the widest part of it

const toDeskRect = (rect) => {
  const points = [
    frontDeskLocalPoint(rect.minX, rect.minZ),
    frontDeskLocalPoint(rect.minX, rect.maxZ),
    frontDeskLocalPoint(rect.maxX, rect.minZ),
    frontDeskLocalPoint(rect.maxX, rect.maxZ),
  ];
  return {
    minX: Math.min(...points.map((point) => point.x)),
    maxX: Math.max(...points.map((point) => point.x)),
    minZ: Math.min(...points.map((point) => point.z)),
    maxZ: Math.max(...points.map((point) => point.z)),
  };
};
const counterBack = FRONT_DESK_FRAME.frontDepth / 2;
const backcounterLocal = toDeskRect(fixtureRect(backcounter));
const backcounterFront = backcounterLocal.minZ;

test('a person is wider than nothing - the constants are honest', () => {
  assert.ok(PLAYER_DIAM > 0.6 && PLAYER_DIAM < 0.8, 'a human, in yards');
  assert.ok(STAFF_CORRIDOR_MIN > PLAYER_DIAM, 'a corridor you can only just squeeze through is not a workspace');
});

test('the staff side of the counter is wide enough to work in', () => {
  const corridor = backcounterFront - counterBack;
  assert.ok(
    corridor >= STAFF_CORRIDOR_MIN,
    `the till workspace is ${corridor.toFixed(2)} yd; a person is ${PLAYER_DIAM} yd and needs ${STAFF_CORRIDOR_MIN}`,
  );
});

test('the staff corridor has a way in from the sales floor', () => {
  const mouth = FRONT_DESK_FRAME.frontLength / 2 - backcounterLocal.maxX;
  assert.ok(mouth >= STAFF_CORRIDOR_MIN,
    `the open end provides ${mouth.toFixed(2)} yd of staff access`);
});

test('the back counter stays off the south wall', () => {
  const wallInner = INTERIOR.d / 2;
  assert.ok(
    backcounter.z + BACKCOUNTER_DEPTH / 2 < wallInner - 0.05,
    'the cabinets do not clip through the building',
  );
});

test('customers queue clear of the counter, not pressed against it', () => {
  const front = -FRONT_DESK_FRAME.frontDepth / 2;
  const slot0 = frontDeskLocalPoint(queueSlot(0).x, queueSlot(0).z);
  const gap = front - slot0.z;
  assert.ok(gap > 0.45, `the first in line stands ${gap.toFixed(2)} yd off the counter, not inside it`);
  assert.ok(gap < 2.2, 'but still close enough to be served');
});

test('the queue falls back into the room, away from the counter', () => {
  const a = queueSlot(0);
  const next = queueSlot(1);
  const b = queueSlot(3);
  const localA = frontDeskLocalPoint(a.x, a.z);
  const localB = frontDeskLocalPoint(b.x, b.z);
  assert.ok(localB.z < localA.z, 'the line runs away from the counter in desk space');
  assert.ok(Math.hypot(next.x - a.x, next.z - a.z) >= 1.15,
    'adjacent customers keep a readable shoulder-and-carried-goods gap');
  assert.ok(Math.hypot(b.x - a.x, b.z - a.z) > 1.5, 'and it is a line, not a huddle');
});

// --- the workspace, measured with the real player capsule ----------------------------
// The brief: a clear path behind the counter, room to turn, room to OPERATE THE DRAWER,
// room to bag, no invisible collider blocking access, and clear sight of the customer,
// the goods, the screen and the terminal. These are the numbers that hold all of that
// open against whoever moves a fixture next.

const REG = REGISTER;
const PLAYER_R = PLAYER_DIAM / 2;
const topMinX = FRONT_DESK_COLLIDERS.frontRun.minX;
const topMaxX = FRONT_DESK_COLLIDERS.frontRun.maxX;
const topMinZ = FRONT_DESK_COLLIDERS.frontRun.minZ;
const topMaxZ = FRONT_DESK_COLLIDERS.frontRun.maxZ;
// the kit the PLAYER has to physically operate — these must fall inside their reach.
// The scanner and open bag are both operated pieces; folded bagstand spares are
// passive dressing.
const OPERATED = {
  monitor: REG.monitor, cardterm: REG.cardterm,
  scanner: REG.scanner, printer: REG.printer, bag: REG.bag,
};
// ...plus the passive dressing, which only has to be on the counter and out of the way
const KIT = {
  ...OPERATED, bagstand: REG.bagstand, divider: REG.divider, impulse: REG.impulse, custdisplay: REG.custdisplay,
};

test('you can work an open drawer and STILL get past it', () => {
  // the drawer slides out into the staff corridor. If it eats the corridor, the player
  // is pinned against the back counter every single time they take cash.
  const corridor = backcounterFront - counterBack;
  const leftOver = corridor - REG.drawer.travel;
  assert.ok(
    leftOver >= PLAYER_DIAM,
    `an open drawer leaves ${leftOver.toFixed(2)} yd of corridor; a person is ${PLAYER_DIAM} yd`,
  );
});

test('the player stands behind the counter without clipping either side of it', () => {
  assert.deepEqual(REG.stand, COUNTER.staffStand, 'one working position, not two that drift apart');
  const p = frontDeskLocalPoint(REG.stand.x, REG.stand.z);
  assert.ok(p.z - PLAYER_R > counterBack, 'not standing inside the counter');
  assert.ok(p.z + PLAYER_R < backcounterFront, 'not standing inside the back counter');
});

test('the player can reach every part of the workspace from where they stand', () => {
  const REACH = 1.55; // past this you are climbing onto the counter
  const far = (r) => Math.max(
    Math.hypot(r.minX - REG.stand.x, r.minZ - REG.stand.z),
    Math.hypot(r.maxX - REG.stand.x, r.minZ - REG.stand.z),
    Math.hypot(r.minX - REG.stand.x, r.maxZ - REG.stand.z),
    Math.hypot(r.maxX - REG.stand.x, r.maxZ - REG.stand.z),
  );
  for (const [name, rect] of Object.entries({ staging: REG.staging, bagging: REG.bagging })) {
    assert.ok(far(rect) <= REACH, `${name} is ${far(rect).toFixed(2)} yd away at its far corner`);
  }
  for (const [name, p] of Object.entries(OPERATED)) {
    const d = Math.hypot(p.x - REG.stand.x, p.z - REG.stand.z);
    assert.ok(d <= REACH, `the ${name} is ${d.toFixed(2)} yd away - out of reach`);
  }
});

test('the CUSTOMER can reach the staging tray from the head of the queue', () => {
  // The customer only needs to SET GOODS DOWN. In the simplified flow their card
  // auto-presents and auto-inserts (the PLAYER operates the terminal), so the
  // terminal lives on the staff side of the counter, inside the player's reach —
  // which the OPERATED loop above already holds.
  const CUSTOMER_REACH = 1.6; // they lean over the counter to set things down
  const q = queueSlot(0);
  const nearest = (r) => Math.min(
    Math.hypot(r.minX - q.x, r.minZ - q.z),
    Math.hypot(r.maxX - q.x, r.minZ - q.z),
  );
  assert.ok(nearest(REG.staging) <= CUSTOMER_REACH, 'they can put their goods down');
});

test('the whole kit sits ON the counter, not floating off the edge of it', () => {
  for (const [name, p] of Object.entries(KIT)) {
    assert.ok(p.x > topMinX && p.x < topMaxX, `${name} x=${p.x} is off the end of the counter`);
    assert.ok(p.z > topMinZ && p.z < topMaxZ, `${name} z=${p.z} hangs off the front or the back`);
  }
  for (const [name, r] of Object.entries({ staging: REG.staging, bagging: REG.bagging })) {
    assert.ok(r.minX > topMinX && r.maxX < topMaxX, `${name} runs off the end of the counter`);
    assert.ok(r.minZ > topMinZ && r.maxZ < topMaxZ, `${name} runs off the front or the back`);
  }
});

test('staging is on the CUSTOMER side and the bag zone is on the STAFF side', () => {
  assert.ok(toDeskRect(REG.staging).maxZ < 0, 'staging sits on the shopper half of the top');
  assert.ok(toDeskRect(REG.bagging).minZ > 0, 'the bag zone sits on the staff half');
});

// THE TCG ARRANGEMENT. From the cashier's viewpoint (standing at +z, facing the
// queue): the open BAG far LEFT, the merchandise centre-left, and the register
// block — POS, drawer, terminal, printer, customer display — on the RIGHT. A
// clicked product crosses the reader and then arcs into the bag; nothing may
// stand in either leg and nothing may hide the goods behind the monitor.
test('bag left, goods centre, register block right - and the scanner route is clear', () => {
  const stagingMid = { x: (REG.staging.minX + REG.staging.maxX) / 2, z: (REG.staging.minZ + REG.staging.maxZ) / 2 };
  const bag = frontDeskLocalPoint(REG.bag.x, REG.bag.z);
  const staging = toDeskRect(REG.staging);
  assert.ok(bag.x < stagingMid.x, 'the flat loading pouch stays on the cashier-left half of the goods');
  for (const [name, p] of Object.entries({ monitor: REG.monitor, cardterm: REG.cardterm, printer: REG.printer, custdisplay: REG.custdisplay })) {
    const local = frontDeskLocalPoint(p.x, p.z);
    assert.ok(local.x > staging.maxX, `the ${name} sits cashier-right of the goods`);
  }
  assert.ok(frontDeskLocalPoint(REG.drawer.x, REG.drawer.z).x > staging.maxX,
    'the drawer opens under the register block, not under the goods');
  // Both physical legs stay over the counter: goods to scanner, then reader to bag.
  for (const [from, to, label] of [
    [stagingMid, REG.scanner, 'scan approach'],
    [REG.scanner, REG.bag, 'bagging exit'],
  ]) {
    for (let t = 0; t <= 1; t += 0.05) {
      const x = from.x + (to.x - from.x) * t;
      const z = from.z + (to.z - from.z) * t;
      assert.ok(x > topMinX && x < topMaxX && z > topMinZ && z < topMaxZ, `${label} stays over the counter`);
    }
  }
  // and no kit device stands on the arc's landing corridor
  for (const [name, p] of Object.entries({ monitor: REG.monitor, printer: REG.printer, custdisplay: REG.custdisplay })) {
    assert.ok(Math.hypot(p.x - REG.bag.x, p.z - REG.bag.z) > 0.5, `the ${name} crowds the bag`);
  }
});

test('the kit does not squat on the surfaces it is meant to leave clear', () => {
  // the bag zone exists FOR the bag; everything else stays out of both surfaces
  assert.ok(inRect(REG.bagging, REG.bag.x, REG.bag.z), 'the open bag stands in its own zone');
  for (const [name, p] of Object.entries(KIT)) {
    assert.ok(!inRect(REG.staging, p.x, p.z), `the ${name} is sitting on the staging tray`);
    if (name === 'bag') continue;
    assert.ok(!inRect(REG.bagging, p.x, p.z), `the ${name} is sitting on the bag zone`);
  }
});

test('the drawer is under the counter and opens toward the staff, not the customer', () => {
  const d = REG.drawer;
  assert.ok(d.y < COUNTER_TOP, 'it is under the top, not on it');
  assert.ok(d.x > topMinX && d.x < topMaxX, 'and within the carcass');
  assert.ok(
    d.travel >= d.d + 0.04,
    'it opens a drawer-depth plus enough clearance to expose the rear coin cups',
  );
  const closed = frontDeskLocalPoint(d.x, d.z);
  const open = frontDeskLocalPoint(d.x + d.travelX, d.z + d.travelZ);
  const openFace = open.z + d.d / 2;
  assert.ok(open.z > closed.z, 'it slides out to the staff side');
  assert.ok(openFace < backcounterFront, 'and does not ram the back counter');
});
