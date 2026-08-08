// VERIFY-A / A3 — independent ledger attack. NOT the author's instrument.
//
// Differences from electron-a3-ledger.js, on purpose:
//   * "ink" is not a luminance crossing. Per frame this counts bright->dark
//     horizontal transitions (glyph strokes on the cream page) inside the
//     centre crop, so a bright-but-blank page cannot pass as ink.
//   * four legs in one session: COLD open, immediate REOPEN, open WHILE
//     STRAFING (does movement keep working, does the walk keep moving),
//     and open RIGHT AFTER a quality preset change.
//   * the reading light is read with the book SHUT, before anything opens,
//     and again after the final close (intensity must be 0 both times).
//   * per-frame program count + visible light count ride along: if the light
//     list still changes on open, the old recompile mechanism is back.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/verify-a');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [], gl: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));
  page.on('console', (m) => {
    const t = m.text();
    if (/GL_INVALID|glDrawElements|WebGL: CONTEXT/i.test(t)) out.gl.push(t.slice(0, 160));
  });

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.bringToFront().catch(() => {});
  await page.waitForTimeout(9000);

  const centre = await page.evaluate(() => ({ x: Math.round(window.innerWidth / 2), y: Math.round(window.innerHeight / 2) }));

  const stage = async () => {
    const st = await page.evaluate(() => {
      const fw = window.__fw;
      const walk = fw.scene3d.walk;
      const w = walk.state;
      const ch = fw.scene3d.clubhouse();
      let lp = ch.ledgerBook.position;
      if (typeof lp === 'function') lp = ch.ledgerBook.position();
      const ip = ch.interior.position;
      const book = { x: ip.x + lp.x, z: ip.z + lp.z };
      const toC = { x: ip.x - book.x, z: ip.z - book.z };
      const len = Math.hypot(toC.x, toC.z) || 1;
      w.x = book.x + (toC.x / len) * 1.3;
      w.z = book.z + (toC.z / len) * 1.3;
      w.yaw = Math.atan2(-(book.x - w.x), -(book.z - w.z));
      w.pitch = -0.3;
      return { x: +w.x.toFixed(2), z: +w.z.toFixed(2) };
    });
    await page.waitForTimeout(800);
    const hunt = await page.evaluate(async () => {
      const walk = window.__fw.scene3d.walk;
      const st = walk.state;
      const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });
      const baseYaw = st.yaw;
      for (const dp of [0, -0.15, 0.15, -0.3]) {
        for (const dy of [0, -0.2, 0.2, -0.45, 0.45]) {
          st.yaw = baseYaw + dy;
          st.pitch = -0.3 + dp;
          await sleep(130);
          const label = walk.getFocusLabel ? walk.getFocusLabel() : null;
          const text = label == null ? null : String(label);
          if (text && /ledger|read/i.test(text)) return { hit: true, label: text.slice(0, 80) };
        }
      }
      st.yaw = baseYaw; st.pitch = -0.3;
      return { hit: false };
    });
    return { st, hunt };
  };

  const lightNow = () => page.evaluate(() => {
    const d = window.__fw.scene3d.clubhouse().ledgerBook.diagnostics?.();
    let lights = 0;
    window.__fw.scene3d.scene.traverseVisible((o) => { if (o.isLight) lights += 1; });
    return {
      readingLight: d?.readingLight ?? null,
      bookState: d?.state ?? d?.bookState ?? null,
      ledgerOpen: !!window.__fw.ledgerOpen,
      visibleLights: lights,
    };
  });

  // ---- sampler --------------------------------------------------------
  const arm = () => page.evaluate(() => {
    const s = {
      pressAt: null, rows: [], snaps: [], stop: false, openAt: null,
    };
    window.__va3 = s;
    window.addEventListener('keydown', (e) => {
      if (s.pressAt == null && (e.key === 'e' || e.key === 'E')) s.pressAt = performance.now();
    }, true);
    const gl = window.__fw.scene3d.renderer.domElement;
    const crop = document.createElement('canvas');
    crop.width = 128; crop.height = 128;
    const ctx = crop.getContext('2d', { willReadFrequently: true });
    const r = window.__fw.scene3d.renderer;
    const scene = window.__fw.scene3d.scene;
    const walk = window.__fw.scene3d.walk;
    let last = performance.now();
    let lastSnap = 0;
    const tick = () => {
      const now = performance.now();
      let mean = null; let bright = null; let inkEdges = null;
      try {
        const w = gl.width; const h = gl.height;
        ctx.drawImage(gl, Math.round(w / 2 - 200), Math.round(h / 2 - 200), 400, 400, 0, 0, 128, 128);
        const d = ctx.getImageData(0, 0, 128, 128).data;
        let sum = 0; let b = 0; let ink = 0;
        for (let i = 0; i < d.length; i += 4) {
          const l = (d[i] + d[i + 1] + d[i + 2]) / 3;
          sum += l;
          if (l > 165) b += 1;
          if (l < 95 && i >= 8) {
            const lp = (d[i - 8] + d[i - 7] + d[i - 6]) / 3;
            if (lp > 165) ink += 1;
          }
        }
        mean = +(sum / (d.length / 4)).toFixed(1);
        bright = b; inkEdges = ink;
        if (s.pressAt != null && now - s.pressAt < 2600 && now - lastSnap > 240 && s.snaps.length < 10) {
          lastSnap = now;
          s.snaps.push({ t: +(now - s.pressAt).toFixed(0), png: crop.toDataURL('image/png') });
        }
      } catch (_) { /* readback failed this frame */ }
      let lights = 0;
      scene.traverseVisible((o) => { if (o.isLight) lights += 1; });
      if (window.__fw.ledgerOpen && s.openAt == null) s.openAt = now;
      s.rows.push({
        t: now,
        dt: +(now - last).toFixed(2),
        mean, bright, inkEdges, lights,
        programs: r.info.programs ? r.info.programs.length : -1,
        yaw: walk.state.yaw,
        x: walk.state.x,
        z: walk.state.z,
      });
      last = now;
      if (!s.stop) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  const collect = (tag) => page.evaluate((tagIn) => {
    const s = window.__va3;
    s.stop = true;
    const t0 = s.pressAt;
    const rows = s.rows;
    const pre = rows.filter((r) => t0 == null || r.t < t0);
    const post = t0 == null ? [] : rows.filter((r) => r.t >= t0);
    const d = post.map((r) => r.dt);
    const sorted = [...d].sort((a, b) => a - b);
    const pct = (p) => +(sorted[Math.floor((sorted.length - 1) * p)] || 0).toFixed(1);
    // ink: baseline edges before press; crossing = first frame after press where
    // inkEdges exceeds baseline by 5x AND at least 120 edge pixels, with the
    // page bright (bright count also well above its pre-press level).
    const preInk = pre.map((r) => r.inkEdges).filter((v) => v != null);
    const preBright = pre.map((r) => r.bright).filter((v) => v != null);
    const inkBase = preInk.length ? preInk.reduce((a, b) => a + b, 0) / preInk.length : null;
    const brightBase = preBright.length ? preBright.reduce((a, b) => a + b, 0) / preBright.length : null;
    let inkAtMs = null; let brightAtMs = null;
    for (const r of post) {
      if (r.bright != null && brightAtMs == null && brightBase != null && r.bright > brightBase + 1600) {
        brightAtMs = +(r.t - t0).toFixed(1);
      }
      if (r.inkEdges != null && inkAtMs == null && r.inkEdges > Math.max(120, (inkBase || 0) * 5)) {
        inkAtMs = +(r.t - t0).toFixed(1);
      }
      if (inkAtMs != null && brightAtMs != null) break;
    }
    const during = post.filter((r) => r.t <= t0 + 1500);
    const yaws = during.map((r) => r.yaw).filter((y) => y != null);
    const xs = during.map((r) => r.x); const zs = during.map((r) => r.z);
    const dist = xs.length ? Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)) : 0;
    const progs = post.map((r) => r.programs);
    const lightsSeen = [...new Set(rows.map((r) => r.lights))];
    const snaps = s.snaps;
    window.__va3 = null;
    return {
      tag: tagIn,
      pressSeen: t0 != null,
      openStateMs: s.openAt != null && t0 != null ? +(s.openAt - t0).toFixed(1) : null,
      brightAtMs,
      inkAtMs,
      inkBase: inkBase != null ? +inkBase.toFixed(1) : null,
      brightBase: brightBase != null ? +brightBase.toFixed(0) : null,
      inkPeak: Math.max(0, ...post.map((r) => r.inkEdges || 0)),
      frames: {
        n: d.length,
        median: pct(0.5),
        p95: pct(0.95),
        worst: d.length ? +Math.max(...d).toFixed(1) : null,
        over33: d.filter((x) => x > 33).length,
        over100: d.filter((x) => x > 100).length,
      },
      yawSpreadDuring: yaws.length ? +(Math.max(...yaws) - Math.min(...yaws)).toFixed(4) : null,
      moveDistDuring: +dist.toFixed(3),
      programsStart: progs[0] ?? null,
      programsEnd: progs[progs.length - 1] ?? null,
      lightsSeen,
      ledgerOpen: !!window.__fw.ledgerOpen,
      snaps,
    };
  }, tag);

  const saveSnaps = (leg) => {
    const snaps = leg.snaps || [];
    leg.snapFiles = snaps.map((sn) => {
      const f = path.join(OUT, `va3-${leg.tag}-t${sn.t}ms.png`);
      fs.writeFileSync(f, Buffer.from(sn.png.split(',')[1], 'base64'));
      return f;
    });
    delete leg.snaps;
  };

  // ---- 0. the book SHUT: reading light + a look at the desk ------------
  out.stage1 = await stage();
  if (!out.stage1.hunt.hit) {
    fs.writeFileSync(path.join(OUT, 'va3.json'), `${JSON.stringify(out, null, 2)}\n`);
    console.log('VA3 ABORT: never focused the ledger', JSON.stringify(out.stage1));
    return out;
  }
  out.shutBefore = await lightNow();
  await page.screenshot({ path: path.join(OUT, 'va3-00-shut-desk.png') });

  // ---- 1. COLD open, standing, mouse moving through the open -----------
  await arm();
  await page.mouse.click(centre.x, centre.y);
  await page.waitForTimeout(400);
  out.pointerLocked = await page.evaluate(() => !!document.pointerLockElement);
  await page.waitForTimeout(1100); // pre-press baseline for ink/bright
  await page.keyboard.press('e');
  for (let i = 0; i < 14; i += 1) {
    await page.mouse.move(centre.x - 120 + i * 18, centre.y - 60, { steps: 2 });
    await page.waitForTimeout(70);
  }
  await page.waitForFunction(() => !!window.__fw?.ledgerOpen, null, { timeout: 12000 }).catch(() => {});
  await page.waitForTimeout(1600);
  out.cold = await collect('cold');
  saveSnaps(out.cold);
  out.coldLight = await lightNow();
  await page.screenshot({ path: path.join(OUT, 'va3-01-cold-open.png') });

  // close
  await page.keyboard.press('e');
  await page.waitForTimeout(2200);

  // ---- 2. REOPEN immediately (second-in-a-row) --------------------------
  await arm();
  await page.waitForTimeout(900);
  await page.keyboard.press('e');
  await page.waitForFunction(() => !!window.__fw?.ledgerOpen, null, { timeout: 12000 }).catch(() => {});
  await page.waitForTimeout(1300);
  out.reopen = await collect('reopen');
  saveSnaps(out.reopen);
  // rapid close/open/close on top
  await page.keyboard.press('e');
  await page.waitForTimeout(260);
  await page.keyboard.press('e');
  await page.waitForTimeout(260);
  await page.keyboard.press('e');
  await page.waitForTimeout(2400);
  out.afterRapid = await lightNow();

  // ---- 3. open WHILE STRAFING -------------------------------------------
  out.stage3 = await stage();
  await page.mouse.click(centre.x, centre.y);
  await page.waitForTimeout(300);
  await arm();
  await page.waitForTimeout(700);
  await page.keyboard.down('a');
  await page.waitForTimeout(180);
  await page.keyboard.press('e');
  await page.waitForTimeout(900);
  await page.keyboard.up('a');
  await page.waitForFunction(() => !!window.__fw?.ledgerOpen, null, { timeout: 12000 }).catch(() => {});
  await page.waitForTimeout(1200);
  out.strafe = await collect('strafe');
  saveSnaps(out.strafe);
  await page.screenshot({ path: path.join(OUT, 'va3-03-strafe-open.png') });
  await page.keyboard.press('e');
  await page.waitForTimeout(2000);

  // ---- 4. open RIGHT AFTER a quality change ------------------------------
  await page.keyboard.press('p');
  await page.waitForSelector('.pause-panel', { timeout: 15000 });
  await page.evaluate(() => {
    [...document.querySelectorAll('.pause-nav button, .pause-nav .nav-item, .pause-panel button')]
      .find((b) => /settings/i.test(b.textContent))?.click();
  });
  await page.waitForSelector('.settings-shell', { timeout: 15000 });
  await page.evaluate(() => {
    [...document.querySelectorAll('.settings-tab')].find((t) => /display/i.test(t.textContent))?.click();
  });
  await page.waitForTimeout(400);
  out.qualitySwitch = await page.evaluate(() => {
    const sel = [...document.querySelectorAll('.settings-page select')]
      .find((s) => [...s.options].some((o) => /low|medium|high|ultra/i.test(o.value || o.textContent)));
    if (!sel) return { ok: false };
    const from = sel.value;
    const opt = [...sel.options].find((o) => /ultra/i.test(o.value || o.textContent) && o.value !== sel.value)
      || [...sel.options].find((o) => /high/i.test(o.value || o.textContent) && o.value !== sel.value);
    if (!opt) return { ok: false, from };
    sel.value = opt.value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true, from, to: opt.value };
  });
  await page.waitForTimeout(400);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  out.stage4 = await stage();
  await page.mouse.click(centre.x, centre.y);
  await page.waitForTimeout(300);
  await arm();
  await page.waitForTimeout(800);
  await page.keyboard.press('e');
  await page.waitForFunction(() => !!window.__fw?.ledgerOpen, null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1600);
  out.afterQuality = await collect('afterQuality');
  saveSnaps(out.afterQuality);
  await page.screenshot({ path: path.join(OUT, 'va3-04-afterquality-open.png') });

  // ---- final close: light must go back to 0 ------------------------------
  await page.keyboard.press('e');
  await page.waitForTimeout(3000);
  out.shutAfter = await lightNow();
  await page.screenshot({ path: path.join(OUT, 'va3-05-shut-after.png') });

  out.glCount = out.gl.length;
  fs.writeFileSync(path.join(OUT, 'va3.json'), `${JSON.stringify(out, null, 2)}\n`);
  const brief = (l) => l && {
    tag: l.tag, openStateMs: l.openStateMs, brightAtMs: l.brightAtMs, inkAtMs: l.inkAtMs,
    worst: l.frames?.worst, over100: l.frames?.over100, yawSpread: l.yawSpreadDuring,
    moved: l.moveDistDuring, progs: [l.programsStart, l.programsEnd], lights: l.lightsSeen,
    open: l.ledgerOpen,
  };
  console.log('VA3 cold   ', JSON.stringify(brief(out.cold)));
  console.log('VA3 reopen ', JSON.stringify(brief(out.reopen)));
  console.log('VA3 strafe ', JSON.stringify(brief(out.strafe)));
  console.log('VA3 quality', JSON.stringify(brief(out.afterQuality)));
  console.log('VA3 shut light before/after',
    JSON.stringify(out.shutBefore?.readingLight), JSON.stringify(out.shutAfter?.readingLight));
  if (out.errs.length) console.log('pageerrors', JSON.stringify(out.errs.slice(0, 4)));
  return out;
}
