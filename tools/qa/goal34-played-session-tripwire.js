// THE FULL PLAYED SESSION, WITH THE TRIPWIRE READ AT THE END.
//
// The owner's route, in his order: walk in, tools, ledger, Tab, laptop, laptop
// tabs, editor, editor tools, editor exit, tools again, door. Every program that
// arrives after the veil lifts is a surface some warm missed, and this driver's
// job is to ENUMERATE them so they can be fixed as a set rather than one at a
// time as they are felt.
//
// WHY THIS ENUMERATION IS TRUSTWORTHY ON A WARM MACHINE, WHILE ITS TIMINGS ARE
// NOT: the NVIDIA driver's shader cache sits underneath Chromium's, is
// machine-wide, and survives a wiped profile — so after the first run of a build
// every later run links from a binary and the SECONDS vanish while the arrivals
// do not. Programs are per-process; they must be created every launch whatever
// the disk holds. So the arrival LIST here is exact on any machine state, and
// the worst-frame numbers beside it are only a floor. Measured on this build:
// the same editor open cost 6,309 ms on the first run of the night and 68 ms on
// the third, with the identical eight arrivals every time.
//
// Per surface: program-key set before and after, each arrival named by its
// nearest settled twin's differing fields, plus the worst rAF gap and any
// longtask. Each gesture carries a quiet no-input control; a leg whose control
// is already dirty is void and says so.
//
//   QA_RESUME=1 QA_ELECTRON_USER_DATA_DIR=<dir with saves/> \
//   node tools/qa/run-electron.cjs \
//     tools/qa/goal34-played-session-tripwire.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/goal34');
  fs.mkdirSync(OUT, { recursive: true });
  const tag = process.env.QA_TAG || 'session';
  const out = { tag, errs: [], failures: [], surfaces: [] };
  const fail = (why) => { out.failures.push(why); console.log('FAIL:', why); };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  const boot = await import(`file:///${bootPath}`);

  await page.evaluate(() => {
    const S = { gaps: [], longtasks: [], last: performance.now() };
    window.__ps = S;
    const tick = () => {
      const n = performance.now();
      if (n - S.last > 50) S.gaps.push({ t: +n.toFixed(0), ms: +(n - S.last).toFixed(1) });
      S.last = n;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    try {
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) S.longtasks.push({ t: +e.startTime.toFixed(0), ms: +e.duration.toFixed(0) });
      }).observe({ entryTypes: ['longtask'] });
    } catch { /* gaps stand */ }
  });

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
  out.warm = await page.evaluate(() => ({ ...(window.__fwWarm || {}) }));

  const now = () => page.evaluate(() => +performance.now().toFixed(0));
  const keys = () => page.evaluate(() => (window.__fw.scene3d.renderer.info.programs || [])
    .map((p) => String(p.cacheKey)));
  const mem = () => page.evaluate(() => {
    const i = window.__fw.scene3d.renderer.info;
    return { geometries: i.memory.geometries, textures: i.memory.textures };
  });
  const nameArrivals = (before, after) => page.evaluate(({ A, B }) => {
    const setA = new Set(A);
    return B.filter((x) => !setA.has(x)).map((key) => {
      const f = key.split(',');
      let best = null;
      for (const o of setA) {
        const g = o.split(',');
        if (g.length !== f.length) continue;
        const diffs = [];
        for (let i = 0; i < f.length && diffs.length <= 4; i += 1) {
          if (g[i] !== f[i]) diffs.push({ i, fromEnd: f.length - i, was: g[i], is: f[i] });
        }
        if (diffs.length && (!best || diffs.length < best.length)) best = diffs;
      }
      return { family: f[0]?.slice(0, 18), fields: f.length, nearestTwinDiffs: best || 'no-same-width-twin' };
    });
  }, { A: before, B: after });

  // Each surface: a quiet control, then the gesture, then the accounting.
  const surface = async (label, run, settleMs = 3000) => {
    await page.bringToFront().catch(() => {});
    const q0 = await now();
    await page.waitForTimeout(2200);
    const q1 = await now();
    const quietMs = await page.evaluate(({ a, b }) => {
      const g = window.__ps.gaps.filter((x) => x.t >= a && x.t <= b).map((x) => x.ms);
      return g.length ? +Math.max(...g).toFixed(0) : 0;
    }, { a: q0, b: q1 });

    const before = await keys();
    const m0 = await mem();
    const t0 = await now();
    let note = null;
    try { note = await run(); } catch (e) { note = `threw: ${e.message}`; }
    await page.waitForTimeout(settleMs);
    const t1 = await now();
    const after = await keys();
    const m1 = await mem();
    const timing = await page.evaluate(({ a, b }) => {
      const g = window.__ps.gaps.filter((x) => x.t >= a && x.t <= b).map((x) => x.ms);
      const l = window.__ps.longtasks.filter((x) => x.t >= a - 400 && x.t <= b && x.ms > 200);
      return { worstGapMs: g.length ? +Math.max(...g).toFixed(0) : 0, longtasks: l };
    }, { a: t0, b: t1 });
    const arrivals = await nameArrivals(before, after);
    const row = {
      label,
      note,
      quietMs,
      quietDirty: quietMs > 300,
      worstGapMs: timing.worstGapMs,
      longtasks: timing.longtasks,
      arrivals: arrivals.length,
      programs: after.length,
      dGeometries: m1.geometries - m0.geometries,
      dTextures: m1.textures - m0.textures,
      axes: arrivals,
    };
    if (row.quietDirty) fail(`${label}: quiet control carried ${quietMs} ms — this row's timing is void`);
    out.surfaces.push(row);
    console.log(`[${label}] arrivals=${row.arrivals} worst=${row.worstGapMs}ms geom=${row.dGeometries} tex=${row.dTextures} quiet=${quietMs}`);
    return row;
  };

  const vp = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  await page.mouse.click(Math.round(vp.w / 2), Math.round(vp.h / 2));
  await page.waitForTimeout(500);
  const held = () => page.evaluate(() => window.__fw.scene3d.walk.getTool?.() ?? null);
  const inside = () => page.evaluate(() => {
    const w = window.__fw.scene3d.walk.state;
    const ch = window.__fw.scene3d.clubhouse?.();
    return ch?.isInside ? !!ch.isInside(w.x, w.z) : false;
  });

  // 1 — WALK IN (the front door, held W, his gesture)
  await surface('01-walk-in-door', async () => {
    for (let leg = 0; leg < 6; leg += 1) {
      await page.keyboard.down('w');
      await page.waitForTimeout(leg === 0 ? 6500 : 1800);
      await page.keyboard.up('w');
      await page.waitForTimeout(600);
      if (await inside()) return `inside after ${leg + 1} legs`;
    }
    return 'never got inside';
  }, 2000);
  if (!(await inside())) fail('never got inside — every indoor row below is suspect');

  // let the deferred warms retire and the tripwire arm (frame 900 of walk)
  out.tripwireArmed = await page.waitForFunction(
    () => (window.__fw.scene3d.matrixFreezeDiagnostics?.()?.framesSinceWalk || 0) > 950,
    null, { timeout: 240000 },
  ).then(() => true).catch(() => false);

  // 2 — EVERY TOOL ON THE BELT, tapped round once
  await surface('02-tools-first-pass', async () => {
    const seen = [];
    for (let i = 0; i < 11; i += 1) {
      await page.keyboard.press('f');
      await page.waitForTimeout(700);
      const h = await held();
      if (h && !seen.includes(h)) seen.push(h);
    }
    return `held: ${seen.join(' ')}`;
  }, 2000);
  for (let i = 0; i < 12 && (await held()) != null; i += 1) {
    await page.keyboard.press('f');
    await page.waitForTimeout(350);
  }

  // 3 — THE LEDGER (k opens, k closes; Escape does not, by design)
  await surface('03-ledger', async () => {
    await page.keyboard.press('k');
    await page.waitForTimeout(3500);
    const open = await page.evaluate(() => !!window.__fw?.ledgerOpen);
    await page.keyboard.press('k');
    await page.waitForTimeout(1200);
    return `ledgerOpen was ${open}`;
  });

  // 4 — TAB, THE OVERVIEW, and back
  await surface('04-tab-overview', async () => {
    await page.keyboard.press('Tab');
    await page.waitForTimeout(4000);
    const mode = await page.evaluate(() => window.__fw?.courseMode ?? null);
    await page.keyboard.press('Tab');
    await page.waitForTimeout(2000);
    return `courseMode was ${mode}`;
  });

  // 5 — THE LAPTOP, first open of the session
  await surface('05-laptop-open', async () => {
    await page.evaluate(() => window.__fw.scene3d.walk.hooks.openLaptop?.(null));
    await page.waitForFunction(() => document.body.classList.contains('laptop-mode'), null, { timeout: 60000 })
      .catch(() => 'laptop-mode never applied');
    return 'opened';
  }, 4000);
  await page.screenshot({ path: path.join(OUT, `${tag}-laptop.png`) });

  // 6 — THE LAPTOP'S OWN NAV, every page
  await surface('06-laptop-tabs', async () => {
    const labels = await page.evaluate(async () => {
      const btns = [...document.querySelectorAll('.lt-navbtn')].filter((b) => !b.classList.contains('lt-close'));
      const seen = [];
      for (const b of btns) {
        b.click();
        seen.push((b.textContent || '').trim().slice(0, 18));
        await new Promise((r) => setTimeout(r, 420));
      }
      return seen;
    });
    return `pages: ${labels.join('|')}`;
  }, 3000);
  await page.evaluate(() => {
    const c = [...document.querySelectorAll('.lt-navbtn')].find((b) => b.classList.contains('lt-close'));
    c?.click();
  });
  await page.waitForTimeout(2500);

  // 7 — THE COURSE EDITOR
  await surface('07-editor-open', async () => {
    await page.keyboard.press('j');
    await page.waitForFunction(() => window.__fw?.courseMode === 'editor'
      && !!document.querySelector('.ced-rail'), null, { timeout: 90000 })
      .catch(() => 'editor never opened');
    return 'opened';
  }, 4000);
  await page.screenshot({ path: path.join(OUT, `${tag}-editor.png`) });

  // 8 — EVERY TOOL IN THE EDITOR'S RAIL, his "first tee" among them
  await surface('08-editor-tools', async () => {
    const clicked = await page.evaluate(async () => {
      const btns = [...document.querySelectorAll('.ced-tool')];
      const seen = [];
      for (const b of btns) {
        b.click();
        seen.push((b.textContent || '').trim().slice(0, 12));
        await new Promise((r) => setTimeout(r, 700));
      }
      return seen;
    });
    return `tools: ${clicked.join('|')}`;
  }, 4000);

  // 9 — LEAVING. Escape opens the pause menu instead; the Exit button leaves.
  await surface('09-editor-exit', async () => {
    const clicked = await page.evaluate(() => {
      const b = [...document.querySelectorAll('.ced-top-btn')].find((x) => /Exit/i.test(x.textContent || ''));
      if (!b) return false;
      b.click();
      return true;
    });
    await page.waitForTimeout(900);
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => /Discard & leave/i.test(x.textContent || ''));
      b?.click();
    });
    await page.waitForFunction(() => {
      if (window.__fw?.courseMode === 'editor') return false;
      const rail = document.querySelector('.ced-rail');
      return !rail || rail.offsetParent === null;
    }, null, { timeout: 90000 }).catch(() => 'never left');
    return `exit clicked ${clicked}`;
  }, 4000);
  out.afterExit = await page.evaluate(() => ({
    courseMode: window.__fw?.courseMode ?? null,
    walkActive: !!window.__fw?.scene3d?.walk?.isActive?.(),
  }));
  if (!out.afterExit.walkActive) fail('not walking after the editor exit — rows 10 and 11 are void');

  // 10 — THE TOOLS AGAIN, the surface he says came back
  await surface('10-tools-after-editor', async () => {
    const seen = [];
    for (let i = 0; i < 11; i += 1) {
      await page.keyboard.press('f');
      await page.waitForTimeout(700);
      const h = await held();
      if (h && !seen.includes(h)) seen.push(h);
    }
    return `held: ${seen.join(' ')}`;
  }, 2000);

  // 11 — BACK OUT THROUGH THE FRONT DOOR
  await surface('11-door-out', async () => {
    await page.keyboard.down('s');
    await page.waitForTimeout(6000);
    await page.keyboard.up('s');
    await page.waitForTimeout(1500);
    return `inside now: ${await inside()}`;
  }, 2000);
  await page.screenshot({ path: path.join(OUT, `${tag}-door-out.png`) });

  out.tripwire = await page.evaluate(() => window.__fw.scene3d.programArrivalTripwire?.() || []);
  out.totals = {
    arrivals: out.surfaces.reduce((a, s) => a + s.arrivals, 0),
    programsAtEnd: out.surfaces.length ? out.surfaces[out.surfaces.length - 1].programs : null,
    tripwireRows: Array.isArray(out.tripwire) ? out.tripwire.length : 0,
  };

  fs.writeFileSync(path.join(OUT, `${tag}.json`), `${JSON.stringify(out, null, 2)}\n`);
  console.log(JSON.stringify({
    tag,
    bootPath: out.bootPath,
    warm: out.warm,
    tripwireArmed: out.tripwireArmed,
    totals: out.totals,
    table: out.surfaces.map((s) => ({
      surface: s.label,
      arrivals: s.arrivals,
      worstMs: s.worstGapMs,
      dGeom: s.dGeometries,
      dTex: s.dTextures,
      quiet: s.quietMs,
    })),
    failures: out.failures,
  }, null, 2));
  return out;
}
