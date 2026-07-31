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

export async function clickThroughMenu(page) {
  // "Continue" renders on every menu — DISABLED on a clean profile. Resume
  // only when it is actually clickable; otherwise start fresh.
  const canResume = await page.evaluate(() => {
    const button = [...document.querySelectorAll('button')]
      .find((candidate) => /^\s*Continue\s*$/.test(candidate.textContent || ''));
    return !!button && !button.disabled;
  }).catch(() => false);
  if (canResume) {
    await page.getByText('Continue', { exact: true }).click();
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
