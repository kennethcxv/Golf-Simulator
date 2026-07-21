import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRng } from '../src/core/utils.js';
import { holeDistanceYd } from '../src/sim/course.js';
import { designCourse } from '../src/sim/courseArchitect.js';
import { CELL_YD, ZONE } from '../src/sim/constants.js';
import { vectorHoleForRecord } from '../src/ui/courseEditor.js';
import {
  evaluateSurface, getGeom, polygonSDF, sampleOpen,
} from '../src/sim/courseVec.js';

const WILLOW_SEED = 276398324;

function willow() {
  return designCourse(makeRng(WILLOW_SEED), { jitter: 0.35 });
}

function routeClearanceYd(a, b) {
  const aa = sampleOpen(a.line, 0.12);
  const bb = sampleOpen(b.line, 0.12);
  let nearest = Infinity;
  for (const p of aa) {
    for (const q of bb) nearest = Math.min(nearest, Math.hypot(p.x - q.x, p.y - q.y) * 8);
  }
  return nearest;
}

test('all nine production holes have authored identities, yardages, and playable complexes', () => {
  const course = willow();
  const expected = [
    ['Opening Drive', 400, 425, 3],
    ['The Overlook', 165, 185, 2],
    ['Long Meadow', 480, 510, 3],
    ['The Elbow', 380, 405, 2],
    ['Millpond', 400, 425, 2],
    ['Short Iron', 135, 155, 3],
    ['Cascades', 510, 540, 3],
    ['The Glade', 150, 175, 2],
    ['Homeward', 340, 370, 2],
  ];
  assert.equal(course.vec.holes.length, expected.length);

  const styles = new Set();
  const geom = getGeom(course);
  course.vec.holes.forEach((hole, index) => {
    const [name, minYd, maxYd, bunkerCount] = expected[index];
    const yardage = holeDistanceYd(course.holes[index]);
    assert.equal(hole.name, name);
    assert.ok(yardage >= minYd && yardage <= maxYd, `${name} is ${yardage.toFixed(1)} yd`);
    assert.equal(hole.bunkers.length, bunkerCount, `${name} keeps its strategic hazard count`);
    assert.ok(hole.green.style, `${name} has named green intent`);
    assert.ok(!styles.has(hole.green.style), `${name} does not reuse another green grammar`);
    styles.add(hole.green.style);
    assert.ok(hole.green.pts.length >= 12, `${name} has an authored smooth outline`);
    assert.equal(hole.green.contours.length, 2, `${name} has two restrained putting contours`);
    assert.ok(hole.terrainProfile?.relativeFeet?.length >= 2, `${name} has a longitudinal landform`);
    assert.ok(hole.vegetation?.exclusions?.length >= 5, `${name} protects its shot and hazard windows`);
    for (const pin of hole.green.pins) {
      assert.ok(polygonSDF(pin.x, pin.y, geom.holes[index].greenPoly) < -0.45,
        `${name} keeps every pin safely inside its authored outline`);
    }
  });
});

test('The Glade no longer crosses Millpond and retains safe sequential separation', () => {
  const course = willow();
  const millpond = course.vec.holes[4];
  const cascades = course.vec.holes[6];
  const glade = course.vec.holes[7];

  assert.ok(routeClearanceYd(millpond, glade) > 52,
    'H5 and H8 retain a planted full-shot separation instead of crossing');
  assert.ok(routeClearanceYd(cascades, glade) > 36,
    'the sequential H7 green/H8 tee transition remains safely separated');
  assert.ok(Math.abs(glade.line.at(-1).y - glade.line[0].y) < 1.5,
    'H8 uses the intended east-west glade band rather than the old diagonal chord');
});

test('Millpond is one organic approach hazard with a clean strategic bank', () => {
  const course = willow();
  const pond = course.vec.waters.find((water) => water.role === 'millpond-approach');
  assert.ok(pond, 'the hero pond retains its authored identity');
  assert.equal(pond.surface, 'outline', 'the water plane follows the shoreline instead of a bounding disc');
  assert.equal(pond.pts.length, 18, 'the pond uses a smooth, asymmetric authored silhouette');

  const geom = getGeom(course);
  const water = geom.waters.find((feature) => feature.ref === pond);
  const route = sampleOpen(course.vec.holes[4].line, 0.08);
  const routeClearYd = Math.min(...route.map((point) => polygonSDF(point.x, point.y, water.poly) * CELL_YD));
  assert.ok(routeClearYd > 4 && routeClearYd < 12,
    `the water guards but does not consume the approach centerline (${routeClearYd.toFixed(1)} yd)`);

  const greenClearYd = Math.min(...geom.holes[4].greenPoly.map((point) => (
    polygonSDF(point.x, point.y, water.poly) * CELL_YD
  )));
  assert.ok(greenClearYd > 14, `the putting surface keeps a playable dry collar (${greenClearYd.toFixed(1)} yd)`);

  const accents = course.objects.filter((object) => object.role === 'millpond-shore');
  assert.equal(accents.length, 8, 'a restrained reed/rock rhythm identifies the back shoreline');
  for (const accent of accents) {
    const clearYd = polygonSDF(accent.x, accent.y, water.poly) * CELL_YD;
    assert.ok(clearYd > 0.5 && clearYd < 3,
      `${accent.type} sits on dry ground immediately outside the bank (${clearYd.toFixed(1)} yd)`);
  }
});

