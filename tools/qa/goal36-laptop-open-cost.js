// THE LAPTOP'S OPEN, ITS PAGE SWITCHES, AND WHETHER ITS BAR TELLS THE TRUTH.
//
// It is at zero program arrivals now, so whatever is left is JS, not shaders.
// Two earlier readings said so and were not followed up: 541 ms on the laptop's
// pages with zero arrivals / geometries / textures (qa/goal34/warm5.json), and
// 5,113 ms on the same row from a cold profile (cold35.json).
//
// This driver answers four questions on the owner's own save:
//
//   1. WHAT FUNCTION. CDP sampling profiler across the real open, reduced to
//      self-time per call frame — the same reduction that named mopVerlet's
//      update at 554 ms with nothing equipped.
//   2. WHAT FUNCTION, PER PAGE. The same across each page switch, because a
//      page switch is a different code path from the first open and the owner
//      feels both.
//   3. LAGGY ONCE OPEN? rAF deltas for a fixed window with the laptop open and
//      the DOM overlay live, against the same window on the shop floor. Same
//      sampler, same length, one boot.
//   4. DOES THE BAR LIE? The 3D boot bar is a fixed 850 ms clock started 420 ms
//      after entry (clubhouse.js paintScreen 'boot'), and the interface is
//      built at 1,350 ms. So the bar is FULL before the build even starts, and
//      the build blocks the main thread. This measures the gap between the bar
//      reaching 100% and the interface actually being on the glass.
//
// CONTROL: a quiet no-input window immediately before each measured gesture. A
// leg whose control is already dirty is void and says so. And the second open
// is its own control for the first: cost that is first-time work collapses,
// cost that is per-open does not.
//
//   QA_RESUME=1 QA_ELECTRON_USER_DATA_DIR=<dir with saves/> \
//   node tools/qa/run-electron.cjs \
//     tools/qa/goal36-laptop-open-cost.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/goal36');
  fs.mkdirSync(OUT, { recursive: true });
  const tag = process.env.QA_TAG || 'laptop';
  const out = { tag, errs: [], failures: [] };
  const fail = (why) => { out.failures.push(why); console.log('FAIL:', why); };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  const aimPath = `${process.cwd()}/tools/qa/lib/nav-aim.mjs`.replace(/\\/g, '/');
  const boot = await import(`file:///${bootPath}`);
  const aim = await import(`file:///${aimPath}`);

  await page.evaluate(() => {
    const S = { frames: [], longtasks: [], last: performance.now(), marks: {} };
    window.__lt = S;
    const tick = () => {
      const n = performance.now();
      S.frames.push({ t: +n.toFixed(1), dt: +(n - S.last).toFixed(2) });
      if (S.frames.length > 60000) S.frames.splice(0, 20000);
      S.last = n;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    try {
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) S.longtasks.push({ t: +e.startTime.toFixed(0), ms: +e.duration.toFixed(0) });
      }).observe({ entryTypes: ['longtask'] });
    } catch { /* frame deltas stand */ }
  });

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
  out.warm = await page.evaluate(() => ({ ...(window.__fwWarm || {}) }));
  out.saveShape = await page.evaluate(() => {
    const st = window.__fw.state || {};
    return {
      day: st.day ?? null,
      txLog: st.txLog?.length ?? null,
      notifications: st.notifications?.length ?? null,
      products: st.products ? Object.keys(st.products).length : null,
      sections: st.sections?.length ?? null,
      holdings: st.holdings?.length ?? null,
      searchIndex: window.__fw.laptop?.searchIndexSize?.() ?? null,
    };
  });

  await aim.installAim(page);
  await page.mouse.click(Math.round(vp.w / 2), Math.round(vp.h / 2)); // capture the pointer
  await page.waitForTimeout(400);
  // walkInsideClubhouse reports `ok`, not `inside`. Reading the wrong field is
  // how prof1 recorded its shop-floor baseline outdoors and still called the
  // walk a failure.
  const walk = await aim.walkInsideClubhouse(page, vp);
  out.walk = {
    ok: walk.ok, legs: walk.legs ?? null, door: walk.door, end: walk.end, startDist: walk.startDist,
  };
  if (!walk.ok) fail('never got inside — the floor baseline below is OUTDOORS, not the shop floor');
  await page.waitForTimeout(2500);

  const now = () => page.evaluate(() => +performance.now().toFixed(1));

  // ---- frame-time sampler, used identically in both states -----------------
  const frameWindow = async (label, ms) => {
    const t0 = await now();
    await page.waitForTimeout(ms);
    const t1 = await now();
    const r = await page.evaluate(({ a, b }) => {
      const d = window.__lt.frames.filter((f) => f.t >= a && f.t <= b).map((f) => f.dt);
      if (!d.length) return null;
      const s = [...d].sort((x, y) => x - y);
      const sum = d.reduce((p, c) => p + c, 0);
      return {
        frames: d.length,
        meanMs: +(sum / d.length).toFixed(2),
        medianMs: +s[Math.floor(s.length / 2)].toFixed(2),
        p95Ms: +s[Math.floor(s.length * 0.95)].toFixed(2),
        maxMs: +s[s.length - 1].toFixed(2),
        fps: +(1000 / (sum / d.length)).toFixed(1),
      };
    }, { a: t0, b: t1 });
    console.log(`${label.padEnd(22)} ${r ? `${r.fps} fps · mean ${r.meanMs} · p95 ${r.p95Ms} · max ${r.maxMs} (${r.frames} frames)` : 'NO FRAMES'}`);
    return r;
  };

  const quiet = async (label, ms = 2000) => {
    const t0 = await now();
    await page.waitForTimeout(ms);
    const t1 = await now();
    const worst = await page.evaluate(({ a, b }) => {
      const d = window.__lt.frames.filter((f) => f.t >= a && f.t <= b).map((f) => f.dt);
      return d.length ? +Math.max(...d).toFixed(0) : 0;
    }, { a: t0, b: t1 });
    if (worst > 250) fail(`${label}: quiet control already carried ${worst} ms — the number below is the machine`);
    return worst;
  };

  // ---- the profiler ---------------------------------------------------------
  const startProfile = async () => {
    try {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Profiler.enable');
      await cdp.send('Profiler.setSamplingInterval', { interval: 150 });
      await cdp.send('Profiler.start');
      return cdp;
    } catch (e) {
      out.profilerError = String(e.message || e);
      return null;
    }
  };
  const stopProfile = async (cdp, name) => {
    if (!cdp) return null;
    try {
      const { profile } = await cdp.send('Profiler.stop');
      const self = new Map();
      const byId = new Map(profile.nodes.map((n) => [n.id, n]));
      for (let i = 0; i < (profile.samples?.length || 0); i += 1) {
        const id = profile.samples[i];
        self.set(id, (self.get(id) || 0) + (profile.timeDeltas?.[i] || 0));
      }
      const rows = [...self.entries()].map(([id, us]) => {
        const f = byId.get(id)?.callFrame || {};
        return {
          selfMs: +(us / 1000).toFixed(1),
          fn: f.functionName || '(anonymous)',
          url: (f.url || '').split('/').slice(-2).join('/'),
          line: (f.lineNumber ?? -2) + 1,
        };
      }).filter((r) => r.selfMs >= 5).sort((a, b) => b.selfMs - a.selfMs);
      fs.writeFileSync(path.join(OUT, `${tag}-${name}-profile.json`), JSON.stringify(profile));
      return rows;
    } catch (e) {
      out[`${name}ProfilerStop`] = String(e.message || e);
      return null;
    }
  };
  const printTop = (label, rows, n = 14) => {
    console.log(`\n-- ${label} — self time --`);
    for (const r of (rows || []).slice(0, n)) {
      console.log(`   ${String(r.selfMs).padStart(8)} ms  ${r.fn.padEnd(28)} ${r.url}:${r.line}`);
    }
  };

  // ---- STAMPS. When does the bar finish, and when is it usable? -------------
  // "Usable" = the frame that first PAINTS the interface, not the moment open()
  // returned: the build blocks, and a double rAF lands right after the paint
  // that includes it.
  await page.evaluate(() => {
    const S = window.__lt;
    S.marks = {};
    const lt = window.__fw.laptop;
    const ch = window.__fw.scene3d.clubhouse?.();
    const origOpen = lt.open.bind(lt);
    lt.open = (p) => {
      S.marks.openCalled = +performance.now().toFixed(1);
      const r = origOpen(p);
      S.marks.openReturned = +performance.now().toFixed(1);
      requestAnimationFrame(() => requestAnimationFrame(() => {
        S.marks.painted = +performance.now().toFixed(1); // built, not necessarily SHOWN
      }));
      return r;
    };
    if (ch?.laptopBoot) {
      const origBoot = ch.laptopBoot;
      ch.laptopBoot = (...a) => {
        S.marks.bootStarted = +performance.now().toFixed(1);
        return origBoot(...a);
      };
    }
    // ASK THE GAME HOW FULL THE BAR IS. The first cut of this driver re-derived
    // the shipped formula — `(now - bootT0) / 850` — which measures the build
    // it was written against and nothing else. clubhouse exposes the live value
    // now; where it does not (an older build), the formula is the labelled
    // fallback so the two are never confused.
    S.barTrack = [];
    S.trackBar = false;
    // USABLE IS NOT "open() RETURNED". The build is now done during the lid
    // swing with the interface hidden, so open() returns long before anything
    // is on screen — the first cut of this driver stamped that and reported a
    // 506 ms open that no player would experience. Usable is the first frame on
    // which the interface is genuinely PAINTED ON THE GLASS: the shell open,
    // its root not hidden, and the display showing the interface rather than
    // the boot screen. That definition holds on both builds, which is what lets
    // the control and the fix be compared at all.
    S.pumpBar = () => {
      if (!S.trackBar) return;
      const ch = window.__fw.scene3d.clubhouse?.();
      const lt = window.__fw.laptop;
      const mode = ch?.laptopScreenMode ? ch.laptopScreenMode() : null;
      const visible = lt?.root ? getComputedStyle(lt.root).visibility !== 'hidden' : false;
      const live = !!(lt?.isOpen?.() && visible && mode === 'live');
      S.barTrack.push({
        t: +performance.now().toFixed(1),
        p: ch?.laptopBootProgress ? ch.laptopBootProgress() : null,
        mode,
        live,
      });
      if (live && S.marks.usable == null) {
        S.marks.usable = +performance.now().toFixed(1);
        S.marks.frameChildren = document.querySelector('.lt-content')?.childElementCount ?? -1;
      }
      requestAnimationFrame(S.pumpBar);
    };
  });

  const openLaptop = async (label) => {
    const q = await quiet(`${label}-control`);
    const cdp = await startProfile();
    const before = await page.evaluate(() => {
      const i = window.__fw.scene3d.renderer.info;
      window.__lt.marks = {};
      return { programs: i.programs?.length ?? -1, geometries: i.memory.geometries, textures: i.memory.textures };
    });
    const t0 = await now();
    await page.evaluate(() => {
      window.__lt.barTrack = [];
      window.__lt.trackBar = true;
      window.__lt.pumpBar();
      window.__lt.marks.entered = +performance.now().toFixed(1);
      window.__fw.scene3d.walk.hooks.openLaptop?.(null);
    });
    await page.waitForFunction(() => window.__lt.marks.usable != null, null, { timeout: 120000 })
      .catch(() => fail(`${label}: the interface never reached the glass`));
    await page.waitForTimeout(600);
    const t1 = await now();
    const rows = await stopProfile(cdp, label);
    const after = await page.evaluate(() => {
      const i = window.__fw.scene3d.renderer.info;
      return { programs: i.programs?.length ?? -1, geometries: i.memory.geometries, textures: i.memory.textures };
    });
    const marks = await page.evaluate(() => ({ ...window.__lt.marks }));
    const bar = await page.evaluate(() => {
      window.__lt.trackBar = false;
      const track = window.__lt.barTrack;
      const live = track.some((s) => s.p != null);
      const full = live ? track.find((s) => s.p != null && s.p >= 0.999) : null;
      return {
        source: live ? 'clubhouse.laptopBootProgress()' : 'FALLBACK: bootStarted + 850 (old fixed clock)',
        samples: track.length,
        fullAt: full ? full.t : null,
        peak: live ? +Math.max(...track.filter((s) => s.p != null).map((s) => s.p)).toFixed(3) : null,
        modes: [...new Set(track.map((s) => s.mode))],
      };
    });
    const timing = await page.evaluate(({ a, b }) => ({
      worstFrameMs: (() => {
        const d = window.__lt.frames.filter((f) => f.t >= a && f.t <= b).map((f) => f.dt);
        return d.length ? +Math.max(...d).toFixed(0) : 0;
      })(),
      longtasks: window.__lt.longtasks.filter((x) => x.t >= a - 200 && x.t <= b && x.ms > 100),
    }), { a: t0, b: t1 });
    // THE BAR. Live value where the build exposes it; the old fixed clock
    // (bootStarted + 850) only as a labelled fallback.
    const barFullAt = bar.fullAt
      ?? (bar.source.startsWith('FALLBACK') && marks.bootStarted != null
        ? +(marks.bootStarted + 850).toFixed(1) : null);
    const row = {
      quietControlMs: q,
      entered: marks.entered,
      bootStarted: marks.bootStarted ?? null,
      bar,
      barFullAt,
      openCalled: marks.openCalled ?? null,
      openReturned: marks.openReturned ?? null,
      painted: marks.painted ?? null, // DOM built and laid out — not the same as shown
      usable: marks.usable ?? null, // on the glass, visible, screen live
      contentChildren: marks.frameChildren ?? null,
      msEnteredToUsable: marks.usable != null ? +(marks.usable - marks.entered).toFixed(1) : null,
      msBuild: marks.openReturned != null ? +(marks.openReturned - marks.openCalled).toFixed(1) : null,
      // the lie, in milliseconds: how long the bar sits at 100% before the
      // interface is on the glass
      msBarFullBeforeUsable: (barFullAt != null && marks.usable != null)
        ? +(marks.usable - barFullAt).toFixed(1) : null,
      ...timing,
      deltas: {
        programs: after.programs - before.programs,
        geometries: after.geometries - before.geometries,
        textures: after.textures - before.textures,
      },
      topSelf: rows,
    };
    if (row.msBarFullBeforeUsable != null && row.msBarFullBeforeUsable > 40) {
      fail(`${label}: the bar was full ${row.msBarFullBeforeUsable} ms before the interface was on the glass`);
    }
    console.log(`\n${label}: entered→usable ${row.msEnteredToUsable} ms · build ${row.msBuild} ms `
      + `· bar full ${row.msBarFullBeforeUsable} ms early (${bar.source}, peak ${bar.peak}) `
      + `· worst frame ${row.worstFrameMs} ms · +${row.deltas.programs}p/${row.deltas.geometries}g/${row.deltas.textures}t`);
    printTop(label, rows);
    await page.screenshot({ path: path.join(OUT, `${tag}-${label}.png`) });
    return row;
  };

  const closeLaptop = async () => {
    await page.evaluate(() => {
      const c = [...document.querySelectorAll('.lt-navbtn')].find((b) => b.classList.contains('lt-close'));
      if (c) c.click();
      else window.__fw.exitLaptop?.(true);
    });
    await page.waitForTimeout(2500);
  };

  // ---- 1. the shop floor baseline, before anything is opened ---------------
  out.floorFrames = await frameWindow('floor (before)', 5000);

  // ---- 2. the first open on his save ---------------------------------------
  out.firstOpen = await openLaptop('first-open');

  // ---- 3. laggy once open? --------------------------------------------------
  out.laptopFrames = await frameWindow('laptop open', 5000);

  // ---- 4. every page switch, profiled --------------------------------------
  const pages = await page.evaluate(() => [...document.querySelectorAll('.lt-navbtn')]
    .filter((b) => !b.classList.contains('lt-close'))
    .map((b) => ({ id: b.dataset.page || null, text: (b.textContent || '').trim().slice(0, 18) })));
  out.navButtons = pages;
  out.pageSwitches = [];
  for (let i = 0; i < pages.length; i++) {
    const q = await quiet(`page-${i}-control`, 1200);
    const cdp = await startProfile();
    const before = await page.evaluate(() => {
      const i2 = window.__fw.scene3d.renderer.info;
      window.__lt.marks = {};
      return { programs: i2.programs?.length ?? -1, geometries: i2.memory.geometries, textures: i2.memory.textures };
    });
    const t0 = await now();
    await page.evaluate((idx) => {
      const btns = [...document.querySelectorAll('.lt-navbtn')].filter((b) => !b.classList.contains('lt-close'));
      window.__lt.marks.pageClicked = +performance.now().toFixed(1);
      btns[idx]?.click();
      requestAnimationFrame(() => requestAnimationFrame(() => {
        window.__lt.marks.pagePainted = +performance.now().toFixed(1);
      }));
    }, i);
    await page.waitForFunction(() => window.__lt.marks.pagePainted != null, null, { timeout: 60000 })
      .catch(() => fail(`page ${i}: never painted`));
    await page.waitForTimeout(1400);
    const t1 = await now();
    const rows = await stopProfile(cdp, `page-${i}`);
    const info = await page.evaluate(({ a, b }) => {
      const i2 = window.__fw.scene3d.renderer.info;
      return {
        pageId: window.__fw.laptop?.pageId?.() ?? null,
        programs: i2.programs?.length ?? -1,
        geometries: i2.memory.geometries,
        textures: i2.memory.textures,
        paintMs: window.__lt.marks.pagePainted != null
          ? +(window.__lt.marks.pagePainted - window.__lt.marks.pageClicked).toFixed(1) : null,
        worstFrameMs: (() => {
          const d = window.__lt.frames.filter((f) => f.t >= a && f.t <= b).map((f) => f.dt);
          return d.length ? +Math.max(...d).toFixed(0) : 0;
        })(),
        longtasks: window.__lt.longtasks.filter((x) => x.t >= a - 200 && x.t <= b && x.ms > 60),
      };
    }, { a: t0, b: t1 });
    const row = {
      button: pages[i].text, pageId: info.pageId, quietControlMs: q,
      paintMs: info.paintMs,
      worstFrameMs: info.worstFrameMs, longtasks: info.longtasks,
      deltas: {
        programs: info.programs - before.programs,
        geometries: info.geometries - before.geometries,
        textures: info.textures - before.textures,
      },
      topSelf: (rows || []).slice(0, 8),
    };
    out.pageSwitches.push(row);
    console.log(`page ${String(pages[i].text).padEnd(16)} -> ${String(info.pageId).padEnd(12)} paint ${String(info.paintMs).padStart(7)} ms  worst ${String(info.worstFrameMs).padStart(5)} ms  `
      + `+${row.deltas.programs}p/${row.deltas.geometries}g/${row.deltas.textures}t  `
      + `top: ${(rows || []).slice(0, 3).map((r) => `${r.fn}@${r.selfMs}ms`).join(' ')}`);
  }
  await page.screenshot({ path: path.join(OUT, `${tag}-pages.png`) });

  // ---- 5. close, settle, and the second open as the first's control --------
  await closeLaptop();
  out.floorFramesAfter = await frameWindow('floor (after)', 5000);
  out.secondOpen = await openLaptop('second-open');
  await closeLaptop();

  out.verdict = {
    floorFps: out.floorFrames?.fps ?? null,
    laptopFps: out.laptopFrames?.fps ?? null,
    overlayCostsFrames: (out.floorFrames && out.laptopFrames)
      ? +(out.laptopFrames.meanMs - out.floorFrames.meanMs).toFixed(2) : null,
    firstOpenMs: out.firstOpen?.msEnteredToUsable ?? null,
    secondOpenMs: out.secondOpen?.msEnteredToUsable ?? null,
    firstBuildMs: out.firstOpen?.msBuild ?? null,
    secondBuildMs: out.secondOpen?.msBuild ?? null,
    barFullEarlyFirstMs: out.firstOpen?.msBarFullBeforeUsable ?? null,
    barFullEarlySecondMs: out.secondOpen?.msBarFullBeforeUsable ?? null,
    worstPageSwitchMs: Math.max(0, ...out.pageSwitches.map((p) => p.worstFrameMs)),
    worstPagePaintMs: Math.max(0, ...out.pageSwitches.map((p) => p.paintMs || 0)),
    pageProgramArrivals: out.pageSwitches.reduce((s, p) => s + Math.max(0, p.deltas?.programs || 0), 0),
    pageTextureArrivals: out.pageSwitches.reduce((s, p) => s + Math.max(0, p.deltas?.textures || 0), 0),
    insideForTheFloorBaseline: !!out.walk?.ok,
  };

  fs.writeFileSync(path.join(OUT, `${tag}.json`), `${JSON.stringify(out, null, 2)}\n`);
  console.log('\n== goal 36 laptop ==');
  console.log(JSON.stringify(out.verdict, null, 2));
  console.log(`failures ${out.failures.length}`);
  console.log(`evidence qa/goal36/${tag}.json`);
}
