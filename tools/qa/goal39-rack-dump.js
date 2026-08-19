// WHAT IS ACTUALLY ON THE RACK. goal39 reported the three club displays drawing
// no hero material while draws rose +486 and triangles +1.37M, and those two
// readings cannot both be about the same geometry. This prints the material
// names under each spliced rack, and asks merch directly whether it has the
// three names at all -- the two candidate explanations (never registered, or
// registered and renamed) look identical from the scan alone.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.split(String.fromCharCode(92)).join('/');
  const boot = await import(`file:///${bootPath}`);
  await boot.clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(2500);

  const out = await page.evaluate(async () => {
    const app = window.__fw;
    const st = app.state;
    const ch = app.scene3d.clubhouse();
    const layout = st.shop.layout || (st.shop.layout = {});
    if (!layout.extra) layout.extra = [];
    const add = (f) => { if (!layout.extra.some((e) => e.id === f.id)) layout.extra.push(f); };
    add({ id: 'qa_rack_drivers', kind: 'rack', x: 6.30, z: -4.10, ry: 0,
      skus: ['driver1', 'driver2', 'driver3'], title: 'Drivers', zone: 'stockroom',
      browse: [{ x: 0, z: 1.05 }], stock: [{ x: 0, z: 0.95 }] });
    add({ id: 'qa_rack_irons', kind: 'rack', x: 6.30, z: -2.10, ry: 0,
      skus: ['irons1', 'irons2'], title: 'Irons', zone: 'stockroom',
      browse: [{ x: 0, z: 1.05 }], stock: [{ x: 0, z: 0.95 }] });
    add({ id: 'qa_rack_putters', kind: 'rack', x: 6.30, z: -0.10, ry: 0,
      skus: ['putter1', 'putter2', 'putter3'], title: 'Putters', zone: 'stockroom',
      browse: [{ x: 0, z: 1.05 }], stock: [{ x: 0, z: 0.95 }] });
    const inv = st.shop.inventory;
    for (const id of ['driver1', 'driver2', 'driver3', 'irons1', 'irons2',
      'putter1', 'putter2', 'putter3']) {
      inv[id] = inv[id] || { shelf: 0, back: 0 };
      inv[id].shelf = 4;
    }
    ch.refreshShopProgression?.();
    await new Promise((r) => setTimeout(r, 2000));
    ch.rebuildStock?.();
    await new Promise((r) => setTimeout(r, 1500));

    let cam = null;
    for (const k of Object.keys(app.scene3d)) {
      const v = app.scene3d[k]; if (v && v.isCamera) { cam = v; break; }
    }
    let scene = cam; while (scene && scene.parent) scene = scene.parent;
    const racks = {};
    for (const id of ['qa_rack_drivers', 'qa_rack_irons', 'qa_rack_putters']) {
      const g = scene.getObjectByName(`Fixture_${id}`);
      const mats = {};
      let meshes = 0;
      if (g) {
        g.traverse((o) => {
          if (!o.isMesh) return;
          meshes += 1;
          for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
            if (m) mats[m.name || '(unnamed)'] = (mats[m.name || '(unnamed)'] || 0) + 1;
          }
        });
      }
      racks[id] = { found: !!g, meshes, mats };
    }
    // ASK THE LOADER DIRECTLY. `has()` is the gate authored() checks before it
    // will call instantiateRaw at all, so a false here explains a silent
    // fallback to the procedural club with no error anywhere.
    const merch = ch.merch || app.scene3d.merch || null;
    const probe = {};
    if (merch?.has) {
      for (const n of ['hero_driver', 'hero_iron', 'hero_putter', 'hero_counter',
        'checkout_product_driver']) probe[n] = !!merch.has(n);
    } else probe.note = 'no merch handle reachable from clubhouse()';
    return { racks, probe };
  });
  fs.mkdirSync('qa/goal39', { recursive: true });
  fs.writeFileSync('qa/goal39/rack-dump.json', JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}
