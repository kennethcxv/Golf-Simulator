// PLAYTEST 5, ITEM 1 — FIRST-PRESS LAG IS BACK, ON EVERYTHING.
//
//   "Every new button press spikes. Turning a page in the book. Pressing T for
//    the phone. Each one lags the first time and is fine afterwards. ... verify
//    by the PROGRAM COUNTER, not milliseconds — you have already shown the ms
//    are noise."
//
// So the number here is `renderer.info.programs.length`: THREE's live list of
// compiled GL programs. It only grows when a material is drawn for the first
// time in a configuration nothing has drawn yet. A first press that compiles is
// a first press whose delta is positive; a first press that is slow with a delta
// of ZERO is slow for some other reason, and that distinction is the whole item.
//
// Sampled at rAF, from before the deferred warm runs, so the warm's own
// compiles are visible as a rise rather than as a baseline I never saw.
//
// NEGATIVE CONTROL, and it is a real one rather than a planted trick: the
// deferred GPU warm exists precisely to compile the eight hand programs, and it
// runs 1600 ms after the veil lifts. The counter MUST rise across it. A counter
// that is flat through a warm whose own report says `hands: done` is not reading
// program compilation, and every zero below would be meaningless.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-first-press-programs.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/first-press-programs');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { presses: [] };

  // The counter goes in before the menu is dismissed so the boot rise is on record.
  await page.evaluate(() => {
    const p = { samples: [], t0: performance.now(), running: true, longTasks: [] };
    window.__progProbe = p;
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) p.longTasks.push({ start: +e.startTime.toFixed(1), dur: +e.duration.toFixed(1) });
      }).observe({ entryTypes: ['longtask'] });
    } catch { /* no longtask support */ }
    const tick = (ts) => {
      const r = window.__fw?.scene3d?.renderer;
      p.samples.push({
        t: +(performance.now() - p.t0).toFixed(0),
        ts: +ts.toFixed(1),
        programs: r?.info?.programs?.length ?? null,
        calls: r?.info?.render?.calls ?? null,
      });
      if (p.running) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    p.stop = () => { p.running = false; return p; };
  });

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });

  const programs = () => page.evaluate(() => window.__fw?.scene3d?.renderer?.info?.programs?.length ?? null);
  const veilGone = await programs();
  console.log(`programs when the veil lifted: ${veilGone}`);

  // ---------------------------------------------------- CONTROL: the warm rises
  await page.waitForFunction(() => window.__fwWarm && window.__fwWarm.sweep !== 'pending', null, { timeout: 60000 })
    .catch(() => {});
  await page.waitForTimeout(4000);
  out.warm = await page.evaluate(() => (window.__fwWarm ? { ...window.__fwWarm } : null));
  const afterWarm = await programs();
  out.control = {
    programsAtVeilLift: veilGone,
    programsAfterWarm: afterWarm,
    delta: (afterWarm ?? 0) - (veilGone ?? 0),
    warmReport: out.warm,
  };
  out.controlDetected = out.control.delta > 0;
  console.log(`CONTROL the deferred warm (${JSON.stringify(out.warm)}): programs `
    + `${veilGone} -> ${afterWarm} (delta ${out.control.delta}) `
    + `${out.controlDetected ? 'ROSE — the counter reads compilation' : 'FLAT — THE COUNTER IS BLIND'}`);

  // ------------------------------------------------------------- the presses
  // Each surface is opened, closed, and opened again. The claim under test is
  // that the FIRST open compiles and the second does not.
  // PerformanceObserver('longtask') only fires at 50 ms. A first-press hitch the
  // player feels can be well under that, so the frame gap is read from the rAF
  // stream too -- the rate the thing being felt actually happens at.
  const press = async (label, keys, settleMs = 1400, verb = null) => {
    const before = await programs();
    const t0 = Date.now();
    const marks = await page.evaluate(() => ({
      n: window.__progProbe.longTasks.length,
      s: window.__progProbe.samples.length,
    }));
    if (verb) await page.evaluate(verb);
    for (const k of keys) {
      await page.keyboard.press(k);
      await page.waitForTimeout(140);
    }
    await page.waitForTimeout(settleMs);
    const after = await programs();
    const { tasks, gaps } = await page.evaluate(({ fromTask, fromSample }) => {
      const p = window.__progProbe;
      const window_ = p.samples.slice(fromSample);
      const g = [];
      for (let i = 1; i < window_.length; i += 1) g.push(+(window_[i].ts - window_[i - 1].ts).toFixed(1));
      return { tasks: p.longTasks.slice(fromTask), gaps: g };
    }, { fromTask: marks.n, fromSample: marks.s });
    const sortedGaps = gaps.slice().sort((a, b) => a - b);
    const row = {
      label,
      keys: keys.join('+'),
      programsBefore: before,
      programsAfter: after,
      programDelta: (after ?? 0) - (before ?? 0),
      wallMs: Date.now() - t0,
      frames: gaps.length,
      medianFrameMs: sortedGaps.length ? sortedGaps[Math.floor(sortedGaps.length / 2)] : null,
      worstFrameMs: sortedGaps.length ? sortedGaps[sortedGaps.length - 1] : null,
      longTasks: tasks.sort((a, b) => b.dur - a.dur).slice(0, 3),
      worstLongTaskMs: tasks.length ? Math.max(...tasks.map((x) => x.dur)) : 0,
    };
    out.presses.push(row);
    console.log(`  ${label.padEnd(36)} programs ${String(before).padStart(4)} -> ${String(after).padEnd(4)} `
      + `delta ${String(row.programDelta).padStart(3)}   worst FRAME ${String(row.worstFrameMs).padStart(6)} ms `
      + `(median ${row.medianFrameMs})   longtask ${row.worstLongTaskMs} ms`);
    return row;
  };

  console.log('\nFIRST vs SECOND press, by program count:');
  await press('phone T — FIRST open', ['KeyT']);
  await press('phone T — close', ['KeyT']);
  await press('phone T — SECOND open', ['KeyT']);
  await press('phone T — close again', ['KeyT']);

  await press('tool wheel F — FIRST', ['KeyF']);
  await press('tool wheel F — SECOND', ['KeyF']);

  await press('pause P — FIRST', ['KeyP']);
  await press('pause P — close', ['Escape']);
  await press('pause P — SECOND', ['KeyP']);
  await press('pause P — close again', ['Escape']);

  await press('overview Tab — FIRST', ['Tab'], 2200);
  await press('overview Tab — back on foot', ['Tab'], 2200);
  await press('overview Tab — SECOND', ['Tab'], 2200);
  await press('overview Tab — back again', ['Tab'], 2200);

  // THE BOOK. The owner named "turning a page in the book" alongside the phone.
  // Reaching it with the E key needs the player standing at the desk aiming at
  // the cover, which is a navigation problem, not this item's question. The
  // question here is whether the SURFACE compiles programs the first time it is
  // drawn, so the book's own verbs are called directly -- the same advance() and
  // page turns enterLedger drives. The INPUT PATH is not under test; the program
  // count is. Said plainly because a driver that reaches a thing by a different
  // road has to declare the road.
  const bookVerb = (name) => () => {
    const book = window.__fw?.scene3d?.clubhouse?.()?.ledgerBook;
    if (!book) return 'no-book';
    if (typeof book[name] !== 'function') return `no-${name}`;
    book[name]();
    return 'ok';
  };
  out.bookReachable = await page.evaluate(() => {
    const book = window.__fw?.scene3d?.clubhouse?.()?.ledgerBook;
    return book ? Object.keys(book).filter((k) => typeof book[k] === 'function').slice(0, 40) : null;
  });
  console.log(`\nledger book verbs available: ${JSON.stringify(out.bookReachable)}`);
  if (out.bookReachable) {
    await press('ledger — FIRST raise (advance)', [], 1600, bookVerb('advance'));
    await press('ledger — FIRST open (advance)', [], 1600, bookVerb('advance'));
    await press('ledger — FIRST page turn', [], 1600, bookVerb('navigateForward'));
    await press('ledger — SECOND page turn', [], 1600, bookVerb('navigateForward'));
    await press('ledger — THIRD page turn', [], 1600, bookVerb('navigateForward'));
  }

  const sample = await page.evaluate(() => window.__progProbe.stop());
  fs.writeFileSync(path.join(OUT, 'samples.json'), `${JSON.stringify(sample.samples, null, 0)}\n`);

  // ------------------------------------------------------------- the verdict
  const firsts = out.presses.filter((p) => /FIRST/.test(p.label));
  const seconds = out.presses.filter((p) => /SECOND/.test(p.label));
  out.verdict = {
    controlDetected: out.controlDetected,
    firstPressesThatCompiled: firsts.filter((p) => p.programDelta > 0).map((p) => `${p.label} (+${p.programDelta})`),
    firstPressesThatCompiledNothing: firsts.filter((p) => p.programDelta === 0).map((p) => `${p.label} (worst task ${p.worstLongTaskMs} ms)`),
    secondPressesThatCompiled: seconds.filter((p) => p.programDelta > 0).map((p) => `${p.label} (+${p.programDelta})`),
  };
  console.log('\nVERDICT');
  console.log(`  first presses that COMPILED  : ${JSON.stringify(out.verdict.firstPressesThatCompiled)}`);
  console.log(`  first presses that compiled 0: ${JSON.stringify(out.verdict.firstPressesThatCompiledNothing)}`);
  console.log(`  second presses that compiled : ${JSON.stringify(out.verdict.secondPressesThatCompiled)}`);

  fs.writeFileSync(path.join(OUT, 'result.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log(`wrote ${path.join(OUT, 'result.json')}`);
  return out;
}
