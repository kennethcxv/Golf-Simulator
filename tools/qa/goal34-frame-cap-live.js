// THE FRAME CAP, PROVED IN THE GAME AND THEN MEASURED AT EVERY RUNG.
//
// The acceptance the owner set: "at cap 60 on a 240 Hz panel, everyNVsyncs must
// be 4 and skippedTicks must be non-zero. At 240 it must be 1. If the numbers
// do not move, the cap still does not work."
//
// Then: presented-frame intervals at 60, 120, 144, 240 and uncapped, with held
// W and a mouse sweep, reporting median, p95, p99 and variance — because the
// question is which setting is smoothest, and average fps cannot answer it.
//
// TWO TRAPS THIS DRIVER IS BUILT AROUND, both of which have already voided a
// run on this machine:
//
//  * rAF GAPS ARE NOT PRESENTED-FRAME INTERVALS UNDER A CAP. A declined tick
//    produces no damage, so Chromium issues the next one almost immediately: at
//    cap 60 a third of all gaps came back under 0.5 ms, which reads as a 2,000
//    fps game and is really the skip. Presented frames are reconstructed from
//    frameCap's own renderedFrames counter instead.
//  * AN UNPACED page.mouse.move FLOOD IS ITSELF A ONE-SECOND STALL. The first
//    cut of last night's pacing driver measured 1 fps and p99 1036 ms and I
//    nearly filed it as a game defect. Every sweep here is stepped and awaited,
//    and each rung is preceded by a quiet no-input control.
//
//   QA_RESUME=1 QA_ELECTRON_USER_DATA_DIR=<dir with saves/> \
//   node tools/qa/run-electron.cjs \
//     tools/qa/goal34-frame-cap-live.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/goal34');
  fs.mkdirSync(OUT, { recursive: true });
  const tag = process.env.QA_TAG || 'cap';
  const out = { tag, errs: [], failures: [], rungs: [] };
  const fail = (why) => { out.failures.push(why); console.log('FAIL:', why); };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  const boot = await import(`file:///${bootPath}`);
  if (process.env.QA_RESUME) {
    await page.waitForFunction(() => {
      const b = [...document.querySelectorAll('button')]
        .find((c) => /\bContinue\b/.test(c.querySelector('.menu-action-label')?.textContent || c.textContent || ''));
      return !!b && !b.disabled;
    }, null, { timeout: 90000 }).catch(() => {});
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

  // WHAT THE OS SAYS, AND WHETHER THE CAP IS LISTENING
  out.display = await page.evaluate(() => window.fairwayNative?.displayInfo?.().then((i) => ({
    refreshHz: i?.refreshHz ?? null,
    width: i?.width ?? null,
    height: i?.height ?? null,
    scaleFactor: i?.scaleFactor ?? null,
  })) || null);
  out.capAtBoot = await page.evaluate(() => window.__fw.frameCapDiagnostics());
  if (out.capAtBoot.panelSource !== 'os') {
    fail(`the cap is still inferring the panel from rAF (panelSource ${out.capAtBoot.panelSource}) — `
      + 'every number below is the old inert behaviour');
  }
  if (out.display?.refreshHz && out.capAtBoot.osPanelHz !== out.display.refreshHz) {
    fail(`the cap has ${out.capAtBoot.osPanelHz} Hz but the OS says ${out.display.refreshHz}`);
  }

  // presented frames, reconstructed from the counter rather than from rAF gaps
  await page.evaluate(() => {
    window.__cap = { marks: [], on: false };
    let seen = -1;
    const tick = (ts) => {
      if (window.__cap.on) {
        const n = window.__fw.frameCapDiagnostics().renderedFrames;
        if (n !== seen) { window.__cap.marks.push(ts); seen = n; }
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  const vp = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  await page.mouse.click(Math.round(vp.w / 2), Math.round(vp.h / 2));
  await page.waitForTimeout(500);
  for (let leg = 0; leg < 5; leg += 1) {
    await page.keyboard.down('w');
    await page.waitForTimeout(leg === 0 ? 6500 : 1800);
    await page.keyboard.up('w');
    await page.waitForTimeout(500);
    const inside = await page.evaluate(() => {
      const w = window.__fw.scene3d.walk.state;
      const ch = window.__fw.scene3d.clubhouse?.();
      return ch?.isInside ? !!ch.isInside(w.x, w.z) : false;
    });
    out.inside = inside;
    if (inside) break;
  }
  await page.waitForFunction(
    () => (window.__fw.scene3d.matrixFreezeDiagnostics?.()?.framesSinceWalk || 0) > 950,
    null, { timeout: 240000 },
  ).catch(() => {});

  const cx = Math.round(vp.w / 2);
  const cy = Math.round(vp.h / 2);
  const stats = (marks) => {
    const iv = [];
    for (let i = 1; i < marks.length; i += 1) iv.push(marks[i] - marks[i - 1]);
    if (!iv.length) return null;
    const s = iv.slice().sort((a, b) => a - b);
    const at = (q) => +s[Math.min(s.length - 1, Math.floor(q * s.length))].toFixed(2);
    const mean = iv.reduce((a, b) => a + b, 0) / iv.length;
    const varc = iv.reduce((a, b) => a + (b - mean) ** 2, 0) / iv.length;
    return {
      frames: marks.length,
      fps: +(1000 / mean).toFixed(1),
      medianMs: at(0.5),
      p95Ms: at(0.95),
      p99Ms: at(0.99),
      worstMs: +s[s.length - 1].toFixed(2),
      stdevMs: +Math.sqrt(varc).toFixed(2),
      // how many intervals sit within 20% of the median: the cadence number,
      // which is the one that decides whether it FEELS smooth
      onCadencePct: +(100 * iv.filter((g) => Math.abs(g - at(0.5)) <= at(0.5) * 0.2).length / iv.length).toFixed(1),
    };
  };

  const rung = async (cap) => {
    out.capSet = await page.evaluate((c) => window.__fw.setFpsCapForQa(c), cap);
    await page.waitForTimeout(1200);
    // quiet control: a still, no-input window at this rung
    await page.evaluate(() => { window.__cap.marks.length = 0; window.__cap.on = true; });
    await page.waitForTimeout(3000);
    const still = stats(await page.evaluate(() => {
      const m = window.__cap.marks.slice();
      window.__cap.marks.length = 0;
      return m;
    }));

    // the gesture: held W with a paced sweep, ten seconds
    await page.keyboard.down('w');
    const until = Date.now() + 10000;
    let i = 0;
    while (Date.now() < until) {
      const dx = Math.round(140 * Math.sin(i * 0.7));
      await page.mouse.move(cx + dx, cy + Math.round(30 * Math.cos(i * 0.5)), { steps: 8 });
      await page.waitForTimeout(60);
      i += 1;
    }
    await page.keyboard.up('w');
    const marks = await page.evaluate(() => {
      window.__cap.on = false;
      return window.__cap.marks.slice();
    });
    const diag = await page.evaluate(() => window.__fw.frameCapDiagnostics());
    const row = {
      cap,
      everyNVsyncs: diag.everyNVsyncs,
      skippedTicks: diag.skippedTicks,
      workBound: diag.workBound,
      panelHz: diag.panelHz,
      panelSource: diag.panelSource,
      effectiveFps: diag.effectiveFps,
      still,
      walking: stats(marks),
    };
    out.rungs.push(row);
    console.log(`[cap ${cap}] everyN=${row.everyNVsyncs} skipped=${row.skippedTicks} workBound=${row.workBound} `
      + `walk fps=${row.walking?.fps} med=${row.walking?.medianMs} p95=${row.walking?.p95Ms} `
      + `p99=${row.walking?.p99Ms} stdev=${row.walking?.stdevMs} cadence=${row.walking?.onCadencePct}%`);
    await page.screenshot({ path: path.join(OUT, `${tag}-${cap || 'uncapped'}.png`) });
    return row;
  };

  for (const c of [60, 120, 144, 240, 0]) await rung(c);

  // THE ACCEPTANCE, in his words. Read at a still frame, where the machine has
  // the headroom the guard requires — walking at 4K it does not, and that is a
  // finding rather than a failure of the cap.
  out.capSet = await page.evaluate((c) => window.__fw.setFpsCapForQa(c), 60);
  await page.evaluate(() => { window.__cap.marks.length = 0; window.__cap.on = true; });
  await page.waitForTimeout(6000);
  out.acceptance60 = await page.evaluate(() => window.__fw.frameCapDiagnostics());
  await page.evaluate((c) => window.__fw.setFpsCapForQa(c), 240);
  await page.waitForTimeout(6000);
  out.acceptance240 = await page.evaluate(() => window.__fw.frameCapDiagnostics());
  await page.evaluate(() => { window.__cap.on = false; });

  fs.writeFileSync(path.join(OUT, `${tag}.json`), `${JSON.stringify(out, null, 2)}\n`);
  console.log(JSON.stringify({
    tag,
    display: out.display,
    capAtBoot: {
      panelHz: out.capAtBoot.panelHz,
      panelSource: out.capAtBoot.panelSource,
      osPanelHz: out.capAtBoot.osPanelHz,
      measuredTickHz: out.capAtBoot.measuredTickHz,
    },
    table: out.rungs.map((r) => ({
      cap: r.cap,
      everyN: r.everyNVsyncs,
      skipped: r.skippedTicks,
      workBound: r.workBound,
      stillFps: r.still?.fps,
      stillMedian: r.still?.medianMs,
      walkFps: r.walking?.fps,
      walkMedian: r.walking?.medianMs,
      walkP95: r.walking?.p95Ms,
      walkP99: r.walking?.p99Ms,
      walkStdev: r.walking?.stdevMs,
      walkCadence: r.walking?.onCadencePct,
    })),
    acceptance: {
      at60: {
        everyN: out.acceptance60.everyNVsyncs,
        skipped: out.acceptance60.skippedTicks,
        workBound: out.acceptance60.workBound,
        presentedMs: out.acceptance60.presentedIntervalMs,
      },
      at240: {
        everyN: out.acceptance240.everyNVsyncs,
        skipped: out.acceptance240.skippedTicks,
        workBound: out.acceptance240.workBound,
        presentedMs: out.acceptance240.presentedIntervalMs,
      },
    },
    failures: out.failures,
  }, null, 2));
  return out;
}
