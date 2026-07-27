import test from 'node:test';
import assert from 'node:assert/strict';

import { newGame, serialize, deserialize } from '../src/sim/state.js';
import {
  CAMPAIGN_DEBRIS_SPOTS,
  CAMPAIGN_FACILITIES,
  installCampaignFacility,
  laptopReadiness,
  workCampaignRepair,
} from '../src/sim/campaign.js';
import { CAMPAIGN_FACILITY_SITES } from '../src/render3d/clubhouse/campaignWorld.js';
import {
  COUNTER_TOP,
  DOOR_CLEARWAY,
  FRONT_DESK,
  FRONT_DESK_COLLIDERS,
  INTERIOR,
  PARTITIONS,
  PLAYER_DIAM,
  frontDeskLocalPoint,
} from '../src/data/shopLayout.js';

const EPS = 1e-9;
const GRID = 0.25;
const BODY_RADIUS = PLAYER_DIAM / 2;

function campaignState(seed = 8120) {
  return newGame('relaxed', seed, { campaign: true });
}

function close(actual, expected, label) {
  assert.ok(Math.abs(actual - expected) <= EPS, `${label}: ${actual} != ${expected}`);
}

function pointRectDistance(point, rect) {
  const dx = Math.max(rect.minX - point.x, 0, point.x - rect.maxX);
  const dz = Math.max(rect.minZ - point.z, 0, point.z - rect.maxZ);
  return Math.hypot(dx, dz);
}

function rectsOverlap(a, b) {
  return a.maxX > b.minX && a.minX < b.maxX
    && a.maxZ > b.minZ && a.minZ < b.maxZ;
}

function walkable(x, z) {
  if (Math.abs(x) > INTERIOR.w / 2 - BODY_RADIUS
    || Math.abs(z) > INTERIOR.d / 2 - BODY_RADIUS) return false;

  for (const partition of PARTITIONS) {
    if (partition.axis === 'x') {
      if (Math.abs(x - partition.at) >= BODY_RADIUS + 0.13
        || z < Math.min(partition.from, partition.to)
        || z > Math.max(partition.from, partition.to)) continue;
      if (!partition.opening
        || Math.abs(z - partition.opening.c) > partition.opening.w / 2 - BODY_RADIUS) return false;
    } else {
      if (Math.abs(z - partition.at) >= BODY_RADIUS + 0.13
        || x < Math.min(partition.from, partition.to)
        || x > Math.max(partition.from, partition.to)) continue;
      if (!partition.opening
        || Math.abs(x - partition.opening.c) > partition.opening.w / 2 - BODY_RADIUS) return false;
    }
  }

  const body = {
    minX: x - BODY_RADIUS,
    maxX: x + BODY_RADIUS,
    minZ: z - BODY_RADIUS,
    maxZ: z + BODY_RADIUS,
  };
  return !Object.values(FRONT_DESK_COLLIDERS).some((hull) => rectsOverlap(body, hull));
}

function reachableFloorCells() {
  const width = Math.ceil(INTERIOR.w / GRID);
  const height = Math.ceil(INTERIOR.d / GRID);
  const atX = (i) => -INTERIOR.w / 2 + i * GRID;
  const atZ = (j) => -INTERIOR.d / 2 + j * GRID;
  const toI = (x) => Math.round((x + INTERIOR.w / 2) / GRID);
  const toJ = (z) => Math.round((z + INTERIOR.d / 2) / GRID);
  const key = (i, j) => j * width + i;
  const seen = new Uint8Array(width * height);
  const start = {
    x: (DOOR_CLEARWAY.minX + DOOR_CLEARWAY.maxX) / 2,
    z: INTERIOR.d / 2 - 1,
  };
  const stack = [[toI(start.x), toJ(start.z)]];
  assert.equal(walkable(atX(stack[0][0]), atZ(stack[0][1])), true, 'entrance starts navigable');
  seen[key(stack[0][0], stack[0][1])] = 1;

  while (stack.length) {
    const [i, j] = stack.pop();
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = i + di;
      const nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= width || nj >= height || seen[key(ni, nj)]) continue;
      if (!walkable(atX(ni), atZ(nj))) continue;
      seen[key(ni, nj)] = 1;
      stack.push([ni, nj]);
    }
  }

  const cells = [];
  for (let j = 0; j < height; j += 1) {
    for (let i = 0; i < width; i += 1) {
      if (seen[key(i, j)]) cells.push({ x: atX(i), z: atZ(j) });
    }
  }
  return cells;
}

test('tee-sheet readiness uses the Pine Hills front desk and stable laptop facility key', () => {
  const state = campaignState();
  const facilities = state.shop.reno.facilities;
  facilities.officeDesk = false;
  facilities.officeChair = false;

  const ready = laptopReadiness(state);
  assert.equal(ready.ready, true, 'the separate office furniture is not a tee-sheet prerequisite');
  assert.deepEqual(
    ready.requirements.map((requirement) => requirement.id),
    ['front-counter', 'front-desk-tee-sheet'],
  );
  assert.doesNotMatch(
    ready.requirements.flatMap((requirement) => [requirement.label, requirement.reason]).join(' '),
    /office/i,
  );
  assert.equal(CAMPAIGN_FACILITIES.laptop.label, 'Pine Hills front-desk tee-sheet laptop');

  facilities.frontCounter = false;
  assert.equal(laptopReadiness(state).requirements.find((entry) => entry.id === 'front-counter').ok, false);
  facilities.frontCounter = true;
  facilities.laptop = false;
  assert.equal(laptopReadiness(state).requirements.find((entry) => entry.id === 'front-desk-tee-sheet').ok, false);

  const loaded = deserialize(serialize(state));
  assert.equal(Object.hasOwn(loaded.shop.reno.facilities, 'laptop'), true, 'save key remains laptop');
  assert.equal(loaded.shop.reno.facilities.laptop, false);
});

