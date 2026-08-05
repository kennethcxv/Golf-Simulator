// VERIFIER 1 — H1 attack, part 2. Run 1 proved: i opens/closes the tablet
// (locked AND unlocked), 14 rapid i presses survive, i is inert in pause, and
// an accidental detour proved the editor swallows keys harmlessly. But 'e' in
// overview entered the course editor and stranded phases E-I, so the register
// sweep never ran. This driver does the missed modes with recovery:
//   1. REGISTER MODE full a-z 0-9 sweep (re-staging the customer if a key
//      legitimately exits the mode)
//   2. laptop keys, 3. build-mode i, 4. front desk keys,
//   5. overview i WITHOUT 'e', Escape back to feet,
//   6. deliberate editor i presses + Exit.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/verify1');
  fs.mkdirSync(OUT, { recursive: true });

  const faults = [];
  let phase = '(boot)';
  page.on('pageerror', (e) => faults.push({ phase, message: String(e && e.message || e) }));

  await page.setViewportSize({ width: 1280, height: 720 });
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForTimeout(3500);

  const probe = () => page.evaluate(() => {
    const veil = [...document.querySelectorAll('div')]
      .some((n) => n.textContent && n.textContent.includes('The game hit a problem') && n.offsetParent !== null);
    const cm = document.querySelector('.cm-panel');
    const app = window.__fw;
    return {
      veil,
      maintenanceVisible: !!(cm && cm.style.display !== 'none' && cm.getClientRects().length > 0),
      walkActive: !!app.scene3d?.walk?.isActive?.(),
      laptopOpen: !!app.laptopOpen,
      regActive: !!(app.scene3d?.clubhouse?.()?.register?.isActive?.()),
      buildActive: !!(app.scene3d?.clubhouse?.()?.build?.isActive?.()),
      frontDeskOpen: !!app.frontDeskOpen,
      pauseOpen: !!document.querySelector('.pause-veil-ui'),
      editorOpen: !!document.querySelector('.course-editor, .ce-root, [class*="editor-shell"]'),
    };
  });
  const shots = [];
  const snap = async (name) => { await page.screenshot({ path: path.join(OUT, name) }); shots.push(name); };
  const results = {};

  const stageRegister = () => page.evaluate(async () => {
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    const { REGISTER } = await import(new URL('src/data/shopLayout.js', document.baseURI).href);
    const skus = ['tees1'];
    for (const id of skus) {
      const inv = app.state.shop.inventory[id];
      if (inv) inv.shelf = Math.max(inv.shelf || 0, 8);
    }
    clubhouse.rebuildStock?.();
    app.speedIdx = 0;
    app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440 + 14 * 60;
    app.scene3d.applyTimeWeather?.(14 * 60, app.state.weather);
    clubhouse.sendToCounter(skus, 'cash');
    const off = clubhouse.interior.position;
    const walk = app.scene3d.walk.state;
    walk.x = REGISTER.stand.x + off.x;
    walk.z = REGISTER.stand.z + off.z;
    const dx = REGISTER.monitor.x - REGISTER.stand.x;
    const dz = REGISTER.monitor.z - REGISTER.stand.z;
    const h = Math.hypot(dx, dz) || 0.001;
    walk.yaw = Math.atan2(-dx / h, -dz / h);
    walk.pitch = Math.atan2(1.18 - 1.62, h);
  });
  const waitRegActive = () => page.waitForFunction(
    () => window.__fw.scene3d.clubhouse().register?.isActive?.(),
    null, { timeout: 60000 },
  ).then(() => true).catch(() => false);

  // ---- 1. REGISTER MODE: all of a-z 0-9 -------------------------------------
  phase = 'reg-stage';
  await stageRegister();
  results.registerEntered = await waitRegActive();
  const regSweep = [];
  let restages = 0;
  if (results.registerEntered) {
    await snap('h1b-register-entered.png');
    const keys = 'abcdefghijklmnopqrstuvwxyz0123456789'.split('');
    for (let ki = 0; ki < keys.length; ki++) {
      const key = keys[ki];
      // ensure we are actually in register mode before pressing
      let m = await probe();
      if (!m.regActive) {
        if (restages >= 6) { regSweep.push({ key, skipped: 'could not re-enter register' }); break; }
        restages += 1;
        phase = `reg-restage-${restages}`;
        if (m.pauseOpen) { await page.keyboard.press('p'); await page.waitForTimeout(250); }
        if (m.maintenanceVisible) { await page.keyboard.press('i'); await page.waitForTimeout(200); }
        await stageRegister();
        const back = await waitRegActive();
        if (!back) { regSweep.push({ key, skipped: 'register never re-engaged' }); break; }
      }
      phase = `reg-${key}`;
      const before = faults.length;
      await page.keyboard.press(key);
      await page.waitForTimeout(100);
      if (key === 'p') { await page.keyboard.press('p'); await page.waitForTimeout(150); }
      m = await probe();
      regSweep.push({
        key, newFaults: faults.length - before, veil: m.veil,
        regStillActive: m.regActive, pause: m.pauseOpen,
      });
      if (m.veil) { await snap(`h1b-veil-reg-${key}.png`); break; }
    }
    results.regSweep = regSweep;
    results.regRestages = restages;
    await snap('h1b-register-after-sweep.png');
    phase = 'reg-exit';
    await page.keyboard.press('Escape');
    await page.waitForTimeout(700);
    // if Escape opened the pause menu instead (register already gone), resume
    const m = await probe();
    if (m.pauseOpen) { await page.keyboard.press('p'); await page.waitForTimeout(400); }
  }

  // ---- 2. laptop ------------------------------------------------------------
  phase = 'laptop';
  await page.evaluate(() => {
    const app = window.__fw;
    const o = app.scene3d.clubhouse().interior.position;
    const w = app.scene3d.walk;
    w.clearKeys?.();
    w.state.x = 8.45 + o.x; w.state.z = 4.5 + o.z; w.state.yaw = -Math.PI / 2; w.state.pitch = -0.05;
  });
  await page.mouse.click(640, 360);
  results.laptopPromptReady = await page.waitForFunction(() => {
    const p = document.querySelector('.shop-prompt');
    return !!(p && /laptop/i.test(p.textContent || ''));
  }, null, { timeout: 25000 }).then(() => true).catch(() => false);
  if (results.laptopPromptReady) {
    await page.keyboard.press('e');
    results.laptopOpened = await page.waitForFunction(() => window.__fw.laptopOpen, null, { timeout: 15000 })
      .then(() => true).catch(() => false);
    if (results.laptopOpened) {
      for (const k of ['i', 'i', 's', 'm', '0', '9', 'x']) { phase = `laptop-${k}`; await page.keyboard.press(k); await page.waitForTimeout(110); }
      results.laptopKeys = await probe();
      await snap('h1b-laptop-i.png');
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => window.__fw.laptopOpen === false, null, { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(800);
    }
  }

  // ---- 3. build mode --------------------------------------------------------
  phase = 'build';
  await page.evaluate(() => {
    const app = window.__fw;
    const o = app.scene3d.clubhouse().interior.position;
    const w = app.scene3d.walk;
    w.clearKeys?.();
    w.state.x = o.x - 4.2; w.state.z = o.z + 5.0; w.state.yaw = -Math.PI / 2; w.state.pitch = 0;
  });
  await page.mouse.click(640, 360);
  await page.waitForTimeout(400);
  await page.keyboard.press('b');
  await page.waitForTimeout(800);
  results.buildEntered = await probe();
  await page.keyboard.press('i');
  await page.waitForTimeout(450);
  results.buildI = await probe();
  await snap('h1b-build-i.png');
  await page.keyboard.press('i');
  await page.waitForTimeout(250);
  await page.keyboard.press('b');
  await page.waitForTimeout(500);
  const afterBuild = await probe();
  if (afterBuild.buildActive) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); }

  // ---- 4. front desk --------------------------------------------------------
  phase = 'frontdesk';
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    const h = window.__fw.scene3d?.walk?.hooks;
    if (h && typeof h.openFrontDesk === 'function') h.openFrontDesk(null);
  });
  await page.waitForTimeout(800);
  results.frontDeskOpened = (await probe()).frontDeskOpen;
  if (results.frontDeskOpened) {
    for (const k of ['i', 'e', 'b', '7']) { phase = `frontdesk-${k}`; await page.keyboard.press(k); await page.waitForTimeout(110); }
    results.frontDeskKeys = await probe();
    await snap('h1b-frontdesk-i.png');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
  }

  // ---- 5. overview i (no 'e' this time), Escape home ------------------------
  phase = 'overview';
  await page.keyboard.press('Tab');
  await page.waitForTimeout(900);
  results.overviewEntered = await probe();
  for (const k of ['i', 'q', '5', 'x', 'v']) { phase = `overview-${k}`; await page.keyboard.press(k); await page.waitForTimeout(130); }
  results.overviewKeys = await probe();
  await snap('h1b-overview-i.png');
  phase = 'overview-escape';
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1000);
  results.backOnFeet = await probe();

  // ---- 6. editor (the overview 'e' path), i inside, then Exit ---------------
  phase = 'editor';
  await page.keyboard.press('Tab');
  await page.waitForTimeout(900);
  await page.keyboard.press('e');
  await page.waitForTimeout(1200);
  results.editorEntered = await probe();
  for (const k of ['i', 'i', '4', 'z']) { phase = `editor-${k}`; await page.keyboard.press(k); await page.waitForTimeout(120); }
  results.editorKeys = await probe();
  await snap('h1b-editor-i.png');
  phase = 'editor-exit';
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')]
      .find((b) => /^\s*(x\s*)?exit\s*$/i.test((b.textContent || '').trim()) || /exit/i.test(b.getAttribute?.('aria-label') || ''));
    if (btn) btn.click();
  });
  await page.waitForTimeout(1200);
  const afterEditor = await probe();
  results.afterEditorExit = afterEditor;
  if (!afterEditor.walkActive) {
    // confirm dialog? click through any Discard/Exit confirm, then Escape home
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')]
        .find((b) => /discard|exit|leave|yes/i.test((b.textContent || '').trim()));
      if (btn) btn.click();
    });
    await page.waitForTimeout(900);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(900);
    results.afterEditorRecovery = await probe();
  }

  phase = 'final';
  results.final = await probe();
  await snap('h1b-final.png');

  const veilSeen = []
    .concat(Object.entries(results).filter(([, v]) => v && v.veil === true).map(([k]) => k))
    .concat(regSweep.filter((r) => r.veil).map((r) => `reg:${r.key}`));
  const out = {
    results, faults, veilSeen, shots,
    checks: {
      registerEntered: results.registerEntered === true,
      registerSweptAll36: regSweep.filter((r) => !r.skipped).length === 36,
      laptopTested: results.laptopOpened === true,
      buildTested: !!(results.buildEntered && results.buildEntered.buildActive),
      frontDeskTested: results.frontDeskOpened === true,
      noVeilAnywhere: veilSeen.length === 0,
      noFaults: faults.length === 0,
    },
  };
  out.ok = Object.values(out.checks).every(Boolean);
  fs.writeFileSync(path.join(OUT, 'h1-attack2.json'), `${JSON.stringify(out, null, 1)}\n`);
  return out;
}
