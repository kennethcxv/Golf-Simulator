// VERIFIER 2 — adversarial pass over tonight's I1/I2/J/E3 claims.
//
// Runs the shipping Electron build and gathers EVIDENCE (screenshots + live
// diagnostics), never asserting the claims true. Phases:
//   1. mop rest/use at -0.36 (I1: close, planted, animated) + intensity + errs
//   2. vacuum -0.62 / dustpan -0.78 (I1 finding: planted but framed out)
//   3. broom at pitch +1.0 (I3 open look-up issue — what does the frame show?)
//   4. Q dirt-sense reveal with broom near seeded piles (J untouched: old markers?)
//   5. outdoor speed runs: empty vs broom vs mop under Shift+W (I2: 6.1 vs 4.25)
// Never returns ok:false — a verifier wants the numbers either way.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const { createRequire } = process.getBuiltinModule('node:module');
  const require2 = createRequire(`${process.cwd().replace(/\\/g, '/')}/package.json`);
  let sharp = null;
  try { sharp = require2('sharp'); } catch { /* frame diffs degrade to null */ }
  const OUT = path.resolve('qa/electron/verifier2');
  fs.mkdirSync(OUT, { recursive: true });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message || e)));
  const shot = async (name) => {
    const p = path.join(OUT, name);
    const buf = await page.screenshot({ path: p });
    return { p, buf };
  };

  await page.setViewportSize({ width: 1600, height: 900 });
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForTimeout(3200);

  const poseIndoors = () => page.evaluate(() => {
    const app = window.__fw;
    const o = app.scene3d.clubhouse().interior.position;
    const w = app.scene3d.walk;
    w.clearKeys();
    w.state.x = o.x - 5.6; w.state.z = o.z + 4.4; w.state.yaw = -Math.PI / 2; w.state.pitch = 0;
    const c = app.state.clock;
    c.minutes = Math.floor(c.minutes / 1440) * 1440 + 13 * 60;
    app.speedIdx = 0;
    document.querySelectorAll('.hud,.hud-min,.shop-lockhint,.notification-center,.walk-overlay,.objectives-card,.toast,.toasts')
      .forEach((n) => { n.style.display = 'none'; });
    return { ox: o.x, oz: o.z };
  });
  await poseIndoors();
  await page.mouse.click(800, 450); // pointer lock, bare-handed, before any tool is out
  await page.waitForTimeout(700);

  const decode = async (buf) => {
    if (!sharp) return null;
    const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height, ch: info.channels };
  };
  // pixel fraction changed between two frames, lower-centre band (held-tool zone)
  const bandDiff = async (bufA, bufB) => {
    const a = await decode(bufA).catch(() => null);
    const b = await decode(bufB).catch(() => null);
    if (!a || !b || a.width !== b.width) return null;
    const x0 = Math.floor(a.width * 0.20); const x1 = Math.floor(a.width * 0.85);
    const y0 = Math.floor(a.height * 0.45); const y1 = a.height - 6;
    let changed = 0; let total = 0;
    for (let y = y0; y < y1; y += 2) {
      for (let x = x0; x < x1; x += 2) {
        const i = (a.width * y + x) * a.ch;
        const j = (b.width * y + x) * b.ch;
        const d = Math.abs(a.data[i] - b.data[j]) + Math.abs(a.data[i + 1] - b.data[j + 1])
          + Math.abs(a.data[i + 2] - b.data[j + 2]);
        total += 1;
        if (d > 42) changed += 1;
      }
    }
    return +(changed / Math.max(1, total)).toFixed(4);
  };

  const equip = async (id) => {
    await page.evaluate((t) => window.__fw.scene3d.walk.setTool(t), id);
    await page.waitForTimeout(2400); // equip + settle + GLB adopt
  };
  const diag = (id) => page.evaluate((t) => {
    const w = window.__fw.scene3d.walk;
    const d = w.toolRigDiagnostics ? w.toolRigDiagnostics(t) : null;
    if (!d) return null;
    return {
      vmActive: d.vmActive, geomSource: d.geomSource, workBlend: d.workBlend,
      intensity: d.intensity, headAboveFloor: d.headAboveFloor,
      assetHeadNdc: d.assetHeadNdc, handNdcUpper: d.handNdcUpper, handNdcLower: d.handNdcLower,
      gripCapYd: d.gripCapYd, clamped: d.clamped,
    };
  }, id);
  const setPitch = (p) => page.evaluate((v) => { window.__fw.scene3d.walk.state.pitch = v; }, p);
  const spray = (on) => page.evaluate((v) => window.__fw.scene3d.walk.setSpraying(v), on);

  const report = { errsAtBoot: errs.length };
  const bare = await shot('bare-indoors.png');

  // ---- CLAIM 1 + 6: the mop ------------------------------------------------
  {
    await equip('mop');
    await setPitch(0);
    await page.waitForTimeout(700);
    const rest = await shot('mop-rest.png');
    const restDiag = await diag('mop');
    const errsBeforeUse = errs.length;
    await setPitch(-0.36);
    await spray(true);
    await page.waitForTimeout(1100);
    const useA = await shot('mop-use-a.png');
    const useDiag = await diag('mop');
    await page.waitForTimeout(500);
    const useB = await shot('mop-use-b.png');
    const useDiag2 = await diag('mop');
    await spray(false);
    report.mop = {
      rest: { file: rest.p, diag: restDiag, drawnVsBare: await bandDiff(rest.buf, bare.buf) },
      use: {
        fileA: useA.p, fileB: useB.p, pitch: -0.36,
        diagA: useDiag, diagB: useDiag2,
        drawnVsBare: await bandDiff(useA.buf, bare.buf),
        animFrameDelta: await bandDiff(useA.buf, useB.buf), // frame-to-frame motion while using
      },
      errsDuringUse: errs.slice(errsBeforeUse),
    };
  }

  // ---- CLAIM 2: vacuum and dustpan at their natural pitches ---------------
  for (const [tool, pitch] of [['vacuum', -0.62], ['dustpan', -0.78]]) {
    await equip(tool);
    await setPitch(0);
    await page.waitForTimeout(700);
    const rest = await shot(`${tool}-rest.png`);
    const restDiag = await diag(tool);
    await setPitch(pitch);
    await spray(true);
    await page.waitForTimeout(1100);
    const use = await shot(`${tool}-use.png`);
    const useDiag = await diag(tool);
    await spray(false);
    report[tool] = {
      rest: { file: rest.p, diag: restDiag, drawnVsBare: await bandDiff(rest.buf, bare.buf) },
      use: { file: use.p, pitch, diag: useDiag, drawnVsBare: await bandDiff(use.buf, bare.buf) },
    };
  }

  // ---- CLAIM 4: broom at look-up pitch +1.0 -------------------------------
  {
    await equip('broom');
    await setPitch(1.0);
    await page.waitForTimeout(900);
    const up = await shot('broom-lookup.png');
    const upDiag = await diag('broom');
    report.broomLookup = { file: up.p, pitch: 1.0, diag: upDiag };
    await setPitch(0);
  }

  // ---- CLAIM 5: Q dirt-sense reveal with the broom near dirt --------------
  {
    // seed piles in shop-local yards a stride or three ahead of the player
    const seeded = await page.evaluate(async () => {
      const app = window.__fw;
      const o = app.scene3d.clubhouse().interior.position;
      const w = app.scene3d.walk;
      const debris = await import(new URL('src/sim/cleaningDebris.js', document.baseURI).href);
      const list = debris.ensureDebris(app.state);
      const px = w.state.x - o.x; const pz = w.state.z - o.z; // shop-local player
      const fx = -Math.sin(w.state.yaw); const fz = -Math.cos(w.state.yaw);
      const mine = [
        { x: px + fx * 1.4, z: pz + fz * 1.4, a: 1.0, kind: 'grit' },
        { x: px + fx * 2.4 + 0.5, z: pz + fz * 2.4, a: 1.4, kind: 'grit' },
        { x: px + fx * 3.2 - 0.6, z: pz + fz * 3.2, a: 0.8, kind: 'litter' },
      ];
      list.push(...mine);
      return { existing: list.length - mine.length, mine, playerLocal: { x: +px.toFixed(2), z: +pz.toFixed(2) } };
    });
    await setPitch(-0.30);
    await page.waitForTimeout(400);
    const qBefore = await shot('q-before.png');
    await page.keyboard.down('q');
    await page.waitForTimeout(1000); // rise 8/s: alpha saturates well inside this
    const qHeld = await shot('q-reveal.png');
    const sense = await page.evaluate(() => window.__fw.scene3d.walk.dirtSense
      ? window.__fw.scene3d.walk.dirtSense() : null);
    await page.keyboard.up('q');
    await page.waitForTimeout(400);
    report.qReveal = {
      seeded,
      before: qBefore.p,
      held: qHeld.p,
      revealPixelDelta: await bandDiff(qHeld.buf, qBefore.buf),
      sense,
    };
  }

  // ---- CLAIM 3: outdoor speed, empty vs broom vs mop ----------------------
  const speedRun = async (label, tool, yaw) => {
    await page.evaluate((t) => window.__fw.scene3d.walk.setTool(t), tool);
    await page.waitForTimeout(tool ? 2400 : 900);
    await page.evaluate((y) => {
      const app = window.__fw;
      const o = app.scene3d.clubhouse().interior.position;
      const w = app.scene3d.walk;
      w.clearKeys();
      w.state.x = o.x; w.state.z = o.z + 26; w.state.yaw = y; w.state.pitch = 0;
    }, yaw);
    await page.waitForTimeout(450);
    await page.evaluate(() => window.__fw.scene3d.walk.moveIntent.begin());
    await page.keyboard.down('Shift');
    await page.keyboard.down('w');
    const rows = await page.evaluate(() => new Promise((resolve) => {
      const w = window.__fw.scene3d.walk;
      const out = [];
      const t0 = performance.now();
      const tick = () => {
        const t = performance.now() - t0;
        out.push({ ms: Math.round(t), x: w.state.x, z: w.state.z });
        if (t >= 1700) { resolve(out); return; }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }));
    await page.keyboard.up('w');
    await page.keyboard.up('Shift');
    const intent = await page.evaluate(() => {
      const r = window.__fw.scene3d.walk.moveIntent.read();
      window.__fw.scene3d.walk.moveIntent.end();
      return r;
    });
    const s = await shot(`speed-${label}.png`);
    const first = rows[0]; const last = rows[rows.length - 1];
    const full = Math.hypot(last.x - first.x, last.z - first.z) / ((last.ms - first.ms) / 1000);
    const from = rows.find((r) => r.ms >= 500) || first;
    const steady = Math.hypot(last.x - from.x, last.z - from.z) / Math.max(0.001, (last.ms - from.ms) / 1000);
    return {
      label, tool, yaw: +yaw.toFixed(3), frames: rows.length,
      fullYdPerSec: +full.toFixed(3), steadyYdPerSec: +steady.toFixed(3),
      distanceYd: +Math.hypot(last.x - first.x, last.z - first.z).toFixed(3),
      moveIntent: { frames: intent.frames, movingFrames: intent.movingFrames },
      file: s.p,
    };
  };
  {
    // probe lanes empty-handed first; keep the yaw the player really covers ground in
    let bestYaw = Math.PI; let probe = null;
    const lanes = [];
    for (const y of [Math.PI, 0, Math.PI / 2, -Math.PI / 2]) {
      const r = await speedRun(`probe-${y.toFixed(2)}`, null, y);
      lanes.push({ yaw: r.yaw, distanceYd: r.distanceYd, steady: r.steadyYdPerSec });
      if (!probe || r.distanceYd > probe.distanceYd) { probe = r; bestYaw = y; }
      if (r.distanceYd > 6) break; // an open lane found; no need to try the rest
    }
    report.speed = {
      lanesProbed: lanes,
      empty: probe,
      broom: await speedRun('broom', 'broom', bestYaw),
      mop: await speedRun('mop', 'mop', bestYaw),
    };
  }
  await page.evaluate(() => window.__fw.scene3d.walk.setTool(null));

  report.errsAll = errs.slice(0, 20);
  report.errCount = errs.length;
  fs.writeFileSync(path.join(OUT, 'verifier2.json'), `${JSON.stringify(report, null, 1)}\n`);
  return report;
}
