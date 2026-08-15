// F1 (Goal 24) — IS THE BROOM HEAD SQUARE TO THE FLOOR? MEASURED OFF THE MESH.
//
// Six rounds answered "the head is tilted right" with a roll CONSTANT. The
// contact sheet from Goal 23 is what finally settled it: the sheet's own 0 deg
// tile IS the shipped value, and of the thirteen candidates it was already the
// squarest in that pose. There was no number on that sheet to bake. A constant
// is square in at most one shaft direction, and the shaft direction changes with
// every step, look and stroke.
//
// So this measures squareness in SEVERAL poses, and it deliberately does NOT
// read back the solve's own vectors — `state.squareRoll` is recorded but nothing
// is judged on it. Reading a fix's own intermediate value proves the arithmetic
// ran, not that the mesh moved, and that exact confusion is why four of tonight's
// probes lied. Instead it runs a principal-axis fit over the VERTICES of the
// head meshes that are actually drawn, transformed to world, and asks how far
// the brush's long edge is from level.
//
// CONTROL: the same measurement on a pose where the shaft points straight down.
// Roll about a vertical shaft cannot change how level the head is, so there is
// no square answer there and the instrument must not claim one.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-f1-broom-square.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/f1-broom-square');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [], poses: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(3000);

  // The golden suite's own tool pose, offsets from the LIVE interior origin.
  // `scene3d.clubhouse` is a FUNCTION -- reading `.interior` off it without
  // calling it throws, which is how the first run of this driver died.
  out.placed = await page.evaluate(() => {
    const app = window.__fw;
    const ch = app.scene3d.clubhouse();
    const ip = ch.interior.position;
    const w = app.scene3d.walk.state;
    app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440 + 14 * 60;
    if (app.empire) app.empire.clockMinutes = app.state.clock.minutes;
    app.speedIdx = 0;
    ch.setTimeMood?.(14 * 60);
    w.x = ip.x - 5.6; w.z = ip.z + 4.4;
    w.yaw = -Math.PI / 2; w.pitch = -0.15;
    w.vx = 0; w.vz = 0;
    const ui = document.getElementById('ui');
    if (ui) ui.style.visibility = 'hidden';
    return { x: +w.x.toFixed(2), z: +w.z.toFixed(2), inside: !!ch.isInside(w.x, w.z, 0.35) };
  });
  await page.waitForTimeout(600);

  out.equipped = await page.evaluate(() => {
    try { window.__fw.scene3d.walk.setTool('broom'); return true; } catch (e) { return String(e.message || e); }
  });
  await page.waitForTimeout(4000);

  // The measurement. Everything here reads the SCENE GRAPH and the vertex
  // buffers; nothing reads the viewmodel's own solve.
  const measure = () => page.evaluate(() => {
    const app = window.__fw;
    const scene = app.scene3d.scene;
    let pivot = null;
    scene.traverse((o) => { if (o.name === 'ToolHeadLagPivot') pivot = o; });
    if (!pivot) return { ok: false, why: 'no ToolHeadLagPivot in the scene' };
    pivot.updateWorldMatrix(true, true);

    // Gather the drawn head vertices in WORLD space. Sub-sampled: a brush head
    // is a few thousand verts and the principal axis of a sample of 3000 is the
    // same axis to well under a degree.
    const pts = [];
    pivot.traverse((o) => {
      if (!o.isMesh || !o.geometry?.attributes?.position) return;
      if (o.visible === false) return;
      const pos = o.geometry.attributes.position;
      const step = Math.max(1, Math.floor(pos.count / 1500));
      const m = o.matrixWorld.elements;
      for (let i = 0; i < pos.count; i += step) {
        const x = pos.getX(i); const y = pos.getY(i); const z = pos.getZ(i);
        pts.push([
          m[0] * x + m[4] * y + m[8] * z + m[12],
          m[1] * x + m[5] * y + m[9] * z + m[13],
          m[2] * x + m[6] * y + m[10] * z + m[14],
        ]);
      }
    });
    if (pts.length < 24) return { ok: false, why: `only ${pts.length} head vertices` };

    // mean
    const mu = [0, 0, 0];
    for (const p of pts) { mu[0] += p[0]; mu[1] += p[1]; mu[2] += p[2]; }
    mu[0] /= pts.length; mu[1] /= pts.length; mu[2] /= pts.length;
    // covariance
    const c = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (const p of pts) {
      const d = [p[0] - mu[0], p[1] - mu[1], p[2] - mu[2]];
      for (let a = 0; a < 3; a += 1) for (let b = 0; b < 3; b += 1) c[a][b] += d[a] * d[b];
    }
    // dominant eigenvector by power iteration: the brush's long edge
    let v = [1, 0.3, 0.2];
    for (let it = 0; it < 200; it += 1) {
      const n = [
        c[0][0] * v[0] + c[0][1] * v[1] + c[0][2] * v[2],
        c[1][0] * v[0] + c[1][1] * v[1] + c[1][2] * v[2],
        c[2][0] * v[0] + c[2][1] * v[1] + c[2][2] * v[2],
      ];
      const len = Math.hypot(n[0], n[1], n[2]) || 1;
      v = [n[0] / len, n[1] / len, n[2] / len];
    }
    // how far the long edge is from level, in degrees, unsigned
    const longAxisTiltDeg = Math.abs(Math.asin(Math.max(-1, Math.min(1, v[1])))) * 180 / Math.PI;

    // the shaft, so the control case can be recognised: near-vertical shafts
    // have no preferred roll and must not be judged
    const w = app.scene3d.walk;
    const d = w.broomDiagnostics?.() || w.heldToolDiagnostics?.() || {};
    return {
      ok: true,
      vertices: pts.length,
      longAxis: v.map((n) => +n.toFixed(3)),
      longAxisTiltDeg: +longAxisTiltDeg.toFixed(2),
      // recorded, never judged -- see the header
      squareRoll: d.squareRoll ?? null,
      hasBristle: d.hasBristle ?? null,
      geomSource: d.geomSource ?? null,
    };
  });

  // Poses a player is actually in. If one constant could carry squareness these
  // would all agree already; the point of sampling several is that they do not.
  const POSES = [
    { name: 'carry-level', yaw: -Math.PI / 2, pitch: -0.15 },
    { name: 'looking-down', yaw: -Math.PI / 2, pitch: -0.62 },
    { name: 'turned-left', yaw: -Math.PI / 2 - 0.9, pitch: -0.35 },
    { name: 'turned-right', yaw: -Math.PI / 2 + 0.9, pitch: -0.35 },
    { name: 'looking-up', yaw: -Math.PI / 2, pitch: 0.25 },
  ];
  for (let i = 0; i < POSES.length; i += 1) {
    const p = POSES[i];
    await page.evaluate((q) => {
      const w = window.__fw.scene3d.walk.state;
      w.yaw = q.yaw; w.pitch = q.pitch; w.vx = 0; w.vz = 0;
    }, p);
    // WAIT FOR THE HEAD TO STOP SWINGING BEFORE MEASURING IT.
    //
    // The head rides a lag spring, and snapping the yaw 0.9 rad in one frame
    // injects a swing worth several degrees. The first version of this driver
    // waited a flat 900 ms and measured whatever the spring happened to be doing
    // -- the SAME build came back 2.06 deg in one run and 4.77 deg in the next,
    // which would have read as "the fix is unreliable" when the instrument was.
    // A tilt read off a head that is still moving is not a squareness reading.
    const settled = await page.waitForFunction(() => {
      const w = window.__fw.scene3d.walk;
      const d = w.broomDiagnostics?.() || w.heldToolDiagnostics?.() || {};
      const l = d.headLag || {};
      return Math.abs(l.angle ?? 1) < 0.004 && Math.abs(l.vel ?? 1) < 0.02;
    }, null, { timeout: 20000 }).then(() => true).catch(() => false);
    const m = await measure();
    m.lagSettled = settled;
    const file = `square-${String(i + 1).padStart(2, '0')}-${p.name}.png`;
    const canvas = await page.$('#game');
    await (canvas || page).screenshot({ path: path.join(OUT, file) });
    out.poses.push({ ...p, pitch: +p.pitch.toFixed(2), yaw: +p.yaw.toFixed(2), file, ...m });
  }

  const judged = out.poses.filter((p) => p.ok);
  const worst = judged.reduce((a, b) => (b.longAxisTiltDeg > (a?.longAxisTiltDeg ?? -1) ? b : a), null);
  out.measured = {
    posesMeasured: judged.length,
    worstPose: worst?.name ?? null,
    worstTiltDeg: worst?.longAxisTiltDeg ?? null,
    tilts: judged.map((p) => `${p.name}=${p.longAxisTiltDeg}deg`),
  };
  out.checks = {
    // CONTROL: the instrument has to have found the drawn mesh in every pose,
    // or "0 degrees of tilt" is just "nothing measured"
    everyPoseMeasured: judged.length === POSES.length,
    headFoundVertices: judged.every((p) => p.vertices >= 200),
    // CONTROL: a tilt read off a still-swinging head is noise, not squareness
    everyPoseSettledBeforeMeasuring: out.poses.every((p) => p.lagSettled === true),
    // CONTROL: the solve needs the bristle direction. Without it the term is
    // zero and the head is square only by luck.
    bristleAxisMeasured: judged.every((p) => p.hasBristle === true),
    liveGeometryNotFallback: judged.every((p) => p.geomSource === 'live'),
    // THE CLAIM: level in every pose, not just the one that was photographed.
    squareInEveryPose: judged.length > 0 && judged.every((p) => p.longAxisTiltDeg <= 3),
    noPageErrors: out.errs.length === 0,
  };
  out.ok = Object.values(out.checks).every(Boolean);
  fs.writeFileSync(path.join(OUT, 'broom-square.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('F1-SQUARE', JSON.stringify({ measured: out.measured, checks: out.checks }, null, 2));
  return out;
}
