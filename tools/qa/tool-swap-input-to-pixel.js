// INPUT TO PIXEL FOR A TOOL SWAP -- the number the player is complaining about.
//
// The owner played the build and reported that every tool swap is laggy. The
// harness answered 4.2 ms median and zero frames over 33 ms. Both are true,
// because they are not measurements of the same thing:
//
//   * EVERY tool driver in this repo (831 of them) swaps with
//     `walk.setTool('broom')` -- a direct API call. That path has no keyboard,
//     no tap/hold arbitration and no debounce.
//   * The PLAYER presses a key. `src/main.js` routes that key through
//     beginToolKey/endToolKey, and `cycleWalkTool()` is called from
//     endToolKey -- which runs on key UP.
//
// So this measures from the KEYDOWN of a real dispatched key press to the frame
// on which the new viewmodel is actually drawn, with a realistic human press
// duration, on a live scene (clock running, sim ticking, a staged crowd, stock
// on the shelves). It reports p50/p95/p99/max and the histogram, because a
// median cannot describe felt lag: 4 ms and 120 ms average to something that
// looks fine and feels terrible.
//
// TWO CONTROLS, both of which must behave before any number here is evidence:
//
//   FLOOR   the same swap driven through `setToolImmediate` with no key at all.
//           That is the shortest this instrument can possibly report. If the
//           floor is not small, the instrument is measuring the boot, not the
//           swap, and every row below is noise.
//   INJECT  a known delay (INJECT_MS) wrapped around the swap. The instrument
//           must report approximately that much MORE than the floor. A probe
//           that cannot see a latency deliberately put in front of it cannot
//           testify that latency is absent -- and "no latency found" is the
//           claim this driver exists to be able to refuse.
//
//   node tools/qa/run-electron.cjs tools/qa/tool-swap-input-to-pixel.js --clubhouse=pine-hills-v2
//
// QA_SWAP_PRESS_MS  how long the key is held (default 90 -- a human tap)
// QA_NAV_STAGE      customers to stage before measuring (default 4)
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const OUT = 'qa/swap-latency';
  fs.mkdirSync(OUT, { recursive: true });
  const out = { failures: [], rows: [] };
  const fail = (w) => { out.failures.push(w); console.log('FAIL:', w); };

  const PRESS_MS = Number(process.env.QA_SWAP_PRESS_MS || 90);
  const INJECT_MS = 300;
  const STAGE = Number(process.env.QA_NAV_STAGE || 4);

  const boot = await import(`file:///${process.cwd().split(String.fromCharCode(92)).join('/')}/tools/qa/lib/qa-boot.mjs`);
  await boot.clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(2500);

  // THE BELT MUST EXIST. `walkToolEntries` marks every indoor tool
  // `available: false` until the cleaning kit is owned, and `cycleWalkTool`
  // filters on exactly that -- so on an untouched starter the belt is one entry
  // long ("hands free") and nine presses of F measure nothing at all. Asserted
  // rather than assumed, because a belt of one would read as a very fast swap.
  out.kit = await page.evaluate(() => {
    const inv = window.__fw.state.shop.inventory;
    inv.vac1 = inv.vac1 || { shelf: 0, back: 0 };
    inv.vac1.back = Math.max(1, inv.vac1.back);
    const day = Math.floor(window.__fw.state.clock.minutes / 1440) * 1440;
    window.__fw.state.clock.minutes = day + 11 * 60;
    return { back: inv.vac1.back, minutes: window.__fw.state.clock.minutes };
  });

  // THE SCENE THE OWNER PLAYS, not a quiet staged room: the sim ticking, the
  // clock running at its normal rate, and people on the floor.
  if (STAGE > 0) {
    out.staged = await page.evaluate(async (n) => {
      const ch = window.__fw.scene3d.clubhouse();
      let made = 0;
      for (let i = 0; i < n; i += 1) {
        const c = (i % 2 === 0 && ch.sendWalkInToDesk)
          ? ch.sendWalkInToDesk({ skipRetailPlan: false })
          : (ch.sendToCounter ? ch.sendToCounter([]) : null);
        if (c) made += 1;
        await new Promise((r) => setTimeout(r, 300));
      }
      return made;
    }, STAGE);
    console.log(`staged ${out.staged}/${STAGE} customers`);
  }
  out.people = await page.evaluate(() => {
    const d = window.__fw.scene3d.clubhouse?.()?.crowdDiagnostics?.();
    return d ? d.people : null;
  });

  // ---------------------------------------------------------------- recorder
  //
  // Everything below runs IN THE PAGE, because the quantity is a handful of
  // milliseconds and a Playwright round trip is of the same order. The stamp is
  // taken in a capture-phase keydown listener on window -- the first thing that
  // sees the key -- and the finish is the rAF callback AFTER the one on which
  // the new tool became equipped, because that is the first callback that can
  // only run once the frame carrying the new viewmodel has been submitted.
  await page.evaluate(() => {
    const w = window;
    w.__fwSwap = { t0: 0, key: null, target: null, done: null, frames: [], lastRaf: 0 };
    const S = w.__fwSwap;
    addEventListener('keydown', (e) => {
      if (S.arm && !e.repeat) { S.t0 = performance.now(); S.arm = false; }
    }, true);
    const loop = (t) => {
      if (S.lastRaf) S.frames.push(+(t - S.lastRaf).toFixed(2));
      S.lastRaf = t;
      if (S.t0 && S.done == null) {
        const cur = w.__fw.scene3d.walk.getTool() || null;
        if (S.seenAt) {
          // one full callback later: the frame that carried it has been drawn
          S.done = +(performance.now() - S.t0).toFixed(2);
          S.tool = cur;
        } else if (cur !== S.from) {
          S.seenAt = t;
        }
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });

  const armSwap = () => page.evaluate(() => {
    const S = window.__fwSwap;
    S.t0 = 0; S.done = null; S.seenAt = 0; S.arm = true;
    S.from = window.__fw.scene3d.walk.getTool() || null;
    return S.from;
  });
  // A SWALLOWED PRESS IS A RESULT, NOT A BROKEN PROBE.
  //
  // The second run reported "the tool never changed" for seven presses in a
  // row, and the frame histogram for the same window carried a single 8,142 ms
  // interval. That is not the instrument failing: `endToolKey` only cycles when
  // `performance.now() - toolKeyStarted < 500`, so a block longer than half a
  // second makes a perfectly normal tap look like a half-minute hold and the
  // press is DISCARDED. The player pressed the key and the game did nothing at
  // all. So a null is recorded as `swallowed` and counted, because losing the
  // input outright is worse than serving it late and belongs in the report.
  const readSwap = async (label) => {
    const r = await page.evaluate(() => {
      const S = window.__fwSwap;
      return {
        ms: S.done, from: S.from, to: S.done == null ? null : (S.tool ?? null), fired: !!S.t0,
      };
    });
    if (!r.fired) fail(`${label}: no keydown was ever stamped — the recorder never saw the key`);
    r.swallowed = r.fired && r.ms == null;
    return r;
  };

  // A real human tap: down, hold, up. Then wait for the swap to actually land
  // rather than for a fixed interval, so a slow swap is measured rather than
  // truncated -- with a ceiling, because a press the game discarded never lands.
  const tapBelt = async () => {
    await armSwap();
    await page.keyboard.down('f');
    await page.waitForTimeout(PRESS_MS);
    await page.keyboard.up('f');
    await page.waitForFunction(() => window.__fwSwap.done != null, null, { timeout: 4000 })
      .catch(() => {});
    await page.waitForTimeout(700);
  };

  // ---------------------------------------------------------------- controls
  //
  // WARM THE BELT FIRST. The first run of this driver read a 337.8 ms "floor"
  // and failed its own control -- correctly, but for a reason that was not an
  // instrument fault: the floor was the first equip of `broom` in the process,
  // which pays a real load and compile. A floor taken on cold geometry measures
  // that cost and then subtracts it from every row beneath, which would have
  // hidden exactly the latency this driver exists to find. So every tool is
  // equipped once through the API before either control is taken, and the
  // controls then describe a warm swap -- which is also the state the owner is
  // in when he complains, because he had already been playing.
  out.beltWarm = await page.evaluate(async () => {
    const w = window.__fw.scene3d.walk;
    const set = (t) => (w.setToolImmediate || w.setTool)(t);
    const belt = ['vacuum', 'mop', 'broom', 'dustpan', 'spray', 'cloth', 'sponge', 'trashbag'];
    let done = 0;
    for (const t of belt) { set(t); await new Promise((r) => setTimeout(r, 450)); done += 1; }
    set(null);
    await new Promise((r) => setTimeout(r, 450));
    return done;
  });
  console.log(`\nbelt pre-warmed through the API: ${out.beltWarm}/8 tools`);

  console.log('\n== CONTROLS ==');

  // FLOOR: the API path, no key. Stamp t0 by hand since no key is pressed.
  const floor = await page.evaluate(async () => {
    const S = window.__fwSwap;
    const w = window.__fw.scene3d.walk;
    const belt = ['broom', 'mop', 'vacuum', 'spray', 'cloth'];
    const from = w.getTool() || null;
    const to = belt.find((b) => b !== from) || 'broom';
    S.from = from; S.done = null; S.seenAt = 0;
    S.t0 = performance.now();
    (w.setToolImmediate || w.setTool)(to);
    await new Promise((r) => setTimeout(r, 800));
    return { ms: S.done, from, to };
  });
  out.floorMs = floor.ms;
  console.log(`  FLOOR (setToolImmediate, no key): ${floor.ms} ms   ${floor.from} -> ${floor.to}`);
  if (floor.ms == null || floor.ms > 120) {
    fail(`the floor control read ${floor.ms} ms — this instrument cannot resolve a swap, so nothing below is evidence`);
  }

  // INJECT: a known delay in front of the same path. Must show up.
  const inject = await page.evaluate(async (delay) => {
    const S = window.__fwSwap;
    const w = window.__fw.scene3d.walk;
    const from = w.getTool() || null;
    const to = from === 'broom' ? 'mop' : 'broom';
    S.from = from; S.done = null; S.seenAt = 0;
    S.t0 = performance.now();
    await new Promise((r) => setTimeout(r, delay));
    (w.setToolImmediate || w.setTool)(to);
    await new Promise((r) => setTimeout(r, 800));
    return { ms: S.done, from, to };
  }, INJECT_MS);
  out.injectMs = inject.ms;
  // The injected delay is compared against ITSELF, not against the floor. The
  // first version subtracted the floor and reported "saw 28.9 ms of 300" on a
  // run where the total was 366.7 ms -- i.e. the instrument had seen the whole
  // delay and the arithmetic hid it. A deliberate delay of D must produce a
  // reading of at least D; that is the entire claim, and it needs no floor.
  console.log(`  INJECT (+${INJECT_MS} ms deliberately): ${inject.ms} ms`);
  if (inject.ms == null || inject.ms < INJECT_MS) {
    fail(`a deliberate ${INJECT_MS} ms delay was reported as ${inject.ms} ms — this instrument cannot see latency put in front of it, so it cannot testify that latency is absent`);
  }

  // ---------------------------------------------------------------- the belt
  const station = async (label, place) => {
    if (place) await page.evaluate((p) => {
      const st = window.__fw.scene3d.walk.state;
      st.x = p.x; st.z = p.z;
    }, place);
    await page.waitForTimeout(1500);
    await page.evaluate(() => (window.__fw.scene3d.walk.setToolImmediate || window.__fw.scene3d.walk.setTool)(null));
    await page.waitForTimeout(600);
    console.log(`\n== ${label} ==   (press held ${PRESS_MS} ms)`);
    const rows = [];
    for (let i = 0; i < 9; i += 1) {
      await tapBelt();
      const r = await readSwap(`${label} press ${i + 1}`);
      rows.push({ i: i + 1, ...r });
      console.log(`  press ${String(i + 1).padStart(2)}  ${String(r.from).padEnd(10)} -> `
        + `${String(r.to).padEnd(10)}  ${r.swallowed ? '  SWALLOWED' : `${String(r.ms).padStart(8)} ms`}`);
      out.rows.push({ station: label, ...r });
    }
    const ok = rows.map((r) => r.ms).filter((m) => m != null).sort((a, b) => a - b);
    const q = (p) => (ok.length ? ok[Math.min(ok.length - 1, Math.floor(ok.length * p))] : null);
    const s = {
      station: label,
      n: ok.length,
      swallowed: rows.filter((r) => r.swallowed).length,
      p50: q(0.5),
      p95: q(0.95),
      max: ok[ok.length - 1] ?? null,
    };
    console.log(`  -> p50 ${s.p50} ms   p95 ${s.p95} ms   max ${s.max} ms`
      + `   swallowed ${s.swallowed}/9`);
    return s;
  };

  const places = await page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse();
    return { inside: ch.localToWorld(0, 1.2) };
  });
  out.indoor = await station('INDOORS, on the shop floor', places.inside);

  // ------------------------------------------------------------- the HOLD
  //
  // The tap was moved to keydown, so the hold has to be re-proved: the wheel
  // must still open, and the tool must be the one that was in hand when the key
  // went down -- not the one the keydown tap advanced to. Without this check the
  // fix trades a fast tap for a belt that silently advances every time the
  // player opens the wheel.
  await page.evaluate(() => (window.__fw.scene3d.walk.setToolImmediate
    || window.__fw.scene3d.walk.setTool)('broom'));
  await page.waitForTimeout(800);
  await page.keyboard.down('f');
  await page.waitForTimeout(700);
  out.hold = await page.evaluate(() => ({
    wheelOpen: document.body.classList.contains('tool-wheel-open'),
    tool: window.__fw.scene3d.walk.getTool() || null,
  }));
  await page.screenshot({ path: `${OUT}/hold-wheel.png` });
  await page.keyboard.up('f');
  await page.waitForTimeout(600);
  console.log(`\nHOLD: wheel open=${out.hold.wheelOpen}  tool in hand=${out.hold.tool} (want broom)`);
  if (!out.hold.wheelOpen) fail('holding the belt key no longer opens the tool wheel');
  if (out.hold.tool !== 'broom') {
    fail(`holding the belt key left ${out.hold.tool} in hand, not the broom that was held at keydown — the hold is advancing the belt`);
  }

  // ------------------------------------------------------- the frame histogram
  out.frames = await page.evaluate(() => {
    const f = window.__fwSwap.frames.filter((x) => x > 0);
    const s = f.slice().sort((a, b) => a - b);
    const q = (p) => +s[Math.min(s.length - 1, Math.floor(s.length * p))].toFixed(2);
    const buckets = { '<8': 0, '8-17': 0, '17-33': 0, '33-50': 0, '50-100': 0, '100-250': 0, '250+': 0 };
    for (const x of f) {
      if (x < 8) buckets['<8'] += 1; else if (x < 17) buckets['8-17'] += 1;
      else if (x < 33) buckets['17-33'] += 1; else if (x < 50) buckets['33-50'] += 1;
      else if (x < 100) buckets['50-100'] += 1; else if (x < 250) buckets['100-250'] += 1;
      else buckets['250+'] += 1;
    }
    return {
      n: s.length, p50: q(0.5), p95: q(0.95), p99: q(0.99), max: +s[s.length - 1].toFixed(2), buckets,
    };
  });
  const fr = out.frames;
  console.log(`\nframe intervals over the whole run (n=${fr.n}):`);
  console.log(`  p50 ${fr.p50}   p95 ${fr.p95}   p99 ${fr.p99}   max ${fr.max} ms`);
  console.log(`  histogram: ${JSON.stringify(fr.buckets)}`);

  fs.writeFileSync(`${OUT}/swap.json`, JSON.stringify(out, null, 2));
  console.log(`\nfailures: ${out.failures.length}`);
}
