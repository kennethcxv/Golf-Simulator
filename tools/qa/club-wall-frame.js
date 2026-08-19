// THE CLUB WALL, LIT, ON pine-hills-v3 -- the frame that has never existed.
//
// The owner's placement: "the retail wall opposite the front desk, so a
// customer walking in sees clubs and the desk in the same frame." So the
// acceptance frame is taken FROM THE DOOR, at eye height, at the default player
// camera, with the clock pinned to mid-morning -- the first club frames anyone
// tried were shot at 6:02 AM into a black room, which is the trap the ground
// work hit too, so the pin throws if it does not take.
//
// It also PROVES the wall rather than only photographing it: the three racks
// are found by their fixture ids in the live scene, their world positions read
// off matrixWorld, and the hero club materials (DriverCrown, IronFace,
// PutterBody...) counted as DRAWN -- layers.mask non-zero and every ancestor
// visible, because batched props draw through the mask and a scene-graph
// `visible` check measures geometry that never draws.
//
//   node tools/qa/run-electron.cjs tools/qa/club-wall-frame.js --clubhouse=pine-hills-v3
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const OUT = 'qa/clubwall';
  fs.mkdirSync(OUT, { recursive: true });
  const out = { failures: [] };
  const fail = (w) => { out.failures.push(w); console.log('FAIL:', w); };

  const boot = await import(`file:///${process.cwd().split(String.fromCharCode(92)).join('/')}/tools/qa/lib/qa-boot.mjs`);
  await boot.clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await boot.ownerResolution(page, page.electronApp);
  await page.waitForTimeout(2500);

  // MID-MORNING, ASSERTED. state.clock.minutes, not hour/minute.
  out.clock = await page.evaluate(() => {
    window.__fw.state.clock.minutes = 630;
    if ('speedIdx' in window.__fw.state) window.__fw.state.speedIdx = 0;
    return window.__fw.state.clock.minutes;
  });
  if (out.clock !== 630) throw new Error(`clock pin did not take: ${out.clock}`);

  // TURN THE LIGHTS ON. The starter is a failing municipal shop whose ceiling
  // CIRCUIT IS DEAD -- the first pass of this driver photographed a correctly
  // built club wall in the dark and the game itself said why on the HUD ("the
  // ceiling circuit is dead; repair the ceiling first"). That is a fact about
  // the starter, not about the fixture, and the owner asked for the wall LIT.
  // So the architecture is marked restored and every ceiling panel set working,
  // which is the state the player reaches by doing the repair beat.
  out.lit = await page.evaluate(() => {
    const reno = window.__fw.state.shop.reno;
    const comps = reno.architecture.components;
    for (const k of Object.keys(comps)) comps[k].restored = true;
    for (const k of Object.keys(reno.lightPanels)) reno.lightPanels[k] = 'working';
    return { components: Object.keys(comps).length, panels: { ...reno.lightPanels } };
  });
  console.log('lit:', JSON.stringify(out.lit));

  // STOCK THE WALL. The starter is a failing municipal shop: the racks are real
  // fixtures now, but nothing is on them, and a photograph of three empty
  // towers is not a photograph of a club wall. refreshShopProgression() is the
  // call that re-lays the fixtures AND rebuilds their stock -- rebuildStock()
  // alone skips any fixture whose Fixture_<id> anchor was never laid, which is
  // how an earlier driver read three unbuilt racks as "the racks drew no clubs".
  out.stocked = await page.evaluate(() => {
    const st = window.__fw.state;
    const inv = st.shop.inventory;
    const ids = ['driver1', 'driver2', 'driver3', 'irons1', 'irons2',
      'wedge1', 'wedge2', 'putter1', 'putter2', 'putter3'];
    for (const id of ids) {
      inv[id] = inv[id] || { shelf: 0, back: 0 };
      inv[id].shelf = 4;
    }
    return ids.length;
  });
  await page.evaluate(() => window.__fw.scene3d.clubhouse().refreshShopProgression?.());
  await page.waitForTimeout(2500);
  await page.evaluate(() => window.__fw.scene3d.clubhouse().rebuildStock?.());
  await page.waitForTimeout(2000);

  // Where everything actually is, in world space, from the live interior.
  out.places = await page.evaluate(() => {
    const app = window.__fw;
    const ch = app.scene3d.clubhouse();
    const L = (x, z) => ch.localToWorld(x, z);
    return {
      door: L(-0.8, 3.60),
      clubs: L(-0.10, -4.25),
      desk: L(3.30, 3.35),
      standback: L(-1.60, 4.10),
    };
  });

  const shoot = async (name, from, lookAt, pitch) => {
    await page.evaluate(([p, t, pi]) => {
      const w = window.__fw.scene3d.walk;
      const st = w.state;
      st.x = p.x; st.z = p.z;
      // THE CAMERA LOOKS ALONG -(sin yaw, cos yaw), NOT +. The first run aimed
      // with atan2(dx, dz) and photographed the EXIT door with the entry rug's
      // lettering mirrored -- a frame taken with the club wall exactly behind
      // the player. Negating the target vector is the whole fix, and the
      // mirrored rug is the tell to look for if it ever comes back.
      st.yaw = Math.atan2(p.x - t.x, p.z - t.z);
      st.pitch = pi;
    }, [from, lookAt, pitch]);
    await page.waitForTimeout(1800);
    await page.screenshot({ path: `${OUT}/${name}.png` });
    console.log(`   wrote ${OUT}/${name}.png`);
  };

  // THE ACCEPTANCE FRAME: standing at the door, aimed at the bisector between
  // the club wall and the desk, so both are in one shot -- which is the whole
  // claim the placement was chosen to make.
  const p = out.places;
  const mid = {
    x: (p.clubs.x + p.desk.x) / 2,
    z: (p.clubs.z + p.desk.z) / 2,
  };
  await shoot('01-door-clubs-and-desk', p.standback, mid, -0.02);
  await shoot('02-door-club-wall', p.door, p.clubs, -0.02);
  await shoot('03-clubs-close', {
    x: p.clubs.x, z: p.clubs.z + 3.2,
  }, p.clubs, -0.05);

  // IS ANY OF IT DRAWN? The hero material names, counted as drawn.
  const HERO = ['DriverCrown', 'DriverFace', 'DriverShaft', 'DriverGrip',
    'IronBody', 'IronFace', 'IronShaft', 'IronGrip',
    'PutterBody', 'PutterFace', 'PutterShaft', 'PutterGrip'];
  out.drawn = await page.evaluate((want) => {
    const app = window.__fw;
    let cam = null;
    for (const k of Object.keys(app.scene3d)) {
      const v = app.scene3d[k]; if (v && v.isCamera) { cam = v; break; }
    }
    let scene = cam; while (scene && scene.parent) scene = scene.parent;
    const set = new Set(want);
    const hit = new Map();
    const racks = {};
    scene.traverse((o) => {
      const n = o.name || '';
      if (/^Fixture_rack_(drivers|irons|putters)$/.test(n)) {
        const m = o.matrixWorld.elements;
        racks[n] = { x: +m[12].toFixed(2), z: +m[14].toFixed(2), visible: o.visible };
      }
      if (!o.isMesh || !o.material) return;
      if (o.layers.mask === 0) return;
      let shown = o.visible;
      for (let q = o.parent; q && shown; q = q.parent) shown = q.visible;
      if (!shown) return;
      const ms = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of ms) {
        if (m && set.has(m.name)) hit.set(m.name, (hit.get(m.name) || 0) + 1);
      }
    });
    return { materials: Object.fromEntries(hit), racks };
  }, HERO);

  console.log('\nracks found in the live scene:', JSON.stringify(out.drawn.racks));
  console.log('hero club materials DRAWN:', JSON.stringify(out.drawn.materials));
  const found = Object.keys(out.drawn.materials).length;
  if (!found) fail('not one hero club material is drawn — the wall is empty or the racks did not build');

  fs.writeFileSync(`${OUT}/frame.json`, JSON.stringify(out, null, 2));
  console.log(`\nfailures: ${out.failures.length}`);
}
