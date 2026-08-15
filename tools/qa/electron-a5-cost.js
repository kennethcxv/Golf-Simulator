// A5's PRICE, measured rather than assumed (Requirement 7: "if a change costs
// frame time, say how much in the same breath as shipping it").
//
// Opening maximised on a 4K panel takes the drawing buffer from 2400x1410 to
// 3840x2055 - 2.33x the pixels - and every fill-bound cost in the renderer
// (GTAO, bloom, tonemap, the whole composer chain) scales with that. This walks
// the same fixed loop at both sizes and reports the frame times.
//
// Deliberately NOT a synthetic pose: the loop walks, turns and re-treads, which
// is the activity the 16 ms invariant is about. Both legs run the identical
// script; the only difference is the window.
//
//   A5_SIZE=1600x940 node tools/qa/run-electron.cjs tools/qa/electron-a5-cost.js --clubhouse=pine-hills-v2
//   A5_SIZE=native   (leaves the maximised window alone)
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/a5-cost');
  fs.mkdirSync(OUT, { recursive: true });
  const SIZE = process.env.A5_SIZE || 'native';
  const out = { size: SIZE, errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  if (SIZE !== 'native') {
    const [w, h] = SIZE.split('x').map(Number);
    await page.setViewportSize({ width: w, height: h });
  }
  // Fault 52: an unfocused Electron window throttles rAF to about 1 fps, which
  // manufactures 950 ms "frames" out of nothing.
  await page.bringToFront();

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  // Let the first-visit compiles finish so this measures STEADY cost, not load.
  await page.waitForTimeout(12000);

  out.buffer = await page.evaluate(() => {
    const c = window.__fw?.scene3d?.renderer?.domElement;
    return {
      drawingBuffer: { width: c?.width ?? null, height: c?.height ?? null },
      css: { width: c?.clientWidth ?? null, height: c?.clientHeight ?? null },
      pixelRatio: window.__fw?.scene3d?.renderer?.getPixelRatio?.() ?? null,
      renderScale: window.__fw?.preferences?.values?.display?.renderScale ?? null,
      quality: window.__fw?.preferences?.values?.display?.quality ?? null,
    };
  });

  // Sample frame deltas across a scripted walk driven through the real key
  // handlers, so the frames measured are frames the player's own movement
  // produces.
  await page.evaluate(() => {
    window.__a5 = { deltas: [], last: performance.now(), stop: false };
    const tick = () => {
      const now = performance.now();
      window.__a5.deltas.push(now - window.__a5.last);
      window.__a5.last = now;
      if (!window.__a5.stop) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  const key = async (k, ms) => {
    await page.keyboard.down(k);
    await page.waitForTimeout(ms);
    await page.keyboard.up(k);
  };
  await page.mouse.click(500, 400); // recapture look, the way a player does
  await page.waitForTimeout(300);
  for (let lap = 0; lap < 2; lap += 1) {
    await key('w', 2200);
    await page.mouse.move(500, 400);
    await page.mouse.move(900, 400, { steps: 20 });
    await key('a', 1400);
    await key('s', 2000);
    await page.mouse.move(500, 400, { steps: 20 });
    await key('d', 1400);
  }

  out.frames = await page.evaluate(() => {
    window.__a5.stop = true;
    // The first two samples straddle the sampler's own start; drop them.
    const d = window.__a5.deltas.slice(2).filter((x) => Number.isFinite(x));
    const sorted = [...d].sort((a, b) => a - b);
    const pct = (p) => +(sorted[Math.floor((sorted.length - 1) * p)] || 0).toFixed(1);
    return {
      samples: d.length,
      median: pct(0.5),
      p95: pct(0.95),
      p99: pct(0.99),
      worst: +Math.max(...d).toFixed(1),
      over16: d.filter((x) => x > 16).length,
      over33: d.filter((x) => x > 33).length,
      over100: d.filter((x) => x > 100).length,
    };
  });

  await page.screenshot({ path: path.join(OUT, `a5-cost-${SIZE}.png`) });
  fs.writeFileSync(path.join(OUT, `a5-cost-${SIZE}.json`), `${JSON.stringify(out, null, 2)}\n`);
  console.log(`A5COST[${SIZE}]`, JSON.stringify(out.buffer), JSON.stringify(out.frames));
  if (out.errs.length) console.log('pageerrors', JSON.stringify(out.errs.slice(0, 3)));
  return out;
}
