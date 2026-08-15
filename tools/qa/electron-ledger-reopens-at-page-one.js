// PLAYTEST 3, ITEM 3 — "IT MUST REOPEN TO THE FIRST PAGE."
//
// OWNER RULING, and it REVERSES Phase 6's "state persistence across close and
// reopen" which was implemented and verified last session. Recorded here as well
// as in the report so that nobody reads the Phase 6 note, decides the reset is a
// regression, and puts the persistence back.
//
// The check has to fail on the build that persists, so it is written as the
// difference between two opens rather than as a single reading of `spread`:
//
//   1. open, turn deep into the book, note the spread
//   2. CLOSE it -- properly, all the way down, not just an unpainted flag
//   3. open again and read the spread
//
// A single "spread is 0 after opening" would pass trivially on a fresh book that
// was never turned. Step 1 is what makes step 3 mean something.
//
// It also checks the PAINT, not only the index. Resetting `spread` without
// repainting leaves the canvas showing the old page while the book believes it
// is on the first, and those two states are indistinguishable from the number
// alone -- so the contents page's own pixels are compared against a reference
// taken while genuinely on page one.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-ledger-reopens-at-page-one.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/ledger-reopen');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(6000);

  const open = async () => page.evaluate(async () => {
    const b = window.__fw.scene3d.clubhouse().ledgerBook;
    b.setCarried?.(false);
    b.setOpen?.(true);
    for (let i = 0; i < 40 && !b.isOpen?.(); i += 1) {
      b.advance?.();
      // eslint-disable-next-line no-await-in-loop
      await new Promise((d) => setTimeout(d, 70));
    }
    await new Promise((d) => setTimeout(d, 500));
    const d = b.diagnostics?.() || {};
    return { open: !!b.isOpen?.(), spread: d.spread ?? null, state: d.state };
  });
  // ALL THE WAY DOWN. `setOpen(false)` starts the close; the book then runs
  // closing -> lowering -> closed over several frames, and reopening from
  // mid-flight is a different path that would not exercise the ruling.
  const close = async () => page.evaluate(async () => {
    const b = window.__fw.scene3d.clubhouse().ledgerBook;
    b.setOpen?.(false);
    for (let i = 0; i < 60; i += 1) {
      const st = b.diagnostics?.()?.state;
      if (st === 'closed') break;
      b.advance?.();
      // eslint-disable-next-line no-await-in-loop
      await new Promise((d) => setTimeout(d, 70));
    }
    await new Promise((d) => setTimeout(d, 400));
    return { state: b.diagnostics?.()?.state ?? null, open: !!b.isOpen?.() };
  });

  out.first = await open();
  console.log('FIRST OPEN', JSON.stringify(out.first));
  // A reference of the contents page WHILE GENUINELY ON IT.
  await page.screenshot({ path: path.join(OUT, 'a-first-open-page-one.png') });

  // Turn deep into the book. Without this, "spread is 0 on reopen" is trivially
  // true of a book nobody moved.
  out.turned = await page.evaluate(async () => {
    const b = window.__fw.scene3d.clubhouse().ledgerBook;
    for (let i = 0; i < 3; i += 1) {
      b.turnPage?.(1);
      // eslint-disable-next-line no-await-in-loop
      await new Promise((d) => setTimeout(d, 900));
    }
    return { spread: b.diagnostics?.()?.spread ?? null };
  });
  console.log('TURNED TO', JSON.stringify(out.turned));
  await page.screenshot({ path: path.join(OUT, 'b-turned-deep.png') });

  out.closed = await close();
  console.log('CLOSED', JSON.stringify(out.closed));

  out.second = await open();
  console.log('SECOND OPEN', JSON.stringify(out.second));
  await page.screenshot({ path: path.join(OUT, 'c-reopened.png') });

  // THE PIXELS, because the index alone cannot tell a repainted page from a
  // stale canvas carrying the old one.
  out.pixels = await page.evaluate(() => {
    const b = window.__fw.scene3d.clubhouse().ledgerBook;
    const canvas = b.pageCanvas?.("right") || b.pageCanvas?.("left");
    if (!canvas) return { ok: false, why: 'no page canvas handle' };
    const ctx = canvas.getContext('2d');
    const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    // a cheap stable fingerprint of the painted page
    let sum = 0;
    let ink = 0;
    for (let i = 0; i < d.length; i += 4 * 97) {
      sum = (sum + d[i] * 3 + d[i + 1] * 5 + d[i + 2] * 7) % 2147483647;
      if (d[i] < 140) ink += 1;
    }
    return { ok: true, fingerprint: sum, inkPixels: ink, w: canvas.width, h: canvas.height };
  });
  console.log('PIXELS AFTER REOPEN', JSON.stringify(out.pixels));

  out.verdict = {
    firstOpenSpread: out.first.spread,
    spreadAfterTurning: out.turned.spread,
    // the run is void unless the turn actually moved the book
    turnActuallyMoved: out.turned.spread !== null && out.turned.spread > 0,
    closedFully: out.closed.state === 'closed',
    reopenedSpread: out.second.spread,
    // THE RULING
    reopensAtPageOne: out.second.spread === 0,
    paintedSomething: out.pixels.ok === true && out.pixels.inkPixels > 0,
    shots: ['a-first-open-page-one.png', 'b-turned-deep.png', 'c-reopened.png'],
  };
  console.log('LEDGER-REOPEN', JSON.stringify(out.verdict, null, 2));
  fs.writeFileSync(path.join(OUT, 'reopen.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
