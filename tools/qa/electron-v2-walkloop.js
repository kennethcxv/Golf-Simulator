async (page) => {
  // VERIFIER 2 — A1: first-load segments + first-10s frame profile (vs the
  // addendum's HEAD numbers), then a 30 s real-input walk loop through the
  // shop sampling rAF deltas (count >33 ms + worst five).
  const out = { ok: true, phase: 'preboot', faults: [] };
  const ROOTP = process.cwd().replace(/\\/g, '/');
  const shots = `${ROOTP}/qa/electron/verify-v2`;
  const HITCH = 33.34;
  const ensureFront = async () => {
    for (let i = 0; i < 6; i += 1) {
      try {
        await page.electronApp.evaluate(({ BrowserWindow }) => {
          const win = BrowserWindow.getAllWindows()[0];
          if (!win) return;
          if (win.isMinimized()) win.restore();
          win.setAlwaysOnTop(true);
          win.show();
          win.moveTop();
          win.focus();
          win.setAlwaysOnTop(false);
        });
      } catch (_) { /* fall through to CDP */ }
      await page.bringToFront().catch(() => {});
      await page.waitForTimeout(250);
      const focused = await page.evaluate(() => document.hasFocus()).catch(() => false);
      if (focused) return true;
    }
    return false;
  };
  try {
    const boot = await import(`file:///${ROOTP}/tools/qa/lib/qa-boot.mjs`);
    out.focusedAtStart = await ensureFront();

    out.phase = 'menu';
    const menuReady = await page.waitForFunction(() => {
      const button = [...document.querySelectorAll('button')]
        .find((c) => /new game/i.test(c.textContent || ''));
      return (button && !button.disabled) ? performance.now() : false;
    }, null, { timeout: 90000 }).then((h) => h.jsonValue());
    out.menuReadyMs = +menuReady.toFixed(0); // ms since page start (performance origin)

    // Owner resolution AFTER the menu-ready stamp, BEFORE the load begins,
    // so the whole loaded session runs at acceptance size. V2_DEFAULT_WINDOW=1
    // keeps the stock harness window instead (control for size-sensitivity).
    if (process.env.V2_DEFAULT_WINDOW === '1') {
      out.windowCaption = 'DEFAULT harness window (owner-res skipped as control)';
    } else {
      out.windowCaption = (await boot.ownerResolution(page, page.electronApp)).caption;
    }

    out.menuPath = await boot.clickThroughMenu(page);
    await page.evaluate(() => {
      window.__v2t = { marks: { menuDone: performance.now() } };
      // Exact veil watcher: the load veil is DIV.load-veil (recon-proven).
      const w = window.__v2t;
      const tick = () => {
        try {
          const el = document.querySelector('.load-veil');
          let visible = false;
          if (el) {
            const cs = getComputedStyle(el);
            visible = cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0.03;
          }
          if (visible) {
            if (!w.marks.veilSeen) {
              w.marks.veilSeen = performance.now();
              w.veilClass = 'DIV.load-veil';
            }
            w.marks.veilLastSeen = performance.now();
          } else if (w.marks.veilSeen && !w.marks.veilGone) {
            w.marks.veilGone = performance.now();
          }
        } catch (_) { /* keep watching */ }
        if (!w.stopWatch) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

    out.phase = 'walkActive';
    await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive, null, { timeout: 120000 });
    await page.evaluate(() => { window.__v2t.marks.walkActive = performance.now(); });
    out.focusedAtWalkActive = await ensureFront();

    // Frame sampler + 500 ms renderer sampler, running from walkActive on.
    await page.evaluate(() => {
      const v2 = { deltas: [], renderer: [], marks: [], lastT: null, running: true };
      window.__v2 = v2;
      const loop = (t) => {
        if (!v2.running) return;
        if (v2.lastT != null) v2.deltas.push([t, +(t - v2.lastT).toFixed(2)]);
        v2.lastT = t;
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
      const readRenderer = () => {
        try {
          const s3 = window.__fw.scene3d;
          const r = s3.renderer || s3.gl || (s3.three && s3.three.renderer) || null;
          if (!r || !r.info) return null;
          return {
            t: performance.now(),
            tris: r.info.render.triangles,
            calls: r.info.render.calls,
            programs: r.info.programs ? r.info.programs.length : null,
          };
        } catch (_) { return null; }
      };
      window.__v2renderer = readRenderer;
      v2.rendererTimer = setInterval(() => {
        const row = readRenderer();
        if (row) v2.renderer.push(row);
      }, 500);
    });

    // Wait for the veil to go (or give up after 30 s past walkActive).
    out.phase = 'veil';
    await page.waitForFunction(
      () => window.__v2t.marks.veilGone
        || (performance.now() - window.__v2t.marks.walkActive) > 30000,
      null, { timeout: 45000 },
    );
    // First-10s window: keep sampling 11 s past the veil (or from now).
    await page.waitForTimeout(11500);
    const firstLoad = await page.evaluate(() => ({
      marks: window.__v2t.marks,
      veilClass: window.__v2t.veilClass || null,
      deltas: window.__v2.deltas,
      renderer: window.__v2.renderer,
    }));
    await page.evaluate(() => { window.__v2t.stopWatch = true; });

    const stats = (arr) => {
      if (!arr.length) return { n: 0 };
      const sorted = [...arr].sort((x, y) => y - x);
      const sum = arr.reduce((a, b) => a + b, 0);
      return {
        n: arr.length,
        over33: arr.filter((d) => d > HITCH).length,
        over100: arr.filter((d) => d > 100).length,
        worst5: sorted.slice(0, 5).map((d) => +d.toFixed(1)),
        median: +sorted[Math.floor(sorted.length / 2)].toFixed(2),
        mean: +(sum / arr.length).toFixed(2),
      };
    };
    const framesIn = (a, b) => firstLoad.deltas.filter(([t]) => t >= a && t < b).map(([, dt]) => dt);

    const m = firstLoad.marks;
    out.firstLoad = {
      menuReadyMs: out.menuReadyMs,
      menuDoneToWalkActiveMs: m.walkActive && m.menuDone ? +(m.walkActive - m.menuDone).toFixed(0) : null,
      walkActiveToVeilGoneMs: m.veilGone && m.walkActive ? +(m.veilGone - m.walkActive).toFixed(0) : null,
      pageToVeilGoneMs: m.veilGone ? +m.veilGone.toFixed(0) : null,
      pageToWalkActiveMs: m.walkActive ? +m.walkActive.toFixed(0) : null,
      veilClass: firstLoad.veilClass,
      veilSeen: m.veilSeen ? +m.veilSeen.toFixed(0) : null,
      first10sFromVeilGone: m.veilGone ? stats(framesIn(m.veilGone, m.veilGone + 10000)) : null,
      first10sFromWalkActive: stats(framesIn(m.walkActive, m.walkActive + 10000)),
      rendererSeries: firstLoad.renderer.map((r) => ({
        t: +r.t.toFixed(0), tris: r.tris, calls: r.calls, programs: r.programs,
      })),
    };
    await page.screenshot({ path: `${shots}/walkloop-01-postload.png` });

    if (process.env.V2_SKIP_LOOP === '1') {
      out.phase = 'done-first-load-only';
      await page.evaluate(() => {
        const v2 = window.__v2;
        v2.running = false;
        clearInterval(v2.rendererTimer);
      });
      return out;
    }

    // ---- WALK LOOP: teleport to the shop interior stand point, real input.
    out.phase = 'stage-loop';
    out.stage = await page.evaluate(() => {
      const fw = window.__fw;
      const walk = fw.scene3d.walk;
      const st = walk.state;
      const pos = (st.position && Number.isFinite(st.position.x)) ? st.position : st;
      const ip = fw.scene3d.clubhouse().interior.position;
      // Corridor proven walkable by run 2's own path: (-366.4,5.7)→(-368,-1.1).
      const a = { x: -366.4, z: 5.7 };
      const b = { x: -368.0, z: -1.1 };
      pos.x = a.x; pos.z = a.z;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      st.yaw = Math.atan2(-dx, -dz); // face down the corridor
      st.pitch = -0.05;
      return { interior: { x: ip.x, y: ip.y, z: ip.z }, stand: { x: pos.x, z: pos.z }, yaw: +st.yaw.toFixed(3) };
    });
    await page.waitForTimeout(2500); // interior settle (textures/shaders warm)
    out.focusedBeforeLoop = await ensureFront();
    const dims = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
    await page.mouse.click(dims.w / 2, dims.h / 2);
    await page.waitForTimeout(400);
    out.lockedForLoop = await page.evaluate(() => !!document.pointerLockElement);
    // Health gate: never grade a throttled window's loop.
    out.loopHealth = await page.evaluate(() => {
      const d = window.__v2.deltas.slice(-40).map((r) => r[1]).sort((a, b) => a - b);
      return d.length ? { n: d.length, median: d[Math.floor(d.length / 2)] } : { n: 0, median: null };
    });
    if (!out.loopHealth.n || out.loopHealth.median > 100) {
      out.abort = `window-unfocused before loop: rAF median ${out.loopHealth.median} ms`;
      return out;
    }

    // Calibrate yaw-per-pixel under the real lock (mouse.move is ABSOLUTE;
    // deltas are differences of successive positions).
    const cx = Math.round(dims.w / 2);
    const cy = Math.round(dims.h / 2);
    await page.mouse.move(cx, cy);
    await page.waitForTimeout(150);
    const yaw0 = await page.evaluate(() => window.__fw.scene3d.walk.state.yaw);
    await page.mouse.move(cx + 400, cy, { steps: 4 });
    await page.waitForTimeout(250);
    const yaw1 = await page.evaluate(() => window.__fw.scene3d.walk.state.yaw);
    let dyaw = yaw1 - yaw0;
    while (dyaw > Math.PI) dyaw -= 2 * Math.PI;
    while (dyaw < -Math.PI) dyaw += 2 * Math.PI;
    const perPx = dyaw / 400;
    out.calib = { yaw0: +yaw0.toFixed(3), yaw1: +yaw1.toFixed(3), perPx: +perPx.toFixed(6) };
    const halfTurnPx = Math.min(dims.w - 300, Math.round(Math.abs(Math.PI / (perPx || 0.002))));
    out.calib.halfTurnPx = halfTurnPx;
    const vxLeft = Math.max(60, Math.round((dims.w - halfTurnPx) / 2));
    const vxRight = vxLeft + halfTurnPx;
    await page.mouse.move(vxLeft, cy);
    await page.waitForTimeout(200);

    // Path sampler (500 ms) + fresh loop marks.
    await page.evaluate(() => {
      const v2 = window.__v2;
      v2.path = [];
      v2.pathTimer = setInterval(() => {
        try {
          const st = window.__fw.scene3d.walk.state;
          const p = (st.position && Number.isFinite(st.position.x)) ? st.position : st;
          v2.path.push({ t: +performance.now().toFixed(0), x: +p.x.toFixed(2), z: +p.z.toFixed(2) });
        } catch (_) { /* skip */ }
      }, 500);
      v2.marks.push({ label: 'loop-start', t: performance.now() });
    });

    out.phase = 'loop';
    // ~30 s of W/S shuttle down the corridor. Between legs, a right-then-left
    // double flick whips the view both ways but nets zero yaw, so W and S
    // retrace the same proven-free line (no wall pinning).
    const loopT0 = Date.now();
    let atRight = false;
    const doubleFlick = async () => {
      await page.mouse.move(atRight ? vxLeft : vxRight, cy, { steps: 8 });
      atRight = !atRight;
      await page.waitForTimeout(120);
      await page.mouse.move(atRight ? vxLeft : vxRight, cy, { steps: 8 });
      atRight = !atRight;
      await page.waitForTimeout(120);
    };
    while (Date.now() - loopT0 < 30000) {
      await page.keyboard.down('KeyW');
      await page.waitForTimeout(2200);
      await page.keyboard.up('KeyW');
      await doubleFlick();
      if (Date.now() - loopT0 >= 30000) break;
      await page.keyboard.down('KeyS');
      await page.waitForTimeout(2200);
      await page.keyboard.up('KeyS');
      await doubleFlick();
    }
    const loopData = await page.evaluate(() => {
      const v2 = window.__v2;
      v2.marks.push({ label: 'loop-end', t: performance.now() });
      v2.running = false;
      clearInterval(v2.rendererTimer);
      clearInterval(v2.pathTimer);
      return {
        deltas: v2.deltas, marks: v2.marks, path: v2.path, renderer: v2.renderer,
      };
    });
    await page.screenshot({ path: `${shots}/walkloop-02-loop-end.png` });

    const loopStart = loopData.marks.find((x) => x.label === 'loop-start').t;
    const loopEnd = loopData.marks.find((x) => x.label === 'loop-end').t;
    const loopFrames = loopData.deltas
      .filter(([t]) => t >= loopStart && t < loopEnd)
      .map(([, dt]) => dt);
    out.loop = {
      durationS: +((loopEnd - loopStart) / 1000).toFixed(1),
      ...stats(loopFrames),
      path: loopData.path.filter((p) => p.t >= loopStart - 250),
      programsAtStart: (() => {
        const rows = loopData.renderer.filter((r) => r.t <= loopStart);
        return rows.length ? rows[rows.length - 1].programs : null;
      })(),
      programsAtEnd: (() => {
        const rows = loopData.renderer.filter((r) => r.t <= loopEnd);
        return rows.length ? rows[rows.length - 1].programs : null;
      })(),
    };
    // Distance walked (sum of path steps) — proves real movement.
    let dist = 0;
    for (let i = 1; i < out.loop.path.length; i += 1) {
      const a = out.loop.path[i - 1]; const b = out.loop.path[i];
      dist += Math.hypot(b.x - a.x, b.z - a.z);
    }
    out.loop.distanceYd = +dist.toFixed(1);
    out.phase = 'done';
  } catch (error) {
    out.error = `${out.phase}: ${String((error && error.message) || error)}`;
    try { await page.screenshot({ path: `${shots}/walkloop-fail-${out.phase}.png` }); } catch (_) { /* best effort */ }
  }
  return out;
}
