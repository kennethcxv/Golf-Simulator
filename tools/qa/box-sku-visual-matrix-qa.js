async (page) => {
  // Final exact-SKU presentation matrix. Interaction quality is proven by the
  // normal-control lifecycle drivers; this fixture isolates each required box
  // family at deterministic category-framing player-camera poses and reaches OPEN exclusively
  // through the shipped arrival/pickup/placement/cut/flap simulation verbs.

  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = 'C:/Users/Kenneth/Documents/GitHub/Golf-Flipper';
  const out = path.join(repo, 'qa', 'box_system_master', 'contents', 'final-sku-matrix');
  fs.mkdirSync(out, { recursive: true });

  const diagnostics = [];
  const counts = { consoleError: 0, pageError: 0, requestFailed: 0, consoleWarning: 0 };
  const note = (kind, value) => {
    counts[kind] += 1;
    if (diagnostics.length < 100) diagnostics.push({ kind, text: String(value) });
  };
  page.on('console', (message) => {
    if (message.type() === 'error') note('consoleError', message.text());
    if (message.type() === 'warning') note('consoleWarning', message.text());
  });
  page.on('pageerror', (error) => note('pageError', error.message));
  page.on('requestfailed', (request) => {
    if (!/ERR_ABORTED/i.test(request.failure()?.errorText || '')) {
      note('requestFailed', `${request.url()} (${request.failure()?.errorText || 'unknown'})`);
    }
  });
  page.on('response', (response) => {
    if (response.status() >= 400) note('requestFailed', `${response.url()} (HTTP ${response.status()})`);
  });

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('http://localhost:8457/');
  await page.getByText('Continue', { exact: true }).click().catch(() => {});
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 40000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || getComputedStyle(veil).opacity === '0';
  }, null, { timeout: 40000 });
  await page.waitForFunction(() => window.__fw.scene3d.clubhouse().assetsReady?.() === true, null, {
    timeout: 60000,
  });
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
  await page.evaluate(() => {
    const app = window.__fw;
    app.speedIdx = 0;
    app.scene3d.walk.clearKeys?.();
    const day = Math.floor(app.state.clock.minutes / 1440) * 1440;
    app.state.clock.minutes = day + 14 * 60;
    if (app.state.weather) app.state.weather.locked = true;
    app.scene3d.applyTimeWeather?.(14 * 60, app.state.weather);
  });

  const origin = await page.evaluate(() => {
    const value = window.__fw.scene3d.clubhouse().interior.position;
    return { x: value.x, z: value.z };
  });
  const camera = Object.freeze({ x: 8.25, z: -0.43, yaw: 0, pitch: -0.72 });
  async function setCamera(pose = camera) {
    await page.evaluate(({ pose: target, origin: offset }) => {
      const walk = window.__fw.scene3d.walk.state;
      walk.x = offset.x + target.x;
      walk.z = offset.z + target.z;
      walk.yaw = target.yaw;
      walk.pitch = target.pitch;
    }, { pose, origin });
    await page.waitForTimeout(500);
  }

  const specs = Object.freeze([
    { shot: '23-apparel-box.png', skuId: 'polo1', label: 'Apparel box' },
    { shot: '24-golf-ball-box.png', skuId: 'balls1', label: 'Golf-ball box' },
    { shot: '25-tee-box.png', skuId: 'tees1', label: 'Tee box' },
    { shot: '26-shoe-box.png', skuId: 'shoe1', label: 'Shoe box' },
    { shot: '27-club-box.png', skuId: 'driver1', label: 'Club box' },
    { shot: '28-golf-bag-box.png', skuId: 'bag1', label: 'Golf-bag box' },
    { shot: '29-drink-carton.png', skuId: 'water1', label: 'Drink carton' },
  ]);
  const captures = [];

  async function stageOpenBox(spec, index) {
    const fixture = await page.evaluate(async ({ spec: requested, orderId, spot }) => {
      const D = await import('/src/sim/deliveries.js');
      const { SHOP_CATALOG } = await import('/src/data/shopItems.js');
      const { planShipment } = await import('/src/data/boxes.js');
      const { productPackagingFor } = await import('/src/data/productPackaging.js');
      const { previewBoxPlacement } = await import('/src/sim/boxPlacement.js');
      const { FLOOR_BOX_SURFACE_ID } = await import('/src/data/boxPlacementSurfaces.js');
      const state = window.__fw.state;
      D.ensureDeliveries(state);
      const delivery = state.shop.deliveries;
      delivery.boxes = [];
      delivery.shipments = [];
      delivery.arrivedOrderIds = [];
      // Production box IDs are monotonic. Give each isolated matrix specimen a
      // unique ID as well, otherwise rebuildBoxes correctly reuses the cached
      // view for ID 1 and the next SKU appears to retain the previous layout.
      delivery.nextBoxId = orderId;
      delivery.trash = 0;
      delivery.recycled = 0;
      state.shop.carry = null;
      if (state.shop.reno) {
        state.shop.reno.grime.fill(0);
        state.shop.reno.clutter = [];
      }
      if (state.notifications) {
        state.notifications.items = [];
        state.notifications.nextId = 1;
      }
      const sku = SHOP_CATALOG.find((entry) => entry.id === requested.skuId);
      if (!sku) throw new Error(`Missing catalog SKU ${requested.skuId}`);
      const contract = productPackagingFor(sku.id);
      const manifest = planShipment(sku, contract.unitsPerBox);
      const made = D.arriveOrder(state, {
        id: orderId,
        skuId: sku.id,
        qty: contract.unitsPerBox,
        manifest,
      });
      if (made.length !== 1) throw new Error(`${sku.id} fixture made ${made.length} cartons`);
      const box = made[0];
      const pickup = D.pickUpBox(state, box.id);
      if (!pickup.ok) throw new Error(`${sku.id} pickup failed: ${pickup.reason}`);
      const floorTarget = (x, z, ry) => ({
        loc: 'world', surfaceId: FLOOR_BOX_SURFACE_ID, x, z, ry,
      });
      const candidates = [floorTarget(spot.x, spot.z, spot.ry || 0)];
      const nearby = [];
      for (let x = -8; x <= 9; x += 0.5) {
        for (let z = -3.5; z <= 3.5; z += 0.5) {
          nearby.push({ x, z, distance: Math.hypot(x - spot.x, z - spot.z) });
        }
      }
      nearby.sort((a, b) => a.distance - b.distance || a.x - b.x || a.z - b.z);
      // Prefer a legal unrotated presentation so the product-family label and
      // long-carton silhouette face the same evidence camera. Only use a
      // quarter-turn if no legal unrotated floor pose exists in the clubhouse.
      for (const candidate of nearby) candidates.push(floorTarget(candidate.x, candidate.z, 0));
      for (const candidate of nearby) candidates.push(floorTarget(candidate.x, candidate.z, Math.PI / 2));
      const legal = candidates
        .map((candidate) => previewBoxPlacement(state, box, candidate))
        .find((preview) => preview.ok);
      if (!legal) throw new Error(`${sku.id} has no legal evidence placement`);
      const placement = D.putDownBox(state, box.id, legal.target);
      if (!placement.ok) throw new Error(`${sku.id} placement failed: ${placement.reason}`);
      const cut = D.cutTape(state, box.id, 1);
      if (!cut.ok || !cut.done) throw new Error(`${sku.id} cut failed`);
      for (let phase = 0; phase < 3; phase += 1) {
        const flap = D.openFlap(state, box.id, 1);
        if (!flap.ok) throw new Error(`${sku.id} flap ${phase} failed: ${flap.reason}`);
      }
      window.__fw.scene3d.clubhouse().rebuildReno?.();
      window.__fw.scene3d.clubhouse().refreshCondition?.();
      window.__fw.scene3d.clubhouse().rebuildBoxes();
      return {
        id: box.id,
        skuId: sku.id,
        quantity: box.qty,
        boxKind: box.box,
        modelId: box.modelId,
        layoutId: box.layoutId,
        lifecycle: D.boxLifecycleState(box),
        capacity: contract.unitsPerBox,
        placement: { ...placement.placement.target },
      };
    }, {
      spec,
      orderId: 981000 + index,
      spot: { x: 8.25, z: -1.7, ry: 0 },
    });

    try {
      await page.waitForFunction(({ id, expected }) => {
        const root = window.__fw.scene3d.scene.getObjectByName(`DeliveryBox_${id}`);
        if (!root || root.userData.deliveryLayoutId !== expected.layoutId) return false;
        const products = [];
        const batches = [];
        root.traverse((object) => {
          if (/^BOX_CONTENT_\d+_/i.test(object.name || '')) products.push(object);
          if (object.isInstancedMesh && object.userData.deliveryContentInstances) batches.push(object);
        });
        return products.length === expected.capacity
          && products.every((product) => product.visible)
          && batches.length > 0
          && batches.every((batch) => batch.count === expected.capacity);
      }, { id: fixture.id, expected: fixture }, { timeout: 30000 });
    } catch (error) {
      const census = await page.evaluate(({ id }) => {
        const root = window.__fw.scene3d.scene.getObjectByName(`DeliveryBox_${id}`);
        if (!root) return { root: null };
        const products = [];
        const batches = [];
        const namedNodes = [];
        root.traverse((object) => {
          if (object.name) namedNodes.push(object.name);
          if (/^BOX_CONTENT_\d+_/i.test(object.name || '')) {
            products.push({ name: object.name, visible: object.visible });
          }
          if (object.isInstancedMesh && object.userData.deliveryContentInstances) {
            batches.push({ name: object.name, count: object.count });
          }
        });
        return {
          root: root.name,
          modelId: root.userData.deliveryModelId,
          layoutId: root.userData.deliveryLayoutId,
          visibleUnits: root.userData.deliveryContentVisibleUnits,
          products,
          batches,
          namedNodes,
        };
      }, { id: fixture.id });
      throw new Error(`Timed out waiting for ${fixture.skuId} visual contract: ${JSON.stringify(census)}`, {
        cause: error,
      });
    }
    return fixture;
  }

  async function visualContract(fixture) {
    return page.evaluate((expected) => {
      const root = window.__fw.scene3d.scene.getObjectByName(`DeliveryBox_${expected.id}`);
      const products = [];
      const batches = [];
      const contentWorldBounds = {
        min: { x: Infinity, y: Infinity, z: Infinity },
        max: { x: -Infinity, y: -Infinity, z: -Infinity },
      };
      const includeBounds = (bounds) => {
        if (!bounds) return;
        for (const axis of ['x', 'y', 'z']) {
          contentWorldBounds.min[axis] = Math.min(contentWorldBounds.min[axis], bounds.min[axis]);
          contentWorldBounds.max[axis] = Math.max(contentWorldBounds.max[axis], bounds.max[axis]);
        }
      };
      const visibleInHierarchy = (object) => {
        let cursor = object;
        while (cursor) {
          if (!cursor.visible) return false;
          if (cursor === root) return true;
          cursor = cursor.parent;
        }
        return false;
      };
      root.updateWorldMatrix(true, true);
      root.traverse((object) => {
        if (/^BOX_CONTENT_\d+_/i.test(object.name || '')) {
          products.push({ name: object.name, visible: visibleInHierarchy(object) });
        }
        if (object.isInstancedMesh && object.userData.deliveryContentInstances) {
          object.computeBoundingBox();
          const worldBounds = object.boundingBox?.clone().applyMatrix4(object.matrixWorld) || null;
          includeBounds(worldBounds);
          batches.push({
            name: object.name,
            count: object.count,
            worldBounds: worldBounds ? {
              min: worldBounds.min.toArray(),
              max: worldBounds.max.toArray(),
            } : null,
          });
        }
      });
      const back = root.getObjectByName('BOX_BACK');
      if (back?.geometry) {
        if (!back.geometry.boundingBox) back.geometry.computeBoundingBox();
        back.updateWorldMatrix(true, false);
      }
      const backWallWorldBounds = back?.geometry?.boundingBox
        ?.clone().applyMatrix4(back.matrixWorld) || null;
      const frontWall = root.getObjectByName('BOX_WALL_FRONT');
      return {
        root: root.name,
        modelId: root.userData.deliveryModelId,
        layoutId: root.userData.deliveryLayoutId,
        visibleUnits: root.userData.deliveryContentVisibleUnits,
        productCount: products.length,
        visibleProductCount: products.filter((entry) => entry.visible).length,
        batches,
        contentWorldBounds: Number.isFinite(contentWorldBounds.min.x) ? contentWorldBounds : null,
        backWallWorldBounds: backWallWorldBounds ? {
          min: backWallWorldBounds.min.toArray(),
          max: backWallWorldBounds.max.toArray(),
        } : null,
        frontWallRevealRadians: frontWall ? frontWall.rotation.x : null,
        pointerLocked: document.pointerLockElement === document.querySelector('canvas'),
        allFlapsOpen: ['FRONT', 'BACK', 'LEFT', 'RIGHT'].every((side) => {
          const flap = root.getObjectByName(`BOX_FLAP_${side}`);
          return !!flap && Math.abs(flap.rotation.x) + Math.abs(flap.rotation.z) > 0.5;
        }),
      };
    }, fixture);
  }

  for (let index = 0; index < specs.length; index += 1) {
    const spec = specs[index];
    const fixture = await stageOpenBox(spec, index);
    const target = fixture.placement;
    const pose = {
      ...camera,
      x: target.x,
      z: target.z + (spec.skuId === 'bag1' ? 2.0 : spec.skuId === 'driver1' ? 0.95 : 1.27),
      pitch: spec.skuId === 'bag1' ? -0.58 : spec.skuId === 'driver1' ? -0.82 : camera.pitch,
    };
    await setCamera(pose);
    const file = path.join(out, spec.shot);
    await page.screenshot({ path: file });
    captures.push({ file, label: spec.label, fixture, visual: await visualContract(fixture) });
    fs.writeFileSync(path.join(out, 'run-state.json'), JSON.stringify({
      status: 'running', captures, updatedAt: new Date().toISOString(),
    }, null, 2));
  }

  const assertions = {
    sevenRequiredCategoryShots: captures.length === 7,
    exactAuthoredModelAndLayout: captures.every((entry) => (
      entry.visual.modelId === entry.fixture.modelId
      && entry.visual.layoutId === entry.fixture.layoutId
    )),
    exactVisibleQuantity: captures.every((entry) => (
      entry.fixture.lifecycle === 'OPEN'
      && entry.visual.productCount === entry.fixture.capacity
      && entry.visual.visibleProductCount === entry.fixture.capacity
      && entry.visual.visibleUnits === entry.fixture.capacity
      && entry.visual.batches.length > 0
      && entry.visual.batches.every((batch) => batch.count === entry.fixture.capacity)
    )),
    allFlapsClearContents: captures.every((entry) => entry.visual.allFlapsOpen),
    fittedBagRevealedAtRim: captures
      .filter((entry) => entry.fixture.skuId === 'bag1')
      .every((entry) => {
        const contentTop = entry.visual.contentWorldBounds?.max?.y;
        const rimTop = entry.visual.backWallWorldBounds?.max?.[1];
        return Number.isFinite(contentTop)
          && Number.isFinite(rimTop)
          && contentTop <= rimTop + 0.005
          && rimTop - contentTop <= 0.020
          && Math.abs(entry.visual.frontWallRevealRadians) >= 1.2;
      }),
    pointerLockHeld: captures.every((entry) => entry.visual.pointerLocked),
    noConsoleOrPageErrors: counts.consoleError === 0 && counts.pageError === 0,
    noFailedRequests: counts.requestFailed === 0,
  };
  const result = {
    ok: Object.values(assertions).every(Boolean),
    viewport: { width: 1600, height: 900, deviceScaleFactor: 1 },
    method: 'Real arrival manifests and shipped lifecycle verbs create one isolated full open box per required SKU category; screenshots use deterministic category-framing normal player-camera poses.',
    captures,
    assertions,
    diagnostics: { counts, entries: diagnostics },
  };
  fs.writeFileSync(path.join(out, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
  fs.writeFileSync(path.join(out, 'run-state.json'), `${JSON.stringify({
    status: result.ok ? 'passed' : 'failed', result: path.join(out, 'result.json'),
    captures: captures.map((entry) => entry.file), updatedAt: new Date().toISOString(),
  }, null, 2)}\n`);
  return result;
}
