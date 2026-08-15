// PLAYTEST 4, ITEM 4 — SECOND REPORT: "I am still watching customers place items
// through the bag."
//
// Last session measured 0.127 yd of overlap removed and the owner still sees it,
// so the check passed and the game did not. The Playtest 3 check called
// `catalogCheckoutLayout` directly and compared the poses it returned against the
// rect it had just been handed. Both halves of that comparison come from the same
// function, so it can only ever confirm the layout agrees with itself.
//
// This measures GEOMETRY. A real customer walks up and puts real goods down; the
// bag's world bounding box comes off the bag object in the scene; each item's
// world bounding box comes off the item mesh; and the overlap is the intersection
// of the two boxes. Nothing here asks the layout what it intended.
//
// NEGATIVE CONTROLS at the end:
//   * an item is moved deliberately INTO the bag and the detector must report it,
//     otherwise "0.000 overlap" is equally consistent with a probe that cannot see
//     an overlap at all;
//   * the bag box is checked for being non-degenerate, because an empty Box3
//     intersects nothing and would report a clean counter forever.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-goods-vs-bag-real.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/goods-vs-bag');
  fs.mkdirSync(OUT, { recursive: true });
  const VIEWPORT = { width: 1600, height: 900 };
  const SKUS = ['tees1', 'marker1', 'glove1'];
  const out = { errs: [] };
  const assert = (v, m) => { if (!v) throw new Error(m); };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  await page.setViewportSize(VIEWPORT);
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
  await page.waitForTimeout(1500);
  await page.mouse.click(VIEWPORT.width / 2, VIEWPORT.height / 2);
  await page.waitForTimeout(150);

  const staged = await page.evaluate(async (skuIds) => {
    const app = window.__fw;
    const { REGISTER } = await import(new URL('src/data/shopLayout.js', document.baseURI).href);
    const clubhouse = app.scene3d.clubhouse();
    clubhouse.setOrganicWalkins(false);
    for (const id of Object.keys(app.state.shop.inventory)) {
      if (skuIds.includes(id)) {
        app.state.shop.inventory[id].shelf = Math.max(app.state.shop.inventory[id].shelf, 12);
      }
    }
    app.speedIdx = 0;
    app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440 + 14 * 60;
    app.scene3d.applyTimeWeather(14 * 60, app.state.weather);
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
    return { customer: !!clubhouse.sendToCounter(skuIds, 'cash'), bagging: { ...REGISTER.bagging } };
  }, SKUS);
  assert(staged.customer, 'no cash fixture customer');
  out.baggingRect = staged.bagging;

  // Watch the SET-DOWN happen. Sampling while it runs matters: an item can pass
  // through the bag on its way down and come to rest clear of it, and a
  // measurement taken only at the end would call that clean.
  const measure = () => page.evaluate(async () => {
    const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
    const app = window.__fw;
    const ch = app.scene3d.clubhouse();
    const scene = app.scene3d.scene;

    const bagBoxes = [];
    const itemBoxes = [];
    scene.traverse((o) => {
      if (!o.visible) return;
      const kind = o.userData?.kind;
      if (kind === 'bag') {
        const b = new THREE.Box3().setFromObject(o);
        if (!b.isEmpty()) bagBoxes.push({ name: o.name || '(bag)', box: b });
      } else if (kind === 'item' && o.userData?.uid) {
        const b = new THREE.Box3().setFromObject(o);
        if (!b.isEmpty()) itemBoxes.push({ uid: o.userData.uid, name: o.name || '(item)', box: b, sku: o.userData.skuId ?? null });
      }
    });

    const overlaps = [];
    for (const bag of bagBoxes) {
      for (const item of itemBoxes) {
        const ox = Math.min(bag.box.max.x, item.box.max.x) - Math.max(bag.box.min.x, item.box.min.x);
        const oy = Math.min(bag.box.max.y, item.box.max.y) - Math.max(bag.box.min.y, item.box.min.y);
        const oz = Math.min(bag.box.max.z, item.box.max.z) - Math.max(bag.box.min.z, item.box.min.z);
        if (ox > 0 && oy > 0 && oz > 0) {
          // WHICH item, and by WHOSE hand. The first version of this driver
          // reported a uid and nothing else, so a real 0.1375 yd overlap could
          // not be traced to the code path that caused it.
          const tx = ch.register?.getTx?.() || null;
          const txItem = tx?.items?.find((it) => it.uid === item.uid) || null;
          overlaps.push({
            bag: bag.name,
            uid: item.uid,
            mesh: item.name,
            // The penetration a player sees is the SHALLOWEST axis: the distance
            // the item would have to move to be clear.
            penetration: +Math.min(ox, oy, oz).toFixed(4),
            volume: +(ox * oy * oz).toFixed(6),
            isTransactionItem: !!txItem,
            hasPlacedAt: !!txItem?.placedAt,
            placedAt: txItem?.placedAt ? { ...txItem.placedAt } : null,
            itemBox: {
              min: [+item.box.min.x.toFixed(3), +item.box.min.y.toFixed(3), +item.box.min.z.toFixed(3)],
              max: [+item.box.max.x.toFixed(3), +item.box.max.y.toFixed(3), +item.box.max.z.toFixed(3)],
            },
          });
        }
      }
    }
    const cust = ch.qaCustomerTrack?.().find((c) => c.checkoutPhase) || null;
    return {
      t: Math.round(performance.now()),
      bags: bagBoxes.map((b) => ({
        name: b.name,
        min: [+b.box.min.x.toFixed(3), +b.box.min.y.toFixed(3), +b.box.min.z.toFixed(3)],
        max: [+b.box.max.x.toFixed(3), +b.box.max.y.toFixed(3), +b.box.max.z.toFixed(3)],
        degenerate: b.box.max.x - b.box.min.x < 1e-4,
      })),
      items: itemBoxes.length,
      overlaps,
      phase: cust?.checkoutPhase ?? null,
      placed: cust?.checkoutPlacedCount ?? null,
    };
  });

  out.samples = [];
  const deadline = Date.now() + 150000;
  let sawPlacing = false;
  let sawItems = 0;
  while (Date.now() < deadline) {
    // eslint-disable-next-line no-await-in-loop
    const row = await measure();
    out.samples.push(row);
    if (row.phase === 'placing') sawPlacing = true;
    sawItems = Math.max(sawItems, row.items);
    if (row.overlaps.length) console.log('OVERLAP', JSON.stringify(row.overlaps));
    // stop once the goods are down and the counter has settled
    if (sawPlacing && row.phase && row.phase !== 'placing' && row.items >= 3) break;
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(350);
  }

  const withBag = out.samples.filter((s) => s.bags.length);
  const worst = out.samples.flatMap((s) => s.overlaps).sort((a, b) => b.penetration - a.penetration)[0] || null;

  // ---- NEGATIVE CONTROLS --------------------------------------------------
  out.control = await page.evaluate(async () => {
    const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
    const scene = window.__fw.scene3d.scene;
    let bag = null;
    let item = null;
    scene.traverse((o) => {
      if (!o.visible) return;
      if (!bag && o.userData?.kind === 'bag') bag = o;
      if (!item && o.userData?.kind === 'item' && o.userData?.uid) item = o;
    });
    if (!bag || !item) return { ran: false, why: `bag=${!!bag} item=${!!item}` };
    const bagBox = new THREE.Box3().setFromObject(bag);
    const before = new THREE.Box3().setFromObject(item);
    const overlapOf = (a, b) => {
      const ox = Math.min(a.max.x, b.max.x) - Math.max(a.min.x, b.min.x);
      const oy = Math.min(a.max.y, b.max.y) - Math.max(a.min.y, b.min.y);
      const oz = Math.min(a.max.z, b.max.z) - Math.max(a.min.z, b.min.z);
      return (ox > 0 && oy > 0 && oz > 0) ? +Math.min(ox, oy, oz).toFixed(4) : 0;
    };
    const clean = overlapOf(bagBox, before);
    // Shove the item into the middle of the bag and require the detector to see it.
    const centre = bagBox.getCenter(new THREE.Vector3());
    const saved = item.position.clone();
    item.parent.worldToLocal(centre);
    item.position.copy(centre);
    item.updateMatrixWorld(true);
    const inside = overlapOf(bagBox, new THREE.Box3().setFromObject(item));
    item.position.copy(saved);
    item.updateMatrixWorld(true);
    return {
      ran: true,
      bagDegenerate: bagBox.max.x - bagBox.min.x < 1e-4,
      overlapWhereItRests: clean,
      overlapWhenPushedIntoTheBag: inside,
      detectorWorks: inside > 0.01,
    };
  });
  console.log('CONTROL', JSON.stringify(out.control));

  await page.screenshot({ path: path.join(OUT, 'goods-vs-bag.png') });
  out.verdict = {
    sawCustomerPlacing: sawPlacing,
    itemsSeen: sawItems,
    samplesWithABagInScene: withBag.length,
    samplesTotal: out.samples.length,
    worstOverlap: worst,
    overlapCount: out.samples.reduce((n, s) => n + s.overlaps.length, 0),
    detectorProved: out.control.detectorWorks === true,
    bagDegenerate: out.control.bagDegenerate ?? null,
    pageErrors: out.errs.slice(0, 6),
  };
  console.log('GOODS-VS-BAG', JSON.stringify(out.verdict, null, 2));
  fs.writeFileSync(path.join(OUT, 'goods-vs-bag.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
