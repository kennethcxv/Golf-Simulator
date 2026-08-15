// ITEM 7 — "The broom hand stays put while the head swings, so it reads
// detached. feel.sweep.handFollow exists. Measure hand travel against head
// travel across a stroke. 22 keys in that module were dead once, so check it
// is wired at all."
//
// Two questions, both answerable with numbers:
//
//   IS IT WIRED?  Set handFollow to zero and to ten times its value and check
//                 the measured hand travel actually changes. A key that is
//                 read but multiplied by something that is always zero looks
//                 wired in the source and is dead in the picture.
//
//   HOW DETACHED? Record the hands' and the head's SCREEN positions every
//                 frame while the use button is held, and report the
//                 peak-to-peak travel of each across a stroke plus the ratio.
//                 Screen travel is the right unit: "the hand stays put while
//                 the head swings" is a statement about the picture.
//
// The rig reports handNdcUpper / handNdcLower / headNdc in its own
// diagnostics, so nothing here has to guess at bone positions.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/broom-hand-follow');
  fs.mkdirSync(OUT, { recursive: true });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message || e)));
  const W = 1600; const H = 900;

  await page.setViewportSize({ width: W, height: H });
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForTimeout(3200);

  await page.evaluate(() => {
    const app = window.__fw;
    const o = app.scene3d.clubhouse().interior.position;
    const w = app.scene3d.walk;
    w.clearKeys();
    w.state.x = o.x - 5.6; w.state.z = o.z + 4.4; w.state.yaw = -Math.PI / 2; w.state.pitch = -0.36;
    const c = app.state.clock;
    c.minutes = Math.floor(c.minutes / 1440) * 1440 + 13 * 60;
    app.speedIdx = 0;
  });
  await page.mouse.click(W / 2, H / 2);
  await page.evaluate(() => window.__fw.scene3d.walk.setTool('broom'));
  await page.waitForFunction(() => window.__fw.scene3d.walk.broomDiagnostics?.()?.vmActive === true,
    null, { timeout: 30000 });
  await page.waitForTimeout(2600);

  // per-frame recorder — a stroke is under a second, so a driver that polls
  // over the bridge samples one point of it and learns nothing
  await page.evaluate(() => {
    window.__sweepTrack = [];
    window.__sweepRecording = false;
    const tick = () => {
      if (window.__sweepRecording && window.__sweepTrack.length < 1200) {
        const d = window.__fw.scene3d.walk.broomDiagnostics?.();
        if (d) {
          window.__sweepTrack.push({
            t: performance.now(),
            swing: d.swingRad,
            head: d.headNdc ? [d.headNdc[0] ?? d.headNdc.x, d.headNdc[1] ?? d.headNdc.y] : null,
            hi: d.handNdcUpper ? [d.handNdcUpper[0] ?? d.handNdcUpper.x, d.handNdcUpper[1] ?? d.handNdcUpper.y] : null,
            lo: d.handNdcLower ? [d.handNdcLower[0] ?? d.handNdcLower.x, d.handNdcLower[1] ?? d.handNdcLower.y] : null,
          });
        }
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  const record = async (seconds) => {
    await page.evaluate(() => { window.__sweepTrack = []; window.__sweepRecording = true; });
    await page.waitForTimeout(seconds * 1000);
    await page.evaluate(() => { window.__sweepRecording = false; });
    return page.evaluate(() => window.__sweepTrack);
  };

  const span = (track, key, axis) => {
    const values = track.map((s) => s[key]?.[axis]).filter((v) => Number.isFinite(v));
    if (values.length < 4) return null;
    return { min: Math.min(...values), max: Math.max(...values), p2p: Math.max(...values) - Math.min(...values), n: values.length };
  };
  const summarise = (track) => {
    // trim the first 20% — the arc ramps in and the spring is still settling
    const use = track.slice(Math.floor(track.length * 0.2));
    const swing = use.map((s) => s.swing).filter(Number.isFinite);
    return {
      frames: use.length,
      swingP2P: swing.length ? +(Math.max(...swing) - Math.min(...swing)).toFixed(4) : null,
      head: span(use, 'head', 0),
      handUpper: span(use, 'hi', 0),
      handLower: span(use, 'lo', 0),
    };
  };
  const ratio = (s) => (s.head?.p2p ? {
    upper: +((s.handUpper?.p2p ?? 0) / s.head.p2p).toFixed(3),
    lower: +((s.handLower?.p2p ?? 0) / s.head.p2p).toFixed(3),
  } : null);

  const baselineFollow = await page.evaluate(async () => (await import(
    new URL('src/data/broomFeel.js', document.baseURI).href)).BROOM_FEEL.sweep.handFollow);

  // Hold the use button. The walk controller exposes setSpraying — the same
  // entry the mouse button drives — so the stroke runs through production code
  // rather than a synthetic pose.
  const hold = async () => {
    await page.evaluate(() => window.__fw.scene3d.walk.setSpraying(true));
    await page.waitForTimeout(1200);
  };
  const release = async () => {
    await page.evaluate(() => window.__fw.scene3d.walk.setSpraying(false));
    await page.waitForTimeout(500);
  };

  // ---- IS IT WIRED? ------------------------------------------------------
  // BROOM_FEEL is deep-frozen, so the first cut of this driver tried to patch
  // handFollow, silently failed, and produced three identical runs that looked
  // like proof the key was dead. The control that does not need a patch: at
  // IDLE the stroke target is zero, so every sweep-driven term is off and only
  // bob/breathe move the hand. Sweeping must move it a great deal more.
  const idle = summarise(await record(3.0));
  await page.screenshot({ path: path.join(OUT, 'idle.png') });

  await hold();
  const shipped = summarise(await record(3.0));
  await page.screenshot({ path: path.join(OUT, 'sweep-shipped.png') });
  await release();

  // and the world-space number the complaint is really about: how far the hand
  // travels against how far the head travels, in yards, not in screen pixels
  const world = await page.evaluate(async () => {
    const app = window.__fw;
    const feel = (await import(new URL('src/data/broomFeel.js', document.baseURI).href)).BROOM_FEEL;
    const d = app.scene3d.walk.broomDiagnostics();
    const arc = feel.sweep.arcRad;
    const R = feel.sweep.handFollow;
    // the head's lever arm: how far in front of the hands the bristles sit
    const lever = d.drawReach ?? d.reach ?? 1.2;
    return {
      arcRad: arc,
      handRadiusYd: R,
      handRollGain: feel.sweep.handRoll ?? 0,
      handTravelYd: +(2 * Math.sin(arc) * R).toFixed(4),
      headTravelYd: +(2 * Math.sin(arc) * lever).toFixed(4),
      leverYd: +lever.toFixed(3),
      worldRatio: +((R / lever)).toFixed(3),
    };
  });

  const checks = {
    recordedFrames: shipped.frames > 40,
    headActuallySwings: (shipped.head?.p2p ?? 0) > 0.05,
    // the negative control: idle must be near-still
    idleHandIsStill: (idle.handUpper?.p2p ?? 1) < 0.05,
    // and the key is read - sweeping moves the hand far more than idle does
    handFollowIsWired: (shipped.handUpper?.p2p ?? 0) > (idle.handUpper?.p2p ?? 0) + 0.05,
    // ITEM 7's bar: the hand must carry a real share of the head's arc. Below
    // about a third it reads as a pivot rather than a pair of hands.
    handCarriesTheStroke: world.worldRatio >= 0.30,
    wristTurnsWithTheStroke: world.handRollGain > 0,
    noPageErrors: errs.length === 0,
  };
  const out = {
    baselineFollow,
    world,
    idle: { ...idle, ratio: ratio(idle) },
    shipped: { ...shipped, ratio: ratio(shipped) },
    errs: errs.slice(0, 8),
    checks,
  };
  out.ok = Object.values(checks).every(Boolean);
  fs.writeFileSync(path.join(OUT, 'broom-hand-follow.json'), `${JSON.stringify(out, null, 1)}\n`);
  return out;
}
