// GOAL 30 LEVER B — THE WATCHED-FAIL, ON CAMERA, WITH REAL INPUT.
//
// Freeze a real mover, watch it visibly stop, un-freeze it with the real
// module, watch it move again. Subject: the main entrance door, driven by
// its own [E] verb under pointer lock (the proximity auto-gate stays shut on
// a closed-for-business shop — the first cut of this driver waited on it for
// 72 s of sealed doors).
//
// Instrument rules this driver carries from the ledger:
//   * the LIVE pivot is the node whose door-controller flag is TRUE — the
//     procedural fallback carries the same key with FALSE and sits parked
//     BELOW THE FLOOR (y=-2.1), which is what the first cut monitored;
//   * motion is read from matrixWorld decomposition, never local rotation —
//     a frozen node's rotation property still mutates, its MATRIX is what
//     stops (and what renders);
//   * the focus label is read before every press, so each [E] provably
//     addressed the door and not dead air.
//
//   VIDEO_DIR=qa/goal30/door-freeze node tools/qa/run-electron.cjs \
//     tools/qa/goal30-door-freeze-watchedfail.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/goal30');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [], presses: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  const boot = await import(`file:///${bootPath}`);
  await boot.clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(6000);

  await page.evaluate(() => {
    const app = window.__fw;
    app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440 + 14 * 60;
    if (app.empire) app.empire.clockMinutes = app.state.clock.minutes;
    app.speedIdx = 0;
  });
  await page.waitForTimeout(1000);

  // Pine Hills runs its own door system — controller flags identified only
  // dormant twins here (the second dead end of this driver). So the subject
  // is picked the way the EYE picks it: stand at the entrance, raycast the
  // crosshair, and whatever mesh renders there IS the door slab to freeze.
  // place the player square in front of the doors first (from the recorded
  // fallback-door xz, which matched the visible doors horizontally in the
  // first cut's frames), facing the entrance
  await page.evaluate(() => {
    const s3 = window.__fw.scene3d;
    let fallback = null;
    s3.scene.traverse((o) => {
      const u = o.userData || {};
      if (!fallback) { for (const k in u) if (/door/i.test(k)) { fallback = o; break; } }
    });
    const V = s3.camera.position.constructor;
    const p = fallback.getWorldPosition(new V());
    // stand 1.7 outside on +z, face -z toward the slab (forward = -sin,-cos)
    s3.walk.exit();
    s3.walk.enter({ x: p.x, z: p.z + 1.7, yaw: 0 });
  });
  await page.waitForTimeout(900);
  out.setup = await page.evaluate(async () => {
    const THREE = await import('three');
    const s3 = window.__fw.scene3d;
    const rc = new THREE.Raycaster();
    rc.setFromCamera(new THREE.Vector2(0, 0), s3.camera);
    const hits = rc.intersectObjects(s3.scene.children, true)
      .filter((h) => h.object.visible && h.object.layers.mask !== 0);
    if (!hits.length) return { err: 'crosshair raycast hit nothing' };
    const slab = hits[0].object;
    // the swinging assembly root: walk up while parents stay small (a door
    // assembly is dozens of nodes; the shell root is thousands)
    let root = slab;
    const sizeOf = (n) => { let c = 0; n.traverse(() => { c += 1; }); return c; };
    while (root.parent && root.parent !== s3.scene && sizeOf(root.parent) < 80) root = root.parent;
    const meshes = [];
    root.traverse((o) => { if (o.isMesh && meshes.length < 6) meshes.push(o); });
    const V = s3.camera.position.constructor;
    const p = root.getWorldPosition(new V());
    window.__g30door = { root, meshes };
    return {
      hitName: slab.name || slab.type,
      hitDistance: +hits[0].distance.toFixed(2),
      rootName: root.name || root.type,
      rootNodes: sizeOf(root),
      world: [+p.x.toFixed(1), +p.y.toFixed(1), +p.z.toFixed(1)],
      meshCount: meshes.length,
    };
  });
  if (out.setup.err) { console.log(JSON.stringify(out, null, 2)); process.exitCode = 1; return out; }

  // pointer capture, then E is a real key press with the door under the
  // crosshair — the label is recorded with every press
  const vp = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
  await page.mouse.click(vp.width / 2, vp.height / 2);
  await page.waitForTimeout(600);

  const doorPose = () => page.evaluate(() => {
    const { meshes } = window.__g30door;
    // matrixWorld truth: sum of the first two meshes' world positions
    const V = meshes[0].getWorldPosition ? meshes[0].position.constructor : null;
    return meshes.slice(0, 2).map((m) => {
      const p = m.getWorldPosition(new V());
      return [+p.x.toFixed(3), +p.z.toFixed(3)];
    });
  });
  const focusLabel = () => page.evaluate(
    () => window.__fw.scene3d?.walk?.getFocusLabel?.() || null,
  );
  const pressE = async (tag) => {
    const label = await focusLabel();
    await page.keyboard.press('e');
    await page.waitForTimeout(1500); // full swing
    const pose = await doorPose();
    out.presses.push({ tag, label: label && String(label).slice(0, 60), pose });
  };

  const shot = (name) => page.screenshot({ path: path.join(OUT, `doorwf-${name}.png`) });

  // ---- A: normal open/close ---------------------------------------------------
  out.poseClosed = await doorPose();
  await shot('A0-closed');
  await pressE('A-open');
  await shot('A1-open');
  await pressE('A-close');

  // ---- B: freeze the LIVE subtree raw, then try to open ------------------------
  await page.evaluate(() => {
    const { root } = window.__g30door;
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      o.matrixAutoUpdate = false;
      o.userData.matrixFrozen = 'Goal30WatchedFail';
    });
  });
  await pressE('B-open-frozen');
  await shot('B1-frozen-open-attempt');
  await pressE('B-close-frozen');

  // ---- C: the module's own unfreeze, then open again ---------------------------
  out.thawed = await page.evaluate(async () => {
    const { unfreezeMatrices } = await import('./src/render3d/matrixFreeze.js');
    return unfreezeMatrices(window.__g30door.root);
  });
  await pressE('C-open-thawed');
  await shot('C1-thawed-open');
  await pressE('C-close-thawed');

  // movement per phase, from matrixWorld positions
  const moved = (a, b) => +Math.max(
    ...a.map((p, i) => Math.hypot(p[0] - b[i][0], p[1] - b[i][1])),
  ).toFixed(3);
  const at = (tag) => out.presses.find((p) => p.tag === tag).pose;
  out.movement = {
    A_openMoved: moved(out.poseClosed, at('A-open')),
    B_frozenMoved: moved(at('A-close'), at('B-open-frozen')),
    C_thawedMoved: moved(at('B-close-frozen'), at('C-open-thawed')),
  };
  const ok = out.movement.A_openMoved > 0.15
    && out.movement.B_frozenMoved < 0.02
    && out.movement.C_thawedMoved > 0.15
    && out.presses.every((p) => p.label);
  out.verdict = ok
    ? 'WATCHED-FAIL COMPLETE — moved open, froze shut through a real [E], thawed and moved again'
    : 'INCONCLUSIVE — see movement numbers and labels';

  console.log(JSON.stringify(out, null, 2));
  fs.writeFileSync(path.join(OUT, 'door-watchedfail-result.json'), `${JSON.stringify(out, null, 2)}\n`);
  if (!ok) process.exitCode = 1;
  return out;
}
