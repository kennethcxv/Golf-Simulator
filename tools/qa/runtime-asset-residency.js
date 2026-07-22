// Measure which GLBs and texture allocations are actually resident after a
// normal Continue boot. Run headed and with the deterministic bootstrap:
//   node tools/qa/run-playwright.cjs tools/qa/runtime-asset-residency.js --bootstrap
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = path.resolve(process.env.QA_REPO_ROOT || process.cwd());
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const outFile = process.env.ASSET_RESIDENCY_OUT
    ? path.resolve(repo, process.env.ASSET_RESIDENCY_OUT)
    : path.join(
      path.resolve(process.env.ASSET_RESIDENCY_QA_ROOT
        || path.join(repo, 'qa', 'steam-performance-master-pass', 'assets')),
      'runtime-asset-residency.json',
    );
  const outDir = path.dirname(outFile);
  fs.mkdirSync(outDir, { recursive: true });

  const diagnostics = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      diagnostics.push({ kind: `console:${message.type()}`, message: message.text() });
    }
  });
  page.on('pageerror', (error) => diagnostics.push({ kind: 'pageerror', message: error.message }));
  page.on('requestfailed', (request) => diagnostics.push({
    kind: /ERR_ABORTED/i.test(request.failure()?.errorText || '') ? 'requestaborted' : 'requestfailed',
    message: `${request.url()} (${request.failure()?.errorText || 'unknown'})`,
  }));

  await page.addInitScript(() => {
    const original = globalThis.createImageBitmap?.bind(globalThis);
    globalThis.__qaDecodedImages = [];
    const recordsByBitmap = new WeakMap();
    const originalClose = globalThis.ImageBitmap?.prototype?.close;
    if (originalClose) {
      globalThis.ImageBitmap.prototype.close = function trackedImageBitmapClose() {
        const record = recordsByBitmap.get(this);
        if (record && !record.closed) record.closed = true;
        return originalClose.call(this);
      };
    }
    if (!original) return;
    globalThis.createImageBitmap = async (...args) => {
      const bitmap = await original(...args);
      let sha256 = null;
      const source = args[0];
      // Hash only the exceptional 4K decodes. This keeps the residency probe
      // lightweight while making transient, no-longer-scene-reachable images
      // traceable back to their embedded GLB payload in the static audit.
      if (Math.max(bitmap.width, bitmap.height) >= 4096
        && source instanceof Blob
        && globalThis.crypto?.subtle) {
        const digest = await globalThis.crypto.subtle.digest('SHA-256', await source.arrayBuffer());
        sha256 = [...new Uint8Array(digest)]
          .map((byte) => byte.toString(16).padStart(2, '0'))
          .join('');
      }
      const record = {
        width: bitmap.width,
        height: bitmap.height,
        rgba8Bytes: bitmap.width * bitmap.height * 4,
        sourceBytes: source instanceof Blob ? source.size : null,
        sourceType: source instanceof Blob ? source.type : null,
        sha256,
        closed: false,
      };
      globalThis.__qaDecodedImages.push(record);
      recordsByBitmap.set(bitmap, record);
      return bitmap;
    };
  });

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.getByText('Continue', { exact: true }).click();
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
  }, null, { timeout: 90000 });
  await page.waitForFunction(async () => {
    const app = window.__fw;
    const clubhouse = app?.scene3d?.clubhouse?.();
    if (!clubhouse) return false;
    const clubhouseReady = (!clubhouse.assetsReady || clubhouse.assetsReady())
      && (!clubhouse.deliveryEquipmentReady || clubhouse.deliveryEquipmentReady());
    if (!clubhouseReady) return false;
    if (app.scene3d.assetBarrier) await app.scene3d.assetBarrier();
    return true;
  }, null, { timeout: 120000 });
  await page.waitForTimeout(1500);

  const runtime = await page.evaluate(() => {
    const app = window.__fw;
    app.speedIdx = 0;
    app.scene3d.walk.clearKeys?.();

    const mipBytes = (width, height) => {
      let total = 0;
      let w = Math.max(1, width | 0);
      let h = Math.max(1, height | 0);
      while (true) {
        total += w * h * 4;
        if (w === 1 && h === 1) return total;
        w = Math.max(1, w >> 1);
        h = Math.max(1, h >> 1);
      }
    };

    const textureRecords = new Map();
    const materialRecords = new Map();
    const meshRecords = [];
    const maps = [
      'map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap',
      'emissiveMap', 'alphaMap', 'bumpMap', 'displacementMap',
      'lightMap', 'envMap', 'gradientMap', 'clearcoatMap',
      'clearcoatNormalMap', 'clearcoatRoughnessMap', 'iridescenceMap',
      'iridescenceThicknessMap', 'sheenColorMap', 'sheenRoughnessMap',
      'specularColorMap', 'specularIntensityMap', 'transmissionMap',
      'thicknessMap',
    ];

    app.scene3d.scene.traverse((object) => {
      if (!object.isMesh) return;
      const geometry = object.geometry;
      const triangles = geometry?.index
        ? geometry.index.count / 3
        : (geometry?.attributes?.position?.count || 0) / 3;
      meshRecords.push({
        name: object.name || '(unnamed)',
        visible: object.visible,
        triangles: Math.round(triangles * (object.isInstancedMesh ? object.count : 1)),
        castShadow: !!object.castShadow,
      });

      for (const material of (Array.isArray(object.material) ? object.material : [object.material])) {
        if (!material) continue;
        let materialRecord = materialRecords.get(material.uuid);
        if (!materialRecord) {
          materialRecord = {
            uuid: material.uuid,
            name: material.name || '(unnamed)',
            type: material.type,
            visibleReferences: 0,
            objectNames: [],
          };
          materialRecords.set(material.uuid, materialRecord);
        }
        if (object.visible) materialRecord.visibleReferences += 1;
        if (materialRecord.objectNames.length < 8 && !materialRecord.objectNames.includes(object.name || '(unnamed)')) {
          materialRecord.objectNames.push(object.name || '(unnamed)');
        }

        for (const map of maps) {
          const texture = material[map];
          if (!texture?.isTexture) continue;
          const image = texture.source?.data || texture.image;
          const width = Number(image?.width || image?.videoWidth || 0);
          const height = Number(image?.height || image?.videoHeight || 0);
          let record = textureRecords.get(texture.uuid);
          if (!record) {
            record = {
              uuid: texture.uuid,
              name: texture.name || image?.name || '(unnamed)',
              width,
              height,
              rgba8Bytes: width * height * 4,
              estimatedMipmappedRgba8Bytes: mipBytes(width, height),
              maps: [],
              visibleReferences: 0,
              objectNames: [],
            };
            textureRecords.set(texture.uuid, record);
          }
          if (!record.maps.includes(map)) record.maps.push(map);
          if (object.visible) record.visibleReferences += 1;
          if (record.objectNames.length < 12 && !record.objectNames.includes(object.name || '(unnamed)')) {
            record.objectNames.push(object.name || '(unnamed)');
          }
        }
      }
    });

    const textures = [...textureRecords.values()].sort((a, b) => (
      b.estimatedMipmappedRgba8Bytes - a.estimatedMipmappedRgba8Bytes
      || a.name.localeCompare(b.name)
      || a.uuid.localeCompare(b.uuid)
    ));
    const decodedImages = globalThis.__qaDecodedImages || [];
    const resources = performance.getEntriesByType('resource')
      .filter((entry) => /\.glb(?:$|\?)/i.test(entry.name))
      .map((entry) => ({
        url: entry.name,
        path: new URL(entry.name).pathname.replace(/^\//, ''),
        durationMs: entry.duration,
        transferBytes: entry.transferSize,
        encodedBodyBytes: entry.encodedBodySize,
        decodedBodyBytes: entry.decodedBodySize,
      }))
      .sort((a, b) => b.decodedBodyBytes - a.decodedBodyBytes || a.path.localeCompare(b.path));

    return {
      renderer: {
        calls: app.scene3d.renderer.info.render.calls,
        triangles: app.scene3d.renderer.info.render.triangles,
        geometries: app.scene3d.renderer.info.memory.geometries,
        textures: app.scene3d.renderer.info.memory.textures,
        programs: app.scene3d.renderer.info.programs?.length ?? null,
      },
      scene: {
        meshes: meshRecords.length,
        visibleMeshes: meshRecords.filter((record) => record.visible).length,
        shadowCasters: meshRecords.filter((record) => record.castShadow).length,
        sceneTriangles: meshRecords.reduce((sum, record) => sum + record.triangles, 0),
        materials: materialRecords.size,
        textures: textures.length,
        estimatedTextureRgba8Bytes: textures.reduce((sum, texture) => sum + texture.rgba8Bytes, 0),
        estimatedTextureMipmappedRgba8Bytes: textures.reduce(
          (sum, texture) => sum + texture.estimatedMipmappedRgba8Bytes,
          0,
        ),
      },
      textures,
      decodedImages: {
        count: decodedImages.length,
        rgba8Bytes: decodedImages.reduce((sum, image) => sum + image.rgba8Bytes, 0),
        closedCount: decodedImages.filter((image) => image.closed).length,
        closedRgba8Bytes: decodedImages.reduce(
          (sum, image) => sum + (image.closed ? image.rgba8Bytes : 0),
          0,
        ),
        retainedCount: decodedImages.filter((image) => !image.closed).length,
        retainedRgba8Bytes: decodedImages.reduce(
          (sum, image) => sum + (image.closed ? 0 : image.rgba8Bytes),
          0,
        ),
        oversizedSources: decodedImages.filter((image) => image.sha256),
        dimensions: Object.entries(decodedImages.reduce((counts, image) => {
          const key = `${image.width}x${image.height}`;
          counts[key] = (counts[key] || 0) + 1;
          return counts;
        }, {})).map(([size, count]) => ({ size, count })),
      },
      resources,
    };
  });

  const report = {
    capturedAt: new Date().toISOString(),
    fixture: 'normal Continue from deterministic --bootstrap at 1600x900; all declared clubhouse, delivery, and course assets idle; 1.5s settle',
    runtime,
    diagnostics,
  };
  fs.writeFileSync(outFile, `${JSON.stringify(report, null, 2)}\n`);
  return { ok: diagnostics.every((entry) => entry.kind === 'requestaborted' || entry.kind === 'console:warning'), outFile, ...report };
}
