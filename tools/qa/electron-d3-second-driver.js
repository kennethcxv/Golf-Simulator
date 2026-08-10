// D3 (Goal 19) — WHO MOVES THE BOOK THE SECOND TIME?
//
// Goal 18's trace proved the second set-down never touches bookState (one
// clean pass, no re-entry, inside the trace window). So SOMETHING ELSE moves
// a book. This instrument wraps the ledger's own verbs (setOpen / advance /
// setCarried / placeAt) to log every call WITH ITS STACK, samples the root's
// world position and scale every frame, and plays the user's exact gesture:
// walk up, E to raise, E to open, E to close, hands off. If the root rises
// again after 'closed', the position trace shows it and the call log names
// the caller; if NOTHING calls the wrapped verbs while it rises, the driver
// samples WHICH OBJECT is actually moving (root vs a second mesh).
//
//   node tools/qa/run-electron.cjs tools/qa/electron-d3-second-driver.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/d3-second-driver');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForTimeout(2500);

  // stand at the book, wrap the verbs, start the samplers
  await page.evaluate(() => {
    const app = window.__fw;
    const ch = app.scene3d.clubhouse();
    const st = app.scene3d.walk.state;
    let lp = ch.ledgerBook.position;
    if (typeof lp === 'function') lp = ch.ledgerBook.position();
    const ip = ch.interior.position;
    const bx = ip.x + lp.x;
    const bz = ip.z + lp.z;
    const to = { x: ip.x - bx, z: ip.z - bz };
    const len = Math.hypot(to.x, to.z) || 1;
    st.x = bx + (to.x / len) * 1.2;
    st.z = bz + (to.z / len) * 1.2;
    const dx = bx - st.x;
    const dz = bz - st.z;
    const h = Math.hypot(dx, dz) || 0.001;
    st.yaw = Math.atan2(-dx / h, -dz / h);
    st.pitch = -0.45;
    // the user's conditions, not the harness's: LIVE sim speed and a held
    // tool (their recording shows a brush handle in frame through the whole
    // ledger interaction)
    app.speedIdx = 1;
    app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440 + 14 * 60;
    try { app.scene3d.walk.setTool('paint'); } catch (e) { void e; }
    ch.ledgerBook.prewarm?.();

    const book = ch.ledgerBook;
    const calls = [];
    window.__d3 = { calls, frames: [], keyEvents: [] };
    const t0 = performance.now();
    for (const verb of ['setOpen', 'advance', 'setCarried', 'placeAt', 'followCarry']) {
      const original = book[verb];
      if (typeof original !== 'function') continue;
      book[verb] = (...args) => {
        calls.push({
          t: +(performance.now() - t0).toFixed(0),
          verb,
          args: args.map((a) => (typeof a === 'object' ? '[obj]' : String(a))).slice(0, 2),
          stack: String(new Error().stack || '').split('\n').slice(2, 6)
            .map((line) => line.trim().replace(/^at /, '').slice(0, 90)),
        });
        return original(...args);
      };
    }
    window.addEventListener('keydown', (e) => {
      if (e.key.toLowerCase() === 'e') window.__d3.keyEvents.push({ t: +(performance.now() - t0).toFixed(0), type: 'down', repeat: e.repeat });
    }, true);
    window.addEventListener('keyup', (e) => {
      if (e.key.toLowerCase() === 'e') window.__d3.keyEvents.push({ t: +(performance.now() - t0).toFixed(0), type: 'up' });
    }, true);
    const sample = () => {
      const d = book.diagnostics();
      const root = book.root;
      window.__d3.frames.push({
        t: +(performance.now() - t0).toFixed(0),
        state: d.state,
        y: +root.position.y.toFixed(3),
        s: +root.scale.x.toFixed(3),
        wy: +root.getWorldPosition(new (root.position.constructor)()).y.toFixed(3),
      });
      if (window.__d3.frames.length < 3000) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await page.waitForTimeout(600);

  // the user's gesture: E raise, E open, read a beat, then a HUMAN E on the
  // close — a real key held ~350 ms fires OS auto-repeat keydowns
  // (repeat:true) into the 1-second close animation. Synthetic press() holds
  // for ~10 ms and never repeats, which is exactly why Goal 18's trace saw
  // one clean pass.
  await page.keyboard.press('e');
  await page.waitForTimeout(800);
  await page.keyboard.press('e');
  await page.waitForTimeout(1500);
  await page.evaluate(() => new Promise((resolve) => {
    const fire = (type, repeat) => window.dispatchEvent(new KeyboardEvent(type, {
      key: 'e', code: 'KeyE', bubbles: true, cancelable: true, repeat,
    }));
    fire('keydown', false);
    let count = 0;
    const iv = setInterval(() => {
      count += 1;
      fire('keydown', true); // the OS repeat train
      if (count >= 8) {
        clearInterval(iv);
        fire('keyup', false);
        resolve();
      }
    }, 90);
  }));
  // hands off for 4 s — the double happens ~0.2 s after landing
  await page.waitForTimeout(4000);

  const data = await page.evaluate(() => window.__d3);
  out.keyEvents = data.keyEvents;
  out.calls = data.calls;
  // compress the frame trace into (state, y-extent) spans
  const spans = [];
  for (const f of data.frames) {
    const last = spans[spans.length - 1];
    if (!last || last.state !== f.state) {
      spans.push({ state: f.state, from: f.t, to: f.t, yMin: f.y, yMax: f.y });
    } else {
      last.to = f.t;
      last.yMin = Math.min(last.yMin, f.y);
      last.yMax = Math.max(last.yMax, f.y);
    }
  }
  out.spans = spans;
  // the smoking gun: any y-rise WHILE state === 'closed'
  const closedRises = [];
  let prev = null;
  for (const f of data.frames) {
    if (f.state === 'closed' && prev && prev.state === 'closed' && f.y - prev.y > 0.02) {
      closedRises.push({ t: f.t, from: +prev.y.toFixed(3), to: +f.y.toFixed(3) });
    }
    prev = f;
  }
  out.closedRises = closedRises.slice(0, 12);
  out.DOUBLE_CONFIRMED = closedRises.length > 0
    || spans.filter((s) => s.state === 'raising' || s.state === 'closing' || s.state === 'lowering').length > 3;
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(out, null, 2));
  console.log('D3-DRIVER', JSON.stringify({
    keyEvents: out.keyEvents,
    spanStates: spans.map((s) => `${s.state}@${s.from}-${s.to}`),
    closedRises: out.closedRises,
    DOUBLE_CONFIRMED: out.DOUBLE_CONFIRMED,
    calls: out.calls.map((c) => `${c.t} ${c.verb}(${c.args.join(',')}) <- ${c.stack[0] || '?'}`),
  }));
}
