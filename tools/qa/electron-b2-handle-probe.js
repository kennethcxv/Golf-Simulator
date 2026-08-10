// What does scene3d.clubhouse() actually expose for the desk bridge?
async (page) => {
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForTimeout(2000);
  const probe = await page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse();
    const keys = Object.keys(ch);
    return {
      total: keys.length,
      deskish: keys.filter((k) => /desk|reserv|walk|queue|front/i.test(k)),
      hasCustomers: typeof ch.customers === 'function',
      hasGetCustomers: typeof ch.getCustomers === 'function',
    };
  });
  console.log('B2-HANDLE', JSON.stringify(probe));
}
