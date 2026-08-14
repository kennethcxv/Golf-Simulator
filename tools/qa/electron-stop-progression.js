// WHERE DOES A SHOPPER'S ROUTE ACTUALLY GO?
//
// customerPick is never called and `fixtureStopSeen` is 0, so the fixture branch
// of the customer update is never entered -- yet every shopper's route contains
// fixture stops and every shopper ends on `gone`. Something advances stopIdx past
// the fixtures without ever processing them.
//
// This watches ONE customer from the moment of spawn at 20 Hz and prints the
// stopIdx/stopKind sequence. A 100 ms sampler missed the fixtures entirely, which
// is itself a clue: whatever happens to them is fast.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/stop-progression');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const saveDir = path.join(process.env.APPDATA || '', 'GOLF EMPIRE', 'saves');
  const autosave = JSON.parse(fs.readFileSync(path.join(saveDir, 'autosave.json'), 'utf8'));
  const meta = JSON.parse(fs.readFileSync(path.join(saveDir, 'autosave-meta.json'), 'utf8'));
  await page.waitForFunction(() => !!window.fairwayNative?.save, null, { timeout: 120000 });
  await page.waitForTimeout(2500);
  await page.evaluate(async ({ save, saveMeta }) => {
    await window.fairwayNative.save('autosave', save);
    await window.fairwayNative.save('autosave-meta', saveMeta);
  }, { save: autosave, saveMeta: meta });
  await page.reload();
  await page.waitForFunction(() => {
    const b = document.querySelector('.menu-action-primary');
    return !!b && !b.disabled;
  }, null, { timeout: 45000 });
  await page.evaluate(() => document.querySelector('.menu-action-primary').click());
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(6000);

  await page.evaluate(() => {
    const app = window.__fw;
    const day = Math.floor(app.state.clock.minutes / 1440);
    app.state.clock.minutes = day * 1440 + 630;
    const ch = app.scene3d.clubhouse();
    // OPEN THE SIGN. shopAcceptsWalkIns = withinTradingHours && signIsOpen, and
    // when it is false EVERY customer on the floor is routed straight to the exit
    // (clubhouse.js: `if (!open) { ... c.stopIdx = c.stops.length - 2 }`). The save
    // resumes before opening, so my spawned shoppers were evicted 70 ms after
    // arriving -- which is CORRECT behaviour and looked exactly like a navigation
    // fault. debugSpawn does not set `scriptedVisit`, so it gets no exemption.
    if (window.__fw.state?.shop) window.__fw.state.shop.signOpen = true;
    ch.setOrganicWalkins?.(false);
    ch.clearWalkins?.();
  });
  await page.waitForTimeout(500);

  out.trace = await page.evaluate(async () => {
    const ch = window.__fw.scene3d.clubhouse();
    ch.debugSpawn(false);
    const rows = [];
    const t0 = performance.now();
    await new Promise((done) => {
      const tick = () => {
        const list = ch.qaCustomerTrack ? ch.qaCustomerTrack() : [];
        const c = list[0];
        if (c) {
          const last = rows[rows.length - 1];
          // record only CHANGES of stop, plus a heartbeat, so the log reads as a
          // route rather than a wall of identical samples
          if (!last || last.stopIdx !== c.stopIdx || last.stopKind !== c.stopKind) {
            rows.push({
              t: +((performance.now() - t0) / 1000).toFixed(2),
              stopIdx: c.stopIdx,
              stopKind: c.stopKind,
              dist: c.targetDist,
              x: c.x,
              z: c.z,
              route: c.stopKinds,
            });
          }
        }
        if (performance.now() - t0 >= 60000 || (!c && rows.length)) done();
        else setTimeout(tick, 50);
      };
      tick();
    });
    return rows;
  });
  console.log('STOP-TRACE');
  for (const r of out.trace) {
    console.log(`  t=${String(r.t).padStart(6)}s  idx=${r.stopIdx}  kind=${String(r.stopKind).padEnd(8)} dist=${r.dist}  at (${r.x}, ${r.z})`);
  }
  out.route = out.trace[0]?.route ?? null;
  console.log('ROUTE', out.route);
  out.pickStats = await page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse();
    return ch.qaPickStats ? ch.qaPickStats() : null;
  });
  console.log('PICK-STATS', JSON.stringify(out.pickStats));
  fs.writeFileSync(path.join(OUT, 'stop-progression.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
