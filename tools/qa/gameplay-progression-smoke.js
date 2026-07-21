async (page) => {
  const errors = [];
  const warnings = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
    if (message.type() === 'warning') warnings.push(message.text());
  });

  await page.goto('http://localhost:8458/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByRole('button', { name: 'New Empire — Relaxed' }).click();
  await page.locator('.listing').first().getByRole('button', { name: 'Buy' }).click();
  await page.waitForFunction(() => window.__fw?.screen === 'game' && window.__fw?.scene3d, null, { timeout: 45000 });
  await page.waitForFunction(() => !window.__fw?.prewarming, null, { timeout: 90000 });
  await page.waitForTimeout(700);

  await page.screenshot({ path: 'qa/gameplay-progression/arrival/01-first-control.png' });
  const begin = page.getByRole('button', { name: 'Begin restoration' });
  if (await begin.isVisible().catch(() => false)) await begin.click();
  await page.keyboard.down('w');
  await page.waitForTimeout(650);
  await page.keyboard.up('w');
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'qa/gameplay-progression/arrival/02-facing-clubhouse.png' });

  const result = await page.evaluate(async () => {
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    await clubhouse.sheet07Production.ready;
    return {
      screen: app.screen,
      campaign: {
        enabled: app.state.campaign.enabled,
        phase: app.state.campaign.phase,
        businessOpen: app.state.campaign.businessOpen,
      },
      objective: document.querySelector('.objective-title')?.textContent || null,
      objectiveBlocked: document.querySelector('.objective-blocked')?.textContent || null,
      walk: { ...app.scene3d.walk.state },
      sheet07: clubhouse.sheet07Production.diagnostics(),
      campaignWorld: clubhouse.campaignDiagnostics(),
      props: clubhouse.props71to100.diagnostics(),
      arrivalVisible: !!document.querySelector('.arrival-intro'),
    };
  });
  return { ok: errors.length === 0, errors, warnings, ...result };
}
