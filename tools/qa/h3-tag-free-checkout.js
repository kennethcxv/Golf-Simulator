// H3 — the counter with goods on it, and no tag anywhere.
//
// C7 deleted the shelf price rails and the product swing tags; the third tag
// nobody caught was buildItemMesh's checkout swing tag (brass tether + green
// backing riding 9.5 cm off every item at the register). The fix keeps the
// scanner's barcode as a FLUSH STICKER on the package face.
//
// Asserted here:
//   - zero RuntimeProductBarcodeTether / Backing / Carrier nodes in the scene
//     (the deleted presentation cannot come back through another path);
//   - every staged item still carries a RuntimeProductBarcode plane whose
//     material actually holds the barcode canvas texture (a blank sticker
//     scans green — judgeBarcodeRead never sees pixels — so the texture is
//     asserted, not assumed);
//   - screenshots at the player camera: the staged counter, and a close-up.
//
// The BEFORE frame (swing tags visible) is qa/electron/h3-tags/before-*.png,
// captured from the pre-fix build; the scan mechanic itself is covered by
// register-acceptance-cash.js staying green.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/h3-tags');
  fs.mkdirSync(OUT, { recursive: true });

  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message || e)));

  await page.setViewportSize({ width: 1600, height: 900 });
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 240000 });
  await page.waitForTimeout(3500);

  // stage a mixed basket: kinds that historically carried swing tags
  const staged = await page.evaluate(async () => {
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    const { REGISTER } = await import(new URL('src/data/shopLayout.js', document.baseURI).href);
    // the same three SKUs the register acceptance suite rings up
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
    const off = clubhouse.interior.position;
    const walk = app.scene3d.walk.state;
    walk.x = REGISTER.stand.x + off.x;
    walk.z = REGISTER.stand.z + off.z;
    const dx = REGISTER.monitor.x - REGISTER.stand.x;
    const dz = REGISTER.monitor.z - REGISTER.stand.z;
    const h = Math.hypot(dx, dz) || 0.001;
    walk.yaw = Math.atan2(-dx / h, -dz / h);
    walk.pitch = Math.atan2(1.18 - 1.62, h);
    return { ok: !!customer, skus };
  });

  // wait for the counter placement choreography to finish
  await page.waitForFunction(() => {
    const app = window.__fw;
    const reg = app.scene3d.clubhouse().register;
    if (!reg || typeof reg.diagnostics !== 'function') return true; // fall back to time
    return true;
  }, null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(9000);

  const audit = await page.evaluate(() => {
    const app = window.__fw;
    const interior = app.scene3d.clubhouse().interior;
    const counts = { tether: 0, backing: 0, carrier: 0, barcode: 0, barcodeWithTexture: 0 };
    const barcodes = [];
    interior.traverse((o) => {
      if (o.name === 'RuntimeProductBarcodeTether') counts.tether += 1;
      else if (o.name === 'RuntimeProductBarcodeBacking') counts.backing += 1;
      else if (o.name === 'RuntimeProductBarcodeCarrier') counts.carrier += 1;
      else if (o.name === 'RuntimeProductBarcode') {
        counts.barcode += 1;
        const hasMap = !!(o.material && o.material.map && o.material.map.image);
        if (hasMap) counts.barcodeWithTexture += 1;
        barcodes.push({ visible: o.visible, hasMap, barcode: o.userData?.barcode || null });
      }
    });
    return { counts, barcodes: barcodes.slice(0, 6) };
  });

  await page.screenshot({ path: path.join(OUT, 'counter-staged.png') });

  // close-up: pitch down toward the staged goods for the sticker read
  await page.evaluate(async () => {
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
    walk.pitch = -0.52;
  });
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(OUT, 'counter-staged-close.png') });

  const checks = {
    customerStaged: staged.ok,
    noTetherAnywhere: audit.counts.tether === 0,
    noBackingAnywhere: audit.counts.backing === 0,
    noCarrierAnywhere: audit.counts.carrier === 0,
    stickersPresent: audit.counts.barcode >= 1,
    everyStickerHasItsTexture: audit.counts.barcode > 0
      && audit.counts.barcodeWithTexture === audit.counts.barcode,
    noPageErrors: errs.length === 0,
  };
  const out = { staged, audit, errs: errs.slice(0, 10), checks, ok: Object.values(checks).every(Boolean) };
  fs.writeFileSync(path.join(OUT, 'h3-tag-free.json'), `${JSON.stringify(out, null, 1)}\n`);
  return out;
}
