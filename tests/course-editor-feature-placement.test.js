import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ZONE } from '../src/sim/constants.js';
import { newGame } from '../src/sim/state.js';
import {
  featurePlacementOk,
  makeEditSession,
  stampBunker,
  stampGreen,
  stampTee,
  stampWater,
} from '../src/sim/courseEditor.js';

function flatCourse({ vector = false, w = 24, h = 18 } = {}) {
  return {
    w,
    h,
    zones: new Uint8Array(w * h).fill(ZONE.ROUGH),
    holes: [{ id: 7 }],
    vec: vector ? { nextId: 19 } : null,
  };
}

const VALID_CASES = [
  ['green', { r: 2, elong: 1.35, angle: 0.4, kidney: true }],
  ['bunker', { r: 1.7, lobes: 3, stretch: 1.12, angle: 0.7 }],
  ['pond', { r: 2.2, elong: 1.15, angle: 0.3 }],
  ['lake', { r: 3.2, elong: 1.4, angle: 1.1 }],
  ['tee', { holeId: 7, aimX: 18, aimY: 9, w: 1.2, len: 1.8 }],
];

test('featurePlacementOk accepts stamp-native geometry for vector and legacy courses without mutation', () => {
  for (const vector of [false, true]) {
    const course = flatCourse({ vector });
    const nextId = course.vec?.nextId;
    for (const [feature, options] of VALID_CASES) {
      assert.deepEqual(
        featurePlacementOk(course, feature, 12, 9, options),
        { ok: true, reason: null },
        `${feature} is legal on open ${vector ? 'vector' : 'legacy'} ground`,
      );
    }
    assert.equal(course.vec?.nextId, nextId, 'a preview query never consumes a vector id');
    assert.ok(course.zones.every((zone) => zone === ZONE.ROUGH), 'a preview query never paints cells');
  }
});

test('featurePlacementOk rejects a center-in-bounds placement when any complete footprint crosses the property edge', () => {
  for (const vector of [false, true]) {
    const course = flatCourse({ vector });
    const cases = [
      ['green', { r: 2, elong: 1.35, angle: 0, kidney: false }, 'Greens must fit inside the course.'],
      ['bunker', { r: 2, lobes: 3, stretch: 1.45, angle: 0 }, 'Bunkers must fit inside the course.'],
      ['water', { r: 2.4, elong: 1.4, angle: 0 }, 'Water must fit inside the course.'],
      ['tee', { holeId: 7, aimX: 10, aimY: 0.25, w: 1.2, len: 1.8 }, 'Tee boxes must fit inside the course.'],
    ];
    for (const [feature, options, reason] of cases) {
      assert.deepEqual(featurePlacementOk(course, feature, 0.25, 0.25, options), { ok: false, reason });
    }
  }
});

test('featurePlacementOk rejects water, paths, and incompatible built surfaces with stable reasons', () => {
  const cases = [
    ['green', {}, 'Greens require open ground.', ZONE.TEE],
    ['bunker', {}, 'Bunkers require open turf.', ZONE.GREEN],
    ['water', {}, 'Water requires open ground.', ZONE.TEE],
    ['tee', { holeId: 7, aimX: 18, aimY: 9 }, 'Tee boxes require open ground.', ZONE.BUNKER],
  ];
  for (const vector of [false, true]) {
    for (const [feature, options, reason, incompatibleZone] of cases) {
      for (const blockedZone of [ZONE.WATER, ZONE.PATH, incompatibleZone]) {
        const course = flatCourse({ vector });
        course.zones[9 * course.w + 12] = blockedZone;
        assert.deepEqual(featurePlacementOk(course, feature, 12, 9, options), { ok: false, reason });
      }
    }
  }

  const course = flatCourse();
  assert.deepEqual(
    featurePlacementOk(course, 'tee', 12, 9, { holeId: 999, aimX: 18, aimY: 9 }),
    { ok: false, reason: 'No such hole.' },
  );
});

