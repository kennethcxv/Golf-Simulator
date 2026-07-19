import test from 'node:test';
import assert from 'node:assert/strict';
import { makeVecBunker } from '../src/sim/courseVec.js';

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
  }
});
