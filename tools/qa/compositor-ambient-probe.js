// IS THE COMPOSITOR DELIVERING FRAMES TO THIS WINDOW, RIGHT NOW?
//
// The cheap end of tools/qa/boot-frame-clock.js: no game boot, no save, just
// the menu window and 3.5 seconds of three queues recorded side by side.
//
//   rAF        waits on the compositor's BeginFrame
//   setTimeout waits on the main thread only
//   port       (MessageChannel) waits on nothing at all
//
// rAF starved while the other two run  -> THROTTLED COMPOSITOR (the machine's
//                                         display state, not the build)
// all three starved together           -> BLOCKED MAIN THREAD (the build)
// none starved                         -> HEALTHY
//
// Exists because boot and interaction numbers taken in the throttled state
// describe the machine, not the game (HARNESS_DEBT #11). Run this BEFORE and
// AFTER any latency measurement session; it costs ~20 seconds.
//
//   node tools/qa/run-electron.cjs tools/qa/compositor-ambient-probe.js --clubhouse=pine-hills-v2
//
// THE CONTROL: a deliberate 300 ms main-thread block during a second recording
// window must show up in the timer queue. A recorder that cannot see a block it
// was handed cannot tell "throttled" from "blocked", and its verdict is void.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const OUT = 'qa/compositor-state';
  fs.mkdirSync(OUT, { recursive: true });

  const record = (ms) => page.evaluate(async (durationMs) => {
    const rec = { raf: [], timer: [], port: [] };
    let lr = 0; let lt = 0; let lp = 0;
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
    const ch = new MessageChannel();
    ch.port1.onmessage = () => {
      const t = performance.now();
      if (lp) rec.port.push(t - lp);
      lp = t;
      if (!stop && rec.port.length < 400000) ch.port2.postMessage(0);
    };
    ch.port2.postMessage(0);
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
    return { raf: stat(rec.raf), timer: stat(rec.timer), port: stat(rec.port) };
  }, ms);

  const main = await record(3500);

  // The control window: same recorder, with 300 ms of real work dropped on the
  // main thread partway through.
  const controlPromise = record(1500);
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    const until = performance.now() + 300;
    while (performance.now() < until) { /* deliberate block */ }
  });
  const control = await controlPromise;

  const failures = [];
  if (!(control.timer.max >= 250)) {
    failures.push(`control: a deliberate 300 ms block showed as ${control.timer.max} ms in the timer queue — recorder is blind, verdict void`);
  }

  let verdict;
  if (main.raf.median == null || main.raf.n < 2) {
    verdict = 'THROTTLED COMPOSITOR (rAF produced almost no callbacks at all)';
  } else if (main.raf.median > 400 && main.timer.median < 50) {
    verdict = 'THROTTLED COMPOSITOR';
  } else if (main.raf.median > 400) {
    verdict = 'BLOCKED MAIN THREAD';
  } else {
    verdict = 'HEALTHY';
  }

  const row = (name, s) => `  ${name.padEnd(6)} n=${String(s.n).padStart(6)}  median ${String(s.median).padStart(8)}  max ${String(s.max).padStart(8)}`;
  console.log('ambient compositor state, 3.5 s at the menu:');
  console.log(row('raf', main.raf));
  console.log(row('timer', main.timer));
  console.log(row('port', main.port));
  console.log(`VERDICT: ${verdict}`);
  for (const f of failures) console.log('FAIL:', f);
  console.log(`failures: ${failures.length}`);

  const out = { at: new Date().toISOString(), main, control, verdict, failures };
  fs.appendFileSync(`${OUT}/ambient-log.jsonl`, `${JSON.stringify(out)}\n`);
  return out;
}
