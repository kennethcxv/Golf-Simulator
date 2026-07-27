// Records the complete maintenance acceptance in its own Playwright context.
// The context starts through the real new-empire and property-purchase UI, then
// runs the same normal-control production acceptance used for screenshots.
async (managedPage) => {
  const browser = managedPage.context().browser();
  if (!browser) throw new Error('The managed Playwright context does not expose its browser.');
  const path = process.getBuiltinModule('node:path');
  const outDir = process.env.QA_VIDEO_OUT_DIR || path.join(
    process.env.QA_REPO_ROOT || process.cwd(),
    'qa', 'checkout-delivery-groundskeeping-balance', 'current', 'video',
  );
  const context = await browser.newContext({
    viewport: { width: 1600, height: 900 },
    recordVideo: { dir: outDir, size: { width: 1600, height: 900 } },
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  try {
    await page.goto(process.env.QA_BASE_URL || 'http://127.0.0.1:18457/', { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.getByRole('button', { name: /New Empire.*Relaxed/i }).click();
    await page.getByRole('button', { name: 'Buy', exact: true }).first().click();
    await page.waitForFunction(() => window.__fw?.screen === 'game' && window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 90000 });
    const source = await page.evaluate(() => fetch('/tools/qa/maintenance-production.js').then((response) => response.text()));
    const run = (0, eval)(`(${source})`);
    const report = await run(page);
    const video = page.video();
    await page.close();
    const path = await video.path();
    await context.close();
    return { ok: report.ok && errors.length === 0, path, checks: report.checks, errors };
  } catch (error) {
    const video = page.video();
    await page.close().catch(() => {});
    const path = video ? await video.path().catch(() => null) : null;
    await context.close().catch(() => {});
    throw new Error(`Recorded acceptance failed (${path || 'no video'}): ${error.message}`);
  }
}
