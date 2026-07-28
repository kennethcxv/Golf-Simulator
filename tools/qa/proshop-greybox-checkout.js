async (page) => {
  // ONE SCRIPTED FULL TRANSACTION AT THE V2 COUNTER — FLOOR_PLAN.md §9's checkout row.
  //
  //   QA_BASE_URL="http://localhost:8457/?clubhouse=pine-hills-v2" \
  //     node tools/qa/run-playwright.cjs tools/qa/proshop-greybox-checkout.js --bootstrap
  //
  // The committed simplified-register acceptance driver pins a scan-evidence contract
  // (`lastRead.mode === 'direct-to-bag'`) that no committed register emits — it fails
  // identically in BOTH rooms (measured), so it cannot gate the variant. This script
  // drives the same physical flow (send customer, click each product through the
  // glass, let card payment complete) and asserts the LIVE contracts instead: flow
  // states, per-item scanned/bagged flags, the sale total, and the business deltas
  // (units, cash, ledger, history).
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = path.resolve(process.env.QA_REPO_ROOT || process.cwd());
  const outDir = path.resolve(process.env.GREYBOX_DATA_OUT
    || path.join(repo, 'Designs', 'ProShop', 'Greybox', 'data'));
  fs.mkdirSync(outDir, { recursive: true });
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/?clubhouse=pine-hills-v2';
  const SKUS = ['tees1', 'marker1', 'glove1'];

  const errs = [];
  page.on('pageerror', (e) => errs.push(`PAGEERROR: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(`CONSOLE: ${m.text()}`); });

  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.waitForTimeout(900);
  await page.getByText('Continue', { exact: true }).click().catch(() => {});
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 60000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
  }, null, { timeout: 60000 });
  await page.waitForTimeout(1200);
  await page.mouse.click(800, 450);
  await page.waitForTimeout(200);

  // Fixture: stock, frozen 2 PM, no organic walk-ins, cashier at the v2 staff stand.
  const before = await page.evaluate(async (skuIds) => {
    const app = window.__fw;
    const { REGISTER } = await import('/src/data/shopLayout.js');
    const clubhouse = app.scene3d.clubhouse();
    clubhouse.setOrganicWalkins(false);
    clubhouse.clearWalkins();
    for (const id of skuIds) {
      const line = app.state.shop.inventory[id];
      line.shelf = Math.max(line.shelf, 12);
    }
    app.speedIdx = 0;
    app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440 + 14 * 60;
    app.scene3d.applyTimeWeather(14 * 60, app.state.weather);
    clubhouse.rebuildStock();
    const off = clubhouse.interior.position;
    const walk = app.scene3d.walk.state;
    walk.x = REGISTER.stand.x + off.x;
    walk.z = REGISTER.stand.z + off.z;
    const dx = REGISTER.monitor.x - REGISTER.stand.x;
    const dz = REGISTER.monitor.z - REGISTER.stand.z;
    const horizontal = Math.hypot(dx, dz) || 0.001;
    walk.yaw = Math.atan2(-dx / horizontal, -dz / horizontal);
    walk.pitch = Math.atan2(1.18 - 1.62, horizontal);
    const shop = app.state.shop;
    const snapshot = {
      cash: app.state.cash,
      ledgerShopSales: app.state.ledger?.today?.revenue?.shopSales || 0,
      units: (shop.salesLive || {}).units || 0,
      history: (shop.transactionHistory || []).length,
      shelf: Object.fromEntries(skuIds.map((id) => [id, shop.inventory[id].shelf])),
      registerAt: { x: REGISTER.monitor.x, z: REGISTER.monitor.z },
      standAt: { x: REGISTER.stand.x, z: REGISTER.stand.z },
    };
    clubhouse.sendToCounter(skuIds, 'card');
    return snapshot;
  }, SKUS);

  // Wait for the customer's goods, then [E] into the register: a retail arrival
  // with unscanned goods opens on the scan workspace.
  await page.waitForFunction(() => {
    const register = window.__fw.scene3d.clubhouse().register;
    const tx = register.getTx?.();
    return !!tx && tx.items?.length === 3;
  }, null, { timeout: 60000 });
  await page.waitForTimeout(600);
  await page.keyboard.press('e');
  await page.waitForFunction(() => window.__fw.scene3d.clubhouse().register.isActive(), null, { timeout: 8000 });
  await page.waitForFunction(() => (
    window.__fw.scene3d.clubhouse().register.workspace() === 'scan'
  ), null, { timeout: 15000 });
  await page.waitForTimeout(1400);

  const projectItem = (uid) => page.evaluate(async (id) => {
    const THREE = await import('three');
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    const mesh = clubhouse.register.itemMesh?.(id)
      || (() => {
        let found = null;
        clubhouse.interior.traverse((node) => {
          if (!found && node.userData?.uid === id && node.userData?.kind === 'item') found = node;
        });
        return found;
      })();
    if (!mesh) return null;
    const world = mesh.getWorldPosition(new THREE.Vector3());
    const ndc = world.clone().project(app.scene3d.camera);
    return {
      x: (ndc.x + 1) / 2 * 1600,
      y: (1 - (ndc.y + 1) / 2) * 900,
      inView: ndc.z < 1 && Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1,
    };
  }, uid);

  const uids = await page.evaluate(() => (
    window.__fw.scene3d.clubhouse().register.getTx().items.map((item) => item.uid)
  ));
  const scans = [];
  for (const uid of uids) {
    let landed = false;
    let attempts = 0;
    let read = null;
    while (!landed && attempts < 3) {
      attempts += 1;
      let spot = await projectItem(uid);
      for (let settle = 0; settle < 20; settle += 1) {
        await page.waitForTimeout(180);
        const next = await projectItem(uid);
        if (next && spot && Math.abs(next.x - spot.x) < 1.5 && Math.abs(next.y - spot.y) < 1.5) {
          spot = next;
          break;
        }
        spot = next;
      }
      if (!spot || !spot.inView) continue;
      await page.mouse.click(spot.x, spot.y);
      landed = await page.waitForFunction((id) => {
        const tx = window.__fw.scene3d.clubhouse().register.getTx();
        const item = tx?.items.find((candidate) => candidate.uid === id);
        return !!(item?.scanned && item?.bagged);
      }, uid, { timeout: 6000 }).then(() => true).catch(() => false);
      read = await page.evaluate(() => (
        window.__fw.scene3d.clubhouse().register.scanPresentation().lastRead
      ));
      await page.waitForFunction(() => {
        const state = window.__fw.scene3d.clubhouse().register.getFlow()?.state;
        return state === 'WaitingForScan' || state === 'AllProductsScanned';
      }, null, { timeout: 8000 }).catch(() => {});
    }
    scans.push({
      uid,
      ok: landed && !!read?.ok,
      attempts,
      scanHit: read?.scanHit ?? null,
      facingDot: read?.facingDot ?? null,
      code: read?.code ?? null,
    });
  }
  await page.screenshot({ path: path.join(outDir, 'greybox-checkout-scanned.png') });

  // Card insertion is automatic; keying the exact total on the terminal is the one
  // deliberate cashier action (the production card route).
  await page.waitForFunction(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return tx && tx.stage === 'card-entry' && tx.checkoutFlow?.state === 'CardAmountEntry';
  }, null, { timeout: 30000 });
  await page.waitForTimeout(900);
  const entry = await page.evaluate(async () => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    const { totalOf } = await import('/src/sim/register.js');
    return { total: totalOf(tx), expectedCents: Math.round(totalOf(tx) * 100) };
  });
  const clickKey = async (actionId) => {
    const point = await page.evaluate((key) => (
      window.__fw.scene3d.clubhouse().register.cardKeyScreenPoint(key)
    ), actionId);
    if (!point?.visible || !point?.inView) throw new Error(`card key ${actionId} not clickable`);
    await page.mouse.click(point.x, point.y);
    await page.waitForTimeout(110);
  };
  for (const digit of String(entry.expectedCents)) await clickKey(`digit:${digit}`);
  await clickKey('confirm');

  // Wait for the transaction to complete and the customer to be released.
  const completion = await page.evaluate(() => new Promise((resolve) => {
    const started = performance.now();
    const tick = () => {
      const app = window.__fw;
      const register = app.scene3d.clubhouse().register;
      const tx = register.getTx?.();
      const flow = register.getFlow?.()?.state || null;
      if (!tx) {
        resolve({ done: true, flow, waitedMs: Math.round(performance.now() - started) });
        return;
      }
      if (performance.now() - started > 90000) {
        resolve({
          done: false,
          flow,
          stage: tx.stage,
          scanned: tx.items.filter((item) => item.scanned).length,
          bagged: tx.items.filter((item) => item.bagged).length,
          waitedMs: Math.round(performance.now() - started),
        });
        return;
      }
      setTimeout(tick, 400);
    };
    tick();
  }));

  const after = await page.evaluate((skuIds) => {
    const app = window.__fw;
    const shop = app.state.shop;
    const lastTx = (shop.transactionHistory || [])[shop.transactionHistory.length - 1] || null;
    return {
      cash: app.state.cash,
      ledgerShopSales: app.state.ledger?.today?.revenue?.shopSales || 0,
      units: (shop.salesLive || {}).units || 0,
      history: (shop.transactionHistory || []).length,
      shelf: Object.fromEntries(skuIds.map((id) => [id, shop.inventory[id].shelf])),
      lastTx: lastTx ? {
        total: lastTx.total ?? lastTx.saleTotal ?? null,
        method: lastTx.method ?? lastTx.payment ?? null,
        items: lastTx.items?.length ?? lastTx.units ?? null,
      } : null,
      drawer: JSON.stringify(shop.drawer || null),
    };
  }, SKUS);
  await page.screenshot({ path: path.join(outDir, 'greybox-checkout-complete.png') });

  const cashDelta = +(after.cash - before.cash).toFixed(2);
  const ledgerDelta = +(after.ledgerShopSales - before.ledgerShopSales).toFixed(2);
  const shelfDelta = SKUS.reduce((sum, id) => sum + (before.shelf[id] - after.shelf[id]), 0);
  const result = {
    room: 'pine-hills-v2',
    registerAt: before.registerAt,
    standAt: before.standAt,
    scans,
    completion,
    saleTotal: entry.total,
    business: {
      cashDelta,
      ledgerDelta,
      unitsDelta: after.units - before.units,
      historyDelta: after.history - before.history,
      shelfUnitsSold: shelfDelta,
      lastTx: after.lastTx,
    },
    errs: errs.slice(0, 12),
    ok: scans.length === 3
      && scans.every((scan) => scan.ok)
      && completion.done === true
      && after.units - before.units === 3
      && shelfDelta === 3
      && after.history - before.history === 1
      && cashDelta > 0
      && Math.abs(cashDelta - ledgerDelta) < 0.005,
  };
  fs.writeFileSync(path.join(outDir, 'greybox-checkout.json'), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}
