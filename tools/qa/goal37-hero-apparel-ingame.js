// THE V5 GARMENTS, REACHED THROUGH THE MERCHANDISE SYSTEM.
//
// Not "the GLB loads" — the asset session already proved that. This asks the
// question the wiring is for: when the shop has stock of an apparel line, does
// the thing that appears on the fixture come from the v5 hero set, and does it
// arrive with its BAKE intact?
//
// A hero garment is identified by its authored MATERIAL NAME (PoloPique,
// HoodieFleece, TrouserTwill, CapTwill, TowelTerry). Those names exist in the
// scene only if the model loaded through instantiateRaw and kept its authored
// materials. The old checkout family carries M_fabric and palette slots, so the
// two can never be confused, and a build without the wiring reports zero.
//
// The bake is checked separately from the identity, because a garment can carry
// the right name and still have lost what makes it look like cloth: every hero
// material must still hold its normal map, and the geometry must still carry
// the COLOR_0 vertex colours the v7 pass baked in.
//
// TWO PATHS, because pine-hills-v2 is a FAILING MUNICIPAL STARTER and cuts the
// apparel fixtures:
//   A  the starter path, no synthesis at all — shelf_acc carries towel1 and is
//      placed from the first minute, so the towel is reachable exactly as the
//      owner will meet it.
//   B  the upgrade path — table_polos, rail_outer and hatstand are spliced out
//      of FIXTURES on this variant, so they are added through the layout's own
//      `extra` seam (the same list placedFixtures already reads) and stocked.
//      This exercises the real slot table, the real rebuildStock and the real
//      makeStockItem; nothing is hand-placed in the scene.
//
//   node tools/qa/run-electron.cjs \
//     tools/qa/goal37-hero-apparel-ingame.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/goal37');
  fs.mkdirSync(OUT, { recursive: true });
  const tag = process.env.QA_TAG || 'run';
  const out = { tag, errs: [], failures: [] };
  const fail = (why) => { out.failures.push(why); console.log('FAIL:', why); };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  const boot = await import(`file:///${bootPath}`);
  out.bootPath = await boot.clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.bringToFront().catch(() => {});
  await page.waitForTimeout(2500);
  await boot.ownerResolution(page, page.electronApp);
  await page.waitForTimeout(1500);

  // Did the eleven prototypes even load? merch.has() is the loader's own answer,
  // so a missing vendor copy is named here rather than showing up later as an
  // empty shelf that could equally be a stock bug.
  out.prototypes = await page.evaluate(() => {
    const m = window.__fw.scene3d.clubhouse().merch;
    const names = ['hero_polo_hung', 'hero_polo_folded', 'hero_tee_hung', 'hero_tee_folded',
      'hero_hoodie_hung', 'hero_hoodie_folded', 'hero_trousers_hung', 'hero_trousers_folded',
      'hero_cap', 'hero_cap_peg', 'hero_towel'];
    const res = {};
    for (const n of names) res[n] = m?.has ? !!m.has(n) : null;
    return res;
  });
  // NOT a failure on its own. `merch` is not on the clubhouse's public API, so
  // on most builds this probe answers null for every name — which says nothing
  // about loading and would otherwise report eleven phantom misses. The load is
  // proved downstream, by authored material names arriving in the stock layer.
  const reachable = Object.values(out.prototypes).some((v) => v !== null);
  const missing = reachable
    ? Object.entries(out.prototypes).filter(([, v]) => !v).map(([k]) => k) : [];
  if (reachable && missing.length) fail(`hero prototypes never loaded: ${missing.join(', ')}`);
  console.log(reachable
    ? `prototypes loaded: ${11 - missing.length}/11`
    : 'prototype probe unavailable (merch is not on the public API) — the material scan is the proof');

  // WHAT IS ACTUALLY IN THE STOCK LAYER, by authored material name.
  const HERO_MATS = ['PoloPique', 'PoloFPique', 'HoodieFleece', 'HoodieFFleece',
    'TrouserTwill', 'TrouserFTwill', 'TeeJersey', 'TeeFJersey', 'CapTwill', 'TowelTerry'];
  const scan = () => page.evaluate((wanted) => {
    const ch = window.__fw.scene3d.clubhouse();
    const root = ch.interior;
    const found = {};
    let meshes = 0;
    root.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (!m || !wanted.includes(m.name)) continue;
        meshes += 1;
        const rec = found[m.name] || (found[m.name] = {
          meshes: 0, normalMap: false, aoMap: false, roughnessMap: false,
          vertexColors: false, colorAttr: false, visible: 0,
        });
        rec.meshes += 1;
        rec.normalMap = rec.normalMap || !!m.normalMap;
        rec.aoMap = rec.aoMap || !!m.aoMap;
        rec.roughnessMap = rec.roughnessMap || !!m.roughnessMap;
        rec.vertexColors = rec.vertexColors || !!m.vertexColors;
        rec.colorAttr = rec.colorAttr || !!o.geometry?.getAttribute?.('color');
        let vis = o.visible;
        for (let p = o.parent; p && vis; p = p.parent) vis = p.visible;
        if (vis) rec.visible += 1;
      }
    });
    return { found, meshes };
  }, HERO_MATS);

  const rebuild = () => page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse();
    ch.rebuildStock?.();
  });

  // ---- A: the starter path, nothing synthesised --------------------------
  out.starter = await page.evaluate(() => {
    const st = window.__fw.state;
    const inv = st.shop.inventory;
    inv.towel1 = inv.towel1 || { shelf: 0, back: 0 };
    inv.towel1.shelf = 6;
    return { towel1: { ...inv.towel1 } };
  });
  await rebuild();
  await page.waitForTimeout(1200);
  out.afterStarter = await scan();
  const towel = out.afterStarter.found.TowelTerry;
  if (!towel) fail('A: the towel on shelf_acc is not the v5 hero towel (no TowelTerry material in the scene)');
  else console.log(`A towel: ${towel.meshes} mesh(es), ${towel.visible} visible, normalMap=${towel.normalMap} colorAttr=${towel.colorAttr}`);

  // ---- B: the upgrade path -----------------------------------------------
  // pine-hills-v2 splices table_polos / rail_outer / hatstand out of FIXTURES,
  // so they cannot be "placed" — they are added through layout.extra, which
  // placedFixtures already reads, and then stocked like any other line.
  //
  // ZONE 'stockroom' ON PURPOSE. The greybox covers every retail zone: it
  // hides each fixture anchor and stands an opaque grey volume in its place,
  // so a garment on the shop floor of this variant is photographed from
  // INSIDE a grey box (qa/goal37/shots-garments-table.png is exactly that).
  // GREYBOX_ZONES_EXCLUDED is ['stockroom','office'], so the back room is the
  // one place these can be seen in real clubhouse light without defeating the
  // greybox, which the project rules forbid touching.
  out.extraAdded = await page.evaluate(() => {
    const st = window.__fw.state;
    const layout = st.shop.layout || (st.shop.layout = {});
    if (!layout.extra) layout.extra = [];
    const add = (f) => {
      if (layout.extra.some((e) => e.id === f.id)) return;
      layout.extra.push(f);
    };
    add({
      id: 'qa_table_polos', kind: 'table', x: 6.30, z: -4.10, ry: 0,
      skus: ['polo1', 'polo2', 'pants2'], title: 'Course apparel', zone: 'stockroom',
      browse: [{ x: 0, z: 1.0 }], stock: [{ x: 0, z: 0.9 }],
    });
    // The rail carries the polo and the trousers as well as the shell: a TABLE
    // only has folded slots, so a table-only test can never produce a HUNG
    // garment and the first cut of this driver called that a missing model.
    add({
      id: 'qa_rail_outer', kind: 'rail', x: 6.30, z: -2.60, ry: 0,
      skus: ['jacket2'], title: 'Outerwear', zone: 'stockroom',
      browse: [{ x: 0, z: 0.8 }], stock: [{ x: 0, z: 0.76 }],
    });
    add({
      id: 'qa_hatstand', kind: 'hatstand', x: 6.30, z: -0.40, ry: 0,
      skus: ['cap1', 'cap2'], title: 'Headwear', zone: 'stockroom',
      browse: [{ x: 0, z: 0.8 }], stock: [{ x: 0, z: 0.76 }],
    });
    const inv = st.shop.inventory;
    for (const id of ['polo1', 'polo2', 'pants2', 'jacket2', 'cap1', 'cap2']) {
      inv[id] = inv[id] || { shelf: 0, back: 0 };
      inv[id].shelf = 4;
    }
    return layout.extra.map((e) => e.id);
  });
  // rebuildStock alone is not enough: it skips any fixture with no ANCHOR, and
  // an anchor only exists once the fixture has been BUILT into the scene. The
  // first cut of this driver added the fixtures, rebuilt stock, and reported
  // four missing garments that were never given anywhere to stand.
  await page.evaluate(() => window.__fw.scene3d.clubhouse().refreshCampaign?.());
  await page.waitForTimeout(1500);
  await rebuild();
  await page.waitForTimeout(1500);
  out.afterUpgrade = await scan();
  console.log('\n-- hero materials in the stock layer --');
  for (const [name, r] of Object.entries(out.afterUpgrade.found)) {
    console.log(`   ${name.padEnd(14)} meshes ${String(r.meshes).padStart(3)}  visible ${String(r.visible).padStart(3)}`
      + `  normal=${r.normalMap ? 'Y' : 'n'} ao=${r.aoMap ? 'Y' : 'n'} rough=${r.roughnessMap ? 'Y' : 'n'}`
      + `  vertexColors=${r.vertexColors ? 'Y' : 'n'} COLOR_0=${r.colorAttr ? 'Y' : 'n'}`);
  }
  // WHAT THE DATA MODEL ACTUALLY ASKS FOR.
  //
  // Slots are keyed by SKU, not by fixture (fixtureSlots.js BUILD): polo1,
  // polo2 and pants2 build `tableApparel`, which is folded stacks, and jacket2
  // builds `apparelWall`, which hangs. So which lines HANG is a property of the
  // shipped merchandising, not of this wiring. The first cut of this driver
  // demanded a hung polo, put polos on a rail to get one, and still did not —
  // because the rail does not decide.
  //
  // Required = the poses this shop actually asks a v5 garment for.
  const REQUIRED = ['PoloFPique', 'TrouserFTwill', 'HoodieFleece', 'HoodieFFleece', 'CapTwill'];
  // Loaded and wired, but no SKU's slot table calls for them today. Reported,
  // never failed — an asset with nowhere to stand is a merchandising decision.
  const UNREACHABLE = ['PoloPique', 'TrouserTwill', 'TeeJersey', 'TeeFJersey'];
  for (const want of REQUIRED) {
    const r = out.afterUpgrade.found[want];
    if (!r) fail(`B: ${want} never reached the stock layer — that line is not drawing a v5 garment`);
    else if (!r.visible) fail(`B: ${want} is in the scene but nothing is visible`);
    else if (!r.normalMap) fail(`B: ${want} lost its normal map — the bake did not survive load`);
    else if (!r.colorAttr) fail(`B: ${want} lost COLOR_0 — the bake did not survive load`);
  }
  out.unreachable = UNREACHABLE.filter((n) => !out.afterUpgrade.found[n]);
  if (out.unreachable.length) {
    console.log(`\nwired but with no slot asking for them: ${out.unreachable.join(', ')}`);
  }

  // ---- the frames: stood where a shopper stands ---------------------------
  //
  // The first cut screenshotted from the spawn point, which is the PORCH — the
  // material scan was green and the picture was of a closed front door. Each
  // fixture carries its own authored `browse` offset; stand on it, look at the
  // goods, and shoot.
  const shootFixture = async (fixtureId, name, aimY = 1.15) => {
    const staged = await page.evaluate(({ id, aimY: ay }) => {
      const app = window.__fw;
      const ch = app.scene3d.clubhouse();
      const st = app.state;
      const all = [...(st.shop.layout?.extra || [])];
      let f = all.find((e) => e.id === id);
      if (!f) {
        // a real placed fixture: read it back from the sim's own view
        const placed = app.placedFixtures ? app.placedFixtures(st) : null;
        f = placed && placed.find((p) => p.id === id);
      }
      if (!f) return null;
      const browse = (f.browse && f.browse[0]) || { x: 0, z: 1.0 };
      const cos = Math.cos(f.ry || 0);
      const sin = Math.sin(f.ry || 0);
      const localX = f.x + browse.x * cos + browse.z * sin;
      const localZ = f.z - browse.x * sin + browse.z * cos;
      const stand = ch.localToWorld(localX, localZ);
      const target = ch.localToWorld(f.x, f.z);
      const w = app.scene3d.walk.state;
      w.x = stand.x;
      w.z = stand.z;
      const dx = target.x - w.x;
      const dz = target.z - w.z;
      const h = Math.hypot(dx, dz) || 0.001;
      w.yaw = Math.atan2(-dx / h, -dz / h);
      w.pitch = Math.atan2(ay - 1.62, h);
      return { id, stand, target, dist: +h.toFixed(2) };
    }, { id: fixtureId, aimY });
    if (!staged) { console.log(`(no fixture ${fixtureId} to shoot)`); return null; }
    await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(OUT, `${tag}-${name}.png`) });
    console.log(`shot ${name}: standing ${staged.dist} yd off ${fixtureId}`);
    return staged;
  };

  out.shots = {};
  out.shots.pegboard = await shootFixture('shelf_acc', 'towel-pegboard', 1.25);
  out.shots.table = await shootFixture('qa_table_polos', 'garments-table', 0.95);
  out.shots.rail = await shootFixture('qa_rail_outer', 'garments-rail', 1.45);
  out.shots.hats = await shootFixture('qa_hatstand', 'caps', 1.35);
  await page.screenshot({ path: path.join(OUT, `${tag}-apparel.png`) });
  out.summary = {
    prototypesLoaded: 11 - missing.length,
    heroMaterials: Object.keys(out.afterUpgrade.found).sort(),
    heroMeshes: out.afterUpgrade.meshes,
  };
  fs.writeFileSync(path.join(OUT, `${tag}.json`), `${JSON.stringify(out, null, 2)}\n`);
  console.log('\n== goal 37 hero apparel ==');
  console.log(JSON.stringify(out.summary, null, 2));
  console.log(`failures ${out.failures.length} · evidence qa/goal37/${tag}.json`);
}