test('surface validation covers the full footprint rather than only its center', () => {
  const course = flatCourse();
  const options = { r: 2.4, elong: 1.2, angle: 0 };
  course.zones[9 * course.w + 14] = ZONE.PATH;
  assert.deepEqual(
    featurePlacementOk(course, 'water', 12, 9, options),
    { ok: false, reason: 'Water requires open ground.' },
    'a path beneath the shoreline rejects the whole placement',
  );

  course.zones[9 * course.w + 14] = ZONE.ROUGH;
  course.zones[9 * course.w + 15] = ZONE.PATH;
  assert.deepEqual(
    featurePlacementOk(course, 'water', 12, 9, options),
    { ok: true, reason: null },
    'a path outside the water footprint does not block it',
  );
});

test('every vector stamp refuses an illegal footprint before mutating vectors, holes, or history', () => {
  const state = newGame('relaxed', 4242);
  const session = makeEditSession(state);
  const course = state.course;
  const hole = course.holes[0];
  const cx = 35;
  const cy = 22;
  course.zones[cy * course.w + cx] = ZONE.PATH;
  const commits = [
    () => stampGreen(state, session, cx, cy, { r: 2, elong: 1.35, angle: 0.4 }),
    () => stampBunker(state, session, cx, cy, { r: 1.7, lobes: 3, stretch: 1.12, angle: 0.7 }),
    () => stampWater(state, session, cx, cy, { r: 2.2, elong: 1.15, angle: 0.3 }),
    () => stampTee(state, session, hole.id, 'forward', cx, cy, cx + 8, cy, { w: 1.2, len: 1.8 }),
  ];

  for (const commit of commits) {
    const vecBefore = JSON.stringify(course.vec);
    const holesBefore = JSON.stringify(course.holes);
    const result = commit();
    assert.equal(result.ok, false);
    assert.equal(JSON.stringify(course.vec), vecBefore);
    assert.equal(JSON.stringify(course.holes), holesBefore);
    assert.equal(session.undo.length, 0);
    assert.equal(session.bill, 0);
  }
});

test('legacy stamps retain valid open-ground behavior and reject clipped commits', () => {
  const state = newGame('relaxed', 4242);
  state.course.vec = null;
  state.course.paint = null;
  state.course.zones.fill(ZONE.ROUGH);
  const session = makeEditSession(state);
  const hole = state.course.holes[0];

  assert.equal(stampGreen(state, session, 20, 12, { r: 2, elong: 1.25, angle: 0.2 }).ok, true);
  assert.equal(stampBunker(state, session, 30, 12, { r: 1.5, lobes: 2, angle: 0.4 }).ok, true);
  assert.equal(stampWater(state, session, 40, 12, { r: 2, elong: 1.2, angle: 0.6 }).ok, true);
  assert.equal(stampTee(state, session, hole.id, 'forward', 50, 12, 58, 12).ok, true);

  const undoBefore = session.undo.length;
  assert.deepEqual(
    stampWater(state, session, 0.25, 0.25, { r: 2.4, elong: 1.2, angle: 0 }),
    { ok: false, reason: 'Water must fit inside the course.' },
  );
  assert.equal(session.undo.length, undoBefore, 'a clipped legacy stamp creates no partial edit');
});

test('vector water commit applies the supplied angle to the same footprint the predicate validates', () => {
  const makeAtAngle = (angle) => {
    const state = newGame('relaxed', 4242);
    const session = makeEditSession(state);
    const cx = 35;
    const cy = 22;
    const before = new Set(state.course.vec.waters.map((water) => water.id));
    const result = stampWater(state, session, cx, cy, { r: 2.2, elong: 1.4, angle });
    assert.equal(result.ok, true);
    return state.course.vec.waters.find((water) => !before.has(water.id)).pts;
  };
  const unrotated = makeAtAngle(0);
  const quarterTurn = makeAtAngle(Math.PI / 2);
  assert.equal(unrotated.length, quarterTurn.length);
  for (let i = 0; i < unrotated.length; i++) {
    assert.ok(Math.abs((quarterTurn[i].x - 35) + (unrotated[i].y - 22)) < 1e-9);
    assert.ok(Math.abs((quarterTurn[i].y - 22) - (unrotated[i].x - 35)) < 1e-9);
  }
});
