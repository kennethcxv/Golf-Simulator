// A1 — WHAT IS ACTUALLY OVER BUDGET DURING ORDINARY PLAY.
//
// A2's control redirected this item. Doors cost nothing; the game spends a
// quarter to a third of every walking second over 16 ms, always, and the door
// was just where the owner noticed it. So A1's question is no longer "why do
// shaders compile after the veil" - a verifier already showed the post-veil
// window is the CLEAN one - it is "what makes an ordinary walking frame miss".
//
// The instrument splits every frame into two populations using the renderer's
// own bake counter (scene3d.post.stats().shadowBakes), which increments on the
// frame that re-renders the sun's shadow map at 10 Hz:
//
//   BAKE frames     - the frame that carried a shadow re-render
//   NON-BAKE frames - everything else
//
// If the over-budget frames are the bake frames, the lever is the bake. If both
// populations miss equally, it is not the bake and the theory dies here rather
// than in a fix that changes nothing.
//
// The program count rides along, so a compile cannot be mistaken for a bake.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-a1-attribute.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/a1-attribute');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.bringToFront().catch(() => {});
  await page.waitForTimeout(12000); // steady state, not load

  out.shadowConfig = await page.evaluate(() => {
    const s3 = window.__fw.scene3d;
    return {
      hasStats: typeof s3.post?.stats === 'function',
      quality: window.__fw.preferences?.values?.display?.quality ?? null,
      shadowQuality: window.__fw.preferences?.values?.display?.shadowQuality ?? null,
      shadowsOn: !!s3.renderer?.shadowMap?.enabled,
    };
  });

  await page.evaluate(() => {
    const s = { rows: [], stop: false };
    window.__a1 = s;
    const s3 = window.__fw.scene3d;
    const r = s3.renderer;
    let last = performance.now();
    let lastBakes = s3.post?.stats ? s3.post.stats().shadowBakes : 0;
    const tick = () => {
      const now = performance.now();
      const bakes = s3.post?.stats ? s3.post.stats().shadowBakes : 0;
      s.rows.push({
        t: +now.toFixed(1),
        dt: +(now - last).toFixed(2),
        bake: bakes !== lastBakes,
        programs: r.info.programs ? r.info.programs.length : -1,
        calls: r.info.render.calls,
        // A multi-second frame is not a bake and not a compile. These say
        // whether geometry or textures arrived on it - the signature of a
        // synchronous asset decode or upload landing in the middle of a walk.
        geoms: r.info.memory.geometries,
        texs: r.info.memory.textures,
      });
      lastBakes = bakes;
      last = now;
      if (!s.stop) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  // A real walk, through the real key handlers, with the mouse turning: the
  // activity the complaint is about.
  await page.mouse.click(700, 500);
  await page.waitForTimeout(300);
  const key = async (k, ms) => {
    await page.keyboard.down(k);
    await page.waitForTimeout(ms);
    await page.keyboard.up(k);
  };
  for (let lap = 0; lap < 3; lap += 1) {
    await key('w', 1800);
    await page.mouse.move(600, 420);
    await page.mouse.move(1000, 420, { steps: 18 });
    await key('a', 1200);
    await key('s', 1800);
    await page.mouse.move(600, 420, { steps: 18 });
    await key('d', 1200);
  }

  out.split = await page.evaluate(() => {
    const s = window.__a1;
    s.stop = true;
    // drop the first few: the sampler's own start
    const rows = s.rows.slice(3);
    const stat = (list) => {
      if (!list.length) return null;
      const d = [...list].sort((a, b) => a - b);
      const pct = (p) => +(d[Math.floor((d.length - 1) * p)] || 0).toFixed(2);
      return {
        n: list.length,
        median: pct(0.5),
        p90: pct(0.9),
        p99: pct(0.99),
        worst: +Math.max(...list).toFixed(2),
        over16: list.filter((x) => x > 16).length,
        over16pct: +(100 * list.filter((x) => x > 16).length / list.length).toFixed(1),
      };
    };
    const bake = rows.filter((r) => r.bake).map((r) => r.dt);
    const plain = rows.filter((r) => !r.bake).map((r) => r.dt);
    // did anything compile during the walk? a program delta would mean these
    // numbers are contaminated by compiles rather than describing the baseline
    const programs = rows.map((r) => r.programs);
    return {
      all: stat(rows.map((r) => r.dt)),
      bakeFrames: stat(bake),
      nonBakeFrames: stat(plain),
      bakeShare: +(100 * bake.length / rows.length).toFixed(1),
      programsFirst: programs[0],
      programsLast: programs[programs.length - 1],
      programsGrew: programs[programs.length - 1] - programs[0],
      callsMedian: (() => {
        const c = rows.map((r) => r.calls).sort((a, b) => a - b);
        return c[Math.floor(c.length / 2)];
      })(),
      // Every frame over 250 ms, with what changed across it. A stall with flat
      // programs, flat geometries and flat textures is a different animal from
      // one that compiled or uploaded, and the two need different fixes.
      stalls: rows.map((r, i) => ({ r, i })).filter(({ r }) => r.dt > 250).map(({ r, i }) => {
        const before = rows[Math.max(0, i - 1)];
        return {
          dt: r.dt,
          bake: r.bake,
          dPrograms: r.programs - before.programs,
          dGeoms: r.geoms - before.geoms,
          dTexs: r.texs - before.texs,
          calls: r.calls,
          callsBefore: before.calls,
        };
      }),
    };
  });

  fs.writeFileSync(path.join(OUT, 'a1-attribute.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('A1ATTR config', JSON.stringify(out.shadowConfig));
  console.log('A1ATTR split', JSON.stringify(out.split));
  if (out.errs.length) console.log('pageerrors', JSON.stringify(out.errs.slice(0, 3)));
  return out;
}
