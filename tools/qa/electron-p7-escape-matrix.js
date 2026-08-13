// PHASE 7 (Goal 25) — WHAT DOES ESCAPE ACTUALLY DO TODAY?
//
// The brief asks for one top-level capture-phase Escape router with an explicit
// priority order. Before writing one, this measures the behaviour that already
// exists, because "Escape must never leave input disabled or strand the player
// between modes" is a claim about states, and half of them may already be fine.
//
// For each state: enter it, press a REAL Escape, then ask the only question that
// matters — CAN THE PLAYER STILL MOVE AND LOOK AFTERWARDS? A router that unwinds
// a layer but leaves the walker frozen has made things worse.
//
// CONTROL: the same movement probe runs BEFORE any Escape, so "cannot move after
// Escape" is distinguishable from "could not move in the first place". That
// distinction is the whole reason the earlier ledger control failed for a wall.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-p7-escape-matrix.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/p7-escape');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [], rows: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

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
    const w = window.__fw.scene3d.walk.state;
    return { x: w.x, z: w.z, yaw: w.yaw };
  });
  // MOVEMENT IS DIRECTION-AGNOSTIC. Forward alone reports 0 against a wall, and
  // that reads as "input is dead" when it is "the room is there".
  const canMove = async () => {
    let best = 0;
    for (const key of ['w', 's', 'a', 'd']) {
      const a = await pose();
      await page.keyboard.down(key);
      await page.waitForTimeout(650);
      await page.keyboard.up(key);
      await page.waitForTimeout(180);
      const b = await pose();
      best = Math.max(best, Math.hypot(b.x - a.x, b.z - a.z));
      if (best > 0.3) break;
    }
    return +best.toFixed(3);
  };
  const canLook = async () => {
    const a = await pose();
    await page.mouse.move(cx + 220, cy, { steps: 6 });
    await page.waitForTimeout(260);
    const b = await pose();
    await page.mouse.move(cx, cy, { steps: 4 });
    let d = b.yaw - a.yaw;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    return +Math.abs(d).toFixed(4);
  };
  const modes = () => page.evaluate(() => {
    const app = window.__fw;
    const ch = app.scene3d?.clubhouse?.();
    return {
      ledgerOpen: !!app.ledgerOpen,
      laptopOpen: !!app.laptopOpen,
      registerActive: !!ch?.register?.isActive?.(),
      pointerLocked: !!document.pointerLockElement,
      pauseVisible: !!document.querySelector('.pause-status, .pause-overview, .pause-menu'),
    };
  });

  // CONTROL: the baseline, before any Escape at all.
  out.baseline = { move: await canMove(), look: await canLook(), modes: await modes() };
  console.log('P7 baseline', JSON.stringify(out.baseline));

  const probeState = async (name, enter) => {
    const entered = await enter().catch((e) => ({ error: String(e.message || e) }));
    await page.waitForTimeout(900);
    const before = await modes();
    await page.screenshot({ path: path.join(OUT, `${name}-before-esc.png`) });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1200);
    const after = await modes();
    await page.screenshot({ path: path.join(OUT, `${name}-after-esc.png`) });
    const move = await canMove();
    const look = await canLook();
    const row = {
      state: name, entered: entered ?? null, before, after, move, look,
      // the two questions the brief actually asks
      unwoundALayer: JSON.stringify(before) !== JSON.stringify(after),
      // A PAUSE MENU IS A SUCCESS STATE, NOT A FROZEN PLAYER.
      //
      // Escape with nothing open is SUPPOSED to raise the pause menu, and a
      // paused player cannot move by design. The first version scored that as
      // 'did not recover' and would have reported the pause menu as an Escape
      // bug. Recovery means: either the player is walking again, or a menu the
      // player can resume from is on screen.
      playerRecovered: (move > 0.3 && look > 0.01) || after.pauseVisible === true,
      // and a layer still open after Escape is only correct if something else
      // was stacked under it
      layersStillOpen: [
        after.ledgerOpen ? 'ledger' : null,
        after.laptopOpen ? 'laptop' : null,
        after.registerActive ? 'register' : null,
      ].filter(Boolean),
    };
    out.rows.push(row);
    console.log('P7', name, JSON.stringify({ before, after, move, look, recovered: row.playerRecovered }));
    // leave whatever is still open, so the next state starts clean
    for (let i = 0; i < 3; i += 1) {
      const m = await modes();
      if (!m.ledgerOpen && !m.laptopOpen && !m.registerActive && !m.pauseVisible) break;
      await page.keyboard.press('Escape');
      await page.waitForTimeout(700);
    }
    if (!(await modes()).pointerLocked) { await page.mouse.click(cx, cy); await page.waitForTimeout(500); }
    return row;
  };

  await probeState('walking', async () => true);
  await probeState('ledger-open', async () => {
    for (let i = 0; i < 6; i += 1) {
      const m = await page.evaluate(() => !!window.__fw.scene3d.clubhouse()?.ledgerBook?.isOpen?.());
      if (m) return true;
      await page.keyboard.press('k');
      await page.waitForTimeout(1300);
    }
    return false;
  });
  await probeState('laptop-open', async () => {
    await page.keyboard.press('k'); // clear anything
    await page.waitForTimeout(400);
    return page.evaluate(() => {
      try { window.__fw.scene3d.walk.hooks.openLaptop?.(); return true; } catch { return false; }
    });
  });

  out.summary = {
    everyStateRecovered: out.rows.every((r) => r.playerRecovered),
    statesThatDidNotRecover: out.rows.filter((r) => !r.playerRecovered).map((r) => r.state),
    escapeUnwoundSomething: out.rows.filter((r) => r.unwoundALayer).map((r) => r.state),
    // FOUND: two exclusive modes open at once. enterLedger() refuses while the
    // laptop is open, but nothing stops the laptop opening while the LEDGER
    // owns input -- so the guard is one-way and the pair can stack.
    exclusiveModesSeenTogether: out.rows
      .filter((r) => [r.before.ledgerOpen, r.before.laptopOpen, r.before.registerActive]
        .filter(Boolean).length > 1)
      .map((r) => r.state),
    baselineCouldMove: out.baseline.move > 0.3,
    noPageErrors: out.errs.length === 0,
  };
  fs.writeFileSync(path.join(OUT, 'escape.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('P7-ESCAPE', JSON.stringify(out.summary, null, 2));
  return out;
}
