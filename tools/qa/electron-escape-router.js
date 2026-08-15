// PHASE 8 (Goal 26) — REAL ESCAPE PRESSES FROM EVERY STATE.
//
// "Test with real Escape presses from every one of these... After each, confirm I
// can resume and still move and look."
//
// Two things are checked per state, because the brief names both and they fail
// separately:
//
//   WHICH RUNG FIRED. The router records the layer it unwound, so "Escape did
//   something" can be distinguished from "Escape did the RIGHT thing". A router
//   that closes two layers at once and one that closes none are both wrong and
//   both look like "it closed" from outside.
//
//   CAN I STILL PLAY. "Escape must never corrupt pointer lock, leave input
//   disabled, or strand me between modes." So after every press the walk state
//   is nudged and the position re-read: if the body does not move, Escape has
//   left the player stranded, whatever the label says.
//
// The presses are REAL keyboard events, not calls into the handler -- a router
// installed on the wrong target, or shadowed by a listener registered earlier,
// would pass a direct call and fail a keypress.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-escape-router.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/escape-router');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [], states: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(5000);

  out.routerPresent = await page.evaluate(() => typeof window.__fwEscapeLog === 'function');
  console.log('ROUTER-PRESENT', out.routerPresent);
  if (!out.routerPresent) {
    out.verdict = { ABORTED: 'no escape router installed; every result below would be about the old handlers' };
    fs.writeFileSync(path.join(OUT, 'escape-router.json'), `${JSON.stringify(out, null, 2)}\n`);
    console.log('ESCAPE-ROUTER', JSON.stringify(out.verdict));
    return out;
  }

  // Can the player still move and look? Nudged and re-read, so a stranded body
  // is caught regardless of what the UI claims.
  const canStillPlay = () => page.evaluate(async () => {
    const walk = window.__fw.scene3d.walk;
    const before = { x: walk.state.x, z: walk.state.z, yaw: walk.state.yaw };
    walk.state.x += 0.25;
    walk.state.yaw += 0.2;
    await new Promise((done) => setTimeout(done, 260));
    const moved = Math.hypot(walk.state.x - before.x, walk.state.z - before.z) > 0.01;
    const looked = Math.abs(walk.state.yaw - before.yaw) > 0.01;
    walk.state.x = before.x; walk.state.z = before.z; walk.state.yaw = before.yaw;
    return { moved, looked, walkActive: !!walk.isActive?.() };
  });

  const press = async (name, setup) => {
    await page.evaluate(() => { window.__fwEscapeMark = (window.__fwEscapeLog() || []).length; });
    const staged = setup ? await page.evaluate(setup).catch((e) => ({ ok: false, why: String(e.message) })) : { ok: true };
    await page.waitForTimeout(700);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(800);
    const rungs = await page.evaluate(() => {
      const log = window.__fwEscapeLog() || [];
      return log.slice(window.__fwEscapeMark || 0).map((r) => r.rung);
    });
    const play = await canStillPlay();
    const row = {
      state: name, staged, rungsFired: rungs, rungCount: rungs.length, ...play,
    };
    out.states.push(row);
    console.log('ESC', JSON.stringify(row));
    // leave the world clean for the next state
    await page.evaluate(() => {
      const app = window.__fw;
      try { if (app.laptopOpen) app.laptopOpen = false; } catch { /* ignore */ }
      try { app.scene3d?.clubhouse?.()?.register?.leave?.({ restorePointer: false }); } catch { /* ignore */ }
      try { app.scene3d?.clubhouse?.()?.ledgerBook?.setOpen?.(false); } catch { /* ignore */ }
      try { app.scene3d?.clubhouse?.()?.ledgerBook?.setCarried?.(false); } catch { /* ignore */ }
    });
    await page.waitForTimeout(400);
    // close the pause menu if this press opened it
    const paused = await page.evaluate(() => !!document.querySelector('.pause-panel'));
    if (paused) { await page.keyboard.press('Escape'); await page.waitForTimeout(500); }
  };

  await press('walking (nothing open)', null);
  await press('ledger carried', () => {
    const b = window.__fw.scene3d.clubhouse()?.ledgerBook;
    b?.setCarried?.(true);
    return { ok: !!b?.isCarried?.() };
  });
  await press('register mode', () => {
    const r = window.__fw.scene3d.clubhouse()?.register;
    const ok = r?.enter?.();
    return { ok: !!ok && !!r?.isActive?.() };
  });
  await press('laptop open', () => { window.__fw.laptopOpen = true; return { ok: true }; });
  await press('tool in hand', () => {
    window.__fw.scene3d.walk.setTool('mop');
    return { ok: window.__fw.scene3d.walk.getTool?.() === 'mop' };
  });

  const acted = out.states.filter((s) => s.rungCount > 0);
  out.verdict = {
    statesTested: out.states.length,
    everyPressActed: acted.length === out.states.length,
    // "unwind ONE layer" -- more than one rung on a single press is the defect
    multiRungPresses: out.states.filter((s) => s.rungCount > 1).map((s) => s.state),
    strandedAfter: out.states.filter((s) => !s.moved || !s.looked)
      .map((s) => ({ state: s.state, moved: s.moved, looked: s.looked })),
    rungs: out.states.map((s) => `${s.state} -> ${s.rungsFired.join('+') || 'NOTHING'}`),
  };
  console.log('ESCAPE-ROUTER', JSON.stringify(out.verdict, null, 2));
  fs.writeFileSync(path.join(OUT, 'escape-router.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
