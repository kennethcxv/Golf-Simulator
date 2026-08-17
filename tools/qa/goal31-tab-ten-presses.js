// TAB — TEN CLEAN TOGGLES OR THE ROUTER IS BROKEN.
//
// The owner: "presses get half-eaten, a press nets zero mode change, and W
// after a swallowed toggle leaves me standing in overview". This is the
// acceptance AND the mechanism instrument in one boot:
//   1. TEN single Tab presses, each expected to flip courseMode, with a real
//      held-W movement proof after every return to walk.
//   2. THE HELD-TAB SHAPE: key held past the OS auto-repeat delay (Playwright
//      marks a second down() as repeat=true in Chromium), which the unfixed
//      toggle treats as a second press and toggles straight back.
//   3. PLANTED CONTROL: a synthetic repeat=true Tab keydown dispatched at the
//      window. The sampler must SEE it (proves the key log is alive) and the
//      mode must NOT change (proves the repeat guard, once landed, is the
//      mechanism doing the guarding).
// A capture-phase key log plus the 'ov-enter-start' performance-mark count
// names WHERE an eaten press died: key never arrived / arrived but no toggle
// attempt / two toggle attempts cancelling.
//
//   node tools/qa/run-electron.cjs tools/qa/goal31-tab-ten-presses.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/goal31');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { tag: process.env.QA_TAG || 'tab10', errs: [], failures: [], rounds: [] };
  const fail = (why) => out.failures.push(why);
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  const boot = await import(`file:///${bootPath}`);
  await boot.clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(6000);
  const vp = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  await page.mouse.click(vp.w / 2, vp.h / 2);
  await page.waitForTimeout(500);

  await page.evaluate(() => {
    const T = { keys: [] };
    window.__tab10 = T;
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') T.keys.push({ t: +performance.now().toFixed(0), type: 'down', repeat: e.repeat, trusted: e.isTrusted });
    }, true);
    window.addEventListener('keyup', (e) => {
      if (e.key === 'Tab') T.keys.push({ t: +performance.now().toFixed(0), type: 'up' });
    }, true);
  });
  const modeOf = () => page.evaluate(() => window.__fw.courseMode);
  const enterMarks = () => page.evaluate(() => performance.getEntriesByName('ov-enter-start').length);
  const keyCount = () => page.evaluate(() => window.__tab10.keys.length);

  // ---- 1. ten single presses -----------------------------------------------------
  for (let i = 0; i < 10; i += 1) {
    const before = await modeOf();
    const marksBefore = await enterMarks();
    const keysBefore = await keyCount();
    await page.keyboard.press('Tab');
    await page.waitForTimeout(1500);
    const after = await modeOf();
    const round = {
      i,
      before,
      after,
      toggled: after !== before,
      keydownsSeen: (await keyCount()) - keysBefore,
      enterAttempts: (await enterMarks()) - marksBefore,
    };
    if (after === 'walk') {
      const p0 = await page.evaluate(() => ({ x: window.__fw.scene3d.walk.state.x, z: window.__fw.scene3d.walk.state.z }));
      await page.keyboard.down('w');
      await page.waitForTimeout(1200);
      await page.keyboard.up('w');
      const p1 = await page.evaluate(() => ({ x: window.__fw.scene3d.walk.state.x, z: window.__fw.scene3d.walk.state.z }));
      round.wMovedYd = +Math.hypot(p1.x - p0.x, p1.z - p0.z).toFixed(2);
    }
    out.rounds.push(round);
    await page.waitForTimeout(300);
  }
  const eaten = out.rounds.filter((r) => !r.toggled);
  out.eatenPresses = eaten.length;
  if (eaten.length) fail(`${eaten.length}/10 single presses did not flip the mode: rounds ${eaten.map((r) => r.i).join(',')}`);
  const deadW = out.rounds.filter((r) => r.after === 'walk' && !(r.wMovedYd > 0.1));
  if (deadW.length) fail(`W did not move the player after return-to-walk on rounds ${deadW.map((r) => r.i).join(',')}`);

  // park in walk for the held shape
  if ((await modeOf()) !== 'walk') { await page.keyboard.press('Tab'); await page.waitForTimeout(1500); }

  // ---- 2. the held-Tab shape ------------------------------------------------------
  const heldBefore = await modeOf();
  const heldMarks = await enterMarks();
  await page.keyboard.down('Tab');
  await page.waitForTimeout(120);
  await page.keyboard.down('Tab'); // Chromium marks this one repeat=true
  await page.waitForTimeout(120);
  await page.keyboard.down('Tab');
  await page.waitForTimeout(120);
  await page.keyboard.up('Tab');
  await page.waitForTimeout(1500);
  out.heldTab = {
    before: heldBefore,
    after: await modeOf(),
    enterAttempts: (await enterMarks()) - heldMarks,
    repeatDownsSeen: await page.evaluate(() => window.__tab10.keys.filter((k) => k.type === 'down' && k.repeat).length),
  };
  if (out.heldTab.repeatDownsSeen === 0) {
    out.heldTab.note = 'no repeat-flagged downs arrived; the held shape did not exercise the guard';
  } else if (out.heldTab.after === out.heldTab.before) {
    fail(`held Tab netted ZERO mode change (${out.heldTab.before} -> ${out.heldTab.after}) — auto-repeat toggled it back`);
  }

  // ---- 3. planted control: synthetic repeat must be seen and must not toggle ------
  out.plant = await page.evaluate(async () => {
    const before = { mode: window.__fw.courseMode, keys: window.__tab10.keys.length };
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', repeat: true, bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 600));
    return {
      samplerSawIt: window.__tab10.keys.length > before.keys,
      modeChanged: window.__fw.courseMode !== before.mode,
    };
  });
  if (!out.plant.samplerSawIt) fail('planted repeat keydown was NOT seen by the key sampler - the instrument is void');
  if (out.plant.modeChanged) fail('planted repeat keydown TOGGLED the mode - the repeat guard is not doing the guarding');

  out.keyLog = await page.evaluate(() => window.__tab10.keys);
  out.verdict = out.failures.length ? 'FAIL' : 'PASS';
  console.log(JSON.stringify({ tag: out.tag, verdict: out.verdict, failures: out.failures, eatenPresses: out.eatenPresses, heldTab: out.heldTab, plant: out.plant, rounds: out.rounds.map((r) => `${r.i}:${r.before}->${r.after}${r.wMovedYd !== undefined ? ` W=${r.wMovedYd}yd` : ''} attempts=${r.enterAttempts}`) }, null, 2));
  fs.writeFileSync(path.join(OUT, `${out.tag}.json`), `${JSON.stringify(out, null, 2)}\n`);
  if (out.failures.length) process.exitCode = 1;
  return out;
}
