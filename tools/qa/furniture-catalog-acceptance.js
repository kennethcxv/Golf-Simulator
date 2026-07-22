async (page) => {
  // Complete player-facing catalog path. Deterministic camera placement is used
  // only to make the 3D evidence repeatable; B, I, purchase, install, place, E,
  // pause-menu autosave, and Continue all travel through normal player controls.
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = process.cwd();
  const out = path.join(repo, 'qa', 'furniture_catalog', 'iteration-02');
  fs.mkdirSync(out, { recursive: true });
  const base = process.env.QA_BASE_URL || 'http://localhost:8491/';
  const diagnostics = [];
  page.on('console', (message) => {
    if (['error', 'warning'].includes(message.type())) diagnostics.push(`console:${message.type()}: ${message.text()}`);
  });
  page.on('pageerror', (error) => diagnostics.push(`pageerror: ${error.message}`));
  page.on('requestfailed', (request) => diagnostics.push(`requestfailed: ${request.url()} (${request.failure()?.errorText || 'unknown'})`));

  async function waitForGame() {
    await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
    await page.waitForFunction(() => {
      const veil = document.querySelector('.load-veil');
      return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
    }, null, { timeout: 90000 });
    await page.waitForTimeout(1200);
  }

  async function shot(name) {
    const target = path.join(out, name);
    await page.screenshot({ path: target });
    return path.relative(repo, target).replaceAll('\\', '/');
  }

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.getByText('Continue', { exact: true }).click();
  await waitForGame();

  const fixture = await page.evaluate(() => {
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    const origin = clubhouse.interior.position;
    const walk = app.scene3d.walk;
    const state = walk.state;
    app.speedIdx = 0;
    walk.clearKeys?.();
    state.x = origin.x - 0.6;
    state.z = origin.z + 4.7;
    state.yaw = 0;
    state.pitch = -0.08;
    clubhouse.setOrganicWalkins?.(false);
    clubhouse.clearWalkins?.();
    return {
      cameraOnly: true,
      localPlayer: { x: state.x - origin.x, z: state.z - origin.z, yaw: state.yaw, pitch: state.pitch },
      cash: app.state.cash,
    };
  });

  await page.keyboard.press('b');
  await page.waitForFunction(() => window.__fw.scene3d.clubhouse().build.isActive());
  await page.keyboard.press('i');
  const drawer = page.locator('.build-drawer');
  await drawer.waitFor({ state: 'visible' });
  await page.waitForFunction(() => [...document.querySelectorAll('.build-catalog-visual img')]
    .every((image) => image.complete && image.naturalWidth === 320 && image.naturalHeight === 180));
  const catalogShot = await shot('01-catalog-basic-real-thumbnails.png');

  const catalog = await page.evaluate(() => {
    const selected = document.querySelector('.build-catalog-field select[aria-label="Tier"]');
    const cards = [...document.querySelectorAll('.build-catalog-card')];
    const images = [...document.querySelectorAll('.build-catalog-visual img')];
    return {
      selectedTier: selected?.value,
      visibleCards: cards.length,
      lockedCards: cards.filter((card) => card.classList.contains('locked')).length,
      resultText: document.querySelector('.build-catalog-results')?.textContent.trim(),
      realPngSources: images.every((image) => /vendor\/images\/furniture\/catalog\/.+\.png$/.test(image.getAttribute('src') || '')),
      imageDimensions: [...new Set(images.map((image) => `${image.naturalWidth}x${image.naturalHeight}`))],
      cardFieldsPresent: cards.every((card) => /Quality/.test(card.textContent)
        && /Maintenance/.test(card.textContent) && /Comfort/.test(card.textContent)
        && /Prestige/.test(card.textContent) && /Level 1/.test(card.textContent) && /Rep 0/.test(card.textContent)),
    };
  });

  const rackCard = page.locator('.build-catalog-card').filter({ hasText: 'Basic Rolling rack' });
  await rackCard.getByRole('button', { name: /^Buy / }).click();
  const search = drawer.getByRole('searchbox', { name: 'Search furniture catalog' });
  await search.fill('Flooring');
  const floorCard = page.locator('.build-catalog-card').filter({ hasText: 'Basic Sealed concrete' });
  await floorCard.getByRole('button', { name: /^Buy / }).click();

  await drawer.getByRole('button', { name: 'Owned', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.build-drawer-body')?.textContent.includes('Catalog collection / 2'));
  const ownedShot = await shot('02-owned-purchases-first.png');
  const ownedBeforeInstall = await page.evaluate(() => {
    const details = document.querySelector('.build-inventory-legacy');
    return {
      collectionHeading: [...document.querySelectorAll('.build-drawer-body h3')].map((node) => node.textContent).find((text) => text.startsWith('Catalog collection')),
      firstRows: [...document.querySelectorAll('.build-object-row strong')].slice(0, 4).map((node) => node.textContent),
      existingStockCollapsed: Boolean(details && !details.open),
      legacySummary: details?.querySelector('summary')?.textContent || null,
    };
  });

  const flooringRow = page.locator('.build-object-row').filter({ hasText: 'Basic Sealed concrete' });
  await flooringRow.getByRole('button', { name: 'Install', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.build-drawer-body')?.textContent.includes('Installed finishes & equipment / 1'));
  const installDrawerShot = await shot('03-flooring-installed-values.png');
  const installedBeforeSave = await page.evaluate(() => {
    const model = window.__fw.scene3d.clubhouse().build.uiModel();
    return {
      installed: model.installed.map((object) => ({ id: object.id, sku: object.catalogSku, label: object.label })),
      effects: model.furniture.effects,
      floorColor: `#${window.__fw.scene3d.clubhouse().interior.parent
        ? window.__fw.scene3d.clubhouse().build.uiModel().installed[0].progressionTier : ''}`,
    };
  });

  // Find a legal floor target read-only, then frame it from a normal standing
  // camera. The actual preview and commit remain Place -> E player actions.
  const placementSetup = await page.evaluate(async () => {
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    const build = clubhouse.build;
    const rack = build.uiModel().stored.find((object) => object.catalogSku === 'apparel-rack-basic');
    const { validateObjectPlacement } = await import('/src/sim/layout.js');
    const candidates = [];
    for (let z = -3.5; z <= 3.5; z += 0.5) {
      for (let x = -4.5; x <= 4.5; x += 0.5) candidates.push({ x, z });
    }
    let selected = null;
    for (const candidate of candidates) {
      for (const side of [1, -1]) {
        const actor = { x: candidate.x, z: candidate.z + side * 3.0 };
        const valid = validateObjectPlacement(app.state, rack.id, {
          x: candidate.x, y: 0, z: candidate.z, ry: 0, surface: 'floor', attachment: null, room: 'sales',
        }, { grid: false, rotationSnap: false, actorPosition: actor });
        if (valid.ok) { selected = { candidate, actor }; break; }
      }
      if (selected) break;
    }
    if (!selected) throw new Error('No legal player-framed rack position found.');
    const origin = clubhouse.interior.position;
    const walk = app.scene3d.walk;
    const state = walk.state;
    walk.clearKeys?.();
    state.x = origin.x + selected.actor.x;
    state.z = origin.z + selected.actor.z;
    const dx = selected.candidate.x - selected.actor.x;
    const dz = selected.candidate.z - selected.actor.z;
    const distance = Math.hypot(dx, dz);
    state.yaw = Math.atan2(-dx / distance, -dz / distance);
    state.pitch = -Math.atan2(1.72, distance);
    return { rackId: rack.id, ...selected, yaw: state.yaw, pitch: state.pitch };
  });

  const rackRow = page.locator('.build-object-row').filter({ hasText: 'Basic Rolling rack' });
  await rackRow.getByRole('button', { name: 'Place', exact: true }).click();
  await page.waitForFunction(() => {
    const build = window.__fw.scene3d.clubhouse().build;
    return build.isCarrying()
      && document.querySelector('.build-status')?.textContent.includes('valid floor placement');
  }, null, { timeout: 30000 });
  const previewDiagnostics = await page.evaluate(() => window.__fw.scene3d.clubhouse().build.diagnostics());
  const previewShot = await shot('04-rack-valid-preview.png');
  await page.keyboard.press('e');
  await page.waitForFunction(() => !window.__fw.scene3d.clubhouse().build.isCarrying());
  await page.waitForFunction((id) => window.__fw.scene3d.clubhouse().build.uiModel().placed.some((object) => object.id === id), placementSetup.rackId);
  await page.waitForFunction(() => {
    const d = window.__fw.scene3d.clubhouse().furnitureDiagnostics().visuals;
    return d.renderedModels === d.expectedPlacedModels && d.failures.length === 0;
  }, null, { timeout: 30000 });
  const placedShot = await shot('05-rack-placed-player-camera.png');
  const placedBeforeSave = await page.evaluate((id) => {
    const app = window.__fw;
    const object = app.scene3d.clubhouse().build.uiModel().placed.find((entry) => entry.id === id);
    const roots = [];
    app.scene3d.scene.traverse((node) => {
      if (node.userData?.placeableId === id && /^Placeable_/.test(node.name)) roots.push(node);
    });
    const root = roots[0] || null;
    const materials = new Set();
    root?.traverse((node) => {
      if (!node.isMesh) return;
      for (const material of Array.isArray(node.material) ? node.material : [node.material]) if (material) materials.add(material.name);
    });
    return {
      id,
      state: object?.state,
      sku: object?.catalogSku,
      transform: object?.transform,
      rootName: root?.name || null,
      fallback: Boolean(root?.userData?.loadError),
      materialNames: [...materials],
      diagnostics: app.scene3d.clubhouse().furnitureDiagnostics(),
    };
  }, placementSetup.rackId);

  // Normal pause-menu autosave route, then normal Continue boot.
  await page.keyboard.press('b');
  await page.waitForFunction(() => !window.__fw.scene3d.clubhouse().build.isActive());
  await page.locator('canvas').click({ position: { x: 800, y: 450 } });
  await page.keyboard.press('p');
  const pause = page.locator('.pause-veil-ui');
  await pause.waitFor({ state: 'visible' });
  await pause.getByRole('button', { name: 'Session', exact: true }).click();
  await pause.getByRole('button', { name: 'Return to main menu', exact: true }).click();
  await page.getByRole('button', { name: 'Save and return', exact: true }).click();
  await page.getByText('Continue', { exact: true }).waitFor({ state: 'visible', timeout: 30000 });
  await page.getByText('Continue', { exact: true }).click();
  await waitForGame();
  const persisted = await page.evaluate((id) => {
    const app = window.__fw;
    const model = app.scene3d.clubhouse().build.uiModel();
    const rack = model.placed.find((object) => object.id === id);
    return {
      rack: rack ? { id: rack.id, sku: rack.catalogSku, state: rack.state, transform: rack.transform } : null,
      installed: model.installed.map((object) => ({ id: object.id, sku: object.catalogSku, state: object.state })),
      purchaseCount: model.furniture.purchaseCount,
      effects: model.furniture.effects,
      cash: model.cash,
      visuals: app.scene3d.clubhouse().furnitureDiagnostics().visuals,
    };
  }, placementSetup.rackId);
  await page.evaluate((pose) => {
    const app = window.__fw;
    const origin = app.scene3d.clubhouse().interior.position;
    const walk = app.scene3d.walk;
    const state = walk.state;
    state.x = origin.x + pose.actor.x;
    state.z = origin.z + pose.actor.z;
    state.yaw = pose.yaw;
    state.pitch = pose.pitch;
  }, placementSetup);
  await page.waitForTimeout(900);
  const reloadShot = await shot('06-rack-and-floor-after-autosave-continue.png');

  const assertions = {
    defaultTierShowsSixtyTwoStarterFamilies: catalog.selectedTier === 'basic' && /of 62/.test(catalog.resultText || ''),
    cardsArePlayerReady: catalog.visibleCards === 12 && catalog.lockedCards === 0,
    thumbnailsAreRealRenders: catalog.realPngSources && catalog.imageDimensions.length === 1 && catalog.imageDimensions[0] === '320x180',
    everyVisibleCardShowsRequiredFields: catalog.cardFieldsPresent,
    purchasesLeadOwnedCollection: ownedBeforeInstall.collectionHeading === 'Catalog collection / 2'
      && ownedBeforeInstall.firstRows.includes('Basic Rolling rack') && ownedBeforeInstall.firstRows.includes('Basic Sealed concrete'),
    legacyStockDoesNotBuryPurchases: ownedBeforeInstall.existingStockCollapsed,
    installationContributesValues: installedBeforeSave.installed.some((row) => row.sku === 'flooring-basic')
      && installedBeforeSave.effects.installedCount === 1,
    modelLoadedWithoutFallback: placedBeforeSave.state === 'placed' && !placedBeforeSave.fallback
      && placedBeforeSave.materialNames.some((name) => name.startsWith('M_FURN_')),
    renderedAndSimulationCountsAgree: placedBeforeSave.diagnostics.visuals.failures.length === 0
      && placedBeforeSave.diagnostics.visuals.expectedPlacedModels === placedBeforeSave.diagnostics.visuals.renderedModels,
    autosaveContinuePreservesPurchaseInstallPlacement: persisted.purchaseCount === 2
      && persisted.rack?.state === 'placed' && persisted.installed.some((row) => row.sku === 'flooring-basic')
      && JSON.stringify(persisted.rack.transform) === JSON.stringify(placedBeforeSave.transform),
    consoleClean: diagnostics.every((entry) => entry.startsWith('console:warning: THREE.WebGLProgram:')
      || (entry.startsWith('requestfailed:') && entry.includes('ERR_ABORTED'))),
  };
  const ok = Object.values(assertions).every(Boolean);
  return {
    ok,
    methodology: 'Fixed presentation camera only; normal B/I/UI purchase/UI install/UI Place/E/pause autosave/Continue controls own every gameplay transition.',
    fixture,
    catalog,
    ownedBeforeInstall,
    installedBeforeSave,
    placementSetup,
    previewDiagnostics,
    placedBeforeSave,
    persisted,
    screenshots: [catalogShot, ownedShot, installDrawerShot, previewShot, placedShot, reloadShot],
    diagnostics,
    assertions,
  };
}
