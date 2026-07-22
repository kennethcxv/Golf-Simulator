// Pure heightfield normal solver shared by the course renderer and deterministic
// Node tests. No three.js, no DOM.
//
// The terrain is a regular grid: vertex (vx, vy) sits at world (vx*dx, h, vy*dz)
// with h from `heights`. Normals are area-weighted — each adjacent triangle
// contributes its unnormalized cross product — which is what
// THREE.BufferGeometry.computeVertexNormals() produces for the same mesh.
//
// Why this exists as its own module: a terrain stroke only moves a handful of
// vertices, and rebuilding all ~347k normals per stroke tick was the dominant
// cost of dragging the brush. A windowed solve has to be provably identical to
// the full solve inside the window, or edits leave shading seams behind. That
// property is a unit test here rather than an eyeball on a screenshot.

// Vertical flattening applied after accumulation. Golf-course land is gentle;
// without this the slope shading barely reads under a high sun.
export const TERRAIN_NORMAL_Y_SCALE = 0.55;

function accumulateFace(
  na, window,
  ia, ax, ah, az, gax, gay,
  ib, bx, bh, bz, gbx, gby,
  ic, cx, ch, cz, gcx, gcy,
) {
  const e1x = bx - ax;
  const e1y = bh - ah;
  const e1z = bz - az;
  const e2x = cx - ax;
  const e2y = ch - ah;
  const e2z = cz - az;
  let fx = e1y * e2z - e1z * e2y;
  let fy = e1z * e2x - e1x * e2z;
  let fz = e1x * e2y - e1y * e2x;
  // A heightfield face always points up; orienting by sign rather than trusting
  // index winding keeps this correct through the geometry's rotateX.
  if (fy < 0) { fx = -fx; fy = -fy; fz = -fz; }
  const { vx0, vy0, vx1, vy1 } = window;
  if (gax >= vx0 && gax <= vx1 && gay >= vy0 && gay <= vy1) {
    const o = ia * 3; na[o] += fx; na[o + 1] += fy; na[o + 2] += fz;
  }
  if (gbx >= vx0 && gbx <= vx1 && gby >= vy0 && gby <= vy1) {
    const o = ib * 3; na[o] += fx; na[o + 1] += fy; na[o + 2] += fz;
  }
  if (gcx >= vx0 && gcx <= vx1 && gcy >= vy0 && gcy <= vy1) {
    const o = ic * 3; na[o] += fx; na[o + 1] += fy; na[o + 2] += fz;
  }
}

// Writes normals into `na` (Float32Array, 3 per vertex) for every vertex inside
// `window` (inclusive vertex bounds; omit for the whole grid).
//
// Vertices outside the window are untouched, so a caller updating a region must
// pass a window padded by one vertex beyond the positions it moved — a vertex's
// normal depends on its neighbours' heights, not its own.
export function computeHeightfieldNormals(heights, vertsX, vertsY, dx, dz, na, window = null) {
  const segsX = vertsX - 1;
  const segsY = vertsY - 1;
  const w = window || { vx0: 0, vy0: 0, vx1: vertsX - 1, vy1: vertsY - 1 };
  const vx0 = Math.max(0, w.vx0);
  const vy0 = Math.max(0, w.vy0);
  const vx1 = Math.min(vertsX - 1, w.vx1);
  const vy1 = Math.min(vertsY - 1, w.vy1);
  const bounds = { vx0, vy0, vx1, vy1 };

  for (let vy = vy0; vy <= vy1; vy++) {
    for (let vx = vx0; vx <= vx1; vx++) {
      const o = (vy * vertsX + vx) * 3;
      na[o] = 0; na[o + 1] = 0; na[o + 2] = 0;
    }
  }

  // Cell (cx,cy) owns the quad whose lower corner is vertex (cx,cy). Starting
  // one cell before the window catches every triangle touching its edge.
  const cx0 = Math.max(0, vx0 - 1);
  const cy0 = Math.max(0, vy0 - 1);
  const cx1 = Math.min(segsX - 1, vx1);
  const cy1 = Math.min(segsY - 1, vy1);

  for (let cy = cy0; cy <= cy1; cy++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      const i00 = cy * vertsX + cx;
      const i10 = i00 + 1;
      const i01 = i00 + vertsX;
      const i11 = i01 + 1;
      const h00 = heights[i00];
      const h10 = heights[i10];
      const h01 = heights[i01];
      const h11 = heights[i11];
      // cell-local corners: 00=(0,0) 10=(dx,0) 01=(0,dz) 11=(dx,dz)
      accumulateFace(
        na, bounds,
        i00, 0, h00, 0, cx, cy,
        i01, 0, h01, dz, cx, cy + 1,
        i10, dx, h10, 0, cx + 1, cy,
      );
      accumulateFace(
        na, bounds,
        i10, dx, h10, 0, cx + 1, cy,
        i01, 0, h01, dz, cx, cy + 1,
        i11, dx, h11, dz, cx + 1, cy + 1,
      );
    }
  }

  for (let vy = vy0; vy <= vy1; vy++) {
    for (let vx = vx0; vx <= vx1; vx++) {
      const o = (vy * vertsX + vx) * 3;
      const nx = na[o];
      const ny = na[o + 1] * TERRAIN_NORMAL_Y_SCALE;
      const nz = na[o + 2];
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      na[o] = nx / len;
      na[o + 1] = ny / len;
      na[o + 2] = nz / len;
    }
  }
  return na;
}
