// INPUT TO PIXEL FOR THE COURSE EDITOR -- entering it, leaving it, and the
// first tool press inside it.
//
// The editor warm stage was retired on a measurement of 79.3 ms
// (tools/qa/warm-stage-value.js). The owner now reports feeling exactly that
// latency in play, which leaves two possibilities and this driver exists to
// separate them:
//
//   * the 79.3 ms is right and 79 ms is simply more perceptible than a number
//     suggests, or
//   * the 79.3 ms is wrong, because it was taken by a driver that opened the
//     editor ONCE, through the API, in a quiet room -- which is not what a
//     player does.
//
// So this presses the REAL key (`j`, keyBindings.courseEditor), with the sim
// live -- clock running, customers staged, stock on the shelves -- and measures
// from keydown to the frame on which the editor is actually up. It repeats,
// because a single open cannot show a distribution, and it reports
// p50/p95/p99/max and the histogram rather than a median: a median cannot
// describe felt lag.
//
// TWO CONTROLS, both of which must behave before any number here is evidence:
//
//   FLOOR   the same transition driven through the API with no key at all.
//           The shortest this instrument can report. If the floor is large,
//           the instrument is measuring the boot rather than the editor.
//   INJECT  a known delay (INJECT_MS) put in front of the transition. The
//           instrument must report about that much MORE than the floor. A probe
//           that cannot see a latency deliberately placed in front of it cannot
//           testify that latency is absent -- and "the editor is fine now" is
//           the claim this driver has to be able to refuse.
//
//   node tools/qa/run-electron.cjs tools/qa/editor-input-to-pixel.js --clubhouse=pine-hills-v2
//
// QA_EDITOR_REPS   how many open/close cycles to measure (default 6)
// QA_NAV_STAGE     customers to stage before measuring (default 4)
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const OUT = 'qa/editor-latency';
  fs.mkdirSync(OUT, { recursive: true });
  const out = { failures: [], rows: [] };
  const fail = (w) => { out.failures.push(w); console.log('FAIL:', w); };

  const REPS = Number(process.env.QA_EDITOR_REPS || 6);
  const INJECT_MS = 300;

  const boot = await import(`file:///${process.cwd().split(String.fromCharCode(92)).join('/')}/tools/qa/lib/qa-boot.mjs`);
  await boot.clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(2500);

  // THE EDITOR MUST ACTUALLY BE REACHABLE. enterEditor refuses -- with a toast
  // and no state change -- while a carton is carried, and a driver that never
  // noticed would report every refusal as an instant open. Asserted, not hoped.
  const reachable = await page.evaluate(() => !!window.__fw?.editorUi);
  if (!reachable) { fail('window.__fw.editorUi is absent — nothing here opened the editor'); return out; }

  // THE SIM LIVE. The retired measurement was taken in a quiet room; this is
  // the difference the owner is pointing at.
  await page.evaluate(() => {
    const st = window.__fw.state;
    st.clock.minutes = Math.floor(st.clock.minutes / 1440) * 1440 + 630;
    if ('speedIdx' in st) st.speedIdx = 1;
  });
  await page.waitForTimeout(1500);

  // The recorder: keydown stamps t0, and the transition is called complete one
  // full rAF callback AFTER the editor's active flag flips -- the frame that
  // carried it has by then been submitted, so this is input to PIXEL and not
  // input to state change.
  await page.evaluate(() => {
    const w = window;
    w.__fwEd = { t0: 0, done: null, seenAt: 0, arm: false, want: true, frames: [], lastRaf: 0 };
    const S = w.__fwEd;
    // TWO WAYS TO STAMP THE PRESS, because one of them cannot see Escape.
    //
    // The capture listener below is the accurate one: it stamps in the page,
    // on the real event. But the editor registers its own Escape handler and
    // calls stopImmediatePropagation, and a listener added later on the same
    // target is then never called at all -- so six exits in a row came back
    // "no keydown was ever stamped". That is the probe going blind, not the
    // game losing input, and the difference matters.
    //
    // So `arm` pre-stamps at dispatch time and this listener OVERWRITES the
    // stamp when it does fire. Enter is measured on the real event; exit is
    // measured from dispatch, which includes a small constant of CDP delivery
    // and is therefore the pessimistic direction. Which one each row used is
    // reported rather than assumed.
    addEventListener('keydown', (e) => {
      if (S.arm && !e.repeat) { S.t0 = performance.now(); S.arm = false; S.sawKeydown = true; }
    }, true);
    const active = () => {
      try { return !!w.__fw.editorUi().isActive(); } catch { return false; }
    };
    const loop = (t) => {
      if (S.lastRaf) S.frames.push(+(t - S.lastRaf).toFixed(2));
      S.lastRaf = t;
      if (S.t0 && S.done == null && S.valid !== false) {
        if (S.seenAt) S.done = +(performance.now() - S.t0).toFixed(2);
        else if (active() === S.want) S.seenAt = t;
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });

  const arm = (want) => page.evaluate((w) => {
    const S = window.__fwEd;
    S.t0 = performance.now(); S.done = null; S.seenAt = 0; S.arm = true; S.want = w;
    S.sawKeydown = false;
    // A TRANSITION THAT WAS ALREADY SATISFIED IS NOT A FAST TRANSITION.
    //
    // The completion test is `active() === want`, which is trivially true the
    // instant it is armed if the editor was already in the wanted state -- so a
    // press that never opened the editor came back as a 26 ms EXIT, and five
    // bogus sub-30 ms rows went into a table that was about to be reported. The
    // state at arm time is recorded so a sample that never had anywhere to go
    // can be thrown out rather than averaged in.
    S.before = (() => { try { return !!window.__fw.editorUi().isActive(); } catch { return null; } })();
    S.valid = S.before !== w;
    S.frames.length = 0;
    return (() => { try { return !!window.__fw.editorUi().isActive(); } catch { return null; } })();
  }, want);

  const read = async (label) => {
    const r = await page.evaluate(() => {
      const S = window.__fwEd;
      const f = S.frames.slice();
      return {
        ms: S.done, fired: !!S.t0, sawKeydown: !!S.sawKeydown, valid: S.valid !== false,
        worstFrame: f.length ? Math.max(...f) : null,
      };
    });
    if (!r.fired) fail(`${label}: nothing was stamped at all — the recorder never armed`);
    // A transition the game DISCARDED is a result, not a broken probe: a
    // refused open (carrying a carton, a modal already up) leaves the flag
    // where it was and the press simply vanishes, which is worse for the
    // player than a slow open and belongs in the report as its own row.
    if (!r.valid) fail(`${label}: the editor was ALREADY in the wanted state — this sample had nowhere to go and is discarded, not counted as fast`);
    r.swallowed = r.fired && r.valid && r.ms == null;
    return r;
  };

  // A real human tap on the bound key, then a wait for the transition to land
  // rather than a fixed interval -- with a ceiling, since a discarded press
  // never lands at all.
  const tapKey = async (key, want) => {
    await arm(want);
    await page.keyboard.down(key);
    await page.waitForTimeout(90);
    await page.keyboard.up(key);
    await page.waitForFunction(() => window.__fwEd.done != null, null, { timeout: 20000 })
      .catch(() => {});
    await page.waitForTimeout(600);
  };

  const stats = (xs) => {
    const v = xs.filter((x) => typeof x === 'number').sort((a, b) => a - b);
    if (!v.length) return null;
    const at = (q) => v[Math.min(v.length - 1, Math.floor(q * v.length))];
    return {
      n: v.length, p50: at(0.5), p95: at(0.95), p99: at(0.99), max: v[v.length - 1],
    };
  };

  // ---------------------------------------------------------------- controls
  //
  // The floor is taken AFTER one warm open/close: the very first open of a
  // process pays a real load and compile, and a floor measured on that cost
  // would be subtracted from every row beneath it -- hiding exactly the latency
  // this driver exists to find. That trap already voided the swap driver once.
  await page.evaluate(() => { window.__fw.editorUi().show(); });
  await page.waitForTimeout(1500);
  await page.evaluate(() => { window.__fw.editorUi().hide(); });
  await page.waitForTimeout(1500);

  const apiFloor = await page.evaluate(async () => {
    const t0 = performance.now();
    window.__fw.editorUi().show();
    await new Promise((r) => requestAnimationFrame(r));
    await new Promise((r) => requestAnimationFrame(r));
    const ms = +(performance.now() - t0).toFixed(2);
    window.__fw.editorUi().hide();
    return ms;
  });
  await page.waitForTimeout(1200);
  out.floorMs = apiFloor;
  console.log(`CONTROL floor (API open, no key, already warm): ${apiFloor} ms`);

  const injected = await page.evaluate(async (inject) => {
    const t0 = performance.now();
    const until = performance.now() + inject;
    while (performance.now() < until) { /* a real block, not a timer */ }
    window.__fw.editorUi().show();
    await new Promise((r) => requestAnimationFrame(r));
    await new Promise((r) => requestAnimationFrame(r));
    const ms = +(performance.now() - t0).toFixed(2);
    window.__fw.editorUi().hide();
    return ms;
  }, INJECT_MS);
  await page.waitForTimeout(1200);
  out.injectedMs = injected;
  const sawInjection = injected - apiFloor > INJECT_MS * 0.7;
  console.log(`CONTROL inject ${INJECT_MS} ms: ${injected} ms (floor + ${(injected - apiFloor).toFixed(1)})`
    + `  ${sawInjection ? 'SEEN' : 'NOT SEEN'}`);
  if (!sawInjection) {
    fail(`the instrument could not see a ${INJECT_MS} ms delay placed directly in front of it — no number below is evidence`);
  }

  // ------------------------------------------------------------ the measurement
  const enters = [];
  const exits = [];
  const firstTool = [];
  for (let i = 0; i < REPS; i += 1) {
    await tapKey('j', true);
    const enter = await read(`enter #${i + 1}`);
    enters.push(enter);

    await tapKey('Escape', false);
    const keyExit = await read(`exit #${i + 1}`);
    exits.push(keyExit);
  }

  // THE TOOL PRESS IS MEASURED IN ITS OWN REP, AT THE END, AND FOR A REASON.
  //
  // Picking a tool makes the session DIRTY, and a dirty session turns Escape
  // into a "Leave the editor?" confirmation modal instead of an exit -- so the
  // next Escape closes the modal, the one after re-opens it, and the editor
  // never closes at all. Six exits timed out at 20 s each and were nearly
  // reported as the editor being stuck. It is not stuck; it is asking. So the
  // loop above keeps the session clean to measure the real exit, and the tool
  // press happens once here, after it.
  await tapKey('j', true);
  if ((await read('tool rep')).ms != null) {
    // The first tool press INSIDE the editor, on the rep where the editor is
    // freshly open -- the surface goal 35 measured at an 11.8 s first frame.
    {
      const tool = await page.evaluate(async () => {
        const t0 = performance.now();
        let worst = 0;
        let last = performance.now();
        let live = true;
        const tick = () => {
          const n = performance.now();
          worst = Math.max(worst, n - last);
          last = n;
          if (live) setTimeout(tick, 0);
        };
        setTimeout(tick, 0);
        try { window.__fw.editorUi().setTool('terrain'); } catch { /* recorded by the null below */ }
        await new Promise((r) => requestAnimationFrame(r));
        await new Promise((r) => requestAnimationFrame(r));
        live = false;
        return { ms: +(performance.now() - t0).toFixed(2), worstBlock: +worst.toFixed(1) };
      });
      firstTool.push(tool);
    }

    // ESCAPE, NOT `j`. The bound `courseEditor` action calls enterEditor() and
    // nothing else -- it does not toggle -- so the first cut of this driver
    // pressed `j` to leave and recorded six swallowed presses in a row. That
    // was the probe pressing a key the exit path does not listen to, not the
    // game discarding input, and reporting it would have invented a bug.
  }

  const row = (label, rows) => {
    const usable = rows.filter((r) => r.valid);
    const s = stats(usable.map((r) => r.ms));
    const swallowed = usable.filter((r) => r.swallowed).length;
    out.rows.push({
      label, stats: s, swallowed, discarded: rows.length - usable.length,
      samples: usable.map((r) => r.ms),
    });
    const onReal = usable.filter((r) => r.sawKeydown).length;
    console.log(`  ${label.padEnd(22)} ${s ? `p50 ${String(s.p50).padStart(8)}  p95 ${String(s.p95).padStart(8)}  p99 ${String(s.p99).padStart(8)}  max ${String(s.max).padStart(8)}` : 'no samples'}`
      + `   on the real keydown ${onReal}/${usable.length}`
      + (rows.length - usable.length ? `   discarded ${rows.length - usable.length}` : '')
      + (swallowed ? `   SWALLOWED ${swallowed}` : ''));
    if (s) console.log(`  ${' '.repeat(22)} samples: ${usable.map((r) => r.ms).join(', ')}`);
  };
  console.log('');
  console.log('INPUT TO PIXEL, real key, sim live:');
  row('enter the editor', enters);
  row('exit the editor', exits);
  const ft = stats(firstTool.map((r) => r.ms));
  const fb = stats(firstTool.map((r) => r.worstBlock));
  out.firstToolMs = ft;
  out.firstToolWorstBlock = fb;
  console.log(`  ${'first tool press'.padEnd(22)} ${ft ? `p50 ${ft.p50}  max ${ft.max}   worst block max ${fb ? fb.max : 'n/a'}` : 'no samples'}`);
  console.log(`  ${' '.repeat(22)} samples: ${firstTool.map((r) => r.ms).join(', ')}`);

  fs.writeFileSync(`${OUT}/editor-latency.json`, JSON.stringify(out, null, 2));
  console.log(`failures: ${out.failures.length}`);
  return out;
}
