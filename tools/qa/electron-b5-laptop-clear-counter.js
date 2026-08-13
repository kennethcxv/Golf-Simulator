// Goal 24 / B5 — clear a wedged checkout from the physical laptop.
//
// Deterministic setup is limited to stock, customer placement, and the fixed
// player poses used by the checkout QA family. Every player action is then a
// trusted Playwright input: E enters the register, a canvas click scans one
// product, Escape safely steps away, E opens the laptop, and the Settings,
// Checkout, Clear the counter, and confirmation buttons are real DOM clicks.
//
// Run:
//   node tools/qa/run-electron.cjs tools/qa/electron-b5-laptop-clear-counter.js --clubhouse=pine-hills-v2
// Optional:
//   $env:GOAL24_B5_OUT='qa/goal24/checkout/b5-laptop-current'; <command above>
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve(process.env.GOAL24_B5_OUT
    || 'qa/goal24/checkout/b5-laptop-clear-counter');
  const VIEWPORT = Object.freeze({ width: 1600, height: 900 });
  const SKUS = Object.freeze(['tees1', 'glove1']);
  fs.mkdirSync(OUT, { recursive: true });

  const assert = (value, message) => {
    if (!value) throw new Error(message);
  };
  const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
  const transactionItems = (snapshot) => snapshot?.register?.tx?.items || [];
  const transactionItemUids = (snapshot) => transactionItems(snapshot).map((item) => item.uid);
  const transactionScannedUids = (snapshot) => transactionItems(snapshot)
    .filter((item) => item.scanned).map((item) => item.uid);
  const result = {
    schemaVersion: 2,
    fixtureBoundary: 'force-new profile; organic walk-ins disabled; stock/time/player poses normalized; sendToCounter stages one customer. All subsequent register, laptop, and confirmation actions use trusted keyboard/mouse controls.',
    diagnostics: {
      consoleErrors: [],
      pageErrors: [],
      failedRequests: [],
      httpErrors: [],
      warnings: [],
    },
    screenshots: [],
  };

  page.on('console', (message) => {
    if (message.type() === 'error') result.diagnostics.consoleErrors.push(message.text());
    if (message.type() === 'warning') result.diagnostics.warnings.push(message.text());
  });
  page.on('pageerror', (error) => {
    result.diagnostics.pageErrors.push(String(error?.stack || error));
  });
  page.on('requestfailed', (request) => {
    const error = request.failure()?.errorText || 'request failed';
    if (!/ERR_ABORTED/.test(error)) {
      result.diagnostics.failedRequests.push({ url: request.url(), error });
    }
  });
  page.on('response', (response) => {
    if (response.status() < 400) return;
    result.diagnostics.httpErrors.push({
      url: response.url(),
      status: response.status(),
      method: response.request().method(),
      resourceType: response.request().resourceType(),
    });
  });

  const shot = async (name) => {
    const file = path.join(OUT, `${String(result.screenshots.length + 1).padStart(2, '0')}-${name}.png`);
    await page.screenshot({ path: file, scale: 'css' });
    result.screenshots.push(file);
    return file;
  };

  const shopSnapshot = async (customerName = null) => page.evaluate(async (wantedName) => {
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    const register = clubhouse.register;
    const tx = register.getTx();
    const customer = wantedName ? clubhouse.customerByName(wantedName) : null;
    const { ensureInventoryLifecycle, inventoryPosition } = await import(
      new URL('src/sim/inventoryLifecycle.js', document.baseURI).href
    );
    const durable = window.__goal24B5JsonSafeDigest;
    if (typeof durable !== 'function') throw new Error('B5 JSON-safe digest helper is unavailable.');
    const shop = app.state.shop;
    const lifecycle = ensureInventoryLifecycle(app.state);
    const byKey = ([left], [right]) => String(left).localeCompare(String(right));
    const inventory = Object.fromEntries(Object.entries(shop.inventory || {})
      .sort(byKey).map(([skuId, value]) => [skuId, durable(value)]));
    const held = durable([...(shop.held || [])].sort((left, right) => (
      String(left?.uid || '').localeCompare(String(right?.uid || ''))
        || String(left?.skuId || '').localeCompare(String(right?.skuId || ''))
        || JSON.stringify(left).localeCompare(JSON.stringify(right))
    )));
    const lifecycleSkuIds = [...new Set([
      ...Object.keys(shop.inventory || {}),
      ...(lifecycle?.lots || []).map((lot) => lot?.skuId).filter(Boolean),
      ...(shop.held || []).map((unit) => unit?.skuId).filter(Boolean),
    ])].sort((left, right) => String(left).localeCompare(String(right)));
    // Operation/idempotency/event journals correctly grow once for the pick and
    // once for its rollback. The allocation authority that must return exactly
    // is every SKU position, every complete lot, and every live allocation
    // reference — not only the two aggregate fixture positions.
    const lifecycleAllocation = {
      positions: Object.fromEntries(lifecycleSkuIds.map((skuId) => [
        skuId, durable(inventoryPosition(app.state, skuId)),
      ])),
      lots: durable([...(lifecycle?.lots || [])].sort((left, right) => (
        String(left?.id || '').localeCompare(String(right?.id || ''))
      ))),
      heldAllocations: Object.fromEntries(Object.entries(lifecycle?.heldAllocations || {})
        .sort(byKey).map(([uid, allocations]) => [uid, durable([...(allocations || [])]
          .sort((left, right) => (
            String(left?.lotId || '').localeCompare(String(right?.lotId || ''))
              || Number(left?.quantity || 0) - Number(right?.quantity || 0)
          )))])),
      carry: durable(shop.carry || null),
      deliveries: durable(shop.deliveries || null),
      activeOrders: durable([...(shop.orders || [])].sort((left, right) => (
        String(left?.id || '').localeCompare(String(right?.id || ''))
      ))),
    };
    return {
      inventory,
      held,
      lifecycleAllocation,
      cash: Number(app.state.cash || 0),
      drawer: durable(shop.drawer || {}),
      history: durable(shop.transactionHistory || []),
      nextTransactionNo: Number(shop.nextTransactionNo || 1),
      salesLive: durable(shop.salesLive || {}),
      ledgerToday: structuredClone(app.state.ledger?.today || {}),
      register: {
        active: register.isActive(),
        customerName: register.getCustomer()?.fullName || register.getCustomer()?.name || null,
        customerId: register.getCustomer()?.customerId || null,
        // Every JSON-durable own field survives this digest: transaction id,
        // price/tax/method/card/cash/receipt state, item checkpoints, checkout
        // flow and history, and any future serializable field. Only functions
        // such as the injected RNG and other non-JSON runtime values are omitted.
        tx: tx ? durable(tx) : null,
      },
      customer: customer ? {
        customerId: customer.customerId,
        name: customer.fullName || customer.name,
        cartUids: (customer.cart || []).map((item) => item.uid),
        awaitingCheckout: !!customer.awaitingCheckout,
        checkoutPhase: customer.checkoutPhase || null,
      } : null,
      queueNames: (clubhouse.checkoutQueue?.() || [])
        .map((entry) => entry.fullName || entry.name || null),
    };
  }, customerName);

  const projectedItemPoint = async (uid) => page.evaluate(async (wantedUid) => {
    const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
    const app = window.__fw;
    const register = app.scene3d.clubhouse().register;
    const mesh = register.itemMesh(wantedUid);
    if (!mesh) return null;
    mesh.updateWorldMatrix(true, true);
    app.scene3d.camera.updateWorldMatrix(true, false);
    const projected = new THREE.Box3().setFromObject(mesh)
      .getCenter(new THREE.Vector3())
      .project(app.scene3d.camera);
    const rect = document.querySelector('canvas').getBoundingClientRect();
    return {
      x: rect.left + ((projected.x + 1) / 2) * rect.width,
      y: rect.top + ((1 - projected.y) / 2) * rect.height,
      ndc: { x: projected.x, y: projected.y, z: projected.z },
      inView: projected.z >= -1 && projected.z <= 1
        && Math.abs(projected.x) <= 1 && Math.abs(projected.y) <= 1,
    };
  }, uid);

  const stableProjectedItemPoint = async (uid) => {
    let previous = null;
    for (let sample = 0; sample < 50; sample += 1) {
      const point = await projectedItemPoint(uid);
      if (point?.inView && previous?.inView
          && Math.hypot(point.x - previous.x, point.y - previous.y) < 1) return point;
      previous = point;
      await page.waitForTimeout(100);
    }
    return null;
  };

  const leaveRegisterWithEscape = async () => {
    let presses = 0;
    while (await page.evaluate(() => window.__fw.scene3d.clubhouse().register.isActive())) {
      assert(presses < 6, 'Escape did not safely leave the register within six presses.');
      await page.keyboard.press('Escape');
      presses += 1;
      await page.waitForTimeout(180);
    }
    await page.waitForFunction(() => (
      window.__fw.scene3d.walk.isActive()
        && !window.__fw.scene3d.clubhouse().register.isActive()
    ), null, { timeout: 5000 });
    return presses;
  };

  const moveToLaptop = async () => page.evaluate(async () => {
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    const { FRONT_DESK, REGISTER } = await import(
      new URL('src/data/shopLayout.js', document.baseURI).href
    );
    const off = clubhouse.interior.position;
    const walk = app.scene3d.walk.state;
    // Use the laptop-side approach from the established recovery/accessibility
    // driver so the nearest-interaction resolver cannot select the scanner.
    const awayX = FRONT_DESK.laptop.x - REGISTER.scanner.x;
    const awayZ = FRONT_DESK.laptop.z - REGISTER.scanner.z;
    const separation = Math.hypot(awayX, awayZ) || 0.001;
    walk.x = FRONT_DESK.laptop.x + (awayX / separation) * 1.05 + off.x;
    walk.z = FRONT_DESK.laptop.z + (awayZ / separation) * 1.05 + off.z;
    const dx = FRONT_DESK.laptop.x - (walk.x - off.x);
    const dz = FRONT_DESK.laptop.z - (walk.z - off.z);
    const horizontal = Math.hypot(dx, dz) || 0.001;
    walk.yaw = Math.atan2(-dx / horizontal, -dz / horizontal);
    walk.pitch = -0.05;
  });

  const writeResult = () => {
    fs.writeFileSync(path.join(OUT, 'b5-laptop-clear-counter.json'),
      `${JSON.stringify(result, null, 2)}\n`);
  };

  try {
    await page.setViewportSize(VIEWPORT);
    const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
    await (await import(`file:///${bootPath}`)).clickThroughMenu(page, { forceNew: true });
    await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null,
      { timeout: 300000 });
    await page.waitForFunction(() => {
      const veil = document.querySelector('.load-veil');
      return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
    }, null, { timeout: 300000 });
    await page.waitForTimeout(2500);

    result.sceneReadiness = await page.evaluate(() => {
      const app = window.__fw;
      const clubhouse = app?.scene3d?.clubhouse?.();
      return {
        firstDoorVisibility: app?.scene3d?.firstDoorVisibilityReport?.() || null,
        sheet06: clubhouse?.sheet06Production?.diagnostics?.() || null,
      };
    });

    await page.evaluate(() => {
      window.__goal24B5JsonSafeDigest = (value) => {
        const encoded = JSON.stringify(value, (_key, entry) => {
          if (typeof entry === 'function' || typeof entry === 'symbol' || entry === undefined) {
            return undefined;
          }
          if (typeof entry === 'bigint') {
            return { __goal24JsonType: 'bigint', value: String(entry) };
          }
          if (typeof entry === 'number' && !Number.isFinite(entry)) {
            return { __goal24JsonType: 'non-finite-number', value: String(entry) };
          }
          return entry;
        });
        return encoded === undefined ? null : JSON.parse(encoded);
      };
      window.__goal24B5InputTrace = [];
      window.addEventListener('keydown', (event) => {
        if (!['e', 'E', 'Escape'].includes(event.key)) return;
        window.__goal24B5InputTrace.push({
          kind: 'keydown', key: event.key, trusted: event.isTrusted,
        });
      }, true);
      window.addEventListener('click', (event) => {
        const button = event.target?.closest?.('button');
        const canvas = event.target?.closest?.('canvas');
        if (!button && !canvas) return;
        window.__goal24B5InputTrace.push({
          kind: 'click',
          target: button ? 'button' : 'canvas',
          text: button?.textContent?.trim() || '',
          trusted: event.isTrusted,
        });
      }, true);
    });

    result.fixture = await page.evaluate(async (ids) => {
      const app = window.__fw;
      const clubhouse = app.scene3d.clubhouse();
      const shop = app.state.shop;
      const { capacityOf } = await import(
        new URL('src/data/fixtureSlots.js', document.baseURI).href
      );
      const { REGISTER } = await import(
        new URL('src/data/shopLayout.js', document.baseURI).href
      );
      clubhouse.setOrganicWalkins(false);
      clubhouse.clearWalkins();
      if (clubhouse.register.isActive() || clubhouse.register.getTx()) {
        throw new Error('Fresh B5 fixture unexpectedly began with an occupied register.');
      }
      if (shop) shop.open = true;
      if (app.state.campaign) app.state.campaign.businessOpen = true;
      for (const id of ids) {
        const inv = shop.inventory[id];
        if (!inv) throw new Error(`Missing fixture inventory for ${id}.`);
        const capacity = Math.max(1, Number(capacityOf(id)) || 1);
        inv.shelf = Math.min(capacity, Math.max(Number(inv.shelf || 0), Math.min(4, capacity)));
        inv.back = Math.max(0, Number(inv.back || 0));
      }
      app.speedIdx = 0;
      app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440 + 14 * 60;
      clubhouse.rebuildStock();
      const off = clubhouse.interior.position;
      const walk = app.scene3d.walk.state;
      walk.x = REGISTER.stand.x + off.x;
      walk.z = REGISTER.stand.z + off.z;
      const dx = REGISTER.monitor.x - REGISTER.stand.x;
      const dz = REGISTER.monitor.z - REGISTER.stand.z;
      const horizontal = Math.hypot(dx, dz) || 0.001;
      walk.yaw = Math.atan2(-dx / horizontal, -dz / horizontal);
      walk.pitch = Math.atan2(1.185 - 1.62, horizontal);
      return { normalizedAtMinute: app.state.clock.minutes };
    }, SKUS);

    result.baseline = await shopSnapshot();
    assert(result.baseline.held.length === 0,
      `Fresh B5 baseline retained customer-held goods: ${JSON.stringify(result.baseline.held)}.`);

    const staged = await page.evaluate((ids) => {
      const clubhouse = window.__fw.scene3d.clubhouse();
      const name = clubhouse.sendToCounter(ids, 'card');
      const customer = clubhouse.customerByName(name);
      if (customer) customer.patience = 180;
      return {
        name,
        customerId: customer?.customerId || null,
      };
    }, SKUS);
    assert(staged.name && staged.customerId, 'sendToCounter did not stage the B5 customer.');
    result.fixture = { ...result.fixture, ...staged, skus: [...SKUS] };

    await page.waitForFunction(([name, itemCount]) => {
      const clubhouse = window.__fw.scene3d.clubhouse();
      const tx = clubhouse.register.getTx();
      const customer = clubhouse.customerByName(name);
      return tx?.items?.length === itemCount
        && customer?.cart?.length === itemCount
        && customer.cart.every((item) => item.placed === true && item.placedAt)
        && customer?.checkoutPhase === 'waiting'
        && clubhouse.register.getCustomer() === customer;
    }, [staged.name, SKUS.length], { timeout: 60000 });
    result.staged = await shopSnapshot(staged.name);
    assert(transactionItems(result.staged).length === SKUS.length,
      'The staged live ticket did not contain every fixture item.');
    assert(result.staged.held.length === SKUS.length,
      'The staged customer did not hold exactly the fixture goods.');
    assert(result.staged.register.customerId === staged.customerId,
      'The register retained a different customer identity than the staged fixture.');

    await page.keyboard.press('e');
    await page.waitForFunction(() => {
      const register = window.__fw.scene3d.clubhouse().register;
      return register.isActive() && register.workspace() === 'scan';
    }, null, { timeout: 8000 });
    await page.waitForTimeout(700);

    const firstUid = transactionItemUids(result.staged)[0];
    const point = await stableProjectedItemPoint(firstUid);
    assert(point?.inView, `The first physical product was not visible: ${JSON.stringify(point)}.`);
    await page.mouse.click(point.x, point.y);
    await page.waitForFunction((uid) => {
      const register = window.__fw.scene3d.clubhouse().register;
      const item = register.getTx()?.items.find((entry) => entry.uid === uid);
      return item?.scanned === true && item?.staged === true
        && register.getFlow()?.state === 'WaitingForScan';
    }, firstUid, { timeout: 10000 });
    result.partialTicket = await shopSnapshot(staged.name);
    assert(transactionScannedUids(result.partialTicket).length === 1,
      'The physical register click did not leave exactly one scanned item.');
    assert(transactionScannedUids(result.partialTicket)[0] === firstUid,
      'The physical register click scanned a different product than the projected target.');
    await page.evaluate(() => {
      // Keep a read-only reference after the live partial-scan checkpoint. The
      // laptop action clears the register pointer, but voidTx mutates this same
      // object first; reading it afterward proves an actual void occurred.
      window.__goal24B5TicketReference = window.__fw.scene3d.clubhouse().register.getTx();
    });
    await shot('half-scanned-wedged-ticket');

    result.escapePresses = await leaveRegisterWithEscape();
    result.afterEscape = await shopSnapshot(staged.name);
    assert(result.afterEscape.register.active === false,
      'Escape left the register camera active.');
    assert(result.afterEscape.register.tx?.number === result.partialTicket.register.tx.number,
      'Escape changed or discarded the live ticket.');
    assert(same(transactionScannedUids(result.afterEscape),
      transactionScannedUids(result.partialTicket)),
    'Escape changed the partial scan checkpoint.');
    assert(same(result.afterEscape.inventory, result.partialTicket.inventory)
        && same(result.afterEscape.held, result.partialTicket.held)
        && same(result.afterEscape.lifecycleAllocation, result.partialTicket.lifecycleAllocation),
    'Escape moved inventory instead of safely preserving the live ticket.');
    assert(same(result.afterEscape.register.tx, result.partialTicket.register.tx),
      'Escape changed the retained transaction checkpoint.');
    await shot('safely-left-register-ticket-preserved');

    await moveToLaptop();
    await page.waitForFunction(() => /laptop/i.test(
      window.__fw.scene3d.walk.getFocusLabel?.() || ''
    ), null, { timeout: 8000 });
    result.laptopFocusBeforeOpen = await page.evaluate(() => (
      window.__fw.scene3d.walk.getFocusLabel?.() || ''
    ));
    await page.keyboard.press('e');
    await page.waitForFunction(() => window.__fw?.laptopOpen === true,
      null, { timeout: 12000 });
    await page.waitForFunction(() => (
      window.__fw?.scene3d?.clubhouse?.()?.laptopScreenMode?.() === 'live'
        && document.querySelector('.laptop-screen')
        && getComputedStyle(document.querySelector('.laptop-screen')).display !== 'none'
        && document.querySelector('.lt-frame')?.getBoundingClientRect().width > 500
    ), null, { timeout: 30000 });

    const settingsButton = page.locator('.lt-navbtn').filter({ hasText: /^Settings$/ });
    await settingsButton.waitFor({ state: 'visible', timeout: 5000 });
    assert(await settingsButton.count() === 1,
      'The physical laptop did not expose exactly one Settings navigation button.');
    await settingsButton.click();
    await page.waitForFunction(() => document.querySelector('.lt-h1')?.textContent.includes('Settings'),
      null, { timeout: 5000 });

    const checkoutTab = page.locator('button.lt-tab').filter({ hasText: /^Checkout$/ });
    await checkoutTab.waitFor({ state: 'visible', timeout: 5000 });
    assert(await checkoutTab.count() === 1,
      'Settings did not expose exactly one Checkout tab.');
    await checkoutTab.click();

    const clearButton = page.locator(
      'button.lt-primary.lt-danger[title*="Voids the open ticket"]',
    );
    await clearButton.waitFor({ state: 'visible', timeout: 5000 });
    assert(await clearButton.count() === 1,
      'Checkout settings did not expose exactly one Clear the counter control.');
    result.laptopBeforeClear = await shopSnapshot(staged.name);
    assert(result.laptopBeforeClear.register.tx?.number === result.partialTicket.register.tx.number,
      'Opening the laptop altered the wedged ticket before recovery confirmation.');
    assert(same(result.laptopBeforeClear.register.tx, result.partialTicket.register.tx),
      'Opening the laptop changed the full retained transaction checkpoint.');
    assert(same(result.laptopBeforeClear.inventory, result.partialTicket.inventory)
        && same(result.laptopBeforeClear.held, result.partialTicket.held)
        && same(result.laptopBeforeClear.lifecycleAllocation,
          result.partialTicket.lifecycleAllocation),
    'Opening the laptop changed inventory or lifecycle allocation authority.');
    assert(result.laptopBeforeClear.register.customerId === staged.customerId,
      'The laptop recovery control was about to dismiss a different customer.');
    await shot('laptop-checkout-clear-control');

    await clearButton.click();
    const confirmation = page.locator('.lt-confirm');
    await confirmation.waitFor({ state: 'visible', timeout: 5000 });
    const confirmMessage = (await confirmation.locator('.lt-confirmmsg').textContent() || '').trim();
    assert(/ticket is voided/i.test(confirmMessage) && /goods go back on the shelf/i.test(confirmMessage),
      `Clear confirmation did not explain the void and stock rollback: ${confirmMessage}`);
    result.confirmation = { message: confirmMessage };
    await shot('laptop-clear-counter-confirmation');

    const confirmButton = confirmation.locator('button.lt-primary.lt-danger')
      .filter({ hasText: /^Clear the counter$/ });
    await confirmButton.waitFor({ state: 'visible', timeout: 5000 });
    assert(await confirmButton.count() === 1,
      'The inline laptop confirmation did not expose exactly one destructive confirmation.');
    await confirmButton.click();

    await page.waitForFunction((name) => {
      const clubhouse = window.__fw.scene3d.clubhouse();
      return !clubhouse.register.getTx()
        && !clubhouse.register.getCustomer()
        && !clubhouse.customerByName(name);
    }, staged.name, { timeout: 8000 });
    await page.waitForTimeout(350);
    result.afterClear = await shopSnapshot(staged.name);
    result.voidedTicket = await page.evaluate(() => {
      const tx = window.__goal24B5TicketReference;
      return tx ? window.__goal24B5JsonSafeDigest(tx) : null;
    });
    result.inputTrace = await page.evaluate(() => (
      structuredClone(window.__goal24B5InputTrace || [])
    ));
    await shot('laptop-counter-cleared');

    const buttonClicks = result.inputTrace.filter((entry) => entry.kind === 'click'
      && entry.target === 'button');
    const trustedKeys = result.inputTrace.filter((entry) => entry.kind === 'keydown');
    const financialBaseline = {
      cash: result.baseline.cash,
      drawer: result.baseline.drawer,
      history: result.baseline.history,
      nextTransactionNo: result.baseline.nextTransactionNo,
      salesLive: result.baseline.salesLive,
      ledgerToday: result.baseline.ledgerToday,
    };
    const financialAfter = {
      cash: result.afterClear.cash,
      drawer: result.afterClear.drawer,
      history: result.afterClear.history,
      nextTransactionNo: result.afterClear.nextTransactionNo,
      salesLive: result.afterClear.salesLive,
      ledgerToday: result.afterClear.ledgerToday,
    };
    result.checks = {
      firstDoorAndSheet06Ready: result.sceneReadiness?.firstDoorVisibility?.status === 'ready'
        && result.sceneReadiness?.firstDoorVisibility?.degradedSources?.length === 0
        && result.sceneReadiness?.sheet06?.activationStatus === 'active'
        && result.sceneReadiness?.sheet06?.actualSharedGameIntegrated === true
        && result.sceneReadiness?.sheet06?.activationError == null,
      liveTicketWasHalfScannedThroughPhysicalCanvas: result.partialTicket.register.active === true
        && transactionScannedUids(result.partialTicket).length === 1
        && result.inputTrace.some((entry) => entry.kind === 'click'
          && entry.target === 'canvas' && entry.trusted === true),
      escapeSafelyPreservedTicket: result.escapePresses > 0
        && result.afterEscape.register.active === false
        && same(result.afterEscape.register.tx, result.partialTicket.register.tx)
        && same(result.afterEscape.inventory, result.partialTicket.inventory)
        && same(result.afterEscape.held, result.partialTicket.held)
        && same(result.afterEscape.lifecycleAllocation,
          result.partialTicket.lifecycleAllocation),
      laptopOpenedByTrustedGameplayKey: trustedKeys.filter((entry) => /^e$/i.test(entry.key)
        && entry.trusted === true).length >= 2
        && /laptop/i.test(result.laptopFocusBeforeOpen),
      escapeWasTrustedGameplayInput: trustedKeys.some((entry) => entry.key === 'Escape'
        && entry.trusted === true),
      realSettingsCheckoutAndConfirmationButtonsClicked: ['Settings', 'Checkout',
        'Clear the counter'].every((label) => buttonClicks.some((entry) => (
        entry.text === label && entry.trusted === true
      ))) && buttonClicks.filter((entry) => entry.text === 'Clear the counter'
        && entry.trusted === true).length === 2,
      referencedTicketWasVoidedNotBanked: result.voidedTicket?.number
          === result.partialTicket.register.tx.number
        && result.voidedTicket?.stage === 'voided'
        && result.voidedTicket?.banked !== true
        && same((result.voidedTicket?.items || []).map((item) => item.uid),
          transactionItemUids(result.partialTicket)),
      ticketAndCustomerReleased: result.afterClear.register.active === false
        && result.afterClear.register.tx === null
        && result.afterClear.register.customerId === null
        && result.afterClear.customer === null
        && !result.afterClear.queueNames.includes(staged.name),
      completeInventoryHeldAndLifecycleAllocationRestored:
        same(result.afterClear.inventory, result.baseline.inventory)
        && same(result.afterClear.held, result.baseline.held)
        && same(result.afterClear.lifecycleAllocation, result.baseline.lifecycleAllocation),
      noHistoryOrBankDelta: same(financialAfter, financialBaseline)
        && !result.afterClear.history.some((row) => (
          Number(row.number) === Number(result.partialTicket.register.tx.number)
        )),
      noPageErrors: result.diagnostics.pageErrors.length === 0,
      noConsoleErrors: result.diagnostics.consoleErrors.length === 0,
      noFailedRequests: result.diagnostics.failedRequests.length === 0,
      noHttpErrors: result.diagnostics.httpErrors.length === 0,
    };
    result.ok = Object.values(result.checks).every(Boolean);
    writeResult();
    console.log('B5-LAPTOP-CLEAR', JSON.stringify({
      ok: result.ok,
      checks: result.checks,
      ticket: result.voidedTicket,
      inventory: { baseline: result.baseline.inventory, after: result.afterClear.inventory },
      diagnostics: result.diagnostics,
      output: OUT,
    }, null, 2));
    assert(result.ok, `B5 laptop recovery failed: ${JSON.stringify(result.checks)}`);
    return result;
  } catch (error) {
    result.ok = false;
    result.blocker = {
      message: String(error?.message || error),
      stack: String(error?.stack || ''),
    };
    try {
      await shot('blocker');
    } catch (screenshotError) {
      result.blocker.screenshotError = String(screenshotError?.message || screenshotError);
    }
    writeResult();
    throw error;
  }
}
