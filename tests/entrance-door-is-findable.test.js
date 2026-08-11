import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCampaignWorld } from '../src/render3d/clubhouse/campaignWorld.js';
import { initCampaign, recordCampaignEvent } from '../src/sim/campaign.js';
import { newStarterEmpire, activeState } from '../src/sim/empire.js';
import { DOOR_MAIN } from '../src/data/shopLayout.js';

// SECTION 1 (Goal 22) — THE FRONT DOOR.
//
// Two strangers played a combined 45 minutes and neither ever got inside the
// pro shop. The reason was not the door, the collision or the lock. It was
// this: the `entranceDoor` REPAIR marker sits at x = -0.8, which is DOOR_MAIN.x
// exactly, and carried no focus bias. A player walking up to a door ends up
// standing on it, prop focus is distance-led, and so the marker won the
// crosshair from every straight-on approach. What the player read at the front
// door of a brand-new game was:
//
//   "Entrance doors and hardware - blocked: Clear the entrance and wash the
//    porch before repairing the doors."
//
// The entrance it names is the clutter INSIDE the lobby and the broom that
// clears it is on the INDOOR belt — the outdoor belt carries washer, hose,
// divot kit and rake and nothing that can move debris. So the game, at a shut
// door, instructed the player to go and do the one thing that is only possible
// on the far side of that door. "Shop doors - [E] open both" was never shown.
//
// Two rules, and both are about what a player can FIND rather than what exists.

function harness(state) {
  const props = [];
  const interior = { add() {}, position: { x: 0, y: 0, z: 0 } };
  buildCampaignWorld({
    state,
    interior,
    addProp: (p) => { props.push(p); return p; },
    L2W: (x, z) => ({ x, z }),
    hooks: {},
  });
  return props;
}

const freshState = () => {
  const state = activeState(newStarterEmpire('relaxed', 4242));
  if (!state.campaign) initCampaign(state, { fresh: true });
  assert.equal(state.campaign.enabled, true, 'fixture expects an active campaign');
  return state;
};

const entranceRepairProp = (props) => props.find((p) => {
  // the repair markers are the props sitting on the campaign repair sites; the
  // entrance one is the single prop at DOOR_MAIN.x on the porch side
  const label = typeof p.label === 'function' ? p.label() : p.label;
  return p.x === DOOR_MAIN.x && p.z > 5 && (label === null || /Entrance doors/.test(label || ''));
});

test('the entrance repair marker sits exactly on the door, which is why bias is required', () => {
  // If this ever stops being true the fix below is solving a problem that has
  // moved, and the test should be revisited rather than deleted.
  const state = freshState();
  const props = harness(state);
  const marker = entranceRepairProp(props);
  assert.ok(marker, 'the entrance repair marker must exist');
  assert.equal(marker.x, DOOR_MAIN.x, 'the marker shares the door centreline');
});

test('a player who has never been inside is offered no repair at the front door', () => {
  const state = freshState();
  assert.ok(!state.campaign.events?.enteredClubhouse, 'fixture starts outside');
  const props = harness(state);
  const marker = entranceRepairProp(props);
  const label = typeof marker.label === 'function' ? marker.label() : marker.label;
  // A falsy label is how walkFindFocus is told a prop is dormant, so the door
  // beside it wins the crosshair outright.
  assert.ok(!label, `the marker must be dormant before entry, got: ${label}`);
});

test('the marker loses the crosshair to the door even standing right on it', () => {
  // focusBias enters prop scoring as `dist - focusBias`, so a NEGATIVE bias
  // pushes a prop back. The CLOSED sign three feet away already carries -0.65
  // with a comment saying the door must win; this marker needed the same and
  // never had it. Standing at the door the marker's distance is ~0, so without
  // a bias no positive door distance can beat it.
  const state = freshState();
  const props = harness(state);
  const marker = entranceRepairProp(props);
  const bias = Number(typeof marker.focusBias === 'function' ? marker.focusBias() : marker.focusBias) || 0;
  assert.ok(bias < 0, `the marker must be pushed behind the door, got focusBias ${bias}`);
  // the door prop's own reach is 2.1; the marker must lose across that band
  const doorReach = 2.1;
  assert.ok(
    -bias >= doorReach * 0.4,
    `bias ${bias} is too small to lose the door across its ${doorReach} reach`,
  );
});

test('once the player has been inside, the repair becomes offerable again', () => {
  // The gate is "not yet", not "never" — hiding the job forever would trade one
  // dead end for another, and the entrance repair is a real late job.
  const state = freshState();
  recordCampaignEvent(state, 'enteredClubhouse');
  const props = harness(state);
  const marker = entranceRepairProp(props);
  const label = typeof marker.label === 'function' ? marker.label() : marker.label;
  assert.ok(label, 'after entering, the marker must speak again');
  assert.match(String(label), /Entrance doors/);
});
