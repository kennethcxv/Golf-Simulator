async (page) => {
  // Reference-44 wooden pallet runtime acceptance probe. Fixture mutations only
  // prepare a known delivery; the pickup assertion itself uses pointer lock and
  // the normal E interaction path seen by a player.
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = path.resolve(process.env.QA_REPO_ROOT || process.cwd());
  const out = path.join(repo, 'qa', 'box_system_master', 'pallet_ref44', 'after', 'iteration-02');
  fs.mkdirSync(out, { recursive: true });

  const diagnostics = [];
  const diagnosticCounts = { consoleError: 0, consoleWarning: 0, pageError: 0, requestFailed: 0 };
  let measuredDocument = false;
  let plannedStructureRebuild = false;
  const note = (kind, message) => {
    diagnosticCounts[kind] += 1;
    if (diagnostics.length < 100) diagnostics.push({ kind, message: String(message), atMs: Date.now() });
  };
  page.on('console', (message) => {
    if (message.type() === 'error') note('consoleError', message.text());
    if (message.type() === 'warning') note('consoleWarning', message.text());
  });
  page.on('pageerror', (error) => note('pageError', error.message));
  page.on('requestfailed', (request) => {
    const error = request.failure()?.errorText || 'unknown';
    if (!measuredDocument && /ERR_ABORTED/i.test(error)) return;
    // A deliberate structure replacement cancels only the old clubhouse's
    // in-flight GLBs. Keep the exemption scoped to that measured replacement;
    // the new stage must still load fully before the flag is cleared.
    if (plannedStructureRebuild && /ERR_ABORTED/i.test(error)) return;
    note('requestFailed', `${request.url()} (${error})`);
  });
  page.on('response', (response) => {
    if (response.status() >= 400) note('requestFailed', `${response.url()} (HTTP ${response.status()})`);
  });

  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(500);
  await page.goto('http://localhost:8457/');
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.waitForTimeout(900);
  await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
  }, null, { timeout: 90000 });
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.()?.assetsReady?.(), null, { timeout: 90000 });
  await page.waitForFunction(() => {
    const scene = window.__fw?.scene3d?.scene;
    const stage = scene?.getObjectByName('DeliveryPalletStage');
    const anchors = Array.from({ length: 5 }, (_, index) => (
      stage?.getObjectByName(`DeliveryPallet_${index + 1}`)
    ));
    const baked = stage?.getObjectByName('DeliveryPalletBatchedVisuals');
    return stage?.userData?.ready === true
      && anchors.every(Boolean)
      && baked?.userData?.merchBaked === true
      && baked?.userData?.merchBakeVisibleOnly === true;
  }, null, { timeout: 90000 });
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(900);
  measuredDocument = true;

  await page.evaluate(() => {
    const app = window.__fw;
    app.speedIdx = 0;
    app.scene3d.walk.clearKeys?.();
    const day = Math.floor(app.state.clock.minutes / 1440) * 1440;
    app.state.clock.minutes = day + 14 * 60;
    if (app.state.weather) app.state.weather.locked = true;
    app.scene3d.applyTimeWeather?.(14 * 60, app.state.weather);
    const clubhouse = app.scene3d.clubhouse();
    clubhouse.setOrganicWalkins?.(false);
    clubhouse.clearWalkins?.();
  });

  const viewport = await page.evaluate(() => ({
    width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
  }));
  const canvas = page.locator('canvas').first();
  await canvas.waitFor({ state: 'visible', timeout: 30000 });
  await page.bringToFront();
  await page.mouse.move(800, 450);
  await canvas.click({ position: { x: 800, y: 450 }, force: true });
  await page.waitForFunction(
    (target) => document.pointerLockElement === target,
    await canvas.elementHandle(),
    { timeout: 7000 },
  );

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  await cdp.send('HeapProfiler.enable').catch(() => {});

  const cameras = Object.freeze({
    overview: { x: 16.40, z: 3.10, yaw: 0.84, pitch: -0.30 },
    pickup: { x: 13.00, z: 1.65, yaw: 0, pitch: -0.34 },
    close: { x: 13.00, z: 2.55, yaw: 0, pitch: -0.18 },
    collision: { x: 16.05, z: 0.62, yaw: Math.PI / 2, pitch: -0.18 },
  });

  async function setCamera(pose) {
    await page.evaluate((next) => {
      const app = window.__fw;
      const origin = app.scene3d.clubhouse().interior.position;
      const walk = app.scene3d.walk;
      walk.clearKeys?.();
      walk.state.x = origin.x + next.x;
      walk.state.z = origin.z + next.z;
      walk.state.yaw = next.yaw;
      walk.state.pitch = next.pitch;
    }, pose);
    await page.waitForTimeout(320);
  }

  async function waitForPalletStageReady(previousStageUuid = null) {
    await page.waitForFunction((previousUuid) => {
      const app = window.__fw;
      const clubhouse = app?.scene3d?.clubhouse?.();
      const stage = app?.scene3d?.scene?.getObjectByName('DeliveryPalletStage');
      const anchors = Array.from({ length: 5 }, (_, index) => (
        stage?.children.find((child) => child.name === `DeliveryPallet_${index + 1}`)
      ));
      const bakedRoots = stage?.children.filter(
        (child) => child.name === 'DeliveryPalletBatchedVisuals',
      ) || [];
      const baked = bakedRoots[0];
      return clubhouse?.assetsReady?.()
        && stage?.userData?.ready === true
        && (!previousUuid || stage.uuid !== previousUuid)
        && anchors.every((anchor) => anchor && !anchor.children.some((child) => child.isMesh))
        && bakedRoots.length === 1
        && baked?.userData?.merchBaked === true
        && baked?.userData?.merchBakeVisibleOnly === true;
    }, previousStageUuid, { timeout: 90000 });
    await page.waitForTimeout(500);
    return page.evaluate(() => {
      const app = window.__fw;
      const clubhouse = app.scene3d.clubhouse();
      clubhouse.setOrganicWalkins?.(false);
      clubhouse.clearWalkins?.();
      app.scene3d.walk.clearKeys?.();
      const stage = app.scene3d.scene.getObjectByName('DeliveryPalletStage');
      return {
        uuid: stage.uuid,
        ready: stage.userData.ready === true,
        authoredPalletCount: stage.userData.authoredPalletCount,
        childNames: stage.children.map((child) => child.name),
      };
    });
  }

  const threeBoxes = Object.freeze([
    { skuId: 'cap1', kind: 'merchbox', qty: 8 },
    { skuId: 'polo1', kind: 'apparel', qty: 8 },
    { skuId: 'driver1', kind: 'clubbox', qty: 2 },
  ]);
  // Ordered so each round-robin pallet stack has a broad base and its narrowest
  // carton on top. The production planner remains deterministic for every mix.
  const nineBoxes = Object.freeze([
    { skuId: 'cap1', kind: 'merchbox', qty: 8 },
    { skuId: 'polo1', kind: 'apparel', qty: 8 },
    { skuId: 'shoe1', kind: 'shoebox', qty: 4 },
    { skuId: 'polo1', kind: 'apparel', qty: 8 },
    { skuId: 'tees1', kind: 'carton', qty: 12 },
    { skuId: 'balls1', kind: 'ballcase', qty: 12 },
    { skuId: 'driver1', kind: 'clubbox', qty: 2 },
    { skuId: 'tees1', kind: 'carton', qty: 12 },
    { skuId: 'driver1', kind: 'clubbox', qty: 2 },
  ]);

  async function stageBoxes(specs, orderSeed = 944000) {
    const made = await page.evaluate(async ({ specs: fixture, orderSeed: seed }) => {
      const D = await import('/src/sim/deliveries.js');
      const B = await import('/src/data/boxes.js');
      const state = window.__fw.state;
      D.ensureDeliveries(state);
      state.shop.carry = null;
      const delivery = state.shop.deliveries;
      delivery.boxes = [];
      delivery.shipments = [];
      delivery.arrivedOrderIds = [];
      // Preserve the production monotonic box identity contract between fixture
      // deliveries. Reusing an id for a different carton family would make the
      // persistent view cache look stale in a way real save data never can.
      if (!Number.isFinite(delivery.nextBoxId)) delivery.nextBoxId = 1;
      if (state.notifications) {
        state.notifications.items = [];
        state.notifications.nextId = 1;
      }
      const ids = [];
      fixture.forEach((spec, index) => {
        const dimensions = B.boxDims(spec.kind);
        const orderId = seed + index;
        const [box] = D.arriveOrder(state, {
          id: orderId,
          skuId: spec.skuId,
          qty: spec.qty,
          manifest: {
            supplierId: 'pallet-qa',
            supplier: 'Fairway Receiving QA',
            boxes: [{
              kind: spec.kind,
              qty: spec.qty,
              w: dimensions.w,
              h: dimensions.h,
              d: dimensions.d,
              lb: Math.max(1, spec.qty * 0.5),
              fragile: false,
            }],
            boxCount: 1,
            weight: Math.max(1, spec.qty * 0.5),
            fee: 0,
          },
        });
        ids.push(box.id);
      });
      window.__fw.scene3d.clubhouse().rebuildBoxes();
      return ids;
    }, { specs, orderSeed });
    await page.waitForFunction((expected) => {
      const scene = window.__fw?.scene3d?.scene;
      return expected.every((id) => (
        scene?.getObjectByName(`DeliveryBox_${id}`)
        || scene?.getObjectByName(`DeliveryBoxFallback_${id}`)
      ));
    }, made, { timeout: 30000 });
    await page.waitForTimeout(500);
    return made;
  }

  async function clearBoxes() {
    await page.evaluate(() => {
      const state = window.__fw.state;
      state.shop.carry = null;
      state.shop.deliveries.boxes = [];
      state.shop.deliveries.shipments = [];
      state.shop.deliveries.arrivedOrderIds = [];
      window.__fw.scene3d.clubhouse().rebuildBoxes();
    });
    await page.waitForFunction(() => !window.__fw.scene3d.scene.children.some((root) => {
      let found = false;
      root.traverse?.((object) => {
        if (/^DeliveryBox(?:Fallback)?_\d+$/.test(object.name)) found = true;
      });
      return found;
    }));
    await page.waitForTimeout(350);
  }

  async function assetContract() {
    return page.evaluate(async () => {
      const THREE = await import('three');
      const S = await import('/src/data/deliveryStaging.js');
      const app = window.__fw;
      const origin = app.scene3d.clubhouse().interior.position;
      const scene = app.scene3d.scene;
      const stage = scene.getObjectByName('DeliveryPalletStage');
      const expectedCentres = S.deliveryPalletCentres();
      const anchorNames = Array.from(
        { length: S.DELIVERY_PALLET_STAGING.count },
        (_, index) => `DeliveryPallet_${index + 1}`,
      );
      const roots = anchorNames.map((name) => stage?.children.find((child) => child.name === name));
      const describeAnchor = (root, index) => {
        if (!root) return { exists: false, index, expectedName: anchorNames[index] };
        const world = root.getWorldPosition(new THREE.Vector3());
        let descendantMeshes = 0;
        root.traverse((object) => { if (object.isMesh) descendantMeshes += 1; });
        const centre = expectedCentres[index];
        return {
          exists: true,
          index,
          name: root.name,
          localPosition: {
            x: +(world.x - origin.x).toFixed(4),
            y: +world.y.toFixed(5),
            z: +(world.z - origin.z).toFixed(4),
          },
          expectedPosition: { x: centre.x, z: centre.z },
          metadata: { ...root.userData },
          descendantMeshes,
        };
      };

      const anchors = roots.map(describeAnchor);
      const bakedRoots = stage?.children.filter((child) => child.name === 'DeliveryPalletBatchedVisuals') || [];
      const baked = bakedRoots[0] || null;
      const bakedBounds = new THREE.Box3();
      const bakedGeometries = new Set();
      const bakedMaterials = new Set();
      const bakedTextures = new Set();
      let bakedVisibleMeshes = 0;
      let bakedUnexpectedHelpers = 0;
      baked?.updateWorldMatrix(true, true);
      baked?.traverseVisible((object) => {
        if (!object.isMesh || !object.geometry) return;
        bakedVisibleMeshes += 1;
        if (object.userData?.helper
          || /^(?:COL_|COLLISION_|VOLUME_)/i.test(String(object.name || ''))) {
          bakedUnexpectedHelpers += 1;
        }
        bakedGeometries.add(object.geometry.uuid);
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((material) => {
          if (!material) return;
          bakedMaterials.add(material.uuid);
          Object.values(material).forEach((value) => {
            if (value?.isTexture) bakedTextures.add(value.uuid);
          });
        });
        object.geometry.computeBoundingBox?.();
        if (object.geometry.boundingBox) {
          bakedBounds.union(object.geometry.boundingBox.clone().applyMatrix4(object.matrixWorld));
        }
      });

      const slab = scene.getObjectByName('DeliveryReceivingSlab');
      const slabBounds = slab ? new THREE.Box3().setFromObject(slab) : new THREE.Box3();
      const slabSize = slabBounds.getSize(new THREE.Vector3());
      const slabTopY = slab ? slabBounds.max.y : null;
      const anchorYs = anchors.filter((entry) => entry.exists).map((entry) => entry.localPosition.y);
      const anchorSupportDeltas = anchors.map((entry) => (
        entry.exists && slab ? +(entry.localPosition.y - slabTopY).toFixed(5) : null
      ));

      const road = scene.getObjectByName('courseCartPaths');
      const roadTriangleOverlaps = roots.map(() => 0);
      const cross = (a, b, c) => (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
      const pointInTriangle = (point, a, b, c) => {
        const ab = cross(a, b, point);
        const bc = cross(b, c, point);
        const ca = cross(c, a, point);
        return (ab >= 0 && bc >= 0 && ca >= 0) || (ab <= 0 && bc <= 0 && ca <= 0);
      };
      const segmentsCross = (a, b, c, d) => {
        if (Math.max(a.x, b.x) < Math.min(c.x, d.x) || Math.max(c.x, d.x) < Math.min(a.x, b.x)
          || Math.max(a.z, b.z) < Math.min(c.z, d.z) || Math.max(c.z, d.z) < Math.min(a.z, b.z)) return false;
        const abC = cross(a, b, c);
        const abD = cross(a, b, d);
        const cdA = cross(c, d, a);
        const cdB = cross(c, d, b);
        return ((abC <= 0 && abD >= 0) || (abD <= 0 && abC >= 0))
          && ((cdA <= 0 && cdB >= 0) || (cdB <= 0 && cdA >= 0));
      };
      const triangleHitsRect = (triangle, rect) => {
        if (triangle.some((point) => point.x >= rect.minX && point.x <= rect.maxX
          && point.z >= rect.minZ && point.z <= rect.maxZ)) return true;
        const corners = [
          { x: rect.minX, z: rect.minZ }, { x: rect.maxX, z: rect.minZ },
          { x: rect.maxX, z: rect.maxZ }, { x: rect.minX, z: rect.maxZ },
        ];
        if (corners.some((point) => pointInTriangle(point, ...triangle))) return true;
        const triEdges = [[triangle[0], triangle[1]], [triangle[1], triangle[2]], [triangle[2], triangle[0]]];
        const rectEdges = [[corners[0], corners[1]], [corners[1], corners[2]],
          [corners[2], corners[3]], [corners[3], corners[0]]];
        return triEdges.some(([a, b]) => rectEdges.some(([c, d]) => segmentsCross(a, b, c, d)));
      };
      const palletRects = roots.map((root) => {
        if (!root) return null;
        const position = root.getWorldPosition(new THREE.Vector3());
        return {
          minX: position.x - S.DELIVERY_PALLET_STAGING.length / 2,
          maxX: position.x + S.DELIVERY_PALLET_STAGING.length / 2,
          minZ: position.z - S.DELIVERY_PALLET_STAGING.width / 2,
          maxZ: position.z + S.DELIVERY_PALLET_STAGING.width / 2,
        };
      });
      road?.updateWorldMatrix(true, true);
      road?.traverse((object) => {
        if (!object.isMesh || !object.geometry?.attributes?.position) return;
        const position = object.geometry.attributes.position;
        const index = object.geometry.index;
        const count = index ? index.count : position.count;
        for (let offset = 0; offset + 2 < count; offset += 3) {
          const triangle = [0, 1, 2].map((corner) => {
            const vertex = index ? index.getX(offset + corner) : offset + corner;
            const world = new THREE.Vector3().fromBufferAttribute(position, vertex).applyMatrix4(object.matrixWorld);
            return { x: world.x, z: world.z };
          });
          palletRects.forEach((rect, palletIndex) => {
            if (rect && triangleHitsRect(triangle, rect)) roadTriangleOverlaps[palletIndex] += 1;
          });
        }
      });
      return {
        stageExists: !!stage,
        stageReady: stage?.userData?.ready === true,
        stageAuthoredPalletCount: stage?.userData?.authoredPalletCount ?? null,
        stageChildNames: stage?.children.map((child) => child.name) || [],
        spec: { ...S.DELIVERY_PALLET_STAGING },
        anchors,
        baked: {
          rootCount: bakedRoots.length,
          exists: !!baked,
          name: baked?.name || null,
          visibleOnly: baked?.userData?.merchBakeVisibleOnly === true,
          merchBaked: baked?.userData?.merchBaked === true,
          visibleMeshes: bakedVisibleMeshes,
          visibleGeometries: bakedGeometries.size,
          visibleMaterials: bakedMaterials.size,
          visibleTextures: bakedTextures.size,
          unexpectedVisibleHelpers: bakedUnexpectedHelpers,
          bounds: baked ? {
            min: bakedBounds.min.toArray().map((value) => +value.toFixed(5)),
            max: bakedBounds.max.toArray().map((value) => +value.toFixed(5)),
          } : null,
        },
        slab: {
          exists: !!slab,
          name: slab?.name || null,
          topY: slab ? +slabTopY.toFixed(5) : null,
          size: slab ? slabSize.toArray().map((value) => +value.toFixed(5)) : null,
          levelRotation: !!slab && Math.abs(slab.rotation.x) <= 1e-6 && Math.abs(slab.rotation.z) <= 1e-6,
          anchorYSpread: anchorYs.length
            ? +(Math.max(...anchorYs) - Math.min(...anchorYs)).toFixed(5) : null,
          anchorSupportDeltas,
          bakedBottomSupportDelta: baked && slab
            ? +(bakedBounds.min.y - slabTopY).toFixed(5) : null,
        },
        roadPathFound: !!road,
        roadFootprints: palletRects,
        roadTriangleOverlaps,
      };
    });
  }

  async function stackingContract() {
    return page.evaluate(async () => {
      const THREE = await import('three');
      const S = await import('/src/data/deliveryStaging.js');
      const app = window.__fw;
      const scene = app.scene3d.scene;
      const origin = app.scene3d.clubhouse().interior.position;
      const boxes = app.state.shop.deliveries.boxes.filter((box) => box.loc === 'pad');
      const plan = S.planPalletizedPadBoxes(boxes);
      const boundsFor = (root, ignoreCollision = false) => {
        const bounds = new THREE.Box3();
        root.updateWorldMatrix(true, true);
        root.traverseVisible((object) => {
          if (!object.isMesh || !object.visible || !object.geometry) return;
          if (ignoreCollision && (/^COL_/.test(object.name) || object.userData?.helper)) return;
          object.geometry.computeBoundingBox?.();
          if (object.geometry.boundingBox) bounds.union(
            object.geometry.boundingBox.clone().applyMatrix4(object.matrixWorld),
          );
        });
        return bounds;
      };
      const entries = plan.map((slot) => {
        const root = scene.getObjectByName(`DeliveryBox_${slot.boxId}`)
          || scene.getObjectByName(`DeliveryBoxFallback_${slot.boxId}`);
        const bounds = boundsFor(root);
        return {
          id: slot.boxId,
          palletIndex: slot.palletIndex,
          kind: boxes.find((box) => box.id === slot.boxId)?.box,
          plannedBaseY: slot.baseY,
          localPosition: {
            x: +(root.position.x - origin.x).toFixed(4),
            y: +root.position.y.toFixed(4),
            z: +(root.position.z - origin.z).toFixed(4),
          },
          expectedLocal: { x: slot.x, z: slot.z },
          bounds: {
            min: bounds.min.toArray().map((value) => +value.toFixed(5)),
            max: bounds.max.toArray().map((value) => +value.toFixed(5)),
          },
        };
      });
      const supportGaps = [];
      for (let palletIndex = 0; palletIndex < S.DELIVERY_PALLET_STAGING.count; palletIndex += 1) {
        // Production anchors intentionally contain no meshes: all five pallets
        // live in one visible-only baked root. The physical support plane is the
        // named anchor's world Y plus the exact authored 0.14 m pallet height.
        const anchor = scene.getObjectByName(`DeliveryPallet_${palletIndex + 1}`);
        const anchorWorld = anchor?.getWorldPosition(new THREE.Vector3());
        const stack = entries.filter((entry) => entry.palletIndex === palletIndex)
          .sort((a, b) => a.bounds.min[1] - b.bounds.min[1]);
        let supportTop = anchorWorld
          ? anchorWorld.y + S.DELIVERY_PALLET_STAGING.height : Number.NaN;
        stack.forEach((entry) => {
          supportGaps.push({
            id: entry.id,
            palletIndex,
            anchorExists: !!anchor,
            gap: +(entry.bounds.min[1] - supportTop).toFixed(5),
          });
          supportTop = entry.bounds.max[1];
        });
      }
      const overlaps = [];
      for (let left = 0; left < entries.length; left += 1) {
        for (let right = left + 1; right < entries.length; right += 1) {
          const a = entries[left].bounds;
          const b = entries[right].bounds;
          const dx = Math.min(a.max[0], b.max[0]) - Math.max(a.min[0], b.min[0]);
          const dy = Math.min(a.max[1], b.max[1]) - Math.max(a.min[1], b.min[1]);
          const dz = Math.min(a.max[2], b.max[2]) - Math.max(a.min[2], b.min[2]);
          if (dx > 0.001 && dy > 0.001 && dz > 0.001) {
            overlaps.push({ a: entries[left].id, b: entries[right].id, dx, dy, dz });
          }
        }
      }
      return { entries, supportGaps, overlaps };
    });
  }

  async function collectGarbage() {
    await cdp.send('HeapProfiler.collectGarbage').catch(() => {});
  }

  async function counters() {
    const dom = await cdp.send('Memory.getDOMCounters');
    const perf = await cdp.send('Performance.getMetrics');
    const metrics = Object.fromEntries(perf.metrics.map((entry) => [entry.name, entry.value]));
    return {
      documents: dom.documents,
      nodes: dom.nodes,
      listeners: dom.jsEventListeners,
      heapUsedBytes: metrics.JSHeapUsedSize ?? null,
    };
  }

  async function resourceCensus() {
    return page.evaluate(() => {
      const scene = window.__fw.scene3d.scene;
      const renderer = window.__fw.scene3d.renderer;
      const geometries = new Set();
      const materials = new Set();
      const textures = new Set();
      let visibleMeshes = 0;
      scene.traverseVisible((object) => {
        if (!object.isMesh) return;
        visibleMeshes += 1;
        if (object.geometry) geometries.add(object.geometry.uuid);
        const list = Array.isArray(object.material) ? object.material : [object.material];
        list.forEach((material) => {
          if (!material) return;
          materials.add(material.uuid);
          Object.values(material).forEach((value) => { if (value?.isTexture) textures.add(value.uuid); });
        });
      });
      return {
        visibleMeshes,
        visibleGeometries: geometries.size,
        visibleMaterials: materials.size,
        visibleTextures: textures.size,
        rendererGeometries: renderer.info.memory.geometries,
        rendererTextures: renderer.info.memory.textures,
        rendererPrograms: renderer.info.programs?.length ?? null,
        lastFrameCalls: renderer.info.render.calls,
        lastFrameTriangles: renderer.info.render.triangles,
      };
    });
  }

  async function measure(label, durationMs = 2200) {
    await page.waitForTimeout(650);
    const frame = await page.evaluate((duration) => new Promise((resolve) => {
      const deltas = [];
      let previous = performance.now();
      const start = previous;
      const tick = (time) => {
        deltas.push(time - previous);
        previous = time;
        if (time - start < duration) requestAnimationFrame(tick);
        else {
          const measured = deltas.slice(5).sort((a, b) => a - b);
          const average = measured.reduce((sum, value) => sum + value, 0) / Math.max(1, measured.length);
          const slowCount = Math.max(1, Math.ceil(measured.length * 0.01));
          const slowAverage = measured.slice(-slowCount).reduce((sum, value) => sum + value, 0) / slowCount;
          resolve({
            frames: measured.length,
            averageFps: +(1000 / average).toFixed(2),
            low1Fps: +(1000 / slowAverage).toFixed(2),
            averageFrameMs: +average.toFixed(3),
            worstFrameMs: +measured[measured.length - 1].toFixed(3),
            framesOver33Ms: measured.filter((value) => value > 33.334).length,
          });
        }
      };
      requestAnimationFrame(tick);
    }), durationMs);
    const resources = await resourceCensus();
    return { label, durationMs, ...frame, ...resources };
  }

  const captures = [];
  async function capture(fileName, camera, description) {
    await setCamera(camera);
    const file = path.join(out, fileName);
    await page.screenshot({ path: file });
    const state = await page.evaluate(() => {
      const app = window.__fw;
      const origin = app.scene3d.clubhouse().interior.position;
      const walk = app.scene3d.walk.state;
      return {
        camera: {
          x: +(walk.x - origin.x).toFixed(3),
          z: +(walk.z - origin.z).toFixed(3),
          yaw: +walk.yaw.toFixed(4),
          pitch: +walk.pitch.toFixed(4),
        },
        pointerLocked: document.pointerLockElement === document.querySelector('canvas'),
        focus: app.scene3d.walk.getFocusLabel?.() || null,
        liveBoxes: app.state.shop.deliveries.boxes.map((box) => ({ id: box.id, kind: box.box, loc: box.loc })),
      };
    });
    captures.push({ file, description, ...state });
    fs.writeFileSync(path.join(out, 'run-state.json'), `${JSON.stringify({
      status: 'running', captures, updatedAt: new Date().toISOString(),
    }, null, 2)}\n`);
  }

  await clearBoxes();
  await capture('00-authored-five-pallet-stage.png', cameras.overview,
    'Five ref-44 pallet anchors represented by one production-batched visual root on the level receiving slab.');
  const assets = await assetContract();

  await setCamera(cameras.collision);
  const collisionStart = await page.evaluate(() => {
    const app = window.__fw;
    const origin = app.scene3d.clubhouse().interior.position;
    return {
      x: app.scene3d.walk.state.x - origin.x,
      z: app.scene3d.walk.state.z - origin.z,
    };
  });
  await page.keyboard.down('w');
  await page.waitForTimeout(1200);
  await page.keyboard.up('w');
  await page.waitForTimeout(250);
  const collisionEnd = await page.evaluate(() => {
    const app = window.__fw;
    const origin = app.scene3d.clubhouse().interior.position;
    return {
      x: app.scene3d.walk.state.x - origin.x,
      z: app.scene3d.walk.state.z - origin.z,
      pointerLocked: document.pointerLockElement === document.querySelector('canvas'),
    };
  });
  const collisionProbe = {
    start: collisionStart,
    end: collisionEnd,
    controls: 'held normal W for 1200 ms directly toward pallet 3',
    targetPallet: { index: 2, centreX: 14.35, centreZ: 0.62 },
    palletEastEdge: 14.35 + 0.60,
    playerRadius: 0.34,
    stoppedBeforeFootprint: collisionEnd.x >= 14.35 + 0.60 + 0.34 - 0.03,
    advancedTowardPallet: collisionEnd.x < collisionStart.x - 0.20,
  };

  const threeIds = await stageBoxes(threeBoxes, 944100);
  await capture('01-three-box-mixed-delivery.png', cameras.overview,
    'Exact merchandise, apparel, and long-club cartons occupy three of the five pallet anchors.');

  await setCamera(cameras.pickup);
  await page.waitForFunction(() => /Delivery: .*\[E\] pick up/i.test(
    window.__fw.scene3d.walk.getFocusLabel?.() || '',
  ), null, { timeout: 7000 });
  const pickupFocusBefore = await page.evaluate(() => window.__fw.scene3d.walk.getFocusLabel?.() || null);
  await page.keyboard.press('e');
  await page.waitForFunction(() => window.__fw.state.shop.deliveries.boxes.some((box) => box.loc === 'carried'));
  await page.waitForTimeout(350);
  const pickupState = await page.evaluate(() => ({
    carried: window.__fw.state.shop.deliveries.boxes.filter((box) => box.loc === 'carried')
      .map((box) => ({ id: box.id, kind: box.box })),
    remainingOnPad: window.__fw.state.shop.deliveries.boxes.filter((box) => box.loc === 'pad')
      .map((box) => ({ id: box.id, kind: box.box })),
    pointerLocked: document.pointerLockElement === document.querySelector('canvas'),
  }));
  await capture('02-normal-control-pickup.png', cameras.pickup,
    'A normal E pickup lifts one delivered box and exposes the pallet beneath it.');

  const nineIds = await stageBoxes(nineBoxes, 944200);
  const stackAudit = await stackingContract();
  await capture('03-nine-box-five-pallet-capacity.png', cameras.overview,
    'The full supported nine-box capacity forms five aligned, non-overlapping stacks no more than two cartons high.');

  // Prove that the player gets the exposed top carton rather than the buried
  // first prop at the same X/Z, and that stable ids keep all other boxes in
  // their original pallet lanes after the pickup rebuild.
  const topByPallet = new Map();
  stackAudit.entries.forEach((entry) => topByPallet.set(entry.palletIndex, entry.id));
  const expectedTopIds = [...topByPallet.values()];
  await setCamera(cameras.pickup);
  await page.waitForFunction(() => /Delivery: .*\[E\] pick up/i.test(
    window.__fw.scene3d.walk.getFocusLabel?.() || '',
  ), null, { timeout: 7000 });
  const stackPickupFocusBefore = await page.evaluate(() => window.__fw.scene3d.walk.getFocusLabel?.() || null);
  await page.keyboard.press('e');
  await page.waitForFunction(() => window.__fw.state.shop.deliveries.boxes.some((box) => box.loc === 'carried'));
  await page.waitForTimeout(350);
  const stackAfterPickup = await stackingContract();
  const stackPickupState = await page.evaluate(() => ({
    carried: window.__fw.state.shop.deliveries.boxes.filter((box) => box.loc === 'carried')
      .map((box) => ({ id: box.id, kind: box.box })),
    remainingOnPad: window.__fw.state.shop.deliveries.boxes.filter((box) => box.loc === 'pad')
      .map((box) => ({ id: box.id, kind: box.box })),
    pointerLocked: document.pointerLockElement === document.querySelector('canvas'),
  }));
  const priorById = new Map(stackAudit.entries.map((entry) => [entry.id, entry]));
  const stableRemainingAssignments = stackAfterPickup.entries.every((entry) => {
    const prior = priorById.get(entry.id);
    return prior
      && entry.palletIndex === prior.palletIndex
      && Math.abs(entry.localPosition.x - prior.localPosition.x) <= 0.001
      && Math.abs(entry.localPosition.z - prior.localPosition.z) <= 0.001
      && Math.abs(entry.localPosition.y - prior.localPosition.y) <= 0.001;
  });
  await capture('04-normal-top-carton-pickup.png', cameras.pickup,
    'Normal E selects an exposed top carton; all eight remaining cartons keep their five-pallet lanes and poses.');

  // Measure the same fixed camera with only the batched pallet stage toggled,
  // then target the structure lifecycle that owns the stage. Each of the three
  // rebuilds must load a fresh clubhouse, finish its GLBs, and publish a ready
  // five-anchor/one-bake stage without retaining renderer or DOM resources.
  await clearBoxes();
  await setCamera(cameras.overview);
  await collectGarbage();
  const countersBefore = await counters();
  await page.evaluate(() => { window.__fw.scene3d.scene.getObjectByName('DeliveryPalletStage').visible = false; });
  const performanceWithoutPallets = await measure('empty-receiving-area-with-pallet-stage-hidden');
  await page.evaluate(() => { window.__fw.scene3d.scene.getObjectByName('DeliveryPalletStage').visible = true; });
  await page.waitForTimeout(350);
  const performanceBefore = await measure('empty-pallet-stage-before-three-delivery-rebuilds');

  await stageBoxes(nineBoxes, 944300);
  const loadedPerformance = await measure('nine-box-pallet-stage');
  await clearBoxes();
  const rebuildCycles = [];
  for (let cycle = 1; cycle <= 3; cycle += 1) {
    const previousStageUuid = await page.evaluate(() => (
      window.__fw.scene3d.scene.getObjectByName('DeliveryPalletStage')?.uuid || null
    ));
    await page.evaluate(() => {
      const clubhouse = window.__fw.scene3d.clubhouse();
      const originalDispose = clubhouse.dispose;
      clubhouse.dispose = () => {
        const summary = originalDispose();
        window.__deliveryPalletLastDisposal = summary;
        return summary;
      };
    });
    plannedStructureRebuild = true;
    let readiness;
    try {
      await page.evaluate(() => window.__fw.scene3d.rebuildStructures());
      readiness = await waitForPalletStageReady(previousStageUuid);
    } finally {
      plannedStructureRebuild = false;
    }
    await setCamera(cameras.overview);
    await collectGarbage();
    rebuildCycles.push({
      cycle,
      readiness,
      disposal: await page.evaluate(() => window.__deliveryPalletLastDisposal || null),
      resources: await resourceCensus(),
      counters: await counters(),
    });
  }
  await collectGarbage();
  const performanceAfter = await measure('empty-pallet-stage-after-three-structure-rebuilds');
  await collectGarbage();
  const countersAfter = await counters();
  await capture('05-five-pallet-fork-channel-closeup.png', cameras.close,
    'Low player-camera view into the open front fork channels, separated deck boards, blocks, fasteners, and wear.');

  const exactDimensions = (dimensions) => Array.isArray(dimensions)
    && dimensions.length === 3
    && Math.abs(dimensions[0] - 1.20) <= 0.001
    && Math.abs(dimensions[1] - 0.14) <= 0.001
    && Math.abs(dimensions[2] - 1.00) <= 0.001;
  const metadataAnchors = assets.anchors.length === 5 && assets.anchors.every((entry) => (
    entry.exists
    && entry.name === `DeliveryPallet_${entry.index + 1}`
    && entry.metadata?.asset_id === 'delivery_wooden_pallet'
    && String(entry.metadata?.reference_id) === '44'
    && entry.metadata?.palletIndex === entry.index
    && exactDimensions(entry.metadata?.dimensions)
    && entry.descendantMeshes === 0
    && Math.abs(entry.localPosition.x - entry.expectedPosition.x) <= 0.001
    && Math.abs(entry.localPosition.z - entry.expectedPosition.z) <= 0.001
  ));
  const singleVisibleOnlyBake = assets.baked.rootCount === 1
    && assets.baked.exists
    && assets.baked.visibleOnly
    && assets.baked.merchBaked
    && assets.baked.visibleMeshes >= 1
    && assets.baked.visibleMeshes <= 4
    && assets.baked.visibleGeometries >= 1
    && assets.baked.visibleGeometries <= 4
    && assets.baked.visibleMaterials <= 4
    && assets.baked.unexpectedVisibleHelpers === 0;
  const levelSlabSupport = assets.slab.exists
    && assets.slab.levelRotation
    && Math.abs(assets.slab.size[0] - assets.spec.receivingApron.length) <= 0.01
    && Math.abs(assets.slab.size[1] - assets.spec.receivingApron.depth) <= 0.01
    && Math.abs(assets.slab.size[2] - assets.spec.receivingApron.width) <= 0.01
    && assets.slab.anchorYSpread <= 0.001
    && assets.slab.anchorSupportDeltas.length === 5
    && assets.slab.anchorSupportDeltas.every((delta) => Math.abs(delta) <= 0.002)
    && Math.abs(assets.slab.bakedBottomSupportDelta) <= 0.006;
  const allAligned = stackAudit.entries.length === nineBoxes.length && stackAudit.entries.every((entry) => (
    Math.abs(entry.localPosition.x - entry.expectedLocal.x) <= 0.001
    && Math.abs(entry.localPosition.z - entry.expectedLocal.z) <= 0.001
  ));
  const allSupported = stackAudit.supportGaps.length === nineBoxes.length
    && stackAudit.supportGaps.every((entry) => entry.anchorExists
      && entry.gap >= -0.002 && entry.gap <= 0.016);
  const laneCounts = Array.from({ length: 5 }, (_, palletIndex) => (
    stackAudit.entries.filter((entry) => entry.palletIndex === palletIndex).length
  ));
  const palletResourceDelta = {
    visibleMeshes: performanceBefore.visibleMeshes - performanceWithoutPallets.visibleMeshes,
    visibleGeometries: performanceBefore.visibleGeometries - performanceWithoutPallets.visibleGeometries,
    visibleMaterials: performanceBefore.visibleMaterials - performanceWithoutPallets.visibleMaterials,
    visibleTextures: performanceBefore.visibleTextures - performanceWithoutPallets.visibleTextures,
  };
  const batchedRuntimeBudget = palletResourceDelta.visibleMeshes >= 1
    && palletResourceDelta.visibleMeshes <= 4
    && palletResourceDelta.visibleGeometries >= 1
    && palletResourceDelta.visibleGeometries <= 4
    && palletResourceDelta.visibleMaterials >= 1
    && palletResourceDelta.visibleMaterials <= 4
    && palletResourceDelta.visibleTextures === 0;
  const resourcesMatchBaseline = (snapshot) => (
    snapshot.rendererGeometries <= performanceBefore.rendererGeometries
    && snapshot.rendererTextures <= performanceBefore.rendererTextures
    && snapshot.rendererPrograms <= performanceBefore.rendererPrograms
    && snapshot.visibleMeshes === performanceBefore.visibleMeshes
    && snapshot.visibleGeometries === performanceBefore.visibleGeometries
    && snapshot.visibleMaterials === performanceBefore.visibleMaterials
    && snapshot.visibleTextures === performanceBefore.visibleTextures
  );
  const noResourceGrowth = resourcesMatchBaseline(performanceAfter)
    && rebuildCycles.every((entry) => resourcesMatchBaseline(entry.resources));
  const noListenerGrowth = countersAfter.listeners <= countersBefore.listeners
    && rebuildCycles.every((entry) => entry.counters.listeners <= countersBefore.listeners);
  const heapWithinGcTolerance = countersAfter.heapUsedBytes - countersBefore.heapUsedBytes <= 8 * 1024 * 1024
    && rebuildCycles.every((entry) => (
      entry.counters.heapUsedBytes - countersBefore.heapUsedBytes <= 8 * 1024 * 1024
    ));
  const performanceGate = noResourceGrowth
    && noListenerGrowth
    && heapWithinGcTolerance
    && batchedRuntimeBudget
    && performanceBefore.averageFps >= performanceWithoutPallets.averageFps * 0.85
    && performanceBefore.low1Fps >= performanceWithoutPallets.low1Fps * 0.75
    && performanceAfter.averageFps >= performanceBefore.averageFps * 0.85
    && performanceAfter.low1Fps >= performanceBefore.low1Fps * 0.75;
  const systemLevelNineBox60FpsDebt = {
    gating: false,
    scope: 'mixed authored and procedural nine-box delivery scene with the five-pallet stage visible',
    targetAverageFps: 60,
    observedAverageFps: loadedPerformance.averageFps,
    observedLow1Fps: loadedPerformance.low1Fps,
    shortfallFps: +Math.max(0, 60 - loadedPerformance.averageFps).toFixed(2),
    status: loadedPerformance.averageFps >= 60 ? 'target-met' : 'open-system-performance-debt',
    rationale: 'Reported for the master delivery system, but intentionally excluded from the ref-44 pallet batch gate; the pallet increment is judged by the matched hidden/visible scene delta.',
  };

  const assertions = {
    viewport1600x900Dpr1: viewport.width === 1600 && viewport.height === 900 && viewport.dpr === 1,
    fiveNamedMetadataAnchors: assets.stageExists
      && assets.stageReady
      && assets.stageAuthoredPalletCount === 5
      && assets.stageChildNames.length === 6
      && metadataAnchors,
    oneVisibleOnlyBatchedPalletRoot: singleVisibleOnlyBake,
    levelReceivingSlabSupport: levelSlabSupport,
    roadClearanceForFiveFootprints: assets.roadPathFound
      && assets.roadTriangleOverlaps.length === 5
      && assets.roadTriangleOverlaps.every((count) => count === 0),
    physicalPalletCollision: collisionProbe.stoppedBeforeFootprint
      && collisionProbe.advancedTowardPallet
      && collisionEnd.pointerLocked,
    normalControlPickup: threeIds.length === 3
      && /Delivery: .*\[E\] pick up/i.test(pickupFocusBefore || '')
      && pickupState.carried.length === 1
      && pickupState.remainingOnPad.length === 2
      && pickupState.pointerLocked,
    normalTopCartonPickup: /Delivery: .*\[E\] pick up/i.test(stackPickupFocusBefore || '')
      && stackPickupState.carried.length === 1
      && expectedTopIds.includes(stackPickupState.carried[0].id)
      && stackPickupState.remainingOnPad.length === 8
      && stableRemainingAssignments
      && stackPickupState.pointerLocked,
    nineBoxCapacityAcrossFivePallets: nineIds.length === 9
      && stackAudit.entries.length === 9
      && laneCounts.every((count) => count >= 1 && count <= 2),
    exactAlignment: allAligned,
    supportedWithoutHovering: allSupported,
    noBoxOverlap: stackAudit.overlaps.length === 0,
    performanceAndResourceGate: performanceGate,
    pointerLockHeldForEvidence: captures.every((entry) => entry.pointerLocked),
    noConsoleOrPageErrors: diagnosticCounts.consoleError === 0 && diagnosticCounts.pageError === 0,
    noFailedRequests: diagnosticCounts.requestFailed === 0,
  };
  const ok = Object.values(assertions).every(Boolean);
  const result = {
    ok,
    reference: 44,
    outputDirectory: out,
    launch: 'node tools/qa/run-playwright.cjs tools/qa/delivery-pallet-qa.js --bootstrap',
    viewport,
    assets,
    collisionProbe,
    fixture: { threeBoxes, nineBoxes },
    normalControlPickup: { focusBefore: pickupFocusBefore, ...pickupState },
    normalTopCartonPickup: {
      focusBefore: stackPickupFocusBefore,
      expectedTopIds,
      stableRemainingAssignments,
      ...stackPickupState,
    },
    stacking: stackAudit,
    performance: {
      methodology: 'Fixed 1600x900 player camera; matched hidden/visible pallet-stage rAF samples; identical empty-scene resource censuses before and after three targeted rebuildStructures() cycles; forced-GC DOM/listener/heap counters.',
      withoutPallets: performanceWithoutPallets,
      before: performanceBefore,
      loaded: loadedPerformance,
      after: performanceAfter,
      palletResourceDelta,
      rebuildCycles,
      countersBefore,
      countersAfter,
      systemLevelNineBox60FpsDebt,
      gates: {
        palletAverageFpsRetention: 'at least 85% versus the same camera with the authored stage hidden',
        palletLow1FpsRetention: 'at least 75% versus the same camera with the authored stage hidden',
        palletRuntimeResources: '1-4 batched visible meshes/geometries and authored materials, with 0 additional visible textures',
        postRebuildAverageFpsRetention: 'at least 85% versus the matched pre-rebuild visible pallet scene',
        postRebuildLow1FpsRetention: 'at least 75% versus the matched pre-rebuild visible pallet scene',
        retainedRendererResources: 'zero growth after every targeted rebuildStructures() cycle',
        retainedVisibleResources: 'exact match after every targeted rebuildStructures() cycle',
        eventListeners: 'zero growth after every targeted rebuildStructures() cycle',
        heap: 'no more than 8 MiB growth after forced GC',
        nineBox60Fps: 'reported as non-gating system-level performance debt, not hidden inside the ref-44 pallet batch gate',
      },
    },
    captures,
    assertions,
    diagnostics: { counts: diagnosticCounts, entries: diagnostics },
  };
  fs.writeFileSync(path.join(out, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
  fs.writeFileSync(path.join(out, 'run-state.json'), `${JSON.stringify({
    status: ok ? 'passed' : 'failed', captures, result: path.join(out, 'result.json'), updatedAt: new Date().toISOString(),
  }, null, 2)}\n`);
  return result;
}
