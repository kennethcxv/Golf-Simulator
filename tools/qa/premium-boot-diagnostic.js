async (page) => {
  const diagnostics = { pageErrors: [], consoleErrors: [] };
  page.on('pageerror', (error) => diagnostics.pageErrors.push({ message: error.message, stack: error.stack }));
  page.on('console', (message) => {
    if (message.type() === 'error') diagnostics.consoleErrors.push(message.text());
  });
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('golfempire:autosave'));
    const holding = raw.holdings.find((entry) => entry.property.id === raw.activeId) || raw.holdings[0];
    holding.property.tierId = 'premiumPrivate';
    holding.state.property.tierId = 'premiumPrivate';
    localStorage.setItem('golfempire:autosave', JSON.stringify(raw));
  });
  await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`)).clickThroughMenu(page);
  await page.waitForTimeout(25000);
  return {
    diagnostics,
    boot: await page.evaluate(() => ({
      fw: Boolean(window.__fw),
      scene: Boolean(window.__fw?.scene3d),
      clubhouse: Boolean(window.__fw?.scene3d?.clubhouse?.()),
      veil: document.querySelector('.load-veil')?.textContent || null,
    })),
  };
}
