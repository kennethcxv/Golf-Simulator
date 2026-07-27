// MAPPING THE INTERFACE ONTO THE GLASS.
//
// The Fairway Office is a real 1024x640 DOM. To live ON the laptop rather than in front of it,
// it is mapped onto the display's four projected corners by a plane-to-plane projective map —
// a homography — emitted as a CSS matrix3d.
//
// This math was never the bug. The bug was WHEN it ran: twice, on a wall-clock timer, while the
// camera was still easing into the seat and the lid was still swinging. So the transform always
// described where the screen had been, not where it was. Measured in the browser: force one
// extra alignment and the DOM's box becomes exactly the live quad from the previous probe —
// permanently one alignment behind. Hence `alignLaptopUi` now runs EVERY FRAME while the lid is
// open (four projections and a 3x3 solve — nothing). It cannot go stale if it is never cached.
//
// The inverse is here too, because the inverse is what turns a mouse position into a point on
// the glass — the "screen UV hit" the brief asks to see.

// --- 3x3 helpers (row-major) ---------------------------------------------------------------
const adj = (m) => [
  m[4] * m[8] - m[5] * m[7], m[2] * m[7] - m[1] * m[8], m[1] * m[5] - m[2] * m[4],
  m[5] * m[6] - m[3] * m[8], m[0] * m[8] - m[2] * m[6], m[2] * m[3] - m[0] * m[5],
  m[3] * m[7] - m[4] * m[6], m[1] * m[6] - m[0] * m[7], m[0] * m[4] - m[1] * m[3],
];

const mul = (a, b) => [
  a[0] * b[0] + a[1] * b[3] + a[2] * b[6], a[0] * b[1] + a[1] * b[4] + a[2] * b[7], a[0] * b[2] + a[1] * b[5] + a[2] * b[8],
  a[3] * b[0] + a[4] * b[3] + a[5] * b[6], a[3] * b[1] + a[4] * b[4] + a[5] * b[7], a[3] * b[2] + a[4] * b[5] + a[5] * b[8],
  a[6] * b[0] + a[7] * b[3] + a[8] * b[6], a[6] * b[1] + a[7] * b[4] + a[8] * b[7], a[6] * b[2] + a[7] * b[5] + a[8] * b[8],
];

const mulV = (m, v) => [
  m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
  m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
  m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
];

// the collineation taking (0,0),(1,0),(0,1),(1,1) to four given points
const basis = (p1, p2, p3, p4) => {
  const m = [p1.x, p2.x, p3.x, p1.y, p2.y, p3.y, 1, 1, 1];
  const v = mulV(adj(m), [p4.x, p4.y, 1]);
  return mul(m, [v[0], 0, 0, 0, v[1], 0, 0, 0, v[2]]);
};

// apply a homography to a point
export function applyH(h, x, y) {
  const w = h[6] * x + h[7] * y + h[8];
  return { x: (h[0] * x + h[1] * y + h[2]) / w, y: (h[3] * x + h[4] * y + h[5]) / w };
}

// The map from the interface rectangle (w x h) onto the quad [tl, tr, br, bl].
export function homography(w, h, q) {
  const src = basis({ x: 0, y: 0 }, { x: w, y: 0 }, { x: 0, y: h }, { x: w, y: h });
  const dst = basis(q[0], q[1], q[3], q[2]); // tl, tr, bl — normalised through br
  const t = mul(dst, adj(src));
  if (!t[8]) return null;
  for (let i = 0; i < 9; i++) t[i] /= t[8];
  return t;
}

// ...as CSS. matrix3d is COLUMN-major: (m11,m12,m13,m14, m21,m22,m23,m24, ...).
export function quadTransform(w, h, q) {
  const t = homography(w, h, q);
  // The lid is CLOSED when the player presses E, so on the first frames the glass is edge-on and
  // its projected area is ~0 — a degenerate quad. Emitting NaN there would poison the DOM's
  // transform for the rest of the session, and nothing would ever put it right.
  if (!t || t.some((n) => !Number.isFinite(n))) return null;
  return `matrix3d(${t[0]},${t[3]},0,${t[6]},${t[1]},${t[4]},0,${t[7]},0,0,1,0,${t[2]},${t[5]},0,1)`;
}

// The inverse: a point on the real monitor -> where it lands on the laptop's glass, in UV.
// Outside [0,1] means the cursor has left the screen.
export function uvAt(w, h, q, px, py) {
  const t = homography(w, h, q);
  if (!t) return { u: NaN, v: NaN };
  const p = applyH(adj(t), px, py);
  return { u: p.x / w, v: p.y / h };
}
