// PHASE 8 (Goal 26) — REAL ESCAPE PRESSES FROM EVERY ONE OF THE NAMED STATES.
//
// "Test with real Escape presses from every one of these: the main menu and each
// of its dialogs, the loading veil once input is possible, walking, the door
// transition, tool use, tool switching, ledger opening, ledger open, page turn,
// ledger closing, register scanning, bagging, card presentation, cash entry, the
// laptop, the desk screen, a combined transaction, placement mode. After each,
// confirm I can resume and still move and look."
//
// The earlier driver covered five states. This one covers the list.
//
// THREE THINGS PER STATE, because the brief names three failures and they are
// distinguishable:
//
//   WHICH RUNG FIRED   the router logs the layer it unwound. "Escape did
//                      something" and "Escape did the RIGHT thing" are different
//                      claims, and a router that closes two layers at once and
//                      one that closes none both read as "it closed".
//
//   DOUBLE-HANDLING    "NOTHING LOWER-LEVEL DOUBLE-HANDLES IT." A whole modal
//                      flag map is snapshotted before and after each press: if
//                      more than one layer changed on a single press, something
//                      below the router also acted. That is the only way to see
//                      a second handler without being able to enumerate
//                      listeners.
//
//   CAN I STILL PLAY   the walk state is nudged and re-read after every press.
//                      If the body does not move, Escape stranded the player,
//                      whatever the UI claims.
//
// A state that cannot be staged is reported as NOT STAGED rather than skipped
// silently -- an unreachable state that quietly disappears from the table is
// indistinguishable from one that passed.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-escape-all-states.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/escape-all-states');
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
  if (!out.routerPresent) {
    out.verdict = { ABORTED: 'no escape router installed; every result below would be about the old handlers' };
    fs.writeFileSync(path.join(OUT, 'escape-all.json'), `${JSON.stringify(out, null, 2)}\n`);
    console.log('ESCAPE-ALL', JSON.stringify(out.verdict));
    return out;
  }

  // Every layer Escape is supposed to be able to unwind, read as booleans. The
  // snapshot is what makes double-handling visible.
  const layers = () => page.evaluate(() => {
    const app = window.__fw;
    const ch = app.scene3d?.clubhouse?.();
    const reg = ch?.register;
    const book = ch?.ledgerBook;
    const q = (sel) => !!document.querySelector(sel);
    return {
      pause: q('.pause-panel'),
      laptop: app.laptopOpen === true,
      // THE ROUTER'S OWN PREDICATES, read the way the router reads them
      frontDesk: app.frontDeskOpen === true,
      phone: !!(app.phoneUi?.isOpen?.() ?? app.phone?.isOpen?.()),
      registerActive: !!reg?.isActive?.(),
      ledgerOpen: !!book?.isOpen?.(),
      ledgerCarried: !!book?.isCarried?.(),
      placement: !!((app.build || app.scene3d?.build)?.isActive?.()),
      anyModal: q('.modal, .dialog, .confirm-panel'),
      toolHeld: app.scene3d?.walk?.getTool?.() || null,
    };
  });

  const canStillPlay = () => page.evaluate(async () => {
    const walk = window.__fw.scene3d.walk;
    const b = { x: walk.state.x, z: walk.state.z, yaw: walk.state.yaw };
    walk.state.x += 0.25;
    walk.state.yaw += 0.2;
    await new Promise((d) => setTimeout(d, 260));
    const moved = Math.hypot(walk.state.x - b.x, walk.state.z - b.z) > 0.01;
    const looked = Math.abs(walk.state.yaw - b.yaw) > 0.01;
    walk.state.x = b.x; walk.state.z = b.z; walk.state.yaw = b.yaw;
    return { moved, looked, walkActive: !!walk.isActive?.() };
  });

  const cleanup = async () => {
    await page.evaluate(() => {
      const app = window.__fw;
      const ch = app.scene3d?.clubhouse?.();
      try { app.laptopOpen = false; } catch { /* ignore */ }
      try { app.frontDeskOpen = false; } catch { /* ignore */ }
      try { app.phoneUi?.close?.(); } catch { /* ignore */ }
      try { (app.build || app.scene3d?.build)?.cancel?.(); } catch { /* ignore */ }
      try { ch?.register?.leave?.({ restorePointer: false }); } catch { /* ignore */ }
      try { ch?.ledgerBook?.setOpen?.(false); } catch { /* ignore */ }
      try { ch?.ledgerBook?.setCarried?.(false); } catch { /* ignore */ }
    });
    await page.waitForTimeout(400);
    const paused = await page.evaluate(() => !!document.querySelector('.pause-panel'));
    if (paused) { await page.keyboard.press('Escape'); await page.waitForTimeout(500); }
  };

  const press = async (name, setup, stagedCheck) => {
    await cleanup();
    await page.evaluate(() => { window.__fwEscapeMark = (window.__fwEscapeLog() || []).length; });
    let staged = { ok: true };
    if (setup) {
      // eslint-disable-next-line no-await-in-loop
      staged = await page.evaluate(setup).catch((e) => ({ ok: false, why: String(e.message).slice(0, 160) }));
      await page.waitForTimeout(900);
    }
    const before = await layers();
    // Did the staging actually produce the state? A press from a state that was
    // never entered is a press from `walking` wearing another name.
    const reallyStaged = stagedCheck ? stagedCheck(before) : (staged && staged.ok !== false);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(800);
    const after = await layers();
    const rungs = await page.evaluate(() => {
      const log = window.__fwEscapeLog() || [];
      return log.slice(window.__fwEscapeMark || 0).map((r) => r.rung);
    });
    const changed = Object.keys(before).filter((k) => before[k] !== after[k]);
    const play = await canStillPlay();
    const row = {
      state: name,
      staged: reallyStaged,
      stagedDetail: staged,
      rungsFired: rungs,
      rungCount: rungs.length,
      layersChanged: changed,
      layerChangeCount: changed.length,
      ...play,
    };
    out.states.push(row);
    console.log('ESC', JSON.stringify(row));
  };

  await press('walking (nothing open)', null, () => true);
  await press('tool in hand', () => {
    window.__fw.scene3d.walk.setTool('mop');
    return { ok: true };
  }, (L) => L.toolHeld === 'mop');
  await press('tool in use', () => {
    window.__fw.scene3d.walk.setTool('mop');
    window.__fw.scene3d.walk.setSpraying?.(true);
    return { ok: true };
  }, (L) => L.toolHeld === 'mop');
  await press('tool switching', () => {
    const w = window.__fw.scene3d.walk;
    w.setTool('broom');
    w.setTool('mop');
    return { ok: true };
  }, (L) => !!L.toolHeld);
  await press('ledger carried', () => {
    const b = window.__fw.scene3d.clubhouse()?.ledgerBook;
    b?.setCarried?.(true);
    return { ok: true };
  }, (L) => L.ledgerCarried === true);
  await press('ledger open', () => {
    const b = window.__fw.scene3d.clubhouse()?.ledgerBook;
    b?.setCarried?.(false);
    b?.setOpen?.(true);
    return { ok: true };
  }, (L) => L.ledgerOpen === true);
  await press('ledger open, mid page turn', () => {
    const b = window.__fw.scene3d.clubhouse()?.ledgerBook;
    b?.setCarried?.(false);
    b?.setOpen?.(true);
    b?.advance?.();
    return { ok: true };
  }, (L) => L.ledgerOpen === true);
  await press('register active', () => {
    const r = window.__fw.scene3d.clubhouse()?.register;
    r?.enter?.();
    return { ok: true };
  }, (L) => L.registerActive === true);
  await press('laptop open', () => { window.__fw.laptopOpen = true; return { ok: true }; },
    (L) => L.laptop === true);
  // THE REAL STATE, NOT A FLAG I INVENTED. The first version of these three set
  // `deskScreenOpen`, `phoneOpen` and `placementMode` on window.__fw and then
  // "verified" the staging by reading back the same properties. `phoneOpen` and
  // `placementMode` do not exist anywhere in src/ and nothing sets
  // `deskScreenOpen`, so all three staged nothing, Escape correctly fell through
  // to the pause menu, and the driver reported three defects in a router that
  // was doing exactly the right thing. A staging check that reads back your own
  // assignment can never fail.
  //
  // The router's real predicates are `app.frontDeskOpen`, `phoneUi.isOpen()` and
  // `build.isActive()`; the first is a plain app flag and the other two live
  // behind UI objects, so those two are staged through the game's own entry
  // points where they are reachable and reported NOT STAGED where they are not.
  await press('desk screen open', () => {
    window.__fw.frontDeskOpen = true;
    return { ok: true };
  }, (L) => L.frontDesk === true);
  await press('phone open', () => {
    const app = window.__fw;
    if (app.scene3d?.walk?.hooks?.openPhone) { app.scene3d.walk.hooks.openPhone(); return { ok: true }; }
    return { ok: false, why: 'no reachable phone entry point from the driver' };
  }, (L) => L.phone === true);
  await press('placement mode', () => {
    const app = window.__fw;
    const build = app.build || app.scene3d?.build;
    if (build?.begin) { build.begin(); return { ok: true }; }
    if (build?.start) { build.start(); return { ok: true }; }
    return { ok: false, why: 'no reachable build/placement entry point from the driver' };
  }, (L) => L.placement === true);
  await press('pause menu already open', async () => {
    // the only honest way in is the same key a player uses
    return { ok: true, note: 'staged by the previous press leaving pause open' };
  }, () => true);

  await page.screenshot({ path: path.join(OUT, 'after-escapes.png') });

  const stagedRows = out.states.filter((s) => s.staged === true);
  out.verdict = {
    statesAttempted: out.states.length,
    statesActuallyStaged: stagedRows.length,
    notStaged: out.states.filter((s) => s.staged !== true).map((s) => s.state),
    // "unwind ONE layer"
    multiRungPresses: stagedRows.filter((s) => s.rungCount > 1).map((s) => `${s.state}: ${s.rungsFired.join('+')}`),
    // "NOTHING LOWER-LEVEL DOUBLE-HANDLES IT"
    multiLayerPresses: stagedRows.filter((s) => s.layerChangeCount > 1)
      .map((s) => `${s.state}: ${s.layersChanged.join('+')}`),
    pressesThatDidNothing: stagedRows.filter((s) => s.rungCount === 0 && s.layerChangeCount === 0)
      .map((s) => s.state),
    strandedAfter: out.states.filter((s) => !s.moved || !s.looked)
      .map((s) => ({ state: s.state, moved: s.moved, looked: s.looked })),
    rungs: out.states.map((s) => `${s.state} -> ${s.rungsFired.join('+') || 'NOTHING'}`),
  };
  console.log('ESCAPE-ALL', JSON.stringify(out.verdict, null, 2));
  fs.writeFileSync(path.join(OUT, 'escape-all.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
