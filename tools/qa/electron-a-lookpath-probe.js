// A0 (Goal 20) — WHAT DOES THE GAME ACTUALLY RECEIVE FROM A QA MOUSE MOVE?
//
// Section A has to remove real pointer lock from QA runs without losing the
// real input path. Before choosing, measure the path that exists. Four numbers,
// all read from the LIVE walk state (never from my own arithmetic):
//
//   1. does a real canvas click still take pointer lock (the trap's cause)
//   2. MONOTONIC sweep while locked  -> yaw delta   (what drivers use today)
//   3. OUT-AND-BACK sweep while locked -> yaw delta (what the FREEPLAY BRIDGE
//      uses: move(800+dx,450) then move(800,450) every step). If raw deltas are
//      position deltas, this nets to ZERO and every stranger verifier that ever
//      "looked around" was standing still. That would be an instrument fault in
//      my own bridge, so it gets measured rather than assumed.
//   4. the raw movementX values the DOM actually delivers for each pattern.
//
// NEGATIVE CONTROL: with lock released, the same monotonic sweep must produce
// no yaw change. Without it, a yaw delta proves nothing about the lock path.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-a-lookpath-probe.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/a-mousetrap');
  fs.mkdirSync(OUT, { recursive: true });

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForTimeout(2500);

  // Tap the DOM at the same listener the game uses, recording only what the
  // browser put on the event. This is observation, not a second input path.
  await page.evaluate(() => {
    window.__mvLog = [];
    window.addEventListener('mousemove', (e) => {
      window.__mvLog.push([e.movementX, e.movementY, e.clientX, e.clientY, e.isTrusted ? 1 : 0]);
    }, true);
  });
  const readLog = () => page.evaluate(() => { const l = window.__mvLog; window.__mvLog = []; return l; });
  const read = () => page.evaluate(() => ({
    yaw: +window.__fw.scene3d.walk.state.yaw.toFixed(5),
    pitch: +window.__fw.scene3d.walk.state.pitch.toFixed(5),
    locked: !!document.pointerLockElement,
  }));

  const out = { steps: {} };

  // 1. real click -> pointer lock?
  await page.mouse.click(800, 450);
  await page.waitForTimeout(600);
  out.steps.lockedAfterRealClick = (await read()).locked;

  const sweepMonotonic = async () => {
    for (let i = 0; i < 30; i += 1) await page.mouse.move(500 + i * 20, 450, { steps: 1 });
  };
  const sweepOutAndBack = async () => {
    for (let i = 0; i < 30; i += 1) {
      await page.mouse.move(830, 450, { steps: 2 });
      await page.mouse.move(800, 450, { steps: 1 });
    }
  };

  await readLog();
  let before = await read();
  await sweepMonotonic();
  await page.waitForTimeout(250);
  let after = await read();
  let log = await readLog();
  out.steps.monotonicLocked = {
    yawDelta: +(after.yaw - before.yaw).toFixed(5),
    events: log.length,
    movementXSum: log.reduce((a, r) => a + r[0], 0),
    firstFive: log.slice(0, 5),
    allTrusted: log.every((r) => r[4] === 1),
  };

  await page.mouse.move(800, 450, { steps: 1 });
  await page.waitForTimeout(200);
  await readLog();
  before = await read();
  await sweepOutAndBack();
  await page.waitForTimeout(250);
  after = await read();
  log = await readLog();
  out.steps.outAndBackLocked = {
    yawDelta: +(after.yaw - before.yaw).toFixed(5),
    events: log.length,
    movementXSum: log.reduce((a, r) => a + r[0], 0),
    firstFive: log.slice(0, 5),
  };

  // NEGATIVE CONTROL — release the lock, sweep the same way, expect no motion.
  await page.evaluate(() => document.exitPointerLock());
  await page.waitForTimeout(500);
  await readLog();
  before = await read();
  await sweepMonotonic();
  await page.waitForTimeout(250);
  after = await read();
  log = await readLog();
  out.steps.control = {
    lockedDuringControl: before.locked,
    yawDelta: +(after.yaw - before.yaw).toFixed(5),
    events: log.length,
    movementXSum: log.reduce((a, r) => a + r[0], 0),
    pass: before.locked === false && Math.abs(after.yaw - before.yaw) < 0.005,
  };

  fs.writeFileSync(path.join(OUT, 'lookpath-probe.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
