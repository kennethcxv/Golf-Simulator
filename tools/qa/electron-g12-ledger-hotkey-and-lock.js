// G1 + G2 (Goal 24) — THE HOTKEY OPENS IT, AND READING IT HOLDS YOU STILL.
//
// WHAT THE OLD CHECK MEASURED, since you asked before I changed anything.
//
// tools/qa/electron-i2-book-locks-walking.js drove three legs — empty-handed,
// holding the book, and put down again — and recorded 0.0000 forward and 0.0000
// strafe for the locked leg. Every number in it is honest and I would write it
// the same way again. It was about the wrong STATE. Its one line that matters:
//
//     ch.ledgerBook?.setCarried?.(v)
//
// It measured the book being CARRIED — picked up and walked around with, the
// [X] verb. You press E to READ it, which is `isOpen()`, a different state that
// the movement gate never looked at. So the lock was real, the check was real,
// and neither of them was ever in the situation you were in.
//
// This drives the two verbs a player actually uses:
//   G1  press the bound key, from across the room, and the book opens
//   G2  hold every movement key while READING, and go nowhere
//
// CONTROLS, because "did not move" is a sentence this driver could otherwise
// say about a wall, an unwarmed input chain, or a key it forgot to press:
//   1. the SAME keys, the SAME durations, with the book shut, must travel. It
//      runs immediately after the locked leg with nothing else changed.
//   2. the input chain is warmed first — the pointer captured AND MOVED. The
//      Goal 23 driver recorded 0.0000 three runs running from a cold chain
//      while the identical key travelled 1.4 later in the same session.
//   3. looking must still work while reading. A lock that takes the mouse away
//      too is a different, worse thing.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-g12-ledger-hotkey-and-lock.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/g12-ledger');
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

  // Middle of the shop, facing the direction the Goal 23 driver proved is clear.
  out.placed = await page.evaluate(() => {
    const app = window.__fw;
    const ch = app.scene3d.clubhouse();
    const w = app.scene3d.walk.state;
    const ip = ch.interior.position;
    app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440 + 14 * 60;
    app.speedIdx = 0;
    w.x = ip.x; w.z = ip.z; w.yaw = -Math.PI / 2; w.pitch = -0.05; w.vx = 0; w.vz = 0;
    return { inside: !!ch.isInside(w.x, w.z, 0.35) };
  });
  await page.waitForTimeout(800);

  // CONTROL 2: capture the pointer AND MOVE IT, then spend a key.
  await page.mouse.click(700, 400);
  await page.waitForTimeout(350);
  await page.mouse.move(770, 400, { steps: 8 });
  await page.mouse.move(700, 400, { steps: 8 });
  await page.waitForTimeout(350);
  await page.keyboard.down('w');
  await page.waitForTimeout(500);
  await page.keyboard.up('w');
  await page.waitForTimeout(400);

  const where = () => page.evaluate(() => {
    const w = window.__fw.scene3d.walk.state;
    return { x: +w.x.toFixed(4), z: +w.z.toFixed(4), yaw: +w.yaw.toFixed(4) };
  });
  const travelled = async (keys, ms) => {
    const a = await where();
    for (const k of keys) await page.keyboard.down(k);
    await page.waitForTimeout(ms);
    for (const k of keys) await page.keyboard.up(k);
    await page.waitForTimeout(250);
    const b = await where();
    return +Math.hypot(b.x - a.x, b.z - a.z).toFixed(4);
  };
  const bookState = () => page.evaluate(() => {
    const app = window.__fw;
    const ch = app.scene3d.clubhouse();
    return {
      appOpen: !!app.ledgerOpen,
      isOpen: !!ch.ledgerBook?.isOpen?.(),
      inHand: !!ch.ledgerBook?.isInHand?.(),
      carried: !!ch.ledgerCarried?.(),
      hasThePlayer: !!ch.ledgerHasThePlayer?.(),
    };
  });

  // ---- G1: the bound key, from the middle of the room ----------------------
  out.boundKey = await page.evaluate(async () => {
    const kb = await import(new URL('src/core/keyBindings.js', document.baseURI).href);
    const action = kb.BINDABLE_ACTIONS.find((a) => a.id === 'ledger');
    return action ? action.defaultKey : null;
  });
  out.before = await bookState();
  // PRESS UNTIL IT IS OPEN, not a fixed number of times.
  //
  // advance() brings the book up SHUT first and opens it on the next press, and
  // enterLedger() bails out early while the rise is still animating
  // (`if (!book.isInHand()) return`). So the press count is a function of
  // animation timing, and the first version of this driver hard-coded two,
  // measured the movement lock against a book that was in hand and CLOSED, and
  // called the result a failure of the lock. Same fault as reading a value
  // before the frame that produces it.
  out.pressesToOpen = 0;
  for (let i = 0; i < 6; i += 1) {
    const st = await bookState();
    if (st.isOpen) break;
    await page.keyboard.press(out.boundKey);
    out.pressesToOpen += 1;
    await page.waitForTimeout(1400);
  }
  out.afterHotkey = await bookState();
  await page.screenshot({ path: path.join(OUT, '01-opened-by-hotkey.png') });

  // ---- G2: every movement key, while reading -------------------------------
  const MOVE = ['w', 'a', 's', 'd'];
  out.lockedForward = await travelled(['w'], 1100);
  out.lockedStrafe = await travelled(['a'], 900);
  out.lockedAll = await travelled(MOVE, 900);
  // CONTROL 3: looking still works
  const yawBefore = (await where()).yaw;
  await page.mouse.move(900, 400, { steps: 10 });
  await page.waitForTimeout(300);
  out.yawMovedWhileReading = Math.abs((await where()).yaw - yawBefore) > 0.02;

  // ---- CONTROL 1: shut it, same keys, same durations ------------------------
  out.pressesToClose = 0;
  for (let i = 0; i < 6; i += 1) {
    const st = await bookState();
    if (!st.isOpen && !st.inHand) break;
    await page.keyboard.press(out.boundKey);
    out.pressesToClose += 1;
    await page.waitForTimeout(1400);
  }
  out.afterClose = await bookState();
  out.releasedForward = await travelled(['w'], 1100);
  out.releasedStrafe = await travelled(['a'], 900);
  await page.screenshot({ path: path.join(OUT, '02-closed-and-walking.png') });

  out.checks = {
    // G1
    theActionIsBound: !!out.boundKey,
    hotkeyOpenedTheBook: out.before.isOpen === false && out.afterHotkey.isOpen === true,
    hotkeyClosedItAgain: out.afterClose.isOpen === false
      && out.afterClose.hasThePlayer === false,
    // G2 — the claim
    forwardIsLockedWhileReading: out.lockedForward < 0.05,
    strafeIsLockedWhileReading: out.lockedStrafe < 0.05,
    allFourKeysLocked: out.lockedAll < 0.05,
    // and the state the OLD check never looked at is the one the gate now reads
    openCountsAsHoldingIt: out.afterHotkey.hasThePlayer === true
      && out.afterHotkey.carried === false,
    // CONTROL 1 — the same keys move once the book is shut
    walkingWorksAgainAfterClosing: out.releasedForward > 0.3 && out.releasedStrafe > 0.3,
    // CONTROL 3
    lookStillWorksWhileReading: out.yawMovedWhileReading === true,
    noPageErrors: out.errs.length === 0,
  };
  out.ok = Object.values(out.checks).every(Boolean);
  fs.writeFileSync(path.join(OUT, 'ledger.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('G12-LEDGER', JSON.stringify({
    boundKey: out.boundKey,
    pressesToOpen: out.pressesToOpen, pressesToClose: out.pressesToClose,
    before: out.before, afterHotkey: out.afterHotkey, afterClose: out.afterClose,
    locked: { forward: out.lockedForward, strafe: out.lockedStrafe, all: out.lockedAll },
    released: { forward: out.releasedForward, strafe: out.releasedStrafe },
    checks: out.checks,
  }, null, 2));
  return out;
}
