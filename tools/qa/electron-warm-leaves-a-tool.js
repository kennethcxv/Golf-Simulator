// PLAYTEST 5, P0 — WHY THE DUSTPAN STAYS IN YOUR HAND.
//
// The deferred GPU warm equips a dustpan, draws three frames, and puts it back.
// On a fresh boot the whole thing is over in ~40 ms, so the round-trip alone
// does not explain "I start every game with a cleaning dustpan already in my
// hand". What explains it is HOW the restore is made.
//
//   walkSetToolDebounced(tool) {
//     if (toolSwitchCooldown > 0) { pendingBeltTool = tool; ...; return; }   // queued
//     ...
//   }
//
// TOOL_SWITCH_DEBOUNCE is 120 ms and three frames is ~12 ms at 240 Hz, so the
// warm's restore is ALWAYS queued rather than applied. The only thing that
// drains that queue is updateHeldFeel, which runs from walkUpdate -- and
// main.js only calls walk.update while walkActive() is true. Press Tab for the
// overview (courseMode 'overview') and walkUpdate stops. The queued restore
// then has nowhere to run, and the dustpan is still in your hands when you come
// back.
//
// This drives the EXACT call sequence the warm performs, through the same
// public walk API, in a state one keypress from the load-in the owner is
// describing. Nothing is staged: no state is written, no flag is forced.
//
// NEGATIVE CONTROL: the same sequence is then run through setToolImmediate,
// which must leave the hands EMPTY in the identical state. A run where both
// paths agree is measuring the debounce rather than the fix, and says so.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-warm-leaves-a-tool.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/warm-leaves-a-tool');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { tag: process.env.QA_TAG || 'run' };

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(5000); // let the real deferred warm finish first

  out.toolAfterRealWarm = await page.evaluate(() => window.__fw.scene3d.walk.getTool());
  out.warmReport = await page.evaluate(() => (window.__fwWarm ? { ...window.__fwWarm } : null));
  console.log(`after the real deferred warm: tool=${JSON.stringify(out.toolAfterRealWarm)} `
    + `warm=${JSON.stringify(out.warmReport)}`);

  // Tab to the overview: this is what stops walkUpdate, and it is one keypress.
  await page.keyboard.press('Tab');
  await page.waitForTimeout(1200);
  out.modeDuring = await page.evaluate(() => window.__fw.courseMode);
  out.walkUpdateRunning = await page.evaluate(() => {
    // main.js: if (walkActive()) app.scene3d.walk.update(dtMs).
    const fw = window.__fw;
    return fw.view === 'course' && fw.courseMode === 'walk' && !!fw.scene3d?.walk?.isActive?.();
  });
  console.log(`\nafter Tab: courseMode=${out.modeDuring}, walk.update being called = ${out.walkUpdateRunning}`);

  const runWarmSequence = async (label, useImmediate) => {
    const res = await page.evaluate(async ({ immediate }) => {
      const walk = window.__fw.scene3d.walk;
      const frame = () => new Promise((r) => requestAnimationFrame(r));
      const equip = immediate && walk.setToolImmediate ? walk.setToolImmediate : walk.setTool;
      const before = walk.getTool();
      equip.call(walk, 'dustpan');
      await frame(); await frame(); await frame();
      const midway = walk.getTool();
      equip.call(walk, null);
      await frame();
      return { before, midway, hasImmediate: typeof walk.setToolImmediate === 'function' };
    }, { immediate: useImmediate });
    await page.waitForTimeout(3000); // far beyond the 120 ms debounce
    const after = await page.evaluate(() => window.__fw.scene3d.walk.getTool());
    const row = { label, ...res, afterThreeSeconds: after, leftBehind: after !== null };
    console.log(`  [${label}] equipped=${JSON.stringify(res.midway)} -> `
      + `after 3 s: ${JSON.stringify(after)}  ${after !== null ? '<<< TOOL LEFT IN THE HANDS' : 'hands empty'}`);
    // put the hands back however we can, so the next phase starts clean
    await page.evaluate(() => {
      const walk = window.__fw.scene3d.walk;
      (walk.setToolImmediate || walk.setTool).call(walk, null);
    });
    await page.waitForTimeout(300);
    return row;
  };

  console.log('\nthe warm\'s own call sequence, in the overview where walkUpdate does not run:');
  out.debounced = await runWarmSequence('walk.setTool (the debounced door the warm used)', false);
  out.immediate = await runWarmSequence('walk.setToolImmediate (the door the fix uses)', true);

  await page.screenshot({ path: path.join(OUT, `${out.tag}-overview.png`) });
  await page.keyboard.press('Tab');
  await page.waitForTimeout(1500);
  out.toolBackOnFoot = await page.evaluate(() => window.__fw.scene3d.walk.getTool());
  await page.screenshot({ path: path.join(OUT, `${out.tag}-back-on-foot.png`) });
  console.log(`\nback on foot: tool=${JSON.stringify(out.toolBackOnFoot)}`);

  out.verdict = {
    debouncedLeftATool: out.debounced.leftBehind,
    immediateLeftATool: out.immediate.leftBehind,
    immediateAvailable: out.immediate.hasImmediate,
    // The two paths must DISAGREE, or this run measured something else.
    discriminates: out.debounced.leftBehind === true && out.immediate.leftBehind === false,
  };
  console.log(`\nVERDICT ${JSON.stringify(out.verdict)}`);
  if (!out.verdict.immediateAvailable) console.log('  (setToolImmediate absent — this is the UNFIXED build)');

  fs.writeFileSync(path.join(OUT, `${out.tag}-result.json`), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
