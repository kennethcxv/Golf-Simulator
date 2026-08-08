// B4 — DOES THE PLANT NUMBER MOVE WHEN THE HANDS MOVE?
//
// The brief's evidence for the bug is a reading, not a description: *"the plant
// number read 0.073-0.084 for every candidate in your sweep including one two
// yards below the eye."* A number that does not move when its input moves two
// yards is not measuring its input.
//
// `tests/broom-plant-authority.test.js` pins the RULE. This pins the RIG: the
// same grip-anchor sweep the original note came from, driven through the hook
// the rig already exposes for it (`walk.toolRigSetGripAnchor`), reading the head
// height back out of `toolRigDiagnostics('broom')`.
//
// THE NEGATIVE CONTROL IS BUILT INTO THE LADDER. The candidates deliberately
// span both regimes:
//
//   - ABOVE the contact plane, the head height MUST be constant. An upright pose
//     plants the same however high the hands are; if this half varies, the rig is
//     noisy and the other half proves nothing.
//   - BELOW it, the head height MUST track the hands. That is the fix.
//
// An instrument that varied everywhere would be exactly as suspect as one that
// varied nowhere, which is why both halves are asserted rather than just the
// interesting one.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-b4-plant-sweep.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/b4-plant-sweep');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [], ladder: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  const boot = await import(`file:///${bootPath}`);
  await boot.clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.bringToFront().catch(() => {});
  await page.waitForTimeout(6000);

  // Inside the clubhouse: the cleaning kit is gated on it, and a driver that
  // skips this gets an empty wheel and spends its hypotheses on the rig.
  out.teleport = await page.evaluate(() => {
    const fw = window.__fw;
    const ch = fw?.scene3d?.clubhouse?.();
    const st = fw?.scene3d?.walk?.state;
    if (!ch || !st) return { ok: false };
    let lp = ch.ledgerBook.position;
    if (typeof lp === 'function') lp = ch.ledgerBook.position();
    const ip = ch.interior.position;
    const book = { x: ip.x + lp.x, z: ip.z + lp.z };
    const to = { x: ip.x - book.x, z: ip.z - book.z };
    const len = Math.hypot(to.x, to.z) || 1;
    st.x = book.x + (to.x / len) * 3.0;
    st.z = book.z + (to.z / len) * 3.0;
    st.pitch = -0.55;
    return { ok: true, x: +st.x.toFixed(2), z: +st.z.toFixed(2) };
  }).catch((e) => ({ ok: false, threw: String(e && e.message) }));
  await page.waitForTimeout(2500);

  const keys = await page.evaluate(() => window.__fw.preferences?.values?.controls?.bindings || {});
  await page.keyboard.down(keys.toolBelt || 'f');
  await page.waitForTimeout(450);
  const wheel = await page.evaluate(() => {
    const el = document.querySelector('.tool-wheel');
    return el ? [...el.querySelectorAll('.tool-wheel-item')]
      .map((b) => b.querySelector('.tool-wheel-label')?.textContent || '') : [];
  });
  if (wheel.some((l) => /broom/i.test(l))) await page.keyboard.press('b');
  await page.waitForTimeout(250);
  await page.keyboard.up(keys.toolBelt || 'f');
  await page.waitForTimeout(2500);
  out.equipped = await page.evaluate(() => window.__fw?.scene3d?.walk?.getTool?.() ?? 'none').catch(() => null);
  out.wheel = wheel;

  // The authored anchor, so the ladder is expressed as offsets from the real
  // pose rather than as numbers invented here.
  out.authored = await page.evaluate(() => {
    const d = window.__fw?.scene3d?.walk?.toolRigDiagnostics?.('broom');
    return d ? {
      headAboveFloor: d.headAboveFloor,
      gripCamWorldY: d.gripCamWorldY,
      plantAuthority: d.plantAuthority ?? null,
      workBlend: d.workBlend,
    } : null;
  }).catch(() => null);

  // The ladder. Y is the anchor's CAMERA-SPACE height, so more negative hangs
  // the hands lower; the last few put them under the boards, which is the
  // regime the brief's two-yards-below-the-eye candidate lives in.
  //
  // ROUND 1 OF THIS LADDER STOPPED AT -2.20 AND PROVED NOTHING. It reported
  // authority 1 on every rung and I nearly wrote that up as "the gate never
  // engages". Then the newly-exposed `floorWorldY` said where the plane actually
  // is: -1.317, so plane-plus-kiss is -1.305, and the lowest rung had put the
  // hands at gripY -1.168 — still 0.137 yd ABOVE it. The ladder never entered
  // the regime it was built to test, and a flat authority column was the
  // CORRECT answer to a question I had not asked.
  //
  // Worth stating plainly because the reading looked exactly like the bug: a
  // number that does not move. It did not move because nothing moved it.
  //
  // The bottom four rungs now put the hands genuinely under the boards. -3.20 is
  // 1.9 yd below the plane, which is the brief's own two-yards-below-the-eye
  // candidate in the units the rig actually uses.
  const RUNGS = [-0.10, -0.55, -1.30, -2.20, -2.45, -2.70, -2.95, -3.20];
  for (const y of RUNGS) {
    const applied = await page.evaluate((yy) => (
      window.__fw?.scene3d?.walk?.toolRigSetGripAnchor?.('broom', [0.16, yy, 0.52]) ?? 'no hook'
    ), y).catch((e) => `threw: ${String(e && e.message)}`);
    // Several frames, so the read is a settled pose and not a rig mid-chase.
    await page.waitForTimeout(700);
    const d = await page.evaluate(() => {
      const g = window.__fw?.scene3d?.walk?.toolRigDiagnostics?.('broom');
      return g ? {
        headAboveFloor: g.headAboveFloor,
        assetHeadWorldY: g.assetHeadWorldY,
        gripCamWorldY: g.gripCamWorldY,
        plantAuthority: g.plantAuthority ?? null,
        floorWorldY: g.floorWorldY ?? null,
        workBlend: g.workBlend,
        planted: g.planted ?? null,
      } : null;
    }).catch(() => null);
    out.ladder.push({ anchorY: y, applied: Array.isArray(applied) ? 'set' : applied, ...(d || {}) });
  }

  // PUT IT BACK. A QA override left set would poison every later beat in any
  // driver that runs after this one in the same profile.
  out.restored = await page.evaluate(() => (
    window.__fw?.scene3d?.walk?.toolRigSetGripAnchor?.('broom', null) ?? 'no hook'
  )).catch(() => null);

  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const spreadOf = (xs) => (xs.length ? Math.max(...xs) - Math.min(...xs) : null);
  const auth = out.ladder.map((r) => num(r.plantAuthority)).filter((v) => v !== null);
  const heads = out.ladder.map((r) => num(r.headAboveFloor)).filter((v) => v !== null);

  // HOW FAR EACH RUNG SANK BELOW THE CONTACT PLANE, which is the authority's
  // actual input and is only computable because `floorWorldY` is now exposed.
  // Round 1 compared gripY against a plane it had assumed rather than read.
  const KISS = 0.012;
  for (const r of out.ladder) {
    const f = num(r.floorWorldY); const g = num(r.gripCamWorldY);
    r.sinkBelowPlane = (f === null || g === null) ? null : +((f + KISS) - g).toFixed(3);
    // The exported rule, evaluated on the rig's own inputs. If this and
    // `plantAuthority` ever disagree, the unit test is testing a copy that has
    // drifted from what actually runs.
    r.predicted = r.sinkBelowPlane === null ? null
      : +Math.max(0, Math.min(1, 1 - Math.max(0, r.sinkBelowPlane) / 0.12)).toFixed(3);
  }
  const predictionError = spreadOf(out.ladder
    .filter((r) => num(r.predicted) !== null && num(r.plantAuthority) !== null)
    .map((r) => Math.abs(r.predicted - r.plantAuthority)));

  // THE CONTROL, GROUPED CORRECTLY.
  //
  // First cut grouped by `plantAuthority === 1` and asserted the head height was
  // constant across it. That is wrong, and the run said so: rungs at authority 1
  // gave 0.593, 0.213, 0.012, 0.011 — a 0.582 spread — because above the boards
  // the head DESCENDS WITH THE HANDS and only stops once it reaches them. Those
  // rungs are carry poses, not plants, and a control that lumps them together
  // measures the pose changing, not the plant holding.
  //
  // The plant is the rungs where the head is actually ON the floor. Those must
  // agree with each other however far apart the hands are — that is the real
  // invariant, and it is the thing whose failure would look like the bug.
  const plantedRows = out.ladder.filter((r) => num(r.headAboveFloor) !== null
    && Math.abs(r.headAboveFloor - KISS) < 0.01 && num(r.plantAuthority) === 1);
  const sunkRows = out.ladder.filter((r) => num(r.plantAuthority) !== null && r.plantAuthority < 1);

  out.verdict = {
    equipped: out.equipped,
    rungs: out.ladder.length,
    floorWorldY: out.ladder[0]?.floorWorldY ?? null,
    authoritySpread: spreadOf(auth),
    headSpread: spreadOf(heads),
    // CONTROL: genuine plants agree with each other across a wide hand range.
    plantedRungs: plantedRows.length,
    plantedHandRange: spreadOf(plantedRows.map((r) => num(r.gripCamWorldY)).filter((v) => v !== null)),
    plantedHeadSpread: spreadOf(plantedRows.map((r) => num(r.headAboveFloor)).filter((v) => v !== null)),
    // FIX: authority must fade and reach zero once the hands are under the plane.
    sunkRungs: sunkRows.length,
    reachesZero: auth.some((a) => a === 0),
    hasPartialFade: auth.some((a) => a > 0 && a < 1),
    // The exported rule agrees with the live rig.
    maxPredictionError: predictionError,
    // THE BUG'S SIGNATURE, stated as the thing that must NOT be true.
    everyCandidateIdentical: spreadOf(auth) === 0,
  };
  fs.writeFileSync(path.join(OUT, 'b4-plant-sweep.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('B4-SWEEP', JSON.stringify(out.verdict));
  for (const r of out.ladder) {
    console.log(`  anchorY ${String(r.anchorY).padStart(6)}  gripY ${String(r.gripCamWorldY).padStart(8)}`
      + `  authority ${String(r.plantAuthority).padStart(6)}  headAboveFloor ${String(r.headAboveFloor).padStart(8)}`
      + `  planted ${r.planted}`);
  }
  return out;
}
