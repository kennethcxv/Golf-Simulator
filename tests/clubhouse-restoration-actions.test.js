import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CLUBHOUSE_CLEANUP_MILESTONE_IDS,
  CLUBHOUSE_CLEANUP_TARGET_IDS,
  CLUBHOUSE_LIGHT_TARGET_IDS,
  CLUBHOUSE_PANEL_IDS,
  CLUBHOUSE_PANEL_STATES,
  CLUBHOUSE_RESTOCK_GROUP_IDS,
  CLUBHOUSE_RESTORATION_ACTION_TYPES,
  CLUBHOUSE_RESTORATION_DEFAULTS,
  CLUBHOUSE_RESTORATION_TARGET_IDS,
  CLUBHOUSE_RESTORATION_VERSION,
  STARTER_RESTOCK_VERSION_PLACEHOLDER,
  defaultClubhouseRestorationState,
  ensureClubhouseRestoration,
  restorationAction,
  restorationSnapshot,
} from '../src/sim/clubhouseRestoration.js';

const minimalState = (propertyId = 'pine-hills-test') => ({
  seed: 4107,
  property: { id: propertyId },
  club: { reputation: 30 },
  shop: {
    reno: {
      grime: [0.8, 0.65],
      windows: [0.9],
      clutter: [{ cleared: false }],
      untouched: { keep: 42 },
    },
  },
});

const repId = (propertyId, targetId) => (
  `clubhouse-restoration:${propertyId}:${CLUBHOUSE_RESTORATION_VERSION}:${targetId}`
);

test('approved persisted IDs, states, and defaults are exact and immutable', () => {
  assert.deepEqual(CLUBHOUSE_CLEANUP_TARGET_IDS, [
    'entry:leaves-trash',
    'corner:cobweb-nw',
    'corner:cobweb-ne',
    'wall:scuff-west',
    'wall:scuff-east',
    'lounge:pizza-box',
    'lounge:empty-cups',
    'lounge:chair-crooked',
    'wall:fallen-frame',
    'desk:paper-stack',
    'desk:overflow-bin',
    'desk:sticky-notes',
  ]);
  assert.deepEqual(CLUBHOUSE_LIGHT_TARGET_IDS, ['ceiling:panel-02', 'ceiling:panel-07']);
  assert.deepEqual(
    CLUBHOUSE_RESTORATION_TARGET_IDS,
    [...CLUBHOUSE_CLEANUP_TARGET_IDS, ...CLUBHOUSE_LIGHT_TARGET_IDS],
  );
  assert.deepEqual(CLUBHOUSE_RESTOCK_GROUP_IDS, [
    'balls', 'accessories', 'headwear', 'apparel', 'cooler', 'snacks',
  ]);
  assert.deepEqual(CLUBHOUSE_CLEANUP_MILESTONE_IDS, ['floor', 'windows', 'generic-debris']);
  assert.deepEqual(CLUBHOUSE_PANEL_IDS, [
    'panel-01', 'panel-02', 'panel-03', 'panel-04',
    'panel-05', 'panel-06', 'panel-07', 'panel-08',
  ]);
  assert.deepEqual(CLUBHOUSE_PANEL_STATES, ['working', 'flicker', 'dead']);
  assert.deepEqual(CLUBHOUSE_RESTORATION_ACTION_TYPES, [
    'set-target-progress',
    'repair-light',
    'repair-component',
    'paint-component',
    'complete-restock-milestone',
    'complete-cleanup-milestone',
    'claim-full-cleanup',
  ]);
  assert.equal(CLUBHOUSE_RESTORATION_VERSION, 1);
  assert.equal(STARTER_RESTOCK_VERSION_PLACEHOLDER, 0);

  for (const value of [
    CLUBHOUSE_CLEANUP_TARGET_IDS,
    CLUBHOUSE_LIGHT_TARGET_IDS,
    CLUBHOUSE_RESTORATION_TARGET_IDS,
    CLUBHOUSE_RESTOCK_GROUP_IDS,
    CLUBHOUSE_CLEANUP_MILESTONE_IDS,
    CLUBHOUSE_PANEL_IDS,
    CLUBHOUSE_PANEL_STATES,
    CLUBHOUSE_RESTORATION_ACTION_TYPES,
    CLUBHOUSE_RESTORATION_DEFAULTS,
    CLUBHOUSE_RESTORATION_DEFAULTS.targetProgress,
    CLUBHOUSE_RESTORATION_DEFAULTS.lightPanels,
  ]) assert.ok(Object.isFrozen(value));

  assert.equal(CLUBHOUSE_RESTORATION_DEFAULTS.lightPanels['panel-02'], 'flicker');
  assert.equal(CLUBHOUSE_RESTORATION_DEFAULTS.lightPanels['panel-07'], 'dead');
  for (const panelId of CLUBHOUSE_PANEL_IDS.filter((id) => !['panel-02', 'panel-07'].includes(id))) {
    assert.equal(CLUBHOUSE_RESTORATION_DEFAULTS.lightPanels[panelId], 'working');
  }

  const a = defaultClubhouseRestorationState();
  const b = defaultClubhouseRestorationState();
  assert.deepEqual(a, CLUBHOUSE_RESTORATION_DEFAULTS);
  assert.notEqual(a.targetProgress, b.targetProgress);
  a.targetProgress['entry:leaves-trash'] = 0.5;
  assert.equal(b.targetProgress['entry:leaves-trash'], 0);
});

