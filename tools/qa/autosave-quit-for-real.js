// H2 — the quit trigger, tested with a REAL quit.
//
// The stubbed variant in autosave-verify.js could not patch the frozen
// contextBridge, so this driver drives the pause menu's "Save and quit to
// desktop" for real and lets the app die. The harness will report the dead
// app as an error — that is EXPECTED and the bash wrapper validates the
// outcome from disk afterward: autosave-meta.json must carry trigger 'quit'
// with a savedAt inside this run's window.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/autosave');
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'quit-run-started-at.txt'), String(Date.now()));

  await page.setViewportSize({ width: 1280, height: 720 });
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForTimeout(2500);

  await page.keyboard.press('p');
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    [...document.querySelectorAll('.pause-veil-ui button')]
      .find((b) => /session/i.test(b.textContent || ''))?.click();
  });
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    [...document.querySelectorAll('.pause-veil-ui button')]
      .find((b) => /save and quit to desktop/i.test(b.textContent || ''))?.click();
  });
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    [...document.querySelectorAll('button')]
      .find((b) => /^save and quit$/i.test((b.textContent || '').trim()))?.click();
  });
  // the app should now save and exit; give it time to die
  await page.waitForTimeout(8000);
  // If we are still alive, the quit never happened — report that as the result.
  return { stillAlive: true, ok: false };
}
