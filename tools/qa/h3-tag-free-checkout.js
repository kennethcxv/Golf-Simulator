// H3 — the counter with goods on it, and NO printed label anywhere.
//
// History, because it matters for reading this file: the tag was asked for
// three times and reported gone twice. The first pass deleted the shelf price
// rails; the second deleted the checkout swing tag (brass tether + green
// backing) but kept a 74 x 40 mm unlit barcode STICKER on every product,
// classing it as packaging — and THIS DRIVER WAS WRITTEN TO ASSERT THAT
// STICKER EXISTED (`stickersPresent: counts.barcode >= 1`). So the sweep went
// green twice while a white label rode every item across the counter.
//
// The assertion is now inverted. Asserted here:
//   - zero label nodes of ANY known name in the whole interior;
//   - zero unlit (MeshBasicMaterial + canvas map) planes parented under a
//     staged product, which is what a label IS regardless of its name;
//   - a NEGATIVE CONTROL: a decoy label is mounted on a staged product, the
//     same audit is re-run and MUST report it, then the decoy is removed. An
//     audit that cannot see a tag cannot prove there is no tag.
//   - screenshots at the player camera, mid-sale, with goods on the counter.
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

  // Stage a mixed basket: the kinds that historically carried tags — a hang-tag
  // kind (glove), an apparel-tag kind (polo) and a package-side kind (balls).
  const staged = await page.evaluate(async () => {
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    const { REGISTER } = await import(new URL('src/data/shopLayout.js', document.baseURI).href);
    const skus = ['glove1', 'polo1', 'balls1'];
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

  await page.waitForTimeout(9000);

  // The audit, installed once and callable twice — once clean, once with a decoy.
  await page.evaluate(() => {
    const NAMES = [
      'RuntimeProductBarcode', 'RuntimeProductBarcodeTether',
      'RuntimeProductBarcodeBacking', 'RuntimeProductBarcodeCarrier',
      'ProductSwingTag', 'ShelfPriceRail', 'ShelfPriceCard', 'PriceTag', 'HangTag',
    ];
    window.__h3Audit = () => {
      const app = window.__fw;
      const interior = app.scene3d.clubhouse().interior;
      const byName = [];
      const unlitPlanes = [];
      interior.traverse((o) => {
        if (NAMES.includes(o.name)) byName.push({ name: o.name, visible: o.visible });
        // A label by shape, not by name: an unlit plane carrying a canvas image.
        const m = o.material;
        const mats = Array.isArray(m) ? m : (m ? [m] : []);
        for (const mat of mats) {
          if (mat?.type !== 'MeshBasicMaterial') continue;
          if (!mat.map || !mat.map.image) continue;
          if (o.geometry?.type !== 'PlaneGeometry') continue;
          if (!o.visible) continue;
          // Only planes riding a product; the POS screen and notes are elsewhere.
          let p = o.parent; let onProduct = false;
          while (p) {
            if (p.userData?.kind === 'item' || p.name === 'RuntimeProductBarcodeAnchor') { onProduct = true; break; }
            p = p.parent;
          }
          if (onProduct) unlitPlanes.push({ name: o.name, parent: o.parent?.name || null });
        }
      });
      return { byName, unlitPlanes };
    };
  });

  const clean = await page.evaluate(() => window.__h3Audit());
  await page.screenshot({ path: path.join(OUT, 'counter-staged.png') });

  // Close-up on the goods themselves.
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

  // AND THE ROOM. The counter was never the only place tags lived: a repo-wide
  // GLB sweep found printed codes on five delivery cartons, the shoe box, the
  // folded trousers and the water bottle. The cartons stand on the shop floor
  // in every screenshot of the room, so the room gets photographed too.
  await page.evaluate(() => {
    const app = window.__fw;
    const club = app.scene3d.clubhouse();
    const off = club.interior.position;
    const walk = app.scene3d.walk.state;
    // find the nearest delivery carton and stand off it
    let best = null;
    club.interior.traverse((o) => {
      if (!o.isMesh) return;
      let vis = o.visible;
      for (let p = o.parent; vis && p; p = p.parent) vis = p.visible;
      if (!vis) return;
      for (let p = o; p; p = p.parent) {
        if (/delivery_fixture_product|ProductBox|provisions_/i.test(p.name || '')) {
          const wp = o.getWorldPosition(new app.scene3d.camera.position.constructor());
          if (!best) best = wp;
          return;
        }
      }
    });
    if (best) {
      walk.x = best.x + 1.15;
      walk.z = best.z + 1.15;
      const dx = best.x - walk.x;
      const dz = best.z - walk.z;
      const h = Math.hypot(dx, dz) || 0.001;
      walk.yaw = Math.atan2(-dx / h, -dz / h);
      walk.pitch = Math.atan2(best.y - app.scene3d.camera.position.y, h);
    }
    void off;
  });
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(OUT, 'delivery-carton-close.png') });

  // NEGATIVE CONTROL — mount a decoy label and re-run the same audit.
  const control = await page.evaluate(async () => {
    const app = window.__fw;
    const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
    const interior = app.scene3d.clubhouse().interior;
    let host = null;
    interior.traverse((o) => { if (!host && o.userData?.kind === 'item') host = o; });
    if (!host) return { mounted: false, seen: null };
    const canvas = document.createElement('canvas');
    canvas.width = 64; canvas.height = 32;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 64, 32);
    ctx.fillStyle = '#000'; ctx.fillRect(8, 4, 4, 24); ctx.fillRect(18, 4, 3, 24);
    const decoy = new THREE.Mesh(
      new THREE.PlaneGeometry(0.074, 0.040),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(canvas), toneMapped: false }),
    );
    decoy.name = 'RuntimeProductBarcode';
    host.add(decoy);
    const seen = window.__h3Audit();
    decoy.removeFromParent();
    decoy.geometry.dispose();
    decoy.material.map.dispose();
    decoy.material.dispose();
    return { mounted: true, seen, after: window.__h3Audit() };
  });

  const checks = {
    customerStaged: staged.ok,
    noLabelNodeByName: clean.byName.length === 0,
    noUnlitLabelPlaneOnAnyProduct: clean.unlitPlanes.length === 0,
    // The instrument must be able to fail.
    controlMounted: control.mounted === true,
    controlDetectedByName: (control.seen?.byName.length || 0) >= 1,
    controlDetectedByShape: (control.seen?.unlitPlanes.length || 0) >= 1,
    controlCleanedUp: (control.after?.byName.length || 0) === 0,
    noPageErrors: errs.length === 0,
  };
  const out = {
    staged,
    clean,
    control,
    errs: errs.slice(0, 10),
    checks,
    ok: Object.values(checks).every(Boolean),
  };
  fs.writeFileSync(path.join(OUT, 'h3-tag-free.json'), `${JSON.stringify(out, null, 1)}\n`);
  return out;
}
