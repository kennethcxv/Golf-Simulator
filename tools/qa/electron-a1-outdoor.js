// A1 — WHERE THE OVER-16 FRAMES ACTUALLY ARE.
//
// Two levers are now closed by measurement: the load phase is 135 program
// compiles and nothing else, and freezing the interior's 2,611 auto-updating
// matrices buys 0.6 ms and changes the over-16 count by zero.
//
// The freeze probe also produced the number that redirects the search: median
// frame time INDOORS is 8.7 ms, comfortably inside budget, while the Phase 5
// gate reports 14.8% of frames over 16 ms and a verifier previously measured
// 97.1% on the OUTDOOR spawn route. I have been sampling in the wrong place.
//
// This samples indoors and outdoors in ONE run, so the two numbers come from the
// same machine, the same build and the same session - the previous 8.7 and 97.1
// came from different runs and are not strictly comparable. It attributes each
// sample with renderer.info: draw calls, triangles, programs.
//
// NEGATIVE CONTROL: the two positions must actually differ. If the walk fails to
// move the player, both samples describe the same spot and any difference is
// noise. The probe reports the distance travelled and the draw-call delta, and
// says so if they did not move.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/a1-outdoor');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.split('\\').join('/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.bringToFront().catch(() => {});
  await page.waitForTimeout(9000);

  // frame timing plus what the renderer was asked to do for those frames
  const sample = (frames) => page.evaluate((n) => new Promise((resolve) => {
    const r = window.__fw.scene3d.renderer || window.__fw.renderer;
    const dts = [];
    const calls = [];
    const tris = [];
    let last = performance.now();
    const tick = () => {
      const now = performance.now();
      dts.push(now - last);
      last = now;
      if (r?.info?.render) {
        calls.push(r.info.render.calls);
        tris.push(r.info.render.triangles);
      }
      if (dts.length >= n) {
        dts.shift();
        const sorted = [...dts].sort((a, b) => a - b);
        const med = (a) => (a.length ? +[...a].sort((x, y) => x - y)[Math.floor(a.length / 2)].toFixed(0) : null);
        resolve({
          n: dts.length,
          median: +sorted[Math.floor(sorted.length / 2)].toFixed(2),
          p90: +sorted[Math.floor(sorted.length * 0.9)].toFixed(2),
          worst: +Math.max(...dts).toFixed(1),
          over16: dts.filter((d) => d > 16).length,
          over16Pct: +(100 * dts.filter((d) => d > 16).length / dts.length).toFixed(1),
          over33: dts.filter((d) => d > 33).length,
          medianCalls: med(calls),
          maxCalls: calls.length ? Math.max(...calls) : null,
          medianTris: med(tris),
        });
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }), frames);

  const where = () => page.evaluate(() => {
    const st = window.__fw.scene3d.walk.state;
    const ch = window.__fw.scene3d.clubhouse?.();
    return {
      x: +st.x.toFixed(2),
      z: +st.z.toFixed(2),
      inside: ch?.isInside ? !!ch.isInside(st.x, st.z) : null,
    };
  });

  out.spotA = await where();
  out.indoor = await sample(160);

  // Walk out of the shop and into the open. Held keys, like a player.
  await page.mouse.click(700, 500).catch(() => {});
  for (const [key, ms] of [['s', 2600], ['a', 1400], ['s', 2600]]) {
    await page.keyboard.down(key);
    await page.waitForTimeout(ms);
    await page.keyboard.up(key);
    await page.waitForTimeout(250);
  }
  await page.waitForTimeout(2500);

  out.spotB = await where();
  out.outdoor = await sample(160);
  await page.screenshot({ path: path.join(OUT, 'a1-outdoor.png') });

  const moved = Math.hypot(out.spotB.x - out.spotA.x, out.spotB.z - out.spotA.z);
  const i = out.indoor;
  const o = out.outdoor;
  out.verdict = {
    // the control: did the player actually go anywhere
    movedYd: +moved.toFixed(2),
    controlValid: moved > 3,
    startedInside: out.spotA.inside,
    endedInside: out.spotB.inside,
    indoorMedianMs: i.median,
    outdoorMedianMs: o.median,
    indoorOver16Pct: i.over16Pct,
    outdoorOver16Pct: o.over16Pct,
    indoorCalls: i.medianCalls,
    outdoorCalls: o.medianCalls,
    callsRatio: i.medianCalls ? +(o.medianCalls / i.medianCalls).toFixed(2) : null,
    // what this run is here to decide
    outdoorIsWorse: o.over16Pct > i.over16Pct + 5,
  };
  fs.writeFileSync(path.join(OUT, 'a1-outdoor.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('A1-OUT verdict', JSON.stringify(out.verdict));
  console.log('A1-OUT indoor ', JSON.stringify(i));
  console.log('A1-OUT outdoor', JSON.stringify(o));
  if (out.errs.length) console.log('pageerrors', JSON.stringify(out.errs.slice(0, 3)));
  return out;
}
