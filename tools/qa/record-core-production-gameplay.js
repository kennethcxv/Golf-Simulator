// One continuous production recording for the checkout, delivery promise, and
// tractor loops. Each embedded acceptance uses normal player controls after its
// deterministic fixture setup and returns its own console/error report.
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
  const sections = [];
  try {
    await page.goto(process.env.QA_BASE_URL || 'http://127.0.0.1:18457/', { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.getByRole('button', { name: /New Empire.*Relaxed/i }).click();
    await page.getByRole('button', { name: 'Buy', exact: true }).first().click();
    await page.waitForFunction(() => window.__fw?.screen === 'game' && window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 90000 });
    for (const [name, filename] of [
      ['checkout', 'register-sale.js'],
      ['delivery', 'delivery-eta.js'],
      ['tractor', 'tractor-production.js'],
    ]) {
      const source = await page.evaluate((file) => fetch(`/tools/qa/${file}`).then((response) => response.text()), filename);
      const run = (0, eval)(`(${source})`);
      const result = await run(page);
      const errorCount = result.errorCount ?? result.errors?.length ?? 0;
      if (errorCount > 0 || result.ok === false) throw new Error(`${name} acceptance reported errors: ${JSON.stringify(result.errors || result)}`);
      sections.push({ name, ok: true });
    }
    const video = page.video();
    await page.close();
    const path = await video.path();
    await context.close();
    return { ok: true, path, sections };
  } catch (error) {
    const video = page.video();
    await page.close().catch(() => {});
    const path = video ? await video.path().catch(() => null) : null;
    await context.close().catch(() => {});
    throw new Error(`Core production recording failed (${path || 'no video'}): ${error.message}`);
  }
}
