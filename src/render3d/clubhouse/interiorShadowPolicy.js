// The clubhouse shell casts the course-scale sun shadow. Contents below the
// roof use GTAO/contact shading and must never enter the sun-shadow atlas.
// Keep this helper independent of Three so async and rebuild paths can enforce
// the same policy without allocating or changing hierarchy ownership.
export function suppressInteriorSunShadows(root) {
  let meshes = 0;
  let suppressed = 0;
  if (!root?.traverse) return { meshes, suppressed };
  root.traverse((object) => {
    if (!object?.isMesh) return;
    meshes += 1;
    if (object.castShadow) {
      object.castShadow = false;
      suppressed += 1;
    }
  });
  return { meshes, suppressed };
}
