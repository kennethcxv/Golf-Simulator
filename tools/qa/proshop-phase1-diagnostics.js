async (page) => {
  // PRO-SHOP PHASE 1 — attribution for the two things Phase 0 measured but could not explain:
  //   A. the interior frame-time spike while the camera turns
  //   B. the three broom complaints raised at the Phase 0 review
  //
  //   HEADED=1 node tools/qa/run-playwright.cjs tools/qa/proshop-phase1-diagnostics.js
  //
  // Inspection only. Nothing is fixed.
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = path.resolve(process.env.QA_REPO_ROOT || process.cwd());
  const dataOut = path.resolve(process.env.PHASE1_DATA_OUT
    || path.join(repo, 'Designs', 'ProShop', 'Phase1', 'data'));
  fs.mkdirSync(dataOut, { recursive: true });
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const M = 13 * 60;

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: /New game/i }).click();
  await page.locator('.difficulty-card').filter({ hasText: 'Relaxed' }).click();
  const c = page.getByRole('button', { name: /^(Start|Confirm|Yes)/i }).first();
  if (await c.isVisible({ timeout: 1500 }).catch(() => false)) await c.click();
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 120000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || v.style.display === 'none' || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 120000 });
  await page.waitForTimeout(3000);

  const place = async (lx, lz, yaw, pitch) => {
    await page.evaluate(({ lx, lz, yaw, pitch, m }) => {
      const app = window.__fw;
      const s3 = app.scene3d;
      const o = s3.clubhouse().interior.position;
      const w = s3.walk; w.clearKeys();
      w.state.x = o.x + lx; w.state.z = o.z + lz; w.state.yaw = yaw; w.state.pitch = pitch;
      app.speedIdx = 0;
      const cl = app.state.clock;
      cl.minutes = Math.floor(cl.minutes / 1440) * 1440 + m;
      s3.applyTimeWeather(m, app.state.weather);
    }, { lx, lz, yaw, pitch, m: M });
    await page.waitForTimeout(500);
  };

  await page.evaluate(() => {
    window.__spin = { on: false, speed: 2.4 };
    const drive = () => {
      if (window.__spin.on && window.__fw?.scene3d?.walk) {
        const w = window.__fw.scene3d.walk.state;
        w.yaw += window.__spin.speed / 60;
      }
      requestAnimationFrame(drive);
    };
    requestAnimationFrame(drive);
    window.__startSample = () => {
      const stats = window.__fw.scene3d.post.stats;
      window.__samp = { d: [], bake: [], last: performance.now(), on: true, lb: stats ? stats().shadowBakes : 0 };
      const loop = (t) => {
        const s = window.__samp; if (!s || !s.on) return;
        const b = stats ? stats().shadowBakes : 0;
        s.d.push(t - s.last); s.bake.push(b !== s.lb); s.lb = b; s.last = t;
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    };
    window.__stopSample = () => {
      const s = window.__samp; s.on = false;
      const pairs = s.d.map((v, i) => [v, s.bake[i]]).slice(5);
      const avgOf = (a) => (a.length ? a.reduce((x, v) => x + v, 0) / a.length : 0);
      const bake = pairs.filter((p) => p[1]).map((p) => p[0]);
      const plain = pairs.filter((p) => !p[1]).map((p) => p[0]);
      const d = s.d.slice(5).sort((a, b) => a - b);
      const worstN = Math.max(1, Math.round(d.length * 0.01));
      return {
        frames: d.length,
        avgMs: +avgOf(d).toFixed(2),
        p1Ms: +avgOf(d.slice(-worstN)).toFixed(2),
        worstMs: +d[d.length - 1].toFixed(1),
        over33: d.filter((v) => v > 33.3).length,
        bakeAvgMs: +avgOf(bake).toFixed(2),
        plainAvgMs: +avgOf(plain).toFixed(2),
        bakeWorstMs: bake.length ? +Math.max(...bake).toFixed(1) : 0,
        plainWorstMs: plain.length ? +Math.max(...plain).toFixed(1) : 0,
        drawCalls: window.__fw.scene3d.renderer.info.render.calls,
      };
    };
  });

  const sample = async (name, seconds, { setup = null, teardown = null } = {}) => {
    if (setup) await page.evaluate(setup);
    await page.evaluate(() => { window.__spin.on = true; });
    await page.waitForTimeout(600);
    await page.evaluate(() => window.__startSample());
    await page.waitForTimeout(seconds * 1000);
    const r = await page.evaluate(() => window.__stopSample());
    await page.evaluate(() => { window.__spin.on = false; });
    if (teardown) await page.evaluate(teardown);
    return { name, ...r };
  };

  // ---------------------------------------------------------------- A. spin attribution
  const perf = [];
  await place(-2.0, 1.0, 0, -0.05);
  // COLD: the very first spin of the session, nothing pre-warmed by turning.
  perf.push(await sample('cold-first-spin', 8));
  // WARM: two full revolutions first, so every direction has been rendered once.
  await page.evaluate(() => { window.__spin.on = true; });
  await page.waitForTimeout(6000);
  await page.evaluate(() => { window.__spin.on = false; });
  await page.waitForTimeout(600);
  perf.push(await sample('warm-spin', 8));
  perf.push(await sample('warm-spin-gtao-off', 6, {
    setup: () => { window.__fw.scene3d.post.gtao.enabled = false; },
    teardown: () => { window.__fw.scene3d.post.gtao.enabled = true; },
  }));
  perf.push(await sample('warm-spin-bloom-off', 6, {
    setup: () => { window.__fw.scene3d.post.bloom.enabled = false; },
    teardown: () => { window.__fw.scene3d.post.bloom.enabled = true; },
  }));
  perf.push(await sample('warm-spin-shadow2048', 6, {
    setup: () => {
      const sun = window.__fw.scene3d.post.sun;
      sun.shadow.mapSize.set(2048, 2048);
      if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
    },
    teardown: () => {
      const sun = window.__fw.scene3d.post.sun;
      sun.shadow.mapSize.set(4096, 4096);
      if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
    },
  }));
  perf.push(await sample('warm-spin-sun-shadow-off', 6, {
    setup: () => { window.__fw.scene3d.post.sun.castShadow = false; },
    teardown: () => { window.__fw.scene3d.post.sun.castShadow = true; },
  }));

  // ---------------------------------------------------------------- B. broom behaviour
  await place(-5.6, 4.4, 0, -0.5);
  await page.evaluate(() => window.__fw.scene3d.walk.setTool('broom'));
  await page.waitForTimeout(2200);

  // B1 — does the tool follow the view when the player looks down?
  //
  // Read the viewmodel transforms straight from the scene graph, NOT from
  // cleaningDiagnostics(): that only writes `contact` on a frame where cleaning
  // actually ran, so sampling it while idle returns a stale [0,0,0] and every
  // derived number is garbage. The mouse is held down through this sweep so the
  // working pose is what gets measured.
  const readPose = () => page.evaluate(() => {
    const s3 = window.__fw.scene3d;
    const cam = s3.camera;
    const o = s3.clubhouse().interior.position;
    let root = null; let socket = null;
    cam.traverse((n) => {
      const nm = n.name || '';
      if (!root && /BROOM.*ROOT|HeldBroom|Tool_broom/i.test(nm)) root = n;
      if (!socket && /SOCKET_FloorContact/i.test(nm)) {
        let p = n; let underBroom = false;
        while (p) { if (/broom/i.test(p.name || '')) { underBroom = true; break; } p = p.parent; }
        if (underBroom) socket = n;
      }
    });
    const V = cam.position.constructor;
    const wp = (n) => { const v = new V(); n.getWorldPosition(v); return v; };
    const out = { pitch: +s3.walk.state.pitch.toFixed(3), foundRoot: !!root, foundSocket: !!socket };
    if (root) {
      const v = wp(root);
      out.rootOffsetFromCamera = {
        x: +(v.x - cam.position.x).toFixed(3),
        y: +(v.y - cam.position.y).toFixed(3),
        z: +(v.z - cam.position.z).toFixed(3),
      };
    }
    if (socket) {
      const v = wp(socket);
      out.contactLocal = { x: +(v.x - o.x).toFixed(3), z: +(v.z - o.z).toFixed(3) };
      out.contactHeightAboveFloor = +(v.y - o.y).toFixed(3);
      const p = v.clone().project(cam);
      out.contactNdc = { x: +p.x.toFixed(3), y: +p.y.toFixed(3) };
      out.contactOnScreen = Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1;
    }
    return out;
  });

  await page.mouse.click(800, 450);
  await page.mouse.down();
  await page.waitForTimeout(900);
  const pitchSweep = [];
  for (const pitch of [0.2, 0, -0.2, -0.4, -0.62, -0.8, -1.0, -1.25]) {
    await page.evaluate((p) => { window.__fw.scene3d.walk.state.pitch = p; }, pitch);
    await page.waitForTimeout(500);
    pitchSweep.push(await readPose());
  }
  await page.mouse.up();
  await page.waitForTimeout(600);

  // B2 — is there any first-person body, or only hands?
  const bodyCensus = await page.evaluate(() => {
    const s3 = window.__fw.scene3d;
    const names = [];
    let heldRoot = null;
    s3.camera.traverse((o) => {
      names.push(`${o.type}:${o.name || '(unnamed)'}`);
      if (/held|tool|hand|fp/i.test(o.name || '')) heldRoot = o.name;
    });
    return { cameraChildren: names.slice(0, 40), heldRootName: heldRoot, cameraChildCount: names.length };
  });

  // B3 — where does the broom head sit when the player works up against furniture?
  // Same scene-graph read, with the tool actually in use at each spot.
  const clipProbe = [];
  for (const spot of [[-5.0, -1.0], [-3.5, 0.6], [0.0, 1.6], [4.6, 1.2]]) {
    await place(spot[0], spot[1], 0, -0.62);
    await page.mouse.down();
    await page.waitForTimeout(1100);
    const pose = await readPose();
    const res = await page.evaluate(() => {
      const s3 = window.__fw.scene3d;
      const ch = s3.clubhouse();
      const d = s3.walk.cleaningDiagnostics();
      const o = ch.interior.position;
      return {
        result: d.result ? { did: +Number(d.result.did || 0).toFixed(4), blocked: !!d.result.blocked, reason: d.result.reason || null } : null,
        contactInsideRoom: d.contact ? ch.isInside(d.contact[0], d.contact[2]) : null,
        contactLocalFromDiag: d.contact ? { x: +(d.contact[0] - o.x).toFixed(2), z: +(d.contact[2] - o.z).toFixed(2) } : null,
      };
    });
    await page.mouse.up();
    await page.waitForTimeout(400);
    clipProbe.push({ spot, pose, ...res });
  }

  const toolDiag = await page.evaluate(() => {
    const w = window.__fw.scene3d.walk;
    const t = w.toolViewmodelDiagnostics();
    return { equippedTool: t.equippedTool, animated: t.animated, playing: t.playing, clips: t.clips?.broom || null };
  });

  const report = {
    note: 'Phase 1 attribution pass. Inspection only; nothing was fixed.',
    perfAttribution: perf,
    broom: { pitchSweep, bodyCensus, clipProbe, toolDiag },
  };
  fs.writeFileSync(path.join(dataOut, 'phase1-diagnostics.json'), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}
