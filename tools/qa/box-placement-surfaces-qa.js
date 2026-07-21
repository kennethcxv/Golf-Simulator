async (page) => {
  // Generalized delivery-carton placement acceptance.
  //
  // `--bootstrap` supplies the documented empire/property fixture. This probe
  // then establishes two real delivery boxes: one stationary floor blocker and
  // one sealed accessories carton. Every tested transition after that fixture
  // uses the same keyboard/mouse routes as a player: E pickup/activate/commit,
  // R rotate, Escape cancel, X reposition, and an authored-path LMB cutter drag.

  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = path.resolve(process.env.QA_REPO_ROOT || process.cwd());
  const iterationRaw = String(process.env.BOX_PLACEMENT_ITERATION || '01');
  const iteration = iterationRaw.padStart(2, '0');
  const out = path.join(
    repo,
    'qa',
    'box_system_master',
    'placement',
    'after',
    `iteration-${iteration}`,
  );
  const videoDirectory = process.env.VIDEO_DIR
    ? path.resolve(process.env.VIDEO_DIR)
    : path.join(out, 'video');
  fs.mkdirSync(out, { recursive: true });

  const fixtureOrderId = 970100 + Number(iteration || 0) * 10;
  const blockerOrderId = fixtureOrderId + 1;
  const floorBlockerTarget = Object.freeze({ x: 0, z: 2, ry: 0 });
  const floorValidTarget = Object.freeze({ x: 0.75, z: 2, ry: 0 });
  const doorwayBlockedTarget = Object.freeze({ x: -0.75, z: 5.0, ry: 0 });
  const surfaceIds = Object.freeze({
    floor: 'floor:clubhouse',
    table: 'fixture:table_polos:top',
    shelf: 'fixture:backshelf_e2:m01:l04',
    packing: 'station:packing:top',
    backcounter: 'fixture:backcounter:worktop:east',
    pallet: 'pallet:receiving:3',
    cart: 'equipment:delivery_stocking_cart:STOCK_BOX_SOCKET_TOP',
    handTruck: 'equipment:delivery_hand_truck:LOAD_ORIGIN',
  });
  const placementGreen = 0x22c55e;
  const placementRed = 0xef4444;
  const placementCueGreen = 0xf0c75e;
  const handTruckCamera = Object.freeze({ distance: 1.85, approach: [0.18, 1] });
  const palletJackCamera = Object.freeze({ distance: 1.75, approach: [1, 0] });
  const cutterCamera = Object.freeze({ distance: 1.28, approach: [0, 1] });

  const diagnostics = [];
  const diagnosticCounts = {
    consoleError: 0,
    consoleWarning: 0,
    pageError: 0,
    requestFailed: 0,
  };
  let expectedNavigation = true;
  const noteDiagnostic = (kind, value) => {
    diagnosticCounts[kind] += 1;
    if (diagnostics.length < 160) diagnostics.push({
      kind,
      text: String(value),
      at: new Date().toISOString(),
    });
  };
  page.on('console', (message) => {
    if (message.type() === 'error') noteDiagnostic('consoleError', message.text());
    if (message.type() === 'warning') noteDiagnostic('consoleWarning', message.text());
  });
  page.on('pageerror', (error) => noteDiagnostic('pageError', error.message));
  page.on('requestfailed', (request) => {
    const failure = request.failure()?.errorText || 'unknown';
    if (expectedNavigation && /ERR_ABORTED/i.test(failure)) return;
    noteDiagnostic('requestFailed', `${request.url()} (${failure})`);
  });
  page.on('response', (response) => {
    if (response.status() >= 400) {
      noteDiagnostic('requestFailed', `${response.url()} (HTTP ${response.status()})`);
    }
  });

  const requireTruth = (condition, message) => {
    if (!condition) throw new Error(message);
  };

  async function waitForGame() {
    const continueButton = page.getByText('Continue', { exact: true });
    await continueButton.waitFor({ state: 'visible', timeout: 30000 });
    await continueButton.click();
    await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
    await page.waitForFunction(() => {
      const veil = document.querySelector('.load-veil');
      return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
    }, null, { timeout: 90000 });
    await page.waitForFunction(() => {
      const clubhouse = window.__fw?.scene3d?.clubhouse?.();
      return !!clubhouse
        && (typeof clubhouse.assetsReady !== 'function' || clubhouse.assetsReady())
        && (typeof clubhouse.deliveryEquipmentReady !== 'function'
          || clubhouse.deliveryEquipmentReady());
    }, null, { timeout: 90000 });
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(650);
    expectedNavigation = false;

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
  }

  async function acquirePointerLock() {
    const canvas = page.locator('canvas').first();
    await canvas.waitFor({ state: 'visible', timeout: 30000 });
    await page.bringToFront();
    await page.mouse.move(800, 450);
    await canvas.click({ position: { x: 800, y: 450 }, force: true });
    await page.waitForFunction(
      () => document.pointerLockElement === document.querySelector('canvas'),
      null,
      { timeout: 7000 },
    );
  }

  async function firstBoot() {
    expectedNavigation = true;
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto('http://localhost:8457/', { waitUntil: 'domcontentloaded' });
    await waitForGame();
    await acquirePointerLock();
  }

  async function reloadAndContinue() {
    expectedNavigation = true;
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForGame();
    await acquirePointerLock();
  }

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  await cdp.send('HeapProfiler.enable').catch(() => {});

  async function collectGarbage() {
    await cdp.send('HeapProfiler.collectGarbage').catch(() => {});
    await page.waitForTimeout(120);
  }

  async function warmRendererResources(label) {
    const evidence = await page.evaluate((warmupLabel) => {
      const app = window.__fw;
      const scene = app.scene3d.scene;
      const renderer = app.scene3d.renderer;
      const camera = app.scene3d.camera;
      const restored = [];
      scene.traverseVisible((object) => {
        if (!object.isMesh && !object.isLine && !object.isPoints) return;
        if (object.frustumCulled !== false) {
          restored.push(object);
          object.frustumCulled = false;
        }
      });
      renderer.render(scene, camera);
      for (const object of restored) object.frustumCulled = true;
      return { label: warmupLabel, forcedRenderableObjects: restored.length };
    }, label);
    await page.waitForTimeout(120);
    return { ...evidence, resources: await resourceCensus() };
  }

  async function runtimeCounters() {
    const [dom, heap] = await Promise.all([
      cdp.send('Memory.getDOMCounters').catch(() => ({})),
      cdp.send('Runtime.getHeapUsage').catch(() => ({})),
    ]);
    return {
      documents: Number.isFinite(dom.documents) ? dom.documents : null,
      domNodes: Number.isFinite(dom.nodes) ? dom.nodes : null,
      eventListeners: Number.isFinite(dom.jsEventListeners) ? dom.jsEventListeners : null,
      heapUsedBytes: Number.isFinite(heap.usedSize) ? heap.usedSize : null,
      heapTotalBytes: Number.isFinite(heap.totalSize) ? heap.totalSize : null,
    };
  }

  async function resourceCensus() {
    const sceneResources = await page.evaluate(() => {
      const app = window.__fw;
      const scene = app.scene3d.scene;
      const renderer = app.scene3d.renderer;
      const geometries = new Set();
      const materials = new Set();
      const textures = new Set();
      let visibleMeshes = 0;
      scene.traverseVisible((object) => {
        if (!object.isMesh && !object.isLine && !object.isPoints) return;
        visibleMeshes += object.isMesh ? 1 : 0;
        if (object.geometry?.uuid) geometries.add(object.geometry.uuid);
        const list = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of list) {
          if (!material) continue;
          if (material.uuid) materials.add(material.uuid);
          for (const value of Object.values(material)) {
            if (value?.isTexture && value.uuid) textures.add(value.uuid);
          }
        }
      });
      const info = renderer.info;
      return {
        visibleMeshes,
        visibleGeometries: geometries.size,
        visibleMaterials: materials.size,
        visibleTextures: textures.size,
        rendererGeometries: info.memory.geometries,
        rendererTextures: info.memory.textures,
        rendererPrograms: info.programs?.length ?? null,
        drawCalls: info.render.calls,
        renderedTriangles: info.render.triangles,
        renderedLines: info.render.lines,
        renderedPoints: info.render.points,
        textureMemoryBytes: null,
        textureMemoryAvailability: 'Three.js exposes resident texture count, not GPU texture bytes; bytes are explicitly unmeasured.',
      };
    });
    return { ...sceneResources, ...(await runtimeCounters()) };
  }

  async function oneFrameSample(durationMs) {
    return page.evaluate((duration) => new Promise((resolve) => {
      const deltas = [];
      let previous = performance.now();
      const start = previous;
      const prompt = document.querySelector('.shop-prompt');
      let promptMutations = 0;
      const observer = prompt ? new MutationObserver((records) => {
        promptMutations += records.length;
      }) : null;
      observer?.observe(prompt, { childList: true, characterData: true, subtree: true, attributes: true });
      const tick = (time) => {
        deltas.push(time - previous);
        previous = time;
        if (time - start < duration) {
          requestAnimationFrame(tick);
          return;
        }
        observer?.disconnect();
        const measured = deltas.slice(5).filter((value) => value > 0).sort((a, b) => a - b);
        const average = measured.reduce((sum, value) => sum + value, 0)
          / Math.max(1, measured.length);
        const slowCount = Math.max(1, Math.ceil(measured.length * 0.01));
        const slowAverage = measured.slice(-slowCount)
          .reduce((sum, value) => sum + value, 0) / slowCount;
        resolve({
          durationMs: duration,
          frames: measured.length,
          averageFps: +(1000 / average).toFixed(2),
          low1Fps: +(1000 / slowAverage).toFixed(2),
          averageFrameMs: +average.toFixed(3),
          worstFrameMs: +(measured[measured.length - 1] || 0).toFixed(3),
          framesOver33Ms: measured.filter((value) => value > 33.334).length,
          promptMutations,
          promptUpdatesPerSecond: +(promptMutations / (duration / 1000)).toFixed(3),
        });
      };
      requestAnimationFrame(tick);
    }), durationMs);
  }

  async function measure(label, { samples = 3, durationMs = 1200 } = {}) {
    await page.waitForTimeout(400);
    const raw = [];
    for (let index = 0; index < samples; index += 1) {
      raw.push(await oneFrameSample(durationMs));
    }
    const median = (values) => {
      const ordered = [...values].sort((a, b) => a - b);
      return ordered[Math.floor(ordered.length / 2)] ?? null;
    };
    return {
      label,
      samples: raw,
      summary: {
        averageFps: median(raw.map((entry) => entry.averageFps)),
        low1Fps: median(raw.map((entry) => entry.low1Fps)),
        averageFrameMs: median(raw.map((entry) => entry.averageFrameMs)),
        worstFrameMs: Math.max(...raw.map((entry) => entry.worstFrameMs)),
        framesOver33Ms: raw.reduce((sum, entry) => sum + entry.framesOver33Ms, 0),
        promptUpdatesPerSecond: median(raw.map((entry) => entry.promptUpdatesPerSecond)),
      },
      resources: await resourceCensus(),
    };
  }

  async function stageFixture() {
    const staged = await page.evaluate(async ({ orderId, obstacleOrderId, obstacleTarget }) => {
      const D = await import('/src/sim/deliveries.js');
      const S = await import('/src/sim/shop.js');
      const app = window.__fw;
      const state = app.state;
      D.ensureDeliveries(state);
      const delivery = state.shop.deliveries;
      delivery.boxes = [];
      delivery.shipments = [];
      delivery.arrivedOrderIds = [];
      delivery.nextBoxId = 1;
      delivery.trash = 0;
      delivery.recycled = 0;
      state.shop.carry = null;
      // The placement run is a clean receiving-room comparison, not a shop
      // renovation test. Clear the original haul-away piles through their real
      // simulation mutation and rebuild the live renovation presentation before
      // the first player-controlled carton interaction.
      for (let index = 0; index < (state.shop.reno?.clutter?.length || 0); index += 1) {
        if (!state.shop.reno.clutter[index].cleared) S.clearClutter(state, index);
      }
      // Keep the authored apparel tabletop genuinely clear for this placement
      // probe. No stock is awarded; this only removes the bootstrap display.
      state.shop.inventory.polo1.shelf = 0;
      state.shop.inventory.polo2.shelf = 0;
      if (state.notifications) {
        state.notifications.items = [];
        state.notifications.nextId = 1;
      }

      const cartonManifest = (supplierId) => ({
        supplierId,
        supplier: 'Fairway Placement QA',
        boxes: [{
          kind: 'carton', qty: 12, w: 0.42, h: 0.30, d: 0.36, lb: 4.8, fragile: false,
        }],
        boxCount: 1,
        weight: 4.8,
        fee: 0,
      });
      const [candidate] = D.arriveOrder(state, {
        id: orderId,
        skuId: 'tees1',
        qty: 12,
        manifest: cartonManifest('placement-candidate'),
      });
      const [blocker] = D.arriveOrder(state, {
        id: obstacleOrderId,
        skuId: 'towel1',
        qty: 12,
        manifest: cartonManifest('placement-blocker'),
      });
      if (!candidate || !blocker) throw new Error('Could not establish placement delivery boxes.');
      const lifted = D.pickUpBox(state, blocker.id);
      if (!lifted.ok) throw new Error(`Could not lift blocker fixture carton: ${lifted.reason}`);
      const blockedSpot = D.putDownBox(state, blocker.id, {
        kind: 'surface',
        surfaceId: 'floor:clubhouse',
        x: obstacleTarget.x,
        z: obstacleTarget.z,
        ry: obstacleTarget.ry,
      });
      if (!blockedSpot.ok) throw new Error(`Could not place blocker fixture carton: ${blockedSpot.reason}`);
      app.scene3d.clubhouse().rebuildReno();
      app.scene3d.clubhouse().rebuildBoxes();
      return {
        candidate: {
          id: candidate.id,
          orderId: candidate.orderId,
          skuId: candidate.skuId,
          qty: candidate.qty,
          loc: candidate.loc,
          padPalletIndex: candidate.padPalletIndex,
        },
        blocker: {
          id: blocker.id,
          orderId: blocker.orderId,
          skuId: blocker.skuId,
          qty: blocker.qty,
          loc: blocker.loc,
          surfaceId: blocker.surfaceId,
          x: blocker.x,
          z: blocker.z,
          ry: blocker.ry,
        },
      };
    }, {
      orderId: fixtureOrderId,
      obstacleOrderId: blockerOrderId,
      obstacleTarget: floorBlockerTarget,
    });

    await page.waitForFunction(({ candidateId, blockerId }) => {
      const scene = window.__fw?.scene3d?.scene;
      const find = (id) => scene?.getObjectByName(`DeliveryBox_${id}`)
        || scene?.getObjectByName(`DeliveryBoxFallback_${id}`);
      return !!find(candidateId) && !!find(blockerId);
    }, { candidateId: staged.candidate.id, blockerId: staged.blocker.id }, { timeout: 30000 });
    await page.waitForTimeout(500);
    return staged;
  }

  async function surfacePoint(surfaceId, local = { x: 0, z: 0 }) {
    return page.evaluate(async ({ id, offset }) => {
      const P = await import('/src/sim/boxPlacement.js');
      const app = window.__fw;
      const clubhouse = app.scene3d.clubhouse();
      const surface = P.surfaceById(app.state, id);
      if (!surface?.available || !surface.worldPose) {
        throw new Error(`Placement surface ${id} is unavailable.`);
      }
      if (surface.kind === 'equipment-socket') {
        const pose = clubhouse.deliveryEquipmentPose(surface.equipmentId, surface.socketId);
        if (!pose?.position) throw new Error(`Missing live equipment socket ${id}.`);
        return {
          x: pose.position.x,
          y: pose.position.y,
          z: pose.position.z,
          surfaceId: surface.id,
          label: surface.label,
          kind: surface.kind,
        };
      }
      const cosine = Math.cos(surface.worldPose.ry);
      const sine = Math.sin(surface.worldPose.ry);
      const origin = clubhouse.interior.position;
      let supportY = origin.y + surface.worldPose.y;
      if (surface.kind === 'pallet') {
        const anchor = app.scene3d.scene.getObjectByName(
          `DeliveryPallet_${surface.palletIndex + 1}`,
        );
        if (!anchor) throw new Error(`Missing pallet anchor ${surface.palletIndex + 1}.`);
        const anchorWorld = anchor.getWorldPosition(anchor.position.clone());
        supportY = anchorWorld.y + surface.worldPose.y;
      }
      return {
        x: origin.x + surface.worldPose.x + cosine * offset.x + sine * offset.z,
        y: supportY,
        z: origin.z + surface.worldPose.z - sine * offset.x + cosine * offset.z,
        surfaceId: surface.id,
        label: surface.label,
        kind: surface.kind,
      };
    }, { id: surfaceId, offset: local });
  }

  async function aimAtPoint(point, { distance = 1.42, approach = [0, 1] } = {}) {
    const magnitude = Math.hypot(approach[0], approach[1]) || 1;
    const unit = [approach[0] / magnitude, approach[1] / magnitude];
    const cameraXZ = {
      x: point.x + unit[0] * distance,
      z: point.z + unit[1] * distance,
    };
    await page.evaluate(({ target, position }) => {
      const app = window.__fw;
      const walk = app.scene3d.walk;
      walk.clearKeys?.();
      walk.state.x = position.x;
      walk.state.z = position.z;
      const dx = target.x - position.x;
      const dz = target.z - position.z;
      walk.state.yaw = Math.atan2(-dx, -dz);
      walk.state.pitch = -0.35;
    }, { target: point, position: cameraXZ });
    await page.waitForTimeout(180);
    await page.evaluate((target) => {
      const app = window.__fw;
      const walk = app.scene3d.walk;
      const camera = app.scene3d.camera;
      const dx = target.x - walk.state.x;
      const dz = target.z - walk.state.z;
      walk.state.yaw = Math.atan2(-dx, -dz);
      walk.state.pitch = Math.max(-1.30, Math.min(1.30,
        Math.atan2(target.y - camera.position.y, Math.hypot(dx, dz))));
    }, point);
    await page.waitForTimeout(360);
    return page.evaluate((target) => {
      const app = window.__fw;
      const walk = app.scene3d.walk.state;
      const origin = app.scene3d.clubhouse().interior.position;
      return {
        target,
        camera: {
          x: +(walk.x - origin.x).toFixed(4),
          z: +(walk.z - origin.z).toFixed(4),
          yaw: +walk.yaw.toFixed(6),
          pitch: +walk.pitch.toFixed(6),
        },
      };
    }, point);
  }

  async function lookAtPoint(point) {
    await page.evaluate((target) => {
      const app = window.__fw;
      const walk = app.scene3d.walk;
      const camera = app.scene3d.camera;
      const dx = target.x - walk.state.x;
      const dz = target.z - walk.state.z;
      walk.clearKeys?.();
      walk.state.yaw = Math.atan2(-dx, -dz);
      walk.state.pitch = Math.max(-1.30, Math.min(1.30,
        Math.atan2(target.y - camera.position.y, Math.hypot(dx, dz))));
    }, point);
    await page.waitForTimeout(45);
    return focusLabel();
  }

  async function aimAtSurface(surfaceId, options = {}) {
    const point = await surfacePoint(surfaceId, options.local || { x: 0, z: 0 });
    return aimAtPoint(point, options);
  }

  async function equipmentNodePoint(assetId, nodeName) {
    return page.evaluate(({ asset, node }) => {
      const pose = window.__fw?.scene3d?.clubhouse?.()?.deliveryEquipmentPose?.(asset, node);
      if (!pose?.position) throw new Error(`Missing live equipment node ${asset}/${node}.`);
      return {
        x: pose.position.x,
        y: pose.position.y,
        z: pose.position.z,
        asset,
        node,
      };
    }, { asset: assetId, node: nodeName });
  }

  async function aimAtEquipmentNode(assetId, nodeName, options = {}) {
    const point = await equipmentNodePoint(assetId, nodeName);
    return aimAtPoint(point, options);
  }

  async function aimAtBox(boxId, options = {}) {
    const point = await page.evaluate(async (id) => {
      const B = await import('/src/data/boxes.js');
      const app = window.__fw;
      const box = app.state.shop.deliveries.boxes.find((candidate) => candidate.id === id);
      const root = app.scene3d.scene.getObjectByName(`DeliveryBox_${id}`)
        || app.scene3d.scene.getObjectByName(`DeliveryBoxFallback_${id}`);
      if (!box || !root) throw new Error(`Missing placed box ${id}.`);
      const world = root.getWorldPosition(root.position.clone());
      const dimensions = B.boxDims(box.box);
      return { x: world.x, y: world.y + dimensions.h / 2, z: world.z };
    }, boxId);
    return aimAtPoint(point, options);
  }

  async function aimAtBoxNode(boxId, nodeName, { distance = 0.92, lateral = 0 } = {}) {
    const view = await page.evaluate(({ id, name, side }) => {
      const scene = window.__fw.scene3d.scene;
      const root = scene.getObjectByName(`DeliveryBox_${id}`)
        || scene.getObjectByName(`DeliveryBoxFallback_${id}`);
      const node = root?.getObjectByName(name);
      if (!root || !node) throw new Error(`Missing live carton node ${id}/${name}.`);
      root.updateWorldMatrix(true, true);
      const rootWorld = root.getWorldPosition(root.position.clone());
      // Some authored identity meshes bake their face offset into geometry while
      // leaving the Object3D origin at the carton root. Aim at the live mesh
      // bounds instead of its transform origin so opposite-face proof cannot
      // silently capture the shipping label from behind.
      const target = node.position.clone().set(0, 0, 0);
      if (node.isMesh && node.geometry) {
        if (!node.geometry.boundingBox) node.geometry.computeBoundingBox();
        node.geometry.boundingBox.getCenter(target);
        node.localToWorld(target);
      } else {
        node.getWorldPosition(target);
      }
      let dx = target.x - rootWorld.x;
      let dz = target.z - rootWorld.z;
      const magnitude = Math.hypot(dx, dz) || 1;
      dx /= magnitude;
      dz /= magnitude;
      const approach = [dx - dz * side, dz + dx * side];
      return {
        point: { x: target.x, y: target.y, z: target.z },
        approach,
        root: root.name,
        node: node.name,
        outward: { x: dx, z: dz },
      };
    }, { id: boxId, name: nodeName, side: lateral });
    return { ...view, ...(await aimAtPoint(view.point, { distance, approach: view.approach })) };
  }

  async function cartonLabelSnapshot(boxId) {
    return page.evaluate((id) => {
      const scene = window.__fw.scene3d.scene;
      const root = scene.getObjectByName(`DeliveryBox_${id}`)
        || scene.getObjectByName(`DeliveryBoxFallback_${id}`);
      const label = root?.getObjectByName('LABEL_DYNAMIC');
      const frontIdentity = root?.getObjectByName('LABEL_MAIN');
      if (!root || !label?.isMesh || !label.geometry) {
        throw new Error(`Missing live generic shipping label for carton ${id}.`);
      }
      root.updateWorldMatrix(true, true);
      const positions = label.geometry.getAttribute('position');
      const uv = label.geometry.getAttribute('uv');
      if (!positions || !uv || positions.count < 4 || uv.count !== positions.count) {
        throw new Error('Shipping label is missing its explicit position/UV corners.');
      }
      const entries = [];
      for (let index = 0; index < positions.count; index += 1) {
        const point = label.position.clone().set(
          positions.getX(index), positions.getY(index), positions.getZ(index),
        ).applyMatrix4(label.matrixWorld);
        entries.push({ index, u: uv.getX(index), v: uv.getY(index), point });
      }
      const corner = (u, v) => entries.reduce((best, entry) => {
        const score = Math.abs(entry.u - u) + Math.abs(entry.v - v);
        return !best || score < best.score ? { entry, score } : best;
      }, null).entry;
      const p00 = corner(0, 0).point;
      const p10 = corner(1, 0).point;
      const p01 = corner(0, 1).point;
      const uVector = p10.clone().sub(p00);
      const vVector = p01.clone().sub(p00);
      const uLength = uVector.length();
      const vLength = vVector.length();
      const normal = uVector.clone().cross(vVector).normalize();
      const rootWorld = root.getWorldPosition(root.position.clone());
      const labelWorld = label.getWorldPosition(label.position.clone());
      const material = Array.isArray(label.material) ? label.material[0] : label.material;
      const image = material?.map?.image;
      return {
        root: root.name,
        labelNode: label.name,
        frontIdentityNode: frontIdentity?.name || null,
        vertexCount: positions.count,
        uvCount: uv.count,
        uvRange: {
          minU: Math.min(...entries.map((entry) => entry.u)),
          maxU: Math.max(...entries.map((entry) => entry.u)),
          minV: Math.min(...entries.map((entry) => entry.v)),
          maxV: Math.max(...entries.map((entry) => entry.v)),
        },
        worldWidth: +uLength.toFixed(5),
        worldHeight: +vLength.toFixed(5),
        worldAspect: +(uLength / Math.max(0.00001, vLength)).toFixed(5),
        horizontalAxisVerticalComponent: +Math.abs(uVector.normalize().y).toFixed(6),
        verticalAxisVerticalComponent: +Math.abs(vVector.normalize().y).toFixed(6),
        surfaceNormalVerticalComponent: +Math.abs(normal.y).toFixed(6),
        distanceFromRoot: +labelWorld.distanceTo(rootWorld).toFixed(5),
        canvasWidth: Number(image?.width) || null,
        canvasHeight: Number(image?.height) || null,
        canvasAspect: image?.width && image?.height
          ? +(image.width / image.height).toFixed(5) : null,
        flipY: material?.map?.flipY ?? null,
        repeatX: material?.map?.repeat?.x ?? null,
        offsetX: material?.map?.offset?.x ?? null,
        compensatedSurfaceAspect: Number(material?.map?.userData?.deliveryLabelSurfaceAspect) || null,
        canvasScaleX: Number(material?.map?.userData?.deliveryLabelCanvasScaleX) || null,
      };
    }, boxId);
  }

  async function installEquipmentFocusRecorder(kind, baselineCycles) {
    await page.evaluate(({ equipmentKind, cycles }) => {
      const recorder = {
        equipmentKind,
        baselineCycles: cycles,
        seenActive: false,
        complete: false,
        samples: [],
      };
      window.__boxPlacementEquipmentFocusRecorder = recorder;
      const tick = () => {
        const diagnostics = window.__fw?.scene3d?.clubhouse?.()?.deliveryEquipmentDiagnostics?.();
        const status = diagnostics?.[equipmentKind];
        if (!status) {
          recorder.error = `Missing equipment diagnostics ${equipmentKind}.`;
          recorder.complete = true;
          return;
        }
        if (status.active) recorder.seenActive = true;
        if (recorder.seenActive) {
          recorder.samples.push({
            active: !!status.active,
            phase: status.phase,
            progress: status.progress,
            cycles: status.cycles,
            label: window.__fw?.scene3d?.walk?.getFocusLabel?.() || null,
          });
        }
        if (recorder.seenActive && !status.active && status.cycles >= cycles + 1) {
          recorder.complete = true;
          return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }, { equipmentKind: kind, cycles: baselineCycles });
  }

  async function finishEquipmentFocusRecorder(timeout = 7000) {
    await page.waitForFunction(() => (
      window.__boxPlacementEquipmentFocusRecorder?.complete === true
    ), null, { timeout });
    return page.evaluate(() => {
      const recorder = window.__boxPlacementEquipmentFocusRecorder;
      const activeSamples = recorder.samples.filter((entry) => entry.active);
      return {
        ...recorder,
        activeSampleCount: activeSamples.length,
        phases: [...new Set(activeSamples.map((entry) => entry.phase))],
        activeLabels: [...new Set(activeSamples.map((entry) => entry.label))],
      };
    });
  }

  async function cutterVisualSnapshot(boxId) {
    return page.evaluate((id) => {
      const scene = window.__fw.scene3d.scene;
      const camera = window.__fw.scene3d.camera;
      const visual = scene.getObjectByName('DeliveryBoxCutterVisual');
      const cutter = visual?.parent || null;
      const root = scene.getObjectByName(`DeliveryBox_${id}`)
        || scene.getObjectByName(`DeliveryBoxFallback_${id}`);
      if (!visual || !cutter || !root) throw new Error('Missing cutter or live carton visual.');
      visual.updateWorldMatrix(true, true);
      root.updateWorldMatrix(true, true);
      const blade = cutter.userData.deliveryCutterBlade || null;
      const contact = cutter.userData.deliveryCutterContact || blade || null;
      const visibleInHierarchy = (object) => {
        let cursor = object;
        while (cursor) {
          if (!cursor.visible) return false;
          if (cursor === scene) return true;
          cursor = cursor.parent;
        }
        return false;
      };
      let skinOrCuffMeshCount = 0;
      let visibleMeshCount = 0;
      const projected = [];
      cutter.traverse((object) => {
        if (!object.isMesh) return;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        if (materials.some((material) => {
          const hex = material?.color?.getHex?.();
          return hex === 0xd9a97e || hex === 0x2f4a35;
        })) skinOrCuffMeshCount += 1;
        if (!visibleInHierarchy(object)) return;
        visibleMeshCount += 1;
        if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
        const bounds = object.geometry.boundingBox;
        if (!bounds) return;
        for (const x of [bounds.min.x, bounds.max.x]) {
          for (const y of [bounds.min.y, bounds.max.y]) {
            for (const z of [bounds.min.z, bounds.max.z]) {
              const point = bounds.min.clone().set(x, y, z).applyMatrix4(object.matrixWorld).project(camera);
              projected.push({
                x: (point.x * 0.5 + 0.5) * innerWidth,
                y: (-point.y * 0.5 + 0.5) * innerHeight,
              });
            }
          }
        }
      });
      const boxWorld = root.getWorldPosition(root.position.clone());
      const contactWorld = contact?.getWorldPosition(contact.position.clone()) || null;
      const minX = projected.length ? Math.min(...projected.map((entry) => entry.x)) : null;
      const maxX = projected.length ? Math.max(...projected.map((entry) => entry.x)) : null;
      const minY = projected.length ? Math.min(...projected.map((entry) => entry.y)) : null;
      const maxY = projected.length ? Math.max(...projected.map((entry) => entry.y)) : null;
      const visibleTapeSegments = [];
      root.traverse((object) => {
        if (/^TAPE_CENTER_SEG_/i.test(object.name || '') && visibleInHierarchy(object)) {
          visibleTapeSegments.push(object.name);
        }
      });
      return {
        tool: window.__fw.scene3d.walk.getTool?.() || null,
        authoredModel: !!visual.getObjectByName('DeliveryBoxCutterAuthored'),
        fallbackModel: !!visual.getObjectByName('DeliveryBoxCutterLoadingFallback')?.children?.length,
        visibleMeshCount,
        skinOrCuffMeshCount,
        bladeVisible: !!blade && visibleInHierarchy(blade),
        contactVisible: !!contact && visibleInHierarchy(contact),
        contactToBoxHorizontal: contactWorld
          ? +Math.hypot(contactWorld.x - boxWorld.x, contactWorld.z - boxWorld.z).toFixed(5)
          : null,
        contactAboveBoxOrigin: contactWorld ? +(contactWorld.y - boxWorld.y).toFixed(5) : null,
        screenBounds: projected.length ? {
          left: +minX.toFixed(2), top: +minY.toFixed(2),
          width: +(maxX - minX).toFixed(2), height: +(maxY - minY).toFixed(2),
        } : null,
        visibleTapeSegmentCount: visibleTapeSegments.length,
        visibleTapeSegments,
      };
    }, boxId);
  }

  async function cutterPathProjection() {
    return page.evaluate(() => {
      const app = window.__fw;
      const scene = app.scene3d.scene;
      const camera = app.scene3d.camera;
      const canvas = document.querySelector('canvas');
      const guide = scene.getObjectByName('BoxCutterActiveTapeGuide');
      const ribbon = scene.getObjectByName('BoxCutterActiveTapeRibbon');
      const attribute = guide?.geometry?.getAttribute?.('position');
      if (!guide?.visible || !ribbon?.visible || !attribute || attribute.count < 2 || !canvas) {
        throw new Error('The live authored box-cutter tape guide is unavailable.');
      }
      guide.updateWorldMatrix(true, false);
      camera.updateMatrixWorld(true);
      const Vector3 = camera.position.constructor;
      const project = (index) => {
        const world = new Vector3(
          attribute.getX(index), attribute.getY(index), attribute.getZ(index),
        ).applyMatrix4(guide.matrixWorld);
        const clip = world.clone().project(camera);
        return {
          world: { x: world.x, y: world.y, z: world.z },
          clip: { x: clip.x, y: clip.y, z: clip.z },
          x: (clip.x * 0.5 + 0.5) * (canvas.clientWidth || canvas.width || innerWidth),
          y: (0.5 - clip.y * 0.5) * (canvas.clientHeight || canvas.height || innerHeight),
        };
      };
      const start = project(0);
      const end = project(1);
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const length = Math.hypot(dx, dy);
      if (!(length > 0.001) || !Number.isFinite(length)) {
        throw new Error(`Authored cutter path projected to ${length} pixels.`);
      }
      return {
        guide: guide.name,
        ribbon: {
          name: ribbon.name,
          visible: ribbon.visible,
          width: ribbon.scale.x,
          thickness: ribbon.scale.y,
          length: ribbon.scale.z,
          opacity: ribbon.material?.opacity ?? null,
          depthTest: ribbon.material?.depthTest ?? null,
        },
        start,
        end,
        dx,
        dy,
        length,
        unitX: dx / length,
        unitY: dy / length,
        normalizationPixels: Math.max(24, length),
        canvas: { width: canvas.clientWidth, height: canvas.clientHeight },
      };
    });
  }

  async function installCutterDragInputTrace(projection) {
    await page.evaluate((pathProjection) => {
      window.__boxCutterDragInputTrace?.cleanup?.();
      const trace = {
        expectedUnit: { x: pathProjection.unitX, y: pathProjection.unitY },
        lmbDownCount: 0,
        lmbUpCount: 0,
        eKeyDownCount: 0,
        eKeyUpCount: 0,
        pointerHeld: false,
        moves: [],
        cameraBefore: {
          yaw: window.__fw.scene3d.walk.state.yaw,
          pitch: window.__fw.scene3d.walk.state.pitch,
        },
      };
      const onPointerDown = (event) => {
        if (event.button !== 0) return;
        trace.lmbDownCount += 1;
        trace.pointerHeld = true;
        queueMicrotask(() => {
          trace.sprayingAfterDown = !!window.__fw.scene3d.walk.isSpraying?.();
        });
      };
      const onPointerUp = (event) => {
        if (event.button !== 0) return;
        trace.lmbUpCount += 1;
        trace.pointerHeld = false;
        // The production listener runs earlier on window during bubbling, so
        // defer the release-state sample until that handler has completed.
        queueMicrotask(() => {
          trace.sprayingAfterUp = !!window.__fw.scene3d.walk.isSpraying?.();
        });
      };
      const onMouseMove = (event) => {
        if (!trace.pointerHeld) return;
        const movementX = Number(event.movementX) || 0;
        const movementY = Number(event.movementY) || 0;
        const along = movementX * trace.expectedUnit.x + movementY * trace.expectedUnit.y;
        const cross = movementX * trace.expectedUnit.y - movementY * trace.expectedUnit.x;
        trace.moves.push({
          movementX,
          movementY,
          along,
          cross,
          spraying: !!window.__fw.scene3d.walk.isSpraying?.(),
        });
      };
      const onKeyDown = (event) => {
        if (event.key.toLowerCase() === 'e') trace.eKeyDownCount += 1;
      };
      const onKeyUp = (event) => {
        if (event.key.toLowerCase() === 'e') trace.eKeyUpCount += 1;
      };
      trace.cleanup = () => {
        document.removeEventListener('pointerdown', onPointerDown, true);
        window.removeEventListener('pointerup', onPointerUp, true);
        document.removeEventListener('mousemove', onMouseMove, true);
        document.removeEventListener('keydown', onKeyDown, true);
        document.removeEventListener('keyup', onKeyUp, true);
      };
      document.addEventListener('pointerdown', onPointerDown, true);
      window.addEventListener('pointerup', onPointerUp, true);
      document.addEventListener('mousemove', onMouseMove, true);
      document.addEventListener('keydown', onKeyDown, true);
      document.addEventListener('keyup', onKeyUp, true);
      window.__boxCutterDragInputTrace = trace;
    }, projection);
  }

  async function finishCutterDragInputTrace() {
    await page.waitForTimeout(0);
    return page.evaluate(() => {
      const trace = window.__boxCutterDragInputTrace;
      if (!trace) throw new Error('Missing box-cutter drag input trace.');
      trace.cameraAfter = {
        yaw: window.__fw.scene3d.walk.state.yaw,
        pitch: window.__fw.scene3d.walk.state.pitch,
      };
      trace.sprayingAtFinish = !!window.__fw.scene3d.walk.isSpraying?.();
      trace.cleanup?.();
      delete trace.cleanup;
      const forwardMovementEvents = trace.moves.filter((move) => move.along > 0).length;
      const backwardMovementEvents = trace.moves.filter((move) => move.along < 0).length;
      const alongPixels = trace.moves.reduce((sum, move) => sum + move.along, 0);
      const crossPixels = trace.moves.reduce((sum, move) => sum + Math.abs(move.cross), 0);
      const result = {
        ...trace,
        movementEventCount: trace.moves.length,
        forwardMovementEvents,
        backwardMovementEvents,
        alongPixels,
        crossPixels,
        crossToForwardRatio: crossPixels / Math.max(0.001, alongPixels),
        cameraDelta: {
          yaw: trace.cameraAfter.yaw - trace.cameraBefore.yaw,
          pitch: trace.cameraAfter.pitch - trace.cameraBefore.pitch,
        },
      };
      delete window.__boxCutterDragInputTrace;
      return result;
    });
  }

  async function focusLabel() {
    return page.evaluate(() => window.__fw?.scene3d?.walk?.getFocusLabel?.() || null);
  }

  async function promptLayout() {
    return page.evaluate(() => {
      const element = document.querySelector('.shop-prompt');
      if (!element) return { visible: false, text: null, lineCount: 0, wraps: false };
      const style = getComputedStyle(element);
      const range = document.createRange();
      range.selectNodeContents(element);
      const lineTops = [...range.getClientRects()]
        .filter((rect) => rect.width > 0 && rect.height > 0)
        .map((rect) => Math.round(rect.top * 2) / 2)
        .filter((value, index, values) => values.indexOf(value) === index);
      const rect = element.getBoundingClientRect();
      return {
        visible: style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0,
        text: element.textContent?.trim() || null,
        lineCount: lineTops.length,
        wraps: lineTops.length > 1,
        lineTops,
        width: +rect.width.toFixed(2),
        height: +rect.height.toFixed(2),
        maxWidth: style.maxWidth,
        viewportWidth: innerWidth,
      };
    });
  }

  async function waitForFocus(pattern, timeout = 7000) {
    await page.waitForFunction(({ source, flags }) => {
      const label = window.__fw?.scene3d?.walk?.getFocusLabel?.() || '';
      return new RegExp(source, flags).test(label);
    }, { source: pattern.source, flags: pattern.flags }, { timeout });
    return focusLabel();
  }

  async function candidateSnapshot(boxId) {
    return page.evaluate((id) => {
      const app = window.__fw;
      const box = app.state.shop.deliveries.boxes.find((candidate) => candidate.id === id);
      if (!box) throw new Error(`Candidate box ${id} is missing.`);
      const root = app.scene3d.scene.getObjectByName(`DeliveryBox_${id}`)
        || app.scene3d.scene.getObjectByName(`DeliveryBoxFallback_${id}`);
      return {
        id: box.id,
        orderId: box.orderId,
        skuId: box.skuId,
        box: box.box,
        qty: box.qty,
        initialQty: box.initialQty,
        loc: box.loc,
        surfaceId: box.surfaceId || null,
        x: Number.isFinite(box.x) ? box.x : null,
        z: Number.isFinite(box.z) ? box.z : null,
        ry: Number.isFinite(box.ry) ? box.ry : null,
        padPalletIndex: Number.isInteger(box.padPalletIndex) ? box.padPalletIndex : null,
        equipmentId: box.equipmentId || null,
        socketId: box.socketId || null,
        lifecycle: box.lifecycle,
        tape: box.tape,
        cutProgress: box.cutProgress,
        flapProgress: [...(box.flapProgress || [])],
        carriedBoxId: app.state.shop.deliveries.boxes.find((entry) => entry.loc === 'carried')?.id || null,
        carryGoods: app.state.shop.carry ? { ...app.state.shop.carry } : null,
        visualExists: !!root,
        pointerLocked: document.pointerLockElement === document.querySelector('canvas'),
      };
    }, boxId);
  }

  async function candidateVisualVisibility(boxId) {
    return page.evaluate((id) => {
      const scene = window.__fw.scene3d.scene;
      const root = scene.getObjectByName(`DeliveryBox_${id}`)
        || scene.getObjectByName(`DeliveryBoxFallback_${id}`);
      if (!root) throw new Error(`Candidate visual ${id} is missing.`);
      const hierarchyVisible = (object) => {
        let cursor = object;
        while (cursor) {
          if (!cursor.visible) return false;
          if (cursor === root) return true;
          cursor = cursor.parent;
        }
        return false;
      };
      const packing = [];
      const products = [];
      root.traverse((object) => {
        const name = object.name || '';
        const entry = { name, localVisible: object.visible, hierarchyVisible: hierarchyVisible(object) };
        if (/INSERT|TISSUE|DIVIDER/i.test(name)) packing.push(entry);
        if (/^BOX_CONTENT_/i.test(name)) products.push(entry);
      });
      return {
        root: root.name,
        packing,
        products,
        allPackingHidden: packing.length > 0 && packing.every((entry) => !entry.hierarchyVisible),
        allProductsHidden: products.length > 0 && products.every((entry) => !entry.hierarchyVisible),
      };
    }, boxId);
  }

  async function placementArrowSnapshot() {
    return page.evaluate(() => {
      const scene = window.__fw.scene3d.scene;
      const root = scene.getObjectByName('BoxPlacementGhost');
      const envelope = scene.getObjectByName('BoxPlacementEnvelope');
      const footprint = scene.getObjectByName('BoxPlacementFootprint');
      const facingCue = scene.getObjectByName('BoxPlacementFacingCue');
      const attribute = footprint?.geometry?.getAttribute?.('position');
      const cueAttribute = facingCue?.geometry?.getAttribute?.('position');
      if (!root || !envelope || !footprint || !facingCue || !attribute || !cueAttribute
          || attribute.count < 10) {
        throw new Error('Placement arrow scene graph is incomplete.');
      }
      root.updateWorldMatrix(true, true);
      const worldVertex = (index) => footprint.localToWorld(
        footprint.position.clone().set(
          attribute.getX(index), attribute.getY(index), attribute.getZ(index),
        ),
      );
      const tail = worldVertex(8);
      const tip = worldVertex(9);
      const dx = tip.x - tail.x;
      const dz = tip.z - tail.z;
      const magnitude = Math.hypot(dx, dz) || 1;
      const diagnostics = window.__fw.scene3d.clubhouse().boxPlacement.diagnostics();
      return {
        visible: root.visible && footprint.visible,
        vertexCount: attribute.count,
        segmentCount: attribute.count / 2,
        envelopeOpacity: envelope.material?.opacity ?? null,
        envelopeSide: envelope.material?.side ?? null,
        footprintOpacity: footprint.material?.opacity ?? null,
        footprintDepthTest: footprint.material?.depthTest ?? null,
        colour: footprint.material?.color?.getHex?.() ?? null,
        facingCueVisible: facingCue.visible,
        facingCueVertexCount: cueAttribute.count,
        facingCueOpacity: facingCue.material?.opacity ?? null,
        facingCueDepthTest: facingCue.material?.depthTest ?? null,
        facingCueColour: facingCue.material?.color?.getHex?.() ?? null,
        rootRotationY: root.rotation.y,
        diagnosticRotationY: diagnostics.rotationY,
        tail: { x: +tail.x.toFixed(5), z: +tail.z.toFixed(5) },
        tip: { x: +tip.x.toFixed(5), z: +tip.z.toFixed(5) },
        direction: { x: +(dx / magnitude).toFixed(6), z: +(dz / magnitude).toFixed(6) },
        arrowLength: +magnitude.toFixed(6),
      };
    });
  }

  async function waitForToastSilenceAfterReload() {
    const startedAt = Date.now();
    await page.waitForTimeout(1700);
    await page.waitForFunction(() => document.querySelectorAll('.toast').length === 0, null, {
      timeout: 7000,
    });
    return {
      elapsedMs: Date.now() - startedAt,
      remainingToasts: await page.locator('.toast').count(),
    };
  }

  async function placementDiagnostics() {
    return page.evaluate(() => ({
      ...window.__fw.scene3d.clubhouse().boxPlacement.diagnostics(),
      label: window.__fw.scene3d.clubhouse().boxPlacement.label(),
    }));
  }

  async function waitForPlacement(surfaceId, legal, timeout = 7000) {
    await page.waitForFunction(({ id, expectedLegal }) => {
      const diagnostics = window.__fw?.scene3d?.clubhouse?.()?.boxPlacement?.diagnostics?.();
      return diagnostics?.active
        && diagnostics.visible
        && diagnostics.surfaceId === id
        && diagnostics.legal === expectedLegal;
    }, { id: surfaceId, expectedLegal: legal }, { timeout });
    return placementDiagnostics();
  }

  const captures = [];
  async function capture(fileName, description) {
    const file = path.join(out, fileName);
    await page.screenshot({ path: file });
    const context = await page.evaluate(() => {
      const app = window.__fw;
      const walk = app.scene3d.walk.state;
      const origin = app.scene3d.clubhouse().interior.position;
      return {
        pointerLocked: document.pointerLockElement === document.querySelector('canvas'),
        focus: app.scene3d.walk.getFocusLabel?.() || null,
        camera: {
          x: +(walk.x - origin.x).toFixed(4),
          z: +(walk.z - origin.z).toFixed(4),
          yaw: +walk.yaw.toFixed(6),
          pitch: +walk.pitch.toFixed(6),
        },
        placement: app.scene3d.clubhouse().boxPlacement.diagnostics(),
      };
    });
    captures.push({ file, description, ...context });
    fs.writeFileSync(path.join(out, 'run-state.json'), `${JSON.stringify({
      status: 'running',
      iteration,
      captures,
      updatedAt: new Date().toISOString(),
    }, null, 2)}\n`);
    return captures[captures.length - 1];
  }

  const route = [];
  let fixture = null;
  async function recordCommit(step, expected) {
    const state = await candidateSnapshot(fixture.candidate.id);
    route.push({ step, expected, state });
    return state;
  }

  async function normalPickup({ key, focusPattern, approach }) {
    await aimAtBox(fixture.candidate.id, approach);
    const label = await waitForFocus(focusPattern);
    const prompt = await promptLayout();
    await page.keyboard.press(key);
    await page.waitForFunction((id) => {
      const boxes = window.__fw?.state?.shop?.deliveries?.boxes || [];
      return boxes.find((box) => box.id === id)?.loc === 'carried';
    }, fixture.candidate.id, { timeout: 7000 });
    await page.waitForFunction(() => (
      window.__fw?.scene3d?.clubhouse?.()?.boxPlacement?.isActive?.() === true
    ), null, { timeout: 7000 });
    await page.waitForTimeout(250);
    return { key, label, prompt, state: await candidateSnapshot(fixture.candidate.id) };
  }

  async function normalCommit({
    step,
    surfaceId,
    local = { x: 0, z: 0 },
    approach,
    expected,
    screenshot,
    description,
    committedFocusPattern = null,
  }) {
    await aimAtSurface(surfaceId, { local, ...approach });
    const preview = await waitForPlacement(surfaceId, true);
    requireTruth(preview.colour === placementGreen,
      `${step} expected green ${placementGreen.toString(16)}, got ${preview.colour?.toString(16)}.`);
    await capture(screenshot.replace('.png', '-green.png'), `${description} Green exact preview before E commit.`);
    await page.keyboard.press('e');
    await page.waitForFunction(({ id, loc, surface, palletIndex, equipmentId, socketId }) => {
      const box = (window.__fw?.state?.shop?.deliveries?.boxes || [])
        .find((candidate) => candidate.id === id);
      if (!box || box.loc !== loc) return false;
      if (surface != null && box.surfaceId !== surface) return false;
      if (palletIndex != null && box.padPalletIndex !== palletIndex) return false;
      if (equipmentId != null && box.equipmentId !== equipmentId) return false;
      if (socketId != null && box.socketId !== socketId) return false;
      return true;
    }, { id: fixture.candidate.id, ...expected }, { timeout: 7000 });
    await page.waitForTimeout(300);
    await aimAtBox(fixture.candidate.id, approach);
    const committedFocus = committedFocusPattern
      ? await waitForFocus(committedFocusPattern)
      : await focusLabel();
    await capture(screenshot, description);
    const committed = await recordCommit(step, expected);
    requireTruth(
      committed.qty === 12
        && committed.lifecycle === 'SEALED'
        && committed.tape === 0
        && committed.cutProgress === 0,
      `${step} commit mutated the sealed carton before explicit cutter equip/drag: `
        + `qty=${committed.qty}, lifecycle=${committed.lifecycle}, tape=${committed.tape}, `
        + `cutProgress=${committed.cutProgress}.`,
    );
    return { preview, committed, committedFocus };
  }

  async function autosaveSnapshot(boxId) {
    return page.evaluate(async (id) => {
      const app = window.__fw;
      await app.autosave();
      const raw = localStorage.getItem('golfempire:autosave');
      if (!raw) throw new Error('Autosave did not create golfempire:autosave.');
      const empire = JSON.parse(raw);
      const holding = empire.holdings.find((candidate) => candidate.property.id === empire.activeId);
      if (!holding) throw new Error(`Autosave is missing active holding ${empire.activeId}.`);
      const box = holding.state.shop.deliveries.boxes.find((candidate) => candidate.id === id);
      if (!box) throw new Error(`Autosave is missing placement box ${id}.`);
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
      const rawSha256 = [...new Uint8Array(digest)]
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
      return {
        storageKey: 'golfempire:autosave',
        rawBytes: raw.length,
        rawSha256,
        activeId: empire.activeId,
        box: {
          id: box.id,
          orderId: box.orderId,
          skuId: box.skuId,
          box: box.box,
          qty: box.qty,
          initialQty: box.initialQty,
          schemaVersion: box.schemaVersion,
          loc: box.loc,
          surfaceId: box.surfaceId || null,
          x: Number.isFinite(box.x) ? box.x : null,
          z: Number.isFinite(box.z) ? box.z : null,
          ry: Number.isFinite(box.ry) ? box.ry : null,
          padPalletIndex: Number.isInteger(box.padPalletIndex) ? box.padPalletIndex : null,
          equipmentId: box.equipmentId || null,
          socketId: box.socketId || null,
          lifecycle: box.lifecycle,
          tape: box.tape,
          cutProgress: box.cutProgress,
          flapProgress: [...(box.flapProgress || [])],
        },
      };
    }, boxId);
  }

  try {
  await firstBoot();
  const viewport = await page.evaluate(() => ({
    width: innerWidth,
    height: innerHeight,
    deviceScaleFactor: devicePixelRatio,
  }));
  fixture = await stageFixture();

  // Ref 45 is targeted at its authored live HANDLE_GRIP_TARGET rather than the
  // pallet body. Exercise one raise and one lowering stroke through normal E,
  // leaving the coupled pallet in its original state for the placement route.
  const palletJackHandleView = await aimAtEquipmentNode(
    'delivery_pallet_jack', 'HANDLE_GRIP_TARGET', palletJackCamera,
  );
  const palletJackHandleTarget = await equipmentNodePoint(
    'delivery_pallet_jack', 'HANDLE_GRIP_TARGET',
  );
  const palletJackFocusBefore = await waitForFocus(/Pallet jack.*pump once to raise the forks/i);
  const palletJackBefore = await page.evaluate(() => (
    window.__fw.scene3d.clubhouse().deliveryEquipmentDiagnostics().palletJack
  ));
  await capture('00a-pallet-jack-handle-e-focus.png',
    'The live HANDLE_GRIP_TARGET, not the pallet body, owns the normal E hydraulic-pump action.');
  await page.keyboard.press('e');
  await page.waitForFunction((cycles) => {
    const status = window.__fw.scene3d.clubhouse().deliveryEquipmentDiagnostics().palletJack;
    return status.active && status.cycles === cycles && status.phase === 'lift';
  }, palletJackBefore.cycles, { timeout: 7000 });
  const movingPalletJackHandle = await equipmentNodePoint(
    'delivery_pallet_jack', 'HANDLE_GRIP_TARGET',
  );
  await lookAtPoint(movingPalletJackHandle);
  const palletJackPumpFeedback = await waitForFocus(/Pallet jack.*hydraulic stroke in progress/i);
  const palletJackDuringRaise = await page.evaluate(() => (
    window.__fw.scene3d.clubhouse().deliveryEquipmentDiagnostics().palletJack
  ));
  await capture('00b-pallet-jack-normal-e-pump.png',
    'Normal E visibly drives the authored handle and coupled hydraulic lift from HANDLE_GRIP_TARGET.');
  await page.waitForFunction((cycles) => {
    const status = window.__fw.scene3d.clubhouse().deliveryEquipmentDiagnostics().palletJack;
    return !status.active && status.cycles === cycles + 1 && status.raised;
  }, palletJackBefore.cycles, { timeout: 7000 });
  const palletJackAfterRaise = await page.evaluate(() => (
    window.__fw.scene3d.clubhouse().deliveryEquipmentDiagnostics().palletJack
  ));
  await aimAtEquipmentNode('delivery_pallet_jack', 'HANDLE_GRIP_TARGET', palletJackCamera);
  const palletJackFocusRaised = await waitForFocus(/Pallet jack.*pump once to lower the forks/i);
  await page.keyboard.press('e');
  await page.waitForFunction((cycles) => {
    const status = window.__fw.scene3d.clubhouse().deliveryEquipmentDiagnostics().palletJack;
    return status.active && status.cycles === cycles;
  }, palletJackAfterRaise.cycles, { timeout: 7000 });
  await page.waitForFunction((cycles) => {
    const status = window.__fw.scene3d.clubhouse().deliveryEquipmentDiagnostics().palletJack;
    return !status.active && status.cycles === cycles + 1 && !status.raised;
  }, palletJackAfterRaise.cycles, { timeout: 7000 });
  const palletJackAfterRestore = await page.evaluate(() => (
    window.__fw.scene3d.clubhouse().deliveryEquipmentDiagnostics().palletJack
  ));
  await aimAtEquipmentNode('delivery_pallet_jack', 'HANDLE_GRIP_TARGET', palletJackCamera);
  const palletJackFocusRestored = await waitForFocus(/Pallet jack.*pump once to raise the forks/i);

  const pickupSurfaceId = `pallet:receiving:${fixture.candidate.padPalletIndex}`;
  await aimAtBox(fixture.candidate.id, { distance: 1.52, approach: [0, 1] });
  const initialFocus = await waitForFocus(/Delivery: .*\[E\] pick up/i);
  await capture('00-staged-pallet-pickup.png',
    'Deterministic sealed accessories carton staged on an authored receiving pallet before normal E pickup.');
  const idlePerformance = await measure('idle-staged-placement-scene', { samples: 2, durationMs: 1000 });
  await page.keyboard.press('e');
  await page.waitForFunction((id) => (
    window.__fw.state.shop.deliveries.boxes.find((box) => box.id === id)?.loc === 'carried'
  ), fixture.candidate.id);
  await page.waitForFunction(() => window.__fw.scene3d.clubhouse().boxPlacement.isActive());
  await capture('01-normal-e-pickup-carry.png',
    'Normal E pickup carries the exact real-scale sealed carton and automatically enters placement mode.');
  const carryProfileEvidence = await page.evaluate((id) => {
    const root = window.__fw.scene3d.scene.getObjectByName(`DeliveryBox_${id}`)
      || window.__fw.scene3d.scene.getObjectByName(`DeliveryBoxFallback_${id}`);
    if (!root) throw new Error(`Missing carried visual ${id}.`);
    return {
      profile: root.userData.deliveryRuntimeCarryProfile || null,
      baseY: root.userData.deliveryCarryBaseY ?? null,
      position: { x: root.position.x, y: root.position.y, z: root.position.z },
      rotation: { x: root.rotation.x, y: root.rotation.y, z: root.rotation.z },
      handsVisible: !!root.getObjectByName('DeliveryBoxCarryHands')?.visible,
    };
  }, fixture.candidate.id);

  // The floor blocker is a real second box. The nearest physical floor hit is
  // retained and rendered red instead of looking through to another surface.
  await aimAtSurface(surfaceIds.floor, {
    local: floorBlockerTarget,
    distance: 1.42,
    approach: [0, 1],
  });
  const invalidPreview = await waitForPlacement(surfaceIds.floor, false);
  requireTruth(invalidPreview.colour === placementRed,
    `Invalid overlap expected red ${placementRed.toString(16)}, got ${invalidPreview.colour?.toString(16)}.`);
  await capture('02-invalid-red-box-overlap.png',
    'Red preview and blocked prompt over the stationary floor carton prove exact overlap rejection.');

  // A second red target proves authored circulation clearance, independently
  // of the real-carton overlap above. The target is the main-door clearway.
  await aimAtSurface(surfaceIds.floor, {
    local: doorwayBlockedTarget,
    distance: 1.42,
    approach: [0, -1],
  });
  const doorwayPreview = await waitForPlacement(surfaceIds.floor, false);
  requireTruth(doorwayPreview.colour === placementRed
      && /doorway/i.test(doorwayPreview.reason || ''),
  `Doorway clearance expected a red doorway rejection, got "${doorwayPreview.reason}".`);
  await capture('02b-invalid-red-doorway-clearance.png',
    'Red preview at the main entrance proves authored doorway circulation clearance is rejected.');

  await page.keyboard.press('Escape');
  await page.waitForFunction(() => {
    const placement = window.__fw.scene3d.clubhouse().boxPlacement;
    return placement.hasCarriedBox() && !placement.isActive();
  });
  const cancelled = {
    placement: await placementDiagnostics(),
    state: await candidateSnapshot(fixture.candidate.id),
  };
  await capture('03-escape-cancel-keeps-carrying.png',
    'Escape cancels only the ghost; the same carton remains visibly carried with no state mutation.');

  await page.keyboard.press('e');
  await page.waitForFunction(() => window.__fw.scene3d.clubhouse().boxPlacement.isActive());
  await aimAtSurface(surfaceIds.floor, {
    local: floorValidTarget,
    distance: 1.42,
    approach: [0, 1],
  });
  const resumedPreview = await waitForPlacement(surfaceIds.floor, true);
  const beforeRotation = resumedPreview.rotationY;
  const arrowBeforeRotation = await placementArrowSnapshot();
  await capture('04-normal-e-resume-green-floor.png',
    'Normal E resumes the dismissed placement with the in-geometry forward arrow visible in its green footprint.');

  await page.keyboard.press('r');
  await page.waitForFunction((before) => {
    const value = window.__fw.scene3d.clubhouse().boxPlacement.diagnostics();
    return value.legal && value.quarterTurns === 1 && Math.abs(value.rotationY - before) > 1;
  }, beforeRotation);
  const rotatedPreview = await waitForPlacement(surfaceIds.floor, true);
  const arrowAfterRotation = await placementArrowSnapshot();
  requireTruth(rotatedPreview.colour === placementGreen && rotatedPreview.quarterTurns === 1,
    'Normal R did not retain a revalidated green quarter-turn preview.');
  const arrowDirectionDot = arrowBeforeRotation.direction.x * arrowAfterRotation.direction.x
    + arrowBeforeRotation.direction.z * arrowAfterRotation.direction.z;
  requireTruth(arrowBeforeRotation.vertexCount === 14
      && arrowAfterRotation.vertexCount === 14
      && Math.abs(arrowDirectionDot) <= 0.08,
  `Forward arrow did not rotate one quarter turn (dot ${arrowDirectionDot}).`);
  await capture('05-normal-r-rotated-green-floor.png',
    'Normal R visibly rotates the embedded forward arrow one exact quarter turn and revalidates green.');

  await page.keyboard.press('e');
  await page.waitForFunction(({ id, surface }) => {
    const box = window.__fw.state.shop.deliveries.boxes.find((entry) => entry.id === id);
    return box?.loc === 'world' && box.surfaceId === surface;
  }, { id: fixture.candidate.id, surface: surfaceIds.floor });
  await page.waitForTimeout(300);
  await aimAtBox(fixture.candidate.id, { distance: 1.42, approach: [0, 1] });
  await capture('06-floor-committed.png',
    'E commits the exact rotated green floor target without sinking, floating, or touching the blocker.');
  const floorCommitted = await recordCommit('floor', {
    loc: 'world', surface: surfaceIds.floor,
  });
  requireTruth(floorCommitted.qty === 12
      && floorCommitted.lifecycle === 'SEALED'
      && floorCommitted.tape === 0
      && floorCommitted.cutProgress === 0,
  `floor commit mutated sealed state: ${JSON.stringify(floorCommitted)}.`);

  const floorPickup = await normalPickup({
    key: 'e',
    focusPattern: /\[E\] pick up/i,
    approach: { distance: 1.42, approach: [0, 1] },
  });
  const table = await normalCommit({
    step: 'table',
    surfaceId: surfaceIds.table,
    approach: { distance: 1.42, approach: [0, 1] },
    expected: { loc: 'world', surface: surfaceIds.table },
    screenshot: '07-display-table-committed.png',
    description: 'The same sealed accessories carton settles exactly on the approved authored display tabletop.',
  });

  // Read both authored carton identities at an eye-height support surface. The
  // approach vector is derived from node-to-root direction, so the close view
  // follows the actual rotated carton instead of assuming a global camera yaw.
  const cartonRearView = await aimAtBoxNode(
    fixture.candidate.id, 'LABEL_DYNAMIC', { distance: 1.08, lateral: 0.03 },
  );
  const cartonRearFocus = await waitForFocus(/Tee bag/i);
  const cartonLabelEvidence = await cartonLabelSnapshot(fixture.candidate.id);
  await capture('07a-generic-carton-rear-shipping-label.png',
    'Eye-height close rear evidence shows the live landscape shipping label upright, readable, and unstretched.');
  const cartonFrontView = await aimAtBoxNode(
    fixture.candidate.id, 'LABEL_MAIN', { distance: 1.08, lateral: -0.03 },
  );
  const cartonFrontFocus = await waitForFocus(/Tee bag/i);
  await capture('07b-generic-carton-front-identity.png',
    'Eye-height close opposite-face evidence shows the generic carton crest and front handling identity.');

  const tablePickup = await normalPickup({
    key: 'x',
    focusPattern: /tap \[E\] once to equip the box cutter.*\[X\] reposition closed carton/i,
    approach: { distance: 1.42, approach: [0, 1] },
  });
  const shelf = await normalCommit({
    step: 'shelf',
    surfaceId: surfaceIds.shelf,
    approach: { distance: 1.42, approach: [-1, 0] },
    expected: { loc: 'world', surface: surfaceIds.shelf },
    screenshot: '08-storage-shelf-committed.png',
    description: 'The carton lands on the top east storage-shelf level with shelf-local support and clearance.',
  });

  const shelfPickup = await normalPickup({
    key: 'x',
    focusPattern: /\[X\] reposition closed carton/i,
    approach: { distance: 1.42, approach: [-1, 0] },
  });
  const packing = await normalCommit({
    step: 'packing',
    surfaceId: surfaceIds.packing,
    approach: { distance: 1.85, approach: [0, 1] },
    expected: { loc: 'world', surface: surfaceIds.packing },
    screenshot: '09-packing-bench-committed.png',
    description: 'The approved unpacking bench accepts the sealed carton across its honest clear worktop.',
  });

  // Warm the contextual cutter through the packing bench's stable normal tool
  // path before the matched baseline, then holster with normal F.
  await aimAtBox(fixture.candidate.id, { distance: 1.85, approach: [0, 1] });
  const baselineCutterPrewarmFocus = await waitForFocus(
    /tap \[E\] once to equip the box cutter.*\[X\] reposition closed carton/i,
  );
  await page.keyboard.down('e');
  await page.waitForFunction(() => window.__fw.scene3d.walk.getTool?.() === 'boxcutter', null, {
    timeout: 7000,
  });
  await aimAtBox(fixture.candidate.id, { distance: 1.85, approach: [0, 1] });
  const baselineCutterEquippedFocus = await waitForFocus(
    /\[LMB\] drag along tape.*\[E\] hold alternative.*\[X\] reposition closed carton/i,
  );
  await page.waitForTimeout(800);
  const baselineCutterEquippedResources = await resourceCensus();
  const baselineCutterEquipped = await candidateSnapshot(fixture.candidate.id);
  await page.keyboard.up('e');
  await page.waitForTimeout(160);
  await page.keyboard.press('f');
  await page.waitForFunction(() => window.__fw.scene3d.walk.getTool?.() == null);
  const baselineCutterHolsterToast = await page.evaluate(() => [...document.querySelectorAll('.toast')]
    .map((element) => element.textContent || '')
    .find((text) => /Box cutter put away/i.test(text)) || null);
  const baselineCutterHolsterFocus = await waitForFocus(
    /tap \[E\] once to equip the box cutter.*\[X\] reposition closed carton/i,
  );
  await page.waitForTimeout(500);
  const baselineCutterHolstered = await candidateSnapshot(fixture.candidate.id);
  requireTruth(baselineCutterEquipped.lifecycle === 'SEALED'
      && baselineCutterEquipped.tape === 0
      && baselineCutterHolstered.lifecycle === 'SEALED'
      && baselineCutterHolstered.tape === 0,
  'Normal cutter prewarm mutated the sealed carton.');

  const packingPickup = await normalPickup({
    key: 'x',
    focusPattern: /\[X\] reposition closed carton/i,
    approach: { distance: 1.85, approach: [0, 1] },
  });
  await aimAtSurface(surfaceIds.floor, {
    local: floorValidTarget,
    distance: 1.42,
    approach: [0, 1],
  });
  await waitForPlacement(surfaceIds.floor, true);
  const routeBaselineRendererWarmup = await warmRendererResources('before-route-reload-baseline');
  const routeBaselinePerformance = await measure('active-green-floor-preview-before-route-reload');
  const backcounter = await normalCommit({
    step: 'backcounter',
    surfaceId: surfaceIds.backcounter,
    approach: { distance: 1.42, approach: [0, -1] },
    expected: { loc: 'world', surface: surfaceIds.backcounter },
    screenshot: '10-approved-backcounter-committed.png',
    description: 'The east approved back-counter bay supports one exact carton clear of the checkout devices.',
  });

  const backcounterPickup = await normalPickup({
    key: 'x',
    focusPattern: /tap \[E\] once to equip the box cutter.*\[X\] reposition closed carton/i,
    approach: { distance: 1.42, approach: [0, -1] },
  });
  const pallet = await normalCommit({
    step: 'pallet',
    surfaceId: surfaceIds.pallet,
    approach: { distance: 1.52, approach: [0, 1] },
    expected: { loc: 'pad', palletIndex: 3 },
    screenshot: '11-receiving-pallet-committed.png',
    description: 'Close carton-focused evidence shows the conserved delivery carton on pallet lane 3, not the pallet jack.',
    committedFocusPattern: /Delivery: .*\[E\] pick up/i,
  });

  const palletPickup = await normalPickup({
    key: 'e',
    focusPattern: /Delivery: .*\[E\] pick up/i,
    approach: { distance: 1.52, approach: [0, 1] },
  });
  const cart = await normalCommit({
    step: 'cart',
    surfaceId: surfaceIds.cart,
    approach: { distance: 1.65, approach: [0, 1] },
    expected: {
      loc: 'equipment',
      equipmentId: 'delivery_stocking_cart',
      socketId: 'STOCK_BOX_SOCKET_TOP',
    },
    screenshot: '12-stocking-cart-committed.png',
    description: 'The live authored stocking-cart top socket owns the carton transform and quantity.',
  });

  const cartPickup = await normalPickup({
    key: 'x',
    focusPattern: /\[X\] reposition closed carton/i,
    approach: { distance: 1.65, approach: [0, 1] },
  });
  const handTruck = await normalCommit({
    step: 'hand-truck',
    surfaceId: surfaceIds.handTruck,
    approach: handTruckCamera,
    expected: {
      loc: 'equipment',
      equipmentId: 'delivery_hand_truck',
      socketId: 'LOAD_ORIGIN',
    },
    screenshot: '13-hand-truck-committed.png',
    description: 'The live authored hand-truck LOAD_ORIGIN supports the same carton at the true equipment pose.',
  });

  // Prove carton and parent equipment remain independently targetable in 3D.
  // The hand truck is transport-only: its carton uses normal E pickup and never
  // exposes cutter or X-unpacking verbs.
  await aimAtBox(fixture.candidate.id, handTruckCamera);
  const handTruckCartonFocus = await waitForFocus(/Tee bag .*\[E\] pick up/i);
  const handTruckCartonPrompt = await promptLayout();
  await capture('13a-hand-truck-carton-e-focus.png',
    'Open-aisle carton focus proves transport-only E pickup with no cutter or X verb and no foreground clutter.');

  await aimAtEquipmentNode('delivery_hand_truck', 'INTERACTION_TARGET', {
    ...handTruckCamera,
  });
  const handTruckHandleFocus = await waitForFocus(/tip it back and check the load balance/i);
  const handTruckBeforeTilt = await page.evaluate(() => (
    window.__fw.scene3d.clubhouse().deliveryEquipmentDiagnostics().handTruck
  ));
  await capture('13b-hand-truck-handle-e-focus.png',
    'Crosshair moved to the authored handle independently selects the hand-truck E balance control.');
  await installEquipmentFocusRecorder('handTruck', handTruckBeforeTilt.cycles);
  await page.keyboard.press('e');
  await page.waitForFunction((cycles) => {
    const status = window.__fw.scene3d.clubhouse().deliveryEquipmentDiagnostics().handTruck;
    return status.active && status.cycles === cycles;
  }, handTruckBeforeTilt.cycles);
  await page.waitForFunction(() => (
    window.__fw.scene3d.clubhouse().deliveryEquipmentDiagnostics().handTruck.phase === 'hold'
  ), null, { timeout: 3000 });
  const handTruckTiltFeedback = await waitForFocus(/checking the axle balance/i, 650);
  const handTruckDuringTilt = await page.evaluate(() => (
    window.__fw.scene3d.clubhouse().deliveryEquipmentDiagnostics().handTruck
  ));
  await capture('13c-hand-truck-normal-e-tilt.png',
    'Normal E visibly tips the loaded hand truck while retained axle-balance feedback remains on screen without re-aiming.');
  const handTruckFocusTrace = await finishEquipmentFocusRecorder(7000);
  const handTruckAfterTilt = await page.evaluate(() => (
    window.__fw.scene3d.clubhouse().deliveryEquipmentDiagnostics().handTruck
  ));
  const afterTiltState = await candidateSnapshot(fixture.candidate.id);
  await aimAtBox(fixture.candidate.id, handTruckCamera);
  const handTruckCartonFocusAfterTilt = await waitForFocus(/Tee bag .*\[E\] pick up/i);

  // With the conserved carton still on the hand truck, the separate stocking
  // cart control must remain reachable and report its empty deck through E.
  await aimAtEquipmentNode('delivery_stocking_cart', 'INTERACTION_TARGET', {
    distance: 1.65,
    approach: [0, 1],
  });
  const stockingCartControlFocus = await waitForFocus(/Stocking cart.*top deck ready for a delivery carton/i);
  await capture('13d-stocking-cart-independent-e-focus.png',
    'The empty cart equipment control is independently reachable after its carton-level X route was proven.');
  await page.keyboard.press('e');
  await page.waitForFunction(() => [...document.querySelectorAll('.toast')]
    .some((element) => /Bring a compatible carton here to stage it on the cart/i
      .test(element.textContent || '')), null, { timeout: 3000 });
  const stockingCartToast = await page.evaluate(() => [...document.querySelectorAll('.toast')]
    .map((element) => element.textContent || '')
    .find((text) => /Bring a compatible carton here to stage it on the cart/i.test(text)) || null);
  const afterStockingCartControlState = await candidateSnapshot(fixture.candidate.id);

  await aimAtBox(fixture.candidate.id, handTruckCamera);
  await waitForFocus(/Tee bag .*\[E\] pick up/i);

  const saved = await autosaveSnapshot(fixture.candidate.id);
  await reloadAndContinue();
  const reloadToastSettlement = await waitForToastSilenceAfterReload();
  const reloaded = await candidateSnapshot(fixture.candidate.id);
  await aimAtBox(fixture.candidate.id, handTruckCamera);
  const reloadedFocus = await waitForFocus(/Tee bag .*\[E\] pick up/i);
  await capture('14-hand-truck-after-save-reload.png',
    'After reload toast expiry, the open-aisle view restores the exact sealed transport-only carton on LOAD_ORIGIN.');

  const postReloadPickup = await normalPickup({
    key: 'e',
    focusPattern: /Tee bag .*\[E\] pick up/i,
    approach: handTruckCamera,
  });

  const packingForCut = await normalCommit({
    step: 'packing-for-cut',
    surfaceId: surfaceIds.packing,
    approach: { distance: 1.85, approach: [0, 1] },
    expected: { loc: 'world', surface: surfaceIds.packing },
    screenshot: '15-packing-before-explicit-cutter.png',
    description: 'After reload, normal E places the carton on the unpacking bench still exactly uncut.',
  });
  await aimAtBox(fixture.candidate.id, cutterCamera);
  const cutterFocus = await waitForFocus(/tap \[E\] once to equip the box cutter.*\[X\] reposition closed carton/i);
  const compactCutterPrompt = await promptLayout();
  const sealedInteriorVisibility = await candidateVisualVisibility(fixture.candidate.id);
  await capture('15b-compact-pre-equip-prompt.png',
    'The concise pre-equip prompt presents one E equip action and X reposition on a single unwrapped line.');
  const beforeCutterEquip = await candidateSnapshot(fixture.candidate.id);
  await page.keyboard.press('e');
  await page.waitForFunction(() => window.__fw.scene3d.walk.getTool?.() === 'boxcutter');
  let equippedCutterFocus = await waitForFocus(
    /\[LMB\] drag along tape.*\[E\] hold alternative.*\[X\] reposition closed carton/i,
  );
  await page.waitForTimeout(450);
  // Pointer lock deliberately suppresses its first two relative-movement
  // events. Exhaust that safety guard before the measured drag, then restore
  // the exact deterministic camera because these are mouse-look events when a
  // browser has already consumed the guard.
  await page.mouse.move(801, 450);
  await page.mouse.move(800, 450);
  await aimAtBox(fixture.candidate.id, cutterCamera);
  equippedCutterFocus = await waitForFocus(
    /\[LMB\] drag along tape.*\[E\] hold alternative.*\[X\] reposition closed carton/i,
  );
  await page.waitForTimeout(180);
  const cutterProjection = await cutterPathProjection();
  const afterCutterEquip = await candidateSnapshot(fixture.candidate.id);
  const equippedCutterVisual = await cutterVisualSnapshot(fixture.candidate.id);
  requireTruth(afterCutterEquip.tape === 0
      && afterCutterEquip.cutProgress === 0
      && afterCutterEquip.lifecycle === 'SEALED',
  `Equipping the cutter leaked into cutting: ${JSON.stringify(afterCutterEquip)}.`);
  await capture('16-box-cutter-equipped-no-cut.png',
    'Before the drag, a deliberate E tap has only equipped the cutter: tape and cut progress remain exactly zero.');

  await installCutterDragInputTrace(cutterProjection);
  const cutterDragCursor = { x: 800, y: 450 };
  // Each relative event travels 22% of the projected normalization length.
  // Runtime caps that to 0.12 tape progress, so two measured events provide a
  // visible mid-drag beat and four remain safely inside the first 0.60 seam.
  const cutterDragPixelsPerEvent = cutterProjection.normalizationPixels * 0.22;
  const moveCutterForward = async (count) => {
    for (let index = 0; index < count; index += 1) {
      cutterDragCursor.x += cutterProjection.unitX * cutterDragPixelsPerEvent;
      cutterDragCursor.y += cutterProjection.unitY * cutterDragPixelsPerEvent;
      await page.mouse.move(cutterDragCursor.x, cutterDragCursor.y);
      await page.waitForTimeout(45);
    }
  };
  let midDragCut = null;
  let afterLmbDownBeforeMove = null;
  let cutterSprayingDuringDrag = false;
  try {
    await page.mouse.down({ button: 'left' });
    await page.waitForFunction(() => window.__fw.scene3d.walk.isSpraying?.() === true, null, {
      timeout: 3000,
    });
    cutterSprayingDuringDrag = await page.evaluate(() => (
      window.__fw.scene3d.walk.isSpraying?.() === true
    ));
    await page.waitForTimeout(90);
    afterLmbDownBeforeMove = await candidateSnapshot(fixture.candidate.id);
    requireTruth(afterLmbDownBeforeMove.tape === 0
        && afterLmbDownBeforeMove.cutProgress === 0
        && afterLmbDownBeforeMove.lifecycle === 'SEALED',
    `Stationary LMB down advanced the cutter before a drag: ${JSON.stringify(afterLmbDownBeforeMove)}.`);
    await moveCutterForward(2);
    await page.waitForFunction((id) => {
      const box = window.__fw.state.shop.deliveries.boxes.find((entry) => entry.id === id);
      return box?.lifecycle === 'CUTTING' && box.tape > 0 && box.tape < 0.6;
    }, fixture.candidate.id, { timeout: 3000 });
    midDragCut = await candidateSnapshot(fixture.candidate.id);
    await capture('16b-lmb-drag-mid-cut.png',
      'Mid-drag with LMB still held: the cutter follows the projected authored seam and tape has partially separated.');
    await moveCutterForward(2);
    await page.waitForFunction(({ id, earlierTape }) => {
      const box = window.__fw.state.shop.deliveries.boxes.find((entry) => entry.id === id);
      return box?.lifecycle === 'CUTTING' && box.tape > earlierTape && box.tape < 0.6;
    }, { id: fixture.candidate.id, earlierTape: midDragCut.tape }, { timeout: 3000 });
  } finally {
    await page.mouse.up({ button: 'left' }).catch(() => {});
    await page.waitForFunction(() => window.__fw.scene3d.walk.isSpraying?.() === false, null, {
      timeout: 3000,
    }).catch(() => {});
  }
  await page.waitForTimeout(100);
  const afterDeliberateCut = await candidateSnapshot(fixture.candidate.id);
  const cutterDragInput = await finishCutterDragInputTrace();
  const cuttingInteriorVisibility = await candidateVisualVisibility(fixture.candidate.id);
  const cuttingCutterVisual = await cutterVisualSnapshot(fixture.candidate.id);
  requireTruth(midDragCut?.tape > 0
      && afterDeliberateCut.tape > midDragCut.tape
      && afterDeliberateCut.tape < 1
      && afterDeliberateCut.cutProgress === afterDeliberateCut.tape
      && afterDeliberateCut.lifecycle === 'CUTTING',
  `Normal LMB drag did not create a progressive partial cut: mid=${JSON.stringify(midDragCut)}, `
    + `after=${JSON.stringify(afterDeliberateCut)}.`);
  await capture('17-deliberate-hold-cuts-tape.png',
    'After LMB release, the drag has advanced farther along the authored tape while the E hold alternative was never used.');

  const afterCutToolBeforeHolster = await page.evaluate(() => (
    window.__fw.scene3d.walk.getTool?.() || null
  ));
  const beforeFHolsterState = await candidateSnapshot(fixture.candidate.id);
  await page.keyboard.press('f');
  await page.waitForFunction(() => window.__fw.scene3d.walk.getTool?.() == null);
  await page.waitForFunction(() => [...document.querySelectorAll('.toast')]
    .some((element) => /Box cutter put away/i.test(element.textContent || '')), null, {
    timeout: 3000,
  });
  const cutterHolsterToast = await page.evaluate(() => [...document.querySelectorAll('.toast')]
    .map((element) => element.textContent || '')
    .find((text) => /Box cutter put away/i.test(text)) || null);
  const afterFHolsterFocus = await waitForFocus(
    /tap \[E\] once to equip the box cutter.*\[X\] reposition closed carton/i,
  );
  await page.waitForTimeout(360);
  const afterFHolsterState = await candidateSnapshot(fixture.candidate.id);
  const afterCutToolHolster = {
    key: 'f',
    before: afterCutToolBeforeHolster,
    after: await page.evaluate(() => window.__fw.scene3d.walk.getTool?.() || null),
    toast: cutterHolsterToast,
    focus: afterFHolsterFocus,
    lifecycleUnchanged: beforeFHolsterState.lifecycle === afterFHolsterState.lifecycle
      && beforeFHolsterState.tape === afterFHolsterState.tape
      && beforeFHolsterState.cutProgress === afterFHolsterState.cutProgress,
  };
  await capture('17b-box-cutter-f-holstered.png',
    'Normal F puts the contextual cutter away without changing the partial tape cut.');
  const postCutPickup = await normalPickup({
    key: 'x',
    focusPattern: /\[X\] reposition closed carton/i,
    approach: cutterCamera,
  });
  await aimAtSurface(surfaceIds.floor, {
    local: floorValidTarget,
    distance: 1.42,
    approach: [0, 1],
  });
  await waitForPlacement(surfaceIds.floor, true);
  await collectGarbage();
  const baselineRendererWarmup = await warmRendererResources('before-matched-churn-baseline');
  const baselinePerformance = await measure('matched-cutting-green-preview-before-churn');
  await collectGarbage();
  const churnBefore = await resourceCensus();
  for (let cycle = 0; cycle < 12; cycle += 1) {
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !window.__fw.scene3d.clubhouse().boxPlacement.isActive());
    await page.keyboard.press('e');
    await page.waitForFunction(() => window.__fw.scene3d.clubhouse().boxPlacement.isActive());
    await page.keyboard.press('r');
    await page.waitForTimeout(35);
  }
  await aimAtSurface(surfaceIds.floor, {
    local: floorValidTarget,
    distance: 1.42,
    approach: [0, 1],
  });
  const churnPlacement = await waitForPlacement(surfaceIds.floor, true);
  await collectGarbage();
  const churnAfter = await resourceCensus();
  const afterRendererWarmup = await warmRendererResources('before-matched-after-sample');
  const afterPerformance = await measure('active-green-floor-preview-after-route-and-reload');
  await capture('18-final-matched-green-preview.png',
    'Matched final green floor preview after save/reload and twelve cancel/resume/rotate cycles.');

  await aimAtSurface(surfaceIds.handTruck, {
    ...handTruckCamera,
  });
  await waitForPlacement(surfaceIds.handTruck, true);
  await page.keyboard.press('e');
  await page.waitForFunction((id) => {
    const box = window.__fw.state.shop.deliveries.boxes.find((entry) => entry.id === id);
    return box?.loc === 'equipment'
      && box.equipmentId === 'delivery_hand_truck'
      && box.socketId === 'LOAD_ORIGIN';
  }, fixture.candidate.id);
  await page.waitForTimeout(300);
  await aimAtBox(fixture.candidate.id, handTruckCamera);
  const finalHandTruckFocus = await waitForFocus(/Tee bag .*\[E\] pick up/i);
  await capture('19-final-hand-truck-restored.png',
    'Final open-aisle E commit restores the transport-only hand-truck carton while preserving the partial cut.');
  const finalState = await candidateSnapshot(fixture.candidate.id);

  const exactSavedFields = [
    'id', 'orderId', 'skuId', 'box', 'qty', 'initialQty', 'loc',
    'equipmentId', 'socketId', 'lifecycle', 'tape', 'cutProgress',
  ];
  const saveFieldsMatch = exactSavedFields.every((field) => (
    JSON.stringify(saved.box[field]) === JSON.stringify(reloaded[field])
  )) && JSON.stringify(saved.box.flapProgress) === JSON.stringify(reloaded.flapProgress);

  const ordinaryCommitMatches = (entry, surfaceId) => entry.state.loc === 'world'
    && entry.state.surfaceId === surfaceId
    && entry.state.qty === 12
    && entry.state.lifecycle === 'SEALED'
    && entry.state.tape === 0
    && entry.state.cutProgress === 0;
  const routeByStep = new Map(route.map((entry) => [entry.step, entry]));
  const preCutCommits = route.map((entry) => entry.state);
  const performanceDelta = {
    averageFps: +(afterPerformance.summary.averageFps - baselinePerformance.summary.averageFps).toFixed(2),
    averageFpsPercent: +((afterPerformance.summary.averageFps
      / baselinePerformance.summary.averageFps - 1) * 100).toFixed(2),
    low1Fps: +(afterPerformance.summary.low1Fps - baselinePerformance.summary.low1Fps).toFixed(2),
    low1FpsPercent: +((afterPerformance.summary.low1Fps
      / baselinePerformance.summary.low1Fps - 1) * 100).toFixed(2),
    worstFrameMs: +(afterPerformance.summary.worstFrameMs
      - baselinePerformance.summary.worstFrameMs).toFixed(3),
    rendererGeometries: afterPerformance.resources.rendererGeometries
      - baselinePerformance.resources.rendererGeometries,
    rendererTextures: afterPerformance.resources.rendererTextures
      - baselinePerformance.resources.rendererTextures,
    visibleTextures: afterPerformance.resources.visibleTextures
      - baselinePerformance.resources.visibleTextures,
    visibleGeometries: afterPerformance.resources.visibleGeometries
      - baselinePerformance.resources.visibleGeometries,
    visibleMaterials: afterPerformance.resources.visibleMaterials
      - baselinePerformance.resources.visibleMaterials,
    visibleMeshes: afterPerformance.resources.visibleMeshes
      - baselinePerformance.resources.visibleMeshes,
    rendererPrograms: afterPerformance.resources.rendererPrograms == null
      || baselinePerformance.resources.rendererPrograms == null
      ? null
      : afterPerformance.resources.rendererPrograms - baselinePerformance.resources.rendererPrograms,
    eventListeners: afterPerformance.resources.eventListeners == null
      || baselinePerformance.resources.eventListeners == null
      ? null
      : afterPerformance.resources.eventListeners - baselinePerformance.resources.eventListeners,
    heapUsedBytes: afterPerformance.resources.heapUsedBytes == null
      || baselinePerformance.resources.heapUsedBytes == null
      ? null
      : afterPerformance.resources.heapUsedBytes - baselinePerformance.resources.heapUsedBytes,
  };
  const routeReloadResourceDelta = {
    rendererGeometries: afterPerformance.resources.rendererGeometries
      - routeBaselinePerformance.resources.rendererGeometries,
    rendererTextures: afterPerformance.resources.rendererTextures
      - routeBaselinePerformance.resources.rendererTextures,
    rendererPrograms: afterPerformance.resources.rendererPrograms == null
      || routeBaselinePerformance.resources.rendererPrograms == null
      ? null
      : afterPerformance.resources.rendererPrograms
        - routeBaselinePerformance.resources.rendererPrograms,
    visibleMeshes: afterPerformance.resources.visibleMeshes
      - routeBaselinePerformance.resources.visibleMeshes,
    visibleGeometries: afterPerformance.resources.visibleGeometries
      - routeBaselinePerformance.resources.visibleGeometries,
    visibleMaterials: afterPerformance.resources.visibleMaterials
      - routeBaselinePerformance.resources.visibleMaterials,
    visibleTextures: afterPerformance.resources.visibleTextures
      - routeBaselinePerformance.resources.visibleTextures,
    eventListeners: afterPerformance.resources.eventListeners == null
      || routeBaselinePerformance.resources.eventListeners == null
      ? null
      : afterPerformance.resources.eventListeners
        - routeBaselinePerformance.resources.eventListeners,
    heapUsedBytes: afterPerformance.resources.heapUsedBytes == null
      || routeBaselinePerformance.resources.heapUsedBytes == null
      ? null
      : afterPerformance.resources.heapUsedBytes
        - routeBaselinePerformance.resources.heapUsedBytes,
  };
  const churnListenerGrowth = churnBefore.eventListeners == null || churnAfter.eventListeners == null
    ? null : churnAfter.eventListeners - churnBefore.eventListeners;
  const churnHeapGrowth = churnBefore.heapUsedBytes == null || churnAfter.heapUsedBytes == null
    ? null : churnAfter.heapUsedBytes - churnBefore.heapUsedBytes;
  const performanceGateChecks = {
    averageFpsRetention: afterPerformance.summary.averageFps
      >= baselinePerformance.summary.averageFps * 0.85,
    low1FpsRetention: afterPerformance.summary.low1Fps
      >= baselinePerformance.summary.low1Fps * 0.75,
    worstFrameBounded: afterPerformance.summary.worstFrameMs
      <= Math.max(50, baselinePerformance.summary.worstFrameMs * 1.5),
    matchedRendererGeometriesExact: performanceDelta.rendererGeometries === 0,
    matchedRendererProgramsExact: performanceDelta.rendererPrograms === 0,
    matchedRendererTexturesExact: performanceDelta.rendererTextures === 0,
    matchedVisibleTextureSetCountExact: performanceDelta.visibleTextures === 0,
    matchedVisibleGeometrySetCountExact: performanceDelta.visibleGeometries === 0,
    matchedVisibleMaterialSetCountExact: performanceDelta.visibleMaterials === 0,
    matchedVisibleMeshCountExact: performanceDelta.visibleMeshes === 0,
    reloadRendererGeometriesBounded: routeReloadResourceDelta.rendererGeometries <= 4,
    reloadRendererProgramsBounded: routeReloadResourceDelta.rendererPrograms == null
      || routeReloadResourceDelta.rendererPrograms <= 2,
    rendererTextureReloadBounded: routeReloadResourceDelta.rendererTextures <= 4,
    reloadVisibleTexturesDoNotGrow: routeReloadResourceDelta.visibleTextures <= 0,
    reloadVisibleMeshesDoNotGrow: routeReloadResourceDelta.visibleMeshes <= 0,
    reloadVisibleGeometriesDoNotGrow: routeReloadResourceDelta.visibleGeometries <= 0,
    reloadVisibleMaterialsDoNotGrow: routeReloadResourceDelta.visibleMaterials <= 0,
    sameDocumentRendererGeometriesExact:
      churnAfter.rendererGeometries === churnBefore.rendererGeometries,
    sameDocumentRendererProgramsExact:
      churnAfter.rendererPrograms === churnBefore.rendererPrograms,
    sameDocumentRendererTexturesExact:
      churnAfter.rendererTextures === churnBefore.rendererTextures,
    sameDocumentVisibleTextureSetCountExact:
      churnAfter.visibleTextures === churnBefore.visibleTextures,
    routeReloadEventListenersBounded: routeReloadResourceDelta.eventListeners == null
      || routeReloadResourceDelta.eventListeners <= 4,
    routeReloadHeapBounded: routeReloadResourceDelta.heapUsedBytes == null
      || routeReloadResourceDelta.heapUsedBytes <= 16 * 1024 * 1024,
    sameDocumentListenersExact: churnListenerGrowth == null || churnListenerGrowth <= 0,
    sameDocumentHeapBounded: churnHeapGrowth == null
      || churnHeapGrowth <= 4 * 1024 * 1024,
    promptUpdatesBounded: afterPerformance.summary.promptUpdatesPerSecond <= 4,
  };
  const performanceGate = Object.values(performanceGateChecks).every(Boolean);

  const assertions = {
    viewport1600x900Dpr1: viewport.width === 1600
      && viewport.height === 900
      && viewport.deviceScaleFactor === 1,
    documentedFixtureHasOneCandidateAndOneBlocker: fixture.candidate.loc === 'pad'
      && fixture.candidate.qty === 12
      && fixture.blocker.loc === 'world'
      && fixture.blocker.surfaceId === surfaceIds.floor
      && fixture.blocker.x === floorBlockerTarget.x
      && fixture.blocker.z === floorBlockerTarget.z,
    normalEPickupFromDeliveryPallet: /Delivery: .*\[E\] pick up/i.test(initialFocus)
      && !/pallet jack/i.test(initialFocus)
      && pickupSurfaceId.startsWith('pallet:receiving:'),
    palletJackHandleGripTargetAndNormalEPump:
      palletJackHandleTarget.node === 'HANDLE_GRIP_TARGET'
      && palletJackHandleView.target?.node === 'HANDLE_GRIP_TARGET'
      && /pump once to raise the forks/i.test(palletJackFocusBefore)
      && /hydraulic stroke in progress/i.test(palletJackPumpFeedback)
      && palletJackDuringRaise.active
      && ['lift', 'handle-return'].includes(palletJackDuringRaise.phase)
      && palletJackDuringRaise.liftProgress > 0
      && palletJackAfterRaise.cycles === palletJackBefore.cycles + 1
      && palletJackAfterRaise.raised
      && /pump once to lower the forks/i.test(palletJackFocusRaised)
      && palletJackAfterRestore.cycles === palletJackBefore.cycles + 2
      && !palletJackAfterRestore.raised
      && Math.abs(palletJackAfterRestore.liftProgress) <= 1e-6
      && /pump once to raise the forks/i.test(palletJackFocusRestored),
    smallCartonCarryProfileClearsHud: carryProfileEvidence.profile === 'small-chest'
      && carryProfileEvidence.baseY === -0.60
      && Math.abs(carryProfileEvidence.position.z - (-1.38)) <= 0.001,
    invalidPreviewIsVisibleRedOverlap: invalidPreview.active
      && invalidPreview.visible
      && !invalidPreview.legal
      && invalidPreview.surfaceId === surfaceIds.floor
      && invalidPreview.colour === placementRed
      && /overlap/i.test(invalidPreview.reason || ''),
    invalidPreviewIsVisibleRedDoorwayClearance: doorwayPreview.active
      && doorwayPreview.visible
      && !doorwayPreview.legal
      && doorwayPreview.surfaceId === surfaceIds.floor
      && doorwayPreview.colour === placementRed
      && /doorway/i.test(doorwayPreview.reason || ''),
    escapeCancelsWithoutDropping: !cancelled.placement.active
      && cancelled.state.loc === 'carried'
      && cancelled.state.carriedBoxId === fixture.candidate.id,
    normalEResumesPlacement: resumedPreview.active
      && resumedPreview.visible
      && resumedPreview.legal
      && resumedPreview.colour === placementGreen,
    normalRRotatesAndRevalidates: rotatedPreview.quarterTurns === 1
      && rotatedPreview.legal
      && rotatedPreview.colour === placementGreen
      && arrowBeforeRotation.vertexCount === 14
      && arrowAfterRotation.vertexCount === 14
      && arrowBeforeRotation.segmentCount === 7
      && arrowAfterRotation.segmentCount === 7
      && arrowBeforeRotation.visible
      && arrowAfterRotation.visible
      && Math.abs(arrowDirectionDot) <= 0.08,
    ghostUsesReadableFrontFacesAndCurrentColours:
      arrowBeforeRotation.envelopeSide === 0
      && arrowBeforeRotation.envelopeOpacity === 0.42
      && arrowBeforeRotation.footprintOpacity === 0.95
      && arrowBeforeRotation.footprintDepthTest === false
      && arrowBeforeRotation.colour === placementGreen
      && arrowAfterRotation.colour === placementGreen
      && arrowBeforeRotation.facingCueVisible
      && arrowAfterRotation.facingCueVisible
      && arrowBeforeRotation.facingCueVertexCount === 8
      && arrowAfterRotation.facingCueVertexCount === 8
      && arrowBeforeRotation.facingCueOpacity === 0.98
      && arrowBeforeRotation.facingCueDepthTest === false
      && arrowBeforeRotation.facingCueColour === placementCueGreen
      && arrowAfterRotation.facingCueColour === placementCueGreen,
    floorCommitExactAndRotated: ordinaryCommitMatches({ state: floorCommitted }, surfaceIds.floor)
      && floorCommitted.x === floorValidTarget.x
      && floorCommitted.z === floorValidTarget.z
      && Math.abs(floorCommitted.ry - Math.PI / 2) <= 1e-6,
    genericRearShippingLabelIsUprightLandscapeAndUnstretched:
      cartonRearView.node === 'LABEL_DYNAMIC'
      && /Tee bag/i.test(cartonRearFocus)
      && cartonLabelEvidence.labelNode === 'LABEL_DYNAMIC'
      && cartonLabelEvidence.vertexCount >= 4
      && cartonLabelEvidence.uvCount === cartonLabelEvidence.vertexCount
      && cartonLabelEvidence.uvRange.minU === 0
      && cartonLabelEvidence.uvRange.maxU === 1
      && cartonLabelEvidence.uvRange.minV === 0
      && cartonLabelEvidence.uvRange.maxV === 1
      && cartonLabelEvidence.worldAspect >= 1.55
      && Math.abs(
        cartonLabelEvidence.worldAspect - cartonLabelEvidence.compensatedSurfaceAspect
      ) <= 0.002
      && cartonLabelEvidence.horizontalAxisVerticalComponent <= 0.10
      && cartonLabelEvidence.verticalAxisVerticalComponent >= 0.90
      && cartonLabelEvidence.surfaceNormalVerticalComponent <= 0.10
      && cartonLabelEvidence.canvasWidth === 512
      && cartonLabelEvidence.canvasHeight === 320
      && cartonLabelEvidence.canvasAspect === 1.6
      && Math.abs(
        cartonLabelEvidence.canvasScaleX
          * cartonLabelEvidence.worldAspect / cartonLabelEvidence.canvasAspect - 1
      ) <= 0.002
      && cartonLabelEvidence.flipY === false
      && cartonLabelEvidence.repeatX === -1
      && cartonLabelEvidence.offsetX === 1,
    genericFrontIdentityIsIndependentlyReadable:
      cartonFrontView.node === 'LABEL_MAIN'
      && cartonLabelEvidence.frontIdentityNode === 'LABEL_MAIN'
      && Math.hypot(cartonFrontView.outward.x, cartonFrontView.outward.z) >= 0.99
      && (cartonRearView.outward.x * cartonFrontView.outward.x
        + cartonRearView.outward.z * cartonFrontView.outward.z) <= -0.8
      && /Tee bag/i.test(cartonFrontFocus),
    apparelTableCommit: ordinaryCommitMatches(routeByStep.get('table'), surfaceIds.table),
    storageShelfCommit: ordinaryCommitMatches(routeByStep.get('shelf'), surfaceIds.shelf),
    packingBenchCommit: ordinaryCommitMatches(routeByStep.get('packing'), surfaceIds.packing),
    approvedBackcounterCommit: ordinaryCommitMatches(routeByStep.get('backcounter'), surfaceIds.backcounter),
    receivingPalletCommit: routeByStep.get('pallet')?.state.loc === 'pad'
      && routeByStep.get('pallet')?.state.padPalletIndex === 3
      && /Delivery: .*\[E\] pick up/i.test(pallet.committedFocus || '')
      && !/pallet jack/i.test(pallet.committedFocus || ''),
    stockingCartCommit: routeByStep.get('cart')?.state.loc === 'equipment'
      && routeByStep.get('cart')?.state.equipmentId === 'delivery_stocking_cart'
      && routeByStep.get('cart')?.state.socketId === 'STOCK_BOX_SOCKET_TOP',
    handTruckCommit: routeByStep.get('hand-truck')?.state.loc === 'equipment'
      && routeByStep.get('hand-truck')?.state.equipmentId === 'delivery_hand_truck'
      && routeByStep.get('hand-truck')?.state.socketId === 'LOAD_ORIGIN',
    everyCommitRemainedExactlySealedBeforeDeliberateCut: preCutCommits.length === 9
      && preCutCommits.every((state) => state.qty === 12
        && state.lifecycle === 'SEALED'
        && state.tape === 0
        && state.cutProgress === 0),
    normalXRepositionsEveryUnpackingSurface: [
      tablePickup, shelfPickup, packingPickup, backcounterPickup, cartPickup, postCutPickup,
    ].every((entry) => /\[X\] reposition closed carton/i.test(entry.label)
      && entry.key.toLowerCase() === 'x'
      && entry.state.loc === 'carried'),
    compactUnpackingPromptsDoNotWrap: [
      tablePickup.prompt, shelfPickup.prompt, packingPickup.prompt,
      backcounterPickup.prompt, cartPickup.prompt, compactCutterPrompt,
    ].every((prompt) => prompt.visible && prompt.lineCount === 1 && !prompt.wraps),
    stockingCartCartonAndEquipmentControlsIndependentlyReachable:
      /\[X\] reposition closed carton/i.test(cartPickup.label)
      && /top deck ready for a delivery carton/i.test(stockingCartControlFocus)
      && /Bring a compatible carton here to stage it on the cart/i.test(stockingCartToast || '')
      && afterStockingCartControlState.loc === 'equipment'
      && afterStockingCartControlState.equipmentId === 'delivery_hand_truck',
    handTruckCartonAndHandleControlsIndependentlyReachable:
      /Tee bag .*\[E\] pick up/i.test(handTruckCartonFocus)
      && !/box cutter|\[X\]/i.test(handTruckCartonFocus)
      && handTruckCartonPrompt.visible
      && !handTruckCartonPrompt.wraps
      && /tip it back and check the load balance/i.test(handTruckHandleFocus)
      && /checking the axle balance/i.test(handTruckTiltFeedback)
      && handTruckDuringTilt.active
      && handTruckDuringTilt.runtimeTiltAxis === '+X'
      && handTruckAfterTilt.cycles === handTruckBeforeTilt.cycles + 1
      && /Tee bag .*\[E\] pick up/i.test(handTruckCartonFocusAfterTilt)
      && !/box cutter|\[X\]/i.test(handTruckCartonFocusAfterTilt)
      && afterTiltState.loc === 'equipment'
      && afterTiltState.equipmentId === 'delivery_hand_truck'
      && afterTiltState.qty === 12
      && afterTiltState.tape === 0
      && afterTiltState.cutProgress === 0,
    handTruckFocusAndPromptRetainedForEntireTiltAnimation:
      handTruckFocusTrace.seenActive
      && handTruckFocusTrace.complete
      && !handTruckFocusTrace.error
      && handTruckFocusTrace.activeSampleCount >= 10
      && ['tip-back', 'hold', 'return'].every((phase) => handTruckFocusTrace.phases.includes(phase))
      && handTruckFocusTrace.activeLabels.length === 1
      && /checking the axle balance/i.test(handTruckFocusTrace.activeLabels[0] || ''),
    allPickupsKeptSameConservedBox: [
      floorPickup, tablePickup, shelfPickup, packingPickup,
      backcounterPickup, palletPickup, cartPickup, postReloadPickup, postCutPickup,
    ].every((entry) => entry.state.id === fixture.candidate.id
      && entry.state.qty === 12
      && entry.state.loc === 'carried'),
    autosaveOwnKeyAndVersionedTransform: saved.storageKey === 'golfempire:autosave'
      && saved.rawBytes > 0
      && saved.rawSha256.length === 64
      && saved.box.schemaVersion >= 4
      && saved.box.loc === 'equipment'
      && saved.box.equipmentId === 'delivery_hand_truck'
      && saved.box.socketId === 'LOAD_ORIGIN',
    saveReloadExactPlacementLifecycleAndQuantity: saveFieldsMatch
      && reloaded.loc === 'equipment'
      && reloaded.equipmentId === 'delivery_hand_truck'
      && reloaded.socketId === 'LOAD_ORIGIN'
      && reloaded.qty === 12
      && reloaded.lifecycle === 'SEALED'
      && reloaded.tape === 0
      && reloaded.cutProgress === 0
      && /Tee bag .*\[E\] pick up/i.test(reloadedFocus)
      && !/box cutter|\[X\]/i.test(reloadedFocus)
      && reloadToastSettlement.remainingToasts === 0,
    // Keep this established result key for cross-iteration consumers. Its
    // acceptance route is now the primary LMB drag; E remains only the unused
    // accessibility fallback advertised in the equipped prompt.
    cutterEquipReleaseGateAndDeliberateHold:
      /tap \[E\] once to equip the box cutter/i.test(cutterFocus)
      && !/hold \[E\]/i.test(cutterFocus)
      && /\[LMB\] drag along tape/i.test(equippedCutterFocus)
      && /\[E\] hold alternative/i.test(equippedCutterFocus)
      && beforeCutterEquip.lifecycle === 'SEALED'
      && beforeCutterEquip.tape === 0
      && beforeCutterEquip.cutProgress === 0
      && afterCutterEquip.lifecycle === 'SEALED'
      && afterCutterEquip.tape === 0
      && afterCutterEquip.cutProgress === 0
      && afterLmbDownBeforeMove.lifecycle === 'SEALED'
      && afterLmbDownBeforeMove.tape === 0
      && afterLmbDownBeforeMove.cutProgress === 0
      && midDragCut.lifecycle === 'CUTTING'
      && midDragCut.tape > 0
      && midDragCut.tape < afterDeliberateCut.tape
      && afterDeliberateCut.lifecycle === 'CUTTING'
      && afterDeliberateCut.tape > 0
      && afterDeliberateCut.tape < 1
      && afterDeliberateCut.cutProgress === afterDeliberateCut.tape,
    lmbDragAlongAuthoredTapeNotEFallback:
      cutterProjection.guide === 'BoxCutterActiveTapeGuide'
      && cutterProjection.ribbon.name === 'BoxCutterActiveTapeRibbon'
      && cutterProjection.ribbon.visible
      && cutterProjection.ribbon.width === 0.012
      && cutterProjection.ribbon.thickness === 0.0025
      && cutterProjection.ribbon.length > 0
      && cutterProjection.ribbon.opacity === 0.58
      && cutterProjection.ribbon.depthTest === true
      && cutterProjection.length > 0
      && cutterProjection.start.clip.z >= -1
      && cutterProjection.start.clip.z <= 1
      && cutterProjection.end.clip.z >= -1
      && cutterProjection.end.clip.z <= 1
      && cutterSprayingDuringDrag
      && cutterDragInput.lmbDownCount === 1
      && cutterDragInput.lmbUpCount === 1
      && cutterDragInput.sprayingAtFinish === false
      && cutterDragInput.eKeyDownCount === 0
      && cutterDragInput.eKeyUpCount === 0
      && cutterDragInput.movementEventCount >= 4
      && cutterDragInput.forwardMovementEvents === cutterDragInput.movementEventCount
      && cutterDragInput.backwardMovementEvents === 0
      && cutterDragInput.moves.every((move) => move.spraying)
      && cutterDragInput.alongPixels > 0
      && cutterDragInput.crossToForwardRatio <= 0.15
      && Math.abs(cutterDragInput.cameraDelta.yaw) <= 1e-8
      && Math.abs(cutterDragInput.cameraDelta.pitch) <= 1e-8
      && afterCutterEquip.tape === 0
      && afterLmbDownBeforeMove.tape === 0
      && midDragCut.tape > afterLmbDownBeforeMove.tape
      && afterDeliberateCut.tape > midDragCut.tape
      && afterDeliberateCut.tape < 0.6,
    boxCutterIsToolOnlyWithVisibleBodyBladeAndTapeContact:
      equippedCutterVisual.tool === 'boxcutter'
      && equippedCutterVisual.authoredModel
      && !equippedCutterVisual.fallbackModel
      && equippedCutterVisual.visibleMeshCount >= 3
      && equippedCutterVisual.skinOrCuffMeshCount === 0
      && equippedCutterVisual.bladeVisible
      && equippedCutterVisual.contactVisible
      && equippedCutterVisual.contactToBoxHorizontal <= 0.30
      && equippedCutterVisual.contactAboveBoxOrigin >= 0.20
      && equippedCutterVisual.contactAboveBoxOrigin <= 0.45
      && equippedCutterVisual.screenBounds?.width >= 24
      && equippedCutterVisual.screenBounds?.height >= 12
      && equippedCutterVisual.visibleTapeSegmentCount > 0
      && cuttingCutterVisual.skinOrCuffMeshCount === 0
      && cuttingCutterVisual.visibleTapeSegmentCount < equippedCutterVisual.visibleTapeSegmentCount,
    normalFHolstersBoxCutterWithoutMutatingCut:
      afterCutToolHolster.key === 'f'
      && afterCutToolHolster.before === 'boxcutter'
      && afterCutToolHolster.after === null
      && /Box cutter put away/i.test(afterCutToolHolster.toast || '')
      && /tap \[E\] once to equip the box cutter/i.test(afterCutToolHolster.focus || '')
      && afterCutToolHolster.lifecycleUnchanged,
    cutterResidencyMatchedThroughNormalEquipAndFHolster:
      /tap \[E\] once to equip the box cutter/i.test(baselineCutterPrewarmFocus)
      && baselineCutterEquipped.lifecycle === 'SEALED'
      && baselineCutterEquipped.tape === 0
      && baselineCutterHolstered.lifecycle === 'SEALED'
      && baselineCutterHolstered.tape === 0
      && /Box cutter put away/i.test(baselineCutterHolsterToast || '')
      && /tap \[E\] once to equip the box cutter/i.test(baselineCutterHolsterFocus || ''),
    insertsAndProductsStayHiddenThroughClosedFlapCutting:
      sealedInteriorVisibility.allPackingHidden
      && sealedInteriorVisibility.allProductsHidden
      && cuttingInteriorVisibility.allPackingHidden
      && cuttingInteriorVisibility.allProductsHidden,
    oneReusableGhostAllocation: churnPlacement.allocations?.geometries === 3
      && churnPlacement.allocations?.materials === 3
      && churnPlacement.metrics?.rotations >= 12
      && churnPlacement.metrics?.begins >= 13,
    interactionChurnNoListenerOrHeapLeak: (churnListenerGrowth == null || churnListenerGrowth <= 0)
      && (churnHeapGrowth == null || churnHeapGrowth <= 4 * 1024 * 1024)
      && churnAfter.rendererTextures === churnBefore.rendererTextures
      && churnAfter.visibleTextures === churnBefore.visibleTextures,
    matchedPerformanceWithinGate: performanceGate,
    finalNormalCommitRestoresHandTruckAndPreservesDeliberateCut: finalState.loc === 'equipment'
      && finalState.equipmentId === 'delivery_hand_truck'
      && finalState.socketId === 'LOAD_ORIGIN'
      && finalState.qty === 12
      && finalState.lifecycle === 'CUTTING'
      && finalState.tape === afterDeliberateCut.tape
      && finalState.cutProgress === afterDeliberateCut.cutProgress
      && /Tee bag .*\[E\] pick up/i.test(finalHandTruckFocus)
      && !/box cutter|\[X\]/i.test(finalHandTruckFocus),
    pointerLockHeldForAllEvidence: captures.every((entry) => entry.pointerLocked),
    noConsoleOrPageErrors: diagnosticCounts.consoleError === 0
      && diagnosticCounts.pageError === 0,
    noFailedRequests: diagnosticCounts.requestFailed === 0,
  };

  const result = {
    ok: Object.values(assertions).every(Boolean),
    iteration,
    launch: `$env:BOX_PLACEMENT_ITERATION='${iteration}'; $env:VIDEO_DIR='qa/box_system_master/placement/after/iteration-${iteration}/video'; $env:QA_RESULT_PATH='qa/box_system_master/placement/after/iteration-${iteration}/latest-result.json'; node tools/qa/run-playwright.cjs tools/qa/box-placement-surfaces-qa.js --bootstrap`,
    outputDirectory: out,
    videoDirectory,
    viewport,
    fixedConditions: {
      time: '14:00 local simulation time',
      weather: 'current bootstrap weather locked',
      organicCustomers: false,
      viewport: '1600x900 at device scale factor 1',
      cameraMethod: 'documented deterministic player-position/aim fixture; all state transitions use normal keyboard/mouse input',
    },
    fixtureBoundary: 'The fixture clears deliveries and legacy renovation piles through their production simulation mutations, removes the two polo display stacks, creates one real sealed tees carton and one real sealed blocker carton through arriveOrder, and commits only the blocker through the production simulation verb. From the first candidate E pickup onward, no box state is injected: normal E, R, Escape, X, F, and a pointer-locked LMB drag drive every transition, including cutter equip/release/drag/holster, pallet-jack pumping, and hand-truck controls. The drag vector is resolved from the live authored tape guide; camera targets use live scene nodes and fixed approach offsets only make evidence repeatable.',
    controls: {
      pickupActivateCommit: 'E',
      rotate: 'R',
      cancelKeepCarrying: 'Escape',
      repositionFromUnpackingSurface: 'X',
      cutTapePrimary: 'LMB down, relative mouse movement along the live projected authored tape path, LMB up',
      cutTapeAccessibilityFallback: 'E hold is advertised but explicitly unused during the measured drag trace',
      holsterContextualCutter: 'F',
      pointerLock: 'normal canvas mouse click',
    },
    surfaceIds,
    fixture,
    previews: {
      invalid: invalidPreview,
      doorwayBlocked: doorwayPreview,
      resumed: resumedPreview,
      rotated: rotatedPreview,
      postChurn: churnPlacement,
      arrowBeforeRotation,
      arrowAfterRotation,
      arrowDirectionDot,
    },
    interactions: {
      carryProfileEvidence,
      palletJack: {
        handleView: palletJackHandleView,
        handleTarget: palletJackHandleTarget,
        movingHandleTarget: movingPalletJackHandle,
        focusBefore: palletJackFocusBefore,
        pumpFeedback: palletJackPumpFeedback,
        before: palletJackBefore,
        duringRaise: palletJackDuringRaise,
        afterRaise: palletJackAfterRaise,
        focusRaised: palletJackFocusRaised,
        afterRestore: palletJackAfterRestore,
        focusRestored: palletJackFocusRestored,
      },
      cartonIdentity: {
        rearView: cartonRearView,
        rearFocus: cartonRearFocus,
        frontView: cartonFrontView,
        frontFocus: cartonFrontFocus,
        label: cartonLabelEvidence,
      },
      baselineCutterPrewarm: {
        focus: baselineCutterPrewarmFocus,
        equippedFocus: baselineCutterEquippedFocus,
        equipped: baselineCutterEquipped,
        equippedResources: baselineCutterEquippedResources,
        holstered: baselineCutterHolstered,
        holsterKey: 'f',
        holsterToast: baselineCutterHolsterToast,
        holsterFocus: baselineCutterHolsterFocus,
      },
      floorPickup,
      tablePickup,
      shelfPickup,
      packingPickup,
      backcounterPickup,
      palletPickup,
      cartPickup,
      postReloadPickup,
      postCutPickup,
      afterCutToolHolster,
      packingForCut,
      equipmentControls: {
        stockingCartControlFocus,
        stockingCartToast,
        handTruckCartonFocus,
        handTruckHandleFocus,
        handTruckBeforeTilt,
        handTruckDuringTilt,
        handTruckAfterTilt,
        handTruckTiltFeedback,
        handTruckFocusTrace,
        handTruckCartonFocusAfterTilt,
        handTruckCartonPrompt,
      },
      cutter: {
        focus: cutterFocus,
        compactPrompt: compactCutterPrompt,
        equippedFocus: equippedCutterFocus,
        beforeEquip: beforeCutterEquip,
        afterEquip: afterCutterEquip,
        afterLmbDownBeforeMove,
        projection: cutterProjection,
        midDrag: midDragCut,
        afterDrag: afterDeliberateCut,
        inputTrace: cutterDragInput,
        sprayingDuringDrag: cutterSprayingDuringDrag,
        // Backward-compatible evidence alias retained for existing consumers.
        afterDeliberateHold: afterDeliberateCut,
        equippedVisual: equippedCutterVisual,
        cuttingVisual: cuttingCutterVisual,
        fHolster: afterCutToolHolster,
        sealedInteriorVisibility,
        cuttingInteriorVisibility,
      },
    },
    commits: route,
    saveReload: {
      path: 'window.__fw.autosave() -> localStorage["golfempire:autosave"] -> reload -> normal Continue',
      saved,
      reloaded,
      toastSettlement: reloadToastSettlement,
      exactFieldsMatch: saveFieldsMatch,
    },
    performance: {
      methodology: 'Chrome 1600x900 DPR1. Gated FPS and exact resource deltas compare identical CUTTING lifecycle, fixed green floor preview, camera, tool-holstered state, quantities, and document immediately before versus after twelve normal Escape/E/R cycles. A separate route/reload block compares the prewarmed SEALED route baseline to final CUTTING state, allowing deliberate lifecycle removal while rejecting visible growth and bounding renderer reload residency. Three 1.2 s rAF samples provide median average FPS/1% low and worst frame; Three scene/renderer census and CDP heap/listener counters cover resources.',
      rendererWarmup: {
        rationale: 'Before each matched sample, one read-only render temporarily disables frustum culling for visible renderables, then restores it. This makes renderer residency comparable instead of counting first camera-coverage uploads as route growth.',
        baseline: baselineRendererWarmup,
        after: afterRendererWarmup,
      },
      idle: idlePerformance,
      baseline: baselinePerformance,
      after: afterPerformance,
      delta: performanceDelta,
      routeReload: {
        interpretation: 'Separate non-identical lifecycle evidence: SEALED before route/reload versus deliberately CUTTING after. Visible removals are allowed; visible growth is rejected. Renderer geometry/program growth is bounded and renderer texture growth is capped at +4.',
        baselineWarmup: routeBaselineRendererWarmup,
        baseline: routeBaselinePerformance,
        after: afterPerformance,
        resourceDelta: routeReloadResourceDelta,
      },
      gateChecks: performanceGateChecks,
      churn: {
        cycles: 12,
        before: churnBefore,
        after: churnAfter,
        listenerGrowth: churnListenerGrowth,
        heapGrowthBytes: churnHeapGrowth,
      },
      gates: {
        averageFpsRetention: 'at least 85%',
        low1FpsRetention: 'at least 75%',
        worstFrame: 'no more than max(50 ms, 1.5x matched baseline)',
        rendererResources: 'matched same-document renderer geometry/program/texture and visible mesh/geometry/material/texture counts must remain exact; route/reload permits at most +4 renderer geometries, +4 resident renderer textures, and +2 programs while rejecting visible growth',
        textureRationale: 'The +4 route/reload allowance covers renderer-owned resident texture reinitialization only. Visible textures remain exact across reload; visible geometry/material/mesh counts may decrease only for the deliberate lifecycle change. All renderer and visible resource counts remain exact across twelve same-document cycles. No texture-byte measurement or byte-level claim is made.',
        eventListeners: 'at most +4 across reload and zero growth across 12 same-document lifecycle cycles',
        heap: 'at most +16 MiB across reload and +4 MiB after forced-GC lifecycle churn',
        promptUpdates: 'at most 4 DOM prompt mutations/second while the target stays fixed',
        textureMemory: 'No byte-based gate or claim; Three.js resident and visible-scene texture counts are measured explicitly.',
      },
      passed: performanceGate,
    },
    visualReview: {
      status: 'human-review-required',
      requiredForEachIteration: 'Inspect every capture against the prior iteration, record at least ten concrete visible defects with screen location and impact, fix them, and rerun. The harness does not fabricate subjective defects.',
      checklist: [
        'green/red readability', 'prompt hierarchy', 'surface contact', 'scale',
        'silhouette', 'clipping', 'z-fighting', 'alignment', 'lighting/shadows',
        'materials', 'camera framing', 'carry obstruction', 'equipment socket fit',
      ],
    },
    captures,
    assertions,
    diagnostics: { counts: diagnosticCounts, entries: diagnostics },
    generatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(out, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
  fs.writeFileSync(path.join(out, 'run-state.json'), `${JSON.stringify({
    status: result.ok ? 'passed' : 'failed',
    iteration,
    captures,
    result: path.join(out, 'result.json'),
    videoDirectory,
    updatedAt: new Date().toISOString(),
  }, null, 2)}\n`);
  return result;
  } catch (error) {
    const blocker = {
      name: error?.name || 'Error',
      message: error?.message || String(error),
      stack: error?.stack || null,
    };
    const failureScreenshot = path.join(out, 'failure-at-first-blocker.png');
    await page.screenshot({ path: failureScreenshot }).catch(() => {});
    const failure = {
      ok: false,
      iteration,
      status: 'blocked-at-first-normal-control-failure',
      launch: `$env:BOX_PLACEMENT_ITERATION='${iteration}'; $env:VIDEO_DIR='qa/box_system_master/placement/after/iteration-${iteration}/video'; $env:QA_RESULT_PATH='qa/box_system_master/placement/after/iteration-${iteration}/latest-result.json'; node tools/qa/run-playwright.cjs tools/qa/box-placement-surfaces-qa.js --bootstrap`,
      outputDirectory: out,
      videoDirectory,
      blocker,
      failureScreenshot,
      lastCapture: captures[captures.length - 1] || null,
      captures,
      completedCommits: route,
      diagnostics: { counts: diagnosticCounts, entries: diagnostics },
      generatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(out, 'result.json'), `${JSON.stringify(failure, null, 2)}\n`);
    fs.writeFileSync(path.join(out, 'run-state.json'), `${JSON.stringify({
      status: 'failed',
      iteration,
      blocker,
      failureScreenshot,
      captures,
      completedCommits: route,
      result: path.join(out, 'result.json'),
      videoDirectory,
      updatedAt: new Date().toISOString(),
    }, null, 2)}\n`);
    return failure;
  }
}