test('reinstalling the laptop requires the front counter, not office furniture', () => {
  const state = campaignState(8121);
  const facilities = state.shop.reno.facilities;
  // The dilapidated start leaves the ceiling broken and clubhouse power off;
  // facility installs correctly refuse until it is repaired. Restore power
  // through the real two-stage verb before exercising the counter chain.
  state.shop.reno.grime.fill(0);
  state.shop.inventory.repairkit1.back = (state.shop.inventory.repairkit1.back || 0) + 1;
  assert.equal(workCampaignRepair(state, 'ceiling').ok, true);
  assert.equal(workCampaignRepair(state, 'ceiling').ok, true);
  facilities.laptop = false;
  facilities.frontCounter = false;
  facilities.officeDesk = false;
  facilities.officeChair = false;
  state.shop.inventory.laptop1.back = 1;

  const blocked = installCampaignFacility(state, 'laptop');
  assert.equal(blocked.ok, false);
  assert.match(blocked.reason, /Pine Hills front desk/i);

  facilities.frontCounter = true;
  const installed = installCampaignFacility(state, 'laptop');
  assert.equal(installed.ok, true, installed.reason);
  assert.equal(facilities.laptop, true);
  assert.equal(facilities.officeDesk, false);
  assert.equal(facilities.officeChair, false);
});

test('the relocated reception chair follows front-desk prerequisites', () => {
  const state = campaignState(8123);
  const facilities = state.shop.reno.facilities;
  facilities.frontCounter = false;
  facilities.officeDesk = false;
  facilities.officeChair = false;
  state.shop.reno.grime.fill(0);
  state.shop.inventory.chair1.back = 1;

  const blocked = installCampaignFacility(state, 'officeChair');
  assert.equal(blocked.ok, false);
  assert.match(blocked.reason, /Pine Hills front desk/i);

  facilities.frontCounter = true;
  const installed = installCampaignFacility(state, 'officeChair');
  assert.equal(installed.ok, true, installed.reason);
  assert.equal(facilities.officeChair, true);
  assert.equal(facilities.officeDesk, false, 'the separate office desk remains unrelated');
});

test('campaign chair and laptop install markers share the canonical front-desk poses', () => {
  const sites = new Map(CAMPAIGN_FACILITY_SITES.map((site) => [site.id, site]));
  const chair = sites.get('officeChair');
  const laptop = sites.get('laptop');

  for (const [label, site, pose] of [
    ['chair', chair, FRONT_DESK.staffChair],
    ['laptop', laptop, FRONT_DESK.laptop],
  ]) {
    assert.ok(site, `${label} campaign site exists`);
    close(site.x, pose.x, `${label} x`);
    close(site.z, pose.z, `${label} z`);
    close(site.ry, pose.ry, `${label} rotation`);
  }
  close(laptop.y, COUNTER_TOP + 0.004, 'laptop marker rests on the worktop');
});

test('all 18 authored debris footprints stay outside the L-desk and on reachable floor', () => {
  const state = campaignState(8122);
  const debris = state.shop.reno.debris;
  assert.equal(CAMPAIGN_DEBRIS_SPOTS.length, 18);
  assert.equal(debris.length, 18);
  assert.deepEqual(debris.map((spot) => spot.a), CAMPAIGN_DEBRIS_SPOTS.map((spot) => spot.a),
    'relocation preserves target order and cleanup progress weights');
  close(debris.reduce((sum, spot) => sum + spot.a, 0), 3.93, 'total cleanup amount');

  const movedWest = frontDeskLocalPoint(debris[3].x, debris[3].z);
  const movedEast = frontDeskLocalPoint(debris[4].x, debris[4].z);
  close(movedWest.x, 0.4, 'debris 04 local x');
  close(movedWest.z, -1.05, 'debris 04 local z');
  close(movedEast.x, -2.1, 'debris 05 local x');
  close(movedEast.z, -1.05, 'debris 05 local z');

  const reachable = reachableFloorCells();
  for (const [index, spot] of debris.entries()) {
    // This is the larger of the two live debris presentations: a 0.16 x 0.10
    // wrapper scaled with the conserved cluster amount.
    const visualScale = Math.min(2.4, 0.55 + Math.sqrt(spot.a) * 1.5);
    const footprintRadius = Math.hypot(0.16 / 2, 0.10 / 2) * visualScale;
    for (const [hullId, hull] of Object.entries(FRONT_DESK_COLLIDERS)) {
      assert.ok(
        pointRectDistance(spot, hull) >= footprintRadius + 0.04,
        `debris ${index + 1} footprint clears ${hullId}`,
      );
    }
    const nearestReachable = reachable.reduce(
      (best, cell) => Math.min(best, Math.hypot(cell.x - spot.x, cell.z - spot.z)),
      Infinity,
    );
    assert.ok(nearestReachable <= GRID * 1.5,
      `debris ${index + 1} interaction center is ${nearestReachable.toFixed(3)} yd from reachable floor`);
  }
});
