// VERIFY-A / A4 — the author's preset instrument, extended with the three
// things it never checked: the drawing buffer after each switch (does a
// preset silently shrink the picture), the applying label's geometry and
// whether it outlives the apply, and a screenshot taken while it shows.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/verify-a');
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

  const centre = await page.evaluate(() => ({ x: Math.round(window.innerWidth / 2), y: Math.round(window.innerHeight / 2) }));
  const bufState = () => page.evaluate(() => {
    const r = window.__fw?.scene3d?.renderer;
    const c = r?.domElement;
    return {
      buffer: { width: c?.width ?? null, height: c?.height ?? null },
      rendererPixelRatio: r?.getPixelRatio?.() ?? null,
      quality: window.__fw?.preferences?.values?.display?.quality ?? null,
      applyingNodes: document.querySelectorAll('.quality-applying').length,
    };
  });
  out.bufBefore = await bufState();

  const sample = async (label, pick, shotName) => {
    await page.evaluate(() => {
      const s = { rows: [], stop: false, clickAt: null, labelRect: null, labelText: null, under: null };
      window.__va4 = s;
      const r = window.__fw.scene3d.renderer;
      let last = performance.now();
      const tick = () => {
        const now = performance.now();
        const lab = document.querySelector('.quality-applying');
        if (lab && !s.labelRect) {
          const rect = lab.getBoundingClientRect();
          s.labelRect = { x: rect.x, y: rect.y, w: rect.width, h: rect.height };
          s.labelText = (lab.textContent || '').slice(0, 60);
          const cs = getComputedStyle(lab);
          s.labelStyle = { position: cs.position, zIndex: cs.zIndex, fontSize: cs.fontSize };
        }
        s.rows.push({
          t: +now.toFixed(1),
          dt: +(now - last).toFixed(2),
          programs: r.info.programs ? r.info.programs.length : -1,
          applying: !!lab,
        });
        last = now;
        if (!s.stop) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await page.waitForTimeout(700);

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
      if (!opt) return { ok: false, why: 'no option' };
      window.__va4.clickAt = performance.now();
      sel.value = opt.value;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true, value: opt.value };
    }, pick);
    if (!clicked.ok) return { label, clicked };
    // catch the label on film if it lives long enough
    await page.screenshot({ path: path.join(OUT, `${shotName}-applying.png`) }).catch(() => {});

    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await page.mouse.click(centre.x, centre.y);
    await page.waitForTimeout(200);
    for (let i = 0; i < 24; i += 1) {
      await page.mouse.move(centre.x - 250 + (i % 2) * 500, centre.y, { steps: 3 });
      await page.waitForTimeout(60);
    }
    await page.keyboard.down('w');
    await page.waitForTimeout(2000);
    await page.keyboard.up('w');
    await page.waitForTimeout(1500);

    const res = await page.evaluate(() => {
      const s = window.__va4;
      s.stop = true;
      const t0 = s.clickAt;
      const after = s.rows.filter((r) => r.t >= t0);
      const d = after.map((r) => r.dt);
      const progs = after.map((r) => r.programs);
      let lastChangeMs = null;
      for (let i = 1; i < after.length; i += 1) {
        if (after[i].programs !== after[i - 1].programs) lastChangeMs = +(after[i].t - t0).toFixed(0);
      }
      const applyingRows = after.filter((r) => r.applying);
      return {
        applyingFramesSeen: applyingRows.length,
        applyingFirstMs: applyingRows.length ? +(applyingRows[0].t - t0).toFixed(0) : null,
        applyingLastMs: applyingRows.length
          ? +(applyingRows[applyingRows.length - 1].t - t0).toFixed(0) : null,
        labelRect: s.labelRect,
        labelText: s.labelText,
        labelStyle: s.labelStyle || null,
        programsStart: progs[0],
        programsEnd: progs[progs.length - 1],
        lastProgramChangeMs: lastChangeMs,
        worstAll: +Math.max(...d).toFixed(1),
        over33All: d.filter((x) => x > 33).length,
        over100All: d.filter((x) => x > 100).length,
      };
    });
    const buf = await bufState();
    return { label, clicked, ...res, bufAfter: buf };
  };

  out.toLow = await sample('to-low', 'low', 'va4-low');
  out.toUltra = await sample('to-ultra', 'ultra', 'va4-ultra');
  await page.waitForTimeout(5000);
  out.labelAfter5s = await page.evaluate(() => ({
    nodes: document.querySelectorAll('.quality-applying').length,
    visible: [...document.querySelectorAll('.quality-applying')]
      .some((n) => getComputedStyle(n).display !== 'none' && getComputedStyle(n).opacity !== '0'),
  }));
  await page.screenshot({ path: path.join(OUT, 'va4-final-hud.png') });
  out.glCount = out.gl.length;
  fs.writeFileSync(path.join(OUT, 'va4.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('VA4 bufBefore', JSON.stringify(out.bufBefore));
  console.log('VA4 low  ', JSON.stringify(out.toLow));
  console.log('VA4 ultra', JSON.stringify(out.toUltra));
  console.log('VA4 labelAfter5s', JSON.stringify(out.labelAfter5s), 'gl', out.gl.length);
  if (out.errs.length) console.log('pageerrors', JSON.stringify(out.errs.slice(0, 4)));
  return out;
}
