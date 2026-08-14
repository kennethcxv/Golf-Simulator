// PHASE 3.5 (Goal 25) — THE LEDGER UI, VERIFIED AGAINST THE RECOVERED I3 LIST.
//
// The brief says recover the requirements from the repo rather than invent them.
// Goal 22 I3 (carried from Goal 20) is the source and it is one sentence:
//
//   "The whole interface: what a page shows, how sections are found, the type,
//    the hierarchy. Obvious at a glance where you are and how to get anywhere
//    else."
//
// Goal 25 says the two halves of that sentence are CLOSED and lists what is left
// to verify. Ten properties. Six of them are structural and are measured here;
// four need an eye and are answered by photographing the page canvas itself
// rather than by a driver pretending to judge type.
//
// THE PAGE IS PHOTOGRAPHED THROUGH ledgerBook.pageCanvas(side), which exists for
// exactly this reason: a Goal 23 driver that traversed the scene for canvas
// textures found six and none of them was the ledger (the largest was the floor
// grime map). A probe that hunts the scene graph finds the wrong thing and then
// reports on it.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-p35-ledger-ui.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/p35-ledger-ui');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [], notes: [] };
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
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(600);

  const book = () => page.evaluate(() => {
    const b = window.__fw.scene3d?.clubhouse?.()?.ledgerBook;
    if (!b) return null;
    const d = b.diagnostics?.() || {};
    return {
      state: d.state, open: d.open, spread: d.spread, spreadCount: d.spreadCount,
      pageCount: d.pageCount, sections: d.sections, turning: d.turning,
      paintStats: d.paintStats,
    };
  });

  // OPEN IT THE WAY A PLAYER DOES. K raises it, E swings the cover; once it is
  // up, ledgerKeyHandler owns the keyboard and K is not in that handler.
  await page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse();
    const r = ch?.ledgerBook?.root;
    if (!r) return;
    r.updateWorldMatrix(true, false);
    const e = r.matrixWorld.elements;
    const w = window.__fw.scene3d.walk.state;
    const c = ch.interior.position;
    let dx = c.x - e[12]; let dz = c.z - e[14];
    const d = Math.hypot(dx, dz) || 1; dx /= d; dz /= d;
    w.x = e[12] + dx * 1.9; w.z = e[14] + dz * 1.9; w.vx = 0; w.vz = 0;
    const lx = e[12] - w.x; const lz = e[14] - w.z;
    const h = Math.hypot(lx, lz) || 0.001;
    w.yaw = Math.atan2(-lx / h, -lz / h);
    w.pitch = Math.atan2(e[13] - 1.62, h);
  });
  await page.waitForTimeout(1000);
  await page.keyboard.press('k');
  await page.waitForTimeout(1600);
  await page.keyboard.press('e');
  await page.waitForTimeout(1800);

  const opened = await book();
  out.opened = opened;
  if (!opened?.open) {
    out.verdict = 'UNMEASURED — the book did not open';
    out.ok = false;
    fs.writeFileSync(path.join(OUT, 'ui.json'), `${JSON.stringify(out, null, 2)}\n`);
    console.log('P35', JSON.stringify(out, null, 2));
    return out;
  }

  // ---- 1. navigation to every section, and no dead ends --------------------
  //
  // "No dead ends" is measured as: from every section, a forward turn still
  // moves. A section you can reach and cannot leave is the dead end this clause
  // is about, and it is invisible to a check that only asks "did goToSection
  // land".
  const sections = (opened.sections || []).map((s) => s.id);
  out.sections = sections;

  // WAIT FOR THE TURN TO SETTLE, AND JUDGE BY THE SPREAD, NOT THE RETURN VALUE.
  //
  // turnPage() starts a LEAF_SECONDS (0.55 s) animation; `spread` does not move
  // until it lands, and the return value is "did I accept the request", not "did
  // the page turn". Reading either immediately made every section look like a
  // dead end -- six of seven scored forwardMoved:false and backMoved:false on a
  // book whose pages turn perfectly well. That would have been a fabricated
  // finding against working navigation.
  const settle = async (ms = 2500) => {
    const t0 = Date.now();
    for (;;) {
      const turning = await page.evaluate(() => !!window.__fw.scene3d.clubhouse().ledgerBook.diagnostics().turning);
      if (!turning || Date.now() - t0 > ms) break;
      await page.waitForTimeout(80);
    }
    await page.waitForTimeout(150);
  };
  const spreadNow = () => page.evaluate(() => window.__fw.scene3d.clubhouse().ledgerBook.diagnostics().spread);
  const turnAndSee = async (direction) => {
    const before = await spreadNow();
    await page.evaluate((d) => window.__fw.scene3d.clubhouse().ledgerBook.turnPage(d), direction);
    await settle();
    const after = await spreadNow();
    return { before, after, moved: after !== before };
  };

  const visits = [];
  for (const id of sections) {
    const landed = await page.evaluate((sid) => {
      const b = window.__fw.scene3d.clubhouse().ledgerBook;
      const ok = b.goToSection?.(sid);
      const d = b.diagnostics?.() || {};
      return { requested: sid, accepted: !!ok, spread: d.spread, locked: (d.sections || []).find((s) => s.id === sid)?.locked ?? null };
    }, id);
    await settle();
    const landedSpread = await spreadNow();
    const fwd = await turnAndSee(1);
    const back = await turnAndSee(-1);
    visits.push({
      ...landed,
      landedSpread,
      forward: fwd,
      back,
      forwardMoved: fwd.moved,
      backMoved: back.moved,
      // at the last spread forward CANNOT move and that is correct, not a dead
      // end -- the dead end is a spread you can reach and cannot leave at all
      atEndOfBook: !fwd.moved && back.moved,
      restored: back.after,
    });
  }
  out.visits = visits;

  // ---- 2. consistent turn direction ----------------------------------------
  // forward must raise the spread index and back must lower it, everywhere.
  await page.evaluate(() => window.__fw.scene3d.clubhouse().ledgerBook.goToPage?.(1));
  await settle();
  const dir = [];
  for (let i = 0; i < 5; i += 1) dir.push({ ...(await turnAndSee(1)), dir: 1 });
  for (let i = 0; i < 5; i += 1) dir.push({ ...(await turnAndSee(-1)), dir: -1 });
  out.turnDirection = dir;

  // ---- 3. state persistence across a close and reopen ----------------------
  const persist = await page.evaluate(async () => {
    const b = window.__fw.scene3d.clubhouse().ledgerBook;
    b.goToPage?.(6);
    await new Promise((r) => setTimeout(r, 700));
    const before = b.diagnostics().spread;
    return { before };
  });
  await page.keyboard.press('q');
  await page.waitForTimeout(2200);
  await page.keyboard.press('k');
  await page.waitForTimeout(1600);
  await page.keyboard.press('e');
  await page.waitForTimeout(1800);
  const reopened = await book();
  out.persistence = { spreadBeforeClose: persist.before, spreadAfterReopen: reopened?.spread ?? null };

  // ---- 4. no lag from page generation --------------------------------------
  // paintStats is the module's own record of what a turn paid at the turn frame
  // versus in the deferred slots. Rising deferred work across many turns is the
  // "page generation inside an animation frame" this clause is about.
  const before = await book();
  await page.evaluate(async () => {
    const b = window.__fw.scene3d.clubhouse().ledgerBook;
    for (let i = 0; i < 20; i += 1) {
      b.turnPage(i % 2 === 0 ? 1 : -1);
      await new Promise((r) => setTimeout(r, 220));
    }
  });
  await page.waitForTimeout(900);
  const afterTurns = await book();
  out.paint = { before: before?.paintStats ?? null, after: afterTurns?.paintStats ?? null };

  // ---- 5. PHOTOGRAPH THE PAGE. type, hierarchy, selected state -------------
  const shots = await page.evaluate(() => {
    const b = window.__fw.scene3d.clubhouse().ledgerBook;
    const grab = (side) => {
      const c = b.pageCanvas?.(side);
      return c ? c.toDataURL('image/png') : null;
    };
    return { left: grab('left'), right: grab('right'), w: b.pageCanvas?.('left')?.width ?? null, h: b.pageCanvas?.('left')?.height ?? null };
  });
  for (const side of ['left', 'right']) {
    if (shots[side]) {
      fs.writeFileSync(path.join(OUT, `page-${side}.png`),
        Buffer.from(shots[side].split(',')[1], 'base64'));
    }
  }
  out.pageCanvas = { width: shots.w, height: shots.h, wrote: ['left', 'right'].filter((s) => shots[s]) };
  await page.screenshot({ path: path.join(OUT, 'open-spread-in-world.png') });

  const reached = visits.filter((v) => v.accepted).length;
  out.clauses = {
    everySectionReachable: sections.length > 0 && reached === sections.length,
    noDeadEnds: visits.length > 0 && visits.every((v) => v.forwardMoved || v.backMoved),
    backAndForwardBothWork: visits.some((v) => v.forwardMoved) && visits.some((v) => v.backMoved),
    turnDirectionConsistent: dir.length > 0
      && dir.filter((r) => r.dir === 1).every((r) => r.after >= r.before)
      && dir.filter((r) => r.dir === -1).every((r) => r.after <= r.before),
    statePersistsAcrossClose: out.persistence.spreadAfterReopen === out.persistence.spreadBeforeClose,
    pageIsPhotographable: out.pageCanvas.wrote.length === 2,
  };
  out.notScored = 'section identity, readable hierarchy, type, selected/hover states — page-left.png and page-right.png are for those, and a human has to look';
  out.ok = Object.values(out.clauses).every((v) => v === true) && out.errs.length === 0;
  fs.writeFileSync(path.join(OUT, 'ui.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('P35', JSON.stringify({
    sections, clauses: out.clauses, persistence: out.persistence,
    paint: out.paint, pageCanvas: out.pageCanvas, ok: out.ok,
  }, null, 2));
  return out;
}
