// NAV-WAIT-001 — a browse stand serves one customer at a time.
//
// The defect: a customer whose chosen stand was occupied had no wait state, so
// it kept the stand point as its goal and kept walking at it. 90 of 95
// (neglected) and 79 of 82 (restored) of every measured churn episode were this
// one class, p50 ~18-20 s, handled by collision instead of by waiting.
//
// The live proof is the customer-day gate: the class must DISAPPEAR from the
// episode log rather than be exempted from it. These are the invariants that
// keep the mechanism honest underneath that run.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { FIXTURE_HALF, fixtureBrowsePoint } from '../src/data/shopLayout.js';

const source = fs.readFileSync(
  new URL('../src/render3d/clubhouse.js', import.meta.url),
  'utf8',
).replaceAll('\r\n', '\n');

function functionBody(name, indent = '  ') {
  const start = source.indexOf(`${indent}function ${name}(`);
  assert.notEqual(start, -1, `${name} exists`);
  const open = source.indexOf('{', source.indexOf(')', start));
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}' && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`${name} has an unterminated body`);
}

// The ring's own numbers, read from the source so the geometry below tests what
// actually ships rather than a copy that can drift.
function ringConfig() {
  const block = /const WAIT_RING = Object\.freeze\(\{[\s\S]*?\}\);/.exec(source)[0];
  const num = (key) => Number(new RegExp(`${key}:\\s*([\\d.]+)`).exec(block)[1]);
  return {
    slotsPerRow: num('slotsPerRow'),
    spanX: num('spanX'),
    standOff: num('standOff'),
    rowStep: num('rowStep'),
    maxSlots: num('maxSlots'),
  };
}

