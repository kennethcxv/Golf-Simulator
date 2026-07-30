async (page) => {
  // WHAT THE KEYDOWN LISTENER ACTUALLY RECEIVES, POINTER-LOCKED, FOR SIX CASES.
  //
  //   node tools/qa/run-playwright.cjs tools/qa/walk-six-key-cases.js
  //
  // The brief: "In the same runtime, pointer-locked, report what the keydown listener
  // actually receives for: D alone, Shift+D, W alone, Shift+W, X alone, Shift+X. Per case:
  // key, code, which modifiers the event reports, whether preventDefault was called, and
  // whether the movement handler ran. The tell I cannot explain is that Shift CHANGES the
  // outcome."
  //
  // This is the CHROMIUM half. tools/qa/electron-six-key-cases.mjs runs the same six cases
  // in the packaged shell. Both call the same in-page instrument (src/debug/inputProbe.js)
  // so the two result sets are comparable — the drivers differ only in how they press keys
  // and how they reach the world.
  //
  // Keys are pressed by CDP, not dispatched by page script: a synthetic KeyboardEvent has
  // no OS keyboard behind it and cannot be eaten by a shell accelerator, which is exactly
  // the failure mode that let two earlier D-key harnesses pass a broken D.
  //
  // POINTER LOCK IS A GATE, NOT A HOPE. courseScene only calls preventDefault while
  // document.pointerLockElement === canvas, so a run without the lock measures a different
  // code path. If the lock does not engage the result says so and fails rather than
  // quietly reporting numbers from the wrong branch.
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = path.resolve(process.env.QA_REPO_ROOT || process.cwd());
  const outDir = path.resolve(process.env.GREYBOX_DATA_OUT
    || path.join(repo, 'Designs', 'ProShop', 'Greybox', 'data'));
  fs.mkdirSync(outDir, { recursive: true });
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const SEED = Number(process.env.GREYBOX_SEED || 20260727);

  const errs = [];
  page.on('pageerror', (e) => errs.push(`PAGEERROR: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(`CONSOLE: ${m.text()}`); });

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(`${baseUrl}?clubhouse=pine-hills-v2`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(600);
  await page.evaluate(async (seed) => {
    localStorage.clear();
    const E = await import('/src/sim/empire.js');
    localStorage.setItem('golfempire:autosave', JSON.stringify(E.empireSnapshot(E.newStarterEmpire('relaxed', seed))));
  }, SEED);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  await page.getByRole('button', { name: /^Continue/ }).first().click();
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 120000 });
  await page.waitForFunction(() => window.__fw?.inputProbe, null, { timeout: 60000 });
  await page.waitForTimeout(2500);

  // Stand in open floor so a strafe is not measured against a wall — RE-STANCED BEFORE
  // EVERY CASE. The first version stanced once, so case 2 began 1.1 yd downrange of where
  // case 1 started and Shift+W recorded 0.09 yd against W's 1.12: a wall, read as a Shift
  // effect. movedYd only means anything from a known start.
  const stance = () => page.evaluate(() => {
    const app = window.__fw;
    const ch = app.scene3d.clubhouse();
    const walk = app.scene3d.walk;
    const target = walk.state && 'x' in walk.state ? walk.state : walk;
    const spot = ch.localToWorld(1.6, 1.2);
    target.x = spot.x;
    target.z = spot.z;
    target.yaw = Math.PI; // facing the entrance, so +x strafe is unobstructed floor
    target.pitch = 0;
    return { x: +target.x.toFixed(2), z: +target.z.toFixed(2) };
  });
  const stanceAt = await stance();
  await page.waitForTimeout(400);

  // Engage the lock the way a player does: click the canvas element itself. A bare
  // page.mouse.click at fixed coordinates left pointerLockElement null — the request is
  // made from the canvas's own handler, so the click has to land on the canvas.
  await page.locator('canvas').first().click({ position: { x: 800, y: 450 } });
  await page.waitForTimeout(600);
  let lock = await page.evaluate(() => ({
    locked: !!document.pointerLockElement,
    lockedOnCanvas: document.pointerLockElement === document.querySelector('canvas'),
    lockedTag: document.pointerLockElement?.tagName || null,
  }));
  if (!lock.lockedOnCanvas) {
    // Chrome throttles a re-lock shortly after an exit; one retry, then it is reported as
    // a miss rather than measured from the unlocked branch.
    await page.waitForTimeout(1400);
    await page.locator('canvas').first().click({ position: { x: 760, y: 420 } });
    await page.waitForTimeout(700);
    lock = await page.evaluate(() => ({
      locked: !!document.pointerLockElement,
      lockedOnCanvas: document.pointerLockElement === document.querySelector('canvas'),
      lockedTag: document.pointerLockElement?.tagName || null,
    }));
  }

  const arm = await page.evaluate(() => window.__fw.inputProbe.arm());

  const cases = await page.evaluate(() => window.__fw.inputProbe.cases.map((c) => ({ ...c })));
  const results = [];
  for (const c of cases) {
    await stance();
    await page.waitForTimeout(150);
    await page.evaluate(() => window.__fw.inputProbe.beginCase());
    if (c.hold) await page.keyboard.down(c.hold);
    await page.keyboard.down(c.code);
    // Long enough for several frames of the movement block to run.
    await page.waitForTimeout(320);
    // Sampled while the key is still DOWN: the held set is emptied by keyup, so reading it
    // after the release reports every correct press as "never recorded".
    const during = await page.evaluate(() => window.__fw.inputProbe.sample());
    await page.keyboard.up(c.code);
    if (c.hold) await page.keyboard.up(c.hold);
    await page.waitForTimeout(120);
    const row = await page.evaluate((label) => window.__fw.inputProbe.endCase(label), c.label);
    results.push({ ...row, during, expectedCode: c.code, holdModifier: c.hold });
  }
  await page.evaluate(() => window.__fw.inputProbe.disarm());

  // One row per case, in the shape the brief asked for.
  //
  // SELECTED BY CODE, not by "the first keydown". In a Shift+D case the first keydown is
  // ShiftLeft, and the first version of this table dutifully reported key='Shift'
  // code='ShiftLeft' for all three shifted rows — a table about the modifier, captioned as
  // a table about the letter.
  const table = results.map((r) => {
    const downs = r.events.filter((e) => e.type === 'keydown' && e.phase === 'window-capture');
    const down = downs.find((e) => e.code === r.expectedCode) || null;
    const bubbles = r.events.filter((e) => e.type === 'keydown' && e.phase === 'window-bubble');
    const bubbled = bubbles.find((e) => e.code === r.expectedCode) || null;
    const movement = r.moveIntent || {};
    const held = r.during?.heldKeys || r.heldDuringPress || null;
    return {
      case: r.case,
      key: down?.key ?? null,
      code: down?.code ?? null,
      modifiersReported: down?.modifiersReported ?? null,
      flags: down?.flags ?? null,
      isTrusted: down?.isTrusted ?? null,
      reachedPage: !!down,
      reachedWalkListener: !!bubbled,
      // Read off the listener that runs last, so every earlier handler has had its turn.
      preventDefaultCalled: !!bubbled?.defaultPrevented,
      landedInHeldSet: Array.isArray(held) && !!down
        && held.includes(String(down.key).toLowerCase()),
      heldDuringPress: held,
      // "Did the movement handler run" — a boolean, plus the counts behind it. Comparing
      // raw frame counts across cases is noise: a 320 ms window is 30-40 frames and never
      // the same number twice.
      movementRan: (movement.movingFrames ?? 0) > 0,
      movementFramesWithIntent: movement.movingFrames ?? null,
      movementFramesObserved: movement.frames ?? null,
      movementWanted: movement.last ?? null,
      interactSecondaryCalls: r.interactSecondaryCalls,
      movedYd: r.movedYd,
      pointerLocked: r.pointerLocked,
      osModifiers: r.osModifiers,
    };
  });

  const byCase = Object.fromEntries(table.map((r) => [r.case, r]));
  const pair = (plain, shifted, field) => ({
    plain: byCase[plain]?.[field] ?? null,
    shifted: byCase[shifted]?.[field] ?? null,
    same: JSON.stringify(byCase[plain]?.[field] ?? null) === JSON.stringify(byCase[shifted]?.[field] ?? null),
  });

  const findings = {
    runtime: 'chromium',
    pointerLockEngaged: lock.lockedOnCanvas,
    probeArmed: !!arm?.armed,
    secondaryWrapped: !!arm?.secondaryWrapped,
    everyCaseReachedThePage: table.every((r) => r.reachedPage),
    everyCaseReachedTheWalkListener: table.every((r) => r.reachedWalkListener),
    everyCaseWasTrusted: table.every((r) => r.isTrusted),
    // DOES SHIFT CHANGE THE OUTCOME? Compared field by field rather than asserted.
    shiftChangesD: {
      delivery: pair('D alone', 'Shift+D', 'reachedWalkListener'),
      preventDefault: pair('D alone', 'Shift+D', 'preventDefaultCalled'),
      heldSet: pair('D alone', 'Shift+D', 'landedInHeldSet'),
      movementRan: pair('D alone', 'Shift+D', 'movementRan'),
      direction: pair('D alone', 'Shift+D', 'movementWanted'),
    },
    shiftChangesW: {
      delivery: pair('W alone', 'Shift+W', 'reachedWalkListener'),
      preventDefault: pair('W alone', 'Shift+W', 'preventDefaultCalled'),
      heldSet: pair('W alone', 'Shift+W', 'landedInHeldSet'),
      movementRan: pair('W alone', 'Shift+W', 'movementRan'),
      direction: pair('W alone', 'Shift+W', 'movementWanted'),
    },
    shiftChangesX: {
      delivery: pair('X alone', 'Shift+X', 'reachedWalkListener'),
      preventDefault: pair('X alone', 'Shift+X', 'preventDefaultCalled'),
      secondary: pair('X alone', 'Shift+X', 'interactSecondaryCalls'),
    },
    // Every key the game acts on in walk mode must be swallowed while pointer-locked.
    // Before 2026-07-29 X was not, and this is the check that caught it.
    everyWalkVerbIsPreventDefaulted: table.every((r) => r.preventDefaultCalled),
    xIsPreventDefaulted: byCase['X alone']?.preventDefaultCalled === true
      && byCase['Shift+X']?.preventDefaultCalled === true,
    wasdIsPreventDefaulted: byCase['D alone']?.preventDefaultCalled === true
      && byCase['W alone']?.preventDefaultCalled === true,
    // The verdict has to fail when the thing under test fails. Suppressing D's contribution
    // to the movement intent left the top line reading ok:true with moveRan 0 for both D
    // cases — a probe whose summary calls a broken D a pass.
    everyMovementCaseMoved: ['D alone', 'Shift+D', 'W alone', 'Shift+W']
      .every((label) => byCase[label]?.movementRan === true),
    everySecondaryCaseFired: ['X alone', 'Shift+X']
      .every((label) => (byCase[label]?.interactSecondaryCalls || 0) > 0),
  };

  // WHAT THIS PROBE CANNOT SHOW, stated rather than left for the reader to assume.
  // Playwright presses keys through CDP, which injects them below the browser's own
  // shortcut layer: Ctrl+W here does not close a tab. So a green run proves the page-side
  // chain is correct end to end; it CANNOT reproduce "Chrome ate the key", and the absence
  // of that symptom in this file is not evidence that it does not happen under a real hand.
  // The Electron run is the comparison that matters, because the shell has no tab
  // shortcuts to steal them in the first place.
  const limitations = {
    cdpBypassesBrowserShortcuts: true,
    provesPageSideChain: true,
    canExhibitBrowserLevelSteal: false,
    canExhibitOsLevelSteal: false,
  };

  const result = {
    what: 'six key cases, pointer-locked, measured through the shared input probe',
    stance: stanceAt,
    lock,
    findings,
    limitations,
    table,
    // Full event rows kept: the summary above is a reading of these, and a reading with
    // its source discarded cannot be re-examined.
    detail: results,
    errs: errs.slice(0, 12),
    // Pointer lock is part of the claim, not a nicety: the preventDefault branch is gated
    // on it, so an unlocked run measures a different code path and must not pass.
    ok: findings.pointerLockEngaged
      && findings.probeArmed
      && findings.secondaryWrapped
      && findings.everyCaseReachedThePage
      && findings.everyCaseReachedTheWalkListener
      && findings.everyCaseWasTrusted
      && findings.everyWalkVerbIsPreventDefaulted
      && findings.everyMovementCaseMoved
      && findings.everySecondaryCaseFired
      && errs.length === 0,
  };
  fs.writeFileSync(path.join(outDir, 'six-key-cases-chromium.json'), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}
