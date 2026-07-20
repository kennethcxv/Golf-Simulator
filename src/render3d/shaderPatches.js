// Three r185's Poisson denoise shader declares an `index` uniform but GTAOPass
// never changes it from zero. Dynamic vec4 indexing makes ANGLE generate a
// helper with an uninitialised fallback branch (X4000) and emulate an operation
// whose result is always `.x` in this pass. Patch the material instance rather
// than vendor code so dependency upgrades remain straightforward.

const DYNAMIC_NOISE_CHANNEL = 'noiseTexel[index % 4]';

export function patchPoissonDenoiseMaterial(material) {
  if (!material?.fragmentShader?.includes(DYNAMIC_NOISE_CHANNEL)) return false;
  material.fragmentShader = material.fragmentShader.replaceAll(DYNAMIC_NOISE_CHANNEL, 'noiseTexel.x');
  material.needsUpdate = true;
  return true;
}
