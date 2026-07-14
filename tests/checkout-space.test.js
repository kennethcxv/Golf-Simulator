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
  REGISTER, COUNTER_TOP, inRect,
} from '../src/data/shopLayout.js';

const backcounter = FIXTURES.find((f) => f.kind === 'backcounter');
const BACKCOUNTER_DEPTH = 0.56; // the cabinet top, which is the widest part of it

const counterBack = COUNTER.z + COUNTER.depth / 2;
const backcounterFront = backcounter.z - BACKCOUNTER_DEPTH / 2;

test('a person is wider than nothing — the constants are honest', () => {
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
  // its west end must not be walled off: the counter's west end is the doorway into the staff side
  const counterWest = COUNTER.x - COUNTER.len / 2;
  const backcounterWest = backcounter.x - 3.3 / 2; // cabinet top is 3.3 wide
  const mouth = Math.min(counterWest, backcounterWest);
  assert.ok(mouth > -INTERIOR.w / 2 + 1.0, 'there is floor to the west of the counter to walk in from');
});

test('the back counter stays off the south wall', () => {
  const wallInner = INTERIOR.d / 2;
  assert.ok(
    backcounter.z + BACKCOUNTER_DEPTH / 2 < wallInner - 0.05,
    'the cabinets do not clip through the building',
  );
});

test('customers queue clear of the counter, not pressed against it', () => {
  const front = COUNTER.z - COUNTER.depth / 2; // the shopper's side
  const slot0 = queueSlot(0);
  const gap = front - slot0.z;
  assert.ok(gap > 0.45, `the first in line stands ${gap.toFixed(2)} yd off the counter, not inside it`);
  assert.ok(gap < 2.2, 'but still close enough to be served');
});

test('the queue falls back into the room, away from the counter', () => {
  const a = queueSlot(0);
  const b = queueSlot(3);
  assert.ok(b.z < a.z, 'the line runs back into the shop');
  assert.ok(Math.hypot(b.x - a.x, b.z - a.z) > 1.5, 'and it is a line, not a huddle');
});

// --- the workspace, measured with the real player capsule ----------------------------
// The brief: a clear path behind the counter, room to turn, room to OPERATE THE DRAWER,
// room to bag, no invisible collider blocking access, and clear sight of the customer,
// the goods, the screen and the terminal. These are the numbers that hold all of that
// open against whoever moves a fixture next.

const REG = REGISTER;
const PLAYER_R = PLAYER_DIAM / 2;
const topMinX = COUNTER.x - COUNTER.len / 2;
const topMaxX = COUNTER.x + COUNTER.len / 2;
const topMinZ = COUNTER.z - COUNTER.depth / 2;
const topMaxZ = COUNTER.z + COUNTER.depth / 2;
// the kit the PLAYER has to physically operate — these must fall inside their reach
const OPERATED = {
  monitor: REG.monitor, cardterm: REG.cardterm, scanner: REG.scanner,
  printer: REG.printer, bagstand: REG.bagstand,
};
// ...plus the passive dressing, which only has to be on the counter and out of the way
const KIT = { ...OPERATED, divider: REG.divider, impulse: REG.impulse };

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
  const p = REG.stand;
  assert.ok(p.z - PLAYER_R > counterBack, 'not standing inside the counter');
  assert.ok(p.z + PLAYER_R < backcounterFront, 'not standing inside the back counter');
  assert.deepEqual(p, COUNTER.staffStand, 'one working position, not two that drift apart');
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
    assert.ok(d <= REACH, `the ${name} is ${d.toFixed(2)} yd away — out of reach`);
  }
});

