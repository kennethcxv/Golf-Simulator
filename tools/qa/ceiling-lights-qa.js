async (page) => {
  const BASE = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const ITERATION = Number(process.env.QA_ITERATION || 1);
  const OUT = process.env.QA_OUT_DIR || `qa/ceiling-lights/iteration-${ITERATION}`;
  const diagnostics = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      diagnostics.push(`console:${message.type()}: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => diagnostics.push(`pageerror:${error.message}`));
  page.on('requestfailed', (request) => {
    diagnostics.push(`requestfailed:${request.url()}:${request.failure()?.errorText || 'unknown'}`);
  });

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(BASE);
  await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 45000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
  }, null, { timeout: 45000 });
  await page.evaluate(() => {
    const clubhouse = window.__fw.scene3d.clubhouse();
    clubhouse.setOrganicWalkins(false);
    clubhouse.clearWalkins();
  });
  await page.waitForTimeout(1800);

  async function setPose({ at, target, targetY = 2.8, minute = 840 }) {
    await page.evaluate(({ at, target, targetY, minute }) => {
      const app = window.__fw;
      const clubhouse = app.scene3d.clubhouse();
      const interior = clubhouse.interior.position;
      const walk = app.scene3d.walk.state;
      app.scene3d.walk.clearKeys();
      app.scene3d.walk.setSpraying(false);
      const day = Math.floor(app.state.clock.minutes / 1440);
      app.state.clock.minutes = day * 1440 + minute;
      app.scene3d.applyTimeWeather(minute, app.state.weather);
      walk.x = interior.x + at[0];
      walk.z = interior.z + at[1];
      const dx = target[0] - at[0];
      const dz = target[1] - at[1];
      const horizontal = Math.hypot(dx, dz) || 0.001;
      walk.yaw = Math.atan2(-dx / horizontal, -dz / horizontal);
      walk.pitch = Math.atan2(targetY - (walk.eye || 1.62), horizontal);
    }, { at, target, targetY, minute });
    await page.waitForTimeout(650);
  }

  const shots = [];
  async function shot(id, pose = null) {
    if (pose) await setPose(pose);
    await page.evaluate(async () => {
      const ui = await import('/src/ui/ui.js');
      ui.clearNotifications();
    });
    await page.locator('#game').click({ position: { x: 800, y: 450 } }).catch(() => {});
    await page.waitForTimeout(250);
    const path = `${OUT}/${id}.png`;
    await page.screenshot({ path, timeout: 60000 });
    shots.push(path);
  }

  // Begin from physical property storage, then use the normal player keys to
  // enter build mode, select the one stored fixture, rotate it, and place it.
  await page.evaluate(async () => {
    const app = window.__fw;
    const inventory = await import('/src/sim/propertyInventory.js');
    app.state.tutorial.complete = true;
    app.state.tutorial.hidden = true;
    app.state.campaign.enabled = false;
    app.state.shop.progression.tier = 'premium';
    app.state.shop.unlockedTier = 3;
    app.state.shop.orders = [];
    const id = 'ceiling-light-basic';
    app.state.shop.inventory[id].back = 1;
    inventory.importLegacyStoredPlaceables(app.state, id, 1);
  });
  await setPose({ at: [-8, -1], target: [-8, -4], targetY: 1.62, minute: 840 });
  await page.keyboard.press('b');
  await page.waitForFunction(() => window.__fw.scene3d.clubhouse().build.isActive());
  await page.keyboard.press('i');
  await page.waitForFunction(() => window.__fw.scene3d.clubhouse().build.isInventoryOpen());
  await page.keyboard.press('e');
  await page.waitForFunction(() => !!window.__fw.scene3d.clubhouse().build.diagnostics().decorCarry);
  const beforeRotation = await page.evaluate(() => window.__fw.scene3d.clubhouse().build.diagnostics().decorCarry.ry);
  await page.keyboard.press('r');
  await page.waitForTimeout(250);
  const afterRotation = await page.evaluate(() => window.__fw.scene3d.clubhouse().build.diagnostics().decorCarry.ry);
  await shot('00-normal-controls-placement-ghost', {
    at: [-8, -1], target: [-8, -4], targetY: 2.92, minute: 840,
  });
  await page.keyboard.press('e');
  await page.waitForFunction(() => !window.__fw.scene3d.clubhouse().build.diagnostics().decorCarry);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !window.__fw.scene3d.clubhouse().build.isActive());

  // The remaining fixtures are deterministic visual-fixture setup. Their real
  // ownership/placement functions are still used; only the repetitive supplier
  // delivery preamble is skipped for this comparison room.
  await page.evaluate(async () => {
    const app = window.__fw;
    const inventory = await import('/src/sim/propertyInventory.js');
    const shop = await import('/src/sim/shop.js');
    const protectorId = 'furn-tables-premium';
    app.state.shop.inventory[protectorId].back = 1;
    inventory.importLegacyStoredPlaceables(app.state, protectorId, 1);
    const protector = shop.placeDecorFree(app.state, protectorId, {
      area: 'clubhouse', mount: 'floor', x: -7.0, y: 0, z: -2.0, ry: 0,
      surfaceId: 'clubhouse:floor', authoredSpot: null,
    });
    if (!protector.ok) throw new Error(`QA protector placement failed: ${protector.reason}`);
    const rows = [
      ['ceiling-light-standard', -5.75, -4.0, 0],
      ['ceiling-light-premium', -3.75, -4.0, 0],
      ['ceiling-light-premium-single', -2.55, -4.0, 0],
      ['ceiling-light-high-end', -0.8, -4.0, 0],
      ['ceiling-light-luxury', -7.0, -2.0, 0],
    ];
    for (const [skuId, x, z, ry] of rows) {
      app.state.shop.inventory[skuId].back = 1;
      inventory.importLegacyStoredPlaceables(app.state, skuId, 1);
      const placed = shop.placeDecorFree(app.state, skuId, {
        area: 'clubhouse', mount: 'ceiling', x, y: 0, z, ry,
        surfaceId: 'clubhouse:ceiling', authoredSpot: null,
      });
      if (!placed.ok) throw new Error(`QA place failed for ${skuId}: ${placed.reason}`);
    }
  });
  await page.waitForFunction(() => {
    const rows = window.__fw.scene3d.clubhouse().propertyFurnitureDiagnostics();
    const protector = rows.find((row) => row.skuId === 'furn-tables-premium');
    return protector?.loaded === true
      && rows.filter((row) => row.skuId?.startsWith('ceiling-light-')).length >= 6
      && rows.filter((row) => row.skuId?.startsWith('ceiling-light-')).every((row) => row.loaded || row.loadError);
  }, null, { timeout: 45000 });
  await page.waitForTimeout(1800);

  const placementResult = await page.evaluate(({ beforeRotation, afterRotation }) => {
    const placements = window.__fw.state.shop.reno.decor
      .filter((entry) => entry.skuId?.startsWith('ceiling-light-'));
    return {
      normalControlPath: ['B', 'I', 'E', 'R', 'E', 'Escape'],
      beforeRotation,
      afterRotation,
      rotationChanged: Math.abs(afterRotation - beforeRotation) > 0.01,
      placedCount: placements.length,
    };
  }, { beforeRotation, afterRotation });

  await shot('01-progression-entry-day', {
    at: [-3.4, 4.8], target: [-4.0, -3.2], targetY: 2.85, minute: 840,
  });
  await shot('02-progression-west-day', {
    at: [-9.2, -0.6], target: [-3.8, -3.8], targetY: 2.85, minute: 840,
  });
  await shot('02a-basic-standard-player-day', {
    at: [-7.0, -5.8], target: [-6.85, -4.0], targetY: 2.82, minute: 840,
  });
  await shot('02b-premium-set-player-day', {
    at: [-5.0, -2.0], target: [-3.35, -4.0], targetY: 2.88, minute: 840,
  });
  await shot('02c-premium-flush-close-day', {
    at: [-3.75, -3.03], target: [-3.75, -4.0], targetY: 3.12, minute: 840,
  });
  await shot('02d-premium-flush-grazing-day', {
    at: [-4.62, -3.45], target: [-3.75, -4.0], targetY: 2.99, minute: 840,
  });
  await shot('03-luxury-player-day', {
    at: [-7.0, 1.15], target: [-7.0, -2.0], targetY: 2.45, minute: 840,
  });
  await shot('03a-luxury-protected-clearance-day', {
    at: [-7.0, 1.15], target: [-7.0, -2.0], targetY: 1.48, minute: 840,
  });
  await shot('04-high-end-player-day', {
    at: [-0.8, -1.1], target: [-0.8, -4.0], targetY: 2.78, minute: 840,
  });
  await shot('05-progression-entry-night', {
    at: [-3.4, 4.8], target: [-4.0, -3.2], targetY: 2.85, minute: 1260,
  });
  await page.evaluate(() => {
    window.__fw.scene3d.scene.traverse((object) => {
      const controller = object.userData?.ceilingLightController;
      if (!controller) return;
      const premium = /ceiling-light-premium/i.test(object.name || '');
      controller.setOn(premium, { notify: false });
    });
  });
  await page.waitForTimeout(350);
  await shot('05a-premium-floor-wash-night', {
    at: [-3.35, -1.55], target: [-3.75, -4.0], targetY: 0.18, minute: 1260,
  });
  await shot('05b-premium-isolated-ceiling-night', {
    at: [-4.62, -3.45], target: [-3.75, -4.0], targetY: 2.99, minute: 1260,
  });
  await page.evaluate(() => {
    window.__fw.scene3d.scene.traverse((object) => {
      object.userData?.ceilingLightController?.setOn(true, { notify: false });
    });
  });
  await page.waitForTimeout(350);

  async function promptText() {
    return page.evaluate(() => document.querySelector('.shop-overlay .shop-prompt')?.textContent || '');
  }

  async function resumeLooking() {
    await page.locator('#game').click({ position: { x: 800, y: 450 } });
    await page.waitForFunction(() => !/click to resume looking/i.test(
      document.querySelector('.shop-overlay .shop-prompt')?.textContent || '',
    ));
    await page.waitForTimeout(250);
  }

  // Player-facing E interaction: select the Standard control from below, turn
  // it off, capture the result, then turn it back on.
  await setPose({ at: [-5.75, -2.25], target: [-5.75, -4.0], targetY: 3.02, minute: 1260 });
  await resumeLooking();
  await page.waitForFunction(() => /Standard Square Panel Light.*switch off/i.test(
    document.querySelector('.shop-overlay .shop-prompt')?.textContent || '',
  ), null, { timeout: 10000 });
  const powerPrompt = await promptText();
  await page.keyboard.press('e');
  await page.waitForFunction(() => {
    const placements = window.__fw.state.propertyInventory?.placements || [];
    const item = window.__fw.state.propertyInventory?.items?.find((entry) => entry.skuId === 'ceiling-light-standard');
    return placements.find((entry) => entry.itemId === item?.id)?.lightState?.isOn === false;
  });
  await shot('06-standard-switched-off-night');
  await page.keyboard.press('e');
  await page.waitForFunction(() => {
    const placements = window.__fw.state.propertyInventory?.placements || [];
    const item = window.__fw.state.propertyInventory?.items?.find((entry) => entry.skuId === 'ceiling-light-standard');
    return placements.find((entry) => entry.itemId === item?.id)?.lightState?.isOn === true;
  });

  // Aim one track head through its normal world interaction.
  await setPose({ at: [-1.27, -2.35], target: [-1.27, -4.0], targetY: 2.72, minute: 1260 });
  await resumeLooking();
  await page.waitForFunction(() => /spotlight 1.*change aim/i.test(
    document.querySelector('.shop-overlay .shop-prompt')?.textContent || '',
  ), null, { timeout: 10000 });
  const aimPrompt = await promptText();
  const aimBefore = await page.evaluate(() => {
    const inventory = window.__fw.state.propertyInventory;
    const item = inventory.items.find((entry) => entry.skuId === 'ceiling-light-high-end');
    return { ...inventory.placements.find((entry) => entry.itemId === item.id).lightState.spotlights[0] };
  });
  const aimDirectionBefore = await page.evaluate(() => {
    const row = window.__fw.scene3d.clubhouse().propertyFurnitureDiagnostics()
      .find((entry) => entry.skuId === 'ceiling-light-high-end');
    return { ...row.lighting.lightDirections[0] };
  });
  await shot('07-high-end-head-straight-night');
  await page.keyboard.press('e');
  await page.waitForFunction((before) => {
    const inventory = window.__fw.state.propertyInventory;
    const item = inventory.items.find((entry) => entry.skuId === 'ceiling-light-high-end');
    const aim = inventory.placements.find((entry) => entry.itemId === item.id).lightState.spotlights[0];
    return Math.abs(aim.yaw - before.yaw) > 0.01 || Math.abs(aim.tilt - before.tilt) > 0.01;
  }, aimBefore);
  await page.waitForFunction(() => {
    const row = window.__fw.scene3d.clubhouse().propertyFurnitureDiagnostics()
      .find((entry) => entry.skuId === 'ceiling-light-high-end');
    const head = row?.lighting?.spotlights?.[0];
    return head && Math.abs(head.displayedYaw - head.yaw) < 0.005
      && Math.abs(head.displayedTilt - head.tilt) < 0.005;
  });
  await shot('08-high-end-head-aimed-night');
  const aimDirectionAfter = await page.evaluate(() => {
    const row = window.__fw.scene3d.clubhouse().propertyFurnitureDiagnostics()
      .find((entry) => entry.skuId === 'ceiling-light-high-end');
    return { ...row.lighting.lightDirections[0] };
  });
  const aimDirectionCheck = {
    before: aimDirectionBefore,
    after: aimDirectionAfter,
    changedBy: Math.hypot(
      aimDirectionAfter.x - aimDirectionBefore.x,
      aimDirectionAfter.y - aimDirectionBefore.y,
      aimDirectionAfter.z - aimDirectionBefore.z,
    ),
  };
  aimDirectionCheck.passed = aimDirectionCheck.changedBy > 0.05
    && aimDirectionAfter.targetBoundToLamp === true
    && aimDirectionAfter.y < -0.5;
  await page.evaluate(() => {
    window.__fw.scene3d.scene.traverse((object) => {
      const controller = object.userData?.ceilingLightController;
      if (!controller) return;
      controller.setOn(/ceiling-light-high-end/i.test(object.name || ''), { notify: false });
    });
  });
  await page.waitForTimeout(350);
  await shot('08a-high-end-aimed-floor-night', {
    at: [-0.25, -1.75], target: [-1.25, -4.15], targetY: 0.22, minute: 1260,
  });
  await page.evaluate(() => {
    window.__fw.scene3d.scene.traverse((object) => {
      object.userData?.ceilingLightController?.setOn(true, { notify: false });
    });
  });
  await page.waitForTimeout(350);

  // The same fixture-local switch state is gated by the global restoration
  // circuit. Use the production restoration mutation, then verify every placed
  // fixture reports requested-on but effective-off.
  await page.evaluate(async () => {
    const app = window.__fw;
    const restoration = await import('/src/sim/clubhouseRestoration.js');
    app.state.campaign.enabled = true;
    restoration.setCeilingRestored(app.state, false);
  });
  await page.waitForFunction(() => {
    const rows = window.__fw.scene3d.clubhouse().propertyFurnitureDiagnostics()
      .filter((row) => row.skuId?.startsWith('ceiling-light-'));
    return rows.length >= 6 && rows.every((row) => row.lighting && !row.lighting.effectiveOn)
      && !window.__fw.scene3d.clubhouse().ceilingLightingDiagnostics().circuitPowered;
  });
  await shot('09-global-ceiling-circuit-off-night', {
    at: [-3.4, 4.8], target: [-4.0, -3.2], targetY: 2.85, minute: 1260,
  });
  await page.evaluate(async () => {
    const app = window.__fw;
    const restoration = await import('/src/sim/clubhouseRestoration.js');
    restoration.setCeilingRestored(app.state, true);
  });
  await page.waitForFunction(() => {
    const rows = window.__fw.scene3d.clubhouse().propertyFurnitureDiagnostics()
      .filter((row) => row.skuId?.startsWith('ceiling-light-'));
    return rows.length >= 6 && rows.every((row) => row.lighting?.effectiveOn)
      && window.__fw.scene3d.clubhouse().ceilingLightingDiagnostics().circuitPowered;
  });
  await shot('10-global-ceiling-circuit-restored-night', {
    at: [-3.4, 4.8], target: [-4.0, -3.2], targetY: 2.85, minute: 1260,
  });

  // Exercise the shared switch path on every fixture through the real first-
  // person prompt. Each switch must persist off and back on independently.
  const switchCases = [
    { skuId: 'ceiling-light-basic', name: 'Basic Suspended Linear Light', at: [-8.0, -2.25], target: [-8.0, -4.0], targetY: 2.76 },
    { skuId: 'ceiling-light-standard', name: 'Standard Square Panel Light', at: [-5.75, -2.25], target: [-5.75, -4.0], targetY: 2.93 },
    { skuId: 'ceiling-light-premium', name: 'Premium Recessed Spotlight Trio', at: [-3.75, -2.25], target: [-3.75, -4.0], targetY: 2.94 },
    { skuId: 'ceiling-light-premium-single', name: 'Premium Recessed Spotlight', at: [-2.55, -2.25], target: [-2.55, -4.0], targetY: 2.94 },
    { skuId: 'ceiling-light-high-end', name: 'High-End Adjustable Track Light', at: [-0.8, -2.25], target: [-0.8, -4.0], targetY: 3.18 },
    { skuId: 'ceiling-light-luxury', name: 'Luxury Brass Crystal Chandelier', at: [-7.0, -0.25], target: [-7.0, -2.0], targetY: 2.44 },
  ];
  const individualPowerChecks = [];
  for (const fixture of switchCases) {
    await setPose({ at: fixture.at, target: fixture.target, targetY: fixture.targetY, minute: 1260 });
    await resumeLooking();
    await page.waitForFunction(({ name }) => {
      const prompt = document.querySelector('.shop-overlay .shop-prompt')?.textContent || '';
      return prompt.includes(name) && /switch off/i.test(prompt);
    }, { name: fixture.name });
    const offPrompt = await promptText();
    await page.keyboard.press('e');
    await page.waitForFunction(({ skuId }) => {
      const inventory = window.__fw.state.propertyInventory;
      const item = inventory.items.find((entry) => entry.skuId === skuId);
      return inventory.placements.find((entry) => entry.itemId === item?.id)?.lightState?.isOn === false;
    }, { skuId: fixture.skuId });
    await page.waitForFunction(({ name }) => {
      const prompt = document.querySelector('.shop-overlay .shop-prompt')?.textContent || '';
      return prompt.includes(name) && /switch on/i.test(prompt);
    }, { name: fixture.name });
    const onPrompt = await promptText();
    await page.keyboard.press('e');
    await page.waitForFunction(({ skuId }) => {
      const inventory = window.__fw.state.propertyInventory;
      const item = inventory.items.find((entry) => entry.skuId === skuId);
      return inventory.placements.find((entry) => entry.itemId === item?.id)?.lightState?.isOn === true;
    }, { skuId: fixture.skuId });
    individualPowerChecks.push({ skuId: fixture.skuId, offPrompt, onPrompt, passed: true });
  }

  let lodSweep = { required: ITERATION >= 4, passed: ITERATION < 4 };
  let saveReload = { required: ITERATION >= 4, passed: ITERATION < 4 };
  if (ITERATION >= 4) {
    const selectedLods = () => page.evaluate(() => Object.fromEntries(
      window.__fw.scene3d.clubhouse().propertyFurnitureDiagnostics()
        .filter((row) => row.skuId?.startsWith('ceiling-light-'))
        .map((row) => [row.skuId, row.lodLevels.find((level) => level.visible)?.name || null]),
    ));
    await setPose({ at: [9.8, 6.1], target: [-4.5, -3.5], targetY: 2.8, minute: 1260 });
    await page.waitForTimeout(750);
    const far = await selectedLods();
    await setPose({ at: [-3.4, 4.8], target: [-4.0, -3.2], targetY: 2.85, minute: 1260 });
    await page.waitForTimeout(750);
    const mid = await selectedLods();
    await setPose({ at: [-0.8, -1.2], target: [-0.8, -4.0], targetY: 2.8, minute: 1260 });
    await page.waitForTimeout(750);
    const near = await selectedLods();
    lodSweep = {
      required: true,
      far,
      mid,
      near,
      sawLod2: Object.values(far).some((name) => /_LOD2$/.test(name || '')),
      sawLod1: Object.values(mid).some((name) => /_LOD1$/.test(name || '')),
      sawLod0: /_LOD0$/.test(near['ceiling-light-high-end'] || ''),
    };
    lodSweep.passed = lodSweep.sawLod0 && lodSweep.sawLod1 && lodSweep.sawLod2;

    // Persist a visibly off fixture and the articulated head aim through the
    // production autosave, a complete document reload, and Continue.
    await setPose({ at: [-5.75, -2.25], target: [-5.75, -4.0], targetY: 2.93, minute: 1260 });
    await resumeLooking();
    await page.waitForFunction(() => /Standard Square Panel Light.*switch off/i.test(
      document.querySelector('.shop-overlay .shop-prompt')?.textContent || '',
    ));
    await page.keyboard.press('e');
    await page.waitForFunction(() => {
      const inventory = window.__fw.state.propertyInventory;
      const item = inventory.items.find((entry) => entry.skuId === 'ceiling-light-standard');
      return inventory.placements.find((entry) => entry.itemId === item?.id)?.lightState?.isOn === false;
    });
    const beforeSave = await page.evaluate(async () => {
      const app = window.__fw;
      const digest = () => {
        const inventory = app.state.propertyInventory;
        const skuByItem = new Map(inventory.items.map((item) => [item.id, item.skuId]));
        return inventory.placements
          .map((placement) => ({ skuId: skuByItem.get(placement.itemId), lightState: placement.lightState }))
          .filter((entry) => entry.skuId?.startsWith('ceiling-light-'))
          .sort((left, right) => left.skuId.localeCompare(right.skuId));
      };
      await app.autosave();
      return {
        digest: digest(),
        rawBytes: localStorage.getItem('golfempire:autosave')?.length || 0,
      };
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`)).clickThroughMenu(page);
    await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 45000 });
    await page.waitForFunction(() => {
      const veil = document.querySelector('.load-veil');
      return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
    }, null, { timeout: 45000 });
    await page.waitForFunction(() => {
      const rows = window.__fw.scene3d.clubhouse().propertyFurnitureDiagnostics();
      return rows.filter((row) => row.skuId?.startsWith('ceiling-light-')).length === 6
        && rows.filter((row) => row.skuId?.startsWith('ceiling-light-')).every((row) => row.loaded);
    }, null, { timeout: 45000 });
    const afterLoad = await page.evaluate(() => {
      const app = window.__fw;
      const inventory = app.state.propertyInventory;
      const skuByItem = new Map(inventory.items.map((item) => [item.id, item.skuId]));
      return inventory.placements
        .map((placement) => ({ skuId: skuByItem.get(placement.itemId), lightState: placement.lightState }))
        .filter((entry) => entry.skuId?.startsWith('ceiling-light-'))
        .sort((left, right) => left.skuId.localeCompare(right.skuId));
    });
    const standardAfterLoad = afterLoad.find((entry) => entry.skuId === 'ceiling-light-standard');
    const highEndBefore = beforeSave.digest.find((entry) => entry.skuId === 'ceiling-light-high-end');
    const highEndAfter = afterLoad.find((entry) => entry.skuId === 'ceiling-light-high-end');
    await shot('11-autosave-reload-standard-off-night', {
      at: [-5.75, -2.25], target: [-5.75, -4.0], targetY: 2.93, minute: 1260,
    });
    await page.waitForFunction(() => /Standard Square Panel Light.*switch on/i.test(
      document.querySelector('.shop-overlay .shop-prompt')?.textContent || '',
    ));
    await page.keyboard.press('e');
    await page.waitForFunction(() => {
      const inventory = window.__fw.state.propertyInventory;
      const item = inventory.items.find((entry) => entry.skuId === 'ceiling-light-standard');
      return inventory.placements.find((entry) => entry.itemId === item?.id)?.lightState?.isOn === true;
    });
    await page.waitForFunction(() => {
      const clubhouse = window.__fw.scene3d.clubhouse();
      const rows = clubhouse.propertyFurnitureDiagnostics()
        .filter((row) => row.skuId?.startsWith('ceiling-light-'));
      const expected = rows.reduce((total, row) => (
        total + (row.lighting?.effectiveOn ? Number(row.lighting.expectedLightsPerLod || 0) : 0)
      ), 0);
      const budget = clubhouse.ceilingLightingDiagnostics().physicalLightBudget;
      return budget?.requestedPhysicalLights === expected
        && budget?.allocatedPhysicalLights === Math.min(Number(budget.limit || 0), expected);
    });
    saveReload = {
      required: true,
      rawBytes: beforeSave.rawBytes,
      identicalDigest: JSON.stringify(beforeSave.digest) === JSON.stringify(afterLoad),
      standardRestoredOff: standardAfterLoad?.lightState?.isOn === false,
      highEndAimPreserved: JSON.stringify(highEndBefore?.lightState?.spotlights)
        === JSON.stringify(highEndAfter?.lightState?.spotlights),
      returnedOnThroughPrompt: true,
    };
    saveReload.passed = saveReload.rawBytes > 0
      && saveReload.identicalDigest
      && saveReload.standardRestoredOff
      && saveReload.highEndAimPreserved
      && saveReload.returnedOnThroughPrompt;
  }

  const runtime = await page.evaluate(() => {
    const clubhouse = window.__fw.scene3d.clubhouse();
    const rows = clubhouse.propertyFurnitureDiagnostics()
      .filter((row) => row.skuId?.startsWith('ceiling-light-'));
    const scene = window.__fw.scene3d.scene;
    let visibleMeshes = 0;
    let sceneTriangles = 0;
    let lights = 0;
    let activeLights = 0;
    const materials = new Set();
    const hierarchyVisible = (object) => {
      let cursor = object;
      while (cursor) {
        if (cursor.visible === false) return false;
        cursor = cursor.parent;
      }
      return true;
    };
    scene.traverse((object) => {
      const rendered = hierarchyVisible(object);
      if (object.isLight) {
        lights += 1;
        if (rendered && object.intensity > 0) activeLights += 1;
      }
      if (!object.isMesh || !rendered) return;
      visibleMeshes += 1;
      const count = object.geometry?.index?.count ?? object.geometry?.attributes?.position?.count ?? 0;
      sceneTriangles += (count / 3) * (object.isInstancedMesh ? object.count : 1);
      for (const material of (Array.isArray(object.material) ? object.material : [object.material])) {
        if (material) materials.add(material.uuid);
      }
    });
    return {
      rows,
      baseLighting: clubhouse.ceilingLightingDiagnostics(),
      sceneMetrics: {
        visibleMeshes,
        sceneTriangles: Math.round(sceneTriangles),
        materialCount: materials.size,
        lights,
        activeLights,
      },
    };
  });

  const errorDiagnostics = diagnostics.filter((entry) => (
    entry.startsWith('console:error')
    || entry.startsWith('pageerror')
    || (entry.startsWith('requestfailed') && !entry.includes('net::ERR_ABORTED'))
  ));
  const premiumInstallationChecks = runtime.rows
    .filter((row) => row.skuId === 'ceiling-light-premium'
      || row.skuId === 'ceiling-light-premium-single')
    .map((row) => {
      const expectedCutouts = row.skuId === 'ceiling-light-premium' ? 3 : 1;
      const lods = row.ceilingInstallation || [];
      const passed = lods.length === 3 && lods.every((lod) => (
        lod.cutoutCount === expectedCutouts
        && lod.hiddenAboveCeilingCount >= expectedCutouts
        && Number(lod.visibleDrop) <= 0.03
        && Number(lod.ceilingOvershoot) <= 0.006
      ));
      return { skuId: row.skuId, expectedCutouts, lods, passed };
    });
  const downwardLightChecks = runtime.rows
    .filter((row) => row.skuId !== 'ceiling-light-luxury')
    .map((row) => {
      const directions = row.lighting?.lightDirections || [];
      return {
        skuId: row.skuId,
        directions,
        passed: directions.length === row.lighting?.expectedLightsPerLod
          && directions.every((direction) => direction.targetBoundToLamp === true
            && direction.y < -0.5),
      };
    });
  const expectedRequestedPhysicalLights = runtime.rows.reduce((total, row) => (
    total + (row.lighting?.effectiveOn ? Number(row.lighting.expectedLightsPerLod || 0) : 0)
  ), 0);
  const expectedAllocatedPhysicalLights = Math.min(
    Number(runtime.baseLighting.physicalLightBudget?.limit || 0),
    expectedRequestedPhysicalLights,
  );
  const physicalBudgetCheck = {
    ...runtime.baseLighting.physicalLightBudget,
    expectedRequestedPhysicalLights,
    expectedAllocatedPhysicalLights,
    passed: runtime.baseLighting.physicalLightBudget?.requestedPhysicalLights
        === expectedRequestedPhysicalLights
      && runtime.baseLighting.physicalLightBudget?.allocatedPhysicalLights
        === expectedAllocatedPhysicalLights,
  };
  return {
    ok: errorDiagnostics.length === 0
      && placementResult.rotationChanged
      && placementResult.placedCount === 6
      && individualPowerChecks.length === 6
      && individualPowerChecks.every((check) => check.passed)
      && premiumInstallationChecks.length === 2
      && premiumInstallationChecks.every((check) => check.passed)
      && downwardLightChecks.length === 5
      && downwardLightChecks.every((check) => check.passed)
      && aimDirectionCheck.passed
      && physicalBudgetCheck.passed
      && lodSweep.passed
      && saveReload.passed
      && runtime.rows.every((row) => row.loaded && !row.loadError && row.lighting && row.lod?.levels === 3),
    iteration: ITERATION,
    viewport: { width: 1600, height: 900, deviceScaleFactor: 1 },
    normalControls: placementResult,
    interactionPrompts: { power: powerPrompt, aim: aimPrompt },
    individualPowerChecks,
    premiumInstallationChecks,
    downwardLightChecks,
    physicalBudgetCheck,
    aimDirectionCheck,
    lodSweep,
    saveReload,
    shots,
    runtime,
    diagnostics,
  };
}
