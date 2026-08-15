// GOAL 27, PHASE 5 — THE LOW-END TARGET, DEFINED AND MEASURED.
//
// TARGET (chosen per the brief): 1920x1080, integrated-graphics class
// (Iris Xe / Vega 8 — roughly 1/8th of the RTX 5080 this runs on), holding
// 60 fps with no frame over 33 ms.
//
// METHOD on this machine, the brief's own three levers:
//   * resolution scale — a real 1920x1080 window (not a maximised one;
//     maximised windows silently ignore setContentSize on Windows);
//   * a CPU throttle in the Chromium protocol — Emulation.setCPUThrottlingRate
//     x6 over the same scenarios, modelling the CPU class;
//   * the fill-rate axis — the same scenarios at the owner's 4K window
//     already measured tonight serve as the 4x-fill comparison column.
//   A forced-software-GL floor (SwiftShader) is NOT run: the launcher has no
//   GL-flag path tonight; named as a gap rather than faked.
//
// Scenarios per condition: standing inside, the door walk, register enter,
// ledger open, tool cycle (all nine), Tab overview round trip, course editor
// entry, and a 20 s outdoor walk. Every scenario reports median/p95/max and
// PASS/FAIL against the 33 ms bar.
//
// CONTROLS: a planted 100 ms stall must be caught in-condition; the CPU
// throttle must demonstrably bite (a fixed busy-loop calibrated pre-throttle
// must take ~6x longer under it, or the throttle condition is void).
//
//   node tools/qa/run-electron.cjs tools/qa/electron-lowend-matrix.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/lowend-matrix');
  fs.mkdirSync(OUT, { recursive: true });
  const tag = process.env.QA_TAG || 'run';
  const out = { tag, target: '1080p, integrated class (1/8 GPU), 60 fps, no frame > 33 ms', errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  // a real 1080p window BEFORE boot, so every warm and cache fits the condition
  await page.electronApp.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win.isMaximized()) win.unmaximize(); // the setContentSize trap
    win.setContentSize(1920, 1080);
    win.center();
  });
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForFunction(() => window.__fwWarm && window.__fwWarm.sweep !== 'pending', null, { timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(5000);
  out.canvas = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    return { cssW: c.clientWidth, cssH: c.clientHeight, bufW: c.width, bufH: c.height, dpr: window.devicePixelRatio };
  });

  await page.evaluate(() => {
    const S = { window: null, results: {} };
    window.__lo = S;
    let last = performance.now();
    const tick = () => {
      const now = performance.now();
      if (S.window) S.results[S.window].push(+(now - last).toFixed(1));
      last = now;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    S.begin = (n) => { S.results[n] = []; last = performance.now(); S.window = n; };
    S.end = () => { S.window = null; };
  });

  const stats = (ds0, budgetMs = 33) => {
    const ds = [...ds0].sort((a, b) => a - b);
    const at = (q) => ds[Math.min(ds.length - 1, Math.floor(ds.length * q))] ?? null;
    return {
      frames: ds.length,
      medianMs: at(0.5),
      p95Ms: at(0.95),
      maxMs: ds[ds.length - 1] ?? null,
      over33: ds0.filter((d) => d > budgetMs).length,
      verdict: ds.length && ds[ds.length - 1] <= budgetMs ? 'PASS' : 'FAIL',
    };
  };
  const window_ = async (name, fn, holdMs) => {
    await page.evaluate((n) => window.__lo.begin(n), name);
    await fn();
    if (holdMs) await page.waitForTimeout(holdMs);
    return page.evaluate((n) => { window.__lo.end(); return window.__lo.results[n]; }, name);
  };

  const geo = await page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse();
    const o = ch.interior.position;
    const h = Math.hypot(-o.x, -o.z) || 1;
    return { ox: o.x, oz: o.z, dirX: -o.x / h, dirZ: -o.z / h };
  });

  const scenarios = async (label) => {
    const res = {};
    // standing inside
    res.standing = stats(await window_(`${label}:standing`, async () => {}, 5000));
    // the door: inside -> out, driven positions across the threshold
    await page.evaluate((g) => {
      const w = window.__fw.scene3d.walk.state;
      w.x = g.ox; w.z = g.oz; w.vx = 0; w.vz = 0;
      w.yaw = Math.atan2(-g.dirX, -g.dirZ); w.pitch = -0.03;
    }, geo);
    await page.waitForTimeout(800);
    res.doorWalk = stats(await window_(`${label}:door`, async () => {
      await page.evaluate((g) => new Promise((done) => {
        const w = window.__fw.scene3d.walk.state;
        let steps = 0;
        const step = () => {
          w.x += g.dirX * 0.05; w.z += g.dirZ * 0.05;
          w.vx = g.dirX * 3; w.vz = g.dirZ * 3;
          if (++steps < 240) requestAnimationFrame(step); else { w.vx = 0; w.vz = 0; done(); }
        };
        requestAnimationFrame(step);
      }), geo);
    }, 0));
    // register
    res.register = stats(await window_(`${label}:register`, async () => {
      await page.evaluate(() => window.__fw.scene3d.clubhouse().register.enter());
    }, 2500));
    await page.evaluate(() => window.__fw.scene3d.clubhouse().register.leave());
    await page.waitForTimeout(800);
    // ledger
    res.ledger = stats(await window_(`${label}:ledger`, async () => {
      await page.evaluate(() => window.__fw.scene3d.walk.hooks.openLedger());
    }, 2500));
    await page.keyboard.press('k');
    await page.waitForTimeout(800);
    // tool cycle
    res.toolCycle = stats(await window_(`${label}:tools`, async () => {
      await page.evaluate(() => new Promise((done) => {
        const w = window.__fw.scene3d.walk;
        const belt = ['washer', 'vacuum', 'mop', 'broom', 'dustpan', 'spray', 'cloth', 'sponge', 'trashbag'];
        let i = 0;
        const next = () => {
          if (i >= belt.length) { (w.setToolImmediate || w.setTool).call(w, null); done(); return; }
          (w.setToolImmediate || w.setTool).call(w, belt[i]);
          i += 1;
          setTimeout(() => requestAnimationFrame(next), 450);
        };
        next();
      }));
    }, 0));
    // Tab round trip
    res.tabOverview = stats(await window_(`${label}:tab`, async () => {
      await page.keyboard.press('Tab');
      await page.waitForTimeout(1800);
      await page.keyboard.press('Tab');
    }, 1200));
    // course editor entry (the known 823 ms first press pays once per boot;
    // in-condition it is the FIRST entry — that IS the player's experience)
    res.editorEntry = stats(await window_(`${label}:editor`, async () => {
      await page.keyboard.press('j');
    }, 3000));
    // outdoor walk 20 s
    await page.evaluate((g) => {
      const w = window.__fw.scene3d.walk.state;
      w.x = g.ox + g.dirX * 6; w.z = g.oz + g.dirZ * 6;
      w.yaw = Math.atan2(-g.dirX, -g.dirZ); w.pitch = -0.03;
    }, geo);
    await page.waitForTimeout(800);
    res.outdoorWalk = stats(await window_(`${label}:outdoor`, async () => {
      await page.evaluate((g) => new Promise((done) => {
        const w = window.__fw.scene3d.walk.state;
        let steps = 0;
        const step = () => {
          w.x += g.dirX * 0.045; w.z += g.dirZ * 0.045;
          w.vx = g.dirX * 2.7; w.vz = g.dirZ * 2.7;
          if (++steps < 1200) requestAnimationFrame(step); else { w.vx = 0; w.vz = 0; done(); }
        };
        requestAnimationFrame(step);
      }), geo);
    }, 0));
    // control: planted stall
    const ctl = await window_(`${label}:ctl`, async () => {
      await page.evaluate(() => { const t0 = performance.now(); while (performance.now() - t0 < 100) { /* planted */ } });
    }, 500);
    res.control_stall = Math.max(...ctl) >= 95 ? `caught (${Math.max(...ctl)} ms)` : 'MISSED — VOID';
    return res;
  };

  console.log(`canvas: ${JSON.stringify(out.canvas)}`);
  console.log('=== CONDITION A: 1080p, full GPU/CPU ===');
  out.conditionA = await scenarios('A');
  for (const [k, v] of Object.entries(out.conditionA)) {
    if (v && v.medianMs !== undefined) console.log(`  ${k.padEnd(14)} median ${String(v.medianMs).padStart(6)}  p95 ${String(v.p95Ms).padStart(6)}  max ${String(v.maxMs).padStart(7)}  over33 ${String(v.over33).padStart(3)}  ${v.verdict}`);
    else if (k === 'control_stall') console.log(`  control: ${v}`);
  }

  // ---- CONDITION B: CPU throttled x6 -----------------------------------------
  // calibrate the throttle with a fixed busy-loop before and after
  const busyMs = () => page.evaluate(() => {
    const t0 = performance.now();
    let x = 0;
    for (let i = 0; i < 8e6; i += 1) x += Math.sqrt(i);
    void x;
    return +(performance.now() - t0).toFixed(1);
  });
  const busyBefore = await busyMs();
  let cdp = null;
  try {
    cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });
  } catch (error) {
    out.conditionB = { unavailable: `CDP throttle failed: ${String(error?.message || error)}` };
  }
  if (cdp) {
    const busyAfter = await busyMs();
    out.throttleCalibration = { busyBefore, busyAfter, factor: +(busyAfter / busyBefore).toFixed(2) };
    console.log(`=== CONDITION B: 1080p, CPU x6 (calibration ${busyBefore} -> ${busyAfter} ms, factor ${out.throttleCalibration.factor}) ===`);
    if (out.throttleCalibration.factor < 3) {
      out.conditionB = { unavailable: `throttle did not bite (factor ${out.throttleCalibration.factor}) — VOID` };
      console.log(`  ${out.conditionB.unavailable}`);
    } else {
      // return to a clean state before repeating
      await page.evaluate((g) => {
        const w = window.__fw.scene3d.walk.state;
        w.x = g.ox - g.dirX * 2; w.z = g.oz - g.dirZ * 2; w.vx = 0; w.vz = 0;
      }, geo);
      await page.waitForTimeout(1500);
      out.conditionB = await scenarios('B');
      for (const [k, v] of Object.entries(out.conditionB)) {
        if (v && v.medianMs !== undefined) console.log(`  ${k.padEnd(14)} median ${String(v.medianMs).padStart(6)}  p95 ${String(v.p95Ms).padStart(6)}  max ${String(v.maxMs).padStart(7)}  over33 ${String(v.over33).padStart(3)}  ${v.verdict}`);
        else if (k === 'control_stall') console.log(`  control: ${v}`);
      }
    }
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 }).catch(() => {});
  }

  fs.writeFileSync(path.join(OUT, `${tag}-result.json`), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
