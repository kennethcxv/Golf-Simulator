import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { ZONE } from '../src/sim/constants.js';
import {
  beginTerrainStroke,
  constructionImpact,
  endTerrainStroke,
  makeEditSession,
  objectPlacementOk,
  objectPlacementRotation,
  sculptAt,
} from '../src/sim/courseEditor.js';
import { newGame } from '../src/sim/state.js';

test('plateau, slope, blend, and erosion are construction strokes with one undo bill', () => {
  const state = newGame('relaxed', 9801);
  state.course.elevation.fill(2);
  const session = makeEditSession(state);

  const plateau = beginTerrainStroke(state, session);
  for (let pass = 0; pass < 4; pass++) {
    sculptAt(state, plateau, 12, 12, {
      mode: 'plateau', radius: 2.5, strength: 0.7, plateauOffsetFt: 2,
    });
  }
  const plateauResult = endTerrainStroke(state, session, plateau, 'Plateau');
  assert.ok(plateauResult.ok);
  assert.ok(state.course.elevation[12 * state.course.w + 12] > 3.5);

  state.course.elevation.fill(0);
  const slope = beginTerrainStroke(state, session);
  sculptAt(state, slope, 18, 18, { mode: 'slope', radius: 3, strength: 0.8, slopePercent: 5 });
  sculptAt(state, slope, 21, 18, { mode: 'slope', radius: 3, strength: 0.8, slopePercent: 5 });
  assert.ok(state.course.elevation[18 * state.course.w + 22]
    > state.course.elevation[18 * state.course.w + 19], 'the authored grade rises along the drag direction');
  assert.ok(endTerrainStroke(state, session, slope, 'Slope').ok);

  state.course.elevation.fill(0);
  const center = 26 * state.course.w + 26;
  state.course.elevation[center] = 8;
  const blend = beginTerrainStroke(state, session);
  sculptAt(state, blend, 26, 26, { mode: 'blend', radius: 3, strength: 0.8 });
  assert.ok(state.course.elevation[center] < 8, 'blend removes an abrupt construction seam');
  const afterBlend = state.course.elevation[center];
  const erode = beginTerrainStroke(state, session);
  sculptAt(state, erode, 26, 26, { mode: 'erode', radius: 3, strength: 0.8 });
  assert.ok(state.course.elevation[center] <= afterBlend, 'erosion softens the remaining high point downward');
  assert.ok(session.bill > 0);
  assert.ok(session.undo.length >= 2);
});

test('construction impact exposes cost, closure time, and the live appraisal delta', () => {
  const state = newGame('relaxed', 9802);
  const session = makeEditSession(state);
  const hole = state.course.holes.find((candidate) => candidate.tee && candidate.pin);
  const stroke = beginTerrainStroke(state, session);
  sculptAt(state, stroke, hole.tee.x, hole.tee.y, { mode: 'raise', radius: 2, strength: 1 });
  assert.ok(endTerrainStroke(state, session, stroke, 'Tee contour').ok);

  const impact = constructionImpact(state, session);
  assert.ok(impact.pendingCost > 0);
  assert.ok(impact.changedCells > 0);
  assert.ok(impact.holesAffected >= 1);
  assert.ok(impact.maxConstructionDays >= 1);
  assert.equal(impact.estimatedValue - impact.openingValue, impact.valueDelta);
});

test('landscaping preview rotation is deterministic and matches the commit input', () => {
  const a = objectPlacementRotation('tree_oak', 10.125, 14.75, true);
  const b = objectPlacementRotation('tree_oak', 10.125, 14.75, true);
  assert.equal(a, b);
  assert.ok(a >= 0 && a < Math.PI * 2);
  assert.equal(objectPlacementRotation('tree_oak', 10.125, 14.75, false), 0);
  assert.notEqual(a, objectPlacementRotation('tree_oak', 10.25, 14.75, true));
});

test('the complete landscaping footprint protects cart paths and active play', () => {
  const state = newGame('relaxed', 9803);
  state.course.zones.fill(ZONE.ROUGH);
  const x = 10.49;
  const y = 10;
  state.course.zones[y * state.course.w + 11] = ZONE.PATH;
  assert.match(objectPlacementOk(state.course, 'tree_oak', x, y, { protectPlay: true }).reason, /cart path/i);

  state.course.zones[y * state.course.w + 11] = ZONE.FAIRWAY;
  assert.match(objectPlacementOk(state.course, 'tree_oak', x, y, { protectPlay: true }).reason, /active play/i);
});

test('the renderer sources previews from the same authored flora and prop parts as final placement', () => {
  const source = readFileSync(new URL('../src/render3d/courseScene.js', import.meta.url), 'utf8');
  assert.match(source, /activeFloraAssets\.get\(floraId\)/);
  assert.match(source, /return objectParts\(type\)/);
  assert.match(source, /previewUnitScale/);
  assert.doesNotMatch(source, /Math\.random\(\) \* Math\.PI \* 2/);
});
