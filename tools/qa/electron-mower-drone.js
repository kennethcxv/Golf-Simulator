// 1.6 (Goal 26) — IS THE MOWER A DRONE OR A MACHINE THAT PASSES?
//
// The first version of this check measured the master bus after the load veil
// dropped and reported no drone. Both halves of that were wrong in ways worth
// recording, because both are shapes already on the ledger:
//
//  * it read `state.golfDay.minuteOfDay`, which does not exist -- the clock is
//    `state.clock.minutes` through calendarOf(). The probe printed
//    `minuteOfDay: null` and carried on, and null is indistinguishable from the
//    dawn hour it was hunting (shape 10).
//  * the owner says "on LOAD"; it sampled after `walk.isActive()` and the veil
//    were both true, which is minutes of game time later, and the QA boot starts
//    the player INDOORS where the mower gate is shut by design (shape 11).
//
// So this asks the audio module for the gain node itself, drives the real clock
// across the mowing window, and puts the player OUTDOORS where the gate can open.
// A drone holds the gain up continuously; a pass raises it and puts it back down.
// The statistic that separates them is the DUTY CYCLE -- what fraction of samples
// have the mower gain open -- and a drone reads ~1.0 where a pass reads well under.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-mower-drone.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/mower-drone');
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
  await page.waitForTimeout(3000);

  out.ready = await page.evaluate(() => ({
    hasQaAmbient: typeof window.__fw?.audio?.qaAmbient === 'function',
    clockMinutes: window.__fw?.state?.clock?.minutes ?? null,
  }));
  console.log('READY', JSON.stringify(out.ready));
  if (!out.ready.hasQaAmbient) { console.log('ABORTED: no qaAmbient on the audio surface'); return out; }

  // PUT THE PLAYER OUTDOORS AND THE CLOCK IN THE MOWING WINDOW. Indoors the gate
  // is shut by design, so measuring there proves nothing about the drone; and the
  // window is 05:00-07:00, which is where a new game starts.
  out.staged = await page.evaluate(() => {
    const app = window.__fw;
    const s3 = app.scene3d;
    const ch = s3.clubhouse();
    // walk well clear of the building so isInShop goes false
    const c = ch.interior.position;
    const w = s3.walk.state;
    w.x = c.x + 34; w.z = c.z + 34; w.vx = 0; w.vz = 0;
    // 06:00 — the hour a new game starts, inside the 300..420 mowing window
    const day = Math.floor(app.state.clock.minutes / 1440);
    app.state.clock.minutes = day * 1440 + 360;
    return {
      clockMinutes: app.state.clock.minutes,
      inside: ch.isInside(w.x, w.z),
    };
  });
  console.log('STAGED', JSON.stringify(out.staged));

  // Watch the gain node itself for a good long stretch. audio.update runs about
  // once a second, so 90 s of wall clock is ~90 gate evaluations -- long enough
  // for several passes and the gaps between them.
  const watch = async (label, seconds) => {
    const r = await page.evaluate(async ({ secs }) => {
      const t0 = performance.now();
      const rows = [];
      await new Promise((resolve) => {
        const tick = () => {
          const a = window.__fw.audio.qaAmbient();
          if (a) rows.push({ t: +((performance.now() - t0) / 1000).toFixed(2), g: a.mowerGain, on: a.mowerOn, win: a.inMowWindow, inShop: a.inShop, min: a.minuteOfDay });
          if (performance.now() - t0 >= secs * 1000) resolve();
          else setTimeout(tick, 250);
        };
        tick();
      });
      return rows;
    }, { secs: seconds });
    const audible = r.filter((x) => (x.g ?? 0) > 0.002);
    const row = {
      label,
      samples: r.length,
      inWindow: r.filter((x) => x.win).length,
      inShopSamples: r.filter((x) => x.inShop).length,
      audibleSamples: audible.length,
      dutyCycle: r.length ? +(audible.length / r.length).toFixed(3) : null,
      maxGain: r.reduce((m, x) => Math.max(m, x.g ?? 0), 0),
      minuteOfDay: r.length ? r[0].min : null,
      firstAudibleAtSec: audible.length ? audible[0].t : null,
    };
    out[label] = { row, series: r.filter((_, i) => i % 4 === 0) };
    console.log('WATCH', JSON.stringify(row));
    return row;
  };

  const observed = await watch('outdoors_at_0600', 100);

  out.verdict = {
    // A drone is on for essentially every sample it is allowed to be on for.
    // A machine that passes is not.
    readsAsDrone: observed.inWindow > 10 && observed.dutyCycle !== null && observed.dutyCycle > 0.9,
    dutyCycle: observed.dutyCycle,
    firstAudibleAtSec: observed.firstAudibleAtSec,
    nothingSustainedOnLoad: observed.firstAudibleAtSec === null || observed.firstAudibleAtSec > 10,
    maxGain: observed.maxGain,
    inWindowSamples: observed.inWindow,
  };
  fs.writeFileSync(path.join(OUT, 'mower-drone.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('MOWER-DRONE', JSON.stringify(out.verdict, null, 2));
  return out;
}
