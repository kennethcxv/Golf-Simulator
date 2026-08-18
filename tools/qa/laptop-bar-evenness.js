// "IT GOES REALLY FAST TO 75% THEN TAKES 5 SECONDS TO FINISH THAT."
//
// The goal-36 work made the bar stop LYING — it no longer reports finished
// before the interface exists. It did not make it EVEN. The curve is 0 -> 0.9
// linearly across a fixed 480 ms nominal and then an asymptotic creep from 0.9
// to 0.99, so on any machine or save where the open takes longer than the
// authored beat the bar sprints to nine tenths and then crawls. That is exactly
// the shape he is describing.
//
// So this measures the SHAPE, not the duration. Every frame of a real open is
// sampled, and the bar is reduced to the thing the eye actually judges:
//
//   * how long each tenth of the bar took;
//   * the ratio of the slowest tenth to the fastest — 1.0 is perfectly even;
//   * the longest single stall, meaning the longest stretch with no visible
//     movement at all;
//   * and the gap between the bar arriving and the interface being usable.
//
// Two opens, because the second is the first one's control: anything that is
// first-time work collapses and anything per-open does not.
//
//   QA_RESUME=1 QA_ELECTRON_USER_DATA_DIR=<dir with saves/> \
//   node tools/qa/run-electron.cjs \
//     tools/qa/laptop-bar-evenness.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/laptop-bar');
  fs.mkdirSync(OUT, { recursive: true });
  const tag = process.env.QA_TAG || 'run';
  const out = { tag, errs: [], failures: [], opens: [] };
  const fail = (why) => { out.failures.push(why); console.log('FAIL:', why); };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.split('\\').join('/');
  const boot = await import(`file:///${bootPath}`);
  await boot.clickThroughMenu(page, { forceNew: !process.env.QA_RESUME });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.bringToFront().catch(() => {});
  await page.waitForTimeout(2500);
  await boot.ownerResolution(page, page.electronApp);
  await page.waitForTimeout(1500);

  // THE SAMPLER. Per animation frame, because that is the rate at which the bar
  // can possibly change — the canvas is repainted from clubhouse.updateLid. A
  // sampler on a timer would miss a stall that is caused by frames not running,
  // which is the most likely cause of a five-second tail.
  await page.evaluate(() => {
    const S = {
      track: [], on: false, marks: {}, frames: [], last: performance.now(),
    };
    window.__bar = S;
    const tick = () => {
      const n = performance.now();
      S.frames.push({ t: +n.toFixed(1), dt: +(n - S.last).toFixed(2) });
      if (S.frames.length > 40000) S.frames.splice(0, 10000);
      S.last = n;
      if (S.on) {
        const ch = window.__fw?.scene3d?.clubhouse?.();
        const p = ch?.laptopBootProgress ? ch.laptopBootProgress() : null;
        S.track.push({ t: +n.toFixed(1), p });
        // USABLE is not "the DOM exists". It is the interface on the glass:
        // visible, laid out over the screen rectangle, and hit-testable.
        if (S.marks.usable == null) {
          const root = document.querySelector('.laptop-screen');
          if (root && root.isConnected) {
            const cs = getComputedStyle(root);
            const r = root.getBoundingClientRect();
            if (cs.visibility !== 'hidden' && cs.display !== 'none' && r.width > 40 && r.height > 40) {
              S.marks.usable = +n.toFixed(1);
            }
          }
        }
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  // WHAT THE BOOT WARM ACTUALLY DID. The first open stalls the main thread for
  // seconds on some runs and not others, on the same build and the same save,
  // so the first question is whether the warm that exists to prevent exactly
  // that ran at all on this boot.
  out.warm = await page.evaluate(() => ({ ...(window.__fwWarm || {}) }));
  console.log(`warm: laptopView=${out.warm.laptopView} thumbs=${out.warm.laptopThumbs} `
    + `pages=${out.warm.laptopPages}`);

  const openOnce = async (label) => {
    const before = await page.evaluate(() => {
      const i = window.__fw.scene3d.renderer.info;
      return { programs: i.programs?.length ?? -1, geometries: i.memory.geometries, textures: i.memory.textures };
    });
    await page.evaluate(() => {
      window.__bar.track = [];
      window.__bar.marks = {};
      window.__bar.on = true;
      window.__bar.marks.pressed = +performance.now().toFixed(1);
      window.__fw.scene3d.walk.hooks.openLaptop?.(null);
    });
    await page.waitForFunction(() => window.__bar.marks.usable != null, null, { timeout: 120000 })
      .catch(() => fail(`${label}: the interface never reached the glass`));
    await page.waitForTimeout(900);
    const raw = await page.evaluate((b) => {
      window.__bar.on = false;
      const i = window.__fw.scene3d.renderer.info;
      return {
        track: window.__bar.track,
        marks: { ...window.__bar.marks },
        frames: window.__bar.frames.slice(-900),
        // A stall with NO new programs, geometries or textures is not the
        // renderer minting anything — it is the driver or the compositor, and
        // that is a different investigation from a shader compile.
        deltas: {
          programs: (i.programs?.length ?? -1) - b.programs,
          geometries: i.memory.geometries - b.geometries,
          textures: i.memory.textures - b.textures,
        },
      };
    }, before);
    await page.screenshot({ path: path.join(OUT, `${tag}-${label}.png`) });
    // close again
    await page.keyboard.press('Escape');
    await page.waitForTimeout(2500);
    return raw;
  };

  // Reduce a track to the shape. Deciles are measured from the PRESS, because
  // that is when the player's wait starts — not from when the bar appeared.
  const shapeOf = (raw, label) => {
    const t0 = raw.marks.pressed;
    const live = raw.track.filter((s) => s.p != null);
    if (!live.length) {
      fail(`${label}: the bar was never on the glass — nothing to measure`);
      return { label, samples: raw.track.length, live: 0 };
    }
    // THE HOLE THIS INSTRUMENT FELL INTO ON ITS FIRST WATCHED-FAIL RUN.
    //
    // The unfixed build produced a 3,248 ms blocking frame across the whole
    // open. No frames ran, so the sampler saw the bar exactly once — already
    // complete — and every tenth measured 0 ms, which sailed through the
    // evenness thresholds. A bar nobody could observe is not an even bar; it is
    // an unmeasured one, and reporting it as a pass is the exact class of lie
    // this file exists to prevent.
    if (live.length < 8) {
      fail(`${label}: only ${live.length} frames of the bar were ever drawn `
        + `(worst frame ${Math.max(...raw.frames.map((f) => f.dt)).toFixed(0)} ms) — `
        + 'the page did not animate during the open, so its SHAPE is unmeasured. '
        + 'That is a worse result than an uneven bar, not a better one.');
    }
    const first = live[0].t - t0;
    const deciles = [];
    let cursor = 0;
    for (let d = 1; d <= 10; d += 1) {
      const want = d / 10;
      let at = null;
      for (let i = cursor; i < live.length; i += 1) {
        if (live[i].p >= want - 1e-6) { at = live[i].t - t0; cursor = i; break; }
      }
      deciles.push({ decile: d, atMs: at === null ? null : +at.toFixed(0) });
    }
    // duration of each tenth
    const durations = [];
    let prev = first;
    for (const d of deciles) {
      if (d.atMs === null) { durations.push(null); continue; }
      durations.push(+(d.atMs - prev).toFixed(0));
      prev = d.atMs;
    }
    const got = durations.filter((v) => v != null && v >= 0);
    const slowest = got.length ? Math.max(...got) : null;
    const fastest = got.length ? Math.max(1, Math.min(...got)) : null;
    // longest stretch with no visible movement (a bar that stops reads as hung)
    let stall = 0;
    let stallFrom = null;
    let lastMove = live[0];
    for (const s of live) {
      if (s.p - lastMove.p >= 0.005) {
        if (s.t - lastMove.t > stall) { stall = s.t - lastMove.t; stallFrom = +lastMove.p.toFixed(3); }
        lastMove = s;
      }
    }
    const tail = live[live.length - 1].t - lastMove.t;
    if (tail > stall) { stall = tail; stallFrom = +lastMove.p.toFixed(3); }
    const usable = raw.marks.usable != null ? raw.marks.usable - t0 : null;
    const fullAt = live.find((s) => s.p >= 0.999);
    const worstFrame = (() => {
      const win = raw.frames.filter((f) => f.t >= t0 && f.t <= (raw.marks.usable ?? Infinity));
      return win.length ? +Math.max(...win.map((f) => f.dt)).toFixed(0) : null;
    })();
    return {
      label,
      samples: raw.track.length,
      live: live.length,
      barAppearedMs: +first.toFixed(0),
      usableMs: usable === null ? null : +usable.toFixed(0),
      fullAtMs: fullAt ? +(fullAt.t - t0).toFixed(0) : null,
      fullBeforeUsableMs: fullAt && usable !== null ? +((usable) - (fullAt.t - t0)).toFixed(0) : null,
      deciles, tenthDurations: durations,
      slowestTenthMs: slowest, fastestTenthMs: fastest,
      unevenness: slowest && fastest ? +(slowest / fastest).toFixed(2) : null,
      longestStallMs: +stall.toFixed(0),
      stalledAt: stallFrom,
      worstFrameMs: worstFrame,
      deltas: raw.deltas || null,
    };
  };

  for (const label of ['first-open', 'second-open']) {
    const raw = await openOnce(label);
    const shape = shapeOf(raw, label);
    out.opens.push(shape);
    console.log(`\n== ${label} ==`);
    console.log(`  bar appears ${shape.barAppearedMs} ms · usable ${shape.usableMs} ms `
      + `· full ${shape.fullAtMs} ms (${shape.fullBeforeUsableMs} ms before usable)`);
    console.log(`  tenths: ${JSON.stringify(shape.tenthDurations)}`);
    console.log(`  slowest ${shape.slowestTenthMs} ms / fastest ${shape.fastestTenthMs} ms `
      + `= ${shape.unevenness}x uneven · longest stall ${shape.longestStallMs} ms at ${shape.stalledAt}`);
    console.log(`  worst frame in the window: ${shape.worstFrameMs} ms · new p/g/t: ${JSON.stringify(shape.deltas)}`);
  }

  // WHAT COUNTS AS EVEN. A bar whose slowest tenth takes more than three times
  // its fastest is not pacing anything; it is two different bars glued together.
  // And no single stall may run past a second — past that the player has
  // decided it is stuck, which is what "then takes 5 seconds" means.
  const MAX_UNEVEN = 3;
  const MAX_STALL_MS = 1000;
  for (const s of out.opens) {
    if (s.unevenness != null && s.unevenness > MAX_UNEVEN) {
      fail(`${s.label}: the bar is ${s.unevenness}x uneven — slowest tenth ${s.slowestTenthMs} ms `
        + `against fastest ${s.fastestTenthMs} ms (${JSON.stringify(s.tenthDurations)})`);
    }
    if (s.longestStallMs > MAX_STALL_MS) {
      fail(`${s.label}: the bar sat still for ${s.longestStallMs} ms at ${
        Math.round((s.stalledAt || 0) * 100)}%`);
    }
    if (s.fullBeforeUsableMs != null && s.fullBeforeUsableMs > 250) {
      fail(`${s.label}: the bar was full ${s.fullBeforeUsableMs} ms before the interface was usable`);
    }
  }

  fs.writeFileSync(path.join(OUT, `${tag}.json`), `${JSON.stringify(out, null, 2)}\n`);
  console.log(`\nfailures ${out.failures.length} · evidence qa/laptop-bar/${tag}.json`);
}
