async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:18679/';
  const repoRoot = process.env.QA_REPO_ROOT || process.cwd();
  const out = path.resolve(repoRoot, process.env.PROPERTY_OPERATIONS_QA_OUT
    || 'qa/property-expansion-world-overhaul/property-operations/before');
  fs.mkdirSync(out, { recursive: true });

  const diagnostics = [];
  page.on('console', (message) => {
    if (message.type() === 'error') diagnostics.push(`console:error:${message.text()}`);
  });
  page.on('pageerror', (error) => diagnostics.push(`pageerror:${error.message}`));

  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.state, null, { timeout: 90000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return window.__fw?.prewarming !== true
      && (!veil || getComputedStyle(veil).display === 'none' || Number(getComputedStyle(veil).opacity) < 0.02);
  }, null, { timeout: 90000 });

  await page.evaluate(async () => {
    const app = window.__fw;
    const E = await import('/src/sim/empire.js');
    app.state.cash = Math.max(app.state.cash, 500000);
    app.empire.cash = app.state.cash;
    if (app.empire.holdings.length < 2) {
      const listing = app.empire.market.find((entry) => entry.id !== app.empire.activeId);
      if (listing) E.buyProperty(app.empire, listing.id);
    }
  });

  await page.keyboard.press('m');
  await page.waitForFunction(() => window.__fw.empireOpen === true);
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(out, '01-detached-portfolio-panel.png') });

  await page.getByRole('button', { name: /Browse the market/ }).click();
  await page.getByText(/Every ask is the seller/).waitFor();
  await page.screenshot({ path: path.join(out, '02-detached-market-modal.png') });

  const result = {
    ok: diagnostics.length === 0,
    holdings: await page.evaluate(() => window.__fw.empire.holdings.length),
    listings: await page.evaluate(() => window.__fw.empire.market.length),
    diagnostics,
  };
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(result, null, 2));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) throw new Error(`Baseline diagnostics: ${diagnostics.join(' | ')}`);
}
