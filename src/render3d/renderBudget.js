const CHARACTER_SHADOW_PARTS = new Set([
  'torso',
  'pelvis',
  'head',
  'thigh',
  'calf',
]);

export function characterPartCastsShadow(name) {
  return CHARACTER_SHADOW_PARTS.has(name);
}

// EffectComposer renders the world once for color and GTAOPass renders it again
// for normals. WebGLShadowMap's default auto-update repeats the same directional
// shadow submission during both renders. Disable that implicit path here; the
// course renderer's 10 Hz shadow clock is the sole authority for needsUpdate.
export function prepareFrameShadows(shadowMap) {
  if (!shadowMap) return false;
  shadowMap.autoUpdate = false;
  return true;
}

// Small stock already receives contact definition from GTAO and sits on a shelf
// that casts the useful silhouette. Excluding its merged display mesh from the
// sun map avoids dozens of imperceptible caster submissions.
export function configureAmbientStockShadow(mesh) {
  if (!mesh) return mesh;
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  return mesh;
}

const INTERIOR_REFLECTION_MOVE_SQ = 0.15 * 0.15;
const INTERIOR_REFLECTION_QUATERNION_DOT = Math.cos(0.03 / 2);

export function shouldRefreshPlanarReflection({
  overrideMaterial = false,
  inside = false,
  now = 0,
  lastAt = -Infinity,
  positionDeltaSq = Infinity,
  quaternionDot = 0,
} = {}) {
  // GTAO only needs surface normals and depth. Recursively rendering color into
  // the planar mirror while an override material is active cannot affect it.
  if (overrideMaterial) return false;
  if (!inside) return true;
  return now - lastAt >= 0.5
    || positionDeltaSq >= INTERIOR_REFLECTION_MOVE_SQ
    || Math.abs(quaternionDot) <= INTERIOR_REFLECTION_QUATERNION_DOT;
}
