// F2 (Goal 18) — the stuck rule fires at ONE second of no progress, and the
// verdict is testable as the pure function the live ladder consumes.
//
// Watched fail 2026-08-10: with NAV_NO_PROGRESS_SECONDS at the old 3, the
// 1.05 s case below returns { stuck: false } and this test fails — which is
// exactly the six-silent-seconds arithmetic the playtest reported (3 s of
// verdict + 3 s of ladder gate before anything happened).
import { test } from 'node:test';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { navStuckVerdict, NAV_NO_PROGRESS_SECONDS } from '../src/render3d/clubhouse.js';

test('one second of no progress IS stuck, whatever displacement thinks', () => {
  assert.equal(NAV_NO_PROGRESS_SECONDS, 1, 'the threshold is one second');
  // gliding along a box face: moving almost the full step, getting nowhere
  const gliding = navStuckVerdict({ moved: 0.09, step: 0.1, noProgressT: 1.05 });
  assert.equal(gliding.stuck, true, 'a customer grinding along a face for over a second is stuck');
  assert.equal(gliding.reason, 'no-progress');
});

test('under a second of no progress is not yet stuck when still moving', () => {
  const walking = navStuckVerdict({ moved: 0.09, step: 0.1, noProgressT: 0.6 });
  assert.equal(walking.stuck, false, 'a fresh detour must not trip the rule');
});

test('the live ladder acts promptly on a wrong route and can notify on abandonment', () => {
  // Source contracts on the two F2 behaviours the pure verdict cannot carry:
  // the prompt gate for no-progress stalls, and the give-up notification.

  const src = fs.readFileSync(new URL('../src/render3d/clubhouse.js', import.meta.url), 'utf8')
    .replace(/\/\/.*$/gm, '');
  assert.match(src, /reason === 'no-progress' \? 0\.35 : 3\.0/,
    'a no-progress stall must enter the ladder within a beat, not after another 3 s');
  assert.match(src, /shop\.customerGaveUpStop/,
    'an abandoned stop must reach the player through the notification bell');
  assert.match(src, /bannedWp/,
    'the re-route must be guaranteed different (banned-waypoint escalation)');
});
