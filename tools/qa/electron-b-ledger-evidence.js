// B — THE LEDGER'S FIVE DEFECTS, STAGED AND RECORDED IN ONE RUN.
//
//   B1 cover lettering: closed-cover screenshot to read the title direction
//   B2 open framing: full-frame screenshot of the open spread
//   B4 the one bare-page frame: 640-wide canvas grabs EVERY rAF for ~40
//      frames around each E press (a 5 fps screenshot loop cannot catch a
//      1-frame glitch; an in-page rAF grab can)
//   B5 the double set-down: bookState + stateT sampled every frame through
//      the whole put-away; a state that repeats or a stateT that rewinds is
//      the double-run, measured
//
//   node tools/qa/run-electron.cjs tools/qa/electron-b-ledger-evidence.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/b-ledger');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.bringToFront().catch(() => {});
  await page.waitForTimeout(3000);

  // Stand 1.2 m from the book, looking at it.
  await page.evaluate(() => {
    const fw = window.__fw;
    const ch = fw.scene3d.clubhouse();
    const st = fw.scene3d.walk.state;
    let lp = ch.ledgerBook.position;
    if (typeof lp === 'function') lp = ch.ledgerBook.position();
    const ip = ch.interior.position;
    const book = { x: ip.x + lp.x, z: ip.z + lp.z };
    const to = { x: ip.x - book.x, z: ip.z - book.z };
    const len = Math.hypot(to.x, to.z) || 1;
    st.x = book.x + (to.x / len) * 1.2;
    st.z = book.z + (to.z / len) * 1.2;
    const dx = book.x - st.x;
    const dz = book.z - st.z;
    const h = Math.hypot(dx, dz) || 0.001;
    st.yaw = Math.atan2(-dx / h, -dz / h);
    st.pitch = -0.45; // down at the desk (negative = down in this rig)
    fw.speedIdx = 0;
    fw.state.clock.minutes = Math.floor(fw.state.clock.minutes / 1440) * 1440 + 14 * 60;
    ch.ledgerBook.prewarm?.();
  });
  await page.waitForTimeout(1200);
  const canvas = await page.$('#game');
  await (canvas || page).screenshot({ path: path.join(OUT, 'b1-closed-cover.png') });

  // rAF frame grabber: N frames at 640w into dataURLs, then dumped to disk.
  const grabFrames = (n) => page.evaluate((count) => new Promise((res) => {
    const src = document.getElementById('game');
    const w = 640;
    const h = Math.round(src.height / src.width * 640);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    const frames = [];
    const tick = () => {
      ctx.drawImage(src, 0, 0, w, h);
      frames.push(c.toDataURL('image/png'));
      if (frames.length < count) requestAnimationFrame(tick);
      else res(frames);
    };
    requestAnimationFrame(tick);
  }), n);
  const saveFrames = (frames, prefix) => {
    frames.forEach((d, i) => {
      fs.writeFileSync(path.join(OUT, `${prefix}-${String(i).padStart(2, '0')}.png`), Buffer.from(d.split(',')[1], 'base64'));
    });
  };

  const stateTrace = (ms) => page.evaluate((dur) => new Promise((res) => {
    const book = window.__fw.scene3d.clubhouse().ledgerBook;
    const rows = [];
    const t0 = performance.now();
    const tick = () => {
      const d = book.diagnostics();
      rows.push({ t: +(performance.now() - t0).toFixed(0), state: d.state, stateT: +(d.stateT ?? -1).toFixed?.(3) ?? -1 });
      if (performance.now() - t0 < dur) requestAnimationFrame(tick);
      else res(rows);
    };
    requestAnimationFrame(tick);
  }), ms);

  // FIRST press: book rises SHUT.
  const pressE = () => page.keyboard.press('e');
  const grab1 = grabFrames(45);
  await page.waitForTimeout(60);
  await pressE();
  saveFrames(await grab1, 'b4-press1');
  await page.waitForTimeout(700);
  // SECOND press: cover swings open — the reported glitch moment.
  const grab2 = grabFrames(45);
  await page.waitForTimeout(60);
  await pressE();
  saveFrames(await grab2, 'b4-press2');
  await page.waitForTimeout(1400);
  out.openDiag = await page.evaluate(() => window.__fw.scene3d.clubhouse().ledgerBook.diagnostics());
  await (canvas || page).screenshot({ path: path.join(OUT, 'b2-open-spread.png') });

  // Put it back: E closes from open — trace the whole descent.
  const trace = stateTrace(3500);
  await page.waitForTimeout(60);
  await pressE();
  out.closeTrace = await trace;
  await page.waitForTimeout(400);
  await (canvas || page).screenshot({ path: path.join(OUT, 'b5-after-setdown.png') });

  // Compress the trace into state spans for reading.
  const spans = [];
  for (const r of out.closeTrace) {
    const last = spans[spans.length - 1];
    if (!last || last.state !== r.state) spans.push({ state: r.state, from: r.t, to: r.t, tStart: r.stateT, tEnd: r.stateT });
    else { last.to = r.t; last.tEnd = r.stateT; }
  }
  out.closeSpans = spans;

  // B5 second route: X carries the book, Z sets it down.
  await page.waitForTimeout(600);
  await page.keyboard.press('x');
  await page.waitForTimeout(900);
  out.carriedDiag = await page.evaluate(() => window.__fw.scene3d.clubhouse().ledgerBook.diagnostics());
  const trace2 = stateTrace(3500);
  await page.waitForTimeout(60);
  await page.keyboard.press('z');
  out.setdownTrace = await trace2;
  const spans2 = [];
  for (const r of out.setdownTrace) {
    const last = spans2[spans2.length - 1];
    if (!last || last.state !== r.state) spans2.push({ state: r.state, from: r.t, to: r.t });
    else last.to = r.t;
  }
  out.setdownSpans = spans2;
  await (canvas || page).screenshot({ path: path.join(OUT, 'b5-carry-setdown.png') });

  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(out, null, 2));
  console.log('B-LEDGER spans', JSON.stringify(spans));
  console.log('B-LEDGER carry-setdown spans', JSON.stringify(spans2), 'carried:', JSON.stringify(out.carriedDiag?.carried));
  console.log('open state frameFill', out.openDiag?.frameFill, 'framed', JSON.stringify(out.openDiag?.framed));
}