test('ensure adds aggregate fields directly to reno and preserves nested architecture and siblings', () => {
  const state = minimalState();
  const siblingBefore = JSON.stringify({
    grime: state.shop.reno.grime,
    windows: state.shop.reno.windows,
    clutter: state.shop.reno.clutter,
    untouched: state.shop.reno.untouched,
  });
  const reno = ensureClubhouseRestoration(state);

  assert.equal(reno, state.shop.reno);
  assert.equal(reno.restorationVersion, CLUBHOUSE_RESTORATION_VERSION);
  assert.deepEqual(reno.targetProgress, CLUBHOUSE_RESTORATION_DEFAULTS.targetProgress);
  assert.deepEqual(reno.lightPanels, CLUBHOUSE_RESTORATION_DEFAULTS.lightPanels);
  assert.deepEqual(reno.restockMilestones, CLUBHOUSE_RESTORATION_DEFAULTS.restockMilestones);
  assert.deepEqual(reno.cleanupMilestones, CLUBHOUSE_RESTORATION_DEFAULTS.cleanupMilestones);
  assert.equal(reno.starterRestockVersion, STARTER_RESTOCK_VERSION_PLACEHOLDER);
  assert.equal(reno.fullCleanupAwarded, false);
  assert.equal(reno.architecture.version, 1);
  assert.equal(ensureClubhouseRestoration(state), reno);
  assert.equal(JSON.stringify({
    grime: reno.grime,
    windows: reno.windows,
    clutter: reno.clutter,
    untouched: reno.untouched,
  }), siblingBefore);
});

test('ensure normalizes corrupt local fields without losing valid completed work', () => {
  const state = minimalState();
  Object.assign(state.shop.reno, {
    restorationVersion: 'old',
    targetProgress: {
      'entry:leaves-trash': true,
      'corner:cobweb-nw': 0.3754,
      'ceiling:panel-07': 4,
      junk: 1,
    },
    lightPanels: {
      'panel-02': 'working',
      'panel-03': 'dead',
      'panel-07': 'broken',
      junk: 'working',
    },
    restockMilestones: { balls: 'complete', apparel: false, junk: true },
    cleanupMilestones: { floor: 1, windows: false, junk: true },
    starterRestockVersion: -2,
    fullCleanupAwarded: false,
  });

  const reno = ensureClubhouseRestoration(state);
  assert.deepEqual(Object.keys(reno.targetProgress), CLUBHOUSE_RESTORATION_TARGET_IDS);
  assert.deepEqual(Object.keys(reno.lightPanels), CLUBHOUSE_PANEL_IDS);
  assert.deepEqual(Object.keys(reno.restockMilestones), CLUBHOUSE_RESTOCK_GROUP_IDS);
  assert.deepEqual(Object.keys(reno.cleanupMilestones), CLUBHOUSE_CLEANUP_MILESTONE_IDS);
  assert.equal(reno.targetProgress['entry:leaves-trash'], 1);
  assert.equal(reno.targetProgress['corner:cobweb-nw'], 0.375);
  assert.equal(reno.targetProgress['ceiling:panel-02'], 1, 'working faulty panel proves repair');
  assert.equal(reno.targetProgress['ceiling:panel-07'], 1, 'clamped completion proves repair');
  assert.equal(reno.lightPanels['panel-02'], 'working');
  assert.equal(reno.lightPanels['panel-03'], 'working',
    'only the two authored faulty panels may persist a non-working state');
  assert.equal(reno.lightPanels['panel-07'], 'working');
  assert.equal(reno.restockMilestones.balls, true);
  assert.equal(reno.cleanupMilestones.floor, true);
  assert.equal(reno.starterRestockVersion, STARTER_RESTOCK_VERSION_PLACEHOLDER);
  assert.equal(ensureClubhouseRestoration(state), reno);
});

