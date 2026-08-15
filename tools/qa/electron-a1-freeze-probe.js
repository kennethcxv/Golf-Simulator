// A1 — IS THE INTERIOR MATRIX FREEZE WORTH BUILDING?
//
// The census found 2,611 of 2,853 interior objects recomposing their world
// matrix every frame, in a subtree `freezeShellBranch(group)` never reached.
// Building the safe version - an exemption mark on every animated root across
// six subsystems, plus a driver proving each still moves - is a day of work.
//
// This measures the PRIZE FIRST, and it is deliberately unsafe: it blanket
// freezes the interior, which breaks the ledger, the doors, the register and the
// customers for the length of the probe. Nothing is shipped and nothing is
// saved; the page is thrown away at the end of the run.
//
// NEGATIVE CONTROLS, both needed before the delta means anything:
//   1. the freeze must actually take - count auto-updating objects after it and
//      require the number to collapse. A freeze that silently did nothing would
//      report a delta of zero and read as "not worth it".
//   2. a THIRD sample, taken after un-freezing, must return to the baseline. If
//      frame time drifts on its own across the run, the middle sample is
//      measuring drift rather than the freeze.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/a1-freeze-probe');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.split('\\').join('/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.bringToFront().catch(() => {});
  await page.waitForTimeout(9000);   // let the scene settle before sampling

  // Sample N frames of real rAF timing.
  const sample = (frames) => page.evaluate((n) => new Promise((resolve) => {
    const dts = [];
    let last = performance.now();
    const tick = () => {
      const now = performance.now();
      dts.push(now - last);
      last = now;
      if (dts.length >= n) {
        dts.shift();   // drop the first, it carries the call-in cost
        const sorted = [...dts].sort((a, b) => a - b);
        resolve({
          n: dts.length,
          median: +sorted[Math.floor(sorted.length / 2)].toFixed(2),
          mean: +(dts.reduce((a, b) => a + b, 0) / dts.length).toFixed(2),
          p90: +sorted[Math.floor(sorted.length * 0.9)].toFixed(2),
          worst: +Math.max(...dts).toFixed(1),
          over16: dts.filter((d) => d > 16).length,
        });
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }), frames);

  const countAuto = () => page.evaluate(() => {
    const interior = window.__fw.scene3d.clubhouse?.()?.interior;
    if (!interior) return null;
    let total = 0; let auto = 0;
    const walk = (o) => {
      total += 1;
      if (o.matrixAutoUpdate) auto += 1;
      for (const c of o.children) walk(c);
    };
    walk(interior);
    return { total, auto };
  });

  out.before = { matrices: await countAuto(), frames: await sample(140) };

  // THE UNSAFE PART. Blanket freeze, no exemptions, animation breaks.
  out.frozenApplied = await page.evaluate(() => {
    const interior = window.__fw.scene3d.clubhouse?.()?.interior;
    if (!interior) return 0;
    let n = 0;
    interior.updateMatrixWorld(true);
    const walk = (o) => {
      if (o.matrixAutoUpdate) { o.matrixAutoUpdate = false; n += 1; }
      for (const c of o.children) walk(c);
    };
    walk(interior);
    return n;
  });
  await page.waitForTimeout(600);
  out.during = { matrices: await countAuto(), frames: await sample(140) };

  // Put it back, and re-measure: the baseline must return.
  await page.evaluate(() => {
    const interior = window.__fw.scene3d.clubhouse?.()?.interior;
    if (!interior) return;
    const walk = (o) => {
      o.matrixAutoUpdate = true;
      for (const c of o.children) walk(c);
    };
    walk(interior);
  });
  await page.waitForTimeout(600);
  out.after = { matrices: await countAuto(), frames: await sample(140) };

  const b = out.before.frames;
  const d = out.during.frames;
  const a = out.after.frames;
  const drift = Math.abs(a.median - b.median);
  const gain = b.median - d.median;
  out.verdict = {
    frozenObjects: out.frozenApplied,
    // control 1: the freeze actually took
    freezeTook: (out.during.matrices?.auto ?? -1) === 0,
    autoBefore: out.before.matrices?.auto,
    autoDuring: out.during.matrices?.auto,
    medianBeforeMs: b.median,
    medianFrozenMs: d.median,
    medianRestoredMs: a.median,
    gainMs: +gain.toFixed(2),
    // control 2: the run is not simply drifting
    driftMs: +drift.toFixed(2),
    driftSmallerThanGain: drift < Math.abs(gain),
    over16Before: b.over16,
    over16Frozen: d.over16,
    // the decision this probe exists to make
    worthBuilding: gain > 1.0 && drift < Math.abs(gain),
  };
  fs.writeFileSync(path.join(OUT, 'a1-freeze.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('A1-FREEZE verdict', JSON.stringify(out.verdict));
  console.log('A1-FREEZE before', JSON.stringify(b));
  console.log('A1-FREEZE frozen', JSON.stringify(d));
  console.log('A1-FREEZE after ', JSON.stringify(a));
  if (out.errs.length) console.log('pageerrors', JSON.stringify(out.errs.slice(0, 3)));
  return out;
}
