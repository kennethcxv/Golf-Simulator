// One-shot: what does the clubhouse facade actually expose for customers?
// Two drivers in a row reported "0 samples" because they guessed the accessor,
// and a guessed accessor returns undefined rather than throwing -- which reads
// exactly like a healthy empty room.
async (page) => {
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForTimeout(3000);
  const info = await page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse();
    const out = { chKeys: Object.keys(ch).filter((k) => /cust|crowd|people|shopper|queue/i.test(k)) };
    out.typeofCustomers = typeof ch.customers;
    try {
      const c = typeof ch.customers === 'function' ? ch.customers() : ch.customers;
      out.customersType = typeof c;
      out.customersKeys = c ? Object.keys(c).slice(0, 40) : null;
      const d = c && typeof c.diagnostics === 'function' ? c.diagnostics() : null;
      out.diagKeys = d ? Object.keys(d) : null;
      out.crowd = d ? d.crowd : null;
    } catch (e) { out.error = String(e.message || e); }
    return out;
  });
  console.log('API', JSON.stringify(info, null, 2));
  return info;
}
