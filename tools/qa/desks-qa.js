async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const iteration = process.env.DESK_QA_ITERATION || 'iteration-01';
  const repo = process.env.QA_REPO_ROOT || process.cwd();
  const out = path.join(repo, 'qa', 'desks', iteration);
  fs.mkdirSync(out, { recursive: true });

  // The runner seeds the deterministic holding into localStorage while its
  // first document is still finishing asynchronous startup. Preserve that
  // exact snapshot, drain the old page, then restore it before the intentional
  // legacy-clubhouse navigation so the old menu state cannot win the race.
  const runnerAutosave = await page.evaluate(() => localStorage.getItem('golfempire:autosave'));
  if (!runnerAutosave) throw new Error('Desk QA requires the runner bootstrap autosave.');
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(750);
  await page.evaluate((raw) => {
    localStorage.setItem('golfempire:autosave', raw);
  }, runnerAutosave);

  const browser = {
    consoleErrors: [], consoleWarnings: [], pageErrors: [], requestFailures: [],
    ignoredNavigationAborts: [],
  };
  page.on('console', (message) => {
    if (message.type() === 'error') browser.consoleErrors.push(message.text());
    if (message.type() === 'warning') browser.consoleWarnings.push(message.text());
  });
  page.on('pageerror', (error) => browser.pageErrors.push(error.stack || error.message));
  page.on('requestfailed', (request) => {
    const failure = { url: request.url(), error: request.failure()?.errorText || 'unknown' };
    // Chromium reports in-flight model requests cancelled by page.goto/reload
    // after the navigation promise has resolved. ERR_ABORTED is cancellation,
    // not a load failure; preserve it for evidence but do not fail the console
    // gate. Network errors such as 404, connection failure, and decode errors
    // continue into requestFailures below.
    if (failure.error === 'net::ERR_ABORTED') {
      browser.ignoredNavigationAborts.push(failure);
      return;
    }
    browser.requestFailures.push(failure);
  });

  await page.addInitScript(() => {
    const add = EventTarget.prototype.addEventListener;
    const remove = EventTarget.prototype.removeEventListener;
    const live = Object.create(null);
    const keyFor = (target, type) => `${target === window ? 'window' : 'document'}:${type}`;
    EventTarget.prototype.addEventListener = function trackedAdd(type, listener, options) {
      if (this === window || this === document) {
        const key = keyFor(this, type);
        live[key] = (live[key] || 0) + 1;
      }
      return add.call(this, type, listener, options);
    };
    EventTarget.prototype.removeEventListener = function trackedRemove(type, listener, options) {
      if (this === window || this === document) {
        const key = keyFor(this, type);
        live[key] = (live[key] || 0) - 1;
      }
      return remove.call(this, type, listener, options);
    };
    window.__deskQaListeners = live;
  });

  const base = process.env.QA_BASE_URL || `${new URL(page.url()).origin}/`;
  const url = new URL(base);
  url.searchParams.set('deskqa', iteration);
  // The legacy walk-in shell is the production placement/interactions host.
  // Selecting it explicitly avoids loading an unrelated architectural showcase
  // GLB during this furniture-focused route and makes reload evidence stable.
  url.searchParams.set('clubhouse', 'legacy');
  await page.goto(url.toString(), { waitUntil: 'domcontentloaded' });
  await page.setViewportSize({ width: 1600, height: 900 });

  // Repeatable state fixture only: keep simulation mutation within the active
  // browser save, then use production catalog/ownership/placement APIs after
  // load.  Turning business off before Continue prevents random customers from
  // entering the visual route.
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('golfempire:autosave'));
    const holding = raw?.holdings?.find((entry) => entry.property.id === raw.activeId)
      || raw?.holdings?.[0];
    if (!holding?.state) {
      const keys = raw && typeof raw === 'object' ? Object.keys(raw).join(',') : 'none';
      throw new Error(
        `Desk QA needs a bootstrapped holding (keys=${keys}; holdings=${raw?.holdings?.length ?? 'missing'}; activeId=${raw?.activeId ?? 'missing'}).`,
      );
    }
    holding.state.tutorial.complete = true;
    holding.state.tutorial.hidden = true;
    if (holding.state.campaign) {
      holding.state.campaign.businessOpen = false;
      holding.state.campaign.enabled = false;
    }
    if (holding.state.propertyInventory?.placements) {
      holding.state.propertyInventory.placements = holding.state.propertyInventory.placements.filter((entry) => (
        !entry.assetId?.startsWith('pro-shop-furniture:office-desks:')
      ));
    }
    localStorage.setItem('golfempire:autosave', JSON.stringify(raw));
  });
  await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || getComputedStyle(veil).display === 'none'
      || Number(getComputedStyle(veil).opacity) <= 0.01;
  }, null, { timeout: 90000 });

  const isolatePresentation = async () => page.evaluate(async () => {
    const app = window.__fw;
    app.speedIdx = 0;
    const clubhouse = app.scene3d.clubhouse();
    clubhouse.setOrganicWalkins(false);
    clubhouse.clearWalkins();
    const interior = clubhouse.interior;
    const hidden = [
      'shop-stock', 'Assets61to100Runtime', 'Sheet07CampaignProduction',
      'ShopProgressionVisuals', 'DeliveryEquipmentInteriorRoot',
      'DeliveryRecyclingStation', 'TieredMemberLounge', 'TieredRetailGondola',
      'CampaignInteractionMarkers',
    ];
    for (const object of interior.children) {
      if (object.name.startsWith('Fixture_') || hidden.includes(object.name)) object.visible = false;
    }
    interior.traverse((object) => {
      if (/^SHEET06_60_damage-/i.test(object.name || '') || object.name === 'LOD0_FloorDamageWood') {
        object.visible = false;
      }
    });
    const ui = await import('/src/ui/ui.js');
    ui.clearNotifications();
    ui.clearToasts();
    let style = document.querySelector('#desk-qa-presentation');
    if (!style) {
      style = document.createElement('style');
      style.id = 'desk-qa-presentation';
      style.textContent = '.notification-center,.toast-wrap,.shop-lockhint{display:none!important}';
      document.head.appendChild(style);
    }
  });

  const fixedOverviewPose = async () => page.evaluate(async () => {
    const app = window.__fw;
    const center = app.scene3d.clubhouse().group.position;
    const walk = app.scene3d.walk;
    walk.clearKeys();
    walk.clearFocus?.();
    walk.state.x = center.x - 0.43;
    walk.state.z = center.z + 3.8;
    walk.state.yaw = 0;
    walk.state.pitch = -0.19;
    app.scene3d.camera.fov = 72;
    app.scene3d.camera.updateProjectionMatrix();
    app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440 + 14 * 60;
    app.scene3d.applyTimeWeather(14 * 60, app.state.weather);
    const ui = await import('/src/ui/ui.js');
    ui.clearNotifications();
    ui.clearToasts();
  });

  const frameMetrics = async (seconds = 3.2) => page.evaluate(async (durationSeconds) => {
    const frames = [];
    const start = performance.now();
    let previous = start;
    await new Promise((resolve) => {
      const tick = (now) => {
        frames.push(now - previous);
        previous = now;
        if (now - start >= durationSeconds * 1000) resolve();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    const samples = frames.slice(2).sort((a, b) => a - b);
    const mean = samples.reduce((sum, value) => sum + value, 0) / Math.max(1, samples.length);
    const p99 = samples[Math.min(samples.length - 1, Math.floor(samples.length * 0.99))] || 0;
    const renderer = window.__fw.scene3d.renderer;
    const info = renderer.info;
    const scene = window.__fw.scene3d.scene;
    const materials = new Set();
    const textures = new Set();
    scene.traverseVisible((object) => {
      if (!object.isMesh) return;
      for (const material of (Array.isArray(object.material) ? object.material : [object.material])) {
        if (!material) continue;
        materials.add(material.uuid);
        for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
      }
    });
    let textureBytes = 0;
    for (const texture of textures) {
      const image = texture.image;
      const width = Number(image?.videoWidth || image?.naturalWidth || image?.width || 0);
      const height = Number(image?.videoHeight || image?.naturalHeight || image?.height || 0);
      textureBytes += width * height * 4;
    }
    return {
      frameCount: samples.length,
      fps: mean > 0 ? 1000 / mean : 0,
      onePercentLowFps: p99 > 0 ? 1000 / p99 : 0,
      worstFrameMs: samples.at(-1) || 0,
      meanFrameMs: mean,
      drawCalls: info.render.calls,
      triangles: info.render.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      visibleMaterials: materials.size,
      visibleTextureBytesApprox: textureBytes,
      heapBytes: performance.memory?.usedJSHeapSize || null,
      listeners: { ...(window.__deskQaListeners || {}) },
    };
  }, seconds);

  // Clean the room and measure the identical camera route without the new desk
  // placements. This is the contribution baseline for the performance skill.
  const baselineFixture = await page.evaluate(async () => {
    const app = window.__fw;
    const shop = await import('/src/sim/shop.js');
    for (const placement of [...(app.state.propertyInventory?.placements || [])]) {
      if (placement.assetId?.startsWith('pro-shop-furniture:office-desks:')) {
        shop.removeDecorPlacement(app.state, placement.id);
      }
    }
    const reno = app.state.shop.reno;
    reno.grime?.fill(0);
    reno.windows?.fill(0);
    reno.clutter?.forEach((pile) => { pile.cleared = true; });
    reno.debris = [];
    reno.debrisSeeded = true;
    app.scene3d.clubhouse().rebuildReno();
    return { placements: app.state.propertyInventory?.placements?.length || 0 };
  });
  await isolatePresentation();
  await fixedOverviewPose();
  await page.waitForTimeout(900);
  const performanceBefore = await frameMetrics();

  const seeded = await page.evaluate(async () => {
    const app = window.__fw;
    const shop = await import('/src/sim/shop.js');
    const skuIds = [
      'furn-office-desks-basic',
      'furn-office-desks-standard',
      'furn-office-desks-premium',
      'furn-office-desks-luxury',
      'furn-office-desks-executive',
    ];
    const xs = [-4.2, -2.6, -0.84, 1.03, 3.04];
    const results = skuIds.map((skuId, index) => {
      app.state.shop.inventory[skuId].back = Math.max(1, app.state.shop.inventory[skuId].back || 0);
      return shop.placeDecorFree(app.state, skuId, {
        area: 'clubhouse', mount: 'floor', x: xs[index], y: 0, z: 0,
        ry: 0, surfaceId: `desk-qa:${index}`, authoredSpot: null,
      });
    });
    app.scene3d.clubhouse().rebuildReno();
    return results.map((result, index) => ({
      skuId: skuIds[index], ok: result.ok, reason: result.reason || null,
      placementId: result.placement?.id || null,
    }));
  });
  if (seeded.some((entry) => !entry.ok)) throw new Error(`Desk seed failed: ${JSON.stringify(seeded)}`);
  await page.waitForFunction(() => {
    const roots = [];
    window.__fw.scene3d.scene.traverse((object) => {
      if (object.name?.startsWith('PropertyFurniture_furn-office-desks-')) roots.push(object);
    });
    return roots.length === 5 && roots.every((root) => root.userData.loaded === true);
  }, null, { timeout: 45000 });
  await isolatePresentation();
  await fixedOverviewPose();
  await page.waitForTimeout(1200);

  const screenshots = [];
  const screenshot = async (name) => {
    const filename = path.join(out, `${name}.png`);
    await page.screenshot({ path: filename });
    screenshots.push(filename);
    return filename;
  };
  await screenshot('01-five-tier-overview-closed');
  const performanceAfter = await frameMetrics();

  const targets = [
    ['basic', 'Drawer_Left_Top'],
    ['standard', 'Drawer_Left_Middle'],
    ['premium', 'CabinetDoor_Left'],
    ['luxury', 'Drawer_Center'],
    ['executive', 'CabinetDoor_Left'],
  ];
  const interactions = [];
  for (let index = 0; index < targets.length; index += 1) {
    const [tier, componentName] = targets[index];
    const aim = await page.evaluate(({ tierId, component }) => {
      const app = window.__fw;
      let root = null;
      app.scene3d.scene.traverse((object) => {
        if (object.name?.startsWith('PropertyFurniture_furn-office-desks-')) {
          object.visible = object.name === `PropertyFurniture_furn-office-desks-${tierId}`;
          if (object.visible) root = object;
        }
      });
      const controller = root?.userData?.interactiveComponents?.find((entry) => entry.name === component);
      if (!controller) return { ok: false, reason: 'component-not-found' };
      controller.interactionNode.updateWorldMatrix(true, false);
      const matrix = controller.interactionNode.matrixWorld.elements;
      const target = { x: matrix[12], y: matrix[13], z: matrix[14] };
      const walk = app.scene3d.walk;
      walk.clearKeys();
      walk.clearFocus?.();
      walk.state.x = target.x;
      walk.state.z = target.z + 1.62;
      walk.state.yaw = 0;
      walk.state.pitch = -0.48;
      app.scene3d.camera.fov = 58;
      app.scene3d.camera.updateProjectionMatrix();
      return { ok: true, target, beforeOpen: controller.isOpen(), before: controller.node.position.toArray() };
    }, { tierId: tier, component: componentName });
    await page.waitForTimeout(180);
    await page.evaluate(({ tierId, component }) => {
      const app = window.__fw;
      let root = null;
      app.scene3d.scene.traverse((object) => {
        if (object.name === `PropertyFurniture_furn-office-desks-${tierId}`) root = object;
      });
      const controller = root.userData.interactiveComponents.find((entry) => entry.name === component);
      controller.interactionNode.updateWorldMatrix(true, false);
      const matrix = controller.interactionNode.matrixWorld.elements;
      const target = { x: matrix[12], y: matrix[13], z: matrix[14] };
      const camera = app.scene3d.camera;
      const dx = target.x - camera.position.x;
      const dy = target.y - camera.position.y;
      const dz = target.z - camera.position.z;
      const spatial = Math.hypot(dx, dy, dz) || 1;
      app.scene3d.walk.state.yaw = Math.atan2(-dx, -dz);
      app.scene3d.walk.state.pitch = Math.asin(dy / spatial);
      app.scene3d.walk.clearFocus?.();
    }, { tierId: tier, component: componentName });
    await page.waitForTimeout(420);
    const beforeInput = await page.evaluate(() => ({
      label: window.__fw.scene3d.walk.getFocusLabel?.() || null,
      component: window.__fw.scene3d.walk.getFocus?.()?.prop?.furnitureComponent || null,
    }));
    await page.keyboard.press('e');
    await page.waitForTimeout(720);
    const afterInput = await page.evaluate(({ tierId, component }) => {
      const app = window.__fw;
      let root = null;
      app.scene3d.scene.traverse((object) => {
        if (object.name === `PropertyFurniture_furn-office-desks-${tierId}`) root = object;
      });
      const controller = root.userData.interactiveComponents.find((entry) => entry.name === component);
      const placement = app.state.propertyInventory.placements.find((entry) => (
        entry.assetId === `pro-shop-furniture:office-desks:${tierId}`
      ));
      return {
        open: controller.isOpen(), progress: controller.progress,
        node: controller.node.position.toArray(),
        saved: placement?.componentStates?.[component] ?? null,
        label: app.scene3d.walk.getFocusLabel?.() || null,
      };
    }, { tierId: tier, component: componentName });
    await screenshot(`${String(index + 2).padStart(2, '0')}-${tier}-${componentName}-open`);
    interactions.push({ tier, componentName, aim, beforeInput, afterInput });
  }

  // One real movement/collision sample: start in front of the Premium desk,
  // hold the normal forward key, and prove the analytic furniture collider
  // stops the player instead of allowing a walk through the pedestal.
  const collision = await page.evaluate(() => {
    const app = window.__fw;
    app.scene3d.scene.traverse((object) => {
      if (object.name?.startsWith('PropertyFurniture_furn-office-desks-')) object.visible = true;
    });
    const placement = app.state.propertyInventory.placements.find((entry) => (
      entry.assetId === 'pro-shop-furniture:office-desks:premium'
    ));
    const center = app.scene3d.clubhouse().group.position;
    const walk = app.scene3d.walk;
    walk.clearKeys();
    walk.state.x = center.x + placement.pose.x;
    walk.state.z = center.z + placement.pose.z + 1.75;
    walk.state.yaw = 0;
    walk.state.pitch = 0;
    walk.clearFocus?.();
    return { start: { x: walk.state.x, z: walk.state.z } };
  });
  await page.keyboard.down('w');
  await page.waitForTimeout(850);
  await page.keyboard.up('w');
  collision.end = await page.evaluate(() => ({
    x: window.__fw.scene3d.walk.state.x,
    z: window.__fw.scene3d.walk.state.z,
  }));
  collision.distance = Math.hypot(collision.end.x - collision.start.x, collision.end.z - collision.start.z);

  await page.evaluate(async () => { await window.__fw.autosave(); });
  const savedState = await page.evaluate(() => (
    window.__fw.state.propertyInventory.placements
      .filter((entry) => entry.assetId.startsWith('pro-shop-furniture:office-desks:'))
      .map((entry) => ({ assetId: entry.assetId, componentStates: { ...entry.componentStates } }))
  ));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
  await page.waitForFunction(() => {
    const roots = [];
    window.__fw.scene3d.scene.traverse((object) => {
      if (object.name?.startsWith('PropertyFurniture_furn-office-desks-')) roots.push(object);
    });
    return roots.length === 5 && roots.every((root) => root.userData.loaded === true);
  }, null, { timeout: 45000 });
  await isolatePresentation();
  await fixedOverviewPose();
  await page.waitForTimeout(1000);
  const reloadedState = await page.evaluate(() => {
    const runtime = [];
    window.__fw.scene3d.scene.traverse((object) => {
      if (!object.name?.startsWith('PropertyFurniture_furn-office-desks-')) return;
      runtime.push({
        name: object.name,
        components: object.userData.interactiveComponents.map((component) => ({
          name: component.name, open: component.isOpen(), progress: component.progress,
        })),
      });
    });
    return {
      placements: window.__fw.state.propertyInventory.placements
        .filter((entry) => entry.assetId.startsWith('pro-shop-furniture:office-desks:'))
        .map((entry) => ({ assetId: entry.assetId, componentStates: { ...entry.componentStates } })),
      runtime,
    };
  });
  await screenshot('07-after-save-reload');

  const runtimeDiagnostics = await page.evaluate(() => (
    window.__fw.scene3d.clubhouse().propertyFurnitureDiagnostics?.() || []
  ));
  const lodSelections = await page.evaluate(() => {
    const selections = [];
    window.__fw.scene3d.scene.traverse((object) => {
      if (!object.name?.startsWith('PropertyFurniture_furn-office-desks-')) return;
      const lod = object.userData.authoredLod;
      if (!lod?.isLOD) return;
      selections.push({
        name: object.name,
        levelIndexesAtRuntimeDistance: [0, 10, 25].map((distance) => (
          lod.levels.findIndex((level) => level.object === lod.getObjectForDistance(distance))
        )),
      });
    });
    return selections;
  });
  const performanceDelta = {
    fpsPercent: performanceBefore.fps > 0
      ? ((performanceAfter.fps - performanceBefore.fps) / performanceBefore.fps) * 100 : 0,
    drawCalls: performanceAfter.drawCalls - performanceBefore.drawCalls,
    triangles: performanceAfter.triangles - performanceBefore.triangles,
    geometries: performanceAfter.geometries - performanceBefore.geometries,
    textures: performanceAfter.textures - performanceBefore.textures,
    visibleMaterials: performanceAfter.visibleMaterials - performanceBefore.visibleMaterials,
    visibleTextureBytesApprox: performanceAfter.visibleTextureBytesApprox
      - performanceBefore.visibleTextureBytesApprox,
    heapBytes: performanceAfter.heapBytes != null && performanceBefore.heapBytes != null
      ? performanceAfter.heapBytes - performanceBefore.heapBytes : null,
  };
  const result = {
    iteration,
    browser,
    baselineFixture,
    seeded,
    screenshots,
    interactions,
    collision,
    saveLoad: { before: savedState, after: reloadedState },
    runtimeDiagnostics,
    lodSelections,
    performance: { before: performanceBefore, after: performanceAfter, delta: performanceDelta },
    acceptance: {
      allModelsLoaded: runtimeDiagnostics.length === 5
        && runtimeDiagnostics.every((entry) => entry.loaded && !entry.loadError),
      everyRuntimeLodActive: runtimeDiagnostics.length === 5
        && runtimeDiagnostics.every((entry) => entry.lodLevels?.length === 3),
      everyRuntimeLodSwitches: lodSelections.length === 5
        && lodSelections.every((entry) => (
          JSON.stringify(entry.levelIndexesAtRuntimeDistance) === JSON.stringify([0, 1, 2])
        )),
      everyNormalInputOpened: interactions.every((entry) => (
        entry.beforeInput.component === entry.componentName
        && entry.afterInput.open === true
        && entry.afterInput.saved === true
      )),
      collisionStoppedPlayer: collision.distance < 1.45,
      saveReloadPreserved: savedState.every((before) => {
        const after = reloadedState.placements.find((entry) => entry.assetId === before.assetId);
        return after && JSON.stringify(after.componentStates) === JSON.stringify(before.componentStates);
      }),
      consoleClean: browser.consoleErrors.length === 0
        && browser.pageErrors.length === 0
        && browser.requestFailures.length === 0,
      performanceWithinBudget: performanceAfter.fps >= 55
        && performanceAfter.onePercentLowFps >= 30
        && performanceDelta.drawCalls <= 240
        && performanceDelta.geometries <= 130
        && performanceDelta.visibleMaterials <= 130,
    },
  };
  fs.writeFileSync(path.join(out, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}
