// F3 — THREE FAREWELLS FROM LIVE SALES: a good one, a slow one, an expensive
// one. The line must come from the ticket's real facts (subtotal vs MSRP,
// wall-clock processing time), so each sale stages those facts and the
// verdict + facts are read back off the tx.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-f3-farewells.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/f3-farewells');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [], sales: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.bringToFront().catch(() => {});
  await page.waitForTimeout(2500);
  await page.mouse.click(800, 450);

  const stageSale = async (label, { priceFactor, slowWaitMs }) => {
    const SKUS = ['tees1', 'marker1', 'glove1'];
    await page.evaluate(async ([skuIds]) => {
      const app = window.__fw;
      const { REGISTER } = await import(new URL('src/data/shopLayout.js', document.baseURI).href);
      const clubhouse = app.scene3d.clubhouse();
      clubhouse.setOrganicWalkins(false);
      const reg = clubhouse.register;
      if (reg.isActive()) reg.leave({ restorePointer: false });
      for (const id of Object.keys(app.state.shop.inventory)) {
        const inv = app.state.shop.inventory[id];
        if (skuIds.includes(id)) inv.shelf = Math.max(inv.shelf, 12);
      }
      clubhouse.rebuildStock();
      const walk = app.scene3d.walk.state;
      const off = clubhouse.interior.position;
      walk.x = REGISTER.stand.x + off.x;
      walk.z = REGISTER.stand.z + off.z;
      const dx = REGISTER.monitor.x - REGISTER.stand.x;
      const dz = REGISTER.monitor.z - REGISTER.stand.z;
      const h = Math.hypot(dx, dz) || 0.001;
      walk.yaw = Math.atan2(-dx / h, -dz / h);
      walk.pitch = Math.atan2(1.18 - 1.62, h);
      clubhouse.sendToCounter(skuIds, 'card');
    }, [SKUS]);
    await page.waitForFunction(() => {
      const tx = window.__fw.scene3d.clubhouse().register.getTx();
      return tx && tx.items.length === 3;
    }, null, { timeout: 30000 });
    // stage the PRICE facts before ringing up
    await page.evaluate((factor) => {
      const tx = window.__fw.scene3d.clubhouse().register.getTx();
      const { skuById } = window.__f3skus;
      tx.items.forEach((item) => {
        const sku = skuById(item.skuId || item.sku || item.id);
        const msrp = Number(sku?.msrp) || 10;
        item.price = +(msrp * factor).toFixed(2);
        item.priceCents = Math.round(item.price * 100);
      });
    }, priceFactor).catch(async () => {
      await page.evaluate(async (factor) => {
        const mod = await import('./src/data/shopItems.js');
        window.__f3skus = mod;
        const tx = window.__fw.scene3d.clubhouse().register.getTx();
        tx.items.forEach((item) => {
          const sku = mod.skuById(item.skuId || item.sku || item.id);
          const msrp = Number(sku?.msrp) || 10;
          item.price = +(msrp * factor).toFixed(2);
          item.priceCents = Math.round(item.price * 100);
        });
      }, priceFactor);
    });
    await page.keyboard.press('e');
    await page.waitForFunction(() => window.__fw.scene3d.clubhouse().register.isActive(), null, { timeout: 15000 });
    await page.waitForTimeout(1500);
    if (slowWaitMs) await page.waitForTimeout(slowWaitMs);
    // scan+bag by clicking each item
    const uids = await page.evaluate(() => window.__fw.scene3d.clubhouse().register.getTx().items.map((i) => i.uid));
    for (const uid of uids) {
      let point = null;
      for (let attempt = 0; attempt < 25; attempt += 1) {
        point = await page.evaluate(async (id) => {
          const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
          const app = window.__fw;
          let found = null;
          app.scene3d.clubhouse().interior.traverse((o) => {
            if (!found && o.visible && o.userData?.kind === 'item' && o.userData?.uid === id) found = o;
          });
          if (!found) return null;
          const world = new THREE.Box3().setFromObject(found).getCenter(new THREE.Vector3());
          world.project(app.scene3d.camera);
          const rect = document.querySelector('canvas').getBoundingClientRect();
          return {
            x: rect.left + ((world.x + 1) / 2) * rect.width,
            y: rect.top + ((-world.y + 1) / 2) * rect.height,
            inView: Math.abs(world.x) <= 1 && Math.abs(world.y) <= 1,
          };
        }, uid);
        if (point && point.inView) break;
        await page.waitForTimeout(250);
      }
      if (!point || !point.inView) break;
      await page.mouse.click(point.x, point.y);
      await page.waitForFunction((id) => {
        const tx = window.__fw.scene3d.clubhouse().register.getTx();
        const item = tx?.items.find((c) => c.uid === id);
        return !!(item?.scanned && item?.bagged);
      }, uid, { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(400);
    }
    // the presented card must be CLICKED to accept — the flow holds at
    // card-ready until the player takes it
    await page.waitForFunction(() => {
      const reg = window.__fw.scene3d.clubhouse().register;
      const point = reg.presentedCardScreenPoint?.();
      return reg.getTx()?.stage === 'card-ready' && point?.inView;
    }, null, { timeout: 45000 }).then(async () => {
      const point = await page.evaluate(() => window.__fw.scene3d.clubhouse().register.presentedCardScreenPoint());
      if (point) await page.mouse.click(point.x, point.y);
    }).catch(() => {});
    // key the amount and approve — card-entry waits for the PLAYER
    await page.waitForFunction(() => window.__fw.scene3d.clubhouse().register.getTx()?.stage === 'card-entry', null, { timeout: 30000 }).then(async () => {
      const total = await page.evaluate(async () => {
        const { totalOf } = await import(new URL('src/sim/register.js', document.baseURI).href);
        return totalOf(window.__fw.scene3d.clubhouse().register.getTx());
      });
      for (const digit of String(Math.round(total * 100))) {
        const key = await page.evaluate((d) => window.__fw.scene3d.clubhouse().register.cardKeyScreenPoint(d), digit);
        if (key && key.inView) { await page.mouse.click(key.x, key.y); await page.waitForTimeout(140); }
      }
      const ok = await page.evaluate(() => window.__fw.scene3d.clubhouse().register.cardKeyScreenPoint('confirm'));
      if (ok && ok.inView) await page.mouse.click(ok.x, ok.y);
    }).catch(() => {});
    // wait for the sale to reach the farewell stages
    await page.waitForFunction(() => {
      const tx = window.__fw.scene3d.clubhouse().register.getTx();
      return tx && ['receipt', 'bagging', 'done'].includes(tx.stage);
    }, null, { timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(1200);
    const result = await page.evaluate(() => {
      const reg = window.__fw.scene3d.clubhouse().register;
      const tx = reg.getTx();
      return tx ? { stage: tx.stage, farewell: tx.farewell || null, facts: tx.farewellFacts || null } : null;
    });
    out.sales.push({ label, ...result });
    await page.screenshot({ path: path.join(OUT, `${label}.png`) });
    // let the sale complete and the customer leave
    await page.waitForFunction(() => !window.__fw.scene3d.clubhouse().register.getTx(), null, { timeout: 90000 }).catch(() => {});
    await page.evaluate(() => {
      const reg = window.__fw.scene3d.clubhouse().register;
      if (reg.isActive()) reg.leave({ restorePointer: false });
    });
    await page.waitForTimeout(1500);
  };

  await page.evaluate(async () => { window.__f3skus = await import('./src/data/shopItems.js'); });
  await stageSale('good-quick', { priceFactor: 1.0, slowWaitMs: 0 });
  await stageSale('expensive', { priceFactor: 1.5, slowWaitMs: 0 });
  await stageSale('slow', { priceFactor: 1.0, slowWaitMs: 80000 });

  out.verdict = {
    good: out.sales[0]?.farewell || null,
    expensive: out.sales[1]?.farewell || null,
    slow: out.sales[2]?.farewell || null,
    threeDistinctRules: new Set(out.sales.map((s) => (s.farewell || '').split(':')[1])).size === 3,
  };
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(out, null, 2));
  console.log('F3-FAREWELLS', JSON.stringify(out.sales.map((s) => ({ label: s.label, farewell: s.farewell, facts: s.facts }))));
}
