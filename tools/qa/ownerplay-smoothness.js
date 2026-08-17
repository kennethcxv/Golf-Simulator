// SUSTAINED SMOOTHNESS + THE SMALLER ONES — one boot, three measurements,
// real input, sim live, no pins, owner resolution:
//   1. frame time WHILE WALKING (20 s of held W with turns): median and p95;
//   2. Tab round trip: from Tab-back press to the first frame the player's
//      held W actually MOVES them (his "3 s before I can move");
//   3. the ledger page turn: the E path, frame gap around turnPage.
//
//   node tools/qa/run-electron.cjs tools/qa/ownerplay-smoothness.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/ownerplay');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  const boot = await import(`file:///${bootPath}`);
  await boot.clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(6000);
  await boot.ownerResolution(page, page.electronApp);
  await page.waitForTimeout(1000);

  const vp = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  await page.mouse.click(vp.w / 2, vp.h / 2);
  await page.waitForTimeout(500);

  // ---- 1. sustained walking frame time -----------------------------------------
  await page.evaluate(() => {
    const S = { deltas: [], last: performance.now(), on: true };
    window.__smooth = S;
    const tick = () => {
      if (!S.on) return;
      const now = performance.now();
      S.deltas.push(now - S.last);
      S.last = now;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  // a real 20 s walk: W held, quarter yaw turns so the view sweeps the room
  await page.keyboard.down('w');
  for (let leg = 0; leg < 4; leg += 1) {
    await page.waitForTimeout(5000);
    await page.evaluate(() => {
      const w = window.__fw.scene3d.walk;
      if (w.state) w.state.yaw += Math.PI / 2;
    });
  }
  await page.keyboard.up('w');
  out.walking = await page.evaluate(() => {
    const S = window.__smooth;
    S.on = false;
    const d = S.deltas.slice(5).sort((a, b) => a - b);
    const at = (q) => +d[Math.floor(d.length * q)].toFixed(1);
    return {
      frames: d.length,
      medianMs: at(0.5),
      p95Ms: at(0.95),
      p99Ms: at(0.99),
      worstMs: +d[d.length - 1].toFixed(1),
      fpsMedian: +(1000 / at(0.5)).toFixed(0),
    };
  });

  // ---- 2. Tab round trip to first movement -------------------------------------
  await page.keyboard.press('Tab');
  await page.waitForTimeout(2500);
  const tabBack = await page.evaluate(() => {
    window.__tabBackAt = performance.now();
    const w = window.__fw.scene3d.walk;
    window.__posAtTabBack = w.state ? { x: w.state.x, z: w.state.z } : null;
    return true;
  });
  void tabBack;
  await page.keyboard.press('Tab');
  await page.keyboard.down('w');
  const moveLatency = await page.evaluate(async () => {
    const t0 = window.__tabBackAt;
    const w = window.__fw.scene3d.walk;
    const start = window.__posAtTabBack;
    const deadline = performance.now() + 15000;
    while (performance.now() < deadline) {
      if (w.state && Math.hypot(w.state.x - start.x, w.state.z - start.z) > 0.08) {
        return +(performance.now() - t0).toFixed(0);
      }
      await new Promise((r) => requestAnimationFrame(r));
    }
    return -1;
  });
  await page.keyboard.up('w');
  out.tabBackToMovementMs = moveLatency;

  // ---- 3. the ledger page turn ---------------------------------------------------
  out.pageTurn = await page.evaluate(async () => {
    const lb = window.__fw.scene3d?.clubhouse?.()?.ledgerBook;
    if (!lb?.advance || !lb?.turnPage) return 'no book api';
    const t0 = performance.now();
    let advanced = 0;
    while (!lb.isOpen() && performance.now() - t0 < 8000) {
      if (performance.now() - t0 > advanced * 700) { lb.advance(); advanced += 1; }
      await new Promise((r) => requestAnimationFrame(r));
    }
    if (!lb.isOpen()) return 'book did not open';
    // measure the worst frame across the turn
    let last = performance.now();
    let worst = 0;
    let done = false;
    const sample = () => {
      const now = performance.now();
      worst = Math.max(worst, now - last);
      last = now;
      if (!done) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
    const turned = lb.turnPage(1);
    await new Promise((r) => setTimeout(r, 1200));
    done = true;
    return { turned, worstFrameMs: +worst.toFixed(0) };
  });

  console.log(JSON.stringify(out, null, 2));
  fs.writeFileSync(path.join(OUT, 'smoothness.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