test('actions reject malformed input before mutation and cleanup progress is monotonic and exact-once', () => {
  const state = minimalState('property-action');
  const before = JSON.stringify(state);
  for (const action of [
    null,
    {},
    { type: 'unknown' },
    { type: 'set-target-progress', targetId: 'floor:invented', progress: 1 },
    { type: 'set-target-progress', targetId: 'entry:leaves-trash', progress: NaN },
    { type: 'set-target-progress', targetId: 'entry:leaves-trash', progress: -0.1 },
    { type: 'repair-light', targetId: 'ceiling:panel-01' },
    { type: 'complete-restock-milestone', groupId: 'clubs' },
    { type: 'complete-cleanup-milestone', milestoneId: 'walls' },
  ]) {
    const result = restorationAction(state, action);
    assert.equal(result.ok, false);
    assert.equal(result.changed, false);
  }
  assert.equal(JSON.stringify(state), before, 'invalid actions do not even create the schema');

  let result = restorationAction(state, {
    type: 'set-target-progress', targetId: 'entry:leaves-trash', progress: 0.45,
  });
  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  assert.deepEqual(result.awards, []);
  assert.deepEqual(result.events, [{
    type: 'restoration-progress', targetId: 'entry:leaves-trash', progress: 0.45,
  }]);
  assert.equal(state.reputation, undefined);

  result = restorationAction(state, {
    type: 'set-target-progress', targetId: 'entry:leaves-trash', progress: 0.2,
  });
  assert.equal(result.changed, false);
  assert.equal(result.progress, 0.45);

  result = restorationAction(state, {
    type: 'set-target-progress', targetId: 'entry:leaves-trash', progress: 1,
  });
  assert.equal(result.changed, true);
  assert.equal(result.awards.length, 1);
  assert.equal(result.awards[0].duplicate, false);
  assert.equal(state.reputation.categories.cleanliness, 30.2);
  const id = repId('property-action', 'entry:leaves-trash');
  assert.equal(state.reputation.processedIds[id], true);
  assert.ok(result.events.some((event) => event.type === 'audio'));
  assert.ok(result.events.some((event) => event.type === 'toast' && event.delta === 0.2));

  const historyLength = state.reputation.history.length;
  result = restorationAction(state, {
    type: 'set-target-progress', targetId: 'entry:leaves-trash', progress: 1,
  });
  assert.equal(result.changed, false);
  assert.deepEqual(result.awards, []);
  assert.equal(state.reputation.history.length, historyLength);
});

test('light repairs and restock milestones use distinct exact-once reputation IDs and feedback', () => {
  const state = minimalState('property-repair');
  let result = restorationAction(state, {
    type: 'repair-light', targetId: 'ceiling:panel-02',
  });
  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  assert.equal(result.panelId, 'panel-02');
  assert.equal(result.panelState, 'working');
  assert.equal(result.awards.length, 2);
  assert.equal(state.shop.reno.targetProgress['ceiling:panel-02'], 1);
  assert.equal(state.shop.reno.lightPanels['panel-02'], 'working');
  assert.equal(state.reputation.categories.cleanliness, 30.2);
  assert.equal(state.reputation.categories.service, 30.5);
  assert.equal(
    state.reputation.processedIds[repId('property-repair', 'ceiling:panel-02:cleanliness')],
    true,
  );
  assert.equal(
    state.reputation.processedIds[repId('property-repair', 'ceiling:panel-02:service')],
    true,
  );
  assert.equal(result.events.filter((event) => event.type === 'toast').length, 2);

  let historyLength = state.reputation.history.length;
  result = restorationAction(state, {
    type: 'repair-light', targetId: 'ceiling:panel-02',
  });
  assert.equal(result.changed, false);
  assert.equal(state.reputation.history.length, historyLength);

  result = restorationAction(state, {
    type: 'complete-restock-milestone', groupId: 'cooler',
  });
  assert.equal(result.changed, true);
  assert.equal(result.awards.length, 1);
  assert.equal(state.shop.reno.restockMilestones.cooler, true);
  assert.equal(state.reputation.categories.retail, 30.3);
  assert.equal(state.reputation.processedIds[repId('property-repair', 'restock:cooler')], true);
  assert.ok(result.events.some((event) => event.cue === 'clubhouse-restock-complete'));

  historyLength = state.reputation.history.length;
  result = restorationAction(state, {
    type: 'complete-restock-milestone', groupId: 'cooler',
  });
  assert.equal(result.changed, false);
  assert.equal(state.reputation.history.length, historyLength);
});

