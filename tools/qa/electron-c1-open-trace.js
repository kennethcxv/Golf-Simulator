// C1 — WHAT DOES PRESSING E AT THE BOOK ACTUALLY DO, PRESS BY PRESS?
//
// The turn-cost driver waits for `state === 'open'` and has been timing out.
// One press cannot reach it (C1 made the open two presses) and two presses did
// not reach it either, so rather than guess at a third, watch the state machine
// itself: sample `diagnostics().state` continuously and print the transitions
// alongside the presses that caused them.
//
// The prompt is read too. If E is not the verb the book is offering — or the
// player is not close enough for the book to be the focus at all — then every
// press in this driver went somewhere else entirely and no count would have
// worked.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-c1-open-trace.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/c1-open-trace');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [], marks: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  const boot = await import(`file:///${bootPath}`);
  await boot.clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.bringToFront().catch(() => {});
  await page.waitForTimeout(4000);

  // Stand at the book the way the walk driver does — the route it already
  // proves works — and confirm the FOCUS is the ledger before pressing anything.
  out.stand = await page.evaluate(async () => {
    const fw = window.__fw;
    const ch = fw.scene3d.clubhouse();
    const walk = fw.scene3d.walk;
    const st = walk.state;
    let lp = ch.ledgerBook.position;
    if (typeof lp === 'function') lp = ch.ledgerBook.position();
    const ip = ch.interior.position;
    const book = { x: ip.x + lp.x, z: ip.z + lp.z };
    const to = { x: ip.x - book.x, z: ip.z - book.z };
    const len = Math.hypot(to.x, to.z) || 1;
    st.x = book.x + (to.x / len) * 1.3;
    st.z = book.z + (to.z / len) * 1.3;
    const base = Math.atan2(-(book.x - st.x), -(book.z - st.z));
    const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });
    for (const dp of [-0.3, -0.15, 0]) {
      for (let k = 0; k < 10; k += 1) {
        st.yaw = base + ((k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.2);
        st.pitch = dp;
        await sleep(100);
        const label = walk.getFocusLabel ? String(walk.getFocusLabel() || '') : '';
        if (/ledger|read/i.test(label)) return { hit: true, label: label.slice(0, 80) };
      }
    }
    return { hit: false, label: String(walk.getFocusLabel?.() || '').slice(0, 80) };
  });

  // Sample the state machine for the whole run, so the transitions are observed
  // rather than inferred from where the presses landed.
  await page.evaluate(() => {
    window.__c1 = {
      rows: [], stop: false, mark: null, frames: [],
    };
    let last = null;
    let prev = performance.now();
    const t0 = prev;
    const tick = () => {
      const now = performance.now();
      // EVERY FRAME'S LENGTH, not just the state changes.
      //
      // The first run of this trace showed 3.7 s between two transitions when
      // the driver had waited 1.4 s, and `open` never appeared at all. A state
      // sampler that runs on rAF cannot see anything while rAF is not running,
      // so a long enough stall is indistinguishable from a state that never
      // happened. The frame log is what tells those two apart.
      window.__c1.frames.push({ t: +(now - t0).toFixed(0), dt: +(now - prev).toFixed(1), mark: window.__c1.mark });
      prev = now;
      let s = null;
      try { s = window.__fw.scene3d.clubhouse().ledgerBook.diagnostics().state; } catch { s = 'threw'; }
      if (s !== last) {
        window.__c1.rows.push({ t: +(now - t0).toFixed(0), state: s, after: window.__c1.mark });
        last = s;
      }
      if (!window.__c1.stop) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  const press = async (n) => {
    await page.evaluate((m) => { window.__c1.mark = m; }, `press${n}`);
    await page.keyboard.press('e');
    await page.waitForTimeout(1400);
    return page.evaluate(() => {
      try {
        const d = window.__fw.scene3d.clubhouse().ledgerBook.diagnostics();
        // WHAT THE RENDERER GAINED, so a stall can be attributed instead of
        // merely timed. A shader compile shows up as `programs` jumping; a
        // texture upload as `textures`; neither moving would rule both out and
        // send the search somewhere else entirely.
        const r = window.__fw.scene3d.renderer;
        return {
          state: d.state,
          spread: d.spread ?? null,
          pageCount: d.pageCount ?? null,
          programs: r?.info?.programs?.length ?? null,
          textures: r?.info?.memory?.textures ?? null,
          geometries: r?.info?.memory?.geometries ?? null,
          lightIntensity: d.readingLight?.intensity ?? null,
          lightVisible: d.readingLight?.visible ?? null,
        };
      } catch (e) { return { threw: String(e && e.message) }; }
    });
  };

  out.beforeAnyPress = await page.evaluate(() => {
    try { return window.__fw.scene3d.clubhouse().ledgerBook.diagnostics().state; } catch { return 'threw'; }
  });
  // SIX PRESSES: raise, OPEN, close, raise, OPEN AGAIN, close.
  //
  // Five runs of the four-press version put press 2's worst frame at 68, 84 and
  // 88 ms three times and at 3506.5 ms twice — with only 24 frames sampled in
  // that window against ~150 in the fast runs. That is C1's "3 to 5 seconds",
  // intermittent at roughly two runs in five.
  //
  // The obvious suspect is A3's law, already proved on this same subsystem: the
  // reading light's visibility flip changes the light count, three.js bakes
  // light counts into every program cache key, and the ledger has been measured
  // recompiling 209 -> 241 programs in a single 1571.6 ms frame. If that is what
  // this is, the SECOND open of a session must be cheap, because the programs
  // are already in the cache by then.
  //
  // So open it twice and compare. One press pair cannot tell a compile from a
  // slow animation; two can.
  for (let n = 1; n <= 6; n += 1) out.marks.push({ press: n, ...(await press(n)) });

  await page.evaluate(() => { window.__c1.stop = true; });
  out.transitions = await page.evaluate(() => window.__c1.rows);
  const frames = await page.evaluate(() => window.__c1.frames);
  out.frameCount = frames.length;
  // The stalls, biggest first, each tagged with the press it followed.
  out.worstFrames = frames
    .slice().sort((a, b) => b.dt - a.dt).slice(0, 8)
    .map((f) => ({ atMs: f.t, dt: f.dt, afterMark: f.mark }));
  // Per-press windows: how much of each press's second was spent in frames a
  // player would see as a freeze.
  out.perMark = {};
  for (const f of frames) {
    const k = f.mark || 'boot';
    const m = (out.perMark[k] ||= { n: 0, over33: 0, over100: 0, worst: 0, stalledMs: 0 });
    m.n += 1;
    if (f.dt > 33) { m.over33 += 1; m.stalledMs += f.dt; }
    if (f.dt > 100) m.over100 += 1;
    if (f.dt > m.worst) m.worst = f.dt;
  }
  for (const m of Object.values(out.perMark)) m.stalledMs = +m.stalledMs.toFixed(0);
  out.prompt = await page.evaluate(() => {
    const el = document.querySelector('.focus-prompt, .prompt, [class*=prompt]');
    return el ? String(el.textContent || '').trim().slice(0, 140) : null;
  }).catch(() => null);

  fs.writeFileSync(path.join(OUT, 'c1-open-trace.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('C1-TRACE stand:', JSON.stringify(out.stand));
  console.log('  before any press:', out.beforeAnyPress, ' prompt:', out.prompt);
  for (const m of out.marks) console.log(`  after press ${m.press}: ${JSON.stringify(m)}`);
  console.log('  worst frames:', JSON.stringify(out.worstFrames));
  console.log('  per press  :', JSON.stringify(out.perMark));
  console.log('  transitions:', out.transitions.map((r) => `${r.after || 'boot'}@${r.t}=${r.state}`).join('  '));
  return out;
}
