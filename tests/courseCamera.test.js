import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COURSE_CAMERA_MODES,
  normalizeCourseCameraProperty,
  courseCameraRoute,
  sampleCourseCameraRoute,
  courseCameraPose,
  courseCameraFlyoverPose,
} from '../src/sim/courseCamera.js';
import { newGame } from '../src/sim/state.js';

const WORLD = { coordinateSpace: 'world', property: { worldW: 960, worldH: 640 } };

function assertFinitePose(value) {
  assert.ok(value && value.target, 'pose has a target');
  for (const number of [value.target.x, value.target.y, value.target.z, value.yaw, value.pitch, value.dist]) {
    assert.equal(Number.isFinite(number), true, `pose number is finite (${number})`);
  }
  assert.ok(value.pitch > 0 && value.pitch < Math.PI / 2, `usable pitch (${value.pitch})`);
  assert.ok(value.dist > 0, `positive camera distance (${value.dist})`);
}

function projectToNdc(point, value, aspect, verticalFov = 50) {
  const { target, yaw, pitch, dist } = value;
  const sy = Math.sin(yaw);
  const cy = Math.cos(yaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const camera = {
    x: target.x + sy * cp * dist,
    y: target.y + sp * dist,
    z: target.z + cy * cp * dist,
  };
  const rel = { x: point.x - camera.x, y: point.y - camera.y, z: point.z - camera.z };
  const depth = rel.x * (-sy * cp) + rel.y * -sp + rel.z * (-cy * cp);
  const tanHalf = Math.tan(verticalFov * Math.PI / 360);
  return {
    x: (rel.x * cy - rel.z * sy) / (depth * tanHalf * aspect),
    y: (rel.x * (-sy * sp) + rel.y * cp + rel.z * (-cy * sp)) / (depth * tanHalf),
    depth,
  };
}

test('native cell coordinates convert through centred property bounds', () => {
  const property = normalizeCourseCameraProperty({ w: 20, h: 10, cellYd: 8 });
  assert.deepEqual(
    { minX: property.minX, maxX: property.maxX, minZ: property.minZ, maxZ: property.maxZ },
    { minX: -80, maxX: 80, minZ: -40, maxZ: 40 },
  );
  const route = courseCameraRoute(
    { tee: { x: 0, y: 0 }, pin: { x: 19, y: 9 } },
    { property: { w: 20, h: 10, cellYd: 8 } },
  );
  assert.deepEqual(route, [{ x: -76, z: -36 }, { x: 76, z: 36 }]);
});

test('authored vector line and active precise endpoints beat coarse legacy waypoints', () => {
  const hole = {
    tee: { x: 1, y: 1 },
    pin: { x: 9, y: 9 },
    wp: [{ x: 5, y: 5 }],
    activeTee: 'middle',
    activePin: 'B',
  };
  const vecHole = {
    line: [{ x: 10, y: 10 }, { x: 30, y: 12 }, { x: 45, y: 35 }],
    tees: [
      { tier: 'back', x: 10.1, y: 10.2 },
      { tier: 'middle', x: 12.5, y: 10.8 },
    ],
    green: { pins: [{ x: 45, y: 35 }, { x: 45.75, y: 34.4 }] },
  };
  const route = courseCameraRoute(hole, { vecHole, coordinateSpace: 'world' });
  assert.deepEqual(route, [
    { x: 12.5, z: 10.8 },
    { x: 30, z: 12 },
    { x: 45.75, z: 34.4 },
  ]);
});

test('arc-length sampling follows the full dogleg instead of its tee-pin chord', () => {
  const dogleg = [{ x: 0, z: 0 }, { x: 100, z: 0 }, { x: 100, z: 100 }];
  const middle = sampleCourseCameraRoute(dogleg, 0.5);
  assert.deepEqual(
    { x: middle.x, z: middle.z, length: middle.length },
    { x: 100, z: 0, length: 200 },
  );
  assert.equal(middle.tx, 1);
  assert.equal(middle.tz, 0);
});

test('every production preset returns a finite CameraRig-compatible pose', () => {
  const hole = {
    tee: { x: 0, z: 0 },
    wp: [{ x: 80, z: 25 }, { x: 175, z: 20 }],
    pin: { x: 310, z: 160 },
  };
  for (const mode of Object.values(COURSE_CAMERA_MODES)) {
    const value = courseCameraPose(hole, mode, {
      ...WORLD,
      heightAt: (x, z) => (x + z) * 0.01,
    });
    assertFinitePose(value);
    assert.equal(value.mode, mode);
  }
});

test('frame-hole composition uses dogleg arc and stays tighter than the legacy chord framing', () => {
  const hole = {
    tee: { x: 0, z: 0 },
    wp: [{ x: 130, z: 25 }, { x: 165, z: 190 }],
    pin: { x: 30, z: 340 },
  };
  const value = courseCameraPose(hole, 'frame hole', WORLD);
  assertFinitePose(value);
  assert.equal(value.mode, COURSE_CAMERA_MODES.FRAME_HOLE);
  assert.ok(value.target.x > 100, `target follows the bend (${value.target.x.toFixed(1)})`);
  assert.ok(value.dist >= 250 && value.dist <= 440, `whole route fits without satellite distance (${value.dist.toFixed(1)})`);
  assert.equal(value.frameClipped, false);
});

test('all nine generated holes fit the conservative frame safe area at common aspects', () => {
  const state = newGame('relaxed', 4242);
  const { course } = state;
  const heightAt = (x, z) => Math.sin(x * 0.017) * 3.2 + Math.cos(z * 0.013) * 2.4;
  const world = (point) => ({
    x: (point.x + 0.5) * 8 - course.w * 4,
    y: heightAt((point.x + 0.5) * 8 - course.w * 4, (point.y + 0.5) * 8 - course.h * 4),
    z: (point.y + 0.5) * 8 - course.h * 4,
  });

  for (const verticalFov of [46, 50]) {
    for (const aspect of [4 / 3, 16 / 9, 21 / 9]) {
      for (let index = 0; index < course.holes.length; index++) {
        const hole = course.holes[index];
        const vecHole = course.vec.holes.find((entry) => entry.id === hole.vecId);
        const value = courseCameraPose(hole, COURSE_CAMERA_MODES.FRAME_HOLE, {
          property: course,
          vecHole,
          heightAt,
          aspect,
          verticalFov,
        });
        assert.equal(value.frameClipped, false,
          `hole ${index + 1} has a solvable frame at ${aspect} / ${verticalFov}deg`);

        const route = courseCameraRoute(hole, { property: course, vecHole });
        const points = [
          ...route.map((point) => ({ ...point, y: heightAt(point.x, point.z) })),
          ...(vecHole.tees || []).map(world),
          ...(vecHole.green?.pts || []).map(world),
          ...(vecHole.bunkers || []).flatMap((bunker) => (bunker.pts || []).map(world)),
        ];
        for (const point of points) {
          const projected = projectToNdc(point, value, aspect, verticalFov);
          assert.ok(projected.depth > 1, `hole ${index + 1} point is in front of the camera`);
          assert.ok(Math.abs(projected.x) <= 0.82001,
            `hole ${index + 1} x ${projected.x.toFixed(4)} fits at aspect ${aspect}`);
          assert.ok(Math.abs(projected.y) <= 0.78001,
            `hole ${index + 1} y ${projected.y.toFixed(4)} fits at aspect ${aspect}`);
        }
      }
    }
  }
});

test('a fitted hole pose changes distance when reframed from ultrawide to 4:3', () => {
  const hole = { tee: { x: 0, z: 0 }, pin: { x: 0, z: 300 } };
  const vecHole = {
    line: [{ x: 0, y: 0 }, { x: 0, y: 300 }],
    green: { pts: [{ x: -200, y: 250 }, { x: 200, y: 250 }] },
  };
  const options = { ...WORLD, vecHole, verticalFov: 46 };
  const ultrawide = courseCameraPose(hole, COURSE_CAMERA_MODES.FRAME_HOLE, {
    ...options,
    aspect: 21 / 9,
  });
  const compact = courseCameraPose(hole, COURSE_CAMERA_MODES.FRAME_HOLE, {
    ...options,
    aspect: 4 / 3,
  });

  assert.equal(ultrawide.frameClipped, false);
  assert.equal(compact.frameClipped, false);
  assert.ok(compact.dist > ultrawide.dist + 1,
    `4:3 refit (${compact.dist}) pulls back from 21:9 (${ultrawide.dist})`);
});

test('ground preview reconstructs a restrained first-person eye height', () => {
  const hole = { tee: { x: 0, z: 0 }, pin: { x: 0, z: 400 } };
  const value = courseCameraPose(hole, COURSE_CAMERA_MODES.GROUND_PREVIEW, {
    ...WORLD,
    eyeHeightYd: 1.85,
  });
  assertFinitePose(value);
  assert.ok(value.routeT > 0 && value.routeT < 0.1);
  assert.ok(Math.abs(Math.sin(value.pitch) * value.dist - 1.85) < 1e-9,
    'CameraRig vertical offset is exactly the requested eye height');
  assert.ok(Math.abs(value.yaw - Math.PI) < 1e-9, 'camera sits behind a northbound tee shot');
});

test('tee view stays close to an elevated player perspective instead of a high crane shot', () => {
  const hole = { tee: { x: 0, z: 0 }, pin: { x: 0, z: 400 } };
  const value = courseCameraPose(hole, COURSE_CAMERA_MODES.TEE, WORLD);
  const verticalOffset = Math.sin(value.pitch) * value.dist;
  const cameraZ = value.target.z + Math.cos(value.yaw) * Math.cos(value.pitch) * value.dist;

  assertFinitePose(value);
  assert.ok(value.pitch >= 0.14 && value.pitch <= 0.2, `restrained tee pitch (${value.pitch})`);
  assert.ok(verticalOffset >= 6 && verticalOffset <= 9,
    `tee camera is elevated enough to read the landing line without becoming aerial (${verticalOffset})`);
  assert.ok(cameraZ >= -13 && cameraZ <= -6,
    `tee camera remains just behind the authored tee (${cameraZ})`);
});

test('authored frame yaw isolates a short hole while preserving fitted bounds', () => {
  const hole = { tee: { x: 0, z: 0 }, pin: { x: 0, z: 180 } };
  const line = [{ x: 0, y: 0 }, { x: 0, y: 180 }];
  const base = courseCameraPose(hole, COURSE_CAMERA_MODES.FRAME_HOLE, {
    ...WORLD,
    vecHole: { line },
  });
  const isolated = courseCameraPose(hole, COURSE_CAMERA_MODES.FRAME_HOLE, {
    ...WORLD,
    vecHole: { line, camera: { frameYawOffset: 0.2, framePitch: 0.56 } },
  });

  assert.equal(base.frameClipped, false);
  assert.equal(isolated.frameClipped, false);
  assert.ok(Math.abs((isolated.yaw - base.yaw) - 0.2) < 1e-12,
    'authored yaw offset is applied exactly');
  assert.equal(isolated.pitch, 0.56, 'authored pitch keeps a short hole oblique');
});

test('authored short-hole camera metadata isolates approach, green, and flyover views', () => {
  const hole = { tee: { x: 0, z: 0 }, pin: { x: 0, z: 180 } };
  const line = [{ x: 0, y: 0 }, { x: 0, y: 180 }];
  const baseVec = { line };
  const camera = {
    approachYawOffset: -0.18,
    greenYawOffset: -0.14,
    flyoverYawOffset: -0.12,
    approachDistYd: 44,
    greenContextStartT: 0.9,
    greenContextHalfWidthYd: 21,
  };
  const authoredVec = { line, camera };

  const baseApproach = courseCameraPose(hole, COURSE_CAMERA_MODES.APPROACH, {
    ...WORLD, vecHole: baseVec,
  });
  const authoredApproach = courseCameraPose(hole, COURSE_CAMERA_MODES.APPROACH, {
    ...WORLD, vecHole: authoredVec,
  });
  assert.ok(Math.abs((authoredApproach.yaw - baseApproach.yaw) + 0.18) < 1e-12);
  assert.equal(authoredApproach.dist, 44);

  const baseGreen = courseCameraPose(hole, COURSE_CAMERA_MODES.GREEN, {
    ...WORLD, vecHole: baseVec,
  });
  const authoredGreen = courseCameraPose(hole, COURSE_CAMERA_MODES.GREEN, {
    ...WORLD, vecHole: authoredVec,
  });
  assert.ok(Math.abs((authoredGreen.yaw - baseGreen.yaw) + 0.14) < 1e-12);

  const baseFlyover = courseCameraFlyoverPose(hole, 0.5, {
    ...WORLD, vecHole: baseVec,
  });
  const authoredFlyover = courseCameraFlyoverPose(hole, 0.5, {
    ...WORLD, vecHole: authoredVec,
  });
  assert.ok(Math.abs((authoredFlyover.yaw - baseFlyover.yaw) + 0.12) < 1e-12);
});

test('landing and approach presets retain golf scale instead of reverting to aerial plans', () => {
  const hole = { tee: { x: 0, z: 0 }, pin: { x: 0, z: 400 } };
  const landing = courseCameraPose(hole, COURSE_CAMERA_MODES.FAIRWAY, WORLD);
  const approach = courseCameraPose(hole, COURSE_CAMERA_MODES.APPROACH, WORLD);

  assertFinitePose(landing);
  assertFinitePose(approach);
  assert.ok(landing.pitch <= 0.34 && landing.dist <= 96,
    `landing area remains an oblique landscape view (${landing.pitch}, ${landing.dist})`);
  assert.ok(approach.pitch <= 0.29 && approach.dist <= 74,
    `approach remains close enough to read hazard relief (${approach.pitch}, ${approach.dist})`);
  assert.ok(Math.sin(approach.pitch) * approach.dist < 22,
    'approach camera stays below the former crane-shot height');
});

test('green view fits the final approach corridor, putting surface, and nearby hazards', () => {
  const state = newGame('relaxed', 4242);
  const { course } = state;
  const heightAt = (x, z) => Math.sin(x * 0.017) * 3.2 + Math.cos(z * 0.013) * 2.4;
  const world = (point) => ({
    x: (point.x + 0.5) * 8 - course.w * 4,
    z: (point.y + 0.5) * 8 - course.h * 4,
  });

  for (const aspect of [4 / 3, 16 / 9, 21 / 9]) {
    for (let index = 0; index < course.holes.length; index++) {
      const hole = course.holes[index];
      const vecHole = course.vec.holes.find((entry) => entry.id === hole.vecId);
      const value = courseCameraPose(hole, COURSE_CAMERA_MODES.GREEN, {
        property: course,
        vecHole,
        heightAt,
        aspect,
        verticalFov: 46,
      });
      assert.equal(value.greenClipped, false,
        `hole ${index + 1} green has a solvable composition at aspect ${aspect}`);
      assert.ok(value.dist >= 48 && value.dist <= 104);
      assert.ok(value.routeT < 1, 'composition is biased into the approach, not pinned to the cup');

      const route = courseCameraRoute(hole, { property: course, vecHole });
      const greenCenter = sampleCourseCameraRoute(route, 1);
      const points = (vecHole.green?.pts || []).map(world);
      for (const bunker of vecHole.bunkers || []) {
        const bunkerPoints = (bunker.pts || []).map(world);
        if (bunkerPoints.some((point) => (
          Math.hypot(point.x - greenCenter.x, point.z - greenCenter.z) <= 80
        ))) points.push(...bunkerPoints);
      }

      for (const point of points) {
        const projected = projectToNdc(
          { ...point, y: heightAt(point.x, point.z) }, value, aspect, 46,
        );
        assert.ok(projected.depth > 1);
        assert.ok(Math.abs(projected.x) <= 0.80001,
          `hole ${index + 1} green feature x ${projected.x.toFixed(4)} fits`);
        assert.ok(Math.abs(projected.y) <= 0.74001,
          `hole ${index + 1} green feature y ${projected.y.toFixed(4)} fits`);
      }
    }
  }

  const opening = course.holes[0];
  const openingVec = course.vec.holes.find((entry) => entry.id === opening.vecId);
  const openingView = courseCameraPose(opening, COURSE_CAMERA_MODES.GREEN, {
    property: course,
    vecHole: openingVec,
    heightAt,
    aspect: 16 / 9,
    verticalFov: 46,
  });
  assert.ok(openingView.dist > 70,
    `Opening Drive pulls back enough to show its two greenside hazards (${openingView.dist})`);
});

test('flyover smooth-steps along the dogleg and turns onto the approach', () => {
  const hole = {
    tee: { x: 0, z: 0 },
    wp: [{ x: 100, z: 0 }],
    pin: { x: 100, z: 100 },
  };
  const middle = courseCameraFlyoverPose(hole, 0.5, WORLD);
  const late = courseCameraFlyoverPose(hole, 0.9, WORLD);
  assertFinitePose(middle);
  assertFinitePose(late);
  assert.equal(middle.mode, 'flyover');
  assert.deepEqual(middle.target, { x: 100, y: 0, z: 0 });
  assert.ok(middle.pitch <= 0.35 && middle.dist <= 76,
    `mid-flight remains close to the course (${middle.pitch}, ${middle.dist})`);
  assert.ok(late.target.x > 99 && late.target.z > 80, `late camera follows the second leg (${late.target.x}, ${late.target.z})`);
  assert.ok(Math.abs(late.yaw - Math.PI) < 0.35, 'late camera faces along the northbound approach');
});

test('invalid holes, duplicate points, bad bounds, and throwing terrain hooks stay finite', () => {
  const malformed = {
    tee: { x: NaN, y: 4 },
    wp: [{ x: 8, y: 8 }, { x: 8, y: 8 }, { x: Infinity, y: 2 }],
    pin: { x: 8, y: 8 },
  };
  const options = {
    property: { w: -1, h: NaN, cellYd: 0, minX: 5, maxX: 5 },
    heightAt: () => { throw new Error('terrain unavailable'); },
  };
  assertFinitePose(courseCameraPose(malformed, COURSE_CAMERA_MODES.APPROACH, options));
  const fallback = courseCameraPose(null, COURSE_CAMERA_MODES.TEE, options);
  assertFinitePose(fallback);
  assert.equal(fallback.mode, COURSE_CAMERA_MODES.COURSE_OVERVIEW);
  assert.equal(fallback.requestedMode, COURSE_CAMERA_MODES.TEE);
  assert.equal(fallback.fallback, 'invalid-route');
  assertFinitePose(courseCameraFlyoverPose(null, NaN, options));
});

test('course overview fits property corners and sampled terrain at common aspects', () => {
  const property = { w: 120, h: 80, cellYd: 8 };
  const heightAt = (x, z) => Math.sin(x * 0.012) * 5 + Math.cos(z * 0.019) * 3;
  for (const verticalFov of [46, 50]) {
    for (const aspect of [4 / 3, 16 / 9, 21 / 9]) {
      const value = courseCameraPose(null, COURSE_CAMERA_MODES.COURSE_OVERVIEW, {
        property,
        heightAt,
        aspect,
        verticalFov,
        maxOverviewDist: 700,
      });
      assertFinitePose(value);
      assert.equal(value.overviewClipped, false,
        `overview fits at aspect ${aspect} / ${verticalFov}deg`);
      assert.ok(value.dist <= 700);
      assert.ok(value.pitch >= 0.61 && value.pitch <= 0.63, 'overview remains an oblique terrain view');

      for (let iz = 0; iz <= 4; iz++) {
        for (let ix = 0; ix <= 6; ix++) {
          const x = -480 + 960 * (ix / 6);
          const z = -320 + 640 * (iz / 4);
          const projected = projectToNdc({ x, y: heightAt(x, z), z }, value, aspect, verticalFov);
          assert.ok(projected.depth > 1);
          assert.ok(Math.abs(projected.x) <= 0.88001,
            `overview x ${projected.x.toFixed(4)} fits at aspect ${aspect}`);
          assert.ok(Math.abs(projected.y) <= 0.86001,
            `overview y ${projected.y.toFixed(4)} fits at aspect ${aspect}`);
        }
      }
    }
  }
});

test('course overview reports when a configured distance cap cannot fit the property', () => {
  const value = courseCameraPose(null, COURSE_CAMERA_MODES.COURSE_OVERVIEW, {
    property: { w: 120, h: 80, cellYd: 8 },
    aspect: 4 / 3,
    maxOverviewDist: 300,
  });
  assertFinitePose(value);
  assert.equal(value.dist, 300, 'the configured cap is respected');
  assert.equal(value.overviewClipped, true);
});

test('explicit world bounds set a non-origin course overview target', () => {
  const value = courseCameraPose(null, 'overview', {
    coordinateSpace: 'world',
    property: { minX: 100, maxX: 500, minZ: -50, maxZ: 250 },
    heightAt: () => 7,
  });
  assertFinitePose(value);
  assert.ok(value.target.x >= 300 && value.target.x <= 500,
    'wide property biases the target toward its near x boundary');
  assert.equal(value.target.z, 100);
  assert.equal(value.target.y, 7);
  assert.ok(value.dist >= 180 && value.dist <= 700);
  assert.equal(value.overviewClipped, false);
});
