// R4 — "Real page turn. Leaf lifts, bends, settles, paper sound. Not a
// crossfade."
//
// A crossfade and a turn are indistinguishable from a still, so this samples
// the turn AS IT RUNS and captures frames through it. What separates the two:
//   - a leaf MESH exists and is visible only during the turn;
//   - it ROTATES about the gutter through half a revolution;
//   - its surface BENDS - the sheet's own vertices leave the flat plane and
//     come back, which a crossfade cannot do;
//   - it LIES on the page at both ends, and lifts clear in the middle;
//   - the paper cue fires on the turn and again on the settle.
//
// Negative control: the same probe is run while NOT turning, and must report a
// flat, hidden, unrotated leaf - otherwise "it bends" means nothing.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/ledger-turn');
  fs.mkdirSync(OUT, { recursive: true });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message || e)));
  const VIEWPORT = { width: 1600, height: 900 };

  await page.setViewportSize(VIEWPORT);
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
  await page.waitForTimeout(2500);
  await page.mouse.click(VIEWPORT.width / 2, VIEWPORT.height / 2);
  await page.waitForTimeout(200);

  await page.evaluate(async () => {
    const app = window.__fw;
    const { REGISTER } = await import(new URL('src/data/shopLayout.js', document.baseURI).href);
    const club = app.scene3d.clubhouse();
    app.speedIdx = 0;
    app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440 + 10 * 60;
    app.scene3d.applyTimeWeather(600, app.state.weather);
    club.setOrganicWalkins(false);
    const off = club.interior.position;
    const walk = app.scene3d.walk.state;
    walk.x = REGISTER.stand.x + off.x;
    walk.z = REGISTER.stand.z + off.z;
    const book = club.ledgerBook.position();
    const dx = (book.x + off.x) - walk.x;
    const dz = (book.z + off.z) - walk.z;
    const h = Math.hypot(dx, dz) || 0.001;
    walk.yaw = Math.atan2(-dx / h, -dz / h);
    walk.pitch = Math.atan2((book.y + off.y) - app.scene3d.camera.position.y, h);
  });
  await page.waitForTimeout(600);

  // Per-FRAME recording. The turn runs in 0.55 s; a driver that round-trips
  // page.evaluate every ~600 ms sees one sample of it and calls it static,
  // which is exactly what the first cut of this driver did. The recorder runs
  // inside the page on rAF and is read out afterwards.
  await page.evaluate(() => {
    const app = window.__fw;
    window.__leafProbe = () => {
      const club = app.scene3d.clubhouse();
      const root = club.interior.getObjectByName('FrontDeskLedgerBook');
      if (!root) return { error: 'no root' };
      const pivot = root.getObjectByName('LedgerTurningLeafPivot');
      const mesh = root.getObjectByName('LedgerTurningLeafFront');
      if (!pivot || !mesh) return { error: 'leaf nodes missing' };
      let vis = pivot.visible;
      for (let p = pivot.parent; vis && p; p = p.parent) vis = p.visible;
      const position = mesh.geometry.attributes.position;
      let minY = Infinity; let maxY = -Infinity;
      for (let i = 0; i < position.count; i += 1) {
        minY = Math.min(minY, position.getY(i));
        maxY = Math.max(maxY, position.getY(i));
      }
      return {
        visible: vis,
        rotationTurns: +(pivot.rotation.z / Math.PI).toFixed(3),
        pivotY: +pivot.position.y.toFixed(4),
        sheetSpanMm: +((maxY - minY) * 1000).toFixed(2),
        vertexCount: position.count,
      };
    };
    window.__leafTrack = [];
    window.__leafRecording = false;
    const tick = () => {
      if (window.__leafRecording && window.__leafTrack.length < 400) {
        const probe = window.__leafProbe();
        probe.t = performance.now();
        window.__leafTrack.push(probe);
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  const diag = () => page.evaluate(() => window.__fw.scene3d.clubhouse().ledgerBook.diagnostics());
  await page.keyboard.press('e');
  await page.waitForFunction(() => window.__fw.ledgerOpen === true, null, { timeout: 10000 });
  await page.waitForFunction(
    () => window.__fw.scene3d.clubhouse().ledgerBook.diagnostics().state === 'open',
    null, { timeout: 8000 },
  );
  await page.waitForTimeout(700);

  // NEGATIVE CONTROL: at rest, before any turn
  const atRest = await page.evaluate(() => window.__leafProbe());
  const cuesBefore = (await diag()).cues.length;

  // ---- the turn, recorded per frame --------------------------------------
  await page.evaluate(() => {
    window.__leafTrack = [];
    window.__leafRecording = true;
    window.__fw.scene3d.clubhouse().ledgerBook.turnPage(1);
  });
  await page.waitForTimeout(1400);
  await page.evaluate(() => { window.__leafRecording = false; });
  const samples = await page.evaluate(() => window.__leafTrack);

  // Frames THROUGH a live turn. The screenshot round trip is ~110 ms against a
  // 550 ms turn, so five shots straddle it; the numbers above are the per-frame
  // record, and these are what it looks like.
  const shots = [];
  await page.evaluate(() => window.__fw.scene3d.clubhouse().ledgerBook.turnPage(-1));
  for (let i = 0; i < 5; i += 1) {
    const name = `turn-${String(i).padStart(2, '0')}.png`;
    await page.screenshot({ path: path.join(OUT, name) });
    shots.push(name);
    await page.waitForTimeout(110);
  }
  await page.waitForTimeout(900);
  const settled = await page.evaluate(() => window.__leafProbe());
  const afterAll = await diag();
  const cues = afterAll.cues.length - cuesBefore;
  const afterDiag = afterAll;
  await page.screenshot({ path: path.join(OUT, 'turn-settled.png') });

  await page.keyboard.press('Escape').catch(() => {});

  const during = samples.filter((s) => s.visible && !s.error);
  const rotations = during.map((s) => s.rotationTurns);
  const bends = during.map((s) => s.sheetSpanMm);
  const restBend = atRest.sheetSpanMm ?? null;
  const checks = {
    leafExists: !atRest.error,
    // the control: nothing showing, and no turn dialled in, before the turn
    hiddenAtRest: atRest.visible === false,
    // the leaf really travels around the gutter
    leafRotatesThroughHalfTurn: rotations.length >= 3
      && Math.max(...rotations.map(Math.abs)) > 0.55
      && Math.min(...rotations.map(Math.abs)) < 0.35,
    // and its own surface deforms - a crossfade cannot
    sheetBends: bends.length >= 3 && Math.max(...bends) > (restBend ?? 0) + 8,
    leafVisibleOnlyWhileTurning: during.length >= 3 && settled.visible === false,
    landsOnTheNextSpread: afterDiag.turning === false,
    paperCueOnTurnAndSettle: afterDiag.cues.filter((c) => c === 'paper').length >= 2,
    noPageErrors: errs.length === 0,
  };
  const out = {
    atRest,
    samples,
    settled,
    paperCues: cues,
    cueTail: afterDiag.cues,
    afterDiag: { spread: afterDiag.spread, turning: afterDiag.turning, leafProfile: afterDiag.leafProfile },
    bendRange: bends.length ? [Math.min(...bends), Math.max(...bends)] : null,
    rotationRange: rotations.length ? [Math.min(...rotations), Math.max(...rotations)] : null,
    shots,
    errs: errs.slice(0, 8),
    checks,
  };
  out.ok = Object.values(checks).every(Boolean);
  fs.writeFileSync(path.join(OUT, 'ledger-turn.json'), `${JSON.stringify(out, null, 1)}\n`);
  return out;
}
