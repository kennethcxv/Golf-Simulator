async (page) => {
  await page.goto(process.env.QA_BASE_URL || 'http://localhost:8457/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('golfempire:autosave'));
    const holding = raw.holdings.find((entry) => entry.property.id === raw.activeId) || raw.holdings[0];
    holding.property.tierId = 'premiumPrivate';
    holding.state.property.tierId = 'premiumPrivate';
    localStorage.setItem('golfempire:autosave', JSON.stringify(raw));
  });
  await page.getByText('Continue', { exact: true }).click();
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
  await page.waitForTimeout(12000);
  return page.evaluate(() => {
    const clubhouse = window.__fw.scene3d.clubhouse();
    return {
      tier: window.__fw.state.property?.tierId,
      keys: Object.keys(clubhouse),
      premium: clubhouse.premiumCountryClub?.diagnostics?.() || null,
      resort: clubhouse.resortClubhouse?.diagnostics?.() || null,
      modern: clubhouse.modernClubhouse?.diagnostics?.() || null,
    };
  });
}
