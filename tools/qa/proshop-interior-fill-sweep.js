async (page) => {
  // BLOCKER 8, the tuning. Option A of DARK_STATE_PROPOSAL.md is implemented as a
  // single scale on the hemisphere applied while the player is inside; this file
  // chooses the number by sweeping it against the two floors the measurement
  // established, rather than by looking at a screenshot and deciding.
  //
  //   node tools/qa/run-playwright.cjs tools/qa/proshop-interior-fill-sweep.js
  //
  // Four things are measured, and three of them are controls:
  //
  //   1. NEGATIVE CONTROL. Scale 1.0 disables the effect. If the swept scales do
  //      not differ from it, the knob is not connected and every other number
  //      here is noise between identical captures â€” which is exactly how the
  //      first world-light A/B reported the hemisphere at 0.0% contribution.
  //   2. THE OVERWRITE CONTROL. applyTimeWeather assigns hemi.intensity every
  //      frame in all three of its branches. The scale must survive several
  //      frames, so hemi.intensity is sampled repeatedly and required to hold.
  //      A fix that is silently undone looks identical to a fix that does
  //      nothing, and both look like "the change had no effect".
  //   3. THE COURSE CONTROL. The user's condition for approving Option A was
  //      that the course stays untouched. An outdoor pose is captured at every
  //      scale and required to be bit-for-bit unmoved.
  //   4. The sweep itself, against p3's ceiling band (the panel faces must stay
  //      readable as pale shapes, or the repair beat stops being findable) and
  //      the nav band's contrast (there must be shape left to walk by).
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const zlib = process.getBuiltinModule('node:zlib');
  const repo = path.resolve(process.env.QA_REPO_ROOT || process.cwd());
  const outDir = path.resolve(process.env.GREYBOX_DATA_OUT
    || path.join(repo, 'Designs', 'ProShop', 'Greybox', 'data'));
  const shotDir = path.join(outDir, 'interior-fill-sweep');
  fs.mkdirSync(shotDir, { recursive: true });
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const SEED = Number(process.env.GREYBOX_SEED || 20260727);

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
  const lumaStats = (img, crop) => {
    const x0 = Math.round(crop.x0 * img.width);
    const x1 = Math.round(crop.x1 * img.width);
    const y0 = Math.round(crop.y0 * img.height);
    const y1 = Math.round(crop.y1 * img.height);
    let sum = 0; let n = 0;
    const vals = [];
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * img.width + x) * img.bpp;
        const l = 0.2126 * img.data[i] + 0.7152 * img.data[i + 1] + 0.0722 * img.data[i + 2];
        sum += l; n += 1;
        if ((x + y) % 7 === 0) vals.push(l);
      }
    }
    vals.sort((a, b) => a - b);
    const pct = (q) => (vals.length ? vals[Math.min(vals.length - 1, Math.floor(q * vals.length))] : 0);
    return {
      mean: +(sum / Math.max(1, n)).toFixed(2),
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
  await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 120000 });
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 120000 });
  await page.waitForTimeout(2500);

  // Same discipline as the dark-state probe, and the same refusal: the sim is
  // read first, the shell polled until it agrees, and nothing is measured
  // against a room that is still lit.
  await page.evaluate(() => {
    const app = window.__fw;
    app.speedIdx = 1;
    app.state.clock.minutes = 10 * 60;
    app.scene3d.clubhouse().setOrganicWalkins?.(false);
    // The chips are .hud-min, not .hud, and the lock hint is .shop-lockhint â€”
    // and the hint sits INSIDE the nav band crop (y 0.62â€“0.96). With white text
    // in the band, navBandHasShape's ">= 6 contrast" floor passed on the caption
    // rather than on the room, at every scale. A check that cannot fail is not a
    // check; it was measuring the HUD.
    document.querySelectorAll('.hud, .hud-min, .shop-lockhint, .notification-center, '
      + '.walk-overlay, .objectives-card, .shed-checklist')
      .forEach((n) => { n.style.display = 'none'; });
  });
  const simPowered = await page.evaluate(async () => {
    const R = await import('/src/sim/clubhouseRestoration.js');
    return R.ceilingCircuitPowered(window.__fw.state);
  });
  if (simPowered !== false) {
    throw new Error('the sim reports the ceiling circuit POWERED at start; this sweep '
      + 'measures the unpowered room and would otherwise report a lit one.');
  }
  await page.waitForFunction(
    () => window.__fw?.scene3d?.clubhouse?.().ceilingLightingDiagnostics?.().circuitPowered === false,
    null, { timeout: 30000 },
  );

  const POSES = [
    { id: 'p1-door-in', x: -0.8, z: 4.2, yaw: Math.PI, pitch: -0.02, indoor: true },
    { id: 'p2-retail-wall', x: -1.2, z: 0.6, yaw: -Math.PI / 2, pitch: 0.02, indoor: true },
    { id: 'p3-under-faulted-run', x: -0.2, z: -1.6, yaw: 0, pitch: 0.55, indoor: true },
    { id: 'p4-desk-approach', x: 2.4, z: 2.4, yaw: Math.PI * 0.75, pitch: -0.05, indoor: true },
    // The control. Outside on the porch approach, looking down the course: this
    // frame must not move by a single luma step at any scale.
    { id: 'c1-course', x: -0.8, z: 12.0, yaw: 0, pitch: -0.05, indoor: false },
    // â€¦captured a SECOND time, unchanged, purely to measure how much this
    // renderer's own frame-to-frame noise is worth. Without it "the course must
    // not move" has no scale, and the first run duly failed on a 0.03 luma
    // wobble â€” GTAO and cloud animation, not the change under test. A tolerance
    // has to be measured, not assumed, or it is just a number tuned until the
    // red goes away.
    { id: 'c1-course-repeat', x: -0.8, z: 12.0, yaw: 0, pitch: -0.05, indoor: false },
  ];
  const CROPS = {
    whole: { x0: 0, x1: 1, y0: 0, y1: 1 },
    ceilingBand: { x0: 0.15, x1: 0.85, y0: 0.02, y1: 0.30 },
    navBand: { x0: 0.15, x1: 0.85, y0: 0.62, y1: 0.96 },
  };

  // Read the shipped scale BEFORE the sweep touches it. The first run of this
  // file read it afterwards and reported "shippedScale: 0.2", which was simply
  // the last value the sweep had set â€” an instrument reporting its own footprint
  // as a measurement.
  const shipped = await page.evaluate(() => window.__fw.scene3d.interiorFill.scale());

  // 1.00 first and deliberately: it is the negative control, and it is also the
  // shipped behaviour before this change.
  const SCALES = [1.00, 0.55, 0.40, 0.30, 0.20];
  const results = [];

  for (const scale of SCALES) {
    // eslint-disable-next-line no-await-in-loop
    await page.evaluate((s) => { window.__fw.scene3d.interiorFill.setScale(s); }, scale);
    const rows = [];
    let overwriteCheck = null;
    let outdoorCheck = null;
    for (const pose of POSES) {
      // eslint-disable-next-line no-await-in-loop
      await page.evaluate((p) => {
        const app = window.__fw;
        // RE-PIN THE CLOCK. The probe runs at 1x (it must â€” the shell only learns
        // the circuit is dead when the clubhouse update runs), so game time
        // advances between captures and the sun moves with it. The first run
        // measured the outdoor control drifting 56.56 -> 56.62 across the sweep
        // and reported "courseUntouched: false" for a change that never touched
        // it. Frames compared against each other have to be taken at the same
        // time of day.
        app.state.clock.minutes = 10 * 60;
        const o = app.scene3d.clubhouse().interior.position;
        const w = app.scene3d.walk.state;
        w.x = p.x + o.x; w.z = p.z + o.z; w.yaw = p.yaw; w.pitch = p.pitch;
      }, pose);
      // eslint-disable-next-line no-await-in-loop
      await page.waitForTimeout(700);
      if (!pose.indoor && pose.id === 'c1-course') {
        // THE COURSE CONTROL, measured at the mechanism rather than through the
        // image. Comparing outdoor screenshots across scales was answering the
        // question indirectly and kept tripping on 0.05 luma of renderer noise
        // (GTAO and cloud animation; the end-of-run drift control reads 0.000, so
        // it is not the clock). What actually has to be true is simpler and
        // exact: standing outside, the indoorness factor is zero, so the
        // hemisphere is the untouched base value and the course cannot have
        // changed. The luma is still reported, now as corroboration rather than
        // as the proof.
        // eslint-disable-next-line no-await-in-loop
        outdoorCheck = await page.evaluate(() => {
          const F = window.__fw.scene3d.interiorFill;
          return { factor: F.factor(), hemi: +F.hemiIntensity().toFixed(6), scale: F.scale() };
        });
      }
      if (pose.id === 'p2-retail-wall') {
        // THE OVERWRITE CONTROL, taken well inside the room where the factor is 1.
        // Sampled across frames because applyTimeWeather rewrites the intensity
        // on every one of them: a scale that only holds for an instant is not a
        // fix, and would read identically to a fix that works.
        // eslint-disable-next-line no-await-in-loop
        overwriteCheck = await page.evaluate(async () => {
          const F = window.__fw.scene3d.interiorFill;
          const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
          const samples = [];
          for (let i = 0; i < 8; i += 1) {
            // eslint-disable-next-line no-await-in-loop
            await frame();
            samples.push(+F.hemiIntensity().toFixed(4));
          }
          return { factor: +F.factor().toFixed(3), samples, scale: F.scale() };
        });
      }
      const file = path.join(shotDir, `s${String(scale).replace('.', '')}-${pose.id}.png`);
      // eslint-disable-next-line no-await-in-loop
      const buf = await page.screenshot({ path: file });
      const img = decodePng(buf);
      rows.push({
        pose: pose.id,
        indoor: pose.indoor,
        whole: lumaStats(img, CROPS.whole),
        ceilingBand: lumaStats(img, CROPS.ceilingBand),
        navBand: lumaStats(img, CROPS.navBand),
      });
    }
    const indoors = rows.filter((r) => r.indoor);
    const inTheRoom = indoors.filter((r) => r.pose !== 'p1-door-in');
    const p3 = rows.find((r) => r.pose === 'p3-under-faulted-run');
    results.push({
      scale,
      interiorMeanLuma: +(indoors.reduce((a, r) => a + r.whole.mean, 0) / indoors.length).toFixed(2),
      // Per pose as well. p1 stands in the doorway looking out and is carried by
      // real daylight through the glazing; averaging it in hides what happened
      // to the three poses that are actually inside the room.
      perPose: Object.fromEntries(rows.map((r) => [r.pose, r.whole.mean])),
      // The three poses that are actually IN the room. p1 stands in the doorway
      // looking out and is carried by daylight through the glazing â€” the
      // proposal predicted it would barely move and it does not, so averaging it
      // in drags the figure toward a pose the change was never going to affect.
      inTheRoomMeanLuma: +(inTheRoom.reduce((a, r) => a + r.whole.mean, 0) / inTheRoom.length).toFixed(2),
      courseMeanLuma: rows.find((r) => r.pose === 'c1-course').whole.mean,
      courseRepeatMeanLuma: rows.find((r) => r.pose === 'c1-course-repeat').whole.mean,
      // The two floors, from the measurement in DARK_STATE_PROPOSAL.md Â§2.
      p3CeilingBandMean: p3.ceilingBand.mean,
      panelFacesReadable: indoors.every((r) => r.ceilingBand.p95 >= 12),
      navBandContrast: +Math.min(...indoors.map((r) => r.navBand.p95 - r.navBand.p05)).toFixed(1),
      navBandHasShape: indoors.every((r) => r.navBand.p95 - r.navBand.p05 >= 6),
      overwriteCheck,
      outdoorCheck,
      rows,
    });
  }

  const control = results.find((r) => r.scale === 1.00);

  // THE DRIFT CONTROL. Back to scale 1.00 and shoot the outdoor pose one more
  // time, at the END of the run. The back-to-back repeat above measures noise
  // between two adjacent frames; this measures how much the frame moves over the
  // whole sweep, which is the interval the cross-scale comparison actually spans.
  // Without it the run failed on 0.08 of drift against a 0.05 back-to-back floor
  // â€” a tolerance too tight for the thing it was applied to.
  await page.evaluate(() => { window.__fw.scene3d.interiorFill.setScale(1.0); });
  await page.evaluate(() => {
    const app = window.__fw;
    app.state.clock.minutes = 10 * 60;
    const o = app.scene3d.clubhouse().interior.position;
    const w = app.scene3d.walk.state;
    w.x = -0.8 + o.x; w.z = 12.0 + o.z; w.yaw = 0; w.pitch = -0.05;
  });
  await page.waitForTimeout(700);
  const driftBuf = await page.screenshot({ path: path.join(shotDir, 'drift-control-course.png') });
  const courseAtControlAfterSweep = lumaStats(decodePng(driftBuf), CROPS.whole).mean;
  const runDrift = Math.abs(courseAtControlAfterSweep - control.courseMeanLuma);

  await page.evaluate((s) => { window.__fw.scene3d.interiorFill.setScale(s); }, shipped);

  const out = {
    shippedScale: shipped,
    blendYd: await page.evaluate(() => window.__fw.scene3d.interiorFill.blendYd),
    sweep: results.map((r) => ({
      scale: r.scale,
      interiorMeanLuma: r.interiorMeanLuma,
      inTheRoomMeanLuma: r.inTheRoomMeanLuma,
      courseMeanLuma: r.courseMeanLuma,
      p3CeilingBandMean: r.p3CeilingBandMean,
      perPose: r.perPose,
      panelFacesReadable: r.panelFacesReadable,
      navBandContrast: r.navBandContrast,
      navBandHasShape: r.navBandHasShape,
      vsControlPct: +(((r.interiorMeanLuma - control.interiorMeanLuma) / control.interiorMeanLuma) * 100).toFixed(1),
      inTheRoomVsControlPct: +(((r.inTheRoomMeanLuma - control.inTheRoomMeanLuma)
        / control.inTheRoomMeanLuma) * 100).toFixed(1),
    })),
    // 1. the knob is connected
    knobIsConnected: results.some((r) => r.scale !== 1.00
      && Math.abs(r.interiorMeanLuma - control.interiorMeanLuma) > 1.0),
    // 2. the scale survives applyTimeWeather's per-frame write
    survivesTheFrameLoop: results.every((r) => {
      const c = r.overwriteCheck;
      if (!c) return false;
      return c.factor > 0.99 && new Set(c.samples).size === 1;
    }),
    // 3. the course is untouched at every scale â€” within this renderer's own
    //    measured noise, which is what the repeat capture is for.
    courseAtControlAfterSweep,
    courseRunDrift: +runDrift.toFixed(3),
    courseNoiseFloor: +Math.max(
      runDrift,
      ...results.map((r) => Math.abs(r.courseRepeatMeanLuma - r.courseMeanLuma)),
    ).toFixed(3),
    courseMaxDeviation: +Math.max(
      ...results.map((r) => Math.abs(r.courseMeanLuma - control.courseMeanLuma)),
    ).toFixed(3),
    // Exact, and at the mechanism: outside, the factor is 0 and the hemisphere
    // carries the same intensity it carries with the effect disabled. Nothing
    // about the course can differ, whatever the screenshot's noise says.
    courseUntouched: results.every((r) => r.outdoorCheck
      && r.outdoorCheck.factor === 0
      && r.outdoorCheck.hemi === control.outdoorCheck.hemi),
    courseLumaWithinNoise: results.every((r) => Math.abs(r.courseMeanLuma - control.courseMeanLuma)
      <= Math.max(runDrift, ...results.map((q) => Math.abs(q.courseRepeatMeanLuma - q.courseMeanLuma)))),
    outdoorHemiByScale: Object.fromEntries(results.map((r) => [r.scale, r.outdoorCheck?.hemi ?? null])),
    detail: results,
    shots: shotDir,
  };
  out.ok = out.knobIsConnected && out.survivesTheFrameLoop && out.courseUntouched;
  fs.writeFileSync(path.join(outDir, 'interior-fill-sweep.json'), `${JSON.stringify(out, null, 2)}\n`);
  return {
    ok: out.ok,
    knobIsConnected: out.knobIsConnected,
    survivesTheFrameLoop: out.survivesTheFrameLoop,
    courseUntouched: out.courseUntouched,
    shippedScale: out.shippedScale,
    courseNoiseFloor: out.courseNoiseFloor,
    courseMaxDeviation: out.courseMaxDeviation,
    courseRunDrift: out.courseRunDrift,
    courseLumaWithinNoise: out.courseLumaWithinNoise,
    outdoorHemiByScale: out.outdoorHemiByScale,
    sweep: out.sweep,
  };
}
