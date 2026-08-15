// P1 (owner playtest) — "TAB, then TAB again to leave, and the game effectively
// crashed."
//
// "Effectively crashed" is a description of an experience, not a stack trace, so
// this measures every way a round trip can leave the game unusable and reports
// which one happened rather than assuming:
//
//   * a thrown error (the literal reading)
//   * the walker never comes back -- movement dead after the return
//   * the render loop stops -- frames stop arriving
//   * the mode is stranded -- neither walk nor overview owns the screen
//   * pointer lock is gone and cannot be regained, so looking is dead
//
// CONTROL FIRST, ALWAYS. The same movement and frame probes run BEFORE any Tab
// is pressed. Without that, "cannot move after Tab" is indistinguishable from
// "could not move in the first place" -- which is the exact confusion that made
// an earlier ledger control report a lock that never lifts when the player was
// simply facing a wall.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-p1-tab-round-trip.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/p1-tab');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [], rows: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));
  page.on('console', (m) => {
    if (m.type() === 'error') out.errs.push(`console: ${m.text()}`.slice(0, 300));
  });

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(2500);

  const canvas = await page.$('#game') || await page.$('canvas');
  const box = await canvas.boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.click(cx, cy);
  await page.waitForTimeout(700);

  const pose = () => page.evaluate(() => {
    const w = window.__fw.scene3d?.walk?.state;
    return w ? { x: w.x, z: w.z, yaw: w.yaw } : null;
  });

  // FRAMES ARE STILL ARRIVING. A game that has stopped rendering is the most
  // literal reading of "effectively crashed" and no state probe would see it.
  const framesIn = (ms) => page.evaluate((window_ms) => new Promise((done) => {
    let n = 0;
    const t0 = performance.now();
    const tick = () => {
      n += 1;
      if (performance.now() - t0 >= window_ms) { done(n); return; }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }), ms);

  const canMove = async () => {
    let best = 0;
    for (const key of ['w', 's', 'a', 'd']) {
      const a = await pose();
      if (!a) return 0;
      await page.keyboard.down(key);
      await page.waitForTimeout(600);
      await page.keyboard.up(key);
      await page.waitForTimeout(160);
      const b = await pose();
      if (!b) return 0;
      best = Math.max(best, Math.hypot(b.x - a.x, b.z - a.z));
      if (best > 0.3) break;
    }
    return +best.toFixed(3);
  };

  const snapshot = () => page.evaluate(() => {
    const app = window.__fw;
    return {
      courseMode: app.courseMode ?? null,
      walkActive: !!app.scene3d?.walk?.isActive?.(),
      pointerLocked: !!document.pointerLockElement,
      uiMode: document.body.dataset.uiMode ?? null,
      overlayShown: (() => {
        const o = document.querySelector('.shop-overlay');
        return o ? getComputedStyle(o).display !== 'none' : null;
      })(),
    };
  });

  // LOOKING, WHICH IS THE HALF WASD CANNOT SEE.
  //
  // The first pass scored nine green and I nearly reported "does not
  // reproduce" -- but every probe used the KEYBOARD, and the one number that
  // changed across the round trip was pointerLocked: true before, false after.
  // A player who can walk but cannot turn is looking at a game that has stopped
  // responding to the mouse, which is what "effectively crashed" describes.
  const canLook = async () => {
    const a = await pose();
    if (!a) return 0;
    await page.mouse.move(cx + 240, cy, { steps: 8 });
    await page.waitForTimeout(300);
    const b = await pose();
    await page.mouse.move(cx, cy, { steps: 4 });
    if (!b) return 0;
    let d = b.yaw - a.yaw;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    return +Math.abs(d).toFixed(4);
  };

  const record = async (label) => {
    const row = {
      label,
      state: await snapshot(),
      framesIn600ms: await framesIn(600),
      move: await canMove(),
      look: await canLook(),
      errsSoFar: out.errs.length,
    };
    out.rows.push(row);
    await page.screenshot({ path: path.join(OUT, `${label}.png`) });
    console.log('P1-TAB', label, JSON.stringify({ ...row.state, frames: row.framesIn600ms, move: row.move, look: row.look }));
    return row;
  };

  const before = await record('01-before-any-tab');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(2000);
  const inOverview = await record('02-in-overview');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(2500);
  const backOnFoot = await record('03-back-on-foot');
  // and again, because a round trip that only breaks the second time is still
  // broken and would be missed by a single pass
  await page.keyboard.press('Tab');
  await page.waitForTimeout(2000);
  await page.keyboard.press('Tab');
  await page.waitForTimeout(2500);
  const secondRoundTrip = await record('04-after-second-round-trip');

  out.clauses = {
    // the control: it worked before Tab was ever pressed
    couldMoveBeforeAnyTab: before.move > 0.3,
    couldLookBeforeAnyTab: before.look > 0.01,
    renderingBeforeAnyTab: before.framesIn600ms > 10,
    // Tab in
    overviewActuallyEntered: inOverview.state.courseMode === 'overview',
    // Tab out -- the owner's failure
    returnedToWalk: backOnFoot.state.courseMode === 'walk',
    walkerIsLiveAgain: backOnFoot.state.walkActive === true,
    canMoveAfterReturn: backOnFoot.move > 0.3,
    // THE ONE THE KEYBOARD PROBES CANNOT SEE
    canLookAfterReturn: backOnFoot.look > 0.01,
    pointerLockSurvivesTheRoundTrip: backOnFoot.state.pointerLocked === true,
    stillRenderingAfterReturn: backOnFoot.framesIn600ms > 10,
    secondRoundTripAlsoSurvives: secondRoundTrip.state.courseMode === 'walk'
      && secondRoundTrip.move > 0.3
      && secondRoundTrip.framesIn600ms > 10,
    noPageErrors: out.errs.length === 0,
  };
  out.ok = Object.values(out.clauses).every((v) => v === true);
  fs.writeFileSync(path.join(OUT, 'tab.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('P1-TAB-RESULT', JSON.stringify({ clauses: out.clauses, errs: out.errs.slice(0, 6), ok: out.ok }, null, 2));
  return out;
}
