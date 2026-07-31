async (page) => {
  // MOUSE-LOOK PARITY â€” the first pointer-locked mouse-look instrument
  // (HARNESS_TRUST.md rule 11). Every prior harness either wrote walk.state.yaw
  // directly or turned with arrow keys; the live 180-spin bug class lives in the
  // exact path nothing measured: canvas click â†’ requestPointerLock â†’
  // pointer-locked mousemove events â†’ the lock guard â†’ applyMouseLook.
  //
  //   node tools/qa/run-playwright.cjs tools/qa/mouse-look-parity.js
  //
  // Expectations are DERIVED from the shipped math (in-page import of
  // /src/render3d/mouseLook.js and the live walk.sens/invertY) â€” no pinned
  // literals (rule 6). Sweeps are paced â‰¤40 px per ~frame so browser mousemove
  // coalescing stays under MOUSE_DELTA_MAX and totals are preserved; the spike
  // beat deliberately sends one huge event to prove the clamp engages.
  //
  // If this environment cannot engage pointer lock at all, the run exits RED
  // with blocked: 'pointer-lock-unavailable' â€” an unmeasurable claim is not a
  // green (re-run HEADED=1 on a desktop session).
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = path.resolve(process.env.QA_REPO_ROOT || process.cwd());
  const outDir = path.resolve(process.env.GREYBOX_DATA_OUT
    || path.join(repo, 'Designs', 'ProShop', 'Greybox', 'data'));
  fs.mkdirSync(outDir, { recursive: true });
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const SEED = Number(process.env.GREYBOX_SEED || 20260727);

  const boot = async (variant) => {
    const query = variant === 'pine-hills-v2' ? '?clubhouse=pine-hills-v2' : '';
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto(`${baseUrl}${query}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.readyState === 'complete');
    await page.evaluate(async (seed) => {
      localStorage.clear();
      const E = await import('/src/sim/empire.js');
      const empire = E.newStarterEmpire('relaxed', seed);
      localStorage.setItem('golfempire:autosave', JSON.stringify(E.empireSnapshot(empire)));
    }, SEED);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(900);
    await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`)).clickThroughMenu(page);
    await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 120000 });
    await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 120000 });
    await page.waitForTimeout(2500);
  };

  const lockState = () => page.evaluate(() => ({
    locked: document.pointerLockElement?.tagName === 'CANVAS',
  }));
  const engageLock = async () => {
    // requestPointerLock is refused when the document is unfocused (a
    // background headed window fails exactly like headless), and Chrome
    // enforces a ~1.5 s cooldown after an unlock. Three focused attempts
    // cover both the first-boot focus glitch and the cooldown.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await page.bringToFront().catch(() => {});
      await page.waitForTimeout(400);
      await page.mouse.move(800, 450);
      await page.mouse.click(800, 450);
      const locked = await page.waitForFunction(
        () => document.pointerLockElement?.tagName === 'CANVAS', null, { timeout: 3000 },
      ).then(() => true).catch(() => false);
      if (locked) return true;
      await page.waitForTimeout(1200);
    }
    return false;
  };
  const look = () => page.evaluate(() => {
    const w = window.__fw.scene3d.walk.state;
    return { yaw: w.yaw, pitch: w.pitch, sens: w.sens || 1, invertY: !!w.invertY };
  });
  const zeroLook = () => page.evaluate(() => {
    const w = window.__fw.scene3d.walk.state;
    w.yaw = 0;
    w.pitch = 0;
  });
  // Paced relative sweep: â‰¤40 px per dispatched move, one per ~frame, so even
  // coalesced deliveries stay under the per-event clamp and totals survive.
  let cursor = { x: 800, y: 450 };
  const sweep = async (dx, dy) => {
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 40));
    for (let i = 1; i <= steps; i += 1) {
      const nx = cursor.x + dx / steps;
      const ny = cursor.y + dy / steps;
      await page.mouse.move(nx, ny);
      cursor = { x: nx, y: ny };
      await page.waitForTimeout(17);
    }
    await page.waitForTimeout(120);
  };

  const runVariant = async (variant) => {
    await boot(variant);
    const result = { variant };
    result.lockEngaged = await engageLock();
    if (!result.lockEngaged) {
      result.blocked = 'pointer-lock-unavailable';
      return result;
    }
    cursor = { x: 800, y: 450 };
    // Exhaust the 2-event reacquisition guard before measuring.
    await sweep(4, 0);
    await sweep(4, 0);

    // Expectations from the shipped math and the live settings.
    const live = await look();
    const expect = await page.evaluate(async ({ sens }) => {
      const m = await import('/src/render3d/mouseLook.js');
      const across = (px) => {
        // total across a paced sweep: per-event deltas stay under the clamp
        let state = { yaw: 0, pitch: 0 };
        const steps = Math.ceil(Math.abs(px) / 40);
        for (let i = 0; i < steps; i += 1) state = m.applyMouseLook(state.yaw, state.pitch, px / steps, 0, sens);
        return state.yaw;
      };
      const acrossY = (px) => {
        let state = { yaw: 0, pitch: 0 };
        const steps = Math.ceil(Math.abs(px) / 40);
        for (let i = 0; i < steps; i += 1) state = m.applyMouseLook(state.yaw, state.pitch, 0, px / steps, sens);
        return state.pitch;
      };
      return {
        deltaMax: m.MOUSE_DELTA_MAX,
        yawRight400: across(400),
        yawLeft400: across(-400),
        pitchDown250: acrossY(250),
        spikeSingle: m.applyMouseLook(0, 0, 700, 0, sens).yaw,
      };
    }, { sens: live.sens });
    result.settings = live;
    result.expect = expect;

    // Beat A/B: symmetric horizontal sweeps.
    await zeroLook();
    await sweep(400, 0);
    const afterRight = await look();
    await zeroLook();
    await sweep(-400, 0);
    const afterLeft = await look();
    // Beat C: vertical sweep.
    await zeroLook();
    await sweep(0, 250);
    const afterDown = await look();
    // Beat E: one deliberately huge single event â€” the clamp must engage.
    await zeroLook();
    await page.mouse.move(cursor.x + 700 > 1580 ? cursor.x - 700 : cursor.x + 700, cursor.y);
    cursor.x = cursor.x + 700 > 1580 ? cursor.x - 700 : cursor.x + 700;
    await page.waitForTimeout(150);
    const afterSpike = await look();
    // Beat D: exit, re-lock, then one big move â€” the reacquisition guard must
    // swallow it (the literal 180-spin-after-alt-tab class).
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.pointerLockElement, null, { timeout: 5000 });
    // Escape in walk mode unlocks AND opens the pause menu, so a canvas
    // re-click hits the overlay, not the game. The realistic relock path is
    // the RESUME one: a second Escape resumes and main.js re-requests the lock
    // itself when the pause had it (the exact alt-tab/menu flow the guard
    // exists for). Chrome's ~1.5 s post-unlock cooldown still applies first.
    await page.waitForTimeout(1700);
    await page.keyboard.press('Escape');
    result.relockEngaged = await page.waitForFunction(
      () => document.pointerLockElement?.tagName === 'CANVAS', null, { timeout: 4000 },
    ).then(() => true).catch(() => false);
    if (!result.relockEngaged) result.relockEngaged = await engageLock();
    cursor = { x: 800, y: 450 };
    await zeroLook();
    await page.mouse.move(1400, 450);
    cursor = { x: 1400, y: 450 };
    await page.waitForTimeout(150);
    const afterRelockSpike = await look();

    const close = (a, b, frac) => Math.abs(a - b) <= Math.abs(b) * frac + 0.02;
    result.measured = {
      yawRight: afterRight.yaw,
      yawLeft: afterLeft.yaw,
      pitchDown: afterDown.pitch,
      yawSpike: afterSpike.yaw,
      yawAfterRelockSpike: afterRelockSpike.yaw,
    };
    result.checks = {
      yawMatchesShippedMath: close(afterRight.yaw, expect.yawRight400, 0.15),
      yawSymmetric: close(afterLeft.yaw, expect.yawLeft400, 0.15),
      pitchMatchesShippedMath: close(afterDown.pitch, expect.pitchDown250, 0.15),
      pitchStableOnHorizontal: Math.abs(afterRight.pitch) < 0.03,
      spikeClamped: Math.abs(afterSpike.yaw) <= Math.abs(expect.spikeSingle) * 2 + 0.02,
      relockGuardSwallows: Math.abs(afterRelockSpike.yaw) < 1e-6,
    };
    result.ok = result.relockEngaged && Object.values(result.checks).every(Boolean);
    return result;
  };

  const out = { variants: {} };
  for (const variant of ['pine-hills', 'pine-hills-v2']) {
    out.variants[variant] = await runVariant(variant);
  }
  out.ok = Object.values(out.variants).every((entry) => entry.ok === true);
  fs.writeFileSync(path.join(outDir, 'mouse-look-parity.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
