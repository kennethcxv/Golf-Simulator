// A2 (Goal 23) — WHAT DOES FULLSCREEN AND 4K ACTUALLY COST?
//
// "Going fullscreen or raising the resolution makes it far worse." Every number
// this project has published about resolution was taken at whatever size the
// window happened to be, and A4 (Goal 17) already records one case of a
// published figure being void because the window changed size underneath it.
//
// So this driver reports, for every rung: the CSS size, the DRAWING BUFFER size,
// the device pixel ratio and the megapixels, beside the cost. A frame rate
// without the pixel count it was paid at is not a measurement.
//
// The rungs are the four the player can actually pick plus real fullscreen.
// Control: the buffer must CHANGE between rungs. A ladder where every rung
// renders the same number of pixels is measuring nothing, and the pixel budget
// in main.js applySettings can clamp two rungs onto the same buffer — which is
// itself worth knowing and is reported rather than hidden.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-a2-resolution-ladder.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/a2-resolution');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [], rungs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.bringToFront().catch(() => {});
  await page.waitForTimeout(6000);

  out.placed = await page.evaluate(() => {
    const fw = window.__fw;
    const ch = fw.scene3d.clubhouse();
    const st = fw.scene3d.walk.state;
    const ip = ch.interior.position;
    fw.state.clock.minutes = Math.floor(fw.state.clock.minutes / 1440) * 1440 + 14 * 60;
    fw.speedIdx = 0;
    st.x = ip.x; st.z = ip.z; st.pitch = -0.05;
    fw.preferences.set('display.fpsCap', 0); // uncapped: the ceiling, not the cap
    return { inside: !!ch.isInside(st.x, st.z, 0.35) };
  });

  out.screen = await page.evaluate(() => ({
    screenW: window.screen.width, screenH: window.screen.height,
    availW: window.screen.availWidth, availH: window.screen.availHeight,
    dpr: window.devicePixelRatio,
  }));

  const frame = () => page.evaluate(() => new Promise((resolve) => {
    const fw = window.__fw;
    const r = fw.scene3d.renderer;
    const canvas = r.domElement;
    const gl = r.getContext();
    const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') || gl.getExtension('EXT_disjoint_timer_query');
    const TARGET = ext ? (ext.TIME_ELAPSED_EXT !== undefined ? ext.TIME_ELAPSED_EXT : 0x88BF) : null;
    const gpu = []; const pending = []; const cpu = []; const intervals = [];
    let active = null;
    const origRender = fw.scene3d.render;
    fw.scene3d.render = function patched(...a) {
      const t0 = performance.now();
      const res = origRender.apply(this, a);
      cpu.push(performance.now() - t0);
      return res;
    };
    const info = r.info;
    let lastFrame = info.render.frame; let lastTs = performance.now();
    const t0 = lastTs;
    const tick = (ts) => {
      if (ext && active) { gl.endQuery(TARGET); pending.push(active); active = null; }
      if (ext) {
        for (let i = pending.length - 1; i >= 0; i -= 1) {
          if (gl.getQueryParameter(pending[i], gl.QUERY_RESULT_AVAILABLE)) {
            if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) gpu.push(gl.getQueryParameter(pending[i], gl.QUERY_RESULT) / 1e6);
            gl.deleteQuery(pending[i]); pending.splice(i, 1);
          }
        }
      }
      const f = info.render.frame;
      if (f !== lastFrame) { intervals.push(ts - lastTs); lastTs = ts; lastFrame = f; }
      if (ts - t0 < 7000) {
        if (ext) { const q = gl.createQuery(); try { gl.beginQuery(TARGET, q); active = q; } catch { gl.deleteQuery(q); } }
        requestAnimationFrame(tick);
      } else {
        fw.scene3d.render = origRender;
        setTimeout(() => {
          const med = (xs) => { const v = xs.slice().sort((a, b) => a - b); return v.length ? +v[Math.floor(v.length / 2)].toFixed(2) : null; };
          const p95 = (xs) => { const v = xs.slice().sort((a, b) => a - b); return v.length ? +v[Math.floor(v.length * 0.95)].toFixed(2) : null; };
          const iv = intervals.slice(5);
          resolve({
            cssSize: `${Math.round(canvas.clientWidth)}x${Math.round(canvas.clientHeight)}`,
            bufferSize: `${canvas.width}x${canvas.height}`,
            megapixels: +((canvas.width * canvas.height) / 1e6).toFixed(2),
            pixelRatio: +r.getPixelRatio().toFixed(3),
            drawCalls: info.render.calls,
            gpuMedianMs: med(gpu), gpuP95Ms: p95(gpu), gpuSamples: gpu.length,
            cpuSubmitMedianMs: med(cpu.slice(10)), cpuSubmitP95Ms: p95(cpu.slice(10)),
            achievedFps: med(iv) ? +(1000 / med(iv)).toFixed(1) : null,
            worstFrameMs: iv.length ? +Math.max(...iv).toFixed(2) : null,
          });
        }, 400);
      }
    };
    requestAnimationFrame(tick);
  }));

  // THE PLAYER'S OWN PATH, NOT THE PREFERENCE. `display.resolution` is a stored
  // string that nothing in the renderer consumes: the settings panel builds its
  // own list from fw:display-info and calls fw:set-resolution, which resizes the
  // real Electron window in PHYSICAL pixels. Setting the preference and
  // measuring — my first attempt at this driver — moved nothing and produced
  // four identical rungs, which is the "two selectors" shape aimed at myself.
  const setResolution = async (w, h) => {
    const r = await page.evaluate(async ([ww, hh]) => {
      const n = window.fairwayNative;
      if (!n?.setResolution) return 'bridge unavailable';
      try { await n.setResolution(ww, hh); return 'ok'; } catch (e) { return String(e.message || e); }
    }, [w, h]);
    await page.waitForTimeout(2600);
    return r;
  };
  const setWindowMode = async (mode) => page.evaluate(async (m) => {
    const n = window.fairwayNative;
    if (!n?.setWindowMode) return 'bridge unavailable';
    try { await n.setWindowMode(m); return 'ok'; } catch (e) { return String(e.message || e); }
  }, mode);

  out.displayInfo = await page.evaluate(async () => {
    try { return await window.fairwayNative.displayInfo(); } catch (e) { return String(e.message || e); }
  });

  const RUNGS = [
    { rung: '1080p', w: 1920, h: 1080 },
    { rung: '1440p', w: 2560, h: 1440 },
    { rung: '4k', w: 3840, h: 2160 },
  ];
  await setWindowMode('windowed');
  await page.waitForTimeout(1500);
  for (const r of RUNGS) {
    const applied = await setResolution(r.w, r.h);
    const m = await frame();
    out.rungs.push({ rung: r.rung, fullscreen: false, applied, ...m });
    console.log('A2', r.rung, applied, JSON.stringify(m));
  }

  const fs1 = await setWindowMode('fullscreen');
  await page.waitForTimeout(3000);
  const mFs = await frame();
  out.rungs.push({ rung: 'fullscreen', fullscreen: true, applied: fs1, ...mFs });
  console.log('A2 fullscreen', fs1, JSON.stringify(mFs));
  await setWindowMode('windowed');
  await page.waitForTimeout(2500);
  await page.evaluate(() => window.__fw.preferences.set('display.fpsCap', 60));

  // CONTROL: rungs that render the same buffer are not different rungs.
  const buffers = new Set(out.rungs.map((r) => `${r.fullscreen ? 'fs:' : ''}${r.bufferSize}`));
  out.controls = {
    rungsMeasured: out.rungs.length,
    distinctBuffers: buffers.size,
    everyRungDistinct: buffers.size === out.rungs.length,
    gpuInstrument: out.rungs.every((r) => r.gpuSamples > 0),
    inside: out.placed.inside,
  };
  fs.writeFileSync(path.join(OUT, 'resolution-ladder.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('A2-LADDER', JSON.stringify({ screen: out.screen, controls: out.controls }, null, 2));
  return out;
}
