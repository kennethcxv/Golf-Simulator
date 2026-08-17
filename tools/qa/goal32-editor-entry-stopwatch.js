// THE EDITOR ENTRY, TIMED FROM THE REAL J PRESS — a stopwatch, not a census.
//
// The owner: "It is slow, it feels like it is about to crash." The claim to
// test: with the prewarm bailout dead, the editor-entry compiles are paid
// behind the first-load screen, so a played J press on a warmed session
// should flip modes without a freeze. Measured here:
//   tFlip        keydown -> courseMode === 'editor' (the synchronous cost)
//   worstGapMs   the longest rAF gap in the 6 s after J (the freeze he feels)
//   tInteractive keydown -> first moment 10 consecutive frames stay under
//                50 ms (the editor is actually usable)
//   arrivals     programs/geometries/textures delta across entry (mechanism)
// Then the same trace for EXIT, plus the stow handback: after returning to
// walk the held tool must be back in the hands — checked in PIXELS (magenta
// paint), because the scene-graph lied about this exact surface before.
//
//   node tools/qa/run-electron.cjs tools/qa/goal32-editor-entry-stopwatch.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const sharp = (await import('sharp')).default;
  const OUT = path.resolve('qa/goal32');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { tag: process.env.QA_TAG || 'editor-stopwatch', errs: [], failures: [] };
  const fail = (why) => out.failures.push(why);
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  const boot = await import(`file:///${bootPath}`);
  await boot.clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(6000); // past the deferred settle; the session is "in play"
  const vp = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  await page.mouse.click(vp.w / 2, vp.h / 2);
  await page.waitForTimeout(400);

  // equip: his condition is entering WITH a tool held
  await page.keyboard.press('f');
  await page.waitForTimeout(1500);
  out.tool = await page.evaluate(() => window.__fw.scene3d.walk.getTool?.() || null);

  const armTrace = (label) => page.evaluate((tag) => {
    const T = { tag, keyAt: 0, flipAt: 0, gaps: [], longtasks: [], before: null };
    window.__edClock = T;
    const r = window.__fw.scene3d.renderer || null;
    const info = window.__fw.scene3d?.rendererInfo?.() || null;
    T.before = info || (r ? {
      programs: r.info.programs.length,
      geometries: r.info.memory.geometries,
      textures: r.info.memory.textures,
    } : null);
    try {
      T.obs = new PerformanceObserver((l) => {
        for (const e of l.getEntries()) T.longtasks.push({ t: +e.startTime.toFixed(0), ms: +e.duration.toFixed(0) });
      });
      T.obs.observe({ entryTypes: ['longtask'] });
    } catch { /* gaps still stand */ }
    let last = performance.now();
    const pump = () => {
      const now = performance.now();
      T.gaps.push({ t: +now.toFixed(1), g: +(now - last).toFixed(1) });
      last = now;
      if (T.gaps.length < 2400) requestAnimationFrame(pump);
    };
    requestAnimationFrame(() => { last = performance.now(); requestAnimationFrame(pump); });
    const stamp = (e) => {
      if (e.key.toLowerCase() === 'j' && !T.keyAt) T.keyAt = performance.now();
    };
    window.addEventListener('keydown', stamp, true);
    T.unstamp = () => window.removeEventListener('keydown', stamp, true);
    return true;
  }, label);

  const readTrace = () => page.evaluate(() => {
    const T = window.__edClock;
    T.obs?.disconnect?.();
    T.unstamp?.();
    const r = window.__fw.scene3d.renderer || null;
    const after = r ? {
      programs: r.info.programs.length,
      geometries: r.info.memory.geometries,
      textures: r.info.memory.textures,
    } : null;
    // interactive: first frame at/after keyAt from which 10 straight gaps < 50 ms
    let tInteractive = null;
    for (let i = 0; i < T.gaps.length - 10; i += 1) {
      if (T.gaps[i].t < T.keyAt) continue;
      let ok = true;
      for (let k = i; k < i + 10; k += 1) if (T.gaps[k].g >= 50) { ok = false; break; }
      if (ok) { tInteractive = T.gaps[i].t; break; }
    }
    const post = T.gaps.filter((s) => s.t >= T.keyAt && s.t <= T.keyAt + 6000).map((s) => s.g);
    return {
      keyAt: +T.keyAt.toFixed(0),
      flipMs: T.flipAt ? +(T.flipAt - T.keyAt).toFixed(0) : null,
      worstGapMs: post.length ? Math.max(...post) : null,
      gapsOver100: post.filter((g) => g >= 100).length,
      tInteractiveMs: tInteractive ? +(tInteractive - T.keyAt).toFixed(0) : null,
      longtasksAfterKey: T.longtasks.filter((lt) => lt.t >= T.keyAt - 5),
      before: T.before,
      after,
      delta: (T.before && after) ? {
        programs: after.programs - T.before.programs,
        geometries: after.geometries - T.before.geometries,
        textures: after.textures - T.before.textures,
      } : null,
    };
  });

  // ---- ENTRY -----------------------------------------------------------------
  await armTrace('entry');
  await page.keyboard.press('j');
  await page.waitForFunction(() => {
    if (window.__fw.courseMode === 'editor') {
      if (!window.__edClock.flipAt) window.__edClock.flipAt = performance.now();
      return true;
    }
    return false;
  }, null, { timeout: 20000 });
  await page.waitForTimeout(6500);
  out.entry = await readTrace();
  await page.screenshot({ path: path.join(OUT, 'stopwatch-editor-entered.png') });

  // ---- a feel probe INSIDE the editor: camera drag + idle -----------------------
  await page.evaluate(() => {
    const T = { gaps: [] };
    window.__edIdle = T;
    let last = performance.now();
    const pump = () => {
      const now = performance.now();
      T.gaps.push(+(now - last).toFixed(1));
      last = now;
      if (T.gaps.length < 600) requestAnimationFrame(pump);
    };
    requestAnimationFrame(pump);
  });
  await page.mouse.move(vp.w / 2, vp.h / 2);
  await page.mouse.down({ button: 'right' });
  for (let i = 0; i < 24; i += 1) {
    await page.mouse.move(vp.w / 2 + Math.sin(i / 4) * 420, vp.h / 2 + Math.cos(i / 5) * 200, { steps: 4 });
    await page.waitForTimeout(80);
  }
  await page.mouse.up({ button: 'right' });
  await page.waitForTimeout(2500);
  out.inEditor = await page.evaluate(() => {
    const g = [...window.__edIdle.gaps].sort((a, b) => a - b);
    const q = (p) => g[Math.min(g.length - 1, Math.floor(g.length * p))];
    return { frames: g.length, median: q(0.5), p95: q(0.95), worst: g[g.length - 1] };
  });

  // ---- EXIT + the stow handback --------------------------------------------------
  await page.evaluate(() => {
    const T = window.__edClock;
    T.keyAt = 0; T.flipAt = 0; T.gaps.length = 0; T.longtasks.length = 0;
    try {
      T.obs = new PerformanceObserver((l) => {
        for (const e of l.getEntries()) T.longtasks.push({ t: +e.startTime.toFixed(0), ms: +e.duration.toFixed(0) });
      });
      T.obs.observe({ entryTypes: ['longtask'] });
    } catch { /* gaps still stand */ }
    let last = performance.now();
    const pump = () => {
      const now = performance.now();
      T.gaps.push({ t: +now.toFixed(1), g: +(now - last).toFixed(1) });
      last = now;
      if (T.gaps.length < 2400) requestAnimationFrame(pump);
    };
    requestAnimationFrame(pump);
    const r = window.__fw.scene3d.renderer;
    T.before = { programs: r.info.programs.length, geometries: r.info.memory.geometries, textures: r.info.memory.textures };
    T.keyAt = performance.now(); // the click IS the input; stamped at dispatch below
    const b = [...document.querySelectorAll('button')].find((x) => /Exit\s*$/.test((x.textContent || '').trim()));
    if (b) b.click();
  });
  await page.waitForFunction(() => {
    if (window.__fw.courseMode === 'walk') {
      if (!window.__edClock.flipAt) window.__edClock.flipAt = performance.now();
      return true;
    }
    return false;
  }, null, { timeout: 20000 });
  await page.waitForTimeout(6500);
  out.exit = await readTrace();
  out.toolBack = await page.evaluate(() => window.__fw.scene3d.walk.getTool?.() || null);
  out.heldAfterExit = await page.evaluate(() => window.__fw.scene3d.walk.heldToolDiagnostics());

  // pixels for the handback, same instrument as the viewmodel probe
  const paint = await page.evaluate(() => {
    const s3 = window.__fw.scene3d;
    let root = null;
    for (const child of s3.camera.children) {
      let hit = false;
      child.traverse?.((o) => { if (o.name === 'HeldWasher') hit = true; });
      if (hit) { root = child; break; }
    }
    if (!root) return { ok: false };
    const stash = [];
    root.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const repl = mats.map((orig) => {
        const m = new orig.constructor();
        if (m.emissive) { m.color?.set?.(0x000000); m.emissive.set(0xff00ff); m.emissiveIntensity = 4; }
        else m.color?.set?.(0xff00ff);
        m.toneMapped = false; m.fog = false; m.transparent = false; m.opacity = 1; m.side = orig.side;
        return m;
      });
      stash.push({ mesh: o, original: o.material });
      o.material = Array.isArray(o.material) ? repl : repl[0];
    });
    window.__hbStash = stash;
    return { ok: true, painted: stash.length };
  });
  out.handbackPaint = paint;
  await page.waitForTimeout(250);
  const shot = await page.screenshot({ path: path.join(OUT, 'stopwatch-handback-painted.png') });
  const { data, info } = await sharp(shot).raw().toBuffer({ resolveWithObject: true });
  let magenta = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    if (data[i] >= 140 && data[i + 1] <= 100 && data[i + 2] >= 140) magenta += 1;
  }
  out.handbackMagenta = magenta;
  await page.evaluate(() => { for (const { mesh, original } of (window.__hbStash || [])) mesh.material = original; window.__hbStash = null; });

  // ---- verdicts -------------------------------------------------------------------
  if (out.entry.worstGapMs == null) fail('entry trace captured no frames - instrument void');
  if (out.tool && !(out.handbackMagenta > 1500)) fail(`stow handback: tool not back in hands after exit (${out.handbackMagenta} magenta px)`);
  out.verdict = out.failures.length ? 'FAIL' : 'MEASURED';
  console.log(JSON.stringify({
    tag: out.tag,
    verdict: out.verdict,
    failures: out.failures,
    tool: out.tool,
    entry: out.entry,
    inEditor: out.inEditor,
    exit: out.exit,
    toolBack: out.toolBack,
    handbackMagenta: out.handbackMagenta,
  }, null, 2));
  fs.writeFileSync(path.join(OUT, `${out.tag}.json`), `${JSON.stringify(out, null, 2)}\n`);
  if (out.failures.length) process.exitCode = 1;
  return out;
}
