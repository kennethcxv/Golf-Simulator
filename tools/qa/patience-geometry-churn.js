async (page) => {
  const BASE_URL = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const out = process.env.PATIENCE_QA_ROOT || 'qa/cash-register-production/patience-abandonment';
  const errors = [];
  const warnings = [];
  const failedRequests = [];
  const evidence = [];
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const shot = async (name) => {
    const output = `${out}/${name}`;
    await page.screenshot({ path: output });
    evidence.push(output);
    return output;
  };
  page.on('pageerror', (error) => errors.push(`PAGEERROR: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
    if (message.type() === 'warning') warnings.push(message.text());
  });
  page.on('requestfailed', (request) => failedRequests.push({
    url: request.url(),
    error: request.failure()?.errorText || 'request failed',
  }));

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(BASE_URL);
  await page.waitForTimeout(1000);
  await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
  }, null, { timeout: 90000 });
  await page.waitForTimeout(1800);

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('HeapProfiler.enable');
  await cdp.send('HeapProfiler.collectGarbage');
  const heapBefore = await page.evaluate(() => (
    performance.memory ? performance.memory.usedJSHeapSize : null
  ));

  const fixture = await page.evaluate(async () => {
    const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
    const originalDispose = THREE.BufferGeometry.prototype.dispose;
    window.__patienceGeometryProbe = {
      totalDisposals: 0,
      ringDisposals: 0,
      originalDispose,
    };
    THREE.BufferGeometry.prototype.dispose = function patienceProbeDispose(...args) {
      const probe = window.__patienceGeometryProbe;
      if (probe) {
        probe.totalDisposals += 1;
        if (this.type === 'RingGeometry') probe.ringDisposals += 1;
      }
      return originalDispose.apply(this, args);
    };

    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    const skuIds = ['tees1', 'marker1', 'glove1'];
    const { shelfCapacity } = await import(new URL('src/sim/shop.js', document.baseURI).href);
    const { SHOP_CATALOG } = await import(new URL('src/data/shopItems.js', document.baseURI).href);
    clubhouse.setOrganicWalkins(false);
    clubhouse.clearWalkins();
    app.speedIdx = 0;
    for (const id of skuIds) {
      const sku = SHOP_CATALOG.find((entry) => entry.id === id);
      const capacity = shelfCapacity(sku);
      app.state.shop.inventory[id].shelf = Math.min(
        capacity,
        Math.max(2, app.state.shop.inventory[id].shelf || 0),
      );
    }
    clubhouse.rebuildStock();
    const shelfBefore = Object.fromEntries(skuIds.map((id) => [id, app.state.shop.inventory[id].shelf]));
    const origin = clubhouse.interior.position;
    const walk = app.scene3d.walk.state;
    walk.x = origin.x + 2.80;
    walk.z = origin.z + 5.35;
    walk.yaw = 0;
    walk.pitch = -0.18;
    const financialBefore = {
      cash: app.state.cash,
      shopSales: app.state.ledger.today.revenue.shopSales || 0,
      history: (app.state.shop.transactionHistory || []).length,
      liveRevenue: app.state.shop.salesLive?.revenue || 0,
      liveUnits: app.state.shop.salesLive?.units || 0,
      nextTransactionNo: app.state.shop.nextTransactionNo,
    };
    const customerName = clubhouse.sendToCounter(skuIds, 'card');
    return {
      skuIds,
      shelfBefore,
      customerName,
      financialBefore,
      reviewsBefore: (app.state.club.reviews || []).length,
      lostSalesBefore: app.state.shop.lostSalesTotal || 0,
    };
  });
  assert(fixture.customerName, 'Could not create the deterministic patience customer.');
  await page.waitForFunction(([name, count]) => {
    const clubhouse = window.__fw.scene3d.clubhouse();
    const tx = clubhouse.register.getTx();
    return tx?.items.length === count
      && clubhouse.register.getCustomer()?.name === name
      && clubhouse.checkoutQueue()[0]?.name === name;
  }, [fixture.customerName, fixture.skuIds.length], { timeout: 30000 });

  const heldAtCounter = await page.evaluate((name) => {
    const app = window.__fw;
    const customer = app.scene3d.clubhouse().customers().find((entry) => entry.name === name);
    return {
      uids: customer.cart.map((item) => item.uid),
      shelf: Object.fromEntries(customer.cart.map((item) => [
        item.skuId,
        app.state.shop.inventory[item.skuId].shelf,
      ])),
      held: structuredClone(app.state.shop.held || []),
      queue: app.scene3d.clubhouse().checkoutQueue(),
    };
  }, fixture.customerName);
  assert(heldAtCounter.uids.length === fixture.skuIds.length,
    'The customer did not hold every fixture unit at the counter.');
  await shot('01-customer-waiting-with-held-stock.png');

  await page.keyboard.press('e');
  await page.waitForFunction(() => window.__fw.scene3d.clubhouse().register.isActive(), null,
    { timeout: 10000 });
  await page.evaluate(() => {
    const customer = window.__fw.scene3d.clubhouse().register.getCustomer();
    customer.patience = 300;
    const probe = window.__patienceGeometryProbe;
    probe.active = true;
    probe.uuids = [];
    probe.frames = [];
    let previous = performance.now();
    const tick = (now) => {
      const liveProbe = window.__patienceGeometryProbe;
      if (!liveProbe?.active) return;
      const current = window.__fw.scene3d.clubhouse().register
        .getCustomer()?.patienceMesh?.geometry?.uuid || null;
      liveProbe.uuids.push(current);
      liveProbe.frames.push(now - previous);
      previous = now;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const rendererBefore = await page.evaluate(() => ({ ...window.__fw.scene3d.renderer.info.memory }));
  await page.waitForTimeout(5000);
  const activeSample = await page.evaluate(() => {
    const probe = window.__patienceGeometryProbe;
    probe.active = false;
    const uuids = probe.uuids.filter(Boolean);
    let geometryChanges = 0;
    for (let index = 1; index < uuids.length; index += 1) {
      if (uuids[index] !== uuids[index - 1]) geometryChanges += 1;
    }
    const frames = probe.frames.slice(5);
    const durationMs = frames.reduce((sum, value) => sum + value, 0);
    return {
      frames: frames.length,
      avgFps: +(frames.length * 1000 / durationMs).toFixed(2),
      uniquePatienceGeometryUuids: new Set(uuids).size,
      patienceGeometryChanges: geometryChanges,
      ringGeometryDisposals: probe.ringDisposals,
      totalGeometryDisposals: probe.totalDisposals,
      activelyServed: window.__fw.scene3d.clubhouse().register.isActive(),
      frozenPatience: window.__fw.scene3d.clubhouse().register.getCustomer()?.patience,
      rendererAfter: { ...window.__fw.scene3d.renderer.info.memory },
    };
  });
  assert(activeSample.activelyServed && activeSample.frozenPatience === 300,
    'Active cashier service did not freeze the customer patience clock.');
  assert(activeSample.uniquePatienceGeometryUuids === 1
    && activeSample.patienceGeometryChanges === 0
    && activeSample.ringGeometryDisposals === 0,
  `Patience rendering churned while active: ${JSON.stringify(activeSample)}.`);
  await shot('02-active-service-freezes-patience.png');

  // Escape is the normal player route for parking a transaction. Only the
  // fixture clock is compressed below; abandonment, review, stock, queue, and
  // physical exit all remain owned by the production update loop.
  let escapePresses = 0;
  for (; escapePresses < 4; escapePresses += 1) {
    const active = await page.evaluate(() => (
      window.__fw.scene3d.clubhouse().register.isActive()
    ));
    if (!active) break;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
  }
  assert(!await page.evaluate(() => window.__fw.scene3d.clubhouse().register.isActive()),
    `Escape hierarchy did not release the register after ${escapePresses} normal presses.`);
  await page.evaluate(async (name) => {
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    const customer = clubhouse.customers().find((entry) => entry.name === name);
    if (!customer) throw new Error('Patience customer disappeared before expiry was armed.');
    const { reviewFor } = await import(new URL('src/sim/reviews.js', document.baseURI).href);
    const visit = {
      waitedSec: 601,
      queueLen: 0,
      bought: false,
      played: false,
      foundWhatTheyWanted: false,
    };
    let seed = 0;
    for (; seed < 1000; seed += 1) {
      if (reviewFor(app.state, visit, seed).cited.some((factor) => factor.id === 'waitTime')) break;
    }
    customer.seed = seed / 1000;
    customer.queuedAt = -601;
    customer.queueLenOnArrival = 0;
    customer.patience = 0.08;
  }, fixture.customerName);

  await page.waitForFunction((name) => {
    const customer = window.__fw.scene3d.clubhouse().customers()
      .find((entry) => entry.name === name);
    return !!customer?.impatientBeat;
  }, fixture.customerName, { timeout: 5000, polling: 'raf' });
  await shot('03-visible-impatient-reaction.png');

  await page.waitForFunction((name) => {
    const clubhouse = window.__fw.scene3d.clubhouse();
    const customer = clubhouse.customers().find((entry) => entry.name === name);
    return customer?.giveUpHandled
      && customer.cart.length === 0
      && !customer.queued
      && !clubhouse.register.getTx();
  }, fixture.customerName, { timeout: 8000, polling: 'raf' });
  await shot('04-stock-returned-and-bad-review-toast.png');

  const cleanup = await page.evaluate(({ name, skuIds, uids }) => {
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    const customer = clubhouse.customers().find((entry) => entry.name === name);
    const held = app.state.shop.held || [];
    return {
      customer: customer ? {
        name: customer.name,
        phase: customer.checkoutPhase,
        giveUpHandled: customer.giveUpHandled,
        queued: customer.queued,
        cart: customer.cart.map((item) => item.uid),
      } : null,
      shelf: Object.fromEntries(skuIds.map((id) => [id, app.state.shop.inventory[id].shelf])),
      fixtureHeld: held.filter((unit) => uids.includes(unit.uid)),
      queue: clubhouse.checkoutQueue(),
      active: clubhouse.register.isActive(),
      tx: clubhouse.register.getTx(),
      reviews: structuredClone(app.state.club.reviews || []),
      lostSales: app.state.shop.lostSalesTotal || 0,
      financial: {
        cash: app.state.cash,
        shopSales: app.state.ledger.today.revenue.shopSales || 0,
        history: (app.state.shop.transactionHistory || []).length,
        liveRevenue: app.state.shop.salesLive?.revenue || 0,
        liveUnits: app.state.shop.salesLive?.units || 0,
        nextTransactionNo: app.state.shop.nextTransactionNo,
      },
    };
  }, { name: fixture.customerName, skuIds: fixture.skuIds, uids: heldAtCounter.uids });
  assert(JSON.stringify(cleanup.shelf) === JSON.stringify(fixture.shelfBefore),
    `Abandonment did not restore exact shelf counts: ${JSON.stringify(cleanup.shelf)}.`);
  assert(cleanup.fixtureHeld.length === 0, 'Abandoned fixture UIDs remain in the held ledger.');
  assert(cleanup.queue.length === 0 && !cleanup.active && !cleanup.tx,
    'Abandonment left queue or register ownership behind.');
  assert(cleanup.reviews.length === fixture.reviewsBefore + 1,
    'Abandonment did not append exactly one review.');
  assert(cleanup.reviews[0]?.cited?.includes('waitTime'),
    `The bad review does not cite the checkout wait: ${JSON.stringify(cleanup.reviews[0])}.`);
  assert(cleanup.lostSales === fixture.lostSalesBefore + 1,
    'Abandonment did not record exactly one lost sale.');
  assert(JSON.stringify(cleanup.financial) === JSON.stringify(fixture.financialBefore),
    'Abandonment changed cash, revenue, history, units, or transaction numbering.');

  await page.waitForFunction((name) => (
    !window.__fw.scene3d.clubhouse().customers().some((entry) => entry.name === name)
  ), fixture.customerName, { timeout: 60000 });
  await shot('05-customer-physically-departed.png');

  await cdp.send('HeapProfiler.collectGarbage');
  const heapAfter = await page.evaluate(() => (
    performance.memory ? performance.memory.usedJSHeapSize : null
  ));
  const finalResources = await page.evaluate(() => ({
    renderer: { ...window.__fw.scene3d.renderer.info.memory },
    ringGeometryDisposals: window.__patienceGeometryProbe.ringDisposals,
    totalGeometryDisposals: window.__patienceGeometryProbe.totalDisposals,
  }));
  const nonAbortedFailedRequests = failedRequests.filter((failure) => (
    !/ERR_ABORTED|NS_BINDING_ABORTED/i.test(failure.error)
  ));
  assert(finalResources.ringGeometryDisposals >= 1,
    'The departed customer did not dispose the owned patience ring geometry.');
  assert(errors.length === 0, `Runtime errors: ${errors.join(' | ')}`);
  assert(nonAbortedFailedRequests.length === 0,
    `Request failures: ${JSON.stringify(nonAbortedFailedRequests)}`);

  return {
    ok: true,
    protocol: {
      viewport: '1600x900',
      activeSampleMs: 5000,
      activeCustomerPatience: 300,
      compressedExpiryPatience: 0.08,
      escapePresses,
      route: 'normal E entry, normal Escape exit, production impatient beat, stock surrender, queue release, review, and physical departure',
    },
    fixture,
    heldAtCounter,
    rendererBefore,
    activeSample,
    cleanup,
    finalResources,
    heapBeforeBytes: heapBefore,
    heapAfterBytes: heapAfter,
    heapDeltaBytes: heapBefore == null || heapAfter == null ? null : heapAfter - heapBefore,
    evidence,
    diagnostics: { errors, warnings, failedRequests, nonAbortedFailedRequests },
  };
}
