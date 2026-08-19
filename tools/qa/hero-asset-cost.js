// WHAT THE FIFTEEN HERO ASSETS COST THE PLAYED ROUTE.
//
// "Fifteen assets is ~12 MB of texture and ~230k tris entering a shop that had
// none of it, and you tuned that shop without them."
//
// FRAME TIME IS NOT ON THIS PAGE, and that is not an oversight. This box
// presents WebGL at 1 Hz (menu 14.6 ms/frame, scene 1009.9, in play 1003.0,
// one window, visible and focused throughout -- see
// Designs/ProShop/BOOT_AND_OUTDOOR_2026_08_19.md). Every millisecond read here
// is ~60x inflated and indoor and outdoor both sit on the same floor. Draw
// calls, triangles, programs and texture counts are NOT inflated, so those are
// what is reported and the frame-time question stays open and labelled.
//
// A/B IN ONE BOOT, so lighting, time of day, save state and driver state are
// shared rather than assumed equal. The heroes are found by the material names
// their bake carries -- the same identity goal39 uses, and one no procedural
// proxy can wear -- then hidden, measured, and restored. renderer.info.render
// is a PER-FRAME counter, so every reading waits for real frames after a
// toggle, and the restore is the control: if the numbers do not come back,
// something other than the heroes moved and the delta is not theirs.
//
//   node tools/qa/run-electron.cjs tools/qa/hero-asset-cost.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const OUT = 'qa/hero-cost';
  fs.mkdirSync(OUT, { recursive: true });
  const out = { failures: [] };
  const fail = (w) => { out.failures.push(w); console.log('FAIL:', w); };

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.split(String.fromCharCode(92)).join('/');
  const boot = await import(`file:///${bootPath}`);
  await boot.clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(2500);
  out.clock = await page.evaluate(() => {
    window.__fw.state.clock.minutes = 630;
    return window.__fw.state.clock.minutes;
  });
  if (out.clock !== 630) throw new Error(`clock pin did not take: ${out.clock}`);
  // FREEZE THE SHOP. The first run drifted 349 draws across one indoor A/B --
  // customers arrive, stock rebuilds, the day moves -- and a delta of +18 draws
  // read against that noise is not a measurement.
  out.froze = await page.evaluate(() => {
    const st = window.__fw.state;
    if ('speedIdx' in st) st.speedIdx = 0;
    return st.speedIdx ?? null;
  });
  await boot.ownerResolution(page, page.electronApp);
  await page.waitForTimeout(1500);

  // EVERY MATERIAL NAME THE FIFTEEN BAKES CARRY, read out of the GLBs rather
  // than written from memory. The first cut of this file guessed them
  // ('PoloBody', 'CapCrown', 'TowelBody') and matched FOUR -- the counter's --
  // so it reported the whole hero set costing what one desk costs. The real
  // names are below; regenerate by reading materials[].name from every
  // vendor/models/clubhouse/hero_*.glb.
  const HERO_MATS = [
    'CapEyelet', 'CapMetal', 'CapThread', 'CapTwill', 'CapUnder',
    'CounterBrass', 'CounterKick', 'CounterOak', 'CounterTop', 'DriverCrown',
    'DriverFace', 'DriverFerrule', 'DriverGrip', 'DriverHosel',
    'DriverShaft', 'DriverSole', 'DriverWeight', 'HoodieCord',
    'HoodieEyelet', 'HoodieFFleece', 'HoodieFRib', 'HoodieFleece',
    'HoodieRib', 'IronBody', 'IronCavity', 'IronFace', 'IronFerrule',
    'IronGrip', 'IronShaft', 'PoloButton', 'PoloFButton', 'PoloFPique',
    'PoloFTrim', 'PoloPique', 'PoloTrim', 'PutterBody', 'PutterFace',
    'PutterFerrule', 'PutterGrip', 'PutterHosel', 'PutterInsert',
    'PutterNeck', 'PutterShaft', 'PutterSight', 'PutterWeight', 'TeeFJersey',
    'TeeFRib', 'TeeJersey', 'TeeRib', 'TowelClip', 'TowelGrommet',
    'TowelTerry', 'TrouserFTrim', 'TrouserFTwill', 'TrouserTrim',
    'TrouserTwill', 'clamphangerSteel', 'clamphangerWood', 'hangerHook',
    'hangerWood', 'pegChrome',
  ];


  const setHeroes = (names, show) => page.evaluate(({ want, on }) => {
    const app = window.__fw;
    let cam = null;
    for (const k of Object.keys(app.scene3d)) {
      const v = app.scene3d[k]; if (v && v.isCamera) { cam = v; break; }
    }
    let scene = cam; while (scene && scene.parent) scene = scene.parent;
    const set = new Set(want);
    let touched = 0;
    scene.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      const ms = Array.isArray(o.material) ? o.material : [o.material];
      if (!ms.some((m) => m && set.has(m.name))) return;
      if (on) {
        if (o.userData.__heroWas !== undefined) {
          o.visible = o.userData.__heroWas;
          delete o.userData.__heroWas;
        }
      } else {
        o.userData.__heroWas = o.visible;
        o.visible = false;
      }
      touched += 1;
    });
    return touched;
  }, { want: names, on: show });

  const read = async (label) => {
    await page.waitForTimeout(2500);
    const r = await page.evaluate(() => {
      const s = window.__fw.scene3d;
      const renderer = s.renderer;
      const cam = s.camera || s.cam;
      return {
        calls: renderer.info.render.calls,
        tris: renderer.info.render.triangles,
        programs: renderer.info.programs.length,
        textures: renderer.info.memory.textures,
        geometries: renderer.info.memory.geometries,
        camY: cam ? +cam.position.y.toFixed(2) : null,
      };
    });
    console.log(`   ${label.padEnd(16)} draws ${String(r.calls).padStart(5)}`
      + `  tris ${r.tris.toLocaleString().padStart(11)}  programs ${r.programs}`
      + `  textures ${r.textures}  geometries ${r.geometries}`);
    return r;
  };

  const station = async (name) => {
    console.log(`\n-- ${name} --`);
    const withHeroes = await read('with heroes');
    const hidden = await setHeroes(HERO_MATS, false);
    const without = await read('heroes hidden');
    const restored = await setHeroes(HERO_MATS, true);
    const back = await read('restored');
    if (!hidden) fail(`${name}: no hero mesh was found to hide — this is not an A/B`);
    if (hidden !== restored) fail(`${name}: hid ${hidden} meshes but restored ${restored}`);
    const drift = Math.abs(back.calls - withHeroes.calls);
    console.log(`   ${hidden} hero meshes   COST: draws +${withHeroes.calls - without.calls}`
      + `  tris +${(withHeroes.tris - without.tris).toLocaleString()}`
      + `  programs +${withHeroes.programs - without.programs}   restore drift ${drift} draws`);
    if (drift > 2) fail(`${name}: restoring drifted ${drift} draws — the scene moved during the A/B`);
    return { name, withHeroes, without, back, heroMeshes: hidden, drift };
  };

  // isInside TAKES COORDINATES. Called bare it answers about (undefined,
  // undefined) and returns false everywhere, which is how the first run
  // labelled a 968-draw interior reading "never reached the interior" while
  // the player was standing in the shop. Pass the walk position.
  const isInside = () => page.evaluate(() => {
    const app = window.__fw;
    const c = app.scene3d.clubhouse();
    const w = app.scene3d.walk.state;
    return typeof c.isInside === 'function' ? !!c.isInside(w.x, w.z) : null;
  });

  // SPAWN IS OUTSIDE. The starter drops the player on the property to survey it,
  // so the first run's "INDOORS" station read isInside false and measured the
  // apron twice while calling one of them the shop floor. Walk to the interior
  // origin and assert arrival before anything is called an indoor number.
  out.stations = [];
  out.spawnInside = await isInside();
  await page.evaluate(() => {
    const app = window.__fw;
    const c = app.scene3d.clubhouse();
    const p = c.localToWorld(0, 0);
    const w = app.scene3d.walk;
    w.state.x = p.x; w.state.z = p.z;
  });
  await page.waitForTimeout(4000);
  out.indoorInside = await isInside();
  console.log(`
walked in: isInside ${out.spawnInside} -> ${out.indoorInside}`);
  if (out.indoorInside !== true) {
    fail('never reached the interior — the indoor station below is not an indoor reading');
  }
  out.stations.push(await station('INDOORS: the shop floor'));

  // OUTDOORS. Walk out rather than teleport: the door, the interior gate and
  // the outdoor light census are the reason for going.
  out.insideBefore = await isInside();
  await page.evaluate(() => { window.__fw.scene3d.walk.state.z += 14; });
  await page.waitForTimeout(4000);
  out.insideAfter = await isInside();
  console.log(`\nleft the clubhouse: isInside ${out.insideBefore} -> ${out.insideAfter}`);
  if (out.insideAfter === true) {
    fail('the walk never left the clubhouse — the outdoor station is a second indoor reading');
  }
  out.stations.push(await station('OUTDOORS: on the apron'));

  fs.writeFileSync(`${OUT}/cost.json`, JSON.stringify(out, null, 2));
  console.log(`\nfailures: ${out.failures.length}`);
}
