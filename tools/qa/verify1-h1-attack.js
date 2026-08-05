// VERIFIER 1 — H1 adversarial attack. Not the shipped keyboard-sweep: this one
// presses i rapidly, presses i in OTHER modes (overview, laptop, build, front
// desk, pause, register), presses i pointer-unlocked, and sweeps the FULL
// a-z 0-9 keyboard while REGISTER MODE is live (the shipped sweep only covered
// walk mode). Any 'The game hit a problem' veil or pageerror = disproof.
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
      maintenanceChildren: cm ? cm.children.length : 0,
      walkActive: !!app.scene3d?.walk?.isActive?.(),
      laptopOpen: !!app.laptopOpen,
      regActive: !!(app.scene3d?.clubhouse?.()?.register?.isActive?.()),
      buildActive: !!(app.scene3d?.clubhouse?.()?.build?.isActive?.()),
      frontDeskOpen: !!app.frontDeskOpen,
      pauseOpen: !!document.querySelector('.pause-veil-ui'),
      pointerLocked: !!document.pointerLockElement,
    };
  });
  const shots = [];
  const snap = async (name) => { await page.screenshot({ path: path.join(OUT, name) }); shots.push(name); };
  const placePlayer = () => page.evaluate(() => {
    const app = window.__fw;
    const o = app.scene3d.clubhouse().interior.position;
    const w = app.scene3d.walk;
    w.clearKeys?.();
    w.state.x = o.x - 4.2; w.state.z = o.z + 5.0; w.state.yaw = -Math.PI / 2; w.state.pitch = 0;
  });
  await placePlayer();

  const results = {};

  // A — i while pointer-UNLOCKED
  phase = 'A-unlocked-open';
  await page.evaluate(() => { if (document.pointerLockElement) document.exitPointerLock(); });
  await page.waitForTimeout(350);
  await page.keyboard.press('i');
  await page.waitForTimeout(450);
  results.unlockedOpen = await probe();
  await snap('h1-a-unlocked-open.png');
  phase = 'A-unlocked-close';
  await page.keyboard.press('i');
  await page.waitForTimeout(300);
  results.unlockedClose = await probe();

  // B — pointer-locked single open/close, DOM asserted
  phase = 'B-locked';
  await page.mouse.click(640, 360);
  await page.waitForTimeout(500);
  await page.keyboard.press('i');
  await page.waitForTimeout(450);
  results.lockedOpen = await probe();
  await snap('h1-b-open.png');
  await page.keyboard.press('i');
  await page.waitForTimeout(300);
  results.lockedClose = await probe();
  await snap('h1-b-closed.png');

  // C — RAPID: 14 presses at ~60ms
  phase = 'C-rapid';
  for (let k = 0; k < 14; k++) { await page.keyboard.press('i'); await page.waitForTimeout(60); }
  await page.waitForTimeout(500);
  results.rapid = await probe();
  await snap('h1-c-rapid.png');
  if (results.rapid.maintenanceVisible) { await page.keyboard.press('i'); await page.waitForTimeout(250); }

  // D — overview (Tab) then i and friends
  phase = 'D-overview';
  await page.keyboard.press('Tab');
  await page.waitForTimeout(800);
  results.overviewEntered = await probe();
  await page.keyboard.press('i');
  await page.waitForTimeout(350);
  results.overviewI = await probe();
  await snap('h1-d-overview-i.png');
  for (const k of ['e', 'q', '5', 'o', 'x']) { phase = `D-overview-${k}`; await page.keyboard.press(k); await page.waitForTimeout(120); }
  results.overviewExtra = await probe();
  phase = 'D-overview-back';
  await page.keyboard.press('Tab');
  await page.waitForTimeout(800);
  results.backFromOverview = await probe();
  // if maintenance got opened while in overview, clear it
  if ((await probe()).maintenanceVisible) { await page.keyboard.press('i'); await page.waitForTimeout(250); }

  // E — laptop open, then i (and neighbours)
  phase = 'E-laptop';
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
  }, null, { timeout: 20000 }).then(() => true).catch(() => false);
  if (results.laptopPromptReady) {
    await page.keyboard.press('e');
    results.laptopOpened = await page.waitForFunction(() => window.__fw.laptopOpen, null, { timeout: 15000 })
      .then(() => true).catch(() => false);
    if (results.laptopOpened) {
      for (const k of ['i', 'i', 's', 'm', '0', '9', 'x']) { phase = `E-laptop-${k}`; await page.keyboard.press(k); await page.waitForTimeout(110); }
      results.laptopKeys = await probe();
      await snap('h1-e-laptop-i.png');
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => window.__fw.laptopOpen === false, null, { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(700);
    }
  }

  // F — build mode, i toggles build inventory (must not crash)
  phase = 'F-build';
  await placePlayer();
  await page.mouse.click(640, 360);
  await page.waitForTimeout(400);
  await page.keyboard.press('b');
  await page.waitForTimeout(700);
  results.buildEntered = await probe();
  await page.keyboard.press('i');
  await page.waitForTimeout(400);
  results.buildI = await probe();
  await snap('h1-f-build-i.png');
  await page.keyboard.press('i');
  await page.waitForTimeout(250);
  await page.keyboard.press('b');
  await page.waitForTimeout(500);
  results.buildExit = await probe();
  if (results.buildExit.buildActive) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); }

  // G — front desk open, i must be inert
  phase = 'G-frontdesk';
  const fdRequested = await page.evaluate(() => {
    const h = window.__fw.scene3d?.walk?.hooks;
    if (h && typeof h.openFrontDesk === 'function') { h.openFrontDesk(null); return true; }
    return false;
  });
  await page.waitForTimeout(700);
  results.frontDeskOpened = fdRequested && (await probe()).frontDeskOpen;
  if (results.frontDeskOpened) {
    for (const k of ['i', 'e', 'b', '7']) { phase = `G-frontdesk-${k}`; await page.keyboard.press(k); await page.waitForTimeout(110); }
    results.frontDeskKeys = await probe();
    await snap('h1-g-frontdesk-i.png');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  }

  // H — pause shell, i must be inert
  phase = 'H-pause';
  await page.keyboard.press('p');
  await page.waitForTimeout(450);
  await page.keyboard.press('i');
  await page.waitForTimeout(250);
  results.pauseI = await probe();
  await snap('h1-h-pause-i.png');
  await page.keyboard.press('p');
  await page.waitForTimeout(450);
  results.afterPause = await probe();

  // I — REGISTER MODE: the full a-z 0-9 sweep the shipped driver never ran there
  phase = 'I-register-stage';
  await page.evaluate(async () => {
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
  results.registerEntered = await page.waitForFunction(
    () => window.__fw.scene3d.clubhouse().register?.isActive?.(),
    null, { timeout: 60000 },
  ).then(() => true).catch(() => false);
  const regSweep = [];
  if (results.registerEntered) {
    await snap('h1-i-register-entered.png');
    for (const key of 'abcdefghijklmnopqrstuvwxyz0123456789'.split('')) {
      phase = `I-reg-${key}`;
      const before = faults.length;
      await page.keyboard.press(key);
      await page.waitForTimeout(90);
      if (key === 'p') { await page.keyboard.press('p'); await page.waitForTimeout(140); } // P pauses everywhere; unpause
      const m = await page.evaluate(() => ({
        veil: [...document.querySelectorAll('div')]
          .some((n) => n.textContent && n.textContent.includes('The game hit a problem') && n.offsetParent !== null),
        reg: !!window.__fw.scene3d.clubhouse().register?.isActive?.(),
      }));
      regSweep.push({ key, newFaults: faults.length - before, veil: m.veil, regStillActive: m.reg });
      if (m.veil) { await snap(`h1-i-veil-${key}.png`); break; }
      if (!m.reg) {
        // a key legitimately left register mode (Escape path etc.) — walk back in
        await page.evaluate(async () => {
          const app = window.__fw;
          const { REGISTER } = await import(new URL('src/data/shopLayout.js', document.baseURI).href);
          const off = app.scene3d.clubhouse().interior.position;
          const walk = app.scene3d.walk.state;
          walk.x = REGISTER.stand.x + off.x; walk.z = REGISTER.stand.z + off.z;
        });
        await page.waitForTimeout(400);
      }
    }
    results.regSweep = regSweep;
    await snap('h1-i-register-after-sweep.png');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
  }

  phase = 'final';
  results.final = await probe();
  await snap('h1-final.png');

  const veilSeen = []
    .concat(Object.entries(results).filter(([, v]) => v && v.veil === true).map(([k]) => k))
    .concat(regSweep.filter((r) => r.veil).map((r) => `reg:${r.key}`));
  const out = {
    results,
    faults,
    veilSeen,
    shots,
    checks: {
      iOpensTablet: !!(results.lockedOpen && results.lockedOpen.maintenanceVisible && results.lockedOpen.maintenanceChildren > 3),
      iClosesTablet: !!(results.lockedClose && !results.lockedClose.maintenanceVisible),
      unlockedIOpens: !!(results.unlockedOpen && results.unlockedOpen.maintenanceVisible),
      rapidNoVeil: !!(results.rapid && !results.rapid.veil),
      registerSwept: regSweep.length === 36,
      noVeilAnywhere: veilSeen.length === 0,
      noFaults: faults.length === 0,
    },
  };
  out.ok = Object.values(out.checks).every(Boolean);
  fs.writeFileSync(path.join(OUT, 'h1-attack.json'), `${JSON.stringify(out, null, 1)}\n`);
  return out;
}
