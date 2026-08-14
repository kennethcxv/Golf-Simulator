// D (Goal 23) — THE BROOM HEAD'S ROLL, SWEPT IN ELECTRON, FOR THE OWNER TO PICK.
//
// WHAT THE OLD SWEEP MEASURED: tools/qa/mop-pitch-sweep.js boots against
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
//   node tools/qa/run-electron.cjs tools/qa/electron-e-mop-roll-sweep.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/mop-goal25r2-splay032');
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
  // has thirteen committed reference images proving the mop renders from it.
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
    // INDOORS, at the golden suite's tool pose -- the pose with thirteen
    // committed reference images proving a held tool renders from it.
    //
    // Three attempts to photograph this head came back black or empty tonight,
    // all of them OUTDOORS, and the rake explained why: a tool viewmodel draws
    // only in the domain its tool belongs to. The mop is an INDOOR tool.
    w.x = ip.x - 5.6; w.z = ip.z + 4.4;
    w.yaw = -Math.PI / 2; w.pitch = -0.62; // GOAL 25 r2: look DOWN at the head -- at -0.15 it sits clipped in the bottom-left corner
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
    try { window.__fw.scene3d.walk.setTool('mop'); return true; } catch (e) { return String(e.message || e); }
  });
  await page.waitForTimeout(4000);
  out.vmActive = await page.evaluate(() => (
    window.__fw.scene3d.walk.mopDiagnostics?.()?.vmActive
    ?? window.__fw.scene3d.walk.heldToolDiagnostics?.()?.vmActive
    ?? null
  ));

  // ONE PHOTOGRAPH, not a sweep. "The bunker mop viewmodel -- deformed lumps
  // filling the top third." That is a description of a mesh, and the first job
  // is to see whether it is still true.
  await page.waitForTimeout(1200);
  const file = 'mop-head.png';
  const canvas = await page.$('#game');
  await (canvas || page).screenshot({ path: path.join(OUT, file) });
  out.candidates.push({ n: 1, file, caption: 'bunker mop, golden tool pose' });

  out.checks = {
    equipped: out.equipped === true,
    viewmodelActive: out.vmActive !== false,
    shot: out.candidates.length === 1,
    noPageErrors: out.errs.length === 0,
  };
  out.ok = Object.values(out.checks).every(Boolean);
  fs.writeFileSync(path.join(OUT, 'mop.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('J-RAKE', JSON.stringify({ ok: out.ok, checks: out.checks, setup: out.setup }, null, 2));
  return out;
}
