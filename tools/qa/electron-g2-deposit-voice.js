// G2 (Goal 23) — DOES THE MONEY GOING INTO THE DRAWER HAVE ITS OWN VOICE?
//
// WHAT THE OLD CHECK MEASURED: nothing measured this at all. The register's
// deposit site fired `billHandle`/`coinHandle` — the sound of money being MOVED
// IN THE HAND — and no check ever asked which cue a deposit plays, so "I still
// cannot hear the cash going in" survived two rounds against a green suite.
//
// Two claims, and a peak level cannot separate either of them, so this measures
// the ENVELOPE: peak, and how long the cue stays above a floor. A 55 ms landing
// and a 135 ms rustle differ in duration whatever their peaks do.
//
//   1. ITS OWN VOICE — billDeposit must not sound like billHandle.
//   2. IT STACKS — billDeposit(0) must not sound like billDeposit(1), because
//      the first note lands on wood and the tenth lands on nine notes.
//
// Control: silence. And every cue is fired eight times per window, because one
// shot of a 55 ms decay sampled on animation frames is luck, not a level (G1
// measured the same cue at -33.7 and -29.4 dBFS on consecutive runs).
//
//   node tools/qa/run-electron.cjs tools/qa/electron-g2-deposit-voice.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/g2-deposit-voice');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  await page.waitForFunction(() => !!document.querySelector('.menu-screen button'), null, { timeout: 180000 });
  await page.waitForTimeout(1000);
  const first = await page.$('.menu-screen button:not([disabled])');
  if (first) await first.click();
  await page.waitForTimeout(900);

  out.installed = await page.evaluate(() => {
    const app = window.__fw;
    if (!app?.audio?.qaMasterTap) return { ok: false, why: 'qaMasterTap not on the audio surface' };
    try {
      window.__g2tap = app.audio.qaMasterTap();
      return { ok: true, state: window.__g2tap.read().state };
    } catch (e) { return { ok: false, why: String(e.message || e) }; }
  });
  if (!out.installed.ok) {
    fs.writeFileSync(path.join(OUT, 'deposit-voice.json'), `${JSON.stringify(out, null, 2)}\n`);
    console.log('G2', JSON.stringify(out, null, 2));
    return out;
  }

  // Fire one cue and record its whole envelope at animation-frame resolution.
  const envelope = (cue, arg) => page.evaluate(([name, a]) => new Promise((resolve) => {
    const samples = [];
    const t0 = performance.now();
    const tick = () => {
      samples.push(window.__g2tap.read().peak);
      if (performance.now() - t0 < 420) requestAnimationFrame(tick);
      else {
        const peak = samples.reduce((m, v) => Math.max(m, v), 0);
        const floor = Math.max(0.004, peak * 0.18);
        const audible = samples.filter((v) => v > floor).length;
        resolve({
          peak: +peak.toFixed(5),
          // frames above 18% of the peak: a duration, in units the tap can see
          audibleFrames: audible,
          rms: +Math.sqrt(samples.reduce((s, v) => s + v * v, 0) / samples.length).toFixed(5),
        });
      }
    };
    requestAnimationFrame(tick);
    try { window.__fw.audio[name](a); } catch { /* the envelope reports silence */ }
  }), [cue, arg]);

  // Eight shots of each, keeping the strongest, so sampling luck cannot decide.
  const measure = async (cue, arg) => {
    let best = { peak: 0, audibleFrames: 0, rms: 0 };
    for (let i = 0; i < 8; i += 1) {
      const e = await envelope(cue, arg);
      if (e.peak > best.peak) best = e;
      await page.waitForTimeout(90);
    }
    return best;
  };

  out.silence = await page.evaluate(() => new Promise((resolve) => {
    const samples = [];
    const t0 = performance.now();
    const tick = () => {
      samples.push(window.__g2tap.read().peak);
      if (performance.now() - t0 < 500) requestAnimationFrame(tick);
      else resolve(+samples.reduce((m, v) => Math.max(m, v), 0).toFixed(5));
    };
    requestAnimationFrame(tick);
  }));

  out.cues = {
    billHandle: await measure('billHandle'),
    billDepositEmpty: await measure('billDeposit', 0),
    billDepositFull: await measure('billDeposit', 1),
    coinHandle: await measure('coinHandle'),
    coinDepositEmpty: await measure('coinDeposit', 0),
    coinDepositFull: await measure('coinDeposit', 1),
  };

  const dbfs = (v) => (v > 0 ? +(20 * Math.log10(v)).toFixed(1) : null);
  out.measured = Object.fromEntries(Object.entries(out.cues).map(([k, v]) => [k, {
    ...v, dbfs: dbfs(v.peak),
  }]));

  const differ = (a, b) => Math.abs(a.peak - b.peak) / Math.max(a.peak, b.peak, 1e-6) > 0.12
    || Math.abs(a.audibleFrames - b.audibleFrames) >= 2;
  out.checks = {
    tapHearsSomething: out.cues.billDepositEmpty.peak - out.silence > 0.004,
    silenceIsQuiet: out.silence < 0.01,
    // 1. its own voice
    billDepositIsNotBillHandle: differ(out.cues.billDepositEmpty, out.cues.billHandle),
    coinDepositIsNotCoinHandle: differ(out.cues.coinDepositEmpty, out.cues.coinHandle),
    // 2. it stacks
    billDepositStacks: differ(out.cues.billDepositEmpty, out.cues.billDepositFull),
    coinDepositStacks: differ(out.cues.coinDepositEmpty, out.cues.coinDepositFull),
    noPageErrors: out.errs.length === 0,
  };
  out.ok = Object.values(out.checks).every(Boolean);
  fs.writeFileSync(path.join(OUT, 'deposit-voice.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('G2', JSON.stringify({ silence: out.silence, measured: out.measured, checks: out.checks }, null, 2));
  return out;
}
