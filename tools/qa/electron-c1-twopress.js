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
  const s2 = await step('press2-should-be-open', keys.interact || 'e');
  const s3 = await step('press3-should-shut', keys.interact || 'e', 1800);

  out.verdict = {
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
