// PLAYTEST 3, ITEM 2 — "SEQUENCE IT. The drawer opens. Its sound FINISHES. Then
// the cash starts going in. Right now they overlap and it sounds like noise."
//
// That is a claim about TIME ON THE AUDIO GRAPH, so it is measured there: every
// BufferSource start is stamped with the context clock and its cue name, and the
// question becomes arithmetic. Did the latch finish before the slide began, and
// did the slide finish before any money was handled?
//
// The old code fired `drawerUnlock`, `drawerOpen` and `billHandle` on three
// consecutive lines. Three impacts inside one millisecond is not a drawer
// opening; it is a bang. This records the gaps so the difference is a number
// rather than an adjective.
//
// WHAT WOULD MAKE THIS LIE, and is guarded:
//   - `ctx.currentTime` is the only clock that shares a timebase with the
//     scheduled sources. performance.now() would drift against it.
//   - a cue that falls back to its SYNTH voice starts no BufferSource for some
//     paths, so the absence of a start is not proof of silence. Every start is
//     recorded with `sampled` so a synth fallback is visible rather than
//     mistaken for a gap.
//   - the sequence uses setTimeout, so the window must outlast the whole
//     sequence or the second cue lands after the measurement closed.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-drawer-sequence.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/drawer-sequence');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  await page.waitForFunction(() => !!document.querySelector('.menu-screen button'), null, { timeout: 180000 });
  await page.waitForTimeout(1200);
  const first = await page.$('.menu-screen button:not([disabled])');
  if (first) await first.click();
  await page.waitForTimeout(2500);

  out.installed = await page.evaluate(() => {
    const app = window.__fw;
    const ctx = app?.audio?.qaContext?.();
    if (!ctx) return { ok: false, why: 'no audio context' };
    window.__seq = { starts: [] };
    if (!ctx.__seqSpied) {
      const make = ctx.createBufferSource.bind(ctx);
      ctx.createBufferSource = () => {
        const node = make();
        const start = node.start.bind(node);
        node.start = (...args) => {
          const tag = node.buffer && node.buffer.__fwSample;
          window.__seq.starts.push({
            // the SAME clock the sources are scheduled on
            at: +ctx.currentTime.toFixed(4),
            seconds: node.buffer ? +node.buffer.duration.toFixed(4) : null,
            sampled: !!tag,
            cue: tag ? tag.cue : null,
            file: tag ? tag.file.split('/').pop() : null,
          });
          return start(...args);
        };
        return node;
      };
      ctx.__seqSpied = true;
    }
    return { ok: true, cueSecondsDrawerOpen: app.audio.cueSeconds?.('drawerOpen') ?? null,
      cueSecondsUnlock: app.audio.cueSeconds?.('drawerUnlock') ?? null };
  });
  console.log('INSTALLED', JSON.stringify(out.installed));
  if (!out.installed.ok) {
    fs.writeFileSync(path.join(OUT, 'drawer-sequence.json'), `${JSON.stringify(out, null, 2)}\n`);
    return out;
  }

  // Fire the production sequence -- the same call the register makes -- and hold
  // the window open well past its total so nothing lands after the tape stops.
  out.fired = await page.evaluate(async () => {
    window.__seq.starts.length = 0;
    const total = window.__fw.audio.drawerOpenSequence?.();
    await new Promise((d) => setTimeout(d, 4000));
    return { reportedTotalSeconds: total ?? null, starts: window.__seq.starts.slice() };
  });
  for (const s of out.fired.starts) console.log('  start', JSON.stringify(s));

  const byCue = (name) => out.fired.starts.filter((s) => s.cue === name);
  const unlock = byCue('drawerUnlock')[0] || null;
  const open = byCue('drawerOpen')[0] || null;

  out.verdict = {
    reportedTotalSeconds: out.fired.reportedTotalSeconds,
    unlockAt: unlock?.at ?? null,
    unlockSeconds: unlock?.seconds ?? null,
    openAt: open?.at ?? null,
    openSeconds: open?.seconds ?? null,
    // THE CLAIM: the slide begins after the latch has essentially finished. The
    // latch's tail is decay, so the bar is that the slide's ATTACK does not land
    // on top of the latch's attack -- which is what "three on three lines" did.
    gapBetweenLatchAndSlide: (unlock && open) ? +(open.at - unlock.at).toFixed(4) : null,
    slideStartsAfterLatchIsMostlyDone: (unlock && open)
      ? (open.at - unlock.at) >= unlock.seconds * 0.75 : null,
    // and the total the register uses to hold the cash back
    totalCoversBothCues: (unlock && open && out.fired.reportedTotalSeconds != null)
      ? out.fired.reportedTotalSeconds >= (open.at - unlock.at) + open.seconds - 0.02 : null,
    cuesHeard: [...new Set(out.fired.starts.map((s) => s.cue).filter(Boolean))],
    filesHeard: [...new Set(out.fired.starts.map((s) => s.file).filter(Boolean))],
    // the old build's signature: two attacks inside a few ms of each other
    simultaneousAttacks: (unlock && open) ? (open.at - unlock.at) < 0.02 : null,
  };
  console.log('DRAWER-SEQUENCE', JSON.stringify(out.verdict, null, 2));
  fs.writeFileSync(path.join(OUT, 'drawer-sequence.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