test('generic-system milestones gate and award the full cleanup bonus exactly once', () => {
  const state = minimalState('property-full');
  for (const targetId of CLUBHOUSE_CLEANUP_TARGET_IDS) {
    assert.equal(restorationAction(state, {
      type: 'set-target-progress', targetId, progress: 1,
    }).ok, true);
  }
  for (const targetId of CLUBHOUSE_LIGHT_TARGET_IDS) {
    assert.equal(restorationAction(state, { type: 'repair-light', targetId }).ok, true);
  }
  for (const milestoneId of CLUBHOUSE_CLEANUP_MILESTONE_IDS.slice(0, -1)) {
    assert.equal(restorationAction(state, {
      type: 'complete-cleanup-milestone', milestoneId,
    }).ok, true);
  }

  let result = restorationAction(state, { type: 'claim-full-cleanup' });
  assert.equal(result.ok, false, 'the bonus cannot be claimed before every legacy-system edge');
  assert.equal(state.shop.reno.fullCleanupAwarded, false);

  result = restorationAction(state, {
    type: 'complete-cleanup-milestone', milestoneId: 'generic-debris',
  });
  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  assert.equal(result.awards.length, 2, 'final milestone and full-cleanup rewards are separate');
  assert.equal(state.shop.reno.fullCleanupAwarded, true);
  assert.equal(state.reputation.processedIds[repId('property-full', 'full-cleanup')], true);
  assert.equal(state.reputation.categories.cleanliness, 35);
  assert.equal(state.reputation.categories.service, 31);
  assert.ok(result.events.some((event) => event.cue === 'clubhouse-restoration-complete'));

  const historyLength = state.reputation.history.length;
  result = restorationAction(state, { type: 'claim-full-cleanup' });
  assert.equal(result.ok, true);
  assert.equal(result.changed, false);
  assert.equal(state.reputation.history.length, historyLength);
});

test('aggregate state, processed IDs, and detached snapshots survive a JSON save round-trip', () => {
  const state = minimalState('property-roundtrip');
  restorationAction(state, {
    type: 'set-target-progress', targetId: 'desk:paper-stack', progress: 0.625,
  });
  restorationAction(state, {
    type: 'set-target-progress', targetId: 'lounge:empty-cups', progress: 1,
  });
  restorationAction(state, { type: 'repair-light', targetId: 'ceiling:panel-07' });
  restorationAction(state, { type: 'complete-restock-milestone', groupId: 'balls' });
  restorationAction(state, { type: 'complete-cleanup-milestone', milestoneId: 'windows' });
  state.shop.reno.starterRestockVersion = 3;

  const before = restorationSnapshot(state);
  const historyLength = state.reputation.history.length;
  const loaded = JSON.parse(JSON.stringify(state));
  const loadedReno = ensureClubhouseRestoration(loaded);
  assert.equal(loadedReno, loaded.shop.reno);
  assert.deepEqual(restorationSnapshot(loaded), before);
  assert.equal(loadedReno.starterRestockVersion, 3);

  for (const action of [
    { type: 'set-target-progress', targetId: 'lounge:empty-cups', progress: 1 },
    { type: 'repair-light', targetId: 'ceiling:panel-07' },
    { type: 'complete-restock-milestone', groupId: 'balls' },
    { type: 'complete-cleanup-milestone', milestoneId: 'windows' },
  ]) {
    const result = restorationAction(loaded, action);
    assert.equal(result.ok, true);
    assert.equal(result.changed, false);
  }
  assert.equal(loaded.reputation.history.length, historyLength, 'save/reload cannot farm rewards');

  const snapshot = restorationSnapshot(loaded);
  snapshot.targetProgress['desk:paper-stack'] = 1;
  snapshot.lightPanels['panel-07'] = 'dead';
  snapshot.restockMilestones.balls = false;
  snapshot.cleanupMilestones.windows = false;
  snapshot.architecture.components.floor.restored = true;
  assert.equal(loadedReno.targetProgress['desk:paper-stack'], 0.625);
  assert.equal(loadedReno.lightPanels['panel-07'], 'working');
  assert.equal(loadedReno.restockMilestones.balls, true);
  assert.equal(loadedReno.cleanupMilestones.windows, true);
  assert.equal(loadedReno.architecture.components.floor.restored, false);
});
