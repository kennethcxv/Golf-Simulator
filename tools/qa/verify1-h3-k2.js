// VERIFIER 1 — H3 (no price/swing tag at checkout) + K2 (bag on the counter at
// ring start?) + the H1 register-mode a-z 0-9 sweep in a LIVE transaction.
//
// Order matters: the H3 close-ups are taken from walk mode BEFORE E engages the
// till (leaving register mode can clear the staged goods), then E starts the
// ringing for K2's second frame, then the key sweep runs inside the live sale.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/verify1');
  fs.mkdirSync(OUT, { recursive: true });

  const faults = [];
  let phase = '(boot)';
  page.on('pageerror', (e) => faults.push({ phase, message: String(e && e.message || e) }));

  await page.setViewportSize({ width: 1600, height: 900 });
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 240000 });
  await page.waitForTimeout(3500);

  const standAtRegister = () => page.evaluate(async () => {
    const app = window.__fw;
    const { REGISTER } = await import(new URL('src/data/shopLayout.js', document.baseURI).href);
    const off = app.scene3d.clubhouse().interior.position;
    const walk = app.scene3d.walk.state;
    walk.x = REGISTER.stand.x + off.x;
    walk.z = REGISTER.stand.z + off.z;
    const dx = REGISTER.monitor.x - REGISTER.stand.x;
    const dz = REGISTER.monitor.z - REGISTER.stand.z;
    const h = Math.hypot(dx, dz) || 0.001;
    walk.yaw = Math.atan2(-dx / h, -dz / h);
    walk.pitch = Math.atan2(1.18 - 1.62, h);
  });

  phase = 'stage';
  const staged = await page.evaluate(async () => {
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    const skus = ['tees1', 'marker1', 'glove1'];
    for (const id of skus) {
      const inv = app.state.shop.inventory[id];
      if (inv) inv.shelf = Math.max(inv.shelf || 0, 8);
    }
    clubhouse.rebuildStock?.();
    app.speedIdx = 0;
    app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440 + 14 * 60;
    app.scene3d.applyTimeWeather?.(14 * 60, app.state.weather);
    const customer = clubhouse.sendToCounter(skus, 'cash');
    return { ok: !!customer, skus };
  });
  await standAtRegister();

  // K2 poll: 150ms cadence up to 45s, recording tx + bag + staged item meshes
  const bagProbe = () => page.evaluate(() => {
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    const reg = clubhouse.register;
    const bags = [];
    clubhouse.interior.traverse((o) => {
      if (o.name === 'FrontDeskShoppingBag') {
        let visible = o.visible; let p = o.parent;
        while (visible && p) { visible = p.visible; p = p.parent; }
        const wp = o.getWorldPosition(new (o.position.constructor)());
        bags.push({ visible, selfVisible: o.visible, layersMask: o.layers?.mask, world: { x: +wp.x.toFixed(2), y: +wp.y.toFixed(2), z: +wp.z.toFixed(2) } });
      }
    });
    // Staged goods used to be counted by their printed barcode label. The label
    // is gone (H3, 2026-08-06) — count the product meshes themselves.
    let stagedMeshes = 0;
    clubhouse.interior.traverse((o) => { if (o.userData?.kind === 'item') stagedMeshes += 1; });
    const tx = reg?.getTx?.() || null;
    return {
      regActive: !!reg?.isActive?.(),
      hasTx: !!tx,
      stage: tx ? tx.stage : null,
      itemCount: tx ? (tx.items || []).length : 0,
      stagedMeshes,
      bagCount: bags.length,
      bag: bags[0] || null,
    };
  });

  phase = 'k2-poll';
  const timeline = [];
  let ringStartShot = null;
  let firstItemShot = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 45000) {
    const tick = await bagProbe().catch((e) => ({ error: String(e) }));
    tick.tMs = Date.now() - t0;
    timeline.push(tick);
    if (!ringStartShot && tick.hasTx) {
      ringStartShot = 'k2-ring-start.png';
      await page.screenshot({ path: path.join(OUT, ringStartShot) });
    }
    if (!firstItemShot && tick.stagedMeshes > 0) {
      firstItemShot = 'k2-first-item.png';
      await page.screenshot({ path: path.join(OUT, firstItemShot) });
    }
    if (ringStartShot && firstItemShot && tick.tMs > 12000) break;
    await page.waitForTimeout(150);
  }

  // ---- H3 audit + 3 angles, all from walk mode (before the till engages) ----
  phase = 'h3-audit';
  await page.waitForTimeout(3000);
  const audit = await page.evaluate(() => {
    const app = window.__fw;
    const interior = app.scene3d.clubhouse().interior;
    const counts = { tether: 0, backing: 0, carrier: 0, barcode: 0, stagedItems: 0, bagNodes: 0 };
    const suspects = [];
    const rx = /tether|backing|carrier|swing|price.?tag|pricerail|hangtag/i;
    interior.traverse((o) => {
      if (o.name === 'RuntimeProductBarcodeTether') counts.tether += 1;
      else if (o.name === 'RuntimeProductBarcodeBacking') counts.backing += 1;
      else if (o.name === 'RuntimeProductBarcodeCarrier') counts.carrier += 1;
      else if (o.name === 'RuntimeProductBarcode') counts.barcode += 1;
      if (o.userData?.kind === 'item') counts.stagedItems += 1;
      if (o.name === 'FrontDeskShoppingBag') counts.bagNodes += 1;
      if (o.name && rx.test(o.name)) {
        let visible = o.visible; let p = o.parent;
        while (visible && p) { visible = p.visible; p = p.parent; }
        const wp = o.getWorldPosition(new (o.position.constructor)());
        suspects.push({ name: o.name, visible, world: { x: +wp.x.toFixed(2), y: +wp.y.toFixed(2), z: +wp.z.toFixed(2) } });
      }
    });
    return { counts, suspects: suspects.slice(0, 30) };
  });
  await page.screenshot({ path: path.join(OUT, 'h3-counter-staged.png') });

  const aimAtGoods = (pitch) => page.evaluate(async (p) => {
    const app = window.__fw;
    const { REGISTER } = await import(new URL('src/data/shopLayout.js', document.baseURI).href);
    const off = app.scene3d.clubhouse().interior.position;
    const walk = app.scene3d.walk.state;
    const gx = REGISTER.goods ? REGISTER.goods.x : REGISTER.scanner.x;
    const gz = REGISTER.goods ? REGISTER.goods.z : REGISTER.scanner.z;
    const dx = (gx + off.x) - walk.x;
    const dz = (gz + off.z) - walk.z;
    const h = Math.hypot(dx, dz) || 0.001;
    walk.yaw = Math.atan2(-dx / h, -dz / h);
    walk.pitch = p;
  }, pitch);
  await aimAtGoods(-0.52);
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(OUT, 'h3-counter-close.png') });

  await page.evaluate(async () => {
    const app = window.__fw;
    const { REGISTER } = await import(new URL('src/data/shopLayout.js', document.baseURI).href);
    const off = app.scene3d.clubhouse().interior.position;
    const walk = app.scene3d.walk.state;
    const gx = REGISTER.goods ? REGISTER.goods.x : REGISTER.scanner.x;
    const gz = REGISTER.goods ? REGISTER.goods.z : REGISTER.scanner.z;
    const sx = REGISTER.stand.x + off.x; const sz = REGISTER.stand.z + off.z;
    const ax = (gx + off.x) - sx; const az = (gz + off.z) - sz;
    const ah = Math.hypot(ax, az) || 0.001;
    const px = -az / ah; const pz = ax / ah;
    walk.x = sx + px * 1.0; walk.z = sz + pz * 1.0;
    const dx = (gx + off.x) - walk.x; const dz = (gz + off.z) - walk.z;
    const h = Math.hypot(dx, dz) || 0.001;
    walk.yaw = Math.atan2(-dx / h, -dz / h);
    walk.pitch = -0.45;
  });
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(OUT, 'h3-counter-side.png') });

  // ---- K2 part two: E engages the till — the ringing actually starts --------
  phase = 'k2-engage';
  await standAtRegister();
  await page.waitForTimeout(500);
  await page.keyboard.press('e');
  const regEngaged = await page.waitForFunction(
    () => window.__fw.scene3d.clubhouse().register?.isActive?.(),
    null, { timeout: 20000 },
  ).then(() => true).catch(() => false);
  let k2AtEngage = null;
  if (regEngaged) {
    await page.waitForTimeout(1200); // camera ease
    k2AtEngage = await bagProbe();
    await page.screenshot({ path: path.join(OUT, 'k2-ring-active.png') });
  }

  // ---- H1: full a-z 0-9 sweep INSIDE register mode --------------------------
  phase = 'reg-sweep';
  const regSweep = [];
  let restages = 0;
  if (regEngaged) {
    const keys = 'abcdefghijklmnopqrstuvwxyz0123456789'.split('');
    for (let ki = 0; ki < keys.length; ki++) {
      const key = keys[ki];
      let m = await bagProbe();
      let pauseOpen = await page.evaluate(() => !!document.querySelector('.pause-veil-ui'));
      if (pauseOpen) { await page.keyboard.press('p'); await page.waitForTimeout(250); }
      if (!m.regActive) {
        if (restages >= 8) { regSweep.push({ key, skipped: 'no register' }); continue; }
        restages += 1;
        phase = `reg-restage-${restages}`;
        await page.evaluate(async () => {
          const app = window.__fw;
          const clubhouse = app.scene3d.clubhouse();
          const skus = ['tees1'];
          for (const id of skus) {
            const inv = app.state.shop.inventory[id];
            if (inv) inv.shelf = Math.max(inv.shelf || 0, 8);
          }
          clubhouse.rebuildStock?.();
          clubhouse.sendToCounter(skus, 'cash');
        });
        await standAtRegister();
        await page.waitForFunction(() => {
          const reg = window.__fw.scene3d.clubhouse().register;
          return reg?.hasTx?.();
        }, null, { timeout: 30000 }).catch(() => {});
        await page.keyboard.press('e');
        const back = await page.waitForFunction(
          () => window.__fw.scene3d.clubhouse().register?.isActive?.(),
          null, { timeout: 15000 },
        ).then(() => true).catch(() => false);
        if (!back) { regSweep.push({ key, skipped: 'register never re-engaged' }); continue; }
      }
      phase = `reg-${key}`;
      const before = faults.length;
      await page.keyboard.press(key);
      await page.waitForTimeout(100);
      if (key === 'p') { await page.keyboard.press('p'); await page.waitForTimeout(150); }
      const veil = await page.evaluate(() => [...document.querySelectorAll('div')]
        .some((n) => n.textContent && n.textContent.includes('The game hit a problem') && n.offsetParent !== null));
      const regStill = await page.evaluate(() => !!window.__fw.scene3d.clubhouse().register?.isActive?.());
      regSweep.push({ key, newFaults: faults.length - before, veil, regStillActive: regStill });
      if (veil) { await page.screenshot({ path: path.join(OUT, `h1-reg-veil-${key}.png`) }); break; }
    }
    await page.screenshot({ path: path.join(OUT, 'h1-reg-after-sweep.png') });
    phase = 'reg-exit';
    await page.keyboard.press('Escape');
    await page.waitForTimeout(700);
  }

  // K2 summary
  const ringTick = timeline.find((t) => t.hasTx);
  const itemTick = timeline.find((t) => t.stagedMeshes > 0);
  const k2 = {
    ringStartSeen: !!ringTick,
    ringStartAtMs: ringTick ? ringTick.tMs : null,
    bagAtTxBegin: ringTick ? { count: ringTick.bagCount, ...ringTick.bag } : null,
    firstItemAtMs: itemTick ? itemTick.tMs : null,
    bagAtFirstItem: itemTick ? { count: itemTick.bagCount, ...itemTick.bag } : null,
    bagVisibleEveryTick: timeline.length > 0 && timeline.every((t) => t.bag && t.bag.visible),
    regEngaged,
    bagAtEngage: k2AtEngage ? { count: k2AtEngage.bagCount, ...k2AtEngage.bag, stage: k2AtEngage.stage } : null,
    shots: { ringStartShot, firstItemShot, ringActive: regEngaged ? 'k2-ring-active.png' : null },
  };

  const checks = {
    customerStaged: staged.ok,
    noTether: audit.counts.tether === 0,
    noBacking: audit.counts.backing === 0,
    noCarrier: audit.counts.carrier === 0,
    // INVERTED 2026-08-06: this used to require a printed sticker on every item.
    // That assertion is why "tags removed" shipped green twice with a white
    // label still riding the goods across the counter.
    noPrintedLabelOnGoods: audit.counts.barcode === 0,
    goodsActuallyStaged: audit.counts.stagedItems >= 1,
    regSweepRan: regSweep.filter((r) => !r.skipped).length === 36,
    noVeil: !regSweep.some((r) => r.veil),
    noPageErrors: faults.length === 0,
  };
  const out = {
    staged, k2, audit, regSweep, regRestages: restages,
    timelineSample: timeline.filter((_, i) => i % 8 === 0),
    faults: faults.slice(0, 12), checks,
    ok: Object.values(checks).every(Boolean),
  };
  fs.writeFileSync(path.join(OUT, 'h3-k2.json'), `${JSON.stringify(out, null, 1)}\n`);
  return out;
}
