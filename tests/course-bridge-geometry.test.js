import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCourseBridgeGeometry,
  COURSE_BRIDGE_DEFAULTS,
} from '../src/render3d/courseBridgeGeometry.js';

const approx = (actual, expected, epsilon = 1e-5) => {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} ~= ${expected}`);
};

const waterBowl = (x, z) => {
  const bankDistance = Math.min(Math.abs(x), Math.abs(48 - x));
  return bankDistance < 6 ? 0 : -2.8 - Math.cos(z * 0.2) * 0.08;
};

test('bridge geometry is deterministic, typed, and does not mutate its path', () => {
  const path = {
    id: 7,
    bridge: true,
    width: 3.2,
    pts: [{ x: 0, y: 0 }, { x: 22, y: 3 }, { x: 48, y: 0 }],
  };
  const before = structuredClone(path);
  const options = { heightAt: waterBowl, sampleSpacingYd: 1.5 };
  const first = buildCourseBridgeGeometry(path, options);
  const second = buildCourseBridgeGeometry(path, options);

  assert.deepEqual(path, before);
  assert.deepEqual(first, second);
  assert.ok(first.deck.positions instanceof Float32Array);
  assert.ok(first.deck.uvs instanceof Float32Array);
  assert.ok(first.deck.indices instanceof Uint32Array);
  assert.ok(first.deck.leftEdge instanceof Float32Array);
  assert.ok(first.centerline instanceof Float32Array);
  assert.equal(first.deck.positions.length, first.deck.stationCount * 12);
  assert.equal(first.deck.indices.length, (first.deck.stationCount - 1) * 24 + 12);
});

test('bank-anchored deck is continuous and spans a water bowl without sagging', () => {
  const bridge = buildCourseBridgeGeometry({
    width: 3,
    pts: [{ x: 0, y: 0 }, { x: 24, y: 0 }, { x: 48, y: 0 }],
  }, {
    heightAt: waterBowl,
    sampleSpacingYd: 1.6,
  });

  assert.ok(bridge.deck.stationCount >= 30);
  approx(bridge.deck.elevations[0], COURSE_BRIDGE_DEFAULTS.deckClearanceYd);
  approx(bridge.deck.elevations.at(-1), COURSE_BRIDGE_DEFAULTS.deckClearanceYd);
  const middle = Math.floor(bridge.deck.stationCount / 2);
  assert.ok(
    bridge.deck.elevations[middle] - bridge.deck.terrainElevations[middle] > 2.8,
    'the deck remains bank-height above the carved water floor',
  );
  assert.ok(bridge.camberYd > 0 && bridge.camberYd <= COURSE_BRIDGE_DEFAULTS.maxCamberYd);

  for (let index = 0; index < bridge.deck.stationCount; index += 1) {
    const left = index * 3;
    const right = index * 3;
    const width = Math.hypot(
      bridge.deck.leftEdge[left] - bridge.deck.rightEdge[right],
      bridge.deck.leftEdge[left + 2] - bridge.deck.rightEdge[right + 2],
    );
    approx(width, 3);
    approx(bridge.deck.leftEdge[left + 1], bridge.deck.elevations[index]);
    approx(bridge.deck.rightEdge[right + 1], bridge.deck.elevations[index]);
  }

  // Every adjacent station has top-face triangles, so there can be no gap in
  // the deck even where the centerline bends.
  for (let index = 0; index < bridge.deck.stationCount - 1; index += 1) {
    const at = index * 24;
    assert.deepEqual(
      Array.from(bridge.deck.indices.slice(at, at + 6)),
      [index * 4, (index + 1) * 4, index * 4 + 1,
        index * 4 + 1, (index + 1) * 4, (index + 1) * 4 + 1],
    );
  }
});

test('supports are sparse terrain-reaching pairs and rails form continuous sides', () => {
  const bridge = buildCourseBridgeGeometry({
    width: 3.4,
    pts: [{ x: 0, y: 0 }, { x: 30, y: 4 }, { x: 60, y: 0 }],
  }, {
    heightAt: (x) => (x > 5 && x < 55 ? -4 : 0),
    supportSpacingYd: 12,
    railSpanYd: 5,
  });

  assert.ok(bridge.supports.length >= 3);
  assert.ok(bridge.supports.length <= Math.floor(bridge.lengthYd / 12));
  for (const support of bridge.supports) {
    assert.equal(support.piers.length, 2);
    assert.deepEqual(support.piers.map((pier) => pier.side), ['left', 'right']);
    for (const pier of support.piers) {
      assert.ok(pier.heightYd >= COURSE_BRIDGE_DEFAULTS.minSupportHeightYd);
      approx(pier.top.y - pier.bottom.y, pier.heightYd);
      assert.ok(pier.bottom.y < pier.top.y);
    }
    approx(support.beam.from.y, support.beam.to.y);
  }

  const left = bridge.railSegments.filter((segment) => segment.side === 'left');
  const right = bridge.railSegments.filter((segment) => segment.side === 'right');
  assert.equal(left.length, right.length);
  assert.ok(left.length >= Math.ceil(bridge.lengthYd / 5));
  for (const side of [left, right]) {
    for (let index = 1; index < side.length; index += 1) {
      assert.deepEqual(side[index - 1].to, side[index].from, 'rail spans share exact endpoints');
    }
  }
  assert.equal(bridge.railPosts.length, (left.length + 1) * 2);
});

test('bridge metadata trims by arclength and controls clearance, supports, and rails', () => {
  const full = buildCourseBridgeGeometry({
    width: 3,
    bridge: true,
    pts: [{ x: 0, y: 0 }, { x: 20, y: 8 }, { x: 50, y: 0 }],
  }, { heightAt: () => 0 });
  const partial = buildCourseBridgeGeometry({
    width: 3,
    bridge: {
      startT: 0.2,
      endT: 0.75,
      deckHeightFt: 1.5,
      clearanceFt: 0.9,
      supportSpacingYd: 8,
      railings: false,
    },
    pts: [{ x: 0, y: 0 }, { x: 20, y: 8 }, { x: 50, y: 0 }],
  }, { heightAt: () => 0 });

  assert.equal(partial.spanStartT, 0.2);
  assert.equal(partial.spanEndT, 0.75);
  assert.ok(partial.lengthYd < full.lengthYd * 0.57);
  assert.ok(partial.lengthYd > full.lengthYd * 0.53);
  approx(partial.deck.elevations[0], 0.5, 1e-4);
  assert.equal(partial.style.supportSpacingYd, 8);
  assert.equal(partial.style.railHeightYd, 0);
  assert.deepEqual(partial.railSegments, []);
  assert.deepEqual(partial.railPosts, []);
});

test('invalid paths, dimensions, mappings, and terrain samples fail explicitly', () => {
  const valid = { width: 3, pts: [{ x: 0, y: 0 }, { x: 10, y: 0 }] };
  assert.throws(() => buildCourseBridgeGeometry(valid), /heightAt must be a function/);
  assert.throws(
    () => buildCourseBridgeGeometry({ ...valid, width: 0 }, { heightAt: () => 0 }),
    /path\.width must be greater than zero/,
  );
  assert.throws(
    () => buildCourseBridgeGeometry({ ...valid, pts: [{ x: 1, y: 1 }, { x: 1, y: 1 }] }, { heightAt: () => 0 }),
    /two distinct points/,
  );
  assert.throws(
    () => buildCourseBridgeGeometry(valid, { heightAt: () => 0, pointToWorld: () => ({ x: 0 }) }),
    /worldZ must be a finite number/,
  );
  assert.throws(
    () => buildCourseBridgeGeometry(valid, { heightAt: () => Number.NaN }),
    /heightAt station 0 must be a finite number/,
  );
  assert.throws(
    () => buildCourseBridgeGeometry(valid, { heightAt: () => 0, supportInsetRatio: 1 }),
    /supportInsetRatio must be at most 0\.95/,
  );
  assert.throws(
    () => buildCourseBridgeGeometry({ ...valid, bridge: { startT: 0.8, endT: 0.2 } }, { heightAt: () => 0 }),
    /startT\/endT/,
  );
});
