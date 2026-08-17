// ITEM 5a — WHAT COSTS SIX SECONDS WHEN THE BROOM COMES OUT.
//
// goal34-editor-roundtrip-invalidation.js settled the premise: an editor round
// trip deletes NO warmed programs (proven detector, 0 deletions, three runs).
// But on a cold profile that same driver caught the owner's five seconds
// somewhere he did not point at — the FIRST REAL BELT TAP TO THE BROOM, before
// the editor was ever opened:
//
//     longtask 5,998 ms at t=68489, broom pressed at t=68263
//     programs 240 -> 241 (one arrival), geometries 2681 -> 2739 (+58),
//     textures +0
//
// A single program cannot be six seconds and a texture upload is not it either;
// +58 geometries inside a six-second MAIN-THREAD task is the shape of an asset
// being parsed in the player's hands. The boot belt warm is supposed to have
// equipped all nine tools under the veil, so either it did not run, or what it
// leaves behind is not what a real equip needs.
//
// This driver plays the session, reads what the warm claims it did, and puts the
// CDP sampling profiler around the one press. Its own control is the SECOND
// press of the same tool in the same session: if the cost is first-time work the
// second press is free, and if it is not, the profile is measuring the wrong
// thing.
//
//   QA_RESUME=1 QA_ELECTRON_USER_DATA_DIR=<fresh dir with saves/> \
//   node tools/qa/run-electron.cjs \
//     tools/qa/goal34-broom-equip-attribution.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/goal34');
  fs.mkdirSync(OUT, { recursive: true });
  const tag = process.env.QA_TAG || 'broom';
  const out = { tag, errs: [], failures: [] };
  const fail = (why) => { out.failures.push(why); console.log('FAIL:', why); };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  const boot = await import(`file:///${bootPath}`);

  await page.evaluate(() => {
    const S = { gaps: [], longtasks: [], last: performance.now() };
    window.__bq = S;
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

  // WHAT THE WARM CLAIMS. If belt is 'skipped' or short of 9/9 the six seconds
  // is simply an absent warm and no profile is needed to say so.
  out.warm = await page.evaluate(() => ({ ...(window.__fwWarm || {}) }));
  out.prewarm = await page.evaluate(() => {
    const d = window.__fw?.scene3d?.prewarmDiagnostics?.();
    return d ? { bailed: d.bailed ?? null, stages: d.stages?.length ?? null } : null;
  });

  const now = () => page.evaluate(() => +performance.now().toFixed(0));
  const snap = () => page.evaluate(() => {
    const i = window.__fw.scene3d.renderer.info;
    return {
      t: +performance.now().toFixed(0),
      programs: i.programs?.length ?? -1,
      geometries: i.memory.geometries,
      textures: i.memory.textures,
    };
  });

  const vp = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  await page.mouse.click(Math.round(vp.w / 2), Math.round(vp.h / 2));
  await page.waitForTimeout(500);

  // play: get inside, the way he does
  for (let leg = 0; leg < 6; leg += 1) {
    await page.keyboard.down('w');
    await page.waitForTimeout(leg === 0 ? 6500 : 1800);
    await page.keyboard.up('w');
    await page.waitForTimeout(600);
    const inside = await page.evaluate(() => {
      const w = window.__fw.scene3d.walk.state;
      const ch = window.__fw.scene3d.clubhouse?.();
      return ch?.isInside ? !!ch.isInside(w.x, w.z) : false;
    });
    out.inside = inside;
    if (inside) break;
  }
  if (!out.inside) fail('never got inside');

  await page.waitForFunction(
    () => (window.__fw.scene3d.matrixFreezeDiagnostics?.()?.framesSinceWalk || 0) > 950,
    null, { timeout: 240000 },
  ).catch(() => {});

  const tapTo = async (want, maxTaps = 14) => {
    for (let i = 0; i < maxTaps; i += 1) {
      const held = await page.evaluate(() => window.__fw.scene3d.walk.getTool?.() ?? null);
      if (held === want) return { ok: true, taps: i };
      await page.keyboard.press('f');
      await page.waitForTimeout(420);
    }
    return { ok: false, taps: maxTaps };
  };
  const stow = async () => {
    for (let i = 0; i < 14; i += 1) {
      const held = await page.evaluate(() => window.__fw.scene3d.walk.getTool?.() ?? null);
      if (held == null) return true;
      await page.keyboard.press('f');
      await page.waitForTimeout(380);
    }
    return false;
  };
  const quiet = async (label) => {
    await page.bringToFront().catch(() => {});
    const a = await now();
    await page.waitForTimeout(2600);
    const b = await now();
    const w = await page.evaluate(({ x, y }) => {
      const g = window.__bq.gaps.filter((q) => q.t >= x && q.t <= y).map((q) => q.ms);
      return g.length ? +Math.max(...g).toFixed(0) : 0;
    }, { x: a, y: b });
    out.quiet = { ...(out.quiet || {}), [label]: w };
    if (w > 300) fail(`quiet control before ${label} carried ${w} ms`);
  };

  const worstIn = async (a, b) => page.evaluate(({ x, y }) => {
    const g = window.__bq.gaps.filter((q) => q.t >= x && q.t <= y).map((q) => q.ms);
    const l = window.__bq.longtasks.filter((q) => q.t >= x - 500 && q.t <= y);
    return {
      worstGapMs: g.length ? +Math.max(...g).toFixed(0) : 0,
      longtasks: l.filter((q) => q.ms > 200),
    };
  }, { x: a, y: b });

  // ---- THE PRESS, PROFILED ---------------------------------------------------
  const profileAround = async (label, run) => {
    let cdp = null;
    try {
      cdp = await page.context().newCDPSession(page);
      await cdp.send('Profiler.enable');
      await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
      await cdp.send('Profiler.start');
    } catch (e) { out[`${label}Profiler`] = `unavailable: ${e.message}`; cdp = null; }
    const t0 = await now();
    const before = await snap();
    const result = await run();
    await page.waitForTimeout(2500);
    const t1 = await now();
    const after = await snap();
    let top = null;
    if (cdp) {
      try {
        const { profile } = await cdp.send('Profiler.stop');
        const self = new Map();
        const byId = new Map(profile.nodes.map((n) => [n.id, n]));
        for (let i = 0; i < (profile.samples?.length || 0); i += 1) {
          const id = profile.samples[i];
          self.set(id, (self.get(id) || 0) + (profile.timeDeltas?.[i] || 0));
        }
        top = [...self.entries()].map(([id, us]) => {
          const f = byId.get(id)?.callFrame || {};
          return {
            selfMs: +(us / 1000).toFixed(1),
            fn: f.functionName || '(anonymous)',
            url: (f.url || '').split('/').slice(-2).join('/'),
            line: (f.lineNumber ?? -2) + 1,
          };
        }).filter((r) => r.selfMs >= 20).sort((a, b) => b.selfMs - a.selfMs).slice(0, 18);
        fs.writeFileSync(path.join(OUT, `${tag}-${label}-profile.json`), JSON.stringify(profile));
      } catch (e) { out[`${label}Profiler`] = `stop failed: ${e.message}`; }
    }
    const timing = await worstIn(t0, t1);
    return {
      result,
      ...timing,
      deltas: {
        programs: after.programs - before.programs,
        geometries: after.geometries - before.geometries,
        textures: after.textures - before.textures,
      },
      topSelf: top,
    };
  };

  await quiet('firstBroom');
  out.firstBroom = await profileAround('first', () => tapTo('broom'));
  await page.screenshot({ path: path.join(OUT, `${tag}-first-broom.png`) });
  await stow();
  await page.waitForTimeout(900);

  // CONTROL: the same tool, the same gesture, second time this session.
  await quiet('secondBroom');
  out.secondBroom = await profileAround('second', () => tapTo('broom'));
  await page.screenshot({ path: path.join(OUT, `${tag}-second-broom.png`) });
  out.controlHolds = out.firstBroom.worstGapMs > 900 && out.secondBroom.worstGapMs < 400;
  if (!out.controlHolds) {
    fail('the first/second press control did not separate — either the first was '
      + 'already warm or the cost is not first-time work, and the profile below '
      + 'is not attributing what the owner felt');
  }

  fs.writeFileSync(path.join(OUT, `${tag}.json`), `${JSON.stringify(out, null, 2)}\n`);
  console.log(JSON.stringify({
    tag,
    bootPath: out.bootPath,
    warm: out.warm,
    quiet: out.quiet,
    first: {
      worstGapMs: out.firstBroom.worstGapMs,
      longtasks: out.firstBroom.longtasks,
      deltas: out.firstBroom.deltas,
      topSelf: (out.firstBroom.topSelf || []).slice(0, 10),
    },
    second: {
      worstGapMs: out.secondBroom.worstGapMs,
      longtasks: out.secondBroom.longtasks,
      deltas: out.secondBroom.deltas,
    },
    controlHolds: out.controlHolds,
    failures: out.failures,
  }, null, 2));
  return out;
}
