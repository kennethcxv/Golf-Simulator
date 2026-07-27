import * as THREE from 'three';

const RECT_AREA_TEXTURE_UNIT_THRESHOLD = 32;

/**
 * RectAreaLight adds the two shared LTC samplers to every standard-material
 * program. The complete clubhouse already reaches the common 16-unit WebGL
 * limit, so retain the authored rig on 32-unit GPUs and link equivalent point
 * emitters on constrained hardware. Shell lighting code can keep writing the
 * original RectAreaLight intensity; the proxy forwards every update.
 */
export function applyClubhouseLightingCompatibility(root, renderer) {
  const maxTextureImageUnits = Number(renderer?.capabilities?.maxTextures || 0);
  if (!root?.traverse || maxTextureImageUnits >= RECT_AREA_TEXTURE_UNIT_THRESHOLD) {
    return Object.freeze({
      backend: 'rect-area',
      maxTextureImageUnits,
      replacementCount: 0,
    });
  }

  const areaLights = [];
  root.traverse((object) => {
    if (object.isRectAreaLight && object.parent) areaLights.push(object);
  });

  for (const areaLight of areaLights) {
    const initialIntensity = Number(areaLight.intensity) || 0;
    const initialVisible = areaLight.visible !== false;
    const point = new THREE.PointLight(
      areaLight.color,
      initialIntensity,
      Math.max(Number(areaLight.width) || 1, Number(areaLight.height) || 1) * 4.8,
      2,
    );
    point.name = `${areaLight.name || 'CeilingPanelLight'}_PointFallback`;
    point.position.copy(areaLight.position);
    point.layers.mask = areaLight.layers.mask;
    point.castShadow = false;
    point.visible = initialVisible;
    point.userData = {
      ...areaLight.userData,
      lightingBackend: 'point-fallback',
      compatibilitySource: areaLight.name || null,
    };
    areaLight.parent.add(point);
    Object.defineProperty(areaLight, 'intensity', {
      configurable: true,
      enumerable: true,
      get: () => point.intensity,
      set: (value) => { point.intensity = Number(value) || 0; },
    });
    Object.defineProperty(areaLight, 'visible', {
      configurable: true,
      enumerable: true,
      get: () => false,
      set: (value) => { point.visible = Boolean(value); },
    });
    areaLight.userData.compatibilityFallback = point;
    areaLight.userData.lightingBackend = 'disabled-rect-area';
  }

  return Object.freeze({
    backend: 'point-fallback',
    maxTextureImageUnits,
    replacementCount: areaLights.length,
  });
}

export default applyClubhouseLightingCompatibility;
