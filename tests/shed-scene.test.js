// SHED SCENE — the recipe that turns a fresh starter empire into the dirty
// maintenance-shed test scene: presentation variant, campaign hidden/closed,
// repairs+architecture pre-restored, zero fixtures, a masked grime mask, a
// seeded debris/window state, and charged cleaning tools. THREE-free.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildShedEmpire, applyShedRecipe, ensureShedScene } from '../src/sim/shedScene.js';
import {
  SHED_SHELL, SHED_ROOM, insideShedRoom, DOOR, WINDOWS, FURNITURE, STATIONS,
  TARGET_POSES, SHED_DEBRIS_SEED, SHED_PROP_PLACEMENTS,
} from '../src/data/shedLayout.js';
import { SHED_TARGET_IDS } from '../src/sim/shedCleaning.js';
import { activeState } from '../src/sim/empire.js';
import { RENO } from '../src/sim/shop.js';
import { ARCHITECTURE_COMPONENTS } from '../src/sim/clubhouseRestoration.js';
import { campaignAllowsBusiness, repairComplete, CAMPAIGN_REPAIR_JOBS } from '../src/sim/campaign.js';
import { placedFixtures } from '../src/sim/layout.js';
import { cleaningStatus, CLEANING_CAPACITY } from '../src/sim/cleaningToolState.js';
import { DAY_START_MIN } from '../src/sim/constants.js';

const clone = (value) => JSON.parse(JSON.stringify(value));

// --- shedLayout.js data sanity ---------------------------------------------------

test('shed shell/room dimensions match the authored plan', () => {
  assert.deepEqual(SHED_SHELL, { w: 8.5, d: 6.5, h: 2.9, wallT: 0.22 });
  assert.deepEqual(SHED_ROOM, { w: 8.06, d: 6.06 });
});

test('insideShedRoom accepts the interior and its wall boundary, rejects beyond it', () => {
  assert.ok(insideShedRoom(0, 0));
  assert.ok(insideShedRoom(SHED_ROOM.w / 2, 0), 'east wall boundary is inside');
  assert.ok(insideShedRoom(0, SHED_ROOM.d / 2), 'south wall boundary is inside');
  assert.ok(!insideShedRoom(SHED_ROOM.w / 2 + 0.2, 0));
  assert.ok(!insideShedRoom(0, SHED_ROOM.d / 2 + 0.2));
});

test('the door is a clear south-wall gap with no leaf', () => {
  assert.equal(DOOR.wall, 'S');
  assert.equal(DOOR.x, 1.2);
  assert.equal(DOOR.z, SHED_ROOM.d / 2);
  assert.equal(DOOR.w, 1.35);
});

test('exactly two windows, south then east, sharing the authored dims', () => {
  assert.equal(WINDOWS.length, 2);
  assert.equal(WINDOWS[0].id, 'south');
  assert.equal(WINDOWS[1].id, 'east');
  for (const win of WINDOWS) {
    assert.equal(win.w, 1.6);
    assert.equal(win.h, 1.2);
    assert.equal(win.sill, 1.0);
  }
  assert.equal(WINDOWS[0].x, -2.0);
  assert.equal(WINDOWS[1].z, -0.5);
});

test('furniture poses sit inside the room; sawhorse carries no collider', () => {
  assert.ok(insideShedRoom(FURNITURE.workbench.x, FURNITURE.workbench.z));
  assert.ok(insideShedRoom(FURNITURE.shelving.x, FURNITURE.shelving.z));
  assert.ok(insideShedRoom(FURNITURE.crateStack.x, FURNITURE.crateStack.z));
  assert.ok(insideShedRoom(FURNITURE.sawhorse.x, FURNITURE.sawhorse.z));
  assert.equal(FURNITURE.sawhorse.hw, undefined);
  assert.equal(FURNITURE.sawhorse.hd, undefined);
  assert.equal(FURNITURE.workbench.hw, FURNITURE.workbench.w / 2);
  assert.equal(FURNITURE.workbench.hd, FURNITURE.workbench.d / 2);
});

test('the two cleaning stations sit inside the room', () => {
  assert.ok(insideShedRoom(STATIONS.mopBucket.x, STATIONS.mopBucket.z));
  assert.ok(insideShedRoom(STATIONS.disposalBin.x, STATIONS.disposalBin.z));
  assert.ok(STATIONS.mopBucket.radius > 0);
  assert.ok(STATIONS.disposalBin.radius > 0);
});

test('TARGET_POSES has exactly the 11 shed cleaning targets, each inside the room', () => {
  const keys = Object.keys(TARGET_POSES).sort();
  assert.deepEqual(keys, [...SHED_TARGET_IDS].sort(), 'shedLayout targets match shedCleaning target ids');
  for (const [id, pose] of Object.entries(TARGET_POSES)) {
    assert.ok(insideShedRoom(pose.x, pose.z), `${id} pose sits inside the shed room`);
    assert.ok(Number.isFinite(pose.radius) && pose.radius > 0, `${id} has a positive contact radius`);
  }
});

