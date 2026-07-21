async (page) => {
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8469/';
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.getByText('Continue', { exact: true }).click();
  await page.waitForFunction(async () => {
    const production = window.__fw?.scene3d?.clubhouse?.()?.sheet06Production;
    if (!production) return false;
    try { await production.ready; } catch { return false; }
    return production.diagnostics().activationStatus === 'active';
  }, null, { timeout: 90000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
  }, null, { timeout: 90000 });
  await page.waitForTimeout(1200);

  return page.evaluate(() => {
    const scene = window.__fw.scene3d.scene;
    const renderer = window.__fw.scene3d.renderer;
    const rows = [];
    const textures = new Map();
    const captureMaterialTextures = (material) => {
      if (!material || typeof material !== 'object') return;
      for (const value of Object.values(material)) {
        if (value?.isTexture && value.uuid) textures.set(value.uuid, value);
      }
    };
    const visit = (node, inheritedVisible, ancestry) => {
      const effectiveVisible = inheritedVisible && node.visible !== false;
      const nextAncestry = [...ancestry, node];
      if (effectiveVisible && node.isMesh) {
        const materials = (Array.isArray(node.material) ? node.material : [node.material]).filter(Boolean);
        for (const material of materials) captureMaterialTextures(material);
        const sheetRoot = [...nextAncestry].reverse().find((entry) => /^SHEET06_ASSET_/.test(entry.name));
        const constructionNode = [...nextAncestry].reverse().find((entry) => (
          entry.userData?.construction_category
          || entry.userData?.constructionFinishAuthority
          || entry.userData?.constructionLightingAuthority
        ));
        if (sheetRoot || constructionNode) {
          const geometry = node.geometry;
          const baseTriangles = geometry?.index?.count
            ? geometry.index.count / 3
            : (geometry?.attributes?.position?.count || 0) / 3;
          const instanceCount = node.isInstancedMesh ? node.count : 1;
          rows.push({
            name: node.name,
            root: sheetRoot?.name || 'DIRECT_CONSTRUCTION_ASSET',
            category: constructionNode?.userData?.construction_category || null,
            selectedVariant: node.userData?.sheet06SelectedVariant || null,
            instanced: Boolean(node.isInstancedMesh),
            instanceCount,
            materialSlots: materials.length,
            materialTypes: [...new Set(materials.map((material) => material.type))],
            physicalFeatures: materials.map((material) => ({
              name: material.name,
              clearcoat: material.clearcoat ?? null,
              transmission: material.transmission ?? null,
              roughness: material.roughness ?? null,
              metalness: material.metalness ?? null,
              transparent: Boolean(material.transparent),
              opacity: material.opacity ?? null,
              depthWrite: Boolean(material.depthWrite),
              side: material.side ?? null,
            })),
            geometryGroups: geometry?.groups?.length || 0,
            triangles: Math.round(baseTriangles * instanceCount),
            castShadow: Boolean(node.castShadow),
          });
        }
      }
      for (const child of node.children || []) visit(child, effectiveVisible, nextAncestry);
    };
    visit(scene, true, []);

    // Three.js exposes resident texture count but not allocated bytes. Estimate
    // the live scene allocation deterministically from image dimensions, RGBA8
    // storage, depth, and the standard 4/3 mip-chain factor. Compressed mipmaps
    // use their actual byteLength when available.
    const textureRecords = [...textures.values()].map((texture) => {
      const image = texture.image || texture.source?.data || null;
      const mipmaps = Array.isArray(texture.mipmaps) ? texture.mipmaps : [];
      const compressedBytes = mipmaps.reduce((sum, mip) => sum + (mip?.data?.byteLength || 0), 0);
      const width = Number(image?.videoWidth || image?.naturalWidth || image?.width || 0);
      const height = Number(image?.videoHeight || image?.naturalHeight || image?.height || 0);
      const depth = Number(image?.depth || 1);
      const baseBytes = compressedBytes || Math.max(0, width * height * depth * 4);
      const estimatedBytes = compressedBytes || Math.round(baseBytes * (texture.generateMipmaps === false ? 1 : 4 / 3));
      return { name: texture.name || texture.uuid, width, height, depth, estimatedBytes };
    });

    const byRoot = {};
    for (const row of rows) {
      const key = `${row.root}|${row.category || 'uncategorized'}`;
      byRoot[key] ||= { meshes: 0, instances: 0, materialSlots: 0, geometryGroups: 0, triangles: 0, shadowCasters: 0 };
      byRoot[key].meshes += 1;
      byRoot[key].instances += row.instanceCount;
      byRoot[key].materialSlots += row.materialSlots;
      byRoot[key].geometryGroups += row.geometryGroups;
      byRoot[key].triangles += row.triangles;
      byRoot[key].shadowCasters += row.castShadow ? 1 : 0;
    }
    return {
      ok: true,
      diagnostics: window.__fw.scene3d.clubhouse().sheet06Production.diagnostics(),
      totals: {
        meshes: rows.length,
        instances: rows.reduce((sum, row) => sum + row.instanceCount, 0),
        materialSlots: rows.reduce((sum, row) => sum + row.materialSlots, 0),
        geometryGroups: rows.reduce((sum, row) => sum + row.geometryGroups, 0),
        triangles: rows.reduce((sum, row) => sum + row.triangles, 0),
        shadowCasters: rows.filter((row) => row.castShadow).length,
        textureCount: textureRecords.length,
        textureMemoryBytesEstimate: textureRecords.reduce((sum, texture) => sum + texture.estimatedBytes, 0),
        rendererResidentTextureCount: renderer.info?.memory?.textures ?? null,
      },
      byRoot,
      textures: textureRecords,
      rows,
    };
  });
}
