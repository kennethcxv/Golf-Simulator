// I1 (Goal 23) — WHICH WAY DOES THE COVER SWING?
//
// "It still opens wrong. Open it RIGHT TO LEFT — the cover swings from the right
// side across to the left, the way a book opens. Show me every frame of that."
//
// WHAT THE PREVIOUS FILMING MEASURED: a clip was recorded and the frames showed
// "the shut book presenting as a flat card and the open book snapping into place
// without moving for 25 frames" — which is a report about the RISE and the shell
// swap, not about the direction. The direction was never isolated, because it
// was a bare local constant with no way to see the alternative.
//
// It is one sign. So both signs are photographed through the SAME swing at the
// SAME fractions, side by side, and the answer becomes something you look at
// rather than something anybody argues about.
//
// The swing is driven directly at fixed fractions rather than filmed in real
// time, deliberately: a clip samples wherever the frames happen to land, and
// the two runs would not line up for comparison. Every column here is the same
// moment of the same gesture.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-i1-cover-swing.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/i1-cover-swing');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [], candidates: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(3000);

  out.setup = await page.evaluate(() => {
    const app = window.__fw;
    const ch = app.scene3d.clubhouse();
    app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440 + 14 * 60;
    if (app.empire) app.empire.clockMinutes = app.state.clock.minutes;
    app.speedIdx = 0;
    ch.setTimeMood?.(14 * 60);
    const ui = document.getElementById('ui');
    if (ui) ui.style.visibility = 'hidden';
    // Stand square in front of the book on the desk, at reading distance.
    const book = ch.ledgerBook;
    let pos = book?.position;
    if (typeof pos === 'function') pos = pos();
    const ip = ch.interior.position;
    const w = app.scene3d.walk.state;
    if (pos) {
      const bx = ip.x + pos.x;
      const bz = ip.z + pos.z;
      const back = 1.15;
      w.x = bx; w.z = bz + back;
      w.yaw = Math.atan2(-(bx - w.x), -(bz - w.z));
      w.pitch = -0.42;
    }
    return {
      bookFound: !!pos,
      hasSetCoverSwing: typeof book?.debugSetCoverSwing === 'function',
      x: +w.x.toFixed(2), z: +w.z.toFixed(2),
    };
  });
  await page.waitForTimeout(1200);

  const FRACTIONS = [0, 0.25, 0.5, 0.75, 1];
  for (const sign of [1, -1]) {
    for (const f of FRACTIONS) {
      const applied = await page.evaluate(([s, frac]) => {
        window.__qaCoverSign = s;
        const book = window.__fw.scene3d.clubhouse().ledgerBook;
        if (typeof book?.debugSetCoverSwing !== 'function') return 'debugSetCoverSwing unavailable';
        book.debugSetCoverSwing(frac);
        return 'ok';
      }, [sign, f]);
      await page.waitForTimeout(320);
      const file = `sign${sign > 0 ? 'pos' : 'neg'}-${String(Math.round(f * 100)).padStart(3, '0')}.png`;
      const canvas = await page.$('#game');
      await (canvas || page).screenshot({ path: path.join(OUT, file) });
      out.candidates.push({
        n: out.candidates.length + 1,
        sign,
        fraction: f,
        applied,
        file,
        caption: `sign ${sign > 0 ? '+1 (shipped)' : '-1'}  ·  ${Math.round(f * 100)}% open`,
      });
      console.log('I1', sign, f, applied);
    }
  }
  await page.evaluate(() => { delete window.__qaCoverSign; });

  out.checks = {
    bookFound: out.setup.bookFound,
    swingDriveable: out.candidates.every((c) => c.applied === 'ok'),
    bothSignsShot: out.candidates.length === FRACTIONS.length * 2,
    noPageErrors: out.errs.length === 0,
  };
  out.ok = Object.values(out.checks).every(Boolean);
  fs.writeFileSync(path.join(OUT, 'cover-swing.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('I1-SWEEP', JSON.stringify({ ok: out.ok, checks: out.checks, setup: out.setup }, null, 2));
  return out;
}
