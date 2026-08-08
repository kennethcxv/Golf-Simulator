// A1 — IS THE NON-RENDER 90% THE DOM HUD?
//
// Established: indoors 21% of frames exceed 16.7 ms, and only 10.2% of a spike
// frame's extra time is inside `renderer.render()`. The other ~90% is the rest
// of the frame — game update, or the browser's own style/layout/paint of the DOM
// overlay sitting on top of the canvas.
//
// The HUD is the cheapest half of that to test and the most suspicious: it is
// DOM, it is composited every frame, and it carries MORE indoors than out
// (prompts, the shop-condition chip, toasts, focus labels). Style and layout of
// a DOM overlay cost time that no draw call and no `render()` timer can see.
//
// THE TEST: measure indoors with the overlay shown, then again with it
// `display:none`, then AGAIN with it shown. Three windows in one run, so the
// restore is a drift control — if window 3 does not come back to window 1, the
// machine moved and the middle reading means nothing.
//
// Hiding is done by class-agnostic rule: every direct child of <body> that is not
// the canvas. That avoids guessing at a container name and avoids missing a
// second overlay root, and what was hidden is reported so the hiding itself can
// be checked rather than trusted.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-a1-hud-cost.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/a1-hud-cost');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  const boot = await import(`file:///${bootPath}`);
  await boot.clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.bringToFront().catch(() => {});
  await page.waitForTimeout(6000);

  out.teleport = await page.evaluate(() => {
    const fw = window.__fw;
    const ch = fw?.scene3d?.clubhouse?.();
    const st = fw?.scene3d?.walk?.state;
    if (!ch || !st) return { ok: false };
    let lp = ch.ledgerBook.position;
    if (typeof lp === 'function') lp = ch.ledgerBook.position();
    const ip = ch.interior.position;
    const book = { x: ip.x + lp.x, z: ip.z + lp.z };
    const to = { x: ip.x - book.x, z: ip.z - book.z };
    const len = Math.hypot(to.x, to.z) || 1;
    st.x = book.x + (to.x / len) * 3.0;
    st.z = book.z + (to.z / len) * 3.0;
    st.pitch = -0.2;
    return { ok: true, inside: !!ch.isInside(st.x, st.z, 0.35) };
  }).catch((e) => ({ ok: false, threw: String(e && e.message) }));
  await page.waitForTimeout(4000);

  const sample = (ms) => page.evaluate((dur) => new Promise((resolve) => {
    const rows = [];
    let prev = performance.now();
    const t0 = prev;
    const tick = () => {
      const now = performance.now();
      rows.push(+(now - prev).toFixed(2));
      prev = now;
      if (now - t0 < dur) requestAnimationFrame(tick);
      else resolve(rows);
    };
    requestAnimationFrame(tick);
  }), ms);

  const stat = (xs) => {
    const v = xs.slice(1).sort((a, b) => a - b);
    if (!v.length) return { n: 0 };
    const at = (q) => v[Math.min(v.length - 1, Math.floor(v.length * q))];
    return {
      n: v.length,
      median: +at(0.5).toFixed(2),
      p95: +at(0.95).toFixed(2),
      worst: +v[v.length - 1].toFixed(2),
      over16pct: +((v.filter((d) => d > 16.7).length / v.length) * 100).toFixed(1),
    };
  };

  const setHud = (hidden) => page.evaluate((hide) => {
    const kept = [];
    const touched = [];
    for (const el of [...document.body.children]) {
      if (el.tagName === 'CANVAS' || el.tagName === 'SCRIPT') { kept.push(el.tagName); continue; }
      if (hide) {
        el.dataset.a1Prev = el.style.display || '';
        el.style.display = 'none';
      } else if (el.dataset.a1Prev !== undefined) {
        el.style.display = el.dataset.a1Prev;
        delete el.dataset.a1Prev;
      }
      touched.push(`${el.tagName}.${String(el.className || '').split(' ')[0] || '(none)'}`);
    }
    // Proof the hiding took, rather than an assumption that it did.
    const stillVisible = [...document.body.children]
      .filter((el) => el.tagName !== 'CANVAS' && el.tagName !== 'SCRIPT'
        && getComputedStyle(el).display !== 'none').length;
    return { touched, kept, stillVisible };
  }, hidden);

  out.withHud = stat(await sample(9000));
  out.hide = await setHud(true);
  await page.waitForTimeout(1500);
  out.noHud = stat(await sample(9000));
  out.show = await setHud(false);
  await page.waitForTimeout(1500);
  out.withHudAgain = stat(await sample(9000));

  out.verdict = {
    inside: out.teleport?.inside ?? null,
    hudElementsHidden: out.hide?.touched?.length ?? null,
    stillVisibleWhileHidden: out.hide?.stillVisible ?? null,
    withHudOver16pct: out.withHud.over16pct,
    noHudOver16pct: out.noHud.over16pct,
    // The drift control: window 3 must return to window 1.
    withHudAgainOver16pct: out.withHudAgain.over16pct,
    controlGap: +Math.abs(out.withHud.over16pct - out.withHudAgain.over16pct).toFixed(1),
    effectPoints: +(((out.withHud.over16pct + out.withHudAgain.over16pct) / 2)
      - out.noHud.over16pct).toFixed(1),
  };
  fs.writeFileSync(path.join(OUT, 'a1-hud-cost.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('A1-HUD', JSON.stringify(out.verdict));
  console.log('  with hud  ', JSON.stringify(out.withHud));
  console.log('  no hud    ', JSON.stringify(out.noHud));
  console.log('  with again', JSON.stringify(out.withHudAgain));
  console.log('  hidden    ', JSON.stringify(out.hide?.touched?.slice(0, 10)));
  return out;
}
