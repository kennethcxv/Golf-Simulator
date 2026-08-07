// B4 — THE PLANT OBEYS REACH, measured. The old framing sweep's scandal:
// the contact socket read 0.073-0.084 yd above the boards for EVERY anchor,
// including one two yards below the eye — the rig planted from below,
// drawing a shaft between two points no handle connects. The fix fades
// work-pose authority as the hands sink below the plant height. This
// instrument is the sweep that can SEE that:
//
//   anchor ladder (y): shipped → -0.9 → -1.5 → -2.0 (x/z shipped), work
//   pitch, per rung read toolRigDiagnostics:
//     - geomSource MUST be 'live' on every rung (null = the rung FAILS, not
//       vacuously passes — reviewer 1's null-hostility demand);
//     - shipped rung: headAboveFloor ≈ floorKiss (0.05..0.12) and workBlend
//       > 0.6 (planted);
//     - sunk rungs: workBlend collapses (< 0.2 by -1.5) — authority obeys
//       reach — and headAboveFloor does NOT sit pinned at the kiss value.
//   Control 1: the shipped rung is sampled FIRST and LAST; the two must
//   agree (sweep didn't drift the rig).
//   Control 2 (the up-look behavioural leg): at full real up-look with the
//   sweep button held, the cleaning result must stay null — an unplanted
//   broom clears NOTHING (this also exercises the courseScene gate that
//   B4 extended from broom-only to the rig-owned pair).
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/b4-plant');
  fs.mkdirSync(OUT, { recursive: true });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  const boot = await import(`file:///${bootPath}`);
  await boot.clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(2200);

  await page.evaluate(() => {
    const app = window.__fw;
    const inv = app.state?.shop?.inventory;
    if (inv && !inv.vac1) inv.vac1 = { shelf: 0, back: 1 };
    else if (inv && !(inv.vac1.back > 0)) inv.vac1.back = 1;
    const o = app.scene3d.clubhouse().interior.position;
    const w = app.scene3d.walk.state;
    w.x = o.x - 5.2; w.z = o.z + 3.0; w.yaw = 0.4; w.pitch = -0.55; // work range
  });
  // real-path equip
  await page.mouse.click(640, 380);
  await page.waitForTimeout(400);
  const bindings = await page.evaluate(
    () => window.__fw.preferences?.values?.controls?.bindings || {},
  );
  await page.keyboard.down(bindings.toolBelt || 'f');
  await page.waitForTimeout(450);
  await page.keyboard.up(bindings.toolBelt || 'f');
  await page.waitForTimeout(250);
  const items = await page.evaluate(() => {
    const el = document.querySelector('.tool-wheel');
    return el ? [...el.querySelectorAll('.tool-wheel-item')]
      .map((b) => b.querySelector('.tool-wheel-label')?.textContent || '') : [];
  });
  const idx = items.findIndex((label) => /broom/i.test(label));
  if (idx >= 0) {
    await page.keyboard.press(String(idx === 9 ? 0 : idx + 1));
    await page.waitForTimeout(200);
    await page.keyboard.press('Enter').catch(() => {});
  }
  await page.waitForTimeout(500);
  await page.mouse.click(640, 380);
  await page.waitForTimeout(600);

  const rung = async (label, anchorY) => {
    await page.evaluate((y) => {
      const walk = window.__fw.scene3d.walk;
      const shipped = walk.toolFeelLive('broom').compose.gripAnchor;
      walk.toolRigSetGripAnchor('broom', y == null ? null : [shipped[0], y, shipped[2]]);
    }, anchorY);
    await page.waitForTimeout(700); // eased follow settles
    const d = await page.evaluate(() => {
      const diag = window.__fw.scene3d.walk.toolRigDiagnostics('broom');
      return diag ? {
        geomSource: diag.geomSource,
        headAboveFloor: diag.headAboveFloor,
        workBlend: diag.workBlend,
        gripCamWorldY: diag.gripCamWorldY,
      } : null;
    });
    return { label, anchorY, ...d };
  };

  const rungs = [];
  rungs.push(await rung('shipped-first', null));
  for (const y of [-0.9, -1.5, -2.0, -2.4]) rungs.push(await rung(`sunk ${y}`, y));
  rungs.push(await rung('shipped-last', null));
  await page.screenshot({ path: path.join(OUT, 'ladder-final.png') });

  // Control 2 — full up-look, real held button, cleaning must stay silent
  await page.evaluate(() => {
    window.__fw.scene3d.walk.toolRigSetGripAnchor('broom', null);
    window.__fw.scene3d.walk.state.pitch = 1.2;
  });
  await page.waitForTimeout(500);
  await page.mouse.down();
  await page.waitForTimeout(2200);
  const upLook = await page.evaluate(() => {
    const c = window.__fw.scene3d.walk.cleaningDiagnostics();
    const diag = window.__fw.scene3d.walk.toolRigDiagnostics('broom');
    return { result: c.result, using: c.using, workBlend: diag?.workBlend };
  });
  await page.mouse.up();
  await page.screenshot({ path: path.join(OUT, 'uplook-sweeping.png') });
  // positive control for the same instrument: at work pitch cleaning DOES land
  await page.evaluate(() => { window.__fw.scene3d.walk.state.pitch = -0.55; });
  await page.waitForTimeout(600);
  await page.mouse.down();
  await page.waitForTimeout(2200);
  const workLook = await page.evaluate(() => {
    const c = window.__fw.scene3d.walk.cleaningDiagnostics();
    return { resultPresent: !!c.result, using: c.using };
  });
  await page.mouse.up();

  const byLabel = Object.fromEntries(rungs.map((r) => [r.label, r]));
  const first = byLabel['shipped-first'];
  const last = byLabel['shipped-last'];
  const sunk15 = byLabel['sunk -1.5'];
  const sunk20 = byLabel['sunk -2'] || byLabel['sunk -2.0'];
  const out = {
    rungs,
    upLook,
    workLook,
    checks: {
      allLive: rungs.every((r) => r.geomSource === 'live'),
      shippedPlants: first && first.headAboveFloor != null
        && first.headAboveFloor > 0.005 && first.headAboveFloor < 0.15
        && first.workBlend > 0.6,
      // -0.9/-1.5 keep the hands ABOVE floor+kiss: a real handle reaches, so
      // those rungs MUST plant (the first run taught the ladder this).
      legalReachStillPlants: sunk15 && sunk15.workBlend > 0.6
        && sunk15.headAboveFloor < 0.15,
      // the scandal case: hands below the floor cannot plant a head above
      // them - authority collapses and the head rides the carry hover
      belowFloorRefuses: sunk20 && sunk20.workBlend < 0.1
        && sunk20.headAboveFloor > 0.3
        && (byLabel['sunk -2.4'] ? byLabel['sunk -2.4'].workBlend < 0.05 : true),
      noDriftControl: first && last
        && Math.abs(first.headAboveFloor - last.headAboveFloor) < 0.02
        && Math.abs(first.workBlend - last.workBlend) < 0.05,
      upLookCleansNothing: upLook.using === true && (upLook.result == null || upLook.result.did === 0),
      workPitchCleans: workLook.using === true && workLook.resultPresent === true,
      noPageErrors: errs.length === 0,
    },
    errs: errs.slice(0, 5),
  };
  out.ok = Object.values(out.checks).every(Boolean);
  fs.writeFileSync(path.join(OUT, 'b4.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
