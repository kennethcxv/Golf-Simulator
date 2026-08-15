// D1 — the resolution list against the REAL monitor, verified where the
// player touches it (R-M): the list's claims, the APPLY path (content size
// × scale equals the chosen physical size; borderless when a chromed
// window cannot hold it), and the FW_FAKE_DISPLAY negative control proving
// the shipped comparison still knows a small display when it sees one.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/d1-resolution');
  fs.mkdirSync(OUT, { recursive: true });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message || e)));
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  const boot = await import(`file:///${bootPath}`);
  await boot.clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForTimeout(2000);

  const out = { errs };
  out.info = await page.evaluate(() => window.fairwayNative.displayInfo());
  const rows = out.info.resolutions;
  const r4k = rows.find((r) => r.width === 3840 && r.height === 2160);
  const r1440 = rows.find((r) => r.width === 2560 && r.height === 1440);

  if (process.env.QA_D1_FAKE) {
    // control mode: the fake display makes the apply legs THROW by design
    // ("does not fit") — the control only grades the list's verdicts
    const rows2 = out.info.resolutions;
    const fits = (w, h) => rows2.find((r) => r.width === w && r.height === h)?.fits;
    out.checks = {
      fakeSeen: out.info.physical?.width === 1600 && out.info.physical?.height === 900,
      smallStillFits: fits(1280, 720) === true && fits(1600, 900) === true,
      bigRefused: fits(1920, 1080) === false && fits(2560, 1440) === false
        && fits(3840, 2160) === false,
      noPageErrors: errs.length === 0,
    };
    out.ok = Object.values(out.checks).every(Boolean);
    fs.writeFileSync(path.join(OUT, 'd1-fake.json'), `${JSON.stringify(out, null, 2)}
`);
    return out;
  }

  // APPLY 1440p windowed: content bounds x scale must equal the ask
  const applied = await page.evaluate(async () => {
    await window.fairwayNative.setResolution(2560, 1440);
    return window.fairwayNative.displayInfo();
  });
  out.after1440 = { width: applied.width, height: applied.height, mode: applied.mode };

  // APPLY 4K: on this display a chromed window cannot hold it -> borderless
  const applied4k = await page.evaluate(async () => {
    await window.fairwayNative.setResolution(3840, 2160);
    return window.fairwayNative.displayInfo();
  });
  out.after4k = { width: applied4k.width, height: applied4k.height, mode: applied4k.mode };
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT, 'after-4k.png') });

  out.checks = {
    physicalReported: out.info.physical?.width === 3840 && out.info.physical?.height === 2160,
    fourKFits: !!r4k && r4k.fits === true,
    fourteenFortyFits: !!r1440 && r1440.fits === true,
    fourKNeedsBorderless: !!r4k && r4k.needsBorderless === true,
    // DIP grid at scale 1.5 quantizes to 1.5px steps; ±3px is exact-as-
    // physically-possible (measured 2562x1442 for a 2560x1440 ask)
    apply1440Exact: Math.abs(out.after1440.width - 2560) <= 3
      && Math.abs(out.after1440.height - 1440) <= 3
      && out.after1440.mode === 'windowed',
    apply4kBorderless: out.after4k.mode === 'fullscreen'
      && out.after4k.width === 3840 && out.after4k.height === 2160,
    noPageErrors: errs.length === 0,
  };
  out.ok = Object.values(out.checks).every(Boolean);
  out.note = 'FW_FAKE_DISPLAY control runs as a separate invocation (env is process-level)';
  fs.writeFileSync(path.join(OUT, 'd1.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
