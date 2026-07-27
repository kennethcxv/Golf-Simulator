// The clubhouse shell casts the course-scale sun shadow. Contents below the
// roof use GTAO/contact shading and must never enter the sun-shadow atlas.
// Keep this helper independent of Three so async and rebuild paths can enforce
// the same policy without allocating or changing hierarchy ownership.
export function suppressInteriorSunShadows(root) {
  // ===== SPIKE ARM 2 — THROWAWAY. Inverts this function's entire purpose. =====
  // Instead of stripping castShadow, turn interior meshes into shadow casters AND
  // receivers so the sun can shade the room. This is the crudest change that works:
  // interior.add is the single funnel every dressing system flows through, so
  // flipping it here reaches async kit models and rebuild paths too. The harness
  // reports interiorCasters/interiorReceivers so coverage is measured, not assumed.
  // Revert with `git checkout` — this must never reach the feature branch.
  let meshes = 0;
  let enabled = 0;
  if (!root?.traverse) return { meshes, suppressed: 0, enabled };
  root.traverse((object) => {
    if (!object?.isMesh) return;
    meshes += 1;
    if (!object.castShadow || !object.receiveShadow) enabled += 1;
    object.castShadow = true;
    object.receiveShadow = true;
  });
  return { meshes, suppressed: 0, enabled };
}
