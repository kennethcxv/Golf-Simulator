async (page) => {
  // Live-browser acceptance for Asset Sheet 05 refs 41-45.
  //
  // Fixture code establishes one deterministic paid-box equivalent and fixed
  // player starts. Every equipment action, box pickup, and cart placement then
  // goes through the same walk focus + E route used by a player. The game's own
  // autosave and normal Continue boot prove persisted equipment ownership.

  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = path.resolve(process.env.QA_REPO_ROOT || process.cwd());
  const iteration = process.env.DELIVERY_EQUIPMENT_ITERATION || 'iteration-01';
  if (!/^iteration-[0-9]{2}$/.test(iteration)) {
    throw new Error(`Invalid DELIVERY_EQUIPMENT_ITERATION: ${iteration}`);
  }
  const out = path.join(
    repo,
    'qa',
    'box_system_master',
    'delivery_equipment_refs41_45',
    'after',
    iteration,
  );
  const videoDirectory = path.join(out, 'video');
  fs.mkdirSync(out, { recursive: true });
  fs.mkdirSync(videoDirectory, { recursive: true });

  const fixtureOrderId = 97414345;
  const fixtureQty = 8;
  const queuedFixtureOrderId = 97414346;
  const queuedFixtureQty = 3;
  const diagnostics = [];
  const diagnosticCounts = {
    consoleError: 0,
    consoleWarning: 0,
    pageError: 0,
    requestFailed: 0,
  };
  const captures = [];
  const frozenEvidenceCaptures = [];
  const phases = [];
  const toastClearances = [];
  let expectedNavigation = true;
  let evidenceCameras = null;

  const noteDiagnostic = (kind, value) => {
    diagnosticCounts[kind] += 1;
    if (diagnostics.length < 160) diagnostics.push({
      kind,
      message: String(value),
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

  const fail = (message) => { throw new Error(message); };
  const requireTruth = (condition, message) => { if (!condition) fail(message); };
  const distance3 = (a, b) => (
    Array.isArray(a) && Array.isArray(b) && a.length >= 3 && b.length >= 3
      ? Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
      : null
  );

  function writeRunState(status, extra = {}) {
    fs.writeFileSync(path.join(out, 'run-state.json'), `${JSON.stringify({
      status,
      captures,
      diagnostics: { counts: diagnosticCounts, entries: diagnostics },
      updatedAt: new Date().toISOString(),
      ...extra,
    }, null, 2)}\n`);
  }

  async function waitForGame() {
    const { clickThroughMenu } = await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`);
    await clickThroughMenu(page);
    await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
    await page.waitForFunction(() => {
      const veil = document.querySelector('.load-veil');
      return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
    }, null, { timeout: 90000 });
    await page.waitForFunction(() => {
      const clubhouse = window.__fw?.scene3d?.clubhouse?.();
      const scene = window.__fw?.scene3d?.scene;
      const palletStage = scene?.getObjectByName('DeliveryPalletStage');
      return !!clubhouse
        && clubhouse.assetsReady?.()
        && clubhouse.deliveryEquipmentReady?.()
        && palletStage?.userData?.ready === true;
    }, null, { timeout: 90000 });
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(700);
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

  async function boot({ reload = false } = {}) {
    expectedNavigation = true;
    if (reload) await page.reload({ waitUntil: 'domcontentloaded' });
    else {
      await page.setViewportSize({ width: 1600, height: 900 });
      await page.goto('http://localhost:8457/', { waitUntil: 'domcontentloaded' });
    }
    await waitForGame();
    await acquirePointerLock();
  }

  async function setCamera(pose, settleMs = 280) {
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
    if (settleMs > 0) await page.waitForTimeout(settleMs);
  }

  async function cameraState() {
    return page.evaluate(() => {
      const app = window.__fw;
      const origin = app.scene3d.clubhouse().interior.position;
      const walk = app.scene3d.walk.state;
      return {
        x: +(walk.x - origin.x).toFixed(3),
        z: +(walk.z - origin.z).toFixed(3),
        yaw: +walk.yaw.toFixed(5),
        pitch: +walk.pitch.toFixed(5),
      };
    });
  }

  async function capture(fileName, description, camera = null) {
    if (camera) await setCamera(camera);
    const file = path.join(out, fileName);
    await page.screenshot({ path: file });
    const context = await page.evaluate(() => {
      const condition = document.querySelector('.shop-cond');
      return {
        pointerLocked: document.pointerLockElement === document.querySelector('canvas'),
        focus: window.__fw?.scene3d?.walk?.getFocusLabel?.() || null,
        toasts: [...document.querySelectorAll('.toast')].map((entry) => entry.textContent || ''),
        condition: condition ? {
          text: condition.textContent || '',
          visible: getComputedStyle(condition).display !== 'none',
        } : null,
        equipment: window.__fw?.scene3d?.clubhouse?.()?.deliveryEquipmentDiagnostics?.() || null,
      };
    });
    captures.push({ file, description, camera: await cameraState(), ...context });
    writeRunState('running');
    return captures[captures.length - 1];
  }

  async function captureFrozenFrame(fileName, description, camera = null) {
    if (camera) await setCamera(camera);
    const previousPrewarming = await page.evaluate(() => {
      const app = window.__fw;
      const previous = app.prewarming === true;
      // main.js skips scene3d.render while prewarming is true. That freezes the
      // already-rendered acceptance frame without releasing pointer lock,
      // changing game state, or allowing a slow GPU readback to consume the
      // short opening/open-hold beats under test.
      app.prewarming = true;
      return previous;
    });
    try {
      const record = await capture(fileName, description);
      record.renderFrozenForEvidence = true;
      frozenEvidenceCaptures.push({
        file: record.file,
        phase: record.equipment?.activeArrival?.phase || null,
      });
      writeRunState('running');
      return record;
    } finally {
      await page.evaluate((previous) => {
        window.__fw.prewarming = previous;
      }, previousPrewarming);
      await page.waitForTimeout(34);
    }
  }

  async function waitForToastsToClear(label, timeout = 6000) {
    const startedAt = Date.now();
    await page.waitForFunction(
      () => document.querySelectorAll('.toast').length === 0,
      null,
      { timeout },
    );
    await page.waitForTimeout(100);
    const entry = { label, waitedMs: Date.now() - startedAt };
    toastClearances.push(entry);
    return entry;
  }

  async function buildEvidenceCameras() {
    return page.evaluate(async () => {
      const staging = await import('/src/data/deliveryStaging.js');
      const app = window.__fw;
      const clubhouse = app.scene3d.clubhouse();
      const origin = clubhouse.interior.position;
      const localRoot = (asset) => {
        const pose = clubhouse.deliveryEquipmentPose(asset);
        if (!pose) throw new Error(`Missing ${asset} root pose for evidence camera.`);
        return {
          x: pose.position.x - origin.x,
          z: pose.position.z - origin.z,
        };
      };
      const look = (position, target, pitch) => ({
        x: position.x,
        z: position.z,
        yaw: Math.atan2(-(target.x - position.x), -(target.z - position.z)),
        pitch,
      });
      const handTruck = localRoot('delivery_hand_truck');
      const palletJack = localRoot('delivery_pallet_jack');
      const stockingCart = localRoot('delivery_stocking_cart');
      const van = localRoot('delivery_van');
      const firstPallet = staging.deliveryPalletCentres()[0];
      const engagedPallet = staging.deliveryPalletCentres()[2];
      const jackAndPallet = {
        x: (palletJack.x + engagedPallet.x) / 2,
        z: (palletJack.z + engagedPallet.z) / 2,
      };
      const departureReferenceProgress = 0.38;
      const departureEase = departureReferenceProgress * departureReferenceProgress
        * (3 - 2 * departureReferenceProgress);
      const departingVan = { x: van.x, z: van.z - 9 * departureEase };
      const departureComposition = {
        x: (departingVan.x + firstPallet.x) / 2,
        z: (departingVan.z + firstPallet.z) / 2,
      };
      const handTruckObserverRadians = Math.PI / 4;
      const handTruckObserverDistance = 1.8;
      return {
        stockroomSafetySignage: look(
          { x: 9.15, z: -4.5 },
          { x: 5.90, z: -4.5 },
          -0.03,
        ),
        serviceBayReady: look(
          { x: van.x + 6.0, z: van.z + 7.1 },
          { x: van.x, z: van.z + 0.2 },
          -0.31,
        ),
        serviceDriveOverview: look(
          { x: van.x + 12.0, z: van.z },
          { x: van.x, z: van.z },
          -0.28,
        ),
        vanParkedOpening: look(
          { x: van.x + 6.0, z: van.z + 7.1 },
          { x: van.x, z: van.z + 0.2 },
          -0.15,
        ),
        vanCargoOpen: look(
          { x: van.x + 1.35, z: van.z + 7.6 },
          { x: van.x, z: van.z + 1.35 },
          -0.12,
        ),
        vanDeparture: look(
          { x: van.x + 5.6, z: van.z + 5.7 },
          departureComposition,
          -0.17,
        ),
        handTruckAction: look(
          {
            x: handTruck.x + Math.cos(handTruckObserverRadians) * handTruckObserverDistance,
            z: handTruck.z + Math.sin(handTruckObserverRadians) * handTruckObserverDistance,
          },
          handTruck,
          -0.43,
        ),
        palletJackAction: look(
          { x: palletJack.x + 3.5, z: palletJack.z + 2.7 },
          jackAndPallet,
          -0.20,
        ),
        cartPlacement: look(
          { x: stockingCart.x + 2.45, z: stockingCart.z + 1.6 },
          stockingCart,
          -0.31,
        ),
        cartReload: look(
          { x: stockingCart.x + 2.15, z: stockingCart.z + 2.8 },
          stockingCart,
          -0.25,
        ),
      };
    });
  }

  async function objectFrameEvidence(objectName) {
    return page.evaluate((name) => {
      const app = window.__fw;
      const root = app.scene3d.scene.getObjectByName(name);
      const camera = app.scene3d.camera;
      if (!root || !camera) return { exists: !!root, inFrame: false, fullyInside: false };
      root.updateWorldMatrix(true, true);
      camera.updateMatrixWorld(true);
      const projected = [];
      let visibleMeshes = 0;
      root.traverse((object) => {
        if (!object.isMesh || !object.geometry) return;
        let ancestor = object;
        while (ancestor && ancestor !== root.parent) {
          if (!ancestor.visible) return;
          ancestor = ancestor.parent;
        }
        if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
        const box = object.geometry.boundingBox;
        if (!box) return;
        visibleMeshes += 1;
        for (const x of [box.min.x, box.max.x]) {
          for (const y of [box.min.y, box.max.y]) {
            for (const z of [box.min.z, box.max.z]) {
              const point = box.min.clone().set(x, y, z)
                .applyMatrix4(object.matrixWorld)
                .project(camera);
              if ([point.x, point.y, point.z].every(Number.isFinite)) {
                projected.push({ x: point.x, y: point.y, z: point.z });
              }
            }
          }
        }
      });
      if (!projected.length) {
        return { exists: true, visibleMeshes, inFrame: false, fullyInside: false };
      }
      const xs = projected.map((point) => point.x);
      const ys = projected.map((point) => point.y);
      const zs = projected.map((point) => point.z);
      const bounds = {
        minX: Math.min(...xs), maxX: Math.max(...xs),
        minY: Math.min(...ys), maxY: Math.max(...ys),
        minZ: Math.min(...zs), maxZ: Math.max(...zs),
      };
      const clippedWidth = Math.max(0, Math.min(1, bounds.maxX) - Math.max(-1, bounds.minX));
      const clippedHeight = Math.max(0, Math.min(1, bounds.maxY) - Math.max(-1, bounds.minY));
      const depthVisible = bounds.maxZ >= -1 && bounds.minZ <= 1;
      return {
        exists: true,
        visibleMeshes,
        bounds: Object.fromEntries(
          Object.entries(bounds).map(([key, value]) => [key, +value.toFixed(4)]),
        ),
        viewportCoverage: +((clippedWidth * clippedHeight) / 4).toFixed(4),
        inFrame: depthVisible && clippedWidth > 0 && clippedHeight > 0,
        fullyInside: bounds.minX >= -0.94 && bounds.maxX <= 0.94
          && bounds.minY >= -0.90 && bounds.maxY <= 0.90
          && bounds.minZ >= -1 && bounds.maxZ <= 1,
      };
    }, objectName);
  }

  async function objectLineOfSightEvidence(objectName, maxSamples = 72) {
    return page.evaluate(async ({ name, sampleLimit }) => {
      const THREE = await import('/vendor/three.module.js');
      const app = window.__fw;
      const scene = app.scene3d.scene;
      const camera = app.scene3d.camera;
      const root = scene.getObjectByName(name);
      if (!root || !camera) {
        return {
          exists: !!root,
          projectedSamples: 0,
          visibleSamples: 0,
          visibleRatio: 0,
          firstHitNames: [],
        };
      }
      scene.updateMatrixWorld(true);
      camera.updateMatrixWorld(true);
      const targetObjects = new Set();
      const meshes = [];
      root.traverse((object) => {
        targetObjects.add(object);
        if (object.isMesh && object.geometry?.attributes?.position) meshes.push(object);
      });
      const effectivelyVisible = (object) => {
        let ancestor = object;
        while (ancestor) {
          if (!ancestor.visible) return false;
          ancestor = ancestor.parent;
        }
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        return materials.some((material) => (
          material && material.visible !== false && (material.opacity ?? 1) > 0.05
        ));
      };
      const candidates = [];
      const addCandidate = (world) => {
        if (candidates.length >= sampleLimit) return;
        const projected = world.clone().project(camera);
        if (projected.z < -1 || projected.z > 1
          || Math.abs(projected.x) > 0.96 || Math.abs(projected.y) > 0.92) return;
        candidates.push(world);
      };
      const samplesPerMesh = Math.max(1, Math.floor(sampleLimit / Math.max(1, meshes.length)));
      for (const mesh of meshes) {
        if (!effectivelyVisible(mesh)) continue;
        if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
        const box = mesh.geometry.boundingBox;
        // Plane signs have only four corner vertices, exactly where a physical
        // frame may legitimately overlap them. Add deterministic interior
        // samples so "readable" measures the printed face, not its border.
        if (box) {
          for (const [tx, ty, tz] of [
            [0.25, 0.25, 0.5], [0.75, 0.25, 0.5], [0.5, 0.5, 0.5],
            [0.25, 0.75, 0.5], [0.75, 0.75, 0.5],
          ]) {
            addCandidate(new THREE.Vector3(
              THREE.MathUtils.lerp(box.min.x, box.max.x, tx),
              THREE.MathUtils.lerp(box.min.y, box.max.y, ty),
              THREE.MathUtils.lerp(box.min.z, box.max.z, tz),
            ).applyMatrix4(mesh.matrixWorld));
          }
        }
        const positions = mesh.geometry.attributes.position;
        const stride = Math.max(1, Math.floor(positions.count / samplesPerMesh));
        for (let index = 0; index < positions.count && candidates.length < sampleLimit; index += stride) {
          const world = new THREE.Vector3().fromBufferAttribute(positions, index)
            .applyMatrix4(mesh.matrixWorld);
          addCandidate(world);
        }
      }
      const raycaster = new THREE.Raycaster();
      const raycastMeshes = [];
      scene.traverse((object) => {
        if (object.isMesh && effectivelyVisible(object)) raycastMeshes.push(object);
      });
      const firstHitCounts = new Map();
      let visibleSamples = 0;
      for (const point of candidates) {
        const direction = point.clone().sub(camera.position);
        const targetDistance = direction.length();
        if (targetDistance <= 0.01) continue;
        raycaster.set(camera.position, direction.normalize());
        raycaster.near = 0.01;
        raycaster.far = targetDistance + 0.06;
        const hit = raycaster.intersectObjects(raycastMeshes, false)[0];
        const hitName = hit?.object?.name || null;
        if (hitName) firstHitCounts.set(hitName, (firstHitCounts.get(hitName) || 0) + 1);
        if (hit && targetObjects.has(hit.object)) visibleSamples += 1;
      }
      return {
        exists: true,
        meshCount: meshes.length,
        projectedSamples: candidates.length,
        visibleSamples,
        visibleRatio: candidates.length
          ? +(visibleSamples / candidates.length).toFixed(4) : 0,
        firstHitNames: [...firstHitCounts.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 8)
          .map(([hitName, count]) => ({ name: hitName, count })),
      };
    }, { name: objectName, sampleLimit: maxSamples });
  }

  async function equipmentLocalPose(asset) {
    return page.evaluate((assetName) => {
      const app = window.__fw;
      const clubhouse = app.scene3d.clubhouse();
      const origin = clubhouse.interior.position;
      const pose = clubhouse.deliveryEquipmentPose(assetName);
      if (!pose) throw new Error(`Missing ${assetName} root pose.`);
      return {
        x: +(pose.position.x - origin.x).toFixed(4),
        y: +(pose.position.y - origin.y).toFixed(4),
        z: +(pose.position.z - origin.z).toFixed(4),
      };
    }, asset);
  }

  async function palletJackLiftSnapshot(targetPalletIndex = 2, controlPalletIndex = 0) {
    return page.evaluate(({ targetIndex, controlIndex }) => {
      const app = window.__fw;
      const scene = app.scene3d.scene;
      const diagnostics = app.scene3d.clubhouse().deliveryEquipmentDiagnostics().palletJack;
      scene.updateMatrixWorld(true);
      const worldY = (name) => {
        const object = scene.getObjectByName(name);
        if (!object) return { name, exists: false, y: null };
        const position = object.getWorldPosition(object.position.clone());
        return {
          name: object.name,
          uuid: object.uuid,
          exists: true,
          y: +position.y.toFixed(6),
        };
      };
      const targetBoxes = app.state.shop.deliveries.boxes
        .filter((box) => box.loc === 'pad' && box.padPalletIndex === targetIndex)
        .map((box) => {
          const authoredName = `DeliveryBox_${box.id}`;
          const fallbackName = `DeliveryBoxFallback_${box.id}`;
          const root = scene.getObjectByName(authoredName) || scene.getObjectByName(fallbackName);
          const position = root?.getWorldPosition(root.position.clone());
          return {
            id: box.id,
            loc: box.loc,
            padPalletIndex: box.padPalletIndex,
            rootName: root?.name || null,
            rootUuid: root?.uuid || null,
            exists: !!root,
            y: position ? +position.y.toFixed(6) : null,
          };
        })
        .sort((a, b) => String(a.id).localeCompare(String(b.id)));
      return {
        targetPalletIndex: targetIndex,
        controlPalletIndex: controlIndex,
        diagnostics: {
          phase: diagnostics.phase,
          active: diagnostics.active,
          liftProgress: diagnostics.liftProgress,
          raised: diagnostics.raised,
          targetRaised: diagnostics.targetRaised,
          coupledPalletIndex: diagnostics.coupledPalletIndex ?? null,
          channelAlignmentDot: diagnostics.channelAlignmentDot ?? null,
          channelAligned: diagnostics.channelAligned ?? null,
          socketHorizontalError: diagnostics.socketHorizontalError ?? null,
          liftOffset: diagnostics.liftOffset ?? null,
          coupling: diagnostics.coupling ? {
            coupledPalletIndex: diagnostics.coupling.coupledPalletIndex ?? null,
            coupledBoxIds: [...(diagnostics.coupling.coupledBoxIds || [])],
            baseY: diagnostics.coupling.baseY ?? null,
            visualY: diagnostics.coupling.visualY ?? null,
            controlPalletIndex: diagnostics.coupling.controlPalletIndex ?? null,
            controlVisualY: diagnostics.coupling.controlVisualY ?? null,
            colliderMinY: diagnostics.coupling.colliderMinY ?? null,
            colliderMaxY: diagnostics.coupling.colliderMaxY ?? null,
            liftOffset: diagnostics.coupling.liftOffset ?? null,
          } : null,
        },
        jackLift: worldY('FORK_LIFT_SLIDE'),
        target: {
          anchor: worldY(`DeliveryPallet_${targetIndex + 1}`),
          visual: worldY('DeliveryPalletCoupledVisual'),
          collider: diagnostics.coupling ? {
            exists: true,
            name: 'shared-delivery-pallet-collider',
            minY: Number.isFinite(diagnostics.coupling.colliderMinY)
              ? +diagnostics.coupling.colliderMinY.toFixed(6) : null,
            maxY: Number.isFinite(diagnostics.coupling.colliderMaxY)
              ? +diagnostics.coupling.colliderMaxY.toFixed(6) : null,
            centerY: Number.isFinite(diagnostics.coupling.colliderMinY)
              && Number.isFinite(diagnostics.coupling.colliderMaxY)
              ? +((diagnostics.coupling.colliderMinY
                + diagnostics.coupling.colliderMaxY) / 2).toFixed(6) : null,
          } : { exists: false, name: null, minY: null, maxY: null, centerY: null },
          cartons: targetBoxes,
        },
        control: {
          anchor: worldY(`DeliveryPallet_${controlIndex + 1}`),
          batchedVisuals: worldY('DeliveryPalletBatchedVisuals'),
        },
      };
    }, { targetIndex: targetPalletIndex, controlIndex: controlPalletIndex });
  }

  function comparePalletJackLift(rest, raised, expectedDelta = 0.12) {
    const delta = (after, before) => (
      Number.isFinite(after) && Number.isFinite(before)
        ? +(after - before).toFixed(6) : null
    );
    const restCartons = new Map(rest.target.cartons.map((entry) => [String(entry.id), entry]));
    return {
      expectedDelta,
      epsilon: 0.002,
      targetPalletIndex: rest.targetPalletIndex,
      jackLiftDelta: delta(raised.jackLift.y, rest.jackLift.y),
      anchorDelta: delta(raised.target.anchor.y, rest.target.anchor.y),
      visualDelta: delta(raised.target.visual.y, rest.target.visual.y),
      collider: {
        minYDelta: delta(raised.target.collider.minY, rest.target.collider.minY),
        maxYDelta: delta(raised.target.collider.maxY, rest.target.collider.maxY),
        centerYDelta: delta(raised.target.collider.centerY, rest.target.collider.centerY),
      },
      cartons: raised.target.cartons.map((entry) => ({
        id: entry.id,
        existsAtRest: restCartons.get(String(entry.id))?.exists === true,
        existsRaised: entry.exists,
        deltaY: delta(entry.y, restCartons.get(String(entry.id))?.y),
      })),
      coupledBoxIdsAtRest: rest.diagnostics.coupling?.coupledBoxIds || [],
      coupledBoxIdsRaised: raised.diagnostics.coupling?.coupledBoxIds || [],
      control: {
        anchorDelta: delta(raised.control.anchor.y, rest.control.anchor.y),
        batchedVisualsDelta: delta(
          raised.control.batchedVisuals.y,
          rest.control.batchedVisuals.y,
        ),
      },
    };
  }

  async function focusLabel() {
    return page.evaluate(() => window.__fw?.scene3d?.walk?.getFocusLabel?.() || null);
  }

  async function walkToFocus(startPose, pattern, maxSteps = 12) {
    await setCamera(startPose);
    const start = await cameraState();
    const labels = [];
    for (let step = 0; step <= maxSteps; step += 1) {
      const label = await focusLabel();
      labels.push(label);
      if (pattern.test(label || '')) {
        const camera = await cameraState();
        return {
          label,
          steps: step,
          labels,
          start,
          camera,
          walkDelta: +Math.hypot(camera.x - start.x, camera.z - start.z).toFixed(3),
        };
      }
      await page.keyboard.down('w');
      await page.waitForTimeout(115);
      await page.keyboard.up('w');
      await page.waitForTimeout(75);
    }
    fail(`Normal W walk did not focus ${pattern}; labels: ${JSON.stringify(labels)}`);
  }

  async function equipmentInteractionStart(
    asset,
    distance = 2.45,
    pitch = -0.15,
    radialDegrees = 90,
  ) {
    return page.evaluate(({
      asset: assetName,
      distance: offset,
      pitch: lookPitch,
      radialDegrees: degrees,
    }) => {
      const app = window.__fw;
      const clubhouse = app.scene3d.clubhouse();
      const origin = clubhouse.interior.position;
      const pose = clubhouse.deliveryEquipmentPose(assetName, 'INTERACTION_TARGET');
      if (!pose) throw new Error(`Missing ${assetName} interaction target.`);
      const radial = degrees * Math.PI / 180;
      return {
        x: pose.position.x - origin.x + Math.cos(radial) * offset,
        z: pose.position.z - origin.z + Math.sin(radial) * offset,
        yaw: Math.PI / 2 - radial,
        pitch: lookPitch,
      };
    }, {
      asset, distance, pitch, radialDegrees,
    });
  }

  async function prepareDeterministicPresentationFixture() {
    const prepared = await page.evaluate(async () => {
      const shop = await import('/src/sim/shop.js');
      const app = window.__fw;
      const clubhouse = app.scene3d.clubhouse();
      const reno = app.state?.shop?.reno;
      const clutter = reno?.clutter;
      if (!Array.isArray(clutter) || clutter.length === 0) {
        throw new Error('Expected deterministic renovation clutter in the QA bootstrap.');
      }
      if (!Array.isArray(reno.grime) || !Array.isArray(reno.windows)) {
        throw new Error('Expected deterministic grime and window state in the QA bootstrap.');
      }
      const clutterBefore = clutter.map((pile) => ({
        x: pile.x,
        z: pile.z,
        cleared: !!pile.cleared,
      }));
      const grimeBefore = [...reno.grime];
      const windowsBefore = [...reno.windows];
      for (const pile of clutter) pile.cleared = true;
      reno.grime.fill(0);
      reno.windows.fill(0);
      clubhouse.rebuildReno();
      return {
        scope: 'QA bootstrap presentation only; no CSS/UI hiding and no delivery/equipment state edits.',
        clutter: {
          count: clutter.length,
          alreadyCleared: clutterBefore.filter((pile) => pile.cleared).length,
          positions: clutterBefore.map(({ x, z }) => ({ x, z })),
          operation: 'Set each reno.clutter[i].cleared to true, then rebuilt renovation visuals.',
          allCleared: clutter.every((pile) => pile.cleared),
        },
        floorGrime: {
          cells: grimeBefore.length,
          dirtyCellsBefore: grimeBefore.filter((value) => value > 0).length,
          averageBefore: grimeBefore.reduce((sum, value) => sum + value, 0)
            / Math.max(1, grimeBefore.length),
          operation: 'Filled the existing reno.grime array with numeric zeroes.',
          allZeroAfter: reno.grime.every((value) => value === 0),
        },
        windows: {
          panes: windowsBefore.length,
          filmedPanesBefore: windowsBefore.filter((value) => value > 0).length,
          valuesBefore: windowsBefore,
          operation: 'Filled the existing reno.windows array with numeric zeroes.',
          allZeroAfter: reno.windows.every((value) => value === 0),
        },
        decorChanged: false,
        exteriorChanged: false,
        conditionAfter: shop.shopCondition(app.state),
      };
    });
    await page.waitForTimeout(350);
    return prepared;
  }

  async function waitForBeat(beat, orderId = fixtureOrderId) {
    await page.waitForFunction(({ expectedBeat, expectedOrderId }) => {
      const history = window.__fw?.scene3d?.clubhouse?.()?.deliveryEquipmentDiagnostics?.()?.beatHistory || [];
      return history.some((entry) => (
        entry.beat === expectedBeat && String(entry.orderId) === String(expectedOrderId)
      ));
    }, { expectedBeat: beat, expectedOrderId: orderId }, { timeout: 30000 });
    const snapshot = await page.evaluate(() => (
      window.__fw.scene3d.clubhouse().deliveryEquipmentDiagnostics()
    ));
    phases.push({ beat, snapshot, at: new Date().toISOString() });
    return snapshot;
  }

  async function equipmentAssetAudit() {
    return page.evaluate(() => {
      const app = window.__fw;
      const clubhouse = app.scene3d.clubhouse();
      const scene = app.scene3d.scene;
      const specifications = [
        ['delivery_van', '41', [
          'SLIDING_CARGO_DOOR_RIGHT_PIVOT',
          'REAR_CARGO_DOOR_LEFT_HINGE_PIVOT',
          'WHEEL_FRONT_LEFT_PIVOT',
          'CARGO_BAY_RIBS_AND_THRESHOLD',
          'CARGO_FLOOR',
        ]],
        ['delivery_hand_truck', '42', ['AXLE_ASSEMBLY', 'WHEEL_LEFT_PIVOT', 'WHEEL_RIGHT_PIVOT', 'INTERACTION_TARGET']],
        ['delivery_stocking_cart', '43', ['STOCK_SOCKET_01', 'STOCK_SOCKET_06', 'INTERACTION_TARGET']],
        ['delivery_pallet_jack', '45', ['HANDLE_TILT_PIVOT', 'FORK_LIFT_SLIDE', 'PALLET_COUPLING_SOCKET', 'INTERACTION_TARGET']],
      ];
      const assets = specifications.map(([id, reference, requiredNodes]) => {
        const root = scene.getObjectByName(id);
        let visibleMeshes = 0;
        let visibleHelpers = 0;
        root?.traverseVisible((object) => {
          if (!object.isMesh) return;
          visibleMeshes += 1;
          if (object.userData?.helper || /^(?:COL_|COLLISION_|VOLUME_)/i.test(object.name || '')) {
            visibleHelpers += 1;
          }
        });
        return {
          id,
          reference,
          exists: !!root,
          metadataReference: String(root?.userData?.reference_id || ''),
          assetId: root?.userData?.asset_id || null,
          dimensions: root?.userData?.target_dimensions_m || null,
          missingNodes: requiredNodes.filter((name) => !root?.getObjectByName(name)),
          visibleMeshes,
          visibleHelpers,
        };
      });
      const stage = scene.getObjectByName('DeliveryPalletStage');
      const palletAnchors = Array.from({ length: 5 }, (_, index) => (
        stage?.getObjectByName(`DeliveryPallet_${index + 1}`)?.name || null
      ));
      const logicalTop = clubhouse.deliveryEquipmentPose(
        'delivery_stocking_cart',
        'STOCK_BOX_SOCKET_TOP',
      );
      const featureNames = [
        'DeliveryVanServiceBay',
        'DeliveryVanServiceBayMarkings',
        'DeliveryApronVanBayTransferStrip',
        'DeliveryVanServiceDrive',
        'DeliveryVanApproachTrackLeft',
        'DeliveryVanApproachTrackRight',
        'DeliveryVanDepartureTrackLeft',
        'DeliveryVanDepartureTrackRight',
        'BackroomOperationsBoard',
        'HandTruckSafetyPlacard',
      ];
      const environment = Object.fromEntries(featureNames.map((name) => {
        const root = scene.getObjectByName(name);
        const world = root ? root.getWorldPosition(root.position.clone()) : null;
        return [name, {
          exists: !!root,
          visible: !!root?.visible,
          worldPosition: world?.toArray() || null,
          surfaceY: Number.isFinite(root?.userData?.surfaceY)
            ? root.userData.surfaceY : null,
          dimensions: root?.userData?.dimensions || null,
        }];
      }));
      return {
        ready: clubhouse.deliveryEquipmentReady(),
        metrics: clubhouse.deliveryEquipmentMetrics(),
        diagnostics: clubhouse.deliveryEquipmentDiagnostics(),
        assets,
        pallet: {
          stageExists: !!stage,
          ready: stage?.userData?.ready === true,
          authoredPalletCount: stage?.userData?.authoredPalletCount ?? null,
          anchors: palletAnchors,
          batchedVisuals: !!stage?.getObjectByName('DeliveryPalletBatchedVisuals'),
        },
        logicalTopSocket: logicalTop ? {
          exists: true,
          position: logicalTop.position.toArray(),
          scale: logicalTop.scale.toArray(),
        } : { exists: false },
        environment,
      };
    });
  }

  async function resourceCensus() {
    return page.evaluate(() => {
      const app = window.__fw;
      const scene = app.scene3d.scene;
      const renderer = app.scene3d.renderer;
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
          Object.values(material).forEach((value) => {
            if (value?.isTexture) textures.add(value.uuid);
          });
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

  async function measureFrames(label, durationMs = 1800) {
    await page.waitForTimeout(500);
    const timing = await page.evaluate((duration) => new Promise((resolve) => {
      const deltas = [];
      let previous = performance.now();
      const start = previous;
      const tick = (now) => {
        deltas.push(now - previous);
        previous = now;
        if (now - start < duration) requestAnimationFrame(tick);
        else {
          const measured = deltas.slice(5).sort((a, b) => a - b);
          const averageMs = measured.reduce((sum, value) => sum + value, 0)
            / Math.max(1, measured.length);
          const lowCount = Math.max(1, Math.ceil(measured.length * 0.01));
          const lowMs = measured.slice(-lowCount).reduce((sum, value) => sum + value, 0) / lowCount;
          resolve({
            frames: measured.length,
            averageFps: +(1000 / averageMs).toFixed(2),
            low1Fps: +(1000 / lowMs).toFixed(2),
            averageFrameMs: +averageMs.toFixed(3),
            worstFrameMs: +(measured[measured.length - 1] || 0).toFixed(3),
            framesOver33Ms: measured.filter((value) => value > 33.334).length,
          });
        }
      };
      requestAnimationFrame(tick);
    }), durationMs);
    return { label, durationMs, ...timing, resources: await resourceCensus() };
  }

  async function stageArrival() {
    return page.evaluate(async ({ orderId, qty, queuedOrderId, queuedQty }) => {
      const D = await import('/src/sim/deliveries.js');
      const B = await import('/src/data/boxes.js');
      const app = window.__fw;
      const state = app.state;
      D.ensureDeliveries(state);
      state.shop.carry = null;
      const delivery = state.shop.deliveries;
      delivery.boxes = [];
      delivery.shipments = [];
      delivery.arrivedOrderIds = [];
      delivery.nextBoxId = 1;
      delivery.trash = 0;
      delivery.recycled = 0;
      const dimensions = B.boxDims('merchbox');
      const makeManifest = (supplierId, supplier, units) => ({
        supplierId,
        supplier,
        boxes: [{
          kind: 'merchbox', qty: units,
          w: dimensions.w, h: dimensions.h, d: dimensions.d,
          lb: 5.1, fragile: false,
        }],
        boxCount: 1,
        weight: 5.1,
        fee: 0,
      });
      const manifest = makeManifest(
        'delivery-equipment-qa',
        'Pinehollow Equipment QA',
        qty,
      );
      const queuedManifest = makeManifest(
        'delivery-equipment-qa-queued',
        'Pinehollow Queued QA',
        queuedQty,
      );
      const [box] = D.arriveOrder(state, { id: orderId, skuId: 'cap1', qty, manifest });
      if (!box) throw new Error('Production arriveOrder did not create the QA carton.');
      const [queuedBox] = D.arriveOrder(state, {
        id: queuedOrderId,
        skuId: 'cap1',
        qty: queuedQty,
        manifest: queuedManifest,
      });
      if (!queuedBox) throw new Error('Production arriveOrder did not create the queued QA carton.');
      // Ref45 is physically coupled to persisted Ref44 lane index 2. Keep the
      // production-created carton on that authoritative lane so the lift audit
      // exercises a real staged load and the later normal E pickup uses it.
      box.padPalletIndex = 2;
      delete box.padStagingOverflow;
      const clubhouse = app.scene3d.clubhouse();
      const handle = clubhouse.presentDeliveryArrival({
        orderId,
        boxCount: 1,
        skuId: 'cap1',
        supplier: manifest.supplier,
      });
      if (!handle) throw new Error('Production presentDeliveryArrival rejected the QA arrival.');
      const queuedHandle = clubhouse.presentDeliveryArrival({
        orderId: queuedOrderId,
        boxCount: 1,
        skuId: 'cap1',
        supplier: queuedManifest.supplier,
      });
      if (!queuedHandle) throw new Error('Production presentDeliveryArrival rejected the queued QA arrival.');
      window.__deliveryEquipmentQaArrival = handle;
      window.__deliveryEquipmentQaArrivalResult = null;
      handle.promise.then((result) => { window.__deliveryEquipmentQaArrivalResult = result; });
      window.__deliveryEquipmentQaQueuedArrival = queuedHandle;
      window.__deliveryEquipmentQaQueuedArrivalResult = null;
      queuedHandle.promise.then((result) => {
        window.__deliveryEquipmentQaQueuedArrivalResult = result;
      });
      clubhouse.rebuildBoxes();
      return {
        box: {
          id: box.id,
          orderId: box.orderId,
          skuId: box.skuId,
          kind: box.box,
          qty: box.qty,
          padPalletIndex: box.padPalletIndex,
        },
        arrival: { id: handle.id, orderId: handle.orderId, status: handle.status },
        queued: {
          box: {
            id: queuedBox.id,
            orderId: queuedBox.orderId,
            skuId: queuedBox.skuId,
            kind: queuedBox.box,
            qty: queuedBox.qty,
            padPalletIndex: queuedBox.padPalletIndex,
          },
          arrival: {
            id: queuedHandle.id,
            orderId: queuedHandle.orderId,
            status: queuedHandle.status,
          },
        },
      };
    }, {
      orderId: fixtureOrderId,
      qty: fixtureQty,
      queuedOrderId: queuedFixtureOrderId,
      queuedQty: queuedFixtureQty,
    });
  }

  async function arrivalState(boxId) {
    return page.evaluate((id) => {
      const app = window.__fw;
      const box = app.state.shop.deliveries.boxes.find((entry) => entry.id === id) || null;
      const root = app.scene3d.scene.getObjectByName(`DeliveryBox_${id}`)
        || app.scene3d.scene.getObjectByName(`DeliveryBoxFallback_${id}`);
      return {
        box: box ? {
          id: box.id,
          orderId: box.orderId,
          loc: box.loc,
          qty: box.qty,
          initialQty: box.initialQty,
          padPalletIndex: box.padPalletIndex,
          equipmentId: box.equipmentId,
          socketId: box.socketId,
        } : null,
        boxVisible: !!root && root.visible,
        root: root ? {
          name: root.name,
          parentName: root.parent?.name || null,
          presentationState: root.userData?.deliveryPresentationState || null,
          interactionEnabled: root.userData?.deliveryInteractionEnabled === true,
        } : null,
        arrivalHandleStatus: window.__deliveryEquipmentQaArrival?.status || null,
        arrivalResult: window.__deliveryEquipmentQaArrivalResult || null,
        diagnostics: app.scene3d.clubhouse().deliveryEquipmentDiagnostics(),
      };
    }, boxId);
  }

  async function cargoPresentationEvidence(boxId, queuedBoxIds = []) {
    return page.evaluate(({ activeBoxId, queuedIds }) => {
      const app = window.__fw;
      const scene = app.scene3d.scene;
      const clubhouse = app.scene3d.clubhouse();
      const diagnostics = clubhouse.deliveryBoxPresentationDiagnostics();
      const box = app.state.shop.deliveries.boxes.find((entry) => entry.id === activeBoxId) || null;
      const rootFor = (id) => scene.getObjectByName(`DeliveryBox_${id}`)
        || scene.getObjectByName(`DeliveryBoxFallback_${id}`);
      const root = rootFor(activeBoxId);
      const effectiveVisible = (object) => {
        let current = object;
        while (current) {
          if (!current.visible) return false;
          current = current.parent;
        }
        return !!object;
      };
      const ancestorNames = [];
      for (let current = root?.parent; current; current = current.parent) {
        ancestorNames.push(current.name || current.type || '(unnamed)');
      }
      if (root) root.updateWorldMatrix(true, false);
      const cargo = diagnostics.cargo.find((entry) => entry.boxId === activeBoxId) || null;
      const transfer = diagnostics.transfers.find((entry) => entry.boxId === activeBoxId) || null;
      const recentTransfer = [...diagnostics.recentTransfers]
        .reverse().find((entry) => entry.boxId === activeBoxId) || null;
      const activeArrival = clubhouse.deliveryEquipmentDiagnostics().activeArrival;
      const queued = queuedIds.map((id) => {
        const queuedRoot = rootFor(id);
        const pending = diagnostics.pending.find((entry) => entry.boxId === id) || null;
        return {
          boxId: id,
          rootExists: !!queuedRoot,
          effectiveVisible: effectiveVisible(queuedRoot),
          pending,
          cargoPlanned: diagnostics.cargo.some((entry) => entry.boxId === id),
          transferPlanned: diagnostics.transfers.some((entry) => entry.boxId === id),
        };
      });
      return {
        box: box ? {
          id: box.id,
          orderId: box.orderId,
          qty: box.qty,
          initialQty: box.initialQty,
          loc: box.loc,
          padPalletIndex: box.padPalletIndex,
        } : null,
        root: root ? {
          name: root.name,
          parentName: root.parent?.name || null,
          ancestorNames,
          effectiveVisible: effectiveVisible(root),
          worldPosition: root.getWorldPosition(root.position.clone()).toArray(),
          localPosition: root.position.toArray(),
          presentationState: root.userData.deliveryPresentationState || null,
          cargoOrderId: root.userData.deliveryCargoOrderId ?? null,
          cargoLoadId: root.userData.deliveryCargoLoadId || null,
          cargoPlacementIndex: root.userData.deliveryCargoPlacementIndex ?? null,
          cargoRestProfile: root.userData.deliveryCargoRestProfile || null,
          cargoAnchorError: root.userData.deliveryCargoAnchorError ?? null,
          transferProgress: root.userData.deliveryTransferProgress ?? null,
          transferPhase: root.userData.deliveryTransferPhase || null,
          interactionEnabled: root.userData.deliveryInteractionEnabled === true,
        } : null,
        cargo,
        transfer,
        recentTransfer,
        queued,
        diagnostics,
        activeArrival,
        unloadBeatSeen: clubhouse.deliveryEquipmentDiagnostics().beatHistory.some((entry) => (
          entry.beat === 'unload' && String(entry.orderId) === String(box?.orderId)
        )),
      };
    }, { activeBoxId: boxId, queuedIds: queuedBoxIds });
  }

  async function cancelAndRemoveQueuedFixture(queuedBoxId) {
    return page.evaluate(async ({ boxId, orderId }) => {
      const app = window.__fw;
      const deliveries = app.state.shop.deliveries;
      const handle = window.__deliveryEquipmentQaQueuedArrival;
      const before = {
        handleStatus: handle?.status || null,
        boxExists: deliveries.boxes.some((box) => box.id === boxId),
      };
      const cancelAccepted = handle?.cancel?.('iteration-08-queued-cargo-evidence-complete') ?? false;
      const result = handle?.promise ? await handle.promise : null;
      deliveries.boxes = deliveries.boxes.filter((box) => box.id !== boxId);
      deliveries.shipments = deliveries.shipments.filter((shipment) => (
        String(shipment.orderId) !== String(orderId)
      ));
      deliveries.arrivedOrderIds = deliveries.arrivedOrderIds.filter((id) => (
        String(id) !== String(orderId)
      ));
      app.scene3d.clubhouse().rebuildBoxes();
      return {
        scope: 'Removed only the deterministic queued QA order after proving queue isolation.',
        before,
        cancelAccepted,
        result,
        boxExistsAfter: deliveries.boxes.some((box) => box.id === boxId),
        shipmentExistsAfter: deliveries.shipments.some((shipment) => (
          String(shipment.orderId) === String(orderId)
        )),
      };
    }, { boxId: queuedBoxId, orderId: queuedFixtureOrderId });
  }

  async function serviceDriveEvidence() {
    return page.evaluate(async () => {
      const THREE = await import('/vendor/three.module.js');
      const scene = window.__fw.scene3d.scene;
      const drive = scene.getObjectByName('DeliveryVanServiceDrive');
      const bay = scene.getObjectByName('DeliveryVanServiceBay');
      scene.updateMatrixWorld(true);
      const bayBounds = bay ? new THREE.Box3().setFromObject(bay) : null;
      const names = [
        'DeliveryVanApproachTrackLeft',
        'DeliveryVanApproachTrackRight',
        'DeliveryVanDepartureTrackLeft',
        'DeliveryVanDepartureTrackRight',
      ];
      const tracks = names.map((name) => {
        const track = scene.getObjectByName(name);
        const bounds = track ? new THREE.Box3().setFromObject(track) : null;
        const size = bounds?.getSize(new THREE.Vector3()) || null;
        const center = bounds?.getCenter(new THREE.Vector3()) || null;
        const overlapsBay = !!(bounds && bayBounds
          && bounds.max.x >= bayBounds.min.x && bounds.min.x <= bayBounds.max.x
          && bounds.max.z >= bayBounds.min.z && bounds.min.z <= bayBounds.max.z);
        return {
          name,
          exists: !!track,
          visible: track?.visible === true,
          vertexCount: track?.geometry?.attributes?.position?.count ?? 0,
          triangleCount: track?.geometry?.index
            ? track.geometry.index.count / 3
            : (track?.geometry?.attributes?.position?.count ?? 0) / 3,
          worldCenter: center?.toArray() || null,
          worldSize: size?.toArray() || null,
          yRange: bounds ? [bounds.min.y, bounds.max.y] : null,
          touchesServiceBay: overlapsBay,
        };
      });
      return {
        drive: {
          exists: !!drive,
          visible: drive?.visible === true,
          childCount: drive?.children?.length ?? 0,
        },
        tracks,
      };
    });
  }

  async function serviceBayGroundingEvidence() {
    return page.evaluate(async () => {
      const THREE = await import('/vendor/three.module.js');
      const app = window.__fw;
      const scene = app.scene3d.scene;
      const clubhouse = app.scene3d.clubhouse();
      const bay = scene.getObjectByName('DeliveryVanServiceBay');
      const markings = scene.getObjectByName('DeliveryVanServiceBayMarkings');
      const transferStrip = scene.getObjectByName('DeliveryApronVanBayTransferStrip');
      const van = clubhouse.deliveryEquipmentPose('delivery_van');
      const vanRoot = scene.getObjectByName('delivery_van');
      const dimensions = bay?.userData?.dimensions || null;
      const slabTop = bay && dimensions
        ? bay.getWorldPosition(bay.position.clone()).y + dimensions.depth / 2 : null;
      scene.updateMatrixWorld(true);
      const bayBounds = bay ? new THREE.Box3().setFromObject(bay) : null;
      const wheelContacts = [
        'WHEEL_FRONT_LEFT_PIVOT',
        'WHEEL_FRONT_RIGHT_PIVOT',
        'WHEEL_REAR_LEFT_PIVOT',
        'WHEEL_REAR_RIGHT_PIVOT',
      ].map((name) => {
        const pivot = vanRoot?.getObjectByName(name) || null;
        const worldPosition = pivot?.getWorldPosition(new THREE.Vector3()) || null;
        // Box3.setFromObject transforms each child's local AABB. Once a wheel
        // has spun, rotating the square AABB corners exaggerates a round tire's
        // vertical envelope by up to ~8 cm. Measure the rendered vertices so
        // this gate tests the actual contact patch instead of that broad phase.
        let visualContactY = null;
        if (pivot) {
          let minimum = Infinity;
          const vertex = new THREE.Vector3();
          pivot.traverse((object) => {
            const positions = object.geometry?.attributes?.position;
            if (!positions) return;
            for (let index = 0; index < positions.count; index += 1) {
              vertex.fromBufferAttribute(positions, index).applyMatrix4(object.matrixWorld);
              minimum = Math.min(minimum, vertex.y);
            }
          });
          if (Number.isFinite(minimum)) visualContactY = minimum;
        }
        const surfaceY = bay?.userData?.surfaceY ?? null;
        return {
          name,
          exists: !!pivot,
          worldPosition: worldPosition?.toArray() || null,
          visualContactY,
          visualContactDeltaToSurface: Number.isFinite(visualContactY)
            && Number.isFinite(surfaceY) ? Math.abs(visualContactY - surfaceY) : null,
          insideServiceBay: !!(worldPosition && bayBounds
            && worldPosition.x >= bayBounds.min.x && worldPosition.x <= bayBounds.max.x
            && worldPosition.z >= bayBounds.min.z && worldPosition.z <= bayBounds.max.z),
        };
      });
      const contactYs = wheelContacts
        .map((entry) => entry.visualContactY)
        .filter(Number.isFinite);
      return {
        bay: {
          exists: !!bay,
          name: bay?.name || null,
          surfaceY: bay?.userData?.surfaceY ?? null,
          slabTop,
          dimensions,
        },
        markings: { exists: !!markings, name: markings?.name || null },
        transferStrip: { exists: !!transferStrip, name: transferStrip?.name || null },
        van: van ? {
          worldPosition: van.position.toArray(),
          visible: van.visible,
        } : null,
        vanToSurfaceDelta: van && Number.isFinite(bay?.userData?.surfaceY)
          ? Math.abs(van.position.y - bay.userData.surfaceY) : null,
        wheelContacts,
        wheelContactSpread: contactYs.length === 4
          ? Math.max(...contactYs) - Math.min(...contactYs) : null,
      };
    });
  }

  async function clearwayAndCollisionEvidence(includeVan = false) {
    return page.evaluate(async (withVan) => {
      const L = await import('/src/data/shopLayout.js');
      const S = await import('/src/data/deliveryStaging.js');
      const app = window.__fw;
      const clubhouse = app.scene3d.clubhouse();
      const origin = clubhouse.interior.position;
      const isFreeLocal = (x, z, radius = 0.18) => app.scene3d.walk.isFree(
        origin.x + x,
        origin.z + z,
        radius,
      );
      const clearwaySamples = [];
      for (const x of [7.9, 8.5, 9.1, 9.7]) {
        for (const z of [-4.3, -3.6, -2.9]) {
          clearwaySamples.push({ x, z, free: isFreeLocal(x, z, 0.16) });
        }
      }
      const assetIds = [
        'delivery_hand_truck',
        'delivery_stocking_cart',
        'delivery_pallet_jack',
      ];
      if (withVan) assetIds.push('delivery_van');
      const equipmentCenters = Object.fromEntries(assetIds.map((asset) => {
        const pose = clubhouse.deliveryEquipmentPose(asset);
        return [asset, pose ? {
          position: pose.position.toArray(),
          freeAtCenter: app.scene3d.walk.isFree(pose.position.x, pose.position.z, 0.16),
          visible: pose.visible,
        } : null];
      }));
      const vanCollisionNodeNames = [
        'COL_VAN_CARGO_FLOOR',
        'COL_VAN_CAB',
        'COL_VAN_CARGO_LEFT_WALL',
      ];
      const vanNodeCenters = withVan ? Object.fromEntries(vanCollisionNodeNames.map((name) => {
        const node = app.scene3d.scene.getObjectByName(name);
        if (!node?.geometry) return [name, { exists: !!node, position: null, freeAtCenter: null }];
        node.updateWorldMatrix(true, false);
        if (!node.geometry.boundingBox) node.geometry.computeBoundingBox();
        const center = node.geometry.boundingBox.getCenter(node.position.clone())
          .applyMatrix4(node.matrixWorld);
        return [name, {
          exists: true,
          position: center.toArray(),
          freeAtCenter: app.scene3d.walk.isFree(center.x, center.z, 0.16),
          nodeVisible: node.visible,
        }];
      })) : {};
      const palletCenters = S.deliveryPalletCentres().map((center, index) => ({
        index,
        x: center.x,
        z: center.z,
        freeAtCenter: isFreeLocal(center.x, center.z, 0.16),
      }));
      return {
        contract: { ...L.BACKDOOR_CLEARWAY },
        clearwaySamples,
        equipmentCenters,
        vanNodeCenters,
        palletCenters,
      };
    }, includeVan);
  }

  async function autosaveSnapshot(boxId) {
    return page.evaluate(async (id) => {
      const app = window.__fw;
      await app.autosave();
      const raw = localStorage.getItem('golfempire:autosave');
      if (!raw) throw new Error('The game autosave did not write golfempire:autosave.');
      const empire = JSON.parse(raw);
      const holding = empire.holdings.find((entry) => entry.property.id === empire.activeId);
      if (!holding) throw new Error(`Autosave is missing active holding ${empire.activeId}.`);
      const box = holding.state.shop.deliveries.boxes.find((entry) => entry.id === id);
      if (!box) throw new Error(`Autosave is missing delivery box ${id}.`);
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
      return {
        storageKey: 'golfempire:autosave',
        bytes: raw.length,
        sha256: [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join(''),
        activeId: empire.activeId,
        box: {
          id: box.id,
          orderId: box.orderId,
          skuId: box.skuId,
          kind: box.box,
          loc: box.loc,
          equipmentId: box.equipmentId,
          socketId: box.socketId,
          qty: box.qty,
          schemaVersion: box.schemaVersion,
        },
      };
    }, boxId);
  }

  async function reloadedBoxSnapshot(boxId) {
    await page.waitForFunction((id) => {
      const app = window.__fw;
      const box = app?.state?.shop?.deliveries?.boxes?.find((entry) => entry.id === id);
      const root = app?.scene3d?.scene?.getObjectByName(`DeliveryBox_${id}`)
        || app?.scene3d?.scene?.getObjectByName(`DeliveryBoxFallback_${id}`);
      return box?.loc === 'equipment' && !!root;
    }, boxId, { timeout: 30000 });
    return page.evaluate((id) => {
      const app = window.__fw;
      const clubhouse = app.scene3d.clubhouse();
      const box = app.state.shop.deliveries.boxes.find((entry) => entry.id === id);
      const root = app.scene3d.scene.getObjectByName(`DeliveryBox_${id}`)
        || app.scene3d.scene.getObjectByName(`DeliveryBoxFallback_${id}`);
      const socket = clubhouse.deliveryEquipmentPose(box.equipmentId, box.socketId);
      const world = root.getWorldPosition(root.position.clone());
      return {
        box: {
          id: box.id,
          orderId: box.orderId,
          skuId: box.skuId,
          kind: box.box,
          loc: box.loc,
          equipmentId: box.equipmentId,
          socketId: box.socketId,
          qty: box.qty,
          schemaVersion: box.schemaVersion,
        },
        visual: {
          rootName: root.name,
          worldPosition: world.toArray(),
          socketPosition: socket?.position?.toArray() || null,
          socketDistance: socket ? world.distanceTo(socket.position) : null,
        },
      };
    }, boxId);
  }

  const cameras = Object.freeze({
    stockroomOverview: { x: 8.8, z: -1.8, yaw: 0.74, pitch: -0.20 },
    receivingOverview: { x: 16.3, z: 4.9, yaw: 0.52, pitch: -0.25 },
    approach: { x: 25.2, z: 9.2, yaw: 1.00, pitch: -0.14 },
    cartClose: { x: 6.35, z: -1.75, yaw: 0, pitch: -0.25 },
  });

  let report;
  try {
    await boot();
    const viewport = await page.evaluate(() => ({
      width: innerWidth,
      height: innerHeight,
      dpr: devicePixelRatio,
    }));
    const videoRecordingEnabled = !!page.video();
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Performance.enable');
    const presentationFixture = await prepareDeterministicPresentationFixture();
    evidenceCameras = await buildEvidenceCameras();

    await capture(
      '00-refs42-43-stockroom-overview.png',
      'Fixed player camera: authored hand truck and three-tier stocking cart in the stockroom.',
      cameras.stockroomOverview,
    );
    const signageCapture = await capture(
      '00b-refs42-43-operations-safety-signage.png',
      'Player-height stockroom view frames the authored operations board and hand-truck safety placard together.',
      evidenceCameras.stockroomSafetySignage,
    );
    const signageEvidence = {
      operationsBoard: {
        frame: await objectFrameEvidence('BackroomOperationsBoard'),
        lineOfSight: await objectLineOfSightEvidence('BackroomOperationsBoard'),
      },
      handTruckSafety: {
        frame: await objectFrameEvidence('HandTruckSafetyPlacard'),
        lineOfSight: await objectLineOfSightEvidence('HandTruckSafetyPlacard'),
      },
    };
    requireTruth(
      Object.values(signageEvidence).every((entry) => (
        entry.frame.exists
        && entry.frame.inFrame
        && entry.frame.fullyInside
        && entry.frame.viewportCoverage >= 0.002
        && entry.lineOfSight.projectedSamples >= 4
        && entry.lineOfSight.visibleSamples >= 2
        && entry.lineOfSight.visibleRatio >= 0.5
      )),
      `Operations/safety signage was not framed with readable line of sight: ${JSON.stringify(signageEvidence)}`,
    );
    await capture(
      '01-refs44-45-receiving-overview.png',
      'Fixed player camera: five authored receiving pallets and the pallet jack with an open back-door route.',
      cameras.receivingOverview,
    );
    const serviceBayCapture = await capture(
      '01b-ref41-service-bay-ready.png',
      'Exterior player view frames the named delivery service slab, painted bay markings, and transfer strip before arrival.',
      evidenceCameras.serviceBayReady,
    );
    const serviceBayFrameEvidence = {
      slab: await objectFrameEvidence('DeliveryVanServiceBay'),
      markings: await objectFrameEvidence('DeliveryVanServiceBayMarkings'),
      transferStrip: await objectFrameEvidence('DeliveryApronVanBayTransferStrip'),
    };
    requireTruth(
      Object.values(serviceBayFrameEvidence).every((entry) => entry.exists && entry.inFrame),
      `Service bay authored nodes were not framed: ${JSON.stringify(serviceBayFrameEvidence)}`,
    );
    const serviceDriveCapture = await capture(
      '01c-ref41-service-drive-route.png',
      'Wide exterior player view frames the terrain-conforming approach and departure wheel ribbons as one continuous service route through the parking slab.',
      evidenceCameras.serviceDriveOverview,
    );
    const serviceDriveFrameEvidence = {
      drive: await objectFrameEvidence('DeliveryVanServiceDrive'),
      approachLeft: await objectFrameEvidence('DeliveryVanApproachTrackLeft'),
      approachRight: await objectFrameEvidence('DeliveryVanApproachTrackRight'),
      departureLeft: await objectFrameEvidence('DeliveryVanDepartureTrackLeft'),
      departureRight: await objectFrameEvidence('DeliveryVanDepartureTrackRight'),
    };
    const serviceDriveGeometryEvidence = await serviceDriveEvidence();
    requireTruth(
      serviceDriveGeometryEvidence.drive.exists
        && serviceDriveGeometryEvidence.drive.visible
        && serviceDriveGeometryEvidence.drive.childCount === 4
        && serviceDriveGeometryEvidence.tracks.length === 4
        && serviceDriveGeometryEvidence.tracks.every((entry) => (
          entry.exists
          && entry.visible
          && entry.vertexCount === 50
          && entry.triangleCount === 48
          && Math.max(entry.worldSize?.[0] || 0, entry.worldSize?.[2] || 0) >= 5.5
          && entry.touchesServiceBay
        ))
        && Object.values(serviceDriveFrameEvidence).every((entry) => entry.exists && entry.inFrame),
      `Service drive was not a visible four-track route joined to the bay: ${JSON.stringify({
        serviceDriveFrameEvidence,
        serviceDriveGeometryEvidence,
      })}`,
    );
    const assetAudit = await equipmentAssetAudit();
    const metricsBefore = await measureFrames('refs41-45-ready-idle');

    await setCamera(cameras.approach);
    const fixture = await stageArrival();
    await page.waitForFunction(() => {
      const active = window.__fw?.scene3d?.clubhouse?.()?.deliveryEquipmentDiagnostics?.()?.activeArrival;
      // Playwright's full-page GPU readback advances this 3.8 s animation by
      // about 0.12 before capture context is sampled. Gate early so the actual
      // evidence frame lands at the requested mid-route p≈0.55–0.60.
      return active?.phase === 'approach' && active.progress >= 0.44;
    }, null, { timeout: 10000 });
    const approachCargoEvidence = await cargoPresentationEvidence(
      fixture.box.id,
      [fixture.queued.box.id],
    );
    // Preserve the availability contract: the paid carton is not exposed on
    // receiving before UNLOAD. Iteration 08 renders that same authoritative,
    // dimension-planned carton inside the van without a prop or collider.
    const hiddenDuringApproach = approachCargoEvidence.root?.effectiveVisible === true
      && approachCargoEvidence.root.parentName === 'DeliveryEquipmentRoot_delivery_van'
      && approachCargoEvidence.cargo?.interactionEnabled === false
      && approachCargoEvidence.cargo?.colliderEnabled === false
      && approachCargoEvidence.queued.every((entry) => !entry.rootExists);
    const approachCapture = await capture(
      '02-ref41-van-approach.png',
      'Wide fixed player view fully frames the real van approaching receiving; its authoritative carton travels inside the closed, noninteractive cargo bay.',
    );
    const collisionDuringApproach = await clearwayAndCollisionEvidence(true);
    const approachFrameEvidence = await objectFrameEvidence('delivery_van');
    requireTruth(
      approachFrameEvidence.inFrame
        && approachFrameEvidence.fullyInside
        && approachFrameEvidence.viewportCoverage >= 0.015,
      `Approaching van was not fully framed: ${JSON.stringify(approachFrameEvidence)}`,
    );
    requireTruth(
      collisionDuringApproach.vanNodeCenters.COL_VAN_CARGO_FLOOR?.freeAtCenter === false
        && collisionDuringApproach.vanNodeCenters.COL_VAN_CAB?.freeAtCenter === false
        && collisionDuringApproach.vanNodeCenters.COL_VAN_CARGO_LEFT_WALL?.freeAtCenter === false,
      `Closed moving approach van collision contract failed: ${JSON.stringify(collisionDuringApproach)}`,
    );

    await waitForBeat('parked');
    await waitForBeat('doors-opening');
    await setCamera(evidenceCameras.vanParkedOpening, 20);
    await page.waitForFunction(() => {
      const active = window.__fw?.scene3d?.clubhouse?.()?.deliveryEquipmentDiagnostics?.()?.activeArrival;
      return active?.phase === 'opening' && active.progress >= 0.18;
    }, null, { timeout: 10000 });
    const parkedOpeningCapture = await captureFrozenFrame(
      '03-ref41-parked-doors-opening.png',
      'Wide rear three-quarter player view fully frames the parked van and authored cargo-door pivots during opening.',
    );
    const parkedVanPose = await equipmentLocalPose('delivery_van');
    const parkedFrameEvidence = await objectFrameEvidence('delivery_van');
    const parkedServiceBayGrounding = await serviceBayGroundingEvidence();
    requireTruth(
      parkedFrameEvidence.inFrame
        && parkedFrameEvidence.fullyInside
        && parkedFrameEvidence.viewportCoverage >= 0.015,
      `Parked opening van was not fully framed: ${JSON.stringify(parkedFrameEvidence)}`,
    );
    requireTruth(
      parkedServiceBayGrounding.bay.exists
        && parkedServiceBayGrounding.markings.exists
        && parkedServiceBayGrounding.transferStrip.exists
        && parkedServiceBayGrounding.van?.visible === true
        && parkedServiceBayGrounding.vanToSurfaceDelta != null
        && parkedServiceBayGrounding.vanToSurfaceDelta <= 0.002
        && Math.abs(
          parkedServiceBayGrounding.bay.surfaceY - parkedServiceBayGrounding.bay.slabTop,
        ) <= 0.0001,
      `Parked van was not grounded on the authored service slab: ${JSON.stringify(parkedServiceBayGrounding)}`,
    );
    requireTruth(
      parkedServiceBayGrounding.wheelContacts.length === 4
        && parkedServiceBayGrounding.wheelContacts.every((entry) => (
          entry.exists
          && entry.insideServiceBay
          && entry.visualContactDeltaToSurface != null
          && entry.visualContactDeltaToSurface <= 0.035
        ))
        && parkedServiceBayGrounding.wheelContactSpread != null
        && parkedServiceBayGrounding.wheelContactSpread <= 0.02,
      `All four authored van wheels were not visibly grounded on the service slab: ${JSON.stringify(parkedServiceBayGrounding)}`,
    );

    await setCamera(evidenceCameras.vanCargoOpen, 20);
    await waitForBeat('cargo-open');
    await page.waitForFunction(({ orderId }) => {
      const diagnostics = window.__fw?.scene3d?.clubhouse?.()?.deliveryEquipmentDiagnostics?.();
      const active = diagnostics?.activeArrival;
      const unloadSeen = diagnostics?.beatHistory?.some((entry) => (
        entry.beat === 'unload' && String(entry.orderId) === String(orderId)
      ));
      return active?.phase === 'open-hold' && unloadSeen === false;
    }, { orderId: fixtureOrderId }, { timeout: 10000 });
    const pendingCargoEvidence = await cargoPresentationEvidence(
      fixture.box.id,
      [fixture.queued.box.id],
    );
    const pendingCargoFrameEvidence = await objectFrameEvidence(
      pendingCargoEvidence.root?.name || `DeliveryBox_${fixture.box.id}`,
    );
    const pendingCargoLineOfSightEvidence = await objectLineOfSightEvidence(
      pendingCargoEvidence.root?.name || `DeliveryBox_${fixture.box.id}`,
    );
    requireTruth(
      pendingCargoEvidence.activeArrival?.phase === 'open-hold'
        && pendingCargoEvidence.unloadBeatSeen === false
        && pendingCargoEvidence.diagnostics.quantityAuthority === 'state.shop.deliveries.boxes'
        && pendingCargoEvidence.diagnostics.cargoPlanner === 'dimension-aware-ref41-volume-v1'
        && pendingCargoEvidence.diagnostics.transferDurationSeconds === 1.35
        && String(pendingCargoEvidence.diagnostics.cargoOrderId) === String(fixtureOrderId)
        && pendingCargoEvidence.diagnostics.cargoLoadIndex === 0
        && pendingCargoEvidence.diagnostics.cargoLoadCount === 1
        && pendingCargoEvidence.diagnostics.overflowBoxIds.length === 0
        && pendingCargoEvidence.box?.id === fixture.box.id
        && String(pendingCargoEvidence.box?.orderId) === String(fixtureOrderId)
        && pendingCargoEvidence.box?.qty === fixtureQty
        && pendingCargoEvidence.box?.initialQty === fixtureQty
        && pendingCargoEvidence.box?.padPalletIndex === 2
        && pendingCargoEvidence.root?.parentName === 'DeliveryEquipmentRoot_delivery_van'
        && pendingCargoEvidence.root?.effectiveVisible === true
        && pendingCargoEvidence.root?.presentationState === 'van-cargo-pending'
        && String(pendingCargoEvidence.root?.cargoOrderId) === String(fixtureOrderId)
        && pendingCargoEvidence.root?.cargoLoadId === pendingCargoEvidence.cargo?.loadId
        && pendingCargoEvidence.root?.cargoPlacementIndex
          === pendingCargoEvidence.cargo?.placementIndex
        && pendingCargoEvidence.root?.cargoRestProfile
          === pendingCargoEvidence.cargo?.restProfile
        && pendingCargoEvidence.root?.cargoAnchorError <= 0.000001
        && pendingCargoEvidence.cargo?.mounted === true
        && pendingCargoEvidence.cargo?.state === 'van-cargo-pending'
        && pendingCargoEvidence.cargo?.clearanceSafe === true
        && pendingCargoEvidence.cargo?.clearance?.withinBounds === true
        && pendingCargoEvidence.cargo?.clearance?.minimum + 0.000001
          >= pendingCargoEvidence.cargo?.clearance?.required
        && pendingCargoEvidence.cargo?.support?.valid === true
        && Object.values(pendingCargoEvidence.cargo?.orientedDimensions || {})
          .every((value) => Number.isFinite(value) && value > 0)
        && pendingCargoEvidence.cargo?.interactionEnabled === false
        && pendingCargoEvidence.cargo?.colliderEnabled === false
        && pendingCargoEvidence.queued.length === 1
        && pendingCargoEvidence.queued.every((entry) => (
          !entry.rootExists
          && !entry.effectiveVisible
          && entry.pending?.viewMounted === false
          && entry.pending?.interactionEnabled === false
          && entry.pending?.colliderEnabled === false
          && !entry.cargoPlanned
          && !entry.transferPlanned
        )),
      `Pre-UNLOAD active/queued cargo contract failed: ${JSON.stringify(pendingCargoEvidence)}`,
    );
    requireTruth(
      pendingCargoFrameEvidence.inFrame
        && pendingCargoFrameEvidence.fullyInside
        && pendingCargoLineOfSightEvidence.visibleSamples > 0,
      `Pending van cargo was not visibly framed: ${JSON.stringify({
        frame: pendingCargoFrameEvidence,
        lineOfSight: pendingCargoLineOfSightEvidence,
      })}`,
    );
    const pendingCargoCapture = await captureFrozenFrame(
      '03b-ref41-full-open-loaded-open-hold.png',
      'The van holds at its exact fully-open door pose with the authoritative paid carton still visibly loaded, noninteractive, and unavailable before UNLOAD.',
    );
    requireTruth(
      pendingCargoCapture.equipment?.activeArrival?.phase === 'open-hold'
        && pendingCargoCapture.equipment?.beatHistory?.some((entry) => (
          entry.beat === 'cargo-open' && String(entry.orderId) === String(fixtureOrderId)
        ))
        && !pendingCargoCapture.equipment?.beatHistory?.some((entry) => (
          entry.beat === 'unload' && String(entry.orderId) === String(fixtureOrderId)
        )),
      `Full-open loaded dwell did not precede UNLOAD: ${JSON.stringify(pendingCargoCapture.equipment)}`,
    );
    const queuedFixtureCleanup = await cancelAndRemoveQueuedFixture(fixture.queued.box.id);
    requireTruth(
      queuedFixtureCleanup.cancelAccepted
        && queuedFixtureCleanup.result?.status === 'cancelled'
        && queuedFixtureCleanup.boxExistsAfter === false
        && queuedFixtureCleanup.shipmentExistsAfter === false,
      `Queued QA fixture cleanup failed: ${JSON.stringify(queuedFixtureCleanup)}`,
    );

    await waitForBeat('unload');
    await page.waitForFunction((id) => {
      const transfer = window.__fw?.scene3d?.clubhouse?.()
        ?.deliveryBoxPresentationDiagnostics?.()?.transfers
        ?.find((entry) => entry.boxId === id);
      return transfer?.state === 'unloading-transfer'
        && transfer.progress >= 0.12 && transfer.progress <= 0.72;
    }, fixture.box.id, { timeout: 10000 });
    const midTransferEvidence = await cargoPresentationEvidence(fixture.box.id);
    const midTransferFrameEvidence = await objectFrameEvidence(
      midTransferEvidence.root?.name || `DeliveryBox_${fixture.box.id}`,
    );
    const transferApertureExitDistance = distance3(
      midTransferEvidence.transfer?.apertureWorld,
      midTransferEvidence.transfer?.outsideWorld,
    );
    requireTruth(
      midTransferEvidence.activeArrival?.phase === 'unloading'
        && midTransferEvidence.box?.id === pendingCargoEvidence.box?.id
        && String(midTransferEvidence.box?.orderId) === String(pendingCargoEvidence.box?.orderId)
        && midTransferEvidence.box?.qty === pendingCargoEvidence.box?.qty
        && midTransferEvidence.box?.initialQty === pendingCargoEvidence.box?.initialQty
        && midTransferEvidence.root?.parentName === 'DeliveryBoxWorldRoot'
        && midTransferEvidence.root?.presentationState === 'unloading-transfer'
        && midTransferEvidence.transfer?.progress >= 0.12
        && midTransferEvidence.transfer?.progress < 1
        && midTransferEvidence.transfer?.pathMode === 'rear-aperture-piecewise'
        && [
          'cargo-to-aperture',
          'through-aperture',
          'outside-to-pallet',
          'pallet-settle',
        ].includes(midTransferEvidence.transfer?.phase)
        && midTransferEvidence.root?.transferPhase === midTransferEvidence.transfer?.phase
        && midTransferEvidence.transfer?.loadId === pendingCargoEvidence.cargo?.loadId
        && midTransferEvidence.transfer?.loadIndex === 0
        && transferApertureExitDistance != null
        && transferApertureExitDistance >= 0.85
        && transferApertureExitDistance <= 0.91
        && midTransferEvidence.transfer?.reparentError <= 0.001
        && midTransferEvidence.transfer?.palletIndex === 2
        && midTransferEvidence.transfer?.interactionEnabled === false
        && midTransferEvidence.transfer?.colliderEnabled === false
        && midTransferEvidence.root?.interactionEnabled === false
        && midTransferFrameEvidence.inFrame,
      `Mid-transfer identity/continuity contract failed: ${JSON.stringify({
        midTransferEvidence,
        midTransferFrameEvidence,
        transferApertureExitDistance,
      })}`,
    );
    const midTransferCapture = await capture(
      '04a-ref41-mid-unload-transfer.png',
      'The exact paid carton is captured during its authored 1.35 s rear-aperture piecewise transfer, with interaction and individual collision still disabled.',
    );
    await page.waitForFunction((id) => {
      const presentation = window.__fw?.scene3d?.clubhouse?.()
        ?.deliveryBoxPresentationDiagnostics?.();
      const cargo = presentation?.cargo?.find((entry) => entry.boxId === id);
      return presentation?.recentTransfers?.some((entry) => entry.boxId === id)
        && !presentation?.transfers?.some((entry) => entry.boxId === id)
        && cargo?.state === 'pallet-ready'
        && cargo?.interactionEnabled === true;
    }, fixture.box.id, { timeout: 10000 });
    const postTransferEvidence = await cargoPresentationEvidence(fixture.box.id);
    const transferTargetDistance = distance3(
      postTransferEvidence.root?.localPosition,
      postTransferEvidence.recentTransfer?.target,
    );
    const recentTransferApertureExitDistance = distance3(
      postTransferEvidence.recentTransfer?.waypoints?.aperture,
      postTransferEvidence.recentTransfer?.waypoints?.outside,
    );
    requireTruth(
      postTransferEvidence.box?.id === pendingCargoEvidence.box?.id
        && String(postTransferEvidence.box?.orderId) === String(pendingCargoEvidence.box?.orderId)
        && postTransferEvidence.box?.qty === pendingCargoEvidence.box?.qty
        && postTransferEvidence.box?.initialQty === pendingCargoEvidence.box?.initialQty
        && postTransferEvidence.box?.padPalletIndex === 2
        && postTransferEvidence.root?.parentName === 'DeliveryBoxWorldRoot'
        && postTransferEvidence.root?.presentationState === 'pallet-ready'
        && postTransferEvidence.cargo?.state === 'pallet-ready'
        && postTransferEvidence.cargo?.interactionEnabled === true
        && postTransferEvidence.cargo?.colliderEnabled === false
        && postTransferEvidence.recentTransfer?.duration === 1.35
        && postTransferEvidence.recentTransfer?.pathMode === 'rear-aperture-piecewise'
        && postTransferEvidence.recentTransfer?.loadId === pendingCargoEvidence.cargo?.loadId
        && postTransferEvidence.recentTransfer?.loadIndex === 0
        && recentTransferApertureExitDistance >= 0.85
        && recentTransferApertureExitDistance <= 0.91
        && postTransferEvidence.recentTransfer?.palletIndex === 2
        && postTransferEvidence.recentTransfer?.reparentError <= 0.001
        && transferTargetDistance != null
        && transferTargetDistance <= 0.002,
      `Post-transfer pallet landing contract failed: ${JSON.stringify({
        postTransferEvidence,
        transferTargetDistance,
        recentTransferApertureExitDistance,
      })}`,
    );
    const unloadState = await arrivalState(fixture.box.id);
    const collisionDuringUnload = await clearwayAndCollisionEvidence(true);
    requireTruth(
      collisionDuringUnload.vanNodeCenters.COL_VAN_CARGO_FLOOR?.freeAtCenter === false
        && collisionDuringUnload.vanNodeCenters.COL_VAN_CAB?.freeAtCenter === false
        && collisionDuringUnload.vanNodeCenters.COL_VAN_CARGO_LEFT_WALL?.freeAtCenter === false,
      `Open raised-platform/solid-shell collision contract failed: ${JSON.stringify(collisionDuringUnload)}`,
    );
    requireTruth(
      collisionDuringUnload.palletCenters?.[2]?.freeAtCenter === false,
      `Landed carton did not retain pallet-owned collision blocking: ${JSON.stringify(collisionDuringUnload.palletCenters)}`,
    );
    const cargoOpenCapture = await capture(
      '04-ref41-cargo-open-unload.png',
      'Direct rear three-quarter player view exposes the modeled cargo aperture, ribs, threshold, and floor while the exact reserved carton is staged on ref-44 receiving.',
    );
    const cargoOpenVanFrameEvidence = await objectFrameEvidence('delivery_van');
    const cargoApertureEvidence = {
      ribsAndThreshold: {
        frame: await objectFrameEvidence('CARGO_BAY_RIBS_AND_THRESHOLD'),
        lineOfSight: await objectLineOfSightEvidence('CARGO_BAY_RIBS_AND_THRESHOLD'),
      },
      floor: {
        frame: await objectFrameEvidence('CARGO_FLOOR'),
        lineOfSight: await objectLineOfSightEvidence('CARGO_FLOOR'),
      },
    };
    requireTruth(
      cargoOpenVanFrameEvidence.inFrame && cargoOpenVanFrameEvidence.fullyInside,
      `Cargo-open van was not fully framed: ${JSON.stringify(cargoOpenVanFrameEvidence)}`,
    );
    requireTruth(
      Object.values(cargoApertureEvidence).every((entry) => (
        entry.frame.exists
        && entry.frame.inFrame
        && entry.lineOfSight.projectedSamples >= 4
        && entry.lineOfSight.visibleSamples > 0
      )),
      `Modeled cargo aperture was not visibly exposed: ${JSON.stringify(cargoApertureEvidence)}`,
    );

    requireTruth(
      midTransferCapture.toasts?.length === 1
        && /^Unloading 1 carton\.$/i.test(midTransferCapture.toasts[0])
        && cargoOpenCapture.toasts?.length <= 1
        && !cargoOpenCapture.toasts?.some((message) => /staged safely/i.test(message)),
      `Transfer progress/completion toasts overlapped before the progress note cleared: ${JSON.stringify({
        midTransfer: midTransferCapture.toasts,
        landed: cargoOpenCapture.toasts,
      })}`,
    );
    await page.waitForFunction(() => {
      const messages = [...document.querySelectorAll('.toast')]
        .map((entry) => entry.textContent || '');
      return messages.length === 1
        && /1 carton staged safely on the receiving pallets/i.test(messages[0]);
    }, null, { timeout: 5000 });
    const completedTransferToasts = await page.evaluate(() => (
      [...document.querySelectorAll('.toast')].map((entry) => entry.textContent || '')
    ));

    await waitForBeat('doors-closing');
    await waitForBeat('departing');
    await setCamera(evidenceCameras.vanDeparture);
    await page.waitForFunction(() => {
      const active = window.__fw?.scene3d?.clubhouse?.()?.deliveryEquipmentDiagnostics?.()?.activeArrival;
      return active?.phase === 'departing' && active.progress >= 0.35;
    }, null, { timeout: 10000 });
    const departureCapture = await capture(
      '05-ref41-van-departing.png',
      'Wide player view shows obvious ref-41 van displacement down its grounded departure route while retaining the staged carton in the composition.',
    );
    const collisionDuringDeparture = await clearwayAndCollisionEvidence(true);
    const departureVanPose = await equipmentLocalPose('delivery_van');
    const departureDisplacement = +Math.hypot(
      departureVanPose.x - parkedVanPose.x,
      departureVanPose.z - parkedVanPose.z,
    ).toFixed(4);
    const departureVanFrameEvidence = await objectFrameEvidence('delivery_van');
    const departureCartonFrameEvidence = await objectFrameEvidence(`DeliveryBox_${fixture.box.id}`);
    requireTruth(
      departureCapture.equipment?.activeArrival?.phase === 'departing'
        && departureCapture.equipment.activeArrival.progress >= 0.35
        && departureDisplacement >= 2.2,
      `Van departure displacement was not obvious: ${JSON.stringify({
        diagnostics: departureCapture.equipment?.activeArrival,
        parkedVanPose,
        departureVanPose,
        departureDisplacement,
      })}`,
    );
    requireTruth(
      collisionDuringDeparture.vanNodeCenters.COL_VAN_CARGO_FLOOR?.freeAtCenter === false
        && collisionDuringDeparture.vanNodeCenters.COL_VAN_CAB?.freeAtCenter === false
        && collisionDuringDeparture.vanNodeCenters.COL_VAN_CARGO_LEFT_WALL?.freeAtCenter === false,
      `Closed moving departure van collision contract failed: ${JSON.stringify(collisionDuringDeparture)}`,
    );
    requireTruth(
      departureVanFrameEvidence.inFrame
        && departureVanFrameEvidence.fullyInside
        && departureCartonFrameEvidence.inFrame
        && departureCartonFrameEvidence.fullyInside
        && departureCartonFrameEvidence.viewportCoverage >= 0.0001,
      `Departure composition lost the van or staged carton: ${JSON.stringify({
        van: departureVanFrameEvidence,
        carton: departureCartonFrameEvidence,
      })}`,
    );
    await waitForBeat('complete');
    await page.waitForFunction(() => (
      window.__fw?.scene3d?.clubhouse?.()?.deliveryEquipmentDiagnostics?.()?.activeArrival == null
      && window.__deliveryEquipmentQaArrivalResult?.status === 'completed'
    ), null, { timeout: 15000 });
    const arrivalComplete = await arrivalState(fixture.box.id);
    await waitForToastsToClear('arrival-to-hand-truck');

    const handTruckStart = await equipmentInteractionStart(
      'delivery_hand_truck',
      2.35,
      -0.12,
      30,
    );
    const handTruckFocus = await walkToFocus(handTruckStart, /hand truck/i);
    const handTruckBefore = await page.evaluate(() => (
      window.__fw.scene3d.clubhouse().deliveryEquipmentDiagnostics().handTruck
    ));
    await page.keyboard.press('e');
    await page.waitForFunction((cycles) => {
      const state = window.__fw?.scene3d?.clubhouse?.()?.deliveryEquipmentDiagnostics?.()?.handTruck;
      return state?.active && state.cycles === cycles;
    }, handTruckBefore.cycles, { timeout: 5000 });
    await setCamera(evidenceCameras.handTruckAction, 20);
    await page.waitForFunction(() => (
      window.__fw?.scene3d?.clubhouse?.()?.deliveryEquipmentDiagnostics?.()?.handTruck?.phase
        === 'hold'
    ), null, { timeout: 5000 });
    const handTruckHoldEvidence = await page.evaluate(() => (
      window.__fw.scene3d.clubhouse().deliveryEquipmentDiagnostics().handTruck
    ));
    await capture(
      '06-ref42-normal-e-hand-truck.png',
      'Normal W walk focus and E interaction tip the authored hand truck around its axle; an unobstructed 1.8 m side three-quarter observer captures maximum tilt during the hold phase.',
    );
    const handTruckFrameEvidence = await objectFrameEvidence('delivery_hand_truck');
    const handTruckLineOfSightEvidence = await objectLineOfSightEvidence('delivery_hand_truck');
    const handTruckPose = await equipmentLocalPose('delivery_hand_truck');
    const handTruckObserverDistance = +Math.hypot(
      evidenceCameras.handTruckAction.x - handTruckPose.x,
      evidenceCameras.handTruckAction.z - handTruckPose.z,
    ).toFixed(4);
    requireTruth(
      handTruckHoldEvidence.phase === 'hold'
        && handTruckObserverDistance >= 1.75
        && handTruckObserverDistance <= 1.85
        && handTruckLineOfSightEvidence.visibleSamples > 0,
      `Hand-truck hold observer evidence invalid: ${JSON.stringify({
        handTruckHoldEvidence,
        handTruckObserverDistance,
        handTruckLineOfSightEvidence,
      })}`,
    );
    await page.waitForFunction((cycles) => {
      const state = window.__fw?.scene3d?.clubhouse?.()?.deliveryEquipmentDiagnostics?.()?.handTruck;
      return !state?.active && state?.cycles === cycles + 1;
    }, handTruckBefore.cycles, { timeout: 5000 });
    const handTruckAfter = await page.evaluate(() => (
      window.__fw.scene3d.clubhouse().deliveryEquipmentDiagnostics().handTruck
    ));
    await waitForToastsToClear('hand-truck-to-pallet-jack');

    const palletJackStart = await equipmentInteractionStart('delivery_pallet_jack', 2.55, -0.17);
    const palletJackFocus = await walkToFocus(palletJackStart, /pallet jack/i);
    const palletJackBefore = await page.evaluate(() => (
      window.__fw.scene3d.clubhouse().deliveryEquipmentDiagnostics().palletJack
    ));
    const palletJackRestSnapshot = await palletJackLiftSnapshot(2, 0);
    requireTruth(
      palletJackBefore.raised === false
        && palletJackRestSnapshot.targetPalletIndex === 2
        && palletJackRestSnapshot.jackLift.exists
        && palletJackRestSnapshot.target.anchor.exists
        && palletJackRestSnapshot.target.visual.exists
        && palletJackRestSnapshot.target.collider.exists
        && palletJackRestSnapshot.target.cartons.length > 0
        && palletJackRestSnapshot.target.cartons.every((entry) => entry.exists)
        && palletJackRestSnapshot.control.anchor.exists
        && palletJackRestSnapshot.control.batchedVisuals.exists,
      `Ref45 rest coupling evidence incomplete: ${JSON.stringify(palletJackRestSnapshot)}`,
    );
    await page.keyboard.press('e');
    await page.waitForFunction((cycles) => {
      const state = window.__fw?.scene3d?.clubhouse?.()?.deliveryEquipmentDiagnostics?.()?.palletJack;
      return state?.active && state.cycles === cycles;
    }, palletJackBefore.cycles, { timeout: 5000 });
    await setCamera(evidenceCameras.palletJackAction, 20);
    await page.waitForFunction(() => {
      const state = window.__fw?.scene3d?.clubhouse?.()?.deliveryEquipmentDiagnostics?.()?.palletJack;
      return state?.active && state.phase === 'handle-return' && state.liftProgress >= 0.999;
    }, null, { timeout: 5000 });
    const palletJackRaisedSnapshot = await palletJackLiftSnapshot(2, 0);
    const palletJackLiftAudit = comparePalletJackLift(
      palletJackRestSnapshot,
      palletJackRaisedSnapshot,
    );
    const nearExpectedLift = (value) => Number.isFinite(value)
      && Math.abs(value - palletJackLiftAudit.expectedDelta) <= palletJackLiftAudit.epsilon;
    const coupledIds = palletJackRestSnapshot.target.cartons.map((entry) => String(entry.id));
    const diagnosticCoupledIds = palletJackRaisedSnapshot.diagnostics.coupling?.coupledBoxIds
      .map((id) => String(id)) || [];
    requireTruth(
      (palletJackRaisedSnapshot.diagnostics.coupledPalletIndex === 2
        || palletJackRaisedSnapshot.diagnostics.coupling?.coupledPalletIndex === 2)
        && palletJackRaisedSnapshot.diagnostics.channelAligned === true
        && nearExpectedLift(palletJackLiftAudit.jackLiftDelta)
        && nearExpectedLift(palletJackLiftAudit.anchorDelta)
        && nearExpectedLift(palletJackLiftAudit.visualDelta)
        && Object.values(palletJackLiftAudit.collider).every(nearExpectedLift)
        && palletJackLiftAudit.cartons.length > 0
        && palletJackLiftAudit.cartons.every((entry) => (
          entry.existsAtRest && entry.existsRaised && nearExpectedLift(entry.deltaY)
        ))
        && coupledIds.length === diagnosticCoupledIds.length
        && coupledIds.every((id) => diagnosticCoupledIds.includes(id))
        && Number.isFinite(palletJackLiftAudit.control.anchorDelta)
        && Number.isFinite(palletJackLiftAudit.control.batchedVisualsDelta)
        && Math.abs(palletJackLiftAudit.control.anchorDelta) <= 0.001
        && Math.abs(palletJackLiftAudit.control.batchedVisualsDelta) <= 0.001,
      `Ref45 did not visibly lift its complete persisted pallet-2 load by 0.12 m: ${JSON.stringify({
        rest: palletJackRestSnapshot,
        raised: palletJackRaisedSnapshot,
        audit: palletJackLiftAudit,
      })}`,
    );
    await capture(
      '07-ref45-normal-e-pallet-jack.png',
      'Normal W walk focus and E interaction drive the hydraulic stroke; a fixed observer frames the complete jack, visibly raised persisted pallet index 2, and every coupled carton at the 0.12 m terminal lift.',
    );
    const palletJackFrameEvidence = await objectFrameEvidence('delivery_pallet_jack');
    const coupledPalletFrameEvidence = await objectFrameEvidence('DeliveryPalletCoupledVisual');
    const coupledPalletLineOfSightEvidence = await objectLineOfSightEvidence(
      'DeliveryPalletCoupledVisual',
    );
    const coupledCartonFrameEvidence = Object.fromEntries(await Promise.all(
      palletJackRaisedSnapshot.target.cartons.map(async (entry) => [
        String(entry.id),
        await objectFrameEvidence(entry.rootName),
      ]),
    ));
    requireTruth(
      coupledPalletFrameEvidence.inFrame
        && coupledPalletFrameEvidence.fullyInside
        && coupledPalletLineOfSightEvidence.visibleSamples > 0
        && Object.values(coupledCartonFrameEvidence).every((entry) => (
          entry.inFrame && entry.fullyInside
        )),
      `Raised pallet/carton visuals were not visibly framed: ${JSON.stringify({
        pallet: coupledPalletFrameEvidence,
        palletLineOfSight: coupledPalletLineOfSightEvidence,
        cartons: coupledCartonFrameEvidence,
      })}`,
    );
    await page.waitForFunction((cycles) => {
      const state = window.__fw?.scene3d?.clubhouse?.()?.deliveryEquipmentDiagnostics?.()?.palletJack;
      return !state?.active && state?.cycles === cycles + 1;
    }, palletJackBefore.cycles, { timeout: 5000 });
    const palletJackAfter = await page.evaluate(() => (
      window.__fw.scene3d.clubhouse().deliveryEquipmentDiagnostics().palletJack
    ));
    await waitForToastsToClear('pallet-jack-to-carton-pickup');

    const pickupStart = await page.evaluate(async (boxId) => {
      const S = await import('/src/data/deliveryStaging.js');
      const app = window.__fw;
      const boxes = app.state.shop.deliveries.boxes.filter((box) => box.loc === 'pad');
      const plan = S.planPalletizedPadBoxes(boxes).find((entry) => entry.boxId === boxId);
      if (!plan) throw new Error(`No pallet plan for QA box ${boxId}.`);
      // Approach persisted pallet index 2 from the open south-west receiving lane, clear of the
      // staggered pallet footprints while preserving the normal walk-up path.
      const radial = 250 * Math.PI / 180;
      const distance = 2.05;
      return {
        x: plan.x + Math.cos(radial) * distance,
        z: plan.z + Math.sin(radial) * distance,
        yaw: Math.PI / 2 - radial,
        pitch: -0.34,
      };
    }, fixture.box.id);
    const pickupFocus = await walkToFocus(pickupStart, /Delivery:.*\[E\] pick up/i, 14);
    await page.keyboard.press('e');
    await page.waitForFunction((id) => (
      window.__fw.state.shop.deliveries.boxes.find((box) => box.id === id)?.loc === 'carried'
    ), fixture.box.id, { timeout: 7000 });
    const pickupState = await arrivalState(fixture.box.id);
    await capture(
      '08-normal-e-compatible-box-pickup.png',
      'Normal W walk focus and E lift the real 0.60 × 0.40 merchandise carton from receiving.',
    );

    const cartStart = await equipmentInteractionStart(
      'delivery_stocking_cart',
      2.05,
      -0.20,
      0,
    );
    const cartFocus = await walkToFocus(cartStart, /stocking cart|place it on the stocking cart/i, 14);
    await page.keyboard.press('e');
    await page.waitForFunction((id) => {
      const box = window.__fw.state.shop.deliveries.boxes.find((entry) => entry.id === id);
      return box?.loc === 'equipment'
        && box.equipmentId === 'delivery_stocking_cart'
        && box.socketId === 'STOCK_BOX_SOCKET_TOP';
    }, fixture.box.id, { timeout: 7000 });
    const placedState = await arrivalState(fixture.box.id);
    await capture(
      '09-normal-e-box-on-ref43-cart.png',
      'Normal E places the unchanged real carton on the centered ref-43 top-deck socket; the 3/4 view shows the complete cart and working aisle.',
      evidenceCameras.cartPlacement,
    );
    const cartPlacementFrameEvidence = await objectFrameEvidence('delivery_stocking_cart');
    const cartPlacementBoxFrameEvidence = await objectFrameEvidence(`DeliveryBox_${fixture.box.id}`);
    await waitForToastsToClear('cart-placement-to-autosave');

    const saved = await autosaveSnapshot(fixture.box.id);
    await boot({ reload: true });
    const reloaded = await reloadedBoxSnapshot(fixture.box.id);
    await capture(
      '10-autosave-reload-ref43-cart.png',
      'A distinct wider 3/4 view after Continue restores equipmentId, socketId, quantity, and the box-to-socket visual pose without the placement toast.',
      evidenceCameras.cartReload,
    );
    const cartReloadFrameEvidence = await objectFrameEvidence('delivery_stocking_cart');
    const cartReloadBoxFrameEvidence = await objectFrameEvidence(`DeliveryBox_${fixture.box.id}`);

    const collisionAfterReload = await clearwayAndCollisionEvidence(false);
    const metricsAfter = await measureFrames('refs41-45-after-actions-and-reload');
    const perfMetrics = await cdp.send('Performance.getMetrics');
    const browserMetrics = Object.fromEntries(
      perfMetrics.metrics.map((entry) => [entry.name, entry.value]),
    );
    const finalAudit = await equipmentAssetAudit();
    const finalDiagnostics = finalAudit.diagnostics;
    const arrivalBeats = (arrivalComplete.diagnostics.beatHistory || [])
      .filter((entry) => String(entry.orderId) === String(fixtureOrderId))
      .map((entry) => entry.beat);
    const expectedBeats = [
      'queued', 'approach', 'parked', 'doors-opening', 'cargo-open',
      'unload', 'doors-closing', 'departing', 'complete',
    ];
    const clearwayOpen = collisionAfterReload.clearwaySamples.every((entry) => entry.free);
    const staticCollisionEvidence = [
      'delivery_hand_truck', 'delivery_stocking_cart', 'delivery_pallet_jack',
    ].every((id) => collisionAfterReload.equipmentCenters[id]?.freeAtCenter === false);
    const palletCollisionEvidence = collisionAfterReload.palletCenters.every(
      (entry) => entry.freeAtCenter === false,
    );
    const vanNodeBlocked = (evidence, name) => (
      evidence.vanNodeCenters[name]?.exists === true
      && evidence.vanNodeCenters[name].freeAtCenter === false
    );
    const vanCollisionEvidence = {
      approachClosedCargoBlocked: vanNodeBlocked(
        collisionDuringApproach,
        'COL_VAN_CARGO_FLOOR',
      ),
      openRaisedCargoPlatformBlocked: collisionDuringUnload
        .vanNodeCenters.COL_VAN_CARGO_FLOOR?.exists === true
        && collisionDuringUnload.vanNodeCenters.COL_VAN_CARGO_FLOOR.freeAtCenter === false,
      departureClosedCargoBlocked: vanNodeBlocked(
        collisionDuringDeparture,
        'COL_VAN_CARGO_FLOOR',
      ),
      cabAndLeftWallBlockedAllPhases: [
        collisionDuringApproach,
        collisionDuringUnload,
        collisionDuringDeparture,
      ].every((evidence) => (
        vanNodeBlocked(evidence, 'COL_VAN_CAB')
        && vanNodeBlocked(evidence, 'COL_VAN_CARGO_LEFT_WALL')
      )),
    };
    const equipmentMetadataValid = assetAudit.assets.length === 4
      && assetAudit.assets.every((asset) => (
        asset.exists
        && asset.assetId === asset.id
        && asset.metadataReference === asset.reference
        && asset.missingNodes.length === 0
        && asset.visibleMeshes > 0
        && asset.visibleHelpers === 0
      ));
    const rendererMetricsCaptured = [metricsBefore, metricsAfter].every((sample) => (
      sample.frames > 0
      && Number.isFinite(sample.averageFps)
      && sample.resources.visibleMeshes > 0
      && Number.isFinite(sample.resources.rendererGeometries)
      && Number.isFinite(sample.resources.lastFrameCalls)
    ));
    const captureEnding = (suffix) => captures.find((entry) => entry.file.endsWith(suffix));
    const handTruckCapture = captureEnding('06-ref42-normal-e-hand-truck.png');
    const palletJackCapture = captureEnding('07-ref45-normal-e-pallet-jack.png');
    const pickupCapture = captureEnding('08-normal-e-compatible-box-pickup.png');
    const cartPlacementCapture = captureEnding('09-normal-e-box-on-ref43-cart.png');
    const cartReloadCapture = captureEnding('10-autosave-reload-ref43-cart.png');
    const visibleConditionCaptures = captures.filter((entry) => entry.condition?.visible);
    const cartCameraDifference = Math.hypot(
      evidenceCameras.cartPlacement.x - evidenceCameras.cartReload.x,
      evidenceCameras.cartPlacement.z - evidenceCameras.cartReload.z,
    );
    const assertions = {
      deterministicCleanPresentationFixture: presentationFixture.clutter.count === 8
        && presentationFixture.clutter.allCleared
        && presentationFixture.floorGrime.allZeroAfter
        && presentationFixture.windows.allZeroAfter
        && presentationFixture.conditionAfter >= 70
        && presentationFixture.decorChanged === false
        && presentationFixture.exteriorChanged === false,
      viewport1600x900Dpr1: viewport.width === 1600 && viewport.height === 900 && viewport.dpr === 1,
      playwrightVideoRecordingEnabled: videoRecordingEnabled,
      refs41_42_43_45ReadyAndAuthored: assetAudit.ready
        && assetAudit.metrics?.assets === 4
        && assetAudit.diagnostics?.missingAssets?.length === 0
        && equipmentMetadataValid,
      ref44FivePalletStageReady: assetAudit.pallet.stageExists
        && assetAudit.pallet.ready
        && assetAudit.pallet.authoredPalletCount === 5
        && assetAudit.pallet.anchors.every(Boolean)
        && assetAudit.pallet.batchedVisuals,
      logicalTopCartSocketAvailable: assetAudit.logicalTopSocket.exists,
      serviceBayNamedFramedAndGroundsParkedVan: [
        'DeliveryVanServiceBay',
        'DeliveryVanServiceBayMarkings',
        'DeliveryApronVanBayTransferStrip',
      ].every((name) => assetAudit.environment?.[name]?.exists)
        && Object.values(serviceBayFrameEvidence).every((entry) => entry.exists && entry.inFrame)
        && parkedServiceBayGrounding.vanToSurfaceDelta <= 0.002,
      fourAuthoredVanWheelsContactTheServiceSlab: parkedServiceBayGrounding
        .wheelContacts.length === 4
        && parkedServiceBayGrounding.wheelContacts.every((entry) => (
          entry.exists
          && entry.insideServiceBay
          && entry.visualContactDeltaToSurface <= 0.035
        ))
        && parkedServiceBayGrounding.wheelContactSpread <= 0.02,
      serviceDriveHasFourVisibleTerrainConformingTracks: [
        'DeliveryVanServiceDrive',
        'DeliveryVanApproachTrackLeft',
        'DeliveryVanApproachTrackRight',
        'DeliveryVanDepartureTrackLeft',
        'DeliveryVanDepartureTrackRight',
      ].every((name) => assetAudit.environment?.[name]?.exists)
        && serviceDriveGeometryEvidence.drive.childCount === 4
        && serviceDriveGeometryEvidence.tracks.every((entry) => (
          entry.vertexCount === 50 && entry.triangleCount === 48 && entry.touchesServiceBay
        ))
        && Object.values(serviceDriveFrameEvidence).every((entry) => entry.inFrame),
      operationsBoardAndSafetyPlacardAreFramedReadableAndUnoccluded: [
        'BackroomOperationsBoard',
        'HandTruckSafetyPlacard',
      ].every((name) => assetAudit.environment?.[name]?.exists)
        && Object.values(signageEvidence).every((entry) => (
          entry.frame.inFrame && entry.frame.fullyInside
          && entry.frame.viewportCoverage >= 0.002
          && entry.lineOfSight.projectedSamples >= 4
          && entry.lineOfSight.visibleSamples >= 2
          && entry.lineOfSight.visibleRatio >= 0.5
        )),
      fullyOpenLoadedVanDwellsBeforeUnload:
        pendingCargoEvidence.activeArrival?.phase === 'open-hold'
        && pendingCargoEvidence.unloadBeatSeen === false
        && pendingCargoCapture.equipment?.activeArrival?.phase === 'open-hold'
        && pendingCargoCapture.renderFrozenForEvidence === true
        && !pendingCargoCapture.equipment?.beatHistory?.some((entry) => (
          entry.beat === 'unload' && String(entry.orderId) === String(fixtureOrderId)
        )),
      exactActiveCartonMountedVisibleAndUnavailableBeforeUnload:
        pendingCargoEvidence.unloadBeatSeen === false
        && pendingCargoEvidence.diagnostics.cargoPlanner === 'dimension-aware-ref41-volume-v1'
        && pendingCargoEvidence.diagnostics.cargoLoadCount === 1
        && pendingCargoEvidence.root?.presentationState === 'van-cargo-pending'
        && pendingCargoEvidence.root?.effectiveVisible === true
        && pendingCargoEvidence.root?.cargoAnchorError <= 0.000001
        && pendingCargoEvidence.root?.cargoLoadId === pendingCargoEvidence.cargo?.loadId
        && pendingCargoEvidence.cargo?.clearanceSafe === true
        && pendingCargoEvidence.cargo?.support?.valid === true
        && pendingCargoEvidence.cargo?.interactionEnabled === false
        && pendingCargoEvidence.cargo?.colliderEnabled === false,
      queuedOrderCartonAbsentBeforeUnload: pendingCargoEvidence.queued.length === 1
        && pendingCargoEvidence.queued.every((entry) => (
          !entry.rootExists && entry.pending?.viewMounted === false && !entry.cargoPlanned
        )),
      transfer135sUsesRearApertureAndPreservesIdentityQty:
        midTransferEvidence.transfer?.reparentError <= 0.001
        && midTransferEvidence.transfer?.interactionEnabled === false
        && midTransferEvidence.transfer?.colliderEnabled === false
        && midTransferEvidence.transfer?.pathMode === 'rear-aperture-piecewise'
        && transferApertureExitDistance >= 0.85
        && transferApertureExitDistance <= 0.91
        && postTransferEvidence.recentTransfer?.duration === 1.35
        && postTransferEvidence.recentTransfer?.pathMode === 'rear-aperture-piecewise'
        && postTransferEvidence.box?.id === pendingCargoEvidence.box?.id
        && postTransferEvidence.box?.qty === pendingCargoEvidence.box?.qty,
      transferLandsAtPersistedPalletTargetWithOwnedCollision:
        postTransferEvidence.box?.padPalletIndex === 2
        && transferTargetDistance <= 0.002
        && postTransferEvidence.cargo?.interactionEnabled === true
        && postTransferEvidence.cargo?.colliderEnabled === false
        && collisionDuringUnload.palletCenters?.[2]?.freeAtCenter === false,
      deliveryProgressAndCompletionToastsDoNotOverlap:
        midTransferCapture.toasts?.length === 1
        && /^Unloading 1 carton\.$/i.test(midTransferCapture.toasts[0])
        && cargoOpenCapture.toasts?.length <= 1
        && !cargoOpenCapture.toasts?.some((message) => /staged safely/i.test(message))
        && completedTransferToasts.length === 1
        && /1 carton staged safely on the receiving pallets/i.test(completedTransferToasts[0]),
      realArrivalPresentationCompleted: JSON.stringify(arrivalBeats) === JSON.stringify(expectedBeats)
        && arrivalComplete.arrivalResult?.status === 'completed',
      approachingVanVisiblyFramed: approachFrameEvidence.inFrame
        && approachFrameEvidence.fullyInside
        && approachFrameEvidence.viewportCoverage >= 0.015
        && approachCapture.equipment?.activeArrival?.phase === 'approach'
        && approachCapture.equipment.activeArrival.progress >= 0.53
        && approachCapture.equipment.activeArrival.progress <= 0.64,
      parkedOpeningVanFullyFramed: parkedFrameEvidence.inFrame
        && parkedFrameEvidence.fullyInside
        && parkedFrameEvidence.viewportCoverage >= 0.015
        && parkedOpeningCapture.equipment?.activeArrival?.phase === 'opening',
      cargoApertureAndInteriorVisiblyExposed: cargoOpenVanFrameEvidence.inFrame
        && cargoOpenVanFrameEvidence.fullyInside
        && cargoOpenCapture.equipment?.activeArrival?.phase === 'unloading'
        && Object.values(cargoApertureEvidence).every((entry) => (
          entry.frame.exists
          && entry.frame.inFrame
          && entry.lineOfSight.projectedSamples >= 4
          && entry.lineOfSight.visibleSamples > 0
        )),
      departureDisplacementAndStagedCartonVisible: departureCapture.equipment?.activeArrival?.phase
          === 'departing'
        && departureCapture.equipment.activeArrival.progress >= 0.35
        && departureDisplacement >= 2.2
        && departureVanFrameEvidence.inFrame
        && departureVanFrameEvidence.fullyInside
        && departureCartonFrameEvidence.inFrame
        && departureCartonFrameEvidence.fullyInside
        && departureCartonFrameEvidence.viewportCoverage >= 0.0001,
      reservedCartonHiddenUntilUnload: hiddenDuringApproach,
      exactCartonRevealedAtUnload: unloadState.boxVisible
        && unloadState.box?.id === fixture.box.id
        && unloadState.box?.qty === fixtureQty
        && unloadState.box?.padPalletIndex === 2,
      normalWalkFocusEHandTruck: /hand truck/i.test(handTruckFocus.label || '')
        && handTruckFocus.steps > 0
        && handTruckFocus.walkDelta > 0.05
        && handTruckAfter.cycles === handTruckBefore.cycles + 1
        && handTruckAfter.active === false,
      completeHandTruckFramedForAction: handTruckFrameEvidence.inFrame
        && handTruckFrameEvidence.fullyInside
        && handTruckFrameEvidence.viewportCoverage >= 0.004
        && handTruckHoldEvidence.phase === 'hold'
        && handTruckObserverDistance >= 1.75
        && handTruckObserverDistance <= 1.85
        && handTruckLineOfSightEvidence.visibleSamples > 0,
      normalWalkFocusEPalletJack: /pallet jack/i.test(palletJackFocus.label || '')
        && palletJackFocus.steps > 0
        && palletJackFocus.walkDelta > 0.05
        && palletJackAfter.cycles === palletJackBefore.cycles + 1
        && palletJackAfter.active === false
        && palletJackAfter.raised === true
        && palletJackAfter.liftProgress === 1,
      completePalletJackFramedForAction: palletJackFrameEvidence.inFrame
        && palletJackFrameEvidence.fullyInside
        && palletJackFrameEvidence.viewportCoverage >= 0.004
        && coupledPalletFrameEvidence.inFrame
        && coupledPalletFrameEvidence.fullyInside
        && coupledPalletLineOfSightEvidence.visibleSamples > 0
        && Object.values(coupledCartonFrameEvidence).every((entry) => (
          entry.inFrame && entry.fullyInside
        )),
      persistedPallet2CompleteLoadVisiblyLifts012m: fixture.box.padPalletIndex === 2
        && (palletJackRaisedSnapshot.diagnostics.coupledPalletIndex === 2
          || palletJackRaisedSnapshot.diagnostics.coupling?.coupledPalletIndex === 2)
        && palletJackRaisedSnapshot.diagnostics.channelAligned === true
        && nearExpectedLift(palletJackLiftAudit.jackLiftDelta)
        && nearExpectedLift(palletJackLiftAudit.anchorDelta)
        && nearExpectedLift(palletJackLiftAudit.visualDelta)
        && Object.values(palletJackLiftAudit.collider).every(nearExpectedLift)
        && palletJackLiftAudit.cartons.length > 0
        && palletJackLiftAudit.cartons.every((entry) => (
          entry.existsAtRest && entry.existsRaised && nearExpectedLift(entry.deltaY)
        ))
        && coupledIds.length === diagnosticCoupledIds.length
        && coupledIds.every((id) => diagnosticCoupledIds.includes(id))
        && Number.isFinite(palletJackLiftAudit.control.anchorDelta)
        && Number.isFinite(palletJackLiftAudit.control.batchedVisualsDelta)
        && Math.abs(palletJackLiftAudit.control.anchorDelta) <= 0.001
        && Math.abs(palletJackLiftAudit.control.batchedVisualsDelta) <= 0.001,
      normalWalkFocusEBoxPickup: /Delivery:.*\[E\] pick up/i.test(pickupFocus.label || '')
        && pickupFocus.steps > 0
        && pickupFocus.walkDelta > 0.05
        && pickupState.box?.loc === 'carried'
        && pickupState.box?.qty === fixtureQty,
      normalWalkFocusEStockingCartPlacement: /stocking cart/i.test(cartFocus.label || '')
        && cartFocus.steps > 0
        && cartFocus.walkDelta > 0.05
        && placedState.box?.loc === 'equipment'
        && placedState.box?.equipmentId === 'delivery_stocking_cart'
        && placedState.box?.socketId === 'STOCK_BOX_SOCKET_TOP'
        && placedState.box?.qty === fixtureQty,
      completeCartFramedInDistinctPlacementAndReloadViews: cartPlacementFrameEvidence.inFrame
        && cartPlacementFrameEvidence.fullyInside
        && cartPlacementBoxFrameEvidence.inFrame
        && cartPlacementBoxFrameEvidence.fullyInside
        && cartReloadFrameEvidence.inFrame
        && cartReloadFrameEvidence.fullyInside
        && cartReloadBoxFrameEvidence.inFrame
        && cartReloadBoxFrameEvidence.fullyInside
        && cartCameraDifference >= 1,
      equipmentCapturesContainNoStaleToasts: toastClearances.length === 4
        && handTruckCapture?.toasts?.length === 0
        && palletJackCapture?.toasts?.length === 0
        && pickupCapture?.toasts?.length === 0
        && cartPlacementCapture?.toasts?.length === 1
        && /placed securely on the stocking cart/i.test(cartPlacementCapture.toasts[0])
        && cartReloadCapture?.toasts?.length === 0,
      cleanConditionComesFromRecordedGameState: visibleConditionCaptures.length > 0
        && visibleConditionCaptures.every((entry) => (
          /Shop condition 70 .* clean/i.test(entry.condition.text)
          && !/filthy|grimy/i.test(entry.condition.text)
        )),
      autosavePersistsEquipmentOwnershipAndQty: saved.box.loc === 'equipment'
        && saved.box.equipmentId === 'delivery_stocking_cart'
        && saved.box.socketId === 'STOCK_BOX_SOCKET_TOP'
        && saved.box.qty === fixtureQty,
      reloadPreservesEquipmentOwnershipAndQty: JSON.stringify(reloaded.box) === JSON.stringify(saved.box)
        && reloaded.visual.socketDistance != null
        && reloaded.visual.socketDistance <= 0.002,
      backDoorClearwayOpen: clearwayOpen,
      authoredStaticEquipmentCollides: staticCollisionEvidence,
      allFivePalletsCollide: palletCollisionEvidence,
      approachClosedCargoHullBlocksAuthoredFloorCenter:
        vanCollisionEvidence.approachClosedCargoBlocked,
      cargoOpenRaisedPlatformRemainsNonWalkableWithoutRamp:
        vanCollisionEvidence.openRaisedCargoPlatformBlocked,
      departureClosedCargoHullBlocksAuthoredFloorCenter:
        vanCollisionEvidence.departureClosedCargoBlocked,
      vanCabAndLeftWallRemainSolidAcrossAllThreePhases:
        vanCollisionEvidence.cabAndLeftWallBlockedAllPhases,
      rendererAndEquipmentMetricsCaptured: rendererMetricsCaptured
        && finalAudit.metrics?.assets === 4
        && finalDiagnostics?.callbackErrors?.length === 0,
      pointerLockHeldForAllEvidence: captures.every((entry) => entry.pointerLocked),
      noConsoleOrPageErrors: diagnosticCounts.consoleError === 0 && diagnosticCounts.pageError === 0,
      noFailedRequests: diagnosticCounts.requestFailed === 0,
    };
    const ok = Object.values(assertions).every(Boolean);
    report = {
      ok,
      references: [41, 42, 43, 44, 45],
      outputDirectory: out,
      launch: `$env:DELIVERY_EQUIPMENT_ITERATION='${iteration}'; $env:VIDEO_DIR='${videoDirectory}'; node tools/qa/run-playwright.cjs tools/qa/delivery-equipment-qa.js --bootstrap`,
      iteration,
      fixtureBoundary: 'Production arriveOrder plus clubhouse presentDeliveryArrival establish one deterministic active delivery and one queued isolation fixture. The queued fixture is cancelled and removed immediately after its absence is proved. Fixed player starts plus the recorded clutter/grime/window presentation fixture establish repeatability. Only the two sub-second door/open-hold screenshot readbacks briefly freeze scene rendering so capture latency cannot consume the asserted production phase; state, callbacks, pointer lock, and controls are unchanged. Hand truck, pallet jack, box pickup, cart placement, autosave, reload, and Continue use the normal player/game paths.',
      presentationFixture,
      viewport,
      video: {
        requested: videoRecordingEnabled,
        directory: videoDirectory,
        note: 'Playwright finalizes the .webm when the runner closes this browser context.',
      },
      cameras: { ...cameras, ...(evidenceCameras || {}) },
      frozenEvidenceCaptures,
      fixture,
      assetAudit,
      finalAudit,
      authoredEnvironment: {
        signageCapture: signageCapture.file,
        signageEvidence,
        serviceBayCapture: serviceBayCapture.file,
        serviceBayFrameEvidence,
        serviceDriveCapture: serviceDriveCapture.file,
        serviceDriveFrameEvidence,
        serviceDriveGeometryEvidence,
        parkedServiceBayGrounding,
      },
      arrival: {
        expectedBeats,
        observedBeats: arrivalBeats,
        phases,
        approachCapture: {
          camera: approachCapture.camera,
          diagnostics: approachCapture.equipment?.activeArrival || null,
        },
        approachFrameEvidence,
        approachCargoEvidence,
        parkedOpening: {
          camera: parkedOpeningCapture.camera,
          diagnostics: parkedOpeningCapture.equipment?.activeArrival || null,
          pose: parkedVanPose,
          frameEvidence: parkedFrameEvidence,
        },
        pendingCargo: {
          capture: pendingCargoCapture?.file || null,
          evidence: pendingCargoEvidence,
          frameEvidence: pendingCargoFrameEvidence,
          lineOfSightEvidence: pendingCargoLineOfSightEvidence,
          queuedFixtureCleanup,
        },
        transfer: {
          capture: midTransferCapture.file,
          mid: midTransferEvidence,
          midFrameEvidence: midTransferFrameEvidence,
          apertureExitDistance: transferApertureExitDistance,
          landed: postTransferEvidence,
          landedApertureExitDistance: recentTransferApertureExitDistance,
          persistedTargetDistance: transferTargetDistance,
          collisionOwnership: 'The individual pad carton intentionally has no duplicate collider; the authored pallet/stage owns the shared collision footprint and remains blocking at the carton pallet centre.',
        },
        cargoOpen: {
          camera: cargoOpenCapture.camera,
          diagnostics: cargoOpenCapture.equipment?.activeArrival || null,
          vanFrameEvidence: cargoOpenVanFrameEvidence,
          apertureEvidence: cargoApertureEvidence,
        },
        departure: {
          camera: departureCapture.camera,
          diagnostics: departureCapture.equipment?.activeArrival || null,
          pose: departureVanPose,
          displacementFromParked: departureDisplacement,
          vanFrameEvidence: departureVanFrameEvidence,
          cartonFrameEvidence: departureCartonFrameEvidence,
        },
        hiddenDuringApproach,
        unloadState,
        complete: arrivalComplete,
      },
      normalControls: {
        handTruck: {
          focus: handTruckFocus,
          before: handTruckBefore,
          hold: handTruckHoldEvidence,
          after: handTruckAfter,
          frameEvidence: handTruckFrameEvidence,
          lineOfSightEvidence: handTruckLineOfSightEvidence,
          observerDistance: handTruckObserverDistance,
        },
        palletJack: {
          focus: palletJackFocus,
          before: palletJackBefore,
          restSnapshot: palletJackRestSnapshot,
          raisedSnapshot: palletJackRaisedSnapshot,
          liftAudit: palletJackLiftAudit,
          after: palletJackAfter,
          frameEvidence: palletJackFrameEvidence,
          coupledPalletFrameEvidence,
          coupledPalletLineOfSightEvidence,
          coupledCartonFrameEvidence,
        },
        pickup: { focus: pickupFocus, state: pickupState },
        stockingCart: {
          focus: cartFocus,
          state: placedState,
          placementFrameEvidence: cartPlacementFrameEvidence,
          placementBoxFrameEvidence: cartPlacementBoxFrameEvidence,
          reloadFrameEvidence: cartReloadFrameEvidence,
          reloadBoxFrameEvidence: cartReloadBoxFrameEvidence,
        },
      },
      saveReload: { saved, reloaded, distinctCameraDistance: cartCameraDifference },
      toastClearances,
      clearwayAndCollision: {
        vanPhaseContract: vanCollisionEvidence,
        duringApproach: collisionDuringApproach,
        duringUnload: collisionDuringUnload,
        duringDeparture: collisionDuringDeparture,
        afterReload: collisionAfterReload,
      },
      performance: {
        methodology: 'Matched fixed 1600×900 player viewport, 1.8 s rAF samples, scene/renderer census, and browser Performance-domain counters before interaction and after autosave reload.',
        before: metricsBefore,
        after: metricsAfter,
        browser: {
          JSHeapUsedSize: browserMetrics.JSHeapUsedSize ?? null,
          Nodes: browserMetrics.Nodes ?? null,
          Documents: browserMetrics.Documents ?? null,
          JSEventListeners: browserMetrics.JSEventListeners ?? null,
        },
      },
      captures,
      assertions,
      diagnostics: { counts: diagnosticCounts, entries: diagnostics },
    };
    fs.writeFileSync(path.join(out, 'result.json'), `${JSON.stringify(report, null, 2)}\n`);
    writeRunState(ok ? 'passed' : 'failed', { result: path.join(out, 'result.json'), assertions });
    return report;
  } catch (error) {
    report = {
      ok: false,
      references: [41, 42, 43, 44, 45],
      outputDirectory: out,
      launch: `$env:DELIVERY_EQUIPMENT_ITERATION='${iteration}'; $env:VIDEO_DIR='${videoDirectory}'; node tools/qa/run-playwright.cjs tools/qa/delivery-equipment-qa.js --bootstrap`,
      iteration,
      video: { requested: !!page.video(), directory: videoDirectory },
      cameras: { ...cameras, ...(evidenceCameras || {}) },
      captures,
      frozenEvidenceCaptures,
      phases,
      toastClearances,
      diagnostics: { counts: diagnosticCounts, entries: diagnostics },
      blocker: {
        name: error?.name || 'Error',
        message: error?.message || String(error),
        stack: error?.stack || null,
      },
    };
    fs.writeFileSync(path.join(out, 'result.json'), `${JSON.stringify(report, null, 2)}\n`);
    writeRunState('failed', { result: path.join(out, 'result.json'), blocker: report.blocker });
    return report;
  }
}
