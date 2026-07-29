async (page) => {
  // BLOCKER 8 — "the room is not dark enough". Measures the UNPOWERED room at
  // fixed poses so "darker" is a number, not an impression.
  //
  //   node tools/qa/run-playwright.cjs tools/qa/proshop-dark-state-luma.js
  //
  // STATUS 2026-07-28: this instrument is COMPLETE and the tuning it exists to
  // measure is NOT DONE. It is committed alone, deliberately.
  //
  // Two lessons are baked into it. First, it refuses to run against a powered
  // room: an earlier revision paused the game, and because the shell only
  // learns the circuit is dead when the clubhouse update runs (it initialises
  // to `true`), it captured four "dark start" frames of a fully LIT room and
  // produced a confident 10% improvement that was noise between two lit
  // captures. Second, the reason the room is not dark is now known and is not
  // where it was looked for: HemisphereLight (1.4) and AmbientLight are GLOBAL
  // terms with no occlusion, so they light a sealed windowless clubhouse
  // exactly as brightly as the fairway. The interior daylight fills, which were
  // the obvious suspect, are a minor term beside them.
  //
  // The fix is therefore a change to world lighting, gated on being inside an
  // unpowered room — too broad to land unverified at the end of a session, and
  // this probe still cannot reach the unpowered state from a starter boot, so
  // there is no measurement to justify it with yet. Reaching that state is the
  // first job of whoever picks this up.
  //
  // Reports mean luma per pose plus two things the walk explicitly asked to
  // protect: the panel faces must stay readable as pale shapes (so the repair
  // beat is findable) and there must be enough shape left to navigate by. A
  // whole-frame mean alone cannot see either, so the panel band is cropped
  // separately and the frame's contrast is reported alongside its level.
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const zlib = process.getBuiltinModule('node:zlib');
  const repo = path.resolve(process.env.QA_REPO_ROOT || process.cwd());
  const outDir = path.resolve(process.env.GREYBOX_DATA_OUT
    || path.join(repo, 'Designs', 'ProShop', 'Greybox', 'data'));
  const shotDir = path.join(outDir, 'dark-state');
  fs.mkdirSync(shotDir, { recursive: true });
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const SEED = Number(process.env.GREYBOX_SEED || 20260727);
  const TAG = process.env.DARK_STATE_TAG || 'after';

  function decodePng(buffer) {
    let pos = 8;
    let width = 0; let height = 0; let colorType = 0;
    const idat = [];
    while (pos < buffer.length) {
      const len = buffer.readUInt32BE(pos);
      const type = buffer.toString('ascii', pos + 4, pos + 8);
      const data = buffer.subarray(pos + 8, pos + 8 + len);
      if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); colorType = data[9]; }
      else if (type === 'IDAT') idat.push(data);
      else if (type === 'IEND') break;
      pos += 12 + len;
    }
    const raw = zlib.inflateSync(Buffer.concat(idat));
    const bpp = colorType === 6 ? 4 : 3;
    const stride = width * bpp;
    const out = Buffer.alloc(height * stride);
    const paeth = (a, b, c) => {
      const pp = a + b - c;
      const pa = Math.abs(pp - a); const pb = Math.abs(pp - b); const pc = Math.abs(pp - c);
      return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
    };
    for (let y = 0; y < height; y++) {
      const filter = raw[y * (stride + 1)];
      const rowIn = (y * (stride + 1)) + 1;
      const rowOut = y * stride;
      for (let x = 0; x < stride; x++) {
        const rb = raw[rowIn + x];
        const left = x >= bpp ? out[rowOut + x - bpp] : 0;
        const up = y > 0 ? out[rowOut - stride + x] : 0;
        const ul = y > 0 && x >= bpp ? out[rowOut - stride + x - bpp] : 0;
        let v;
        switch (filter) {
          case 0: v = rb; break;
          case 1: v = rb + left; break;
          case 2: v = rb + up; break;
          case 3: v = rb + ((left + up) >> 1); break;
          case 4: v = rb + paeth(left, up, ul); break;
          default: throw new Error(`bad filter ${filter}`);
        }
        out[rowOut + x] = v & 0xff;
      }
    }
    return { width, height, bpp, data: out };
  }

  const lumaStats = (img, box) => {
    const x0 = Math.floor(box.x0 * img.width); const x1 = Math.floor(box.x1 * img.width);
    const y0 = Math.floor(box.y0 * img.height); const y1 = Math.floor(box.y1 * img.height);
    let sum = 0; let n = 0; let min = 255; let max = 0;
    const vals = [];
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * img.width + x) * img.bpp;
        const l = 0.2126 * img.data[i] + 0.7152 * img.data[i + 1] + 0.0722 * img.data[i + 2];
        sum += l; n += 1; if (l < min) min = l; if (l > max) max = l;
        if ((x + y) % 7 === 0) vals.push(l);
      }
    }
    vals.sort((a, b) => a - b);
    const pct = (q) => (vals.length ? vals[Math.min(vals.length - 1, Math.floor(q * vals.length))] : 0);
    return {
      mean: +(sum / Math.max(1, n)).toFixed(2),
      min: +min.toFixed(1),
      max: +max.toFixed(1),
      p05: +pct(0.05).toFixed(1),
      p95: +pct(0.95).toFixed(1),
    };
  };

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`${baseUrl}?clubhouse=pine-hills-v2`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.readyState === 'complete');
  await page.evaluate(async (seed) => {
    localStorage.clear();
    const E = await import('/src/sim/empire.js');
    localStorage.setItem('golfempire:autosave', JSON.stringify(E.empireSnapshot(E.newStarterEmpire('relaxed', seed))));
  }, SEED);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  await page.getByRole('button', { name: /^Continue/ }).first().click();
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 120000 });
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 120000 });
  await page.waitForTimeout(2500);

  // Fixed conditions: unpowered campaign start, mid-morning, no customers or
  // HUD in frame — the same discipline the Phase 4 captures used, because an
  // unpinned frame cannot be compared with anything.
  // DO NOT PAUSE. The shell only learns the circuit is dead when the clubhouse
  // update runs (updateFlicker -> setCeilingCircuitPowered), and it initialises
  // to `true`. An earlier revision of this probe paused the game and captured
  // four "dark start" frames of a fully LIT room, reporting a 10% change that
  // was noise between two lit captures. Run at 1x and assert the state.
  const powered = await page.evaluate(() => {
    const app = window.__fw;
    app.speedIdx = 1;
    app.state.clock.minutes = 10 * 60;
    const ch = app.scene3d.clubhouse();
    ch.setTimeMood?.(10 * 60);
    const cs = typeof ch.customers === 'function' ? ch.customers() : ch.customers;
    if (Array.isArray(cs)) cs.forEach((c) => { if (c?.mesh) c.mesh.visible = false; });
    ch.setOrganicWalkins?.(false);
    document.querySelectorAll('.hud, .notification-center, .walk-overlay').forEach((n) => { n.style.display = 'none'; });
    return ch.ceilingLightingDiagnostics?.().circuitPowered ?? null;
  });

  // Give the clubhouse update a few frames to push the real circuit state into
  // the shell before asserting on it.
  await page.waitForTimeout(1200);
  const settled = await page.evaluate(() => (
    window.__fw.scene3d.clubhouse().ceilingLightingDiagnostics?.().circuitPowered ?? null
  ));
  void powered;
  if (settled !== false) {
    throw new Error(`dark-state probe requires an UNPOWERED room; circuitPowered=${settled}. `
      + 'Every luma number from a powered capture is meaningless for this measurement.');
  }

  const POSES = [
    { id: 'p1-door-in', x: -0.8, z: 4.2, yaw: Math.PI, pitch: -0.02 },
    { id: 'p2-retail-wall', x: -1.2, z: 0.6, yaw: -Math.PI / 2, pitch: 0.02 },
    { id: 'p3-under-faulted-run', x: -0.2, z: -1.6, yaw: 0, pitch: 0.55 },
    { id: 'p4-desk-approach', x: 2.4, z: 2.4, yaw: Math.PI * 0.75, pitch: -0.05 },
  ];
  // The ceiling band is where the panel faces live; the lower band is the floor
  // and fixture bases a player navigates by.
  const CROPS = {
    whole: { x0: 0, x1: 1, y0: 0, y1: 1 },
    ceilingBand: { x0: 0.15, x1: 0.85, y0: 0.02, y1: 0.30 },
    navBand: { x0: 0.15, x1: 0.85, y0: 0.62, y1: 0.96 },
  };

  const rows = [];
  for (const pose of POSES) {
    // eslint-disable-next-line no-await-in-loop
    await page.evaluate((p) => {
      const app = window.__fw;
      const o = app.scene3d.clubhouse().interior.position;
      const w = app.scene3d.walk.state;
      w.x = p.x + o.x; w.z = p.z + o.z; w.yaw = p.yaw; w.pitch = p.pitch;
    }, pose);
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(700);
    const file = path.join(shotDir, `${TAG}-${pose.id}.png`);
    // eslint-disable-next-line no-await-in-loop
    const buf = await page.screenshot({ path: file });
    const img = decodePng(buf);
    rows.push({
      pose: pose.id,
      whole: lumaStats(img, CROPS.whole),
      ceilingBand: lumaStats(img, CROPS.ceilingBand),
      navBand: lumaStats(img, CROPS.navBand),
    });
  }

  const meanOf = (key) => +(rows.reduce((a, r) => a + r[key].mean, 0) / rows.length).toFixed(2);
  const out = {
    tag: TAG,
    circuitPowered: settled,
    poses: rows.length,
    darkStartMeanLuma: meanOf('whole'),
    ceilingBandMeanLuma: meanOf('ceilingBand'),
    navBandMeanLuma: meanOf('navBand'),
    // The two things the walk asked to protect while going darker.
    panelFacesStillReadable: rows.every((r) => r.ceilingBand.p95 >= 12),
    navBandStillHasShape: rows.every((r) => r.navBand.p95 - r.navBand.p05 >= 6),
    rows,
    shots: shotDir,
  };
  fs.writeFileSync(path.join(outDir, `dark-state-luma-${TAG}.json`), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
