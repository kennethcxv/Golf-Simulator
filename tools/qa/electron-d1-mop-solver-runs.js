// D1 (Goal 23) — IS THE MOP'S SOLVER BEING CALLED AT ALL?
//
// WHAT THE OLD CHECK MEASURED, AND WHY ITS CONTROL WAS VOID.
// electron-b-mop-is-simulated.js (Goal 22) read the drawn instance matrices,
// walked the player, and compared. It measured stillDrift 0, walkDrift 0,
// settleDrift 0 — and then passed its own negative control, "a motionless head
// must produce a still mop", because an all-zeros rig satisfies that trivially.
// A frozen rig and a correctly resting rig are the same numbers. The report
// said so at the time and called the control void; this is the replacement.
//
// THE POSITIVE CONTROL. Before believing any "it moved" reading, this forces a
// displacement the solver cannot ignore — it teleports the whole viewmodel a
// known distance and steps time — and requires the drawn matrices to CHANGE. An
// instrument that cannot make the needle move has not proved the needle works.
//
// Then, and only then, the real questions:
//   * do the tips hang BELOW the collar (gravity is integrating)?
//   * does walking MOVE them (the solver is stepping in the game loop)?
//   * does standing still SETTLE them (it is not just jitter)?
//
//   node tools/qa/run-electron.cjs tools/qa/electron-d1-mop-solver-runs.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/d1-mop-solver');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(3000);

  // inside, mop in hand, IN DAYLIGHT.
  //
  // The first run of this driver photographed a black rectangle. The game
  // starts at 6:01 AM and the interior at 6 AM is unreadable — which is item 4
  // of the fourteen the stranger found inside, arrived at here from a
  // completely different direction: a driver that could not take a picture of
  // an object it had just measured. The clock is pinned to 14:00 for the
  // photograph, and the darkness is reported rather than worked around.
  await page.evaluate(() => {
    const app = window.__fw;
    const ch = app.scene3d.clubhouse();
    const o = ch.interior.position;
    const w = app.scene3d.walk.state;
    app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440 + 14 * 60;
    if (app.empire) app.empire.clockMinutes = app.state.clock.minutes;
    ch.setTimeMood?.(14 * 60);
    w.x = o.x + 1.0; w.z = o.z + 0.5; w.yaw = Math.PI * 0.5; w.pitch = -0.35;
  });
  await page.waitForTimeout(700);
  await page.keyboard.press('m');
  await page.waitForTimeout(3500);

  // THE RIG ITSELF, asked for by name rather than hunted for in the graph.
  out.rig = await page.evaluate(() => {
    const app = window.__fw;
    const diag = app.scene3d.walk.toolViewmodelDiagnostics?.() || null;
    let root = null;
    app.scene3d.scene?.traverse((n) => { if (!root && n.name === 'MopVerletRig') root = n; });
    if (!root) return { found: false, diag: diag ? Object.keys(diag) : null };
    const layers = root.children.filter((c) => c.isInstancedMesh);
    return {
      found: true,
      layers: layers.length,
      instancesPerLayer: layers.map((l) => l.count),
    };
  });
  if (!out.rig.found) {
    out.ok = false;
    out.why = 'MopVerletRig is not in the scene — nothing below is about the mop';
    fs.writeFileSync(path.join(OUT, 'mop-solver.json'), `${JSON.stringify(out, null, 2)}\n`);
    console.log('D1', JSON.stringify(out, null, 2));
    return out;
  }

  // Read the LAST layer's instance translations in world space: those are tips.
  const sample = () => page.evaluate(async () => {
    const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
    let root = null;
    window.__fw.scene3d.scene.traverse((n) => { if (!root && n.name === 'MopVerletRig') root = n; });
    if (!root) return null;
    root.updateMatrixWorld(true);
    const layers = root.children.filter((c) => c.isInstancedMesh);
    const last = layers[layers.length - 1];
    if (!last) return null;
    const m = new THREE.Matrix4();
    const v = new THREE.Vector3();
    const tips = [];
    for (let i = 0; i < last.count; i += 1) {
      last.getMatrixAt(i, m);
      v.setFromMatrixPosition(m).applyMatrix4(last.matrixWorld);
      tips.push({ x: +v.x.toFixed(4), y: +v.y.toFixed(4), z: +v.z.toFixed(4) });
    }
    const collar = new THREE.Vector3().setFromMatrixPosition(root.matrixWorld);
    return {
      collarY: +collar.y.toFixed(4),
      count: tips.length,
      tips,
      meanTipY: +(tips.reduce((s, t) => s + t.y, 0) / tips.length).toFixed(4),
    };
  });

  const drift = (a, b) => {
    if (!a || !b) return null;
    let worst = 0;
    for (let i = 0; i < Math.min(a.tips.length, b.tips.length); i += 1) {
      worst = Math.max(worst, Math.hypot(
        a.tips[i].x - b.tips[i].x, a.tips[i].y - b.tips[i].y, a.tips[i].z - b.tips[i].z,
      ));
    }
    return +worst.toFixed(5);
  };

  // ---- POSITIVE CONTROL: force a displacement the solver cannot ignore -----
  // A YAW SWING, not a teleport. My first version pushed walk.x by 2.2 yards
  // and measured a drift of exactly zero — because a 2.2-yard jump is either
  // blocked by collision or snapped back by the local unstick recovery (X1,
  // Goal 21) inside the half second before the sample. A positive control that
  // the game quietly undoes is not a control. Yaw cannot be refused: turning
  // ninety degrees swings the held head through a wide arc and nothing in the
  // movement code has an opinion about it.
  // A positive control belongs on the INSTRUMENT, not on the game. Two earlier
  // versions moved the player — a 2.2-yard teleport (undone by collision
  // recovery) and a 90-degree yaw swing (raced the frame it was sampled on, and
  // read 3.12 once and 0.00 the next run). Both were testing the game's ability
  // to be pushed, which is not the question. The question is whether this
  // sampler can see a displacement AT ALL, so the rig's own parent is
  // translated a known distance in the scene graph, synchronously, with no
  // simulation involved: if the sampled world tips do not move by ~2 yards, the
  // sampler is blind and every zero it reports is unreadable.
  const beforeKick = await sample();
  await page.evaluate(() => {
    let root = null;
    window.__fw.scene3d.scene.traverse((n) => { if (!root && n.name === 'MopVerletRig') root = n; });
    if (!root || !root.parent) return;
    root.parent.position.x += 2.0;
    root.parent.updateMatrixWorld(true);
  });
  const afterKick = await sample();
  await page.evaluate(() => {
    let root = null;
    window.__fw.scene3d.scene.traverse((n) => { if (!root && n.name === 'MopVerletRig') root = n; });
    if (!root || !root.parent) return;
    root.parent.position.x -= 2.0;
    root.parent.updateMatrixWorld(true);
  });
  await page.waitForTimeout(1500);

  // ---- the real measurements ----------------------------------------------
  const still1 = await sample();
  await page.waitForTimeout(600);
  const still2 = await sample();
  await page.keyboard.down('w');
  await page.waitForTimeout(900);
  const moving = await sample();
  await page.keyboard.up('w');
  await page.waitForTimeout(1800);
  const settled = await sample();

  // THE PHOTOGRAPH, IN LIGHT THE HEAD CAN BE SEEN IN.
  //
  // Two attempts inside produced a black rectangle: at 6:01 AM, which is when
  // the game starts, and again at 14:00. The clubhouse interior lighting is on
  // the restoration path — a fresh save has no working lights, by design — so
  // the room really is that dark and no clock pin fixes it. The mop is a
  // viewmodel and renders wherever the player stands, so the photograph is
  // taken where the game itself puts the player on arrival: outside, in the sun.
  out.photo = await page.evaluate(() => {
    const app = window.__fw;
    const ch = app.scene3d.clubhouse();
    const w = app.scene3d.walk.state;
    const ip = ch.interior.position;
    w.x = ip.x + 1.0; w.z = ip.z + 16.0; // out on the lawn, facing the porch
    w.yaw = Math.PI;
    // The collar sits ABOVE eye level (measured: y 1.96 against a ~1.6 eye), so
    // the first outdoor attempt looked down at -0.55 and framed empty grass.
    w.pitch = -0.12;
    return { x: +w.x.toFixed(2), z: +w.z.toFixed(2), inside: !!ch.isInside(w.x, w.z, 0.35) };
  });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(OUT, 'mop-head.png') });

  const hang = still2 ? +(still2.collarY - still2.meanTipY).toFixed(4) : null;
  out.measured = {
    positiveControlDrift: drift(beforeKick, afterKick),
    stillDrift: drift(still1, still2),
    walkDrift: drift(still2, moving),
    settleDrift: drift(moving, settled),
    collarY: still2?.collarY ?? null,
    meanTipY: still2?.meanTipY ?? null,
    hangYd: hang,
    strandCount: still2?.count ?? null,
  };
  out.checks = {
    // THE INSTRUMENT WORKS: a forced 2.2 yd displacement must move the matrices.
    // Without this every zero below is unreadable.
    instrumentCanSeeMovement: (out.measured.positiveControlDrift ?? 0) > 0.5,
    // gravity is integrating: the tips hang below the collar
    yarnHangsDown: (hang ?? 0) > 0.10,
    // the solver is stepping inside the game loop
    walkingMovesTheYarn: (out.measured.walkDrift ?? 0) > 0.004,
    // and it is not perpetual jitter
    motionlessIsStill: (out.measured.stillDrift ?? 1) < 0.004,
    bandCountInRange: (still2?.count ?? 0) >= 16 && (still2?.count ?? 0) <= 24,
    noPageErrors: out.errs.length === 0,
  };
  out.ok = Object.values(out.checks).every(Boolean);
  fs.writeFileSync(path.join(OUT, 'mop-solver.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('D1', JSON.stringify({ rig: out.rig, measured: out.measured, checks: out.checks, ok: out.ok }, null, 2));
  return out;
}