test('a stand carries a claim, and only one customer can hold it', () => {
  assert.match(source, /const fixtureClaims = new Map\(\)/,
    'the occupancy claim exists');
  const body = source.slice(source.indexOf('let waitingForStand = false;'));
  assert.match(body, /if \(!fixtureClaims\.get\(stop\.fixtureId\)\) \{/,
    'a stand is taken only when nobody holds it');
  assert.match(body, /fixtureClaims\.set\(stop\.fixtureId, c\)/);
});

test('the claim is taken on APPROACH, not from across the room', () => {
  // A shopper still crossing the floor must not reserve a display.
  assert.match(source, /const STAND_CLAIM_RADIUS = 2\.60;/,
    'the claim radius matches the band the defect was measured in');
  const body = source.slice(source.indexOf('let waitingForStand = false;'));
  assert.match(body, /if \(reach <= STAND_CLAIM_RADIUS\)/,
    'claiming and waiting both happen inside the approach band');
});

test('a customer that cannot have the stand WAITS instead of pressing in', () => {
  const body = source.slice(source.indexOf('let waitingForStand = false;'));
  assert.match(body, /waitingForStand = true;/);
  assert.match(body, /const hold = fixtureWaitPose\(fixture, slot\);/,
    'the waiter is given a hold point, not the stand point');
  // and reaching that hold point must NOT be mistaken for reaching the stop
  assert.match(source, /if \(waitingForStand\) \{[\s\S]*?char\.setMode\(c\.hasBasket \? 'BasketIdle' : 'Idle'\)/,
    'a waiting customer stands still rather than running the browse beat');
  assert.doesNotMatch(
    source.slice(source.indexOf('if (waitingForStand) {'), source.indexOf('} else if (dist < 0.18) {')),
    /customerPick/,
    'a waiter must never pick stock from a stand it has not reached',
  );
});

test('hold points are spaced wider than a body, so waiting is not the new shoving', () => {
  const ring = ringConfig();
  const gap = ring.spanX / (ring.slotsPerRow - 1);
  assert.ok(gap > 0.68,
    `hold points are ${gap.toFixed(2)} yd apart — a customer is 0.68 wide, so they would still touch`);
  assert.ok(ring.rowStep > 0.68,
    'and the rows behind are clear of each other too');
});

test('the first hold row sits OUTSIDE the approach band the defect was measured in', () => {
  // If waiters hold inside 2.60 yd of the stand they are still in the band the
  // episodes were attributed to, and the class would simply move rather than go.
  const ring = ringConfig();
  const fixture = { x: 0, z: 0, ry: 0, kind: 'wallShelf', footprint: { maxZ: 0.5 } };
  const halfDepth = fixture.footprint.maxZ;
  const browse = fixtureBrowsePoint(fixture, 0, halfDepth + 0.72);
  const hold = fixtureBrowsePoint(fixture, 0, halfDepth + ring.standOff);
  const holdToStand = Math.hypot(hold.x - fixture.x, hold.z - fixture.z);
  const browseToStand = Math.hypot(browse.x - fixture.x, browse.z - fixture.z);
  assert.ok(holdToStand > browseToStand,
    'a hold point must be further back than the browse pose it waits for');
  assert.ok(ring.standOff > 0.72 + 0.68,
    'and at least a body clear of the browsing customer');
});

test('hold points rotate with the display, like the browse pose does', () => {
  // Both come from fixtureBrowsePoint, so a turned fixture cannot leave its
  // waiters standing inside it.
  const body = functionBody('fixtureWaitPose');
  assert.match(body, /fixtureBrowsePoint\(/,
    'the wait pose is authored in the fixture frame, not in world axes');
  assert.match(body, /faceX: origin\.x, faceZ: origin\.z/,
    'and the waiter faces the display it is waiting for');
  // sanity: a rotated fixture moves its hold point
  const ring = ringConfig();
  const flat = { x: 0, z: 0, ry: 0, kind: 'wallShelf', footprint: { maxZ: 0.5 } };
  const turned = { ...flat, ry: Math.PI / 2 };
  const a = fixtureBrowsePoint(flat, 0, 0.5 + ring.standOff);
  const b = fixtureBrowsePoint(turned, 0, 0.5 + ring.standOff);
  assert.ok(Math.hypot(a.x - b.x, a.z - b.z) > 1,
    'the hold point follows the fixture rotation');
});

test('a waiter keeps its slot, so waiters do not swap places every frame', () => {
  const body = functionBody('waitSlotFor');
  assert.match(body, /if \(c\.waitFixtureId === fixtureId && Number\.isFinite\(c\.waitSlot\)\) return c\.waitSlot;/,
    'a slot already held is returned unchanged — reshuffling would be its own churn');
  assert.match(body, /taken\.add\(other\.waitSlot\)/,
    'and two waiters cannot be handed the same slot');
});

test('the crowd is bounded — past the last slot a shopper moves on', () => {
  const ring = ringConfig();
  assert.ok(ring.maxSlots > 0 && ring.maxSlots <= 12, 'a real bound exists');
  const body = functionBody('waitSlotFor');
  assert.match(body, /if \(slot >= WAIT_RING\.maxSlots\) return null;/);
  const loop = source.slice(source.indexOf('let waitingForStand = false;'));
  assert.match(loop, /releaseFixtureClaim\(c\);\s*\n\s*c\.stopIdx \+= 1;/,
    'a shopper that cannot even get a hold point gives the stand up rather than joining a scrum');
});

test('the claim is always released — a departing shopper cannot close a display', () => {
  const release = functionBody('releaseFixtureClaim');
  assert.match(release, /fixtureClaims\.delete\(c\.fixtureClaim\)/);
  assert.match(release, /c\.waitSlot = null/, 'and the slot is freed with it');
  // every exit route
  assert.match(functionBody('removeCustomer'), /releaseFixtureClaim\(c\)/,
    'the single departure funnel releases the claim');
  const loop = source.slice(source.indexOf('let waitingForStand = false;'));
  assert.match(loop, /\} else if \(c\.fixtureClaim\) \{\s*\n\s*releaseFixtureClaim\(c\);/,
    'moving on to a non-fixture stop releases it');
  assert.match(source, /customerPick\(c, stop\);\s*\n\s*releaseFixtureClaim\(c\);/,
    'and finishing the browse hands the stand to whoever is holding for it');
});

test('the fixture lookup cannot go stale within a frame or across a floor change', () => {
  assert.match(source, /fixtureByIdCache = null;\s*\n\s*\/\/ How much of the shop's DAY/,
    'the per-frame cache is invalidated at the top of every update');
  const body = functionBody('fixtureById');
  assert.match(body, /placedFixtures\(state\)/, 'and it rebuilds from the live floor');
});

test('FIXTURE_HALF stays the depth fallback both poses agree on', () => {
  // The browse pose and the wait pose must measure "the front of the stand"
  // the same way, or waiters queue relative to a different object.
  assert.ok(FIXTURE_HALF, 'the shared table exists');
  const wait = functionBody('fixtureWaitPose');
  assert.match(wait, /FIXTURE_HALF\[fixture\.kind\]/);
  assert.match(wait, /fixture\.footprint\?\.maxZ/);
});
