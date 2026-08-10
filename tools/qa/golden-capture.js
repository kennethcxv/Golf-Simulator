// H5 — golden-image capture. Fixed poses, deterministic state, canvas-only.
//
// 102 instrument faults are on record and no numeric check can see a rake, a
// hat through a face, or a book inside its own covers. These captures CAN.
//
// Determinism decisions, each load-bearing:
//   - clock pinned to 14:00 before any capture (delivery drivers' precedent)
//   - every live customer despawned, and respawned arrivals despawned again
//     right before each pose
//   - the DOM UI (#ui) is hidden — clock text and money change every run and
//     are not what this instrument watches; the CANVAS is the subject
//   - 45 warm frames after each pose change (shadow fit is 10 Hz, GTAO
//     accumulates; first tool equip compiles shaders for up to ~8 s, so tool
//     poses wait for the viewmodel to report active first)
//   - window forced to 1600x940 DIP (main.cjs default) so pixels align across
//     runs on this machine
//
// Ledger-open and customer-at-till poses are DEFERRED on purpose: sections B
// and F of Full_Goal_18 are about to change those exact pixels; their goldens
// get pinned when that work lands.
//
//   node tools/qa/run-electron.cjs tools/qa/golden-capture.js --clubhouse=pine-hills-v2 [--out=DIR]
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const outArg = process.argv.find((a) => a.startsWith('--out='));
  const OUT = path.resolve(outArg ? outArg.slice(6) : 'qa/golden/current');
  fs.mkdirSync(OUT, { recursive: true });

  // GOAL 19 WORLD PIN: every capture runs the SAME world. The harness profile
  // always boots a NEW GAME with a fresh random seed (measured: two boots,
  // two seeds, interior world-Y 1.6 yd apart — the "boot-varying world-Y"
  // that degraded every budget to 6.0). forceNew + pinSeed makes the seed a
  // constant, so the terrain, the building height, the sun-vs-floor geometry
  // and the outdoor content are byte-comparable across runs.
  const boot = await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`))
    .clickThroughMenu(page, { forceNew: true, pinSeed: 0.4242 });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  // the world is built; hand real randomness back to the runtime
  await page.evaluate(() => window.__qaRestoreRandom?.());
  try {
    const win = (await page.electronApp.browserWindow(page)) || null;
    if (win) await win.evaluate((w) => { w.setContentSize(1600, 940); });
  } catch { /* window shim differs; the default size is already 1600x940 */ }

  // Deterministic state: sim speed 0, day-preserving fixed clock, UI hidden.
  const prep = await page.evaluate(() => {
    const app = window.__fw;
    app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440 + 14 * 60;
    if (app.empire) app.empire.clockMinutes = app.state.clock.minutes;
    app.speedIdx = 0;
    app.scene3d.walk.clearKeys?.();
    const ui = document.getElementById('ui');
    if (ui) ui.style.visibility = 'hidden';
    return {
      clock: app.state.clock.minutes,
      speedIdx: app.speedIdx,
      // the pinned world, recorded: a drifting seed here means the pin broke
      seed: app.state.seed,
      interiorY: +app.scene3d.clubhouse().interior.position.y.toFixed(5),
    };
  });

  const waitFrames = (n) => page.evaluate((frames) => new Promise((res) => {
    let i = 0;
    const tick = () => (++i >= frames ? res() : requestAnimationFrame(tick));
    requestAnimationFrame(tick);
  }), n);

  const despawnAll = () => page.evaluate(async () => {
    const app = window.__fw;
    try {
      const simModule = await import('./src/sim/customerSimulation.js');
      const sim = simModule.ensureCustomerSimulation(app.state);
      const list = sim.active.slice();
      for (const c of list) { try { simModule.despawnCustomer(app.state, c, { reason: 'golden-capture' }); } catch { /* one stuck record must not void the pose */ } }
      return list.length;
    } catch (e) { return 'despawn unavailable: ' + e.message; }
  });

  const setPose = (dx, dz, yaw, pitch) => page.evaluate(([dx, dz, yaw, pitch]) => {
    const app = window.__fw;
    const w = app.scene3d.walk;
    const o = app.scene3d.clubhouse().interior.position;
    w.state.x = o.x + dx; w.state.z = o.z + dz;
    w.state.yaw = yaw; w.state.pitch = pitch;
    w.state.vx = 0; w.state.vz = 0;
  }, [dx, dz, yaw, pitch]);

  // Poses. Offsets are from the live interior origin (the STALE-QA-offset
  // lesson: constants rot, the origin does not).
  const POSES = [
    // Scouted 2026-08-09: this corner of pine-hills-v2 is walls/boxes in every
    // direction — these two are material/trim/window tripwires, not hero shots.
    // Hero poses (counter mid-sale, customer conversational, ledger open) get
    // added when sections B/C/F land the states they depend on.
    { name: 'shop-floor', dx: -5.6, dz: 4.4, yaw: -Math.PI / 2, pitch: 0 },
    { name: 'stockroom-wall', dx: 0.0, dz: -2.0, yaw: 0, pitch: -0.05 },
  ];
  const TOOLS = ['broom', 'mop', 'vacuum', 'spray', 'cloth', 'sponge', 'dustpan', 'trashbag', 'washer', 'paint'];

  const shot = async (name) => {
    await despawnAll();
    await waitFrames(45);
    const canvas = await page.$('#game');
    await (canvas || page).screenshot({ path: path.join(OUT, `${name}.png`) });
  };

  const manifest = { capturedAt: 'fixed-clock 14:00', poses: [], prep };
  for (const p of POSES) {
    await setPose(p.dx, p.dz, p.yaw, p.pitch);
    await shot(p.name);
    manifest.poses.push(p.name);
  }
  // Tool poses share one stance.
  for (const tool of TOOLS) {
    await setPose(-5.6, 4.4, -Math.PI / 2, -0.15);
    const ok = await page.evaluate((t) => {
      try { window.__fw.scene3d.walk.setTool(t); return true; } catch (e) { return String(e); }
    }, tool);
    if (ok !== true) { manifest.poses.push(`SKIP tool-${tool}: ${ok}`); continue; }
    await page.waitForFunction(
      () => !!(window.__fw.scene3d.walk.heldToolDiagnostics?.()?.vmActive ?? window.__fw.scene3d.walk.broomDiagnostics?.()?.vmActive ?? true),
      null, { timeout: 20000 },
    ).catch(() => {});
    await waitFrames(30);
    await shot(`tool-${tool}`);
    manifest.poses.push(`tool-${tool}`);
  }
  await page.evaluate(() => { try { window.__fw.scene3d.walk.setTool(null); } catch { /* bare hands may not be a tool id */ } });
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(JSON.stringify(manifest, null, 2));
}
