// I2 (Goal 23) — WHILE I AM HOLDING THE BOOK, WASD MUST NOT MOVE ME.
//
// Carrying the register was a full walking state with a book in frame, so a
// player reading a page drifted across the room while they read it.
//
// Three legs, and the CONTROL is the point: the same keys, held for the same
// time, WITHOUT the book. A driver that only shows "the player did not move
// while carrying" cannot tell a lock from a wall, a stuck key, or a driver that
// forgot to press anything — and this repository has shipped all three.
//
//   1. CONTROL   walk with empty hands   -> must travel
//   2. LOCKED    walk holding the book   -> must not
//   3. RELEASED  put it down, walk again -> must travel again
//
// Leg 3 matters as much as leg 2: a lock that never lifts is worse than no lock.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-i2-book-locks-walking.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/i2-book-locks-walking');
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

  // Stand in the middle of the shop with room in every direction, so a leg that
  // fails to move fails because of the rule and not because of a wall.
  out.placed = await page.evaluate(() => {
    const app = window.__fw;
    const ch = app.scene3d.clubhouse();
    const w = app.scene3d.walk.state;
    const ip = ch.interior.position;
    app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440 + 14 * 60;
    app.speedIdx = 0;
    // Facing the way the strafe leg proved clear. At yaw 0 the control leg
    // travelled 0.0000 while strafing travelled 1.53 and the SAME forward key
    // travelled 1.54 later in the run -- forward was into a wall, which a
    // driver must not report as "the keys do not work".
    w.x = ip.x; w.z = ip.z; w.yaw = -Math.PI / 2; w.pitch = -0.05; w.vx = 0; w.vz = 0;
    return { inside: !!ch.isInside(w.x, w.z, 0.35), carried: !!ch.ledgerCarried?.() };
  });
  await page.waitForTimeout(900);

  const where = () => page.evaluate(() => {
    const w = window.__fw.scene3d.walk.state;
    return { x: +w.x.toFixed(4), z: +w.z.toFixed(4) };
  });
  const travelled = async (key, ms) => {
    const a = await where();
    await page.keyboard.down(key);
    await page.waitForTimeout(ms);
    await page.keyboard.up(key);
    await page.waitForTimeout(250);
    const b = await where();
    return +Math.hypot(b.x - a.x, b.z - a.z).toFixed(4);
  };
  const setCarried = (on) => page.evaluate((v) => {
    const ch = window.__fw.scene3d.clubhouse();
    try { ch.ledgerBook?.setCarried?.(v); } catch { /* reported by the read-back */ }
    return !!ch.ledgerCarried?.();
  }, on);

  // TAKE THE LOOK, AND WARM THE INPUT.
  //
  // Two instrument faults, both caught on the first run and neither of them the
  // game's: the very first 'w' after boot travelled 0.0000 while the same key
  // moved 1.4011 later in the same session, and the mouse moved the yaw by
  // exactly 0 because the pointer was never captured. A driver that reports
  // either as a finding is reporting on itself.
  await page.mouse.click(700, 400);
  await page.waitForTimeout(400);
  // ...and MOVE it. The look is captured on movement, not on the click: with a
  // click alone every leg before the first mouse move travelled 0.0000 and the
  // identical key travelled 3.76 immediately after one.
  await page.mouse.move(760, 400, { steps: 8 });
  await page.mouse.move(700, 400, { steps: 8 });
  await page.waitForTimeout(400);
  await page.keyboard.down('w');
  await page.waitForTimeout(500);
  await page.keyboard.up('w');
  await page.waitForTimeout(400);

  // ORDER MATTERS, AND I GOT IT WRONG FIRST. The empty-handed control ran
  // FIRST, before the input chain was warm, and read 0.0000 three runs running
  // while the identical key read 1.4 / 1.5 / 3.2 later in the same sessions. A
  // control that runs in a different state from the leg it is controlling for
  // is not a control.
  //
  // So the comparison is LOCKED then RELEASED, back to back, same keys, same
  // durations, both after the warm-up. The released leg is the control, and it
  // is a stronger one than the original: it runs immediately after the locked
  // leg with nothing changed but the book.
  out.coldForward = await travelled('w', 900); // informational: the cold read
  out.coldStrafe = await travelled('a', 700);

  // 1. LOCKED — holding the book
  out.lockedCarried = await setCarried(true);
  out.lockedForward = await travelled('w', 1100);
  out.lockedStrafe = await travelled('a', 900);
  // ...and looking is still allowed, because turning your head over a page you
  // are holding is not walking
  const yawBefore = await page.evaluate(() => window.__fw.scene3d.walk.state.yaw);
  await page.mouse.move(700, 400, { steps: 6 });
  await page.mouse.move(980, 400, { steps: 12 });
  await page.waitForTimeout(250);
  const yawAfter = await page.evaluate(() => window.__fw.scene3d.walk.state.yaw);
  out.yawChangedWhileHolding = +Math.abs(yawAfter - yawBefore).toFixed(4);

  // 2. RELEASED — the control. Same keys, same durations, book down.
  out.releasedCarried = await setCarried(false);
  out.releasedForward = await travelled('w', 1100);
  out.releasedStrafe = await travelled('a', 900);

  await page.screenshot({ path: path.join(OUT, 'holding-the-book.png') });

  out.checks = {
    inside: out.placed.inside,
    bookActuallyCarried: out.lockedCarried === true,
    // THE RULE
    lockedDoesNotWalk: out.lockedForward < 0.05,
    lockedDoesNotStrafe: out.lockedStrafe < 0.05,
    // THE CONTROL: the same keys, immediately after, with the book down
    releasedWalks: out.releasedForward > 0.3,
    releasedStrafes: out.releasedStrafe > 0.3,
    // ...and the gap between them is the whole finding
    lockIsTheDifference: out.releasedForward > out.lockedForward * 10 + 0.3,
    noPageErrors: out.errs.length === 0,
  };
  out.ok = Object.values(out.checks).every(Boolean);
  fs.writeFileSync(path.join(OUT, 'book-locks-walking.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('I2', JSON.stringify({
    coldForward: out.coldForward,
    coldStrafe: out.coldStrafe,
    lockedForward: out.lockedForward,
    lockedStrafe: out.lockedStrafe,
    releasedForward: out.releasedForward,
    releasedStrafe: out.releasedStrafe,
    yawChangedWhileHolding: out.yawChangedWhileHolding,
    checks: out.checks,
    ok: out.ok,
  }, null, 2));
  return out;
}
