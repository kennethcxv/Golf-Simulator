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
  const OUT = path.resolve('qa/electron/d-mop-yarn');
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
    try { window.__fw.scene3d.walk.setTool('mop'); return true; } catch (e) { return String(e.message || e); }
  });
  await page.waitForTimeout(4000);
  out.vmActive = await page.evaluate(() => (
    window.__fw.scene3d.walk.mopDiagnostics?.()?.vmActive
    ?? window.__fw.scene3d.walk.heldToolDiagnostics?.()?.vmActive
    ?? null
  ));

  // WHERE IS THE HEAD? The first nine shots came back with the yarn as a
  // forty-pixel tuft on the bottom edge of the frame -- nine photographs of a
  // wall, captioned with band counts. Guessing a crop is how that happened; the
  // fix is to ASK, so this projects the strand rig's world position into the
  // camera and reports it in normalised device coordinates.
  //
  // CONTROL: it also sweeps pitch and reports the NDC at each. A held tool that
  // is parented to the camera cannot be brought into frame by aiming -- ndcY
  // would not move -- and knowing which of those two worlds this is decides
  // whether the answer is a camera angle or a crop.
  //
  // The ladder has to step through REAL FRAMES. The first version set pitch and
  // read the matrix inside one page.evaluate; evaluate is synchronous, so no
  // rAF ran between the two and every rung reported the identical ndcY -- which
  // reads exactly like "the tool is camera-parented, aiming cannot help". It was
  // an instrument with its subject held still, not a finding.
  const projectHead = () => page.evaluate(() => {
    const w = window.__fw.scene3d.walk;
    const rig = w.strandRigFor?.('mop');
    // scene3d.camera, NOT walk.camera -- the walk API has no camera and the
    // first attempt at this probe reported "no camera" and photographed nine
    // more walls. Every other driver in tools/qa reaches it this way.
    const cam = window.__fw.scene3d.camera;
    if (!rig?.root || !cam) return { ok: false, why: !rig ? 'no strand rig' : 'no camera' };
    cam.updateMatrixWorld(true);
    rig.root.updateMatrixWorld(true);
    const p = rig.root.matrixWorld;
    const v = { x: p.elements[12], y: p.elements[13], z: p.elements[14] };
    const proj = cam.projectionMatrix.clone().multiply(cam.matrixWorldInverse);
    const e = proj.elements;
    const cw = e[3] * v.x + e[7] * v.y + e[11] * v.z + e[15];
    return {
      ok: true,
      pitch: +Number(w.state.pitch).toFixed(2),
      // DID THE CAMERA ACTUALLY TURN? Without this the ladder cannot tell
      // "aiming does not move the tool on screen" (camera-parented) from
      // "my aiming lever is dead" (w.pitch written but never read). Those are
      // opposite conclusions and the ndcY column alone shows the same thing for
      // both.
      camPitch: +Math.asin(-Math.min(1, Math.max(-1,
        2 * (cam.quaternion.y * cam.quaternion.z - cam.quaternion.w * cam.quaternion.x)))).toFixed(3),
      world: { x: +v.x.toFixed(2), y: +v.y.toFixed(2), z: +v.z.toFixed(2) },
      ndcX: +((e[0] * v.x + e[4] * v.y + e[8] * v.z + e[12]) / cw).toFixed(3),
      ndcY: +((e[1] * v.x + e[5] * v.y + e[9] * v.z + e[13]) / cw).toFixed(3),
    };
  });
  const ladder = [];
  for (const pitch of [-0.15, -0.45, -0.75, -1.05]) {
    // walk.state.pitch, NOT walk.pitch. Writing the bare property read back
    // fine and moved nothing: camPitch stayed at -0.15 while pitch reported
    // -1.05. That is a dead lever, and without camPitch beside it the flat ndcY
    // column reads as 'the tool is camera-parented' -- the opposite conclusion.
    await page.evaluate((p) => { window.__fw.scene3d.walk.state.pitch = p; }, pitch);
    await page.waitForTimeout(400); // let real frames carry the pitch into the camera
    ladder.push(await projectHead());
  }
  out.aim = { ok: ladder.every((r) => r.ok), ladder };
  console.log('D-YARN AIM', JSON.stringify(out.aim, null, 1));

  // Aim at whichever rung put the head nearest the middle of the frame. If the
  // tool is camera-parented every rung reports the same ndcY and this picks the
  // first, which is the shipped pose -- no worse than before, and the ladder in
  // the JSON says plainly which world it was.
  if (out.aim?.ok) {
    const best = out.aim.ladder.slice()
      .sort((a, b) => Math.abs(a.ndcY + 0.25) - Math.abs(b.ndcY + 0.25))[0];
    out.aimChose = best;
    await page.evaluate((p) => { window.__fw.scene3d.walk.state.pitch = p; }, best.pitch);
    await page.waitForTimeout(500);
  }

  // THE SWEEP. "Make them read as one mass: touching, overlapping, matted
  // together." The photograph shows 22 bands at 26 mm reading as a COMB OF
  // SEPARATE RODS with daylight between every one. More bands, or wider ones,
  // or both -- and rather than pick blind for a seventh time, photograph the
  // candidates and let the owner say.
  //
  // Rebuilding the yarn between shots rather than rebooting per candidate:
  // toolViewmodels.rebuildYarn disposes the rig and builds a new one in place,
  // so this is one run instead of nine.
  const CANDIDATES = [
    { count: 22, strandRadiusTop: 0.013, strandRadiusBottom: 0.010 },
    { count: 26, strandRadiusTop: 0.013, strandRadiusBottom: 0.010 },
    { count: 30, strandRadiusTop: 0.013, strandRadiusBottom: 0.010 },
    { count: 22, strandRadiusTop: 0.018, strandRadiusBottom: 0.014 },
    { count: 26, strandRadiusTop: 0.018, strandRadiusBottom: 0.014 },
    { count: 30, strandRadiusTop: 0.018, strandRadiusBottom: 0.014 },
    { count: 26, strandRadiusTop: 0.022, strandRadiusBottom: 0.017 },
    { count: 34, strandRadiusTop: 0.018, strandRadiusBottom: 0.014 },
    { count: 34, strandRadiusTop: 0.022, strandRadiusBottom: 0.017 },
  ];
  for (let i = 0; i < CANDIDATES.length; i += 1) {
    const c = CANDIDATES[i];
    const built = await page.evaluate((o) => {
      const w = window.__fw.scene3d.walk;
      return w.rebuildYarn ? w.rebuildYarn('mop', o) : 'rebuildYarn unavailable';
    }, c);
    // let the fresh rig settle under gravity before it is photographed
    await page.waitForTimeout(1500);
    const file = `yarn-${String(i + 1).padStart(2, '0')}.png`;
    const canvas = await page.$('#game');
    await (canvas || page).screenshot({ path: path.join(OUT, file) });
    out.candidates.push({
      n: i + 1,
      file,
      built,
      caption: `${c.count} bands  ·  ${Math.round(c.strandRadiusTop * 2000)} mm`,
    });
    console.log('D-YARN', i + 1, JSON.stringify(built));
  }

  out.checks = {
    equipped: out.equipped === true,
    viewmodelActive: out.vmActive !== false,
    allShot: out.candidates.length === 9,
    everyRebuildTook: out.candidates.every((c) => c.built && typeof c.built === 'object'),
    // THE CHECK THE FIRST RUN DID NOT HAVE, and which is the whole reason the
    // first nine photographs were worthless: the subject has to be ON the film.
    // Nine frames each passed equipped/vmActive/allShot with the yarn hanging
    // below the bottom edge.
    headIsInFrame: !!out.aimChose
      && Math.abs(out.aimChose.ndcX) < 0.9 && Math.abs(out.aimChose.ndcY) < 0.9,
    noPageErrors: out.errs.length === 0,
  };
  // Hand the crop to the contact sheet rather than making the next person guess
  // it: NDC -> fractional screen position.
  if (out.aimChose) {
    out.crop = {
      cx: +((out.aimChose.ndcX + 1) / 2).toFixed(3),
      cy: +((1 - out.aimChose.ndcY) / 2).toFixed(3),
    };
  }
  out.ok = Object.values(out.checks).every(Boolean);
  fs.writeFileSync(path.join(OUT, 'yarn-sweep.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('J-RAKE', JSON.stringify({ ok: out.ok, checks: out.checks, setup: out.setup }, null, 2));
  return out;
}
