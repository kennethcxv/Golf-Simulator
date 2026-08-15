// A3 — HOW LONG THE LEDGER ACTUALLY TAKES TO OPEN, AND WHETHER THE PLAYER KEEPS
// CONTROL WHILE IT DOES.
//
// The plan's original instrument was "worst frame delta in the 2 s window after
// the press". Four reviewers between them killed it:
//   * a 2 s window is SMALLER than the 2.0-2.9 s freeze a verifier already
//     measured, so it truncates the thing it exists to see (fault 69);
//   * frame deltas cannot see "the book arrived late" - a perfectly paced
//     three-second fill is green on every frame and the player still waits;
//   * a build that opens the cover and leaves the pages blank never hitches at
//     all;
//   * a smooth fill that freezes the mouse passes too, and that is exactly the
//     Requirement 5 violation the brief forbids.
//
// So this measures four separate things and refuses to collapse them:
//   1. press -> the book's own "open" state        (the code event)
//   2. press -> INK ON SCREEN                       (the pixel event; the
//      headline number, because it is the one the player experiences)
//   3. frame deltas, sampled open-ended until painted, never a fixed window
//   4. whether mouse-look still moves the camera DURING the open
//
// 1 and 2 are reported side by side deliberately. If they disagree, the
// disagreement is the finding.
//
// Modes, because the pixel readback perturbs the timing it would otherwise be
// measured beside:
//   A3_MODE=frames  (default) - timing + control, no readback
//   A3_MODE=pixels            - per-frame readback for press-to-ink only
//
// A3_LEG=cold|warm chooses first-open-of-session or a reopen. Cold means a
// FRESH user-data-dir passed on the command line: seeding localStorage is a
// no-op in Electron, so a driver that stages that way measures whatever profile
// happens to sit in userData (HARNESS_DEBT 6.2).
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/a3-ledger');
  fs.mkdirSync(OUT, { recursive: true });
  const MODE = process.env.A3_MODE || 'frames';
  const LEG = process.env.A3_LEG || 'cold';
  const out = { mode: MODE, leg: LEG, errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  const boot = await import(`file:///${bootPath}`);
  await boot.clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  // Fault 52: an unfocused window rAF-throttles to ~1 fps and manufactures
  // second-long "frames" out of nothing.
  await page.bringToFront().catch(() => {});
  // Let first-load streaming settle, so what follows is the book's cost and not
  // the load's.
  await page.waitForTimeout(9000);

  // ---- STAGE (outside every measured window, fault 61) -------------------
  out.stage = await page.evaluate(() => {
    const fw = window.__fw;
    const walk = fw.scene3d.walk;
    const st = walk.state;
    const ch = fw.scene3d.clubhouse();
    let lp = ch.ledgerBook.position;
    if (typeof lp === 'function') lp = ch.ledgerBook.position();
    const ip = ch.interior.position;
    const book = { x: ip.x + lp.x, z: ip.z + lp.z };
    const toCentre = { x: ip.x - book.x, z: ip.z - book.z };
    const len = Math.hypot(toCentre.x, toCentre.z) || 1;
    st.x = book.x + (toCentre.x / len) * 1.3;
    st.z = book.z + (toCentre.z / len) * 1.3;
    st.yaw = Math.atan2(-(book.x - st.x), -(book.z - st.z));
    st.pitch = -0.3;
    return { x: +st.x.toFixed(2), z: +st.z.toFixed(2), yaw: +st.yaw.toFixed(3) };
  });
  await page.waitForTimeout(900);
  out.focusHunt = await page.evaluate(async () => {
    const walk = window.__fw.scene3d.walk;
    const st = walk.state;
    const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });
    const baseYaw = st.yaw;
    for (const dp of [0, -0.15, 0.15, -0.3]) {
      for (const dy of [0, -0.2, 0.2, -0.45, 0.45]) {
        st.yaw = baseYaw + dy;
        st.pitch = -0.3 + dp;
        await sleep(140);
        const label = walk.getFocusLabel ? walk.getFocusLabel() : null;
        const text = label == null ? null : String(label);
        if (text && /ledger|read/i.test(text)) return { hit: true, label: text.slice(0, 90) };
      }
    }
    st.yaw = baseYaw; st.pitch = -0.3;
    return { hit: false };
  });
  if (!out.focusHunt.hit) {
    fs.writeFileSync(path.join(OUT, `a3-${LEG}-${MODE}.json`), `${JSON.stringify(out, null, 2)}\n`);
    console.log(`A3[${LEG}/${MODE}] ABORT: never focused the ledger`);
    return out;
  }

  // A warm leg opens and closes once first, OUTSIDE the sampled window.
  if (LEG === 'warm') {
    await page.keyboard.press('e');
    await page.waitForTimeout(4000);
    await page.keyboard.press('e');
    await page.waitForTimeout(2500);
  }

  // ---- ARM THE SAMPLERS --------------------------------------------------
  // Fault 57: the press must stamp its OWN mark. A capture-phase listener on
  // window, registered before the game's handler, cannot be eaten by the
  // stopPropagation the ledger key handler uses.
  await page.evaluate((mode) => {
    const s = {
      pressAt: null, deltas: [], lum: [], openAt: null, paintedAt: null,
      yaw: [], stop: false, mode,
    };
    window.__a3 = s;
    window.addEventListener('keydown', (e) => {
      if (s.pressAt == null && (e.key === 'e' || e.key === 'E')) s.pressAt = performance.now();
    }, true);
    const crop = document.createElement('canvas');
    crop.width = 96; crop.height = 96;
    const ctx = crop.getContext('2d', { willReadFrequently: true });
    const gl = window.__fw.scene3d.renderer.domElement;
    let last = performance.now();
    const tick = () => {
      const now = performance.now();
      s.deltas.push([now, now - last]);
      last = now;
      const walk = window.__fw.scene3d.walk;
      s.yaw.push([now, walk?.state?.yaw ?? null]);
      if (window.__fw.ledgerOpen && s.openAt == null) s.openAt = now;
      if (mode === 'pixels') {
        // Mean luminance of the middle of the frame. The open page is an
        // unlit cream basic material and is far brighter than the room, so
        // the crossing is where the page appears. Threshold is derived from
        // the PRE-PRESS baseline below, never a guessed constant.
        try {
          const w = gl.width; const h = gl.height;
          ctx.drawImage(gl, Math.round(w / 2 - 160), Math.round(h / 2 - 160), 320, 320, 0, 0, 96, 96);
          const d = ctx.getImageData(0, 0, 96, 96).data;
          let sum = 0;
          for (let i = 0; i < d.length; i += 4) sum += (d[i] + d[i + 1] + d[i + 2]) / 3;
          s.lum.push([now, sum / (d.length / 4)]);
        } catch (_) { /* readback unavailable this frame */ }
      }
      if (!s.stop) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, MODE);
  // POINTER LOCK, and the control for the control. Without the lock a mouse
  // move does not drive mouseLook at all, so "the camera did not move during
  // the open" would be a fact about the driver, not the game. The same gesture
  // is performed BEFORE the press and its yaw spread recorded: if the camera
  // does not move then either, this instrument cannot see camera motion and its
  // verdict on control is worthless.
  await page.mouse.click(700, 500);
  await page.waitForTimeout(400);
  out.pointerLocked = await page.evaluate(() => !!document.pointerLockElement);
  for (let i = 0; i < 10; i += 1) {
    await page.mouse.move(600 + i * 20, 430, { steps: 2 });
    await page.waitForTimeout(60);
  }
  await page.evaluate(() => {
    const s = window.__a3;
    const during = s.yaw.map(([, y]) => y).filter((y) => y != null);
    s.yawSpreadBeforePress = during.length
      ? +(Math.max(...during) - Math.min(...during)).toFixed(4) : null;
  });
  await page.waitForTimeout(1200); // pre-press baseline

  // ---- THE PRESS, on a real keyboard ------------------------------------
  await page.keyboard.press('e');

  // Requirement 5: the player must keep looking around while it happens. Real
  // mouse movement, right through the open.
  for (let i = 0; i < 14; i += 1) {
    await page.mouse.move(600 + i * 18, 420, { steps: 2 });
    await page.waitForTimeout(70);
  }

  // Open-ended: wait for the book to report itself painted, then a full second
  // more, and cap at 10 s so a hang is reported rather than hung on.
  await page.waitForFunction(() => {
    const d = window.__fw?.scene3d?.clubhouse?.()?.ledgerBook?.diagnostics?.();
    return !!(window.__fw?.ledgerOpen && d);
  }, null, { timeout: 12000 }).catch(() => {});
  await page.waitForTimeout(1500);

  out.result = await page.evaluate(() => {
    const s = window.__a3;
    s.stop = true;
    const t0 = s.pressAt;
    const after = s.deltas.filter(([t]) => t >= t0);
    const d = after.map(([, v]) => v);
    const sorted = [...d].sort((a, b) => a - b);
    const pct = (p) => +(sorted[Math.floor((sorted.length - 1) * p)] || 0).toFixed(1);
    // press -> ink: baseline from the pre-press samples, crossing after it.
    let inkMs = null; let baseline = null; let peak = null;
    if (s.lum.length) {
      const pre = s.lum.filter(([t]) => t < t0).map(([, v]) => v);
      if (pre.length > 4) {
        baseline = pre.reduce((a, b) => a + b, 0) / pre.length;
        const varr = pre.reduce((a, b) => a + (b - baseline) ** 2, 0) / pre.length;
        const sd = Math.sqrt(varr);
        const gate = baseline + Math.max(8, 5 * sd);
        const hit = s.lum.find(([t, v]) => t >= t0 && v > gate);
        if (hit) inkMs = +(hit[0] - t0).toFixed(1);
        peak = +Math.max(...s.lum.map(([, v]) => v)).toFixed(1);
      }
    }
    // did the camera keep moving while the book came up?
    const during = s.yaw.filter(([t]) => t >= t0 && t <= t0 + 1500).map(([, y]) => y)
      .filter((y) => y != null);
    const yawSpread = during.length ? +(Math.max(...during) - Math.min(...during)).toFixed(4) : null;
    return {
      pressAt: t0,
      openStateMs: s.openAt != null ? +(s.openAt - t0).toFixed(1) : null,
      inkMs,
      lumBaseline: baseline != null ? +baseline.toFixed(1) : null,
      lumPeak: peak,
      frames: {
        samples: d.length,
        median: pct(0.5),
        p95: pct(0.95),
        worst: d.length ? +Math.max(...d).toFixed(1) : null,
        over16: d.filter((x) => x > 16).length,
        over33: d.filter((x) => x > 33).length,
        over100: d.filter((x) => x > 100).length,
      },
      cameraMovedDuringOpen: yawSpread != null && yawSpread > 0.01,
      yawSpreadDuringOpen: yawSpread,
      // the control: the identical gesture before the press
      yawSpreadBeforePress: s.yawSpreadBeforePress ?? null,
      controlValid: (s.yawSpreadBeforePress ?? 0) > 0.01,
      pointerLocked: !!document.pointerLockElement,
      ledgerOpen: !!window.__fw.ledgerOpen,
    };
  });

  await page.screenshot({ path: path.join(OUT, `a3-${LEG}-${MODE}-open.png`) });
  fs.writeFileSync(path.join(OUT, `a3-${LEG}-${MODE}.json`), `${JSON.stringify(out, null, 2)}\n`);
  console.log(`A3[${LEG}/${MODE}]`, JSON.stringify(out.result));
  if (out.errs.length) console.log('pageerrors', JSON.stringify(out.errs.slice(0, 3)));
  return out;
}
