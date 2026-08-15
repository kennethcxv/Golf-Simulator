// C1+C2 — ARE THE GOODS IN THE BAG, AND IS THE CARD IN THE HAND?
//
// Stages the canonical 3-item card sale (sendToCounter, the non-lottery way),
// scans and bags everything, and measures BOTH claims with geometry rather
// than eyes alone — then keeps the screenshots so eyes can veto:
//   C1: per packed item, the fraction of its bounding box OUTSIDE the bag's
//       bounding box (0 = fully inside). Orientation-agnostic, so the
//       side-lying bag cannot fool a "below the rim" check.
//   C2: distance from the presented card's centre to the customer's grip
//       node. A card IN the grip is a few centimetres; the reported defect
//       (image 3) is a visible air gap.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-c1c2-evidence.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/c1c2-evidence');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
  await page.bringToFront().catch(() => {});
  await page.waitForTimeout(2000);
  await page.mouse.click(800, 450);
  await page.waitForTimeout(200);

  const SKUS = ['balls1', 'water1', 'sportdrink2'];
  await page.evaluate(async ([skuIds]) => {
    const app = window.__fw;
    const { REGISTER } = await import(new URL('src/data/shopLayout.js', document.baseURI).href);
    const clubhouse = app.scene3d.clubhouse();
    clubhouse.setOrganicWalkins(false);
    for (const id of Object.keys(app.state.shop.inventory)) {
      const inventory = app.state.shop.inventory[id];
      if (skuIds.includes(id)) inventory.shelf = Math.max(inventory.shelf, 12);
    }
    app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440 + 14 * 60;
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
    return clubhouse.sendToCounter(skuIds, 'card');
  }, [SKUS]);
  await page.waitForFunction(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return tx && tx.items.length === 3;
  }, null, { timeout: 30000 });
  await page.keyboard.press('e');
  await page.waitForFunction(() => window.__fw.scene3d.clubhouse().register.isActive(), null, { timeout: 15000 });
  await page.waitForTimeout(1700);

  // Scan+bag every item by clicking it (the shipped interaction).
  const projectItem = (uid) => page.evaluate(async (id) => {
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
  const uids = await page.evaluate(() => window.__fw.scene3d.clubhouse().register.getTx().items.map((i) => i.uid));
  for (const uid of uids) {
    let point = null;
    for (let attempt = 0; attempt < 25; attempt += 1) {
      point = await projectItem(uid);
      if (point && point.inView) break;
      await page.waitForTimeout(250);
    }
    if (!point || !point.inView) { out.scanProblem = `item ${uid} never on screen`; break; }
    await page.mouse.click(point.x, point.y);
    await page.waitForFunction((id) => {
      const tx = window.__fw.scene3d.clubhouse().register.getTx();
      const item = tx?.items.find((c) => c.uid === id);
      return !!(item?.scanned && item?.bagged);
    }, uid, { timeout: 15000 }).catch(() => { out.scanProblem = `item ${uid} did not bag`; });
    await page.waitForTimeout(400);
  }
  await page.waitForTimeout(1200);

  // ---- C1 measurement ------------------------------------------------------
  out.c1 = await page.evaluate(async () => {
    const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
    const clubhouse = window.__fw.scene3d.clubhouse();
    let bag = null;
    clubhouse.interior.traverse((o) => { if (!bag && o.name === 'FrontDeskShoppingBag') bag = o; });
    if (!bag) return { error: 'no bag' };
    const packed = bag.children.filter((c) => c.userData?.checkoutVisualState === 'packed-in-bag');
    // The PAPER body only: rope handles arch far above the mouth and made the
    // whole-bag bbox pass items that plainly stood outside the paper (the
    // first run of this instrument passed the unfixed build — voided).
    const bagBox = new THREE.Box3();
    bag.traverse((o) => {
      if (!o.isMesh) return;
      if (o.userData?.checkoutVisualState === 'packed-in-bag') return;
      const label = (o.name || '').toLowerCase();
      if (/handle|cord|rope/.test(label)) return;
      bagBox.expandByObject(o);
    });
    const rows = packed.map((m) => {
      const b = new THREE.Box3().setFromObject(m);
      const inter = b.clone().intersect(bagBox);
      const vol = (bb) => {
        const s = bb.getSize(new THREE.Vector3());
        return Math.max(s.x, 1e-6) * Math.max(s.y, 1e-6) * Math.max(s.z, 1e-6);
      };
      const insideFrac = inter.isEmpty() ? 0 : vol(inter) / vol(b);
      return {
        name: m.name || m.userData?.uid || '?',
        insideFrac: +insideFrac.toFixed(3),
        topAboveBagTop: +(b.max.y - bagBox.max.y).toFixed(3),
      };
    });
    return { packedCount: packed.length, rows };
  });
  const canvas = await page.$('#game');
  await (canvas || page).screenshot({ path: path.join(OUT, 'c1-bagged.png') });

  // ---- C2 measurement ------------------------------------------------------
  await page.waitForFunction(() => window.__fw.scene3d.clubhouse().register.getTx()?.stage === 'card-ready', null, { timeout: 30000 }).catch(() => { out.c2Timeout = true; });
  await page.waitForTimeout(600);
  out.c2 = await page.evaluate(async () => {
    const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
    const register = window.__fw.scene3d.clubhouse().register;
    const d = register.cardGripDiagnostics?.();
    if (d) return d;
    return { error: 'no cardGripDiagnostics — measure by hand' };
  });
  await (canvas || page).screenshot({ path: path.join(OUT, 'c2-card-ready.png') });

  out.verdict = {
    c1AllInside: !!(out.c1.rows && out.c1.rows.length === 3 && out.c1.rows.every((r) => r.insideFrac >= 0.85 && r.topAboveBagTop <= 0.01)),
    c2GapMeters: out.c2?.gap ?? null,
    c2InGrip: out.c2?.gap != null ? out.c2.gap < 0.06 : null,
  };
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(out, null, 2));
  console.log('C1C2', JSON.stringify(out.verdict), JSON.stringify(out.c1));
}
