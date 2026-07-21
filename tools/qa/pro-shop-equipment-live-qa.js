async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const tier = process.env.EQUIPMENT_TIER || 'municipal';
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const out = path.resolve(process.env.EQUIPMENT_QA_OUT
    || `qa/pro-shop-equipment/after/${tier}`);
  const requestedFamilies = new Set((process.env.EQUIPMENT_FAMILIES || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean));
  fs.mkdirSync(out, { recursive: true });

  const diagnostics = { consoleErrors: [], consoleWarnings: [], pageErrors: [], requestFailures: [] };
  page.on('console', (message) => {
    if (message.type() === 'error') diagnostics.consoleErrors.push(message.text());
    if (message.type() === 'warning') diagnostics.consoleWarnings.push(message.text());
  });
  page.on('pageerror', (error) => diagnostics.pageErrors.push(error.message));
  page.on('requestfailed', (request) => diagnostics.requestFailures.push({
    url: request.url(), error: request.failure()?.errorText || 'unknown',
  }));

  const url = new URL(baseUrl);
  url.searchParams.set('equipmentShowcase', '1');
  url.searchParams.set('equipmentTier', tier);
  await page.goto(url.toString());
  await page.getByText('Continue', { exact: true }).click().catch(() => {});
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
  await page.waitForFunction(() => window.__fw.scene3d.clubhouse().assetsReady?.() === true, null, { timeout: 90000 });
  await page.waitForFunction(() => {
    const value = window.__fw.scene3d.clubhouse().proShopEquipment?.showcase?.();
    return value?.loaded === 24 && value?.missing?.length === 0;
  }, null, { timeout: 90000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    if (!veil) return true;
    const style = getComputedStyle(veil);
    return style.display === 'none' || Number.parseFloat(style.opacity || '1') <= 0.01;
  }, null, { timeout: 90000 });
  await page.waitForTimeout(800);

  const inventory = await page.evaluate(async (expectedTier) => {
    const THREE = await import('/vendor/three.module.js');
    const app = window.__fw;
    const scene = app.scene3d.scene;
    const result = [];
    const roots = [];
    scene.traverse((object) => {
      if (object.userData?.showcase && object.userData?.equipmentFamily) roots.push(object);
    });
    for (const root of roots) {
      const box = new THREE.Box3().setFromObject(root);
      const size = box.getSize(new THREE.Vector3());
      const names = new Set();
      let visibleMeshes = 0;
      let collisions = 0;
      root.traverse((object) => {
        names.add(object.name);
        if (!object.isMesh) return;
        if (object.name.startsWith('COL_') || object.userData?.collision_proxy) collisions += 1;
        else if (object.visible) visibleMeshes += 1;
      });
      result.push({
        familyId: root.userData.equipmentFamily,
        tier: root.userData.equipmentTier,
        name: root.name,
        dimensions: { x: size.x, y: size.y, z: size.z },
        visibleMeshes,
        collisions,
        checkoutContracts: {
          posScreen: names.has('POS_Screen'),
          terminalScreen: names.has('Terminal_Screen'),
          cardSocket: names.has('CARD_INSERT_SOCKET'),
          receiptSocket: names.has('RECEIPT_OUTPUT_SOCKET'),
          drawerSlide: names.has('DrawerSlide'),
        },
      });
    }
    return {
      tier: app.scene3d.clubhouse().proShopEquipment?.tier,
      showcase: app.scene3d.clubhouse().proShopEquipment?.showcase?.(),
      roots: result.sort((a, b) => a.familyId.localeCompare(b.familyId)),
      expectedTier,
    };
  }, tier);

  async function poseFamily(familyId) {
    const pose = await page.evaluate(async (id) => {
      const THREE = await import('/vendor/three.module.js');
      const app = window.__fw;
      const walk = app.scene3d.walk;
      let root = null;
      app.scene3d.scene.traverse((object) => {
        if (!root && object.userData?.showcase && object.userData?.equipmentFamily === id) root = object;
      });
      if (!root) return null;
      const box = new THREE.Box3().setFromObject(root);
      const size = box.getSize(new THREE.Vector3());
      const centre = box.getCenter(new THREE.Vector3());
      const span = Math.max(size.x, size.y, size.z);
      const distance = Math.max(0.48, span * 1.08);
      const ax = centre.x + distance * 0.62;
      const az = centre.z + distance;
      const dx = centre.x - ax;
      const dz = centre.z - az;
      walk.clearKeys?.();
      walk.state.x = ax;
      walk.state.z = az;
      walk.state.yaw = Math.atan2(-dx, -dz);
      walk.state.pitch = 0;
      const day = Math.floor(app.state.clock.minutes / 1440) * 1440;
      app.state.clock.minutes = day + 14 * 60;
      app.scene3d.applyTimeWeather?.(14 * 60, app.state.weather);
      return { centre: centre.toArray(), size: size.toArray(), camera: [ax, az] };
    }, familyId);
    // Let the normal walking loop settle onto the real terrain, then infer the
    // floor from the actual camera. The clubhouse helper deliberately reports
    // a different surface outside its playable bounds, so using it directly
    // makes an off-map QA gallery aim several metres too low.
    await page.waitForTimeout(100);
    await page.evaluate(async (id) => {
      const THREE = await import('/vendor/three.module.js');
      const app = window.__fw;
      const walk = app.scene3d.walk;
      let root = null;
      app.scene3d.scene.traverse((object) => {
        if (!root && object.userData?.showcase && object.userData?.equipmentFamily === id) root = object;
      });
      const box = new THREE.Box3().setFromObject(root);
      const size = box.getSize(new THREE.Vector3());
      const centre = box.getCenter(new THREE.Vector3());
      const floorY = app.scene3d.camera.position.y - walk.state.eye;
      const desiredEyeY = centre.y + Math.max(0.04, size.y * 0.08);
      walk.state.eye = Math.max(0.16, desiredEyeY - floorY);
      const dx = centre.x - walk.state.x;
      const dz = centre.z - walk.state.z;
      walk.state.pitch = Math.max(-1.10, Math.min(0.45,
        Math.atan2(centre.y - (floorY + walk.state.eye), Math.hypot(dx, dz))));
    }, familyId);
    return pose;
  }

  const captures = [];
  const captureRoots = requestedFamilies.size
    ? inventory.roots.filter((entry) => requestedFamilies.has(entry.familyId))
    : inventory.roots;
  for (const entry of captureRoots) {
    const pose = await poseFamily(entry.familyId);
    await page.waitForTimeout(180);
    pose.actual = await page.evaluate(async (id) => {
      const THREE = await import('/vendor/three.module.js');
      const app = window.__fw;
      let root = null;
      app.scene3d.scene.traverse((object) => {
        if (!root && object.userData?.showcase && object.userData?.equipmentFamily === id) root = object;
      });
      const centre = new THREE.Box3().setFromObject(root).getCenter(new THREE.Vector3());
      const ndc = centre.clone().project(app.scene3d.camera);
      return {
        camera: app.scene3d.camera.position.toArray(),
        centreNdc: ndc.toArray(),
        walk: {
          x: app.scene3d.walk.state.x,
          z: app.scene3d.walk.state.z,
          eye: app.scene3d.walk.state.eye,
          yaw: app.scene3d.walk.state.yaw,
          pitch: app.scene3d.walk.state.pitch,
        },
      };
    }, entry.familyId);
    const file = path.join(out, `${entry.familyId}.png`);
    await page.screenshot({ path: file });
    captures.push({ familyId: entry.familyId, file, pose });
  }

  await page.evaluate(() => {
    const app = window.__fw;
    const club = app.scene3d.clubhouse();
    const origin = club.interior.position;
    const walk = app.scene3d.walk;
    walk.state.eye = 1.7;
    const ax = origin.x + 0.5;
    const az = origin.z + 2.3;
    const tx = origin.x + 3.0;
    const tz = origin.z + 4.5;
    walk.state.x = ax;
    walk.state.z = az;
    walk.state.yaw = Math.atan2(-(tx - ax), -(tz - az));
    walk.state.pitch = -0.10;
  });
  await page.waitForTimeout(500);

  const performance = await page.evaluate(async () => {
    const app = window.__fw.scene3d;
    const frames = [];
    let previous = performance.now();
    const started = previous;
    await new Promise((resolve) => {
      const tick = (now) => {
        frames.push(now - previous);
        previous = now;
        if (now - started >= 3000) resolve(); else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    const useful = frames.slice(1).filter((value) => value > 0);
    const descending = [...useful].sort((a, b) => b - a);
    const onePercentCount = Math.max(1, Math.ceil(descending.length * 0.01));
    const onePercentMs = descending.slice(0, onePercentCount)
      .reduce((sum, value) => sum + value, 0) / onePercentCount;
    const materials = new Set();
    const textures = new Set();
    let visibleMeshes = 0;
    let sceneTriangles = 0;
    app.scene.traverse((object) => {
      if (!object.isMesh || !object.visible) return;
      visibleMeshes += 1;
      const geometry = object.geometry;
      sceneTriangles += geometry?.index
        ? geometry.index.count / 3
        : (geometry?.attributes?.position?.count || 0) / 3;
      for (const material of (Array.isArray(object.material) ? object.material : [object.material])) {
        if (!material) continue;
        materials.add(material.uuid);
        for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap']) {
          if (material[key]) textures.add(material[key].uuid);
        }
      }
    });
    return {
      averageFps: useful.length * 1000 / useful.reduce((sum, value) => sum + value, 0),
      onePercentLowFps: 1000 / onePercentMs,
      worstFrameMs: descending[0] || null,
      renderer: {
        drawCalls: app.renderer.info.render.calls,
        renderedTriangles: app.renderer.info.render.triangles,
        sceneTriangles: Math.round(sceneTriangles),
        visibleMeshes,
        materialCount: materials.size,
        textureCount: textures.size,
        geometriesInMemory: app.renderer.info.memory.geometries,
        texturesInMemory: app.renderer.info.memory.textures,
      },
    };
  });

  const blockingRequestFailures = diagnostics.requestFailures
    .filter((failure) => !/ERR_ABORTED/i.test(failure.error));
  const validInventory = inventory.tier === tier
    && inventory.roots.length === 24
    && inventory.roots.every((entry) => entry.tier === tier
      && entry.visibleMeshes > 0 && entry.collisions > 0);
  const checkout = Object.fromEntries(inventory.roots
    .filter((entry) => ['pos_terminal', 'card_reader', 'receipt_printer', 'cash_drawer'].includes(entry.familyId))
    .map((entry) => [entry.familyId, entry.checkoutContracts]));
  const validCheckout = checkout.pos_terminal?.posScreen
    && checkout.card_reader?.terminalScreen && checkout.card_reader?.cardSocket
    && checkout.receipt_printer?.receiptSocket && checkout.cash_drawer?.drawerSlide;
  const result = {
    ok: validInventory && validCheckout
      && diagnostics.consoleErrors.length === 0
      && diagnostics.pageErrors.length === 0
      && blockingRequestFailures.length === 0,
    tier,
    validInventory,
    validCheckout,
    inventory,
    captures,
    performance,
    videoCaptureActive: !!page.video(),
    diagnostics: { ...diagnostics, blockingRequestFailures },
  };
  fs.writeFileSync(path.join(out, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}
