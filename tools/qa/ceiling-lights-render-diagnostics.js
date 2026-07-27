async (page) => {
  const BASE = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const diagnostics = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      diagnostics.push(`console:${message.type()}: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => diagnostics.push(`pageerror:${error.message}`));
  await page.goto(BASE);
  await page.getByText('Continue', { exact: true }).click();
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 45000 });
  return page.evaluate(() => {
    const app = window.__fw;
    const renderer = app.scene3d.renderer;
    const gl = renderer.getContext();
    app.scene3d.clubhouse().setOrganicWalkins(false);
    app.scene3d.clubhouse().clearWalkins();
    const effectivelyVisible = (object) => {
      let cursor = object;
      while (cursor) {
        if (cursor.visible === false) return false;
        cursor = cursor.parent;
      }
      return true;
    };
    const lights = [];
    const materials = new Map();
    app.scene3d.scene.traverse((object) => {
      if (object.isLight) {
        lights.push({
          name: object.name,
          type: object.type,
          intensity: object.intensity,
          castShadow: object.castShadow,
          hasCookieMap: !!object.map,
          effectivelyVisible: effectivelyVisible(object),
        });
      }
      if (!object.isMesh || !effectivelyVisible(object)) return;
      const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of objectMaterials) {
        if (!material || materials.has(material.uuid)) continue;
        const textureKeys = Object.entries(material)
          .filter(([, value]) => value?.isTexture)
          .map(([key]) => key)
          .sort();
        materials.set(material.uuid, {
          name: material.name,
          type: material.type,
          textureCount: textureKeys.length,
          textureKeys,
          firstObject: object.name,
        });
      }
    });
    const materialRows = [...materials.values()].sort((a, b) => b.textureCount - a.textureCount);
    return {
      ok: true,
      maxTextureImageUnits: gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS),
      maxCombinedTextureImageUnits: gl.getParameter(gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS),
      shadowMapEnabled: renderer.shadowMap.enabled,
      shadowMapType: renderer.shadowMap.type,
      lightCount: lights.length,
      effectiveLightCount: lights.filter((light) => light.effectivelyVisible && light.intensity > 0).length,
      visibleLightsByType: Object.fromEntries(Object.entries(lights
        .filter((light) => light.effectivelyVisible)
        .reduce((counts, light) => {
          counts[light.type] = (counts[light.type] || 0) + 1;
          return counts;
        }, {})).sort()),
      visibleShadowLights: lights.filter((light) => light.effectivelyVisible && light.castShadow),
      effectiveShadowLights: lights.filter((light) => (
        light.effectivelyVisible && light.intensity > 0 && light.castShadow
      )),
      materialCount: materialRows.length,
      texturedMaterials: materialRows.filter((material) => material.textureCount > 0).slice(0, 30),
      maxTextureMaterials: materialRows.slice(0, 30),
      programCount: renderer.info.programs?.length || 0,
    };
  }).then((result) => ({ ...result, diagnostics }));
}
