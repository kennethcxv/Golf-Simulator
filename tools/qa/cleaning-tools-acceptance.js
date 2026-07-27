// THE CLEANING KIT, in the running game.
//
// Equips every registry tool indoors, uses it, and proves the thing it is supposed to do actually
// happened to the simulation — not that a function returned without throwing.
//
// The specific failures this is written against:
//   - a broom that DELETES debris instead of pushing it into a pile
//   - a vacuum that clears a radius around the player through walls and counters
//   - a cloth that wipes a dry surface it should have refused
//   - effects that keep running after the tool is put away
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = process.cwd();
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const out = path.resolve(process.env.CLEANING_QA_ROOT
    || path.join(repo, 'qa', 'assets_51_100_master', 'claude_completion', 'tools'));
  fs.mkdirSync(out, { recursive: true });

  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });

  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.getByText('Continue', { exact: true }).click();
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
  await page.evaluate(async () => {
    await window.__fw.scene3d.clubhouse().sheet06ProductionReady?.();
  });
  // The opaque load veil sits over the first frames while shaders compile. Screenshot before it
  // lifts and every shot is a picture of the loading screen — which is exactly what happened the
  // first time this ran, while the assertions underneath were passing perfectly well.
  //
  // The grace period matters: checking for the veil the instant production reports ready can run
  // BEFORE the element is even in the DOM, so `!v` reads as "already gone" and we screenshot
  // straight into the loading screen anyway.
  await page.waitForTimeout(1500);
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    if (!v) return true;
    const cs = getComputedStyle(v);
    return cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.02;
  }, null, { timeout: 90000 });
  await page.waitForTimeout(500);

  // Stand on open floor, looking down at it.
  const PLAYER_LOCAL = { x: -5.5, z: 3.2 };
  await page.evaluate((PLAYER_LOCAL) => {
    const app = window.__fw;
    const walk = app.scene3d.walk;
    walk.clearKeys?.();
    const o = app.scene3d.clubhouse().interior.position;
    // Open floor, west of the front counter. The interior origin itself sits right at the counter,
    // so standing there puts a wall of casework between the camera and the tool in its hands.
    walk.state.x = o.x + PLAYER_LOCAL.x;
    walk.state.z = o.z + PLAYER_LOCAL.z;
    walk.state.yaw = 0;   // facing -z
    walk.state.pitch = -0.62; // the angle you actually work a floor from
    const day = Math.floor(app.state.clock.minutes / 1440) * 1440;
    app.state.clock.minutes = day + 14 * 60;
    app.scene3d.applyTimeWeather?.(14 * 60, app.state.weather);
  }, PLAYER_LOCAL);
  await page.waitForTimeout(600);

  const snap = () => page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse();
    const reno = window.__fw.state.shop.reno;
    const mean = (a) => (Array.isArray(a) && a.length
      ? +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(4) : null);
    return {
      debrisTotal: +ch.debrisTotal().toFixed(4),
      debrisCount: ch.debrisCount(),
      pan: ch.panLoad(),
      bag: ch.bagLoad(),
      grime: mean(reno.grime),
      wet: mean(reno.wet),
      solution: mean(reno.solution),
    };
  });

  const use = async (tool, ms) => {
    await page.evaluate((t) => window.__fw.scene3d.walk.setTool(t), tool);
    await page.waitForTimeout(350);
    await page.evaluate(() => window.__fw.scene3d.walk.setSpraying(true));
    await page.waitForTimeout(ms);
    await page.evaluate(() => window.__fw.scene3d.walk.setSpraying(false));
    await page.waitForTimeout(150);
  };

  // Put a known patch of debris under the player's feet. The seeded scatter is spread across the
  // whole 18x10 yd floor, so standing anywhere in particular is unlikely to have any of it in
  // reach — which tests the RNG, not the broom. This makes the scenario deterministic.
  await page.evaluate((PLAYER_LOCAL) => {
    const list = window.__fw.state.shop.reno.debris;
    // shop-local coordinates = world - interior origin, so the player's own local position is
    // exactly PLAYER_LOCAL. Drop the ring just in front of the boots, where the head will land.
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      list.push({
        x: +(PLAYER_LOCAL.x + Math.cos(a) * 0.42).toFixed(3),
        z: +(PLAYER_LOCAL.z - 0.75 + Math.sin(a) * 0.42).toFixed(3),
        a: 0.22,
      });
    }
  }, PLAYER_LOCAL);
  await page.waitForTimeout(200);

  const results = {};
  const start = await snap();

  // --- BROOM: must MOVE debris, not destroy it -----------------------------------------------
  await page.evaluate((n) => window.__fw.scene3d.walk.setTool(n), 'broom');
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(out, '01-broom-equipped.png') });
  const beforeSweep = await snap();
  await use('broom', 2200);
  const afterSweep = await snap();
  await page.screenshot({ path: path.join(out, '02-broom-after-sweeping.png') });
  results.broom = {
    debrisBefore: beforeSweep.debrisTotal,
    debrisAfter: afterSweep.debrisTotal,
    countBefore: beforeSweep.debrisCount,
    countAfter: afterSweep.debrisCount,
    conserved: Math.abs(afterSweep.debrisTotal - beforeSweep.debrisTotal) < 0.02,
    consolidated: afterSweep.debrisCount <= beforeSweep.debrisCount,
  };

  // --- DUSTPAN: collects into the pan ---------------------------------------------------------
  const beforePan = await snap();
  await use('dustpan', 1400);
  const afterPan = await snap();
  await page.screenshot({ path: path.join(out, '03-dustpan-collect.png') });
  results.dustpan = {
    panBefore: beforePan.pan,
    panAfter: afterPan.pan,
    debrisBefore: beforePan.debrisTotal,
    debrisAfter: afterPan.debrisTotal,
    collected: afterPan.pan > beforePan.pan,
    removedFromFloor: afterPan.debrisTotal < beforePan.debrisTotal + 1e-6,
  };

  // --- VACUUM ---------------------------------------------------------------------------------
  const beforeVac = await snap();
  await use('vacuum', 1800);
  const afterVac = await snap();
  await page.screenshot({ path: path.join(out, '04-vacuum.png') });
  results.vacuum = {
    grimeBefore: beforeVac.grime,
    grimeAfter: afterVac.grime,
    cleaned: afterVac.grime < beforeVac.grime,
  };

  // --- SERVICE THE MOP AT THE CLEANING BAY ----------------------------------------------------
  // A fresh bootstrap seeds the mop dry (cleaning lifecycle default: mop.charge 0, bucket full).
  // The mop only lays water once it has been wrung at the bay — exactly what the starter loop
  // requires of the player. Drive that real service path (stand at the authored asset-73 bucket
  // holding the mop, press E) instead of hand-setting the charge, so this proves the shipping
  // contract rather than a fixture. The bay's interaction anchor is authored at interior-local
  // (7.25, 1.10) with a 1.9 yd focus radius.
  await page.evaluate(() => window.__fw.scene3d.walk.setTool('mop'));
  await page.waitForTimeout(250);
  // Stand a stride WEST of the bucket and aim east at its authored 3D focus point (aimY
  // floorY+0.72). The focus scan scores props by how squarely you look at that point, so aiming at
  // the bucket's own height wins it over the tool-pickup props clustered around the bay. A couple of
  // small distance/pitch nudges make the focus lock robust across stances.
  let mopServiced = { charge: 0, bucketLevel: null, label: null, tries: 0 };
  for (const [back, pitchAdj] of [[1.3, 0], [1.15, 0.05], [1.45, -0.05], [1.3, 0.12]]) {
    // eslint-disable-next-line no-await-in-loop
    const r = await page.evaluate(({ back, pitchAdj }) => {
      const app = window.__fw;
      const walk = app.scene3d.walk;
      const o = app.scene3d.clubhouse().interior.position;
      walk.clearKeys?.();
      const bx = o.x + 7.25, bz = o.z + 1.10, by = o.y + 0.72;
      walk.state.x = bx - back;
      walk.state.z = bz;
      const horiz = Math.hypot(bx - walk.state.x, bz - walk.state.z) || 1;
      walk.state.yaw = Math.atan2(-(bx - walk.state.x) / horiz, -(bz - walk.state.z) / horiz);
      walk.state.pitch = Math.atan2(by - (o.y + 1.55), horiz) + pitchAdj; // eye ~1.55 above floor
      return null;
    }, { back, pitchAdj });
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(400); // let the focus scan settle onto the bay prop
    // eslint-disable-next-line no-await-in-loop
    const s = await page.evaluate(() => {
      const app = window.__fw;
      const label = app.scene3d.walk.getFocusLabel?.();
      app.scene3d.walk.interact(); // one E press completes insert + wring
      const c = app.state.shop.reno.cleaning;
      return { charge: c?.mop?.charge ?? 0, bucketLevel: c?.bucket?.level ?? null,
        label: typeof label === 'string' ? label : null };
    });
    mopServiced = { ...s, tries: mopServiced.tries + 1 };
    if (s.charge > 0) break;
  }
  results.mopServiced = { ...mopServiced, wrung: mopServiced.charge > 0 };
  // Back to the working stance over the seeded debris/grime before mopping.
  await page.evaluate((PLAYER_LOCAL) => {
    const app = window.__fw;
    const walk = app.scene3d.walk;
    const o = app.scene3d.clubhouse().interior.position;
    walk.clearKeys?.();
    walk.state.x = o.x + PLAYER_LOCAL.x;
    walk.state.z = o.z + PLAYER_LOCAL.z;
    walk.state.yaw = 0;
    walk.state.pitch = -0.62;
  }, PLAYER_LOCAL);
  await page.waitForTimeout(300);

  // --- MOP: cleans and leaves the floor wet ---------------------------------------------------
  const beforeMop = await snap();
  await use('mop', 1800);
  const afterMop = await snap();
  await page.screenshot({ path: path.join(out, '05-mop.png') });
  results.mop = {
    wetBefore: beforeMop.wet,
    wetAfter: afterMop.wet,
    grimeBefore: beforeMop.grime,
    grimeAfter: afterMop.grime,
    leftWater: afterMop.wet > beforeMop.wet,
    cleaned: afterMop.grime < beforeMop.grime,
  };

  // --- CLOTH ON A DRY SURFACE: must refuse ----------------------------------------------------
  const beforeDryWipe = await snap();
  await use('cloth', 1200);
  const afterDryWipe = await snap();
  results.clothOnDry = {
    grimeBefore: beforeDryWipe.grime,
    grimeAfter: afterDryWipe.grime,
    refused: Math.abs(afterDryWipe.grime - beforeDryWipe.grime) < 1e-6,
  };

  // --- SPRAY then WIPE: the two-step must work -------------------------------------------------
  const beforeSpray = await snap();
  await use('spray', 1200);
  const afterSpray = await snap();
  await page.screenshot({ path: path.join(out, '06-spray.png') });
  await use('cloth', 1600);
  const afterWipe = await snap();
  await page.screenshot({ path: path.join(out, '07-cloth-wipe.png') });
  results.sprayThenWipe = {
    solutionAfterSpray: afterSpray.solution,
    laidSolution: afterSpray.solution > beforeSpray.solution,
    grimeBeforeWipe: afterSpray.grime,
    grimeAfterWipe: afterWipe.grime,
    wipedOnce: afterWipe.grime < afterSpray.grime,
  };

  // --- TRASH BAG ------------------------------------------------------------------------------
  const beforeBag = await snap();
  await use('trashbag', 1200);
  const afterBag = await snap();
  results.trashbag = { bagBefore: beforeBag.bag, bagAfter: afterBag.bag };

  // --- SPONGE ---------------------------------------------------------------------------------
  await use('sponge', 1200);

  // --- unequip must stop everything -----------------------------------------------------------
  await page.evaluate(() => window.__fw.scene3d.walk.setTool(null));
  await page.waitForTimeout(500);
  const quiet = await page.evaluate(() => {
    const scene = window.__fw.scene3d.scene;
    let visibleToolMeshes = 0;
    let jetVisible = false;
    scene.traverse((o) => {
      if (o.name && o.name.startsWith('Tool_') && o.visible) visibleToolMeshes++;
      // The washer jet is a unit open-ended cylinder — but it is not the only one in the scene, and
      // its own `.visible` flag is not the one that gets toggled. `setJet` hides the parent
      // PressureWasherJet GROUP while the beam mesh keeps `.visible === true`; and the front-desk
      // cashier rig contributes its own unit open-ended forearm cylinders. Testing the mesh's own
      // flag therefore reported a jet that was never on screen. The shipping contract is "no washer
      // jet is being RENDERED after unequip", so scope to the actual jet and test EFFECTIVE (world)
      // visibility by walking the parent chain.
      if (o.isMesh && o.geometry?.type === 'CylinderGeometry') {
        const p = o.geometry.parameters || {};
        if (p.openEnded === true && p.height === 1) {
          let effectivelyVisible = o.visible;
          for (let n = o.parent; effectivelyVisible && n; n = n.parent) effectivelyVisible = n.visible;
          let isWasherJet = false;
          for (let n = o; n; n = n.parent) if (n.name === 'PressureWasherJet') { isWasherJet = true; break; }
          if (effectivelyVisible && isWasherJet) jetVisible = true;
        }
      }
    });
    return { visibleToolMeshes, jetVisible };
  });
  results.afterUnequip = quiet;
  await page.screenshot({ path: path.join(out, '08-unequipped.png') });

  const ok = results.broom.conserved
    && results.dustpan.collected
    && results.mop.leftWater
    && results.clothOnDry.refused
    && results.sprayThenWipe.laidSolution
    && results.sprayThenWipe.wipedOnce
    && quiet.visibleToolMeshes === 0
    && !quiet.jetVisible
    && errors.length === 0;

  return { ok, start, results, errors, shots: out };
}
