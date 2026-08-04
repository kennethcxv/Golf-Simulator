// Housekeeping: the settings acceptance run moves real sliders in the real
// Electron profile. This puts the preferences key back so the defaults apply.
async (page) => {
  await page.waitForTimeout(1200);
  return page.evaluate(() => {
    const before = localStorage.getItem('golfempire:preferences:v1');
    localStorage.removeItem('golfempire:preferences:v1');
    return { removed: before ? before.slice(0, 200) : null };
  });
}
