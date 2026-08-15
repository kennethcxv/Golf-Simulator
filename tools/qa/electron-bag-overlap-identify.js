// PLAYTEST 4, ITEM 4 — WHAT IS THE THING THAT IS INSIDE THE BAG?
//
// electron-goods-vs-bag-real found a persistent 0.1375 yd penetration between
// `FrontDeskShoppingBag` and an item whose uid is `anonymous-1`. That uid is not
// one of the three SKUs the fixture customer carries, so before anything is
// "fixed" this establishes WHAT is overlapping, WHO put it there, and by which
// code path -- naming the wrong culprit is how the last two rounds of this item
// were closed while the owner kept seeing it.
//
// It reports, for every item that intersects a bag: its uid, its mesh name, its
// parent chain, its world and interior-local position, whether the register knows
// it as a transaction item, and whether `placedAt` was written for it.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-bag-overlap-identify.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/bag-overlap-id');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  await page.setViewportSize({ width: 1600, height: 900 });
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
  await page.waitForTimeout(1500);
  await page.mouse.click(800, 450);
  await page.waitForTimeout(150);

  // Without a customer there are no items in the scene at all and every overlap
  // question answers itself. Same staging as electron-goods-vs-bag-real.
  const SKUS = ['tees1', 'marker1', 'glove1'];
  await page.evaluate(async (skuIds) => {
    const app = window.__fw;
    const { REGISTER } = await import(new URL('src/data/shopLayout.js', document.baseURI).href);
    const ch = app.scene3d.clubhouse();
    ch.setOrganicWalkins(false);
    for (const id of Object.keys(app.state.shop.inventory)) {
      if (skuIds.includes(id)) app.state.shop.inventory[id].shelf = Math.max(app.state.shop.inventory[id].shelf, 12);
    }
    app.speedIdx = 0;
    app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440 + 14 * 60;
    app.scene3d.applyTimeWeather(14 * 60, app.state.weather);
    ch.rebuildStock();
    const walk = app.scene3d.walk.state;
    const off = ch.interior.position;
    walk.x = REGISTER.stand.x + off.x;
    walk.z = REGISTER.stand.z + off.z;
    const dx = REGISTER.monitor.x - REGISTER.stand.x;
    const dz = REGISTER.monitor.z - REGISTER.stand.z;
    const h = Math.hypot(dx, dz) || 0.001;
    walk.yaw = Math.atan2(-dx / h, -dz / h);
    walk.pitch = Math.atan2(1.18 - 1.62, h);
    ch.sendToCounter(skuIds, 'cash');
  }, SKUS);
  // Wait for the goods to be DOWN, not merely for a customer to exist.
  await page.waitForFunction(() => {
    const ch = window.__fw.scene3d.clubhouse();
    let n = 0;
    window.__fw.scene3d.scene.traverse((o) => { if (o.visible && o.userData?.kind === 'item') n += 1; });
    return n >= 3 && !!ch.register?.getTx?.();
  }, null, { timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(4000);

  out.identify = await page.evaluate(async () => {
    const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
    const app = window.__fw;
    const ch = app.scene3d.clubhouse();
    const scene = app.scene3d.scene;
    const interior = ch.interior;

    const bags = [];
    const items = [];
    scene.traverse((o) => {
      if (!o.visible) return;
      if (o.userData?.kind === 'bag') bags.push(o);
      else if (o.userData?.kind === 'item') items.push(o);
    });

    const chainOf = (o) => {
      const names = [];
      let at = o;
      for (let i = 0; i < 8 && at; i += 1) { names.push(at.name || `(${at.type})`); at = at.parent; }
      return names;
    };

    const tx = ch.register?.getTx?.() || null;
    const rows = [];
    for (const bag of bags) {
      const bagBox = new THREE.Box3().setFromObject(bag);
      for (const item of items) {
        const b = new THREE.Box3().setFromObject(item);
        const ox = Math.min(bagBox.max.x, b.max.x) - Math.max(bagBox.min.x, b.min.x);
        const oy = Math.min(bagBox.max.y, b.max.y) - Math.max(bagBox.min.y, b.min.y);
        const oz = Math.min(bagBox.max.z, b.max.z) - Math.max(bagBox.min.z, b.min.z);
        if (!(ox > 0 && oy > 0 && oz > 0)) continue;
        const world = item.getWorldPosition(new THREE.Vector3());
        const local = interior.worldToLocal(world.clone());
        const uid = item.userData?.uid ?? null;
        const txItem = tx?.items?.find((it) => it.uid === uid) || null;
        rows.push({
          uid,
          meshName: item.name || null,
          chain: chainOf(item),
          userData: Object.fromEntries(Object.entries(item.userData || {}).filter(([, v]) => typeof v !== 'object')),
          world: [+world.x.toFixed(3), +world.y.toFixed(3), +world.z.toFixed(3)],
          interiorLocal: [+local.x.toFixed(3), +local.y.toFixed(3), +local.z.toFixed(3)],
          size: [+(b.max.x - b.min.x).toFixed(3), +(b.max.y - b.min.y).toFixed(3), +(b.max.z - b.min.z).toFixed(3)],
          penetration: +Math.min(ox, oy, oz).toFixed(4),
          bagName: bag.name || null,
          bagChain: chainOf(bag),
          bagSize: [
            +(bagBox.max.x - bagBox.min.x).toFixed(3),
            +(bagBox.max.y - bagBox.min.y).toFixed(3),
            +(bagBox.max.z - bagBox.min.z).toFixed(3),
          ],
          isTransactionItem: !!txItem,
          hasPlacedAt: !!txItem?.placedAt,
          placedAt: txItem?.placedAt ? { ...txItem.placedAt } : null,
        });
      }
    }
    return {
      bagCount: bags.length,
      itemCount: items.length,
      bagNames: bags.map((b) => b.name || '(unnamed)'),
      itemNames: items.map((i) => `${i.userData?.uid ?? '?'}:${i.name || '(unnamed)'}`),
      txItems: tx?.items?.length ?? null,
      overlaps: rows,
    };
  });
  console.log('IDENTIFY', JSON.stringify(out.identify, null, 2));
  fs.writeFileSync(path.join(OUT, 'bag-overlap-id.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
