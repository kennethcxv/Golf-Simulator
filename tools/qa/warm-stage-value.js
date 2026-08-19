// WHAT DOES EACH WARM STAGE ACTUALLY BUY?
//
// A stamped boot spends 63.5 s in warm stages and 18.4 s in prewarm to reach the
// veil lift at 67.3 s. The owner wants that under 15 s and will not accept the
// cost being moved silently into his hands mid-play. So the question for every
// stage is not "how long does it take" -- the ledger already says that -- but
// "what does the FIRST PLAY cost when it does not run".
//
// This boots with a named set of warm stages skipped (QA_NOWARM, e.g.
// "belt,editor,laptop-view,overview,belt-outdoor" or "all") and then TOUCHES
// every surface those stages exist to protect, measuring the worst main-thread
// block each first touch causes:
//
//   every belt tool     equipped for the first time, one at a time
//   the laptop          opened
//   the editor          entered and exited
//   the overview        Tab
//
// The block recorder runs on the TIMER queue, not on rAF. A press that blocks
// the thread for most of its window produces too few rAF callbacks to have any
// GAPS, and the previous generation of this measurement reported `null` for
// exactly the presses that stalled. The timer queue always lands a sample once
// the block ends, so its longest gap is the stall whether or not a frame drew.
//
// THE CONTROL is a deliberate 400 ms block, taken on the same recorder in the
// same session. If a known block does not show up, no zero below means anything.
//
//   QA_NOWARM=all node tools/qa/run-electron.cjs tools/qa/warm-stage-value.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const OUT = 'qa/warm-value';
  fs.mkdirSync(OUT, { recursive: true });
  const out = { failures: [], touches: [] };
  const fail = (w) => { out.failures.push(w); console.log('FAIL:', w); };

  const NOWARM = process.env.QA_NOWARM || '';
  // SET IT ON THE LIVE PAGE, NOT THROUGH addInitScript. The runner hands this
  // driver a page that has ALREADY loaded, so an init script never runs and the
  // first attempt at this A/B silently measured two control boots -- which read
  // 45.2 s and 25.2 s, and would have been reported as a 20 s saving from a
  // switch that was not connected. The scene reads the flag when the scene
  // starts, which is on the menu click below, so a plain evaluate before that
  // click is both sufficient and verifiable.
  await page.evaluate((v) => { window.__fwNoWarm = v; }, NOWARM);
  const flagSeen = await page.evaluate(() => window.__fwNoWarm ?? null);
  console.log(`warm stages skipped: ${NOWARM || '(none — this is the control boot)'}   (page sees "${flagSeen}")`);
  if (NOWARM && flagSeen !== NOWARM) fail(`the skip flag did not reach the page — it reads "${flagSeen}"`);

  const boot = await import(`file:///${process.cwd().split(String.fromCharCode(92)).join('/')}/tools/qa/lib/qa-boot.mjs`);
  const t0 = Date.now();
  await boot.clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  out.veilGoneMs = Date.now() - t0;
  console.log(`veil lifted at ${out.veilGoneMs} ms`);
  await page.waitForTimeout(2000);

  out.stamped = await page.evaluate(() => {
    try { return !!localStorage.getItem('golfEmpire.shaderCompileStamp.v2'); } catch { return null; }
  });
  out.stages = await page.evaluate(() => (window.__fwBoot ? window.__fwBoot.stages.map(
    (s) => ({ label: s.label, ms: s.ms, minted: s.minted, skipped: !!s.skipped }),
  ) : null));
  console.log(`stamped=${out.stamped}`);
  const wanted = new Set(NOWARM.split(',').map((x) => x.trim()).filter(Boolean));
  const reportedSkipped = (out.stages || []).filter((s) => s.skipped).map((s) => s.label);
  if (NOWARM === 'all' && !reportedSkipped.length) {
    fail('QA_NOWARM=all but the ledger reports no skipped stage — the switch did nothing and this is a control boot wearing a label');
  }
  for (const w of wanted) {
    if (w !== 'all' && !reportedSkipped.includes(w)) fail(`stage "${w}" was asked to skip and did not`);
  }
  for (const s of out.stages || []) {
    console.log(`  ${String(s.label).padEnd(14)} ${String(s.ms).padStart(9)} ms  minted ${String(s.minted).padStart(4)}`
      + `${s.skipped ? '   SKIPPED' : ''}`);
  }

  // The block recorder, on the timer queue.
  const startBlocks = () => page.evaluate(() => {
    const b = { on: true, last: 0, worst: 0 };
    window.__fwBlocks = b;
    const tick = () => {
      const t = performance.now();
      if (b.last) b.worst = Math.max(b.worst, t - b.last);
      b.last = t;
      if (b.on) setTimeout(tick, 0);
    };
    setTimeout(tick, 0);
  });
  const stopBlocks = () => page.evaluate(() => {
    const b = window.__fwBlocks;
    if (!b) return null;
    b.on = false;
    return +b.worst.toFixed(1);
  });

  const touch = async (label, fn, settleMs = 1600) => {
    await startBlocks();
    const p0 = await page.evaluate(() => window.__fw.scene3d.renderer?.info?.programs?.length ?? -1);
    await fn();
    await page.waitForTimeout(settleMs);
    const worst = await stopBlocks();
    const p1 = await page.evaluate(() => window.__fw.scene3d.renderer?.info?.programs?.length ?? -1);
    const row = { label, worstBlockMs: worst, minted: p1 - p0 };
    out.touches.push(row);
    console.log(`  ${label.padEnd(26)} worst block ${String(worst).padStart(9)} ms   minted ${p1 - p0}`);
    return row;
  };

  // ---- THE CONTROL: a block this recorder must be able to see.
  console.log('\n== CONTROL ==');
  const ctl = await touch('deliberate 400 ms block', () => page.evaluate(() => {
    const end = performance.now() + 400;
    while (performance.now() < end) { /* spin the main thread on purpose */ }
  }), 400);
  if (!(ctl.worstBlockMs >= 350)) {
    fail(`a deliberate 400 ms block was recorded as ${ctl.worstBlockMs} ms — this recorder cannot see a stall, so every zero below is meaningless`);
  }

  // ---- FIRST TOUCHES
  console.log('\n== FIRST TOUCH OF EVERY SURFACE ==');
  await page.evaluate(() => {
    const inv = window.__fw.state.shop.inventory;
    inv.vac1 = inv.vac1 || { shelf: 0, back: 0 };
    inv.vac1.back = Math.max(1, inv.vac1.back);
  });
  const belt = ['vacuum', 'mop', 'broom', 'dustpan', 'spray', 'cloth', 'sponge', 'trashbag', 'washer'];
  for (const tool of belt) {
    // eslint-disable-next-line no-await-in-loop
    await touch(`equip ${tool}`, () => page.evaluate((t) => {
      const w = window.__fw.scene3d.walk;
      (w.setToolImmediate || w.setTool)(t);
    }, tool), 1200);
  }
  await page.evaluate(() => {
    const w = window.__fw.scene3d.walk;
    (w.setToolImmediate || w.setTool)(null);
  });
  await page.waitForTimeout(800);

  // EVERY SURFACE MUST BE PROVED OPEN.
  //
  // A key press that lands on nothing costs nothing, and "the editor first
  // touch blocked 34 ms" would then be a measurement of a key that did not open
  // the editor. This is the failure shape the harness-debt file calls the
  // instrument reading a different object than the shipped code -- so each
  // surface is asked, through the live app, whether it is actually open, and a
  // touch that did not open its surface is a FAILURE rather than a fast row.
  const opened = async (label, what) => {
    // editorUi().isActive() is the check the working editor driver uses. The
    // first version of this asked scene3d.courseEditor() and scene3d.editor(),
    // neither of which exists -- so it reported the editor closed on a boot
    // where it may well have opened. Reading a different object than the shipped
    // code reads is the fault class that heads HARNESS_DEBT, and it was live in
    // this very function.
    const st = await page.evaluate(() => ({
      laptop: !!window.__fw.laptopOpen,
      mode: window.__fw.courseMode,
      editor: (() => {
        try { return !!window.__fw.editorUi().isActive(); } catch { return null; }
      })(),
    }));
    out.opened = out.opened || {};
    out.opened[label] = st;
    const ok = what(st);
    console.log(`      ${ok ? 'open' : 'NOT OPEN'}: ${JSON.stringify(st)}`);
    if (!ok) fail(`"${label}" did not actually open its surface — that row measures a key press that did nothing`);
  };

  // THE LAPTOP HAS NO KEY. It is opened by walking to the desk and pressing the
  // interact key, or through this hook -- and the first version of this driver
  // pressed 'l', which is bound to CART LIGHTS. That row measured the cart
  // lights and reported the laptop as costing nothing.
  await touch('open the laptop', () => page.evaluate(() => {
    window.__fw.scene3d.walk.hooks?.openLaptop?.();
  }), 2500);
  await opened('open the laptop', (s) => s.laptop === true);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1200);

  await touch('Tab — the overview', async () => { await page.keyboard.press('Tab'); }, 2500);
  await opened('Tab — the overview', (s) => s.mode !== 'walk');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(1200);

  await touch('enter the editor', async () => { await page.keyboard.press('j'); }, 3500);
  await opened('enter the editor', (s) => s.editor === true || s.mode !== 'walk');
  await touch('exit the editor', async () => { await page.keyboard.press('Escape'); }, 2500);

  const worstTouch = out.touches
    .filter((r) => r.label !== 'deliberate 400 ms block')
    .reduce((a, r) => (r.worstBlockMs > a.worstBlockMs ? r : a), { worstBlockMs: -1, label: 'none' });
  out.worstTouch = worstTouch;
  console.log(`\nveil lifted at ${out.veilGoneMs} ms`);
  console.log(`worst first-touch block: ${worstTouch.worstBlockMs} ms at "${worstTouch.label}"`);

  fs.writeFileSync(`${OUT}/value-${(NOWARM || 'control').replace(/[^a-z0-9-]+/gi, '_')}.json`,
    JSON.stringify(out, null, 2));
  console.log(`\nfailures: ${out.failures.length}`);
}
