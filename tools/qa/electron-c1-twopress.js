// C1 — E BRINGS THE BOOK UP SHUT; E AGAIN OPENS IT.
//
// The brief asks for a specific sequence and calls the current one "the wrong
// animation, not a mistuned one":
//   1. I press E. The book comes to my hands, CLOSED.
//   2. I press E again. It opens to the first page.
//
// This presses E on a real keyboard three times and reads the book's OWN state
// after each press, with a player-camera screenshot at every step. State names
// are the evidence, and the screenshots are what makes "closed" mean closed
// rather than a variable that says so.
//
// NEGATIVE CONTROL: a key bound to nothing is pressed between the real ones. If
// the state advances on that too, this driver is reading its own key handler
// rather than the game's.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/c1-twopress');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [], steps: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.bringToFront().catch(() => {});
  await page.waitForTimeout(8000);

  // Stand at the book and find it with the crosshair (staging only).
  await page.evaluate(() => {
    const fw = window.__fw;
    const ch = fw.scene3d.clubhouse();
    const st = fw.scene3d.walk.state;
    let lp = ch.ledgerBook.position;
    if (typeof lp === 'function') lp = ch.ledgerBook.position();
    const ip = ch.interior.position;
    const book = { x: ip.x + lp.x, z: ip.z + lp.z };
    const to = { x: ip.x - book.x, z: ip.z - book.z };
    const len = Math.hypot(to.x, to.z) || 1;
    st.x = book.x + (to.x / len) * 1.3;
    st.z = book.z + (to.z / len) * 1.3;
    st.yaw = Math.atan2(-(book.x - st.x), -(book.z - st.z));
    st.pitch = -0.3;
  });
  await page.waitForTimeout(800);
  out.focus = await page.evaluate(async () => {
    const walk = window.__fw.scene3d.walk;
    const st = walk.state;
    const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });
    const base = st.yaw;
    for (const dp of [-0.3, -0.15, 0]) {
      for (let k = 0; k < 10; k += 1) {
        st.yaw = base + ((k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.2);
        st.pitch = dp;
        await sleep(100);
        const l = walk.getFocusLabel ? String(walk.getFocusLabel() || '') : '';
        if (/ledger|read/i.test(l)) return { hit: true, label: l.slice(0, 60) };
      }
    }
    return { hit: false };
  });
  if (!out.focus.hit) {
    fs.writeFileSync(path.join(OUT, 'c1.json'), `${JSON.stringify(out, null, 2)}\n`);
    console.log('C1 ABORT: never focused the ledger');
    return out;
  }

  await page.mouse.click(700, 500); // real pointer lock, like a player
  await page.waitForTimeout(400);
  const keys = await page.evaluate(
    () => window.__fw.preferences?.values?.controls?.bindings || {},
  );
  const readState = () => page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse?.();
    const d = ch?.ledgerBook?.diagnostics?.() ?? null;
    return {
      state: d?.state ?? null,
      open: d?.open ?? null,
      cover: d?.cover ?? null,
      ledgerOpenFlag: !!window.__fw.ledgerOpen,
    };
  });

  const step = async (label, key, settleMs = 1400) => {
    await page.keyboard.press(key);
    await page.waitForTimeout(settleMs);
    const st = await readState();
    const shot = path.join(OUT, `c1-${out.steps.length}-${label}.png`);
    await page.screenshot({ path: shot });
    out.steps.push({ label, key, ...st, shot });
    return st;
  };

  out.before = await readState();
  const s1 = await step('press1-should-be-held-shut', keys.interact || 'e');
  // THE CONTROL: a key bound to nothing. The state must not move.
  const sControl = await step('control-unbound-key', 'k', 900);
  // Settle long enough that the book is fully `open`, not still `opening`. A
  // sweep started mid-animation walks two spreads instead of five and then
  // reports zero of everything - a clean result on a third of the coverage,
  // which is the same lie as a clean result on a shut book.
  const s2 = await step('press2-should-be-open', keys.interact || 'e', 2600);
  await page.waitForFunction(
    () => window.__fw.scene3d.clubhouse?.()?.ledgerBook?.diagnostics?.()?.state === 'open',
    null, { timeout: 8000 },
  ).catch(() => {});
  // C2/C3 — SWEEP EVERY SPREAD, WHILE THE BOOK IS STILL OPEN. The first
  // version of this ran after the third press had shut it: one spread walked,
  // zero overlaps, zero squeezes, all of it meaningless. Same fault class as
  // the dry mop.
  // SWEEP EVERY SPREAD while the book is open, and read the book's own
  // recorders: overlaps (already there) and squeezes (new - a string that would
  // not fit even shrunk to the floor, which is a page that needs paginating).
  // C6 — WHAT A PAGE TURN COSTS. Measured before assuming there is work here:
  // the previous session put per-turn cost at 1 hitch worst 54.1 ms, and A3's
  // light fix removed a recompile that was firing on this book, so the number
  // may already be inside budget. Sampled per frame across every turn of the
  // sweep below, attributed to the turn that was in flight.
  await page.evaluate(() => {
    const s = { rows: [], turning: false, stop: false };
    window.__c6 = s;
    let last = performance.now();
    const tick = () => {
      const now = performance.now();
      s.rows.push({ dt: +(now - last).toFixed(2), turning: s.turning });
      last = now;
      if (!s.stop) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  out.pages = await page.evaluate(async () => {
    const ch = window.__fw.scene3d.clubhouse();
    const book = ch.ledgerBook;
    const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });
    const seen = [];
    const total = book.diagnostics().spreadCount || 0;
    for (let i = 0; i < total + 1; i += 1) {
      const d = book.diagnostics();
      seen.push({ spread: d.spread, pageCount: d.pageCount });
      window.__c6.turning = true;
      if (!book.turnPage(1)) { window.__c6.turning = false; break; }
      // turnPage REFUSES while a leaf is still in flight, so a fixed sleep
      // silently ends the sweep early: two spreads of five, reported clean.
      // Wait for the book to say the turn is done.
      const spun = Date.now();
      while (Date.now() - spun < 4000) {
        await sleep(80);
        if (!book.diagnostics().turning) break;
      }
      window.__c6.turning = false;
      await sleep(160);
    }
    const d = book.diagnostics();
    return {
      spreadsWalked: seen.length,
      spreadCount: total,
      // coverage is part of the result, not a footnote
      coveredAll: total > 0 && seen.length >= total,
      overlaps: d.overlaps || [],
      squeezes: d.squeezes || [],
    };
  });


  const s3 = await step('press3-should-shut', keys.interact || 'e', 1800);

  out.turnCost = await page.evaluate(() => {
    const s = window.__c6;
    s.stop = true;
    const during = s.rows.filter((r) => r.turning).map((r) => r.dt);
    const idle = s.rows.filter((r) => !r.turning).map((r) => r.dt);
    const stat = (list) => (list.length ? {
      n: list.length,
      median: +[...list].sort((a, b) => a - b)[Math.floor(list.length / 2)].toFixed(2),
      worst: +Math.max(...list).toFixed(1),
      over16: list.filter((x) => x > 16).length,
      over33: list.filter((x) => x > 33).length,
    } : null);
    return { duringTurns: stat(during), betweenTurns: stat(idle) };
  });

  out.verdict = {
    turnWorstMs: out.turnCost?.duringTurns?.worst ?? null,
    turnsOver16: out.turnCost?.duringTurns?.over16 ?? null,
    turnsOver33: out.turnCost?.duringTurns?.over33 ?? null,
    sweptEverySpread: out.pages?.coveredAll === true,
    ledgerOverlaps: out.pages?.overlaps?.length ?? null,
    ledgerSqueezes: out.pages?.squeezes?.length ?? null,
    spreadsWalked: out.pages?.spreadsWalked ?? null,
    startedClosed: out.before.state === 'closed',
    // press 1: in hand, SHUT. `held` is the state C1 asks to exist.
    firstPressRaisesShut: (s1.state === 'held' || s1.state === 'raising')
      && s1.open === false,
    // the control must change nothing
    controlInert: sControl.state === s1.state,
    // press 2: open
    secondPressOpens: (s2.state === 'open' || s2.state === 'opening') && s2.open === true,
    // press 3: on its way back down
    thirdPressShuts: ['closing', 'lowering', 'closed'].includes(s3.state),
    states: [out.before.state, s1.state, sControl.state, s2.state, s3.state],
    covers: [out.before.cover, s1.cover, sControl.cover, s2.cover, s3.cover],
  };
  fs.writeFileSync(path.join(OUT, 'c1.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('C1 verdict', JSON.stringify(out.verdict));
  if (out.errs.length) console.log('pageerrors', JSON.stringify(out.errs.slice(0, 3)));
  return out;
}
