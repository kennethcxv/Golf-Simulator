// GOAL 33 PART 0 — WHICH POPULATION IS THE PLAYER LOOKING AT?
//
// "There are two customer populations in this codebase — sim/customerSimulation.js's
//  `active` and clubhouse.customers() — and the tests have historically read the one
//  the player never sees."
//
// Reading the imports answers this on paper (clubhouse/customers.js is imported by
// nothing; the live array is inline in clubhouse.js). Paper is what produced three
// clean probes about visibly broken things. So this settles it in PIXELS:
//
//   1. Customers arrive ORGANICALLY — the shop's own footfall loop at the game's own
//      speed control. Nothing is spawned, placed, or teleported.
//   2. Every body in clubhouse.customers() is painted emissive magenta
//      (toneMapped:false, fog:false — neither ACES nor the lighting can hide it).
//   3. A real screenshot is taken through the full pipeline.
//   4. Each population's world positions are projected through the LIVE camera
//      matrices and the screenshot is sampled at those pixels. The population whose
//      coordinates land on painted bodies is the one the player watches.
//
// CONTROLS (golf-qa law 1 — an instrument that cannot fail measures nothing):
//   noise floor  — unpainted frame must contain ~no magenta, or counting is void.
//   detection    — painted frame must contain a lot of magenta, or the probe is blind.
//   offset       — the same projected points shifted 2.5 yd sideways must MISS.
//                  Without this, "the projection hit paint" could just mean the
//                  screen is full of paint.
//
//   node tools/qa/run-electron.cjs tools/qa/goal33-part0-populations.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const sharp = (await import('sharp')).default;
  const OUT = path.resolve('qa/goal33');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { tag: process.env.QA_TAG || 'part0', errs: [], failures: [], notes: [] };
  const fail = (why) => { out.failures.push(why); console.log('FAIL:', why); };
  const note = (why) => { out.notes.push(why); console.log('NOTE:', why); };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  const boot = await import(`file:///${bootPath}`);
  await boot.clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(4000);
  const vp = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio }));
  out.viewport = vp;
  await page.mouse.click(vp.w / 2, vp.h / 2);
  await page.waitForTimeout(500);

  // ---- projection helpers, installed in the page -----------------------------
  // matrixWorld, not local transforms, and no THREE import: the camera's own
  // Matrix4 instances carry the methods.
  await page.evaluate(() => {
    window.__p0 = {
      project(x, y, z) {
        const cam = window.__fw.scene3d.camera;
        cam.updateMatrixWorld(true);
        cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
        const v = cam.matrixWorldInverse.elements;
        const vx = v[0] * x + v[4] * y + v[8] * z + v[12];
        const vy = v[1] * x + v[5] * y + v[9] * z + v[13];
        const vz = v[2] * x + v[6] * y + v[10] * z + v[14];
        const p = cam.projectionMatrix.elements;
        const cx = p[0] * vx + p[4] * vy + p[8] * vz + p[12];
        const cy = p[1] * vx + p[5] * vy + p[9] * vz + p[13];
        const cw = p[3] * vx + p[7] * vy + p[11] * vz + p[15];
        if (!cw) return null;
        return {
          ndcX: cx / cw,
          ndcY: cy / cw,
          behind: cw <= 0,
          sx: (cx / cw * 0.5 + 0.5) * window.innerWidth,
          sy: (-(cy / cw) * 0.5 + 0.5) * window.innerHeight,
          dist: Math.hypot(vx, vy, vz),
        };
      },
      // World position of a customer body, from the matrix the renderer used.
      bodyPos(c) {
        c.mesh.updateWorldMatrix(true, false);
        const e = c.mesh.matrixWorld.elements;
        return { x: e[12], y: e[13], z: e[14] };
      },
    };
  });

  // ---- let the shop fill up on its own ---------------------------------------
  // The game's own speed control, which the player has. No spawn calls: the
  // footfall loop decides who walks in and when, through the real door.
  await page.evaluate(() => { window.__fw.speedIdx = 2; });
  const waitStart = Date.now();
  let population = 0;
  while (Date.now() - waitStart < 180000) {
    population = await page.evaluate(() => window.__fw.scene3d.clubhouse().customers().length);
    if (population >= 2) break;
    await page.waitForTimeout(1000);
  }
  out.arrivalWaitMs = Date.now() - waitStart;
  out.populationAfterWait = population;
  if (population < 1) fail(`no customer arrived organically in ${Math.round(out.arrivalWaitMs / 1000)} s — nothing to measure`);

  // ---- aim at the crowd with REAL MOUSE INPUT --------------------------------
  // Closed loop: read where the body projects, move the mouse, read again. The
  // game's own pointer-lock mouse-look does the turning.
  const aimAt = async (target) => {
    const trace = [];
    for (let i = 0; i < 60; i += 1) {
      const p = await page.evaluate((t) => window.__p0.project(t.x, t.y, t.z), target);
      if (!p) break;
      trace.push({ ndcX: +p.ndcX.toFixed(3), behind: p.behind });
      if (!p.behind && Math.abs(p.ndcX) < 0.10) return { ok: true, iters: i, trace };
      const dx = p.behind ? 260 : Math.max(-260, Math.min(260, p.ndcX * 420));
      const base = { x: vp.w / 2, y: vp.h / 2 };
      await page.mouse.move(base.x, base.y);
      await page.mouse.move(base.x + dx, base.y);
      await page.waitForTimeout(60);
    }
    return { ok: false, trace };
  };

  const nearest = await page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse();
    const w = window.__fw.scene3d.walk.state;
    let best = null;
    for (const c of ch.customers()) {
      if (!c.mesh) continue;
      const p = window.__p0.bodyPos(c);
      const d = Math.hypot(p.x - w.x, p.z - w.z);
      if (!best || d < best.d) best = { d, x: p.x, y: p.y + 0.9, z: p.z };
    }
    return best;
  });
  if (nearest) {
    out.aim = await aimAt(nearest);
    if (!out.aim.ok) note('the mouse-look aim loop never centred a body; frames may not contain the crowd');
  }
  await page.waitForTimeout(600);

  // ---- both populations, as the game holds them ------------------------------
  const snapshot = async () => page.evaluate(() => {
    const fw = window.__fw;
    const ch = fw.scene3d.clubhouse();
    const visible = ch.customers().map((c) => {
      const p = window.__p0.bodyPos(c);
      return {
        customerId: c.customerId ?? null,
        name: c.fullName ?? null,
        x: +p.x.toFixed(3),
        y: +p.y.toFixed(3),
        z: +p.z.toFixed(3),
        meshVisible: c.mesh?.visible !== false,
        stop: c.stops?.[c.stopIdx]?.kind ?? null,
        queued: !!c.queued,
      };
    });
    const sim = fw.state?.shop?.customerSimulation || null;
    const active = (sim?.active || []).map((c) => ({
      id: c.id ?? null,
      state: c.state ?? null,
      intent: c.intent ?? null,
      position: c.position ? { x: c.position.x, z: c.position.z } : null,
      pathNodes: Array.isArray(c.currentPath) ? c.currentPath.length : null,
    }));
    return {
      visible,
      active,
      simCounts: {
        active: sim?.active?.length ?? null,
        scheduled: sim?.scheduled?.length ?? null,
        serviceQueue: sim?.serviceQueue?.length ?? null,
        spawned: sim?.metrics?.spawned ?? null,
      },
      walk: { x: fw.scene3d.walk.state.x, z: fw.scene3d.walk.state.z, yaw: fw.scene3d.walk.state.yaw },
    };
  });
  out.snapshot = await snapshot();
  out.counts = {
    visibleBodies: out.snapshot.visible.length,
    simActive: out.snapshot.active.length,
    simActiveWithPosition: out.snapshot.active.filter((c) => c.position).length,
  };

  // ---- paint every visible body ----------------------------------------------
  const setPaint = (on) => page.evaluate((paintOn) => {
    const W = window;
    if (!W.__p0paint) W.__p0paint = { stash: [] };
    const P = W.__p0paint;
    const ch = W.__fw.scene3d.clubhouse();
    if (paintOn) {
      let painted = 0;
      for (const c of ch.customers()) {
        if (!c.mesh) continue;
        c.mesh.traverse((o) => {
          if (!o.isMesh || !o.material) return;
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          const repl = mats.map((orig) => {
            const m = new orig.constructor();
            if (m.emissive) { m.color?.set?.(0x000000); m.emissive.set(0xff00ff); m.emissiveIntensity = 4; }
            else m.color?.set?.(0xff00ff);
            m.toneMapped = false;
            m.fog = false;
            m.transparent = false;
            m.opacity = 1;
            m.side = orig.side;
            m.skinning = orig.skinning;
            return m;
          });
          P.stash.push({ mesh: o, original: o.material });
          o.material = Array.isArray(o.material) ? repl : repl[0];
          painted += 1;
        });
      }
      return { painted, bodies: ch.customers().length };
    }
    for (const { mesh, original } of P.stash) mesh.material = original;
    const n = P.stash.length;
    P.stash = [];
    return { restored: n };
  }, on);

  const grab = async (label) => {
    const file = path.join(OUT, `p0-${label}.png`);
    const buf = await page.screenshot({ path: file });
    const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
    let magenta = 0;
    for (let i = 0; i < data.length; i += info.channels) {
      if (data[i] >= 140 && data[i + 1] <= 100 && data[i + 2] >= 140) magenta += 1;
    }
    return { label, file, magenta, data, info };
  };

  // Sample a square window around a projected point and count magenta in it.
  const sampleAt = (shot, sx, sy, half = 7) => {
    const scaleX = shot.info.width / vp.w;
    const scaleY = shot.info.height / vp.h;
    const px = Math.round(sx * scaleX);
    const py = Math.round(sy * scaleY);
    let hits = 0;
    let looked = 0;
    for (let y = py - half; y <= py + half; y += 1) {
      if (y < 0 || y >= shot.info.height) continue;
      for (let x = px - half; x <= px + half; x += 1) {
        if (x < 0 || x >= shot.info.width) continue;
        const i = (y * shot.info.width + x) * shot.info.channels;
        looked += 1;
        if (shot.data[i] >= 140 && shot.data[i + 1] <= 100 && shot.data[i + 2] >= 140) hits += 1;
      }
    }
    return { px, py, hits, looked };
  };

  const noise = await grab('00-unpainted');
  out.controlNoiseFloor = noise.magenta;
  out.paint = await setPaint(true);
  await page.waitForTimeout(300);
  const painted = await grab('01-painted');
  out.paintedMagenta = painted.magenta;

  if (noise.magenta > 200) fail(`noise floor ${noise.magenta} px — the unpainted world already reads magenta, counting is void`);
  if (painted.magenta < 400) fail(`painted frame has only ${painted.magenta} px — no body is in shot, so the population test cannot run`);

  // ---- the actual question: whose coordinates land on the paint? -------------
  const projectAll = async (points) => page.evaluate((pts) => pts.map((p) => {
    const r = window.__p0.project(p.x, p.y, p.z);
    return r ? { ...p, ...r } : { ...p, offScreen: true };
  }), points);

  const CHEST = 0.9;
  const visiblePts = out.snapshot.visible.map((c) => ({ id: c.customerId, x: c.x, y: c.y + CHEST, z: c.z }));
  const simPts = out.snapshot.active.filter((c) => c.position)
    .map((c) => ({ id: c.id, x: c.position.x, y: 0, z: c.position.z }));
  // The control: the same bodies, 2.5 yd to the side. If these hit paint too,
  // the frame is simply full of magenta and no verdict is possible.
  const offsetPts = visiblePts.map((p) => ({ ...p, id: `${p.id}-offset`, x: p.x + 2.5 }));

  const [visProj, simProj, offProj] = await Promise.all([
    projectAll(visiblePts), projectAll(simPts), projectAll(offsetPts),
  ]);

  const scoreSet = (proj) => proj.map((p) => {
    if (p.offScreen || p.behind || p.sx < 0 || p.sy < 0 || p.sx > vp.w || p.sy > vp.h) {
      return { id: p.id, onScreen: false, hits: 0 };
    }
    const s = sampleAt(painted, p.sx, p.sy);
    return { id: p.id, onScreen: true, sx: Math.round(p.sx), sy: Math.round(p.sy), hits: s.hits, looked: s.looked };
  });

  out.visibleProjection = scoreSet(visProj);
  out.simProjection = scoreSet(simProj);
  out.offsetControl = scoreSet(offProj);

  const onScreenHits = (rows) => {
    const on = rows.filter((r) => r.onScreen);
    return { onScreen: on.length, withPaint: on.filter((r) => r.hits > 0).length };
  };
  out.verdict = {
    clubhouseCustomers: onScreenHits(out.visibleProjection),
    simActive: onScreenHits(out.simProjection),
    offsetControl: onScreenHits(out.offsetControl),
  };

  await setPaint(false);
  await page.waitForTimeout(200);
  const after = await grab('02-restored');
  out.restoredMagenta = after.magenta;
  if (after.magenta > 200) fail(`paint did not restore (${after.magenta} px left) — the world was mutated`);

  // ---- verdict ---------------------------------------------------------------
  const v = out.verdict;
  if (v.clubhouseCustomers.onScreen === 0) {
    fail('no clubhouse.customers() body projected on screen — inconclusive, aim failed');
  } else if (v.clubhouseCustomers.withPaint < v.clubhouseCustomers.onScreen) {
    fail(`${v.clubhouseCustomers.onScreen - v.clubhouseCustomers.withPaint} of ${v.clubhouseCustomers.onScreen} `
      + 'clubhouse.customers() bodies projected onto NO paint — they are not the bodies on screen');
  }
  if (v.offsetControl.withPaint > 0) {
    fail(`offset control hit paint at ${v.offsetControl.withPaint} of ${v.offsetControl.onScreen} points — `
      + 'the frame is too full of magenta for the projection test to discriminate');
  }
  out.population = (v.clubhouseCustomers.withPaint > 0 && v.clubhouseCustomers.withPaint === v.clubhouseCustomers.onScreen
    && v.offsetControl.withPaint === 0)
    ? 'clubhouse.customers() — the inline array in clubhouse.js'
    : 'UNDETERMINED';

  fs.writeFileSync(path.join(OUT, 'part0-populations.json'), JSON.stringify(out, (k, val) => (k === 'data' ? undefined : val), 2));
  console.log('PART0', JSON.stringify({
    counts: out.counts,
    noise: out.controlNoiseFloor,
    painted: out.paintedMagenta,
    verdict: out.verdict,
    population: out.population,
    failures: out.failures,
  }, null, 2));
  if (out.failures.length) process.exitCode = 1;
  return out;
}
