// ONE WINDOW, FOUR DISPLAY STATES: the mid-session compositor experiment.
//
// compositor-ambient-probe answers "what is the state now"; this one holds a
// single Electron session open while the operator flips the display around it:
//
//   window A  0-4 s     as launched (expected healthy)
//   window B  ~14 s     after the operator turns the display off (SC_MONITORPOWER)
//   window C  ~30 s     after the operator starts a SetThreadExecutionState
//                       ES_DISPLAY_REQUIRED keeper, WITHOUT any input
//   window D  ~46 s     after the operator injects one real key
//
// Same window, same process, same page the whole time -- if rAF collapses in B
// and recovers in D, the display link is the whole mechanism and nothing in
// the app is. C tests whether a power request alone can restore it, which is
// what a harness keeper would rely on.
//
// The recorder windows are timed by setTimeout, which the throttle does not
// touch (that asymmetry IS the instrument), so every window completes in wall
// time regardless of state.
//
//   node tools/qa/run-electron.cjs tools/qa/compositor-flip-probe.js --clubhouse=pine-hills-v2
//   ...and drive the display from a second shell on the printed schedule.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const OUT = 'qa/compositor-state';
  fs.mkdirSync(OUT, { recursive: true });

  const record = (label, ms) => page.evaluate(async ([l, durationMs]) => {
    const rec = { raf: [], timer: [] };
    let lr = 0; let lt = 0;
    let stop = false;
    const rafLoop = () => {
      const t = performance.now();
      if (lr) rec.raf.push(t - lr);
      lr = t;
      if (!stop) requestAnimationFrame(rafLoop);
    };
    requestAnimationFrame(rafLoop);
    const timerLoop = () => {
      const t = performance.now();
      if (lt) rec.timer.push(t - lt);
      lt = t;
      if (!stop) setTimeout(timerLoop, 0);
    };
    setTimeout(timerLoop, 0);
    await new Promise((r) => { setTimeout(r, durationMs); });
    stop = true;
    const stat = (a) => {
      if (!a.length) return { n: 0, median: null, max: null };
      const v = a.slice().sort((x, y) => x - y);
      return {
        n: a.length,
        median: +v[Math.floor(v.length / 2)].toFixed(1),
        max: +v[v.length - 1].toFixed(1),
      };
    };
    return { label: l, raf: stat(rec.raf), timer: stat(rec.timer) };
  }, [label, ms]);

  const rows = [];
  const step = async (label, waitBeforeMs) => {
    if (waitBeforeMs) await page.waitForTimeout(waitBeforeMs);
    const r = await record(label, 4000);
    rows.push(r);
    console.log(`  ${label.padEnd(30)} raf n=${String(r.raf.n).padStart(5)} median ${String(r.raf.median).padStart(8)}`
      + `   timer n=${String(r.timer.n).padStart(5)} median ${String(r.timer.median).padStart(6)}`);
    return r;
  };

  // HANDSHAKE BY FLAG FILE, NOT BY SLEEP. The first cut used a fixed schedule
  // and the operator's display-off landed nowhere provable; every window read
  // healthy and certified nothing. Now the driver WAITS for the operator's
  // flag before each window, so a window's condition is exactly the flag that
  // released it.
  const path = process.getBuiltinModule('node:path');
  const FLAGS = path.join(process.cwd(), OUT);
  const waitForFlag = async (name, timeoutMs) => {
    const file = path.join(FLAGS, name);
    const t0 = Date.now();
    while (!fs.existsSync(file)) {
      if (Date.now() - t0 > timeoutMs) throw new Error(`flag ${name} never appeared`);
      await new Promise((r) => { setTimeout(r, 250); });
    }
  };
  for (const f of ['flag-off', 'flag-keeper', 'flag-key']) {
    try { fs.unlinkSync(path.join(FLAGS, f)); } catch { /* not there */ }
  }
  fs.writeFileSync(path.join(FLAGS, 'flag-ready'), 'ready');
  const a = await step('A as launched', 0);
  console.log('WAITING for flag-off');
  await waitForFlag('flag-off', 120000);
  const b = await step('B display off', 3000);
  console.log('WAITING for flag-keeper');
  await waitForFlag('flag-keeper', 120000);
  const c = await step('C keeper, no input', 3000);
  console.log('WAITING for flag-key');
  await waitForFlag('flag-key', 120000);
  const d = await step('D after one real key', 3000);

  const throttledB = b.raf.median == null || b.raf.median > 400;
  const healthyA = a.raf.median != null && a.raf.median < 50;
  const healthyD = d.raf.median != null && d.raf.median < 50;
  console.log('');
  console.log(`A healthy: ${healthyA}   B throttled: ${throttledB}   C recovered: ${c.raf.median != null && c.raf.median < 50}   D healthy: ${healthyD}`);

  fs.appendFileSync(`${OUT}/flip-log.jsonl`, `${JSON.stringify({ at: new Date().toISOString(), rows })}\n`);
  return { rows };
}
