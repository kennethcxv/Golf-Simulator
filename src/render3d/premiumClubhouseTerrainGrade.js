const METERS_TO_YARDS = 1.0936133;

// The authored Course-5 site runs from the rear service/terrace edge at +26 m
// through the full approach at -86 m. A soft eight-metre earthwork shoulder
// joins that engineered platform back into the course instead of exposing a
// hard rectangular terrain seam.
export const PREMIUM_CLUBHOUSE_GRADE_BOUNDS_METERS = Object.freeze({
  minX: -50,
  maxX: 50,
  minY: -86,
  maxY: 26,
  shoulder: 8,
});

export function premiumClubhouseTerrainGradeAlpha({
  worldX,
  worldZ,
  authoredOriginX,
  authoredOriginZ,
  bounds = PREMIUM_CLUBHOUSE_GRADE_BOUNDS_METERS,
} = {}) {
  if (![worldX, worldZ, authoredOriginX, authoredOriginZ].every(Number.isFinite)) return 0;
  const localX = (worldX - authoredOriginX) / METERS_TO_YARDS;
  // Blender's +Y exports into Three.js -Z.
  const localY = -(worldZ - authoredOriginZ) / METERS_TO_YARDS;
  const outsideX = Math.max(bounds.minX - localX, 0, localX - bounds.maxX);
  const outsideY = Math.max(bounds.minY - localY, 0, localY - bounds.maxY);
  const distance = Math.hypot(outsideX, outsideY);
  if (distance <= 0) return 1;
  if (distance >= bounds.shoulder) return 0;
  const t = distance / bounds.shoulder;
  const smooth = t * t * (3 - 2 * t);
  return 1 - smooth;
}

export function gradePremiumClubhouseTerrain(rawHeight, targetHeight, alpha) {
  if (![rawHeight, targetHeight, alpha].every(Number.isFinite)) return rawHeight;
  const blend = Math.max(0, Math.min(1, alpha));
  return rawHeight + (targetHeight - rawHeight) * blend;
}
