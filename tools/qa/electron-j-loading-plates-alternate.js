// J (Goal 23) — DOES THE LOADING SCREEN CHANGE PICTURE WHILE YOU WAIT?
//
// "The loading screen alternates — two or three plates per load, a few seconds
// each, cross-fading."
//
// Goal 21 put a real photograph behind the veil, which fixed a blank screen. On
// a load that takes twenty seconds, one photograph is a still frame you sit and
// look at.
//
// This samples the veil while it is up and records which image each layer
// carries and how opaque it is. Two things have to be true and a naive check
// would confuse them:
//
//   * the PICTURE changes — more than one distinct plate in a single load
//   * it CROSS-FADES — there is a moment where both layers are partly visible,
//     which is what separates a dissolve from a cut
//
// Control: a load that only ever showed one plate would satisfy neither, and a
// hard cut would satisfy the first alone.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-j-loading-plates-alternate.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/j-loading-plates');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [], samples: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  // Sample the veil from the moment it exists. The plate rotation runs on a
  // six-second timer, so a load has to be watched for longer than that or the
  // answer is always "one picture".
  //
  // The sampler goes in BEFORE the menu click, not after waiting for the plate:
  // the veil does not exist until New Game is pressed, so waiting for
  // .load-veil-plate first simply times out. read() tolerates a missing element
  // and starts recording the moment one appears.
  await page.waitForFunction(() => !!document.querySelector('button'), null, { timeout: 120000 });
  await page.evaluate(() => {
    window.__plateLog = [];
    const read = () => {
      const veil = document.querySelector('.load-veil');
      const a = document.querySelector('.load-veil-plate');
      const b = document.querySelector('.load-veil-plate-b');
      if (!a) return;
      const url = (n) => {
        if (!n) return null;
        const m = /url\(["']?([^"')]+)/.exec(getComputedStyle(n).backgroundImage || '');
        return m ? m[1].split('/').pop() : null;
      };
      window.__plateLog.push({
        t: Math.round(performance.now()),
        veilUp: !!veil && getComputedStyle(veil).display !== 'none' && Number(getComputedStyle(veil).opacity) > 0.05,
        a: { file: url(a), opacity: +Number(getComputedStyle(a).opacity).toFixed(2) },
        b: { file: url(b), opacity: +Number(getComputedStyle(b).opacity).toFixed(2) },
        caption: (document.querySelector('.load-veil-place') || {}).textContent || null,
      });
    };
    read();
    window.__plateIv = setInterval(read, 250);
  });

  // Boot through the menu — that is the load a player actually waits through.
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForTimeout(2000);

  out.samples = await page.evaluate(() => {
    clearInterval(window.__plateIv);
    return window.__plateLog;
  });

  const up = out.samples.filter((s) => s.veilUp);
  const files = new Set();
  const captions = new Set();
  let bothVisible = 0;
  for (const s of up) {
    if (s.a.file && s.a.opacity > 0.05) files.add(s.a.file);
    if (s.b.file && s.b.opacity > 0.05) files.add(s.b.file);
    if (s.caption) captions.add(s.caption.trim());
    // the cross-fade moment: both layers carrying real opacity at once
    if (s.a.opacity > 0.12 && s.b.opacity > 0.12) bothVisible += 1;
  }
  out.measured = {
    samplesWhileUp: up.length,
    veilSecondsSeen: up.length ? +(((up[up.length - 1].t - up[0].t) / 1000)).toFixed(1) : 0,
    distinctPlates: [...files],
    distinctCaptions: [...captions],
    crossFadeSamples: bothVisible,
  };
  out.checks = {
    // CONTROL: the veil was actually up long enough for a rotation to be due
    watchedLongEnough: out.measured.veilSecondsSeen > 7,
    // the picture changes
    morePlatesThanOne: files.size >= 2,
    // ...and the caption follows it, so the two never disagree
    captionFollowsThePlate: captions.size >= 2,
    // ...and it dissolves rather than cutting
    crossFades: bothVisible >= 1,
    noPageErrors: out.errs.length === 0,
  };
  out.ok = Object.values(out.checks).every(Boolean);
  fs.writeFileSync(path.join(OUT, 'plates.json'), JSON.stringify(out, null, 2) + '\n');
  console.log('J-PLATES', JSON.stringify({ measured: out.measured, checks: out.checks }, null, 2));
  return out;
}
