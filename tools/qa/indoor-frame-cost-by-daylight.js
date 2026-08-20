// WHAT DOES ONE MORE POINT LIGHT COST, INDOORS, PER FRAME?
//
// The boot's "Warming the day" phase exists because the interior's visible light
// census CHANGES across the day, and three.js keys programs on counts by light
// type. shell.js setTimeMood toggles two daylight fills and one porch light:
//
//   full day    fills visible, porch not      -> 2
//   full night  fills not,     porch visible  -> 1
//   the ramps   both visible                  -> 3
//
// Three counts, so two censuses beyond boot, so 56 program links and ~1.5 s of
// every launch. Holding them all permanently visible (their intensities already
// go to zero on their own) makes the census constant and deletes the phase.
//
// The price is per-frame and forever, which is the trade the owner explicitly
// said must not be made silently. So this measures it: indoor frame time at a
// DAY minute and a NIGHT minute, p50/p99/max, from the real rAF loop, standing
// in the shop with the sim live.
//
// THE CONTROL is a deliberate 8 ms of busywork injected into the frame loop for
// a third pass. The instrument must report that pass as roughly 8 ms slower than
// the same conditions without it. A frame-time probe that cannot see 8 ms
// deliberately added to a frame cannot testify that an extra light is free --
// and "it costs nothing" is the claim this driver has to be able to refuse.
//
//   node tools/qa/run-electron.cjs tools/qa/indoor-frame-cost-by-daylight.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const OUT = 'qa/light-census';
  fs.mkdirSync(OUT, { recursive: true });
  const out = { failures: [], passes: [] };
  const fail = (w) => { out.failures.push(w); console.log('FAIL:', w); };

  const boot = await import(`file:///${process.cwd().split(String.fromCharCode(92)).join('/')}/tools/qa/lib/qa-boot.mjs`);
  await boot.clickThroughMenu(page, { forceNew: true, pinSeed: 0.4242 });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(2500);

  // Stand in the shop, lights working, so the frames measured are the ones the
  // player actually looks at rather than an empty corner.
  await page.evaluate(() => {
    const st = window.__fw.state;
    const reno = st.shop.reno;
    for (const k of Object.keys(reno.lightPanels)) reno.lightPanels[k] = 'working';
    for (const k of Object.keys(reno.architecture.components)) {
      reno.architecture.components[k].restored = true;
    }
    window.__fw.scene3d.clubhouse().refreshShopProgression?.();
    const ch = window.__fw.scene3d.clubhouse();
    const p = ch.localToWorld(0, 2.2);
    const w = window.__fw.scene3d.walk.state;
    w.x = p.x; w.z = p.z;
    if ('speedIdx' in st) st.speedIdx = 0;
  });
  await page.waitForTimeout(1500);

  // One sampler, used for every pass, so nothing differs but the condition.
  const sample = (minute, injectMs) => page.evaluate(async ([m, inject]) => {
    const st = window.__fw.state;
    st.clock.minutes = Math.floor(st.clock.minutes / 1440) * 1440 + m;
    await new Promise((r) => setTimeout(r, 1200));
    const frames = [];
    let last = 0;
    await new Promise((resolve) => {
      let n = 0;
      const loop = (t) => {
        if (inject) {
          const until = performance.now() + inject;
          while (performance.now() < until) { /* real work in the frame */ }
        }
        if (last) frames.push(t - last);
        last = t;
        n += 1;
        if (n < 320) requestAnimationFrame(loop);
        else resolve();
      };
      requestAnimationFrame(loop);
    });
    // the census as three.js sees it, so the pass is labelled by what it drew
    const cam = window.__fw.scene3d.camera || null;
    const counts = new Map();
    window.__fw.scene3d.scene.traverse((o) => {
      if (!o.isLight) return;
      let vis = o.visible;
      for (let p = o.parent; p && vis; p = p.parent) vis = p.visible;
      if (!vis) return;
      if (cam && !o.layers.test(cam.layers)) return;
      counts.set(o.type, (counts.get(o.type) || 0) + 1);
    });
    frames.sort((a, b) => a - b);
    const at = (q) => +frames[Math.min(frames.length - 1, Math.floor(q * frames.length))].toFixed(2);
    return {
      minute: m,
      census: [...counts.entries()].sort().map(([k, v]) => `${k}:${v}`).join('|'),
      p50: at(0.5),
      p99: at(0.99),
      max: +frames[frames.length - 1].toFixed(2),
      n: frames.length,
    };
  }, [minute, injectMs]);

  const day = await sample(720, 0);      // noon: fills on, porch off
  const night = await sample(60, 0);     // 01:00: fills off, porch on
  const control = await sample(720, 8);  // noon again, with 8 ms put into every frame

  out.passes = [
    { label: 'DAY   12:00', ...day },
    { label: 'NIGHT 01:00', ...night },
    { label: 'CONTROL day + 8 ms', ...control },
  ];
  for (const p of out.passes) {
    console.log(`${p.label.padEnd(20)} p50 ${String(p.p50).padStart(7)}  p99 ${String(p.p99).padStart(8)}`
      + `  max ${String(p.max).padStart(8)}  n=${p.n}  ${p.census}`);
  }

  const seen = control.p50 - day.p50;
  console.log(`CONTROL: 8 ms injected showed up as ${seen.toFixed(2)} ms on p50`);
  if (seen < 5) {
    fail(`the instrument could not see 8 ms deliberately added to every frame (saw ${seen.toFixed(2)} ms) — no number above is evidence`);
  }
  if (day.census === night.census) {
    fail('day and night report the SAME census — this build already holds the lights constant, so there is nothing to compare');
  }

  fs.writeFileSync(`${OUT}/indoor-frame-cost.json`, JSON.stringify(out, null, 2));
  console.log(`failures: ${out.failures.length}`);
  return out;
}
