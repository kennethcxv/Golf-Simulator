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

test('the ladder is deleted; the give-up fuse still reaches the owner', () => {
  // Block 4 (Overnight 2026-08-21): the recovery ladder — every rung that put
  // a body somewhere — is DELETED, replaced upstream by patience escalation in
  // the solver, hold-and-pass, depth-aware blocked arrival and validated
  // stops. Two things had to survive it, and this holds them: the owner's
  // bell ("never a customer silently stuck without knowing") now rides a
  // 30-second give-up fuse, and no rung machinery may quietly return.

  const src = fs.readFileSync(new URL('../src/render3d/clubhouse.js', import.meta.url), 'utf8')
    .replace(/\/\/.*$/gm, '');
  assert.match(src, /shop\.customerGaveUpStop/,
    'an unservable stop must still reach the player through the notification bell');
  assert.match(src, /NAV_GIVE_UP_SECONDS/,
    'the bell rides a named fuse, not a rung');
  // the diagnostics shape keeps a constant-zero stuckEscalation field for its
  // consumers; what must not return is anything ASSIGNING a rung
  assert.doesNotMatch(src, /c\.stuckEscalation = [^0]/,
    'rung escalation machinery must not return');
  assert.doesNotMatch(src, /stuckEscalation \+= /,
    'rung escalation machinery must not return (increment form)');
  assert.doesNotMatch(src, /nearestOpenWorld\(c\.mesh\.position\.x/,
    'the nudge rung (teleport to the nearest open cell) must not return');
});
