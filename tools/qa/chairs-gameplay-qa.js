async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repoRoot = process.env.QA_REPO_ROOT || process.cwd();
  const outDir = path.join(repoRoot, 'qa', 'chairs', 'gameplay');
  fs.mkdirSync(outDir, { recursive: true });

  const diagnostics = {
    consoleErrors: [], consoleWarnings: [], pageErrors: [], failedRequests: [],
    ignoredNavigationAborts: [],
  };
  let intentionalNavigation = true;
  page.on('console', (message) => {
    if (message.type() === 'error') diagnostics.consoleErrors.push(message.text());
    if (message.type() === 'warning') diagnostics.consoleWarnings.push(message.text());
  });
  page.on('pageerror', (error) => diagnostics.pageErrors.push(error.stack || error.message));
  page.on('requestfailed', (request) => {
    const failure = { url: request.url(), error: request.failure()?.errorText || 'unknown' };
    if (intentionalNavigation && failure.error === 'net::ERR_ABORTED') {
      diagnostics.ignoredNavigationAborts.push(failure);
    } else {
      diagnostics.failedRequests.push(failure);
    }
  });

  const runnerAutosave = await page.evaluate(() => localStorage.getItem('golfempire:autosave'));
  if (!runnerAutosave) throw new Error('Chair gameplay QA requires the runner bootstrap autosave.');
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(600);
  await page.evaluate((raw) => localStorage.setItem('golfempire:autosave', raw), runnerAutosave);

  const baseUrl = process.env.QA_BASE_URL || `${new URL(page.url()).origin}/`;
  const url = new URL(baseUrl);
  url.searchParams.set('clubhouse', 'legacy');
  url.searchParams.set('chairqa', 'gameplay');
  await page.goto(url.toString(), { waitUntil: 'domcontentloaded' });
  await page.setViewportSize({ width: 1600, height: 900 });

  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('golfempire:autosave'));
    const holding = raw?.holdings?.find((entry) => entry.property.id === raw.activeId)
      || raw?.holdings?.[0];
    if (!holding?.state) throw new Error('Bootstrapped holding is missing.');
    const state = holding.state;
    state.cash = 10_000_000;
    state.tutorial.complete = true;
    state.tutorial.hidden = true;
    state.shop.unlockedTier = 3;
    state.shop.orders = [];
    state.shop.nextOrderId = 1;
    state.shop.reno.decor = [];
    state.shop.deliveries.boxes = [];
    state.shop.deliveries.shipments = [];
    state.shop.deliveries.arrivedOrderIds = [];
    state.propertyInventory.items = [];
    state.propertyInventory.placements = [];
    state.propertyInventory.pendingDeliveries = [];
    state.propertyInventory.operations = [];
    state.propertyInventory.nextItemId = 1;
    state.propertyInventory.nextPlacementId = 1;
    localStorage.setItem('golfempire:autosave', JSON.stringify(raw));
  });

  await page.getByText('Continue', { exact: true }).click();
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || getComputedStyle(veil).display === 'none'
      || Number.parseFloat(getComputedStyle(veil).opacity || '1') <= 0.01;
  }, null, { timeout: 90000 });
  await page.waitForTimeout(1200);
  intentionalNavigation = false;

  const clearPresentation = async () => page.evaluate(async () => {
    const app = window.__fw;
    const ui = await import('/src/ui/ui.js');
    ui.clearNotifications();
    ui.clearToasts();
    app.speedIdx = 0;
    const clubhouse = app.scene3d.clubhouse();
    clubhouse.setOrganicWalkins(false);
    clubhouse.clearWalkins();
    let style = document.querySelector('#chair-gameplay-qa-presentation');
    if (!style) {
      style = document.createElement('style');
      style.id = 'chair-gameplay-qa-presentation';
      style.textContent = '.notification-center,.toast-wrap,.shop-lockhint{display:none!important}';
      document.head.appendChild(style);
    }
  });

  const cleanRoom = await page.evaluate(async () => {
    const app = window.__fw;
    const layout = await import('/src/sim/layout.js');
    const campaign = await import('/src/sim/campaign.js');
    const state = app.state;
    const clubhouse = app.scene3d.clubhouse();
    campaign.disableCampaign(state);
    const storedFixtures = [];
    for (const fixture of layout.placedFixtures(state)) {
      const stored = layout.storeObject(state, fixture.id, { history: false });
      if (stored.ok) storedFixtures.push(fixture.id);
    }
    state.shop.reno.grime?.fill(0);
    state.shop.reno.windows?.fill(0);
    state.shop.reno.clutter?.forEach((pile) => { pile.cleared = true; });
    state.shop.reno.debris = [];
    state.shop.reno.debrisSeeded = true;
    clubhouse.rebuildReno();
    clubhouse.rebuildStock();
    clubhouse.refreshCampaign();
    return { storedFixtures, remainingFixtures: layout.placedFixtures(state).length };
  });
  await clearPresentation();

  const localCamera = async ({ at, target, targetY = 0.8, fov = 70, minute = 840 }) => {
    await page.evaluate(({ at, target, targetY, fov, minute }) => {
      const app = window.__fw;
      const interior = app.scene3d.clubhouse().interior;
      const Vector3 = interior.position.constructor;
      const origin = interior.localToWorld(new Vector3(at[0], 0, at[1]));
      const destination = interior.localToWorld(new Vector3(target[0], targetY, target[1]));
      const walk = app.scene3d.walk;
      walk.clearKeys();
      walk.clearFocus?.();
      walk.setSpraying(false);
      walk.state.x = origin.x;
      walk.state.z = origin.z;
      const dx = destination.x - origin.x;
      const dz = destination.z - origin.z;
      const dy = destination.y - (origin.y + (walk.state.eye || 1.62));
      walk.state.yaw = Math.atan2(-dx, -dz);
      walk.state.pitch = Math.atan2(dy, Math.hypot(dx, dz) || 0.001);
      app.scene3d.camera.fov = fov;
      app.scene3d.camera.updateProjectionMatrix();
      const day = Math.floor(app.state.clock.minutes / 1440);
      app.state.clock.minutes = day * 1440 + minute;
      app.scene3d.applyTimeWeather(minute, app.state.weather);
    }, { at, target, targetY, fov, minute });
    await clearPresentation();
    await page.waitForTimeout(500);
  };

  const screenshots = [];
  const capture = async (name) => {
    await clearPresentation();
    const file = path.join(outDir, `${name}.png`);
    await page.screenshot({ path: file, animations: 'disabled' });
    screenshots.push(file);
    return file;
  };

  const normalMove = await page.evaluate(() => ({ ...window.__fw.scene3d.walk.state }));
  await page.keyboard.down('d');
  await page.waitForTimeout(420);
  await page.keyboard.up('d');
  const normalMoveEnd = await page.evaluate(() => ({ ...window.__fw.scene3d.walk.state }));
  normalMove.distance = Math.hypot(
    normalMoveEnd.x - normalMove.x,
    normalMoveEnd.z - normalMove.z,
  );
  normalMove.after = normalMoveEnd;

  // Open the physical clubhouse laptop with the normal interaction key.
  await page.evaluate(() => {
    const app = window.__fw;
    const origin = app.scene3d.clubhouse().interior.position;
    const walk = app.scene3d.walk;
    walk.clearKeys();
    walk.clearFocus?.();
    walk.state.x = origin.x + 8.45;
    walk.state.z = origin.z + 4.5;
    walk.state.yaw = -Math.PI / 2;
    walk.state.pitch = -0.05;
  });
  await page.waitForFunction(() => /laptop/iu.test(
    window.__fw.scene3d.walk.getFocusLabel?.() || '',
  ), null, { timeout: 10000 });
  await page.keyboard.press('e');
  await page.waitForFunction(() => window.__fw?.laptopOpen === true, null, { timeout: 10000 });
  await page.waitForFunction(() => (
    document.querySelector('.lt-frame')?.getBoundingClientRect().width > 100
  ), null, { timeout: 20000 });
  await page.waitForTimeout(700);

  const point = async (selector, text = null) => page.evaluate(({ selector, text }) => {
    const candidates = [...document.querySelectorAll(selector)];
    const node = text == null
      ? candidates[0]
      : candidates.find((entry) => entry.textContent.trim().toLowerCase().includes(text.toLowerCase()));
    if (!node) return null;
    node.scrollIntoView({ block: 'nearest' });
    const bounds = node.getBoundingClientRect();
    return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
  }, { selector, text });
  const clickProjected = async (selector, text = null) => {
    const candidates = page.locator(selector);
    const control = text == null
      ? candidates.first()
      : candidates.filter({ hasText: text }).first();
    await control.waitFor({ state: 'visible', timeout: 12000 });
    await control.scrollIntoViewIfNeeded();
    const target = await point(selector, text);
    if (!target) throw new Error(`Projected control missing: ${selector} ${text || ''}`);
    await control.click({ timeout: 12000 });
    await page.waitForTimeout(280);
    return target;
  };

  await capture('00-physical-laptop-home');
  await clickProjected('.lt-navbtn', 'Pro Shop');
  await page.waitForFunction(() => [...document.querySelectorAll('.lt-navbtn.on')].some((entry) => (
    /pro shop/iu.test(entry.textContent || '')
  )), null, { timeout: 10000 });
  await page.waitForFunction(() => [...document.querySelectorAll('.lt-tab')].some((entry) => (
    /orders & suppliers/iu.test(entry.textContent || '')
  )), null, { timeout: 10000 });
  await clickProjected('.lt-tab', 'Orders & Suppliers');
  await capture('00b-pro-shop-orders-tab');
  const search = page.locator('.lt-input[placeholder*="Search products"]').first();
  await search.waitFor({ state: 'visible', timeout: 12000 });
  await search.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('Basic Chair');
  await page.waitForFunction(() => [...document.querySelectorAll('.lt-product')].some((card) => (
    card.querySelector('.lt-prodname')?.textContent.trim() === 'Basic Chair'
  )));
  const basicCard = page.locator('.lt-product').filter({ hasText: 'Basic Chair' }).first();
  const plus = basicCard.locator('.lt-qbtn').nth(1);
  await plus.waitFor({ state: 'visible', timeout: 12000 });
  await plus.click();
  await page.waitForTimeout(300);
  await capture('01-normal-supplier-basic-chair-basket');
  await clickProjected('.lt-primary', 'Place Order');
  await page.waitForFunction(() => document.querySelector('.lt-confirm'));
  await clickProjected('.lt-confirm .lt-primary', 'Place the order');
  await page.waitForFunction(() => window.__fw.state.shop.orders.some((order) => (
    order.lines?.some((line) => line.skuId === 'furn-chairs-basic' && line.quantity === 1)
  )));
  const purchase = await page.evaluate(() => {
    const order = window.__fw.state.shop.orders.find((entry) => (
      entry.lines?.some((line) => line.skuId === 'furn-chairs-basic')
    ));
    return {
      orderId: order?.id || null,
      state: order?.state || order?.status || null,
      line: order?.lines?.find((entry) => entry.skuId === 'furn-chairs-basic') || null,
      boxCount: order?.manifest?.boxCount || 0,
      charged: order?.charged === true,
    };
  });
  await capture('02-normal-supplier-chair-order-accepted');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__fw?.laptopOpen === false, null, { timeout: 10000 });

  const chairRows = [
    { tier: 'basic', skuId: 'furn-chairs-basic', x: -4.2, z: 0, normalControls: true },
    { tier: 'standard', skuId: 'furn-chairs-standard', x: -2.15, z: 0 },
    { tier: 'premium', skuId: 'furn-chairs-premium', x: 0, z: 0 },
    { tier: 'luxury', skuId: 'furn-chairs-luxury', x: 2.15, z: 0 },
    { tier: 'executive', skuId: 'furn-chairs-executive', x: 4.25, z: 0 },
  ];
  const basicInventorySeed = await page.evaluate(async (row) => {
    const app = window.__fw;
    const inventory = await import('/src/sim/propertyInventory.js');
    app.state.shop.inventory[row.skuId] = { shelf: 0, back: 1 };
    inventory.importLegacyStoredPlaceables(app.state, row.skuId, 1);
    const item = inventory.ownedPlaceableItem(app.state, row.skuId);
    return { skuId: row.skuId, stored: item?.stored || item?.quantity || 0 };
  }, chairRows.find((row) => row.normalControls));

  // Place Basic through the normal build-mode inventory and E controls.
  await localCamera({ at: [-4.2, 3.1], target: [-4.2, 0], targetY: 0.02, fov: 68 });
  await page.keyboard.press('b');
  await page.waitForFunction(() => window.__fw.scene3d.clubhouse().build.isActive());
  await page.keyboard.press('i');
  await page.waitForFunction(() => window.__fw.scene3d.clubhouse().build.isInventoryOpen());
  await page.keyboard.press('e');
  await page.waitForFunction(() => (
    window.__fw.scene3d.clubhouse().build.diagnostics().decorCarry?.skuId === 'furn-chairs-basic'
  ));
  const basicPlacementCandidates = [
    { at: [-4.2, 0.8], target: [-4.2, -2.3] },
    { at: [-1.8, 0.4], target: [-1.8, -2.7] },
    { at: [1.2, 0.3], target: [1.2, -2.8] },
    { at: [4.5, 0.6], target: [4.5, -2.5] },
    { at: [-4.2, 3.1], target: [-4.2, 0] },
  ];
  const basicPreviewAttempts = [];
  let basicPreview = null;
  for (const candidate of basicPlacementCandidates) {
    await localCamera({ ...candidate, targetY: 0.02, fov: 68 });
    const diagnostics = await page.evaluate(() => window.__fw.scene3d.clubhouse().build.diagnostics());
    basicPreviewAttempts.push({ candidate, validation: diagnostics.validation });
    if (diagnostics.validation.ok) {
      basicPreview = diagnostics;
      break;
    }
  }
  if (!basicPreview) {
    throw new Error(`Basic chair preview invalid at every open-floor target: ${JSON.stringify(basicPreviewAttempts)}`);
  }
  await page.keyboard.press('e');
  await page.waitForFunction(() => window.__fw.state.propertyInventory.placements.some((entry) => (
    entry.assetId === 'pro-shop-furniture:chairs:basic'
  )), null, { timeout: 15000 });
  await page.keyboard.press('b');
  await page.waitForFunction(() => !window.__fw.scene3d.clubhouse().build.isActive());

  const seededChairs = await page.evaluate(async (rows) => {
    const app = window.__fw;
    const inventory = await import('/src/sim/propertyInventory.js');
    const shop = await import('/src/sim/shop.js');
    const results = [];
    for (const row of rows.filter((entry) => !entry.normalControls)) {
      app.state.shop.inventory[row.skuId] = { shelf: 0, back: 1 };
      inventory.importLegacyStoredPlaceables(app.state, row.skuId, 1);
      const placed = shop.placeDecorFree(app.state, row.skuId, {
        area: 'clubhouse', mount: 'floor', x: row.x, y: 0, z: row.z,
        ry: 0, surfaceId: `chair-gameplay:${row.tier}`, authoredSpot: null,
      });
      results.push({ tier: row.tier, ok: placed.ok, reason: placed.reason || null });
    }
    app.scene3d.clubhouse().rebuildReno();
    return results;
  }, chairRows);
  if (seededChairs.some((entry) => !entry.ok)) {
    throw new Error(`Chair placement fixture failed: ${JSON.stringify(seededChairs)}`);
  }

  const deskRows = [
    { tier: 'basic', skuId: 'furn-office-desks-basic', x: -4.2, z: 1.2 },
    { tier: 'standard', skuId: 'furn-office-desks-standard', x: -2.15, z: 1.2 },
    { tier: 'premium', skuId: 'furn-office-desks-premium', x: 0, z: 1.2 },
  ];
  const seededDesks = await page.evaluate(async (rows) => {
    const app = window.__fw;
    const shop = await import('/src/sim/shop.js');
    const results = [];
    for (const row of rows) {
      app.state.shop.inventory[row.skuId] = { shelf: 0, back: 1 };
      const placed = shop.placeDecorFree(app.state, row.skuId, {
        area: 'clubhouse', mount: 'floor', x: row.x, y: 0, z: row.z,
        ry: 0, surfaceId: `chair-desk-gameplay:${row.tier}`, authoredSpot: null,
      });
      results.push({ tier: row.tier, ok: placed.ok, reason: placed.reason || null });
    }
    app.scene3d.clubhouse().rebuildReno();
    return results;
  }, deskRows);
  if (seededDesks.some((entry) => !entry.ok)) {
    throw new Error(`Desk pairing fixture failed: ${JSON.stringify(seededDesks)}`);
  }

  const expectedFurnitureRoots = [
    ...['basic', 'standard', 'premium', 'luxury', 'executive']
      .map((tier) => `PropertyFurniture_furn-chairs-${tier}`),
    ...['basic', 'standard', 'premium']
      .map((tier) => `PropertyFurniture_furn-office-desks-${tier}`),
  ];
  const furnitureStatus = async () => page.evaluate((expectedNames) => {
    const byName = Object.fromEntries(expectedNames.map((name) => [name, []]));
    window.__fw.scene3d.scene.traverse((object) => {
      if (byName[object.name] && object.userData.disposed !== true) {
        byName[object.name].push({
          loaded: object.userData.loaded === true,
          loadError: object.userData.loadError || null,
        });
      }
    });
    return Object.fromEntries(Object.entries(byName).map(([name, roots]) => [name, {
      activeCount: roots.length,
      loadedCount: roots.filter((root) => root.loaded).length,
      loadErrors: roots.map((root) => root.loadError).filter(Boolean),
    }]));
  }, expectedFurnitureRoots);
  const waitForFurniture = async () => {
    try {
      await page.waitForFunction((expectedNames) => {
        const ready = new Set();
        window.__fw.scene3d.scene.traverse((object) => {
          if (expectedNames.includes(object.name)
              && object.userData.disposed !== true
              && object.userData.loaded === true
              && !object.userData.loadError) ready.add(object.name);
        });
        return expectedNames.every((name) => ready.has(name));
      }, expectedFurnitureRoots, { timeout: 180000 });
    } catch (error) {
      throw new Error(`Furniture visuals did not become ready: ${JSON.stringify(await furnitureStatus())}`, {
        cause: error,
      });
    }
    await page.evaluate(async () => {
      const roots = [];
      window.__fw.scene3d.scene.traverse((object) => {
        if (/^PropertyFurniture_furn-(?:chairs|office-desks)-/.test(object.name || '')
            && object.userData.disposed !== true) roots.push(object);
      });
      await Promise.all(roots.map((root) => root.userData.ready));
    });
    return furnitureStatus();
  };
  const furnitureLoadChecks = [{ phase: 'initial-placement', roots: await waitForFurniture() }];

  // Align each office chair's exported desk datum to its matching desk datum,
  // then rebuild through the same property-furniture renderer used by saves.
  const alignmentMoves = await page.evaluate(async () => {
    const app = window.__fw;
    const shop = await import('/src/sim/shop.js');
    const THREE = await import('three');
    const moves = [];
    for (const tier of ['basic', 'standard', 'premium']) {
      let chairRoot = null;
      let deskRoot = null;
      app.scene3d.scene.traverse((object) => {
        if (object.name === `PropertyFurniture_furn-chairs-${tier}`) chairRoot = object;
        if (object.name === `PropertyFurniture_furn-office-desks-${tier}`) deskRoot = object;
      });
      const chairNode = chairRoot?.userData.functionalNodes?.deskAlignmentAnchor;
      const deskNode = deskRoot?.userData.functionalNodes?.chairAnchor;
      const placement = app.state.propertyInventory.placements.find((entry) => (
        entry.assetId === `pro-shop-furniture:chairs:${tier}`
      ));
      if (!chairNode || !deskNode || !placement) {
        moves.push({ tier, ok: false, reason: 'alignment-node-or-placement-missing' });
        continue;
      }
      const chairPoint = chairNode.getWorldPosition(new THREE.Vector3());
      const deskPoint = deskNode.getWorldPosition(new THREE.Vector3());
      const pose = {
        ...placement.pose,
        x: placement.pose.x + deskPoint.x - chairPoint.x,
        z: placement.pose.z + deskPoint.z - chairPoint.z,
      };
      const moved = shop.moveDecorPlacement(app.state, placement.id, pose);
      moves.push({ tier, ok: moved.ok, delta: deskPoint.distanceTo(chairPoint), pose });
    }
    app.scene3d.clubhouse().rebuildReno();
    return moves;
  });
  if (alignmentMoves.some((entry) => !entry.ok)) {
    throw new Error(`Desk alignment failed: ${JSON.stringify(alignmentMoves)}`);
  }
  furnitureLoadChecks.push({ phase: 'desk-alignment-rebuild', roots: await waitForFurniture() });

  const runtime = await page.evaluate(async () => {
    const THREE = await import('three');
    const app = window.__fw;
    const chairs = [];
    for (const tier of ['basic', 'standard', 'premium', 'luxury', 'executive']) {
      let root = null;
      app.scene3d.scene.traverse((object) => {
        if (object.name === `PropertyFurniture_furn-chairs-${tier}`) root = object;
      });
      const nodes = root?.userData.functionalNodes;
      chairs.push({
        tier,
        loaded: root?.userData.loaded === true,
        loadError: root?.userData.loadError || null,
        lodLevels: root?.userData.authoredLod?.levels?.length || 0,
        lodSelections: [0, 10, 25].map((distance) => (
          root?.userData.authoredLod?.levels?.findIndex((level) => (
            level.object === root.userData.authoredLod.getObjectForDistance(distance)
          )) ?? -1
        )),
        seatAnchor: nodes?.seatAnchor?.name || null,
        entryPoints: nodes?.entryPoints?.length || 0,
        exitPoints: nodes?.exitPoints?.length || 0,
        casterPivots: nodes?.casterPivots?.length || 0,
        heightPivot: !!nodes?.heightAdjustmentPivot,
        swivelPivot: !!nodes?.swivelPivot,
        reclinePivot: !!nodes?.backrestTiltPivot,
        animationClips: [...(root?.userData.animations || [])],
      });
    }
    const deskAlignment = [];
    for (const tier of ['basic', 'standard', 'premium']) {
      let chairRoot = null;
      let deskRoot = null;
      app.scene3d.scene.traverse((object) => {
        if (object.name === `PropertyFurniture_furn-chairs-${tier}`) chairRoot = object;
        if (object.name === `PropertyFurniture_furn-office-desks-${tier}`) deskRoot = object;
      });
      const chairNode = chairRoot?.userData.functionalNodes?.deskAlignmentAnchor;
      const deskNode = deskRoot?.userData.functionalNodes?.chairAnchor;
      const chairPoint = chairNode?.getWorldPosition(new THREE.Vector3());
      const deskPoint = deskNode?.getWorldPosition(new THREE.Vector3());
      deskAlignment.push({
        tier,
        distance: chairPoint && deskPoint ? chairPoint.distanceTo(deskPoint) : null,
        chair: chairPoint?.toArray() || null,
        desk: deskPoint?.toArray() || null,
      });
    }
    return { chairs, deskAlignment };
  });

  await localCamera({ at: [0, 6.4], target: [0, 0.45], targetY: 0.82, fov: 72 });
  await capture('03-five-chairs-three-desk-pairs-front');
  await localCamera({ at: [6.0, 5.2], target: [0, 0.35], targetY: 0.80, fov: 70 });
  await capture('04-five-chairs-three-desk-pairs-three-quarter');
  await localCamera({ at: [-5.4, 3.2], target: [-2.5, 0.25], targetY: 0.70, fov: 64 });
  await capture('05-player-eye-office-chair-detail');
  await localCamera({ at: [5.8, 3.6], target: [3.25, 0], targetY: 0.62, fov: 62 });
  await capture('06-player-eye-club-chair-detail');

  const collisionSample = async (tier, approach) => {
    const start = await page.evaluate(async ({ tierId, approachSide }) => {
      const app = window.__fw;
      const THREE = await import('three');
      let root = null;
      app.scene3d.scene.traverse((object) => {
        if (object.name === `PropertyFurniture_furn-chairs-${tierId}`) root = object;
      });
      if (!root) throw new Error(`Chair root missing for collision: ${tierId}`);
      const bounds = new THREE.Box3().setFromObject(root);
      const center = bounds.getCenter(new THREE.Vector3());
      const walk = app.scene3d.walk;
      walk.clearKeys();
      walk.clearFocus?.();
      walk.state.x = center.x;
      if (approachSide === 'back') {
        walk.state.z = bounds.min.z - 0.72;
        walk.state.yaw = Math.PI;
      } else {
        walk.state.z = bounds.max.z + 0.72;
        walk.state.yaw = 0;
      }
      walk.state.pitch = 0;
      return {
        x: walk.state.x, z: walk.state.z,
        bounds: { minZ: bounds.min.z, maxZ: bounds.max.z },
      };
    }, { tierId: tier, approachSide: approach });
    await page.keyboard.down('w');
    await page.waitForTimeout(1050);
    await page.keyboard.up('w');
    const end = await page.evaluate(() => ({
      x: window.__fw.scene3d.walk.state.x,
      z: window.__fw.scene3d.walk.state.z,
    }));
    return { tier, approach, start, end, distance: Math.hypot(end.x - start.x, end.z - start.z) };
  };
  const collisions = [
    await collisionSample('premium', 'back'),
    await collisionSample('luxury', 'front'),
  ];

  const beforeSave = await page.evaluate(() => ({
    chairs: window.__fw.state.propertyInventory.placements
      .filter((entry) => entry.assetId.startsWith('pro-shop-furniture:chairs:'))
      .map((entry) => ({ assetId: entry.assetId, pose: { ...entry.pose } }))
      .sort((a, b) => a.assetId.localeCompare(b.assetId)),
    desks: window.__fw.state.propertyInventory.placements
      .filter((entry) => entry.assetId.startsWith('pro-shop-furniture:office-desks:'))
      .map((entry) => ({ assetId: entry.assetId, pose: { ...entry.pose } }))
      .sort((a, b) => a.assetId.localeCompare(b.assetId)),
    order: window.__fw.state.shop.orders.find((entry) => (
      entry.lines?.some((line) => line.skuId === 'furn-chairs-basic')
    ))?.id || null,
  }));
  await page.evaluate(async () => { await window.__fw.autosave(); });
  intentionalNavigation = true;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByText('Continue', { exact: true }).click();
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
  furnitureLoadChecks.push({ phase: 'autosave-reload', roots: await waitForFurniture() });
  intentionalNavigation = false;
  await clearPresentation();
  const afterSave = await page.evaluate(() => ({
    chairs: window.__fw.state.propertyInventory.placements
      .filter((entry) => entry.assetId.startsWith('pro-shop-furniture:chairs:'))
      .map((entry) => ({ assetId: entry.assetId, pose: { ...entry.pose } }))
      .sort((a, b) => a.assetId.localeCompare(b.assetId)),
    desks: window.__fw.state.propertyInventory.placements
      .filter((entry) => entry.assetId.startsWith('pro-shop-furniture:office-desks:'))
      .map((entry) => ({ assetId: entry.assetId, pose: { ...entry.pose } }))
      .sort((a, b) => a.assetId.localeCompare(b.assetId)),
    order: window.__fw.state.shop.orders.find((entry) => (
      entry.lines?.some((line) => line.skuId === 'furn-chairs-basic')
    ))?.id || null,
  }));
  await localCamera({ at: [6.0, 5.2], target: [0, 0.35], targetY: 0.80, fov: 70 });
  await capture('07-after-autosave-reload');

  const acceptance = {
    normalMovementWorked: normalMove.distance > 0.05,
    normalSupplierPurchaseWorked: purchase.orderId != null
      && purchase.line?.skuId === 'furn-chairs-basic'
      && purchase.line?.quantity === 1
      && purchase.boxCount >= 1,
    normalBuildPlacementWorked: basicPreview.validation.ok === true
      && beforeSave.chairs.some((entry) => entry.assetId === 'pro-shop-furniture:chairs:basic'),
    allFiveChairsPlaced: beforeSave.chairs.length === 5,
    threeDesksPlaced: beforeSave.desks.length === 3,
    everyChairLoaded: runtime.chairs.length === 5
      && runtime.chairs.every((chair) => chair.loaded && !chair.loadError),
    everyChairUsesThreeLods: runtime.chairs.every((chair) => (
      chair.lodLevels === 3 && JSON.stringify(chair.lodSelections) === JSON.stringify([0, 1, 2])
    )),
    seatingAnchorsAvailable: runtime.chairs.every((chair) => (
      chair.seatAnchor === 'SEAT_ANCHOR' && chair.entryPoints === 2 && chair.exitPoints === 2
    )),
    officeMechanismsAvailable: runtime.chairs.slice(0, 3).every((chair) => (
      chair.casterPivots === 5 && chair.heightPivot && chair.swivelPivot
    )) && runtime.chairs.filter((chair) => ['standard', 'premium'].includes(chair.tier))
      .every((chair) => chair.reclinePivot),
    officeDeskAnchorsAligned: runtime.deskAlignment.every((entry) => (
      Number.isFinite(entry.distance) && entry.distance <= 0.015
    )),
    analyticCollisionsStoppedPlayer: collisions.every((entry) => (
      entry.distance > 0.05 && entry.distance < 0.65
    )),
    saveReloadPreserved: JSON.stringify(beforeSave) === JSON.stringify(afterSave),
    consoleClean: diagnostics.consoleErrors.length === 0
      && diagnostics.pageErrors.length === 0
      && diagnostics.failedRequests.length === 0,
  };
  const result = {
    ok: Object.values(acceptance).every(Boolean),
    capturedAt: new Date().toISOString(),
    cleanRoom,
    normalMove,
    purchase,
    basicInventorySeed,
    seededChairs,
    basicPreview: {
      validation: basicPreview.validation,
      decorCarry: basicPreview.decorCarry,
      attempts: basicPreviewAttempts,
    },
    seededDesks,
    alignmentMoves,
    runtime,
    collisions,
    saveReload: { before: beforeSave, after: afterSave },
    screenshots,
    furnitureLoadChecks,
    diagnostics,
    acceptance,
  };
  fs.writeFileSync(path.join(outDir, 'gameplay-report.json'), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}
