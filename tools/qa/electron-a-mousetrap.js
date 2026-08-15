// A (Goal 20) — ACCEPTANCE: the QA window never captures the operator's cursor,
// and the camera still turns from real injected mouse input.
//
// Run it UNDER the OS-level watcher, which is the half that grades the owner's
// actual complaint:
//   powershell -NoProfile -File tools/qa/cursor-capture-watch.ps1 -Seconds 150 \
//     -Out qa/electron/a-mousetrap/watch-fixed.jsonl        (in one shell)
//   node tools/qa/run-electron.cjs tools/qa/electron-a-mousetrap.js \
//     --clubhouse=pine-hills-v2                             (in another)
//
// This file grades the half the page can see:
//   1. a real canvas click takes the look (the game believes it holds a lock)
//   2. a monotonic sweep turns the view, by an amount that matches the pixels
//      moved — not merely "nonzero", because a stuck axis is also nonzero
//   3. real key holds still walk the player
//   4. NEGATIVE CONTROL: with the look released, the identical sweep must not
//      move the view at all. Without this, (2) proves nothing about the gate.
//   5. the movement deltas the game receives are the position deltas of the
//      same events, and every event is trusted
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/a-mousetrap');
  fs.mkdirSync(OUT, { recursive: true });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message || e)));

  await page.setViewportSize({ width: 1600, height: 900 });
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  // The first run of this driver reported lookHeldAfterClick:false and then took
  // the look perfectly on the second click. The load veil was still over the
  // canvas: the click landed on the veil, so the game never saw it. Waiting for
  // the veil is the difference between measuring the game and measuring a
  // curtain.
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(2500);

  await page.evaluate(() => {
    window.__mv = [];
    window.addEventListener('mousemove', (e) => {
      window.__mv.push([e.movementX, e.movementY, e.isTrusted ? 1 : 0]);
    }); // bubble phase: exactly where the game's own listener sits
  });
  const drainMoves = () => page.evaluate(() => { const l = window.__mv; window.__mv = []; return l; });
  const read = () => page.evaluate(() => ({
    yaw: +window.__fw.scene3d.walk.state.yaw.toFixed(5),
    pitch: +window.__fw.scene3d.walk.state.pitch.toFixed(5),
    x: +window.__fw.scene3d.walk.state.x.toFixed(3),
    z: +window.__fw.scene3d.walk.state.z.toFixed(3),
    lockHeld: !!document.pointerLockElement,
  }));

  const out = { steps: {}, errs };
  const YAW_PER_PX = 0.0021; // src/render3d/mouseLook.js

  // 1. the player's own gesture
  await page.mouse.click(800, 450);
  await page.waitForTimeout(600);
  out.steps.lookHeldAfterClick = (await read()).lockHeld;

  // 2. a monotonic sweep: 1200 px of travel in 40 real moves
  const sweep = async () => {
    for (let i = 0; i < 40; i += 1) await page.mouse.move(200 + i * 30, 450, { steps: 1 });
  };
  await page.mouse.move(200, 450, { steps: 1 });
  await page.waitForTimeout(150);
  await drainMoves();
  let before = await read();
  await sweep();
  await page.waitForTimeout(250);
  let after = await read();
  let moves = await drainMoves();
  const travelled = 39 * 30;
  out.steps.sweepHeld = {
    yawDelta: +(after.yaw - before.yaw).toFixed(5),
    expected: +(-travelled * YAW_PER_PX).toFixed(5),
    events: moves.length,
    movementXSum: moves.reduce((a, m) => a + m[0], 0),
    allTrusted: moves.every((m) => m[2] === 1),
  };
  // within 15%: the first event after a lock is deliberately swallowed, and the
  // lock guard eats one more, so an exact match would be the wrong assertion
  out.steps.sweepHeld.matchesPixels = Math.abs(
    out.steps.sweepHeld.yawDelta - out.steps.sweepHeld.expected,
  ) < Math.abs(out.steps.sweepHeld.expected) * 0.15;
  await page.screenshot({ path: path.join(OUT, 'after-sweep.png') });

  // 3. real key holds still walk
  before = await read();
  await page.keyboard.down('w');
  await page.waitForTimeout(900);
  await page.keyboard.up('w');
  await page.waitForTimeout(200);
  after = await read();
  out.steps.walkYd = +Math.hypot(after.x - before.x, after.z - before.z).toFixed(3);
  out.steps.walkWorks = out.steps.walkYd > 0.5;

  // 4. NEGATIVE CONTROL — release the look, sweep identically, expect stillness
  await page.evaluate(() => document.exitPointerLock());
  await page.waitForTimeout(400);
  await page.mouse.move(200, 450, { steps: 1 });
  await page.waitForTimeout(150);
  await drainMoves();
  before = await read();
  await sweep();
  await page.waitForTimeout(250);
  after = await read();
  moves = await drainMoves();
  out.steps.control = {
    lookHeld: before.lockHeld,
    yawDelta: +(after.yaw - before.yaw).toFixed(5),
    events: moves.length,
    pass: before.lockHeld === false
      && Math.abs(after.yaw - before.yaw) < 0.005
      && moves.length > 20, // the events must still have ARRIVED to prove a gate
  };

  // 5. re-take the look the way a player clicking back in does, and confirm the
  //    view answers again — a one-way gate would also pass step 4
  await page.mouse.click(800, 450);
  await page.waitForTimeout(500);
  await page.mouse.move(200, 450, { steps: 1 });
  await page.waitForTimeout(150);
  before = await read();
  await sweep();
  await page.waitForTimeout(250);
  after = await read();
  out.steps.regrab = {
    lookHeld: (await read()).lockHeld,
    yawDelta: +(after.yaw - before.yaw).toFixed(5),
    pass: Math.abs(after.yaw - before.yaw) > 1.0,
  };

  out.checks = {
    lookTaken: out.steps.lookHeldAfterClick === true,
    sweepTurnsView: out.steps.sweepHeld.matchesPixels === true,
    eventsTrusted: out.steps.sweepHeld.allTrusted === true,
    walkWorks: out.steps.walkWorks === true,
    controlPasses: out.steps.control.pass === true,
    regrabWorks: out.steps.regrab.pass === true,
    noPageErrors: errs.length === 0,
  };
  out.ok = Object.values(out.checks).every(Boolean);
  fs.writeFileSync(path.join(OUT, 'acceptance.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
