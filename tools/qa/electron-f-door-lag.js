// F (Goal 21) — THE DOOR LAG, REPRODUCED THE OWNER'S WAY.
//
// WHAT THE CHECK MEASURED AND WHY IT PASSED: tools/qa/doors-performance.js runs
// against http://localhost:8457/ in headless Chrome. It never touched the
// shipped Electron build, never cold-booted, and never had a player walk up to
// a door. run-electron.cjs's own header says three defects have already shipped
// with a green Chrome driver and no effect in the real build. This is the
// fourth.
//
// So: cold boot, real input, default camera, and time the FRAMES.
//
//   1. STILL      3 s standing at spawn, nothing pressed  -> the floor
//   2. CONTROL    walk BACKWARDS, away from the door      -> movement, no door
//   3. APPROACH   walk FORWARDS, up to the door           -> the owner's case
//   4. OPEN       press the interact key, first open      -> the owner's case
//
// The control is the point: if walking away costs the same as walking up to the
// door, the door is not the cause and the answer is "ordinary movement is over
// budget", which is a different bug with a different fix.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-f-door-lag.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/f-door-lag');
  fs.mkdirSync(OUT, { recursive: true });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message || e)));

  await page.setViewportSize({ width: 1600, height: 900 });
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  // COLD. No warm-up lap, no settling walk: the owner's complaint is about the
  // FIRST approach and the FIRST open, and a warm measurement cannot see a
  // first-time cost. Only enough delay for the veil's own fade to finish.
  await page.waitForTimeout(1200);

  await page.evaluate(() => {
    window.__frameLog = [];
    let last = performance.now();
    const tick = (now) => {
      window.__frameLog.push(+(now - last).toFixed(2));
      last = now;
      window.__frameRaf = requestAnimationFrame(tick);
    };
    window.__frameRaf = requestAnimationFrame(tick);
    window.__mark = (label) => window.__frameLog.push(label);
  });

  const mark = (label) => page.evaluate((l) => window.__mark(l), label);
  const hold = async (key, ms) => {
    await page.keyboard.down(key);
    await page.waitForTimeout(ms);
    await page.keyboard.up(key);
  };

  await page.mouse.click(800, 450); // take the look, the player's own gesture
  await page.waitForTimeout(400);

  await mark('still');
  await page.waitForTimeout(3000);

  await mark('control-away');
  await hold('s', 2600); // backwards, away from the door: movement without a door

  await mark('turn');
  await page.waitForTimeout(700);

  await mark('approach');
  await hold('w', 3000); // forwards, up to the door

  await mark('open');
  await page.keyboard.press('e');
  await page.waitForTimeout(2500);

  await mark('end');
  const log = await page.evaluate(() => {
    cancelAnimationFrame(window.__frameRaf);
    return window.__frameLog;
  });
  await page.screenshot({ path: path.join(OUT, 'at-the-door.png') });

  // split the log on the markers
  const phases = {};
  let current = null;
  for (const entry of log) {
    if (typeof entry === 'string') { current = entry; phases[current] = phases[current] || []; continue; }
    if (current) phases[current].push(entry);
  }
  const stat = (frames) => {
    if (!frames || !frames.length) return null;
    const sorted = [...frames].sort((a, b) => a - b);
    const at = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
    return {
      frames: frames.length,
      median: +at(0.5).toFixed(2),
      p95: +at(0.95).toFixed(2),
      worst: +sorted[sorted.length - 1].toFixed(2),
      over33: frames.filter((f) => f > 33).length,
      over100: frames.filter((f) => f > 100).length,
    };
  };
  const out = {
    still: stat(phases.still),
    controlAway: stat(phases['control-away']),
    approach: stat(phases.approach),
    open: stat(phases.open),
    errs,
  };
  // The comparison that decides it. A door cost is approach/open being WORSE
  // than the control by a margin the control's own noise cannot explain.
  const worstControl = out.controlAway?.worst ?? 0;
  out.verdict = {
    approachWorseThanControl: (out.approach?.worst ?? 0) > worstControl * 1.5,
    openWorseThanControl: (out.open?.worst ?? 0) > worstControl * 1.5,
    controlIsItselfOverBudget: (out.controlAway?.over33 ?? 0) > 0,
    approachWorstMs: out.approach?.worst ?? null,
    openWorstMs: out.open?.worst ?? null,
    controlWorstMs: worstControl,
  };
  fs.writeFileSync(path.join(OUT, 'door-lag.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
