async (page) => {
  // EVIDENCE PROBE — the oversize set-aside. Rings up one oversize SKU
  // (driver1) next to one compact SKU (tees1) and captures where each lands:
  // the compact item slides into the side-lying bag; the oversize club settles
  // at the counter's far-left set-aside spot, laid on its side, and is handed
  // to the customer separately (contract pinned by src/sim/registerFlow.js and
  // tests). Run:
  //   node tools/qa/run-playwright.cjs tools/qa/oversize-setaside-evidence.js --bootstrap
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/cash-register-production/simplified-rebuild/oversize-evidence');
  fs.mkdirSync(OUT, { recursive: true });
  const BASE_URL = process.env.QA_BASE_URL || 'http://localhost:8457/';

  await page.goto(BASE_URL);
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.waitForTimeout(1000);
  await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 40000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
  }, null, { timeout: 40000 });
  await page.waitForTimeout(1000);
  await page.mouse.click(800, 450);
  await page.waitForTimeout(150);

  // Pick the oversize SKU adaptively: pickFromShelf refuses any SKU whose home
  // display fixture is not on the floor (skuDisplayIsPlaced), and the
  // bootstrap layout only places some fixtures — the first two runs of this
  // probe rang one-item transactions because driver1's club rack was stored.
  const oversized = await page.evaluate(async () => {
    const shop = await import('/src/sim/shop.js');
    const { SHOP_CATALOG } = await import('/src/data/shopItems.js');
    const state = window.__fw.state;
    const clubOrBulk = (sku) => ['clubs', 'bags'].includes(sku.cat)
      || /driver|iron|putter|wedge|umbrella|stand/i.test(sku.id);
    const candidate = SHOP_CATALOG.find((sku) => (
      clubOrBulk(sku) && shop.skuDisplayIsPlaced(state, sku.id)
    ));
    return candidate ? candidate.id : null;
  });
  if (!oversized) throw new Error('No oversize SKU has its display placed in this layout; cannot stage the set-aside.');
  const skus = [oversized, 'tees1'];
  await page.evaluate(async ([skuIds]) => {
    const app = window.__fw;
    const { REGISTER } = await import('/src/data/shopLayout.js');
    const clubhouse = app.scene3d.clubhouse();
    clubhouse.setOrganicWalkins(false);
    clubhouse.clearWalkins();
    app.state.cash = Math.max(app.state.cash, 100000);
    app.state.shop.unlockedTier = 3;
    // Shelf stock must be LOT-BACKED: pickFromShelf moves a unit through
    // moveInventory, which allocates from lifecycle lots — a raw projection
    // bump has no lot behind it and the move fails silently (run three of
    // this probe). adoptExternalInventory is the sanctioned QA intake: it
    // creates the lot, and the projection is raised to match it.
    const { adoptExternalInventory, INVENTORY_STAGE } = await import('/src/sim/inventoryLifecycle.js');
    for (const id of skuIds) {
      if (!app.state.shop.inventory[id]) app.state.shop.inventory[id] = { shelf: 0, back: 0 };
      const inventory = app.state.shop.inventory[id];
      const wanted = 6 - inventory.shelf;
      if (wanted > 0) {
        const adopted = adoptExternalInventory(app.state, {
          skuId: id, quantity: wanted, stage: INVENTORY_STAGE.SHELF,
          note: 'oversize-setaside-evidence fixture',
        });
        if (!adopted.ok) throw new Error(`Could not seed ${id}: ${adopted.reason}`);
        inventory.shelf += wanted;
      }
    }
    app.speedIdx = 0;
    app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440 + 14 * 60;
    clubhouse.rebuildStock();
    const walk = app.scene3d.walk.state;
    const off = clubhouse.interior.position;
    walk.x = REGISTER.stand.x + off.x;
    walk.z = REGISTER.stand.z + off.z;
    const dx = REGISTER.monitor.x - REGISTER.stand.x;
    const dz = REGISTER.monitor.z - REGISTER.stand.z;
    const horizontal = Math.hypot(dx, dz) || 0.001;
    walk.yaw = Math.atan2(-dx / horizontal, -dz / horizontal);
    walk.pitch = Math.atan2(1.18 - 1.62, horizontal);
    document.querySelectorAll('.walk-overlay, .notification-center, .objectives-card')
      .forEach((node) => { node.style.display = 'none'; });
    clubhouse.sendToCounter(skuIds, 'card');
  }, [skus]);

  await page.waitForFunction(() => (
    window.__fw.scene3d.clubhouse().checkoutQueue?.().length > 0
      || window.__fw.scene3d.clubhouse().register.hasTx()
  ), null, { timeout: 20000 });
  await page.keyboard.press('e');
  await page.waitForFunction(() => window.__fw.scene3d.clubhouse().register.isActive(), null, { timeout: 10000 });
  await page.waitForFunction(() => window.__fw.scene3d.clubhouse().register.getTx(), null, { timeout: 15000 });
  await page.waitForTimeout(1500);

  const project = (query) => page.evaluate(async (wanted) => {
    const THREE = await import('/vendor/three.module.js');
    const app = window.__fw;
    let found = null;
    app.scene3d.clubhouse().interior.traverse((object) => {
      if (found || !object.visible || !object.userData) return;
      if (wanted.kind && object.userData.kind !== wanted.kind) return;
      if (wanted.uid && object.userData.uid !== wanted.uid) return;
      found = object;
    });
    if (!found) return null;
    const bounds = new THREE.Box3().setFromObject(found);
    const world = bounds.isEmpty()
      ? found.getWorldPosition(new THREE.Vector3())
      : bounds.getCenter(new THREE.Vector3());
    world.project(app.scene3d.camera);
    const rect = document.querySelector('canvas').getBoundingClientRect();
    return {
      x: rect.left + ((world.x + 1) / 2) * rect.width,
      y: rect.top + ((-world.y + 1) / 2) * rect.height,
      inView: world.z >= -1 && world.z <= 1 && Math.abs(world.x) <= 1 && Math.abs(world.y) <= 1,
    };
  }, query);

  const items = await page.evaluate(() => (
    window.__fw.scene3d.clubhouse().register.getTx().items.map((item) => (
      { uid: item.uid, skuId: item.skuId }
    ))
  ));
  const evidence = [];
  const shot = async (name) => {
    const file = path.join(OUT, name);
    await page.screenshot({ path: file });
    evidence.push(file);
  };
  await shot('01-goods-at-counter.png');

  for (const item of items) {
    let product = await project({ kind: 'item', uid: item.uid });
    for (let settle = 0; settle < 20; settle += 1) {
      await page.waitForTimeout(160);
      const next = await project({ kind: 'item', uid: item.uid });
      if (next && product && Math.abs(next.x - product.x) < 1.5 && Math.abs(next.y - product.y) < 1.5) {
        product = next;
        break;
      }
      product = next;
    }
    if (!product || !product.inView) throw new Error(`${item.skuId} not visible to click`);
    // A long item's bounds CENTER can hover over empty air (a diagonal club),
    // so find a pixel that actually picks this uid — the same ring-sampling
    // the acceptance driver uses on drawer money.
    const clickPoint = await page.evaluate(({ center, id }) => {
      const register = window.__fw.scene3d.clubhouse().register;
      const samples = [center];
      for (const radius of [8, 16, 26, 38, 52, 68]) {
        for (let step = 0; step < 12; step += 1) {
          const angle = (step / 12) * Math.PI * 2;
          samples.push({
            x: center.x + Math.cos(angle) * radius,
            y: center.y + Math.sin(angle) * radius,
          });
        }
      }
      for (const point of samples) {
        const picked = register.debugPickAt(point.x, point.y);
        const hit = picked?.physical || picked;
        if (hit && (hit.uid === id || hit.userData?.uid === id)) return point;
      }
      return null;
    }, { center: { x: product.x, y: product.y }, id: item.uid });
    if (!clickPoint) throw new Error(`${item.skuId}: no pickable pixel found near its projection`);
    await page.mouse.click(clickPoint.x, clickPoint.y);
    // `bagged` is the compact destination's flag; an oversize item settles at
    // the set-aside instead. Kind-agnostic completion: the item is scanned and
    // its ring-up motion is no longer in flight.
    await page.waitForFunction((id) => {
      const register = window.__fw.scene3d.clubhouse().register;
      const entry = register.getTx()?.items.find((candidate) => candidate.uid === id);
      if (!entry?.scanned) return false;
      const presentation = register.scanPresentation();
      return !presentation?.active || presentation.uid !== id;
    }, item.uid, { timeout: 10000 });
    await page.waitForTimeout(700);
  }
  await shot('02-oversize-set-aside-compact-bagged.png');

  const state = await page.evaluate(() => {
    const register = window.__fw.scene3d.clubhouse().register;
    return {
      visualState: register.workspace(),
      items: register.getTx().items.map((item) => ({
        skuId: item.skuId, scanned: item.scanned, bagged: item.bagged,
      })),
    };
  });
  if (state.items.length < 2) {
    throw new Error(`The transaction must carry BOTH items to stage the set-aside; got ${JSON.stringify(state.items)}`);
  }

  // The locked checkout frame only catches the shaft tip of the set-aside (it
  // sits at the counter's far customer-left, outside the framed workspace),
  // and Escape is deliberately blocked once the card modal engages — so the
  // settled pose goes on record as measured world-space data instead of a
  // second camera angle.
  const setAside = await page.evaluate(async () => {
    const THREE = await import('/vendor/three.module.js');
    const clubhouse = window.__fw.scene3d.clubhouse();
    let found = null;
    clubhouse.interior.traverse((object) => {
      if (found || object.userData?.checkoutVisualState !== 'oversize-set-aside') return;
      found = object;
    });
    if (!found) return null;
    const world = found.getWorldPosition(new THREE.Vector3());
    const quaternion = found.getWorldQuaternion(new THREE.Quaternion());
    const off = clubhouse.interior.position;
    return {
      visualState: found.userData.checkoutVisualState,
      local: { x: +(world.x - off.x).toFixed(3), y: +(world.y - off.y).toFixed(3), z: +(world.z - off.z).toFixed(3) },
      quaternion: [quaternion.x, quaternion.y, quaternion.z, quaternion.w].map((value) => +value.toFixed(3)),
    };
  });

  return { ok: true, oversized, state, setAside, evidence };
}