test('SHED_DEBRIS_SEED is exactly 14 deterministic clusters, bounded, kind-tagged', () => {
  assert.equal(SHED_DEBRIS_SEED.length, 14);
  let grit = 0;
  let litter = 0;
  for (const cluster of SHED_DEBRIS_SEED) {
    assert.ok(Math.abs(cluster.x) <= 3.4, `x ${cluster.x} within |x|<=3.4`);
    assert.ok(Math.abs(cluster.z) <= 2.5, `z ${cluster.z} within |z|<=2.5`);
    assert.ok(cluster.a >= 0.5 && cluster.a <= 1.0, `a ${cluster.a} within [0.5,1.0]`);
    assert.ok(cluster.kind === 'grit' || cluster.kind === 'litter');
    if (cluster.kind === 'grit') grit++; else litter++;
    // keep clear of both station circles
    const dMop = Math.hypot(cluster.x - STATIONS.mopBucket.x, cluster.z - STATIONS.mopBucket.z);
    const dBin = Math.hypot(cluster.x - STATIONS.disposalBin.x, cluster.z - STATIONS.disposalBin.z);
    assert.ok(dMop > STATIONS.mopBucket.radius, `cluster clear of the mop-bucket circle (d=${dMop.toFixed(2)})`);
    assert.ok(dBin > STATIONS.disposalBin.radius, `cluster clear of the disposal-bin circle (d=${dBin.toFixed(2)})`);
  }
  assert.equal(grit, 9);
  assert.equal(litter, 5);
  // deterministic: importing twice yields the identical array (module singleton, static data)
  assert.deepEqual(clone(SHED_DEBRIS_SEED), SHED_DEBRIS_SEED);
});

test('SHED_PROP_PLACEMENTS names the exact nine mount points, all inside the room', () => {
  const expected = [
    'SHED_Workbench', 'SHED_Shelving', 'SHED_CrateStack', 'SHED_Sawhorse',
    'SHED_Bucket', 'SHED_DisposalBin', 'SHED_ToolRack', 'SHED_WindowSouth', 'SHED_WindowEast',
  ];
  assert.deepEqual(Object.keys(SHED_PROP_PLACEMENTS).sort(), [...expected].sort());
  for (const [name, pose] of Object.entries(SHED_PROP_PLACEMENTS)) {
    assert.ok(insideShedRoom(pose.x, pose.z), `${name} sits inside (or flush on) the shed room`);
  }
  assert.equal(SHED_PROP_PLACEMENTS.SHED_ToolRack.x, -3.9);
  assert.equal(SHED_PROP_PLACEMENTS.SHED_ToolRack.z, -1.6);
  assert.equal(SHED_PROP_PLACEMENTS.SHED_ToolRack.ry, Math.PI / 2, 'tool rack faces east');
});

// --- shedScene.js recipe -----------------------------------------------------------

test('buildShedEmpire boots the shed presentation variant', () => {
  const empire = buildShedEmpire(1);
  const state = activeState(empire);
  assert.ok(state, 'an active club state exists');
  assert.equal(state.property.clubhouseVariant, 'shed');
});

test('the recipe hides the campaign guide and keeps business closed', () => {
  const state = activeState(buildShedEmpire(2));
  assert.equal(state.campaign.hidden, true);
  assert.equal(campaignAllowsBusiness(state), false, 'business stays closed in the shed scene');
});

test('the recipe forces business closed even if it was already open beforehand', () => {
  const state = activeState(buildShedEmpire(17));
  state.campaign.businessOpen = true;
  applyShedRecipe(state);
  assert.equal(state.campaign.businessOpen, false, 'businessOpen is forced back to false, not left at true');
  assert.equal(campaignAllowsBusiness(state), false, 'business reads closed again after re-applying the recipe');
});

test('the recipe restores every campaign repair job, including the ceiling power gate', () => {
  const state = activeState(buildShedEmpire(3));
  for (const job of CAMPAIGN_REPAIR_JOBS) {
    assert.equal(repairComplete(state, job.id), true, `${job.id} reads restored`);
  }
});

test('the recipe restores every architecture component with progress at 1', () => {
  const state = activeState(buildShedEmpire(4));
  const architecture = state.shop.reno.architecture;
  for (const id of ARCHITECTURE_COMPONENTS) {
    assert.equal(architecture.components[id].restored, true, `${id}.restored`);
    assert.equal(state.shop.reno.componentRepairProgress[id], 1, `${id} repair progress is 1`);
  }
});

test('the recipe hides the tutorial panel', () => {
  const state = activeState(buildShedEmpire(5));
  assert.equal(state.tutorial.complete, true);
  assert.equal(state.tutorial.hidden, true);
});

test('the recipe stores every fixture so the interior builds zero of them', () => {
  const state = activeState(buildShedEmpire(6));
  assert.deepEqual(placedFixtures(state), []);
});

