// VERIFY-A / A5 — does the drawing buffer HOLD at window size through a normal
// session: after a quality change, after entering the register, after an
// unmaximize/resize/re-maximize cycle. The author's driver read it once at
// boot; this one tries to break it.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/verify-a');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));
  const app = page.electronApp;

  const winState = () => app.evaluate(({ BrowserWindow, screen }) => {
    const win = BrowserWindow.getAllWindows()[0];
    const display = screen.getDisplayMatching(win.getBounds());
    const content = win.getContentBounds();
    const scale = display.scaleFactor || 1;
    return {
      maximized: win.isMaximized(),
      contentPhysical: { width: Math.round(content.width * scale), height: Math.round(content.height * scale) },
      scaleFactor: scale,
      workAreaPhysical: {
        width: Math.round(display.workAreaSize.width * scale),
        height: Math.round(display.workAreaSize.height * scale),
      },
    };
  });
  const bufState = () => page.evaluate(() => {
    const r = window.__fw?.scene3d?.renderer;
    const c = r?.domElement;
    return {
      dpr: window.devicePixelRatio,
      rendererPixelRatio: r?.getPixelRatio?.() ?? null,
      buffer: { width: c?.width ?? null, height: c?.height ?? null },
      css: { width: c?.clientWidth ?? null, height: c?.clientHeight ?? null },
      inner: { width: window.innerWidth, height: window.innerHeight },
      renderScale: window.__fw?.preferences?.values?.display?.renderScale ?? null,
      quality: window.__fw?.preferences?.values?.display?.quality ?? null,
    };
  });
  const grade = (w, b) => {
    const bufPx = (b.buffer.width || 0) * (b.buffer.height || 0);
    const winPx = w.contentPhysical.width * w.contentPhysical.height;
    return {
      match: bufPx > 0 && Math.abs((b.buffer.width || 0) - w.contentPhysical.width) <= 2
        && Math.abs((b.buffer.height || 0) - w.contentPhysical.height) <= 2,
      shortfallPct: bufPx > 0 ? +(100 * (1 - bufPx / winPx)).toFixed(1) : null,
    };
  };

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.bringToFront().catch(() => {});
  await page.waitForTimeout(4000);

  // ---- leg A: as booted ---------------------------------------------------
  out.boot = { win: await winState(), buf: await bufState() };
  out.boot.grade = grade(out.boot.win, out.boot.buf);
  await page.screenshot({ path: path.join(OUT, 'va5-A-boot-hud.png') });

  // ---- leg B: through the settings panel (quality change), UI shots -------
  await page.keyboard.press('p');
  await page.waitForSelector('.pause-panel', { timeout: 15000 });
  await page.screenshot({ path: path.join(OUT, 'va5-B1-pause-native.png') });
  await page.evaluate(() => {
    [...document.querySelectorAll('.pause-nav button, .pause-nav .nav-item, .pause-panel button')]
      .find((b) => /settings/i.test(b.textContent))?.click();
  });
  await page.waitForSelector('.settings-shell', { timeout: 15000 });
  await page.evaluate(() => {
    [...document.querySelectorAll('.settings-tab')].find((t) => /display/i.test(t.textContent))?.click();
  });
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT, 'va5-B2-settings-display-native.png') });
  // what controls exist here (renderScale? resolution?), for the record
  out.displayControls = await page.evaluate(() => [...document.querySelectorAll('.settings-page select, .settings-page input')]
    .map((n) => {
      const row = n.closest('label, .settings-row, div');
      return {
        tag: n.tagName.toLowerCase(),
        type: n.type || null,
        value: n.value,
        label: (row?.textContent || '').trim().slice(0, 80),
      };
    }).slice(0, 24));
  out.qualityChange = await page.evaluate(() => {
    const sel = [...document.querySelectorAll('.settings-page select')]
      .find((s) => [...s.options].some((o) => /low|medium|high|ultra/i.test(o.value || o.textContent)));
    if (!sel) return { ok: false };
    const from = sel.value;
    const opt = [...sel.options].find((o) => o.value !== sel.value && /high|medium/i.test(o.value || o.textContent));
    if (!opt) return { ok: false, from };
    sel.value = opt.value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true, from, to: opt.value };
  });
  await page.waitForTimeout(2500);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);
  out.afterQuality = { win: await winState(), buf: await bufState() };
  out.afterQuality.grade = grade(out.afterQuality.win, out.afterQuality.buf);

  // ---- leg C: the register ------------------------------------------------
  out.register = { entered: false };
  const hunt = await page.evaluate(async () => {
    const fw = window.__fw;
    const ch = fw.scene3d.clubhouse();
    const st = fw.scene3d.walk.state;
    const ip = ch.interior.position;
    const spots = [
      { x: ip.x - 5.2, z: ip.z + 3.0 }, { x: ip.x, z: ip.z }, { x: ip.x + 4, z: ip.z - 3 },
      { x: ip.x - 4, z: ip.z - 4 }, { x: ip.x + 5, z: ip.z + 4 },
    ];
    const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });
    for (const p of spots) {
      st.x = p.x; st.z = p.z;
      for (let k = 0; k < 20; k += 1) {
        st.yaw = (k / 20) * Math.PI * 2;
        st.pitch = -0.25;
        await sleep(80);
        const label = fw.scene3d.walk.getFocusLabel ? String(fw.scene3d.walk.getFocusLabel() || '') : '';
        if (/register|till|checkout|ring up|serve/i.test(label)) {
          return { hit: true, label: label.slice(0, 80) };
        }
      }
    }
    return { hit: false };
  });
  out.register.hunt = hunt;
  if (hunt.hit) {
    await page.keyboard.press('e');
    await page.waitForTimeout(2500);
    out.register.mode = await page.evaluate(() => ({
      registerActive: !!(window.__fw.registerActive || window.__fw.checkout?.isActive?.()
        || document.querySelector('.register-hud, .checkout-hud, .register-panel')),
      walkActive: !!window.__fw.scene3d?.walk?.isActive?.(),
    }));
    out.register.state = { win: await winState(), buf: await bufState() };
    out.register.grade = grade(out.register.state.win, out.register.state.buf);
    out.register.entered = true;
    await page.screenshot({ path: path.join(OUT, 'va5-C-register-native.png') });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1200);
  }

  // ---- leg D: unmaximize -> resize -> re-maximize ---------------------------
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win.isMaximized()) win.unmaximize();
    win.setResizable(true);
    win.setContentSize(1600, 900);
  });
  await page.waitForTimeout(1200);
  out.resized = { win: await winState(), buf: await bufState() };
  out.resized.grade = grade(out.resized.win, out.resized.buf);
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].maximize();
  });
  await page.waitForTimeout(1500);
  out.remaximized = { win: await winState(), buf: await bufState() };
  out.remaximized.grade = grade(out.remaximized.win, out.remaximized.buf);
  await page.screenshot({ path: path.join(OUT, 'va5-D-remaximized.png') });

  fs.writeFileSync(path.join(OUT, 'va5.json'), `${JSON.stringify(out, null, 2)}\n`);
  const b = (s) => s && ({
    max: s.win.maximized,
    winPhys: s.win.contentPhysical,
    buf: s.buf.buffer,
    rs: s.buf.renderScale,
    pr: s.buf.rendererPixelRatio,
    grade: s.grade,
  });
  console.log('VA5 boot       ', JSON.stringify(b(out.boot)));
  console.log('VA5 afterQual  ', JSON.stringify(b(out.afterQuality)), 'change', JSON.stringify(out.qualityChange));
  console.log('VA5 register   ', out.register.entered ? JSON.stringify(b(out.register.state)) : JSON.stringify(out.register.hunt));
  console.log('VA5 resized    ', JSON.stringify(b(out.resized)));
  console.log('VA5 remaximized', JSON.stringify(b(out.remaximized)));
  if (out.errs.length) console.log('pageerrors', JSON.stringify(out.errs.slice(0, 4)));
  return out;
}
