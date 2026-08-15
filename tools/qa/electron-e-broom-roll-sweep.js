// E (Goal 23) — THE BROOM HEAD'S ROLL, SWEPT IN ELECTRON, FOR THE OWNER TO PICK.
//
// WHAT THE OLD SWEEP MEASURED: tools/qa/broom-pitch-sweep.js boots against
// http://localhost:8457/ in a browser. Any candidate ever chosen from it was
// chosen in a program the owner does not run. Same fault class as the door
// timings and the golden lens, and this is the fourth instrument in this
// repository found running somewhere the game is not.
//
// The value being swept is `sweep.headRoll`, which did not exist until tonight.
// It could not be swept before because it was not a parameter: the shaft is
// aimed with the MINIMAL rotation onto the grip->head direction, which by
// construction leaves roll about that direction unspecified, and every other
// roll term is zero unless the player is mid-stroke or wedged against a wall.
//
// The rule this obeys: DO NOT REPORT A NUMBER I CHOSE. This photographs every
// candidate at the default player camera, numbers them, and stops.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-e-broom-roll-sweep.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/e-broom-roll');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [], candidates: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(3000);

  // THE POSE THE TOOL IS DEMONSTRABLY VISIBLE FROM.
  //
  // My first version stood on the lawn in full afternoon sun and produced
  // thirteen photographs of trees: outdoors the held viewmodel is not drawn,
  // and setTool reported equipped:true and vmActive:true throughout. A driver
  // that photographs the wrong place looks exactly like a tool that is not
  // there — the same fault as the mop, three times, tonight.
  //
  // This is the golden suite's own tool pose (tools/qa/golden-capture.js), which
  // has thirteen committed reference images proving the broom renders from it.
  // Offsets are from the LIVE interior origin, never a constant.
  out.setup = await page.evaluate(() => {
    const app = window.__fw;
    const ch = app.scene3d.clubhouse();
    const w = app.scene3d.walk.state;
    const ip = ch.interior.position;
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

  // Equip through the shipped API rather than a key: the tool keys are a wheel,
  // and a keypress that does not equip produces a photograph of empty grass —
  // which is what the mop driver got three times tonight before this was fixed.
  out.equipped = await page.evaluate(() => {
    try { window.__fw.scene3d.walk.setTool('broom'); return true; } catch (e) { return String(e.message || e); }
  });
  await page.waitForTimeout(4000);
  out.vmActive = await page.evaluate(() => (
    window.__fw.scene3d.walk.broomDiagnostics?.()?.vmActive
    ?? window.__fw.scene3d.walk.heldToolDiagnostics?.()?.vmActive
    ?? null
  ));

  const setRoll = (value) => page.evaluate((v) => {
    const walk = window.__fw.scene3d.walk;
    const feel = walk.toolFeelLive?.('broom');
    if (!feel) return 'toolFeelLive unavailable';
    if (!feel.sweep) return 'no sweep block';
    try {
      feel.sweep.headRoll = v;
      return feel.sweep.headRoll === v ? 'ok' : `frozen: still ${feel.sweep.headRoll}`;
    } catch (e) { return `frozen: ${e.message}`; }
  }, value);

  // Thirteen candidates across a full quarter-turn either way. Wide enough that
  // the right answer is inside the range even if it is nowhere near zero.
  const STEPS = 13;
  const LO = -Math.PI / 4;
  const HI = Math.PI / 4;
  for (let i = 0; i < STEPS; i += 1) {
    const value = LO + ((HI - LO) * i) / (STEPS - 1);
    const applied = await setRoll(value);
    await page.waitForTimeout(700);
    const file = `roll-${String(i + 1).padStart(2, '0')}.png`;
    const canvas = await page.$('#game');
    await (canvas || page).screenshot({ path: path.join(OUT, file) });
    out.candidates.push({
      n: i + 1,
      radians: +value.toFixed(4),
      degrees: +((value * 180) / Math.PI).toFixed(1),
      applied,
      file,
    });
    console.log('E-ROLL', i + 1, value.toFixed(4), applied);
  }
  await setRoll(0);

  out.checks = {
    equipped: out.equipped === true,
    viewmodelActive: out.vmActive !== false,
    valueIsWritable: out.candidates.every((c) => c.applied === 'ok'),
    allShot: out.candidates.length === STEPS,
    noPageErrors: out.errs.length === 0,
  };
  out.ok = Object.values(out.checks).every(Boolean);
  fs.writeFileSync(path.join(OUT, 'broom-roll-sweep.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('E-SWEEP', JSON.stringify({ ok: out.ok, checks: out.checks, setup: out.setup }, null, 2));
  return out;
}
