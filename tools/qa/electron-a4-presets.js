// A4 — WHAT DOES SWITCHING A QUALITY PRESET ACTUALLY COST, AND WHEN?
//
// The reviewers' correction is the whole design here. `applySettings()` sets
// `material.needsUpdate = true` on every material; three does not compile
// anything at that moment - it compiles at each material's NEXT DRAW. So a
// sampler that watches the click window measures the cheapest part and misses
// the stall, which arrives thirty seconds later at the first doorway. Any fix
// that "defers" or "spreads" the recompile moves the cost further out of that
// window and reads as an improvement while the player's experience is
// unchanged.
//
// So this samples from the click until the PROGRAM COUNT IS STABLE, driving a
// real 360-degree turn and a walk so the materials that were invalidated
// actually get drawn. And it watches for the GL error stream that main.js
// documents as the consequence of shadows-off with stale programs, which no
// check in this project has ever failed on.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-a4-presets.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/a4-presets');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [], gl: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));
  page.on('console', (m) => {
    const text = m.text();
    if (/GL_INVALID|glDrawElements|WebGL/i.test(text)) out.gl.push(text.slice(0, 160));
  });

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.bringToFront().catch(() => {});
  await page.waitForTimeout(10000);

  const sample = async (label, pick) => {
    await page.evaluate(() => {
      const s = { rows: [], stop: false, clickAt: null };
      window.__a4 = s;
      const r = window.__fw.scene3d.renderer;
      let last = performance.now();
      const tick = () => {
        const now = performance.now();
        s.rows.push({
          t: +now.toFixed(1),
          dt: +(now - last).toFixed(2),
          programs: r.info.programs ? r.info.programs.length : -1,
          shadows: !!r.shadowMap.enabled,
          // Whether the applying label is up ON THIS FRAME. Asking from the
          // driver cannot work: the compile blocks the main thread, and a CDP
          // evaluate needs that same thread, so the question can only be
          // answered from inside the frame loop.
          applying: !!document.querySelector('.quality-applying'),
        });
        last = now;
        if (!s.stop) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await page.waitForTimeout(800);

    // Open the pause menu, go to Settings, Display, and CLICK the preset -
    // the player's own path, not a preference write.
    await page.keyboard.press('p');
    await page.waitForSelector('.pause-panel', { timeout: 15000 });
    await page.evaluate(() => {
      [...document.querySelectorAll('.pause-nav button, .pause-nav .nav-item, .pause-panel button')]
        .find((b) => /settings/i.test(b.textContent))?.click();
    });
    await page.waitForSelector('.settings-shell', { timeout: 15000 });
    await page.evaluate(() => {
      [...document.querySelectorAll('.settings-tab')].find((t) => /display/i.test(t.textContent))?.click();
    });
    await page.waitForTimeout(400);
    const clicked = await page.evaluate((want) => {
      const sel = [...document.querySelectorAll('.settings-page select')]
        .find((s) => [...s.options].some((o) => /low|medium|high|ultra|epic/i.test(o.value || o.textContent)));
      if (!sel) return { ok: false, why: 'no quality select' };
      const opt = [...sel.options].find((o) => new RegExp(want, 'i').test(o.value || o.textContent));
      if (!opt) return { ok: false, why: 'no option', have: [...sel.options].map((o) => o.value) };
      window.__a4.clickAt = performance.now();
      sel.value = opt.value;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true, value: opt.value };
    }, pick);
    if (!clicked.ok) return { label, clicked };

    // Is the picture frozen while it applies? Ask during, not after.
    await page.waitForTimeout(260);

    // Close the menu and DRAW the invalidated materials: a full turn plus a
    // walk, which is where a deferred recompile actually lands.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await page.mouse.click(700, 500);
    await page.waitForTimeout(200);
    for (let i = 0; i < 24; i += 1) {
      await page.mouse.move(500 + (i % 2) * 500, 420, { steps: 3 });
      await page.waitForTimeout(60);
    }
    await page.keyboard.down('w');
    await page.waitForTimeout(2000);
    await page.keyboard.up('w');
    await page.waitForTimeout(1500);

    const res = await page.evaluate(() => {
      const s = window.__a4;
      s.stop = true;
      const t0 = s.clickAt;
      const after = s.rows.filter((r) => r.t >= t0);
      const d = after.map((r) => r.dt);
      const progs = after.map((r) => r.programs);
      // when did the program count last change? that is when the recompile
      // actually finished, and it is nowhere near the click
      let lastChangeMs = null;
      for (let i = 1; i < after.length; i += 1) {
        if (after[i].programs !== after[i - 1].programs) lastChangeMs = +(after[i].t - t0).toFixed(0);
      }
      const inWindow = after.filter((r) => r.t <= t0 + 600).map((r) => r.dt);
      const applyingRows = after.filter((r) => r.applying);
      return {
        applyingFramesSeen: applyingRows.length,
        applyingFirstMs: applyingRows.length ? +(applyingRows[0].t - t0).toFixed(0) : null,
        applyingLastMs: applyingRows.length
          ? +(applyingRows[applyingRows.length - 1].t - t0).toFixed(0) : null,
        programsStart: progs[0],
        programsEnd: progs[progs.length - 1],
        programsGrew: progs[progs.length - 1] - progs[0],
        lastProgramChangeMs: lastChangeMs,
        worstAll: +Math.max(...d).toFixed(1),
        over33All: d.filter((x) => x > 33).length,
        over100All: d.filter((x) => x > 100).length,
        // what a click-window sampler would have reported
        worstInFirst600ms: inWindow.length ? +Math.max(...inWindow).toFixed(1) : null,
        shadowsAtEnd: after[after.length - 1].shadows,
      };
    });
    return { label, clicked, ...res };
  };

  out.toLow = await sample('to-low', 'low');
  out.toUltra = await sample('to-ultra', 'ultra');
  out.glErrors = out.gl.length;
  fs.writeFileSync(path.join(OUT, 'a4.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('A4 low  ', JSON.stringify(out.toLow));
  console.log('A4 ultra', JSON.stringify(out.toUltra));
  console.log('A4 gl', out.gl.length, JSON.stringify(out.gl.slice(0, 2)));
  if (out.errs.length) console.log('pageerrors', JSON.stringify(out.errs.slice(0, 3)));
  return out;
}
