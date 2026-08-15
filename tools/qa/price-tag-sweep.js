// "please dont forget to remove all the tags even at the checkout counter."
//
// C7 deleted the runtime tag code and H3 deleted the checkout swing tag, and
// both are genuinely gone from the source. So whatever is still on screen is
// either BAKED INTO AN ASSET or is something the sweep has not thought to look
// for - and the only way to know is to walk the live scene graph rather than
// re-read the code that was already fixed.
//
// This lists every mesh in the room whose NAME suggests a tag or a price, and
// separately every small flat plane hanging off a product (which is what a
// swing tag looks like geometrically, whatever it is called). A staged
// checkout is running while it sweeps, so goods on the counter, in the hand
// and in the bag are all in the scene at the time.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/price-tag-sweep');
  fs.mkdirSync(OUT, { recursive: true });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message || e)));
  const assert = (value, message) => { if (!value) throw new Error(message); };

  await page.setViewportSize({ width: 1600, height: 900 });
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
  await page.waitForTimeout(2500);
  await page.mouse.click(800, 450);
  await page.waitForTimeout(200);

  // stage a real sale so products exist on the counter, not just on shelves
  const staged = await page.evaluate(async (skus) => {
    const app = window.__fw;
    const { REGISTER } = await import(new URL('src/data/shopLayout.js', document.baseURI).href);
    const club = app.scene3d.clubhouse();
    club.setOrganicWalkins(false);
    for (const id of skus) {
      const inv = app.state.shop.inventory[id];
      if (inv) inv.shelf = Math.max(inv.shelf, 8);
    }
    app.speedIdx = 0;
    app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440 + 14 * 60;
    app.scene3d.applyTimeWeather(840, app.state.weather);
    club.rebuildStock();
    const walk = app.scene3d.walk.state;
    const off = club.interior.position;
    walk.x = REGISTER.stand.x + off.x;
    walk.z = REGISTER.stand.z + off.z;
    const dx = REGISTER.monitor.x - REGISTER.stand.x;
    const dz = REGISTER.monitor.z - REGISTER.stand.z;
    const h = Math.hypot(dx, dz) || 0.001;
    walk.yaw = Math.atan2(-dx / h, -dz / h);
    walk.pitch = Math.atan2(1.18 - 1.62, h);
    return !!club.sendToCounter(skus, 'cash');
  }, ['tees1', 'marker1', 'glove1']);
  assert(staged, 'no checkout fixture customer');
  await page.waitForFunction(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return tx && tx.items.length === 3;
  }, null, { timeout: 30000 });
  await page.keyboard.press('e');
  await page.waitForFunction(() => window.__fw.scene3d.clubhouse().register.isActive(), null, { timeout: 10000 });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(OUT, '01-counter-with-goods.png') });

  const sweep = await page.evaluate(async () => {
    const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
    const scene = window.__fw.scene3d.scene;
    const byName = [];
    const hangingPlanes = [];
    const NAME = /(price|swing|hang)?tag|price/i;
    const box = new THREE.Box3();
    const size = new THREE.Vector3();
    scene.traverse((o) => {
      if (!o.isMesh) return;
      // is it drawn at all?
      let shown = o.visible;
      for (let p = o.parent; p && shown; p = p.parent) if (p.visible === false) shown = false;
      if (!shown) return;
      const name = o.name || '';
      if (NAME.test(name)) {
        byName.push({ name, parent: o.parent?.name || '' });
        return;
      }
      // a swing tag's SHAPE: a small, thin, flat quad. Barcode stickers are
      // deliberately excluded by name because a sticker is packaging.
      if (/barcode/i.test(name)) return;
      const geo = o.geometry;
      if (!geo || geo.type !== 'PlaneGeometry') return;
      box.setFromObject(o);
      if (box.isEmpty()) return;
      box.getSize(size);
      const dims = [size.x, size.y, size.z].sort((a, b) => a - b);
      const isSmallFlatQuad = dims[0] < 0.006 && dims[2] < 0.13 && dims[1] > 0.012;
      // A TAG is a small flat quad that ALSO carries printing and hangs where
      // goods are. The shape alone catches unrelated scenery: the first run
      // flagged an untextured grey plate at y=-0.20, below the floor, under an
      // anonymous group - which is a floor plate, not a price tag. Requiring a
      // texture and product height is what makes this a tag detector rather
      // than a thin-quad detector.
      const mat0 = Array.isArray(o.material) ? o.material[0] : o.material;
      const world0 = new THREE.Vector3();
      o.getWorldPosition(world0);
      const atGoodsHeight = world0.y > 0.2;
      if (isSmallFlatQuad && !!mat0?.map && atGoodsHeight) {
        // enough to IDENTIFY it, so an unnamed quad is not guessed at: where
        // it is, what it is made of, and what it hangs under
        const chain = [];
        for (let p = o.parent; p && chain.length < 5; p = p.parent) chain.push(p.name || p.type);
        const world = new THREE.Vector3();
        o.getWorldPosition(world);
        const mat = Array.isArray(o.material) ? o.material[0] : o.material;
        hangingPlanes.push({
          name: name || '(unnamed)',
          parent: o.parent?.name || '',
          chain,
          size: dims.map((d) => +d.toFixed(3)),
          world: { x: +world.x.toFixed(2), y: +world.y.toFixed(2), z: +world.z.toFixed(2) },
          material: mat ? {
            type: mat.type,
            color: mat.color ? `#${mat.color.getHexString()}` : null,
            hasMap: !!mat.map,
            mapName: mat.map?.name || mat.map?.image?.currentSrc || null,
          } : null,
        });
      }
    });
    return { byName, hangingPlanes };
  });

  const checks = {
    // no mesh anywhere in the drawn room calls itself a tag or a price
    noMeshNamedLikeATag: sweep.byName.length === 0,
    // and nothing has a swing tag's SHAPE hanging off it either
    noSwingTagShapedPlanes: sweep.hangingPlanes.length === 0,
    noPageErrors: errs.length === 0,
  };
  const out = { sweep, errs: errs.slice(0, 8), checks };
  out.ok = Object.values(checks).every(Boolean);
  fs.writeFileSync(path.join(OUT, 'tags.json'), `${JSON.stringify(out, null, 1)}\n`);
  return out;
}
