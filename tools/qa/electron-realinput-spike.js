// B0 PRE-FLIGHT — can this harness drive the game the way the PLAYER does?
//
// Reviewer 3, objection 7: the whole B chain assumes real pointer lock and
// real key events work under run-electron tonight, and the fallback ("mark it
// UNCONFIRMED") would quietly revert every B verification to API driving —
// the exact gap six failed rounds lived in. So this runs FIRST, before any
// B0 instrument is built, and answers five questions with numbers:
//
//   1. Does a real canvas click acquire POINTER LOCK?
//   2. Do real page.mouse.move deltas reach mouseLook (yaw/pitch change)
//      while locked — i.e. movementX flows, isTrusted holds?
//   3. Do real key holds (W / A) move the player through walkKeyDown?
//   4. Which real key path equips a belt tool (the mop), and does it work?
//   5. Does the held-mouse-button work state (walkSpraying) engage from a
//      real button hold?
//
// Negative control for the input instrument itself: with pointer lock NOT
// held (Escape released it), the same mouse deltas must NOT turn the view —
// proving the yaw probe measures locked-look, not some synthetic side door.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/realinput-spike');
  fs.mkdirSync(OUT, { recursive: true });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message || e)));

  await page.setViewportSize({ width: 1280, height: 720 });
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(2500);

  const read = () => page.evaluate(() => {
    const w = window.__fw.scene3d.walk.state;
    return {
      x: +w.x.toFixed(3),
      z: +w.z.toFixed(3),
      yaw: +w.yaw.toFixed(4),
      pitch: +w.pitch.toFixed(4),
      locked: !!document.pointerLockElement,
      tool: window.__fw.scene3d.walk.tool ? window.__fw.scene3d.walk.tool() : null,
    };
  });

  const out = { steps: {}, errs };

  // 1. POINTER LOCK from a real click on the canvas.
  await page.mouse.click(640, 360);
  await page.waitForTimeout(600);
  const s1 = await read();
  out.steps.lockAfterClick = s1.locked;

  // 2. REAL MOUSE LOOK while locked: a slow sweep of small deltas, the shape
  //    a human hand makes, not one teleport jump.
  const before2 = await read();
  for (let i = 0; i < 40; i += 1) {
    await page.mouse.move(640 + (i + 1) * 6, 360, { steps: 1 });
  }
  await page.waitForTimeout(300);
  const after2 = await read();
  out.steps.yawDeltaLocked = +(after2.yaw - before2.yaw).toFixed(4);
  out.steps.lookWorks = Math.abs(after2.yaw - before2.yaw) > 0.05;

  // 3. REAL KEYS: W for a second (forward), then A (strafe).
  const before3 = await read();
  await page.keyboard.down('w');
  await page.waitForTimeout(900);
  await page.keyboard.up('w');
  await page.waitForTimeout(200);
  const after3 = await read();
  out.steps.walkDeltaYd = +Math.hypot(after3.x - before3.x, after3.z - before3.z).toFixed(3);
  out.steps.walkWorks = out.steps.walkDeltaYd > 0.5;

  // 4. EQUIP THE MOP through the real input surface. The first spike run
  //    captured the live bindings: the tool belt is F (toolBelt), NOT R —
  //    R is mowerBlades and the digits are speed keys. The wheel is a real
  //    dialog (src/ui/toolWheel.js): F opens it, the items are labelled
  //    buttons, clicking one equips. That is the player's own path.
  const bindings = await page.evaluate(() => {
    const prefs = window.__fw.preferences?.values?.controls?.bindings || null;
    return prefs;
  });
  out.steps.bindings = bindings;
  const beltKey = bindings?.toolBelt || 'f';
  await page.keyboard.press(beltKey);
  await page.waitForTimeout(600);
  const wheelOpen = await page.evaluate(() => {
    const el = document.querySelector('.tool-wheel');
    return el ? {
      visible: getComputedStyle(el).display !== 'none',
      items: [...el.querySelectorAll('.tool-wheel-item')].map((b) => ({
        label: b.querySelector('.tool-wheel-label')?.textContent || '',
        disabled: b.classList.contains('is-disabled'),
      })),
    } : null;
  });
  out.steps.wheel = wheelOpen;
  await page.screenshot({ path: path.join(OUT, 'wheel-open.png') });
  if (wheelOpen?.visible) {
    const mopItem = page.locator('.tool-wheel-item', { hasText: /mop/i }).first();
    if (await mopItem.isVisible({ timeout: 1500 }).catch(() => false)) {
      await mopItem.click();
      await page.waitForTimeout(700);
    }
  }
  // The wheel click released pointer lock (a dialog took the mouse) — the
  // player clicks back into the world afterwards, so the spike does too.
  await page.mouse.click(640, 360);
  await page.waitForTimeout(500);
  const s4 = await read();
  out.steps.toolAfterEquipAttempts = s4.tool;
  await page.screenshot({ path: path.join(OUT, 'after-equip.png') });

  // 5. WORK STATE from a real button hold (only meaningful with a tool out).
  if (s4.tool) {
    await page.mouse.down();
    await page.waitForTimeout(700);
    out.steps.sprayingDuringHold = await page.evaluate(
      () => !!window.__fw.scene3d.walk.isSpraying?.(),
    );
    await page.mouse.up();
  } else {
    out.steps.sprayingDuringHold = 'no tool equipped, skipped';
  }

  // NEGATIVE CONTROL — unlock, then the same deltas must NOT turn the view.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  // Escape may have opened the pause menu; close it if so and stay unlocked.
  const paused = await page.evaluate(() => !!document.querySelector('.pause-veil-ui'));
  if (paused) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
  }
  const beforeC = await read();
  if (!beforeC.locked) {
    for (let i = 0; i < 40; i += 1) {
      await page.mouse.move(640 + (i + 1) * 6, 360, { steps: 1 });
    }
    await page.waitForTimeout(300);
    const afterC = await read();
    out.steps.control = {
      lockedDuringControl: beforeC.locked,
      yawDeltaUnlocked: +(afterC.yaw - beforeC.yaw).toFixed(4),
      pass: Math.abs(afterC.yaw - beforeC.yaw) < 0.01,
    };
  } else {
    out.steps.control = { lockedDuringControl: true, pass: false, note: 'escape did not release lock' };
  }

  out.checks = {
    lock: out.steps.lockAfterClick === true,
    look: out.steps.lookWorks === true,
    walk: out.steps.walkWorks === true,
    equip: !!out.steps.toolAfterEquipAttempts,
    controlPasses: out.steps.control?.pass === true,
    noPageErrors: errs.length === 0,
  };
  out.ok = Object.values(out.checks).every(Boolean);
  fs.writeFileSync(path.join(OUT, 'spike.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
