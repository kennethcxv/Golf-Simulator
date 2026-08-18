// THE LAPTOP OPENING, AS A GESTURE.
//
// Everything else about this open is a number, and a number cannot show that the
// lid swings, the bar crawls, the bar completes and the interface lands — in
// that order, with nothing frozen at 100% in between. The bar is the thing being
// changed, so the bar has to be WATCHED.
//
// Walk in, sit down at the desk, open the laptop for real, hold, close, open a
// second time. Recorded at the default player camera.
//
//   QA_RESUME=1 QA_ELECTRON_USER_DATA_DIR=<dir with saves/> \
//   VIDEO_DIR=qa/clips/goal36-laptop \
//   node tools/qa/run-electron.cjs \
//     tools/qa/goal36-laptop-open-clip.js --clubhouse=pine-hills-v2
async (page) => {
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  const aimPath = `${process.cwd()}/tools/qa/lib/nav-aim.mjs`.replace(/\\/g, '/');
  const boot = await import(`file:///${bootPath}`);
  const aim = await import(`file:///${aimPath}`);
  const out = { failures: [] };

  if (process.env.QA_RESUME) {
    await page.waitForFunction(() => {
      const b = [...document.querySelectorAll('button')]
        .find((c) => /\bContinue\b/.test(c.querySelector('.menu-action-label')?.textContent || c.textContent || ''));
      return !!b && !b.disabled;
    }, null, { timeout: 120000 }).catch(() => {});
  }
  out.bootPath = await boot.clickThroughMenu(page, { forceNew: !process.env.QA_RESUME });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.bringToFront().catch(() => {});
  await page.waitForTimeout(3000);
  await boot.ownerResolution(page, page.electronApp);
  await page.waitForTimeout(1500);
  const vp = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));

  await aim.installAim(page);
  await page.mouse.click(Math.round(vp.w / 2), Math.round(vp.h / 2));
  await page.waitForTimeout(400);
  const walk = await aim.walkInsideClubhouse(page, vp);
  out.walk = { ok: walk.ok, legs: walk.legs, door: walk.door };
  if (!walk.ok) out.failures.push('never got inside — the clip is not of the desk');
  await page.waitForTimeout(3000);

  // Track the bar across both opens so the report can name the frame that
  // proves it, rather than describing what the frames ought to show.
  await page.evaluate(() => {
    window.__clip = { track: [], on: false };
    const pump = () => {
      if (window.__clip.on) {
        const ch = window.__fw.scene3d.clubhouse?.();
        const lt = window.__fw.laptop;
        window.__clip.track.push({
          t: +performance.now().toFixed(0),
          p: ch?.laptopBootProgress ? ch.laptopBootProgress() : null,
          mode: ch?.laptopScreenMode ? ch.laptopScreenMode() : null,
          shown: !!(lt?.isOpen?.() && lt.root && getComputedStyle(lt.root).visibility !== 'hidden'),
        });
      }
      requestAnimationFrame(pump);
    };
    requestAnimationFrame(pump);
  });

  const openOnce = async (label) => {
    await page.evaluate(() => { window.__clip.on = true; window.__clip.track = []; });
    const t0 = await page.evaluate(() => +performance.now().toFixed(0));
    await page.evaluate(() => window.__fw.scene3d.walk.hooks.openLaptop?.(null));
    await page.waitForTimeout(4000);
    const track = await page.evaluate(() => {
      window.__clip.on = false;
      return window.__clip.track;
    });
    const firstBoot = track.find((s) => s.mode === 'boot');
    const barFull = track.find((s) => s.p != null && s.p >= 0.999);
    const shown = track.find((s) => s.shown && s.mode === 'live');
    out[label] = {
      bootAtMs: firstBoot ? firstBoot.t - t0 : null,
      barFullAtMs: barFull ? barFull.t - t0 : null,
      interfaceShownAtMs: shown ? shown.t - t0 : null,
      // every progress value the bar passed through, so the crawl is on record
      barCurve: track.filter((s) => s.p != null).map((s) => [s.t - t0, s.p]),
    };
    console.log(`${label}: boot ${out[label].bootAtMs} ms · bar full ${out[label].barFullAtMs} ms `
      + `· interface shown ${out[label].interfaceShownAtMs} ms`);
    await page.waitForTimeout(2500);
    await page.evaluate(() => {
      const c = [...document.querySelectorAll('.lt-navbtn')].find((b) => b.classList.contains('lt-close'));
      c?.click();
    });
    await page.waitForTimeout(3500);
  };

  await openOnce('open1');
  await openOnce('open2');
  await page.waitForTimeout(2000);
  console.log(JSON.stringify(out, null, 2));
  return out;
}
