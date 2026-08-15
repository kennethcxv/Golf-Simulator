// SECTION X (Goal 21) — Verifier 3's worst finding: the warp trap.
//
// A stranger spent a third of a 25-minute session being teleported back into the
// front-door alcove. Eight times. Once from mid-lawn, during a sprint. They
// never got inside the shop, and this is most of the reason why.
//
// The mechanism, which is not a bug in any single line:
//   * breadcrumbs are only recorded while NOT overlapping
//   * so inside a persistent snag zone, no new crumbs are ever added
//   * so the newest surviving crumb is wherever the player last stood cleanly,
//     which can be minutes old and yards away
//   * and recall() cheerfully teleported them to it
//
// Being yanked backwards across the lawn is worse than being stuck, because the
// player cannot tell what happened or what they did wrong.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSafeTrail } from '../src/core/unstick.js';

const anywhereFree = () => true;

test('a recent, nearby crumb is still recalled', () => {
  const trail = createSafeTrail();
  trail.record(10, 10, 1000);
  trail.record(10.4, 10.2, 1200);
  const back = trail.recall(anywhereFree, { x: 10.5, z: 10.3, atMs: 1400 });
  assert.ok(back, 'a crumb from 200 ms ago and 0.2 yd away is exactly what this is for');
  assert.equal(back.x, 10.4);
});

test('a crumb across the lawn is NOT recalled', () => {
  // The mid-lawn sprint case, verbatim: the player is at (40, 40) and the only
  // clean ground the trail remembers is the door alcove they left long ago.
  const trail = createSafeTrail();
  trail.record(0, 0, 500); // the alcove
  const back = trail.recall(anywhereFree, { x: 40, z: 40, atMs: 900 });
  assert.equal(back, null, 'recovery must never warp the player across the map');
});

test('a stale crumb is NOT recalled even if it is close', () => {
  // Standing in a snag zone for a while records nothing new, so the newest
  // crumb keeps ageing. Past a point it stops meaning "where I last had room".
  const trail = createSafeTrail();
  trail.record(1, 1, 0);
  assert.ok(trail.recall(anywhereFree, { x: 1.2, z: 1.1, atMs: 5000 }),
    'five seconds is still recent enough to be useful');
  assert.equal(trail.recall(anywhereFree, { x: 1.2, z: 1.1, atMs: 60000 }), null,
    'a minute-old crumb is not where you last had room');
});

test('a nearer older crumb still wins over a far recent one', () => {
  // Distance is a filter, not an ordering: the search runs newest first and
  // skips the ones out of reach rather than giving up at the first far crumb.
  const trail = createSafeTrail();
  trail.record(2, 2, 1000); // near, older
  trail.record(30, 30, 1100); // far, newer
  const back = trail.recall(anywhereFree, { x: 2.3, z: 2.1, atMs: 1200 });
  assert.ok(back);
  assert.equal(back.x, 2, 'the far crumb is skipped, not treated as the end of the search');
});

test('an occupied crumb is still skipped, as it always was', () => {
  const trail = createSafeTrail();
  trail.record(3, 3, 100);
  trail.record(3.4, 3.4, 200);
  const blocked = (x) => x < 3.2; // the newest crumb is now inside something
  const back = trail.recall(blocked, { x: 3.5, z: 3.5, atMs: 300 });
  assert.ok(back);
  assert.equal(back.x, 3);
});

test('the unbounded search still exists for the manual button', () => {
  // The pause menu's Unstick is the player explicitly asking to be moved, and
  // there a longer reach is welcome. Only the AUTOMATIC escalation is local.
  const trail = createSafeTrail();
  trail.record(0, 0, 0);
  assert.ok(trail.recall(anywhereFree), 'no `from` means the old unbounded behaviour');
  assert.ok(trail.recall(anywhereFree, null));
});

test('nothing qualifying returns null so the caller can nudge locally instead', () => {
  // This is the important consequence: when no crumb is both near and recent,
  // recall must decline, and walkUnstick falls through to nearestFree — a local
  // step out of the geometry, which is what the player expects.
  const trail = createSafeTrail();
  trail.record(0, 0, 0);
  assert.equal(trail.recall(anywhereFree, { x: 25, z: 25, atMs: 30000 }), null);
});
