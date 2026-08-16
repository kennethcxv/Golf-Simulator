// GOAL 30 LEVER B — STABILITY-FREEZE ACCEPTANCE, one boot, four proofs:
//
//   1. COUNT: updateMatrix/frame median in a pre-freeze window vs post-freeze,
//      with the planted ±10 control run POST-freeze (the instrument must
//      still move by exactly plants × passMultiplier).
//   2. WATCHED-FAIL: a stability-frozen object is written to by code (the
//      verb stand-in). Its matrixWorld — what the renderer consumes — must
//      change within the watchdog's worst-case slice latency, its
//      matrixAutoUpdate must return, and the thaw counter must tick.
//      Screenshots bracket the move.
//   3. FREEZE HOLDS: an untouched frozen object's matrixWorld stays
//      bit-identical across the same window and it stays enrolled.
//   4. KILL SWITCH (separate run with QA_G30_DISABLE=1): frozen count is 0.
//
//   node tools/qa/run-electron.cjs tools/qa/goal30-stability-freeze-acceptance.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/goal30');
  fs.mkdirSync(OUT, { recursive: true });
  const tag = process.env.QA_TAG || 'stab-accept';
  const disable = process.env.QA_G30_DISABLE === '1';
  const out = { tag, disable, errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  const boot = await import(`file:///${bootPath}`);
  if (disable) {
    // the render loop checks the flag per frame and arms at frame 900 of
    // active walk; setting it now (pre-walk) is well ahead of the window.
    // (addInitScript does NOT run in the already-loaded document — the first
    // kill-switch run "failed" because the flag never existed in-page.)
    await page.evaluate(() => { globalThis.__FW_DISABLE_STABILITY_FREEZE = true; });
  }
  await boot.clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  if (disable) {
    await page.evaluate(() => { globalThis.__FW_DISABLE_STABILITY_FREEZE = true; });
  }

  // count updateMatrix calls per frame from the moment walk starts
  await page.evaluate(() => {
    const s3 = window.__fw.scene3d;
    const proto = Object.getPrototypeOf(Object.getPrototypeOf(s3.scene));
    if (!window.__g30um) {
      const orig = proto.updateMatrix;
      window.__g30um = { count: 0, perFrame: [], orig };
      proto.updateMatrix = function patched(...a) { window.__g30um.count += 1; return orig.apply(this, a); };
      const raf = () => {
        window.__g30um.perFrame.push(window.__g30um.count);
        window.__g30um.count = 0;
        requestAnimationFrame(raf);
      };
      requestAnimationFrame(raf);
    }
  });

  const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  const window60 = () => page.evaluate(() => {
    const pf = window.__g30um.perFrame;
    return pf.slice(Math.max(0, pf.length - 60)).filter((v) => v > 0);
  });

  // ---- pre-freeze window (frames < 600 of active walk) -----------------------
  await page.waitForTimeout(4500);
  out.preFreezePerFrame = median(await window60());

  // ---- wait for the freeze to fire (frame 900) --------------------------------
  // With the kill switch set the frame counter itself never advances, so the
  // disabled control waits wall-clock instead and then asserts zero frozen.
  const diag = () => page.evaluate(() => window.__fw.scene3d.matrixFreezeDiagnostics?.() || null);
  if (disable) {
    await page.waitForTimeout(45000);
  } else {
    await page.waitForFunction(
      () => (window.__fw.scene3d.matrixFreezeDiagnostics?.()?.framesSinceWalk || 0) > 950,
      null, { timeout: 180000 },
    );
  }
  await page.waitForTimeout(1500);
  out.diagAfterArm = await diag();

  if (disable) {
    out.verdict = (out.diagAfterArm?.stabilityFrozen === 0)
      ? 'KILL SWITCH OK — zero frozen with the flag set'
      : `KILL SWITCH FAILED — ${JSON.stringify(out.diagAfterArm)}`;
    console.log(JSON.stringify(out, null, 2));
    fs.writeFileSync(path.join(OUT, `${tag}.json`), `${JSON.stringify(out, null, 2)}\n`);
    if (!out.verdict.startsWith('KILL SWITCH OK')) process.exitCode = 1;
    return out;
  }

  // ---- post-freeze count window ------------------------------------------------
  await page.waitForTimeout(2500);
  out.postFreezePerFrame = median(await window60());

  // planted control AFTER the freeze: +10 auto plants must move the count by
  // plants × passMultiplier exactly (multiplier measured from the plant delta)
  out.plantControl = await page.evaluate(async () => {
    const THREE = await import('three');
    const s3 = window.__fw.scene3d;
    const plants = [];
    for (let i = 0; i < 10; i += 1) {
      const m = new THREE.Mesh(
        new THREE.BufferGeometry(),
        new THREE.MeshBasicMaterial(),
      );
      m.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
      m.frustumCulled = false;
      s3.scene.add(m);
      plants.push(m);
    }
    const grab = () => new Promise((r) => {
      const pf = window.__g30um.perFrame;
      const start = pf.length;
      const wait = () => (pf.length >= start + 40 ? r(pf.slice(start + 5, start + 40)) : requestAnimationFrame(wait));
      wait();
    });
    const withPlants = await grab();
    for (const p of plants) { p.removeFromParent(); p.geometry.dispose(); p.material.dispose(); }
    const after = await grab();
    const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
    return { withPlants: med(withPlants), after: med(after) };
  });
  const plantDelta = out.plantControl.withPlants - out.plantControl.after;
  out.control_planted = (plantDelta > 0 && plantDelta % 10 === 0)
    ? `ok — +10 plants = +${plantDelta} updateMatrix/frame (pass multiplier ${plantDelta / 10})`
    : `FAILED — plant delta ${plantDelta}`;

  // ---- watched-fail: write to a frozen object, the watchdog must thaw it -----
  await page.screenshot({ path: path.join(OUT, `${tag}-before-move.png`) });
  out.watchedFail = await page.evaluate(async () => {
    const THREE = await import('three');
    const s3 = window.__fw.scene3d;
    // subject: a frozen mesh the CAMERA CAN ACTUALLY SEE — chain-visible,
    // projecting into the middle of the frame, and winning a raycast from
    // the camera (the first cut picked a ceiling panel indoors: matrixWorld
    // moved, the screenshot showed lawn and clouds)
    const V = s3.camera.position.constructor;
    const camP = s3.camera.position;
    // START FROM WHAT THE CAMERA SEES: raycast a grid of screen points and
    // take the first hit that is itself frozen — hunting outward from frozen
    // meshes found nothing at spawn (grass and unfrozen foreground win most
    // crosshair rays; a ceiling panel indoors won the distance sort).
    const rc = new THREE.Raycaster();
    rc.camera = s3.camera; // sprites in the scene demand it
    let subject = null;
    let subjectNdc = null;
    outer:
    for (const ny of [-0.1, 0.1, -0.3, 0.3, 0.5]) {
      for (const nx of [0, -0.2, 0.2, -0.4, 0.4, -0.6, 0.6]) {
        rc.setFromCamera(new THREE.Vector2(nx, ny), s3.camera);
        let hits;
        try {
          hits = rc.intersectObjects(s3.scene.children, true)
            .filter((h) => h.object.visible && h.object.layers.mask !== 0);
        } catch { continue; }
        const hit = hits[0];
        if (!hit) continue;
        // meshes OR line overlays — at spawn the shell meshes are
        // author-frozen (no enrollment) and the enrolled things in view are
        // LineSegments path edging
        if ((hit.object.isMesh || hit.object.isLine) && hit.object.userData?.matrixFrozen) {
          subject = hit.object;
          subjectNdc = { x: nx, y: ny };
          break outer;
        }
      }
    }
    let control = null;
    if (subject) {
      s3.scene.traverse((o) => {
        if (control || !(o.isMesh || o.isLine) || o === subject || !o.userData?.matrixFrozen || o.layers.mask === 0) return;
        if (o.getWorldPosition(new V()).distanceTo(camP) < 40) control = o;
      });
    }
    if (!subject || !control) return { err: `subject ${!!subject} control ${!!control}` };
    const beforeMW = subject.matrixWorld.elements.join(',');
    const controlMW = control.matrixWorld.elements.join(',');
    const d0 = s3.matrixFreezeDiagnostics();
    // THE VERB STAND-IN: code writes to a frozen transform
    subject.position.y += 0.55;
    const t0 = performance.now();
    await new Promise((resolve) => {
      const check = () => {
        if (subject.matrixWorld.elements.join(',') !== beforeMW || performance.now() - t0 > 2000) resolve();
        else requestAnimationFrame(check);
      };
      requestAnimationFrame(check);
    });
    const d1 = s3.matrixFreezeDiagnostics();
    return {
      subject: subject.name || subject.type,
      subjectNdc,
      moved: subject.matrixWorld.elements.join(',') !== beforeMW,
      thawLatencyMs: +(performance.now() - t0).toFixed(0),
      autoRestored: subject.matrixAutoUpdate === true,
      thawCounter: [d0.watchdogThawed, d1.watchdogThawed],
      // the untouched neighbour must NOT move or thaw
      controlHeld: control.matrixWorld.elements.join(',') === controlMW && control.matrixAutoUpdate === false,
      controlName: control.name || control.type,
    };
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, `${tag}-after-move.png`) });

  // NOTE: preFreezePerFrame is NOT a baseline — at 4.5 s the scene is still
  // loading (the first cut gated on post<pre and "failed" while the freeze
  // was working). The count baseline is goal29-matrix-churn on the unfrozen
  // build: 7,565/frame median, three runs, planted control exact.
  const wf = out.watchedFail;
  const ok = !wf.err
    && wf.moved && wf.autoRestored && wf.thawCounter[1] > wf.thawCounter[0]
    && wf.controlHeld
    && out.control_planted.startsWith('ok')
    && (out.diagAfterArm?.stabilityFrozen || 0) > 500;
  out.verdict = ok
    ? `ACCEPTED — ${out.diagAfterArm.stabilityFrozen} frozen; standing ${out.postFreezePerFrame} updateMatrix/frame; verb-write thawed in ${wf.thawLatencyMs} ms; untouched stayed frozen`
    : 'FAILED — see fields';
  console.log(JSON.stringify(out, null, 2));
  fs.writeFileSync(path.join(OUT, `${tag}.json`), `${JSON.stringify(out, null, 2)}\n`);
  if (!ok) process.exitCode = 1;
  return out;
}
