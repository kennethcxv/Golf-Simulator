// PLAYTEST 5, ITEM 6 — WHY AN EQUIPPED TOOL APPEARS IN ZERO FRAMES.
//
// The symptom, three times over two sessions: the tool reports itself fully
// present — in the scene graph, `visible: true`, no hidden ancestor, the right
// instance counts, two feet from the camera — and does not appear in a single
// frame of the screenshot. A new asset you cannot photograph is a new asset
// nobody can judge, so this has to be closed before any modelling.
//
// PART 1 splits the four candidate causes, because "it did not appear" is
// consistent with all of them and they need different fixes:
//     a group left invisible / a group visible but parked elsewhere /
//     a rig that never built / a camera not pointed at it.
//
// PART 2 is the part the earlier run did not do: it SWEEPS THE CAMERA PITCH and
// measures, at each one, how much of the tool's own bounding box lands inside the
// frustum. If the tool is present at every pitch and only visible across part of
// the range, then the fault was never the tool — it was where the driver was
// looking. That is a curve, not an opinion, and the pitch that photographs it
// falls straight out of it.
//
// NEGATIVE CONTROL: the same measurement is run with NO TOOL equipped. Every
// pitch must report nothing in frame. A projector that says "in frame" for an
// absent tool would make the whole curve meaningless.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-tool-draws-at-all.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/tool-draws');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [], tools: {}, sweep: {} };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  await page.setViewportSize({ width: 1600, height: 900 });
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
  await page.waitForTimeout(3000);

  // The golden suite's own tool pose. Offsets are from the LIVE interior origin
  // (constants rot, the origin does not) and the pitch is a gentle -0.15, which
  // is the number this whole investigation turns out to be about.
  const setPose = (dx, dz, yaw, pitch) => page.evaluate(([a, b, c, d]) => {
    const app = window.__fw;
    const w = app.scene3d.walk;
    const o = app.scene3d.clubhouse().interior.position;
    w.state.x = o.x + a; w.state.z = o.z + b;
    w.state.yaw = c; w.state.pitch = d;
    w.state.vx = 0; w.state.vz = 0;
  }, [dx, dz, yaw, pitch]);

  // How much of the tool lands inside the frustum, from the tool's OWN box.
  // Projected rather than pixel-counted: a pixel count cannot tell "off screen"
  // from "on screen and dark", and the question here is purely framing.
  const framing = (tool) => page.evaluate(async (t) => {
    const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
    const app = window.__fw;
    const cam = app.scene3d.camera;
    let group = null;
    app.scene3d.scene.traverse((o) => {
      if (!group && (o.name === `Tool_${t}` || (t === 'hands' && /fpHands|HandRoot/i.test(o.name || '')))) group = o;
    });
    if (!group) return { present: false };
    cam.updateMatrixWorld(true);
    group.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(group);
    if (box.isEmpty()) return { present: true, boxEmpty: true };
    const v = new THREE.Vector3();
    let inFrame = 0;
    let inFront = 0;
    const xs = []; const ys = [];
    for (let i = 0; i < 8; i += 1) {
      v.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z);
      v.project(cam);
      xs.push(+v.x.toFixed(3)); ys.push(+v.y.toFixed(3));
      if (v.z >= -1 && v.z <= 1) inFront += 1;
      if (v.z >= -1 && v.z <= 1 && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1) inFrame += 1;
    }
    return {
      present: true,
      visible: group.visible,
      cornersInFrustum: inFrame,
      cornersInFront: inFront,
      ndcX: [Math.min(...xs), Math.max(...xs)],
      ndcY: [Math.min(...ys), Math.max(...ys)],
    };
  }, tool);

  // ---- PART 1: is it there at all? ----------------------------------------
  for (const tool of ['mop', 'broom', 'rake']) {
    // eslint-disable-next-line no-await-in-loop
    await setPose(-5.6, 4.4, -Math.PI / 2, -0.15);
    // eslint-disable-next-line no-await-in-loop
    await page.evaluate((t) => { window.__fw.scene3d.walk.setTool(t); }, tool);
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(3500);
    // eslint-disable-next-line no-await-in-loop
    out.tools[tool] = await page.evaluate(async (t) => {
      const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
      const app = window.__fw;
      let group = null;
      app.scene3d.scene.traverse((o) => { if (o.name === `Tool_${t}`) group = o; });
      if (!group) return { inScene: false, equippedTool: app.scene3d.walk.getTool?.() ?? null };
      let hiddenAncestor = null;
      let at = group.parent;
      while (at) { if (at.visible === false) { hiddenAncestor = at.name || at.type; break; } at = at.parent; }
      const box = new THREE.Box3().setFromObject(group);
      const world = group.getWorldPosition(new THREE.Vector3());
      const camPos = app.scene3d.camera.getWorldPosition(new THREE.Vector3());
      let meshes = 0;
      group.traverse((o) => { if (o.isMesh || o.isInstancedMesh) meshes += 1; });
      return {
        inScene: true,
        equippedTool: app.scene3d.walk.getTool?.() ?? null,
        visible: group.visible,
        hiddenAncestor,
        childMeshes: meshes,
        boxEmpty: box.isEmpty(),
        distanceToCamera: +world.distanceTo(camPos).toFixed(3),
      };
    }, tool);
    console.log('PRESENT', tool, JSON.stringify(out.tools[tool]));
  }

  // ---- PART 2: the pitch sweep, on the mop --------------------------------
  await page.evaluate(() => { window.__fw.scene3d.walk.setTool('mop'); });
  await page.waitForTimeout(3000);
  const PITCHES = [0.2, 0.05, -0.05, -0.15, -0.3, -0.45, -0.62, -0.8, -1.0, -1.1, -1.3];
  out.sweep.mop = [];
  for (const pitch of PITCHES) {
    // eslint-disable-next-line no-await-in-loop
    await setPose(-5.6, 4.4, -Math.PI / 2, pitch);
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(700);
    // eslint-disable-next-line no-await-in-loop
    const f = await framing('mop');
    out.sweep.mop.push({ pitch, ...f });
    console.log('PITCH', String(pitch).padStart(6), JSON.stringify(f));
    if ([-0.15, -0.62, -1.1].includes(pitch)) {
      // eslint-disable-next-line no-await-in-loop
      await page.screenshot({ path: path.join(OUT, `mop-pitch${String(pitch).replace('.', 'p')}.png`) });
    }
  }

  // ---- NEGATIVE CONTROL: no tool, every pitch must report nothing ---------
  await page.evaluate(() => { try { window.__fw.scene3d.walk.setTool(null); } catch { /* bare hands */ } });
  await page.waitForTimeout(2500);
  out.control = [];
  for (const pitch of [-0.15, -0.62]) {
    // eslint-disable-next-line no-await-in-loop
    await setPose(-5.6, 4.4, -Math.PI / 2, pitch);
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(600);
    // eslint-disable-next-line no-await-in-loop
    out.control.push({ pitch, ...(await framing('mop')) });
  }
  console.log('CONTROL(no tool)', JSON.stringify(out.control));

  const inFrame = out.sweep.mop.filter((r) => (r.cornersInFrustum ?? 0) > 0).map((r) => r.pitch);
  out.verdict = {
    presentAtEveryPitch: out.sweep.mop.every((r) => r.present === true),
    pitchesWithToolInFrame: inFrame,
    bestPitch: out.sweep.mop.slice().sort((a, b) => (b.cornersInFrustum ?? 0) - (a.cornersInFrustum ?? 0))[0] ?? null,
    firstPitchOffScreen: out.sweep.mop.find((r) => (r.cornersInFrustum ?? 0) === 0)?.pitch ?? null,
    controlShowsNothing: out.control.every((r) => r.present === false || (r.cornersInFrustum ?? 0) === 0),
    rakeInScene: out.tools.rake?.inScene ?? null,
    pageErrors: out.errs.slice(0, 6),
  };
  console.log('TOOL-DRAWS', JSON.stringify(out.verdict, null, 2));
  fs.writeFileSync(path.join(OUT, 'tool-draws.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
