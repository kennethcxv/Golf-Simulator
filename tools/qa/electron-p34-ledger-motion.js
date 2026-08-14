// PHASE 3.4 (Goal 25) — FILM THE OPEN, THE CLOSE AND THE PAGE TURNS.
//
// The brief does not ask for a number here. It says: "It opens the right way now
// and the motion snaps. Film it, extract the frames, look at them, and fix the
// discontinuity you see."
//
// So this driver's job is to PRODUCE A CLIP OF THE REAL GESTURE with real keys,
// and alongside it to sample the one thing a clip cannot give you precisely:
// the cover angle every frame, so a snap can be located in time rather than
// squinted at. A jump in that series is a discontinuity whether or not my eye
// catches it in a contact sheet, and the frames say whether it matters.
//
//   VIDEO_DIR=qa/clips/p34-ledger node tools/qa/run-electron.cjs \
//     tools/qa/electron-p34-ledger-motion.js --clubhouse=pine-hills-v2
//   node tools/qa/clip-frames.mjs qa/clips/p34-ledger
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/p34-ledger-motion');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [], notes: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(2500);

  const canvas = await page.$('#game') || await page.$('canvas');
  const box = await canvas.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(600);

  // stand at the book, the same anchor 3.3 settled on (the book's own world
  // matrix, which exists whatever the facade exposes)
  const spot = await page.evaluate(() => {
    const ch = window.__fw.scene3d?.clubhouse?.();
    const r = ch?.ledgerBook?.root;
    if (!r) return null;
    r.updateWorldMatrix(true, false);
    const e = r.matrixWorld.elements;
    return { x: e[12], y: e[13], z: e[14] };
  });
  if (!spot) {
    out.verdict = 'UNMEASURED — no ledger book in this scene';
    out.ok = false;
    fs.writeFileSync(path.join(OUT, 'motion.json'), `${JSON.stringify(out, null, 2)}\n`);
    console.log('P34', JSON.stringify(out, null, 2));
    return out;
  }
  await page.evaluate((s) => {
    const w = window.__fw.scene3d.walk.state;
    const ch = window.__fw.scene3d.clubhouse();
    const c = ch.interior.position;
    let dx = c.x - s.x; let dz = c.z - s.z;
    const d = Math.hypot(dx, dz) || 1;
    dx /= d; dz /= d;
    w.x = s.x + dx * 1.9; w.z = s.z + dz * 1.9; w.vx = 0; w.vz = 0;
    const lx = s.x - w.x; const lz = s.z - w.z;
    const h = Math.hypot(lx, lz) || 0.001;
    w.yaw = Math.atan2(-lx / h, -lz / h);
    w.pitch = Math.atan2(s.y - 1.62, h);
  }, spot);
  await page.waitForTimeout(1200);

  // THE COVER ANGLE, SAMPLED AS FAST AS THE PAGE WILL GIVE IT.
  //
  // requestAnimationFrame rather than a setInterval: a 60 Hz timer sampling a
  // 60 fps animation aliases, and an aliased series invents steps that are not
  // in the motion. This rides the same clock the animation does.
  // NOT diagnostics().cover. That field is
  // `+Math.abs(cover.rotation.z / Math.PI).toFixed(2)` — quantised to 0.01, so a
  // step analysis run on it would measure the ROUNDING and report a snap of
  // exactly one quantum in a perfectly smooth ease. `float` is rounded the same
  // way. The cover node itself carries full precision, so read that.
  const coverName = await page.evaluate(() => {
    const r = window.__fw.scene3d?.clubhouse?.()?.ledgerBook?.root;
    if (!r) return null;
    let found = null;
    r.traverse((o) => { if (!found && /coverfront/i.test(o.name || '')) found = o.name; });
    if (found) return found;
    const names = [];
    r.traverse((o) => { if (o.name) names.push(o.name); });
    return { missing: true, sample: names.slice(0, 25) };
  });
  out.coverNode = coverName;
  if (!coverName || coverName.missing) {
    out.notes.push('cover node not found by name; falling back to the rounded diagnostics field');
  }

  const startSampler = () => page.evaluate((name) => {
    window.__p34 = [];
    const t0 = performance.now();
    const tick = () => {
      const ch = window.__fw.scene3d?.clubhouse?.();
      const book = ch?.ledgerBook;
      const d = book?.diagnostics?.();
      const node = (name && typeof name === 'string') ? book?.root?.getObjectByName(name) : null;
      if (d) {
        window.__p34.push({
          t: +(performance.now() - t0).toFixed(1),
          state: d.state,
          // full precision when the node is reachable; the rounded field only
          // as a labelled fallback so a reader can tell which they are seeing
          swing: node ? node.rotation.z : null,
          coverRounded: d.cover,
          turning: !!d.turning,
          open: d.open,
          spread: d.spread ?? null,
        });
      }
      if (window.__p34stop) return;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return true;
  }, (coverName && !coverName.missing) ? coverName : null);

  await startSampler();

  const beat = async (label, ms) => { out.notes.push(label); await page.waitForTimeout(ms); };

  // ONE KEY, THREE MEANINGS, IN ORDER (ledgerBook.advance, C1): press one
  // raises the book shut, press two swings the cover open, press three shuts it
  // and puts it back down. The first version of this driver pressed K once and
  // then turned pages on a SHUT book, so it filmed nothing and reported states
  // closed/raising/held with the cover at a flat zero for sixteen seconds. That
  // is not a snap; that is a driver that never opened the book.
  await beat('settled, closed, looking at the book', 900);
  await page.keyboard.press('k');           // REAL KEY: raise it shut
  await beat('K press 1 — the rise', 2200);
  // AND THE SECOND PRESS IS E, NOT K. Once the book is up, ledgerKeyHandler
  // owns the keyboard and it binds `interact` (E) to open-then-turn, `dirtSense`
  // (Q) and Escape to close. K is not in that handler at all. Pressing K three
  // times filmed a book that sat SHUT through every page turn -- turning frames
  // 0, spread never left 0 -- and I read that as "the turns do nothing" when it
  // was "the driver never opened the book".
  await page.keyboard.press('e');           // REAL KEY: swing the cover open
  await beat('E press — the cover swing', 2600);
  await page.keyboard.press('ArrowRight');  // REAL KEY: turn forward
  await beat('page turn forward', 1800);
  await page.keyboard.press('ArrowRight');
  await beat('page turn forward again', 1800);
  await page.keyboard.press('ArrowLeft');   // REAL KEY: turn back
  await beat('page turn back', 1800);
  // INTERRUPT THE GESTURE ON PURPOSE. The brief names it: "no restart-from-
  // assumed-endpoint when interrupted". Turning again mid-turn is the case.
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(120);
  await page.keyboard.press('ArrowRight');
  await beat('two turns 120 ms apart — the interrupt case', 2200);
  await page.keyboard.press('q');           // REAL KEY: shut it and put it down
  await beat('Q — the close and the lowering', 3200);

  const series = await page.evaluate(() => { window.__p34stop = true; return window.__p34 || []; });
  out.sampleCount = series.length;
  out.states = [...new Set(series.map((s) => s.state))];

  // WHERE DOES IT SNAP? Largest frame-to-frame step in the cover angle while it
  // is actually moving. A smooth ease has a bounded step; a snap is a single
  // frame carrying a large fraction of the whole travel.
  let worst = null;
  const steps = [];
  for (let i = 1; i < series.length; i += 1) {
    const a = series[i - 1];
    const b = series[i];
    if (a.swing == null || b.swing == null) continue;
    const d = Math.abs(b.swing - a.swing);
    const dt = b.t - a.t;
    if (d <= 0) continue;
    steps.push({ d, dt, t: b.t, from: a.swing, to: b.swing, state: b.state });
    if (!worst || d > worst.d) worst = { d: +d.toFixed(5), dt: +dt.toFixed(1), atMs: b.t, from: a.swing, to: b.swing, state: b.state };
  }
  // RAD PER SECOND, NOT RAD PER FRAME.
  //
  // The raw step is the wrong headline and it misled me for a run: the animation
  // is dt-driven, so a step is (velocity x frame time) and a long frame produces
  // a big step in a perfectly smooth ease. Comparing raw steps across runs
  // measured the machine's frame pacing as if it were the motion. Velocity is
  // the property of the animation; it is what should be compared, and the ideal
  // for a smoothstep is 1.5x the mean (peak of the ease).
  for (const s of steps) s.v = s.dt > 0 ? (s.d / (s.dt / 1000)) : 0;
  const byState = {};
  for (const s of steps) {
    const b = byState[s.state] || (byState[s.state] = { frames: 0, peakRadPerSec: 0, travel: 0, ms: 0 });
    b.frames += 1;
    b.travel += s.d;
    b.ms += s.dt;
    if (s.v > b.peakRadPerSec) b.peakRadPerSec = s.v;
  }
  out.perState = Object.fromEntries(Object.entries(byState).map(([k, b]) => [k, {
    frames: b.frames,
    travelRad: +b.travel.toFixed(4),
    durationMs: +b.ms.toFixed(1),
    meanRadPerSec: +(b.travel / (b.ms / 1000)).toFixed(2),
    peakRadPerSec: +b.peakRadPerSec.toFixed(2),
    // a clean smoothstep peaks at 1.5x its mean; well above that is a hitch
    peakOverMean: +(b.peakRadPerSec / (b.travel / (b.ms / 1000))).toFixed(2),
  }]));
  steps.sort((x, y) => y.d - x.d);
  out.biggestStep = worst;
  out.top5Steps = steps.slice(0, 5).map((s) => ({
    jumpFractionOfFullTravel: +s.d.toFixed(4), overMs: +s.dt.toFixed(1), atMs: s.t, state: s.state,
  }));
  out.movingFrames = steps.length;
  fs.writeFileSync(path.join(OUT, 'series.json'), `${JSON.stringify(series)}\n`);

  out.ok = out.errs.length === 0 && series.length > 0;
  out.notScored = 'whether the motion READS as smooth — that is the clip, and the frames have to be looked at';
  fs.writeFileSync(path.join(OUT, 'motion.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('P34', JSON.stringify({
    samples: out.sampleCount, states: out.states, movingFrames: out.movingFrames,
    biggestStep: out.biggestStep, top5: out.top5Steps, errs: out.errs,
  }, null, 2));
  return out;
}
