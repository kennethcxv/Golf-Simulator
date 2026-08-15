// K (Goal 23) — WHAT DOES HITTING A WALL FEEL LIKE?
//
// "Collision feel" was one of the fourteen and it is the vaguest of them, so the
// first job is turning it into something with a number on it. What separates a
// wall that feels solid from one that feels sticky is what happens when you
// walk into it at an ANGLE: a good collider lets you slide along the surface and
// keep most of your speed, a bad one stops you dead and you have to back off and
// re-aim. That is the whole difference and it is measurable.
//
// Three legs, and the first is the control:
//
//   1. OPEN FLOOR   walk 1.4 s with nothing in the way -> the reference distance
//   2. HEAD ON      walk into a wall square              -> should stop (correct)
//   3. GLANCING     walk into the same wall at 30 deg    -> should SLIDE
//
// Leg 3 against leg 1 is the number: a glancing blow that keeps a good fraction
// of the open-floor distance is sliding; one that keeps almost none is sticking.
// Leg 2 exists so "it stopped" cannot be mistaken for "the keys did nothing".
//
//   node tools/qa/run-electron.cjs tools/qa/electron-k-collision-feel.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/k-collision-feel');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(3000);

  // Take the look and warm the input: the first key after boot travels zero
  // (measured in I2), and a control that runs cold is not a control.
  await page.mouse.click(700, 400);
  await page.waitForTimeout(400);
  await page.mouse.move(760, 400, { steps: 8 });
  await page.mouse.move(700, 400, { steps: 8 });
  await page.waitForTimeout(500);
  await page.keyboard.down('w');
  await page.waitForTimeout(500);
  await page.keyboard.up('w');
  await page.waitForTimeout(400);

  const place = (dx, dz, yaw) => page.evaluate(([x, z, y]) => {
    const app = window.__fw;
    const ch = app.scene3d.clubhouse();
    const w = app.scene3d.walk.state;
    const ip = ch.interior.position;
    app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440 + 14 * 60;
    w.x = ip.x + x; w.z = ip.z + z; w.yaw = y; w.pitch = 0; w.vx = 0; w.vz = 0;
    return { inside: !!ch.isInside(w.x, w.z, 0.35) };
  }, [dx, dz, yaw]);

  const travel = async (ms) => {
    const a = await page.evaluate(() => {
      const w = window.__fw.scene3d.walk.state;
      return { x: w.x, z: w.z };
    });
    await page.keyboard.down('w');
    await page.waitForTimeout(ms);
    await page.keyboard.up('w');
    await page.waitForTimeout(260);
    const b = await page.evaluate(() => {
      const w = window.__fw.scene3d.walk.state;
      return { x: w.x, z: w.z };
    });
    return +Math.hypot(b.x - a.x, b.z - a.z).toFixed(4);
  };

  // AIM THE DRIVER, DO NOT GUESS THE ROOM.
  //
  // The first version picked a coordinate and a yaw off the layout constants and
  // measured open floor 1.14 yd against "head on into a wall" 2.80 -- the
  // reference leg had walked into something and the wall legs had open room in
  // front of them. A collision test that does not know which way the wall is
  // measures nothing.
  //
  // So it asks the room: sweep the yaws from the standing spot, use isInside to
  // find how far the floor runs in each, and take the SHORTEST for the wall legs
  // and the LONGEST for the reference.
  out.aim = await page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse();
    const w = window.__fw.scene3d.walk;
    const ip = ch.interior.position;
    const rays = [];
    for (let i = 0; i < 16; i += 1) {
      const yaw = (i / 16) * Math.PI * 2;
      // walk.clearRun asks the PLAYER'S OWN collision predicate, props
      // included. isInside answers about the room envelope and is blind to
      // furniture, which is why the first two versions of this driver aimed
      // their reference leg at a shelf.
      rays.push({ yaw: +yaw.toFixed(4), clear: w.clearRun ? w.clearRun(yaw) : 0 });
    }
    const sorted = rays.slice().sort((a, b) => a.clear - b.clear);
    return { rays, nearestWall: sorted[0], longestRun: sorted[sorted.length - 1] };
  });
  const wallYaw = out.aim.nearestWall.yaw;
  const openYaw = out.aim.longestRun.yaw;
  // stand a stride short of the wall so the leg is a walk INTO it, not a nudge
  const standOff = Math.max(0.6, out.aim.nearestWall.clear - 1.6);

  // THE FIRST LEG AFTER A TELEPORT IS SHORT, and I learned that in I2 and did
  // not apply it here. Two runs measured the open-floor reference at 1.12 and
  // 1.14 yd while later legs in the same session travelled 3.4 and 4.8 -- the
  // reference was simply the first thing measured. A throwaway leg absorbs it.
  await place(0, 0, openYaw);
  await page.waitForTimeout(700);
  out.warmup = await travel(900);

  // 1. OPEN FLOOR — the reference, down the longest clear run
  await place(0, 0, openYaw);
  await page.waitForTimeout(700);
  out.openFloor = await travel(1400);

  // 2. HEAD ON — square into the nearest wall
  await place(-Math.sin(wallYaw) * standOff, -Math.cos(wallYaw) * standOff, wallYaw);
  await page.waitForTimeout(700);
  out.headOn = await travel(1400);

  // 3. GLANCING — the same wall, 30 degrees off square
  await place(-Math.sin(wallYaw) * standOff, -Math.cos(wallYaw) * standOff, wallYaw + Math.PI / 6);
  await page.waitForTimeout(700);
  out.glancing = await travel(1400);

  const ratio = out.openFloor > 0 ? out.glancing / out.openFloor : 0;
  out.measured = {
    openFloorYd: out.openFloor,
    headOnYd: out.headOn,
    glancingYd: out.glancing,
    glancingKeepsFraction: +ratio.toFixed(3),
  };
  out.checks = {
    // CONTROL: the keys move the player at all
    openFloorMoves: out.openFloor > 1.0,
    // THE CONTROL THAT DECIDES WHETHER ANY OF THIS IS READABLE.
    //
    // The reference leg must travel FURTHER than a leg that walked into a wall,
    // or it is not a reference. Three runs measured it at 1.12, 1.15 and 1.15 yd
    // against wall legs of 3.4 and 5.7 -- so the "clearest" direction is the
    // most blocked one, and the aim is wrong.
    //
    // Why: the ray probe uses isInside(), which answers about the ROOM
    // ENVELOPE and is blind to furniture. The longest run by that measure walks
    // straight into a shelf. A first-leg warm-up was added on the suspicion it
    // was an ordering artefact (it is, in I2) and changed nothing here.
    //
    // Until this is true, headOnStops and glancingSlides below are unreadable
    // and MUST NOT be reported as findings about the game.
    referenceIsActuallyClear: out.openFloor > Math.max(out.headOn, out.glancing),
    headOnStops: out.headOn < out.openFloor * 0.55,
    glancingSlides: ratio > 0.45,
    noPageErrors: out.errs.length === 0,
  };
  out.ok = Object.values(out.checks).every(Boolean);
  fs.writeFileSync(path.join(OUT, 'collision-feel.json'), JSON.stringify(out, null, 2) + '\n');
  console.log('K-COLLIDE', JSON.stringify({ measured: out.measured, checks: out.checks }, null, 2));
  return out;
}
