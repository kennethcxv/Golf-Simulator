// A2 — THE SHADOW COST IS SAMPLING, NOT BAKING. Which filter, and how much?
//
// The attribution ladder said shadows are 6.8 ms of a 16.9 ms frame at 4K. The
// obvious reading — "the 10 Hz fitted bake runs long" — is WRONG here, because
// renderer.shadowMap.autoUpdate is already false (courseScene.js:801): the maps
// are not regenerated per frame at all. What costs is the main pass SAMPLING
// those maps per pixel, and at 3840x2055 with PCFSoft that is a lot of taps.
//
// So this measures the filter, the light count, and the map size — the three
// things that decide tap cost — and A/Bs the one that can move without changing
// what casts:
//
//   baseline    whatever ships (PCFSoft = type 2)
//   pcf         type 1: same maps, fewer taps
//   restore     back to the shipped filter, re-measured
//
// Screenshots at every leg from the same standing spot, because a filter change
// is a VISIBLE change and a millisecond that costs the shadows their softness is
// not a free millisecond. The owner decides that trade, not the number.
//
// CONTROL: restore must land back on the baseline median. If it does not, the
// run measured drift and the A/B says nothing.
//
//   node tools/qa/run-electron.cjs tools/qa/goal33-a2-shadow-lever.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/goal33');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { tag: process.env.QA_TAG || 'a2-shadow', errs: [], failures: [], legs: {} };
  const fail = (why) => { out.failures.push(why); console.log('FAIL:', why); };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  const boot = await import(`file:///${bootPath}`);
  await boot.clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.bringToFront().catch(() => {});
  await page.waitForTimeout(5000);
  await boot.ownerResolution(page, page.electronApp);
  await page.waitForTimeout(1500);
  const vp = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  await page.mouse.click(Math.round(vp.w / 2), Math.round(vp.h / 2));
  await page.waitForTimeout(600);

  // ---- the anatomy: what is actually casting, at what size, with what filter -
  out.anatomy = await page.evaluate(() => {
    const s3 = window.__fw.scene3d;
    const r = s3.renderer;
    const lights = [];
    s3.scene.traverse((o) => {
      if (!o.isLight) return;
      lights.push({
        type: o.type,
        name: o.name || null,
        visible: o.visible,
        castShadow: !!o.castShadow,
        mapSize: o.shadow ? { x: o.shadow.mapSize.x, y: o.shadow.mapSize.y } : null,
        intensity: o.intensity,
      });
    });
    const gl = r.getContext();
    return {
      shadowMapEnabled: r.shadowMap.enabled,
      shadowMapType: r.shadowMap.type, // 0 basic, 1 PCF, 2 PCFSoft, 3 VSM
      shadowAutoUpdate: r.shadowMap.autoUpdate,
      lights,
      castingLights: lights.filter((l) => l.castShadow && l.visible).length,
      drawingBuffer: { w: gl.drawingBufferWidth, h: gl.drawingBufferHeight },
      programs: r.info.programs?.length ?? null,
    };
  });
  console.log('ANATOMY', JSON.stringify({
    type: out.anatomy.shadowMapType,
    autoUpdate: out.anatomy.shadowAutoUpdate,
    casting: out.anatomy.castingLights,
    lights: out.anatomy.lights.length,
    buffer: out.anatomy.drawingBuffer,
  }));

  await page.evaluate(() => {
    window.__pace = {
      start() {
        const s = { on: true, t: [], rendered: [] };
        window.__paceRun = s;
        const tick = () => {
          if (!s.on) return;
          s.t.push(performance.now());
          s.rendered.push(window.__fw.frameCapDiagnostics().renderedFrames ?? 0);
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      },
      stop() { const s = window.__paceRun; if (!s) return null; s.on = false; return { t: s.t, rendered: s.rendered }; },
    };
  });

  const quant = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)))];
  const analyse = (t, rendered) => {
    const times = t.slice(2);
    const rd = rendered.slice(2);
    const pt = [];
    for (let i = 1; i < rd.length; i += 1) if (rd[i] > rd[i - 1]) pt.push(times[i]);
    const xs = [];
    for (let i = 1; i < pt.length; i += 1) xs.push(pt[i] - pt[i - 1]);
    if (xs.length < 50) return null;
    const sorted = xs.slice().sort((a, b) => a - b);
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    return {
      n: xs.length,
      fps: +(1000 / mean).toFixed(1),
      median: +quant(sorted, 0.5).toFixed(2),
      p95: +quant(sorted, 0.95).toFixed(2),
      p99: +quant(sorted, 0.99).toFixed(2),
    };
  };

  const leg = async (label, apply, ms = 16000) => {
    if (apply) await page.evaluate(apply);
    // A filter change recompiles every shadowed material. Let that storm pass
    // before sampling, or the leg measures compilation instead of sampling.
    await page.waitForTimeout(6000);
    await page.evaluate(() => window.__pace.start());
    await page.keyboard.down('w');
    const cx = Math.round(vp.w / 2);
    const cy = Math.round(vp.h / 2);
    const t0 = Date.now();
    let dir = 1;
    while (Date.now() - t0 < ms) {
      await page.mouse.move(cx + dir * 320, cy, { steps: 24 });
      await page.waitForTimeout(30);
      await page.mouse.move(cx, cy, { steps: 24 });
      await page.waitForTimeout(30);
      dir *= -1;
    }
    await page.keyboard.up('w');
    const raw = await page.evaluate(() => window.__pace.stop());
    const stats = analyse(raw.t, raw.rendered);
    // Stand still and face the room for the picture, so the two shots differ by
    // the filter and not by where the walk happened to end.
    await page.waitForTimeout(900);
    const shot = path.join(OUT, `a2-${label}.png`);
    await page.screenshot({ path: shot });
    if (!stats) fail(`leg ${label}: too few presented frames`);
    out.legs[label] = { ...stats, screenshot: shot };
    console.log(`A2 ${label}`, JSON.stringify(stats));
    return stats;
  };

  const setType = (type) => page.evaluate((t) => {
    const r = window.__fw.scene3d.renderer;
    r.shadowMap.type = t;
    window.__fw.scene3d.scene.traverse((o) => {
      if (!o.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) if (m) m.needsUpdate = true;
    });
  }, type);

  await leg('baseline-pcfsoft', null);
  await setType(1);
  await leg('pcf', null);
  await setType(out.anatomy.shadowMapType);
  await leg('restored', null);

  const b = out.legs['baseline-pcfsoft'];
  const p = out.legs.pcf;
  const r = out.legs.restored;
  if (b && r && Math.abs(b.median - r.median) > 3) {
    fail(`restore did not return to baseline (${b.median} -> ${r.median} ms): the A/B measured drift`);
  }
  out.result = {
    shippedFilter: out.anatomy.shadowMapType,
    baselineMedianMs: b?.median ?? null,
    pcfMedianMs: p?.median ?? null,
    savedMs: b && p ? +(b.median - p.median).toFixed(2) : null,
    restoredMedianMs: r?.median ?? null,
  };
  fs.writeFileSync(path.join(OUT, 'a2-shadow-lever.json'), JSON.stringify(out, null, 2));
  console.log('A2 RESULT', JSON.stringify(out.result, null, 2));
  if (out.failures.length) process.exitCode = 1;
  return out;
}
