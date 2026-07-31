async (page) => {
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('golfempire:autosave'));
    const holding = raw.holdings.find((entry) => entry.property.id === raw.activeId) || raw.holdings[0];
    holding.property.tierId = 'resortStyle';
    holding.state.property.tierId = 'resortStyle';
    localStorage.setItem('golfempire:autosave', JSON.stringify(raw));
  });
  await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
  await page.waitForTimeout(10000);
  return page.evaluate(() => {
    const clubhouse = window.__fw.scene3d.clubhouse();
    return {
      tier: window.__fw.state.property?.tierId,
      keys: Object.keys(clubhouse),
      resort: clubhouse.resortClubhouse?.diagnostics?.() || null,
      mountain: clubhouse.mountainLodge?.diagnostics?.() || null,
      modern: clubhouse.modernClubhouse?.diagnostics?.() || null,
    };
  });
}
