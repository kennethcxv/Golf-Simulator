async (page) => {
  // Pine Hills legacy-save migration acceptance.
  //
  // Run only through the repository lock-owning runner:
  //   node tools/qa/run-playwright.cjs tools/qa/pine-hills-legacy-save-migration-acceptance.js
  //
  // DOCUMENTED FIXTURE BOUNDARY
  // ---------------------------
  // Each case is authored from newEmpire(), buyProperty(), the public inventory
  // lifecycle APIs, and empireSnapshot(). The resulting historical envelope is
  // written through core/storage.saveData(). Once Continue is clicked, the
  // driver does not patch app.empire or app.state. The only deterministic live
  // fixture writes are clock, weather, simulation speed, organic-walk-in
  // suppression, and the fixed player camera. The second pass uses the visible
  // pause-menu Save game and confirmed Load game controls against manual slot 1.

  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = path.resolve(process.env.QA_REPO_ROOT || process.cwd());
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const out = path.resolve(
    repo,
    process.env.PINE_HILLS_LEGACY_SAVE_OUT
      || path.join('qa', 'pine-hills-legacy-save-migration', 'acceptance'),
  );
  const resultPath = path.resolve(process.env.QA_RESULT_PATH || path.join(out, 'result.json'));
  fs.mkdirSync(out, { recursive: true });
  fs.mkdirSync(path.dirname(resultPath), { recursive: true });

  const viewport = Object.freeze({ width: 1600, height: 900, deviceScaleFactor: 1 });
  const matrix = Object.freeze([
    Object.freeze({
      id: 'pre-opening-legacy',
      seed: 73101,
      historical: true,
      kind: 'pre-opening',
      pose: Object.freeze({
        at: Object.freeze([-0.8, 5.85]),
        target: Object.freeze([-0.8, 1.30]),
        targetY: 1.30,
      }),
    }),
    Object.freeze({
      id: 'already-opened-legacy',
      seed: 73102,
      historical: true,
      kind: 'already-opened',
      pose: Object.freeze({
        at: Object.freeze([1.20, -3.15]),
        target: Object.freeze([3.90, -5.45]),
        targetY: 1.24,
      }),
    }),
    Object.freeze({
      id: 'custom-name-legacy',
      seed: 73103,
      historical: true,
      kind: 'custom-name',
      pose: Object.freeze({
        at: Object.freeze([2.30, 11.85]),
        target: Object.freeze([-0.8, 7.05]),
        targetY: 1.75,
      }),
    }),
    Object.freeze({
      id: 'already-furnished-current',
      seed: 73104,
      historical: false,
      kind: 'already-furnished',
      pose: Object.freeze({
        at: Object.freeze([-8.10, 5.75]),
        target: Object.freeze([-9.90, 5.75]),
        targetY: 1.08,
      }),
    }),
  ]);

  const result = {
    ok: false,
    generatedAt: new Date().toISOString(),
    protocol: {
      baseUrl,
      viewport,
      matrix: matrix.map((entry) => entry.id),
      fixtureBoundary: [
        'newEmpire + buyProperty + public inventory helpers',
        'empireSnapshot + core/storage.saveData autosave fixture',
        'visible Continue button',
        'pause menu -> Save game -> Save here (manual slot 1)',
        'pause menu -> Load game -> Load -> visible Load game confirmation',
      ],
      forbiddenShortcuts: [
        'no deserializeEmpire call in the driver',
        'no app.empire/app.state mutation after Continue',
        'no direct migration helper call after Continue',
      ],
    },
    scenarios: {},
    checks: [],
    screenshots: [],
    diagnostics: {
      consoleErrors: [],
      consoleWarnings: [],
      pageErrors: [],
      requestFailures: [],
      httpErrors: [],
    },
  };
  let phase = 'setup';
  let documentReady = false;

  const relative = (file) => path.relative(repo, file).replaceAll('\\', '/');
  const canonical = (value) => JSON.stringify(value);
  const same = (left, right) => canonical(left) === canonical(right);
  const inventoryAuthorityFields = Object.freeze([
    'inTransit',
    'deliveredUnopened',
    'openedBox',
    'reserve',
    'shelf',
    'customerHeld',
    'sold',
    'disposedLost',
    'onHand',
    'incoming',
  ]);
  const inventoryPresenceStages = Object.freeze([
    'inTransit',
    'deliveredUnopened',
    'openedBox',
    'reserve',
    'shelf',
    'customerHeld',
  ]);
  const serialError = (error) => ({
    message: error?.message || String(error),
    stack: error?.stack || null,
  });

  function writeResult() {
    fs.writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`);
  }

  function check(scenarioId, pass, id, actual, expected, detail = null) {
    const entry = {
      scenarioId,
      id,
      ok: !!pass,
      actual,
      expected,
      ...(detail ? { detail } : {}),
    };
    result.checks.push(entry);
    return entry.ok;
  }

  function noteDiagnostic(bucket, value) {
    if (result.diagnostics[bucket].length >= 300) return;
    result.diagnostics[bucket].push({ phase, atMs: Date.now(), ...value });
  }

  page.on('console', (message) => {
    const value = { text: message.text(), type: message.type() };
    if (message.type() === 'error') noteDiagnostic('consoleErrors', value);
    else if (message.type() === 'warning') noteDiagnostic('consoleWarnings', value);
  });
  page.on('pageerror', (error) => noteDiagnostic('pageErrors', {
    text: error.message,
    stack: error.stack || null,
  }));
  page.on('requestfailed', (request) => {
    const errorText = request.failure()?.errorText || 'unknown';
    if (!documentReady && /ERR_ABORTED/i.test(errorText)) return;
    noteDiagnostic('requestFailures', {
      url: request.url(),
      errorText,
    });
  });
  page.on('response', (response) => {
    if (response.status() < 400) return;
    noteDiagnostic('httpErrors', { url: response.url(), status: response.status() });
  });

  async function capture(scenarioId, id, metadata = {}) {
    const dir = path.join(out, scenarioId);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${id}.png`);
    await page.screenshot({ path: file });
    const entry = {
      scenarioId,
      id,
      file: relative(file),
      phase,
      metadata,
    };
    result.screenshots.push(entry);
    writeResult();
    return entry;
  }

  async function waitForContinue() {
    const label = page.getByText('Continue', { exact: true }).first();
    await label.waitFor({ state: 'visible', timeout: 30000 });
    await page.waitForFunction(() => {
      const candidate = [...document.querySelectorAll('.menu-action-label')]
        .find((entry) => entry.textContent.trim() === 'Continue')
        ?.closest('button');
      return !!candidate && !candidate.disabled;
    }, null, { timeout: 30000 });
    return label.locator('..');
  }

  async function openPauseMenu() {
    const pause = page.locator('.pause-veil-ui');
    for (let attempt = 0; attempt < 4; attempt += 1) {
      if (await pause.isVisible().catch(() => false)) return pause;
      await page.keyboard.press('Escape');
      if (await pause.waitFor({ state: 'visible', timeout: 900 }).then(() => true).catch(() => false)) {
        return pause;
      }
    }
    throw new Error('Escape did not open the visible player pause menu.');
  }

  async function waitForOptionalDialog(name, timeout = 2000) {
    const dialog = page.getByRole('dialog', { name, exact: true });
    const visible = await dialog.waitFor({ state: 'visible', timeout })
      .then(() => true)
      .catch(() => false);
    return visible ? dialog : null;
  }

  async function pauseMenuSaveSlotOne(scenarioId) {
    const pause = await openPauseMenu();
    await pause.getByRole('button', { name: 'Save game', exact: true }).click();
    const saveHere = pause.getByRole('button', { name: 'Save here', exact: true }).first();
    await saveHere.waitFor({ state: 'visible', timeout: 6000 });
    await saveHere.click();

    const replaceDialog = await waitForOptionalDialog('Replace slot 1?');
    if (replaceDialog) {
      await replaceDialog.getByRole('button', { name: 'Replace and save', exact: true }).click();
    }
    await page.waitForFunction(() => (
      !!localStorage.getItem('golfempire:slot1')
        && !!localStorage.getItem('golfempire:slot1-meta')
        && document.querySelector('.pause-status')?.textContent?.includes('Saved to slot 1')
    ), null, { timeout: 10000 });
    const storage = await page.evaluate(async () => {
      const raw = localStorage.getItem('golfempire:slot1');
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
      return {
        key: 'golfempire:slot1',
        bytes: raw.length,
        empireVersion: JSON.parse(raw).empireVersion ?? null,
        sha256: [...new Uint8Array(digest)]
          .map((byte) => byte.toString(16).padStart(2, '0'))
          .join(''),
      };
    });
    check(scenarioId, storage.bytes > 0, 'manual-slot:present', storage, 'manual slot 1 bytes present');
    check(scenarioId, storage.empireVersion === 3, 'manual-slot:current-empire-version', storage.empireVersion, 3);
    check(scenarioId, !replaceDialog, 'manual-slot:fresh-slot-no-overwrite-dialog', !!replaceDialog, false);
    await pause.getByRole('button', { name: 'Resume', exact: true }).click();
    await pause.waitFor({ state: 'hidden', timeout: 6000 });
    return {
      controls: replaceDialog
        ? ['Escape', 'Save game', 'Save here', 'Replace and save', 'Resume']
        : ['Escape', 'Save game', 'Save here', 'Resume'],
      overwriteConfirmed: !!replaceDialog,
      storage,
    };
  }

  async function pauseMenuLoadSlotOne(scenarioId) {
    const pause = await openPauseMenu();
    await pause.getByRole('button', { name: 'Load game', exact: true }).click();
    const load = pause.getByRole('button', { name: 'Load', exact: true }).first();
    await load.waitFor({ state: 'visible', timeout: 6000 });
    await page.waitForFunction(() => {
      const button = [...document.querySelectorAll('.pause-veil-ui button')]
        .find((entry) => entry.textContent.trim() === 'Load');
      return !!button && !button.disabled;
    }, null, { timeout: 6000 });
    await page.evaluate(() => { window.__pineHillsSceneBeforeManualLoad = window.__fw.scene3d; });
    await load.click();

    const confirmation = page.getByRole('dialog', { name: 'Load slot 1?', exact: true });
    await confirmation.waitFor({ state: 'visible', timeout: 6000 });
    const confirmationScreenshot = await capture(scenarioId, '03-load-slot-1-confirmation', {
      dialog: 'Load slot 1?',
      confirmLabel: 'Load game',
    });
    await confirmation.getByRole('button', { name: 'Load game', exact: true }).click();
    await page.waitForFunction(() => (
      window.__fw?.scene3d
        && window.__fw.scene3d !== window.__pineHillsSceneBeforeManualLoad
        && window.__fw.scene3d.clubhouse?.()
    ), null, { timeout: 90000 });
    await freezeRuntimeSoon();
    await waitForRuntime();
    return {
      controls: ['Escape', 'Load game', 'Load', 'Load game confirmation'],
      confirmationScreenshot: confirmationScreenshot.file,
    };
  }

  async function freezeRuntimeSoon() {
    await page.waitForFunction(() => (
      window.__fw?.screen === 'game'
        && window.__fw?.state
        && window.__fw?.scene3d?.clubhouse?.()
    ), null, { timeout: 90000 });
    await page.evaluate(() => {
      window.__fw.speedIdx = 0;
      window.__fw.scene3d.walk.clearKeys?.();
    });
  }

  async function clampSimulationPaused() {
    return page.evaluate(() => {
      const app = window.__fw;
      // startGameNow intentionally resumes normal gameplay after construction.
      // This migration matrix is allowed to control simulation speed, and must
      // prevent even that first live frame from posting seed-dependent club
      // operations before the saved cash authority is inspected.
      Object.defineProperty(app, 'speedIdx', {
        configurable: true,
        enumerable: true,
        get: () => 0,
        set: () => {},
      });
      app.scene3d?.walk?.clearKeys?.();
      return app.speedIdx;
    });
  }

  async function waitForRuntime() {
    await page.waitForFunction(() => (
      window.__fw?.screen === 'game'
      && window.__fw?.state
      && window.__fw?.scene3d?.clubhouse?.()
    ), null, { timeout: 90000 });
    await page.waitForFunction(() => {
      const veil = document.querySelector('.load-veil');
      if (!veil) return true;
      const style = getComputedStyle(veil);
      return style.display === 'none' || Number.parseFloat(style.opacity || '0') <= 0.01;
    }, null, { timeout: 90000 });
    await page.evaluate(async () => {
      const clubhouse = window.__fw.scene3d.clubhouse();
      await Promise.all([
        clubhouse.pineHillsInterior?.ready,
        clubhouse.modernClubhouse?.ready,
        clubhouse.assets51to100Runtime?.ready,
        clubhouse.sheet07Production?.ready,
      ].filter(Boolean));
    });
    await page.waitForFunction(() => {
      const clubhouse = window.__fw?.scene3d?.clubhouse?.();
      const pine = clubhouse?.pineHillsInterior?.diagnostics?.();
      const modern = clubhouse?.modernClubhouse?.diagnostics?.();
      return clubhouse?.assetsReady?.()
        && pine?.failed === 0
        && pine?.loaded === pine?.expected
        && modern?.lifecycle === 'active';
    }, null, { timeout: 120000 });
  }

  async function fixVisualEnvironment() {
    return page.evaluate(async () => {
      const app = window.__fw;
      const clubhouse = app.scene3d.clubhouse();
      const day = Math.floor(app.state.clock.minutes / 1440);
      const minute = day * 1440 + 14 * 60;
      app.speedIdx = 0;
      app.scene3d.walk.clearKeys?.();
      clubhouse.setOrganicWalkins?.(false);
      clubhouse.clearWalkins?.();
      app.state.clock.minutes = minute;
      if (app.state.weather) {
        app.state.weather.locked = true;
        app.state.weather.today = {
          tempHiF: 74,
          tempLoF: 55,
          rainIn: 0,
          humidity: 0.4,
          windMph: 6,
        };
      }
      app.scene3d.applyTimeWeather?.(minute % 1440, app.state.weather);
      clubhouse.pineHillsInterior?.refresh?.();
      return { minute, speedIdx: app.speedIdx };
    });
  }

  async function setPose(pose) {
    await page.evaluate((fixedPose) => {
      const app = window.__fw;
      const origin = app.scene3d.clubhouse().interior.position;
      const walk = app.scene3d.walk;
      walk.clearKeys?.();
      walk.state.x = origin.x + fixedPose.at[0];
      walk.state.z = origin.z + fixedPose.at[1];
      const dx = fixedPose.target[0] - fixedPose.at[0];
      const dz = fixedPose.target[1] - fixedPose.at[1];
      const horizontal = Math.hypot(dx, dz) || 0.001;
      walk.state.yaw = Math.atan2(-dx / horizontal, -dz / horizontal);
      walk.state.pitch = Math.atan2(fixedPose.targetY - 1.62, horizontal);
    }, pose);
    await page.waitForTimeout(650);
  }

  async function installFixture(definition) {
    phase = `${definition.id}:fixture`;
    documentReady = false;
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });
    const fixture = await page.evaluate(async (definitionValue) => {
      const [Empire, Campaign, Restoration, Starter, Inventory, Deliveries, Boxes, Storage] = await Promise.all([
        import('/src/sim/empire.js'),
        import('/src/sim/campaign.js'),
        import('/src/sim/clubhouseRestoration.js'),
        import('/src/sim/clubhouseStarterStock.js'),
        import('/src/sim/inventoryLifecycle.js'),
        import('/src/sim/deliveries.js'),
        import('/src/data/boxes.js'),
        import('/src/core/storage.js'),
      ]);

      localStorage.clear();
      const empire = Empire.newEmpire('relaxed', definitionValue.seed);
      empire.cash = 10_000_000;
      const listing = empire.market.find((entry) => entry.id === 'willow-creek');
      if (!listing) throw new Error('The stable willow-creek starting property is unavailable.');
      const purchase = Empire.buyProperty(empire, listing.id);
      if (!purchase.ok) throw new Error(purchase.reason || 'Could not buy Pine Hills fixture.');
      const state = purchase.state;
      const holding = empire.holdings.find((entry) => entry.property.id === empire.activeId);
      state.tutorial.complete = true;
      state.tutorial.hidden = true;
      state.clock.minutes = 3 * 60;
      state.pendingMorning = false;
      state.cash = 9_250_000;
      empire.cash = state.cash;
      state.campaign.completedObjectiveIds = ['survey', 'enter', `qa:${definitionValue.id}`];
      state.campaign.purchased = { counter1: 2, balls1: 4, qaSentinel: 1 };
      state.shop.transactionHistory.push({
        number: 7700 + (definitionValue.seed % 100),
        minute: 170,
        type: 'sale',
        total: 19,
        items: [{ skuId: 'balls1', qty: 1 }],
        qaMigrationSentinel: definitionValue.id,
      });
      state.shop.drawer['20'] = (Number(state.shop.drawer['20']) || 0) + 1;

      // A real paid extra-furniture order and box must outlive every migration.
      state.shop.unlockedTier = Math.max(3, Number(state.shop.unlockedTier) || 0);
      const paid = Inventory.submitPurchaseOrders(state, {
        idempotencyKey: `qa-pine-hills-migration-paid-${definitionValue.id}`,
        lines: [{ skuId: 'chair1', quantity: 1 }],
      });
      if (!paid.ok || paid.orders.length !== 1) {
        throw new Error(paid.reason || 'Could not create the paid-extra fixture order.');
      }
      const paidOrder = paid.orders[0];
      const paidBoxes = Deliveries.arriveOrder(state, paidOrder);
      if (paidBoxes.length !== 1) {
        throw new Error(`Expected one paid-extra carton, received ${paidBoxes.length}.`);
      }

      let obsoleteOrderId = null;
      let obsoleteBoxId = null;
      if (definitionValue.historical) {
        state.campaign.version = 1;
        delete state.campaign.furnishedStartVersion;

        // Reuse the same v1 order/lot shape as the campaign migration unit
        // fixture. It represents inherited, zero-cost construction freight.
        const skuId = 'counter1';
        const manifest = Boxes.planShipment(
          (await import('/src/data/shopItems.js')).skuById(skuId),
          1,
        );
        obsoleteOrderId = state.shop.nextOrderId++;
        const legacyLineId = `qa-legacy-line-${obsoleteOrderId}`;
        const legacyLotId = `qa-legacy-lot-${obsoleteOrderId}`;
        const legacyOrder = {
          id: obsoleteOrderId,
          skuId,
          qty: 1,
          quantity: 1,
          cost: 0,
          goods: 0,
          fee: 0,
          supplier: manifest.supplier,
          manifest,
          arrivesDay: 0,
          placedMin: 120,
          deliveryMin: 150,
          window: { open: 145, close: 170 },
          status: 'received',
          notif: {},
          campaign: true,
          inherited: true,
          recovery: false,
        };
        state.shop.orders.push(legacyOrder);
        state.shop.inventoryLifecycle.orders.push(structuredClone(legacyOrder));
        const buckets = Object.fromEntries(
          Object.values(Inventory.INVENTORY_STAGE).map((stage) => [stage, 0]),
        );
        buckets[Inventory.INVENTORY_STAGE.DELIVERED_UNOPENED] = 1;
        state.shop.inventoryLifecycle.lots.push({
          id: legacyLotId,
          source: 'supplier',
          orderId: obsoleteOrderId,
          lineId: legacyLineId,
          skuId,
          orderedQuantity: 1,
          buckets,
          createdMin: 120,
          active: true,
        });
        obsoleteBoxId = state.shop.deliveries.nextBoxId++;
        state.shop.deliveries.boxes.push({
          id: obsoleteBoxId,
          persistentId: `box-${obsoleteBoxId}`,
          orderId: obsoleteOrderId,
          parentOrderId: obsoleteOrderId,
          skuId,
          qty: 1,
          cap: 1,
          initialQty: 1,
          initialQuantity: 1,
          remainingQuantity: 1,
          loc: 'pad',
          currentLocation: 'pad',
          contents: [{
            lineId: legacyLineId,
            lotId: legacyLotId,
            skuId,
            quantity: 1,
            remainingQuantity: 1,
          }],
        });
        state.shop.deliveries.shipments.push({
          orderId: obsoleteOrderId,
          skuId,
          supplier: manifest.supplier,
          manifest,
        });
        state.shop.deliveries.arrivedOrderIds.push(obsoleteOrderId);

        // These stock-free core stations begin packed in the historical save;
        // the furnished migration must reinstall them at the authored datums.
        for (const id of ['backcounter', 'office_desk', 'office_chair', 'packing_bench']) {
          const record = state.shop.layout?.objects?.[id];
          if (record) record.state = 'stored';
        }
        for (const id of Object.keys(state.shop.reno.facilities || {})) {
          state.shop.reno.facilities[id] = false;
        }

        // v13 owns the Pine Hills/furnished migration. The nested save is v12
        // and the portfolio envelope is v2, exactly one step behind each.
        state.version = 12;
      }

      const reno = state.shop.reno;
      reno.grime[0] = definitionValue.kind === 'already-opened' ? 0 : 0.123;
      reno.grime[1] = definitionValue.kind === 'already-opened' ? 0 : 0.234;
      reno.windows[0] = definitionValue.kind === 'already-opened' ? 0 : 0.222;
      if (reno.clutter[0]) reno.clutter[0].cleared = true;
      if (reno.clutter[1]) reno.clutter[1].cleared = true;
      if (Array.isArray(reno.debris)) {
        if (definitionValue.kind === 'already-opened') reno.debris.length = 0;
        else reno.debris.splice(0, Math.min(3, reno.debris.length));
      }
      reno.debrisSeeded = true;

      if (definitionValue.kind === 'already-opened') {
        state.campaign.businessOpen = true;
        state.campaign.openedAt = 420;
        state.campaign.operatingDayAbs = 0;
        for (let index = 0; index < reno.grime.length; index += 1) reno.grime[index] = 0;
        for (let index = 0; index < reno.windows.length; index += 1) reno.windows[index] = 0;
        for (const item of reno.clutter) item.cleared = true;
      } else {
        state.campaign.businessOpen = false;
        state.campaign.openedAt = null;
        state.campaign.firstDayComplete = false;
      }

      if (definitionValue.kind === 'custom-name') {
        holding.property.name = 'Cedar Crest Golf Property';
        state.clubName = 'Cedar Crest Golf';
      } else if (definitionValue.historical) {
        holding.property.name = 'Willow Creek Municipal';
        state.clubName = 'Willow Creek Golf Club';
      }

      if (definitionValue.kind === 'already-furnished') {
        reno.targetProgress['desk:paper-stack'] = 0.625;
        reno.targetProgress['lounge:empty-cups'] = 1;
        reno.openingDrinksCooler = { version: 1, doorState: 'open' };
      }

      // Historical saves predate the Pine Hills aggregate. Generic grime,
      // windows, clutter, debris, money, and inventory remain present while
      // the v13 load authors only the missing aggregate targets.
      if (definitionValue.historical) {
        for (const key of [
          'restorationVersion',
          'targetProgress',
          'lightPanels',
          'restockMilestones',
          'cleanupMilestones',
          'fullCleanupAwarded',
          'starterRestockVersion',
          'clubhouseLayoutVersion',
          'openingDrinksCooler',
        ]) delete reno[key];

        // Leave a one-unit, historically sold starter-line shortfall. Loading
        // must preserve that SOLD authority and convey exactly one replacement
        // unit—not compare the post-migration stock to this raw pre-v13 shape.
        const legacySale = Inventory.moveInventory(state, {
          from: Inventory.INVENTORY_STAGE.SHELF,
          to: Inventory.INVENTORY_STAGE.SOLD,
          quantity: 1,
          skuId: 'balls1',
          referenceId: `qa-pine-hills-legacy-sale-${definitionValue.id}`,
          reason: 'Historical player sale before furnished-start migration',
          qa: true,
        });
        if (!legacySale.ok) throw new Error(legacySale.reason || 'Could not author the legacy starter-stock shortfall.');
        state.shop.inventory.balls1.shelf -= 1;
      }

      const stockSkuIds = [
        ...Starter.STARTER_RETAIL_SKU_IDS,
        'chair1',
        'repairkit1',
        'vac1',
      ];
      const stock = Object.fromEntries(stockSkuIds.map((skuId) => {
        const position = Inventory.inventoryPosition(state, skuId);
        return [skuId, {
          shelfProjection: Number(state.shop.inventory[skuId]?.shelf) || 0,
          backProjection: Number(state.shop.inventory[skuId]?.back) || 0,
          inTransit: position[Inventory.INVENTORY_STAGE.IN_TRANSIT],
          deliveredUnopened: position[Inventory.INVENTORY_STAGE.DELIVERED_UNOPENED],
          openedBox: position[Inventory.INVENTORY_STAGE.OPENED_BOX],
          reserve: position[Inventory.INVENTORY_STAGE.RESERVE],
          shelf: position[Inventory.INVENTORY_STAGE.SHELF],
          customerHeld: position[Inventory.INVENTORY_STAGE.CUSTOMER_HELD],
          sold: position[Inventory.INVENTORY_STAGE.SOLD],
          disposedLost: position[Inventory.INVENTORY_STAGE.DISPOSED_LOST],
          onHand: position.onHand,
          incoming: position.incoming,
        }];
      }));
      const starterCartons = state.shop.deliveries.boxes
        .filter((box) => box.starterRestockVersion === Starter.STARTER_RESTOCK_VERSION)
        .map((box) => ({
          id: box.id,
          cartonId: box.starterCartonId,
          ordinal: box.starterCartonOrdinal ?? null,
          count: box.starterCartonCount ?? null,
          loc: box.loc,
          surfaceId: box.surfaceId || null,
          contents: (box.contents || []).map((entry) => ({
            lineId: entry.lineId,
            lotId: entry.lotId,
            skuId: entry.skuId,
            remainingQuantity: entry.remainingQuantity,
          })),
        }))
        .sort((left, right) => String(left.cartonId).localeCompare(String(right.cartonId)));
      const genericCleanup = {
        grime: [...reno.grime],
        windows: [...reno.windows],
        clutterCleared: reno.clutter.map((entry) => !!entry.cleared),
        debris: (reno.debris || []).map((entry) => ({
          x: entry.x,
          z: entry.z,
          a: entry.a,
        })),
        debrisSeeded: !!reno.debrisSeeded,
      };
      const expectedNames = definitionValue.kind === 'custom-name'
        ? { propertyName: 'Cedar Crest Golf Property', clubName: 'Cedar Crest Golf' }
        : { propertyName: 'Pine Hills Municipal Golf', clubName: 'Pine Hills Municipal Golf' };
      const expectedRestoration = definitionValue.kind === 'already-furnished'
        ? {
          targetProgress: structuredClone(reno.targetProgress),
          lightPanels: structuredClone(reno.lightPanels),
          restockMilestones: structuredClone(reno.restockMilestones),
          cleanupMilestones: structuredClone(reno.cleanupMilestones),
          fullCleanupAwarded: !!reno.fullCleanupAwarded,
        }
        : (definitionValue.kind === 'already-opened'
          ? {
            allTargetsComplete: true,
            allLightsWorking: true,
            allRestockComplete: true,
            allCleanupComplete: true,
            fullCleanupAwarded: true,
          }
          : {
            targetProgress: Restoration.defaultClubhouseRestorationState().targetProgress,
            lightPanels: Restoration.defaultClubhouseRestorationState().lightPanels,
            restockMilestones: Restoration.defaultClubhouseRestorationState().restockMilestones,
            cleanupMilestones: Restoration.defaultClubhouseRestorationState().cleanupMilestones,
            fullCleanupAwarded: false,
          });
      const expected = {
        names: expectedNames,
        propertyId: 'willow-creek',
        businessOpen: definitionValue.kind === 'already-opened',
        openedAt: definitionValue.kind === 'already-opened' ? 420 : null,
        campaignProgress: {
          completedObjectiveIds: [...state.campaign.completedObjectiveIds],
          purchased: structuredClone(state.campaign.purchased),
        },
        cash: state.cash,
        reputation: structuredClone(state.reputation),
        drawer20: state.shop.drawer['20'],
        transactionSentinel: definitionValue.id,
        inventoryBaseline: stock,
        starterSkuIds: [...Starter.STARTER_RETAIL_SKU_IDS],
        starterEntitlement: structuredClone(Starter.STARTER_RETAIL_ENTITLEMENT),
        starterCartons,
        starterCartonSpecs: Starter.STARTER_CARTON_SPECS.map((spec, index) => ({
          cartonId: spec.id,
          ordinal: index + 1,
          count: Starter.STARTER_CARTON_SPECS.length,
        })),
        genericCleanup,
        restoration: expectedRestoration,
        paidOrderId: paidOrder.id,
        paidBoxId: paidBoxes[0].id,
        obsoleteOrderId,
        obsoleteBoxId,
        expectedFacilityIds: Object.keys(Campaign.CAMPAIGN_FACILITIES).sort(),
        expectedFixtureIds: [...Campaign.FURNISHED_START_FIXTURES].sort(),
        coolerDoorState: definitionValue.kind === 'already-furnished' ? 'open' : 'closed',
      };

      const raw = Empire.empireSnapshot(empire);
      if (definitionValue.historical) {
        raw.empireVersion = 2;
        const rawHolding = raw.holdings.find((entry) => entry.property.id === raw.activeId);
        rawHolding.state.version = 12;
      }
      await Storage.saveData('autosave', raw);
      await Storage.saveData('autosave-meta', {
        savedAt: 1_719_000_000_000 + definitionValue.seed,
        clubName: expectedNames.clubName,
        propertyName: expectedNames.propertyName,
        propertyId: 'willow-creek',
      });
      return {
        id: definitionValue.id,
        seed: definitionValue.seed,
        historical: definitionValue.historical,
        rawEmpireVersion: raw.empireVersion,
        rawGameVersion: raw.holdings.find((entry) => entry.property.id === raw.activeId).state.version,
        expected,
      };
    }, definition);

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });
    documentReady = true;
    await waitForContinue();
    return fixture;
  }

  async function runtimeSnapshot(label) {
    return page.evaluate(async (snapshotLabel) => {
      const [Campaign, Restoration, Starter, Inventory, Layout, Cooler] = await Promise.all([
        import('/src/sim/campaign.js'),
        import('/src/sim/clubhouseRestoration.js'),
        import('/src/sim/clubhouseStarterStock.js'),
        import('/src/sim/inventoryLifecycle.js'),
        import('/src/sim/layout.js'),
        import('/src/sim/openingDrinksCooler.js'),
      ]);
      const app = window.__fw;
      const state = app.state;
      const holding = app.empire.holdings.find((entry) => entry.property.id === app.empire.activeId);
      const clubhouse = app.scene3d.clubhouse();
      const pine = clubhouse.pineHillsInterior.diagnostics();
      const modern = clubhouse.modernClubhouse.diagnostics();
      const reno = state.shop.reno;
      const restoration = Restoration.restorationSnapshot(state);
      const stockSkuIds = [
        ...Starter.STARTER_RETAIL_SKU_IDS,
        'chair1',
        'repairkit1',
        'vac1',
      ];
      const stock = Object.fromEntries(stockSkuIds.map((skuId) => {
        const position = Inventory.inventoryPosition(state, skuId);
        return [skuId, {
          shelfProjection: Number(state.shop.inventory[skuId]?.shelf) || 0,
          backProjection: Number(state.shop.inventory[skuId]?.back) || 0,
          inTransit: position[Inventory.INVENTORY_STAGE.IN_TRANSIT],
          deliveredUnopened: position[Inventory.INVENTORY_STAGE.DELIVERED_UNOPENED],
          openedBox: position[Inventory.INVENTORY_STAGE.OPENED_BOX],
          reserve: position[Inventory.INVENTORY_STAGE.RESERVE],
          shelf: position[Inventory.INVENTORY_STAGE.SHELF],
          customerHeld: position[Inventory.INVENTORY_STAGE.CUSTOMER_HELD],
          sold: position[Inventory.INVENTORY_STAGE.SOLD],
          disposedLost: position[Inventory.INVENTORY_STAGE.DISPOSED_LOST],
          onHand: position.onHand,
          incoming: position.incoming,
        }];
      }));
      const starterCartons = state.shop.deliveries.boxes
        .filter((box) => box.starterRestockVersion === Starter.STARTER_RESTOCK_VERSION)
        .map((box) => ({
          id: box.id,
          cartonId: box.starterCartonId,
          ordinal: box.starterCartonOrdinal ?? null,
          count: box.starterCartonCount ?? null,
          loc: box.loc,
          surfaceId: box.surfaceId || null,
          contents: (box.contents || []).map((entry) => ({
            lineId: entry.lineId,
            lotId: entry.lotId,
            skuId: entry.skuId,
            remainingQuantity: entry.remainingQuantity,
          })),
        }))
        .sort((left, right) => String(left.cartonId).localeCompare(String(right.cartonId)));
      const starterLineIds = state.shop.inventoryLifecycle.lots
        .filter((lot) => String(lot.lineId || '').startsWith('pine-hills-starter-'))
        .map((lot) => lot.lineId)
        .sort();
      const allTargetsComplete = Object.values(restoration.targetProgress)
        .every((progress) => progress >= 1);
      const allLightsWorking = Object.values(restoration.lightPanels)
        .every((panelState) => panelState === 'working');
      const countName = (name) => {
        let count = 0;
        app.scene3d.scene.traverse((object) => {
          if (object.name === name) count += 1;
        });
        return count;
      };
      const placed = new Set(Layout.placedFixtures(state).map((entry) => entry.id));
      const transactionSentinel = state.shop.transactionHistory
        .find((entry) => entry.qaMigrationSentinel)?.qaMigrationSentinel || null;
      const cooler = Cooler.openingDrinksCoolerSnapshot(state);
      return {
        label: snapshotLabel,
        versions: {
          empire: app.empire.version,
          game: state.version,
          campaign: state.campaign?.version ?? null,
          furnishedStart: state.campaign?.furnishedStartVersion ?? null,
          restoration: reno.restorationVersion ?? null,
          starterRestock: reno.starterRestockVersion ?? null,
          clubhouseLayout: reno.clubhouseLayoutVersion ?? null,
        },
        names: {
          propertyName: holding?.property?.name || null,
          clubName: state.clubName,
        },
        propertyId: holding?.property?.id || null,
        businessOpen: state.campaign?.businessOpen === true,
        openedAt: state.campaign?.openedAt ?? null,
        campaignProgress: {
          completedObjectiveIds: [...(state.campaign?.completedObjectiveIds || [])],
          purchased: structuredClone(state.campaign?.purchased || {}),
        },
        cash: state.cash,
        reputation: structuredClone(state.reputation),
        drawer20: state.shop.drawer['20'],
        transactionSentinel,
        stations: {
          facilityIds: Object.entries(reno.facilities || {})
            .filter(([, installed]) => installed === true)
            .map(([id]) => id)
            .sort(),
          placedFixtureIds: [...placed].sort(),
          laptopReady: Campaign.laptopReadiness(state).ready,
          registerReady: !!clubhouse.register,
          coolerDoorState: cooler?.door?.state || null,
        },
        assets: {
          pineExpected: pine.expected,
          pineLoaded: pine.loaded,
          pineFailed: pine.failed,
          coolerMounted: pine.coolerMounted,
          modernLifecycle: modern.lifecycle,
          modernBuildingLoaded: modern.buildingLoaded,
          modernSiteLoaded: modern.siteLoaded,
          sceneNameCounts: {
            pineLayer: countName('PineHillsInteriorLayer'),
            teeTimeBoard: countName('PineHillsTeeTimeBoard'),
            logoBackdrop: countName('PineHillsLogoBackdrop'),
            exteriorSign: countName('PineHillsDynamicExteriorSignText'),
            frontDeskReturn: countName('PineHillsFrontDeskReturn'),
            openingCooler: countName('PineHillsOpeningDrinksCooler'),
            modernBuilding: countName('MODERN_PUBLIC_CLUBHOUSE_BUILDING'),
            modernSite: countName('MODERN_PUBLIC_CLUBHOUSE_SITE'),
          },
        },
        stock,
        starterCartons,
        starterLineIds,
        starterLineIdsUnique: new Set(starterLineIds).size === starterLineIds.length,
        paidAuthority: {
          orderIds: state.shop.orders.map((entry) => entry.id).sort((a, b) => a - b),
          boxIds: state.shop.deliveries.boxes.map((entry) => entry.id).sort((a, b) => a - b),
          lotOrderIds: [...new Set(state.shop.inventoryLifecycle.lots
            .map((entry) => entry.orderId)
            .filter((id) => id != null))]
            .sort((a, b) => a - b),
        },
        genericCleanup: {
          grime: [...reno.grime],
          windows: [...reno.windows],
          clutterCleared: reno.clutter.map((entry) => !!entry.cleared),
          debris: (reno.debris || []).map((entry) => ({
            x: entry.x,
            z: entry.z,
            a: entry.a,
          })),
          debrisSeeded: !!reno.debrisSeeded,
        },
        restoration: {
          targetProgress: structuredClone(restoration.targetProgress),
          lightPanels: structuredClone(restoration.lightPanels),
          restockMilestones: structuredClone(restoration.restockMilestones),
          cleanupMilestones: structuredClone(restoration.cleanupMilestones),
          fullCleanupAwarded: restoration.complete.fullCleanupAwarded,
          allTargetsComplete,
          allLightsWorking,
          allRestockComplete: Object.values(restoration.restockMilestones).every(Boolean),
          allCleanupComplete: Object.values(restoration.cleanupMilestones).every(Boolean),
        },
      };
    }, label);
  }

  function validateSnapshot(definition, fixture, snapshot, passLabel) {
    const scenarioId = definition.id;
    const expected = fixture.expected;
    const checkId = (id) => `${passLabel}:${id}`;
    check(scenarioId, snapshot.versions.empire === 3, checkId('empire-version'), snapshot.versions.empire, 3);
    check(scenarioId, snapshot.versions.game === 13, checkId('game-version'), snapshot.versions.game, 13);
    check(scenarioId, snapshot.versions.campaign === 2, checkId('campaign-version'), snapshot.versions.campaign, 2);
    check(scenarioId, snapshot.versions.furnishedStart === 1, checkId('furnished-marker'), snapshot.versions.furnishedStart, 1);
    check(scenarioId, snapshot.versions.restoration === 1, checkId('restoration-version'), snapshot.versions.restoration, 1);
    check(scenarioId, snapshot.versions.starterRestock === 1, checkId('starter-marker'), snapshot.versions.starterRestock, 1);
    check(scenarioId, same(snapshot.names, expected.names), checkId('custom-and-default-names'), snapshot.names, expected.names);
    check(scenarioId, snapshot.propertyId === expected.propertyId, checkId('stable-property-id'), snapshot.propertyId, expected.propertyId);
    check(scenarioId, snapshot.businessOpen === expected.businessOpen, checkId('business-open'), snapshot.businessOpen, expected.businessOpen);
    check(scenarioId, snapshot.openedAt === expected.openedAt, checkId('opened-at'), snapshot.openedAt, expected.openedAt);
    const requiredCompleted = expected.campaignProgress.completedObjectiveIds;
    const actualCompleted = snapshot.campaignProgress.completedObjectiveIds;
    const missingCompleted = requiredCompleted.filter((id) => !actualCompleted.includes(id));
    const duplicateCompleted = actualCompleted.filter((id, index) => actualCompleted.indexOf(id) !== index);
    check(
      scenarioId,
      missingCompleted.length === 0
        && duplicateCompleted.length === 0
        && same(snapshot.campaignProgress.purchased, expected.campaignProgress.purchased),
      checkId('campaign-progress'),
      snapshot.campaignProgress,
      { requiredCompleted, purchased: expected.campaignProgress.purchased },
      'Replacement objectives already satisfied by the migrated world may be banked; legacy progress and purchases must remain exact.',
    );
    check(scenarioId, snapshot.cash === expected.cash, checkId('cash'), snapshot.cash, expected.cash);
    check(scenarioId, same(snapshot.reputation, expected.reputation), checkId('reputation-no-replay'), snapshot.reputation, expected.reputation);
    check(scenarioId, snapshot.drawer20 === expected.drawer20, checkId('cash-drawer'), snapshot.drawer20, expected.drawer20);
    check(scenarioId, snapshot.transactionSentinel === expected.transactionSentinel, checkId('transaction-history'), snapshot.transactionSentinel, expected.transactionSentinel);

    check(scenarioId, same(snapshot.stations.facilityIds, expected.expectedFacilityIds), checkId('facilities-installed'), snapshot.stations.facilityIds, expected.expectedFacilityIds);
    const missingFixtures = expected.expectedFixtureIds.filter((id) => !snapshot.stations.placedFixtureIds.includes(id));
    check(scenarioId, missingFixtures.length === 0, checkId('furnished-fixtures-placed'), missingFixtures, []);
    check(scenarioId, snapshot.stations.laptopReady, checkId('laptop-ready'), snapshot.stations.laptopReady, true);
    check(scenarioId, snapshot.stations.registerReady, checkId('register-ready'), snapshot.stations.registerReady, true);
    check(scenarioId, snapshot.stations.coolerDoorState === expected.coolerDoorState, checkId('cooler-door-state'), snapshot.stations.coolerDoorState, expected.coolerDoorState);

    check(scenarioId, snapshot.assets.pineFailed === 0, checkId('pine-assets-no-failures'), snapshot.assets.pineFailed, 0);
    check(scenarioId, snapshot.assets.pineLoaded === snapshot.assets.pineExpected, checkId('pine-assets-complete'), snapshot.assets.pineLoaded, snapshot.assets.pineExpected);
    check(scenarioId, snapshot.assets.coolerMounted, checkId('cooler-mounted'), snapshot.assets.coolerMounted, true);
    check(scenarioId, snapshot.assets.modernLifecycle === 'active', checkId('modern-shell-active'), snapshot.assets.modernLifecycle, 'active');
    check(scenarioId, snapshot.assets.modernBuildingLoaded && snapshot.assets.modernSiteLoaded, checkId('modern-shell-assets'), snapshot.assets, 'building and site loaded');
    const duplicateSceneNodes = Object.entries(snapshot.assets.sceneNameCounts)
      .filter(([, count]) => count !== 1);
    check(scenarioId, duplicateSceneNodes.length === 0, checkId('single-runtime-asset-instance'), duplicateSceneNodes, []);

    const starterSkuIds = new Set(expected.starterSkuIds);
    const authorityMismatches = [];
    const starterEntitlementMismatches = [];
    const projectionMismatches = [];
    for (const [skuId, baseline] of Object.entries(expected.inventoryBaseline)) {
      const actual = snapshot.stock[skuId];
      if (!actual) {
        authorityMismatches.push({ skuId, reason: 'missing inventory position' });
        continue;
      }

      if (starterSkuIds.has(skuId)) {
        // Furnishing is additive: every pre-existing unit/stage survives, while
        // only the missing portion of the one-time entitlement may be conveyed.
        for (const field of inventoryPresenceStages) {
          if (actual[field] < baseline[field]) {
            authorityMismatches.push({
              skuId,
              field,
              actual: actual[field],
              minimum: baseline[field],
            });
          }
        }
        for (const field of ['sold', 'disposedLost']) {
          if (actual[field] !== baseline[field]) {
            authorityMismatches.push({
              skuId,
              field,
              actual: actual[field],
              expected: baseline[field],
            });
          }
        }
        const baselinePresent = baseline.onHand + baseline.incoming;
        const actualPresent = actual.onHand + actual.incoming;
        const expectedPresent = Math.max(
          baselinePresent,
          Number(expected.starterEntitlement[skuId]) || 0,
        );
        if (actualPresent !== expectedPresent) {
          starterEntitlementMismatches.push({
            skuId,
            actual: actualPresent,
            expected: expectedPresent,
            baseline: baselinePresent,
          });
        }
      } else {
        for (const field of inventoryAuthorityFields) {
          if (actual[field] !== baseline[field]) {
            authorityMismatches.push({
              skuId,
              field,
              actual: actual[field],
              expected: baseline[field],
            });
          }
        }
      }

      // The compatibility projection must retain the ledger split. Comparing
      // only against SHELF incorrectly rejects legitimate reserve tools such as
      // the inherited vacuum and repair kit.
      if (actual.shelfProjection !== actual.shelf
          || actual.backProjection !== actual.reserve) {
        projectionMismatches.push({
          skuId,
          shelfProjection: actual.shelfProjection,
          backProjection: actual.backProjection,
          authoritativeShelf: actual.shelf,
          authoritativeReserve: actual.reserve,
        });
      }
    }
    check(scenarioId, authorityMismatches.length === 0, checkId('inventory-authority-preserved'), authorityMismatches, []);
    check(scenarioId, starterEntitlementMismatches.length === 0, checkId('starter-entitlement-no-loss-or-duplication'), starterEntitlementMismatches, []);
    check(scenarioId, projectionMismatches.length === 0, checkId('inventory-projection-conserved'), projectionMismatches, []);

    const starterCartonSpecs = snapshot.starterCartons
      .map((carton) => ({
        cartonId: carton.cartonId,
        ordinal: carton.ordinal,
        count: carton.count,
      }))
      .sort((left, right) => left.ordinal - right.ordinal);
    const missingExistingStarterCartons = expected.starterCartons
      .filter((baseline) => !snapshot.starterCartons.some((carton) => carton.id === baseline.id))
      .map((carton) => carton.id);
    check(scenarioId, same(starterCartonSpecs, expected.starterCartonSpecs), checkId('starter-carton-specs-exact'), starterCartonSpecs, expected.starterCartonSpecs);
    check(scenarioId, missingExistingStarterCartons.length === 0, checkId('existing-starter-cartons-preserved'), missingExistingStarterCartons, []);
    check(scenarioId, snapshot.starterCartons.length === 3, checkId('starter-carton-count'), snapshot.starterCartons.length, 3);
    check(scenarioId, snapshot.starterLineIdsUnique, checkId('starter-lines-unique'), snapshot.starterLineIds, 'unique line IDs');
    check(scenarioId, snapshot.paidAuthority.orderIds.includes(expected.paidOrderId), checkId('paid-order-preserved'), snapshot.paidAuthority.orderIds, `contains ${expected.paidOrderId}`);
    check(scenarioId, snapshot.paidAuthority.boxIds.includes(expected.paidBoxId), checkId('paid-box-preserved'), snapshot.paidAuthority.boxIds, `contains ${expected.paidBoxId}`);
    if (expected.obsoleteOrderId != null) {
      check(scenarioId, !snapshot.paidAuthority.orderIds.includes(expected.obsoleteOrderId), checkId('obsolete-order-retired'), snapshot.paidAuthority.orderIds, `excludes ${expected.obsoleteOrderId}`);
      check(scenarioId, !snapshot.paidAuthority.boxIds.includes(expected.obsoleteBoxId), checkId('obsolete-box-retired'), snapshot.paidAuthority.boxIds, `excludes ${expected.obsoleteBoxId}`);
      check(scenarioId, !snapshot.paidAuthority.lotOrderIds.includes(expected.obsoleteOrderId), checkId('obsolete-lot-retired'), snapshot.paidAuthority.lotOrderIds, `excludes ${expected.obsoleteOrderId}`);
    }

    check(scenarioId, same(snapshot.genericCleanup, expected.genericCleanup), checkId('generic-cleanup-not-redirtied'), snapshot.genericCleanup, expected.genericCleanup);
    if (definition.kind === 'already-opened') {
      for (const key of [
        'allTargetsComplete',
        'allLightsWorking',
        'allRestockComplete',
        'allCleanupComplete',
        'fullCleanupAwarded',
      ]) {
        check(scenarioId, snapshot.restoration[key] === expected.restoration[key], checkId(`opened-${key}`), snapshot.restoration[key], expected.restoration[key]);
      }
    } else {
      for (const key of [
        'targetProgress',
        'lightPanels',
        'restockMilestones',
        'cleanupMilestones',
        'fullCleanupAwarded',
      ]) {
        check(scenarioId, same(snapshot.restoration[key], expected.restoration[key]), checkId(`restoration-${key}`), snapshot.restoration[key], expected.restoration[key]);
      }
    }
  }

  try {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    for (const definition of matrix) {
      const scenario = {
        id: definition.id,
        kind: definition.kind,
        historical: definition.historical,
        route: [],
        fixture: null,
        firstLoad: null,
        manualSave: null,
        manualLoad: null,
        secondLoad: null,
        error: null,
      };
      result.scenarios[definition.id] = scenario;
      try {
        const fixture = await installFixture(definition);
        scenario.fixture = fixture;
        phase = `${definition.id}:menu-before-continue`;
        await capture(definition.id, '01-menu-before-continue', {
          rawEmpireVersion: fixture.rawEmpireVersion,
          rawGameVersion: fixture.rawGameVersion,
        });

        const continueButton = await waitForContinue();
        scenario.speedClamp = await clampSimulationPaused();
        await continueButton.click();
        scenario.route.push('visible Continue');
        phase = `${definition.id}:first-load`;
        await freezeRuntimeSoon();
        await waitForRuntime();
        scenario.environment = await fixVisualEnvironment();
        await setPose(definition.pose);
        const first = await runtimeSnapshot('after-migration');
        scenario.firstLoad = first;
        await capture(definition.id, '02-after-migration', {
          pose: definition.pose,
          names: first.names,
          businessOpen: first.businessOpen,
        });
        validateSnapshot(definition, fixture, first, 'first-load');

        phase = `${definition.id}:manual-slot-save`;
        scenario.manualSave = await pauseMenuSaveSlotOne(definition.id);
        scenario.route.push('Escape > Save game > Save here (manual slot 1) > Resume');

        phase = `${definition.id}:manual-slot-load-confirmation`;
        scenario.manualLoad = await pauseMenuLoadSlotOne(definition.id);
        scenario.route.push('Escape > Load game > Load (manual slot 1) > Load game confirmation');
        phase = `${definition.id}:second-load`;
        await fixVisualEnvironment();
        await setPose(definition.pose);
        const second = await runtimeSnapshot('after-manual-slot-load');
        scenario.secondLoad = second;
        await capture(definition.id, '04-after-manual-slot-load', {
          pose: definition.pose,
          names: second.names,
          businessOpen: second.businessOpen,
        });
        validateSnapshot(definition, fixture, second, 'second-load');
        check(definition.id, same(first, { ...second, label: first.label }), 'idempotence:runtime-snapshot', second, first,
          'Only the diagnostic label may differ between snapshots.');
      } catch (error) {
        scenario.error = serialError(error);
        check(definition.id, false, 'scenario-route', scenario.error, null);
        await capture(definition.id, 'failure', { error: scenario.error }).catch(() => {});
      }
      writeResult();
    }
  } catch (error) {
    result.failure = serialError(error);
  }

  const allowedWarning = /PCFSoftShadowMap has been deprecated/i;
  const unexpectedWarnings = result.diagnostics.consoleWarnings
    .filter((entry) => !allowedWarning.test(entry.text));
  const unexpectedRequests = result.diagnostics.requestFailures
    .filter((entry) => !/ERR_ABORTED/i.test(entry.errorText));
  check('matrix', !result.failure, 'matrix-route', result.failure || null, null);
  check('matrix', result.diagnostics.consoleErrors.length === 0, 'diagnostics:console-errors', result.diagnostics.consoleErrors, []);
  check('matrix', unexpectedWarnings.length === 0, 'diagnostics:unexpected-warnings', unexpectedWarnings, []);
  check('matrix', result.diagnostics.pageErrors.length === 0, 'diagnostics:page-errors', result.diagnostics.pageErrors, []);
  check('matrix', unexpectedRequests.length === 0, 'diagnostics:request-failures', unexpectedRequests, []);
  check('matrix', result.diagnostics.httpErrors.length === 0, 'diagnostics:http-errors', result.diagnostics.httpErrors, []);
  check('matrix', result.screenshots.length === matrix.length * 4, 'evidence:screenshot-count', result.screenshots.length, matrix.length * 4);
  result.launch = [
    `$env:PINE_HILLS_LEGACY_SAVE_OUT='${relative(out)}'`,
    `$env:QA_RESULT_PATH='${relative(resultPath)}'`,
    'node tools/qa/run-playwright.cjs tools/qa/pine-hills-legacy-save-migration-acceptance.js',
  ].join('; ');
  result.resultPath = relative(resultPath);
  result.summary = {
    scenarios: matrix.length,
    checks: result.checks.length,
    passed: result.checks.filter((entry) => entry.ok).length,
    failed: result.checks.filter((entry) => !entry.ok).length,
    screenshots: result.screenshots.length,
    warningCount: result.diagnostics.consoleWarnings.length,
    unexpectedWarningCount: unexpectedWarnings.length,
  };
  result.ok = !result.failure
    && Object.values(result.scenarios).every((scenario) => !scenario.error)
    && result.checks.every((entry) => entry.ok);
  writeResult();
  return result;
}