test('the recipe masks grime outside the shed footprint and keeps it dirty inside', () => {
  const state = activeState(buildShedEmpire(7));
  const grime = state.shop.reno.grime;
  assert.equal(grime.length, RENO.grid.w * RENO.grid.h);
  const cellW = RENO.room.w / RENO.grid.w;
  const cellD = RENO.room.d / RENO.grid.h;
  let insideCount = 0;
  for (let cy = 0; cy < RENO.grid.h; cy++) {
    for (let cx = 0; cx < RENO.grid.w; cx++) {
      const x = -RENO.room.w / 2 + (cx + 0.5) * cellW;
      const z = -RENO.room.d / 2 + (cy + 0.5) * cellD;
      const idx = cy * RENO.grid.w + cx;
      if (insideShedRoom(x, z)) {
        insideCount++;
        assert.ok(grime[idx] >= 0.58 && grime[idx] <= 0.95, `inside cell ${idx} reads convincingly dirty (${grime[idx]})`);
      } else {
        assert.equal(grime[idx], 0, `outside cell ${idx} is masked to 0`);
      }
    }
  }
  assert.ok(insideCount >= 1, 'at least one grime cell falls inside the shed footprint');
});

test('the recipe clears every clutter pile', () => {
  const state = activeState(buildShedEmpire(8));
  assert.ok(state.shop.reno.clutter.length > 0);
  assert.ok(state.shop.reno.clutter.every((pile) => pile.cleared === true));
});

test('the recipe seeds the shed debris list from SHED_DEBRIS_SEED', () => {
  const state = activeState(buildShedEmpire(9));
  assert.deepEqual(state.shop.reno.debris, SHED_DEBRIS_SEED);
  assert.notEqual(state.shop.reno.debris, SHED_DEBRIS_SEED, 'debris is a deep copy, not the same array');
  assert.equal(state.shop.reno.debrisSeeded, true);
});

test('the recipe sets exactly the shed window array (length 4 for ensureShopReno)', () => {
  const state = activeState(buildShedEmpire(10));
  assert.deepEqual(state.shop.reno.windows, [0.85, 0.78, 0, 0]);
});

test('the recipe zeroes wash grime everywhere but keeps the surface structure', () => {
  const state = activeState(buildShedEmpire(11));
  const wash = state.shop.reno.wash;
  const keys = Object.keys(wash);
  assert.ok(keys.length > 0, 'wash keeps its surfaces');
  for (const key of keys) {
    assert.ok(Array.isArray(wash[key].grime));
    assert.ok(Array.isArray(wash[key].soap), 'soap array structure stays intact');
    assert.ok(wash[key].grime.every((v) => v === 0), `${key} grime fully washed`);
  }
});

test('the recipe seeds a fully-charged, empty cleaning-tool loadout (mop-charge/bucket gap)', () => {
  const state = activeState(buildShedEmpire(12));
  const status = cleaningStatus(state);
  assert.equal(status.mop.charge, CLEANING_CAPACITY.mopCharge, 'mop spawns fully charged, not dry');
  assert.equal(status.mop.wet, true);
  assert.equal(status.bucket.level, CLEANING_CAPACITY.bucketLevel);
  assert.equal(status.bucket.water, 'clean');
  assert.equal(status.pan.load, 0);
  assert.equal(status.bag.load, 0);
  assert.equal(status.bag.tied, false);
  assert.equal(status.bag.disposed, 0);
});

test('ensureShedScene seeds every shed target at 0, unstarted and uncompleted', () => {
  const state = activeState(buildShedEmpire(13));
  const shed = state.shop.reno.shed;
  assert.equal(shed.version, 1);
  assert.equal(shed.seeded, true);
  assert.equal(shed.completedAt, null);
  assert.deepEqual(Object.keys(shed.targets).sort(), [...SHED_TARGET_IDS].sort());
  for (const id of SHED_TARGET_IDS) assert.equal(shed.targets[id], 0, `${id} starts at 0`);
});

test('ensureShedScene is idempotent on an already-canonical slice', () => {
  const state = activeState(buildShedEmpire(14));
  const before = clone(state.shop.reno.shed);
  ensureShedScene(state);
  assert.deepEqual(state.shop.reno.shed, before);
});

test('the recipe sets the clock to a daylight hour', () => {
  const state = activeState(buildShedEmpire(15));
  assert.equal(state.clock.minutes, DAY_START_MIN + 9 * 60);
});

test('applying the recipe twice is idempotent across every mutated slice', () => {
  const state = activeState(buildShedEmpire(16));
  const before = {
    property: clone(state.property),
    campaign: clone(state.campaign),
    tutorial: clone(state.tutorial),
    reno: clone(state.shop.reno),
    layout: clone(state.shop.layout),
    clock: clone(state.clock),
  };
  applyShedRecipe(state);
  assert.deepEqual(clone(state.property), before.property, 'property slice unchanged');
  assert.deepEqual(clone(state.campaign), before.campaign, 'campaign slice unchanged');
  assert.deepEqual(clone(state.tutorial), before.tutorial, 'tutorial slice unchanged');
  assert.deepEqual(clone(state.shop.reno), before.reno, 'reno slice unchanged');
  assert.deepEqual(clone(state.shop.layout), before.layout, 'layout slice unchanged');
  assert.deepEqual(clone(state.clock), before.clock, 'clock slice unchanged');
});
