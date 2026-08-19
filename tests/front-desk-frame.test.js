import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HERO_COUNTER_DRAWN_HALF_LENGTH,
  COUNTER,
  DOOR_CLEARWAY,
  DOOR_MAIN,
  FRONT_DESK,
  FRONT_DESK_ASSETS,
  FRONT_DESK_BACKDROP,
  FRONT_DESK_COLLIDERS,
  FRONT_DESK_DOOR_SETBACK_METERS,
  FRONT_DESK_FRAME,
  INTERIOR,
  METERS_PER_YARD,
  REGISTER,
  frontDeskLocalPoint,
  frontDeskPoint,
  queueSlot,
} from '../src/data/shopLayout.js';

const close = (actual, expected, epsilon = 1e-9, message = '') => {
  assert.ok(Math.abs(actual - expected) <= epsilon,
    `${message || 'values differ'}: ${actual} versus ${expected}`);
};

const overlaps = (a, b) => a.minX < b.maxX && a.maxX > b.minX
  && a.minZ < b.maxZ && a.maxZ > b.minZ;

const pointRectDistance = (point, rect) => Math.hypot(
  Math.max(rect.minX - point.x, 0, point.x - rect.maxX),
  Math.max(rect.minZ - point.z, 0, point.z - rect.maxZ),
);

test('the Pine Hills reception run is centred on the entrance at the approved metric datum', () => {
  close(FRONT_DESK_FRAME.x, DOOR_MAIN.x, 1e-12, 'desk and door share an axis');
  close((INTERIOR.d / 2 - FRONT_DESK_FRAME.z) * METERS_PER_YARD,
    FRONT_DESK_DOOR_SETBACK_METERS, 1e-9, 'door setback');
  close(FRONT_DESK_FRAME.frontLength * METERS_PER_YARD, 4.2, 1e-9, 'frontage');
  close(FRONT_DESK_FRAME.frontDepth * METERS_PER_YARD, 0.75, 1e-9, 'depth');
  close(FRONT_DESK_FRAME.returnLength * METERS_PER_YARD, 2.1, 1e-9, 'return');
  close(COUNTER.x, FRONT_DESK_FRAME.x);
  close(COUNTER.z, FRONT_DESK_FRAME.z);
  close(COUNTER.ry, FRONT_DESK_FRAME.ry);
});

test('Asset 61 and the authored return module meet at one exact 4.20 m seam', () => {
  const base = frontDeskLocalPoint(FRONT_DESK_ASSETS.asset61.x, FRONT_DESK_ASSETS.asset61.z);
  const module = frontDeskLocalPoint(
    FRONT_DESK_ASSETS.returnModule.x,
    FRONT_DESK_ASSETS.returnModule.z,
  );
  const baseHalf = (2.93 / METERS_PER_YARD) / 2;
  const moduleHalf = (1.27 / METERS_PER_YARD) / 2;
  close(base.x - baseHalf, module.x + moduleHalf, 1e-9, 'front modules share a seam');
  close(module.x - moduleHalf, -FRONT_DESK_FRAME.frontLength / 2, 1e-9, 'extension reaches reception end');
  close(base.x + baseHalf, FRONT_DESK_FRAME.frontLength / 2, 1e-9, 'Asset 61 reaches checkout end');
  close(FRONT_DESK_ASSETS.asset61.ry, 0, 1e-12, 'Asset 61 faces the south entrance');
  close(FRONT_DESK_ASSETS.returnModule.ry, 0, 1e-12, 'return faces the south entrance');
});

test('desk transforms round-trip every operational point', () => {
  const points = {
    monitor: REGISTER.monitor,
    terminal: REGISTER.cardterm,
    scanner: REGISTER.scanner,
    printer: REGISTER.printer,
    bag: REGISTER.bag,
    staff: REGISTER.stand,
    customer: queueSlot(0),
    laptop: FRONT_DESK.laptop,
  };
  for (const [name, point] of Object.entries(points)) {
    const local = frontDeskLocalPoint(point.x, point.z);
    const world = frontDeskPoint(local.x, local.z);
    close(world.x, point.x, 1e-9, `${name} x`);
    close(world.z, point.z, 1e-9, `${name} z`);
  }
});

