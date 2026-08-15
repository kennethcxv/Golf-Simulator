async (page) => {
  // Read-only runtime diagnosis for the Asset 59 one-metre floor grid. All
  // scene/material mutations below are temporary presentation probes and are
  // restored before this function returns.
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = path.resolve(process.env.QA_REPO_ROOT || process.cwd());
  const out = process.env.SHEET06_FLOOR_GRID_OUT
    ? path.resolve(repo, process.env.SHEET06_FLOOR_GRID_OUT)
    : path.join(
      repo,
      'qa',
      'assets_51_100_master',
      'sheet_06',
      'diagnostics',
      'floor_grid_runtime',
    );
  fs.mkdirSync(out, { recursive: true });

  const diagnostics = [];
  page.on('console', (message) => {
    if (message.type() === 'warning' || message.type() === 'error') {
      diagnostics.push({ kind: `console:${message.type()}`, message: message.text() });
    }
  });
  page.on('pageerror', (error) => diagnostics.push({ kind: 'pageerror', message: error.message }));
  page.on('requestfailed', (request) => diagnostics.push({
    kind: 'requestfailed',
    message: `${request.url()} (${request.failure()?.errorText || 'unknown'})`,
  }));

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('http://localhost:8457/', { waitUntil: 'domcontentloaded' });
  await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.scene, null, { timeout: 90000 });
  await page.waitForFunction(async () => {
    const clubhouse = window.__fw?.scene3d?.clubhouse?.();
    const production = typeof clubhouse?.sheet06Production === 'function'
      ? clubhouse.sheet06Production()
      : clubhouse?.sheet06Production;
    if (!production) return false;
    try { await production.ready; } catch { return false; }
    return production.diagnostics?.().activationStatus === 'active';
  }, null, { timeout: 90000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
  }, null, { timeout: 90000 });

  async function setArchitectureFloor(restored) {
    const before = await page.evaluate(() => {
      const clubhouse = window.__fw.scene3d.clubhouse();
      const production = typeof clubhouse.sheet06Production === 'function'
        ? clubhouse.sheet06Production()
        : clubhouse.sheet06Production;
      return production.diagnostics().stateApplications;
    });
    await page.evaluate(async (floorRestored) => {
      const app = window.__fw;
      const clubhouse = app.scene3d.clubhouse();
      const R = await import(new URL('src/sim/clubhouseRestoration.js', document.baseURI).href);
      for (const component of ['shell', 'porch', 'windows', 'panels', 'trim', 'ceiling', 'floor']) {
        const result = R.setArchitectureComponentRestored(
          app.state,
          component,
          component === 'floor' ? floorRestored : true,
        );
        if (result?.ok !== true) throw new Error(`Could not set ${component}: ${JSON.stringify(result)}`);
      }
      app.state.shop.reno.grime.fill(0);
      for (const clutter of app.state.shop.reno.clutter || []) clutter.cleared = true;
      const day = Math.floor(app.state.clock.minutes / 1440) * 1440;
      app.state.clock.minutes = day + 14 * 60;
      app.state.weather.today = {
        tempHiF: 72,
        tempLoF: 54,
        rainIn: 0,
        humidity: 0.48,
        windMph: 5,
      };
      app.state.weather.locked = true;
      app.scene3d.applyTimeWeather?.(14 * 60, app.state.weather);
      clubhouse.rebuildReno();
    }, restored);
    await page.waitForFunction((prior) => {
      const clubhouse = window.__fw?.scene3d?.clubhouse?.();
      const production = typeof clubhouse?.sheet06Production === 'function'
        ? clubhouse.sheet06Production()
        : clubhouse?.sheet06Production;
      return production?.diagnostics?.().stateApplications > prior;
    }, before, { timeout: 15000 });
    await page.waitForFunction((expected) => {
      const app = window.__fw;
      const clubhouse = app?.scene3d?.clubhouse?.();
      const production = typeof clubhouse?.sheet06Production === 'function'
        ? clubhouse.sheet06Production()
        : clubhouse?.sheet06Production;
      const damage = production?.getAssemblyRoot?.(60);
      return app?.state?.shop?.reno?.architecture?.components?.floor?.restored === expected
        && damage?.visible === !expected;
    }, restored, { timeout: 15000 });
    await page.waitForTimeout(700);
  }

  const gridCamera = {
    id: 'grid-overview',
    x: -0.35,
    z: 2.4,
    tx: -0.35,
    tz: -2.45,
    pitch: -0.55,
  };
  const damageCameras = [
    {
      id: 'damage-west-entry-north-approach',
      x: -4.15,
      z: 4.75,
      tx: -4.15,
      tz: 2.05,
      pitch: -0.58,
    },
    {
      id: 'damage-west-entry-diagonal-east',
      x: -1.65,
      z: 4.55,
      tx: -4.15,
      tz: 2.05,
      pitch: -0.56,
    },
    {
      id: 'damage-west-entry-diagonal-west',
      x: -6.45,
      z: 4.45,
      tx: -4.15,
      tz: 2.05,
      pitch: -0.56,
    },
    {
      id: 'damage-west-entry-close',
      x: -4.15,
      z: 4.05,
      tx: -4.15,
      tz: 2.05,
      pitch: -0.68,
    },
  ];

  async function setCamera(camera) {
    await page.evaluate((shot) => {
      const app = window.__fw;
      const clubhouse = app.scene3d.clubhouse();
      const walk = app.scene3d.walk;
      const origin = clubhouse.interior.position;
      walk.clearKeys?.();
      walk.state.x = origin.x + shot.x;
      walk.state.z = origin.z + shot.z;
      walk.state.yaw = Math.atan2(-(shot.tx - shot.x), -(shot.tz - shot.z));
      walk.state.pitch = shot.pitch;
    }, camera);
    await page.waitForTimeout(700);
  }

  const screenshots = {};
  async function capture(key) {
    const file = path.join(out, `${key}.png`);
    await page.screenshot({ path: file });
    screenshots[key] = file;
    return file;
  }

  await setArchitectureFloor(true);
  await setCamera(gridCamera);

  const structural = await page.evaluate(async () => {
    const THREE = await import('three');
    const app = window.__fw;
    const scene = app.scene3d.scene;
    const clubhouse = app.scene3d.clubhouse();
    const production = typeof clubhouse.sheet06Production === 'function'
      ? clubhouse.sheet06Production()
      : clubhouse.sheet06Production;
    const root51 = production.getRoot(51);
    const root59 = production.getAssemblyRoot(59);
    const root60 = production.getAssemblyRoot(60);
    const floor = root59?.getObjectByName?.('SHEET06_ASSET_59_NON_STOCKROOM_FLOOR_INSTANCES');
    if (!floor?.isInstancedMesh) throw new Error('Asset 59 production InstancedMesh was not found.');
    scene.updateMatrixWorld(true);
    floor.geometry.computeBoundingBox();

    const pathOf = (object) => {
      const values = [];
      for (let cursor = object; cursor; cursor = cursor.parent) {
        values.push(cursor.name || cursor.type || '(anonymous)');
      }
      return values.reverse().join('/');
    };
    const effectiveVisible = (object) => {
      for (let cursor = object; cursor; cursor = cursor.parent) {
        if (cursor.visible === false) return false;
      }
      return true;
    };
    const worldBox = (object) => {
      try {
        const box = new THREE.Box3().setFromObject(object, true);
        if (box.isEmpty()) return null;
        return { min: box.min.toArray(), max: box.max.toArray() };
      } catch (_) {
        return null;
      }
    };

    const geometry = floor.geometry;
    const position = geometry.getAttribute('position');
    const normal = geometry.getAttribute('normal');
    const uv = geometry.getAttribute('uv');
    const index = geometry.index;
    const box = geometry.boundingBox;
    const topTolerance = Math.max(1e-7, (box.max.y - box.min.y) * 1e-5);
    const topVertices = [];
    const allNormals = [];
    let maximumTopNormalDeviationDegrees = 0;
    for (let i = 0; i < position.count; i += 1) {
      const n = normal ? [normal.getX(i), normal.getY(i), normal.getZ(i)] : null;
      if (n) allNormals.push(n);
      if (Math.abs(position.getY(i) - box.max.y) > topTolerance) continue;
      if (n) {
        const length = Math.hypot(...n) || 1;
        const degrees = Math.acos(Math.min(1, Math.max(-1, n[1] / length))) * 180 / Math.PI;
        maximumTopNormalDeviationDegrees = Math.max(maximumTopNormalDeviationDegrees, degrees);
      }
      topVertices.push({
        position: [position.getX(i), position.getY(i), position.getZ(i)],
        normal: n,
        uv: uv ? [uv.getX(i), uv.getY(i)] : null,
      });
    }
    const triangleCount = index ? index.count / 3 : position.count / 3;
    let coplanarTopTriangleCount = 0;
    let upwardTopTriangleCount = 0;
    let downwardTopTriangleCount = 0;
    const topFaceVertexNormals = [];
    const duplicateTriangleKeys = new Map();
    for (let triangle = 0; triangle < triangleCount; triangle += 1) {
      const ids = [0, 1, 2].map((corner) => (
        index ? index.getX(triangle * 3 + corner) : triangle * 3 + corner
      ));
      const points = ids.map((i) => new THREE.Vector3(
        position.getX(i),
        position.getY(i),
        position.getZ(i),
      ));
      const key = points
        .map((p) => p.toArray().map((v) => v.toFixed(7)).join(','))
        .sort()
        .join('|');
      duplicateTriangleKeys.set(key, (duplicateTriangleKeys.get(key) || 0) + 1);
      if (points.every((point) => Math.abs(point.y - box.max.y) <= topTolerance)) {
        coplanarTopTriangleCount += 1;
        if (normal) {
          for (const id of ids) {
            topFaceVertexNormals.push([
              normal.getX(id),
              normal.getY(id),
              normal.getZ(id),
            ]);
          }
        }
        const face = points[1].clone().sub(points[0]).cross(points[2].clone().sub(points[0]));
        if (face.y > 0) upwardTopTriangleCount += 1;
        else if (face.y < 0) downwardTopTriangleCount += 1;
      }
    }

    const localBox = geometry.boundingBox;
    const localCorners = [];
    for (const x of [localBox.min.x, localBox.max.x]) {
      for (const y of [localBox.min.y, localBox.max.y]) {
        for (const z of [localBox.min.z, localBox.max.z]) localCorners.push(new THREE.Vector3(x, y, z));
      }
    }
    const instanceMatrix = new THREE.Matrix4();
    const worldMatrix = new THREE.Matrix4();
    const instanceRecords = [];
    for (let i = 0; i < floor.count; i += 1) {
      floor.getMatrixAt(i, instanceMatrix);
      worldMatrix.multiplyMatrices(floor.matrixWorld, instanceMatrix);
      const points = localCorners.map((point) => point.clone().applyMatrix4(worldMatrix));
      const instanceBox = new THREE.Box3().setFromPoints(points);
      const p = new THREE.Vector3();
      const q = new THREE.Quaternion();
      const s = new THREE.Vector3();
      instanceMatrix.decompose(p, q, s);
      instanceRecords.push({
        index: i,
        localPosition: p.toArray(),
        localQuaternion: q.toArray(),
        localScale: s.toArray(),
        determinant: instanceMatrix.determinant(),
        worldBounds: { min: instanceBox.min.toArray(), max: instanceBox.max.toArray() },
      });
    }

    // Region tiling is computed in float32 instance matrices. Treat sub-10 um
    // edge error as numerical contact, not a physical overlap/gap.
    const adjacencyEpsilon = 1e-5;
    const overlapSummary = {
      exactInteriorOverlaps: 0,
      touchingEdgePairs: 0,
      minimumPositiveGap: null,
      maximumInteriorOverlap: 0,
    };
    for (let i = 0; i < instanceRecords.length; i += 1) {
      const a = instanceRecords[i].worldBounds;
      for (let j = i + 1; j < instanceRecords.length; j += 1) {
        const b = instanceRecords[j].worldBounds;
        const overlapX = Math.min(a.max[0], b.max[0]) - Math.max(a.min[0], b.min[0]);
        const overlapZ = Math.min(a.max[2], b.max[2]) - Math.max(a.min[2], b.min[2]);
        if (overlapX > adjacencyEpsilon && overlapZ > adjacencyEpsilon) {
          overlapSummary.exactInteriorOverlaps += 1;
          overlapSummary.maximumInteriorOverlap = Math.max(
            overlapSummary.maximumInteriorOverlap,
            Math.min(overlapX, overlapZ),
          );
        } else if ((Math.abs(overlapX) <= adjacencyEpsilon && overlapZ > adjacencyEpsilon)
          || (Math.abs(overlapZ) <= adjacencyEpsilon && overlapX > adjacencyEpsilon)) {
          overlapSummary.touchingEdgePairs += 1;
        } else {
          const gapX = overlapX < 0 ? -overlapX : 0;
          const gapZ = overlapZ < 0 ? -overlapZ : 0;
          const gap = Math.hypot(gapX, gapZ);
          if (gap > 0 && (overlapSummary.minimumPositiveGap === null
            || gap < overlapSummary.minimumPositiveGap)) overlapSummary.minimumPositiveGap = gap;
        }
      }
    }

    const material = Array.isArray(floor.material) ? floor.material[0] : floor.material;
    const map = material?.map || null;
    const textureImage = map?.source?.data || map?.image || null;
    let texturePixels = null;
    if (textureImage && textureImage.width && textureImage.height) {
      try {
        const canvas = new OffscreenCanvas(textureImage.width, textureImage.height);
        const context = canvas.getContext('2d', { willReadFrequently: true });
        context.drawImage(textureImage, 0, 0);
        const pixels = context.getImageData(0, 0, textureImage.width, textureImage.height).data;
        const lumas = [];
        let horizontalEdgeDeltaSum = 0;
        let horizontalEdgeDeltaMax = 0;
        let verticalEdgeDeltaSum = 0;
        let verticalEdgeDeltaMax = 0;
        for (let y = 0; y < textureImage.height; y += 1) {
          for (let x = 0; x < textureImage.width; x += 1) {
            const offset = (y * textureImage.width + x) * 4;
            lumas.push(0.2126 * pixels[offset] + 0.7152 * pixels[offset + 1] + 0.0722 * pixels[offset + 2]);
          }
        }
        for (let x = 0; x < textureImage.width; x += 1) {
          const top = x * 4;
          const bottom = ((textureImage.height - 1) * textureImage.width + x) * 4;
          const delta = Math.max(...[0, 1, 2].map((c) => Math.abs(pixels[top + c] - pixels[bottom + c])));
          horizontalEdgeDeltaSum += delta;
          horizontalEdgeDeltaMax = Math.max(horizontalEdgeDeltaMax, delta);
        }
        for (let y = 0; y < textureImage.height; y += 1) {
          const left = (y * textureImage.width) * 4;
          const right = (y * textureImage.width + textureImage.width - 1) * 4;
          const delta = Math.max(...[0, 1, 2].map((c) => Math.abs(pixels[left + c] - pixels[right + c])));
          verticalEdgeDeltaSum += delta;
          verticalEdgeDeltaMax = Math.max(verticalEdgeDeltaMax, delta);
        }
        const mean = lumas.reduce((sum, value) => sum + value, 0) / lumas.length;
        const variance = lumas.reduce((sum, value) => sum + (value - mean) ** 2, 0) / lumas.length;
        texturePixels = {
          width: textureImage.width,
          height: textureImage.height,
          luma: {
            min: Math.min(...lumas),
            max: Math.max(...lumas),
            mean,
            standardDeviation: Math.sqrt(variance),
          },
          oppositeEdgeDelta: {
            topBottomMeanMaxChannel: horizontalEdgeDeltaSum / textureImage.width,
            topBottomMaximumMaxChannel: horizontalEdgeDeltaMax,
            leftRightMeanMaxChannel: verticalEdgeDeltaSum / textureImage.height,
            leftRightMaximumMaxChannel: verticalEdgeDeltaMax,
          },
        };
      } catch (error) {
        texturePixels = { error: error.message };
      }
    }

    const namedLayers = [];
    scene.traverse((object) => {
      if (!object.isMesh || !object.geometry) return;
      const objectPath = pathOf(object);
      const bounds = worldBox(object);
      const materialValue = Array.isArray(object.material) ? object.material[0] : object.material;
      const relevantName = /floor|foundation|slab|grime|dirt|asset_59|asset_60/i.test(objectPath);
      const nearFloor = bounds && Math.abs(bounds.max[1] - instanceRecords[0].worldBounds.max[1]) < 0.08
        && bounds.max[0] - bounds.min[0] > 1
        && bounds.max[2] - bounds.min[2] > 1;
      if (!relevantName && !nearFloor) return;
      namedLayers.push({
        name: object.name || '',
        path: objectPath,
        visible: object.visible,
        effectiveVisible: effectiveVisible(object),
        isInstancedMesh: object.isInstancedMesh === true,
        count: object.isInstancedMesh ? object.count : 1,
        bounds,
        material: {
          name: materialValue?.name || '',
          type: materialValue?.type || '',
          map: materialValue?.map?.name || null,
          roughness: materialValue?.roughness ?? null,
        },
      });
    });

    const duplicateTriangleMultiplicity = [...duplicateTriangleKeys.values()];
    const topFaceNormalCounts = new Map();
    for (const value of topFaceVertexNormals) {
      const key = value.map((component) => component.toFixed(6)).join(',');
      topFaceNormalCounts.set(key, (topFaceNormalCounts.get(key) || 0) + 1);
    }
    const uniqueScales = [...new Set(instanceRecords.map((record) => (
      record.localScale.map((value) => value.toFixed(9)).join(',')
    )))];
    const uniqueQuaternions = [...new Set(instanceRecords.map((record) => (
      record.localQuaternion.map((value) => value.toFixed(9)).join(',')
    )))];
    return {
      production: production.diagnostics(),
      roots: {
        asset51: root51 ? { name: root51.name, bounds: worldBox(root51) } : null,
        asset59: root59 ? { name: root59.name, bounds: worldBox(root59) } : null,
        asset60: root60 ? { name: root60.name, bounds: worldBox(root60), visible: root60.visible } : null,
      },
      renderer: {
        shadowsEnabled: app.scene3d.renderer.shadowMap.enabled,
        shadowType: app.scene3d.renderer.shadowMap.type,
        gtaoEnabled: app.scene3d.post.gtao.enabled,
        gtaoBlendIntensity: app.scene3d.post.gtao.blendIntensity,
        gtaoWidth: app.scene3d.post.gtao.width ?? null,
        gtaoHeight: app.scene3d.post.gtao.height ?? null,
        cameraNear: app.scene3d.camera.near,
        cameraFar: app.scene3d.camera.far,
      },
      mesh: {
        name: floor.name,
        count: floor.count,
        castShadow: floor.castShadow,
        receiveShadow: floor.receiveShadow,
        matrixWorld: floor.matrixWorld.toArray(),
        geometry: {
          name: geometry.name,
          indexed: !!index,
          vertexCount: position.count,
          indexCount: index?.count ?? null,
          triangleCount,
          localBounds: { min: box.min.toArray(), max: box.max.toArray() },
          attributes: Object.fromEntries(Object.entries(geometry.attributes).map(
            ([name, attribute]) => [name, { itemSize: attribute.itemSize, count: attribute.count, normalized: attribute.normalized }],
          )),
          groups: geometry.groups,
          topSurface: {
            topVertexCount: topVertices.length,
            maximumVertexNormalDeviationFromUpDegrees: maximumTopNormalDeviationDegrees,
            coplanarTopTriangleCount,
            upwardTopTriangleCount,
            downwardTopTriangleCount,
            topFaceVertexNormalCounts: Object.fromEntries(topFaceNormalCounts),
            duplicateTriangleKeyCount: duplicateTriangleMultiplicity.filter((count) => count > 1).length,
            maximumDuplicateTriangleMultiplicity: Math.max(...duplicateTriangleMultiplicity),
            uvMin: uv ? [
              Math.min(...topVertices.map((entry) => entry.uv[0])),
              Math.min(...topVertices.map((entry) => entry.uv[1])),
            ] : null,
            uvMax: uv ? [
              Math.max(...topVertices.map((entry) => entry.uv[0])),
              Math.max(...topVertices.map((entry) => entry.uv[1])),
            ] : null,
          },
        },
        instances: {
          count: instanceRecords.length,
          uniqueScales,
          uniqueQuaternions,
          minimumDeterminant: Math.min(...instanceRecords.map((record) => record.determinant)),
          maximumDeterminant: Math.max(...instanceRecords.map((record) => record.determinant)),
          overlapSummary,
          records: instanceRecords,
        },
        material: {
          name: material?.name || '',
          type: material?.type || '',
          color: material?.color?.getHexString?.() || null,
          roughness: material?.roughness ?? null,
          metalness: material?.metalness ?? null,
          aoMap: material?.aoMap?.name || null,
          normalMap: material?.normalMap?.name || null,
          lightMap: material?.lightMap?.name || null,
          map: map ? {
            name: map.name || '',
            colorSpace: map.colorSpace || null,
            wrapS: map.wrapS,
            wrapT: map.wrapT,
            repeat: map.repeat?.toArray?.() || null,
            offset: map.offset?.toArray?.() || null,
            center: map.center?.toArray?.() || null,
            rotation: map.rotation,
            flipY: map.flipY,
            anisotropy: map.anisotropy,
            minFilter: map.minFilter,
            magFilter: map.magFilter,
            generateMipmaps: map.generateMipmaps,
            imageWidth: textureImage?.width ?? null,
            imageHeight: textureImage?.height ?? null,
          } : null,
        },
      },
      texturePixels,
      namedLayers,
    };
  });

  await capture('01-normal-composer');

  await page.evaluate(() => { window.__fw.scene3d.post.gtao.enabled = false; });
  await page.waitForTimeout(700);
  await capture('02-gtao-disabled');
  await page.evaluate(() => { window.__fw.scene3d.post.gtao.enabled = true; });

  await page.evaluate(() => {
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    const production = typeof clubhouse.sheet06Production === 'function'
      ? clubhouse.sheet06Production()
      : clubhouse.sheet06Production;
    const mesh = production.getAssemblyRoot(59)
      .getObjectByName('SHEET06_ASSET_59_NON_STOCKROOM_FLOOR_INSTANCES');
    mesh.userData.floorGridProbeOriginalReceiveShadow = mesh.receiveShadow;
    mesh.receiveShadow = false;
  });
  await page.waitForTimeout(700);
  await capture('03-floor-receive-shadow-disabled');
  await page.evaluate(() => {
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    const production = typeof clubhouse.sheet06Production === 'function'
      ? clubhouse.sheet06Production()
      : clubhouse.sheet06Production;
    const mesh = production.getAssemblyRoot(59)
      .getObjectByName('SHEET06_ASSET_59_NON_STOCKROOM_FLOOR_INSTANCES');
    mesh.receiveShadow = mesh.userData.floorGridProbeOriginalReceiveShadow;
    delete mesh.userData.floorGridProbeOriginalReceiveShadow;
    app.scene3d.renderer.shadowMap.needsUpdate = true;
  });

  const foundationMutation = await page.evaluate(() => {
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    const production = typeof clubhouse.sheet06Production === 'function'
      ? clubhouse.sheet06Production()
      : clubhouse.sheet06Production;
    const root51 = production.getRoot(51);
    const foundation = root51?.getObjectByName?.('MESH_FoundationPlinth')
      || root51?.getObjectByName?.('FoundationPlinth');
    if (!foundation) return { found: false };
    foundation.userData.floorGridProbeOriginalVisible = foundation.visible;
    foundation.visible = false;
    return { found: true, name: foundation.name };
  });
  await page.waitForTimeout(700);
  await capture('04-asset51-foundation-hidden');
  await page.evaluate(() => {
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    const production = typeof clubhouse.sheet06Production === 'function'
      ? clubhouse.sheet06Production()
      : clubhouse.sheet06Production;
    const root51 = production.getRoot(51);
    const foundation = root51?.getObjectByName?.('MESH_FoundationPlinth')
      || root51?.getObjectByName?.('FoundationPlinth');
    if (!foundation) return;
    foundation.visible = foundation.userData.floorGridProbeOriginalVisible;
    delete foundation.userData.floorGridProbeOriginalVisible;
  });

  await page.evaluate(() => {
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    const production = typeof clubhouse.sheet06Production === 'function'
      ? clubhouse.sheet06Production()
      : clubhouse.sheet06Production;
    const mesh = production.getAssemblyRoot(59)
      .getObjectByName('SHEET06_ASSET_59_NON_STOCKROOM_FLOOR_INSTANCES');
    mesh.userData.floorGridProbeOriginalMaterial = mesh.material;
    mesh.material = mesh.material.clone();
    mesh.material.flatShading = true;
    mesh.material.needsUpdate = true;
  });
  await page.waitForTimeout(700);
  await capture('05-standard-flat-shading');
  await page.evaluate(() => {
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    const production = typeof clubhouse.sheet06Production === 'function'
      ? clubhouse.sheet06Production()
      : clubhouse.sheet06Production;
    const mesh = production.getAssemblyRoot(59)
      .getObjectByName('SHEET06_ASSET_59_NON_STOCKROOM_FLOOR_INSTANCES');
    mesh.material.dispose();
    mesh.material = mesh.userData.floorGridProbeOriginalMaterial;
    delete mesh.userData.floorGridProbeOriginalMaterial;
  });

  await page.evaluate(async () => {
    const THREE = await import('three');
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    const production = typeof clubhouse.sheet06Production === 'function'
      ? clubhouse.sheet06Production()
      : clubhouse.sheet06Production;
    const mesh = production.getAssemblyRoot(59)
      .getObjectByName('SHEET06_ASSET_59_NON_STOCKROOM_FLOOR_INSTANCES');
    mesh.userData.floorGridProbeOriginalMaterial = mesh.material;
    const source = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    mesh.material = new THREE.MeshBasicMaterial({
      map: source.map,
      color: 0xffffff,
      toneMapped: false,
    });
    app.scene3d.post.gtao.enabled = false;
  });
  await page.waitForTimeout(700);
  await capture('06-basic-texture-gtao-disabled');
  await page.evaluate(async () => {
    const THREE = await import('three');
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    const production = typeof clubhouse.sheet06Production === 'function'
      ? clubhouse.sheet06Production()
      : clubhouse.sheet06Production;
    const mesh = production.getAssemblyRoot(59)
      .getObjectByName('SHEET06_ASSET_59_NON_STOCKROOM_FLOOR_INSTANCES');
    mesh.material.dispose();
    mesh.material = new THREE.MeshBasicMaterial({ color: 0x808080, toneMapped: false });
  });
  await page.waitForTimeout(700);
  await capture('07-basic-uniform-gtao-disabled');
  await page.evaluate(() => {
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    const production = typeof clubhouse.sheet06Production === 'function'
      ? clubhouse.sheet06Production()
      : clubhouse.sheet06Production;
    const mesh = production.getAssemblyRoot(59)
      .getObjectByName('SHEET06_ASSET_59_NON_STOCKROOM_FLOOR_INSTANCES');
    mesh.material.dispose();
    mesh.material = mesh.userData.floorGridProbeOriginalMaterial;
    delete mesh.userData.floorGridProbeOriginalMaterial;
    app.scene3d.post.gtao.enabled = true;
  });

  await page.evaluate(() => {
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    const production = typeof clubhouse.sheet06Production === 'function'
      ? clubhouse.sheet06Production()
      : clubhouse.sheet06Production;
    const mesh = production.getAssemblyRoot(59)
      .getObjectByName('SHEET06_ASSET_59_NON_STOCKROOM_FLOOR_INSTANCES');
    mesh.userData.floorGridProbeOriginalVisible = mesh.visible;
    mesh.visible = false;
  });
  await page.waitForTimeout(700);
  await capture('08-asset59-hidden-underlayers');
  await page.evaluate(() => {
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    const production = typeof clubhouse.sheet06Production === 'function'
      ? clubhouse.sheet06Production()
      : clubhouse.sheet06Production;
    const mesh = production.getAssemblyRoot(59)
      .getObjectByName('SHEET06_ASSET_59_NON_STOCKROOM_FLOOR_INSTANCES');
    mesh.visible = mesh.userData.floorGridProbeOriginalVisible;
    delete mesh.userData.floorGridProbeOriginalVisible;
  });

  await setArchitectureFloor(false);
  for (const camera of damageCameras) {
    await setCamera(camera);
    await capture(`damage-camera-${camera.id}`);
  }
  const damageEvidence = await page.evaluate(() => {
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    const production = typeof clubhouse.sheet06Production === 'function'
      ? clubhouse.sheet06Production()
      : clubhouse.sheet06Production;
    const damage = production.getAssemblyRoot(60);
    return {
      floorRestored: app.state.shop.reno.architecture.components.floor.restored,
      damageRootVisible: damage.visible,
      damageVariant: production.diagnostics().assembly?.floor?.damageVariant ?? null,
      damageSites: [...damage.children].map((child) => ({
        name: child.name,
        position: child.position.toArray(),
        visible: child.visible,
      })),
    };
  });
  await setArchitectureFloor(true);
  await setCamera(gridCamera);

  const blockingDiagnostics = diagnostics.filter((entry) => (
    entry.kind !== 'console:warning'
    && !(entry.kind === 'requestfailed' && /ERR_ABORTED/i.test(entry.message))
  ));
  const result = {
    ok: structural.mesh.count > 0
      && structural.mesh.instances.overlapSummary.exactInteriorOverlaps === 0
      && damageEvidence.damageRootVisible === true
      && blockingDiagnostics.length === 0,
    capturedAt: new Date().toISOString(),
    launch: 'node tools/qa/run-playwright.cjs tools/qa/sheet06-floor-grid-probe.js --bootstrap',
    methodology: {
      viewport: { width: 1600, height: 900 },
      deviceScaleFactor: 1,
      fixture: 'fully restored/clean architecture, 2 PM clear locked weather; Asset 60 public floor-restoration state only for damage-camera probes',
      gridCamera,
      temporaryProbes: [
        'GTAO pass disabled',
        'Asset 59 receiveShadow disabled',
        'Asset 51 foundation hidden',
        'same Standard material with flatShading enabled',
        'unlit base-color texture with GTAO disabled',
        'unlit uniform material with GTAO disabled',
        'Asset 59 hidden to reveal lower layers',
      ],
      restoration: 'all temporary scene/material/pass mutations restored before return',
    },
    screenshots,
    structural,
    foundationMutation,
    damageCameras,
    damageEvidence,
    diagnostics,
    blockingDiagnostics,
  };
  fs.writeFileSync(path.join(out, 'floor-grid-probe-result.json'), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}
