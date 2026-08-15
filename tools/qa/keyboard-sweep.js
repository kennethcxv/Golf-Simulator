// H1 — DOES ANY SINGLE KEYPRESS CRASH THE GAME?
//
// Reported: pressing `i` in walk mode killed the run with the fault veil
// (ReferenceError: setMaintenanceVisible is not defined, main.js:2296). This
// driver is both the reproduction and the regression net:
//
//   1. `i` must OPEN the maintenance tablet (visible .cm-panel with content)
//      and a second `i` must close it. A fix that merely swallows the key
//      would pass a zero-pageerror sweep — the review called that out — so
//      the DOM is asserted, not just the absence of faults.
//   2. Every plausible game key is pressed once, with a return-to-walk
//      recovery between presses so keys land in walk mode rather than in
//      whatever mode the previous key opened. Zero page errors across the
//      whole churn.
//
// Negative control (banked 2026-08-05, pre-fix run): this driver FAILED with
// the i crash and the veil screenshot before the fix landed. An instrument
// that passes on the unfixed build is broken.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/keyboard-sweep');
  fs.mkdirSync(OUT, { recursive: true });

  const faults = [];
  let current = '(boot)';
  page.on('pageerror', (error) => {
    faults.push({ key: current, message: String(error && error.message || error) });
  });

  await page.setViewportSize({ width: 1280, height: 720 });
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForTimeout(3000);

  const placePlayer = () => page.evaluate(() => {
    const app = window.__fw;
    const o = app.scene3d.clubhouse().interior.position;
    const w = app.scene3d.walk;
    w.clearKeys();
    w.state.x = o.x - 4.2; w.state.z = o.z + 5.0; w.state.yaw = -Math.PI / 2; w.state.pitch = 0;
  });
  await placePlayer();
  await page.mouse.click(640, 360);
  await page.waitForTimeout(600);

  const modeProbe = () => page.evaluate(() => {
    const app = window.__fw;
    const veil = [...document.querySelectorAll('div')]
      .some((n) => n.textContent && n.textContent.includes('The game hit a problem') && n.offsetParent !== null);
    const pauseOpen = !!document.querySelector('.pause-veil-ui');
    const cm = document.querySelector('.cm-panel');
    // .cm-panel is position:fixed, and offsetParent is null BY SPEC for fixed
    // elements — the first run of this probe scored a fully rendered tablet as
    // invisible on that check. getClientRects() is the honest "does it render
    // boxes" question.
    return {
      veil,
      pauseOpen,
      walkActive: !!app.scene3d?.walk?.isActive?.(),
      maintenanceVisible: !!(cm && cm.style.display !== 'none' && cm.getClientRects().length > 0),
      maintenanceChildren: cm ? cm.children.length : 0,
    };
  });

  // Try to get back to plain walk mode after a key opened something.
  const recoverToWalk = async () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const m = await modeProbe();
      if (m.veil) return m; // nothing recovers a dead run
      if (m.maintenanceVisible) { await page.keyboard.press('i'); await page.waitForTimeout(120); continue; }
      if (m.pauseOpen) {
        await page.evaluate(() => {
          const btn = [...document.querySelectorAll('.pause-veil-ui button')]
            .find((b) => /resume/i.test(b.textContent || ''));
          if (btn) btn.click();
        });
        await page.waitForTimeout(160);
        continue;
      }
      if (m.walkActive) {
        await page.mouse.click(640, 360);
        await page.waitForTimeout(100);
        return m;
      }
      // some other mode (editor, overview, laptop) — Escape walks back one step
      await page.keyboard.press('Escape');
      await page.waitForTimeout(180);
    }
    return modeProbe();
  };

  // ---- 1. the i contract, asserted on the DOM --------------------------------
  current = 'i(open)';
  await page.keyboard.press('i');
  await page.waitForTimeout(350);
  const afterOpen = await modeProbe();
  await page.screenshot({ path: path.join(OUT, 'i-panel-open.png') });
  current = 'i(close)';
  await page.keyboard.press('i');
  await page.waitForTimeout(250);
  const afterClose = await modeProbe();
  await page.screenshot({ path: path.join(OUT, 'i-panel-closed.png') });
  await recoverToWalk();

  // ---- 2. the sweep ----------------------------------------------------------
  const keys = [
    ...'abcdefghijklmnopqrstuvwxyz'.split(''),
    '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
    'Escape', 'Tab', ' ', 'Shift', 'Control',
  ];
  const perKey = [];
  let stranded = 0;
  for (const key of keys) {
    const pre = await recoverToWalk();
    if (pre.veil) break;
    if (!pre.walkActive) stranded += 1;
    current = key;
    const before = faults.length;
    try {
      await page.keyboard.press(key === ' ' ? 'Space' : key);
    } catch (error) {
      perKey.push({ key, pressError: String(error && error.message || error) });
      continue;
    }
    await page.waitForTimeout(150);
    const m = await modeProbe();
    perKey.push({ key, newFaults: faults.length - before, veil: m.veil, walkWhenPressed: pre.walkActive });
    if (m.veil) {
      await page.screenshot({ path: path.join(OUT, `veil-after-${key === ' ' ? 'space' : key}.png`) });
      break;
    }
  }
  await recoverToWalk();

  const out = {
    iContract: {
      afterOpen, afterClose,
      openShot: 'i-panel-open.png',
      closedShot: 'i-panel-closed.png',
    },
    faults,
    perKey,
    strandedPresses: stranded,
    checks: {
      iOpensTheTablet: afterOpen.maintenanceVisible && afterOpen.maintenanceChildren > 3,
      iClosesTheTablet: !afterClose.maintenanceVisible,
      noKeyFaults: faults.length === 0,
      sweptAllKeys: perKey.length === keys.length,
      mostKeysLandedInWalk: stranded <= 6,
    },
  };
  out.ok = Object.values(out.checks).every(Boolean);
  fs.writeFileSync(path.join(OUT, 'keyboard-sweep.json'), `${JSON.stringify(out, null, 1)}\n`);
  return {
    checks: out.checks, faults, strandedPresses: stranded,
    veilKeys: perKey.filter((r) => r.veil).map((r) => r.key), swept: perKey.length, ok: out.ok,
  };
}