test('customer and staff choreography face the correct sides of the rotated desk', () => {
  const customer = frontDeskLocalPoint(queueSlot(0).x, queueSlot(0).z);
  const staff = frontDeskLocalPoint(REGISTER.stand.x, REGISTER.stand.z);
  const stagingCentre = frontDeskLocalPoint(
    (REGISTER.staging.minX + REGISTER.staging.maxX) / 2,
    (REGISTER.staging.minZ + REGISTER.staging.maxZ) / 2,
  );
  const bagCentre = frontDeskLocalPoint(
    (REGISTER.bagging.minX + REGISTER.bagging.maxX) / 2,
    (REGISTER.bagging.minZ + REGISTER.bagging.maxZ) / 2,
  );
  assert.ok(customer.z < -FRONT_DESK_FRAME.frontDepth / 2, 'customer stands on local -z');
  assert.ok(staff.z > FRONT_DESK_FRAME.frontDepth / 2, 'employee stands on local +z');
  assert.ok(stagingCentre.z < 0, 'goods begin on the customer half');
  assert.ok(bagCentre.z > 0, 'bagging finishes on the staff half');
  assert.ok(queueSlot(0).z > COUNTER.z, 'the public side faces the south entrance');
  assert.ok(REGISTER.stand.z < COUNTER.z, 'the working side faces north');
});

test('front and return collision footprints meet cleanly without entering the door clearway', () => {
  const front = FRONT_DESK_COLLIDERS.frontRun;
  const deskReturn = FRONT_DESK_COLLIDERS.returnRun;
  assert.ok(deskReturn.maxZ >= front.minZ && deskReturn.minZ <= front.maxZ,
    'the L return joins the front carcass');
  assert.equal(overlaps(front, DOOR_CLEARWAY), false, 'front run leaves the entrance egress clear');
  assert.equal(overlaps(deskReturn, DOOR_CLEARWAY), false, 'return leaves the entrance egress clear');
  const localReturn = {
    min: frontDeskLocalPoint(deskReturn.maxX, deskReturn.maxZ),
    max: frontDeskLocalPoint(deskReturn.minX, deskReturn.minZ),
  };
  assert.ok(Math.min(localReturn.min.x, localReturn.max.x) <= -2.256,
    'analytic hull encloses the authored outer COL_ReturnLegHull edge');
  assert.ok(Math.max(localReturn.min.x, localReturn.max.x) >= -1.424,
    'analytic hull encloses the authored inner COL_ReturnLegHull edge');
  assert.ok(Math.max(localReturn.min.z, localReturn.max.z) >= 1.761,
    'analytic hull encloses the authored staff-end COL_ReturnLegHull edge');
});

test('the queue turns out of the entrance corridor with readable spacing', () => {
  const customerRadius = 0.32;
  for (let index = 0; index < 6; index += 1) {
    const point = queueSlot(index);
    const insideDoor = point.x > DOOR_CLEARWAY.minX && point.x < DOOR_CLEARWAY.maxX
      && point.z > DOOR_CLEARWAY.minZ && point.z < DOOR_CLEARWAY.maxZ;
    assert.equal(insideDoor, false, `queue slot ${index} clears the protected egress`);
    assert.ok(pointRectDistance(point, DOOR_CLEARWAY) >= customerRadius,
      `queue slot ${index}'s full customer body clears the protected egress`);
    if (index > 0) {
      const prior = queueSlot(index - 1);
      assert.ok(Math.hypot(point.x - prior.x, point.z - prior.z) >= 1.15,
        `queue slot ${index} retains shoulder separation`);
    }
  }
});