test('the authored cart network never cuts the underlying playing surfaces or water', () => {
  const course = willow();
  // Evaluate against a path-free geometry pack. PATH has higher render/sim
  // priority than fairway, so using the normal geometry would merely classify
  // a crossing as PATH and mask the playing surface underneath it.
  const underlyingCourse = { ...course, paths: [] };
  const geom = getGeom(underlyingCourse);
  const forbidden = new Set([
    ZONE.FAIRWAY, ZONE.GREEN, ZONE.TEE, ZONE.BUNKER,
    ZONE.WATER, ZONE.FRINGE, ZONE.SEMI,
  ]);
  const samples = course.paths.flatMap((path) => sampleOpen(path.pts, 0.08));
  const crossings = samples.filter((point) => forbidden.has(
    evaluateSurface(underlyingCourse, geom, point.x, point.y, underlyingCourse.paint || null).zone,
  ));
  assert.deepEqual(crossings, [], 'cart circulation stays outside every exact vector playing surface');
});

test('the six-part cart network is deterministic, connected, and free of spline self-crossings', () => {
  const course = willow();
  const repeated = willow();
  assert.equal(course.paths.length, 6);
  assert.equal(course.nextPathId, 7);
  assert.deepEqual(repeated.paths, course.paths, 'same seed reproduces every paved control and id');

  const endpoints = course.paths.map((path) => [path.pts[0], path.pts.at(-1)]);
  const touches = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) < 1e-9;
  const reached = new Set([0]);
  for (let changed = true; changed;) {
    changed = false;
    for (let i = 0; i < endpoints.length; i++) {
      if (!reached.has(i)) continue;
      for (let j = 0; j < endpoints.length; j++) {
        if (reached.has(j)) continue;
        if (endpoints[i].some((a) => endpoints[j].some((b) => touches(a, b)))) {
          reached.add(j);
          changed = true;
        }
      }
    }
  }
  assert.equal(reached.size, course.paths.length, 'every branch joins the clubhouse circulation graph');
  assert.ok(touches(endpoints[0][0], endpoints.at(-1)[1]), 'the final path closes exactly on staging');

  const strictIntersection = (a, b, c, d) => {
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const cdx = d.x - c.x;
    const cdy = d.y - c.y;
    const den = abx * cdy - aby * cdx;
    if (Math.abs(den) < 1e-9) return false;
    const acx = c.x - a.x;
    const acy = c.y - a.y;
    const t = (acx * cdy - acy * cdx) / den;
    const u = (acx * aby - acy * abx) / den;
    return t > 1e-5 && t < 1 - 1e-5 && u > 1e-5 && u < 1 - 1e-5;
  };
  for (const path of course.paths) {
    const dense = sampleOpen(path.pts, 0.2);
    for (let i = 0; i < dense.length - 1; i++) {
      for (let j = i + 3; j < dense.length - 1; j++) {
        assert.equal(strictIntersection(dense[i], dense[i + 1], dense[j], dense[j + 1]), false,
          `path ${path.id} has no non-adjacent spline intersection`);
      }
    }
  }
});

test('every tee has grounded furniture selected by authored amenities', () => {
  const course = willow();
  const teeComplexesWithoutTrash = new Set(['The Elbow']);
  for (let index = 0; index < course.vec.holes.length; index++) {
    const hole = course.vec.holes[index];
    const tee = hole.tees[0];
    const nearby = course.objects.filter((object) => (
      Math.hypot(object.x - tee.x, object.y - tee.y) * 8 < 15
    ));
    assert.ok(nearby.some((object) => object.type === 'tee_sign'), `${hole.name} has a tee sign`);
    assert.ok(nearby.some((object) => object.type === 'bench_course'), `${hole.name} has a bench`);
    assert.equal(
      nearby.some((object) => object.type === 'trash_course'),
      !teeComplexesWithoutTrash.has(hole.name),
      `${hole.name} matches its authored waste-bin amenity`,
    );
  }
});

test('compact hole maps resolve vecId before the overlapping legacy record id', () => {
  const course = willow();
  for (const index of [3, 7]) { // H4 record id 4 overlaps H2 vec id 4; H8 id 8 overlaps H3 vec id 8.
    const record = course.holes[index];
    const vector = vectorHoleForRecord(course, record);
    assert.equal(vector?.id, record.vecId);
    assert.equal(vector?.name, record.name);
  }
});
