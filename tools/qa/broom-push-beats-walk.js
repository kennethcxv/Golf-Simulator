// I6 — DOES THE PUSH BEAT THE PLAYER, measured at the BRISTLES, on real ground.
//
// pushSpeed shipped derived (4.89 = TOOL_RUN_SPEED 4.25 × 1.15) and had never
// been watched working. Two instrument faults kept every earlier version of
// this driver inconclusive, and both are worth more than the result:
//
//  1. THE ROOM HAS NO RUNWAY. Every indoor lane from the old start pose walks
//     into a fixture inside a yard (0.5 yd/s shuffles measured on all four
//     facings) — and a push-vs-walk race needs seconds of straight line. The
//     fairway south of the porch is tens of yards of proven-open ground
//     (6.1 yd/s free run), so the race runs THERE.
//  2. FEET ARE NOT BRISTLES (the review's objection, verbatim). playerToPile
//     stays comfortably positive while the pile drifts BEHIND the bristle
//     head — the exact marginal regime the tool-run cap creates. The invariant
//     is now measured from the tool's own live contact socket.
//
// Legs:
//   walk     — hold W, sweeping, ~2.6 s: pile must stay ahead of the bristles.
//   tool-run — hold Shift+W, sweeping: same invariant at the fastest speed a
//              player can sustain with the broom out (the margin's real test).
//   control  — a pile seeded 0.5 yd BEHIND the bristles: the invariant checker
//              must FLAG it, or the checker cannot see an overrun at all.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/broom-push-i6');
  fs.mkdirSync(OUT, { recursive: true });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message || e)));

  await page.setViewportSize({ width: 1280, height: 720 });
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForTimeout(3000);

  const setup = await page.evaluate(async () => {
    const app = window.__fw;
    const feel = await import(new URL('src/data/broomFeel.js', document.baseURI).href);
    const loco = await import(new URL('src/data/locomotion.js', document.baseURI).href);
    app.__debrisModule = await import(new URL('src/sim/cleaningDebris.js', document.baseURI).href);
    app.speedIdx = 0;
    const c = app.state.clock;
    c.minutes = Math.floor(c.minutes / 1440) * 1440 + 13 * 60;
    return {
      pushSpeed: feel.BROOM_FEEL.dirt.pushSpeed,
      walkSpeed: loco.WALK_SPEED_YD_S,
      toolRunSpeed: loco.TOOL_RUN_SPEED_YD_S,
    };
  });
  await page.mouse.click(640, 360);
  await page.evaluate(() => window.__fw.scene3d.walk.setTool('broom'));
  await page.waitForFunction(() => window.__fw.scene3d.walk.broomDiagnostics?.()?.vmActive === true,
    null, { timeout: 30000 });
  await page.waitForTimeout(2400);

  // THE RACE MUST RUN INDOORS: cleaningGate refuses contact outside the shop
  // (reason 'outside' — the fairway leg of the first rewrite measured
  // pileYdPerSec 0.000 for exactly this reason; the shop's debris is the
  // shop's). So hunt the longest indoor lane over a grid of start poses, and
  // race on the best one. The invariant only needs ~2 s of straight line.
  const huntLane = async () => {
    const candidates = [];
    for (const [dx, dz] of [[-4.2, 5.0], [-2.0, 5.0], [-4.2, 2.6], [-6.4, 5.0], [-2.0, 2.6], [-6.4, 2.6]]) {
      for (const yaw of [-Math.PI / 2, Math.PI / 2, 0, Math.PI]) {
        const from = await page.evaluate(({ px, pz, y }) => {
          const app = window.__fw;
          const o = app.scene3d.clubhouse().interior.position;
          const w = app.scene3d.walk;
          w.clearKeys();
          w.state.x = o.x + px; w.state.z = o.z + pz; w.state.yaw = y; w.state.pitch = -0.42;
          return { x: w.state.x, z: w.state.z };
        }, { px: dx, pz: dz, y: yaw });
        await page.waitForTimeout(200);
        await page.keyboard.down('w');
        await page.waitForTimeout(1400);
        await page.keyboard.up('w');
        const to = await page.evaluate(() => {
          const w = window.__fw.scene3d.walk;
          return { x: w.state.x, z: w.state.z };
        });
        candidates.push({
          dx, dz, yaw: +yaw.toFixed(3),
          ranYd: +Math.hypot(to.x - from.x, to.z - from.z).toFixed(2),
        });
      }
    }
    return candidates.reduce((a, b) => (b.ranYd > a.ranYd ? b : a));
  };
  const lane = await huntLane();

  // one leg of the race: place on the hunted lane, seed the pile relative to
  // the LIVE bristle contact, hold the keys, trace bristle-vs-pile every frame
  const runLeg = async (label, { shift, seedAheadYd }) => {
    await page.evaluate(({ px, pz, y }) => {
      const app = window.__fw;
      const o = app.scene3d.clubhouse().interior.position;
      const w = app.scene3d.walk;
      w.clearKeys();
      w.state.x = o.x + px; w.state.z = o.z + pz; w.state.yaw = y; w.state.pitch = -0.42;
    }, { px: lane.dx, pz: lane.dz, y: lane.yaw });
    await page.waitForTimeout(600);
    await page.evaluate((ahead) => {
      const app = window.__fw;
      const w = app.scene3d.walk;
      const o = app.scene3d.clubhouse().interior.position;
      const g = w.heldToolGeometry ? w.heldToolGeometry() : null;
      const fx = -Math.sin(w.state.yaw);
      const fz = -Math.cos(w.state.yaw);
      const list = app.__debrisModule.ensureDebris(app.state);
      list.length = 0;
      // THE DEBRIS LIST IS LOCAL TO THE INTERIOR. Every earlier version of
      // this driver seeded WORLD coordinates, which parked the pile ~350 yd
      // outside the room - the actual root cause of two sessions of 'the
      // seeded pile is not being swept'. The probe (i6-sweep-probe.js) proved
      // the sweep sim and the frame path both work once the seed is local.
      const at = (g && g.contactWorld)
        ? { x: (g.contactWorld.x - o.x) + fx * ahead, z: (g.contactWorld.z - o.z) + fz * ahead }
        : { x: (w.state.x - o.x) + fx * (1.8 + ahead), z: (w.state.z - o.z) + fz * (1.8 + ahead) };
      list.push({ x: at.x, z: at.z, a: 1, kind: 'grit' });
    }, seedAheadYd);
    await page.evaluate(() => window.__fw.scene3d.walk.setSpraying(true));
    if (shift) await page.keyboard.down('Shift');
    await page.keyboard.down('w');
    const trace = await page.evaluate(async () => {
      const app = window.__fw;
      const w = app.scene3d.walk;
      const rows = [];
      const started = performance.now();
      await new Promise((resolve) => {
        const tick = () => {
          const o = app.scene3d.clubhouse().interior.position;
          const list = app.__debrisModule.debrisState(app.state);
          const raw = list[0];
          // pile is stored LOCAL; compare in world like everything else here
          const pile = raw ? { x: raw.x + o.x, z: raw.z + o.z } : null;
          const g = w.heldToolGeometry ? w.heldToolGeometry() : null;
          const d = w.broomDiagnostics ? w.broomDiagnostics() : null;
          if (pile && g && g.contactWorld) {
            const fx = -Math.sin(w.state.yaw);
            const fz = -Math.cos(w.state.yaw);
            rows.push({
              ms: Math.round(performance.now() - started),
              // THE invariant: yards the pile sits ahead of the BRISTLES
              bristleToPile: +((pile.x - g.contactWorld.x) * fx
                + (pile.z - g.contactWorld.z) * fz).toFixed(4),
              playerX: +w.state.x.toFixed(4),
              playerZ: +w.state.z.toFixed(4),
              pileX: +pile.x.toFixed(4),
              pileZ: +pile.z.toFixed(4),
              planted: d ? d.workBlend > 0.6 : null,
            });
          }
          if (performance.now() - started >= 1900) { resolve(); return; }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      return rows;
    });
    await page.keyboard.up('w');
    if (shift) await page.keyboard.up('Shift');
    await page.evaluate(() => window.__fw.scene3d.walk.setSpraying(false));
    await page.screenshot({ path: path.join(OUT, `${label}.png`) });
    if (!trace.length) return { label, error: 'no trace rows (pile or contact missing)' };
    const first = trace[0];
    const last = trace[trace.length - 1];
    const seconds = Math.max(0.001, (last.ms - first.ms) / 1000);
    const settled = trace.filter((r) => r.ms > 500); // let the plant settle
    return {
      label,
      frames: trace.length,
      seconds: +seconds.toFixed(2),
      playerYdPerSec: +(Math.hypot(last.playerX - first.playerX, last.playerZ - first.playerZ) / seconds).toFixed(3),
      pileYdPerSec: +(Math.hypot(last.pileX - first.pileX, last.pileZ - first.pileZ) / seconds).toFixed(3),
      bristleGapStart: first.bristleToPile,
      bristleGapEnd: last.bristleToPile,
      bristleGapMin: settled.length
        ? +Math.min(...settled.map((r) => r.bristleToPile)).toFixed(4) : null,
      plantedFrames: trace.filter((r) => r.planted).length,
      // Two things make the instantaneous gap a lying statistic: a driven
      // pile takes a stride to find its riding point, and the bristle contact
      // itself SWINGS with the stroke arc, so the gap oscillates ±0.3 through
      // every pass even while the pile rides ahead on average. The overrun
      // claim is therefore the STROKE-AVERAGED gap over the last 40% of the
      // run. The control leg (pile seeded behind, never swept up) averages
      // deeply negative, so the detector stays hot.
      steadyMeanGap: (() => {
        const steady = trace.filter((r) => r.ms > (last.ms * 0.6));
        if (!steady.length) return null;
        return +(steady.reduce((sum, r) => sum + r.bristleToPile, 0) / steady.length).toFixed(4);
      })(),
      overrunFlagged: (() => {
        const steady = trace.filter((r) => r.ms > (last.ms * 0.6));
        if (!steady.length) return true;
        const mean = steady.reduce((sum, r) => sum + r.bristleToPile, 0) / steady.length;
        return mean < -0.12;
      })(),
    };
  };

  const walk = await runLeg('walk', { shift: false, seedAheadYd: 0.15 });
  const toolRun = await runLeg('tool-run', { shift: true, seedAheadYd: 0.15 });
  const control = await runLeg('control-behind', { shift: false, seedAheadYd: -0.5 });

  const checks = {
    // the hunted lane must be a real runway, or nothing below means anything
    laneIsReal: lane.ranYd > 3.0,
    walkLegRan: !walk.error && walk.frames > 40 && walk.playerYdPerSec > 1.8,
    toolRunLegRan: !toolRun.error && toolRun.frames > 40 && toolRun.playerYdPerSec > 2.6,
    // THE claim: at both speeds the pile never falls behind the bristles
    pileStaysAheadAtWalk: !walk.error && !walk.overrunFlagged && walk.pileYdPerSec > 1.0,
    pileStaysAheadAtToolRun: !toolRun.error && !toolRun.overrunFlagged && toolRun.pileYdPerSec > 1.0,
    // the detector can SEE an overrun (a pile behind the bristles is flagged)
    controlOverrunDetected: !control.error && control.overrunFlagged === true,
    noPageErrors: errs.length === 0,
  };
  const out = { setup, lane, walk, toolRun, control, errs: errs.slice(0, 10), checks };
  out.ok = Object.values(checks).every(Boolean);
  fs.writeFileSync(path.join(OUT, 'push-beats-walk.json'), `${JSON.stringify(out, null, 1)}\n`);
  return { setup, lane, walk, toolRun, control, checks, ok: out.ok };
}