// 2026-08-19: THIS TEST PINNED THE BUG.
//
// It asserted `laptop.x > 1.2` -- the counter's east end -- and passed for
// sixteen days while the laptop hung in mid air. It could not have failed,
// because every coordinate in it is a LAYOUT coordinate and the layout's desk
// is the greybox slab (FRONT_DESK_FRAME.frontLength, 4.2 m). The DRAWN desk is
// `hero_counter`, instantiated raw at 2.388 m, and a prop at local x 1.75 sits
// 0.56 m past its end. A check that reads a different object than the shipped
// code reads can never fail on the thing it is watching.
//
// So the assertions are now made against the object that is actually drawn.
// tools/qa/laptop-seating.js is the in-game half of this: it drops a vertical
// line through the laptop and asserts the gap to the surface beneath is under
// 1 mm, with a 40 mm lift as its control.
test('the tee-sheet laptop stands on the desk that is actually drawn', () => {
  const laptop = frontDeskLocalPoint(FRONT_DESK.laptop.x, FRONT_DESK.laptop.z);
  // Half the laptop's own deck, so the ASSERTION is about the object and not
  // about its centre point: an origin inside the desk with the body hanging
  // over the edge is still a floating laptop.
  const halfDeck = 0.390 / 2;
  assert.ok(Math.abs(laptop.x) + halfDeck <= HERO_COUNTER_DRAWN_HALF_LENGTH,
    `the laptop's full body is inside the drawn counter: |${laptop.x.toFixed(2)}| + ${halfDeck} `
    + `must be <= ${HERO_COUNTER_DRAWN_HALF_LENGTH}`);
  assert.ok(Math.abs(laptop.z) < FRONT_DESK_FRAME.frontDepth / 2, 'laptop sits on the front worktop');
  // Still clear of the receipt printer, which is the neighbour the original
  // proposal measured -- that requirement did not stop being true.
  const printer = frontDeskLocalPoint(REGISTER.printer.x, REGISTER.printer.z);
  assert.ok(Math.abs(laptop.x - printer.x) >= 0.6,
    `the laptop clears the receipt printer by ${Math.abs(laptop.x - printer.x).toFixed(2)} yd`);
  // The chair is NOT the laptop's seat -- that coupling was removed by B-stand
  // and must not quietly come back because the laptop moved back across the desk.
  const chair = frontDeskLocalPoint(FRONT_DESK.staffChair.x, FRONT_DESK.staffChair.z);
  assert.ok(chair.x < 0, 'the staff chair stays at the reception end as the desk\'s own seat');
});

test('backdrop signs and key rack occupy separate readable bays on one wall plane', () => {
  const localInterval = (pose) => {
    const local = frontDeskLocalPoint(pose.x, pose.z);
    return { min: local.x - pose.w / 2, max: local.x + pose.w / 2 };
  };
  const elements = [
    ['key rack', FRONT_DESK.keyRack],
    ['tee-time board', FRONT_DESK.teeTimeBoard],
    ['logo board', FRONT_DESK.logoBackdrop],
  ].map(([name, pose]) => ({ name, pose, ...localInterval(pose) }));
  const halfWidth = FRONT_DESK_BACKDROP.width / 2;

  for (const element of elements) {
    assert.ok(element.min >= -halfWidth + FRONT_DESK_BACKDROP.edgeInset,
      `${element.name} clears the left backdrop frame`);
    assert.ok(element.max <= halfWidth - FRONT_DESK_BACKDROP.edgeInset,
      `${element.name} clears the right backdrop frame`);
  }
  for (let index = 1; index < elements.length; index += 1) {
    const gap = elements[index].min - elements[index - 1].max;
    assert.ok(gap >= FRONT_DESK_BACKDROP.minimumElementGap,
      `${elements[index - 1].name} and ${elements[index].name} retain a visible gap`);
  }
  assert.ok(elements[1].max < 0, 'tee board stays clear of the backdrop centre trim');
  assert.ok(elements[2].min > 0, 'logo board stays clear of the backdrop centre trim');

  for (const pose of [FRONT_DESK.teeTimeBoard, FRONT_DESK.logoBackdrop]) {
    const rendered = frontDeskLocalPoint(
      pose.x,
      pose.z + FRONT_DESK_BACKDROP.boardWorldZOffset,
    );
    close(rendered.z, FRONT_DESK_BACKDROP.surfaceLocalZ, 1e-9,
      'renderer-offset board face aligns with the backdrop');
  }
  const teeInteraction = {
    x: FRONT_DESK.teeTimeBoard.x,
    z: FRONT_DESK.teeTimeBoard.z + FRONT_DESK_BACKDROP.boardWorldZOffset,
  };
  assert.ok(Math.hypot(
    teeInteraction.x - FRONT_DESK.staffChair.x,
    teeInteraction.z - FRONT_DESK.staffChair.z,
  ) < 1.1, 'tee board remains reachable from the reception work position');
});

test('cash drawer travel remains a magnitude plus a frame-derived staff vector', () => {
  close(Math.hypot(REGISTER.drawer.travelX, REGISTER.drawer.travelZ), REGISTER.drawer.travel);
  const closed = frontDeskLocalPoint(REGISTER.drawer.x, REGISTER.drawer.z);
  const open = frontDeskLocalPoint(
    REGISTER.drawer.x + REGISTER.drawer.travelX,
    REGISTER.drawer.z + REGISTER.drawer.travelZ,
  );
  assert.ok(open.z > closed.z, 'drawer opens toward local staff +z');
});
