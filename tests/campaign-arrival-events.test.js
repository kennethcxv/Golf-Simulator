import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  campaignView,
  initCampaign,
  recordCampaignEvent,
} from '../src/sim/campaign.js';
import { newStarterEmpire, activeState } from '../src/sim/empire.js';
import { tutorialFlag } from '../src/sim/tutorial.js';

// The fresh-start campaign's first two objectives (survey, enter) complete
// through campaign.events. Nothing but recordCampaignEvent may write those,
// and the phase gate at campaignPhase() holds the whole arc at 'arrival'
// until enteredClubhouse records — so a lost emitter bricks a new game.

const freshCampaignState = () => {
  const empire = newStarterEmpire('relaxed', 777);
  const state = activeState(empire);
  if (!state.campaign) initCampaign(state, { fresh: true });
  assert.equal(state.campaign.enabled, true, 'fixture expects an active campaign');
  return state;
};

test('a fresh campaign starts with no arrival events and an incomplete survey', () => {
  const state = freshCampaignState();
  const view = campaignView(state);
  const survey = view.tasks.find((task) => task.id === 'survey');
  const enter = view.tasks.find((task) => task.id === 'enter');
  assert.ok(survey && enter, 'survey and enter objectives must exist');
  assert.equal(survey.complete, false);
  assert.equal(enter.complete, false);
});

test('tutorialFlag forwards the look-around behavior to the campaign survey', () => {
  const state = freshCampaignState();
  tutorialFlag(state, 'lookedAround');
  assert.equal(state.campaign.events.lookedAround, true,
    'the tutorial look detection must also record the campaign arrival event');
});

test('recorded arrival events complete survey and enter and advance the phase', () => {
  const state = freshCampaignState();
  recordCampaignEvent(state, 'lookedAround');
  recordCampaignEvent(state, 'walkedToClubhouse');
  recordCampaignEvent(state, 'enteredClubhouse');
  const view = campaignView(state);
  assert.equal(view.tasks.find((task) => task.id === 'survey').complete, true);
  assert.equal(view.tasks.find((task) => task.id === 'enter').complete, true);
  assert.notEqual(view.phase, 'arrival', 'entering the clubhouse must end the arrival phase');
});

test('recordCampaignEvent refuses to write outside an active campaign', () => {
  const state = freshCampaignState();
  state.campaign.enabled = false;
  assert.equal(recordCampaignEvent(state, 'enteredClubhouse'), false);
  assert.notEqual(state.campaign.events.enteredClubhouse, true);
});

test('the renderer arrival tracker contract exists in clubhouse update', async () => {
  // The porch/threshold proximity half of the fix lives in the renderer,
  // which these Node tests cannot boot. Pin the source contract instead so
  // the emitter cannot silently vanish again the way the original wiring did.
  const { readFileSync } = await import('node:fs');
  const source = readFileSync('src/render3d/clubhouse.js', 'utf8');
  assert.match(source, /recordCampaignEvent\(state, 'walkedToClubhouse'\)/);
  assert.match(source, /recordCampaignEvent\(state, 'enteredClubhouse'\)/);
});
