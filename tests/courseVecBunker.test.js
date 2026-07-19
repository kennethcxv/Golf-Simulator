import test from 'node:test';
import assert from 'node:assert/strict';
import { makeVecBunker, polygonSDF, sampleClosed } from '../src/sim/courseVec.js';

function properIntersection(a, b, c, d) {
  const cross = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const abC = cross(a, b, c);
  const abD = cross(a, b, d);
  const cdA = cross(c, d, a);
  const cdB = cross(c, d, b);
  return ((abC > 0 && abD < 0) || (abC < 0 && abD > 0))
    && ((cdA > 0 && cdB < 0) || (cdA < 0 && cdB > 0));
}

test('lobed bunkers stay organic without pinched radii or crossing a turf island', () => {
  const radiusYd = 8;
  const stretch = 1.45;
  const angle = 0.37;
  const ca = Math.cos(angle);
  const sa = Math.sin(angle);

  for (let seed = 1; seed <= 256; seed++) {
    const bunker = makeVecBunker(0, 0, radiusYd, seed, { lobes: 3, stretch, angle });
    for (const point of bunker.pts) {
      const across = point.x * ca + point.y * sa;
      const forward = -point.x * sa + point.y * ca;
      const normalizedRadius = Math.hypot(across / stretch, forward) / (radiusYd / 8);
      assert.ok(normalizedRadius >= 0.56 && normalizedRadius <= 1.3,
        `seed ${seed} keeps a maintainable radial envelope (${normalizedRadius})`);
    }

    for (let first = 0; first < bunker.pts.length; first++) {
      for (let second = first + 1; second < bunker.pts.length; second++) {
        const nextFirst = (first + 1) % bunker.pts.length;
        const nextSecond = (second + 1) % bunker.pts.length;
        if (second === nextFirst || first === nextSecond) continue;
        assert.equal(properIntersection(
          bunker.pts[first], bunker.pts[nextFirst],
          bunker.pts[second], bunker.pts[nextSecond],
        ), false, `seed ${seed} has no self-crossing sand boundary`);
      }
    }

    const smoothed = sampleClosed(bunker.pts, 0.06);
    for (let first = 0; first < smoothed.length; first++) {
      for (let second = first + 1; second < smoothed.length; second++) {
        const nextFirst = (first + 1) % smoothed.length;
        const nextSecond = (second + 1) % smoothed.length;
        if (second === nextFirst || first === nextSecond) continue;
        assert.equal(properIntersection(
          smoothed[first], smoothed[nextFirst],
          smoothed[second], smoothed[nextSecond],
        ), false, `seed ${seed} stays crossing-free after spline smoothing`);
      }
    }
  }
});

test('an authored bunker outline keeps its intentional maintainable silhouette', () => {
  const outline = [
    [0.96, -0.16], [0.9, 0.32], [0.62, 0.76], [0.18, 1.02],
    [-0.3, 0.96], [-0.74, 0.66], [-1, 0.18], [-0.9, -0.34],
    [-0.54, -0.78], [-0.06, -0.94], [0.44, -0.84], [0.82, -0.54],
  ];
  const bunker = makeVecBunker(14, 22, 6, 17, {
    outline, stretch: 1.3, angle: 0.28, depth: 2.8,
  });
  assert.equal(bunker.pts.length, outline.length);
  assert.equal(bunker.depth, 2.8);
  assert.ok(polygonSDF(14, 22, sampleClosed(bunker.pts, 0.06)) < 0,
    'the authored center remains uninterrupted sand');
});
