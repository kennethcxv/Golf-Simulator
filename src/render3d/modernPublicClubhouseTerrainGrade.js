// Pure terrain-grade contract for the modular Course-2 public clubhouse site.
// Keeping this DOM/Three-free makes the exact pads and feather deterministic in
// Node tests as well as the browser terrain build.

const METERS_TO_YARDS = 1 / 0.9144;

const rect = (cx, cz, width, depth) => Object.freeze({
  cx: cx * METERS_TO_YARDS,
  cz: cz * METERS_TO_YARDS,
  width: width * METERS_TO_YARDS,
  depth: depth * METERS_TO_YARDS,
});

// Blender -Y is Three +Z. These are permanent architecture/hardscape modules,
// not a loose bounding rectangle, so turf between facilities remains natural.
export const MODERN_PUBLIC_CLUBHOUSE_GRADE_RECTS = Object.freeze([
  rect(0, 0, 16.80, 10.50),          // compact conditioned building
  rect(0, 8.10, 21.60, 2.10),        // front sidewalk
  rect(-0.73152, 11.20, 2.40, 4.10), // accessible entrance connector
  rect(0, 30.10, 41.40, 38.40),      // 52-space lot
  rect(27.70, 43.20, 14.00, 11.60),  // two-lane entrance throat
  rect(13.50, -0.15, 8.80, 8.00),    // loading apron
  rect(24.20, 3.70, 12.60, 8.00),    // cart-barn turning/staging apron
  rect(24.50, -4.50, 12.00, 8.40),   // cart barn
  rect(-3.85, -9.55, 10.80, 6.20),   // empty patio
]);

const clamp01 = (value) => Math.max(0, Math.min(1, value));
const smooth01 = (value) => {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
};

export function modernPublicClubhouseTerrainGradeAlpha({
  worldX,
  worldZ,
  centerX,
  centerZ,
  featherYards = 3.5,
}) {
  const x = worldX - centerX;
  const z = worldZ - centerZ;
  // Cheap course-wide reject: the site is tiny relative to the 960 x 640 yd terrain.
  if (x < -27 || x > 43 || z < -18 || z > 59) return 0;
  const feather = Math.max(0.001, featherYards);
  let alpha = 0;
  for (const footprint of MODERN_PUBLIC_CLUBHOUSE_GRADE_RECTS) {
    const outsideX = Math.max(0, Math.abs(x - footprint.cx) - footprint.width / 2);
    const outsideZ = Math.max(0, Math.abs(z - footprint.cz) - footprint.depth / 2);
    const outside = Math.hypot(outsideX, outsideZ);
    if (outside <= 0) return 1;
    if (outside >= feather) continue;
    alpha = Math.max(alpha, smooth01(1 - outside / feather));
  }
  return alpha;
}

export function gradeModernPublicClubhouseTerrain(rawHeight, targetHeight, alpha) {
  const t = clamp01(alpha);
  return rawHeight + (targetHeight - rawHeight) * t;
}
