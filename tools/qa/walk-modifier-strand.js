async (page) => {
  // WHY IS META STRANDED, AND WHAT DOES THE PLAYER SEE WHILE IT IS.
  //
  //   node tools/qa/run-playwright.cjs tools/qa/walk-modifier-strand.js
  //
  // Third report of the same symptom. The distinction this probe exists to draw,
  // because every fix so far has assumed the wrong one:
  //
  //   PAGE-SIDE STRAND â€” walkHeld contains 'meta'; the OS does NOT think Win is
  //     down. Recoverable: getModifierState says up, reconcile drops it. A page
  //     -side phantom CANNOT open the Windows Quick Link menu, because the shell
  //     only fires Win+X when the OS's own key state has Win held.
  //
  //   OS-SIDE STRAND â€” the OS thinks Win is down. Win+X fires. The browser never
  //     receives the 'x' keydown at all, so no page code can reconcile on it, and
  //     no page code can release the modifier either. What the page CAN do is see
  //     it: every mouse event carries getModifierState('Meta'), which answers
  //     from the OS.
  //
  // The user's report is Win+X opening the shell menu, which is only consistent
  // with the second. So this measures both, separately, and reports what the HUD
  // shows in each â€” because a chip that stays silent through the case that eats
  // keys is a second bug, not a passing test.
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
    const E = await import(new URL('src/sim/empire.js', document.baseURI).href);
    const empire = E.newStarterEmpire('relaxed', seed);
    localStorage.setItem('golfempire:autosave', JSON.stringify(E.empireSnapshot(empire)));
  }, SEED);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 120000 });
  await page.waitForTimeout(2500);

  // Everything the page can say about modifiers, in one snapshot, plus what the
  // player can actually READ off the screen.
  const snap = async (label) => {
    const s = await page.evaluate(() => {
      const walk = window.__fw?.scene3d?.walk;
      const chip = document.querySelector('.hud-modifiers');
      const visible = !!chip && chip.style.display !== 'none' && getComputedStyle(chip).display !== 'none';
      return {
        controllerBelieves: (() => { try { return walk?.heldModifiers?.() || []; } catch { return ['<threw>']; } })(),
        osReports: (() => { try { return walk?.osModifiers?.() ?? null; } catch { return ['<threw>']; } })(),
        lastReconcileSource: (() => { try { return walk?.lastReconcileSource?.() ?? null; } catch { return null; } })(),
        pointerLocked: !!document.pointerLockElement,
        documentHasFocus: document.hasFocus(),
        chip: { present: !!chip, visible, stuck: !!chip?.classList.contains('stuck'), text: chip?.textContent || '' },
      };
    });
    return { label, ...s };
  };

  const steps = [];
  const record = async (label) => { const s = await snap(label); steps.push(s); return s; };

  // ---------------------------------------------------------------- A
  // THE PAGE-SIDE CASE, reproduced exactly as the brief specified: strand a
  // modifier, press nothing else, move the mouse, confirm the phantom is gone.
  await page.evaluate(() => window.__fw.scene3d.walk.strandModifier('meta'));
  const aStranded = await record('A1 page-side strand planted');
  await page.mouse.move(700, 400);
  await page.mouse.move(760, 430); // two moves: the first may be swallowed by the lock guard
  await page.waitForTimeout(120);
  const aAfterMove = await record('A2 after mouse move, no keys pressed');

  // ---------------------------------------------------------------- B
  // THE OS-SIDE CASE. Playwright holds Meta down for real, so every subsequent
  // event carries metaKey. Clearing the controller's own set afterwards
  // reproduces the shape that matters: the OS says DOWN, the page never recorded
  // a keydown, and there is nothing in walkHeld for a reconcile to drop.
  await page.keyboard.down('Meta');
  await page.evaluate(() => window.__fw.scene3d.walk.releaseAllInput());
  const bPlanted = await record('B1 OS holds Meta, controller set cleared');
  await page.mouse.move(800, 420);
  await page.mouse.move(840, 450);
  await page.waitForTimeout(120);
  const bAfterMove = await record('B2 after mouse move while OS holds Meta');
  // SHOT OF THE ELEMENT, NOT A GUESSED CROP. The first version of this clipped
  // the top-left 900x220 and captured roof and sky â€” the HUD is not there. A
  // screenshot of the wrong rectangle is not a visual verification, it is a
  // picture. Measure the box, require it to be real and on screen, and frame it.
  const chipBox = await page.evaluate(() => {
    const chip = document.querySelector('.hud-modifiers');
    if (!chip) return null;
    const r = chip.getBoundingClientRect();
    return {
      x: r.x, y: r.y, width: r.width, height: r.height, vw: innerWidth, vh: innerHeight,
    };
  });
  const chipOnScreen = !!chipBox && chipBox.width > 20 && chipBox.height > 6
    && chipBox.x >= 0 && chipBox.y >= 0
    && chipBox.x + chipBox.width <= chipBox.vw && chipBox.y + chipBox.height <= chipBox.vh;
  if (chipOnScreen) {
    const pad = 24;
    await page.screenshot({
      path: path.join(outDir, 'modifier-os-strand-hud.png'),
      clip: {
        x: Math.max(0, chipBox.x - pad),
        y: Math.max(0, chipBox.y - pad),
        width: Math.min(chipBox.vw - Math.max(0, chipBox.x - pad), chipBox.width + pad * 2),
        height: Math.min(chipBox.vh - Math.max(0, chipBox.y - pad), chipBox.height + pad * 2),
      },
    });
  }
  await page.keyboard.up('Meta');
  await page.mouse.move(860, 460);
  await page.waitForTimeout(120);
  const bReleased = await record('B3 after OS releases Meta');

  // ---------------------------------------------------------------- C
  // Same page-side reproduction, but pointer-locked â€” the state the bug
  // interferes with, and the reason the reconcile sits above the lock gate.
  await page.mouse.click(800, 450);
  await page.waitForTimeout(400);
  const cLocked = await record('C1 pointer lock requested');
  await page.evaluate(() => window.__fw.scene3d.walk.strandModifier('meta'));
  await record('C2 stranded while locked');
  await page.mouse.move(880, 470);
  await page.mouse.move(920, 500);
  await page.waitForTimeout(120);
  const cAfterMove = await record('C3 after mouse move while locked');

  // ---------------------------------------------------------------- D
  // Does a reload restore a stale held-set from anywhere?
  await page.evaluate(() => window.__fw.scene3d.walk.strandModifier('meta'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  try { await page.getByRole('button', { name: /^Continue/ }).first().click({ timeout: 15000 }); } catch { /* already in */ }
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 120000 });
  await page.waitForTimeout(1500);
  const dAfterReload = await record('D1 after a reload with a modifier stranded');

  const findings = {
    pageSideStrandIsPlanted: aStranded.controllerBelieves.includes('Meta'),
    pageSideStrandClearedByMouseMove: aAfterMove.controllerBelieves.length === 0,
    pageSideClearedBy: aAfterMove.lastReconcileSource,
    pageSideChipWarnedWhileStranded: aStranded.chip.visible && aStranded.chip.stuck,
    pageSideChipClearedAfter: !aAfterMove.chip.visible,

    osStrandVisibleToController: bAfterMove.controllerBelieves.length > 0,
    osStrandVisibleViaOsReports: Array.isArray(bAfterMove.osReports) && bAfterMove.osReports.includes('Meta'),
    osStrandWarnedOnHud: bAfterMove.chip.visible,
    osStrandChipOnScreen: chipOnScreen,
    osStrandChipBox: chipBox,
    osStrandChipText: bAfterMove.chip.text,
    osReleaseClearedHud: !bReleased.chip.visible,

    pointerLockEngaged: cLocked.pointerLocked,
    lockedStrandClearedByMouseMove: cAfterMove.controllerBelieves.length === 0,
    lockedClearedBy: cAfterMove.lastReconcileSource,

    reloadRestoredStaleHeldSet: dAfterReload.controllerBelieves.length > 0,
  };

  const result = {
    what: 'page-side vs OS-side modifier strand, and what the HUD shows in each',
    findings,
    steps,
    interpretation: {
      pageSide: findings.pageSideStrandClearedByMouseMove
        ? 'WORKS. A phantom the page invented is cleared by looking around, with no key pressed.'
        : 'BROKEN. The reconcile did not clear a planted phantom on mousemove.',
      osSide: findings.osStrandWarnedOnHud
        ? 'VISIBLE. The player can see that a modifier is eating their keys.'
        : 'INVISIBLE. The OS holds a modifier, keys are being eaten, and nothing on '
          + 'screen says so. This is the case that costs a week.',
    },
    errs: errs.slice(0, 16),
    ok: findings.pageSideStrandIsPlanted
      && findings.pageSideStrandClearedByMouseMove
      && findings.pageSideChipWarnedWhileStranded
      && findings.pageSideChipClearedAfter
      && findings.lockedStrandClearedByMouseMove
      && !findings.reloadRestoredStaleHeldSet
      // THE CASE THAT COST THREE REPORTS. The OS holds a modifier, the page never
      // saw a keydown for it, and the player must be able to SEE that. A run where
      // this is false is the bug, whatever else passes.
      && findings.osStrandVisibleViaOsReports
      && findings.osStrandWarnedOnHud
      // Visible in the DOM is not the same as visible to a player. The chip has to
      // have a real box, inside the viewport, and be captured in the shot.
      && findings.osStrandChipOnScreen
      && /held by the system/.test(findings.osStrandChipText)
      && findings.osReleaseClearedHud
      && errs.length === 0,
  };
  fs.writeFileSync(path.join(outDir, 'modifier-strand.json'), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}
