async (page) => {
  // Progression + elite-country-club visual acceptance. Promotion is an explicit
  // QA precondition so both lock states can be inspected in one run; every buy,
  // install, and placement after that precondition uses the player-facing UI.
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = process.cwd();
  const out = path.resolve(repo, process.env.QA_OUTPUT_DIR || 'qa/furniture_catalog/iteration-03');
  fs.mkdirSync(out, { recursive: true });
  const diagnostics = [];
  page.on('console', (message) => {
    if (['error', 'warning'].includes(message.type())) diagnostics.push(`console:${message.type()}: ${message.text()}`);
  });
  page.on('pageerror', (error) => diagnostics.push(`pageerror: ${error.message}`));
  page.on('requestfailed', (request) => diagnostics.push(`requestfailed: ${request.url()} (${request.failure()?.errorText || 'unknown'})`));

  const base = process.env.QA_BASE_URL || 'http://localhost:8491/';
  const shot = async (name) => {
    const target = path.join(out, name);
    await page.screenshot({ path: target });
    return path.relative(repo, target).replaceAll('\\', '/');
  };
  const waitForGame = async () => {
    await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
    await page.waitForFunction(() => {
      const veil = document.querySelector('.load-veil');
      return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
    }, null, { timeout: 90000 });
    await page.waitForTimeout(1200);
  };
  const frameRoom = async () => page.evaluate(() => {
    const app = window.__fw;
    const origin = app.scene3d.clubhouse().interior.position;
    const state = app.scene3d.walk.state;
    app.scene3d.walk.clearKeys?.();
    state.x = origin.x - 0.6;
    state.z = origin.z + 4.7;
    state.yaw = 0;
    state.pitch = -0.08;
  });

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.getByText('Continue', { exact: true }).click();
  await waitForGame();
  const fixture = await page.evaluate(() => {
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    app.speedIdx = 0;
    clubhouse.setOrganicWalkins?.(false);
    clubhouse.clearWalkins?.();
    if (app.state.shop.reno) {
      app.state.shop.reno.grime?.fill?.(0);
      for (const clutter of app.state.shop.reno.clutter || []) clutter.cleared = true;
      for (const component of Object.values(app.state.shop.reno.architecture?.components || {})) {
        component.restored = true;
      }
      app.state.shop.reno.debris = [];
      app.state.shop.reno.debrisSeeded = true;
    }
    clubhouse.rebuildReno?.();
    const debris = clubhouse.interior.getObjectByName?.('CleaningDebrisInstances');
    if (debris) debris.count = 0;
    const day = Math.floor(app.state.clock.minutes / 1440) * 1440;
    app.state.clock.minutes = day + 14 * 60;
    app.scene3d.applyTimeWeather?.(14 * 60, app.state.weather);
    return {
      setupOnly: 'paused customers, cleared renovation overlays, fixed 2 PM lighting and camera',
      initialLevel: app.state.shop.furnitureCatalog.level,
      initialReputation: app.state.club.reputation,
    };
  });
  await frameRoom();
  await page.waitForTimeout(500);
  const beforeShot = await shot('01-before-default-room.png');

  await page.keyboard.press('b');
  await page.keyboard.press('i');
  const drawer = page.locator('.build-drawer');
  await drawer.waitFor({ state: 'visible' });
  await drawer.locator('select[aria-label="Tier"]').selectOption('luxury');
  await page.waitForFunction(() => document.querySelectorAll('.build-catalog-card').length === 12);
  const locked = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.build-catalog-card')];
    return {
      count: cards.length,
      locked: cards.filter((card) => card.classList.contains('locked')).length,
      buttonsDisabled: cards.every((card) => card.querySelector('.build-buy')?.disabled),
      hasLevelGate: cards.every((card) => /Renovation level 35 required/.test(card.textContent)),
      hasReputationGate: cards.every((card) => /78 reputation required/.test(card.textContent)),
    };
  });
  const lockedShot = await shot('02-luxury-tier-locked.png');

  // Explicit progression presentation fixture; no furniture ownership is added.
  const promotion = await page.evaluate(() => {
    const app = window.__fw;
    app.state.shop.furnitureCatalog.level = 35;
    app.state.shop.furnitureCatalog.xp = 0;
    app.state.club.reputation = 100;
    return { level: 35, reputation: 100, purchaseCount: app.state.shop.furnitureCatalog.purchaseCount };
  });
  await page.keyboard.press('i');
  await page.keyboard.press('i');
  await drawer.waitFor({ state: 'visible' });
  await page.waitForFunction(() => [...document.querySelectorAll('.build-catalog-card')]
    .every((card) => !card.classList.contains('locked') && !card.querySelector('.build-buy')?.disabled));
  const unlockedShot = await shot('03-luxury-tier-unlocked.png');

  const search = () => drawer.getByRole('searchbox', { name: 'Search furniture catalog' });
  await search().fill('Flooring');
  const floorCard = page.locator('.build-catalog-card').filter({ hasText: 'Luxury Interlocking parquet hardwood floor' });
  const floorPricing = await floorCard.evaluate((card) => ({
    displayedRate: card.querySelector('.build-catalog-title > strong')?.textContent,
    purchaseButton: card.querySelector('.build-buy')?.textContent,
    packageCopy: card.querySelector('.build-catalog-buyline small')?.textContent,
  }));
  const cashBeforeFloor = await page.evaluate(() => window.__fw.state.cash);
  await floorCard.getByRole('button', { name: /^Buy / }).click();
  const cashAfterFloor = await page.evaluate(() => window.__fw.state.cash);
  await search().fill('Wall paneling');
  await page.locator('.build-catalog-card').filter({ hasText: 'Luxury Full-height heritage paneling' })
    .getByRole('button', { name: /^Buy / }).click();
  await search().fill('Lounge armchair');
  await page.locator('.build-catalog-card').filter({ hasText: 'Luxury Hand-tufted reading chair' })
    .getByRole('button', { name: /^Buy / }).click();

  await drawer.getByRole('button', { name: 'Owned', exact: true }).click();
  const floorRow = page.locator('.build-object-row').filter({ hasText: 'Luxury Interlocking parquet hardwood floor' });
  const wallRow = page.locator('.build-object-row').filter({ hasText: 'Luxury Full-height heritage paneling' });
  await floorRow.getByRole('button', { name: 'Install', exact: true }).click();
  await wallRow.getByRole('button', { name: 'Install', exact: true }).click();
  await page.waitForFunction(() => window.__fw.scene3d.clubhouse().build.uiModel().installed.length === 2);
  const installedControls = await page.evaluate(() => ({
    installedRows: document.querySelectorAll('.build-object-row.installed').length,
    sellButtons: [...document.querySelectorAll('.build-object-row.installed button')]
      .filter((button) => button.textContent.trim() === 'Sell').length,
  }));
  const installedDrawerShot = await shot('04-luxury-finishes-installed.png');
  await page.keyboard.press('i');
  await page.waitForTimeout(3200);
  await page.evaluate(() => {
    const app = window.__fw;
    const origin = app.scene3d.clubhouse().interior.position;
    const state = app.scene3d.walk.state;
    state.x = origin.x - 1.4;
    state.z = origin.z + 1.8;
    state.yaw = 0;
    state.pitch = -1.03;
  });
  const floorCloseShot = await shot('05-live-production-herringbone-floor.png');
  await frameRoom();
  await page.waitForTimeout(500);
  const eliteRoomShot = await shot('06-after-herringbone-and-heritage-walls.png');
  const finishState = await page.evaluate(() => {
    const clubhouse = window.__fw.scene3d.clubhouse();
    const floorRoot = clubhouse.sheet06Production.getAssemblyRoot(59);
    const floorMeshes = [];
    floorRoot?.traverse?.((node) => {
      if (!node?.isMesh) return;
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      for (const material of materials) {
        floorMeshes.push({
          mesh: node.name,
          mapRepeat: material?.map ? [material.map.repeat.x, material.map.repeat.y] : null,
          roughness: material?.roughness ?? null,
        });
      }
    });
    return {
      finishes: clubhouse.furnitureFinishDiagnostics(),
      effects: clubhouse.build.uiModel().furniture.effects,
      productionFloor: { meshCount: floorMeshes.length, materials: floorMeshes },
    };
  });

  await page.keyboard.press('i');
  await drawer.getByRole('button', { name: 'Owned', exact: true }).click();
  const placement = await page.evaluate(async () => {
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    const chair = clubhouse.build.uiModel().stored.find((object) => object.catalogSku === 'lounge-armchair-luxury');
    const { validateObjectPlacement } = await import('/src/sim/layout.js');
    let selected = null;
    for (let z = -4; z <= 3.5 && !selected; z += 0.5) {
      for (let x = -4.5; x <= 4.5 && !selected; x += 0.5) {
        for (const side of [1, -1]) {
          const actor = { x, z: z + side * 3 };
          const result = validateObjectPlacement(app.state, chair.id,
            { x, y: 0, z, ry: 0, surface: 'floor', attachment: null, room: 'sales' },
            { grid: false, rotationSnap: false, actorPosition: actor });
          if (result.ok) {
            selected = { candidate: { x, z }, actor };
            break;
          }
        }
      }
    }
    if (!selected) throw new Error('No legal luxury-chair target.');
    const origin = clubhouse.interior.position;
    const state = app.scene3d.walk.state;
    state.x = origin.x + selected.actor.x;
    state.z = origin.z + selected.actor.z;
    const dx = selected.candidate.x - selected.actor.x;
    const dz = selected.candidate.z - selected.actor.z;
    const distance = Math.hypot(dx, dz);
    state.yaw = Math.atan2(-dx / distance, -dz / distance);
    state.pitch = -Math.atan2(1.45, distance);
    return { id: chair.id, ...selected, yaw: state.yaw, pitch: state.pitch };
  });
  const chairRow = page.locator('.build-object-row').filter({ hasText: 'Luxury Hand-tufted reading chair' });
  await chairRow.getByRole('button', { name: 'Place', exact: true }).click();
  await page.waitForFunction(() => window.__fw.scene3d.clubhouse().build.isCarrying()
    && document.querySelector('.build-status')?.textContent.includes('valid floor placement'));
  await page.keyboard.press('e');
  await page.waitForFunction((id) => window.__fw.scene3d.clubhouse().build.uiModel().placed.some((object) => object.id === id), placement.id);
  await page.waitForFunction(() => {
    const visual = window.__fw.scene3d.clubhouse().furnitureDiagnostics().visuals;
    return visual.renderedModels === visual.expectedPlacedModels && visual.failures.length === 0;
  }, null, { timeout: 30000 });
  const chairShot = await shot('07-luxury-chair-player-camera.png');
  const placed = await page.evaluate((id) => {
    const app = window.__fw;
    const model = app.scene3d.clubhouse().build.uiModel();
    const object = model.placed.find((entry) => entry.id === id);
    let root = null;
    app.scene3d.scene.traverse((node) => {
      if (!root && node.name === `Placeable_${id}`) root = node;
    });
    return {
      object: object ? { id: object.id, sku: object.catalogSku, state: object.state, transform: object.transform } : null,
      root: root ? { name: root.name, loadError: root.userData.loadError || null } : null,
      effects: model.furniture.effects,
      visuals: app.scene3d.clubhouse().furnitureDiagnostics().visuals,
    };
  }, placement.id);

  const allowedDiagnostic = (entry) => entry.startsWith('console:warning: THREE.WebGLProgram:')
    || (entry.startsWith('requestfailed:') && entry.includes('ERR_ABORTED'));
  const assertions = {
    allLuxuryCardsInitiallyGated: locked.count === 12 && locked.locked === 12 && locked.buttonsDisabled,
    bothSlowProgressionGatesVisible: locked.hasLevelGate && locked.hasReputationGate,
    promotionDoesNotGrantInventory: promotion.purchaseCount === 0,
    flooringShowsHonestPackagePrice: floorPricing.displayedRate === '$20 / sq-ft'
      && floorPricing.purchaseButton === 'Buy room $48,000'
      && floorPricing.packageCopy?.includes('2,400 sq-ft room package'),
    flooringChargesFullRoomPackage: cashBeforeFloor - cashAfterFloor === 48000,
    luxuryFinishLooksArePhysical: finishState.finishes.floor?.look === 'herringbone'
      && finishState.finishes.walls?.look === 'green',
    liveProductionFloorUsesInstalledFinish: finishState.productionFloor.meshCount > 0
      && finishState.productionFloor.materials.every((material) => material.mapRepeat?.every((value) => value === 1)
        && material.roughness === 0.58),
    installedFinishesRequireUninstallBeforeSale: installedControls.installedRows === 2
      && installedControls.sellButtons === 0,
    installedValuesAggregate: finishState.effects.installedCount === 2
      && finishState.effects.prestigeValue > 0 && finishState.effects.maintenanceValue > 0,
    luxuryChairUsesRealGLB: placed.object?.sku === 'lounge-armchair-luxury'
      && placed.object.state === 'placed' && placed.root && !placed.root.loadError,
    allPlacedModelsRendered: placed.visuals.renderedModels === placed.visuals.expectedPlacedModels
      && placed.visuals.failures.length === 0,
    activeValuesIncludePlacedLuxury: placed.effects.placedCount === 1 && placed.effects.installedCount === 2,
    consoleHasNoFeatureErrors: diagnostics.every(allowedDiagnostic),
  };
  return {
    ok: Object.values(assertions).every(Boolean),
    methodology: 'Only level/reputation, clean presentation, clock, customers and fixed camera are QA fixtures; locks, purchases, installations and chair placement use normal UI/B/I/E controls.',
    fixture,
    locked,
    promotion,
    floorPricing: { ...floorPricing, cashBeforeFloor, cashAfterFloor, charged: cashBeforeFloor - cashAfterFloor },
    installedControls,
    finishState,
    placement,
    placed,
    screenshots: [beforeShot, lockedShot, unlockedShot, installedDrawerShot, floorCloseShot, eliteRoomShot, chairShot],
    diagnostics,
    assertions,
  };
}
