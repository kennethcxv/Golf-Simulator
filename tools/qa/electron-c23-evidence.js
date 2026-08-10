// C2+C3 (Goal 19) — the card in the hand, and the landing sizes.
//
// C3: measures every counter good's WORLD scale while the customer is still
// placing, then again after the register rebuilds its own meshes. The
// complaint is "placed items sit smaller, then pop bigger when the last one
// lands" — if the two measurements differ, that is the pop, quantified.
// C2: after bagging, waits for the offered card, flies the camera to the
// customer's grip and photographs it; measures the card's face normal
// against world-up and toward-the-eye ("held flat, angled toward me").
//
//   node tools/qa/run-electron.cjs tools/qa/electron-c23-evidence.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/c23-evidence');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForTimeout(2000);
  await page.mouse.click(800, 450);
  await page.waitForTimeout(200);

  const SKUS = ['balls1', 'water1', 'sportdrink2'];
  await page.evaluate(async ([skuIds]) => {
    const app = window.__fw;
    const { REGISTER } = await import(new URL('src/data/shopLayout.js', document.baseURI).href);
    const ch = app.scene3d.clubhouse();
    ch.setOrganicWalkins(false);
    for (const id of skuIds) {
      const inv = app.state.shop.inventory[id];
      if (inv) inv.shelf = Math.max(inv.shelf, 12);
    }
    app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440 + 14 * 60;
    ch.rebuildStock();
    const w = app.scene3d.walk.state;
    const off = ch.interior.position;
    w.x = REGISTER.stand.x + off.x;
    w.z = REGISTER.stand.z + off.z;
    const dx = REGISTER.monitor.x - REGISTER.stand.x;
    const dz = REGISTER.monitor.z - REGISTER.stand.z;
    const h = Math.hypot(dx, dz) || 0.001;
    w.yaw = Math.atan2(-dx / h, -dz / h);
    w.pitch = Math.atan2(1.18 - 1.62, h);
    return ch.sendToCounter(skuIds, 'card');
  }, [SKUS]);

  // C3 sample 1: MID-placement (1-2 goods down, the customer still placing).
  // The register's begin() fires at the LAST placement and rebuilds every
  // good at its own scale — sampling after all three are down measures the
  // post-swap world and hides the pop.
  await page.waitForFunction(() => {
    const ch = window.__fw.scene3d.clubhouse();
    const c = ch.customers().find((k) => k.checkoutPhase === 'placing');
    if (!c) return false;
    const placed = (c.cart || []).filter((i) => i.placed).length;
    return placed >= 1 && placed < 3;
  }, null, { timeout: 60000 });
  out.placingScales = await page.evaluate(async () => {
    const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
    const ch = window.__fw.scene3d.clubhouse();
    const rows = [];
    // placed goods were interior.attach()ed at placement start and carry the
    // customer-side checkoutUid marker
    ch.interior.traverse((o) => {
      if (o.userData?.checkoutUid && o.visible) {
        const s = o.getWorldScale(new THREE.Vector3());
        rows.push({ uid: o.userData.checkoutUid, world: +s.x.toFixed(4), parent: o.parent?.name || o.parent?.type || '?' });
      }
    });
    return rows;
  });
  await page.screenshot({ path: path.join(OUT, 'c3-placed-before-register.png') });

  // C3 sample 2: after the LAST placement the register's meshes own the
  // counter (begin() runs without the player); then E engages the till
  await page.waitForFunction(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return tx && tx.items.length === 3;
  }, null, { timeout: 60000 });
  await page.keyboard.press('e');
  await page.waitForFunction(() => window.__fw.scene3d.clubhouse().register.isActive(), null, { timeout: 15000 });
  await page.waitForTimeout(1500);
  out.registerScales = await page.evaluate(async () => {
    const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
    const ch = window.__fw.scene3d.clubhouse();
    const rows = [];
    ch.interior.traverse((o) => {
      if (o.userData?.kind === 'item' && o.visible && o.userData.originalScale) {
        const s = o.getWorldScale(new THREE.Vector3());
        rows.push({ uid: o.userData.uid, world: +s.x.toFixed(4) });
      }
    });
    return rows;
  });
  await page.screenshot({ path: path.join(OUT, 'c3-register-goods.png') });
  const before = out.placingScales.map((r) => r.world);
  const after = out.registerScales.map((r) => r.world);
  out.c3 = {
    placingWorldScales: before,
    registerWorldScales: after,
    maxBefore: Math.max(...before),
    minAfter: after.length ? Math.min(...after) : null,
    popRatio: after.length && before.length
      ? +(Math.min(...after) / Math.max(...before)).toFixed(3)
      : null,
  };

  // C2: bag everything (click each), then wait for the offered card
  const uids = await page.evaluate(() => window.__fw.scene3d.clubhouse().register.getTx().items.map((i) => i.uid));
  for (const uid of uids) {
    const spot = await page.evaluate(async (id) => {
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
        ok: Math.abs(world.x) <= 1 && Math.abs(world.y) <= 1,
      };
    }, uid);
    if (spot && spot.ok) {
      await page.mouse.click(spot.x, spot.y);
      await page.waitForTimeout(900);
    }
  }
  const cardReady = await page.waitForFunction(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return tx && tx.stage === 'card-ready';
  }, null, { timeout: 30000 }).then(() => true).catch(() => false);
  out.cardReady = cardReady;
  if (cardReady) {
    await page.waitForTimeout(700);
    out.card = await page.evaluate(async () => {
      const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
      const app = window.__fw;
      const ch = app.scene3d.clubhouse();
      const card = ch.register.cardNode ? ch.register.cardNode() : null;
      if (!card) return null;
      card.updateWorldMatrix(true, false);
      const normal = new THREE.Vector3(0, 1, 0).applyQuaternion(card.getWorldQuaternion(new THREE.Quaternion()));
      const at = card.getWorldPosition(new THREE.Vector3());
      const eye = app.scene3d.camera.getWorldPosition(new THREE.Vector3());
      const toEye = eye.clone().sub(at);
      toEye.y = 0;
      toEye.normalize();
      // fly the working camera in for the close-up
      const w = app.scene3d.walk.state;
      const o = ch.interior.position;
      w.x = at.x + toEye.x * 0.85;
      w.z = at.z + toEye.z * 0.85;
      const dx = at.x - w.x;
      const dz = at.z - w.z;
      const h = Math.hypot(dx, dz) || 0.001;
      w.yaw = Math.atan2(-dx / h, -dz / h);
      w.pitch = Math.atan2(at.y - 1.62, h);
      void o;
      return {
        name: card.name || card.type,
        upDot: +Math.abs(normal.dot(new THREE.Vector3(0, 1, 0))).toFixed(3),
        towardEyeDot: +normal.dot(toEye).toFixed(3),
      };
    });
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(OUT, 'c2-card-closeup.png') });
  }

  out.ok = out.c3.popRatio !== null && out.c3.popRatio <= 1.05 && out.c3.popRatio >= 0.95;
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(out, null, 2));
  console.log('C23', JSON.stringify(out));
  return { ok: true, ...out };
}
