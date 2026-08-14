// 5.2 (Goal 26) — CARRIED IS NOT MOPPING, MEASURED IN THE RUNNING GAME.
//
// "The strings fly everywhere. It must feel HEAVY. Carried: they barely move, a
// sharp turn produces a small slow response, no flailing, no jitter at rest.
// Actively mopping: they drag, compress, lag and recover, and settle smoothly
// when the stroke stops. SEPARATE CARRY AND ACTIVE PARAMETERS."
//
// The unit test proves the two tunings differ when the solver is stepped by
// hand. That is not the same claim. D1 is on the ledger precisely because a mop
// solver can be perfect in a unit test and never run in the game -- six passes
// of tuning against hand-stepped tests, and `strandRig.update` had zero call
// sites. So this drives the REAL mop: real walk state, real turn, real use
// button, and reads the tip positions out of the live rig.
//
// WHAT IT MEASURES, per phase:
//   settle     tip motion per frame while standing still. "No jitter at rest"
//              is a claim about this number and nothing else.
//   turn       peak tip lag through a sharp yaw sweep while CARRIED. "A small
//              slow response" -- so both the peak and how long it takes.
//   stroke     peak tip lag with the use button held and the head driven along
//              a stroke. Must be materially larger than the turn, or the two
//              modes are one mode.
//   recover    tip lag after the stroke stops. "Settles smoothly" means this
//              decays rather than ringing.
//
// The rig is found by userData.strandRig, NOT by object name: the BROOM's rig is
// also called MopStrandRig and a name search finds it first. That cost a run.
//
//   VIDEO_DIR=qa/mop-weight node tools/qa/run-electron.cjs tools/qa/electron-mop-weight.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/mop-weight');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(6000);

  out.equipped = await page.evaluate(() => {
    const s3 = window.__fw.scene3d;
    const ch = s3.clubhouse();
    const c = ch.interior.position;
    const w = s3.walk.state;
    w.x = c.x; w.z = c.z + 2; w.vx = 0; w.vz = 0; w.yaw = 0; w.pitch = -0.72;
    s3.walk.setTool('mop');
    return { tool: s3.walk.getTool?.() ?? null };
  });
  await page.waitForTimeout(2500);
  console.log('EQUIPPED', JSON.stringify(out.equipped));

  // Find the MOP's rig. userData.strandRig, not the name -- see the header.
  out.rigFound = await page.evaluate(() => {
    const s3 = window.__fw.scene3d;
    let found = null;
    s3.scene.traverse((o) => {
      if (found) return;
      const rig = o.userData?.strandRig;
      if (rig && typeof rig.setActive === 'function' && typeof rig.tipsWorld === 'function') {
        found = rig;
        window.__fwMopRig = rig;
        // THE RIG'S OWN ROOT, not the tool group. `Tool_mop` sits at the top of
        // a ~1.4 yd shaft, so measuring the tips against it reports the SHAFT
        // LENGTH as lag: a constant 1.71 in every phase, standing still
        // included, with the real signal a rounding error on top of it. The
        // strand rig's root is welded to the head, which is the thing the yarn
        // actually hangs from.
        window.__fwMopNode = rig.root || o;
        window.__fwMopOwner = o.name || null;
      }
    });
    return {
      ok: !!found,
      owner: window.__fwMopOwner ?? null,
      measuredAgainst: window.__fwMopNode?.name ?? null,
      strandCount: found?.strandCount ?? null,
      feel: found?.feel?.() ?? null,
      isActive: found?.isActive?.() ?? null,
    };
  });
  console.log('RIG', JSON.stringify(out.rigFound));
  if (!out.rigFound.ok) {
    out.verdict = { ABORTED: 'no verlet strand rig on the equipped mop; every number below would be about nothing' };
    fs.writeFileSync(path.join(OUT, 'mop-weight.json'), `${JSON.stringify(out, null, 2)}\n`);
    console.log('MOP-WEIGHT', JSON.stringify(out.verdict));
    return out;
  }

  // Sample the tip cloud at 20 Hz for `ms`, running whatever `drive` does to the
  // walk state each sample. Returns lag (how far the cloud centre trails the
  // head) and jitter (how far the cloud moved since the previous sample).
  const sample = (ms, mode) => page.evaluate(async ({ dur, drive }) => {
    // A named mode rather than a source string: the three motions are fixed and
    // spelled out here, so there is no function built from text at all.
    const DRIVES = {
      none: () => {},
      turn: (t, w) => { if (t < 1.2) w.yaw += 0.055; },
      stroke: (t, w) => { w.x += Math.cos(t * 3.2) * 0.016; w.z += Math.sin(t * 3.2) * 0.016; },
    };
    const fn = DRIVES[drive] || DRIVES.none;
    const rig = window.__fwMopRig;
    const node = window.__fwMopNode;
    const w = window.__fw.scene3d.walk.state;
    const rows = [];
    let prev = null;
    const t0 = performance.now();
    while (performance.now() - t0 < dur) {
      const t = (performance.now() - t0) / 1000;
      fn(t, w);
      // eslint-disable-next-line no-await-in-loop
      await new Promise((done) => requestAnimationFrame(() => done()));
      node.updateWorldMatrix(true, false);
      const e = node.matrixWorld.elements;
      const head = { x: e[12], y: e[13], z: e[14] };
      const tips = rig.tipsWorld();
      const n = tips.length || 1;
      const c = tips.reduce((a, p) => ({ x: a.x + p.x / n, y: a.y + p.y / n, z: a.z + p.z / n }),
        { x: 0, y: 0, z: 0 });
      const lag = Math.hypot(c.x - head.x, c.z - head.z);
      const move = prev ? Math.hypot(c.x - prev.x, c.y - prev.y, c.z - prev.z) : 0;
      prev = c;
      rows.push({ t: +t.toFixed(3), lag: +lag.toFixed(4), move: +move.toFixed(5) });
    }
    return rows;
  }, { dur: ms, drive: mode || 'none' });

  const stat = (rows, skip = 0) => {
    const use = rows.slice(skip);
    const lags = use.map((r) => r.lag);
    const moves = use.map((r) => r.move);
    return {
      samples: use.length,
      peakLag: +Math.max(...lags).toFixed(4),
      meanLag: +(lags.reduce((a, b) => a + b, 0) / lags.length).toFixed(4),
      endLag: +use[use.length - 1].lag.toFixed(4),
      peakMove: +Math.max(...moves).toFixed(5),
      meanMove: +(moves.reduce((a, b) => a + b, 0) / moves.length).toFixed(5),
    };
  };

  // 1. STANDING STILL, CARRIED. "No jitter at rest."
  out.settle = stat(await sample(3000, 'none'), 20);
  console.log('SETTLE(carried, still)', JSON.stringify(out.settle));

  // 2. A SHARP TURN, CARRIED. "A small slow response, no flailing."
  out.turn = stat(await sample(3000, 'turn'));
  console.log('TURN(carried)', JSON.stringify(out.turn));
  out.feelAfterCarry = await page.evaluate(() => window.__fwMopRig.feel());

  // Let it settle before the stroke, so the stroke's peak is the stroke's.
  await sample(1500, 'none');

  // 3. THE STROKE, USE BUTTON HELD. "They drag, compress, lag."
  await page.evaluate(() => window.__fw.scene3d.walk.setSpraying?.(true));
  await page.waitForTimeout(500);
  out.feelDuringStroke = await page.evaluate(() => ({
    feel: window.__fwMopRig.feel(), isActive: window.__fwMopRig.isActive(),
  }));
  console.log('FEEL-DURING-STROKE', JSON.stringify(out.feelDuringStroke));
  out.stroke = stat(await sample(3500, 'stroke'), 10);
  console.log('STROKE(active)', JSON.stringify(out.stroke));

  // 4. RECOVERY. "Settles smoothly when the stroke stops."
  await page.evaluate(() => window.__fw.scene3d.walk.setSpraying?.(false));
  out.recover = stat(await sample(2500, 'none'));
  out.feelAfterStroke = await page.evaluate(() => ({
    feel: window.__fwMopRig.feel(), isActive: window.__fwMopRig.isActive(),
  }));
  console.log('RECOVER', JSON.stringify(out.recover), 'FEEL-AFTER', JSON.stringify(out.feelAfterStroke));

  // -0.72 is where a player looking at the floor they are mopping actually
  // holds the camera, and it is the only pitch that has the yarn in frame. The
  // first run of this driver recorded the whole stroke at -0.35, where the head
  // is below the bottom edge: 61 seconds of clip, and the gesture it was
  // recorded to show was off-screen for every frame of it.
  for (const [name, pitch] of [['carried', -0.72], ['down', -0.95]]) {
    await page.evaluate((p) => { window.__fw.scene3d.walk.state.pitch = p; }, pitch);
    await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(OUT, `mop-${name}.png`) });
  }

  out.verdict = {
    // the switch reached the solver at all -- D1's lesson
    modeReachedTheSolver: out.feelDuringStroke.isActive === true
      && out.feelDuringStroke.feel.damping !== out.feelAfterCarry.damping,
    carriedDampingInGame: out.feelAfterCarry.damping,
    strokeDampingInGame: out.feelDuringStroke.feel.damping,
    restJitterPerFrame: out.settle.meanMove,
    turnPeakLag: out.turn.peakLag,
    strokePeakLag: out.stroke.peakLag,
    strokeTrailsFurther: out.stroke.peakLag > out.turn.peakLag,
    lagRatioStrokeOverTurn: +(out.stroke.peakLag / Math.max(1e-4, out.turn.peakLag)).toFixed(2),
    settledAfterStroke: out.recover.endLag,
    recoveredToRest: out.recover.endLag < out.stroke.peakLag * 0.35,
  };
  console.log('MOP-WEIGHT', JSON.stringify(out.verdict, null, 2));
  fs.writeFileSync(path.join(OUT, 'mop-weight.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