test('the CUSTOMER can reach the staging tray and the card terminal from the head of the queue', () => {
  const CUSTOMER_REACH = 1.6; // they lean over the counter to set things down
  const q = queueSlot(0);
  const nearest = (r) => Math.min(
    Math.hypot(r.minX - q.x, r.minZ - q.z),
    Math.hypot(r.maxX - q.x, r.minZ - q.z),
  );
  assert.ok(nearest(REG.staging) <= CUSTOMER_REACH, 'they can put their goods down');
  const term = Math.hypot(REG.cardterm.x - q.x, REG.cardterm.z - q.z);
  assert.ok(term <= CUSTOMER_REACH, `the card terminal is ${term.toFixed(2)} yd from the queue head`);
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

test('staging is on the CUSTOMER side and bagging is on the STAFF side, downstream', () => {
  assert.ok(REG.staging.maxZ < COUNTER.z, 'staging sits on the shopper half of the top');
  assert.ok(REG.bagging.minZ > COUNTER.z, 'bagging sits on the staff half');
  assert.ok(REG.staging.maxX < REG.bagging.minX, 'and the line runs west to east');
});

test('THE SCAN VOLUME IS IN THE WAY, ON PURPOSE', () => {
  const s = REG.scan;
  const mid = (r) => ({ x: (r.minX + r.maxX) / 2, z: (r.minZ + r.maxZ) / 2 });
  const inScan = (p) => p.x >= s.minX && p.x <= s.maxX && p.z >= s.minZ && p.z <= s.maxZ;

  assert.ok(s.minZ < COUNTER.z && s.maxZ > COUNTER.z, 'it straddles the middle of the counter');
  assert.ok(s.minY >= COUNTER_TOP, 'the volume starts at the counter top');
  assert.ok(s.maxY - s.minY > 0.15, 'and is tall enough to sweep a boxed dozen through');

  // Nothing auto-scans by being PUT DOWN. Both working surfaces sit clear of the
  // volume, so an item only ever registers by being carried through it.
  assert.ok(!inScan(mid(REG.staging)), 'an item resting in the staging tray is not in the scan volume');
  assert.ok(!inScan(mid(REG.bagging)), 'an item resting in the bag is not in the scan volume');

  // The claim the whole design rests on: the straight line from the middle of the
  // staging tray to the middle of the bag really does pass through the scanner. If
  // that ever stops being true, scanning stops being a natural motion and becomes a
  // chore, and the mechanic is dead.
  const a = mid(REG.staging);
  const b = mid(REG.bagging);
  let crossed = false;
  for (let t = 0; t <= 1; t += 0.002) {
    if (inScan({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t })) { crossed = true; break; }
  }
  assert.ok(crossed, 'dragging an item from the staging tray to the bag crosses the scanner');
});

test('the scanner glass sits inside its own scan volume', () => {
  const s = REG.scan;
  assert.ok(REG.scanner.x > s.minX && REG.scanner.x < s.maxX, 'the glass is under the volume');
  assert.ok(REG.scanner.z > s.minZ && REG.scanner.z < s.maxZ);
});

test('nothing else is standing in the scan volume to foul the sweep', () => {
  const s = REG.scan;
  for (const [name, p] of Object.entries(KIT)) {
    if (name === 'scanner') continue;
    const inside = p.x > s.minX && p.x < s.maxX && p.z > s.minZ && p.z < s.maxZ;
    assert.ok(!inside, `the ${name} is standing in the scan volume`);
  }
});

test('the kit does not squat on the surfaces it is meant to leave clear', () => {
  for (const [name, p] of Object.entries(KIT)) {
    assert.ok(!inRect(REG.staging, p.x, p.z), `the ${name} is sitting on the staging tray`);
    assert.ok(!inRect(REG.bagging, p.x, p.z), `the ${name} is sitting on the bagging mat`);
  }
});

test('the drawer is under the counter and opens toward the staff, not the customer', () => {
  const d = REG.drawer;
  assert.ok(d.y < COUNTER_TOP, 'it is under the top, not on it');
  assert.ok(d.x > topMinX && d.x < topMaxX, 'and within the carcass');
  assert.ok(d.travel > 0.25, 'it actually opens far enough to reach into');
  const openFace = counterBack + d.travel;
  assert.ok(openFace > counterBack, 'it slides out to the staff side');
  assert.ok(openFace < backcounterFront, 'and does not ram the back counter');
});
