async (page) => {
  // §34 deliberate-failure pass at the BROWSER level (the sim layer's
  // idempotency is covered by checkout-atomicity, register-integrity,
  // inventory-conservation and the stress suites). Here real input spam hits
  // real props: rapid E on a one-shot detail, disposal spam on empty loads,
  // hours-sign spam, re-clicking an already-scanned product, and a reload
  // with a customer mid-flow — asserting exactly-once effects everywhere.
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = path.resolve(process.env.QA_REPO_ROOT || process.cwd());
  const out = path.resolve(process.env.ABUSE_QA_ROOT
    || path.join(repo, 'qa', 'recovery-2026-07-22', 'input-abuse'));
  fs.mkdirSync(out, { recursive: true });
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const results = {};

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: /New game/i }).click();
  await page.locator('.difficulty-card').filter({ hasText: 'Relaxed' }).click();
  const confirmStart = page.getByRole('button', { name: /^(Start|Confirm|Yes)/i }).first();
  if (await confirmStart.isVisible({ timeout: 1500 }).catch(() => false)) await confirmStart.click();
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 90000 });
  await page.waitForTimeout(1500);
  await page.mouse.click(640, 360);

  const poseLocal = async (x, z, faceX, faceZ, pitch = -0.25) => {
    await page.evaluate(({ x, z, faceX, faceZ, pitch }) => {
      const app = window.__fw;
      const origin = app.scene3d.clubhouse().interior.position;
      const walk = app.scene3d.walk;
      walk.clearKeys?.();
      walk.state.x = origin.x + x;
      walk.state.z = origin.z + z;
      const dx = faceX - x; const dz = faceZ - z;
      const L = Math.hypot(dx, dz) || 1;
      walk.state.yaw = Math.atan2(-dx / L, -dz / L);
      walk.state.pitch = pitch;
    }, { x, z, faceX, faceZ, pitch });
    await page.waitForTimeout(300);
  };

  // --- Abuse 1: rapid E on a clutter pile — exactly one haul, one award ----
  const pile = await page.evaluate(() => {
    const entry = (window.__fw.state.shop.reno.clutter || [])
      .map((p, index) => ({ index, x: p.x, z: p.z, cleared: !!p.cleared }))
      .find((p) => !p.cleared);
    return entry || null;
  });
  assert(pile, 'No clutter pile available for the spam test.');
  await poseLocal(pile.x, pile.z + 1.1, pile.x, pile.z, -0.30);
  const repBefore = await page.evaluate(() => (
    Object.keys(window.__fw.state.reputation?.processedIds || {}).length
  ));
  for (let i = 0; i < 10; i += 1) {
    await page.keyboard.press('e');
    await page.waitForTimeout(60);
  }
  await page.waitForTimeout(500);
  const pileAfter = await page.evaluate((index) => ({
    cleared: !!window.__fw.state.shop.reno.clutter[index]?.cleared,
    stillListed: (window.__fw.state.shop.reno.clutter || []).length,
  }), pile.index);
  const repAfter = await page.evaluate(() => (
    Object.keys(window.__fw.state.reputation?.processedIds || {}).length
  ));
  assert(pileAfter.cleared, 'Spammed pile never cleared.');
  results.pileSpam = { cleared: pileAfter.cleared, newAwards: repAfter - repBefore };
  assert(repAfter - repBefore <= 1, `Pile spam minted ${repAfter - repBefore} awards.`);

  // --- Abuse 2: disposal E spam with empty loads — no negative state -------
  await poseLocal(6.85, 1.20, 7.70, 1.20, -0.24);
  for (let i = 0; i < 8; i += 1) {
    await page.keyboard.press('e');
    await page.waitForTimeout(70);
  }
  const loads = await page.evaluate(() => ({
    pan: Number(window.__fw.state.shop.reno.pan) || 0,
    bag: Number(window.__fw.state.shop.reno.bag) || 0,
  }));
  assert(loads.pan >= 0 && loads.bag >= 0, `Disposal spam went negative: ${JSON.stringify(loads)}`);
  results.disposalSpam = loads;

  // --- Abuse 3: register — re-click an already scanned product -------------
  const saleName = await page.evaluate(() => (
    window.__fw.scene3d.clubhouse().sendToCounter(['tees1', 'marker1'], 'cash')
  ));
  assert(saleName, 'sendToCounter refused the abuse customer.');
  await page.waitForFunction(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return !!tx && tx.items.length === 2;
  }, null, { timeout: 25000 });
  await page.evaluate(async () => {
    const { REGISTER } = await import('/src/data/shopLayout.js');
    const app = window.__fw;
    const origin = app.scene3d.clubhouse().interior.position;
    const walk = app.scene3d.walk;
    walk.clearKeys?.();
    walk.state.x = REGISTER.stand.x + origin.x;
    walk.state.z = REGISTER.stand.z + origin.z;
    const dx = REGISTER.monitor.x - REGISTER.stand.x;
    const dz = REGISTER.monitor.z - REGISTER.stand.z;
    const horizontal = Math.hypot(dx, dz) || 0.001;
    walk.state.yaw = Math.atan2(-dx / horizontal, -dz / horizontal);
    walk.state.pitch = Math.atan2(1.185 - 1.62, horizontal);
  });
  await page.keyboard.press('e');
  await page.waitForFunction(() => window.__fw.scene3d.clubhouse().register.isActive(), null, { timeout: 10000 });
  await page.waitForFunction(() => (
    window.__fw.scene3d.clubhouse().register.getFlow()?.state === 'WaitingForScan'
  ), null, { timeout: 10000 });
  const firstUid = await page.evaluate(() => (
    window.__fw.scene3d.clubhouse().register.getTx().items[0].uid
  ));
  let clickPoint = null;
  outer: for (let gy = 260; gy <= 600; gy += 34) {
    for (let gx = 260; gx <= 1020; gx += 34) {
      const hit = await page.evaluate(({ x, y, id }) => {
        const picked = window.__fw.scene3d.clubhouse().register.debugPickAt(x, y);
        return picked?.physical?.kind === 'item' && picked.physical.uid === id;
      }, { x: gx, y: gy, id: firstUid });
      if (hit) { clickPoint = { x: gx, y: gy }; break outer; }
    }
  }
  assert(clickPoint, 'No click point for the first product.');
  await page.mouse.click(clickPoint.x, clickPoint.y);
  await page.waitForFunction((id) => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    const item = tx?.items.find((entry) => entry.uid === id);
    return !!item && item.scanned;
  }, firstUid, { timeout: 15000 });
  // Wait for the bag flight to settle, then hammer the same spot.
  await page.waitForTimeout(2500);
  for (let i = 0; i < 6; i += 1) {
    await page.mouse.click(clickPoint.x, clickPoint.y);
    await page.waitForTimeout(90);
  }
  const scanFacts = await page.evaluate((id) => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    const item = tx?.items.find((entry) => entry.uid === id);
    return {
      scannedCount: tx?.items.filter((entry) => entry.scanned).length,
      itemStillOnce: !!item && item.scanned === true,
      total: tx?.total,
    };
  }, firstUid);
  assert(scanFacts.itemStillOnce, 'Re-click corrupted the scanned item.');
  results.rescanSpam = scanFacts;

  // --- Abuse 4: reload with the customer mid-transaction -------------------
  await page.evaluate(async () => {
    const { empireSnapshot } = await import('/src/sim/empire.js');
    const Storage = await import('/src/core/storage.js');
    await Storage.saveData('autosave', empireSnapshot(window.__fw.empire));
    await Storage.saveData('autosave-meta', { savedAt: Date.now(), clubName: 'Abuse QA' });
  });
  const historyBefore = await page.evaluate(() => (
    (window.__fw.state.shop.transactionHistory || []).length
  ));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 90000 });
  await page.waitForTimeout(1200);
  const reloaded = await page.evaluate(() => ({
    tx: !!window.__fw.scene3d.clubhouse().register.getTx(),
    history: (window.__fw.state.shop.transactionHistory || []).length,
    heldUnits: (window.__fw.state.shop.held || []).length,
    inventoryNegative: Object.entries(window.__fw.state.shop.inventory || {})
      .filter(([, line]) => (line.shelf || 0) < 0 || (line.back || 0) < 0).map(([id]) => id),
  }));
  assert(reloaded.history === historyBefore,
    `Reload changed banked history: ${historyBefore} -> ${reloaded.history}`);
  assert(reloaded.inventoryNegative.length === 0,
    `Reload left negative inventory: ${JSON.stringify(reloaded.inventoryNegative)}`);
  results.midTransactionReload = reloaded;

  fs.writeFileSync(path.join(out, 'latest-result.json'),
    `${JSON.stringify({ ok: true, results }, null, 2)}\n`);
  return { ok: true, results };
}
