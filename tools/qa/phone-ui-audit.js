// THE POCKET PHONE — does it open, and what is on it?
//
// The brief: "If there is a phone UI in the game, audit it the same way and
// tell me what you found. If there is not, say so in one line."
//
// There is one, and reading the source is not the audit — four probes this week
// have reported clean on things that were visibly broken. This presses the real
// key, screenshots the face, walks the app surface with the real arrow keys,
// and reports what each app actually rendered.
//
//   node tools/qa/run-electron.cjs tools/qa/phone-ui-audit.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/phone');
  fs.mkdirSync(OUT, { recursive: true });
  const tag = process.env.QA_TAG || 'run';
  const out = { tag, errs: [], failures: [], shots: [] };
  const fail = (why) => { out.failures.push(why); console.log('FAIL:', why); };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.split('\\').join('/');
  const boot = await import(`file:///${bootPath}`);
  out.bootPath = await boot.clickThroughMenu(page, { forceNew: !process.env.QA_RESUME });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.bringToFront().catch(() => {});
  await page.waitForTimeout(2500);
  await boot.ownerResolution(page, page.electronApp);
  await page.waitForTimeout(1200);

  const state = () => page.evaluate(() => {
    const p = window.__fw?.phone;
    const root = p?.root;
    const face = root ? root.querySelector('.ph-face, .phone-face, .ph-screen') : null;
    return {
      exists: !!p,
      open: p?.isOpen ? !!p.isOpen() : null,
      rootInDom: !!(root && root.isConnected),
      // what the player can actually see: visible text on the phone face
      text: root && root.isConnected
        ? (root.innerText || '').split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 14)
        : [],
      faceFound: !!face,
      styles: root ? {
        display: getComputedStyle(root).display,
        opacity: getComputedStyle(root).opacity,
        transform: getComputedStyle(root).transform,
      } : null,
    };
  });

  out.beforeKey = await state();
  if (!out.beforeKey.exists) fail('window.__fw.phone is not exposed — cannot audit');

  // THE REAL KEY, not a method call. The whole design claim is that the phone
  // rides on a binding the walk rig does not use, so pressing it is the test.
  await page.keyboard.press('t');
  await page.waitForTimeout(1200);
  out.afterKey = await state();
  await page.screenshot({ path: path.join(OUT, `${tag}-open.png`) });
  out.shots.push(`${tag}-open.png`);
  if (!out.afterKey.open) fail('pressing the phone key did not open it');
  else console.log(`phone opened on the real key; ${out.afterKey.text.length} lines of face text`);
  console.log('face:', JSON.stringify(out.afterKey.text));

  // Walk the app surface with the keys the shell says it uses.
  out.apps = [];
  for (const [i, key] of [['0', 'ArrowRight'], ['1', 'ArrowRight'], ['2', 'Enter']]) {
    await page.keyboard.press(key);
    await page.waitForTimeout(700);
    const s = await state();
    out.apps.push({ step: i, key, text: s.text.slice(0, 8) });
    console.log(`  ${key} -> ${JSON.stringify(s.text.slice(0, 5))}`);
  }
  await page.screenshot({ path: path.join(OUT, `${tag}-app.png`) });
  out.shots.push(`${tag}-app.png`);

  // THE CLAIM THAT MATTERS FOR FEEL: the world keeps running. Pointer lock is
  // never touched and WASD still walks, so a text can be read on the move.
  const moved = await page.evaluate(async () => {
    const w = window.__fw.scene3d.walk.state;
    const before = { x: w.x, z: w.z };
    return new Promise((resolve) => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', code: 'KeyW', bubbles: true }));
      setTimeout(() => {
        window.dispatchEvent(new KeyboardEvent('keyup', { key: 'w', code: 'KeyW', bubbles: true }));
        const w2 = window.__fw.scene3d.walk.state;
        resolve({ before, after: { x: w2.x, z: w2.z },
          moved: +Math.hypot(w2.x - before.x, w2.z - before.z).toFixed(3) });
      }, 1200);
    });
  });
  out.walksWhileOpen = moved;
  console.log(`walked ${moved.moved} yd with the phone open`);
  if (moved.moved < 0.2) fail(`the world froze: only ${moved.moved} yd of movement with the phone open`);

  await page.keyboard.press('t');
  await page.waitForTimeout(900);
  out.afterClose = await state();
  if (out.afterClose.open) fail('the same key did not put it away');

  fs.writeFileSync(path.join(OUT, `${tag}.json`), `${JSON.stringify(out, null, 2)}\n`);
  console.log(`\nfailures ${out.failures.length} · evidence qa/phone/${tag}.json`);
}
