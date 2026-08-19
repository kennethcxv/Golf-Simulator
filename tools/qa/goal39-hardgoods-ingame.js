// THE FOUR BAKED HARDGOODS, REACHED THROUGH THE GAME.
//
// Block 5 baked hard_driver, hard_iron, hard_putter and hard_counter and
// assert_maps.mjs passes all fifteen. That is a fact about four FILES. This
// asks the only question that matters next: when the shop is running, is any
// of it on screen? `grep "models/hero" src/` finds the eleven garments and the
// counter. It finds no club.
//
// IDENTITY IS THE AUTHORED MATERIAL NAME. DriverCrown, IronFace, PutterBody,
// CounterOak exist in a live scene only if the model came through
// instantiateRaw and kept its own materials. The procedural club is a
// CylinderGeometry shaft wearing mats.merchShaft and the grey desk is a
// BoxGeometry wearing a local grey MeshStandardMaterial, so the two can never
// be confused and a build without the wiring reports zero.
//
// TWO HALVES, and they fail for DIFFERENT REASONS on the build this was
// written against -- which is the point of running it before the fix:
//
//   A  THE FRONT DESK. `mountHeroCounter()` exists and works, but it is gated
//      on `dressed`, which is pine-hills-v3 only. On pine-hills-v2 -- the room
//      the owner actually plays, and stands at for every transaction -- the
//      desk is still GREY_frontCounter, a grey box.
//
//   B  THE CLUB DISPLAY. rack_drivers / rack_irons / rack_putters are in
//      PINE_HILLS_V2_LAYOUT.cutFixtures: a failing municipal starter has no
//      club wall at all. So the racks are spliced in through layout.extra --
//      the same seam placedFixtures already reads, and the same one goal37
//      used for the apparel -- into the STOCKROOM zone, because the greybox
//      hides every retail-zone fixture anchor and stands an opaque volume
//      where it was. A club photographed on the clubwall zone of this variant
//      is photographed from inside a grey box.
//
// AND IT COSTS SOMETHING. A hero driver is 13,884 tris across EIGHT materials.
// The comb rack has twenty slots. Twenty heroes on one rack is not a wiring
// decision, it is a budget decision, so the draw-call and triangle delta of
// the racks is measured here and printed whether it passes or fails.
//
//   node tools/qa/run-electron.cjs \
//     tools/qa/goal39-hardgoods-ingame.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/goal39');
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
  // PIN THE CLOCK, AND FAIL IF THE PIN DID NOT TAKE.
  // The first frames off this driver were all shot at 6:02 AM and the club
  // display came back as a black rectangle, which reads exactly like a club
  // display that is not drawing. The field is `state.clock.minutes`; the ground
  // work lost eight frames to writing `hour`/`minute`, which do not exist and
  // do not throw.
  out.clock = await page.evaluate(() => {
    const c = window.__fw.state.clock;
    c.minutes = 630;
    return c.minutes;
  });
  if (out.clock !== 630) throw new Error(`clock pin did not take: minutes=${out.clock}`);
  await page.waitForTimeout(1200);
  await boot.ownerResolution(page, page.electronApp);
  await page.waitForTimeout(1500);

  // ---------------------------------------------------------------- scanner --
  //
  // DRAWN, not merely present. A prop batched into a merged static subtree is
  // still in the graph with `visible === true` while its layers.mask is 0 and
  // it never reaches the rasteriser, so `visible` alone has certified a mesh
  // that draws nothing. Walk the ancestors for visibility AND require a
  // non-zero layer mask.
  const HERO_MATS = {
    counter: ['CounterOak', 'CounterKick', 'CounterBrass', 'CounterTop'],
    driver: ['DriverCrown', 'DriverSole', 'DriverFace', 'DriverWeight',
      'DriverHosel', 'DriverFerrule', 'DriverShaft', 'DriverGrip'],
    iron: ['IronFace', 'IronBody', 'IronCavity', 'IronFerrule', 'IronShaft', 'IronGrip'],
    putter: ['PutterBody', 'PutterFace', 'PutterInsert', 'PutterSight', 'PutterWeight',
      'PutterNeck', 'PutterHosel', 'PutterFerrule', 'PutterShaft', 'PutterGrip'],
  };
  const scan = (names) => page.evaluate((wanted) => {
    const app = window.__fw;
    let cam = null;
    for (const k of Object.keys(app.scene3d)) {
      const v = app.scene3d[k];
      if (v && v.isCamera) { cam = v; break; }
    }
    let scene = cam;
    while (scene && scene.parent) scene = scene.parent;
    const want = new Set(wanted);
    const found = {};
    const drawnOf = (o) => {
      if (!o.layers || o.layers.mask === 0) return false;
      let n = o;
      while (n) { if (!n.visible) return false; n = n.parent; }
      return true;
    };
    scene.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
        if (!m || !want.has(m.name)) continue;
        const r = found[m.name] || (found[m.name] = {
          meshes: 0, drawn: 0, normalMap: false, aoMap: false, roughnessMap: false,
          colorAttr: false, vertexColors: false,
        });
        r.meshes += 1;
        if (drawnOf(o)) r.drawn += 1;
        r.normalMap = r.normalMap || !!m.normalMap;
        r.aoMap = r.aoMap || !!m.aoMap;
        r.roughnessMap = r.roughnessMap || !!m.roughnessMap;
        r.vertexColors = r.vertexColors || !!m.vertexColors;
        r.colorAttr = r.colorAttr || !!o.geometry?.attributes?.color;
      }
    });
    return found;
  }, names);

  // THE SCANNER'S OWN CONTROL, both directions, before it is believed.
  // A scanner that reports "no hero counter" is indistinguishable from a
  // scanner that reports nothing at all, and this half of the run is EXPECTED
  // to come back empty -- so prove it can see first.
  // NO `THREE` ON THE PAGE. The renderer has no bundler and the import map
  // resolves `three` inside the module graph, so there is no global to reach
  // for -- the first cut of this control asked for one, could not run, and
  // left every result below UNCONFIRMED. Clone a mesh that is already in the
  // scene instead: it needs no constructor, and it proves the same thing.
  out.control = await page.evaluate(() => {
    const app = window.__fw;
    let cam = null;
    for (const k of Object.keys(app.scene3d)) {
      const v = app.scene3d[k]; if (v && v.isCamera) { cam = v; break; }
    }
    let scene = cam; while (scene && scene.parent) scene = scene.parent;
    let donor = null;
    scene.traverse((o) => {
      if (donor || !o.isMesh || !o.material || Array.isArray(o.material)) return;
      if (o.geometry?.attributes?.position) donor = o;
    });
    if (!donor) return { injected: false, why: 'no donor mesh in the scene' };
    const probe = donor.clone();
    probe.material = donor.material.clone();
    probe.material.name = '__goal39ControlMat';
    probe.name = '__goal39ControlProbe';
    probe.layers.mask = donor.layers.mask;
    probe.visible = true;
    probe.position.set(0, -50, 0);   // under the floor: seen by the scan, not by the camera
    scene.add(probe);
    window.__goal39probe = probe;
    return { injected: true, donor: donor.name || donor.type };
  });
  if (out.control.injected) {
    const seen = await scan(['__goal39ControlMat']);
    out.control.positive = !!seen.__goal39ControlMat;
    await page.evaluate(() => {
      const p = window.__goal39probe;
      p.parent.remove(p); p.material.dispose();   // geometry is the donor's, still in use
      delete window.__goal39probe;
    });
    const gone = await scan(['__goal39ControlMat']);
    out.control.negative = !gone.__goal39ControlMat;
    const nonsense = await scan(['CounterOakThatCannotExist']);
    out.control.nonsense = Object.keys(nonsense).length === 0;
    const ok = out.control.positive && out.control.negative && out.control.nonsense;
    console.log(`scanner control: sees an injected __goal39ControlMat=${out.control.positive}, `
      + `reports it gone once removed=${out.control.negative}, `
      + `finds no material that does not exist=${out.control.nonsense}`);
    if (!ok) fail('the scanner cannot be trusted: its own control did not pass');
  } else {
    fail('scanner control could not run (no THREE on the page) — every result below is UNCONFIRMED');
  }

  const cost = () => page.evaluate(() => {
    const r = window.__fw.scene3d.renderer;
    return { calls: r.info.render.calls, tris: r.info.render.triangles, programs: r.info.programs.length };
  });

  // ------------------------------------------------------- A: the front desk --
  out.deskBefore = await page.evaluate(() => {
    const app = window.__fw;
    let cam = null;
    for (const k of Object.keys(app.scene3d)) {
      const v = app.scene3d[k]; if (v && v.isCamera) { cam = v; break; }
    }
    let scene = cam; while (scene && scene.parent) scene = scene.parent;
    const grey = scene.getObjectByName('GREY_frontCounter');
    const hero = scene.getObjectByName('HeroFrontDesk');
    return {
      greySlab: grey ? { visible: grey.visible, y: +grey.position.y.toFixed(3) } : null,
      heroDesk: hero ? { visible: hero.visible, children: hero.children.length } : null,
      variant: app.state?.property?.clubhouseVariant ?? null,
    };
  });
  out.deskMats = await scan(HERO_MATS.counter);
  console.log('\n-- A: the front desk --');
  console.log(`   grey slab GREY_frontCounter : ${out.deskBefore.greySlab
    ? `present, visible=${out.deskBefore.greySlab.visible}` : 'absent'}`);
  console.log(`   hero HeroFrontDesk          : ${out.deskBefore.heroDesk
    ? `present, visible=${out.deskBefore.heroDesk.visible}` : 'ABSENT'}`);
  for (const name of HERO_MATS.counter) {
    const r = out.deskMats[name];
    console.log(`   ${name.padEnd(14)} ${r ? `${r.drawn}/${r.meshes} drawn  normal=${r.normalMap ? 'Y' : 'n'} `
      + `ao=${r.aoMap ? 'Y' : 'n'} rough=${r.roughnessMap ? 'Y' : 'n'} COLOR_0=${r.colorAttr ? 'Y' : 'n'}` : 'not in the scene'}`);
  }
  const deskDrawn = HERO_MATS.counter.filter((n) => out.deskMats[n]?.drawn > 0);
  if (deskDrawn.length !== HERO_MATS.counter.length) {
    fail(`A: the front desk is not the hero counter — ${deskDrawn.length}/4 of its materials are drawn`);
  }
  if (out.deskBefore.greySlab?.visible && deskDrawn.length) {
    fail('A: the hero counter is drawn but the grey slab is still visible through it');
  }

  // -------------------------------------------------------- B: the club display --
  const costBare = await cost();
  out.extraAdded = await page.evaluate(() => {
    const st = window.__fw.state;
    const layout = st.shop.layout || (st.shop.layout = {});
    if (!layout.extra) layout.extra = [];
    const add = (f) => { if (!layout.extra.some((e) => e.id === f.id)) layout.extra.push(f); };
    // STOCKROOM, for the same reason goal37 used it: every retail zone on this
    // variant is covered by a grey volume and the fixture anchor under it is
    // hidden, so a club on the clubwall is a club inside a box.
    add({
      id: 'qa_rack_drivers', kind: 'rack', x: 6.30, z: -4.10, ry: 0,
      skus: ['driver1', 'driver2', 'driver3'], title: 'Drivers & woods', zone: 'stockroom',
      browse: [{ x: 0, z: 1.05 }], stock: [{ x: 0, z: 0.95 }],
    });
    add({
      id: 'qa_rack_irons', kind: 'rack', x: 6.30, z: -2.10, ry: 0,
      skus: ['irons1', 'irons2'], title: 'Irons & wedges', zone: 'stockroom',
      browse: [{ x: 0, z: 1.05 }], stock: [{ x: 0, z: 0.95 }],
    });
    add({
      id: 'qa_rack_putters', kind: 'rack', x: 6.30, z: -0.10, ry: 0,
      skus: ['putter1', 'putter2', 'putter3'], title: 'Putter studio', zone: 'stockroom',
      browse: [{ x: 0, z: 1.05 }], stock: [{ x: 0, z: 0.95 }],
    });
    const inv = st.shop.inventory;
    for (const id of ['driver1', 'driver2', 'driver3', 'irons1', 'irons2',
      'putter1', 'putter2', 'putter3']) {
      inv[id] = inv[id] || { shelf: 0, back: 0 };
      inv[id].shelf = 4;
    }
    return layout.extra.map((e) => e.id);
  });
  // rebuildStock ALONE CANNOT DO IT: `for (const f of activeFixtures(state))`
  // is followed immediately by `if (!anchor) continue`, and the anchor is the
  // `Fixture_<id>` group layFixtures() builds. A rack that was never laid is
  // silently skipped, and the first cut of this driver read that as "the racks
  // drew no hero clubs" when what it had measured was three racks that were
  // never in the room. refreshShopProgression() is the public call that
  // re-lays the fixtures AND rebuilds the stock on them.
  await page.evaluate(() => window.__fw.scene3d.clubhouse().refreshShopProgression?.());
  await page.waitForTimeout(2000);
  await page.evaluate(() => window.__fw.scene3d.clubhouse().rebuildStock?.());
  await page.waitForTimeout(1500);
  const costRacked = await cost();

  // Did the racks actually get built and stocked? Without this, an empty scan
  // is ambiguous between "no hero club" and "no rack".
  out.rackState = await page.evaluate((ids) => {
    const app = window.__fw;
    let cam = null;
    for (const k of Object.keys(app.scene3d)) {
      const v = app.scene3d[k]; if (v && v.isCamera) { cam = v; break; }
    }
    let scene = cam; while (scene && scene.parent) scene = scene.parent;
    return ids.map((id) => {
      const g = scene.getObjectByName(`Fixture_${id}`);
      let meshes = 0;
      if (g) g.traverse((o) => { if (o.isMesh) meshes += 1; });
      return { id, laid: !!g, meshes };
    });
  }, out.extraAdded);
  console.log('\n-- B: the club display --');
  for (const r of out.rackState) {
    // FURNITURE ONLY: the stock display is baked into `stockGroup`, not under
    // this anchor, so `meshes` here is the comb rack itself and says nothing
    // about whether a club is on it. The scene-wide material scan below is the
    // measurement; this is only the "was there a rack at all" precondition.
    console.log(`   rack ${r.id.padEnd(18)} laid=${r.laid} (furniture meshes ${r.meshes}; stock is not parented here)`);
    if (!r.laid) fail(`B: ${r.id} was never laid into the room — the scan below measures nothing`);
  }

  const clubNames = [...HERO_MATS.driver, ...HERO_MATS.iron, ...HERO_MATS.putter];
  out.clubMats = await scan(clubNames);
  out.clubProcedural = await page.evaluate(() => {
    const app = window.__fw;
    let cam = null;
    for (const k of Object.keys(app.scene3d)) {
      const v = app.scene3d[k]; if (v && v.isCamera) { cam = v; break; }
    }
    let scene = cam; while (scene && scene.parent) scene = scene.parent;
    // THE PROCEDURAL CLUB'S TELL IS ITS MATERIAL, NOT ITS GEOMETRY.
    // bakeStockGroup merges the whole display into one mesh per material
    // ("a rack of 12 clubs was 36 draw calls"), so by the time anything can be
    // measured every CylinderGeometry has become an anonymous BufferGeometry —
    // the first cut looked for the cylinder and reported zero procedural clubs
    // on a rack that was full of them.
    let shafts = 0;
    let heads = 0;
    scene.traverse((o) => {
      if (!o.isMesh) return;
      for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
        if (!m) continue;
        if (/merchShaft|^shaft/i.test(m.name || '')) shafts += 1;
        if (/^M_(steel|darkmetal|rubber)$/.test(m.name || '')) heads += 1;
      }
    });
    return { proceduralShaftMeshes: shafts, proceduralHeadMeshes: heads };
  });

  console.log(`   spliced in: ${out.extraAdded.join(', ')}`);
  console.log(`   procedural club meshes still on the racks: ${out.clubProcedural.proceduralShaftMeshes} shaft, ${out.clubProcedural.proceduralHeadMeshes} head`);
  for (const [kind, names] of [['driver', HERO_MATS.driver], ['iron', HERO_MATS.iron],
    ['putter', HERO_MATS.putter]]) {
    const hit = names.filter((n) => out.clubMats[n]?.drawn > 0);
    const first = out.clubMats[names[0]];
    console.log(`   ${kind.padEnd(7)} ${hit.length}/${names.length} materials drawn`
      + (first ? `   ${first.drawn}/${first.meshes} meshes  normal=${first.normalMap ? 'Y' : 'n'} `
        + `COLOR_0=${first.colorAttr ? 'Y' : 'n'}` : '   nothing in the scene'));
    if (!hit.length) fail(`B: the ${kind} display is not drawing the baked hero ${kind}`);
  }
  console.log(`\n   COST OF THE THREE RACKS  draws ${costBare.calls} -> ${costRacked.calls}`
    + ` (+${costRacked.calls - costBare.calls})   tris ${costBare.tris.toLocaleString()} -> `
    + `${costRacked.tris.toLocaleString()} (+${(costRacked.tris - costBare.tris).toLocaleString()})`
    + `   programs ${costBare.programs} -> ${costRacked.programs}`);
  out.cost = { bare: costBare, racked: costRacked };

  // --------------------------------------------------------------- the frames --
  //
  // The desk shot is the one the owner named: he stands at the till for every
  // transaction. Move the PLAYER, let the game tick, then read where the camera
  // actually is -- it lags walk.state by a frame, and the game's yaw sign is
  // the opposite of a hand-rolled rotation, so both are measured, never assumed.
  const yaw0 = await page.evaluate(() => {
    const c = window.__fw.scene3d.camera || window.__fw.scene3d.cam;
    return { x: c.position.x, z: c.position.z, fx: -Math.sin(c.rotation.y), fz: -Math.cos(c.rotation.y) };
  });
  await page.evaluate(() => { window.__fw.scene3d.walk.state.yaw += 0.35; });
  await page.waitForTimeout(400);
  const yaw1 = await page.evaluate(() => {
    const c = window.__fw.scene3d.camera || window.__fw.scene3d.cam;
    return { fx: -Math.sin(c.rotation.y), fz: -Math.cos(c.rotation.y) };
  });
  await page.evaluate(() => { window.__fw.scene3d.walk.state.yaw -= 0.35; });
  const turned = Math.atan2(yaw0.fx * yaw1.fz - yaw0.fz * yaw1.fx, yaw0.fx * yaw1.fx + yaw0.fz * yaw1.fz);
  const YAW_SIGN = turned < 0 ? -1 : 1;
  console.log(`\nyaw calibration: +0.350 rad turned the camera ${turned.toFixed(3)} rad — sign ${YAW_SIGN}`);

  // WALK.STATE IS IN WORLD COORDINATES, and every datum in this file --
  // FRONT_DESK_FRAME (3.30, 3.35), the spliced rack positions -- is
  // INTERIOR-LOCAL. The first cut set walk.state.x = 3.30 and teleported the
  // player 364 m across the terrain; the camera came to rest at y -0.48, on a
  // hillside, and photographed grass. The clubhouse publishes localToWorld for
  // exactly this, and the live object's own world position is better still.
  //
  // Aim is then SOLVED and VERIFIED, never assumed: turn toward the target
  // using the calibrated sign, let the game tick, and re-read where the camera
  // actually points. A framing that is off by more than a few degrees is
  // reported, because an unlooked-at frame of the wrong wall reads exactly
  // like an unlooked-at frame of the right one.
  const shot = async (name, target) => {
    if (target) {
      const placed = await page.evaluate(({ t, sign }) => {
        const app = window.__fw;
        const ch = app.scene3d.clubhouse();
        let cam = null;
        for (const k of Object.keys(app.scene3d)) {
          const v = app.scene3d[k]; if (v && v.isCamera) { cam = v; break; }
        }
        let scene = cam; while (scene && scene.parent) scene = scene.parent;
        // the object itself is the datum when we can find it
        let tw = null;
        if (t.object) {
          const o = scene.getObjectByName(t.object);
          if (o) { const v = new o.position.constructor(); o.getWorldPosition(v); tw = { x: v.x, y: v.y, z: v.z }; }
        }
        if (!tw && t.local) { const p = ch.localToWorld(t.local[0], t.local[1]); tw = { x: p.x, y: null, z: p.z }; }
        if (!tw) return null;
        const stand = ch.localToWorld(t.stand[0], t.stand[1]);
        const w = app.scene3d.walk;
        w.state.x = stand.x; w.state.z = stand.z;
        // face it: bearing from the stand point to the target, applied as a
        // DELTA off the camera's measured forward with the calibrated sign
        const fx = -Math.sin(cam.rotation.y);
        const fz = -Math.cos(cam.rotation.y);
        const dx = tw.x - stand.x;
        const dz = tw.z - stand.z;
        const turn = Math.atan2(fx * dz - fz * dx, fx * dx + fz * dz);
        w.state.yaw += sign * turn;
        return { target: tw, stand: { x: stand.x, z: stand.z }, turn };
      }, { t: target, sign: YAW_SIGN });
      if (!placed) { console.log(`   shot ${name}: target not found, SKIPPED`); return null; }
      await page.waitForTimeout(900);
      // did it end up pointing at the thing?
      const aim = await page.evaluate((t) => {
        const app = window.__fw;
        let cam = null;
        for (const k of Object.keys(app.scene3d)) {
          const v = app.scene3d[k]; if (v && v.isCamera) { cam = v; break; }
        }
        const fx = -Math.sin(cam.rotation.y);
        const fz = -Math.cos(cam.rotation.y);
        const dx = t.x - cam.position.x;
        const dz = t.z - cam.position.z;
        const len = Math.hypot(dx, dz) || 1;
        return {
          offDeg: Math.abs(Math.atan2(fx * dz - fz * dx, fx * dx + fz * dz)) * 180 / Math.PI,
          dist: len,
        };
      }, placed.target);
      target.aim = aim;
      if (aim.offDeg > 12) fail(`frame ${name}: the camera is ${aim.offDeg.toFixed(1)}° off the subject — the shot is not of it`);
    }
    const where = await page.evaluate(() => {
      const c = window.__fw.scene3d.camera || window.__fw.scene3d.cam;
      return { x: +c.position.x.toFixed(2), y: +c.position.y.toFixed(2), z: +c.position.z.toFixed(2) };
    });
    const file = path.join(OUT, `${tag}-${name}.png`);
    await page.screenshot({ path: file });
    console.log(`   shot ${name.padEnd(16)} camera (${where.x}, ${where.y}, ${where.z})`
      + (target?.aim ? `  ${target.aim.dist.toFixed(2)} m away, ${target.aim.offDeg.toFixed(1)}° off` : '')
      + `  -> ${path.basename(file)}`);
    return { name, file, where, aim: target?.aim || null };
  };

  console.log('\n-- frames --');
  out.shots = [];
  out.shots.push(await shot('spawn', null));
  // THE TILL. "I stand at it for every transaction" — so the frame is from the
  // customer side of the desk, at the distance a person stands to be served.
  out.shots.push(await shot('desk-customer', {
    object: 'GREY_frontCounter', local: [3.30, 3.35], stand: [3.30, 1.75],
  }));
  out.shots.push(await shot('desk-oblique', {
    object: 'GREY_frontCounter', local: [3.30, 3.35], stand: [1.60, 1.60],
  }));
  out.shots.push(await shot('clubs-browse', {
    object: 'Fixture_qa_rack_drivers', local: [6.30, -4.10], stand: [6.30, -2.85],
  }));
  out.shots.push(await shot('clubs-room', {
    object: 'Fixture_qa_rack_irons', local: [6.30, -2.10], stand: [6.30, 0.40],
  }));

  fs.writeFileSync(path.join(OUT, `${tag}.json`), JSON.stringify(out, null, 2));
  console.log(`\n${out.failures.length ? `FAILED: ${out.failures.length} finding(s)` : 'PASSED'}`);
  if (out.errs.length) console.log(`page errors: ${out.errs.length}`);
  if (out.failures.length) process.exitCode = 1;
  return out;
}
