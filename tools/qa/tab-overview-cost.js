// WHAT DOES PRESSING TAB COST, AND WHY IS THE CURSOR HEAVY AFTERWARDS?
//
// The overview warm stage was retired on a 79 ms measurement while its own
// comment recorded the 1,490 ms first-Tab freeze it was written against. The
// owner reports the toggle is fine to look at but the CURSOR goes heavy after
// it -- a main-thread symptom, not a frame-rate one, and the two are measured
// differently.
//
// So this measures three things and keeps them apart:
//   1. the toggle itself, attributed across the ov-enter-* marks the handler
//      already writes, so a slow Tab names its own phase;
//   2. programs minted BY the press, first Tab against second, because a warm
//      that is genuinely retired mints nothing either time;
//   3. what the cursor costs AFTER the toggle -- a burst of real pointer moves
//      with the main-thread block recorded around them, in overview and in
//      walk, so "heavy in overview" has its own control beside it.
//
// It records BLOCKS from the timer queue, not frame intervals. When the
// display has gone to sleep the compositor drops to about 1 Hz and every
// frame-interval number becomes an artifact of that (boot-frame-clock.js tells
// the two apart); a main-thread block reads the same either way, which is what
// makes this driver runnable when input-to-pixel is not.
//
//   node tools/qa/run-electron.cjs tools/qa/tab-overview-cost.js --clubhouse=pine-hills-v2
//
// THE CONTROL is a deliberate 300 ms block put through the same recorder. If
// it does not come back as ~300 ms, nothing else here is evidence.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const OUT = 'qa/tab-overview';
  fs.mkdirSync(OUT, { recursive: true });
  const out = { failures: [], rounds: [] };
  const fail = (w) => { out.failures.push(w); console.log('FAIL:', w); };

  const boot = await import(`file:///${process.cwd().split(String.fromCharCode(92)).join('/')}/tools/qa/lib/qa-boot.mjs`);
  // QA_RESUME=1 measures the owner's OWN world instead of a canonical fresh
  // one. It matters here: a furnished shop carries stock, fixtures and
  // customers that a new game has none of, and the first Tab is exactly
  // where that difference would show.
  const resume = process.env.QA_RESUME === '1';
  await boot.clickThroughMenu(page, resume ? {} : { forceNew: true, pinSeed: 0.4242 });
  console.log(resume ? 'world: RESUMED from the profile save' : 'world: fresh new game (pinned)');
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => typeof window.__fwBoot?.veilLiftedMs === 'number', null, { timeout: 300000 });
  await page.waitForTimeout(2500);

  // The block recorder: a 0 ms timer chain. A gap between two ticks is time the
  // main thread refused to come back, which is what a heavy cursor is made of.
  await page.evaluate(() => {
    const rec = { gaps: [], stop: false };
    window.__fwBlocks = rec;
    let last = performance.now();
    const loop = () => {
      const t = performance.now();
      rec.gaps.push({ t, ms: t - last });
      last = t;
      if (!rec.stop) setTimeout(loop, 0);
    };
    setTimeout(loop, 0);
  });

  const measure = async (label, fn) => {
    const t0 = await page.evaluate(() => { window.__fwBlocks.gaps.length = 0; return performance.now(); });
    await fn();
    await page.waitForTimeout(1200);
    return page.evaluate(([l, start]) => {
      const gaps = window.__fwBlocks.gaps.filter((g) => g.t >= start).map((g) => g.ms);
      gaps.sort((a, b) => a - b);
      const at = (q) => (gaps.length
        ? +gaps[Math.min(gaps.length - 1, Math.floor(q * gaps.length))].toFixed(1) : null);
      return {
        label: l,
        n: gaps.length,
        p50: at(0.5),
        p95: at(0.95),
        max: gaps.length ? +gaps[gaps.length - 1].toFixed(1) : null,
        over100: gaps.filter((g) => g > 100).length,
        over250: gaps.filter((g) => g > 250).length,
      };
    }, [label, t0]);
  };

  const programs = () => page.evaluate(
    () => window.__fw?.scene3d?.renderer?.info?.programs?.length ?? null,
  );
  const mode = () => page.evaluate(() => window.__fw?.courseMode ?? null);
  const marks = () => page.evaluate(() => {
    const names = ['ov-enter-start', 'ov-pin', 'ov-exitwalk', 'ov-dirt-diag', 'ov-dirt-reveal', 'ov-enter-end'];
    const found = names.map((n) => {
      const all = performance.getEntriesByName(n);
      return all.length ? { name: n, t: all[all.length - 1].startTime } : null;
    }).filter(Boolean);
    const phases = [];
    for (let i = 1; i < found.length; i += 1) {
      phases.push({ phase: found[i].name, ms: +(found[i].t - found[i - 1].t).toFixed(1) });
    }
    return { phases, total: found.length >= 2 ? +(found[found.length - 1].t - found[0].t).toFixed(1) : null };
  });

  const pressTab = async () => {
    await page.keyboard.down('Tab');
    await page.waitForTimeout(16);
    await page.keyboard.up('Tab');
  };
  const cursorBurst = async () => {
    for (let i = 0; i < 40; i += 1) {
      await page.mouse.move(900 + (i % 17) * 11, 500 + (i % 13) * 9);
    }
  };

  // CONTROL FIRST, so a recorder that cannot see a block is caught before any
  // claim rests on it.
  const control = await measure('CONTROL deliberate 300 ms block', async () => {
    await page.evaluate(() => {
      const until = performance.now() + 300;
      while (performance.now() < until) { /* deliberate block */ }
    });
  });
  if (!(control.max >= 250)) {
    fail(`the recorder saw a deliberate 300 ms block as ${control.max} ms — nothing below is evidence`);
  }

  const walkCursor = await measure('cursor in WALK (baseline)', cursorBurst);

  for (const round of [1, 2]) {
    const before = await programs();
    const enter = await measure(`Tab #${round} INTO overview`, pressTab);
    const enteredAs = await mode();
    const enterMarks = await marks();
    const afterEnter = await programs();
    const overviewCursor = await measure(`cursor in OVERVIEW after Tab #${round}`, cursorBurst);
    const exit = await measure(`Tab #${round} back OUT`, pressTab);
    const exitedAs = await mode();
    const afterExit = await programs();

    if (enteredAs !== 'overview') {
      fail(`Tab #${round} did not enter the overview (mode read "${enteredAs}") — the press measured nothing`);
    }
    if (exitedAs !== 'walk') {
      fail(`Tab #${round} did not return to walk (mode read "${exitedAs}")`);
    }
    out.rounds.push({
      round,
      enter,
      enterMarks,
      overviewCursor,
      exit,
      programsBefore: before,
      programsAfterEnter: afterEnter,
      programsAfterExit: afterExit,
      mintedByEnter: before == null || afterEnter == null ? null : afterEnter - before,
      mintedByExit: afterEnter == null || afterExit == null ? null : afterExit - afterEnter,
    });
  }

  out.control = control;
  out.walkCursor = walkCursor;

  // THE ASSERTIONS. A round trip through the overview must not freeze the main
  // thread, and it must not be arriving programs on a press -- both of which
  // the unfixed build did on the owner's own save: 658.3 ms on the first way
  // back, one program minted by that same exit.
  const BLOCK_CEILING_MS = 250;
  for (const r of out.rounds) {
    for (const leg of [r.enter, r.exit]) {
      if (leg.max != null && leg.max > BLOCK_CEILING_MS) {
        fail(`${leg.label} blocked the main thread for ${leg.max} ms `
          + `(ceiling ${BLOCK_CEILING_MS} ms) — that is a freeze a player feels`);
      }
    }
    if (r.round === 1 && r.mintedByExit) {
      fail(`leaving the overview the first time minted ${r.mintedByExit} program(s) — `
        + 'the way back is drawing a light census the played day never contains');
    }
    if (r.round === 2 && (r.mintedByEnter || r.mintedByExit)) {
      fail(`the SECOND round trip still minted programs (${r.mintedByEnter} in, ${r.mintedByExit} out) — `
        + 'the toggle is not settling into a steady state at all');
    }
  }

  const row = (r) => `${String(r.label).padEnd(34)} n=${String(r.n).padStart(5)}  p50 ${String(r.p50).padStart(6)}`
    + `  p95 ${String(r.p95).padStart(7)}  max ${String(r.max).padStart(8)}`
    + `  >100ms ${String(r.over100).padStart(3)}  >250ms ${String(r.over250).padStart(3)}`;
  console.log('');
  console.log(row(control));
  console.log(row(walkCursor));
  for (const r of out.rounds) {
    console.log(row(r.enter));
    console.log(`   marks: total ${r.enterMarks.total} ms  ${r.enterMarks.phases.map((p) => `${p.phase} ${p.ms}`).join('  ')}`);
    console.log(`   programs: ${r.programsBefore} -> ${r.programsAfterEnter} (enter minted ${r.mintedByEnter})`
      + ` -> ${r.programsAfterExit} (exit minted ${r.mintedByExit})`);
    console.log(row(r.overviewCursor));
    console.log(row(r.exit));
  }
  fs.writeFileSync(`${OUT}/tab-overview-cost.json`, JSON.stringify(out, null, 2));
  console.log(`failures: ${out.failures.length}`);
  return out;
}
