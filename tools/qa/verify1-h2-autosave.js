// VERIFIER 1 — H2: the 'Autosaved' chip appears BOTTOM-RIGHT at the rollover
// write, and autosave-meta.json on disk carries a 'trigger' field.
//
// Adversarial points beyond the shipped driver:
//   - the chip's POSITION is measured (getBoundingClientRect vs viewport) —
//     "a chip appeared somewhere" does not satisfy "bottom-right";
//   - the chip's TEXT is captured (must actually say Autosaved);
//   - the screenshot is taken WHILE the chip is up, not after;
//   - meta trigger is read off disk and must be 'rollover' with a fresh savedAt.
//
// DESTRUCTIVE to the live save (day advances, autosave rotates). Caller backed
// up %APPDATA%/GOLF EMPIRE/saves first (qa/audit/saves-backup-verify1-*).
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const os = process.getBuiltinModule('node:os');
  const OUT = path.resolve('qa/electron/verify1');
  fs.mkdirSync(OUT, { recursive: true });
  const savesDir = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'GOLF EMPIRE', 'saves');
  const metaPath = path.join(savesDir, 'autosave-meta.json');
  const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };

  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e && e.message || e)));

  await page.setViewportSize({ width: 1280, height: 720 });
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForTimeout(3000);

  const startedAt = Date.now();
  const metaBefore = readJson(metaPath);

  // force the rollover: 23:59 at 1x
  await page.evaluate(() => {
    const app = window.__fw;
    app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440 + 23 * 60 + 59;
    app.speedIdx = 1;
  });

  // catch the chip AT the write: poll for .hud-autosave.show, measure it live
  const chip = await page.waitForSelector('.hud-autosave.show', { timeout: 240000 }).then(() => true).catch(() => false);
  let chipInfo = null;
  if (chip) {
    chipInfo = await page.evaluate(() => {
      const el = document.querySelector('.hud-autosave.show') || document.querySelector('.hud-autosave');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        text: (el.textContent || '').trim(),
        rect: { left: +r.left.toFixed(1), top: +r.top.toFixed(1), right: +r.right.toFixed(1), bottom: +r.bottom.toFixed(1) },
        viewport: { w: window.innerWidth, h: window.innerHeight },
        opacity: cs.opacity,
        inBottomRightQuadrant: r.right > window.innerWidth * 0.7 && r.bottom > window.innerHeight * 0.7,
      };
    });
    await page.screenshot({ path: path.join(OUT, 'h2-chip-visible.png') });
  }

  const rolled = await page.waitForFunction(() => {
    const m = window.__fw.state.clock.minutes % 1440;
    return m >= 0 && m < 300;
  }, null, { timeout: 120000 }).then(() => true).catch(() => false);
  await page.waitForTimeout(1800);
  await page.screenshot({ path: path.join(OUT, 'h2-after-rollover.png') });

  const metaAfter = readJson(metaPath);
  const checks = {
    rolled,
    chipAppeared: chip,
    chipSaysAutosaved: !!(chipInfo && /autosaved/i.test(chipInfo.text)),
    chipBottomRight: !!(chipInfo && chipInfo.inBottomRightQuadrant),
    metaHasTriggerField: !!(metaAfter && 'trigger' in metaAfter),
    metaTriggerIsRollover: metaAfter?.trigger === 'rollover',
    metaFresh: !!(metaAfter && metaAfter.savedAt >= startedAt),
    noPageErrors: errs.length === 0,
  };
  const out = { metaBefore, metaAfter, chipInfo, errs: errs.slice(0, 10), checks, ok: Object.values(checks).every(Boolean) };
  fs.writeFileSync(path.join(OUT, 'h2-autosave.json'), `${JSON.stringify(out, null, 1)}\n`);
  return out;
}
