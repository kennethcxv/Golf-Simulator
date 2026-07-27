import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ARCHITECTURE_COMPONENTS } from '../src/sim/clubhouseRestoration.js';
import {
  CAMPAIGN_REPAIR_JOBS,
  campaignRepairStatus,
  initCampaign,
  openingReadiness,
} from '../src/sim/campaign.js';
import { newStarterEmpire, activeState } from '../src/sim/empire.js';

// The House Flipper start: a NEW game inherits a structurally damaged
// clubhouse. Furnished workstations exist (the campaign arc needs them), but
// every architecture component begins broken, opening requires the repairs,
// and each repair stays gated behind cleaning its area. Existing furnished
// saves are governed by migrateFurnishedStart and must stay restored.

test('a fresh campaign starts with every structural component damaged', () => {
  const state = activeState(newStarterEmpire('relaxed', 31007));
  const components = state.shop.reno.architecture.components;
  for (const id of ARCHITECTURE_COMPONENTS) {
    assert.equal(components[id].restored, false, id);
    assert.equal(state.shop.reno.componentRepairProgress[id], 0, id);
  }
  assert.equal(state.shop.reno.entranceDoorRepaired, false);
  // The furnished workstations the arc depends on are still present.
  assert.equal(state.shop.reno.facilities.frontCounter, true);
  assert.equal(state.shop.reno.facilities.laptop, true);
});

test('opening the clubhouse requires all structural repairs', () => {
  const state = activeState(newStarterEmpire('relaxed', 31008));
  const requirement = openingReadiness(state).requirements
    .find((entry) => entry.id === 'repairs');
  assert.ok(requirement, 'opening readiness must include the repairs requirement');
  assert.equal(requirement.ok, false);
  assert.match(requirement.reason, /0\/8 complete/);
});

test('each repair is gated behind cleaning its area', () => {
  const state = activeState(newStarterEmpire('relaxed', 31009));
  const ceiling = campaignRepairStatus(state, 'ceiling');
  assert.equal(ceiling.ok, true);
  assert.equal(ceiling.complete, false);
  assert.equal(ceiling.prerequisiteMet, false);
  assert.match(ceiling.blockedReason, /Clean the office/);
  assert.equal(CAMPAIGN_REPAIR_JOBS.length, 8);
});

test('non-fresh campaign initialization keeps the furnished migration path', () => {
  const state = activeState(newStarterEmpire('relaxed', 31010));
  initCampaign(state, { fresh: false });
  const components = state.shop.reno.architecture.components;
  for (const id of ARCHITECTURE_COMPONENTS) {
    assert.equal(components[id].restored, true, `${id} must stay restored for migrated saves`);
  }
});
