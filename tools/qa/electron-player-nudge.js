// PLAYTEST 4, ITEM 5 — COMING BACK FROM A STATION WITH SOMEBODY STANDING IN YOU.
//
// "When I come back from the ledger or the register and a customer is standing
// inside me, I should just move a bit. Push me clear gently, or push them clear
// -- either way nobody stays inside anybody. Do not teleport me across the room."
//
// The situation is built the way it happens in play rather than by placing a
// customer on top of the player: while the player is at the register they are
// deliberately NOT a body, so a customer walks into the space they occupy. The
// driver enters the register, waits until somebody is genuinely closer than the
// clearance, then leaves -- which is the exact frame the complaint is about.
//
// Three numbers decide it:
//   nearestCustomer   before and after. Must go from inside the clearance to
//                     outside it.
//   nudgeYards        how far the player was moved IN TOTAL. A step aside is a
//                     few tenths; anything approaching a yard is the teleport he
//                     explicitly ruled out.
//   frames to clear   a gentle push takes several frames. One frame is a snap.
//
// NEGATIVE CONTROL: the same measurement is taken across a stretch where nobody
// is inside the player, and the nudge must NOT fire. A separator that runs every
// frame regardless would show the same "cleared" reading on a build where it is
// shoving the player around for no reason.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-player-nudge.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/player-nudge');
  fs.mkdirSync(OUT, { recursive: true });
  const VIEWPORT = { width: 1600, height: 900 };
  const SKUS = ['tees1', 'marker1', 'glove1'];
  const out = { errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  await page.setViewportSize(VIEWPORT);
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
  await page.waitForTimeout(1500);
  await page.mouse.click(VIEWPORT.width / 2, VIEWPORT.height / 2);
  await page.waitForTimeout(150);

  await page.evaluate(async (skuIds) => {
    const app = window.__fw;
    const { REGISTER } = await import(new URL('src/data/shopLayout.js', document.baseURI).href);
    const ch = app.scene3d.clubhouse();
    ch.setOrganicWalkins(false);
    for (const id of Object.keys(app.state.shop.inventory)) {
      if (skuIds.includes(id)) app.state.shop.inventory[id].shelf = Math.max(app.state.shop.inventory[id].shelf, 12);
    }
    app.speedIdx = 0;
    app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440 + 14 * 60;
    app.scene3d.applyTimeWeather(14 * 60, app.state.weather);
    ch.rebuildStock();
    const walk = app.scene3d.walk.state;
    const off = ch.interior.position;
    walk.x = REGISTER.stand.x + off.x;
    walk.z = REGISTER.stand.z + off.z;
    const dx = REGISTER.monitor.x - REGISTER.stand.x;
    const dz = REGISTER.monitor.z - REGISTER.stand.z;
    const h = Math.hypot(dx, dz) || 0.001;
    walk.yaw = Math.atan2(-dx / h, -dz / h);
    ch.sendToCounter(skuIds, 'cash');
  }, SKUS);

  const sep = () => page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse();
    const w = window.__fw.scene3d.walk.state;
    return { ...ch.qaPlayerSeparation(), x: +w.x.toFixed(4), z: +w.z.toFixed(4), t: Math.round(performance.now()) };
  });

  // ---- CONTROL FIRST: nobody near, the nudge must stay quiet ---------------
  const controlA = await sep();
  await page.waitForTimeout(4000);
  const controlB = await sep();
  out.control = {
    nearestThroughout: [controlA.nearestCustomer, controlB.nearestCustomer],
    nudgeFramesDelta: controlB.nudgeFrames - controlA.nudgeFrames,
    movedYards: +Math.hypot(controlB.x - controlA.x, controlB.z - controlA.z).toFixed(4),
  };
  console.log('CONTROL(nobody inside)', JSON.stringify(out.control));

  // ---- enter the register, which stops the player being a body -------------
  await page.keyboard.press('e');
  await page.waitForFunction(() => window.__fw.scene3d.clubhouse().register.isActive(), null, { timeout: 20000 }).catch(() => {});
  out.inRegister = await sep();
  console.log('IN REGISTER', JSON.stringify(out.inRegister));

  // Let the customer close in on the counter while the player is not a body.
  let closest = out.inRegister.nearestCustomer ?? Infinity;
  for (let i = 0; i < 40; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const row = await sep();
    if (row.nearestCustomer != null && row.nearestCustomer < closest) closest = row.nearestCustomer;
    if (row.nearestCustomer != null && row.nearestCustomer < row.clearance) break;
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(500);
  }
  out.closestWhileParked = closest;
  const before = await sep();
  console.log('BEFORE LEAVING', JSON.stringify(before));

  // ---- leave the station: the frame the complaint is about ----------------
  await page.keyboard.press('Escape');
  await page.waitForTimeout(60);
  out.trail = [];
  for (let i = 0; i < 40; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    out.trail.push(await sep());
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(100);
  }
  const after = out.trail[out.trail.length - 1];
  const cleared = out.trail.findIndex((r) => r.blocking && r.nearestCustomer != null && r.nearestCustomer >= r.clearance - 1e-3);

  out.verdict = {
    nearestWhileParked: before.nearestCustomer,
    clearance: before.clearance,
    startedInsideEachOther: before.nearestCustomer != null && before.nearestCustomer < before.clearance,
    nearestAfter: after.nearestCustomer,
    samplesUntilClear: cleared,
    // "Do not teleport me across the room."
    playerMovedYards: +Math.hypot(after.x - before.x, after.z - before.z).toFixed(4),
    totalNudgeYards: after.nudgeYards,
    nudgeFrames: after.nudgeFrames,
    controlStayedQuiet: out.control.nudgeFramesDelta === 0,
    pageErrors: out.errs.slice(0, 6),
  };
  // ---- PHASE 2: THE MECHANISM, STAGED DIRECTLY -----------------------------
  //
  // Phase 1 above waited for the situation to occur on its own and it did not --
  // the customer stopped 1.96 yd off, so the separator was correctly quiet and
  // nothing was proved about it firing. This stages the overlap explicitly by
  // walking a customer's MESH onto the player, which is what the game leaves
  // behind when a station releases. It is labelled as staging rather than dressed
  // up as play: what is being tested here is the separator, not the pathfinder.
  const staged = await page.evaluate(async () => {
    const app = window.__fw;
    const ch = app.scene3d.clubhouse();
    const w = app.scene3d.walk.state;
    const track = ch.qaCustomerTrack?.() || [];
    if (!track.length) return { ok: false, why: 'no customers in the room' };
    // The mesh is moved through the same scene graph the crowd reads, at the
    // player's own position: standing INSIDE them, which is the report.
    // qaCustomerMeshById is the repo's own handle for exactly this: pin a body
    // where a driver needs it. Traversing for userData.kind === 'customer' found
    // nothing -- customer meshes are not tagged that way -- which is why the
    // first attempt staged nothing and reported it.
    const id = track[0]?.id;
    const mesh = id != null ? ch.qaCustomerMeshById(id) : null;
    if (!mesh) return { ok: false, why: `no mesh for id ${id}`, ids: track.map((t) => t.id).slice(0, 4) };
    mesh.position.x = w.x;
    mesh.position.z = w.z;
    mesh.updateMatrixWorld(true);
    return { ok: true, id, playerAt: [+w.x.toFixed(4), +w.z.toFixed(4)] };
  });
  console.log('STAGED OVERLAP', JSON.stringify(staged));
  out.staged = staged;
  if (staged.ok) {
    const t0 = await sep();
    out.stagedTrail = [t0];
    for (let i = 0; i < 30; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      out.stagedTrail.push(await sep());
      // eslint-disable-next-line no-await-in-loop
      await page.waitForTimeout(100);
    }
    const t1 = out.stagedTrail[out.stagedTrail.length - 1];
    out.verdict.staged = {
      nearestAtStart: t0.nearestCustomer,
      nearestAtEnd: t1.nearestCustomer,
      startedInsideEachOther: t0.nearestCustomer != null && t0.nearestCustomer < t0.clearance,
      endedClear: t1.nearestCustomer != null && t1.nearestCustomer >= t0.clearance - 1e-3,
      playerMovedYards: +Math.hypot(t1.x - t0.x, t1.z - t0.z).toFixed(4),
      nudgeYards: +(t1.nudgeYards - t0.nudgeYards).toFixed(4),
      nudgeFrames: t1.nudgeFrames - t0.nudgeFrames,
      // "gently" and "not across the room" as numbers
      gentle: (t1.nudgeFrames - t0.nudgeFrames) > 3,
      notATeleport: Math.hypot(t1.x - t0.x, t1.z - t0.z) < 1.0,
    };
  }
  console.log('PLAYER-NUDGE', JSON.stringify(out.verdict, null, 2));
  await page.screenshot({ path: path.join(OUT, 'player-nudge.png') });
  fs.writeFileSync(path.join(OUT, 'player-nudge.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
