// Fresh-empire acquisition acceptance. This deliberately starts from the title
// screen and buys through the real property-market modal before opening the
// physical laptop at the newly acquired club.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = process.env.QA_REPO_ROOT || process.cwd();
  const base = process.env.QA_BASE_URL || 'http://localhost:18679/';
  const out = path.resolve(repo, process.env.PROPERTY_FIRST_PURCHASE_QA_OUT
    || 'qa/property-expansion-world-overhaul/property-first-purchase/final');
  fs.mkdirSync(out, { recursive: true });

  const diagnostics = [];
  page.on('console', (message) => {
    if (message.type() === 'error') diagnostics.push(`console:${message.text()}`);
  });
  page.on('pageerror', (error) => diagnostics.push(`pageerror:${error.message}`));
  page.on('requestfailed', (request) => diagnostics.push(
    `requestfailed:${request.url()} (${request.failure()?.errorText || 'unknown'})`,
  ));

  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.removeItem('golfempire:autosave'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByText('New Empire — Relaxed', { exact: true }).click();
  await page.getByText('Every ask is the seller’s number', { exact: false }).waitFor();

  const willow = page.locator('.listing').filter({ hasText: 'Willow Creek Municipal' });
  const bent = page.locator('.listing').filter({ hasText: 'Bent Pines Golf Club' });
  await willow.getByRole('button', { name: 'Buy', exact: true }).waitFor();
  await bent.getByRole('button', { name: 'Locked', exact: true }).waitFor();
  const lockedReason = await bent.getByText('Acquire and operate your first course.', { exact: true }).isVisible();
  await page.waitForTimeout(300); // let the 160 ms production modal entrance settle
  await page.screenshot({ path: path.join(out, '01-fresh-regional-market.png') });

  await willow.getByRole('button', { name: 'Buy', exact: true }).click();
  await page.waitForFunction(() => window.__fw?.empire?.activeId === 'willow-creek', null, { timeout: 90000 });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.state, null, { timeout: 90000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    const hidden = !veil || getComputedStyle(veil).display === 'none'
      || Number.parseFloat(getComputedStyle(veil).opacity || '1') <= 0.01;
    return hidden && window.__fw?.prewarming !== true;
  }, null, { timeout: 90000 });
  await page.evaluate(async () => {
    const app = window.__fw;
    const barrier = app.scene3d.assetBarrier?.(120000);
    if (barrier?.promise) await barrier.promise;
    app.speedIdx = 0;
    app.scene3d.walk.clearKeys?.();
    const origin = app.scene3d.clubhouse().interior.position;
    app.scene3d.walk.state.x = origin.x + 8.55;
    app.scene3d.walk.state.z = origin.z + 4.5;
    app.scene3d.walk.state.yaw = -Math.PI / 2;
    app.scene3d.walk.state.pitch = -0.05;
  });
  diagnostics.length = 0;

  await page.keyboard.press('e');
  await page.waitForFunction(() => window.__fw.laptopOpen === true, null, { timeout: 10000 });
  await page.getByRole('button', { name: 'Properties', exact: true }).click();
  const owned = page.locator('.lt-property-card').filter({ hasText: 'Willow Creek Municipal' });
  await owned.getByText('You are here', { exact: true }).waitFor();
  await page.screenshot({ path: path.join(out, '02-first-property-in-portfolio.png') });

  const saved = await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('golfempire:autosave'));
    return {
      activeId: raw.activeId,
      holdingIds: raw.holdings.map((holding) => holding.property.id),
      firstPurchaseDone: raw.firstPurchaseDone,
    };
  });
  const assertions = {
    honestProgressionLock: lockedReason,
    acquiredThroughPlayerControl: saved.activeId === 'willow-creek',
    oneOwnedProperty: saved.holdingIds.length === 1 && saved.holdingIds[0] === 'willow-creek',
    firstPurchasePersisted: saved.firstPurchaseDone === true,
    physicalLaptopPortfolio: await owned.isVisible(),
    noDiagnostics: diagnostics.length === 0,
  };
  const result = { ok: Object.values(assertions).every(Boolean), assertions, saved, diagnostics };
  fs.writeFileSync(path.join(out, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) throw new Error(`First-property acceptance failed: ${JSON.stringify(assertions)}`);
  return result;
}
