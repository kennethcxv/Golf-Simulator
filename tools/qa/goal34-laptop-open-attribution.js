// ITEM 2 — THE LAPTOP'S FIRST OPEN IN A PLAYED SESSION.
//
// goal34-played-session-tripwire.js caught it at 14,401 ms with a single
// 14,400 ms MAIN-THREAD LONGTASK and five program arrivals, on a boot whose own
// `__fwWarm` reports `laptopView: 'done'`. Five programs cannot be fourteen
// seconds — the true-cold translate+link on this stack is ~70 ms apiece — so the
// warm is not the thing that is failing and this is JS.
//
// The earlier D5 measurement (951 ms, one 686 ms longtask, arrivals 0,
// geometries 0, textures 0) was taken on a FRESH world from a fresh boot. The
// owner opens it on a resumed save with weeks of ledger behind it, after
// walking around. That difference is the whole question, so this driver plays
// first and profiles second.
//
// Its control is the SECOND open in the same session: laptop cost that is
// first-time work collapses, and cost that is per-open does not. Either answer
// names the fix, and the pair together is what stops "the probe said clean".
//
//   QA_RESUME=1 QA_ELECTRON_USER_DATA_DIR=<dir with saves/> \
//   node tools/qa/run-electron.cjs \
//     tools/qa/goal34-laptop-open-attribution.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/goal34');
  fs.mkdirSync(OUT, { recursive: true });
  const tag = process.env.QA_TAG || 'laptop';
  const out = { tag, errs: [], failures: [] };
  const fail = (why) => { out.failures.push(why); console.log('FAIL:', why); };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  const boot = await import(`file:///${bootPath}`);
  await page.evaluate(() => {
    const S = { gaps: [], longtasks: [], last: performance.now() };
    window.__lp = S;
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
  out.saveShape = await page.evaluate(() => {
    const st = window.__fw.state || {};
    return {
      day: st.day ?? null,
      txLog: st.txLog?.length ?? null,
      notifications: st.notifications?.length ?? null,
      products: st.products ? Object.keys(st.products).length : null,
      sections: st.sections?.length ?? null,
      holdings: st.holdings?.length ?? null,
    };
  });

  const now = () => page.evaluate(() => +performance.now().toFixed(0));
  const vp = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  await page.mouse.click(Math.round(vp.w / 2), Math.round(vp.h / 2));
  await page.waitForTimeout(500);
  for (let leg = 0; leg < 6; leg += 1) {
    await page.keyboard.down('w');
    await page.waitForTimeout(leg === 0 ? 6500 : 1800);
    await page.keyboard.up('w');
    await page.waitForTimeout(600);
    out.inside = await page.evaluate(() => {
      const w = window.__fw.scene3d.walk.state;
      const ch = window.__fw.scene3d.clubhouse?.();
      return ch?.isInside ? !!ch.isInside(w.x, w.z) : false;
    });
    if (out.inside) break;
  }
  if (!out.inside) fail('never got inside — this is not the played session');
  await page.waitForFunction(
    () => (window.__fw.scene3d.matrixFreezeDiagnostics?.()?.framesSinceWalk || 0) > 950,
    null, { timeout: 240000 },
  ).catch(() => {});

  // per-SKU thumbnail clock, in case the cost is the product previews
  await page.evaluate(() => {
    window.__thumbs = [];
    const ch = window.__fw.scene3d.clubhouse?.();
    if (ch && typeof ch.productThumb === 'function') {
      const orig = ch.productThumb;
      ch.productThumb = (sku) => {
        const t0 = performance.now();
        const r = orig(sku);
        window.__thumbs.push({ id: sku?.id || null, ms: +(performance.now() - t0).toFixed(1) });
        return r;
      };
    }
  });

  const openClose = async (label) => {
    await page.bringToFront().catch(() => {});
    const q0 = await now();
    await page.waitForTimeout(2200);
    const q1 = await now();
    const quietMs = await page.evaluate(({ a, b }) => {
      const g = window.__lp.gaps.filter((x) => x.t >= a && x.t <= b).map((x) => x.ms);
      return g.length ? +Math.max(...g).toFixed(0) : 0;
    }, { a: q0, b: q1 });
    if (quietMs > 300) fail(`${label}: quiet control carried ${quietMs} ms — the number below is the machine`);

    let cdp = null;
    try {
      cdp = await page.context().newCDPSession(page);
      await cdp.send('Profiler.enable');
      await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
      await cdp.send('Profiler.start');
    } catch (e) { out[`${label}Profiler`] = `unavailable: ${e.message}`; }

    const before = await page.evaluate(() => {
      const i = window.__fw.scene3d.renderer.info;
      window.__thumbs.length = 0;
      return { programs: i.programs?.length ?? -1, geometries: i.memory.geometries, textures: i.memory.textures };
    });
    const t0 = await now();
    await page.evaluate(() => window.__fw.scene3d.walk.hooks.openLaptop?.(null));
    await page.waitForFunction(() => document.body.classList.contains('laptop-mode'), null, { timeout: 90000 })
      .catch(() => fail(`${label}: laptop-mode never applied`));
    await page.waitForTimeout(6000);
    const t1 = await now();
    const after = await page.evaluate(() => {
      const i = window.__fw.scene3d.renderer.info;
      return { programs: i.programs?.length ?? -1, geometries: i.memory.geometries, textures: i.memory.textures };
    });

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
        }).filter((r) => r.selfMs >= 25).sort((a, b) => b.selfMs - a.selfMs).slice(0, 20);
        fs.writeFileSync(path.join(OUT, `${tag}-${label}-profile.json`), JSON.stringify(profile));
      } catch (e) { out[`${label}Profiler`] = `stop failed: ${e.message}`; }
    }
    const timing = await page.evaluate(({ a, b }) => ({
      worstGapMs: (() => {
        const g = window.__lp.gaps.filter((x) => x.t >= a && x.t <= b).map((x) => x.ms);
        return g.length ? +Math.max(...g).toFixed(0) : 0;
      })(),
      longtasks: window.__lp.longtasks.filter((x) => x.t >= a - 500 && x.t <= b && x.ms > 200),
      thumbs: window.__thumbs.length,
      thumbMs: +window.__thumbs.reduce((s, t) => s + t.ms, 0).toFixed(1),
      slowestThumbs: [...window.__thumbs].sort((x, y) => y.ms - x.ms).slice(0, 5),
    }), { a: t0, b: t1 });
    await page.screenshot({ path: path.join(OUT, `${tag}-${label}.png`) });
    await page.evaluate(() => {
      const c = [...document.querySelectorAll('.lt-navbtn')].find((b) => b.classList.contains('lt-close'));
      c?.click();
    });
    await page.waitForTimeout(3000);
    return {
      quietMs,
      ...timing,
      deltas: {
        programs: after.programs - before.programs,
        geometries: after.geometries - before.geometries,
        textures: after.textures - before.textures,
      },
      topSelf: top,
    };
  };

  out.firstOpen = await openClose('first');
  out.secondOpen = await openClose('second');
  out.controlSeparates = out.firstOpen.worstGapMs > 3 * Math.max(1, out.secondOpen.worstGapMs);

  fs.writeFileSync(path.join(OUT, `${tag}.json`), `${JSON.stringify(out, null, 2)}\n`);
  console.log(JSON.stringify({
    tag,
    bootPath: out.bootPath,
    warm: out.warm,
    saveShape: out.saveShape,
    first: {
      worstGapMs: out.firstOpen.worstGapMs,
      longtasks: out.firstOpen.longtasks,
      deltas: out.firstOpen.deltas,
      thumbs: out.firstOpen.thumbs,
      thumbMs: out.firstOpen.thumbMs,
      topSelf: (out.firstOpen.topSelf || []).slice(0, 14),
    },
    second: {
      worstGapMs: out.secondOpen.worstGapMs,
      longtasks: out.secondOpen.longtasks,
      deltas: out.secondOpen.deltas,
      thumbs: out.secondOpen.thumbs,
      thumbMs: out.secondOpen.thumbMs,
      topSelf: (out.secondOpen.topSelf || []).slice(0, 8),
    },
    controlSeparates: out.controlSeparates,
    failures: out.failures,
  }, null, 2));
  return out;
}
