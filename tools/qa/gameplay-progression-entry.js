async (page) => {
  const diagnostics = [];
  page.on('pageerror', (error) => diagnostics.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') diagnostics.push(`console: ${message.text()}`);
  });
  await page.goto('http://localhost:8458/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByRole('button', { name: 'New Empire — Relaxed' }).click();
  await page.locator('.listing').first().getByRole('button', { name: 'Buy' }).click();
  await page.waitForFunction(() => window.__fw?.screen === 'game' && !window.__fw?.prewarming, null, { timeout: 90000 });
  const intro = page.getByRole('button', { name: 'Begin restoration' });
  if (await intro.isVisible().catch(() => false)) await intro.click();

  await page.keyboard.down('Shift');
  await page.keyboard.down('w');
  await page.waitForTimeout(1500);
  await page.keyboard.up('w');
  await page.keyboard.up('Shift');
  await page.waitForTimeout(250);
  const porch = await page.evaluate(() => ({
    walk: { ...window.__fw.scene3d.walk.state },
    prompt: document.querySelector('.shop-prompt')?.textContent || '',
  }));
  await page.keyboard.press('e');
  await page.waitForTimeout(900);
  await page.keyboard.down('w');
  await page.waitForTimeout(850);
  await page.keyboard.up('w');
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'qa/gameplay-progression/cleanup/01-entered-neglected-clubhouse.png' });
  const inside = await page.evaluate(() => {
    const app = window.__fw;
    const ch = app.scene3d.clubhouse();
    return {
      walk: { ...app.scene3d.walk.state },
      inside: ch.isInside(app.scene3d.walk.state.x, app.scene3d.walk.state.z),
      prompt: document.querySelector('.shop-prompt')?.textContent || '',
      objective: document.querySelector('.objective-title')?.textContent || '',
      campaignPhase: app.state.campaign.phase,
      counterInstalled: app.state.shop.reno.facilities.frontCounter,
      laptopInstalled: app.state.shop.reno.facilities.laptop,
      campaignDiagnostics: ch.campaignDiagnostics(),
    };
  });
  return { ok: diagnostics.length === 0 && inside.inside, diagnostics, porch, inside };
}
