import test from 'node:test';
import assert from 'node:assert/strict';

import { FLOOR_BOX_SURFACE_ID } from '../src/data/boxPlacementSurfaces.js';
import { FRONT_DESK, OFFICE } from '../src/data/shopLayout.js';
import {
  BOX_PLACEMENT_CODES,
  previewBoxPlacement,
} from '../src/sim/boxPlacement.js';
import {
  BOX_LIFECYCLE,
  BOX_SCHEMA_VERSION,
} from '../src/sim/deliveries.js';
import { validateObjectPlacement } from '../src/sim/layout.js';
import { newGame } from '../src/sim/state.js';

const officeDeskCandidate = () => ({
  x: OFFICE.desk.x,
  y: 0,
  z: OFFICE.desk.z,
  ry: 0,
  surface: 'floor',
  attachment: null,
  room: 'office',
});

const officeDeskFloorTarget = () => ({
  kind: 'surface',
  surfaceId: FLOOR_BOX_SURFACE_ID,
  x: OFFICE.desk.x,
  z: OFFICE.desk.z,
  ry: 0,
});

const frontDeskChairCandidate = () => ({
  x: FRONT_DESK.staffChair.x,
  y: 0,
  z: FRONT_DESK.staffChair.z,
  ry: 0,
  surface: 'floor',
  attachment: null,
  room: 'sales',
});

const carriedCarton = () => ({
  id: 1,
  orderId: 'campaign-facility-authority',
  skuId: 'tees1',
  box: 'carton',
  qty: 12,
  cap: 12,
  initialQty: 12,
  lb: 2.2,
  fragile: false,
  loc: 'carried',
  tape: 0,
  cutProgress: 0,
  tapeSegments: { centre: 0, left: 0, right: 0 },
  flaps: [0, 0],
  flapProgress: [0, 0, 0, 0],
  openingProgress: 0,
  flattenProgress: 0,
  flat: false,
  lifecycle: BOX_LIFECYCLE.SEALED,
  schemaVersion: BOX_SCHEMA_VERSION,
});

function campaignState(seed) {
  const state = newGame('relaxed', seed, { campaign: true });
  state.shop.reno.clutter.forEach((pile) => { pile.cleared = true; });
  state.shop.reno.decor = [];
  state.shop.reno.facilities.officeDesk = false;
  return state;
}

test('furnished layout keeps its authored office desk collision authoritative', () => {
  const state = campaignState(7711);
  const candidate = officeDeskCandidate();

  const staleMissingFlag = validateObjectPlacement(
    state,
    'asset-099',
    candidate,
    { grid: false, rotationSnap: false },
  );
  assert.equal(staleMissingFlag.ok, false);
  assert.match(staleMissingFlag.reasons.join(' '), /office desk/i);

  state.shop.reno.facilities.officeDesk = true;
  const afterInstall = validateObjectPlacement(
    state,
    'asset-099',
    candidate,
    { grid: false, rotationSnap: false },
  );
  assert.equal(afterInstall.ok, false);
  assert.ok(afterInstall.codes.includes('object-overlap'));
  assert.match(afterInstall.reasons.join(' '), /office desk/i);

  state.campaign.enabled = false;
  state.shop.reno.facilities.officeDesk = false;
  const sandbox = validateObjectPlacement(
    state,
    'asset-099',
    candidate,
    { grid: false, rotationSnap: false },
  );
  assert.equal(sandbox.ok, false, 'non-campaign saves keep the authored office desk');
  assert.match(sandbox.reasons.join(' '), /office desk/i);
});

test('floor carton blockers follow the furnished office fixture authority', () => {
  const state = campaignState(7712);
  const box = carriedCarton();
  const target = officeDeskFloorTarget();

  const staleMissingFlag = previewBoxPlacement(state, box, target);
  assert.equal(staleMissingFlag.code, BOX_PLACEMENT_CODES.FIXTURE_OVERLAP);
  assert.equal(staleMissingFlag.fixtureId, 'office_desk');

  state.shop.reno.facilities.officeDesk = true;
  const afterInstall = previewBoxPlacement(state, box, target);
  assert.equal(afterInstall.code, BOX_PLACEMENT_CODES.FIXTURE_OVERLAP);
  assert.equal(afterInstall.fixtureId, 'office_desk');

  state.campaign.enabled = false;
  state.shop.reno.facilities.officeDesk = false;
  const sandbox = previewBoxPlacement(state, box, target);
  assert.equal(sandbox.code, BOX_PLACEMENT_CODES.FIXTURE_OVERLAP);
  assert.equal(sandbox.fixtureId, 'office_desk');
});

test('front-desk chair collision appears only with its canonical campaign facility', () => {
  const state = campaignState(7713);
  const candidate = frontDeskChairCandidate();
  state.shop.reno.facilities.officeChair = false;

  const beforeInstall = validateObjectPlacement(
    state,
    'asset-099',
    candidate,
    { grid: false, rotationSnap: false },
  );
  assert.equal(beforeInstall.ok, true, beforeInstall.reasons.join(' '));

  state.shop.reno.facilities.officeChair = true;
  const afterInstall = validateObjectPlacement(
    state,
    'asset-099',
    candidate,
    { grid: false, rotationSnap: false },
  );
  assert.equal(afterInstall.ok, false);
  assert.match(afterInstall.reasons.join(' '), /front-desk reception chair/i);
});
