// E1 / A4 — HOW LONG DOES SWITCHING A QUALITY PRESET COST?
//
// "Switching presets lags." Section A established what the frame is made of: the
// GPU runs a flat ~8.4 ms against an 8.33 ms refresh, and the post chain is 6.71
// of 9.11 ms. A preset switch touches exactly that machinery — shadow map size
// (which disposes and reallocates a GL texture) and the post chain — so a stall
// is plausible and its size is the question.
//
// Frame times are sampled continuously and the switch is marked, so the cost is
// attributed to the switch rather than to whatever else the frame was doing.
//
// THE CONTROL is a no-op switch: setting the preset to the value it ALREADY has.
// That runs the same call path and should cost nothing. If the no-op is as
// expensive as the real change, the cost is in the call and not in the work; if
// only the real change is expensive, the work is the cost. Without it a single
// large frame proves only that a large frame happened.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-e1-preset-lag.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/e1-preset-lag');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [], marks: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  const boot = await import(`file:///${bootPath}`);
  await boot.clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.bringToFront().catch(() => {});
  await page.waitForTimeout(6000);

  await page.evaluate(() => {
    window.__e1 = { rows: [], mark: 'settle', stop: false };
    let prev = performance.now();
    const tick = () => {
      const now = performance.now();
      window.__e1.rows.push({ dt: +(now - prev).toFixed(2), mark: window.__e1.mark });
      prev = now;
      if (!window.__e1.stop) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  const phase = (m) => page.evaluate((x) => { window.__e1.mark = x; }, m);
  const settle = async (ms) => { await page.waitForTimeout(ms); };

  await phase('idle');
  await settle(4000);

  // The CONTROL first: set the shadow preset to what it already is. Same call,
  // no actual change of state.
  await phase('noop');
  await page.evaluate(() => {
    const s3 = window.__fw.scene3d;
    const cur = s3.setShadowQuality?.({}) || {};
    s3.setShadowQuality?.({ walkMap: cur.walkMap, fullMap: cur.fullMap, bakeMs: cur.bakeMs });
  }).catch(() => {});
  await settle(2500);

  // A real change: shadow map size, which disposes and reallocates the GL target.
  await phase('shadowUp');
  await page.evaluate(() => window.__fw.scene3d.setShadowQuality?.({ walkMap: 4096 })).catch(() => {});
  await settle(2500);
  await phase('shadowDown');
  await page.evaluate(() => window.__fw.scene3d.setShadowQuality?.({ walkMap: 1024 })).catch(() => {});
  await settle(2500);
  await page.evaluate(() => window.__fw.scene3d.setShadowQuality?.({ walkMap: 2048 })).catch(() => {});
  await settle(1500);

  // The post chain off and on — the other half of what a preset touches.
  await phase('postOff');
  await page.evaluate(() => window.__fw.scene3d.setPostEnabled?.(false)).catch(() => {});
  await settle(2500);
  await phase('postOn');
  await page.evaluate(() => window.__fw.scene3d.setPostEnabled?.(true)).catch(() => {});
  await settle(2500);

  await page.evaluate(() => { window.__e1.stop = true; });
  const rows = await page.evaluate(() => window.__e1.rows);
  const stat = (m) => {
    const v = rows.filter((r) => r.mark === m).map((r) => r.dt).sort((a, b) => a - b);
    if (!v.length) return { n: 0 };
    return {
      n: v.length,
      median: +v[Math.floor(v.length / 2)].toFixed(2),
      worst: +v[v.length - 1].toFixed(2),
      over100: v.filter((d) => d > 100).length,
    };
  };
  for (const m of ['idle', 'noop', 'shadowUp', 'shadowDown', 'postOff', 'postOn']) {
    out.marks.push({ mark: m, ...stat(m) });
  }

  const by = Object.fromEntries(out.marks.map((m) => [m.mark, m]));
  out.verdict = {
    idleWorst: by.idle?.worst ?? null,
    // The control: a no-op switch should look like idle.
    noopWorst: by.noop?.worst ?? null,
    controlClean: (by.noop?.worst ?? 0) < Math.max(60, (by.idle?.worst ?? 0) * 2),
    shadowUpWorst: by.shadowUp?.worst ?? null,
    shadowDownWorst: by.shadowDown?.worst ?? null,
    postOffWorst: by.postOff?.worst ?? null,
    postOnWorst: by.postOn?.worst ?? null,
    worstSwitch: Math.max(
      by.shadowUp?.worst ?? 0, by.shadowDown?.worst ?? 0,
      by.postOff?.worst ?? 0, by.postOn?.worst ?? 0,
    ),
  };
  fs.writeFileSync(path.join(OUT, 'e1-preset-lag.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('E1-PRESET', JSON.stringify(out.verdict));
  for (const m of out.marks) console.log(`  ${m.mark.padEnd(11)} ${JSON.stringify(m)}`);
  return out;
}
