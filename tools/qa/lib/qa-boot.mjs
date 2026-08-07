// The shared menu boot for QA function-files (2026-07-31).
//
// History: dozens of harnesses booted with
//   await page.getByText('Continue', { exact: true }).click();
// which presumed a saved profile. run-playwright.cjs launches an EPHEMERAL
// context, so on every clean run "Continue" does not exist and those drivers
// hung on the load veil (or fell through a .catch and hung on their first
// in-game wait instead). The checkout round-5/7 drivers fixed it locally;
// this module is that fix shared.
//
// Function-files import this with:
//   await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`)).clickThroughMenu(page);
//
// Semantics: resume the save when one exists (the old drivers' intent),
// otherwise start a fresh Relaxed game. Only the MENU is handled here — each
// driver keeps its own post-boot waits, so no timing behaviour changes.

// PLAN_16 R-A — OWNER-RESOLUTION ACCEPTANCE.
//
// Verified during the Phase 2 review: every driver inherits main.cjs's
// 1600x940 DIP window while the owner plays this machine's 4K display, so
// every screenshot, legibility verdict and perf acceptance in six rounds was
// judged at ~62% of the owner's linear resolution with nobody saying so.
//
// This sizes the REAL BrowserWindow to the primary display's full bounds
// (borderless-style maximised bounds, native DIP size; the shipped DPR cap
// stays in force because the acceptance environment reproduces the shipped
// pipeline at the owner's window — it does not invent a new one) and returns
// the caption every acceptance artifact must carry. Falls back verbosely: a
// driver that cannot size the window must SAY so in its output rather than
// silently grading small frames.
//
// Usage, after boot:
//   const cap = await ownerResolution(page, electronApp);
//   out.windowCaption = cap.caption;   // e.g. "2560x1392 DIP @2.0 scale (4K)"
export async function ownerResolution(page, electronApp) {
  // run-electron.cjs's page shim exposes the Electron app as page.electronApp.
  const app = electronApp || page?.electronApp || null;
  try {
    const info = await (app
      ? app.evaluate(({ screen, BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0];
        const display = screen.getDisplayMatching(win.getBounds());
        win.setBounds(display.bounds);
        const content = win.getContentBounds();
        return {
          dipW: content.width,
          dipH: content.height,
          scale: display.scaleFactor,
          physW: Math.round(display.bounds.width * display.scaleFactor),
          physH: Math.round(display.bounds.height * display.scaleFactor),
        };
      })
      : Promise.reject(new Error('no electronApp handle')));
    const dpr = await page.evaluate(() => window.devicePixelRatio);
    return {
      ok: true,
      ...info,
      dpr,
      caption: `${info.dipW}x${info.dipH} DIP @${info.scale} scale `
        + `(display ${info.physW}x${info.physH} physical, dpr ${dpr})`,
    };
  } catch (error) {
    return {
      ok: false,
      caption: `OWNER-RES UNAVAILABLE (${String(error?.message || error)}) — `
        + 'frames are harness-sized, NOT acceptance grade',
    };
  }
}

export async function clickThroughMenu(page) {
  // "Continue" renders on every menu — DISABLED on a clean profile. Resume
  // only when it is actually clickable; otherwise start fresh.
  //
  // VERIFY2_L: the exact-match regex could never see an ENABLED Continue —
  // the live button carries label+detail spans, so its flattened textContent
  // is never the bare word. Match containment on the button, click the node
  // directly.
  const canResume = await page.evaluate(() => {
    const button = [...document.querySelectorAll('button')]
      .find((candidate) => /\bContinue\b/.test(candidate.textContent || ''));
    if (!button || button.disabled) return false;
    button.dataset.qaResume = 'true';
    return true;
  }).catch(() => false);
  if (canResume) {
    await page.click('button[data-qa-resume="true"]');
    return 'continue';
  }
  // The menu renders its buttons disabled until the boot manifest is ready;
  // drivers that navigated and clicked immediately used to race it.
  await page.waitForFunction(() => {
    const button = [...document.querySelectorAll('button')]
      .find((candidate) => /new game/i.test(candidate.textContent || ''));
    return !!button && !button.disabled;
  }, null, { timeout: 90000 });
  await page.getByRole('button', { name: /New game/i }).click();
  await page.locator('.difficulty-card').filter({ hasText: 'Relaxed' }).click();
  const confirm = page.getByRole('button', { name: /^(Start|Confirm|Yes)/i }).first();
  if (await confirm.isVisible({ timeout: 1500 }).catch(() => false)) await confirm.click();
  return 'new-game';
}
