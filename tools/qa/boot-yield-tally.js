// WAS THIS BOOT CARRIED BY THE COMPOSITOR OR BY THE FALLBACK TIMER?
//
// prewarm yields between phases. Each yield is now a race between a frame and
// a short timer (src/core/veilFrame.js). Which one wins is the single fact
// that separates "the boot is doing 10 seconds of work" from "the boot is
// waiting on a compositor that produces one frame a second": a boot with a
// large `timer` count was throttled, one with none was not.
//
//   QA_ELECTRON_USER_DATA_DIR=<dir> node tools/qa/run-electron.cjs tools/qa/boot-yield-tally.js --clubhouse=pine-hills-v2
//
// THE CONTROL is the tally's own arithmetic: frame + timer must equal the
// number of yields, and the time attributed to yields cannot exceed the veil.
// A tally that claims more waiting than the boot lasted is reading a previous
// boot's global, which is exactly how a stale __fw* object lies.
async (page) => {
  const boot = await import(`file:///${process.cwd().split(String.fromCharCode(92)).join('/')}/tools/qa/lib/qa-boot.mjs`);
  const t0 = Date.now();
  await boot.clickThroughMenu(page);
  await page.waitForFunction(() => typeof window.__fwBoot?.veilLiftedMs === 'number', null, { timeout: 300000 });
  const veil = Date.now() - t0;
  const r = await page.evaluate(() => ({
    ticks: window.__fwVeilTicks ? { ...window.__fwVeilTicks } : null,
    prewarmMs: (window.__fwBoot?.stageTable || []).find((s) => s.stage === 'prewarm')?.ms ?? null,
    veilLiftedMs: window.__fwBoot?.veilLiftedMs ?? null,
  }));
  const t = r.ticks || { frame: 0, timer: 0, ms: 0 };
  const yields = t.frame + t.timer;
  const failures = [];
  if (!r.ticks) failures.push('no tally at all — prewarm did not run, or this build predates the yield race');
  if (r.veilLiftedMs != null && t.ms > r.veilLiftedMs) {
    failures.push(`the tally claims ${t.ms} ms of yielding inside a ${r.veilLiftedMs} ms veil — stale global`);
  }
  console.log(`veil ${veil} ms   prewarm ${r.prewarmMs} ms`);
  console.log(`yields ${yields}: ${t.frame} carried by a frame, ${t.timer} by the fallback timer`);
  console.log(`time spent in yields: ${t.ms} ms   (${r.veilLiftedMs ? (100 * t.ms / r.veilLiftedMs).toFixed(1) : '?'}% of the veil)`);
  console.log(t.timer > 0
    ? 'VERDICT: the compositor was NOT keeping up — without the race these yields cost ~1 s each'
    : 'VERDICT: every yield got a real frame — this boot was not compositor-limited');
  for (const f of failures) console.log('FAIL:', f);
  console.log(`failures: ${failures.length}`);
  return { veil, ...r, yields, failures };
}
