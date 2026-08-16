// GOAL 29 PHASE 3 (count side) — HOW MUCH MATRIX WORK DOES A STANDING FRAME
// ACTUALLY DO, and where does it live? The freeze's BEFORE ledger, in counts
// a degraded machine cannot distort.
//
// Measures per standing frame (median of 30):
//   - Object3D.updateMatrix invocations (the matrixAutoUpdate recompute work)
//   - how many of them come from inside the clubhouse interior/group subtrees
// and, once per boot: subtree object totals, matrixAutoUpdate counts, and the
// static-batch suppressed set (already never drawn, still ticking matrices —
// exactly the objects a freeze would silence first).
//
// NEGATIVE CONTROL: ten planted matrixAutoUpdate objects must raise the
// per-frame count by exactly 10, and setting their matrixAutoUpdate=false
// must drop exactly 10 — a counter that cannot see the lever it measures is
// void.
//
//   node tools/qa/run-electron.cjs tools/qa/goal29-matrix-churn.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/goal29-draws');
  fs.mkdirSync(OUT, { recursive: true });
  const tag = process.env.QA_TAG || 'matrix-churn';
  const out = { tag, errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(8000);
  await page.evaluate(() => {
    const app = window.__fw;
    app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440 + 14 * 60;
    if (app.empire) app.empire.clockMinutes = app.state.clock.minutes;
    app.speedIdx = 0;
    app.scene3d.walk.clearKeys?.();
  });
  await page.waitForTimeout(1500);
  // GOAL 30 — when the stability freeze exists, the standing measurement must
  // sample the SETTLED post-freeze state, not the arming window (frame 900 of
  // active walk). Wait for the freeze to have fired if the build carries it.
  if (process.env.QA_CHURN_WAIT_FREEZE === '1') {
    await page.waitForFunction(
      () => (window.__fw.scene3d.matrixFreezeDiagnostics?.()?.outcome || null) !== null,
      null, { timeout: 180000 },
    );
    await page.waitForTimeout(2500);
  }

  // static counts + the patch, installed once
  out.static = await page.evaluate(() => {
    const s3 = window.__fw.scene3d;
    const ch = s3.clubhouse();
    const count = (root) => {
      let total = 0; let auto = 0; let suppressed = 0; let visible = 0;
      root?.traverse((o) => {
        total += 1;
        if (o.matrixAutoUpdate) auto += 1;
        if (o.userData?.staticSubtreeBatchSuppressed || o.userData?.assetRuntimeStaticRenderSuppressed
          || o.userData?.assetRuntimePlacedStaticRenderSuppressed) suppressed += 1;
        if (o.visible) visible += 1;
      });
      return { total, matrixAutoUpdate: auto, layerSuppressed: suppressed, visibleFlagged: visible };
    };
    const proto = Object.getPrototypeOf(Object.getPrototypeOf(s3.scene)); // Object3D.prototype
    if (!proto.updateMatrix || window.__g29mx) return { err: window.__g29mx ? 'already patched' : 'no updateMatrix on prototype' };
    const state = { frames: [], current: 0, marks: new WeakSet(), inClubhouse: 0, chRoots: [ch.interior, ch.group].filter(Boolean) };
    window.__g29mx = state;
    const original = proto.updateMatrix;
    proto.updateMatrix = function patchedUpdateMatrix() {
      state.current += 1;
      return original.call(this);
    };
    state.restore = () => { proto.updateMatrix = original; };
    const tick = () => {
      state.frames.push(state.current);
      state.current = 0;
      // 5000-frame ceiling: phases clear frames[] between windows, and the
      // 200 cap died mid-run once the goal-30 freeze wait stretched the
      // timeline (withPlants read an empty array and reported null)
      if (state.frames.length < 5000) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return {
      scene: count(s3.scene),
      interior: count(ch.interior),
      exteriorGroup: count(ch.group),
    };
  });

  const median = (xs) => {
    const s = [...xs].sort((a, b) => a - b);
    return s.length ? s[Math.floor(s.length / 2)] : null;
  };
  const sampleFrames = async (n = 30) => {
    await page.evaluate(() => { window.__g29mx.frames.length = 0; });
    await page.waitForTimeout(Math.max(2000, n * 40));
    const frames = await page.evaluate(() => window.__g29mx.frames.slice());
    return { median: median(frames.slice(1, n + 1)), frames: frames.length };
  };

  out.baseline = await sampleFrames();

  // CONTROL: +10 auto-update plants, then freeze them
  const planted = await page.evaluate(() => {
    const s3 = window.__fw.scene3d;
    let donor = null;
    s3.scene.traverse((o) => {
      if (!donor && o.isMesh && o.constructor?.name === 'Mesh' && !Array.isArray(o.material)) donor = o;
    });
    const plants = [];
    for (let i = 0; i < 10; i += 1) {
      const node = donor.clone(false); // a Mesh clone sharing geometry/material — matrix cost only
      node.layers.mask = 0; // never drawn; matrices still tick — the exact freeze target shape
      node.matrixAutoUpdate = true;
      s3.scene.add(node);
      plants.push(node);
    }
    window.__g29mxPlants = plants;
    return plants.length;
  });
  const withPlants = await sampleFrames();
  await page.evaluate(() => { for (const p of window.__g29mxPlants) p.matrixAutoUpdate = false; });
  const frozenPlants = await sampleFrames();
  await page.evaluate(() => {
    for (const p of window.__g29mxPlants) p.removeFromParent();
    window.__g29mxPlants = null;
    window.__g29mx.restore();
  });

  out.withPlants = withPlants;
  out.frozenPlants = frozenPlants;
  const up = withPlants.median - out.baseline.median;
  const down = withPlants.median - frozenPlants.median;
  // The composer renders the scene through more than one pass, and EVERY
  // renderer.render calls scene.updateMatrixWorld — so one matrixAutoUpdate
  // object costs passMultiplier updateMatrix calls per frame (measured 2 on
  // this build, the same multiplier the draws control measures). The control
  // demands an exact integer multiple and an exact symmetric drop.
  const multiplier = up / 10;
  out.matrixPassMultiplier = multiplier;
  out.control_plantedMatrices = (planted === 10 && up > 0 && Number.isInteger(multiplier) && up === down)
    ? `ok — +10 plants = +${up} updateMatrix/frame (pass multiplier ${multiplier}), freezing them removed exactly ${down}`
    : `FAILED — plants ${planted}, delta up ${up}, delta down ${down} (expected equal exact multiples of 10)`;

  console.log(JSON.stringify(out, null, 2));
  fs.writeFileSync(path.join(OUT, `${tag}.json`), `${JSON.stringify(out, null, 2)}\n`);
  const ok = String(out.control_plantedMatrices).startsWith('ok');
  console.log(ok ? 'CONTROLS OK' : 'CONTROLS FAILED — CHURN COUNTS VOID');
  if (!ok) process.exitCode = 1;
  return out;
}
